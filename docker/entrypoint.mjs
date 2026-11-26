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
import { discoverRecipes, recipesRoot } from '../frontend/packRecipes.js';

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
  SIRENIA_PACKS        Icon packs to install before starting, e.g. "gcp,aws,azure". Packs already
                       installed are skipped. Needs SIRENIA_ACCEPT_PACK_TERMS=yes.
  SIRENIA_ACCEPT_PACK_TERMS
                       "yes" accepts the terms of the vendors named in SIRENIA_PACKS
                       ("packs list" shows the recipes, "packs add <name>" shows the terms).
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

/** Prefixes of the installed packs, from the index that `packs` writes; none when it cannot be read. */
export function installedPrefixes(packsDir) {
  try {
    const index = JSON.parse(fs.readFileSync(path.join(packsDir, 'index.json'), 'utf8'));
    return (Array.isArray(index?.packs) ? index.packs : []).flatMap((p) => (typeof p?.prefix === 'string' ? [p.prefix] : []));
  } catch {
    return [];
  }
}

/**
 * The line printed after "Ready on port ...": the installed packs, or, with none installed and
 * recipes available, how to add them. Null when there is nothing to say (no packs and no recipes).
 * @param {{ installed: string[], recipes: { prefix: string }[] }} state
 */
export function packsHint({ installed, recipes }) {
  if (installed.length) return `Icon packs installed: ${installed.join(', ')}`;
  if (!recipes.length) return null;
  return `No icon pack is installed. To install packs when the container starts, add to your docker run command: -e SIRENIA_PACKS=${recipes.map((r) => r.prefix).join(',')} -e SIRENIA_ACCEPT_PACK_TERMS=yes\n`
    + 'The second setting accepts each vendor\'s terms ("packs list" names them). See the README, section "Icon packs".';
}

/** The directories the two programs read packs from: PACKS_DIR, or each program's default. */
export function packTargets(env, where = layout()) {
  if (env.PACKS_DIR) return [path.resolve(env.PACKS_DIR)];
  return [path.join(where.backendDir, 'packs'), path.join(where.dist, 'packs')];
}

/** Prefixes installed in every target directory (the pack file is there). */
export function installedEverywhere(dirs, prefixes) {
  return prefixes.filter((p) => dirs.every((dir) => fs.existsSync(path.join(dir, `${p}.json`))));
}

const PACK_NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/**
 * What to do with SIRENIA_PACKS before the servers start. Pure: the caller says which recipes exist
 * and which packs are installed.
 *  - `{ install: [], skip: [] }` when the variable is unset or empty, or everything is installed
 *  - `{ install, skip }`: recipes to install (in the order given), packs already there
 *  - `{ error }`: a name that is malformed or has no recipe; nothing may start
 *  - `{ refuse }`: packs would be downloaded but SIRENIA_ACCEPT_PACK_TERMS is not "yes"; the
 *    message names each vendor's terms
 * @param {{ env: Record<string, string | undefined>, recipes: { prefix: string, label?: string, termsUrl?: string | null, iconsUrl?: string | null }[], installed: string[] }} state
 */
export function packInstallPlan({ env, recipes, installed }) {
  const names = [...new Set(String(env.SIRENIA_PACKS ?? '').split(/[\s,]+/).filter(Boolean))];
  if (!names.length) return { install: [], skip: [] };
  const bad = names.filter((n) => !PACK_NAME.test(n));
  if (bad.length) return { error: `SIRENIA_PACKS: ${bad.map((n) => JSON.stringify(n)).join(', ')} is not a pack name (lowercase letters, digits and hyphens).` };
  const byPrefix = new Map(recipes.map((r) => [r.prefix, r]));
  const unknown = names.filter((n) => !byPrefix.has(n));
  if (unknown.length) {
    return { error: `SIRENIA_PACKS: no recipe named ${unknown.map((n) => `"${n}"`).join(', ')}. Available: ${recipes.map((r) => r.prefix).join(', ') || 'none'}.` };
  }
  const skip = names.filter((n) => installed.includes(n));
  const install = names.filter((n) => !installed.includes(n));
  if (install.length && String(env.SIRENIA_ACCEPT_PACK_TERMS ?? '').trim().toLowerCase() !== 'yes') {
    const lines = install.map((n) => {
      const r = byPrefix.get(n);
      return `  ${r.label || n} (${n}): terms ${r.termsUrl || '(see "packs add ' + n + '")'}${r.iconsUrl ? `, icons ${r.iconsUrl}` : ''}`;
    });
    return {
      refuse: [
        `SIRENIA_PACKS asks for icon packs that are not installed: ${install.join(', ')}. Their icons are the vendors' and may be used only under each vendor's terms:`,
        ...lines,
        'To accept these terms and install the packs, also set SIRENIA_ACCEPT_PACK_TERMS=yes. Nothing was downloaded.',
      ].join('\n'),
    };
  }
  return { install, skip };
}

/** The hint for this installation: the packs directory is the one the editor reads. */
function startupHint(where, env) {
  const packsDir = env.PACKS_DIR ? path.resolve(env.PACKS_DIR) : path.join(where.dist, 'packs');
  return packsHint({
    installed: installedPrefixes(packsDir),
    recipes: discoverRecipes(recipesRoot(env, where.frontendDir)),
  });
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

/**
 * The cause of a failed `packs add`, from its stderr: the generator's error line ("✖ sha256
 * mismatch for ...", "✖ could not download ..."), else the last error line of a stack trace, else
 * the last line that is not the summary.
 */
export function failureReason(stderr) {
  const lines = String(stderr).split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('Not installed:') && !/^Node\.js v\d/.test(l));
  const marked = lines.find((l) => l.startsWith('✖'));
  if (marked) return marked.replace(/^✖\s*/, '');
  return lines.findLast((l) => /\b[A-Za-z]*Error\b.*:/.test(l)) ?? lines.at(-1) ?? '';
}

/**
 * Run `packs add <prefix> --accept-terms` for one pack, its output passed through. Resolves to
 * `{ ok }` or `{ ok: false, reason }` (the last lines it wrote to stderr), or `{ stopped }` when a
 * stop signal arrived meanwhile (the child is told to stop too).
 */
function installOne(where, prefix, dirs) {
  return new Promise((resolve) => {
    const args = [where.packs, 'add', prefix, '--accept-terms', ...dirs.flatMap((d) => ['--dir', d])];
    const child = spawn(process.execPath, args, { cwd: where.root, env: process.env, stdio: ['ignore', 'inherit', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk);
      stderr = (stderr + chunk).slice(-4000);
    });
    let stopped = null;
    const onSignal = (signal) => { stopped = signal; if (running(child)) child.kill(signal); };
    for (const signal of STOP_SIGNALS) process.on(signal, onSignal);
    const done = (result) => {
      for (const signal of STOP_SIGNALS) process.off(signal, onSignal);
      resolve(stopped ? { stopped } : result);
    };
    child.on('error', (error) => done({ ok: false, reason: error.message }));
    child.on('exit', (code) => {
      done(code === 0 ? { ok: true } : { ok: false, reason: failureReason(stderr) || `exit status ${code}` });
    });
  });
}

/**
 * SIRENIA_PACKS: install the named packs that are missing, before anything starts. Network use is
 * limited to this step (the `packs` command); the two servers never fetch. Returns an exit status
 * when nothing may start (a bad name, terms not accepted, a stop request), otherwise null: a pack
 * that failed to install is reported and the editor starts without it.
 */
async function installPacksFromEnv(where, env) {
  if (!String(env.SIRENIA_PACKS ?? '').trim()) return null;
  const dirs = packTargets(env, where);
  const recipes = discoverRecipes(recipesRoot(env, where.frontendDir));
  const plan = packInstallPlan({ env, recipes, installed: installedEverywhere(dirs, recipes.map((r) => r.prefix)) });
  if (plan.error) {
    console.error(`Refusing to start: ${plan.error}`);
    return 2;
  }
  if (plan.refuse) {
    console.error(`Refusing to start: ${plan.refuse}`);
    return 2;
  }
  if (plan.skip.length) console.log(`Icon packs already installed: ${plan.skip.join(', ')}`);
  const missing = [];
  for (const prefix of plan.install) {
    console.log(`Installing icon pack ${prefix} (SIRENIA_PACKS, terms accepted with SIRENIA_ACCEPT_PACK_TERMS=yes)...`);
    const result = await installOne(where, prefix, dirs);
    if (result.stopped) return exitStatus(null, result.stopped);
    if (!result.ok) missing.push({ prefix, reason: result.reason });
  }
  for (const { prefix, reason } of missing) {
    const label = recipes.find((r) => r.prefix === prefix)?.label || prefix;
    console.error(`Icon pack ${label} (${prefix}) is NOT installed: ${reason}`);
    console.error(`The editor starts without it; diagrams that use ${prefix}: icons are refused until it is installed. Restart the container to try again.`);
  }
  return null;
}

async function serve(where) {
  const settings = serveSettings(process.env);
  if (settings.error) {
    console.error(`Refusing to start: ${settings.error}`);
    return 1;
  }
  const stop = await installPacksFromEnv(where, process.env);
  if (stop !== null) return stop;
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
        if (await healthy(settings.port)) {
          console.log(`Ready on port ${settings.port}`);
          const hint = startupHint(where, process.env);
          if (hint) console.log(hint);
          return;
        }
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
