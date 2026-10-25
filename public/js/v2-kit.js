// v2-kit.js — 新しい見た目（v2・指示66）の部品の「動き」
//
// ---- これは何か ----
// 指示66 で画面を新しい見た目に入れかえる。古い画面をこわさないため、
// 新しい見た目は **`.v2` の箱の中だけ** に効く（CSS は index.html の「v2」の節）。
// ここに置くのは、その箱の中で使う部品の **組み立てと動き** だけ：
//   アイコン・ゲームの印（絵は v2-art.js）／数字の箱／文節で折る／字を縮めて1行に入れる／
//   のこり時間（1つの時計から全部を描く）／シート・まん中の確認・帯の上から出るもの／
//   長押しの輪／名前の壁と、入ってきた人の名前を光らせる／TVの 1920×1080 を画面に合わせる。
//
// ---- 決めごと（docs/デザインの正本.md「12. 新しい見た目」）----
// ・画面ごとに書かない。ゲームを足しても、ここを呼ぶだけで同じ形になる（落とし穴1）
// ・演出の長さは cfg.ms（＝index.html の fxMs）を通す。「なし」で 0 になる。
//   ただし **長押しの 0.45 秒と 3・2・1 は速さの設定で変えない**（押す人の手の時間・合図の時間）
// ・名前は必ず esc してから組む。絵文字の差し替えは index.html の全体の見張りがやる
// ・TV には押すものを置かない（この部品は TV に押すものを作らない）

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./v2-art.js'), require('./budoux-ja.js') && globalThis.BudouxJa);
  else root.V2 = factory(root.V2Art, root.BudouxJa);
}(typeof self !== 'undefined' ? self : this, function (Art, Budoux) {
  'use strict';

  var cfg = {
    doc: null,
    ms: function (n) { return n; },     // 演出の速さ（fxMs）
    logo: 'img/logo-aresore-v2.png'     // あれそれどれこれの印（絵ではなく題字）
  };
  function init(o) {
    o = o || {};
    if (o.doc) cfg.doc = o.doc;
    if (typeof o.ms === 'function') cfg.ms = o.ms;
    if (o.logo) cfg.logo = o.logo;
    wire();
  }
  function D() { return cfg.doc || (typeof document !== 'undefined' ? document : null); }

  /** 世界の名前（CSS の .v2-w-◯◯）。'wait' は待合と共通の画面の黄色 */
  var WORLDS = ['wait', 'aresore', 'sugoroku', 'shinka', 'wolf', 'bomb', 'quiz', 'auction', 'falsetrue', 'rcard'];
  /** 明るい世界（地が明るく字が暗い）。暗い世界とは、カード・線・帯の作り方が変わる */
  var LIGHT = { wait: 1, aresore: 1, sugoroku: 1, shinka: 1 };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------- 絵 ----------
  /** アイコン。箱（.v2-ic）と絵（svg）は同じ大きさにする——見本のずれの原因は、箱 1em と絵 20px の差だった */
  function icon(name, cls) {
    return '<i class="v2-ic' + (cls ? ' ' + cls : '') + '" data-ic="' + esc(name) + '">' + (Art ? Art.icon(name) : '') + '</i>';
  }
  /** ゲームの印。あれそれどれこれだけは題字の画像 */
  function emblem(world) {
    if (world === 'aresore') return '<img class="v2-logo" src="' + esc(cfg.logo) + '" alt="あれそれどれこれ" draggable="false">';
    return Art ? Art.emblem(world) : '';
  }
  /** 印の札（世界の色の角丸＋印） */
  function tile(world, cls) {
    return '<span class="v2-tile v2-w-' + esc(world) + (cls ? ' ' + cls : '') + '"><span class="v2-emb">' + emblem(world) + '</span></span>';
  }

  // ---------- 字 ----------
  /** 数字を1桁ずつ同じ幅の箱に入れる（数が変わっても横にずれない） */
  // data-overlapok：数字は1字ずつ幅 .56em の箱に詰める。字の箱の左右の余白だけが隣と重なり、字は重ならない（物差しの K1 に数えない・指示68-0b）
  function digits(n) {
    return String(n).split('').map(function (d) { return /[0-9]/.test(d) ? '<i data-overlapok>' + d + '</i>' : esc(d); }).join('');
  }
  /** 長い文を文節（BudouX）で切り、切れ目にだけ <wbr> を入れる。字は esc 済み */
  // 決まった文の改行の印（\n）は、そこで必ず折る（見出しの「いっしょに／あそぼう！」のように、文節では切れない所・指示66-2）
  function phrase(text) {
    return String(text == null ? '' : text).split('\n').map(function (s) {
      var parts = (Budoux && Budoux.parse) ? Budoux.parse(s) : [s];
      return parts.map(esc).join('<wbr>');
    }).join('<br>');
  }
  /** 文節で折る字の箱（ルールの文・見出しなど）。描いたあと fixWraps が「1〜2文字だけの行」を直す */
  function wrapHtml(text, cls) { return '<span class="' + esc(cls || '') + '" data-v2-wrap>' + phrase(text) + '</span>'; }
  /** その箱の字を、見えている行ごとに数える（記号は数えない） */
  var SOFT = /[\s、。，．・…！？!?「」『』（）()\[\]〜~]/g;
  function rowsOf(el) {
    var d = D(), rows = [], w = d.createTreeWalker(el, 4 /* 字 */), n;
    while ((n = w.nextNode())) {
      var t = n.nodeValue;
      for (var i = 0; i < t.length; i++) {
        if (!t[i].trim()) continue;
        var rg = d.createRange(); rg.setStart(n, i); rg.setEnd(n, i + 1);
        var b = rg.getClientRects()[0]; if (!b || !b.width) continue;
        var row = null;
        for (var k = 0; k < rows.length; k++) if (Math.abs(rows[k].top - b.top) < b.height * 0.5) { row = rows[k]; break; }
        if (!row) { row = { top: b.top, s: '' }; rows.push(row); }
        row.s += t[i];
      }
    }
    rows.sort(function (a, b) { return a.top - b.top; });
    return rows.map(function (r) { return r.s; });
  }
  /**
   * **1〜2文字だけの行は作らない**（指示66-1「改行」3）。
   * 最後の行が記号を除いて2文字以下なら、いちばん後ろの文節の切れ目（<wbr>）を1つ消して、
   * 前の文節ごと次の行へ送る（「コードを全部切ればみんなの／勝ち」→「コードを全部切れば／みんなの勝ち」）。
   * 切れ目を消しきっても直らなければ、字を少し小さくする（9割まで）
   */
  function fixWraps(scope) {
    var d = D(); if (!d) return;
    var list = (scope || d).querySelectorAll('[data-v2-wrap]');
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (!el.getClientRects().length) continue;   // 見えていないものは測れない
      for (var guard = 0; guard < 12; guard++) {
        var rows = rowsOf(el);
        if (rows.length < 2 || rows[rows.length - 1].replace(SOFT, '').length > 2) break;
        var w = el.querySelectorAll('wbr');
        if (w.length) { w[w.length - 1].remove(); continue; }
        var fs = parseFloat(getComputedStyle(el).fontSize), base = +el.getAttribute('data-v2-fs0') || fs;
        el.setAttribute('data-v2-fs0', base);
        if (fs <= base * 0.9) break;
        el.style.fontSize = Math.max(base * 0.9, fs - 0.5) + 'px';
      }
    }
  }
  /**
   * 1行に入れたい字（名前など）：入らない時だけ字を小さくする。7割より小さくはしない。
   * 7割でも入らなければ、そのまま（「…」で省くかは、その部品が .v2-cut で決める）
   */
  function fit(scope) {
    var d = D(); if (!d) return;
    var list = (scope || d).querySelectorAll('[data-v2-fit]');
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      // 測る間は移り変わりを止める（指示68-0b B14）。演出「なし」は全部の要素に 0.001秒の移り変わりを付けるので、
      // 字の大きさを変えてすぐ測ると前の大きさのまま測れる——縮めた名前を「入った」と取りちがえて元の大きさにもどし、「…」で切れていた
      // 見えていない（測れない）ものは、字の大きさをもどすだけで触らない。むだに style を書きかえない
      //（書きかえるたびに計算し直しになる。tests の jsdom では全部の CSS を数え直すので、rt-screens が 2.6倍遅くなった）
      if (!el.clientWidth) { if (el.style.fontSize) el.style.fontSize = ''; continue; }
      // 移り変わりを止めるのは、演出「なし」（0.001秒の移り変わり）の時だけ
      var still = d.documentElement.classList.contains('fx-skip');
      if (still) el.style.setProperty('transition', 'none', 'important');
      if (el.style.fontSize) el.style.fontSize = '';
      // 下限は7割。data-v2-fit に数（px）があれば、それより小さくはしない（TV の字の下限 42px など）
      var fs = parseFloat(getComputedStyle(el).fontSize), min = Math.max(fs * 0.7, +el.getAttribute('data-v2-fit') || 0), n = 0;
      // 1px でもはみ出せば「…」が出るので、ゆるみは持たない（測る側の「…で切れている」と同じ決まり・指示68-0b）
      while (el.scrollWidth > el.clientWidth && fs > min && n++ < 80) { fs = Math.max(min, fs - 0.5); el.style.fontSize = fs + 'px'; }
      if (still) { void el.offsetWidth; el.style.removeProperty('transition'); }
    }
  }

  // ---------- のこり時間 ----------
  // 画面にいくつ出ていても、時計は1つ。締め切り（data-end：時刻のミリ秒）から毎回数え直す。
  // 5秒以下は赤い札に白い数字。**札の大きさはふだんから取っておく**（切りかわっても字が動かない）
  var clockOffset = 0, frozen = null, timer = null;
  function now() { return Date.now() + clockOffset; }
  /** サーバーとの時計のずれ（ミリ秒）。部屋の知らせから合わせる */
  function setClockOffset(ms) { clockOffset = +ms || 0; tick(); }
  /** 撮る時だけ：のこり時間を決まった数で止める（null で解く）。本番では呼ばない */
  function freeze(sec) { frozen = (sec == null ? null : +sec); tick(); }
  function secLeft(el) {
    if (frozen != null) return frozen;
    var end = +el.getAttribute('data-end');
    return Math.max(0, Math.ceil((end - now()) / 1000));
  }
  /**
   * のこり時間の部品。opts: { end, label（既定は UiText.V2.のこり）, unit（既定は UiText.V2.秒）, lo=5, tv }
   * label・unit は空でもよい（空なら出さない）
   */
  function cd(opts) {
    var o = opts || {};
    var label = o.label == null ? T('のこり') : o.label, unit = o.unit == null ? T('秒') : o.unit;
    // mmss：遊んでいる間の時計（02:27）。見出しも単位も付けず、数字の箱だけ（指示66-2 F11）
    return '<span class="v2-cd' + (o.tv ? ' is-tv' : '') + (o.mmss ? ' is-mmss' : '') + '" data-v2-cd data-end="' + (+o.end || 0) + '" data-lo="' + (o.lo == null ? 5 : o.lo) + '"' + (o.mmss ? ' data-mmss' : '') + '>' +
      (label ? '<span class="v2-cd-l">' + esc(label) + '</span>' : '') +
      '<b class="v2-cd-n"></b>' +
      (unit ? '<span class="v2-cd-u">' + esc(unit) + '</span>' : '') + '</span>';
  }
  function renderCd(el) {
    var sec = secLeft(el);
    if (el.__v2sec === sec) return;
    el.__v2sec = sec;
    var lo = +el.getAttribute('data-lo');
    var n = el.querySelector('.v2-cd-n');
    if (n) n.innerHTML = el.hasAttribute('data-mmss') ? digits(('0' + Math.floor(sec / 60)).slice(-2)) + ':' + digits(('0' + (sec % 60)).slice(-2)) : digits(sec);
    el.classList.toggle('is-lo', sec <= lo);
    el.classList.toggle('is-one', sec < 10);
    // 5秒以下は、数が変わるたびに1回だけ弾む（演出「なし」では CSS が止める）
    if (sec <= lo && n) { n.classList.remove('is-tick'); void n.offsetWidth; n.classList.add('is-tick'); }
  }
  function tick() {
    var d = D(); if (!d) return;
    var list = d.querySelectorAll('[data-v2-cd]');
    for (var i = 0; i < list.length; i++) renderCd(list[i]);
    if (!list.length && timer) { clearInterval(timer); timer = null; }
  }
  /** 描いたあとに呼ぶ。のこり時間があれば、すぐ描いて時計を回す */
  function mount(scope) {
    var d = D(); if (!d) return;
    var list = (scope || d).querySelectorAll('[data-v2-cd]');
    for (var i = 0; i < list.length; i++) { list[i].__v2sec = null; renderCd(list[i]); }
    if (list.length && !timer) timer = setInterval(tick, 200);
    relayout(scope);
  }
  /** 字の形が届いた時・画面の大きさが変わった時にも呼ぶ（名前の縮め・短い行の直し） */
  function relayout(scope) { fit(scope); fixWraps(scope); }

  // ---------- 重なり（シート・まん中の確認・帯の上から出るもの・知らせ） ----------
  // 置き場は **その画面の箱のすぐ下**（.v2-scr / .v2-tvc の子）。画面は画面の高さちょうどで巻かないので、
  // position:absolute のまま画面に貼り付く（#app の filter の影響を受けない・落とし穴26）
  function scrOf(el) { return el && el.closest ? el.closest('.v2-scr,.v2-tvc') : null; }
  function find(scr, sel) {
    if (!sel) return null;
    if (sel.charAt(0) === '#') return (scr && scr.querySelector('[data-v2-id="' + sel.slice(1) + '"]')) || D().getElementById(sel.slice(1));
    return scr ? scr.querySelector(sel) : D().querySelector(sel);
  }
  function scrimOf(layer) {
    var scr = scrOf(layer); if (!scr) return null;
    var want = layer.classList.contains('v2-dlg') ? '.v2-scrim.is-dlg' : '.v2-scrim:not(.is-dlg)';
    return scr.querySelector(':scope > ' + want);
  }
  function open(layer) {
    if (!layer) return;
    layer.classList.add('is-open');
    layer.setAttribute('aria-hidden', 'false');
    if (layer.matches('.v2-sheet,.v2-dlg')) { var s = scrimOf(layer); if (s) s.classList.add('is-open'); }
  }
  function close(layer) {
    if (!layer) return;
    layer.classList.remove('is-open');
    layer.setAttribute('aria-hidden', 'true');
    if (layer.matches('.v2-sheet,.v2-dlg')) {
      var s = scrimOf(layer);
      // 同じ幕を使う別のシートが開いていたら、幕は残す
      if (s && !scrOf(layer).querySelector(':scope > .is-open' + (layer.classList.contains('v2-dlg') ? '.v2-dlg' : '.v2-sheet'))) s.classList.remove('is-open');
    }
  }
  /** いちばん上に開いている重なり（「もどる」で先に閉じるもの・正本 §8） */
  function topLayer(scr) {
    var d = D(); var s = scr || d;
    var all = s.querySelectorAll('.v2-dlg.is-open, .v2-sheet.is-open, .v2-pop.is-open');
    return all.length ? all[all.length - 1] : null;
  }
  /**
   * 開いている重なりを1つ閉じたら true（index.html の「もどる」と ESC がまずこれを呼ぶ・正本 §8）。
   * 確認の枠（data-v2-keep）は押し間違いで消えると困るので、ここでは閉じない
   */
  function closeTop(scr) { var t = topLayer(scr); if (!t || t.hasAttribute('data-v2-keep')) return false; close(t); return true; }
  /**
   * 知らせを出して、読む時間がたったら閉じる。**読む時間は速さの設定で縮めない**
   * （「なし」でも字は読めるだけ出す。縮むのは出入りの動きだけ・FxKit.notice と同じ考え）
   */
  function show(layer, ms) {
    if (!layer) return;
    open(layer);
    clearTimeout(layer.__v2t);
    layer.__v2t = setTimeout(function () { close(layer); }, ms || 2900);
  }

  // ---------- 長押し（0.45秒。速さの設定ではかわらない：押す人の手の時間） ----------
  var LP_MS = 450;
  var lp = null, lpFired = false;
  function lpCancel() { if (!lp) return; clearTimeout(lp.t); if (lp.ring) lp.ring.classList.remove('is-on'); lp = null; }
  function lpStart(e) {
    var el = e.target.closest && e.target.closest('[data-v2-lp]'); if (!el) return;
    var scr = scrOf(el); if (!scr) return;
    var ring = scr.querySelector(':scope > .v2-lpring');
    if (!ring) {
      ring = D().createElement('div'); ring.className = 'v2-lpring'; ring.setAttribute('aria-hidden', 'true');
      ring.innerHTML = '<svg viewBox="0 0 56 56"><circle class="v2-lp-base" cx="28" cy="28" r="24"/><circle class="v2-lp-run" cx="28" cy="28" r="24" transform="rotate(-90 28 28)"/></svg>';
      scr.appendChild(ring);
    }
    var r = scr.getBoundingClientRect(), k = (r.width / scr.offsetWidth) || 1;
    ring.style.left = ((e.clientX - r.left) / k) + 'px';
    ring.style.top = ((e.clientY - r.top) / k - 34) + 'px';
    ring.classList.remove('is-on'); void ring.offsetWidth; ring.classList.add('is-on');
    lp = { el: el, x: e.clientX, y: e.clientY, ring: ring, t: setTimeout(function () {
      ring.classList.remove('is-on'); lpFired = true;
      var target = find(scr, el.getAttribute('data-v2-lp'));
      el.dispatchEvent(new CustomEvent('v2:longpress', { bubbles: true, detail: { target: target } }));
      if (target) open(target);
      lp = null;
      setTimeout(function () { lpFired = false; }, 600);
    }, LP_MS) };
  }

  var wired = false;
  function wire() {
    var d = D(); if (!d || wired) return; wired = true;
    d.addEventListener('click', function (e) {
      var el = e.target.closest && e.target.closest('[data-v2-open],[data-v2-close],.v2-scrim');
      if (!el) return;
      if (lpFired) { lpFired = false; e.preventDefault(); return; }
      var scr = scrOf(el);
      if (el.classList.contains('v2-scrim')) {
        // 幕を押したら、その幕を使っている重なりを閉じる（確認の幕は閉じない：押し間違いで消えると困る）
        var top = topLayer(scr);
        if (top && !top.hasAttribute('data-v2-keep')) close(top);
        return;
      }
      if (el.hasAttribute('data-v2-open')) open(find(scr, el.getAttribute('data-v2-open')));
      if (el.hasAttribute('data-v2-close')) {
        var v = el.getAttribute('data-v2-close');
        close(v ? find(scr, v) : el.closest('.v2-sheet,.v2-dlg,.v2-pop,.v2-toast'));
      }
    });
    // ESC と「もどる」は index.html の closeTopLayer が V2.closeTop を呼ぶ（キーの見張りを2つにしない）
    d.addEventListener('pointerdown', lpStart);
    d.addEventListener('pointerup', lpCancel);
    d.addEventListener('pointercancel', lpCancel);
    d.addEventListener('pointermove', function (e) { if (lp && (Math.abs(e.clientX - lp.x) > 10 || Math.abs(e.clientY - lp.y) > 10)) lpCancel(); });
    d.addEventListener('contextmenu', function (e) { if (e.target.closest && e.target.closest('[data-v2-lp]')) e.preventDefault(); });
  }

  // ---------- 名前の壁（遊ぶ人の名前が、ゆっくり流れる） ----------
  /** 名前の壁の中身を作る。rows 段。名前は esc 済みで入る */
  function nameWallHtml(names, rows) {
    var list = (names || []).filter(Boolean);
    if (!list.length) return '';
    // 段は、画面の下の端まで全面が埋まるだけ（13段では TV の下・右下が空いていた。くり返すので名前が少なくても埋まる・指示68-0b）
    var n = rows || 30, html = '';
    for (var r = 0; r < n; r++) {
      var k = r % list.length, rot = list.slice(k).concat(list.slice(0, k));
      var seg = rot.join(' / ') + ' / ';
      var rep = new Array(Math.max(3, Math.ceil(60 / seg.length)) + 1).join(seg);
      html += '<div class="v2-nr">' + esc(rep + rep) + '</div>';
    }
    return html;
  }
  /**
   * 入ってきた人の名前を、壁の中で1つ金色に光らせる（人数や QR の上に知らせを重ねない）。
   * 画面のまん中寄りにある、その名前を選ぶ。光るのは 2.6 秒（演出の速さに従う。「なし」では光らせない）
   */
  function glow(wall, name) {
    if (!wall || !name) return false;
    var ms = cfg.ms(2600); if (!(ms > 0)) return false;
    var scr = scrOf(wall) || wall, wr = scr.getBoundingClientRect();
    var rows = wall.querySelectorAll('.v2-nr'); if (!rows.length) return false;
    var best = null, bd = 1e12;
    // 全部の段から探す（段の数は画面の大きさで見えている範囲が変わる。決まった3段だと画面の外の段を選んでいた・指示68-0b）
    Array.prototype.forEach.call(rows, function (row) {
      var rr = row.getBoundingClientRect(); if (rr.bottom < wr.top || rr.top > wr.bottom) return;
      if (row.childNodes.length !== 1 || row.firstChild.nodeType !== 3) row.textContent = row.textContent;
      var tn = row.firstChild, txt = tn.nodeValue, i = -1;
      while ((i = txt.indexOf(name, i + 1)) >= 0) {
        var rg = D().createRange(); rg.setStart(tn, i); rg.setEnd(tn, i + name.length);
        var b = rg.getBoundingClientRect();
        if (!(b.left > wr.left && b.right < wr.right && b.top > wr.top && b.bottom < wr.bottom)) continue;
        var dx = b.left + b.width / 2 - (wr.left + wr.width * 0.55), dy = b.top + b.height / 2 - (wr.top + wr.height * 0.45);
        var dd = dx * dx + dy * dy; if (dd < bd) { bd = dd; best = { row: row, i: i }; }
      }
    });
    if (!best) return false;
    var row = best.row, t = row.textContent;
    row.textContent = '';
    row.appendChild(D().createTextNode(t.slice(0, best.i)));
    var sp = D().createElement('span'); sp.className = 'v2-glow'; sp.textContent = name; row.appendChild(sp);
    row.appendChild(D().createTextNode(t.slice(best.i + name.length)));
    setTimeout(function () { row.textContent = t; }, ms + 100);
    return true;
  }

  // ---------- 部品の組み立て（字は呼ぶ側が渡す。部品は字を持たない） ----------
  function T(k) { var U = (typeof UiText !== 'undefined') ? UiText : null; return (U && U.V2 && U.V2[k]) || ''; }
  /** 背景の層：ゆっくり動く丸と、名前の壁（names を渡した時だけ） */
  function bgHtml(o) {
    o = o || {};
    return '<div class="v2-bg" aria-hidden="true"><div class="v2-circles"><i></i><i></i><i></i></div>' +
      (o.names && o.names.length ? '<div class="v2-wall">' + nameWallHtml(o.names, o.rows) + '</div>' : '') + '</div>';
  }
  /** 右の縦の字（スマホ／TV） */
  function brandHtml(tv) { return '<div class="' + (tv ? 'v2-tbrand' : 'v2-brand') + '" aria-hidden="true">ATSUMARE AREKORE.</div>'; }
  /** 見出し：小さな英字＋大きな日本語（文節で折る）＋長い矢印 */
  function hdHtml(en, ttl, tv) {
    // クラス名は継ぎ足しで組まない（tests/dead-style.js と tests/v2.js が名前そのもので照らす）
    return tv
      ? '<div class="v2-thd"><div class="v2-thd-en">' + esc(en) + '</div><div class="v2-thd-ttl" data-v2-wrap>' + phrase(ttl) + '</div><div class="v2-arrow"></div></div>'
      : '<div class="v2-hd"><div class="v2-hd-en">' + esc(en) + '</div><div class="v2-hd-ttl" data-v2-wrap>' + phrase(ttl) + '</div><div class="v2-arrow"></div></div>';
  }
  /** 右上の丸ボタン。who＝いる人の数（押すと名簿）、gear＝設定 */
  function cornerHtml(o) {
    o = o || {};
    var h = '<div class="v2-corner is-r">';
    if (o.who != null) h += '<button type="button" class="v2-cbtn is-who" aria-label="' + esc(T('いる人')) + '"' + (o.whoOpen ? ' data-v2-open="' + esc(o.whoOpen) + '"' : '') +
      '><span class="v2-ring">' + icon('people') + '<span>' + esc(o.who) + '</span></span></button>';
    h += '<button type="button" class="v2-cbtn is-gear" aria-label="' + esc(T('設定')) + '" data-v2-act="gear"><span class="v2-ring">' + icon('gear') + '</span></button>';
    return h + '</div>';
  }
  /** 顔（アイコンの絵文字）。絵文字は全体の見張りが SVG に差し替える */
  function avHtml(face, cls) { return '<span class="v2-av' + (cls ? ' ' + cls : '') + '">' + esc(face || '🙂') + '</span>'; }
  /** 自分の札（大きく）。名前は入らない時だけ小さく（7割まで） */
  function meHtml(m) {
    return '<div class="v2-me">' + avHtml(m.icon, 'is-lg') + '<div class="v2-me-who"><div class="v2-me-nm v2-cut" data-v2-fit>' + esc(m.name) + '</div>' +
      (m.title ? '<div class="v2-me-tt v2-cut">' + esc(m.title) + '</div>' : '') + '</div><span class="v2-you">' + esc(T('あなた')) + '</span></div>';
  }
  /** 下の帯。cells：[{lab, msg}]、end：右の端（のこり時間など） */
  function bandHtml(o) {
    o = o || {};
    return '<div class="v2-band"><div class="v2-band-what"><span class="v2-band-lab">' + esc(o.lab) + '</span><span class="v2-band-msg v2-cut">' + esc(o.msg) + '</span></div>' +
      (o.end ? '<div class="v2-band-end">' + o.end + '</div>' : '') + '</div>';
  }
  /** 帯の上から出る知らせ（id で開く・閉じる） */
  function toastHtml(id, face, tt, ts) {
    return '<div class="v2-toast" data-v2-id="' + esc(id) + '" aria-hidden="true" role="status">' + avHtml(face) +
      '<div class="v2-toast-who"><div class="v2-toast-tt">' + esc(tt) + '</div>' + (ts ? '<div class="v2-toast-ts">' + esc(ts) + '</div>' : '') + '</div></div>';
  }
  /** うしろの幕（シート用・確認用の2枚。画面の箱のすぐ下に置く） */
  function scrimHtml(dlg) { return '<div class="v2-scrim' + (dlg ? ' is-dlg' : '') + '" aria-hidden="true"></div>'; }
  /** 下から出るシート。tall＝9割。body・foot は組み立て済みの HTML */
  function sheetHtml(o) {
    return '<div class="v2-sheet' + (o.tall ? ' is-tall' : '') + (o.cls ? ' ' + o.cls : '') + '" data-v2-id="' + esc(o.id) + '" aria-hidden="true" role="dialog">' +
      (o.head != null ? o.head : '<div class="v2-grab"></div><div class="v2-sh"><div class="v2-sh-ttl">' + esc(o.title) + '</div>' + xHtml() + '</div>') +
      '<div class="v2-sbody">' + (o.body || '') + '</div>' + (o.foot ? '<div class="v2-sfoot">' + o.foot + '</div>' : '') + '</div>';
  }
  function xHtml() { return '<button type="button" class="v2-x" data-v2-close aria-label="' + esc((typeof UiText !== 'undefined' && UiText.WORDS && UiText.WORDS.close) || '') + '">' + icon('close') + '</button>'; }
  /** まん中のたずねる枠。btns：[{label, pri, act}] */
  function dlgHtml(o) {
    return '<div class="v2-dlg" data-v2-id="' + esc(o.id) + '" aria-hidden="true" role="alertdialog"' + (o.keep ? ' data-v2-keep' : '') + '><div class="v2-dlg-ttl">' + esc(o.title) + '</div>' +
      (o.text ? '<div class="v2-dlg-txt">' + esc(o.text) + '</div>' : '') +
      (o.btns || []).map(function (b) { return '<button type="button" class="v2-btn ' + (b.pri ? 'is-pri' : 'is-sec') + '"' + (b.act ? ' data-v2-act="' + esc(b.act) + '"' : ' data-v2-close') + '>' + esc(b.label) + '</button>'; }).join('') + '</div>';
  }
  /** ルールの札（いつも3つ）。rules：[[絵文字, 文], …]（MODES[].tv をそのまま渡す） */
  function rulesHtml(rules) {
    return '<div class="v2-rules">' + (rules || []).slice(0, 3).map(function (r, i) {
      return '<div class="v2-rule"><span class="v2-rule-k"><span>' + (i + 1) + '</span></span><span class="v2-rule-ri">' + esc(r[0]) + '</span><span class="v2-rule-t" data-v2-wrap>' + phrase(r[1]) + '</span></div>';
    }).join('') + '</div>';
  }
  /** ルールのシートの中身：番号つきで大きく3つ */
  function rulesBigHtml(rules) {
    return '<div class="v2-rbig">' + (rules || []).slice(0, 3).map(function (r, i) {
      return '<div class="v2-rb"><span class="v2-rb-k"><span>' + (i + 1) + '</span></span><span class="v2-rb-t" data-v2-wrap>' + phrase(r[1]) + '</span></div>';
    }).join('') + '</div>';
  }
  /** ルールのシートの頭：上はゲームの世界の色 */
  function rheadHtml(world, name, meta) {
    return '<div class="v2-rhead v2-w-' + esc(world) + '">' + tile(world) + '<div class="v2-rhead-who"><div class="v2-rn">' + esc(name) + '</div>' +
      (meta ? '<div class="v2-rm">' + esc(meta) + '</div>' : '') + '</div>' + xHtml() + '</div>';
  }
  /** 名簿の1人分（シートの中） */
  function rowHtml(m, st, me) {
    return '<div class="v2-rrow' + (me ? ' is-me' : '') + '">' + avHtml(m.icon) + '<div class="v2-rrow-who"><div class="v2-rrow-nm v2-cut">' + esc(m.name) + '</div>' +
      (m.title ? '<div class="v2-rrow-tt v2-cut">' + esc(m.title) + '</div>' : '') + '</div>' + (st ? '<span class="v2-rrow-st">' + esc(st) + '</span>' : '') + '</div>';
  }
  /** TVの名前の札。two＝二つ名つき（2段）、sm＝小さい札（9人から） */
  function tmemHtml(m, o) {
    o = o || {};
    return '<div class="v2-tmem' + (o.two ? ' is-two' : '') + (o.sm ? ' is-sm' : '') + '">' + avHtml(m.icon) +
      '<div class="v2-tmem-who"><div class="v2-tmem-nm v2-cut" data-v2-fit="42">' + esc(m.name) + '</div>' +
      (o.two && m.title ? '<div class="v2-tmem-tt v2-cut">' + esc(m.title) + '</div>' : '') + '</div></div>';
  }
  /** TVの下の帯。cells：[{lab, en, val, valEn, num, small, grow, html}]（間に斜めの線） */
  function tbandHtml(cells, end) {
    var h = '<div class="v2-tband">';
    (cells || []).forEach(function (c, i) {
      if (i) h += '<div class="v2-tslash"></div>';
      h += '<div class="v2-tcell' + (c.grow ? ' is-grow' : '') + '"><span class="v2-tlab' + (c.en ? ' v2-en' : '') + '">' + esc(c.lab) + '</span>';
      if (c.num != null) h += '<span class="v2-tnum v2-num">' + digits(c.num) + (c.small ? '<small>' + esc(c.small) + '</small>' : '') + '</span>';
      else h += '<span class="v2-tval v2-cut' + (c.valEn ? ' v2-en' : '') + '">' + esc(c.val) + '</span>';
      h += '</div>';
    });
    if (end) h += '<div class="v2-tslash"></div><div class="v2-band-end">' + end + '</div>';
    return h + '</div>';
  }

  // ---------- TV：1920×1080 で組んで、画面に合わせて縮める ----------
  // TV の大きさは会場ごとに違う（1280×720 のノート・1920×1080 の TV）。
  // 1920×1080 の見本と同じ並びのまま、画面に入る大きさにする（16:9 でない画面は、上下か左右に世界の色が残る）
  // inset：TVの端あわせ（指示66-2・F6）。TVによってはふちが切れて映るので、係のえらんだ%だけ内側に縮める
  function fitTv(outer, inset) {
    if (!outer) return;
    var c = outer.querySelector(':scope > .v2-tvc'); if (!c) return;
    var W = outer.clientWidth, H = outer.clientHeight; if (!W || !H) return;
    var p = Math.max(0, Math.min(10, +inset || 0)) / 100;
    var k = Math.min(W * (1 - 2 * p) / 1920, H * (1 - 2 * p) / 1080);
    c.style.transform = 'translate(' + ((W - 1920 * k) / 2) + 'px,' + ((H - 1080 * k) / 2) + 'px) scale(' + k + ')';
  }

  return {
    WORLDS: WORLDS, LIGHT: LIGHT, LP_MS: LP_MS,
    init: init, esc: esc, icon: icon, emblem: emblem, tile: tile,
    digits: digits, phrase: phrase, fit: fit, wrapHtml: wrapHtml, fixWraps: fixWraps, rowsOf: rowsOf, relayout: relayout,
    now: now, setClockOffset: setClockOffset, freeze: freeze, cd: cd, mount: mount, tick: tick,
    open: open, close: close, closeTop: closeTop, topLayer: topLayer, show: show,
    nameWallHtml: nameWallHtml, glow: glow, fitTv: fitTv,
    bgHtml: bgHtml, brandHtml: brandHtml, hdHtml: hdHtml, cornerHtml: cornerHtml, avHtml: avHtml, meHtml: meHtml,
    bandHtml: bandHtml, toastHtml: toastHtml, scrimHtml: scrimHtml, sheetHtml: sheetHtml, xHtml: xHtml, dlgHtml: dlgHtml,
    rulesHtml: rulesHtml, rulesBigHtml: rulesBigHtml, rheadHtml: rheadHtml, rowHtml: rowHtml,
    tmemHtml: tmemHtml, tbandHtml: tbandHtml
  };
}));
