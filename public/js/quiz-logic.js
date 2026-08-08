// quiz-logic.js — カセット「クイズ王」4ゲームのルール層（第30弾）
//
// 設計の芯は bomb-logic.js / defuse-logic.js とまったく同じ:
//   DOM も socket.io も知らない。Node.js から require できる純粋な計算だけを置く。
//
// ---- なぜ4ゲームを1つのファイルにまとめたか（判断の記録） ----
// 「クイズラッシュ／つぎつぎ／とくとく／早押し」は、見た目こそ違うが
// 中身は「得点をつける」「順番を回す」「制限時間で締める」の組み合わせで、
// 8割が同じものになる。4つ別々に書くと、片方だけ直してもう片方に
// 反映し忘れる事故（今日だけで何度も起きたパターン）が確実に起きる。
// だから variant（遊びの種類）で枝分かれさせ、共通部分は1本にしてある。
//
// 出題は quiz-bank.js から。ゲーム中にAIは呼ばない。

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./quiz-bank.js'));
  } else {
    root.QuizLogic = factory(root.QuizBank);
  }
}(typeof self !== 'undefined' ? self : this, function (QuizBank) {
  'use strict';

  // 遊びの種類。realtime.js の GAME_DRIVERS に並ぶIDと同じ文字にしておく
  var VARIANT = {
    RUSH: 'quizrush',     // クイズラッシュ：好きな難易度に挑み続ける
    LIST: 'quizlist',     // つぎつぎクイズ：順番に1つずつ答えを出す
    REVEAL: 'quizreveal', // とくとくクイズ：だんだん見えてくる。早いほど高得点
    BUZZER: 'buzzer'      // 早押しトーナメント：1対1の勝ち抜き
  };
  var VARIANTS = [VARIANT.RUSH, VARIANT.LIST, VARIANT.REVEAL, VARIANT.BUZZER];

  // 難易度ごとの得点。旧クイズ王決定戦の QUIZ_POINTS をそのまま引き継ぐ
  // （記録の点数の意味を変えないため）
  var TIER_POINTS = { easy: 1, normal: 2, hard: 3, nanisore: 5, muri: 8 };
  var TIERS = ['easy', 'normal', 'hard', 'nanisore', 'muri'];
  var TIER_LABEL = {
    easy: '🟢 かんたん', normal: '🟡 ふつう', hard: '🟠 むずかしい',
    nanisore: '🔴 ナニソレシラナイ', muri: '🟣 むりなんだが'
  };

  // つぎつぎクイズの遊び方
  var LIST_STYLE = { COOP: 'coop', SURVIVAL: 'survival' };
  // 早押しの出し方
  var BUZZER_DELIVERY = { SPEAK: 'speak', TEXT: 'text' };

  function clampInt(v, min, max, fallback) {
    var n = parseInt(v, 10);
    if (!isFinite(n)) n = fallback;
    return Math.max(min, Math.min(max, n));
  }
  function shuffled(list, rnd) {
    var r = rnd || Math.random;
    var a = (list || []).slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(r() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /**
   * 端末から届いた設定を、そのまま信じずに枠へ収める。
   * ここを通さないと「制限時間9999分」のような設定でサーバーが苦しむ。
   */
  function normalizeConfig(cfg) {
    var c = cfg || {};
    var variant = (VARIANTS.indexOf(c.variant) !== -1) ? c.variant : VARIANT.RUSH;
    var out = {
      variant: variant,
      timerSec: clampInt(c.timerSec, 10, 59 * 60 + 59, 180),
      preset: c.preset || null
    };
    if (variant === VARIANT.RUSH) {
      out.passLimit = clampInt(c.passLimit, 0, 20, 3);
      out.canChangeTier = c.canChangeTier !== false;
      // ラウンド制。0 なら1本勝負（合計得点で決める）
      out.roundsToWin = clampInt(c.roundsToWin, 0, 9, 0);
    }
    if (variant === VARIANT.LIST) {
      out.style = (c.style === LIST_STYLE.SURVIVAL) ? LIST_STYLE.SURVIVAL : LIST_STYLE.COOP;
      out.targetCount = clampInt(c.targetCount, 3, 60, 10);   // 協力形式の目標数
      out.turnSec = clampInt(c.turnSec, 5, 120, 20);          // 1人の持ち時間
      out.tier = (TIERS.indexOf(c.tier) !== -1) ? c.tier : null; // null＝おまかせ
    }
    if (variant === VARIANT.REVEAL) {
      out.questionCount = clampInt(c.questionCount, 1, 30, 8);
      out.revealSec = clampInt(c.revealSec, 5, 60, 20);       // 全部見えるまでの秒数
      out.tier = (TIERS.indexOf(c.tier) !== -1) ? c.tier : 'normal';
    }
    if (variant === VARIANT.BUZZER) {
      out.winsNeeded = clampInt(c.winsNeeded, 1, 9, 3);       // 先に何問正解で勝ち
      out.delivery = (c.delivery === BUZZER_DELIVERY.TEXT)
        ? BUZZER_DELIVERY.TEXT : BUZZER_DELIVERY.SPEAK;
      out.tier = (TIERS.indexOf(c.tier) !== -1) ? c.tier : 'normal';
    }
    return out;
  }

  // ================= クイズラッシュ =================
  // 好きな難易度を選んで、次々に答える。パスできる回数は決まっている。
  // 得点は難易度そのまま。難しい方が高い。
  function rushScoreFor(tier) { return TIER_POINTS[tier] || 1; }

  /**
   * 1問ぶんの判定。
   * @returns {{correct:boolean, gained:number}}
   */
  function rushJudge(question, pickedIndex) {
    var correct = (pickedIndex === question.correct);
    return { correct: correct, gained: correct ? rushScoreFor(question.tier) : 0 };
  }

  /**
   * ラウンドの勝者。得点が一番多い人（同点なら全員）。
   * 「1位に1ポイント」を積み上げて、先取ポイント数に届いた人が優勝。
   */
  function rushRoundWinners(scores) {
    var ids = Object.keys(scores || {});
    if (!ids.length) return [];
    var top = Math.max.apply(null, ids.map(function (id) { return scores[id]; }));
    if (top <= 0) return []; // 誰も得点していない回は、勝者なし
    return ids.filter(function (id) { return scores[id] === top; });
  }

  /**
   * ラウンド数の設定に見合った「先取ポイント数」の候補。
   * 3ラウンドしか遊ばないのに「7ポイント先取」だと永久に終わらない。
   * 設定できる幅そのものを、遊ぶ回数から決める。
   */
  function winTargetsFor(maxRounds) {
    var all = [3, 5, 7];
    var fits = all.filter(function (n) { return n <= Math.max(1, maxRounds); });
    return fits.length ? fits : [1];
  }

  // ================= つぎつぎクイズ =================
  // 順番に1つずつ、まだ出ていない正解を答える。
  // 判定は quiz-bank の一覧と突き合わせる（AIは使わない）。

  /**
   * 次に答える人を選ぶ。脱落した人・切れている人は飛ばす。
   * @param order 並び（memberIdの配列）
   * @param fromIndex いまの位置
   * @param isActive (id)=>boolean
   * @returns {number} 次の位置。誰もいなければ -1
   */
  function nextTurnIndex(order, fromIndex, isActive) {
    var n = (order || []).length;
    if (!n) return -1;
    for (var step = 1; step <= n; step++) {
      var at = (fromIndex + step) % n;
      if (isActive(order[at])) return at;
    }
    return -1;
  }

  /**
   * つぎつぎクイズの答え合わせ。判定そのものは quiz-bank が持つ。
   * @returns {'correct'|'duplicate'|'wrong'}
   */
  function listJudge(topic, answer, alreadySaid) {
    return QuizBank.judgeListAnswer(topic, answer, alreadySaid);
  }

  /**
   * その回が終わったかどうか。
   *   協力形式 … 目標数に届けば成功。時間切れなら失敗
   *   脱落形式 … 残り1人になったら、その人の勝ち
   */
  function listOutcome(style, opts) {
    var said = opts.saidCount || 0;
    var alive = opts.aliveIds || [];
    if (style === LIST_STYLE.COOP) {
      if (said >= opts.targetCount) return { done: true, success: true, cause: 'reached' };
      if (opts.timedOut) return { done: true, success: false, cause: 'time' };
      // 協力形式では、間違えても終わらせない（続けて別の人が答える）
      return { done: false };
    }
    if (alive.length <= 1) {
      return { done: true, success: true, cause: 'lastStanding', winnerId: alive[0] || null };
    }
    if (opts.timedOut) return { done: true, success: false, cause: 'time' };
    return { done: false };
  }

  // ================= とくとくクイズ =================
  // 問題が1文字ずつ開いていく。早く答えるほど高得点。

  /**
   * いま何文字ぶん見えているか。
   * 全部見えるまでの秒数（revealSec）で、問題文の長さぶんを均等に開く。
   */
  function revealedCount(text, elapsedMs, revealSec) {
    var len = (text || '').length;
    if (!len) return 0;
    var ratio = Math.max(0, Math.min(1, elapsedMs / (revealSec * 1000)));
    return Math.floor(len * ratio);
  }

  /**
   * 出す文字列。まだ開いていないところは伏せ字にする。
   * 空白と句読点は最初から見せる（形が分かる方が「読もう」という気になる）。
   */
  function maskedText(text, shown) {
    var s = String(text || '');
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (i < shown || /[\s、。？！?!「」（）]/.test(c)) out += c;
      else out += '◻';
    }
    return out;
  }

  // 早いほど高い。遅くなるほど下がるが、最後まで待っても0にはしない
  // （0にすると「もう押さない方が得」になり、誰も答えなくなる）
  var REVEAL_MIN_RATE = 0.25;
  function revealScore(tier, elapsedMs, revealSec) {
    var base = TIER_POINTS[tier] || 1;
    var ratio = Math.max(0, Math.min(1, elapsedMs / (revealSec * 1000)));
    var rate = 1 - (1 - REVEAL_MIN_RATE) * ratio;
    return Math.max(1, Math.round(base * 4 * rate));
  }

  // ================= 早押しトーナメント =================
  // 組み方・進行は、手渡し版で使っていたものをそのまま持ってきた
  // （指示：既存のロジックをそのまま使う）。DOMに触れていなかったので、
  // ここへ移すだけで1人1台版と手渡し版が同じ組み方になる。
  function buildPairs(ids) {
    var pairs = [];
    for (var i = 0; i < ids.length; i += 2) {
      if (i + 1 < ids.length) pairs.push([ids[i], ids[i + 1]]);
      else pairs.push([ids[i], null]); // 奇数なら不戦勝
    }
    return pairs;
  }

  /**
   * トーナメントの初期化。並びは混ぜる（毎回同じ組み合わせにしない）。
   */
  function newBracket(ids, rnd) {
    var order = shuffled(ids, rnd);
    return {
      roundNum: 1,
      pairs: buildPairs(order),
      matchIndex: 0,
      winners: [],
      champion: null,
      runnerUp: null
    };
  }

  /**
   * 次の対戦へ進める。不戦勝はここで勝ち上がらせる。
   * @returns {{done:boolean, pair:Array|null}} done=true なら優勝が決まった
   */
  function advanceBracket(b) {
    for (var guard = 0; guard < 200; guard++) {
      if (b.matchIndex >= b.pairs.length) {
        if (b.winners.length <= 1) {
          b.champion = b.winners[0] || null;
          return { done: true, pair: null };
        }
        b.roundNum++;
        b.pairs = buildPairs(b.winners);
        b.matchIndex = 0;
        b.winners = [];
        continue;
      }
      var pair = b.pairs[b.matchIndex];
      if (!pair[1]) {              // 不戦勝
        b.winners.push(pair[0]);
        b.matchIndex++;
        continue;
      }
      return { done: false, pair: pair };
    }
    return { done: true, pair: null };
  }

  // 対戦が決着した時。決勝なら準優勝も記録する
  function finishMatch(b, winnerId, loserId) {
    b.winners.push(winnerId);
    if (b.pairs.length === 1) b.runnerUp = loserId; // 決勝だった
    b.matchIndex++;
  }

  // ---- 全部の遊びで共通 ----
  // 順位。得点が多い順、同点なら名前順で毎回同じ並びにする（表示がちらつかない）
  function rank(rows) {
    var sorted = (rows || []).slice().sort(function (a, b) {
      if (a.score !== b.score) return b.score - a.score;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
    var out = [], at = 0, shown = 0, prev = null;
    sorted.forEach(function (row) {
      shown++;
      if (row.score !== prev) { at = shown; prev = row.score; }
      out.push(Object.assign({}, row, { rank: at }));
    });
    return out;
  }

  return {
    VARIANT: VARIANT, VARIANTS: VARIANTS,
    TIERS: TIERS, TIER_POINTS: TIER_POINTS, TIER_LABEL: TIER_LABEL,
    LIST_STYLE: LIST_STYLE, BUZZER_DELIVERY: BUZZER_DELIVERY,
    REVEAL_MIN_RATE: REVEAL_MIN_RATE,
    normalizeConfig: normalizeConfig,
    rushScoreFor: rushScoreFor, rushJudge: rushJudge,
    rushRoundWinners: rushRoundWinners, winTargetsFor: winTargetsFor,
    nextTurnIndex: nextTurnIndex, listJudge: listJudge, listOutcome: listOutcome,
    revealedCount: revealedCount, maskedText: maskedText, revealScore: revealScore,
    buildPairs: buildPairs, newBracket: newBracket,
    advanceBracket: advanceBracket, finishMatch: finishMatch,
    rank: rank, shuffled: shuffled
  };
}));
