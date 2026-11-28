// Originally imported from kotori118/BMSG-PJ LogRepository.gs (2026-11-21). This repository is now the source: edit this file directly.
// Shared repository for BMSG Universe Log sheet access helpers.

function getLogSheet_(name) {
  const sheet = SpreadsheetApp.openById(UNIVERSE_CONFIG.LOG_DB_ID).getSheetByName(name);
  if (!sheet) throw new Error('Log sheet not found: ' + name);
  return sheet;
}


function readSheetObjects_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0].map(function(value) { return String(value).trim(); });
  return values.slice(1).filter(function(row) {
    return row.some(function(value) { return value !== ''; });
  }).map(function(row) {
    const object = {};
    headers.forEach(function(header, index) {
      if (header) object[header] = row[index];
    });
    return object;
  });
}

function readSheetObjectsWithRows_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0].map(function(value) { return String(value).trim(); });
  return values.slice(1).map(function(row, index) {
    const object = {__rowNumber:index + 2};
    headers.forEach(function(header, columnIndex) {
      if (header) object[header] = row[columnIndex];
    });
    return object;
  }).filter(function(row) {
    return Object.keys(row).some(function(key) {
      return key !== '__rowNumber' && row[key] !== '';
    });
  });
}

function appendByHeaders_(sheet, record) {
  appendRawByHeaders_(sheet, record);
}

function appendRawByHeaders_(sheet, record) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  sheet.appendRow(headers.map(function(header) {
    return Object.prototype.hasOwnProperty.call(record, header) ? record[header] : '';
  }));
}


function updateByHeaders_(sheet, rowNumber, record) {
  if (!rowNumber || rowNumber < 2) throw new Error('Invalid row number.');
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const range = sheet.getRange(rowNumber, 1, 1, headers.length);
  const values = range.getValues()[0];
  headers.forEach(function(header, index) {
    if (Object.prototype.hasOwnProperty.call(record, header)) values[index] = record[header];
  });
  range.setValues([values]);
}

// ---- Log DB の読み取りの保存（カバーの一覧など、Log を何度も読む画面を速くする） ----
// 読み取りの要求だけが使う。書き込みの操作が始まる／終わる／失敗したときに版を変えて捨てる（Dispatcher.gs）。
// スプレッドシートを直接編集したときは、最長 CORE_CACHE_SECONDS_ で反映される。
const LOG_CACHE_VERSION_KEY_ = 'log-db-version';

function logCacheVersion_(cache) {
  let version = cache.get(LOG_CACHE_VERSION_KEY_);
  if (!version) {
    version = String(Date.now());
    cache.put(LOG_CACHE_VERSION_KEY_, version, 21600);
  }
  return version;
}

function invalidateLogReadCache_() {
  try { CacheService.getScriptCache().put(LOG_CACHE_VERSION_KEY_, String(Date.now()) + Math.random().toString(36).slice(2, 6), 21600); }
  catch (error) { console.error(error); }
}

function universeLogCached_(name, builder) {
  if (!universeRequestContext_.read) return builder();
  let cache;
  try { cache = CacheService.getScriptCache(); } catch (error) { return builder(); }
  let key = '';
  try {
    key = 'log:' + logCacheVersion_(cache) + ':' + name;
    const hit = universeCacheGetChunked_(cache, key);
    if (hit) return JSON.parse(hit, coreCacheRevive_);
  } catch (error) { console.error(error); }
  const value = builder();
  try { if (key) universeCachePutChunked_(cache, key, JSON.stringify(coreCacheTagDates_(value)), CORE_CACHE_SECONDS_); }
  catch (error) { console.error(error); }
  return value;
}

// Log のシートを header つきの行オブジェクトにして返す（読み取りの要求では保存済みのものを使う）
function readLogSheetObjectsCached_(name) {
  const values = universeLogCached_('sheet:' + name, function() {
    return getLogSheet_(name).getDataRange().getValues();
  });
  if (values.length < 2) return [];
  const headers = values[0].map(function(value) { return String(value).trim(); });
  return values.slice(1).filter(function(row) {
    return row.some(function(value) { return value !== ''; });
  }).map(function(row) {
    const object = {};
    headers.forEach(function(header, index) { if (header) object[header] = row[index]; });
    return object;
  });
}
