// qnear-room.js — クイズ王2.0「数字ちかい方」の進行役（指示68-5・カセットの約束 v1）
//
// 約束は今の GAME_DRIVERS と同じ。点の決め方と数直線の目盛りは public/js/quiz2-logic.js、
// 問題は表から作った「数字で答える問題」（public/js/quiz-tables.js・指示68-1／68-Q）。
//
// ---- 流れ（1問 約25秒） ----
//   guess（15秒）… 答えを数字で入れる。「決定」を押したら変えられない。全員そろうか時間切れで unveil へ
//   unveil（8秒） … 開く：全員の答え（名前つき・遠い人から）・正解・いちばん近い人。5問目のあとは ended
//
// ---- 秘密 ----
//   **正解の数は、開くまで公開（publicView）にも本人だけの物（privateFor）にも入れない。**
//   入れている間に公開に出すのは「決定した人数」だけ。だれが何を入れたかは、開くまで出さない
'use strict';

const path = require('path');
const L = require(path.join(__dirname, 'public', 'js', 'quiz2-logic.js'));
const Bank = require(path.join(__dirname, 'public', 'js', 'quiz-bank.js'));
const R = L.RULES, N = R.NEAR;

// 'choose' は 3択の「えらぶ」。数字を入れる段階は札の表（index.html の RT_PHASE_LABEL）に 'guess' を足した
const PHASE = {
  LOBBY: 'lobby',
  GUESS: 'guess',
  OPEN: 'unveil',
  ENDED: 'ended'
};

function now() { return Date.now(); }
function playersOf(room) { return Array.from(room.members.values()).filter((m) => m.role === 'player'); }
function isPresent(room, id) { return room.members.has(id); }
function isLive(room, id) { const m = room.members.get(id); return !!(m && m.connected); }

function startGame(room, config, ctx) {
  const members = playersOf(room);
  if (members.length < R.MIN_PLAYERS) return { ok: false, error: 'too_few_players', message: R.MIN_PLAYERS + '人以上必要です' };
  if (members.length > R.MAX_PLAYERS) return { ok: false, error: 'too_many_players', message: R.MAX_PLAYERS + '人までです' };
  const rand = (config && config._rand) || Math.random;
  room.quiz2Used = room.quiz2Used || {};
  const qs = L.pickNear(Bank, room.quiz2Used, rand);
  qs.forEach((q) => { room.quiz2Used[q.q] = true; });
  const names = {};
  members.forEach((m) => { names[m.id] = m.name; });
  room.qnear = {
    playerIds: members.map((m) => m.id),
    names,
    qs,                    // ---- 秘密：answer を持つ。開いた問題の answer だけ公開してよい ----
    round: 0,
    answers: {},           // ---- 秘密：いまの問題の { memberId: 数 } ----
    history: [],
    phase: PHASE.LOBBY,
    deadline: null,
    recorded: false
  };
  room.state.game = 'qnear';
  beginRound(room);
  if (ctx && ctx.notify) ctx.notify(room);
  return { ok: true };
}

function beginRound(room) {
  const w = room.qnear;
  w.answers = {};
  w.phase = PHASE.GUESS;
  room.state.phase = PHASE.GUESS;
  w.deadline = now() + N.ANSWER_SEC * 1000;
}

function settle(room) {
  const w = room.qnear;
  const q = w.qs[w.round];
  const ids = w.playerIds.filter((id) => isPresent(room, id));
  const s = L.scoreNear(w.answers, q.answer, ids);
  w.history.push({ q: q.q, unit: q.unit, answer: q.answer, ids, rows: s.rows, crowned: s.crowned, perfect: s.perfect });
  w.phase = PHASE.OPEN;
  room.state.phase = PHASE.OPEN;
  w.deadline = now() + N.OPEN_SEC * 1000;
}

function finish(room) {
  const w = room.qnear;
  w.phase = PHASE.ENDED;
  room.state.phase = PHASE.ENDED;
  w.deadline = null;
}

function undecidedIds(room) {
  const w = room.qnear;
  if (!w || w.phase !== PHASE.GUESS) return [];
  return w.playerIds.filter((id) => isPresent(room, id) && typeof w.answers[id] !== 'number');
}
function expectedMembers(room) { return undecidedIds(room); }

function isAllDone(room) {
  const w = room.qnear;
  if (!w || w.phase !== PHASE.GUESS) return false;
  const live = w.playerIds.filter((id) => isLive(room, id));
  if (!live.length) return false;
  return live.every((id) => typeof w.answers[id] === 'number');
}

function advance(room) {
  const w = room.qnear;
  if (!w || w.phase === PHASE.ENDED || w.phase === PHASE.LOBBY) return false;
  if (w.phase === PHASE.GUESS) { settle(room); return true; }
  if (w.round + 1 >= w.qs.length) { finish(room); return true; }
  w.round++;
  beginRound(room);
  return true;
}

function scoresOf(w) {
  const sc = {};
  w.playerIds.forEach((id) => { sc[id] = 0; });
  w.history.forEach((h) => { Object.keys(h.rows || {}).forEach((id) => { sc[id] = (sc[id] || 0) + h.rows[id].points; }); });
  return sc;
}

/** 開いた問題（名前つき・遠い人から並べる）。数直線の目盛りと、端の「→」の束もここで決める */
function openedView(w, h) {
  const got = h.ids.filter((id) => h.rows[id].value !== null);
  const axis = L.axisOf(got.map((id) => h.rows[id].value), h.answer);
  const farL = axis.far.left.map((i) => got[i]), farR = axis.far.right.map((i) => got[i]);
  const rows = got.slice().sort((a, b) => h.rows[b].diff - h.rows[a].diff).map((id) => ({
    name: w.names[id], value: h.rows[id].value, diff: h.rows[id].diff, rank: h.rows[id].rank, points: h.rows[id].points,
    perfect: h.rows[id].perfect, far: farL.indexOf(id) !== -1 ? 'left' : (farR.indexOf(id) !== -1 ? 'right' : null)
  }));
  return {
    q: h.q, unit: h.unit, answer: h.answer, rows,
    axis: { min: axis.min, max: axis.max },
    crowned: h.crowned.map((id) => w.names[id]), perfect: h.perfect.map((id) => w.names[id]),
    missed: h.ids.length - got.length
  };
}

function publicView(room) {
  const w = room.qnear;
  if (!w) return { phase: PHASE.LOBBY };
  const q = w.qs[w.round] || null;
  const sc = scoresOf(w);
  const view = {
    phase: w.phase,
    round: w.round + 1,
    total: w.qs.length,
    topic: q ? { q: q.q, unit: q.unit } : null,
    players: w.playerIds.filter((id) => isPresent(room, id)).map((id) => ({ id, name: w.names[id], score: sc[id] || 0 })),
    answered: w.phase === PHASE.GUESS ? Object.keys(w.answers).length : 0,
    remainingMs: w.deadline ? Math.max(0, w.deadline - now()) : null,
    reveal: null,
    result: null
  };
  if (w.phase === PHASE.OPEN || w.phase === PHASE.ENDED) {
    const h = w.history[w.history.length - 1];
    if (h) view.reveal = openedView(w, h);
  }
  if (w.phase === PHASE.ENDED) view.result = resultView(room);
  return view;
}

/** 本人だけ：自分が入れた数・開いたら差と点・累計。**正解は入れない**（開いたあとは公開の reveal にある） */
function privateFor(room, memberId) {
  const w = room.qnear;
  if (!w || w.playerIds.indexOf(memberId) === -1) return null;
  const out = { phase: w.phase, round: w.round + 1, myValue: null, myDiff: null, myRank: null, myPoints: null, myScore: scoresOf(w)[memberId] || 0 };
  if (w.phase === PHASE.GUESS) {
    out.myValue = typeof w.answers[memberId] === 'number' ? w.answers[memberId] : null;
  } else if (w.history.length) {
    const r = w.history[w.history.length - 1].rows[memberId];
    if (r) { out.myValue = r.value; out.myDiff = r.diff; out.myRank = r.rank; out.myPoints = r.points; }
  }
  return out;
}

/** { value: 3776 } … 決定（入れる段階・プレイヤーだけ・1回だけ）。数は 0 以上の整数・9けたまで */
function submitAction(room, memberId, targetId, payload) {
  const w = room.qnear;
  if (!w || w.phase === PHASE.ENDED || w.phase === PHASE.LOBBY) return { ok: false, error: 'not_playing' };
  if (w.playerIds.indexOf(memberId) === -1) return { ok: false, error: 'not_player' };
  if (w.phase !== PHASE.GUESS) return { ok: false, error: 'not_guess' };
  if (typeof w.answers[memberId] === 'number') return { ok: false, error: 'already_chosen' };
  const v = L.parseNumber(payload && payload.value !== undefined ? payload.value : targetId);
  if (v === null) return { ok: false, error: 'bad_number' };
  w.answers[memberId] = v;
  return { ok: true, allDone: isAllDone(room) };
}
function submitVote(room, memberId, targetId, payload) { return submitAction(room, memberId, targetId, payload); }

function resultView(room) {
  const w = room.qnear;
  if (!w) return null;
  const ids = w.playerIds.filter((id) => isPresent(room, id));
  const ranking = L.rankOf(scoresOf(w), ids);
  const perfect = {}; ids.forEach((id) => { perfect[id] = 0; });
  w.history.forEach((h) => h.perfect.forEach((id) => { if (perfect[id] != null) perfect[id]++; }));
  return {
    questions: w.history.length,
    ranking: ranking.map((x) => ({ id: x.id, name: w.names[x.id], score: x.score, rank: x.rank })),
    champion: ranking.filter((x) => x.rank === 1).map((x) => w.names[x.id]),
    perfect: ids.filter((id) => perfect[id] > 0).map((id) => w.names[id]),
    awardIds: { champion: ranking.filter((x) => x.rank === 1).map((x) => x.id) }
  };
}

function clockKind(room) {
  const ph = room && room.qnear && room.qnear.phase;
  return (ph === PHASE.OPEN || ph === PHASE.ENDED) ? 'tick' : 'play';
}

module.exports = {
  PHASE, startGame, publicView, privateFor, submitAction, submitVote, isAllDone, advance,
  playersOf, expectedMembers, undecidedIds, resultView, clockKind
};
