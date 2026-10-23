// tools/v2-lab/scenes.js — 新しい見た目（v2・指示66）の画面に流す「見本データ」（Node で作る）
//
// **これは本番には無い。**`public/` の外に置き、検証用サーバー（tools/dev-server.js の /v2lab）と
// 撮る道具（tools/v2-shot.js）だけが配る。本番の server.js はこの道を持たない（指示66-1「本番では開けない」）。
//
// **名簿は本物の部屋の箱から作る**（落とし穴25：手で書いた検体は実装から離れていく）。
// 部屋の知らせの形は realtime.js の publicSnapshot をそのまま通す（メンバーの8つの項目）。
// 文化祭だけの項目（次は何か・のこり時間・候補）は、66-2 で文化祭の部屋が配る。
// **66-1 ではまだ進行役が無いので、ここで決めた値を渡す**——66-2 で本物の進行役に差し替える（その時ここも直す）。
//
// 使い方：require('./scenes').view('fes-lobby', { n: 6 }) → 画面の描く関数にそのまま渡せる形

const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const RT = require(path.join(ROOT, 'realtime.js'));
const { publicSnapshot, RoomStore } = RT;
const TitleLogic = require(path.join(ROOT, 'public', 'js', 'titles.js'));

/** 見本（docs/指示66/見本/festival.html の F3・F6）と同じ名前と姿。見本と並べて比べるため */
const MOCK = [
  ['ふう', '🙂', 'ぶんかさいの一歩'], ['ひろ', '🌙', 'こだわりの解除名人'], ['びび', '🐺', 'はじまりの一歩'],
  ['ちか', '🎈', 'しずかな名探偵'], ['でん', '💣', 'ぶんかさいの一歩'], ['えみ', '🎆', 'ひらめきの一歩'],
  ['あき', '🙂', ''], ['kensho', '📖', ''], ['あいう', '💣', ''], ['まりこ', '👑', ''], ['そうた', '🎭', ''],
  ['ゆい', '🔥', ''], ['たかはし', '🐉', ''], ['りん', '💰', ''], ['こうへい', '🎲', ''], ['みさき', '🌙', '']
];
/** 長い名前の見本（8字まで。崩れないかを見る）。姿は本物の称号の部品（titles.js）から組む */
const LONG = ['ながいなまえだよ', 'たかはしゆういち', 'あいうえおかきく', 'kensho34', 'まりこさんだよ', 'しょうたろう', 'みさきちゃん', 'だいすけくん'];
function 姿(i) {
  const C = TitleLogic.CATALOG;
  return { icon: C.icon[(i * 5 + 1) % C.icon.length].emoji,
    title: TitleLogic.titleText({ first: C.first[(i * 3 + 1) % C.first.length].id, joiner: C.joiner[i % C.joiner.length].id, last: C.last[(i * 7 + 2) % C.last.length].id }) };
}
const ROOM_CODE = 'TST754';   // 見本と同じ（部屋コードの文字だけでできている）
/** 文化祭の部屋の上限（指示66-2「部屋は16人まで」。部屋の側の値は 66-2 で配る） */
const FES_MAX = 16;

/** 本物の部屋の箱に n 人（と大画面1台）を入れて、本物の公開スナップショットを取る */
function 部屋(n, long) {
  const store = new RoomStore();
  const room = store.create({ ownerUserId: 1, ownerUsername: 'kuma' });
  room.code = ROOM_CODE;
  const t0 = Date.now() - 5 * 60 * 1000;
  for (let i = 0; i < n; i++) {
    const id = 'm' + (i + 1);
    const mk = MOCK[i % MOCK.length];
    const look = long ? 姿(i) : { icon: mk[1], title: mk[2] || 姿(i).title };
    room.members.set(id, { id, name: long ? LONG[i % LONG.length] : mk[0], role: RT.ROLE_PLAYER, socketId: null,
      connected: true, joinedAt: t0 + i * 1000, lastSeen: Date.now(), readyGame: null, userId: null, look });
  }
  room.members.set('tv', { id: 'tv', name: 'テレビ', role: RT.ROLE_BIGSCREEN, socketId: null, connected: true,
    joinedAt: t0 + 200, lastSeen: Date.now(), readyGame: null, userId: null, look: null });
  room.hostMemberId = 'm1';
  return JSON.parse(JSON.stringify(publicSnapshot(room)));
}

/** 画面の一覧（撮る道具が回す）。kind：phone（390×844・375×667）／tv（1920×1080） */
const SCENES = [
  { id: 'fes-lobby', screen: 'scr-v2-fes-lobby', kind: 'phone', draw: 'fesLobby', mock: { page: 'festival.html', id: 'f3' } },
  { id: 'fes-tv', screen: 'scr-v2-fes-tv', kind: 'tv', draw: 'fesTv', mock: { page: 'festival.html', id: 't3' } },
  // 部品の見本。世界を変えて撮る（?world=bomb など）
  { id: 'parts', screen: 'scr-v2-parts', kind: 'phone', draw: 'parts', mock: null }
];

/**
 * 見本データ。opts：{ n＝人数（既定6）, long＝長い名前, cd＝のこり秒（既定27）, me＝自分の番号（既定1）, world＝部品の見本の世界 }
 * endsAt は「いま＋cd秒」。撮る時は V2.freeze で数を止める（毎回同じ写真にする）
 */
function view(sceneId, opts) {
  const o = opts || {};
  const n = o.n == null ? 6 : o.n;
  const snap = 部屋(n, o.long);
  return {
    code: snap.code, max: FES_MAX,
    joinUrl: null,   // 画面の側で、いま開いているサーバーの ?room= を入れる（tools/v2-lab/page.js）
    meId: 'm' + (o.me || 1),
    members: snap.members,
    fresh: n > 1 ? ['m2'] : [],
    next: { label: 'ゲームを投票', endsAt: Date.now() + (o.cd == null ? 27 : o.cd) * 1000 },
    candidates: ['bomb-coop', 'shinka', 'rcard'],
    world: o.world || 'wait'
  };
}

module.exports = { SCENES, view, FES_MAX, ROOM_CODE };
