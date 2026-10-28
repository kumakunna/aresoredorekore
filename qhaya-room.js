// qhaya-room.js — クイズ王2.0「みんなで早答え」の進行役（指示68-5・カセットの約束 v1）
//
// 約束は今の GAME_DRIVERS と同じ（startGame・publicView・privateFor・submitAction・submitVote・isAllDone・advance・resultView・clockKind）。
// 点の決め方は public/js/quiz2-logic.js、問題は public/js/quiz-bank.js（クイズ解除と同じ箱）。
//
// ---- 流れ（1問 約20秒） ----
//   choose（10秒）… 全員が同じ問題に同時に答える。押したら変えられない。全員そろうか時間切れで unveil へ
//   unveil（7秒） … 開く：答えごとの人数・正解・正解の人の名前・いちばん早かった人。10問目のあとは ended
//
// ---- 秘密 ----
//   **正解の番号（correct）は、開くまで公開（publicView）にも本人だけの物（privateFor）にも入れない。判定はサーバーだけ。**
//   答えている間に公開に出すのは「答えた人数」だけ（TV の光の粒）。だれが何を押したかは、開くまで出さない
//
// ---- 早さ ----
//   早さは端末で測る（問題を出した時から押した時まで・ぴったり10秒と同じ考え）。届くまでの遅れが点に入らないように。
//   サーバーは「ありえる範囲」だけ見る：サーバーで測った時間より長くはならず、通信の遅れ（1.5秒）より短くもならない
'use strict';

const path = require('path');
const L = require(path.join(__dirname, 'public', 'js', 'quiz2-logic.js'));
const Bank = require(path.join(__dirname, 'public', 'js', 'quiz-bank.js'));
const R = L.RULES, H = R.HAYA;
const LATE_MS = 1500;

const PHASE = { LOBBY: 'lobby', CHOOSE: 'choose', OPEN: 'unveil', ENDED: 'ended' };

function now() { return Date.now(); }
function playersOf(room) { return Array.from(room.members.values()).filter((m) => m.role === 'player'); }
function isPresent(room, id) { return room.members.has(id); }
function isLive(room, id) { const m = room.members.get(id); return !!(m && m.connected); }

function startGame(room, config, ctx) {
  const members = playersOf(room);
  if (members.length < R.MIN_PLAYERS) return { ok: false, error: 'too_few_players', message: R.MIN_PLAYERS + '人以上必要です' };
  if (members.length > R.MAX_PLAYERS) return { ok: false, error: 'too_many_players', message: R.MAX_PLAYERS + '人までです' };
  const rand = (config && config._rand) || Math.random;
  // 同じ部屋（文化祭は1日1つ）で同じ問題がなるべく出ないように、出した問題を部屋に覚える（クイズ解除の問題とも分け合う）
  room.quiz2Used = room.quiz2Used || {};
  const qs = L.pickHaya(Bank, room.quiz2Used, rand).map((q) => Object.assign({ tier: q.tier }, Bank.shuffleChoices(q, rand)));
  qs.forEach((q) => { room.quiz2Used[q.q] = true; });
  const names = {};
  members.forEach((m) => { names[m.id] = m.name; });
  room.qhaya = {
    playerIds: members.map((m) => m.id),
    names,
    qs,                    // ---- 秘密：correct を持つ。開いた問題の correct だけ公開してよい ----
    round: 0,
    answers: {},           // ---- 秘密：いまの問題の { memberId: { pick, ms } } ----
    history: [],
    phase: PHASE.LOBBY,
    startedAt: null,
    deadline: null,
    recorded: false
  };
  room.state.game = 'qhaya';
  beginRound(room);
  if (ctx && ctx.notify) ctx.notify(room);
  return { ok: true };
}

function beginRound(room) {
  const w = room.qhaya;
  w.answers = {};
  w.phase = PHASE.CHOOSE;
  room.state.phase = PHASE.CHOOSE;
  w.startedAt = now();
  w.deadline = w.startedAt + H.ANSWER_SEC * 1000;
}

function isDouble(w, k) { return k === w.qs.length - 1; }

/** いまの問題を開く（点を決めて、開いた物を history に積む） */
function settle(room) {
  const w = room.qhaya;
  const q = w.qs[w.round];
  const ids = w.playerIds.filter((id) => isPresent(room, id));
  const s = L.scoreHaya(q.choices.length, w.answers, q.correct, ids, isDouble(w, w.round));
  const before = scoresOf(w);
  w.history.push({ q: q.q, choices: q.choices.slice(), correct: q.correct, tier: q.tier, double: isDouble(w, w.round), ids, before, ...s });
  w.phase = PHASE.OPEN;
  room.state.phase = PHASE.OPEN;
  w.deadline = now() + H.OPEN_SEC * 1000;
}

function finish(room) {
  const w = room.qhaya;
  w.phase = PHASE.ENDED;
  room.state.phase = PHASE.ENDED;
  w.deadline = null;
}

function undecidedIds(room) {
  const w = room.qhaya;
  if (!w || w.phase !== PHASE.CHOOSE) return [];
  return w.playerIds.filter((id) => isPresent(room, id) && !w.answers[id]);
}
function expectedMembers(room) { return undecidedIds(room); }

function isAllDone(room) {
  const w = room.qhaya;
  if (!w || w.phase !== PHASE.CHOOSE) return false;
  const live = w.playerIds.filter((id) => isLive(room, id));
  if (!live.length) return false;
  return live.every((id) => !!w.answers[id]);
}

function advance(room) {
  const w = room.qhaya;
  if (!w || w.phase === PHASE.ENDED || w.phase === PHASE.LOBBY) return false;
  if (w.phase === PHASE.CHOOSE) { settle(room); return true; }
  if (w.round + 1 >= w.qs.length) { finish(room); return true; }
  w.round++;
  beginRound(room);
  return true;
}

/** 累計の点（開いた問題だけから） */
function scoresOf(w) {
  const sc = {};
  w.playerIds.forEach((id) => { sc[id] = 0; });
  w.history.forEach((h) => { Object.keys(h.rows || {}).forEach((id) => { sc[id] = (sc[id] || 0) + h.rows[id].points; }); });
  return sc;
}

/** 3問ごと（と最後）に、順位の表を開く。前の順位もつけて、入れかわりを描けるように */
function rankingOf(room, w, h) {
  const ids = w.playerIds.filter((id) => isPresent(room, id));
  const after = L.rankOf(scoresOf(w), ids), prev = L.rankOf(h.before, ids);
  const prevRank = {}; prev.forEach((x) => { prevRank[x.id] = x.rank; });
  return after.map((x) => ({ name: w.names[x.id], score: x.score, rank: x.rank, prevRank: prevRank[x.id] }));
}

/** 開いた問題を、公開してよい形に。**名前は正解の答えの所だけ**（まちがえた人は出さない・責めない） */
function openedView(room, w, h, k) {
  const rightIds = h.ids.filter((id) => h.rows[id].right).sort((a, b) => h.rows[a].ms - h.rows[b].ms);
  const last = k === w.qs.length - 1;
  return {
    q: h.q, choices: h.choices.slice(), correct: h.correct, counts: h.counts.slice(), double: h.double,
    right: rightIds.map((id) => ({ name: w.names[id], ms: h.rows[id].ms, points: h.rows[id].points })),
    fastest: h.fastest.map((id) => w.names[id]), fastestMs: h.fastestMs,
    answered: h.ids.filter((id) => h.rows[id].pick !== null).length,
    ranking: ((k + 1) % H.RANK_EVERY === 0 || last) ? rankingOf(room, w, h) : null
  };
}

/**
 * 部屋の全員（TV を含む）に配る。**白名簿で組み立てる**（w を丸ごと写さない）。
 * choose の間：問題・選択肢・答えた人数・のこり時間・累計の点。**正解は入れない**
 */
function publicView(room) {
  const w = room.qhaya;
  if (!w) return { phase: PHASE.LOBBY };
  const q = w.qs[w.round] || null;
  const sc = scoresOf(w);
  const view = {
    phase: w.phase,
    round: w.round + 1,
    total: w.qs.length,
    double: isDouble(w, w.round),
    tier: q ? q.tier : null,
    topic: q ? { q: q.q, choices: q.choices.slice() } : null,
    players: w.playerIds.filter((id) => isPresent(room, id)).map((id) => ({ id, name: w.names[id], score: sc[id] || 0 })),
    answered: w.phase === PHASE.CHOOSE ? Object.keys(w.answers).length : 0,
    remainingMs: w.deadline ? Math.max(0, w.deadline - now()) : null,
    reveal: null,
    result: null
  };
  if (w.phase === PHASE.OPEN || w.phase === PHASE.ENDED) {
    const h = w.history[w.history.length - 1];
    if (h) view.reveal = openedView(room, w, h, w.history.length - 1);
  }
  if (w.phase === PHASE.ENDED) view.result = resultView(room);
  return view;
}

/** 本人だけ：自分が押した番号（押したあと）・開いたら当たったか・その問題の点・累計の点。**正解は入れない** */
function privateFor(room, memberId) {
  const w = room.qhaya;
  if (!w || w.playerIds.indexOf(memberId) === -1) return null;
  const out = { phase: w.phase, round: w.round + 1, myPick: null, myRight: null, myPoints: null, myMs: null, myScore: scoresOf(w)[memberId] || 0 };
  if (w.phase === PHASE.CHOOSE) {
    const a = w.answers[memberId];
    out.myPick = a ? a.pick : null;
  } else if (w.history.length) {
    const r = w.history[w.history.length - 1].rows[memberId];
    if (r) { out.myPick = r.pick; out.myRight = r.right; out.myPoints = r.points; out.myMs = r.ms; }
  }
  return out;
}

/** { pick: 2, ms: 3120 } … 答える（答える段階・プレイヤーだけ・1回だけ）。ms は端末で測った時間 */
function submitAction(room, memberId, targetId, payload) {
  const w = room.qhaya;
  if (!w || w.phase === PHASE.ENDED || w.phase === PHASE.LOBBY) return { ok: false, error: 'not_playing' };
  if (w.playerIds.indexOf(memberId) === -1) return { ok: false, error: 'not_player' };
  if (w.phase !== PHASE.CHOOSE) return { ok: false, error: 'not_choose' };
  if (w.answers[memberId]) return { ok: false, error: 'already_chosen' };
  const raw = payload && payload.pick !== undefined ? payload.pick : targetId;
  const k = (typeof raw === 'number') ? raw : (/^[0-9]+$/.test(String(raw)) ? Number(raw) : NaN);
  const q = w.qs[w.round];
  if (!Number.isInteger(k) || k < 0 || k >= q.choices.length) return { ok: false, error: 'unknown_choice' };
  // 端末の時間は「ありえる範囲」に寄せる（サーバーの時間より長くない・遅れより短くない）
  const server = Math.max(0, now() - w.startedAt);
  const dev = payload && typeof payload.ms === 'number' && Number.isFinite(payload.ms) ? payload.ms : server;
  const ms = Math.round(Math.min(server, Math.max(server - LATE_MS, dev, 0)));
  w.answers[memberId] = { pick: k, ms };
  return { ok: true, allDone: isAllDone(room) };
}
function submitVote(room, memberId, targetId, payload) { return submitAction(room, memberId, targetId, payload); }

/** 結果：順位と、いちばん早く当てた回数がいちばん多い人 */
function resultView(room) {
  const w = room.qhaya;
  if (!w) return null;
  const ids = w.playerIds.filter((id) => isPresent(room, id));
  const ranking = L.rankOf(scoresOf(w), ids);
  const fast = {}; ids.forEach((id) => { fast[id] = 0; });
  w.history.forEach((h) => h.fastest.forEach((id) => { if (fast[id] != null) fast[id]++; }));
  const most = Math.max(0, ...ids.map((id) => fast[id]));
  return {
    questions: w.history.length,
    ranking: ranking.map((x) => ({ id: x.id, name: w.names[x.id], score: x.score, rank: x.rank })),
    champion: ranking.filter((x) => x.rank === 1).map((x) => w.names[x.id]),
    fastestMost: most ? ids.filter((id) => fast[id] === most).map((id) => w.names[id]) : [],
    awardIds: { champion: ranking.filter((x) => x.rank === 1).map((x) => x.id) }
  };
}

function clockKind(room) {
  const ph = room && room.qhaya && room.qhaya.phase;
  return (ph === PHASE.OPEN || ph === PHASE.ENDED) ? 'tick' : 'play';
}

module.exports = {
  PHASE, startGame, publicView, privateFor, submitAction, submitVote, isAllDone, advance,
  playersOf, expectedMembers, undecidedIds, resultView, clockKind
};
