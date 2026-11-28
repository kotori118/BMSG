import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'web', 'bestats-sample');
const read = (name) => JSON.parse(fs.readFileSync(path.join(DIR, name), 'utf8'));

test('BE:STATS サンプル：manifest の件数が各ファイルと合っている', () => {
  const manifest = read('manifest.json');
  const rows = {
    'metrics.json': read('metrics.json').daily.length,
    'youtube.json': read('youtube.json').videos.length,
    'tv.json': read('tv.json').appearances.length,
    'live.json': read('live.json').shows.length,
    'songs.json': read('songs.json').songs.length,
    'events.json': read('events.json').events.length,
  };
  assert.deepEqual(Object.keys(manifest.files).sort(), Object.keys(rows).sort());
  for (const [name, count] of Object.entries(rows)) assert.equal(manifest.files[name].rows, count, name);
});

test('BE:STATS サンプル：最後の日が dataEnd、指標は7つ、出来事の種類は4つだけ', () => {
  const manifest = read('manifest.json');
  const metrics = read('metrics.json');
  assert.equal(metrics.daily[metrics.daily.length - 1].date, manifest.dataEnd);
  assert.equal(metrics.metrics.length, 7);
  const kinds = new Set(read('events.json').events.map((e) => e.kind));
  for (const kind of kinds) assert.ok(['release', 'tv', 'year_end', 'summer'].includes(kind), kind);
});
