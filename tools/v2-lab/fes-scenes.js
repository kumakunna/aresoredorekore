// tools/v2-lab/fes-scenes.js — 文化祭の部屋（指示66-2）の画面に流す見本データ
//
// **本物の進行役を動かして作る**（落とし穴25：手で書いた検体は実装から離れていく）。
// 文化祭の流れは fes-room.js、クイズ解除の結果は bomb-room.js を本当に動かし、
// 部屋の知らせは realtime.js の publicSnapshot、本人だけのものは FesRoom.privateFor をそのまま通す。
// 名前と姿は見本（docs/指示66/見本/festival.html）と同じ（scenes.js の MOCK）。本番には無い（public/ の外）

const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const RT = require(path.join(ROOT, 'realtime.js'));
const FesRoom = require(path.join(ROOT, 'fes-room.js'));
const BombRoom = require(path.join(ROOT, 'bomb-room.js'));
const SoroeRoom = require(path.join(ROOT, 'soroe-room.js'));
const QHaya = require(path.join(ROOT, 'qhaya-room.js'));
const QNear = require(path.join(ROOT, 'qnear-room.js'));

const MOCK = [
  ['ふう', '🙂', 'ぶんかさいの一歩'], ['ひろ', '🌙', 'こだわりの解除名人'], ['びび', '🐺', 'はじまりの一歩'],
  ['ちか', '🎈', 'しずかな名探偵'], ['でん', '💣', 'ぶんかさいの一歩'], ['えみ', '🎆', 'ひらめきの一歩'],
  ['ふう②', '🙂', ''], ['くまくん', '📖', ''], ['あき', '🙂', ''], ['kensho', '📖', ''], ['あいう', '💣', ''], ['まりこ', '👑', ''],
  ['そうた', '🎭', ''], ['ゆい', '🔥', ''], ['たかはし', '🐉', ''], ['りん', '💰', '']
];
const LONG = ['ながいなまえだよ', 'たかはしゆういち', 'あいうえおかきく', 'kensho34', 'まりこさんだよ', 'しょうたろう', 'みさきちゃん', 'だいすけくん'];
const CODE = 'TST754';

function 部屋(n, long, one) {
  const store = new RT.RoomStore();
  const room = store.create({ ownerUserId: 1, ownerUsername: 'kuma' });
  room.code = CODE;
  room.hostMemberId = null;
  const t0 = Date.now() - 5 * 60 * 1000;
  for (let i = 0; i < n; i++) {
    const mk = MOCK[i % MOCK.length];
    room.members.set('m' + (i + 1), { id: 'm' + (i + 1), name: long ? LONG[i % LONG.length] : mk[0], role: RT.ROLE_PLAYER, socketId: null,
      connected: true, joinedAt: t0 + i * 1000, lastSeen: Date.now(), readyGame: null, userId: null, look: { icon: mk[1], title: mk[2] },
      fesDiff: 'normal', fesMiss: 0 });
  }
  room.members.set('tv', { id: 'tv', name: 'テレビ', role: RT.ROLE_BIGSCREEN, socketId: null, connected: true,
    joinedAt: t0 + 200, lastSeen: Date.now(), readyGame: null, userId: null, look: null });
  // 見本は投票の画面も撮るので、候補を全部 on にした表で作る。
  // 候補1つ（係がほかを切にした部屋・指示68-T 二の束1）の場面は fes2-decide-one・fes2-tv-decide-one
  FesRoom.init(room, one ? { enabled: Object.fromEntries(FesRoom.FES_GAMES.filter((g) => g.mode !== 'bomb-coop').map((g) => [g.mode, false])) }
    : { games: FesRoom.FES_GAMES.map((g) => Object.assign({}, g, { on: true })) });
  room.fes.rnd = () => 0;
  return room;
}
// 流れを1段ずつ進める（締め切りを過ぎたことにして、本物の tick を通す）
const api = { startGameNow: () => ({ ok: true }), clearGameState: () => {}, driverStateOf: (r) => r.bomb || null, removeMember: () => true };
function 進める(room) { room.fes.endsAt = Date.now() - 1; FesRoom.tick(room, Date.now(), api); }
function のこり(room, sec) { room.fes.endsAt = Date.now() + sec * 1000; }

/** クイズ解除（協力版）を本当に動かして、成功（ok）か爆発（boom）で終わらせる */
function クイズ解除を終える(room, ok, o) {
  const ids = Array.from(room.members.values()).filter((m) => m.role === 'player').map((m) => m.id).slice(0, (o && o.max) || 8);
  room.members.forEach((m) => { if (m.role === 'player' && ids.indexOf(m.id) === -1) m.role = 'waiting'; });
  const res = BombRoom.startGame(room, FesRoom.gameOf('bomb-coop').start, { notify() {} });
  if (!res.ok) throw new Error('クイズ解除を始められません: ' + res.error);
  const w = room.bomb;
  const solve = ok ? w.wires.length : 27;
  w.wires.slice(0, solve).forEach((x, i) => {
    const who = ids[i % ids.length];
    BombRoom.submitAction(room, who, x.uid);
    BombRoom.submitVote(room, who, x.choices[x.correct]);
  });
  if (!ok) {
    // ライフがなくなるまで外す（ライフは人数の表で決まる：30本で12・50本で20・指示68-T 6・客観検査 2026-11-05）。のこりのコードを順に、何度でも
    for (let k = 0; k < 60 && w.phase !== 'ended'; k++) {
      const x = w.wires[solve + (k % (w.wires.length - solve))];
      BombRoom.submitAction(room, ids[0], x.uid);
      BombRoom.submitVote(room, ids[0], x.choices.find((c, j) => j !== x.correct));
    }
  }
  w.startedAt = Date.now() - (ok ? 147 : 153) * 1000;
  w.endedAt = Date.now();
  room.fes.played = { mode: 'bomb-coop', round: room.fes.round, ids: ids };
  room.fes.phase = FesRoom.PHASE.RESULT;
  return ids;
}

/** そろえて発射を本当に動かして、5回とも飛ばして結果まで（指示71 追記2c） */
function そろえてを終える(room) {
  const ids = Array.from(room.members.values()).filter((m) => m.role === 'player').map((m) => m.id);
  const res = SoroeRoom.startGame(room, FesRoom.gameOf('soroe').start, { notify() {} });
  if (!res.ok) throw new Error('そろえて発射を始められません: ' + res.error);
  for (let q = 0; q < 5 && room.soroe.phase !== 'ended'; q++) {
    const base = room.soroe.startedAt + 1500;
    ids.forEach((id, i) => SoroeRoom.submitAction(room, id, null, { at: base + ((i * 37 + q * 11) % 160) }));
    for (let k = 0; k < 4 && room.soroe.phase !== 'ended'; k++) SoroeRoom.advance(room);
  }
  room.fes.played = { mode: 'soroe', round: room.fes.round, ids: ids };
  room.fes.phase = FesRoom.PHASE.RESULT;
  return ids;
}

/** 早答え・数字ちかい方を本当に動かして、結果まで（指示71 追記9：文化祭の結果をほかの4本と同じ順位表に） */
function クイズ2を終える(room, mode) {
  const Room = mode === 'qhaya' ? QHaya : QNear, key = mode;
  const ids = Array.from(room.members.values()).filter((m) => m.role === 'player').map((m) => m.id);
  let seed = 3; const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  const res = Room.startGame(room, Object.assign({ _rand: rnd }, FesRoom.gameOf(mode).start), { notify() {} });
  if (!res.ok) throw new Error(mode + ' を始められません: ' + res.error);
  const w = room[key];
  for (let q = 0; q < w.qs.length && w.phase !== 'ended'; q++) {
    ids.forEach((id, i) => {
      if (mode === 'qhaya') { const c = w.qs[q].correct, C = w.qs[q].choices.length; Room.submitAction(room, id, null, { pick: (i + q) % 3 === 0 ? c : (c + 1 + (i % (C - 1))) % C, ms: 750 + i * 90 }); }
      else { const a = w.qs[q].answer; Room.submitAction(room, id, null, { value: Math.max(0, Math.round(a * (1 + ((i % 7) - 3) * 0.06)) + i) }); }
    });
    Room.advance(room); Room.advance(room);
  }
  room.fes.played = { mode: mode, round: room.fes.round, ids: ids };
  room.fes.phase = FesRoom.PHASE.RESULT;
  return ids;
}

/** クイズ解除（協力版）を本当に動かして、解除中の形にする：15本切れていて、何人かが挑戦中、1本は外れ、自分は1本開いている */
function クイズ解除の途中(room, o) {
  o = o || {};
  // 指示68-2：16人まで（本数は人数の表）。o.last で「のこり1本」の形
  const ids = Array.from(room.members.values()).filter((m) => m.role === 'player').map((m) => m.id).slice(0, o.max || 8);
  room.members.forEach((m) => { if (m.role === 'player' && ids.indexOf(m.id) === -1) m.role = 'waiting'; });
  const res = BombRoom.startGame(room, FesRoom.gameOf('bomb-coop').start, { notify() {} });
  if (!res.ok) throw new Error('クイズ解除を始められません: ' + res.error);
  const w = room.bomb;
  const order = w.entries[Object.keys(w.entries)[0]].order;
  const byUid = (uid) => w.wires.find((x) => x.uid === uid);
  const 切る = o.last ? order.length - 1 : 15;
  order.slice(0, 切る).forEach((uid, i) => { const x = byUid(uid); BombRoom.submitAction(room, ids[i % ids.length], uid); BombRoom.submitVote(room, ids[i % ids.length], x.choices[x.correct]); });
  if (o.last) { room.fes.played = { mode: 'bomb-coop', round: room.fes.round, ids: ids }; room.fes.phase = FesRoom.PHASE.PLAY; return ids; }
  // 1本は外す（左上に ✕）
  const miss = byUid(order[15]); BombRoom.submitAction(room, ids[1], miss.uid); BombRoom.submitVote(room, ids[1], miss.choices.find((c, j) => j !== miss.correct));
  // 挑戦中の人（ひろ・でん・ふう②）と、自分（ふう）が開いている1本
  [[ids[1], order[2 + 16]], [ids[4], order[26]], [ids[6] || ids[2], order[7 + 16]]].forEach(([id, uid]) => { if (id && uid) BombRoom.submitAction(room, id, uid); });
  BombRoom.submitAction(room, ids[0], order[20]);
  room.fes.played = { mode: 'bomb-coop', round: room.fes.round, ids: ids };
  room.fes.phase = FesRoom.PHASE.PLAY;
  return ids;
}

function snap(room) { return JSON.parse(JSON.stringify(RT.publicSnapshot(room))); }
function lab(room, screen, meId, extra) {
  return Object.assign({ screen, room: snap(room), you: FesRoom.privateFor(room, meId || 'm1') || {}, meId: meId || 'm1' }, extra || {});
}

/** 場面ごと。o：{ n, long } */
const BUILD = {
  'fes2-safety': () => ({ screen: 'safetyGate' }),
  // 名前の壁（決定・結果と同じ6人）
  'fes2-cd': () => ({ screen: 'v2Cdx', mode: 'bomb-coop', names: MOCK.slice(0, 6).map((m) => m[0]) }),
  'fes2-tv-cd': () => ({ screen: 'v2Cdx', mode: 'bomb-coop', tv: true, names: MOCK.slice(0, 6).map((m) => m[0]) }),
  'fes2-join': () => ({ screen: 'scr-v2-fes-join', join: { code: CODE, n: 6, name: 'ふう', diff: null } }),
  'fes2-join-on': () => ({ screen: 'scr-v2-fes-join', join: { code: CODE, n: 6, name: 'ふう', diff: 'normal' } }),
  'fes2-join-bad': () => ({ screen: 'scr-v2-fes-join', join: { code: CODE, n: 6, name: '', masked: true, diff: 'normal', err: 'この名前は使えません。ほかの名前にしてね' } }),
  'fes2-lobby': (o) => { const r = 部屋(o.n || 6, o.long); FesRoom.tick(r, Date.now(), api); のこり(r, 21); return lab(r, 'scr-v2-fes-lobby'); },
  'fes2-fb': (o) => { const r = 部屋(o.n || 6); FesRoom.tick(r, Date.now(), api); のこり(r, 21); return lab(r, 'scr-v2-fes-lobby', 'm1', { fb: { mode: 'bomb-coop', round: 1, stars: 0, open: true } }); },
  'fes2-look': (o) => { const r = 部屋(o.n || 6); FesRoom.tick(r, Date.now(), api); のこり(r, 24); return lab(r, 'scr-v2-fes-lobby', 'm1', { open: ['v2Look'] }); },
  'fes2-look-icon': (o) => { const r = 部屋(o.n || 6); FesRoom.tick(r, Date.now(), api); のこり(r, 22); return lab(r, 'scr-v2-fes-lobby', 'm1', { open: ['v2Look', 'v2LookIcon'] }); },
  'fes2-look-name': (o) => { const r = 部屋(o.n || 6); FesRoom.tick(r, Date.now(), api); のこり(r, 20); return lab(r, 'scr-v2-fes-lobby', 'm1', { open: ['v2Look', 'v2LookName'] }); },
  'fes2-fbmini': (o) => { const r = 部屋(o.n || 6); FesRoom.tick(r, Date.now(), api); のこり(r, 21); return lab(r, 'scr-v2-fes-lobby', 'm1', { fb: { mode: 'bomb-coop', round: 1, stars: 0, open: false } }); },
  'fes2-vote': (o) => { const r = 部屋(o.n || 6); FesRoom.tick(r, Date.now(), api); 進める(r); のこり(r, 20); return lab(r, 'scr-v2-fes-lobby', 'm1', { sel: 'bomb-coop' }); },
  // 指示68-T 1・2：テスト中の3本（みんなと同じ・ぴったり10秒・そろえて発射）が候補の投票。ⓘ のシートを1本ずつ撮る
  //（候補は3つまで：4本以上は進行役が3つに絞る。クイズ解除のシートは fes2-vote・fes2-ready で撮る）
  'fes2-vote-t': (o) => { const r = 部屋(o.n || 6); FesRoom.tick(r, Date.now(), api); 進める(r); r.fes.candidates = ['onaji-many', 'pittari', 'soroe']; のこり(r, 20); return lab(r, 'scr-v2-fes-lobby'); },
  'fes2-voted': (o) => { const r = 部屋(o.n || 6); FesRoom.tick(r, Date.now(), api); 進める(r); FesRoom.vote(r, 'm1', 'bomb-coop'); のこり(r, 14); return lab(r, 'scr-v2-fes-lobby'); },
  'fes2-decide': (o) => { const r = 部屋(o.n || 6); FesRoom.tick(r, Date.now(), api); 進める(r); ['m1', 'm2', 'm3', 'm4', 'm5'].forEach((id) => FesRoom.vote(r, id, 'bomb-coop')); 進める(r); return lab(r, 'scr-v2-fes-lobby'); },
  'fes2-ready': (o) => { const r = 部屋(o.n || 8); FesRoom.tick(r, Date.now(), api); 進める(r); FesRoom.vote(r, 'm1', 'bomb-coop'); 進める(r); 進める(r);
    ['m1', 'm2', 'm5', 'm6', 'm7'].forEach((id) => { const m = r.members.get(id); if (m) m.readyGame = 'bomb'; }); r.members.get('m1').readyGame = null; のこり(r, 12); return lab(r, 'scr-v2-fes-lobby'); },
  // 自分が準備OK を押したあと（取り消しは長押し・2026-10-29）
  'fes2-readied': (o) => { const r = 部屋(o.n || 8); FesRoom.tick(r, Date.now(), api); 進める(r); FesRoom.vote(r, 'm1', 'bomb-coop'); 進める(r); 進める(r);
    ['m1', 'm2', 'm5', 'm6', 'm7'].forEach((id) => { const m = r.members.get(id); if (m) m.readyGame = 'bomb'; }); のこり(r, 12); return lab(r, 'scr-v2-fes-lobby'); },
  'fes2-play': (o) => { const r = 部屋(o.n || 6); クイズ解除の途中(r); return lab(r, 'scr-v2-fes-lobby', 'm1', { secret: JSON.parse(JSON.stringify(BombRoom.privateFor(r, 'm1'))) }); },
  // 客観検査（2026-11-05）：ライフを本数÷2.5 にしたので、16人（50本）でハートが20個。スマホの上の帯に入るかを撮る
  'fes2-play16': (o) => { const r = 部屋(16, o.long); クイズ解除の途中(r, { max: 16 }); return lab(r, 'scr-v2-fes-lobby', 'm1', { secret: JSON.parse(JSON.stringify(BombRoom.privateFor(r, 'm1'))) }); },
  'fes2-result16': (o) => { const r = 部屋(16, o.long); クイズ解除を終える(r, true, { max: 16 }); のこり(r, 15); return lab(r, 'scr-v2-fes-lobby'); },
  'fes2-tv-result16': (o) => { const r = 部屋(16, o.long); クイズ解除を終える(r, true, { max: 16 }); のこり(r, 15); return lab(r, 'scr-v2-fes-tv', 'tv'); },
  'fes2-tv-play': (o) => { const r = 部屋(o.n || 8, o.long); クイズ解除の途中(r); return lab(r, 'scr-v2-fes-tv', 'tv'); },
  // 指示68-2 第2節：TV の盤。16人で50本・正しく切った瞬間（火花と「〇〇 が切った」）・のこり1本
  'fes2-tv-play16': (o) => { const r = 部屋(16, o.long); クイズ解除の途中(r, { max: 16 }); return lab(r, 'scr-v2-fes-tv', 'tv'); },
  'fes2-tv-play-cut': (o) => { const r = 部屋(o.n || 8, o.long); クイズ解除の途中(r); const c = r.bomb.entries[Object.keys(r.bomb.entries)[0]].order[14];
    return lab(r, 'scr-v2-fes-tv', 'tv', { cut: { uid: c, name: r.bomb.names[r.bomb.solvedBy[c]], fresh: true } }); },
  'fes2-tv-play-last': (o) => { const r = 部屋(o.n || 8, o.long); クイズ解除の途中(r, { last: true }); return lab(r, 'scr-v2-fes-tv', 'tv'); },
  'fes2-wait': (o) => { const r = 部屋(o.n || 6); クイズ解除を終える(r, true); r.fes.phase = FesRoom.PHASE.PLAY; r.members.get('m1').role = 'waiting'; return lab(r, 'scr-v2-fes-lobby'); },
  'fes2-result': (o) => { const r = 部屋(o.n || 6); クイズ解除を終える(r, true); のこり(r, 15); return lab(r, 'scr-v2-fes-lobby'); },
  'fes2-boom': (o) => { const r = 部屋(o.n || 6); クイズ解除を終える(r, false); のこり(r, 15); return lab(r, 'scr-v2-fes-lobby'); },
  'fes2-quit': () => ({ screen: 'scr-v2-fes-quit', quit: { code: CODE, memberId: 'm1', mode: 'bomb-coop', round: 1, stars: 0, title: { icon: '🏮', name: '文化祭の記念' } } }),
  'fes2-staff': (o) => { const r = 部屋(o.n || 7, o.long); FesRoom.tick(r, Date.now(), api); 進める(r); のこり(r, 12); r.fes.round = 23; r.fes.hidden.add('m3');
    const s = snap(r);
    return { screen: 'scr-v2-fes-staff', staff: { code: CODE, tv: 1, fes: s.fes,
      members: Array.from(r.members.values()).filter((m) => m.role !== 'bigscreen').map((m) => ({ id: m.id, name: m.name, connected: true, hidden: r.fes.hidden.has(m.id), miss: 0, playing: true })) },
      fb: [{ room: CODE, round: 3, mode: 'bomb-coop', name: 'ふう', stars: 5, text: 'ぎりぎりで解除できてめっちゃ盛り上がった', at: Date.now() - 600000 },
           { room: CODE, round: 2, mode: 'rcard', name: 'ひろ', stars: 3, text: 'ルールが最初わからなかった', at: Date.now() - 1300000 },
           { room: CODE, round: 1, mode: 'shinka', name: 'びび', stars: 4, text: null, at: Date.now() - 2200000 }] };
  },
  // 候補がクイズ解除だけ（係がほかを切にした部屋）。投票を飛ばして「このゲームで遊びます！」
  'fes2-decide-one': (o) => { const r = 部屋(o.n || 6, false, true); FesRoom.tick(r, Date.now(), api); 進める(r); return lab(r, 'scr-v2-fes-lobby'); },
  'fes2-tv-decide-one': (o) => { const r = 部屋(o.n || 6, o.long, true); FesRoom.tick(r, Date.now(), api); 進める(r); return lab(r, 'scr-v2-fes-tv', 'tv'); },
  // TV
  'fes2-tv-idle': () => { const r = 部屋(0); r.fes.phase = FesRoom.PHASE.IDLE; return lab(r, 'scr-v2-fes-tv', 'tv'); },
  'fes2-tv-one': () => { const r = 部屋(1); FesRoom.tick(r, Date.now(), api); return lab(r, 'scr-v2-fes-tv', 'tv'); },
  'fes2-tv-lobby': (o) => { const r = 部屋(o.n || 6, o.long); FesRoom.tick(r, Date.now(), api); のこり(r, 27); return lab(r, 'scr-v2-fes-tv', 'tv'); },
  'fes2-tv-full': (o) => { const r = 部屋(16, o.long); FesRoom.tick(r, Date.now(), api); のこり(r, 27); return lab(r, 'scr-v2-fes-tv', 'tv'); },
  'fes2-tv-vote': (o) => { const r = 部屋(o.n || 6, o.long); FesRoom.tick(r, Date.now(), api); 進める(r); のこり(r, 20); return lab(r, 'scr-v2-fes-tv', 'tv'); },
  'fes2-tv-decide': (o) => { const r = 部屋(o.n || 6); FesRoom.tick(r, Date.now(), api); 進める(r); ['m1', 'm2', 'm3', 'm4', 'm5'].forEach((id) => FesRoom.vote(r, id, 'bomb-coop')); 進める(r); return lab(r, 'scr-v2-fes-tv', 'tv'); },
  'fes2-tv-ready': (o) => { const r = 部屋(o.n || 8); FesRoom.tick(r, Date.now(), api); 進める(r); FesRoom.vote(r, 'm1', 'bomb-coop'); 進める(r); 進める(r);
    ['m1', 'm2', 'm5', 'm6', 'm7'].forEach((id) => { const m = r.members.get(id); if (m) m.readyGame = 'bomb'; }); のこり(r, 12); return lab(r, 'scr-v2-fes-tv', 'tv'); },
  'fes2-tv-result': (o) => { const r = 部屋(o.n || 6); クイズ解除を終える(r, true); のこり(r, 15); return lab(r, 'scr-v2-fes-tv', 'tv'); },
  'fes2-tv-boom': (o) => { const r = 部屋(o.n || 6); クイズ解除を終える(r, false); のこり(r, 15); return lab(r, 'scr-v2-fes-tv', 'tv'); },
  // 指示71 追記2c：そろえて発射の文化祭の結果（16人）。下の帯（もどるまで）の線が表の5行目にかかっていた
  'fes2-tv-result-soroe': (o) => { const r = 部屋(o.n || 16); そろえてを終える(r); のこり(r, 15); return lab(r, 'scr-v2-fes-tv', 'tv'); }
};

// 指示71 追記7：呼び込みの印にゲーム名（入が4本の時）
['qhaya', 'qnear'].forEach((m) => {
  BUILD['fes2-result-' + m] = (o) => { const r = 部屋(o.n || 16); クイズ2を終える(r, m); のこり(r, 15); return lab(r, 'scr-v2-fes-lobby'); };
  BUILD['fes2-tv-result-' + m] = (o) => { const r = 部屋(o.n || 16); クイズ2を終える(r, m); のこり(r, 15); return lab(r, 'scr-v2-fes-tv', 'tv'); };
});
// 指示76 3-1：投票の TV の札（説明が1行に入るか）と、準備の TV のルールを、ゲーム全部で撮る
[['a', ['bomb-coop', 'onaji-many', 'pittari']], ['b', ['soroe', 'qhaya', 'qnear']], ['c', ['shinka', 'rcard', 'bomb-coop']]].forEach(([k, list]) => {
  BUILD['fes2-tv-vote-' + k] = (o) => { const r = 部屋(o.n || 6); FesRoom.tick(r, Date.now(), api); 進める(r); r.fes.candidates = list.slice(); のこり(r, 20); return lab(r, 'scr-v2-fes-tv', 'tv'); };
});
['onaji-many', 'pittari', 'soroe', 'qhaya', 'qnear', 'shinka', 'rcard'].forEach((m) => {
  BUILD['fes2-tv-ready-' + m] = (o) => { const r = 部屋(o.n || 8); FesRoom.tick(r, Date.now(), api); 進める(r); r.fes.candidates = [m]; FesRoom.vote(r, 'm1', m); 進める(r); 進める(r); のこり(r, 12); return lab(r, 'scr-v2-fes-tv', 'tv'); };
});
// 指示76 1-1（A1）：決まる画面の3枚の札を、6本のゲーム全部で撮る（小さい字のある「協力版」「多い方」・1行の名前・長い名前）
[['a', ['bomb-coop', 'onaji-many', 'pittari']], ['b', ['soroe', 'qhaya', 'qnear']]].forEach(([k, list]) => {
  BUILD['fes2-tv-decide-' + k] = (o) => { const r = 部屋(o.n || 6); FesRoom.tick(r, Date.now(), api); 進める(r); r.fes.candidates = list.slice();
    ['m1', 'm2', 'm3'].forEach((id) => FesRoom.vote(r, id, list[1])); 進める(r); return lab(r, 'scr-v2-fes-tv', 'tv'); };
});
BUILD['fes2-tv-idle4'] = () => { const v = BUILD['fes2-tv-idle'](); v.room.fes.games = v.room.fes.games.slice(0, 4); return v; };

// 見せ場の動画（tools/v2-film.js）：投票の決定を、動きを頭から（play）
BUILD['fes2-tv-film-decide'] = (o) => Object.assign(BUILD['fes2-tv-decide'](o), { play: true });
BUILD['fes2-tv-film-decide-one'] = (o) => Object.assign(BUILD['fes2-tv-decide-one'](o), { play: true });

/** 撮る道具の一覧に足す場面（kind：phone／tv、mock：見本の同じ場面） */
const SCENES = [
  ['fes2-safety', 'phone', 'f1'], ['fes2-cd', 'phone', 'f10'], ['fes2-tv-cd', 'tv', 't10'],
  ['fes2-join', 'phone', 'f2a'], ['fes2-join-on', 'phone', null], ['fes2-join-bad', 'phone', 'f2b'],
  ['fes2-lobby', 'phone', 'f3'], ['fes2-fb', 'phone', 'f4'], ['fes2-fbmini', 'phone', null],
  ['fes2-play', 'phone', 'f11'], ['fes2-play16', 'phone', null], ['fes2-result16', 'phone', null], ['fes2-tv-result16', 'tv', null], ['fes2-tv-play16', 'tv', null], ['fes2-tv-play-cut', 'tv', null], ['fes2-tv-play-last', 'tv', null], ['fes2-tv-play', 'tv', 't11'],
  ['fes2-look', 'phone', 'f5a'], ['fes2-look-icon', 'phone', 'f5b'], ['fes2-look-name', 'phone', 'f5c'],
  ['fes2-vote', 'phone', 'f7'], ['fes2-vote-t', 'phone', null], ['fes2-voted', 'phone', null], ['fes2-decide', 'phone', 'f8'], ['fes2-decide-one', 'phone', null], ['fes2-ready', 'phone', 'f9'], ['fes2-readied', 'phone', null],
  ['fes2-wait', 'phone', null], ['fes2-result', 'phone', 'f12'], ['fes2-boom', 'phone', null], ['fes2-quit', 'phone', 'f13'], ['fes2-staff', 'phone', 'f14'],
  ['fes2-tv-idle', 'tv', 't6a'], ['fes2-tv-one', 'tv', 't6b'], ['fes2-tv-lobby', 'tv', 't3'], ['fes2-tv-full', 'tv', 't6c'],
  ['fes2-tv-vote', 'tv', 't7'], ['fes2-tv-decide', 'tv', 't8'], ['fes2-tv-film-decide', 'tv', null], ['fes2-tv-film-decide-one', 'tv', null], ['fes2-tv-decide-one', 'tv', null], ['fes2-tv-decide-a', 'tv', null], ['fes2-tv-decide-b', 'tv', null], ['fes2-tv-vote-a', 'tv', null], ['fes2-tv-vote-b', 'tv', null], ['fes2-tv-vote-c', 'tv', null], ['fes2-tv-ready-onaji-many', 'tv', null], ['fes2-tv-ready-pittari', 'tv', null], ['fes2-tv-ready-soroe', 'tv', null], ['fes2-tv-ready-qhaya', 'tv', null], ['fes2-tv-ready-qnear', 'tv', null], ['fes2-tv-ready-shinka', 'tv', null], ['fes2-tv-ready-rcard', 'tv', null], ['fes2-tv-ready', 'tv', 't9'], ['fes2-tv-result', 'tv', 't12a'], ['fes2-tv-boom', 'tv', 't12b'], ['fes2-tv-result-soroe', 'tv', null], ['fes2-tv-idle4', 'tv', null], ['fes2-result-qhaya', 'phone', null], ['fes2-result-qnear', 'phone', null], ['fes2-tv-result-qhaya', 'tv', null], ['fes2-tv-result-qnear', 'tv', null]
].map(([id, kind, mock]) => ({ id, kind, draw: 'fes', fes: true,
  screen: BUILD[id]({}).screen, mock: mock ? { page: 'festival.html', id: mock } : null }));

function view(sceneId, opts) {
  const b = BUILD[sceneId];
  if (!b) throw new Error('文化祭の見本の場面がありません: ' + sceneId);
  return b(opts || {});
}

module.exports = { SCENES, view };
