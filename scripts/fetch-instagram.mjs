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
// 差し込み先はトップページに 2 か所あり、**別々のアカウント**を出す:
//   INSTAGRAM  … 「0歳〜100歳のおいもフォト」欄  → @oimo.photo
//   INSTAGRAM2 … 「Instagram」欄                → @oimo.fes
// Instagram API はトークンの持ち主の投稿しか返さないので、アカウントごとに
// トークンが要る。片方だけ登録されているときは、そちらだけ更新する。
//
// 環境変数:
//   INSTAGRAM_TOKEN         @oimo.fes のアクセストークン
//   INSTAGRAM_TOKEN_PHOTO   @oimo.photo のアクセストークン
//   INSTAGRAM_LIMIT         1 アカウントあたりの取得件数 (既定: 8)
//   OUT_DIR                 サイトのディレクトリ (既定: site)
//   IG_USERNAME             「Instagram」欄のアカウント名   (既定: oimo.fes)
//   IG_USERNAME_PHOTO       「おいもフォト」欄のアカウント名 (既定: oimo.photo)
//   IG_API_BASE             API の宛先 (既定: https://graph.instagram.com。動作確認用)
//
// トークンが 1 つも無い場合は何もせず正常終了する
// (そのブロックはアカウントへのリンクだけが表示されたままになる)。
// =============================================================================
import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';

const API_BASE = (process.env.IG_API_BASE || 'https://graph.instagram.com').replace(/\/$/, '');
const LIMIT = Number(process.env.INSTAGRAM_LIMIT || 8);
const OUT_DIR = process.env.OUT_DIR || 'site';

const MEDIA_DIR = path.join(OUT_DIR, 'wp-content/uploads/instagram');
const INDEX = path.join(OUT_DIR, 'index.html');

// 差し込み先。count はその欄に取り込む枚数。
// 並べ方 (パソコン 1 行 4 枚 / スマホ 1 行 2 枚・6 枚まで) は custom.css が決める。
const SLOTS = [
  {
    name: 'INSTAGRAM',
    count: 4,
    username: process.env.IG_USERNAME_PHOTO || 'oimo.photo',
    token: process.env.INSTAGRAM_TOKEN_PHOTO || '',
    tokenName: 'INSTAGRAM_TOKEN_PHOTO',
    // 実物の写真のように白フチと影を付けて少し傾ける (custom.css)
    variant: 'oimo-ig--photo',
  },
  {
    name: 'INSTAGRAM2',
    count: 8,
    username: process.env.IG_USERNAME || 'oimo.fes',
    token: process.env.INSTAGRAM_TOKEN || '',
    tokenName: 'INSTAGRAM_TOKEN',
  },
];

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

if (!SLOTS.some((s) => s.token)) {
  console.log('==> トークンが 1 つも設定されていないため、埋め込みの更新をスキップしました。');
  console.log('    (ページにはアカウントへのリンクが表示されます)');
  process.exit(0);
}

const FIELDS = 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp';

/** 1 アカウントぶんの投稿を取る。取れなければ null (そのブロックは触らない) */
async function fetchPosts(slot) {
  const api = `${API_BASE}/me/media?fields=${FIELDS}`
    + `&limit=${LIMIT}&access_token=${encodeURIComponent(slot.token)}`;
  let res;
  try {
    res = await fetch(api);
  } catch (e) {
    console.error(`!! @${slot.username}: Instagram API に接続できませんでした: ${e.message}`);
    return null;
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.error?.message || `HTTP ${res.status}`;
    console.error(`!! @${slot.username}: Instagram API から取得できませんでした: ${msg}`);
    console.error(`   ${slot.tokenName} の期限切れ (60日) の可能性があります。README の手順で再発行してください。`);
    return null;
  }
  const posts = (body.data || [])
    .filter((p) => p.media_url || p.thumbnail_url)
    .slice(0, slot.count);
  console.log(`==> @${slot.username}: ${posts.length} 件の投稿を取得しました。`);
  return posts;
}

// --- 1. アカウントごとに投稿を取得 ------------------------------------------
for (const slot of SLOTS) {
  if (!slot.token) {
    console.log(`==> @${slot.username}: ${slot.tokenName} が未設定のため、この欄はそのままにします。`);
    continue;
  }
  slot.posts = await fetchPosts(slot);
}

// --- 2. 画像を保存 --------------------------------------------------------
await mkdir(MEDIA_DIR, { recursive: true });
// 更新しない欄の画像を消さないよう、今ページに載っているファイル名も残す
const current = await readFile(INDEX, 'utf8');
const keep = new Set(
  [...current.matchAll(/wp-content\/uploads\/instagram\/([^"']+\.jpg)/g)].map((m) => m[1]),
);

for (const slot of SLOTS) {
  for (const p of slot.posts || []) {
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
}

// --- 3. index.html を書き換え ---------------------------------------------
function renderBlock(slot) {
  const tiles = (slot.posts || []).filter((p) => p._local).slice(0, slot.count).map((p) => {
    const caption = (p.caption || '').replace(/\s+/g, ' ').trim();
    const alt = caption ? caption.slice(0, 80) : `@${slot.username} の投稿`;
    const badge = p.media_type === 'VIDEO'
      ? '<span class="oimo-ig__badge" aria-hidden="true">▶</span>' : '';
    return `      <a class="oimo-ig__item" href="${esc(p.permalink)}" target="_blank" rel="noopener noreferrer">
        <img src="wp-content/uploads/instagram/${esc(p._local)}" alt="${esc(alt)}" loading="lazy" decoding="async" width="640" height="640" />${badge}
      </a>`;
  }).join('\n');

  return `<!-- ${slot.name}:START -->
  <!-- このブロックは scripts/fetch-instagram.mjs が自動生成します。手で編集しないでください。 -->
  <div class="oimo-ig${slot.variant ? ` ${slot.variant}` : ''}">
    <div class="oimo-ig__grid">
${tiles}
    </div>
    <p class="oimo-ig__more">
      <a href="https://www.instagram.com/${esc(slot.username)}/" target="_blank" rel="noopener noreferrer">Instagram で @${esc(slot.username)} をもっと見る</a>
    </p>
  </div>
  <!-- ${slot.name}:END -->`;
}

let html = current;
let updated = 0;
for (const slot of SLOTS) {
  // 取得できなかった欄は今の表示のまま残す (空にして見栄えを崩さない)
  if (!slot.posts || !slot.posts.some((p) => p._local)) continue;
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

// --- 4. どの欄からも参照されなくなった画像を消す ------------------------------
const used = new Set(
  [...html.matchAll(/wp-content\/uploads\/instagram\/([^"']+\.jpg)/g)].map((m) => m[1]),
);
for (const f of await readdir(MEDIA_DIR).catch(() => [])) {
  if (f.endsWith('.jpg') && !used.has(f)) {
    await rm(path.join(MEDIA_DIR, f));
    console.log(`   古い画像を削除: ${f}`);
  }
}

console.log(`==> ${INDEX} の Instagram 欄 ${updated} か所を更新しました。`);
