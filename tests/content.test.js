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
      window.__afterConfirm = '';
      window.chrome = {
        runtime: {
          id: 'test-extension',
          onMessage: { addListener(listener) { window.__listener = listener; } },
          async sendMessage(message) {
            if (message.type === 'GET_STATE') {
              window.__guards++;
              if (window.__guards === window.__mutateAt) {
                if (window.__mode === 'allow') window.__state.allowlist = ['target_user'];
                if (window.__mode === 'allow-alias') window.__state.allowlist = ['old_target'];
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
            if (window.__afterConfirm === 'id') document.querySelector('#follow').dataset.testid = '9999999999999999999-unblock';
            if (window.__afterConfirm === 'pause') window.__state.paused = true;
            if (window.__afterConfirm === 'remove') window.__state.entries = [];
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

    await t.test('GAB_PROBE observes a handle-only target ID without clicking or mutating durable state', async () => {
      const state = initialState();
      delete state.entries[0].id;
      const page = await fixture({ state });
      const result = await page.evaluate(request => window.__send(request), { ...request, type: 'GAB_PROBE' });
      assert.deepEqual(result, { ok: true, id: '1234567890123456789' });
      assert.deepEqual(await page.evaluate(() => window.__clicks), []);
      assert.deepEqual(await page.evaluate(() => window.__state), state);
    });

    await t.test('GAB_PROBE rejects wrong identity and invalid queue authorization without clicking', async () => {
      for (const mode of ['id', 'account', 'pause', 'allow', 'run']) {
        const page = await fixture();
        await page.evaluate(mode => {
          if (mode === 'id') document.querySelector('#follow').dataset.testid = '9999999999999999999-follow';
          if (mode === 'account') document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]').textContent = 'Another @other_owner';
          if (mode === 'pause') window.__state.paused = true;
          if (mode === 'allow') window.__state.allowlist = ['target_user'];
          if (mode === 'run') window.__state.runId = 'new-run';
        }, mode);
        const result = await page.evaluate(request => window.__send(request), { ...request, type: 'GAB_PROBE' });
        assert.equal(result.ok, false, mode);
        assert.equal(result.uncertain, false, mode);
        assert.deepEqual(await page.evaluate(() => window.__clicks), [], mode);
      }
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

    await t.test('a handle-only entry still requires a visible unambiguous numeric ID before any click', async () => {
      for (const mode of ['missing', 'ambiguous']) {
        const state = initialState();
        delete state.entries[0].id;
        const page = await fixture({ state });
        await page.evaluate(mode => {
          if (mode === 'missing') document.querySelector('#follow').remove();
          else {
            const conflicting = document.createElement('button');
            conflicting.dataset.testid = '9999999999999999999-follow';
            conflicting.textContent = 'Follow';
            document.querySelector('[data-testid="primaryColumn"]').append(conflicting);
          }
        }, mode);
        const result = await page.evaluate(request => window.__send(request), request);
        assert.equal(result.ok, false, mode);
        assert.equal(result.uncertain, false, mode);
        assert.match(result.error, /numeric ID/i, mode);
        assert.deepEqual(await page.evaluate(() => window.__clicks), [], mode);
      }
    });

    await t.test('pins the initially observed ID even when the approved entry has no ID', async () => {
      const state = initialState();
      delete state.entries[0].id;
      const page = await fixture({ state });
      await page.evaluate(() => { window.__afterConfirm = 'id'; });
      const result = await page.evaluate(request => window.__send(request), request);
      assert.equal(result.ok, false);
      assert.equal(result.uncertain, true);
      assert.match(result.error, /numeric ID/i);
      assert.deepEqual(await page.evaluate(() => window.__clicks), ['more', 'block', 'confirm']);
    });

    await t.test('a changed ID, pause, or removal after confirmation cannot report success', async () => {
      for (const mode of ['id', 'pause', 'remove']) {
        const page = await fixture();
        await page.evaluate(mode => { window.__afterConfirm = mode; }, mode);
        const result = await page.evaluate(request => window.__send(request), request);
        assert.equal(result.ok, false, mode);
        assert.equal(result.uncertain, true, mode);
        assert.deepEqual(await page.evaluate(() => window.__clicks), ['more', 'block', 'confirm'], mode);
      }
    });

    await t.test('a pre-existing unblock control with the wrong numeric ID cannot bypass identity checks', async () => {
      const page = await fixture({ blocked: true });
      await page.evaluate(() => { document.querySelector('#follow').dataset.testid = '9999999999999999999-unblock'; });
      const result = await page.evaluate(request => window.__send(request), request);
      assert.equal(result.ok, false);
      assert.equal(result.uncertain, false);
      assert.match(result.error, /numeric ID/i);
      assert.deepEqual(await page.evaluate(() => window.__clicks), []);
    });

    await t.test('GAB_VERIFY confirms a fresh blocked profile without clicking any control', async () => {
      const page = await fixture({ blocked: true });
      const result = await page.evaluate(request => window.__send(request), { ...request, type: 'GAB_VERIFY', userId: '1234567890123456789' });
      assert.deepEqual(result, { ok: true, id: '1234567890123456789' });
      assert.deepEqual(await page.evaluate(() => window.__clicks), []);
    });

    await t.test('GAB_VERIFY requires a string numeric ID pinned by the worker', async () => {
      for (const userId of [undefined, 123, '', 'not-an-id']) {
        const page = await fixture({ blocked: true });
        const result = await page.evaluate(request => window.__send(request), { ...request, type: 'GAB_VERIFY', userId });
        assert.equal(result.ok, false, String(userId));
        assert.equal(result.uncertain, true, String(userId));
        assert.match(result.error, /pinned numeric ID/i, String(userId));
        assert.deepEqual(await page.evaluate(() => window.__clicks), [], String(userId));
      }
    });

    await t.test('GAB_VERIFY rejects wrong profile IDs, switched accounts, and revoked queue authorization', async () => {
      for (const mode of ['id', 'account', 'pause', 'allow', 'remove', 'run', 'job']) {
        const page = await fixture({ blocked: true });
        await page.evaluate(mode => {
          if (mode === 'id') document.querySelector('#follow').dataset.testid = '9999999999999999999-unblock';
          if (mode === 'account') document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]').textContent = 'Another @other_owner';
          if (mode === 'pause') window.__state.paused = true;
          if (mode === 'allow') window.__state.allowlist = ['target_user'];
          if (mode === 'remove') window.__state.entries = [];
          if (mode === 'run') window.__state.runId = 'new-run';
          if (mode === 'job') window.__state.queue[0].status = 'cancelled';
        }, mode);
        const result = await page.evaluate(request => window.__send(request), { ...request, type: 'GAB_VERIFY', userId: '1234567890123456789' });
        assert.equal(result.ok, false, mode);
        assert.equal(result.uncertain, true, mode);
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

    await t.test('allowlisting an alias of the same numeric account cancels an in-flight confirmation', async () => {
      const state = initialState();
      state.entries.push({ ...state.entries[0], handle: 'old_target' });
      const page = await fixture({ state });
      await page.evaluate(() => { window.__mutateAt = 4; window.__mode = 'allow-alias'; });
      const result = await page.evaluate(request => window.__send(request), request);
      assert.equal(result.ok, false);
      assert.equal(result.uncertain, true);
      assert.deepEqual(await page.evaluate(() => window.__clicks), ['more', 'block']);
    });

    await t.test('same-ID allowlist and own-account aliases reject handle-only targets before any click', async () => {
      for (const mode of ['allow', 'own']) {
        const state = initialState();
        delete state.entries[0].id;
        state.entries.push({ ...state.entries[0], handle: mode === 'allow' ? 'old_target' : 'owner_user', id: '1234567890123456789' });
        if (mode === 'allow') state.allowlist = ['old_target'];
        const page = await fixture({ state });
        for (const type of ['GAB_PROBE', 'GAB_BLOCK']) {
          const result = await page.evaluate(request => window.__send(request), { ...request, type });
          assert.equal(result.ok, false, `${mode} ${type}`);
          assert.equal(result.uncertain, false, `${mode} ${type}`);
          assert.deepEqual(await page.evaluate(() => window.__clicks), [], `${mode} ${type}`);
        }
      }
    });

    await t.test('timeline filtering honors an exception for a same-ID account alias', async () => {
      const state = initialState();
      state.entries.push({ ...state.entries[0], handle: 'old_target' });
      state.entries.push({ ...state.entries[0], handle: 'other_target', id: '222' });
      state.allowlist = ['old_target'];
      const page = await fixture({ path: '/home', state });
      await page.evaluate(() => {
        document.querySelector('main').innerHTML = '<article id="exempt" data-testid="tweet"><div data-testid="User-Name"><a href="/target_user">Target</a></div><div data-testid="tweetText">Exempt alias</div></article><article id="filtered" data-testid="tweet"><div data-testid="User-Name"><a href="/other_target">Other</a></div><div data-testid="tweetText">Approved target</div></article>';
      });
      await page.waitForSelector('#filtered.gab-filtered');
      assert.equal(await page.locator('#exempt').evaluate(element => element.classList.contains('gab-filtered')), false);
      assert.equal(await page.locator('#exempt [data-testid="tweetText"]').isVisible(), true);
    });

    await t.test('an allowlist identity pin survives removal of the old alias from the list', async () => {
      const state = initialState();
      state.entries.push({ ...state.entries[0], handle: 'other_target', id: '222' });
      state.allowlist = ['old_target'];
      state.allowlistPins = { old_target: ['1234567890123456789'] };
      const page = await fixture({ state });
      for (const type of ['GAB_PROBE', 'GAB_BLOCK']) {
        const result = await page.evaluate(request => window.__send(request), { ...request, type });
        assert.equal(result.ok, false, type);
        assert.equal(result.uncertain, false, type);
        assert.deepEqual(await page.evaluate(() => window.__clicks), [], type);
      }
      await page.evaluate(() => {
        document.querySelector('main').innerHTML = '<article id="exempt" data-testid="tweet"><div data-testid="User-Name"><a href="/target_user">New alias</a></div><div data-testid="tweetText">Still exempt</div></article><article id="filtered" data-testid="tweet"><div data-testid="User-Name"><a href="/other_target">Other</a></div><div data-testid="tweetText">Approved target</div></article>';
      });
      await page.waitForSelector('#filtered.gab-filtered');
      assert.equal(await page.locator('#exempt').evaluate(element => element.classList.contains('gab-filtered')), false);
      assert.equal(await page.locator('#exempt [data-testid="tweetText"]').isVisible(), true);
    });

    await t.test('removing an allowlisted handle disables its remaining identity pin', async () => {
      const state = initialState();
      state.allowlist = ['old_target'];
      state.allowlistPins = { old_target: ['1234567890123456789'] };
      const page = await fixture({ state });
      const before = await page.evaluate(request => window.__send(request), { ...request, type: 'GAB_PROBE' });
      assert.equal(before.ok, false);
      assert.deepEqual(await page.evaluate(() => window.__clicks), []);
      await page.evaluate(() => { window.__state.allowlist = []; window.__update(); });
      const probe = await page.evaluate(request => window.__send(request), { ...request, type: 'GAB_PROBE' });
      assert.deepEqual(probe, { ok: true, id: '1234567890123456789' });
      const result = await page.evaluate(request => window.__send(request), request);
      assert.deepEqual(result, { ok: true, alreadyBlocked: false, id: '1234567890123456789' });
      assert.deepEqual(await page.evaluate(() => window.__clicks), ['more', 'block', 'confirm']);
      assert.deepEqual(await page.evaluate(() => window.__state.allowlistPins), state.allowlistPins);
      await page.evaluate(() => {
        document.querySelector('main').innerHTML = '<article id="target" data-testid="tweet"><div data-testid="User-Name"><a href="/target_user">Target</a></div><div data-testid="tweetText">Approved target</div></article>';
      });
      await page.waitForSelector('#target.gab-filtered');
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
