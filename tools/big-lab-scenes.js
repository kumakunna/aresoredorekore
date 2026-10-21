// tools/big-lab-scenes.js — 大画面の実験台（tools/big-lab.js）に流す「部屋の状態」を、本物の進行役で作る（指示64）
//
// **手で書いた検体を使わない**（落とし穴25）。ここで作る部屋の知らせは、どれも
//   本物の部屋の箱（realtime.js の RoomStore）＋本物の進行役（*-room.js の startGame / submitAction /
//   submitVote / advance）＋本物の公開スナップショット（realtime.js の publicSnapshot。共通の時計
//   `view.clock` もここで付く）
// を通したものだけ。画面に流す形は、本物のサーバーが配る形とまったく同じになる。
//
// 進め方は2種類：
//   ・tests/room-drive.js の `すすめる`（tests/now-line.js・clear-fx.js と同じ1手。写さずに借りる）
//   ・ゲームごとの「それらしい1手」（人狼の投票・爆弾の解除・オークションの入札など）。
//     締め切りは w.deadline を過去へずらして追い越す（実時間を待たない・落とし穴24）
// 同着（1位が k 人）は、決着のあと**進行役の中の点を揃えて**から公開ビューを取り直す。
// 順位を付けるのは本物の進行役のまま（rank の計算を道具に写さない）。
// 揃えた結果「1位が本当に k 人か」を必ず数える（落とし穴10-b）——数が合わない場面は出さずに報告する。
//
// シナリオは**データの一覧**（SCENARIOS）。足す時は1行足して、進め方（run）を書く。
// run は generator：状態が「撮ってよい形」になったところで `yield '名前'` する。
// 道具は yield を受けた**その瞬間に** publicSnapshot を取るので、時計の残りも本物のまま流れる。

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const RT = require(path.join(ROOT, 'realtime.js'));
const { GAME_DRIVERS, publicSnapshot, RoomStore } = RT;
const { RT_START_MIN_CONFIG } = require(path.join(ROOT, 'tests', 'inventory.js'));
const { すすめる } = require(path.join(ROOT, 'tests', 'room-drive.js'));
const TitleLogic = require(path.join(ROOT, 'public', 'js', 'titles.js'));
const BombLogic = require(path.join(ROOT, 'public', 'js', 'bomb-logic.js'));
const AuctionLogic = require(path.join(ROOT, 'public', 'js', 'auction-logic.js'));
const AuctionItems = require(path.join(ROOT, 'public', 'js', 'auction-items.js'));

const INDEX_HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

// ---- 人数の上限：**コードから読む**（この一覧を手で書かない・落とし穴4） ----
// 端末の上限は index.html の GAMES（gameMaxPlayers：省略＝8・0＝上限なし）。
// 進行役の上限はそれぞれの startGame が門を持つので、実際に始めて確かめる（下の 上限）。
// **GAMES の中だけを読む**——CASSETTES にも同じ id の行（falsetrue・rcard・shinka）があり、
// そちらには maxPlayers が無いので、先に当たると「省略＝8人」と読み違える（最初の版で実際に踏んだ）
const GAMES_BLOCK = (function () {
  const a = INDEX_HTML.indexOf('var GAMES = [');
  const b = INDEX_HTML.indexOf('];', a);
  if (a < 0 || b < 0) throw new Error('index.html に var GAMES = [ が見つかりません（書式が変わった？）');
  return INDEX_HTML.slice(a, b);
})();
function 端末の上限(gameId) {
  const m = GAMES_BLOCK.match(new RegExp("\\{\\s*id:'" + gameId + "'[^\\n]*"));
  if (!m) throw new Error('index.html の GAMES に ' + gameId + ' がありません（書式が変わった？）');
  const cap = m[0].match(/maxPlayers:(\d+)/);
  const v = cap ? parseInt(cap[1], 10) : 8;            // 省略は8人（gameMaxPlayers と同じ決まり）
  return v === 0 ? RT.ROOM_MAX_PLAYERS : v;              // 0＝上限なし → 部屋の上限
}
// モードは index.html の MODES から引く（id と game の組。ルールの3枚の札は modeId から出る）
function モードのゲーム(modeId) {
  const m = INDEX_HTML.match(new RegExp('\\{id:"' + modeId + '"[^\\n]*?game:\'([a-z]+)\''));
  return m ? m[1] : null;
}
// 人狼のプリセット（rtWolfroleConfig が送るもの）。MODES の wolfPreset をそのまま読む
function 人狼のプリセット(modeId) {
  const i = INDEX_HTML.indexOf('{id:"' + modeId + '"');
  const m = INDEX_HTML.slice(i, i + 2000).match(/wolfPreset:(\{[^}]*\})/);
  if (!m) throw new Error(modeId + ' の wolfPreset が読めません');
  return Function('return (' + m[1] + ')')();
}

// ---- 決まった乱数（同じシナリオは毎回同じ絵になる） ----
function 種つき(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- 部屋にいる人（名前は2〜12文字。部屋の名前欄は12文字まで：rtJoinName maxlength） ----
// 長い名前を前の方に混ぜる——4人の部屋でも、長い名前で崩れないかを見たい
const NAMES = ['あき', 'kensho34', 'ひろ', 'あいうえおかきくけこ', 'まりこ', 'そうた', 'ゆい',
  'たかはしゆういちろう', 'りん', 'こうへい', 'みさき', 'だいすけ', 'あいうえおかきくけこさし',
  'ももか', 'けん', 'さくら', 'はると', 'なな', 'しょうたろう', 'えま'];
const ROOM_CODE = 'K7MPQ3';   // 部屋コードの文字（realtime.js CODE_ALPHABET）だけで作る
const TV_ID = 'tv';           // tests/room-drive.js の すすめる が「プレイヤーでない」と見分ける id

// 名簿の姿（アイコン・二つ名）は、本物の称号の部品（titles.js の CATALOG）から組む
function 姿(i) {
  const C = TitleLogic.CATALOG;
  const icon = C.icon[(i * 5 + 1) % C.icon.length].emoji;
  const first = C.first[(i * 3 + 1) % C.first.length].id;
  const joiner = C.joiner[i % C.joiner.length].id;
  const last = C.last[(i * 7 + 2) % C.last.length].id;
  return { icon, title: TitleLogic.titleText({ first, joiner, last }) };
}

/** 本物の部屋の箱（RoomStore）に、n 人と大画面1台を入れる */
function 部屋を作る(n) {
  const store = new RoomStore();
  const room = store.create({ ownerUserId: 1, ownerUsername: 'kuma' });
  room.code = ROOM_CODE;
  const t0 = Date.now() - 10 * 60 * 1000;
  for (let i = 0; i < n; i++) {
    const id = 'm' + (i + 1);
    room.members.set(id, {
      id, name: NAMES[i % NAMES.length], role: RT.ROLE_PLAYER, socketId: null, connected: true,
      joinedAt: t0 + i * 1000 + (i > 0 ? 500 : 0), lastSeen: Date.now(), readyGame: null,
      userId: i === 0 ? 1 : null, look: 姿(i)
    });
  }
  // 大画面は進行役の次に入った（第47弾 47-2：大画面は進行役にならない）
  room.members.set(TV_ID, {
    id: TV_ID, name: 'テレビ', role: RT.ROLE_BIGSCREEN, socketId: null, connected: true,
    joinedAt: t0 + 200, lastSeen: Date.now(), readyGame: null, userId: null, look: null
  });
  room.hostMemberId = 'm1';
  return room;
}
function プレイヤー(room) {
  return Array.from(room.members.values()).filter((m) => m.role === RT.ROLE_PLAYER).map((m) => m.id);
}
/** 公開スナップショット（本物）。JSON を通して、画面に渡す形にそろえる */
function スナップ(room) { return JSON.parse(JSON.stringify(publicSnapshot(room))); }

// ---- 決着の画面から「1位が何人か」を数える（同着を作れたかの確かめ・落とし穴10-b） ----
function 順位表(view) {
  const r = (view && view.result) || {};
  return r.ranking || r.players || view.ranking || null;
}
function 一位の数(view) {
  const t = 順位表(view);
  return t ? t.filter((x) => x && x.rank === 1).length : null;
}

/**
 * 1つのゲームを、本物の進行役で始める。
 * 返す lab は run（generator）から使う道具箱。
 */
function 始める(spec, n) {
  const room = 部屋を作る(n);
  const entry = GAME_DRIVERS[spec.game];
  if (!entry) throw new Error('GAME_DRIVERS に ' + spec.game + ' がありません');
  const d = entry.driver;
  const lab = {
    room, d, game: spec.game, n, spec,
    ids: プレイヤー(room),
    w: () => room[entry.key],
    view: () => d.publicView(room),
    /** 待合：ゲームが決まって、まだの人がいる（room:setState → room:ready と同じ形） */
    待合(まだ) {
      room.state = { phase: 'lobby', game: spec.game, data: { modeId: spec.modeId } };
      const 押した = lab.ids.slice(0, Math.max(0, lab.ids.length - まだ));
      lab.ids.forEach((id) => { room.members.get(id).readyGame = 押した.indexOf(id) !== -1 ? spec.game : null; });
    },
    /** 本物の startGame（realtime.js の wolf:start と同じ順：始める → 準備OKを落とす） */
    開始(cfg) {
      room.state = { phase: 'lobby', game: spec.game, data: { modeId: spec.modeId } };
      const res = d.startGame(room, cfg, { describe: async () => ({ description: '' }), notify() {} });
      if (!res || !res.ok) throw new Error(spec.game + ' を始められません：' + JSON.stringify(res));
      for (const m of room.members.values()) m.readyGame = null;   // clearReady（realtime.js）
      lab.ids = lab.w().playerIds ? lab.w().playerIds.slice() : lab.ids;
      return res;
    },
    /** 操作は realtime.js と同じ形で送る（allDone なら advance） */
    act(id, targetId, payload) {
      const r = d.submitAction(room, id, targetId == null ? null : targetId, payload || { targetId });
      if (r && r.allDone) d.advance(room);
      return r;
    },
    vote(id, targetId, payload) {
      const r = d.submitVote(room, id, targetId == null ? null : targetId, payload || { targetId });
      if (r && r.allDone) d.advance(room);
      return r;
    },
    /** 締め切りを追い越す（時間切れの見回りと同じく advance を呼ぶ・落とし穴24） */
    締め切り() { const w = lab.w(); if (w && w.deadline) w.deadline = Date.now() - 1; d.advance(room); },
    /** tests/room-drive.js の1手（now-line・clear-fx と同じ進め方） */
    一手() { すすめる(d, room, spec.game, lab.w()); },
    phase: () => lab.w() ? lab.w().phase : room.state.phase,
    ended: () => lab.w() && lab.w().phase === d.PHASE.ENDED
  };
  return lab;
}

/**
 * どのゲームにも使う歩き方：段階が変わるたびに1枚（同じ段階は1回だけ）、決着まで。
 * 動く(lab) を渡すと、その段階で「それらしい1手」を先に打つ（無ければ すすめる だけ）
 */
function* 段階ごとに(lab, o) {
  const opt = o || {};
  const 見た = {};
  for (let i = 0; i < (opt.max || 400) && !lab.ended(); i++) {
    const ph = (opt.名 || ((l) => l.view().phase))(lab);
    if (!見た[ph] || (opt.何枚 && 見た[ph] < opt.何枚)) { 見た[ph] = (見た[ph] || 0) + 1; yield ph + (見た[ph] > 1 ? '-' + 見た[ph] : ''); }
    const 前 = JSON.stringify([lab.w().phase, lab.w().deadline]);
    if (opt.動く) opt.動く(lab); else lab.一手();
    if (JSON.stringify([lab.w().phase, lab.w().deadline]) === 前 && !opt.動く) lab.締め切り();
  }
  if (!lab.ended()) throw new Error(lab.game + '：決着まで届きませんでした（いま ' + lab.phase() + '）');
}

// ======================= ゲームごとの「それらしい1手」 =======================

/** 人狼：夜は全員が誰かを選び、昼の投票は全員が同じ1人へ（処刑が出る） */
function 人狼の一手(lab) {
  const w = lab.w(), g = w.game, ph = w.phase;
  const 生きている = g.players.filter((p) => p.alive);
  const 待ち = lab.d.expectedMembers(lab.room);
  if (ph === 'roleReveal') { 待ち.forEach((id) => lab.act(id, null)); return; }
  if (ph === 'night' || ph === 'preVote') {
    const 人狼 = 生きている.filter((p) => p.role === 'wolf').map((p) => p.id);
    const 的 = 生きている.find((p) => 人狼.indexOf(p.id) === -1);
    待ち.forEach((id) => {
      const t = 人狼.indexOf(id) !== -1 ? 的 : 生きている.find((p) => p.id !== id);
      lab.act(id, t ? t.id : null);
    });
    if (lab.w().phase === ph) lab.締め切り();
    return;
  }
  if (ph === 'vote') {
    // 候補（決選なら候補の中）から、最初の1人へ全員が入れる
    const 候補 = w.runoff ? 生きている.filter((p) => w.runoff.candidates.indexOf(p.id) !== -1) : 生きている;
    待ち.forEach((id) => {
      const t = 候補.find((p) => p.id !== id);
      if (t) lab.vote(id, t.id);
    });
    if (lab.w().phase === ph) lab.締め切り();
    return;
  }
  lab.締め切り();
}
function* 人狼(lab) {
  // 投票の途中（半分が入れた）も1枚撮る：「まだの人」の並びを見たい
  const 見た = {};
  for (let i = 0; i < 200 && !lab.ended(); i++) {
    const ph = lab.view().phase;
    if (!見た[ph]) { 見た[ph] = 1; yield ph; }
    if (ph === 'vote' && !見た['vote-途中']) {
      const 生きている = lab.w().game.players.filter((p) => p.alive);
      const 待ち = lab.d.expectedMembers(lab.room);
      待ち.slice(0, Math.floor(待ち.length / 2)).forEach((id) => {
        const t = 生きている.find((p) => p.id !== id); if (t) lab.vote(id, t.id);
      });
      見た['vote-途中'] = 1;
      yield 'vote-途中';
    }
    人狼の一手(lab);
  }
}

/** ワードウルフ：お題を確認 → 話し合い → 全員が同じ1人へ投票 */
function ワードウルフの一手(lab) {
  const w = lab.w(), ph = w.phase;
  const 待ち = lab.d.expectedMembers(lab.room);
  if (ph === 'reveal' || ph === 'preVote') { 待ち.forEach((id) => lab.act(id, null)); if (lab.w().phase === ph) lab.締め切り(); return; }
  if (ph === 'vote') {
    // 1人目のウルフに票を集める（当たる回）
    const 的 = w.wolfIds[0];
    待ち.forEach((id) => { lab.vote(id, id === 的 ? 待ち.find((x) => x !== id) : 的); });
    if (lab.w().phase === ph) lab.締め切り();
    return;
  }
  lab.締め切り();
}

/** 爆弾：正しい答えは本物の判定（BombLogic.isCorrect）で選ぶ（fx-probe.js と同じ） */
function 爆弾_解く(lab, id) {
  const w = lab.w(), e = w.entries[w.mode === 'coop' ? 'team' : id];
  const uid = e.order.find((u) => !e.solved[u] && !Object.keys(w.open).some((k) => k !== id && w.open[k] === u));
  if (!uid) return false;
  const wire = w.wires.find((x) => x.uid === uid);
  lab.d.submitAction(lab.room, id, uid);
  const ok = (e.choices[uid] || []).find((c) => BombLogic.isCorrect(wire, c));
  lab.d.submitVote(lab.room, id, ok);
  return true;
}
function 爆弾_外す(lab, id) {
  const w = lab.w(), e = w.entries[w.mode === 'coop' ? 'team' : id];
  const uid = e.order.find((u) => !e.solved[u] && !Object.keys(w.open).some((k) => k !== id && w.open[k] === u));
  if (!uid) return false;
  const wire = w.wires.find((x) => x.uid === uid);
  lab.d.submitAction(lab.room, id, uid);
  const ng = (e.choices[uid] || []).find((c) => !BombLogic.isCorrect(wire, c));
  lab.d.submitVote(lab.room, id, ng);
  return true;
}
function 爆弾_開ける(lab, id) {
  const w = lab.w(), e = w.entries[w.mode === 'coop' ? 'team' : id];
  const uid = e.order.find((u) => !e.solved[u] && !Object.keys(w.open).some((k) => w.open[k] === u));
  if (uid) lab.d.submitAction(lab.room, id, uid);
}

/** オークション：下見で全員がアイテムを選び、品ごとに入札・値踏みまで本物の操作で進める */
function オークションの一手(lab) {
  const w = lab.w(), ph = w.phase, ids = lab.ids;
  if (ph === 'preview') {
    ids.forEach((id, i) => lab.act(id, null, { pick: AuctionLogic.POWERS[i % AuctionLogic.POWERS.length].id }));
    if (lab.w().phase === ph) lab.締め切り();
    return;
  }
  if (ph === 'bid') {
    if (w.mode === 'open') {
      // せり上げ：3人が順に1ずつ吊り上げる
      ids.slice(0, 3).forEach((id, i) => { lab.vote(id, null, { amount: (w.highest ? w.highest.amount : 0) + 1 + i }); });
      lab.締め切り();
    } else {
      ids.forEach((id, i) => lab.vote(id, null, { amount: i % 3 === 0 ? 0 : Math.min(w.chips[id], 1 + ((i * 3) % 5)) }));
      if (lab.w().phase === ph) lab.締め切り();
    }
    return;
  }
  if (ph === 'guess') {
    const q = AuctionItems.QUALITIES ? AuctionItems.QUALITIES.map((x) => x.id) : ['fine', 'plain', 'fake'];
    ids.forEach((id, i) => { if (!w.lastResult || w.lastResult.winnerId !== id) lab.vote(id, null, { guess: q[i % q.length] }); });
    lab.締め切り();
    return;
  }
  lab.締め切り();
}

/** クイズラッシュ：全員が難易度を選んで、何問か答える（当たる人と外す人を混ぜる） */
function ラッシュ_何問か(lab, 回) {
  const w = lab.w();
  for (let r = 0; r < 回; r++) {
    lab.ids.forEach((id, i) => {
      const s = w.rush.seats[id];
      if (!s.q) { s.coolUntil = 0; lab.act(id, ['easy', 'normal', 'hard'][i % 3]); }
      const q = w.rush.seats[id].q;
      if (!q) return;
      const 当てる = ((i + r) % 3) !== 2;
      const 正 = q.correct != null ? q.correct : 0;
      lab.vote(id, null, { targetId: 当てる ? 正 : (正 + 1) % q.choices.length });
    });
  }
  // 最後に、半分の人は次の問題を開いたまま（答えている最中）にしておく
  lab.ids.forEach((id, i) => { if (i % 2 === 0) { w.rush.seats[id].coolUntil = 0; lab.act(id, 'normal'); } });
}

/** つぎつぎクイズ：手番の人が、お題の答え（本物の一覧）を言う。k 回に1回は外す */
function つぎつぎ_何手か(lab, 手, 外す間隔) {
  const w = lab.w();
  for (let t = 0; t < 手 && !lab.ended(); t++) {
    const l = w.list, id = l.order[l.at];
    const 残り = l.topic.answers.filter((a) => l.said.indexOf(a) === -1);
    const 外す = 外す間隔 && (t % 外す間隔 === 外す間隔 - 1);
    lab.vote(id, null, { targetId: 外す ? (l.said[0] || 'わからない') : 残り[t % Math.max(1, 残り.length)] });
  }
}

// ======================= 同着を作る =======================
// どれも「決着した部屋」の中の点を揃える。順位を付けるのは本物の進行役（resultView・rank）のまま。

const 同着 = {
  /** クイズ王：ranking は w.scores から（resultView を呼ぶたびに計算し直す） */
  quiz(lab, k) {
    const w = lab.w();
    lab.ids.forEach((id, i) => { w.scores[id] = i < k ? 12 : Math.max(0, 9 - i); });
  },
  /** オークション：点は持ち物と相場とチップから。持ち物を空にしてチップで揃える */
  auction(lab, k) {
    const w = lab.w();
    lab.ids.forEach((id, i) => { w.won[id] = []; w.chips[id] = i < k ? 30 : Math.max(0, 24 - i * 3); });
    w.result = null;   // 決着の時に固めた結果を捨てて、publicView に計算し直させる（auction-room.js：w.result || resultView）
  },
  /** 爆弾（競争）：解いた数と最後に解いた時刻が同じなら同着（BombLogic.rankPlayers） */
  bombRace(lab, k) {
    const w = lab.w(), t = Date.now() - 30000;
    lab.ids.forEach((id, i) => {
      const e = w.entries[id];
      e.failed = false;
      e.solvedCount = i < k ? 9 : Math.max(0, 7 - i);
      e.lastSolveAt = i < k ? t : t + 1000 * (i + 1);
    });
  },
  /** すごろく（つうこうりょう・てふだ・どこにいる？）：あがっていない、位置とコインが同じなら同着 */
  sugoPos(lab, k) {
    const w = lab.w();
    lab.ids.forEach((id, i) => {
      w.goalOrder[id] = null;
      w.pos[id] = i < k ? 20 : Math.max(0, 16 - i * 2);
      if (w.coins) w.coins[id] = 5;
    });
  },
  /** ふたりでひとつ：順位は「組」に付く */
  sugoPair(lab, k) {
    const w = lab.w();
    w.groups.forEach((g, i) => { g.goalOrder = null; g.pos = i < k ? 20 : Math.max(0, 16 - i * 2); });
  },
  /** こまはひとつ：先にあがらせた人がいなければ、残りはコインの多い順 */
  sugoGrab(lab, k) {
    const w = lab.w();
    w.winnerId = null;
    lab.ids.forEach((id, i) => { w.coins[id] = i < k ? 9 : Math.max(0, 7 - i); });
  }
};

/** 進化じゃんけん：結果は決着の瞬間に固まる（finish）。だから**1試合やり直して**、段を揃えてから時間切れで決着させる */
function* 進化じゃんけんの同着(lab, ks, cfg) {
  for (const k of ks) {
    delete lab.room.shinka;
    lab.開始(cfg);
    const w = lab.w();
    // 1回だけ手を出して「開く」（REVEAL）まで進める
    for (let i = 0; i < 20 && w.phase !== 'hands'; i++) lab.一手();
    if (w.phase !== 'hands') throw new Error('進化じゃんけん：開く段階に届きません');
    if (w.matches.some((m) => m.champion)) throw new Error('進化じゃんけん：同着を作る前に優勝が出ました');
    const 上 = w.はしご.段.length - 2;
    lab.ids.forEach((id, i) => { w.状態[id].段 = i < k ? 上 : Math.max(0, 上 - 1 - (i % 3)); });
    w.endsAt = Date.now() - 1;     // 10分が来た（打ち切り）→ その時の段で順位
    lab.d.advance(lab.room);
    yield 'ended-tie' + k;
  }
}

// ======================= シナリオの一覧（データ） =======================
// counts は「4・8・16 を、そのゲームの上限で切ったもの」（上限は コードから読む）
// ties は同着を作る方法（無いゲームは同着の場面を出さない）

const 決着の同着 = [1, 2, 4, 6];

function* 決着と同着(lab, 揃える, 何組) {
  yield 'ended';
  if (!揃える) return;
  const 母数 = 何組 != null ? 何組 : lab.ids.length;
  for (const k of 決着の同着) {
    if (k > 母数) continue;
    揃える(lab, k);
    yield 'ended-tie' + k;
  }
}

// 入場の知らせを2つ（長い名前で）。B の細い柱で名前が0幅になり、言葉が画面の右の外へ出ていた（指示64の見直し）。
// 知らせは2.6秒で消えるので、本物の測りでは一度も撮れていなかった
const 入場の知らせ = "window.bigEntryProbe([{icon:'🐉',name:'あいうえおかきくけこさし'},{icon:'🦊',name:'たかはしゆういちろう'}])";
// ふつうの長さの名前で2人いっしょに（QRをいっしょに読んだ2人。長い名前だけで測ると「省略は名前が長いから」で済んでしまう）
const 入場の知らせ2 = "window.bigEntryProbe([{icon:'👑',name:'まりこ'},{icon:'🎭',name:'そうた'}])";

const SCENARIOS = [
  // ---- 待合（ゲームがまだ決まっていない） ----
  {
    name: 'lobby', game: null,
    run: function* (lab) {
      lab.room.state = { phase: 'lobby', game: null, data: {} };
      yield 'none';
      yield { label: 'entry', page: 入場の知らせ };
      yield { label: 'entry2', page: 入場の知らせ2 };
    }
  },
  // ---- 人狼（人数で、本物のモードを選ぶ：5人からノーマル） ----
  {
    name: 'wolfrole', game: 'wolfrole', modeId: (n) => n >= 5 ? 'wolf-normal' : 'wolf-casual',
    run: function* (lab) {
      const pre = 人狼のプリセット(lab.spec.modeId);
      lab.待合(Math.ceil(lab.n / 4)); yield 'lobby-picked';
      yield { label: 'lobby-entry', page: 入場の知らせ };
      yield { label: 'lobby-entry2', page: 入場の知らせ2 };
      // rtWolfroleConfig と同じ形（プリセットのまま・作戦会議は話し合いの時間 180秒）
      lab.開始({ game: 'wolfrole', roles: pre.roles || ['wolf', 'seer'], chaos: !!pre.chaos, turnLimit: pre.turnLimit || 5,
        seerResult: pre.seerResult, revealRoleOnDeath: pre.revealRoleOnDeath, wolfAttackDecision: pre.wolfAttackDecision,
        teruteruContinue: pre.teruteruContinue, lovers: pre.lovers, nightTimeLimit: pre.nightTimeLimit || 0,
        meetingSec: 180, preset: lab.spec.modeId });
      yield* 人狼(lab);
      yield 'ended';
    }
  },
  {
    name: 'wordwolf', game: 'wordwolf', modeId: 'wordwolf',
    run: function* (lab) {
      lab.待合(Math.ceil(lab.n / 4)); yield 'lobby-picked';
      lab.開始(Object.assign({}, RT_START_MIN_CONFIG.wordwolf, { meetingSec: 180, discussSec: 180, preset: 'wordwolf' }));
      yield* 段階ごとに(lab, { 動く: ワードウルフの一手 });
      yield 'ended';
    }
  },
  // ---- 爆弾解除（クイズ解除）：協力と競争 ----
  ...['coop', 'race'].map((mode) => ({
    name: 'bomb-' + mode, game: 'bomb', modeId: 'bomb-' + mode,
    run: function* (lab) {
      lab.待合(Math.ceil(lab.n / 4)); yield 'lobby-picked';
      // 端末の既定（index.html state.bombCounts・3ライフ・180秒）
      lab.開始({ game: 'bomb', mode, endWhen: mode === 'race' ? 'first' : null,
        counts: { easy: 12, normal: 10, hard: 8, nanisore: 0, muri: 0 }, lives: 3, showMisses: false,
        timerSec: 180, preset: 'bomb-' + mode });
      yield 'play';
      // 何人かがコードを開けている（大画面の「いま誰がどれに」）
      lab.ids.forEach((id, i) => { if (i % 2 === 0) 爆弾_開ける(lab, id); });
      yield 'play-open';
      // 解いたり外したり（協力：ライフが1つ減る／競争：人ごとに進みがばらける）
      lab.ids.forEach((id, i) => {
        for (let k = 0; k < (mode === 'coop' ? 1 : (i % 5) + 1); k++) 爆弾_解く(lab, id);
        if (i === 1) 爆弾_外す(lab, id);
      });
      yield 'play-mid';
      if (mode === 'coop') {
        // 爆発の回：外し続けてライフ0
        const room2 = lab.room;
        for (let i = 0; i < 6 && !lab.ended(); i++) 爆弾_外す(lab, lab.ids[i % lab.ids.length]);
        if (!lab.ended()) throw new Error('爆弾（協力）：ライフ0に届きません');
        yield 'ended-boom';
        // 解除の回：同じ人数でもう一度始め、全部解く
        delete room2.bomb;
        lab.開始({ game: 'bomb', mode, counts: { easy: 6, normal: 4, hard: 2 }, lives: 3, timerSec: 180, preset: 'bomb-coop' });
        for (let i = 0; i < 200 && !lab.ended(); i++) 爆弾_解く(lab, lab.ids[i % lab.ids.length]);
        if (!lab.ended()) throw new Error('爆弾（協力）：全部解けません');
        yield 'ended-clear';
      } else {
        // 競争：1人が全部解いた瞬間に終わる（endWhen first）
        for (let i = 0; i < 400 && !lab.ended(); i++) 爆弾_解く(lab, lab.ids[0]);
        if (!lab.ended()) lab.締め切り();
        yield* 決着と同着(lab, 同着.bombRace);
      }
    }
  })),
  // ---- 実物解除 ----
  ...['defuse', 'defuse-focus'].map((modeId) => ({
    name: modeId, game: 'defuse', modeId,
    run: function* (lab) {
      lab.待合(Math.ceil(lab.n / 4)); yield 'lobby-picked';
      lab.開始({ game: 'defuse', mode: modeId === 'defuse-focus' ? 'focus' : 'normal', moduleCount: 5, strikes: 3,
        manual: true, allowPhysical: true, allowCamera: true, timerSec: 300, preset: modeId });
      yield 'consent';
      lab.ids.forEach((id, i) => lab.act(id, i === 2 ? 'no' : 'yes'));
      yield 'roles';
      const caps = { orientation: true, compass: true, motion: true, camera: true };
      // 集中解除はマニュアル役1人・ほかは解除役。通常は半々（payload に端末のセンサーを添える：本物と同じ）
      lab.ids.forEach((id, i) => {
        const 役 = modeId === 'defuse-focus' ? (i === 1 ? 'manual' : 'defuser') : (i % 2 === 0 ? 'defuser' : 'manual');
        lab.act(id, 役, { targetId: 役, caps });
      });
      yield 'brief';
      lab.ids.forEach((id) => lab.act(id, null));
      if (lab.w().phase === 'brief') lab.締め切り();
      yield 'play';
      // 解除役がモジュールを開ける（大画面の「いま誰がどれに」）
      const w = lab.w();
      lab.ids.filter((id) => w.roles[id] === 'defuser').forEach((id, i) => {
        const m = w.modules.filter((x) => !x.solved)[i];
        if (m) lab.d.submitAction(lab.room, id, m.uid);
      });
      yield 'play-open';
      // 決着：時間切れ（本物の checkEnd）
      w.deadline = Date.now() - 1; lab.d.advance(lab.room);
      if (!lab.ended()) throw new Error('実物解除：時間切れで決着しません');
      yield 'ended-time';
    }
  })),
  // ---- クイズ王 ----
  {
    name: 'quizrush', game: 'quizrush', modeId: 'quizrush',
    run: function* (lab) {
      lab.待合(Math.ceil(lab.n / 4)); yield 'lobby-picked';
      lab.開始({ game: 'quizrush', timerSec: 180, passLimit: 3, canChangeTier: true, roundsToWin: 0, preset: 'quizrush' });
      yield 'play';
      ラッシュ_何問か(lab, 4);
      yield 'play-mid';
      lab.締め切り();
      while (!lab.ended()) lab.締め切り();
      yield* 決着と同着(lab, 同着.quiz);
    }
  },
  // ラウンドのあるクイズラッシュ（「第2ラウンド」）。それまで添え書きに出て順位表の高さを削っていたが、
  // 実験台の場面はラウンド無し（roundsToWin 0）だけで、その形は一度も測られていなかった（指示64の見直しの反証）
  {
    name: 'quizrush-rounds', game: 'quizrush', modeId: 'quizrush',
    run: function* (lab) {
      lab.開始({ game: 'quizrush', timerSec: 180, passLimit: 3, canChangeTier: true, roundsToWin: 2, preset: 'quizrush' });
      yield 'play';
      ラッシュ_何問か(lab, 4);
      yield 'play-mid';
    }
  },
  ...['coop', 'survival'].map((style) => ({
    name: 'quizlist-' + style, game: 'quizlist', modeId: 'quizlist',
    run: function* (lab) {
      lab.待合(Math.ceil(lab.n / 4)); yield 'lobby-picked';
      lab.開始({ game: 'quizlist', timerSec: 180, style, targetCount: 10, turnSec: 20, preset: 'quizlist' });
      yield 'play';
      つぎつぎ_何手か(lab, Math.min(6, lab.n + 2), style === 'survival' ? 3 : 4);
      yield 'play-mid';
      for (let i = 0; i < 80 && !lab.ended(); i++) つぎつぎ_何手か(lab, 1, style === 'survival' ? 2 : 0);
      if (!lab.ended()) { lab.w().list.overallEndsAt = Date.now() - 1; lab.締め切り(); }
      yield 'ended';
    }
  })),
  {
    name: 'quizreveal', game: 'quizreveal', modeId: 'quizreveal',
    run: function* (lab) {
      lab.待合(Math.ceil(lab.n / 4)); yield 'lobby-picked';
      lab.開始({ game: 'quizreveal', timerSec: 180, questionCount: 8, revealSec: 20, preset: 'quizreveal' });
      yield 'play';
      // 1人が押して答えている最中
      lab.act(lab.ids[1], null, {});
      yield 'play-buzzed';
      yield* 段階ごとに(lab, {});
      yield* 決着と同着(lab, 同着.quiz);
    }
  },
  {
    name: 'buzzer', game: 'buzzer', modeId: 'buzzer-rt',
    run: function* (lab) {
      lab.待合(Math.ceil(lab.n / 4)); yield 'lobby-picked';
      lab.開始({ game: 'buzzer', winsNeeded: 3, delivery: 'speak', preset: 'buzzer-rt' });
      // 対戦が変わるたび（break）と、早押しの最中を撮る
      yield* 段階ごとに(lab, { 何枚: 2 });
      yield 'ended';
    }
  },
  // 早押し：**全員が長い名前**で、問題を文字で出す（得点板「名前 1 − 0 名前」が2行で収まるか）。
  // 名前は12字まで（rtJoinName maxlength）。本物の部屋と同じく、始める前に名前が決まっている
  {
    name: 'buzzer-long', game: 'buzzer', modeId: 'buzzer-rt',
    run: function* (lab) {
      const 長い = ['あいうえおかきくけこさし', 'たかはしゆういちろう', 'しょうたろうくんだよ', 'みさきおねえちゃんだ',
        'さくらさくらさくらさ', 'はるとはるとはると', 'ななななななななな', 'えまえまえまえまえま'];
      lab.ids.forEach((id, i) => { lab.room.members.get(id).name = 長い[i % 長い.length]; });
      lab.開始({ game: 'buzzer', winsNeeded: 3, delivery: 'text', preset: 'buzzer-rt' });
      yield* 段階ごとに(lab, { 何枚: 2 });
    }
  },
  // ---- オークション ----
  ...['open', 'sealed'].map((mode) => ({
    name: 'auction-' + mode, game: 'auction', modeId: 'auction-' + mode,
    run: function* (lab) {
      lab.待合(Math.ceil(lab.n / 4)); yield 'lobby-picked';
      lab.開始({ game: 'auction', mode, rounds: AuctionLogic.RULES.ROUNDS_DEFAULT,
        previewSec: AuctionLogic.RULES.PREVIEW_SEC_DEFAULT, preset: 'auction-' + mode });
      yield* 段階ごとに(lab, { 動く: オークションの一手, max: 300 });
      yield* 決着と同着(lab, 同着.auction);
    }
  })),
  // 値踏み（落札しなかった人が正体を予想する間）を、**いちばん長い品の見た目**で。一枚看板が96pxで2行になり、
  // 8人の名簿の2段目が画面の下へ押し出されていた（census で見つかり、この実験台では測れていなかった）
  {
    name: 'auction-long', game: 'auction', modeId: 'auction-open',
    run: function* (lab) {
      lab.開始({ game: 'auction', mode: 'open', rounds: AuctionLogic.RULES.ROUNDS_DEFAULT,
        previewSec: AuctionLogic.RULES.PREVIEW_SEC_DEFAULT, preset: 'auction-open' });
      const 長い = AuctionLogic.Items.ITEMS.map((x) => x.look).sort((a, b) => Array.from(b).length - Array.from(a).length)[0];
      lab.w().items.forEach((it) => { it.look = 長い; });
      for (let i = 0; i < 300 && lab.w().phase !== 'guess' && !lab.ended(); i++) オークションの一手(lab);
      if (lab.w().phase !== 'guess') throw new Error('値踏みに届きません（いま ' + lab.w().phase + '）');
      yield 'guess-long';
    }
  },
  // ---- すごろく5つ ----
  ...[['sugotoll', 同着.sugoPos], ['sugograb', 同着.sugoGrab], ['sugopair', 同着.sugoPair, true],
      ['sugohide', 同着.sugoPos], ['sugohand', 同着.sugoPos]].map(([game, 揃える, 組]) => ({
    name: game, game, modeId: game,
    run: function* (lab) {
      lab.待合(Math.ceil(lab.n / 4)); yield 'lobby-picked';
      // rnd：sugoroku-room.js だけは乱数を**読み込んだ時の Math.random** で握っている（`let rnd = Math.random`）。
      // 種つきに差し替えても届かず、盤と出目が毎回変わっていた（2回回して比べて分かった）。
      // 検査用の穴（cfg.rnd・本番の端末は送らない）に、いまの種つき乱数を渡す
      lab.開始({ game, events: true, losersMove: true, pairStyle: 'even', preset: game, rnd: Math.random });
      yield* 段階ごとに(lab, { max: 600 });
      yield* 決着と同着(lab, 揃える, 組 ? lab.w().groups.length : null);
    }
  })),
  // ---- False or True ----
  {
    name: 'falsetrue', game: 'falsetrue', modeId: 'falsetrue',
    run: function* (lab) {
      lab.待合(Math.ceil(lab.n / 4)); yield 'lobby-picked';
      lab.開始({ game: 'falsetrue', talkSec: 60 });
      yield* 段階ごとに(lab, {});
      yield 'ended';
    }
  },
  // 短い名前と長い名前が向かい合う（「まりこ　VS／たかはしゆういちろう」と、VS が先の人にだけ付いて見えた）
  {
    name: 'falsetrue-mixed', game: 'falsetrue', modeId: 'falsetrue',
    run: function* (lab) {
      const 名 = ['ひろ', 'たかはしゆういちろう', 'ゆい', 'あいうえおかきくけこさし'];
      lab.ids.forEach((id, i) => { lab.room.members.get(id).name = 名[i % 名.length] + (i >= 名.length ? i : ''); });
      lab.開始({ game: 'falsetrue', talkSec: 60 });
      yield* 段階ごとに(lab, {});
    }
  },
  // ---- ロシアンカード（生きのこり戦。1位は1人：同着は同じ回に両方0になった時だけで、ここでは作らない） ----
  {
    name: 'rcard', game: 'rcard', modeId: 'rcard',
    run: function* (lab) {
      lab.待合(Math.ceil(lab.n / 4)); yield 'lobby-picked';
      lab.開始(Object.assign({}, RT_START_MIN_CONFIG.rcard));
      yield* 段階ごとに(lab, { 何枚: 2 });
      yield 'ended';
    }
  },
  // ---- 進化じゃんけん ----
  {
    name: 'shinka', game: 'shinka', modeId: 'shinka',
    run: function* (lab) {
      lab.待合(Math.ceil(lab.n / 4)); yield 'lobby-picked';
      const cfg = Object.assign({}, RT_START_MIN_CONFIG.shinka);
      lab.開始(cfg);
      yield* 段階ごとに(lab, { 何枚: 2, max: 800 });
      yield 'ended';
      yield* 進化じゃんけんの同着(lab, 決着の同着.filter((k) => k <= lab.n), cfg);
    }
  },
  // 「たくさん」の段（10段・2列）。段の名前が長く（チャレンジャー）、人の札が隣の列にかぶっていた。
  // それまでの実験台はふつうの段（5段）しか測っていなかった（指示64の見直し2回目の反証）
  {
    name: 'shinka-cs', game: 'shinka', modeId: 'shinka',
    run: function* (lab) {
      const cfg = Object.assign({}, RT_START_MIN_CONFIG.shinka, { ladder: 'cs' });
      lab.開始(cfg);
      yield* 段階ごとに(lab, { 何枚: 2, max: 800 });
      yield 'ended';
    }
  }
];

// ---- 上限：端末の数字と、進行役の門の両方を通る数 ----
const _上限 = {};
function 上限(gameId) {
  if (gameId == null) return RT.ROOM_MAX_PLAYERS;
  if (_上限[gameId] != null) return _上限[gameId];
  let cap = 端末の上限(gameId);
  // 進行役が受け付けるかを実際に始めて確かめる（受け付けないなら1つずつ下げる）
  const d = GAME_DRIVERS[gameId].driver;
  for (; cap > 2; cap--) {
    const room = 部屋を作る(cap);
    const res = d.startGame(room, Object.assign({}, RT_START_MIN_CONFIG[gameId]), { describe: async () => ({}), notify() {} });
    if (res && res.ok) break;
    if (!res || res.error !== 'too_many_players') break;
  }
  _上限[gameId] = cap;
  return cap;
}
function 人数(spec) {
  const cap = 上限(spec.game);
  // 20 は部屋の上限（realtime.js ROOM_MAX_PLAYERS）。上限なしのゲームは 17〜20人でも遊べる——
  // 16 で止めていたので、xl（17人以上）の置き方は一度も測られていなかった（指示64の監査）
  return Array.from(new Set([4, 8, 16, RT.ROOM_MAX_PLAYERS].map((n) => Math.min(n, cap))));
}

/**
 * 1つのシナリオ×人数を回す。戻り値は generator：next() のたびに { label, snap, view } を返す。
 * **snap は yield を受けたその瞬間に取る**（時計の残りが本物のまま）。乱数は種つきで固定する。
 */
function* 回す(spec, n) {
  const modeId = typeof spec.modeId === 'function' ? spec.modeId(n) : spec.modeId;
  if (spec.game && modeId && モードのゲーム(modeId) !== spec.game) {
    throw new Error('モード ' + modeId + ' は index.html の MODES で ' + spec.game + ' のモードではありません');
  }
  const 元の乱数 = Math.random;
  Math.random = 種つき(n * 1000 + spec.name.length * 17 + spec.name.charCodeAt(0));
  try {
    const s = Object.assign({}, spec, { modeId });
    const lab = spec.game ? 始める(s, n) : { room: 部屋を作る(n), n, spec: s, ids: [] };
    const it = spec.run(lab);
    for (;;) {
      const r = it.next();
      if (r.done) return;
      const snap = スナップ(lab.room);
      const view = snap.state && snap.state.data;
      // **`\d` の `\` を落とさない**——`/tie(d+)$/` になっていて、この確かめは一度も効いていなかった
      //（「ended-tie2」に当たらず、1位が何人でも「作れた」ことになっていた・指示64の見直しで見つけた）
      const want = /tie(\d+)$/.exec(typeof r.value === 'string' ? r.value : r.value.label);
      // yield は名前（字）か、{ label, page }。page は描いたあとにページで評価する式（入場の知らせを出す等）
      const label = typeof r.value === 'string' ? r.value : r.value.label;
      const out = { label, snap, 一位: want ? 一位の数(view) : null, page: (r.value && r.value.page) || null };
      // 同着を作ったつもりで作れていないものは、出さずに理由を返す（落とし穴10-b）
      if (want && out.一位 !== parseInt(want[1], 10)) {
        out.作れなかった = '1位が ' + want[1] + ' 人のはずが ' + out.一位 + ' 人';
      }
      yield out;
    }
  } finally {
    // 道具の外（CDP の通信など）へ種つきの乱数を持ち出さない
    Math.random = 元の乱数;
  }
}

module.exports = { SCENARIOS, 人数, 上限, 回す, 部屋を作る, スナップ, NAMES, ROOM_CODE, TV_ID, 一位の数 };
