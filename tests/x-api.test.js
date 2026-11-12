import test from 'node:test';
import assert from 'node:assert/strict';
import {createXApiAdapter, XApiError} from '../extension/lib/x-api.js';

const ACCOUNT = '9007199254740993';
const TARGET = '9007199254740995';
const AUTH = 'Bearer fake-test-credential';
const CSRF = 'fake-test-csrf';
const SESSION = {accountId: ACCOUNT, authorization: AUTH, csrfToken: CSRF};
const options = {expectedAccountId: ACCOUNT};
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), {
  status, headers: {'content-type': 'application/json; charset=utf-8', ...headers}
});
function fixture({getSession, fetchImpl, ...config} = {}) {
  const calls = [];
  let sessionCalls = 0;
  const adapter = createXApiAdapter({
    getSession: async () => { sessionCalls++; return getSession ? getSession(sessionCalls) : {...SESSION}; },
    fetchImpl: async (...args) => { calls.push(args); return fetchImpl ? fetchImpl(...args) : json({id_str: TARGET, blocking: true}); },
    ...config
  });
  return {adapter, calls, sessionCalls: () => sessionCalls};
}
async function expectError(promise, fields) {
  await assert.rejects(promise, error => {
    assert.ok(error instanceof XApiError);
    for (const [key, value] of Object.entries(fields)) assert.equal(error[key], value, key);
    const serialized = JSON.stringify(error);
    assert.equal(serialized.includes(AUTH), false);
    assert.equal(serialized.includes(CSRF), false);
    return true;
  });
}

test('block adapter sends a single numeric-ID request with explicit browser-session policies', async () => {
  const f = fixture();
  assert.deepEqual(await f.adapter.blockUser(TARGET, options), {accountId: ACCOUNT, targetId: TARGET, blocking: true});
  assert.equal(f.calls.length, 1);
  assert.equal(f.sessionCalls(), 2);
  const [url, init] = f.calls[0];
  assert.equal(url, 'https://x.com/i/api/1.1/blocks/create.json');
  assert.equal(init.method, 'POST');
  assert.equal(init.body, `user_id=${TARGET}`);
  assert.equal(init.credentials, 'include');
  assert.equal(init.redirect, 'error');
  assert.equal(init.cache, 'no-store');
  assert.equal(init.headers.authorization, AUTH);
  assert.equal(init.headers['x-csrf-token'], CSRF);
  assert.equal(init.headers['content-type'], 'application/x-www-form-urlencoded');
});

test('relationship read accepts true and false without issuing a write', async () => {
  for (const blocking of [false, true]) {
    const f = fixture({fetchImpl: () => json({id_str: TARGET, blocking})});
    assert.equal((await f.adapter.readRelationship(TARGET, options)).blocking, blocking);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0][0], `https://x.com/i/api/1.1/users/show.json?user_id=${TARGET}`);
    assert.equal(f.calls[0][1].method, 'GET');
    assert.equal(f.calls[0][1].body, undefined);
  }
});

test('numeric IDs, bound execution account, and self-block protection are required before any request', async () => {
  const f = fixture();
  for (const target of [123, '', '0', '../home', '123&user_id=456', '9'.repeat(26)]) {
    await expectError(f.adapter.blockUser(target, options), {kind: 'validation', uncertain: false});
  }
  await expectError(f.adapter.blockUser(TARGET), {kind: 'validation', uncertain: false});
  await expectError(f.adapter.blockUser(ACCOUNT, options), {kind: 'validation', uncertain: false});
  assert.equal(f.calls.length, 0);
});

test('missing credentials, invalid header characters and unverified sessions fail closed', async () => {
  for (const session of [null, {...SESSION, accountId: 12}, {...SESSION, csrfToken: ''},
    {...SESSION, csrfToken: 'token\r\nx-evil: yes'}, {...SESSION, authorization: 'Bearer '},
    {...SESSION, authorization: 'Bearer token\nCookie: leaked'}]) {
    const f = fixture({getSession: () => session});
    await expectError(f.adapter.blockUser(TARGET, options), {kind: 'auth', uncertain: false});
    assert.equal(f.calls.length, 0);
  }
  const f = fixture({getSession: () => { throw new Error(`${AUTH} ${CSRF}`); }});
  await expectError(f.adapter.blockUser(TARGET, options), {kind: 'auth', uncertain: false});
});

test('account mismatch before dispatch cannot send a request', async () => {
  const f = fixture({getSession: () => ({...SESSION, accountId: '42'})});
  await expectError(f.adapter.blockUser(TARGET, options), {kind: 'account_changed', uncertain: false});
  assert.equal(f.calls.length, 0);
});

test('account switch or logout after a submitted write never reports success', async () => {
  for (const later of [{...SESSION, accountId: '42'}, null]) {
    const f = fixture({getSession: n => n === 1 ? SESSION : later});
    await expectError(f.adapter.blockUser(TARGET, options), {kind: later ? 'account_changed' : 'auth', uncertain: true});
    assert.equal(f.calls.length, 1);
  }
});

test('HTTP 200 errors, wrong identity, missing relationship and non-boolean relationship cannot count as success', async () => {
  for (const body of [{errors: [{code: 326}]}, {id_str: TARGET, blocking: true, errors: []},
    {id_str: TARGET, blocking: true, error: 'failed'}, {id_str: '123', blocking: true},
    {id_str: Number(TARGET), blocking: true}, {id_str: TARGET}, {id_str: TARGET, blocking: 1},
    {id_str: TARGET, blocking: false}, null, []]) {
    const f = fixture({fetchImpl: () => json(body)});
    await expectError(f.adapter.blockUser(TARGET, options), {kind: 'response', uncertain: true, status: 200});
    assert.equal(f.calls.length, 1);
    assert.equal(f.sessionCalls(), 2);
  }
});

test('malformed and oversized bodies are rejected without echoing server text or credentials', async () => {
  const cases = [
    () => new Response(`${AUTH} ${CSRF}`, {headers: {'content-type': 'application/json'}}),
    () => new Response('<html>sign in</html>', {headers: {'content-type': 'text/html'}}),
    () => json({id_str: TARGET, blocking: true, padding: 'a'.repeat(256)}),
    () => json({id_str: TARGET, blocking: true}, 200, {'content-length': '1024'})
  ];
  for (const fetchImpl of cases) {
    const f = fixture({fetchImpl, maxResponseBytes: 128});
    await expectError(f.adapter.blockUser(TARGET, options), {kind: 'response', uncertain: true});
  }
});

test('401 and 403 are authorization failures; 429 supplies a deadline for the durable queue', async () => {
  for (const status of [401, 403]) {
    const f = fixture({fetchImpl: () => json({errors: []}, status)});
    await expectError(f.adapter.blockUser(TARGET, options), {kind: 'auth', uncertain: false, status, retryAt: null});
    assert.equal(f.sessionCalls(), 2);
  }
  const timestamp = 1700000000000;
  const f = fixture({now: () => timestamp, fetchImpl: () => json({}, 429, {
    'retry-after': '60', 'x-rate-limit-reset': String((timestamp + 120000) / 1000)
  })});
  await expectError(f.adapter.blockUser(TARGET, options), {kind: 'rate_limit', uncertain: false, status: 429, retryAt: timestamp + 120000});
  assert.equal(f.calls.length, 1);
});

test('rate-limit parsing supports dates and falls back on invalid or expired headers', async () => {
  const timestamp = 1700000000000;
  for (const [headers, retryAt] of [
    [{'retry-after': new Date(timestamp + 90000).toUTCString()}, timestamp + 90000],
    [{'retry-after': 'invalid', 'x-rate-limit-reset': 'NaN'}, timestamp + 900000],
    [{'retry-after': '0', 'x-rate-limit-reset': String(timestamp / 1000 - 60)}, timestamp + 900000]
  ]) {
    const f = fixture({now: () => timestamp, fetchImpl: () => json({}, 429, headers)});
    await expectError(f.adapter.blockUser(TARGET, options), {kind: 'rate_limit', retryAt, uncertain: false});
  }
});

test('5xx and network failures after writes are uncertain and never retried internally', async () => {
  for (const status of [500, 502, 503]) {
    const f = fixture({fetchImpl: () => json({}, status)});
    await expectError(f.adapter.blockUser(TARGET, options), {kind: 'server', uncertain: true, status});
    assert.equal(f.calls.length, 1);
  }
  const f = fixture({fetchImpl: () => { throw new Error(`${AUTH} ${CSRF}`); }});
  await expectError(f.adapter.blockUser(TARGET, options), {kind: 'network', uncertain: true});
  assert.equal(f.calls.length, 1);
});

test('read failures never claim an uncertain write, and failed account recheck supersedes HTTP 429', async () => {
  const read = fixture({fetchImpl: () => json({}, 503)});
  await expectError(read.adapter.readRelationship(TARGET, options), {kind: 'server', uncertain: false});
  const switched = fixture({getSession: n => n === 1 ? SESSION : {...SESSION, accountId: '42'}, fetchImpl: () => json({}, 429)});
  await expectError(switched.adapter.blockUser(TARGET, options), {kind: 'account_changed', uncertain: true});
});

test('deadline aborts a submitted request and distinguishes it from a preflight timeout', async () => {
  let aborted = false;
  const f = fixture({timeoutMs: 10, fetchImpl: (_, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); });
  })});
  await expectError(f.adapter.blockUser(TARGET, options), {kind: 'timeout', uncertain: true});
  assert.equal(aborted, true);
  assert.equal(f.calls.length, 1);
  let release;
  const before = fixture({timeoutMs: 10, getSession: () => new Promise(resolve => { release = resolve; })});
  await expectError(before.adapter.blockUser(TARGET, options), {kind: 'timeout', uncertain: false});
  release(SESSION);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(before.calls.length, 0, 'resolving a timed-out preflight must not issue a late write');
});

test('deadline covers body read and post-response account verification', async () => {
  const body = fixture({timeoutMs: 10, fetchImpl: () => new Response(new ReadableStream({start() {}}), {
    headers: {'content-type': 'application/json'}
  })});
  await expectError(body.adapter.blockUser(TARGET, options), {kind: 'timeout', uncertain: true});
  const verification = fixture({timeoutMs: 10, getSession: n => n === 1 ? SESSION : new Promise(() => {})});
  await expectError(verification.adapter.blockUser(TARGET, options), {kind: 'timeout', uncertain: true});
});

test('request rejection is distinct from HTTP success without a valid result', async () => {
  const rejected = fixture({fetchImpl: () => json({}, 404)});
  await expectError(rejected.adapter.blockUser(TARGET, options), {kind: 'request', status: 404, uncertain: false});
  const noResult = fixture({fetchImpl: () => new Response(null, {status: 204})});
  await expectError(noResult.adapter.blockUser(TARGET, options), {kind: 'response', status: 204, uncertain: true});
});
