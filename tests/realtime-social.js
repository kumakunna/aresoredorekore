// tests/realtime-social.js — リアクション・感謝・アルバム（第32弾-E 第4部〜第6部）
//
// 見るのは：
//   ・リアクションは全員に届き、知らない絵文字と連打は通らない
//   ・感謝は選ばれた本人にだけ届く（見せびらかさない）
//   ・アルバムは 入れる→まとめて受け取る→「保存しました」で消える、が守られる
//   ・アルバムを受け取れるのは進行役だけ。さわられなければ自動で消える
//
// 本物のサーバー＋本物のsocket.ioで確かめる（jsdomでは通信は確かめられない）。

const http = require('http');
const express = require('express');
const session = require('express-session');
const { io: ioClient } = require('socket.io-client');
const fs = require('fs');
const path = require('path');

const { createRunner, assert, assertEqual } = require('./harness');
const { attachRealtime, RoomStore, REACTION_EMOJI } = require('../realtime');

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
    secret: 'test-secret-for-realtime-social',
    resave: false, saveUninitialized: false,
    cookie: { httpOnly: true, secure: false, sameSite: 'lax' }
  });
  app.use(express.json());
  app.use(sessionMiddleware);
  app.post('/test-login', (req, res) => {
    req.session.userId = (req.body && req.body.userId) || 909;
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
      socket: s, room: null, memberId: null, name: null,
      reacted: [], thanked: [], albumUpdates: [],
      call(event, payload) {
        return new Promise((res) => {
          const t = setTimeout(() => res({ ok: false, error: 'timeout' }), 6000);
          s.emit(event, payload || {}, (r) => { clearTimeout(t); res(r || {}); });
        });
      },
      close() { s.close(); }
    };
    s.on('room:update', (r) => { d.room = r; });
    s.on('room:reacted', (p) => d.reacted.push(p));
    s.on('room:thanked', (p) => d.thanked.push(p));
    s.on('album:update', (p) => d.albumUpdates.push(p));
    s.on('hb:ping', () => s.emit('hb:pong'));
    const t = setTimeout(() => reject(new Error('接続がタイムアウト')), 5000);
    s.on('connect', () => { clearTimeout(t); resolve(d); });
    s.on('connect_error', (e) => { clearTimeout(t); reject(e); });
  });
}

async function makeRoom(srv, names) {
  const cookie = await login(srv.url, 4321);
  const host = await device(srv.url, cookie);
  const created = await host.call('room:create', { name: names[0] });
  assertEqual(created.ok, true, '部屋を作れる');
  host.memberId = created.memberId; host.name = names[0];
  const guests = [];
  for (let i = 1; i < names.length; i++) {
    const g = await device(srv.url);
    const res = await g.call('room:join', { code: created.code, name: names[i] });
    assertEqual(res.ok, true, names[i] + ' が入れる');
    g.memberId = res.memberId; g.name = names[i];
    guests.push(g);
  }
  return { host, guests, code: created.code, all: [host].concat(guests) };
}

// 端末側が縮小して送る写真のかわり（1x1のJPEG）
const TINY_JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAAAAAAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

async function run() {
  const r = createRunner('realtime-social：リアクション・感謝・アルバム');

  await r.test('リアクションは全員に届く。知らない絵文字と連打は通らない', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, ['あき', 'びび']);
      const ok = await rm.host.call('room:react', { emoji: '👏' });
      assertEqual(ok.ok, true, '送れる');
      await sleep(150);
      assert(rm.guests[0].reacted.some((p) => p.emoji === '👏' && p.name === 'あき'),
        '他の端末に、誰の反応かが届く');
      assert(rm.host.reacted.some((p) => p.emoji === '👏'), '自分の端末にも届く（全員と同時に出る）');

      const bad = await rm.host.call('room:react', { emoji: '🍣' });
      assertEqual(bad.ok, false, '一覧に無い絵文字は通らない');

      // 連打（0.5秒以内の2発目）は黙って捨てる（エラーにはしない）
      await sleep(600);   // さっきの👏の間引きに巻き込まれないように
      const n = rm.guests[0].reacted.length;
      await rm.host.call('room:react', { emoji: '🔥' });
      const throttled = await rm.host.call('room:react', { emoji: '🔥' });
      assertEqual(throttled.throttled, true, '2発目は間引かれる');
      await sleep(150);
      assertEqual(rm.guests[0].reacted.length, n + 1, '届くのは1発だけ');
    } finally { await srv.close(); }
  });

  await r.test('リアクションの絵文字一覧が、サーバーと画面で食い違っていない', async () => {
    // 片方だけ絵文字を足すと「押せるのに届かない」ボタンになる（落とし穴1）
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const m = html.match(/var REACTIONS = \[([^\]]+)\]/);
    assert(m, '画面側の一覧が見つかる');
    const client = m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
    assertEqual(client.join(','), REACTION_EMOJI.join(','), '並びまで同じ');
  });

  await r.test('感謝は、選ばれた本人にだけ届く', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, ['あき', 'びび', 'ちか']);
      const res = await rm.host.call('room:thanks', {
        memberId: rm.guests[0].memberId, kind: 'help'
      });
      assertEqual(res.ok, true, '贈れる');
      assertEqual(res.toName, 'びび', '誰に贈ったかが返る');
      await sleep(150);
      assertEqual(rm.guests[0].thanked.length, 1, '本人に届く');
      assertEqual(rm.guests[0].thanked[0].from, 'あき', '誰からかが分かる');
      assert(/助かった/.test(rm.guests[0].thanked[0].label), '項目の言葉が届く');
      assertEqual(rm.guests[1].thanked.length, 0, '他の人には届かない（見せびらかさない）');
      assertEqual(rm.host.thanked.length, 0, '送った本人にも届かない');

      const self = await rm.host.call('room:thanks', { memberId: rm.host.memberId, kind: 'help' });
      assertEqual(self.ok, false, '自分には贈れない');
      const badKind = await rm.host.call('room:thanks', { memberId: rm.guests[0].memberId, kind: 'zzz' });
      assertEqual(badKind.ok, false, '知らない項目は通らない');
    } finally { await srv.close(); }
  });

  await r.test('アルバム：入れる→進行役だけが受け取る→「保存しました」で消える', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, ['あき', 'びび']);
      const add1 = await rm.host.call('album:add', { photo: TINY_JPEG });
      assertEqual(add1.ok, true, '箱に入れられる');
      await rm.guests[0].call('album:add', { photo: TINY_JPEG });
      await sleep(150);
      const st = rm.guests[0].albumUpdates[rm.guests[0].albumUpdates.length - 1];
      assertEqual(st.count, 2, '箱の枚数が全員に伝わる');
      assert(st.names.indexOf('あき') >= 0 && st.names.indexOf('びび') >= 0, '入れた人の名前が分かる');

      const notPhoto = await rm.host.call('album:add', { photo: 'data:text/html;base64,PGI+' });
      assertEqual(notPhoto.ok, false, '写真でないものは入らない');

      // 受け取れるのは進行役だけ
      const stranger = await rm.guests[0].call('album:get', {});
      assertEqual(stranger.ok, false, '進行役でないと受け取れない');
      const got = await rm.host.call('album:get', {});
      assertEqual(got.ok, true, '進行役は受け取れる');
      assert(got.html.indexOf(TINY_JPEG) >= 0, '写真がそのまま入っている');
      assert(got.html.indexOf('あき') >= 0 && got.html.indexOf('びび') >= 0, '名前が添えてある');
      assert(got.html.indexOf('<script') === -1, 'ただ並べるだけ（スクリプトは入れない）');

      // 受け取っただけでは消えない（保存の途中で通信が切れても失われないように）
      const again = await rm.host.call('album:get', {});
      assertEqual(again.ok, true, '「保存しました」を押すまでは消えない');

      // 「保存しました」で初めて消える。消えたことは全員に伝わる
      const done = await rm.host.call('album:done', {});
      assertEqual(done.ok, true, '進行役が締められる');
      await sleep(150);
      const last = rm.guests[0].albumUpdates[rm.guests[0].albumUpdates.length - 1];
      assertEqual(last.count, 0, '箱は空になる');
      assertEqual(last.cleared, true, '消したことがはっきり伝わる');
      const after = await rm.host.call('album:get', {});
      assertEqual(after.ok, false, '消えた後は受け取れない');
    } finally { await srv.close(); }
  });

  await r.test('アルバム：さわられないまま時間が過ぎたら、自動で消える', async () => {
    // ホストが操作せずに部屋を閉じても、写真がサーバーに残り続けない保険（本番は1時間）
    const srv = await startTestServer({ sweepIntervalMs: 100, albumTtlMs: 300 });
    try {
      const rm = await makeRoom(srv, ['あき', 'びび']);
      await rm.host.call('album:add', { photo: TINY_JPEG });
      await sleep(700);
      const gone = await rm.host.call('album:get', {});
      assertEqual(gone.ok, false, '自動で消えている');
      const last = rm.guests[0].albumUpdates[rm.guests[0].albumUpdates.length - 1];
      assertEqual(last.count, 0, '消えたことが全員に伝わる');
    } finally { await srv.close(); }
  });

  r.finish();
}

run();
