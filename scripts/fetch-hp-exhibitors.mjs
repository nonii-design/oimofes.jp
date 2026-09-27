#!/usr/bin/env node
// =============================================================================
// イベント管理ポータルの「HP掲載 出店者」を取得して、トップページの店舗一覧に反映する
// スクリプト (依存パッケージなし)
//
//   HP_EXHIBITORS_TOKEN=xxxx node scripts/fetch-hp-exhibitors.mjs
//
// やること:
//   1. GET /api/public/hp-exhibitors?event=<slug> で「HPに公開」中の店舗を取得
//   2. 出店エリアごとに data/shops.json のグループへ振り分ける (対応表は AREA_GROUPS)
//      - そのエリアに 1 店舗でも公開があれば、グループの店舗を **すべて置き換える**
//        (前回開催の店舗は消える)
//      - 0 店舗のエリアは触らない (前回開催の店舗が残る)
//   3. 画像を site/wp-content/uploads/portal/<slug>/ に保存し、scripts/optimize-images.py で軽量化
//      (ページ内は相対パスのまま)
//   4. 置き換えたエリアの「近日公開」のお知らせ (<!-- SHOPS:NOTICE <id> -->) を空にする
//   5. scripts/build-shops.mjs を実行して HTML を作り直す
//   6. 「順次更新中」の注記 (<!-- SHOPS:UPDATING <id> -->) を、ポータルの notices.updating に合わせて出し入れ
//
// 環境変数:
//   HP_EXHIBITORS_TOKEN  ポータルの公開 API のトークン (必須)
//   HP_PORTAL_URL        ポータルの URL   (既定: https://event-portal.nonii.co.jp)
//   OIMO_EVENT_SLUG      イベントの slug  (既定: oimo-fes-fujicity-2026)
//   OUT_DIR              サイトのディレクトリ (既定: site)
//
// トークンが無い場合は何もせず正常終了する (data/shops.json の内容がそのまま使われる)。
//
// 対応する API: GET /api/public/hp-exhibitors?event=<slug>
//   → { event, generatedAt, vendors: [{ applicationId, shopName, category, prefecture,
//        catchphrase, instagram, imageUrl, imageFocus, sortOrder }] }
//   imageFocus は写真を正方形に切り抜くときの位置 (管理画面の「HP での切り抜き位置」)。
// =============================================================================
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

const TOKEN = process.env.HP_EXHIBITORS_TOKEN || '';
const PORTAL = (process.env.HP_PORTAL_URL || 'https://event-portal.nonii.co.jp').replace(/\/$/, '');
const EVENT_SLUG = process.env.OIMO_EVENT_SLUG || 'oimo-fes-fujicity-2026';
const OUT_DIR = process.env.OUT_DIR || 'site';

const DATA_PATH = 'data/shops.json';
const INDEX = path.join(OUT_DIR, 'index.html');
// 画像の置き場所 (site/ からの相対パスで shops.json に書く)
const IMAGE_DIR_REL = `wp-content/uploads/portal/${EVENT_SLUG}`;

// ポータルの「出店エリア」と data/shops.json のグループ id の対応表。
// 一覧のセクションを増やすときは、index.html に <!-- SHOPS:START <id> --> を置き、
// data/shops.json にグループを足してから、ここに 1 行足す。
const AREA_GROUPS = {
  全国おいもエリア: 'oimo',
  全国グルメエリア: 'gourmet',
  生産者エリア: 'producers',
  '体験・あそび・物販エリア': 'experience',
};

/** 「静岡県」→「静岡」 (北海道はそのまま) */
function shortPrefecture(v) {
  const s = String(v ?? '').trim();
  if (!s || s === '北海道') return s;
  return s.replace(/[都府県]$/, '');
}

/**
 * data/shops.json の overrides を 1 店舗に当てる。
 *
 * ポータルが返す prefecture は **出店者が登録した住所 (会社の所在地)** なので、
 * チラシや地図に出している **店舗の所在地** と食い違うことがある。
 *   例: 「焼き芋専門店 芋やす」… 登録は茨城県、店舗は浅草
 *       「小江戸川越 芋福堂」  … 登録は群馬県、店名・店舗は川越 (埼玉)
 * ポータル側の住所は請求などに使う正しい値なので書き換えず、
 * **HP の表示だけ** をここで上書きする。取り込みのたびに毎回当たるので消えない。
 */
function applyOverride(shop, overrides) {
  const o = overrides?.byName?.[shop.name];
  if (!o) return;
  if (typeof o.area === 'string') {
    if (o.area.trim()) shop.area = o.area.trim();
    else delete shop.area;
  }
  if (typeof o.name === 'string' && o.name.trim()) shop.name = o.name.trim();
  if (typeof o.link === 'string' && /^https?:\/\//.test(o.link)) shop.link = o.link;
}

/**
 * data/shops.json の overrides.order で並び順を決める。
 *
 * ポータルの並び (sortOrder) は申込順なので、HP で見せたい順とは別。
 * order に書いた店舗名の順に並べ、書いていない店舗は後ろに回す
 * (ポータルでの並びは保ったまま)。新しく出店が決まった店舗は後ろに出るので、
 * そのときは order に足す。名前が変わると当たらなくなるため、外れた分は下に出す。
 */
function applyOrder(shops, overrides, groupTitle) {
  const order = overrides?.order;
  if (!Array.isArray(order) || order.length === 0) return;
  const rank = new Map(order.map((name, i) => [name, i]));
  shops.forEach((s, i) => { s._i = i; });
  shops.sort((a, b) => {
    const ra = rank.has(a.name) ? rank.get(a.name) : Number.MAX_SAFE_INTEGER;
    const rb = rank.has(b.name) ? rank.get(b.name) : Number.MAX_SAFE_INTEGER;
    return ra - rb || a._i - b._i;
  });
  const rest = shops.filter((s) => !rank.has(s.name)).map((s) => s.name);
  shops.forEach((s) => { delete s._i; });
  if (rest.length) {
    console.log(`    - ${groupTitle}: overrides.order に無いため末尾に置きました: ${rest.join(' / ')}`);
  }
}

/** Instagram のユーザー名または URL → プロフィール URL */
function instagramUrl(v) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  const name = s.replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/\/.*$/, '');
  return /^[A-Za-z0-9._]+$/.test(name) ? `https://www.instagram.com/${name}/` : '';
}

/** 画像 URL の短い指紋 (ファイル名に付けて、写真の差し替えを検出する) */
// v2: optimize-images.py が EXIF の回転を焼き込むようになったため、以前に保存した画像を作り直す
const IMAGE_PIPELINE_VERSION = 'v2';
function imageFingerprint(url) {
  let h = 0;
  for (const ch of `${IMAGE_PIPELINE_VERSION}|${String(url)}`) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h.toString(36);
}

/** Content-Type / URL から拡張子を決める */
function extensionFor(url, contentType) {
  const ct = String(contentType || '').toLowerCase();
  if (ct.includes('png')) return '.png';
  if (ct.includes('webp')) return '.webp';
  if (ct.includes('gif')) return '.gif';
  if (ct.includes('jpeg') || ct.includes('jpg')) return '.jpg';
  const m = /\.(jpe?g|png|webp|gif)(\?|$)/i.exec(url);
  return m ? `.${m[1].toLowerCase().replace('jpeg', 'jpg')}` : '.jpg';
}

if (!TOKEN) {
  console.log('==> HP_EXHIBITORS_TOKEN が設定されていないため、店舗一覧の更新をスキップしました。');
  console.log('    (data/shops.json の内容がそのまま使われます)');
  process.exit(0);
}

// --- 1. ポータルから取得 ---------------------------------------------------
const api = `${PORTAL}/api/public/hp-exhibitors?event=${encodeURIComponent(EVENT_SLUG)}`;
let json;
try {
  const res = await fetch(api, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!res.ok) {
    console.error(`!! ポータルから取得できませんでした: HTTP ${res.status}`);
    if (res.status === 401) console.error('   トークンが違う可能性があります (HP_EXHIBITORS_TOKEN)。');
    if (res.status === 400) console.error(`   イベントの slug を確認してください (いまは "${EVENT_SLUG}")。`);
    process.exit(1);
  }
  json = await res.json();
} catch (e) {
  console.error(`!! ポータルに接続できませんでした: ${e.message}`);
  process.exit(1);
}

const vendors = Array.isArray(json?.vendors) ? json.vendors : [];
const showUpdating = json?.notices?.updating === true;
console.log(`==> ${EVENT_SLUG}: 公開中 ${vendors.length} 店舗を取得しました / 順次更新中の表示: ${showUpdating ? 'あり' : 'なし'}`);

// --- 「順次更新中」の注記を各一覧に反映 (店舗の増減とは独立に毎回そろえる) ------------------
const UPDATING_NOTICE =
  '<p class="oimo-updating"><span class="oimo-updating__dot" aria-hidden="true"></span>出店店舗は順次更新中です</p>';
let indexHtml = await readFile(INDEX, 'utf8');
let noticeChanged = false;
for (const groupId of new Set(Object.values(AREA_GROUPS))) {
  const re = new RegExp(`(<!-- SHOPS:UPDATING ${groupId}[^>]*-->)[\\s\\S]*?(<!-- /SHOPS:UPDATING -->)`);
  const m = re.exec(indexHtml);
  if (!m) continue;
  const next = showUpdating ? `${m[1]}\n    ${UPDATING_NOTICE}\n    ${m[2]}` : `${m[1]}\n    ${m[2]}`;
  if (next !== m[0]) {
    indexHtml = indexHtml.slice(0, m.index) + next + indexHtml.slice(m.index + m[0].length);
    noticeChanged = true;
  }
}
if (noticeChanged) {
  await writeFile(INDEX, indexHtml);
  console.log(`    - 「順次更新中」の表示を${showUpdating ? '出しました' : '消しました'}`);
}

// --- 2. エリアごとに振り分け -----------------------------------------------
const byGroup = new Map();
for (const v of vendors) {
  const groupId = AREA_GROUPS[String(v.category ?? '').trim()];
  if (!groupId) {
    console.log(`    - ${v.shopName}: 出店エリア「${v.category}」はトップページに一覧が無いため載せません`);
    continue;
  }
  if (!byGroup.has(groupId)) byGroup.set(groupId, []);
  byGroup.get(groupId).push(v);
}

if (byGroup.size === 0) {
  console.log('==> トップページに載せる店舗が無いため、前回開催の一覧をそのまま残します');
  process.exit(0); // 注記の変更は上で書き込み済み
}

// --- 3. 画像を保存 -----------------------------------------------------------
const imageDirAbs = path.join(OUT_DIR, IMAGE_DIR_REL);
await mkdir(imageDirAbs, { recursive: true });
const keepFiles = new Set();

async function saveImage(v) {
  if (!v.imageUrl) return null;
  let res;
  try {
    res = await fetch(v.imageUrl);
  } catch (e) {
    console.error(`    !! ${v.shopName}: 画像を取得できませんでした (${e.message})`);
    return null;
  }
  if (!res.ok) {
    console.error(`    !! ${v.shopName}: 画像を取得できませんでした (HTTP ${res.status})`);
    return null;
  }
  const ext = extensionFor(v.imageUrl, res.headers.get('content-type'));
  const file = `${v.applicationId}${ext}`;
  keepFiles.add(file);
  // 既にある画像は使い回す (軽量化済みのものを毎回ダウンロードし直して差分を出さない)。
  // 写真を差し替えたときはポータル側で公開 URL (ファイル名) が変わるので、別名で保存される。
  const existing = await readdir(imageDirAbs).catch(() => []);
  const wanted = `${v.applicationId}-${imageFingerprint(v.imageUrl)}${ext}`;
  keepFiles.delete(file);
  keepFiles.add(wanted);
  if (existing.includes(wanted)) return `${IMAGE_DIR_REL}/${wanted}`;
  await writeFile(path.join(imageDirAbs, wanted), Buffer.from(await res.arrayBuffer()));
  return `${IMAGE_DIR_REL}/${wanted}`;
}

// --- 4. data/shops.json を置き換え ------------------------------------------
const data = JSON.parse(await readFile(DATA_PATH, 'utf8'));
const syncedAt = new Date().toISOString();
const replacedGroups = [];

for (const [groupId, list] of byGroup) {
  const group = data.groups.find((g) => g.id === groupId);
  if (!group) {
    console.error(`!! data/shops.json にグループ "${groupId}" がありません`);
    process.exit(1);
  }
  list.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || String(a.shopName).localeCompare(String(b.shopName), 'ja'));
  const shops = [];
  for (const v of list) {
    const image = await saveImage(v);
    if (!image) continue; // 画像の無い店舗はカードにできないので載せない
    const shop = { name: String(v.shopName ?? '').trim(), image };
    const area = shortPrefecture(v.prefecture);
    if (area) shop.area = area;
    const link = instagramUrl(v.instagram);
    if (link) shop.link = link;
    applyOverride(shop, data.overrides);
    // 正方形に切り抜くときの位置。書き方が想定どおりのときだけ持ち込む
    // (build-shops.mjs が style に入れるため。空なら custom.css の既定)
    const focus = String(v.imageFocus ?? '').trim();
    if (/^-?[\d.]+(%|px)( -?[\d.]+(%|px))?$/.test(focus)) shop.focus = focus;
    shops.push(shop);
  }
  if (shops.length === 0) {
    console.log(`    - ${group.title}: 画像付きの店舗が無いため、前回の一覧を残します`);
    continue;
  }
  applyOrder(shops, data.overrides, group.title);
  // 中身が前回と同じなら何も書かない (毎日の実行で syncedAt だけが変わってコミットされないように)
  if (
    group.portal?.event === EVENT_SLUG &&
    JSON.stringify(group.shops) === JSON.stringify(shops)
  ) {
    console.log(`    - ${group.title}: ${shops.length} 店舗 (前回と同じ)`);
    continue;
  }
  group.shops = shops; // 1 店舗でも新しい年度の公開があれば、前回開催の店舗はすべて消す
  group.portal = { event: EVENT_SLUG, syncedAt, count: shops.length };
  replacedGroups.push(group);
  console.log(`    - ${group.title}: ${shops.length} 店舗に置き換えました`);
}

// 参照されなくなった画像を消す (公開を取り消した店舗の画像が残らないように)
for (const f of await readdir(imageDirAbs)) {
  if (!keepFiles.has(f)) await unlink(path.join(imageDirAbs, f));
}

if (replacedGroups.length === 0) {
  console.log('==> 変更はありませんでした');
  process.exit(0);
}

data.note = '店舗一覧のデータ。scripts/build-shops.mjs がこれを読んで HTML を生成する。' +
  ' portal が付いたグループは scripts/fetch-hp-exhibitors.mjs がポータルの「HP掲載 出店者」から自動で置き換える (直接編集しない)。';
await writeFile(DATA_PATH, `${JSON.stringify(data, null, 2)}\n`);

// --- 5. 「近日公開」のお知らせを空にする ---------------------------------------
let html = await readFile(INDEX, 'utf8');
for (const group of replacedGroups) {
  const re = new RegExp(`(<!-- SHOPS:NOTICE ${group.id}[^>]*-->)[\\s\\S]*?(<!-- /SHOPS:NOTICE -->)`);
  const m = re.exec(html);
  if (!m) continue;
  const open = `<!-- SHOPS:NOTICE ${group.id} (ポータルから店舗一覧が届いたため scripts/fetch-hp-exhibitors.mjs が空にした) -->`;
  html = html.slice(0, m.index) + `${open}\n    ${m[2]}` + html.slice(m.index + m[0].length);
}
await writeFile(INDEX, html);

// --- 6. 画像を軽量化する (長辺 2000px・JPEG 品質 85。CLAUDE.md の運用ルール 9 と同じ) -----
// ポータルの写真は撮影データそのまま (数 MB) のことがあるため、公開前に必ず縮小する。
// Pillow が無い環境では警告だけ出して続ける (画像は大きいまま公開される)。
try {
  execFileSync('python3', ['scripts/optimize-images.py', '--dir', imageDirAbs], { stdio: 'inherit' });
} catch (e) {
  console.warn(`!! 画像の軽量化をスキップしました (${e.message.split('\n')[0]})。python3 と Pillow を用意してください`);
}

// --- 7. HTML を作り直す ------------------------------------------------------
execFileSync(process.execPath, ['scripts/build-shops.mjs'], { stdio: 'inherit' });
console.log(`==> 店舗一覧を更新しました (${replacedGroups.map((g) => g.title).join('・')})`);
