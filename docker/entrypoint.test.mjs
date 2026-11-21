// Tests for the pure parts of docker/entrypoint.mjs. Run with: node --test docker/entrypoint.test.mjs
// Importing the launcher starts nothing; the end-to-end behaviour (children, signals) is exercised
// by the local-image CI job.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  backendEnv, exitStatus, installedPrefixes, layout, packsHint, parseArgs, proxyEnv, serveSettings, stoppedCleanly,
} from './entrypoint.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const launcher = path.join(here, 'entrypoint.mjs');

test('arguments: serve is the default; packs takes everything after it', () => {
  assert.deepEqual(parseArgs([]), { command: 'serve' });
  assert.deepEqual(parseArgs(['serve']), { command: 'serve' });
  assert.deepEqual(parseArgs(['packs', 'add', 'gcp', '--accept-terms']), { command: 'packs', args: ['add', 'gcp', '--accept-terms'] });
  assert.deepEqual(parseArgs(['packs', '--help']), { command: 'packs', args: ['--help'] });
  assert.deepEqual(parseArgs(['packs']), { command: 'packs', args: [] });
  assert.deepEqual(parseArgs(['--help']), { command: 'help' });
  assert.deepEqual(parseArgs(['-h']), { command: 'help' });
  assert.deepEqual(parseArgs(['--version']), { command: 'version' });
});

test('arguments: unknown commands and extra serve arguments are refused', () => {
  assert.match(parseArgs(['start']).error, /unknown command "start"/);
  assert.match(parseArgs(['--port', '1']).error, /unknown command/);
  assert.match(parseArgs(['serve', 'now']).error, /takes no argument/);
});

test('layout: programs are found relative to the launcher', () => {
  const where = layout('/app');
  assert.equal(where.backend, path.join('/app', 'backend', 'index.js'));
  assert.equal(where.proxy, path.join('/app', 'frontend', 'auth-proxy.js'));
  assert.equal(where.dist, path.join('/app', 'frontend', 'dist'));
  assert.equal(where.packs, path.join('/app', 'scripts', 'packs.mjs'));
  assert.equal(layout().root, path.resolve(here, '..'));
});

test('settings: defaults', () => {
  assert.deepEqual(serveSettings({}), { port: 8080, renderPort: 8081, deadlineMs: 240000, trustProxyHops: '0' });
  assert.deepEqual(serveSettings({ PORT: '', RENDER_PORT: '', TRUST_PROXY_HOPS: '' }), { port: 8080, renderPort: 8081, deadlineMs: 240000, trustProxyHops: '0' });
  assert.deepEqual(serveSettings({ PORT: '4190', RENDER_PORT: '4191', STARTUP_DEADLINE_MS: '1000', TRUST_PROXY_HOPS: '1' }),
    { port: 4190, renderPort: 4191, deadlineMs: 1000, trustProxyHops: '1' });
});

test('settings: invalid ports, deadline or equal ports are refused', () => {
  for (const env of [{ PORT: 'abc' }, { PORT: '0' }, { PORT: '65536' }, { RENDER_PORT: '-1' }, { RENDER_PORT: '80.5' }, { STARTUP_DEADLINE_MS: '0' }, { STARTUP_DEADLINE_MS: 'soon' }]) {
    assert.match(serveSettings(env).error ?? '', /must be an integer/, JSON.stringify(env));
  }
  assert.match(serveSettings({ PORT: '9000', RENDER_PORT: '9000' }).error, /must differ/);
});

test('render service environment: passed through, bound to loopback on RENDER_PORT', () => {
  const env = { PACKS_DIR: '/packs', PRODUCT_NAME: 'Acme Diagrams', PUPPETEER_EXECUTABLE_PATH: '/chrome', HOST: '0.0.0.0', PORT: '8080' };
  const out = backendEnv(env, serveSettings({ RENDER_PORT: '9191' }));
  assert.equal(out.HOST, '127.0.0.1', 'the render service must never listen on a public interface');
  assert.equal(out.PORT, '9191');
  assert.equal(out.PACKS_DIR, '/packs');
  assert.equal(out.PRODUCT_NAME, 'Acme Diagrams');
  assert.equal(out.PUPPETEER_EXECUTABLE_PATH, '/chrome');
  assert.equal(env.HOST, '0.0.0.0', 'the launcher environment itself is not modified');
});

test('proxy environment: loopback backend, no token, no trusted X-Forwarded-For by default', () => {
  const where = layout('/app');
  const env = { PACKS_DIR: '/packs', BACKEND_URL: 'https://elsewhere.example', BACKEND_AUTH: 'google-id-token', DIST_DIR: '/tmp/other', RATE_LIMIT_PER_MIN: '5' };
  const out = proxyEnv(env, serveSettings({ PORT: '4190', RENDER_PORT: '4191' }), where);
  assert.equal(out.PROXY_PORT, '4190');
  assert.equal(out.PORT, '4190');
  assert.equal(out.BACKEND_URL, 'http://127.0.0.1:4191');
  assert.equal(out.BACKEND_AUTH, 'none');
  assert.equal(out.TRUST_PROXY_HOPS, '0');
  assert.equal(out.DIST_DIR, path.join('/app', 'frontend', 'dist'));
  assert.equal(out.PACKS_DIR, '/packs');
  assert.equal(out.RATE_LIMIT_PER_MIN, '5');
  assert.equal(proxyEnv({ TRUST_PROXY_HOPS: '1' }, serveSettings({ TRUST_PROXY_HOPS: '1' }), where).TRUST_PROXY_HOPS, '1');
});

test('exit status: child code, or 128 + signal number', () => {
  assert.equal(exitStatus(0, null), 0);
  assert.equal(exitStatus(3, null), 3);
  assert.equal(exitStatus(null, 'SIGTERM'), 143);
  assert.equal(exitStatus(null, 'SIGINT'), 130);
  assert.equal(exitStatus(null, 'SIGKILL'), 137);
  assert.ok(stoppedCleanly(0, null, 'SIGTERM'));
  assert.ok(stoppedCleanly(null, 'SIGTERM', 'SIGTERM'));
  assert.ok(stoppedCleanly(130, null, 'SIGINT'), 'Puppeteer exits 130 on SIGINT');
  assert.ok(!stoppedCleanly(1, null, 'SIGTERM'));
});

test('the command line answers --help, --version and usage errors without starting anything', () => {
  const run = (args) => spawnSync(process.execPath, [launcher, ...args], { encoding: 'utf8', timeout: 10000 });
  const help = run(['--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /entrypoint\.mjs packs <args\.\.\.>/);
  const v = run(['--version']);
  assert.equal(v.status, 0);
  assert.match(v.stdout.trim(), /^\d+\.\d+\.\d+/);
  const bad = run(['bogus']);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /unknown command "bogus"/);
  const badPort = spawnSync(process.execPath, [launcher, 'serve'], { encoding: 'utf8', timeout: 10000, env: { ...process.env, PORT: 'x' } });
  assert.equal(badPort.status, 1);
  assert.match(badPort.stderr, /PORT must be an integer/);
});

test('start-up hint: installed packs are listed; with none, and recipes, it says how to add one', () => {
  const recipes = [{ prefix: 'demo' }, { prefix: 'other' }];
  assert.equal(packsHint({ installed: ['demo', 'mine'], recipes, version: '1.4.0' }), 'Icon packs installed: demo, mine');
  assert.equal(packsHint({ installed: ['mine'], recipes: [], version: '1.4.0' }), 'Icon packs installed: mine');
  const hint = packsHint({ installed: [], recipes, version: '1.4.0' });
  assert.match(hint, /^No icon pack is installed\. To add one, run: docker run --rm -it -v sirenia-packs:\/packs ghcr\.io\/hiranez\/sirenia:1\.4\.0 packs add demo\n/);
  assert.match(hint, /restart this container.*README, section "Icon packs"/);
  assert.equal(hint.split('\n').length, 2);
});

test('start-up hint: nothing to say without packs and recipes; an unusable version is a placeholder', () => {
  assert.equal(packsHint({ installed: [], recipes: [], version: '1.4.0' }), null);
  assert.match(packsHint({ installed: [], recipes: [{ prefix: 'demo' }], version: 'unknown' }), /sirenia:<version> packs add demo/);
});

test('installed packs come from the index in the packs directory; any problem means none', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sirenia-packs-'));
  assert.deepEqual(installedPrefixes(dir), []);
  assert.deepEqual(installedPrefixes(path.join(dir, 'missing')), []);
  fs.writeFileSync(path.join(dir, 'index.json'), '{ not json');
  assert.deepEqual(installedPrefixes(dir), []);
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ format: 1, packs: [{ prefix: 'demo' }, { file: 'x.json' }, null, { prefix: 5 }] }));
  assert.deepEqual(installedPrefixes(dir), ['demo']);
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ format: 1, packs: 'x' }));
  assert.deepEqual(installedPrefixes(dir), []);
});
