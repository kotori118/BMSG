// Take phone-size screenshots of the app against the real API, for design review.
// Usage: node tests/browser/screens.mjs <outDir> [route ...]
// Uses the API URL in web/config.js. Fonts and CDN scripts may be blocked in the sandbox (fallback fonts are used).
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web');
const outDir = path.resolve(process.argv[2] || 'screens');
const routes = process.argv.slice(3).length ? process.argv.slice(3) : ['home', 'data', 'lab'];
fs.mkdirSync(outDir, { recursive: true });

const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(WEB, p);
  if (!file.startsWith(WEB) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(8766, r));

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.addInitScript(() => { try { localStorage.setItem('bmsgUniverseUserId', 'U001'); } catch (e) {} });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
for (const route of routes) {
  const [name, query] = route.split('?');
  await page.goto(`http://localhost:8766/?page=${name}${query ? '&' + query : ''}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(Number(process.env.WAIT_MS || 6000));
  if (process.env.CLICK) { await page.click(process.env.CLICK); await page.waitForTimeout(500); }
  const file = path.join(outDir, `${route.replace(/[^a-z0-9]+/gi, '_')}.png`);
  await page.screenshot({ path: file, fullPage: process.env.FULL === '1' });
  console.log('saved', file);
}
await browser.close();
server.close();
if (errors.length) console.log('page errors:\n' + [...new Set(errors)].join('\n'));
