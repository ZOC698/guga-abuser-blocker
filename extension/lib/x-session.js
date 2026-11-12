/**
 * Reads the current regular-profile X web session in an extension background.
 * Cookies remain in memory for one operation; auth_token is never requested.
 * Cookie identity is not server authentication: connect through an authenticated
 * read endpoint before binding, and let x-api recheck the account around writes.
 */
const COOKIE_URL = 'https://x.com/i/api/1.1/';
// Public X web-client identifier, also used by Bird Shield 0.2.7. This is not
// a personal credential. The browser attaches its own session cookies to fetch.
const WEB_CLIENT_AUTHORIZATION = "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
const validId = value => typeof value === 'string' && /^[1-9]\d{0,24}$/.test(value);

export class XSessionError extends Error {
  constructor(message, kind = 'auth') {
    super(message);
    this.name = 'XSessionError';
    this.kind = kind;
    this.uncertain = false;
  }

  toJSON() {
    return {name: this.name, message: this.message, kind: this.kind, uncertain: false};
  }
}

function accountFromCookie(value) {
  if (typeof value !== 'string' || value.length > 128) throw new XSessionError('The X account cookie is invalid.');
  let decoded;
  try { decoded = decodeURIComponent(value); }
  catch { throw new XSessionError('The X account cookie is invalid.'); }
  const match = /^u=([1-9]\d{0,24})$/.exec(decoded);
  if (!match) throw new XSessionError('The X account cookie is invalid.');
  return match[1];
}

function csrfFromCookie(value) {
  if (typeof value !== 'string' || !/^[a-fA-F0-9]{32,256}$/.test(value) || value.length % 2 !== 0) {
    throw new XSessionError('The X CSRF cookie is invalid.');
  }
  return value;
}

/**
 * getSession() -> {accountId, csrfToken, authorization}
 * readAccountId() -> accountId (cookie identity only, never server verification)
 *
 * No cookieStore override is accepted: background fetch uses this context's
 * cookie store too. The manifest excludes incognito; partitioned cookies are
 * unsupported. An optional expectedAccountId adds a provider-level account pin.
 */
export function createXSessionProvider({cookies = globalThis.chrome?.cookies,
  permissions = globalThis.chrome?.permissions, expectedAccountId,
  now = Date.now, timeoutMs = 5000} = {}) {
  if ((expectedAccountId !== undefined && !validId(expectedAccountId)) ||
      typeof now !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) {
    throw new XSessionError('Invalid X session-provider configuration.', 'validation');
  }

  async function getSession() {
    let expired = false;
    let timer;
    const active = () => { if (expired) throw new XSessionError('Reading the X session timed out.', 'timeout'); };
    const work = async () => {
      if (typeof cookies?.get !== 'function' || typeof permissions?.contains !== 'function') {
        throw new XSessionError('X cookie access is unavailable. Check extension permissions.', 'permission');
      }
      let permitted;
      try { permitted = await permissions.contains({permissions: ['cookies'], origins: ['https://x.com/*']}); }
      catch { throw new XSessionError('X cookie access is unavailable. Check extension permissions.', 'permission'); }
      active();
      if (permitted !== true) throw new XSessionError('Grant X cookie access before connecting.', 'permission');

      async function read(name) {
        active();
        let cookie;
        try { cookie = await cookies.get({url: COOKIE_URL, name}); }
        catch { throw new XSessionError('X cookie access failed. Check extension permissions and sign in again.', 'permission'); }
        active();
        const timestamp = now();
        if (!Number.isFinite(timestamp)) throw new XSessionError('The session clock is invalid.', 'validation');
        if (!cookie || typeof cookie !== 'object' || cookie.name !== name ||
            !['x.com', '.x.com'].includes(cookie.domain) || cookie.secure !== true ||
            typeof cookie.storeId !== 'string' || !cookie.storeId || cookie.partitionKey !== undefined ||
            typeof cookie.value !== 'string' || !cookie.value ||
            typeof cookie.path !== 'string' || !cookie.path.startsWith('/') ||
            !new URL(COOKIE_URL).pathname.startsWith(cookie.path) ||
            (cookie.expirationDate !== undefined &&
              (!Number.isFinite(cookie.expirationDate) || cookie.expirationDate * 1000 <= timestamp))) {
          throw new XSessionError('No valid X web-session cookie is available. Sign in to x.com again.');
        }
        return {value: cookie.value, storeId: cookie.storeId};
      }

      // Bracket the credential read with another fresh pair. This detects
      // observed account/session changes, but cannot lock browser cookies.
      const accountBefore = await read('twid');
      const accountId = accountFromCookie(accountBefore.value);
      if (expectedAccountId !== undefined && expectedAccountId !== accountId) {
        throw new XSessionError('The signed-in X account differs from the bound account.', 'account_changed');
      }
      const csrfBefore = await read('ct0');
      const csrfToken = csrfFromCookie(csrfBefore.value);
      const accountAfter = await read('twid');
      if (accountFromCookie(accountAfter.value) !== accountId) {
        throw new XSessionError('The signed-in X account changed while reading its session.', 'account_changed');
      }
      const csrfAfter = await read('ct0');
      if (csrfFromCookie(csrfAfter.value) !== csrfToken ||
          [csrfBefore, accountAfter, csrfAfter].some(cookie => cookie.storeId !== accountBefore.storeId)) {
        throw new XSessionError('The X web session changed while reading credentials. Try connecting again.', 'session_changed');
      }
      active();
      return {accountId, csrfToken, authorization: WEB_CLIENT_AUTHORIZATION};
    };

    try {
      return await Promise.race([work(), new Promise((resolve, reject) => {
        timer = setTimeout(() => {
          expired = true;
          reject(new XSessionError('Reading the X session timed out.', 'timeout'));
        }, timeoutMs);
      })]);
    } finally { clearTimeout(timer); }
  }

  return Object.freeze({getSession, readAccountId: async () => (await getSession()).accountId});
}
