// Unit tests for the proxy's upstream retry policy. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isPlatformFailure, callWithRetry, isSameOriginRequest, warmupDecision, proxySettings, backendAuthHeaders,
} from './upstream.js';

const json = { 'content-type': 'application/json; charset=utf-8' };
const html = { 'content-type': 'text/html' };
const fast = { delayMs: 0 };

test('transport errors and timeouts are platform failures', () => {
  assert.equal(isPlatformFailure({ error: new Error('timeout of 60000ms exceeded') }), true);
});

test('errors answered by the backend app (JSON) are final', () => {
  for (const status of [400, 403, 429, 500, 504]) {
    assert.equal(isPlatformFailure({ status, contentType: json['content-type'] }), false, `status ${status}`);
  }
});

test('non-JSON 429/500/502/503/504 come from the platform and are retryable', () => {
  for (const status of [429, 500, 502, 503, 504]) {
    assert.equal(isPlatformFailure({ status, contentType: html['content-type'] }), true, `status ${status}`);
    assert.equal(isPlatformFailure({ status }), true, `status ${status} without content type`);
  }
});

test('success and non-retryable statuses are never retried, whatever the body type', () => {
  assert.equal(isPlatformFailure({ status: 200, contentType: 'image/png' }), false);
  assert.equal(isPlatformFailure({ status: 400, contentType: 'text/html' }), false);
  assert.equal(isPlatformFailure({ status: 413, contentType: 'text/html' }), false);
});

test('a platform 503 is retried once and the second answer is returned', async () => {
  const answers = [{ status: 503, headers: html }, { status: 200, headers: { 'content-type': 'image/svg+xml' } }];
  const retries = [];
  let calls = 0;
  const res = await callWithRetry(async () => answers[calls++], { ...fast, onRetry: (info) => retries.push(info) });
  assert.equal(res.status, 200);
  assert.equal(calls, 2);
  assert.equal(retries.length, 1);
});

test('a timeout is retried once; if the retry also fails the error is thrown', async () => {
  let calls = 0;
  await assert.rejects(
    callWithRetry(async () => { calls++; throw new Error('timeout'); }, fast),
    /timeout/
  );
  assert.equal(calls, 2);
});

test('a backend JSON 504 is returned as-is without a second render', async () => {
  let calls = 0;
  const res = await callWithRetry(async () => { calls++; return { status: 504, headers: json }; }, fast);
  assert.equal(res.status, 504);
  assert.equal(calls, 1);
});

test('persistent platform failures stop after the configured number of retries', async () => {
  let calls = 0;
  const res = await callWithRetry(async () => { calls++; return { status: 429, headers: html }; }, fast);
  assert.equal(res.status, 429);
  assert.equal(calls, 2);
});

test('wake-up: only requests made by our own page pass the origin filter', () => {
  const host = 'diagrams.example.com';
  assert.equal(isSameOriginRequest({ secFetchSite: 'same-origin', host }), true);
  assert.equal(isSameOriginRequest({ origin: 'https://diagrams.example.com', host }), true, 'older browser: Origin only');
  // Another website driving a visitor's browser, in every form the browser reports it.
  assert.equal(isSameOriginRequest({ secFetchSite: 'cross-site', origin: 'https://evil.example', host }), false);
  assert.equal(isSameOriginRequest({ secFetchSite: 'same-site', origin: 'https://other.example.com', host }), false);
  assert.equal(isSameOriginRequest({ secFetchSite: 'none', host }), false, 'typed URL or bookmark, not our page');
  assert.equal(isSameOriginRequest({ origin: 'https://evil.example', host }), false);
  // Sec-Fetch-Site wins over a matching Origin.
  assert.equal(isSameOriginRequest({ secFetchSite: 'cross-site', origin: 'https://diagrams.example.com', host }), false);
  // Scanners and plain scripts send neither header.
  assert.equal(isSameOriginRequest({ host }), false);
  assert.equal(isSameOriginRequest({ origin: 'not a url', host }), false);
  assert.equal(isSameOriginRequest({ origin: 'null', host }), false);
});

test('wake-up: the backend is contacted at most once per interval and never while known to be up', () => {
  const limits = { warmTtlMs: 300_000, minIntervalMs: 30_000 };
  const t = 1_000_000_000;
  assert.equal(warmupDecision({ now: t, readyAt: 0, lastAttemptAt: 0, inFlight: false, ...limits }), 'call', 'first ever');
  assert.equal(warmupDecision({ now: t, readyAt: 0, lastAttemptAt: t - 1_000, inFlight: true, ...limits }), 'join');
  assert.equal(warmupDecision({ now: t, readyAt: t - 60_000, lastAttemptAt: t - 61_000, inFlight: false, ...limits }), 'cached');
  assert.equal(warmupDecision({ now: t, readyAt: t - 60_000, lastAttemptAt: t - 1_000, inFlight: true, ...limits }), 'cached', 'ready beats in-flight');
  assert.equal(warmupDecision({ now: t, readyAt: 0, lastAttemptAt: t - 5_000, inFlight: false, ...limits }), 'skip', 'failed moments ago');
  assert.equal(warmupDecision({ now: t, readyAt: 0, lastAttemptAt: t - 31_000, inFlight: false, ...limits }), 'call', 'interval elapsed');
  assert.equal(warmupDecision({ now: t, readyAt: t - 301_000, lastAttemptAt: t - 302_000, inFlight: false, ...limits }), 'call', 'ready answer expired');
});

test('settings: the defaults are the hosted behaviour (ID token, https only, one trusted hop)', () => {
  assert.deepEqual(proxySettings({ BACKEND_URL: 'https://backend.example' }), {
    config: { backendUrl: 'https://backend.example', backendAuth: 'google-id-token', trustProxy: 1 },
  });
  // Empty values (e.g. `-e BACKEND_AUTH=`) count as unset, like the proxy's other settings.
  assert.deepEqual(proxySettings({ BACKEND_URL: 'https://b.example', BACKEND_AUTH: '', TRUST_PROXY_HOPS: '' }).config,
    { backendUrl: 'https://b.example', backendAuth: 'google-id-token', trustProxy: 1 });
});

test('settings: with an ID token the backend URL must be https', () => {
  assert.match(proxySettings({}).error, /BACKEND_URL is not set/);
  assert.match(proxySettings({ BACKEND_URL: 'http://backend.example' }).error, /must be https/);
  assert.match(proxySettings({ BACKEND_URL: 'http://backend.example', BACKEND_AUTH: 'google-id-token' }).error, /must be https/);
  assert.match(proxySettings({ BACKEND_URL: 'backend.example' }).error, /must be https/);
});

test('settings: BACKEND_AUTH=none allows http and https, nothing else', () => {
  assert.deepEqual(proxySettings({ BACKEND_URL: 'http://127.0.0.1:8081', BACKEND_AUTH: 'none', TRUST_PROXY_HOPS: '0' }).config,
    { backendUrl: 'http://127.0.0.1:8081', backendAuth: 'none', trustProxy: false });
  assert.equal(proxySettings({ BACKEND_URL: 'https://b.example', BACKEND_AUTH: 'none' }).config.backendAuth, 'none');
  assert.match(proxySettings({ BACKEND_URL: 'ftp://b.example', BACKEND_AUTH: 'none' }).error, /http or https/);
  assert.match(proxySettings({ BACKEND_AUTH: 'none' }).error, /BACKEND_URL is not set/);
});

test('settings: an unknown BACKEND_AUTH is refused', () => {
  for (const value of ['bogus', 'None', 'google', ' none']) {
    assert.match(proxySettings({ BACKEND_URL: 'https://b.example', BACKEND_AUTH: value }).error, /BACKEND_AUTH must be one of google-id-token, none/, value);
  }
});

test('settings: TRUST_PROXY_HOPS is a non-negative integer; 0 means "trust no X-Forwarded-For"', () => {
  const hops = (value) => proxySettings({ BACKEND_URL: 'https://b.example', TRUST_PROXY_HOPS: value });
  assert.equal(hops('0').config.trustProxy, false);
  assert.equal(hops('2').config.trustProxy, 2);
  for (const value of ['-1', 'abc', '1.5', '1e3', ' 1', 'true', '1000']) {
    assert.match(hops(value).error ?? '', /TRUST_PROXY_HOPS must be a non-negative integer/, value);
  }
});

test('backend auth headers: an ID token only in google-id-token mode', async () => {
  let calls = 0;
  const getIdToken = async () => { calls++; return 'tok'; };
  assert.deepEqual(await backendAuthHeaders('google-id-token', getIdToken), { Authorization: 'Bearer tok' });
  assert.equal(calls, 1);
  assert.deepEqual(await backendAuthHeaders('none', getIdToken), {});
  assert.equal(calls, 1, 'mode none never asks the metadata server for a token');
});
