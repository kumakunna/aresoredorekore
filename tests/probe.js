// tests/probe.js — 検査のための記録（11/7 の検査の準備 7・6）。サーバーの probe.js・realtime.js の lag:t・public/js/probe.js
//
// 1 入れていない時：道は 404・app:version に probe が無い・lag:t を1つも送らない（本番の .env に PROBE が無い形）
// 2 エラー：決めた欄だけ残す（名前・部屋のコード・URL の ? から後ろは残らない）・1分に60回まで
// 3 遅れ：lag:t のあとの同じ名前の知らせと組になり、本物の rt-client.js が「受け取った・受け口が終わった」を出す
// 4 画面（jsdom）：入っていると言われる前のエラーはためて、言われたら送る・同じエラーは1回・入っていなければ送らない
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');
const session = require('express-session');
const { io: ioClient } = require('socket.io-client');

const { createRunner, assert, assertEqual, launch, waitFor, sleep } = require('./harness');
const { attachRealtime, RoomStore } = require('../realtime');
const { createProbe, parseModes } = require('../probe');
const RTClient = require('../public/js/rt-client.js');

const nap = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitUntil(fn, label, ms) {
  const limit = Date.now() + (ms || 4000);
  while (Date.now() < limit) { if (fn()) return true; await nap(25); }
  throw new Error('条件が満たされませんでした: ' + label);
}
function startServer(on) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-'));
  const app = express();
  const sm = session({ secret: 'test-probe', resave: false, saveUninitialized: false });
  app.use(express.json());
  app.use(sm);
  const probe = createProbe({ on: on || {}, dir });
  probe.mount(app);
  const httpServer = http.createServer(app);
  const io = attachRealtime(httpServer, sm, { store: new RoomStore(), db: null, describe: async () => ({ description: 'x' }), countdownMs: 0, probe });
  return new Promise((resolve) => httpServer.listen(0, '127.0.0.1', () => {
    const url = 'http://127.0.0.1:' + httpServer.address().port;
    resolve({ url, dir, io, close: () => new Promise((r) => { io.stopTimers(); io.close(() => httpServer.close(() => r())); }) });
  }));
}
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const rows = (dir, kind) => fs.readdirSync(dir).filter((f) => f.indexOf(kind) === 0).flatMap((f) => fs.readFileSync(path.join(dir, f), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)));
/** 本物の rt-client.js（Node の socket.io-client）で、届いた知らせを全部数える */
function phone(url) {
  const ph = { names: [], version: null, lag: [] };
  ph.rt = RTClient.create({ io: (o) => {
    const s = ioClient(url, Object.assign({}, o, { transports: ['polling'], forceNew: true, reconnection: false }));
    s.onAny((ev) => ph.names.push(ev));
    ph.sock = s;
    return s;
  } });
  ph.rt.on('version', (p) => { ph.version = p; });
  ph.rt.on('lag', (m) => ph.lag.push(m));
  return ph;
}

(async function main() {
  const r = createRunner('probe：検査のための記録（エラーと遅れ・はっきり入れた時だけ）');

  await r.test('PROBE の読み方：err・lag・all。無い時は何も入らない', async () => {
    assertEqual(JSON.stringify(parseModes('')), JSON.stringify({ err: false, lag: false }), '無い時は両方切');
    assertEqual(JSON.stringify(parseModes(undefined)), JSON.stringify({ err: false, lag: false }), '未設定も両方切');
    assertEqual(JSON.stringify(parseModes('err')), JSON.stringify({ err: true, lag: false }), 'err だけ');
    assertEqual(JSON.stringify(parseModes(' lag , err ')), JSON.stringify({ err: true, lag: true }), '両方（すき間があっても）');
    assertEqual(JSON.stringify(parseModes('all')), JSON.stringify({ err: true, lag: true }), 'all');
  });

  await r.test('1：入れていない時は、道が 404・app:version に probe が無い・lag:t を1つも送らない', async () => {
    const srv = await startServer({});
    try {
      assertEqual((await post(srv.url + '/api/probe/err', { list: [{ msg: 'x' }] })).status, 404, 'エラーの道は 404');
      assertEqual((await post(srv.url + '/api/probe/lag', { list: [{ e: 'x' }] })).status, 404, '遅れの道は 404');
      assertEqual((await fetch(srv.url + '/api/probe/flags')).status, 404, '入っているかを聞く道も 404（端末は何も送らない）');
      assertEqual(fs.readdirSync(srv.dir).length, 0, '何も残さない');
      const ph = phone(srv.url);
      ph.rt.connect();
      await waitUntil(() => ph.version, '版の知らせ');
      assertEqual(JSON.stringify(Object.keys(ph.version)), JSON.stringify(['v']), 'app:version は今までと同じ形（v だけ）');
      // 部屋に入って、知らせがたくさん届いても lag:t は来ない
      const host = await phoneIn(srv, ph);
      await waitUntil(() => ph.names.indexOf('room:update') !== -1, '部屋の知らせが届く');
      await nap(300);
      assertEqual(ph.names.indexOf('lag:t'), -1, 'lag:t は1つも届かない');
      assertEqual(ph.lag.length, 0, '遅れの記録も出ない');
      ph.sock.close(); host && host.close();
    } finally { await srv.close(); }
  });

  await r.test('2：エラーは決めた欄だけ残す（名前・部屋のコード・URL の ? から後ろは残らない）', async () => {
    const srv = await startServer({ err: true });
    try {
      const res = await post(srv.url + '/api/probe/err', { list: [{
        msg: 'TypeError: x is undefined', src: 'https://aresoredorekore.duckdns.org/js/v2-fes.js?room=KZ3DBC&key=ひみつ', line: 12, col: 3,
        stack: 'TypeError: x\n    at f (https://aresoredorekore.duckdns.org/js/v2-fes.js?room=KZ3DBC:12:3)\n    at g (http://localhost/index.html:9:1)',
        kind: 'error', scr: 'scr-v2-fes-lobby', role: 'phone', ua: 'Mozilla/5.0 (iPhone)', v: '2.21', n: 1, at: 1, vis: 'hidden', conn: false,
        name: 'ふう', memberId: 'm_abc', code: 'KZ3DBC'
      }] });
      assertEqual(res.status, 200, '受け取る');
      assertEqual(JSON.stringify(await (await fetch(srv.url + '/api/probe/flags')).json()), JSON.stringify({ err: true, lag: false }), '入っているかを聞くと、入っている種類');
      const got = rows(srv.dir, 'errors');
      assertEqual(got.length, 1, '1行残る');
      const g = got[0];
      assertEqual(g.src, '/js/v2-fes.js', 'ファイルは道だけ（? から後ろと、どこのサーバーかは残さない）');
      assert(!/KZ3DBC|ひみつ|duckdns|localhost/.test(JSON.stringify(g)), '部屋のコード・key・サーバーの名前が残らない：' + JSON.stringify(g));
      ['name', 'memberId', 'code'].forEach((k) => assert(!(k in g), '決めていない欄（' + k + '）は捨てる'));
      assert(JSON.stringify(g).indexOf('ふう') === -1, '名前は残らない');
      assertEqual(g.scr, 'scr-v2-fes-lobby', '画面の id は残す');
      assertEqual(g.ua, 'Mozilla/5.0 (iPhone)', '機種（UA）は残す');
      assertEqual(g.vis, 'hidden', '画面が見えていたかを残す');
      assertEqual(g.conn, false, '通信がつながっていたかを残す');
      assert(typeof g.t === 'number', 'サーバーが受け取った時刻');
    } finally { await srv.close(); }
  });

  await r.test('2：1つの IP から1分に600回まで（学校は全部の端末が1つの IP。601回目は 429・残さない）', async () => {
    const srv = await startServer({ err: true });
    try {
      let last = null, n200 = 0;
      for (let i = 0; i < 601; i++) { last = await post(srv.url + '/api/probe/err', { list: [{ msg: 'e' + i }] }); if (last.status === 200) n200++; }
      assertEqual(n200, 600, '600回までは受け取る（16台＋TV が5秒ごとに送っても足りる）');
      assertEqual(last.status, 429, '601回目は断る');
      assertEqual(rows(srv.dir, 'errors').length, 600, '残すのは600件');
    } finally { await srv.close(); }
  });

  await r.test('3：入れた時は、知らせの前に lag:t（サーバーの時刻）が届き、rt-client.js が「受け取った・受け口が終わった」を組にして出す。遅れの道は残す', async () => {
    const srv = await startServer({ lag: true });
    try {
      const ph = phone(srv.url);
      ph.rt.connect();
      await waitUntil(() => ph.version, '版の知らせ');
      assertEqual(JSON.stringify(ph.version.probe), JSON.stringify({ err: false, lag: true }), 'app:version に入っている種類が添う');
      const host = await phoneIn(srv, ph);
      await waitUntil(() => ph.lag.some((m) => m.e === 'room:update'), '部屋の知らせの遅れが出る');
      const i = ph.names.indexOf('room:update');
      assertEqual(ph.names[i - 1], 'lag:t', 'room:update のすぐ前に lag:t');
      const m = ph.lag.find((x) => x.e === 'room:update');
      assert(typeof m.t === 'number' && m.recv >= m.t - 1000 && m.done >= m.recv, '時刻の並び：出した ≦ 受け取った ≦ 受け口が終わった（' + JSON.stringify(m) + '）');
      const res = await post(srv.url + '/api/probe/lag', { list: [{ e: 'room:update', net: 12.4, handle: 3, paint: 20, scr: 'scr-v2-fes-lobby', role: 'phone', name: 'ふう' }] });
      assertEqual(res.status, 200, '遅れを受け取る');
      const got = rows(srv.dir, 'lag');
      assertEqual(got[0].net, 12, '数は ms の整数');
      assert(!('name' in got[0]), '決めていない欄は捨てる');
      ph.sock.close(); host && host.close();
    } finally { await srv.close(); }
  });

  // ---- 画面（jsdom）：public/js/probe.js ----
  async function 開く() {
    const t = await launch({ fakeSocket: true });
    await waitFor(t.win, () => t.win.__rtFake && t.win.__rtFake.connected, 3000, '疑似socketがつながる');
    const sent = [];
    const orig = t.win.fetch;
    t.win.fetch = function (u, o) { if (String(u).indexOf('/api/probe/') === 0) { sent.push({ u: String(u), body: JSON.parse(o.body) }); return Promise.resolve({ ok: true, json: () => ({}) }); } return orig.apply(this, arguments); };
    const err = (msg) => t.win.dispatchEvent(new t.win.ErrorEvent('error', { message: msg, filename: 'http://localhost/js/v2-fes.js?room=TST754', lineno: 7, colno: 2 }));
    return Object.assign(t, { sent, err });
  }

  await r.test('4（画面）：入っていると言われる前のエラーはためておき、言われたら送る。同じエラーは1回だけ', async () => {
    const t = await 開く();
    t.err('ReferenceError: boom');
    await sleep(t.win, 30);
    assertEqual(t.sent.length, 0, '型(b)：まだ送らない（入っているか分からない）');
    assert(t.win.ProbeKit && t.win.ProbeKit.errs.length === 1, 'ためている');
    t.win.__rtFake.fire('app:version', { v: t.win.AppVersion.VERSION, probe: { err: true, lag: false } });
    await sleep(t.win, 30);
    assertEqual(t.sent.length, 1, '入ったと言われたら送る');
    assertEqual(t.sent[0].u, '/api/probe/err', 'エラーの道へ');
    const e = t.sent[0].body.list[0];
    assertEqual(e.msg, 'ReferenceError: boom', 'エラーの字');
    assertEqual(e.line, 7, '行');
    assertEqual(e.vis, 'visible', 'その時、画面が見えていたか');
    assertEqual(typeof e.conn, 'boolean', '通信がつながっていたか');
    assert(e.ua && e.v, '機種と版');
    t.err('ReferenceError: boom');
    t.err('ReferenceError: boom');
    await sleep(t.win, 30);
    assertEqual(t.sent.length, 1, '同じエラーは送り直さない');
    t.err('TypeError: other');
    await sleep(t.win, 30);
    assertEqual(t.sent.length, 2, 'ちがうエラーは送る');
    t.win.close();
  });

  await r.test('4（画面）：入っていなければ（app:version に probe が無い）、エラーが起きても何も送らない', async () => {
    const t = await 開く();
    t.win.__rtFake.fire('app:version', { v: t.win.AppVersion.VERSION });
    t.err('ReferenceError: boom');
    await sleep(t.win, 50);
    assertEqual(t.sent.length, 0, '送らない');
    t.win.close();
  });

  r.finish();
})();

/** 部屋を作る人（ログインが要るので、作るのは名前だけの部屋の代わりに socket で直接）と、ph をその部屋へ */
async function phoneIn(srv, ph) {
  // 部屋を作るにはログインが要る。ここでは store に部屋を作って、ph をそこへ入れる
  const room = srv.io.store.create({ ownerUserId: 1, ownerUsername: 'x' });
  const res = await ph.rt.joinRoom(room.code, 'ふう', 'player');
  if (!res.ok) throw new Error('入れません: ' + res.error);
  return null;
}
