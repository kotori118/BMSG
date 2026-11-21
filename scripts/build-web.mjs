#!/usr/bin/env node
/**
 * Build web/index.html from web/src/index.template.html and web/partials/*.html.
 * web/partials is the source of truth for the screens. Edit a partial, then run:
 *   node scripts/build-web.mjs          (writes web/index.html)
 *   node scripts/build-web.mjs --check  (fails if web/index.html is out of date)
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const WEB = path.join(ROOT, 'web');

export function buildIndex() {
  const template = fs.readFileSync(path.join(WEB, 'src', 'index.template.html'), 'utf8');
  return template
    .replace(/^<!-- Page template\..*-->\n/, '')
    .replace(/<!-- @include ([A-Za-z0-9_]+) -->/g, (_, name) => {
      const file = path.join(WEB, 'partials', `${name}.html`);
      if (!fs.existsSync(file)) throw new Error(`index.template.html includes ${name}, but web/partials/${name}.html does not exist`);
      return `\n<!-- ${name}.html -->\n` + fs.readFileSync(file, 'utf8');
    });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = buildIndex();
  const target = path.join(WEB, 'index.html');
  if (process.argv.includes('--check')) {
    if (fs.readFileSync(target, 'utf8') !== out) {
      console.error('web/index.html is out of date. Run: node scripts/build-web.mjs');
      process.exit(1);
    }
    console.log('web/index.html is up to date');
  } else {
    fs.writeFileSync(target, out);
    console.log(`wrote web/index.html (${out.length} bytes)`);
  }
}
