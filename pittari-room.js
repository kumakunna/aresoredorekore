// pittari-room.js — 「ぴったり10秒」の進行役（指示68-4・カセットの約束 v1）
//
// 約束は今の GAME_DRIVERS と同じ。点の決め方と時間の測り方は public/js/pittari-logic.js。
//
// ---- 流れ（1回 約20〜35秒・5回） ----
//   set（よーい・2.6秒）→ run（スタート〜目標＋10秒。全員押したら待たない）→ roundResult（開く・8秒）
//
// ---- 秘密がこのゲームの芯 ----
//   **タイムは開くまで、どこにも出さない**（TV にも、ほかの端末にも、押した本人にも）。
//   run の間は「だれが押したか」も公開しない——みんな同時にスタートしているので、押した順はタイムの順そのもの。
//   のこり時間も出さない（時計が見えると、心の中で数える遊びにならない）。
//   タイム（w.stops）を読むのは settle だけ
'use strict';

const path = require('path');
const L = require(path.join(__dirname, 'public', 'js', 'pittari-logic.js'));
const R = L.RULES;

// 段階の名前は、ほかのゲームと札の表（index.html の RT_PHASE_LABEL）を共有する（落とし穴2）
const PHASE = {
  LOBBY: 'lobby',
  SET: 'set',
  RUN: 'run',
  RESULT: 'roundResult',
  ENDED: 'ended'
};

function now() { return Date.now(); }
function playersOf(room) {
  return Array.from(room.members.values()).filter((m) => m.role === 'player');
}
function isPresent(room, id) { return room.members.has(id); }
function isLive(room, id) { const m = room.members.get(id); return !!(m && m.connected); }

function startGame(room, config, ctx) {
  const members = playersOf(room);
  if (members.length < R.MIN_PLAYERS) return { ok: false, error: 'too_few_players', message: R.MIN_PLAYERS + '人以上必要です' };
  if (members.length > R.MAX_PLAYERS) return { ok: false, error: 'too_many_players', message: R.MAX_PLAYERS + '人までです' };
  const names = {};
  members.forEach((m) => { names[m.id] = m.name; });
  room.pittari = {
    playerIds: members.map((m) => m.id),
    names,
    rounds: L.ROUNDS.map((x) => Object.assign({}, x)),
    round: 0,
    stops: {},           // ---- 秘密：いまの回の { memberId: ミリ秒 } ----
    history: [],
    phase: PHASE.LOBBY,
    deadline: null,
    recorded: false
  };
  room.state.game = 'pittari';
  beginRound(room);
  if (ctx && ctx.notify) ctx.notify(room);
  return { ok: true };
}

function beginRound(room) {
  const w = room.pittari;
  w.stops = {};
  w.phase = PHASE.SET;
  room.state.phase = PHASE.SET;
  w.deadline = now() + R.SET_MS;
}
function go(room) {
  const w = room.pittari;
  const t = w.rounds[w.round];
  w.phase = PHASE.RUN;
  room.state.phase = PHASE.RUN;
  // 端末は自分の時計で測る。サーバーの締め切りは、知らせが届くまでの遅れのぶん（1.5秒）だけ長く待つ
  w.deadline = now() + t.target * 1000 + R.LATE_MS + 1500;
}
function settle(room) {
  const w = room.pittari;
  const t = w.rounds[w.round];
  const ids = w.playerIds.filter((id) => isPresent(room, id));
  const s = L.scoreRound(w.stops, t.target, ids, !!t.double);
  w.history.push(Object.assign({ target: t.target, show: t.show, double: !!t.double, ids }, s));
  w.phase = PHASE.RESULT;
  room.state.phase = PHASE.RESULT;
  w.deadline = now() + R.OPEN_MS;
}
function finish(room) {
  const w = room.pittari;
  w.phase = PHASE.ENDED;
  room.state.phase = PHASE.ENDED;
  w.deadline = null;
}

function undecidedIds(room) {
  const w = room.pittari;
  if (!w || w.phase !== PHASE.RUN) return [];
  return w.playerIds.filter((id) => isPresent(room, id) && typeof w.stops[id] !== 'number');
}
function expectedMembers(room) { return undecidedIds(room); }

/** はかっている間、つながっている人が全員押したら開く。だれもいなければ進めない（締め切りはある） */
function isAllDone(room) {
  const w = room.pittari;
  if (!w || w.phase !== PHASE.RUN) return false;
  const live = w.playerIds.filter((id) => isLive(room, id));
  if (!live.length) return false;
  return live.every((id) => typeof w.stops[id] === 'number');
}

function advance(room) {
  const w = room.pittari;
  if (!w || w.phase === PHASE.ENDED || w.phase === PHASE.LOBBY) return false;
  if (w.phase === PHASE.SET) { go(room); return true; }
  if (w.phase === PHASE.RUN) { settle(room); return true; }
  if (w.round + 1 >= w.rounds.length) { finish(room); return true; }
  w.round++;
  beginRound(room);
  return true;
}

function scoresOf(w) {
  const sc = {};
  w.playerIds.forEach((id) => { sc[id] = 0; });
  w.history.forEach((h) => { Object.keys(h.points || {}).forEach((id) => { sc[id] = (sc[id] || 0) + h.points[id]; }); });
  return sc;
}

/** 開いた回を、公開してよい形に（名前で）。遠い順に並べる（画面は遠い人から名前を落とす） */
function openedView(w, h) {
  const rows = h.rows.map((r) => ({ id: r.id, name: w.names[r.id], diff: r.diff, rank: r.rank, points: r.points }));
  return {
    target: h.target, double: h.double,
    rows: rows.slice().reverse(),
    crowned: rows.filter((r) => r.rank === 1).map((r) => r.name),
    perfect: h.perfect.map((id) => w.names[id]),
    missed: h.ids.filter((id) => !h.rows.some((r) => r.id === id)).length
  };
}

/**
 * 部屋の全員（TV を含む）に配る。**白名簿で組み立てる**。
 * set・run の間：何回目・目標・時計が見えるか・2倍か・名前と点。**押した人・タイム・のこり時間は入れない**
 */
function publicView(room) {
  const w = room.pittari;
  if (!w) return { phase: PHASE.LOBBY };
  const t = w.rounds[w.round] || null;
  const sc = scoresOf(w);
  const view = {
    phase: w.phase,
    round: w.round + 1,
    total: w.rounds.length,
    target: t ? t.target : null,
    show: t ? t.show : true,
    showMs: R.SHOW_MS,
    double: t ? !!t.double : false,
    players: w.playerIds.filter((id) => isPresent(room, id)).map((id) => ({ id, name: w.names[id], score: sc[id] || 0 })),
    remainingMs: w.phase === PHASE.RESULT && w.deadline ? Math.max(0, w.deadline - now()) : null,
    reveal: null,
    result: null
  };
  if (w.phase === PHASE.RESULT || w.phase === PHASE.ENDED) {
    const last = w.history[w.history.length - 1];
    if (last) view.reveal = openedView(w, last);
  }
  if (w.phase === PHASE.ENDED) view.result = resultView(room);
  return view;
}

/** 本人だけ：押したか（タイムは開くまで本人にも出さない）・開いたあとの自分の差・自分の点 */
function privateFor(room, memberId) {
  const w = room.pittari;
  if (!w || w.playerIds.indexOf(memberId) === -1) return null;
  const last = w.history[w.history.length - 1];
  const mine = (w.phase === PHASE.RESULT || w.phase === PHASE.ENDED) && last ? last.rows.find((r) => r.id === memberId) : null;
  return {
    phase: w.phase,
    round: w.round + 1,
    stopped: w.phase === PHASE.RUN ? typeof w.stops[memberId] === 'number' : false,
    myDiff: mine ? mine.diff : null,
    myRank: mine ? mine.rank : null,
    myPoints: mine ? mine.points : null,
    myScore: scoresOf(w)[memberId] || 0
  };
}

/** { ms: 10012 } … ストップ（はかっている間・プレイヤーだけ・1回だけ）。ありえない値ははねる */
function submitAction(room, memberId, targetId, payload) {
  const w = room.pittari;
  if (!w || w.phase === PHASE.ENDED || w.phase === PHASE.LOBBY) return { ok: false, error: 'not_playing' };
  if (w.playerIds.indexOf(memberId) === -1) return { ok: false, error: 'not_player' };
  if (w.phase !== PHASE.RUN) return { ok: false, error: 'not_running' };
  if (typeof w.stops[memberId] === 'number') return { ok: false, error: 'already_stopped' };
  const ms = payload && payload.ms;
  const t = w.rounds[w.round];
  if (!L.validMs(ms, t.target)) return { ok: false, error: 'bad_time' };
  w.stops[memberId] = Math.round(ms);
  return { ok: true, allDone: isAllDone(room) };
}
function submitVote(room, memberId, targetId, payload) { return submitAction(room, memberId, targetId, payload); }

function resultView(room) {
  const w = room.pittari;
  if (!w) return null;
  const ids = w.playerIds.filter((id) => isPresent(room, id));
  const r = L.finalResult(w.history, ids);
  const nm = (id) => w.names[id];
  return {
    rounds: w.history.length,
    awards: { perfect: r.awards.perfect.map(nm), master: r.awards.master.map(nm) },
    // 称号を数える端末は名前でなく id で照らす（ふだんの部屋では同じ名前が2人いることがある）
    awardIds: { perfect: r.awards.perfect.slice(), master: r.awards.master.slice() },
    ranking: r.ranking.map((x) => ({ id: x.id, name: nm(x.id), score: x.score, rank: x.rank, sum: x.sum })),
    history: w.history.map((h) => ({ target: h.target, double: h.double, best: h.rows.length ? h.rows[0].diff : null }))
  };
}

/**
 * 時計の種類。**はかっている間は時計を出さない**（のこり時間が見えると、数える遊びにならない）。
 * 段階がまだ無い時は消さない（落とし穴20・tests/big-screen.js）
 */
function clockKind(room) {
  const ph = room && room.pittari && room.pittari.phase;
  return (ph === PHASE.SET || ph === PHASE.RUN || ph === PHASE.RESULT || ph === PHASE.ENDED) ? 'tick' : 'play';
}

module.exports = {
  PHASE, startGame, publicView, privateFor, submitAction, submitVote, isAllDone, advance,
  playersOf, expectedMembers, undecidedIds, resultView, clockKind
};
