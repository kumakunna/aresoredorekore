// wordwolf-logic.js — ワードウルフの「ルール」だけを担当する層
//
// wolf-logic.js（役職あり人狼）と同じ流儀。ここには画面の話を一切書かない。
//   ・お題のペアを選ぶ
//   ・誰がウルフ🐺か、誰にどの役職を配るか
//   ・覗いた相手がどう見えるか
//   ・投票の結果、誰が処刑され、どちらが勝ったか
//   ・得点
// だけを扱う。
//
// なぜ切り出したか（第24弾）：
//   1人1台モードのワードウルフを足すにあたって、ルールが index.html の中にしか
//   無かった。そのままサーバー側にも書くと、同じルールが2つになる。
//   「同じ考えを2か所に書かない」を守るため、手渡し方式も1人1台も
//   このファイルを通す。
//
// 投票の集計そのものは wolf-logic.js の tally / voteOutcome を使う。
// 決選投票の扱いを人狼と揃えるため、こちらで数え直さない。
//
// ブラウザからは window.WordwolfLogic、Nodeからは require() で使える。

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./wolf-logic.js'));
  } else {
    root.WordwolfLogic = factory(root.WolfLogic);
  }
})(typeof self !== 'undefined' ? self : this, function (WolfLogic) {
  'use strict';

  // ===== お題 =====
  // 似ているが違うものの組。どちらが多数派になるかは毎回入れ替える。
  var PAIRS = [
    { a: '傘', b: 'レインコート' }, { a: '犬', b: '猫' }, { a: 'コーヒー', b: '紅茶' }, { a: '電車', b: 'バス' },
    { a: '鉛筆', b: 'シャープペン' }, { a: '醤油', b: 'ソース' }, { a: 'りんご', b: 'みかん' }, { a: '海', b: '川' },
    { a: '布団', b: 'ベッド' }, { a: 'お箸', b: 'フォーク' }, { a: '消しゴム', b: '修正テープ' }, { a: '冷蔵庫', b: '冷凍庫' },
    { a: '財布', b: 'カバン' }, { a: '眼鏡', b: 'サングラス' }, { a: 'ラーメン', b: 'うどん' }, { a: 'ピアノ', b: 'ギター' },
    { a: '野球', b: 'サッカー' }, { a: '山', b: '森' }, { a: '太陽', b: '月' }, { a: '手袋', b: 'マフラー' },
    { a: '掃除機', b: 'ほうき' }, { a: 'テレビ', b: 'ラジオ' }, { a: 'パン', b: 'ごはん' }, { a: '自転車', b: 'バイク' },
    { a: '鏡', b: '窓' }, { a: '歯ブラシ', b: '歯みがき粉' }, { a: 'ケーキ', b: 'プリン' }, { a: '扇風機', b: 'エアコン' },
    { a: '靴', b: 'スリッパ' }, { a: '石けん', b: 'シャンプー' }
  ];

  function rnd(rng) { return rng ? rng() : Math.random(); }

  // 直前と同じ組を続けて出さない（同じお題が2回続くと白ける）
  function pickPair(lastIndex, rng) {
    var idx, guard = 0;
    do { idx = Math.floor(rnd(rng) * PAIRS.length); guard++; }
    while (idx === lastIndex && PAIRS.length > 1 && guard < 10);
    var pair = PAIRS[idx];
    var flip = rnd(rng) < 0.5;
    return {
      index: idx,
      majority: flip ? pair.a : pair.b,  // シープ🐑側
      minority: flip ? pair.b : pair.a   // ウルフ🐺側
    };
  }

  function shuffle(arr, rng) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rnd(rng) * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // ===== ウルフの人数 =====
  // 少なくとも2人はシープを残す。全員ウルフでは成立しない
  function wolfCountFor(playerCount, wanted) {
    return Math.min(Math.max(1, wanted || 1), Math.max(1, playerCount - 2));
  }
  function assignWolves(playerIds, wolfCount, rng) {
    return shuffle(playerIds, rng).slice(0, wolfCountFor(playerIds.length, wolfCount));
  }

  // ===== 役職 =====
  // ターン数で使える役職の集合が変わる。
  //   1ターン版  … 投票の直前に1回だけ動く単発役職
  //   2〜ターン版 … 夜が無くても成り立つ役職だけ
  var ROLE_SETS = {
    single: ['peek', 'fake', 'involve'],
    multi: ['seer', 'madman']
  };
  function roleIdsFor(isMultiTurn) {
    return isMultiTurn ? ROLE_SETS.multi : ROLE_SETS.single;
  }

  // 人狼から借りた役職は、説明文だけワードウルフの言葉に置き換える
  // （このゲームに夜は無いし、陣営の呼び方もシープ🐑／ウルフ🐺）
  var ROLE_DESC = {
    seer: 'お題を見るときに1人を占うと、その人がウルフ🐺側かシープ🐑側か分かります。',
    madman: 'ウルフ🐺の味方です。お題はシープ🐑と同じで、ウルフが誰かは知りません。'
  };
  function roleName(roleId) {
    return roleId ? WolfLogic.roleById(roleId).name : null;
  }
  function roleDesc(roleId) {
    if (!roleId) return '特別な力はありません。';
    return ROLE_DESC[roleId] || WolfLogic.roleById(roleId).desc;
  }

  // 入りきらない時に落とす順（影響の小さいものから）
  var DROP_ORDER = ['fake', 'involve', 'madman', 'peek', 'seer'];
  function balancedCounts(roleIds, playerCount, wolfCount) {
    var counts = {};
    (roleIds || []).forEach(function (id) { counts[id] = 1; }); // どの役職も1人まで
    var room = Math.max(0, playerCount - wolfCount - 1);        // シープを1人は残す
    var total = function () {
      return Object.keys(counts).reduce(function (n, k) { return n + counts[k]; }, 0);
    };
    for (var i = 0; i < DROP_ORDER.length && total() > room; i++) {
      if (counts[DROP_ORDER[i]]) counts[DROP_ORDER[i]] = 0;
    }
    return counts;
  }

  // 役職は多数派（シープ側のお題を持つ人）から配る。
  // ウルフに混ぜると、実質2人目のウルフになってしまう。
  function assignRoles(playerIds, wolfIds, counts, rng) {
    var out = {};
    var ids = Object.keys(counts || {}).filter(function (id) { return counts[id] > 0; });
    if (!ids.length) return out;
    var majority = shuffle(playerIds.filter(function (id) {
      return wolfIds.indexOf(id) === -1;
    }), rng);
    ids.forEach(function (roleId, k) {
      if (majority[k]) out[majority[k]] = roleId;
    });
    return out;
  }

  // ===== 能力のタイミング =====
  // お題を見る画面で1人選ぶ役職か（占い師だけ）
  function picksAtReveal(roleId) { return roleId === 'seer'; }
  // 投票の直前に動く役職か。
  // 第22弾-4：のぞき見役・まきこみ役は「こっそり分かる」のが持ち味なので、
  // お題を見る時に動かすと、その情報を話し合いで使えてしまう。
  function picksBeforeVote(roleId) { return roleId === 'peek' || roleId === 'involve'; }
  function hasPreVoteStep(roles) {
    return Object.keys(roles || {}).some(function (pid) { return picksBeforeVote(roles[pid]); });
  }

  // ===== 覗いた相手の見え方 =====
  // にせもの役はウルフ側に見え、狂人はシープ側に見える
  function teamLabel(roles, wolfIds, targetId) {
    if ((roles || {})[targetId] === 'fake') return 'ウルフ🐺側';
    return (wolfIds.indexOf(targetId) !== -1) ? 'ウルフ🐺側' : 'シープ🐑側';
  }

  // ===== 投票をくり返す回数 =====
  // 第20弾-10：ウルフが2人以上なら、投票と処刑をウルフの人数ぶんくり返す。
  // 1回の投票では最大1人しか処刑できず、残りのウルフが無条件で逃げ切ってしまうため。
  // 第22弾-6：2〜ターン版は「ターンをくり返すこと」自体が同じ役割を果たすので、
  // ここで重ねてくり返さない（同じ仕組みを二重に走らせない）。
  function execRoundsFor(wolfCount, isMultiTurn) {
    return (wolfCount >= 2 && !isMultiTurn) ? wolfCount : 0;
  }

  // ===== 生き死に =====
  function isOut(state, id) { return (state.executedIds || []).indexOf(id) !== -1; }
  function wolvesAlive(state) {
    return state.wolfIds.filter(function (id) { return !isOut(state, id); });
  }
  function survivors(state) {
    return state.playerIds.filter(function (id) { return !isOut(state, id); });
  }
  function sheepAlive(state) {
    return survivors(state).filter(function (id) { return state.wolfIds.indexOf(id) === -1; });
  }

  // ===== 投票 =====
  // 集計と「同数だったらどうするか」は人狼と同じ WolfLogic に任せる。
  // ここでやるのは、その結果をワードウルフの言葉に置き換えることだけ。
  function voteOutcome(state, votes, opts) {
    var vo = WolfLogic.voteOutcome(votes, opts);
    var executedId = (vo.kind === 'execute') ? vo.targetId : null;
    return {
      kind: vo.kind,
      candidates: vo.candidates,
      counts: vo.tally.counts,
      tie: vo.tally.tie,
      max: vo.tally.max,
      noVotes: !!vo.tally.noVotes,   // 第33弾 B-7：全員がとばした（同数とは別）
      executedId: executedId,
      wasWolf: !!executedId && state.wolfIds.indexOf(executedId) !== -1
    };
  }

  // ===== 勝敗 =====
  // ワードウルフの勝敗は「当てたか、逃げ切ったか」。
  // 人狼の「人数バランス」とは意図的に別のまま（指示22-6）。
  function verdict(state) {
    var left = wolvesAlive(state);
    return { escaped: left.length > 0, wolvesLeft: left, caught: left.length === 0 };
  }

  // ===== 得点 =====
  // ・ウルフに投票できた人は、投票の回ごとに1点
  // ・逃げ切ったウルフは1点。逃げ切った時は狂人も一緒に1点
  //   （狂人はシープと同じお題を持つが、勝敗の上ではウルフ側）
  function isWolfSide(state, playerId) {
    return state.wolfIds.indexOf(playerId) !== -1 || (state.roles || {})[playerId] === 'madman';
  }
  function scoreRound(state) {
    var deltas = {};
    var add = function (id, n) { deltas[id] = (deltas[id] || 0) + n; };
    var rounds = (state.voteRounds && state.voteRounds.length)
      ? state.voteRounds : [state.votes || {}];
    rounds.forEach(function (votes) {
      Object.keys(votes).forEach(function (voterId) {
        if (isWolfSide(state, voterId)) return;
        if (state.wolfIds.indexOf(votes[voterId]) !== -1) add(voterId, 1);
      });
    });
    var v = verdict(state);
    v.wolvesLeft.forEach(function (id) { add(id, 1); });
    if (v.escaped) {
      Object.keys(state.roles || {}).forEach(function (pid) {
        if (state.roles[pid] === 'madman') add(pid, 1);
      });
    }
    return deltas;
  }

  return {
    PAIRS: PAIRS, ROLE_SETS: ROLE_SETS, ROLE_DESC: ROLE_DESC, DROP_ORDER: DROP_ORDER,
    pickPair: pickPair, shuffle: shuffle,
    wolfCountFor: wolfCountFor, assignWolves: assignWolves,
    roleIdsFor: roleIdsFor, roleName: roleName, roleDesc: roleDesc,
    balancedCounts: balancedCounts, assignRoles: assignRoles,
    picksAtReveal: picksAtReveal, picksBeforeVote: picksBeforeVote, hasPreVoteStep: hasPreVoteStep,
    teamLabel: teamLabel, execRoundsFor: execRoundsFor,
    isOut: isOut, wolvesAlive: wolvesAlive, sheepAlive: sheepAlive, survivors: survivors,
    voteOutcome: voteOutcome, verdict: verdict, isWolfSide: isWolfSide, scoreRound: scoreRound
  };
});
