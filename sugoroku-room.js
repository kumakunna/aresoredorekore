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
//   そうならないよう:
//     ・expectedMembers は「いま手番で、かつ繋がっている人」だけを返す。
//       手番の人が切れると空になり、realtime.js の settleAfterMemberGone が
//       そのまま advance を呼ぶ（＝手番が飛ぶ）。
//     ・手番には必ず期限（turnSec）を置く。時間切れになったら、
//       サーバーがその人のぶんを振って進める。**止まらないことを優先する**。
//     ・手番を渡す相手は、毎回「部屋にいて、まだあがっていない人」から選び直す。
//       名簿から消えた人・あがった人の席で止まらない。

const path = require('path');
const S = require(path.join(__dirname, 'public', 'js', 'sugoroku-logic.js'));

// 進行の段階。ほかのゲームの PHASE とは別物
const PHASE = {
  LOBBY: 'lobby',
  READY: 'ready',     // 盤と自分の持ちものを確認する（全員が1回押す）
  TURN: 'turn',       // 手番の人の操作を待つ
  RESULT: 'result',   // その手番に何が起きたかを、全員で見る
  EVENT: 'event',     // 突然イベント
  ENDED: 'ended'
};

const DEFAULT_TURN_SEC = 90;   // 手番の期限。考える時間としては充分に長く取る
const MIN_TURN_SEC = 15;
const MAX_TURN_SEC = 300;
const RESULT_MS = 2800;        // 駒が動くのを見る間（端末側はタップで飛ばせる）
const EVENT_MS = 3200;
const EVENT_CHANCE = 0.25;     // 一巡ごとに、この確率で突然イベント

// テストから出目と盤を固定するための穴。本番は Math.random のまま使う
let rnd = Math.random;
function useRandom(fn) { rnd = fn || Math.random; }

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
  if (!check.ok) return { ok: false, error: 'bad_player_count', message: check.message };

  const ids = members.map((m) => m.id);
  const w = {
    game: gameId,
    playerIds: ids,
    names: {},
    board: S.makeBoard(gameId, rnd),
    pos: {},
    coins: {},
    goalOrder: {},        // memberId -> あがった順（1始まり）。未到達は undefined
    goalCount: 0,
    turnId: ids[0],
    lap: 1,               // 何巡目か
    turnSec: clampSec(cfg.turnSec),
    phase: PHASE.READY,
    done: {},
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
function expectedMembers(room) {
  const w = room.sugoroku;
  if (!w) return [];
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
// 空の時に true を返すのは意図。手番の人が切れた瞬間に、
// settleAfterMemberGone が advance を呼んで手番を飛ばせるようにする（落とし穴17）
function isAllDone(room) {
  const w = room.sugoroku;
  if (!w) return false;
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
function submitAction(room, memberId, targetId, payload) {
  const w = room.sugoroku;
  if (!w) return { ok: false };
  const act = (payload && payload.act) || null;

  if (w.phase === PHASE.READY) {
    if (w.playerIds.indexOf(memberId) === -1) return { ok: false };
    w.done[memberId] = true;
    return { ok: true, allDone: isAllDone(room) };
  }
  if (w.phase === PHASE.TURN) {
    if (memberId !== w.turnId) return { ok: false };
    const rules = GAME_RULES[w.game] || {};
    if (rules.checkAction && !rules.checkAction(room, memberId, act, payload)) return { ok: false };
    w.done[memberId] = true;
    w.intent = payload || {};
    return { ok: true, allDone: true };
  }
  return { ok: false };
}
// 投票の形をとる操作（てふだの交渉など）。いまのゲームでは使わない
function submitVote(room, memberId, targetId, payload) {
  const w = room.sugoroku;
  if (!w) return { ok: false };
  const rules = GAME_RULES[w.game] || {};
  if (!rules.submitVote) return { ok: false };
  return rules.submitVote(room, memberId, targetId, payload);
}

// ---- 段階を進める ----
// 全員そろった時・時間切れ・手番の人がいなくなった時・進行役が押した時から呼ばれる。
// どこから来ても同じ経路を通す。
function advance(room) {
  const w = room.sugoroku;
  if (!w || w.phase === PHASE.ENDED) return { changed: false };

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
    if (from + step >= order.length) w.lap++;   // 並び順の端を越えた＝一巡した
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
      name: p.name, pos: p.pos, rank: p.rank, tied: p.tied,
      coins: spec.coins ? p.coins : null,
      goaled: p.goalOrder != null
    }))
  };
}

// ---- 突然イベント ----
// 一巡の切れ目にだけ起こす。手番の途中で盤が動くと、
// いま何が起きたのかが混ざって分からなくなる
function maybeEvent(room) {
  const w = room.sugoroku;
  // 効き目が切れる境界は「巡」。手番ごとに切ると、一巡の切れ目で起きたイベントが
  // 次の1人にしか効かず、「この一巡だけ」という説明と食い違う（型2：境界の判断ミス）
  if (w.event && w.lap > w.event.untilLap) w.event = null;
  if (!w.eventsOn) return null;
  if (!atLapEnd(room)) return null;
  if (rnd() >= EVENT_CHANCE) return null;
  const ev = S.pickEvent(w.game, rnd, w.lastEventId);
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
  if (ev.id === 'swap-ends') {
    // 先頭と最後尾が入れかわる。同じマスに複数いる時は、並び順が先の人を選ぶ
    const live = w.playerIds.filter((id) => room.members.has(id) && w.goalOrder[id] == null);
    if (live.length < 2) { ev.applied = false; return; }
    const sorted = live.slice().sort((a, b) => w.pos[b] - w.pos[a]);
    const head = sorted[0];
    const tail = sorted[sorted.length - 1];
    if (head === tail || w.pos[head] === w.pos[tail]) { ev.applied = false; return; }
    const tmp = w.pos[head];
    w.pos[head] = w.pos[tail];
    w.pos[tail] = tmp;
    ev.applied = true;
    ev.detail = { head: w.names[head], tail: w.names[tail] };
  }
  // toll-free は「効いている間、通行料が0」なので、盤には何もしない
  if (ev.id === 'toll-free') ev.applied = true;
}

// =====================================================================
// ゲームごとのルール。共通の芯からは、ここを呼ぶだけ。
// 新しいすごろくを足す時は、この表に1つ足す（共通の芯には手を入れない）。
// =====================================================================
const GAME_RULES = {
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
      const dice = S.rollDice(rnd);
      const live = w.playerIds
        .filter((pid) => room.members.has(pid))
        .map((pid) => ({ id: pid, pos: w.pos[pid] }));
      const rank = S.positionRanks(live)[id] || 99;
      const free = !!(w.event && w.event.id === 'toll-free');
      const out = {
        id, name: w.names[id], dice, rank,
        auto: !!opt.auto, free,
        toll: 0, paid: false, stalled: false, relief: 0,
        move: null, coinsGained: 0, goal: false,
        coinsAfter: 0
      };
      const o = free
        ? { cost: 0, paid: true, stalled: false, relief: 0 }
        : S.tollOutcome(w.coins[id], rank, dice);
      out.toll = o.cost;
      if (o.stalled) {
        // 進めない。ただし責める場面にしない（代わりにコインが入る、を主語にする）
        w.coins[id] = S.addCoins(w.coins[id], o.relief);
        out.stalled = true;
        out.relief = o.relief;
        out.coinsAfter = w.coins[id];
        return out;
      }
      if (o.cost > 0) {
        w.coins[id] = S.addCoins(w.coins[id], -o.cost);
        out.paid = true;
      }
      const mv = S.applyMove(w.board, w.pos[id], dice);
      w.pos[id] = mv.to;
      if (mv.coins) {
        w.coins[id] = S.addCoins(w.coins[id], mv.coins);
        out.coinsGained = mv.coins;
      }
      if (mv.goal && w.goalOrder[id] == null) {
        w.goalCount++;
        w.goalOrder[id] = w.goalCount;
        out.goal = true;
      }
      out.move = mv;
      out.coinsAfter = w.coins[id];
      return out;
    },
    // 先にあがった人の勝ち
    endsNow(room) {
      return room.sugoroku.goalCount > 0;
    }
  }
};

module.exports = {
  PHASE, DEFAULT_TURN_SEC, RESULT_MS, EVENT_MS, EVENT_CHANCE,
  startGame, publicView, privateFor,
  submitAction, submitVote, isAllDone, advance,
  playersOf, expectedMembers, resultView,
  useRandom   // テストから出目と盤を固定するための穴
};
