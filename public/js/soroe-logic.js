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
  /**
   * 高さ（差がこれ以内）。いちばん上から順に見る。voice は TV の声。
   * max は 8人の時の数（見本）。**本当の境目は人数で変わる**（BY_PLAYERS・heightOf）
   */
  var HEIGHTS = [
    { id: 'space', max: 115, points: 100, voice: 'v33' },
    { id: 'moon', max: 165, points: 70 },
    { id: 'cloud', max: 235, points: 40 },
    { id: 'building', max: 385, points: 20 },
    { id: 'plop', max: Infinity, points: 5 }
  ];
  /**
   * 指示68-T 7：人数ごとの境目（ミリ秒。人数は「押した人の数」）。[人数, 宇宙, 月, 雲の上, ビルの上]
   * 人数が多いほど、いちばん早い人と遅い人の差は広がる（10/30 の8人で「0.15」が何度も出た）。
   * 考え方：1人のばらつきを 60ms とした試算で、宇宙は約1割・月までで半分・雲の上までで9割。
   * 2人でも宇宙は 30ms より小さくしない（測る誤差 ±20ms より小さい差は運になる）。ビルの上は雲の上＋150ms。
   * 表にない人数は、近い2つのあいだを線でつなぐ（整数に丸める）
   */
  var BY_PLAYERS = [
    [2, 30, 55, 140, 290],
    [3, 40, 95, 175, 325],
    [4, 65, 120, 195, 345],
    [5, 80, 135, 210, 360],
    [6, 95, 150, 220, 370],
    [8, 115, 165, 235, 385],
    [10, 130, 180, 250, 400],
    [12, 140, 190, 255, 405],
    [16, 160, 210, 270, 420]
  ];
  /** その人数の境目 [宇宙, 月, 雲の上, ビルの上]（ミリ秒） */
  function limitsFor(n) {
    var T = BY_PLAYERS, k = +n || 0;
    if (k <= T[0][0]) return T[0].slice(1);
    if (k >= T[T.length - 1][0]) return T[T.length - 1].slice(1);
    for (var i = 1; i < T.length; i++) {
      if (k <= T[i][0]) {
        var a = T[i - 1], b = T[i], f = (k - a[0]) / (b[0] - a[0]);
        return [1, 2, 3, 4].map(function (j) { return Math.round(a[j] + (b[j] - a[j]) * f); });
      }
    }
    return T[T.length - 1].slice(1);
  }

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

  /** 差（ミリ秒）と押した人の数から高さ。n を渡さない時は 8人の境目（HEIGHTS の max） */
  function heightOf(spread, n) {
    var lim = n == null ? null : limitsFor(n);
    for (var i = 0; i < HEIGHTS.length; i++) {
      var max = lim && i < lim.length ? lim[i] : HEIGHTS[i].max;
      if (spread <= max) return HEIGHTS[i];
    }
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
    var h = flew ? heightOf(spread, count) : null;   // 境目は押した人の数で決める（指示68-T 7）
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

  return { RULES: RULES, ROUNDS: ROUNDS, HEIGHTS: HEIGHTS, BY_PLAYERS: BY_PLAYERS, limitsFor: limitsFor, zeroAt: zeroAt, closeAt: closeAt, validAt: validAt,
    heightOf: heightOf, scoreRound: scoreRound, finalResult: finalResult, offsetOf: offsetOf };
});
