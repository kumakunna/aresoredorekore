// public/js/onaji-logic.js — 「みんなと同じ」のルール層（指示68-3・カセットの約束 v1 の最初の1本）
//
// このファイルは DOM も socket も知らない（Node.js から require してテストできる）。
// 進行役（onaji-room.js）と画面の両方がここを読む。**点の決め方はここ1か所だけ**。
//
// ---- 遊び方（ルールの札3枚） ----
//   1. お題に答える（3つか4つから選ぶ）
//   2. いちばん多い答えを選んだ人に1点
//   3. 5問で1回
//
// ---- モード ----
//   many（多い方・ふつう）… いちばん多い答えの人に1点。並んだら並んだ答えの人全員に1点。全員ちがう答えならだれも点なし（「ばらばら！」）
//   few（少ない方）      … いちばん少ない答え（だれも選ばなかった答えはのぞく）の人に1点。並んだら全員に1点。全員ちがうならだれも点なし
//   team（一致団結・協力）… 全員の答えをそろえるのが目標。「いちばん多い答えの人数 ÷ 答えた人の数（選ばなかった人も数える）」を5問たした「そろい度」。順位は出さない
//   どのモードも、選ばなかった人は0点（責める字は出さない）
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OnajiLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MODES = ['many', 'few', 'team'];
  var RULES = {
    MIN_PLAYERS: 3,     // 2人では「多い方」が決まらない
    MAX_PLAYERS: 16,
    ROUNDS: 5,          // 5問で1回（QUESTIONS の名は、クイズの層の見張り tools/tier-scan.js の語と被るので使わない）
    CHOOSE_SEC: 10,     // 選ぶ時間
    OPEN_SEC: 7         // 開いて見せる時間（せーの → 棒がのびる → 冠 → 名前）
  };

  function normalizeConfig(c) {
    c = c || {};
    return { mode: MODES.indexOf(c.mode) !== -1 ? c.mode : 'many' };
  }

  /**
   * 1問の点。
   * @param mode     'many' | 'few' | 'team'
   * @param choiceN  選択肢の数（3か4）
   * @param answers  { memberId: 選択肢の番号（0始まり） }。選ばなかった人は入れない
   * @param ids      この問題で答えられた人（選ばなかった人も含む）
   * @returns { counts:[選択肢ごとの人数], winners:[点になる選択肢の番号], points:{ id: 0|1 },
   *            scatter: 全員ちがう答え（ばらばら）, ratio: いちばん多い人数 ÷ 人数（一致団結）, together: 全員そろった }
   */
  function scoreRound(mode, choiceN, answers, ids) {
    var counts = [];
    for (var i = 0; i < choiceN; i++) counts.push(0);
    var answered = 0;
    (ids || []).forEach(function (id) {
      var a = answers ? answers[id] : undefined;
      if (typeof a === 'number' && a >= 0 && a < choiceN) { counts[a]++; answered++; }
    });
    var used = counts.filter(function (n) { return n > 0; });
    var max = used.length ? Math.max.apply(null, used) : 0;
    var min = used.length ? Math.min.apply(null, used) : 0;
    // 全員ちがう答え：答えた人が2人以上いて、どの答えも1人ずつ
    var scatter = answered >= 2 && max === 1;
    var winners = [];
    if (answered > 0 && !scatter) {
      var target = mode === 'few' ? min : max;
      // 並んだら、並んだ答えの人全員に1点（少ない方で全部が同じ人数の時も、全員が「いちばん少ない」に並ぶ）
      counts.forEach(function (n, k) { if (n > 0 && n === target) winners.push(k); });
    }
    var points = {};
    (ids || []).forEach(function (id) {
      var a = answers ? answers[id] : undefined;
      points[id] = (mode !== 'team' && typeof a === 'number' && winners.indexOf(a) !== -1) ? 1 : 0;
    });
    var n = (ids || []).length;
    return {
      counts: counts, winners: winners, points: points, scatter: scatter,
      ratio: n ? max / n : 0, together: n > 0 && max === n
    };
  }

  /**
   * 5問のあとの結果。
   * history：[{ answers, winners, counts, points }]。ids：最後まで遊んだ人
   * 称号（勝ち負けと関係なく褒める・指示書）：
   *   same … いちばんみんなと同じだった人（多い答えを選んだ回数がいちばん多い）
   *   solo … ひとりだけの答えをいちばん多く出した人（その答えを選んだのが自分だけ）
   * 一致団結は順位を出さず、そろい度（0〜100）だけ
   */
  function finalResult(mode, history, ids) {
    var score = {}, same = {}, solo = {};
    ids.forEach(function (id) { score[id] = 0; same[id] = 0; solo[id] = 0; });
    var ratioSum = 0;
    history.forEach(function (h) {
      ratioSum += h.ratio || 0;
      var max = Math.max.apply(null, h.counts.concat([0]));
      ids.forEach(function (id) {
        score[id] += (h.points && h.points[id]) || 0;
        var a = h.answers[id];
        if (typeof a !== 'number') return;
        if (max > 1 && h.counts[a] === max) same[id]++;
        if (h.counts[a] === 1) solo[id]++;
      });
    });
    var best = function (tbl) {
      var top = Math.max.apply(null, ids.map(function (id) { return tbl[id]; }).concat([0]));
      return top > 0 ? ids.filter(function (id) { return tbl[id] === top; }) : [];
    };
    var out = {
      mode: mode,
      awards: { same: best(same), solo: best(solo) },
      together: history.filter(function (h) { return h.together; }).length
    };
    if (mode === 'team') {
      out.sync = history.length ? Math.round(ratioSum / history.length * 100) : 0;
      return out;
    }
    // 順位（点の多い順・同点は同じ順位）
    var sorted = ids.slice().sort(function (a, b) { return score[b] - score[a]; });
    var rank = 0, prev = null;
    out.ranking = sorted.map(function (id, i) {
      if (score[id] !== prev) { rank = i + 1; prev = score[id]; }
      return { id: id, score: score[id], rank: rank };
    });
    return out;
  }

  return { MODES: MODES, RULES: RULES, normalizeConfig: normalizeConfig, scoreRound: scoreRound, finalResult: finalResult };
});
