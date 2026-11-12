import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { effectiveEntries } from '../extension/lib/core.js';

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

test('X read-only page browser fixtures', { skip: !playwright && 'Set PLAYWRIGHT_MODULE or install playwright to run browser fixtures.' }, async t => {
  const browser = await playwright.chromium.launch({ headless: true, ...(process.env.GAB_CHROMIUM_PATH ? { executablePath: process.env.GAB_CHROMIUM_PATH } : {}) });
  const pages = [];
  const fixtures = new WeakMap();
  async function updateFixture(page, change) {
    change(fixtures.get(page));
    await page.evaluate(() => window.__update());
  }
  async function fixture({ path = '/target_user', state = initialState(), blocked = false, loadedMarker } = {}) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    pages.push(page);
    const data = { state: structuredClone(state), error: null, override: undefined };
    fixtures.set(page, data);
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><header><nav><a data-testid="AppTabBar_Profile_Link" href="/owner_user">Profile</a></nav><button data-testid="SideNav_AccountSwitcher_Button"><div data-testid="UserAvatar-Container-owner_user" style="width:24px;height:24px"></div></button></header><main><div data-testid="primaryColumn"><div data-testid="UserName">Target @target_user</div><button data-testid="userActions">More</button><button id="follow" data-testid="1234567890123456789-follow">Follow</button></div></main></body></html>' }));
    await page.goto(`https://x.com${path}`);
    await page.exposeFunction('__readFilterProjection', () => {
      if (data.error) throw new Error(data.error);
      if (data.override !== undefined) return data.override;
      return { ok: true, filterState: { language: data.state.settings.language, hideContent: data.state.settings.hideContent !== false, handles: effectiveEntries(data.state).map(entry => entry.handle) } };
    });
    await page.evaluate(({ blocked, loadedMarker }) => {
      if (loadedMarker !== undefined) window.__gugaAbuserBlockerLoaded = loadedMarker;
      window.__listenerRegistrations = 0;
      window.__clicks = [];
      window.__reports = [];
      window.__requestedTypes = [];
      window.__receivedProjections = [];
      window.__localReads = 0;
      window.__revision = 0;
      window.__switchAccount = account => {
        document.querySelector('[data-testid="AppTabBar_Profile_Link"]').setAttribute('href', `/${account}`);
        document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"] [data-testid^="UserAvatar-Container-"]').dataset.testid = `UserAvatar-Container-${account}`;
      };
      window.chrome = {
        runtime: {
          id: 'test-extension',
          onMessage: { addListener(listener) { window.__listenerRegistrations++; window.__listener = listener; } },
          async sendMessage(message) {
            window.__requestedTypes.push(message.type);
            if (message.type === 'GET_FILTER_STATE') {
              const result = await window.__readFilterProjection();
              if (result?.filterState) window.__receivedProjections.push(result.filterState);
              return result;
            }
            if (message.type === 'GET_STATE') return { ok: false, error: 'Content scripts may not read complete state.' };
            if (message.type === 'CAPTURE_PROGRESS') window.__reports.push(message);
            return { ok: true };
          }
        },
        storage: {
          local: { async get() { window.__localReads++; throw new Error('Content scripts may not read persisted state.'); } },
          onChanged: { addListener(listener) { window.__storageListener = listener; } }
        }
      };
      window.__send = (message, sender = { id: 'test-extension' }) => new Promise(resolve => {
        let responded = false;
        const keepChannel = window.__listener(message, sender, result => { responded = true; resolve(result); });
        if (keepChannel !== true && !responded) resolve(undefined);
      });
      window.__update = () => window.__storageListener({ gabStateRevision: { newValue: ++window.__revision } }, 'local');
      if (blocked) document.querySelector('#follow').dataset.testid = '1234567890123456789-unblock';
      document.addEventListener('click', event => {
        const control = event.target.closest('[data-testid="userActions"],[data-testid="block"],[data-testid="confirmationSheetConfirm"],[data-testid$="-unblock"]');
        if (control) window.__clicks.push(control.dataset.testid);
      });
    }, { blocked, loadedMarker });
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: source });
    return page;
  }

  try {
    await t.test('removed DOM block, probe and verify messages have no response or click capability', async () => {
      for (const blocked of [false, true]) {
        const page = await fixture({ blocked });
        await page.evaluate(() => {
          const menu = document.createElement('div');
          menu.setAttribute('role', 'menu');
          menu.innerHTML = '<button data-testid="block">Block @target_user</button>';
          const dialog = document.createElement('div');
          dialog.setAttribute('role', 'dialog');
          dialog.innerHTML = 'Block @target_user?<button data-testid="confirmationSheetConfirm">Block</button>';
          document.body.append(menu, dialog);
        });
        for (const type of ['GAB_BLOCK', 'GAB_PROBE', 'GAB_VERIFY']) {
          assert.equal(await page.evaluate(request => window.__send(request), { ...request, type, userId: '1234567890123456789' }), undefined, type);
        }
        assert.deepEqual(await page.evaluate(() => window.__clicks), []);
        assert.deepEqual(fixtures.get(page).state, initialState());
      }
      assert.equal(/\b(?:nativeBlock|probeProfile|verifyBlock)\b|\.click\s*\(/.test(source), false);
    });

    await t.test('an old loaded marker permits the update but the same version cannot register twice', async () => {
      const page = await fixture({ loadedMarker: true });
      assert.equal(await page.evaluate(() => window.__gugaAbuserBlockerLoaded), 'filter-projection-v1');
      assert.equal(await page.evaluate(() => window.__listenerRegistrations), 1);
      await page.addScriptTag({ content: source });
      assert.equal(await page.evaluate(() => window.__listenerRegistrations), 1);
      assert.deepEqual(await page.evaluate(() => window.__send({ type: 'GAB_IDENTITY' })), { ok: true, accountHandle: 'owner_user' });
    });

    await t.test('content requests only the minimal projection and ignores legacy plaintext state changes', async () => {
      const page = await fixture();
      await page.waitForFunction(() => window.__receivedProjections.length === 1);
      const before = await page.evaluate(() => ({ requests: window.__requestedTypes, reads: window.__localReads, payloads: window.__receivedProjections, hasFullState: Object.hasOwn(window, '__state') }));
      assert.deepEqual(before.requests, ['GET_FILTER_STATE']);
      assert.equal(before.reads, 0); assert.equal(before.hasFullState, false);
      assert.deepEqual(Object.keys(before.payloads[0]).sort(), ['handles', 'hideContent', 'language']);
      assert.deepEqual(before.payloads[0], {language: 'en', hideContent: true, handles: ['target_user']});
      assert.equal(JSON.stringify(before.payloads).includes('owner_user'), false);
      await page.evaluate(() => window.__storageListener({state: {newValue: {settings: {hideContent: false}, entries: []}}}, 'local'));
      assert.deepEqual(await page.evaluate(() => window.__requestedTypes), ['GET_FILTER_STATE']);
      await page.evaluate(() => window.__update());
      await page.waitForFunction(() => window.__requestedTypes.length === 2);
      assert.deepEqual(await page.evaluate(() => window.__requestedTypes), ['GET_FILTER_STATE', 'GET_FILTER_STATE']);
      assert.equal(/chrome\.storage\.local\s*\.|type:\s*['"]GET_STATE['"]/.test(source), false);
    });

    await t.test('failed or malformed projection reads retain the last successful filtering state', async () => {
      const page = await fixture({path: '/home'});
      await page.evaluate(() => { document.querySelector('main').innerHTML = '<article id="kept" data-testid="tweet"><div data-testid="User-Name"><a href="/target_user">Target</a></div><div data-testid="tweetText">Still hidden</div></article>'; });
      await page.waitForSelector('#kept.gab-filtered');
      await updateFixture(page, data => { data.error = 'Encrypted store cannot be read'; });
      await page.waitForFunction(() => window.__requestedTypes.length >= 2);
      await page.waitForTimeout(150);
      assert.equal(await page.locator('#kept').evaluate(node => node.classList.contains('gab-filtered')), true);
      await updateFixture(page, data => { data.error = null; data.override = {ok: false, code: 'STATE_STORAGE', error: 'Encrypted store cannot be read'}; });
      await page.waitForFunction(() => window.__requestedTypes.length >= 3);
      await page.waitForTimeout(150);
      assert.equal(await page.locator('#kept').evaluate(node => node.classList.contains('gab-filtered')), true);
      await updateFixture(page, data => { data.override = {ok: true, filterState: {language: 'en', hideContent: true, handles: ['target_user', 123]}}; });
      await page.waitForFunction(() => window.__requestedTypes.length >= 4);
      await page.waitForTimeout(150);
      assert.equal(await page.locator('#kept').evaluate(node => node.classList.contains('gab-filtered')), true);
      await updateFixture(page, data => { data.override = undefined; data.state.entries = []; });
      await page.waitForFunction(() => !document.querySelector('#kept').classList.contains('gab-filtered'));
      assert.equal(await page.evaluate(() => window.__localReads), 0);
    });

    await t.test('only same-extension valid projection messages can change page filtering', async () => {
      const page = await fixture({path: '/home'});
      await page.evaluate(() => { document.querySelector('main').innerHTML = '<article id="guarded" data-testid="tweet"><div data-testid="User-Name"><a href="/target_user">Target</a></div><div data-testid="tweetText">Guarded</div></article>'; });
      await page.waitForSelector('#guarded.gab-filtered');
      const disable = {type: 'GAB_FILTER_STATE', filterState: {language: 'en', hideContent: false, handles: []}};
      for (const sender of [{id: 'another-extension'}, {}]) assert.equal(await page.evaluate(({message, sender}) => window.__send(message, sender), {message: disable, sender}), undefined);
      assert.deepEqual(await page.evaluate(() => window.__send({type: 'GAB_FILTER_STATE', filterState: {}})), {ok: false});
      assert.equal(await page.locator('#guarded').evaluate(node => node.classList.contains('gab-filtered')), true);
      assert.deepEqual(await page.evaluate(message => window.__send(message), disable), {ok: true});
      await page.waitForFunction(() => !document.querySelector('#guarded').classList.contains('gab-filtered'));
    });

    await t.test('identifies the real compact-sidebar structure with an empty account-button label', async () => {
      const page = await fixture();
      await page.setViewportSize({ width: 500, height: 900 });
      assert.equal(await page.locator('[data-testid="SideNav_AccountSwitcher_Button"]').innerText(), '');
      const result = await page.evaluate(() => window.__send({ type: 'GAB_IDENTITY' }));
      assert.deepEqual(result, { ok: true, accountHandle: 'owner_user' });
      assert.deepEqual(await page.evaluate(() => window.__clicks), []);
    });

    await t.test('display names and mentions never override structured account identity', async () => {
      const page = await fixture();
      for (const displayName of ['Lucis', 'Lucis @someone_else', '@other_owner']) {
        await page.evaluate(displayName => {
          const button = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
          button.querySelector('.display-name')?.remove();
          const name = document.createElement('span');
          name.className = 'display-name';
          name.textContent = displayName;
          button.append(name);
          document.querySelector('[data-testid="AppTabBar_Profile_Link"]').textContent = 'プロフィール';
        }, displayName);
        assert.deepEqual(await page.evaluate(() => window.__send({ type: 'GAB_IDENTITY' })), { ok: true, accountHandle: 'owner_user' }, displayName);
      }
    });

    await t.test('conflicting navigation or account-avatar identities fail closed', async () => {
      for (const mode of ['profile', 'avatar', 'avatars', 'invalid-profile']) {
        const page = await fixture();
        await page.evaluate(mode => {
          if (mode === 'profile') {
            const link = document.querySelector('[data-testid="AppTabBar_Profile_Link"]').cloneNode(true);
            link.href = '/other_owner';
            document.querySelector('nav').append(link);
          }
          if (mode === 'avatar') document.querySelector('[data-testid="UserAvatar-Container-owner_user"]').dataset.testid = 'UserAvatar-Container-other_owner';
          if (mode === 'avatars') {
            const avatar = document.querySelector('[data-testid="UserAvatar-Container-owner_user"]').cloneNode(true);
            avatar.dataset.testid = 'UserAvatar-Container-other_owner';
            document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]').append(avatar);
          }
          if (mode === 'invalid-profile') document.querySelector('[data-testid="AppTabBar_Profile_Link"]').href = '/settings';
        }, mode);
        const identity = await page.evaluate(() => window.__send({ type: 'GAB_IDENTITY' }));
        assert.equal(identity.ok, false, mode);
        const result = await page.evaluate(request => window.__send(request), request);
        assert.equal(result, undefined, mode);
        assert.deepEqual(await page.evaluate(() => window.__clicks), [], mode);
      }
    });

    await t.test('another user profile, posts, and hidden navigation never become the signed-in account', async () => {
      const page = await fixture();
      await page.evaluate(() => {
        const hidden = document.querySelector('[data-testid="AppTabBar_Profile_Link"]').cloneNode(true);
        hidden.href = '/hidden_owner';
        hidden.hidden = true;
        document.querySelector('nav').append(hidden);
        const author = document.createElement('article');
        author.innerHTML = '<nav><a data-testid="AppTabBar_Profile_Link" href="/post_author">Author profile</a></nav><a href="/post_author">@post_author</a>';
        document.querySelector('main').append(author);
      });
      assert.deepEqual(await page.evaluate(() => window.__send({ type: 'GAB_IDENTITY' })), { ok: true, accountHandle: 'owner_user' });
      assert.equal(await page.locator('[data-testid="UserName"]').innerText(), 'Target @target_user');
    });

    await t.test('connection waits for profile navigation to become ready without opening any menu', async () => {
      const page = await fixture();
      await page.evaluate(() => {
        const link = document.querySelector('[data-testid="AppTabBar_Profile_Link"]');
        link.remove();
        setTimeout(() => document.querySelector('nav').append(link), 250);
      });
      assert.deepEqual(await page.evaluate(() => window.__send({ type: 'GAB_IDENTITY' })), { ok: true, accountHandle: 'owner_user' });
      assert.deepEqual(await page.evaluate(() => window.__clicks), []);
    });

    await t.test('logged-out pages fail after bounded readiness waiting and cannot use arbitrary profile links', async () => {
      const page = await fixture();
      await page.clock.install();
      await page.evaluate(() => {
        document.querySelector('header').remove();
        const fake = document.createElement('nav');
        fake.innerHTML = '<a data-testid="AppTabBar_Profile_Link" href="/target_user">Viewed profile</a>';
        document.querySelector('main').append(fake);
        window.__identityResult = null;
        void window.__send({ type: 'GAB_IDENTITY' }).then(result => { window.__identityResult = result; });
      });
      await page.clock.runFor(8200);
      const result = await page.evaluate(() => window.__identityResult);
      assert.equal(result.ok, false);
      assert.match(result.error, /profile navigation is not available/i);
      assert.deepEqual(await page.evaluate(() => window.__clicks), []);
    });

    await t.test('SPA account changes are read afresh for capture identity', async () => {
      const page = await fixture();
      assert.deepEqual(await page.evaluate(() => window.__send({ type: 'GAB_IDENTITY' })), { ok: true, accountHandle: 'owner_user' });
      await page.evaluate(() => window.__switchAccount('other_owner'));
      assert.deepEqual(await page.evaluate(() => window.__send({ type: 'GAB_IDENTITY' })), { ok: true, accountHandle: 'other_owner' });
      const result = await page.evaluate(request => window.__send(request), request);
      assert.equal(result, undefined);
      assert.deepEqual(await page.evaluate(() => window.__clicks), []);
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

    await t.test('filtering honors numeric owner identity and known exceptions from pending aliases', async () => {
      for (const mode of ['numeric-owner', 'pending-alias']) {
        const state = initialState();
        state.entries.push({ ...state.entries[0], handle: 'other_target', id: '222' });
        if (mode === 'numeric-owner') {
          state.settings.accountId = state.entries[0].id;
          state.settings.accountHandle = '';
        } else {
          state.entries.push({ ...state.entries[0], handle: 'old_target', status: 'pending' });
          state.allowlist = ['old_target'];
        }
        const page = await fixture({ path: '/home', state });
        await page.evaluate(() => {
          document.querySelector('main').innerHTML = '<article id="exempt" data-testid="tweet"><div data-testid="User-Name"><a href="/target_user">Exempt</a></div><div data-testid="tweetText">Keep visible</div></article><article id="control" data-testid="tweet"><div data-testid="User-Name"><a href="/other_target">Other</a></div><div data-testid="tweetText">Approved target</div></article>';
        });
        await page.waitForSelector('#control.gab-filtered');
        assert.equal(await page.locator('#exempt').evaluate(element => element.classList.contains('gab-filtered')), false, mode);
      }
    });

    await t.test('an allowlist identity pin survives removal of the old alias from the list', async () => {
      const state = initialState();
      state.entries.push({ ...state.entries[0], handle: 'other_target', id: '222' });
      state.allowlist = ['old_target'];
      state.allowlistPins = { old_target: ['1234567890123456789'] };
      const page = await fixture({ state });
      await page.evaluate(() => {
        document.querySelector('main').innerHTML = '<article id="exempt" data-testid="tweet"><div data-testid="User-Name"><a href="/target_user">New alias</a></div><div data-testid="tweetText">Still exempt</div></article><article id="filtered" data-testid="tweet"><div data-testid="User-Name"><a href="/other_target">Other</a></div><div data-testid="tweetText">Approved target</div></article>';
      });
      await page.waitForSelector('#filtered.gab-filtered');
      assert.equal(await page.locator('#exempt').evaluate(element => element.classList.contains('gab-filtered')), false);
      assert.equal(await page.locator('#exempt [data-testid="tweetText"]').isVisible(), true);
    });

    await t.test('removing an allowlisted handle disables its remaining identity pin', async () => {
      const state = initialState();
      state.entries.push({ ...state.entries[0], handle: 'other_target', id: '222' });
      state.allowlist = ['old_target'];
      state.allowlistPins = { old_target: ['1234567890123456789'] };
      const page = await fixture({ state });
      await page.evaluate(() => {
        document.querySelector('main').innerHTML = '<article id="target" data-testid="tweet"><div data-testid="User-Name"><a href="/target_user">Target</a></div><div data-testid="tweetText">Approved target</div></article><article id="control" data-testid="tweet"><div data-testid="User-Name"><a href="/other_target">Other</a></div><div data-testid="tweetText">Another target</div></article>';
      });
      await page.waitForSelector('#control.gab-filtered');
      assert.equal(await page.locator('#target').evaluate(element => element.classList.contains('gab-filtered')), false);
      await updateFixture(page, data => { data.state.allowlist = []; });
      await page.waitForSelector('#target.gab-filtered');
      assert.deepEqual(fixtures.get(page).state.allowlistPins, state.allowlistPins);
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
      await updateFixture(page, data => { data.state.allowlist = ['target_user']; });
      await page.waitForFunction(() => !document.querySelector('#bad').classList.contains('gab-filtered'));
      assert.equal(await page.locator('.gab-placeholder').count(), 0);
      assert.equal(await page.locator('#bad [data-testid="tweetText"]').isVisible(), true);
    });

    await t.test('reposts are filtered by the original author, not a name in social context', async () => {
      const page = await fixture({ path: '/home' });
      await page.evaluate(() => {
        document.querySelector('main').innerHTML = '<article id="reposted-target" data-testid="tweet"><div data-testid="socialContext"><a href="/friend_user">Friend reposted</a></div><div data-testid="User-Name"><a href="/target_user">Original target</a></div><div data-testid="tweetText">Target original</div></article><article id="reposted-friend" data-testid="tweet"><div data-testid="socialContext"><a href="/target_user">Target reposted</a></div><div data-testid="User-Name"><a href="/friend_user">Original friend</a></div><div data-testid="tweetText">Friend original</div></article>';
      });
      await page.waitForSelector('#reposted-target.gab-filtered');
      assert.equal(await page.locator('#reposted-friend').evaluate(element => element.classList.contains('gab-filtered')), false);
      assert.equal(await page.locator('#reposted-friend [data-testid="tweetText"]').isVisible(), true);
      assert.deepEqual(await page.evaluate(() => window.__clicks), []);
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

    await t.test('capture can be stopped without clicking any native X action', async () => {
      const page = await fixture({ path: '/settings/blocked/all' });
      assert.equal((await page.evaluate(() => window.__send({ type: 'GAB_CAPTURE', captureId: 'capture-stop', accountHandle: 'owner_user', autoScroll: true }))).ok, true);
      await page.waitForFunction(() => window.__reports.some(report => report.status === 'scanning'));
      assert.deepEqual(await page.evaluate(() => window.__send({ type: 'GAB_STOP_CAPTURE' })), { ok: true });
      await page.waitForFunction(() => window.__reports.some(report => report.status === 'stopped'));
      assert.equal(await page.locator('#gab-capture-status').count(), 0);
      assert.deepEqual(await page.evaluate(() => window.__clicks), []);
    });

    await t.test('capture stops if an SPA update changes the signed-in account', async () => {
      const page = await fixture({ path: '/settings/blocked/all' });
      assert.equal((await page.evaluate(() => window.__send({ type: 'GAB_CAPTURE', captureId: 'capture-switch', accountHandle: 'owner_user', autoScroll: true }))).ok, true);
      await page.waitForFunction(() => window.__reports.some(report => report.status === 'scanning'));
      await page.evaluate(() => window.__switchAccount('other_owner'));
      await page.waitForFunction(() => window.__reports.some(report => report.status === 'stopped'));
      assert.match(await page.evaluate(() => window.__reports.at(-1).message), /account changed/i);
      assert.equal(await page.locator('#gab-capture-status').count(), 0);
      assert.deepEqual(await page.evaluate(() => window.__clicks), []);
    });
  } finally {
    await Promise.all(pages.map(page => page.close()));
    await browser.close();
  }
});
