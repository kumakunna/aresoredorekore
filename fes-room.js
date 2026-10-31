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
// 指示68-1：on＝文化祭の候補に出す（門を通った物だけ）。いまはクイズ解除の協力版だけ。
// 進化じゃんけん・ロシアンカードは棚から下ろした（コードは残す・on:false）。2.0 の物は門を通ったら on にする。
// testing＝門を通る前の物（係の画面に「テスト中」の印）。
// 指示68-T 二の束1：候補に出すかは、係（くまくん）の画面のゲームごとの「入／切」で決める（「テスト中を入れる」を置きかえた）。
//   入／切はサーバーの入れ物（SQLite・fes-store.js の fes_game_switch）に覚えるので、部屋やサーバーを作り直しても戻らない。
//   まだ一度も押していないゲームは、on か def（はじめは入）なら入、それ以外は切。いつも2本以上は入（1本だけだと決定の演出が短くなる）
const FES_GAMES = [
  // 指示68-2 第4節：16人まで。本数・ライフ・制限時間は人数の表（BombLogic.sizeFor・sizeByPlayers）。下の counts などは8人までの値と同じ（端末の既定と照らす）
  { mode: 'bomb-coop', game: 'bomb', min: 2, max: 16, on: true,
    start: { game: 'bomb', mode: 'coop', counts: { easy: 12, normal: 10, hard: 8, nanisore: 0, muri: 0 }, lives: 3, timerSec: 180, showMisses: false, sizeByPlayers: true } },
  { mode: 'shinka', game: 'shinka', min: 3, max: 12, on: false, start: { game: 'shinka' } },
  { mode: 'rcard', game: 'rcard', min: 2, max: 8, on: false, start: { game: 'rcard' } },
  // 指示68-3：みんなと同じ（多い方）。テスト中の印のまま、はじめは入（10/30 のあそびテストで遊んだ3本・指示68-T 二の束1）
  { mode: 'onaji-many', game: 'onaji', min: 3, max: 16, on: false, testing: true, def: true, start: { game: 'onaji', mode: 'many' } },
  // 指示68-4：ボタン1つの2本（テスト中）
  { mode: 'pittari', game: 'pittari', min: 2, max: 16, on: false, testing: true, def: true, start: { game: 'pittari' } },
  { mode: 'soroe', game: 'soroe', min: 2, max: 16, on: false, testing: true, def: true, start: { game: 'soroe' } },
  // 指示68-5：クイズ王2.0（テスト中）。文化祭のクイズ王はこの2つだけ。はじめは切（11/6 のリハーサルで係が入にして試す・指示68-T 二の束2）
  { mode: 'qhaya', game: 'qhaya', min: 2, max: 16, on: false, testing: true, start: { game: 'qhaya' } },
  { mode: 'qnear', game: 'qnear', min: 2, max: 16, on: false, testing: true, start: { game: 'qnear' } }
];
/** 係が入／切できるゲーム（棚から下ろした物はのぞく） */
const switchable = (g) => !!(g.on || g.testing);
/** そのゲームがいま入か。f.enabled（入れ物から読んだ mode -> 真偽）に無ければ、はじめの値（on か def） */
function isOn(g, f) {
  const en = f && f.enabled;
  return en && Object.prototype.hasOwnProperty.call(en, g.mode) ? !!en[g.mode] : !!(g.on || g.def);
}
/** 候補にできるゲーム。opts.games（検査が表を差しかえる）と、係の入／切 */
function gamesFor(f) {
  const list = (f && f.games) || FES_GAMES;
  return list.filter((g) => switchable(g) && isOn(g, f));
}
/** 係の画面の入／切の並び（表の順） */
function switchesFor(f) {
  const list = (f && f.games) || FES_GAMES;
  return list.filter(switchable).map((g) => ({ mode: g.mode, on: isOn(g, f), testing: !!g.testing }));
}
const MIN_ON = 2;
/**
 * 係の入／切。切って入が MIN_ON 本より少なくなる時は変えない（{ ok:false, error:'min_on' }）。
 * 変えたら f.enabled を書きかえ、入れ物に残すのは呼んだ側（realtime.js）
 */
function setGame(f, mode, on) {
  const list = (f && f.games) || FES_GAMES;
  const g = list.find((x) => x.mode === mode && switchable(x));
  if (!g) return { ok: false, error: 'no_game', message: 'そのゲームはありません' };
  if (!on && isOn(g, f) && switchesFor(f).filter((x) => x.on).length <= MIN_ON) {
    return { ok: false, error: 'min_on', message: MIN_ON + '本より少なくはできません' };
  }
  f.enabled = Object.assign({}, f.enabled || {}, { [mode]: !!on });
  return { ok: true, mode, on: !!on };
}

const ROOM_MAX = 16;
const MISS_LIMIT = 2;
// むずかしさは2つ（くまくんの答え 2026-10-31）。古い画面から来た「むずかしい」や、もう部屋にいる人の hard は「ふつう」として読む
const DIFFS = ['easy', 'normal'];
function diffOf(d) { return d === 'hard' ? 'normal' : (DIFFS.indexOf(d) === -1 ? null : d); }

/**
 * 長さ。**数字は遊びの長さで、検査の都合で縮めない**（落とし穴24）。
 * 検査は opts.times で縮めた部屋を作る（realtime.js の fesTimes）
 */
const TIMES = {
  lobbyMs: 30000,    // 2人そろってから投票まで（見本 F3「30秒」）
  idleMs: 60000,     // だれもいないまま、これだけたったら呼び込みの画面へ（F6）
  voteMs: 20000,     // 投票（F7「20秒」）
  decideMs: 5000,    // 決定の4段（F8：①0〜0.7秒 ②0.75〜1.35秒 ③1.3〜2秒 ④2.1秒〜）。TV の台本は約3.5秒。少し遅れて受けた TV でも途中で消えないよう5秒（指示68-T 5）
  readyMs: 20000,    // ルールと準備OK。見本に長さが無いので投票と同じにした（門の記録に理由）
  readyAllMs: 3000,  // 全員が準備OK を押したら、のこりをこれだけにする（くまくん 2026-10-29：全員そろったら待たせない）
  resultMs: 15000,   // 結果と「つづける？」（F12「15秒」）
  // ゲームが終わってから結果の画面へ移るまで。爆発・解除の瞬間そのもの（溜め・音・TVいっぱいの💥）は
  // ゲームの画面が見せるので、それを切らない（F12「爆発の瞬間そのものは「クイズ解除」のページ」）
  // 68-S の残り2（くまくん 10/31）：幕が上がったらすぐ文化祭の結果。幕（TV・スマホとも 3.75秒で上がり始め 4.0秒で消える・fx.js finale）の下で結果へ移っておく。
  // 見回りは0.5秒ごとなので、結果が届くのは 3.5〜4.0秒（幕の下・不透明）。5秒の時は、幕が上がってから約1秒、今までのクイズ解除の画面が見えていた
  endGraceMs: 3500
};

const PHASE = { IDLE: 'idle', LOBBY: 'lobby', VOTE: 'vote', DECIDE: 'decide', READY: 'ready', PLAY: 'play', RESULT: 'result' };

function gameOf(mode, f) { return ((f && f.games) || FES_GAMES).find((g) => g.mode === mode) || FES_GAMES.find((g) => g.mode === mode) || null; }

/** 文化祭の部屋にする（作り直しの時も、まっさらから） */
function init(room, opts) {
  const o = opts || {};
  room.fes = {
    phase: PHASE.LOBBY,
    createdAt: Date.now(),  // 作り直した時に「いまの部屋」を見分けるため（/fes）
    lobbyAt: Date.now(),   // 指示68-T 二の束6：この回の待合が始まった時刻（回ごとの記録）
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
    shown: {},             // 指示68-1：mode -> 最後に候補に出した回（出ていない回が長い順に選ぶ）
    games: o.games || null,  // 検査だけが差しかえる（無ければ FES_GAMES）
    enabled: Object.assign({}, o.enabled || {}),   // 係の入／切（mode -> 真偽）。入れ物（fes-store）から読んだ物。無いゲームははじめの値
    bgm: false,            // 指示68-T 三の束2：待合の BGM（TV だけ）。**はじめは切**（くまくんが 11/5 に聞いてから入れる）。部屋を作り直すと切にもどる
    times: Object.assign({}, TIMES, o.times || {}),
    rnd: o.rnd || Math.random,
    onPhase: o.onPhase || null   // 指示68-T 二の束6：段階が変わった時に呼ぶ（回ごとの記録）
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
  const prev = f.phase;
  f.phase = phase;
  f.endsAt = ms != null ? now + ms : null;
  // 指示68-T 二の束6：回ごとの記録の時刻（待合 → 開始 → 結果 → 次の待合）。残すのは呼んだ側（realtime.js の onPhase → fes-store）
  if (phase === PHASE.LOBBY) f.lobbyAt = now;
  if (phase === PHASE.PLAY) f.startAt = now;
  if (phase === PHASE.RESULT) f.resultAt = now;
  if (prev !== phase && typeof f.onPhase === 'function') { try { f.onPhase(room, prev, phase, now); } catch (e) { /* 記録に失敗しても、流れは止めない */ } }
}

/**
 * 指示68-T 二の束6：回ごとの記録の中身（結果の時に、終わったゲームの状態から）。**名前も memberId も入れない**。
 * 11/6 のリハーサルで数を取って、しきい値とライフを見直すため：
 *   そろえて発射 … 回ごとの「そろい」（いちばん早い人と遅い人の差・ms）と押した人数・高さ
 *   ぴったり10秒 … 回ごとの目標と、全員の差（ms・近い順）
 *   みんなと同じ … お題と、いちばん多かった答えの人数・答えた人数
 *   クイズ王2   … 早答えは問題ごとの正答率（%）、数字ちかい方は答えた人数とぴったりの人数
 *   クイズ解除   … 終わり方と解いた本数（くわしい記録は bomb_plays にある）
 */
function roundDetail(room, mode) {
  const g = gameOf(mode, room.fes);
  const w = g && room[g.game];
  if (!w) return null;
  const H = w.history || [];
  switch (g.game) {
    case 'soroe': return { rounds: H.map((h) => ({ n: h.n, count: h.count, spread: h.spread == null ? null : h.spread, flew: !!h.flew, height: h.height || null })) };
    case 'pittari': return { rounds: H.map((h) => ({ target: h.target, show: h.show !== false, diffs: (h.rows || []).map((x) => x.diff) })) };
    case 'onaji': return { rounds: H.map((h) => {
      const counts = (h.choices || []).map((c, k) => Object.keys(h.answers || {}).filter((id) => h.answers[id] === k).length);
      return { q: h.q, top: counts.length ? Math.max.apply(null, counts) : 0, answered: Object.keys(h.answers || {}).length };
    }) };
    case 'qhaya': return { rounds: H.map((h) => {
      const rows = Object.keys(h.rows || {}).map((id) => h.rows[id]).filter((x) => x && x.pick != null);
      return { q: h.q, tier: h.tier || null, answered: rows.length, rate: rows.length ? Math.round(rows.filter((x) => x.right).length / rows.length * 100) : null };
    }) };
    case 'qnear': return { rounds: H.map((h) => {
      const rows = Object.keys(h.rows || {}).map((id) => h.rows[id]).filter((x) => x && x.value != null);
      return { q: h.q, answered: rows.length, perfect: (h.perfect || []).length };
    }) };
    case 'bomb': return { cause: (w.result && w.result.cause) || null, success: !!(w.result && w.result.success),
      solved: w.result ? w.result.solved : null, total: w.result ? w.result.total : null };
  }
  return null;
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
      return allReady(room, now);
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

/**
 * いまの人数で始められる候補（指示68-1）。
 * ・その人数で遊べる物。3つまでなら全部（1つなら投票を飛ばす・2つなら2択）
 * ・4つ以上なら3つ：前の回に遊んだ物をのぞき、候補に出ていない回が長い順。その日の最初の回は、クイズ解除を必ず入れる（遊べる人数の時）
 * ・その人数で遊べる物が無い時は、いちばん多く入れる物を出し、準備OK を押した順に入る（あとの人は「つぎの回から」）
 */
function candidatesFor(n, f) {
  const avail = gamesFor(f);
  if (!avail.length) return [];
  const fit = avail.filter((g) => n >= g.min && n <= g.max);
  if (!fit.length) {
    const big = Math.max.apply(null, avail.map((g) => g.max));
    return n > big ? avail.filter((g) => g.max === big).map((g) => g.mode) : [];
  }
  if (fit.length <= 3) return fit.map((g) => g.mode);
  const last = f && f.played ? f.played.mode : null;
  let pool = fit.filter((g) => g.mode !== last);
  if (pool.length < 3) pool = fit.slice();
  const shown = (f && f.shown) || {};
  pool.sort((a, b) => (shown[a.mode] || 0) - (shown[b.mode] || 0));   // 同じなら表の順（並べかえは安定）
  let pick = pool.slice(0, 3);
  const bomb = fit.find((g) => g.mode === 'bomb-coop');
  if (f && f.round === 1 && bomb && pick.indexOf(bomb) === -1) pick = [bomb].concat(pick.slice(0, 2));
  return pick.map((g) => g.mode);
}

function startVote(room, now) {
  const f = room.fes;
  const c = candidatesFor(livePeople(room).length, f);
  if (!c.length) { f.endsAt = now + f.times.lobbyMs; return true; }
  f.candidates = c;
  c.forEach((mode) => { if (!f.shown) f.shown = {}; f.shown[mode] = f.round; });
  f.votes = new Map();
  f.pick = null;
  f.note = null;
  // 指示68-1：候補が1つなら投票を飛ばして、そのゲームに決める（決定のカードは出す）
  if (c.length === 1) {
    f.pick = { mode: c[0], counts: { [c[0]]: 0 }, lot: 'single', tied: [] };
    set(room, PHASE.DECIDE, f.times.decideMs, now);
    return true;
  }
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
  const g = gameOf(f.pick.mode, f);
  // 準備OK は「いまのゲーム」に対して押すもの（realtime.js の room:ready がそう確かめる）
  room.state.game = g.game;
  room.state.data = Object.assign({}, room.state.data, { modeId: g.mode });
  room.members.forEach((m) => { m.readyGame = null; m.readyAt = null; });
  set(room, PHASE.READY, f.times.readyMs, now);
  return true;
}

/**
 * 全員（つながっている参加者）が準備OK を押したら、のこりを readyAllMs（3秒）に縮める。縮めるだけで延ばさない
 *（押したあとで取り消しても、のこりは もどさない）。変わったら true。realtime.js の room:ready も押した時にすぐ呼ぶ（見回りの0.5秒を待たない）
 */
function allReady(room, now) {
  const f = room.fes;
  if (!f || f.phase !== PHASE.READY || f.pausedLeft || !f.endsAt) return false;
  const live = livePeople(room);
  const g = room.state.game;
  if (!live.length || !live.every((m) => m.readyGame === g)) return false;
  const end = now + f.times.readyAllMs;
  if (end >= f.endsAt) return false;
  f.endsAt = end;
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
  const g = gameOf(f.pick.mode, f);
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
  pressed.forEach((m) => { diffs[m.id] = diffOf(m.fesDiff) || 'normal'; });
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
    games: gamesFor(f).map((g) => g.mode),
    next: candidatesFor(livePeople(room).length, f),
    pick: show && f.pick ? { mode: f.pick.mode, counts: Object.assign({}, f.pick.counts), lot: f.pick.lot, tied: f.pick.tied.slice() } : null,
    played: f.played ? { mode: f.played.mode, round: f.played.round, ids: f.played.ids.slice() } : null,
    full: livePeople(room).length >= ROOM_MAX,
    max: ROOM_MAX,
    bgm: !!f.bgm,   // 指示68-T 三の束2：TV が待合で BGM を鳴らすか
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
    diff: diffOf(m.fesDiff),
    miss: m.fesMiss || 0,
    cont: f.cont.has(memberId),
    bench: m.role === 'waiting' ? (m.fesBench || 'late') : null,
    playing: !!(f.played && f.played.ids.indexOf(memberId) !== -1 && (f.phase === PHASE.PLAY || f.phase === PHASE.RESULT))
  };
}

module.exports = { FES_GAMES, gamesFor, switchesFor, setGame, MIN_ON, roundDetail, ROOM_MAX, MISS_LIMIT, DIFFS, diffOf, TIMES, PHASE, OFFER_MS, init, tick, allReady, vote, keepGoing, pause, skip, publicView, privateFor, candidatesFor, gameOf,
  reserve, unreserve, held, queueTick };
