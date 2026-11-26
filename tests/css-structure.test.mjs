// CSS の持ち方の決まり（scripts/css-rules.mjs）を守らせるテスト。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PARTIALS, COLOR_LITERAL, checkAll, checkPartial, parseRules, styleBlocks } from '../scripts/css-rules.mjs';

test('画面ごとのCSSは並べ方だけ（見た目は部品ファイル）', () => {
  const problems = Object.values(checkAll()).flat();
  assert.equal(problems.length, 0, `${problems.length} 件\n` + problems.slice(0, 60).join('\n'));
});

test('部品ファイルの色はトークンだけ（値は UniverseTokens.html）', () => {
  const problems = [];
  for (const file of ['Styles.html', 'UniverseTheme.html']) {
    for (const block of styleBlocks(fs.readFileSync(path.join(PARTIALS, file), 'utf8'))) {
      // 部品ファイルではトークンどうしを混ぜる color-mix(var…, var…) は使える。直接の色（#… rgb()…）は不可
      for (const r of parseRules(block.css)) for (const d of r.decls) if (/#[0-9a-f]{3,8}\b|\b(rgba?|hsla?)\(/i.test(d.value)) problems.push(`${file}: ${r.selector} { ${d.prop}: ${d.value} }`);
    }
  }
  assert.equal(problems.length, 0, problems.join('\n'));
});

test('決まりの検査そのものが働く', () => {
  assert.equal(checkPartial('X.html', '<style>.a{display:grid;gap:8px}</style>').length, 0);
  assert.equal(checkPartial('X.html', '<style>.a{color:var(--ui-text)}</style>').length, 1);
  assert.equal(checkPartial('X.html', '<style>@media (max-width:4px){.a{border-radius:2px}}</style>').length, 1);
  assert.equal(checkPartial('X.html', '<style>.a{--x:#fff}</style>').length, 1);
  assert.equal(checkPartial('X.html', '<style data-content>.a{color:red}</style>').length, 1);
  assert.equal(checkPartial('CardStyles.html', '<style data-content>.card-face{background:#fff}</style>').length, 0);
  assert.equal(checkPartial('CardStyles.html', '<style data-content>.card-btn{background:#fff}</style>').length, 1);
});

test('戻るボタンは BACK つきの1種類だけ（矢印だけの版は使わない）', () => {
  const offenders = fs.readdirSync(PARTIALS).filter((f) => f.endsWith('.html')).filter((f) => fs.readFileSync(path.join(PARTIALS, f), 'utf8').includes('ui-back-icon'));
  assert.deepEqual(offenders, []);
});

test('読み込み中は共通の2種類だけ（スケルトン ui-skeleton／くるくる renderUniverseLoading）', () => {
  const problems = [];
  for (const file of fs.readdirSync(PARTIALS).filter((f) => f.endsWith('.html'))) {
    const src = fs.readFileSync(path.join(PARTIALS, file), 'utf8');
    if (/skeleton-block/.test(src)) problems.push(`${file}: 古いスケルトン skeleton-block`);
    if (file !== 'StateUI.html' && /LOADING/.test(src.replace(/__[A-Z_]*LOADING__/g, ''))) problems.push(`${file}: 英語の LOADING 表示`);
    for (const m of src.matchAll(/renderUniverseLoading\(([^)]*)\)/g)) {
      if (/,|#[0-9a-f]{3,6}/i.test(m[1])) problems.push(`${file}: renderUniverseLoading(${m[1]}) に色や2つ目の値は渡さない`);
    }
  }
  assert.deepEqual(problems, []);
});

// 上書きの積み重ねを防ぐ（2026-11-26）。!important は hidden 属性と「動きを減らす」設定の2か所だけ。
test('!important は Styles.html の hidden 属性と動きを減らす設定だけ', () => {
  const problems = [];
  for (const file of fs.readdirSync(PARTIALS).filter((f) => f.endsWith('.html'))) {
    for (const block of styleBlocks(fs.readFileSync(path.join(PARTIALS, file), 'utf8'))) {
      for (const r of parseRules(block.css)) {
        for (const d of r.decls) {
          if (!/!important/.test(d.value)) continue;
          const allowed = file === 'Styles.html' && (r.selector === '[hidden]' || r.selector === '*, *::before, *::after');
          if (!allowed) problems.push(`${file}: ${r.selector} { ${d.prop} }`);
        }
      }
    }
  }
  assert.deepEqual(problems, []);
});

// 同じファイルの中で、同じセレクタの同じ性質を2回書かない（後ろで前を打ち消す書き方をしない）。
// 画面幅などの @media の中は、外の指定を条件つきで変えるものなので数えない。
function withoutAtBlocks(css) {
  let out = '';
  for (let i = 0; i < css.length; i++) {
    if (css[i] === '@' && /^@(media|supports|container)/.test(css.slice(i, i + 11))) {
      const open = css.indexOf('{', i);
      let depth = 1, k = open + 1;
      while (k < css.length && depth > 0) { if (css[k] === '{') depth++; else if (css[k] === '}') depth--; k++; }
      i = k - 1;
      continue;
    }
    out += css[i];
  }
  return out;
}
// カンマで区切る（:is(…, …) や :where(…, …) の中のカンマでは切らない）
function splitSelectors(list) {
  const out = []; let depth = 0, cur = '';
  for (const ch of list) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
test('同じセレクタの同じ性質を同じファイルで二度書かない', () => {
  const problems = [];
  for (const file of fs.readdirSync(PARTIALS).filter((f) => f.endsWith('.html'))) {
    const seen = new Map();
    for (const block of styleBlocks(fs.readFileSync(path.join(PARTIALS, file), 'utf8'))) {
      for (const r of parseRules(withoutAtBlocks(block.css.replace(/\/\*[\s\S]*?\*\//g, '')))) {
        if (r.keyframe) continue;
        for (const sel of splitSelectors(r.selector)) {
          for (const d of r.decls) {
            const key = sel + ' { ' + d.prop + ' }';
            if (seen.has(key) && seen.get(key) !== r) problems.push(`${file}: ${key}`);
            seen.set(key, r);
          }
        }
      }
    }
  }
  assert.deepEqual(problems, []);
});
