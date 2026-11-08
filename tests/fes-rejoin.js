// tests/fes-rejoin.js — 文化祭の部屋（/fes）で「途中で抜けて戻る」を本物のサーバーで確かめる（2026-10-29 くまくんの調べもの）
//
// **いまの動きを記録する検査**（直すかは結果を見て決める・コードは直していない）。
// 「本番で困る」と書いた所は、いまの動きをそのまま確かめている——直したら、その行を新しい決まりに書き換える。
// 調べた結果の文書：docs/監査_文化祭の抜けて戻る.md
//
// 1 memberId を持たずに同じ名前で入り直す（ちがうブラウザ）
// 2 準備OK の間に切れて戻る
// 3 抜けている間の点と、結果の画面
// 4 同じ memberId で2本つなぐ（タブ2つ）
// 5 ゲームの途中で戻る：今の場面と自分の秘密がすぐ届くか（クイズ解除・みんなと同じ・ぴったり10秒・そろえて発射）
// 6 サーバーを作り直す（再起動）：部屋・係・/fes がどうなるか
'use strict';

const http = require('http');
const express = require('express');
const session = require('express-session');
const Database = require('better-sqlite3');
const { io: ioClient } = require('socket.io-client');

const { createRunner, assert, assertEqual } = require('./harness');
const { attachRealtime, RoomStore } = require('../realtime');
const { createFesStore } = require('../fes-store');
const { mountFesRoutes } = require('../fes-routes');
const FesRoom = require('../fes-room');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OWNER = 900, STAFF = 901;
// 準備OK は全員そろうと のこり3秒（readyAllMs）。ここでは押さない人がいる検査もあるので短め
const T = { lobbyMs: 300, idleMs: 600, voteMs: 400, decideMs: 100, readyMs: 1500, resultMs: 300, endGraceMs: 100 };

function startTestServer(times) {
  const app = express();
  const sessionMiddleware = session({ secret: 'test-fes-rejoin', resave: false, saveUninitialized: false,
    cookie: { httpOnly: true, secure: false, sameSite: 'lax' } });
  app.use(express.json());
  app.use(sessionMiddleware);
  app.post('/test-login', (req, res) => { req.session.userId = req.body.userId; res.json({ ok: true }); });
  const httpServer = http.createServer(app);
  const store = new RoomStore();
  const fesStore = createFesStore(new Database(':memory:'));
  const io = attachRealtime(httpServer, sessionMiddleware, {
    store, db: null, describe: async () => ({ description: 'x' }), countdownMs: 0, fesStore, fesTimes: times || T,
    fesRole: (uid) => (uid === OWNER ? 'owner' : uid === STAFF ? 'staff' : null)
  });
  mountFesRoutes(app, io);
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
function device(url, cookie) {
  return new Promise((resolve, reject) => {
    const opts = { transports: ['polling'], forceNew: true, reconnection: false };
    if (cookie) opts.extraHeaders = { Cookie: cookie };
    const s = ioClient(url, opts);
    const d = { socket: s, room: null, me: null, wolf: null, wolfAt: 0, roomAt: 0,
      call(ev, p) { return new Promise((res) => { const t = setTimeout(() => res({ ok: false, error: 'timeout' }), 6000);
        s.emit(ev, p || {}, (r) => { clearTimeout(t); res(r || {}); }); }); },
      close() { s.close(); } };
    s.on('room:update', (r) => { d.room = r; d.roomAt = Date.now(); });
    s.on('fes:you', (p) => { d.me = p; });
    s.on('wolf:you', (p) => { d.wolf = p; d.wolfAt = Date.now(); });
    s.on('hb:ping', () => s.emit('hb:pong'));
    s.on('connect', () => resolve(d));
    s.on('connect_error', reject);
  });
}
async function waitUntil(fn, label, ms) {
  const limit = Date.now() + (ms || 5000);
  while (Date.now() < limit) { if (fn()) return true; await sleep(25); }
  throw new Error('条件が満たされませんでした: ' + label);
}
const fesOf = (d) => (d.room && d.room.fes) || {};

/** 係が部屋を作る。games：候補にするゲーム（1つなら投票を飛ばして決定へ） */
async function makeFes(srv, modes) {
  const staff = await device(srv.url, await login(srv.url, STAFF));
  const c = await staff.call('fes:create', {});
  assertEqual(c.ok, true, '係は文化祭の部屋を作れる');
  srv.store.get(c.code).fes.games = FesRoom.FES_GAMES.filter((g) => modes.indexOf(g.mode) !== -1)
    .map((g) => Object.assign({}, g, { on: true, testing: false }));
  return { staff, code: c.code };
}
async function join(srv, code, name, extra) {
  const d = await device(srv.url);
  const r = await d.call('room:join', Object.assign({ code, name, diff: 'normal' }, extra || {}));
  d.res = r; d.memberId = r.memberId; d.code = code;
  if (r.ok) await waitUntil(() => d.room && d.me, '入った知らせが届く');
  return d;
}
/** 全員が準備OK を押して、ゲームが始まるまで */
async function playAll(ds, srv, code) {
  await waitUntil(() => fesOf(ds[0]).phase === 'ready', 'ルールと準備OKへ');
  const game = srv.store.get(code).state.game;
  for (const d of ds) await d.call('room:ready', { game });
  await waitUntil(() => fesOf(ds[0]).phase === 'play', '始まる', 6000);
  return game;
}
const memberOf = (srv, code, id) => srv.store.get(code).members.get(id);

(async function main() {
  const r = createRunner('fes-rejoin：文化祭の部屋で 途中で抜けて戻る（2026-10-29 の調べもの）');

  await r.test('1：memberId なしで同じ名前で入り直す（待合）→ いまは「ふう②」という別人になる。元の「ふう」は切れたまま名簿に残る', async () => {
    const srv = await startTestServer(Object.assign({}, T, { lobbyMs: 60000 }));
    const { staff, code } = await makeFes(srv, ['pittari']);
    const a = await join(srv, code, 'ふう');
    const b = await join(srv, code, 'ひろ');
    a.close();
    await waitUntil(() => !memberOf(srv, code, a.memberId).connected, 'ふうが切れる');
    const a2 = await join(srv, code, 'ふう');      // ちがうブラウザ：memberId を持っていない
    assertEqual(a2.res.ok, true, '入れる');
    assert(a2.memberId !== a.memberId, '【本番で困る】別の memberId（別人）になる');
    assertEqual(memberOf(srv, code, a2.memberId).name, 'ふう②', '【本番で困る】名前は「ふう②」（同じ名前の確かめが、切れた枠を引き継ぐより先にある）');
    assertEqual(memberOf(srv, code, a.memberId).connected, false, '元の「ふう」は切れたまま名簿に残る');
    // ふだんの部屋（文化祭でない）は、切れた同名の枠を引き継ぐ（第24弾-3）。文化祭だけ道がちがう
    [staff, a2, b].forEach((d) => d.close());
    await srv.close();
  });

  await r.test('1・3：遊んでいる途中に memberId なしで入り直す → 「ふう②」は今回に入れず（待つ）、元の「ふう」の点は結果に残る', async () => {
    const srv = await startTestServer();
    const { staff, code } = await makeFes(srv, ['pittari']);
    const a = await join(srv, code, 'ふう');
    const b = await join(srv, code, 'ひろ');
    const c = await join(srv, code, 'びび');
    await playAll([a, b, c], srv, code);
    const w = srv.store.get(code).pittari;
    // 1回目：3人とも目標ちょうどで止める（点が入る）
    await waitUntil(() => w.phase === 'run', 'スタート');
    const t = w.rounds[w.round].target * 1000;
    for (const d of [a, b, c]) await d.call('wolf:act', { ms: t });
    await waitUntil(() => w.history.length === 1, '1回目が開く');
    const ふうの点 = w.history[0].rows.find((x) => x.id === a.memberId);
    a.close();
    await waitUntil(() => !memberOf(srv, code, a.memberId).connected, 'ふうが切れる');
    const a2 = await join(srv, code, 'ふう');
    assertEqual(memberOf(srv, code, a2.memberId).name, 'ふう②', '別人「ふう②」');
    assertEqual(memberOf(srv, code, a2.memberId).role, 'waiting', 'ゲームの最中に入った人は今回は待つ');
    assertEqual(a2.me && a2.me.bench, 'late', '理由は「おくれて来た」');
    // 残りの回は締め切りで進める（ふうはもう押せない）
    while (w.phase !== 'ended') { w.deadline = Date.now() - 1; await sleep(80); }
    const res = srv.store.get(code).pittari && require('../pittari-room').resultView(srv.store.get(code));
    const row = res.ranking.find((x) => x.id === a.memberId);
    assert(row, '【結果】切れた元の「ふう」も結果の順位に入っている（名簿に残っているので）');
    assert(ふうの点 && row.score >= 0, '元の「ふう」の点は、切れる前の回の分が残る（' + JSON.stringify(row) + '）');
    assert(!res.ranking.find((x) => x.id === a2.memberId), '「ふう②」は結果に入らない（今回は遊んでいない）');
    [staff, a2, b, c].forEach((d) => d.close());
    await srv.close();
  });

  await r.test('2：準備OK の間に切れて、締め切りの前に同じ memberId で戻る → 押し直せば今回に入れる', async () => {
    const srv = await startTestServer(Object.assign({}, T, { readyMs: 4000 }));
    const { staff, code } = await makeFes(srv, ['pittari']);
    const a = await join(srv, code, 'ふう');
    const b = await join(srv, code, 'ひろ');
    const c = await join(srv, code, 'びび');
    await waitUntil(() => fesOf(a).phase === 'ready', 'ルールと準備OKへ');
    await a.call('room:ready', { game: 'pittari' });
    c.close();
    await waitUntil(() => !memberOf(srv, code, c.memberId).connected, 'びびが切れる');
    const c2 = await join(srv, code, 'びび', { memberId: c.memberId });
    assertEqual(c2.memberId, c.memberId, '同じ人として戻る');
    assertEqual(memberOf(srv, code, c.memberId).readyGame, null, '切れる前に押していなければ、押していないまま');
    await c2.call('room:ready', { game: 'pittari' });
    await b.call('room:ready', { game: 'pittari' });
    await waitUntil(() => fesOf(a).phase === 'play', '始まる', 6000);
    assert(srv.store.get(code).pittari.playerIds.indexOf(c.memberId) !== -1, '戻った人も今回に入る');
    [staff, a, b, c2].forEach((d) => d.close());
    await srv.close();
  });

  // 指示75 1-3（A04・11/7 の検査）：回線の切りかえ（4G⇔5G）で一瞬切れた人が、次のゲームに入れなかった。
  // 席の取っておき（holdMs 30秒）の間の人は、押した準備OK のまま今回に入る（それまでは「つながっている人だけ」で、切れていた人は外れた）
  await r.test('2（指示75 1-3）：準備OK を押したあとで切れて、締め切りをまたいで戻った人 → 席の取っておき（30秒）の間なら今回に入る', async () => {
    const srv = await startTestServer(Object.assign({}, T, { readyMs: 2500 }));
    const { staff, code } = await makeFes(srv, ['pittari']);
    const a = await join(srv, code, 'ふう');
    const b = await join(srv, code, 'ひろ');
    const c = await join(srv, code, 'びび');
    await waitUntil(() => fesOf(a).phase === 'ready', 'ルールと準備OKへ');
    for (const d of [a, b, c]) await d.call('room:ready', { game: 'pittari' });
    c.close();                                     // 押したあと、のこり3秒の間に切れた（回線の切りかえ）
    await waitUntil(() => !memberOf(srv, code, c.memberId).connected, 'びびが切れる');
    await waitUntil(() => fesOf(a).phase === 'play', '始まる', 6000);
    assert(srv.store.get(code).pittari.playerIds.indexOf(c.memberId) !== -1, '席を取っておいている人は、押した準備OK のまま今回に入る');
    assertEqual(memberOf(srv, code, c.memberId).role, 'player', '遊ぶ人のまま');
    // socket.io のつなぎ直し（自動の入り直し・memberId つき）で戻る
    const c2 = await join(srv, code, 'びび', { memberId: c.memberId, auto: true });
    assertEqual(c2.res.ok, true, '戻れる');
    assertEqual(memberOf(srv, code, c.memberId).role, 'player', '戻っても遊ぶ人');
    assertEqual(c2.me && c2.me.bench, null, '「TV を見ていてね」にならない');
    assertEqual(c2.me && c2.me.playing, true, 'いまのゲームの中');
    [staff, a, b, c2].forEach((d) => d.close());
    await srv.close();
  });

  await r.test('2（指示75 1-3）：押したあと切れたまま、席の取っておき（30秒）をすぎた人は、今回に入れない（来ない人で始めない）', async () => {
    const srv = await startTestServer(Object.assign({}, T, { readyMs: 2500, holdMs: 300 }));
    const { staff, code } = await makeFes(srv, ['pittari']);
    const a = await join(srv, code, 'ふう');
    const b = await join(srv, code, 'ひろ');
    const c = await join(srv, code, 'びび');
    await waitUntil(() => fesOf(a).phase === 'ready', 'ルールと準備OKへ');
    for (const d of [a, b, c]) await d.call('room:ready', { game: 'pittari' });
    c.close();
    await waitUntil(() => fesOf(a).phase === 'play', '始まる', 6000);
    assert(srv.store.get(code).pittari.playerIds.indexOf(c.memberId) === -1, '取っておく時間をすぎた人は今回に入らない');
    [staff, a, b].forEach((d) => d.close());
    await srv.close();
  });

  // 指示75 1-3 の門：「10秒切れる→もどる→次の回に入る」。どの段階で切れても、もどったあとの次の回に入れる
  for (const at of ['lobby', 'vote', 'decide', 'ready', 'play', 'result']) {
    await r.test('指示75 1-3：' + at + ' の間に10秒切れて（socket が切れる）、自動の入り直しでもどる → 次の回に入れる', async () => {
      const srv = await startTestServer(Object.assign({}, T, { lobbyMs: 600, readyMs: 1500, resultMs: 800 }));
      // 候補を2つにして、投票の段階も通る（全員がぴったり10秒に入れる）
      const { staff, code } = await makeFes(srv, ['pittari', 'soroe']);
      const a = await join(srv, code, 'ふう');
      const b = await join(srv, code, 'ひろ');
      let c = await join(srv, code, 'びび');
      const id = c.memberId;
      const room = srv.store.get(code);
      const ds = () => [a, b, c].filter((d) => d.socket.connected);
      // 段階を進める：投票はぴったり10秒に入れる・遊んでいる回は締め切りで進める
      async function step(press) {
        const f = room.fes;
        if (f.phase === 'vote') for (const d of ds()) await d.call('fes:vote', { mode: 'pittari' });
        if (f.phase === 'ready' && press) for (const d of ds()) await d.call('room:ready', { game: room.state.game });
        if (f.phase === 'play' && room.pittari && room.pittari.phase !== 'ended') room.pittari.deadline = Date.now() - 1;
        await sleep(60);
      }
      const until = async (fn, label, press) => { const lim = Date.now() + 15000; while (!fn() && Date.now() < lim) await step(press); assert(fn(), label); };
      await until(() => room.fes.phase === at, at + ' に来る', true);
      c.close();
      await waitUntil(() => !room.members.get(id).connected, '切れる');
      // 「10秒」：席の取っておき（30秒）より短い。ここでは、切れている間に段階が1つ以上進むまで待つ
      await until(() => room.fes.phase !== at, '切れている間に段階が進む', false);
      c = await join(srv, code, 'びび', { memberId: id, auto: true });
      assertEqual(c.res.ok, true, 'もどれる（' + c.res.error + '）');
      assertEqual(c.memberId, id, '同じ人');
      // もどったあとの、次の準備OK まで進めて、全員で押す
      await until(() => room.fes.phase === 'ready', 'もどったあとの準備OK に来る', false);
      for (const d of [a, b, c]) await d.call('room:ready', { game: room.state.game });
      await until(() => room.fes.phase === 'play', '始まる', false);
      assert(room.pittari.playerIds.indexOf(id) !== -1, '次の回に入る（' + at + ' で切れた人）');
      assertEqual(c.me && c.me.bench, null, '「TV を見ていてね」にならない');
      [staff, a, b, c].forEach((d) => d.close());
      await srv.close();
    });
  }

  // 指示75 1-4（A15）：「入る」のあと同じタブで読み込み直すと、同じ人が2人（約2分＝帰った人を外す時間 goneMs で1人にもどる）。
  // 読み込み直しが「入る」の返事より先だと、端末はまだ memberId を覚えていない → 新しい人として入り、前の席が2分残る。
  // 直す形：端末の札（dev・その端末のブラウザに1つ）を入る時に添え、同じ端末なら前の席にもどる
  await r.test('指示75 1-4：入る→0〜1000ms のどこかで読み込み直す（同じ端末・memberId はまだ覚えていないことがある）を20回 → いつも1人', async () => {
    // 前の回の人の席（取っておき）で16人の門がふさがらないよう、取っておきだけ短く
    const srv = await startTestServer(Object.assign({}, T, { lobbyMs: 600000, holdMs: 50 }));
    const { staff, code } = await makeFes(srv, ['pittari']);
    const b = await join(srv, code, 'ひろ');
    const room = srv.store.get(code);
    const 数 = (name) => Array.from(room.members.values()).filter((m) => m.name.replace(/[②-⑨]$/, '') === name).length;
    for (let i = 0; i < 20; i++) {
      const dev = 'dev-reload-' + i, name = 'よみ' + i;
      const wait = Math.round(i * 1000 / 19);
      const d1 = await device(srv.url);
      let got = null;
      d1.socket.emit('room:join', { code, name, diff: 'normal', dev }, (res) => { got = res; });
      await sleep(wait);
      const saved = got && got.ok ? got.memberId : null;   // 返事が来ていれば、端末は memberId を覚えている
      d1.socket.close();                                     // 読み込み直し
      const d2 = await device(srv.url);
      const r2 = await d2.call('room:join', Object.assign({ code, name, diff: 'normal', dev }, saved ? { memberId: saved } : {}));
      assertEqual(r2.ok, true, i + '回目：入れる');
      await sleep(30);
      assertEqual(数(name), 1, i + '回目（' + wait + 'ms で読み込み直し・memberId ' + (saved ? 'あり' : 'なし') + '）：名簿は1人');
      d2.close();
    }
    [staff, b].forEach((d) => d.close());
    await srv.close();
  });

  await r.test('指示75 1-4：ちがう端末で同じ名前は、いままでどおり別の人（「ふう②」）', async () => {
    const srv = await startTestServer(Object.assign({}, T, { lobbyMs: 600000 }));
    const { staff, code } = await makeFes(srv, ['pittari']);
    const a = await join(srv, code, 'ふう', { dev: 'dev-A' });
    const a2 = await join(srv, code, 'ふう', { dev: 'dev-B' });
    assert(a2.memberId !== a.memberId, '別の人');
    assertEqual(memberOf(srv, code, a2.memberId).name, 'ふう②', '名前は「ふう②」');
    assert(!JSON.stringify(a.room).includes('dev-A'), '端末の札は部屋の知らせに出ない（みんなに配らない）');
    [staff, a, a2].forEach((d) => d.close());
    await srv.close();
  });

  // 指示75 1-6（くまくんの決め 7.A）：係の「外す」。ふつうに押す＝今のまま（すぐ入れる）。長押し＝30秒・1分・5分 入れない（同じ端末と同じ名前）
  await r.test('指示75 1-6：ふつうの「外す」は今のまま（すぐ入り直せる）', async () => {
    const srv = await startTestServer(Object.assign({}, T, { lobbyMs: 600000 }));
    const { staff, code } = await makeFes(srv, ['pittari']);
    const a = await join(srv, code, 'ふう', { dev: 'dev-K' });
    let kicked = null; a.socket.on('room:kicked', (p) => { kicked = p; });
    const k = await staff.call('fes:kick', { code, memberId: a.memberId });
    assertEqual(k.ok, true, '外せる');
    await waitUntil(() => kicked, '外された知らせ');
    assertEqual(kicked.reason, 'fes_staff', '理由は今のまま');
    const a2 = await join(srv, code, 'ふう', { dev: 'dev-K' });
    assertEqual(a2.res.ok, true, 'すぐ入り直せる');
    [staff, a, a2].forEach((d) => d.close());
    await srv.close();
  });

  await r.test('指示75 1-6：長押しの「外す」（30秒）→ 同じ端末も同じ名前も、30秒は入れない。すぎたら入れる。ほかの人は入れる', async () => {
    const srv = await startTestServer(Object.assign({}, T, { lobbyMs: 600000 }));
    const { staff, code } = await makeFes(srv, ['pittari']);
    const a = await join(srv, code, 'ふう', { dev: 'dev-K' });
    let kicked = null; a.socket.on('room:kicked', (p) => { kicked = p; });
    const bad = await staff.call('fes:kick', { code, memberId: a.memberId, waitMs: 12345 });
    assertEqual(bad.ok, false, '決めた3つ（30秒・1分・5分）のほかは断る');
    const k = await staff.call('fes:kick', { code, memberId: a.memberId, waitMs: 30000 });
    assertEqual(k.ok, true, '外せる');
    await waitUntil(() => kicked, '外された知らせ');
    assertEqual(kicked.reason, 'fes_wait', '理由は「しばらく入れない」');
    assert(kicked.waitMs > 29000 && kicked.waitMs <= 30000, 'のこりの時間が届く（' + kicked.waitMs + '）');
    const s1 = await join(srv, code, 'ふう', { dev: 'dev-K' });
    assertEqual(s1.res.error, 'fes_wait', '同じ端末・同じ名前は入れない');
    assert(s1.res.waitMs > 0, 'のこりの時間が返る');
    const s2 = await join(srv, code, 'べつ', { dev: 'dev-K' });
    assertEqual(s2.res.error, 'fes_wait', '同じ端末で名前を変えても入れない');
    const s3 = await join(srv, code, 'ふう', { dev: 'dev-OTHER' });
    assertEqual(s3.res.error, 'fes_wait', 'ちがう端末でも同じ名前は入れない');
    const s4 = await join(srv, code, 'ひろ', { dev: 'dev-H' });
    assertEqual(s4.res.ok, true, 'ほかの人は入れる');
    // 30秒すぎた（時計は待たずに、入れない時間の終わりを前へずらす）
    srv.store.get(code).fes.waits.forEach((w) => { w.until = Date.now() - 1; });
    const s5 = await join(srv, code, 'ふう', { dev: 'dev-K' });
    assertEqual(s5.res.ok, true, 'すぎたら入れる');
    [staff, a, s1, s2, s3, s4, s5].forEach((d) => d.close());
    await srv.close();
  });

  await r.test('2：締め切りのあとに戻った人（押していない）は、今回に入れず「押さなかった」（つぎの回から入れます）。切れていた間は、席を空ける数（2回）に数えない', async () => {
    const srv = await startTestServer(Object.assign({}, T, { readyMs: 1500 }));
    const { staff, code } = await makeFes(srv, ['pittari']);
    const a = await join(srv, code, 'ふう');
    const b = await join(srv, code, 'ひろ');
    const c = await join(srv, code, 'びび');
    await waitUntil(() => fesOf(a).phase === 'ready', 'ルールと準備OKへ');
    c.close();
    await a.call('room:ready', { game: 'pittari' });
    await b.call('room:ready', { game: 'pittari' });
    await waitUntil(() => fesOf(a).phase === 'play', '始まる', 6000);
    const c2 = await join(srv, code, 'びび', { memberId: c.memberId });
    assertEqual(memberOf(srv, code, c.memberId).role, 'waiting', '今回は待つ');
    // 切れていた人は「押さなかった」に数えない（つながっている人だけ数える）
    assertEqual(memberOf(srv, code, c.memberId).fesMiss || 0, 0, '切れていた間の準備OK は「押さなかった」に数えない');
    assertEqual(c2.me && c2.me.bench, 'missed', '理由は「押さなかった」（つぎの回から入れます）');
    [staff, a, b, c2].forEach((d) => d.close());
    await srv.close();
  });

  await r.test('4：同じ memberId で2本つなぐ（タブ2つ）→ どちらからも押せるが、二重には入らない。秘密は あとからつないだ方にだけ届く', async () => {
    const srv = await startTestServer();
    const { staff, code } = await makeFes(srv, ['pittari']);
    const a = await join(srv, code, 'ふう');
    const b = await join(srv, code, 'ひろ');
    const a2 = await join(srv, code, 'ふう', { memberId: a.memberId });   // 同じ人の2つめのタブ
    assertEqual(a2.memberId, a.memberId, '同じ人');
    const live = Array.from(srv.store.get(code).members.values()).filter((m) => m.connected && m.role !== 'bigscreen');
    assertEqual(live.length, 2, '名簿は2人のまま（増えない）');
    await waitUntil(() => fesOf(a).phase === 'ready', 'ルールと準備OKへ');
    const r1 = await a.call('room:ready', { game: 'pittari' });
    const r2 = await a2.call('room:ready', { game: 'pittari' });
    assertEqual(r1.ok && r2.ok, true, '前のタブからも押せる（同じ人の印が付くだけ）');
    await b.call('room:ready', { game: 'pittari' });
    await waitUntil(() => fesOf(a).phase === 'play', '始まる', 6000);
    const w = srv.store.get(code).pittari;
    assertEqual(w.playerIds.filter((id) => id === a.memberId).length, 1, 'ゲームには1人として入る');
    await waitUntil(() => w.phase === 'run', 'スタート');
    const t = w.rounds[w.round].target * 1000;
    const p1 = await a.call('wolf:act', { ms: t });
    const p2 = await a2.call('wolf:act', { ms: t - 300 });
    assertEqual(p1.ok, true, '前のタブで押せる');
    assertEqual(p2.ok, false, 'もう一つのタブでは二重に押せない（' + p2.error + '）');
    await sleep(300);
    assert(a2.wolf, 'あとからつないだタブには本人の秘密が届く');
    assert(!a.wolf, '【本番で困る】前のタブには本人の秘密が届かない（押せるのに、自分の様子が変わらない）');
    a.close();                                    // 前のタブを閉じても
    await sleep(300);
    assertEqual(memberOf(srv, code, a.memberId).connected, true, '前のタブを閉じても、切れた扱いにならない');
    [staff, a2, b].forEach((d) => d.close());
    await srv.close();
  });

  // 指示75 2-9（くまくんの決め）：入退室の記録（係だけ・検索つき）。入った・出た・席を外した・もどった・外された（係・しばらく入れない・
  // しばらく押さなかった・帰った）・満員で断られた を、時刻と名前で残す。残す長さは名前の記録と同じ（1か月）
  await r.test('指示75 2-9：入退室の記録が残り、係の画面（/fes/presence）で名前の検索・種類でしぼれる。係でない人は見られない', async () => {
    const srv = await startTestServer(Object.assign({}, T, { lobbyMs: 600000 }));
    const { staff, code } = await makeFes(srv, ['pittari']);
    const a = await join(srv, code, 'あおい', { dev: 'dev-a' });
    const b = await join(srv, code, 'べに', { dev: 'dev-b' });
    a.close();
    await waitUntil(() => !memberOf(srv, code, a.memberId).connected, 'あおいが切れる');
    const a2 = await join(srv, code, 'あおい', { memberId: a.memberId, auto: true });
    await staff.call('fes:kick', { code, memberId: b.memberId });
    const b2 = await join(srv, code, 'べに', { dev: 'dev-b' });
    await staff.call('fes:kick', { code, memberId: b2.memberId, waitMs: 30000 });
    // 満員：16人まで入れて、17人目
    const 人 = [];
    for (let i = 0; i < 15; i++) 人.push(await join(srv, code, 'ひと' + i));
    const full = await join(srv, code, 'あふれ');
    assertEqual(full.res.error, 'room_full', '17人目は満員');
    await a2.call('room:leave', { code, memberId: a.memberId });
    await sleep(100);
    const rows = srv.io.fesStore.listPresence();
    const 種類 = (name) => rows.filter((x) => x.name === name).map((x) => x.kind).reverse().join(',');
    assertEqual(種類('あおい'), 'join,away,back,leave', 'あおい：入った・席を外した・もどった・出た');
    assertEqual(種類('べに'), 'join,kick,join,kick_wait', 'べに：入った・係が外した・入った・しばらく入れない');
    assertEqual(種類('あふれ'), 'full', '満員で断られた');
    assert(rows.every((x) => x.room === code && typeof x.at === 'number'), '部屋と時刻');
    // 係の画面
    const ck = await login(srv.url, STAFF);
    const page = async (q) => { const res = await fetch(srv.url + '/fes/presence' + q, { headers: { Cookie: ck } }); return { s: res.status, t: await res.text() }; };
    const all = await page('');
    assertEqual(all.s, 200, '係は見られる');
    assert(/あおい/.test(all.t) && /べに/.test(all.t) && /満員/.test(all.t), '一覧に出る');
    const q1 = await page('?q=' + encodeURIComponent('あお'));
    assert(/あおい/.test(q1.t) && !/べに/.test(q1.t), '名前で検索');
    const q2 = await page('?kind=kick_wait');
    assert(/べに/.test(q2.t) && !/あおい/.test(q2.t), '種類でしぼる');
    const x = await fetch(srv.url + '/fes/presence');
    assertEqual(x.status, 401, 'ログインしていない人は見られない');
    const other = await login(srv.url, 12345);
    const y = await fetch(srv.url + '/fes/presence', { headers: { Cookie: other } });
    assertEqual(y.status, 403, '係でない人は見られない');
    // 名前は字のまま（HTML として動かさない・落とし穴43）。入れ物に直に置いて見る（名前の決まりが < を通すかに頼らない）
    srv.io.fesStore.logPresence(code, '<b>x', 'join');
    const esc = await page('?q=' + encodeURIComponent('<b>'));
    assert(esc.t.indexOf('<b>x') === -1 && esc.t.indexOf('&lt;b&gt;x') !== -1, '名前は字のまま');
    [staff, a2, b, b2, full, ...人].forEach((d) => d.close());
    await srv.close();
  });

  await r.test('指示75 2-10：名前の記録（/fes/names）は字で検索・はじいたかでしぼれる。回ごとの記録（/fes/rounds）はゲームでしぼれる', async () => {
    const srv = await startTestServer(Object.assign({}, T, { lobbyMs: 600000 }));
    const { staff, code } = await makeFes(srv, ['pittari']);
    const a = await join(srv, code, 'みかん');
    const b = await join(srv, code, 'りんご');
    srv.io.fesStore.logName(code, 'わるいことば', true, 'blocked');
    srv.io.fesStore.recordRound({ room: code, round: 1, mode: 'soroe', players: 3, detail: { rounds: [] } });
    srv.io.fesStore.recordRound({ room: code, round: 2, mode: 'pittari', players: 3, detail: { rounds: [] } });
    const ck = await login(srv.url, OWNER);
    const get = async (p) => (await fetch(srv.url + p, { headers: { Cookie: ck } })).text();
    const n1 = await get('/fes/names?q=' + encodeURIComponent('みか'));
    assert(/みかん/.test(n1) && !/りんご/.test(n1), '名前：字で検索');
    const n2 = await get('/fes/names?kind=blocked');
    assert(/わるいことば/.test(n2) && !/<td>みかん<\/td>/.test(n2), '名前：はじいた名前だけ');
    const n3 = await get('/fes/names?only=blocked');
    assert(/わるいことば/.test(n3) && !/<td>みかん<\/td>/.test(n3), '名前：前からの ?only=blocked も効く');
    const r1 = await get('/fes/rounds?kind=soroe');
    assert(/そろえて発射/.test(r1) && !/<td>ぴったり10秒<\/td>/.test(r1), '回ごと：ゲームでしぼる');
    const fut = await get('/fes/names?from=2099-01-01T00:00');
    assert(!/<td>みかん<\/td>/.test(fut), '時刻でしぼる（未来からは0件）');
    [staff, a, b].forEach((d) => d.close());
    await srv.close();
  });

  // 5：4本のゲームそれぞれ、遊んでいる途中で切れて同じ memberId で戻る
  const GAMES = [
    { mode: 'bomb-coop', game: 'bomb' },
    { mode: 'onaji-many', game: 'onaji' },
    { mode: 'pittari', game: 'pittari' },
    { mode: 'soroe', game: 'soroe' }
  ];
  for (const g of GAMES) {
    await r.test('5：' + g.mode + '：遊んでいる途中で切れて戻る → 今の場面（部屋の知らせ）と自分の秘密が、入り直した返事のすぐあとに届く', async () => {
      const srv = await startTestServer();
      const { staff, code } = await makeFes(srv, [g.mode]);
      const ds = [];
      for (const n of ['ふう', 'ひろ', 'びび']) ds.push(await join(srv, code, n));
      await playAll(ds, srv, code);
      const c = ds[2];
      await waitUntil(() => c.wolf, '遊んでいる人には秘密が届いている', 3000);
      c.close();
      await waitUntil(() => !memberOf(srv, code, c.memberId).connected, '切れる');
      const t0 = Date.now();
      const c2 = await join(srv, code, 'びび', { memberId: c.memberId });
      await waitUntil(() => c2.wolf && c2.room, '秘密と部屋の知らせが届く', 2000);
      const room = srv.store.get(code);
      assertEqual(c2.room.state.game, g.game, '部屋の知らせは今のゲーム');
      assertEqual(c2.room.fes.phase, 'play', '文化祭の段階は「遊ぶ」');
      assertEqual(memberOf(srv, code, c.memberId).role, 'player', '遊ぶ人のまま');
      const want = JSON.parse(JSON.stringify(require('../realtime').GAME_DRIVERS[g.game].driver.privateFor(room, c.memberId)));
      // のこり時間（remainingMs）は届いた時と比べた時でずれるので、比べない
      const 時計なし = (o) => JSON.stringify(o, (k, v) => (k === 'remainingMs' ? undefined : v));
      assertEqual(時計なし(c2.wolf), 時計なし(want), '届いた秘密は、いまの本人の秘密');
      assert(c2.wolfAt - t0 < 1500, '入り直してから届くまで ' + (c2.wolfAt - t0) + 'ms');
      [staff, ds[0], ds[1], c2].forEach((d) => d.close());
      await srv.close();
    });
  }

  await r.test('6：サーバーを作り直す（再起動）→ 部屋は消える。スマホの入り直しは room_not_found、係は no_room（作り直せる）、/fes は入口へ', async () => {
    const srv1 = await startTestServer();
    const { staff, code } = await makeFes(srv1, ['pittari']);
    const a = await join(srv1, code, 'ふう');
    const memberId = a.memberId;
    [staff, a].forEach((d) => d.close());
    await srv1.close();
    const srv2 = await startTestServer();          // 部屋はメモリにあるので、作り直すと消える
    const a2 = await device(srv2.url);
    const r1 = await a2.call('room:join', { code, name: 'ふう', memberId, diff: 'normal' });
    assertEqual(r1.error, 'room_not_found', 'スマホの入り直し（つなぎ直しの自動の入り直しも同じ）は「部屋が無い」');
    const st = await device(srv2.url, await login(srv2.url, STAFF));
    const w = await st.call('fes:watch', {});
    assertEqual(w.error, 'no_room', '係の画面は「文化祭の部屋がありません」（作り直すボタンが出る）');
    const go = await fetch(srv2.url + '/fes', { redirect: 'manual' });
    assertEqual(go.headers.get('location'), '/?fes=1', '/fes（ポスターのQR）は入口へ（「いまは文化祭の部屋がありません」）');
    const cur0 = await (await fetch(srv2.url + '/api/fes/current')).json();
    assertEqual(cur0.code, null, '待つ画面が見る道：部屋が無い間は null');
    const c = await st.call('fes:create', {});
    assertEqual(c.ok, true, '係が作り直せる');
    const cur1 = await (await fetch(srv2.url + '/api/fes/current')).json();
    assertEqual(cur1.code, c.code, '作り直したら、待つ画面が見る道に新しいコードが出る（スマホと TV が自動で進む・2026-10-29 直した）');
    const go2 = await fetch(srv2.url + '/fes', { redirect: 'manual' });
    assert(/room=/.test(go2.headers.get('location') || ''), '作り直したら /fes は新しい部屋へ');
    assert(c.code !== code, '新しい部屋のコードは前とちがう（前の memberId では戻れない）');
    [a2, st].forEach((d) => d.close());
    await srv2.close();
  });

  r.finish();
})();
