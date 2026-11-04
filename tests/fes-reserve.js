// tests/fes-reserve.js — 満員の時の予約を、切れても取っておく（指示71 追記1・11/04 の検査レポート）
//
// それまでは予約を socket.id で持ち、切れると消えていた。つなぎ直しても、スマホは「予約しました（◯番目）」のまま——
// 本人は順番が消えたことに気づけない。予約に合い札（token）を持たせて端末に覚え、切れても 60秒は順番を取っておく。
// 60秒をすぎて消えた時は、もどった時に「消えました」（reserve_gone）と返す。60秒は検査だけ縮める（reserveKeepMs・落とし穴24）
const http = require('http');
const express = require('express');
const session = require('express-session');
const Database = require('better-sqlite3');
const { io: ioClient } = require('socket.io-client');
const { createRunner, assert, assertEqual } = require('./harness');
const { attachRealtime, RoomStore } = require('../realtime');
const { createFesStore } = require('../fes-store');
const FesRoom = require('../fes-room');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OWNER = 900;
const T = { lobbyMs: 600000, idleMs: 600000, voteMs: 400, decideMs: 100, readyMs: 500, resultMs: 300, endGraceMs: 100, reserveKeepMs: 1500 };

function startTestServer() {
  const app = express();
  const sessionMiddleware = session({ secret: 'test-reserve', resave: false, saveUninitialized: false, cookie: { httpOnly: true, secure: false, sameSite: 'lax' } });
  app.use(express.json()); app.use(sessionMiddleware);
  app.post('/test-login', (req, res) => { req.session.userId = req.body.userId; res.json({ ok: true }); });
  const httpServer = http.createServer(app);
  const store = new RoomStore();
  const io = attachRealtime(httpServer, sessionMiddleware, { store, db: null, describe: async () => ({ description: 'x' }), countdownMs: 0,
    fesStore: createFesStore(new Database(':memory:')), fesTimes: T, fesRole: (uid) => (uid === OWNER ? 'owner' : null) });
  return new Promise((resolve) => httpServer.listen(0, '127.0.0.1', () => {
    resolve({ url: 'http://127.0.0.1:' + httpServer.address().port, store, io,
      close: () => new Promise((r) => { io.stopTimers(); io.close(() => httpServer.close(() => r())); }) });
  }));
}
async function login(url, userId) {
  const res = await fetch(url + '/test-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId }) });
  return (res.headers.getSetCookie() || []).map((c) => c.split(';')[0]).join('; ');
}
function device(url, cookie) {
  return new Promise((resolve, reject) => {
    const opts = { transports: ['polling'], forceNew: true, reconnection: false };
    if (cookie) opts.extraHeaders = { Cookie: cookie };
    const s = ioClient(url, opts);
    const d = { socket: s, queue: [], turns: [],
      call(ev, p) { return new Promise((res) => { const t = setTimeout(() => res({ ok: false, error: 'timeout' }), 6000); s.emit(ev, p || {}, (r) => { clearTimeout(t); res(r || {}); }); }); },
      close() { s.close(); } };
    s.on('fes:queue', (p) => d.queue.push(p));
    s.on('fes:turn', (p) => d.turns.push(p));
    s.on('hb:ping', () => s.emit('hb:pong'));
    s.on('connect', () => resolve(d));
    s.on('connect_error', reject);
  });
}
async function until(fn, label, ms) {
  const limit = Date.now() + (ms || 5000);
  while (Date.now() < limit) { if (fn()) return; await sleep(25); }
  throw new Error('条件が満たされませんでした: ' + label);
}
/** 文化祭の部屋を作り、16人で満員にする */
async function 満員(srv) {
  const staff = await device(srv.url, await login(srv.url, OWNER));
  const c = await staff.call('fes:create', {});
  const ps = [];
  for (let i = 0; i < FesRoom.ROOM_MAX; i++) {
    const d = await device(srv.url);
    const r = await d.call('room:join', { code: c.code, name: 'p' + i, diff: 'normal' });
    assert(r.ok, i + '人目が入れる（' + r.error + '）');
    ps.push(d);
  }
  return { code: c.code, staff, ps };
}

(async function main() {
  const r = createRunner('fes-reserve：満員の時の予約を、切れても取っておく（指示71 追記1）');

  await r.test('予約すると合い札（token）が返る。切れて 60秒以内（検査は1.5秒）に合い札でもどると、同じ順番のまま', async () => {
    const srv = await startTestServer();
    try {
      const { code } = await 満員(srv);
      const a = await device(srv.url), b = await device(srv.url);
      const ra = await a.call('fes:reserve', { code });
      const rb = await b.call('fes:reserve', { code });
      assert(ra.ok && ra.pos === 1 && typeof ra.token === 'string' && ra.token.length >= 6, 'a は1番目・合い札がある（' + JSON.stringify(ra) + '）');
      assertEqual(rb.pos, 2, 'b は2番目');
      a.close();
      await sleep(600);
      const room = srv.store.get(code);
      assertEqual(room.fes.queue.length, 2, '切れても、すぐには消さない（順番を取っておく）');
      const a2 = await device(srv.url);
      const back = await a2.call('fes:reserve', { code, resume: ra.token });
      assert(back.ok, 'もどれる（' + JSON.stringify(back) + '）');
      assertEqual(back.pos, 1, '同じ1番目のまま');
      assertEqual(back.token, ra.token, '合い札は同じ');
      await sleep(1500);
      assertEqual(srv.store.get(code).fes.queue.length, 2, 'もどったあとは、時間がたっても消えない');
      a2.close(); b.close();
    } finally { await srv.close(); }
  });

  await r.test('切れて 60秒（検査は1.5秒）をすぎると予約は消え、後ろの人が前へ。もどると reserve_gone（「順番が消えました」）', async () => {
    const srv = await startTestServer();
    try {
      const { code } = await 満員(srv);
      const a = await device(srv.url), b = await device(srv.url);
      const ra = await a.call('fes:reserve', { code });
      await b.call('fes:reserve', { code });
      a.close();
      await until(() => srv.store.get(code).fes.queue.length === 1, '1.5秒をすぎたら消える', 4000);
      await until(() => b.queue.some((q) => q.pos === 1), 'b に「1番目」が届く', 2000);
      const a2 = await device(srv.url);
      const back = await a2.call('fes:reserve', { code, resume: ra.token });
      assertEqual(back.ok + ' ' + back.error, 'false reserve_gone', '消えた予約にはもどれない（' + JSON.stringify(back) + '）');
      a2.close(); b.close();
    } finally { await srv.close(); }
  });

  await r.test('取っておく間に順番が来た（「どうぞ」20秒）→ もどったら、その場で「どうぞ」をもう一度受け取る', async () => {
    const srv = await startTestServer();
    try {
      const { code, ps } = await 満員(srv);
      const a = await device(srv.url);
      const ra = await a.call('fes:reserve', { code });
      a.close();
      await sleep(200);
      // 1人出ていく（席が1つ空く）→ 先頭（切れている a）に「どうぞ」
      await ps[0].call('room:leave', { code });
      ps[0].close();
      await until(() => (srv.store.get(code).fes.queue[0] || {}).offerUntil > 0, '先頭に「どうぞ」が出る', 4000);
      const a2 = await device(srv.url);
      const back = await a2.call('fes:reserve', { code, resume: ra.token });
      assert(back.ok, 'もどれる');
      await until(() => a2.turns.length === 1 && a2.turns[0].token === ra.token, 'もどった端末に「どうぞ」が届く（合い札つき）', 2000);
      const j = await a2.call('room:join', { code, name: 'もどった', diff: 'normal', reserve: ra.token });
      assert(j.ok, '「どうぞ」の合い札で入れる（' + j.error + '）');
      a2.close();
    } finally { await srv.close(); }
  });

  await r.test('自分で「やめる」を押した予約は、すぐ消える（切れた時とはちがう）', async () => {
    const srv = await startTestServer();
    try {
      const { code } = await 満員(srv);
      const a = await device(srv.url);
      await a.call('fes:reserve', { code });
      await a.call('fes:unreserve', { code });
      assertEqual(srv.store.get(code).fes.queue.length, 0, 'やめたら消える');
      a.close();
    } finally { await srv.close(); }
  });

  r.finish();
  process.exit(0);
})();
