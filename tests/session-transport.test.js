import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright'); } catch { /* optional when invoked directly */ }

const work = path.resolve(import.meta.dirname, '../../../work');
const fakeCookies = {
  lax: 'gab_transport_lax=synthetic-lax-only',
  strict: 'gab_transport_strict=synthetic-strict-only'
};

// This tests browser transport, not X authentication. There is no production
// extension, personal profile, auth_token read, request routing or mock fetch.
test('MV3 worker sends synthetic HttpOnly cookies on the wire and retains persistent cookies after restart', {
  skip: !playwright && 'Set PLAYWRIGHT_MODULE or install Playwright to run browser transport tests.',
  timeout: 90000
}, async t => {
  await fs.mkdir(work, {recursive: true});
  const scratch = await fs.mkdtemp(path.join(work, 'session-transport-'));
  const extension = path.join(scratch, 'extension');
  const profile = path.join(scratch, 'profile');
  const contexts = new Set();
  const sockets = new Set();
  const unexpectedProxyErrors = [];
  let server;
  const debug = phase => { if (process.env.GAB_TRANSPORT_DEBUG) console.error(`[session transport] ${phase}`); };
  async function bounded(promise, label, timeout = 20000) {
    let timer;
    try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeout); })]); }
    finally { clearTimeout(timer); }
  }

  // Register before browser/server setup, so assertion and launch failures also
  // close resources. Leave the generated work directory for diagnosis: Windows
  // profile-file deletion delays must not determine a transport test's result.
  t.after(async () => {
    debug('cleanup: browser');
    try {
      await bounded(Promise.allSettled([...contexts].map(context => context.close())), 'Browser cleanup');
    } finally {
      debug('cleanup: server');
      if (server?.listening) {
        server.closeIdleConnections();
        server.closeAllConnections();
        for (const socket of sockets) socket.destroy();
        await bounded(new Promise(resolve => server.close(resolve)), 'HTTP cleanup', 5000);
      }
    }
    debug('cleanup complete');
    assert.deepEqual(unexpectedProxyErrors, [], 'Unexpected errors on rejected CONNECT sockets must still fail this fixture.');
  });
  const observations = [];
  let seedRequests = 0;
  let rejectedProxyRequests = 0;
  let origin;
  const expires = new Date(Date.now() + 3600000).toUTCString();
  server = http.createServer((request, response) => {
    // Chromium's non-loopback HTTP proxy traffic is rejected locally, never
    // forwarded. CONNECT below similarly rejects non-loopback HTTPS traffic.
    if (!request.url?.startsWith('/')) {
      rejectedProxyRequests++;
      response.writeHead(502, {'Connection': 'close'});
      response.end('External network access is disabled in this test.');
      return;
    }
    const url = new URL(request.url, origin);
    if (url.pathname === '/seed') {
      seedRequests++;
      response.writeHead(200, {
        'Content-Type': 'text/html',
        'Cache-Control': 'no-store',
        'Set-Cookie': [
          `${fakeCookies.lax}; HttpOnly; SameSite=Lax; Path=/; Expires=${expires}`,
          `${fakeCookies.strict}; HttpOnly; SameSite=Strict; Path=/; Expires=${expires}`
        ]
      });
      response.end('<!doctype html><title>Synthetic cookie fixture</title><p>Loopback only.</p>');
      return;
    }
    if (url.pathname === '/echo') {
      // Keep only booleans for the two known fixture values, not raw Cookie
      // headers. The server observes the final bytes sent by Chromium.
      const received = (request.headers.cookie || '').split(';').map(value => value.trim());
      const observed = {
        tag: url.searchParams.get('tag'),
        method: request.method,
        lax: received.includes(fakeCookies.lax),
        strict: received.includes(fakeCookies.strict),
        remoteAddress: request.socket.remoteAddress
      };
      observations.push(observed);
      response.writeHead(200, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'});
      response.end(JSON.stringify({received: true}));
      return;
    }
    response.writeHead(url.pathname === '/favicon.ico' ? 204 : 404);
    response.end();
  });
  server.on('connection', socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  server.on('connect', (_request, socket) => {
    rejectedProxyRequests++;
    // CONNECT hands this raw socket to us. Chromium may reset it while our
    // deliberate 502 is being sent; those expected rejection races must not
    // become uncaught errors that strand the isolated browser. Keep every
    // other error as a test failure, reported after resources have closed.
    socket.on('error', error => {
      if (error.code !== 'ECONNRESET' && error.code !== 'EPIPE') unexpectedProxyErrors.push(error);
      socket.destroy();
    });
    socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;

  await fs.mkdir(extension);
  await fs.writeFile(path.join(extension, 'manifest.json'), JSON.stringify({
    manifest_version: 3,
    name: 'Isolated cookie transport fixture',
    version: '1.0.0',
    host_permissions: ['http://127.0.0.1/*'],
    background: {service_worker: 'worker.js'}
  }));
  await fs.writeFile(path.join(extension, 'probe.html'), '<!doctype html><title>MV3 cookie transport fixture</title>');
  await fs.writeFile(path.join(extension, 'worker.js'), `
chrome.runtime.onStartup.addListener(() => {});
chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message.type !== 'transport-probe') return false;
  let url;
  try { url = new URL(message.url); } catch { respond({ok: false}); return false; }
  if (url.origin !== ${JSON.stringify(origin)} || url.pathname !== '/echo' || !['include', 'omit'].includes(message.credentials)) {
    respond({ok: false}); return false;
  }
  // No Cookie header and no cookies permission: HttpOnly cookies are attached
  // by Chromium itself. The POST body is synthetic and contains no credentials.
  fetch(url.href, {method: 'POST', body: 'synthetic-probe', credentials: message.credentials, cache: 'no-store', signal: AbortSignal.timeout(10000)})
    .then(response => respond({ok: response.ok, status: response.status}))
    .catch(error => respond({ok: false, error: String(error)}));
  return true;
});
`);

  const offlineArgs = [
    '--enable-automation',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--disable-default-apps',
    '--no-first-run',
    '--disable-quic',
    `--proxy-server=${origin}`,
    '--proxy-bypass-list=127.0.0.1',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'
  ];
  async function launch(directory, {withExtension = false, ignoreDefaultArgs = []} = {}) {
    const context = await playwright.chromium.launchPersistentContext(directory, {
      channel: 'chromium',
      headless: true,
      timeout: 20000,
      ...(process.env.GAB_CHROMIUM_PATH ? {executablePath: process.env.GAB_CHROMIUM_PATH} : {}),
      ignoreDefaultArgs,
      args: [...offlineArgs, ...(withExtension ? [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] : [])]
    });
    contexts.add(context);
    return context;
  }
  async function commandLine(context) {
    const session = await context.browser().newBrowserCDPSession();
    try { return (await session.send('Browser.getBrowserCommandLine')).arguments; }
    finally { await session.detach(); }
  }
  async function close(context) {
    await bounded(context.close(), 'Browser close');
    contexts.delete(context);
  }

  // Inspect this installed Playwright's actual flags, rather than depending on
  // its internal source layout. Remove only the default switch that disables
  // storage partitioning, and verify the measured contexts do not retain it.
  debug('discovering browser flags');
  const discovery = await launch(path.join(scratch, 'flag-discovery'));
  const flags = await commandLine(discovery);
  const disablesPartitioning = value => value.startsWith('--disable-features=') && value.slice('--disable-features='.length).split(',').some(feature => feature.split('<')[0] === 'ThirdPartyStoragePartitioning');
  const ignoreDefaultArgs = flags.filter(disablesPartitioning);
  await close(discovery);
  debug('browser flags inspected');

  async function measuredContext() {
    const context = await launch(profile, {withExtension: true, ignoreDefaultArgs});
    assert.equal((await commandLine(context)).some(disablesPartitioning), false, 'Do not disable ThirdPartyStoragePartitioning in the measured browser.');
    return context;
  }
  async function probe(page, phase, credentials) {
    const tag = `${phase}-${credentials}`;
    const before = observations.length;
    const result = await bounded(page.evaluate(({url, credentials}) => chrome.runtime.sendMessage({type: 'transport-probe', url, credentials}), {
      url: `${origin}/echo?tag=${tag}`, credentials
    }), `Worker message ${tag}`, 15000);
    assert.deepEqual(result, {ok: true, status: 200});
    assert.equal(observations.length, before + 1, 'Exactly one real HTTP request must arrive for each probe.');
    const observed = observations.at(-1);
    assert.equal(observed.tag, tag);
    assert.equal(observed.method, 'POST');
    assert.equal(observed.remoteAddress, '127.0.0.1');
    assert.equal(observed.lax, credentials === 'include', `Lax cookie on wire: ${tag}`);
    assert.equal(observed.strict, credentials === 'include', `Strict cookie on wire: ${tag}`);
  }

  debug('starting first measured context');
  let context = await measuredContext();
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', {timeout: 15000});
  const extensionId = new URL(worker.url()).host;
  const seedPage = await context.newPage();
  await seedPage.goto(`${origin}/seed`, {timeout: 10000});
  assert.equal(await seedPage.evaluate(() => document.cookie), '', 'HttpOnly fixture cookies are not visible to page JavaScript.');
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/probe.html`, {timeout: 10000});
  await probe(page, 'first-session', 'include');
  await probe(page, 'first-session', 'omit');
  debug('first-session wire assertions passed');
  await close(context);

  // Reuse only this test-created directory. Do not seed/add cookies again.
  context = await measuredContext();
  debug('restarted measured context');
  const restartedPage = await context.newPage();
  await restartedPage.goto(`chrome-extension://${extensionId}/probe.html`, {timeout: 10000});
  assert.equal(await restartedPage.evaluate(() => chrome.runtime.id), extensionId);
  await probe(restartedPage, 'after-restart', 'include');
  await probe(restartedPage, 'after-restart', 'omit');
  assert.equal(seedRequests, 1, 'Persistence must come from the profile store, not reseeding.');
  assert.equal(observations.length, 4);
  debug('after-restart wire assertions passed');
  t.diagnostic(`Verified include/omit for HttpOnly Lax and Strict cookies before/after restart; removed ${ignoreDefaultArgs.length} partitioning override; locally rejected ${rejectedProxyRequests} background proxy attempts.`);
  t.diagnostic('HTTP loopback only: this does not test Secure/None, partitioned cookies, X authentication, or a user browser profile.');
});
