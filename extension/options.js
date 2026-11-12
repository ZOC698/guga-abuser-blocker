import { mountDashboard } from './lib/dashboard-view.js';
import { parseImport, effectiveEntries } from './lib/core.js';
import { t, setLanguage, translatePage, dateText } from './lib/i18n.js';

mountDashboard();
const compact = document.body.classList.contains('popup-dashboard');
const $ = (id) => document.getElementById(id);
const PAGE_SIZE = 50;
const OFFICIAL_SUBSCRIPTION_URL = 'https://raw.githubusercontent.com/ZOC698/guga-abuser-blocker/main/lists/guga-blocklist.json';
let state = { settings: {}, entries: [], subscriptions: [], allowlist: [], queue: [], logs: [], capture: { entries: [] } };
let page = 0;
let selected = new Set();
let currentPanel = 'overview';
let editingHandle = '';
let toastTimer;
let restoringDraft = true;
let intervalDirty = false;
let draftWarningShown = false;
let localConnectionError = '';
let bindingAccount = false;
let scrollSaveTimer;
let cooldownTimer;
const draftKey = 'gabPopupDraftV1';
const panelScroll = {};
const busyActions = new Set();
const draftFields = ['import-text', 'search', 'status-filter', 'export-kind', 'sub-name', 'sub-url', 'allow-handle', 'interval'];
const requestedPanel = location.hash.slice(1);
if (compact) document.querySelector('.app-shell').inert = true;

function draftSnapshot() {
  const fields = Object.fromEntries(draftFields.map((id) => [id, $(id).value]));
  // A subscription never needs credentials; do not retain credential/query URLs in drafts.
  if (/[?@#]/.test(fields['sub-url'])) fields['sub-url'] = '';
  return {version: 1, panel: currentPanel, page, fields, selected: [...selected], panelScroll,
    importOpen: !$('import-card').hidden, fileName: $('file-name').textContent,
    autoScroll: $('auto-scroll').checked, intervalDirty,
    editor: $('entry-dialog').open ? {handle: editingHandle, id: $('edit-id').value, reason: $('edit-reason').value, evidence: $('edit-evidence').value} : null};
}
function saveDraft() {
  if (!compact || restoringDraft || !globalThis.chrome?.storage?.session) return;
  void chrome.storage.session.set({[draftKey]: draftSnapshot()}).catch(() => {
    if (!draftWarningShown) { draftWarningShown = true; toast(t('draftSaveError'), true); }
  });
}
async function readDraft() {
  if (!compact || !globalThis.chrome?.storage?.session) return null;
  try { return (await chrome.storage.session.get(draftKey))[draftKey]; }
  catch { draftWarningShown = true; return null; }
}
function restoreDraft(draft) {
  if (!compact || !draft || draft.version !== 1) return;
  for (const id of draftFields) if (typeof draft.fields?.[id] === 'string') $(id).value = draft.fields[id];
  intervalDirty = !!draft.intervalDirty;
  $('import-card').hidden = !draft.importOpen;
  $('file-name').textContent = typeof draft.fileName === 'string' ? draft.fileName : '';
  $('auto-scroll').checked = draft.autoScroll !== false;
  selected = new Set(Array.isArray(draft.selected) ? draft.selected.filter((handle) => typeof handle === 'string') : []);
  page = Number.isInteger(draft.page) && draft.page >= 0 ? draft.page : 0;
  for (const [name, value] of Object.entries(draft.panelScroll || {})) if (Number.isFinite(value) && value >= 0) panelScroll[name] = value;
  switchPanel(requestedPanel || draft.panel);
  renderLibrary();
  if (draft.editor && localEntries().some((entry) => entry.handle === draft.editor.handle)) {
    editEntry(draft.editor.handle);
    for (const field of ['id', 'reason', 'evidence']) if (typeof draft.editor[field] === 'string') $('edit-' + field).value = draft.editor[field];
  }
}


function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function toast(message, error = false) {
  clearTimeout(toastTimer);
  const node = $('toast');
  node.textContent = message;
  node.className = error ? 'error' : '';
  node.hidden = false;
  toastTimer = setTimeout(() => { node.hidden = true; }, error ? 13000 : 5000);
}
async function request(type, payload = {}) {
  if (!globalThis.chrome?.runtime?.sendMessage) throw new Error(t('extensionUnavailable'));
  const result = await chrome.runtime.sendMessage({ type, ...payload });
  if (!result?.ok) throw new Error(result?.error || t('extensionUnavailable'));
  if (result.state) { state = result.state; render(); }
  return result;
}
async function action(task, button) {
  const key = button?.id || button?.form?.id;
  if (button?.disabled || (key && busyActions.has(key))) return;
  if (key) busyActions.add(key);
  if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); }
  try { return await task(); }
  catch (error) { toast(error?.message || String(error), true); renderSettings(); }
  finally { if (key) busyActions.delete(key); if (button) { button.disabled = false; button.removeAttribute('aria-busy'); render(); } saveDraft(); }
}
function onClick(id, task) { $(id).addEventListener('click', (event) => action(() => task(event), event.currentTarget)); }
function switchPanel(name) {
  if (!['overview', 'library', 'subscriptions', 'activity', 'settings'].includes(name)) name = 'overview';
  if (compact && !restoringDraft) panelScroll[currentPanel] = document.querySelector('.main').scrollTop;
  currentPanel = name;
  document.querySelectorAll('.panel').forEach((node) => { node.hidden = node.id !== `panel-${name}`; });
  document.querySelectorAll('[data-panel]').forEach((node) => { node.classList.toggle('active', node.dataset.panel === name); node.setAttribute('aria-current', node.dataset.panel === name ? 'page' : 'false'); });
  history.replaceState(null, '', `#${name}`);
  if (compact) document.querySelector('.main').scrollTop = panelScroll[name] || 0;
  saveDraft();
}
function apiConnected() { return typeof state.settings?.accountId === 'string' && /^\d{1,25}$/.test(state.settings.accountId) && !state.settings.sessionInvalid; }
function activeCooldown() { const value = state.apiCooldown; return value && Number.isFinite(value.until) && value.until > Date.now() ? value : null; }
function accountLabel() { const settings = state.settings || {}; return settings.accountHandle ? `@${settings.accountHandle}` : settings.accountId ? `ID ${settings.accountId}` : t('disconnected'); }
function requireApiReady() { if (!apiConnected()) throw new Error(t('apiReconnectRequired')); if (activeCooldown()) throw new Error(t('apiCooldownWait')); }
function localEntries() { return (state.entries || []).filter((entry) => entry.source === 'local'); }
function allowedSet() { return new Set(state.allowlist || []); }
function isOfficialSubscription(sub) { return sub.id === 'guga-official' || sub.url === OFFICIAL_SUBSCRIPTION_URL; }
function entryEnabled(entry) { return entry.status === 'approved' && (entry.source === 'local' || state.subscriptions?.find((sub) => sub.id === entry.source)?.enabled !== false); }
function activeEntries() { return effectiveEntries(state); }
function filteredEntries() {
  const query = $('search').value.trim().toLowerCase();
  const filter = $('status-filter').value;
  const allowed = allowedSet();
  return (state.entries || []).filter((entry) => {
    if (filter === 'allow' && !allowed.has(entry.handle)) return false;
    if (filter === 'local' && entry.source !== 'local') return false;
    if (filter === 'approved' && !entryEnabled(entry)) return false;
    if (filter === 'pending' && entryEnabled(entry)) return false;
    const source = state.subscriptions?.find((sub) => sub.id === entry.source)?.name || '';
    return !query || `${entry.handle} ${entry.reason || ''} ${entry.id || ''} ${source}`.toLowerCase().includes(query);
  }).sort((a,b) => a.handle.localeCompare(b.handle));
}
function render() {
  setLanguage(state.settings?.language || 'en');
  translatePage();
  $('language').value = state.settings?.language || 'en';
  renderOverview(); renderLibrary(); renderSubscriptions(); renderActivity(); renderSettings(); renderConnectionStatus(); renderApiStatus();
  const capture = state.capture || {};
  const details = [t('capturedCount', { count: (capture.entries || []).length })];
  if (capture.status) details.push(t('captureStatus', { status: t(capture.status) }));
  if (capture.message) details.push(capture.message);
  $('capture-status').textContent = details.join(' · ');
  $('capture-import').disabled = !(capture.entries || []).length;
}
function renderConnectionStatus() {
  const connection = state.lastConnection;
  const error = localConnectionError || (connection?.status === 'failed' ? connection.error || t('connectionFailed') : '');
  const waiting = bindingAccount || connection?.status === 'connecting';
  const reconnect = !apiConnected() && Boolean(state.settings?.accountId || state.settings?.accountHandle || state.settings?.sessionInvalid);
  $('connection-error').hidden = !error && !waiting && !reconnect;
  $('connection-error').textContent = error ? `${error} ${t('connectionRetryHelp')}` : waiting ? t('connectionWaiting') : reconnect ? t('apiReconnectRequired') : '';
}
function renderApiStatus() {
  clearTimeout(cooldownTimer);
  const cooldown = activeCooldown();
  $('api-cooldown').hidden = !cooldown;
  if (!cooldown) { $('api-cooldown').textContent = ''; return; }
  const kind = ['rate_limit', 'budget', 'auth', 'network'].includes(cooldown.kind) ? cooldown.kind : 'network';
  $('api-cooldown').textContent = t('apiCooldownNotice', {kind: t(`cooldown_${kind}`), until: dateText(cooldown.until)});
  cooldownTimer = setTimeout(render, Math.min(60000, Math.max(100, cooldown.until - Date.now() + 50)));
}
function renderEnabledCount() {
  const node = $('stat-approved');
  try { node.textContent = activeEntries().length; node.removeAttribute('title'); }
  catch (error) { node.textContent = '—'; node.title = error?.message || String(error); }
}
function renderOverview() {
  const settings = state.settings || {};
  const account = settings.accountHandle;
  const connected = apiConnected();
  const official = state.subscriptions?.find(isOfficialSubscription);
  $('included-list-note').textContent = t(official ? official.enabled === false ? 'includedListDisabled' : 'includedListHelp' : 'chooseListHelp');
  $('account-status').textContent = connected ? accountLabel() : settings.accountId || account ? `${accountLabel()} · ${t('reconnect')}` : t('disconnected');
  $('account-pill').classList.toggle('connected', connected);
  const entries = state.entries || [];
  $('nav-count').textContent = new Set(entries.map((e) => e.handle)).size;
  renderEnabledCount();
  $('stat-subs').textContent = (state.subscriptions || []).filter((s) => s.enabled !== false).length;
  const blocked = settings.accountId ? state.nativeBlocked?.[`id:${settings.accountId}`] : null;
  $('stat-done').textContent = blocked ? Object.keys(blocked).length : new Set((state.queue || []).filter((job) => job.status === 'done' && settings.accountId && job.accountId === settings.accountId).map((job) => job.userId || job.handle)).size;
  $('stat-pending').textContent = localEntries().filter((entry) => entry.status !== 'approved').length;
  const active = (state.queue || []).filter((job) => ['pending', 'running'].includes(job.status));
  const missingIds = (state.queue || []).filter((job) => job.status === 'needs_id').length;
  const paused = state.paused && (active.length > 0 || missingIds > 0);
  const mode = !connected ? 'Off' : paused ? 'Paused' : settings.autoBlock ? 'On' : 'Off';
  $('protection-badge').textContent = t(`protection${mode}`);
  $('protection-title').textContent = t(`protection${mode}Title`);
  $('protection-desc').textContent = t(mode === 'Off' && official && official.enabled !== false ? 'officialReadyDesc' : `protection${mode}Desc`);
  $('hero-action').textContent = !connected ? t(settings.accountId || account ? 'reconnect' : 'connect') : activeCooldown() ? t('viewActivity') : paused ? t('startQueue') : settings.autoBlock ? t('viewActivity') : t('enableAuto');
  $('queue-status').textContent = t(activeCooldown() ? 'queueCooling' : state.paused ? 'queuePaused' : active.length ? 'queueRunning' : missingIds ? 'needs_id' : 'queueIdle');
  $('queue-remaining').textContent = active.length;
  $('queue-message').textContent = [state.pauseReason || (connected ? t('queueHelp') : t('queueNoAccount')), missingIds ? t('needsIdSummary', {count: missingIds}) : ''].filter(Boolean).join(' ');
  $('queue-start').disabled = !connected || !!activeCooldown();
  $('queue-pause').disabled = !!state.paused;
}
function sourceName(entry) { const sub = state.subscriptions?.find((item) => item.id === entry.source); return entry.source === 'local' ? t('sourceLocal') : sub && isOfficialSubscription(sub) ? t('officialList') : sub?.name || t('sourceSubscription'); }
function badge(status, kind = 'queue') {
  const label = kind === 'entry' ? status === 'approved' ? 'entryEnabled' : 'entryDisabled' : status;
  return element('span', t(label), `badge ${status === 'needs_id' ? 'pending' : status}`);
}
function safeLink(url, text, className) {
  try { const parsed = new URL(url); if (!['https:', 'http:'].includes(parsed.protocol)) return null; }
  catch { return null; }
  const anchor = element('a', text, className); anchor.href = url; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; return anchor;
}
function renderLibrary() {
  const entries = filteredEntries();
  page = Math.min(page, Math.max(0, Math.ceil(entries.length / PAGE_SIZE) - 1));
  const slice = entries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const allowed = allowedSet();
  selected = new Set([...selected].filter((handle) => localEntries().some((entry) => entry.handle === handle)));
  const fragment = document.createDocumentFragment();
  for (const entry of slice) {
    const row = element('tr');
    const checkCell = element('td', undefined, 'check-cell');
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.dataset.selectHandle = entry.handle; checkbox.checked = selected.has(entry.handle); checkbox.disabled = entry.source !== 'local'; checkbox.setAttribute('aria-label', entry.source === 'local' ? t('selectAccount', { handle: entry.handle }) : t('readOnlySource')); checkCell.append(checkbox);
    const account = element('td');
    const link = safeLink(`https://x.com/${encodeURIComponent(entry.handle)}`, `@${entry.handle}`, 'account-name'); account.append(link);
    account.append(element('span', entry.id || t('missingNumericId'), 'account-id'));
    const status = element('td'); status.append(badge(entryEnabled(entry) ? 'approved' : 'pending', 'entry'));
    const reason = element('td'); reason.append(element('span', entry.reason || t('noReason'), 'reason-text'));
    const source = element('span', sourceName(entry), 'source-text');
    if (entry.evidence?.length) { const evidenceLink = safeLink(entry.evidence[0], t('evidence'), 'row-source-link'); if (evidenceLink) source.append(evidenceLink); }
    if (entry.source === 'local') { const edit = element('button', t('edit'), 'text-button row-source-link'); edit.dataset.editHandle = entry.handle; source.append(edit); }
    reason.append(source);
    const exception = element('td'); const button = element('button', t(allowed.has(entry.handle) ? 'removeException' : 'allow'), `allow-button${allowed.has(entry.handle) ? ' allowed' : ''}`); button.dataset.allowHandle = entry.handle; button.dataset.allowEnabled = String(!allowed.has(entry.handle)); exception.append(button);
    row.append(checkCell, account, status, reason, exception); fragment.append(row);
  }
  $('accounts-body').replaceChildren(fragment);
  $('library-empty').hidden = entries.length > 0;
  const hasAny = (state.entries || []).length > 0;
  $('library-empty').querySelector('h3').textContent = t(hasAny ? 'noMatches' : 'emptyLibrary');
  $('library-empty').querySelector('p').textContent = t(hasAny ? 'noMatchesDesc' : 'emptyLibraryDesc');
  $('page-info').textContent = t('pageInfo', { start: entries.length ? page * PAGE_SIZE + 1 : 0, end: Math.min((page + 1) * PAGE_SIZE, entries.length), total: entries.length });
  $('prev-page').disabled = page === 0;
  $('next-page').disabled = (page + 1) * PAGE_SIZE >= entries.length;
  const localSlice = slice.filter((entry) => entry.source === 'local');
  $('select-page').disabled = !localSlice.length;
  $('select-page').checked = localSlice.length > 0 && localSlice.every((entry) => selected.has(entry.handle));
  $('select-page').indeterminate = localSlice.some((entry) => selected.has(entry.handle)) && !$('select-page').checked;
  $('selection-bar').hidden = !selected.size;
  $('selected-count').textContent = t('selectedCount', { count: selected.size });
}
function renderSubscriptions() {
  const subscriptions = state.subscriptions || [];
  const nextSync = state.nextAutoSyncAt;
  const nextSyncNote = $('next-auto-sync');
  nextSyncNote.hidden = !Number.isFinite(nextSync) || nextSync <= 0;
  nextSyncNote.textContent = nextSyncNote.hidden ? '' : t('nextAutoSync', {date: dateText(nextSync)});
  const fragment = document.createDocumentFragment();
  for (const sub of subscriptions) {
    const official = isOfficialSubscription(sub);
    const cachedCount = (state.entries || []).filter((entry) => entry.source === sub.id).length;
    const card = element('article', undefined, 'card subscription-item');
    const info = element('div', undefined, 'sub-info');
    info.append(element('h3', official ? t('officialList') : sub.name || sub.url));
    if (official) info.append(element('span', t('officialReadOnly'), 'badge neutral'));
    const link = safeLink(sub.url, sub.url); if (link) info.append(link);
    const meta = element('div', undefined, 'sub-meta'); meta.append(element('span', t('entriesCount', { count: sub.count ?? cachedCount })), element('span', t('lastUpdated', { time: dateText(sub.updatedAt) })), element('span', t(sub.enabled === false ? 'entryDisabled' : 'entryEnabled'))); info.append(meta);
    if (official) info.append(element('p', t('officialSelectionNote'), 'footnote'));
    if (sub.error) { info.append(element('p', sub.error, 'sub-error')); if (cachedCount) info.append(element('p', t('cachedListKept', { count: cachedCount }), 'footnote')); }
    const remove = element('button', t('remove'), 'button secondary small'); remove.dataset.removeSubscription = sub.id;
    card.append(element('div', '↻', 'sub-icon'), info, remove); fragment.append(card);
  }
  $('subscription-list').replaceChildren(fragment); $('subscriptions-empty').hidden = subscriptions.length > 0; $('sync-now').disabled = !subscriptions.length;
}
function renderActivity() {
  const queue = state.queue || [];
  const fragment = document.createDocumentFragment();
  for (const job of [...queue].reverse().slice(0, 200)) {
    const row = element('tr'); const account = element('td'); account.append(safeLink(`https://x.com/${encodeURIComponent(job.handle)}`, `@${job.handle}`, 'account-name'));
    const status = element('td'); status.append(badge(job.status));
    const details = element('td', job.error || (job.status === 'needs_id' ? t('needsIdReason') : '—'), 'muted');
    if (job.status === 'needs_id') {
      if (localEntries().some((entry) => entry.handle === job.handle)) { const edit = element('button', t('addNumericId'), 'text-button row-source-link'); edit.dataset.editHandle = job.handle; details.append(edit); }
      else details.append(element('p', t('needsIdSubscriptionHint'), 'footnote'));
    }
    row.append(account, status, details, element('td', dateText(job.updatedAt), 'muted')); fragment.append(row);
  }
  $('queue-body').replaceChildren(fragment); $('queue-empty').hidden = queue.length > 0; $('queue-count').textContent = t('entriesCount', { count: queue.length });
  const missingIds = queue.filter((job) => job.status === 'needs_id').length;
  $('needs-id-notice').hidden = !missingIds; $('needs-id-notice').textContent = t('needsIdSummary', {count: missingIds});
  $('retry-failed').disabled = !apiConnected() || !!activeCooldown() || !queue.some((job) => ['failed', 'uncertain'].includes(job.status));
  $('activity-start').disabled = !apiConnected() || !!activeCooldown();
  $('activity-pause').disabled = !!state.paused;
  $('queue-approved').disabled = !apiConnected();
  $('pause-notice').hidden = !state.paused || !state.pauseReason; $('pause-notice').textContent = state.pauseReason || '';
  const events = document.createDocumentFragment();
  for (const log of (state.logs || []).slice(0, 100)) {
    const item = element('div', undefined, 'event-item'); const details = element('div'); details.append(element('strong', `${log.handle ? `@${log.handle} · ` : ''}${log.action || ''}`), element('p', log.message || ''));
    item.append(element('span', dateText(log.at)), details); events.append(item);
  }
  $('event-list').replaceChildren(events); $('events-empty').hidden = Boolean(state.logs?.length);
}
function renderSettings() {
  const settings = state.settings || {};
  $('bound-account').textContent = apiConnected() ? settings.accountHandle ? `${accountLabel()} · ID ${settings.accountId}` : accountLabel() : settings.accountHandle || settings.accountId ? `${accountLabel()} · ${t('reconnect')}` : t('none');
  $('bind-account').textContent = t(settings.accountId || settings.accountHandle ? 'reconnect' : 'connect');
  $('auto-block').disabled = !apiConnected() && !settings.autoBlock;
  $('auto-block').checked = Boolean(settings.autoBlock);
  $('hide-content').checked = settings.hideContent !== false;
  if (!intervalDirty && document.activeElement !== $('interval')) $('interval').value = settings.intervalSeconds || 30;
  $('interval').min = '30';
  $('allow-count').textContent = (state.allowlist || []).length;
  const chips = document.createDocumentFragment();
  for (const handle of state.allowlist || []) { const chip = element('span', `@${handle}`, 'allow-chip'); const button = element('button', '×'); button.dataset.removeAllow = handle; button.setAttribute('aria-label', `${t('removeException')} @${handle}`); chip.append(button); chips.append(chip); }
  if (!state.allowlist?.length) chips.append(element('span', t('noExceptions'), 'muted'));
  $('allow-chips').replaceChildren(chips);
}
function showImport() { switchPanel('library'); $('import-card').hidden = false; $('import-text').focus(); saveDraft(); }
function previewImport() {
  const text = $('import-text').value.trim();
  if (!text) throw new Error(t('importEmpty'));
  const parsed = parseImport(text);
  const handles = parsed.entries.map((entry) => entry.handle);
  $('import-preview').textContent = [t('previewSummary', { count: handles.length }), handles.slice(0, 20).map((handle) => `@${handle}`).join('  ·  '), handles.length > 20 ? t('previewLimited', { count: 20 }) : ''].filter(Boolean).join('\n\n');
  $('import-preview').hidden = false;
  return parsed;
}
async function exportList(kind) {
  if (!['private', 'csv'].includes(kind)) throw new Error(t('privateExportOnly'));
  const result = await request('EXPORT', { kind });
  const blob = new Blob([result.text], { type: result.mime || 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = element('a'); link.href = url; link.download = result.filename || `guga-blocklist-${kind}.json`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000); toast(t('downloadReady'));
}
async function startQueue() { requireApiReady(); await request('QUEUE_APPROVED'); await request('START_QUEUE'); toast(t('queueStarted')); }
async function pauseQueue() { await request('PAUSE_QUEUE'); toast(t('queuePausedToast')); }
async function bindAccount() {
  if (bindingAccount) return;
  bindingAccount = true; localConnectionError = ''; renderConnectionStatus();
  try {
    const result = await request('BIND_ACCOUNT');
    localConnectionError = '';
    toast(t('bindSuccess', { handle: result.state?.settings?.accountHandle || state.settings?.accountHandle }));
  } catch (error) {
    localConnectionError = error?.message || String(error);
    throw error;
  } finally { bindingAccount = false; renderConnectionStatus(); saveDraft(); }
}
async function updateSelection(status) { if (!selected.size) throw new Error(t('selectedRequired')); await request('REVIEW', { handles: [...selected], status }); selected.clear(); renderLibrary(); toast(t(status === 'approved' ? 'approvedSuccess' : 'disabledSuccess')); }
function editEntry(handle) {
  const entry = localEntries().find((value) => value.handle === handle); if (!entry) return;
  editingHandle = handle; $('edit-account').textContent = `@${handle}`; $('edit-id').value = entry.id || ''; $('edit-reason').value = entry.reason || ''; $('edit-evidence').value = (entry.evidence || []).join('\n'); $('entry-dialog').showModal(); $('edit-reason').focus(); saveDraft();
}

document.querySelectorAll('[data-panel]').forEach((node) => node.addEventListener('click', () => switchPanel(node.dataset.panel)));
document.querySelectorAll('[data-go]').forEach((node) => node.addEventListener('click', () => { if (node.dataset.go === 'library' && node.classList.contains('primary')) showImport(); else switchPanel(node.dataset.go); }));
onClick('show-import', showImport); onClick('close-import', () => { $('import-card').hidden = true; });
onClick('preview-import', previewImport);
onClick('confirm-import', async () => { const text = $('import-text').value.trim(); if (!text) throw new Error(t('importEmpty')); previewImport(); const result = await request('IMPORT', { text, format: 'auto' }); toast(t('importSuccess', { count: result.imported ?? 0, updated: result.updated ?? 0, duplicates: (result.duplicates ?? 0) + (result.fileDuplicates ?? 0) })); $('import-text').value = ''; $('import-file').value = ''; $('file-name').textContent = ''; $('import-preview').hidden = true; $('import-card').hidden = true; $('status-filter').value = 'all'; $('search').value = ''; selected.clear(); page = 0; renderLibrary(); });
$('import-file').addEventListener('change', () => action(async () => { const file = $('import-file').files?.[0]; if (!file) return; if (file.size > 4 * 1024 * 1024) throw new Error(t('fileTooLarge')); $('import-text').value = await file.text(); $('file-name').textContent = file.name; previewImport(); saveDraft(); }));
$('import-text').addEventListener('input', () => { $('import-preview').hidden = true; });
$('search').addEventListener('input', () => { page = 0; renderLibrary(); });
$('status-filter').addEventListener('change', () => { page = 0; renderLibrary(); });
onClick('prev-page', () => { page--; renderLibrary(); }); onClick('next-page', () => { page++; renderLibrary(); });
$('select-page').addEventListener('change', () => { const checked = $('select-page').checked; for (const entry of filteredEntries().slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).filter((e) => e.source === 'local')) { if (checked) selected.add(entry.handle); else selected.delete(entry.handle); } renderLibrary(); });
$('accounts-body').addEventListener('change', (event) => { const checkbox = event.target.closest('[data-select-handle]'); if (!checkbox || checkbox.disabled) return; if (checkbox.checked) selected.add(checkbox.dataset.selectHandle); else selected.delete(checkbox.dataset.selectHandle); renderLibrary(); });
$('accounts-body').addEventListener('click', (event) => { const button = event.target.closest('[data-allow-handle]'); if (button) action(async () => { await request('ALLOW', { handle: button.dataset.allowHandle, enabled: button.dataset.allowEnabled === 'true' }); toast(t(button.dataset.allowEnabled === 'true' ? 'saved' : 'exceptionRemoved')); }, button); const edit = event.target.closest('[data-edit-handle]'); if (edit) editEntry(edit.dataset.editHandle); });
onClick('approve-selected', () => updateSelection('approved')); onClick('pending-selected', () => updateSelection('pending')); onClick('clear-selection', () => { selected.clear(); renderLibrary(); });
onClick('remove-selected', async () => { if (!selected.size) throw new Error(t('selectedRequired')); await request('REMOVE_ENTRIES', { handles: [...selected] }); selected.clear(); renderLibrary(); toast(t('removed')); });
onClick('export-list', () => exportList($('export-kind').value));
onClick('capture-start', async () => { await request('CAPTURE', { autoScroll: $('auto-scroll').checked }); toast(t('captureStarted')); });
onClick('capture-stop', async () => { await request('STOP_CAPTURE'); toast(t('captureStopped')); });
onClick('capture-import', async () => { const result = await request('IMPORT_CAPTURE'); toast(t('importSuccess', { count: result.imported ?? 0, updated: result.updated ?? 0, duplicates: (result.duplicates ?? 0) + (result.fileDuplicates ?? 0) })); $('status-filter').value = 'all'; $('search').value = ''; selected.clear(); page = 0; renderLibrary(); });
$('subscription-form').addEventListener('submit', (event) => { event.preventDefault(); action(async () => {
  const url = $('sub-url').value.trim(); let parsed; try { parsed = new URL(url); } catch { throw new Error(t('badRawUrl')); }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'raw.githubusercontent.com' || parsed.username || parsed.password || parsed.port) throw new Error(t('badRawUrl'));
  await request('ADD_SUBSCRIPTION', { url, name: $('sub-name').value.trim() }); $('sub-name').value = ''; $('sub-url').value = ''; toast(t('subscribed'));
}, event.submitter); });
onClick('sync-now', async () => { await request('SYNC'); toast(t('syncSuccess')); });
$('subscription-list').addEventListener('click', (event) => { const button = event.target.closest('[data-remove-subscription]'); if (button) action(async () => { await request('REMOVE_SUBSCRIPTION', { id: button.dataset.removeSubscription }); toast(t('subscriptionRemoved')); }, button); });
$('queue-body').addEventListener('click', (event) => { const edit = event.target.closest('[data-edit-handle]'); if (edit) { switchPanel('library'); $('search').value = edit.dataset.editHandle; $('status-filter').value = 'local'; page = 0; renderLibrary(); editEntry(edit.dataset.editHandle); } });
onClick('queue-start', startQueue); onClick('activity-start', startQueue); onClick('queue-pause', pauseQueue); onClick('activity-pause', pauseQueue);
onClick('queue-approved', async () => { await request('QUEUE_APPROVED'); toast(t('queueAdded')); });
onClick('retry-failed', async () => { requireApiReady(); await request('RETRY_FAILED'); toast(t('retryQueued')); });
onClick('bind-account', bindAccount);
onClick('hero-action', async () => { if (!apiConnected()) { await bindAccount(); switchPanel('settings'); } else if (activeCooldown()) switchPanel('activity'); else if (state.paused && state.queue?.some((job) => ['pending','running'].includes(job.status))) await startQueue(); else if (state.settings.autoBlock) switchPanel('activity'); else { await request('SAVE_SETTINGS', { settings: { autoBlock: true } }); toast(t('autoEnabled')); } });
$('language').addEventListener('change', () => action(async () => { await request('SAVE_SETTINGS', { settings: { language: $('language').value } }); }));
$('auto-block').addEventListener('change', () => action(async () => { const enabled = $('auto-block').checked; if (enabled && !apiConnected()) throw new Error(t('apiReconnectRequired')); await request('SAVE_SETTINGS', { settings: { autoBlock: enabled } }); toast(t(enabled ? 'autoEnabled' : 'autoDisabled')); }));
$('hide-content').addEventListener('change', () => action(async () => { await request('SAVE_SETTINGS', { settings: { hideContent: $('hide-content').checked } }); toast(t('saved')); }));
onClick('save-interval', async () => { const value = Number($('interval').value); if (!Number.isInteger(value) || value < 30 || value > 300) throw new Error(t('intervalInvalid')); await request('SAVE_SETTINGS', { settings: { intervalSeconds: value } }); intervalDirty = false; toast(t('saved')); });
$('allow-form').addEventListener('submit', (event) => { event.preventDefault(); action(async () => { await request('ALLOW', { handle: $('allow-handle').value, enabled: true }); $('allow-handle').value = ''; toast(t('saved')); }, event.submitter); });
$('allow-chips').addEventListener('click', (event) => { const button = event.target.closest('[data-remove-allow]'); if (button) action(async () => { await request('ALLOW', { handle: button.dataset.removeAllow, enabled: false }); toast(t('exceptionRemoved')); }, button); });
onClick('close-editor', () => $('entry-dialog').close()); onClick('cancel-editor', () => $('entry-dialog').close());
$('entry-form').addEventListener('submit', (event) => {
  event.preventDefault();
  action(async () => {
    const id = $('edit-id').value.trim();
    const previous = localEntries().find((entry) => entry.handle === editingHandle);
    if (id && !/^\d{1,25}$/.test(id)) throw new Error(t('numericIdInvalid'));
    if (!id && previous?.id) throw new Error(t('numericIdRequired'));
    const identityChanged = Boolean(previous?.id && previous.id !== id);
    await request('EDIT_ENTRY', { handle: editingHandle, id, reason: $('edit-reason').value, evidence: $('edit-evidence').value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean) });
    $('entry-dialog').close();
    if (identityChanged) { $('status-filter').value = 'all'; page = 0; renderLibrary(); }
    toast(t(identityChanged ? 'idCorrectionDisabled' : 'saved'));
  }, event.submitter);
});
if (globalThis.chrome?.storage?.onChanged) chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.state?.newValue) { state = changes.state.newValue; render(); } });
window.addEventListener('hashchange', () => switchPanel(location.hash.slice(1)));
switchPanel(requestedPanel);
if (compact) {
  document.addEventListener('input', (event) => { if (event.target.id === 'interval') intervalDirty = true; saveDraft(); });
  document.addEventListener('change', saveDraft);
  document.addEventListener('click', (event) => { if (event.target.closest('a[target="_blank"]')) saveDraft(); });
  document.querySelector('.main').addEventListener('scroll', () => { panelScroll[currentPanel] = document.querySelector('.main').scrollTop; clearTimeout(scrollSaveTimer); scrollSaveTimer = setTimeout(saveDraft, 150); }, {passive: true});
  $('entry-dialog').addEventListener('close', () => { editingHandle = ''; saveDraft(); });
  window.addEventListener('pagehide', saveDraft);
}
action(async () => {
  const draft = await readDraft();
  await request('GET_STATE');
  restoreDraft(draft);
}).finally(() => {
  restoringDraft = false;
  if (compact) document.querySelector('.app-shell').inert = false;
  if (draftWarningShown) toast(t('draftSaveError'), true);
});
