// auction-logic.js — 相場オークションのルール層（第38弾で全面的に作り直し）
//
// ここが**唯一の正本**。サーバーの進行役（auction-room.js）も、画面（index.html）も、
// 数字と文言はここからしか読まない。片方に数字を書き写すと、必ずどちらかが古びる。
//
// ---- この遊びの芯 ----
// 品物は「系統（公開）」と「品質（非公開）」でできている。
// **同じ系統が落札されるたび、その系統の相場が上がる。**
// 得点は「品質値 × その系統の最終相場」なので、
//   ・みんなが群がった系統は、上物なら大きく伸びる
//   ・誰も見向きもしなかった系統は、上物でも小さい
// つまり **安く買い集めて、自分で相場を育てる**という逆転の道がある。
// これが「値段は運ではなく、みんなの行動で決まる」ということ。
//
// ---- 得点の決めごと（2026-09-02 本人の決定） ----
// 得点 = Σ（品質値 × その系統の最終相場） + floor(残チップ / CHIPS_PER_POINT)
// 残チップを少しだけ点にしたのは、**最終ラウンドにもブレーキを効かせるため**。
// 「使いすぎた人は次のラウンドが減る」だけだと、最後のラウンドには効き目が無く、
// 毎回「持ち金を全部吐き出す競り」になって、最後だけ別のゲームになってしまう。
// 3枚で1点は、相場（最大4前後）に対して十分小さいので、
// 貯め込むだけでは勝てない——買わない人が勝つ形にはならない。

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./auction-items.js'));
  } else {
    root.AuctionLogic = factory(root.AuctionItems);
  }
}(typeof self !== 'undefined' ? self : this, function (Items) {
  'use strict';

  // =====================================================================
  // 数字は全部ここ。**他のファイルに書き写さない**
  // =====================================================================
  var RULES = {
    // ---- 人数 ----
    MIN_PLAYERS: 3,
    MAX_PLAYERS: 8,

    // ---- チップ（買うための資源） ----
    START_CHIPS: 20,
    INCOME: 6,          // 各ラウンド開始時の基本収入
    INCOME_TIRED: 3,    // 前ラウンドで使いすぎた人（罰ではなく、物理法則として息切れする）
    TIRED_SPENT: 10,    // 「使いすぎ」の境目（これ以上使うと、次のラウンドの収入が減る）

    // ---- 得点 ----
    // 残チップは3枚で1点。**最終ラウンドにもブレーキを残すための最小限の重み**
    CHIPS_PER_POINT: 3,

    // ---- 相場 ----
    MARKET_START: 1,    // 開場時、どの系統も1
    MARKET_STEP: 1,     // その系統が1つ落札されるたびに+1
    MARKET_HOT: 3,      // これ以上になったら大画面に HEATING UP

    // ---- 品物とラウンド ----
    ITEMS_PER_ROUND: 6, // 内訳（上物2・並物3・偽物1）と揃える
    ROUNDS_DEFAULT: 2,
    ROUNDS_MIN: 1,
    ROUNDS_MAX: 3,

    // ---- 時間（秒） ----
    PREVIEW_SEC_DEFAULT: 60,  // 下見（口で腹の探り合いをする時間）
    PREVIEW_SEC_MIN: 30,
    PREVIEW_SEC_MAX: 90,
    // せり上げ式は「最初の持ち時間」と「延長」が別の数。
    // 最初の持ち時間は、段階ヒント（HINT_STEP_SEC × HINT_STEPS）が
    // 開き切るだけの長さが要る。短いと、ヒントの仕組みごと動かない
    OPEN_START_SEC: 30,       // せり上げ：最初に配る持ち時間
    // 延長は HINT_STEP_SEC(12) より長くする。**この大小関係が約束**：
    // 何秒の時点で入札があっても、締め切りは「入札した時刻＋14秒」なので、
    // ヒント①（12秒）が開く前に品が閉じることが無くなる。
    // 14 にしたのは、開いたヒントが最低でも2秒は見えるようにするため
    // （13だと1秒で、開いた瞬間に木槌が落ちる）
    OPEN_EXTEND_SEC: 14,      // せり上げ：値がついたら、締め切りをここまで延ばす
    SEALED_BID_SEC: 45,       // 秘密入札：考える時間
    CONFIRM_SEC: 12,          // 誰も値をつけなかった時の、最後のひと押し
    GUESS_SEC: 6,             // 値踏み予想
    REVEAL_SEC: 7,            // 開示（順に見せるので、少し長め）
    HINT_STEP_SEC: 12,        // 競り開始から、この間隔で段階ヒントが1つずつ開く
    HINT_STEPS: 2,            // 追加で開くヒントの数（見た目＋2＝計3つ）

    // ---- ごほうび ----
    // 最初に入札した人へ。情報がいちばん少ない時に飛び込む理由をつくる。
    // 値踏み予想(+1)より大きく、品物1つの得点（最低1点・育った相場なら9点）には遠く及ばない額。
    // 6品すべてで1番乗りしても+12枚＝基本収入2ラウンドぶんで、
    // 「ボーナス狙いだけでは勝てないが、飛び込む理由にはなる」ところに置いた
    FIRST_BID_BONUS: 2,
    GUESS_REWARD: 1,          // 値踏み的中。**予想だけで勝てる額にはしない**

    // ---- アイテム ----
    ITEMS_PICK: 1             // ラウンド開始時に、3種から1つだけ選ぶ
  };

  // 使えるアイテム。ラウンド開始時に1つだけ選ぶ（選ぶこと自体が戦略）
  var POWERS = [
    { id: 'appraise', label: '鑑定眼', icon: '🔍',
      lead: '好きな1品の品質を、自分だけが知る',
      // 使ったことは全員に伝えるが、**どの品を見たかは伝えない**（指示38 2-2）
      secretTarget: true },
    { id: 'halfticket', label: '半額チケット', icon: '🪙',
      lead: '落札できたら、支払いが半分になる（端数は切り上げ）',
      secretTarget: false },
    { id: 'market', label: '相場操作', icon: '📣',
      lead: '好きな系統の相場を、落札せずに+1する',
      secretTarget: false }
  ];

  // 文言はここに集める（画面に直書きしない）
  var TEXT = {
    phase: {
      preview: '下見', bid: '競り', confirm: '最後のひと押し',
      guess: '値踏み', reveal: '開示', ended: '決着'
    },
    mode: { open: 'せり上げ式', sealed: '秘密入札' },
    passed: 'だれも値をつけませんでした',
    passedAgain: 'この品は、次の品のあとにもう一度だけ出ます',
    passedGone: 'この品は、誰の手にもわたりませんでした',
    firstBid: '最初に値をつけた',
    hot: 'HEATING UP',
    sold: 'SOLD'
  };

  /**
   * 目安時間（分）。棚とウィザードが同じ数を出すために、ここ1か所で計算する。
   * 1品にかかるのは「競り＋値踏み＋開示」、1ラウンドはそれ×6品＋下見。
   * せり上げ式は延長が1回入る前提で見ておく（実際はもっと伸びることもある）
   */
  function estimateMinutes(cfg) {
    var c = normalizeConfig(cfg);
    var bidSec = (c.mode === 'open')
      ? RULES.OPEN_START_SEC + RULES.OPEN_EXTEND_SEC
      : RULES.SEALED_BID_SEC;
    var perItem = bidSec + RULES.GUESS_SEC + RULES.REVEAL_SEC;
    var perRound = c.previewSec + RULES.ITEMS_PER_ROUND * perItem;
    return Math.max(1, Math.round(c.rounds * perRound / 60));
  }

  function powerById(id) {
    for (var i = 0; i < POWERS.length; i++) if (POWERS[i].id === id) return POWERS[i];
    return null;
  }

  // ---------- 設定 ----------
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function normalizeConfig(cfg) {
    var c = cfg || {};
    var mode = (c.mode === 'open') ? 'open' : 'sealed';
    var rounds = parseInt(c.rounds, 10);
    if (!(rounds > 0)) rounds = RULES.ROUNDS_DEFAULT;
    var preview = parseInt(c.previewSec, 10);
    if (!(preview > 0)) preview = RULES.PREVIEW_SEC_DEFAULT;
    return {
      mode: mode,
      rounds: clamp(rounds, RULES.ROUNDS_MIN, RULES.ROUNDS_MAX),
      previewSec: clamp(preview, RULES.PREVIEW_SEC_MIN, RULES.PREVIEW_SEC_MAX)
    };
  }

  // ---------- 相場 ----------
  function newMarket() {
    var m = {};
    Items.KINDS.forEach(function (k) { m[k.id] = RULES.MARKET_START; });
    return m;
  }
  function bumpMarket(market, kindId) {
    if (!market || !(kindId in market)) return market;
    market[kindId] += RULES.MARKET_STEP;
    return market;
  }
  function isHot(market, kindId) {
    return !!market && market[kindId] >= RULES.MARKET_HOT;
  }

  // ---------- 品物を並べる ----------
  // 品質は「上物2・並物3・偽物1」を混ぜてから配る。
  // **数は必ず内訳どおり**（開場時に数を公開しているので、ここがずれたら嘘になる）
  function shuffle(a, rnd) {
    var r = rnd || Math.random;
    var out = a.slice();
    for (var i = out.length - 1; i > 0; i--) {
      var j = Math.floor(r() * (i + 1));
      var t = out[i]; out[i] = out[j]; out[j] = t;
    }
    return out;
  }
  /**
   * 1ラウンドぶんの品物を作る。
   * usedLooks に入っている見た目は避ける（同じ品が続けて出ると、覚えられて駆け引きが消える）。
   * 足りなくなったら、全部から選び直す（遊びが止まるよりはよい）。
   */
  function buildRound(usedLooks, rnd) {
    var used = usedLooks || {};
    var n = RULES.ITEMS_PER_ROUND;
    // **系統ごとに同じ数を取る。**無作為に6つ取ると「壺0・絵4」のような回が出て、
    // 相場が一度も動かない系統ができてしまう（相場が主役なのに）
    var per = Math.floor(n / Items.KINDS.length);
    var picked = [];
    Items.KINDS.forEach(function (k) {
      var ofKind = Items.ITEMS.filter(function (x) { return x.kind === k.id; });
      var fresh = ofKind.filter(function (x) { return !used[x.look]; });
      var bank = (fresh.length >= per) ? fresh : ofKind;
      picked = picked.concat(shuffle(bank, rnd).slice(0, per));
    });
    // 端数（系統の数で割り切れない分）は、残り全部から埋める
    if (picked.length < n) {
      var rest = Items.ITEMS.filter(function (x) {
        return picked.indexOf(x) === -1 && !used[x.look];
      });
      picked = picked.concat(shuffle(rest, rnd).slice(0, n - picked.length));
    }
    // 並ぶ順は混ぜる（系統ごとに固まって出ると、競りの順が読めてしまう）
    picked = shuffle(picked, rnd);
    var qualities = shuffle(Items.mixQualities(), rnd);
    return picked.map(function (it, i) {
      var q = qualities[i];
      return {
        no: i + 1,                 // 品番号（競りの順番でもある。開場から見えている）
        kind: it.kind,             // 系統（公開）
        look: it.look,             // 見た目＝共通ヒント（公開）
        quality: q,                // 品質（**非公開**）
        steps: it.q[q].steps,      // 段階ヒント（競りが進むと順に公開）
        reveal: it.q[q].reveal     // 正体（開示の瞬間だけ）
      };
    });
  }

  // 開場時に出す内訳の宣言（数だけ・どれがどれかは言わない）
  function mixLine() {
    return Items.MIX.map(function (m) {
      var q = Items.qualityById(m.quality);
      return q.label + m.count;
    }).join('・');
  }

  // ---------- ヒント ----------
  /**
   * その品について、いま全員に見えているヒント。
   * **時間で決める**。入札の回数で決めると、放送の届く順で端末ごとにずれる
   * （門10「全員に同時に届く」を守れなくなる）。
   */
  function hintsVisible(item, elapsedSec) {
    if (!item) return [];
    var out = [item.look];
    var opened = Math.floor((elapsedSec || 0) / RULES.HINT_STEP_SEC);
    var n = Math.max(0, Math.min(RULES.HINT_STEPS, opened));
    for (var i = 0; i < n; i++) out.push(item.steps[i]);
    return out;
  }
  function hintStepsOpened(elapsedSec) {
    return Math.max(0, Math.min(RULES.HINT_STEPS,
      Math.floor((elapsedSec || 0) / RULES.HINT_STEP_SEC)));
  }

  // ---------- 入札 ----------
  /**
   * その額で入札してよいか。
   *   open   … いまの最高額より上（初回は1以上）
   *   sealed … 0以上（0＝降りる）。持ちチップを超えない
   * 「持っていない額は出せない」はサーバー側でも必ず通す（端末の数字を信じない）
   */
  function canBid(mode, amount, chips, highest) {
    var n = Math.floor(Number(amount));
    if (!isFinite(n) || n < 0) return { ok: false, reason: 'bad' };
    if (n > chips) return { ok: false, reason: 'tooMuch' };
    if (mode === 'open') {
      var floorAmt = (highest && highest.amount > 0) ? highest.amount + 1 : 1;
      if (n < floorAmt) return { ok: false, reason: 'notHigher' };
    }
    return { ok: true, amount: n };
  }

  /**
   * 秘密入札の締め切り。いちばん高い人。**同額なら先に出した人**。
   * ランダムにすると「なぜ負けたか」を誰にも説明できない（第31弾の決めごとを踏襲）。
   * 0は「降りる」なので、落札者にはならない。
   */
  function settleSealed(bids) {
    var best = null;
    (bids || []).forEach(function (b) {
      if (!b || !(b.amount > 0)) return;
      if (!best || b.amount > best.amount || (b.amount === best.amount && b.at < best.at)) {
        best = b;
      }
    });
    return best ? { winnerId: best.id, amount: best.amount } : null;
  }

  // 半額チケット。端数は切り上げ（切り捨てだと、奇数の時だけ妙に得をする）
  function payFor(amount, half) {
    var n = Math.max(0, Math.floor(amount || 0));
    return half ? Math.ceil(n / 2) : n;
  }

  // ---------- 収入 ----------
  // 使いすぎた人は、次のラウンドで自動的に息切れする。
  // トップを狙い撃ちにしないのは、**罰ではなく物理法則**にしておきたいから
  function incomeFor(spentLastRound) {
    return (spentLastRound >= RULES.TIRED_SPENT) ? RULES.INCOME_TIRED : RULES.INCOME;
  }

  // ---------- 得点 ----------
  function itemPoints(item, market) {
    if (!item) return 0;
    var v = Items.valueOf(item.quality);
    var m = (market && market[item.kind]) || RULES.MARKET_START;
    return v * m;
  }
  function pointsFromChips(chips) {
    return Math.floor(Math.max(0, chips || 0) / RULES.CHIPS_PER_POINT);
  }
  /**
   * その人の得点。品物の価値＋残チップのぶん。
   * 内訳を返すのは、結果画面で「なぜその点なのか」を出せるようにするため
   * （数字だけ出されても、遊んだ人には理由が分からない）
   */
  function scoreOf(wonItems, market, chips) {
    var items = (wonItems || []).map(function (it) {
      return { item: it, points: itemPoints(it, market) };
    });
    var fromItems = items.reduce(function (n, x) { return n + x.points; }, 0);
    var fromChips = pointsFromChips(chips);
    return { items: items, fromItems: fromItems, fromChips: fromChips, total: fromItems + fromChips };
  }

  // ---------- 値踏み予想 ----------
  function guessReward(guess, quality) {
    return (guess && guess === quality) ? RULES.GUESS_REWARD : 0;
  }

  // ---------- 順位 ----------
  // 1224方式。同じ点なら同じ順位（並びがちらつかない）
  function rank(rows) {
    var sorted = (rows || []).slice().sort(function (a, b) { return b.score - a.score; });
    var out = [];
    sorted.forEach(function (row, i) {
      var same = i > 0 && row.score === sorted[i - 1].score;
      out.push(Object.assign({}, row, { rank: same ? out[i - 1].rank : i + 1 }));
    });
    return out;
  }

  /**
   * 今日の名場面。実データから固定の型で組み立てる（AIは使わない）。
   * 出せるものが無ければ null。**無理に何か言わない**
   * （毎回それらしい一言が出ると、本当に光った回の一言が埋もれる）
   */
  function highlight(history) {
    var h = (history || []).filter(function (x) { return x && !x.passed; });
    if (!h.length) return null;
    // ①「みんなが偽物だと読んだのに、信じて買って当てた」
    var brave = h.filter(function (x) {
      if (x.quality === 'fake') return false;
      var g = x.guesses || [];
      return g.length >= 2 && g.every(function (y) { return y.guess === 'fake'; });
    }).sort(function (a, b) { return b.points - a.points; })[0];
    if (brave) {
      return brave.winner + ' さんは、みんなが偽物と読んだ' + brave.no + '番を信じて ' +
        brave.points + '点を得た';
    }
    // ②「誰も買わなかった系統を、ひとりで育てた」
    var byKind = {};
    h.forEach(function (x) {
      byKind[x.kind] = byKind[x.kind] || {};
      byKind[x.kind][x.winner] = (byKind[x.kind][x.winner] || 0) + 1;
    });
    var solo = null;
    Object.keys(byKind).forEach(function (k) {
      var names = Object.keys(byKind[k]);
      if (names.length === 1 && byKind[k][names[0]] >= 3) {
        solo = { name: names[0], kind: k, n: byKind[k][names[0]] };
      }
    });
    if (solo) {
      var kd = Items.kindById(solo.kind);
      return solo.name + ' さんは、' + (kd ? kd.label : solo.kind) + 'を' + solo.n +
        'つ集めて、相場をひとりで育てた';
    }
    // ③ いちばん大きく当てた品
    var top = h.slice().sort(function (a, b) { return b.points - a.points; })[0];
    if (top && top.points > 0) {
      return top.winner + ' さんの ' + top.no + '番が、この日いちばんの ' + top.points + '点';
    }
    return null;
  }

  return {
    RULES: RULES, POWERS: POWERS, TEXT: TEXT,
    powerById: powerById,
    normalizeConfig: normalizeConfig,
    estimateMinutes: estimateMinutes,
    newMarket: newMarket, bumpMarket: bumpMarket, isHot: isHot,
    buildRound: buildRound, mixLine: mixLine, shuffle: shuffle,
    hintsVisible: hintsVisible, hintStepsOpened: hintStepsOpened,
    canBid: canBid, settleSealed: settleSealed, payFor: payFor,
    incomeFor: incomeFor,
    itemPoints: itemPoints, pointsFromChips: pointsFromChips, scoreOf: scoreOf,
    guessReward: guessReward, rank: rank, highlight: highlight,
    Items: Items
  };
}));
