#!/usr/bin/env node
// =============================================================================
// Instagram の最新投稿を取得し、トップページに埋め込むスクリプト (依存パッケージなし)
//
//   INSTAGRAM_TOKEN=xxxx node scripts/fetch-instagram.mjs
//
// やること:
//   1. Instagram API (graph.instagram.com) から最新の投稿を取得する
//   2. 画像を site/wp-content/uploads/instagram/ に保存する
//      (Instagram の画像 URL は数日で期限切れになるため、直接リンクせず自分で保持する)
//   3. site/index.html の <!-- INSTAGRAM:START --> 〜 <!-- INSTAGRAM:END --> を
//      取得した投稿のタイルに書き換える
//
// 環境変数:
//   INSTAGRAM_TOKEN   Instagram のアクセストークン (必須)
//   INSTAGRAM_LIMIT   取得件数              (既定: 8)
//   OUT_DIR           サイトのディレクトリ    (既定: site)
//   IG_USERNAME       リンク先のアカウント名  (既定: oimo.fes)
//
// トークンが無い場合は何もせず正常終了する (アカウントへのリンクが表示されたままになる)。
// =============================================================================
import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';

const TOKEN = process.env.INSTAGRAM_TOKEN || '';
const LIMIT = Number(process.env.INSTAGRAM_LIMIT || 8);  // 2 か所ぶんの最大枚数
const OUT_DIR = process.env.OUT_DIR || 'site';
const USERNAME = process.env.IG_USERNAME || 'oimo.fes';

const MEDIA_DIR = path.join(OUT_DIR, 'wp-content/uploads/instagram');
const INDEX = path.join(OUT_DIR, 'index.html');

// 差し込み先。トップページに 2 か所ある (「0〜100歳のおいもフォト」欄と「Instagram」欄)。
// それぞれ表示件数が違うので枚数も持たせる。
const SLOTS = [
  { name: 'INSTAGRAM', count: 4 },
  { name: 'INSTAGRAM2', count: 7 },
];

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

if (!TOKEN) {
  console.log('==> INSTAGRAM_TOKEN が設定されていないため、埋め込みの更新をスキップしました。');
  console.log('    (ページにはアカウントへのリンクが表示されます)');
  process.exit(0);
}

// --- 1. 投稿を取得 --------------------------------------------------------
const FIELDS = 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp';
const api = `https://graph.instagram.com/me/media?fields=${FIELDS}&limit=${LIMIT}&access_token=${encodeURIComponent(TOKEN)}`;

const res = await fetch(api);
const body = await res.json().catch(() => ({}));
if (!res.ok) {
  const msg = body?.error?.message || `HTTP ${res.status}`;
  console.error(`!! Instagram API から取得できませんでした: ${msg}`);
  console.error('   トークンの期限切れ (60日) の可能性があります。README の手順で再発行してください。');
  process.exit(1);
}

const posts = (body.data || [])
  .filter((p) => p.media_url || p.thumbnail_url)
  .slice(0, LIMIT);
console.log(`==> ${posts.length} 件の投稿を取得しました。`);

if (!posts.length) {
  console.log('==> 投稿が 0 件だったため、ページは変更しません。');
  process.exit(0);
}

// --- 2. 画像を保存 --------------------------------------------------------
await mkdir(MEDIA_DIR, { recursive: true });
const keep = new Set();

for (const p of posts) {
  // 動画・リールはサムネイル、それ以外は画像そのもの
  const url = p.media_type === 'VIDEO' ? (p.thumbnail_url || p.media_url) : p.media_url;
  const file = `${p.id}.jpg`;
  keep.add(file);
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    await writeFile(path.join(MEDIA_DIR, file), Buffer.from(await r.arrayBuffer()));
    p._local = file;
  } catch (e) {
    console.warn(`   !! 画像を保存できませんでした (${p.id}): ${e.message}`);
  }
}

// 表示しなくなった古い画像を削除する
for (const f of await readdir(MEDIA_DIR).catch(() => [])) {
  if (f.endsWith('.jpg') && !keep.has(f)) {
    await rm(path.join(MEDIA_DIR, f));
    console.log(`   古い画像を削除: ${f}`);
  }
}

// --- 3. index.html を書き換え ---------------------------------------------
const available = posts.filter((p) => p._local);

function renderBlock(slot) {
  const tiles = available.slice(0, slot.count).map((p) => {
    const caption = (p.caption || '').replace(/\s+/g, ' ').trim();
    const alt = caption ? caption.slice(0, 80) : `@${USERNAME} の投稿`;
    const badge = p.media_type === 'VIDEO'
      ? '<span class="oimo-ig__badge" aria-hidden="true">▶</span>' : '';
    return `      <a class="oimo-ig__item" href="${esc(p.permalink)}" target="_blank" rel="noopener noreferrer">
        <img src="wp-content/uploads/instagram/${esc(p._local)}" alt="${esc(alt)}" loading="lazy" decoding="async" width="640" height="640" />${badge}
      </a>`;
  }).join('\n');

  return `<!-- ${slot.name}:START -->
  <!-- このブロックは scripts/fetch-instagram.mjs が自動生成します。手で編集しないでください。 -->
  <div class="oimo-ig">
    <div class="oimo-ig__grid" style="--oimo-ig-cols: ${slot.count}">
${tiles}
    </div>
    <p class="oimo-ig__more">
      <a href="https://www.instagram.com/${esc(USERNAME)}/" target="_blank" rel="noopener noreferrer">Instagram で @${esc(USERNAME)} をもっと見る</a>
    </p>
  </div>
  <!-- ${slot.name}:END -->`;
}

let html = await readFile(INDEX, 'utf8');
let updated = 0;
for (const slot of SLOTS) {
  const start = `<!-- ${slot.name}:START -->`;
  const end = `<!-- ${slot.name}:END -->`;
  const s = html.indexOf(start);
  const e = html.indexOf(end);
  if (s < 0 || e < 0) {
    console.warn(`   !! ${start} / ${end} が見つかりませんでした。`);
    continue;
  }
  html = html.slice(0, s) + renderBlock(slot) + html.slice(e + end.length);
  updated++;
}
await writeFile(INDEX, html, 'utf8');

console.log(`==> ${INDEX} の Instagram 欄 ${updated} か所を更新しました (最大 ${available.length} 件)。`);
