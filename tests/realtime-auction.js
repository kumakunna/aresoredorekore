// tests/realtime-auction.js — 1人1台のオークションバトル（第31弾 第3部）
//
// 作り直しの芯が、通信のところまで守られているかを見る:
//   ・品物の正体・価値・階層が、落札が決まるまでどの端末にも届かないこと（大画面を含む）
//   ・鑑定眼のヒントが、買った本人にだけ届くこと
//   ・秘密入札の金額が、締め切るまで他の人に届かないこと
//   ・せり上げ式の最高額は、全員に見えること（そこが遊びの芯なので）
//   ・払うのは落札した人だけで、負けた人のチップが1枚も減らないこと
//   ・誰も入札しなければ流れて、誰のチップも動かないこと

const http = require('http');
const express = require('express');
const session = require('express-session');
const { io: ioClient } = require('socket.io-client');

const { createRunner, assert, assertEqual } = require('./harness');
const { attachRealtime, RoomStore } = require('../realtime');
const AuctionLogic = require('../public/js/auction-logic');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fakeDb() {
  const inserted = [];
  return {
    inserted,
    prepare() { return { run: (...args) => { inserted.push(args); return { lastInsertRowid: 1 }; } }; }
  };
}

function startTestServer(realtimeOpts) {
  const app = express();
  const sessionMiddleware = session({
    secret: 'test-secret-for-realtime-auction',
    resave: false, saveUninitialized: false,
    cookie: { httpOnly: true, secure: false, sameSite: 'lax' }
  });
  app.use(express.json());
  app.use(sessionMiddleware);
  app.post('/test-login', (req, res) => {
    req.session.userId = (req.body && req.body.userId) || 606;
    res.json({ ok: true });
  });
  const httpServer = http.createServer(app);
  const store = new RoomStore();
  const db = fakeDb();
  const io = attachRealtime(httpServer, sessionMiddleware,
    Object.assign({ store, db }, realtimeOpts || {}));
  return new Promise((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => {
      resolve({
        url: 'http://127.0.0.1:' + httpServer.address().port, store, io, db,
        close: () => new Promise((r) => {
          io.stopTimers();
          io.close(() => httpServer.close(() => r()));
        })
      });
    });
  });
}

async function login(url, userId) {
  const res = await fetch(url + '/test-login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId })
  });
  const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')];
  return (sc || []).filter(Boolean).map((c) => c.split(';')[0]).join('; ');
}

function device(url, cookie) {
  return new Promise((resolve, reject) => {
    const opts = { transports: ['polling'], forceNew: true, reconnection: false };
    if (cookie) opts.extraHeaders = { Cookie: cookie };
    const s = ioClient(url, opts);
    const d = {
      socket: s, room: null, you: null, ended: null,
      youLog: [], roomLog: [], memberId: null, code: null, name: null,
      call(event, payload) {
        return new Promise((res) => {
          const t = setTimeout(() => res({ ok: false, error: 'timeout' }), 6000);
          s.emit(event, payload || {}, (r) => { clearTimeout(t); res(r || {}); });
        });
      },
      seen() { return JSON.stringify({ r: d.roomLog, y: d.youLog, e: d.ended }); },
      close() { s.close(); }
    };
    s.on('room:update', (r) => { d.room = r; d.roomLog.push(r); });
    s.on('wolf:you', (p) => { d.you = p; d.youLog.push(p); });
    s.on('wolf:ended', (p) => { d.ended = p; });
    s.on('hb:ping', () => s.emit('hb:pong'));
    const t = setTimeout(() => reject(new Error('接続がタイムアウト')), 5000);
    s.on('connect', () => { clearTimeout(t); resolve(d); });
    s.on('connect_error', (e) => { clearTimeout(t); reject(e); });
  });
}

async function waitUntil(fn, label, ms) {
  const limit = Date.now() + (ms || 4000);
  while (Date.now() < limit) {
    if (fn()) return true;
    await sleep(25);
  }
  throw new Error('条件が満たされませんでした: ' + label);
}

async function makeRoom(srv, playerCount, withBigScreen) {
  const cookie = await login(srv.url, 4321);
  const host = await device(srv.url, cookie);
  const created = await host.call('room:create', { name: 'あき' });
  assertEqual(created.ok, true, '部屋を作れる');
  host.memberId = created.memberId; host.code = created.code; host.name = 'あき';

  const names = ['びび', 'ちか', 'でん'];
  const guests = [];
  for (let i = 1; i < playerCount; i++) {
    const nm = names[i - 1] || ('P' + (i + 1));
    const g = await device(srv.url);
    const res = await g.call('room:join', { code: created.code, name: nm });
    assertEqual(res.ok, true, nm + ' が入れる');
    g.memberId = res.memberId; g.name = nm;
    guests.push(g);
  }
  let big = null;
  if (withBigScreen) {
    big = await device(srv.url);
    const res = await big.call('room:join', { code: created.code, name: 'テレビ', role: 'bigscreen' });
    assertEqual(res.ok, true, '大画面が入れる');
    big.memberId = res.memberId;
  }
  return { host, guests, big, code: created.code, all: [host].concat(guests) };
}

function auctionOf(srv, code) { return srv.store.get(code).auction; }
function viewOf(d) { return (d.room && d.room.state && d.room.state.data) || {}; }

function startConfig(patch) {
  return Object.assign({ game: 'auction', mode: 'sealed', rounds: 3 }, patch || {});
}

// 品物を見る段階を全員ぶん済ませて、入札まで進める
async function toBid(srv, rm) {
  const w = () => auctionOf(srv, rm.code);
  await waitUntil(() => w() && w().phase === 'show', '品物が出る');
  for (const d of rm.all) await d.call('wolf:act', { targetId: 'ready' });
  await waitUntil(() => w().phase === 'bid', '入札が始まる');
}

// テストだけが使える覗き見。端末には届いていない品物の中身を取り出す
function itemOf(srv, code) { return auctionOf(srv, code).item; }

async function run() {
  const r = createRunner('realtime-auction：1人1台のオークション');

  await r.test('品物は「謎めいた一言」だけが届き、正体も価値も届かない', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 2, true);
      await rm.host.call('wolf:start', startConfig());
      await waitUntil(() => rm.host.you && rm.host.you.teaser, '一言が届く');
      const item = itemOf(srv, rm.code);
      assertEqual(rm.host.you.teaser, item.teaser, '一言は届く');
      assertEqual(viewOf(rm.host).teaser, item.teaser, '大画面にも一言は出る');

      [rm.host, rm.guests[0], rm.big].forEach((d) => {
        assertEqual(d.seen().indexOf(item.reveal), -1, '正体は届かない');
        assertEqual(d.seen().indexOf('"tier"'), -1, '価値の階層も届かない');
        item.hints.forEach((h) => {
          assertEqual(d.seen().indexOf(h), -1, 'ヒントも届かない');
        });
      });
    } finally { await srv.close(); }
  });

  await r.test('鑑定眼：買って使うと、自分にだけヒントが届く', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 2, true);
      await rm.host.call('wolf:start', startConfig());
      await waitUntil(() => rm.host.you && rm.host.you.teaser, '一言が届く');

      const buy = await rm.host.call('wolf:act', { targetId: 'buy:appraise' });
      assertEqual(buy.ok, true, '鑑定眼を買える');
      const use = await rm.host.call('wolf:act', { targetId: 'use:appraise' });
      assertEqual(use.ok, true, '使える');
      await waitUntil(() => (rm.host.you.hints || []).length === 1, 'ヒントが届く');

      const hint = rm.host.you.hints[0];
      assert(itemOf(srv, rm.code).hints.indexOf(hint) !== -1, '品物のヒントが出る');
      assertEqual(rm.guests[0].seen().indexOf(hint), -1, '他の人には届かない');
      assertEqual(rm.big.seen().indexOf(hint), -1, '大画面にも届かない');
    } finally { await srv.close(); }
  });

  await r.test('秘密入札：金額は締め切るまで他の人に届かない', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 2, true);
      await rm.host.call('wolf:start', startConfig({ mode: 'sealed', bidSec: 60 }));
      await toBid(srv, rm);

      await rm.host.call('wolf:vote', { targetId: 7 });
      await sleep(120);
      // 出したことは分かるが、いくらかは分からない
      assert(/あき/.test(JSON.stringify(viewOf(rm.guests[0]).doneNames || [])), '出したことは分かる');
      assertEqual(rm.guests[0].seen().indexOf('"amount"'), -1, '金額は届かない');
      assertEqual(rm.big.seen().indexOf('"amount"'), -1, '大画面にも届かない');
      assertEqual(rm.host.you.myBid, 7, '自分の金額は自分には見える');
    } finally { await srv.close(); }
  });

  await r.test('せり上げ式：最高額は全員に見えて、それ以下では入札できない', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 2, false);
      await rm.host.call('wolf:start', startConfig({ mode: 'open', extendSec: 30 }));
      await toBid(srv, rm);

      await rm.host.call('wolf:vote', { targetId: 5 });
      await waitUntil(() => viewOf(rm.guests[0]).highest, '最高額が全員に見える');
      assertEqual(viewOf(rm.guests[0]).highest.amount, 5, 'いくらかも見える');
      assertEqual(viewOf(rm.guests[0]).highest.name, 'あき', '誰が出したかも見える');

      const low = await rm.guests[0].call('wolf:vote', { targetId: 5 });
      assertEqual(low.ok, false, '同額では出せない');
      const up = await rm.guests[0].call('wolf:vote', { targetId: 6 });
      assertEqual(up.ok, true, '1つ上なら出せる');
      await waitUntil(() => viewOf(rm.host).highest.amount === 6, '値が上がる');
    } finally { await srv.close(); }
  });

  await r.test('払うのは落札した人だけ。負けた人のチップは1枚も減らない', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 2, false);
      await rm.host.call('wolf:start', startConfig({ mode: 'sealed', bidSec: 60 }));
      await toBid(srv, rm);
      const start = AuctionLogic.START_CHIPS;

      await rm.host.call('wolf:vote', { targetId: 9 });
      await rm.guests[0].call('wolf:vote', { targetId: 4 });
      await waitUntil(() => auctionOf(srv, rm.code).phase === 'result', '開票される');

      const w = auctionOf(srv, rm.code);
      const res = w.lastResult;
      assertEqual(res.winner, 'あき', '高い人が落札');
      assertEqual(res.paid, 9, '落札した人は出した額を払う');
      assertEqual(w.chips[rm.guests[0].memberId], start, '負けた人のチップは変わらない');
      assertEqual(w.chips[rm.host.memberId], start - res.paid + res.value, '落札者は払って受け取る');
    } finally { await srv.close(); }
  });

  await r.test('誰も入札しなければ品物は流れて、誰のチップも動かない', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 2, false);
      await rm.host.call('wolf:start', startConfig({ mode: 'sealed', bidSec: 60 }));
      await toBid(srv, rm);
      const start = AuctionLogic.START_CHIPS;

      // 0 は「降りる」。全員が降りたら流れる
      await rm.host.call('wolf:vote', { targetId: 0 });
      await rm.guests[0].call('wolf:vote', { targetId: 0 });
      await waitUntil(() => auctionOf(srv, rm.code).phase === 'result', '開票される');

      const w = auctionOf(srv, rm.code);
      assertEqual(w.lastResult.passed, true, '流れた');
      w.playerIds.forEach((id) => {
        assertEqual(w.chips[id], start, '誰のチップも動かない');
      });
    } finally { await srv.close(); }
  });

  await r.test('半額チケット：落札できたら、支払いが半分になる', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 2, false);
      await rm.host.call('wolf:start', startConfig({ mode: 'sealed', bidSec: 60 }));
      await waitUntil(() => rm.host.you && rm.host.you.teaser, '一言が届く');
      await rm.host.call('wolf:act', { targetId: 'buy:halfticket' });
      await rm.host.call('wolf:act', { targetId: 'use:halfticket' });
      await toBid(srv, rm);

      await rm.host.call('wolf:vote', { targetId: 8 });
      await rm.guests[0].call('wolf:vote', { targetId: 1 });
      await waitUntil(() => auctionOf(srv, rm.code).phase === 'result', '開票される');
      const res = auctionOf(srv, rm.code).lastResult;
      assertEqual(res.bid, 8, '出した額は8');
      assertEqual(res.paid, 4, '払うのは半分');
      assertEqual(res.halfticket, true, '使ったことが残る');
    } finally { await srv.close(); }
  });

  await r.test('ダブルアップ：落札した品物の価値が2倍になる', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 2, false);
      await rm.host.call('wolf:start', startConfig({ mode: 'sealed', bidSec: 60 }));
      await waitUntil(() => rm.host.you && rm.host.you.teaser, '一言が届く');
      const item = itemOf(srv, rm.code);
      await rm.host.call('wolf:act', { targetId: 'buy:doubleup' });
      await rm.host.call('wolf:act', { targetId: 'use:doubleup' });
      await toBid(srv, rm);

      await rm.host.call('wolf:vote', { targetId: 6 });
      await rm.guests[0].call('wolf:vote', { targetId: 1 });
      await waitUntil(() => auctionOf(srv, rm.code).phase === 'result', '開票される');
      const res = auctionOf(srv, rm.code).lastResult;
      assertEqual(res.value, item.value * 2, '価値が2倍（ハズレなら損も2倍）');
    } finally { await srv.close(); }
  });

  await r.test('撤回権：秘密入札でだけ使えて、出し直せる', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 2, false);
      await rm.host.call('wolf:start', startConfig({ mode: 'sealed', bidSec: 60 }));
      await waitUntil(() => rm.host.you && rm.host.you.teaser, '一言が届く');
      await rm.host.call('wolf:act', { targetId: 'buy:retract' });
      await toBid(srv, rm);

      await rm.host.call('wolf:vote', { targetId: 3 });
      const again = await rm.host.call('wolf:vote', { targetId: 9 });
      assertEqual(again.ok, false, '撤回せずに出し直すことはできない');
      const back = await rm.host.call('wolf:act', { targetId: 'retract' });
      assertEqual(back.ok, true, '撤回できる');
      const redo = await rm.host.call('wolf:vote', { targetId: 9 });
      assertEqual(redo.ok, true, '出し直せる');
      await waitUntil(() => rm.host.you.myBid === 9, '新しい金額になる');
    } finally { await srv.close(); }
  });

  await r.test('撤回権は、せり上げ式では買えない', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 2, false);
      await rm.host.call('wolf:start', startConfig({ mode: 'open' }));
      await waitUntil(() => rm.host.you && rm.host.you.shop, '買えるものが届く');
      const ids = rm.host.you.shop.map((x) => x.id);
      assertEqual(ids.indexOf('retract'), -1, 'せり上げ式の店には並ばない');
      const buy = await rm.host.call('wolf:act', { targetId: 'buy:retract' });
      assertEqual(buy.ok, false, '無理に買おうとしても通らない');
    } finally { await srv.close(); }
  });

  await r.test('救済：2ラウンド終わった時点で、最下位へ無料アイテムが配られる', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 2, false);
      await rm.host.call('wolf:start', startConfig({ mode: 'sealed', bidSec: 60, rounds: 5 }));
      const w = () => auctionOf(srv, rm.code);

      // 2ラウンド進める。品物の当たり外れは毎回変わるので、
      // 「誰が最下位か」は自分で決めてから配らせる（ランダムに左右されるテストにしない）
      for (let i = 0; i < 2; i++) {
        await toBid(srv, rm);
        await rm.host.call('wolf:vote', { targetId: 2 });
        await rm.guests[0].call('wolf:vote', { targetId: 0 });
        await waitUntil(() => w().phase === 'result', '開票される');
        if (i === 1) {
          w().chips[rm.host.memberId] = 20;
          w().chips[rm.guests[0].memberId] = 5;  // びびを最下位にする
        }
        w().deadline = Date.now() - 1;
        await waitUntil(() => w().round === i + 2, (i + 2) + 'ラウンド目になる', 3000);
      }
      // 3ラウンド目に入るところで、2ラウンドぶんの結果を見て配られる
      assertEqual(w().round, 3, '3ラウンド目');
      const note = w().rescueNote;
      assert(note && note.length === 1, '最下位の1人に配られた');
      assertEqual(note[0].name, 'びび', 'チップがいちばん少ない人へ');
      const id = rm.guests[0].memberId;
      const owned = Object.keys(w().inventory[id])
        .reduce((s, k) => s + w().inventory[id][k], 0);
      assertEqual(owned, 1, 'アイテムが1つ増えている');
      assertEqual(Object.keys(w().inventory[rm.host.memberId]).length, 0,
        '最下位でない人には配られない');
    } finally { await srv.close(); }
  });

  await r.test('決着したら、部屋のオーナーの記録として残る', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 2, false);
      await rm.host.call('wolf:start', startConfig({ mode: 'sealed', bidSec: 60, rounds: 3 }));
      const w = () => auctionOf(srv, rm.code);
      for (let i = 0; i < 3; i++) {
        if (w().phase === 'ended') break;
        await toBid(srv, rm);
        await rm.host.call('wolf:vote', { targetId: 2 });
        await rm.guests[0].call('wolf:vote', { targetId: 1 });
        await waitUntil(() => w().phase === 'result' || w().phase === 'ended', '開票される');
        if (w().phase === 'ended') break;
        w().deadline = Date.now() - 1;
        await waitUntil(() => w().phase === 'show' || w().phase === 'ended', '次へ進む', 3000);
      }
      await waitUntil(() => w().phase === 'ended', '決着する', 5000);
      await waitUntil(() => srv.db.inserted.length > 0, '記録が残る');
      const rounds = JSON.parse(srv.db.inserted[0][2]);
      assertEqual(rounds[0].detail.game, 'auction', 'どのゲームだったかが残る');
    } finally { await srv.close(); }
  });

  await r.test('遊び終わって別のゲームを選ぶと、オークションの進行は捨てられる', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 2, false);
      await rm.host.call('wolf:start', startConfig());
      await waitUntil(() => auctionOf(srv, rm.code), '進行が始まる');
      const reset = await rm.host.call('room:setState', { phase: 'lobby', game: null, reset: true });
      assertEqual(reset.ok, true, '選び直せる');
      assertEqual(auctionOf(srv, rm.code), undefined, '前のゲームの進行は残らない');
    } finally { await srv.close(); }
  });

  // finish() は失敗した時だけ process.exit(1) する。
  // 成功時に何も返さないので、返り値で終了コードを決めてはいけない
  // （緑なのに exit 1 になり、npm test の連鎖がそこで止まる）
  r.finish();
}

if (require.main === module) run();
module.exports = { run };
