#!/usr/bin/env node
// =============================================================================
// wget が取りこぼした画像などを追加ダウンロードするスクリプト (依存パッケージなし)
//
//   node scripts/fetch-missing.mjs
//
// 背景:
//   遅延読み込みプラグイン (Smush など) は実際の画像 URL を data-src / data-srcset に入れ、
//   src にはダミーの SVG を入れるため、wget はそれらの画像を取得できない。
//   また og:image (SNS シェア用画像) など <meta content="..."> も wget は追跡しない。
//   このスクリプトは site/ 内の HTML / CSS から元サイトを指す URL をすべて集め、
//   ローカルに存在しないものだけをダウンロードして同じパス構成で保存する。
//
// 環境変数:
//   OUT_DIR      対象ディレクトリ      (既定: site)
//   SITE_URL     複製元サイトの URL    (既定: https://oimofes.jp/)
//   CONCURRENCY  同時ダウンロード数    (既定: 4)
// =============================================================================
import { readdir, readFile, writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';

const OUT_DIR = process.env.OUT_DIR || 'site';
const SITE_URL = (process.env.SITE_URL || 'https://oimofes.jp/').replace(/\/+$/, '');
const HOST = new URL(SITE_URL).host.replace(/^www\./, '');
const CONCURRENCY = Number(process.env.CONCURRENCY || 4);

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ORIGIN_RE = new RegExp(`^https?:\\/\\/(?:www\\.)?${escapeRe(HOST)}(?=\\/|$)`, 'i');

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

const exists = (p) => access(p).then(() => true, () => false);

// URL 文字列 → 元サイト上のパス ("/wp-content/..." 形式)。対象外なら null。
function toSitePath(raw) {
  let u = raw.trim().replace(/&amp;/g, '&').replace(/\\\//g, '/');
  if (!u || u.startsWith('data:') || u.startsWith('#') || u.startsWith('mailto:') || u.startsWith('tel:')) return null;
  if (/^https?:\/\//i.test(u)) {
    if (!ORIGIN_RE.test(u)) return null; // 外部サイト
    u = u.replace(ORIGIN_RE, '');
  } else if (u.startsWith('//')) {
    return null;
  } else if (!u.startsWith('/')) {
    return null; // 相対パスは wget が既に処理済み
  }
  u = u.split(/[?#]/)[0];
  if (!u || u === '/' || /\/$/.test(u)) return null; // ページ (ディレクトリ) は対象外
  if (/\/(wp-json|wp-admin|xmlrpc\.php|wp-login\.php)/.test(u)) return null;
  if (!/\.[a-z0-9]{2,5}$/i.test(u)) return null; // 拡張子のないものはページ扱い
  return u;
}

function collectUrls(text) {
  const found = new Set();
  const add = (v) => { const p = toSitePath(v); if (p) found.add(p); };

  // 属性: src / href / data-src / content / poster / data-bg など
  for (const m of text.matchAll(/\b(?:src|href|data-src|data-original|data-bg|data-background|poster|content)=["']([^"']+)["']/gi)) add(m[1]);
  // srcset / data-srcset は "URL 幅, URL 幅" 形式
  for (const m of text.matchAll(/\b(?:srcset|data-srcset)=["']([^"']+)["']/gi)) {
    for (const part of m[1].split(',')) add(part.trim().split(/\s+/)[0]);
  }
  // CSS の url(...)
  for (const m of text.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) add(m[1]);
  return found;
}

const wanted = new Set();
for await (const file of walk(OUT_DIR)) {
  if (!/\.(html?|css|js)$/i.test(file) && !/\.css@/i.test(file)) continue;
  const text = await readFile(file, 'utf8');
  for (const u of collectUrls(text)) wanted.add(u);
}

const missing = [];
for (const sitePath of wanted) {
  const local = path.join(OUT_DIR, decodeURIComponent(sitePath));
  if (!(await exists(local))) missing.push({ sitePath, local });
}

console.log(`==> Referenced site assets: ${wanted.size}, missing locally: ${missing.length}`);

let ok = 0, failed = 0;
async function download({ sitePath, local }) {
  // 元サイトへのリクエストはパスを URL エンコードした形で送る
  const url = SITE_URL + encodeURI(decodeURIComponent(sitePath));
  try {
    const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 oimofes-mirror' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await mkdir(path.dirname(local), { recursive: true });
    await writeFile(local, Buffer.from(await res.arrayBuffer()));
    ok++;
  } catch (e) {
    failed++;
    console.warn(`   !! ${sitePath}: ${e.message}`);
  }
}

const queue = [...missing];
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (queue.length) await download(queue.shift());
}));

console.log(`==> Downloaded ${ok} files, ${failed} failed.`);
