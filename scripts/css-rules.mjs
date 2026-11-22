// CSS の持ち方の決まり（検査の本体）。tests/css-structure.test.mjs と、このファイルを直接実行して使う。
//   1. 見た目（色・枠線・背景・文字・角の丸み・影）を書いてよいのは部品ファイルだけ。
//        UniverseTokens.html … 値（色・書体・大きさ）
//        Styles.html         … 画面の枠（上のバー・下のメニュー・左のメニュー・検索・設定）
//        UniverseTheme.html  … 部品（ボタン・入力欄・見出し・面・一覧・タブなど）
//   2. 画面ごとのCSSは並べ方（display・grid・gap・幅・余白・位置・動き）だけ。
//   3. カードの絵柄やレア度の色のような「中身の見た目」だけは <style data-content> に書ける。
//      置けるファイルは CONTENT_FILES に限る。ボタン・入力欄・戻るはそこでも書けない。
// 詳しくは docs/design/universe-design-system.md。
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
export const PARTIALS = path.join(ROOT, 'web', 'partials');

export const COMPONENT_FILES = ['UniverseTokens.html', 'Styles.html', 'UniverseTheme.html'];
export const CONTENT_FILES = ['CardStyles.html', 'PokerStyles.html', 'CoverStyles.html'];

// 画面ごとのCSSに書けない性質（見た目）
const VISUAL = /^(color|background(-[a-z]+)?|border(-[a-z]+)*|outline(-[a-z]+)?|box-shadow|text-shadow|font(-[a-z]+)?|letter-spacing|text-transform|text-decoration(-[a-z]+)?|-webkit-text-stroke(-[a-z]+)?|-webkit-text-fill-color|fill|stroke(-[a-z]+)?|caret-color|accent-color|(-webkit-)?backdrop-filter|filter|(-webkit-)?mask(-[a-z]+)?|appearance|-webkit-appearance)$/;
export const COLOR_LITERAL = /#[0-9a-f]{3,8}\b|\b(rgba?|hsla?|color-mix)\(/i;
const CONTROL_SELECTOR = /\b(button|input|select|textarea)\b|btn|-back(?![\w-])|ui-/;

// 小さな CSS 読み取り：{ selector, decls:[{prop,value}] } の一覧を返す（@media の中も読む）
export function parseRules(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  function walk(src, inKeyframes) {
    let j = 0;
    let prelude = '';
    while (j < src.length) {
      const ch = src[j];
      if (ch === '{') {
        let depth = 1;
        let k = j + 1;
        while (k < src.length && depth > 0) { if (src[k] === '{') depth++; else if (src[k] === '}') depth--; k++; }
        const body = src.slice(j + 1, k - 1);
        const sel = prelude.trim();
        if (/^@(media|supports|container|layer)/.test(sel)) walk(body, inKeyframes);
        else if (/^@(-webkit-)?keyframes/.test(sel)) walk(body, true);
        else rules.push({ selector: sel, keyframe: inKeyframes, decls: decls(body) });
        prelude = '';
        j = k;
        continue;
      }
      if (ch === ';' && prelude.trim().startsWith('@')) { prelude = ''; j++; continue; }
      prelude += ch;
      j++;
    }
  }
  function decls(body) {
    return body.split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
      const c = d.indexOf(':');
      return { prop: d.slice(0, c).trim().toLowerCase(), value: d.slice(c + 1).trim() };
    });
  }
  walk(text, false);
  return rules;
}

export function styleBlocks(html) {
  return [...html.matchAll(/<style([^>]*)>([\s\S]*?)<\/style>/g)].map((m) => ({ content: /data-content/.test(m[1]), css: m[2] }));
}

export function checkPartial(file, html) {
  const problems = [];
  if (COMPONENT_FILES.includes(file)) return problems;
  for (const block of styleBlocks(html)) {
    const rules = parseRules(block.css);
    if (block.content) {
      if (!CONTENT_FILES.includes(file)) problems.push(`${file}: <style data-content> は ${CONTENT_FILES.join(', ')} だけに置けます`);
      for (const r of rules) if (!r.keyframe && CONTROL_SELECTOR.test(r.selector)) problems.push(`${file}: 中身の見た目にボタン・入力欄は書けません → ${r.selector}`);
      continue;
    }
    for (const r of rules) {
      for (const d of r.decls) {
        if (VISUAL.test(d.prop)) problems.push(`${file}: ${r.selector} { ${d.prop} } は見た目です（部品ファイルへ）`);
        else if (!d.prop.startsWith('--') && COLOR_LITERAL.test(d.value)) problems.push(`${file}: ${r.selector} { ${d.prop}: ${d.value} } に色が直接書かれています`);
        else if (d.prop.startsWith('--') && COLOR_LITERAL.test(d.value)) problems.push(`${file}: ${r.selector} { ${d.prop} } に色が直接書かれています（トークンを使う）`);
      }
    }
  }
  return problems;
}

export function checkAll() {
  const byFile = {};
  for (const file of fs.readdirSync(PARTIALS).filter((f) => f.endsWith('.html'))) {
    const p = checkPartial(file, fs.readFileSync(path.join(PARTIALS, file), 'utf8'));
    if (p.length) byFile[file] = p;
  }
  return byFile;
}

// node scripts/css-rules.mjs            … ファイルごとの件数
// node scripts/css-rules.mjs Foo.html   … そのファイルの中身
if (import.meta.url === `file://${process.argv[1]}`) {
  const all = checkAll();
  const only = process.argv[2];
  if (only) console.log((all[only] || []).join('\n') || 'OK');
  else {
    const rows = Object.entries(all).sort((a, b) => b[1].length - a[1].length);
    for (const [f, p] of rows) console.log(String(p.length).padStart(5), f);
    console.log(String(rows.reduce((n, r) => n + r[1].length, 0)).padStart(5), 'total');
  }
}
