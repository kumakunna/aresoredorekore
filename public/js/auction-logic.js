// auction-logic.js — オークションバトルのルール層（第31弾 第3部）
//
// 設計の芯は bomb-logic.js / defuse-logic.js / quiz-logic.js とまったく同じ:
//   DOM も socket.io も知らない。Node.js から require できる純粋な計算だけを置く。
//
// ---- なぜ作り直したのか ----
// 前のオークションは、実質「AIの説明を聞いて誰が正解か当てる」に
// チップの皮を被せただけで、値をつけて競り合う駆け引きが無かった。
// しかも「入札しても落札できなければ入札額がそのまま消える」ため、
// 当てる自信が無い人ほど賭けられない＝ただの罰ゲームになっていた。
//
// 作り直しの芯は2つ:
//   1. **払うのは落札した人だけ。** 落札できなかった人は何も失わない。
//      これで「いくらまでなら出せるか」を素直に考えられるようになる。
//   2. **品物の一言だけでは価値が分からない。** 同じ一言が複数の価値階層に出る
//      （auction-items.js 参照）。だから読み合いとアイテムに意味が生まれる。
//
// 強制最低入札額（順位が上の人ほど多く賭けさせる足枷）は廃止した。
// 落札できなければ損をしない新ルールと噛み合わない
// （最低額を強制しても、落札しなければ何も起きないので足枷にならない）。

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./auction-items.js'));
  } else {
    root.AuctionLogic = factory(root.AuctionItems);
  }
}(typeof self !== 'undefined' ? self : this, function (Items) {
  'use strict';

  // 遊び方
  var MODE = {
    OPEN: 'open',     // せり上げ式：みんなの前で値が吊り上がっていく
    SEALED: 'sealed'  // 秘密入札：それぞれこっそり金額を決めて、一斉に開ける
  };

  var START_CHIPS = 20;   // 既存のオークションと同じ（記録の目盛りを変えない）
  var MIN_ROUNDS = 3;
  var MAX_ROUNDS = 12;
  var DEFAULT_ROUNDS = 6;

  // せり上げ式で、最後の入札から何秒で締めるか。
  // 誰かが値を上げるたびに、ここまで戻す（競り市の「他にいませんか？」）
  var OPEN_EXTEND_SEC = 8;
  // 秘密入札の考える時間
  var SEALED_BID_SEC = 30;
  // 結果を見せる時間
  var REVEAL_SEC = 8;

  // ---- アイテム（4種。すべて使い切り）----
  // cost はチップ。買えるのは入札の前だけ。
  var ITEMS = [
    {
      id: 'halfticket', name: '半額チケット', icon: '🎟', cost: 4,
      when: 'beforeBid',
      lead: '落札できたら、支払いが半額になる（端数は切り上げ）'
    },
    {
      id: 'doubleup', name: 'ダブルアップ', icon: '✖️', cost: 4,
      when: 'beforeBid',
      // 大ハズレを引いたら損も2倍。だから「当たりを引ける」と読めた時だけ強い
      lead: '落札した品物の価値が2倍になる（ハズレの損も2倍）'
    },
    {
      id: 'appraise', name: '鑑定眼', icon: '🔍', cost: 3,
      when: 'beforeBid',
      lead: '品物のヒントが1つもらえる'
    },
    {
      id: 'retract', name: '撤回権', icon: '↩️', cost: 3,
      when: 'beforeDeadline', sealedOnly: true,
      lead: '締め切り前なら、出した入札額を出し直せる（秘密入札だけ）'
    }
  ];
  function itemById(id) {
    return ITEMS.find(function (x) { return x.id === id; }) || null;
  }
  // その遊び方で使えるアイテムだけ。
  // 一覧を手で書き分けると、片方に足し忘れる（落とし穴4）ので、印から導く
  function itemsFor(mode) {
    return ITEMS.filter(function (x) {
      return !x.sealedOnly || mode === MODE.SEALED;
    });
  }

  function clampInt(v, min, max, fallback) {
    var n = parseInt(v, 10);
    if (!isFinite(n)) n = fallback;
    return Math.max(min, Math.min(max, n));
  }

  function normalizeConfig(cfg) {
    var c = cfg || {};
    return {
      mode: (c.mode === MODE.SEALED) ? MODE.SEALED : MODE.OPEN,
      rounds: clampInt(c.rounds, MIN_ROUNDS, MAX_ROUNDS, DEFAULT_ROUNDS),
      startChips: clampInt(c.startChips, 5, 99, START_CHIPS),
      bidSec: clampInt(c.bidSec, 10, 120, SEALED_BID_SEC),
      extendSec: clampInt(c.extendSec, 3, 30, OPEN_EXTEND_SEC),
      rescue: c.rescue !== false,   // 2ラウンドごとの救済。既定は入れる
      preset: c.preset || null
    };
  }

  // ================= 入札 =================
  /**
   * その金額を出せるか。
   * 「持っているチップまで」だけが決まり。順位による足枷は無い。
   * せり上げ式では、いまの最高額より上でなければ意味がないので、そこも見る。
   */
  function canBid(amount, opts) {
    var n = parseInt(amount, 10);
    if (!isFinite(n) || n < 0) return { ok: false, reason: 'notNumber' };
    if (n > opts.chips) return { ok: false, reason: 'tooMuch' };
    if (opts.mode === MODE.OPEN && n <= (opts.highest || 0)) {
      return { ok: false, reason: 'notHigher' };
    }
    return { ok: true, amount: n };
  }

  /**
   * 落札者を決める。
   * いちばん高い人。同じ金額なら「先に出した人」（サーバーに届いた順）。
   *
   * 同額をランダムで決めると「なぜ負けたのか」を誰にも説明できない。
   * 早い者勝ちなら、負けた人にも理由が言える。
   *
   * @param bids [{ id, amount, at }]  at はサーバーが受け取った時刻
   * @returns {{winnerId, amount}|null} 誰も入札しなければ null（品物は流れる）
   */
  function settleBids(bids) {
    var live = (bids || []).filter(function (b) { return b && b.amount > 0; });
    if (!live.length) return null;
    var best = live[0];
    live.forEach(function (b) {
      if (b.amount > best.amount) best = b;
      else if (b.amount === best.amount && b.at < best.at) best = b;
    });
    return { winnerId: best.id, amount: best.amount };
  }

  /**
   * 落札した人の収支。
   * @param amount 入札額
   * @param item   品物（auction-items.js の1つ）
   * @param used   { halfticket:bool, doubleup:bool }
   * @returns {{ paid, value, delta }}
   */
  function settlePayment(amount, item, used) {
    var u = used || {};
    // 半額の端数は切り上げ。切り捨てにすると、奇数のときだけ妙に得をする
    var paid = u.halfticket ? Math.ceil(amount / 2) : amount;
    var value = u.doubleup ? item.value * 2 : item.value;
    return { paid: paid, value: value, delta: value - paid };
  }

  // ================= 救済 =================
  /**
   * 2ラウンドごとに、その時点で最下位の人へ無料アイテムを1つ配る（既存の仕組みを維持）。
   * 同じチップ数で並んでいたら、全員に配る（1人だけ選ぶ理由がない）。
   * @returns {string[]} 配る相手。無ければ空
   */
  function rescueTargets(players, roundNum, every) {
    var n = every || 2;
    if (!roundNum || roundNum % n !== 0) return [];
    var rows = (players || []).filter(function (p) { return !!p; });
    if (rows.length < 2) return [];
    var min = Math.min.apply(null, rows.map(function (p) { return p.chips; }));
    var max = Math.max.apply(null, rows.map(function (p) { return p.chips; }));
    if (min === max) return []; // 全員同じなら、最下位という状態が無い
    return rows.filter(function (p) { return p.chips === min; })
      .map(function (p) { return p.id; });
  }

  // 救済で配るアイテム。その遊び方で使えるものから1つ
  function rescueItemFor(mode, rnd) {
    var list = itemsFor(mode);
    var r = rnd || Math.random;
    return list[Math.floor(r() * list.length)].id;
  }

  // ================= 表示のための計算 =================
  // 順位。チップが多い順、同じなら名前順で毎回同じ並びにする（表示がちらつかない）
  function rank(rows) {
    var sorted = (rows || []).slice().sort(function (a, b) {
      if (a.chips !== b.chips) return b.chips - a.chips;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
    var out = [], at = 0, shown = 0, prev = null;
    sorted.forEach(function (row) {
      shown++;
      if (row.chips !== prev) { at = shown; prev = row.chips; }
      out.push(Object.assign({}, row, { rank: at }));
    });
    return out;
  }

  // 鑑定眼で出すヒント。同じ人に同じヒントを2回出さない
  function hintFor(item, alreadySeen) {
    var seen = alreadySeen || [];
    var fresh = (item.hints || []).filter(function (h) { return seen.indexOf(h) === -1; });
    if (fresh.length) return fresh[0];
    return null; // もう全部見た
  }

  return {
    MODE: MODE, ITEMS: ITEMS, START_CHIPS: START_CHIPS,
    MIN_ROUNDS: MIN_ROUNDS, MAX_ROUNDS: MAX_ROUNDS, DEFAULT_ROUNDS: DEFAULT_ROUNDS,
    OPEN_EXTEND_SEC: OPEN_EXTEND_SEC, SEALED_BID_SEC: SEALED_BID_SEC, REVEAL_SEC: REVEAL_SEC,
    itemById: itemById, itemsFor: itemsFor,
    normalizeConfig: normalizeConfig,
    canBid: canBid, settleBids: settleBids, settlePayment: settlePayment,
    rescueTargets: rescueTargets, rescueItemFor: rescueItemFor,
    rank: rank, hintFor: hintFor,
    Items: Items
  };
}));
