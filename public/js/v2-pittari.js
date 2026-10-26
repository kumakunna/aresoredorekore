/**
 * public/js/v2-pittari.js — 「ぴったり10秒」の画面（指示68-4）。新しい見た目（V2 の部品）で組む。
 *
 * 字を組むだけ。時計を動かす・押した時に測るのは index.html（pittariRender・PittariLogic.Stopwatch）。
 * 時計の字は [data-pt-clock] に入れる（index.html が 30ミリ秒ごとに書きかえ、見えている時間が過ぎたら「？」にする）。
 *
 * ---- 秘密 ----
 *   はかっている間に描く物は、目標・時計（見えている間だけ）・自分が押したか、だけ。
 *   タイムも「だれが押したか」もサーバーが開くまで配らないので、ここには来ない。
 *
 * view：{ data（publicView）, you（privateFor）, meId, members, host, fesRoom, fes:{ inset }, local:{ stopped（この端末で押した） } }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.V2Pittari = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function T() { return (typeof UiText !== 'undefined' && UiText.PITTARI) || {}; }
  function K() { return (typeof V2 !== 'undefined') ? V2 : null; }
  function F() { return (typeof V2Fes !== 'undefined') ? V2Fes : null; }
  function L() { return (typeof PittariLogic !== 'undefined') ? PittariLogic : null; }
  function e(s) { return K().esc(s); }

  function isPlayer(view) {
    return ((view.data || {}).players || []).some(function (p) { return p.id === view.meId; });
  }
  /** 上の行：何回目・目標・2倍 */
  function topRow(view) {
    var d = view.data || {}, V = K(), t = T();
    return '<div class="v2-otop"><span class="v2-opill"><b class="v2-num">' + V.digits(d.round || 1) + '</b><small>/' + V.digits(d.total || 5) + '</small>' + e(t.回目) + '</span>' +
      '<span class="v2-omode">' + e(t.目標 + ' ' + d.target + t.秒) + '</span>' +
      (d.double ? '<span class="v2-ptx2">' + e(t.二倍) + '</span>' : '') + '</div>';
  }

  // ===================== スマホ =====================
  function phone(view) {
    var d = view.data || {}, V = K(), t = T();
    var head = V.bgHtml() + V.brandHtml() + V.cornerHtml({});
    if (!isPlayer(view) && d.phase !== 'ended') {
      return head + '<div class="v2-in">' + V.hdHtml('Next…', t.見ていて見出し) + '<p class="v2-note">' + e(t.見ていてね) + '</p></div>';
    }
    if (d.phase === 'roundResult') return head + '<div class="v2-in is-noband v2-oph">' + topRow(view) + lineHtml(view, false) + mineHtml(view) + '</div>';
    if (d.phase === 'ended') return head + '<div class="v2-in is-scroll v2-oph">' + resultBody(view, false) + endButtons(view) + '</div>';
    if (d.phase === 'run') return head + '<div class="v2-in is-noband v2-oph v2-ptrun">' + topRow(view) + runHtml(view) + '</div>';
    return head + '<div class="v2-in is-noband v2-oph v2-ptrun">' + topRow(view) + setHtml(view, false) + '</div>';
  }
  /** よーい（スマホと TV） */
  function setHtml(view, tv) {
    var d = view.data || {}, V = K(), t = T();
    return '<div class="v2-ptset' + (tv ? ' is-tv' : '') + '"><div class="v2-ptready">' + e(t.よーい) + '</div>' +
      '<div class="v2-pttgt"><b class="v2-num">' + V.digits(d.target || 10) + '</b><span>' + e(t.秒) + '</span></div>' +
      '<div class="v2-hint v2-c">' + e(d.show === false ? t.見えない回 : t.三秒で消える) + '</div></div>';
  }
  /** はかる（スマホ）：時計と大きなボタンだけ。押したら「ストップ！」だけ（タイムは出さない） */
  function runHtml(view) {
    var t = T(), loc = view.local || {}, you = view.you || {};
    if (loc.stopped || you.stopped) {
      return '<div class="v2-ptdone"><div class="v2-ptstop">' + e(t.ストップ済) + '</div><div class="v2-hint v2-c" role="status">' + e(t.開くまで) + '</div></div>';
    }
    return '<div class="v2-ptclock" data-pt-clock aria-hidden="true">0.0</div>' +
      '<button type="button" class="v2-ptbtn" data-pt-stop>' + e(t.ストップ) + '</button>' +
      '<div class="v2-hint v2-c">' + e(t.心の中で) + '</div>';
  }
  function mineHtml(view) {
    var you = view.you || {}, t = T(), V = K(), Lg = L();
    if (you.myDiff == null) return '';
    var top = you.myRank === 1;
    return '<div class="v2-omine' + (top ? ' is-got' : '') + '"><span class="v2-lbl">' + e(t.あなた) + '</span>' +
      '<b>' + e(Lg.diffText(you.myDiff)) + '</b><span class="v2-ptrk">' + e(you.myRank + t.位) + '</span>' +
      (you.myPoints ? '<span class="v2-oplus">' + e('+' + you.myPoints + t.点) + '</span>' : '') + '</div>';
  }

  /**
   * 開く：数直線（目標が真ん中）に、遠い人から順に名前が落ちてくる → いちばん近い人に冠。差は「+0.12秒」の形。
   * 名前の札は重ならないように段（lane）を分けて置く。**近い人から先に段を決める**（冠の人をいちばん下＝線の近くに）。
   * 近い人ほど目標のまわりに集まるので、線は「平方根の目盛り」（真ん中を広く、端をせまく）。端の目盛りは本当の秒。
   * 段は TV 8段・スマホ 6段まで。それより多い時は重なりのいちばん少ない段に置く（画面の外へ出さない）。
   * 落ちてくる順の遅れは「演出の速さ」をかける（--fx-scale）
   */
  function lineHtml(view, tv) {
    var d = view.data || {}, r = d.reveal || {}, t = T(), Lg = L();
    var rows = r.rows || [];
    var far = rows.reduce(function (m, x) { return Math.max(m, Math.abs(x.diff)); }, 0);
    var range = Math.max(1000, Math.ceil(far * 1.15 / 500) * 500);
    var 幅 = tv ? 1700 : 340, 段の上限 = tv ? 8 : 6;
    var posOf = function (diff) { return 50 + (diff < 0 ? -1 : 1) * Math.sqrt(Math.abs(diff) / range) * (tv ? 42 : 30); };
    var wOf = function (x) { return ((tv ? x.name.length * 46 + 7 * 27 + 60 : x.name.length * 14 + 22) / 幅) * 100; };
    var lanes = [], laneOf = {};
    rows.slice().reverse().forEach(function (x) {   // 近い人から
      var pos = posOf(x.diff), w = wOf(x);
      var 重なり = function (k) { return (lanes[k] || []).filter(function (s) { return Math.abs(s.pos - pos) < (s.w + w) / 2; }).length; };
      var lane = 0;
      while (lane < 段の上限 && 重なり(lane)) lane++;
      if (lane >= 段の上限) {
        lane = 0;
        for (var k = 1; k < 段の上限; k++) if (重なり(k) < 重なり(lane)) lane = k;
      }
      (lanes[lane] = lanes[lane] || []).push({ pos: pos, w: w });
      laneOf[x.id] = lane;
    });
    var pins = rows.map(function (x, i) {
      var win = x.rank === 1;
      return '<div class="v2-ptpin' + (win ? ' is-win' : '') + (x.diff === 0 ? ' is-perfect' : '') + '" style="left:' + posOf(x.diff).toFixed(2) + '%;--lane:' + laneOf[x.id] +
        ';animation-delay:calc(' + (0.4 + i * 0.28).toFixed(2) + 's * var(--fx-scale))">' +
        (win ? '<span class="v2-ptcrown" aria-hidden="true">👑</span>' : '') +
        '<span class="v2-ptname v2-cut">' + e(x.name) + '</span><span class="v2-ptdiff">' + e(Lg.diffText(x.diff)) + '</span></div>';
    }).join('');
    var 段 = Math.max(1, lanes.length);
    var 秒 = (range / 1000).toFixed(range % 1000 ? 1 : 0);
    return '<div class="v2-ptwrap' + (tv ? ' is-tv' : '') + '">' +
      (r.perfect && r.perfect.length ? '<div class="v2-oban is-gold">' + e(t.ぴったり) + '</div>' : '') +
      '<div class="v2-ptline" style="--lanes:' + 段 + '">' + pins +
        '<div class="v2-ptaxis"><i class="v2-pttick"></i></div>' +
        '<div class="v2-ptmarks"><span>' + e('-' + 秒 + t.秒) + '</span><span class="is-c">' + e(r.target + t.秒) + '</span><span>' + e('+' + 秒 + t.秒) + '</span></div>' +
      '</div>' +
      (!rows.length ? '<p class="v2-note v2-c">' + e(t.だれも) + '</p>' : '') +
    '</div>';
  }

  /**
   * 開く（TV）：見せ場の台本（docs/指示68/68-4 の「ぴったり10秒の開く」）のとおり。
   *   0.00〜0.75 ため   … 画面が少し暗くなり、大きな物差し（目標の秒が真ん中・左右に±3秒）が下からせり上がる
   *   0.75〜    落ちる  … 名前の札が上から1枚ずつ落ちて、自分の秒に刺さる。遠い人から1枚0.25秒（多い時は縮める）。±3秒より遠い人は端に寄せる
   *   残り2人   寄る    … 物差しがぐっと拡大（±0.5秒の目盛り）。最後の2人はゆっくり（0.5秒ずつ）
   *   最後の1人 ほめる  … 刺さった瞬間に冠。名前が大きく、差「+0.12秒」。0.00秒なら金の粒と「ぴったり！」の帯
   * 名前を大きく出すのは、いちばん近い人だけ（決まり5）。全部で5秒以内。時刻はどれも「演出の速さ」をかける。
   * 音は index.html（pittariFx）が、ここが返す時刻（timeline）で鳴らす
   */
  function timeline(rows) {
    var n = rows.length, m = Math.max(0, n - 2);
    var per = Math.min(0.25, m ? 2.1 / m : 0.25);
    var t = [], i;
    for (i = 0; i < m; i++) t.push({ at: 0.75 + i * per, dur: per });
    var zoom = 0.75 + m * per + 0.05;
    var last = n - m;
    for (i = 0; i < last; i++) t.push({ at: zoom + 0.35 + i * 0.5, dur: 0.45 });
    var end = n ? t[n - 1].at + t[n - 1].dur + 0.1 : 0.9;
    return { pins: t, zoom: zoom, end: end };
  }
  function zoomOf(rows) {
    var near = rows.slice(-2).reduce(function (m, x) { return Math.max(m, Math.abs(x.diff)); }, 0);
    return Math.max(1, Math.min(6, 3000 / Math.max(near * 1.4, 500)));
  }
  var ss = function (sec) { return 'calc(' + sec.toFixed(2) + 's * var(--fx-scale))'; };
  function tvRevealHtml(view) {
    var d = view.data || {}, r = d.reveal || {}, V = K(), t = T(), Lg = L();
    var rows = r.rows || [];   // 遠い順
    var tl = timeline(rows), z = zoomOf(rows);
    var xOf = function (diff, zz) { return Math.max(-1.02, Math.min(1.02, diff / 3000 * zz)); };
    var 幅 = function (x) { return (x.name.length * 46 + 7 * 27 + 70) / 1700 * 2; };
    /**
     * 段：物差しの上に、近い人から重ならない段に置く（6段まで。多い時は重なりのいちばん少ない段。冠の人の札には重ねない）。
     * 物差しから外れる人（その目盛りの端より遠い人）は、左右の端に縦に積む（近い人が下）——台本の「端に寄せて止める」
     */
    function 段を決める(zz) {
      var lanes = [], out = {};
      var 置く = function (x, pos, w, edge) {
        // 冠の人の札には、だれも重ねない（重なりを100と数える）
        var 重なり = function (k) { return (lanes[k] || []).reduce(function (n, p) { return n + (Math.abs(p.pos - pos) < (p.w + w) / 2 ? (p.win ? 100 : 1) : 0); }, 0); };
        var lane = 0;
        while (lane < 6 && 重なり(lane)) lane++;
        if (lane >= 6) { lane = 0; for (var k = 1; k < 6; k++) if (重なり(k) < 重なり(lane)) lane = k; }
        (lanes[lane] = lanes[lane] || []).push({ pos: pos, w: w, win: x.rank === 1 });
        out[x.id] = { x: edge ? (edge === 'l' ? -1.04 : 1.04) : pos, lane: lane, edge: edge };
      };
      var 近い順 = rows.slice().reverse();
      // 先に冠の人、つぎに端に寄せる人（端から積む）、のこりを近い順に
      近い順.filter(function (x) { return x.rank === 1; }).forEach(function (x) { 置く(x, xOf(x.diff, zz), 幅(x)); });
      近い順.filter(function (x) { return x.rank !== 1 && Math.abs(x.diff / 3000 * zz) > 1; }).forEach(function (x) {
        var w = 幅(x), edge = x.diff < 0 ? 'l' : 'r';
        置く(x, edge === 'l' ? -1.04 + w / 2 : 1.04 - w / 2, w, edge);
      });
      近い順.filter(function (x) { return x.rank !== 1 && Math.abs(x.diff / 3000 * zz) <= 1; }).forEach(function (x) { 置く(x, xOf(x.diff, zz), 幅(x)); });
      return out;
    }
    var 前 = 段を決める(1), 後 = 段を決める(z);
    var 早い = Math.max(0, rows.length - 2);
    var 左 = function (x) { return 'calc(50% + ' + (x * 46).toFixed(2) + '%)'; };
    // 外側：寄る時に動く（--l0・--n0 → left・--lane）。内側：上から落ちて刺さる（1枚ずつの時刻）。端に積んだ札は棒を出さない
    var pins = rows.map(function (x, i) {
      var p = tl.pins[i], 先 = i < 早い, a0 = 先 ? 前[x.id] : 後[x.id], a1 = 後[x.id];
      return '<div class="v2-ptp' + (先 ? ' is-early' : ' is-last') + (x.rank === 1 ? ' is-win' : '') + (a1.edge ? ' is-edge is-' + a1.edge : '') +
        '" style="left:' + 左(a1.x) + ';--lane:' + a1.lane + ';--l0:' + 左(a0.x) + ';--n0:' + a0.lane + '">' +
        '<div class="v2-ptp-in" style="animation-delay:' + ss(p.at) + ';animation-duration:' + ss(p.dur) + '">' +
        '<span class="v2-ptp-tag"><span class="v2-ptp-nm v2-cut">' + e(x.name) + '</span><span class="v2-ptp-df">' + e(Lg.diffText(x.diff)) + '</span></span><i class="v2-ptp-stick"></i></div></div>';
    }).join('');
    var 上 = rows.filter(function (x) { return x.rank === 1; });
    var perfect = r.perfect && r.perfect.length;
    var 粒 = '';
    if (perfect) for (var i = 0; i < 36; i++) {
      粒 += '<i class="v2-ptgold-p" style="left:' + ((i * 37) % 100) + '%;top:' + (10 + (i * 53) % 80) + '%;animation-delay:' + ss(tl.end + 0.1 + (i % 9) * 0.05) + '"></i>';
    }
    var 端 = 3 / z;   // 寄ったあとの物差しの端（秒）
    var 字 = function (v) { return (v > 0 ? '+' : '-') + (Math.round(Math.abs(v) * 10) / 10) + t.秒; };
    return '<div class="v2-ptr' + (perfect ? ' is-perfect' : '') + '" style="--zt:' + ss(tl.zoom) + '">' +
      '<i class="v2-ptr-dim"></i>' +
      '<div class="v2-ptr-ruler">' +
        '<i class="v2-ptr-axis"></i><i class="v2-ptr-center"></i><span class="v2-ptr-tgt">' + e(r.target + t.秒) + '</span>' +
        '<div class="v2-ptr-marks' + (z > 1.01 ? ' is-wide' : '') + '"><span>' + e(字(-3)) + '</span><span>' + e(字(3)) + '</span></div>' +
        (z > 1.01 ? '<div class="v2-ptr-marks is-near"><span>' + e(字(-端)) + '</span><span>' + e(字(端)) + '</span></div>' : '') +
        pins + '</div>' +
      (上.length ? '<div class="v2-ptwin" style="animation-delay:' + ss(tl.end) + '"><span class="v2-ptwin-c" aria-hidden="true">👑</span>' +
        '<span class="v2-ptwin-n v2-cut">' + e(上.map(function (x) { return x.name; }).join('・')) + '</span>' +
        '<span class="v2-ptwin-d">' + e(Lg.diffText(上[0].diff)) + '</span></div>' : '<div class="v2-ptwin is-none" style="animation-delay:' + ss(tl.end) + '">' + e(t.だれも) + '</div>') +
      (perfect ? '<div class="v2-ptgold" aria-hidden="true">' + 粒 + '</div><div class="v2-ptband" style="animation-delay:' + ss(tl.end + 0.15) + '">' + e(t.ぴったり) + '</div>' : '') +
    '</div>';
  }

  /** 結果（スマホ・TV・文化祭の結果の画面で同じ物） */
  function resultBody(view, tv, o) {
    var d = view.data || {}, res = d.result || {}, V = K(), t = T();
    var head = o && o.noHead ? '' : V.hdHtml('Result!', t.結果, tv);
    var aw = res.awards || {};
    var awards = '<div class="v2-oaws">' + [['perfect', t.ぴったりの人], ['master', t.名人]].filter(function (x) { return (aw[x[0]] || []).length; }).map(function (x) {
      var ns = aw[x[0]], 見せる = ns.slice(0, 6).join('・') + (ns.length > 6 ? t.ほか + (ns.length - 6) + t.人 : '');
      return '<div class="v2-oaw"><span class="v2-oaw-t">' + e(x[1]) + '</span><span class="v2-oaw-n" data-v2-wrap>' + V.phrase(見せる) + '</span></div>';
    }).join('') + '</div>';
    var rk = res.ranking || [];
    var me = rk.filter(function (x) { return x.id === view.meId; })[0];
    return head +
      (me && !tv ? '<div class="v2-minebox"><span>' + e(t.あなたの点) + '</span><b>' + V.digits(me.score) + '<small>' + e(t.点) + '</small></b></div>' : '') +
      awards +
      '<div class="v2-ranks v2-oranks' + (rk.length > 8 && tv ? ' is-c2' : '') + '">' + rk.map(function (x) {
        return '<div class="v2-rk' + (x.id === view.meId ? ' is-me' : '') + '"><span class="v2-rk-n v2-num">' + V.digits(x.rank) + '</span>' +
          '<span class="v2-rk-nm v2-cut">' + e(x.name) + '</span><span class="v2-rk-x">' + V.digits(x.score) + e(t.点) + '</span></div>';
      }).join('') + '</div>';
  }

  function endButtons(view) {
    if (view.fesRoom) return '';
    var t = T();
    return '<div class="v2-spacer"></div>' + (view.host
      ? '<button type="button" class="v2-btn is-pri" data-v2game-act="again">' + e(t.つぎは) + '</button>' +
        '<button type="button" class="v2-btn is-sec" data-v2game-act="end">' + e(t.とじる) + '</button>'
      : '<div class="v2-hint v2-c" role="status">' + e(t.進行役が) + '</div>') +
      '<button type="button" class="v2-btn is-sec" data-v2game-act="leave">' + e(t.出る) + '</button>';
  }

  // ===================== TV =====================
  function tv(view) {
    var d = view.data || {}, inner;
    if (d.phase === 'roundResult') inner = '<div class="v2-otv">' + topRow(view) + tvRevealHtml(view) + '</div>';
    else if (d.phase === 'ended') inner = '<div class="v2-otv is-end">' + resultBody(view, true) + '</div>';
    else if (d.phase === 'run') inner = '<div class="v2-otv">' + topRow(view) + '<div class="v2-ptset is-tv">' +
      '<div class="v2-ptclock is-tv" data-pt-clock aria-hidden="true">0.0</div><div class="v2-pthint">' + e(T().心の中で) + '</div></div></div>';
    else inner = '<div class="v2-otv">' + topRow(view) + setHtml(view, true) + '</div>';
    return F().tvc(view, inner, { names: (d.players || []).map(function (p) { return p.name; }) });
  }

  return { phone: phone, tv: tv, resultBody: resultBody, timeline: timeline };
});
