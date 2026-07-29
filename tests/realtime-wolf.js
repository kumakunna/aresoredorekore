// tests/realtime-wolf.js — 1人1台の人狼（第21弾 第9部）
//
// 実機・複数端末を使わず、socket.io-client の接続を複数立てて確かめる。
// 見るのは4つ:
//   ・部屋を作って複数人が参加し、役職配布→夜→投票→決着まで通せること
//   ・大画面ホストに秘密情報が一切届かないこと
//   ・途中でホストの接続を切っても、ゲームが続くこと
//   ・夜の制限時間が1人1台モードでも効くこと

const http = require('http');
const express = require('express');
const session = require('express-session');
const { io: ioClient } = require('socket.io-client');

const { createRunner, assert, assertEqual } = require('./harness');
const { attachRealtime, RoomStore } = require('../realtime');
const WolfRoom = require('../wolf-room');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    secret: 'test-secret-for-realtime-wolf',
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
    Object.assign({ store, db }, realtimeOpts || {}));
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
      youLog: [], roomLog: [],
      memberId: null, code: null,
      call(event, payload) {
        return new Promise((res) => {
          const t = setTimeout(() => res({ ok: false, error: 'timeout' }), 6000);
          s.emit(event, payload || {}, (r) => { clearTimeout(t); res(r || {}); });
        });
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
  const created = await host.call('room:create', { name: 'ホスト' });
  assertEqual(created.ok, true, '部屋を作れる');
  host.memberId = created.memberId; host.code = created.code;

  const guests = [];
  for (let i = 1; i < playerCount; i++) {
    const g = await device(srv.url);
    const r = await g.call('room:join', { code: created.code, name: 'P' + (i + 1) });
    assertEqual(r.ok, true, 'P' + (i + 1) + ' が入れる');
    g.memberId = r.memberId;
    guests.push(g);
  }
  let big = null;
  if (withBigScreen) {
    big = await device(srv.url);
    const r = await big.call('room:join', { code: created.code, name: 'テレビ', role: 'bigscreen' });
    assertEqual(r.ok, true, '大画面が入れる');
    big.memberId = r.memberId;
  }
  return { host, guests, big, code: created.code, all: [host].concat(guests) };
}

// いまの段階で、その端末がやるべき操作を1つ送る
async function actOnce(d) {
  const you = d.you;
  if (!you || you.done) return false;
  if (you.phase === 'vote') {
    const t = (you.choices || [])[0];
    if (!t) return false;
    await d.call('wolf:vote', { targetId: t.id });
    return true;
  }
  // 役職確認・夜・投票前：選ぶものがあれば選び、無ければ確認だけ送る
  const t = (you.choices || [])[0];
  await d.call('wolf:act', { targetId: t ? t.id : null });
  return true;
}

// 決着するまで回す
async function playToEnd(rm, guard) {
  const limit = guard || 200;
  for (let i = 0; i < limit; i++) {
    const phase = rm.host.room && rm.host.room.state && rm.host.room.state.data
      ? rm.host.room.state.data.phase : null;
    if (phase === 'ended') return true;
    // 第24弾-2：作戦会議もホストが進める段階
    if (phase === 'meeting' || phase === 'day' || phase === 'turnResult') {
      await rm.host.call('wolf:next', {});
    } else {
      for (const d of rm.all) await actOnce(d);
    }
    await sleep(40);
  }
  return false;
}

(async function main() {
  const r = createRunner('realtime-wolf：1人1台の人狼');

  await r.test('部屋を作り、複数人で役職配布から決着まで通せる', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 5, false);
      const res = await rm.host.call('wolf:start', {
        roles: ['wolf', 'seer', 'medium', 'knight'], turnLimit: 5, preset: 'wolf-normal'
      });
      assertEqual(res.ok, true, 'ホストが始められる');

      // 全員に自分の役職が届く
      await waitUntil(() => rm.all.every((d) => d.you && d.you.roleId), '全員に役職が届く');
      const roles = rm.all.map((d) => d.you.roleId);
      assertEqual(roles.length, 5, '5人ぶん');
      assertEqual(roles.filter((x) => x === 'wolf').length, 1, '人狼は1人');
      assert(roles.indexOf('seer') >= 0, '占い師がいる');

      // 人狼には仲間の一覧が届く（1人なら空）
      const wolf = rm.all.find((d) => d.you.roleId === 'wolf');
      assert(Array.isArray(wolf.you.mates), '人狼には仲間の欄がある');

      const done = await playToEnd(rm);
      assert(done, '決着まで通る');
      const view = rm.host.room.state.data;
      assertEqual(view.phase, 'ended', '決着している');
      assert(view.result && view.result.winner, '勝った陣営が出る（' + (view.result || {}).winner + '）');
      assertEqual(view.result.roles.length, 5, '決着後は全員の役職が明かされる');

      // 対戦履歴が、部屋のオーナーの記録として残っている
      await waitUntil(() => srv.db.inserted.length > 0, '履歴が保存される');
      const row = srv.db.inserted[0];
      assertEqual(row[0], 4321, '部屋のオーナーのアカウントに紐づく');
      const detail = JSON.parse(row[2])[0].detail;
      assertEqual(detail.game, 'wolfrole', 'どのゲームか残る');
      assertEqual(detail.style, 'realtime', '1人1台だったことも残る');
      assert(detail.roles, '役職構成が残る');

      rm.all.forEach((d) => d.close());
    } finally { await srv.close(); }
  });

  await r.test('大画面ホストには、秘密情報がひとつも届かない', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 5, true);
      await rm.host.call('wolf:start', { roles: ['wolf', 'seer'], turnLimit: 5 });
      await waitUntil(() => rm.all.every((d) => d.you && d.you.roleId), 'players に役職が届く');
      await sleep(200);

      assertEqual(rm.big.you, null, '大画面に wolf:you が届かない');
      assertEqual(rm.big.youLog.length, 0, '一度も届いていない');

      // 大画面が受け取る公開情報に、秘密が混ざっていないこと
      assert(rm.big.room, '大画面にも公開情報は届く');
      const json = JSON.stringify(rm.big.room);
      assert(!/roleId/.test(json), '個人の役職IDが含まれない');
      assert(!/nightActions|votes"/.test(json), '夜の行動や投票先が含まれない');
      const view = rm.big.room.state.data;
      assert(view.players.every((p) => p.role === null), '生きている人の役職は伏せられている');
      assertEqual(rm.big.room.playerCount, 5, '大画面は人数に数えない');

      // 大画面から見ても、いまのフェーズとターンは分かる
      assert(view.phase, 'フェーズは見られる');
      assertEqual(view.turn, 1, 'ターン数も見られる');
      assert(Array.isArray(view.waiting), 'まだ操作していない人の名前は見られる');

      rm.all.forEach((d) => d.close());
      rm.big.close();
    } finally { await srv.close(); }
  });

  await r.test('大画面が無い部屋でも、同じ公開情報を各自の端末で見られる', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 4, false);
      await rm.host.call('wolf:start', { roles: ['wolf', 'seer'], turnLimit: 5 });
      await waitUntil(() => rm.all.every((d) => d.room && d.room.state.data.phase), '全員に公開情報が届く');
      rm.all.forEach((d) => {
        const v = d.room.state.data;
        assert(v.phase && v.turn && Array.isArray(v.players), '各自の端末でも同じ公開情報が見られる');
      });
      rm.all.forEach((d) => d.close());
    } finally { await srv.close(); }
  });

  await r.test('進行中にホストの接続が切れても、ゲームが続く', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 5, false);
      await rm.host.call('wolf:start', { roles: ['wolf', 'seer'], turnLimit: 5 });
      await waitUntil(() => rm.all.every((d) => d.you && d.you.roleId), '役職が配られる');

      const room = srv.store.get(rm.code);
      assertEqual(room.hostMemberId, rm.host.memberId, '最初は作った人がホスト');

      // 役職確認を全員が終える（ホストも含む）
      for (const d of rm.all) await actOnce(d);
      // 第24弾-2：役職確認のあとは作戦会議。ホストが進めると夜になる
      await waitUntil(() => rm.host.room.state.data.phase === 'meeting', '作戦会議になる');
      await rm.host.call('wolf:next', {});
      await waitUntil(() => rm.guests[0].room.state.data.phase === 'night', '夜になる');

      // ここでホストの電池が切れる
      rm.host.close();
      await waitUntil(() => srv.store.get(rm.code).hostMemberId !== rm.host.memberId,
        'ホストが別の端末へ移る');
      const newHost = srv.store.get(rm.code).hostMemberId;
      assert(rm.guests.some((g) => g.memberId === newHost), '残っている端末が引き継ぐ');

      // 残りの人だけでゲームを続けられる
      const rest = { host: rm.guests.find((g) => g.memberId === newHost), all: rm.guests };
      const done = await playToEnd(rest, 200);
      assert(done, 'ホストが落ちても決着まで通る（現在: ' +
        rest.host.room.state.data.phase + '）');
      rm.guests.forEach((d) => d.close());
    } finally { await srv.close(); }
  });

  await r.test('夜の制限時間が切れたら、全員そろわなくても夜が明ける', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 5, false);
      await rm.host.call('wolf:start', {
        roles: ['wolf', 'seer'], turnLimit: 5, nightTimeLimit: 1 // 1秒
      });
      await waitUntil(() => rm.all.every((d) => d.you && d.you.roleId), '役職が配られる');
      for (const d of rm.all) await actOnce(d); // 役職確認は全員が済ませる
      await waitUntil(() => rm.host.room.state.data.phase === 'meeting', '作戦会議になる');
      await rm.host.call('wolf:next', {});      // 第24弾-2：作戦会議を抜けて夜へ
      await waitUntil(() => rm.host.room.state.data.phase === 'night', '夜になる');
      assert(rm.host.room.state.data.deadline, '期限が全員に伝わる');

      // 誰も行動しないまま放置する
      await waitUntil(() => rm.host.room.state.data.phase !== 'night',
        '時間切れで夜が明ける', 6000);
      const phase = rm.host.room.state.data.phase;
      assert(['day', 'ended'].indexOf(phase) >= 0, '朝か決着に進む（' + phase + '）');
      rm.all.forEach((d) => d.close());
    } finally { await srv.close(); }
  });

  await r.test('画面ロックで切れても、戻れば同じ役職・同じ局面に復帰する', async () => {
    // スマホの画面を消すとJSが止まり、ハートビートに応えられず切断扱いになる。
    // プレイ中に頻繁に起きるので、戻った時に別人として増えたら困る。
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 5, false);
      await rm.host.call('wolf:start', { roles: ['wolf', 'seer', 'knight'], turnLimit: 5 });
      await waitUntil(() => rm.all.every((d) => d.you && d.you.roleId), '役職が配られる');

      const target = rm.guests[0];
      const myId = target.memberId;
      const myRole = target.you.roleId;
      const beforeCount = rm.host.room.playerCount;

      // 役職確認をこの人以外が済ませる（この人は画面を消したまま）
      for (const d of rm.all) { if (d !== target) await actOnce(d); }

      // 画面が消えて切断される
      target.close();
      await waitUntil(() => {
        const m = srv.store.get(rm.code).members.get(myId);
        return m && !m.connected;
      }, '切断として扱われる');

      // 待たないので、残りの人だけで先へ進む
      await waitUntil(() => rm.host.room.state.data.phase !== 'roleReveal',
        '切れた人を待たずに進む', 5000);
      const phaseNow = rm.host.room.state.data.phase;

      // 画面ロックを解除して戻ってくる（socket.io がつなぎ直し、memberId を添えて入り直す）
      const back = await device(srv.url);
      const res = await back.call('room:join', {
        code: rm.code, name: 'P2', memberId: myId
      });
      assertEqual(res.ok, true, '戻ってこられる');
      assertEqual(res.memberId, myId, '同じメンバーとして戻る（別人として増えない）');
      assertEqual(res.room.playerCount, beforeCount, '人数が増えていない');

      // 戻った瞬間に、自分の役職と今の局面が届く
      await waitUntil(() => back.you && back.you.roleId, '自分の情報がすぐ届く');
      assertEqual(back.you.roleId, myRole, '役職は前と同じ（配り直されない）');
      assertEqual(back.you.phase, phaseNow, 'いまの局面が分かる');

      // 続きから遊べる
      const stillPlaying = { host: rm.host, all: [rm.host].concat(rm.guests.slice(1), [back]) };
      const done = await playToEnd(stillPlaying, 200);
      assert(done, '復帰したあとも決着まで遊べる（現在: ' + rm.host.room.state.data.phase + '）');

      rm.host.close(); rm.guests.slice(1).forEach((d) => d.close()); back.close();
    } finally { await srv.close(); }
  });

  await r.test('進行の判定はサーバーだけが持つ（端末は結果を受け取るだけ）', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 5, false);
      await rm.host.call('wolf:start', { roles: ['wolf', 'seer'], turnLimit: 5 });
      await waitUntil(() => rm.all.every((d) => d.you), '役職が配られる');

      // ホスト以外は進められない
      const notHost = rm.guests[0];
      const denied = await notHost.call('wolf:next', {});
      assertEqual(denied.ok, false, 'ホスト以外は進められない');
      assertEqual(denied.error, 'not_host', '理由が分かる');

      // 段階が合わない操作は受け付けない
      const wrong = await notHost.call('wolf:vote', { targetId: rm.host.memberId });
      assertEqual(wrong.ok, false, '役職確認の段階では投票できない');

      rm.all.forEach((d) => d.close());
    } finally { await srv.close(); }
  });

  // ---- 第24弾-3-2：入り直しで同じ人が2人に増えない ----
  await r.test('一度出て入り直しても、同じ人が2人に増えない', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 3, false);
      const room = srv.store.get(rm.code);
      assertEqual(room.members.size, 3, '最初は3人');

      // ① 自分から出て、コードを入れ直す（memberId は手放している）
      const g = rm.guests[0];
      await g.call('room:leave', {});
      await waitUntil(() => srv.store.get(rm.code).members.size === 2, '出ると人数が減る');
      const back = await g.call('room:join', { code: rm.code, name: 'P2' });
      assertEqual(back.ok, true, '入り直せる');
      assertEqual(srv.store.get(rm.code).members.size, 3, '入り直しても3人のまま');

      // ② ページを読み込み直した想定：同じ名前で、memberId を持たずに入り直す
      const g2 = rm.guests[1];
      const oldId = g2.memberId;
      g2.close();
      await waitUntil(() => {
        const m = srv.store.get(rm.code).members.get(oldId);
        return m && !m.connected;
      }, '切断が伝わる', 6000);
      const reloaded = await device(srv.url);
      const rejoin = await reloaded.call('room:join', { code: rm.code, name: 'P3' });
      assertEqual(rejoin.ok, true, '入り直せる');
      assertEqual(rejoin.memberId, oldId, '切れていた同じ名前の枠を引き継ぐ');
      assertEqual(srv.store.get(rm.code).members.size, 3, '名前が2つに増えない');

      // ③ つながったままの同名は別人なので、こちらは増やす
      const other = await device(srv.url);
      const dup = await other.call('room:join', { code: rm.code, name: 'P3' });
      assertEqual(dup.ok, true, '同じ名前でも入れる');
      assert(dup.memberId !== oldId, 'つながっている人の枠は奪わない');
      assertEqual(srv.store.get(rm.code).members.size, 4, '別人として増える');

      [rm.host, g, reloaded, other].forEach((d) => d.close());
    } finally { await srv.close(); }
  });

  // ---- 第24弾-3-5：ホストの終了を部屋全体に反映する ----
  await r.test('ホストがゲームを終了すると、全員が部屋から出る', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 4, true);
      await rm.host.call('wolf:start', { roles: ['wolf', 'seer'], turnLimit: 5 });
      await waitUntil(() => rm.all.every((d) => d.you && d.you.roleId), '役職が配られる');

      // ホスト以外は終了できない
      const denied = await rm.guests[0].call('room:close', {});
      assertEqual(denied.ok, false, 'ホスト以外は終了できない');
      assertEqual(denied.error, 'not_host', '理由が分かる');

      // 全端末（大画面も含む）が room:closed を受け取る
      const got = [];
      [rm.host].concat(rm.guests).concat([rm.big]).forEach((d) => {
        d.socket.on('room:closed', (p) => got.push({ id: d.memberId, by: p && p.by }));
      });
      const res = await rm.host.call('room:close', {});
      assertEqual(res.ok, true, 'ホストは終了できる');
      await waitUntil(() => got.length === 5, '全員に届く（大画面も含む）', 4000);
      assert(got.every((x) => x.by === 'ホスト'), '誰が終了したのかが分かる');
      assertEqual(srv.store.get(rm.code), null, '部屋そのものが片付く');

      rm.all.concat([rm.big]).forEach((d) => d.close());
    } finally { await srv.close(); }
  });

  r.finish();
})();
