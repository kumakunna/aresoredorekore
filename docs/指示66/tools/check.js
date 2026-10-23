/* =====================================================================
   画面の検査 UICHECK（あつまれ、あれこれ）
   ---------------------------------------------------------------------
   新しい画面の「見本」と「本物のアプリ」で、同じ物差しを使うための関数。
   ブラウザの中で動く（Playwright などで page に読み込んでから呼ぶ）。

     await page.addScriptTag({ path: 'check.js' });
     const issues = await page.evaluate(() =>
       UICHECK(document.querySelector('#scr-shelf'), { tv: false, band: '.bottom-bar' }));

   root  … 画面ひとつ（スマホなら画面全体の箱、TVなら 1920×1080 の箱）
   返り値 … [{kind, text, ...}]。空の配列なら合格。
   スマホは 390×844 と 375×667、TVは 1920×1080 で測ること。

   opts（どれも省略できる。省略時は見本のクラス名）
     tv        : TVの画面なら true（字の最小 42px・安全な枠・二人称を測る）
     band      : 下の帯のセレクタ（重なり・線とのすき間を測る）
     content   : 帯と重なってはいけない中身のセレクタ（スマホのみ。既定 ':scope > .in *'）
     topLine   : 見出しの下の線のセレクタ（線とのすき間を測る）
     deco      : 測らない飾りの層（名前の壁・縦の英字など）
     layers    : 閉じている時は測らない層（シート・ポップなど。.open/.on が付いたら測る）
     icons     : 中心を厳しく測る入れ物（丸ボタン・アイコンの四角）
     tiles     : 中心をゆるく測る入れ物（ゲームの印）
     safe      : TVの安全な枠 [上,右,下,左]（既定 54,96,54,96）
     gap       : 線と箱の最小のすき間（既定 12px）
     minPx     : 字の最小（既定 スマホ12 / TV42）

   見る物（kind）
     画面の外 / 小さい字 / TVの小さい字 / 言葉の決まり / TVで二人称 / 字が切れている
     1〜2文字だけの行（2行以上で、最後の行が記号を除いて2文字以下）
     TVの安全な枠の外 / 帯と重なる / 下の線に近すぎる / 上の線に近すぎる
     中心がずれている（丸やアイコンの四角の中の絵。描かれている所の中心で測る）
     印が中心からずれている（ゲームの印。印の幅の6%まではゆるす）
     部品の名前がぶつかっている（見本のみ：.sheet などが画面の奥に入っている）

   わざとの時の印（属性）
     data-offok  … 画面の外にあってよい（横に送るページの、隣のページ）
     data-brok   … 改行の検査をしない（わざと短い行にしている）
     .cut-ok     … 字が切れてよい（「…」で省くと決めた所）
   ===================================================================== */
(function () {
  var BAN = ['閉じる', '戻る', '開始', '中止', '作成', '参加する', 'ホスト', 'ゲスト', 'ルーム', 'モジュール', 'フェーズ'];
  var TVBAN = ['あなた', 'Are you'];
  var SOFT = /[\s、。，．・…！？!?「」『』（）()\[\]〜~]/g;

  function shown(el, stop) {
    for (var p = el; p && p !== stop.parentElement; p = p.parentElement) {
      var cs = getComputedStyle(p);
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false;
    }
    return true;
  }
  function ownText(el) {
    return [].filter.call(el.childNodes, function (n) { return n.nodeType === 3 && n.nodeValue.trim(); });
  }
  // 直接の文字を、見えている行ごとに分ける
  function rowsOf(el) {
    var rows = [];
    ownText(el).forEach(function (n) {
      var t = n.nodeValue;
      for (var i = 0; i < t.length; i++) {
        if (!t[i].trim()) continue;
        var rg = document.createRange(); rg.setStart(n, i); rg.setEnd(n, i + 1);
        var b = rg.getClientRects()[0]; if (!b || !b.width) continue;
        var row = null;
        for (var k = 0; k < rows.length; k++) if (Math.abs(rows[k].top - b.top) < b.height * 0.5) { row = rows[k]; break; }
        if (!row) { row = { top: b.top, s: '' }; rows.push(row); }
        row.s += t[i];
      }
    });
    rows.sort(function (a, b) { return a.top - b.top; });
    return rows.map(function (r) { return r.s; });
  }
  // 絵の「実際に描かれている所」の四角（svgは中身の形、imgは画像の四角）
  function drawn(c) {
    var svg = c.querySelector('svg');
    if (svg) {
      var rr = svg.getBoundingClientRect(), vb = svg.viewBox && svg.viewBox.baseVal;
      if (!rr.width || !vb || !vb.width) return null;
      var bb; try { bb = svg.getBBox(); } catch (e) { return null; }
      if (!bb.width) return null;
      var k = Math.min(rr.width / vb.width, rr.height / vb.height);
      var ox = rr.left + (rr.width - vb.width * k) / 2, oy = rr.top + (rr.height - vb.height * k) / 2;
      return { left: ox + (bb.x - vb.x) * k, top: oy + (bb.y - vb.y) * k, width: bb.width * k, height: bb.height * k };
    }
    var img = c.querySelector('img');
    return img ? img.getBoundingClientRect() : null;
  }

  window.UICHECK = function (root, o) {
    o = o || {};
    var tv = !!o.tv, out = [];
    var R = root.getBoundingClientRect(), s = (R.width / root.offsetWidth) || 1, W = root.offsetWidth, H = root.offsetHeight;
    var minPx = o.minPx || (tv ? 42 : 12), safe = o.safe || [54, 96, 54, 96], gap = o.gap || 12;
    var deco = o.deco || '.bg,.names,.circles,.lpring,[data-edge],.brand,.tbrand,.guide';
    var layers = [].slice.call(root.querySelectorAll(o.layers || '.sheet,.pop,.dlg,.toast,.scrim,.minipill,[data-hide]'));
    function closed(el) { return layers.some(function (h) { return h.contains(el) && !h.classList.contains('open') && !h.classList.contains('on'); }); }
    function skip(el) { return !!el.closest(deco) || closed(el); }
    function bx(r) { return { x1: (r.left - R.left) / s, y1: (r.top - R.top) / s, x2: (r.right - R.left) / s, y2: (r.bottom - R.top) / s }; }
    function inScroll(el) {
      for (var p = el.parentElement; p && p !== root; p = p.parentElement) { var y = getComputedStyle(p).overflowY; if (y === 'auto' || y === 'scroll') return true; }
      return false;
    }
    function txt(el) { return (el.textContent || (el.getAttribute && el.getAttribute('alt')) || '').trim().replace(/\s+/g, ' ').slice(0, 30); }
    function add(kind, el, more) { var r = { kind: kind, text: txt(el) }; if (more) for (var k in more) r[k] = more[k]; out.push(r); }
    function boxy(el, cs) {
      return ownText(el).length > 0 || !/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor) || cs.backgroundImage !== 'none' || parseFloat(cs.borderTopWidth) > 0 || el.tagName === 'IMG';
    }
    var all = [].slice.call(root.querySelectorAll('*'));

    all.forEach(function (el) {
      if (skip(el) || !shown(el, root)) return;
      var r = el.getBoundingClientRect(); if (!r.width || !r.height) return;
      var b = bx(r), cs = getComputedStyle(el), hasText = ownText(el).length > 0;
      if (!inScroll(el) && !el.closest('[data-offok]') && (b.x2 > W + 2 || b.y2 > H + 2 || b.x1 < -2 || b.y1 < -2) && (hasText || el.tagName === 'BUTTON' || el.tagName === 'IMG'))
        add('画面の外', el, { box: [b.x1 | 0, b.y1 | 0, b.x2 | 0, b.y2 | 0] });
      if (tv && !el.closest('[data-offok]') && (hasText || el.tagName === 'IMG') && (b.x1 < safe[3] - 2 || b.y1 < safe[0] - 2 || b.x2 > W - safe[1] + 2 || b.y2 > H - safe[2] + 2))
        add('TVの安全な枠の外', el, { box: [b.x1 | 0, b.y1 | 0, b.x2 | 0, b.y2 | 0] });
      if (!hasText) return;
      var fs = parseFloat(cs.fontSize);
      if (fs < minPx) add(tv ? 'TVの小さい字' : '小さい字', el, { px: fs });
      var own = ownText(el).map(function (n) { return n.nodeValue; }).join('');
      BAN.forEach(function (w) { if (own.indexOf(w) >= 0) add('言葉の決まり', el, { word: w }); });
      if (tv) TVBAN.forEach(function (w) { if (own.indexOf(w) >= 0) add('TVで二人称', el, { word: w }); });
      if (!el.closest('.cut-ok') && (cs.overflow === 'hidden' || cs.overflowX === 'hidden' || cs.textOverflow === 'ellipsis') && el.scrollWidth > el.clientWidth + 2)
        add('字が切れている', el);
      if (cs.whiteSpace.indexOf('nowrap') < 0 && !el.closest('[data-brok]')) {
        var rows = rowsOf(el);
        if (rows.length >= 2 && rows[rows.length - 1].replace(SOFT, '').length <= 2) add('1〜2文字だけの行', el, { rows: rows });
      }
    });

    // 下の帯：重ならない・線から少し離す
    var band = o.band ? root.querySelector(o.band) : (tv ? root.querySelector('.tband') : [].filter.call(root.children, function (c) { return c.classList.contains('band'); })[0]);
    if (band && shown(band, root)) {
      var B = bx(band.getBoundingClientRect());
      var cand = tv ? all.filter(function (e) { return !band.contains(e); }) : [].slice.call(root.querySelectorAll(o.content || ':scope > .in *'));
      cand.forEach(function (el) {
        if (skip(el) || el.closest('[data-offok]') || inScroll(el) || !shown(el, root)) return;
        var cs = getComputedStyle(el); if (!boxy(el, cs)) return;
        var e = bx(el.getBoundingClientRect()); if (e.x2 - e.x1 < 1 || e.y2 - e.y1 < 1) return;
        var ovy = Math.min(e.y2, B.y2) - Math.max(e.y1, B.y1), ovx = Math.min(e.x2, B.x2) - Math.max(e.x1, B.x1);
        if (ovy > 2 && ovx > 2) add('帯と重なる', el);
        else if (tv && ovx > 2 && B.y1 - e.y2 >= 0 && B.y1 - e.y2 < gap) add('下の線に近すぎる', el, { gap: Math.round(B.y1 - e.y2) });
      });
    }
    // 見出しの下の線から少し離す（TV）
    var top = tv ? root.querySelector(o.topLine || '.thd .arrow') : (o.topLine ? root.querySelector(o.topLine) : null);
    if (top && shown(top, root)) {
      var T = bx(top.getBoundingClientRect());
      all.forEach(function (el) {
        if (skip(el) || top.parentElement.contains(el) || (band && band.contains(el)) || !shown(el, root)) return;
        var cs = getComputedStyle(el); if (!boxy(el, cs)) return;
        var e = bx(el.getBoundingClientRect()); if (e.x2 - e.x1 < 1) return;
        var ovx = Math.min(e.x2, T.x2) - Math.max(e.x1, T.x1);
        if (ovx > 2 && e.y1 >= T.y2 - 2 && e.y1 - T.y2 < gap) add('上の線に近すぎる', el, { gap: Math.round(e.y1 - T.y2) });
      });
    }

    // 中心：丸ボタンやアイコンの四角の中の絵（描かれている所で測る）
    root.querySelectorAll(o.icons || '.cbtn:not(.who) .ring,.xbtn,.ri,.oi,.sl-edge,.vr,.gift').forEach(function (c) {
      if (skip(c) || !shown(c, root)) return;
      var d = drawn(c); if (!d || !d.width) return;
      var cr = c.getBoundingClientRect();
      var dx = ((d.left + d.width / 2) - (cr.left + cr.width / 2)) / s, dy = ((d.top + d.height / 2) - (cr.top + cr.height / 2)) / s;
      if (Math.abs(dx) > 1.5 || Math.abs(dy) > 1.5) add('中心がずれている', c, { dx: Math.round(dx * 10) / 10, dy: Math.round(dy * 10) / 10 });
    });
    root.querySelectorAll(o.tiles || '.tile').forEach(function (c) {
      if (skip(c) || !shown(c, root)) return;
      var d = drawn(c); if (!d || !d.width) return;
      var cr = c.getBoundingClientRect(), tol = cr.width * 0.06;
      var dx = (d.left + d.width / 2) - (cr.left + cr.width / 2), dy = (d.top + d.height / 2) - (cr.top + cr.height / 2);
      if (Math.abs(dx) > tol || Math.abs(dy) > tol) add('印が中心からずれている', c, { dx: Math.round(dx / s), dy: Math.round(dy / s) });
    });

    // 見本だけ：重なる層は画面のすぐ下に置く決まり
    if (o.layerPlace !== false) root.querySelectorAll('.sheet,.pop,.dlg,.toast,.scrim').forEach(function (l) {
      var p = l.parentElement;
      if (p !== root && !(tv && p.classList.contains('safe')) && !l.closest('[data-layer-ok]')) add('部品の名前がぶつかっている', l, { cls: l.className });
    });
    return out;
  };
})();
