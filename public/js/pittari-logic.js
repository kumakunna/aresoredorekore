// public/js/pittari-logic.js — 「ぴったり10秒」のルール層（指示68-4・カセットの約束 v1）
//
// このファイルは DOM も socket も知らない（Node.js から require してテストできる）。
// 進行役（pittari-room.js）と画面の両方がここを読む。**点の決め方と、時間の測り方はここ1か所だけ**。
//
// ---- 遊び方（ルールの札3枚） ----
//   1. 「スタート」から、心の中で10秒数える
//   2. 10秒だと思ったら「ストップ」
//   3. いちばん近い人の勝ち。5回勝負
//
// ---- 時間はスマホの中で測る ----
//   スタートを受けたスマホが、自分の画面に時計を出した時から、ストップを押すまで（Stopwatch）。
//   サーバーの時計で測ると、知らせが届くまでの遅れ（0〜300ミリ秒）がそのままタイムに入ってしまう。
//   サーバーは端末が出したミリ秒を受け取り、ありえない値（0より小さい・目標＋10秒より大きい）だけをはねる
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PittariLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var RULES = {
    MIN_PLAYERS: 2,
    MAX_PLAYERS: 16,
    SET_MS: 2600,       // 「よーい……」から「スタート！」まで
    SHOW_MS: 3000,      // 時計が見えている時間（そのあとは心の中で数える）
    LATE_MS: 10000,     // 目標＋10秒で締め切り
    OPEN_MS: 8000,      // 開いて見せる時間（遠い人から名前が落ちてくる → 冠）
    STEP_MS: 10,        // 比べるのは100分の1秒まで（差が同じなら同じ順位）
    POINTS: [5, 4, 3, 2, 1]   // 近い順。6位からは0点
  };
  /** 5回の目標（指示書）。show:false は時計が最初から見えない。double は点が2倍 */
  var ROUNDS = [
    { target: 10, show: true },
    { target: 5, show: true },
    { target: 15, show: true },
    { target: 10, show: false },
    { target: 20, show: true, double: true }
  ];

  /** 端末の中の時計。start は「時計を出した時」、stop は「ストップを押した時」（どちらも端末の時計・ミリ秒） */
  function Stopwatch() { this.t0 = null; this.ms = null; }
  Stopwatch.prototype.start = function (now) { if (this.t0 == null) this.t0 = now; return this; };
  Stopwatch.prototype.stop = function (now) {
    if (this.t0 == null || this.ms != null) return this.ms;
    this.ms = Math.max(0, Math.round(now - this.t0));
    return this.ms;
  };
  Stopwatch.prototype.running = function () { return this.t0 != null && this.ms == null; };

  /** サーバーが受け取ってよいタイムか（整数のミリ秒・0以上・目標＋10秒以下） */
  function validMs(ms, target) {
    return typeof ms === 'number' && isFinite(ms) && ms >= 0 && ms <= (target * 1000 + RULES.LATE_MS);
  }
  /** 差（ミリ秒）を100分の1秒にまるめる */
  function roundDiff(ms, target) {
    return Math.round((ms - target * 1000) / RULES.STEP_MS) * RULES.STEP_MS;
  }
  /** 「+0.12秒」「-1.05秒」「±0.00秒」の形 */
  function diffText(diff) {
    if (diff === 0) return '±0.00秒';
    return (diff > 0 ? '+' : '-') + (Math.abs(diff) / 1000).toFixed(2) + '秒';
  }

  /**
   * 1回の点。
   * @param stops  { memberId: ミリ秒 }（押さなかった人は入れない）
   * @param target 目標の秒
   * @param ids    この回に遊んだ人
   * @param dbl    点が2倍の回
   * @returns { rows:[{ id, ms, diff, rank, points }]（近い順・押さなかった人は入れない）, points:{ id: 点 }, perfect:[0.00秒の人] }
   */
  function scoreRound(stops, target, ids, dbl) {
    var rows = (ids || []).filter(function (id) { return stops && validMs(stops[id], target); })
      .map(function (id) { return { id: id, ms: stops[id], diff: roundDiff(stops[id], target) }; })
      .sort(function (a, b) { return Math.abs(a.diff) - Math.abs(b.diff); });
    var rank = 0, prev = null;
    rows.forEach(function (r, i) {
      if (Math.abs(r.diff) !== prev) { rank = i + 1; prev = Math.abs(r.diff); }
      r.rank = rank;
      r.points = (RULES.POINTS[rank - 1] || 0) * (dbl ? 2 : 1);
    });
    var points = {};
    (ids || []).forEach(function (id) { points[id] = 0; });
    rows.forEach(function (r) { points[r.id] = r.points; });
    return { rows: rows, points: points, perfect: rows.filter(function (r) { return r.diff === 0; }).map(function (r) { return r.id; }) };
  }

  /**
   * 5回のあとの結果。history：[{ rows, points }]
   * 称号（勝ち負けと関係なく褒める）：
   *   perfect … ぴったりの人（0.00秒を1回でも出した）
   *   master  … 体内時計の名人（5回とも押して、差の合計がいちばん小さい）
   */
  function finalResult(history, ids) {
    var score = {}, sum = {}, n = {}, perfect = {};
    ids.forEach(function (id) { score[id] = 0; sum[id] = 0; n[id] = 0; });
    history.forEach(function (h) {
      ids.forEach(function (id) { score[id] += (h.points && h.points[id]) || 0; });
      (h.rows || []).forEach(function (r) {
        if (!(r.id in sum)) return;
        sum[r.id] += Math.abs(r.diff); n[r.id]++;
        if (r.diff === 0) perfect[r.id] = true;
      });
    });
    var all = ids.filter(function (id) { return history.length && n[id] === history.length; });
    var low = all.length ? Math.min.apply(null, all.map(function (id) { return sum[id]; })) : null;
    var sorted = ids.slice().sort(function (a, b) { return score[b] - score[a]; });
    var rank = 0, prev = null;
    return {
      ranking: sorted.map(function (id, i) {
        if (score[id] !== prev) { rank = i + 1; prev = score[id]; }
        return { id: id, score: score[id], rank: rank, sum: n[id] ? sum[id] : null };
      }),
      awards: { perfect: ids.filter(function (id) { return perfect[id]; }), master: low == null ? [] : all.filter(function (id) { return sum[id] === low; }) }
    };
  }

  return { RULES: RULES, ROUNDS: ROUNDS, Stopwatch: Stopwatch, validMs: validMs, roundDiff: roundDiff, diffText: diffText,
    scoreRound: scoreRound, finalResult: finalResult };
});
