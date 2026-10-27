// tools/v2-lab/onaji-scenes.js — 「みんなと同じ」（指示68-3）の画面に流す見本データ
//
// **本物の進行役（onaji-room.js）を動かして作る**（落とし穴25：手で書いた検体は実装から離れていく）。
// 部屋の知らせは publicSnapshot＋OnajiRoom.publicView、本人だけのものは OnajiRoom.privateFor をそのまま通す。
// お題は乱数を0に止めて毎回同じ（K4）。本番には無い（public/ の外）

const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const RT = require(path.join(ROOT, 'realtime.js'));
const OnajiRoom = require(path.join(ROOT, 'onaji-room.js'));

const NAMES = ['ふう', 'ひろ', 'びび', 'ちか', 'でん', 'えみ', 'あき', 'くまくん', 'kensho', 'あいう', 'まりこ', 'そうた', 'ゆい', 'たかはし', 'りん', 'みさき'];
const FACES = ['🙂', '🌙', '🐺', '🎈', '💣', '🎆', '🙂', '📖', '📖', '💣', '👑', '🎭', '🔥', '🐉', '💰', '🎈'];
const LONG = ['ながいなまえだよ', 'たかはしゆういち', 'あいうえおかきく', 'kensho34', 'まりこさんだよ', 'しょうたろう', 'みさきちゃん', 'だいすけくん'];
const CODE = 'TST754';

function 部屋(n, o) {
  const store = new RT.RoomStore();
  const room = store.create({ ownerUserId: 1, ownerUsername: 'kuma' });
  room.code = CODE;
  const t0 = Date.now() - 5 * 60 * 1000;
  for (let i = 0; i < n; i++) {
    room.members.set('m' + (i + 1), { id: 'm' + (i + 1), name: o.long ? LONG[i % LONG.length] : NAMES[i % NAMES.length], role: RT.ROLE_PLAYER, socketId: null,
      connected: true, joinedAt: t0 + i * 1000, lastSeen: Date.now(), readyGame: null, userId: null, look: { icon: FACES[i % FACES.length], title: '' } });
  }
  room.members.set('tv', { id: 'tv', name: 'テレビ', role: RT.ROLE_BIGSCREEN, socketId: null, connected: true,
    joinedAt: t0 + 200, lastSeen: Date.now(), readyGame: null, userId: null, look: null });
  room.hostMemberId = 'm1';
  const res = OnajiRoom.startGame(room, { mode: o.mode || 'many', _rand: () => 0 }, { notify() {} });
  if (!res.ok) throw new Error('みんなと同じを始められません: ' + res.error);
  return room;
}
/** いまの問題で、ids の人が picks の番号を選ぶ */
function 選ぶ(room, picks) {
  Object.keys(picks).forEach((id) => OnajiRoom.submitAction(room, id, null, { pick: picks[id] }));
}
/** 4択の問題まで進める（見せ場は4本の棒で撮る） */
function 四択へ(room) {
  for (let i = 0; i < 5 && room.onaji.topics[room.onaji.round].choices.length !== 4; i++) { OnajiRoom.advance(room); OnajiRoom.advance(room); }
}
/** n人の答え：多い順に 0・1・2・3 へ散らす（形は分け方で決まる） */
function 散らす(n, split) {
  const p = {}; let i = 1;
  split.forEach((cnt, k) => { for (let j = 0; j < cnt && i <= n; j++) p['m' + (i++)] = k; });
  return p;
}
function 開く(room) { OnajiRoom.advance(room); }
function 終える(room, split) {
  while (room.onaji.phase !== OnajiRoom.PHASE.ENDED) {
    if (room.onaji.phase === OnajiRoom.PHASE.CHOOSE) 選ぶ(room, 散らす(Object.keys(room.onaji.names).length, split));
    OnajiRoom.advance(room);
  }
}
function lab(room, screen, meId, extra) {
  const snap = JSON.parse(JSON.stringify(RT.publicSnapshot(room)));
  snap.state = { phase: room.state.phase, game: 'onaji', data: JSON.parse(JSON.stringify(OnajiRoom.publicView(room))) };
  return Object.assign({ screen, room: snap, you: JSON.parse(JSON.stringify(OnajiRoom.privateFor(room, meId) || {})), meId }, extra || {});
}

/** 場面ごと。o：{ n, long } */
const BUILD = {
  'onaji-choose': (o) => { const r = 部屋(o.n || 6, o); 選ぶ(r, { m2: 1, m3: 0 }); return lab(r, 'scr-v2-onaji', 'm1'); },
  'onaji-chosen': (o) => { const r = 部屋(o.n || 6, o); 選ぶ(r, { m1: 1, m3: 0 }); return lab(r, 'scr-v2-onaji', 'm1'); },
  'onaji-unveil': (o) => { const r = 部屋(o.n || 6, o); 四択へ(r); 選ぶ(r, 散らす(6, [3, 2, 1, 0])); 開く(r); return lab(r, 'scr-v2-onaji', 'm1'); },
  'onaji-scatter': (o) => { const r = 部屋(4, o); 四択へ(r); 選ぶ(r, 散らす(4, [1, 1, 1, 1])); 開く(r); return lab(r, 'scr-v2-onaji', 'm1'); },
  'onaji-result': (o) => { const r = 部屋(o.n || 6, o); 終える(r, [3, 2, 1]); return lab(r, 'scr-v2-onaji', 'm1', { host: true }); },
  'onaji-team-result': (o) => { const r = 部屋(o.n || 6, Object.assign({ mode: 'team' }, o)); 終える(r, [5, 1]); return lab(r, 'scr-v2-onaji', 'm2'); },
  'onaji-tv-choose': (o) => { const r = 部屋(o.n || 8, o); 選ぶ(r, { m2: 1, m3: 0, m5: 2, m6: 0 }); return lab(r, 'scr-v2-onaji-tv', 'tv'); },
  'onaji-tv-choose16': (o) => { const r = 部屋(16, o); 選ぶ(r, 散らす(9, [4, 3, 2])); return lab(r, 'scr-v2-onaji-tv', 'tv'); },
  'onaji-tv-unveil': (o) => { const r = 部屋(o.n || 8, o); 四択へ(r); 選ぶ(r, 散らす(8, [4, 2, 1, 1])); 開く(r); return lab(r, 'scr-v2-onaji-tv', 'tv'); },
  'onaji-tv-unveil16': (o) => { const r = 部屋(16, o); 四択へ(r); 選ぶ(r, 散らす(16, [6, 6, 3, 1])); 開く(r); return lab(r, 'scr-v2-onaji-tv', 'tv'); },
  // 見せ場の動き（せーの → 棒 → 冠 → 名前）を、動かして開く。tools/v2-motion.js が「なし」で止まるかを見る
  'onaji-tv-unveil-play': (o) => Object.assign(BUILD['onaji-tv-unveil'](o), { play: true }),
  'onaji-unveil-play': (o) => Object.assign(BUILD['onaji-unveil'](o), { play: true }),
  // 見せ場の動画（tools/v2-film.js）：みんなと同じの開く（8人・16人）
  'onaji-tv-film-unveil': (o) => Object.assign(BUILD['onaji-tv-unveil'](o), { play: true }),
  'onaji-tv-film-unveil16': (o) => Object.assign(BUILD['onaji-tv-unveil16'](o), { play: true }),
  'onaji-tv-scatter': (o) => { const r = 部屋(4, o); 四択へ(r); 選ぶ(r, 散らす(4, [1, 1, 1, 1])); 開く(r); return lab(r, 'scr-v2-onaji-tv', 'tv'); },
  'onaji-tv-team': (o) => { const r = 部屋(o.n || 8, Object.assign({ mode: 'team' }, o)); 四択へ(r); 選ぶ(r, 散らす(8, [8])); 開く(r); return lab(r, 'scr-v2-onaji-tv', 'tv'); },
  'onaji-tv-result16': (o) => { const r = 部屋(16, o); 終える(r, [8, 5, 2, 1]); return lab(r, 'scr-v2-onaji-tv', 'tv'); },
  'onaji-tv-team-result': (o) => { const r = 部屋(o.n || 8, Object.assign({ mode: 'team' }, o)); 終える(r, [8]); return lab(r, 'scr-v2-onaji-tv', 'tv'); }
};

const SCENES = Object.keys(BUILD).map((id) => ({ id, kind: id.indexOf('onaji-tv') === 0 ? 'tv' : 'phone', draw: 'v2game',
  screen: BUILD[id]({}).screen, mock: null }));

function view(sceneId, opts) {
  const b = BUILD[sceneId];
  if (!b) throw new Error('みんなと同じの見本の場面がありません: ' + sceneId);
  return b(opts || {});
}

module.exports = { SCENES, view };
