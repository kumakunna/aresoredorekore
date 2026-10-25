/* v2-fes.js — 文化祭の部屋の画面の組み立て（指示66-2・見本 docs/指示66/見本/festival.html の F1〜F14）
 *
 * ここは **HTML の字を組むだけ**。部屋の知らせ・本人だけのもの・押した時の動きは index.html がつなぐ
 * （画面ごとに描き直す・残骸が出ない良い型2）。部品は v2-kit.js（window.V2）、字は ui-text.js の FES。
 * 名前は必ず V2.esc を通す（名前に HTML を書いた人がいても、字のまま出す・落とし穴43）。
 *
 * view の形（index.html の fesView が作る）：
 *   { code, max, joinUrl, meId, members:[{id,name,icon,title,role,connected,ready}], fes（部屋の知らせ）,
 *     you（本人だけ：vote・diff・miss・cont・playing）, end（いまの段階の締め切りの時刻）, sel（えらんでいる候補）,
 *     info(mode)（名前・世界・ルール・一言…）, game（部屋の state.game）, data（ゲームの知らせ）, fb（聞く感想） }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.V2Fes = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function U() { return (typeof UiText !== 'undefined' && UiText.FES) || {}; }
  function W() { return (typeof UiText !== 'undefined' && UiText.WORDS) || {}; }
  function K() { return (typeof V2 !== 'undefined') ? V2 : null; }
  function e(s) { return K().esc(s); }

  /** 遊ぶ人（TV の端末をのぞく）。係が隠した人は TV の壁と札から外す（スマホの名簿には ●●● で残る） */
  function people(view, forTv) {
    var hidden = (view.fes && view.fes.hidden) || [];
    return (view.members || []).filter(function (m) {
      if (m.role === 'bigscreen') return false;
      return !(forTv && hidden.indexOf(m.id) !== -1);
    });
  }
  function meOf(view) {
    var ps = people(view);
    return ps.filter(function (m) { return m.id === view.meId; })[0] || { name: '', icon: '' };
  }
  function cdHtml(view, tv, label) {
    return view.end ? K().cd({ end: view.end, tv: !!tv, label: label }) : '';
  }
  function band(view, lab, msg, label) {
    return K().bandHtml({ lab: lab, msg: msg, end: cdHtml(view, false, label) });
  }
  /** ゲームの名前の見出し（名前＋小さく版） */
  function gnameHtml(g, cls) {
    return '<span class="' + cls + '">' + e(g.name) + (g.edition ? '<small>（' + e(g.edition) + '）</small>' : '') + '</span>';
  }
  /** ルールの9割シート（候補ごと。長押しとⓘで同じものが開く） */
  function rulesSheets(view, list) {
    return list.map(function (g) {
      return K().sheetHtml({ id: 'v2Rules-' + g.id, tall: true, cls: 'v2-rsheet v2-w-' + g.world,
        head: K().rheadHtml(g.world, g.name, g.meta), body: K().rulesBigHtml(g.rules),
        foot: '<button type="button" class="v2-btn is-pri" data-v2-close>' + e(W().close) + '</button>' });
    }).join('');
  }

  // ===================== F2 入る（名前とむずかしさ） =====================
  /**
   * 「入る」を押せるか（指示68-0b B2）：名前が空・8字より長い・はじかれた直後（●●●）・むずかしさを選んでいない・送っている途中は押せない。
   * 描く時と、字を入れるたび（index.html の input）の両方がこれを使う（片方だけ直さない）
   */
  function joinOk(o) {
    var len = o.masked ? 0 : Array.from(String(o.name || '').trim()).length;
    return !!o.diff && !o.busy && len > 0 && len <= 8;
  }
  /** o：{ code, n, name, diff, error, busy, full（満員で入れなかった）, reserved（予約した何番目） } */
  function join(o) {
    var J = U().入る, V = K();
    var len = o.masked ? 0 : Array.from(String(o.name || '')).length;
    var h = V.bgHtml() + V.brandHtml() + V.cornerHtml({}) +
      '<div class="v2-in is-scroll">' +
        V.hdHtml('Join', J.見出し) +
        '<div class="v2-pills"><span class="v2-pill">' + e(J.部屋 + ' ' + (o.code || '')) + '</span>' +
          (o.n != null ? '<span class="v2-pill">' + e(J.いま + ' ' + o.n + UiText.V2.人) + '</span>' : '') + '</div>' +
        '<label class="v2-field"><span class="v2-field-l">' + e(J.名前の札) + '</span>' +
          // はじいた名前は画面に残さない（見本 F2b：まわりの人に見えないよう ●●● にする）
          '<span class="v2-inp' + (o.error ? ' is-bad' : '') + '"><input type="text" class="v2-inp-in" data-fes-name maxlength="16" autocomplete="nickname" enterkeyhint="done" value="' + e(o.masked ? '' : (o.name || '')) + '"' + (o.masked ? ' placeholder="●●●"' : '') + '>' +
          '<span class="v2-inp-cnt' + (len > 8 ? ' is-over' : '') + '" data-fes-cnt>' + len + '/8</span></span>' +
          (o.error ? '<span class="v2-why" role="alert">' + e(o.error) + '</span>' : '<span class="v2-hint">' + e(J.本名) + '</span>') +
        '</label>' +
        '<div class="v2-field"><span class="v2-field-l">' + e(J.むずかしさ) + '</span><div class="v2-diffs" role="radiogroup">' +
          J.段.map(function (d) {
            var on = o.diff === d.id;
            return '<button type="button" class="v2-diff' + (on ? ' is-on' : '') + '" role="radio" aria-checked="' + on + '" data-fes-diff="' + e(d.id) + '">' +
              '<span class="v2-diff-f">' + e(d.face) + '</span><span class="v2-diff-t"><b>' + e(d.name) + '</b><span>' + e(d.note) + '</span></span>' +
              (on ? V.icon('check', 'v2-diff-ok') : '') + '</button>';
          }).join('') + '</div></div>' +
        '<div class="v2-spacer"></div>' +
        // 指示66-3：満員の時の予約。予約したら、席が空いた時にこのまま入れる（何番目かを出す）
        (o.reserved ? '<p class="v2-note" role="status">' + e(J.予約した前 + o.reserved + J.予約した後) + '</p>' : '') +
        '<p class="v2-hint v2-c">' + e(J.記録) + '</p>' +
        (o.reserved
          ? '<button type="button" class="v2-btn is-pri" disabled>' + e(J.予約中) + '</button>' +
            '<button type="button" class="v2-btn is-lite" data-fes-act="unreserve">' + e(J.予約をやめる) + '</button>'
          : (o.full && o.diff ? '<button type="button" class="v2-btn is-pri" data-fes-act="reserve"' + (o.busy ? ' disabled' : '') + '>' + e(J.予約する) + '</button>'
            : '<button type="button" class="v2-btn is-pri" data-fes-act="join"' + (joinOk(o) ? '' : ' disabled') + '>' +
              e(o.diff ? J.入る : J.えらんでね) + '</button>')) +
      '</div>';
    return h;
  }

  // ===================== スマホ：段階ごと =====================
  function phone(view) {
    var f = view.fes || {}, you = view.you || {};
    var me = (view.members || []).filter(function (m) { return m.id === view.meId; })[0];
    // 今回のゲームに入らなかった人（準備OK を押さなかった・途中で入った）
    if ((f.phase === 'play' || f.phase === 'result') && me && me.role === 'waiting') return { world: 'wait', html: waiting(view) };
    if (f.phase === 'play') return { world: view.info(f.played.mode).world, html: play(view) };
    switch (f.phase) {
      case 'vote': return { world: 'wait', html: vote(view) };
      case 'decide': return { world: 'wait', html: decide(view) };
      case 'ready': return { world: view.info(f.pick.mode).world, html: ready(view) };
      case 'result': return { world: view.info(f.played.mode).world, html: result(view) };
      default: return { world: 'wait', html: lobby(view) };
    }
  }

  /** F3・F4 待合（66-1 の待合に、前のゲームの感想と一言を足した） */
  function lobby(view) {
    var F = U().待合, V = K(), f = view.fes || {};
    var ps = people(view), me = meOf(view), n = ps.length;
    var fresh = view.fresh || [];
    var 候補 = (view.next || []).map(view.info).filter(Boolean);
    var 並び = [me].concat(ps.filter(function (m) { return m.id !== me.id; }));
    var 顔 = 並び.slice(0, 7).map(function (m) { return V.avHtml(m.icon); }).join('') +
      (並び.length > 7 ? '<span class="v2-faces-more">+' + (並び.length - 7) + '</span>' : '');
    var 次 = n < 2 ? F.そろったら : F.投票;
    var note = f.note === 'too_few' ? F.少なすぎ : (f.note === 'skipped' ? F.とばした : '');
    var h = V.bgHtml() + V.brandHtml() + V.cornerHtml({ who: n, whoOpen: '#v2Roster' }) +
      '<div class="v2-in">' +
        V.hdHtml('Waiting…', F.見出し) +
        V.meHtml(me) +
        // 着替え（F5）：見本データ（lab）で look が無い時は、今までのシート（data-v2-act="look"）
        (view.look ? '<button type="button" class="v2-btn is-lite" data-v2-open="#v2Look" data-fes-act="look">' : '<button type="button" class="v2-btn is-lite" data-v2-act="look">') +
          V.icon('tag') + '<span>' + e(F.着替え) + '</span></button>' +
        '<button type="button" class="v2-facesbtn" data-v2-open="#v2Roster"><span class="v2-facesbtn-l"><span class="v2-lbl">' + e(F.いる人) + '</span>' +
          '<span class="v2-faces">' + 顔 + '</span></span><span class="v2-facesbtn-n"><span>' + n + e(UiText.V2.人) + '</span>' + V.icon('chev') + '</span></button>' +
        (note ? '<p class="v2-note" role="status">' + e(note) + '</p>' : '') +
        (候補.length ? '<div class="v2-nexts"><div class="v2-nexts-l"><span class="v2-lbl">' + e(F.候補) + '</span><span class="v2-lbl">' + e(F.長押し) + '</span></div>' +
          '<div class="v2-nexts-row">' + 候補.map(function (g) {
            return '<button type="button" class="v2-nx" data-v2-lp="#v2Rules-' + e(g.id) + '">' + V.tile(g.world) +
              '<span class="v2-nx-nm v2-cut" data-v2-fit>' + e(g.name) + '</span></button>';
          }).join('') + '</div></div>' : '') +
      '</div>' +
      V.toastHtml('v2TvLook', '📺', F.TVを見て, F.光る) +
      fbPop(view) +
      band(view, F.次は, 次) +
      V.scrimHtml() +
      V.sheetHtml({ id: 'v2Roster', title: F.いる人 + ' ' + n + UiText.V2.人,
        body: '<div class="v2-roster">' + 並び.map(function (m) {
          var st = m.id === me.id ? F.自分 : (fresh.indexOf(m.id) !== -1 ? F.さっき : '');
          return V.rowHtml(m, st, m.id === me.id);
        }).join('') + '</div>' }) +
      fbSheet(view) +
      lookSheets(view.look) +
      rulesSheets(view, 候補);
    return h;
  }

  /**
   * F5 着替え：低いシート（いまの姿・アイコン・二つ名・とじる）から、押した方だけを開く。
   * look：{ icon, title, name, slot, icons:[{id,emoji,on,isNew}], words:{first,joiner,last:[{id,label,on,isNew}]}, sel:{first,joiner,last} }
   * **持っているものだけ並べる**（門E4）
   */
  function lookSheets(look) {
    if (!look) return '';
    var L = U().着替え, V = K(), NEW = '<span class="v2-new">NEW</span>';
    var 新しい = function (list) { return list.some(function (x) { return x.isNew; }); };
    var back = '<button type="button" class="v2-x is-back" data-v2-close aria-label="' + e(L.もどる) + '">' + V.icon('back') + '</button>';
    var preview = '<div class="v2-preview">' + V.avHtml(look.icon, 'is-lg') + '<div class="v2-preview-who"><span class="v2-lbl">' + e(L.TVには) + '</span>' +
      '<span class="v2-preview-nm v2-cut">' + e(look.name) + '</span><span class="v2-preview-tt">' + e(look.title) + '</span></div></div>';
    var slots = [['first', L.はじめ], ['joiner', L.つなぎ], ['last', L.おわり]];
    var words = look.words[look.slot] || [];
    return V.sheetHtml({ id: 'v2Look', title: L.見出し, body: preview +
        '<div class="v2-catbtns">' +
          '<button type="button" class="v2-btn is-sec" data-v2-open="#v2LookIcon">' + V.avHtml(look.icon) + '<span>' + e(L.アイコン) + '</span>' + (新しい(look.icons) ? NEW : '') + V.icon('chev', 'v2-go') + '</button>' +
          '<button type="button" class="v2-btn is-sec" data-v2-open="#v2LookName">' + V.icon('tag') + '<span>' + e(L.二つ名) + '</span>' +
            (新しい(look.words.first.concat(look.words.joiner, look.words.last)) ? NEW : '') + V.icon('chev', 'v2-go') + '</button>' +
          '<button type="button" class="v2-btn is-pri" data-v2-close>' + e(W().close) + '</button></div>' }) +
      V.sheetHtml({ id: 'v2LookIcon', cls: 'is-mid',
        head: '<div class="v2-grab"></div><div class="v2-sh">' + back + '<div class="v2-sh-ttl">' + e(L.アイコンをえらぶ) + '</div><span class="v2-lbl v2-sh-r">' + e(L.TVにもすぐ) + '</span></div>',
        body: '<div class="v2-icongrid">' + look.icons.map(function (x) {
          return '<button type="button" class="' + (x.on ? 'is-on' : '') + '" data-fes-icon="' + e(x.id) + '" aria-pressed="' + x.on + '">' + e(x.emoji) + (x.isNew ? NEW : '') + '</button>';
        }).join('') + '</div><p class="v2-hint v2-look-hint">' + e(L.遊ぶと) + '</p>',
        foot: '<button type="button" class="v2-btn is-pri" data-fes-act="lookicon">' + e(L.これにする) + '</button>' }) +
      V.sheetHtml({ id: 'v2LookName', cls: 'is-mid',
        head: '<div class="v2-grab"></div><div class="v2-sh">' + back + '<div class="v2-sh-ttl">' + e(L.二つ名をえらぶ) + '</div></div>',
        body: '<div class="v2-preview is-plain"><div class="v2-preview-who"><span class="v2-lbl">' + e(L.いまの二つ名) + '</span><span class="v2-preview-nm">' + e(look.title) + '</span></div></div>' +
          '<div class="v2-slots">' + slots.map(function (s) {
            var cur = (look.words[s[0]] || []).filter(function (x) { return x.on; })[0];
            return '<button type="button" class="v2-slot' + (s[0] === 'joiner' ? ' is-join' : '') + (look.slot === s[0] ? ' is-on' : '') + '" data-fes-slot="' + s[0] + '">' +
              '<span class="v2-slot-l">' + e(s[1]) + '</span><b class="v2-cut">' + e(cur ? cur.label : '') + '</b></button>';
          }).join('') + '</div>' +
          '<div class="v2-words">' + words.map(function (x) {
            return '<button type="button" class="' + (x.on ? 'is-on' : '') + '" data-fes-word="' + e(x.id) + '">' + e(x.label) + (x.isNew ? NEW : '') + '</button>';
          }).join('') + '</div><p class="v2-hint v2-look-hint">' + e(L.遊ぶと) + '</p>',
        foot: '<button type="button" class="v2-btn is-pri" data-fes-act="lookname">' + e(L.これにする) + '</button>' });
  }

  /** F4 前のゲームの感想：帯の上から出るカードと、たたんだ「★ 感想」 */
  function fbPop(view) {
    var fb = view.fb; if (!fb) return '';
    var F = U().待合, V = K();
    var g = view.info(fb.mode);
    return '<div class="v2-pop' + (fb.open ? ' is-open' : '') + '" data-v2-id="v2FbPop" aria-hidden="' + (fb.open ? 'false' : 'true') + '">' +
        '<div class="v2-pcard"><div class="v2-pcard-h"><span class="v2-pt">' + e((g ? g.name : '') + F.どうだった) + '</span>' +
          '<button type="button" class="v2-x" data-fes-act="fbfold" aria-label="' + e(W().close) + '">' + V.icon('close') + '</button></div>' +
        starsHtml(fb.stars, false) +
        (fb.sent ? '<span class="v2-sent" role="status">' + V.icon('check') + e(F.送りました) + '</span>' : '') +
        '<button type="button" class="v2-ps" data-v2-open="#v2FbText">' + e(F.ひとこと書く) + ' ›</button></div></div>' +
      '<button type="button" class="v2-minipill is-on" data-fes-act="fbopen">' + V.icon('star') + '<span>' + e(F.感想) + '</span></button>';
  }
  function fbSheet(view) {
    var fb = view.fb; if (!fb) return '';
    var Y = U().やめた;
    return K().sheetHtml({ id: 'v2FbText', title: U().待合.ひとこと書く,
      body: '<textarea class="v2-textarea" data-fes-text maxlength="200" placeholder="' + e(Y.ひとことどうぞ) + '"></textarea>',
      foot: '<button type="button" class="v2-btn is-pri" data-fes-act="fbsend">' + e(Y.送る) + '</button>' });
  }
  function starsHtml(n, sm) {
    var h = '<div class="v2-stars' + (sm ? ' is-sm' : '') + '" role="radiogroup">';
    for (var i = 1; i <= 5; i++) {
      h += '<button type="button" class="' + (n >= i ? 'is-on' : '') + '" role="radio" aria-checked="' + (n === i) + '" aria-label="★' + i + '" data-fes-star="' + i + '">' + K().icon('star') + '</button>';
    }
    return h + '</div>';
  }

  /** F7 投票（20秒）。**票の数は出さない・投票は変わらない**（00 の1・2） */
  function vote(view) {
    var P = U().投票, V = K(), f = view.fes || {}, you = view.you || {};
    var list = (f.candidates || []).map(view.info).filter(Boolean);
    var mine = you.vote || null, sel = mine || view.sel || null;
    var selInfo = sel ? view.info(sel) : null;
    var btn = mine
      ? '<button type="button" class="v2-btn is-done" disabled>' + V.icon('check') + '<span>' + e(P.投票ずみ) + '</span></button>'
      : (sel ? '<button type="button" class="v2-btn is-pri" data-fes-act="vote">' + e(selInfo.name + P.に投票する) + '</button>'
             : '<button type="button" class="v2-btn is-pri" disabled>' + e(P.えらんでね) + '</button>');
    return V.bgHtml() + V.brandHtml() + V.cornerHtml({ who: people(view).length }) +
      '<div class="v2-in">' +
        V.hdHtml('Vote!', P.見出し) +
        '<div class="v2-vlist' + (mine ? ' is-chosen' : '') + '">' + list.map(function (g) {
          var on = sel === g.id, voted = mine === g.id;
          // data-dimok：投票したあとの、えらばなかった札はわざと薄くする（投票はもう変えられない。長押しでルールは見られる。物差しの K2 に数えない・指示68-0b）
          return '<div class="v2-vcard' + (on ? ' is-on' : '') + (voted ? ' is-voted' : '') + '"' + (mine && !on ? ' data-dimok' : '') + ' role="button" tabindex="0" data-fes-pick="' + e(g.id) + '" data-v2-lp="#v2Rules-' + e(g.id) + '">' +
            (voted ? '<span class="v2-vok">' + V.icon('check') + e(P.投票ずみ) + '</span>' : '') +
            V.tile(g.world) +
            '<span class="v2-vt"><span class="v2-vn v2-cut" data-v2-fit>' + e(g.name) + '</span><span class="v2-vb">' + e(g.lead) + '</span>' +
              '<span class="v2-vmeta"><span>' + e(g.kind) + '</span>' + (g.minutes ? '<span>' + e(g.minutes) + '</span>' : '') + '</span></span>' +
            '<button type="button" class="v2-vr" data-v2-open="#v2Rules-' + e(g.id) + '" aria-label="' + e(P.ルール) + '">' + V.icon('rules') + '</button></div>';
        }).join('') + '</div>' +
        '<div class="v2-hint v2-c">' + e(P.ルールは) + '</div>' +
        '<div class="v2-spacer"></div>' + btn +
      '</div>' +
      band(view, P.投票中, mine ? P.変わらない : P.スマホで) +
      V.scrimHtml() + rulesSheets(view, list);
  }

  /** F8 決定（4段：①見出し ②斜めの幕でゲームの世界へ ③印と名前 ④人数と自分の投票）。is-play の時だけ動く */
  function decide(view) {
    var D = U().決定, V = K(), f = view.fes || {}, you = view.you || {};
    var p = f.pick || {}, g = view.info(p.mode);
    var n = (p.counts || {})[p.mode] || 0;
    var who = p.lot === 'zero' ? D.くじ0 : (p.lot === 'tie' ? D.くじ同点 : n + D.えらびました);
    var my = you.vote ? D.自分の投票 + view.info(you.vote).name : D.おまかせ;
    return '<div class="v2-layer v2-w-' + e(g.world) + '">' + V.bgHtml({ names: people(view, true).map(function (m) { return m.name; }) }) + '</div>' +
      '<div class="v2-in v2-swap v2-w-' + e(g.world) + '">' +
        '<div class="v2-a-fade">' + V.hdHtml('Next Game', D.見出し) + '</div>' +
        '<div class="v2-dec">' +
          V.tile(g.world, 'v2-a-slam v2-d1') +
          '<div class="v2-gname v2-a-slam v2-d2">' + gnameHtml(g, 'v2-gname-t') + '</div>' +
          '<div class="v2-who5 v2-a-rise v2-d3">' + e(who) + '</div>' +
          '<div class="v2-myv v2-a-rise v2-d4">' + e(my) + '</div>' +
        '</div>' +
      '</div>';
  }

  /** F9 ルールと準備OK（押した人だけで始める） */
  function ready(view) {
    var R = U().準備, V = K(), f = view.fes || {};
    var g = view.info(f.pick.mode);
    var ps = people(view), n = ps.length;
    var k = ps.filter(function (m) { return m.ready; }).length;
    var me = meOf(view);
    var btn = me.ready
      ? '<button type="button" class="v2-btn is-done" data-fes-act="unready">' + V.icon('check') + '<span>' + e(R.準備OK) + '</span></button>'
      : '<button type="button" class="v2-btn is-pri" data-fes-act="ready">' + e(R.準備OK) + '</button>';
    return V.bgHtml() + V.brandHtml() + V.cornerHtml({}) +
      '<div class="v2-in">' +
        '<div class="v2-hd"><div class="v2-hd-en">Next Game</div><div class="v2-hd-ttl">' + gnameHtml(g, 'v2-hd-g') + '</div><div class="v2-arrow"></div></div>' +
        V.rulesHtml(g.rules) +
        '<button type="button" class="v2-rmore" data-v2-open="#v2Rules-' + e(g.id) + '">' + e(W().more || 'くわしく見る') + V.icon('chev') + '</button>' +
        '<div class="v2-spacer"></div>' + btn +
      '</div>' +
      '<div class="v2-band"><div class="v2-band-what"><span class="v2-band-lab">' + e(R.準備OK帯) + ' <span class="v2-bump" data-fes-k="' + k + '">' + k + '</span>/' + n + e(UiText.V2.人) + '</span>' +
        '<span class="v2-band-msg v2-cut">' + e(R.押した人で) + '</span></div><div class="v2-band-end">' + cdHtml(view, false) + '</div></div>' +
      V.scrimHtml() + rulesSheets(view, [g]);
  }

  /** 今回は入らなかった人：つぎの回から（見本 F9「押さなかった人のスマホには「つぎの回から入れます」」） */
  function waiting(view) {
    var R = U().準備, V = K(), f = view.fes || {};
    var g = f.played ? view.info(f.played.mode) : null;
    return V.bgHtml() + V.brandHtml() + V.cornerHtml({ who: people(view).length }) +
      '<div class="v2-in">' + V.hdHtml('Next…', R.つぎの回に) +
        V.meHtml(meOf(view)) +
        '<p class="v2-note">' + e(R.理由[(view.you || {}).bench] || R.理由.late) + '<br>' + e(R.見ていてね) + '</p>' +
      '</div>' +
      band(view, g ? g.name : '', R.遊んでいます);
  }

  /**
   * F11 遊ぶ：クイズ解除（協力版）のスマホ。盤は今のゲームどおり（番号のマス・縁の色＝むずかしさ）。
   * 挑戦中は点線の縁＋名前（色ではなく形）。外したマスは左上に ✕。問題は下から出るシートで3択。
   * view.secret：本人の盤（wolf:you）、view.data：部屋の知らせのゲームの中身、view.tierLabel(tier)
   */
  function play(view) {
    var P = U().遊ぶ, V = K(), you = view.secret || {}, d = view.data || {};
    var board = you.board || [], team = d.team || {}, open = you.open || null;
    var solved = team.solved != null ? team.solved : (you.solvedCount || 0), total = team.total || you.total || board.length;
    var lives = team.lives != null ? team.lives : you.lives, max = team.livesMax || you.livesMax || 3;
    var T = { easy: 't1', normal: 't2', hard: 't3', nanisore: 't4', muri: 't5' };
    var cells = board.map(function (c, i) {
      var cls = 'v2-bcell ' + (T[c.tier] ? 'is-' + T[c.tier] : '');
      var num = '<span class="v2-bcell-n">' + V.digits(i + 1) + '</span>', inner = num;
      if (c.solved) { cls += ' is-solved'; inner = V.icon('check'); }
      else if (open && open.uid === c.uid) cls += ' is-mine';
      else if (c.by) { cls += ' is-try'; inner = num + '<span class="v2-bcell-who v2-cut">' + e(c.by) + '</span>'; }
      if (c.missed && !c.solved) cls += ' is-miss';
      return '<button type="button" class="' + cls + '" data-fes-cell="' + e(c.uid) + '"' + (c.solved || (c.by && !(open && open.uid === c.uid)) ? ' disabled' : '') + '>' + inner + '</button>';
    }).join('');
    var no = open ? board.map(function (c) { return c.uid; }).indexOf(open.uid) + 1 : 0;
    return V.bgHtml() + V.brandHtml() + V.cornerHtml({}) +
      '<div class="v2-in is-noband v2-play">' +
        '<div class="v2-ptop">' + livesHtml(lives, max) + '<span class="v2-pclock">' + (view.end ? V.cd({ end: view.end, mmss: true, label: '', unit: '' }) : '') + '</span></div>' +
        '<div class="v2-pnum"><b class="v2-num">' + V.digits(solved) + '</b><b class="v2-num v2-pnum-of">/' + V.digits(total) + '</b><span>' + e(P.解除ずみ) + '</span></div>' +
        '<div class="v2-prog"><i style="width:' + (total ? Math.round(solved / total * 100) : 0) + '%"></i></div>' +
        '<div class="v2-row v2-pkey"><span class="v2-pkey-t">' + e(P.えらんで) + '</span><span class="v2-tierkey"><span><i class="is-t1"></i>' + e(P.かんたん) + '</span><span><i class="is-t5"></i>' + e(P.むり) + '</span></span></div>' +
        '<div class="v2-bgrid' + (board.length > 30 ? ' is-c6' : '') + '">' + cells + '</div>' +
      '</div>' +
      V.scrimHtml() +
      '<div class="v2-sheet' + (open ? ' is-open' : '') + ' v2-qsheet" data-v2-id="v2Q" data-v2-keep aria-hidden="' + (open ? 'false' : 'true') + '" role="dialog">' +
        (open ? '<div class="v2-grab"></div><div class="v2-sh"><span class="v2-qtier is-' + (T[open.tier] || 't1') + '">' + e(view.tierLabel ? view.tierLabel(open.tier) : open.tier) + '</span>' +
          '<span class="v2-lbl">' + e(no + P.のコード) + '</span><button type="button" class="v2-x" data-fes-act="bclose" aria-label="' + e(W().close) + '">' + V.icon('close') + '</button></div>' +
          '<div class="v2-qtext" data-v2-wrap>' + V.phrase(open.description || '') + '</div>' +
          '<div class="v2-choices">' + (open.choices || []).map(function (c, i) {
            return '<button type="button" class="v2-choice" data-fes-ans="' + e(c) + '"><span class="v2-choice-k">' + 'ABC'.charAt(i) + '</span><span>' + e(c) + '</span></button>';
          }).join('') + '</div>' : '') +
      '</div>';
  }
  /** F11 遊ぶ（TV）：上の帯（解除中・ゲーム・ライフ・時計）→ 大きな本数と進み具合 → 名前の札（→ 12ばん）と小さな QR */
  function tvPlay(view) {
    var P = U().遊ぶ, V = K(), d = view.data || {}, team = d.team || {}, f = view.fes || {};
    var g = view.info(f.played.mode);
    var board = d.board || [];
    var ps = people(view, true).filter(function (m) { return m.role === 'player'; });
    var 番 = {};
    board.forEach(function (c, i) { if (c.by && !c.solved) 番[c.by] = i + 1; });
    var mins = Math.max(1, Math.round(((d.remainingMs || 0) / 60000) + 1));
    return tvc(view,
      '<div class="v2-tplay"><div class="v2-ttop"><span class="v2-tpill">' + e(P.解除中) + '</span><span class="v2-tsub">' + e(g.name) + '</span>' +
          livesHtml(team.lives, team.livesMax || 3) + '<span class="v2-tclock">' + (view.end ? V.cd({ end: view.end, mmss: true, label: '', unit: '' }) : '') + '</span></div>' +
        '<div class="v2-tmid"><div class="v2-tpn"><b class="v2-num">' + V.digits(team.solved || 0) + '</b><b class="v2-num v2-tpn-of">/' + V.digits(team.total || board.length) + '</b><span>' + e(P.解除ずみ) + '</span></div>' +
          '<div class="v2-tprog"><i style="width:' + (team.total ? Math.round(team.solved / team.total * 100) : 0) + '%"></i></div></div>' +
        // 2列（8人で4段）。QR を黒い所で 350px 以上にしたので、3列ではいちばん幅の広い8字の名前が 42px で入らない（指示68-0b）
        '<div class="v2-tbottom"><div class="v2-tgrid is-c2">' + ps.map(function (m) {
          var n = 番[m.name];
          return '<div class="v2-tmem is-two' + (n ? ' is-try' : '') + '">' + V.avHtml(m.icon) + '<div class="v2-tmem-who"><div class="v2-tmem-nm v2-cut" data-v2-fit="42">' + e(m.name) + '</div>' +
            (n ? '<div class="v2-tmem-tt">→ ' + V.digits(n) + e(P.ばん) + '</div>' : '') + '</div></div>';
        }).join('') + '</div>' + qrHtml(view, 'is-sm', P.つぎの回 + '\n' + P.あと約 + mins + P.分) + '</div></div>');
  }

  /** F12 結果と「つづける？」。協力版はみんなの成績だけ（順位を出さない）、対戦は順位の行 */
  function result(view) {
    var Rz = U().結果, V = K(), f = view.fes || {}, you = view.you || {};
    var g = view.info(f.played.mode);
    var d = view.data || {};
    var body = '';
    if (g.id === 'bomb-coop' && d.team) {
      var t = d.team, ok = t.solved >= t.total;
      var mine = (d.board || []).filter(function (c) { return c.solvedBy && c.solvedBy === meOf(view).name; }).length;
      body = V.hdHtml(ok ? Rz.成功英 : Rz.爆発英, ok ? Rz.成功 : Rz.爆発) +
        '<div class="v2-team"><div class="v2-team-big"><b>' + V.digits(t.solved) + '</b><span>/' + V.digits(t.total) + e(Rz.本) + '</span></div>' +
          '<div class="v2-team-sub">' + e(ok ? Rz.全部 : Rz.あと + (t.total - t.solved) + Rz.だった) + livesHtml(t.lives, t.livesMax) + '</div></div>' +
        '<div class="v2-minebox"><span>' + e(meOf(view).name + Rz.が切った) + '</span><b>' + V.digits(mine) + '<small>' + e(Rz.本) + '</small></b></div>';
    } else {
      var rk = (d.result && d.result.ranking) || [];
      body = V.hdHtml(Rz.おわり英, Rz.おわり) +
        '<div class="v2-ranks">' + rk.map(function (r) {
          var x = r.段絵 ? (r.段絵 + ' ' + (r.段名 || '')) : (r.livesMax ? livesHtml(r.lives, r.livesMax) : '');
          return '<div class="v2-rk' + (r.id === view.meId ? ' is-me' : '') + '"><span class="v2-rk-n v2-num">' + V.digits(r.rank) + '</span>' +
            '<span class="v2-rk-nm v2-cut">' + e(r.name) + '</span><span class="v2-rk-x">' + (r.段絵 ? e(x) : x) + '</span></div>';
        }).join('') + '</div>';
    }
    var cont = you.cont
      ? '<div class="v2-cont-done" role="status">' + V.icon('check') + e(Rz.つづけます) + '</div>'
      : '<div class="v2-btnrow"><button type="button" class="v2-btn is-pri" data-fes-act="continue">' + e(Rz.つづける) + '</button>' +
        '<button type="button" class="v2-btn is-sec" data-fes-act="quit">' + e(Rz.やめる) + '</button></div>';
    return V.bgHtml() + V.brandHtml() +
      '<div class="v2-in">' + body + '</div>' +
      '<div class="v2-sheet is-open v2-contsheet" data-v2-id="v2Cont" data-v2-keep aria-hidden="false"><div class="v2-cont">' +
        '<div class="v2-cont-t">' + e(Rz.つづけて) + '</div>' +
        '<div class="v2-syncbar"><i data-fes-bar style="animation-duration:' + Math.max(0, (view.end || 0) - Date.now()) + 'ms"></i></div>' +
        cont +
        '<div class="v2-cnote">' + e(Rz.押さないと) + (view.end ? V.cd({ end: view.end, label: '', unit: '' }) : '') + e(Rz.秒で) + '</div>' +
      '</div></div>';
  }
  function livesHtml(n, max) {
    var h = '<span class="v2-lives">';
    for (var i = 0; i < (max || 0); i++) h += '<span class="' + (i < n ? 'v2-life' : 'v2-life is-gone') + '">❤️</span>';
    return h + '</span>';
  }

  /** F13 やめた人：感想と称号（部屋を出たあと。o：{ game, stars, sent, title } ） */
  function quit(o) {
    var Y = U().やめた, V = K();
    return V.bgHtml() + V.brandHtml() + V.cornerHtml({}) +
      '<div class="v2-in">' + V.hdHtml(Y.英, Y.見出し) +
        (o.game ? '<div class="v2-card v2-fbcard"><b>' + e(o.game.name + U().待合.どうだった) + '</b>' + starsHtml(o.stars, false) +
          '<textarea class="v2-textarea" data-fes-text maxlength="200" placeholder="' + e(Y.ひとことどうぞ) + '"></textarea>' +
          (o.sent ? '<div class="v2-sent" role="status">' + V.icon('check') + e(Y.送りました) + '</div>'
                  : '<button type="button" class="v2-btn is-pri" data-fes-act="quitsend">' + e(Y.送る) + '</button>') + '</div>' : '') +
        (o.title ? '<div class="v2-me is-title">' + V.avHtml(o.title.icon, 'is-lg') + '<div class="v2-me-who"><div class="v2-me-nm">' + e(Y.称号 + '「' + o.title.name + '」') + '</div>' +
          '<div class="v2-me-tt">' + e(Y.今日は) + '</div></div></div>' : '') +
        '<div class="v2-spacer"></div>' +
        '<button type="button" class="v2-btn is-sec" data-fes-act="rejoin">' + e(Y.もう一度) + '</button>' +
      '</div>';
  }

  // ===================== TV =====================
  function qrHtml(view, cls, cap) {
    var q = '';
    try { q = QR.toSvg(view.joinUrl || '', { quiet: 2, label: U().待合.QR }); } catch (x) { q = ''; }
    return '<div class="v2-tqr' + (cls ? ' ' + cls : '') + '">' + q + (cap ? '<div class="v2-tqr-cap" data-v2-wrap>' + K().phrase(cap) + '</div>' : '') + '</div>';
  }
  function tv(view) {
    var f = view.fes || {};
    switch (f.phase) {
      case 'idle': return { world: 'wait', html: tvIdle(view) };
      case 'vote': return { world: 'wait', html: tvVote(view) };
      case 'decide': return { world: 'wait', html: tvDecide(view) };
      case 'ready': return { world: view.info(f.pick.mode).world, html: tvReady(view) };
      case 'result': return { world: view.info(f.played.mode).world, html: tvResult(view) };
      case 'play': return { world: view.info(f.played.mode).world, html: tvPlay(view) };
      default: return { world: 'wait', html: tvLobby(view) };
    }
  }
  function tvc(view, inner, o) {
    o = o || {};
    var inset = (view.fes && view.fes.inset) || 0;
    return '<div class="v2-tvc' + (o.cls ? ' ' + o.cls : '') + '" style="--v2-inset:' + inset + '">' +
      (o.layer || K().bgHtml({ names: o.names || people(view, true).map(function (m) { return m.name; }) })) +
      K().brandHtml(true) + '<div class="v2-safe">' + inner + '</div></div>';
  }
  /** F6 だれもいない：呼び込み（時計は回さない） */
  function tvIdle(view) {
    var F = U().待合, V = K();
    var tiles = (view.games || []).map(function (id) { var g = view.info(id); return g ? V.tile(g.world, 'v2-ttile') : ''; }).join('');
    return tvc(view,
      '<div class="v2-tvIdle"><div class="v2-tvIdle-l">' + V.hdHtml(F.呼び込み英, F.呼び込み.join('\n'), true) +
        '<div class="v2-tsteps"><div class="v2-tstep"><span class="v2-tstep-ri">' + V.icon('camera') + '</span><span>' + e(F.読む) + '</span></div>' +
          '<div class="v2-tstep"><span class="v2-tstep-ri">' + V.icon('pen') + '</span><span>' + e(F.名前を入れて) + '<em>' + e(U().入る.入る) + '</em>' + e(F.入るを押す) + '</span></div></div>' +
        '<div class="v2-tgames">' + tiles + '<span class="v2-tnote">' + e(F.約) + '</span></div></div>' +
      '<div class="v2-tvIdle-r">' + qrHtml(view) + '<div class="v2-tcode"><span class="v2-tlab">' + e(F.コード) + '</span><b class="v2-en">' + e(view.code) + '</b></div></div></div>', { names: [] });
  }
  /** F3・F6 待合（1人・2〜16人・満員） */
  function tvLobby(view) {
    var F = U().待合, V = K(), f = view.fes || {};
    var ps = people(view, true), n = ps.length;
    var two = n <= 6, cols = n >= 9 ? 3 : 2;
    var 満員 = !!f.full;
    var 左 = 満員
      ? '<div class="v2-tqr is-full">' + V.icon('people') + '<div class="v2-tfull">' + e(F.満員) + '</div><div class="v2-tqr-cap" data-v2-wrap>' + V.phrase(F.つぎの回は.join(String.fromCharCode(10))) + '</div></div>'
      : qrHtml(view);
    var 見出し = n === 1 ? F.あと1人 : F.見出し;
    return tvc(view,
      // 9人からは「名前が主役」：QR を 350px（くまくんの下限・2026-10-24）にして、名前の札を広げる（8字の名前が入る）
      '<div class="v2-tva' + (満員 ? ' is-full' : (cols === 3 ? ' is-many' : '')) + '">' + 左 +
        '<div class="v2-tva-r">' + V.hdHtml('Room', 見出し, true) +
          '<div class="v2-tgrid ' + (cols === 3 ? 'is-c3' : 'is-c2') + '">' +
            ps.map(function (m) { return V.tmemHtml(m, { two: two, sm: cols === 3 }); }).join('') + '</div>' +
          (n === 1 ? '<div class="v2-tnote">' + e(F.友だちと) + '</div>' : '') +
        '</div></div>' +
      V.tbandHtml([
        { lab: 'Room', en: true, num: n, small: '/' + (view.max || '') + UiText.V2.人 },
        { lab: F.コード, val: view.code, valEn: true },
        { lab: F.次は, val: n < 2 ? F.そろったら : F.投票, grow: true }
      ], view.end ? cdHtml(view, true) : ''));
  }
  /** F7 投票（TV）：候補だけ。**票の数は出さない** */
  function tvVote(view) {
    var P = U().投票, V = K(), f = view.fes || {};
    var list = (f.candidates || []).map(view.info).filter(Boolean);
    return tvc(view,
      '<div class="v2-tin">' + V.hdHtml('Vote!', P.見出し, true) +
        '<div class="v2-tvVote"><div class="v2-vrows">' + list.map(function (g) {
          return '<div class="v2-tvrow">' + V.tile(g.world) + '<span class="v2-vt"><span class="v2-vn">' + e(g.name) + '</span><span class="v2-vb">' + e(g.lead) + '</span></span>' +
            '<span class="v2-vmeta"><span>' + e(g.kind) + '</span>' + (g.minutes ? '<span>' + e(g.minutes) + '</span>' : '') + '</span></div>';
        }).join('') + '</div>' +
        '<div class="v2-qrside">' + qrHtml(view, 'is-sm', P.いまから) + '</div></div></div>' +
      V.tbandHtml([{ lab: P.投票中, val: P.スマホで, grow: true }], cdHtml(view, true)));
  }
  /** F8 決定（TV）。TV は「自分の投票」を出さない（TV で「あなた」を使わない決まり） */
  function tvDecide(view) {
    var D = U().決定, V = K(), f = view.fes || {};
    var p = f.pick || {}, g = view.info(p.mode);
    var n = (p.counts || {})[p.mode] || 0;
    var who = p.lot === 'zero' ? D.くじ0 : (p.lot === 'tie' ? D.くじ同点 : n + D.えらびました);
    return tvc(view,
      '<div class="v2-tdec v2-swap v2-w-' + e(g.world) + '"><div class="v2-a-fade">' + V.hdHtml('Next Game', D.見出し, true) + '</div>' +
        '<div class="v2-tdec-mid">' + V.tile(g.world, 'v2-a-slam v2-d1') +
          '<div class="v2-gname v2-a-slam v2-d2">' + gnameHtml(g, 'v2-gname-t') + '</div>' +
          '<div class="v2-who5 v2-a-rise v2-d3">' + e(who) + '</div></div></div>',
      { layer: '<div class="v2-layer v2-w-' + e(g.world) + '">' + V.bgHtml({ names: people(view, true).map(function (m) { return m.name; }) }) + '</div>' + V.bgHtml() });
  }
  /** F9 ルールと準備OK（TV）：ルール3枚・準備OK・右下に小さなQR。待っている人は2人までは名前、3人からは数で（アプリの「待っています」と同じ・見本 t9） */
  function tvReady(view) {
    var R = U().準備, V = K(), f = view.fes || {};
    var g = view.info(f.pick.mode);
    var ps = people(view, true), n = ps.length;
    var ok = ps.filter(function (m) { return m.ready; });
    var wait = ps.filter(function (m) { return !m.ready; });
    var 待ち = !wait.length ? '' : (wait.length <= 2 ? wait.map(function (m) { return m.name; }).join('・') + R.さんを : wait.length + R.待っています);
    return tvc(view,
      '<div class="v2-tvB"><div class="v2-tvB-l">' +
        '<div class="v2-thd"><div class="v2-thd-en">Next Game</div><div class="v2-thd-ttl v2-tg">' + V.tile(g.world, 'v2-tg-tile') + gnameHtml(g, 'v2-tg-n') + '</div><div class="v2-arrow"></div></div>' +
        '<div class="v2-trules">' + (g.rules || []).slice(0, 3).map(function (r) {
          return '<div class="v2-trule"><span class="v2-trule-ri">' + e(r[0]) + '</span><span class="v2-trule-t" data-v2-wrap>' + V.phrase(r[1]) + '</span></div>';
        }).join('') + '</div>' +
        '<div class="v2-tgrid is-c3">' + ps.map(function (m) {
          return '<div class="v2-tmem is-sm ' + (m.ready ? 'is-ok' : 'is-wait') + '">' + V.avHtml(m.icon) + '<div class="v2-tmem-who"><div class="v2-tmem-nm v2-cut" data-v2-fit="42">' + e(m.name) + '</div></div>' +
            '<span class="v2-tmem-st">' + (m.ready ? V.icon('check') : '…') + '</span></div>';
        }).join('') + '</div></div>' +
      '<div class="v2-qrside">' + qrHtml(view, 'is-sm', R.つぎの回に) + '</div></div>' +
      V.tbandHtml([
        { lab: 'Ready', en: true, num: ok.length, small: '/' + n + UiText.V2.人 },
        { lab: R.準備中, val: 待ち, grow: true }
      ], cdHtml(view, true)));
  }
  /** F12 結果（TV）。成功は名前の壁が金色、爆発は暗く静かに。責めない言い方 */
  function tvResult(view) {
    var Rz = U().結果, V = K(), f = view.fes || {};
    var g = view.info(f.played.mode), d = view.data || {};
    var inner;
    var names = people(view, true).map(function (m) { return m.name; });
    var cls = '';
    if (g.id === 'bomb-coop' && d.team) {
      var t = d.team, ok = t.solved >= t.total;
      var r = d.result || {};
      cls = ok ? 'is-gold' : 'is-dim';
      inner = '<div class="v2-tend"><div class="v2-tbig' + (ok ? ' v2-a-slam' : ' is-dim') + '">' + e(ok ? Rz.成功 : Rz.爆発) + '</div>' +
        '<div class="v2-tstat' + (ok ? '' : ' is-dim') + '"><span>' + V.digits(t.solved) + '/' + V.digits(t.total) + '</span><b class="v2-tstat-sl"></b><span>' + clockText(r.elapsedSec) + '</span></div>' +
        (ok ? livesHtml(t.lives, t.livesMax) : '<div class="v2-tnote">' + e(Rz.あと + (t.total - t.solved) + Rz.だった) + '</div>') + '</div>';
    } else {
      var rk = (d.result && d.result.ranking) || [];
      inner = '<div class="v2-tend"><div class="v2-tbig">' + e(Rz.おわり) + '</div><div class="v2-tranks">' + rk.slice(0, 6).map(function (x) {
        return '<div class="v2-trk"><span class="v2-num">' + V.digits(x.rank) + '</span><span class="v2-cut">' + e(x.name) + '</span></div>';
      }).join('') + '</div></div>';
    }
    return tvc(view,
      '<div class="v2-thd"><div class="v2-thd-ttl">' + gnameHtml(g, 'v2-tg-n') + '</div><div class="v2-arrow"></div></div>' + inner +
      // 帯は右に「もどるまで ◯秒」だけ（見本 t12）
      '<div class="v2-tband is-end"><div class="v2-band-end">' + (view.end ? V.cd({ end: view.end, tv: true, label: Rz.もどるまで }) : '') + '</div></div>', { cls: cls, names: names });
  }
  function clockText(sec) {
    sec = Math.max(0, sec | 0);
    var m = Math.floor(sec / 60), s = sec % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  // ===================== F14 係の画面 =====================
  /** o：{ staff（サーバーの係の名簿）, fb（感想の一覧）, end, err } */
  function staff(o) {
    var S = U().係, V = K();
    if (o.err) return V.bgHtml() + '<div class="v2-in">' + V.hdHtml(S.英, S.見出し) + '<p class="v2-note">' + e(o.err) + '</p>' +
      (o.canCreate ? '<button type="button" class="v2-btn is-pri" data-fes-act="create">' + e(S.作る) + '</button>' : '') + '</div>';
    var st = o.staff || {}, f = st.fes || {};
    var mem = st.members || [];
    var live = mem.filter(function (m) { return m.connected; }).length;
    // 指示68-0b B5：段階と「のこり ◯秒」は別の行（「投票中・のこり」と「２０ 秒」が2行に分かれ、数字と単位が離れていた）
    var いま = f.paused ? S.止まっている : (S.段階[f.phase] || '');
    var fb = o.fb || [];
    return V.bgHtml() + V.brandHtml() + V.cornerHtml({}) +
      '<div class="v2-in is-scroll v2-adm">' + V.hdHtml(S.英, S.見出し) +
        '<div class="v2-adm-st">' +
          '<div class="v2-adm-s"><span class="v2-lbl">' + e(S.いま) + '</span><b>' + e(いま) + '</b>' + (o.end && !f.paused ? '<span class="v2-adm-cd">' + V.cd({ end: o.end, label: S.のこり }) + '</span>' : '') + '</div>' +
          '<div class="v2-adm-s"><span class="v2-lbl">' + e(S.部屋) + '</span><b>' + e(live + '/' + (f.max || 16) + UiText.V2.人) + ' · <span class="v2-en">' + e(st.code || '') + '</span></b></div>' +
          '<div class="v2-adm-s"><span class="v2-lbl">' + e(S.TV) + '</span><b class="' + (st.tv ? 'is-ok' : 'is-ng') + '">' + e(st.tv ? S.つながっている : S.つながっていない) + '</b></div>' +
          '<div class="v2-adm-s"><span class="v2-lbl">' + e(S.回数) + '</span><b>' + e((f.round || 1) + S.回目) + '</b></div>' +
        '</div>' +
        '<div class="v2-adm-ops">' +
          '<button type="button" class="v2-btn is-sec" data-fes-act="pause">' + V.icon(f.paused ? 'play' : 'pause') + '<span>' + e(f.paused ? S.つづける : S.一時停止) + '</span></button>' +
          '<button type="button" class="v2-btn is-sec" data-fes-act="skip">' + V.icon('skip') + '<span>' + e(S.とばす) + '</span></button>' +
          '<button type="button" class="v2-btn is-sec" data-v2-open="#v2Calib">' + V.icon('calib') + '<span>' + e(S.端あわせ) + '</span></button>' +
          '<button type="button" class="v2-btn is-sec" data-v2-open="#v2Recreate">' + V.icon('refresh') + '<span>' + e(S.作り直す) + '</span></button>' +
          // 指示68-0b B5：「感想を見る」「名前の記録」も係の操作の並びに（名簿が長いと下に隠れていた）
          (o.canFb ? '<button type="button" class="v2-btn is-sec" data-fes-act="fb" aria-label="' + e(S.感想を見る) + '">' + V.icon('star') + '<span>' + e(S.感想 + '（' + fb.length + S.件 + '）') + '</span></button>' : '') +
          // 指示66-3：くまくん（owner）だけ、名前の記録を読む画面へ（別のタブで開く）
          (o.canNames ? '<a class="v2-btn is-sec" href="/fes/names" target="_blank" rel="noopener">' + V.icon('list') + '<span>' + e(S.名前の記録) + '</span></a>' : '') +
        '</div>' +
        '<span class="v2-lbl">' + e(S.いる人) + '</span>' +
        '<div class="v2-adm-mem">' + (mem.length ? mem.map(function (m) {
          // 指示68-0b B5：隠した人は名前を灰色にして、横に「かくし中」の札（「●●● びび」が名前の一部に見えていた）
          return '<div class="v2-adm-r' + (m.connected ? '' : ' is-off') + (m.hidden ? ' is-hidden' : '') + '"><span class="v2-adm-who"><span class="v2-adm-nm v2-cut" data-v2-fit="12">' + e(m.name) + '</span>' +
            (m.hidden ? '<span class="v2-adm-tag">' + e(S.かくし中) + '</span>' : '') + '</span>' +
            '<button type="button" class="v2-adm-b' + (m.hidden ? ' is-on' : '') + '" data-fes-hide="' + e(m.id) + '" data-hidden="' + (m.hidden ? '1' : '') + '">' + V.icon(m.hidden ? 'eye' : 'eyeoff') + e(m.hidden ? S.もどす : S.隠す) + '</button>' +
            '<button type="button" class="v2-adm-b" data-fes-kick="' + e(m.id) + '">' + e(S.外す) + '</button></div>';
        }).join('') : '<p class="v2-note">' + e(S.いない) + '</p>') + '</div>' +
      '</div>' +
      V.scrimHtml() + V.scrimHtml(true) +
      V.dlgHtml({ id: 'v2Recreate', keep: true, title: S.作り直しますか, text: S.作り直し説明,
        btns: [{ label: S.作り直す確定, pri: true, act: 'recreate' }, { label: S.やめる }] }) +
      // 指示68-0b A4：「外す」は押したらたずねる。だれを外すか（o.kickName）は押した時に決まる（index.html の fesAskKick）
      V.dlgHtml({ id: 'v2Kick', keep: true, title: (o.kickName || '') + S.外しますか後, text: S.外す説明,
        btns: [{ label: S.外す確定, pri: true, act: 'fes-kick-ok' }, { label: S.やめる }] }) +
      V.sheetHtml({ id: 'v2Calib', title: S.端あわせ, body: '<p class="v2-hint">' + e(S.端あわせ説明) + '</p><div class="v2-calib-ops">' +
        [0, 2.5, 5].map(function (v) { return '<button type="button" class="v2-btn ' + ((f.inset || 0) === v ? 'is-pri' : 'is-sec') + '" data-fes-inset="' + v + '">' + v + '%</button>'; }).join('') + '</div>' }) +
      V.sheetHtml({ id: 'v2Fb', tall: true, title: S.感想 + '（' + S.今日 + ' ' + fb.length + S.件 + '）', body: fbList(fb, o.info) });
  }
  function fbList(fb, info) {
    var V = K(), S = U().係;
    var sum = {};
    fb.forEach(function (x) { if (x.stars) { (sum[x.mode] = sum[x.mode] || []).push(x.stars); } });
    var 平均 = Object.keys(sum).map(function (mode) {
      var a = sum[mode], avg = a.reduce(function (p, c) { return p + c; }, 0) / a.length;
      var g = info ? info(mode) : null;
      return '<div class="v2-fbsum-s"><span class="v2-lbl">' + e(g ? g.name : mode) + '</span><b>★ ' + avg.toFixed(1) + '</b></div>';
    }).join('');
    return (平均 ? '<div class="v2-fbsum">' + 平均 + '</div>' : '') +
      '<div class="v2-fb">' + fb.map(function (x) {
        var g = info ? info(x.mode) : null, t = new Date(x.at);
        var hm = (t.getHours() < 10 ? '0' : '') + t.getHours() + ':' + (t.getMinutes() < 10 ? '0' : '') + t.getMinutes();
        var stars = ''; for (var i = 0; i < (x.stars || 0); i++) stars += V.icon('star');
        return '<div class="v2-fb-f"><div class="v2-fb-h"><span class="v2-fb-st">' + stars + '</span>' + e((g ? g.name : x.mode) + '・' + hm) + '</div>' +
          '<p>' + e(x.text || S.ひとことなし) + '</p></div>';
      }).join('') + '</div>';
  }

  return { join: join, joinOk: joinOk, phone: phone, tv: tv, quit: quit, staff: staff, people: people, clockText: clockText,
    // 指示66-3：着替えのシートは、ふだんの部屋の待合（E4）も同じものを使う（見本「着替えは文化祭と同じシート」）
    lookSheets: lookSheets };
});
