// wordwolf-room.js — 1人1台モードのワードウルフの進行（第24弾）
//
// 設計の芯は wolf-room.js（役職あり人狼）とまったく同じ。
//   ルール・お題・役職・勝敗・配点は wordwolf-logic.js をそのまま使い、作り直さない。
//   状態はサーバーが持ち、各端末は「自分の情報だけ」を受け取って表示する。
//
// 手渡し方式との違いは「順番」が無いことだけ。全員が同時に自分の端末で動く。
// 誰が終わったかを room.wolf.done で数え、全員そろった時点で次へ進む。
//
// このファイルは socket.io を知らない。通知は呼び出し側（realtime.js）が行う。

const path = require('path');
const WW = require(path.join(__dirname, 'public', 'js', 'wordwolf-logic.js'));

// 進行の段階。人狼側（wolf-room.js の PHASE）とは別物。
const PHASE = {
  LOBBY: 'lobby',
  REVEAL: 'reveal',        // 各自がお題（と役職）を確認する
  MEETING: 'meeting',      // 作戦会議（第24弾-2）
  DISCUSS: 'discuss',      // 話し合い。進行役が投票へ進める
  PREVOTE: 'preVote',      // のぞき見・まきこみが動く（該当役職がいる回だけ）
  VOTE: 'vote',            // 投票（同時）
  ROUND_RESULT: 'roundResult', // その回の結果
  ENDED: 'ended'
};

function playersOf(room) {
  return Array.from(room.members.values()).filter((m) => m.role === 'player');
}

// ---- 開始 ----
function startGame(room, config) {
  const members = playersOf(room);
  if (members.length < 3) return { ok: false, error: 'too_few_players', message: '3人以上必要です' };

  const cfg = config || {};
  const ids = members.map((m) => m.id);
  const isMulti = !!cfg.multiTurn;
  const wolfIds = WW.assignWolves(ids, cfg.wolfCount || 1);
  // 役職は配列（カードのプリセット）でも、数の指定（ウィザード）でも受け取る。
  // どちらで来ても、実際の人数に合わせた配分はここで計算する
  // （部屋の人数は始める瞬間まで決まらないので、端末側では決められない）。
  const wanted = Array.isArray(cfg.roles)
    ? cfg.roles.slice()
    : Object.keys(cfg.roles || {}).filter((id) => cfg.roles[id] > 0);
  const roleIds = WW.roleIdsFor(isMulti).filter((id) => wanted.indexOf(id) !== -1);
  const counts = WW.balancedCounts(roleIds, members.length, wolfIds.length);

  const pair = WW.pickPair(-1);
  const w = {
    playerIds: ids,
    names: {},
    wolfIds,
    roles: WW.assignRoles(ids, wolfIds, counts),
    majorityTopic: pair.majority,
    minorityTopic: pair.minority,
    lastPairIdx: pair.index,

    turn: 1,
    turnLimit: isMulti ? Math.max(2, cfg.turnLimit || 3) : 1,
    multiTurn: isMulti,
    changeTopic: isMulti ? cfg.changeTopic !== false : false,
    wolfAware: cfg.wolfAware !== false,

    phase: PHASE.REVEAL,
    done: {},
    info: {},              // memberId -> その人だけが得た情報
    revealVoteOf: null,    // まきこみ役が指名した人
    votes: {},
    voteRounds: [],
    executedIds: [],
    last: null,            // 直前の投票の結果
    runoff: null,
    exec: null,            // 複数ウルフの処刑ラウンド
    meetingSec: Math.max(0, parseInt(cfg.meetingSec, 10) || 0),
    discussSec: Math.max(0, parseInt(cfg.discussSec, 10) || 0),
    deadline: null,
    winner: null,          // 'sheep' | 'wolf' | null（合計得点で決める遊び方）
    scores: {},            // memberId -> 累計
    preset: cfg.preset || null
  };
  members.forEach((m) => { w.names[m.id] = m.name; });
  const execRounds = WW.execRoundsFor(wolfIds.length, isMulti);
  if (execRounds) w.exec = { round: 1, limit: execRounds, log: [], winner: null };

  room.wordwolf = w;
  room.state.game = 'wordwolf';
  room.state.phase = PHASE.REVEAL;
  return { ok: true };
}

// ---- 公開してよい情報だけ ----
// ここに秘密（お題・役職・投票先）を混ぜると、大画面を含む全員に配られる。
function publicView(room) {
  const w = room.wordwolf;
  if (!w) return { phase: PHASE.LOBBY };
  const view = {
    phase: w.phase,
    turn: w.turn,
    turnLimit: w.turnLimit,
    multiTurn: w.multiTurn,
    wolfCount: w.wolfIds.length,
    roleCount: Object.keys(w.roles).length,
    aliveCount: WW.survivors(w).length,
    players: w.playerIds.map((id) => ({
      id, name: w.names[id], out: WW.isOut(w, id)
    })),
    waiting: waitingNames(room),
    deadline: w.deadline || null
  };
  if (w.phase === PHASE.VOTE && w.runoff) {
    view.runoff = { candidates: w.runoff.candidates.map((id) => w.names[id]) };
  }
  if (w.phase === PHASE.ROUND_RESULT && w.last) {
    view.roundResult = roundResultView(w);
  }
  if (w.phase === PHASE.ENDED) {
    view.result = endedView(w);
  }
  return view;
}

// 途中の回か、決着したかで出せるものが変わる。
// まだ続く回でお題やウルフを明かすと、残りのターンが成立しない（第22弾-6と同じ考え）。
function roundResultView(w) {
  const o = w.last;
  const named = (counts) => Object.keys(counts || {}).map((id) => ({
    name: w.names[id], n: counts[id]
  })).sort((a, b) => b.n - a.n);
  const out = {
    executed: o.executedId ? { name: w.names[o.executedId] } : null,
    // 第33弾 B-7：全員が投票をとばした回を「同数」と言わないための印
    noVotes: !!o.noVotes,
    counts: named(o.counts),
    runoff: o.runoff ? {
      candidates: o.runoff.candidates.map((id) => w.names[id]),
      counts: named(o.runoff.counts)
    } : null,
    // 複数ウルフの途中経過。あと何人ウルフが残っているかは全員に見せる
    exec: w.exec ? {
      round: w.exec.log.length,
      limit: w.exec.limit,
      wolvesLeft: WW.wolvesAlive(w).length,
      sheepLeft: WW.sheepAlive(w).length,
      winner: w.exec.winner
    } : null,
    continues: continues(w)
  };
  // まだ続く回では、処刑された人がウルフだったかを伏せる。
  // ただしウルフが1人の設定では「続く＝外した」がルール上すぐ分かるので、そこは書く。
  if (!out.continues || w.wolfIds.length === 1) {
    out.wasWolf = o.executedId ? o.wasWolf : null;
  }
  return out;
}

function endedView(w) {
  return {
    winner: w.winner,
    majorityTopic: w.majorityTopic,
    minorityTopic: w.minorityTopic,
    wolves: w.wolfIds.map((id) => w.names[id]),
    roles: Object.keys(w.roles).map((id) => ({
      name: w.names[id], role: w.roles[id], roleName: WW.roleName(w.roles[id])
    })),
    scores: Object.keys(w.scores).map((id) => ({ name: w.names[id], points: w.scores[id] }))
      .sort((a, b) => b.points - a.points),
    // 決着したこの瞬間だけ、誰が誰に入れたかを開ける（第23弾-2と同じ扱い）
    voteLog: w.voteRounds.map((votes, i) => ({
      label: w.multiTurn ? (i + 1) + 'ターン目' : (w.exec ? (i + 1) + '回目' : ''),
      rows: Object.keys(votes).map((from) => ({ from: w.names[from], to: w.names[votes[from]] }))
    })),
    revealVoteOf: w.revealVoteOf ? {
      name: w.names[w.revealVoteOf],
      votedFor: w.names[(w.voteRounds[w.voteRounds.length - 1] || {})[w.revealVoteOf]] || null
    } : null
  };
}

// ---- その端末だけに配る情報 ----
function privateFor(room, memberId) {
  const w = room.wordwolf;
  if (!w) return null;
  if (w.playerIds.indexOf(memberId) === -1) return null; // 大画面・観戦には配らない
  const isWolf = w.wolfIds.indexOf(memberId) !== -1;
  const roleId = w.roles[memberId] || null;
  const out = {
    topic: isWolf ? w.minorityTopic : w.majorityTopic,
    // ウルフに自覚がある設定の時だけ、自分がウルフだと伝える
    youAreWolf: (isWolf && w.wolfAware) ? true : false,
    roleId,
    roleName: WW.roleName(roleId),
    roleDesc: WW.roleDesc(roleId),
    out: WW.isOut(w, memberId),
    done: !!w.done[memberId],
    info: w.info[memberId] || null
  };
  const alive = WW.survivors(w).filter((id) => id !== memberId);
  if (!out.out && w.phase === PHASE.REVEAL && WW.picksAtReveal(roleId)) {
    out.action = 'divine';
    out.choices = alive.map((id) => ({ id, name: w.names[id] }));
  }
  if (!out.out && w.phase === PHASE.PREVOTE && WW.picksBeforeVote(roleId)) {
    out.action = roleId === 'peek' ? 'peek' : 'involve';
    out.choices = alive.map((id) => ({ id, name: w.names[id] }));
  }
  if (!out.out && w.phase === PHASE.VOTE) {
    out.action = 'vote';
    out.choices = alive
      .filter((id) => !w.runoff || w.runoff.candidates.indexOf(id) !== -1)
      .map((id) => ({ id, name: w.names[id] }));
    if (w.runoff) out.runoff = true;
  }
  return out;
}

// ---- 操作の受け付け ----
// targetId が null なら「見ただけ／行動しないことを確認した」。
// 行動が無い人も必ずここを通るので、外から見て誰が能力持ちかは分からない。
function submitAction(room, memberId, targetId) {
  const w = room.wordwolf;
  if (!w) return { ok: false, error: 'not_started' };
  if ([PHASE.REVEAL, PHASE.PREVOTE].indexOf(w.phase) === -1) {
    return { ok: false, error: 'wrong_phase' };
  }
  if (expectedMembers(room).indexOf(memberId) === -1) return { ok: false, error: 'not_expected' };

  const roleId = w.roles[memberId] || null;
  if (targetId && w.phase === PHASE.REVEAL && WW.picksAtReveal(roleId)) {
    w.info[memberId] = {
      // 人狼側の占い結果と同じ形にしておく（画面の出し方を1つで済ませる）
      kind: 'divine', targetName: w.names[targetId],
      result: { label: WW.teamLabel(w.roles, w.wolfIds, targetId) }
    };
  }
  if (targetId && w.phase === PHASE.PREVOTE) {
    if (roleId === 'peek') {
      w.info[memberId] = {
        kind: 'peek', targetName: w.names[targetId],
        label: WW.teamLabel(w.roles, w.wolfIds, targetId)
      };
    }
    if (roleId === 'involve') w.revealVoteOf = targetId;
  }
  w.done[memberId] = true;
  return { ok: true, allDone: isAllDone(room) };
}

function submitVote(room, memberId, targetId) {
  const w = room.wordwolf;
  if (!w) return { ok: false, error: 'not_started' };
  if (w.phase !== PHASE.VOTE) return { ok: false, error: 'wrong_phase' };
  if (expectedMembers(room).indexOf(memberId) === -1) return { ok: false, error: 'not_expected' };
  if (!targetId) return { ok: false, error: 'target_required' };
  if (targetId === memberId) return { ok: false, error: 'self_vote' };
  if (WW.isOut(w, targetId)) return { ok: false, error: 'already_out' };
  if (w.runoff && w.runoff.candidates.indexOf(targetId) === -1) {
    return { ok: false, error: 'not_candidate' };
  }
  w.votes[memberId] = targetId;
  w.done[memberId] = true;
  return { ok: true, allDone: isAllDone(room) };
}

// その段階で操作を待つ人。脱落した人と、切れている人は待たない
function expectedMembers(room) {
  const w = room.wordwolf;
  if (!w) return [];
  if ([PHASE.REVEAL, PHASE.PREVOTE, PHASE.VOTE].indexOf(w.phase) === -1) return [];
  return w.playerIds.filter((id) => {
    if (w.phase !== PHASE.REVEAL && WW.isOut(w, id)) return false;
    const m = room.members.get(id);
    return m && m.connected;
  });
}
function isAllDone(room) {
  const w = room.wordwolf;
  return expectedMembers(room).every((id) => w.done[id]);
}
function waitingNames(room) {
  const w = room.wordwolf;
  if (!w) return [];
  return expectedMembers(room).filter((id) => !w.done[id]).map((id) => w.names[id]);
}

// ---- 段階を進める ----
// 全員そろった時・時間切れ・進行役が押した時から呼ばれる。
// どこから来ても同じ経路を通す（分岐ごとに書くと片方だけ直し忘れる）。
function advance(room) {
  const w = room.wordwolf;
  if (!w) return { changed: false };

  if (w.phase === PHASE.REVEAL) {
    setPhase(room, PHASE.MEETING);
    if (w.meetingSec) w.deadline = Date.now() + w.meetingSec * 1000;
    return { changed: true };
  }
  if (w.phase === PHASE.MEETING) {
    startDiscuss(room);
    return { changed: true };
  }
  if (w.phase === PHASE.DISCUSS) {
    // のぞき見・まきこみがいる回だけ、投票の直前のステップを挟む
    if (WW.hasPreVoteStep(w.roles)) startActionPhase(room, PHASE.PREVOTE);
    else startVotePhase(room);
    return { changed: true };
  }
  if (w.phase === PHASE.PREVOTE) {
    startVotePhase(room);
    return { changed: true };
  }
  if (w.phase === PHASE.VOTE) {
    // 同数なら、並んだ人だけでもう一度。判断は人狼とまったく同じものを使う
    const vo = WW.voteOutcome(w, w.votes, { isRunoff: !!w.runoff });
    if (vo.kind === 'runoff') {
      w.runoff = {
        candidates: vo.candidates,
        firstCounts: vo.counts,
        firstVotes: Object.assign({}, w.votes)
      };
      w.votes = {};
      startVotePhase(room, true);
      return { changed: true };
    }
    const runoff = w.runoff;
    if (runoff) w.votes = runoff.firstVotes; // 記録に残すのは1回目の投票
    const o = {
      executedId: vo.executedId, wasWolf: vo.wasWolf,
      counts: runoff ? runoff.firstCounts : vo.counts,
      runoff: runoff ? { counts: vo.counts, candidates: runoff.candidates } : null
    };
    w.runoff = null;
    w.last = o;
    w.voteRounds.push(Object.assign({}, w.votes));
    if (o.executedId) w.executedIds.push(o.executedId);
    if (w.exec && !w.exec.winner) advanceExecRound(w, o);
    setPhase(room, PHASE.ROUND_RESULT);
    return { changed: true };
  }
  if (w.phase === PHASE.ROUND_RESULT) {
    if (w.exec && !w.exec.winner) { startVotePhase(room); return { changed: true }; }
    if (continues(w)) {
      w.turn++;
      if (w.changeTopic) newTopic(w);
      startDiscuss(room);
      return { changed: true };
    }
    finish(room);
    return { changed: true };
  }
  return { changed: false };
}

// 複数ウルフの処刑ラウンド（第20弾-10と同じルール）
function advanceExecRound(w, o) {
  const ex = w.exec;
  ex.log.push(o.executedId
    ? { round: ex.round, name: w.names[o.executedId], wasWolf: o.wasWolf }
    : { round: ex.round, name: null, wasWolf: false, tie: true });
  if (!WW.wolvesAlive(w).length) { ex.winner = 'sheep'; return; }
  if (WW.sheepAlive(w).length <= WW.wolvesAlive(w).length) { ex.winner = 'wolf'; return; }
  if (ex.round >= ex.limit) { ex.winner = 'wolf'; return; }
  ex.round++;
}

// 同じお題のまま、まだ次のターンがあるか（第22弾-6と同じ判断）
function continues(w) {
  if (!w.multiTurn) return false;
  if (w.changeTopic) return w.turn < w.turnLimit;
  if (!WW.wolvesAlive(w).length) return false;
  if (WW.sheepAlive(w).length <= WW.wolvesAlive(w).length) return false;
  return w.turn < w.turnLimit;
}

function newTopic(w) {
  const pair = WW.pickPair(w.lastPairIdx);
  w.lastPairIdx = pair.index;
  w.majorityTopic = pair.majority;
  w.minorityTopic = pair.minority;
  // お題を変える遊び方は毎ターン仕切り直し。誰も脱落を持ち越さない
  w.executedIds = [];
  w.wolfIds = WW.assignWolves(w.playerIds, w.wolfIds.length);
  const counts = {};
  Object.keys(w.roles).forEach((pid) => { counts[w.roles[pid]] = 1; });
  w.roles = WW.assignRoles(w.playerIds, w.wolfIds, counts);
  w.info = {};
  w.revealVoteOf = null;
}

function finish(room) {
  const w = room.wordwolf;
  // 配点は共通層。ターンごとに積み上げる
  const deltas = WW.scoreRound(w);
  Object.keys(deltas).forEach((id) => { w.scores[id] = (w.scores[id] || 0) + deltas[id]; });
  if (w.multiTurn && !w.changeTopic) {
    w.winner = WW.verdict(w).caught ? 'sheep' : 'wolf';
  } else if (!w.multiTurn) {
    w.winner = WW.verdict(w).caught ? 'sheep' : 'wolf';
  } else {
    w.winner = null; // 合計得点で決める遊び方
  }
  setPhase(room, PHASE.ENDED);
}

function setPhase(room, phase) {
  const w = room.wordwolf;
  w.phase = phase;
  w.done = {};        // 段階が変わったら「終わった人」は数え直す
  w.deadline = null;
  room.state.phase = phase;
}
function startActionPhase(room, phase) {
  setPhase(room, phase);
}
function startDiscuss(room) {
  const w = room.wordwolf;
  setPhase(room, PHASE.DISCUSS);
  if (w.discussSec) w.deadline = Date.now() + w.discussSec * 1000;
}
// 投票の段階に入る唯一の入口。決選投票からの呼び出し以外は状態を消す
function startVotePhase(room, keepRunoff) {
  const w = room.wordwolf;
  if (!keepRunoff) w.runoff = null;
  w.votes = {};
  setPhase(room, PHASE.VOTE);
}

module.exports = {
  PHASE, startGame, publicView, privateFor,
  submitAction, submitVote, isAllDone, advance,
  playersOf, expectedMembers, continues
};
