// bomb-logic.js — 爆弾解除カセット「クイズ解除」のルール層（第27弾）
//
// 設計の芯は wolf-logic.js / wordwolf-logic.js とまったく同じ:
//   DOM も socket.io も知らない。Node.js から require できる純粋な計算だけを置く。
//   だから jsdom を立てずに単体テストできる。
//
// ここが持つのは「ルール」だけ:
//   ・爆弾に仕込むコード（お題）をどう選ぶか
//   ・3択（正解＋ダミー2つ）をどう作るか
//   ・ミスした時の罰（ライフ−1／残り時間−10秒）
//   ・競争版の順位の付け方
//   ・心拍がどれだけ速くなるか
//
// 進行（誰がいつ何を見られるか）は bomb-room.js が持つ。
// 画面（見た目・音）は index.html が持つ。
//
// ランダムは必ず引数で受け取る。テストを固定した条件で安定させるため
// （原則：ランダム性に依存するテストは、条件を固定して安定させる）。

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BombLogic = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 難易度の並び順。index.html の BOMB_TIERS と同じ順番・同じidにしておくこと
  var TIERS = ['easy', 'normal', 'hard', 'nanisore', 'muri'];

  // 遊び方。通常版＝みんなで1つの爆弾（協力）、競争版＝各自が同じ爆弾に挑む
  var MODE = { COOP: 'coop', RACE: 'race' };
  // 競争版の終わり方
  var END_WHEN = { FIRST: 'first', ALL: 'all' };

  var CHOICE_COUNT = 3;      // 3択。1台のスマホ版と同じ
  var MAX_WIRES = 50;        // 設定画面のスライダー上限と同じ。端末の言い値を鵜呑みにしない
  var MAX_LIVES = 5;         // ライフ設定の上限と同じ
  var MISS_TIME_PENALTY_SEC = 10; // 競争版：ミスすると残り時間が10秒減る

  // 心拍。ミスが増えるほど速くなる（爆弾解除カセット共通の演出）
  var HEART_BASE_MS = 1000;
  var HEART_STEP_MS = 90;
  var HEART_MIN_MS = 380;

  // ---- 小さな道具 ----
  function defaultRnd() { return Math.random(); }
  // Fisher-Yates。元の配列は壊さない
  function shuffled(list, rnd) {
    var r = rnd || defaultRnd;
    var a = (list || []).slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(r() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function clampInt(v, min, max, fallback) {
    var n = parseInt(v, 10);
    if (!isFinite(n)) n = fallback;
    return Math.max(min, Math.min(max, n));
  }

  /**
   * 端末から届いた設定を、そのまま信じずに整える。
   * 部屋の進行はサーバーが持つので、ここで枠に収めておかないと
   * 「コード1000本」のような設定でサーバーが苦しむ。
   */
  function normalizeConfig(cfg) {
    var c = cfg || {};
    var mode = (c.mode === MODE.RACE) ? MODE.RACE : MODE.COOP;
    var counts = {};
    var total = 0;
    TIERS.forEach(function (t) {
      var n = clampInt((c.counts || {})[t], 0, MAX_WIRES, 0);
      // 合計が上限を超えたら、後ろの難易度から削る（前の難易度の希望を優先する）
      if (total + n > MAX_WIRES) n = MAX_WIRES - total;
      counts[t] = n;
      total += n;
    });
    return {
      mode: mode,
      // 競争版だけの設定。通常版では使わないが、既定値は入れておく
      endWhen: (c.endWhen === END_WHEN.ALL) ? END_WHEN.ALL : END_WHEN.FIRST,
      lives: clampInt(c.lives, 1, MAX_LIVES, 3),
      // 0＝時間制限なし。1台のスマホ版の「タイマーを使う」OFFと同じ扱い
      timerSec: clampInt(c.timerSec, 0, 59 * 60 + 59, 180),
      counts: counts,
      total: total,
      preset: c.preset || null
    };
  }

  /**
   * 端末から届いたお題プールを整える。
   * 名前が無いもの・重複は捨てる。難易度が分からないものは 'normal' に寄せる。
   */
  function normalizeTopics(topics) {
    var out = [];
    var seen = {};
    (topics || []).forEach(function (t) {
      var name = String((t && t.name) || '').trim();
      if (!name || seen[name]) return;
      seen[name] = true;
      out.push({
        name: name,
        tier: (TIERS.indexOf(t.tier) !== -1) ? t.tier : 'normal',
        ngWords: (t.ng_words || t.ngWords || []).map(String),
        aliases: (t.aliases || []).map(String)
      });
    });
    return out;
  }

  function topicsByTier(topics, tier) {
    return topics.filter(function (t) { return t.tier === tier; });
  }

  /**
   * 第28弾-1：盤面に並べる順番。必ずばらばらに混ぜる。
   *
   * 以前は「難易度別に整列」を選べたが、そうすると盤面が
   * 緑→黄→橙→赤のグラデーションに見え、どこが難しいかが一目で分かってしまった。
   * 難易度は枠の色で分かるので、並び順まで揃える必要はない。
   * 並べ方の設定そのものを無くしたので、ここを通れば必ず混ざる。
   */
  function shuffleWires(wires, rnd) {
    return shuffled(wires, rnd);
  }

  /**
   * 爆弾に仕込むコードを選ぶ。
   * 難易度ごとに希望の本数を引く。プールが足りない難易度は、あるだけで我慢する
   * （「30本の設定なのに10本しか出ない」は起こるが、黙って別の難易度で埋めると
   *   設定した人の意図と違うものが出るので、そちらは選ばない）。
   * 並び順は難易度ごとに固まったままなので、盤面に出す前に必ず shuffleWires を通す。
   */
  function pickWires(topics, counts, rnd) {
    var wires = [];
    var n = 0;
    TIERS.forEach(function (tier) {
      var want = (counts || {})[tier] || 0;
      if (want <= 0) return;
      var bank = shuffled(topicsByTier(topics, tier), rnd);
      for (var i = 0; i < Math.min(want, bank.length); i++) {
        wires.push({
          uid: 'w' + (n++),
          name: bank[i].name,
          tier: tier,
          ngWords: bank[i].ngWords,
          aliases: bank[i].aliases,
          description: null
        });
      }
    });
    return wires;
  }

  /**
   * 3択を作る。正解＋同じ難易度のダミー2つ。
   * 同じ難易度に足りなければ全体から借りる（1台のスマホ版の pickDecoys と同じ考え）。
   */
  function buildChoices(wire, topics, rnd) {
    var sameTier = topicsByTier(topics, wire.tier)
      .map(function (t) { return t.name; })
      .filter(function (nm) { return nm !== wire.name; });
    var all = topics.map(function (t) { return t.name; })
      .filter(function (nm) { return nm !== wire.name; });
    var need = CHOICE_COUNT - 1;
    var source = shuffled(sameTier.length >= need ? sameTier : all, rnd);
    return shuffled([wire.name].concat(source.slice(0, need)), rnd);
  }

  // 答え合わせ。表示名でも別名でも正解にする（1台のスマホ版は表示名だけを見ているが、
  // 別名を持つお題が3択に混ざった時に「同じものを指しているのに不正解」になるのを防ぐ）
  function isCorrect(wire, answer) {
    var a = String(answer == null ? '' : answer);
    if (a === wire.name) return true;
    return (wire.aliases || []).indexOf(a) !== -1;
  }

  // ---- 心拍 ----
  // ミスが増えるほど間隔が短くなる。下限を置くのは、速すぎると音が繋がって
  // 「音がおかしい」だけになり、緊張感にならないため
  function heartIntervalMs(misses) {
    var m = Math.max(0, parseInt(misses, 10) || 0);
    return Math.max(HEART_MIN_MS, HEART_BASE_MS - m * HEART_STEP_MS);
  }

  // ---- 競争版の順位 ----
  /**
   * 解けた問数が多い順、同数ならタイムが早い順。
   * ライフを0にした人（failed）は記録なし・最下位扱いなので、必ず後ろに置く。
   * @param {Array} rows [{ id, name, solved, lastSolveAt, failed }]
   *   lastSolveAt … 最後に正解した時刻（試合開始からのミリ秒）。1問も解けていなければ null
   */
  function rankPlayers(rows) {
    var sorted = (rows || []).slice().sort(function (a, b) {
      if (!!a.failed !== !!b.failed) return a.failed ? 1 : -1;
      if (a.solved !== b.solved) return b.solved - a.solved;
      var at = (a.lastSolveAt == null) ? Infinity : a.lastSolveAt;
      var bt = (b.lastSolveAt == null) ? Infinity : b.lastSolveAt;
      if (at !== bt) return at - bt;
      // ここまで同じなら、名前で並べて毎回同じ順番にする（表示がちらつかないように）
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
    // 同着は同じ順位。失敗した人は順位を付けない（記録なし）
    var out = [];
    var rank = 0, shown = 0, prev = null;
    sorted.forEach(function (row) {
      shown++;
      var key = row.failed ? 'failed' : (row.solved + '/' + (row.lastSolveAt == null ? 'x' : row.lastSolveAt));
      if (key !== prev) { rank = shown; prev = key; }
      out.push(Object.assign({}, row, { rank: row.failed ? null : rank }));
    });
    return out;
  }

  // 横棒グラフ用の割合（0〜100）。大画面のリーダーボードで使う
  function progressPct(solved, total) {
    if (!total) return 0;
    return Math.round((Math.max(0, solved) / total) * 100);
  }

  return {
    TIERS: TIERS, MODE: MODE, END_WHEN: END_WHEN,
    CHOICE_COUNT: CHOICE_COUNT, MAX_WIRES: MAX_WIRES, MAX_LIVES: MAX_LIVES,
    MISS_TIME_PENALTY_SEC: MISS_TIME_PENALTY_SEC,
    HEART_BASE_MS: HEART_BASE_MS, HEART_MIN_MS: HEART_MIN_MS,
    normalizeConfig: normalizeConfig, normalizeTopics: normalizeTopics,
    pickWires: pickWires, shuffleWires: shuffleWires, buildChoices: buildChoices, isCorrect: isCorrect,
    heartIntervalMs: heartIntervalMs, rankPlayers: rankPlayers,
    progressPct: progressPct, shuffled: shuffled, topicsByTier: topicsByTier
  };
}));
