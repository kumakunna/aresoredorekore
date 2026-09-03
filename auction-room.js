// auction-room.js — 1人1台の「相場オークション」の進行（第38弾で全面的に作り直し）
//
// 設計の芯は bomb-room.js / quiz-room.js / sugoroku-room.js と同じ：
//   ルール（相場・品質・ヒント・得点）は auction-logic.js をそのまま使う。
//   **数字はここに書かない。** 全部 AuctionLogic.RULES から読む。
//   状態はサーバーが持ち、端末は「自分に見せてよいものだけ」を受け取る。
//   このファイルは socket.io を知らない。通知は呼び出し側（realtime.js）が行う。
//
// ======================= 秘密の扱い（門4・いちばん重い） =======================
// **品質（上物／並物／偽物）は、開示の瞬間まで publicView に一度も入らない。**
// 入れた瞬間、大画面を見ている全員に答えが渡る。
// 段階ヒントも「いま開いてよい数まで」しか入れない（先の分は持たせない）。
//
//   もの                        | 本人 | 他 | 大画面 | 公開スナップショット
//   品質                        |  ✕  | ✕ |   ✕   | ✕（鑑定眼で見た品だけ本人に）
//   秘密入札の額（締切前）      |  ○  | ✕ |   ✕   | ✕
//   値踏み予想（開示前）        |  ○  | ✕ |   ✕   | ✕
//   相場・内訳の宣言・開いたヒント|  ○  | ○ |   ○   | ○
//   誰がどのアイテムを使ったか  |  ○  | ○ |   ○   | ○（鑑定眼の対象品だけ✕）
//
// ======================= 段階 =======================
//   preview … 開場と下見。6品が並ぶ。アイテムを1つ選ぶ
//   bid     … 1品ずつ競る
//   confirm … 誰も値をつけなかった時の最終確認（全員が「見送る」で初めて流れる）
//   guess   … 値踏み予想（落札しなかった人）
//   reveal  … 開示（予想 → 品質 → 相場 → 得点）
//   ended   … 決着

const path = require('path');
const AuctionLogic = require(path.join(__dirname, 'public', 'js', 'auction-logic.js'));
const AuctionItems = require(path.join(__dirname, 'public', 'js', 'auction-items.js'));

const R = AuctionLogic.RULES;

const PHASE = {
  LOBBY: 'lobby',
  PREVIEW: 'preview',
  BID: 'bid',
  CONFIRM: 'confirm',
  GUESS: 'guess',
  REVEAL: 'reveal',
  ENDED: 'ended'
};

function playersOf(room) {
  return Array.from(room.members.values()).filter((m) => m.role === 'player');
}
function connectedIds(room, ids) {
  return (ids || []).filter((id) => {
    const m = room.members.get(id);
    return !!(m && m.connected);
  });
}
function now() { return Date.now(); }

// ================= 始める =================
function startGame(room, config, ctx) {
  const members = playersOf(room);
  if (members.length < R.MIN_PLAYERS) {
    return { ok: false, error: 'too_few_players', message: R.MIN_PLAYERS + '人以上必要です' };
  }
  if (members.length > R.MAX_PLAYERS) {
    return { ok: false, error: 'too_many_players', message: R.MAX_PLAYERS + '人までです' };
  }
  const cfg = AuctionLogic.normalizeConfig(config);
  const rnd = (config && config.rnd) || null;
  const ids = members.map((m) => m.id);
  const names = {};
  members.forEach((m) => { names[m.id] = m.name; });

  const w = {
    mode: cfg.mode,
    cfg: cfg,
    preset: (config && config.preset) || null,
    playerIds: ids,
    names: names,
    round: 0,
    totalRounds: cfg.rounds,
    market: AuctionLogic.newMarket(),
    chips: {},
    spent: {},        // このラウンドで使った額（次のラウンドの収入を決める）
    won: {},          // ゲーム通算で落札した品
    power: {},        // このラウンドで選んだアイテム
    powerUsed: {},
    appraised: {},    // 鑑定眼で見た品：{ memberId: { 品番号: 品質 } }
    usedLooks: {},    // ゲーム通算で出た見た目（同じ品を続けて出さない）
    items: [],
    order: [],        // 競る順番（品番号）。流れた品を1回だけ後ろに戻す
    retried: {},      // その品を戻したことがあるか（戻すのは1回だけ）
    idx: 0,
    phase: PHASE.PREVIEW,
    deadline: null,
    bidStartAt: 0,
    bids: {},
    highest: null,
    firstBidder: null,
    passed: {},       // 最終確認で「見送る」を押した人
    guesses: {},
    lastResult: null,
    history: [],
    rnd: rnd,
    recorded: false
  };
  ids.forEach((id) => {
    w.chips[id] = R.START_CHIPS;
    w.spent[id] = 0;
    w.won[id] = [];
    w.appraised[id] = {};
  });
  room.auction = w;
  room.state.phase = PHASE.PREVIEW;
  nextRound(room);
  return { ok: true };
}

// ================= ラウンド =================
function nextRound(room) {
  const w = room.auction;
  w.round += 1;
  if (w.round > w.totalRounds) return finish(room);

  // 相場はラウンドごとに1へ戻す（前のラウンドの熱が持ち越されない）
  w.market = AuctionLogic.newMarket();
  // 収入。使いすぎた人は自動的に息切れする（2ラウンド目以降だけ）
  if (w.round > 1) {
    w.playerIds.forEach((id) => {
      w.chips[id] += AuctionLogic.incomeFor(w.spent[id] || 0);
    });
  }
  w.playerIds.forEach((id) => {
    w.spent[id] = 0;
    w.power[id] = null;      // アイテムは毎ラウンド選び直す
    w.powerUsed[id] = false;
  });

  w.items = AuctionLogic.buildRound(w.usedLooks, w.rnd);
  w.items.forEach((it) => { w.usedLooks[it.look] = true; });
  w.order = w.items.map((it) => it.no);
  w.retried = {};
  w.idx = 0;
  w.lastResult = null;
  setPhase(room, PHASE.PREVIEW, w.cfg.previewSec);
  return true;
}

function setPhase(room, phase, sec) {
  const w = room.auction;
  w.phase = phase;
  room.state.phase = phase;
  w.deadline = sec > 0 ? now() + sec * 1000 : null;
}

function currentItem(room) {
  const w = room.auction;
  const no = w.order[w.idx];
  if (no == null) return null;
  return w.items.find((x) => x.no === no) || null;
}

// ================= 競り =================
function beginBid(room) {
  const w = room.auction;
  w.bids = {};
  w.highest = null;
  w.firstBidder = null;
  w.passed = {};
  w.guesses = {};
  w.bidStartAt = now();
  const sec = (w.mode === 'open') ? R.OPEN_EXTEND_SEC : R.SEALED_BID_SEC;
  setPhase(room, PHASE.BID, sec);
}

// 誰も値をつけなかった。すぐには流さず、最終確認をはさむ
function beginConfirm(room) {
  const w = room.auction;
  w.passed = {};
  setPhase(room, PHASE.CONFIRM, R.GUESS_SEC * 2);
}

// この品を流す。流れた品は「次の品のあと」にもう一度だけ出す
function passItem(room) {
  const w = room.auction;
  const item = currentItem(room);
  if (!item) return;
  const again = !w.retried[item.no];
  if (again) {
    w.retried[item.no] = true;
    // いまの位置の2つ先（＝次の品のあと）へ戻す。末尾を超えるなら末尾へ
    const rest = w.order.length - (w.idx + 1);
    const at = w.idx + 1 + Math.min(1, rest);
    w.order.splice(at, 0, item.no);
  }
  w.lastResult = {
    no: item.no, kind: item.kind, look: item.look,
    passed: true, again: again,
    note: again ? AuctionLogic.TEXT.passedAgain : AuctionLogic.TEXT.passedGone
  };
  w.history.push({ no: item.no, kind: item.kind, passed: true });
  // 流れた品に正体は出さない（誰の手にも渡っていないので、まだ伏せたまま）
  afterItem(room);
}

// 落札が決まった。払って、相場を上げて、値踏みへ
function closeBid(room) {
  const w = room.auction;
  const item = currentItem(room);
  if (!item) return;
  let winnerId = null, amount = 0;
  if (w.mode === 'open') {
    if (w.highest) { winnerId = w.highest.id; amount = w.highest.amount; }
  } else {
    const s = AuctionLogic.settleSealed(
      Object.keys(w.bids).map((id) => ({ id: id, amount: w.bids[id].amount, at: w.bids[id].at }))
    );
    if (s) { winnerId = s.winnerId; amount = s.amount; }
  }
  if (!winnerId) return beginConfirm(room);

  const half = usedPower(w, winnerId) === 'halfticket';
  const paid = AuctionLogic.payFor(amount, half);
  w.chips[winnerId] = Math.max(0, w.chips[winnerId] - paid);
  w.spent[winnerId] = (w.spent[winnerId] || 0) + paid;
  w.won[winnerId].push(item);

  const before = w.market[item.kind];
  AuctionLogic.bumpMarket(w.market, item.kind);

  w.lastResult = {
    no: item.no, kind: item.kind, look: item.look,
    passed: false,
    winnerId: winnerId, winner: w.names[winnerId],
    bid: amount, paid: paid, half: half,
    marketBefore: before, marketAfter: w.market[item.kind],
    // 品質と正体は、開示の段階になるまで入れない（publicView も見ている）
    revealed: false
  };
  setPhase(room, PHASE.GUESS, R.GUESS_SEC);
}

// 値踏みを締めて、開示へ
function beginReveal(room) {
  const w = room.auction;
  const item = currentItem(room);
  const lr = w.lastResult || {};
  const points = AuctionLogic.itemPoints(item, w.market);
  // 予想の答え合わせ。当てた人にチップを配る（外しても何も失わない）
  const guessRows = [];
  Object.keys(w.guesses).forEach((id) => {
    const g = w.guesses[id];
    const got = AuctionLogic.guessReward(g, item.quality);
    if (got) w.chips[id] += got;
    guessRows.push({ id: id, name: w.names[id], guess: g, hit: !!got });
  });
  w.lastResult = Object.assign({}, lr, {
    revealed: true,
    quality: item.quality,
    reveal: item.reveal,
    points: points,
    guesses: guessRows
  });
  w.history.push({
    no: item.no, kind: item.kind, quality: item.quality,
    winner: lr.winner, points: points, guesses: guessRows, passed: false
  });
  setPhase(room, PHASE.REVEAL, R.REVEAL_SEC);
}

function afterItem(room) {
  const w = room.auction;
  w.idx += 1;
  if (w.idx >= w.order.length) {
    if (w.round >= w.totalRounds) return finish(room);
    return nextRound(room);
  }
  beginBid(room);
}

// ================= 決着 =================
function finish(room) {
  const w = room.auction;
  w.phase = PHASE.ENDED;
  room.state.phase = PHASE.ENDED;
  w.deadline = null;
  w.endedAt = now();
  w.result = resultView(room);
  return true;
}

function resultView(room) {
  const w = room.auction;
  if (!w) return { ranking: [] };
  const rows = w.playerIds.map((id) => {
    const s = AuctionLogic.scoreOf(w.won[id], w.market, w.chips[id]);
    return {
      id: id, name: w.names[id], score: s.total,
      fromItems: s.fromItems, fromChips: s.fromChips,
      chips: w.chips[id], items: w.won[id].length
    };
  });
  return {
    ranking: AuctionLogic.rank(rows),
    market: Object.assign({}, w.market),
    highlight: AuctionLogic.highlight(w.history)
  };
}

// ================= 公開してよい情報だけ =================
// **ここに品質・正体・まだ開いていないヒント・締切前の入札額・開示前の予想を入れない。**
// 入れたら、大画面を見ている全員に答えが渡る
function publicView(room) {
  const w = room.auction;
  if (!w) return { phase: PHASE.LOBBY };
  const item = currentItem(room);
  const elapsed = Math.max(0, Math.floor((now() - w.bidStartAt) / 1000));
  const showHints = (w.phase === PHASE.BID || w.phase === PHASE.CONFIRM ||
                     w.phase === PHASE.GUESS || w.phase === PHASE.REVEAL);

  const out = {
    phase: w.phase,
    mode: w.mode,
    round: w.round,
    totalRounds: w.totalRounds,
    remainingMs: w.deadline ? Math.max(0, w.deadline - now()) : 0,
    market: Object.assign({}, w.market),
    hotKinds: AuctionItems.KINDS.filter((k) => AuctionLogic.isHot(w.market, k.id)).map((k) => k.id),
    mixLine: AuctionLogic.mixLine(),
    // 棚に並ぶ全品。**系統と見た目と順番だけ。品質は入れない**
    lineup: w.items.map((it) => ({
      no: it.no, kind: it.kind, look: it.look,
      sold: soldStateOf(w, it.no)
    })),
    order: w.order.slice(),
    idx: w.idx,
    players: w.playerIds.map((id) => ({
      id: id, name: w.names[id],
      connected: !!(room.members.get(id) || {}).connected,
      chips: w.chips[id],
      items: w.won[id].length,
      // 誰がどのアイテムを使ったかは公開（使ったこと自体が情報になる）
      power: w.power[id] || null,
      powerUsed: !!w.powerUsed[id]
    }))
  };

  if (item) {
    out.item = {
      no: item.no, kind: item.kind, look: item.look,
      // 開いた数まで。**先のヒントは持たせない**
      hints: showHints ? AuctionLogic.hintsVisible(item, elapsed) : [item.look]
    };
  }

  if (w.phase === PHASE.BID || w.phase === PHASE.CONFIRM) {
    if (w.mode === 'open') {
      // せり上げ式の最高額は、公開が遊びの芯なので出す
      out.highest = w.highest ? { name: w.names[w.highest.id], amount: w.highest.amount } : null;
    } else {
      // 秘密入札は「出したこと」だけ。額は締め切るまで出さない
      out.doneNames = Object.keys(w.bids).map((id) => w.names[id]);
    }
    out.firstBidder = w.firstBidder ? w.names[w.firstBidder] : null;
  }
  if (w.phase === PHASE.CONFIRM) {
    out.passedNames = Object.keys(w.passed).map((id) => w.names[id]);
    out.waitingPass = connectedIds(room, w.playerIds)
      .filter((id) => !w.passed[id]).map((id) => w.names[id]);
  }
  if (w.phase === PHASE.GUESS) {
    // 誰が予想を出したかは見せてよい。**中身は開示まで出さない**
    out.guessDoneNames = Object.keys(w.guesses).map((id) => w.names[id]);
    out.lastResult = safeResult(w.lastResult, false);
  }
  if (w.phase === PHASE.REVEAL) {
    out.lastResult = safeResult(w.lastResult, true);
  }
  if (w.phase === PHASE.ENDED) {
    out.result = w.result || resultView(room);
  }
  return out;
}

// 落札の結果。開示前は、品質・正体・予想の中身を落とす
function safeResult(lr, revealed) {
  if (!lr) return null;
  const out = {
    no: lr.no, kind: lr.kind, look: lr.look,
    passed: !!lr.passed, again: !!lr.again, note: lr.note || null,
    winner: lr.winner || null, bid: lr.bid || 0, paid: lr.paid || 0, half: !!lr.half,
    marketBefore: lr.marketBefore, marketAfter: lr.marketAfter
  };
  if (revealed && lr.revealed) {
    out.quality = lr.quality;
    out.reveal = lr.reveal;
    out.points = lr.points;
    out.guesses = lr.guesses || [];
  }
  return out;
}

// その品が売れたかどうか（棚の一覧に出す。品質は出さない）
function soldStateOf(w, no) {
  for (let i = 0; i < w.history.length; i++) {
    const h = w.history[i];
    if (h.no === no && !h.passed) return 'sold';
  }
  return (w.order.indexOf(no) > w.idx) ? 'waiting'
    : (w.order[w.idx] === no ? 'now' : 'waiting');
}

// ================= その人だけに届くもの =================
function privateFor(room, memberId) {
  const w = room.auction;
  if (!w || w.playerIds.indexOf(memberId) === -1) return null;
  const item = currentItem(room);
  const out = {
    phase: w.phase,
    round: w.round,
    chips: w.chips[memberId],
    power: w.power[memberId] || null,
    powerUsed: !!w.powerUsed[memberId],
    powers: AuctionLogic.POWERS,
    // 鑑定眼で見た品だけ、本人にだけ品質を渡す
    appraised: Object.assign({}, w.appraised[memberId]),
    won: (w.won[memberId] || []).map((it) => ({ no: it.no, kind: it.kind, look: it.look })),
    // 自分の秘密入札は自分にだけ見える
    myBid: (w.bids[memberId] && w.bids[memberId].amount != null) ? w.bids[memberId].amount : null,
    myGuess: w.guesses[memberId] || null,
    passed: !!w.passed[memberId]
  };
  if (item && w.phase === PHASE.GUESS) {
    // 落札した本人は予想しない（自分の品を当てても意味がない）
    out.canGuess = !(w.lastResult && w.lastResult.winnerId === memberId);
  }
  return out;
}

function usedPower(w, id) {
  return w.powerUsed[id] ? w.power[id] : null;
}

// ================= 操作 =================
/**
 * アイテムを選ぶ・使う。
 *   { pick:'appraise' }              … このラウンドのアイテムを決める（下見の間だけ）
 *   { use:true, targetNo:3 }         … 鑑定眼：その品の品質を自分だけ知る
 *   { use:true, targetKind:'tsubo' } … 相場操作：その系統の相場を+1
 *   { use:true }                     … 半額チケット：次に落札した時に効く
 *   { pass:true }                    … 最終確認で「見送る」
 */
function submitAction(room, memberId, targetId, payload) {
  const w = room.auction;
  if (!w || w.phase === PHASE.ENDED) return { ok: false, error: 'not_playing' };
  if (w.playerIds.indexOf(memberId) === -1) return { ok: false, error: 'not_player' };
  const p = payload || {};

  if (p.pass) {
    if (w.phase !== PHASE.CONFIRM) return { ok: false, error: 'not_confirm' };
    w.passed[memberId] = true;
    const waiting = connectedIds(room, w.playerIds).filter((id) => !w.passed[id]);
    return { ok: true, allDone: waiting.length === 0 };
  }

  if (p.pick) {
    if (w.phase !== PHASE.PREVIEW) return { ok: false, error: 'not_preview' };
    if (!AuctionLogic.powerById(p.pick)) return { ok: false, error: 'unknown_power' };
    w.power[memberId] = p.pick;
    w.powerUsed[memberId] = false;
    const waiting = connectedIds(room, w.playerIds).filter((id) => !w.power[id]);
    return { ok: true, allDone: waiting.length === 0 };
  }

  if (p.use) {
    const pw = w.power[memberId];
    if (!pw) return { ok: false, error: 'no_power' };
    if (w.powerUsed[memberId]) return { ok: false, error: 'already_used' };
    if (pw === 'appraise') {
      const it = w.items.find((x) => x.no === p.targetNo);
      if (!it) return { ok: false, error: 'unknown_item' };
      w.appraised[memberId][it.no] = it.quality;   // **本人にだけ**
      w.powerUsed[memberId] = true;
      return { ok: true };
    }
    if (pw === 'market') {
      if (!AuctionItems.kindById(p.targetKind)) return { ok: false, error: 'unknown_kind' };
      AuctionLogic.bumpMarket(w.market, p.targetKind);
      w.powerUsed[memberId] = true;
      return { ok: true };
    }
    if (pw === 'halfticket') {
      // 使うと宣言しておき、次に落札できた時に効く
      w.powerUsed[memberId] = true;
      return { ok: true };
    }
    return { ok: false, error: 'unknown_power' };
  }

  return { ok: false, error: 'unknown_action' };
}

/**
 * 入札と値踏み予想。
 *   { amount: 7 }        … 入札（せり上げ式・秘密入札とも）
 *   { guess: 'fine' }    … 値踏み予想
 */
function submitVote(room, memberId, targetId, payload) {
  const w = room.auction;
  if (!w || w.phase === PHASE.ENDED) return { ok: false, error: 'not_playing' };
  if (w.playerIds.indexOf(memberId) === -1) return { ok: false, error: 'not_player' };
  const p = payload || {};

  if (p.guess !== undefined) {
    if (w.phase !== PHASE.GUESS) return { ok: false, error: 'not_guess' };
    if (w.lastResult && w.lastResult.winnerId === memberId) {
      return { ok: false, error: 'winner_cannot_guess' };
    }
    if (!AuctionItems.qualityById(p.guess)) return { ok: false, error: 'unknown_quality' };
    w.guesses[memberId] = p.guess;
    // 予想しない自由もあるので、全員そろうのは待たない（時間で締める）
    return { ok: true };
  }

  if (p.amount === undefined) return { ok: false, error: 'unknown_action' };
  // 最終確認の最中でも入札できる（それが「最後のひと押し」の意味）
  if (w.phase !== PHASE.BID && w.phase !== PHASE.CONFIRM) {
    return { ok: false, error: 'not_bid' };
  }
  const chk = AuctionLogic.canBid(w.mode, p.amount, w.chips[memberId], w.highest);
  if (!chk.ok) return { ok: false, error: chk.reason };

  // 最初に値をつけた人へのごほうび。1つの品につき1人だけ
  let bonus = 0;
  if (!w.firstBidder && chk.amount > 0) {
    w.firstBidder = memberId;
    bonus = R.FIRST_BID_BONUS;
    w.chips[memberId] += bonus;
  }

  if (w.mode === 'open') {
    if (chk.amount > 0) {
      w.highest = { id: memberId, amount: chk.amount };
      // 値がついたら締め切りを延ばす（吊り上がっている間は終わらない）
      setPhase(room, PHASE.BID, R.OPEN_EXTEND_SEC);
    }
  } else {
    w.bids[memberId] = { amount: chk.amount, at: now() };
    if (w.phase === PHASE.CONFIRM && chk.amount > 0) {
      // 最終確認から入札が出たら、競りに戻す
      setPhase(room, PHASE.BID, R.SEALED_BID_SEC);
    }
    // 秘密入札は「全員が出したら締める」。
    // 出し終えた人を締め切りまで待たせるのは、ただの死に時間になる
    // （降りる人も0を出すので、「出さない人」は残らない）。
    // ※これはこの段階に限った話。段階の意味はゲームごとに違うので、
    //   共通の芯には入れない（落とし穴22）
    if (w.phase === PHASE.BID) {
      const waiting = connectedIds(room, w.playerIds).filter((id) => !w.bids[id]);
      if (waiting.length === 0) return { ok: true, bonus: bonus, allDone: true };
    }
  }
  return { ok: true, bonus: bonus };
}

// ================= 進める =================
// 締め切りが来た時と、全員そろった時に呼ばれる
function advance(room) {
  const w = room.auction;
  if (!w || w.phase === PHASE.ENDED) return false;
  switch (w.phase) {
    case PHASE.PREVIEW:
      // アイテムを選んでいない人には、いちばん素直なもの（鑑定眼）を配る。
      // 「選ばなかったから何も無い」だと、寝落ちした人が一方的に不利になる
      w.playerIds.forEach((id) => { if (!w.power[id]) w.power[id] = AuctionLogic.POWERS[0].id; });
      beginBid(room);
      return true;
    case PHASE.BID: {
      const any = (w.mode === 'open')
        ? !!w.highest
        : Object.keys(w.bids).some((id) => w.bids[id].amount > 0);
      if (any) closeBid(room); else beginConfirm(room);
      return true;
    }
    case PHASE.CONFIRM: {
      const any = (w.mode === 'open')
        ? !!w.highest
        : Object.keys(w.bids).some((id) => w.bids[id].amount > 0);
      if (any) closeBid(room); else passItem(room);
      return true;
    }
    case PHASE.GUESS:
      beginReveal(room);
      return true;
    case PHASE.REVEAL:
      afterItem(room);
      return true;
    default:
      return false;
  }
}

// 誰が「まだ」なのか（待機の表示に使う）
function expectedMembers(room) {
  const w = room.auction;
  if (!w) return [];
  if (w.phase === PHASE.PREVIEW) {
    return connectedIds(room, w.playerIds).filter((id) => !w.power[id]);
  }
  if (w.phase === PHASE.CONFIRM) {
    return connectedIds(room, w.playerIds).filter((id) => !w.passed[id]);
  }
  return [];
}

/**
 * 全員が切れたら締める。
 * 「全員が終わる」段階は下見と最終確認だけなので、そこは待つ相手の数え直しに任せ、
 * ここでは「まだ繋がっている人がいるか」だけを見る（落とし穴17）
 */
function isAllDone(room) {
  const w = room.auction;
  if (!w || w.phase === PHASE.ENDED) return false;
  if (connectedIds(room, w.playerIds).length === 0) return true;
  if (w.phase === PHASE.PREVIEW || w.phase === PHASE.CONFIRM) {
    return expectedMembers(room).length === 0;
  }
  return false;
}

// 記録を書く側（realtime.js）から参照する。数字を書き写さないための出口
const START_CHIPS = R.START_CHIPS;

module.exports = {
  PHASE, START_CHIPS,
  startGame, publicView, privateFor,
  submitAction, submitVote, isAllDone, advance,
  playersOf, expectedMembers, resultView
};
