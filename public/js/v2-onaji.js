/**
 * public/js/v2-onaji.js — 「みんなと同じ」の画面（指示68-3）。新しい見た目（V2 の部品）で組む。
 *
 * 部品は作らない：選ぶ札は文化祭の投票の札（.v2-vlist／.v2-vcard）、TV の名札は待合の札（V2.tmemHtml）、
 * TV の外枠は文化祭の TV（V2Fes.tvc）を使い回す（写さない・指示書「投票の部品を使い回す」）。
 *
 * ---- 秘密 ----
 *   開くまで（choose）に描く物は、お題・選択肢・のこり時間・**選び終わった人の名前**だけ。
 *   答えごとの人数・だれが何を選んだかは、サーバーが開くまで配らない（onaji-room.js の publicView）。
 *   ここは届いた物を描くだけで、数えない。
 *
 * view：{ data（部屋の知らせのゲームの中身＝publicView）, you（本人だけ＝privateFor）, meId, members,
 *         host（進行役か）, fesRoom（文化祭の部屋か）, fes:{ inset }, end（のこり時間の締め切り・端末の時計） }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.V2Onaji = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function T() { return (typeof UiText !== 'undefined' && UiText.ONAJI) || {}; }
  function K() { return (typeof V2 !== 'undefined') ? V2 : null; }
  function F() { return (typeof V2Fes !== 'undefined') ? V2Fes : null; }
  function e(s) { return K().esc(s); }
  var KEYS = 'ABCD';

  function isPlayer(view) {
    var d = view.data || {};
    return (d.players || []).some(function (p) { return p.id === view.meId; });
  }
  function modeName(d) { return (T().モード || {})[d.mode] || ''; }
  function iconsById(view) {
    var o = {};
    (view.members || []).forEach(function (m) { o[m.id] = m.icon; });
    return o;
  }
  /** 上の行：何問目・遊び方・のこり時間（スマホと TV で同じ並び） */
  function topRow(view, tv) {
    var d = view.data || {}, V = K(), t = T();
    // TV は解除中の TV と同じ「00:10」の形（見出しも単位も付けない）
    var clock = d.phase === 'choose' && view.end ? (tv ? V.cd({ end: view.end, mmss: true, label: '', unit: '' }) : V.cd({ end: view.end, label: '', unit: t.秒 })) : '';
    return '<div class="v2-otop"><span class="v2-opill"><b class="v2-num">' + V.digits(d.round || 1) + '</b><small>/' + V.digits(d.total || 5) + '</small>' + e(t.問目) + '</span>' +
      '<span class="v2-omode">' + e(modeName(d)) + '</span><span class="v2-oclock">' + clock + '</span></div>';
  }

  // ===================== スマホ =====================
  function phone(view) {
    var d = view.data || {}, V = K();
    var head = V.bgHtml() + V.brandHtml() + V.cornerHtml({});
    if (!isPlayer(view) && d.phase !== 'ended') {
      return head + '<div class="v2-in">' + V.hdHtml('Next…', T().見ていて見出し) + '<p class="v2-note">' + e(T().見ていてね) + '</p></div>';
    }
    if (d.phase === 'unveil') return head + '<div class="v2-in is-noband v2-oph">' + topRow(view) + unveilHtml(view, false) + mineHtml(view) + '</div>';
    if (d.phase === 'ended') return head + '<div class="v2-in is-scroll v2-oph">' + resultBody(view, false) + endButtons(view) + '</div>';
    return head + '<div class="v2-in is-noband v2-oph">' + chooseHtml(view) + '</div>';
  }

  /** 選ぶ：お題と大きな選択肢のボタンだけ。選んだら変えられない（ほかの札は薄く・押せない） */
  function chooseHtml(view) {
    var d = view.data || {}, you = view.you || {}, V = K(), t = T();
    var topic = d.topic || { q: '', choices: [] };
    var mine = typeof you.myChoice === 'number' ? you.myChoice : null;
    return topRow(view) +
      '<div class="v2-oq" data-v2-wrap>' + V.phrase(topic.q) + '</div>' +
      '<div class="v2-vlist v2-ochoices' + (mine != null ? ' is-chosen' : '') + '">' + topic.choices.map(function (c, k) {
        var on = mine === k;
        // data-dimok：選んだあとの、選ばなかった札はわざと薄くする（もう変えられない・物差しの K2 に数えない）
        return '<div class="v2-vcard v2-ochoice' + (on ? ' is-on' : '') + '"' + (mine != null && !on ? ' data-dimok' : '') +
          ' role="button" tabindex="0"' + (mine != null ? ' aria-disabled="true"' : '') + ' data-onaji-pick="' + k + '">' +
          '<span class="v2-okey">' + KEYS.charAt(k) + '</span><span class="v2-vt"><span class="v2-vn" data-v2-wrap>' + V.phrase(c) + '</span></span>' +
          (on ? '<span class="v2-vok">' + V.icon('check') + e(t.えらんだ) + '</span>' : '') + '</div>';
      }).join('') + '</div>' +
      '<div class="v2-hint v2-c" role="status">' + e(mine != null ? t.まっています : t.えらんで) + '</div>';
  }

  /** 開いたあと、自分のこと（点になった時は大きくほめる。点にならなかった時は何も言わない＝責めない） */
  function mineHtml(view) {
    var d = view.data || {}, r = d.reveal || {}, you = view.you || {}, t = T(), V = K();
    var mine = typeof you.myChoice === 'number' ? you.myChoice : null;
    if (mine == null || !d.topic) return '';
    var got = d.mode !== 'team' && !r.scatter && (r.winners || []).indexOf(mine) !== -1;
    return '<div class="v2-omine' + (got ? ' is-got' : '') + '"><span class="v2-lbl">' + e(t.あなたの答え) + '</span>' +
      '<b class="v2-cut">' + e(KEYS.charAt(mine) + '　' + (d.topic.choices[mine] || '')) + '</b>' +
      (got ? '<span class="v2-oplus">' + e(t.プラス1) + '</span>' : '') + '</div>';
  }

  /**
   * 開く（スマホと TV で同じ組み立て・大きさは CSS）。
   * 「せーの！」→ 割合の棒が0からのびる → いちばん多い（少ない）答えに冠 → その答えの人の名前。
   * 動くのは、その問題を初めて描いた時だけ（画面の箱の .is-play・描き直しで頭から動き直さない）
   */
  function unveilHtml(view, tv) {
    var d = view.data || {}, r = d.reveal || {}, V = K(), t = T();
    var choices = r.choices || (d.topic && d.topic.choices) || [];
    var counts = r.counts || [];
    var answered = counts.reduce(function (a, n) { return a + n; }, 0);
    var crown = (r.scatter ? [] : (r.winners || []));
    var rows = choices.map(function (c, k) {
      var n = counts[k] || 0, pct = answered ? Math.round(n / answered * 100) : 0, win = crown.indexOf(k) !== -1;
      return '<div class="v2-obar' + (win ? ' is-win' : '') + (n ? '' : ' is-zero') + '" style="--p:' + pct + '%">' +
        '<span class="v2-okey">' + KEYS.charAt(k) + '</span>' +
        '<span class="v2-obar-t"><span class="v2-obar-c v2-cut">' + e(c) + '</span><span class="v2-obar-tr"><i></i></span></span>' +
        '<span class="v2-obar-n"><b class="v2-num">' + V.digits(n) + '</b><small>' + e(t.人) + '</small></span>' +
        '<span class="v2-ocrown" aria-hidden="true">' + (win ? '👑' : '') + '</span></div>';
    }).join('');
    var names = (r.crowned || []);
    var ban = '';
    if (r.scatter) ban = '<div class="v2-oban is-scatter">' + e(t.ばらばら) + '<small>' + e(t.ばらばら説明) + '</small></div>';
    else if (d.mode === 'team') ban = r.together ? '<div class="v2-oban is-gold">' + e(t.そろった) + '</div>'
      : '<div class="v2-oban">' + e(t.そろい度) + '<b class="v2-num">' + V.digits(r.ratio || 0) + '</b>%</div>';
    return '<div class="v2-ounv' + (tv ? ' is-tv' : '') + '">' +
      '<div class="v2-osay" aria-hidden="true">' + e(t.せーの) + '</div>' +
      '<div class="v2-oqs" data-v2-wrap>' + V.phrase(r.q || (d.topic && d.topic.q) || '') + '</div>' +
      '<div class="v2-obars">' + rows + '</div>' + ban +
      (names.length && !r.scatter && d.mode !== 'team'
        ? '<div class="v2-onames">' + names.map(function (nm) { return '<span class="v2-oname v2-cut">' + e(nm) + '</span>'; }).join('') + '</div>' : '') +
    '</div>';
  }

  /** 結果の中身（スマホ・TV・文化祭の結果の画面で同じ物）。多い方・少ない方は順位、一致団結はそろい度だけ */
  function resultBody(view, tv, o) {
    var d = view.data || {}, res = d.result || {}, V = K(), t = T();
    // 文化祭の結果の TV は、外側がゲームの名前の見出しを持つ（o.noHead）
    var head = o && o.noHead ? '' : V.hdHtml('Result!', t.結果, tv);
    var aw = res.awards || {};
    var awards = '<div class="v2-oaws">' +
      [['same', t.同じ賞], ['solo', t.ひとり賞]].filter(function (x) { return (aw[x[0]] || []).length; }).map(function (x) {
        // 並んだ人が多い時は、はじめの6人と「ほか◯人」（16人で全員が並んでも、札が1行で切れない）
        var ns = aw[x[0]], 見せる = ns.slice(0, 6).join('・') + (ns.length > 6 ? t.ほか + (ns.length - 6) + t.人 : '');
        return '<div class="v2-oaw"><span class="v2-oaw-t">' + e(x[1]) + '</span><span class="v2-oaw-n" data-v2-wrap>' + V.phrase(見せる) + '</span></div>';
      }).join('') + '</div>';
    if (res.mode === 'team') {
      var all = res.questions && res.together === res.questions;
      return head + '<div class="v2-osync' + (all ? ' is-gold' : '') + '"><span class="v2-lbl">' + e(t.そろい度) + '</span>' +
        '<b class="v2-num">' + V.digits(res.sync || 0) + '<small>%</small></b>' +
        '<span class="v2-osync-s">' + e((res.together || 0) + t.そろった数) + '</span>' +
        (all ? '<span class="v2-osync-w">' + e(t.ぴったり) + '</span>' : '') + '</div>' + awards;
    }
    var rk = res.ranking || [];
    var me = rk.filter(function (x) { return x.id === view.meId; })[0];
    return head +
      (me && !tv ? '<div class="v2-minebox"><span>' + e(t.あなたは) + '</span><b>' + V.digits(me.score) + '<small>' + e(t.点) + '</small></b></div>' : '') +
      awards +
      '<div class="v2-ranks v2-oranks' + (rk.length > 8 && tv ? ' is-c2' : '') + '">' + rk.map(function (x) {
        return '<div class="v2-rk' + (x.id === view.meId ? ' is-me' : '') + '"><span class="v2-rk-n v2-num">' + V.digits(x.rank) + '</span>' +
          '<span class="v2-rk-nm v2-cut">' + e(x.name) + '</span><span class="v2-rk-x">' + V.digits(x.score) + e(t.点) + '</span></div>';
      }).join('') + '</div>';
  }

  /** ふだんの部屋の決着：つぎは？（進行役）・部屋をとじる（進行役）・部屋を出る（全員）。文化祭は部屋の流れ（つづける？）が受け持つ */
  function endButtons(view) {
    if (view.fesRoom) return '';
    var t = T();
    return '<div class="v2-spacer"></div>' + (view.host
      ? '<button type="button" class="v2-btn is-pri" data-onaji-act="again">' + e(t.つぎは) + '</button>' +
        '<button type="button" class="v2-btn is-sec" data-onaji-act="end">' + e(t.とじる) + '</button>'
      : '<div class="v2-hint v2-c" role="status">' + e(t.進行役が) + '</div>') +
      '<button type="button" class="v2-btn is-sec" data-onaji-act="leave">' + e(t.出る) + '</button>';
  }

  // ===================== TV =====================
  function tv(view) {
    var d = view.data || {}, V = K(), Fz = F();
    var inner;
    if (d.phase === 'unveil') inner = '<div class="v2-otv">' + topRow(view, true) + unveilHtml(view, true) + '</div>';
    else if (d.phase === 'ended') inner = '<div class="v2-otv is-end">' + resultBody(view, true) + '</div>';
    else inner = '<div class="v2-otv">' + topRow(view, true) + tvChoose(view) + '</div>';
    return Fz.tvc(view, inner, { names: (d.players || []).map(function (p) { return p.name; }) });
  }
  /** 選ぶ（TV）：お題・選択肢・選び終わった人の名前が光る。**答えも人数も出さない**（届いていない） */
  function tvChoose(view) {
    var d = view.data || {}, V = K();
    var topic = d.topic || { q: '', choices: [] };
    var chosen = d.chosen || [], 顔 = iconsById(view);
    var ps = d.players || [], n = ps.length;
    var cols = n <= 6 ? 3 : n <= 12 ? 4 : 4;
    return '<div class="v2-otq" data-v2-wrap>' + V.phrase(topic.q) + '</div>' +
      '<div class="v2-ochs is-n' + topic.choices.length + '">' + topic.choices.map(function (c, k) {
        return '<div class="v2-och"><span class="v2-okey">' + KEYS.charAt(k) + '</span><span class="v2-och-t" data-v2-wrap>' + V.phrase(c) + '</span></div>';
      }).join('') + '</div>' +
      '<div class="v2-tgrid v2-ogrid is-c' + cols + (n > 12 ? ' is-many' : '') + '">' + ps.map(function (p) {
        var ok = chosen.indexOf(p.name) !== -1;
        return '<div class="v2-tmem is-sm ' + (ok ? 'is-ok' : 'is-wait') + '">' + V.avHtml(顔[p.id]) +
          '<div class="v2-tmem-who"><div class="v2-tmem-nm v2-cut" data-v2-fit="42">' + e(p.name) + '</div></div>' +
          '<span class="v2-tmem-st">' + (ok ? V.icon('check') : '…') + '</span></div>';
      }).join('') + '</div>';
  }

  return { phone: phone, tv: tv, resultBody: resultBody, KEYS: KEYS };
});
