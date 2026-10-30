// tools/v2-lab/quiz2-scenes.js — クイズ王2.0「みんなで早答え」「数字ちかい方」（指示68-5）の画面に流す見本データ
//
// **本物の進行役（qhaya-room.js・qnear-room.js）を動かして作る**（落とし穴25）。問題は乱数を止めて毎回同じ。本番には無い（public/ の外）
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const RT = require(path.join(ROOT, 'realtime.js'));
const QHaya = require(path.join(ROOT, 'qhaya-room.js'));
const QNear = require(path.join(ROOT, 'qnear-room.js'));

const NAMES = ['ふう', 'ひろ', 'びび', 'ちか', 'でん', 'えみ', 'あき', 'くまくん', 'kensho', 'あいう', 'まりこ', 'そうた', 'ゆい', 'たかはし', 'りん', 'みさき'];
const FACES = ['🙂', '🌙', '🐺', '🎈', '💣', '🎆', '🙂', '📖', '📖', '💣', '👑', '🎭', '🔥', '🐉', '💰', '🎈'];
const CODE = 'TST755';

function 部屋(n, Room) {
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
  let seed = 3; const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  const res = Room.startGame(room, { _rand: rnd }, { notify() {} });
  if (!res.ok) throw new Error('クイズ王2.0を始められません: ' + res.error);
  return room;
}
function lab(room, Room, screen, meId, extra) {
  const snap = JSON.parse(JSON.stringify(RT.publicSnapshot(room)));
  // 撮る道具は10秒で動きが止まるのを見る。答えている間の帯（のこり時間でちぢむ）は短くしておく
  snap.state = { phase: room.state.phase, game: room.state.game, data: JSON.parse(JSON.stringify(Room.publicView(room))) };
  if (snap.state.data.remainingMs != null) snap.state.data.remainingMs = Math.min(snap.state.data.remainingMs, 2500);
  return Object.assign({ screen, room: snap, you: JSON.parse(JSON.stringify(Room.privateFor(room, meId) || {})), meId }, extra || {});
}

/** 早答え：k 問目まで進める（それより前の問題は、1人目がいつも正解・ほかは交互に） */
function 早答え(n, k, opts) {
  const r = 部屋(n, QHaya), w = r.qhaya;
  for (let q = 0; q < k; q++) {
    const c = w.qs[q].correct, C = w.qs[q].choices.length;
    w.startedAt = Date.now() - 2200;
    for (let i = 0; i < n; i++) {
      const pick = i === 0 || (i + q) % 3 === 0 ? c : (c + 1 + (i % (C - 1))) % C;
      QHaya.submitAction(r, 'm' + (i + 1), null, { pick, ms: 750 + i * 90 });
    }
    QHaya.advance(r);                                   // 開く
    if (q < k - 1 || (opts && opts.next)) QHaya.advance(r);   // つぎへ
  }
  return r;
}
function 数字(n, k, opts) {
  const r = 部屋(n, QNear), w = r.qnear;
  for (let q = 0; q < k; q++) {
    const a = w.qs[q].answer;
    for (let i = 0; i < n; i++) {
      const v = opts && opts.perfect && i === 0 ? a : Math.max(0, Math.round(a * (1 + ((i % 7) - 3) * 0.06 + (i === n - 1 ? 3 : 0))) + i);
      QNear.submitAction(r, 'm' + (i + 1), null, { value: v });
    }
    QNear.advance(r);
    if (q < k - 1 || (opts && opts.next)) QNear.advance(r);
  }
  return r;
}

// 長い名前（8文字・指示68-5 の直し）：大きく出す名前（いちばん早かった人・1位・いちばん近い人）が画面からはみ出さないかを見る
const 長い = ['たかはしゆういち', 'ながいなまえだよ', 'さくらもちこさん', 'やまのぼりたろう', 'うみべのはなこさ', 'あいうえおかきく', 'きたかぜとたいよ', 'みなみのしまのこ',
  'ひがしのそらいろ', 'にしのゆうやけだ', 'ほしぞらみあげる', 'つきよのうさぎだ', 'はるのおがわさん', 'なつまつりのよる', 'あきのもみじがり', 'ふゆのこたつねこ'];
function 長くする(r, game) {
  const w = r[game]; let i = 0;
  r.members.forEach((m) => { if (m.role === RT.ROLE_PLAYER) { m.name = 長い[i % 長い.length]; if (w.names[m.id] != null) w.names[m.id] = m.name; i++; } });
  return r;
}
const BUILD = {
  'qh-choose': (o) => { const r = 早答え(o.n || 6, 0); QHaya.submitAction(r, 'm2', null, { pick: 0, ms: 2000 }); return lab(r, QHaya, 'scr-v2-qhaya', 'm1'); },
  'qh-chosen': (o) => { const r = 早答え(o.n || 6, 0); QHaya.submitAction(r, 'm1', null, { pick: 1, ms: 2000 }); return lab(r, QHaya, 'scr-v2-qhaya', 'm1'); },
  'qh-open': (o) => { const r = 早答え(o.n || 6, 1); return lab(r, QHaya, 'scr-v2-qhaya', 'm1'); },
  'qh-open-miss': (o) => { const r = 早答え(o.n || 6, 1); return lab(r, QHaya, 'scr-v2-qhaya', 'm2'); },
  'qh-ended': (o) => { const r = 早答え(o.n || 6, 10, { next: true }); return lab(r, QHaya, 'scr-v2-qhaya', 'm1', { host: true }); },
  'qh-tv-choose': (o) => { const r = 早答え(o.n || 8, 0); ['m2', 'm3', 'm5'].forEach((id) => QHaya.submitAction(r, id, null, { pick: 0, ms: 2000 })); return lab(r, QHaya, 'scr-v2-qhaya-tv', 'tv'); },
  'qh-tv-last': (o) => { const r = 早答え(o.n || 8, 9, { next: true }); return lab(r, QHaya, 'scr-v2-qhaya-tv', 'tv'); },
  'qh-tv-open': (o) => { const r = 早答え(o.n || 8, 1); return lab(r, QHaya, 'scr-v2-qhaya-tv', 'tv'); },
  'qh-tv-open16': (o) => { const r = 早答え(16, 2); return lab(r, QHaya, 'scr-v2-qhaya-tv', 'tv'); },
  'qh-tv-rank16': (o) => { const r = 早答え(16, 3); return lab(r, QHaya, 'scr-v2-qhaya-tv', 'tv'); },
  'qh-tv-ended16': (o) => { const r = 早答え(16, 10, { next: true }); return lab(r, QHaya, 'scr-v2-qhaya-tv', 'tv'); },
  'qn-guess': (o) => { const r = 数字(o.n || 6, 0); return lab(r, QNear, 'scr-v2-qnear', 'm1', { local: { digits: '3700' } }); },
  'qn-guessed': (o) => { const r = 数字(o.n || 6, 0); QNear.submitAction(r, 'm1', null, { value: 3700 }); return lab(r, QNear, 'scr-v2-qnear', 'm1'); },
  'qn-open': (o) => { const r = 数字(o.n || 6, 1); return lab(r, QNear, 'scr-v2-qnear', 'm1'); },
  'qn-ended': (o) => { const r = 数字(o.n || 6, 5, { next: true }); return lab(r, QNear, 'scr-v2-qnear', 'm1', { host: true }); },
  'qn-tv-guess': (o) => { const r = 数字(o.n || 8, 0); ['m2', 'm4'].forEach((id) => QNear.submitAction(r, id, null, { value: 100 })); return lab(r, QNear, 'scr-v2-qnear-tv', 'tv'); },
  'qn-tv-open': (o) => { const r = 数字(o.n || 8, 1); return lab(r, QNear, 'scr-v2-qnear-tv', 'tv'); },
  'qn-tv-open16': (o) => { const r = 数字(16, 1); return lab(r, QNear, 'scr-v2-qnear-tv', 'tv'); },
  'qn-tv-perfect': (o) => { const r = 数字(o.n || 8, 1, { perfect: true }); return lab(r, QNear, 'scr-v2-qnear-tv', 'tv'); },
  'qn-tv-ended16': (o) => { const r = 数字(16, 5, { next: true }); return lab(r, QNear, 'scr-v2-qnear-tv', 'tv'); },
  'qh-tv-open16-long': (o) => { const r = 長くする(早答え(16, 2), 'qhaya'); return lab(r, QHaya, 'scr-v2-qhaya-tv', 'tv'); },
  'qh-tv-rank16-long': (o) => { const r = 長くする(早答え(16, 3), 'qhaya'); return lab(r, QHaya, 'scr-v2-qhaya-tv', 'tv'); },
  'qh-tv-ended16-long': (o) => { const r = 長くする(早答え(16, 10, { next: true }), 'qhaya'); return lab(r, QHaya, 'scr-v2-qhaya-tv', 'tv'); },
  'qn-tv-open16-long': (o) => { const r = 長くする(数字(16, 1), 'qnear'); return lab(r, QNear, 'scr-v2-qnear-tv', 'tv'); },
  'qn-tv-perfect-long': (o) => { const r = 長くする(数字(8, 1, { perfect: true }), 'qnear'); return lab(r, QNear, 'scr-v2-qnear-tv', 'tv'); }
};
// 見せ場の動画（tools/v2-film.js）：動かして開く
BUILD['qh-tv-film-open16'] = (o) => Object.assign(BUILD['qh-tv-open16'](o), { play: true });
BUILD['qh-tv-film-rank16'] = (o) => Object.assign(BUILD['qh-tv-rank16'](o), { play: true });
BUILD['qh-tv-film-ended16'] = (o) => Object.assign(BUILD['qh-tv-ended16'](o), { play: true });
BUILD['qh-tv-film-last'] = (o) => Object.assign(BUILD['qh-tv-last'](o), { play: true });
BUILD['qn-tv-film-open16'] = (o) => Object.assign(BUILD['qn-tv-open16'](o), { play: true });
BUILD['qn-tv-film-perfect'] = (o) => Object.assign(BUILD['qn-tv-perfect'](o), { play: true });
BUILD['qh-tv-film-rank16-long'] = (o) => Object.assign(BUILD['qh-tv-rank16-long'](o), { play: true });

const SCENES = Object.keys(BUILD).map((id) => ({ id, kind: /-tv-/.test(id) ? 'tv' : 'phone', draw: 'v2game', screen: BUILD[id]({}).screen, mock: null }));

function view(sceneId, opts) {
  const b = BUILD[sceneId];
  if (!b) throw new Error('クイズ王2.0の見本の場面がありません: ' + sceneId);
  return b(opts || {});
}

module.exports = { SCENES, view, 早答え };
