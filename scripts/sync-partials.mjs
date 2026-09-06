#!/usr/bin/env node
/**
 * 共通部品 (ヘッダー / フッター) を全ページに流し込む。
 *
 *   node scripts/sync-partials.mjs
 *
 * partials/header.html と partials/footer.html を、site/ 配下のすべての HTML にある
 *   <!-- HEADER:START --> … <!-- HEADER:END -->
 *   <!-- FOOTER:START --> … <!-- FOOTER:END -->
 * の間へ書き込む。部品の中の {{ROOT}} は、そのページからサイトのルートへの
 * 相対パス (./ や ../../) に置き換える。メニューの中で今いるページへのリンクには
 * class="is-current" と aria-current="page" を付ける。
 *
 * ヘッダーやフッターを変えたいときは partials/ のファイルを直してこのスクリプトを実行する。
 * マーカーの間を直接編集しても、次の実行で上書きされる。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.join(ROOT, 'site');

const PARTS = {
  HEADER: fs.readFileSync(path.join(ROOT, 'partials/header.html'), 'utf8').trim(),
  FOOTER: fs.readFileSync(path.join(ROOT, 'partials/footer.html'), 'utf8').trim(),
};

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'wp-content' || entry.name === 'wp-includes') continue;
      yield* walk(full);
    } else if (entry.name.endsWith('.html')) {
      yield full;
    }
  }
}

/** そのページの「ディレクトリ」を site/ からの相対で返す (例: "information/" / "")。 */
function pageDir(file) {
  const rel = path.relative(SITE, file).split(path.sep).join('/');
  const dir = path.posix.dirname(rel);
  return dir === '.' ? '' : dir + '/';
}

function rootPrefix(dir) {
  const depth = dir ? dir.split('/').filter(Boolean).length : 0;
  return depth ? '../'.repeat(depth) : './';
}

/** メニュー内の <li><a href="…"> のうち、今のページを指すものに is-current を付ける。 */
function markCurrent(html, dir) {
  return html.replace(/<li>(\s*)<a href="([^"#]*)(#[^"]*)?">/g, (m, ws, href, hash) => {
    if (hash) return m; // ページ内リンクはスクロール位置で oimo-ui.js が扱う
    let target = path.posix.normalize(path.posix.join(dir, href));
    if (target === '.' || target === './') target = '';
    if (target !== '' && !target.endsWith('/')) target += '/';
    if (target === dir) {
      return `<li class="is-current">${ws}<a href="${href}" aria-current="page">`;
    }
    return m;
  });
}

let files = 0;
let replaced = 0;
for (const file of walk(SITE)) {
  const src = fs.readFileSync(file, 'utf8');
  if (!/<!-- (HEADER|FOOTER):START -->/.test(src)) continue;
  const dir = pageDir(file);
  const prefix = rootPrefix(dir);
  let out = src;
  for (const [name, partial] of Object.entries(PARTS)) {
    // 生成後のマーカーには説明が付くので、START の後ろは何でもよいことにする
    const re = new RegExp(`<!-- ${name}:START[^>]*-->[\\s\\S]*?<!-- ${name}:END -->`);
    if (!re.test(out)) continue;
    let html = partial.split('{{ROOT}}').join(prefix);
    if (name === 'HEADER') html = markCurrent(html, dir);
    out = out.replace(re, () => `<!-- ${name}:START (partials/${name.toLowerCase()}.html から scripts/sync-partials.mjs が生成。直接編集しない) -->\n${html}\n<!-- ${name}:END -->`);
    replaced++;
  }
  if (out !== src) fs.writeFileSync(file, out);
  files++;
}
console.log(`共通部品を書き込みました: ${files} ページ / ${replaced} 箇所`);
