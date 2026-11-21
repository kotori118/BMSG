// Smoke test: the built web/ page boots, the router renders, and the shim sends POST text/plain
// to the configured API. The API is stubbed in the browser; no network or Apps Script is needed.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web');
const types = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const p = path.join(WEB, req.url.split('?')[0] === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!p.startsWith(WEB) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(8765, r));

const API = 'https://api.example.test/exec';
const posts = [];
// Use the pre-installed Chromium (see the environment notes); do not download another.
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.route(API, async (route) => {
  const req = route.request();
  let body = {};
  try { body = JSON.parse(req.postData() || '{}'); } catch {}
  posts.push({ method: req.method(), contentType: req.headers()['content-type'], action: body.action });
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: null }) });
});
await page.route('**/*', (route) => {
  const url = route.request().url();
  // config.js is the deployment setting; the test points it at the stub API.
  if (url.endsWith('/config.js')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: `window.BMSG_API_URL = '${API}';` });
  if (url.startsWith('http://localhost:8765')) return route.continue();
  if (url.startsWith(API)) return route.fallback();
  return route.abort(); // fonts, chart.js CDN: not needed for the smoke test
});
await page.goto('http://localhost:8765/?page=home', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

const shimOk = await page.evaluate(() => typeof window.google.script.run.withSuccessHandler === 'function'
  && typeof window.google.script.history.push === 'function' && typeof window.google.script.url.getLocation === 'function');
const routerOk = await page.evaluate(() => typeof window.initRouter === 'function' || typeof window.renderRoute === 'function');

// Round-trip one call through the real shim with a success handler.
const roundTrip = await page.evaluate(() => new Promise((resolve) => {
  window.google.script.run.withSuccessHandler((d) => resolve({ ok: true, d })).withFailureHandler((e) => resolve({ ok: false, e: e.message })).ping('x');
  setTimeout(() => resolve('timeout'), 4000);
}));

await browser.close();
server.close();

const checks = [
  ['shim installed', shimOk],
  ['router loaded', routerOk],
  ['shim POSTs text/plain (no preflight)', posts.some((p) => p.method === 'POST' && p.contentType.startsWith('text/plain') && p.action === 'ping')],
  ['success handler receives data', roundTrip && roundTrip.ok === true],
  ['no uncaught page errors', !errors.some((e) => e.startsWith('pageerror'))]
];
let failed = 0;
for (const [name, ok] of checks) { console.log((ok ? 'ok   ' : 'FAIL ') + name); if (!ok) failed++; }
if (errors.length) console.log('--- browser errors (first 10) ---\n' + errors.slice(0, 10).join('\n'));
console.log(`posts: ${posts.length} (actions: ${[...new Set(posts.map((p) => p.action))].join(', ')})`);
process.exit(failed ? 1 : 0);
