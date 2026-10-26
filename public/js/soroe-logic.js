// public/js/soroe-logic.js — 「そろえて発射」のルール層（指示68-4・カセットの約束 v1）
//
// このファイルは DOM も socket も知らない（Node.js から require してテストできる）。
// 進行役（soroe-room.js）と画面の両方がここを読む。**高さと点の決め方、時計合わせの計算はここ1か所だけ**。
//
// ---- 遊び方（ルールの札3枚） ----
//   1. 全員で、同じ瞬間に「発射」を押す
//   2. そろうほど、ロケットが高く飛ぶ
//   3. 5回たして、今日の記録をめざす
//
// ---- 比べ方 ----
//   押した時刻は**端末の時計のずれを直した時刻**（サーバーの時刻）で比べる。
//   端末はサーバーに何回か時刻をたずね（clock:sync）、往復がいちばん短かった回で「ずれ」を決める（offsetOf）。
//   押した時刻＝端末の時計＋ずれ。そろい＝いちばん早い人といちばん遅い人の差。押さなかった人は数えない
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SoroeLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var RULES = {
    MIN_PLAYERS: 2,
    MAX_PLAYERS: 16,
    LEAD_MS: 900,       // 知らせが届いてから、カウントが始まるまで（遅い端末も間に合う）
    AFTER_MS: 2500,     // 0 のあと、押せる時間
    SEENO_MS: 9000,     // 「せーの」の回の、押せる時間
    OPEN_MS: 7000,      // 開いて見せる時間（点が並ぶ → ロケットが飛ぶ）
    TOGETHER_MS: 100,   // 全員が押して、差がこれ以内なら「全員そろった！」
    SYNC_SAMPLES: 8     // 時計合わせで時刻をたずねる回数
  };
  /**
   * 5回の合図（指示書）。
   *   count … TV のカウント「3・2・1・0」の 0 で押す（step は1つの数の長さ）
   *   fade  … カウントが「3・2…」で消える。0 だと思った時に押す
   *   seeno … カウントなし。みんなで声を合わせて「せーの」で押す（アプリの声は鳴らさない）
   */
  var ROUNDS = [
    { signal: 'count', step: 1000 },
    { signal: 'fade', step: 1000 },
    { signal: 'seeno' },
    { signal: 'count', step: 550 },
    { signal: 'seeno', double: true }
  ];
  /** 高さ（差がこれ以内）。いちばん上から順に見る。voice は TV の声 */
  var HEIGHTS = [
    { id: 'space', max: 50, points: 100, voice: 'v33' },
    { id: 'moon', max: 100, points: 70 },
    { id: 'cloud', max: 200, points: 40 },
    { id: 'building', max: 400, points: 20 },
    { id: 'plop', max: Infinity, points: 5 }
  ];

  /** その回の 0 の時刻（サーバーの時刻）。「せーの」の回は 0 が無い（null） */
  function zeroAt(round, startedAt) {
    if (!round || round.signal === 'seeno') return null;
    return startedAt + RULES.LEAD_MS + 3 * round.step;
  }
  /** 押せる締め切り（サーバーの時刻） */
  function closeAt(round, startedAt) {
    var z = zeroAt(round, startedAt);
    return z == null ? startedAt + RULES.LEAD_MS + RULES.SEENO_MS : z + RULES.AFTER_MS;
  }
  /** サーバーが受け取ってよい押した時刻か（その回の始まり〜締め切り＋1秒） */
  function validAt(at, startedAt, close) {
    return typeof at === 'number' && isFinite(at) && at >= startedAt && at <= close + 1000;
  }

  function heightOf(spread) {
    for (var i = 0; i < HEIGHTS.length; i++) if (spread <= HEIGHTS[i].max) return HEIGHTS[i];
    return HEIGHTS[HEIGHTS.length - 1];
  }

  /**
   * 1回の点。
   * @param presses { memberId: 押した時刻（サーバーの時刻・ミリ秒） }（押さなかった人は入れない）
   * @param ids     この回に遊んだ人
   * @returns { count, n, flew, spread, height, points, together, dots:[最初の人からのミリ秒（並べただけ・名前なし）] }
   *   flew：押した人が半分以上、かつ2人以上（1人では「そろう」が測れない＝差0で宇宙になってしまう）
   */
  function scoreRound(presses, ids, dbl) {
    var ats = (ids || []).filter(function (id) { return presses && typeof presses[id] === 'number'; })
      .map(function (id) { return presses[id]; }).sort(function (a, b) { return a - b; });
    var n = (ids || []).length, count = ats.length;
    var flew = count >= 2 && count * 2 >= n;
    var spread = count ? Math.round(ats[count - 1] - ats[0]) : null;
    var h = flew ? heightOf(spread) : null;
    return {
      count: count, n: n, flew: flew, spread: spread,
      height: h ? h.id : null,
      points: h ? h.points * (dbl ? 2 : 1) : 0,
      together: count === n && n >= 2 && spread <= RULES.TOGETHER_MS,
      dots: ats.map(function (a) { return Math.round(a - ats[0]); })
    };
  }
  function finalResult(history) {
    var total = history.reduce(function (a, h) { return a + (h.points || 0); }, 0);
    var best = history.reduce(function (b, h) { return h.flew && (b == null || h.spread < b) ? h.spread : b; }, null);
    return { total: total, best: best, together: history.filter(function (h) { return h.together; }).length,
      space: history.filter(function (h) { return h.height === 'space'; }).length };
  }

  /**
   * 時計のずれ。samples：[{ t0: たずねた時（端末）, t1: 返事が来た時（端末）, server: サーバーの時刻 }]
   * 往復がいちばん短かった回を使う（行きと帰りの遅れが同じとみなせる回）。返すのは「サーバー − 端末」
   */
  function offsetOf(samples) {
    var best = null;
    (samples || []).forEach(function (s) {
      var rtt = s.t1 - s.t0;
      if (rtt < 0 || !isFinite(rtt)) return;
      if (!best || rtt < best.rtt) best = { rtt: rtt, offset: s.server - (s.t0 + s.t1) / 2 };
    });
    return best;
  }

  return { RULES: RULES, ROUNDS: ROUNDS, HEIGHTS: HEIGHTS, zeroAt: zeroAt, closeAt: closeAt, validAt: validAt,
    heightOf: heightOf, scoreRound: scoreRound, finalResult: finalResult, offsetOf: offsetOf };
});
