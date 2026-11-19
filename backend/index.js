const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const crypto = require('node:crypto');
const { generateImage, warmUp } = require('./routes/generate');

const app = express();
const PORT = process.env.PORT || 8080;
// Bind address. Cloud Run needs all interfaces (the default); the local image binds the loopback
// address so that only the proxy in the same container can reach the render service.
const HOST = process.env.HOST || '0.0.0.0';

// Behind exactly one proxy (Cloud Run). Scope trust to 1 hop so XFF can't be fully spoofed.
app.set('trust proxy', 1);
app.disable('x-powered-by');

// Security headers (API responses). Frontend SPA headers are set by the frontend proxy.
app.use(helmet());

// CORS: explicit allowlist, no "*" + credentials. Default denies cross-origin browser calls;
// the frontend reaches the backend server-to-server (ID token), not from the browser directly.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
app.use(
  cors({
    origin: allowedOrigins.length ? allowedOrigins : false,
    methods: ['POST', 'GET', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: false,
    maxAge: 600,
  })
);

// Bounded JSON body. Diagram code is capped at 10KB; 64KB leaves headroom for JSON envelope.
app.use(express.json({ limit: '64kb' }));

// Request ID + minimal structured logging (no request bodies, no tokens).
app.use((req, res, next) => {
  req.id = crypto.randomUUID();
  res.setHeader('X-Request-ID', req.id);
  if (req.path !== '/health') {
    console.log(`[${req.id}] ${req.method} ${req.path}`);
  }
  next();
});

// Capacity backstop, not the per-user limit. Every request arrives from the frontend proxy (the
// backend is IAM-protected), so the caller IP here is the proxy's egress IP, shared by all users.
// Per-user limiting is enforced in frontend/auth-proxy.js, where the real client IP is known.
// This cap only guards against runaway load. In-memory per instance.
const BACKEND_RATE_LIMIT_PER_MIN = Number(process.env.BACKEND_RATE_LIMIT_PER_MIN) || 300;
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: BACKEND_RATE_LIMIT_PER_MIN,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
    skip: (req) => req.path === '/health',
  })
);

app.post('/api/generate', generateImage);

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString(), uptime: process.uptime() });
});

// Launch Chrome and render once BEFORE opening the port. Cloud Run's startup probe is a TCP check on
// this port, so the instance only receives traffic (and a new revision only takes over) once a
// browser really works. Launching lazily inside the first request made that request pay for the
// launch, and a slow launch failed it. WARMUP_ON_BOOT=false restores the lazy behaviour (useful
// for local work without a browser).
const WARMUP_ON_BOOT = process.env.WARMUP_ON_BOOT !== 'false';
// Give up well inside Cloud Run's 240 s startup window so the platform can replace the instance.
const STARTUP_DEADLINE = Number(process.env.STARTUP_DEADLINE_MS) || 200000;

let server = null;
async function start() {
  const bootStarted = Date.now();
  if (WARMUP_ON_BOOT) {
    const giveUp = setTimeout(() => {
      console.error(JSON.stringify({ event: 'startup_failed', error: 'startup deadline exceeded', ms: Date.now() - bootStarted }));
      process.exit(1);
    }, STARTUP_DEADLINE);
    try {
      await warmUp();
    } catch (err) {
      // An instance that cannot render is useless: exit so the platform starts a fresh one.
      console.error(JSON.stringify({ event: 'startup_failed', error: err && err.message, ms: Date.now() - bootStarted }));
      process.exit(1);
    }
    clearTimeout(giveUp);
  }
  server = app.listen(PORT, HOST, () => {
    console.log(`Backend listening on port ${PORT}`);
    console.log(JSON.stringify({ event: 'ready', warm: WARMUP_ON_BOOT, ms: Date.now() - bootStarted }));
  });
}

// Graceful shutdown on SIGTERM (Cloud Run sends this before stopping the instance).
process.on('SIGTERM', () => {
  if (!server) process.exit(0); // still starting: nothing to drain
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
});

// Do NOT exit on unhandledRejection: a single rejected promise from one request must not crash
// the instance (that is a trivial remote DoS). Per-request handlers already catch their errors.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason && reason.message ? reason.message : reason);
});
// uncaughtException leaves the process in an undefined state; log and let the platform recycle
// via health checks rather than exiting on the request path.
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err && err.message ? err.message : err);
});

start();
