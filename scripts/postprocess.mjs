#!/usr/bin/env node
// =============================================================================
// mirror.sh で取得した site/ 以下の HTML を後処理するスクリプト (依存パッケージなし)
//
//   node scripts/postprocess.mjs
//
// やること:
//   1. WordPress 固有で静的サイトには不要なタグを削除
//      (REST API / oEmbed / RSD / pingback のリンク、generator メタ、絵文字スクリプトなど)
//   2. 元サイトの絶対 URL (https://oimofes.jp/...) を相対 URL に書き換え
//      (NEW_BASE を指定すれば、その URL を新しいベースにする)
//   3. 全ページの一覧 PAGES.md を生成 (AI がサイト構造を把握しやすくするため)
//
// 環境変数:
//   OUT_DIR   対象ディレクトリ        (既定: site)
//   SITE_URL  複製元サイトの URL      (既定: https://oimofes.jp/)
//   NEW_BASE  書き換え後のベース URL  (既定: 空 = ルート相対 "/..." にする)
// =============================================================================
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const OUT_DIR = process.env.OUT_DIR || 'site';
const SITE_URL = (process.env.SITE_URL || 'https://oimofes.jp/').replace(/\/+$/, '');
const HOST = new URL(SITE_URL).host.replace(/^www\./, '');
const NEW_BASE = (process.env.NEW_BASE || '').replace(/\/+$/, '');
// PAGES.md は OUT_DIR の 1 つ上 (通常はリポジトリルート) に置く
const PAGES_FILE = process.env.PAGES_FILE || path.join(path.dirname(path.resolve(OUT_DIR)), 'PAGES.md');

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 元サイトの絶対 URL。JSON 内の "https:\/\/host" のようなエスケープ形式にも対応。
const ORIGIN_RE = new RegExp(`https?:(?:\\\\?/){2}(?:www\\.)?${escapeRe(HOST)}(?=[/"'\\\\\\s<>)]|$)`, 'gi');

// 削除するタグ (順序は無関係。属性順に依存しないよう先読みで判定)
const REMOVALS = [
  /<link(?=[^>]*rel=["']https:\/\/api\.w\.org\/["'])[^>]*>\s*/gi,
  /<link(?=[^>]*rel=["']EditURI["'])[^>]*>\s*/gi,
  /<link(?=[^>]*rel=["']wlwmanifest["'])[^>]*>\s*/gi,
  /<link(?=[^>]*rel=["']alternate["'])(?=[^>]*oembed)[^>]*>\s*/gi,
  // RSS / Atom フィードは静的サイトでは配信されないため、リンクも削除
  /<link(?=[^>]*rel=["']alternate["'])(?=[^>]*(?:rss|atom)\+xml)[^>]*>\s*/gi,
  /<link(?=[^>]*rel=["']shortlink["'])[^>]*>\s*/gi,
  /<link(?=[^>]*rel=["']pingback["'])[^>]*>\s*/gi,
  /<meta(?=[^>]*name=["']generator["'])[^>]*>\s*/gi,
  /<script[^>]*>(?:(?!<\/script>)[\s\S])*?_wpemojiSettings[\s\S]*?<\/script>\s*/gi,
  /<script(?=[^>]*wp-emoji-release)[^>]*><\/script>\s*/gi,
];

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

function extractTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].replace(/\s+/g, ' ').trim() : '';
}

function toUrlPath(relFile) {
  // site/about/index.html -> /about/ , site/foo.html -> /foo.html
  let p = '/' + relFile.split(path.sep).join('/');
  p = p.replace(/\/index\.html$/, '/');
  return p;
}

const pages = [];
let filesChanged = 0;

for await (const file of walk(OUT_DIR)) {
  if (!/\.(html?|css|js|xml|json|txt|svg)$/i.test(file)) continue;

  const original = await readFile(file, 'utf8');
  let out = original;

  if (/\.html?$/i.test(file)) {
    for (const re of REMOVALS) out = out.replace(re, '');
    // wget が生成した "about/index.html" 形式のリンクを "about/" 形式に整える
    // (Web サーバーはディレクトリ指定で index.html を返すため、URL がきれいになる)
    out = out.replace(/(href=["'])((?:[^"'>]*\/)?)index\.html(?=["'#?])/gi, (_, attr, dir) => attr + (dir || './'));
    pages.push({ file: path.relative(OUT_DIR, file), title: extractTitle(out) });
  }

  out = out.replace(ORIGIN_RE, NEW_BASE);

  if (out !== original) {
    await writeFile(file, out, 'utf8');
    filesChanged++;
  }
}

for (const p of pages) p.url = toUrlPath(p.file);
pages.sort((a, b) => a.url.localeCompare(b.url, 'ja'));
const outDirLabel = path.relative(process.cwd(), path.resolve(OUT_DIR)) || '.';

const lines = [
  '# ページ一覧',
  '',
  `複製元: ${SITE_URL}  `,
  `生成日時: ${new Date().toISOString()}  `,
  `ページ数: ${pages.length}`,
  '',
  'このファイルは `node scripts/postprocess.mjs` が自動生成します。手で編集しないでください。',
  '',
  '| 公開パス | ファイル | タイトル |',
  '|---|---|---|',
  ...pages.map((p) => `| \`${p.url}\` | \`${outDirLabel}/${p.file}\` | ${p.title.replace(/\|/g, '\\|')} |`),
  '',
];
await writeFile(PAGES_FILE, lines.join('\n'), 'utf8');

console.log(`==> Post-processed ${OUT_DIR}/: ${pages.length} HTML pages, ${filesChanged} files rewritten.`);
console.log(`==> Wrote ${PAGES_FILE}`);
