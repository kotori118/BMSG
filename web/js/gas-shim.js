/*
 * Replaces the parts of Google Apps Script's client API that the BMSG Universe screens use:
 *   google.script.run.<fn>(...)                       -> POST to the JSON API (text/plain body)
 *   google.script.run.withSuccessHandler(f).<fn>(...)  -> same, with callbacks
 *   google.script.history.push / replace / setChangeHandler  -> window.history with query-string params
 *   google.script.url.getLocation(cb)                 -> { parameter: {...}, hash }
 *
 * Keeping the same shape means the screen code does not change. The old call sites stay as they were.
 * Requires window.BMSG_API_URL (see config.js).
 */
(function () {
  'use strict';

  var root = window;
  var google = root.google || (root.google = {});
  var script = google.script || (google.script = {});

  function apiUrl() {
    var url = root.BMSG_API_URL;
    if (!url) throw new Error('BMSG_API_URL is not configured (web/config.js).');
    return url;
  }

  // Failures are reported with the message the server gave, as GAS did with thrown errors.
  function failure(message, code) {
    var error = new Error(message);
    error.code = code || 'ACTION_FAILED';
    return error;
  }

  function invoke(action, args) {
    // Errors (such as a missing URL) become rejected promises, so they reach the failure handler.
    return Promise.resolve().then(function () { return fetch(apiUrl(), {
      method: 'POST',
      // text/plain avoids a CORS preflight, which the Apps Script endpoint does not answer.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: action, args: args || [] }),
      redirect: 'follow'
    }); }).then(function (response) {
      return response.text().then(function (text) {
        var body;
        try { body = JSON.parse(text); } catch (e) { throw failure('サーバーの応答を読み取れません。', 'BAD_RESPONSE'); }
        if (!body || body.ok !== true) {
          var err = body && body.error;
          throw failure((err && err.message) || 'サーバーでエラーが発生しました。', err && err.code);
        }
        return body.data;
      });
    });
  }

  // ---- 一時保存（読むだけのデータ） --------------------------------------------------
  // 一度取ったデータは端末に置き、次からはすぐ返す（裏で最新を取り直して入れ替える）。
  // 何かを保存・登録した（get で始まらない操作が成功した）ら、一時保存はすべて捨てる。
  // 毎回変わるデータ（ルームの状態・得点・履歴など）は対象にしない。
  // 版：GAS の返す内容を変えたとき（項目を足す・形を変える）は、この数字を上げる。
  // 上げると、端末に残っている古い一時保存は使われず、起動時に消える。
  var CACHE_VERSION = 5;
  var CACHE_PREFIX = 'bmsgApi:v' + CACHE_VERSION + ':';
  var CACHE_MAX_AGE = 24 * 60 * 60 * 1000; // これより古いものは使わず取り直す
  var CACHE_REFRESH_AFTER = 20 * 1000;     // これより新しいものは取り直さない
  var CACHEABLE = {
    getLyricsCatalog: 1, getLyricsParts: 1, getLyricsSong: 1, getLyricsSingerOptions: 1,
    getAnalysisBootstrap: 1,
    getProfileMembers: 1, getProfileMemberDetail: 1, getProfileMapData: 1, getProfileSearchData: 1, getUniverseMemberCreativeCredits: 1,
    getUniverseHomeBootstrap: 1, getUniverseSettingsBootstrap: 1, getUniverseSearchResults: 1,
    getTradingCardBootstrap: 1,
    getCoverMakerBootstrap: 1, getCoverSourceSongs: 1, getCoverLibrary: 1, getCoverProjects: 1,
    getPokerHighlights: 1, getPerformanceTimerBootstrap: 1, getKaraokeFavoriteSettings: 1,
    getManagementPageAccess: 1, getSongLyricsManagementBootstrap: 1, getSongLyricsManagementSong: 1,
    getImageManagementBootstrap: 1, getGroupPhotos: 1, getProfileManagementBootstrap: 1, getProfileManagementMember: 1,
    getCatalogManagementBootstrap: 1, getCatalogManagementProfileFields: 1, getManagementOperationsBootstrap: 1
  };
  var memoryCache = {};
  var inflight = {};

  function cacheKey(action, args) { return CACHE_PREFIX + action + ':' + JSON.stringify(args || []); }
  function readCache(key) {
    var entry = memoryCache[key];
    if (!entry) {
      try { var raw = root.localStorage.getItem(key); if (raw) entry = memoryCache[key] = JSON.parse(raw); } catch (e) { entry = null; }
    }
    if (!entry || Date.now() - entry.t > CACHE_MAX_AGE) return null;
    return entry;
  }
  function writeCache(key, data) {
    var entry = { t: Date.now(), s: JSON.stringify(data) };
    memoryCache[key] = entry;
    try { root.localStorage.setItem(key, JSON.stringify(entry)); } catch (e) { /* 容量が足りなければ、この画面を開いている間だけ覚える */ }
  }
  function clearCache() {
    memoryCache = {};
    try {
      for (var i = root.localStorage.length - 1; i >= 0; i--) {
        var k = root.localStorage.key(i);
        if (k && k.indexOf('bmsgApi:') === 0) root.localStorage.removeItem(k);
      }
    } catch (e) { /* 使えない環境ではメモリだけ */ }
  }
  // 起動時：古い版の一時保存を端末から消す（使われないまま容量を取らないように）
  (function purgeOldVersions() {
    try {
      for (var i = root.localStorage.length - 1; i >= 0; i--) {
        var k = root.localStorage.key(i);
        if (k && k.indexOf('bmsgApi:') === 0 && k.indexOf(CACHE_PREFIX) !== 0) root.localStorage.removeItem(k);
      }
    } catch (e) { /* 使えない環境では何もしない */ }
  })();
  // 同じ通信が同時に走らないようにまとめる（先読みと画面の読み込みが重なったときなど）
  function fetchAndStore(action, args, key) {
    if (inflight[key]) return inflight[key];
    var p = invoke(action, args).then(function (data) { writeCache(key, data); delete inflight[key]; return data; },
      function (error) { delete inflight[key]; throw error; });
    inflight[key] = p;
    return p;
  }
  function call(action, args) {
    if (!CACHEABLE[action]) {
      return invoke(action, args).then(function (data) {
        if (!/^get/.test(action)) clearCache();
        return data;
      });
    }
    var key = cacheKey(action, args);
    var hit = readCache(key);
    if (hit) {
      if (Date.now() - hit.t > CACHE_REFRESH_AFTER) fetchAndStore(action, args, key).catch(function () {});
      return Promise.resolve(JSON.parse(hit.s));
    }
    return fetchAndStore(action, args, key).then(function (data) { return JSON.parse(JSON.stringify(data)); });
  }
  // 先読み：画面を出した後の空き時間に、よく使うデータを取っておく
  script.prefetch = function (list) {
    (list || []).forEach(function (item) {
      var action = item[0], args = item[1] || [];
      if (!CACHEABLE[action]) return;
      var key = cacheKey(action, args);
      var hit = readCache(key);
      if (!hit || Date.now() - hit.t > CACHE_REFRESH_AFTER) fetchAndStore(action, args, key).catch(function () {});
    });
  };
  script.clearCache = clearCache;

  // google.script.run: each withSuccessHandler/withFailureHandler returns a new runner with the handler set.
  function makeRunner(handlers) {
    return new Proxy({}, {
      get: function (target, key) {
        if (key === 'withSuccessHandler') {
          return function (fn) { return makeRunner(Object.assign({}, handlers, { success: fn })); };
        }
        if (key === 'withFailureHandler') {
          return function (fn) { return makeRunner(Object.assign({}, handlers, { failure: fn })); };
        }
        if (key === 'withUserObject') {
          return function () { return makeRunner(handlers); };
        }
        if (typeof key !== 'string') return undefined;
        return function () {
          var args = Array.prototype.slice.call(arguments);
          var promise = call(key, args);
          promise.then(function (data) {
            if (typeof handlers.success === 'function') handlers.success(data);
          }, function (error) {
            if (typeof handlers.failure === 'function') handlers.failure(error);
            else if (root.console) root.console.error(error);
          });
          return undefined;
        };
      }
    });
  }
  script.run = makeRunner({});

  // Query-string routing. Parameters are strings, as they were in GAS.
  function paramsFromLocation() {
    var out = {};
    new URLSearchParams(root.location.search).forEach(function (value, key) { out[key] = value; });
    return out;
  }
  function queryFor(state) {
    var parts = [];
    Object.keys(state || {}).forEach(function (key) {
      var value = state[key];
      if (value === null || typeof value === 'undefined' || value === '') return;
      parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)));
    });
    return parts.length ? '?' + parts.join('&') : root.location.pathname;
  }
  var changeHandler = null;
  root.addEventListener('popstate', function (event) {
    if (typeof changeHandler === 'function') {
      changeHandler({ state: event.state, location: { parameter: paramsFromLocation(), hash: root.location.hash } });
    }
  });
  script.history = {
    push: function (state) { root.history.pushState(state || {}, '', queryFor(state)); },
    replace: function (state) { root.history.replaceState(state || {}, '', queryFor(state)); },
    setChangeHandler: function (fn) { changeHandler = fn; }
  };
  script.url = {
    getLocation: function (callback) {
      var location = { parameter: paramsFromLocation(), hash: root.location.hash };
      setTimeout(function () { callback(location); }, 0);
    }
  };
})();
