#!/usr/bin/env node
/**
 * Front door of the editor: serves the built SPA and the icon packs, and forwards a narrow API
 * allowlist (render, wake-up) to the render backend. Two deployments use it:
 *  - Hosted (Cloud Run, the default): the backend is a separate, IAM-protected service at an https
 *    URL, and every backend call carries a Google-issued ID token fetched from the metadata server
 *    (BACKEND_AUTH=google-id-token). One trusted proxy hop (TRUST_PROXY_HOPS=1): the Google front end.
 *  - Local image (docker/entrypoint.mjs): the backend runs in the same container on loopback, so
 *    there is no token to fetch (BACKEND_AUTH=none, http allowed) and, with nothing in front of the
 *    proxy, no X-Forwarded-For is trusted (TRUST_PROXY_HOPS=0).
 * Settings are validated by proxySettings() in upstream.js; an invalid one stops the start-up.
 */
import express from 'express';
import helmet from 'helmet';
import axios from 'axios';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { backendAuthHeaders, callWithRetry, isSameOriginRequest, proxySettings, warmupDecision } from './upstream.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PROXY_PORT || process.env.PORT || 3001;
const METADATA_SERVER =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity';
const DIST_DIR = process.env.DIST_DIR || path.join(__dirname, 'dist');
// Per-attempt timeout for backend calls. The backend bounds a render at 35 s, so anything slower
// is an instance that is still starting; such an attempt is retried once (see upstream.js).
const UPSTREAM_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS) || 60000;

// The backend URL has no built-in default: a build or deployment must provide it. An http URL is
// refused unless BACKEND_AUTH=none (prevents accidental http/SSRF misconfig of the hosted edition).
const settings = proxySettings(process.env);
if (settings.error) {
  console.error(`Refusing to start: ${settings.error}`);
  process.exit(1);
}
const { backendUrl: BACKEND_URL, backendAuth: BACKEND_AUTH, trustProxy: TRUST_PROXY } = settings.config;

app.disable('x-powered-by');
// Hosted default, one trusted hop: the Cloud Run domain mapping (Google Frontend) appends the real
// client IP as the last X-Forwarded-For entry, so req.ip is the client and spoofed XFF values are
// ignored. Behind an external HTTPS load balancer this must become 2 (TRUST_PROXY_HOPS=2). With
// TRUST_PROXY_HOPS=0 (the local image) Express ignores X-Forwarded-For and uses the socket address.
app.set('trust proxy', TRUST_PROXY);

// Per-client rate limit, enforced here at the edge where the real client IP is known. The backend
// only ever sees this proxy's egress IP, so it cannot tell users apart. IPv6 clients are keyed by
// /56 subnet so address rotation doesn't bypass the limit. The store is in-memory per instance, so
// a client spread across N instances can get up to N x the limit; for a strict global limit, front
// the service with Cloud Armor or move the store to Redis.
const RATE_LIMIT_PER_MIN = Number(process.env.RATE_LIMIT_PER_MIN) || 20;
const generateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: RATE_LIMIT_PER_MIN,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});
// Separate, smaller budget for warm-up pings so they never eat into a client's render quota.
const warmupLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.WARMUP_LIMIT_PER_MIN) || 6,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

// Security headers + Content-Security-Policy for the served SPA. Everything is same-origin:
// the bundle is self-hosted (no CDN) and the API is reached at /api/* on this same origin.
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        // Mermaid/Vite inject inline <style>; inline styles are required, inline scripts are not.
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:', 'blob:'],
        // helmet's default would allow fonts from any https origin; nothing here needs that.
        'font-src': ["'self'", 'data:'],
        'connect-src': ["'self'"],
        'object-src': ["'none'"],
        'base-uri': ["'self'"],
        'frame-ancestors': ["'none'"],
        'form-action': ["'self'"],
        // helmet's default tells browsers to rewrite http requests to https. The hosted edition is
        // always behind https. The local image is plain http, and for any host other than localhost
        // that rewrite would turn the editor's own script and API requests into failing https ones.
        ...(BACKEND_AUTH === 'none' ? { 'upgrade-insecure-requests': null } : {}),
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

// Bounded JSON body; diagram source is small.
app.use(express.json({ limit: '64kb' }));

// Cache for the metadata-server ID token (valid ~1h). Only used with BACKEND_AUTH=google-id-token.
let tokenCache = { token: null, expiresAt: 0 };
async function getIdToken() {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt) return tokenCache.token;
  const response = await axios.get(METADATA_SERVER, {
    params: { audience: BACKEND_URL },
    headers: { 'Metadata-Flavor': 'Google' },
    timeout: 5000,
  });
  tokenCache = { token: response.data, expiresAt: Date.now() + 55 * 60 * 1000 };
  return tokenCache.token;
}

app.get('/health', (req, res) => res.status(200).send('OK'));

// What this instance knows about the backend, shared by all callers (see warmupDecision).
const BACKEND_WARM_TTL_MS = 5 * 60 * 1000; // trust "it answered" this long; idle instances live ~15 min
const WARMUP_MIN_INTERVAL_MS = 30 * 1000; // at most one backend call per this interval when it is down
let backendReadyAt = 0;
let warmupAttemptAt = 0;
let warmupInFlight = null;

/**
 * Forward ONLY the known diagram-generation endpoint to the backend. The proxy holds a
 * privileged ID token (hosted edition) or the only route to the loopback backend (local image), so
 * it must never be a generic forwarder (confused-deputy risk):
 * the path and method are fixed here, not taken from the client.
 */
app.post('/api/generate', generateLimiter, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const auth = await backendAuthHeaders(BACKEND_AUTH, getIdToken);
    // Rendering is idempotent, so one retry is safe when the platform (not the backend app) failed
    // the attempt, which is what a backend instance that is still starting looks like.
    const response = await callWithRetry(
      () =>
        axios({
          method: 'POST',
          url: `${BACKEND_URL}/api/generate`,
          data: req.body,
          responseType: 'arraybuffer',
          maxRedirects: 0, // never follow redirects with the Authorization header attached
          timeout: UPSTREAM_TIMEOUT_MS,
          headers: { ...auth, 'Content-Type': 'application/json' },
          validateStatus: () => true, // pass backend status through as-is
        }),
      { onRetry: ({ status, reason }) => console.warn(`Backend attempt failed (${status || reason}); retrying once`) }
    );
    res.status(response.status);
    if (response.headers['content-type']) res.set('Content-Type', response.headers['content-type']);
    // Lets a user quote the ID that the backend logged for this render. Only the backend app sets
    // it, so its presence also proves an instance is up right now.
    if (response.headers['x-request-id']) {
      res.set('X-Request-ID', response.headers['x-request-id']);
      backendReadyAt = Date.now();
    }
    return res.send(Buffer.from(response.data));
  } catch (error) {
    console.error('Proxy error:', error.message);
    return res
      .status(502)
      .json({ error: 'The render service did not answer in time. Please try again.', code: 'upstream_unavailable' });
  }
});

// ---- Wake-up -----------------------------------------------------------------------------------

function callBackendHealth() {
  warmupAttemptAt = Date.now();
  warmupInFlight = (async () => {
    try {
      const auth = await backendAuthHeaders(BACKEND_AUTH, getIdToken);
      const response = await axios({
        method: 'GET',
        url: `${BACKEND_URL}/health`,
        maxRedirects: 0,
        timeout: UPSTREAM_TIMEOUT_MS,
        headers: auth,
        validateStatus: () => true,
      });
      if (response.status === 200) backendReadyAt = Date.now();
      return response.status === 200;
    } catch (error) {
      console.warn('Warm-up failed:', error.message);
      return false;
    } finally {
      warmupInFlight = null;
    }
  })();
  return warmupInFlight;
}

/**
 * Wake the backend ahead of the first export. The backend scales to zero and needs several seconds
 * to start; the editor calls this when it loads so that start happens while the user is still
 * typing.
 *
 * Guard rails, in order:
 *  1. Only a page served by this proxy may call it (isSameOriginRequest); everything else gets 403
 *     before any rate-limit budget or backend call is spent.
 *  2. Per-client limit (warmupLimiter).
 *  3. Shared budget (warmupDecision): however many callers there are, this instance contacts the
 *     backend at most once per WARMUP_MIN_INTERVAL_MS, and not at all while it is known to be up.
 * The backend call itself is a fixed GET to its health check: nothing from the client is forwarded,
 * and the answer says only whether the backend is up.
 */
app.post(
  '/api/warmup',
  (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const sameOrigin = isSameOriginRequest({
      secFetchSite: req.get('sec-fetch-site'),
      origin: req.get('origin'),
      host: req.get('host'),
    });
    if (!sameOrigin) return res.status(403).json({ error: 'Forbidden' });
    return next();
  },
  warmupLimiter,
  async (req, res) => {
    const decision = warmupDecision({
      now: Date.now(),
      readyAt: backendReadyAt,
      lastAttemptAt: warmupAttemptAt,
      inFlight: warmupInFlight !== null,
      warmTtlMs: BACKEND_WARM_TTL_MS,
      minIntervalMs: WARMUP_MIN_INTERVAL_MS,
    });
    if (decision === 'cached') return res.json({ ready: true });
    if (decision === 'skip') return res.json({ ready: false });
    const ready = await (decision === 'join' ? warmupInFlight : callBackendHealth());
    return res.json({ ready });
  }
);

// Icon packs (`/packs/index.json`, `/packs/<prefix>.json`), from PACKS_DIR when set (a directory
// mounted at run time), otherwise from the build. Only GET/HEAD of a plain pack file name are
// served; anything else under /packs is a JSON 404 and never falls through to the SPA's index.html.
const PACKS_DIR = process.env.PACKS_DIR ? path.resolve(process.env.PACKS_DIR) : path.join(DIST_DIR, 'packs');
const PACK_PATH = /^\/[a-z0-9]+(-[a-z0-9]+)*\.json$/;
const servePack = express.static(PACKS_DIR, {
  index: false,
  redirect: false,
  dotfiles: 'deny',
  cacheControl: false,
  setHeaders: (res) => {
    res.set('Content-Type', 'application/json; charset=utf-8');
    res.set('Cache-Control', 'no-cache');
  },
});
app.use(
  '/packs',
  (req, res, next) => {
    const readable = req.method === 'GET' || req.method === 'HEAD';
    if (!readable || !PACK_PATH.test(req.path)) return res.status(404).json({ error: 'Not found' });
    return servePack(req, res, next); // calls next() when the file does not exist
  },
  // The file does not exist. No packs installed is a normal state: answer the index with an empty
  // list, so the editor's start-up request is not an error in the browser console.
  (req, res) => {
    if (req.path !== '/index.json') return res.status(404).json({ error: 'Not found' });
    return res.set('Cache-Control', 'no-cache').json({ format: 1, packs: [] });
  }
);

// Unknown API paths answer in the API's JSON shape, whatever the method.
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Static SPA assets + history-API fallback.
app.use(express.static(DIST_DIR));
app.get('*', (req, res) => res.sendFile(path.join(DIST_DIR, 'index.html')));

// Errors raised before a route answers (a body over the size limit, malformed JSON) get the same
// JSON shape as every other API error instead of Express's HTML error page. No details are echoed.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (res.headersSent) return req.socket.destroy();
  const status = Number.isInteger(err?.status) && err.status >= 400 && err.status < 500 ? err.status : 500;
  const error =
    status === 413 ? 'Request body too large (64 KB at most).'
      : status === 400 ? 'The request body is not valid JSON.'
        : status === 500 ? 'Request failed.'
          : 'Request refused.';
  if (status === 500) console.error('Unhandled error:', err?.message);
  return res.status(status).json({ error });
});

app.listen(PORT, () => {
  console.log(`Auth proxy listening on port ${PORT}; backend ${BACKEND_URL} (backend auth: ${BACKEND_AUTH})`);
});
