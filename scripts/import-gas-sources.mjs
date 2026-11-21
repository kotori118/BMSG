#!/usr/bin/env node
/**
 * Build the single Apps Script project in gas/ from the BMSG-PJ and BMSG-DB sources.
 *
 * Usage: node scripts/import-gas-sources.mjs <path-to-BMSG-PJ> <path-to-BMSG-DB>
 *
 * - PJ: every .gs except Code.gs (the HtmlService doGet/include entry point is replaced by Dispatcher.gs).
 *       `BMSGDB.fn(...)` becomes `fn(...)`; `BMSGDB[name]` becomes `universeDbWriter_(name)`.
 * - DB: only functions reachable from PJ are kept. Functions PJ never reaches (legacy input sheets,
 *       spreadsheet menu, onOpen/onInstall) are dropped. Top-level constants are always kept.
 *       DB's normalizeHex_ is renamed to normalizeCatalogHex_ because PJ defines a different normalizeHex_.
 * - Writes gas/pj/*.gs, gas/db/*.gs, gas/DbBridge.gs, gas/ApiActions.gs and docs/migration/import-report.json.
 *   gas/Dispatcher.gs and gas/appsscript.json are maintained by hand and are not touched.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';

const [pjDir, dbDir] = process.argv.slice(2);
if (!pjDir || !dbDir) {
  console.error('Usage: node scripts/import-gas-sources.mjs <BMSG-PJ dir> <BMSG-DB dir>');
  process.exit(2);
}
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'gas');
const PJ_SKIP = new Set(['Code.gs']);
const DB_RENAMES = { normalizeHex_: 'normalizeCatalogHex_' };
// Public PJ functions the client never calls (P0 inventory). They are not exposed through the API.
const API_EXCLUDED = new Set(['getCatalogManagementAccess', 'catalogManagementMigrateSchema']);
const REPORT = path.join(ROOT, 'docs', 'migration', 'import-report.json');

const gsFiles = (dir) => fs.readdirSync(dir).filter((f) => f.endsWith('.gs')).sort();
const parse = (src, file) => {
  const comments = [];
  try {
    return { ast: acorn.parse(src, { ecmaVersion: 2022, sourceType: 'script', ranges: true, onComment: comments }), comments };
  } catch (e) {
    throw new Error(`${file}: ${e.message}`);
  }
};
const headOf = (dir) => {
  try { return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD']).toString().trim(); } catch { return 'unknown'; }
};

// ---------- load DB ----------
const db = gsFiles(dbDir).map((file) => {
  const src = fs.readFileSync(path.join(dbDir, file), 'utf8');
  return { file, src, ...parse(src, file) };
});
const dbFns = new Map(); // name -> {file, node}
for (const f of db) {
  for (const node of f.ast.body) {
    if (node.type === 'FunctionDeclaration') {
      if (dbFns.has(node.id.name)) throw new Error(`Duplicate DB function ${node.id.name}`);
      dbFns.set(node.id.name, { file: f.file, node });
    }
  }
}

// Names referenced by a node: identifiers and string literals that equal a DB function name.
function referencedDbNames(node) {
  const out = new Set();
  walk.full(node, (n) => {
    if (n.type === 'Identifier' && dbFns.has(n.name)) out.add(n.name);
    else if (n.type === 'Literal' && typeof n.value === 'string' && dbFns.has(n.value)) out.add(n.value);
  });
  return out;
}

// ---------- load PJ, find roots into DB ----------
const pj = gsFiles(pjDir).filter((f) => !PJ_SKIP.has(f)).map((file) => {
  const src = fs.readFileSync(path.join(pjDir, file), 'utf8');
  return { file, src, ...parse(src, file) };
});
const rootsDirect = new Set();
const rootsByString = new Set();
for (const f of pj) {
  walk.full(f.ast, (n) => {
    if (n.type === 'MemberExpression' && n.object.type === 'Identifier' && n.object.name === 'BMSGDB' && !n.computed) {
      if (!dbFns.has(n.property.name)) throw new Error(`${f.file}: BMSGDB.${n.property.name} is not defined in BMSG-DB`);
      rootsDirect.add(n.property.name);
    } else if (n.type === 'Literal' && typeof n.value === 'string' && dbFns.has(n.value) && !n.value.endsWith('_')) {
      rootsByString.add(n.value);
    }
  });
}

// ---------- reachability inside DB ----------
const reach = new Set();
const queue = [...rootsDirect, ...rootsByString];
// Top-level non-function statements (constants) are always kept, so whatever they reference is kept too.
for (const f of db) for (const node of f.ast.body) if (node.type !== 'FunctionDeclaration') queue.push(...referencedDbNames(node));
while (queue.length) {
  const name = queue.pop();
  if (reach.has(name) || !dbFns.has(name)) continue;
  reach.add(name);
  for (const ref of referencedDbNames(dbFns.get(name).node.body)) if (!reach.has(ref)) queue.push(ref);
}
const dropped = [...dbFns.keys()].filter((n) => !reach.has(n)).sort();

// ---------- source editing helpers ----------
function applyEdits(src, edits) {
  edits.sort((a, b) => b.start - a.start);
  let out = src;
  let last = Infinity;
  for (const e of edits) {
    if (e.end > last) throw new Error('Overlapping edits');
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
    last = e.start;
  }
  return out;
}
// Start of the leading comment block (JSDoc/line comments) attached directly above a node.
function leadingStart(src, comments, node) {
  let start = node.start;
  for (let i = comments.length - 1; i >= 0; i--) {
    const c = comments[i];
    if (c.end > start) continue;
    if (/^[ \t]*\r?\n?[ \t]*$/.test(src.slice(c.end, start)) && !/\n[ \t]*\r?\n/.test(src.slice(c.end, start))) start = c.start;
    else break;
  }
  return start;
}

// ---------- write DB ----------
fs.rmSync(path.join(OUT, 'pj'), { recursive: true, force: true });
fs.rmSync(path.join(OUT, 'db'), { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'pj'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'db'), { recursive: true });

const dbWritten = [];
for (const f of db) {
  const edits = [];
  for (const node of f.ast.body) {
    if (node.type === 'FunctionDeclaration' && !reach.has(node.id.name)) {
      let end = node.end;
      while (f.src[end] === '\n' || f.src[end] === '\r') end++;
      edits.push({ start: leadingStart(f.src, f.comments, node), end, text: '' });
    }
  }
  // Renames apply to kept code only; dropped ranges are removed above.
  const droppedRanges = edits.map((e) => [e.start, e.end]);
  const inDropped = (pos) => droppedRanges.some(([s, e]) => pos >= s && pos < e);
  walk.full(f.ast, (n) => {
    if (n.type === 'Identifier' && DB_RENAMES[n.name] && !inDropped(n.start)) edits.push({ start: n.start, end: n.end, text: DB_RENAMES[n.name] });
  });
  const out = applyEdits(f.src, edits).replace(/\n{3,}/g, '\n\n');
  const hasCode = parse(out, f.file).ast.body.length > 0;
  if (!hasCode) continue;
  const header = `// Imported from kotori118/BMSG-DB ${f.file} by scripts/import-gas-sources.mjs. Edit the generator or re-import; do not hand-edit.\n`;
  fs.writeFileSync(path.join(OUT, 'db', f.file), header + out);
  dbWritten.push(f.file);
}

// ---------- write PJ ----------
for (const f of pj) {
  const edits = [];
  walk.full(f.ast, (n) => {
    if (n.type === 'MemberExpression' && n.object.type === 'Identifier' && n.object.name === 'BMSGDB') {
      if (n.computed) edits.push({ start: n.start, end: n.end, text: `universeDbWriter_(${f.src.slice(n.property.start, n.property.end)})` });
      else edits.push({ start: n.start, end: n.property.start, text: '' });
    }
  });
  const header = `// Imported from kotori118/BMSG-PJ ${f.file} by scripts/import-gas-sources.mjs. Edit the generator or re-import; do not hand-edit.\n`;
  fs.writeFileSync(path.join(OUT, 'pj', f.file), header + applyEdits(f.src, edits));
}

// ---------- DbBridge.gs: allowlist for DB writers PJ selects by name ----------
const byString = [...rootsByString].sort();
const bridge = `// Generated by scripts/import-gas-sources.mjs. Do not hand-edit.
/**
 * Replaces the old \`BMSGDB[name]\` library lookup. Only DB functions that BMSG-PJ names as strings
 * (catalogManagementCallWriter_ and the runManagementOperation writers table) can be resolved.
 */
function universeDbWriter_(name) {
  const writers = {
${byString.map((n) => `    ${n}: ${n}`).join(',\n')}
  };
  if (!Object.prototype.hasOwnProperty.call(writers, name)) throw new Error('Unknown DB writer: ' + name);
  return writers[name];
}
`;
fs.writeFileSync(path.join(OUT, 'DbBridge.gs'), bridge);

const report = {
  source: { pj: headOf(pjDir), db: headOf(dbDir) },
  pjFiles: pj.map((f) => f.file),
  pjSkipped: [...PJ_SKIP],
  dbFiles: dbWritten,
  dbRootsDirect: [...rootsDirect].sort(),
  dbRootsByString: byString,
  dbKept: [...reach].sort(),
  dbDropped: dropped,
  renames: DB_RENAMES
};
// ---------- ApiActions.gs: the only functions the web API may call ----------
const apiNames = [];
for (const f of pj) for (const node of f.ast.body) {
  if (node.type !== 'FunctionDeclaration') continue;
  const n = node.id.name;
  if (n.endsWith('_') || API_EXCLUDED.has(n)) continue;
  apiNames.push(n);
}
apiNames.sort();
const actions = `// Generated by scripts/import-gas-sources.mjs. Do not hand-edit.
/**
 * Web API action table. read=true actions may be called with GET; every action may be called with POST.
 * Built inside a function because functions in files loaded later are not defined yet at load time.
 */
function universeApiActions_() {
  return {
${apiNames.map((n) => `    ${n}: { fn: ${n}, read: ${/^get[A-Z]/.test(n)} }`).join(',\n')}
  };
}
`;
fs.writeFileSync(path.join(OUT, 'ApiActions.gs'), actions);
report.apiActions = apiNames;
report.apiExcluded = [...API_EXCLUDED];
fs.mkdirSync(path.dirname(REPORT), { recursive: true });
fs.writeFileSync(REPORT, JSON.stringify(report, null, 2) + '\n');
console.log(`PJ files: ${pj.length}  DB files: ${dbWritten.length}  DB kept: ${reach.size}  dropped: ${dropped.length}`);
console.log(`DB roots: direct ${rootsDirect.size}, by string ${rootsByString.size}  API actions: ${apiNames.length}`);
