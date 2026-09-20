// shinka-room.js — カセット「進化じゃんけん」の進行役（指示55-②）
//
// ---- このゲームの芯は「出した手」を守ること ----
// 両者が出すまで、手は誰にも見えない。
// だから `w.封じた手` は `publicView` に一度も入らないし、
// `privateFor` でも**本人のぶんしか返さない**。
// 開いた瞬間に `w.開いた手` へ写し、以後は公開ビューがそちらだけを読む
//（rcard-room.js:112-117 の `bombsOnBoard` / `boards` と同じ二段構え）。
//
// **AIの正体も秘密**（指示書2-8）。`m.機械` は組の行に置いてあるので、
// 白名簿で組む `publicView` が黙って落とす。
//
// ---- AI戦は「同時に回る1組」として扱う（本人の裁定 2026-09-20・判断①案1） ----
// 一覧を2本（`matches` と `solo`）に割ると、
// `expectedMembers` / `isAllDone` / `advance` / `publicView` / `privateFor` /
// 帯 / 大画面 の**8か所で「片方だけ直す」が作れる**（落とし穴1）。
// 1本にしておけば、`matches` を歩く処理にAI戦が自動でついてくる。
//
// **AIの id は `w.playerIds` にも `publicView.players[]` にも入れない**：
//   ・`playerIds` に入れると `reapGone` が「名簿に居ない＝抜けた」と判定し、
//     AIは生成した瞬間に不戦敗になる（rcard-room.js:447-455 と同じ形）
//   ・`players[]` に入れると、芯の `playerCount`（realtime.js:478）と人数が1人ずれる
//
// ---- 段階 ----
//   match  … 組み合わせの発表（誰と誰か。**誰も待っていない**ので時計は tick）
//   throw  … 手を出す（3秒。全員が同時に動くので play）
//   hands  … 同時に開く → 勝敗 → ランクの動き（tick。値が reveal でない理由は下）
//   ended  … 優勝 or 10分

const path = require('path');
const L = require(path.join(__dirname, 'public', 'js', 'shinka-logic.js'));
const Versus = require(path.join(__dirname, 'public', 'js', 'versus.js'));

const PHASE = {
  MATCH: 'match',
  THROW: 'throw',
  // **値は 'reveal' ではなく 'hands'。**`RT_PHASE_LABEL`（index.html）は
  // ゲームをまたいだ1枚の表で、**`reveal` はワードウルフの「お題の確認」に取られている**。
  // そのまま使うと、進化じゃんけんの大画面に「お題の確認」と出る（落とし穴2：
  // 借りた言葉が、その世界観のまま漏れる）。指示53 が `reveal` を避けたのと同じ理由
  REVEAL: 'hands',
  ENDED: 'ended'
};

const MIN_PLAYERS = 3;    // 指示書0：部屋（3人以上）専用。1台の手渡しは作らない
const MATCH_MS = 1800;    // 組み合わせを見せる間
const REVEAL_MS = 2200;   // 開いて、勝敗とランクの動きを見せる間

/**
 * AIの表示名の池。**通常のプレイヤーと同じ形で出す**（本人の裁定 2026-09-20）。
 *
 * 「（ひとり）」のような専用の書き方は作らない——**それ自体がAIの印になる**
 *（指示書1節の判断①と 2-8・禁止が正面からぶつかっていた点。本人の裁定で 2-8 を採った）。
 * 伏せるのも同じ理由で採らない（伏せたことが印になる）。
 *
 * **同じ部屋の人の名前とぶつからないものを選ぶ**（`aiNameFor`）。
 */
const AI_NAMES = ['ぽち', 'たま', 'くろ', 'しろ', 'みけ', 'ちび', 'はな', 'そら', 'ゆき', 'もも'];

/**
 * このゲームの「くじ」。組の作り方・AIの手・AIの名前で引く。
 *
 * **部屋の状態オブジェクトには入れない**（rcard-room.js:47-52 と同じ理由）。
 * 検査は `startGame(room, { _rand })` で差し込めるので、
 * **同じ種で何度でも同じ進行を作れる**——秘匿の差分検査はこれが無いと書けない。
 */
const RANDS = new WeakMap();
function randOf(room) { return RANDS.get(room.shinka) || Math.random; }

function now() { return Date.now(); }

function playersOf(room) {
  return Array.from(room.members.values()).filter((m) => m.role === 'player');
}
function isPresent(room, id) { return room.members.has(id); }
function isLive(room, id) {
  const m = room.members.get(id);
  return !!(m && m.connected);
}

/** まだ部屋に居る人（このゲームに「敗退」は無い。10分か優勝まで全員が遊ぶ） */
function aliveIds(room) {
  const w = room.shinka;
  return w.playerIds.filter((id) => w.gone.indexOf(id) === -1);
}

/** その回に、その段にいる人数（「1人ランクか」の判定に使う） */
function 段の人数(room, ids) {
  const w = room.shinka;
  const t = {};
  ids.forEach((id) => { const d = w.状態[id].段; t[d] = (t[d] || 0) + 1; });
  return t;
}

/**
 * 段階を切り替える唯一の場所（締め切りもここでしか置かない）。
 *
 * **全体の期限（10分）と、段階の期限の、早い方を入れる**（門の文書4-3）。
 * 全体の期限を `advance()` の先頭に置く形にすると、
 * 段階の締め切りが切れるまで10分が発火しない——②は `match`（発表）や
 * `hands`（発表）を挟むので、**最大で段階1つぶん遅れて終わる**。
 * ここで早い方を入れておけば、芯の500ms見回り（realtime.js:1063）が10分ちょうどで撃つ。
 */
function setPhase(room, phase, ms) {
  const w = room.shinka;
  w.phase = phase;
  room.state.phase = phase;
  const 段階の期限 = ms > 0 ? now() + ms : null;
  if (phase === PHASE.ENDED) { w.deadline = null; return; }
  w.deadline = (段階の期限 == null) ? w.endsAt : Math.min(段階の期限, w.endsAt);
}

/** いま動いている（まだ決着していない）組 */
function liveMatches(room) {
  return room.shinka.matches.filter((m) => !m.done);
}
/** その人が入っている組 */
function matchOf(room, id) {
  return room.shinka.matches.find((m) => m.a === id || m.b === id) || null;
}
/** 組の中の相手（AI戦なら、AIのid） */
function foeOf(m, id) { return m.a === id ? m.b : m.a; }

// ================= 始める =================
function startGame(room, config, ctx) {
  const members = playersOf(room);
  if (members.length < MIN_PLAYERS) {
    return { ok: false, error: 'too_few_players', message: MIN_PLAYERS + '人以上必要です' };
  }
  const cfg = L.normalizeConfig(config);
  const はしご = L.ladderOf(cfg.ladder);
  const rand = (config && config._rand) || Math.random;

  const w = {
    cfg: cfg,
    はしご: はしご,
    playerIds: [],
    names: {},

    // ---- 秘密の正本。**publicView には一度も入らない** ----
    // 鍵は「出した人」。開くまでは本人にしか返さない。
    // **AIの手も、同じ入れ物に入れる**——別にすると
    // 「AIの手だけ別経路で公開される」事故と、開く処理が2本に割れる事故が同時に起きる
    封じた手: {},

    // ---- 公開してよいもの ----
    開いた手: {},        // 開いたあとの手。publicView が読むのはこちらだけ
    状態: {},            // id → { 段, 連敗, 挑戦を受けた }
    gone: [],
    直前の相手: {},      // id → 直前に当たった相手id（**毎回上書き**・指示書2-5）
    round: 0,
    matches: [],
    byeIds: [],          // その回、相手がいなかった人（**配列**。①の byeId は単数だった）
    直前の不戦勝: null,
    ランク移動: [],      // この回で誰がどう動いたか（大画面の階段の材料・公開してよい）
    // **称号のもと**（大切なこと5：勝ち負けと関係ないものも数える）。
    // じゃんけんそのものは運なので、勝ちだけを数えると「運が良かった証」しか集まらない——
    // 「挑戦に勝った」「一度も落ちなかった」は、その人の進み方の話。
    // **加算で成り立つ数だけを持つ**（端末の recordTitleStats は足すだけなので、
    // 最高記録の形は作れない・index.html の rcAdd のコメントに前例）
    記録: {},            // id → { ups, challengeWins, fell }
    result: null,
    phase: PHASE.MATCH,
    deadline: null,
    endsAt: now() + cfg.limitSec * 1000
  };
  room.shinka = w;
  RANDS.set(w, rand);
  members.forEach((m) => 入れる(room, m));
  startRound(room);
  return { ok: true };
}

/**
 * 名簿に1人入れる。**最下段から始める**（指示書2-2）。
 *
 * 途中参加にも使う（下の `startRound`）。門の文書4-2 で見つけた穴——
 * `room:join` に対局中の門が無いので、10分のこのゲームでは途中参加が普通に起きる。
 * 何もしないと `privateFor` が null を返し、端末の門（落とし穴18）が
 * `!you` で何も描かずに返って、**空白の画面のまま最大10分**になる。
 * 次の回から入れてしまえば、その穴ごと消える（大切なこと1）。
 */
function 入れる(room, member) {
  const w = room.shinka;
  if (w.playerIds.indexOf(member.id) !== -1) return false;
  w.playerIds.push(member.id);
  w.names[member.id] = member.name;
  w.状態[member.id] = L.newState();
  w.記録[member.id] = { ups: 0, challengeWins: 0, fell: 0 };
  return true;
}

/** AIの id。**名簿のidと同じ形**にする（realtime.js:347-349 の newId('m') と同じ見た目） */
function newAiId(rnd) {
  let s = 'm_';
  for (let i = 0; i < 16; i++) s += Math.floor(rnd() * 16).toString(16);
  return s;
}
/** AIの表示名。**同じ部屋の人とぶつからないもの**を選ぶ */
function aiNameFor(room, rnd) {
  const w = room.shinka;
  const 使用中 = w.playerIds.map((id) => w.names[id]);
  const 空き = AI_NAMES.filter((n) => 使用中.indexOf(n) === -1);
  const 池 = 空き.length ? 空き : AI_NAMES;
  return 池[Math.floor(rnd() * 池.length) % 池.length];
}

// ================= 回を始める（組を作る） =================
function startRound(room) {
  const w = room.shinka;
  w.round++;
  w.matches = [];
  w.byeIds = [];
  w.ランク移動 = [];
  w.封じた手 = {};
  w.開いた手 = {};

  // **途中から入ってきた人を、次の回から入れる**（門の文書4-2）
  playersOf(room).forEach((m) => { 入れる(room, m); });

  const ids = aliveIds(room);
  const 名簿 = ids.map((id) => ({ id: id, 段: w.状態[id].段 }));
  const 人数 = 段の人数(room, ids);

  // **組を作るのは共通部品A。**希望は3段（本人の裁定・論点②）。
  // 「1人ランクかどうか」は `希望を作る` が候補関数の中で見ている（shinka-logic.js）
  const res = Versus.組をつくる(名簿, {
    rnd: randOf(room),
    希望: L.希望を作る((x) => x.段),
    避ける: (a, b) => w.直前の相手[a.id] === b.id,   // **直前だけ**（指示書2-5）
    余りの吸収: 'bye',
    連続不戦勝を避ける: true,
    直前の不戦勝: w.直前の不戦勝
  });

  res.組.forEach((g) => {
    const 段A = w.状態[g.a].段, 段B = w.状態[g.b].段;
    const 低 = Math.min(段A, 段B);
    const 種 = L.組の種別(g.理由, 段A, 段B, 人数[低] || 0);
    const 挑戦者 = (段A < 段B) ? g.a : g.b;     // **段から決める**（理由の文字列に頼らない）
    w.matches.push({
      a: g.a, b: g.b, 種別: 種,
      挑戦者: (種 === L.種別.挑戦) ? 挑戦者 : null,
      受け: (種 === L.種別.挑戦) ? (挑戦者 === g.a ? g.b : g.a) : null,
      機械: false, aiName: null,
      あいこ回数: 0, done: false, winner: null, 引き分け: false
    });
    w.直前の相手[g.a] = g.b;
    w.直前の相手[g.b] = g.a;
  });

  // ---- 相手がいなかった人を、2種類に分ける（versus.js:53-57） ----
  res.相手なし.forEach((x) => {
    if (x.なぜ === Versus.理由なし.候補ゼロ) {
      // **希望を全部たどっても候補が1人もいない → AIと1戦**（指示書2-2）
      const rnd = randOf(room);
      const aiId = newAiId(rnd);
      w.matches.push({
        a: x.id, b: aiId, 種別: L.種別.機械,
        挑戦者: null, 受け: null,
        機械: true, aiName: aiNameFor(room, rnd),
        あいこ回数: 0, done: false, winner: null, 引き分け: false
      });
      w.直前の相手[x.id] = aiId;
    } else {
      // **奇数の余り → その回は何も動かない**（本人の裁定 2026-09-20・論点①(a)）。
      // **「不戦勝」と呼ばない**——②では勝っていないので、言葉が嘘になる（落とし穴2）
      w.byeIds.push(x.id);
      w.直前の相手[x.id] = null;
    }
  });
  // 次の回で**いちばん先に組ませる**。部品Aは1人分しか受け取らない
  //（配列を渡すと黙って無視される・門の文書1-6）ので、先頭の1人を渡す
  w.直前の不戦勝 = w.byeIds.length ? w.byeIds[0] : null;

  if (!w.matches.length) {
    // 誰も組めない（1人しか居ない等）。その時点で決着させる
    finish(room, null);
    return;
  }
  setPhase(room, PHASE.MATCH, MATCH_MS);
}

// ================= 手を出す =================
function startThrow(room) {
  const w = room.shinka;
  w.封じた手 = {};
  w.開いた手 = {};
  setPhase(room, PHASE.THROW, w.cfg.throwSec * 1000);
}

function submitHand(room, memberId, hand) {
  const w = room.shinka;
  if (w.phase !== PHASE.THROW) return { ok: false, error: 'bad_phase' };
  const m = matchOf(room, memberId);
  if (!m || m.done) return { ok: false, error: 'not_in_match' };
  if (!L.validHand(hand)) return { ok: false, error: 'bad_hand' };
  if (w.封じた手[memberId]) return { ok: false, error: 'already' };
  w.封じた手[memberId] = hand;
  return { ok: true };
}

/**
 * 開いて、勝敗を決めて、ランクを動かす。
 *
 * **AIの手はここで引く**（指示書2-2「相手の手を見て」）。
 * `throw` の開始時に引くと、相手の手に依存できない＝75/10/15 が作れない。
 */
function resolveThrow(room) {
  const w = room.shinka;
  const rnd = randOf(room);
  liveMatches(room).forEach((m) => {
    if (m.機械) w.封じた手[m.b] = L.aiHand(w.封じた手[m.a], rnd);
    const 手A = w.封じた手[m.a] || null;
    const 手B = w.封じた手[m.b] || null;
    // **開いた瞬間に写す。**以後、公開ビューはこちらだけを読む
    w.開いた手[m.a] = 手A;
    w.開いた手[m.b] = 手B;
    const 勝 = L.judge(手A, 手B);
    if (勝 === 'draw') {
      m.あいこ回数++;
      if (m.あいこ回数 >= w.cfg.drawMax) {
        // **あいこ上限 → 引き分け。両者とも動かない**（指示書2-3）
        m.done = true; m.引き分け = true; m.winner = null;
        動かす(room, m, null);
      }
      return;   // まだ上限に届いていなければ、同じ組のままもう一度
    }
    m.done = true;
    m.winner = (勝 === 'a') ? m.a : m.b;
    動かす(room, m, 勝);
  });
}

/** ランクを動かす。**規則はルール層の1か所だけ**（落とし穴1） */
function 動かす(room, m, 勝者) {
  const w = room.shinka;
  const out = L.applyMatch({
    種別: m.種別, a: m.a, b: m.b,
    挑戦者: m.挑戦者, 受け: m.受け,
    勝者: 勝者,
    状態: w.状態,
    段数: w.はしご.段.length
  });
  // **優勝の判定は、動かす前の段と見比べて決める**（はしごで読みが違う・論点④）
  const 前 = w.状態;
  [m.a, m.b].forEach((id) => {
    if (!前[id] || !out.状態[id]) return;   // AIは状態を持たない
    const 勝ったか = (m.winner === id);
    if (L.isChampion(w.はしご.優勝, 前[id].段, out.状態[id].段, 勝ったか, w.はしご.段.length)) {
      m.champion = id;
    }
  });
  // **称号のもとを数える。**段が動いた人だけ見ればよい
  out.動き.forEach((d) => {
    const r = w.記録[d.id];
    if (!r) return;
    if (d.後 > d.前) {
      r.ups++;
      // 「1つ上への挑戦に勝った」は、その人が挑戦者だった時だけ
      if (m.種別 === L.種別.挑戦 && d.id === m.挑戦者) r.challengeWins++;
    } else if (d.後 < d.前) {
      r.fell++;
    }
  });
  w.状態 = out.状態;
  out.動き.forEach((d) => w.ランク移動.push(d));
}

// ================= 進める =================
function isAllDone(room) {
  const w = room.shinka;
  if (!w || w.phase === PHASE.ENDED) return false;
  reapGone(room);
  // **見せるための段階は「全員済み」にしない**（落とし穴22）
  if (w.phase === PHASE.MATCH || w.phase === PHASE.REVEAL) return false;
  // **手を出す段階も、締め切りを待つ。**
  // 早く進めると、AI戦の人だけ「相手を待たずに次へ行く」ことになり、
  // **進む速さそのものがAIの指紋になる**（門の文書3-2 経路8）。
  // 3秒は全員に同じ拍で流れるのが正しい（指示書2-3）
  return false;
}

/**
 * まだ手を出していない人。
 *
 * **AIの id は `room.members` に無いので `isLive` が false になり、自動で外れる**
 *（rcard-room.js:60-63 と同じ形）。ここにAIを数えないための特別扱いは1行も要らない。
 */
function expectedMembers(room) {
  const w = room.shinka;
  if (!w || w.phase !== PHASE.THROW) return [];
  const out = [];
  liveMatches(room).forEach((m) => {
    [m.a, m.b].forEach((id) => {
      if (!w.封じた手[id] && isLive(room, id)) out.push(id);
    });
  });
  return out;
}

function advance(room) {
  const w = room.shinka;
  if (!w || w.phase === PHASE.ENDED) return;
  reapGone(room);

  if (w.phase === PHASE.MATCH) { startThrow(room); return; }

  if (w.phase === PHASE.THROW) {
    resolveThrow(room);
    setPhase(room, PHASE.REVEAL, REVEAL_MS);
    return;
  }

  if (w.phase === PHASE.REVEAL) {
    // **優勝が出ていたら、その瞬間に終わる**（10分ちょうどに達成しても達成を優先・指示書2-9）
    const 王 = w.matches.find((m) => m.champion);
    if (王) { finish(room, 王.champion); return; }
    // 10分
    if (now() >= w.endsAt) { finish(room, null); return; }
    // まだ決着していない組があれば、**同じ組のまま**もう一度
    if (liveMatches(room).length) { startThrow(room); return; }
    startRound(room);
    return;
  }
}

function finish(room, 優勝者) {
  const w = room.shinka;
  const rows = L.rankPlayers(w.playerIds.map((id) => ({
    id: id, name: w.names[id], 段: w.状態[id].段
  })));
  w.result = {
    ranking: rows.map((x) => ({
      id: x.id, rank: x.rank, name: x.name,
      段: x.段,
      段名: w.はしご.段[x.段].名,
      段絵: w.はしご.段[x.段].絵,
      no: w.はしご.段[x.段].no,
      // 称号のもと（端末が数える。**途中の秘密には触っていない**）
      ups: (w.記録[x.id] || {}).ups || 0,
      challengeWins: (w.記録[x.id] || {}).challengeWins || 0,
      fell: (w.記録[x.id] || {}).fell || 0,
      top: x.段 === w.はしご.段.length - 1
    })),
    winner: 優勝者 ? w.names[優勝者] : ((rows[0] && rows[0].rank === 1) ? rows[0].name : null),
    優勝: !!優勝者,
    rounds: w.round,
    段数: w.はしご.段.length
  };
  setPhase(room, PHASE.ENDED, 0);
}

// ================= 入口（芯から呼ばれる） =================
/**
 * **芯が呼ぶ形は4引数**（realtime.js:1404）：
 *   `dr.submitAction(room, me.id, payload.targetId || null, payload)`
 * 進化じゃんけんは `targetId` を使わない（押すのは手のボタンで、人ではない）が、
 * **引数の形は芯に合わせる**——合わせないと payload が targetId の位置に入る
 *（rcard-room.js:404-414 が実サーバーで踏んだ形）。
 */
function submitAction(room, memberId, targetId, payload) {
  const w = room.shinka;
  if (!w) return { ok: false, error: 'no_game' };
  if (w.playerIds.indexOf(memberId) === -1) return { ok: false, error: 'not_player' };
  const p = payload || {};
  if (p.hand != null) {
    const r = submitHand(room, memberId, p.hand);
    return Object.assign(r, { allDone: r.ok && isAllDone(room) });
  }
  return { ok: false, error: 'bad_action' };
}
function submitVote(room, memberId, targetId, payload) {
  return submitAction(room, memberId, targetId, payload);
}

/**
 * **居なくなった人を拾う**（落とし穴17）。
 *
 * 芯には「誰かが抜けた」を進行役へ押し込む口が無いので、
 * 呼ばれた時に名簿を見に行く（rcard-room.js:434-455・falsetrue-room.js:279 と同じ形）。
 * 切断・退室・kick・部屋解散のどれで消えても `room.members` から消えるのは同じなので、
 * ここ1か所で4経路ぶんを拾える。
 *
 * **切断（connected:false）は「抜けた」にしない。**戻ってくるかもしれないので、
 * 待たないだけ（`expectedMembers` が `isLive` で外す）。
 */
function reapGone(room) {
  const w = room.shinka;
  if (!w) return;
  w.playerIds.forEach((id) => {
    if (w.gone.indexOf(id) !== -1) return;
    if (isPresent(room, id)) return;
    w.gone.push(id);
    // **対戦中に抜けたら、相手の勝ち**（指示書2-9）。
    // ただし**AI戦の最中に抜けた場合は何も起きない**（指示書2-9）——
    // AIには「勝った」を渡す先が無いし、渡すと `m.winner` にAIのidが公開される
    const m = matchOf(room, id);
    if (!m || m.done) return;
    if (m.機械) { m.done = true; m.winner = null; m.引き分け = true; return; }
    m.done = true;
    m.winner = foeOf(m, id);
    動かす(room, m, m.winner === m.a ? 'a' : 'b');
  });
}

// ================= 公開ビュー（白名簿で組む） =================
/**
 * **`w` を丸ごと写さない。**書きたいものを1つずつ並べる
 *（rcard-room.js:457-466・falsetrue-room.js:416-458 と同じ形）。
 *
 * **ここに出してはいけないもの**（指示書2-8・禁止）：
 *   ・`w.封じた手`（開く前の手）
 *   ・`m.機械` / `m.aiName` の「AIかどうか」の印
 *   ・`m.種別`（`'機械'` が出たら、それだけでAIが分かる）
 *   ・`res.相手なし` の `なぜ`（`parity` / `no-candidate` の別）
 *
 * **「誰がもう出したか」も出さない。**AIは一度も「まだ出していない」に現れないので、
 * その一覧があるだけでAI戦が分かる（門の文書3-2 経路9。defuse・すごろくは
 * `waiting` を載せているが、②は載せない）。
 */
function publicView(room) {
  const w = room.shinka;
  if (!w) return null;
  const 開いてよい = (w.phase === PHASE.REVEAL || w.phase === PHASE.ENDED);
  return {
    phase: w.phase,
    round: w.round,
    remainingMs: w.deadline ? Math.max(0, w.deadline - now()) : null,
    残り全体Ms: Math.max(0, w.endsAt - now()),
    throwSec: w.cfg.throwSec,
    drawMax: w.cfg.drawMax,
    // はしご（段の絵・名前・番号）。**公開情報**——大画面の主役「ランクの階段」の材料
    ladder: w.はしご.id,
    段: w.はしご.段.map((s) => ({ no: s.no, 絵: s.絵, 名: s.名 })),
    // 卓の共通の見どころ：いま誰と誰が戦っているか（§11-1・宿題23）
    // **`種別` も `機械` も `aiName` も出さない。**相手の名前は、ふつうの人と同じ形で出す
    matches: w.matches.map((m) => ({
      a: m.a, b: m.b,
      aName: w.names[m.a] || m.aiName,
      bName: w.names[m.b] || m.aiName,
      done: m.done,
      引き分け: m.引き分け,
      あいこ回数: m.あいこ回数,
      // 手は**開いたあとだけ**。`w.封じた手` はどの分岐でも読まない
      aHand: 開いてよい ? (w.開いた手[m.a] || null) : null,
      bHand: 開いてよい ? (w.開いた手[m.b] || null) : null,
      // **勝者は id ではなく 'a'/'b' で言う。**
      // id で言うと、AIが勝った回に**AIのidが publicView に載る**——
      // 部屋の名簿は全員に配られる（realtime.js:484-499）ので、
      // 名簿に無いidが勝者の欄に出た瞬間にAI戦だと分かる。
      // 2-2 は「AIは10%で勝つ」と決めているので、これは必ず起きる形だった
      winner: m.done ? (m.winner === m.a ? 'a' : (m.winner === m.b ? 'b' : null)) : null
    })),
    // その回、相手がいなかった人。**理由は出さない**（AI戦の人はここに入らない）
    byeIds: w.byeIds.slice(),
    players: w.playerIds.map((id) => ({
      id: id,
      name: w.names[id],
      rank: w.状態[id].段,
      lose: w.状態[id].連敗,
      // **`gone` という名前にしない。**すごろくのゲームデータだけが持つ言葉で、
      // 端末側には `publicSnapshot が配らない gone で絞っている所は無い` という門がある
      //（tests/mode-screen.js:244・門G7）。借りた言葉を新しい世界へ運ばない（落とし穴9）
      ぬけた: w.gone.indexOf(id) !== -1
    })),
    // この回で誰がどう動いたか（大画面の階段のアニメの材料）
    moves: w.ランク移動.map((d) => ({ id: d.id, 前: d.前, 後: d.後, 何: d.何 })),
    result: w.result
  };
}

/**
 * 本人だけに配るもの。
 *
 * **プレイヤー名簿に無い相手には必ず null**（大画面＝`role:'bigscreen'` はここで落ちる）。
 * `tests/big-screen.js` が「どの進行役も大画面には秘密を配らない」を見張る。
 */
function privateFor(room, memberId) {
  const w = room.shinka;
  if (!w || w.playerIds.indexOf(memberId) === -1) return null;
  const m = matchOf(room, memberId);
  const 相手 = m ? foeOf(m, memberId) : null;
  return {
    // **先頭に phase**（落とし穴18：部屋の知らせと秘密は順番が保証されない。
    // 手元の phase が部屋の phase に追いつくまで、画面は何もしない）
    phase: w.phase,
    round: w.round,
    myRank: w.状態[memberId].段,
    myLose: w.状態[memberId].連敗,
    // **自分が出した手だけ。**開き直しても消えない（サーバーが持つ・指示書2-9）
    myHand: w.封じた手[memberId] || null,
    // **w.封じた手[相手] は、どの分岐でも読まない**
    opponentId: 相手,
    // 相手の名前は、**AIもふつうの人と同じ形**（本人の裁定 2026-09-20）
    opponentName: 相手 ? (w.names[相手] || (m && m.aiName)) : null,
    // **`m.機械` は返さない。**本人にも知らせない（指示書2-8）
    isBye: w.byeIds.indexOf(memberId) !== -1,
    あいこ回数: m ? m.あいこ回数 : 0,
    done: m ? m.done : false
  };
}

function resultView(room) {
  const w = room.shinka;
  return (w && w.result) || null;
}

/**
 * 大画面と端末に出す「共通の時計」の種類（正本 §11-4）。
 *
 * 'play' … 卓のみんなが待っている締め切り。帯の時計と巨大カウントダウンを出す
 * 'turn' … 手番の人だけの締め切り
 * 'tick' … 誰も待っていない（画面が変わるだけ）。時計を出さない
 *
 * **手を出す3秒は 'play'**——全員が同時に動く（手番制ではない）。
 * 組み合わせの発表と、開いて見せる間は誰も待っていないので 'tick'。
 */
function clockKind(room) {
  const w = room && room.shinka;
  if (!w || !w.phase) return 'play';
  if (w.phase === PHASE.THROW) return 'play';
  return 'tick';
}

module.exports = {
  PHASE, MIN_PLAYERS, MATCH_MS, REVEAL_MS,
  startGame, publicView, privateFor,
  submitAction, submitVote, isAllDone, advance,
  playersOf, expectedMembers, resultView, reapGone,
  clockKind,
  // 検査から進行を作るための穴（実装に試験用の分岐は作らない）
  aliveIds, liveMatches, matchOf
};
