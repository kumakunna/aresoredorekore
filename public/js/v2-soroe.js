/**
 * public/js/v2-soroe.js — 「そろえて発射」の画面（指示68-4）。新しい見た目（V2 の部品）で組む。
 *
 * 字を組むだけ。カウントを動かす・押した時刻をサーバーの時刻に直すのは index.html（soroeRender・SoroeLogic.offsetOf）。
 * カウントの字は [data-so-count] に入れる（index.html が、直した時計で 0 の時刻までを数えて書きかえる）。
 *
 * ---- だれがずれたかは出さない（協力・大切なこと5） ----
 *   開いた時に描くのは、名前のない点（最初の人からのミリ秒）と、差・高さ・点だけ。サーバーもそれしか配らない。
 *
 * view：{ data（publicView）, you（privateFor）, meId, members, host, fesRoom, fes:{ inset }, local:{ pressed, ready（時計を合わせた） } }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.V2Soroe = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function T() { return (typeof UiText !== 'undefined' && UiText.SOROE) || {}; }
  function K() { return (typeof V2 !== 'undefined') ? V2 : null; }
  function F() { return (typeof V2Fes !== 'undefined') ? V2Fes : null; }
  function e(s) { return K().esc(s); }

  function isPlayer(view) {
    return ((view.data || {}).players || []).some(function (p) { return p.id === view.meId; });
  }
  function topRow(view) {
    var d = view.data || {}, V = K(), t = T();
    return '<div class="v2-otop"><span class="v2-opill"><b class="v2-num">' + V.digits(d.round || 1) + '</b><small>/' + V.digits(d.total || 5) + '</small>' + e(t.回目) + '</span>' +
      '<span class="v2-omode">' + e((t.合図 || {})[d.signal] || '') + '</span>' +
      (d.double ? '<span class="v2-ptx2">' + e(t.二倍) + '</span>' : '') + '</div>';
  }
  /** 合図（スマホと TV で同じ）。数は index.html が [data-so-count] に入れる。せーのの回は数を出さない */
  function signalHtml(view, tv) {
    var d = view.data || {}, t = T();
    if (d.signal === 'seeno') return '<div class="v2-sosig is-seeno' + (tv ? ' is-tv' : '') + '"><div class="v2-sosay">' + e(t.せーの) + '</div><div class="v2-hint v2-c">' + e(t.せーの説明) + '</div></div>';
    return '<div class="v2-sosig' + (tv ? ' is-tv' : '') + '"><div class="v2-socount" data-so-count aria-live="off"></div>' +
      '<div class="v2-hint v2-c">' + e(d.signal === 'fade' ? t.消える説明 : t.ゼロで押す) + '</div></div>';
  }

  // ===================== スマホ =====================
  function phone(view) {
    var d = view.data || {}, V = K(), t = T();
    var head = V.bgHtml() + V.brandHtml() + V.cornerHtml({});
    if (!isPlayer(view) && d.phase !== 'ended') {
      return head + '<div class="v2-in">' + V.hdHtml('Next…', t.見ていて見出し) + '<p class="v2-note">' + e(t.見ていてね) + '</p></div>';
    }
    if (d.phase === 'roundResult') return head + '<div class="v2-in is-noband v2-oph">' + topRow(view) + phoneRevealHtml(view) + '</div>';
    if (d.phase === 'ended') return head + '<div class="v2-in is-scroll v2-oph">' + resultBody(view, false) + endButtons(view) + '</div>';
    var loc = view.local || {}, you = view.you || {};
    var body = (loc.pressed || you.pressed)
      ? '<div class="v2-ptdone"><div class="v2-ptstop">' + e(t.押した) + '</div><div class="v2-hint v2-c" role="status">' + e(t.まって) + '</div></div>'
      : signalHtml(view, false) + '<button type="button" class="v2-ptbtn v2-sobtn" data-so-fire' + (loc.ready ? '' : ' disabled') + '>' + e(loc.ready ? t.発射 : t.準備中) + '</button>';
    return head + '<div class="v2-in is-noband v2-oph v2-ptrun">' + topRow(view) + body + '</div>';
  }

  /**
   * 見せ場（docs/指示68/68-4 の「そろえて発射の開く」の台本）。TV の舞台は1つの場面（.v2-soscene）で、合図の間もここ。
   *   合図の間   … 地面の発射台にロケット。後ろに町のビルと空
   *   0.00〜0.75 ため … 少し暗くなり、エンジンが小さくくすぶる
   *   0.75〜1.25 点火 … 押した人数ぶんの「火の粒」が、押した順と間かくのまま（0.5秒に縮めて）ロケットの下に飛びこむ。
   *                     そろっていると1つの大きな炎（宇宙・月は金色）、ばらばらだと小さい炎
   *   1.25〜     発射 … ロケットはまん中より少し下に止まり、景色が下へ流れる（1段0.6秒）。高さの名前は通りすぎる看板
   *   着いた     … 景色が止まり、着いた高さの名前が大きく。その下に小さく「差 0.04秒 ＋70点」
   *   宇宙       … 金の粒。全員の名前が星座のように散らばって光る。全員そろったら金の帯
   *   ぽてっ     … 少し浮いて、ふらふら傾いて、ぽてっと落ちる。飛ばない回は煙が「プスッ」と出るだけ
   * 時刻は timeline が1か所で決め、画面（ここ）と音（index.html の soroeFx）が同じ物を読む。どれも「演出の速さ」をかける
   */
  var STEP = { building: 1, cloud: 2, moon: 3, space: 4 };
  function timeline(r) {
    var k = r && r.flew ? (STEP[r.height] || 0) : 0;
    var lift = 1.25, climb = 1.35;
    var arrive = !r || !r.flew ? 1.0 : (r.height === 'plop' ? 2.5 : climb + 0.6 * k + 0.05);
    var 幅 = Math.max(400, (r && r.spread) || 0);
    var fires = ((r && r.dots) || []).slice(0, 16).map(function (ms) { return 0.75 + (ms / 幅) * 0.5; });
    return { k: k, lift: lift, climb: climb, arrive: arrive, fires: fires };
  }
  var ss = function (sec) { return 'calc(' + sec.toFixed(2) + 's * var(--fx-scale))'; };
  /** 景色の柱（画面5つぶん）。町 → 雲 → 月 → 星と銀河。看板は着いた高さより下の段だけ（通りすぎたら消える） */
  function columnHtml(k, tl) {
    var t = T();
    // ビルは最初の画面（柱の下 20%）に全部おさまる高さ。1段目で屋上を追いこす
    var bld = [[2, 8, 8], [11, 7, 12], [19, 9, 9], [30, 6, 14], [62, 8, 11], [71, 7, 13], [79, 9, 8], [89, 8, 12]].map(function (b) {
      return '<i class="v2-sobld" style="left:' + b[0] + '%;width:' + b[1] + '%;height:' + b[2] + '%"></i>';
    }).join('');
    var 雲 = [[6, 44, 30], [44, 48, 26], [70, 45, 24], [22, 54, 20]].map(function (c) {
      return '<i class="v2-socloud" style="left:' + c[0] + '%;bottom:' + c[1] + '%;width:' + c[2] + '%"></i>';
    }).join('');
    var 看板 = '';
    ['building', 'cloud', 'moon'].forEach(function (id, j) {
      if (j + 1 >= k) return;
      看板 += '<span class="v2-sobb" style="bottom:' + ((j + 1) * 20 + 6) + '%;animation-delay:' + ss(tl.climb) + ';animation-duration:' + ss(0.6 * k) + '">' + e((t.高さ || {})[id]) + '</span>';
    });
    return '<div class="v2-socol" style="--k:' + k + '">' +
      '<i class="v2-sostars"></i><i class="v2-sogalaxy"></i><i class="v2-somoon"></i>' + 雲 + bld + '<i class="v2-soground"></i><i class="v2-sopad"></i>' + 看板 + '</div>';
  }
  /** ロケットとエンジン（炎・煙・火の粒） */
  function rocketHtml(r, tl, tv) {
    var 火 = '';
    if (r && r.flew) {
      tl.fires.forEach(function (at, i) {
        var a = (i * 137.5) * Math.PI / 180, R = (tv ? 560 : 120) + (i % 3) * (tv ? 80 : 20);
        // 左右と上から、ロケットの下（エンジン）へ飛びこむ（ロケットは地面にいるので、下からは見えない）
        火 += '<i class="v2-sofp" style="--sx:' + Math.round(Math.cos(a) * R) + 'px;--sy:' + Math.round(-Math.abs(Math.sin(a)) * R * 0.7 - (tv ? 60 : 20)) + 'px;animation-delay:' + ss(at) + '"></i>';
      });
    }
    var 炎 = !r || !r.flew ? '' : (r.height === 'plop' ? ' is-small' : (r.height === 'space' || r.height === 'moon' ? ' is-big is-gold' : (r.height === 'cloud' ? ' is-mid' : ' is-small')));
    return '<div class="v2-sorkt">' + (炎 ? '<i class="v2-soflame' + 炎 + '"></i>' : '') + '<i class="v2-sosmoke' + (r && !r.flew ? ' is-puff' : '') + '"></i>' +
      '<span class="v2-sorocket" aria-hidden="true">' + K().emblem('soroe') + '</span>' + 火 + '</div>';
  }
  /** 宇宙：金の粒と、全員の名前の星座（ロケットのまわりをあけて、左右に散らす） */
  function spaceHtml(view, tl) {
    var d = view.data || {}, names = (d.players || []).map(function (p) { return p.name; }).slice(0, 18);
    var 粒 = '';
    for (var i = 0; i < 28; i++) 粒 += '<i class="v2-sospk" style="left:' + ((i * 41) % 100) + '%;top:' + (8 + (i * 29) % 84) + '%;animation-delay:' + ss(tl.arrive + 0.1 + (i % 10) * 0.05) + '"></i>';
    // TV の安全な枠（左右 96px＝5%）の内側。ロケット（まん中）と見出し・帯（上）をあける
    var 列 = [6, 20, 34, 66, 80, 94], 行 = [58, 72, 86];
    var 星 = names.map(function (nm, i) {
      var c = 列[(i % 2) * 3 + Math.floor(i / 6) % 3], r = 行[Math.floor(i / 2) % 3];
      var 右 = c > 50;
      return '<span class="v2-sostarn v2-cut" style="' + (右 ? 'right:' + (100 - c) : 'left:' + c) + '%;top:' + r + '%;animation-delay:' + ss(tl.arrive + 0.25 + i * 0.06) + '">' + e(nm) + '</span>';
    }).join('');
    return '<div class="v2-sospace" aria-hidden="true">' + 粒 + '</div>' + 星;
  }
  /** 場面。phase が launch の時は発射台（合図を上に重ねる）、roundResult の時は開く */
  function sceneHtml(view, tv, overlay) {
    var d = view.data || {}, r = d.phase === 'roundResult' || d.phase === 'ended' ? (d.reveal || null) : null, t = T();
    var tl = timeline(r);
    var 形 = !r ? ' is-pad' : (!r.flew ? ' is-ground' : (r.height === 'plop' ? ' is-plop' : ' is-fly'));
    var 着 = '';
    if (r) {
      着 = !r.flew
        ? '<div class="v2-soarrive is-quiet" style="animation-delay:' + ss(tl.arrive) + '"><b>' + e(t.プスッ) + '</b><small>' + e(r.count < 2 && r.n >= 2 && r.count * 2 >= r.n ? t.ひとりでは : t.飛ばなかった) + '</small></div>'
        : '<div class="v2-soarrive' + (r.height === 'space' ? ' is-gold' : '') + '" style="animation-delay:' + ss(tl.arrive) + '"><b>' + e((t.着いた || {})[r.height] || '') + '</b>' +
          '<small>' + e(t.差 + ' ' + (r.spread / 1000).toFixed(2) + t.秒 + '　＋' + r.points + t.点) + '</small></div>';
    }
    return '<div class="v2-soscene' + (tv ? ' is-tv' : '') + 形 + (tl.k ? ' is-k' + tl.k : '') + '" style="--lift:' + ss(tl.lift) + ';--climb:' + ss(tl.climb) + '">' +
      columnHtml(tl.k, tl) + '<i class="v2-sodim"></i>' + rocketHtml(r, tl, tv) +
      (r && r.height === 'space' ? spaceHtml(view, tl) : '') + 着 +
      (r && r.together ? '<div class="v2-soband" style="animation-delay:' + ss(tl.arrive + 0.35) + '">' + e(t.全員そろった) + '</div>' : '') +
      (overlay || '') + '</div>';
  }
  /** スマホの開く：TV がある部屋は「TV を見てね」と小さなロケット、着いたら高さと点だけ。TV が無い部屋は同じ場面を出す */
  function phoneRevealHtml(view) {
    var d = view.data || {}, r = d.reveal || {}, t = T();
    var hasTv = (view.members || []).some(function (m) { return m.role === 'bigscreen' && m.connected !== false; });
    if (!hasTv) return '<div class="v2-sowrap">' + sceneHtml(view, false) + '</div>';
    var tl = timeline(r);
    return '<div class="v2-solook"><span class="v2-sorocket is-mini" aria-hidden="true">' + K().emblem('soroe') + '</span>' +
      '<div class="v2-solook-t">' + e(t.TVを見て) + '</div>' +
      '<div class="v2-solook-r" style="animation-delay:' + ss(tl.arrive) + '"><b>' + e(r.flew ? (t.着いた || {})[r.height] : t.飛ばず) + '</b>' +
        (r.flew ? '<small>' + e('＋' + r.points + t.点) + '</small>' : '') + '</div></div>';
  }

  function resultBody(view, tv, o) {
    var d = view.data || {}, res = d.result || {}, V = K(), t = T();
    var head = o && o.noHead ? '' : V.hdHtml('Result!', t.結果, tv);
    var hs = (res.heights || []).map(function (h, i) {
      return '<div class="v2-rk"><span class="v2-rk-n v2-num">' + V.digits(i + 1) + '</span><span class="v2-rk-nm v2-cut">' +
        e(h.flew ? (t.高さ || {})[h.height] : t.飛ばず) + (h.double ? ' ' + t.二倍 : '') + '</span><span class="v2-rk-x">' + V.digits(h.points) + e(t.点) + '</span></div>';
    }).join('');
    return head +
      '<div class="v2-osync' + (res.space ? ' is-gold' : '') + '"><span class="v2-lbl">' + e(t.みんなの記録) + '</span>' +
        '<b class="v2-num">' + V.digits(res.total || 0) + '<small>' + e(t.点) + '</small></b>' +
        (res.dayBest != null ? '<span class="v2-osync-s">' + e(t.今日の最高 + ' ' + res.dayBest + t.点) + '</span>' : '') +
        (res.together ? '<span class="v2-osync-w">' + e(res.together + t.回そろった) + '</span>' : '') + '</div>' +
      '<div class="v2-ranks v2-oranks">' + hs + '</div>';
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
  /**
   * TV：遊んでいる間は、景色を画面いっぱいに広げる（舞台そのもの・名前の壁の中の窓にしない）。上の行は景色の上に重ねる。
   * 結果（ended）だけは、ふだんの TV の枠（名前の壁）
   */
  function tv(view) {
    var d = view.data || {}, t = T();
    if (d.phase === 'ended') return F().tvc(view, '<div class="v2-otv is-end">' + resultBody(view, true) + '</div>', { names: (d.players || []).map(function (p) { return p.name; }) });
    var layer = '<div class="v2-sowrap is-tv is-full">' + sceneHtml(view, true, d.phase === 'roundResult' ? '' : signalHtml(view, true)) + '</div>';
    var inner = '<div class="v2-otv v2-sotv">' + topRow(view) +
      (d.best != null && d.phase !== 'roundResult' ? '<div class="v2-sobest">' + e(t.今日の最高 + ' ' + d.best + t.点) + '</div>' : '') + '</div>';
    return F().tvc(view, inner, { layer: layer });
  }

  return { phone: phone, tv: tv, resultBody: resultBody, STEP: STEP, timeline: timeline };
});
