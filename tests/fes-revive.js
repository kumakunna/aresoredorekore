// tests/fes-revive.js — 指示74 1：別のアプリに切りかえて、もどってきた人（本物のサーバー＋本物の rt-client.js）
//
// 11/6 の実機（iPhone Safari・Android Samsung Internet）：別のアプリに 25〜45秒 切りかえてもどると、
// 通信（socket）は生きたまま、サーバーからは「つながっていない」（connected=false・socketId=null）になり、
// hb:ping がもう届かない → 二度ともどらない・本人だけの知らせ（盤・fes:you）が届かない・押しても何も変わらない。
// 2分たつと名簿から外されるが、スマホには何も届かず、止まった部屋の画面のまま。
//
// 別のアプリにいる間を、ここでは「hb:pong を捨てる」で作る（11/6 に本番で同じことを起こした手順と同じ）。
// 25秒は待たずに、lastSeen を30秒前にずらす（判定の25秒そのものは変えない・落とし穴24）。
//
// 1 pong を捨てて「つながっていない」にされる → また答える → もどる・socketId がこの socket・投票が本人に届く
// 2 pong を捨てたまま、投票を押す → 押したことで、もどる・投票の印（fes:you）が届く
// 3 画面がまた見えた（rt.here）→ もどる・いまの全部が届く
// 4 クイズ解除の途中：もどると盤（wolf:you）が届き、マスを押せる
// 5 2分たって外された（socket は生きている）→ room:kicked（fes_gone）が届く → 「入る」1回で入れる
// 6 5 で、外された知らせを取りこぼした → もどった時（rt.here）に fes_gone → 同じ形
// 7 通信が切れて socket.io がつなぎ直した（その間に外された）→ 自動の入り直しが fes_gone → 同じ形
// 8 同じ人の別のタブ（古い socket）は、もどる時に今のタブから取り返さない
'use strict';

const http = require('http');
const express = require('express');
const session = require('express-session');
const Database = require('better-sqlite3');
const { io: ioClient } = require('socket.io-client');

const { createRunner, assert, assertEqual } = require('./harness');
const { attachRealtime, RoomStore } = require('../realtime');
const { createFesStore } = require('../fes-store');
const FesRoom = require('../fes-room');
const RTClient = require('../public/js/rt-client.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const STAFF = 901;
// 検査の時間（遊びの数字は変えない・ここだけ短い）
const T = { lobbyMs: 300, idleMs: 600, voteMs: 60000, decideMs: 100, readyMs: 1500, resultMs: 300, endGraceMs: 100 };

function startTestServer(times) {
  const app = express();
  const sessionMiddleware = session({ secret: 'test-fes-revive', resave: false, saveUninitialized: false,
    cookie: { httpOnly: true, secure: false, sameSite: 'lax' } });
  app.use(express.json());
  app.use(sessionMiddleware);
  app.post('/test-login', (req, res) => { req.session.userId = req.body.userId; res.json({ ok: true }); });
  const httpServer = http.createServer(app);
  const store = new RoomStore();
  const io = attachRealtime(httpServer, sessionMiddleware, {
    store, db: null, describe: async () => ({ description: 'x' }), countdownMs: 0,
    fesStore: createFesStore(new Database(':memory:')), fesTimes: times || T,
    fesRole: (uid) => (uid === STAFF ? 'staff' : null),
    sweepIntervalMs: 100, heartbeatIntervalMs: 200
  });
  return new Promise((resolve) => httpServer.listen(0, '127.0.0.1', () => {
    const url = 'http://127.0.0.1:' + httpServer.address().port;
    resolve({ url, store, io,
      close: () => new Promise((r) => { io.stopTimers(); io.close(() => httpServer.close(() => r())); }) });
  }));
}
async function login(url, userId) {
  const res = await fetch(url + '/test-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId }) });
  return (res.headers.getSetCookie() || []).map((c) => c.split(';')[0]).join('; ');
}
/** そのまま答える端末（ほかの人・係） */
function device(url, cookie) {
  return new Promise((resolve, reject) => {
    const opts = { transports: ['polling'], forceNew: true, reconnection: false };
    if (cookie) opts.extraHeaders = { Cookie: cookie };
    const s = ioClient(url, opts);
    const d = { socket: s, room: null, me: null, wolf: null,
      call(ev, p) { return new Promise((res) => { const t = setTimeout(() => res({ ok: false, error: 'timeout' }), 6000);
        s.emit(ev, p || {}, (r) => { clearTimeout(t); res(r || {}); }); }); },
      close() { s.close(); } };
    s.on('room:update', (r) => { d.room = r; });
    s.on('fes:you', (p) => { d.me = p; });
    s.on('wolf:you', (p) => { d.wolf = p; });
    s.on('hb:ping', () => s.emit('hb:pong'));
    s.on('connect', () => resolve(d));
    s.on('connect_error', reject);
  });
}
/**
 * スマホ：本物の rt-client.js。別のアプリにいる間は away=true（hb:pong を捨てる・ほかは通す）。
 * 届いた知らせを数える（もどったあとに「新しく」届いたかを見るため）
 */
function phone(url, extra) {
  const ph = { sock: null, away: false, kicked: [], lost: [], you: 0, fes: 0 };
  ph.rt = RTClient.create({ io: (o) => {
    const s = ioClient(url, Object.assign({}, o, { transports: ['polling'], forceNew: true }, extra || {}));
    const emit = s.emit.bind(s);
    s.emit = function (ev) { if (ph.away && ev === 'hb:pong') return s; return emit.apply(null, arguments); };
    ph.sock = s;
    return s;
  } });
  ph.rt.on('kicked', (p) => ph.kicked.push(p));
  ph.rt.on('lost', (p) => ph.lost.push(p));
  ph.rt.on('you', () => { ph.you++; });
  ph.rt.on('fes', () => { ph.fes++; });
  return ph;
}
async function waitUntil(fn, label, ms) {
  const limit = Date.now() + (ms || 5000);
  while (Date.now() < limit) { if (fn()) return true; await sleep(25); }
  throw new Error('条件が満たされませんでした: ' + label);
}
async function makeFes(srv, modes) {
  const staff = await device(srv.url, await login(srv.url, STAFF));
  const c = await staff.call('fes:create', {});
  assertEqual(c.ok, true, '係は文化祭の部屋を作れる');
  srv.store.get(c.code).fes.games = FesRoom.FES_GAMES.filter((g) => modes.indexOf(g.mode) !== -1)
    .map((g) => Object.assign({}, g, { on: true, testing: false }));
  return { staff, code: c.code };
}
async function others(srv, code, names) {
  const ds = [];
  for (const n of names) {
    const d = await device(srv.url);
    const r = await d.call('room:join', { code, name: n, diff: 'normal' });
    assertEqual(r.ok, true, n + ' が入れる');
    d.memberId = r.memberId;
    ds.push(d);
  }
  return ds;
}
async function phoneJoin(srv, code, name, extra) {
  const ph = phone(srv.url, extra);
  const r = await ph.rt.joinRoom(code, name, 'player', undefined, 'normal');
  assertEqual(r.ok, true, name + '（スマホ）が入れる');
  await waitUntil(() => ph.rt.state.room && ph.rt.state.fes, '入った知らせが届く');
  ph.memberId = r.memberId;
  return ph;
}
const memberOf = (srv, code, id) => srv.store.get(code).members.get(id);
const phaseOf = (srv, code) => srv.store.get(code).fes.phase;
/** 別のアプリへ：pong を捨てて、25秒より長く答えなかったことにする（lastSeen を30秒前へ）→ つながっていない扱いになるまで */
async function goAway(srv, code, ph) {
  ph.away = true;
  await sleep(300);   // 捨てる前に出ていた pong（polling の送りの途中）が着き終わるのを待つ
  memberOf(srv, code, ph.memberId).lastSeen = Date.now() - 30000;
  await waitUntil(() => !memberOf(srv, code, ph.memberId).connected, '25秒答えないと「つながっていない」になる', 3000);
  // 型(b)：pong を捨てている間は、本当にもどらない（hb:ping は 0.2秒ごと）
  await sleep(600);
  const m = memberOf(srv, code, ph.memberId);
  assert(m && !m.connected && m.socketId === null, '答えていない間は、つながっていないまま（socketId は null）');
  assertEqual(ph.sock.connected, true, '通信（socket）そのものは生きている');
}
async function toVote(srv, code) {
  await waitUntil(() => phaseOf(srv, code) === 'vote', '投票になる', 5000);
  return srv.store.get(code).fes.candidates[0];
}

(async function main() {
  const r = createRunner('fes-revive：別のアプリに切りかえて、もどってきた人（指示74 1）');

  await r.test('1：hb:ping に25秒より長く答えず、そのあと答える → もどる。socketId がこの socket になり、投票が本人に届く', async () => {
    const srv = await startTestServer();
    const { staff, code } = await makeFes(srv, ['pittari', 'soroe']);
    const ds = await others(srv, code, ['ひろ', 'びび']);
    const ph = await phoneJoin(srv, code, 'ふう');
    const mode = await toVote(srv, code);
    await goAway(srv, code, ph);
    ph.away = false;                                    // もどってきた：また答える
    await waitUntil(() => memberOf(srv, code, ph.memberId).connected, 'また答えたら、つながっているにもどる', 3000);
    assertEqual(memberOf(srv, code, ph.memberId).socketId, ph.sock.id, 'socketId はこの socket');
    const res = await ph.rt.fesVote(mode);
    assertEqual(res.ok, true, '投票できる');
    await waitUntil(() => ph.rt.state.fes && ph.rt.state.fes.vote === mode, '自分の投票の印（fes:you）が届く', 2000);
    [staff, ...ds].forEach((d) => d.close()); ph.sock.close();
    await srv.close();
  });

  await r.test('2：答えないまま、投票を押す → 押したことで、もどる。投票の印（fes:you）が届く', async () => {
    const srv = await startTestServer();
    const { staff, code } = await makeFes(srv, ['pittari', 'soroe']);
    const ds = await others(srv, code, ['ひろ', 'びび']);
    const ph = await phoneJoin(srv, code, 'ふう');
    const mode = await toVote(srv, code);
    await goAway(srv, code, ph);
    const res = await ph.rt.fesVote(mode);              // pong はまだ捨てている（押すだけ）
    assertEqual(res.ok, true, '投票できる');
    await waitUntil(() => ph.rt.state.fes && ph.rt.state.fes.vote === mode, '自分の投票の印（fes:you）が届く', 2000);
    assertEqual(memberOf(srv, code, ph.memberId).connected, true, '押したら、つながっているにもどる');
    assertEqual(memberOf(srv, code, ph.memberId).socketId, ph.sock.id, 'socketId はこの socket');
    [staff, ...ds].forEach((d) => d.close()); ph.sock.close();
    await srv.close();
  });

  await r.test('3：画面がまた見えた（rt.here）→ すぐもどる（10秒待たない）。いまの全部（部屋の知らせ・fes:you）が届く', async () => {
    const srv = await startTestServer();
    const { staff, code } = await makeFes(srv, ['pittari', 'soroe']);
    const ds = await others(srv, code, ['ひろ', 'びび']);
    const ph = await phoneJoin(srv, code, 'ふう');
    await toVote(srv, code);
    await goAway(srv, code, ph);
    const fes0 = ph.fes;
    ph.rt.state.room = null;                            // 前の知らせを消しておき、届き直したかを見る
    const res = await ph.rt.here();
    assertEqual(res.ok, true, 'room:here は ok');
    assertEqual(res.back, true, 'もどった（つながっていない扱いだった）と答える');
    assertEqual(memberOf(srv, code, ph.memberId).connected, true, 'つながっているにもどる');
    await waitUntil(() => ph.fes > fes0 && ph.rt.state.room, 'fes:you と部屋の知らせが届き直す', 2000);
    assertEqual(ph.rt.state.room.fes.phase, 'vote', '部屋の知らせは、いまの段階（投票）');
    const again = await ph.rt.here();                   // つながっている時に知らせても、何も壊れない
    assertEqual(again.ok, true, '2回目も ok');
    assertEqual(again.back, false, '2回目は「もどった」ではない');
    [staff, ...ds].forEach((d) => d.close()); ph.sock.close();
    await srv.close();
  });

  await r.test('3b：画面がまた見えたのに「いるよ」の答えが来ない（通信が切れているのに socket.io がまだ気づいていない）→ すぐつなぎ直して、同じ人で入り直す', async () => {
    const srv = await startTestServer();
    const { staff, code } = await makeFes(srv, ['pittari', 'soroe']);
    const ds = await others(srv, code, ['ひろ', 'びび']);
    const ph = await phoneJoin(srv, code, 'ふう', { reconnectionDelay: 100, reconnectionDelayMax: 100, randomizationFactor: 0 });
    let rejoined = 0;
    ph.rt.on('rejoined', () => { rejoined++; });
    const emit = ph.sock.emit;
    let dropHere = true;
    ph.sock.emit = function (ev) { if (dropHere && ev === 'room:here') return ph.sock; return emit.apply(ph.sock, arguments); };   // 届かない
    const t = Date.now();
    const res = await ph.rt.here();
    assertEqual(res.error, 'timeout', '型(b)：答えが来ない（5秒）');
    dropHere = false;
    await waitUntil(() => rejoined > 0, 'つなぎ直して入り直す（socket.io の約35秒を待たない）', 5000);
    assert(Date.now() - t < 9000, '答えが来ないと分かってから、すぐつなぎ直す（' + (Date.now() - t) + 'ms）');
    assertEqual(ph.rt.state.memberId, ph.memberId, '同じ人のまま');
    assertEqual(memberOf(srv, code, ph.memberId).connected, true, 'つながっている');
    [staff, ...ds].forEach((d) => d.close()); ph.sock.close();
    await srv.close();
  });

  await r.test('3c：「いるよ」の答えを待つ間に socket.io が自分でつなぎ直した → 時間切れでも、新しい通信は切らない（入り直しは1回だけ）', async () => {
    const srv = await startTestServer();
    const { staff, code } = await makeFes(srv, ['pittari', 'soroe']);
    const ds = await others(srv, code, ['ひろ', 'びび']);
    const ph = await phoneJoin(srv, code, 'ふう', { reconnectionDelay: 100, reconnectionDelayMax: 100, randomizationFactor: 0 });
    let rejoined = 0;
    ph.rt.on('rejoined', () => { rejoined++; });
    const emit = ph.sock.emit;
    ph.sock.emit = function (ev) { if (ev === 'room:here') return ph.sock; return emit.apply(ph.sock, arguments); };   // 死んだ通信に送った
    const p = ph.rt.here();
    await sleep(200);
    ph.sock.io.engine.close();                          // その間に socket.io が切断に気づいて、つなぎ直す
    await waitUntil(() => rejoined === 1, 'つなぎ直して入り直す', 4000);
    const engine = ph.sock.io.engine;
    const res = await p;
    assertEqual(res.error, 'timeout', '型(b)：最初の「いるよ」は時間切れ');
    await sleep(1500);
    assertEqual(ph.sock.io.engine, engine, '新しい通信はそのまま（切っていない）');
    assertEqual(rejoined, 1, '入り直しは1回だけ');
    assertEqual(memberOf(srv, code, ph.memberId).connected, true, 'つながっている');
    [staff, ...ds].forEach((d) => d.close()); ph.sock.close();
    await srv.close();
  });

  await r.test('4：クイズ解除の途中で離れて、もどる → 盤（wolf:you）が届き、マスを押せる', async () => {
    const srv = await startTestServer();
    const { staff, code } = await makeFes(srv, ['bomb-coop']);
    const ds = await others(srv, code, ['ひろ', 'びび']);
    const ph = await phoneJoin(srv, code, 'ふう');
    await waitUntil(() => phaseOf(srv, code) === 'ready', 'ルールと準備OKへ', 6000);
    const game = srv.store.get(code).state.game;
    for (const d of ds) await d.call('room:ready', { game });
    assertEqual((await ph.rt.setReady(true)).ok, true, 'スマホも準備OK');
    await waitUntil(() => phaseOf(srv, code) === 'play', '始まる', 6000);
    await waitUntil(() => ph.rt.state.secret && ph.rt.state.secret.board, '盤が届いている', 3000);
    await goAway(srv, code, ph);
    const you0 = ph.you;
    ph.rt.state.secret = null;
    ph.away = false;                                    // もどってきた
    await waitUntil(() => memberOf(srv, code, ph.memberId).connected, 'もどる', 3000);
    await waitUntil(() => ph.you > you0 && ph.rt.state.secret && ph.rt.state.secret.board, '盤（wolf:you）が届き直す', 2000);
    const cell = ph.rt.state.secret.board.find((c) => !c.solved && !c.by);
    assert(cell, '押せるマスがある');
    const you1 = ph.you;
    const res = await ph.rt.act(cell.uid);
    assertEqual(res.ok, true, 'マスを押せる（' + res.error + '）');
    await waitUntil(() => ph.you > you1, '押したあとの自分の様子が届く', 2000);
    [staff, ...ds].forEach((d) => d.close()); ph.sock.close();
    await srv.close();
  });

  // 待合のまま2分（ここでは 0.8秒）たつと外される。席の取りおき（30秒・ここでは 0.3秒）より長い
  const GONE = Object.assign({}, T, { lobbyMs: 60000, holdMs: 300, goneMs: 800 });

  await r.test('5：2分たって外された（socket は生きている）→ 外された知らせ（fes_gone）が届く → 「入る」1回で入れる', async () => {
    const srv = await startTestServer(GONE);
    const { staff, code } = await makeFes(srv, ['pittari', 'soroe']);
    const ds = await others(srv, code, ['ひろ']);
    const ph = await phoneJoin(srv, code, 'ふう');
    await goAway(srv, code, ph);
    await waitUntil(() => !memberOf(srv, code, ph.memberId), '2分たつと名簿から外される', 3000);
    await waitUntil(() => ph.kicked.length, 'スマホに外された知らせが届く（止まった部屋の画面のままにしない）', 2000);
    assertEqual(ph.kicked[0].reason, 'fes_gone', '理由は fes_gone（「しばらく はなれていたので」）');
    assertEqual(ph.rt.state.code, null, 'スマホの部屋の印は消える');
    await sleep(500);
    assertEqual(ph.kicked.length, 1, '知らせは1回');
    ph.away = false;
    const res = await ph.rt.joinRoom(code, 'ふう', 'player', undefined, 'normal');
    assertEqual(res.ok, true, '「入る」1回で入れる（' + res.error + '）');
    assertEqual(memberOf(srv, code, res.memberId).connected, true, '入った人はつながっている');
    assertEqual(memberOf(srv, code, res.memberId).name, 'ふう', '名前はそのまま（ふう② にならない）');
    [staff, ...ds].forEach((d) => d.close()); ph.sock.close();
    await srv.close();
  });

  await r.test('6：外された知らせを取りこぼした → 画面がまた見えた時（rt.here）に fes_gone → 5 と同じ形', async () => {
    const srv = await startTestServer(GONE);
    const { staff, code } = await makeFes(srv, ['pittari', 'soroe']);
    const ds = await others(srv, code, ['ひろ']);
    const ph = await phoneJoin(srv, code, 'ふう');
    ph.sock.off('room:kicked');                         // JS が止まっている間の知らせは、受け取れないことがある
    await goAway(srv, code, ph);
    await waitUntil(() => !memberOf(srv, code, ph.memberId), '2分たつと名簿から外される', 3000);
    await sleep(300);
    assertEqual(ph.kicked.length, 0, '型(b)：まだ外された知らせは受け取っていない');
    assert(ph.rt.state.code, '型(b)：スマホはまだ部屋にいるつもり');
    ph.away = false;
    const res = await ph.rt.here();
    assertEqual(res.error, 'fes_gone', 'もどった時の答えは fes_gone');
    assertEqual(ph.kicked.length, 1, '外された知らせ（5 と同じ道）');
    assertEqual(ph.kicked[0].reason, 'fes_gone', '理由は fes_gone');
    assertEqual(ph.rt.state.code, null, 'スマホの部屋の印は消える');
    const j = await ph.rt.joinRoom(code, 'ふう', 'player', undefined, 'normal');
    assertEqual(j.ok, true, '「入る」1回で入れる');
    [staff, ...ds].forEach((d) => d.close()); ph.sock.close();
    await srv.close();
  });

  await r.test('7：通信が切れて socket.io がつなぎ直した（その間に外された）→ 自動の入り直しが fes_gone → 5 と同じ形（黙って新しい人として入らない）', async () => {
    const srv = await startTestServer(GONE);
    const { staff, code } = await makeFes(srv, ['pittari', 'soroe']);
    const ds = await others(srv, code, ['ひろ']);
    // つなぎ直しは 2.5秒後（外されるのは 0.8秒後）
    const ph = await phoneJoin(srv, code, 'ふう', { reconnectionDelay: 2500, reconnectionDelayMax: 2500, randomizationFactor: 0 });
    const oldId = ph.memberId;
    ph.sock.io.engine.close();                          // 通信が切れる（45秒より長く離れた）
    await waitUntil(() => !memberOf(srv, code, oldId), '切れて2分たつと名簿から外される', 3000);
    assertEqual(ph.kicked.length, 0, '型(b)：外された時は、通信が切れていて知らせは届かない');
    await waitUntil(() => ph.kicked.length, 'つなぎ直したら、外された知らせになる', 5000);
    assertEqual(ph.kicked[0].reason, 'fes_gone', '理由は fes_gone（5・6 と同じ）');
    assertEqual(ph.rt.state.code, null, 'スマホの部屋の印は消える');
    const live = Array.from(srv.store.get(code).members.values()).filter((m) => m.role !== 'bigscreen');
    assertEqual(live.length, 1, '新しい人として黙って入っていない（いるのは ひろ だけ）');
    const j = await ph.rt.joinRoom(code, 'ふう', 'player', undefined, 'normal');
    assertEqual(j.ok, true, '「入る」1回で入れる');
    [staff, ...ds].forEach((d) => d.close()); ph.sock.close();
    await srv.close();
  });

  await r.test('7b：通信が切れて、2分より前につなぎ直した → いままでどおり同じ人でもどる（fes_gone にしない）', async () => {
    const srv = await startTestServer(Object.assign({}, GONE, { goneMs: 60000 }));
    const { staff, code } = await makeFes(srv, ['pittari', 'soroe']);
    const ds = await others(srv, code, ['ひろ']);
    const ph = await phoneJoin(srv, code, 'ふう', { reconnectionDelay: 300, reconnectionDelayMax: 300, randomizationFactor: 0 });
    let rejoined = 0;
    ph.rt.on('rejoined', () => { rejoined++; });
    ph.sock.io.engine.close();
    await waitUntil(() => rejoined > 0, 'つなぎ直して入り直す', 5000);
    assertEqual(ph.kicked.length, 0, '外された知らせは出ない');
    assertEqual(ph.rt.state.memberId, ph.memberId, '同じ人のまま');
    assertEqual(memberOf(srv, code, ph.memberId).connected, true, 'つながっている');
    [staff, ...ds].forEach((d) => d.close()); ph.sock.close();
    await srv.close();
  });

  await r.test('8：同じ人の別のタブ（古い socket）は、答えても今のタブから取り返さない', async () => {
    const srv = await startTestServer();
    const { staff, code } = await makeFes(srv, ['pittari', 'soroe']);
    const ds = await others(srv, code, ['ひろ', 'びび']);
    const a = await device(srv.url);
    const ra = await a.call('room:join', { code, name: 'ふう', diff: 'normal' });
    const b = await device(srv.url);                     // 同じ memberId の2つ目のタブ
    const rb = await b.call('room:join', { code, name: 'ふう', diff: 'normal', memberId: ra.memberId });
    assertEqual(rb.memberId, ra.memberId, '同じ人');
    assertEqual(memberOf(srv, code, ra.memberId).socketId, b.socket.id, 'あとのタブが正');
    await sleep(800);                                    // 古いタブ a も hb:ping に答え続けている
    assertEqual(memberOf(srv, code, ra.memberId).socketId, b.socket.id, '古いタブが答えても、あとのタブのまま');
    const h = await a.call('room:here', { code, memberId: ra.memberId });
    assertEqual(h.other, true, '古いタブの「いるよ」は、別のタブが正と答える');
    assertEqual(memberOf(srv, code, ra.memberId).socketId, b.socket.id, 'room:here でも取り返さない');
    [staff, ...ds, a, b].forEach((d) => d.close());
    await srv.close();
  });

  // 指示74「ほかに見たこと」：投票の札の並びが、人が入った時に入れかわったように見えた（たしかではない）。
  // 投票中に並びが変わると、押そうとした札がずれて別のゲームに投票しうる。投票中は変わらないことを確かめる
  //（待合の「候補」の列は人数で変わるが、そこは長押しでルールを見るだけで、投票はできない）
  await r.test('9：投票中に人が入っても、投票の札（候補）の並びは変わらない', async () => {
    const srv = await startTestServer();
    const { staff, code } = await makeFes(srv, ['pittari', 'soroe', 'onaji-many', 'bomb-coop']);
    const ds = await others(srv, code, ['ひろ', 'びび', 'ふう']);
    await toVote(srv, code);
    const before = srv.store.get(code).fes.candidates.slice();
    assertEqual(before.length >= 2, true, '型(b)：候補が2つ以上ある（並びが意味を持つ）');
    await waitUntil(() => ds[0].room && ds[0].room.fes && ds[0].room.fes.phase === 'vote', 'スマホにも投票が届く', 2000);
    const shown = ds[0].room.fes.candidates.slice();
    assertEqual(JSON.stringify(shown), JSON.stringify(before), 'スマホの札はサーバーの候補と同じ並び');
    ds.push(...await others(srv, code, ['あお', 'みどり']));
    await sleep(600);
    assertEqual(phaseOf(srv, code), 'vote', 'まだ投票中');
    assertEqual(JSON.stringify(srv.store.get(code).fes.candidates), JSON.stringify(before), 'サーバーの候補の並びは同じ');
    assertEqual(JSON.stringify(ds[0].room.fes.candidates), JSON.stringify(shown), 'スマホに届いた候補の並びも同じ');
    [staff, ...ds].forEach((d) => d.close());
    await srv.close();
  });

  r.finish();
})();
