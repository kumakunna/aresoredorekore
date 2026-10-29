// tests/fes.js — 文化祭の部屋（指示66-2）。本物のサーバーを立て、socket.io の端末で流れを回す
//
// 長さだけ縮める（fesTimes・3-2-1 は 0）。**遊びの数字は fes-room.js の TIMES のまま**（落とし穴24）。
// 実時間の長さが本当に効くかは、通し（門1）で見る。
const http = require('http');
const fs = require('fs');
const path = require('path');
const express = require('express');
const session = require('express-session');
const Database = require('better-sqlite3');
const { io: ioClient } = require('socket.io-client');

const { createRunner, assert, assertEqual } = require('./harness');
const { attachRealtime, RoomStore } = require('../realtime');
const { createFesStore, RETAIN_MS } = require('../fes-store');
const { mountFesRoutes } = require('../fes-routes');
const FesRoom = require('../fes-room');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OWNER = 900, STAFF = 901, NOBODY = 902;
const T = { lobbyMs: 300, idleMs: 600, voteMs: 400, decideMs: 100, readyMs: 500, resultMs: 300, endGraceMs: 100 };

// 16人を入れる検査だけは待合を長くする。縮めた長さのままだと、重い時は入れている間に 投票→決定→準備OK と進み、
// 準備OK を押さなかった人が外れて席が空く＝17人目が入れてしまう（満員の判定ではなく、検査の書き方の穴・2026-10-28）
const 待合を長く = Object.assign({}, T, { lobbyMs: 60000 });

function startTestServer(times) {
  const app = express();
  const sessionMiddleware = session({ secret: 'test-fes', resave: false, saveUninitialized: false,
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
    resolve({ url, store, io, fesStore,
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
    const d = { socket: s, room: null, me: null, wolf: null, kicked: null, gone: [], log: [], staff: null,
      call(ev, p) { return new Promise((res) => { const t = setTimeout(() => res({ ok: false, error: 'timeout' }), 6000);
        s.emit(ev, p || {}, (r) => { clearTimeout(t); res(r || {}); }); }); },
      close() { s.close(); } };
    s.on('room:update', (r) => { d.room = r; d.log.push(JSON.stringify(r)); });
    s.on('fes:you', (p) => { d.me = p; });
    s.on('fes:staff', (p) => { d.staff = p; });
    s.on('wolf:you', (p) => { d.wolf = p; });
    s.on('room:kicked', (p) => { d.kicked = p; });
    s.on('room:memberGone', (p) => { d.gone.push(p); });
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

// 指示68-1：いまの候補はクイズ解除だけで、投票を飛ばす。投票の流れを見る検査は、候補を全部 on にした表で部屋を作る。
// 本物の表（候補1つ）は「門5」の検査が見る
// 候補を全部 on にする。**テスト中（testing）の物はのぞく**——テスト中は係の「テスト中を入れる」でだけ候補に入る物で、
// ここで混ぜると候補が4つになり、直前に遊んだゲームが候補から外れる（candidatesFor・3つまで）。
// 門2はクイズ解除をもう一度選ぶ前提なので、指示68-3 でみんなと同じが入った時に赤くなった
const 全部on = () => FesRoom.FES_GAMES.filter((g) => !g.testing).map((g) => Object.assign({}, g, { on: true }));
async function makeFes(srv, opts) {
  const staff = await device(srv.url, await login(srv.url, STAFF));
  const c = await staff.call('fes:create', {});
  assertEqual(c.ok, true, '係は文化祭の部屋を作れる');
  if (!(opts && opts.本物の表)) srv.store.get(c.code).fes.games = 全部on();
  return { staff, code: c.code };
}
async function join(srv, code, name, diff, extra) {
  const d = await device(srv.url);
  const r = await d.call('room:join', Object.assign({ code, name, diff: diff === undefined ? 'normal' : diff }, extra || {}));
  d.res = r; d.memberId = r.memberId; d.code = code;
  // 入った直後の知らせ（部屋と、本人だけのもの）は返事のあとに届く。届くまで待つ
  if (r.ok) await waitUntil(() => d.room && (d.me || (extra && extra.role === 'bigscreen')), '入った知らせが届く');
  return d;
}

(async function main() {
  const r = createRunner('fes：文化祭の部屋（指示66-2）');

  await r.test('係でない人は文化祭の部屋を作れない・係は作れる・/fes がその部屋へ飛ぶ', async () => {
    const srv = await startTestServer();
    const nobody = await device(srv.url, await login(srv.url, NOBODY));
    assertEqual((await nobody.call('fes:create', {})).error, 'not_staff', 'ログインしていても係でなければ作れない');
    const guest = await device(srv.url);
    assertEqual((await guest.call('fes:create', {})).error, 'not_staff', 'ログインしていなければ作れない');
    const { code } = await makeFes(srv);
    const res = await fetch(srv.url + '/fes', { redirect: 'manual' });
    assertEqual(res.status, 302, '/fes は飛ばす');
    assert(res.headers.get('location').indexOf('room=' + code) !== -1, '/fes はいまの部屋へ飛ぶ（' + res.headers.get('location') + '）');
    [nobody, guest].forEach((d) => d.close());
    await srv.close();
  });

  await r.test('門5：むずかしさを選ぶまで入れない', async () => {
    const srv = await startTestServer();
    const { code } = await makeFes(srv);
    const a = await join(srv, code, 'ふう', null);
    assertEqual(a.res.error, 'diff_required', 'むずかしさが無いと入れない');
    const b = await join(srv, code, 'ふう', 'muri');
    assertEqual(b.res.error, 'diff_required', '3つ以外のむずかしさでは入れない');
    const c = await join(srv, code, 'ふう', 'easy');
    assertEqual(c.res.ok, true, 'むずかしさを選べば入れる');
    assertEqual(c.me && c.me.diff, 'easy', '選んだむずかしさは本人にだけ届く');
    assert(!/"diff"/.test(JSON.stringify(c.room)), 'むずかしさは部屋の知らせ（みんなに配るもの）に入らない');
    // TV は名前もむずかしさも見ない（名簿に出ない）
    const tv = await join(srv, code, 'TV', null, { role: 'bigscreen' });
    assertEqual(tv.res.ok, true, 'TV はむずかしさなしで入れる');
    [a, b, c, tv].forEach((d) => d.close());
    await srv.close();
  });

  await r.test('名前：8字まで・使えない言葉ではじく・同じ名前は「②」・はじいた名前も記録に残る', async () => {
    const srv = await startTestServer();
    const { code } = await makeFes(srv);
    assertEqual((await join(srv, code, 'あいうえおかきくけ')).res.error, 'name_long', '9字ははじく');
    assertEqual((await join(srv, code, 'ハチイチゼロ')).res.error, 'name_blocked', '数字の語呂（読み）もはじく');
    assertEqual((await join(srv, code, '８ １ ０')).res.error, 'name_blocked', '全角と空白をはさんでもはじく');
    const a = await join(srv, code, 'あいうえおかきく');
    assertEqual(a.res.ok, true, '8字は入れる');
    const b1 = await join(srv, code, 'ふう');
    const b2 = await join(srv, code, 'ふう');
    const names = b2.room.members.map((m) => m.name);
    assert(names.indexOf('ふう') !== -1 && names.indexOf('ふう②') !== -1, '2人目は「ふう②」（' + names.join('・') + '）');
    const log = srv.fesStore.listNames();
    assert(log.some((x) => x.name === 'ハチイチゼロ' && x.blocked === 1), 'はじいた名前も記録に残る');
    assert(log.some((x) => x.name === 'ふう' && x.blocked === 0), '入れた名前も記録に残る');
    [a, b1, b2].forEach((d) => d.close());
    await srv.close();
  });

  await r.test('門3・門4：投票は外れず、投票中は票の数がだれにも届かない（決まった後だけ出る）', async () => {
    const srv = await startTestServer();
    const { staff, code } = await makeFes(srv);
    const tv = await join(srv, code, 'TV', null, { role: 'bigscreen' });
    const a = await join(srv, code, 'ふう');
    const b = await join(srv, code, 'ひろ');
    await waitUntil(() => fesOf(a).phase === 'vote', '2人そろって投票へ');
    assertEqual(fesOf(a).candidates.slice().sort().join(','), 'bomb-coop,rcard', '2人の候補は、2人で始められるものだけ（進化じゃんけんは3人から）');
    const mark = tv.log.length;
    const v1 = await a.call('fes:vote', { mode: 'rcard' });
    assertEqual(v1.vote, 'rcard', '投票できる');
    const v2 = await a.call('fes:vote', { mode: 'bomb-coop' });
    assertEqual(v2.vote, 'rcard', '別のゲームを押しても、投票は変わらない');
    assertEqual(a.me.vote, 'rcard', '本人の手元の投票も変わらない');
    await b.call('fes:vote', { mode: 'rcard' });
    const during = tv.log.slice(mark).concat(a.log, b.log).filter((j) => /"phase":"vote"/.test(j));
    assert(during.length > 0, '投票中の知らせを1つ以上見ている（型(b)）');
    during.forEach((j) => {
      assert(!/"counts"/.test(j), '投票中の部屋の知らせに票の数が無い');
      assert(!/"votes"/.test(j), '投票中の部屋の知らせに、だれが何に入れたかが無い');
      assert(/"pick":null/.test(j), '投票中は決まったものも出さない');
    });
    await waitUntil(() => fesOf(tv).phase === 'decide', '決定へ');
    assertEqual(fesOf(tv).pick.mode, 'rcard', '票の多いものに決まる');
    assertEqual(fesOf(tv).pick.counts.rcard, 2, '決まった時だけ票の数が出る');
    [staff, tv, a, b].forEach((d) => d.close());
    await srv.close();
  });

  await r.test('準備OK：押した人だけで始まる・押さなかった人は今回は入らない', async () => {
    const srv = await startTestServer();
    const { staff, code } = await makeFes(srv);
    const a = await join(srv, code, 'ふう');
    const b = await join(srv, code, 'ひろ');
    const c = await join(srv, code, 'びび');
    await waitUntil(() => fesOf(a).phase === 'vote', '投票へ');
    for (const d of [a, b, c]) await d.call('fes:vote', { mode: 'bomb-coop' });
    await waitUntil(() => fesOf(a).phase === 'ready', 'ルールと準備OKへ');
    assertEqual(a.room.state.game, 'bomb', '準備OK は決まったゲームに対して押す');
    await a.call('room:ready', { game: 'bomb' });
    await b.call('room:ready', { game: 'bomb' });
    await waitUntil(() => fesOf(a).phase === 'play', '始まる');
    const w = srv.store.get(code).bomb;
    assertEqual(w.playerIds.slice().sort().join(','), [a.memberId, b.memberId].sort().join(','), '押した2人だけがゲームに入る');
    assertEqual(c.room.members.find((m) => m.id === c.memberId).role, 'waiting', '押さなかった人は今回は待つ');
    assertEqual(c.me.miss, 1, '押さなかった数が1つ');
    assertEqual(c.me.bench, 'missed', '入らなかった理由は「押さなかった」（本人にだけ届く）');
    assert(!/"bench"/.test(JSON.stringify(c.room)), '理由は部屋の知らせ（みんなに配るもの）に入らない');
    [staff, a, b, c].forEach((d) => d.close());
    await srv.close();
  });

  await r.test('全員が準備OKを押したら、のこりは3秒（2026-10-29 くまくん）。1人でも押していない間は縮めない・取り消しても延ばさない', async () => {
    // 準備OK を長く（60秒）して、縮んだことが分かるようにする。のこり3秒は本番の長さ（TIMES.readyAllMs）のまま
    const srv = await startTestServer(Object.assign({}, T, { readyMs: 60000 }));
    const { staff, code } = await makeFes(srv);
    const a = await join(srv, code, 'ふう');
    const b = await join(srv, code, 'ひろ');
    const c = await join(srv, code, 'びび');
    await waitUntil(() => fesOf(a).phase === 'vote', '投票へ');
    for (const d of [a, b, c]) await d.call('fes:vote', { mode: 'bomb-coop' });
    await waitUntil(() => fesOf(a).phase === 'ready', 'ルールと準備OKへ');
    const f = srv.store.get(code).fes;
    assertEqual(FesRoom.TIMES.readyAllMs, 3000, '全員そろった時の のこりは3秒');
    await a.call('room:ready', { game: 'bomb' });
    await b.call('room:ready', { game: 'bomb' });
    await new Promise((res) => setTimeout(res, 700));      // 見回り（0.5秒ごと）が1回は回る
    assert(f.endsAt - Date.now() > 50000, '3人中2人の間は縮めない（のこり ' + (f.endsAt - Date.now()) + 'ms）');
    await c.call('room:ready', { game: 'bomb' });
    const left = f.endsAt - Date.now();
    assert(left <= 3000 && left > 2000, '3人目が押したら、すぐ のこり3秒（' + left + 'ms）');
    await c.call('room:ready', { game: 'bomb', ready: false });
    await new Promise((res) => setTimeout(res, 600));
    assert(f.endsAt - Date.now() <= 3000, '取り消しても のこりは延ばさない');
    await waitUntil(() => fesOf(a).phase === 'play', '3秒で始まる', 5000);
    const w = srv.store.get(code).bomb;
    assertEqual(w.playerIds.slice().sort().join(','), [a.memberId, b.memberId].sort().join(','), '取り消した人は入らない（押した人だけで始める決まりのまま）');
    [staff, a, b, c].forEach((d) => d.close());
    await srv.close();
  });

  await r.test('上限より多く押した時：押した順に上限まで入り、入れなかった人の理由は「いっぱい」（くまくんの答え 2026-10-24）', async () => {
    const RT = require('../realtime');
    const room = new RT.RoomStore().create({ ownerUserId: 1 });
    for (let i = 0; i < 10; i++) room.members.set('m' + i, { id: 'm' + i, name: 'n' + i, role: 'player', connected: true, joinedAt: i, readyGame: null });
    // 10人だと上限8人のクイズ解除は候補に入らず、候補が1つだと投票を飛ばす。投票を通すために10人で遊べる仮の行を足す（候補は下で差しかえる）
    // 押した順に上限まで入る仕組みを、上限8の表で試す（クイズ解除は指示68-2 で16人までになった）
    FesRoom.init(room, { games: 全部on().map((g) => g.mode === 'bomb-coop' ? Object.assign({}, g, { max: 8 }) : g).concat([{ mode: 'x-test', game: 'x-test', min: 2, max: 16, on: true, start: { game: 'x-test' } }]) });
    room.fes.rnd = () => 0;
    const started = [];
    const api = { startGameNow: (r, p) => { started.push(p); return { ok: true }; }, clearGameState() {}, driverStateOf: () => null, removeMember() { return true; } };
    const step = () => { room.fes.endsAt = Date.now() - 1; FesRoom.tick(room, Date.now(), api); };
    FesRoom.tick(room, Date.now(), api); step();            // 待合 → 投票
    room.fes.candidates = ['bomb-coop'];
    FesRoom.vote(room, 'm0', 'bomb-coop'); step(); step();  // 決定 → 準備OK
    for (let i = 0; i < 9; i++) { const m = room.members.get('m' + i); m.readyGame = 'bomb'; m.readyAt = 1000 + i; }
    step();                                                 // しめきり：9人押した（クイズ解除は8人まで）、m9 は押さない
    assertEqual(room.fes.phase, 'play', '始まる');
    assertEqual(Object.keys(started[0].fesDiffs).sort().join(','), ['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'].join(','), '押した順に8人まで');
    assertEqual(FesRoom.privateFor(room, 'm8').bench, 'full', '押したのに入れなかった人は「いっぱい」');
    assertEqual(FesRoom.privateFor(room, 'm9').bench, 'missed', '押さなかった人は「押さなかった」');
    assertEqual(FesRoom.privateFor(room, 'm0').bench, null, '入った人には理由が無い');
  });

  await r.test('門2：準備OKを2回つづけて押さなかった人の席が空く（無人のまま次の回へ進む）', async () => {
    const srv = await startTestServer();
    const { staff, code } = await makeFes(srv);
    const a = await join(srv, code, 'ふう');
    const b = await join(srv, code, 'ひろ');
    const c = await join(srv, code, 'びび');
    const round = async () => {
      await waitUntil(() => fesOf(a).phase === 'vote', '投票へ', 8000);
      await a.call('fes:vote', { mode: 'bomb-coop' });
      await waitUntil(() => fesOf(a).phase === 'ready', '準備OKへ');
      await a.call('room:ready', { game: 'bomb' });
      await b.call('room:ready', { game: 'bomb' });
    };
    await round();
    await waitUntil(() => fesOf(a).phase === 'play', '1回目が始まる');
    // 本人だけの知らせ（fes:you）は部屋の知らせのあとに届くことがある。届くまで待ってから見る（重い時に赤くなった）
    await waitUntil(() => c.me && c.me.miss === 1, '押さなかった数が届く', 3000).catch(() => null);
    assertEqual(c.me.miss, 1, '1回目：押さなかった数が1つ（まだ席はある）');
    // 1回目のゲームを終わらせる（わざと3回外す＝爆発）。ここから先は何も押さない
    const room = srv.store.get(code);
    for (let i = 0; i < 3 && room.bomb.phase !== 'ended'; i++) {
      const uid = a.wolf.board.find((x) => !x.solved && !x.by).uid;
      await a.call('wolf:act', { targetId: uid });
      await waitUntil(() => a.wolf.open && a.wolf.open.uid === uid, '開く');
      const right = room.bomb.wires.find((x) => x.uid === uid).name;
      await a.call('wolf:vote', { targetId: a.wolf.open.choices.find((x) => x !== right) });
    }
    await waitUntil(() => fesOf(a).phase === 'result', '結果へ（人が押さなくても）');
    await waitUntil(() => fesOf(a).phase === 'lobby', '結果のあと、何も押さなくても待合へもどる');
    assert(a.room.members.every((m) => m.role === 'player'), '待合にもどったら、待っていた人もまた入れる');
    await round();
    await waitUntil(() => c.kicked, '2回目も押さなかった人の席が空く');
    assertEqual(c.kicked.reason, 'fes_idle', '本人には「席を空けた」が届く');
    await waitUntil(() => !a.room.members.some((m) => m.id === c.memberId), 'ほかの人の名簿からも消える');
    assertEqual(a.gone.length, 0, '席を空けたことは、ほかの人に言葉で知らせない');
    assert(srv.store.get(code).members.has(b.memberId), '押していた人は残る');
    [staff, a, b, c].forEach((d) => d.close());
    await srv.close();
  });

  await r.test('門6：係が名前を隠すと、スマホとTVからすぐ消える・外した人のことはほかの人に知らせない', async () => {
    const srv = await startTestServer();
    const { staff, code } = await makeFes(srv);
    const tv = await join(srv, code, 'TV', null, { role: 'bigscreen' });
    const a = await join(srv, code, 'ふう');
    const bad = await join(srv, code, 'わるいなまえ');
    const w = await staff.call('fes:watch', { code });
    assertEqual(w.ok, true, '係は係の画面を開ける');
    const nobody = await device(srv.url, await login(srv.url, NOBODY));
    assertEqual((await nobody.call('fes:hide', { code, memberId: bad.memberId })).error, 'not_staff', '係でない人は隠せない');
    assertEqual((await a.call('fes:hide', { code, memberId: bad.memberId })).error, 'not_staff', '部屋の参加者も隠せない');
    assertEqual((await staff.call('fes:hide', { code, memberId: bad.memberId })).ok, true, '係は隠せる');
    for (const d of [tv, a]) {
      await waitUntil(() => d.room.members.some((m) => m.id === bad.memberId && m.name === '●●●'), '名前が ●●● になる');
      assert(!JSON.stringify(d.room).includes('わるいなまえ'), '元の名前は届かない');
      assert(d.room.fes.hidden.indexOf(bad.memberId) !== -1, 'TVの壁から消すための印が届く');
    }
    assert(w.staff && w.staff.members.length === 2, '係の画面は開いた時に名簿を受け取る（TVは入らない）');
    await waitUntil(() => staff.staff && staff.staff.members.some((m) => m.name === 'わるいなまえ' && m.hidden),
      '係の画面には元の名前が出る（もどせるように）');
    await staff.call('fes:hide', { code, memberId: bad.memberId, hidden: false });
    await waitUntil(() => tv.room.members.some((m) => m.name === 'わるいなまえ'), 'もどせる');
    assertEqual((await staff.call('fes:kick', { code, memberId: bad.memberId })).ok, true, '係は外せる');
    await waitUntil(() => bad.kicked, '外された本人に届く');
    await waitUntil(() => !tv.room.members.some((m) => m.id === bad.memberId), 'TVから消える');
    assertEqual(a.gone.length + tv.gone.length, 0, 'だれを外したかは、ほかの人に知らせない');
    [staff, tv, a, bad, nobody].forEach((d) => d.close());
    await srv.close();
  });

  await r.test('門7（サーバー）：★は1回で送られ、押し直すと上書き・ひとことは別に送る・やめた人も送れる', async () => {
    const srv = await startTestServer();
    const { staff, code } = await makeFes(srv);
    const a = await join(srv, code, 'ふう');
    const s1 = await a.call('fes:feedback', { code, memberId: a.memberId, round: 1, mode: 'bomb-coop', stars: 4 });
    assertEqual(s1.ok, true, '★1回で送られる');
    let rows = srv.fesStore.listFeedback();
    assertEqual(rows.length, 1, '1行'); assertEqual(rows[0].stars, 4, '★4');
    await a.call('fes:feedback', { code, memberId: a.memberId, round: 1, mode: 'bomb-coop', stars: 2 });
    await a.call('fes:feedback', { code, memberId: a.memberId, round: 1, mode: 'bomb-coop', text: 'たのしかった' });
    rows = srv.fesStore.listFeedback();
    assertEqual(rows.length, 1, '押し直しても1行のまま');
    assertEqual(rows[0].stars, 2, '押し直した★で上書き');
    assertEqual(rows[0].text, 'たのしかった', 'ひとことは別に送られ、★を消さない');
    assertEqual((await a.call('fes:feedback', { code, memberId: a.memberId, round: 1, mode: 'bomb-coop', stars: 9 })).error, 'bad_stars', '★は1〜5');
    assertEqual((await a.call('fes:feedback', { code, memberId: a.memberId, round: 5, mode: 'bomb-coop', stars: 3 })).error, 'bad_round', 'まだ無い回には送れない');
    await a.call('room:leave', { code, memberId: a.memberId });
    assertEqual((await a.call('fes:feedback', { code, memberId: a.memberId, round: 1, mode: 'bomb-coop', stars: 5 })).ok, true, '部屋を出たあと（やめた人）も送れる');
    const stranger = await device(srv.url);
    assertEqual((await stranger.call('fes:feedback', { code, memberId: 'm-nai', round: 1, mode: 'bomb-coop', stars: 5 })).error, 'not_in_room', '部屋にいなかった人は送れない');
    [staff, a, stranger].forEach((d) => d.close());
    await srv.close();
  });

  await r.test('門8：名前の記録と感想は1か月で消え、名前の記録はくまくん（owner）だけが見られる', async () => {
    const srv = await startTestServer();
    const now = Date.now();
    srv.fesStore.logName('OLD111', 'むかしのなまえ', false, null, now - RETAIN_MS - 60000);
    srv.fesStore.logName('NEW111', 'きょうのなまえ', false, null, now);
    srv.fesStore.saveFeedback({ room: 'OLD111', round: 1, mode: 'rcard', member: 'm1', name: 'x', stars: 3 }, now - RETAIN_MS - 60000);
    const get = async (p, uid) => {
      const headers = uid ? { Cookie: await login(srv.url, uid) } : {};
      return fetch(srv.url + p, { headers });
    };
    assertEqual((await get('/api/fes/names')).status, 401, 'ログインしていない人は見られない');
    assertEqual((await get('/api/fes/names', NOBODY)).status, 403, '係でない人は見られない');
    assertEqual((await get('/api/fes/names', STAFF)).status, 403, '先生（staff）も名前の記録は見られない');
    const own = await get('/api/fes/names', OWNER);
    assertEqual(own.status, 200, 'くまくん（owner）は見られる');
    const names = (await own.json()).names.map((x) => x.name);
    assert(names.indexOf('きょうのなまえ') !== -1, '今日の名前はある');
    assert(names.indexOf('むかしのなまえ') === -1, '1か月より前の名前は消えている');
    assertEqual((await get('/api/fes/feedback', STAFF)).status, 200, '先生は感想を見られる');
    assertEqual((await get('/api/fes/feedback', NOBODY)).status, 403, '係でない人は感想を見られない');
    assertEqual(srv.fesStore.listFeedback().length, 0, '1か月より前の感想は消えている');
    // 指示66-3：同じ記録を読む軽い画面（/fes/names）。門は JSON の道と同じ（くまくんだけ）
    assertEqual((await get('/fes/names')).status, 401, '画面も、ログインしていない人は見られない');
    assertEqual((await get('/fes/names', STAFF)).status, 403, '画面も、先生は見られない');
    // 指示68-2：クイズ解除の記録（正答率・終わり方）も、くまくんだけ。問題文は字のまま
    srv.fesStore.recordBombPlay({ room: 'B1', mode: 'coop', players: 3, codes: 1, lives: 3, timerSec: 180, cause: 'time', success: false, solved: 0, misses: 0, elapsedSec: 180,
      questions: [{ q: '<i>Q</i>', tier: 'easy', tries: 1, firstOk: false, wrong: 1, solved: false }] }, now);
    assertEqual((await get('/api/fes/bomb-stats', STAFF)).status, 403, '先生はクイズ解除の記録を見られない');
    const bs = await get('/fes/bomb-stats', OWNER);
    assertEqual(bs.status, 200, 'くまくんは記録の画面で読める');
    const bsText = await bs.text();
    assert(/時間切れ 1/.test(bsText) && bsText.indexOf('&lt;i&gt;Q&lt;/i&gt;') !== -1, '終わり方の数と、問題文を字のまま出す');
    srv.fesStore.logName('NEW111', '<b>あやしい</b>', true, 'blocked', now);
    const pg = await get('/fes/names', OWNER);
    assertEqual(pg.status, 200, 'くまくんは画面で読める');
    const html = await pg.text();
    assert(html.indexOf('きょうのなまえ') !== -1 && html.indexOf('むかしのなまえ') === -1, '画面にも今日の名前だけ');
    assert(html.indexOf('&lt;b&gt;あやしい&lt;/b&gt;') !== -1 && html.indexOf('<b>あやしい') === -1, '名前は字のまま（HTML として動かさない）');
    assert(/使えない言葉/.test(html), 'はじいた理由が読める');
    const only = await (await get('/fes/names?only=blocked', OWNER)).text();
    assert(only.indexOf('あやしい') !== -1 && only.indexOf('きょうのなまえ') === -1, 'はじいた名前だけに絞れる');
    // 消すのは「見た時」だけではない：起動のたびと1時間ごとに掃く（purge が本当に消すか）
    srv.fesStore.logName('OLD222', 'ふるい', false, null, now - RETAIN_MS - 1);
    assertEqual(srv.fesStore.purge(now).names, 1, '掃けば消える');
    await srv.close();
  });

  await r.test('係：一時停止で流れが止まり、つづけると止めた所から動く・この回をとばすと待合へもどる', async () => {
    const srv = await startTestServer();
    const { staff, code } = await makeFes(srv);
    const a = await join(srv, code, 'ふう');
    const b = await join(srv, code, 'ひろ');
    await waitUntil(() => fesOf(a).phase === 'vote', '投票へ');
    assertEqual((await a.call('fes:pause', { code })).error, 'not_staff', '参加者は止められない');
    assertEqual((await staff.call('fes:pause', { code })).ok, true, '係は止められる');
    await waitUntil(() => fesOf(a).paused, '止まった印が届く');
    await sleep(T.voteMs + 800);
    assertEqual(fesOf(a).phase, 'vote', '止めている間は、締め切りを過ぎても進まない');
    await staff.call('fes:pause', { code, on: false });
    await waitUntil(() => fesOf(a).phase === 'decide' || fesOf(a).phase === 'ready', 'つづけると進む');
    await waitUntil(() => fesOf(a).phase === 'ready', '準備OKへ');
    await a.call('room:ready', { game: a.room.state.game });
    await b.call('room:ready', { game: b.room.state.game });
    await waitUntil(() => fesOf(a).phase === 'play', '始まる');
    assertEqual((await staff.call('fes:skip', { code })).ok, true, '係はこの回をとばせる');
    await waitUntil(() => fesOf(a).phase === 'lobby', '待合へもどる');
    const room = srv.store.get(code);
    assert(!room.bomb && !room.rcard && !room.shinka, 'ゲームは片付いている');
    assert(a.room.members.every((m) => m.role === 'player'), 'みんなまた入れる');
    assertEqual(a.me.miss, 0, 'とばした回は、だれの押し忘れにも数えない');
    [staff, a, b].forEach((d) => d.close());
    await srv.close();
  });

  await r.test('16人まで：17人目は入れない（TVは数えない）', async () => {
    const srv = await startTestServer(待合を長く);
    const { staff, code } = await makeFes(srv);
    const ds = [await join(srv, code, 'TV', null, { role: 'bigscreen' })];
    for (let i = 0; i < 16; i++) ds.push(await join(srv, code, 'ひと' + 'あいうえおかきくけこさしすせそた'[i]));
    assert(ds.every((d) => d.res.ok), '16人とTVは入れる');
    const x = await join(srv, code, 'じゅうなな');
    assertEqual(x.res.error, 'room_full', '17人目は満員');
    assertEqual(fesOf(ds[1]).full, true, '満員の印が届く（TVはQRを隠す）');
    ds.concat([staff, x]).forEach((d) => d.close());
    await srv.close();
  });

  await r.test('30人が同時に入ろうとしても、入れるのは16人ちょうど（学校の Wi-Fi で一度にQRを読む時・2026-10-28）', async () => {
    // 満員の判定と人を足す所は、待ちをはさまない1つの処理（realtime.js の room:join）。同時に押しても数がずれないことを、本当に同時に送って見る
    const srv = await startTestServer(待合を長く);
    const { staff, code } = await makeFes(srv);
    const ds = await Promise.all(Array.from({ length: 30 }, () => device(srv.url)));
    const 名 = (i) => 'ど' + 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほ'[i];
    const rs = await Promise.all(ds.map((d, i) => d.call('room:join', { code, name: 名(i), diff: 'normal' })));
    assertEqual(rs.filter((x) => x.ok).length, 16, '入れたのは16人');
    assertEqual(rs.filter((x) => x.error === 'room_full').length, 14, 'ほかの14人は満員');
    const room = srv.store.get(code);
    assertEqual(Array.from(room.members.values()).filter((m) => m.role !== 'bigscreen' && m.connected).length, 16, '部屋の人数も16人');
    ds.concat([staff]).forEach((d) => d.close());
    await srv.close();
  });

  await r.test('満員の時の予約（指示66-3）：17人目は予約でき、席が空くと先頭に「どうぞ」。取っておいた席に後から来た人は入れない', async () => {
    const srv = await startTestServer(待合を長く);
    const { staff, code } = await makeFes(srv);
    const ds = [];
    for (let i = 0; i < 16; i++) ds.push(await join(srv, code, 'ひと' + 'あいうえおかきくけこさしすせそた'[i]));
    const x = await join(srv, code, 'じゅうなな');
    assertEqual(x.res.error, 'room_full', '17人目は満員');
    let turn = null, pos = null;
    x.socket.on('fes:turn', (p) => { turn = p; });
    x.socket.on('fes:queue', (p) => { pos = p.pos; });
    const rv = await x.call('fes:reserve', { code });
    assertEqual(rv.ok && rv.pos, 1, '予約できて1番目');
    const y = await join(srv, code, 'じゅうはち');
    const rv2 = await y.call('fes:reserve', { code });
    assertEqual(rv2.pos, 2, '後から来た人は2番目');
    assertEqual((await x.call('fes:reserve', { code })).pos, 1, '同じ端末が押し直しても1つのまま');
    // 1人が出る → 先頭（x）に「どうぞ」
    await ds[0].call('room:leave', {});
    await waitUntil(() => turn, '席が空いたら、先頭に「どうぞ」が届く', 3000);
    assertEqual(turn.code, code, 'どの部屋の席か');
    // 取っておいた席に、予約していない人は入れない（割り込めない）
    const z = await join(srv, code, 'わりこみ');
    assertEqual(z.res.error, 'room_full', '取っておいた席には割り込めない');
    // 2番目の人も、まだ入れない（席は1つだけ）
    const y2 = await y.call('room:join', { code, name: 'じゅうはち', diff: 'normal' });
    assertEqual(y2.error, 'room_full', '2番目の人は、まだ入れない');
    // 予約した本人は token で入れる（名前とむずかしさの門は、いつもどおり通る）
    const ng = await x.call('room:join', { code, name: 'じゅうなな', diff: null, reserve: turn.token });
    assertEqual(ng.error, 'diff_required', '予約でも、むずかしさの門はとばさない');
    const ok = await x.call('room:join', { code, name: 'じゅうなな', diff: 'normal', reserve: turn.token });
    assertEqual(ok.ok, true, '予約した本人は入れる');
    await waitUntil(() => pos === null || srv.store.get(code).fes.queue.length === 1, '予約が1つ減る', 2000);
    assertEqual(srv.store.get(code).fes.queue.length, 1, '入った人の予約は消え、2番目だけ残る');
    // 予約したまま閉じた端末の予約は消える
    y.close();
    await waitUntil(() => srv.store.get(code).fes.queue.length === 0, '閉じた端末の予約は消える', 3000);
    ds.concat([staff, x, z]).forEach((d) => d.close());
    await srv.close();
  });

  await r.test('満員の時の予約：「どうぞ」のあと入らずに時間が切れたら、その予約は消えて次の人へ', async () => {
    const room = { members: new Map(), fes: null };
    FesRoom.init(room, {});
    const t0 = 1000000;
    FesRoom.reserve(room, 'a', t0); FesRoom.reserve(room, 'b', t0);
    assertEqual(FesRoom.queueTick(room, 16, t0).length, 0, '満員の間は「どうぞ」を出さない');
    const o1 = FesRoom.queueTick(room, 15, t0 + 10);
    assertEqual(o1.map((e) => e.socketId).join(','), 'a', '1席空いたら先頭だけ');
    assertEqual(FesRoom.held(room, null, t0 + 20), 1, '先頭のぶんの席を取っておく');
    assertEqual(FesRoom.held(room, o1[0].token, t0 + 20), 0, '本人には取っておいた席が数えられない（入れる）');
    const o2 = FesRoom.queueTick(room, 15, t0 + 10 + FesRoom.OFFER_MS + 1);
    assertEqual(o2.map((e) => e.socketId).join(','), 'b', '時間が切れたら次の人へ');
    assertEqual(room.fes.queue.map((e) => e.socketId).join(','), 'b', '切れた予約は消える');
  });

  await r.test('だれもいない時間が続くと呼び込みの画面へ・人が来たら待合へ・1人の間は時計を回さない', async () => {
    const srv = await startTestServer();
    const { staff, code } = await makeFes(srv);
    const tv = await join(srv, code, 'TV', null, { role: 'bigscreen' });
    await waitUntil(() => fesOf(tv).phase === 'idle', 'だれもいないと呼び込みへ', 4000);
    const a = await join(srv, code, 'ふう');
    await waitUntil(() => fesOf(tv).phase === 'lobby', '人が来たら待合へ');
    await sleep(T.lobbyMs + 700);
    assertEqual(fesOf(tv).phase, 'lobby', '1人の間は投票へ進まない');
    assertEqual(fesOf(tv).remainingMs, null, '1人の間は時計を出さない');
    [staff, tv, a].forEach((d) => d.close());
    await srv.close();
  });

  await r.test('むずかしさ（クイズ解除の協力版）：コードの色はそのまま、その人に出る3択だけ選んだ段が上限', async () => {
    const BombRoom = require('../bomb-room');
    const QuizBank = require('../public/js/quiz-bank');
    const T = ['easy', 'normal', 'hard', 'nanisore', 'muri'];
    const mk = (mode, diffs) => {
      const members = new Map(['e', 'n', 'h'].map((id) => [id, { id, name: id, role: 'player', connected: true }]));
      const room = { code: 'T', members, state: { phase: 'lobby', game: 'bomb', data: {} } };
      const res = BombRoom.startGame(room, Object.assign({}, FesRoom.gameOf('bomb-coop').start, { mode, fesDiffs: diffs }), { notify() {} });
      assertEqual(res.ok, true, '始められる（' + (res.error || '') + '）');
      return room;
    };
    const diffs = { e: 'easy', n: 'normal', h: 'hard' };
    const room = mk('coop', diffs);
    const w = room.bomb;
    const hard = w.wires.find((x) => x.tier === 'hard');
    assert(hard, 'むずかしい層のコードがある（型(b)：差しかえが起きる状況を作れている）');
    // やさしいを選んだ人が、だいだい（むずかしい層）のコードを開く
    assertEqual(BombRoom.submitAction(room, 'e', hard.uid).ok, true, '開ける');
    const pe = BombRoom.privateFor(room, 'e').open;
    assertEqual(pe.tier, 'hard', 'コードの色は元のまま');
    assert(pe.description !== hard.description, 'やさしいの人には別の問題が出る');
    const sub = w.subs[hard.uid + '|e'];
    assert(T.indexOf(sub.tier) <= T.indexOf('normal'), '差しかえた問題は「ふつう」の層まで（' + sub.tier + '）');
    // 差しかえた問題の正解で、そのコードが解ける
    const right = sub.choices[sub.correct];
    assertEqual(BombRoom.submitVote(room, 'e', right).correct, true, '差しかえた問題の正解で解ける');
    assert(BombRoom.privateFor(room, 'n').board.some((c) => c.uid === hard.uid && c.solved), 'そのコードは、みんなの盤でも切れている');
    // むずかしいを選んだ人は元の問題（別のむずかしい層のコードで見る）
    const hard2 = w.wires.find((x) => x.tier === 'hard' && x.uid !== hard.uid);
    BombRoom.submitAction(room, 'h', hard2.uid);
    assertEqual(BombRoom.privateFor(room, 'h').open.description, hard2.description, 'むずかしいの人には元の問題');
    // ふつうを選んだ人は、むずかしい層までそのまま
    const hard3 = w.wires.find((x) => x.tier === 'hard' && x.uid !== hard.uid && x.uid !== hard2.uid);
    BombRoom.submitAction(room, 'n', hard3.uid);
    assertEqual(BombRoom.privateFor(room, 'n').open.description, hard3.description, 'ふつうの人も、むずかしい層（だいだい）まではそのまま');
    // 競争版には効かせない（全員同じ問題で競うので）
    const race = mk('race', diffs);
    const rh = race.bomb.wires.find((x) => x.tier === 'hard');
    BombRoom.submitAction(race, 'e', rh.uid);
    assertEqual(BombRoom.privateFor(race, 'e').open.description, rh.description, '競争版では差しかえない');
    // 公開の知らせに差しかえの問題が漏れない
    assert(!JSON.stringify(BombRoom.publicView(room)).includes(sub.description), '差しかえた問題はみんなに配らない');
  });

  // ---- 指示68-1 門5：候補の数（1つ・2つ・4つ以上） ----
  const 表 = (modes) => modes.map((m, i) => ({ mode: m, game: m, min: 2, max: 8, on: true, start: { game: m } }));
  await r.test('門5：いまの候補はクイズ解除だけ・候補が1つなら投票を飛ばして決定のカードへ', async () => {
    assertEqual(FesRoom.gamesFor({}).map((g) => g.mode).join(','), 'bomb-coop', 'on の物はクイズ解除の協力版だけ');
    const RT = require('../realtime');
    const room = new RT.RoomStore().create({ ownerUserId: 1 });
    for (let i = 0; i < 4; i++) room.members.set('m' + i, { id: 'm' + i, name: 'n' + i, role: 'player', connected: true, joinedAt: i, readyGame: null });
    FesRoom.init(room, {});
    const api = { startGameNow: () => ({ ok: true }), clearGameState() {}, driverStateOf: () => null, removeMember() { return true; } };
    FesRoom.tick(room, Date.now(), api);
    room.fes.endsAt = Date.now() - 1; FesRoom.tick(room, Date.now(), api);   // 待合 → 候補を決める
    assertEqual(room.fes.phase, 'decide', '投票を飛ばして決定へ');
    assertEqual(room.fes.pick && room.fes.pick.mode, 'bomb-coop', 'クイズ解除に決まる');
    assertEqual(room.fes.pick.lot, 'single', '「このゲームで遊びます！」の形（くじでも票でもない）');
  });

  await r.test('門5：候補が2つなら、2つで投票する', async () => {
    const f = { games: 表(['bomb-coop', 'rcard']), round: 1 };
    assertEqual(FesRoom.candidatesFor(4, f).join(','), 'bomb-coop,rcard', '2つとも出る');
  });

  await r.test('門5：候補が4つ以上なら3つ（前の回のゲームを除き、出た回が古い順・1回目はクイズ解除を必ず入れる）', async () => {
    const games = 表(['a1', 'a2', 'a3', 'bomb-coop', 'a5']);
    const one = FesRoom.candidatesFor(4, { games, round: 1, shown: {} });
    assertEqual(one.length, 3, '3つ');
    assert(one.indexOf('bomb-coop') !== -1, '1回目はクイズ解除を必ず入れる（' + one.join(',') + '）');
    const two = FesRoom.candidatesFor(4, { games, round: 2, played: { mode: 'a1' }, shown: { a1: 1, a2: 1, a3: 1, 'bomb-coop': 1 } });
    assertEqual(two.length, 3, '3つ');
    assert(two.indexOf('a1') === -1, '前の回のゲームは出さない（' + two.join(',') + '）');
    assertEqual(two[0], 'a5', 'まだ出ていない物が先');
  });

  await r.test('投票の候補の人数の幅が、アプリの MODES・GAMES と同じ（写しが腐らない）', async () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    FesRoom.FES_GAMES.forEach((g) => {
      const line = html.split('\n').find((l) => l.indexOf('{id:"' + g.mode + '"') !== -1);
      assert(line, g.mode + ' のモードが index.html にある');
      const min = +((/minPlayers:(\d+)/.exec(line) || [])[1] || 2);
      const mMax = +((/maxPlayers:(\d+)/.exec(line) || [])[1] || Infinity);
      // ゲームの行は GAMES の配列の中から探す（同じ id でカセットの行もあるため）
      const gamesBlock = html.slice(html.indexOf('  var GAMES = ['), html.indexOf('  function gameById('));
      const gl = gamesBlock.split('\n').find((l) => l.indexOf("{ id:'" + g.game + "',") !== -1);
      assert(gl, g.game + ' のゲームが index.html にある');
      const gMax = +((/maxPlayers:(\d+)/.exec(gl) || [])[1] || 8);
      assertEqual(g.min, min, g.mode + ' の下限');
      assertEqual(g.max, Math.min(mMax, gMax), g.mode + ' の上限');
    });
    // クイズ解除の始める設定は、端末の既定（state.bombCounts・bombLives・タイマー180秒）と同じ
    const bc = /bombCounts: (\{[^}]*\})/.exec(html);
    assert(bc, '端末の bombCounts の既定が読める');
    const counts = Function('return ' + bc[1])();
    const st = FesRoom.gameOf('bomb-coop').start;
    assertEqual(JSON.stringify(st.counts), JSON.stringify(counts), 'クイズ解除の本数が端末の既定と同じ');
    assertEqual(st.lives, +(/bombLives: (\d+)/.exec(html) || [])[1], 'ライフが端末の既定と同じ');
  });

  await r.test('指示68-2 第4節：文化祭のクイズ解除は16人まで。本数・ライフ・制限時間は人数の表（BombLogic.sizeFor）から', async () => {
    const BombLogic = require('../public/js/bomb-logic');
    const Bomb = require('../bomb-room');
    assertEqual(FesRoom.gameOf('bomb-coop').max, 16, '文化祭の上限は16人');
    assertEqual(FesRoom.gameOf('bomb-coop').start.sizeByPlayers, true, '人数の表を使う');
    // 8人までは今の既定と同じ（端末の既定と照らす検査がそのまま通る）
    const s8 = BombLogic.sizeFor(8);
    assertEqual(JSON.stringify([s8.codes, s8.lives, s8.timerSec]), '[30,3,180]', '8人は30本・ライフ3・180秒');
    const s16 = BombLogic.sizeFor(16);
    assertEqual(JSON.stringify([s16.codes, s16.lives, s16.timerSec]), '[50,5,300]', '16人は50本・ライフ5・300秒');
    for (let n = 2; n <= 16; n++) {
      const z = BombLogic.sizeFor(n);
      const sum = z.counts.easy + z.counts.normal + z.counts.hard;
      assertEqual(sum, z.codes, n + '人：難しさの内訳の合計が本数');
      assert(z.codes <= BombLogic.MAX_WIRES && z.lives <= BombLogic.MAX_LIVES, n + '人：上限の中');
      assert(n === 2 || z.codes >= BombLogic.sizeFor(n - 1).codes, n + '人：人数が増えて本数が減らない');
    }
    // 本物の進行役：12人の部屋で始めると、表の数字になる
    const RT = require('../realtime');
    const room = new RT.RoomStore().create({ ownerUserId: 1 });
    for (let i = 0; i < 12; i++) room.members.set('m' + i, { id: 'm' + i, name: 'n' + i, role: 'player', connected: true, joinedAt: i, readyGame: null });
    const res = Bomb.startGame(room, Object.assign({}, FesRoom.gameOf('bomb-coop').start), { notify() {} });
    assertEqual(res.ok, true, '12人で始まる');
    const s12 = BombLogic.sizeFor(12);
    assertEqual(JSON.stringify([room.bomb.wires.length, room.bomb.lives, room.bomb.timerSec]), JSON.stringify([s12.codes, s12.lives, s12.timerSec]), '12人の数字');
  });

  r.finish();
})();
