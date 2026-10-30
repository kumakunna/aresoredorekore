// public/js/quiz2-logic.js — クイズ王2.0（指示68-5）の決め方。サーバー（qhaya-room.js・qnear-room.js）と画面で同じ1本
//
//   みんなで早答え（haya）… 全員が同じ3択（4択）に同時に答える。正解で 100点＋早さの点（0秒で100・10秒で0、まっすぐ減る）。
//     まちがい・時間切れは0点（引かない）。10問で1回・最後の問題は2倍。1〜3問目はやさしい・4〜7問目はふつう・8〜10問目はむずかしい
//   数字ちかい方（near）… 答えを数字で入れる。いちばん近い人の勝ち。近い順に 5・3・1点、ぴったりは＋5点。差が同じなら同じ順位。5問で1回
//
// **正解（3択の番号・数字の答え）は開くまでどこにも配らない**（判定はサーバーだけ）。ここは決め方だけで、秘密の扱いは *-room.js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Quiz2Logic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var RULES = {
    MIN_PLAYERS: 2,
    MAX_PLAYERS: 16,
    HAYA: {
      ROUNDS: 10,
      ANSWER_SEC: 10,
      OPEN_SEC: 7,
      BASE: 100,          // 正解の点
      SPEED: 100,         // 早さの点の上限（0秒で100・ANSWER_SEC で0）
      TIERS: ['easy', 'easy', 'easy', 'normal', 'normal', 'normal', 'normal', 'hard', 'hard', 'hard'],
      RANK_EVERY: 3       // 3問ごとに順位が動く
    },
    NEAR: {
      ROUNDS: 5,
      ANSWER_SEC: 15,
      OPEN_SEC: 8,
      POINTS: [5, 3, 1],  // 近い順（1位・2位・3位）
      PERFECT: 5,         // ぴったりの上乗せ
      MAX_DIGITS: 9       // 入れられる数のけた
    }
  };

  /** 早さの点（ms は問題が出てから押すまで。ANSWER_SEC 秒で0。範囲の外は寄せる） */
  function speedPoints(ms) {
    var lim = RULES.HAYA.ANSWER_SEC * 1000;
    var t = Math.max(0, Math.min(lim, Number(ms) || 0));
    return Math.round(RULES.HAYA.SPEED * (1 - t / lim));
  }

  /**
   * 早答えの1問。answers：{ id: { pick, ms } }（押さなかった人は入っていない）。correct：正解の番号。double：2倍の問題か
   * 返り値：{ rows: { id: { pick|null, ms|null, right, points } }, counts:[選択肢ごとの人数], fastest:[いちばん早かった正解の人の id], fastestMs }
   */
  function scoreHaya(choiceN, answers, correct, ids, double) {
    var counts = []; for (var k = 0; k < choiceN; k++) counts.push(0);
    var rows = {}, best = null;
    ids.forEach(function (id) {
      var a = answers[id];
      var pick = a && typeof a.pick === 'number' ? a.pick : null;
      var ms = a && typeof a.ms === 'number' ? a.ms : null;
      if (pick !== null) counts[pick]++;
      var right = pick === correct;
      var pts = right ? (RULES.HAYA.BASE + speedPoints(ms)) * (double ? 2 : 1) : 0;
      rows[id] = { pick: pick, ms: ms, right: right, points: pts };
      if (right && (best === null || ms < best)) best = ms;
    });
    var fastest = best === null ? [] : ids.filter(function (id) { return rows[id].right && rows[id].ms === best; });
    return { rows: rows, counts: counts, fastest: fastest, fastestMs: best };
  }

  /** 順位（点の高い順・同じ点は同じ順位。1,1,3 の数え方） */
  function rankOf(scores, ids) {
    var sorted = ids.slice().sort(function (a, b) { return (scores[b] || 0) - (scores[a] || 0); });
    var out = [], prev = null, rank = 0;
    sorted.forEach(function (id, i) {
      var s = scores[id] || 0;
      if (s !== prev) { rank = i + 1; prev = s; }
      out.push({ id: id, score: s, rank: rank });
    });
    return out;
  }

  /** 数として読めるか（全角数字も・カンマも許す）。小数は使わない（表の答えは整数）。読めなければ null */
  function parseNumber(raw) {
    if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 0 && Math.floor(raw) === raw ? raw : null;
    var s = String(raw == null ? '' : raw).replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); }).replace(/[,，\s]/g, '');
    if (!/^[0-9]+$/.test(s) || s.length > RULES.NEAR.MAX_DIGITS) return null;
    return Number(s);
  }

  /**
   * 数字ちかい方の1問。answers：{ id: 数 }。answer：正解。
   * 近い順に 5・3・1点（差が同じなら同じ順位・1,1,3 の数え方）。ぴったりは＋5点。答えなかった人は0点で順位なし
   * 返り値：{ rows: { id: { value|null, diff|null, rank|null, points, perfect } }, crowned:[1位の id], perfect:[ぴったりの id] }
   */
  function scoreNear(answers, answer, ids) {
    var got = ids.filter(function (id) { return typeof answers[id] === 'number'; });
    var diff = {}; got.forEach(function (id) { diff[id] = Math.abs(answers[id] - answer); });
    var sorted = got.slice().sort(function (a, b) { return diff[a] - diff[b]; });
    var rows = {}, prev = null, rank = 0;
    sorted.forEach(function (id, i) {
      if (diff[id] !== prev) { rank = i + 1; prev = diff[id]; }
      var perfect = diff[id] === 0;
      var pts = (RULES.NEAR.POINTS[rank - 1] || 0) + (perfect ? RULES.NEAR.PERFECT : 0);
      rows[id] = { value: answers[id], diff: diff[id], rank: rank, points: pts, perfect: perfect };
    });
    ids.forEach(function (id) { if (!rows[id]) rows[id] = { value: null, diff: null, rank: null, points: 0, perfect: false }; });
    return {
      rows: rows,
      crowned: sorted.filter(function (id) { return rows[id].rank === 1; }),
      perfect: sorted.filter(function (id) { return rows[id].perfect; })
    };
  }

  /**
   * 数直線の目盛り（答えの散らばりに合わせる）。正解をまん中に、答えの「ふつうの広がり」が入る幅にする。
   * とても遠い答え（幅の外）は、端の「→」の束にまとめる（読める形を保つ）。
   * values：答えの数の並び。返り値：{ min, max, far: { left:[値の番号], right:[値の番号] } }
   */
  function axisOf(values, answer) {
    var d = values.map(function (v) { return Math.abs(v - answer); }).sort(function (a, b) { return a - b; });
    // 幅の目安：近い方から 3/4 の人の差（遠すぎる1人に引っぱられない）。いちばん小さくても正解の 10%（0 のときは 10）
    var q = d.length ? d[Math.min(d.length - 1, Math.floor((d.length - 1) * 0.75))] : 0;
    var half = Math.max(q * 1.25, Math.abs(answer) * 0.1, 10);
    var min = answer - half, max = answer + half;
    var far = { left: [], right: [] };
    values.forEach(function (v, i) { if (v < min) far.left.push(i); else if (v > max) far.right.push(i); });
    return { min: min, max: max, far: far };
  }

  /**
   * 早答えの10問を選ぶ（層の並びどおり）。bank：quiz-bank.js。used：この部屋で出した問題（{ 問題文: true }）。
   * 同じ回の中で同じ問題は出さない。層の問題が足りない時だけ、出したことのある問題を使う（pickQuestions と同じ）
   */
  function pickHaya(bank, used, rnd) {
    var seen = Object.assign({}, used || {}), out = [];
    var need = {}; RULES.HAYA.TIERS.forEach(function (t) { need[t] = (need[t] || 0) + 1; });
    var byTier = {};
    Object.keys(need).forEach(function (t) {
      byTier[t] = bank.pickQuestions(t, need[t], seen, rnd);
      byTier[t].forEach(function (q) { seen[q.q] = true; });
    });
    RULES.HAYA.TIERS.forEach(function (t) { out.push(byTier[t].shift()); });
    return out.filter(Boolean);
  }

  /**
   * 数字ちかい方の5問を選ぶ（表から作った「数字で答える問題」）。**なるべくちがう表から**（同じ山ばかりにしない）。
   * 同じ回の中で同じ問題は出さない
   */
  function pickNear(bank, used, rnd) {
    var r = rnd || Math.random;
    var all = bank.numbersOf().filter(function (q) { return !(used || {})[q.q]; });
    if (all.length < RULES.NEAR.ROUNDS) all = bank.numbersOf();
    var a = all.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    var out = [], tables = {};
    a.forEach(function (q) { if (out.length < RULES.NEAR.ROUNDS && !tables[q.table || q.q]) { tables[q.table || q.q] = true; out.push(q); } });
    a.forEach(function (q) { if (out.length < RULES.NEAR.ROUNDS && out.indexOf(q) === -1) out.push(q); });
    return out;
  }

  return { RULES: RULES, speedPoints: speedPoints, scoreHaya: scoreHaya, rankOf: rankOf, parseNumber: parseNumber,
    scoreNear: scoreNear, axisOf: axisOf, pickHaya: pickHaya, pickNear: pickNear };
});
