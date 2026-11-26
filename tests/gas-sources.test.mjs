import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const GAS = path.join(ROOT, 'gas');
const report = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'gas-import-report.json'), 'utf8'));

function gsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return gsFiles(p);
    return d.name.endsWith('.gs') ? [p] : [];
  }).sort();
}
const files = gsFiles(GAS).map((p) => {
  const src = fs.readFileSync(p, 'utf8');
  return { rel: path.relative(GAS, p), src, ast: acorn.parse(src, { ecmaVersion: 2022, sourceType: 'script' }) };
});

// Minimal Apps Script globals: enough to load every file. Nothing here is called at load time.
function loadProject() {
  const service = new Proxy(function () {}, { get: () => service, apply: () => service });
  const ctx = {
    console: { log() {}, error() {}, warn() {} },
    SpreadsheetApp: service, DriveApp: service, CacheService: service, LockService: service,
    PropertiesService: service, Utilities: service, Session: service, HtmlService: service, Logger: service,
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput(text) { return { text, mime: null, setMimeType(m) { this.mime = m; return this; } }; }
    }
  };
  vm.createContext(ctx);
  for (const f of files) vm.runInContext(f.src, ctx, { filename: f.rel });
  return ctx;
}

test('every .gs file parses', () => {
  assert.ok(files.length > 30, `expected the imported project, found ${files.length} files`);
});

test('top-level names are unique across the whole project (Apps Script shares one global scope)', () => {
  const seen = new Map();
  for (const f of files) {
    for (const node of f.ast.body) {
      const names = node.type === 'FunctionDeclaration' ? [node.id.name]
        : node.type === 'VariableDeclaration' ? node.declarations.map((d) => d.id.name) : [];
      for (const n of names) {
        assert.ok(!seen.has(n), `${n} is defined in both ${seen.get(n)} and ${f.rel}`);
        seen.set(n, f.rel);
      }
    }
  }
});

test('no BMSGDB library references remain', () => {
  for (const f of files) {
    walk.full(f.ast, (n) => {
      if (n.type === 'Identifier') assert.notEqual(n.name, 'BMSGDB', `${f.rel} still references BMSGDB`);
    });
  }
});

test('kept code never references a dropped DB function', () => {
  const dropped = new Set(report.dbDropped);
  for (const f of files) {
    walk.full(f.ast, (n) => {
      const name = n.type === 'Identifier' ? n.name : (n.type === 'Literal' && typeof n.value === 'string' ? n.value : null);
      if (name && dropped.has(name)) assert.fail(`${f.rel} references dropped DB function ${name}`);
    });
  }
});

test('the project loads into one global scope without errors', () => {
  const ctx = loadProject();
  assert.equal(typeof ctx.doGet, 'function');
  assert.equal(typeof ctx.doPost, 'function');
  assert.equal(typeof ctx.include, 'undefined', 'the HtmlService include() entry point must be gone');
});

test('every API action resolves to a defined function', () => {
  const ctx = loadProject();
  const actions = ctx.universeApiActions_();
  const names = Object.keys(actions);
  // Favorites and recent history were removed on 2026-11-22.
  const removed = ['getUniverseFavorites', 'setUniverseFavorite', 'recordUniverseActivity'];
  // Added after the import snapshot: group photos (2026-11-23), lyrics bodies split from the catalog (2026-11-26).
  const added = ['getGroupPhotos', 'saveGroupPhotoManagement', 'getLyricsParts'];
  assert.deepEqual(names.slice().sort(), [...report.apiActions.filter((n) => !removed.includes(n)), ...added].sort());
  assert.equal(names.length, 99);
  for (const n of names) assert.equal(typeof actions[n].fn, 'function', n);
  for (const n of [...report.apiExcluded, ...removed]) assert.ok(!(n in actions), `${n} must not be exposed`);
  assert.equal(names.filter((n) => actions[n].read).length, 46);
});

test('every DB writer PJ selects by name resolves through universeDbWriter_', () => {
  const ctx = loadProject();
  // 使われていない入口を整理して外したもの（DB側の関数自体は内部から使われている）
  const retired = ['migrateCatalogManagementSchemaForUniverse'];
  for (const n of report.dbRootsByString.filter((n) => !retired.includes(n))) assert.equal(typeof ctx.universeDbWriter_(n), 'function', n);
  for (const n of [...retired, 'onOpen']) assert.throws(() => ctx.universeDbWriter_(n), /Unknown DB writer/);
});

test('normalizeHex_ keeps the PJ behaviour and DB uses its own renamed version', () => {
  const ctx = loadProject();
  assert.equal(ctx.normalizeHex_('#abcdef', '#777777'), '#abcdef');
  assert.equal(ctx.normalizeHex_('bad', '#777777'), '#777777');
  assert.equal(ctx.normalizeCatalogHex_('#abcdef'), '#ABCDEF');
  assert.equal(ctx.normalizeCatalogHex_(''), '');
  assert.throws(() => ctx.normalizeCatalogHex_('bad'), /#RRGGBB/);
});

function call(ctx, method, e) {
  const out = method === 'GET' ? ctx.doGet(e) : ctx.doPost(e);
  assert.equal(out.mime, 'application/json');
  return JSON.parse(out.text);
}

test('dispatcher: health check, GET read, POST write, positional args', () => {
  const ctx = loadProject();
  const seen = [];
  ctx.getProfileMembers = (...args) => { seen.push(['getProfileMembers', args]); return [{ id: 'M101' }]; };
  ctx.saveUniverseUserPreferences = (...args) => { seen.push(['saveUniverseUserPreferences', args]); return { ok: true }; };
  ctx.leaveKaraokeRoom = () => undefined;

  assert.deepEqual(call(ctx, 'GET', { parameter: {} }), { ok: true, data: { service: 'bmsg-universe-api' } });
  assert.deepEqual(call(ctx, 'GET', { parameter: { action: 'getProfileMembers', args: '["U001",{"x":1}]' } }), { ok: true, data: [{ id: 'M101' }] });
  assert.deepEqual(call(ctx, 'POST', { postData: { contents: JSON.stringify({ action: 'saveUniverseUserPreferences', args: ['U002', { mode: 'ON' }] }) } }), { ok: true, data: { ok: true } });
  assert.deepEqual(call(ctx, 'POST', { postData: { contents: JSON.stringify({ action: 'leaveKaraokeRoom' }) } }), { ok: true, data: null });
  // Arrays built inside the vm have another realm's prototype, so compare serialized values.
  assert.equal(JSON.stringify(seen), JSON.stringify([
    ['getProfileMembers', ['U001', { x: 1 }]],
    ['saveUniverseUserPreferences', ['U002', { mode: 'ON' }]]
  ]));
});

test('dispatcher: rejects writes over GET, unknown actions and malformed requests', () => {
  const ctx = loadProject();
  let called = false;
  ctx.saveUniverseUserPreferences = () => { called = true; };
  const code = (r) => r.ok === false && r.error.code;

  assert.equal(code(call(ctx, 'GET', { parameter: { action: 'saveUniverseUserPreferences' } })), 'METHOD_NOT_ALLOWED');
  assert.equal(called, false);
  assert.equal(code(call(ctx, 'GET', { parameter: { action: 'onOpen' } })), 'UNKNOWN_ACTION');
  assert.equal(code(call(ctx, 'GET', { parameter: { action: 'universeApiActions_' } })), 'BAD_REQUEST');
  assert.equal(code(call(ctx, 'GET', { parameter: { action: 'getCatalogManagementAccess' } })), 'UNKNOWN_ACTION');
  assert.equal(code(call(ctx, 'GET', { parameter: { action: 'getProfileMembers', args: '{bad' } })), 'BAD_REQUEST');
  assert.equal(code(call(ctx, 'GET', { parameter: { action: 'getProfileMembers', args: '{"a":1}' } })), 'BAD_REQUEST');
  assert.equal(code(call(ctx, 'POST', {})), 'BAD_REQUEST');
  assert.equal(code(call(ctx, 'POST', { postData: { contents: '[1,2]' } })), 'BAD_REQUEST');
  assert.equal(code(call(ctx, 'POST', { postData: { contents: '{"args":[]}' } })), 'BAD_REQUEST');
});

test('dispatcher: an error thrown by an action comes back as ok:false with its message', () => {
  const ctx = loadProject();
  ctx.drawTradingCard = () => { throw new Error('利用ユーザーの選択が必要です。'); };
  assert.deepEqual(call(ctx, 'POST', { postData: { contents: '{"action":"drawTradingCard","args":[]}' } }),
    { ok: false, error: { code: 'ACTION_FAILED', message: '利用ユーザーの選択が必要です。' } });
});

test('manifest runs as the owner, open to anonymous callers, with no library dependency', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(GAS, 'appsscript.json'), 'utf8'));
  assert.deepEqual(manifest.webapp, { executeAs: 'USER_DEPLOYING', access: 'ANYONE_ANONYMOUS' });
  assert.deepEqual(manifest.dependencies, {});
  assert.equal(manifest.timeZone, 'Asia/Tokyo');
  assert.equal(manifest.runtimeVersion, 'V8');
});

test('gas/ holds only files clasp should push', () => {
  const walkAll = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => d.isDirectory() ? walkAll(path.join(dir, d.name)) : [path.relative(GAS, path.join(dir, d.name))]);
  for (const rel of walkAll(GAS)) assert.ok(rel.endsWith('.gs') || rel === 'appsscript.json', `unexpected file in gas/: ${rel}`);
});

test('favorites and recent history are gone from the server', () => {
  const all = files.map((f) => f.src).join('\n');
  for (const word of ['RECENT_ACTIVITIES', 'USER_FAVORITES', 'appendRecentActivity_', 'appendCoverActivity_', 'readUniverseFavorites_', 'readUniverseRecent_']) {
    assert.ok(!all.includes(word), `${word} should be removed`);
  }
});

// 読み取りの保存（CoreRepository.gs）：長い値は分けて保存し、日付は日付のまま戻る。書き込みの要求では保存を使わない。
test('core read cache stores long values in chunks and keeps dates', () => {
  const ctx = loadProject();
  const store = new Map();
  ctx.CacheService = { getScriptCache: () => ({
    get: (k) => (store.has(k) ? store.get(k) : null),
    put: (k, v) => { store.set(k, v); },
    putAll: (o) => { for (const [k, v] of Object.entries(o)) { if (String(v).length > 100000) throw new Error('too big'); store.set(k, v); } },
    getAll: (keys) => Object.fromEntries(keys.filter((k) => store.has(k)).map((k) => [k, store.get(k)])),
  }) };
  let builds = 0;
  const big = { text: 'あ'.repeat(70000), when: new Date('2026-01-02T03:04:05Z') };
  const builder = () => { builds++; return big; };
  vm.runInContext('universeRequestContext_.read = true', ctx);
  const first = ctx.universeCoreCached_('t', builder);
  const second = ctx.universeCoreCached_('t', builder);
  assert.equal(builds, 1, 'second read comes from the cache');
  assert.equal(second.text.length, 70000);
  assert.equal(Object.prototype.toString.call(second.when), '[object Date]');
  assert.equal(second.when.getTime(), big.when.getTime());
  ctx.invalidateCoreReadCache_();
  ctx.universeCoreCached_('t', builder);
  assert.equal(builds, 2, 'a DB write makes the next read rebuild');
  vm.runInContext('universeRequestContext_.read = false', ctx);
  ctx.universeCoreCached_('t', builder);
  assert.equal(builds, 3, 'write requests never use the cache');
  assert.equal(first.text, second.text);
});
