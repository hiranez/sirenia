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
  backendEnv, exitStatus, failureReason, installedEverywhere, installedPrefixes, layout, packInstallPlan, packsHint, packTargets, parseArgs, proxyEnv,
  serveSettings, stoppedCleanly,
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

test('start-up hint: installed packs are listed; with none, and recipes, it names the settings that install them', () => {
  const recipes = [{ prefix: 'demo' }, { prefix: 'other' }];
  assert.equal(packsHint({ installed: ['demo', 'mine'], recipes }), 'Icon packs installed: demo, mine');
  assert.equal(packsHint({ installed: ['mine'], recipes: [] }), 'Icon packs installed: mine');
  const hint = packsHint({ installed: [], recipes });
  assert.match(hint, /^No icon pack is installed\. To install packs when the container starts, add to your docker run command: -e SIRENIA_PACKS=demo,other -e SIRENIA_ACCEPT_PACK_TERMS=yes\n/);
  assert.match(hint, /accepts each vendor's terms.*README, section "Icon packs"/);
  assert.equal(hint.split('\n').length, 2);
});

test('start-up hint: nothing to say without packs and recipes', () => {
  assert.equal(packsHint({ installed: [], recipes: [] }), null);
});

const RECIPES = [
  { prefix: 'gcp', label: 'Google Cloud', termsUrl: 'https://example.com/g-terms', iconsUrl: 'https://example.com/g-icons' },
  { prefix: 'aws', label: 'AWS', termsUrl: 'https://example.com/a-terms', iconsUrl: null },
  { prefix: 'azure', label: 'Microsoft Azure', termsUrl: 'https://example.com/z-terms', iconsUrl: 'https://example.com/z-icons' },
];
const plan = (env, installed = []) => packInstallPlan({ env, recipes: RECIPES, installed });

test('SIRENIA_PACKS: unset or empty means nothing to do, whatever the acceptance says', () => {
  for (const env of [{}, { SIRENIA_PACKS: '' }, { SIRENIA_PACKS: ' , ' }, { SIRENIA_ACCEPT_PACK_TERMS: 'yes' }]) {
    assert.deepEqual(plan(env), { install: [], skip: [] }, JSON.stringify(env));
  }
});

test('SIRENIA_PACKS: with acceptance, the missing packs are installed in the order given; installed ones are skipped', () => {
  assert.deepEqual(plan({ SIRENIA_PACKS: 'gcp,aws,azure', SIRENIA_ACCEPT_PACK_TERMS: 'yes' }), { install: ['gcp', 'aws', 'azure'], skip: [] });
  assert.deepEqual(plan({ SIRENIA_PACKS: ' azure  gcp,azure ', SIRENIA_ACCEPT_PACK_TERMS: ' YES ' }, ['gcp']), { install: ['azure'], skip: ['gcp'] });
});

test('SIRENIA_PACKS: a normal restart with everything installed downloads nothing and needs no acceptance', () => {
  assert.deepEqual(plan({ SIRENIA_PACKS: 'gcp,aws' }, ['aws', 'gcp']), { install: [], skip: ['gcp', 'aws'] });
});

test('SIRENIA_PACKS: without SIRENIA_ACCEPT_PACK_TERMS=yes the install is refused and each vendor\'s terms are named', () => {
  for (const accept of [undefined, '', 'no', 'true', '1', 'y']) {
    const p = plan({ SIRENIA_PACKS: 'gcp,aws,azure', SIRENIA_ACCEPT_PACK_TERMS: accept }, ['gcp']);
    assert.ok(p.refuse, String(accept));
    assert.doesNotMatch(p.refuse, /g-terms/, 'an installed pack is not mentioned');
    assert.match(p.refuse, /AWS \(aws\): terms https:\/\/example\.com\/a-terms/);
    assert.match(p.refuse, /Microsoft Azure \(azure\): terms https:\/\/example\.com\/z-terms, icons https:\/\/example\.com\/z-icons/);
    assert.match(p.refuse, /SIRENIA_ACCEPT_PACK_TERMS=yes\. Nothing was downloaded\./);
  }
});

test('SIRENIA_PACKS: unknown or malformed names stop the start and name the recipes', () => {
  assert.match(plan({ SIRENIA_PACKS: 'gcp,nope', SIRENIA_ACCEPT_PACK_TERMS: 'yes' }).error, /no recipe named "nope"\. Available: gcp, aws, azure/);
  assert.match(plan({ SIRENIA_PACKS: 'all', SIRENIA_ACCEPT_PACK_TERMS: 'yes' }).error, /no recipe named "all"/);
  assert.match(plan({ SIRENIA_PACKS: 'GCP;aws', SIRENIA_ACCEPT_PACK_TERMS: 'yes' }).error, /is not a pack name/);
  assert.match(plan({ SIRENIA_PACKS: '../x', SIRENIA_ACCEPT_PACK_TERMS: 'yes' }).error, /is not a pack name/);
});

test('a failed install is reported by its cause, not by the summary or the Node.js banner', () => {
  const mismatch = 'Installing AWS (aws) into /packs failed; it was not installed.\n✖ sha256 mismatch for https://example.com/x.zip\n  expected aa\n  got      bb\nThe vendor has changed this file.\n\nNot installed: AWS (aws): installation failed, see above.\n';
  assert.equal(failureReason(mismatch), 'sha256 mismatch for https://example.com/x.zip');
  const offline = 'node:internal/deps/undici:1\nTypeError: fetch failed\n    at node:internal/x\n  [cause]: Error: getaddrinfo ENOTFOUND services.example.com\n\nNode.js v22.23.4\nNot installed: Google Cloud (gcp): installation failed, see above.\n';
  assert.equal(failureReason(offline), '[cause]: Error: getaddrinfo ENOTFOUND services.example.com');
  assert.equal(failureReason('something odd\n'), 'something odd');
  assert.equal(failureReason(''), '');
});

test('install targets: PACKS_DIR, otherwise the directory each program reads', () => {
  const where = layout('/app');
  assert.deepEqual(packTargets({ PACKS_DIR: '/packs' }, where), [path.resolve('/packs')]);
  assert.deepEqual(packTargets({}, where), [path.join('/app', 'backend', 'packs'), path.join('/app', 'frontend', 'dist', 'packs')]);
  const a = fs.mkdtempSync(path.join(os.tmpdir(), 'sirenia-a-'));
  const b = fs.mkdtempSync(path.join(os.tmpdir(), 'sirenia-b-'));
  fs.writeFileSync(path.join(a, 'gcp.json'), '{}');
  fs.writeFileSync(path.join(a, 'aws.json'), '{}');
  fs.writeFileSync(path.join(b, 'aws.json'), '{}');
  assert.deepEqual(installedEverywhere([a, b], ['gcp', 'aws', 'azure']), ['aws'], 'installed means present in every directory');
});

test('serve refuses to start, before anything runs or downloads, when SIRENIA_PACKS cannot be honoured', () => {
  const recipes = fs.mkdtempSync(path.join(os.tmpdir(), 'sirenia-recipes-'));
  fs.mkdirSync(path.join(recipes, 'demo'));
  fs.writeFileSync(path.join(recipes, 'demo', 'mapping.json'), JSON.stringify({ prefix: 'demo', pack: { label: 'Demo Cloud', terms: { summary: ['x'], url: 'https://example.com/demo-terms' } } }));
  const packsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sirenia-packs-'));
  const run = (extra) => spawnSync(process.execPath, [launcher, 'serve'], {
    encoding: 'utf8', timeout: 10000, env: { ...process.env, PACK_RECIPES_DIR: recipes, PACKS_DIR: packsDir, PORT: '18628', RENDER_PORT: '18629', ...extra },
  });
  const refused = run({ SIRENIA_PACKS: 'demo', SIRENIA_ACCEPT_PACK_TERMS: '' });
  assert.equal(refused.status, 2, refused.stderr);
  assert.match(refused.stderr, /Demo Cloud \(demo\): terms https:\/\/example\.com\/demo-terms/);
  const unknown = run({ SIRENIA_PACKS: 'other', SIRENIA_ACCEPT_PACK_TERMS: 'yes' });
  assert.equal(unknown.status, 2, unknown.stderr);
  assert.match(unknown.stderr, /no recipe named "other"\. Available: demo/);
  assert.deepEqual(fs.readdirSync(packsDir), []);
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
