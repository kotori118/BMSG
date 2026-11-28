// Originally imported from kotori118/BMSG-PJ CoreRepository.gs (2026-11-21). This repository is now the source: edit this file directly.
/**
 * Read a Core DB sheet as header-keyed objects.
 * No write methods are defined in this repository.
 */
function getCoreSpreadsheet_() {
  // 読み取りの要求では、本当に必要になるまでスプレッドシートを開かない（保存済みの表で足りることが多い）
  if (universeRequestContext_.read && typeof Proxy === 'function') {
    let opened = null;
    const open = function() { if (!opened) opened = SpreadsheetApp.openById(UNIVERSE_CONFIG.CORE_DB_ID); return opened; };
    return new Proxy({ __lazyCoreSpreadsheet: true }, {
      get: function(target, prop) {
        if (prop === '__lazyCoreSpreadsheet') return true;
        const real = open();
        const value = real[prop];
        return typeof value === 'function' ? value.bind(real) : value;
      }
    });
  }
  return SpreadsheetApp.openById(UNIVERSE_CONFIG.CORE_DB_ID);
}

// ---- DB の読み取りの保存（速さのため） ----
// 読み取りの要求（ApiActions の read: true）だけが使う。書き込みの要求は必ずシートを直接読む。
// DB を変える書き込みが終わると版（version）を変えて、保存した内容をまとめて無効にする（Dispatcher.gs）。
// スプレッドシートを直接編集したときは、最長 CORE_CACHE_SECONDS_ で反映される。
const universeRequestContext_ = { read: false };
const CORE_CACHE_SECONDS_ = 600;
const CORE_CACHE_VERSION_KEY_ = 'core-db-version';
const UNIVERSE_CACHE_CHUNK_CHARS_ = 30000; // 1件 100KB の上限を、全角だけでも超えない長さ

function coreCacheVersion_(cache) {
  let version = cache.get(CORE_CACHE_VERSION_KEY_);
  if (!version) {
    version = String(Date.now());
    cache.put(CORE_CACHE_VERSION_KEY_, version, 21600);
  }
  return version;
}

function invalidateCoreReadCache_() {
  try { CacheService.getScriptCache().put(CORE_CACHE_VERSION_KEY_, String(Date.now()) + Math.random().toString(36).slice(2, 6), 21600); }
  catch (error) { console.error(error); }
}

// 長い文字列を分けて保存・読み出し（1件 100KB の上限を超えるもの用）
function universeCachePutChunked_(cache, key, text, seconds) {
  const items = {};
  const count = Math.ceil(text.length / UNIVERSE_CACHE_CHUNK_CHARS_) || 1;
  for (let i = 0; i < count; i++) items[key + ':' + i] = text.slice(i * UNIVERSE_CACHE_CHUNK_CHARS_, (i + 1) * UNIVERSE_CACHE_CHUNK_CHARS_);
  items[key + ':n'] = String(count);
  cache.putAll(items, seconds);
}

function universeCacheGetChunked_(cache, key) {
  const count = Number(cache.get(key + ':n'));
  if (!count) return null;
  const keys = [];
  for (let i = 0; i < count; i++) keys.push(key + ':' + i);
  const parts = cache.getAll(keys);
  let text = '';
  for (let i = 0; i < count; i++) {
    const part = parts[key + ':' + i];
    if (typeof part !== 'string') return null;
    text += part;
  }
  return text;
}

// 読み取りの結果を版つきで保存する。builder は保存がないときだけ呼ばれる。
// 書き込みの操作でも使いたい（Core DB を書き換えない操作）ときは useInWrite を true にする。
function universeCoreCached_(name, builder, useInWrite) {
  if (!universeRequestContext_.read && !useInWrite) return builder();
  let cache;
  try { cache = CacheService.getScriptCache(); } catch (error) { return builder(); }
  let key = '';
  try {
    key = 'core:' + coreCacheVersion_(cache) + ':' + name;
    const hit = universeCacheGetChunked_(cache, key);
    if (hit) return JSON.parse(hit, coreCacheRevive_);
  } catch (error) { console.error(error); }
  const value = builder();
  try { if (key) universeCachePutChunked_(cache, key, JSON.stringify(coreCacheTagDates_(value)), CORE_CACHE_SECONDS_); }
  catch (error) { console.error(error); }
  return value;
}

// 日付を保存しても日付のまま戻るようにする
function coreCacheTagDates_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') return { __date: value.getTime() };
  if (Array.isArray(value)) return value.map(coreCacheTagDates_);
  if (value && typeof value === 'object') {
    const out = {};
    Object.keys(value).forEach(function(k) { out[k] = coreCacheTagDates_(value[k]); });
    return out;
  }
  return value;
}

function coreCacheRevive_(key, value) {
  if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 1 && typeof value.__date === 'number') return new Date(value.__date);
  return value;
}

function getCoreSheetFromSpreadsheet_(spreadsheet, sheetName) {
  const sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) throw new Error('Core DB sheet not found: ' + sheetName);
  return sheet;
}

function readCoreSheetObjects_(sheetName) {
  return readCoreSheetObjectsFromSpreadsheet_(getCoreSpreadsheet_(), sheetName);
}

function readCoreSheetObjectsFromSpreadsheet_(spreadsheet, sheetName) {
  const values = universeCoreCached_('sheet:' + sheetName, function() {
    const sheet = getCoreSheetFromSpreadsheet_(spreadsheet, sheetName);
    const lastRow = sheet.getLastRow();
    const lastColumn = sheet.getLastColumn();
    if (lastRow < 2 || lastColumn < 1) return [];
    return sheet.getRange(1, 1, lastRow, lastColumn).getValues();
  });
  return values.length ? coreRowsToObjects_(values) : [];
}

/**
 * Resolve the stored song artist for display and retain its typed identity.
 * Management includes personal songs. Public consumers never receive them.
 */
function resolveUniverseSongs_(spreadsheet, songs, includePersonal) {
  const visible = songs.filter(function(song) {
    return includePersonal || !isUniversePersonalSong_(song);
  });
  if (!visible.length) return visible;

  const labels = Object.create(null);
  readCoreSheetObjectsFromSpreadsheet_(spreadsheet, UNIVERSE_CONFIG.SHEETS.GROUPS).forEach(function(group) {
    labels[asId_(group.GroupID)] = String(group.GroupName || '');
  });
  if (includePersonal && visible.some(isUniversePersonalSong_)) {
    readCoreSheetObjectsFromSpreadsheet_(spreadsheet, UNIVERSE_CONFIG.SHEETS.MEMBERS).forEach(function(member) {
      labels[asId_(member.MemberID)] = String(member.DisplayName || '');
    });
  }
  return visible.map(function(song) {
    return Object.assign({}, song, {Artist: labels[asId_(song.ArtistID)] || ''});
  });
}

function isUniversePersonalSong_(song) {
  return /^M\d+$/.test(asId_(song.ArtistID));
}

function readUniverseSongs_(includePersonal) {
  const spreadsheet = getCoreSpreadsheet_();
  return resolveUniverseSongs_(spreadsheet,
    readCoreSheetObjectsFromSpreadsheet_(spreadsheet, UNIVERSE_CONFIG.SHEETS.SONGS), includePersonal);
}

function readCoreSheetDisplayObjects_(sheetName) {
  const sheet = getCoreSheetFromSpreadsheet_(getCoreSpreadsheet_(), sheetName);
  const values = sheet.getDataRange().getDisplayValues();
  return coreRowsToObjects_(values);
}

function coreRowsToObjects_(values) {
  if (!values || values.length < 2) return [];
  const headers = values[0].map(function(header) {
    return String(header || '').trim();
  });
  return values.slice(1).filter(function(row) {
    return row.some(function(value) {
      return value !== '' && value !== null && value !== false;
    });
  }).map(function(row) {
    return headers.reduce(function(record, header, index) {
      if (header) record[header] = row[index];
      return record;
    }, {});
  });
}

function asId_(value) {
  if (value === '' || value === null || typeof value === 'undefined') return '';
  return String(value).trim();
}

function asNumber_(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function asBoolean_(value) {
  return value === true || String(value).trim().toUpperCase() === 'TRUE';
}

function splitUniverseCreditNames_(value) {
  return String(value || '').split(',').map(function(item) {
    return item.trim();
  }).filter(Boolean);
}
