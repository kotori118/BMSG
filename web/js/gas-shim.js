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
          var promise = invoke(key, args);
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
