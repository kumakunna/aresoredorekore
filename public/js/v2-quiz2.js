// public/js/v2-quiz2.js — クイズ王2.0「みんなで早答え」「数字ちかい方」の画面（指示68-5・新しい見た目）
//
// 描き方は index.html の v2GameRender（V2GAMES）が受け持つ。ここは「知らせ（view）→ HTML」だけ。
// 上の行・答えの札・玉・名前の札は みんなと同じ（v2-onaji.js）の物を、数直線・札・冠は ぴったり10秒（v2-pittari.js）の物を使う。
// 見せ場の秒は、画面と音（index.html の qhayaFx・qnearFx）で同じ timeline を使う。
//
// **秘密**：正解は開いたあとの reveal にしか無い（届いていない物からは描けない）。まちがえた人の名前は出さない（責めない）
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.V2Quiz2 = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function T() { return (typeof UiText !== 'undefined' && UiText.QUIZ2) || {}; }
  function K() { return (typeof V2 !== 'undefined') ? V2 : null; }
  function F() { return (typeof V2Fes !== 'undefined') ? V2Fes : null; }
  function e(s) { return K().esc(s); }
  var KEYS = 'ABCD';
  var ss = function (sec) { return 'calc(' + sec.toFixed(2) + 's * var(--fx-scale))'; };

  function isPlayer(view) {
    var d = view.data || {};
    return (d.players || []).some(function (p) { return p.id === view.meId; });
  }
  /** 上の行：何問目・遊び方・のこり時間（みんなと同じの上の行の札を使う） */
  function topRow(view, tv, mode) {
    var d = view.data || {}, V = K(), t = T();
    var answering = d.phase === 'choose' || d.phase === 'guess';
    var clock = answering && view.end ? (tv ? V.cd({ end: view.end, mmss: true, label: '', unit: '' }) : V.cd({ end: view.end, label: '', unit: t.秒 })) : '';
    return '<div class="v2-otop"><span class="v2-opill"><b class="v2-num">' + V.digits(d.round || 1) + '</b><small>/' + V.digits(d.total || 10) + '</small>' + e(t.問目) + '</span>' +
      // 遊び方の名前と層は TV だけ（スマホの細い幅では行が折れる）
      (tv ? '<span class="v2-omode">' + e(mode === 'near' ? t.ちかい : t.早答え) + (d.tier && mode !== 'near' ? '・' + e((t.層 || {})[d.tier] || '') : '') + '</span>' : '') +
      '<span class="v2-oclock">' + clock + '</span></div>';
  }
  /** 答えている間の帯（のこり時間でちぢむ・のこり3秒で赤い縁）。描き直しても、いまの長さから続ける */
  function barHtml(view, sec) {
    var d = view.data || {};
    var rem = Math.max(0, d.remainingMs == null ? sec * 1000 : (view.end ? view.end - Date.now() : d.remainingMs));
    var from = Math.min(1, rem / (sec * 1000));
    return '<div class="v2-q2bar"><i style="--from:' + from.toFixed(3) + ';animation-duration:' + Math.round(rem) + 'ms"></i>' +
      '<b style="animation-delay:' + Math.max(0, Math.round(rem - 3000)) + 'ms"></b></div>';
  }
  /** だれかが答えるたびに、札のまわりに光の粒が1つともる（だれが何を押したかは出さない） */
  function sparkHtml(n) {
    var s = '';
    for (var i = 0; i < n; i++) s += '<i style="--a:' + ((i * 137.5) % 360).toFixed(1) + 'deg"></i>';
    return '<div class="v2-q2spark" aria-hidden="true">' + s + '</div>';
  }
  function endButtons(view) {
    if (view.fesRoom) return '';
    var t = T();
    return '<div class="v2-spacer"></div>' + (view.host
      ? '<button type="button" class="v2-btn is-pri" data-v2game-act="again">' + e(t.つぎは) + '</button>' +
        '<button type="button" class="v2-btn is-sec" data-v2game-act="end">' + e(t.とじる) + '</button>'
      : '<p class="v2-note v2-c">' + e(t.進行役が) + '</p>') +
      '<button type="button" class="v2-btn is-sec" data-v2game-act="leave">' + e(t.出る) + '</button>';
  }
  /** 結果（スマホ・TV・文化祭の結果で同じ物）：順位と、ほめる札 */
  function resultBody(view, tv, o, mode) {
    var d = view.data || {}, res = d.result || {}, V = K(), t = T();
    var head = o && o.noHead ? '' : V.hdHtml('Result!', t.結果, tv);
    var 札 = mode === 'near' ? [t.ぴったりの人, res.perfect || []] : [t.早い人, res.fastestMost || []];
    var aws = 札[1].length ? '<div class="v2-oaws"><div class="v2-oaw"><span class="v2-oaw-t">' + e(札[0]) + '</span><span class="v2-oaw-n" data-v2-wrap>' +
      V.phrase(札[1].slice(0, 6).join('・') + (札[1].length > 6 ? t.ほか + (札[1].length - 6) + t.人 : '')) + '</span></div></div>' : '';
    var rk = res.ranking || [];
    var me = rk.filter(function (x) { return x.id === view.meId; })[0];
    return head +
      (me && !tv ? '<div class="v2-minebox"><span>' + e(t.あなたの点) + '</span><b>' + V.digits(me.score) + '<small>' + e(t.点) + '</small></b></div>' : '') + aws +
      '<div class="v2-ranks v2-oranks' + (rk.length > 8 && tv ? ' is-c2' : '') + '">' + rk.map(function (x) {
        return '<div class="v2-rk' + (x.id === view.meId ? ' is-me' : '') + '"><span class="v2-rk-n v2-num">' + V.digits(x.rank) + '</span>' +
          '<span class="v2-rk-nm v2-cut">' + e(x.name) + '</span><span class="v2-rk-x">' + V.digits(x.score) + e(t.点) + '</span></div>';
      }).join('') + '</div>';
  }
  /**
   * 1位の発表（TV・最後）：照明が落ちる → ドラムロール1.5秒 → スポットライトが1人に → 名前が大きく・紙ふぶき（点滅しない）→ 順位
   */
  function champHtml(view, mode) {
    var d = view.data || {}, res = d.result || {}, t = T(), V = K();
    var who = (res.champion || []).join('・');
    var 粒 = '';
    for (var i = 0; i < 30; i++) 粒 += '<i class="v2-q2conf" style="left:' + ((i * 37) % 100) + '%;--c:' + ['#FFD84A', '#7FE7F2', '#F28AA8', '#FFFFFF'][i % 4] +
      ';animation-delay:' + ss(1.6 + (i % 10) * 0.05) + '"></i>';
    return '<div class="v2-q2champ"><i class="v2-q2c-dim"></i><i class="v2-q2c-spot"></i>' +
      '<div class="v2-q2c-hd">' + e(t.一位) + '</div>' +
      '<div class="v2-q2c-nm v2-cut">' + e(who) + '</div>' + 粒 + '</div>' +
      '<div class="v2-q2c-rk">' + resultBody(view, true, { noHead: true }, mode) + '</div>';
  }

  // ===================== みんなで早答え =====================
  var HAYA = (function () {
    /**
     * 開く（TV）の秒（台本：docs/指示68/68-5「みんなで早答え：1問の開く」）
     *   0〜0.75 ため（照明が落ち、答えの札だけが並ぶ）→ 0.75〜1.75 人数ぶんの玉が札の上に落ちて積み上がる（玉はだれのか分からない）
     *   → 1.75〜2.5 スポットライトが札の上をゆれ動き、正解の札にカッと止まる（正解は金色・まちがいは暗く）
     *   → 2.5〜3.7 正解の札の玉が名前の札に変わる・いちばん早かった人の名前が大きく＋「1.2秒」→ 3問ごとに順位（4.2〜）
     */
    function timeline(view) {
      var d = view.data || {}, r = d.reveal || {}, counts = r.counts || [], C = Math.max(1, counts.length);
      var order = [], most = Math.max.apply(null, counts.concat([0]));
      for (var j = 0; j < most; j++) counts.forEach(function (n, k) { if (j < n) order.push({ k: k, j: j }); });
      var gap = order.length ? 0.7 / order.length : 0;
      order.forEach(function (o, i) { o.at = 0.75 + i * gap; o.land = o.at + 0.3; });
      // スポットライトのゆれ：札から札へ移り、正解の札で止まる（同じ札が光り直すまで 1/3 秒より長い・安全の決まり）
      var hops = [], H = C === 2 ? 3 : 4, dur = 0.75 / H, c = typeof r.correct === 'number' ? r.correct : 0;
      for (var i = 0; i < H; i++) hops.push({ k: ((c - (H - 1 - i)) % C + C) % C, at: 1.75 + i * dur, dur: dur });
      return { drops: order, hops: hops, stop: 2.5, tags: 2.6, fast: 3.0, rank: 4.2, end: r.ranking ? 4.7 : 3.7 };
    }
    function phone(view) {
      var d = view.data || {}, V = K(), you = view.you || {}, t = T();
      var head = V.bgHtml() + V.brandHtml() + V.cornerHtml({});
      if (!isPlayer(view) && d.phase !== 'ended') return head + '<div class="v2-in">' + V.hdHtml('Next…', t.見ていて見出し) + '<p class="v2-note">' + e(t.見ていてね) + '</p></div>';
      if (d.phase === 'ended') return head + '<div class="v2-in is-scroll v2-oph">' + resultBody(view, false, null, 'haya') + endButtons(view) + '</div>';
      if (d.phase === 'unveil') return head + '<div class="v2-in is-noband v2-oph">' + topRow(view, false, 'haya') + mineOpen(view) + '</div>';
      var topic = d.topic || { q: '', choices: [] }, mine = typeof you.myPick === 'number' ? you.myPick : null;
      return head + '<div class="v2-in is-noband v2-oph">' + topRow(view, false, 'haya') +
        (d.double ? '<div class="v2-q2dbl">' + e(t.二倍) + '</div>' : '') +
        '<div class="v2-oq" data-v2-wrap>' + V.phrase(topic.q) + '</div>' +
        '<div class="v2-vlist v2-ochoices' + (mine != null ? ' is-chosen' : '') + '">' + topic.choices.map(function (c, k) {
          var on = mine === k;
          return '<div class="v2-vcard v2-ochoice' + (on ? ' is-on' : '') + '"' + (mine != null && !on ? ' data-dimok' : '') +
            ' role="button" tabindex="0"' + (mine != null ? ' aria-disabled="true"' : '') + ' data-qh-pick="' + k + '">' +
            '<span class="v2-okey">' + KEYS.charAt(k) + '</span><span class="v2-vt"><span class="v2-vn" data-v2-wrap>' + V.phrase(c) + '</span></span>' +
            (on ? '<span class="v2-vok">' + V.icon('check') + e(t.答えた) + '</span>' : '') + '</div>';
        }).join('') + '</div>' +
        '<div class="v2-hint v2-c" role="status">' + e(mine != null ? t.テレビ : t.押したら) + '</div></div>';
    }
    /** 開いたあと、自分のこと：当たったらほめる（点と秒）。まちがえた時は正解だけ静かに出す（責めない） */
    function mineOpen(view) {
      var d = view.data || {}, r = d.reveal || {}, you = view.you || {}, V = K(), t = T();
      var right = you.myRight === true;
      return '<div class="v2-oq" data-v2-wrap>' + V.phrase(r.q || '') + '</div>' +
        '<div class="v2-q2mine' + (right ? ' is-right' : '') + '">' +
          (right ? '<b>' + e(t.正解) + '</b><span class="v2-num">+' + V.digits(you.myPoints || 0) + e(t.点) + '</span>'
            : '<small>' + e(t.ざんねん) + '</small>') +
          '<span class="v2-q2mine-a">' + e(KEYS.charAt(r.correct) + '　' + ((r.choices || [])[r.correct] || '')) + '</span></div>' +
        '<div class="v2-minebox"><span>' + e(t.あなたの点) + '</span><b>' + V.digits(you.myScore || 0) + '<small>' + e(t.点) + '</small></b></div>';
    }
    function tvChoose(view) {
      var d = view.data || {}, V = K(), t = T(), topic = d.topic || { q: '', choices: [] };
      return '<div class="v2-q2qa"><div class="v2-otq" data-v2-wrap>' + V.phrase(topic.q) + '</div>' + sparkHtml(d.answered || 0) + '</div>' +
        barHtml(view, 10) +
        '<div class="v2-ochs is-n' + topic.choices.length + '">' + topic.choices.map(function (c, k) {
          return '<div class="v2-och"><span class="v2-okey">' + KEYS.charAt(k) + '</span><span class="v2-och-t" data-v2-wrap>' + V.phrase(c) + '</span></div>';
        }).join('') + '</div>' +
        (d.double ? '<div class="v2-q2dbl is-tv">' + e(t.二倍) + '</div>' : '');
    }
    function tvOpen(view) {
      var d = view.data || {}, r = d.reveal || {}, V = K(), t = T(), tl = timeline(view);
      var choices = r.choices || [], C = Math.max(1, choices.length), counts = r.counts || [];
      var 落ちる = {};
      tl.drops.forEach(function (o) { (落ちる[o.k] = 落ちる[o.k] || [])[o.j] = o; });
      var cols = choices.map(function (c, k) {
        var win = k === r.correct, ds = 落ちる[k] || [], balls = '';
        for (var j = 0; j < (counts[k] || 0); j++) {
          balls += '<i class="v2-oball v2-q2ball" style="animation-delay:' + ss((ds[j] || { at: 0 }).at) + (win ? ',' + ss(tl.tags) : '') + '"></i>';
        }
        // まちがいの札はわざと暗くする（data-dimok：物差しの色の差に数えない）
        return '<div class="v2-ocol' + (win ? ' is-win is-right' : ' is-wrong') + '"' + (win ? '' : ' data-dimok') + ' style="--wd:' + ss(tl.stop) + '">' +
          '<div class="v2-opile">' + balls + '</div>' +
          '<div class="v2-ocard"><span class="v2-okey">' + KEYS.charAt(k) + '</span><span class="v2-ocard-t" data-v2-wrap>' + V.phrase(c) + '</span>' +
            '<span class="v2-ocnt"><b class="v2-num"><span class="v2-ocn is-last">' + V.digits(counts[k] || 0) + '</span></b><small>' + e(t.人) + '</small></span></div></div>';
      }).join('');
      var hops = tl.hops.map(function (h, i) {
        var last = i === tl.hops.length - 1;
        return '<i class="v2-q2hop' + (last ? ' is-last' : '') + '" style="left:' + ((h.k + 0.5) / C * 100).toFixed(2) + '%;' +
          (last ? 'animation-duration:' + ss(h.at) : 'animation-delay:' + ss(h.at) + ';animation-duration:' + ss(h.dur)) + '"></i>';
      }).join('');
      var right = r.right || [];
      var tags = right.length ? '<div class="v2-otags" style="--tc:' + Math.min(4, right.length) + '">' + right.map(function (x, i) {
        var col = i % Math.min(4, right.length), sx = ((r.correct + 0.5) / C - (col + 0.5) / Math.min(4, right.length)) * 92;
        return '<span class="v2-otag" style="--sx:' + sx.toFixed(1) + 'vw;--sy:30vmin;animation-delay:' + ss(tl.tags + i * 0.05) + '"><span class="v2-cut">' + e(x.name) + '</span></span>';
      }).join('') + '</div>' : '';
      var fast = (r.fastest || []).length ? '<div class="v2-q2fast" style="animation-delay:' + ss(tl.fast) + '"><small>' + e(t.いちばん早い) + '</small>' +
        '<b class="v2-cut">' + e(r.fastest.join('・')) + '</b><span class="v2-num">' + e(((r.fastestMs || 0) / 1000).toFixed(1) + t.秒) + '</span></div>'
        : '<div class="v2-q2fast is-none" style="animation-delay:' + ss(tl.fast) + '"><small>' + e(t.だれも) + '</small></div>';
      return '<div class="v2-ounv is-tv is-stage">' + '<i class="v2-odim"></i>' +
        '<div class="v2-osay" aria-hidden="true">' + e(t.せーの) + '</div>' +
        '<div class="v2-oqs" data-v2-wrap>' + V.phrase(r.q || '') + '</div>' +
        '<div class="v2-ostg' + (r.ranking ? ' has-rank' : '') + '" style="--oc:' + C + ';--rk:' + ss(tl.rank) + '">' + cols + '<div class="v2-q2hops">' + hops + '</div>' + tags + fast +
          (r.ranking ? rankHtml(r.ranking, tl.rank) : '') + '</div></div>';
    }
    /** 3問ごとの順位：入れかわりながら動く（0.4秒）。上がった人の行は、一瞬光る */
    function rankHtml(rows, at) {
      var t = T(), V = K(), top = rows.slice(0, 8);
      return '<div class="v2-q2rank" style="animation-delay:' + ss(at) + '"><div class="v2-q2rank-h">' + e(t.順位) + '</div>' + top.map(function (x) {
        var move = (x.prevRank || x.rank) - x.rank;
        return '<div class="v2-q2rk' + (move > 0 ? ' is-up' : '') + '" style="--mv:' + move + ';animation-delay:' + ss(at + 0.3) + '">' +
          '<span class="v2-num">' + V.digits(x.rank) + '</span><span class="v2-cut">' + e(x.name) + '</span><b class="v2-num">' + V.digits(x.score) + e(t.点) + '</b></div>';
      }).join('') + '</div>';
    }
    function tv(view) {
      var d = view.data || {}, Fz = F(), inner;
      if (d.phase === 'unveil') inner = '<div class="v2-otv v2-q2tv">' + topRow(view, true, 'haya') + tvOpen(view) + '</div>';
      else if (d.phase === 'ended') inner = '<div class="v2-otv is-end v2-q2tv">' + champHtml(view, 'haya') + '</div>';
      else inner = '<div class="v2-otv v2-q2tv">' + topRow(view, true, 'haya') + tvChoose(view) + '</div>';
      return Fz.tvc(view, inner, { cls: 'is-stage2', names: (d.players || []).map(function (p) { return p.name; }) });
    }
    return { phone: phone, tv: tv, timeline: timeline, resultBody: function (v, tv, o) { return resultBody(v, tv, o, 'haya'); } };
  })();

  // ===================== 数字ちかい方 =====================
  var NEAR = (function () {
    /**
     * 開く（TV）の秒（台本：docs/指示68/68-5「数字ちかい方：1問の開く」）
     *   0〜0.75 ため（照明が落ち、横長の数直線が下からせり上がる）→ 0.75〜 答えの札が遠い人から1枚ずつ「トン」と刺さる（1枚0.2秒・多い時は縮める）
     *   → 札がそろったら、正解の旗が上から落ちて刺さる（はねて止まる）→ 旗のまわりに拡大・いちばん近い札に冠・名前が大きく＋「あと 12m」
     */
    function timeline(rows) {
      var n = rows.length, per = Math.min(0.2, n ? 2.0 / n : 0.2);
      var pins = rows.map(function (x, i) { return { at: 0.75 + i * per, dur: per }; });
      var flag = 0.75 + n * per + 0.15;
      return { pins: pins, flag: flag, zoom: flag + 0.55, end: flag + 1.1 };
    }
    function fmt(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
    function phone(view) {
      var d = view.data || {}, V = K(), you = view.you || {}, t = T(), loc = view.local || {};
      var head = V.bgHtml() + V.brandHtml() + V.cornerHtml({});
      if (!isPlayer(view) && d.phase !== 'ended') return head + '<div class="v2-in">' + V.hdHtml('Next…', t.見ていて見出し) + '<p class="v2-note">' + e(t.見ていてね) + '</p></div>';
      if (d.phase === 'ended') return head + '<div class="v2-in is-scroll v2-oph">' + resultBody(view, false, null, 'near') + endButtons(view) + '</div>';
      var topic = d.topic || {};
      if (d.phase === 'unveil') {
        var r = d.reveal || {};
        return head + '<div class="v2-in is-noband v2-oph">' + topRow(view, false, 'near') +
          '<div class="v2-oq" data-v2-wrap>' + V.phrase(r.q || '') + '</div>' +
          '<div class="v2-q2mine' + (you.myRank === 1 ? ' is-right' : '') + '">' +
            (you.myDiff === 0 ? '<b>' + e(t.ぴったり) + '</b>' : '') +
            '<span class="v2-q2mine-a">' + e(fmt(r.answer) + ' ' + (r.unit || '')) + '</span>' +
            (you.myValue != null ? '<small>' + e(t.あなたの答え + '　' + fmt(you.myValue) + ' ' + (r.unit || '')) + '</small>' : '') +
            (you.myPoints ? '<span class="v2-num">+' + V.digits(you.myPoints) + e(t.点) + '</span>' : '') + '</div>' +
          '<div class="v2-minebox"><span>' + e(t.あなたの点) + '</span><b>' + V.digits(you.myScore || 0) + '<small>' + e(t.点) + '</small></b></div></div>';
      }
      var done = typeof you.myValue === 'number';
      var shown = done ? fmt(you.myValue) : (loc.digits ? fmt(Number(loc.digits)) : '');
      var keys = ['7', '8', '9', '4', '5', '6', '1', '2', '3', 'del', '0', 'go'].map(function (k) {
        if (k === 'del') return '<button type="button" class="v2-q2key is-sub" data-qn-key="del"' + (done ? ' disabled' : '') + '>' + e(t.けす) + '</button>';
        if (k === 'go') return '<button type="button" class="v2-q2key is-go" data-qn-go' + (done || !loc.digits ? ' disabled' : '') + '>' + e(t.決定) + '</button>';
        return '<button type="button" class="v2-q2key" data-qn-key="' + k + '"' + (done ? ' disabled' : '') + '>' + k + '</button>';
      }).join('');
      return head + '<div class="v2-in is-noband v2-oph">' + topRow(view, false, 'near') +
        '<div class="v2-oq" data-v2-wrap>' + V.phrase(topic.q || '') + '</div>' +
        '<div class="v2-q2disp' + (done ? ' is-done' : '') + '"><b class="v2-num" data-qn-disp>' + e(shown) + '</b><small>' + e(topic.unit || '') + '</small></div>' +
        '<div class="v2-q2pad">' + keys + '</div>' +
        '<div class="v2-hint v2-c" role="status">' + e(done ? t.テレビ : t.入れて) + '</div></div>';
    }
    function tvGuess(view) {
      var d = view.data || {}, V = K(), t = T(), topic = d.topic || {};
      return '<div class="v2-q2qa is-near"><div class="v2-otq" data-v2-wrap>' + V.phrase(topic.q || '') + '</div>' + sparkHtml(d.answered || 0) + '</div>' +
        '<div class="v2-q2unit">？ <small>' + e(topic.unit || '') + '</small></div>' + barHtml(view, 15);
    }
    function tvOpen(view) {
      var d = view.data || {}, r = d.reveal || {}, t = T(), V = K();
      var rows = r.rows || [], tl = timeline(rows), ax = r.axis || { min: 0, max: 1 }, half = Math.max(1e-9, (ax.max - ax.min) / 2), mid = r.answer;
      var inLine = rows.filter(function (x) { return !x.far; });
      // 寄る：いちばん近い2人が見えるくらいまで（最大6倍）
      var near2 = inLine.slice(-2).reduce(function (m, x) { return Math.max(m, x.diff); }, 0);
      var z = Math.max(1, Math.min(6, half / Math.max(near2 * 1.4, half / 6)));
      var xOf = function (v, zz) { return Math.max(-1.02, Math.min(1.02, (v - mid) / half * zz)); };
      var 左 = function (x) { return 'calc(50% + ' + (x * 46).toFixed(2) + '%)'; };
      var 近い = inLine.slice(-3), 位置 = {};
      rows.forEach(function (x, i) { 位置[i] = x; });
      // 点の下の名前は、重ならない段（3段まで）に置く。入らない人は点だけ（名前は開いたあとスマホと結果で分かる）
      var 段 = [[], [], []], 段of = {};
      inLine.filter(function (x) { return 近い.indexOf(x) === -1; }).forEach(function (x) {
        var px = xOf(x.value, z) * 0.46 * 1728, w = x.name.length * 44 + 40;
        for (var k = 0; k < 3; k++) if (段[k].every(function (q) { return Math.abs(q.px - px) > (q.w + w) / 2; })) { 段[k].push({ px: px, w: w }); 段of[rows.indexOf(x)] = k; return; }
        段of[rows.indexOf(x)] = -1;
      });
      var pins = rows.map(function (x, i) {
        var p = tl.pins[i];
        if (x.far) return '';
        var 札 = 近い.indexOf(x) !== -1, lane = 札 ? (近い.length - 1 - 近い.indexOf(x)) : Math.max(0, 段of[i]);
        var xz = xOf(x.value, z), out = !札 && Math.abs((x.value - mid) / half * z) > 1;
        var inner = 札
          ? '<span class="v2-ptp-tag"><span class="v2-ptp-nm v2-cut">' + e(x.name) + '</span><span class="v2-ptp-df">' + e(fmt(x.value)) + '</span></span><i class="v2-ptp-stick"></i>'
          : '<i class="v2-ptd-dot"></i><i class="v2-ptd-stick"></i>' + (段of[i] >= 0 && !out ? '<span class="v2-ptd-nm v2-cut">' + e(x.name) + '</span>' : '');
        return '<div class="' + (札 ? 'v2-ptp' : 'v2-ptd') + (x.rank === 1 ? ' is-win' : '') + (out ? ' is-out' : '') + (xz < -0.8 ? ' is-l' : xz > 0.8 ? ' is-r' : '') + '" style="left:' + 左(xz) + ';--lane:' + lane + ';--row:' + lane +
          ';--l0:' + 左(xOf(x.value, 1)) + '"><div class="v2-ptp-in" style="animation-delay:' + ss(p.at) + ';animation-duration:' + ss(p.dur) + '">' + inner + '</div></div>';
      }).join('');
      var farOf = function (side) {
        var list = rows.filter(function (x) { return x.far === side; });
        if (!list.length) return '';
        var at = tl.pins[rows.indexOf(list[0])].at;
        return '<div class="v2-q2far is-' + side + '" style="animation-delay:' + ss(at) + '"><b>' + (side === 'left' ? '←' : '→') + ' ' + V.digits(list.length) + e(t.人) + '</b>' +
          '<small class="v2-cut">' + e(list.map(function (x) { return x.name; }).join('・')) + '</small></div>';
      };
      var 上 = rows.filter(function (x) { return x.rank === 1; });
      var perfect = (r.perfect || []).length;
      var 粒 = '';
      if (perfect) for (var i = 0; i < 36; i++) 粒 += '<i class="v2-ptgold-p" style="left:' + ((i * 37) % 100) + '%;top:' + (10 + (i * 53) % 80) + '%;animation-delay:' + ss(tl.end + 0.1 + (i % 9) * 0.05) + '"></i>';
      var win = 上.length
        ? '<div class="v2-ptwin" style="animation-delay:' + ss(tl.end) + '"><span class="v2-ptwin-c" aria-hidden="true">👑</span><span class="v2-ptwin-n v2-cut">' + e(上.map(function (x) { return x.name; }).join('・')) + '</span>' +
          '<span class="v2-ptwin-d">' + e(上[0].diff === 0 ? t.ぴったり : t.あと + ' ' + fmt(上[0].diff) + (r.unit || '')) + '</span></div>'
        : '<div class="v2-ptwin is-none" style="animation-delay:' + ss(tl.end) + '">' + e(t.だれも入れず) + '</div>';
      return '<div class="v2-oqs v2-q2q" data-v2-wrap>' + V.phrase(r.q || '') + '</div>' +
        '<div class="v2-ptr' + (perfect ? ' is-perfect' : '') + ' v2-q2line" style="--zt:' + ss(tl.zoom) + '">' +
        '<i class="v2-ptr-dim"></i>' +
        '<div class="v2-ptr-ruler">' +
          '<i class="v2-ptr-axis"></i>' +
          '<div class="v2-q2flag" style="animation-delay:' + ss(tl.flag) + '"><span class="v2-q2flag-t">' + e(fmt(r.answer) + ' ' + (r.unit || '')) + '</span><i></i></div>' +
          pins + farOf('left') + farOf('right') + '</div>' +
        win + (perfect ? '<div class="v2-ptgold" aria-hidden="true">' + 粒 + '</div><div class="v2-ptband" style="animation-delay:' + ss(tl.end + 0.15) + '">' + e(t.ぴったり) + '</div>' : '') +
      '</div>';
    }
    function tv(view) {
      var d = view.data || {}, Fz = F(), inner;
      if (d.phase === 'unveil') inner = '<div class="v2-otv v2-q2tv">' + topRow(view, true, 'near') + tvOpen(view) + '</div>';
      else if (d.phase === 'ended') inner = '<div class="v2-otv is-end v2-q2tv">' + champHtml(view, 'near') + '</div>';
      else inner = '<div class="v2-otv v2-q2tv">' + topRow(view, true, 'near') + tvGuess(view) + '</div>';
      return Fz.tvc(view, inner, { cls: 'is-stage2' + (d.phase === 'unveil' ? ' is-quietwall' : ''), names: (d.players || []).map(function (p) { return p.name; }) });
    }
    return { phone: phone, tv: tv, timeline: timeline, fmt: fmt, resultBody: function (v, tv, o) { return resultBody(v, tv, o, 'near'); } };
  })();

  return { haya: HAYA, near: NEAR, KEYS: KEYS };
});
