// public/js/sugoroku-hand.js — すごろく「てふだ」のルール層（第36弾-22）
//
// このゲームだけ、サイコロを振らない。**何マス進むかを、運ではなく自分で決める。**
// そのぶん「進める札を持っているか」がすべてなので、
// 配り方の公平さと、出せる札の判定が芯になる。
//
// ここは画面もsocketも知らない。手渡し版は無い（手札を見せられないため）が、
// 部屋版の進行役（sugoroku-room.js）とテストが同じここを通る。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SugorokuHand = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var HAND_SIZE = 10;          // 1人が持つ札の枚数
  var CARD_MIN = 1;
  var CARD_MAX = 6;
  // 手札の合計。盤は30マスなので、35前後だと「5マスぶんは無駄にできる」計算になる。
  // ぴったり上がりの緊張が効く幅（決めごと㊲）
  var SUM_MIN = 33;
  var SUM_MAX = 38;
  var STUCK_RELIEF = 3;        // 出せる札が無くて進めない時に入るコイン（決めごと㊳）
  var PRICE_MIN = 1;           // 売り札の値段
  var PRICE_MAX = 9;

  /**
   * その札を出せるか。
   *
   * **ぴったり上がり（決めごと㊱）は、この1か所だけが持っている。**
   * カセット共通の決めごと①は「ゴールを超えたらゴール」だが、
   * てふだは自分で選べるので、切り捨てると「大きい札から出すだけ」になり、
   * 交渉（決めごと⑦）が飾りになる。
   * 「超えたらゴール」に戻す判断になった時は、ここだけを直せばよい。
   */
  function canPlay(card, pos, cells) {
    return (pos + card) <= cells;
  }

  /** いま出せる札（重複は残したまま。手札そのものの並び） */
  function playable(hand, pos, cells) {
    return (hand || []).filter(function (c) { return canPlay(c, pos, cells); });
  }
  /** 1枚でも出せるか。出せなければ進めない（そのかわりコインが入る） */
  function canMove(hand, pos, cells) {
    return playable(hand, pos, cells).length > 0;
  }
  /** 出した1枚だけを抜く（同じ数字が複数あっても1枚だけ） */
  function useCard(hand, card) {
    var out = (hand || []).slice();
    var at = out.indexOf(card);
    if (at === -1) return null;
    out.splice(at, 1);
    return out;
  }
  /** 手札の合計。**本人だけが見てよい**（実質「あと何マス進めるか」になる） */
  function handSum(hand) {
    return (hand || []).reduce(function (a, c) { return a + c; }, 0);
  }
  /** 値段として受け取れるか（改造した端末が変な値を入れられないように） */
  function priceOk(n) {
    return typeof n === 'number' && isFinite(n) &&
      Math.floor(n) === n && n >= PRICE_MIN && n <= PRICE_MAX;
  }

  /**
   * 手札を配る。**全員の合計をぴったり同じにする。**
   *
   * 合計に差があると、配った時点で勝負がつく。
   * このゲームは「どの数字を持っているか」で駆け引きするので、
   * 運の要素は合計ではなく**数字の内訳**の側に置く（決めごと㊲）。
   *
   * 作り方：全部1から始めて（合計10）、余りを1ずつ配る。
   * 上限6を超える札には配らないので、必ず 1〜6 に収まる。
   */
  function dealHands(count, rnd) {
    var r = rnd || Math.random;
    var n = Math.max(0, count | 0);
    var total = SUM_MIN + Math.floor(r() * (SUM_MAX - SUM_MIN + 1));
    if (total > SUM_MAX) total = SUM_MAX;      // r() が 1 を返す実装への保険
    var hands = [];
    for (var i = 0; i < n; i++) hands.push(makeHand(total, r));
    return hands;
  }

  // 合計がぴったり total の手札を1つ作る
  function makeHand(total, r) {
    var hand = [];
    for (var i = 0; i < HAND_SIZE; i++) hand.push(CARD_MIN);
    var left = total - HAND_SIZE * CARD_MIN;
    var guard = 0;
    while (left > 0 && guard++ < 10000) {
      var room = [];
      for (var j = 0; j < HAND_SIZE; j++) if (hand[j] < CARD_MAX) room.push(j);
      if (!room.length) break;
      hand[room[Math.floor(r() * room.length)]] += 1;
      left--;
    }
    return shuffle(hand, r);
  }

  function shuffle(list, r) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(r() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /**
   * 交渉：その売り札を買えるか。
   * 買えない理由まで返すのは、断る時に「なぜ」を出すため（原則7）
   */
  function buyError(offer, buyerCoins, buyerId) {
    if (!offer) return 'unknown_target';
    if (offer.sellerId === buyerId) return 'not_expected';   // 自分からは買えない
    if (!priceOk(offer.price)) return 'bad_action';
    if (buyerCoins < offer.price) return 'no_coins';
    return null;
  }

  /**
   * 決着の並べ方。**進んだマスが先、同じなら残ったコインの多い順。**
   * あがった人がいればその人が1位（あがりは1人しか出ない＝ぴったりで着いた人）
   */
  function rankHands(players) {
    var list = (players || []).slice();
    list.sort(function (a, b) {
      var ga = a.goalOrder == null ? 99 : a.goalOrder;
      var gb = b.goalOrder == null ? 99 : b.goalOrder;
      if (ga !== gb) return ga - gb;
      if (b.pos !== a.pos) return b.pos - a.pos;
      return (b.coins || 0) - (a.coins || 0);
    });
    var out = [];
    var rank = 0;
    var prev = null;
    list.forEach(function (p, i) {
      var key = [p.goalOrder == null ? 99 : p.goalOrder, p.pos, p.coins || 0].join('/');
      if (key !== prev) { rank = i + 1; prev = key; }
      out.push({
        id: p.id, name: p.name, pos: p.pos, coins: p.coins || 0,
        goalOrder: p.goalOrder == null ? null : p.goalOrder,
        rank: rank, tied: false
      });
    });
    // 同着に印を付ける（同じ rank が2つ以上あるか）
    out.forEach(function (p) {
      p.tied = out.filter(function (q) { return q.rank === p.rank; }).length > 1;
    });
    return out;
  }

  // ===== 言い回し =====
  // **画面に直書きしない**（決めごと㉖）。部屋の手元と大画面が、同じここを通る

  /** 取引が成立したことの知らせ。誰が誰から何を買ったかは、その後の読み合いの材料 */
  function tradeWords(b) {
    if (!b) return { note: '', hint: '' };
    return {
      note: b.buyerName + ' さんが「' + b.card + '」を買いました',
      hint: b.sellerName + ' さんへ 🪙' + b.price
    };
  }

  /**
   * 1手番の結果。
   * 出せる札が無かった時は**責める場面にしない**。入った方を主語にする（原則7）
   */
  function playWords(mv) {
    if (!mv) return { note: '', hint: '' };
    if (mv.skipped) return { note: '', hint: mv.name + ' さんはいません' };
    if (mv.stuck) {
      return {
        note: 'かわりに コイン+' + mv.relief,
        hint: mv.name + ' さんは、出せる札がありませんでした'
      };
    }
    return {
      note: mv.name + ' さん +' + mv.card,
      hint: mv.goal ? 'あがり！' : ('あと' + mv.left)
    };
  }

  return {
    HAND_SIZE: HAND_SIZE, CARD_MIN: CARD_MIN, CARD_MAX: CARD_MAX,
    SUM_MIN: SUM_MIN, SUM_MAX: SUM_MAX,
    STUCK_RELIEF: STUCK_RELIEF, PRICE_MIN: PRICE_MIN, PRICE_MAX: PRICE_MAX,
    canPlay: canPlay, playable: playable, canMove: canMove,
    useCard: useCard, handSum: handSum, priceOk: priceOk,
    dealHands: dealHands, buyError: buyError, rankHands: rankHands,
    tradeWords: tradeWords, playWords: playWords
  };
}));
