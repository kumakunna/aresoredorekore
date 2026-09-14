#!/usr/bin/env node
// tools/probe-leftover-class.js — ゲーム固有クラスが、終わったあとも #app に残るかを見る道具（第48弾）
//
// 使い方: node tools/probe-leftover-class.js [--big]
// tools/fx-probe.js と同じ形——本物の進行役（bomb-room.js）を動かし、
// 本物の publicView を本物の画面へ流す（落とし穴25）。
// ライフ1で bomb-danger が付いたあと、強制終了・ゲーム変更で外れるかを数える。
const path = require('path');
const ROOT = path.join(__dirname, '..');
const H = require(path.join(ROOT, 'tests', 'harness'));
const { launch, activeScreen, sleep, waitFor, waitScreen, el, click, openCassette } = H;
const Bomb = require(path.join(ROOT, 'bomb-room.js'));

const BIG = process.argv.indexOf('--big') !== -1;
const MY_ID = 'm1';

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

(async function main() {
  const { win, doc, errors } = await launch({ fakeSocket: true });
  await waitScreen(win, doc, 'scr-shelf', 8000);
  await openCassette(win, doc, 'bakudan');
  click(doc, doc.querySelector('#wayChoices [data-way="room"]'));
  await waitScreen(win, doc, 'scr-rt-lobby', 4000);
  const fake = win.__rtFake;
  await waitFor(win, () => fake.connected, 4000, 'socket');

  const members = new Map();
  const playerIds = BIG ? ['m2', 'm3'] : [MY_ID, 'm2'];
  playerIds.forEach((id, i) => members.set(id, {
    id, name: ['あき', 'びび', 'ちか'][i], role: 'player', connected: true, socketId: 's' + id }));
  const room = { code: 'ABC234', members, state: { phase: 'lobby', game: null, data: {} } };
  const r = Bomb.startGame(room, { mode: 'coop', counts: { easy: 6 }, lives: 3, timerSec: 0 }, {});
  if (!r.ok) throw new Error(JSON.stringify(r));
  room.state.game = 'bomb';
  room.state.phase = 'playing';

  const memberRows = () => {
    const rows = [];
    if (BIG) rows.push({ id: MY_ID, name: 'TV', role: 'bigscreen', connected: true, isHost: false, ready: true });
    playerIds.forEach((id, i) => rows.push({
      id, name: ['あき', 'びび', 'ちか'][i], role: 'player', connected: true, isHost: i === 0, ready: true }));
    return rows;
  };
  // 進行中は publicView、待合にもどされたら room.state.data（＝空）
  const snap = () => ({
    code: 'ABC234', ownerUserId: 1, ownerUsername: 'kuma', hostMemberId: playerIds[0],
    playerCount: playerIds.length, memberCount: memberRows().length,
    ready: { count: playerIds.length, total: playerIds.length, waitingNames: [], all: true },
    members: memberRows(),
    state: { phase: room.state.phase, game: room.state.game,
             data: room.bomb ? Bomb.publicView(room) : room.state.data }
  });
  fake.replies = { 'room:create': () => ({ ok: true, code: 'ABC234', memberId: MY_ID, room: snap() }) };
  el(doc, 'rtCreateName').value = BIG ? 'TV' : 'あき';
  click(doc, 'rtCreateBtn');
  await sleep(win, 300);

  const push = () => {
    fake.fire('room:update', snap());
    if (room.bomb) { const mine = Bomb.privateFor(room, MY_ID); if (mine) fake.fire('wolf:you', mine); }
  };
  const want = BIG ? 'scr-rt-big' : 'scr-rt-bomb';
  push();
  await waitFor(win, () => activeScreen(doc) === want, 6000, want).catch(() => {});

  const danger = () => doc.getElementById('app').classList.contains('bomb-danger');
  const say = (tag) => console.log('  ', tag.padEnd(28),
    '| 画面', activeScreen(doc).padEnd(14),
    '| lives', room.bomb ? room.bomb.lives : '-',
    '| bomb-danger', danger() ? '★あり' : 'なし');

  say('はじめ');
  missOnce(room, playerIds[0]); push(); await sleep(win, 120); say('ミス1（lives 2）');
  missOnce(room, playerIds[0]); push(); await sleep(win, 120); say('ミス2（lives 1）');

  // ---- 進行役が「みんなを待合にもどす」（＝ pickGame(reset) → clearGameState）----
  delete room.bomb;
  room.state.phase = 'lobby';
  room.state.data = {};
  push(); await sleep(win, 250);
  say('強制終了→待合');

  // ---- さらに別のゲームに変える ----
  room.state.game = 'wolfrole';
  push(); await sleep(win, 250);
  say('別のゲームに変えた');

  console.log('   #app の class:', doc.getElementById('app').className);
  console.log('   画面のエラー:', errors.length ? errors.slice(0, 2) : 'なし');
  win.close();
})().catch((e) => { console.error(e); process.exit(1); });
