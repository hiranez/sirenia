#!/usr/bin/env node
/**
 * Security-invariant gate. No dependencies (Node 20+). Exits 1 if any check fails.
 *
 *   node scripts/security/verify-invariants.mjs static
 *       Scans the repository for settings that must never drift (pinned actions, no :latest,
 *       Mermaid security settings, no keys in the tree, trademark notice).
 *
 *   node scripts/security/verify-invariants.mjs render <backend-url> --control-cmd <cmd> [options]
 *       Exercises a running render backend: active content is neutralised, CORS denies by default,
 *       input limits hold, and the renderer makes NO outbound request. For the last one the script
 *       listens on a local port (the "canary") and submits diagrams that reference it.
 *         --control-cmd <cmd>   shell command that fetches the URL appended to it FROM THE BACKEND'S
 *                               network position (e.g. `docker exec svc node -e "fetch(process.argv[1])"`).
 *                               It proves the canary is reachable, so "no hits" means "blocked",
 *                               not "unreachable".
 *         --canary-host <host>  name under which the backend reaches this machine (default 127.0.0.1)
 *         --html-mode           the backend runs with ALLOW_HTML_RENDER=true; test egress from
 *                               arbitrary HTML instead of the default-mode checks
 *         --pack-icon <p:name>  an icon of a pack installed in the backend (e.g. gcp:cloud-run); runs
 *                               the icon-pack checks (unknown name refused, notice in the export,
 *                               pack diagram exports). Without it those checks are skipped.
 */
import { execFileSync, execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const failures = [];

function check(name, ok, detail = '') {
  console.log(`${ok ? 'ok   ' : 'FAIL '} ${name}`);
  if (!ok) {
    failures.push(name);
    if (detail) console.log(`      ${String(detail).replace(/\n/g, '\n      ')}`);
  }
}
function warn(message) {
  console.log(`warn  ${message}`);
}

// ---------------------------------------------------------------------------------------------
// static
// ---------------------------------------------------------------------------------------------

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const isComment = (line) => /^\s*(#|\/\/)/.test(line);

function trackedFiles() {
  return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0')
    .filter(Boolean);
}

// An image reference is pinned when it has a tag other than "latest" or a digest.
function imagePin(ref) {
  if (/@sha256:[0-9a-f]{64}$/.test(ref)) return 'digest';
  const tag = ref.slice(ref.lastIndexOf('/') + 1).split(':')[1];
  if (!tag) return 'untagged';
  return tag === 'latest' ? 'latest' : 'tag';
}

function runStatic() {
  const files = trackedFiles();

  // Every GitHub Action pinned to a full commit SHA (tags are mutable).
  const unpinned = [];
  for (const file of files.filter((f) => /^\.github\/(workflows|actions)\/.+\.ya?ml$/.test(f))) {
    read(file).split('\n').forEach((line, i) => {
      const uses = isComment(line) ? null : line.match(/^\s*-?\s*uses:\s*['"]?([^'"\s#]+)/);
      if (!uses) return;
      const ref = uses[1];
      const pinned = ref.startsWith('./') || /@[0-9a-f]{40}$/.test(ref) || /^docker:\/\/.+@sha256:[0-9a-f]{64}$/.test(ref);
      if (!pinned) unpinned.push(`${file}:${i + 1}  ${ref}`);
    });
  }
  check('GitHub Actions are pinned to full commit SHAs', unpinned.length === 0, unpinned.join('\n'));

  // No mutable :latest (explicit or implied) in what we build and run.
  const mutable = [];
  for (const file of files.filter((f) => /(^|\/)Dockerfile(\.[\w.-]+)?$/.test(f))) {
    const stages = new Set();
    read(file).split('\n').forEach((line, i) => {
      const from = line.match(/^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?/i);
      if (!from) return;
      const [, ref, stage] = from;
      if (stage) stages.add(stage.toLowerCase());
      if (ref === 'scratch' || stages.has(ref.toLowerCase())) return;
      const pin = imagePin(ref);
      if (pin === 'latest' || pin === 'untagged') mutable.push(`${file}:${i + 1}  ${ref} (${pin})`);
    });
  }
  for (const file of files.filter((f) => /(^|\/)(docker-)?compose[\w.-]*\.ya?ml$/.test(f))) {
    read(file).split('\n').forEach((line, i) => {
      const image = isComment(line) ? null : line.match(/^\s*image:\s*['"]?([^'"\s#]+)/);
      if (!image) return;
      const pin = imagePin(image[1]);
      if (pin === 'latest' || pin === 'untagged') mutable.push(`${file}:${i + 1}  ${image[1]} (${pin})`);
    });
  }
  // Line scan for `:latest` anywhere (not only FROM/image:): deploy files, Dockerfiles, compose
  // files and the local image's launcher (docker/).
  const deployFiles = files.filter((f) => /(^|\/)cloudbuild[\w.-]*\.ya?ml$/.test(f) || /^terraform\/.+\.tf$/.test(f) || /^\.github\/workflows\//.test(f)
    || /(^|\/)Dockerfile(\.[\w.-]+)?$/.test(f) || /(^|\/)(docker-)?compose[\w.-]*\.ya?ml$/.test(f) || /^docker\//.test(f));
  for (const file of deployFiles) {
    read(file).split('\n').forEach((line, i) => {
      if (!isComment(line) && /:latest\b/.test(line.replace(/\s#.*$/, ''))) mutable.push(`${file}:${i + 1}  ${line.trim()}`);
    });
  }
  check('No :latest image references in Dockerfiles, compose, Cloud Build, Terraform, workflows or docker/', mutable.length === 0, mutable.join('\n'));

  // Cloud Build builder images without a tag resolve to :latest. Reported, not failed: pinning them
  // changes the production deploy pipeline and is tracked as hardening work.
  for (const file of files.filter((f) => /(^|\/)cloudbuild[\w.-]*\.ya?ml$/.test(f))) {
    read(file).split('\n').forEach((line, i) => {
      const step = isComment(line) ? null : line.match(/^\s*-\s*name:\s*['"]?([^'"\s#]+)/);
      if (step && imagePin(step[1]) === 'untagged') warn(`${file}:${i + 1} builder image without a tag (implied :latest): ${step[1]}`);
    });
  }

  // Mermaid security settings. Source scan is a tripwire; the `render` mode proves the behaviour.
  const sources = files.filter((f) => /^(backend|frontend|docker)\/.+\.(js|mjs|cjs|ts|tsx|jsx)$/.test(f) && !/(^|\/)(tests?|node_modules)\//.test(f) && !/\.test\.[a-z]+$/.test(f));
  const weakened = [];
  for (const file of sources) {
    read(file).split('\n').forEach((line, i) => {
      if (isComment(line)) return;
      for (const m of line.matchAll(/securityLevel['"]?\s*[:=]\s*['"`]?([A-Za-z]+)/g)) {
        if (m[1] !== 'strict') weakened.push(`${file}:${i + 1}  securityLevel is "${m[1]}"`);
      }
      if (/htmlLabels['"]?\s*[:=]\s*true\b/.test(line)) weakened.push(`${file}:${i + 1}  htmlLabels enabled`);
    });
  }
  check('No Mermaid config sets securityLevel other than strict, or htmlLabels: true', weakened.length === 0, weakened.join('\n'));

  const renderer = read('backend/routes/generate.js');
  check("Renderer initialises Mermaid with securityLevel: 'strict'", /securityLevel:\s*'strict'/.test(renderer));
  // Root level means the indentation of securityLevel: the per-diagram settings are nested deeper.
  const rootHtmlLabelsOff = (source) => {
    const indent = source.match(/^([ \t]*)securityLevel:\s*'strict'/m)?.[1];
    return indent !== undefined && new RegExp(`^${indent}htmlLabels:\\s*false,`, 'm').test(source);
  };
  check('Renderer initialises Mermaid with root-level htmlLabels: false', rootHtmlLabelsOff(renderer));
  const editor = read('frontend/src/components/DiagramEditor.tsx');
  check("Editor preview initialises Mermaid with securityLevel: 'strict'", /securityLevel:\s*'strict'/.test(editor));
  check('Editor preview initialises Mermaid with root-level htmlLabels: false', rootHtmlLabelsOff(editor));
  // `secure` lists the keys a diagram cannot override with an init directive or front matter.
  const locksHtmlLabels = (source) => /secure:\s*\[[^\]]*'securityLevel'[^\]]*'htmlLabels'[^\]]*\]/.test(source);
  check('Renderer and editor forbid diagrams from overriding securityLevel and htmlLabels', locksHtmlLabels(renderer) && locksHtmlLabels(editor));

  // Preview and export must run the same Mermaid.
  const spec = (dir) => JSON.parse(read(`${dir}/package.json`)).dependencies?.mermaid;
  const locked = (dir) => JSON.parse(read(`${dir}/package-lock.json`)).packages?.['node_modules/mermaid']?.version;
  check('Mermaid version range is identical in backend and frontend', Boolean(spec('backend')) && spec('backend') === spec('frontend'), `backend ${spec('backend')} / frontend ${spec('frontend')}`);
  check('Mermaid locked version is identical in backend and frontend', Boolean(locked('backend')) && locked('backend') === locked('frontend'), `backend ${locked('backend')} / frontend ${locked('frontend')}`);

  // Arbitrary-HTML rendering stays off wherever the service is built or deployed (CI may turn it
  // on for a throwaway container to test egress, so workflows are not scanned here).
  const htmlOn = [];
  for (const file of files.filter((f) => /(^|\/)(Dockerfile[\w.-]*|(docker-)?compose[\w.-]*\.ya?ml|cloudbuild[\w.-]*\.ya?ml|\.env[\w.-]*)$/.test(f) || /^(terraform|docker)\//.test(f))) {
    read(file).split('\n').forEach((line, i) => {
      if (!isComment(line) && /ALLOW_HTML_RENDER["']?\s*[=:]\s*["']?true/i.test(line)) htmlOn.push(`${file}:${i + 1}`);
    });
  }
  check('ALLOW_HTML_RENDER is not enabled in any build or deploy file', htmlOn.length === 0, htmlOn.join('\n'));

  // The local image (root Dockerfile): the last USER is not root, and no pack reaches the image. A
  // COPY/ADD source that is a `packs` directory or a pack file fails; scripts/packs/ is the packs
  // command's code, not packs. The build context must keep the source trees' pack directories out.
  if (fs.existsSync(path.join(ROOT, 'Dockerfile'))) {
    const problems = [];
    const lines = read('Dockerfile').split('\n');
    const users = lines.filter((l) => !isComment(l) && /^\s*USER\s+/i.test(l)).map((l) => l.trim().split(/\s+/)[1]);
    const lastUser = users.at(-1);
    if (!lastUser) problems.push('Dockerfile: no USER line');
    else if (/^(root|0)(:.*)?$/.test(lastUser)) problems.push(`Dockerfile: last USER is ${lastUser}`);
    lines.forEach((line, i) => {
      const copy = isComment(line) ? null : line.match(/^\s*(COPY|ADD)\s+(.*)$/i);
      if (!copy) return;
      const sources = copy[2].split(/\s+/).filter((a) => a && !a.startsWith('--')).slice(0, -1);
      for (const src of sources) {
        const clean = src.replace(/^\.\//, '').replace(/\/+$/, '');
        const packsDir = clean.split('/').includes('packs') && clean !== 'scripts/packs';
        if (packsDir || /(^|\/)gcp[\w-]*\.json$/.test(clean)) problems.push(`Dockerfile:${i + 1}  copies ${src}`);
      }
    });
    const ignore = fs.existsSync(path.join(ROOT, '.dockerignore')) ? read('.dockerignore').split('\n').map((l) => l.trim()) : null;
    if (!ignore) problems.push('.dockerignore is missing');
    else for (const dir of ['backend/packs', 'frontend/public/packs']) if (!ignore.includes(dir)) problems.push(`.dockerignore does not exclude ${dir}`);
    check('Local image runs as a non-root user and sets no vendor pack', problems.length === 0, problems.join('\n'));
  }

  // No private keys or service-account key files in the tree.
  const keys = [];
  for (const file of files) {
    const full = path.join(ROOT, file);
    let stat;
    try { stat = fs.statSync(full); } catch { continue; }
    if (!stat.isFile() || stat.size > 2 * 1024 * 1024) continue;
    const text = fs.readFileSync(full, 'latin1');
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) keys.push(`${file}  private key block`);
    if (/"type"\s*:\s*"service_account"/.test(text)) keys.push(`${file}  service-account key file`);
  }
  check('No private keys or service-account key files are tracked', keys.length === 0, keys.join('\n'));

  // Google Cloud trademark notice stays in the README, NOTICE.md and the pack recipe, whose notices
  // become the editor footer and the export notice; and in every generated pack file present.
  const notice = /trademarks of Google LLC/;
  const has = (value) => typeof value === 'string' && notice.test(value);
  const missing = ['README.md', 'NOTICE.md'].filter((f) => !notice.test(read(f)));
  let recipe = null;
  try { recipe = JSON.parse(read('icons/gcp/mapping.json')).pack?.notice; } catch { /* reported below */ }
  if (!has(recipe?.editor)) missing.push('icons/gcp/mapping.json pack.notice.editor');
  if (!has(recipe?.export)) missing.push('icons/gcp/mapping.json pack.notice.export');
  const parsed = (rel) => { try { return JSON.parse(read(rel)); } catch { return null; } };
  for (const rel of ['backend/packs/gcp.json', 'frontend/public/packs/gcp.json']) {
    if (!fs.existsSync(path.join(ROOT, rel))) continue;
    const n = parsed(rel)?.sirenia?.notice;
    if (!has(n?.editor) || !has(n?.export)) missing.push(`${rel} sirenia.notice.editor/export`);
  }
  for (const rel of ['backend/packs/index.json', 'frontend/public/packs/index.json']) {
    if (!fs.existsSync(path.join(ROOT, rel)) || !fs.existsSync(path.join(ROOT, path.dirname(rel), 'gcp.json'))) continue;
    const entry = parsed(rel)?.packs?.find?.((p) => p.prefix === 'gcp');
    if (!has(entry?.notice?.editor)) missing.push(`${rel} gcp notice.editor`);
  }
  check('Google Cloud trademark notice present in README, NOTICE.md, the pack recipe (editor and export notices) and the generated packs', missing.length === 0, `missing in: ${missing.join(', ')}`);

  // Licence: the unmodified Apache-2.0 text, and every package manifest declares it.
  const APACHE_2_SHA256 = 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30';
  const licenceFile = path.join(ROOT, 'LICENSE');
  const licenceHash = fs.existsSync(licenceFile) ? crypto.createHash('sha256').update(fs.readFileSync(licenceFile)).digest('hex') : 'missing';
  check('LICENSE is the unmodified Apache License 2.0 text', licenceHash === APACHE_2_SHA256, `sha256 ${licenceHash}`);
  const undeclared = ['package.json', 'backend/package.json', 'frontend/package.json'].filter((f) => JSON.parse(read(f)).license !== 'Apache-2.0');
  check('Every package manifest declares Apache-2.0', undeclared.length === 0, undeclared.join(', '));
  // Documentation names the published image with a version: it must be the current one, so that a
  // version bump cannot leave the README behind. Changelogs name older versions on purpose.
  const version = parsed('package.json')?.version;
  const staleImages = [];
  for (const f of files.filter((x) => /\.md$/i.test(x) && !/(^|\/)CHANGELOG\.md$/i.test(x) && fs.existsSync(path.join(ROOT, x)))) {
    read(f).split('\n').forEach((line, i) => {
      for (const m of line.matchAll(/ghcr\.io\/[a-z0-9._/-]+:(\d+\.\d+\.\d+)/g)) {
        if (m[1] !== version) staleImages.push(`${f}:${i + 1} ${m[0]}`);
      }
    });
  }
  check(`Documentation names the published image at the current version (${version})`, Boolean(version) && staleImages.length === 0, staleImages.join(', '));
  const copyright = /^Copyright \d{4} Hiram Sanchez$/m;
  const uncredited = ['NOTICE.md', 'README.md'].filter((f) => !copyright.test(read(f)));
  check('Copyright line present in NOTICE.md and README', uncredited.length === 0, `missing in: ${uncredited.join(', ')}`);

  // Hosted edition: the cloudbuild files are absent from the public copy of this repository.
  const feBuild = path.join(ROOT, 'frontend/cloudbuild.yaml');
  const beBuild = path.join(ROOT, 'backend/cloudbuild.yaml');
  if (fs.existsSync(feBuild) && fs.existsSync(beBuild)) {
    const fe = read('frontend/cloudbuild.yaml');
    const be = read('backend/cloudbuild.yaml');
    check(
      'Clonix edition builds pass their branding settings',
      fe.includes('BRANDING_FILE=branding/clonix.json') && fe.includes('BACKEND_URL=https://') && be.includes('PRODUCT_NAME=Clonix Secure Diagram Studio'),
      'frontend/cloudbuild.yaml needs BRANDING_FILE=branding/clonix.json and BACKEND_URL=https://...; backend/cloudbuild.yaml needs PRODUCT_NAME=Clonix Secure Diagram Studio'
    );
    // Hiram's rule for the hosted edition: it says which open-source project it is built from.
    const basedOn = parsed('frontend/branding/clonix.json')?.basedOn;
    check(
      'Clonix edition states that it is based on Sirenia',
      basedOn?.name === 'Sirenia' && basedOn?.url === 'https://github.com/hiranez/sirenia' && read('frontend/src/components/DiagramEditor.tsx').includes('branding.basedOn.url'),
      'frontend/branding/clonix.json needs basedOn { name: "Sirenia", url: "https://github.com/hiranez/sirenia" } and the editor footer must render it'
    );
    // The hosted edition ships the Google Cloud pack in both images, and CI proves it renders.
    const packsMissing = ['backend/packs/gcp.json', 'frontend/public/packs/gcp.json'].filter((f) => !fs.existsSync(path.join(ROOT, f)));
    check('Clonix edition ships the Google Cloud icon pack in both images', packsMissing.length === 0, `missing: ${packsMissing.join(', ')}`);
    const workflow = path.join(ROOT, '.github/workflows/security.yml');
    check(
      'Clonix edition CI runs the render gate with --pack-icon gcp:cloud-run',
      fs.existsSync(workflow) && /verify-invariants\.mjs render[^\n]*(?:\\\n[^\n]*)*--pack-icon gcp:cloud-run/.test(read('.github/workflows/security.yml')),
      '.github/workflows/security.yml must pass --pack-icon gcp:cloud-run to verify-invariants.mjs render'
    );
  }
}

// ---------------------------------------------------------------------------------------------
// render
// ---------------------------------------------------------------------------------------------

function request(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers, timeout: 60000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('timeout', () => req.destroy(new Error(`timeout: ${method} ${url}`)));
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Markup that could run code or load a resource if it survived into an exported SVG. The embedded
// source (<metadata>) is escaped text and is excluded: it legitimately contains what the user typed.
function activeContent(svg) {
  const body = svg.replace(/<metadata>[\s\S]*?<\/metadata>/g, '');
  const found = [];
  if (/<\s*(script|img|iframe|object|embed|link|meta|base|form|input|video|audio)\b/i.test(body)) found.push('HTML or script element');
  if (/<[^<>]+\son[a-z]+\s*=/i.test(body)) found.push('event-handler attribute');
  if (/(href|src)\s*=\s*["']?\s*(javascript|vbscript):/i.test(body)) found.push('script URL');
  return found;
}

async function runRender(args) {
  const base = args.find((a) => /^https?:\/\//.test(a))?.replace(/\/$/, '');
  const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const canaryHost = option('--canary-host') || '127.0.0.1';
  const controlCmd = option('--control-cmd');
  const htmlMode = args.includes('--html-mode');
  const packIcon = option('--pack-icon');
  if (!base || !controlCmd || (args.includes('--pack-icon') && !/^[a-z][a-z0-9]*(-[a-z0-9]+)*:[a-z0-9]+(-[a-z0-9]+)*$/.test(packIcon || ''))) {
    console.error('usage: verify-invariants.mjs render <backend-url> --control-cmd <cmd> [--canary-host <host>] [--html-mode] [--pack-icon <prefix:name>]');
    process.exit(2);
  }

  const generate = (payload) =>
    request(`${base}/api/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });

  // Canary: any request the backend's renderer makes to this listener is an egress leak.
  const hits = [];
  const canary = http.createServer((req, res) => {
    hits.push(req.url);
    res.writeHead(200, { 'content-type': 'image/png' }).end();
  });
  await new Promise((resolve) => canary.listen(0, '0.0.0.0', resolve));
  const origin = `http://${canaryHost}:${canary.address().port}`;

  try {
    // Positive control first: without it, an unreachable canary would look like a clean result.
    try {
      execSync(`${controlCmd} ${origin}/control`, { stdio: 'ignore', timeout: 20000 });
    } catch { /* judged by whether the hit arrived */ }
    for (let i = 0; i < 20 && !hits.includes('/control'); i++) await sleep(250);
    check('Canary is reachable from the backend (positive control)', hits.includes('/control'), `no request reached ${origin}/control via: ${controlCmd}`);

    if (htmlMode) {
      const html = [
        `<img src="${origin}/html-img">`,
        `<link rel="stylesheet" href="${origin}/html-css">`,
        `<iframe src="${origin}/html-iframe"></iframe>`,
        `<meta http-equiv="refresh" content="0;url=${origin}/html-refresh">`,
        `<img src="x" onerror="fetch('${origin}/html-fetch');new Image().src='${origin}/html-image';location.href='${origin}/html-nav'">`,
      ].join('');
      const res = await generate({ code: html, type: 'html', output: 'png' });
      check('HTML mode is on for this instance (so the egress test below is meaningful)', res.status !== 403, `status ${res.status}`);
    } else {
      await defaultModeChecks(base, generate, origin, packIcon);
    }

    await sleep(2000); // let any stray request arrive
    const leaks = hits.filter((h) => h !== '/control');
    check(`Renderer made no outbound request (${htmlMode ? 'arbitrary HTML' : 'Mermaid'} mode)`, leaks.length === 0, `canary received: ${leaks.join(', ')}`);
  } finally {
    canary.close();
  }
}

async function defaultModeChecks(base, generate, origin, packIcon) {
  // Baseline renders carry provenance.
  const png = await generate({ code: 'graph TD; A-->B;', output: 'png' });
  check('PNG render returns a PNG with embedded source', png.status === 200 && png.body.subarray(0, 4).toString('latin1') === '\x89PNG' && png.body.includes('SireniaSource'), `status ${png.status}`);
  check('Image responses are nosniff and not cacheable', png.headers['x-content-type-options'] === 'nosniff' && png.headers['cache-control'] === 'no-store');
  check('x-powered-by is not exposed', png.headers['x-powered-by'] === undefined);
  const svg = await generate({ code: 'graph TD; A-->B;', output: 'svg' });
  check('SVG render returns an SVG with embedded source', svg.status === 200 && svg.body.includes('<SireniaSource>'), `status ${svg.status}`);

  // securityLevel strict + htmlLabels false: markup in labels stays text, click bindings are dropped.
  const label = await generate({ code: 'graph TD\n  A["<img src=x onerror=alert(1)><script>alert(1)</script>"] --> B', output: 'svg' });
  const labelSvg = label.body.toString('utf8');
  check('HTML in a label is not emitted as markup', label.status === 200 && activeContent(labelSvg).length === 0, `status ${label.status}; found: ${activeContent(labelSvg).join(', ')}`);
  check('Labels are SVG text, not HTML (no foreignObject)', label.status === 200 && !/<foreignObject/i.test(labelSvg));

  const click = await generate({ code: 'graph TD\n  A-->B\n  click A call alert(1)\n  click B href "javascript:alert(1)"', output: 'svg' });
  const clickSvg = click.body.toString('utf8');
  check('Click bindings and javascript: links are dropped', click.status === 200 && activeContent(clickSvg).length === 0, `status ${click.status}; found: ${activeContent(clickSvg).join(', ')}`);

  // A diagram cannot talk the renderer out of strict mode with an init directive.
  const directive = await generate({
    code: '%%{init: {"securityLevel": "loose", "htmlLabels": true, "flowchart": {"htmlLabels": true}}}%%\ngraph TD\n  A["<img src=x onerror=alert(1)>"] --> B\n  click A call alert(1)\n  click B href "javascript:alert(1)"',
    output: 'svg',
  });
  const directiveSvg = directive.body.toString('utf8');
  check('An init directive cannot re-enable active content', directive.status === 200 && activeContent(directiveSvg).length === 0, `status ${directive.status}; found: ${activeContent(directiveSvg).join(', ')}`);
  check('An init directive cannot switch labels to HTML (no foreignObject)', directive.status === 200 && !/<foreignObject/i.test(directiveSvg));

  // Arbitrary-HTML rendering is off by default.
  const html = await generate({ code: '<b>x</b>', type: 'html' });
  check('HTML render mode is refused by default (403)', html.status === 403, `status ${html.status}`);

  // Input limits.
  const tooLong = await generate({ code: `graph TD; A["${'x'.repeat(10001)}"]` });
  check('Diagram source over 10,000 characters is refused (400)', tooLong.status === 400, `status ${tooLong.status}`);
  const tooBig = await generate({ code: 'x'.repeat(70 * 1024) });
  check('Request body over 64 KB is refused (413)', tooBig.status === 413, `status ${tooBig.status}`);

  // Icon validation and the notice that travels with pack icons (only with --pack-icon: which packs
  // a backend has installed is up to its operator).
  const packDiagram = packIcon && `architecture-beta\n  service a(${packIcon})[Pack icon]`;
  if (packIcon) {
    // Icon names are lowercase: upper-casing the first letter of the name makes it unknown.
    const colon = packIcon.indexOf(':');
    const wrongCase = `${packIcon.slice(0, colon + 1)}${packIcon.charAt(colon + 1).toUpperCase()}${packIcon.slice(colon + 2)}`;
    const badIcon = await generate({ code: `architecture-beta\n  service a(${wrongCase})[Pack icon]`, output: 'svg' });
    check(`Unknown icon name is refused (400): ${wrongCase}`, badIcon.status === 400, `status ${badIcon.status}`);
    const icon = await generate({ code: packDiagram, output: 'svg' });
    check(`Export using pack icons carries the pack's notice (${packIcon})`, icon.status === 200 && (icon.body.toString('utf8').match(/<Disclaimer>/g) || []).length === 1, `status ${icon.status}`);
  } else {
    console.log('skip  icon-pack checks (unknown icon refused, pack notice in export, pack diagram exports): no --pack-icon passed');
  }

  // CORS denies by default: no cross-origin browser may call the API.
  const evil = { origin: 'https://evil.example' };
  const preflight = await request(`${base}/api/generate`, { method: 'OPTIONS', headers: { ...evil, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } });
  const cross = await request(`${base}/api/generate`, { method: 'POST', headers: { ...evil, 'content-type': 'application/json' }, body: JSON.stringify({ code: 'graph TD; A-->B;', output: 'svg' }) });
  check('CORS: no Access-Control-Allow-Origin for a foreign origin', preflight.headers['access-control-allow-origin'] === undefined && cross.headers['access-control-allow-origin'] === undefined);

  // Egress vectors. Each asks the renderer's browser to load something from the canary. A vector
  // is "armed" when the reference provably reached the rendered document: either it is in the
  // output, or the renderer refused the diagram because it found the reference there. At least
  // one must be armed (otherwise this test has stopped testing anything).
  // (Mermaid turns single quotes in a directive into double quotes, so the CSS uses none.)
  const vectors = {
    'theme CSS': `%%{init: {"themeCSS": "@import url(${origin}/css-import); .node rect { fill: url(${origin}/css-url#p); }"}}%%\ngraph TD; A-->B;`,
    'theme CSS, rule that matches nothing': `%%{init: {"themeCSS": ".no-such-class:hover { background: url(${origin}/css-unmatched); }"}}%%\ngraph TD; A-->B;`,
    'font family': `%%{init: {"fontFamily": "a; background-image: url(${origin}/font-family)"}}%%\ngraph TD; A-->B;`,
    'image shape': `flowchart TD\n  A@{ img: "${origin}/img-shape", label: "x", pos: "t", w: 60, h: 60, constraint: "off" }\n  A --> B`,
    'label markup': `graph TD\n  A["<img src='${origin}/label-img'>"] --> B`,
    'HTML label via directive': `%%{init: {"htmlLabels": true, "flowchart": {"htmlLabels": true}}}%%\ngraph TD\n  A["<img src=${origin}/directive-img>"] --> B`,
  };
  const armed = [];
  const leaked = [];
  for (const [name, code] of Object.entries(vectors)) {
    for (const output of ['svg', 'png']) {
      const res = await generate({ code, output });
      if (res.status === 400 && /"code":"external_reference"/.test(res.body.toString('utf8'))) {
        if (!armed.includes(name)) armed.push(name);
      } else if (output === 'svg' && res.status === 200) {
        const body = res.body.toString('utf8').replace(/<metadata>[\s\S]*?<\/metadata>/g, '');
        if (body.includes(origin)) leaked.push(name);
      }
    }
  }
  check('Egress test is armed (a canary URL reached the rendered document)', armed.length + leaked.length > 0, 'no vector reached the rendered document: update the vectors for this Mermaid version');
  console.log(`      armed vectors: ${[...armed, ...leaked].join(', ') || 'none'}`);
  // Exports must be self-contained: the embedded source (<metadata>) may quote the URL as text,
  // but nothing in the drawing itself may point outside the file.
  check('No exported SVG refers to an external resource', leaked.length === 0, `URL present in the output for: ${leaked.join(', ')}`);

  // The refusal must not catch ordinary diagrams: styling, same-document markers, hyperlinks.
  const ordinary = {
    'styles and markers': 'flowchart LR\n  A --> B -.-> C\n  classDef hot fill:#f96,stroke:#333\n  class A hot\n  style B fill:#bbf,stroke-dasharray: 5 5',
    'plain theme CSS': '%%{init: {"themeCSS": ".node rect { fill: #ff0; }"}}%%\ngraph TD; A-->B;',
    hyperlink: 'flowchart TD\n  A --> B\n  click A href "https://example.com/docs" "Docs"',
    ...(packDiagram ? { [`icon pack (${packIcon})`]: packDiagram } : {}),
    sequence: 'sequenceDiagram\n  A->>B: Hello\n  B-->>A: Hi',
  };
  const refusedOrdinary = [];
  for (const [name, code] of Object.entries(ordinary)) {
    for (const output of ['svg', 'png']) {
      const res = await generate({ code, output });
      if (res.status !== 200) refusedOrdinary.push(`${name} (${output}: ${res.status})`);
    }
  }
  check('Self-contained diagrams still export', refusedOrdinary.length === 0, refusedOrdinary.join(', '));
}

// ---------------------------------------------------------------------------------------------

const [mode, ...rest] = process.argv.slice(2);
if (mode === 'static') runStatic();
else if (mode === 'render') await runRender(rest);
else {
  console.error('usage: verify-invariants.mjs static | render <backend-url> --control-cmd <cmd> [--canary-host <host>] [--html-mode] [--pack-icon <prefix:name>]');
  process.exit(2);
}
console.log(failures.length ? `\n${failures.length} invariant check(s) FAILED` : '\nAll invariant checks passed');
process.exit(failures.length ? 1 : 0);
