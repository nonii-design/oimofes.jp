#!/usr/bin/env node
// =============================================================================
// イベント管理ポータルから「HP掲載スケジュール」(表示期間) を取得して、
// トップページのブロックに反映するスクリプト (依存パッケージなし)
//
//   HP_DISPLAY_SLOTS_TOKEN=xxxx node scripts/fetch-display-slots.mjs
//
// やること:
//   ポータルの公開 API から表示期間を取得し、site/index.html の該当ブロックの
//   data-oimo-from / data-oimo-to / data-oimo-force を書き換える。
//   実際の出し分けは閲覧時に site/oimo-ui.js が行う。
//
// 環境変数:
//   HP_DISPLAY_SLOTS_TOKEN  ポータルの公開 API のトークン (必須)
//   HP_PORTAL_URL           ポータルの URL   (既定: https://event-portal.nonii.co.jp)
//   OIMO_EVENT_SLUG         イベントの slug  (既定: oimo-fes-fujicity-2026)
//   OUT_DIR                 サイトのディレクトリ (既定: site)
//
// トークンが無い場合は何もせず正常終了する
// (HTML に書かれている日付がそのまま使われる = 手で設定した状態が残る)。
//
// 対応する API: GET /api/public/hp-display-slots?event=<slug>
//   → { event, generatedAt, slots: [{ slotKey, startsAt, endsAt, forceState }] }
// =============================================================================
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const TOKEN = process.env.HP_DISPLAY_SLOTS_TOKEN || '';
const PORTAL = (process.env.HP_PORTAL_URL || 'https://event-portal.nonii.co.jp').replace(/\/$/, '');
const EVENT_SLUG = process.env.OIMO_EVENT_SLUG || 'oimo-fes-fujicity-2026';
const OUT_DIR = process.env.OUT_DIR || 'site';

const INDEX = path.join(OUT_DIR, 'index.html');

// ポータルの slot_key と、トップページのブロック (id) の対応表。
// 表示期間をポータルから操作したいブロックを増やすときは、ここに 1 行足す。
// slot_key はポータル側 (event_hp_display_slots.slot_key) と同じ文字列にすること。
const SLOTS = [
  { slotKey: 'entry.recruit', id: 'entry', label: '出店者募集' },
];

// 日本に夏時間は無いので固定オフセットで扱う (ポータル・HP と同じ考え方)
const JST_OFFSET = 9 * 60 * 60 * 1000;

const DAY = 24 * 60 * 60 * 1000;

/** JST の 0:00 ちょうどか */
const isJstMidnight = (ms) => (ms + JST_OFFSET) % DAY === 0;

/** その時刻を含む JST の日付 (YYYY-MM-DD) */
const jstDate = (ms) => new Date(ms + JST_OFFSET).toISOString().slice(0, 10);

/**
 * ポータルの時刻を data-oimo-from / data-oimo-to の値に変換する。
 * JST の 0:00 ちょうどなら読みやすい「YYYY-MM-DD」に、
 * 途中の時刻ならその時刻のまま書き出して、切り替えの瞬間がずれないようにする。
 *
 * ポータルの ends_at は「その時刻から非表示」(未満) なので、
 * 0:00 のときは前日が最後の表示日になる。
 */
function toAttr(iso, kind) {
  if (!iso) return '';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  if (isJstMidnight(ms)) return jstDate(kind === 'to' ? ms - DAY : ms);
  // 例: 2026-01-31T18:00:00+09:00
  return new Date(ms + JST_OFFSET).toISOString().replace(/\.000Z$/, '').replace('Z', '') + '+09:00';
}

if (!TOKEN) {
  console.log('==> HP_DISPLAY_SLOTS_TOKEN が設定されていないため、表示期間の更新をスキップしました。');
  console.log('    (HTML に書かれている日付がそのまま使われます)');
  process.exit(0);
}

// --- 1. ポータルから取得 ---------------------------------------------------
const api = `${PORTAL}/api/public/hp-display-slots?event=${encodeURIComponent(EVENT_SLUG)}`;
let json;
try {
  const res = await fetch(api, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!res.ok) {
    console.error(`!! ポータルから取得できませんでした: HTTP ${res.status}`);
    if (res.status === 401) console.error('   トークンが違う可能性があります (HP_DISPLAY_SLOTS_TOKEN)。');
    if (res.status === 400) console.error(`   イベントの slug を確認してください (いまは "${EVENT_SLUG}")。`);
    process.exit(1);
  }
  json = await res.json();
} catch (e) {
  console.error(`!! ポータルに接続できませんでした: ${e.message}`);
  process.exit(1);
}

const slots = Array.isArray(json?.slots) ? json.slots : [];
console.log(`==> ${EVENT_SLUG}: ${slots.length} 件の掲載スケジュールを取得しました`);

// --- 2. HTML に反映 --------------------------------------------------------
let html = await readFile(INDEX, 'utf8');
let changed = 0;

for (const target of SLOTS) {
  const slot = slots.find((s) => s?.slotKey === target.slotKey);
  if (!slot) {
    console.log(`    - ${target.label} (${target.slotKey}): ポータルに設定がないため、そのままにします`);
    continue;
  }

  const from = toAttr(slot.startsAt, 'from');
  const to = toAttr(slot.endsAt, 'to');
  // auto: 期間で判定 / force_on: 常に表示 / force_off: 即時終了 (完売時など)
  const force = slot.forceState === 'force_on' ? 'on' : slot.forceState === 'force_off' ? 'off' : '';

  // 対象ブロックの開始タグだけを書き換える
  const tagRe = new RegExp(`<section\\b[^>]*\\bid="${target.id}"[^>]*>`);
  const tag = tagRe.exec(html);
  if (!tag) {
    console.error(`!! ${INDEX} に id="${target.id}" のセクションが見つかりません`);
    process.exit(1);
  }

  let next = tag[0]
    .replace(/\s*data-oimo-from="[^"]*"/, '')
    .replace(/\s*data-oimo-to="[^"]*"/, '')
    .replace(/\s*data-oimo-force="[^"]*"/, '')
    .replace(/>$/, ` data-oimo-from="${from}" data-oimo-to="${to}"${force ? ` data-oimo-force="${force}"` : ''}>`);

  if (next !== tag[0]) {
    html = html.slice(0, tag.index) + next + html.slice(tag.index + tag[0].length);
    changed++;
  }
  const period = from || to ? `${from || '(制限なし)'} 〜 ${to || '(制限なし)'}` : '(制限なし)';
  console.log(`    - ${target.label} (${target.slotKey}): ${period}${force ? ` / 手動: ${force}` : ''}`);
}

if (changed) {
  await writeFile(INDEX, html);
  console.log(`==> ${INDEX} を更新しました (${changed} ブロック)`);
} else {
  console.log('==> 変更はありませんでした');
}
