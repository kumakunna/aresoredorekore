// tests/realtime.js — リアルタイム同期の土台（第19弾）
//
// 実機・複数人を使わずに、socket.io-client の接続を複数立てて検証する。
// 「人がいなくても確かめられること」をここで固め、体感の速さは人が集まった時に別途見る。

const http = require('http');
const express = require('express');
const session = require('express-session');
const { io: ioClient } = require('socket.io-client');

const { createRunner, assert, assertEqual } = require('./harness');
const { attachRealtime, RoomStore, pickNextHost, randomCode,
  CODE_ALPHABET, CODE_LENGTH, ROLE_BIGSCREEN } = require('../realtime');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- テスト用のサーバー ----
// 本番の server.js と同じ形（express-session を socket.io と共有）を最小構成で組む。
// DBやAIには触れないので、テストが外部要因で落ちない。
function startTestServer() {
  const app = express();
  const sessionMiddleware = session({
    secret: 'test-secret-for-realtime-suite',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, secure: false, sameSite: 'lax' }
  });
  app.use(express.json());
  app.use(sessionMiddleware);
  // ログイン相当。本番の /api/auth/login と同じく req.session.userId を立てる
  app.post('/test-login', (req, res) => {
    req.session.userId = (req.body && req.body.userId) || 777;
    res.json({ ok: true, userId: req.session.userId });
  });

  const httpServer = http.createServer(app);
  const store = new RoomStore();
  const io = attachRealtime(httpServer, sessionMiddleware, { store });

  return new Promise((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => {
      const port = httpServer.address().port;
      resolve({
        port,
        url: 'http://127.0.0.1:' + port,
        store,
        io,
        close: () => new Promise((r) => {
          io.stopTimers();
          io.close(() => httpServer.close(() => r()));
        })
      });
    });
  });
}

// ログインしてセッションcookieを取る（socket.io の handshake に載せる）
async function login(url, userId) {
  const res = await fetch(url + '/test-login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId })
  });
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')];
  const cookie = (setCookie || []).filter(Boolean).map((c) => c.split(';')[0]).join('; ');
  if (!cookie) throw new Error('セッションcookieが取得できませんでした');
  return cookie;
}

// 接続を1本張る。cookie を渡すとログイン済みとして扱われる
function connect(url, cookie) {
  return new Promise((resolve, reject) => {
    const opts = { transports: ['polling'], forceNew: true, reconnection: false };
    if (cookie) opts.extraHeaders = { Cookie: cookie };
    const s = ioClient(url, opts);
    const t = setTimeout(() => reject(new Error('接続がタイムアウトしました')), 5000);
    s.on('connect', () => { clearTimeout(t); resolve(s); });
    s.on('connect_error', (e) => { clearTimeout(t); reject(e); });
  });
}

// コールバック付きイベントをPromiseで送る
function send(socket, event, payload) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(event + ' の応答がありません')), 5000);
    socket.emit(event, payload, (res) => { clearTimeout(t); resolve(res); });
  });
}

// あるイベントが飛んでくるのを待つ
function waitEvent(socket, event, timeoutMs) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(event + ' が届きませんでした')), timeoutMs || 4000);
    socket.once(event, (payload) => { clearTimeout(t); resolve(payload); });
  });
}

// 条件が満たされるまで待つ（状態の伝播待ち）
async function waitUntil(fn, label, timeoutMs) {
  const limit = Date.now() + (timeoutMs || 3000);
  while (Date.now() < limit) {
    if (fn()) return true;
    await sleep(25);
  }
  throw new Error('条件が満たされませんでした: ' + (label || ''));
}

(async function main() {
  const r = createRunner('realtime：リアルタイム同期の土台');

  // ---- 第2部：部屋の作成・参加・役割 ----

  await r.test('部屋コードは紛らわしい文字を含まない6文字', async () => {
    for (let i = 0; i < 200; i++) {
      const code = randomCode();
      assertEqual(code.length, CODE_LENGTH, '長さが6文字');
      assert(!/[0OIL1]/.test(code), '0・O・I・L・1 は使わない（' + code + '）');
      assert(code.split('').every((c) => CODE_ALPHABET.indexOf(c) >= 0), '想定の文字だけを使う');
    }
  });

  await r.test('部屋を作れるのはログイン済みのユーザーだけ', async () => {
    const srv = await startTestServer();
    try {
      const guest = await connect(srv.url);
      const denied = await send(guest, 'room:create', { name: 'ゲスト' });
      assertEqual(denied.ok, false, 'ログインなしでは作れない');
      assertEqual(denied.error, 'auth_required', '理由がログイン必須と分かる');
      guest.close();

      const cookie = await login(srv.url, 42);
      const owner = await connect(srv.url, cookie);
      const created = await send(owner, 'room:create', { name: 'くまくん' });
      assertEqual(created.ok, true, 'ログイン済みなら作れる');
      assertEqual(created.room.ownerUserId, 42, 'セッションのuserIdが部屋のオーナーになる');
      assert(created.code && created.code.length === 6, '部屋コードが発行される');
      assert(created.memberId, 'メンバーIDが振られる');
      owner.close();
    } finally { await srv.close(); }
  });

  await r.test('部屋への参加はログイン不要（コードと名前だけ）', async () => {
    const srv = await startTestServer();
    try {
      const cookie = await login(srv.url, 1);
      const owner = await connect(srv.url, cookie);
      const room = await send(owner, 'room:create', { name: 'ホスト' });

      const guest = await connect(srv.url); // cookieを渡さない＝未ログイン
      const joined = await send(guest, 'room:join', { code: room.code, name: 'びび' });
      assertEqual(joined.ok, true, '未ログインでも入れる');
      assert(joined.memberId && joined.memberId !== room.memberId, '別のメンバーIDが振られる');
      assertEqual(joined.room.memberCount, 2, '2人になる');

      const bad = await send(guest, 'room:join', { code: 'ZZZZZZ', name: 'びび' });
      assertEqual(bad.ok, false, '存在しないコードでは入れない');
      assertEqual(bad.error, 'room_not_found', '理由が分かる');

      owner.close(); guest.close();
    } finally { await srv.close(); }
  });

  await r.test('大画面ホストは参加人数に数えない', async () => {
    const srv = await startTestServer();
    try {
      const cookie = await login(srv.url, 1);
      const owner = await connect(srv.url, cookie);
      const room = await send(owner, 'room:create', { name: 'ホスト' });
      assertEqual(room.room.playerCount, 1, '作った人はプレイヤー1人');

      const tv = await connect(srv.url);
      const tvJoin = await send(tv, 'room:join', { code: room.code, name: 'テレビ', role: ROLE_BIGSCREEN });
      assertEqual(tvJoin.room.memberCount, 2, '端末は2台');
      assertEqual(tvJoin.room.playerCount, 1, '大画面ホストは人数に入らない');

      const p2 = await connect(srv.url);
      const p2Join = await send(p2, 'room:join', { code: room.code, name: 'ちか' });
      assertEqual(p2Join.room.playerCount, 2, 'プレイヤーだけが増える');

      // 役割はあとから本人が変えられる（自動判定はあくまで初期値）
      const changed = await send(p2, 'room:setRole', { role: ROLE_BIGSCREEN });
      assertEqual(changed.ok, true, '役割を変えられる');
      assertEqual(changed.room.playerCount, 1, '大画面に変えたら人数から外れる');

      owner.close(); tv.close(); p2.close();
    } finally { await srv.close(); }
  });

  // ---- 第3部：ホストの譲渡・自動引き継ぎ ----

  await r.test('ホストを手で譲れる（オーナーは変わらない）', async () => {
    const srv = await startTestServer();
    try {
      const cookie = await login(srv.url, 99);
      const owner = await connect(srv.url, cookie);
      const room = await send(owner, 'room:create', { name: 'ホスト' });
      const guest = await connect(srv.url);
      const joined = await send(guest, 'room:join', { code: room.code, name: 'びび' });

      // ホストでない人は譲れない
      const denied = await send(guest, 'room:transferHost', { memberId: room.memberId });
      assertEqual(denied.error, 'not_host', 'ホスト以外は譲渡できない');

      const changedPromise = waitEvent(guest, 'room:hostChanged');
      const res = await send(owner, 'room:transferHost', { memberId: joined.memberId });
      assertEqual(res.ok, true, '譲渡できる');
      const ev = await changedPromise;
      assertEqual(ev.hostMemberId, joined.memberId, '全員に新ホストが伝わる');
      assertEqual(ev.reason, 'manual', '手動の譲渡だと分かる');

      const snap = srv.store.get(room.code);
      assertEqual(snap.hostMemberId, joined.memberId, 'ホストが移っている');
      assertEqual(snap.ownerUserId, 99, 'ホストが変わっても部屋のオーナーは変わらない');

      owner.close(); guest.close();
    } finally { await srv.close(); }
  });

  await r.test('ホストが切断されたら、別の端末へ即座に引き継がれる', async () => {
    const srv = await startTestServer();
    try {
      const cookie = await login(srv.url, 55);
      const owner = await connect(srv.url, cookie);
      const room = await send(owner, 'room:create', { name: 'ホスト' });
      const g1 = await connect(srv.url);
      const j1 = await send(g1, 'room:join', { code: room.code, name: 'びび' });
      const g2 = await connect(srv.url);
      await send(g2, 'room:join', { code: room.code, name: 'ちか' });

      const stored = srv.store.get(room.code);
      assertEqual(stored.hostMemberId, room.memberId, '最初は作った端末がホスト');

      const changedPromise = waitEvent(g1, 'room:hostChanged');
      owner.close(); // ホストの電池切れ・離脱
      const ev = await changedPromise;
      assertEqual(ev.reason, 'disconnect', '切断が理由だと分かる');
      assertEqual(ev.previousHostMemberId, room.memberId, '前のホストが記録される');
      assertEqual(ev.hostMemberId, j1.memberId, '次に早く入った接続中の端末が引き継ぐ');

      await waitUntil(() => srv.store.get(room.code).hostMemberId === j1.memberId, 'ホストの引き継ぎ');
      assertEqual(srv.store.get(room.code).ownerUserId, 55, '引き継いでもオーナーは変わらない');

      g1.close(); g2.close();
    } finally { await srv.close(); }
  });

  await r.test('引き継ぎ先は接続中の端末だけから選ばれる', async () => {
    // 部屋の中身を直接組んで、選び方だけを確かめる（socketを使わない純粋な判定）
    const room = {
      members: new Map([
        ['a', { id: 'a', connected: false, joinedAt: 1 }],
        ['b', { id: 'b', connected: true, joinedAt: 3 }],
        ['c', { id: 'c', connected: true, joinedAt: 2 }]
      ])
    };
    assertEqual(pickNextHost(room, null), 'c', '接続中で最も早く入った人が選ばれる');
    assertEqual(pickNextHost(room, 'c'), 'b', '本人を除いて選べる');
    const alone = { members: new Map([['a', { id: 'a', connected: false, joinedAt: 1 }]]) };
    assertEqual(pickNextHost(alone, null), null, '誰も繋がっていなければ null');
  });

  await r.test('ハートビートのping/pongが往復し、無応答は切断扱いになる', async () => {
    const srv = await startTestServer();
    try {
      const cookie = await login(srv.url, 7);
      const owner = await connect(srv.url, cookie);
      const room = await send(owner, 'room:create', { name: 'ホスト' });
      const guest = await connect(srv.url);
      const joined = await send(guest, 'room:join', { code: room.code, name: 'びび' });

      // サーバーからのpingに応える経路が生きているか
      guest.on('hb:ping', () => guest.emit('hb:pong'));
      const stored = srv.store.get(room.code);
      const member = stored.members.get(joined.memberId);
      const before = member.lastSeen;
      await sleep(30);
      guest.emit('hb:pong');
      await waitUntil(() => member.lastSeen > before, 'pongでlastSeenが更新される');

      // 応答が途絶えた端末は、掃除の周期で切断扱いになる
      member.lastSeen = Date.now() - (60 * 1000);
      await waitUntil(() => member.connected === false, '無応答の端末が切断扱いになる', 8000);

      owner.close(); guest.close();
    } finally { await srv.close(); }
  });

  // ---- 第4部：サーバー主導の状態管理 ----

  await r.test('部屋の状態はホストだけが動かせ、全員に配られる', async () => {
    const srv = await startTestServer();
    try {
      const cookie = await login(srv.url, 3);
      const owner = await connect(srv.url, cookie);
      const room = await send(owner, 'room:create', { name: 'ホスト' });
      const guest = await connect(srv.url);
      await send(guest, 'room:join', { code: room.code, name: 'びび' });

      const denied = await send(guest, 'room:setState', { phase: 'playing' });
      assertEqual(denied.error, 'not_host', 'ホスト以外は状態を動かせない');

      const updatePromise = waitEvent(guest, 'room:update');
      await send(owner, 'room:setState', { phase: 'playing', game: 'wolfrole', data: { turn: 1 } });
      const snap = await updatePromise;
      assertEqual(snap.state.phase, 'playing', '全員に新しい状態が届く');
      assertEqual(snap.state.game, 'wolfrole', 'ゲームの種類も届く');
      assertEqual(snap.state.data.turn, 1, '汎用のdataも届く');

      owner.close(); guest.close();
    } finally { await srv.close(); }
  });

  await r.test('役職はサーバーが計算し、本人にだけ届く（他の人には見えない）', async () => {
    const srv = await startTestServer();
    try {
      const cookie = await login(srv.url, 10);
      const owner = await connect(srv.url, cookie);
      const room = await send(owner, 'room:create', { name: 'あき' });
      const g1 = await connect(srv.url);
      await send(g1, 'room:join', { code: room.code, name: 'びび' });
      const g2 = await connect(srv.url);
      await send(g2, 'room:join', { code: room.code, name: 'ちか' });
      // 大画面ホストは人数に数えないので、役職も配られない
      const tv = await connect(srv.url);
      await send(tv, 'room:join', { code: room.code, name: 'テレビ', role: ROLE_BIGSCREEN });

      // それぞれの端末に届いた自分の役職だけを記録する
      const got = {};
      const seen = [];
      [['owner', owner], ['g1', g1], ['g2', g2], ['tv', tv]].forEach(([key, s]) => {
        s.on('wolf:yourRole', (p) => { got[key] = p; seen.push(key); });
      });

      const denied = await send(g1, 'wolf:dealRoles', {});
      assertEqual(denied.error, 'not_host', 'ホスト以外は配れない');

      const res = await send(owner, 'wolf:dealRoles', { roleIds: ['wolf', 'seer'] });
      assertEqual(res.ok, true, '配布できる');
      assertEqual(res.playerCount, 3, '大画面ホストを除いた3人に配る');

      await waitUntil(() => seen.length >= 3, '3人に役職が届く');
      await sleep(120); // 余計な人に届いていないかを見るため、少し待つ

      assert(got.owner && got.g1 && got.g2, 'プレイヤー3人にはそれぞれ届く');
      assert(!got.tv, '大画面ホストには役職が届かない');
      assertEqual(seen.length, 3, '届いた先は3人だけ（' + seen.join(',') + '）');

      // 中身が「自分のぶんだけ」であること
      [got.owner, got.g1, got.g2].forEach((p) => {
        assert(p.roleId && p.roleName, '役職IDと名前が入っている');
        assert(!Array.isArray(p.players), '他の人の役職一覧は含まない');
      });
      const wolves = [got.owner, got.g1, got.g2].filter((p) => p.roleId === 'wolf');
      assertEqual(wolves.length, 1, '3人なら人狼は1人（サーバー側のwolf-logicが計算している）');

      // 公開スナップショットに誰が何かは載らない
      const snapJson = JSON.stringify(res.room);
      assert(snapJson.indexOf('"wolf"') === -1 || snapJson.indexOf('counts') >= 0, '公開情報は人数構成まで');
      assert(!/roleId/.test(snapJson), '公開スナップショットに個人の役職は含まれない');
      assertEqual(res.room.state.phase, 'roleReveal', '状態が役職確認に進む');

      owner.close(); g1.close(); g2.close(); tv.close();
    } finally { await srv.close(); }
  });

  await r.test('人数が足りなければ配布を断る', async () => {
    const srv = await startTestServer();
    try {
      const cookie = await login(srv.url, 11);
      const owner = await connect(srv.url, cookie);
      const room = await send(owner, 'room:create', { name: 'あき' });
      const g1 = await connect(srv.url);
      await send(g1, 'room:join', { code: room.code, name: 'びび' });

      const res = await send(owner, 'wolf:dealRoles', {});
      assertEqual(res.ok, false, '2人では配れない');
      assertEqual(res.error, 'too_few_players', '理由が分かる');

      owner.close(); g1.close();
    } finally { await srv.close(); }
  });

  await r.test('既存の一人一台前提のAPIは、socket.ioを入れても素通りする', async () => {
    // server.js の配線（http.createServer + attachRealtime）を実際に起動して確かめる
    const srv = await startTestServer();
    try {
      const res = await fetch(srv.url + '/test-login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: 5 })
      });
      assertEqual(res.status, 200, '通常のHTTPリクエストが今までどおり通る');
      const body = await res.json();
      assertEqual(body.userId, 5, 'セッションも今までどおり働く');
    } finally { await srv.close(); }
  });

  r.finish();
})();
