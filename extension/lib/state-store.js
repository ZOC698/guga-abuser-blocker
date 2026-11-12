// Application-level encryption, not an operating-system key vault. A
// non-extractable key prevents export through Web Crypto; the browser still
// controls its persistent representation. This does not protect a compromised
// extension context or promise protection against theft of an entire profile.
export const STATE_DATABASE = 'gab-encrypted-state';
export const STATE_OBJECT_STORE = 'vault';
export const STATE_REVISION_KEY = 'gabStateRevision';
const FORMAT = 'gab-state/aes-gcm-v1';
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', {fatal: true});

export class StateStorageError extends Error {
  constructor(message = 'Encrypted local data is unavailable. Reload the extension; do not clear its data.') {
    super(message); this.name = 'StateStorageError'; this.code = 'STATE_STORAGE';
  }
}
const failure = () => new StateStorageError();
const validState = state => state && typeof state === 'object' && !Array.isArray(state);
const validRevision = revision => Number.isSafeInteger(revision) && revision > 0;
const aad = revision => encoder.encode(`${FORMAT}:${revision}`);

export function createStateStore({initialState, legacyStorage = globalThis.chrome?.storage?.local,
  indexedDB = globalThis.indexedDB, crypto = globalThis.crypto, dbName = STATE_DATABASE} = {}) {
  let database, opening, initialization, writes = Promise.resolve();

  function open() {
    if (database) return Promise.resolve(database);
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      if (!indexedDB?.open || !crypto?.subtle || !legacyStorage?.get || !legacyStorage?.set || !legacyStorage?.remove) {
        reject(failure()); return;
      }
      let request, settled = false;
      const finish = (error, db) => {
        if (settled) { db?.close(); return; }
        settled = true; clearTimeout(timer);
        if (error) reject(failure());
        else { database = db; db.onversionchange = () => { db.close(); database = undefined; opening = undefined; }; resolve(db); }
      };
      const timer = setTimeout(() => finish(failure()), 10000);
      try { request = indexedDB.open(dbName, 1); } catch { finish(failure()); return; }
      request.onupgradeneeded = () => {
        if (settled) { request.transaction.abort(); return; }
        if (!request.result.objectStoreNames.contains(STATE_OBJECT_STORE)) request.result.createObjectStore(STATE_OBJECT_STORE);
      };
      request.onsuccess = () => finish(null, request.result);
      request.onerror = request.onblocked = () => finish(failure());
    });
    return opening;
  }

  async function records() {
    const db = await open();
    return new Promise((resolve, reject) => {
      let tx, key, envelope;
      try {
        tx = db.transaction(STATE_OBJECT_STORE, 'readonly');
        const store = tx.objectStore(STATE_OBJECT_STORE);
        store.get('key').onsuccess = event => { key = event.target.result; };
        store.get('state').onsuccess = event => { envelope = event.target.result; };
      } catch { reject(failure()); return; }
      tx.oncomplete = () => resolve({key, envelope});
      tx.onerror = tx.onabort = () => reject(failure());
    });
  }

  async function decrypt({key, envelope}) {
    try {
      if (!key || key.type !== 'secret' || key.extractable !== false || key.algorithm?.name !== 'AES-GCM' ||
          key.algorithm.length !== 256 || !key.usages?.includes('encrypt') || !key.usages?.includes('decrypt') ||
          !envelope || envelope.format !== FORMAT || !validRevision(envelope.revision) ||
          !(envelope.iv instanceof Uint8Array) || envelope.iv.byteLength !== 12 ||
          !(envelope.ciphertext instanceof ArrayBuffer) || envelope.ciphertext.byteLength < 16) throw failure();
      const plaintext = await crypto.subtle.decrypt({name: 'AES-GCM', iv: envelope.iv,
        additionalData: aad(envelope.revision), tagLength: 128}, key, envelope.ciphertext);
      const state = JSON.parse(decoder.decode(plaintext));
      if (!validState(state)) throw failure();
      return state;
    } catch { throw failure(); }
  }

  async function encrypt(state, key, revision) {
    try {
      if (!validState(state) || !validRevision(revision)) throw failure();
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt({name: 'AES-GCM', iv,
        additionalData: aad(revision), tagLength: 128}, key, encoder.encode(JSON.stringify(state)));
      return {format: FORMAT, revision, iv, ciphertext};
    } catch { throw failure(); }
  }

  // Key creation and its first ciphertext commit together. Later writes compare
  // revisions inside the transaction, so competing instances cannot overwrite a
  // newer encrypted record with an earlier revision.
  async function commit(key, envelope, expectedRevision) {
    const db = await open();
    return new Promise((resolve, reject) => {
      let tx;
      try {
        tx = db.transaction(STATE_OBJECT_STORE, 'readwrite', {durability: 'strict'});
        const store = tx.objectStore(STATE_OBJECT_STORE);
        const request = store.get('state');
        request.onsuccess = () => {
          try {
            const previous = request.result;
            if ((expectedRevision === 0 && previous !== undefined) ||
                (expectedRevision !== 0 && previous?.revision !== expectedRevision)) { tx.abort(); return; }
            if (expectedRevision === 0) store.put(key, 'key');
            store.put(envelope, 'state');
          } catch { try { tx.abort(); } catch { reject(failure()); } }
        };
      } catch { reject(failure()); return; }
      tx.oncomplete = resolve;
      tx.onerror = tx.onabort = () => reject(failure());
    });
  }

  async function signal(revision) {
    try { await legacyStorage.set({[STATE_REVISION_KEY]: revision}); }
    catch { throw failure(); }
  }

  async function initialize() {
    if (initialization) return initialization;
    initialization = (async () => {
      try {
        const legacy = await legacyStorage.get(['state', STATE_REVISION_KEY]);
        let saved = await records();
        if (saved.key !== undefined || saved.envelope !== undefined) {
          // Existing encrypted data is always authoritative. Never recover a
          // missing key, corrupt ciphertext or unknown format from stale state.
          await decrypt(saved);
        } else {
          if (legacy[STATE_REVISION_KEY] !== undefined) throw failure();
          const hasLegacy = Object.hasOwn(legacy, 'state');
          const state = hasLegacy ? legacy.state : initialState?.();
          if (!validState(state)) throw failure();
          const key = await crypto.subtle.generateKey({name: 'AES-GCM', length: 256}, false, ['encrypt', 'decrypt']);
          const envelope = await encrypt(state, key, 1);
          await commit(key, envelope, 0);
          saved = await records();
          // Verify the committed representation before deleting any old data.
          await decrypt(saved);
        }
        await signal(saved.envelope.revision);
        // These stores have no shared transaction. If cleanup fails, retain the
        // encrypted authority and fail closed. A later reload retries cleanup.
        if (Object.hasOwn(legacy, 'state')) await legacyStorage.remove('state');
      } catch { throw failure(); }
    })();
    return initialization;
  }

  return {
    async read() { await initialize(); return decrypt(await records()); },
    write(state) {
      const operation = writes.then(async () => {
        await initialize();
        const saved = await records();
        await decrypt(saved);
        const envelope = await encrypt(state, saved.key, saved.envelope.revision + 1);
        await commit(saved.key, envelope, saved.envelope.revision);
        // A notification is not the commit. Its failure must not turn a durable
        // queue/budget write into a failed operation that callers might repeat.
        await signal(envelope.revision).catch(() => {});
      });
      writes = operation.catch(() => {});
      return operation;
    },
    close() { database?.close(); database = undefined; opening = undefined; initialization = undefined; }
  };
}
