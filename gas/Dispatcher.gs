/**
 * BMSG Universe JSON API entry point. Replaces the old HtmlService doGet()/include().
 *
 * Request
 *   GET  ?action=<name>&args=<JSON array>          read actions only (ApiActions.gs read=true)
 *   POST body (Content-Type: text/plain) = JSON {"action": "<name>", "args": [...]}
 *        text/plain keeps the browser from sending a CORS preflight, which Apps Script does not answer.
 *   GET with no action returns a health check.
 *
 * Response (always HTTP 200, JSON)
 *   {"ok": true,  "data": <return value>}
 *   {"ok": false, "error": {"code": "...", "message": "..."}}
 *
 * args are passed positionally, exactly as google.script.run passed them, so each action keeps its signature.
 * There is no authentication (decided 2026-11-21). Each action keeps its own existing userId checks.
 */
const UNIVERSE_API_SERVICE_ = 'bmsg-universe-api';

// ログ（遊びの記録・設定）だけに書く操作。これ以外の書き込みは DB を変えるものとして扱う。
const UNIVERSE_LOG_ONLY_ACTIONS_ = Object.freeze({
  abandonQuizGame: 1, createKaraokeRoom: 1, createPokerRoom: 1, createQuizGame: 1, deleteCoverProject: 1,
  drawTradingCard: 1, exchangePokerCards: 1, finalizePokerHand: 1, joinKaraokeRoom: 1, joinPokerRoom: 1,
  joinQuizRoom: 1, leaveKaraokeRoom: 1, leavePokerRoom: 1, reorderPokerHand: 1, resetTradingCardCollection: 1,
  saveCoverProject: 1, saveKaraokeAssignment: 1, saveKaraokeFavoriteSet: 1, saveOfflinePokerHighlight: 1,
  savePokerHighlight: 1, saveUniverseUserPreferences: 1, setCoverProjectShared: 1, startPokerRoom: 1,
  submitQuizResult: 1, votePokerWinner: 1, parseSongLyricsManagement: 1
});

function doGet(e) {
  return universeApiRespond_(universeApiHandle_('GET', e));
}

function doPost(e) {
  return universeApiRespond_(universeApiHandle_('POST', e));
}

function universeApiHandle_(method, e) {
  try {
    const request = universeApiParseRequest_(method, e);
    if (!request.action) return { ok: true, data: { service: UNIVERSE_API_SERVICE_ } };
    const actions = universeApiActions_();
    if (!Object.prototype.hasOwnProperty.call(actions, request.action)) {
      throw universeApiError_('UNKNOWN_ACTION', '不明な操作です: ' + request.action);
    }
    const entry = actions[request.action];
    if (method === 'GET' && !entry.read) {
      throw universeApiError_('METHOD_NOT_ALLOWED', 'この操作はPOSTで呼び出してください: ' + request.action);
    }
    universeRequestContext_.read = !!entry.read;
    const data = entry.fn.apply(null, request.args);
    // DB（歌詞・メンバー・画像など）を変える書き込みのあとは、保存した読み取りをまとめて無効にする
    if (!entry.read && !UNIVERSE_LOG_ONLY_ACTIONS_[request.action]) invalidateCoreReadCache_();
    return { ok: true, data: typeof data === 'undefined' ? null : data };
  } catch (error) {
    const code = error && error.universeApiCode;
    if (!code) console.error(error);
    return { ok: false, error: { code: code || 'ACTION_FAILED', message: String((error && error.message) || error) } };
  }
}

function universeApiParseRequest_(method, e) {
  let action = '';
  let args = [];
  if (method === 'GET') {
    const params = (e && e.parameter) || {};
    action = params.action || '';
    if (!action) return { action: '', args: [] };
    if (params.args) args = universeApiParseJson_(params.args, 'args');
  } else {
    const contents = e && e.postData && e.postData.contents;
    if (!contents) throw universeApiError_('BAD_REQUEST', 'リクエスト本文がありません。');
    const body = universeApiParseJson_(contents, 'body');
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw universeApiError_('BAD_REQUEST', 'リクエスト本文はJSONオブジェクトにしてください。');
    action = body.action || '';
    if (typeof body.args !== 'undefined') args = body.args;
    if (!action) throw universeApiError_('BAD_REQUEST', 'actionがありません。');
  }
  if (typeof action !== 'string' || !/^[A-Za-z][A-Za-z0-9]*$/.test(action)) {
    throw universeApiError_('BAD_REQUEST', 'actionの形式が正しくありません。');
  }
  if (!Array.isArray(args)) throw universeApiError_('BAD_REQUEST', 'argsは配列にしてください。');
  return { action: action, args: args };
}

function universeApiParseJson_(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw universeApiError_('BAD_REQUEST', label + 'のJSONを読み取れません。');
  }
}

function universeApiError_(code, message) {
  const error = new Error(message);
  error.universeApiCode = code;
  return error;
}

function universeApiRespond_(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}
