#!/usr/bin/env node
// =============================================================================
// スマホ表示で大きすぎる見出しに上限を付けるスクリプト (依存パッケージなし)
//
//   node scripts/cap-mobile-headings.mjs
//
// なぜ必要か:
//   Colibri はページごとの見出しの大きさを各 HTML の <head> のインライン CSS に
//   「#colibri .style-950 h1 { font-size: 2rem }」のような形で書き出すが、
//   **画面幅を見ていない** ため、パソコンで整う大きさがそのままスマホにも出る。
//   幅 390px の画面に 32px や 42px の見出しが並び、見出し 1 つが 4 行に折り返す。
//
// やること:
//   見出しを対象にした指定のうち、下の CAP より大きいものだけに、上限付きの指定を
//   **その直後に** 書き足す。
//
//     #colibri .a h1,#colibri .a h3 { font-size: 2rem }
//       ↓
//     #colibri .a h1,#colibri .a h3 { font-size: 2rem }
//     #colibri .a h1 { font-size: clamp(26px, 6.9vw, 2rem) }
//     #colibri .a h3 { font-size: clamp(21px, 5.6vw, 2rem) }
//
//   clamp の下限が狭い画面での大きさ、上限が元の大きさ。375px で下限に触れ、幅が
//   広がると元の大きさに戻るので、**パソコン表示は 1px も変わらない**。
//
//   「直後に」置くのが要点。まとめてファイルの末尾に足すと、詳細度が同じで後ろに
//   あるルールにまで勝ってしまい、もともとそちらが効いていた見出しが逆に大きくなる
//   (実際に 25 件そうなった)。直後なら前後関係が元のままなので勝ち負けも変わらない。
//
//   1 つのルールが h1〜h6 をまとめて指定していることが多いので、見出しレベルごとに
//   分けて書き出す。こうすると、ページの見出し (h1) と節の見出し (h3) の大小関係が
//   スマホでも保たれる。
//
// 触らないもの:
//   - CAP 以下の指定 (店舗名など、もともと小さい見出し)。**縮めるだけで拡げない**
//   - px / em / rem 以外の単位
//   - テーマ既定の body h1 / h2 / h3 (これは site/custom.css で上限を付けている)
//
// 何度実行してもよい (前回書き足したぶんは目印で見分けて外してから作り直すので、
// CAP を変えたときもそのまま実行すれば反映される)。
// =============================================================================
import { readFile, writeFile, glob } from 'node:fs/promises';

// 画面幅 390px あたりでの上限 (px)
const CAP = { h1: 26, h2: 23, h3: 21, h4: 20, h5: 19, h6: 18 };
// 上限に触れる幅を 375px (いちばん狭い端末) に合わせる
const vwFor = (cap) => (cap / 3.75).toFixed(1);

/** 書き足したぶんの目印。作り直すときはここを外してから */
const MARK = 'oimo-cap';
const MARK_RE = new RegExp(`/\\*${MARK}\\*/[\\s\\S]*?/\\*/${MARK}\\*/`, 'g');

/** font-size の値を px 換算する。px / em / rem 以外は null (触らない) */
function toPx(value) {
  const m = /^([\d.]+)\s*(px|em|rem)$/.exec(value.trim());
  if (!m) return null;
  return m[2] === 'px' ? Number(m[1]) : Number(m[1]) * 16;
}

/**
 * <style> の中身を受け取り、大きすぎる見出しの指定の直後に上限付きの指定を足して返す。
 * @media の中のルール (Colibri が画面幅別に書いているもの) には入らない。
 */
function capHeadings(css, stats) {
  css = css.replace(MARK_RE, '');   // 前回ぶんを外してから作り直す
  let out = '';
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) { out += css.slice(i); break; }
    const sel = css.slice(i, open);

    if (sel.trimStart().startsWith('@')) {
      // @media / @supports などは中身ごとそのまま通す
      let depth = 0;
      let j = open;
      for (; j < css.length; j++) {
        if (css[j] === '{') depth++;
        else if (css[j] === '}' && --depth === 0) break;
      }
      out += css.slice(i, j + 1);
      i = j + 1;
      continue;
    }

    const close = css.indexOf('}', open);
    if (close < 0) { out += css.slice(i); break; }
    const body = css.slice(open + 1, close);
    out += sel + '{' + body + '}' + overridesFor(sel, body, stats);
    i = close + 1;
  }
  return out;
}

/** 1 ルールぶんを見て、直後に足す上限付きの指定を返す (要らなければ '') */
function overridesFor(sel, body, stats) {
  const fm = /(?:^|;)\s*font-size\s*:\s*([^;!}]+?)\s*(!important)?\s*(?=;|$)/i.exec(body);
  if (!fm) return '';
  const value = fm[1].trim();
  const px = toPx(value);
  if (px === null) return '';

  // セレクタを , で分け、見出しを指しているものだけ見出しレベル別にまとめる
  const byTag = {};
  for (const part of sel.split(',')) {
    if (!/[.#[]/.test(part)) continue;          // テーマ既定 (body h1) は custom.css が持つ
    const m = /\bh([1-6])\b/i.exec(part);
    if (!m) continue;                            // p などの指定はそのまま
    (byTag['h' + m[1]] ||= []).push(part.trim().replace(/\s+/g, ' '));
  }

  const rules = [];
  for (const [tag, parts] of Object.entries(byTag).sort()) {
    if (px <= CAP[tag] + 0.5) continue;          // もともと小さい → 触らない
    const imp = fm[2] ? ' !important' : '';
    rules.push(`${parts.join(',')}{font-size:clamp(${CAP[tag]}px,${vwFor(CAP[tag])}vw,${value})${imp}}`);
    stats.capped++;
  }
  return rules.length ? `/*${MARK}*/${rules.join('')}/*/${MARK}*/` : '';
}

let files = 0;
let changed = 0;
const stats = { capped: 0 };
for await (const file of glob('site/**/*.html')) {
  files++;
  const original = await readFile(file, 'utf8');
  const html = original.replace(
    /(<style[^>]*>)([\s\S]*?)(<\/style>)/g,
    (all, open, css, close) => open + capHeadings(css, stats) + close,
  );
  if (html !== original) { await writeFile(file, html, 'utf8'); changed++; }
}
console.log(`==> ${files} ページを確認し、${changed} ページ / ${stats.capped} 件の指定に上限を付けました。`);
