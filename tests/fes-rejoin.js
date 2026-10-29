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

  await r.test('2：準備OK を押したあとで切れた人は、締め切りの時に「いない人」として外れる（押した記録は残るが、数えるのは つながっている人だけ）', async () => {
    const srv = await startTestServer(Object.assign({}, T, { readyMs: 2500 }));
    const { staff, code } = await makeFes(srv, ['pittari']);
    const a = await join(srv, code, 'ふう');
    const b = await join(srv, code, 'ひろ');
    const c = await join(srv, code, 'びび');
    await waitUntil(() => fesOf(a).phase === 'ready', 'ルールと準備OKへ');
    for (const d of [a, b, c]) await d.call('room:ready', { game: 'pittari' });
    c.close();                                     // 押したあと、のこり3秒の間に切れた
    await waitUntil(() => fesOf(a).phase === 'play', '始まる', 6000);
    assert(srv.store.get(code).pittari.playerIds.indexOf(c.memberId) === -1, '切れた人は今回に入らない');
    const m = memberOf(srv, code, c.memberId);
    assertEqual(m.role, 'waiting', '待つ人になる');
    // 締め切りのあとで戻っても、今回には入れない（waiting のまま）
    const c2 = await join(srv, code, 'びび', { memberId: c.memberId });
    assertEqual(memberOf(srv, code, c2.memberId).role, 'waiting', '戻っても今回は待つ');
    assertEqual(c2.me && c2.me.bench, 'full', '【本番で困る】理由は「押したが上限で入れなかった」と出る（ほんとうは切れていた）');
    [staff, a, b, c2].forEach((d) => d.close());
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
