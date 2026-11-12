/**
 * X web-session adapter. The private routes below are not a stable public X API
 * contract. Successful writes still require a separate relationship readback.
 *
 * The host supplies a verified session; this module does not discover, persist,
 * or log credentials. Callers must persist rate-limit deadlines and reconcile
 * uncertain writes before deciding whether another write is permitted.
 */
const API_ROOT = 'https://x.com/i/api/1.1';
const ID_PATTERN = /^\d{1,25}$/;

export class XApiError extends Error {
  constructor(message, {kind, status = null, code = null, retryAt = null, uncertain = false} = {}) {
    super(message);
    this.name = 'XApiError';
    this.kind = kind;
    this.status = status;
    this.code = code;
    this.retryAt = retryAt;
    this.uncertain = uncertain;
  }

  toJSON() {
    return {name: this.name, message: this.message, kind: this.kind,
      status: this.status, code: this.code, retryAt: this.retryAt, uncertain: this.uncertain};
  }
}

function validId(value) {
  return typeof value === 'string' && ID_PATTERN.test(value) && !/^0+$/.test(value);
}

function responseHandle(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_]{1,15}$/.test(value) ? value.toLowerCase() : null;
}

function headerValue(response, name) {
  return response.headers?.get?.(name) ?? '';
}

function rateLimitDeadline(response, timestamp, fallbackMs) {
  const deadlines = [];
  const retry = String(headerValue(response, 'retry-after')).trim();
  if (/^\d+(?:\.\d+)?$/.test(retry)) {
    deadlines.push(timestamp + Number(retry) * 1000);
  } else if (retry) {
    deadlines.push(Date.parse(retry));
  }
  const reset = String(headerValue(response, 'x-rate-limit-reset')).trim();
  if (/^\d+(?:\.\d+)?$/.test(reset)) deadlines.push(Number(reset) * 1000);
  const future = deadlines.filter(value => Number.isFinite(value) && value > timestamp && value <= 8.64e15);
  // This is a conservative fallback, not a claim about X's actual quota window.
  return future.length ? Math.max(...future) : timestamp + fallbackMs;
}

/**
 * getSession(): Promise<{accountId:string, csrfToken:string, authorization:string}>
 * must identify the actual browser session associated with these credentials.
 * It is called again after the response, even when the server rejects a request.
 * A session check cannot make browser-cookie changes during fetch atomic.
 */
export function createXApiAdapter({getSession, fetchImpl = globalThis.fetch,
  now = Date.now, timeoutMs = 20000, maxResponseBytes = 1024 * 1024,
  rateLimitFallbackMs = 15 * 60 * 1000} = {}) {
  if (typeof getSession !== 'function' || typeof fetchImpl !== 'function' || typeof now !== 'function' ||
    !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000 ||
    !Number.isInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > 4 * 1024 * 1024 ||
    !Number.isInteger(rateLimitFallbackMs) || rateLimitFallbackMs < 1 || rateLimitFallbackMs > 24 * 60 * 60 * 1000) {
    throw new XApiError('Invalid X adapter configuration.', {kind: 'validation'});
  }

  async function request(operation, {targetId, targetHandle, expectedAccountId, beforeWrite, beforeDispatch} = {}) {
    const write = operation === 'block';
    const verify = operation === 'verify';
    const resolve = operation === 'resolve';
    const requestedHandle = resolve && typeof targetHandle === 'string' ? responseHandle(targetHandle.trim().replace(/^@/, '')) : null;
    if ((!verify && !validId(expectedAccountId)) || (verify && expectedAccountId !== undefined && !validId(expectedAccountId)) ||
      (!verify && !resolve && !validId(targetId))) {
      throw new XApiError('Target and execution account IDs must be decimal strings.', {kind: 'validation'});
    }
    if (resolve && !requestedHandle) throw new XApiError('The target must be a valid X handle.', {kind: 'validation'});
    if (beforeWrite !== undefined && typeof beforeWrite !== 'function') throw new XApiError('The write guard must be a function.', {kind: 'validation'});
    if (beforeDispatch !== undefined && typeof beforeDispatch !== 'function') throw new XApiError('The dispatch guard must be a function.', {kind: 'validation'});
    if (write && targetId === expectedAccountId) {
      throw new XApiError('Blocking the execution account is not permitted.', {kind: 'validation'});
    }

    const controller = new AbortController();
    let dispatched = false;
    let timedOut = false;
    let timer;
    let accountId = expectedAccountId;
    const uncertain = () => write && dispatched;
    const error = (kind, message, details = {}) => new XApiError(message, {kind, uncertain: uncertain(), ...details});
    const active = () => {
      if (timedOut) throw error('timeout', 'X operation timed out.');
    };

    async function session() {
      let current;
      try { current = await getSession(); }
      catch { throw error('auth', 'The X session could not be verified.'); }
      active();
      if (!current || !validId(current.accountId)) {
        throw error('auth', 'No verified X execution account is available.');
      }
      if (accountId === undefined) accountId = current.accountId;
      if (current.accountId !== accountId) {
        throw error('account_changed', 'The signed-in X account differs from the bound execution account.');
      }
      if (typeof current.csrfToken !== 'string' || current.csrfToken.length > 1024 || !/^[\x21-\x7e]+$/.test(current.csrfToken) ||
        typeof current.authorization !== 'string' || current.authorization.length > 8192 || !/^Bearer [\x21-\x7e]+$/i.test(current.authorization)) {
        throw error('auth', 'The verified X session is missing valid request credentials.');
      }
      // Copy values; do not keep the caller's mutable session object.
      return {accountId: current.accountId, csrfToken: current.csrfToken, authorization: current.authorization};
    }

    async function readJSON(response) {
      const type = String(headerValue(response, 'content-type'));
      if (!/^application\/(?:[a-z0-9!#$&^_.+-]+\+)?json(?:\s*;|$)/i.test(type)) {
        throw error('response', 'X returned an unexpected response type.', {status: response.status});
      }
      const length = Number(headerValue(response, 'content-length'));
      if (Number.isFinite(length) && length > maxResponseBytes) {
        await response.body?.cancel?.().catch(() => {});
        throw error('response', 'X returned a response larger than the allowed limit.', {status: response.status});
      }
      let text;
      try {
        if (response.body?.getReader) {
          const reader = response.body.getReader();
          const decoder = new TextDecoder('utf-8', {fatal: true});
          let size = 0;
          text = '';
          try {
            while (true) {
              const chunk = await reader.read();
              active();
              if (chunk.done) break;
              size += chunk.value.byteLength;
              if (size > maxResponseBytes) {
                await reader.cancel().catch(() => {});
                throw error('response', 'X returned a response larger than the allowed limit.', {status: response.status});
              }
              text += decoder.decode(chunk.value, {stream: true});
            }
            text += decoder.decode();
          } finally { reader.releaseLock(); }
        } else {
          text = await response.text();
          active();
          if (new TextEncoder().encode(text).length > maxResponseBytes) {
            throw error('response', 'X returned a response larger than the allowed limit.', {status: response.status});
          }
        }
      } catch (cause) {
        if (cause instanceof XApiError) throw cause;
        active();
        throw error('network', 'The X response could not be read completely.', {status: response.status});
      }
      let document;
      try { document = JSON.parse(text); }
      catch { throw error('response', 'X returned invalid JSON.', {status: response.status}); }
      return document;
    }

    function classify(response, document) {
      const status = response.status;
      const object = document && typeof document === 'object' && !Array.isArray(document);
      const hasErrors = object && (Object.hasOwn(document, 'errors') || Object.hasOwn(document, 'error'));
      const codes = object && Array.isArray(document.errors) ? document.errors.map(item => item?.code)
        .filter(code => Number.isInteger(code) && code >= 0 && code <= 9999) : [];
      const code = codes[0] ?? null;
      const rejection = status >= 400 && status <= 499;
      const details = {status, code, uncertain: rejection ? false : uncertain()};
      if (status === 401) return error('auth', 'X rejected the session or authorization.', {...details, uncertain: false});
      if (status === 429) return error('rate_limit', 'X rate limited this operation.', {...details, uncertain: false,
        retryAt: rateLimitDeadline(response, now(), rateLimitFallbackMs)});
      if (status >= 500 && status <= 599) return error('server', 'X returned a server error; a submitted write may need reconciliation.', {status, code});
      // Legacy v1.1 codes are advisory classifications, never an authorization
      // to bypass verification or infer that an unavailable account was deleted.
      const authCode = codes.find(value => [32, 64, 89, 99, 135, 215, 220, 326, 353].includes(value));
      if (hasErrors && authCode !== undefined) return error('auth', 'X rejected the session or restricted the execution account.', {...details, code: authCode});
      if (hasErrors && codes.includes(88)) return error('rate_limit', 'X rate limited this operation.', {...details, code: 88,
        retryAt: rateLimitDeadline(response, now(), rateLimitFallbackMs)});
      if (hasErrors && codes.includes(63)) return error(verify ? 'auth' : 'target_suspended',
        verify ? 'The X execution account is unavailable.' : 'X reports that the target account is suspended.', {...details, code: 63});
      if (hasErrors && codes.includes(50)) return error(verify ? 'auth' : 'target_unavailable',
        verify ? 'The X execution account is unavailable.' : 'X could not find the target account; it may be unavailable or renamed.', {...details, code: 50});
      if (status === 403) return error('auth', 'X rejected the session or authorization.', {...details, uncertain: false});
      if (rejection) return error('request', 'X rejected the requested operation.', {...details, uncertain: false});
      if (status !== 200 || response.redirected) return error('response', 'X returned an unexpected HTTP response.', {status});
      if (!object || hasErrors) return error('response', 'X returned an unverified API result.', {status, code});
      return null;
    }

    async function send(path, isWrite = false) {
      let before = await session();
      if (isWrite && beforeWrite) {
        let permitted;
        try { permitted = await beforeWrite(); }
        catch { active(); throw error('cancelled', 'The queued X write was cancelled before dispatch.'); }
        active();
        if (permitted === false) throw error('cancelled', 'The queued X write was cancelled before dispatch.');
        before = await session();
      }
      if (isWrite && beforeDispatch) {
        // Re-read durable authorization after the final session await. Unlike
        // beforeWrite this guard must not reserve another operation budget.
        // Browser cookies can still change independently; neither callback
        // provides an atomic lock over the browser's cookie store and fetch.
        let permitted;
        try { permitted = await beforeDispatch(); }
        catch { active(); throw error('cancelled', 'The queued X write was cancelled before dispatch.'); }
        active();
        if (permitted === false) throw error('cancelled', 'The queued X write was cancelled before dispatch.');
      }
      active();
      const url = `${API_ROOT}/${path}`;
      const headers = {
        accept: 'application/json',
        authorization: before.authorization,
        'x-csrf-token': before.csrfToken,
        'x-twitter-active-user': 'yes',
        'x-twitter-auth-type': 'OAuth2Session'
      };
      if (isWrite) headers['content-type'] = 'application/x-www-form-urlencoded';
      let response;
      try {
        if (isWrite) dispatched = true;
        response = await fetchImpl(url, {method: isWrite ? 'POST' : 'GET', headers,
          ...(isWrite ? {body: new URLSearchParams({user_id: targetId}).toString()} : {}),
          credentials: 'include', redirect: 'error', cache: 'no-store', signal: controller.signal});
      } catch {
        active();
        throw error('network', 'The X request failed; a submitted write may need reconciliation.');
      }
      active();
      let document;
      let failure;
      try {
        try { document = await readJSON(response); }
        catch (cause) { failure = cause instanceof XApiError ? cause : error('response', 'The X response could not be verified.'); }
        const classified = classify(response, document);
        // A bounded but malformed error body cannot turn HTTP auth/rate/server
        // rejection into a successful result or expose untrusted server text.
        if (classified && (response.status !== 200 || !failure)) failure = classified;
      } catch (cause) {
        failure = cause instanceof XApiError ? cause : error('response', 'The X response could not be verified.');
      }
      // Recheck even failed responses. A detected account switch takes priority
      // and makes a dispatched write uncertain regardless of its HTTP status.
      await session();
      active();
      if (failure) throw failure;
      return document;
    }

    function user(document, expectedHandle) {
      const handle = responseHandle(document.screen_name);
      if (!validId(document.id_str) || !handle || (expectedHandle && handle !== expectedHandle)) {
        throw error('response', 'X did not confirm the requested numeric identity and handle.', {status: 200});
      }
      if (document.suspended === true || document.deactivated === true || document.deactivated_bit === true) {
        throw error(verify ? 'auth' : document.suspended ? 'target_suspended' : 'target_unavailable',
          verify ? 'The X execution account is unavailable.' : 'X reports that the target account is unavailable.', {status: 200});
      }
      return {targetId: document.id_str, handle};
    }

    async function run() {
      if (verify) {
        // users/show?user_id=<cookieID> alone only looks up that user. The first
        // endpoint must identify the actual authenticated server-side session.
        const settings = await send('account/settings.json');
        const handle = responseHandle(settings.screen_name);
        if (!handle) throw error('response', 'X did not identify the authenticated account.', {status: 200});
        const result = user(await send(`users/show.json?screen_name=${encodeURIComponent(handle)}`), handle);
        if (result.targetId !== accountId) throw error('account_changed', 'The authenticated X account differs from the browser session identity.', {status: 200});
        return {accountId, handle: result.handle};
      }
      if (resolve) {
        const result = user(await send(`users/show.json?screen_name=${encodeURIComponent(requestedHandle)}`), requestedHandle);
        return {accountId, ...result};
      }
      const document = await send(write ? 'blocks/create.json' : `users/show.json?user_id=${targetId}`, write);
      if (document.id_str !== targetId) throw error('response', 'X did not confirm the requested target and block relationship.', {status: 200});
      if (document.suspended === true || document.deactivated === true || document.deactivated_bit === true) {
        throw error(document.suspended ? 'target_suspended' : 'target_unavailable', 'X reports that the target account is unavailable.', {status: 200});
      }
      if (typeof document.blocking !== 'boolean' || (write && document.blocking !== true)) {
        throw error('response', 'X did not confirm the requested target and block relationship.', {status: 200});
      }
      return {accountId, targetId, blocking: document.blocking};
    }

    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(error('timeout', 'X operation timed out.'));
      }, timeoutMs);
    });
    try { return await Promise.race([run(), deadline]); }
    finally { clearTimeout(timer); }
  }

  return Object.freeze({
    blockUser(targetId, {expectedAccountId, beforeWrite, beforeDispatch} = {}) { return request('block', {targetId, expectedAccountId, beforeWrite, beforeDispatch}); },
    readRelationship(targetId, {expectedAccountId} = {}) { return request('relationship', {targetId, expectedAccountId}); },
    verifyAccount({expectedAccountId} = {}) { return request('verify', {expectedAccountId}); },
    resolveUser(targetHandle, {expectedAccountId} = {}) { return request('resolve', {targetHandle, expectedAccountId}); }
  });
}
