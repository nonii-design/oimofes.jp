/* ===========================================================================
   oimo-ui.js — 全ページ共通の UI の挙動
   1. スクロールしたらナビゲーションを画面上部に固定 (半透明・ぼかし)
   2. 画面に入ったブロックをふわりと表示 (IntersectionObserver)
   3. トップページでは今見ているセクションのメニューに下線を付ける
   4. ページ間の遷移 (View Transitions) と「ちらつき防止」の連携
   5. 表示期間を決めたブロック (data-oimo-from / data-oimo-to) の出し分け
   6. 視差効果 (data-oimo-parallax を書いたレイヤーをスクロールに合わせて動かす)
   見た目は custom.css の「B: 書体の統一・余白/角丸/影・モーション」で定義。
   動きを減らす設定 (prefers-reduced-motion) の利用者には 2 と 6 を適用しない。
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
  });

  /* --- 6. 会場の切り替え (FUJICITY / SHIZUOKA) ----------------------------
     1 つのトップページで 2 会場を出し分ける。

       partials/header.html … ヘッダーの中の会場セレクタ
         <div data-oimo-editions data-oimo-switch="2026-10-26" hidden>
           <button data-oimo-edition-menu>   … 押すと一覧が開く
           <div data-oimo-edition-list hidden>
             <button data-oimo-edition-tab="fujicity">
       site/index.html    … 会場別の節をまとめた入れ物
         <div data-oimo-edition="fujicity">
         <div data-oimo-edition="shizuoka" data-oimo-edition-draft hidden>
         <div data-oimo-shared>               … 会場によらず共通の節。表示中の会場の
                                                data-oimo-shared-slot の後ろへ動かす

     どちらを出すかは次の順で決める。
       1. ?v=shizuoka のように URL で指定されていれば、それ (下書きは除く)
       2. 日付。data-oimo-switch の日 (日本時間 0:00) 以降なら後の会場
       3. それも無ければ最初の会場
     data-oimo-edition-draft が付いた会場は、中身が固まるまでの下書き。
     一覧に出さず、URL で指定されても選べない。**出すときはこの属性を外すだけ。**

     セレクタはヘッダー (全ページ共通) にあるが、会場別の中身が無いページでは
     何もせず hidden のままにする。出せる会場が 1 つのときも出さない。

     JavaScript が動かない環境では、HTML に hidden が書いてあるものだけが隠れ、
     先頭の会場がそのまま読める状態になる。

     変数名は ed… で始める。このファイルは全体が 1 つの関数なので、
     他の機能と同じ名前を使うと取り合いになる (CLAUDE.md の編集ルール 13)。 */
  var edBox = document.querySelector('[data-oimo-editions]');
  var edBlocks = Array.prototype.slice.call(document.querySelectorAll('[data-oimo-edition]'));

  if (edBox && edBlocks.length) {
    var edNameOf = function (el) { return el.getAttribute('data-oimo-edition'); };
    var edLive = edBlocks.filter(function (el) { return !el.hasAttribute('data-oimo-edition-draft'); });
    var edMenu = edBox.querySelector('[data-oimo-edition-menu]');
    var edList = edBox.querySelector('[data-oimo-edition-list]');
    var edNow = edBox.querySelector('[data-oimo-edition-now]');
    var edOpts = Array.prototype.slice.call(edBox.querySelectorAll('[data-oimo-edition-tab]'));

    var edPick = function () {
      if (edLive.length < 2) return edLive[0] || edBlocks[0];
      var asked = (/[?&]v=([\w-]+)/.exec(window.location.search) || [])[1];
      if (asked) {
        var hit = edLive.filter(function (el) { return edNameOf(el) === asked; })[0];
        if (hit) return hit;
      }
      var switchAt = parseJst(edBox.getAttribute('data-oimo-switch'), false);
      if (switchAt && now >= switchAt) return edLive[edLive.length - 1];
      return edLive[0];
    };

    /* メニューの #oimo などは、今出ている会場の節に向ける。
       会場ごとに節の id を分ける (#oimo / #oimo-shizuoka) ため、
       2 つ目以降の会場では末尾に会場名を足したほうを指す。 */
    var edFixLinks = function (name) {
      var suffix = (edLive[0] && edNameOf(edLive[0]) === name) ? '' : '-' + name;
      Array.prototype.forEach.call(document.querySelectorAll('a[href*="#"]'), function (a) {
        // 元の href は 1 度だけ控えておく (切り替えのたびに書き換わるため)
        if (!a.hasAttribute('data-oimo-href')) a.setAttribute('data-oimo-href', a.getAttribute('href'));
        var base = a.getAttribute('data-oimo-href');
        var parts = /^(.*?)#([\w-]+)$/.exec(base);
        if (!parts) return;
        var want = parts[2] + suffix;
        a.setAttribute('href', suffix && document.getElementById(want)
          ? parts[1] + '#' + want
          : base);
      });
    };

    var edOpen = function (on) {
      if (edList) edList.hidden = !on;
      if (edMenu) edMenu.setAttribute('aria-expanded', on ? 'true' : 'false');
    };

    /* 会場によらず共通の節 (Instagram / おいもでホッ) はページに 1 つだけ置き、
       いま出ている会場の data-oimo-shared-slot の後ろへ動かす。
       会場ごとに置く位置を変えられ (FUJICITY は体験エリアの後ろ)、
       INSTAGRAM の自動生成の目印も 1 組のまま済む。 */
    var edShared = document.querySelector('[data-oimo-shared]');
    var edPlaceShared = function (name) {
      if (!edShared) return;
      var block = edBlocks.filter(function (el) { return edNameOf(el) === name; })[0];
      var slot = block && block.querySelector('[data-oimo-shared-slot]');
      if (slot && slot.nextElementSibling !== edShared) {
        slot.parentNode.insertBefore(edShared, slot.nextSibling);
      }
    };

    var edShow = function (name, push) {
      edBlocks.forEach(function (el) { el.hidden = edNameOf(el) !== name; });
      edPlaceShared(name);
      edOpts.forEach(function (btn) {
        var on = btn.getAttribute('data-oimo-edition-tab') === name;
        btn.classList.toggle('is-on', on);
        btn.setAttribute('aria-current', on ? 'true' : 'false');
        if (on && edNow) {
          var label = btn.querySelector('.oimo-header__venue-opt-name');
          edNow.textContent = label ? label.textContent : name;
        }
      });
      edFixLinks(name);
      if (push && window.history && window.history.replaceState) {
        window.history.replaceState(null, '', window.location.pathname + '?v=' + name + window.location.hash);
      }
    };

    // 下書きの会場は一覧に出さない
    edOpts.forEach(function (btn) {
      var target = btn.getAttribute('data-oimo-edition-tab');
      var live = edLive.filter(function (el) { return edNameOf(el) === target; })[0];
      btn.hidden = !live;
      if (live) {
        btn.addEventListener('click', function () { edShow(target, true); edOpen(false); });
      }
    });

    if (edMenu) {
      edMenu.addEventListener('click', function (e) {
        e.stopPropagation();
        edOpen(edList && edList.hidden);
      });
      // 外を押す / Esc で閉じる
      document.addEventListener('click', function (e) {
        if (!edBox.contains(e.target)) edOpen(false);
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') edOpen(false);
      });
    }

    edBox.hidden = edLive.length < 2;
    edOpen(false);
    edShow(edNameOf(edPick()), false);
  }

  /* --- 7. 会場レイアウトの全画面表示 ------------------------------------
     トップの会場レイアウト (エリアマップ) を押すと、<dialog data-oimo-layout-viewer> を
     画面いっぱいに開く。使えるブラウザでは Fullscreen API で本当の全画面にする
     (iPhone の Safari は要素の全画面に対応していないので、画面いっぱいの表示まで)。

     中の画像は自由に拡大・縮小できる:
       スマホ … 2 本指のピンチで拡大・縮小、1 本指で移動、ダブルタップで拡大 / 全体
       パソコン … ホイール (トラックパッドのピンチ) で拡大・縮小、ドラッグで移動、クリックで拡大 / 全体
       「拡大」ボタン … 2.5 倍と全体を切り替え
     ブラウザのページ全体の拡大と取り合わないよう、画像の枠は touch-action: none にして
     指の動きをすべてここで受け取る。拡大は画像に transform を掛けるだけで、画像自体は
     2000px のものを読み込んであるので、5 倍ほどまでは文字がつぶれない。
     細かい文字は PDF のほうが鮮明なので、PDF へのリンクも置いている。
     変数名は lv… で始める (編集ルール 13)。 */
  var lvDialog = document.querySelector('[data-oimo-layout-viewer]');
  if (lvDialog) {
    var lvStage = lvDialog.querySelector('[data-oimo-viewer-stage]');
    var lvImg = lvStage && lvStage.querySelector('img');
    var lvZoomBtn = lvDialog.querySelector('[data-oimo-viewer-zoom]');
    var lvPdf = lvDialog.querySelector('a[href$=".pdf"]');

    // 拡大率と、全体表示の位置からのずれ (px)
    var lvS = 1, lvX = 0, lvY = 0;
    var lvMax = function () {
      // 画像の画素が足りる倍率の 1.5 倍まで (最低 3 倍)
      var w = lvImg.offsetWidth || 1;
      return Math.max(3, (lvImg.naturalWidth || 2000) / w * 1.5);
    };

    // はみ出した画像が画面の外へ逃げないようにそろえる
    var lvClamp = function () {
      var sw = lvStage.clientWidth, sh = lvStage.clientHeight;
      var left = lvImg.offsetLeft, top = lvImg.offsetTop;
      var w = lvImg.offsetWidth * lvS, h = lvImg.offsetHeight * lvS;
      if (w <= sw) lvX = (sw - w) / 2 - left;
      else lvX = Math.min(-left, Math.max(sw - w - left, lvX));
      if (h <= sh) lvY = (sh - h) / 2 - top;
      else lvY = Math.min(-top, Math.max(sh - h - top, lvY));
    };

    var lvApply = function (animate) {
      lvClamp();
      lvImg.style.transition = animate ? 'transform 220ms ease' : 'none';
      lvImg.style.transform = 'translate(' + lvX + 'px,' + lvY + 'px) scale(' + lvS + ')';
      var zoomed = lvS > 1.01;
      lvStage.classList.toggle('is-zoomed', zoomed);
      if (lvZoomBtn) {
        lvZoomBtn.setAttribute('aria-pressed', zoomed ? 'true' : 'false');
        lvZoomBtn.textContent = zoomed ? '全体' : '拡大';
      }
    };

    // 画面上の点 (cx, cy) の下にある画像の位置を動かさずに、倍率を s にする
    var lvZoomAt = function (s, cx, cy, animate) {
      var r = lvStage.getBoundingClientRect();
      var px = cx - r.left, py = cy - r.top;
      var u = (px - lvImg.offsetLeft - lvX) / lvS;
      var v = (py - lvImg.offsetTop - lvY) / lvS;
      lvS = Math.min(lvMax(), Math.max(1, s));
      lvX = px - lvImg.offsetLeft - lvS * u;
      lvY = py - lvImg.offsetTop - lvS * v;
      lvApply(animate);
    };

    var lvCenter = function () {
      var r = lvStage.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    };

    var lvToggle = function (cx, cy) {
      if (lvS > 1.01) { lvS = 1; lvX = 0; lvY = 0; lvApply(true); return; }
      var c = lvCenter();
      lvZoomAt(2.5, cx == null ? c.x : cx, cy == null ? c.y : cy, true);
    };

    var lvReset = function () { lvS = 1; lvX = 0; lvY = 0; lvApply(false); };

    // --- 指・マウスの動き (Pointer Events) ---
    var lvPts = {};          // 画面に触れている指 (pointerId → 位置)
    var lvGesture = null;    // 動かし始めたときの状態
    var lvMoved = false, lvDownAt = 0, lvLastTap = 0;
    var lvCount = function () { return Object.keys(lvPts).length; };
    var lvStart = function () {
      var ids = Object.keys(lvPts);
      if (ids.length >= 2) {
        var a = lvPts[ids[0]], b = lvPts[ids[1]];
        lvGesture = { pinch: true, d: Math.hypot(a.x - b.x, a.y - b.y) || 1, s: lvS,
          mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, x: lvX, y: lvY };
      } else if (ids.length === 1) {
        var p = lvPts[ids[0]];
        lvGesture = { pinch: false, px: p.x, py: p.y, x: lvX, y: lvY };
      } else {
        lvGesture = null;
      }
    };

    if (lvStage && lvImg) {
      lvStage.addEventListener('pointerdown', function (e) {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        lvPts[e.pointerId] = { x: e.clientX, y: e.clientY };
        if (lvStage.setPointerCapture) { try { lvStage.setPointerCapture(e.pointerId); } catch (err) { /* 古いブラウザ */ } }
        if (lvCount() === 1) { lvMoved = false; lvDownAt = Date.now(); }
        lvStart();
        lvStage.classList.add('is-dragging');
      });

      lvStage.addEventListener('pointermove', function (e) {
        if (!lvPts[e.pointerId] || !lvGesture) return;
        lvPts[e.pointerId] = { x: e.clientX, y: e.clientY };
        var g = lvGesture;
        if (g.pinch && lvCount() >= 2) {
          var ids = Object.keys(lvPts), a = lvPts[ids[0]], b = lvPts[ids[1]];
          var d = Math.hypot(a.x - b.x, a.y - b.y);
          var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
          // 始めたときの指の中点の下にあった画像の位置を、今の中点に合わせる (拡大しながら動かせる)
          var r = lvStage.getBoundingClientRect();
          var u = (g.mx - r.left - lvImg.offsetLeft - g.x) / g.s;
          var v = (g.my - r.top - lvImg.offsetTop - g.y) / g.s;
          lvS = Math.min(lvMax(), Math.max(1, g.s * d / g.d));
          lvX = mx - r.left - lvImg.offsetLeft - lvS * u;
          lvY = my - r.top - lvImg.offsetTop - lvS * v;
          lvMoved = true;
          lvApply(false);
        } else if (!g.pinch) {
          var dx = e.clientX - g.px, dy = e.clientY - g.py;
          if (Math.abs(dx) + Math.abs(dy) > 6) lvMoved = true;
          if (lvS > 1.01) { lvX = g.x + dx; lvY = g.y + dy; lvApply(false); }
        }
      });

      var lvEnd = function (e) {
        if (!lvPts[e.pointerId]) return;
        delete lvPts[e.pointerId];
        var wasTap = !lvMoved && Date.now() - lvDownAt < 300 && lvCount() === 0;
        lvStart();   // 2 本 → 1 本になったら、そのまま移動を続けられるように
        if (lvCount() === 0) lvStage.classList.remove('is-dragging');
        if (!wasTap || e.type === 'pointercancel') return;
        var onImg = e.target === lvImg;
        if (e.pointerType === 'mouse') {
          // パソコン: 画像のクリックで拡大 / 全体。画像の外 (暗い余白) のクリックで閉じる
          if (onImg) lvToggle(e.clientX, e.clientY);
          else if (lvS <= 1.01) lvClose();
          return;
        }
        // スマホ: ダブルタップで拡大 / 全体
        var now = Date.now();
        if (now - lvLastTap < 320) { lvLastTap = 0; lvToggle(e.clientX, e.clientY); }
        else lvLastTap = now;
      };
      lvStage.addEventListener('pointerup', lvEnd);
      lvStage.addEventListener('pointercancel', lvEnd);

      // パソコンのホイール / トラックパッドのピンチ (ctrlKey 付きの wheel になる)
      lvStage.addEventListener('wheel', function (e) {
        e.preventDefault();
        var k = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025));
        lvZoomAt(lvS * k, e.clientX, e.clientY, false);
      }, { passive: false });

      // 古い iOS Safari の独自ジェスチャー (ページ全体の拡大) を止める
      lvStage.addEventListener('gesturestart', function (e) { e.preventDefault(); });

      // 画面の向きや大きさが変わったら、はみ出しを直す
      window.addEventListener('resize', function () { if (lvDialog.open) lvApply(false); });
    }

    var lvOpen = function () {
      if (typeof lvDialog.showModal !== 'function') {
        // dialog に対応していない古いブラウザは PDF を開く
        if (lvPdf) window.open(lvPdf.href, '_blank', 'noopener');
        return;
      }
      lvDialog.showModal();
      document.documentElement.classList.add('oimo-viewer-open');
      lvReset();
      if (lvDialog.requestFullscreen) {
        lvDialog.requestFullscreen().catch(function () { /* 使えなければ画面いっぱいのまま */ });
      }
    };

    var lvClose = function () {
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(function () {});
      }
      if (lvDialog.open) lvDialog.close();
    };

    lvDialog.addEventListener('close', function () {
      document.documentElement.classList.remove('oimo-viewer-open');
      lvPts = {}; lvGesture = null;
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(function () {});
      }
    });

    Array.prototype.forEach.call(document.querySelectorAll('[data-oimo-layout-open]'), function (btn) {
      btn.addEventListener('click', lvOpen);
    });
    Array.prototype.forEach.call(lvDialog.querySelectorAll('[data-oimo-viewer-close]'), function (btn) {
      btn.addEventListener('click', lvClose);
    });
    if (lvZoomBtn) {
      lvZoomBtn.addEventListener('click', function () { lvToggle(); });
    }
  }

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

  /* --- 6. 視差効果 --------------------------------------------------------
     data-oimo-parallax="0.18" を書いた要素に、スクロール量 × その値を
     --oimo-parallax (px) として入れる。動かすかどうかと向きは CSS 側で決める
     (transform を使うので、レイアウトの計算は起きない)。
     プラスは「奥」(ページよりゆっくり動く)、マイナスは「手前」。
     ちらつき防止のアニメーションと取り合いにならないよう、
     transform を当てるのは画像そのものではなく囲みの要素にしている。
     --------------------------------------------------------------------- */
  var pxLayers = document.querySelectorAll('[data-oimo-parallax]');
  var pxNoMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (pxLayers.length && !pxNoMotion) {
    // 変数名は px… で始める。このファイルは全体が 1 つの関数なので、
    // 上の機能と同じ名前で var を書くと同じ変数になってしまう
    // (間引き用のフラグを共有してしまい、片方が動かなくなる)
    var pxPending = false;
    var pxApply = function () {
      pxPending = false;
      for (var i = 0; i < pxLayers.length; i++) {
        var el = pxLayers[i];
        var speed = parseFloat(el.getAttribute('data-oimo-parallax'));
        if (!speed) continue;
        // 親のセクションを通り過ぎたら、それ以上は動かさない
        var host = el.closest('section') || el.parentNode;
        var limit = host ? host.offsetHeight : 0;
        var y = window.pageYOffset || html.scrollTop || 0;
        if (limit && y > limit) y = limit;
        el.style.setProperty('--oimo-parallax', (y * speed).toFixed(1) + 'px');
      }
    };
    var pxOnScroll = function () {
      if (pxPending) return;
      pxPending = true;
      window.requestAnimationFrame(pxApply);
    };
    window.addEventListener('scroll', pxOnScroll, { passive: true });
    window.addEventListener('resize', pxOnScroll, { passive: true });
    pxApply();
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
