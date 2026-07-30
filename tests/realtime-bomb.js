// tests/realtime-bomb.js — 1人1台の爆弾解除「クイズ解除」（第27弾）
//
// 実機・複数端末を使わず、socket.io-client の接続を複数立てて確かめる。
// 見るのは:
//   ・通常版：全員が同じ盤面を自分の端末で見て、協力して解除まで通せること
//   ・通常版：同じコードに2人が同時に挑めないこと（1回のミスでライフが2つ減らない）
//   ・競争版：説明文が試合が始まるまで1文字も届かないこと
//   ・競争版：並び順が人ごとに違うこと
//   ・競争版：ミスでライフ−1と残り時間−10秒の両方が効くこと
//   ・競争版：終わり方の設定（最初の1人／全員）が効くこと
//   ・ライフ0の人が記録なし・最下位あつかいになること
//   ・大画面ホストに、お題の名前も説明文も一切届かないこと
//   ・時間切れで締まること
//   ・決着したら対戦履歴が残ること

const http = require('http');
const express = require('express');
const session = require('express-session');
const { io: ioClient } = require('socket.io-client');

const { createRunner, assert, assertEqual } = require('./harness');
const { attachRealtime, RoomStore } = require('../realtime');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// お題プール。名前を「お題-」で始めておくと、
// 公開情報に混ざっていないかを1つの目印で探せる
const TOPIC_MARK = 'お題-';
function makeTopics(n, tier) {
  const out = [];
  for (let i = 1; i <= n; i++) {
    out.push({ name: TOPIC_MARK + (tier || 'easy') + i, tier: tier || 'easy', ng_words: ['ng'] });
  }
  return out;
}
const DESC_MARK = 'せつめい【';
// AIの代役。ネットワークを使わずに、名前入りの説明文を返す。
// 名前を含めておくことで「説明文が漏れたら名前も漏れる」形にしてある
function fakeDescribe(delayMs) {
  return async (input) => {
    if (delayMs) await sleep(delayMs);
    return { description: DESC_MARK + input.name + '】' };
  };
}

// 記録の保存だけを受け取る差し替え用のdb（better-sqlite3 はこのPCで読めない）
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
    secret: 'test-secret-for-realtime-bomb',
    resave: false, saveUninitialized: false,
    cookie: { httpOnly: true, secure: false, sameSite: 'lax' }
  });
  app.use(express.json());
  app.use(sessionMiddleware);
  app.post('/test-login', (req, res) => {
    req.session.userId = (req.body && req.body.userId) || 777;
    res.json({ ok: true });
  });
  const httpServer = http.createServer(app);
  const store = new RoomStore();
  const db = fakeDb();
  const io = attachRealtime(httpServer, sessionMiddleware,
    Object.assign({ store, db, describe: fakeDescribe() }, realtimeOpts || {}));
  return new Promise((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => {
      const port = httpServer.address().port;
      resolve({
        port, url: 'http://127.0.0.1:' + port, store, io, db,
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

// 1台ぶんの端末。届いたものを覚えておく
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
      // 盤面（自分に届いた並び）から、まだ解いていないコードを1本
      nextUid() {
        const board = (d.you && d.you.board) || [];
        const cell = board.find((c) => !c.solved && !c.by);
        return cell ? cell.uid : null;
      },
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

// 部屋を作り、指定人数のプレイヤーと（必要なら）大画面をそろえる
async function makeRoom(srv, playerCount, withBigScreen) {
  const cookie = await login(srv.url, 4321);
  const host = await device(srv.url, cookie);
  const created = await host.call('room:create', { name: 'あき' });
  assertEqual(created.ok, true, '部屋を作れる');
  host.memberId = created.memberId; host.code = created.code; host.name = 'あき';

  const names = ['びび', 'ちか', 'でん', 'えみ'];
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

function bombOf(srv, code) { return srv.store.get(code).bomb; }
// テストだけが使える覗き見。端末には届いていない「正解」を取り出す
function answerFor(srv, code, uid) {
  const w = bombOf(srv, code);
  const wire = w.wires.find((x) => x.uid === uid);
  return wire ? wire.name : null;
}
function viewOf(d) {
  return (d.room && d.room.state && d.room.state.data) || {};
}

// 開始の設定をひとまとめに
function startConfig(patch) {
  return Object.assign({
    game: 'bomb', mode: 'coop', counts: { easy: 3 }, lives: 3,
    layout: 'sorted', timerSec: 0, topics: makeTopics(8)
  }, patch || {});
}

// 1本ぶん、正しく解く
async function solveOne(srv, d) {
  const uid = d.nextUid();
  if (!uid) return false;
  const opened = await d.call('wolf:act', { targetId: uid });
  if (!opened.ok) return false;
  await waitUntil(() => d.you && d.you.open && d.you.open.uid === uid, '説明文が届く');
  const ans = answerFor(srv, d.code, uid);
  await d.call('wolf:vote', { targetId: ans });
  return true;
}
// 1本ぶん、わざと外す
async function missOne(srv, d) {
  const uid = d.nextUid();
  if (!uid) return false;
  await d.call('wolf:act', { targetId: uid });
  await waitUntil(() => d.you && d.you.open && d.you.open.uid === uid, '説明文が届く');
  const right = answerFor(srv, d.code, uid);
  const wrong = (d.you.open.choices || []).find((c) => c !== right);
  await d.call('wolf:vote', { targetId: wrong });
  return true;
}

(async function main() {
  const r = createRunner('realtime-bomb：1人1台のクイズ解除');

  // ---- 通常版（全員スマホ・協力） ----

  await r.test('通常版：全員が同じ盤面を見て、協力して解除まで通せる', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 3, false);
      rm.guests.forEach((g) => { g.code = rm.code; });
      const res = await rm.host.call('wolf:start', startConfig());
      assertEqual(res.ok, true, 'ホストが始められる');

      // 説明文ができるまでは「準備中」。本数だけが見えている
      await waitUntil(() => rm.all.every((d) => d.you && d.you.phase === 'play'),
        '説明文がそろって解除が始まる');
      assertEqual(rm.host.you.total, 3, 'コードは3本');

      // 全員が同じ盤面を見ている（並びも同じ）
      const boards = rm.all.map((d) => d.you.board.map((c) => c.uid).join(','));
      assertEqual(new Set(boards).size, 1, '通常版は全員が同じ並びを見る');
      assertEqual(viewOf(rm.host).board.length, 3, '公開情報にも同じ盤面が載る');

      // 3人で手分けして全部解く
      for (let i = 0; i < 3; i++) {
        const d = rm.all[i % rm.all.length];
        await solveOne(srv, d);
        await sleep(30);
      }
      await waitUntil(() => rm.all.every((d) => d.you && d.you.phase === 'ended'), '決着する');
      const result = rm.host.you.result;
      assertEqual(result.success, true, '解除に成功した');
      assertEqual(result.solved, 3, '3本すべて解除');
      assertEqual(result.misses, 0, 'ミス0');
      // 通常版は協力なので、個人の順位は付けない
      assertEqual(result.ranking, undefined, '通常版に順位は無い');
    } finally { await srv.close(); }
  });

  await r.test('通常版：ライフが尽きると爆発する（ライフは全員で共有）', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 2, false);
      rm.guests.forEach((g) => { g.code = rm.code; });
      await rm.host.call('wolf:start', startConfig({ lives: 2 }));
      await waitUntil(() => rm.all.every((d) => d.you && d.you.phase === 'play'), '解除が始まる');

      await missOne(srv, rm.host);
      await waitUntil(() => rm.guests[0].you.lives === 1, 'ミスが相手のライフにも反映される');
      assertEqual(rm.guests[0].you.misses, 1, 'ミス数も共有される');

      await missOne(srv, rm.guests[0]);
      await waitUntil(() => rm.all.every((d) => d.you.phase === 'ended'), '爆発して決着する');
      assertEqual(rm.host.you.result.success, false, '失敗');
      assertEqual(rm.host.you.result.cause, 'lives', '理由はライフ切れ');
    } finally { await srv.close(); }
  });

  await r.test('通常版：同じコードに2人が同時には挑めない', async () => {
    // 2人とも外して、1回のミスでライフが2つ減るのを防ぐための決まり
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 2, false);
      rm.guests.forEach((g) => { g.code = rm.code; });
      await rm.host.call('wolf:start', startConfig());
      await waitUntil(() => rm.all.every((d) => d.you && d.you.phase === 'play'), '解除が始まる');

      const uid = rm.host.you.board[0].uid;
      const first = await rm.host.call('wolf:act', { targetId: uid });
      assertEqual(first.ok, true, '先に押した人は開ける');
      const second = await rm.guests[0].call('wolf:act', { targetId: uid });
      assertEqual(second.ok, false, 'あとから同じコードは開けない');
      assertEqual(second.error, 'taken', 'ふさがっていることが伝わる');

      // 挑戦中は、相手の画面にも「誰が挑戦中か」が出る
      await waitUntil(() => (rm.guests[0].you.board || []).some((c) => c.by === 'あき'),
        '誰が挑戦中かが相手に見える');
      const pub = viewOf(rm.guests[0]);
      assert(pub.players.some((p) => p.name === 'あき' && p.working === 'easy'),
        '公開情報には難易度までが載る');

      // 閉じれば、ほかの人が挑戦できる
      await rm.host.call('wolf:act', { targetId: null });
      await waitUntil(() => !(rm.guests[0].you.board || []).some((c) => c.by), '空く');
      const third = await rm.guests[0].call('wolf:act', { targetId: uid });
      assertEqual(third.ok, true, '空いたら開ける');
    } finally { await srv.close(); }
  });

  // ---- 秘密の扱い ----

  await r.test('お題の名前と説明文は、公開情報に一度も混ざらない', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 3, true);
      rm.guests.forEach((g) => { g.code = rm.code; });
      await rm.host.call('wolf:start', startConfig({ counts: { easy: 2 } }));
      await waitUntil(() => rm.all.every((d) => d.you && d.you.phase === 'play'), '解除が始まる');
      await solveOne(srv, rm.host);
      await waitUntil(() => rm.host.you.solvedCount === 1, '1本解ける');

      // 決着までに届いた公開情報を全部まとめて調べる
      const publicText = JSON.stringify(rm.all.concat([rm.big]).map((d) => d.roomLog));
      assert(publicText.indexOf(TOPIC_MARK) === -1, 'お題の名前が公開情報に無い');
      assert(publicText.indexOf(DESC_MARK) === -1, '説明文が公開情報に無い');

      // 大画面には、自分だけに届く情報がひとつも来ない
      assertEqual(rm.big.you, null, '大画面に秘密は届かない');
      assertEqual(rm.big.youLog.length, 0, '一度も届いていない');
      // 大画面が受け取る盤面には、難易度と解除済みかだけが入っている
      const cell = viewOf(rm.big).board[0];
      assertEqual(Object.keys(cell).sort().join(','), 'by,solved,solvedBy,tier,uid',
        '盤面のマスに入っているのは状態だけ');
    } finally { await srv.close(); }
  });

  await r.test('自分が開けていないコードの説明文は、自分にも届かない', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 2, false);
      rm.guests.forEach((g) => { g.code = rm.code; });
      await rm.host.call('wolf:start', startConfig({ counts: { easy: 3 } }));
      await waitUntil(() => rm.host.you && rm.host.you.phase === 'play', '解除が始まる');

      // 開ける前は、説明文も3択もどこにも無い
      assertEqual(rm.host.you.open, undefined, '開けていないので中身は無い');
      assert(JSON.stringify(rm.host.you).indexOf(DESC_MARK) === -1, '説明文が1つも届いていない');

      const uid = rm.host.you.board[1].uid;
      await rm.host.call('wolf:act', { targetId: uid });
      await waitUntil(() => rm.host.you.open && rm.host.you.open.uid === uid, '開けたものだけ届く');
      const text = JSON.stringify(rm.host.you);
      assertEqual(text.split(DESC_MARK).length - 1, 1, '届いている説明文は1本ぶんだけ');
      // 相手の端末には、その説明文は届いていない
      assert(JSON.stringify(rm.guests[0].you).indexOf(DESC_MARK) === -1,
        '他の人の端末には届かない');
    } finally { await srv.close(); }
  });

  // ---- 競争版 ----

  await r.test('競争版：説明文は試合が始まるまで、誰の端末にも届かない', async () => {
    // 説明文づくりをゆっくりにして、待機中の状態をつかむ
    const srv = await startTestServer({ describe: fakeDescribe(60) });
    try {
      const rm = await makeRoom(srv, 2, true);
      rm.guests.forEach((g) => { g.code = rm.code; });
      await rm.host.call('wolf:start', startConfig({ mode: 'race', counts: { easy: 6 } }));

      // 準備中：本数だけが進んでいく
      await waitUntil(() => rm.host.you && rm.host.you.phase === 'prep' && rm.host.you.prep.ready > 0,
        '準備の進み具合が届く');
      assertEqual(rm.host.you.board, undefined, '準備中は盤面すら配らない');
      const duringPrep = JSON.stringify([rm.host.youLog, rm.guests[0].youLog, rm.big.roomLog]);
      assert(duringPrep.indexOf(DESC_MARK) === -1, '準備中に説明文が届いていない');
      assert(duringPrep.indexOf(TOPIC_MARK) === -1, '準備中にお題の名前も届いていない');
      // サーバー側には、もうできている
      assert(bombOf(srv, rm.code).wires.some((x) => x.description),
        'サーバーだけが説明文を持っている');

      await waitUntil(() => rm.host.you.phase === 'play', '始まったら盤面が届く', 6000);
      assertEqual(rm.host.you.board.length, 6, '6本の盤面');
    } finally { await srv.close(); }
  });

  await r.test('競争版：コードの並び順は人ごとに違う', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 3, false);
      rm.guests.forEach((g) => { g.code = rm.code; });
      // 「ごちゃまぜ」で本数を多くすると、偶然そろう確率が無視できる
      await rm.host.call('wolf:start', startConfig({
        mode: 'race', layout: 'mixed', counts: { easy: 8 }, topics: makeTopics(12)
      }));
      await waitUntil(() => rm.all.every((d) => d.you && d.you.phase === 'play'), '解除が始まる');
      const orders = rm.all.map((d) => d.you.board.map((c) => c.uid).join(','));
      assert(new Set(orders).size > 1, '全員が同じ並びではない');
      // 中身（どのコードがあるか）は全員同じ。同じ爆弾に挑んでいる
      const sets = rm.all.map((d) => d.you.board.map((c) => c.uid).sort().join(','));
      assertEqual(new Set(sets).size, 1, '挑むコードは全員同じ');
    } finally { await srv.close(); }
  });

  await r.test('競争版：ミスするとライフ−1と残り時間−10秒の両方が効く', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 2, false);
      rm.guests.forEach((g) => { g.code = rm.code; });
      await rm.host.call('wolf:start', startConfig({
        mode: 'race', counts: { easy: 4 }, lives: 3, timerSec: 180
      }));
      await waitUntil(() => rm.all.every((d) => d.you && d.you.phase === 'play'), '解除が始まる');
      const before = rm.host.you.remainingMs;
      assert(before > 160000, '残り時間が届いている');

      await missOne(srv, rm.host);
      await waitUntil(() => rm.host.you.misses === 1, 'ミスが記録される');
      assertEqual(rm.host.you.lives, 2, 'ライフが1つ減る');
      const after = rm.host.you.remainingMs;
      assert(before - after >= 10000, '残り時間も10秒以上減る（実際: ' + (before - after) + 'ms）');

      // 罰は自分だけ。競争版は他人のミスに巻き込まれない
      assertEqual(rm.guests[0].you.lives, 3, '相手のライフは減らない');
      assertEqual(rm.guests[0].you.misses, 0, '相手のミス数も増えない');
      assert(rm.guests[0].you.remainingMs > after, '相手の残り時間も削られない');
    } finally { await srv.close(); }
  });

  await r.test('競争版：ライフが尽きた人は記録なし・最下位あつかい', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 2, false);
      rm.guests.forEach((g) => { g.code = rm.code; });
      await rm.host.call('wolf:start', startConfig({
        mode: 'race', counts: { easy: 3 }, lives: 1, endWhen: 'all'
      }));
      await waitUntil(() => rm.all.every((d) => d.you && d.you.phase === 'play'), '解除が始まる');

      // ホストは1本目で外して即失敗、相手は全部解く
      await missOne(srv, rm.host);
      await waitUntil(() => rm.host.you.failed === true, 'ライフ切れになる');
      const closed = await rm.host.call('wolf:act', { targetId: rm.host.you.board[0].uid });
      assertEqual(closed.ok, false, '失敗した人はもう挑めない');

      for (let i = 0; i < 3; i++) { await solveOne(srv, rm.guests[0]); await sleep(30); }
      await waitUntil(() => rm.all.every((d) => d.you.phase === 'ended'), '決着する');

      const ranking = rm.host.you.result.ranking;
      assertEqual(ranking[0].name, 'びび', '解けた人が1位');
      assertEqual(ranking[0].rank, 1, '1位が付く');
      assertEqual(ranking[1].name, 'あき', '失敗した人は最後');
      assertEqual(ranking[1].rank, null, '順位は付かない（記録なし）');
    } finally { await srv.close(); }
  });

  await r.test('競争版：「最初の1人で終了」なら、1人が解き終わった時点で締まる', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 2, false);
      rm.guests.forEach((g) => { g.code = rm.code; });
      await rm.host.call('wolf:start', startConfig({
        mode: 'race', counts: { easy: 2 }, endWhen: 'first'
      }));
      await waitUntil(() => rm.all.every((d) => d.you && d.you.phase === 'play'), '解除が始まる');

      // 相手は1本だけ解いた状態で止まっている
      await solveOne(srv, rm.guests[0]);
      await waitUntil(() => rm.guests[0].you.solvedCount === 1, '相手は1本');

      for (let i = 0; i < 2; i++) { await solveOne(srv, rm.host); await sleep(30); }
      await waitUntil(() => rm.all.every((d) => d.you.phase === 'ended'), '1人終わった時点で決着');
      const ranking = rm.host.you.result.ranking;
      assertEqual(ranking[0].name, 'あき', '解き終わった人が1位');
      assertEqual(ranking[1].solved, 1, 'まだの人はそこまでの本数で記録される');
    } finally { await srv.close(); }
  });

  await r.test('競争版：「全員が終わるまで」なら、1人終わっても続く', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 2, false);
      rm.guests.forEach((g) => { g.code = rm.code; });
      await rm.host.call('wolf:start', startConfig({
        mode: 'race', counts: { easy: 2 }, endWhen: 'all'
      }));
      await waitUntil(() => rm.all.every((d) => d.you && d.you.phase === 'play'), '解除が始まる');

      for (let i = 0; i < 2; i++) { await solveOne(srv, rm.host); await sleep(30); }
      await waitUntil(() => rm.host.you.finished === true, 'ホストは解き終わる');
      assertEqual(rm.host.you.phase, 'play', 'まだ続いている');
      assertEqual(rm.guests[0].you.phase, 'play', '解いている人はそのまま続けられる');

      for (let i = 0; i < 2; i++) { await solveOne(srv, rm.guests[0]); await sleep(30); }
      await waitUntil(() => rm.all.every((d) => d.you.phase === 'ended'), '全員終わって決着');
      assertEqual(rm.host.you.result.ranking.length, 2, '2人ぶんの順位');
    } finally { await srv.close(); }
  });

  // ---- 時間切れ・記録 ----

  await r.test('時間切れになったら、解けた分で締まる', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 2, false);
      rm.guests.forEach((g) => { g.code = rm.code; });
      await rm.host.call('wolf:start', startConfig({ counts: { easy: 5 }, timerSec: 1 }));
      await waitUntil(() => rm.all.every((d) => d.you && d.you.phase === 'play'), '解除が始まる');
      await waitUntil(() => rm.all.every((d) => d.you.phase === 'ended'), '時間切れで締まる', 5000);
      assertEqual(rm.host.you.result.success, false, '失敗');
      assertEqual(rm.host.you.result.cause, 'time', '理由は時間切れ');
    } finally { await srv.close(); }
  });

  await r.test('決着したら、部屋のオーナーの記録として残る', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 2, false);
      rm.guests.forEach((g) => { g.code = rm.code; });
      await rm.host.call('wolf:start', startConfig({ counts: { easy: 2 }, preset: 'bomb' }));
      await waitUntil(() => rm.all.every((d) => d.you && d.you.phase === 'play'), '解除が始まる');
      for (let i = 0; i < 2; i++) { await solveOne(srv, rm.host); await sleep(30); }
      await waitUntil(() => rm.host.you.phase === 'ended', '決着する');
      await waitUntil(() => srv.db.inserted.length > 0, '記録が書かれる');

      const row = srv.db.inserted[0];
      assertEqual(row[0], 4321, '部屋のオーナーの記録として残る');
      const rounds = JSON.parse(row[2]);
      assertEqual(rounds[0].detail.game, 'bomb', 'ゲームは爆弾解除');
      assertEqual(rounds[0].detail.style, 'realtime', '1人1台の記録だと分かる');
      assertEqual(rounds[0].detail.variant, 'coop', '通常版だと分かる');
      assertEqual(rounds[0].detail.success, true, '成功したことが残る');
      // 記録にも、お題の名前は入れない（記録画面は誰でも開けるため）
      assert(row[2].indexOf(TOPIC_MARK) === -1, '記録にお題の名前を残さない');
    } finally { await srv.close(); }
  });

  await r.test('AIが1本も作れなかったら、始まらずに理由が出る', async () => {
    const srv = await startTestServer({
      describe: async () => { throw new Error('AIが調子悪い'); }
    });
    try {
      const rm = await makeRoom(srv, 2, false);
      rm.guests.forEach((g) => { g.code = rm.code; });
      const res = await rm.host.call('wolf:start', startConfig({ counts: { easy: 2 } }));
      assertEqual(res.ok, true, '始める操作そのものは通る');
      await waitUntil(() => rm.host.you && rm.host.you.phase === 'ended', '始まらずに終わる', 6000);
      assertEqual(rm.host.you.result.aborted, true, '始められなかったことが分かる');
      assert(rm.host.you.result.message, '理由が出る');
      // 始まらなかった試合は記録に残さない
      assertEqual(srv.db.inserted.length, 0, '記録は書かれない');
    } finally { await srv.close(); }
  });

  await r.test('人数が足りなければ始められない', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 1, false);
      const res = await rm.host.call('wolf:start', startConfig());
      assertEqual(res.ok, false, '1人では始められない');
      assertEqual(res.error, 'too_few_players', '理由が返る');
    } finally { await srv.close(); }
  });

  await r.test('お題が届いていなければ始められない', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 2, false);
      const res = await rm.host.call('wolf:start', startConfig({ topics: [] }));
      assertEqual(res.ok, false, 'お題なしでは始められない');
      assertEqual(res.error, 'no_topics', '理由が返る');
    } finally { await srv.close(); }
  });

  await r.test('画面ロックで切れても、戻れば同じ盤面に復帰する', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 2, false);
      rm.guests.forEach((g) => { g.code = rm.code; });
      await rm.host.call('wolf:start', startConfig({ counts: { easy: 4 } }));
      await waitUntil(() => rm.all.every((d) => d.you && d.you.phase === 'play'), '解除が始まる');
      await solveOne(srv, rm.guests[0]);
      await waitUntil(() => rm.guests[0].you.solvedCount === 1, '1本解ける');
      const before = rm.guests[0].you.board.map((c) => c.uid).join(',');

      rm.guests[0].close();
      await sleep(120);
      const back = await device(srv.url);
      back.code = rm.code;
      const res = await back.call('room:join', {
        code: rm.code, name: 'びび', memberId: rm.guests[0].memberId
      });
      assertEqual(res.ok, true, '入り直せる');
      await waitUntil(() => back.you && back.you.phase === 'play', '盤面が届く');
      assertEqual(back.you.board.map((c) => c.uid).join(','), before, '同じ並びで戻る');
      assertEqual(back.you.solvedCount, 1, '解けた本数も引き継がれる');
      back.close();
    } finally { await srv.close(); }
  });

  await r.test('遊び終わって別のゲームを選ぶと、爆弾の進行は捨てられる', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 2, false);
      rm.guests.forEach((g) => { g.code = rm.code; });
      await rm.host.call('wolf:start', startConfig({ counts: { easy: 2 } }));
      await waitUntil(() => rm.host.you && rm.host.you.phase === 'play', '解除が始まる');
      const reset = await rm.host.call('room:setState', { phase: 'lobby', game: null, reset: true });
      assertEqual(reset.ok, true, '選び直せる');
      assertEqual(bombOf(srv, rm.code), undefined, 'サーバー側の進行が消える');
      await waitUntil(() => rm.guests[0].room.state.phase === 'lobby'
        && rm.guests[0].room.state.game === null, '全員が待合にもどる');
      assertEqual(Object.keys(viewOf(rm.guests[0])).length, 0, '前の盤面は端末にも残らない');
      assertEqual(rm.guests[0].room.playerCount, 2, '部屋と参加者はそのまま残る');
    } finally { await srv.close(); }
  });

  r.finish();
})();
