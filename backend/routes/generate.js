const fs = require('node:fs');
const puppeteer = require('puppeteer');
const { injectMetadata } = require('../utils/metadata');
const { iconPacksScript, packsForRender, findUnknownIcons, findMissingPacks, packsUsedBy, attributionNotice } = require('../utils/icons');
const { COLLECT_EXTERNAL_REFS_SCRIPT } = require('../utils/externalRefs');

// ---- Security / resource constants -----------------------------------------
const MAX_CODE_LENGTH = 10000;            // 10KB diagram source ceiling
const RENDER_TIMEOUT = 30000;             // per-page operation timeout
const RENDER_HARD_DEADLINE = Number(process.env.RENDER_HARD_DEADLINE_MS) || 35000; // overall per-request wall-clock guard
// Chrome normally starts in a few seconds, but a slow instance start has taken > 30 s in production
// (Puppeteer's default), which turned a slow start into a failed one. Requests stay bounded by
// RENDER_HARD_DEADLINE regardless of this value.
const BROWSER_LAUNCH_TIMEOUT = Number(process.env.BROWSER_LAUNCH_TIMEOUT_MS) || 120000;
const WARMUP_DIAGRAM = 'graph TD; A-->B;';
const ALLOWED_TYPES = new Set(['mermaid', 'html']);
const ALLOWED_OUTPUTS = new Set(['png', 'svg']);
// Arbitrary-HTML screenshotting is an abuse/SSRF surface; off unless explicitly enabled.
const ALLOW_HTML_RENDER = process.env.ALLOW_HTML_RENDER === 'true';
// Key under which the diagram source is embedded in every export (SVG <metadata> element, PNG iTXt
// keyword). Exports made before the rename carry it as ClonixSource; the editor reads both.
const SOURCE_KEY = 'SireniaSource';

// Mermaid is bundled into the image and injected locally — never fetched from a CDN at
// render time. This removes the third-party supply-chain dependency AND lets us block all
// outbound network from the renderer (SSRF defense) without breaking rendering.
const MERMAID_PATH = require.resolve('mermaid/dist/mermaid.min.js');
// Read once at module load; fail fast at startup if the bundle is missing.
const MERMAID_SRC = fs.readFileSync(MERMAID_PATH, 'utf8');
// Icon packs are read from the local packs directory the same way (PACKS_DIR), see utils/icons.js.
// Each render page gets only the packs its diagram refers to: the vendor packs are megabytes of
// JSON, and parsing all of them on every page made every export slower.

// One JSON object per line: Cloud Logging parses it into jsonPayload, so launch and render
// durations can be charted and alerted on. Never include diagram content.
function logEvent(event, fields) {
  console.log(JSON.stringify({ event, ...fields }));
}

// Reuse a single browser across requests (cheaper + fewer cold starts than per-request launch).
let browserPromise = null;
async function getBrowser() {
  if (!browserPromise) {
    const launchStarted = Date.now();
    browserPromise = puppeteer
      .launch({
        headless: 'new',
        timeout: BROWSER_LAUNCH_TIMEOUT,
        args: [
          '--no-sandbox',              // Cloud Run has no user namespaces; sandbox unavailable.
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-extensions',
          '--disable-background-networking',
          '--no-first-run',
        ],
      })
      .then((browser) => {
        logEvent('browser_launch', { ms: Date.now() - launchStarted });
        // CRITICAL: if Chrome crashes/exits after launch, drop the cached promise so the next
        // request relaunches instead of reusing a dead browser (otherwise the instance wedges
        // into permanent 500s while /health still reports healthy).
        browser.on('disconnected', () => {
          browserPromise = null;
        });
        return browser;
      })
      .catch((err) => {
        browserPromise = null; // allow retry on next request
        logEvent('browser_launch_failed', { ms: Date.now() - launchStarted, error: err && err.message });
        throw err;
      });
  }
  const pending = browserPromise;
  const browser = await pending;
  // Guard against a crash that happened between requests. Only the caller that still sees the
  // dead promise clears it, so concurrent callers can't each relaunch and orphan browsers.
  if (!browser.connected) {
    if (browserPromise === pending) browserPromise = null;
    return getBrowser();
  }
  return browser;
}

// Minimal document. No external <script>/<link>: Mermaid is injected via addScriptTag(path).
const getMermaidShell = () => `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
  *{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff}
  body{display:flex;align-items:flex-start;justify-content:flex-start;padding:40px}
  #c{display:inline-block;width:max-content}
  text,tspan{font-family:Arial,sans-serif}
</style></head><body><div id="c"></div></body></html>`;

const getHtmlShell = () => `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>body{margin:0;padding:0;display:inline-block}</style></head><body><div id="c"></div></body></html>`;

/**
 * Abort every network request except the initial document load. The renderer must not reach
 * the GCP metadata server, internal services, or arbitrary external hosts (SSRF defense).
 */
// Requests each page tried to make and had refused. A diagram that makes the page ask for
// anything is not self-contained, so the render is refused (see renderToBuffer).
const blockedRequests = new WeakMap();

async function lockdownPage(page) {
  const blocked = [];
  blockedRequests.set(page, blocked);
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = req.url();
    // Allow ONLY local-document schemes. The legitimate render uses setContent (about:blank)
    // + addScriptTag({content}) (inline) and needs no http(s) request at all. This also blocks
    // attacker-driven MAIN-FRAME navigations (e.g. <meta http-equiv="refresh"> / location) to
    // http(s) — not just subresources — closing the SSRF path even when html mode is enabled.
    if (url.startsWith('data:') || url.startsWith('about:') || url.startsWith('blob:')) {
      return req.continue();
    }
    blocked.push(url);
    return req.abort('blockedbyclient'); // http(s), ws, file, and any http(s) navigation
  });
  page.setDefaultTimeout(RENDER_TIMEOUT);
  page.setDefaultNavigationTimeout(RENDER_TIMEOUT);
}

function badRequest(res, message) {
  return res.status(400).json({ error: message });
}

async function generateImage(req, res) {
  const body = req.body || {};
  const { code } = body;
  const type = body.type === undefined ? 'mermaid' : body.type;
  const output = body.output === undefined ? 'png' : body.output;

  // ---- Strict input validation (allowlists; reject non-string/oversized/unknown) ----------
  if (typeof code !== 'string' || code.length === 0) {
    return badRequest(res, 'Missing or invalid "code" (expected non-empty string).');
  }
  if (code.length > MAX_CODE_LENGTH) {
    return badRequest(res, `Diagram code exceeds maximum length (${MAX_CODE_LENGTH / 1000}KB).`);
  }
  if (typeof type !== 'string' || !ALLOWED_TYPES.has(type)) {
    return badRequest(res, 'Invalid "type" (expected "mermaid" or "html").');
  }
  if (typeof output !== 'string' || !ALLOWED_OUTPUTS.has(output)) {
    return badRequest(res, 'Invalid "output" (expected "png" or "svg").');
  }
  if (type === 'html' && !ALLOW_HTML_RENDER) {
    return res.status(403).json({ error: 'Arbitrary HTML rendering is disabled on this service.' });
  }
  if (type === 'html' && output === 'svg') {
    return badRequest(res, 'SVG output is only supported for Mermaid diagrams.');
  }
  if (type === 'mermaid') {
    // Unknown names in an installed pack (e.g. `gcp:`) would otherwise render Mermaid's "?"
    // placeholder into the exported image. Fail early with the exact offending names.
    // A pack this installation has a recipe for but has not installed: say how to install it.
    const [notInstalled] = findMissingPacks(code);
    if (notInstalled) {
      return res.status(400).json({
        error: `This diagram uses icons from the "${notInstalled.label}" pack (${notInstalled.prefix}:), which is not installed. Install it with: packs add ${notInstalled.prefix}`,
        code: 'icon_pack_missing',
      });
    }
    const unknown = findUnknownIcons(code);
    if (unknown.length) {
      return badRequest(res, `Unknown icon(s): ${unknown.join(', ')}. Icon names are lowercase; see the pack's icon catalog for valid names.`);
    }
  }

  const started = Date.now();
  let browserMs = null; // time spent waiting for the shared browser (large only if it had to launch)
  let page;
  let timer;
  let abandoned = false; // set once the reply has been decided; late work must clean up after itself
  // Bound the WHOLE request — browser acquisition included — against a rejecting deadline, so a
  // hung newPage() or a hung screenshot cannot block past RENDER_HARD_DEADLINE. page.close() in
  // finally does not by itself abort an in-flight captureScreenshot, so the race guarantees a reply.
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('render-timeout')), RENDER_HARD_DEADLINE);
  });
  deadline.catch(() => {}); // never let the deadline surface as an unhandled rejection

  // Acquisition + render as one promise so both phases are inside the race.
  const work = (async () => {
    const browser = await getBrowser();
    browserMs = Date.now() - started;
    if (abandoned) throw new Error('abandoned');
    const opened = await browser.newPage();
    if (abandoned) {
      // The deadline fired while the browser or the page was still coming up: nobody will close
      // this page in `finally`, so close it here instead of leaving it rendering.
      opened.close().catch(() => {});
      throw new Error('abandoned');
    }
    page = opened;
    await lockdownPage(page);
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    return renderToBuffer(page, type, output, code);
  })();
  work.catch(() => {}); // if work loses the race, swallow its late rejection (reply already sent)

  try {
    const result = await Promise.race([work, deadline]);

    if (result.syntaxError) {
      return badRequest(res, 'Mermaid syntax error. Please check your diagram code.');
    }
    if (result.externalReference) {
      return res.status(400).json({
        error: 'This diagram refers to an external resource (for example a URL in theme CSS or an image). '
          + 'Exports must be self-contained: remove the reference and try again.',
        code: 'external_reference',
      });
    }
    if (!result.buffer || result.buffer.length === 0) {
      throw new Error('Failed to generate image buffer');
    }

    let smartBuffer = injectMetadata(result.buffer, SOURCE_KEY, code);
    const notice = type === 'mermaid' ? attributionNotice(packsUsedBy(code)) : null;
    if (notice) {
      // The notices of the packs used travel with the file, as ONE entry (PNG iTXt "Disclaimer" /
      // SVG <metadata>).
      smartBuffer = injectMetadata(smartBuffer, 'Disclaimer', notice);
    }
    res.setHeader('Content-Type', output === 'svg' ? 'image/svg+xml' : 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(smartBuffer);
  } catch (error) {
    console.error(`[${req.id}] Generation error:`, error && error.message);
    if (!res.headersSent) {
      const status = error && error.message === 'render-timeout' ? 504 : 500;
      res.status(status).json({ error: 'Failed to generate diagram', requestId: req.id });
    }
  } finally {
    abandoned = true;
    clearTimeout(timer);
    logEvent('render', { requestId: req.id, type, output, status: res.statusCode, ms: Date.now() - started, browserMs });
    // Close the page regardless; if a screenshot is still hung, this frees the target. The
    // browser itself stays up for other requests (and self-heals via the disconnected handler).
    if (page) page.close().catch(() => {});
  }
}

// Render the diagram to an image buffer. Returns { buffer }, or { syntaxError:true } for an
// invalid Mermaid diagram, or { externalReference:true } for a diagram that is not self-contained
// (both user errors, surfaced as 400 — not a 500).
async function renderToBuffer(page, type, output, code) {
  if (type === 'mermaid') {
    await page.setContent(getMermaidShell(), { waitUntil: 'domcontentloaded' });
    // Inject the bundled Mermaid runtime and the icon packs the diagram refers to, from memory
    // (read from local disk at start-up; no network).
    await page.addScriptTag({ content: MERMAID_SRC });
    await page.addScriptTag({ content: iconPacksScript(packsForRender(code)) });

    // securityLevel:'strict' disables HTML/JS in labels and click bindings; htmlLabels:false
    // keeps text as SVG <text>.
    const result = await page.evaluate(async (diagramCode) => {
      // Icon packs are registered synchronously (no loader → no fetch), so pack icons resolve
      // inside the network-locked page. Mermaid resolves Iconify aliases natively.
      // eslint-disable-next-line no-undef
      window.mermaid.registerIconPacks(window.__ICON_PACKS__.map((p) => ({ name: p.prefix, icons: p })));
      // eslint-disable-next-line no-undef
      window.mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        htmlLabels: false,
        // Keys a diagram cannot override with an init directive or front matter: Mermaid's own
        // list plus htmlLabels, so a diagram cannot switch its labels back to HTML.
        secure: ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'suppressErrorRendering', 'maxEdges', 'htmlLabels'],
        logLevel: 'error',
        theme: 'default',
        flowchart: { useMaxWidth: false, htmlLabels: false, curve: 'linear' },
        sequence: { useMaxWidth: false },
        // Without a width, a Gantt chart takes the width of the element it is rendered in: here an
        // empty one, which made the chart 300 px wide. The editor's preview uses the same value.
        gantt: { useMaxWidth: false, useWidth: 1200 },
        classDiagram: { useMaxWidth: false, htmlLabels: false },
        state: { useMaxWidth: false },
        architecture: { useMaxWidth: false },
      });
      try {
        // eslint-disable-next-line no-undef
        const { svg } = await window.mermaid.render('diagram-out', diagramCode);
        document.getElementById('c').innerHTML = svg;
        return { ok: true, svg };
      } catch (e) {
        return { ok: false, error: String(e && e.message ? e.message : e) };
      }
    }, code);

    // A diagram that asked the page to load something (an image shape, for example) fails to
    // render because the load is refused: report the cause, not a syntax error.
    const triedToLoad = () => (blockedRequests.get(page) || []).length > 0;
    if (!result.ok) return triedToLoad() ? { externalReference: true } : { syntaxError: true };

    // Exports must be self-contained. The page never fetches, but an exported SVG opened in a
    // browser would, so refuse anything that points outside the file (same answer for PNG, so a
    // diagram does not export in one format and fail in the other).
    const externalRefs = await page.evaluate(COLLECT_EXTERNAL_REFS_SCRIPT);
    if (externalRefs.length > 0 || triedToLoad()) return { externalReference: true };

    if (output === 'svg') {
      return { buffer: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>\n${result.svg}`, 'utf8') };
    }
    // PNG: fit viewport to the rendered diagram, then screenshot the element.
    const size = await page.evaluate(() => {
      const el = document.querySelector('#c svg');
      const b = el ? el.getBoundingClientRect() : null;
      return b ? { w: Math.ceil(b.width), h: Math.ceil(b.height) } : null;
    });
    if (size) {
      await page.setViewport({
        width: Math.min(Math.max(size.w + 80, 800), 8000),
        height: Math.min(Math.max(size.h + 80, 600), 8000),
        deviceScaleFactor: 1,
      });
    }
    const el = await page.$('#c svg');
    const buffer = el
      ? await el.screenshot({ type: 'png' })
      : await page.screenshot({ type: 'png', fullPage: false });
    if (triedToLoad()) return { externalReference: true }; // a load first requested at paint time
    return { buffer };
  }

  // type === 'html' (only reachable when ALLOW_HTML_RENDER=true); network already blocked.
  await page.setContent(getHtmlShell(), { waitUntil: 'domcontentloaded' });
  await page.evaluate((html) => {
    document.getElementById('c').innerHTML = html;
  }, code);
  return { buffer: await page.screenshot({ type: 'png', fullPage: true }) };
}

/**
 * Launch the browser and render one trivial diagram, so the first user request finds Chrome up,
 * Mermaid parsed once and fonts loaded. Called before the server starts listening: on Cloud Run
 * CPU is only guaranteed during startup and while a request is in flight, so this must finish
 * before the instance reports ready. Rejects if the browser cannot launch or render.
 */
async function warmUp() {
  const started = Date.now();
  const browser = await getBrowser();
  const launchMs = Date.now() - started;
  const page = await browser.newPage();
  try {
    await lockdownPage(page);
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    const result = await renderToBuffer(page, 'mermaid', 'svg', WARMUP_DIAGRAM);
    if (!result.buffer || result.buffer.length === 0) throw new Error('warm-up render produced no output');
  } finally {
    page.close().catch(() => {});
  }
  logEvent('warmup', { launchMs, renderMs: Date.now() - started - launchMs });
}

module.exports = { generateImage, getBrowser, warmUp };
