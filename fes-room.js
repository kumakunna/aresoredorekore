// fes-room.js — 文化祭の部屋（指示66-2）。**人がいなくても回る、サーバーの進行役。**
//
// ふつうの部屋は、ゲームを選ぶ・始める・次へ進めるを進行役の端末が押す。
// 文化祭（11/14・知らない人も含めて60人以上・TV 1台を無人で回す）では押す人がいないので、
// 待合 → 投票 → 決定 → ルールと準備OK → 3-2-1 → 遊ぶ → 結果 → 待合 を、
// realtime.js の見回り（0.5秒ごと）からここが進める。
//
// ここが持つのは「流れ」だけ。ゲームそのものは今までの進行役（*-room.js）が動かし、
// 始める処理も realtime.js の startGameNow を通す（3-2-1 のずらしを2か所に書かない・落とし穴1）。
// 人を外す処理も realtime.js の removeMember を通す（いなくなる経路を1か所に・落とし穴17）。
//
// 決めごと（docs/指示66/66-2_文化祭の流れ.md・00 の「見本どおりにしない所」・くまくんの決め 2026-10-24）
//   ・部屋は16人まで
//   ・候補は見本の3つ（クイズ解除の協力版・進化じゃんけん・ロシアンカード）。いまの人数で始められるものだけ
//   ・投票は外れない（投票した後に別のゲームを押しても変わらない）。投票中は票の数をだれにも出さない
//   ・えらばない人は「おまかせ」。0票ならくじ、同点は同点どうしのくじ
//   ・準備OK は、しめきりまでに押した人だけで始める。足りなければ待合へもどる
//   ・押すべき所で2回つづけて何も押さなかった人は、席を空ける（準備OK と「つづける？」）
//   ・結果のあと15秒で待合へ。押さなければ「つづける」

'use strict';

/**
 * 文化祭で投票に出すゲーム。人数の幅は public/index.html の MODES・GAMES と、
 * 始める設定は端末の既定（state.bombCounts など）と同じ（tests/fes.js が照らす・写しが腐らないように）。
 * 進化じゃんけんとロシアンカードは、何も送らなければ進行役が既定で始める
 */
const FES_GAMES = [
  { mode: 'bomb-coop', game: 'bomb', min: 2, max: 8,
    start: { game: 'bomb', mode: 'coop', counts: { easy: 12, normal: 10, hard: 8, nanisore: 0, muri: 0 }, lives: 3, timerSec: 180, showMisses: false } },
  { mode: 'shinka', game: 'shinka', min: 3, max: 12, start: { game: 'shinka' } },
  { mode: 'rcard', game: 'rcard', min: 2, max: 8, start: { game: 'rcard' } }
];

const ROOM_MAX = 16;
const MISS_LIMIT = 2;
const DIFFS = ['easy', 'normal', 'hard'];

/**
 * 長さ。**数字は遊びの長さで、検査の都合で縮めない**（落とし穴24）。
 * 検査は opts.times で縮めた部屋を作る（realtime.js の fesTimes）
 */
const TIMES = {
  lobbyMs: 30000,    // 2人そろってから投票まで（見本 F3「30秒」）
  idleMs: 60000,     // だれもいないまま、これだけたったら呼び込みの画面へ（F6）
  voteMs: 20000,     // 投票（F7「20秒」）
  decideMs: 4000,    // 決定の4段（F8：①0〜0.7秒 ②0.75〜1.35秒 ③1.3〜2秒 ④2.1秒〜）
  readyMs: 20000,    // ルールと準備OK。見本に長さが無いので投票と同じにした（門の記録に理由）
  resultMs: 15000,   // 結果と「つづける？」（F12「15秒」）
  // ゲームが終わってから結果の画面へ移るまで。爆発・解除の瞬間そのもの（溜め・音・TVいっぱいの💥）は
  // ゲームの画面が見せるので、それを切らない（F12「爆発の瞬間そのものは「クイズ解除」のページ」）
  endGraceMs: 4500
};

const PHASE = { IDLE: 'idle', LOBBY: 'lobby', VOTE: 'vote', DECIDE: 'decide', READY: 'ready', PLAY: 'play', RESULT: 'result' };

function gameOf(mode) { return FES_GAMES.find((g) => g.mode === mode) || null; }

/** 文化祭の部屋にする（作り直しの時も、まっさらから） */
function init(room, opts) {
  const o = opts || {};
  room.fes = {
    phase: PHASE.LOBBY,
    createdAt: Date.now(),  // 作り直した時に「いまの部屋」を見分けるため（/fes）
    endsAt: null,          // いまの段階の締め切り（無ければ時計を出さない）
    emptySince: null,      // だれもいなくなった時刻（呼び込みの画面へ行くため）
    round: 1,              // 何回目のゲームか（感想を「1ゲームに1回」聞く鍵にも使う）
    candidates: [],        // 投票の候補（mode）
    votes: new Map(),      // memberId -> mode。**外に出さない**（票の数を出さない）
    pick: null,            // 決まったもの { mode, counts, lot }。決まった時だけ出す
    played: null,          // 遊んだもの { mode, round, ids }（結果と感想のため）
    cont: new Set(),       // 結果で「つづける」を押した人
    hidden: new Set(),     // 係が隠した人（名前を ●●● に・TVの壁から消す）
    inset: 0,              // TVの端あわせ（ふちから内側へ何%縮めるか）
    note: null,            // 待合に出す一言のもと（'too_few' など）
    queue: [],             // 指示66-3：満員の時の予約（つぎの回に入る）。{ socketId, token, at, offerUntil }。入った順
    times: Object.assign({}, TIMES, o.times || {}),
    rnd: o.rnd || Math.random
  };
  return room.fes;
}

// ===================== 指示66-3：満員の時の予約（つぎの回に入る） =====================
// 部屋が16人でいっぱいの時、入れなかった人はスマホで予約する。席が1つ空くと、予約の先頭の人に
// 「どうぞ」を送り、その人のために席を OFFER_MS のあいだ取っておく（そのあいだに後から来た人が割り込めない）。
// 入らずに時間が切れたら、その予約は消えて次の人へ。予約した端末が切れたら、その予約も消える
const OFFER_MS = 20000;
function queueOf(room) { if (!room.fes.queue) room.fes.queue = []; return room.fes.queue; }
/** 予約する。もう予約していれば、そのまま。返すのは何番目か（1から） */
function reserve(room, socketId, now) {
  const q = queueOf(room);
  let e = q.filter((x) => x.socketId === socketId)[0];
  if (!e) { e = { socketId, token: Math.floor((room.fes.rnd || Math.random)() * 1e9).toString(36) + now.toString(36), at: now, offerUntil: 0 }; q.push(e); }
  return q.indexOf(e) + 1;
}
/** 予約をやめる（入れた・やめた・切れた）。token か socketId のどちらかで */
function unreserve(room, key) {
  const q = queueOf(room);
  room.fes.queue = q.filter((x) => x.socketId !== key && x.token !== key);
  return room.fes.queue.length !== q.length;
}
/** 席を取っておいている予約の数。token を渡すと、その人のぶんは数えない（本人は入れる） */
function held(room, token, now) {
  return queueOf(room).filter((x) => x.offerUntil > now && x.token !== token).length;
}
/**
 * 0.5秒ごと。時間が切れた「どうぞ」を消し、空いた席のぶんだけ先頭から「どうぞ」を出す。
 * live：いまつながっている遊ぶ人の数。返すのは、いま新しく「どうぞ」を出した予約
 */
function queueTick(room, live, now) {
  let q = queueOf(room);
  room.fes.queue = q = q.filter((x) => !(x.offerUntil && x.offerUntil <= now));
  let free = ROOM_MAX - live - q.filter((x) => x.offerUntil > now).length;
  const offered = [];
  q.forEach((x) => { if (free > 0 && !x.offerUntil) { x.offerUntil = now + OFFER_MS; offered.push(x); free--; } });
  return offered;
}

/** 遊ぶ人（大画面の端末をのぞく）。待っている人（今回は入らなかった人）も入る */
function people(room) {
  return Array.from(room.members.values()).filter((m) => m.role === 'player' || m.role === 'waiting');
}
function livePeople(room) { return people(room).filter((m) => m.connected); }

function set(room, phase, ms, now) {
  const f = room.fes;
  f.phase = phase;
  f.endsAt = ms != null ? now + ms : null;
}

/**
 * 見回りから呼ぶ（0.5秒ごと）。変わったら true を返す（realtime.js が配る）。
 * api：startGameNow / clearGameState / driverStateOf / removeMember / tell
 */
function tick(room, now, api) {
  const f = room.fes;
  if (!f) return false;
  // 係が一時停止している間は、どの段階も進めない
  if (f.pausedLeft) return false;
  const t = f.times;
  const n = livePeople(room).length;
  switch (f.phase) {
    case PHASE.IDLE:
      if (n > 0) { set(room, PHASE.LOBBY, null, now); f.emptySince = null; return true; }
      return false;
    case PHASE.LOBBY: {
      if (n === 0) {
        if (!f.emptySince) f.emptySince = now;
        if (now - f.emptySince >= t.idleMs) { set(room, PHASE.IDLE, null, now); return true; }
      } else f.emptySince = null;
      // 2人そろったら30秒の時計が動き出す。1人になったら止める（F6「あと1人で はじまるよ」）
      if (n >= 2 && !f.endsAt) { f.endsAt = now + t.lobbyMs; return true; }
      if (n < 2 && f.endsAt) { f.endsAt = null; return true; }
      if (f.endsAt && now >= f.endsAt) return startVote(room, now);
      return false;
    }
    case PHASE.VOTE:
      if (now >= f.endsAt) return decide(room, now);
      return false;
    case PHASE.DECIDE:
      if (now >= f.endsAt) return openReady(room, now);
      return false;
    case PHASE.READY:
      if (now >= f.endsAt) return closeReady(room, now, api);
      return false;
    case PHASE.PLAY: {
      // ゲームが終わったら結果へ。進行役が消えていても（全員いなくなった等）結果へ
      const w = api.driverStateOf(room);
      const ended = !w || w.phase === 'ended';
      if (ended && !f.endedAt) f.endedAt = now;
      if (ended && (!w || now - f.endedAt >= t.endGraceMs)) {
        f.endedAt = null;
        set(room, PHASE.RESULT, t.resultMs, now); f.cont = new Set(); return true;
      }
      return false;
    }
    case PHASE.RESULT:
      if (now >= f.endsAt) return backToLobby(room, now, api);
      return false;
  }
  return false;
}

/** いまの人数で始められる候補。**人数の多すぎる回は、いちばん多く入れるものだけ**（下の説明） */
function candidatesFor(n) {
  const fit = FES_GAMES.filter((g) => n >= g.min && n <= g.max);
  if (fit.length) return fit.map((g) => g.mode);
  // 13〜16人は3つとも入りきらない。待合で止めると、いちばん人が集まった時に何も遊べない。
  // その回は「いちばん多く入れるゲーム」だけを出し、準備OK を押した順に上限まで入る
  // （あとの人は「つぎの回から」）。くまくんに確かめる（報告の質問）
  const big = Math.max.apply(null, FES_GAMES.map((g) => g.max));
  return n > big ? FES_GAMES.filter((g) => g.max === big).map((g) => g.mode) : [];
}

function startVote(room, now) {
  const f = room.fes;
  const c = candidatesFor(livePeople(room).length);
  if (!c.length) { f.endsAt = now + f.times.lobbyMs; return true; }
  f.candidates = c;
  f.votes = new Map();
  f.pick = null;
  f.note = null;
  set(room, PHASE.VOTE, f.times.voteMs, now);
  return true;
}

/** 投票。**一度入れたら変わらない**（押し間違いで外れるのを防ぐ・00 の1） */
function vote(room, memberId, mode) {
  const f = room.fes;
  if (!f || f.phase !== PHASE.VOTE) return { ok: false, error: 'not_voting', message: 'いまは投票の時間ではありません' };
  if (f.candidates.indexOf(mode) === -1) return { ok: false, error: 'not_candidate', message: 'そのゲームは候補にありません' };
  const m = room.members.get(memberId);
  if (!m || m.role !== 'player') return { ok: false, error: 'not_player', message: '投票できません' };
  if (f.votes.has(memberId)) return { ok: true, vote: f.votes.get(memberId), already: true };
  f.votes.set(memberId, mode);
  m.fesMiss = 0;
  return { ok: true, vote: mode };
}

function decide(room, now) {
  const f = room.fes;
  const counts = {};
  f.candidates.forEach((c) => { counts[c] = 0; });
  f.votes.forEach((mode) => { if (counts[mode] != null) counts[mode]++; });
  const top = Math.max.apply(null, f.candidates.map((c) => counts[c]));
  const tied = f.candidates.filter((c) => counts[c] === top);
  const lot = top === 0 ? 'zero' : (tied.length > 1 ? 'tie' : 'none');
  const mode = tied[Math.floor(f.rnd() * tied.length) % tied.length];
  f.pick = { mode, counts, lot, tied: lot === 'none' ? [] : tied };
  set(room, PHASE.DECIDE, f.times.decideMs, now);
  return true;
}

function openReady(room, now) {
  const f = room.fes;
  const g = gameOf(f.pick.mode);
  // 準備OK は「いまのゲーム」に対して押すもの（realtime.js の room:ready がそう確かめる）
  room.state.game = g.game;
  room.state.data = Object.assign({}, room.state.data, { modeId: g.mode });
  room.members.forEach((m) => { m.readyGame = null; m.readyAt = null; });
  set(room, PHASE.READY, f.times.readyMs, now);
  return true;
}

/** 押すべき所で何も押さなかった。2回つづいたら席を空ける */
function missed(room, m, api) {
  m.fesMiss = (m.fesMiss || 0) + 1;
  if (m.fesMiss >= MISS_LIMIT) { api.removeMember(room, m.id, 'fes_idle'); return true; }
  return false;
}

function closeReady(room, now, api) {
  const f = room.fes;
  const g = gameOf(f.pick.mode);
  const live = livePeople(room);
  let pressed = live.filter((m) => m.readyGame === g.game)
    .sort((a, b) => (a.readyAt || 0) - (b.readyAt || 0));
  live.filter((m) => m.readyGame !== g.game).forEach((m) => missed(room, m, api));
  pressed.forEach((m) => { m.fesMiss = 0; });
  if (pressed.length < g.min) {
    f.note = 'too_few';
    room.state.game = null;
    room.members.forEach((m) => { m.readyGame = null; });
    set(room, PHASE.LOBBY, null, now);
    return true;
  }
  // 上限より多く押した時は、押した順に上限まで（あとの人は「つぎの回から」）
  pressed = pressed.slice(0, g.max);
  const ids = new Set(pressed.map((m) => m.id));
  // 今回入らない人には、なぜかを本人にだけ渡す（くまくんの答え 2026-10-24：「つぎの回に入れます」と分かるように）。
  //   full＝押したが上限で入れなかった／missed＝しめきりまでに押さなかった（途中で入った人は realtime.js が late）
  people(room).forEach((m) => {
    m.role = ids.has(m.id) ? 'player' : 'waiting';
    m.fesBench = ids.has(m.id) ? null : (m.readyGame === g.game ? 'full' : 'missed');
  });
  const diffs = {};
  pressed.forEach((m) => { diffs[m.id] = m.fesDiff || 'normal'; });
  const res = api.startGameNow(room, Object.assign({}, g.start, { fesDiffs: diffs }));
  if (!res.ok) {
    people(room).forEach((m) => { m.role = 'player'; });
    f.note = 'start_failed';
    room.state.game = null;
    set(room, PHASE.LOBBY, null, now);
    return true;
  }
  f.played = { mode: g.mode, round: f.round, ids: Array.from(ids) };
  set(room, PHASE.PLAY, null, now);
  return true;
}

/**
 * 係：一時停止。いまの段階の締め切りを止める（ゲームの最中はゲームの側のポーズも realtime.js が止める）。
 * もう一度押すと、止めた時ののこり時間から動き出す
 */
function pause(room, on, now) {
  const f = room.fes;
  if (on && !f.pausedLeft) { f.pausedLeft = f.endsAt ? Math.max(1, f.endsAt - now) : -1; f.endsAt = null; return true; }
  if (!on && f.pausedLeft) { f.endsAt = f.pausedLeft > 0 ? now + f.pausedLeft : null; f.pausedLeft = null; return true; }
  return false;
}
/** 係：この回をとばす。ゲームの最中ならそのゲームを片付けて、待合へもどす（だれの「押し忘れ」にも数えない） */
function skip(room, now, api) {
  const f = room.fes;
  f.pausedLeft = null; f.endedAt = null;
  api.clearGameState(room);
  room.state.game = null;
  people(room).forEach((m) => { m.role = 'player'; m.readyGame = null; });
  if (f.phase === PHASE.PLAY || f.phase === PHASE.RESULT) f.round++;
  f.pick = null; f.candidates = []; f.votes = new Map(); f.note = 'skipped';
  set(room, PHASE.LOBBY, null, now);
  return true;
}

/** 結果で「つづける」 */
function keepGoing(room, memberId) {
  const f = room.fes;
  if (!f || f.phase !== PHASE.RESULT) return { ok: false, error: 'not_result', message: 'いまは結果の時間ではありません' };
  const m = room.members.get(memberId);
  if (!m) return { ok: false, error: 'not_in_room' };
  f.cont.add(memberId);
  m.fesMiss = 0;
  return { ok: true };
}

function backToLobby(room, now, api) {
  const f = room.fes;
  // 遊んだ人のうち、結果で何も押さなかった人は1つ数える（押さなければ「つづける」なので、ここでは外さない人がほとんど）
  const ids = new Set((f.played && f.played.ids) || []);
  livePeople(room).forEach((m) => { if (ids.has(m.id) && !f.cont.has(m.id)) missed(room, m, api); });
  api.clearGameState(room);
  room.state.game = null;
  people(room).forEach((m) => { m.role = 'player'; m.readyGame = null; m.fesBench = null; });
  f.round++;
  f.pick = null;
  f.candidates = [];
  f.votes = new Map();
  set(room, PHASE.LOBBY, null, now);
  return true;
}

/** だれでも見てよい形（票の数は、決まった後だけ） */
function publicView(room, now) {
  const f = room.fes;
  if (!f) return null;
  const show = f.phase === PHASE.DECIDE || f.phase === PHASE.READY || f.phase === PHASE.PLAY || f.phase === PHASE.RESULT;
  return {
    phase: f.phase,
    remainingMs: f.endsAt ? Math.max(0, f.endsAt - now) : null,
    round: f.round,
    candidates: f.candidates.slice(),
    // 文化祭で遊べるゲームの全部（TVの呼び込み）と、いまの人数での次の候補（待合）。端末に一覧を写さない（落とし穴1）
    games: FES_GAMES.map((g) => g.mode),
    next: candidatesFor(livePeople(room).length),
    pick: show && f.pick ? { mode: f.pick.mode, counts: Object.assign({}, f.pick.counts), lot: f.pick.lot, tied: f.pick.tied.slice() } : null,
    played: f.played ? { mode: f.played.mode, round: f.played.round, ids: f.played.ids.slice() } : null,
    full: livePeople(room).length >= ROOM_MAX,
    max: ROOM_MAX,
    hidden: Array.from(f.hidden),
    inset: f.inset,
    note: f.note,
    paused: !!f.pausedLeft
  };
}

/** 本人だけに渡す（自分の投票・むずかしさ・押し忘れの数） */
function privateFor(room, memberId) {
  const f = room.fes;
  const m = room.members.get(memberId);
  if (!f || !m) return null;
  return {
    vote: f.votes.get(memberId) || null,
    diff: m.fesDiff || null,
    miss: m.fesMiss || 0,
    cont: f.cont.has(memberId),
    bench: m.role === 'waiting' ? (m.fesBench || 'late') : null,
    playing: !!(f.played && f.played.ids.indexOf(memberId) !== -1 && (f.phase === PHASE.PLAY || f.phase === PHASE.RESULT))
  };
}

module.exports = { FES_GAMES, ROOM_MAX, MISS_LIMIT, DIFFS, TIMES, PHASE, OFFER_MS, init, tick, vote, keepGoing, pause, skip, publicView, privateFor, candidatesFor, gameOf,
  reserve, unreserve, held, queueTick };
