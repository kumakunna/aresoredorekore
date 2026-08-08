// auction-room.js — 1人1台の「オークションバトル」の進行（第31弾 第3部）
//
// 設計の芯は bomb-room.js / defuse-room.js / quiz-room.js とまったく同じ:
//   ルール（入札・落札・アイテムの効き方・救済）は auction-logic.js をそのまま使う。
//   状態はサーバーが持ち、各端末は「自分に見せてよいものだけ」を受け取る。
//   このファイルは socket.io を知らない。通知は呼び出し側（realtime.js）が行う。
//
// 2つの遊び方を1つの進行で扱う:
//   せり上げ式（open）  … 値が公開で吊り上がる。最後の入札から一定時間で締める
//   秘密入札（sealed）  … それぞれこっそり出して、締め切りで一斉に開ける
//
//   違うのは「入札の段階で、何を公開するか」と「いつ締めるか」だけ。
//   そこだけ分け、残り（品物・アイテム・支払い・救済・順位）は1本にしてある。
//
// ---- 秘密の扱い（原則4.3）----
//   ・品物の正体・価値・階層・ヒントは、落札が決まるまで publicView に入れない。
//     入れたら、大画面を見ている全員に答えが配られる。
//   ・鑑定眼で引いたヒントは、買った本人の privateFor にだけ入れる。
//   ・秘密入札の金額は、締め切るまで本人以外に配らない。
//     せり上げ式の最高額は、公開が遊びの芯なので出してよい。

const path = require('path');
const AuctionLogic = require(path.join(__dirname, 'public', 'js', 'auction-logic.js'));
const AuctionItems = require(path.join(__dirname, 'public', 'js', 'auction-items.js'));

const PHASE = {
  LOBBY: 'lobby',
  SHOW: 'show',     // 品物が出る。アイテムを買う・使う（入札の前）
  BID: 'bid',       // 入札
  RESULT: 'result', // 落札者・正体・収支
  ENDED: 'ended'
};

const MIN_PLAYERS = 2;
// 品物を見てアイテムを選ぶ時間。全員が「いいよ」を押せば、待たずに進む
const SHOW_SEC = 25;

function playersOf(room) {
  return Array.from(room.members.values()).filter((m) => m.role === 'player');
}
function connectedIds(room, ids) {
  return (ids || []).filter((id) => {
    const m = room.members.get(id);
    return !!(m && m.connected);
  });
}

// ================= 始める =================
function startGame(room, config, ctx) {
  const members = playersOf(room);
  if (members.length < MIN_PLAYERS) {
    return { ok: false, error: 'too_few_players', message: MIN_PLAYERS + '人以上必要です' };
  }
  const cfg = AuctionLogic.normalizeConfig(config);
  const rnd = (config && config.rnd) || null;
  const ids = members.map((m) => m.id);

  const w = {
    mode: cfg.mode,
    cfg: cfg,
    preset: cfg.preset || null,
    playerIds: ids,
    names: {},
    chips: {},
    inventory: {},   // id -> { itemId: 個数 }
    active: {},      // id -> { halfticket:bool, doubleup:bool }（このラウンドで使う宣言）
    seenHints: {},   // id -> このラウンドで見たヒント
    rnd: rnd,

    round: 0,
    totalRounds: cfg.rounds,
    usedItems: {},   // 出した品物（続けて出さない）
    item: null,      // 秘密。teaser 以外は publicView に入れない
    ready: {},
    bids: {},        // id -> { amount, at }
    lastResult: null,
    rescueNote: null,

    phase: PHASE.SHOW,
    startedAt: Date.now(),
    deadline: null,
    endedAt: null,
    result: null,
    recorded: false
  };
  members.forEach((m) => {
    w.names[m.id] = m.name;
    w.chips[m.id] = cfg.startChips;
    w.inventory[m.id] = {};
    w.active[m.id] = {};
    w.seenHints[m.id] = [];
  });

  room.auction = w;
  room.state.game = 'auction';
  if (!nextRound(room)) {
    return { ok: false, error: 'no_items', message: '品物がありません' };
  }
  room.state.phase = w.phase;
  return { ok: true };
}

// ---- ラウンドの入れ替え ----
function nextRound(room) {
  const w = room.auction;
  w.round++;
  if (w.round > w.totalRounds) { finish(room, { cause: 'rounds' }); return true; }

  const picked = AuctionItems.pickItems(1, w.usedItems, w.rnd);
  if (!picked.length) return false;
  w.item = picked[0];
  w.usedItems[AuctionItems.keyOf(w.item)] = true;

  w.ready = {};
  w.bids = {};
  w.lastResult = null;
  w.playerIds.forEach((id) => {
    w.active[id] = {};
    w.seenHints[id] = [];
  });

  // 救済：2ラウンドごとに、その時点で最下位の人へ無料アイテムを1つ
  w.rescueNote = null;
  if (w.cfg.rescue) {
    const rows = w.playerIds.map((id) => ({ id: id, chips: w.chips[id] }));
    const targets = AuctionLogic.rescueTargets(rows, w.round - 1);
    if (targets.length) {
      const given = [];
      targets.forEach((id) => {
        const itemId = AuctionLogic.rescueItemFor(w.mode, w.rnd);
        w.inventory[id][itemId] = (w.inventory[id][itemId] || 0) + 1;
        given.push({ name: w.names[id], item: AuctionLogic.itemById(itemId).name });
      });
      w.rescueNote = given;
    }
  }

  w.phase = PHASE.SHOW;
  w.deadline = Date.now() + SHOW_SEC * 1000;
  return true;
}

function beginBid(room) {
  const w = room.auction;
  w.phase = PHASE.BID;
  w.bids = {};
  w.deadline = Date.now() +
    (w.mode === AuctionLogic.MODE.OPEN ? w.cfg.extendSec : w.cfg.bidSec) * 1000;
}

// ---- 落札と支払い ----
function closeBid(room) {
  const w = room.auction;
  const bids = Object.keys(w.bids).map((id) => ({
    id: id, amount: w.bids[id].amount, at: w.bids[id].at
  }));
  const won = AuctionLogic.settleBids(bids);
  const item = w.item;

  if (!won) {
    // 誰も入札しなければ、品物は流れる（誰も損をしない）
    w.lastResult = {
      passed: true, teaser: item.teaser, reveal: item.reveal,
      tier: item.tier, value: item.value
    };
  } else {
    const used = w.active[won.winnerId] || {};
    const paid = AuctionLogic.settlePayment(won.amount, item, used);
    w.chips[won.winnerId] = w.chips[won.winnerId] - paid.paid + paid.value;
    w.lastResult = {
      passed: false,
      winnerId: won.winnerId, winner: w.names[won.winnerId],
      bid: won.amount, paid: paid.paid, value: paid.value, delta: paid.delta,
      halfticket: !!used.halfticket, doubleup: !!used.doubleup,
      teaser: item.teaser, reveal: item.reveal, tier: item.tier,
      chipsAfter: w.chips[won.winnerId]
    };
  }
  w.phase = PHASE.RESULT;
  w.deadline = Date.now() + AuctionLogic.REVEAL_SEC * 1000;
}

function finish(room, result) {
  const w = room.auction;
  w.phase = PHASE.ENDED;
  room.state.phase = PHASE.ENDED;
  w.endedAt = Date.now();
  w.deadline = null;
  w.item = null;
  w.result = Object.assign({}, w.result || {}, result || {});
  return true;
}

// ================= 公開してよい情報だけ =================
// 品物の正体・価値・階層・ヒントは、落札が決まるまでここに入れない。
function publicView(room) {
  const w = room.auction;
  if (!w) return { phase: PHASE.LOBBY };
  const out = {
    phase: w.phase,
    mode: w.mode,
    round: w.round,
    totalRounds: w.totalRounds,
    remainingMs: w.deadline ? Math.max(0, w.deadline - Date.now()) : null,
    rescueNote: w.rescueNote,
    players: w.playerIds.map((id) => {
      const m = room.members.get(id);
      return {
        id: id,
        name: w.names[id],
        connected: !!(m && m.connected),
        chips: w.chips[id],
        // 持っているアイテムの数だけは公開（何を買ったかは駆け引きの材料になる）
        items: Object.keys(w.inventory[id]).reduce((s, k) => s + w.inventory[id][k], 0)
      };
    })
  };
  // 出ている品物は「謎めいた一言」だけ。正体も価値も入れない
  if (w.item && w.phase !== PHASE.ENDED) out.teaser = w.item.teaser;

  if (w.phase === PHASE.SHOW) {
    out.waiting = connectedIds(room, w.playerIds)
      .filter((id) => !w.ready[id]).map((id) => w.names[id]);
  }
  if (w.phase === PHASE.BID) {
    if (w.mode === AuctionLogic.MODE.OPEN) {
      // せり上げ式は、いくらまで上がっているかが遊びの芯なので公開する
      const bids = Object.keys(w.bids).map((id) => ({
        id: id, amount: w.bids[id].amount, at: w.bids[id].at
      }));
      const top = AuctionLogic.settleBids(bids);
      out.highest = top ? { name: w.names[top.winnerId], amount: top.amount } : null;
    } else {
      // 秘密入札は、金額を出さない。出した人が誰かだけ
      out.doneNames = Object.keys(w.bids).map((id) => w.names[id]);
      out.waiting = connectedIds(room, w.playerIds)
        .filter((id) => !w.bids[id]).map((id) => w.names[id]);
    }
  }
  if (w.phase === PHASE.RESULT) out.lastResult = w.lastResult;
  if (w.phase === PHASE.ENDED) out.result = resultView(room);
  return out;
}

// ================= その端末だけに配る情報 =================
function privateFor(room, memberId) {
  const w = room.auction;
  if (!w) return null;
  if (w.playerIds.indexOf(memberId) === -1) return null; // 大画面・観戦には配らない
  const inv = w.inventory[memberId] || {};
  const out = {
    phase: w.phase,
    mode: w.mode,
    chips: w.chips[memberId],
    round: w.round,
    totalRounds: w.totalRounds,
    remainingMs: w.deadline ? Math.max(0, w.deadline - Date.now()) : null,
    // 買えるアイテムと、持っているアイテム
    shop: AuctionLogic.itemsFor(w.mode).map((x) => ({
      id: x.id, name: x.name, icon: x.icon, cost: x.cost, lead: x.lead,
      afford: w.chips[memberId] >= x.cost
    })),
    inventory: AuctionLogic.itemsFor(w.mode).map((x) => ({
      id: x.id, name: x.name, icon: x.icon, count: inv[x.id] || 0
    })).filter((x) => x.count > 0),
    active: Object.assign({}, w.active[memberId] || {}),
    // 鑑定眼で引いたヒントは、買った本人にだけ
    hints: (w.seenHints[memberId] || []).slice(),
    ready: !!w.ready[memberId]
  };
  if (w.item && w.phase !== PHASE.ENDED) out.teaser = w.item.teaser;
  if (w.phase === PHASE.BID) {
    out.myBid = w.bids[memberId] ? w.bids[memberId].amount : null;
    out.canRetract = w.mode === AuctionLogic.MODE.SEALED && (inv.retract || 0) > 0;
  }
  if (w.phase === PHASE.RESULT) out.lastResult = w.lastResult;
  if (w.phase === PHASE.ENDED) out.result = resultView(room);
  return out;
}

function resultView(room) {
  const w = room.auction;
  return {
    mode: w.mode,
    rounds: w.totalRounds,
    cause: (w.result && w.result.cause) || null,
    ranking: AuctionLogic.rank(w.playerIds.map((id) => ({
      id: id, name: w.names[id], chips: w.chips[id]
    })))
  };
}

// ================= 操作 =================
/**
 * 入札の前にするボタン。
 *   'buy:<アイテムid>'  … 買う
 *   'use:<アイテムid>'  … このラウンドで使う宣言（半額・2倍）／鑑定眼はその場で効く
 *   'ready'             … 品物を見終わった
 *   'retract'           … 秘密入札で、出した金額を取り消す
 */
function submitAction(room, memberId, targetId, payload) {
  const w = room.auction;
  if (!w) return { ok: false, error: 'not_started' };
  if (w.playerIds.indexOf(memberId) === -1) return { ok: false, error: 'not_expected' };
  const id = String(targetId == null ? '' : targetId);

  if (id === 'ready') {
    if (w.phase !== PHASE.SHOW) return { ok: false, error: 'wrong_phase' };
    w.ready[memberId] = true;
    // 全員が見終わったら、待たずに入札へ
    const waiting = connectedIds(room, w.playerIds).filter((x) => !w.ready[x]);
    if (!waiting.length) beginBid(room);
    return { ok: true, allDone: false };
  }

  if (id === 'retract') {
    if (w.phase !== PHASE.BID) return { ok: false, error: 'wrong_phase' };
    if (w.mode !== AuctionLogic.MODE.SEALED) return { ok: false, error: 'open_mode' };
    if (!w.bids[memberId]) return { ok: false, error: 'no_bid' };
    if ((w.inventory[memberId].retract || 0) <= 0) return { ok: false, error: 'no_item' };
    w.inventory[memberId].retract--;
    delete w.bids[memberId];
    return { ok: true, allDone: false };
  }

  const buy = id.indexOf('buy:') === 0 ? id.slice(4) : null;
  if (buy) {
    if (w.phase !== PHASE.SHOW) return { ok: false, error: 'wrong_phase' };
    const item = AuctionLogic.itemById(buy);
    if (!item) return { ok: false, error: 'unknown_item' };
    if (AuctionLogic.itemsFor(w.mode).indexOf(item) === -1) {
      return { ok: false, error: 'not_in_mode' };
    }
    if (w.chips[memberId] < item.cost) return { ok: false, error: 'too_poor' };
    w.chips[memberId] -= item.cost;
    w.inventory[memberId][buy] = (w.inventory[memberId][buy] || 0) + 1;
    return { ok: true, allDone: false };
  }

  const use = id.indexOf('use:') === 0 ? id.slice(4) : null;
  if (use) {
    if (w.phase !== PHASE.SHOW) return { ok: false, error: 'wrong_phase' };
    if ((w.inventory[memberId][use] || 0) <= 0) return { ok: false, error: 'no_item' };
    if (use === 'appraise') {
      const hint = AuctionLogic.hintFor(w.item, w.seenHints[memberId]);
      if (!hint) return { ok: false, error: 'no_more_hints' };
      w.inventory[memberId].appraise--;
      w.seenHints[memberId].push(hint);
      return { ok: true, allDone: false, hint: hint };
    }
    if (use !== 'halfticket' && use !== 'doubleup') return { ok: false, error: 'not_usable' };
    if (w.active[memberId][use]) return { ok: false, error: 'already_using' };
    w.inventory[memberId][use]--;
    w.active[memberId][use] = true;
    return { ok: true, allDone: false };
  }

  return { ok: false, error: 'unknown_action' };
}

/**
 * 入札する。targetId は金額。
 * せり上げ式では、値が上がるたびに締め切りを延ばす（競り市の「他にいませんか？」）。
 */
function submitVote(room, memberId, targetId, payload) {
  const w = room.auction;
  if (!w) return { ok: false, error: 'not_started' };
  if (w.phase !== PHASE.BID) return { ok: false, error: 'wrong_phase' };
  if (w.playerIds.indexOf(memberId) === -1) return { ok: false, error: 'not_expected' };

  // 0 も「降りる」という意味のある入札なので、payload から取り直す
  const raw = (payload && Object.prototype.hasOwnProperty.call(payload, 'targetId'))
    ? payload.targetId : targetId;

  const bids = Object.keys(w.bids).map((id) => ({
    id: id, amount: w.bids[id].amount, at: w.bids[id].at
  }));
  const top = AuctionLogic.settleBids(bids);
  const check = AuctionLogic.canBid(raw, {
    chips: w.chips[memberId],
    mode: w.mode,
    highest: top ? top.amount : 0
  });
  if (!check.ok) return { ok: false, error: check.reason };

  // 秘密入札は出し直せない（撤回権を使った時だけ消える）
  if (w.mode === AuctionLogic.MODE.SEALED && w.bids[memberId]) {
    return { ok: false, error: 'already_bid' };
  }

  w.bids[memberId] = { amount: check.amount, at: Date.now() };

  if (w.mode === AuctionLogic.MODE.OPEN) {
    // 値が動いたので、締め切りを延ばす
    w.deadline = Date.now() + w.cfg.extendSec * 1000;
  } else {
    // 全員が出したら、待たずに開ける
    const waiting = connectedIds(room, w.playerIds).filter((x) => !w.bids[x]);
    if (!waiting.length) closeBid(room);
  }
  return { ok: true, allDone: false };
}

// ================= 時間で動くところ =================
function advance(room) {
  const w = room.auction;
  if (!w || w.phase === PHASE.ENDED) return { changed: false };
  const now = Date.now();
  if (!w.deadline || now < w.deadline) return { changed: false };

  if (w.phase === PHASE.SHOW) { beginBid(room); }
  else if (w.phase === PHASE.BID) { closeBid(room); }
  else if (w.phase === PHASE.RESULT) { nextRound(room); }
  room.state.phase = w.phase;
  return { changed: true };
}

function expectedMembers(room) {
  const w = room.auction;
  if (!w) return [];
  if (w.phase === PHASE.SHOW) {
    return connectedIds(room, w.playerIds).filter((id) => !w.ready[id]);
  }
  if (w.phase === PHASE.BID && w.mode === AuctionLogic.MODE.SEALED) {
    return connectedIds(room, w.playerIds).filter((id) => !w.bids[id]);
  }
  return [];
}

/**
 * 全員が切れたら締める。オークションに「全員が終わる」段階は無いので、
 * 見ているのは「まだ繋がっている人がいるか」だけ。
 */
function isAllDone(room) {
  const w = room.auction;
  if (!w || w.phase === PHASE.ENDED) return false;
  return connectedIds(room, w.playerIds).length === 0;
}

module.exports = {
  PHASE, MIN_PLAYERS, SHOW_SEC,
  startGame, publicView, privateFor,
  submitAction, submitVote, isAllDone, advance,
  playersOf, expectedMembers, resultView
};
