/**
 * Retry policy for the proxy's call to the render backend.
 *
 * The backend scales to zero. While an instance is starting, the platform in front of it can answer
 * 429/500/503 by itself, or the call can time out, although a second attempt a moment later succeeds.
 * Those are worth one retry. Anything the backend application itself answered is final: its errors
 * are always JSON, so a JSON body means "the app decided this" (bad diagram, rate limit, a render
 * that hit its own deadline) and repeating the request would only repeat the work.
 */
const PLATFORM_FAILURE_STATUSES = new Set([429, 500, 502, 503, 504]);

/** @param {{ error?: unknown, status?: number, contentType?: string }} outcome */
export function isPlatformFailure({ error, status, contentType }) {
  if (error) return true; // no HTTP response at all: connection error or timeout
  if (!PLATFORM_FAILURE_STATUSES.has(status)) return false;
  return !/\bjson\b/i.test(contentType || '');
}

/**
 * Run `attempt` and retry while it ends in a platform failure, up to `retries` extra times.
 * `attempt` resolves to an HTTP-like response ({ status, headers }) or rejects on transport errors.
 * Resolves to the last response, or rejects with the last transport error.
 */
export async function callWithRetry(attempt, { retries = 1, delayMs = 500, onRetry = () => {} } = {}) {
  for (let n = 0; ; n++) {
    let response;
    let error;
    try {
      response = await attempt();
    } catch (err) {
      error = err;
    }
    const failed = isPlatformFailure({
      error,
      status: response?.status,
      contentType: response?.headers?.['content-type'],
    });
    if (!failed || n >= retries) {
      if (error) throw error;
      return response;
    }
    onRetry({ attempt: n + 1, status: response?.status, reason: error ? String(error.message || error) : 'platform response' });
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

/**
 * Was this request sent by a page that this proxy served? Browsers attach Sec-Fetch-Site to every
 * request and scripts cannot change it, so "same-origin" means our own editor made the call; older
 * browsers without that header still send Origin on a POST. Requests with neither (scanners, bots,
 * plain scripts) and requests made by other websites are refused.
 *
 * This is a filter, not authentication: a purpose-built client can send the same headers. What such
 * a client can cause is bounded separately by warmupDecision() and the per-client rate limit.
 * @param {{ secFetchSite?: string, origin?: string, host?: string }} headers
 */
export function isSameOriginRequest({ secFetchSite, origin, host }) {
  if (secFetchSite) return secFetchSite === 'same-origin';
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * Decide what a wake-up request may do, so that no number of callers can make the proxy contact the
 * backend more than once per `minIntervalMs`, and not at all while the backend is known to be up.
 *  - 'cached': the backend answered within `warmTtlMs`; say "ready" without calling it.
 *  - 'join':   a wake-up call is already in flight; wait for its answer.
 *  - 'skip':   one was attempted moments ago and did not find the backend up; do not pile on.
 *  - 'call':   contact the backend.
 * @param {{ now: number, readyAt: number, lastAttemptAt: number, inFlight: boolean, warmTtlMs: number, minIntervalMs: number }} state
 * @returns {'cached' | 'join' | 'skip' | 'call'}
 */
export function warmupDecision({ now, readyAt, lastAttemptAt, inFlight, warmTtlMs, minIntervalMs }) {
  if (readyAt && now - readyAt < warmTtlMs) return 'cached';
  if (inFlight) return 'join';
  if (lastAttemptAt && now - lastAttemptAt < minIntervalMs) return 'skip';
  return 'call';
}

/** How the proxy authenticates to the backend. The first entry is the default. */
export const BACKEND_AUTH_MODES = ['google-id-token', 'none'];

/**
 * Validate and normalise the proxy's backend settings from the environment. An unset or empty
 * variable takes its default, and the defaults are the hosted (Cloud Run) behaviour:
 *  - BACKEND_URL (required): the backend's base URL. With `google-id-token` it must be https; with
 *    `none` (the local image, backend on loopback) http is allowed too.
 *  - BACKEND_AUTH: `google-id-token` (default; an ID token from the metadata server on every backend
 *    call) or `none` (no Authorization header, the metadata server is never called).
 *  - TRUST_PROXY_HOPS: proxies in front of this one whose X-Forwarded-For entry is trusted; a
 *    non-negative integer, default 1 (the Cloud Run front end). 0 trusts no X-Forwarded-For at all.
 * Returns `{ config: { backendUrl, backendAuth, trustProxy } }`, where `trustProxy` is the value for
 * Express's 'trust proxy' setting (`false` for 0), or `{ error }` with a message for the operator.
 * @param {Record<string, string | undefined>} env
 */
export function proxySettings(env) {
  const backendUrl = env.BACKEND_URL;
  const backendAuth = env.BACKEND_AUTH || BACKEND_AUTH_MODES[0];
  const hops = env.TRUST_PROXY_HOPS || '1';
  if (!BACKEND_AUTH_MODES.includes(backendAuth)) {
    return { error: `BACKEND_AUTH must be one of ${BACKEND_AUTH_MODES.join(', ')} (got "${backendAuth}").` };
  }
  if (!backendUrl) return { error: 'BACKEND_URL is not set (the https URL of the render backend).' };
  // Fail fast on an unexpected backend scheme (prevents accidental http/SSRF misconfig).
  if (backendAuth === 'google-id-token' && !/^https:\/\//.test(backendUrl)) {
    return { error: `BACKEND_URL must be https (got "${backendUrl}").` };
  }
  if (backendAuth === 'none' && !/^https?:\/\//.test(backendUrl)) {
    return { error: `BACKEND_URL must be http or https (got "${backendUrl}").` };
  }
  if (!/^\d{1,3}$/.test(hops)) {
    return { error: `TRUST_PROXY_HOPS must be a non-negative integer below 1000 (got "${hops}").` };
  }
  const n = Number(hops);
  return { config: { backendUrl, backendAuth, trustProxy: n === 0 ? false : n } };
}

/**
 * Headers that authenticate one backend call: an ID token for `google-id-token`, nothing for `none`.
 * `getIdToken` is only called in the first mode. Both backend calls (render and health) use this,
 * so they cannot disagree about authentication.
 * @param {string} backendAuth
 * @param {() => Promise<string>} getIdToken
 */
export async function backendAuthHeaders(backendAuth, getIdToken) {
  if (backendAuth === 'none') return {};
  return { Authorization: `Bearer ${await getIdToken()}` };
}
