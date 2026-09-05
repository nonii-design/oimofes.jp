#!/usr/bin/env node
// =============================================================================
// mirror.sh で取得した site/ 以下の HTML を後処理するスクリプト (依存パッケージなし)
//
//   node scripts/postprocess.mjs
//
// やること:
//   1. "style.css@ver=1.2.css" のような wget が付けたクエリ付きファイル名を "style.css" に戻す
//      (拡張子が崩れていると、公開サーバーが正しい MIME タイプを返せず JS/CSS が読み込まれない)
//   2. WordPress 固有で静的サイトには不要なタグを削除
//      (REST API / oEmbed / RSD / pingback / RSS のリンク、generator メタ、絵文字スクリプトなど)
//   3. 遅延読み込み (Smush 等) の data-src / data-srcset を通常の src / srcset に戻す
//   4. 元サイトの絶対 URL (https://oimofes.jp/...) を、各ページからの相対パスに書き換える
//      (どのドメイン・どのサブパスで公開しても壊れないようにする)
//      ただし og:image / canonical など SNS・検索エンジン向けの URL は PUBLIC_URL の絶対 URL にする
//   5. "about/index.html" 形式のリンクを "about/" に整える
//   6. 全ページの一覧 PAGES.md を生成 (AI がサイト構造を把握しやすくするため)
//
// 環境変数:
//   OUT_DIR     対象ディレクトリ                (既定: site)
//   SITE_URL    複製元サイトの URL              (既定: https://oimofes.jp/)
//   PUBLIC_URL  公開後の URL (og:url 等に使用)  (既定: SITE_URL と同じ)
// =============================================================================
import { readdir, readFile, writeFile, rename, rm, access } from 'node:fs/promises';
import path from 'node:path';

const OUT_DIR = process.env.OUT_DIR || 'site';
const SITE_URL = (process.env.SITE_URL || 'https://oimofes.jp/').replace(/\/+$/, '');
const HOST = new URL(SITE_URL).host.replace(/^www\./, '');
const PUBLIC_URL = (process.env.PUBLIC_URL || SITE_URL).replace(/\/+$/, '');
// PAGES.md は OUT_DIR の 1 つ上 (通常はリポジトリルート) に置く
const PAGES_FILE = process.env.PAGES_FILE || path.join(path.dirname(path.resolve(OUT_DIR)), 'PAGES.md');

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exists = (p) => access(p).then(() => true, () => false);

// 元サイトの絶対 URL。JSON 内の "https:\/\/host" のようなエスケープ形式にも対応。
const ORIGIN_RE = new RegExp(`https?:(?:\\\\?/){2}(?:www\\.)?${escapeRe(HOST)}(?=[/"'\\\\\\s<>)]|$)`, 'gi');

// 削除するタグ (属性順に依存しないよう先読みで判定)
const REMOVALS = [
  /<link(?=[^>]*rel=["']https:\/\/api\.w\.org\/["'])[^>]*>\s*/gi,
  /<link(?=[^>]*rel=["']EditURI["'])[^>]*>\s*/gi,
  /<link(?=[^>]*rel=["']wlwmanifest["'])[^>]*>\s*/gi,
  /<link(?=[^>]*rel=["']alternate["'])(?=[^>]*oembed)[^>]*>\s*/gi,
  // WordPress 6.x が出力する REST API へのリンク (type="application/json")
  /<link(?=[^>]*rel=["']alternate["'])(?=[^>]*application\/json)[^>]*>\s*/gi,
  // RSS / Atom フィードは静的サイトでは配信されないため、リンクも削除
  /<link(?=[^>]*rel=["']alternate["'])(?=[^>]*(?:rss|atom)\+xml)[^>]*>\s*/gi,
  /<link(?=[^>]*rel=["']shortlink["'])[^>]*>\s*/gi,
  /<link(?=[^>]*rel=["']pingback["'])[^>]*>\s*/gi,
  /<meta(?=[^>]*name=["']generator["'])[^>]*>\s*/gi,
  /<script[^>]*>(?:(?!<\/script>)[\s\S])*?_wpemojiSettings[\s\S]*?<\/script>\s*/gi,
  /<script(?=[^>]*wp-emoji-release)[^>]*><\/script>\s*/gi,
];

const TEXT_FILE_RE = /\.(html?|css|js|xml|json|txt|svg)$/i;

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

// ---------------------------------------------------------------------------
// 1. クエリ付きファイル名 ("foo.js@ver=1.2", "style.css@ver=1.css") を元の名前に戻す
//
// 注意: wget は URL の "?" を "@" に置き換えるが、"@" はファイル名にも普通に使われる
// (Illustrator が書き出す "アートボード-1@4x.png" など)。
// そこで「@ の直前がすでに拡張子で終わっている」場合だけをクエリと判断して切り落とす。
// ---------------------------------------------------------------------------
const QUERY_AT_RE = /^(.*\.[a-z0-9]{2,5})@(?:$|ver=|v=|m=|x=|\d+$|[a-z_]+=)/i;

const renames = new Map(); // 旧ベース名 -> 新ベース名
{
  const files = [];
  for await (const f of walk(OUT_DIR)) if (path.basename(f).includes('@')) files.push(f);
  for (const oldPath of files) {
    const oldBase = path.basename(oldPath);
    const m = oldBase.match(QUERY_AT_RE);
    if (!m) continue; // ファイル名本来の "@" (例: "...@4x.png") は触らない
    const newBase = m[1];
    if (!newBase) continue;
    const newPath = path.join(path.dirname(oldPath), newBase);
    if (await exists(newPath)) {
      // 別バージョンが既に存在する場合は片方だけ残す (中身はほぼ同一のため)
      await rm(oldPath);
    } else {
      await rename(oldPath, newPath);
    }
    renames.set(oldBase, newBase);
  }
  console.log(`==> Renamed ${renames.size} versioned asset files.`);
}

// 参照側の置換用 (長い名前から順に置換して部分一致の誤爆を防ぐ)
const renameEntries = [...renames.entries()].sort((a, b) => b[0].length - a[0].length);
function applyRenames(text) {
  for (const [oldBase, newBase] of renameEntries) {
    if (text.includes(oldBase)) text = text.split(oldBase).join(newBase);
    // HTML 内では & が &amp; になっていることがある
    const escaped = oldBase.replace(/&/g, '&amp;');
    if (escaped !== oldBase && text.includes(escaped)) text = text.split(escaped).join(newBase);
  }
  return text;
}

// ---------------------------------------------------------------------------
// 3. 遅延読み込み属性を通常属性に戻す
// ---------------------------------------------------------------------------
function unlazy(html) {
  return html.replace(/<(img|source|iframe|video)\b[^>]*\bdata-src(?:set)?=[^>]*>/gi, (tag) => {
    if (!/\bdata-src(set)?=/.test(tag)) return tag;
    let t = tag;
    // ダミーの src (data: の SVG や透明 GIF) を削除
    t = t.replace(/\s(?:src|srcset)=["']data:[^"']*["']/gi, '');
    t = t.replace(/\sdata-src=/gi, ' src=');
    t = t.replace(/\sdata-srcset=/gi, ' srcset=');
    t = t.replace(/\sdata-sizes=/gi, ' sizes=');
    t = t.replace(/\sclass=(["'])([^"']*)\1/i, (_, q, cls) => {
      const kept = cls.split(/\s+/).filter((c) => c && !/^lazyload(ed)?$/.test(c) && c !== 'lazy');
      return kept.length ? ` class=${q}${kept.join(' ')}${q}` : '';
    });
    t = t.replace(/\s*--smush-placeholder-[a-z-]+:\s*[^;"']+;?/gi, '');
    t = t.replace(/\sstyle=(["'])\s*\1/i, '');
    return t;
  });
}

// ---------------------------------------------------------------------------
// 4. ルート相対 "/path" をそのファイルからの相対パスに書き換える
// ---------------------------------------------------------------------------
function relativizeRootPaths(text, depth, isHtml) {
  const prefix = depth === 0 ? './' : '../'.repeat(depth);
  if (isHtml) {
    // 属性値 ="/..." (// で始まるプロトコル相対は除く)
    text = text.replace(/(\s(?:href|src|data-src|data-original|data-bg|data-background|poster|action)=["'])\/(?!\/)/gi, `$1${prefix}`);
    // srcset の各エントリ
    text = text.replace(/(\s(?:srcset|data-srcset)=["'])([^"']+)/gi, (_, attr, val) =>
      attr + val.replace(/(^|,\s*)\/(?!\/)/g, `$1${prefix}`));
  }
  // CSS の url(/...)
  text = text.replace(/url\(\s*(["']?)\/(?!\/)/gi, `url($1${prefix}`);
  return text;
}

// og:*, twitter:*, canonical は絶対 URL に戻す (SNS シェア・検索エンジン用)
function absolutizeSeoTags(html, pageUrlPath) {
  html = html.replace(/<meta(?=[^>]*(?:property|name)=["'](?:og|twitter):[^"']+["'])[^>]*>/gi, (tag) =>
    tag.replace(/(content=["'])(?:\.\.\/|\.\/)*\/?(?=[^"'])/i, (m, attr) => {
      // 相対化済み ("../x", "./x") か ルート相対 ("/x") のみ PUBLIC_URL を付ける
      return /^content=["'](?:\.\.?\/)/i.test(m) || /^content=["']\//.test(m) ? `${attr}${PUBLIC_URL}/` : m;
    }));
  // canonical は wget が相対リンクに変換してしまい元のパス情報が失われるため、
  // ページの公開パスから組み立て直す
  html = html.replace(/<link(?=[^>]*rel=["']canonical["'])[^>]*>/gi, (tag) =>
    tag.replace(/href=["'][^"']*["']/i, `href="${PUBLIC_URL}${pageUrlPath}"`));
  return html;
}

// ---------------------------------------------------------------------------
// メイン処理
// ---------------------------------------------------------------------------
const pages = [];
let filesChanged = 0;

for await (const file of walk(OUT_DIR)) {
  if (!TEXT_FILE_RE.test(file)) continue;

  const original = await readFile(file, 'utf8');
  let out = original;
  const rel = path.relative(OUT_DIR, file);
  const depth = rel.split(path.sep).length - 1;
  const isHtml = /\.html?$/i.test(file);

  out = applyRenames(out);

  if (isHtml) {
    for (const re of REMOVALS) out = out.replace(re, '');
    out = unlazy(out);
  }

  // 元サイトの絶対 URL → ルート相対 → 相対パス
  out = out.replace(ORIGIN_RE, '');
  out = relativizeRootPaths(out, depth, isHtml);

  if (isHtml) {
    // "about/index.html" → "about/" 、 "index.html" → "./"
    out = out.replace(/(href=["'])((?:[^"'>]*\/)?)index\.html(?=["'#?])/gi, (_, attr, dir) => attr + (dir || './'));
    out = absolutizeSeoTags(out, toUrlPath(rel));
    pages.push({ file: rel, title: extractTitle(out) });
  }

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
