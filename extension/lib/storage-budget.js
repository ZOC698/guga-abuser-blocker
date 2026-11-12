// Leave room below Chrome's 10 MiB quota for durable operation/error records.
export const STATE_BUDGET = 8 * 1024 * 1024;
export const RECOVERY_BUDGET = 9 * 1024 * 1024;
export function stateBytes(state) {
  return new TextEncoder().encode(JSON.stringify(state)).length + 'state'.length;
}
export function prepareStorage(state, {critical = false} = {}) {
  state.logs = (state.logs || []).slice(0, 500);
  const terminal = new Set(['done', 'skipped']);
  let remainingHistory = 1000;
  state.queue = [...state.queue].reverse().filter(job => !terminal.has(job.status) || remainingHistory-- > 0).reverse();
  const limit = critical ? RECOVERY_BUDGET : STATE_BUDGET;
  if (stateBytes(state) > limit) {
    // Only expendable history is trimmed. Never drop entries, captures or active jobs.
    state.logs = state.logs.slice(0, 50);
    remainingHistory = 100;
    state.queue = [...state.queue].reverse().filter(job => !terminal.has(job.status) || remainingHistory-- > 0).reverse();
  }
  if (stateBytes(state) > limit) {
    const error=new Error('Combined local data is too large. The previous data was kept. Export a private backup and remove unused subscriptions or local entries.');
    error.code='STORAGE_BUDGET';throw error;
  }
  return state;
}
