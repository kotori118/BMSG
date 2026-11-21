import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildIndex } from '../scripts/build-web.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

test('web/index.html is built from web/partials (run: node scripts/build-web.mjs)', () => {
  assert.equal(fs.readFileSync(path.join(ROOT, 'web', 'index.html'), 'utf8'), buildIndex());
});

test('every partial in web/partials is included in the page', () => {
  const template = fs.readFileSync(path.join(ROOT, 'web', 'src', 'index.template.html'), 'utf8');
  const included = new Set([...template.matchAll(/<!-- @include ([A-Za-z0-9_]+) -->/g)].map((m) => m[1]));
  const partials = fs.readdirSync(path.join(ROOT, 'web', 'partials')).filter((f) => f.endsWith('.html')).map((f) => f.slice(0, -5));
  assert.deepEqual(partials.filter((p) => !included.has(p)), []);
});

test('favorites and recent history are gone from the screens', () => {
  const page = fs.readFileSync(path.join(ROOT, 'web', 'index.html'), 'utf8');
  for (const word of ['getUniverseFavorites', 'setUniverseFavorite', 'recordUniverseActivity', 'favoritePageButton', 'MutationObserver(function(){\n      syncCurrentFavoriteButton']) {
    assert.ok(!page.includes(word), `${word} should be removed`);
  }
});
