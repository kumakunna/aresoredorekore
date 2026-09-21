// rcard-room.js — カセット「ロシアンカード」の進行役（指示55-①）
//
// ---- このゲームの芯は「爆弾の位置」を守ること ----
// 相手の9枚のうち3枚（決勝は5枚）に、秘密で爆弾を仕掛ける。
// **めくるまで、その位置は誰にも見えない。**
// だから `w.bombsOnBoard` は `publicView` に一度も入らないし、
// `privateFor` でも**盤の持ち主本人には返さない**（自分の盤の答えは知ってはいけない）。
// 返してよいのは「自分が相手の盤に置いた位置」だけ——置いた本人なので知っていて当然。
//
// 見張りは2本立て（片方だけだと落とし穴1）：
//   ・部屋版 … tests/rcard-room.js の差分法（位置だけが違う2局で publicView が1バイトも同じ）
//   ・手渡し版 … tests/secrecy-gates.js の型（ゲートに秘密が出ない・DOMからも消える）
//
// ---- 同時に複数組を回す ----
// 手本は早押しの勝ち抜き表（bracket）ではなく、**すごろく「ふたりでひとつ」**。
// 部屋の `w.deadline` 1本で全組の段階を揃え、`expectedMembers` が
// 「まだ終わっていない組の、いま手番の人」を返す（sugoroku-room.js:873-877 と同じ形）。
// 組を作るのは共通部品A（public/js/versus.js）。
//
// ---- 段階 ----
//   place … 全員が同時に、相手の9枚へ爆弾を置く（組が決まってから）
//   turn  … 組ごとに、いま手番の人が1枚めくる（相手は待つ）
//   show  … めくった結果を見せる間（**誰も待っていない**ので時計は tick）
//   round … その回の全組が終わった。誰が残ったかを見せる（同じく tick）
//   ended … 最後の1人

const path = require('path');
const L = require(path.join(__dirname, 'public', 'js', 'rcard-logic.js'));
const Versus = require(path.join(__dirname, 'public', 'js', 'versus.js'));

const PHASE = {
  PLACE: 'place',
  TURN: 'turn',
  SHOW: 'show',
  ROUND: 'round',
  ENDED: 'ended'
};

const MIN_PLAYERS = 2;
const PLACE_SEC = 30;      // 爆弾を置く締め切り（安全弁）
const SHOW_MS = 1800;      // めくった結果を見せる間
const ROUND_MS = 2800;     // その回の生き残りを見せる間（すごろくの RESULT_MS と同じ尺）

/**
 * このゲームの「くじ」。爆弾の置き場所と、組の作り方で引く。
 *
 * **部屋の状態オブジェクトには入れない**（falsetrue-room.js:74-77 と同じ理由）。
 * 検査は `startGame(room, { _rand })` で差し込めるので、
 * **同じ種で何度でも同じ進行を作れる**——秘匿の差分検査はこれが無いと書けない。
 */
const RANDS = new WeakMap();
function randOf(room) { return RANDS.get(room.rcard) || Math.random; }

function now() { return Date.now(); }

function playersOf(room) {
  return Array.from(room.members.values()).filter((m) => m.role === 'player');
}
function isPresent(room, id) { return room.members.has(id); }
function isLive(room, id) {
  const m = room.members.get(id);
  return !!(m && m.connected);
}

/** まだ負けておらず、部屋にも居る人 */
function aliveIds(room) {
  const w = room.rcard;
  return w.playerIds.filter((id) => w.敗退回[id] == null && w.gone.indexOf(id) === -1);
}

/** 段階を切り替える唯一の場所（締め切りもここでしか置かない） */
function setPhase(room, phase, ms) {
  const w = room.rcard;
  w.phase = phase;
  room.state.phase = phase;
  w.deadline = ms > 0 ? now() + ms : null;
}

/** いま動いている（まだ決着していない）組 */
function liveMatches(room) {
  return room.rcard.matches.filter((m) => !m.done);
}

/** その人が入っている組 */
function matchOf(room, id) {
  return room.rcard.matches.find((m) => !m.done && (m.a === id || m.b === id)) || null;
}

/** 組の中の相手 */
function foeOf(m, id) { return m.a === id ? m.b : m.a; }

/** いま手番の人 */
function turnIdOf(m) { return m.turn === 'a' ? m.a : m.b; }

// ================= 始める =================
function startGame(room, config, ctx) {
  const members = playersOf(room);
  if (members.length < MIN_PLAYERS) {
    return { ok: false, error: 'too_few_players', message: MIN_PLAYERS + '人以上必要です' };
  }
  const cfg = L.normalizeConfig(config);
  const ids = members.map((m) => m.id);
  const names = {};
  members.forEach((m) => { names[m.id] = m.name; });
  const rand = (config && config._rand) || Math.random;

  const w = {
    cfg: cfg,
    playerIds: ids,
    names: names,

    // ---- 秘密の正本。**publicView には一度も入らない** ----
    // 鍵は「盤の持ち主」。つまり **その人がこれからめくる盤**。
    // 本人には絶対に返さない（自分の盤の答えを知ってはいけない）。
    // 名前を `bombsIPlaced`（自分が相手に置いた位置）と1文字違いにしないこと——
    // いつか取り違える
    bombsOnBoard: {},

    // ---- 公開してよいもの ----
    lives: {},
    boards: {},          // id → { flipped: [], hits: [] }
    placed: {},          // id → true（置き終わったか。**どこに置いたかは入れない**）
    敗退回: {},
    gone: [],
    faced: {},           // id → 当たったことのある相手（部品Aの「避ける」に渡す）
    round: 0,
    matches: [],
    byeId: null,
    直前の不戦勝: null,
    last: null,          // 直前のめくり { byId, no, hit }（めくったあとなので公開してよい）
    result: null,
    phase: PHASE.PLACE,
    deadline: null
  };
  ids.forEach((id) => {
    w.lives[id] = cfg.lives;
    w.敗退回[id] = null;
    w.faced[id] = [];
  });
  room.rcard = w;
  RANDS.set(w, rand);
  startRound(room);
  return { ok: true };
}

// ================= 回を始める（組を作って、爆弾を置いてもらう） =================
function startRound(room) {
  const w = room.rcard;
  w.round++;
  w.matches = [];
  w.byeId = null;
  w.last = null;
  const 生存 = aliveIds(room);

  // **組を作るのは共通部品A。**奇数の不戦勝・連続不戦勝の回避・過去の相手を避ける、
  // の3つはここでは書かない（②以降5本と同じ正本から作る・落とし穴1）
  const res = Versus.組をつくる(生存, {
    rnd: randOf(room),
    避ける: (x, y) => (w.faced[x] || []).indexOf(y) !== -1,
    余りの吸収: 'bye',
    連続不戦勝を避ける: true,
    直前の不戦勝: w.直前の不戦勝
  });
  // **開始人数（w.playerIds.length）も渡す。**
  // 決勝の数を使うのは「生き残り戦で本当に残り2人まで来た時」だけで、
  // 2人で始めた部屋は最初から1対1——選んだ数をそのまま使う（2026-09-21・本人の指示）。
  // 手渡し側（index.html の initRcardRound）にも同じ形で渡してある（落とし穴1）
  const 爆弾数 = L.bombsForMatch(生存.length, w.cfg, w.playerIds.length);
  res.組.forEach((g) => {
    w.matches.push({ a: g.a, b: g.b, turn: 'a', done: false, winner: null });
    // **盤は毎回まっさらにする**（前の試合のめくり跡が残らない・良い型3）
    [g.a, g.b].forEach((id) => {
      w.boards[id] = { flipped: [], hits: [] };
      w.placed[id] = false;
      delete w.bombsOnBoard[id];
    });
    (w.faced[g.a] = w.faced[g.a] || []).push(g.b);
    (w.faced[g.b] = w.faced[g.b] || []).push(g.a);
  });
  // 余り（不戦勝）。**体力はそのまま持ち越す**
  const 余り = res.相手なし.filter((x) => x.なぜ === Versus.理由なし.余り);
  if (余り.length) {
    w.byeId = 余り[0].id;
    w.直前の不戦勝 = w.byeId;
  } else {
    w.直前の不戦勝 = null;
  }
  w.bombsPerBoard = 爆弾数;   // 公開してよい（何個仕掛けてあるかは、めくる人も知ってよい）

  if (!w.matches.length) { finish(room); return; }
  setPhase(room, PHASE.PLACE, PLACE_SEC * 1000);
}

// ================= 置く =================
/** その人が「いま置く相手」（＝相手の盤に置く） */
function placeTargetOf(room, id) {
  const m = matchOf(room, id);
  return m ? foeOf(m, id) : null;
}

function placeBombs(room, memberId, 位置たち) {
  const w = room.rcard;
  if (w.phase !== PHASE.PLACE) return { ok: false, error: 'bad_phase' };
  const 相手 = placeTargetOf(room, memberId);
  if (!相手) return { ok: false, error: 'not_in_match' };
  if (w.placed[memberId]) return { ok: false, error: 'already' };

  const 欲しい数 = w.bombsPerBoard;
  const list = Array.isArray(位置たち) ? 位置たち.map((x) => parseInt(x, 10)) : [];
  if (list.length !== 欲しい数) return { ok: false, error: 'bad_count' };
  if (!list.every((n) => L.validCell(n))) return { ok: false, error: 'bad_cell' };
  if (new Set(list).size !== list.length) return { ok: false, error: 'duplicate' };

  // **相手の盤に置く。**鍵は盤の持ち主（＝これからめくる人）
  w.bombsOnBoard[相手] = list.slice().sort((x, y) => x - y);
  w.placed[memberId] = true;
  return { ok: true };
}

/** 置かずに締め切りが来た人のぶんを、サーバーが置く（進行を止めない） */
function autoPlace(room) {
  const w = room.rcard;
  liveMatches(room).forEach((m) => {
    [m.a, m.b].forEach((id) => {
      if (w.placed[id]) return;
      const 相手 = foeOf(m, id);
      w.bombsOnBoard[相手] = L.makeBombs(randOf(room), w.bombsPerBoard);
      w.placed[id] = true;
    });
  });
}

// ================= めくる =================
function flipCard(room, memberId, no) {
  const w = room.rcard;
  if (w.phase !== PHASE.TURN) return { ok: false, error: 'bad_phase' };
  const m = matchOf(room, memberId);
  if (!m) return { ok: false, error: 'not_in_match' };
  if (turnIdOf(m) !== memberId) return { ok: false, error: 'not_your_turn' };
  const 盤 = w.boards[memberId];
  const res = L.flip(盤, no, w.bombsOnBoard[memberId] || []);
  if (!res.ok) return { ok: false, error: res.error };

  const n = parseInt(no, 10);
  盤.flipped.push(n);
  if (res.hit) {
    盤.hits.push(n);
    w.lives[memberId] = Math.max(0, w.lives[memberId] - 1);
  }
  w.last = { byId: memberId, no: n, hit: res.hit };
  m.acted = true;
  return { ok: true, hit: res.hit };
}

/** 時間切れ。**めくらなかった人は体力−1**（膠着防止・指示 2-1） */
function autoFlip(room) {
  const w = room.rcard;
  liveMatches(room).forEach((m) => {
    if (m.acted) return;
    const id = turnIdOf(m);
    w.lives[id] = Math.max(0, w.lives[id] - 1);
    // **カードはめくらない。**時間切れは「1枚失った」ではなく「手が止まった」ので、
    // 盤の情報を減らすと、次の手番がやりにくくなるだけ
    w.last = { byId: id, no: null, hit: true, timeout: true };
    m.acted = true;
  });
}

// ================= 組の決着 =================
function settleMatches(room) {
  const w = room.rcard;
  let 決着した = false;
  liveMatches(room).forEach((m) => {
    const aが0 = w.lives[m.a] <= 0;
    const bが0 = w.lives[m.b] <= 0;
    // 抜けた人がいたら、相手の不戦勝（落とし穴17：経路ごとに書かない）
    const aが不在 = w.gone.indexOf(m.a) !== -1;
    const bが不在 = w.gone.indexOf(m.b) !== -1;
    let 負け = null;
    if (aが不在 && bが不在) 負け = 'both';
    else if (aが不在) 負け = m.a;
    else if (bが不在) 負け = m.b;
    else if (aが0 && bが0) {
      // 安全弁（指示 2-9）。交互にめくるので本来あり得ない
      const 勝ち = L.tieBreak(w.前の体力 ? w.前の体力[m.a] : 0, w.前の体力 ? w.前の体力[m.b] : 0);
      負け = 勝ち === 'a' ? m.b : (勝ち === 'b' ? m.a : m.a);
    } else if (aが0) 負け = m.a;
    else if (bが0) 負け = m.b;
    if (!負け) return;
    決着した = true;
    m.done = true;
    if (負け === 'both') {
      m.winner = null;
      [m.a, m.b].forEach((id) => { if (w.敗退回[id] == null) w.敗退回[id] = w.round; });
    } else {
      m.winner = foeOf(m, 負け);
      w.敗退回[負け] = w.round;
    }
  });
  return 決着した;
}

// ================= 進める =================
function isAllDone(room) {
  const w = room.rcard;
  if (!w || w.phase === PHASE.ENDED) return false;
  reapGone(room);
  // **見せるための段階は「全員済み」にしない**（落とし穴22）。
  // 誰も待っていない段階を「飛ばしてよい」と芯に思わせると、
  // めくった結果を見る間が丸ごと消える
  if (w.phase === PHASE.SHOW || w.phase === PHASE.ROUND) return false;
  const 待つ = expectedMembers(room);
  return 待つ.length === 0;
}

function expectedMembers(room) {
  const w = room.rcard;
  if (!w) return [];
  if (w.phase === PHASE.PLACE) {
    const out = [];
    liveMatches(room).forEach((m) => {
      [m.a, m.b].forEach((id) => { if (!w.placed[id] && isLive(room, id)) out.push(id); });
    });
    return out;
  }
  if (w.phase === PHASE.TURN) {
    // **いま手番の人だけ。**相手は待っている（sugoroku の pair 進行と同じ形）
    return liveMatches(room)
      .filter((m) => !m.acted)
      .map((m) => turnIdOf(m))
      .filter((id) => isLive(room, id));
  }
  return [];
}

function advance(room) {
  const w = room.rcard;
  if (!w || w.phase === PHASE.ENDED) return;
  reapGone(room);
  // **抜けた人の試合は、待たずにその場で畳む。**
  // 畳まないと、抜けた人の手番で永遠に止まる（落とし穴17の実例）
  if (w.phase === PHASE.TURN || w.phase === PHASE.PLACE) {
    if (settleMatches(room) && !liveMatches(room).length) {
      setPhase(room, PHASE.ROUND, ROUND_MS);
      return;
    }
  }

  if (w.phase === PHASE.PLACE) {
    autoPlace(room);
    startTurn(room);
    return;
  }
  if (w.phase === PHASE.TURN) {
    autoFlip(room);
    setPhase(room, PHASE.SHOW, SHOW_MS);
    return;
  }
  if (w.phase === PHASE.SHOW) {
    const 決着 = settleMatches(room);
    if (決着 || !liveMatches(room).length) {
      setPhase(room, PHASE.ROUND, ROUND_MS);
      return;
    }
    // 手番を入れ替えて、もう1手
    liveMatches(room).forEach((m) => { m.turn = m.turn === 'a' ? 'b' : 'a'; m.acted = false; });
    setPhase(room, PHASE.TURN, w.cfg.turnSec * 1000);
    return;
  }
  if (w.phase === PHASE.ROUND) {
    const 生存 = aliveIds(room);
    if (生存.length <= 1) { finish(room); return; }
    startRound(room);
    return;
  }
}

function startTurn(room) {
  const w = room.rcard;
  // **前の体力を覚えておく**（同じ回に両方0になった時の安全弁で使う）
  w.前の体力 = Object.assign({}, w.lives);
  liveMatches(room).forEach((m) => { m.acted = false; });
  setPhase(room, PHASE.TURN, w.cfg.turnSec * 1000);
}

function finish(room) {
  const w = room.rcard;
  const rows = L.rankPlayers(w.playerIds.map((id) => ({
    id: id, name: w.names[id], 敗退回: w.敗退回[id]
  })));
  w.result = {
    ranking: rows.map((x) => ({
      id: x.id, rank: x.rank, name: x.name,
      lives: w.lives[x.id],
      livesMax: w.cfg.lives,
      // **勝ち抜いた回数**（称号がここを数える）。
      // 負けた人は「負けた回の1つ手前まで」勝ち抜いている
      rounds: x.敗退回 != null ? Math.max(0, x.敗退回 - 1) : w.round,
      out: x.敗退回 != null
    })),
    winner: (rows[0] && rows[0].rank === 1) ? rows[0].name : null,
    rounds: w.round
  };
  setPhase(room, PHASE.ENDED, 0);
}

// ================= 入口（芯から呼ばれる） =================
/**
 * **芯が呼ぶ形は4引数**（`realtime.js:1404`）：
 *   `dr.submitAction(room, me.id, payload.targetId || null, payload)`
 *
 * 最初これを3引数（room, memberId, payload）で書いていた。
 * 単体の検査は**こちらの間違った呼び方をそのまま写していた**ので緑のまま通り、
 * **実サーバーに繋いで初めて分かった**（落とし穴12：通信を見ないテストは、
 * 画面だけでなく「呼び方の食い違い」も捕まえられない）。
 * ロシアンカードは `targetId` を使わない（押すのは盤のマスで、人ではない）が、
 * **引数の形は芯に合わせる**——合わせないと payload が targetId の位置に入る。
 */
function submitAction(room, memberId, targetId, payload) {
  const w = room.rcard;
  if (!w) return { ok: false, error: 'no_game' };
  if (w.playerIds.indexOf(memberId) === -1) return { ok: false, error: 'not_player' };
  const p = payload || {};
  if (p.place) {
    const r = placeBombs(room, memberId, p.place);
    return Object.assign(r, { allDone: r.ok && isAllDone(room) });
  }
  if (p.flip != null) {
    const r = flipCard(room, memberId, p.flip);
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
 * 芯（realtime.js）には「誰かが抜けた」を進行役へ押し込む口が無い——
 * `settleAfterMemberGone` が `isAllDone` → `advance` を呼ぶだけなので、
 * **進行役の側で、呼ばれた時に名簿を見に行く**（falsetrue-room.js:279 と同じ形）。
 * 切断・退室・kick・部屋解散のどれで消えても、`room.members` から消えるのは同じなので、
 * ここ1か所で4経路ぶんを拾える。
 *
 * **切断（connected:false）は「抜けた」にしない。**戻ってくるかもしれないので、
 * 待たないだけ（`expectedMembers` が `isLive` で外す）。
 * 名簿から消えた時だけ、その試合を相手の不戦勝にする。
 */
function reapGone(room) {
  const w = room.rcard;
  if (!w) return;
  w.playerIds.forEach((id) => {
    if (w.gone.indexOf(id) !== -1) return;
    if (isPresent(room, id)) return;
    w.gone.push(id);
  });
}

// ================= 公開ビュー（白名簿で組む） =================
/**
 * **`w` を丸ごと写さない。**書きたいものを1つずつ並べる。
 * こうしておくと、あとで秘密の入れ物を足しても、ここに書かないかぎり漏れない
 *（falsetrue-room.js:416-458・wolf-room.js:82-110 と同じ形）。
 *
 * **`bombsOnBoard` はここに1バイトも出さない。**
 * 数（`bombsPerBoard`）は出してよい——何個仕掛けてあるかは、めくる人も知ってよい。
 * ただし**数と位置を同じ文字列に混ぜない**こと（符号化して紛れ込ませる形・53-Q4C）。
 */
function publicView(room) {
  const w = room.rcard;
  if (!w) return null;
  return {
    phase: w.phase,
    round: w.round,
    remainingMs: w.deadline ? Math.max(0, w.deadline - now()) : null,
    bombsPerBoard: w.bombsPerBoard,
    livesMax: w.cfg.lives,
    turnSec: w.cfg.turnSec,
    byeId: w.byeId,
    aliveCount: aliveIds(room).length,
    // 卓の共通の見どころ：いま誰と誰が戦っているか（§11-1・宿題23）
    matches: w.matches.map((m) => ({
      a: m.a, b: m.b,
      aName: w.names[m.a], bName: w.names[m.b],
      turnId: m.done ? null : turnIdOf(m),
      done: m.done,
      winner: m.winner
    })),
    // 盤は「めくった結果」だけ。**伏せたままの中身は入れない**
    boards: w.playerIds.reduce((acc, id) => {
      const b = w.boards[id];
      if (b) acc[id] = { flipped: b.flipped.slice(), hits: b.hits.slice() };
      return acc;
    }, {}),
    placed: w.playerIds.reduce((acc, id) => { acc[id] = !!w.placed[id]; return acc; }, {}),
    players: w.playerIds.map((id) => ({
      id: id,
      name: w.names[id],
      lives: w.lives[id],
      out: w.敗退回[id] != null,
      gone: w.gone.indexOf(id) !== -1
    })),
    last: w.last ? { byId: w.last.byId, no: w.last.no, hit: w.last.hit, timeout: !!w.last.timeout } : null,
    result: w.result
  };
}

/**
 * 本人だけに配るもの。
 *
 * **プレイヤー名簿に無い相手には必ず null**（大画面＝`role:'bigscreen'` はここで落ちる）。
 * `tests/big-screen.js:164-193` が「どの進行役も大画面には秘密を配らない」を見張る。
 */
function privateFor(room, memberId) {
  const w = room.rcard;
  if (!w || w.playerIds.indexOf(memberId) === -1) return null;
  const m = matchOf(room, memberId);
  const 相手 = m ? foeOf(m, memberId) : null;
  // **置き終わるまでは、自分が置いた位置も返さない。**
  // 同時に置く設計なので、置く前に返すと「自分が置く前に相手の答えを持つ」ことになる
  //（falsetrue-room.js:471-472 と同じく、段階を明示して守る）
  const 見てよい = !!(相手 && w.placed[memberId] && w.phase !== PHASE.PLACE);
  return {
    // **先頭に phase**（落とし穴18：部屋の知らせと秘密は順番が保証されない。
    // 手元の phase が部屋の phase に追いつくまで、画面は何もしない）
    phase: w.phase,
    round: w.round,
    myLives: w.lives[memberId],
    opponentId: 相手,
    opponentName: 相手 ? w.names[相手] : null,
    isBye: w.byeId === memberId,
    isMyTurn: !!(m && turnIdOf(m) === memberId),
    // 自分が相手の盤に置いた位置（置いた本人なので知っていて当然）
    bombsIPlaced: 見てよい ? (w.bombsOnBoard[相手] || []).slice() : null,
    // **w.bombsOnBoard[memberId] は、どの分岐でも読まない**
    out: w.敗退回[memberId] != null
  };
}

function resultView(room) {
  const w = room.rcard;
  return (w && w.result) || null;
}

/**
 * 大画面と端末に出す「共通の時計」の種類（正本 §11-4）。
 *
 * 'play' … 卓のみんなが待っている締め切り。帯の時計と巨大カウントダウンを出す
 * 'turn' … 手番の人だけの締め切り。帯の時計は出すが、巨大カウントダウンは出さない
 * 'tick' … 誰も待っていない（画面が変わるだけ）。時計を出さない
 *
 * **めくるまでの持ち時間（既定15秒）は 'turn'**（本人の裁定 2026-09-19）。
 * 'play' にすると、`.big-cd` が残り5秒から毎秒1枚ずつ 420px の数字を全面に出すので、
 * **1手番の3分の1の時間、卓の真ん中（3×3の盤を置く場所）を覆い続ける**。
 * 置く段階（place）は全員が同時に動くので 'play'。
 * 見せる間（show・round）は誰も待っていないので 'tick'。
 */
function clockKind(room) {
  const w = room && room.rcard;
  if (!w || !w.phase) return 'play';
  if (w.phase === PHASE.SHOW || w.phase === PHASE.ROUND) return 'tick';
  if (w.phase === PHASE.TURN) return 'turn';
  return 'play';
}

module.exports = {
  PHASE, MIN_PLAYERS, PLACE_SEC, SHOW_MS, ROUND_MS,
  startGame, publicView, privateFor,
  submitAction, submitVote, isAllDone, advance,
  playersOf, expectedMembers, resultView, reapGone,
  clockKind,
  // 検査から進行を作るための穴（実装に試験用の分岐は作らない）
  aliveIds, liveMatches, matchOf
};
