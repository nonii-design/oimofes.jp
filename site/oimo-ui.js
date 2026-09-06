/* ===========================================================================
   oimo-ui.js — 全ページ共通の UI の挙動
   1. スクロールしたらナビゲーションを画面上部に固定 (半透明・ぼかし)
   2. 画面に入ったブロックをふわりと表示 (IntersectionObserver)
   3. トップページでは今見ているセクションのメニューに下線を付ける
   4. ページ間の遷移 (View Transitions) と「ちらつき防止」の連携
   5. 表示期間を決めたブロック (data-oimo-from / data-oimo-to) の出し分け
   見た目は custom.css の「B: 書体の統一・余白/角丸/影・モーション」で定義。
   動きを減らす設定 (prefers-reduced-motion) の利用者には 2 を適用しない。
   =========================================================================== */
(function () {
  'use strict';

  var html = document.documentElement;
  html.classList.add('oimo-js');

  /* --- 5. 表示期間 -------------------------------------------------------
     data-oimo-from="2026-01-20" data-oimo-to="2026-01-31" を書いた要素は
     その期間だけ表示する (from は当日の 0:00 から、to は当日の終わりまで)。
     時刻まで指定したいときは "2026-01-31T18:00:00" の形も使える (この時刻まで)。
     どちらも空 (または未指定) なら常に表示する。
     data-oimo-force="on" は常に表示、"off" は常に非表示 (完売時などの手動スイッチ)。

     日付は日本時間で判定する。海外や時計がずれた端末でも同じ表示になるようにするため、
     端末のタイムゾーンは使わない。日本に夏時間は無いので固定オフセットでよい。
     値は scripts/fetch-display-slots.mjs がイベント管理ポータルから取り込む。
     JavaScript が動かない環境では、そのまま表示されたままになる。 */
  var JST = '+09:00';
  var now = Date.now();

  /** "YYYY-MM-DD" または "YYYY-MM-DDTHH:MM:SS" を日本時間として解釈する */
  var parseJst = function (value, endOfDay) {
    var v = (value || '').trim();
    if (!v) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      v += endOfDay ? 'T23:59:59.999' : 'T00:00:00';
    }
    // 末尾にオフセットが無ければ日本時間として読む
    var ms = Date.parse(/(?:Z|[+-]\d{2}:\d{2})$/.test(v) ? v : v + JST);
    return isNaN(ms) ? null : ms;
  };

  Array.prototype.forEach.call(document.querySelectorAll('[data-oimo-from], [data-oimo-to], [data-oimo-force]'), function (el) {
    var force = (el.getAttribute('data-oimo-force') || '').trim();
    var from = parseJst(el.getAttribute('data-oimo-from'), false);
    var to = parseJst(el.getAttribute('data-oimo-to'), true);

    if (force === 'off' || (force !== 'on' && ((from && now < from) || (to && now > to)))) {
      el.hidden = true;
      return;
    }
    el.hidden = false;

    // 受付期間を書く場所があれば、日付を「1月20日（火）〜1月31日（土）」の形で入れる
    var slot = el.querySelector('.oimo-entry__dates');
    if (slot && from && to) {
      var week = ['日', '月', '火', '水', '木', '金', '土'];
      var label = function (ms) {
        // 日本時間の日付として組み立てる
        var d = new Date(ms + 9 * 60 * 60 * 1000);
        return (d.getUTCMonth() + 1) + '月' + d.getUTCDate() + '日（' + week[d.getUTCDay()] + '）';
      };
      slot.textContent = label(from) + '〜' + label(to);
      var line = slot.closest('.oimo-entry__period');
      if (line) line.hidden = false;
    }
  });

  var reduceMotion = window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* --- 1. ナビゲーションの固定表示 --------------------------------------- */
  // 共通ヘッダー (.oimo-header) か、Colibri 製ページのナビ (.h-navigation_outer)
  var navOuter = document.querySelector('.oimo-header, .h-navigation_outer');

  if (navOuter) {
    var navBottom = 0;
    var stuck = false;
    var ticking = false;

    var update = function () {
      ticking = false;
      // ナビが画面の上に隠れてから少し進んだところで固定表示に切り替える
      var shouldStick = window.scrollY > navBottom + 80;
      if (shouldStick !== stuck) {
        stuck = shouldStick;
        html.classList.toggle('oimo-nav-stuck', stuck);
      }
    };

    var onScroll = function () {
      if (!ticking) {
        ticking = true;
        window.requestAnimationFrame(update);
      }
    };

    var measure = function () {
      // 固定中は流れから外れているので、いったん外して本来の位置と高さを測る
      var wasStuck = stuck;
      if (wasStuck) html.classList.remove('oimo-nav-stuck');
      var rect = navOuter.getBoundingClientRect();
      navBottom = rect.top + window.scrollY + rect.height;
      html.style.setProperty('--oimo-nav-h', Math.round(rect.height) + 'px');
      if (wasStuck) html.classList.add('oimo-nav-stuck');
      update();
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', measure);
    window.addEventListener('load', measure);
    measure();
  }

  /* --- 2. スクロールに合わせた表示 --------------------------------------- */
  if (!reduceMotion && 'IntersectionObserver' in window) {
    // 対象: Colibri 製ページの列 (.h-column) と、data-reveal を付けた要素
    var isTarget = function (el) {
      return el.classList.contains('h-column') || el.hasAttribute('data-reveal');
    };
    var columns = Array.prototype.slice.call(
      document.querySelectorAll('#colibri .h-section:not(.h-navigation) .h-row > .h-column, [data-reveal]')
    ).filter(function (col) {
      if (col.closest('#hero')) return false;                       // ヒーローは独自の動き
      if (col.parentElement.closest('.h-column')) return false;      // 入れ子の内側は親に任せる
      if (col.querySelector('.oimo-info, .oimo-ig')) return false;   // 独自の動きを持つブロック
      return true;
    });

    columns.forEach(function (col) {
      var siblings = Array.prototype.filter.call(col.parentElement.children, isTarget);
      var index = Math.min(siblings.indexOf(col), 5);
      col.style.setProperty('--oimo-reveal-delay', (index * 80) + 'ms');
      col.classList.add('oimo-reveal');
    });

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          observer.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0 });

    columns.forEach(function (col) { observer.observe(col); });

    // 万一のとき (印刷など) に内容が隠れたままにならないよう、時間で全部出す
    window.setTimeout(function () {
      columns.forEach(function (col) { col.classList.add('is-in'); });
    }, 6000);
  }

  /* --- 3. 現在地のメニューに下線 ---------------------------------------- */
  var links = [];
  Array.prototype.forEach.call(document.querySelectorAll('ul.colibri-menu, .oimo-nav__list'), function (ul) {
    Array.prototype.forEach.call(ul.children, function (li) {
      var a = li.querySelector(':scope > a');
      var m = a && /#([\w-]+)$/.exec(a.getAttribute('href') || '');
      var target = m && document.getElementById(m[1]);
      if (target) links.push({ li: li, ul: ul, target: target });
    });
  });

  if (links.length) {
    var targets = [];
    links.forEach(function (l) { if (targets.indexOf(l.target) < 0) targets.push(l.target); });
    var current = null;
    var pending = false;

    var pick = function () {
      pending = false;
      var line = window.innerHeight * 0.35;
      var best = null;
      targets.forEach(function (t) {
        var r = t.getBoundingClientRect();
        if (r.top <= line && r.bottom > line) best = t;
      });
      if (best === current) return;
      current = best;
      links.forEach(function (l) {
        l.li.classList.toggle('oimo-active', !!best && l.target === best);
        l.ul.classList.toggle('oimo-nav-tracking', !!best);
      });
    };

    var onScrollPick = function () {
      if (!pending) {
        pending = true;
        window.requestAnimationFrame(pick);
      }
    };

    window.addEventListener('scroll', onScrollPick, { passive: true });
    window.addEventListener('resize', onScrollPick);
    pick();
  }

  /* --- 3b. 共通ヘッダーのモバイルメニュー --------------------------------- */
  var toggle = document.querySelector('.oimo-header__toggle');
  if (toggle) {
    var overlay = document.querySelector('.oimo-nav__overlay');
    var setOpen = function (open) {
      html.classList.toggle('oimo-nav-open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.setAttribute('aria-label', open ? 'メニューを閉じる' : 'メニューを開く');
    };
    toggle.addEventListener('click', function () {
      setOpen(!html.classList.contains('oimo-nav-open'));
    });
    if (overlay) overlay.addEventListener('click', function () { setOpen(false); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') setOpen(false);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.oimo-nav a'), function (a) {
      a.addEventListener('click', function () { setOpen(false); });
    });
    if (window.matchMedia) {
      var wide = window.matchMedia('(min-width: 992px)');
      var onWide = function (e) { if (e.matches) setOpen(false); };
      if (wide.addEventListener) wide.addEventListener('change', onWide);
      else if (wide.addListener) wide.addListener(onWide);
    }
  }

  /* --- 4. ページ間の遷移 ------------------------------------------------- */
  // View Transitions で前のページから滑らかに切り替わるときは、
  // 「ちらつき防止」の黄色い下地を待たずにそのまま表示する
  window.addEventListener('pagereveal', function (e) {
    if (e.viewTransition) {
      html.classList.remove('oimo-loading');
      html.classList.add('oimo-ready');
    }
  });
})();
