#!/usr/bin/env node
/**
 * BE:STATS の画面確認用サンプル（作り物のデータ）を web/bestats-sample/ に書く。
 * 形は docs の BE:STATS 指示書 2-4 の JSON と同じ。本物のデータは GitHub Actions が R2 に置く（このサンプルは本番では使わない）。
 *   node scripts/make-bestats-sample.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'web', 'bestats-sample');
const DATA_END = '2026-11-29';
const day = (d) => d.toISOString().slice(0, 10);
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return day(d); };

const METRICS = [
  {id: 'spotify_monthly_listeners', name: 'Spotify 月間リスナー', media: 'spotify', unit: '人', start: 1500000, perDay: 1800},
  {id: 'youtube_total_views', name: 'YouTube 総再生', media: 'youtube', unit: '回', start: 1500000000, perDay: 330000},
  {id: 'spotify_followers', name: 'Spotify フォロワー', media: 'spotify', unit: '人', start: 100000, perDay: 90},
  {id: 'youtube_subscribers', name: 'YouTube 登録者', media: 'youtube', unit: '人', start: 2300000, perDay: 330, step: 10000},
  {id: 'instagram_followers_official', name: 'Instagram フォロワー', media: 'instagram', unit: '人', start: 1000000, perDay: 280},
  {id: 'x_followers_official', name: 'X フォロワー', media: 'x', unit: '人', start: 1100000, perDay: 120},
  {id: 'tiktok_followers_official', name: 'TikTok フォロワー', media: 'tiktok', unit: '人', start: 700000, perDay: 3000},
];
const DAYS = 700;
// 画面確認用：節目への到達（最後の7日以内）と、30日で3%以上の伸びがホームに出るように作る
const CROSS = {instagram_followers_official: {value: 1500000, daysAgo: 3}, youtube_subscribers: {value: 2500000, daysAgo: 1}};
const startDate = addDays(DATA_END, -(DAYS - 1));
const daily = [];
for (let i = 0; i < DAYS; i++) {
  const row = {date: addDays(startDate, i)};
  for (const m of METRICS) {
    if (i < 30 && m.id === 'tiktok_followers_official') { row[m.id] = null; continue; } // 欠測のサンプル
    let v = m.start + Math.round(m.perDay * i + Math.sin(i / 9) * m.perDay * 6);
    const cross = CROSS[m.id];
    if (cross) { // crossIndex の日に初めて cross.value 以上になる直線
      const crossIndex = DAYS - 1 - cross.daysAgo;
      v = cross.value + Math.round(m.perDay * (i - crossIndex));
    }
    if (m.step) v = Math.floor(v / m.step) * m.step; // 登録者は1,000人単位でしか変わらない
    if (m.id === 'youtube_total_views') v = m.start + Math.floor(i / 7) * m.perDay * 7; // 更新日以外は同じ値
    row[m.id] = v;
  }
  daily.push(row);
}

const songs = Array.from({length: 12}, (_, i) => ({
  SongID: String(1001 + i), Title: `サンプル曲${i + 1}`, ArtistID: 'G1', ReleaseDate: addDays('2025-01-10', i * 45), Form: i % 3 === 0 ? 'シングル' : 'アルバム', CDTitle: `サンプルCD${Math.floor(i / 3) + 1}`, IsTitleTrack: i % 3 === 0,
}));

// 決まった並びの疑似乱数（毎回同じサンプルになる）
let seed = 12345;
const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = (list) => list[Math.floor(rand() * list.length)];
const dateIn = (from, days) => addDays(from, Math.floor(rand() * days));

const programs = [
  {programId: 'PG001', name: 'サンプル歌謡祭', station: 'サンプルテレビ系', category: '年末特番'},
  {programId: 'PG002', name: 'サンプルベストアーティスト', station: 'サンプルテレビ系', category: '年末特番'},
  {programId: 'PG003', name: 'サンプル紅白', station: 'サンプルテレビ系', category: '年末特番'},
  {programId: 'PG010', name: 'サンプル夏フェス', station: 'サンプルテレビ系', category: '夏特番'},
  {programId: 'PG011', name: 'サンプル音楽の日', station: 'サンプルテレビ系', category: '夏特番'},
  {programId: 'PG020', name: 'サンプルミュージック', station: 'サンプルテレビ系', category: 'レギュラー'},
  {programId: 'PG021', name: 'サンプルライブショー', station: 'サンプルテレビ系', category: 'レギュラー'},
  {programId: 'PG030', name: 'サンプルスペシャル', station: 'サンプルテレビ系', category: '特番・その他'},
];
const appearances = [];
for (let i = 0; i < 46; i++) {
  const date = dateIn('2023-01-05', 1420);
  if (date > DATA_END) continue;
  const prog = pick(programs);
  const count = 1 + Math.floor(rand() * 3);
  appearances.push({appearanceId: 'AP' + String(i + 1).padStart(4, '0'), programId: prog.programId, date,
    songs: Array.from({length: count}, (_, k) => ({order: k + 1, songId: pick(songs).SongID}))});
}
appearances.sort((a, b) => a.date.localeCompare(b.date));
const years = [2023, 2024, 2025, 2026];
const matrix = programs.map((p) => ({programId: p.programId, years: Object.fromEntries(years.map((y) => {
  const has = appearances.some((a) => a.programId === p.programId && a.date.startsWith(String(y)));
  return [y, y === 2026 && p.category === '年末特番' ? (p.programId === 'PG002' ? '予' : '？') : (has ? '○' : '×')];
}))}));

const regions = ['東京都', '大阪府', '愛知県', '福岡県', '北海道', '宮城県'];
const tours = [
  {tourId: 'TR001', name: 'サンプルツアー 2025', start: '2025-04-01', end: '2025-07-31'},
  {tourId: 'TR002', name: 'サンプルアリーナツアー 2026', start: '2026-03-01', end: '2026-06-30'},
  {tourId: 'TR003', name: 'サンプルファンミーティング', start: '2026-09-01', end: '2026-10-31'},
  {tourId: 'TR004', name: 'サンプル年末ライブ', start: '2026-12-20', end: '2026-12-20'},
];
const shows = [];
let showNo = 1;
tours.forEach((t, ti) => {
  const n = ti === 3 ? 1 : 6 + ti * 2;
  for (let k = 0; k < n; k++) {
    const date = ti === 3 ? t.start : addDays(t.start, Math.floor(k * (bsDays(t.start, t.end) / Math.max(n - 1, 1))));
    const hasSetlist = ti !== 3 && !(ti === 2 && k % 3 === 2);
    const setCount = 14 + Math.floor(rand() * 5);
    const setlist = hasSetlist ? Array.from({length: setCount}, (_, o) => {
      const song = pick(songs);
      return {order: o + 1, songId: song.SongID, title: song.Title, section: o >= setCount - 3 ? 'ENCORE' : 'MAIN', counted: true};
    }) : [];
    shows.push({eventId: 'EVT' + String(showNo++).padStart(3, '0'), date, tourId: t.tourId, title: t.name, venue: 'サンプル会場' + (k + 1), region: pick(regions), slot: k % 2 ? '夜公演' : '昼公演', setlist});
  }
});
function bsDays(a, b) { return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000); }
tours.forEach((t) => {
  const own = shows.filter((x) => x.tourId === t.tourId);
  t.shows = own.length; t.showsWithSetlist = own.filter((x) => x.setlist.length).length;
});

const genres = ['MV・パフォーマンス', 'Vlog', 'Behind', 'ダンス', 'テレビ歌唱', 'ライブ本編', 'バラエティ'];
const shortGenres = ['楽曲関連Short', 'その他Short'];
const videos = [];
for (let i = 0; i < 160; i++) {
  const date = dateIn('2023-02-01', 1390);
  if (date > DATA_END) continue;
  const shorts = rand() < 0.4;
  videos.push({videoId: 'SAMPLE' + String(i + 1).padStart(6, '0'), date, title: (shorts ? 'サンプル Short ' : 'サンプル動画 ') + (i + 1), type: shorts ? 'shorts' : 'normal',
    genre: shorts ? pick(shortGenres) : pick(genres), songId: rand() < 0.5 ? pick(songs).SongID : null, liveRef: null, tvRef: null});
}
videos.sort((a, b) => b.date.localeCompare(a.date));

const events = [
  ...songs.map((s) => ({date: s.ReleaseDate, kind: 'release', name: s.Title})),
  ...appearances.map((a) => ({date: a.date, kind: 'tv', name: programs.find((p) => p.programId === a.programId).name})),
  {date: '2025-11-10', end: '2026-01-05', kind: 'year_end', name: '年末 2025'},
  {date: '2026-07-20', end: '2026-08-31', kind: 'summer', name: '夏 2026'},
].sort((a, b) => a.date.localeCompare(b.date));

const files = {
  'metrics.json': {metrics: METRICS.map(({id, name, media, unit}) => ({id, name, media, unit})), daily},
  'youtube.json': {videos},
  'tv.json': {programs, appearances, matrix},
  'live.json': {tours, shows},
  'songs.json': {songs},
  'events.json': {events},
};
const rows = {'metrics.json': daily.length, 'youtube.json': videos.length, 'tv.json': appearances.length, 'live.json': shows.length, 'songs.json': songs.length, 'events.json': events.length};

fs.mkdirSync(OUT, {recursive: true});
for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(OUT, name), JSON.stringify(body) + '\n');
const manifest = {version: `${DATA_END}T22:30:00+09:00`, generatedAt: `${DATA_END}T22:30:12+09:00`, dataEnd: DATA_END, files: Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, {rows: v}]))};
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('wrote', Object.keys(files).length + 1, 'files to', OUT);
