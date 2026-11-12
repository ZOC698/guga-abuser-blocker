import { parseImport } from './lib/core.js';
import { t, setLanguage, translatePage, dateText } from './lib/i18n.js';

const $ = (id) => document.getElementById(id);
const PAGE_SIZE = 50;
let state = { settings: {}, entries: [], subscriptions: [], allowlist: [], queue: [], logs: [], capture: { entries: [] } };
let page = 0;
let selected = new Set();
let currentPanel = 'overview';
let editingHandle = '';
let toastTimer;

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
  if (button?.disabled) return;
  if (button) button.disabled = true;
  try { return await task(); }
  catch (error) { toast(error?.message || String(error), true); renderSettings(); }
  finally { if (button) { button.disabled = false; render(); } }
}
function onClick(id, task) { $(id).addEventListener('click', (event) => action(() => task(event), event.currentTarget)); }
function switchPanel(name) {
  if (!['overview', 'library', 'subscriptions', 'activity', 'settings'].includes(name)) name = 'overview';
  currentPanel = name;
  document.querySelectorAll('.panel').forEach((node) => { node.hidden = node.id !== `panel-${name}`; });
  document.querySelectorAll('[data-panel]').forEach((node) => { node.classList.toggle('active', node.dataset.panel === name); node.setAttribute('aria-current', node.dataset.panel === name ? 'page' : 'false'); });
  history.replaceState(null, '', `#${name}`);
}
function localEntries() { return (state.entries || []).filter((entry) => entry.source === 'local'); }
function allowedSet() { return new Set(state.allowlist || []); }
function activeEntries() { const allowed = allowedSet(); return (state.entries || []).filter((entry) => entry.status === 'approved' && !allowed.has(entry.handle)); }
function filteredEntries() {
  const query = $('search').value.trim().toLowerCase();
  const filter = $('status-filter').value;
  const allowed = allowedSet();
  return (state.entries || []).filter((entry) => {
    if (filter === 'allow' && !allowed.has(entry.handle)) return false;
    if (filter === 'local' && entry.source !== 'local') return false;
    if (['pending', 'approved'].includes(filter) && entry.status !== filter) return false;
    const source = state.subscriptions?.find((sub) => sub.id === entry.source)?.name || '';
    return !query || `${entry.handle} ${entry.reason || ''} ${entry.id || ''} ${source}`.toLowerCase().includes(query);
  }).sort((a,b) => a.handle.localeCompare(b.handle));
}
function render() {
  setLanguage(state.settings?.language || 'en');
  translatePage();
  $('language').value = state.settings?.language || 'en';
  renderOverview(); renderLibrary(); renderSubscriptions(); renderActivity(); renderSettings();
  const capture = state.capture || {};
  const details = [t('capturedCount', { count: (capture.entries || []).length })];
  if (capture.status) details.push(t('captureStatus', { status: t(capture.status) }));
  if (capture.message) details.push(capture.message);
  $('capture-status').textContent = details.join(' · ');
  $('capture-import').disabled = !(capture.entries || []).length;
}
function renderOverview() {
  const settings = state.settings || {};
  const account = settings.accountHandle;
  $('account-status').textContent = account ? `@${account}` : t('disconnected');
  $('account-pill').classList.toggle('connected', Boolean(account));
  const entries = state.entries || [];
  $('nav-count').textContent = new Set(entries.map((e) => e.handle)).size;
  $('stat-approved').textContent = new Set(activeEntries().map((e) => e.handle)).size;
  $('stat-subs').textContent = (state.subscriptions || []).filter((s) => s.enabled !== false).length;
  const blocked = state.nativeBlocked?.[account];
  $('stat-done').textContent = blocked ? Object.keys(blocked).length : new Set((state.queue || []).filter((job) => job.status === 'done' && job.accountHandle === account).map((job) => job.handle)).size;
  $('stat-pending').textContent = localEntries().filter((entry) => entry.status !== 'approved').length;
  const active = (state.queue || []).filter((job) => ['pending', 'running'].includes(job.status));
  const paused = state.paused && active.length > 0;
  const mode = paused ? 'Paused' : settings.autoBlock ? 'On' : 'Off';
  $('protection-badge').textContent = t(`protection${mode}`);
  $('protection-title').textContent = t(`protection${mode}Title`);
  $('protection-desc').textContent = t(`protection${mode}Desc`);
  $('hero-action').textContent = !account ? t('connect') : paused ? t('startQueue') : settings.autoBlock ? t('viewActivity') : t('enableAuto');
  $('queue-status').textContent = t(state.paused ? 'queuePaused' : active.length ? 'queueRunning' : 'queueIdle');
  $('queue-remaining').textContent = active.length;
  $('queue-message').textContent = state.pauseReason || (account ? t('queueHelp') : t('queueNoAccount'));
  $('queue-start').disabled = !account;
  $('queue-pause').disabled = !!state.paused;
}
function sourceName(entry) { return entry.source === 'local' ? t('sourceLocal') : state.subscriptions?.find((sub) => sub.id === entry.source)?.name || t('sourceSubscription'); }
function badge(status) { return element('span', t(status), `badge ${status}`); }
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
    if (entry.id) account.append(element('span', entry.id, 'account-id'));
    const status = element('td'); status.append(badge(entry.status || 'pending'));
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
  const fragment = document.createDocumentFragment();
  for (const sub of subscriptions) {
    const card = element('article', undefined, 'card subscription-item');
    const info = element('div', undefined, 'sub-info'); info.append(element('h3', sub.name || sub.url));
    const link = safeLink(sub.url, sub.url); if (link) info.append(link);
    const meta = element('div', undefined, 'sub-meta'); meta.append(element('span', t('entriesCount', { count: sub.count ?? (state.entries || []).filter((entry) => entry.source === sub.id).length })), element('span', t('lastUpdated', { time: dateText(sub.updatedAt) }))); info.append(meta);
    if (sub.error) info.append(element('p', sub.error, 'sub-error'));
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
    row.append(account, status, element('td', job.error || '—', 'muted'), element('td', dateText(job.updatedAt), 'muted')); fragment.append(row);
  }
  $('queue-body').replaceChildren(fragment); $('queue-empty').hidden = queue.length > 0; $('queue-count').textContent = t('entriesCount', { count: queue.length });
  $('retry-failed').disabled = !queue.some((job) => ['failed', 'uncertain'].includes(job.status));
  $('activity-start').disabled = !state.settings?.accountHandle;
  $('activity-pause').disabled = !!state.paused;
  $('queue-approved').disabled = !state.settings?.accountHandle;
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
  $('bound-account').textContent = settings.accountHandle ? `@${settings.accountHandle}` : t('none');
  $('auto-block').checked = Boolean(settings.autoBlock);
  $('hide-content').checked = settings.hideContent !== false;
  if (document.activeElement !== $('interval')) $('interval').value = settings.intervalSeconds || 30;
  $('interval').min = '30';
  $('allow-count').textContent = (state.allowlist || []).length;
  const chips = document.createDocumentFragment();
  for (const handle of state.allowlist || []) { const chip = element('span', `@${handle}`, 'allow-chip'); const button = element('button', '×'); button.dataset.removeAllow = handle; button.setAttribute('aria-label', `${t('removeException')} @${handle}`); chip.append(button); chips.append(chip); }
  if (!state.allowlist?.length) chips.append(element('span', t('noExceptions'), 'muted'));
  $('allow-chips').replaceChildren(chips);
}
function showImport() { switchPanel('library'); $('import-card').hidden = false; $('import-text').focus(); }
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
async function startQueue() { await request('QUEUE_APPROVED'); await request('START_QUEUE'); toast(t('queueStarted')); }
async function pauseQueue() { await request('PAUSE_QUEUE'); toast(t('queuePausedToast')); }
async function bindAccount() { const result = await request('BIND_ACCOUNT'); toast(t('bindSuccess', { handle: result.state?.settings?.accountHandle || state.settings?.accountHandle })); }
async function updateSelection(status) { if (!selected.size) throw new Error(t('selectedRequired')); await request('REVIEW', { handles: [...selected], status }); selected.clear(); renderLibrary(); toast(t(status === 'approved' ? 'approvedSuccess' : 'updatedSuccess')); }
function editEntry(handle) {
  const entry = localEntries().find((value) => value.handle === handle); if (!entry) return;
  editingHandle = handle; $('edit-account').textContent = `@${handle}`; $('edit-id').value = entry.id || ''; $('edit-reason').value = entry.reason || ''; $('edit-evidence').value = (entry.evidence || []).join('\n'); $('entry-dialog').showModal(); $('edit-reason').focus();
}

document.querySelectorAll('[data-panel]').forEach((node) => node.addEventListener('click', () => switchPanel(node.dataset.panel)));
document.querySelectorAll('[data-go]').forEach((node) => node.addEventListener('click', () => { if (node.dataset.go === 'library' && node.classList.contains('primary')) showImport(); else switchPanel(node.dataset.go); }));
onClick('show-import', showImport); onClick('close-import', () => { $('import-card').hidden = true; });
onClick('preview-import', previewImport);
onClick('confirm-import', async () => { const text = $('import-text').value.trim(); if (!text) throw new Error(t('importEmpty')); previewImport(); const result = await request('IMPORT', { text, format: 'auto', approve: false }); toast(t('importSuccess', { count: result.imported ?? 0, updated: result.updated ?? 0, duplicates: (result.duplicates ?? 0) + (result.fileDuplicates ?? 0) })); $('import-text').value = ''; $('import-file').value = ''; $('file-name').textContent = ''; $('import-preview').hidden = true; $('import-card').hidden = true; $('status-filter').value = result.updated ? 'all' : 'pending'; page = 0; renderLibrary(); });
$('import-file').addEventListener('change', () => action(async () => { const file = $('import-file').files?.[0]; if (!file) return; if (file.size > 4 * 1024 * 1024) throw new Error(t('fileTooLarge')); $('import-text').value = await file.text(); $('file-name').textContent = file.name; previewImport(); }));
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
onClick('capture-import', async () => { const result = await request('IMPORT_CAPTURE'); toast(t('importSuccess', { count: result.imported ?? 0, updated: result.updated ?? 0, duplicates: (result.duplicates ?? 0) + (result.fileDuplicates ?? 0) })); });
$('subscription-form').addEventListener('submit', (event) => { event.preventDefault(); action(async () => {
  const url = $('sub-url').value.trim(); let parsed; try { parsed = new URL(url); } catch { throw new Error(t('badRawUrl')); }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'raw.githubusercontent.com' || parsed.username || parsed.password || parsed.port) throw new Error(t('badRawUrl'));
  const granted = await chrome.permissions.request({ origins: ['https://raw.githubusercontent.com/*'] });
  if (!granted) throw new Error(t('permissionsDenied'));
  await request('ADD_SUBSCRIPTION', { url, name: $('sub-name').value.trim() }); $('sub-name').value = ''; $('sub-url').value = ''; toast(t('subscribed'));
}, event.submitter); });
onClick('sync-now', async () => { await request('SYNC'); toast(t('syncSuccess')); });
$('subscription-list').addEventListener('click', (event) => { const button = event.target.closest('[data-remove-subscription]'); if (button) action(async () => { await request('REMOVE_SUBSCRIPTION', { id: button.dataset.removeSubscription }); toast(t('subscriptionRemoved')); }, button); });
onClick('queue-start', startQueue); onClick('activity-start', startQueue); onClick('queue-pause', pauseQueue); onClick('activity-pause', pauseQueue);
onClick('queue-approved', async () => { await request('QUEUE_APPROVED'); toast(t('queueAdded')); });
onClick('retry-failed', async () => { await request('RETRY_FAILED'); toast(t('retryQueued')); });
onClick('bind-account', bindAccount);
onClick('hero-action', async () => { if (!state.settings?.accountHandle) { await bindAccount(); switchPanel('settings'); } else if (state.paused && state.queue?.some((job) => ['pending','running'].includes(job.status))) await startQueue(); else if (state.settings.autoBlock) switchPanel('activity'); else { await request('SAVE_SETTINGS', { settings: { autoBlock: true } }); toast(t('autoEnabled')); } });
$('language').addEventListener('change', () => action(async () => { await request('SAVE_SETTINGS', { settings: { language: $('language').value } }); }));
$('auto-block').addEventListener('change', () => action(async () => { const enabled = $('auto-block').checked; await request('SAVE_SETTINGS', { settings: { autoBlock: enabled } }); toast(t(enabled ? 'autoEnabled' : 'autoDisabled')); }));
$('hide-content').addEventListener('change', () => action(async () => { await request('SAVE_SETTINGS', { settings: { hideContent: $('hide-content').checked } }); toast(t('saved')); }));
onClick('save-interval', async () => { const value = Number($('interval').value); if (!Number.isInteger(value) || value < 30 || value > 300) throw new Error(t('intervalInvalid')); await request('SAVE_SETTINGS', { settings: { intervalSeconds: value } }); toast(t('saved')); });
$('allow-form').addEventListener('submit', (event) => { event.preventDefault(); action(async () => { await request('ALLOW', { handle: $('allow-handle').value, enabled: true }); $('allow-handle').value = ''; toast(t('saved')); }, event.submitter); });
$('allow-chips').addEventListener('click', (event) => { const button = event.target.closest('[data-remove-allow]'); if (button) action(async () => { await request('ALLOW', { handle: button.dataset.removeAllow, enabled: false }); toast(t('exceptionRemoved')); }, button); });
onClick('close-editor', () => $('entry-dialog').close()); onClick('cancel-editor', () => $('entry-dialog').close());
$('entry-form').addEventListener('submit', (event) => { event.preventDefault(); action(async () => { const id = $('edit-id').value.trim(); if (id && !/^\d{1,25}$/.test(id)) throw new Error(t('numericIdInvalid')); if (!id && localEntries().find((entry) => entry.handle === editingHandle)?.id) throw new Error(t('numericIdRequired')); await request('EDIT_ENTRY', { handle: editingHandle, id, reason: $('edit-reason').value, evidence: $('edit-evidence').value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean) }); $('entry-dialog').close(); toast(t('saved')); }, event.submitter); });
if (globalThis.chrome?.storage?.onChanged) chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.state?.newValue) { state = changes.state.newValue; render(); } });
window.addEventListener('hashchange', () => switchPanel(location.hash.slice(1)));
switchPanel(location.hash.slice(1));
action(async () => { await request('GET_STATE'); });
