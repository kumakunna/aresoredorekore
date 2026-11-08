// tests/tvs.js — TV の切りかえ（指示69 一の束）。本物のサーバー（express＋socket.io の /tvs）を立て、
// リモコン（係のスマホ）と、TV の PC の休けいのタブのふりをする端末で回す。拡張機能の決まり（logic.js）も、ここで見る。
//
// 門4（係でない人は開けない・押せない・URL を受け取れない）・門5（作り直してももどる）・門8（ゲーム中の確かめはゲーム中だけ）・
// 門3 の決まり（見えていないタブは鳴らさない・あそびまちは1つだけ鳴る）・門10（key がログに出ない）
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const session = require('express-session');
const Database = require('better-sqlite3');
const { io: ioClient } = require('socket.io-client');

const { createRunner, assert, assertEqual } = require('./harness');
const { attachRealtime, RoomStore } = require('../realtime');
const { createFesStore } = require('../fes-store');
const { mountTvs } = require('../tvs-routes');
const { createTvsStore, MAX_ITEMS } = require('../tvs-store');
const Logic = require('../tv-switcher/extension/logic');

const OWNER = 900, STAFF = 901, NOBODY = 902;
const SECRET = 'https://asobi.example.test/monitor?key=TVS-SECRET-7f3a9';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ログに key が出ないかを見るため、このスイートの間の console をためる
const 出た = [];
['log', 'warn', 'error'].forEach((k) => { const o = console[k]; console[k] = (...a) => { 出た.push(a.map(String).join(' ')); o.apply(console, a); }; });

/** db：同じ db を渡すと「サーバーの作り直し」になる。phase：文化祭の部屋の段（無ければ本物の io.fesPhase） */
function startTestServer(o) {
  const opt = o || {};
  const app = express();
  const sessionMiddleware = session({ secret: 'test-tvs', resave: false, saveUninitialized: false, cookie: { httpOnly: true, secure: false, sameSite: 'lax' } });
  app.use(express.json());
  app.use(sessionMiddleware);
  app.post('/test-login', (req, res) => { req.session.userId = req.body.userId; res.json({ ok: true }); });
  const httpServer = http.createServer(app);
  const io = attachRealtime(httpServer, sessionMiddleware, {
    store: new RoomStore(), db: null, describe: async () => ({ description: 'x' }), countdownMs: 0, fesStore: createFesStore(new Database(':memory:')),
    fesRole: (uid) => (uid === OWNER ? 'owner' : uid === STAFF ? 'staff' : null)
  });
  if (opt.phase) io.fesPhase = () => opt.phase.v;
  const db = opt.db || new Database(':memory:');
  // 自動（1秒ごと）は、検査では止めておき、見たい所で tvs.tick() を呼ぶ。時計は opt.clock（{ t }）で進められる
  const tvs = mountTvs(app, io, { db, asobiUrl: opt.asobiUrl !== undefined ? opt.asobiUrl : SECRET, pingMs: opt.pingMs || 200, tickMs: opt.tickMs || 1e9,
    now: opt.clock ? () => opt.clock.t : undefined });
  return new Promise((resolve) => httpServer.listen(0, '127.0.0.1', () => {
    const url = 'http://127.0.0.1:' + httpServer.address().port;
    resolve({ url, io, db, tvs,
      close: () => new Promise((r) => { tvs.stop(); io.stopTimers(); io.close(() => httpServer.close(() => r())); }) });
  }));
}
async function login(url, userId) {
  const res = await fetch(url + '/test-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId }) });
  return (res.headers.getSetCookie() || []).map((c) => c.split(';')[0]).join('; ');
}
/** /tvs につなぐ。auth：{ as:'remote' } か { as:'screen', tv }。つながらない時は { error } */
function dev(url, cookie, auth, ns) {
  return new Promise((resolve) => {
    const opts = { transports: ['polling'], forceNew: true, reconnection: false, auth };
    if (cookie) opts.extraHeaders = { Cookie: cookie };
    const s = ioClient(url + (ns || '/tvs'), opts);
    const d = { socket: s, state: null, states: [], acks: [], applies: [], reloads: [], items: null, pings: 0,
      call(ev, p) { return new Promise((res) => { const t = setTimeout(() => res({ ok: false, error: 'timeout' }), 4000); s.emit(ev, p || {}, (r) => { clearTimeout(t); res(r || {}); }); }); },
      close() { s.close(); } };
    s.on('tvs:state', (v) => { d.state = v; d.states.push(v); });
    s.on('tvs:ack', (v) => d.acks.push(v));
    s.on('tvs:apply', (v) => d.applies.push(v));
    s.on('tvs:reload', (v) => d.reloads.push(v));
    s.on('tvs:items', (v) => { d.items = v.items; });
    s.on('tvs:ping', () => { d.pings++; });
    d.looks = []; s.on('tvs:look', (v) => d.looks.push(v));
    s.on('connect', () => resolve(d));
    s.on('connect_error', (e) => resolve({ error: e && e.message }));
  });
}
async function until(fn, label, ms) {
  const limit = Date.now() + (ms || 3000);
  while (Date.now() < limit) { if (fn()) return; await sleep(15); }
  throw new Error('条件が満たされませんでした: ' + label);
}
/** 休けいのタブのふり：つながって hello、言われたら「出した」と返す（拡張機能は生きている体） */
async function screen(url, cookie, tv) {
  const d = await dev(url, cookie, { as: 'screen', tv });
  d.hello = await d.call('tvs:hello', { ext: true, have: { menu: true, video: false } });
  d.socket.on('tvs:apply', (p) => d.socket.emit('tvs:shown', { item: p.item, seq: p.seq }));
  return d;
}

(async function main() {
  const r = createRunner('tvs：TV の切りかえ（指示69 一の束）');

  await r.test('門4：係でない人は、リモコン・出す物の一覧・休けいの画面を開けない（ログイン無し 401／係でない 403）。係は開ける', async () => {
    const srv = await startTestServer();
    try {
      const nobody = await login(srv.url, NOBODY), staff = await login(srv.url, STAFF), owner = await login(srv.url, OWNER);
      for (const p of ['/tvs', '/tvs/items', '/tvs/screen?tv=1']) {
        assertEqual((await fetch(srv.url + p)).status, 401, p + '：ログイン無し');
        const n = await fetch(srv.url + p, { headers: { cookie: nobody } });
        assertEqual(n.status, 403, p + '：係でない');
        assert((await n.text()).indexOf('<script') === -1, p + '：係でない人には、画面の中身（スクリプト）を渡さない');
        assertEqual((await fetch(srv.url + p, { headers: { cookie: staff } })).status, 200, p + '：先生（staff）');
        assertEqual((await fetch(srv.url + p, { headers: { cookie: owner } })).status, 200, p + '：くまくん（owner）');
      }
    } finally { await srv.close(); }
  });

  await r.test('門4：係でない人は、つなげない＝押せない（ログイン無しは login・係でないは forbidden）', async () => {
    const srv = await startTestServer();
    try {
      assertEqual((await dev(srv.url, null, { as: 'remote' })).error, 'login', 'ログイン無し');
      assertEqual((await dev(srv.url, await login(srv.url, NOBODY), { as: 'remote' })).error, 'forbidden', '係でない（リモコン）');
      assertEqual((await dev(srv.url, await login(srv.url, NOBODY), { as: 'screen', tv: 1 })).error, 'forbidden', '係でない（休けいのタブのふり）');
      const ok = await dev(srv.url, await login(srv.url, STAFF), { as: 'remote' });
      assert(!ok.error, '係はつながる');
      ok.close();
    } finally { await srv.close(); }
  });

  await r.test('門4・2-4：あそびまちの URL は、係のログインを通した /api/tvs/asobi だけが渡す。係でない人は 401／403。リモコンに届く物には無い', async () => {
    const srv = await startTestServer();
    try {
      assertEqual((await fetch(srv.url + '/api/tvs/asobi')).status, 401, 'ログイン無し');
      const n = await fetch(srv.url + '/api/tvs/asobi', { headers: { cookie: await login(srv.url, NOBODY) } });
      assertEqual(n.status, 403, '係でない');
      assert((await n.text()).indexOf('TVS-SECRET') === -1, '係でない人への返事に key が無い');
      const staff = await login(srv.url, STAFF);
      assertEqual((await (await fetch(srv.url + '/api/tvs/asobi', { headers: { cookie: staff } })).json()).url, SECRET, '係のログイン（TV の PC の拡張機能が読む）');
      const rm = await dev(srv.url, staff, { as: 'remote' });
      const sc = await screen(srv.url, staff, 1);
      await until(() => rm.state, 'リモコンの状態');
      await rm.call('tvs:show', { tv: 1, item: 'asobi' });
      await sleep(250);   // 生きているかの知らせ（ping）も1回は回る
      const 全部 = JSON.stringify(rm.states) + JSON.stringify(sc.hello) + JSON.stringify(sc.applies);
      assert(全部.indexOf('TVS-SECRET') === -1 && 全部.indexOf('asobi.example') === -1, 'リモコンと休けいのページに届いた物に、あそびまちの URL が無い');
      const rem = await (await fetch(srv.url + '/tvs', { headers: { cookie: staff } })).text();
      assert(rem.indexOf('/api/tvs/asobi') === -1, 'リモコンの画面は、URL の道を読まない');
      const asobi = rm.state.items.find((it) => it.id === 'asobi');
      assertEqual(asobi.name, 'あそびまち', 'リモコンには名前だけ');
      assertEqual(asobi.have, true, 'URL があるので「まだありません」ではない');
      rm.close(); sc.close();
    } finally { await srv.close(); }
    const 無し = await startTestServer({ asobiUrl: '' });
    try {
      const rm = await dev(無し.url, await login(無し.url, STAFF), { as: 'remote' });
      await until(() => rm.state, '状態');
      assertEqual(rm.state.items.find((it) => it.id === 'asobi').have, false, '.env に無い時は「まだありません」');
      rm.close();
    } finally { await 無し.close(); }
  });

  await r.test('1回押すだけで、その TV の休けいのタブに「出して」が届き、出したら両方のリモコンに「変わりました」の返事（もう片方の TV には届かない）', async () => {
    const srv = await startTestServer();
    try {
      const staff = await login(srv.url, STAFF), owner = await login(srv.url, OWNER);
      const a = await dev(srv.url, staff, { as: 'remote' }), b = await dev(srv.url, owner, { as: 'remote' });
      const s1 = await screen(srv.url, staff, 1), s2 = await screen(srv.url, staff, 2);
      assertEqual(s1.hello.item, 'fes', 'TV① のはじめはあつまれ');
      assertEqual(s2.hello.item, 'rest', 'TV② のはじめは休けい');
      assertEqual(s1.hello.items.map((it) => it.id).join(','), 'fes,menu,asobi,video,rest', 'タブの並び＝Ctrl+1〜5');
      const res = await a.call('tvs:show', { tv: 2, item: 'menu' });
      assert(res.ok && res.seq, '押したら ok と番号');
      await until(() => a.acks.some((x) => x.tv === 2 && x.seq === res.seq), 'リモコンA に返事');
      await until(() => b.acks.some((x) => x.tv === 2 && x.seq === res.seq), 'リモコンB に返事');
      assertEqual(s2.applies.length, 1, 'TV② に1回');
      assertEqual(s1.applies.length, 0, 'TV① には届かない');
      await until(() => b.state.tvs[2].item === 'menu' && b.state.tvs[2].shown === 'menu', 'もう片方のリモコンにも同じ状態');
      assertEqual(b.state.tvs[2].connected && b.state.tvs[2].ext, true, '● つながっている');
      assert(b.state.tvs[2].seen > 0, '最後の連絡の時刻');
      [a, b, s1, s2].forEach((d) => d.close());
    } finally { await srv.close(); }
  });

  await r.test('出せない物・出せない TV は押せない。足した物を消すと、映していた TV は休けいへ。数は ' + MAX_ITEMS + ' つまで', async () => {
    const srv = await startTestServer();
    try {
      const rm = await dev(srv.url, await login(srv.url, OWNER), { as: 'remote' });
      assertEqual((await rm.call('tvs:show', { tv: 3, item: 'menu' })).ok, false, 'TV③ は無い');
      assertEqual((await rm.call('tvs:show', { tv: 1, item: 'nope' })).ok, false, '無い物');
      const add = await rm.call('tvs:items:add', { name: '学校の案内', kind: 'url', url: 'https://example.test/', tvs: [2], sound: false });
      assert(add.ok, '足せる（' + add.error + '）');
      assertEqual((await rm.call('tvs:show', { tv: 1, item: add.item.id })).ok, false, 'TV② だけの物は、TV① に出せない');
      assertEqual((await rm.call('tvs:show', { tv: 2, item: add.item.id })).ok, true, 'TV② には出せる');
      assertEqual((await rm.call('tvs:items:add', { name: 'もう1つ', kind: 'video', tvs: [1, 2] })).error, '出す物は ' + MAX_ITEMS + ' つまでです', '上限');
      assertEqual((await rm.call('tvs:items:add', { name: 'x', kind: 'url', url: 'javascript:alert(1)', tvs: [1] })).ok, false, 'http でないアドレスは足せない');
      assertEqual((await rm.call('tvs:items:remove', { id: 'fes' })).ok, false, 'はじめからある物は消せない');
      assert((await rm.call('tvs:items:remove', { id: add.item.id })).ok, '足した物は消せる');
      await until(() => rm.state.tvs[2].item === 'rest', '映していた TV② は休けいへ');
      rm.close();
    } finally { await srv.close(); }
  });

  await r.test('門8：ゲーム中（遊ぶ＝3-2-1 と遊んでいる間）にあつまれから離れる時だけ確かめる。待合・呼び込み・投票・結果では確かめない', async () => {
    const phase = { v: 'lobby' };
    const srv = await startTestServer({ phase });
    try {
      const rm = await dev(srv.url, await login(srv.url, STAFF), { as: 'remote' });
      for (const p of ['idle', 'lobby', 'vote', 'decide', 'ready', 'result', null]) {
        phase.v = p;
        await rm.call('tvs:show', { tv: 1, item: 'fes' });
        assertEqual((await rm.call('tvs:show', { tv: 1, item: 'menu' })).ok, true, p + '：確かめずに切りかわる');
      }
      phase.v = 'play';
      await rm.call('tvs:show', { tv: 1, item: 'fes' });
      const r1 = await rm.call('tvs:show', { tv: 1, item: 'menu' });
      assertEqual(r1.error, 'confirm', 'ゲーム中のあつまれから離れる → 確かめ');
      await until(() => rm.state && rm.state.playing === true, 'リモコンにもゲーム中が届く');
      assertEqual(rm.state.tvs[1].item, 'fes', '確かめの間は切りかえない');
      assertEqual((await rm.call('tvs:back', { tv: 1 })).error, 'confirm', '「さっきの画面にもどす」でも確かめる');
      assertEqual((await rm.call('tvs:show', { tv: 1, item: 'fes' })).ok, true, 'あつまれ→あつまれは確かめない');
      assertEqual((await rm.call('tvs:show', { tv: 2, item: 'menu' })).ok, true, 'あつまれを映していない TV は確かめない');
      assertEqual((await rm.call('tvs:show', { tv: 1, item: 'menu', force: true })).ok, true, '［切りかえる］を押したら切りかわる');
      assertEqual(rm.state && (await until(() => rm.state.tvs[1].item === 'menu', 'TV① がメニュー'), rm.state.tvs[1].item), 'menu', '切りかわった');
      assertEqual((await rm.call('tvs:show', { tv: 1, item: 'fes' })).ok, true, 'メニュー→あつまれ（ゲーム中でも、あつまれへは確かめない）');
      rm.close();
    } finally { await srv.close(); }
  });

  await r.test('門8：本物の文化祭の部屋の段を読む（部屋が無ければゲーム中でない・作ったら待合）', async () => {
    const srv = await startTestServer();
    try {
      assertEqual(srv.io.fesPhase(), null, '部屋が無い');
      const owner = await login(srv.url, OWNER);
      const st = await dev(srv.url, owner, {}, '/');
      assert((await st.call('fes:create', {})).ok, '文化祭の部屋を作る');
      assertEqual(srv.io.fesPhase(), 'lobby', '作ったら待合');
      const rm = await dev(srv.url, owner, { as: 'remote' });
      assertEqual((await rm.call('tvs:show', { tv: 1, item: 'menu' })).ok, true, '待合では確かめない');
      st.close(); rm.close();
    } finally { await srv.close(); }
  });

  await r.test('「さっきの画面にもどす」：ひとつ前へ。もう一度押すと、また入れかわる。前が無い時は押せない', async () => {
    const srv = await startTestServer();
    try {
      const rm = await dev(srv.url, await login(srv.url, STAFF), { as: 'remote' });
      assertEqual((await rm.call('tvs:back', { tv: 2 })).ok, false, 'はじめは前が無い');
      await rm.call('tvs:show', { tv: 2, item: 'menu' });
      await rm.call('tvs:show', { tv: 2, item: 'video' });
      await rm.call('tvs:back', { tv: 2 });
      await until(() => rm.state.tvs[2].item === 'menu' && rm.state.tvs[2].prev === 'video', 'メニューにもどる（前は動画）');
      await rm.call('tvs:back', { tv: 2 });
      await until(() => rm.state.tvs[2].item === 'video', 'もう一度で動画');
      rm.close();
    } finally { await srv.close(); }
  });

  await r.test('2-6：係が2人で同時に押した → あとから届いた方にそろい、両方のリモコンに同じ結果', async () => {
    const srv = await startTestServer();
    try {
      const a = await dev(srv.url, await login(srv.url, STAFF), { as: 'remote' });
      const b = await dev(srv.url, await login(srv.url, OWNER), { as: 'remote' });
      const [ra, rb] = await Promise.all([a.call('tvs:show', { tv: 2, item: 'menu' }), b.call('tvs:show', { tv: 2, item: 'video' })]);
      const last = ra.seq > rb.seq ? 'menu' : 'video';
      await until(() => a.state.tvs[2].item === last && b.state.tvs[2].item === last, '両方が「あとから届いた方」にそろう');
      a.close(); b.close();
    } finally { await srv.close(); }
  });

  await r.test('TV の PC で手で切りかえた（Ctrl+1〜5）→ サーバーの今の画面もそれに合わせ、リモコンに出る', async () => {
    const srv = await startTestServer();
    try {
      const staff = await login(srv.url, STAFF);
      const rm = await dev(srv.url, staff, { as: 'remote' }), s1 = await screen(srv.url, staff, 1);
      s1.socket.emit('tvs:manual', { item: 'video' });
      await until(() => rm.state.tvs[1].item === 'video' && rm.state.tvs[1].shown === 'video', 'リモコンに TV①：動画');
      s1.socket.emit('tvs:manual', { item: 'nope' });
      await sleep(100);
      assertEqual(rm.state.tvs[1].item, 'video', '知らない物は無視');
      rm.close(); s1.close();
    } finally { await srv.close(); }
  });

  await r.test('2-6：あつまれが「F5 で開き直してください」を出した → リモコンに「開き直しが要ります」。［開き直す］で TV の PC へ', async () => {
    const srv = await startTestServer();
    try {
      const staff = await login(srv.url, STAFF);
      const rm = await dev(srv.url, staff, { as: 'remote' }), s1 = await screen(srv.url, staff, 1);
      s1.socket.emit('tvs:stuck', { on: true });
      await until(() => rm.state.tvs[1].stuck === true, 'リモコンに出る');
      assertEqual(rm.state.tvs[2].stuck, false, 'TV② には出ない');
      assert((await rm.call('tvs:reload', { tv: 1 })).ok, '開き直す');
      await until(() => s1.reloads.length === 1 && s1.reloads[0].item === 'fes', 'TV① の休けいのタブに「あつまれを開き直して」');
      s1.socket.emit('tvs:pong', { ext: true, stuck: false });
      await until(() => rm.state.tvs[1].stuck === false, '消えたら消える');
      rm.close(); s1.close();
    } finally { await srv.close(); }
  });

  await r.test('2-6：拡張機能が止まった・休けいのタブが切れた → リモコンは ×。最後の連絡の時刻は残る', async () => {
    const srv = await startTestServer();
    try {
      const staff = await login(srv.url, STAFF);
      const rm = await dev(srv.url, staff, { as: 'remote' }), s1 = await screen(srv.url, staff, 1);
      await until(() => s1.pings > 0, '生きているかを聞かれる');
      s1.socket.emit('tvs:pong', { ext: false });
      await until(() => rm.state.tvs[1].connected === true && rm.state.tvs[1].ext === false, '拡張機能が止まった → ×');
      s1.close();
      await until(() => rm.state.tvs[1].connected === false && rm.state.tvs[1].ext === false, '切れた → ×');
      assert(rm.state.tvs[1].seen > 0, '最後の連絡の時刻は残る');
      rm.close();
    } finally { await srv.close(); }
  });

  await r.test('門5：サーバーを作り直しても、TV ごとの今の画面・さっきの画面・出す物の一覧がもどり、つなぎ直した休けいのタブにも同じ物が届く', async () => {
    const file = path.join(os.tmpdir(), 'tvs-test-' + process.pid + '.db');
    try { fs.unlinkSync(file); } catch (e) {}
    let db = new Database(file);
    const a = await startTestServer({ db });
    const staff = await login(a.url, STAFF);
    const rm = await dev(a.url, staff, { as: 'remote' });
    await rm.call('tvs:show', { tv: 1, item: 'video' });
    await rm.call('tvs:show', { tv: 2, item: 'menu' });
    await rm.call('tvs:show', { tv: 2, item: 'asobi' });
    const add = await rm.call('tvs:items:add', { name: '案内', kind: 'url', url: 'https://example.test/', tvs: [1, 2] });
    await rm.call('tvs:items:update', { id: 'video', sound: true });
    rm.close();
    await a.close(); db.close();
    db = new Database(file);
    const b = await startTestServer({ db });
    try {
      const staff2 = await login(b.url, STAFF);
      const rm2 = await dev(b.url, staff2, { as: 'remote' });
      await until(() => rm2.state, '状態');
      assertEqual(rm2.state.tvs[1].item, 'video', 'TV① は動画のまま');
      assertEqual(rm2.state.tvs[2].item + '/' + rm2.state.tvs[2].prev, 'asobi/menu', 'TV② はあそびまち（前はメニュー）');
      assert(rm2.state.items.some((it) => it.id === add.item.id), '足した物も残る');
      assertEqual(rm2.state.items.find((it) => it.id === 'video').sound, true, '動画の音の入も残る');
      const s1 = await screen(b.url, staff2, 1), s2 = await screen(b.url, staff2, 2);
      assertEqual(s1.hello.item + '/' + s2.hello.item, 'video/asobi', 'つなぎ直した休けいのタブに、覚えていた画面');
      rm2.close(); s1.close(); s2.close();
    } finally { await b.close(); db.close(); try { fs.unlinkSync(file); } catch (e) {} }
  });

  await r.test('記録：切りかえは「だれが・いつ・何を」残す（係の番号と役。1か月より前は消える）', async () => {
    const db = new Database(':memory:');
    const st = createTvsStore(db);
    st.setScreen(1, 'menu', 'staff:901', 1000);
    st.setScreen(2, 'video', 'owner:900', Date.now());
    assertEqual(st.listLog(10).map((x) => x.who + ' ' + x.tv + ' ' + x.item).join('|'), 'owner:900 2 video|staff:901 1 menu', '新しい順');
    st.purge(Date.now());
    assertEqual(st.listLog(10).length, 1, '古い記録は消える');
  });

  // ---- 二の束（自動・お知らせ・休けいの字・記録）----
  await r.test('二の束：はじめは TV② の自動が入・TV① は切。係が出す物のボタンを押すと、その TV の自動は切（もう片方はそのまま）', async () => {
    const srv = await startTestServer();
    try {
      const rm = await dev(srv.url, await login(srv.url, STAFF), { as: 'remote' });
      await until(() => rm.state, '状態');
      assertEqual(JSON.stringify(rm.state.settings.auto), '{"1":false,"2":true}', 'はじめ');
      await rm.call('tvs:show', { tv: 2, item: 'video' });
      await until(() => rm.state.settings.auto[2] === false, 'TV② の自動が切に');
      assertEqual((await rm.call('tvs:auto', { tv: 1, on: true })).ok, true, 'TV① を入に');
      await rm.call('tvs:show', { tv: 2, item: 'menu' });
      await until(() => rm.state.settings.auto[1] === true && rm.state.settings.auto[2] === false, 'TV② を押しても TV① は入のまま');
      rm.close();
    } finally { await srv.close(); }
  });

  await r.test('二の束：自動で回す（サーバーの時計で）。休けいのタブに「出して」が届き、記録の「だれが」は「自動で回す」', async () => {
    const clock = { t: 1000000 };
    const srv = await startTestServer({ clock });
    try {
      const staff = await login(srv.url, STAFF);
      const rm = await dev(srv.url, staff, { as: 'remote' }), s2 = await screen(srv.url, staff, 2);
      srv.tvs.tick();
      await until(() => s2.applies.some((a) => a.item === 'menu'), 'TV② にメニュー');
      clock.t += 20000; srv.tvs.tick();
      await until(() => s2.applies.some((a) => a.item === 'asobi'), '20秒であそびまち');
      await until(() => rm.state.log.length >= 2, '記録');
      assertEqual(rm.state.log[0].who + ' ' + rm.state.log[0].item, '自動で回す asobi', '新しい順・だれが');
      rm.close(); s2.close();
    } finally { await srv.close(); }
  });

  await r.test('二の束：あそびまちの呼び出し（TV の PC が見つけた）→ TV② をあそびまちに30秒→元へ（元がもう出せなければ休けいへ）。ゲーム中にあつまれを映していたら変えない', async () => {
    const clock = { t: 1000000 }, phase = { v: 'idle' };
    const srv = await startTestServer({ clock, phase });
    try {
      const staff = await login(srv.url, STAFF);
      const rm = await dev(srv.url, staff, { as: 'remote' }), s2 = await screen(srv.url, staff, 2);
      await rm.call('tvs:show', { tv: 2, item: 'menu' });   // 押したので TV② の自動は切
      s2.socket.emit('tvs:chime', {});
      await until(() => rm.state.tvs[2].item === 'asobi', 'あそびまちへ');
      assertEqual(rm.state.log[0].who, 'あそびまちの呼び出し', '記録');
      clock.t += 29000; srv.tvs.tick(); await sleep(50);
      assertEqual(rm.state.tvs[2].item, 'asobi', '30秒の間はそのまま');
      clock.t += 1000; srv.tvs.tick();
      await until(() => rm.state.tvs[2].item === 'menu', '30秒で元のメニューへ');
      await rm.call('tvs:show', { tv: 2, item: 'video' });   // この休けいのタブのふりは「動画のファイルが無い」と言う
      s2.socket.emit('tvs:chime', {});
      await until(() => rm.state.tvs[2].item === 'asobi', '2回目');
      clock.t += 30000; srv.tvs.tick();
      await until(() => rm.state.tvs[2].item === 'rest', '元の動画は出せないので休けいへ');
      await rm.call('tvs:show', { tv: 2, item: 'fes' });
      phase.v = 'play';
      s2.socket.emit('tvs:chime', {});
      await sleep(150);
      assertEqual(rm.state.tvs[2].item, 'fes', 'ゲーム中のあつまれは変えない');
      rm.close(); s2.close();
    } finally { await srv.close(); }
  });

  await r.test('二の束：人が入った（呼び込み→待合）→ TV① をあつまれへ', async () => {
    const phase = { v: 'idle' };
    const srv = await startTestServer({ phase });
    try {
      const rm = await dev(srv.url, await login(srv.url, STAFF), { as: 'remote' });
      await rm.call('tvs:show', { tv: 1, item: 'menu' });
      srv.tvs.tick();
      phase.v = 'lobby'; srv.tvs.tick();
      await until(() => rm.state.tvs[1].item === 'fes', 'TV① があつまれ');
      assertEqual(rm.state.log[0].who, 'あつまれに人が入った', '記録');
      rm.close();
    } finally { await srv.close(); }
  });

  await r.test('二の束：お知らせの一言と休けいの字 → その TV の休けいのタブに届く（つないだ時にも）。40字まで・改行は空白', async () => {
    const srv = await startTestServer();
    try {
      const staff = await login(srv.url, STAFF);
      const rm = await dev(srv.url, staff, { as: 'remote' }), s1 = await screen(srv.url, staff, 1), s2 = await screen(srv.url, staff, 2);
      assertEqual(JSON.stringify(s1.hello.look), '{"rest":"準備中です","notice":""}', 'つないだ時：はじめの字');
      await rm.call('tvs:settings', { notice: { 1: '12:30 から体育館で\n発表', 2: '' }, rest: 'ただいま 休けい中' });
      await until(() => s1.looks.length && s2.looks.length, '両方に届く');
      assertEqual(s1.looks.pop().notice, '12:30 から体育館で 発表', 'TV① の一言（改行は空白）');
      assertEqual(s2.looks.pop().notice, '', 'TV② は空');
      await rm.call('tvs:settings', { notice: { 1: 'あ'.repeat(80), 2: 'x' } });
      await until(() => s1.looks.length, '2回目');
      assertEqual(s1.looks.pop().notice.length, 40, '40字まで');
      const s1b = await screen(srv.url, staff, 1);
      assertEqual(s1b.hello.look.rest, 'ただいま 休けい中', 'つなぎ直した時も休けいの字');
      rm.close(); s1.close(); s2.close(); s1b.close();
    } finally { await srv.close(); }
  });

  await r.test('二の束：切りかえの記録は新しい順10件（だれが＝係のアカウントの名前・いつ・何を）', async () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, display_name TEXT)');
    db.prepare('INSERT INTO users (id, username, display_name) VALUES (?, ?, ?)').run(STAFF, 'sensei-acct', null);
    const srv = await startTestServer({ db });
    try {
      const rm = await dev(srv.url, await login(srv.url, STAFF), { as: 'remote' });
      for (let i = 0; i < 12; i++) await rm.call('tvs:show', { tv: 2, item: i % 2 ? 'menu' : 'video' });
      await until(() => rm.state.log.length === 10 && rm.state.log[0].item === 'menu', '10件');
      assertEqual(rm.state.log[0].who, 'sensei-acct', 'だれが＝アカウントの名前');
      assert(rm.state.log[0].at > 0, 'いつ');
      rm.close();
    } finally { await srv.close(); }
  });

  await r.test('二の束 門5：自動の入／切・回す物・呼び出し・休けいの字・一言は、サーバーを作り直しても残る', async () => {
    const file = path.join(os.tmpdir(), 'tvs-test2-' + process.pid + '.db');
    try { fs.unlinkSync(file); } catch (e) {}
    let db = new Database(file);
    const a = await startTestServer({ db });
    const rm = await dev(a.url, await login(a.url, STAFF), { as: 'remote' });
    await rm.call('tvs:auto', { tv: 1, on: true });
    await rm.call('tvs:settings', { rot: { 1: [{ item: 'menu', sec: 15 }], 2: [{ item: 'video', sec: null }] }, chime: false, rest: '休み', notice: { 1: '', 2: 'お昼' } });
    rm.close(); await a.close(); db.close();
    db = new Database(file);
    const b = await startTestServer({ db });
    try {
      const rm2 = await dev(b.url, await login(b.url, STAFF), { as: 'remote' });
      await until(() => rm2.state, '状態');
      const S = rm2.state.settings;
      assertEqual(JSON.stringify([S.auto, S.rot, S.chime, S.rest, S.notice]),
        JSON.stringify([{ 1: true, 2: true }, { 1: [{ item: 'menu', sec: 15 }], 2: [{ item: 'video', sec: null }] }, false, '休み', { 1: '', 2: 'お昼' }]), '残る');
      rm2.close();
    } finally { await b.close(); db.close(); try { fs.unlinkSync(file); } catch (e) {} }
  });

  // ---- 拡張機能の決まり（logic.js）----
  const ITEMS = [
    { id: 'fes', kind: 'fes', sound: true, tvs: [1, 2] }, { id: 'menu', kind: 'images', sound: false, tvs: [1, 2] },
    { id: 'asobi', kind: 'asobi', sound: true, tvs: [1, 2] }, { id: 'video', kind: 'video', sound: false, tvs: [1, 2] },
    { id: 'rest', kind: 'rest', sound: false, tvs: [1, 2] }];
  const 鳴る = (active, items) => {
    const out = [];
    [1, 2].forEach((w) => (items || ITEMS).forEach((it) => { if (!Logic.muted(w, it.id, active, items || ITEMS)) out.push(w + ':' + it.id); }));
    return out.join(',');
  };

  await r.test('門3：見えていないタブは鳴らない。あそびまちは見えていなくても、TV② の窓の1つだけが鳴る（2回鳴らない）', async () => {
    assertEqual(鳴る({ 1: 'fes', 2: 'menu' }), '1:fes,2:asobi', 'TV① あつまれ（鳴る）・あそびまちは裏でも TV② の1つだけ');
    assertEqual(鳴る({ 1: 'menu', 2: 'rest' }), '2:asobi', 'あつまれが裏 → あつまれは鳴らない');
    assertEqual(鳴る({ 1: 'asobi', 2: 'asobi' }), '2:asobi', '両方の TV にあそびまち → 鳴るのは1つだけ');
    assertEqual(鳴る({ 1: 'fes', 2: 'fes' }), '1:fes,2:asobi', '両方の TV にあつまれ → TV① の1つだけ（2つ目の TV は鳴らさない）');
    assertEqual(鳴る({ 1: 'video', 2: 'fes' }), '2:asobi', '動画の音ははじめ「切」');
    const 音入 = ITEMS.map((it) => (it.id === 'video' ? Object.assign({}, it, { sound: true }) : it));
    assertEqual(鳴る({ 1: 'video', 2: 'video' }, 音入), '1:video,2:asobi', '動画の音を入にすると、TV① の動画だけ鳴る');
    assertEqual(鳴る({ 1: 'rest', 2: 'video' }, 音入), '2:asobi', 'TV② の画面の物で鳴らすのは、あそびまちのチャイムだけ（くまくんの決め）');
    const 左だけ = ITEMS.map((it) => (it.id === 'asobi' ? Object.assign({}, it, { tvs: [1] }) : it));
    assertEqual(鳴る({ 1: 'menu', 2: 'menu' }, 左だけ), '1:asobi', 'あそびまちを TV① にしか出さない時は、TV① の窓の1つが鳴る');
    for (const a1 of ITEMS) for (const a2 of ITEMS) {
      const n = 鳴る({ 1: a1.id, 2: a2.id }).split(',').filter((x) => /asobi/.test(x)).length;
      assertEqual(n, 1, 'どの組み合わせでも、あそびまちが鳴るタブはちょうど1つ（' + a1.id + '/' + a2.id + '）');
    }
  });

  await r.test('2-3 案3・門6：どちらの窓も、全部の物を同じ並びで開く（1 あつまれ・2 メニュー・3 あそびまち・4 動画・5 休けい）。休けいは TV ごと', async () => {
    const p1 = Logic.plan(ITEMS, 1, 'https://s.example/', '', 'chrome-extension://x/');
    const p2 = Logic.plan(ITEMS, 2, 'https://s.example/', '', 'chrome-extension://x/');
    assertEqual(p1.map((p) => p.id).join(','), 'fes,menu,asobi,video,rest', 'TV① の並び');
    assertEqual(p2.map((p) => p.id).join(','), p1.map((p) => p.id).join(','), 'TV② も同じ並び');
    assertEqual(p1[0].url, 'https://s.example/fes?tv=1', 'あつまれは TV として入る');
    assertEqual(p1[4].url + ' ' + p2[4].url, 'https://s.example/tvs/screen?tv=1 https://s.example/tvs/screen?tv=2', '休けいは TV ごと');
    assertEqual(p1[2].url, 'chrome-extension://x/wait.html', 'あそびまちの URL がまだ無い時は「準備中です」の画面');
    assertEqual(Logic.plan(ITEMS, 1, 'https://s', SECRET, 'e/')[2].url, SECRET, 'URL が届いたらそこへ');
  });

  await r.test('「はじめる」の画面えらび：左から TV①・TV②。3つ以上なら「はじめる」を押した画面をのぞく。1つなら左右に分ける', async () => {
    const d = (id, left) => ({ id, bounds: { left, top: 0, width: 1920, height: 1080 } });
    const two = Logic.pickDisplays([d('R', 1920), d('L', 0)], 'L');
    assertEqual(two[1].bounds.left + '/' + two[2].bounds.left + '/' + two[1].full, '0/1920/true', '2つ：左が TV①（全画面）');
    const three = Logic.pickDisplays([d('pc', 0), d('a', 1920), d('b', 3840)], 'pc');
    assertEqual(three[1].bounds.left + '/' + three[2].bounds.left, '1920/3840', '3つ：PC の画面をのぞいた左右');
    const one = Logic.pickDisplays([d('only', 0)], 'only');
    assertEqual(one[1].bounds.width + '/' + one[2].bounds.left + '/' + one[1].full, '960/960/false', '1つ：左右に分ける（全画面にしない）');
  });

  // ===================== 指示75 束3（11/7 の本物の TV で見つけた直し）=====================
  await r.test('指示75 3-4：画面が3つ以上の時は、主の画面（ノート PC）をのぞく。「はじめる」の画面が TV の上に開いていても、まちがえない', async () => {
    const d = (id, left, primary) => ({ id, isPrimary: !!primary, bounds: { left, top: 0, width: 1920, height: 1080 } });
    const ds = [d('sony', 0), d('dell', 1920), d('pc', 3840, true)];
    const onTv = Logic.pickDisplays(ds, 'sony');   // 「はじめる」の画面が SONY の上に開いた（A29 (a)）
    assertEqual(onTv[1].bounds.left + '/' + onTv[2].bounds.left, '0/1920', 'TV① は SONY・TV② は DELL（ノート PC はのぞく）');
    const onPc = Logic.pickDisplays(ds, 'pc');
    assertEqual(onPc[1].bounds.left + '/' + onPc[2].bounds.left, '0/1920', 'PC の上で押しても同じ');
    const noPrimary = Logic.pickDisplays([d('a', 0), d('b', 1920), d('c', 3840)], 'c');
    assertEqual(noPrimary[1].bounds.left + '/' + noPrimary[2].bounds.left, '0/1920', '主の画面が分からない時は、今までどおり押した画面をのぞく');
    assertEqual(Logic.homeDisplay(ds).id, 'pc', '「はじめる」の画面を置く所は、主の画面');
  });

  await r.test('指示75 3-7：左右の名前。TV① が左なら「左」。入れかえたら名前も入れかわる', async () => {
    const L = { bounds: { left: 0, top: 0, width: 1920, height: 1080 } }, R = { bounds: { left: 1920, top: 0, width: 1920, height: 1080 } };
    assertEqual(Logic.sideOf({ 1: L, 2: R }, 1) + '/' + Logic.sideOf({ 1: L, 2: R }, 2), 'left/right', 'ふつう');
    assertEqual(Logic.sideOf({ 1: R, 2: L, swapped: true }, 1) + '/' + Logic.sideOf({ 1: R, 2: L, swapped: true }, 2), 'right/left', '入れかえたら逆');
    assertEqual(Logic.sideOf(null, 1), null, '置き場所が分からない時は出さない');
  });

  await r.test('指示75 3-1：読み込んでから20秒・あそびまちの準備の間・「はじめる」から20秒の音は、呼び出しに数えない', async () => {
    const t = 100000;
    assertEqual(Logic.chimeCounts({ now: t, loadedAt: t - 5000 }), false, '読み込んで5秒（「押すと始まります」の音）');
    assertEqual(Logic.chimeCounts({ now: t, loadedAt: t - 19000 }), false, '19秒');
    assertEqual(Logic.chimeCounts({ now: t, loadedAt: t - 21000 }), true, '21秒たったら数える');
    assertEqual(Logic.chimeCounts({ now: t, loadedAt: t - 60000, guide: true }), false, 'あそびまちの準備の間');
    assertEqual(Logic.chimeCounts({ now: t, loadedAt: t - 60000, startedAt: t - 3000 }), false, '「はじめる」の直後');
    assertEqual(Logic.chimeCounts({ now: t, loadedAt: t - 60000, chimeAt: t - 5000 }), false, '10秒に1回まで');
    assertEqual(Logic.chimeCounts({ now: t, loadedAt: t - 60000, chimeAt: t - 11000 }), true, '11秒前なら数える');
  });

  await r.test('指示75 3-2：置き直しの決め。もう正しい画面で全画面なら何もしない（窓を一瞬ふつうにしない）。同じ画面でふつうなら全画面だけ。別の画面なら動かす', async () => {
    const p = { bounds: { left: 1920, top: 0, width: 1920, height: 1080 }, full: true };
    assertEqual(Logic.placeStep({ state: 'fullscreen', left: 1920, top: 0, width: 1920, height: 1080 }, p), 'none', '正しい所で全画面');
    assertEqual(Logic.placeStep({ state: 'normal', left: 2000, top: 40, width: 1200, height: 800 }, p), 'full', '同じ画面で全画面が外れた（Esc・F11）：全画面にもどすだけ');
    assertEqual(Logic.placeStep({ state: 'maximized', left: 1912, top: -8, width: 1936, height: 1096 }, p), 'full', '同じ画面で最大化');
    assertEqual(Logic.placeStep({ state: 'fullscreen', left: 0, top: 0, width: 1920, height: 1080 }, p), 'move', '別の画面へ動いていた（TV の電源・入力の切りかえ）');
    assertEqual(Logic.placeStep({ state: 'normal', left: 0, top: 0, width: 800, height: 600 }, Object.assign({}, p, { full: false })), 'move', '全画面にしない置き方（画面が1つ）は大きさを合わせる');
  });

  await r.test('指示75 3-8：TV 専用の印のページ（/tvs/mark）はログイン無しで開ける。字だけ（スクリプト・あそびまちの事は出さない）', async () => {
    const srv = await startTestServer();
    try {
      const res = await fetch(srv.url + '/tvs/mark');
      const t = await res.text();
      assertEqual(res.status, 200, 'ログイン無しで開ける');
      assert(/TV 専用/.test(t), '字');
      assert(t.indexOf('<script') === -1 && !/asobi|あそびまち|key/i.test(t), 'スクリプトも、あそびまちの事も無い');
      const m = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'tv-switcher', 'extension', 'manifest.json'), 'utf8'));
      assert(m.content_scripts.some((c) => c.js.indexOf('tv-mark.js') !== -1 && c.matches.every((u) => /\/tvs\/mark\*$/.test(u))), '拡張機能の tv-mark.js は /tvs/mark だけで動く');
      const cmd = require('fs').readFileSync(require('path').join(__dirname, '..', 'tv-switcher', 'TVを開く.cmd'), 'utf8');
      assert(/\/tvs\/mark"/.test(cmd), 'TVを開く.cmd は /tvs/mark を開く');
    } finally { await srv.close(); }
  });

  await r.test('指示75 3-7：休けいのタブが左右を教えると、リモコンの状態に入る（リモコンは「TV①（左）」と出す）', async () => {
    const srv = await startTestServer();
    try {
      const staff = await login(srv.url, STAFF);
      const s1 = await screen(srv.url, staff, 1);
      const rm = await dev(srv.url, staff, { as: 'remote' });
      s1.socket.emit('tvs:pong', { ext: true, side: 'right' });
      await until(() => rm.state && rm.state.tvs[1].side === 'right', '右が届く');
      s1.socket.emit('tvs:pong', { ext: true, side: 'up' });
      await sleep(100);
      assertEqual(rm.state.tvs[1].side, 'right', '左右のほかの字は受けとらない');
      const html = require('fs').readFileSync(require('path').join(__dirname, '..', 'tv-switcher', 'pages', 'remote.html'), 'utf8');
      assert(/SIDE\s*=\s*\{\s*left:\s*'左'/.test(html) && /tvLabel\(/.test(html), 'リモコンは左右の名前を TV の名前に付ける（tvLabel）');
      [s1, rm].forEach((d) => d.close());
    } finally { await srv.close(); }
  });

  // 指示75 2-10（くまくんの決め）：切りかえの記録の全部に、検索としぼり込み（だれが・何を・TV・時刻）。係だけ
  await r.test('指示75 2-10：切りかえの記録（/tvs/log）は係だけ。字で検索・TV でしぼれる', async () => {
    const srv = await startTestServer();
    try {
      const staff = await login(srv.url, STAFF), nobody = await login(srv.url, NOBODY);
      assertEqual((await fetch(srv.url + '/tvs/log')).status, 401, 'ログイン無し');
      assertEqual((await fetch(srv.url + '/tvs/log', { headers: { cookie: nobody } })).status, 403, '係でない');
      const s1 = await screen(srv.url, staff, 1), s2 = await screen(srv.url, staff, 2);
      const rm = await dev(srv.url, staff, { as: 'remote' });
      await rm.call('tvs:show', { tv: 1, item: 'menu' });
      await rm.call('tvs:show', { tv: 2, item: 'rest' });
      const get = async (q) => { const res = await fetch(srv.url + '/tvs/log' + q, { headers: { cookie: staff } }); return { s: res.status, t: await res.text() }; };
      const all = await get('');
      assertEqual(all.s, 200, '係は見られる');
      assert(/メニュー/.test(all.t) && /休けい/.test(all.t), '名前で出る');
      const one = await get('?kind=2');
      assert(/休けい/.test(one.t) && !/<td>メニュー<\/td>/.test(one.t), 'TV②だけ');
      const q = await get('?q=' + encodeURIComponent('メニュー'));
      assert(/<td>メニュー<\/td>/.test(q.t) && !/<td>休けい<\/td>/.test(q.t), '字で検索');
      [s1, s2, rm].forEach((d) => d.close());
    } finally { await srv.close(); }
  });

  await r.test('門10：このスイートで出たログに、あそびまちの key が1度も無い', async () => {
    assert(出た.length >= 0, '');
    assert(!出た.some((s) => s.indexOf('TVS-SECRET') !== -1), 'ログに key が出た：' + 出た.filter((s) => s.indexOf('TVS-SECRET') !== -1)[0]);
  });

  r.finish();
  process.exit(0);
})();
