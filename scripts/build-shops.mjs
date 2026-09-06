#!/usr/bin/env node
/**
 * 店舗一覧を data/shops.json から生成して HTML に流し込む。
 *
 *   node scripts/build-shops.mjs
 *
 * site/ 配下の HTML にある
 *   <!-- SHOPS:START <グループID> --> … <!-- SHOPS:END -->
 * の間を、data/shops.json の該当グループのカードで置き換える。
 *
 * 店舗を追加・修正するときは data/shops.json を編集してこのスクリプトを実行する。
 *   - image は site/ からの相対パス。同じフォルダーに "名前-幅x高さ.拡張子" の
 *     縮小版があれば自動で srcset に加える (python3 scripts/optimize-images.py の後に実行する)。
 *   - link は任意 (店舗の Instagram 投稿など)。無ければ画像はリンクにしない。
 *   - area は任意 (都道府県など)。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.join(ROOT, 'site');
const DATA = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/shops.json'), 'utf8'));

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 画像と同じフォルダーにある縮小版を探して srcset を組み立てる。 */
function srcset(image, prefix) {
  const dir = path.posix.dirname(image);
  const ext = path.posix.extname(image);
  const stem = path.posix.basename(image, ext);
  const abs = path.join(SITE, dir);
  const candidates = [];
  if (fs.existsSync(abs)) {
    const re = new RegExp(`^${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)x(\\d+)${ext.replace('.', '\\.')}$`);
    for (const f of fs.readdirSync(abs)) {
      const m = re.exec(f);
      if (m) candidates.push({ file: `${dir}/${f}`, w: Number(m[1]) });
    }
  }
  return candidates
    .sort((a, b) => a.w - b.w)
    .map((c) => `${prefix}${encodePath(c.file)} ${c.w}w`);
}

/** 日本語のファイル名はそのまま、スペースなどだけを安全にする。 */
function encodePath(p) {
  return p.split('/').map((seg) => seg.replace(/ /g, '%20').replace(/"/g, '%22')).join('/');
}

function card(shop, prefix) {
  const src = `${prefix}${encodePath(shop.image)}`;
  const set = srcset(shop.image, prefix);
  if (shop.width) set.push(`${src} ${shop.width}w`);
  const size = shop.width && shop.height ? ` width="${shop.width}" height="${shop.height}"` : '';
  const img = `<img src="${src}"${set.length ? ` srcset="${set.join(', ')}" sizes="(max-width: 575px) calc(100vw - 88px), (max-width: 991px) 45vw, 360px"` : ''}${size} alt="${esc(shop.name)}" loading="lazy" decoding="async">`;
  const media = shop.link
    ? `<a class="oimo-shop__link" href="${esc(shop.link)}" target="_blank" rel="noopener">${img}</a>`
    : `<div class="oimo-shop__link">${img}</div>`;
  const area = shop.area ? `<span class="oimo-shop__area">［${esc(shop.area)}］</span>` : '';
  return `      <article class="oimo-card oimo-shop" data-reveal>
        ${media}
        <h3 class="oimo-shop__name">${esc(shop.name)}${area}</h3>
      </article>`;
}

function render(group, prefix) {
  return `    <div class="oimo-grid oimo-grid--3 oimo-shops">
${group.shops.map((s) => card(s, prefix)).join('\n')}
    </div>`;
}

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

let count = 0;
for (const file of walk(SITE)) {
  const src = fs.readFileSync(file, 'utf8');
  if (!src.includes('<!-- SHOPS:START')) continue;
  const rel = path.relative(SITE, path.dirname(file)).split(path.sep).filter(Boolean);
  const prefix = rel.length ? '../'.repeat(rel.length) : './';
  // 生成後のマーカーには説明が付くので、グループ ID の後ろは何でもよいことにする
  const out = src.replace(/<!-- SHOPS:START (\S+)[^>]*-->[\s\S]*?<!-- SHOPS:END -->/g, (m, id) => {
    const group = DATA.groups.find((g) => g.id === id);
    if (!group) {
      console.warn(`!! ${path.relative(ROOT, file)}: グループ "${id}" が data/shops.json にありません`);
      return m;
    }
    count++;
    return `<!-- SHOPS:START ${id} (data/shops.json から scripts/build-shops.mjs が生成。直接編集しない) -->\n${render(group, prefix)}\n    <!-- SHOPS:END -->`;
  });
  if (out !== src) fs.writeFileSync(file, out);
}
console.log(`店舗一覧を生成しました: ${count} 箇所`);
