/**
 * Experimental X web-session adapter. The private routes below are not a stable
 * public X API contract. This module is not wired into the production queue.
 *
 * The host supplies a verified session; this module does not discover, persist,
 * or log credentials. Callers must persist rate-limit deadlines and reconcile
 * uncertain writes before deciding whether another write is permitted.
 */
const API_ROOT = 'https://x.com/i/api/1.1';
const ID_PATTERN = /^\d{1,25}$/;

export class XApiError extends Error {
  constructor(message, {kind, status = null, retryAt = null, uncertain = false} = {}) {
    super(message);
    this.name = 'XApiError';
    this.kind = kind;
    this.status = status;
    this.retryAt = retryAt;
    this.uncertain = uncertain;
  }

  toJSON() {
    return {name: this.name, message: this.message, kind: this.kind,
      status: this.status, retryAt: this.retryAt, uncertain: this.uncertain};
  }
}

function validId(value) {
  return typeof value === 'string' && ID_PATTERN.test(value) && !/^0+$/.test(value);
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

  async function request(targetId, expectedAccountId, write) {
    if (!validId(targetId) || !validId(expectedAccountId)) {
      throw new XApiError('Target and execution account IDs must be decimal strings.', {kind: 'validation'});
    }
    if (write && targetId === expectedAccountId) {
      throw new XApiError('Blocking the execution account is not permitted.', {kind: 'validation'});
    }

    const controller = new AbortController();
    let dispatched = false;
    let timedOut = false;
    let timer;
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
      if (current.accountId !== expectedAccountId) {
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
      if (!document || typeof document !== 'object' || Array.isArray(document) ||
        Object.hasOwn(document, 'errors') || Object.hasOwn(document, 'error') ||
        document.id_str !== targetId || typeof document.blocking !== 'boolean' || (write && document.blocking !== true)) {
        throw error('response', 'X did not confirm the requested target and block relationship.', {status: response.status});
      }
      return {accountId: expectedAccountId, targetId, blocking: document.blocking};
    }

    async function run() {
      const before = await session();
      active();
      const url = write ? `${API_ROOT}/blocks/create.json` : `${API_ROOT}/users/show.json?user_id=${targetId}`;
      const headers = {
        accept: 'application/json',
        authorization: before.authorization,
        'x-csrf-token': before.csrfToken,
        'x-twitter-active-user': 'yes',
        'x-twitter-auth-type': 'OAuth2Session'
      };
      if (write) headers['content-type'] = 'application/x-www-form-urlencoded';
      let response;
      try {
        dispatched = true;
        response = await fetchImpl(url, {method: write ? 'POST' : 'GET', headers,
          ...(write ? {body: new URLSearchParams({user_id: targetId}).toString()} : {}),
          credentials: 'include', redirect: 'error', cache: 'no-store', signal: controller.signal});
      } catch {
        active();
        throw error('network', 'The X request failed; a submitted write may need reconciliation.');
      }
      active();
      let result;
      let failure;
      try {
        if (response.status === 401 || response.status === 403) {
          throw error('auth', 'X rejected the session or authorization.', {status: response.status, uncertain: false});
        }
        if (response.status === 429) {
          throw error('rate_limit', 'X rate limited this operation.', {status: 429, uncertain: false,
            retryAt: rateLimitDeadline(response, now(), rateLimitFallbackMs)});
        }
        if (response.status >= 500 && response.status <= 599) {
          throw error('server', 'X returned a server error; a submitted write may need reconciliation.', {status: response.status});
        }
        if (response.status >= 400 && response.status <= 499) {
          throw error('request', 'X rejected the requested operation.', {status: response.status, uncertain: false});
        }
        if (response.status !== 200 || response.redirected) {
          throw error('response', 'X returned an unexpected HTTP response.', {status: response.status});
        }
        result = await readJSON(response);
      } catch (cause) {
        failure = cause instanceof XApiError ? cause : error('response', 'The X response could not be verified.');
      }
      // Recheck even failed responses. A detected account switch takes priority
      // and makes a dispatched write uncertain regardless of its HTTP status.
      await session();
      active();
      if (failure) throw failure;
      return result;
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
    blockUser(targetId, {expectedAccountId} = {}) { return request(targetId, expectedAccountId, true); },
    readRelationship(targetId, {expectedAccountId} = {}) { return request(targetId, expectedAccountId, false); }
  });
}
