// Offline unit tests for the browser lifecycle in routes/generate.js: boot-time warm-up, launch
// failure, and the hard deadline. Puppeteer is replaced by a stub, so no browser is needed.
const assert = require('node:assert');

process.env.RENDER_HARD_DEADLINE_MS = '200';

// ---- Puppeteer stub (installed before routes/generate.js is loaded) ---------------------------
const stub = { launches: [], opened: 0, closed: 0, failNextLaunch: false, launchDelay: 0, newPageDelay: 0 };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fakePage() {
  return {
    setRequestInterception: async () => {},
    on: () => {},
    setDefaultTimeout: () => {},
    setDefaultNavigationTimeout: () => {},
    setViewport: async () => {},
    setContent: async () => {},
    addScriptTag: async () => {},
    evaluate: async () => ({ ok: true, svg: '<svg xmlns="http://www.w3.org/2000/svg"><g/></svg>' }),
    close: async () => { stub.closed++; },
  };
}

const fakePuppeteer = {
  launch: async (options) => {
    stub.launches.push(options);
    if (stub.launchDelay) await sleep(stub.launchDelay);
    if (stub.failNextLaunch) {
      stub.failNextLaunch = false;
      throw new Error('launch failed (stub)');
    }
    return {
      connected: true,
      on: () => {},
      newPage: async () => {
        if (stub.newPageDelay) await sleep(stub.newPageDelay);
        stub.opened++;
        return fakePage();
      },
    };
  },
};
const puppeteerPath = require.resolve('puppeteer');
require.cache[puppeteerPath] = { id: puppeteerPath, filename: puppeteerPath, loaded: true, exports: fakePuppeteer };

const { generateImage, warmUp } = require('../routes/generate');

// ---- Helpers ----------------------------------------------------------------------------------
function fakeRes() {
  const res = { statusCode: 200, headers: {}, body: undefined, headersSent: false };
  res.status = (code) => { res.statusCode = code; return res; };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.json = (obj) => { res.body = obj; res.headersSent = true; return res; };
  res.send = (buf) => { res.body = buf; res.headersSent = true; return res; };
  return res;
}
const SECRET_LABEL = 'TopSecretLabel';
const request = (id) => ({ id, body: { code: `graph TD; A[${SECRET_LABEL}]-->B;`, output: 'svg' } });

const logged = [];
const realLog = console.log;
console.log = (line) => { logged.push(String(line)); };
const realError = console.error;
console.error = () => {}; // expected error paths below are noisy by design
const events = (name) => logged.filter((l) => l.startsWith('{')).map((l) => JSON.parse(l)).filter((e) => e.event === name);

let failures = 0;
async function check(name, fn) {
  try { await fn(); realLog(`PASS  ${name}`); } catch (e) { failures++; realError(`FAIL  ${name}: ${e.message}`); }
}

(async () => {
  await check('warmUp rejects when the browser cannot launch, and the next call retries', async () => {
    stub.failNextLaunch = true;
    await assert.rejects(warmUp(), /launch failed/);
    assert.strictEqual(events('browser_launch_failed').length, 1);
    await warmUp();
    assert.strictEqual(stub.launches.length, 2, 'expected a second launch after the failure');
  });

  await check('warmUp launches with a long timeout, renders once and closes its page', async () => {
    assert.ok(stub.launches[1].timeout >= 120000, `launch timeout too short: ${stub.launches[1].timeout}`);
    assert.strictEqual(stub.opened, 1);
    assert.strictEqual(stub.closed, 1);
    assert.strictEqual(events('warmup').length, 1);
  });

  await check('a request after warm-up reuses the browser and returns the SVG with provenance', async () => {
    const res = fakeRes();
    await generateImage(request('req-ok'), res);
    assert.strictEqual(res.statusCode, 200);
    assert.ok(res.body.toString().includes('<SireniaSource>'), 'missing SireniaSource');
    assert.strictEqual(stub.launches.length, 2, 'browser was relaunched');
    assert.strictEqual(stub.opened, stub.closed);
  });

  await check('render log line has timings and status but never the diagram source', async () => {
    const [entry] = events('render').filter((e) => e.requestId === 'req-ok');
    assert.ok(entry, 'no render event logged');
    assert.strictEqual(entry.status, 200);
    assert.strictEqual(typeof entry.ms, 'number');
    assert.ok(!logged.some((l) => l.includes(SECRET_LABEL)), 'diagram text leaked into logs');
  });

  await check('deadline while a page is still opening -> 504, and that page is closed afterwards', async () => {
    stub.newPageDelay = 500;
    const [opened, closed] = [stub.opened, stub.closed];
    const res = fakeRes();
    await generateImage(request('req-slow-page'), res);
    assert.strictEqual(res.statusCode, 504);
    assert.ok(res.body && res.body.requestId === 'req-slow-page', '504 body should carry the request id');
    await sleep(450);
    stub.newPageDelay = 0;
    assert.strictEqual(stub.opened - opened, 1, 'page should have opened late');
    assert.strictEqual(stub.closed - closed, 1, 'late page was left open');
  });

  await check('deadline while the browser is still launching -> 504 for all, no page is ever opened', async () => {
    // Force a relaunch: drop the cached browser by making the current one look disconnected.
    const { getBrowser } = require('../routes/generate');
    (await getBrowser()).connected = false;
    stub.launchDelay = 500;
    const [opened, closed] = [stub.opened, stub.closed];
    const results = [fakeRes(), fakeRes(), fakeRes()];
    await Promise.all(results.map((res, i) => generateImage(request(`req-cold-${i}`), res)));
    assert.deepStrictEqual(results.map((r) => r.statusCode), [504, 504, 504]);
    await sleep(450);
    stub.launchDelay = 0;
    assert.strictEqual(stub.launches.length, 3, 'concurrent cold requests must share one launch');
    assert.strictEqual(stub.opened - opened, 0, 'abandoned requests must not open pages');
    assert.strictEqual(stub.closed - closed, 0);
  });

  console.log = realLog;
  console.error = realError;
  if (failures) {
    console.error(`${failures} test(s) failed`);
    process.exit(1);
  }
  console.log('All lifecycle tests passed');
})();
