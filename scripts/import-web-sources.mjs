#!/usr/bin/env node
/**
 * Build the static frontend in web/ from the BMSG-PJ HTML sources.
 *
 * Usage: node scripts/import-web-sources.mjs <path-to-BMSG-PJ>
 *
 * - Copies every .html partial verbatim into web/partials/.
 * - Writes web/index.html by inlining what Index.html asked Apps Script to include
 *   (<?!= include('X'); ?> becomes the contents of X.html), in the same order.
 * - Adds the shim (js/gas-shim.js) and config (config.js) before any screen code runs.
 * - Applies the PERFORMANCE TIMER member-ID fix (client '101'..'106' -> server 'M101'..'M106').
 *   Each replacement must match exactly once, or the import fails.
 *
 * web/js/gas-shim.js, web/config.js and web/_redirects are maintained by hand.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const pjDir = process.argv[2];
if (!pjDir) {
  console.error('Usage: node scripts/import-web-sources.mjs <BMSG-PJ dir>');
  process.exit(2);
}
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const WEB = path.join(ROOT, 'web');
const PARTIALS = path.join(WEB, 'partials');
const REPORT = path.join(ROOT, 'docs', 'migration', 'web-import-report.json');

const head = (dir) => { try { return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD']).toString().trim(); } catch { return 'unknown'; } };

// Exact-once replacement. Throws if the target count is not 1.
function replaceOnce(src, from, to, label) {
  const count = src.split(from).length - 1;
  if (count !== 1) throw new Error(`${label}: expected 1 match, found ${count}`);
  return src.replace(from, to);
}

const indexSrc = fs.readFileSync(path.join(pjDir, 'Index.html'), 'utf8');
const used = [];
let inlined = indexSrc.replace(/<\?!=\s*include\('([A-Za-z0-9_]+)'\);\s*\?>/g, (_, name) => {
  const file = path.join(pjDir, `${name}.html`);
  if (!fs.existsSync(file)) throw new Error(`Index.html includes ${name}, but ${name}.html does not exist`);
  used.push(name);
  return `\n<!-- ${name}.html -->\n` + fs.readFileSync(file, 'utf8');
});
if (/<\?/.test(inlined)) throw new Error('Index.html still has an unhandled Apps Script scriptlet');

// The base tag only makes sense for Apps Script's iframe.
inlined = replaceOnce(inlined, '<base target="_top">', '', 'base tag');
// Shim and config must load before any screen script runs.
inlined = replaceOnce(inlined, '<meta charset="UTF-8">',
  '<meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n  <script src="config.js"></script>\n  <script src="js/gas-shim.js"></script>', 'shim tags');

// PERFORMANCE TIMER: the client must use the same MemberIDs as the server and the Core DB.
const fixes = [];
const ptFile = path.join(pjDir, 'PerformanceTimerScripts.html');
const pt = fs.readFileSync(ptFile, 'utf8');
const ptFixed = replaceOnce(pt, "const MEMBER_IDS=['101','102','103','104','105','106'];",
  "const MEMBER_IDS=['M101','M102','M103','M104','M105','M106'];", 'PERFORMANCE TIMER MEMBER_IDS');
fixes.push({ file: 'PerformanceTimerScripts.html', change: "MEMBER_IDS '101'..'106' -> 'M101'..'M106'", reason: 'PerformanceTimerApi.gs and 10_PerformanceMetrics use M101..M106' });
inlined = replaceOnce(inlined, pt, ptFixed, 'PERFORMANCE TIMER partial inlined into index');

fs.rmSync(PARTIALS, { recursive: true, force: true });
fs.mkdirSync(PARTIALS, { recursive: true });
const copied = [];
for (const f of fs.readdirSync(pjDir).filter((f) => f.endsWith('.html') && f !== 'Index.html').sort()) {
  const src = fs.readFileSync(path.join(pjDir, f), 'utf8');
  const out = f === 'PerformanceTimerScripts.html' ? ptFixed : src;
  fs.writeFileSync(path.join(PARTIALS, f), out);
  copied.push(f);
}
// index.html is the built page, so the inlined partials are not referenced from partials/.
fs.writeFileSync(path.join(WEB, 'index.html'), inlined);

const report = {
  source: { pj: head(pjDir) },
  partialsCopied: copied.length,
  inlined: used,
  fixes
};
fs.mkdirSync(path.dirname(REPORT), { recursive: true });
fs.writeFileSync(REPORT, JSON.stringify(report, null, 2) + '\n');
console.log(`partials: ${copied.length}  inlined into index.html: ${used.length}  fixes: ${fixes.length}`);
