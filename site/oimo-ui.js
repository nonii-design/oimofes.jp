/* ===========================================================================
   oimo-ui.js — 全ページ共通の UI の挙動
   1. スクロールしたらナビゲーションを画面上部に固定 (半透明・ぼかし)
   2. 画面に入ったブロックをふわりと表示 (IntersectionObserver)
   3. トップページでは今見ているセクションのメニューに下線を付ける
   4. ページ間の遷移 (View Transitions) と「ちらつき防止」の連携
   見た目は custom.css の「B: 書体の統一・余白/角丸/影・モーション」で定義。
   動きを減らす設定 (prefers-reduced-motion) の利用者には 2 を適用しない。
   =========================================================================== */
(function () {
  'use strict';

  var html = document.documentElement;
  html.classList.add('oimo-js');

  var reduceMotion = window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* --- 1. ナビゲーションの固定表示 --------------------------------------- */
  var navOuter = document.querySelector('.h-navigation_outer');
  var header = document.querySelector('.page-header');

  if (navOuter && header) {
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
    var columns = Array.prototype.slice.call(
      document.querySelectorAll('#colibri .h-section:not(.h-navigation) .h-row > .h-column')
    ).filter(function (col) {
      if (col.closest('#hero')) return false;                       // ヒーローは独自の動き
      if (col.parentElement.closest('.h-column')) return false;      // 入れ子の内側は親に任せる
      if (col.querySelector('.oimo-info, .oimo-ig')) return false;   // 独自の動きを持つブロック
      return true;
    });

    columns.forEach(function (col) {
      var siblings = Array.prototype.filter.call(col.parentElement.children, function (el) {
        return el.classList.contains('h-column');
      });
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
  Array.prototype.forEach.call(document.querySelectorAll('ul.colibri-menu'), function (ul) {
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
