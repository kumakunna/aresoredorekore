#!/usr/bin/env node
// tools/fx-probe.js — 「その瞬間、演出が本当に出たか」を数える道具（第47弾）
//
// **なぜリポジトリに置くか。**
// 演出が出る／出ないは、通信を見るテストでは捕まらない（落とし穴12）。
// かといってブラウザの実測は、枠が裏に回ると CSS アニメーションの時計ごと
// 止まるので嘘をつく（落とし穴28）。
// この道具は jsdom の上で **本物の進行役（*-room.js）を動かし、
// 本物の publicView / privateFor を本物の画面へ流して**、
// 出ている最中に `.bomb-boom` などを数える（落とし穴25・落とし穴10-g）。
//
// ── 使い方 ────────────────────────────────────────
//   node tools/fx-probe.js bomb coop        # 協力版のライフ0
//   node tools/fx-probe.js bomb race        # 競争版の全員脱落
//   node tools/fx-probe.js bomb coop --big  # 同じ場面を「大画面の端末」で見る
//   node tools/fx-probe.js bomb coop --reversed
//                                           # 秘密が先・部屋の知らせが後（落とし穴18の順）
//   node tools/fx-probe.js bomb coop --late # 解除中を一度も見ずに決着だけ届く
//
//   node tools/fx-probe.js falsetrue true    # 中身が TRUE の回（緑の光＋「生存」）
//   node tools/fx-probe.js falsetrue false   # 中身が FALSE の回（赤の光。**脱落は静かに**）
//   node tools/fx-probe.js falsetrue true --big    # 同じ場面を大画面の端末で
//   node tools/fx-probe.js falsetrue true --skip   # スキップ（演出を出さず結果だけ）
//
// 出るのは「場面ごとの演出の数」。**0 は「出なかった」**という意味で、
// 実装が壊れた時にここが 1 → 0 に動く。
//
// **数え方の決めごと**（落とし穴10-g）：
//   演出は自分で片付くので、**片付いたあとに数えない**。
//   各段階の直後（80ms）で数え、最後にもう一度だけ数える。
//   最後の「少しあと」は、**連なって遅れて出るもの**を見るための1枚
//  （例：閃光が引いてから出る「爆発」のコールアウト）。早すぎても嘘になる。

const path = require('path');
const ROOT = path.join(__dirname, '..');
const H = require(path.join(ROOT, 'tests', 'harness'));
const { launch, activeScreen, sleep, waitFor, waitScreen, el, click, openCassette } = H;
const Bomb = require(path.join(ROOT, 'bomb-room.js'));
const FalseTrue = require(path.join(ROOT, 'falsetrue-room.js'));

const argv = process.argv.slice(2);
const game = argv[0] || 'bomb';
const mode = argv[1] || 'coop';
const opt = (name) => argv.indexOf('--' + name) !== -1;
const BIG = opt('big');
const REVERSED = opt('reversed');
const LATE = opt('late');
const SKIP = opt('skip');
// 指示55：**大画面の中身も見る。**演出の数だけだと「画面が空でも0は0」で見分けられない
const DUMP = opt('dump');

if (game !== 'bomb' && game !== 'falsetrue') {
  console.error('いまは bomb と falsetrue。ほかのゲームを足す時は、その *-room.js を同じ形で呼ぶ');
  process.exit(2);
}

// ---- 本物の進行役を立てる ----
function makeRoom(mode) {
  const members = new Map();
  ['m2', 'm3'].forEach((id, i) =>
    members.set(id, { id, name: ['びび', 'ちか'][i], role: 'player', connected: true, socketId: 's' + id }));
  const room = { code: 'ABC234', members, state: { phase: 'lobby', game: null, data: {} } };
  const r = Bomb.startGame(room, { mode, counts: { easy: 4 }, lives: 3, timerSec: 0 }, {});
  if (!r.ok) throw new Error(JSON.stringify(r));
  return room;
}
function wrongAnswer(room, mid, uid) {
  const w = room.bomb, wire = w.wires.find((x) => x.uid === uid);
  const e = w.entries[w.mode === 'coop' ? 'team' : mid];
  return (e.choices[uid] || []).find((c) => c !== wire.answer && c !== wire.name);
}
function missOnce(room, mid) {
  const w = room.bomb, e = w.entries[w.mode === 'coop' ? 'team' : mid];
  const uid = e.order.find((u) => !e.solved[u]);
  if (!uid) return false;
  Bomb.submitAction(room, mid, uid);
  Bomb.submitVote(room, mid, wrongAnswer(room, mid, uid));
  return true;
}

// この端末（m1）は、既定ではプレイヤー。--big なら大画面
const MY_ROLE = BIG ? 'bigscreen' : 'player';
const MY_ID = 'm1';

// ================= 指示53：False or True =================
//
// 見たいのは3つ：
//   ① 中身が開く瞬間に、**画面いっぱいの光**が出る（TRUE は緑・FALSE は赤）
//   ② **生存だけコールアウト。脱落は静かに**（原則C：責める時は静かに）
//   ③ **スキップにすると、演出は出ずに結果だけが出る**（大切なこと7）
//
// 光は自分で片付くので、出ている最中に数える（落とし穴10-g）。
function ftMakeRoom(want) {
  const members = new Map();
  ['m1', 'm2', 'm3', 'm4'].forEach((id, i) =>
    members.set(id, {
      id, name: ['あき', 'びび', 'ちか', 'でん'][i],
      role: 'player', connected: true, socketId: 's' + id
    }));
  const room = { code: 'ABC234', members, state: { phase: 'lobby', game: null, data: {} } };
  let x = 7;
  const rand = () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
  const r = FalseTrue.startGame(room, { game: 'falsetrue', talkSec: 30, _rand: rand }, {});
  if (!r.ok) throw new Error(JSON.stringify(r));
  // **中身を決め打ちにする**（検体を作るためだけに触る）。
  // TRUE の回と FALSE の回で、出る演出が違うことを見たい
  room.falsetrue.contents = room.falsetrue.contents.map(() => want === 'true');
  return room;
}
/** 段階を、本物の advance で進める（締め切りを追い越すだけ） */
function ftTo(room, phase, take) {
  for (let i = 0; i < 40; i++) {
    const w = room.falsetrue;
    if (w.phase === phase) return;
    if (w.phase === 'decide' && take !== undefined) w.choice = take ? 'take' : 'keep';
    w.deadline = Date.now() - 1;
    FalseTrue.advance(room);
  }
  throw new Error('段階 ' + phase + ' に届かない（いま ' + room.falsetrue.phase + '）');
}

async function mainFalsetrue() {
  const want = (mode === 'false') ? 'false' : 'true';   // 既定は TRUE（生存が出る回）
  // **スキップは本番と同じ道で入れる**（localStorage → appPrefs → fxMs と .fx-skip の三層）。
  // window に手で書くと、アプリが実際に通る道とは別のものを試すことになる（落とし穴25）
  const { win, doc, errors } = await launch({ fakeSocket: true, fxSkip: SKIP });
  await waitScreen(win, doc, 'scr-shelf', 8000);
  await openCassette(win, doc, 'falsetrue');
  click(doc, doc.querySelector('#wayChoices [data-way="room"]'));
  await waitScreen(win, doc, 'scr-rt-lobby', 4000);
  const fake = win.__rtFake;
  await waitFor(win, () => fake.connected, 4000, 'socket');

  const room = ftMakeRoom(want);
  const MY_ID = BIG ? 'tv' : 'm1';
  if (BIG) room.members.set('tv', { id: 'tv', name: 'TV', role: 'bigscreen', connected: true, socketId: 'stv' });

  const memberRows = () => {
    const rows = [];
    if (BIG) rows.push({ id: 'tv', name: 'TV', role: 'bigscreen', connected: true, isHost: false, ready: true });
    ['m1', 'm2', 'm3', 'm4'].forEach((id, i) => rows.push({
      id, name: ['あき', 'びび', 'ちか', 'でん'][i],
      role: 'player', connected: true, isHost: i === 0, ready: true
    }));
    return rows;
  };
  const snap = () => ({
    code: 'ABC234', ownerUserId: 1, ownerUsername: 'kuma', hostMemberId: 'm1',
    playerCount: 4, memberCount: memberRows().length,
    ready: { count: 4, total: 4, waitingNames: [], all: true },
    members: memberRows(),
    state: { phase: room.state.phase, game: 'falsetrue', data: FalseTrue.publicView(room) }
  });
  fake.replies = { 'room:create': () => ({ ok: true, code: 'ABC234', memberId: MY_ID, room: snap() }) };
  el(doc, 'rtCreateName').value = BIG ? 'TV' : 'あき';
  click(doc, 'rtCreateBtn');
  await sleep(win, 300);

  const push = () => {
    const mine = FalseTrue.privateFor(room, MY_ID);
    if (REVERSED) { if (mine) fake.fire('wolf:you', mine); fake.fire('room:update', snap()); }
    else { fake.fire('room:update', snap()); if (mine) fake.fire('wolf:you', mine); }
  };

  const rows = [];
  const count = (tag) => rows.push({
    tag,
    画面: activeScreen(doc),
    光: doc.querySelectorAll('.fx-flash').length,
    光の色: (doc.querySelector('.fx-flash') || { className: '' }).className.replace('fx-flash', '').trim() || '-',
    コールアウト: (doc.querySelector('.fx-callout') || { textContent: '' }).textContent.trim() || '-',
    紙吹雪: doc.querySelectorAll('.fx-confetti').length,
    中身の札: (() => {
      const b = doc.querySelector('.screen.active .ft-content');
      return b && !b.hidden ? (b.getAttribute('data-v') + ':' + b.textContent.replace(/\s+/g, ' ').trim()) : '-';
    })(),
    結果の札: (doc.querySelector('#ftOpenVerdict') || { textContent: '' }).textContent.replace(/\s+/g, ' ').trim() || '-'
  });

  // 話し合いまでは静かなはず（ここで光ったら、それ自体がおかしい）
  if (!LATE) {
    ftTo(room, 'talk');
    push();
    await sleep(win, 120);
    count('話し合い中');
  }
  // 決める → 開く。**奪わない**ので、持ち主の運命が中身で決まる
  ftTo(room, 'open', false);
  push();
  await sleep(win, 80);
  count('開いた直後');
  await sleep(win, 200);
  count('少しあと');
  // 連なって遅れて出るもの（コールアウトは光が引いてから）
  await sleep(win, 1000);
  count('もっとあと');

  // 決着まで
  ftTo(room, 'ended');
  push();
  await sleep(win, 200);
  count('決着');

  const label = ['falsetrue', '中身=' + want, BIG ? '大画面' : 'プレイヤー',
    REVERSED ? '順が逆' : null, LATE ? '決着だけ' : null, SKIP ? 'スキップ' : null]
    .filter(Boolean).join(' / ');
  console.log('== ' + label + ' ==');
  console.log('   サーバーの段階:', room.falsetrue.phase);
  rows.forEach((r) => console.log('   ', JSON.stringify(r)));
  console.log('   画面のエラー:', errors.length ? errors.slice(0, 2) : 'なし');
  win.close();
}

async function mainBomb() {
  const { win, doc, errors } = await launch({ fakeSocket: true });
  await waitScreen(win, doc, 'scr-shelf', 8000);
  await openCassette(win, doc, 'bakudan');
  click(doc, doc.querySelector('#wayChoices [data-way="room"]'));
  await waitScreen(win, doc, 'scr-rt-lobby', 4000);
  const fake = win.__rtFake;
  await waitFor(win, () => fake.connected, 4000, 'socket');

  const room = makeRoom(mode);
  const playerIds = BIG ? ['m2', 'm3'] : [MY_ID, 'm2'];
  if (!BIG) {
    // 自分もプレイヤーとして進行役に登録し直す
    room.members.set(MY_ID, { id: MY_ID, name: 'あき', role: 'player', connected: true, socketId: 'sm1' });
    room.members.delete('m3');
    const r = Bomb.startGame(room, { mode, counts: { easy: 4 }, lives: 3, timerSec: 0 }, {});
    if (!r.ok) throw new Error(JSON.stringify(r));
  }
  const memberRows = () => {
    const rows = [];
    if (BIG) rows.push({ id: MY_ID, name: 'TV', role: 'bigscreen', connected: true, isHost: false, ready: true });
    playerIds.forEach((id, i) => rows.push({
      id, name: (id === MY_ID ? 'あき' : (id === 'm2' ? 'びび' : 'ちか')),
      role: 'player', connected: true, isHost: i === 0, ready: true
    }));
    return rows;
  };
  const snap = () => ({
    code: 'ABC234', ownerUserId: 1, ownerUsername: 'kuma', hostMemberId: playerIds[0],
    playerCount: playerIds.length, memberCount: memberRows().length,
    ready: { count: playerIds.length, total: playerIds.length, waitingNames: [], all: true },
    members: memberRows(),
    state: { phase: room.state.phase, game: 'bomb', data: Bomb.publicView(room) }
  });
  fake.replies = { 'room:create': () => ({ ok: true, code: 'ABC234', memberId: MY_ID, room: snap() }) };
  el(doc, 'rtCreateName').value = BIG ? 'TV' : 'あき';
  click(doc, 'rtCreateBtn');
  await sleep(win, 300);

  const wantScreen = BIG ? 'scr-rt-big' : 'scr-rt-bomb';
  const push = () => {
    const mine = Bomb.privateFor(room, MY_ID);
    if (REVERSED) { if (mine) fake.fire('wolf:you', mine); fake.fire('room:update', snap()); }
    else { fake.fire('room:update', snap()); if (mine) fake.fire('wolf:you', mine); }
  };

  if (!LATE) {
    push();
    await waitFor(win, () => activeScreen(doc) === wantScreen, 6000, wantScreen).catch(() => {});
  }

  const rows = [];
  // 指示55 --dump：いま大画面に何が出ているかを、そのまま読む
  const 大画面の中身 = () => {
    const 主役 = doc.querySelector('#bigMain');
    const 帯 = doc.querySelector('#bigStatus');
    const t = (sel) => (doc.querySelector(sel) || { textContent: '' }).textContent.replace(/\s+/g, ' ').trim();
    return {
      帯: (帯 && !帯.hidden) ? (t('#bigLives') + ' ' + t('#bigClock')).trim() : '(出ていない)',
      主役: 主役 ? t('#bigMain').slice(0, 90) : '-',
      添え: t('#bigSub').slice(0, 70),
      横棒: doc.querySelectorAll('#bigBoard .bb-row').length,
      担当の行: doc.querySelectorAll('.bomb-coop .bcb-row').length,
      縁: doc.querySelectorAll('.fx-edge').length
    };
  };
  const count = (tag) => rows.push({
    tag,
    画面: activeScreen(doc),
    爆発: doc.querySelectorAll('.bomb-boom').length,
    帯: doc.querySelectorAll('.fx-banner').length,
    コールアウト: (doc.querySelector('.fx-callout') || { textContent: '' }).textContent.trim() || '-',
    紙吹雪: doc.querySelectorAll('.fx-confetti').length,
    揺れ: doc.querySelectorAll('.fx-shake-big,.fx-shake').length,
    ...(DUMP ? 大画面の中身() : {})
  });

  if (!LATE) { await sleep(win, 80); count('はじめ'); }

  for (let i = 0; i < 3; i++) {
    missOnce(room, playerIds[0]);
    if (mode === 'race') playerIds.slice(1).forEach((id) => missOnce(room, id));
    if (!LATE) { push(); await sleep(win, 80); count('ミス' + (i + 1)); }
  }
  if (LATE) {
    // 解除中を一度も描かず、決着だけを届ける
    push();
    await waitFor(win, () => activeScreen(doc) === wantScreen, 6000, wantScreen).catch(() => {});
    await sleep(win, 80); count('決着だけ届いた');
  }
  await sleep(win, 120); count('あと');
  // **連なる演出は、あとから来る**（第47弾 47-6）。
  // 大画面の「爆発」コールアウトは閃光（700ms）が引いてから出るので、
  // 直後だけを見ていると「出ていない」と読み違える。
  // 片付いたあとに数えない（落とし穴10-g）のと同じくらい、**早すぎても嘘になる**
  await sleep(win, 1000); count('少しあと');

  const label = [game, mode, BIG ? '大画面' : 'プレイヤー', REVERSED ? '順が逆' : null, LATE ? '決着だけ' : null]
    .filter(Boolean).join(' / ');
  console.log('== ' + label + ' ==');
  console.log('   サーバーの段階:', room.bomb.phase);
  rows.forEach((r) => console.log('   ', JSON.stringify(r)));
  console.log('   画面のエラー:', errors.length ? errors.slice(0, 2) : 'なし');
  win.close();
}

(game === 'falsetrue' ? mainFalsetrue() : mainBomb())
  .catch((e) => { console.error(e); process.exit(1); });
