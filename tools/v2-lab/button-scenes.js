// tools/v2-lab/button-scenes.js — 「ぴったり10秒」「そろえて発射」（指示68-4）の画面に流す見本データ
//
// **本物の進行役（pittari-room.js・soroe-room.js）を動かして作る**（落とし穴25）。
// 部屋の知らせは publicSnapshot＋publicView、本人だけのものは privateFor をそのまま通す。
// 端末の中だけの状態（押したか・時計を合わせたか）は local で渡す。本番には無い（public/ の外）

const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const RT = require(path.join(ROOT, 'realtime.js'));
const PittariRoom = require(path.join(ROOT, 'pittari-room.js'));
const SoroeRoom = require(path.join(ROOT, 'soroe-room.js'));

const NAMES = ['ふう', 'ひろ', 'びび', 'ちか', 'でん', 'えみ', 'あき', 'くまくん', 'kensho', 'あいう', 'まりこ', 'そうた', 'ゆい', 'たかはし', 'りん', 'みさき'];
const FACES = ['🙂', '🌙', '🐺', '🎈', '💣', '🎆', '🙂', '📖', '📖', '💣', '👑', '🎭', '🔥', '🐉', '💰', '🎈'];
const CODE = 'TST754';

function 部屋(n, game, fes) {
  const store = new RT.RoomStore();
  const room = store.create({ ownerUserId: 1, ownerUsername: 'kuma' });
  room.code = CODE;
  const t0 = Date.now() - 5 * 60 * 1000;
  for (let i = 0; i < n; i++) {
    room.members.set('m' + (i + 1), { id: 'm' + (i + 1), name: NAMES[i % NAMES.length], role: RT.ROLE_PLAYER, socketId: null,
      connected: true, joinedAt: t0 + i * 1000, lastSeen: Date.now(), readyGame: null, userId: null, look: { icon: FACES[i % FACES.length], title: '' } });
  }
  room.members.set('tv', { id: 'tv', name: 'テレビ', role: RT.ROLE_BIGSCREEN, socketId: null, connected: true,
    joinedAt: t0 + 200, lastSeen: Date.now(), readyGame: null, userId: null, look: null });
  room.hostMemberId = 'm1';
  if (fes) room.fes = { inset: 0, hidden: new Set() };
  const D = game === 'pittari' ? PittariRoom : SoroeRoom;
  const res = D.startGame(room, { game }, { notify() {} });
  if (!res.ok) throw new Error(game + ' を始められません: ' + res.error);
  return room;
}
function lab(room, game, screen, meId, extra) {
  const D = game === 'pittari' ? PittariRoom : SoroeRoom;
  // 文化祭の部屋の印（今日の最高記録を出すため）だけを持つ。文化祭の流れの知らせは要らないので、組み立てる間は外す
  const f = room.fes; room.fes = null;
  const snap = JSON.parse(JSON.stringify(RT.publicSnapshot(room)));
  room.fes = f;
  if (f) snap.fes = { inset: 0 };
  snap.state = { phase: room.state.phase, game, data: JSON.parse(JSON.stringify(D.publicView(room))) };
  return Object.assign({ screen, room: snap, you: JSON.parse(JSON.stringify(D.privateFor(room, meId) || {})), meId }, extra || {});
}

// ---- ぴったり10秒 ----
/** その回を進めて、ids の人が差 diffs（ミリ秒）で押した形で開く */
function 押して開く(room, diffs) {
  const w = room.pittari;
  if (w.phase === 'set') PittariRoom.advance(room);
  const t = w.rounds[w.round].target;
  diffs.forEach((d, i) => { if (d != null) PittariRoom.submitAction(room, 'm' + (i + 1), null, { ms: t * 1000 + d }); });
  PittariRoom.advance(room);
}
function 最後まで(room, rows) {
  for (let q = 0; q < 5; q++) { 押して開く(room, rows[q % rows.length]); if (q < 4) PittariRoom.advance(room); }
  PittariRoom.advance(room);
}
const 差8 = [120, -40, 380, -900, 10, 1500, -260, 70];
const 差16 = [120, -40, 380, -900, 10, 1500, -260, 70, -1100, 640, 0, -330, 220, -15, 2400, null];

// ---- そろえて発射 ----
function 押して飛ぶ(room, gaps) {
  const w = room.soroe;
  const base = w.startedAt + 1500;
  gaps.forEach((g, i) => { if (g != null) SoroeRoom.submitAction(room, 'm' + (i + 1), null, { at: base + g }); });
  SoroeRoom.advance(room);
}
function 次へ(room, k) { for (let i = 0; i < k; i++) { SoroeRoom.advance(room); } }

const BUILD = {
  'pt-set': () => lab(部屋(6, 'pittari'), 'pittari', 'scr-v2-pittari', 'm1'),
  'pt-run': () => { const r = 部屋(6, 'pittari'); PittariRoom.advance(r); return lab(r, 'pittari', 'scr-v2-pittari', 'm1', { local: { stopped: false } }); },
  'pt-stopped': () => { const r = 部屋(6, 'pittari'); PittariRoom.advance(r); PittariRoom.submitAction(r, 'm1', null, { ms: 10120 }); return lab(r, 'pittari', 'scr-v2-pittari', 'm1', { local: { stopped: true } }); },
  'pt-reveal': () => { const r = 部屋(6, 'pittari'); 押して開く(r, 差8.slice(0, 6)); return lab(r, 'pittari', 'scr-v2-pittari', 'm5'); },
  'pt-result': () => { const r = 部屋(6, 'pittari'); 最後まで(r, [差8.slice(0, 6)]); return lab(r, 'pittari', 'scr-v2-pittari', 'm1', { host: true }); },
  'pt-tv-set': () => lab(部屋(8, 'pittari'), 'pittari', 'scr-v2-pittari-tv', 'tv'),
  'pt-tv-run': () => { const r = 部屋(8, 'pittari'); PittariRoom.advance(r); return lab(r, 'pittari', 'scr-v2-pittari-tv', 'tv'); },
  'pt-tv-reveal': () => { const r = 部屋(8, 'pittari'); 押して開く(r, 差8); return lab(r, 'pittari', 'scr-v2-pittari-tv', 'tv'); },
  'pt-tv-reveal16': () => { const r = 部屋(16, 'pittari'); 押して開く(r, 差16); return lab(r, 'pittari', 'scr-v2-pittari-tv', 'tv'); },
  'pt-tv-reveal-play': () => { const r = 部屋(16, 'pittari'); 押して開く(r, 差16); return lab(r, 'pittari', 'scr-v2-pittari-tv', 'tv', { play: true }); },
  'pt-tv-result16': () => { const r = 部屋(16, 'pittari'); 最後まで(r, [差16]); return lab(r, 'pittari', 'scr-v2-pittari-tv', 'tv'); },
  'so-launch': () => lab(部屋(6, 'soroe'), 'soroe', 'scr-v2-soroe', 'm1', { local: { ready: true } }),
  'so-launch-seeno': () => { const r = 部屋(6, 'soroe'); 押して飛ぶ(r, [0, 20, 40]); 次へ(r, 1); 押して飛ぶ(r, [0, 20, 40]); 次へ(r, 1); return lab(r, 'soroe', 'scr-v2-soroe', 'm1', { local: { ready: true } }); },
  'so-pressed': () => lab(部屋(6, 'soroe'), 'soroe', 'scr-v2-soroe', 'm1', { local: { ready: true, pressed: true } }),
  'so-flight': () => { const r = 部屋(6, 'soroe'); 押して飛ぶ(r, [0, 30, 55, 80, 12, 64]); return lab(r, 'soroe', 'scr-v2-soroe', 'm1'); },
  'so-result': () => { const r = 部屋(6, 'soroe'); for (let q = 0; q < 5; q++) { 押して飛ぶ(r, [0, 30, 55, 80, 12, q * 60]); 次へ(r, 1); } return lab(r, 'soroe', 'scr-v2-soroe', 'm1', { host: true }); },
  'so-tv-launch': () => lab(部屋(8, 'soroe'), 'soroe', 'scr-v2-soroe-tv', 'tv'),
  'so-tv-seeno': () => { const r = 部屋(8, 'soroe'); 押して飛ぶ(r, [0, 20]); 次へ(r, 1); 押して飛ぶ(r, [0, 20]); 次へ(r, 1); return lab(r, 'soroe', 'scr-v2-soroe-tv', 'tv'); },
  'so-tv-flight': () => { const r = 部屋(8, 'soroe'); 押して飛ぶ(r, [0, 12, 30, 41, 8, 22, 35, 18]); return lab(r, 'soroe', 'scr-v2-soroe-tv', 'tv'); },
  'so-tv-flight-play': () => { const r = 部屋(8, 'soroe'); 押して飛ぶ(r, [0, 12, 30, 41, 8, 22, 35, 18]); return lab(r, 'soroe', 'scr-v2-soroe-tv', 'tv', { play: true }); },
  'so-tv-plop16': () => { const r = 部屋(16, 'soroe'); 押して飛ぶ(r, [0, 120, 300, 520, 90, 610, 44, 260, 380, 150, 700, 20, 330, 480, 75, 200]); return lab(r, 'soroe', 'scr-v2-soroe-tv', 'tv'); },
  'so-tv-notflew': () => { const r = 部屋(8, 'soroe'); 押して飛ぶ(r, [0, 30]); return lab(r, 'soroe', 'scr-v2-soroe-tv', 'tv'); },
  'so-tv-result-fes': () => { const r = 部屋(8, 'soroe', true); for (let q = 0; q < 5; q++) { 押して飛ぶ(r, [0, 30, 55, 80, 12, 64, 20, q * 40]); 次へ(r, 1); } return lab(r, 'soroe', 'scr-v2-soroe-tv', 'tv'); }
};

// 見せ場の動画（tools/v2-film.js）。play：動きを頭から出す。門7：ぴったり10秒は 0.00秒の時と普通の時、そろえて発射は宇宙・月・ぽてっ・飛ばない回
Object.assign(BUILD, {
  'pt-tv-film-perfect': () => { const r = 部屋(16, 'pittari'); 押して開く(r, 差16); return lab(r, 'pittari', 'scr-v2-pittari-tv', 'tv', { play: true }); },
  'pt-tv-film-normal': () => { const r = 部屋(8, 'pittari'); 押して開く(r, 差8); return lab(r, 'pittari', 'scr-v2-pittari-tv', 'tv', { play: true }); },
  'so-tv-film-space': () => { const r = 部屋(8, 'soroe'); 押して飛ぶ(r, [0, 12, 30, 41, 8, 22, 35, 18]); return lab(r, 'soroe', 'scr-v2-soroe-tv', 'tv', { play: true }); },
  'so-tv-film-moon': () => { const r = 部屋(8, 'soroe'); 押して飛ぶ(r, [0, 22, 60, 84, 35, 51, 70, 12]); return lab(r, 'soroe', 'scr-v2-soroe-tv', 'tv', { play: true }); },
  'so-tv-film-plop': () => { const r = 部屋(12, 'soroe'); 押して飛ぶ(r, [0, 120, 300, 520, 90, 610, 44, 260, 380, 150, 700, 20]); return lab(r, 'soroe', 'scr-v2-soroe-tv', 'tv', { play: true }); },
  'so-tv-film-notflew': () => { const r = 部屋(8, 'soroe'); 押して飛ぶ(r, [0, 30]); return lab(r, 'soroe', 'scr-v2-soroe-tv', 'tv', { play: true }); }
});

const SCENES = Object.keys(BUILD).map((id) => ({ id, kind: /-tv-/.test(id) ? 'tv' : 'phone', draw: 'v2game', screen: BUILD[id]().screen, mock: null }));
function view(sceneId) {
  const b = BUILD[sceneId];
  if (!b) throw new Error('ボタン1つの見本の場面がありません: ' + sceneId);
  return b();
}
module.exports = { SCENES, view };
