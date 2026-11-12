import { t, setLanguage, translatePage } from './lib/i18n.js';
const $ = (id) => document.getElementById(id);
let state;
function render(value) {
  state = value;
  setLanguage(state.settings?.language || 'en'); translatePage();
  const mode = state.paused && state.queue?.some((job) => ['pending','running'].includes(job.status)) ? 'Paused' : state.settings?.autoBlock ? 'On' : 'Off';
  $('popup-badge').textContent = t(`protection${mode}`);
  $('popup-status').textContent = state.pauseReason || t(`protection${mode}Desc`);
  const allowed = new Set(state.allowlist || []);
  $('popup-approved').textContent = new Set((state.entries || []).filter((entry) => entry.status === 'approved' && !allowed.has(entry.handle)).map((entry) => entry.handle)).size;
  $('popup-waiting').textContent = (state.queue || []).filter((job) => ['pending','running'].includes(job.status)).length;
  $('popup-account').textContent = state.settings?.accountHandle ? `@${state.settings.accountHandle}` : t('disconnected');
  $('popup-resume').disabled = !state.settings?.accountHandle;
  $('popup-pause').disabled = !!state.paused;
}
async function request(type) { const response = await chrome.runtime.sendMessage({ type }); if (!response?.ok) throw new Error(response?.error || t('extensionUnavailable')); if (response.state) render(response.state); return response; }
async function run(task) { try { $('popup-error').hidden = true; await task(); } catch (error) { $('popup-error').textContent = error.message || String(error); $('popup-error').hidden = false; } }
$('open-dashboard').addEventListener('click', () => run(() => chrome.runtime.openOptionsPage()));
$('popup-resume').addEventListener('click', () => run(async () => { await request('QUEUE_APPROVED'); await request('START_QUEUE'); }));
$('popup-pause').addEventListener('click', () => run(() => request('PAUSE_QUEUE')));
if (globalThis.chrome?.storage?.onChanged) chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.state?.newValue) render(changes.state.newValue); });
run(() => request('GET_STATE'));
