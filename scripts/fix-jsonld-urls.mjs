#!/usr/bin/env node
/**
 * 各ページの構造化データ (JSON-LD) の URL を絶対 URL に直す。
 *
 *   node scripts/fix-jsonld-urls.mjs
 *
 * 複製 (mirror.sh) のときに、HTML のリンクと一緒に JSON-LD の中の URL まで
 * 相対パスへ書き換えられてしまい、サイトのトップを指していた
 *   "item": "https://oimofes.jp/"
 * が空文字 "" になっていた。Google Search Console はこれを
 * 「項目『item』がありません (『itemListElement』に含まれる)」として
 * パンくずリストの重大な問題に挙げる。
 *
 * 構造化データの URL は、ページの場所に関係なく同じものを指す必要があるので、
 * HTML のリンク (相対パスのまま) とは違って絶対 URL で書く。
 * CLAUDE.md の「相対パスを維持する」はこのファイルには当てはまらない。
 *
 * やること:
 *   - "@id" / "url" / "item" の値を https://oimofes.jp からの絶対 URL にする
 *   - パンくずの各項目に item が無い / 空のときは、その項目の @id から補う
 *     (最後の項目は、そのページの <link rel="canonical"> を使う。
 *      WordPress 時代の古い slug が残っていることがあるため)
 *   - サイトに存在しないページを指す段 (複製していない年月別アーカイブなど) は外し、
 *     position と nextItem / previousItem を振り直す。
 *     このとき最後の段の名前が数字だけ (年月別アーカイブの「25」など) になるので、
 *     ページの <title> の先頭 (「2022年12月25日」) に置き換える
 *   - name が数値 (例: 2022) のときは文字列にする
 *
 * 何度実行しても結果は変わらない。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.join(ROOT, 'site');
const ORIGIN = process.env.OIMO_ORIGIN || 'https://oimofes.jp';

const TAG = /(<script type="application\/ld\+json"[^>]*>)([\s\S]*?)(<\/script>)/g;
const URL_KEYS = new Set(['@id', 'url', 'item']);

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

/** そのページの絶対 URL (例: https://oimofes.jp/2022/12/25/) */
function pageUrl(file) {
  const rel = path.relative(SITE, file).split(path.sep).join('/');
  const dir = rel.endsWith('/index.html') ? rel.slice(0, -'index.html'.length) : rel;
  return ORIGIN + '/' + (dir === 'index.html' ? '' : dir);
}

/** 相対パス・空文字・スラッシュ落ちを絶対 URL に直す */
function absolutize(value, base) {
  const v = String(value).trim();
  if (!v) return '';
  // 複製前の名残り。ホスト名の直後にスラッシュが無い (https://oimofes.jp#listItem)
  if (v.startsWith(ORIGIN + '#')) return ORIGIN + '/#' + v.slice(ORIGIN.length + 1);
  if (/^[a-z][a-z0-9+.-]*:/i.test(v) || v.startsWith('//')) return v; // すでに絶対 / 他サイト
  try {
    return new URL(v, base).href;
  } catch {
    return v;
  }
}

/** その URL がこのサイトのページとして存在するか */
function exists(url) {
  if (!url.startsWith(ORIGIN)) return true; // 外部サイトは判定しない
  let rel;
  try {
    rel = decodeURIComponent(new URL(url).pathname).replace(/^\//, '');
  } catch {
    return false;
  }
  if (rel === '' || rel.endsWith('/')) return fs.existsSync(path.join(SITE, rel, 'index.html'));
  return fs.existsSync(path.join(SITE, rel));
}

/** パンくずを整える。canonical はそのページの正しい URL、title はページの見出し */
function fixBreadcrumb(node, base, canonical, title) {
  let items = node.itemListElement;
  if (!Array.isArray(items) || !items.length) return;

  // 1. item を埋める。最後の段はそのページ自身なので canonical を使う
  items.forEach((item, i) => {
    if (!item || typeof item !== 'object') return;
    if (i === items.length - 1) {
      item.item = canonical || base;
      return;
    }
    if (typeof item.item === 'string' && item.item !== '') return;
    const id = typeof item['@id'] === 'string' ? absolutize(item['@id'], base) : '';
    if (id) item.item = id.replace(/#.*$/, '');
  });

  // 2. 存在しないページを指す段を外す (最初のホームと最後のページ自身は必ず残す)
  const before = items.length;
  items = items.filter((item, i) => {
    if (i === 0 || i === items.length - 1) return true;
    return exists(item.item);
  });

  // 間の段を外すと、最後の名前が数字だけ (年月別アーカイブの「25」) になって
  // 何のページか分からなくなるので、ページの見出しに置き換える
  const last = items[items.length - 1];
  if (items.length < before && title && /^\d+$/.test(String(last.name))) {
    last.name = title;
  }

  // 3. position と前後のつながりを振り直す
  items.forEach((item, i) => {
    item.position = i + 1;
    const link = (other) => ({ '@type': 'ListItem', '@id': other['@id'], name: other.name });
    if (i > 0) item.previousItem = link(items[i - 1]); else delete item.previousItem;
    if (i < items.length - 1) item.nextItem = link(items[i + 1]); else delete item.nextItem;
  });

  node.itemListElement = items;
}

function fixNode(node, base, canonical, title) {
  if (Array.isArray(node)) {
    node.forEach((v) => fixNode(v, base, canonical, title));
    return;
  }
  if (!node || typeof node !== 'object') return;

  for (const [key, value] of Object.entries(node)) {
    if (URL_KEYS.has(key) && typeof value === 'string' && value !== '') {
      node[key] = absolutize(value, base);
    } else if (key === 'name' && typeof value === 'number') {
      node[key] = String(value);
    } else {
      fixNode(value, base, canonical, title);
    }
  }

  if (node['@type'] === 'BreadcrumbList') fixBreadcrumb(node, base, canonical, title);
}

let pages = 0;
let changed = 0;
for (const file of walk(SITE)) {
  const src = fs.readFileSync(file, 'utf8');
  if (!/application\/ld\+json/.test(src)) continue;
  pages++;
  const base = pageUrl(file);
  const canon = src.match(/<link rel="canonical" href="([^"]+)"/);
  const canonical = canon ? absolutize(canon[1], base) : base;
  // <title> は「ページ名 - サイト名」の形。先頭だけ使う
  const t = src.match(/<title>([^<]*)<\/title>/);
  const title = t ? t[1].split(' - ')[0].trim() : '';
  const out = src.replace(TAG, (whole, open, body, close) => {
    let data;
    try {
      data = JSON.parse(body);
    } catch {
      console.warn(`  読めない JSON-LD をとばしました: ${path.relative(ROOT, file)}`);
      return whole;
    }
    fixNode(data, base, canonical, title);
    return open + JSON.stringify(data) + close;
  });
  if (out !== src) {
    fs.writeFileSync(file, out);
    changed++;
  }
}
console.log(`構造化データの URL を直しました: ${changed} / ${pages} ページ`);
