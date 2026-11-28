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
  {id: 'tiktok_followers_official', name: 'TikTok フォロワー', media: 'tiktok', unit: '人', start: 700000, perDay: 150},
];
const DAYS = 700;
const startDate = addDays(DATA_END, -(DAYS - 1));
const daily = [];
for (let i = 0; i < DAYS; i++) {
  const row = {date: addDays(startDate, i)};
  for (const m of METRICS) {
    if (i < 30 && m.id === 'tiktok_followers_official') { row[m.id] = null; continue; } // 欠測のサンプル
    let v = m.start + Math.round(m.perDay * i + Math.sin(i / 9) * m.perDay * 6);
    if (m.step) v = Math.floor(v / m.step) * m.step; // 登録者は1,000人単位でしか変わらない
    if (m.id === 'youtube_total_views') v = m.start + Math.floor(i / 7) * m.perDay * 7; // 更新日以外は同じ値
    row[m.id] = v;
  }
  daily.push(row);
}

const songs = Array.from({length: 12}, (_, i) => ({
  SongID: String(1001 + i), Title: `サンプル曲${i + 1}`, ArtistID: 'G1', ReleaseDate: addDays('2025-01-10', i * 45), Form: i % 3 === 0 ? 'シングル' : 'アルバム', CDTitle: `サンプルCD${Math.floor(i / 3) + 1}`, IsTitleTrack: i % 3 === 0,
}));

const programs = [
  {programId: 'PG001', name: 'サンプル歌謡祭', station: 'サンプルテレビ系', category: '年末特番'},
  {programId: 'PG010', name: 'サンプル夏フェス', station: 'サンプルテレビ系', category: '夏特番'},
  {programId: 'PG020', name: 'サンプルミュージック', station: 'サンプルテレビ系', category: 'レギュラー'},
];
const appearances = [
  {appearanceId: 'AP0001', programId: 'PG001', date: '2025-12-31', songs: [{order: 1, songId: '1003'}]},
  {appearanceId: 'AP0002', programId: 'PG010', date: '2026-07-25', songs: [{order: 1, songId: '1006'}, {order: 2, songId: '1007'}]},
  {appearanceId: 'AP0003', programId: 'PG020', date: '2026-10-10', songs: [{order: 1, songId: '1010'}]},
];
const matrix = [
  {programId: 'PG001', years: {2024: '×', 2025: '○', 2026: '？'}},
  {programId: 'PG010', years: {2024: '×', 2025: '×', 2026: '○'}},
  {programId: 'PG020', years: {2024: '○', 2025: '×', 2026: '予'}},
];

const shows = [
  {eventId: 'EVT001', date: '2026-05-01', tourId: 'TR001', title: 'サンプルツアー', venue: 'サンプルホール', region: '東京都', slot: '昼公演',
    setlist: [{order: 1, songId: '1001', title: 'サンプル曲1', section: 'MAIN', counted: true}, {order: 2, songId: '1002', title: 'サンプル曲2', section: 'MAIN', counted: true}, {order: 3, songId: '1003', title: 'サンプル曲3', section: 'ENCORE', counted: true}]},
  {eventId: 'EVT002', date: '2026-05-02', tourId: 'TR001', title: 'サンプルツアー', venue: 'サンプルホール', region: '大阪府', slot: '夜公演', setlist: []},
];
const tours = [{tourId: 'TR001', name: 'サンプルツアー', start: '2026-05-01', end: '2026-05-02', shows: 2, showsWithSetlist: 1}];

const videos = [
  {videoId: 'SAMPLE000001', date: '2026-11-10', title: 'サンプル MV', type: 'normal', genre: 'MV・パフォーマンス', songId: '1011', liveRef: null, tvRef: null},
  {videoId: 'SAMPLE000002', date: '2026-11-12', title: 'サンプル Vlog', type: 'normal', genre: 'Vlog', songId: null, liveRef: 'TR001', tvRef: null},
  {videoId: 'SAMPLE000003', date: '2026-11-15', title: 'サンプル Short', type: 'shorts', genre: '楽曲関連Short', songId: '1011', liveRef: null, tvRef: null},
];

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
