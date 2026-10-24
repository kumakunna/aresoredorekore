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
     over      : 上に重なる層（開いたシート・たずねる枠・知らせ）。中の字と外の字は比べない（K1）
     buttons   : 縦のすき間を測るボタン（既定 'button,.btn,[role=button]'）（K6）
     extra     : root の外にある、アプリ全体の部品（右上の⚙など）。TV の安全な枠で測る（K7）
     pix       : 字を消して撮った写真（UICHECK.loadShot が作る）。字の後ろの色を画素で測る（K2）

   見る物（kind）
     画面の外 / 小さい字 / TVの小さい字 / 言葉の決まり / TVで二人称 / 字が切れている
     1〜2文字だけの行（2行以上で、最後の行が記号を除いて2文字以下）
     TVの安全な枠の外 / 帯と重なる / 下の線に近すぎる / 上の線に近すぎる
     中心がずれている（丸やアイコンの四角の中の絵。描かれている所の中心で測る）
     印が中心からずれている（ゲームの印。印の幅の6%まではゆるす）
     部品の名前がぶつかっている（見本のみ：.sheet などが画面の奥に入っている）
     （指示68-0b で足した物）
     字と字が重なる（K1：字が描かれている所どうしが 2px×2px より重なる。親子は数えない。巻ける箱の中も測る）
     色の差が足りない（K2：24px 未満（太字は 19px 未満）は 4.5、それより大きい字と TV は 3。WCAG 2.2 の 1.4.3）
     下の線に近すぎる をスマホでも測る（K5）／ボタンのすき間が狭い（K6：たてに並んだボタンが 8px 未満）
     TVの安全な枠の外 を、extra の部品（右上の⚙など）でも測る（K7）

   わざとの時の印（属性）
     data-offok  … 画面の外にあってよい（横に送るページの、隣のページ）
     data-brok   … 改行の検査をしない（わざと短い行にしている）
     .cut-ok     … 字が切れてよい（「…」で省くと決めた所）
     data-overlapok … 字が重なってよい（わざと重ねる所。理由をそばのコメントに書く）
     data-dimok  … 色の差が小さくてよい（わざと薄くする所。理由をそばのコメントに書く）
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

  // 色（指示68-0b K2）。getComputedStyle は rgb()/rgba() か、color-mix の結果の color(srgb …) を返す
  function rgba(str) {
    var m = String(str).match(/-?[\d.]+(e-?\d+)?/g) || [], c;
    if (/^color\(srgb/.test(str)) c = [m[0] * 255, m[1] * 255, m[2] * 255, m.length > 3 ? +m[3] : 1];
    else if (/^rgba?\(/.test(str)) c = [+m[0], +m[1], +m[2], m.length > 3 ? +m[3] : 1];
    else if (str === 'transparent') c = [0, 0, 0, 0];
    else { c = [0, 0, 0, 1]; c.bad = true; }
    return c;
  }
  function lin(v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
  function lum(c) { return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); }
  function mix(top, under, a) { return [top[0] * a + under[0] * (1 - a), top[1] * a + under[1] * (1 - a), top[2] * a + under[2] * (1 - a)]; }
  // 字の並びが描かれている所の上下（基準線から）と、書体の上下の余白（K1）。測れない古いブラウザは null（その時は Range の四角のまま）
  var inkCtx = null;
  function ink(cs, text) {
    inkCtx = inkCtx || document.createElement('canvas').getContext('2d');
    inkCtx.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
    var m = inkCtx.measureText(String(text).trim());
    if (!m.fontBoundingBoxAscent && !m.fontBoundingBoxDescent) return null;
    return { fa: m.fontBoundingBoxAscent, fd: m.fontBoundingBoxDescent, ia: m.actualBoundingBoxAscent, id: m.actualBoundingBoxDescent };
  }
  function contrast(p, q) { var a = lum(p), b = lum(q); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); }

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
        // K5（指示68-0b）：スマホでも線とのすき間を測る（文化祭の感想の札が帯の線から約5pxだった）
        else if (ovx > 2 && B.y1 - e.y2 >= 0 && B.y1 - e.y2 < gap) add('下の線に近すぎる', el, { gap: Math.round(B.y1 - e.y2) });
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

    // ---------- K1（指示68-0b）：字と字の重なり ----------
    // 66-3 で check.js が 0件と言ったのに、字と字が重なる画面があった（375 のゲームのページ・TV の投票）。
    // 見えている字の行の四角（Range の rect）どうしを比べる。親子は数えない。
    // 巻ける箱の中も測る（巻いても重なりは直らない）：同じ巻ける箱の中どうしは、巻いた先も含めて比べ、
    // 違う箱どうしは見えている所だけを比べる。上に重なる層（開いたシートなど）の中と外は比べない（隠れているだけ）
    var overSel = o.over || '.sheet,.pop,.dlg,.toast,.scrim';
    function scroller(el) {
      for (var p = el.parentElement; p && p !== root.parentElement; p = p.parentElement) { var y = getComputedStyle(p).overflowY; if (y === 'auto' || y === 'scroll') return p; }
      return null;
    }
    // el の見える四角を切る箱（stop より内側の「はみ出しを隠す」箱）
    function clipOf(el, stop) {
      var c = { x1: -1e9, y1: -1e9, x2: 1e9, y2: 1e9 };
      for (var p = el.parentElement; p && p !== stop && p !== root.parentElement; p = p.parentElement) {
        var pcs = getComputedStyle(p);
        if (pcs.overflowX === 'visible' && pcs.overflowY === 'visible') continue;
        var b = bx(p.getBoundingClientRect());
        c = { x1: Math.max(c.x1, b.x1), y1: Math.max(c.y1, b.y1), x2: Math.min(c.x2, b.x2), y2: Math.min(c.y2, b.y2) };
      }
      return c;
    }
    function cut(r, c) { return { x1: Math.max(r.x1, c.x1), y1: Math.max(r.y1, c.y1), x2: Math.min(r.x2, c.x2), y2: Math.min(r.y2, c.y2) }; }
    var texts = [];
    all.forEach(function (el) {
      if (skip(el) || !shown(el, root) || el.closest('[data-overlapok]')) return;
      if (rgba(getComputedStyle(el).color)[3] === 0) return;
      // 行の四角の上下は、**字が実際に描かれている所**にする。Range の四角は書体の上下の余白（M PLUS 1 で字の約1.45倍）まで含み、
      // 逆に CSS の箱は text-box（英字の高さで切る）で日本語の字より小さい——どちらで比べても実際の重なりとずれる（TV の投票で見逃した）。
      // canvas の measureText で、その字の並びの「描かれている所」の上下と、書体の上下の余白を取り、Range の四角の中の基準線から置き直す
      var cs1 = getComputedStyle(el), rs = [];
      ownText(el).forEach(function (n) {
        var m = ink(cs1, n.nodeValue);
        var rg = document.createRange(); rg.selectNodeContents(n);
        [].forEach.call(rg.getClientRects(), function (r) {
          if (!(r.width > 0.5 && r.height > 0.5)) return;
          var q = bx(r);
          if (!m) { rs.push(q); return; }
          var k = (q.y2 - q.y1) / (m.fa + m.fd), base = q.y1 + m.fa * k;
          rs.push({ x1: q.x1, x2: q.x2, y1: base - m.ia * k, y2: base + m.id * k });
        });
      });
      // 切る箱は先に2通り求めておく（同じ巻ける箱の中どうし＝巻ける箱より内側だけ／違う箱どうし＝全部）。組ごとに先祖をたどると遅い
      if (rs.length) { var sc = scroller(el); texts.push({ el: el, rs: rs, sc: sc, ov: el.closest(overSel), cIn: clipOf(el, sc), cAll: clipOf(el, null) }); }
    });
    for (var i = 0; i < texts.length; i++) for (var j = i + 1; j < texts.length; j++) {
      var A = texts[i], Bt = texts[j];
      if (A.ov !== Bt.ov || A.el.contains(Bt.el) || Bt.el.contains(A.el)) continue;
      // 巻いた中身が、浮いた部品（右上の丸ボタンなど）の下を通るのはふつう（v2-shot の「右上のボタンと重なる」と同じ。巻く前の形で見る）
      if (A.sc !== Bt.sc && ((A.sc && A.sc.scrollTop > 0) || (Bt.sc && Bt.sc.scrollTop > 0))) continue;
      var same = A.sc === Bt.sc, ca = same ? A.cIn : A.cAll, cb = same ? Bt.cIn : Bt.cAll, hit = null;
      for (var a = 0; a < A.rs.length && !hit; a++) for (var b2 = 0; b2 < Bt.rs.length && !hit; b2++) {
        var ra = cut(A.rs[a], ca), rb = cut(Bt.rs[b2], cb);
        var ox = Math.min(ra.x2, rb.x2) - Math.max(ra.x1, rb.x1), oy = Math.min(ra.y2, rb.y2) - Math.max(ra.y1, rb.y1);
        if (ox > 2 && oy > 2) hit = [Math.round(ox), Math.round(oy)];
      }
      if (hit) add('字と字が重なる', A.el, { with: txt(Bt.el), ov: hit });
    }

    // ---------- K2（指示68-0b）：字と背景の色の差（コントラスト比・WCAG 2.2 の 1.4.3） ----------
    // 暗い世界の「分類 n/9」が暗い色の上で見えなかったのに、check.js は数えていなかった。
    // 背景は、字を消して撮った写真（o.pix）の、字の行の四角の中の色（中央値）で測る（グラデーションや絵の上も同じ物差し）。
    // 写真の外（巻いた先など）は、親の背景色をたどる（絵やグラデーションに当たったら測らない）
    var pix = o.pix === undefined ? window.UICHECK.pix : o.pix;
    function behind(el, rects) {
      if (pix) {
        var cols = [];
        rects.forEach(function (r) {
          var x1 = Math.max(0, Math.round(r.left * pix.k)), x2 = Math.min(pix.W, Math.round(r.right * pix.k));
          var y1 = Math.max(0, Math.round(r.top * pix.k)), y2 = Math.min(pix.H, Math.round(r.bottom * pix.k));
          var st = Math.max(1, Math.round((x2 - x1) * (y2 - y1) / 400));
          for (var y = y1; y < y2; y += Math.ceil(Math.sqrt(st))) for (var x = x1; x < x2; x += Math.ceil(Math.sqrt(st))) {
            var q = (y * pix.W + x) * 4; cols.push([pix.d[q], pix.d[q + 1], pix.d[q + 2]]);
          }
        });
        if (cols.length) { cols.sort(function (p, q) { return lum(p) - lum(q); }); return cols[cols.length >> 1]; }
      }
      var stack = [];
      for (var p = el; p; p = p.parentElement) {
        var pcs = getComputedStyle(p);
        if (pcs.backgroundImage !== 'none') return null;
        var c = rgba(pcs.backgroundColor); if (c[3] > 0) stack.push(c);
        if (c[3] >= 1) break;
      }
      var base = [255, 255, 255];
      for (var k = stack.length - 1; k >= 0; k--) base = mix(stack[k], base, stack[k][3]);
      return base;
    }
    // 上に重なる層（開いたシート・幕）の下にある字は、隠れているので測らない（その点でいちばん上にある物で見分ける）
    // 開いている重なり（.is-open／.open／.on）の四角の中で、その重なりの外の字。幕は押せない（pointer-events:none）こともあるので、
    // 「その点でいちばん上の物」ではなく四角で見る
    var openOver = [].filter.call(root.querySelectorAll(overSel), function (l) { return l.matches('.is-open,.open,.on') && shown(l, root); })
      .map(function (l) { return { l: l, r: l.getBoundingClientRect() }; });
    // 巻いている箱（scrollTop>0）。巻いた中身の上に浮いた部品の字は、後ろが巻いた中身になる（巻く前の形で見る）
    var scrolled = [].filter.call(root.querySelectorAll('*'), function (p) { return p.scrollTop > 0; }).map(function (p) { return { p: p, r: p.getBoundingClientRect() }; });
    function covered(el, r) {
      var x = r.left + Math.min(r.width / 2, 6), y = r.top + r.height / 2;
      var inR = function (q) { return x >= q.left && x <= q.right && y >= q.top && y <= q.bottom; };
      if (openOver.some(function (o) { return !o.l.contains(el) && inR(o.r); })) return true;
      if (scrolled.some(function (o) { return !o.p.contains(el) && inR(o.r); })) return true;
      var top = document.elementFromPoint(x, y);
      if (!top || el.contains(top) || top.contains(el)) return false;
      var lay = top.closest(overSel);
      return !!lay && !lay.contains(el);
    }
    // 見えている所だけで測る（巻ける箱の外・はみ出しを隠す箱の外の字は、見えていないので数えない）
    function visibleRects(el, rects) {
      var c = clipOf(el, null);
      return rects.filter(function (r) {
        var q = bx(r), w = Math.min(q.x2, c.x2) - Math.max(q.x1, c.x1), h = Math.min(q.y2, c.y2) - Math.max(q.y1, c.y1);
        return w > 0 && h > 0 && w * h >= (q.x2 - q.x1) * (q.y2 - q.y1) * 0.5;
      });
    }
    all.forEach(function (el) {
      if (skip(el) || !shown(el, root) || !ownText(el).length) return;
      if (el.closest('[data-dimok]') || el.closest(':disabled,[aria-disabled="true"]')) return;
      var cs = getComputedStyle(el), fg = rgba(cs.color);
      if (fg[3] === 0 || fg.bad) return;
      var op = 1; for (var p = el; p; p = p.parentElement) op *= parseFloat(getComputedStyle(p).opacity);
      var rects = [];
      ownText(el).forEach(function (n) { var rg = document.createRange(); rg.selectNodeContents(n); [].forEach.call(rg.getClientRects(), function (r) { if (r.width > 0.5) rects.push(r); }); });
      rects = visibleRects(el, rects);
      if (!rects.length || covered(el, rects[0])) return;
      var bg = behind(el, rects); if (!bg) return;
      var f = mix(fg, bg, fg[3] * op), ratio = contrast(f, bg);
      var fs = parseFloat(cs.fontSize), large = fs >= 24 || (parseInt(cs.fontWeight, 10) >= 700 && fs >= 19);
      var need = tv || large ? 3 : 4.5;
      if (ratio < need) add('色の差が足りない', el, { ratio: Math.round(ratio * 100) / 100, need: need, fg: f.map(Math.round), bg: bg.map(Math.round) });
    });

    // ---------- K6（指示68-0b）：たてに並んだボタンのすき間 ----------
    // 立ったまま押すと、すき間 2〜4px では隣を押す（待合の「TVに映す」のシート）。8px 未満なら言う
    var btnSel = o.buttons || 'button,.btn,[role=button]';
    var bts = [].filter.call(root.querySelectorAll(btnSel), function (b) { return !skip(b) && shown(b, root) && !(b.parentElement && b.parentElement.closest(btnSel)); })
      .map(function (b) { return { b: b, r: bx(b.getBoundingClientRect()), ov: b.closest(overSel), sc: scroller(b) }; })
      .filter(function (x) { return x.r.x2 - x.r.x1 > 1 && x.r.y2 - x.r.y1 > 1; });
    bts.forEach(function (A) {
      var best = null;
      bts.forEach(function (Bb) {
        if (Bb === A || Bb.ov !== A.ov) return;
        // 巻いた中身と、その上に浮いた部品は比べない（巻く前の形で見る・K1 と同じ）
        if (Bb.sc !== A.sc && ((Bb.sc && Bb.sc.scrollTop > 0) || (A.sc && A.sc.scrollTop > 0))) return;
        var ox = Math.min(A.r.x2, Bb.r.x2) - Math.max(A.r.x1, Bb.r.x1), w = Math.min(A.r.x2 - A.r.x1, Bb.r.x2 - Bb.r.x1);
        var g = Bb.r.y1 - A.r.y2;
        if (ox >= w * 0.5 && g >= -0.5 && (!best || g < best.g)) best = { g: g, b: Bb.b };
      });
      if (best && best.g < 8) add('ボタンのすき間が狭い', A.b, { gap: Math.round(best.g * 10) / 10, with: txt(best.b) });
    });

    // ---------- K7（指示68-0b）：TV の画面に重なる、アプリ全体の部品（右上の⚙など） ----------
    if (tv && o.extra) [].forEach.call(document.querySelectorAll(o.extra), function (el) {
      if (!shown(el, document.documentElement)) return;
      var r = el.getBoundingClientRect(); if (!r.width || !r.height) return;
      var b = bx(r);
      if (b.x1 < safe[3] - 2 || b.y1 < safe[0] - 2 || b.x2 > W - safe[1] + 2 || b.y2 > H - safe[2] + 2)
        add('TVの安全な枠の外', el, { box: [b.x1 | 0, b.y1 | 0, b.x2 | 0, b.y2 | 0], part: el.id || el.className });
    });

    // 見本だけ：重なる層は画面のすぐ下に置く決まり
    if (o.layerPlace !== false) root.querySelectorAll('.sheet,.pop,.dlg,.toast,.scrim').forEach(function (l) {
      var p = l.parentElement;
      if (p !== root && !(tv && p.classList.contains('safe')) && !l.closest('[data-layer-ok]')) add('部品の名前がぶつかっている', l, { cls: l.className });
    });
    return out;
  };

  // ---------- 字を消して撮る（指示68-0b K2：字の後ろの色を画素で測るため） ----------
  //   UICHECK.inkOff(hide) → 写真を撮る → await UICHECK.loadShot(dataUrl, 画素の倍率) → UICHECK.inkOn() → UICHECK(root, o)
  // hide：一緒に消す飾り（名前の壁・縦の英字。背景に入れない）。測り終えたら UICHECK.pix = null
  window.UICHECK.pix = null;
  window.UICHECK.inkOff = function (hide) {
    var st = document.createElement('style'); st.id = 'uicheck-ink-off';
    st.textContent = '*,*::before,*::after{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;caret-color:transparent!important;transition:none!important;}' +
      (hide || '.names,.brand,.tbrand,.guide') + '{visibility:hidden!important;}';
    document.head.appendChild(st);
  };
  // もどす時は、字の色の移り変わり（透明 → もとの色）をすぐ終わらせる。途中の色を測ってしまうため
  window.UICHECK.inkOn = function () {
    var st = document.getElementById('uicheck-ink-off'); if (st) st.remove();
    void document.body.offsetWidth;
    document.getAnimations().forEach(function (a) { if (typeof CSSTransition !== 'undefined' && a instanceof CSSTransition) a.finish(); });
  };
  window.UICHECK.loadShot = function (src, k) {
    var im = new Image(); im.src = src;
    return im.decode().then(function () {
      var c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
      var g = c.getContext('2d'); g.drawImage(im, 0, 0);
      window.UICHECK.pix = { d: g.getImageData(0, 0, im.width, im.height).data, W: im.width, H: im.height, k: k || 1 };
      return true;
    });
  };
})();
