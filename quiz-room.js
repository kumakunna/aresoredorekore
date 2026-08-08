// quiz-room.js — カセット「クイズ王」4ゲームの進行（第30弾 第1部・第2部）
//
// 設計の芯は bomb-room.js / defuse-room.js とまったく同じ:
//   ルール（得点・順番・伏せ字・組み合わせ）は quiz-logic.js をそのまま使い、作り直さない。
//   状態はサーバーが持ち、各端末は「自分に見せてよいものだけ」を受け取る。
//   このファイルは socket.io を知らない。通知は呼び出し側（realtime.js）が行う。
//
// ---- なぜ4ゲームで1つの進行役なのか（判断の記録） ----
// 「得点を足す」「順番を回す」「時間で締める」「決着したら順位を出す」は4つとも同じ。
// 別々のファイルにすると、片方だけ直してもう片方に反映し忘れる事故が必ず起きる。
// 違うのは「1問をどう出して、どう締めるか」だけなので、そこだけ variant で分けた。
//
// ---- 秘密の扱い（原則4.3）----
//   ・正解の位置（correct）は、どの端末にも一度も送らない。判定はここでしか行わない。
//   ・つぎつぎクイズの「正解の一覧」も送らない（送ったら答えを読むだけの遊びになる）。
//   ・とくとくクイズは、伏せ字にしたあとの文字列だけを送る。
//     元の問題文を送って端末側で隠すと、通信を覗くだけで丸見えになる。
//
//   端末へ配るものに correct という名前は使わない（当たったかどうかは hit、
//   正解した数は hits）。こうしておくと「配ったものに correct が無い」ことを
//   テストが1行で見張れる。うっかり正解の位置を混ぜたら、そこで赤くなる。
//
// ---- ゲーム中にAIは呼ばない（第29弾-6の方針）----
//   出題はすべて quiz-bank.js から。

const path = require('path');
const QuizLogic = require(path.join(__dirname, 'public', 'js', 'quiz-logic.js'));
const QuizBank = require(path.join(__dirname, 'public', 'js', 'quiz-bank.js'));

const PHASE = {
  LOBBY: 'lobby',
  PLAY: 'play',
  BREAK: 'break',   // ラウンドの切れ目・対戦の切れ目。結果を見せてから次へ
  ENDED: 'ended'
};

const V = QuizLogic.VARIANT;

// 人数の下限。早押しトーナメントだけは対戦なので2人必要（他も2人から）
const MIN_PLAYERS = 2;

// クイズラッシュのラウンドは、いつまでも続かないように上限を置く
const MAX_ROUNDS = 15;
// ラウンドの結果・対戦の結果を見せる時間
const BREAK_MS = 6000;
// とくとくクイズ／早押しで、押した人が答えるまでの持ち時間
const ANSWER_MS = 10000;
// 早押しで、誰も押さないまま次の問題へ行くまでの時間。
// これが無いと、対戦相手の電波が切れた瞬間に対戦が永久に止まる
const ASK_MS = 30000;

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
/**
 * @param {object} room 部屋
 * @param {object} config 端末から届いた設定。config.game が遊びの種類
 * @param {object} ctx   realtime.js が渡す入り口 { describe, notify }
 *   describe は使わない（クイズ王はゲーム中にAIを呼ばない）
 */
function startGame(room, config, ctx) {
  const members = playersOf(room);
  if (members.length < MIN_PLAYERS) {
    return { ok: false, error: 'too_few_players', message: MIN_PLAYERS + '人以上必要です' };
  }
  const raw = Object.assign({}, config || {});
  // 遊びの種類は「どのゲームとして始めたか」で決まる。
  // 端末が variant を送ってきても、game と食い違うなら game を信じる
  if (QuizLogic.VARIANTS.indexOf(raw.game) !== -1) raw.variant = raw.game;
  const cfg = QuizLogic.normalizeConfig(raw);
  const rnd = (config && config.rnd) || null;

  const ids = members.map((m) => m.id);
  const w = {
    variant: cfg.variant,
    cfg: cfg,
    preset: cfg.preset || null,
    playerIds: ids,
    names: {},
    scores: {},          // id -> 合計得点
    used: {},            // 出した問題文（同じ問題を続けて出さないため）
    rnd: rnd,

    phase: PHASE.PLAY,
    startedAt: Date.now(),
    deadline: null,
    endedAt: null,
    result: null,
    recorded: false
  };
  members.forEach((m) => { w.names[m.id] = m.name; w.scores[m.id] = 0; });

  let setup;
  if (cfg.variant === V.RUSH) setup = startRush(w);
  else if (cfg.variant === V.LIST) setup = startList(w, rnd);
  else if (cfg.variant === V.REVEAL) setup = startReveal(w, rnd);
  else setup = startBuzzer(w, rnd);
  if (setup && setup.error) return setup;

  room.quiz = w;
  room.state.game = cfg.variant;
  room.state.phase = w.phase;
  return { ok: true };
}

// ---- 出題（共通）----
// 同じ問題を続けて出さない。使い切ったら quiz-bank 側で復活する
function drawQuestion(w, tier) {
  const picked = QuizBank.pickQuestions(tier, 1, w.used, w.rnd);
  if (!picked.length) return null;
  w.used[picked[0].q] = true;
  return QuizBank.shuffleChoices(picked[0], w.rnd);
}

// ================= ① クイズラッシュ =================
// 全員が同時に、自分のペースで答え続ける。難易度は自分で選ぶ。
function startRush(w) {
  const seats = {};
  w.playerIds.forEach((id) => {
    seats[id] = {
      tier: null, q: null, passesLeft: w.cfg.passLimit,
      answered: 0, hits: 0, score: 0, last: null
    };
  });
  w.rush = {
    round: 1,
    roundWins: {},
    seats: seats,
    roundResult: null
  };
  w.playerIds.forEach((id) => { w.rush.roundWins[id] = 0; });
  w.deadline = Date.now() + w.cfg.timerSec * 1000;
  return { ok: true };
}

function rushNewRound(w) {
  const r = w.rush;
  r.round++;
  r.roundResult = null;
  w.playerIds.forEach((id) => {
    const s = r.seats[id];
    s.tier = null; s.q = null; s.score = 0;
    s.passesLeft = w.cfg.passLimit; s.answered = 0; s.hits = 0; s.last = null;
  });
  w.phase = PHASE.PLAY;
  w.deadline = Date.now() + w.cfg.timerSec * 1000;
}

// ラウンドを締めて、優勝が決まったかを見る
function rushCloseRound(room) {
  const w = room.quiz;
  const r = w.rush;
  const scores = {};
  w.playerIds.forEach((id) => { scores[id] = r.seats[id].score; });
  const winners = QuizLogic.rushRoundWinners(scores);
  winners.forEach((id) => { r.roundWins[id]++; });
  r.roundResult = {
    round: r.round,
    scores: w.playerIds.map((id) => ({
      id: id, name: w.names[id], score: scores[id], wins: r.roundWins[id]
    })),
    winners: winners.map((id) => w.names[id])
  };

  const target = w.cfg.roundsToWin;
  const reached = target > 0 && winners.some((id) => r.roundWins[id] >= target);
  const lastRound = target <= 0 || r.round >= MAX_ROUNDS;
  if (reached || lastRound) {
    finish(room, { cause: reached ? 'reached' : 'rounds' });
    return;
  }
  // 次のラウンドまで、結果を見せる時間を取る
  w.phase = PHASE.BREAK;
  w.deadline = Date.now() + BREAK_MS;
}

// ================= ② つぎつぎクイズ =================
// 順番に1つずつ、まだ出ていない答えを出す。判定は quiz-bank の一覧と突き合わせる。
function startList(w, rnd) {
  const topics = QuizBank.listTopicsOf(w.cfg.tier);
  if (!topics.length) {
    return { ok: false, error: 'no_topics', message: 'その難易度のお題がありません' };
  }
  const topic = QuizLogic.shuffled(topics, rnd)[0];
  const order = QuizLogic.shuffled(w.playerIds, rnd);
  const alive = {};
  order.forEach((id) => { alive[id] = true; });
  w.list = {
    style: w.cfg.style,
    topic: topic,           // answers は秘密。publicView にも privateFor にも出さない
    order: order,
    at: 0,
    said: [],               // 出た答え（公開してよい）
    alive: alive,
    lastNote: null,
    turnEndsAt: 0,
    overallEndsAt: Date.now() + w.cfg.timerSec * 1000
  };
  listStartTurn(w, 0);
  return { ok: true };
}

function listActiveIds(room) {
  const w = room.quiz;
  const l = w.list;
  return connectedIds(room, l.order).filter((id) => l.alive[id]);
}

function listStartTurn(w, at) {
  const l = w.list;
  l.at = at;
  l.turnEndsAt = Date.now() + w.cfg.turnSec * 1000;
  listRefreshDeadline(w);
}
function listRefreshDeadline(w) {
  const l = w.list;
  w.deadline = Math.min(l.turnEndsAt, l.overallEndsAt);
}

// 次の人へ回す。誰も残っていなければ締める
function listNextTurn(room) {
  const w = room.quiz;
  const l = w.list;
  const active = listActiveIds(room);
  const isActive = (id) => active.indexOf(id) !== -1;
  const next = QuizLogic.nextTurnIndex(l.order, l.at, isActive);
  if (next === -1) { listCheckEnd(room, false); return; }
  listStartTurn(w, next);
}

function listCheckEnd(room, timedOut) {
  const w = room.quiz;
  const l = w.list;
  const out = QuizLogic.listOutcome(l.style, {
    saidCount: l.said.length,
    targetCount: w.cfg.targetCount,
    aliveIds: listActiveIds(room),
    timedOut: timedOut
  });
  if (!out.done) return false;
  // 協力形式は「みんなで何個出せたか」がそのまま全員の点。
  // 目標に届かなくても、出した数は残す（0点で終わると、粘った意味が消える）
  if (l.style === QuizLogic.LIST_STYLE.COOP) {
    w.playerIds.forEach((id) => { w.scores[id] = l.said.length; });
  } else if (out.winnerId) {
    w.scores[out.winnerId] = (w.scores[out.winnerId] || 0) + 1;
  }
  finish(room, {
    success: out.success, cause: out.cause,
    winnerId: out.winnerId || null,
    said: l.said.slice()
  });
  return true;
}

// ================= ③ とくとくクイズ =================
// 問題文がだんだん見えてくる。早く押して当てるほど高得点。
function startReveal(w, rnd) {
  const qs = [];
  for (let i = 0; i < w.cfg.questionCount; i++) {
    const q = drawQuestion(w, w.cfg.tier);
    if (q) qs.push(q);
  }
  if (!qs.length) {
    return { ok: false, error: 'no_questions', message: 'その難易度の問題がありません' };
  }
  w.reveal = {
    index: 0, total: qs.length, questions: qs,
    askedAt: Date.now(),
    shown: 0,
    locked: {},        // この問題でもう答えられない人
    buzzed: null,      // いま答える権利を持つ人
    answerEndsAt: 0,
    lastNote: null
  };
  revealRefreshDeadline(w);
  return { ok: true };
}

function revealCurrent(w) { return w.reveal.questions[w.reveal.index] || null; }

// 見えている文字数を、いまの時刻から数え直す
function revealSync(w) {
  const rv = w.reveal;
  const q = revealCurrent(w);
  if (!q) return;
  rv.shown = QuizLogic.revealedCount(q.q, Date.now() - rv.askedAt, w.cfg.revealSec);
}

/**
 * 次に画面が変わる時刻を deadline に入れる。
 * realtime.js の500msごとの見回りは deadline しか見ないので、
 * ここに「次の1文字が出る時刻」を置いておけば、進行役の仕組みを増やさずに済む。
 */
function revealRefreshDeadline(w) {
  const rv = w.reveal;
  const q = revealCurrent(w);
  if (!q) { w.deadline = null; return; }
  if (rv.buzzed) { w.deadline = rv.answerEndsAt; return; }
  const len = q.q.length;
  const full = rv.askedAt + w.cfg.revealSec * 1000;
  if (rv.shown >= len) {
    // 全部見えたあと、少し待って次の問題へ
    w.deadline = full + ANSWER_MS;
    return;
  }
  // 次の1文字が出る時刻
  const per = (w.cfg.revealSec * 1000) / len;
  w.deadline = rv.askedAt + Math.ceil((rv.shown + 1) * per);
}

function revealNextQuestion(room) {
  const w = room.quiz;
  const rv = w.reveal;
  rv.index++;
  if (rv.index >= rv.total) { finish(room, { cause: 'allQuestions' }); return; }
  rv.askedAt = Date.now();
  rv.shown = 0;
  rv.locked = {};
  rv.buzzed = null;
  rv.answerEndsAt = 0;
  revealRefreshDeadline(w);
}

// 全員が答えられなくなったら、待たずに次の問題へ
function revealAllLocked(room) {
  const w = room.quiz;
  const ids = connectedIds(room, w.playerIds);
  if (!ids.length) return true;
  return ids.every((id) => w.reveal.locked[id]);
}

// ================= ④ 早押しトーナメント =================
// 1対1の勝ち抜き。問題は2人へ同時に届き、先に押した人が答える。
// 「先に押した」の判定は、サーバーが受け取った時刻で決める（第30弾 第2部）。
function startBuzzer(w, rnd) {
  const bracket = QuizLogic.newBracket(w.playerIds, rnd);
  w.buzzer = {
    bracket: bracket,
    pair: null,
    wins: {},          // memberId -> この対戦での勝ち数
    q: null,
    askedAt: 0,
    buzzed: null,
    buzzedAt: 0,
    locked: {},        // この問題でもう押せない人
    answerEndsAt: 0,
    lastNote: null,
    matchResult: null
  };
  const started = buzzerNextMatch(w);
  if (!started) {
    return { ok: false, error: 'no_match', message: '対戦を組めませんでした' };
  }
  return { ok: true };
}

// 次の対戦へ。組めなければ false（＝優勝が決まった）
function buzzerNextMatch(w) {
  const b = w.buzzer;
  const step = QuizLogic.advanceBracket(b.bracket);
  if (step.done || !step.pair) { b.pair = null; return false; }
  b.pair = step.pair.slice();
  b.wins = {};
  b.pair.forEach((id) => { b.wins[id] = 0; });
  b.matchResult = null;
  return buzzerAsk(w);
}

// 1問を2人へ同時に出す。ここで作った問題は、対戦中の2人と大画面にだけ届く
function buzzerAsk(w) {
  const b = w.buzzer;
  const q = drawQuestion(w, w.cfg.tier);
  if (!q) return false;
  b.q = q;
  b.askedAt = Date.now();
  b.buzzed = null;
  b.buzzedAt = 0;
  b.locked = {};
  b.answerEndsAt = 0;
  w.deadline = b.askedAt + ASK_MS;
  return true;
}

function buzzerFinishMatch(room, winnerId, loserId) {
  const w = room.quiz;
  const b = w.buzzer;
  QuizLogic.finishMatch(b.bracket, winnerId, loserId);
  w.scores[winnerId] = (w.scores[winnerId] || 0) + 1;
  b.matchResult = {
    winner: w.names[winnerId], loser: loserId ? w.names[loserId] : null,
    wins: b.pair.map((id) => ({ id: id, name: w.names[id], wins: b.wins[id] || 0 }))
  };
  b.q = null;
  b.buzzed = null;
  w.phase = PHASE.BREAK;
  w.deadline = Date.now() + BREAK_MS;
}

// ================= 公開してよい情報だけ =================
// ここに correct（正解の位置）や つぎつぎの答え一覧 を入れると、全員に配られる。
function publicView(room) {
  const w = room.quiz;
  if (!w) return { phase: PHASE.LOBBY };
  const base = {
    phase: w.phase,
    variant: w.variant,
    timerSec: w.cfg.timerSec,
    remainingMs: remainingMs(w),
    players: w.playerIds.map((id) => {
      const m = room.members.get(id);
      return {
        id: id, name: w.names[id],
        connected: !!(m && m.connected),
        score: w.scores[id] || 0
      };
    })
  };
  if (w.variant === V.RUSH) base.rush = rushPublic(w);
  if (w.variant === V.LIST) base.list = listPublic(room);
  if (w.variant === V.REVEAL) base.reveal = revealPublic(w);
  if (w.variant === V.BUZZER) base.buzzer = buzzerPublic(w);
  if (w.phase === PHASE.ENDED) base.result = resultView(room);
  return base;
}

function remainingMs(w) {
  if (!w.deadline) return null;
  return Math.max(0, w.deadline - Date.now());
}

// クイズラッシュ：誰が何点かは公開。問題文は人それぞれ違うので出さない
function rushPublic(w) {
  const r = w.rush;
  return {
    round: r.round,
    roundsToWin: w.cfg.roundsToWin,
    roundResult: r.roundResult,
    board: w.playerIds.map((id) => ({
      id: id, name: w.names[id],
      score: r.seats[id].score,
      wins: r.roundWins[id],
      answered: r.seats[id].answered,
      hits: r.seats[id].hits,
      tier: r.seats[id].tier
    }))
  };
}

// つぎつぎクイズ：お題と、出た答えは公開。正解の一覧は絶対に出さない
function listPublic(room) {
  const w = room.quiz;
  const l = w.list;
  return {
    style: l.style,
    topic: l.topic.topic,
    tier: l.topic.tier,
    targetCount: w.cfg.targetCount,
    said: l.said.slice(),
    saidCount: l.said.length,
    turnId: l.order[l.at] || null,
    turnName: w.names[l.order[l.at]] || null,
    turnRemainingMs: Math.max(0, l.turnEndsAt - Date.now()),
    lastNote: l.lastNote,
    order: l.order.map((id) => ({
      id: id, name: w.names[id], alive: !!l.alive[id]
    }))
  };
}

// とくとくクイズ：伏せ字にしたあとの文字列だけを出す。元の問題文は送らない
function revealPublic(w) {
  const rv = w.reveal;
  const q = revealCurrent(w);
  if (!q) return null;
  return {
    index: rv.index, total: rv.total, tier: q.tier,
    text: QuizLogic.maskedText(q.q, rv.shown),
    shown: rv.shown, length: q.q.length,
    choices: q.choices.slice(),          // 選択肢は全員に見せてよい（正解の位置は送らない）
    buzzedId: rv.buzzed,
    buzzedName: rv.buzzed ? w.names[rv.buzzed] : null,
    answerRemainingMs: rv.buzzed ? Math.max(0, rv.answerEndsAt - Date.now()) : null,
    lastNote: rv.lastNote
  };
}

// 早押し：いまの対戦と勝ち数。問題文は対戦中の2人と大画面に出す
function buzzerPublic(w) {
  const b = w.buzzer;
  return {
    roundNum: b.bracket.roundNum,
    winsNeeded: w.cfg.winsNeeded,
    delivery: w.cfg.delivery,
    pair: (b.pair || []).map((id) => ({
      id: id, name: w.names[id], wins: b.wins[id] || 0
    })),
    question: b.q ? { text: b.q.q, choices: b.q.choices.slice(), tier: b.q.tier } : null,
    askedAt: b.askedAt,
    buzzedId: b.buzzed,
    buzzedName: b.buzzed ? w.names[b.buzzed] : null,
    answerRemainingMs: b.buzzed ? Math.max(0, b.answerEndsAt - Date.now()) : null,
    matchResult: b.matchResult,
    champion: b.bracket.champion ? w.names[b.bracket.champion] : null,
    lastNote: b.lastNote
  };
}

// ================= その端末だけに配る情報 =================
function privateFor(room, memberId) {
  const w = room.quiz;
  if (!w) return null;
  if (w.playerIds.indexOf(memberId) === -1) return null; // 大画面・観戦には配らない
  const out = {
    phase: w.phase,
    variant: w.variant,
    score: w.scores[memberId] || 0,
    remainingMs: remainingMs(w)
  };

  if (w.variant === V.RUSH) {
    const s = w.rush.seats[memberId];
    out.rush = {
      tier: s.tier,
      canChangeTier: w.cfg.canChangeTier,
      passesLeft: s.passesLeft,
      score: s.score, answered: s.answered, hits: s.hits,
      last: s.last,
      // 出しているのは問題文と選択肢だけ。正解の位置は入れない
      question: s.q ? { text: s.q.q, choices: s.q.choices.slice(), tier: s.q.tier } : null
    };
  }
  if (w.variant === V.LIST) {
    const l = w.list;
    out.list = {
      yourTurn: l.order[l.at] === memberId,
      alive: !!l.alive[memberId],
      turnRemainingMs: Math.max(0, l.turnEndsAt - Date.now())
    };
  }
  if (w.variant === V.REVEAL) {
    const rv = w.reveal;
    out.reveal = {
      locked: !!rv.locked[memberId],
      yours: rv.buzzed === memberId,
      canBuzz: !rv.buzzed && !rv.locked[memberId] && w.phase === PHASE.PLAY
    };
  }
  if (w.variant === V.BUZZER) {
    const b = w.buzzer;
    const inMatch = (b.pair || []).indexOf(memberId) !== -1;
    out.buzzer = {
      inMatch: inMatch,
      locked: !!b.locked[memberId],
      yours: b.buzzed === memberId,
      canBuzz: inMatch && !b.buzzed && !b.locked[memberId] && !!b.q && w.phase === PHASE.PLAY,
      wins: b.wins[memberId] || 0
    };
  }
  if (w.phase === PHASE.ENDED) out.result = resultView(room);
  return out;
}

// ================= 操作 =================
/**
 * 部屋が持っている段階を、進行役の段階に合わせ直す。
 * 段階を変える場所が増えるたびに書き足すと、必ずどこかで書き忘れる（落とし穴4）。
 * だから外から呼ばれる入口の出口で、まとめて1回そろえる。
 */
function syncPhase(room) {
  if (room.quiz) room.state.phase = room.quiz.phase;
}

/**
 * ボタンを押す系。
 *   クイズラッシュ  … targetId = 難易度、または 'pass'
 *   とくとくクイズ  … targetId = 'buzz'
 *   早押し          … targetId = 'buzz'
 *   つぎつぎクイズ  … 使わない
 */
function submitAction(room, memberId, targetId, payload) {
  const res = submitActionInner(room, memberId, rawTarget(targetId, payload));
  syncPhase(room);
  return res;
}
function submitActionInner(room, memberId, targetId) {
  const w = room.quiz;
  if (!w) return { ok: false, error: 'not_started' };
  if (w.phase !== PHASE.PLAY) return { ok: false, error: 'wrong_phase' };
  if (w.playerIds.indexOf(memberId) === -1) return { ok: false, error: 'not_expected' };

  if (w.variant === V.RUSH) return rushAction(w, memberId, targetId);
  if (w.variant === V.REVEAL) return revealBuzz(w, memberId);
  if (w.variant === V.BUZZER) return buzzerBuzz(w, memberId);
  return { ok: false, error: 'no_action' };
}

function rushAction(w, memberId, targetId) {
  const s = w.rush.seats[memberId];
  if (!s) return { ok: false, error: 'not_expected' };

  if (targetId === 'pass') {
    if (!s.q) return { ok: false, error: 'nothing_open' };
    if (s.passesLeft <= 0) return { ok: false, error: 'no_pass_left' };
    s.passesLeft--;
    s.q = drawQuestion(w, s.tier);
    s.last = 'pass';
    return { ok: true, allDone: false };
  }
  // 難易度を選ぶ（＝1問目を引く／難易度を変える）
  if (QuizLogic.TIERS.indexOf(targetId) === -1) return { ok: false, error: 'unknown_tier' };
  if (s.tier && !w.cfg.canChangeTier && s.tier !== targetId) {
    return { ok: false, error: 'tier_locked' };
  }
  if (s.tier === targetId && s.q) return { ok: true, allDone: false }; // 押し直しは無視
  s.tier = targetId;
  s.q = drawQuestion(w, targetId);
  if (!s.q) return { ok: false, error: 'no_questions' };
  return { ok: true, allDone: false };
}

// とくとくクイズ：押した人が答える権利を取る。早い者勝ち（サーバー到着順）
function revealBuzz(w, memberId) {
  const rv = w.reveal;
  if (!revealCurrent(w)) return { ok: false, error: 'no_question' };
  if (rv.buzzed) return { ok: false, error: 'taken' };
  if (rv.locked[memberId]) return { ok: false, error: 'locked' };
  revealSync(w);
  rv.buzzed = memberId;
  rv.buzzedAt = Date.now();
  rv.answerEndsAt = rv.buzzedAt + ANSWER_MS;
  revealRefreshDeadline(w);
  return { ok: true, allDone: false };
}

// 早押し：対戦中の2人だけ。押した時刻はサーバーが持つ
function buzzerBuzz(w, memberId) {
  const b = w.buzzer;
  if (!b.q) return { ok: false, error: 'no_question' };
  if ((b.pair || []).indexOf(memberId) === -1) return { ok: false, error: 'not_in_match' };
  if (b.buzzed) return { ok: false, error: 'taken' };
  if (b.locked[memberId]) return { ok: false, error: 'locked' };
  b.buzzed = memberId;
  b.buzzedAt = Date.now();
  b.answerEndsAt = b.buzzedAt + ANSWER_MS;
  w.deadline = b.answerEndsAt;
  return { ok: true, allDone: false };
}

/**
 * 答える系。
 *   クイズラッシュ・とくとく・早押し … targetId = 選んだ選択肢の位置（数字）
 *   つぎつぎクイズ                   … targetId = 答えの文字列
 */
function submitVote(room, memberId, targetId, payload) {
  // 選択肢の位置は 0 から始まる。realtime.js は targetId を
  // 「(payload && payload.targetId) || null」で取り出すので、
  // 0 を選ぶと null に化ける（左端の選択肢だけ永久に選べなくなる）。
  // そうならないよう、payload から生の値を取り直す
  const res = submitVoteInner(room, memberId, rawTarget(targetId, payload));
  syncPhase(room);
  return res;
}
function submitVoteInner(room, memberId, raw) {
  const w = room.quiz;
  if (!w) return { ok: false, error: 'not_started' };
  if (w.phase !== PHASE.PLAY) return { ok: false, error: 'wrong_phase' };
  if (w.playerIds.indexOf(memberId) === -1) return { ok: false, error: 'not_expected' };

  if (w.variant === V.RUSH) return rushAnswer(w, memberId, raw);
  if (w.variant === V.LIST) return listAnswer(room, memberId, raw);
  if (w.variant === V.REVEAL) return revealAnswer(room, memberId, raw);
  return buzzerAnswer(room, memberId, raw);
}

// 0 や '' も、送られてきたなら送られてきたものとして扱う
function rawTarget(targetId, payload) {
  if (payload && Object.prototype.hasOwnProperty.call(payload, 'targetId')) {
    return payload.targetId;
  }
  return targetId;
}

function pickedIndexOf(targetId, choices) {
  const n = parseInt(targetId, 10);
  if (!isFinite(n) || n < 0 || n >= choices.length) return -1;
  return n;
}

function rushAnswer(w, memberId, targetId) {
  const s = w.rush.seats[memberId];
  if (!s || !s.q) return { ok: false, error: 'nothing_open' };
  const picked = pickedIndexOf(targetId, s.q.choices);
  if (picked === -1) return { ok: false, error: 'not_a_choice' };
  const judged = QuizLogic.rushJudge(s.q, picked);
  s.answered++;
  if (judged.correct) { s.hits++; s.score += judged.gained; }
  // 「correct」という言葉は端末へ配るものに使わない（正解の位置と紛れるため）
  s.last = judged.correct ? 'hit' : 'miss';
  // 続けて次の問題を出す（同じ難易度）。手を止めずに挑み続けられるように
  s.q = drawQuestion(w, s.tier);
  return { ok: true, correct: judged.correct, allDone: false };
}

function listAnswer(room, memberId, targetId) {
  const w = room.quiz;
  const l = w.list;
  if (l.order[l.at] !== memberId) return { ok: false, error: 'not_your_turn' };
  if (!l.alive[memberId]) return { ok: false, error: 'out' };
  const text = String(targetId == null ? '' : targetId);
  const verdict = QuizLogic.listJudge(l.topic, text, l.said);
  l.lastNote = { name: w.names[memberId], text: text, verdict: verdict };

  if (verdict === 'correct') {
    l.said.push(text);
    if (listCheckEnd(room, false)) return { ok: true, correct: true, allDone: false };
    listNextTurn(room);
    return { ok: true, correct: true, allDone: false };
  }
  // 脱落形式だけ、間違い・重複で脱落する。協力形式は続ける
  if (l.style === QuizLogic.LIST_STYLE.SURVIVAL) {
    l.alive[memberId] = false;
    if (listCheckEnd(room, false)) return { ok: true, correct: false, allDone: false };
  }
  listNextTurn(room);
  return { ok: true, correct: false, allDone: false };
}

function revealAnswer(room, memberId, targetId) {
  const w = room.quiz;
  const rv = w.reveal;
  const q = revealCurrent(w);
  if (!q) return { ok: false, error: 'no_question' };
  if (rv.buzzed !== memberId) return { ok: false, error: 'not_yours' };
  const picked = pickedIndexOf(targetId, q.choices);
  if (picked === -1) return { ok: false, error: 'not_a_choice' };

  const correct = (picked === q.correct);
  if (correct) {
    const gained = QuizLogic.revealScore(q.tier, rv.buzzedAt - rv.askedAt, w.cfg.revealSec);
    w.scores[memberId] = (w.scores[memberId] || 0) + gained;
    rv.lastNote = { name: w.names[memberId], hit: true, gained: gained };
    revealNextQuestion(room);
    return { ok: true, correct: true, allDone: false };
  }
  // 外したら、その問題にはもう答えられない。他の人は続けられる
  rv.locked[memberId] = true;
  rv.buzzed = null;
  rv.lastNote = { name: w.names[memberId], hit: false, gained: 0 };
  if (revealAllLocked(room)) revealNextQuestion(room);
  else revealRefreshDeadline(w);
  return { ok: true, correct: false, allDone: false };
}

function buzzerAnswer(room, memberId, targetId) {
  const w = room.quiz;
  const b = w.buzzer;
  if (!b.q) return { ok: false, error: 'no_question' };
  if (b.buzzed !== memberId) return { ok: false, error: 'not_yours' };
  const picked = pickedIndexOf(targetId, b.q.choices);
  if (picked === -1) return { ok: false, error: 'not_a_choice' };

  const correct = (picked === b.q.correct);
  b.lastNote = { name: w.names[memberId], hit: correct };
  if (correct) {
    b.wins[memberId] = (b.wins[memberId] || 0) + 1;
    if (b.wins[memberId] >= w.cfg.winsNeeded) {
      const loser = b.pair.find((id) => id !== memberId) || null;
      buzzerFinishMatch(room, memberId, loser);
      return { ok: true, correct: true, allDone: false };
    }
    buzzerAsk(w);
    return { ok: true, correct: true, allDone: false };
  }
  // 外したら、その問題にはもう押せない。相手にはまだ押す権利が残る
  b.locked[memberId] = true;
  b.buzzed = null;
  b.answerEndsAt = 0;
  const other = b.pair.find((id) => id !== memberId);
  if (!other || b.locked[other]) buzzerAsk(w); // 2人とも外したら次の問題
  else w.deadline = b.askedAt + ASK_MS;        // 相手が押すのを待つ
  return { ok: true, correct: false, allDone: false };
}

// ================= 時間で動くところ =================
/**
 * realtime.js の500msごとの見回りと、最後の人が切断した時から呼ばれる。
 * 期限が本当に来ているかを必ず自分で確かめるので、余計に呼ばれても何も起きない。
 */
function advance(room) {
  const res = advanceInner(room);
  syncPhase(room);
  return res;
}
function advanceInner(room) {
  const w = room.quiz;
  if (!w || w.phase === PHASE.ENDED) return { changed: false };
  const now = Date.now();

  if (w.phase === PHASE.BREAK) {
    if (w.deadline && now < w.deadline) return { changed: false };
    if (w.variant === V.RUSH) { rushNewRound(w); return { changed: true }; }
    if (w.variant === V.BUZZER) {
      w.phase = PHASE.PLAY;
      if (!buzzerNextMatch(w)) {
        finish(room, { cause: 'champion', winnerId: w.buzzer.bracket.champion });
      }
      return { changed: true };
    }
    return { changed: false };
  }

  if (w.variant === V.RUSH) {
    if (w.deadline && now >= w.deadline) { rushCloseRound(room); return { changed: true }; }
    return { changed: false };
  }

  if (w.variant === V.LIST) {
    const l = w.list;
    if (now >= l.overallEndsAt) { listCheckEnd(room, true); return { changed: true }; }
    if (now >= l.turnEndsAt) {
      // 持ち時間切れ。脱落形式では脱落、協力形式では次の人へ
      const cur = l.order[l.at];
      l.lastNote = { name: w.names[cur], text: null, verdict: 'timeout' };
      if (l.style === QuizLogic.LIST_STYLE.SURVIVAL) {
        l.alive[cur] = false;
        if (listCheckEnd(room, false)) return { changed: true };
      }
      listNextTurn(room);
      return { changed: true };
    }
    return { changed: false };
  }

  if (w.variant === V.REVEAL) {
    const rv = w.reveal;
    if (rv.buzzed && now >= rv.answerEndsAt) {
      // 押したのに答えなかった。その人はこの問題から外れる
      rv.locked[rv.buzzed] = true;
      rv.lastNote = { name: w.names[rv.buzzed], hit: false, gained: 0, timeout: true };
      rv.buzzed = null;
      if (revealAllLocked(room)) revealNextQuestion(room);
      else revealRefreshDeadline(w);
      return { changed: true };
    }
    const before = rv.shown;
    revealSync(w);
    const q = revealCurrent(w);
    const fullyShown = q && rv.shown >= q.q.length;
    if (fullyShown && now >= rv.askedAt + w.cfg.revealSec * 1000 + ANSWER_MS) {
      revealNextQuestion(room);
      return { changed: true };
    }
    revealRefreshDeadline(w);
    return { changed: rv.shown !== before };
  }

  // 早押し：押したのに答えなかった時と、誰も押さないまま時間が過ぎた時に動く
  const b = w.buzzer;
  if (b.buzzed && now >= b.answerEndsAt) {
    b.locked[b.buzzed] = true;
    b.lastNote = { name: w.names[b.buzzed], hit: false, timeout: true };
    b.buzzed = null;
    b.answerEndsAt = 0;
    const other = (b.pair || []).find((id) => !b.locked[id]);
    if (!other) buzzerAsk(w);
    else w.deadline = b.askedAt + ASK_MS;
    return { changed: true };
  }
  if (!b.buzzed && b.q && now >= b.askedAt + ASK_MS) {
    b.lastNote = { name: null, hit: false, timeout: true };
    buzzerAsk(w);
    return { changed: true };
  }
  return { changed: false };
}

function finish(room, result) {
  const w = room.quiz;
  w.phase = PHASE.ENDED;
  room.state.phase = PHASE.ENDED;
  w.endedAt = Date.now();
  w.deadline = null;
  w.result = Object.assign({}, w.result || {}, result || {});
  return true;
}

// 決着した時だけ、答え合わせのために中身を出す
function resultView(room) {
  const w = room.quiz;
  const out = {
    variant: w.variant,
    cause: (w.result && w.result.cause) || null,
    elapsedSec: w.startedAt ? Math.round(((w.endedAt || Date.now()) - w.startedAt) / 1000) : 0,
    ranking: QuizLogic.rank(w.playerIds.map((id) => ({
      id: id, name: w.names[id], score: w.scores[id] || 0
    })))
  };
  if (w.variant === V.RUSH) {
    out.rounds = w.rush.round;
    out.wins = w.playerIds.map((id) => ({ name: w.names[id], wins: w.rush.roundWins[id] }));
    // ラウンド制のときは、勝ったラウンド数で順位を決め直す
    if (w.cfg.roundsToWin > 0) {
      out.ranking = QuizLogic.rank(w.playerIds.map((id) => ({
        id: id, name: w.names[id], score: w.rush.roundWins[id] || 0
      })));
    }
  }
  if (w.variant === V.LIST) {
    out.topic = w.list.topic.topic;
    out.said = w.list.said.slice();
    out.success = !!(w.result && w.result.success);
    out.targetCount = w.cfg.targetCount;
    out.style = w.list.style;
    if (w.result && w.result.winnerId) out.winner = w.names[w.result.winnerId];
  }
  if (w.variant === V.REVEAL) {
    out.total = w.reveal.total;
    out.answered = w.reveal.index;
  }
  if (w.variant === V.BUZZER) {
    const b = w.buzzer;
    out.champion = b.bracket.champion ? w.names[b.bracket.champion] : null;
    out.runnerUp = b.bracket.runnerUp ? w.names[b.bracket.runnerUp] : null;
  }
  return out;
}

// その段階で操作を待つ人。切れている人は待たない
function expectedMembers(room) {
  const w = room.quiz;
  if (!w || w.phase !== PHASE.PLAY) return [];
  if (w.variant === V.LIST) {
    const cur = w.list.order[w.list.at];
    return connectedIds(room, [cur]);
  }
  if (w.variant === V.BUZZER) return connectedIds(room, w.buzzer.pair || []);
  return connectedIds(room, w.playerIds);
}

/**
 * 全員が切れたら締める。クイズ王に「全員が答え終わる」段階は無いので、
 * 見ているのは「まだ繋がっている人がいるか」だけ。
 */
function isAllDone(room) {
  const w = room.quiz;
  if (!w || w.phase === PHASE.ENDED) return false;
  return connectedIds(room, w.playerIds).length === 0;
}

module.exports = {
  PHASE, MIN_PLAYERS, MAX_ROUNDS, BREAK_MS, ANSWER_MS,
  startGame, publicView, privateFor,
  submitAction, submitVote, isAllDone, advance,
  playersOf, expectedMembers, resultView
};
