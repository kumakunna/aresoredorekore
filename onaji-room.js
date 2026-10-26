// onaji-room.js — 「みんなと同じ」の進行役（指示68-3・カセットの約束 v1 の最初の1本）
//
// 約束は今の GAME_DRIVERS と同じ（startGame・publicView・privateFor・submitAction・submitVote・isAllDone・advance・resultView・clockKind）。
// 新しい仕組みは作らない。点の決め方は public/js/onaji-logic.js、お題は public/js/onaji-bank.js。
//
// ---- 流れ（1問 約20秒） ----
//   choose（10秒）… 全員が選ぶ。選んだら変えられない。全員そろうか時間切れで open へ
//   unveil（7秒） … 開く：答えごとの人数・点になった答え・その答えの人の名前。5問目のあとは ended
//
// ---- 秘密がこのゲームの芯 ----
//   **開くまで、だれが何を選んだかも、答えごとに何人選んだかも、公開（publicView）に入れない。**
//   choose の間に公開に出すのは「選び終わった人の名前」だけ（TV で光る）。
//   本人の選んだ物は privateFor で本人にだけ返す。答え（w.answers）を読むのは settle と privateFor だけ
'use strict';

const path = require('path');
const L = require(path.join(__dirname, 'public', 'js', 'onaji-logic.js'));
const Bank = require(path.join(__dirname, 'public', 'js', 'onaji-bank.js'));
const R = L.RULES;

// 段階の名前は、ほかのゲームと札の表（index.html の RT_PHASE_LABEL）を共有する。
// 'open' は False or True の「ケースが開く」に取られているので、開くのは 'unveil'（落とし穴2）
const PHASE = {
  LOBBY: 'lobby',
  CHOOSE: 'choose',
  OPEN: 'unveil',
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
  const cfg = L.normalizeConfig(config);
  const rand = (config && config._rand) || Math.random;
  // 同じ部屋（文化祭は1日1つ）で同じお題がなるべく出ないように、出したお題を部屋に覚える
  room.onajiUsed = room.onajiUsed || {};
  const topics = Bank.pick(R.QUESTIONS, room.onajiUsed, rand);
  topics.forEach((t) => { room.onajiUsed[t.q] = true; });
  const names = {};
  members.forEach((m) => { names[m.id] = m.name; });
  room.onaji = {
    mode: cfg.mode,
    draft: Bank.usingDraft(),
    playerIds: members.map((m) => m.id),
    names,
    topics,
    round: 0,
    answers: {},          // ---- 秘密：いまの問題の { memberId: 選択肢の番号 } ----
    history: [],          // 開いた問題（開いた物だけ公開してよい）
    phase: PHASE.LOBBY,
    deadline: null,
    recorded: false
  };
  room.state.game = 'onaji';
  beginRound(room);
  if (ctx && ctx.notify) ctx.notify(room);
  return { ok: true };
}

function beginRound(room) {
  const w = room.onaji;
  w.answers = {};
  w.phase = PHASE.CHOOSE;
  room.state.phase = PHASE.CHOOSE;
  w.deadline = now() + R.CHOOSE_SEC * 1000;
}

/** いまの問題を開く（点を決めて、開いた物を history に積む） */
function settle(room) {
  const w = room.onaji;
  const t = w.topics[w.round];
  const ids = w.playerIds.filter((id) => isPresent(room, id));
  const s = L.scoreRound(w.mode, t.choices.length, w.answers, ids);
  const answers = {};
  ids.forEach((id) => { if (typeof w.answers[id] === 'number') answers[id] = w.answers[id]; });
  w.history.push(Object.assign({ q: t.q, choices: t.choices.slice(), answers, ids }, s));
  w.phase = PHASE.OPEN;
  room.state.phase = PHASE.OPEN;
  w.deadline = now() + R.OPEN_SEC * 1000;
}

function finish(room) {
  const w = room.onaji;
  w.phase = PHASE.ENDED;
  room.state.phase = PHASE.ENDED;
  w.deadline = null;
}

/** 選ぶのを待っている人（まだ選んでいない・部屋にいる） */
function undecidedIds(room) {
  const w = room.onaji;
  if (!w || w.phase !== PHASE.CHOOSE) return [];
  return w.playerIds.filter((id) => isPresent(room, id) && typeof w.answers[id] !== 'number');
}
function expectedMembers(room) { return undecidedIds(room); }

/**
 * 選ぶ段階で、つながっている人が全員選んだら先へ。だれもつながっていない時は進めない（戻ってくるのを待つ・締め切りはある）
 */
function isAllDone(room) {
  const w = room.onaji;
  if (!w || w.phase !== PHASE.CHOOSE) return false;
  const live = w.playerIds.filter((id) => isLive(room, id));
  if (!live.length) return false;
  return live.every((id) => typeof w.answers[id] === 'number');
}

/** 締め切り・全員そろった・ホストの「すすめる」・人が居なくなった時、全部ここ */
function advance(room) {
  const w = room.onaji;
  if (!w || w.phase === PHASE.ENDED || w.phase === PHASE.LOBBY) return false;
  if (w.phase === PHASE.CHOOSE) { settle(room); return true; }
  // open → 次の問題か終わり
  if (w.round + 1 >= w.topics.length) { finish(room); return true; }
  w.round++;
  beginRound(room);
  return true;
}

/** 累計の点（開いた問題だけから数える） */
function scoresOf(w) {
  const sc = {};
  w.playerIds.forEach((id) => { sc[id] = 0; });
  w.history.forEach((h) => { Object.keys(h.points || {}).forEach((id) => { sc[id] = (sc[id] || 0) + h.points[id]; }); });
  return sc;
}

/** 開いた問題を、公開してよい形に（名前で）。だれが何を選んだかは開いたあとだけ */
function openedView(w, h) {
  const byChoice = h.choices.map(() => []);
  Object.keys(h.answers).forEach((id) => { byChoice[h.answers[id]].push(w.names[id]); });
  return {
    q: h.q, choices: h.choices.slice(), counts: h.counts.slice(), winners: h.winners.slice(),
    names: byChoice,                                   // 答えごとの名前（開いたあとだけ）
    crowned: h.winners.reduce((a, k) => a.concat(byChoice[k]), []),
    scatter: h.scatter, together: h.together, ratio: Math.round(h.ratio * 100)
  };
}

/**
 * 部屋の全員（TV を含む）に配る。**白名簿で組み立てる**（w を丸ごと写さない）。
 * choose の間：お題・選び終わった人の名前・のこり時間・累計の点。答えも人数も入れない
 */
function publicView(room) {
  const w = room.onaji;
  if (!w) return { phase: PHASE.LOBBY };
  const t = w.topics[w.round] || null;
  const sc = scoresOf(w);
  const view = {
    phase: w.phase,
    mode: w.mode,
    draft: w.draft,
    round: w.round + 1,
    total: w.topics.length,
    topic: t ? { q: t.q, choices: t.choices.slice() } : null,
    players: w.playerIds.filter((id) => isPresent(room, id)).map((id) => ({ id, name: w.names[id], score: sc[id] || 0 })),
    chosen: w.phase === PHASE.CHOOSE ? w.playerIds.filter((id) => typeof w.answers[id] === 'number').map((id) => w.names[id]) : [],
    remainingMs: w.deadline ? Math.max(0, w.deadline - now()) : null,
    reveal: null,
    result: null
  };
  if (w.phase === PHASE.OPEN || w.phase === PHASE.ENDED) {
    const last = w.history[w.history.length - 1];
    if (last) view.reveal = openedView(w, last);
  }
  if (w.phase === PHASE.ENDED) view.result = resultView(room);
  return view;
}

/** 本人だけ：自分が選んだ番号と自分の点 */
function privateFor(room, memberId) {
  const w = room.onaji;
  if (!w || w.playerIds.indexOf(memberId) === -1) return null;
  return {
    phase: w.phase,
    round: w.round + 1,
    myChoice: typeof w.answers[memberId] === 'number' && w.phase === PHASE.CHOOSE ? w.answers[memberId]
      : (w.history.length && w.phase !== PHASE.CHOOSE ? (w.history[w.history.length - 1].answers[memberId] ?? null) : null),
    myScore: scoresOf(w)[memberId] || 0
  };
}

/** { pick: 2 } … 選ぶ（選ぶ段階・プレイヤーだけ・1回だけ） */
function submitAction(room, memberId, targetId, payload) {
  const w = room.onaji;
  if (!w || w.phase === PHASE.ENDED || w.phase === PHASE.LOBBY) return { ok: false, error: 'not_playing' };
  if (w.playerIds.indexOf(memberId) === -1) return { ok: false, error: 'not_player' };
  if (w.phase !== PHASE.CHOOSE) return { ok: false, error: 'not_choose' };
  if (typeof w.answers[memberId] === 'number') return { ok: false, error: 'already_chosen' };
  const raw = payload && payload.pick !== undefined ? payload.pick : targetId;
  // 端末が出す番号を信じない：整数そのもの（か整数だけの文字列）で、選択肢の中だけ
  const k = (typeof raw === 'number') ? raw : (/^[0-9]+$/.test(String(raw)) ? Number(raw) : NaN);
  const t = w.topics[w.round];
  if (!Number.isInteger(k) || k < 0 || k >= t.choices.length) return { ok: false, error: 'unknown_choice' };
  w.answers[memberId] = k;
  return { ok: true, allDone: isAllDone(room) };
}
function submitVote(room, memberId, targetId, payload) { return submitAction(room, memberId, targetId, payload); }

/** 結果（記録と画面）。多い方・少ない方は順位、一致団結はそろい度だけ（順位を出さない） */
function resultView(room) {
  const w = room.onaji;
  if (!w) return null;
  const ids = w.playerIds.filter((id) => isPresent(room, id));
  const r = L.finalResult(w.mode, w.history, ids);
  const nm = (id) => w.names[id];
  return {
    mode: w.mode,
    questions: w.history.length,
    awards: { same: r.awards.same.map(nm), solo: r.awards.solo.map(nm) },
    // 称号を数える端末は名前でなく id で照らす（ふだんの部屋では同じ名前が2人いることがある）
    awardIds: { same: r.awards.same.slice(), solo: r.awards.solo.slice() },
    together: r.together,
    sync: r.sync == null ? null : r.sync,
    ranking: r.ranking ? r.ranking.map((x) => ({ id: x.id, name: nm(x.id), score: x.score, rank: x.rank })) : null,
    history: w.history.map((h) => ({ q: h.q, choices: h.choices.slice(), counts: h.counts.slice(), winners: h.winners.slice() }))
  };
}

/** 卓のみんなが待っている締め切り（選ぶ時間）。開いている間は時計を出さない（既定は消さない・落とし穴20） */
function clockKind(room) {
  const ph = room && room.onaji && room.onaji.phase;
  return (ph === PHASE.OPEN || ph === PHASE.ENDED) ? 'tick' : 'play';
}

module.exports = {
  PHASE, startGame, publicView, privateFor, submitAction, submitVote, isAllDone, advance,
  playersOf, expectedMembers, undecidedIds, resultView, clockKind
};
