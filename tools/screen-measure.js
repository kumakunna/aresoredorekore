// tools/screen-measure.js — ページの中で、いま見えている画面を測る（11/7 の検査の準備 4・5）
//
// tools/fes-screen-walk.js がページに送って呼ぶ（MEASURE.toString()）。外の変数は使わない。
// v2 の物差し（docs/指示66/tools/check.js）は見本のクラス名に合わせた細かい物で、古い画面（クイズ解除の盤・TV の大画面・
// 進化じゃんけん・ロシアンカード）には当てにくい。ここはどの画面にも同じに当てられる、荒くて広い物差し：
//   はみ出し（横・TV は縦も）／字が切れている（overflow で隠れた字）／字どうしの重なり／小さい字／押す所の大きさ／
//   字と後ろの色のコントラスト比（WCAG）／入力欄の字（16px 未満は iPhone で勝手に拡大）
// 合格の線（仮・docs/検査_1107/追加_調べた結果から.md）：ボタン 主な操作 60px・どこでも 44px（最低 24px）／
// コントラスト 字 4.5:1・大きい字 3:1／入力欄 16px／スマホの本文 18px／TV 48px（1080p）。
// SELFTEST：わざと悪い物を足して、物差しがそれぞれを言うか（落とし穴10-f・28）。言わない物差しの数字は使わない。

/* eslint-disable no-var */
const MEASURE = function (opts) {
  var o = opts || {};
  var tv = !!o.tv, vw = innerWidth, vh = innerHeight;
  var root = o.root ? document.querySelector(o.root) : (document.querySelector('.screen.active') || document.body);
  var out = [];
  // 測らない物：閉じている層（シート・ダイアログ・知らせ）と飾りの層（名前の壁・背景の英字）と、読み上げにも出さない飾り。
  // v2-shot.js の OPTS（layers・deco）と同じ形。測る前に除かないと、閉じたシートの字どうしを「重なり」と数える
  var SKIP = '.v2-sheet:not(.is-open),.v2-dlg:not(.is-open),.v2-toast:not(.is-open),.v2-scrim:not(.is-open),.v2-bg,.v2-brand,.v2-tbrand,.v2-lpring,.v2-wall,[aria-hidden="true"],[inert]';
  function vis(e) {
    if (!e || !e.getBoundingClientRect) return false;
    if (e.closest && e.closest(SKIP)) return false;
    if (e.checkVisibility && !e.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) return false;
    var r = e.getBoundingClientRect(); return r.width > 0.5 && r.height > 0.5;
  }
  function ownText(e) { var t = ''; for (var n = e.firstChild; n; n = n.nextSibling) if (n.nodeType === 3) t += n.nodeValue; return t.replace(/\s+/g, ' ').trim(); }
  function label(e) {
    var id = e.id ? '#' + e.id : '';
    var c = (typeof e.className === 'string' && e.className.trim()) ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    return e.tagName.toLowerCase() + id + c;
  }
  // 測る層：画面＋上に出ている物（シート・ダイアログ・知らせ）。決めた id のかぶさる物も
  var scopes = [root];
  document.querySelectorAll('.v2-sheet.is-open,.v2-dlg.is-open,.v2-toast.is-open,#foulToast,[id$=Overlay].show,[id$=Overlay].open,[id$=Overlay].active').forEach(function (e) { if (vis(e) && scopes.indexOf(e) === -1 && !root.contains(e)) scopes.push(e); });
  var all = [];
  scopes.forEach(function (s) { all.push(s); s.querySelectorAll('*').forEach(function (e) { all.push(e); }); });
  var texts = [];
  all.forEach(function (e) {
    if (/^(SCRIPT|STYLE|SVG|PATH|G|USE|NOSCRIPT|CANVAS)$/i.test(e.tagName)) return;
    var t = ownText(e);
    if (!t || !vis(e)) return;
    var cs = getComputedStyle(e);
    if (parseFloat(cs.opacity) === 0) return;
    texts.push({ e: e, t: t, cs: cs, r: e.getBoundingClientRect() });
  });
  // ① はみ出し（横。TV は縦も）。fixed で画面いっぱいの飾りはのぞく
  texts.forEach(function (x) {
    var r = x.r;
    if (r.right > vw + 1 || r.left < -1 || (tv && (r.bottom > vh + 1 || r.top < -1))) {
      // 巻ける箱（overflow auto/scroll）の中なら、巻けば見える＝はみ出しではない（ただし横に巻く箱は数える）
      for (var p = x.e.parentElement; p; p = p.parentElement) { var pc = getComputedStyle(p); if (/(auto|scroll)/.test(pc.overflowX) && p.scrollWidth > p.clientWidth + 1) return; }
      out.push({ kind: 'はみ出し', text: x.t.slice(0, 30), el: label(x.e), box: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)] });
    }
  });
  // ② 字が切れている（自分の箱で隠れた字。… の省略は「省略」として別に数える）
  texts.forEach(function (x) {
    var e = x.e, cs = x.cs;
    var hid = /(hidden|clip)/.test(cs.overflowX) || /(hidden|clip)/.test(cs.overflow);
    if (!hid) return;
    if (e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 2) {
      out.push({ kind: cs.textOverflow === 'ellipsis' ? '省略（…）' : '字が切れている', text: x.t.slice(0, 30), el: label(e), sw: e.scrollWidth, cw: e.clientWidth, sh: e.scrollHeight, ch: e.clientHeight });
    }
  });
  // ③ 字どうしの重なり（親子はのぞく・小さい方の 25% 以上）
  var T = texts.slice(0, 400);
  for (var i = 0; i < T.length; i++) for (var j = i + 1; j < T.length; j++) {
    var a = T[i], b = T[j];
    if (a.e.contains(b.e) || b.e.contains(a.e)) continue;
    // 開いている浮いた層（感想のカード・シート・確かめの枠・知らせ）と、その下の画面の字は、上に重ねる作り（指示75 2-1）。同じ層どうしだけ比べる
    var LAYER = '.v2-pop.is-open,.v2-sheet.is-open,.v2-dlg.is-open,.v2-toast.is-open';
    var la = a.e.closest ? a.e.closest(LAYER) : null, lb = b.e.closest ? b.e.closest(LAYER) : null;
    if (la !== lb) continue;
    // 画面の外（巻いた先・横に送った札）どうしの重なりは見えないので数えない
    if (a.r.bottom < 0 || a.r.top > vh || a.r.right < 0 || a.r.left > vw || b.r.bottom < 0 || b.r.top > vh || b.r.right < 0 || b.r.left > vw) continue;
    var w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left), h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
    if (w <= 1 || h <= 1) continue;
    var small = Math.min(a.r.width * a.r.height, b.r.width * b.r.height);
    if (w * h < small * 0.25) continue;
    // 同じ所に重ねて切りかえる字（片方が透明に近い・後ろに回っている）は、上の vis で落ちている
    out.push({ kind: '重なり', text: a.t.slice(0, 20) + ' ／ ' + b.t.slice(0, 20), el: label(a.e) + ' ／ ' + label(b.e) });
  }
  // ④ 小さい字・入力欄の字
  var minPx = tv ? 42 : 12;
  texts.forEach(function (x) {
    var fs = parseFloat(x.cs.fontSize);
    if (fs < minPx) out.push({ kind: tv ? 'TVの小さい字（42px未満）' : '小さい字（12px未満）', text: x.t.slice(0, 30), el: label(x.e), px: Math.round(fs * 10) / 10 });
    else if (tv && fs < 48) out.push({ kind: 'TVの字 48px未満（仮の線）', text: x.t.slice(0, 30), el: label(x.e), px: Math.round(fs * 10) / 10 });
    else if (!tv && fs < 18 && x.t.length >= 12) out.push({ kind: 'スマホの本文 18px未満（仮の線・12字以上の文）', text: x.t.slice(0, 30), el: label(x.e), px: Math.round(fs * 10) / 10 });
  });
  all.forEach(function (e) {
    if (!/^(INPUT|TEXTAREA|SELECT)$/.test(e.tagName) || !vis(e)) return;
    if (e.type === 'hidden' || e.type === 'checkbox' || e.type === 'radio') return;
    var fs = parseFloat(getComputedStyle(e).fontSize);
    if (fs < 16) out.push({ kind: '入力欄の字 16px未満（iPhone で拡大される）', el: label(e), px: fs });
  });
  // ⑤ 押す所の大きさ（見えていて押せる物。::before で広げた範囲は数えない＝少し厳しめ）
  if (!tv) all.forEach(function (e) {
    var clickable = e.tagName === 'BUTTON' || e.getAttribute('role') === 'button' || (e.tagName === 'A' && e.getAttribute('href')) || e.tagName === 'SELECT' ||
      (e.tagName === 'INPUT' && /^(button|submit|checkbox|radio)$/.test(e.type));
    if (!clickable || !vis(e) || e.disabled) return;
    var r = e.getBoundingClientRect(), m = Math.min(r.width, r.height);
    var name = (e.getAttribute('aria-label') || e.innerText || e.value || '').replace(/\s+/g, ' ').trim().slice(0, 20);
    if (m < 24) out.push({ kind: 'ボタン 24px未満', text: name, el: label(e), w: Math.round(r.width), h: Math.round(r.height) });
    else if (m < 44) out.push({ kind: 'ボタン 44px未満', text: name, el: label(e), w: Math.round(r.width), h: Math.round(r.height) });
  });
  // ⑥ コントラスト（字の色と、後ろの塗りの色。後ろが絵・グラデーションなら「測れない」）
  function rgba(s) { var m = /rgba?\(([^)]+)\)/.exec(s || ''); if (!m) return null; var p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; }
  function lum(c) { var f = function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); }
  function over(top, under) { var a = top.a; return { r: top.r * a + under.r * (1 - a), g: top.g * a + under.g * (1 - a), b: top.b * a + under.b * (1 - a), a: 1 }; }
  function bgOf(e) {
    var layers = [];
    for (var p = e; p; p = p.parentElement) {
      var cs = getComputedStyle(p);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return { unknown: true };
      var c = rgba(cs.backgroundColor); if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
    }
    var base = { r: 255, g: 255, b: 255, a: 1 };
    for (var k = layers.length - 1; k >= 0; k--) base = over(layers[k], base);
    return base;
  }
  texts.forEach(function (x) {
    var fg = rgba(x.cs.color); if (!fg) return;
    var bg = bgOf(x.e); if (bg.unknown) return;
    var op = 1; for (var p = x.e; p; p = p.parentElement) op *= parseFloat(getComputedStyle(p).opacity);
    fg = over({ r: fg.r, g: fg.g, b: fg.b, a: fg.a * op }, bg);
    var L1 = lum(fg), L2 = lum(bg), ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    var fs = parseFloat(x.cs.fontSize), bold = parseInt(x.cs.fontWeight, 10) >= 700;
    var large = fs >= 24 || (bold && fs >= 18.66);
    var need = large ? 3 : 4.5;
    if (ratio < need) out.push({ kind: large ? 'コントラスト 3:1未満（大きい字）' : 'コントラスト 4.5:1未満', text: x.t.slice(0, 30), el: label(x.e), ratio: Math.round(ratio * 100) / 100, px: fs });
  });
  // ⑦ 点滅の候補：くり返す動きで、1回が 333ms より短い（1秒に3回より多い）もの。光る・透ける・色が変わる動きかは名前と中身で見る（荒い）
  try {
    document.getAnimations().forEach(function (an) {
      var t = an.effect && an.effect.getTiming && an.effect.getTiming();
      if (!t || an.playState !== 'running') return;
      var d = typeof t.duration === 'number' ? t.duration : 0;
      if (t.iterations !== Infinity && !(t.iterations > 3)) return;
      var per = t.direction === 'alternate' || t.direction === 'alternate-reverse' ? d * 2 : d;
      if (!(d > 0) || per >= 333) return;
      var el = an.effect.target, kf = an.effect.getKeyframes ? an.effect.getKeyframes() : [];
      var props = {}; kf.forEach(function (k) { Object.keys(k).forEach(function (p) { if (!/^(offset|easing|composite|computedOffset)$/.test(p)) props[p] = 1; }); });
      var big = el && el.getBoundingClientRect ? (function (r) { return r.width * r.height / (vw * vh); })(el.getBoundingClientRect()) : 0;
      out.push({ kind: '点滅の候補（1秒に3回より速いくり返し）', el: el ? label(el) : '-', text: (an.animationName || an.id || '') + ' ' + Object.keys(props).join(','), ms: Math.round(per), area: Math.round(big * 100) });
    });
  } catch (e) {}
  // ⑧ 指示75 1-1（A05・A13）：ページが画面より長い（スマホだけ）。iPhone の Safari がその余りへスクロールして、上が切れ下に帯が出る。
  //    **PC の Chrome の真似ではバーが無いので 100vh の差は出ない**（tests/viewport-height.js が CSS を読んで見る）。ここはそれ以外の長さを見る
  if (!tv) {
    var de = document.documentElement, sh = Math.max(de.scrollHeight, document.body ? document.body.scrollHeight : 0);
    if (sh > vh + 1) out.push({ kind: 'ページが画面より長い', el: 'html', sh: sh, ih: vh, sy: Math.round(window.scrollY || 0) });
  }
  var txt = '';
  try { txt = (root.innerText || '').replace(/\s+/g, ' ').slice(0, 4000); } catch (e) {}
  return { n: texts.length, issues: out, txt: txt };
};

/** 物差しの自己検査：わざと悪い物を足して、それぞれ言うか。返り値は言わなかった物の名前（空なら合格） */
const SELFTEST = function (measureSrc) {
  var MEASURE = eval('(' + measureSrc + ')');
  var box = document.createElement('div');
  box.id = 'mz-selftest';
  box.className = 'screen active';
  box.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;background:#fff;z-index:2147483647';
  box.innerHTML = '<div style="position:absolute;left:' + (innerWidth - 20) + 'px;top:10px;font-size:20px;white-space:nowrap">はみ出す字はみ出す字</div>' +
    '<div style="position:absolute;left:10px;top:60px;width:40px;overflow:hidden;white-space:nowrap;font-size:20px">切れる字切れる字</div>' +
    '<div style="position:absolute;left:10px;top:120px;font-size:20px">重なるA</div><div style="position:absolute;left:12px;top:122px;font-size:20px">重なるB</div>' +
    '<div style="position:absolute;left:10px;top:180px;font-size:9px">小さい字</div>' +
    '<button style="position:absolute;left:10px;top:220px;width:30px;height:30px;font-size:14px">x</button>' +
    '<div style="position:absolute;left:10px;top:270px;font-size:16px;color:#bbb">うすい字うすい字</div>' +
    '<input style="position:absolute;left:10px;top:310px;font-size:13px" value="a">';
  document.body.appendChild(box);
  var prev = document.querySelector('.screen.active:not(#mz-selftest)');
  if (prev) prev.classList.remove('active');
  // ページの長さ：画面より長い物を本当に足して言わせる（fixed の箱は高さに数えないので、ふつうの流れに足す）
  var tall = document.createElement('div'); tall.id = 'mz-tall'; tall.style.cssText = 'height:' + (innerHeight * 2) + 'px;width:1px;position:relative';
  document.body.appendChild(tall);
  var r = MEASURE({ root: '#mz-selftest' });
  tall.remove();
  box.remove(); if (prev) prev.classList.add('active');
  var kinds = r.issues.map(function (x) { return x.kind; });
  var want = ['はみ出し', '字が切れている', '重なり', '小さい字（12px未満）', 'ボタン 44px未満', 'コントラスト 4.5:1未満', '入力欄の字 16px未満（iPhone で拡大される）', 'ページが画面より長い'];
  return want.filter(function (k) { return kinds.indexOf(k) === -1; });
};

module.exports = { MEASURE, SELFTEST };
