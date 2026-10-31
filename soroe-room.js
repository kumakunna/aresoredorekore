// soroe-room.js — 「そろえて発射」の進行役（指示68-4・カセットの約束 v1）
//
// 約束は今の GAME_DRIVERS と同じ。高さと点の決め方・時計合わせの計算は public/js/soroe-logic.js。
//
// ---- 流れ（1回 約12〜18秒・5回） ----
//   launch（合図 → 押す。全員押したら待たない）→ roundResult（点が並ぶ → ロケットが飛ぶ・7秒）
//
// ---- だれがずれたかは、どこにも出さない（協力・大切なこと5） ----
//   押した時刻（w.presses）を読むのは settle だけ。開いた時に出すのは、名前を外して並べた点（最初の人からのミリ秒）と、
//   いちばん早い人と遅い人の差だけ。本人にも「押したか」しか返さない
'use strict';

const path = require('path');
const L = require(path.join(__dirname, 'public', 'js', 'soroe-logic.js'));
const R = L.RULES;

// 'launch' はほかのゲームと被らない（札の表 RT_PHASE_LABEL は全ゲームで1枚・落とし穴2）
const PHASE = {
  LOBBY: 'lobby',
  LAUNCH: 'launch',
  RESULT: 'roundResult',
  ENDED: 'ended'
};

function now() { return Date.now(); }
function playersOf(room) {
  return Array.from(room.members.values()).filter((m) => m.role === 'player');
}
function isPresent(room, id) { return room.members.has(id); }
function isLive(room, id) { const m = room.members.get(id); return !!(m && m.connected); }
/** 文化祭の部屋の「今日」（その日だけの最高記録の鍵） */
const TOP_STEP = { building: 1, cloud: 2, moon: 3, space: 4 };
function today(t) { const d = new Date(t); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }

function startGame(room, config, ctx) {
  const members = playersOf(room);
  if (members.length < R.MIN_PLAYERS) return { ok: false, error: 'too_few_players', message: R.MIN_PLAYERS + '人以上必要です' };
  if (members.length > R.MAX_PLAYERS) return { ok: false, error: 'too_many_players', message: R.MAX_PLAYERS + '人までです' };
  const names = {};
  members.forEach((m) => { names[m.id] = m.name; });
  room.soroe = {
    playerIds: members.map((m) => m.id),
    names,
    rounds: L.ROUNDS.map((x) => Object.assign({}, x)),
    round: 0,
    presses: {},         // ---- 秘密：いまの回の { memberId: 押した時刻（サーバーの時刻） } ----
    startedAt: null,
    history: [],
    phase: PHASE.LOBBY,
    deadline: null,
    recorded: false
  };
  room.state.game = 'soroe';
  beginRound(room);
  if (ctx && ctx.notify) ctx.notify(room);
  return { ok: true };
}

function beginRound(room) {
  const w = room.soroe;
  const t = w.rounds[w.round];
  w.presses = {};
  w.phase = PHASE.LAUNCH;
  room.state.phase = PHASE.LAUNCH;
  w.startedAt = now();
  w.deadline = L.closeAt(t, w.startedAt);
}
function settle(room) {
  const w = room.soroe;
  const t = w.rounds[w.round];
  const ids = w.playerIds.filter((id) => isPresent(room, id));
  const s = L.scoreRound(w.presses, ids, !!t.double);
  w.history.push(Object.assign({ signal: t.signal, double: !!t.double }, s));
  // 指示68-T 三の束1：その日の最高の高さを部屋に覚える（右はしの目じるしの旗・その日だけ・部屋ごと）
  const step = s.flew ? (TOP_STEP[s.height] || 0) : 0;
  if (step) {
    const day = today(now());
    if (!room.soroeTop || room.soroeTop.day !== day || step > room.soroeTop.step) room.soroeTop = { day, step, height: s.height };
  }
  w.phase = PHASE.RESULT;
  room.state.phase = PHASE.RESULT;
  w.deadline = now() + R.OPEN_MS;
}
function finish(room) {
  const w = room.soroe;
  w.phase = PHASE.ENDED;
  room.state.phase = PHASE.ENDED;
  w.deadline = null;
  // 文化祭の部屋では、その日の最高記録を部屋に覚える（その日だけ・部屋ごと）
  if (room.fes) {
    const total = L.finalResult(w.history).total, day = today(now());
    if (!room.soroeBest || room.soroeBest.day !== day || total > room.soroeBest.total) room.soroeBest = { day, total };
  }
}

function undecidedIds(room) {
  const w = room.soroe;
  if (!w || w.phase !== PHASE.LAUNCH) return [];
  return w.playerIds.filter((id) => isPresent(room, id) && typeof w.presses[id] !== 'number');
}
function expectedMembers(room) { return undecidedIds(room); }

function isAllDone(room) {
  const w = room.soroe;
  if (!w || w.phase !== PHASE.LAUNCH) return false;
  const live = w.playerIds.filter((id) => isLive(room, id));
  if (!live.length) return false;
  return live.every((id) => typeof w.presses[id] === 'number');
}

function advance(room) {
  const w = room.soroe;
  if (!w || w.phase === PHASE.ENDED || w.phase === PHASE.LOBBY) return false;
  if (w.phase === PHASE.LAUNCH) { settle(room); return true; }
  if (w.round + 1 >= w.rounds.length) { finish(room); return true; }
  w.round++;
  beginRound(room);
  return true;
}

function openedView(h) {
  return { signal: h.signal, double: h.double, count: h.count, n: h.n, flew: h.flew, spread: h.spread,
    height: h.height, points: h.points, together: h.together, dots: h.dots.slice() };
}

/**
 * 部屋の全員（TV を含む）に配る。**白名簿で組み立てる**。
 * launch の間：合図の形・始まりの時刻（サーバーの時刻）・0 の時刻・押した人の数（名前なし）。押した時刻は入れない
 */
function publicView(room) {
  const w = room.soroe;
  if (!w) return { phase: PHASE.LOBBY };
  const t = w.rounds[w.round] || null;
  const fr = L.finalResult(w.history);
  const view = {
    phase: w.phase,
    round: w.round + 1,
    total: w.rounds.length,
    signal: t ? t.signal : null,
    step: t ? t.step || null : null,
    double: t ? !!t.double : false,
    startedAt: w.phase === PHASE.LAUNCH ? w.startedAt : null,
    zeroAt: w.phase === PHASE.LAUNCH ? L.zeroAt(t, w.startedAt) : null,
    closeAt: w.phase === PHASE.LAUNCH ? w.deadline : null,
    serverNow: now(),
    pressedCount: w.phase === PHASE.LAUNCH ? Object.keys(w.presses).length : null,
    players: w.playerIds.filter((id) => isPresent(room, id)).map((id) => ({ id, name: w.names[id] })),
    score: fr.total,
    best: room.fes && room.soroeBest && room.soroeBest.day === today(now()) ? room.soroeBest.total : null,
    bestHeight: room.soroeTop && room.soroeTop.day === today(now()) ? room.soroeTop.height : null,   // 指示68-T 三の束1：その日の最高の高さ（旗）
    reveal: null,
    result: null
  };
  if (w.phase === PHASE.RESULT || w.phase === PHASE.ENDED) {
    const last = w.history[w.history.length - 1];
    if (last) view.reveal = openedView(last);
  }
  if (w.phase === PHASE.ENDED) view.result = resultView(room);
  return view;
}

/** 本人だけ：押したか（押した時刻も、ずれも返さない） */
function privateFor(room, memberId) {
  const w = room.soroe;
  if (!w || w.playerIds.indexOf(memberId) === -1) return null;
  return { phase: w.phase, round: w.round + 1, pressed: w.phase === PHASE.LAUNCH ? typeof w.presses[memberId] === 'number' : false };
}

/** { at: サーバーの時刻に直した押した時刻 } … 発射（その回の間・プレイヤーだけ・1回だけ）。ありえない時刻ははねる */
function submitAction(room, memberId, targetId, payload) {
  const w = room.soroe;
  if (!w || w.phase === PHASE.ENDED || w.phase === PHASE.LOBBY) return { ok: false, error: 'not_playing' };
  if (w.playerIds.indexOf(memberId) === -1) return { ok: false, error: 'not_player' };
  if (w.phase !== PHASE.LAUNCH) return { ok: false, error: 'not_launch' };
  if (typeof w.presses[memberId] === 'number') return { ok: false, error: 'already_pressed' };
  const at = payload && payload.at;
  if (!L.validAt(at, w.startedAt, w.deadline)) return { ok: false, error: 'bad_time' };
  w.presses[memberId] = at;
  return { ok: true, allDone: isAllDone(room) };
}
function submitVote(room, memberId, targetId, payload) { return submitAction(room, memberId, targetId, payload); }

function resultView(room) {
  const w = room.soroe;
  if (!w) return null;
  const r = L.finalResult(w.history);
  return {
    rounds: w.history.length, total: r.total, bestSpread: r.best, together: r.together, space: r.space,
    heights: w.history.map((h) => ({ height: h.height, points: h.points, flew: h.flew, double: h.double })),
    dayBest: room.fes && room.soroeBest ? room.soroeBest.total : null
  };
}

/** 合図の間は時計を出さない（TV のカウントそのものが合図。大きな数字を重ねない）。段階が無い時は消さない */
function clockKind(room) {
  const ph = room && room.soroe && room.soroe.phase;
  return (ph === PHASE.LAUNCH || ph === PHASE.RESULT || ph === PHASE.ENDED) ? 'tick' : 'play';
}

module.exports = {
  PHASE, startGame, publicView, privateFor, submitAction, submitVote, isAllDone, advance,
  playersOf, expectedMembers, undecidedIds, resultView, clockKind
};
