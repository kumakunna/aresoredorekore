// tests/room-edge.js — 部屋の「起きたら困ること」を実際に起こして確かめる（第32弾-A 第4部）
//
// 指示32-Aの第4部は「確認だけしてほしいこと」。
// 動かさずに「大丈夫そうです」と書くのが一番よくないので、
// 起きたら困ることを実際に起こして、目で見えるところまで確かめる。
//
//   1. ゲーム進行中にホストがアプリを閉じたら、残った人が遊び続けられるか
//   2. 同じ端末で2つのタブを開いたら、名簿に同じ人が2人並ばないか
//   3. 部屋コードが衝突した時／消えた部屋のコードを入れた時
//   4. 大人数（30人）で名簿・公開情報が壊れないか
//   5. 通信が切れたあと、クイズ王・オークションでも同じ盤面に戻れるか
//   6. クイズ王・オークションに人数の下限チェックがあるか

const http = require('http');
const express = require('express');
const session = require('express-session');
const { io: ioClient } = require('socket.io-client');

const { createRunner, assert, assertEqual } = require('./harness');
const { attachRealtime, RoomStore, randomCode, CODE_ALPHABET, CODE_LENGTH } = require('../realtime');

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
    secret: 'test-secret-for-room-edge',
    resave: false, saveUninitialized: false,
    cookie: { httpOnly: true, secure: false, sameSite: 'lax' }
  });
  app.use(express.json());
  app.use(sessionMiddleware);
  app.post('/test-login', (req, res) => {
    req.session.userId = (req.body && req.body.userId) || 321;
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
      socket: s, room: null, you: null, ended: null, hostChanged: null,
      memberId: null, code: null, name: null,
      call(event, payload) {
        return new Promise((res) => {
          const t = setTimeout(() => res({ ok: false, error: 'timeout' }), 6000);
          s.emit(event, payload || {}, (r) => { clearTimeout(t); res(r || {}); });
        });
      },
      close() { s.close(); }
    };
    s.on('room:update', (r) => { d.room = r; });
    s.on('wolf:you', (p) => { d.you = p; });
    s.on('wolf:ended', (p) => { d.ended = p; });
    s.on('room:hostChanged', (p) => { d.hostChanged = p; });
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

async function makeRoom(srv, playerCount) {
  const cookie = await login(srv.url, 4321);
  const host = await device(srv.url, cookie);
  const created = await host.call('room:create', { name: 'あき' });
  assertEqual(created.ok, true, '部屋を作れる');
  host.memberId = created.memberId; host.code = created.code; host.name = 'あき';

  const guests = [];
  for (let i = 1; i < playerCount; i++) {
    const nm = 'P' + (i + 1);
    const g = await device(srv.url);
    const res = await g.call('room:join', { code: created.code, name: nm });
    assertEqual(res.ok, true, nm + ' が入れる');
    g.memberId = res.memberId; g.name = nm; g.code = created.code;
    guests.push(g);
  }
  return { host, guests, code: created.code, all: [host].concat(guests) };
}

function roomOf(srv, code) { return srv.store.get(code); }

async function run() {
  const r = createRunner('room-edge：部屋の「起きたら困ること」');

  // ---- 1. ゲーム進行中にホストが閉じる ----

  await r.test('遊んでいる最中にホストが閉じても、残った人が遊び続けられる', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 3);
      await rm.host.call('wolf:start', { game: 'quizrush', timerSec: 120 });
      await waitUntil(() => rm.guests[0].you && rm.guests[0].you.rush, '始まる');

      // ホストがアプリを閉じた（ブラウザ終了）
      rm.host.close();
      await waitUntil(() => roomOf(srv, rm.code).hostMemberId !== rm.host.memberId,
        'ホストが移る', 6000);
      assert(rm.guests[0].hostChanged, '残った人に「進行役が変わった」が届く');
      assertEqual(rm.guests[0].hostChanged.previousHostMemberId, rm.host.memberId,
        '誰から移ったかが分かる');
      const next = roomOf(srv, rm.code).hostMemberId;
      assert([rm.guests[0].memberId, rm.guests[1].memberId].indexOf(next) !== -1,
        'つながっている人が新しい進行役になる');

      // そのまま遊び続けられる
      const act = await rm.guests[0].call('wolf:act', { targetId: 'easy' });
      assertEqual(act.ok, true, '残った人は操作を続けられる');
      await waitUntil(() => rm.guests[0].you.rush.question, '問題が届く');
      const seat = roomOf(srv, rm.code).quiz.rush.seats[rm.guests[0].memberId];
      const res = await rm.guests[0].call('wolf:vote', { targetId: seat.q.correct });
      assertEqual(res.ok, true, '答えも通る');
      await waitUntil(() => rm.guests[0].you.rush.score > 0, '点が入る');
    } finally { await srv.close(); }
  });

  // ---- 2. 同じ端末で2つのタブ ----

  await r.test('同じ端末で2つ目のタブを開いても、名簿に同じ人が2人並ばない', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 2);
      const before = roomOf(srv, rm.code).members.size;

      // 2つ目のタブ。端末は memberId を覚えているので、それを添えて入り直す
      const tab2 = await device(srv.url);
      const res = await tab2.call('room:join', {
        code: rm.code, name: rm.guests[0].name, memberId: rm.guests[0].memberId
      });
      assertEqual(res.ok, true, '2つ目のタブも入れる');
      assertEqual(res.memberId, rm.guests[0].memberId, '同じ人として扱われる');
      assertEqual(roomOf(srv, rm.code).members.size, before, '名簿は増えない');
      tab2.close();
    } finally { await srv.close(); }
  });

  await r.test('memberId を持たない2つ目のタブは、別の人として増える（名前が同じでも）', async () => {
    // これは仕様として正しい。同じ名前の別人が入ってくることは実際にあるので、
    // 名前だけで「同じ人」と決めつけると、その人が乗っ取られる。
    // つながったままの同名は増やし、切れている同名は引き継ぐ（realtime.js の room:join）
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 2);
      const before = roomOf(srv, rm.code).members.size;

      const other = await device(srv.url);
      const res = await other.call('room:join', { code: rm.code, name: rm.guests[0].name });
      assertEqual(res.ok, true, '入れる');
      assert(res.memberId !== rm.guests[0].memberId, '別の人として扱われる');
      assertEqual(roomOf(srv, rm.code).members.size, before + 1, '名簿が1人増える');

      // 先に入っていた人が切れていれば、同じ名前の入り直しは引き継ぐ
      rm.guests[0].close();
      await waitUntil(() => {
        const m = roomOf(srv, rm.code).members.get(rm.guests[0].memberId);
        return m && !m.connected;
      }, '切断が伝わる', 6000);
      const back = await device(srv.url);
      const res2 = await back.call('room:join', { code: rm.code, name: rm.guests[0].name });
      assertEqual(res2.memberId, rm.guests[0].memberId, '切れていた枠を引き継ぐ');
      assertEqual(roomOf(srv, rm.code).members.size, before + 1, 'それ以上は増えない');
      other.close(); back.close();
    } finally { await srv.close(); }
  });

  // ---- 第32弾-B-1：メンバー管理（進行役が、その人を部屋から出す） ----

  await r.test('進行役は、その人を部屋から出せる（出された人には理由が届く）', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 3);
      const target = rm.guests[0];
      let kicked = null;
      target.socket.on('room:kicked', (p) => { kicked = p; });

      const res = await rm.host.call('room:kick', { memberId: target.memberId });
      assertEqual(res.ok, true, '出せる');
      await waitUntil(() => kicked, '出された人に理由が届く');
      assertEqual(kicked.by, 'あき', '誰に出されたかが分かる');
      assertEqual(roomOf(srv, rm.code).members.has(target.memberId), false, '名簿から消える');
      await waitUntil(() => rm.guests[1].room.playerCount === 2, '残った人の名簿も更新される');
    } finally { await srv.close(); }
  });

  await r.test('進行役でない人は、誰も出せない。進行役も自分は出せない', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 3);
      const denied = await rm.guests[0].call('room:kick', { memberId: rm.guests[1].memberId });
      assertEqual(denied.ok, false, '進行役以外は出せない');
      assertEqual(denied.error, 'not_host', '理由がはっきり返る');

      const self = await rm.host.call('room:kick', { memberId: rm.host.memberId });
      assertEqual(self.ok, false, '自分は出せない');
      assertEqual(self.error, 'cannot_kick_self', '理由がはっきり返る');
      assertEqual(roomOf(srv, rm.code).members.size, 3, '誰も減っていない');
    } finally { await srv.close(); }
  });

  // ---- 3. 部屋コード ----

  await r.test('部屋コードは、いま使われているものと重ならない', async () => {
    const srv = await startTestServer();
    try {
      const cookie = await login(srv.url, 55);
      const codes = {};
      for (let i = 0; i < 30; i++) {
        const d = await device(srv.url, cookie);
        const res = await d.call('room:create', { name: 'あき' });
        assertEqual(res.ok, true, '部屋を作れる');
        assertEqual(!!codes[res.code], false, '同じコードが2回出ない：' + res.code);
        assertEqual(res.code.length, CODE_LENGTH, '6文字');
        res.code.split('').forEach((ch) => {
          assert(CODE_ALPHABET.indexOf(ch) !== -1, '紛らわしい文字を使わない：' + ch);
        });
        codes[res.code] = true;
        d.close();
      }
    } finally { await srv.close(); }
  });

  await r.test('もう無い部屋のコードを入れたら、はっきり理由が返る', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 2);
      srv.store.delete(rm.code); // 片付けられた／サーバーが再起動した状態
      const d = await device(srv.url);
      const res = await d.call('room:join', { code: rm.code, name: 'えみ' });
      assertEqual(res.ok, false, '入れない');
      assertEqual(res.error, 'room_not_found', '理由がはっきり返る');
      // 覗く方も同じ返事になる（入る前に分かる）
      const peek = await d.call('room:peek', { code: rm.code });
      assertEqual(peek.ok, false, '覗いても見つからない');
      d.close();
    } finally { await srv.close(); }
  });

  // ---- 4. 大人数 ----

  await r.test('30人が入っても、名簿も公開情報も壊れない', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 30);
      assertEqual(roomOf(srv, rm.code).members.size, 30, '30人ぶんの名簿');
      // 配信は非同期なので、最後の1人が届くまで待つ
      await waitUntil(() => rm.host.room && rm.host.room.playerCount === 30,
        '30人ぶんの名簿が全員に配られる', 6000);
      assertEqual((rm.host.room.members || []).length, 30, '名簿が全員ぶん配られる');

      await rm.host.call('wolf:start', { game: 'quizrush', timerSec: 120 });
      await waitUntil(() => rm.host.you && rm.host.you.rush, '30人でも始まる');
      const view = rm.host.room.state.data;
      assertEqual((view.players || []).length, 30, '公開情報も30人ぶん');
      view.players.forEach((p) => {
        assert(p.name && typeof p.score === 'number', '一人ずつ中身が揃っている');
      });
      rm.all.forEach((d) => d.close());
    } finally { await srv.close(); }
  });

  // ---- 5. 通信が切れたあとの復帰 ----

  const REJOIN_CASES = [
    {
      game: 'quizrush', label: 'クイズラッシュ',
      start: { game: 'quizrush', timerSec: 120 },
      ready: (d) => d.you && d.you.rush,
      warm: async (d, srv, code) => {
        await d.call('wolf:act', { targetId: 'easy' });
        await waitUntil(() => d.you.rush.question, '問題が届く');
        const seat = srv.store.get(code).quiz.rush.seats[d.memberId];
        await d.call('wolf:vote', { targetId: seat.q.correct });
        await waitUntil(() => d.you.rush.score > 0, '点が入る');
      },
      check: (before, after) => {
        assertEqual(after.rush.score, before.rush.score, '点が元に戻っている');
        assertEqual(after.rush.tier, before.rush.tier, '選んだ難易度も残っている');
      }
    },
    {
      game: 'auction', label: 'オークション',
      start: { game: 'auction', mode: 'sealed', rounds: 3, bidSec: 120 },
      ready: (d) => d.you && d.you.teaser,
      warm: async (d) => {
        await d.call('wolf:act', { targetId: 'buy:appraise' });
        await waitUntil(() => d.you.inventory.some((x) => x.id === 'appraise'), 'アイテムが増える');
      },
      check: (before, after) => {
        assertEqual(after.chips, before.chips, 'チップが元に戻っている');
        assertEqual(after.teaser, before.teaser, '同じ品物のまま');
        assertEqual(JSON.stringify(after.inventory), JSON.stringify(before.inventory),
          '買ったアイテムも残っている');
      }
    }
  ];

  for (const c of REJOIN_CASES) {
    await r.test(c.label + '：通信が切れて戻っても、同じところに復帰する', async () => {
      const srv = await startTestServer();
      try {
        const rm = await makeRoom(srv, 2);
        await rm.host.call('wolf:start', c.start);
        await waitUntil(() => c.ready(rm.guests[0]), '始まる');
        await c.warm(rm.guests[0], srv, rm.code);
        const before = JSON.parse(JSON.stringify(rm.guests[0].you));

        // 画面ロック・電波切れで socket が落ちる
        rm.guests[0].close();
        await waitUntil(() => {
          const m = roomOf(srv, rm.code).members.get(rm.guests[0].memberId);
          return m && !m.connected;
        }, '切断が伝わる', 6000);

        // 戻ってくる（端末は memberId を覚えている）
        const back = await device(srv.url);
        const res = await back.call('room:join', {
          code: rm.code, name: rm.guests[0].name, memberId: rm.guests[0].memberId
        });
        assertEqual(res.ok, true, '入り直せる');
        assertEqual(res.memberId, rm.guests[0].memberId, '同じ人として戻る');
        await waitUntil(() => back.you, '自分の状態が届く');
        c.check(before, back.you);
        back.close();
      } finally { await srv.close(); }
    });
  }

  // ---- 6. 人数の下限・上限 ----

  const MIN_CASES = [
    { label: 'クイズラッシュ', start: { game: 'quizrush', timerSec: 60 } },
    { label: 'つぎつぎクイズ', start: { game: 'quizlist' } },
    { label: 'とくとくクイズ', start: { game: 'quizreveal' } },
    { label: '早押しトーナメント', start: { game: 'buzzer' } },
    { label: 'オークション（せり上げ式）', start: { game: 'auction', mode: 'open' } },
    { label: 'オークション（秘密入札）', start: { game: 'auction', mode: 'sealed' } }
  ];

  await r.test('クイズ王・オークションは、1人では始められない', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 1);
      for (const c of MIN_CASES) {
        const res = await rm.host.call('wolf:start', c.start);
        assertEqual(res.ok, false, c.label + '：1人では始まらない');
        assertEqual(res.error, 'too_few_players', c.label + '：理由がはっきり返る');
        assert(/人以上/.test(res.message || ''), c.label + '：何人要るかが読める');
      }
    } finally { await srv.close(); }
  });

  await r.test('クイズ王・オークションは、大人数でも始められる（上限は設けていない）', async () => {
    // 人狼と違って、手渡しの回数が人数に比例して増えないので上限を置いていない。
    // 「上限が無い」ことを、実際に多い人数で確かめておく
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 20);
      const res = await rm.host.call('wolf:start', { game: 'quizrush', timerSec: 60 });
      assertEqual(res.ok, true, '20人でも始まる');
      await waitUntil(() => rm.host.you && rm.host.you.rush, '始まる');
      assertEqual(roomOf(srv, rm.code).quiz.playerIds.length, 20, '20人ぶんの席がある');
      rm.all.forEach((d) => d.close());
    } finally { await srv.close(); }
  });

  r.finish();
}

if (require.main === module) run();
// startTestServer などは tests/room-paths.js（第35弾のループ形式テスト）も使う。
// 同じ土台を2回書くと片方だけ直る事故になる（落とし穴1）ので、ここから輸出する
module.exports = { run, startTestServer, login, device, waitUntil, makeRoom, sleep };
