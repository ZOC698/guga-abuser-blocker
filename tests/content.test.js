import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

// Runtime extension has no dependencies. Browser fixtures use a development-only
// Playwright installation: npm install --no-save playwright, or PLAYWRIGHT_MODULE.
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright'); } catch { /* optional browser suite */ }
const source = await readFile(new URL('../extension/content.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../extension/content.css', import.meta.url), 'utf8');
const request = { type: 'GAB_BLOCK', handle: 'target_user', accountHandle: 'owner_user', jobId: 'job-1', runId: 'run-1' };

function initialState() {
  return {
    settings: { language: 'en', accountHandle: 'owner_user', hideContent: true },
    entries: [{ handle: 'target_user', id: '1234567890123456789', status: 'approved', source: 'local' }],
    subscriptions: [], allowlist: [], paused: false, runId: 'run-1',
    queue: [{ id: 'job-1', handle: 'target_user', accountHandle: 'owner_user', status: 'running' }]
  };
}

test('X DOM adapter browser fixtures', { skip: !playwright && 'Set PLAYWRIGHT_MODULE or install playwright to run browser fixtures.' }, async t => {
  const browser = await playwright.chromium.launch({ headless: true, ...(process.env.GAB_CHROMIUM_PATH ? { executablePath: process.env.GAB_CHROMIUM_PATH } : {}) });
  const pages = [];
  async function fixture({ path = '/target_user', state = initialState(), blocked = false } = {}) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    pages.push(page);
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><button data-testid="SideNav_AccountSwitcher_Button">Owner @owner_user</button><main><div data-testid="primaryColumn"><div data-testid="UserName">Target @target_user</div><button data-testid="userActions">More</button><button id="follow" data-testid="1234567890123456789-follow">Follow</button></div></main></body></html>' }));
    await page.goto(`https://x.com${path}`);
    await page.evaluate(({ state, blocked }) => {
      window.__state = state;
      window.__clicks = [];
      window.__reports = [];
      window.__guards = 0;
      window.__mutateAt = 0;
      window.__mode = '';
      window.chrome = {
        runtime: {
          id: 'test-extension',
          onMessage: { addListener(listener) { window.__listener = listener; } },
          async sendMessage(message) {
            if (message.type === 'GET_STATE') {
              window.__guards++;
              if (window.__guards === window.__mutateAt) {
                if (window.__mode === 'allow') window.__state.allowlist = ['target_user'];
                if (window.__mode === 'remove') window.__state.entries = [];
                if (window.__mode === 'pause') window.__state.paused = true;
              }
              return { ok: true, state: structuredClone(window.__state) };
            }
            if (message.type === 'CAPTURE_PROGRESS') window.__reports.push(message);
            return { ok: true };
          }
        },
        storage: {
          local: { async get() { return { state: structuredClone(window.__state) }; } },
          onChanged: { addListener(listener) { window.__storageListener = listener; } }
        }
      };
      window.__send = message => new Promise(resolve => window.__listener(message, { id: 'test-extension' }, resolve));
      window.__update = () => window.__storageListener({ state: { newValue: structuredClone(window.__state) } }, 'local');
      if (blocked) document.querySelector('#follow').dataset.testid = '1234567890123456789-unblock';
      document.querySelector('[data-testid="userActions"]').addEventListener('click', () => {
        window.__clicks.push('more');
        const menu = document.createElement('div');
        menu.setAttribute('role', 'menu');
        const block = document.createElement('button');
        block.dataset.testid = 'block';
        block.textContent = 'Block @target_user';
        block.addEventListener('click', () => {
          window.__clicks.push('block');
          menu.remove();
          const dialog = document.createElement('div');
          dialog.setAttribute('role', 'dialog');
          dialog.append(document.createTextNode('Block @target_user?'));
          const confirm = document.createElement('button');
          confirm.dataset.testid = 'confirmationSheetConfirm';
          confirm.textContent = 'Block';
          confirm.addEventListener('click', () => {
            window.__clicks.push('confirm');
            document.querySelector('#follow').dataset.testid = '1234567890123456789-unblock';
            dialog.remove();
          });
          dialog.append(confirm);
          document.body.append(dialog);
        });
        menu.append(block);
        document.body.append(menu);
      });
    }, { state, blocked });
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: source });
    return page;
  }

  try {
    await t.test('blocks exactly the verified profile and returns its numeric ID', async () => {
      const page = await fixture();
      const result = await page.evaluate(request => window.__send(request), request);
      assert.deepEqual(result, { ok: true, alreadyBlocked: false, id: '1234567890123456789' });
      assert.deepEqual(await page.evaluate(() => window.__clicks), ['more', 'block', 'confirm']);
    });

    await t.test('already-blocked profiles are observed without toggling unblock', async () => {
      const page = await fixture({ blocked: true });
      const result = await page.evaluate(request => window.__send(request), request);
      assert.equal(result.ok, true);
      assert.equal(result.alreadyBlocked, true);
      assert.deepEqual(await page.evaluate(() => window.__clicks), []);
    });

    await t.test('paused jobs, switched accounts, and numeric ID mismatch never click', async () => {
      for (const mode of ['pause', 'account', 'id']) {
        const state = initialState();
        if (mode === 'pause') state.paused = true;
        if (mode === 'account') state.settings.accountHandle = 'other_owner';
        if (mode === 'id') state.entries[0].id = '9999999999999999999';
        const page = await fixture({ state });
        const result = await page.evaluate(request => window.__send(request), request);
        assert.equal(result.ok, false, mode);
        assert.equal(result.uncertain, false, mode);
        assert.deepEqual(await page.evaluate(() => window.__clicks), [], mode);
      }
    });

    await t.test('allowlisting, removal, or pausing before confirmation cancels the final click', async () => {
      for (const mode of ['allow', 'remove', 'pause']) {
        const page = await fixture();
        await page.evaluate(mode => { window.__mutateAt = 4; window.__mode = mode; }, mode);
        const result = await page.evaluate(request => window.__send(request), request);
        assert.equal(result.ok, false, mode);
        assert.equal(result.uncertain, true, mode);
        assert.deepEqual(await page.evaluate(() => window.__clicks), ['more', 'block'], mode);
      }
    });

    await t.test('conflicting IDs and disabled source cannot authorize a block', async () => {
      const state = initialState();
      state.entries.push({ ...state.entries[0], id: '222', source: 'sub-1' });
      state.subscriptions.push({ id: 'sub-1', enabled: true });
      let page = await fixture({ state });
      assert.equal((await page.evaluate(request => window.__send(request), request)).ok, false);
      assert.deepEqual(await page.evaluate(() => window.__clicks), []);
      state.entries = [state.entries[1]];
      state.subscriptions[0].enabled = false;
      page = await fixture({ state });
      assert.equal((await page.evaluate(request => window.__send(request), request)).ok, false);
      assert.deepEqual(await page.evaluate(() => window.__clicks), []);
    });

    await t.test('hides authors only; reveal, virtualized recycling, and allowlist remain reversible', async () => {
      const page = await fixture({ path: '/home' });
      await page.evaluate(() => {
        const main = document.querySelector('main');
        main.innerHTML = '<article id="bad" data-testid="tweet"><div data-testid="User-Name"><a href="/target_user">Target</a></div><a href="/target_user/status/123"><time>now</time></a><div data-testid="tweetText">Some post</div></article><article id="good" data-testid="tweet"><div data-testid="User-Name"><a href="/friend_user">Friend</a></div><div data-testid="tweetText">Hello <a href="/target_user">@target_user</a></div></article>';
      });
      await page.waitForSelector('#bad.gab-filtered');
      assert.equal(await page.locator('#good').evaluate(element => element.classList.contains('gab-filtered')), false);
      await page.locator('#bad .gab-reveal').click();
      assert.equal(await page.locator('#bad').evaluate(element => element.classList.contains('gab-filtered')), false);
      await page.locator('#bad a:has(time)').evaluate(element => element.setAttribute('href', '/target_user/status/456'));
      await page.waitForSelector('#bad.gab-filtered');
      await page.evaluate(() => { window.__state.allowlist = ['target_user']; window.__update(); });
      await page.waitForFunction(() => !document.querySelector('#bad').classList.contains('gab-filtered'));
      assert.equal(await page.locator('.gab-placeholder').count(), 0);
      assert.equal(await page.locator('#bad [data-testid="tweetText"]').isVisible(), true);
    });

    await t.test('captures only unambiguous rendered cells with bound session and exact numeric IDs', async () => {
      const page = await fixture({ path: '/settings/blocked/all' });
      await page.evaluate(() => {
        document.querySelector('main').innerHTML = '<div data-testid="UserCell"><a href="/target_user"><div data-testid="UserAvatar-Container-target_user">Avatar</div></a><a href="/target_user">Target</a><a href="/target_user">@target_user</a><div>Bio mentions <a href="/friend_user">@friend_user</a></div><button data-testid="1234567890123456789-unblock">Blocked</button></div><div data-testid="UserCell"><div data-testid="UserAvatar-Container-first_user">Avatar</div><a href="/second_user">@second_user</a></div>';
      });
      const result = await page.evaluate(() => window.__send({ type: 'GAB_CAPTURE', captureId: 'capture-1', accountHandle: 'owner_user', autoScroll: false }));
      assert.equal(result.ok, true);
      await page.waitForFunction(() => window.__reports.some(report => report.status === 'idle'));
      const reports = await page.evaluate(() => window.__reports);
      assert.ok(reports.every(report => report.captureId === 'capture-1' && report.accountHandle === 'owner_user'));
      assert.deepEqual(reports.at(-1).entries, [{ handle: 'target_user', id: '1234567890123456789' }]);
      assert.match(reports.at(-1).message, /not verified/i);
      assert.equal(await page.locator('.gab-filtered').count(), 0);
    });

    await t.test('user-card authors use avatar identity and matching handle, never biography mentions', async () => {
      const page = await fixture({ path: '/home' });
      await page.evaluate(() => {
        document.querySelector('main').innerHTML = '<div id="target-card" data-testid="UserCell"><a href="/target_user"><div data-testid="UserAvatar-Container-target_user">Avatar</div></a><a href="/target_user">@target_user</a><div>Bio: <a href="/friend_user">@friend_user</a></div></div><div id="friend-card" data-testid="UserCell"><a href="/friend_user"><div data-testid="UserAvatar-Container-friend_user">Avatar</div></a><a href="/friend_user">@friend_user</a><div>Bio: <a href="/target_user">@target_user</a></div></div>';
      });
      await page.waitForSelector('#target-card.gab-filtered');
      assert.equal(await page.locator('#friend-card').evaluate(element => element.classList.contains('gab-filtered')), false);
      await page.locator('#target-card .gab-reveal').click();
      assert.equal(await page.locator('#target-card').evaluate(element => element.classList.contains('gab-filtered')), false);
    });

    await t.test('rejects a capture for another signed-in account', async () => {
      const page = await fixture({ path: '/settings/blocked/all' });
      const result = await page.evaluate(() => window.__send({ type: 'GAB_CAPTURE', captureId: 'capture-2', accountHandle: 'other_owner', autoScroll: true }));
      assert.equal(result.ok, false);
      assert.deepEqual(await page.evaluate(() => window.__reports), []);
    });
  } finally {
    await Promise.all(pages.map(page => page.close()));
    await browser.close();
  }
});
