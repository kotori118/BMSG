import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

// 画面に触らない計算（web/partials/BeStatsCalc.html の <script>）をそのまま動かす
const file = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'web', 'partials', 'BeStatsCalc.html');
const source = fs.readFileSync(file, 'utf8').replace(/^<script>\n?/, '').replace(/<\/script>\s*$/, '');
const names = ['bsAddDays', 'bsDaysBetween', 'bsSeries', 'bsValueOn', 'bsFormatCount', 'bsFormatSigned', 'bsFormatPercent', 'bsMilestonesUpTo', 'bsMilestoneLabel', 'bsNotableMoves', 'bsRange', 'bsLast30', 'bsDayChange', 'bsAfter30', 'bsYearlyAverages', 'bsEventsInRange', 'bsActivityItems', 'bsContentRange', 'bsBucketize', 'bsBucketLabel', 'bsCountBy', 'bsTvSongRanking', 'bsLiveSongRanking', 'bsSetlistMarks', 'bsGenreStats', 'bsMatrixSymbol'];
const context = vm.createContext({});
vm.runInContext(source + `\nthis.api = {${names.join(',')}};`, context);
const api = context.api;

const daily = (id, start, values) => values.map((v, i) => ({date: api.bsAddDays(start, i), [id]: v}));

test('数の出し方：万・億・桁区切り・符号・率', () => {
  assert.equal(api.bsFormatCount(1805124481), '18.1億');
  assert.equal(api.bsFormatCount(1204000), '120.4万');
  assert.equal(api.bsFormatCount(9999), '9,999');
  assert.equal(api.bsFormatCount(null), '0');
  assert.equal(api.bsFormatSigned(1234), '+1,234');
  assert.equal(api.bsFormatSigned(-567), '−567');
  assert.equal(api.bsFormatSigned(33000), '+3.3万');
  assert.equal(api.bsFormatPercent(0.0833), '+8.33%');
  assert.equal(api.bsFormatPercent(-0.05), '−5.00%');
});

test('節目：人は10万・50万・100万のあと50万ごと、回は1,000万・5,000万・1億のあと1億ごと', () => {
  assert.deepEqual(Array.from(api.bsMilestonesUpTo('人', 2600000)), [100000, 500000, 1000000, 1500000, 2000000, 2500000]);
  assert.deepEqual(Array.from(api.bsMilestonesUpTo('回', 220000000)), [10000000, 50000000, 100000000, 200000000]);
  assert.equal(api.bsMilestoneLabel(2500000, '人'), '250万人');
  assert.equal(api.bsMilestoneLabel(10000000, '回'), '1,000万回');
  assert.equal(api.bsMilestoneLabel(1800000000, '回'), '18億回');
});

const people = {id: 'subs', name: '登録者', media: 'youtube', unit: '人'};

test('注目の動き：7日以内に初めて節目を越えたものだけ', () => {
  // 7日の窓は 2026-11-23〜2026-11-29。11-25 に 100万人を越える
  const d = daily('subs', '2026-11-23', [990000, 995000, 1000500, 1002000, 1003000, 1004000, 1005000]);
  const moves = api.bsNotableMoves([people], d, '2026-11-29');
  assert.equal(moves.length, 1);
  assert.equal(moves[0].headline, '100万人に到達');
  assert.equal(moves[0].date, '2026-11-25');
});

test('注目の動き：窓の外・最初の観測日・一度越えたあと戻って再び越えた場合は入れない', () => {
  const old = daily('subs', '2026-11-01', [990000, 1001000, 1002000, 1003000, 1004000, 1005000, 1006000, 1007000, 1008000, 1009000, 1010000, 1011000, 1012000, 1013000, 1014000, 1015000, 1016000, 1017000, 1018000, 1019000, 1020000, 1021000, 1022000, 1023000, 1024000, 1025000, 1026000, 1027000, 1028000]);
  assert.equal(api.bsNotableMoves([people], old, '2026-11-29').filter((m) => m.kind === 'milestone').length, 0);
  const first = daily('subs', '2026-11-29', [1500000]);
  assert.equal(api.bsNotableMoves([people], first, '2026-11-29').length, 0);
  const dip = daily('subs', '2026-11-20', [1001000, 999000, 998000, 997000, 996000, 995000, 994000, 1002000, 1003000, 1004000]);
  assert.equal(api.bsNotableMoves([people], dip, '2026-11-29').filter((m) => m.kind === 'milestone').length, 0);
});

test('注目の動き：30日で3%以上の伸び。30日前の値が無ければ対象外。増加率の高い順', () => {
  const a = {id: 'a', name: 'A', media: 'x', unit: '人'};
  const b = {id: 'b', name: 'B', media: 'x', unit: '人'};
  const c = {id: 'c', name: 'C', media: 'x', unit: '人'};
  const rows = [];
  for (let i = 0; i <= 30; i++) {
    const row = {date: api.bsAddDays('2026-10-30', i)};
    row.a = i === 0 ? 100000 : 100000 + i * 100;       // +3.0%
    row.b = i === 0 ? 100000 : 100000 + i * 200;       // +6.0%
    row.c = i === 0 ? null : 100000 + i * 50;          // 30日前が欠測
    rows.push(row);
  }
  const moves = api.bsNotableMoves([a, b, c], rows, '2026-11-29');
  assert.deepEqual(Array.from(moves.map((m) => m.metric.id)), ['b', 'a']);
  assert.equal(moves[0].headline, '直近30日で +6.00%');
});

test('注目の動き：最大5件、節目が先', () => {
  const metrics = Array.from({length: 7}, (_, i) => ({id: 'm' + i, name: 'M' + i, media: 'x', unit: '人'}));
  const rows = [];
  for (let i = 0; i <= 30; i++) {
    const row = {date: api.bsAddDays('2026-10-30', i)};
    metrics.forEach((m, k) => { row[m.id] = 730000 + i * 10000 + k * 1000; }); // 100万人を 11-26 ごろに越える
    rows.push(row);
  }
  const moves = api.bsNotableMoves(metrics, rows, '2026-11-29');
  assert.ok(moves.length <= 5);
  assert.equal(moves.filter((m) => m.kind === 'milestone').length > 0, true);
  const firstGrowth = moves.findIndex((m) => m.kind === 'growth');
  if (firstGrowth >= 0) assert.ok(moves.slice(0, firstGrowth).every((m) => m.kind === 'milestone'));
});

test('期間：年を選ぶとその年の範囲、期間ボタンは最終日から', () => {
  assert.deepEqual({...api.bsRange('2024-01-01', '2026-11-29', '90', '')}, {from: '2026-09-01', to: '2026-11-29'});
  assert.deepEqual({...api.bsRange('2024-01-01', '2026-11-29', 'all', '')}, {from: '2024-01-01', to: '2026-11-29'});
  assert.deepEqual({...api.bsRange('2024-01-01', '2026-11-29', '30', '2025')}, {from: '2025-01-01', to: '2025-12-31'});
  assert.deepEqual({...api.bsRange('2024-01-01', '2026-11-29', '30', '2026')}, {from: '2026-01-01', to: '2026-11-29'});
  assert.deepEqual({...api.bsRange('2026-11-20', '2026-11-29', '90', '')}, {from: '2026-11-20', to: '2026-11-29'});
});

test('増減：直近30日・前日比・後30日。欠測は補わない', () => {
  const rows = [];
  for (let i = 0; i <= 60; i++) rows.push({date: api.bsAddDays('2026-10-01', i), v: 1000 + i * 10});
  const s = api.bsSeries(rows, 'v');
  assert.deepEqual({...api.bsLast30(s)}, {delta: 300, rate: 300 / 1300});
  assert.equal(api.bsDayChange(s), 10 / 1590);
  // 出来事の日 d：V(d+29) − V(d−1)
  assert.deepEqual({...api.bsAfter30(s, '2026-10-11')}, {delta: (1000 + 39 * 10) - (1000 + 9 * 10), rate: 300 / 1090});
  // 最終日を超える出来事は最終日まで
  assert.equal(api.bsAfter30(s, '2026-11-20').delta, (1000 + 60 * 10) - (1000 + 49 * 10));
  // 前日が欠測なら null
  const gap = rows.filter((r) => r.date !== '2026-10-10');
  assert.equal(api.bsAfter30(api.bsSeries(gap, 'v'), '2026-10-11'), null);
});

test('年ごとの平均と出来事の一覧', () => {
  const rows = [{date: '2025-12-30', v: 10}, {date: '2025-12-31', v: 20}, {date: '2026-01-01', v: 100}];
  assert.deepEqual(Array.from(api.bsYearlyAverages(api.bsSeries(rows, 'v')), (y) => ({...y})), [{year: '2025', avg: 15}, {year: '2026', avg: 100}]);
  const events = [{date: '2026-01-10', kind: 'release', name: 'A'}, {date: '2025-11-10', end: '2026-01-05', kind: 'year_end', name: '年末'}, {date: '2026-03-01', kind: 'tv', name: 'B'}];
  assert.deepEqual(Array.from(api.bsEventsInRange(events, '2026-01-01', '2026-02-01'), (e) => e.name), ['A', '年末']);
});

test('直近の活動：Shorts は入れない。今日より後が予定', () => {
  const data = {
    tv: {programs: [{programId: 'P', name: '番組'}], appearances: [{date: '2026-11-01', programId: 'P'}]},
    live: {shows: [{date: '2026-12-10', title: 'ツアー', venue: '会場'}]},
    youtube: {videos: [{date: '2026-11-10', title: '動画', type: 'normal'}, {date: '2026-11-11', title: 'ショート', type: 'shorts'}]},
  };
  const r = api.bsActivityItems(data, '2026-11-28');
  assert.deepEqual(Array.from(r.planned, (i) => i.type), ['LIVE']);
  assert.deepEqual(Array.from(r.done, (i) => i.title), ['動画', '番組']);
});

test('コンテンツ：期間の範囲と月ごと・年ごとの棒', () => {
  assert.deepEqual({...api.bsContentRange('all', '2026-11-29', '2025-11-05')}, {from: '2025-11-05', to: '2026-11-29'});
  assert.deepEqual({...api.bsContentRange('365', '2026-11-29', '2021-01-01')}, {from: '2025-11-30', to: '2026-11-29'});
  assert.deepEqual({...api.bsContentRange('2026', '2026-11-29', '2021-01-01')}, {from: '2026-01-01', to: '2026-11-29'});
  const items = [{date: '2025-12-31'}, {date: '2026-01-02'}, {date: '2026-01-20'}, {date: '2026-03-05'}, {date: '2027-01-01'}];
  const m = api.bsBucketize(items, '2025-12-01', '2026-03-31', 'month');
  assert.deepEqual(Array.from(m.months), ['2025-12', '2026-01', '2026-02', '2026-03']);
  assert.deepEqual(Array.from(m.totals), [1, 2, 0, 1]);
  assert.equal(m.total, 4);
  const y = api.bsBucketize(items, '2025-01-01', '2026-12-31', 'year');
  assert.deepEqual(Array.from(y.totals), [1, 3]);
  assert.equal(api.bsBucketLabel('2026', 'year', '2026-11-29'), '2026（11月まで）');
  assert.equal(api.bsBucketLabel('2025', 'year', '2026-11-29'), '2025');
  assert.equal(api.bsBucketLabel('2026-01', 'month', '2026-11-29'), '26/01');
});

test('コンテンツ：積み上げ（通常動画とShorts）', () => {
  const items = [{date: '2026-01-02', type: 'normal'}, {date: '2026-01-03', type: 'shorts'}, {date: '2026-01-04', type: 'shorts'}];
  const m = api.bsBucketize(items, '2026-01-01', '2026-01-31', 'month', (v) => v.type);
  assert.deepEqual(Array.from(m.keys), ['normal', 'shorts']);
  assert.deepEqual(Array.from(m.counts.normal), [1]);
  assert.deepEqual(Array.from(m.counts.shorts), [2]);
});

test('コンテンツ：TV・ライブの披露曲ランキングは期間内、ライブは披露集計対象のみ・同じ公演は1回', () => {
  const apps = [{date: '2026-01-01', songs: [{songId: '1'}, {songId: '2'}]}, {date: '2026-02-01', songs: [{songId: '1'}]}, {date: '2020-01-01', songs: [{songId: '9'}]}];
  const tv = api.bsTvSongRanking(apps, '2026-01-01', '2026-12-31', (id) => '曲' + id);
  assert.deepEqual(Array.from(tv, (r) => [r.title, r.count]), [['曲1', 2], ['曲2', 1]]);
  const shows = [
    {date: '2026-05-01', setlist: [{songId: '1', title: 'A', counted: true}, {songId: '1', title: 'A', counted: true}, {songId: '2', title: 'B', counted: false}]},
    {date: '2026-05-02', setlist: [{songId: '1', title: 'A', counted: true}]},
  ];
  const live = api.bsLiveSongRanking(shows, '2026-01-01', '2026-12-31');
  assert.deepEqual(Array.from(live, (r) => [r.title, r.count]), [['A', 2]]);
});

test('コンテンツ：曲順（OP・MAINラスト・アンコール）', () => {
  const setlist = [
    {order: 3, title: 'C', section: 'MAIN'}, {order: 1, title: 'A', section: 'MAIN'}, {order: 2, title: 'B', section: 'MAIN'},
    {order: 4, title: 'E1', section: 'ENCORE'}, {order: 5, title: 'E2', section: 'ENCORE'},
  ];
  const marks = api.bsSetlistMarks(setlist);
  assert.equal(marks.op, 'A'); assert.equal(marks.mainLast, 'C'); assert.deepEqual(Array.from(marks.encore), ['E1', 'E2']);
  assert.equal(api.bsSetlistMarks([]), null);
  assert.deepEqual(Array.from(api.bsSetlistMarks([{order: 1, title: 'A', section: 'MAIN'}]).encore), []);
});

test('コンテンツ：ジャンル別と出演履歴の記号', () => {
  const videos = [
    {genre: 'Vlog', type: 'normal', date: '2025-01-01'}, {genre: 'Vlog', type: 'normal', date: '2026-01-01'},
    {genre: '楽曲関連Short', type: 'shorts', date: '2026-02-01'},
  ];
  const stats = api.bsGenreStats(videos);
  assert.deepEqual(Array.from(stats, (g) => [g.genre, g.total, g.normal, g.shorts]), [['Vlog', 2, 2, 0], ['楽曲関連Short', 1, 0, 1]]);
  assert.equal(Math.round(stats[0].share * 100), 67);
  assert.deepEqual({...stats[0].byYear}, {2025: 1, 2026: 1});
  assert.deepEqual(['○', '×', '予', '？', ''].map(api.bsMatrixSymbol), ['○', '×', '予', '－', '－']);
});
