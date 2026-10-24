/* v2-home.js — ふだんの画面の組み立て（指示66-3・見本 docs/指示66/見本/entry.html の E1〜E5、select.html の決定・S4〜S6）
 *
 * ここは **HTML の字を組むだけ**。部屋の知らせ・押した時の動きは index.html がつなぐ（66-2 の v2-fes.js と同じ分け方）。
 * 部品は v2-kit.js（window.V2）、字は ui-text.js の HOME。名前は必ず V2.esc を通す（落とし穴43）。
 * 押すものは data-home-act="◯◯"（index.html が1か所で受ける）。
 *
 *   home(o)    E1 入口         o：{ back（もどれる部屋のコード）, who（ログイン名）, open（もう開いている部屋のコード） }
 *   join(o)    E2 部屋に入る   o：{ step:'code'|'name', code, name, err, busy, tv, peek }
 *   room(v)    E3・E4 待合（スマホ）  roomTv(v)  TV の待合（選んでいる間も変えない）
 *   pick(p)    ゲームをえらぶ（一覧 → 1本ずつのページ）
 *   opts(o)    S4 カセットの中のゲーム・モードをえらぶ札    decided(o) S6 決めた時のカード
 *   next(o)    E5 遊び終わった後（進行役）
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.V2Home = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function U() { return (typeof UiText !== 'undefined' && UiText.HOME) || {}; }
  function W() { return (typeof UiText !== 'undefined' && UiText.WORDS) || {}; }
  function K() { return (typeof V2 !== 'undefined') ? V2 : null; }
  function e(s) { return K().esc(s); }
  function 人() { return (typeof UiText !== 'undefined' && UiText.V2 && UiText.V2.人) || '人'; }

  /** 左上の丸ボタン（もどる）。act は data-home-act */
  function backHtml(act, label) {
    return '<div class="v2-corner is-l"><button type="button" class="v2-cbtn" data-home-act="' + e(act) + '" aria-label="' + e(label || W().back || '') + '">' +
      '<span class="v2-ring">' + K().icon('back') + '</span></button></div>';
  }
  /** 見出し（左上に ‹ がある時は、字を ‹ の右から始める） */
  function hd(en, ttl, withBack, free) {
    var h = K().hdHtml(en, ttl);
    var cls = 'v2-hd' + (withBack ? ' is-back' : '') + (free ? ' is-free' : '');
    return h.replace('class="v2-hd"', 'class="' + cls + '"');
  }

  // ===================== E1 入口 =====================
  function home(o) {
    o = o || {};
    var H = U().入口, V = K();
    return V.bgHtml() + V.brandHtml() + V.cornerHtml({}) +
      '<div class="v2-in is-noband">' +
        '<div class="v2-elogo v2-a-rise">' + e(H.ロゴ[0]) + '<br>' + e(H.ロゴ[1]) + '</div>' +
        (o.who ? '<p class="v2-hint">' + e(o.who + H.ログイン中) + '</p>' : '') +
        '<div class="v2-spacer"></div>' +
        (o.back ? '<button type="button" class="v2-btn is-lite v2-a-rise" data-home-act="back">' + V.icon('door') + '<span>' + e(H.もどる前 + o.back + H.もどる後) + '</span></button>' : '') +
        '<button type="button" class="v2-btn is-pri v2-ebig v2-a-rise" data-home-act="make">' + V.icon('tv') +
          '<span class="v2-ebig-t"><span>' + e(H.つくる) + '</span><small>' + e(H.つくる説明) + '</small></span></button>' +
        '<button type="button" class="v2-btn is-sec v2-ebig v2-a-rise" data-home-act="join">' + V.icon('door') +
          '<span class="v2-ebig-t"><span>' + e(H.入る) + '</span><small>' + e(H.入る説明) + '</small></span></button>' +
        '<button type="button" class="v2-btn is-lite v2-a-rise" data-home-act="one">' + V.icon('phone') + '<span>' + e(H['1台']) + '</span></button>' +
      '</div>' +
      V.scrimHtml(true) + (o.dlg || '');
  }

  // ===================== E2 部屋に入る（コード → 名前） =====================
  function join(o) {
    o = o || {};
    var J = U().入る, V = K();
    var h = V.bgHtml() + V.brandHtml() + backHtml('join-back') + '<div class="v2-in is-noband">';
    if (o.step === 'name') {
      var len = Array.from(String(o.name || '')).length;
      h += hd(J.名前英, J.名前見出し, true) +
        '<label class="v2-field v2-a-rise"><span class="v2-field-l">' + e(J.名前の札) + '</span>' +
          '<span class="v2-inp' + (o.err ? ' is-bad' : '') + '"><input type="text" class="v2-inp-in" data-home-name maxlength="16" autocomplete="nickname" enterkeyhint="go" value="' + e(o.name || '') + '">' +
          '<span class="v2-inp-cnt' + (len > 8 ? ' is-over' : '') + '" data-home-cnt>' + len + '/8</span></span>' +
          (o.err ? '<span class="v2-why" role="alert">' + e(o.err) + '</span>' : '') +
        '</label>' +
        (o.peek ? '<p class="v2-note">' + e(o.peek) + '</p>' : '') +
        '<div class="v2-spacer"></div>' +
        '<button type="button" class="v2-btn is-pri" data-home-act="join-go"' + (o.busy ? ' disabled' : '') + '>' + e(o.code + J.に入る) + '</button>';
    } else {
      var code = String(o.code || '').toUpperCase().slice(0, 6), n = code.length;
      var boxes = '';
      for (var i = 0; i < 6; i++) boxes += '<b class="' + (i === n ? 'is-cur' : '') + '">' + e(code.charAt(i)) + '</b>';
      h += hd(J.英, o.tv ? J.TV見出し : J.見出し, true) +
        '<label class="v2-field v2-a-rise"><span class="v2-field-l">' + e(J.コード) + '</span>' +
          '<span class="v2-code6' + (o.err ? ' is-bad' : '') + '"><input type="text" class="v2-code6-in" data-home-code maxlength="6" autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="go" value="' + e(code) + '" aria-label="' + e(J.コード) + '">' + boxes + '</span>' +
          (o.err ? '<span class="v2-why" role="alert">' + e(o.err) + '</span>' : '<span class="v2-hint">' + e(J.コードのヒント) + '</span>') +
        '</label>' +
        (o.tv ? '' : '<button type="button" class="v2-btn is-lite v2-a-rise" data-home-act="qr">' + V.icon('camera') + '<span>' + e(J.QRを読む) + '</span></button>') +
        '<div class="v2-spacer"></div>' +
        '<button type="button" class="v2-btn' + (n === 6 ? ' is-pri' : '') + '" data-home-act="code-go"' + (n === 6 && !o.busy ? '' : ' disabled') + ' data-home-left>' +
          e(n === 6 ? J.入る : J.あと + (6 - n) + J.文字) + '</button>';
    }
    h += '</div>' + V.scrimHtml() +
      V.sheetHtml({ id: 'v2QrHow', title: J.QRを読む, body: '<p class="v2-lead">' + e(J.QRの案内) + '</p><div class="v2-qrscan" data-home-scan></div>',
        foot: '<button type="button" class="v2-btn is-pri" data-v2-close>' + e(W().close) + '</button>' });
    return h;
  }

  // ===================== E3・E4 待合（スマホ） =====================
  /**
   * v：{ host, code, me, others:[member], members（遊ぶ人。TVの端末は入らない）, hostName, look,
   *      picked:{world,name}|null, ready:{count,total}, iReady, canStart, waitText, note, qr, local, tvUrl, ops:{id:[act…]} }
   */
  function room(v) {
    var R = U().部屋, V = K(), ps = v.members || [], n = ps.length;
    var tag = function (m) { return m.isHost ? R.進行役 : ''; };
    var memHtml = function (m, i) {
      var cls = 'v2-mem' + (m.off ? ' is-off' : '') + (v.fresh && v.fresh.indexOf(m.id) !== -1 ? ' v2-born' : '') + (m.ready ? ' is-ok' : '');
      var lp = v.host && m.id !== v.meId ? ' data-v2-lp="#v2Mem-' + e(m.id) + '"' : '';
      return '<div class="' + cls + '"' + lp + '>' + V.avHtml(m.icon) + '<span class="v2-mem-nm v2-cut">' + e(m.name) + '</span>' +
        (v.picked && m.ready ? '<span class="v2-mem-st is-ok">' + V.icon('check') + '</span>' : (tag(m) ? '<span class="v2-mem-st">' + e(tag(m)) + '</span>' : '')) + '</div>';
    };
    var body;
    var band;
    if (v.host) {
      body = hd(R.英, R.見出し) +
        '<button type="button" class="v2-card v2-ecode v2-a-rise" data-v2-open="#v2RoomQr"><span class="v2-lbl">' + e(R.コード) + '</span><b class="v2-en">' + e(v.code) + '</b>' + V.icon('qr', 'v2-ecode-qr') + '</button>' +
        '<button type="button" class="v2-btn is-lite v2-a-rise" data-v2-open="#v2RoomTv">' + V.icon('tv') + '<span>' + e(R.TVに映す) + '</span></button>' +
        '<div class="v2-mems-box"><div class="v2-mems-l"><span class="v2-lbl">' + e(R.入った人 + ' ' + n + 人()) + '</span>' +
          (n > 1 ? '<span class="v2-lbl">' + e(R.長押し) + '</span>' : '') + '</div>' +
          '<div class="v2-mems">' + ps.map(memHtml).join('') + '</div>' +
          (n < 2 ? '<p class="v2-hint">' + e(R.まだ1人) + '</p>' : '') + (v.pair || '') + '</div>';
    } else {
      body = hd(R.英 + ' ' + v.code, R.入りました) +
        V.meHtml({ icon: v.me.icon, name: v.me.name, title: v.me.title || R.二つ名なし }) +
        '<button type="button" class="v2-btn is-lite v2-a-rise"' + (v.look ? ' data-v2-open="#v2Look"' : ' data-v2-act="look"') + '>' + V.icon('smile') + '<span>' + e(R.着替える) + '</span>' + (v.lookNew ? '<span class="v2-new">NEW</span>' : '') + '</button>' +
        '<div class="v2-mems-box"><span class="v2-lbl">' + e(R.ほかの人) + '</span>' +
          '<div class="v2-mems">' + (v.others || []).map(memHtml).join('') + '</div>' + (v.pair || '') + '</div>';
    }
    // ゲームが決まった後（ルールを読んで準備OK → 進行役が「はじめる」）
    var foot = '';
    if (v.picked) {
      foot = '<div class="v2-card is-flat v2-epick"><span class="v2-lbl">' + e(v.picked.label) + '</span><div class="v2-row">' + V.tile(v.picked.world, 'is-sm') +
          '<b class="v2-epick-nm v2-cut">' + e(v.picked.name) + '</b><span class="v2-pill">' + e(v.ready.count + '/' + v.ready.total) + '</span></div></div>' +
        (v.iReady ? '' : '<button type="button" class="v2-btn is-pri" data-home-act="room-ready">' + e(R.準備OK) + '</button>') +
        '<button type="button" class="v2-btn is-lite" data-home-act="room-rules">' + V.icon('rules') + '<span>' + e(R.ルールを見る) + '</span></button>' +
        (v.host ? (v.waitText ? '<p class="v2-note" role="status">' + e(v.waitText) + '</p>' : '') +
          '<button type="button" class="v2-btn ' + (v.iReady ? 'is-pri' : 'is-sec') + '" data-home-act="room-start"' + (v.canStart ? '' : ' disabled') + '>' + e(R.はじめる) + '</button>' : '');
    } else if (v.host) {
      foot = '<button type="button" class="v2-btn is-pri" data-home-act="room-pick">' + V.icon('grid') + '<span>' + e(R.えらぶ) + '</span></button>';
    }
    band = V.bandHtml({ lab: R.待合, msg: v.note || (v.host ? n + R.入っています : R.えらんでいます) });
    var qrSheet = V.sheetHtml({ id: 'v2RoomQr', title: R.QRの見出し,
      body: '<div class="v2-eqr">' + (v.qr || '') + '</div><p class="v2-hint v2-c">' + e(v.local ? R.ローカル : R.QRの説明) + '</p>' +
        '<div class="v2-ecode is-big"><span class="v2-lbl">' + e(R.コード) + '</span><b class="v2-en">' + e(v.code) + '</b></div>' });
    var tvSheet = V.sheetHtml({ id: 'v2RoomTv', title: R.TVの見出し,
      body: '<ol class="v2-esteps"><li><span class="v2-esteps-k">1</span><span>' + e(R.TV手順1) + '<b class="v2-eurl">' + e(v.tvUrl || '') + '</b></span></li>' +
        '<li><span class="v2-esteps-k">2</span><span>' + e(R.TV手順2) + '<b class="v2-en v2-eurl">' + e(v.code) + '</b></span></li>' +
        '<li><span class="v2-esteps-k">3</span><span>' + e(R.TV手順3) + '</span></li></ol>',
      foot: '<button type="button" class="v2-btn is-lite" data-home-act="room-tome">' + V.icon('phone') + '<span>' + e(R.このスマホを) + '</span></button>' +
        '<button type="button" class="v2-btn is-pri" data-v2-close>' + e(W().close) + '</button>' });
    // 札を長押しした人の、できること（外す・進行役にする・TV にする）
    var memSheets = v.host ? ps.filter(function (m) { return m.id !== v.meId; }).map(function (m) {
      return V.sheetHtml({ id: 'v2Mem-' + m.id, title: m.name,
        body: '<div class="v2-catbtns">' + ((v.ops || {})[m.id] || []).map(function (op) {
          return '<button type="button" class="v2-btn ' + (op.danger ? 'is-sec v2-danger' : 'is-sec') + '" data-home-act="' + e(op.act) + '" data-home-who="' + e(m.id) + '">' + V.icon(op.icon) + '<span>' + e(op.label) + '</span></button>';
        }).join('') + '<button type="button" class="v2-btn is-pri" data-v2-close>' + e(W().close) + '</button></div>' });
    }).join('') : '';
    return V.bgHtml() + V.brandHtml() + V.cornerHtml({}) +
      '<div class="v2-in">' + body + '<div class="v2-spacer"></div>' + foot + '</div>' +
      band + V.scrimHtml() + qrSheet + tvSheet + memSheets +
      (v.lookSheets || '') +
      V.sheetHtml({ id: 'v2Album', title: v.albumTitle || '', body: '<div data-home-album></div>' }) +
      V.sheetHtml({ id: 'v2RoomMenu', title: R.英 + ' ' + v.code, body: '<div class="v2-catbtns">' + (v.menu || []).map(function (it) {
        return '<button type="button" class="v2-btn is-sec' + (it.danger ? ' v2-danger' : '') + '" data-home-act="' + e(it.act) + '">' + V.icon(it.icon) + '<span>' + e(it.label) + '</span></button>';
      }).join('') + '</div>' }) +
      V.scrimHtml(true) + (v.dlg || '');
  }

  // ===================== TV の待合（te3。選んでいる間も、このまま） =====================
  /** v：{ code, members, hostName, qr, max } */
  function roomTv(v) {
    var T = U().TV, V = K(), ps = v.members || [], n = ps.length;
    var two = n <= 6, cols = n >= 13 ? 3 : 2;
    var rows = cols === 3 ? Math.ceil(n / 3) : Math.ceil(n / 2);
    return '<div class="v2-tvc">' + V.bgHtml({ names: ps.map(function (m) { return m.name; }) }) + V.brandHtml(true) +
      '<div class="v2-safe">' +
        '<div class="v2-tva' + (cols === 3 ? ' is-many' : '') + (rows > 5 ? ' is-low' : '') + '">' +
          '<div class="v2-tqr">' + (v.qr || '') + '<div class="v2-tqr-cap" data-v2-wrap>' + V.phrase(T.QR) + '</div></div>' +
          '<div class="v2-tva-r">' + V.hdHtml('Room', T.見出し, true) +
            '<span class="v2-tnote">' + e(T.入った人 + ' ' + n + 人()) + '</span>' +
            '<div class="v2-tgrid ' + (cols === 3 ? 'is-c3' : 'is-c2') + '">' +
              ps.map(function (m) {
                var h = V.tmemHtml(m, { two: two, sm: !two });
                return (v.fresh && v.fresh.indexOf(m.id) !== -1) ? h.replace('class="v2-tmem', 'class="v2-born v2-tmem') : h;
              }).join('') + '</div>' +
            (n < 2 ? '<div class="v2-tnote">' + e(T.ひとり) + '</div>' : '') +
          '</div></div>' +
        V.tbandHtml([
          { lab: 'Room', en: true, num: n, small: '/' + (v.max || 16) + 人() },
          { lab: T.コード, val: v.code, valEn: true },
          { lab: T.進行役, val: v.hostName || '', grow: true }
        ]) +
      '</div></div>';
  }

  // ===================== ゲームをえらぶ（一覧 → 1本ずつのページ） =====================
  /**
   * p：{ ctx:'room'|'one', code, n, faces:[icon], groups:[{id,label,cards:[card]}], soon:[label],
   *      cards:[card]（ページの順＝一覧の順）, cur（開いているページ）, open }
   * card：{ i, id, world, name, blurb, gl, ppl, min, ways, why, rules:[[絵,文]], paused:[文], cta:{ kind, label, sub, btn } }
   */
  function meta(c, short) {
    var P = U().一覧, V = K();
    var w = { both: 'phone', room: 'people', one: 'phone' }[c.ways] || 'phone';
    return '<span class="v2-smeta"><span>' + V.icon('people') + e(c.ppl) + '</span>' +
      (short || !c.min ? '' : '<span>' + V.icon('timer') + e(c.min) + '</span>') +
      '<span>' + V.icon(w) + e(P.遊び方[c.ways] || '') + '</span></span>';
  }
  function cardHtml(c, k) {
    var V = K();
    return '<button type="button" class="v2-scard v2-a-rise' + (c.why ? ' is-no' : '') + '" style="--d:' + (0.04 * (k + 1)).toFixed(2) + 's" data-home-card="' + c.i + '" data-home-id="' + e(c.id) + '">' +
      V.tile(c.world) +
      '<span class="v2-scard-t"><span class="v2-scard-n">' + e(c.name) + '</span><span class="v2-scard-b">' + e(c.blurb) + '</span>' +
        (c.why ? '<span class="v2-swhy">' + V.icon('info') + e(c.why) + '</span>' : meta(c, true)) + '</span>' +
      V.icon('chev', 'v2-go') + '</button>';
  }
  function ctaHtml(c) {
    var V = K(), t = c.cta || {};
    if (t.kind === 'go') return '<button type="button" class="v2-btn is-pri" data-home-act="pick-go">' + e(t.label) + '</button>';
    var h = '<button type="button" class="v2-btn" disabled data-home-why>' + e(t.label) + '</button>';
    if (t.sub) h += '<div class="v2-whyoff">' + e(t.sub) + '</div>';
    if (t.btn) h += '<button type="button" class="v2-btn is-sec" data-home-act="' + e(t.btn.act) + '">' + e(t.btn.label) + '</button>';
    return h;
  }
  function pageHtml(c, cur) {
    var V = K();
    return '<div class="v2-page v2-w-' + e(c.world) + (cur ? ' is-cur' : '') + '" data-home-page="' + c.i + '">' + V.bgHtml() +
      '<div class="v2-pin">' + V.tile(c.world) +
        '<div class="v2-pn v2-cut" data-v2-fit>' + e(c.name) + '</div><div class="v2-pb">' + e(c.blurb) + '</div>' + meta(c) +
        V.rulesHtml(c.rules) +
        (c.paused || []).map(function (t) { return '<div class="v2-spaused">' + V.icon('pause') + '<span>' + e(t) + '</span></div>'; }).join('') +
        // 前の棚の「くわしく ⓘ」（入っているゲームと、ゲームごとの人数）と「達成状況」は、消さずにページの下に置く
        '<div class="v2-plinks"><button type="button" class="v2-olink" data-home-act="pick-more">' + e(U().一覧.くわしく) + V.icon('chev') + '</button>' +
          '<button type="button" class="v2-olink" data-home-act="pick-titles">' + V.icon('trophy') + e(U().一覧.達成状況) + '</button></div>' +
      '</div></div>';
  }
  function pick(p) {
    var P = U().一覧, V = K(), cards = p.cards || [];
    var cur = Math.max(0, Math.min(cards.length - 1, p.cur || 0)), c = cards[cur] || {};
    var ctx = p.ctx === 'room'
      ? '<span class="v2-pill">' + e(P.部屋 + ' ' + (p.code || '')) + '</span><span class="v2-pill">' + e(P.いま + p.n + P.人) + '</span>'
      : '<button type="button" class="v2-pill is-btn" data-v2-open="#v2Heads">' + V.icon('people') + e(p.n ? P.いま + p.n + P.人 : P.何人で) + '</button>';
    var list = (p.groups || []).map(function (g) {
      return '<div class="v2-sgl" data-home-g="' + e(g.id) + '">' + e(g.label) + '</div>' + g.cards.map(cardHtml).join('');
    }).join('') + (p.soon || []).map(function (s) {
      return '<div class="v2-sgl">' + e(s) + '</div><div class="v2-ssoon"><span class="v2-ssoon-q v2-en">?</span>' + e(P.近日) + '</div>';
    }).join('');
    var chips = '<button type="button" class="v2-chip is-on" data-home-chip="all">' + e(P.ぜんぶ) + '</button>' +
      (p.groups || []).map(function (g) { return '<button type="button" class="v2-chip" data-home-chip="' + e(g.id) + '">' + e(g.chip || g.label) + '</button>'; }).join('');
    var faces = (p.faces || []).slice(0, 5).map(function (f) { return V.avHtml(f, 'is-sm'); }).join('');
    return V.bgHtml() + V.brandHtml() + backHtml('pick-exit') +
      '<div class="v2-in">' + hd(P.英, P.見出し, true, true) +
        '<div class="v2-pills">' + ctx + '</div>' +
        '<div class="v2-chips" data-home-chips>' + chips + '</div>' +
        '<div class="v2-slist" data-home-list>' + list + '</div>' +
      '</div>' +
      V.bandHtml({ lab: p.ctx === 'room' ? U().部屋.待合 : P.英, msg: p.ctx === 'room' ? p.wait + P.待っています : P.ひとりで, end: faces ? '<span class="v2-faces">' + faces + '</span>' : '' }) +
      '<div class="v2-ov v2-w-' + e(c.world || 'wait') + (p.open ? ' is-open' : '') + '" data-home-ov aria-hidden="' + (p.open ? 'false' : 'true') + '">' +
        '<div class="v2-pager" data-home-pager><div class="v2-track" data-home-track style="transform:translateX(' + (-100 * cur) + '%)">' +
          cards.map(function (x, k) { return pageHtml(x, k === cur); }).join('') + '</div></div>' +
        '<div class="v2-corner is-l v2-ov-back"><button type="button" class="v2-cbtn" data-home-act="pick-back" aria-label="' + e(P.一覧へ) + '"><span class="v2-ring">' + V.icon('back') + '</span></button></div>' +
        '<button type="button" class="v2-sedge is-l" data-home-act="pick-prev" aria-label="' + e(P.前) + '">' + V.icon('chev') + '</button>' +
        '<button type="button" class="v2-sedge is-r" data-home-act="pick-next" aria-label="' + e(P.次) + '">' + V.icon('chev') + '</button>' +
        '<div class="v2-sbot"><div class="v2-sgname" data-home-gname>' + e((c.gl || '') + '　' + (cur + 1) + ' / ' + cards.length) + '</div>' +
          '<div class="v2-dots" data-home-dots>' + cards.map(function (x, k) { return '<i class="' + (k === cur ? 'is-on' : '') + (x.why ? ' is-no' : '') + '"></i>'; }).join('') + '</div>' +
          '<div class="v2-scta" data-home-cta>' + ctaHtml(c) + '</div></div>' +
      '</div>' +
      V.scrimHtml() +
      (p.ctx === 'room' ? '' : V.sheetHtml({ id: 'v2Heads', title: P.何人で,
        body: '<div class="v2-heads">' + [2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 16, 20].map(function (k) {
          return '<button type="button" class="' + (k === p.n ? 'is-on' : '') + '" data-home-heads="' + k + '">' + k + '</button>';
        }).join('') + '</div><p class="v2-hint">' + e(P.あとで) + '</p>' }));
  }

  // ===================== S4 カセットの中のゲーム・モード（ラジオの札） =====================
  /**
   * o：{ world, name, n（いまの人数・null なら出さない）, items:[{id, icon, title, sub, why, on}], rules（モードの時だけ）, room（部屋のための一言） }
   * 札は押すと data-home-opt に id。押せない札（why）は button にしない
   */
  function ohead(o) {
    var V = K(), P = U().一覧;
    return '<div class="v2-row v2-ohead">' + V.tile(o.world, 'is-sm') + '<b class="v2-ohead-nm v2-cut">' + e(o.name) + '</b>' +
      (o.n ? '<span class="v2-pill">' + e(P.いま + o.n + P.人) + '</span>' : '') + '</div>';
  }
  /** 札だけ。attr：押した札を見分ける属性（ゲームは data-home-opt、モードは今までどおり data-id） */
  function optItems(items, attr) {
    var V = K(); attr = attr || 'data-home-opt';
    return (items || []).map(function (it) {
      var ic = '<span class="v2-oi">' + (it.ic ? V.icon(it.ic) : e(it.icon || '')) + '</span>';
      if (it.why) return '<div class="v2-opt is-off" ' + attr + '="' + e(it.id) + '" data-locked="' + e(it.why) + '">' + ic +
        '<span class="v2-ot"><span class="v2-on1">' + e(it.title) + '</span><span class="v2-owhy">' + e(it.why) + '</span></span></div>';
      return '<button type="button" class="v2-opt' + (it.on ? ' is-on' : '') + '" role="radio" aria-checked="' + !!it.on + '" ' + attr + '="' + e(it.id) + '">' + ic +
        '<span class="v2-ot"><span class="v2-on1">' + e(it.title) + '</span>' + (it.sub ? '<span class="v2-os">' + e(it.sub) + '</span>' : '') + '</span>' +
        '<span class="v2-ock">' + V.icon('check') + '</span></button>';
    }).join('');
  }
  function opts(o) {
    return ohead(o) + '<div class="v2-opts" role="radiogroup">' + optItems(o.items, o.attr) + '</div>' +
      (o.rules ? K().rulesHtml(o.rules) : '') + (o.room ? '<p class="v2-note">' + e(o.room) + '</p>' : '');
  }

  // ===================== S6 決めた時（全員のスマホと TV に同じカード） =====================
  /** o：{ world, name, by, tv, play } */
  function decided(o) {
    var D = U().決めた, V = K();
    var inner = V.bgHtml() +
      '<div class="v2-sdec-en v2-en v2-a-fade">' + e(D.英) + '</div>' +
      V.tile(o.world, 'v2-a-slam') +
      '<div class="v2-sdec-dn v2-cut v2-a-rise" data-v2-fit>' + e(o.name) + '</div>' +
      '<div class="v2-sdec-ln v2-a-draw"></div>' +
      '<div class="v2-sdec-by v2-a-fade">' + e(o.by) + '</div>' +
      (o.tv ? '' : '<div class="v2-sdec-nx v2-a-fade"><span>' + e(D.このあと) + '</span><div class="v2-syncbar is-fill"><i style="animation-duration:1.5s"></i></div></div>');
    return '<div class="v2-sdec v2-w-' + e(o.world) + '">' + inner + '</div>';
  }

  // ===================== E5 遊び終わった後（つぎを決めるのは進行役） =====================
  /**
   * o：{ host, room, game:{world,name,meta}|null, wait, choices:[{id,label}]（index.html の NEXT_CHOICES から、いま出せるものだけ） }
   * 見本は「もう一回／ほかのゲームにする／部屋をとじる」の3つ。今ある「モードを変える」「別のゲームへ」も消さずに、小さく並べる
   */
  function next(o) {
    var N = U().つぎ, V = K(), ch = o.choices || [];
    var by = function (id) { return ch.filter(function (c) { return c.id === id; })[0]; };
    var again = by('again'), mode = by('mode'), game = by('game'), shelf = by('shelf');
    var small = [mode, game].filter(Boolean);
    var choices = !o.host ? '' :
      (again ? '<button type="button" class="v2-btn is-pri v2-a-rise" data-next="again">' + V.icon('refresh') + '<span>' + e(again.label) + '</span></button>' : '') +
      (shelf ? '<button type="button" class="v2-btn ' + (again ? 'is-sec' : 'is-pri') + ' v2-a-rise" data-next="shelf">' + V.icon('grid') + '<span>' + e(N.ほか) + '</span></button>' : '') +
      (small.length ? (small.length > 1 ? '<div class="v2-btnrow">' : '') + small.map(function (c) {
        return '<button type="button" class="v2-btn is-lite v2-a-rise" data-next="' + e(c.id) + '"><span>' + e(c.label) + '</span></button>';
      }).join('') + (small.length > 1 ? '</div>' : '') : '') +
      (o.room ? '<button type="button" class="v2-btn is-lite v2-a-rise" data-home-act="next-close">' + V.icon('door') + '<span>' + e(N.とじる) + '</span></button>' : '');
    return V.bgHtml() + V.brandHtml() + V.cornerHtml({}) +
      '<div class="v2-in">' + V.hdHtml(N.英, N.見出し) +
        (o.game ? '<div class="v2-card is-flat v2-epick v2-a-rise"><span class="v2-lbl">' + e(N.さっき) + '</span><div class="v2-row">' + V.tile(o.game.world, 'is-sm') +
          '<b class="v2-epick-nm v2-cut">' + e(o.game.name) + '</b>' + (o.game.meta ? '<span class="v2-pill">' + e(o.game.meta) + '</span>' : '') + '</div></div>' : '') +
        '<div class="v2-spacer"></div>' +
        '<div class="v2-nextc" id="nextChoices">' + choices + '</div>' +
      '</div>' +
      V.bandHtml({ lab: U().部屋.待合, msg: o.host ? (o.room ? o.wait + N.待っています : '') : N.えらんでいます }) +
      V.scrimHtml(true) +
      (o.room && o.host ? V.dlgHtml({ id: 'v2NextClose', title: N.とじますか, text: N.とじる説明, keep: true,
        btns: [{ label: N.とじる確定, pri: true, act: 'next-close-ok' }, { label: N.やめる }] }) : '');
  }

  return { home: home, join: join, room: room, roomTv: roomTv, pick: pick, cta: ctaHtml, opts: opts, ohead: ohead, optItems: optItems, decided: decided, next: next, meta: meta };
});
