/* アクセス解析 (Google アナリティクス 4)
   全ページのヘッダー (partials/header.html) から読み込む。

   - 測定 ID は下の GA_ID の 1 か所だけ。GA4 の「管理 → データストリーム → ウェブ」に出る
     G- で始まる番号を入れる。空のあいだは何も読み込まず、何も送らない。
   - ローカルでの確認 (localhost) では送らない (自分の確認でアクセス数が増えないように)。
   - ページの閲覧・スクロール・外部リンク・PDF のダウンロードは、GA4 の
     「拡張計測機能」が自動で数える。ここではそれ以外に、運営が知りたい操作を数える:
       ticket_click      … 入場チケット (ticketto.jp) へのリンクを押した
       layout_fullscreen … 会場レイアウトを全画面で開いた
       venue_switch      … ヘッダーの会場セレクタで会場を切り替えた (venue = fujicity / shizuoka)
       contact_submit    … お問い合わせフォームの送信が完了した (contact-form.js が知らせる)
     ticket_click は GA4 の「キーイベント」に登録すると、チケットへの誘導数として見られる。 */
(function () {
  'use strict';

  var GA_ID = '';

  if (!/^G-[A-Z0-9]+$/.test(GA_ID)) return;
  if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname)) return;

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;
  gtag('js', new Date());
  gtag('config', GA_ID);

  var tag = document.createElement('script');
  tag.async = true;
  tag.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
  document.head.appendChild(tag);

  var send = function (name, params) { gtag('event', name, params || {}); };

  // 押された要素から、数えたい操作を見分ける (ボタンの中のアイコンを押しても拾えるよう closest で辿る)
  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('a, button') : null;
    if (!el) return;
    var href = el.getAttribute('href') || '';
    if (/(^|\/\/)(www\.)?ticketto\.jp\//.test(href)) {
      send('ticket_click', { link_url: el.href, link_text: (el.textContent || '').trim().slice(0, 40) });
    } else if (el.hasAttribute('data-oimo-layout-open')) {
      send('layout_fullscreen');
    } else if (el.hasAttribute('data-oimo-edition-tab')) {
      send('venue_switch', { venue: el.getAttribute('data-oimo-edition-tab') });
    }
  }, true);

  document.addEventListener('oimo:contact-sent', function () { send('contact_submit'); });
})();
