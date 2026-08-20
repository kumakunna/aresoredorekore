// sugoroku-room.js — カセット「すごろく」1人1台の進行（第36弾）
//
// 設計の芯は wolf-room.js / quiz-room.js とまったく同じ:
//   状態はサーバーが持ち、ロジックもサーバーで計算する。
//   端末は「今の状態を表示し、操作をサーバーに伝える」だけ。
//   このファイルは socket.io を知らない。通知は呼び出し側（realtime.js）が行う。
//
// **5ゲームを1本で持つ理由**
//   すごろくは5ゲーム × 遊び方（手渡し／1人1台）で、実装の文脈が8つに分かれる。
//   進行役を5本に分けると「盤・手番・順位・決着」という同じ処理が5回書かれ、
//   片方だけ直して事故る（落とし穴1）。だから:
//     ・共通の芯（手番の回し方・決着・人が抜けた時の扱い）はこのファイルに1つだけ置く
//     ・ゲームごとの違いは GAME_RULES[gameId] に閉じ込め、共通の芯からは呼ぶだけにする
//   クイズ王が4ゲームを quiz-room.js 1本で持っているのと同じ形。
//
// **手番が止まらないための決めごと（落とし穴17）**
//   誰かがいなくなる経路は複数ある（切断・退室・kick・タイムアウト・部屋解散）。
//   すごろくは「1人ずつ順番に動く」ので、手番の人が消えると全員が待ち続ける。
//   そうならないよう、いなくなり方で扱いを分ける（どれも advance の1本を通す）:
//     ・**切断**（名簿には残る）… expectedMembers が空になり、realtime.js の
//       settleAfterMemberGone が advance を呼ぶ。そこで**サーバーがその人のぶんを振る**。
//       席を残したまま駒だけ進むので、戻ってきた人が置いていかれない。
//     ・**退室・kick**（名簿から消える）… 居ない人の駒は動かさず、手番だけ飛ばす。
//     ・**時間切れ**… 手番には必ず期限（turnSec）を置き、切れたらサーバーが振って進める。
//       止まらないことを優先する（人狼の投票タイムアウトと同じ発想）。
//     ・手番を渡す相手は、毎回「部屋にいて、まだあがっていない人」から選び直す。
//       名簿から消えた人・あがった人の席で止まらない。

const path = require('path');
const S = require(path.join(__dirname, 'public', 'js', 'sugoroku-logic.js'));
const Mini = require(path.join(__dirname, 'public', 'js', 'sugoroku-mini.js'));
const QuizBank = require(path.join(__dirname, 'public', 'js', 'quiz-bank.js'));
const Hide = require(path.join(__dirname, 'public', 'js', 'sugoroku-hide.js'));
const Hand = require(path.join(__dirname, 'public', 'js', 'sugoroku-hand.js'));

// 進行の段階。ほかのゲームの PHASE とは別物
const PHASE = {
  LOBBY: 'lobby',
  READY: 'ready',     // 盤と自分の持ちものを確認する（全員が1回押す）
  TURN: 'turn',       // 手番の人の操作を待つ
  // ---- ここから「こまはひとつ」用（駒が1つしかないので、手番が並び順で回らない） ----
  MINI: 'mini',       // 何のミニゲームかを、画面いっぱいに出す
  PLAY: 'play',       // ミニゲーム本体。全員が同時に出す
  GRAB: 'grab',       // ミニゲームの順位の順に、駒を動かす
  // ---- ここから「ふたりでひとつ」用（駒が「人」ではなく「組」に付く） ----
  ROLL: 'roll',       // 組ごとにサイコロを振る（誰が振ってもよい）
  SPLIT: 'split',     // 出た目を、組の中で分け合う（合計が出目と一致で確定）
  // ---- ここから「てふだ」用（手札は本人だけが知っている） ----
  OFFER: 'offer',     // 手番の人以外が、売り札を1枚ずつ出す（任意）
  BUY: 'buy',         // 手番の人が、出ている売り札から1つ買う（任意）
  // ---- ここから「どこにいる？」用（実位置は本人だけが知っている） ----
  SAY: 'say',         // 求められた1人が、位置と手がかりを申告する
  JUDGE: 'judge',     // 申告が筋が通っているかを、全員で見る
  // ----
  RESULT: 'result',   // その手番に何が起きたかを、全員で見る
  EVENT: 'event',     // 突然イベント
  ENDED: 'ended'
};

const DEFAULT_TURN_SEC = 90;   // 手番の期限。考える時間としては充分に長く取る
const MIN_TURN_SEC = 15;
const MAX_TURN_SEC = 300;
const RESULT_MS = 2800;        // 駒が動くのを見る間（端末側はタップで飛ばせる）
const EVENT_MS = 3200;
const EVENT_CHANCE = S.EVENT_CHANCE;   // 手渡し版と同じ数字を使う（2度書かない）

// テストから出目と盤を固定するための穴。本番は Math.random のまま使う
let rnd = Math.random;
function useRandom(fn) { rnd = fn || Math.random; }
// 乱数は部屋ごとに持てるようにする（quiz-room.js と同じ作法）。
// モジュール共有のままだと、1つの部屋の都合が同時進行の別の部屋にも効いてしまう
function rndOf(w) { return (w && w.rnd) || rnd; }

function playersOf(room) {
  return Array.from(room.members.values()).filter((m) => m.role === 'player');
}

// ---- 開始 ----
function startGame(room, config) {
  const cfg = config || {};
  const gameId = cfg.game;
  const spec = S.gameById(gameId);
  const rules = GAME_RULES[gameId];
  if (!spec || !rules || !spec.ready) {
    return { ok: false, error: 'not_ready', message: 'このすごろくはまだ遊べません' };
  }
  const members = playersOf(room);
  const check = S.checkPlayerCount(gameId, members.length);
  if (!check.ok) return { ok: false, error: check.error, message: check.message };

  const ids = members.map((m) => m.id);
  const w = {
    game: gameId,
    playerIds: ids,
    names: {},
    board: S.makeBoard(gameId, cfg.rnd || rnd),
    rnd: cfg.rnd || null,
    pos: {},
    coins: {},
    goalOrder: {},        // memberId -> あがった順（1始まり）。未到達は undefined
    goalCount: 0,
    turnId: ids[0],
    lap: 1,               // 何巡目か
    turnSec: clampSec(cfg.turnSec),
    phase: PHASE.READY,
    done: {},
    intent: null,      // 受付中の「やりたいこと」。段階が変わるたびに捨てる
    deadline: null,
    last: null,           // 直前の手番に何が起きたか（演出用）
    event: null,          // いま効いている突然イベント
    lastEventId: null,
    eventsOn: cfg.events !== false,
    recorded: false,
    preset: cfg.preset || null
  };
  members.forEach((m) => {
    w.names[m.id] = m.name;
    w.pos[m.id] = 0;
    w.coins[m.id] = spec.coins ? spec.startCoins : 0;
  });
  if (rules.init) rules.init(w, cfg);

  room.sugoroku = w;
  room.state.game = gameId;
  room.state.phase = PHASE.READY;
  return { ok: true };
}
function clampSec(v) {
  const n = parseInt(v, 10);
  if (!n || isNaN(n)) return DEFAULT_TURN_SEC;
  return Math.max(MIN_TURN_SEC, Math.min(MAX_TURN_SEC, n));
}

// ---- 公開してよい情報だけ ----
// ここに秘密を混ぜると、大画面を含む全員に配られる。
// 「どこにいる？」は実際の位置が秘密なので、必ず rules.publicPlayers を通す。
function publicView(room) {
  const w = room.sugoroku;
  if (!w) return { phase: PHASE.LOBBY };
  const spec = S.gameById(w.game) || {};
  const rules = GAME_RULES[w.game] || {};
  const view = {
    game: w.game,
    phase: w.phase,
    cells: spec.cells,
    board: w.board,
    coinsUsed: !!spec.coins,
    lap: w.lap,
    turn: w.turnId ? { id: w.turnId, name: w.names[w.turnId] } : null,
    players: (rules.publicPlayers || defaultPublicPlayers)(room),
    waiting: waitingNames(room),
    last: w.last,
    event: w.event,
    deadline: w.deadline || null
  };
  if (rules.publicExtra) Object.assign(view, rules.publicExtra(room));
  if (w.phase === PHASE.ENDED) view.result = resultView(room);
  return view;
}
function defaultPublicPlayers(room) {
  const w = room.sugoroku;
  const spec = S.gameById(w.game) || {};
  const ranks = S.positionRanks(w.playerIds.map((id) => ({ id, pos: w.pos[id] })));
  return w.playerIds.map((id) => {
    const m = room.members.get(id);
    return {
      id,
      name: w.names[id],
      pos: w.pos[id],
      coins: spec.coins ? w.coins[id] : null,
      rank: ranks[id] || null,
      goalOrder: w.goalOrder[id] == null ? null : w.goalOrder[id],
      gone: !m,
      connected: !!(m && m.connected)
    };
  });
}

// ---- その人だけに配る情報 ----
// 秘密を持たないゲームは null（配る必要がないものを配らない）
function privateFor(room, memberId) {
  const w = room.sugoroku;
  if (!w) return null;
  const rules = GAME_RULES[w.game] || {};
  if (!rules.privateFor) return null;
  return rules.privateFor(room, memberId);
}

// ---- 誰を待っているか ----
/**
 * 誰を待っているか。
 *
 * ゲームによって「待つ形」が違う（つうこうりょうは1人ずつ、こまはひとつは全員同時）ので、
 * **誰を待つかだけ**をゲーム側に委ねる。ただし
 * **「繋がっている人だけを返す」という絞り込みは、必ずこの芯で行う。**
 * ここをゲーム側に任せると、新しいゲームで接続の確認を書き忘れて
 * 「切れた人を待ち続けて止まる」が復活する（落とし穴17）。
 */
function expectedMembers(room) {
  const w = room.sugoroku;
  if (!w) return [];
  const rules = GAME_RULES[w.game] || {};
  if (rules.waitingIds) {
    return rules.waitingIds(room).filter((id) => {
      const m = room.members.get(id);
      return m && m.connected;
    });
  }
  if (w.phase === PHASE.READY) {
    return w.playerIds.filter((id) => {
      const m = room.members.get(id);
      return m && m.connected;
    });
  }
  if (w.phase === PHASE.TURN) {
    const m = room.members.get(w.turnId);
    return (m && m.connected) ? [w.turnId] : [];
  }
  // 結果を見ている間・イベント中・決着後は、誰も待たない（期限で自動的に進む）
  return [];
}
/**
 * 判定するのは「人を待っている段階」だけ。
 *
 * 結果を見ている間・イベント中・決着後は expectedMembers が空になるので、
 * そのまま every() を通すと必ず true になる。すると誰か1人が切れただけで
 * realtime.js の settleAfterMemberGone が advance を呼び、
 * まだ見ている途中の演出が全員ぶん切り捨てられる。
 * quiz-room.js / auction-room.js も同じ形のガードを持っている。
 *
 * READY・TURN で空の時に true を返すのは意図。手番の人が切れた瞬間に
 * settleAfterMemberGone が手番を飛ばせるようにするため（落とし穴17）。
 * それ以外の段階は、realtime.js の期限見回りが進めるので止まらない。
 */
function isAllDone(room) {
  const w = room.sugoroku;
  if (!w) return false;
  const rules = GAME_RULES[w.game] || {};
  const waiting = rules.waitingPhases || [PHASE.READY, PHASE.TURN];
  if (waiting.indexOf(w.phase) === -1) return false;
  return expectedMembers(room).every((id) => w.done[id]);
}
function waitingNames(room) {
  const w = room.sugoroku;
  if (!w) return [];
  return expectedMembers(room).filter((id) => !w.done[id]).map((id) => w.names[id]);
}

// ---- 端末からの操作 ----
// 操作は「やりたい」と伝えるだけ。実際に何が起きるかは advance が決める。
// こうしておくと、時間切れ・切断で advance が呼ばれた時も同じ経路を通る
// （経路ごとに書くと、片方だけ直して事故る）。
/**
 * 相手を指す操作の門（第35弾D-3で人狼・ワードウルフに入れたものと同じ考え方）。
 * 実在（この試合の参加者）・生存（まだあがっていない）・在籍（部屋にいる）・本人でない、を見る。
 *
 * つうこうりょう自身は相手を指さないが、共通の芯にここで置いておく。
 * ゲームごとに書くと、相手を指す遊び（ふたりの相方・てふだの交渉相手）で必ず書き忘れる（落とし穴1）。
 *
 * 接続（connected）は見ない。pointTurnToPlayable が「切断中でも席は残す」という
 * 別の基準を意図して採っているので、ここに接続を混ぜると基準が2つに割れる（型1）。
 */
function targetError(room, memberId, targetId) {
  if (targetId == null) return null;              // 相手を指さない操作
  const w = room.sugoroku;
  if (targetId === memberId) return 'self_target';
  if (w.playerIds.indexOf(targetId) === -1) return 'unknown_target';
  if (!room.members.has(targetId)) return 'unknown_target';
  if (w.goalOrder[targetId] != null) return 'unknown_target';
  return null;
}

// 断る時は必ず理由（error）を返す。realtime.js はこれをそのまま端末へ渡すので、
// 空だと「なぜ押せないのか」が誰にも分からなくなる
function submitAction(room, memberId, targetId, payload) {
  const w = room.sugoroku;
  if (!w) return { ok: false, error: 'not_started' };
  const act = (payload && payload.act) || null;
  // 門は段階より先に通す（断るべき操作の中身を intent に入れない）
  const tid = (targetId != null) ? targetId : ((payload && payload.targetId) || null);
  const terr = targetError(room, memberId, tid);
  if (terr) return { ok: false, error: terr };

  if (w.phase === PHASE.READY) {
    // 「参加者か」ではなく「いま待っている人か」で見る（wordwolf-room.js と同じ基準）
    if (expectedMembers(room).indexOf(memberId) === -1) return { ok: false, error: 'not_expected' };
    w.done[memberId] = true;
    return { ok: true, allDone: isAllDone(room) };
  }
  const rules1 = GAME_RULES[w.game] || {};
  if (rules1.submitAction) {
    const res = rules1.submitAction(room, memberId, act, payload);
    if (res) return res;
  }
  if (w.phase === PHASE.TURN) {
    if (memberId !== w.turnId) return { ok: false, error: 'not_your_turn' };
    const rules = GAME_RULES[w.game] || {};
    if (rules.checkAction && !rules.checkAction(room, memberId, act, payload)) {
      return { ok: false, error: 'bad_action' };
    }
    w.done[memberId] = true;
    w.intent = payload || {};
    return { ok: true, allDone: true };
  }
  return { ok: false, error: 'wrong_phase' };
}
// 投票の形をとる操作（てふだの交渉など）。いまのゲームでは使わない
function submitVote(room, memberId, targetId, payload) {
  const w = room.sugoroku;
  if (!w) return { ok: false, error: 'not_started' };
  const rules = GAME_RULES[w.game] || {};
  if (!rules.submitVote) return { ok: false, error: 'bad_action' };
  const terr = targetError(room, memberId, targetId);
  if (terr) return { ok: false, error: terr };
  return rules.submitVote(room, memberId, targetId, payload);
}

// ---- 段階を進める ----
// 全員そろった時・時間切れ・手番の人がいなくなった時・進行役が押した時から呼ばれる。
// どこから来ても同じ経路を通す。
function advance(room) {
  const w = room.sugoroku;
  if (!w || w.phase === PHASE.ENDED) return { changed: false };
  const rules0 = GAME_RULES[w.game] || {};
  // 段階の並びが違うゲームは、自分で進める（芯の道具＝setPhase / finish / 決着判定は共有する）
  if (rules0.advance) return rules0.advance(room);

  if (w.phase === PHASE.READY) {
    // 誰も進める人がいない盤で始まることは無いが、念のため決着に落とす
    if (!pointTurnToPlayable(room, true)) { finish(room); return { changed: true }; }
    startTurn(room);
    return { changed: true };
  }

  if (w.phase === PHASE.TURN) {
    const id = w.turnId;
    const stillHere = room.members.has(id);
    const intent = w.intent || {};
    w.intent = null;
    if (!stillHere) {
      // 名簿から消えた人の手番は、振らずに飛ばす（居ない人の駒を動かさない）
      w.last = { id, name: w.names[id], skipped: true };
    } else {
      // 押していない＝時間切れか切断。止まらないことを優先して、サーバーが振る
      w.last = (GAME_RULES[w.game].takeTurn)(room, id, { auto: !w.done[id], intent });
    }
    setPhase(room, PHASE.RESULT);
    w.deadline = Date.now() + RESULT_MS;
    return { changed: true };
  }

  if (w.phase === PHASE.RESULT) {
    if (endsNow(room)) { finish(room); return { changed: true }; }
    const ev = maybeEvent(room);
    if (ev) {
      w.event = ev;
      w.lastEventId = ev.id;
      applyEvent(room, ev);
      setPhase(room, PHASE.EVENT);
      w.deadline = Date.now() + EVENT_MS;
      return { changed: true };
    }
    return toNextTurn(room);
  }

  if (w.phase === PHASE.EVENT) return toNextTurn(room);
  return { changed: false };
}

function toNextTurn(room) {
  const w = room.sugoroku;
  if (!pointTurnToPlayable(room, false)) { finish(room); return { changed: true }; }
  startTurn(room);
  return { changed: true };
}
function startTurn(room) {
  const w = room.sugoroku;
  setPhase(room, PHASE.TURN);
  w.deadline = Date.now() + w.turnSec * 1000;
}
function setPhase(room, phase) {
  const w = room.sugoroku;
  w.phase = phase;
  w.done = {};       // 段階が変わったら「終わった人」は数え直す
  w.intent = null;   // 前の段階で受け取った「やりたいこと」も持ち越さない
  w.deadline = null;
  room.state.phase = phase;
}

/**
 * 次に動ける人へ手番を渡す。
 * 「部屋にいて、まだあがっていない人」を、並び順の次から探す。
 * 一周して誰も見つからなければ false（＝決着）。
 *
 * 切断中の人は飛ばさない（席は残す）。その人の手番になったら、
 * 期限切れでサーバーが振って進むので、止まらない。
 * @param {boolean} includeCurrent 開始直後だけ、いまの人自身も候補に入れる
 */
function pointTurnToPlayable(room, includeCurrent) {
  const w = room.sugoroku;
  const order = w.playerIds;
  const from = Math.max(0, order.indexOf(w.turnId));
  const first = includeCurrent ? 0 : 1;
  for (let step = first; step <= order.length; step++) {
    const at = (from + step) % order.length;
    const id = order[at];
    if (!room.members.has(id)) continue;       // 退室・kickでいなくなった
    if (w.goalOrder[id] != null) continue;     // もうあがった
    if (from + step >= order.length) bumpLap(w);  // 並び順の端を越えた＝一巡した
    w.turnId = id;
    return true;
  }
  return false;
}

// ---- 決着 ----
// そのゲームの終わり方。つうこうりょうは「先にあがった人の勝ち」
function endsNow(room) {
  const w = room.sugoroku;
  const rules = GAME_RULES[w.game] || {};
  if (rules.endsNow) return rules.endsNow(room);
  return w.goalCount > 0;
}
function finish(room) {
  const w = room.sugoroku;
  w.event = null;
  setPhase(room, PHASE.ENDED);
}
function resultView(room) {
  const w = room.sugoroku;
  if (!w) return null;
  const rules = GAME_RULES[w.game] || {};
  if (rules.resultView) return rules.resultView(room);
  const spec = S.gameById(w.game) || {};
  const ranked = S.rankPlayers(w.game, w.playerIds.map((id) => ({
    id,
    name: w.names[id],
    pos: w.pos[id],
    coins: w.coins[id],
    goalOrder: w.goalOrder[id] == null ? null : w.goalOrder[id]
  })));
  return {
    game: w.game,
    cells: spec.cells,
    coinsUsed: !!spec.coins,
    lap: w.lap,
    players: ranked.map((p) => ({
      id: p.id,                       // 誰が1位かを、名前ではなくidで見分ける
      name: p.name, pos: p.pos, rank: p.rank, tied: p.tied,
      coins: spec.coins ? p.coins : null,
      goaled: p.goalOrder != null
    }))
  };
}

// ---- 突然イベント ----
// 一巡の切れ目にだけ起こす。手番の途中で盤が動くと、
// いま何が起きたのかが混ざって分からなくなる
/**
 * 巡が変わる唯一の場所。効き目の失効を、境界そのものに結びつけておく。
 *
 * 失効の判定を別の段階（結果を見ている間など）に置くと、巡が変わった直後の1人だけが
 * 古い効き目を受け取る。つうこうりょうでは、その人の通行料だけがタダになっていた
 * （型2：境界のリセット判断。実装当初のバグ）。
 */
function bumpLap(w) {
  w.lap++;
  if (w.event && w.lap > w.event.untilLap) w.event = null;
}
function maybeEvent(room) {
  const w = room.sugoroku;
  if (!w.eventsOn) return null;
  if (!atLapEnd(room)) return null;
  if (rndOf(w)() >= EVENT_CHANCE) return null;
  const ev = S.pickEvent(w.game, rndOf(w), w.lastEventId);
  if (!ev) return null;
  // 一覧のものをそのまま持たせると、applied などの書き込みが次の試合に残る
  return Object.assign({}, ev, { untilLap: w.lap + 1 });
}
// 並び順のいちばん後ろの人が終わったら、一巡の切れ目
function atLapEnd(room) {
  const w = room.sugoroku;
  const playable = w.playerIds.filter((id) => room.members.has(id) && w.goalOrder[id] == null);
  return playable.length > 0 && w.turnId === playable[playable.length - 1];
}
function applyEvent(room, ev) {
  const w = room.sugoroku;
  // 効かせ方は共通（S.applyEventTo）。手渡し版もまったく同じものを通る
  const live = w.playerIds.filter((id) => room.members.has(id) && w.goalOrder[id] == null);
  const before = live.slice().sort((a, b) => w.pos[b] - w.pos[a]);
  S.applyEventTo(w, live, ev);
  if (ev.id === 'swap-ends' && ev.applied) {
    // 誰と誰が入れかわったかは、部屋の画面に出すので名前にしておく
    ev.detail = { head: w.names[before[0]], tail: w.names[before[before.length - 1]] };
  }
}

// =====================================================================
// ゲームごとのルール。共通の芯からは、ここを呼ぶだけ。
// 新しいすごろくを足す時は、この表に1つ足す（共通の芯には手を入れない）。
// =====================================================================
const GRAB_MINI_SHOW_MS = 2200;   // 何のミニゲームかを見せる間
const JANKEN_MAX_RETRY = 2;       // あいこが続いた時の上限（無限に繰り返さない）

const PAIR_ROLL_SEC = 45;    // 組の誰かが振るまでの期限
const PAIR_SPLIT_SEC = 60;   // 相談がまとまるまでの期限

const HAND_OFFER_SEC = 30;   // 売り札を出すのを待つ期限
const HAND_BUY_SEC = 25;     // 手番の人が買うかどうかを待つ期限
const HIDE_SAY_SEC = 45;     // 申告を待つ期限
const HIDE_JUDGE_MS = 3200;  // 申告の結果を見る間

const GAME_RULES = {
  // ---- ⑤ てふだ ----
  //
  // **サイコロを振らない。** 何マス進むかを自分で決める。
  // そのぶん「進める札を持っているか」がすべてになるので、
  // 配り方の公平さ（全員の合計を同じにする）と、
  // ぴったり上がり（ゴールを超える札は出せない）が芯になる。
  //
  // 何を誰に見せるか（決めごと㊶）:
  //   手札の数字   … **本人だけ**（privateFor）。見えたら駆け引きが消える
  //   手札の枚数   … 全員。残り枚数は読み合いの材料（数字は分からない）
  //   手札の合計   … 誰にも出さない（実質「あと何マス進めるか」が割れる）
  //   提示中の売り札 … 全員。出すこと自体が「その札を持っている」という情報のコスト
  //   コインの残り  … 全員（つうこうりょうと同じ）
  sugohand: {
    waitingPhases: [PHASE.READY, PHASE.OFFER, PHASE.BUY, PHASE.TURN],
    waitingIds(room) {
      const w = room.sugoroku;
      if (w.phase === PHASE.READY) return w.playerIds.slice();
      // 売り札を出すのは手番の人以外。**出さないのも選べる**ので、
      // 「出さない」を押した人は done になって待たれなくなる
      if (w.phase === PHASE.OFFER) {
        return handLiving(room).filter((id) => id !== w.turnId);
      }
      if (w.phase === PHASE.BUY || w.phase === PHASE.TURN) {
        return w.turnId ? [w.turnId] : [];
      }
      return [];
    },
    init(w, cfg) {
      const spec = S.gameById(w.game) || {};
      const hands = Hand.dealHands(w.playerIds.length, rndOf(w));
      w.hands = {};
      w.playerIds.forEach((id, i) => { w.hands[id] = hands[i] || []; });
      w.offers = {};        // sellerId -> { card, price }
      w.bought = null;      // 直前の取引（公開してよい中身だけ）
      w.moves = [];
      w.lapMoved = false;   // この一巡で、誰か1人でも進めたか（決めごと㊴）
      w.cells = spec.cells;
    },
    // 手札の**枚数**は見せる。数字は見せない
    publicPlayers(room) {
      const w = room.sugoroku;
      return w.playerIds.map((id) => {
        const m = room.members.get(id);
        return {
          id, name: w.names[id],
          pos: w.pos[id],
          coins: w.coins[id],
          cards: (w.hands[id] || []).length,   // ★ 枚数だけ。数字は入れない
          rank: null,
          goalOrder: w.goalOrder[id] == null ? null : w.goalOrder[id],
          gone: !m, connected: !!(m && m.connected)
        };
      });
    },
    publicExtra(room) {
      const w = room.sugoroku;
      return {
        hand: true,
        // 出ている売り札は全員に見せる（交渉の材料）
        offers: Object.keys(w.offers).map((id) => ({
          sellerId: id, name: w.names[id],
          card: w.offers[id].card, price: w.offers[id].price
        })),
        bought: w.bought,
        moves: w.moves,
        priceMin: Hand.PRICE_MIN, priceMax: Hand.PRICE_MAX
      };
    },
    /** その人だけに配る。**ここだけが手札の数字を知っている** */
    privateFor(room, memberId) {
      const w = room.sugoroku;
      if (w.playerIds.indexOf(memberId) === -1) return null;
      const hand = (w.hands[memberId] || []).slice().sort((a, b) => a - b);
      const cells = (S.gameById(w.game) || {}).cells;
      return {
        game: w.game,
        phase: w.phase,
        hand,
        // いま出せる札。**判定はルール層が持っている**ので、画面は並べるだけでよい
        playable: Hand.playable(hand, w.pos[memberId], cells),
        left: cells - w.pos[memberId],
        coins: w.coins[memberId],
        // 合計は自分にだけ出す（他人に見えると「あと何マス進めるか」が割れる）
        sum: Hand.handSum(hand)
      };
    },
    submitAction(room, memberId, act, payload) {
      const w = room.sugoroku;
      const p2 = payload || {};
      if (w.phase === PHASE.OFFER) {
        if (memberId === w.turnId) return { ok: false, error: 'not_expected' };
        if (w.playerIds.indexOf(memberId) === -1) return { ok: false, error: 'not_expected' };
        if (act === 'pass') { w.done[memberId] = true; return { ok: true, allDone: isAllDone(room) }; }
        if (act !== 'offer') return { ok: false, error: 'bad_action' };
        const hand = w.hands[memberId] || [];
        if (hand.indexOf(p2.card) === -1) return { ok: false, error: 'bad_action' };
        if (!Hand.priceOk(p2.price)) return { ok: false, error: 'bad_action' };
        w.offers[memberId] = { card: p2.card, price: p2.price };
        w.done[memberId] = true;
        return { ok: true, allDone: isAllDone(room) };
      }
      if (w.phase === PHASE.BUY) {
        if (memberId !== w.turnId) return { ok: false, error: 'not_your_turn' };
        if (act === 'pass') { w.done[memberId] = true; return { ok: true, allDone: true }; }
        if (act !== 'buy') return { ok: false, error: 'bad_action' };
        const offer = w.offers[p2.sellerId]
          ? Object.assign({ sellerId: p2.sellerId }, w.offers[p2.sellerId]) : null;
        const err = Hand.buyError(offer, w.coins[memberId], memberId);
        if (err) return { ok: false, error: err };
        handTrade(room, memberId, p2.sellerId);
        w.done[memberId] = true;
        return { ok: true, allDone: true };
      }
      if (w.phase === PHASE.TURN) {
        if (memberId !== w.turnId) return { ok: false, error: 'not_your_turn' };
        if (act !== 'play') return { ok: false, error: 'bad_action' };
        const hand = w.hands[memberId] || [];
        const cells = (S.gameById(w.game) || {}).cells;
        if (hand.indexOf(p2.card) === -1) return { ok: false, error: 'bad_action' };
        // **ゴールを超える札は出せない**（決めごと㊱）。ここも門で断る
        if (!Hand.canPlay(p2.card, w.pos[memberId], cells)) return { ok: false, error: 'bad_action' };
        w.pending = { card: p2.card };
        w.done[memberId] = true;
        return { ok: true, allDone: true };
      }
      return null;
    },
    advance(room) {
      const w = room.sugoroku;
      if (w.phase === PHASE.READY) { handStartTurn(room, true); return { changed: true }; }
      if (w.phase === PHASE.OFFER) {
        setPhase(room, PHASE.BUY);
        w.deadline = Date.now() + HAND_BUY_SEC * 1000;
        return { changed: true };
      }
      if (w.phase === PHASE.BUY) {
        setPhase(room, PHASE.TURN);
        w.deadline = Date.now() + w.turnSec * 1000;
        return { changed: true };
      }
      if (w.phase === PHASE.TURN) { handPlay(room); return { changed: true }; }
      if (w.phase === PHASE.RESULT) {
        if (w.goalCount > 0) { finish(room); return { changed: true }; }
        handStartTurn(room, false);
        return { changed: true };
      }
      return { changed: false };
    },
    resultView(room) {
      const w = room.sugoroku;
      const spec = S.gameById(w.game) || {};
      const ranked = Hand.rankHands(w.playerIds.map((id) => ({
        id, name: w.names[id], pos: w.pos[id], coins: w.coins[id],
        goalOrder: w.goalOrder[id] == null ? null : w.goalOrder[id]
      })));
      return {
        game: w.game, cells: spec.cells, coinsUsed: true, lap: w.lap,
        players: ranked.map((p) => ({
          id: p.id, name: p.name, pos: p.pos, rank: p.rank, tied: p.tied,
          coins: p.coins, goaled: p.goalOrder != null
        }))
      };
    }
  },

  // ---- ② どこにいる？ ----
  // **秘密設計の本丸。** 自分の位置は自分にしか見えず、申告では嘘をついてよい。
  //
  // 何を誰に見せるか（設計書の決めごと⑱）:
  //   実際の位置 … **本人だけ**（privateFor）。公開ビューにも大画面にも入れない
  //   申告した位置・手がかり・矛盾の有無 … 全員（それが遊びの材料）
  //   あがったかどうか … 全員。**判定は自己申告と無関係に、サーバーが実位置で行う**
  //   （嘘の申告で勝利を宣言することはできない）
  sugohide: {
    waitingPhases: [PHASE.READY, PHASE.TURN, PHASE.SAY],
    waitingIds(room) {
      const w = room.sugoroku;
      if (w.phase === PHASE.READY) return w.playerIds.slice();
      if (w.phase === PHASE.TURN) return w.turnId ? [w.turnId] : [];
      if (w.phase === PHASE.SAY) return w.sayerId ? [w.sayerId] : [];
      return [];
    },
    init(w) {
      w.sayerId = null;       // いま申告を求められている人
      w.asked = {};           // memberId -> 求められた回数
      w.said = null;          // 直前の申告（公開してよい中身だけ）
      w.moves = [];
    },
    /**
     * 公開してよい情報。**実位置は絶対に入れない。**
     * 入れてしまうと、大画面を含む全員に配られてゲームが終わる。
     */
    publicPlayers(room) {
      const w = room.sugoroku;
      return w.playerIds.map((id) => {
        const m = room.members.get(id);
        return {
          id, name: w.names[id],
          pos: null,                       // ★ 実位置は公開しない
          coins: null, rank: null,
          // 最後に申告した区画だけを見せる（本当かどうかは分からない）
          saidArea: w.saidArea && w.saidArea[id] ? w.saidArea[id] : null,
          goalOrder: w.goalOrder[id] == null ? null : w.goalOrder[id],
          asking: id === w.sayerId,
          gone: !m, connected: !!(m && m.connected)
        };
      });
    },
    publicExtra(room) {
      const w = room.sugoroku;
      return {
        hidden: true,
        areas: Hide.areas(),
        clues: Hide.clues().map((c) => ({ id: c.id, text: c.text })),
        sayer: w.sayerId ? { id: w.sayerId, name: w.names[w.sayerId] } : null,
        said: w.said,        // 申告の中身（区画・手がかり・矛盾したか）。実位置は入っていない
        moves: w.moves
      };
    },
    /** その人だけに配る。**ここだけが実位置を知っている** */
    privateFor(room, memberId) {
      const w = room.sugoroku;
      if (w.playerIds.indexOf(memberId) === -1) return null;
      const cells = (S.gameById(w.game) || {}).cells;
      const area = Hide.areaOf(w.pos[memberId], cells);
      return {
        game: w.game,
        phase: w.phase,
        pos: w.pos[memberId],                    // 自分の位置は自分だけ
        left: cells - w.pos[memberId],
        area: { id: area.id, name: area.name },
        // ここから何が見えるか（嘘をつく時の材料にもなる）
        clues: Hide.cluesOf(area.id).map((c) => ({ id: c.id, text: c.text })),
        asking: memberId === w.sayerId
      };
    },
    submitAction(room, memberId, act, payload) {
      const w = room.sugoroku;
      if (w.phase === PHASE.TURN) {
        if (memberId !== w.turnId) return { ok: false, error: 'not_your_turn' };
        if (act !== 'roll') return { ok: false, error: 'bad_action' };
        w.done[memberId] = true;
        return { ok: true, allDone: true };
      }
      if (w.phase === PHASE.SAY) {
        if (memberId !== w.sayerId) return { ok: false, error: 'not_expected' };
        if (act !== 'say') return { ok: false, error: 'bad_action' };
        const p2 = payload || {};
        if (!Hide.areaById(p2.areaId)) return { ok: false, error: 'unknown_target' };
        if (!Hide.clueById(p2.clueId)) return { ok: false, error: 'unknown_target' };
        w.pending = { areaId: p2.areaId, clueId: p2.clueId };
        w.done[memberId] = true;
        return { ok: true, allDone: true };
      }
      return null;
    },
    advance(room) {
      const w = room.sugoroku;
      if (w.phase === PHASE.READY) { hideStartTurn(room); return { changed: true }; }
      if (w.phase === PHASE.TURN) { hideRoll(room); return { changed: true }; }
      if (w.phase === PHASE.SAY) { hideJudge(room); return { changed: true }; }
      if (w.phase === PHASE.JUDGE) {
        if (w.goalCount > 0) { finish(room); return { changed: true }; }
        hideStartTurn(room);
        return { changed: true };
      }
      if (w.phase === PHASE.RESULT) {
        if (w.goalCount > 0) { finish(room); return { changed: true }; }
        hideStartTurn(room);
        return { changed: true };
      }
      return { changed: false };
    },
    /** 決着してはじめて、実位置を明かす（それまでは誰にも見せない） */
    resultView(room) {
      const w = room.sugoroku;
      const spec = S.gameById(w.game) || {};
      const ranked = S.rankPlayers('sugohide', w.playerIds.map((id) => ({
        id, name: w.names[id], pos: w.pos[id], coins: 0,
        goalOrder: w.goalOrder[id] == null ? null : w.goalOrder[id]
      })));
      return {
        game: w.game, cells: spec.cells, coinsUsed: false, lap: w.lap,
        players: ranked.map((p) => ({
          id: p.id,
          name: p.name, pos: p.pos, rank: p.rank, tied: p.tied,
          coins: null, goaled: p.goalOrder != null
        }))
      };
    }
  },

  // ---- ③ ふたりでひとつ ----
  // 駒が「人」ではなく「組」に付く。出た目を組の中で相談して分け合う。
  //
  // **このゲーム固有の止まり方**（設計書の決めごと⑭）:
  //   これまでの2つは「手番の人が消える」＝待つ相手が1人だった。
  //   ここは**合計が出目に一致するまで確定しない**ので、相方が消えると
  //   配分が永久に一致しない。だから:
  //     ・相方がいなくなった組は、残った1人が出目を全部使える（S.soloSplit）
  //     ・待つのは**組ごと**。まとまった組は、他の組を待たずに確定できる
  //     ・どちらの段階にも期限を置き、切れたらサーバーが埋める（止まらないことを優先）
  sugopair: {
    waitingPhases: [PHASE.READY, PHASE.ROLL, PHASE.SPLIT],
    // 待つのは「まだ済んでいない組」の人だけ。済んだ組の人は待たれない。
    // 繋がっているかの絞り込みは芯がやるので、ここでは書かない
    waitingIds(room) {
      const w = room.sugoroku;
      if (w.phase === PHASE.READY) return w.playerIds.slice();
      if (w.phase === PHASE.ROLL) {
        return livingGroups(room).filter((g) => w.dice[g.id] == null)
          .reduce((acc, g) => acc.concat(g.members), []);
      }
      if (w.phase === PHASE.SPLIT) {
        return livingGroups(room).filter((g) => !w.locked[g.id])
          .reduce((acc, g) => acc.concat(g.members), []);
      }
      return [];
    },
    init(w, cfg) {
      const style = cfg.pairStyle === S.PAIR_STYLE.ONE ? S.PAIR_STYLE.ONE : S.PAIR_STYLE.EVEN;
      w.groups = S.makePairs(w.playerIds, style, rndOf(w)).map((members, i) => ({
        id: 'g' + i, members: members.slice(), pos: 0, goalOrder: null
      }));
      w.pairStyle = style;
      w.dice = {};        // 組id -> 出目
      w.parts = {};       // 組id -> { memberId: マス数 }
      w.locked = {};      // 組id -> 確定したか
      w.autoUsed = {};    // 組id -> 自動で等分されたか（画面で理由を出すため）
      w.solo = {};        // 組id -> 相方がいなくなって1人になったか
      w.moves = [];
    },
    // 駒は組に付く。人ごとの位置は持たない
    publicPlayers(room) {
      const w = room.sugoroku;
      return w.playerIds.map((id) => {
        const m = room.members.get(id);
        const g = groupOf(w, id);
        return {
          id, name: w.names[id],
          pos: g ? g.pos : 0,
          groupId: g ? g.id : null,
          rank: null, coins: null,
          goalOrder: g && g.goalOrder != null ? g.goalOrder : null,
          gone: !m, connected: !!(m && m.connected)
        };
      });
    },
    publicExtra(room) {
      const w = room.sugoroku;
      const ranks = S.positionRanks(w.groups.map((g) => ({ id: g.id, pos: g.pos })));
      return {
        pairs: true,
        groups: w.groups.map((g) => ({
          id: g.id,
          names: g.members.map((id) => w.names[id]),
          // 部屋から消えた人は、組の中でも「いない」ことが分かるようにする
          gone: g.members.filter((id) => !room.members.has(id)).map((id) => w.names[id]),
          pos: g.pos,
          rank: ranks[g.id] || null,
          goalOrder: g.goalOrder,
          dice: w.dice[g.id] == null ? null : w.dice[g.id],
          // 何を入れたかは、組の中の相談なので全員に見せてよい（声に出して相談する遊び）
          parts: w.parts[g.id] || {},
          sum: S.splitSum(w.parts[g.id] || {}),
          locked: !!w.locked[g.id],
          solo: !!w.solo[g.id],
          auto: !!w.autoUsed[g.id]
        })),
        last: w.last
      };
    },
    submitAction(room, memberId, act, payload) {
      const w = room.sugoroku;
      const g = groupOf(w, memberId);
      if (!g) return { ok: false, error: 'not_expected' };
      if (w.phase === PHASE.ROLL) {
        if (act !== 'roll') return { ok: false, error: 'bad_action' };
        if (w.dice[g.id] != null) return { ok: false, error: 'taken' };
        w.dice[g.id] = S.rollDice(rndOf(w));
        prepareSplit(room, g);
        markGroupDone(room, g);
        return { ok: true, allDone: isAllDone(room) };
      }
      if (w.phase === PHASE.SPLIT) {
        if (w.locked[g.id]) return { ok: false, error: 'taken' };
        if (act === 'split') {
          const n = Math.max(0, (payload && payload.steps) | 0);
          if (n > w.dice[g.id]) return { ok: false, error: 'bad_action' };
          // 入れ物が無いまま来ても落ちない。受け口で例外を投げると、
          // socket の向こうで何が起きたか誰にも分からなくなる
          if (!w.parts[g.id]) prepareSplit(room, g);
          w.parts[g.id][memberId] = n;
          // 合計が出目とぴったり一致した時だけ確定する
          if (S.splitReady(w.dice[g.id], w.parts[g.id])) {
            w.locked[g.id] = true;
            markGroupDone(room, g);
          }
          return { ok: true, allDone: isAllDone(room) };
        }
        return { ok: false, error: 'bad_action' };
      }
      return null;
    },
    advance(room) {
      const w = room.sugoroku;
      if (w.phase === PHASE.READY) { startRoll(room); return { changed: true }; }
      if (w.phase === PHASE.ROLL) {
        // 振っていない組は、サーバーが振る（止まらないことを優先）
        livingGroups(room).forEach((g) => {
          if (w.dice[g.id] == null) { w.dice[g.id] = S.rollDice(rndOf(w)); prepareSplit(room, g); }
        });
        startSplit(room);
        return { changed: true };
      }
      if (w.phase === PHASE.SPLIT) {
        settleSplits(room);
        return { changed: true };
      }
      if (w.phase === PHASE.RESULT) {
        if (w.goalCount > 0) { finish(room); return { changed: true }; }
        const ev = maybeEvent(room);
        if (ev) {
          w.event = ev; w.lastEventId = ev.id;
          applyEvent(room, ev);
          setPhase(room, PHASE.EVENT);
          w.deadline = Date.now() + EVENT_MS;
          return { changed: true };
        }
        startRoll(room);
        return { changed: true };
      }
      if (w.phase === PHASE.EVENT) { startRoll(room); return { changed: true }; }
      return { changed: false };
    },
    // 決着は**組**で並べる。コインを使わないので、あがった順 → 距離 → 同着
    resultView(room) {
      const w = room.sugoroku;
      const spec = S.gameById(w.game) || {};
      const ranked = S.rankPlayers('sugopair', w.groups.map((g) => ({
        id: g.id, name: g.members.map((id) => w.names[id]).join('・'),
        pos: g.pos, coins: 0, goalOrder: g.goalOrder
      })));
      return {
        game: w.game, cells: spec.cells, coinsUsed: false, lap: w.lap, pairs: true,
        players: ranked.map((p) => ({
          id: p.id,                   // ここだけは「組」のid（人ではない）
          name: p.name, pos: p.pos, rank: p.rank, tied: p.tied,
          coins: null, goaled: p.goalOrder != null
        }))
      };
    }
  },

  // ---- ① こまはひとつ ----
  // 駒が1つしかない。毎ターン、それを動かす権利をミニゲームで奪い合う。
  // 段階が READY → MINI → PLAY → GRAB → RESULT と変わるので、
  // 芯の pointTurnToPlayable（並び順で次を探す）は使わない。
  // 代わりに、ミニゲームの順位から「動かす順番」を作る。
  sugograb: {
    waitingPhases: [PHASE.READY, PHASE.PLAY, PHASE.GRAB],
    // 誰を待つか。**繋がっているかの絞り込みは芯がやる**ので、ここでは書かない
    waitingIds(room) {
      const w = room.sugoroku;
      if (w.phase === PHASE.READY || w.phase === PHASE.PLAY) return w.playerIds.slice();
      if (w.phase === PHASE.GRAB) return w.turnId ? [w.turnId] : [];
      return [];
    },
    init(w, cfg) {
      w.piece = 0;              // 駒は1つ。位置はここ（w.pos は使わない）
      w.mini = null;            // いま何のミニゲームか
      w.lastMiniId = null;
      w.entries = {};           // ミニゲームの入力
      w.miniRank = [];          // ミニゲームの順位
      w.order = [];             // 駒を動かす順番
      w.orderAt = 0;
      w.retry = 0;              // じゃんけんのあいこ
      w.losersMove = cfg.losersMove !== false;   // 敗者も少し動く（既定ON）
      w.quiz = null;
      w.usedQuiz = {};
    },
    // 駒は1つなので、位置は人ごとに持たない。出すのはコインと「いま動かす人か」
    publicPlayers(room) {
      const w = room.sugoroku;
      return w.playerIds.map((id) => {
        const m = room.members.get(id);
        const rk = (w.miniRank.find((x) => x.id === id) || {}).rank;
        return {
          id, name: w.names[id],
          pos: null, rank: rk || null,
          coins: w.coins[id],
          moving: id === w.turnId,
          goalOrder: null,
          gone: !m, connected: !!(m && m.connected)
        };
      });
    },
    publicExtra(room) {
      const w = room.sugoroku;
      const out = { piece: w.piece, sharedPiece: true, losersMove: w.losersMove };
      if (w.mini) {
        out.mini = {
          id: w.mini.id, kind: w.mini.kind, title: w.mini.title,
          lead: w.mini.lead, note: w.mini.note, simulInput: w.mini.simulInput
        };
        // 出題は PLAY に入ってから配る。MINI（題を出すだけ）の間は見せない
        if (w.phase === PHASE.PLAY && w.quiz) {
          out.question = { q: w.quiz.q, choices: w.quiz.choices };
        }
        // 誰が出し終えたかは見せる（何を出したかは見せない）
        out.answered = w.playerIds.filter((id) => w.entries[id] != null).map((id) => w.names[id]);
      }
      return out;
    },
    submitAction(room, memberId, act, payload) {
      const w = room.sugoroku;
      if (w.phase === PHASE.PLAY) {
        if (w.playerIds.indexOf(memberId) === -1) return { ok: false, error: 'not_expected' };
        if (w.entries[memberId] != null) return { ok: false, error: 'taken' };
        const entry = readEntry(w, payload);
        if (!entry) return { ok: false, error: 'bad_action' };
        w.entries[memberId] = entry;
        w.done[memberId] = true;
        return { ok: true, allDone: isAllDone(room) };
      }
      if (w.phase === PHASE.GRAB) {
        if (memberId !== w.turnId) return { ok: false, error: 'not_your_turn' };
        if (act !== 'roll') return { ok: false, error: 'bad_action' };
        w.done[memberId] = true;
        return { ok: true, allDone: true };
      }
      return null;   // 芯の受け口へ戻す
    },
    advance(room) {
      const w = room.sugoroku;
      if (w.phase === PHASE.READY) { startMini(room); return { changed: true }; }
      if (w.phase === PHASE.MINI) { startPlay(room); return { changed: true }; }
      if (w.phase === PHASE.PLAY) { settlePlay(room); return { changed: true }; }
      if (w.phase === PHASE.GRAB) { doGrab(room); return { changed: true }; }
      if (w.phase === PHASE.RESULT) {
        if (w.goalCount > 0) { finish(room); return { changed: true }; }
        const ev = maybeEvent(room);
        if (ev) {
          w.event = ev; w.lastEventId = ev.id;
          applyEvent(room, ev);
          setPhase(room, PHASE.EVENT);
          w.deadline = Date.now() + EVENT_MS;
          return { changed: true };
        }
        startMini(room);
        return { changed: true };
      }
      if (w.phase === PHASE.EVENT) { startMini(room); return { changed: true }; }
      return { changed: false };
    },
    // 先にあがらせた人が勝ち。2位以下は残りコインの多い順
    resultView(room) {
      const w = room.sugoroku;
      const spec = S.gameById(w.game) || {};
      const winner = w.winnerId;
      const rest = w.playerIds.filter((id) => id !== winner)
        .map((id) => ({ id, name: w.names[id], pos: w.piece, coins: w.coins[id], goalOrder: null }));
      const ranked = S.rankPlayers('sugograb', rest);
      const players = [];
      if (winner) {
        players.push({ id: winner, name: w.names[winner], pos: w.piece, rank: 1, tied: false,
          coins: w.coins[winner], goaled: true });
      }
      ranked.forEach((p) => {
        players.push({ id: p.id, name: p.name, pos: p.pos, rank: p.rank + (winner ? 1 : 0),
          tied: p.tied, coins: p.coins, goaled: false });
      });
      return { game: w.game, cells: spec.cells, coinsUsed: true, lap: w.lap, players };
    }
  },
  // ---- ④ つうこうりょう ----
  // 先頭に近い人ほど、進む時にコインを払う。
  // 順位は盤面の位置だけで決まる（コインで決めると「わざと進まずコインを貯める」が
  // 最適解になり、すごろくの目的と矛盾する）。
  sugotoll: {
    checkAction(room, memberId, act) {
      return act === 'roll';
    },
    takeTurn(room, id, opt) {
      const w = room.sugoroku;
      const dice = S.rollDice(rndOf(w));
      // 手番の中身は共通（S.tollTurn）。手渡し版もまったく同じものを通る。
      // 順番を2か所に書くと、片方だけ直して事故る（落とし穴1）
      const live = w.playerIds.filter((pid) => room.members.has(pid));
      const out = S.tollTurn(w, live, id, dice);
      out.name = w.names[id];
      out.auto = !!opt.auto;    // サーバーが代わりに振ったか（部屋だけの情報）
      return out;
    },
    // 先にあがった人の勝ち
    endsNow(room) {
      return room.sugoroku.goalCount > 0;
    }
  }
};

// ===== 「てふだ」の進行 =====

// まだあがっていない人（部屋から消えた人は数えない）
function handLiving(room) {
  const w = room.sugoroku;
  return w.playerIds.filter((id) => room.members.has(id) && w.goalOrder[id] == null);
}

/**
 * 次の人の番。売り札の提示から始まる。
 * **一巡して誰も進めなかったら、そこで決着**（決めごと㊴）。
 * 補充が無いので、置かないと永久に終わらない
 */
function handStartTurn(room, first) {
  const w = room.sugoroku;
  w.offers = {};
  w.bought = null;
  w.pending = null;
  w.moves = [];
  const live = handLiving(room);
  if (!live.length) { finish(room); return; }
  if (!first) {
    const at = live.indexOf(w.turnId);
    w.turnId = live[(at + 1) % live.length];
    if (at + 1 >= live.length) {
      // 一巡した。誰も進めていなければ、これ以上は動かない
      if (!w.lapMoved) { finish(room); return; }
      w.lap++;
      w.lapMoved = false;
    }
  } else {
    w.turnId = live[0];
    w.lapMoved = false;
  }
  setPhase(room, PHASE.OFFER);
  w.deadline = Date.now() + HAND_OFFER_SEC * 1000;
}

// 取引を成立させる。**コインと札は、この1か所だけが動かす**
function handTrade(room, buyerId, sellerId) {
  const w = room.sugoroku;
  const offer = w.offers[sellerId];
  if (!offer) return;
  const rest = Hand.useCard(w.hands[sellerId] || [], offer.card);
  if (!rest) return;                       // 売り手がもう持っていない（買えない）
  w.hands[sellerId] = rest;
  w.hands[buyerId] = (w.hands[buyerId] || []).concat([offer.card]);
  w.coins[buyerId] = S.addCoins(w.coins[buyerId], -offer.price);
  w.coins[sellerId] = S.addCoins(w.coins[sellerId], offer.price);
  // 誰が誰から何を買ったかは、その後の読み合いの材料になるので全員に見せる
  w.bought = {
    buyerId, buyerName: w.names[buyerId],
    sellerId, sellerName: w.names[sellerId],
    card: offer.card, price: offer.price
  };
  delete w.offers[sellerId];
}

/**
 * 札を1枚出して進む。
 * 押していなければサーバーが選ぶ（止まらないことを優先）。
 * 出せる札が1枚も無い時は進めない。**そのかわりコインが入る**——
 * 責める場面にしない（原則7・決めごと㊳）
 */
function handPlay(room) {
  const w = room.sugoroku;
  const id = w.turnId;
  const cells = (S.gameById(w.game) || {}).cells;
  const auto = !w.done[id];
  const hand = w.hands[id] || [];
  const able = Hand.playable(hand, w.pos[id], cells);

  if (!room.members.has(id)) {
    w.moves = [{ id, name: w.names[id], skipped: true }];
  } else if (!able.length) {
    w.coins[id] = S.addCoins(w.coins[id], Hand.STUCK_RELIEF);
    w.moves = [{ id, name: w.names[id], stuck: true, relief: Hand.STUCK_RELIEF,
      coinsAfter: w.coins[id] }];
  } else {
    // 押していない時は、いちばん小さい札を出す（大きい札を勝手に使わない）
    const card = (w.pending && able.indexOf(w.pending.card) !== -1)
      ? w.pending.card
      : able.slice().sort((a, b) => a - b)[0];
    w.hands[id] = Hand.useCard(hand, card);
    w.pos[id] = w.pos[id] + card;
    w.lapMoved = true;
    const goal = w.pos[id] >= cells;
    if (goal && w.goalOrder[id] == null) {
      w.goalCount++;
      w.goalOrder[id] = w.goalCount;
    }
    w.moves = [{ id, name: w.names[id], card, steps: card, auto, goal,
      left: cells - w.pos[id] }];
  }
  w.pending = null;
  w.last = { moves: w.moves };
  setPhase(room, PHASE.RESULT);
  w.deadline = Date.now() + RESULT_MS;
}

// ===== 「どこにいる？」の進行 =====

// まだあがっていない人（部屋から消えた人は数えない）
function hideLiving(room) {
  const w = room.sugoroku;
  return w.playerIds.filter((id) => room.members.has(id) && w.goalOrder[id] == null);
}

// 次の人の手番。手番の人が振り、そのあと**別の誰か**が申告を求められる
function hideStartTurn(room) {
  const w = room.sugoroku;
  w.said = null;
  w.pending = null;
  w.moves = [];
  const live = hideLiving(room);
  if (!live.length) { finish(room); return; }
  const at = live.indexOf(w.turnId);
  w.turnId = live[(at + 1) % live.length];
  if (at + 1 >= live.length) w.lap++;
  setPhase(room, PHASE.TURN);
  w.deadline = Date.now() + w.turnSec * 1000;
}

// 振って進む。**進んだ結果は本人にしか届かない**（privateFor だけが持つ）
function hideRoll(room) {
  const w = room.sugoroku;
  const id = w.turnId;
  const auto = !w.done[id];
  if (room.members.has(id)) {
    const dice = S.rollDice(rndOf(w));
    const mv = S.applyMove(w.board, w.pos[id], dice);
    w.pos[id] = mv.to;
    if (mv.goal && w.goalOrder[id] == null) {
      w.goalCount++;
      w.goalOrder[id] = w.goalCount;
    }
    // 公開してよいのは「振った」という事実だけ。出目も位置も入れない
    w.moves = [{ id, name: w.names[id], rolled: true, auto, goal: w.goalOrder[id] != null }];
  } else {
    w.moves = [{ id, name: w.names[id], skipped: true }];
  }
  if (w.goalCount > 0) { setPhase(room, PHASE.RESULT); w.deadline = Date.now() + RESULT_MS; return; }
  hideAsk(room);
}

/**
 * 誰か1人に申告を求める。**毎ターン必ず1人**（たるみ防止の仕掛け）。
 * まだ求められていない人から先に選ぶ（決めごと㉑）。
 */
function hideAsk(room) {
  const w = room.sugoroku;
  const live = hideLiving(room);
  if (!live.length) { finish(room); return; }
  w.sayerId = Hide.pickAsked(live, w.asked, rndOf(w));
  w.asked[w.sayerId] = (w.asked[w.sayerId] || 0) + 1;
  setPhase(room, PHASE.SAY);
  w.deadline = Date.now() + HIDE_SAY_SEC * 1000;
}

/**
 * 申告を見る。**見るのは「申告した区画に、その手がかりが在るか」だけ。**
 * 実位置とは比べない——嘘でも筋が通っていれば通るのが、この遊びの芯。
 *
 * 申告しないまま締め切られた人は、黙って通さない。
 * 「何も言わなかった」ことが全員に見えるようにする（それも読み合いの材料）。
 */
function hideJudge(room) {
  const w = room.sugoroku;
  const id = w.sayerId;
  const cells = (S.gameById(w.game) || {}).cells;
  const p = w.pending;
  w.saidArea = w.saidArea || {};

  if (!p) {
    w.said = { id, name: w.names[id], silent: true };
  } else {
    const bad = Hide.isContradiction(p.clueId, p.areaId);
    w.saidArea[id] = p.areaId;
    w.said = {
      id, name: w.names[id],
      areaId: p.areaId, areaName: (Hide.areaById(p.areaId) || {}).name,
      clueId: p.clueId, clueText: (Hide.clueById(p.clueId) || {}).text,
      caught: bad
    };
    if (bad) {
      // 矛盾がバレた。数マス戻す（0未満にはしない）
      const back = S.applyMove(w.board, w.pos[id], -Hide.CAUGHT_BACK);
      w.pos[id] = back.to;
      w.said.back = Hide.CAUGHT_BACK;
    }
  }
  w.pending = null;
  setPhase(room, PHASE.JUDGE);
  w.deadline = Date.now() + HIDE_JUDGE_MS;
}

// ===== 「ふたりでひとつ」の進行 =====

function groupOf(w, memberId) {
  return (w.groups || []).find((g) => g.members.indexOf(memberId) !== -1) || null;
}
// まだあがっていない組（部屋から全員消えた組は数えない）
function livingGroups(room) {
  const w = room.sugoroku;
  return (w.groups || []).filter((g) =>
    g.goalOrder == null && g.members.some((id) => room.members.has(id)));
}
// その組の全員を「済み」にする。待つ単位が組なので、済んだ組の人は待たれない
function markGroupDone(room, g) {
  const w = room.sugoroku;
  g.members.forEach((id) => { w.done[id] = true; });
}

/**
 * 配分の入れ物を用意する。
 * **相方がいなくなった組は、残った1人が出目を全部使えるようにして、その場で確定する。**
 * 「相談する相手がいないのに相談を待つ」状態を作らない（設計書の決めごと⑭）。
 */
function prepareSplit(room, g) {
  const w = room.sugoroku;
  const here = g.members.filter((id) => room.members.has(id));
  if (here.length === 1) {
    w.parts[g.id] = S.soloSplit(w.dice[g.id], here[0]);
    w.locked[g.id] = true;
    w.solo[g.id] = true;
    return;
  }
  const parts = {};
  here.forEach((id) => { parts[id] = 0; });
  w.parts[g.id] = parts;
}

function startRoll(room) {
  const w = room.sugoroku;
  w.dice = {}; w.parts = {}; w.locked = {}; w.autoUsed = {}; w.solo = {};
  w.moves = [];
  setPhase(room, PHASE.ROLL);
  w.deadline = Date.now() + PAIR_ROLL_SEC * 1000;
}
function startSplit(room) {
  const w = room.sugoroku;
  setPhase(room, PHASE.SPLIT);
  // 相方がいなくなって既に確定した組は、待たない
  livingGroups(room).forEach((g) => { if (w.locked[g.id]) markGroupDone(room, g); });
  w.deadline = Date.now() + PAIR_SPLIT_SEC * 1000;
}

/**
 * 締め切って、組ごとに駒を進める。
 * まとまらなかった組は等分・端数切り捨て（S.autoSplit）。
 * わずかに損をする形にしてあるのは「ちゃんと交渉した方が得」という誘導。
 */
function settleSplits(room) {
  const w = room.sugoroku;
  w.moves = [];
  livingGroups(room).forEach((g) => {
    if (!w.locked[g.id]) {
      const here = g.members.filter((id) => room.members.has(id));
      w.parts[g.id] = S.autoSplit(w.dice[g.id], here);
      w.autoUsed[g.id] = true;
      w.locked[g.id] = true;
    }
    const steps = S.splitSum(w.parts[g.id]);
    const mv = S.applyMove(w.board, g.pos, steps);
    g.pos = mv.to;
    if (mv.goal && g.goalOrder == null) {
      w.goalCount++;
      g.goalOrder = w.goalCount;
    }
    w.moves.push({
      groupId: g.id,
      names: g.members.map((id) => w.names[id]),
      dice: w.dice[g.id], steps, move: mv,
      auto: !!w.autoUsed[g.id], solo: !!w.solo[g.id],
      goal: g.goalOrder != null
    });
  });
  w.last = { moves: w.moves };
  setPhase(room, PHASE.RESULT);
  w.deadline = Date.now() + RESULT_MS;
}

// ===== 「こまはひとつ」の進行 =====

// 端末から届いた「出したもの」を、ミニゲームごとの形に整える。
// 知らない形は受け取らない（改造した端末が変な値を入れられないように）
function readEntry(w, payload) {
  const p = payload || {};
  const id = w.mini && w.mini.id;
  const at = Math.max(0, Date.now() - (w.playStartedAt || Date.now()));
  if (id === 'tap') return { count: Math.max(0, p.count | 0), atMs: at };
  if (id === 'janken') return Mini.HANDS.indexOf(p.hand) === -1 ? null : { hand: p.hand };
  if (id === 'fingers') return (p.fingers == null) ? null : { fingers: p.fingers | 0 };
  if (id === 'quiz') {
    if (p.choice == null) return null;
    return { correct: (p.choice | 0) === w.quiz.correct, atMs: at };
  }
  return null;
}

// 何のミニゲームかを、画面いっぱいに出す段階。
// 何が始まったか分からないまま始まるのが、いちばん混乱する
function startMini(room) {
  const w = room.sugoroku;
  w.mini = Mini.pickMini(rndOf(w), w.lastMiniId);
  w.lastMiniId = w.mini ? w.mini.id : null;
  w.entries = {};
  w.miniRank = [];
  w.order = [];
  w.orderAt = 0;
  w.retry = 0;
  w.quiz = null;
  setPhase(room, PHASE.MINI);
  w.deadline = Date.now() + GRAB_MINI_SHOW_MS;
}

function startPlay(room) {
  const w = room.sugoroku;
  w.entries = {};
  if (w.mini && w.mini.id === 'quiz') {
    // 出題は quiz-bank.js から引く（新しい問題プールは作らない）
    const picked = QuizBank.pickQuestions('normal', 1, w.usedQuiz, rndOf(w));
    const q = picked && picked[0];
    if (q) {
      w.usedQuiz[q.q] = true;
      w.quiz = QuizBank.shuffleChoices(q, rndOf(w));
    }
  }
  setPhase(room, PHASE.PLAY);
  w.deadline = Date.now() + ((w.mini && w.mini.sec) || 12) * 1000;
}

/**
 * 締め切って順位をつける。
 * **出していない人の扱いは sugoroku-mini.js が持っている**（必ず最下位に同着）ので、
 * ここでは「締め切ったら、そのまま順位をつける」だけでよい。
 * 切断・無操作・時間切れのどれで来ても、同じここを通る。
 */
function settlePlay(room) {
  const w = room.sugoroku;
  const res = Mini.rankMini(w.mini && w.mini.id, w.playerIds, w.entries);
  if (res.draw) {
    // じゃんけんのあいこ。黙って勝者を作らず、もう一度やる（無限には繰り返さない）
    w.retry++;
    if (w.retry <= JANKEN_MAX_RETRY) {
      w.last = { mini: w.mini.id, draw: true, retry: w.retry };
      startPlay(room);
      return;
    }
    // 上限まで来たら、この回は誰も動かさずに次へ
    w.last = { mini: w.mini.id, draw: true, retry: w.retry, gaveUp: true };
    setPhase(room, PHASE.RESULT);
    w.deadline = Date.now() + RESULT_MS;
    return;
  }
  w.miniRank = res.ranked;
  w.order = Mini.grabOrder(res.ranked).filter((id) => room.members.has(id));
  w.orderAt = 0;
  w.moves = [];
  nextGrab(room);
}

// 駒を動かす人へ順に渡す。動かす人がいなくなったら結果へ
function nextGrab(room) {
  const w = room.sugoroku;
  while (w.orderAt < w.order.length) {
    const id = w.order[w.orderAt];
    const rank = (w.miniRank.find((x) => x.id === id) || {}).rank || 99;
    // 1位はサイコロを振る。2位以下は「敗者移動」で、決まったぶんだけ動く
    if (rank === 1) { w.turnId = id; setPhase(room, PHASE.GRAB); w.deadline = Date.now() + w.turnSec * 1000; return; }
    if (!w.losersMove || Mini.loserSteps(rank) <= 0) { w.orderAt++; continue; }
    moveShared(room, id, Mini.loserSteps(rank), { loser: true, rank });
    w.orderAt++;
    if (w.goalCount > 0) break;   // 誰かがあがったら、そこで打ち切る
  }
  w.turnId = null;
  w.last = { mini: w.mini && w.mini.id, moves: w.moves, rank: w.miniRank };
  setPhase(room, PHASE.RESULT);
  w.deadline = Date.now() + RESULT_MS;
}

// 1位がサイコロを振る（押していなければサーバーが代わりに振る＝止まらない）
function doGrab(room) {
  const w = room.sugoroku;
  const id = w.turnId;
  const auto = !w.done[id];
  const dice = S.rollDice(rndOf(w));
  moveShared(room, id, dice, { winner: true, dice, auto });
  w.orderAt++;
  // **1位が動かした時点であがったら、そこで終了**（敗者移動は行わない＝勝者が横取りされない）
  if (w.goalCount > 0) {
    w.turnId = null;
    w.last = { mini: w.mini && w.mini.id, moves: w.moves, rank: w.miniRank };
    setPhase(room, PHASE.RESULT);
    w.deadline = Date.now() + RESULT_MS;
    return;
  }
  nextGrab(room);
}

// たった1つの駒を動かす。動かした人が誰かを必ず残す（あがらせた人が勝ちなので）
function moveShared(room, id, steps, info) {
  const w = room.sugoroku;
  const mv = S.applyMove(w.board, w.piece, steps);
  w.piece = mv.to;
  if (mv.coins) w.coins[id] = S.addCoins(w.coins[id], mv.coins);
  const rec = Object.assign(
    { id, name: w.names[id], steps, move: mv, coinsGained: mv.coins || 0 }, info || {});
  if (mv.goal && !w.winnerId) {
    w.winnerId = id;
    w.goalCount = 1;
    rec.goal = true;
  }
  (w.moves = w.moves || []).push(rec);
  return rec;
}

module.exports = {
  PHASE, DEFAULT_TURN_SEC, RESULT_MS, EVENT_MS, EVENT_CHANCE,
  startGame, publicView, privateFor,
  submitAction, submitVote, isAllDone, advance,
  playersOf, expectedMembers, resultView,
  useRandom   // テストから出目と盤を固定するための穴
};
