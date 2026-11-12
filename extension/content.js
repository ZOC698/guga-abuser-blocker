/* Guga Abuser Blocker: read-only X page filtering, identity and list capture. */
(() => {
  'use strict';

  const CONTENT_VERSION = 'filter-projection-v1';
  if (globalThis.__gugaAbuserBlockerLoaded === CONTENT_VERSION) return;
  globalThis.__gugaAbuserBlockerLoaded = CONTENT_VERSION;

  const RESERVED = new Set(['home', 'explore', 'notifications', 'messages', 'settings', 'i', 'search', 'compose', 'login', 'logout', 'signup', 'tos', 'privacy', 'intent', 'share']);
  const words = {
    en: { hidden: 'Hidden by your Guga blocklist', reveal: 'Show this item', stop: 'Stop capture', scanning: 'Collecting visible blocked accounts', capture: 'Capture paused. Completeness is not verified.' },
    zh: { hidden: '已按你的 Guga 名单隐藏', reveal: '显示此项', stop: '停止采集', scanning: '正在采集页面中的已屏蔽账号', capture: '采集已暂停，尚未核实名单是否完整。' },
    ja: { hidden: 'Guga リストにより非表示', reveal: 'この項目を表示', stop: '収集を停止', scanning: '表示されたブロック済みアカウントを収集中', capture: '収集を一時停止しました。全件取得は未確認です。' }
  };
  let filterState = { language: 'en', hideContent: false, handles: [] };
  let filterRequestSerial = 0;
  let blocked = new Set();
  let sweepTimer = null;
  let capturing = null;
  let lastURL = location.href;
  const hidden = new Map();
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const text = () => words[filterState.language] || words.en;

  function handle(value) {
    const result = String(value || '').replace(/^@/, '').toLowerCase();
    return /^[a-z0-9_]{1,15}$/.test(result) && !RESERVED.has(result) ? result : null;
  }

  function profileFromURL(value) {
    try {
      const url = new URL(value, location.origin);
      if (!['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(url.hostname) || url.protocol !== 'https:') return null;
      const match = url.pathname.match(/^\/([a-zA-Z0-9_]{1,15})\/?$/);
      return match ? handle(match[1]) : null;
    } catch { return null; }
  }

  function identity() {
    // The navigation Profile link belongs to the signed-in account, unlike
    // profile headers, tweet authors, or mentions in a user's display name.
    const links = [...document.querySelectorAll('a[data-testid="AppTabBar_Profile_Link"][href]')]
      .filter(link => visible(link) && link.closest('nav,[role="navigation"],header,[role="banner"]') &&
        !link.closest('main,article,[data-testid="UserCell"],[role="menu"],[role="dialog"]'));
    if (!links.length) {
      const error = new Error('The signed-in X profile navigation is not available. Sign in and wait for X to finish loading.');
      error.code = 'IDENTITY_PENDING';
      throw error;
    }
    const profiles = links.map(link => profileFromURL(link.getAttribute('href')));
    if (profiles.some(value => !value) || new Set(profiles).size !== 1) throw new Error('The signed-in X profile navigation is ambiguous or conflicting.');
    const account = profiles[0];
    const buttons = [...document.querySelectorAll('[data-testid="SideNav_AccountSwitcher_Button"]')]
      .filter(button => visible(button) && !button.closest('main,article,[data-testid="UserCell"],[role="menu"],[role="dialog"]'));
    const prefix = 'UserAvatar-Container-';
    for (const button of buttons) {
      // In the compact X sidebar the button has no text at all. Its avatar
      // carries a structured handle; display text is never an identity source.
      const avatars = [...button.querySelectorAll('[data-testid^="UserAvatar-Container-"]')].filter(visible);
      const handles = avatars.map(avatar => handle(avatar.dataset.testid.slice(prefix.length)));
      if (handles.some(value => !value) || new Set(handles).size > 1 || (handles.length && handles[0] !== account)) {
        throw new Error('The X account menu conflicts with the signed-in profile navigation.');
      }
    }
    return account;
  }

  async function readyIdentity() {
    const deadline = Date.now() + 8000;
    while (true) {
      try { return identity(); }
      catch (error) {
        if (error.code !== 'IDENTITY_PENDING' || Date.now() >= deadline) throw error;
        await sleep(200);
      }
    }
  }

  function visible(element) {
    if (!element || !element.isConnected || element.closest('[hidden],[aria-hidden="true"]')) return false;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    return element.getClientRects().length > 0;
  }

  function applyFilterState(next) {
    if (!next || typeof next !== 'object' || !Object.hasOwn(words, next.language) ||
        typeof next.hideContent !== 'boolean' || !Array.isArray(next.handles) || next.handles.length > 20000 ||
        next.handles.some(value => typeof value !== 'string' || handle(value) !== value)) return false;
    // Only the minimum filtering projection enters this page. Complete account
    // records, IDs, exceptions, queues and session information stay in the worker.
    filterState = { language: next.language, hideContent: next.hideContent, handles: [...next.handles] };
    blocked = new Set(filterState.handles);
    scheduleSweep();
    return true;
  }

  async function refreshFilterState() {
    const serial = ++filterRequestSerial;
    try {
      const result = await chrome.runtime.sendMessage({ type: 'GET_FILTER_STATE' });
      if (serial === filterRequestSerial && result?.ok === true) applyFilterState(result.filterState);
    } catch {
      // A failed read must not erase the last successfully loaded protection.
    }
  }

  function cellHandle(cell) {
    // A UserCell bio may link to unrelated @mentions. Require the cell's
    // avatar identity and its explicit @handle profile link to agree instead
    // of treating all profile links in the card as author candidates.
    const prefix = 'UserAvatar-Container-';
    const avatars = [...new Set([...cell.querySelectorAll('[data-testid^="UserAvatar-Container-"]')]
      .filter(element => element.closest('[data-testid="UserCell"]') === cell)
      .map(element => handle(element.dataset.testid.slice(prefix.length))).filter(Boolean))];
    if (avatars.length !== 1) return null;
    const author = avatars[0];
    const matches = [...cell.querySelectorAll('a[href]')].some(link =>
      link.closest('[data-testid="UserCell"]') === cell &&
      profileFromURL(link.getAttribute('href')) === author &&
      handle(link.textContent.trim()) === author && /^@[a-zA-Z0-9_]{1,15}$/.test(link.textContent.trim()));
    return matches ? author : null;
  }

  function tweetAuthor(tweet) {
    const name = tweet.querySelector('[data-testid="User-Name"]');
    if (!name || name.closest('[data-testid="tweet"]') !== tweet) return null;
    const author = [...new Set([...name.querySelectorAll('a[href]')].map(link => profileFromURL(link.getAttribute('href'))).filter(Boolean))];
    return author.length === 1 ? author[0] : null;
  }

  function restore(element, record) {
    element.classList.remove('gab-filtered');
    record?.placeholder?.remove();
    hidden.delete(element);
  }

  function filterElement(element, author, key) {
    let record = hidden.get(element);
    if (record && (record.key !== key || record.handle !== author)) {
      restore(element, record);
      record = null;
    }
    if (!author || !blocked.has(author) || !filterState.hideContent) {
      if (record) restore(element, record);
      return;
    }
    if (record?.revealed) return;
    if (!record) {
      const placeholder = document.createElement('div');
      placeholder.className = 'gab-placeholder';
      placeholder.setAttribute('role', 'note');
      const label = document.createElement('span');
      label.className = 'gab-placeholder-label';
      const show = document.createElement('button');
      show.type = 'button';
      show.className = 'gab-reveal';
      show.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        const active = hidden.get(element);
        if (!active) return;
        active.revealed = true;
        element.classList.remove('gab-filtered');
        active.placeholder.remove();
      });
      placeholder.append(label, show);
      record = { handle: author, key, placeholder, revealed: false };
      hidden.set(element, record);
    }
    const label = `${text().hidden} · @${author}`;
    if (record.placeholder.firstChild.textContent !== label) record.placeholder.firstChild.textContent = label;
    if (record.placeholder.lastChild.textContent !== text().reveal) record.placeholder.lastChild.textContent = text().reveal;
    element.classList.add('gab-filtered');
    if (!record.placeholder.isConnected || record.placeholder.parentElement !== element) element.append(record.placeholder);
  }

  function sweep() {
    sweepTimer = null;
    const capturePage = /^\/settings\/blocked(?:\/|$)/.test(location.pathname);
    for (const [element, record] of hidden) {
      if (!element.isConnected || capturePage || !filterState.hideContent) restore(element, record);
    }
    if (capturePage) return;
    for (const tweet of document.querySelectorAll('article[data-testid="tweet"]')) {
      const author = tweetAuthor(tweet);
      const post = tweet.querySelector('time')?.closest('a')?.getAttribute('href') || tweet.querySelector('[data-testid="tweetText"]')?.textContent || '';
      filterElement(tweet, author, `${author}|${post}`);
    }
    for (const cell of document.querySelectorAll('[data-testid="UserCell"]')) {
      if (cell.closest('article')) continue;
      const author = cellHandle(cell);
      filterElement(cell, author, author);
    }
  }

  function scheduleSweep() {
    if (sweepTimer === null) sweepTimer = setTimeout(sweep, 100);
  }

  function blockedPage() {
    return /^\/settings\/blocked(?:\/all)?\/?$/.test(location.pathname);
  }

  function collectBlocked() {
    if (!blockedPage()) throw new Error('Open X Settings → Blocked accounts → All before collecting.');
    const result = [];
    const main = document.querySelector('main') || document;
    for (const cell of main.querySelectorAll('[data-testid="UserCell"]')) {
      const name = cellHandle(cell);
      if (!name) continue;
      const entry = { handle: name };
      const nativeButton = cell.querySelector('[data-testid$="-unblock"]');
      const id = nativeButton?.dataset.testid.match(/^(\d+)-unblock$/)?.[1];
      if (id) entry.id = id;
      result.push(entry);
    }
    return result;
  }

  async function captureReport(session, entries, status, message) {
    try {
      const result = await chrome.runtime.sendMessage({ type: 'CAPTURE_PROGRESS', captureId: session.captureId, accountHandle: session.accountHandle, entries, status, message });
      if (result?.ok === false) throw new Error(result.error || 'Capture storage failed.');
    } catch (error) {
      session.active = false;
      session.error = error.message;
    }
  }

  function captureBanner(session) {
    const banner = document.createElement('div');
    banner.id = 'gab-capture-status';
    const label = document.createElement('span');
    label.textContent = text().scanning;
    label.setAttribute('aria-live', 'polite');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text().stop;
    button.addEventListener('click', () => { session.active = false; });
    banner.append(label, button);
    document.body.append(banner);
    session.banner = banner;
    return label;
  }

  function scrollContainer() {
    const main = document.querySelector('main');
    let candidate = main;
    while (candidate && candidate !== document.body) {
      const style = getComputedStyle(candidate);
      if (/(auto|scroll)/.test(style.overflowY) && candidate.scrollHeight > candidate.clientHeight + 20) return candidate;
      candidate = candidate.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }

  async function runCapture(session) {
    const found = new Map();
    const label = captureBanner(session);
    let quiet = 0;
    let stopStatus = 'stopped';
    let message = text().capture;
    try {
      for (let iteration = 0; session.active && iteration < 1200; iteration++) {
        if (!blockedPage()) throw new Error('Capture stopped because the page changed.');
        if (identity() !== session.accountHandle) throw new Error('Capture stopped because the signed-in account changed.');
        const before = found.size;
        const batch = collectBlocked();
        for (const entry of batch) found.set(entry.handle, entry);
        await captureReport(session, batch, 'scanning', 'Only accounts rendered by X are collected; total completeness is unverified.');
        label.textContent = `${text().scanning} · ${found.size}`;
        if (!session.autoScroll) { stopStatus = 'idle'; break; }
        const scroller = scrollContainer();
        const oldTop = scroller.scrollTop;
        scroller.scrollTop += Math.max(400, Math.floor((scroller.clientHeight || innerHeight) * 0.7));
        const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 8;
        quiet = found.size === before && (atBottom || scroller.scrollTop === oldTop) ? quiet + 1 : 0;
        if (quiet >= 8) { stopStatus = 'idle'; break; }
        await sleep(1200);
      }
      if (session.error) throw new Error(session.error);
    } catch (error) { message = error.message; }
    finally {
      session.active = false;
      session.banner?.remove();
      if (capturing === session) capturing = null;
      await captureReport(session, [...found.values()], stopStatus, message);
    }
  }

  chrome.runtime.onMessage.addListener((request, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return false;
    if (!request || typeof request.type !== 'string') return false;
    if (request.type === 'GAB_FILTER_STATE') {
      const applied = applyFilterState(request.filterState);
      if (applied) filterRequestSerial++;
      respond({ ok: applied });
      return false;
    }
    if (request.type === 'GAB_IDENTITY') {
      readyIdentity().then(accountHandle => respond({ ok: true, accountHandle }))
        .catch(error => respond({ ok: false, error: error.message }));
      return true;
    }
    if (request.type === 'GAB_CAPTURE') {
      try {
        if (!blockedPage()) throw new Error('Open https://x.com/settings/blocked/all first.');
        if (capturing) throw new Error('A capture is already running in this tab.');
        if (!request.captureId || !handle(request.accountHandle) || identity() !== handle(request.accountHandle)) throw new Error('The capture session does not match the signed-in account.');
        capturing = { active: true, autoScroll: request.autoScroll === true, accountHandle: handle(request.accountHandle), captureId: request.captureId };
        void runCapture(capturing);
        respond({ ok: true });
      } catch (error) { respond({ ok: false, error: error.message }); }
      return false;
    }
    if (request.type === 'GAB_STOP_CAPTURE') {
      if (capturing) capturing.active = false;
      respond({ ok: true });
      return false;
    }
    return false;
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && Object.hasOwn(changes, 'gabStateRevision')) void refreshFilterState();
  });
  void refreshFilterState();
  new MutationObserver(() => {
    if (location.href !== lastURL) { lastURL = location.href; }
    scheduleSweep();
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['href', 'data-testid'] });
  addEventListener('popstate', scheduleSweep);
  addEventListener('pagehide', () => { if (capturing) capturing.active = false; });
})();
