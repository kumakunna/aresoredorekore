// tools/v2-lab/home-scenes.js — ふだんの画面（指示66-3）に流す見本データ
//
// **部屋の知らせは本物の部屋の箱から作る**（落とし穴25）。realtime.js の RoomStore に人を入れ、publicSnapshot をそのまま通す。
// 画面の側は index.html の V2Screens.home が、その知らせを rt に置いて、ふだんの描く関数をそのまま通す（見本だけの描き方を持たない）。
// 名前と姿は見本（docs/指示66/見本/entry.html・select.html）と同じ。本番には無い（public/ の外）

const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const RT = require(path.join(ROOT, 'realtime.js'));

// 見本 entry.html（E3・TE3・E4）と select.html（tm1：10人）の名前と顔（顔はアプリにある絵だけ。見本の 🐻 はアプリに無いので 🐤）
const MOCK = [['ふう', '🙂'], ['ひろ', '🌙'], ['びび', '🐺'], ['ちか', '🎈'], ['でん', '💣'], ['くまくん', '🐤'], ['えみ', '🎆'], ['あき', '🐉'],
  ['りん', '💰'], ['けん', '🎭'], ['ゆい', '🔥'], ['そうた', '🎲'], ['まりこ', '👑'], ['たかはし', '🌙'], ['こうへい', '🎈'], ['みさき', '🙂']];
const LONG = ['ながいなまえだよ', 'たかはしゆういち', 'あいうえおかきく', 'kensho34', 'まりこさんだよ', 'しょうたろう', 'みさきちゃん', 'だいすけくん'];
const CODE = 'TST754';

/** 本物の部屋の箱に n 人（と TV 1台）を入れる。m1 が進行役。game：決まったゲーム（モードの id と一緒に） */
function 部屋(n, o) {
  o = o || {};
  const store = new RT.RoomStore();
  const room = store.create({ ownerUserId: 1, ownerUsername: 'kuma' });
  room.code = CODE;
  const t0 = Date.now() - 5 * 60 * 1000;
  for (let i = 0; i < n; i++) {
    const mk = MOCK[i % MOCK.length];
    room.members.set('m' + (i + 1), { id: 'm' + (i + 1), name: o.long ? LONG[i % LONG.length] : mk[0], role: RT.ROLE_PLAYER, socketId: null,
      connected: true, joinedAt: t0 + i * 1000, lastSeen: Date.now(), readyGame: null, userId: null, look: { icon: mk[1], title: i === 5 ? '' : 'はじまりの一歩' } });
  }
  room.members.set('tv', { id: 'tv', name: 'TV', role: RT.ROLE_BIGSCREEN, socketId: null, connected: true,
    joinedAt: t0 + 200, lastSeen: Date.now(), readyGame: null, userId: null, look: null });
  room.hostMemberId = 'm1';
  if (o.game) {
    room.state.game = o.game;
    room.state.data = { modeId: o.mode || o.game };
    (o.ready || []).forEach((id) => { const m = room.members.get(id); if (m) m.readyGame = o.game; });
  }
  return JSON.parse(JSON.stringify(RT.publicSnapshot(room)));
}

/** 場面ごと。o：{ n, long } */
const BUILD = {
  // E1〜E2
  'home-e1': () => ({ screen: 'scr-v2-home', login: false }),
  'home-e2a': () => ({ screen: 'scr-v2-join', join: { step: 'code', code: 'TST75' } }),
  'home-e2b': () => ({ screen: 'scr-v2-join', join: { step: 'name', code: CODE, name: 'くまくん', peek: '進行役がゲームをえらぶのを待っています（いま5人）' } }),
  'home-e2tv': () => ({ screen: 'scr-v2-join', join: { step: 'code', code: '', tv: true } }),
  'home-e2qr': () => ({ screen: 'scr-v2-join', join: { step: 'code', code: '' }, open: ['v2QrHow'] }),
  // E3・E4・TV
  'home-e3': (o) => ({ screen: 'scr-v2-room', room: 部屋(o.n || 6, o), meId: 'm1', fresh: ['m6'] }),
  'home-e3-16': (o) => ({ screen: 'scr-v2-room', room: 部屋(16, o), meId: 'm1' }),
  'home-e3-qr': (o) => ({ screen: 'scr-v2-room', room: 部屋(o.n || 6, o), meId: 'm1', open: ['v2RoomQr'] }),
  'home-e3-tv': (o) => ({ screen: 'scr-v2-room', room: 部屋(o.n || 6, o), meId: 'm1', open: ['v2RoomTv'] }),
  'home-e3-mem': (o) => ({ screen: 'scr-v2-room', room: 部屋(o.n || 6, o), meId: 'm1', open: ['v2Mem-m3'] }),
  'home-e3-menu': (o) => ({ screen: 'scr-v2-room', room: 部屋(o.n || 6, o), meId: 'm1', menu: true }),
  'home-e3-picked': (o) => ({ screen: 'scr-v2-room', room: 部屋(o.n || 6, { game: 'bomb', mode: 'bomb-coop', ready: ['m1', 'm2', 'm3', 'm5'] }), meId: 'm1', seen: true }),
  'home-e4': (o) => ({ screen: 'scr-v2-room', room: 部屋(o.n || 6, o), meId: 'm6' }),
  'home-e4-look': (o) => ({ screen: 'scr-v2-room', room: 部屋(o.n || 6, o), meId: 'm6', open: ['v2Look'] }),
  'home-te3': (o) => ({ screen: 'scr-v2-room-tv', room: 部屋(o.n || 6, o), meId: 'tv', fresh: ['m6'] }),
  // E5
  'home-e5a': (o) => ({ screen: 'scr-next', room: 部屋(o.n || 6, { game: 'quizrush', mode: 'quizrush' }), meId: 'm1', cassette: 'quizou', game: 'quizrush', mode: 'quizrush' }),
  'home-e5b': (o) => ({ screen: 'scr-next', room: 部屋(o.n || 6, { game: 'quizrush', mode: 'quizrush' }), meId: 'm6', cassette: 'quizou', game: 'quizrush', mode: 'quizrush' }),
  'home-e5-close': (o) => ({ screen: 'scr-next', room: 部屋(o.n || 6, { game: 'quizrush', mode: 'quizrush' }), meId: 'm1', cassette: 'quizou', game: 'quizrush', mode: 'quizrush', ask: 'close' }),
  // ゲームをえらぶ（部屋・10人）
  'pick-list': (o) => ({ screen: 'scr-v2-pick', room: 部屋(o.n || 10, o), meId: 'm1', pick: { cur: 0, open: false } }),
  'pick-page': (o) => ({ screen: 'scr-v2-pick', room: 部屋(o.n || 10, o), meId: 'm1', pick: { cur: 6, open: true } }),
  'pick-page-no': (o) => ({ screen: 'scr-v2-pick', room: 部屋(o.n || 10, o), meId: 'm1', pick: { cur: 3, open: true } }),
  'pick-page-one': (o) => ({ screen: 'scr-v2-pick', room: 部屋(o.n || 10, o), meId: 'm1', pick: { cur: 8, open: true } }),
  // 1台で遊ぶ（部屋なし）
  'pick-one': () => ({ screen: 'scr-v2-pick', login: 'くまくん', heads: 0, pick: { cur: 0, open: false } }),
  'pick-one-heads': () => ({ screen: 'scr-v2-pick', login: 'くまくん', heads: 5, open: ['v2Heads'] }),
  'pick-one-login': () => ({ screen: 'scr-v2-pick', login: false, heads: 5, pick: { cur: 6, open: true } }),
  'pick-one-make': () => ({ screen: 'scr-v2-pick', login: 'くまくん', heads: 5, pick: { cur: 1, open: true } }),
  // S4
  'game-quiz': () => ({ screen: 'scr-game', room: 部屋(10), meId: 'm1', cassette: 'quizou', game: 'quizrush' }),
  'game-sugo': () => ({ screen: 'scr-game', room: 部屋(7), meId: 'm1', cassette: 'sugoroku', game: 'sugotoll' }),
  'mode-bomb': () => ({ screen: 'scr-mode', room: 部屋(6), meId: 'm1', cassette: 'bakudan', game: 'bomb', mode: 'bomb-coop' }),
  // S6 決めた時
  // 見本データは、68-1 のあとも棚に残るゲーム（人狼ゲーム）。False or True は 68-1 で棚から下りる（指示68-0b K8 ⑥）
  'dec': () => ({ screen: 'v2Decided', decided: { world: 'wolf', name: '人狼ゲーム', by: '進行役が えらびました', tv: false } }),
  'dec-tv': () => ({ screen: 'v2Decided', decided: { world: 'wolf', name: '人狼ゲーム', by: 'ふう が えらびました', tv: true } }),
  // TV：選んでいる間も変えない（10人・16人）
  'home-tv10': () => ({ screen: 'scr-v2-room-tv', room: 部屋(10), meId: 'tv' }),
  'home-tv16': (o) => ({ screen: 'scr-v2-room-tv', room: 部屋(16, o), meId: 'tv' })
};

/** 撮る道具の一覧に足す場面（kind：phone／tv、mock：見本の同じ場面） */
const SCENES = [
  ['home-e1', 'phone', 'entry.html', 'e1'], ['home-e2a', 'phone', 'entry.html', 'e2a'], ['home-e2b', 'phone', 'entry.html', 'e2b'],
  ['home-e2tv', 'phone', null, null], ['home-e2qr', 'phone', null, null],
  ['home-e3', 'phone', 'entry.html', 'e3'], ['home-e3-16', 'phone', null, null], ['home-e3-qr', 'phone', null, null], ['home-e3-tv', 'phone', null, null],
  ['home-e3-mem', 'phone', null, null], ['home-e3-menu', 'phone', null, null], ['home-e3-picked', 'phone', null, null],
  ['home-e4', 'phone', 'entry.html', 'e4'], ['home-e4-look', 'phone', null, null], ['home-te3', 'tv', 'entry.html', 'te3'],
  ['home-e5a', 'phone', 'entry.html', 'e5a'], ['home-e5b', 'phone', null, null], ['home-e5-close', 'phone', null, null],
  ['pick-list', 'phone', 'select.html', 'sm1'], ['pick-page', 'phone', null, null], ['pick-page-no', 'phone', null, null], ['pick-page-one', 'phone', 'select.html', 'sl2'],
  ['pick-one', 'phone', null, null], ['pick-one-heads', 'phone', null, null], ['pick-one-login', 'phone', 'select.html', 'sl1'], ['pick-one-make', 'phone', null, null],
  ['game-quiz', 'phone', 'select.html', 'sg1'], ['game-sugo', 'phone', 'select.html', 'sg2'], ['mode-bomb', 'phone', 'select.html', 'sg3'],
  ['dec', 'phone', 'select.html', 'sd1'], ['dec-tv', 'tv', 'select.html', 'td'],
  ['home-tv10', 'tv', 'select.html', 'tm1'], ['home-tv16', 'tv', null, null]
].map(([id, kind, page, mock]) => ({ id, kind, draw: 'home', home: true,
  screen: BUILD[id]({}).screen, mock: mock ? { page, id: mock } : null }));

function view(sceneId, opts) {
  const b = BUILD[sceneId];
  if (!b) throw new Error('ふだんの画面の見本の場面がありません: ' + sceneId);
  return b(opts || {});
}

module.exports = { SCENES, view, BUILD };
