import test from 'node:test';
import assert from 'node:assert/strict';
import {createXApiAdapter, XApiError} from '../extension/lib/x-api.js';
import {graphqlUserURL, graphqlViewerURL} from '../extension/lib/x-graphql.js';

const ACCOUNT = '9007199254740993';
const TARGET = '9007199254740995';
const AUTH = 'Bearer fake-test-credential';
const CSRF = 'fake-test-csrf';
const SESSION = {accountId: ACCOUNT, authorization: AUTH, csrfToken: CSRF};
const options = {expectedAccountId: ACCOUNT};
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), {
  status, headers: {'content-type': 'application/json; charset=utf-8', ...headers}
});
const graphUser = (id, screenName, fields = {}) => ({data: {user: {result: {__typename: 'User', rest_id: id,
  ...(screenName === undefined ? {} : {core: {screen_name: screenName}}), ...fields}}}});
const graphViewer = (id, screenName, fields = {}) => ({data: {viewer: {user_results: {result: graphUser(id, screenName, fields).data.user.result}}}});
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
    const f = fixture({fetchImpl: () => json(graphUser(TARGET, 'target', {relationship_perspectives: {blocking}}))});
    assert.equal((await f.adapter.readRelationship(TARGET, options)).blocking, blocking);
    assert.equal(f.calls.length, 1);
    const url = new URL(f.calls[0][0]);assert.equal(url.origin, 'https://x.com');
    assert.equal(url.pathname, '/i/api/graphql/mxaYWwt52eAb6OAzYHMVzg/UserByRestId');
    assert.deepEqual(JSON.parse(url.searchParams.get('variables')), {userId: TARGET, withSafetyModeUserFields: true});
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
  for (const body of [{errors: [{code: 9999}]}, {id_str: TARGET, blocking: true, errors: []},
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

test('account verification reads the authenticated Viewer and matches its ID to the browser session', async () => {
  const f = fixture({fetchImpl: () => json(graphViewer(ACCOUNT, 'OWNER_USER'))});
  assert.deepEqual(await f.adapter.verifyAccount(), {accountId: ACCOUNT, handle: 'owner_user'});
  assert.equal(f.calls.length, 1);assert.equal(f.calls[0][0], graphqlViewerURL());
  assert.equal(f.sessionCalls(), 2);
  for (const [, init] of f.calls) {assert.equal(init.method, 'GET');assert.equal(init.body, undefined);assert.equal(init.credentials, 'include');}
});

test('Viewer verification rejects target lookups missing identity and mismatched numeric accounts', async () => {
  for (const [body, kind] of [
    [graphUser(ACCOUNT, 'owner'), 'response'],
    [{screen_name: 'owner', id_str: ACCOUNT}, 'response'],
    [graphViewer(ACCOUNT, '@owner'), 'response'],
    [graphViewer(TARGET, 'owner'), 'account_changed'],
    [graphViewer(Number(ACCOUNT), 'owner'), 'response'],
    [graphViewer(ACCOUNT, undefined), 'response'],
    [graphViewer(ACCOUNT, 'owner', {__typename: undefined}), 'response'],
    [graphViewer(ACCOUNT, 'owner', {suspended: true}), 'auth']
  ]) {
    const f = fixture({fetchImpl: () => json(body)});
    await expectError(f.adapter.verifyAccount(), {kind, route: 'Viewer', uncertain: false});assert.equal(f.calls.length, 1);
  }
  const f = fixture();
  await expectError(f.adapter.verifyAccount({expectedAccountId: TARGET}), {kind: 'account_changed', uncertain: false});assert.equal(f.calls.length, 0);
});

test('account changes before or after Viewer verification fail closed without writes', async () => {
  for (const changeAt of [1, 2]) {
    const f = fixture({getSession: count => count >= changeAt ? {...SESSION, accountId: TARGET} : SESSION,
      fetchImpl: () => json(graphViewer(ACCOUNT, 'owner'))});
    await expectError(f.adapter.verifyAccount({expectedAccountId: ACCOUNT}), {kind: 'account_changed', uncertain: false});
    assert.equal(f.calls.length, changeAt === 1 ? 0 : 1);assert.ok(f.calls.every(([, init]) => init.method === 'GET'));
  }
});

test('handle resolution is read-only, exact after case normalization, and returns only validated identity', async () => {
  const f = fixture({fetchImpl: () => json(graphUser(TARGET, 'TaRgEt_UsEr', {description: AUTH, relationship_perspectives: {blocking: false}}))});
  assert.deepEqual(await f.adapter.resolveUser('@TARGET_USER', options), {accountId: ACCOUNT, targetId: TARGET, handle: 'target_user'});
  assert.equal(f.calls.length, 1);assert.equal(f.calls[0][0], graphqlUserURL('UserByScreenName', 'target_user'));
  assert.equal(f.calls[0][1].method, 'GET');assert.equal(f.calls[0][1].body, undefined);
  const self = fixture({fetchImpl: () => json(graphUser(ACCOUNT, 'owner'))});
  assert.equal((await self.adapter.resolveUser('owner', options)).targetId, ACCOUNT);
});

test('resolver rejects query injection, precision loss and mismatched response handles', async () => {
  const invalid = fixture();
  for (const handle of [123, '', '@@target', 'target&user_id=42', '../target', 'x'.repeat(16), 'https://x.com/target']) {
    await expectError(invalid.adapter.resolveUser(handle, options), {kind: 'validation', uncertain: false});
  }
  await expectError(invalid.adapter.resolveUser('target'), {kind: 'validation', uncertain: false});assert.equal(invalid.calls.length, 0);
  for (const body of [graphUser(TARGET, 'renamed'), graphUser(Number(TARGET), 'target'),
    graphUser('0', 'target'), {id: TARGET, screen_name: 'target'}, graphUser(TARGET, '@target')]) {
    const f = fixture({fetchImpl: () => json(body)});
    await expectError(f.adapter.resolveUser('target', options), {kind: 'response', uncertain: false});assert.equal(f.calls.length, 1);
  }
});

test('legacy target codes classify suspension and unavailability without claiming deletion', async () => {
  for (const method of ['resolveUser', 'readRelationship', 'blockUser']) {
    for (const [code, status, kind] of [[50, 404, 'target_unavailable'], [63, 403, 'target_suspended'], [64, 403, 'auth'], [89, 401, 'auth'], [326, 403, 'auth']]) {
      const f = fixture({fetchImpl: () => json({errors: [{code, message: `${AUTH} ${CSRF}`}]}, status)});
      await expectError(f.adapter[method](method === 'resolveUser' ? 'target' : TARGET, options), {kind, code, status, uncertain: false});
      assert.equal(f.calls.length, 1);assert.equal(f.sessionCalls(), 2);
    }
  }
  for (const flag of ['suspended', 'deactivated', 'deactivated_bit']) {
    const f = fixture({fetchImpl: url => json(url.includes('/graphql/')
      ? graphUser(TARGET, 'target', {[flag]: true}) : {id_str: TARGET, screen_name: 'target', [flag]: true})});
    await expectError(f.adapter.resolveUser('target', options), {kind: flag === 'suspended' ? 'target_suspended' : 'target_unavailable', uncertain: false});
    await expectError(f.adapter.readRelationship(TARGET, options), {kind: flag === 'suspended' ? 'target_suspended' : 'target_unavailable', uncertain: false});
    await expectError(f.adapter.blockUser(TARGET, options), {kind: flag === 'suspended' ? 'target_suspended' : 'target_unavailable', uncertain: true});
  }
  const own = fixture({fetchImpl: () => json({errors: [{code: 63}]}, 403)});
  await expectError(own.adapter.verifyAccount(), {kind: 'auth', code: 63, uncertain: false});
});

test('HTTP auth rate and server status take priority over conflicting target error codes', async () => {
  for (const [status, kind, uncertain] of [[401, 'auth', false], [429, 'rate_limit', false], [503, 'server', true]]) {
    const f = fixture({fetchImpl: () => json({errors: [{code: 63}]}, status)});
    await expectError(f.adapter.blockUser(TARGET, options), {status, kind, uncertain});
  }
  const generic = fixture({fetchImpl: () => json({errors: [{code: '63'}]}, 403)});
  await expectError(generic.adapter.blockUser(TARGET, options), {kind: 'auth', code: null, uncertain: false});
});

test('coded HTTP 200 errors remain unverified writes even when the error category is recognized', async () => {
  for (const [code, kind] of [[88, 'rate_limit'], [326, 'auth'], [63, 'target_suspended'], [50, 'target_unavailable']]) {
    const f = fixture({fetchImpl: () => json({errors: [{code, message: AUTH}]})});
    await expectError(f.adapter.blockUser(TARGET, options), {kind, code, status: 200, uncertain: true});
  }
  const timestamp = 1700000000000;
  const f = fixture({now: () => timestamp, fetchImpl: () => json({errors: [{code: 88}]}, 400, {'retry-after': '10'})});
  await expectError(f.adapter.resolveUser('target', options), {kind: 'rate_limit', code: 88, retryAt: timestamp + 10000, uncertain: false});
});

test('Viewer verification has a deadline and cannot issue a late follow-up', async () => {
  let release;
  const f = fixture({timeoutMs: 10, fetchImpl: () => new Promise(resolve => {release = resolve;})});
  await expectError(f.adapter.verifyAccount(), {kind: 'timeout', uncertain: false});
  release(json(graphViewer(ACCOUNT, 'owner')));await new Promise(resolve => setImmediate(resolve));assert.equal(f.calls.length, 1);
});

test('the write guard runs after session validation and before the sole POST', async () => {
  const order = [];
  const f = fixture({getSession: () => {order.push('session');return SESSION;}, fetchImpl: () => {order.push('post');return json({id_str: TARGET, blocking: true});}});
  const result = await f.adapter.blockUser(TARGET, {...options, beforeWrite: async () => {order.push('guard');assert.equal(f.calls.length, 0);}});
  assert.equal(result.blocking, true);assert.deepEqual(order, ['session', 'guard', 'session', 'post', 'session']);assert.equal(f.calls.length, 1);
});

test('guard rejection, a paused guard and account changes during the guard cannot submit a write', async () => {
  for (const beforeWrite of [async () => {throw new Error(`${AUTH} ${CSRF}`);}, async () => false]) {
    const f = fixture();await expectError(f.adapter.blockUser(TARGET, {...options, beforeWrite}), {kind: 'cancelled', uncertain: false});assert.equal(f.calls.length, 0);
  }
  const switched = fixture({getSession: count => count === 1 ? SESSION : {...SESSION, accountId: TARGET}});
  await expectError(switched.adapter.blockUser(TARGET, {...options, beforeWrite: async () => {}}), {kind: 'account_changed', uncertain: false});assert.equal(switched.calls.length, 0);
  const invalid = fixture();await expectError(invalid.adapter.blockUser(TARGET, {...options, beforeWrite: true}), {kind: 'validation', uncertain: false});assert.equal(invalid.calls.length, 0);
});

test('timed-out write guards cannot cause late POSTs and reads never invoke write guards', async () => {
  let release;
  const f = fixture({timeoutMs: 10});
  await expectError(f.adapter.blockUser(TARGET, {...options, beforeWrite: () => new Promise(resolve => {release = resolve;})}), {kind: 'timeout', uncertain: false});
  release();await new Promise(resolve => setImmediate(resolve));assert.equal(f.calls.length, 0);
  let guards = 0;
  const read = fixture({fetchImpl: () => json(graphUser(TARGET, 'target', {relationship_perspectives: {blocking: false}}))});
  await read.adapter.readRelationship(TARGET, {...options, beforeWrite: () => {guards++;}});
  await read.adapter.resolveUser('target', {...options, beforeWrite: () => {guards++;}});
  assert.equal(guards, 0);assert.ok(read.calls.every(([, init]) => init.method === 'GET'));
});

test('the final dispatch guard follows the last session await and reserves no duplicate budget', async () => {
  const order = [];
  let reservations = 0, dispatchGuards = 0;
  const f = fixture({getSession: () => {order.push('session');return SESSION;},
    fetchImpl: () => {order.push('post');return json({id_str: TARGET, blocking: true});}});
  const result = await f.adapter.blockUser(TARGET, {...options,
    beforeWrite: async () => {reservations++;order.push('reserve');},
    beforeDispatch: async () => {dispatchGuards++;order.push('dispatch-guard');assert.equal(f.calls.length, 0);}});
  assert.equal(result.blocking, true);
  assert.deepEqual(order, ['session', 'reserve', 'session', 'dispatch-guard', 'post', 'session']);
  assert.equal(reservations, 1);assert.equal(dispatchGuards, 1);assert.equal(f.calls.length, 1);
});

test('pausing or removing the target during the second session await prevents the POST', async () => {
  for (const mode of ['pause', 'remove']) {
    const state = {paused: false, approved: true};
    let reservations = 0, dispatchGuards = 0;
    const f = fixture({getSession: async count => {
      if (count === 2) {
        await Promise.resolve();
        if (mode === 'pause') state.paused = true;
        else state.approved = false;
      }
      return SESSION;
    }});
    await expectError(f.adapter.blockUser(TARGET, {...options,
      beforeWrite: async () => {reservations++;},
      beforeDispatch: async () => {
        dispatchGuards++;
        if (state.paused || !state.approved) throw new Error(`${AUTH} ${CSRF}`);
      }}), {kind: 'cancelled', uncertain: false});
    assert.equal(reservations, 1, mode);assert.equal(dispatchGuards, 1, mode);assert.equal(f.calls.length, 0, mode);
  }
});

test('dispatch guard rejection or false results cannot send or disclose guard errors', async () => {
  for (const beforeDispatch of [async () => false, async () => {throw new Error(`${AUTH} ${CSRF}`);}]) {
    const f = fixture();
    await expectError(f.adapter.blockUser(TARGET, {...options, beforeDispatch}), {kind: 'cancelled', uncertain: false});
    assert.equal(f.calls.length, 0);
  }
  const invalid = fixture();
  await expectError(invalid.adapter.blockUser(TARGET, {...options, beforeDispatch: true}), {kind: 'validation', uncertain: false});
  assert.equal(invalid.calls.length, 0);assert.equal(invalid.sessionCalls(), 0);
});

test('a timed-out dispatch guard cannot produce a late POST or reserve budget twice', async () => {
  let release, reservations = 0;
  const f = fixture({timeoutMs: 10});
  await expectError(f.adapter.blockUser(TARGET, {...options,
    beforeWrite: async () => {reservations++;},
    beforeDispatch: () => new Promise(resolve => {release = resolve;})}), {kind: 'timeout', uncertain: false});
  release();await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.length, 0);assert.equal(reservations, 1);
});

test('reads never invoke dispatch guards and a changed session is rejected before the guard', async () => {
  let dispatchGuards = 0;
  const callback = () => {dispatchGuards++;};
  const read = fixture({fetchImpl: () => json(graphUser(TARGET, 'target', {relationship_perspectives: {blocking: false}}))});
  await read.adapter.readRelationship(TARGET, {...options, beforeDispatch: callback});
  await read.adapter.resolveUser('target', {...options, beforeDispatch: callback});
  assert.equal(dispatchGuards, 0);
  const switched = fixture({getSession: count => count === 1 ? SESSION : {...SESSION, accountId: TARGET}});
  await expectError(switched.adapter.blockUser(TARGET, {...options, beforeWrite: async () => {}, beforeDispatch: callback}), {kind: 'account_changed', uncertain: false});
  assert.equal(dispatchGuards, 0);assert.equal(switched.calls.length, 0);
});

test('diagnostics distinguish fixed read routes without disclosing query data or server text', async () => {
  for (const [failingRoute, method, value] of [['Viewer', 'verifyAccount', undefined], ['UserByScreenName', 'resolveUser', 'private_fixture'], ['UserByRestId', 'readRelationship', TARGET]]) {
    const privateHandle = 'private_fixture';
    const f = fixture({fetchImpl: url => json({errors: [{code: 34, message: `${url} ${AUTH} ${CSRF}`}]}, 404)});
    await assert.rejects(f.adapter[method](value, options), error => {
      assert.equal(error.kind, 'request');assert.equal(error.status, 404);assert.equal(error.code, 34);assert.equal(error.route, failingRoute);
      const diagnostic = error.toJSON();assert.equal(diagnostic.route, failingRoute);
      const serialized = JSON.stringify(diagnostic);
      for (const value of [privateHandle, ACCOUNT, AUTH, CSRF, 'https://', 'screen_name=', '?']) assert.equal(serialized.includes(value), false, value);
      return true;
    });
    assert.equal(f.calls.length, 1);
    assert.ok(f.calls.every(([, init]) => init.method === 'GET'));
  }
});

test('endpoint diagnostics survive session network body parser guard and timeout failures', async () => {
  const cases = [
    [fixture({getSession: () => null}), 'readRelationship', TARGET, options, 'UserByRestId', 'auth', false],
    [fixture({fetchImpl: () => {throw new Error(`${AUTH} ${CSRF}`);}}), 'resolveUser', 'private_fixture', options, 'UserByScreenName', 'network', false],
    [fixture({fetchImpl: () => new Response(AUTH, {headers: {'content-type': 'application/json'}})}), 'blockUser', TARGET, options, 'blocks/create.json', 'response', true],
    [fixture({fetchImpl: () => json(graphUser(TARGET, 'wrong'))}), 'resolveUser', 'private_fixture', options, 'UserByScreenName', 'response', false],
    [fixture(), 'blockUser', TARGET, {...options, beforeDispatch: () => false}, 'blocks/create.json', 'cancelled', false],
    [fixture({timeoutMs: 10, fetchImpl: () => new Promise(() => {})}), 'verifyAccount', undefined, undefined, 'Viewer', 'timeout', false]
  ];
  for (const [f, method, value, config, route, kind, uncertain] of cases) {
    await expectError(f.adapter[method](value, config), {route, kind, uncertain});
    assert.ok(f.calls.length <= 1);
  }
  const invalid = fixture();await expectError(invalid.adapter.blockUser('not-an-id', options), {kind: 'validation', route: null});assert.equal(invalid.calls.length, 0);
});

test('diagnostic route construction accepts only explicit endpoint labels', () => {
  for (const route of ['Viewer', 'UserByScreenName', 'UserByRestId', 'blocks/create.json']) {
    assert.equal(new XApiError('Safe fixture', {kind: 'response', route}).toJSON().route, route);
  }
  for (const route of [`users/show.json?screen_name=private_fixture`, `https://x.com/i/api/1.1/users/show.json`, AUTH, CSRF, '../users/show.json', 'other.json', '', undefined, null, {}, 1]) {
    const error = new XApiError('Safe fixture', {kind: 'response', route});assert.equal(error.route, null);assert.equal(error.toJSON().route, null);
    assert.equal(JSON.stringify(error).includes(AUTH), false);assert.equal(JSON.stringify(error).includes(CSRF), false);
  }
});

test('packaged GraphQL queries permit only fixed read operations and observed metadata', () => {
  for (const [operation, value, queryId] of [['UserByScreenName', 'TARGET_USER', 'AMIBMjtxEEATh4z8V9GtRg'],
    ['UserByRestId', TARGET, 'mxaYWwt52eAb6OAzYHMVzg']]) {
    const url = new URL(graphqlUserURL(operation, value));
    assert.equal(url.origin, 'https://x.com');assert.equal(url.pathname, `/i/api/graphql/${queryId}/${operation}`);
    assert.deepEqual([...url.searchParams.keys()], ['variables', 'features', 'fieldToggles']);
    const variables = JSON.parse(url.searchParams.get('variables'));
    assert.deepEqual(variables, operation === 'UserByScreenName'
      ? {screen_name: 'target_user', withGrokTranslatedBio: true} : {userId: TARGET, withSafetyModeUserFields: true});
    const features = JSON.parse(url.searchParams.get('features'));
    assert.equal(Object.keys(features).length, operation === 'UserByScreenName' ? 12 : 10);
    assert.ok(Object.values(features).every(value => typeof value === 'boolean'));
    assert.equal(features.responsive_web_profile_redirect_enabled, true);
    assert.deepEqual(JSON.parse(url.searchParams.get('fieldToggles')), {withPayments: false, withAuxiliaryUserLabels: true});
  }
  for (const [operation, value] of [['https://evil.test/query', 'target'], ['blocks/create.json', TARGET],
    ['UserByScreenName', 'target&screen_name=other'], ['UserByRestId', '../1'], ['UserByRestId', Number(TARGET)]]) {
    assert.throws(() => graphqlUserURL(operation, value), TypeError);
  }
});

test('GraphQL reads accept old and new user shapes and consistently duplicated identity fields', async () => {
  for (const body of [
    graphUser(TARGET, 'TaRgEt', {relationship_perspectives: {blocking: false}}),
    graphUser(TARGET, undefined, {legacy: {screen_name: 'target', id_str: TARGET, blocking: false}}),
    graphUser(TARGET, 'TARGET', {legacy: {screen_name: 'target', id_str: TARGET, blocking: false}, relationship_perspectives: {blocking: false}})
  ]) {
    const f = fixture({fetchImpl: () => json(body)});
    assert.deepEqual(await f.adapter.resolveUser('target', options), {accountId: ACCOUNT, targetId: TARGET, handle: 'target'});
    assert.deepEqual(await f.adapter.readRelationship(TARGET, options), {accountId: ACCOUNT, targetId: TARGET, blocking: false});
    assert.ok(f.calls.every(([, init]) => init.method === 'GET'));
  }
});

test('conflicting malformed or absent GraphQL identity and relationship fields fail closed', async () => {
  for (const body of [
    graphUser(TARGET, 'target', {legacy: {screen_name: 'other', blocking: true}}),
    graphUser(TARGET, 'target', {legacy: {id_str: '123', blocking: true}}),
    graphUser(TARGET, 'target', {legacy: {blocking: false}, relationship_perspectives: {blocking: true}}),
    graphUser(TARGET, 'target', {legacy: {blocking: 'false'}, relationship_perspectives: {blocking: false}}),
    graphUser(TARGET, 'target', {relationship_perspectives: {blocking: 1}}),
    graphUser(TARGET, 'target', {relationship_perspectives: null}),
    graphUser(TARGET, 'target', {core: {screen_name: null}, legacy: {screen_name: 'target', blocking: true}}),
    graphUser(Number(TARGET), 'target', {relationship_perspectives: {blocking: true}}),
    graphUser('123', 'target', {relationship_perspectives: {blocking: true}}),
    graphUser(TARGET, 'target'),
    {data: {user: {result: null}, recommendation: graphUser(TARGET, 'target', {relationship_perspectives: {blocking: true}})}},
    {id_str: TARGET, screen_name: 'target', blocking: true}
  ]) {
    const f = fixture({fetchImpl: () => json(body)});
    await expectError(f.adapter.readRelationship(TARGET, options), {kind: 'response', route: 'UserByRestId', uncertain: false});
    assert.equal(f.calls.length, 1);assert.equal(f.calls[0][1].method, 'GET');
  }
  const missingHandle = fixture({fetchImpl: () => json(graphUser(TARGET, undefined, {relationship_perspectives: {blocking: false}}))});
  await expectError(missingHandle.adapter.resolveUser('target', options), {kind: 'response', route: 'UserByScreenName'});
});

test('unavailable GraphQL results and error envelopes cannot manufacture an unblocked relationship', async () => {
  for (const body of [{data: {user: {result: {__typename: 'UserUnavailable', reason: 'Unavailable'}}}},
    {...graphUser(TARGET, 'target', {relationship_perspectives: {blocking: false}}), errors: []},
    graphUser(TARGET, 'target', {__typename: 'UnknownResult', relationship_perspectives: {blocking: false}})]) {
    const f = fixture({fetchImpl: () => json(body)});
    await expectError(f.adapter.readRelationship(TARGET, options), {kind: body.data.user.result.__typename === 'UserUnavailable' ? 'target_unavailable' : 'response', uncertain: false, route: 'UserByRestId'});
  }
  const own = fixture({fetchImpl: () => json({data: {viewer: {user_results: {result: {__typename: 'UserUnavailable'}}}}})});
  await expectError(own.adapter.verifyAccount(), {kind: 'auth', route: 'Viewer', uncertain: false});
});

test('the unchanged block POST parser does not treat a GraphQL profile as a write acknowledgement', async () => {
  const f = fixture({fetchImpl: () => json(graphUser(TARGET, 'target', {relationship_perspectives: {blocking: true}}))});
  await expectError(f.adapter.blockUser(TARGET, options), {kind: 'response', route: 'blocks/create.json', uncertain: true});
  assert.equal(f.calls.length, 1);assert.equal(f.calls[0][0], 'https://x.com/i/api/1.1/blocks/create.json');assert.equal(f.calls[0][1].body, `user_id=${TARGET}`);
});

test('Viewer timeout covers post-response session verification without late retries', async () => {
  let release;
  const f = fixture({timeoutMs: 10, fetchImpl: () => json(graphViewer(ACCOUNT, 'owner')),
    getSession: count => count === 1 ? SESSION : new Promise(resolve => {release = resolve;})});
  await expectError(f.adapter.verifyAccount(), {kind: 'timeout', route: 'Viewer', uncertain: false});
  release(SESSION);await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.length, 1);assert.ok(f.calls.every(([, init]) => init.method === 'GET'));
});

test('Viewer query metadata is fixed and contains no requested identity or external destination', async () => {
  const url = new URL(graphqlViewerURL());
  assert.equal(url.origin, 'https://x.com');assert.equal(url.pathname, '/i/api/graphql/TpQxQtWMTMnIAMPlMGMqNw/Viewer');
  assert.deepEqual([...url.searchParams.keys()], ['variables', 'features', 'fieldToggles']);
  assert.deepEqual(JSON.parse(url.searchParams.get('variables')), {withCommunitiesMemberships: false});
  assert.deepEqual(JSON.parse(url.searchParams.get('features')), {
    subscriptions_upsells_api_enabled: false,
    profile_label_improvements_pcf_label_in_post_enabled: true,
    responsive_web_profile_redirect_enabled: true,
    rweb_tipjar_consumption_enabled: false,
    verified_phone_label_enabled: false,
    creator_subscriptions_tweet_preview_api_enabled: true,
    responsive_web_graphql_timeline_navigation_enabled: true
  });
  assert.deepEqual(JSON.parse(url.searchParams.get('fieldToggles')), {withAuxiliaryUserLabels: true, isDelegate: false});
  const f = fixture({fetchImpl: () => json(graphViewer(ACCOUNT, 'owner'))});
  assert.deepEqual(await f.adapter.verifyAccount({targetId: TARGET, targetHandle: 'other', url: 'https://evil.test/'}), {accountId: ACCOUNT, handle: 'owner'});
  assert.equal(f.calls.length, 1);assert.equal(f.calls[0][0], url.toString());
  assert.equal(url.toString().includes(ACCOUNT), false);assert.equal(url.toString().includes(TARGET), false);
});

test('Viewer shares strict old and new User parsing without requiring a block relationship', async () => {
  for (const body of [graphViewer(ACCOUNT, 'OWNER'),
    graphViewer(ACCOUNT, undefined, {legacy: {id_str: ACCOUNT, screen_name: 'owner'}}),
    graphViewer(ACCOUNT, 'owner', {legacy: {id_str: ACCOUNT, screen_name: 'OWNER'}})]) {
    const f = fixture({fetchImpl: () => json(body)});
    assert.deepEqual(await f.adapter.verifyAccount(), {accountId: ACCOUNT, handle: 'owner'});
    assert.equal(f.calls.length, 1);assert.equal(f.sessionCalls(), 2);
  }
  for (const body of [
    graphViewer(ACCOUNT, 'owner', {legacy: {screen_name: 'other'}}),
    graphViewer(ACCOUNT, 'owner', {legacy: {id_str: TARGET}}),
    graphViewer(ACCOUNT, 'owner', {legacy: {blocking: true}, relationship_perspectives: {blocking: false}}),
    {...graphViewer(ACCOUNT, 'owner'), errors: []}
  ]) {
    const f = fixture({fetchImpl: () => json(body)});
    await expectError(f.adapter.verifyAccount(), {kind: 'response', route: 'Viewer', uncertain: false});
  }
});

test('Viewer requires the exact authenticated result path and does not search other users', async () => {
  const result = graphUser(ACCOUNT, 'owner').data.user.result;
  for (const body of [{data: {user: {result}}}, {data: {viewer: {result}}},
    {data: {viewer: {user_results: {result: null}}, user: {result}}},
    {data: {viewer: {user_results: {result: {...result, __typename: 'UnknownResult'}}}}}]) {
    const f = fixture({fetchImpl: () => json(body)});
    await expectError(f.adapter.verifyAccount(), {kind: 'response', route: 'Viewer', uncertain: false});
    assert.equal(f.calls.length, 1);
  }
});
