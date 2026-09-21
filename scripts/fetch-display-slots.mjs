#!/usr/bin/env node
// =============================================================================
// イベント管理ポータルから「HP掲載スケジュール」(表示期間) を取得して、
// トップページのブロックに反映するスクリプト (依存パッケージなし)
//
//   HP_DISPLAY_SLOTS_TOKEN=xxxx node scripts/fetch-display-slots.mjs
//
// やること (枠ごとに 2 通り):
//   attrs … 既にある要素の data-oimo-from / data-oimo-to / data-oimo-force
//           だけを書き換える。中身は HTML 側に置いたまま。
//   block … <!-- SLOT:START <slot_key> --> 〜 <!-- SLOT:END --> の間を、
//           ポータルの content (見出し・文章・ボタン) から丸ごと生成する。
//   どちらも実際の出し分けは閲覧時に site/oimo-ui.js が行う。
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
//   → { event, generatedAt, slots: [{ slotKey, startsAt, endsAt, forceState, content }] }
//   content は { title, period, body, items: [{ label, href, note }] } (すべて任意)
// =============================================================================
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const TOKEN = process.env.HP_DISPLAY_SLOTS_TOKEN || '';
const PORTAL = (process.env.HP_PORTAL_URL || 'https://event-portal.nonii.co.jp').replace(/\/$/, '');
const EVENT_SLUG = process.env.OIMO_EVENT_SLUG || 'oimo-fes-fujicity-2026';
const OUT_DIR = process.env.OUT_DIR || 'site';

const INDEX = path.join(OUT_DIR, 'index.html');

// ポータルの slot_key と、トップページのブロックの対応表。
// ポータルから操作したいブロックを増やすときは、ここに 1 行足す。
// slot_key はポータル側 (event_hp_display_slots.slot_key) と同じ文字列にすること
// (ポータル側は src/lib/hp-display-slots.ts の DEFAULT_SLOTS で行を作る)。
//
//   id     … その id を持つ要素の開始タグに期間の属性だけを書く
//   marker … <!-- SLOT:START <slot_key> --> 〜 <!-- SLOT:END --> の中を
//            render(content, attrs) が返す HTML で置き換える
//
// entry.recruit はポータル側に既にある行。ボタンの中身を出店者募集から
// ボランティア募集に差し替えたが、slot_key を変えると行を作り直すことになるため、
// 「ヒーローの募集ボタンの表示期間」という枠として流用している。
const SLOTS = [
  { slotKey: 'entry.recruit', id: 'volunteer', label: 'ボランティア募集ボタン' },
  { slotKey: 'ticket.button', marker: true, label: '入場チケットボタン', render: renderTicketButton },
  { slotKey: 'notice.top', marker: true, label: 'トップのお知らせ', render: renderNotice },
];

/** HTML に埋め込んでよい形にする */
const esc = (v) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** リンク先は http(s) だけ通す (javascript: などを書かれても踏まないように) */
function safeHref(v) {
  const s = String(v ?? '').trim();
  if (!/^https?:\/\//i.test(s)) return '';
  return esc(s);
}

/** 改行を <br> にする (ポータルの文章は複数行で入力される) */
const nl2br = (v) =>
  esc(v)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('<br>');

const TICKET_ICON =
  '<svg class="oimo-icon oimo-icon--btn" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1792 1896.0833"><path d="M1024 452l316 316-572 572-316-316zm-211 979l618-618q19-19 19-45t-19-45l-362-362q-18-18-45-18t-45 18L361 979q-19 19-19 45t19 45l362 362q18 18 45 18t45-18zm889-637l-907 908q-37 37-90.5 37t-90.5-37l-126-126q56-56 56-136t-56-136-136-56-136 56L91 1178q-37-37-37-90.5T91 997L998 91q37-37 90.5-37t90.5 37l125 125q-56 56-56 136t56 136 136 56 136-56l126 125q37 37 37 90.5t-37 90.5z"></path></svg>';

/**
 * 入場チケットのボタン。ヒーローの 3 つ目のボタンを作る。
 * content.items[0] の label / href を使う。href が無ければ押せない表示にする。
 */
function renderTicketButton(content, attrs) {
  const item = (content.items || [])[0] || {};
  const label = esc(item.label || content.title || '入場チケット');
  const href = safeHref(item.href);
  if (!href) {
    return `        <span class="h-button is-disabled" aria-disabled="true"${attrs}>\n` +
      `          <span>${label}</span>${TICKET_ICON}\n        </span>`;
  }
  return `        <a class="h-button" href="${href}" target="_blank" rel="noopener"${attrs}>\n` +
    `          <span>${label}</span>${TICKET_ICON}\n        </a>`;
}

/**
 * トップページのお知らせ。content.title / content.body を使う。
 * どちらも空なら何も書かない (ブロックごと消える)。
 */
function renderNotice(content, attrs) {
  const title = esc(content.title || '');
  const body = nl2br(content.body || '');
  if (!title && !body) return '';
  const inner = [
    title ? `      <p class="oimo-notice__title">${title}</p>` : '',
    body ? `      <p class="oimo-notice__body">${body}</p>` : '',
  ].filter(Boolean).join('\n');
  return `<section class="oimo-section oimo-section--tight oimo-notice-section" id="notice"${attrs}>\n` +
    `  <div class="oimo-section__inner oimo-section__inner--narrow">\n` +
    `    <div class="oimo-notice">\n${inner}\n    </div>\n  </div>\n</section>`;
}

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
  const attrs = ` data-oimo-from="${from}" data-oimo-to="${to}"${force ? ` data-oimo-force="${force}"` : ''}`;

  if (target.marker) {
    // ブロックごと作り直す
    const re = new RegExp(`(<!-- SLOT:START ${target.slotKey}[^>]*-->)([\\s\\S]*?)(<!-- SLOT:END -->)`);
    const m = re.exec(html);
    if (!m) {
      console.error(`!! ${INDEX} に <!-- SLOT:START ${target.slotKey} --> が見つかりません`);
      process.exit(1);
    }
    const body = target.render(slot.content || {}, attrs);
    const open = `<!-- SLOT:START ${target.slotKey} (ポータルの「HP掲載スケジュール」から scripts/fetch-display-slots.mjs が生成。直接編集しない) -->`;
    const next = body ? `${open}\n${body}\n<!-- SLOT:END -->` : `${open}\n<!-- SLOT:END -->`;
    if (next !== m[0]) {
      html = html.slice(0, m.index) + next + html.slice(m.index + m[0].length);
      changed++;
    }
  } else {
    // 既にある要素の開始タグだけを書き換える (section / a / div など要素は問わない)
    const tagRe = new RegExp(`<[a-z]+\\b[^>]*\\bid="${target.id}"[^>]*>`);
    const tag = tagRe.exec(html);
    if (!tag) {
      console.error(`!! ${INDEX} に id="${target.id}" の要素が見つかりません`);
      process.exit(1);
    }
    const next = tag[0]
      .replace(/\s*data-oimo-from="[^"]*"/, '')
      .replace(/\s*data-oimo-to="[^"]*"/, '')
      .replace(/\s*data-oimo-force="[^"]*"/, '')
      .replace(/>$/, `${attrs}>`);
    if (next !== tag[0]) {
      html = html.slice(0, tag.index) + next + html.slice(tag.index + tag[0].length);
      changed++;
    }
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
