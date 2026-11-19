#!/usr/bin/env node
// entrypoint.mjs: the launcher of the local image (root Dockerfile). It runs the SAME two programs as
// the hosted edition, so local use goes through the same code paths, headers, limits and
// Content-Security-Policy: the proxy (frontend/auth-proxy.js) in front, and the render service
// (backend/index.js) behind it, bound to the loopback address so that only the proxy can reach it.
//
//   entrypoint.mjs [serve]          start the render service, wait until it is healthy, then the proxy
//   entrypoint.mjs packs <args...>  run scripts/packs.mjs (install, list, remove icon packs)
//   entrypoint.mjs --help | --version
//
// Paths are resolved relative to this file, so it also runs from a source checkout:
//   node docker/entrypoint.mjs serve
// Node built-ins only. Children are started with this Node binary and argument arrays, never a shell.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STOP_SIGNALS = ['SIGTERM', 'SIGINT'];
const HARD_STOP_MS = 10_000;
const HEALTH_POLL_MS = 500;

export const HELP = `Usage:
  entrypoint.mjs [serve]          Start the editor and the render service (default command).
  entrypoint.mjs packs <args...>  Install, list or remove icon packs; "packs --help" for details.
  entrypoint.mjs --help | --version

Settings (environment):
  PORT                 Port of the editor and API (default 8080).
  RENDER_PORT          Port of the render service on 127.0.0.1 (default 8081; never published).
  STARTUP_DEADLINE_MS  How long to wait for the render service to become healthy (default 240000).
  TRUST_PROXY_HOPS     Proxies in front of this one whose X-Forwarded-For is trusted (default 0).
  PACKS_DIR            Icon packs directory, read by both programs and written by "packs".
`;

/** Where the programs are, relative to the repository (or image) root. */
export function layout(root = ROOT) {
  return {
    root,
    backendDir: path.join(root, 'backend'),
    backend: path.join(root, 'backend', 'index.js'),
    frontendDir: path.join(root, 'frontend'),
    proxy: path.join(root, 'frontend', 'auth-proxy.js'),
    dist: path.join(root, 'frontend', 'dist'),
    packs: path.join(root, 'scripts', 'packs.mjs'),
  };
}

/**
 * The command line: `{ command: 'serve' | 'help' | 'version' }`, `{ command: 'packs', args }`, or
 * `{ error }`. Everything after `packs` belongs to the packs command, flags included.
 * @param {string[]} argv
 */
export function parseArgs(argv) {
  const [first, ...rest] = argv;
  if (first === undefined || first === 'serve') {
    return rest.length ? { error: `"serve" takes no argument (got ${JSON.stringify(rest[0])})` } : { command: 'serve' };
  }
  if (first === 'packs') return { command: 'packs', args: rest };
  if (first === '--help' || first === '-h' || first === 'help') return { command: 'help' };
  if (first === '--version' || first === '-v') return { command: 'version' };
  return { error: `unknown command ${JSON.stringify(first)}` };
}

function integerSetting(env, name, fallback, min, max) {
  const raw = env[name];
  if (raw === undefined || raw === '') return { value: fallback };
  if (!/^\d+$/.test(raw) || Number(raw) < min || Number(raw) > max) {
    return { error: `${name} must be an integer from ${min} to ${max} (got "${raw}")` };
  }
  return { value: Number(raw) };
}

/**
 * Validated `serve` settings: `{ port, renderPort, deadlineMs, trustProxyHops }` or `{ error }`.
 * TRUST_PROXY_HOPS is passed on as given (default "0"); the proxy validates it.
 * @param {Record<string, string | undefined>} env
 */
export function serveSettings(env) {
  const port = integerSetting(env, 'PORT', 8080, 1, 65535);
  const renderPort = integerSetting(env, 'RENDER_PORT', 8081, 1, 65535);
  const deadline = integerSetting(env, 'STARTUP_DEADLINE_MS', 240000, 1, 24 * 60 * 60 * 1000);
  const failed = [port, renderPort, deadline].find((s) => s.error);
  if (failed) return { error: failed.error };
  if (port.value === renderPort.value) return { error: `PORT and RENDER_PORT must differ (both ${port.value})` };
  return {
    port: port.value,
    renderPort: renderPort.value,
    deadlineMs: deadline.value,
    trustProxyHops: env.TRUST_PROXY_HOPS === undefined || env.TRUST_PROXY_HOPS === '' ? '0' : env.TRUST_PROXY_HOPS,
  };
}

/** Environment of the render service: everything passed through, bound to loopback. */
export function backendEnv(env, settings) {
  return { ...env, HOST: '127.0.0.1', PORT: String(settings.renderPort) };
}

/** Environment of the proxy: everything passed through, pointed at the loopback render service. */
export function proxyEnv(env, settings, where = layout()) {
  return {
    ...env,
    PORT: String(settings.port),
    PROXY_PORT: String(settings.port),
    BACKEND_URL: `http://127.0.0.1:${settings.renderPort}`,
    BACKEND_AUTH: 'none',
    TRUST_PROXY_HOPS: settings.trustProxyHops,
    DIST_DIR: where.dist,
  };
}

/** Exit status for a child that ended with `code` or `signal` (shell convention: 128 + signal number). */
export function exitStatus(code, signal) {
  if (signal) return 128 + (os.constants.signals[signal] ?? 0);
  return code ?? 1;
}

/** Whether a child's end is the normal answer to the stop signal it was sent. */
export function stoppedCleanly(code, signal, sent) {
  return code === 0 || signal !== null || code === exitStatus(null, sent);
}

function version(where) {
  for (const file of [path.join(where.root, 'package.json'), path.join(where.backendDir, 'package.json')]) {
    try {
      const v = JSON.parse(fs.readFileSync(file, 'utf8')).version;
      if (typeof v === 'string') return v;
    } catch { /* try the next one */ }
  }
  return 'unknown';
}

// ---- running ---------------------------------------------------------------------------------

function start(name, script, env, cwd) {
  const child = spawn(process.execPath, [script], { cwd, env, stdio: 'inherit' });
  child.label = name;
  child.done = new Promise((resolve) => {
    child.on('exit', (code, signal) => resolve({ code, signal }));
    child.on('error', (error) => {
      console.error(`Could not start the ${name}: ${error.message}`);
      resolve({ code: 1, signal: null });
    });
  });
  return child;
}

const running = (child) => child && child.exitCode === null && child.signalCode === null;

/** One GET of the render service's health check: true on 200. */
function healthy(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/health', timeout: 2000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
  });
}

async function serve(where) {
  const settings = serveSettings(process.env);
  if (settings.error) {
    console.error(`Refusing to start: ${settings.error}`);
    return 1;
  }
  const children = [];
  let stopping = null; // the signal being forwarded, once a stop was requested

  // Stop everything that is still running; exit after HARD_STOP_MS even if a child hangs.
  const stopAll = (signal) => {
    for (const child of children) if (running(child)) child.kill(signal);
    const hard = setTimeout(() => {
      for (const child of children) if (running(child)) child.kill('SIGKILL');
      console.error(`Stopped forcibly: a process did not exit within ${HARD_STOP_MS / 1000} s.`);
      process.exit(1);
    }, HARD_STOP_MS);
    return Promise.all(children.map((c) => c.done)).finally(() => clearTimeout(hard));
  };

  let requested;
  const stopRequested = new Promise((resolve) => { requested = resolve; });
  for (const signal of STOP_SIGNALS) {
    process.on(signal, () => {
      if (stopping) return; // a second signal while stopping changes nothing; the hard stop still applies
      stopping = signal;
      requested(signal);
    });
  }

  const backend = start('render service', where.backend, backendEnv(process.env, settings), where.backendDir);
  children.push(backend);

  // Wait for the render service: healthy, gone, out of time, or asked to stop.
  const deadline = Date.now() + settings.deadlineMs;
  let outcome = null;
  backend.done.then(() => { outcome ??= 'exited'; });
  stopRequested.then(() => { outcome ??= 'stop'; });
  while (outcome === null) {
    if (await healthy(settings.renderPort)) { outcome ??= 'healthy'; break; }
    if (Date.now() >= deadline) { outcome ??= 'deadline'; break; }
    await new Promise((resolve) => setTimeout(resolve, HEALTH_POLL_MS));
  }

  if (outcome === 'exited') {
    const { code, signal } = await backend.done;
    console.error(`The render service exited during start-up (${signal || `exit code ${code}`}).`);
    return exitStatus(code, signal) || 1;
  }
  if (outcome === 'deadline') {
    console.error(`The render service did not become healthy within ${settings.deadlineMs} ms (STARTUP_DEADLINE_MS); stopping.`);
    await stopAll('SIGTERM');
    return 1;
  }
  if (outcome === 'healthy') {
    const proxy = start('proxy', where.proxy, proxyEnv(process.env, settings, where), where.frontendDir);
    children.push(proxy);
    // Ready once the proxy answers on its own port too.
    (async () => {
      while (running(proxy) && !stopping) {
        if (await healthy(settings.port)) { console.log(`Ready on port ${settings.port}`); return; }
        await new Promise((resolve) => setTimeout(resolve, HEALTH_POLL_MS));
      }
    })();
  }

  // Run until a stop is requested or a child exits on its own.
  const first = await Promise.race([
    stopRequested.then((signal) => ({ signal, requested: true })),
    ...children.map((c) => c.done.then((end) => ({ child: c, end }))),
  ]);
  if (first.requested || stopping) {
    const sent = stopping;
    await stopAll(sent);
    const ends = await Promise.all(children.map((c) => c.done));
    return ends.every((e) => stoppedCleanly(e.code, e.signal, sent)) ? 0 : 1;
  }
  const { child, end } = first;
  console.error(`The ${child.label} exited unexpectedly (${end.signal || `exit code ${end.code}`}); stopping.`);
  await stopAll('SIGTERM');
  return exitStatus(end.code, end.signal) || 1;
}

async function packs(where, args) {
  const child = spawn(process.execPath, [where.packs, ...args], { cwd: where.root, env: process.env, stdio: 'inherit' });
  // The child shares the terminal (the terms prompt needs it). A stop signal sent to this process
  // alone (as `docker stop` does) is passed on so the command can end cleanly.
  for (const signal of STOP_SIGNALS) process.on(signal, () => { if (running(child)) child.kill(signal); });
  const { code, signal } = await new Promise((resolve) => {
    child.on('exit', (c, s) => resolve({ code: c, signal: s }));
    child.on('error', (error) => {
      console.error(`Could not run the packs command: ${error.message}`);
      resolve({ code: 1, signal: null });
    });
  });
  return exitStatus(code, signal);
}

export async function main(argv, where = layout()) {
  const parsed = parseArgs(argv);
  if (parsed.error) {
    console.error(`${parsed.error}\n\n${HELP}`);
    return 2;
  }
  switch (parsed.command) {
    case 'help':
      console.log(HELP);
      return 0;
    case 'version':
      console.log(version(where));
      return 0;
    case 'packs':
      return packs(where, parsed.args);
    default:
      return serve(where);
  }
}

// Run only when executed, not when imported (the tests import the pure parts above). Compared as
// real paths: Node resolves symbolic links in import.meta.url but not in process.argv.
const invoked = (() => {
  try { return fs.realpathSync(process.argv[1] ?? ''); } catch { return null; }
})();
if (invoked === fileURLToPath(import.meta.url)) {
  process.exit(await main(process.argv.slice(2)));
}
