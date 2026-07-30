// tests/realtime-defuse.js — 1人1台の爆弾解除「実物解除」（第27弾-3）
//
// センサーそのもの（傾き・方位・振り・カメラ）は実機でしか確かめられない。
// ここで見るのは、実機が無くても確かめられること:
//   ・同意 → 役割決め → 解除 → 決着まで通せること
//   ・対応表がマニュアル役だけに届き、解除役にも大画面にも漏れないこと
//   ・答え（answer）がどの端末にも一度も届かないこと
//   ・マニュアルなしにすると、同じ対応表が解除役に届くこと
//   ・マニュアル役の人数で、出せるモジュールが変わること
//   ・体を動かす同意を全員が断ったら、振る・ポーズが出ないこと
//   ・ミス上限が全体で共有されること
//   ・集中解除ではマニュアル役が1人だけになること

const http = require('http');
const express = require('express');
const session = require('express-session');
const { io: ioClient } = require('socket.io-client');

const { createRunner, assert, assertEqual } = require('./harness');
const { attachRealtime, RoomStore } = require('../realtime');
const DefuseLogic = require('../public/js/defuse-logic');

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
    secret: 'test-secret-for-realtime-defuse',
    resave: false, saveUninitialized: false,
    cookie: { httpOnly: true, secure: false, sameSite: 'lax' }
  });
  app.use(express.json());
  app.use(sessionMiddleware);
  app.post('/test-login', (req, res) => {
    req.session.userId = (req.body && req.body.userId) || 555;
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
      socket: s, room: null, you: null, youLog: [], roomLog: [], memberId: null, name: null,
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
    await sleep(20);
  }
  throw new Error('条件が満たされませんでした: ' + label);
}

async function makeRoom(srv, playerCount, withBigScreen) {
  const cookie = await login(srv.url, 5150);
  const host = await device(srv.url, cookie);
  const created = await host.call('room:create', { name: 'あき' });
  assertEqual(created.ok, true, '部屋を作れる');
  host.memberId = created.memberId; host.name = 'あき';
  const names = ['びび', 'ちか', 'でん', 'えみ'];
  const guests = [];
  for (let i = 1; i < playerCount; i++) {
    const nm = names[i - 1] || ('P' + (i + 1));
    const g = await device(srv.url);
    const res = await g.call('room:join', { code: created.code, name: nm });
    g.memberId = res.memberId; g.name = nm;
    guests.push(g);
  }
  let big = null;
  if (withBigScreen) {
    big = await device(srv.url);
    const res = await big.call('room:join', { code: created.code, name: 'テレビ', role: 'bigscreen' });
    big.memberId = res.memberId;
  }
  return { host, guests, big, code: created.code, all: [host].concat(guests) };
}

function defuseOf(srv, code) { return srv.store.get(code).defuse; }
function viewOf(d) { return (d.room && d.room.state && d.room.state.data) || {}; }

function startConfig(patch) {
  return Object.assign({
    game: 'defuse', mode: 'normal', moduleCount: 4, strikes: 3,
    manual: true, timerSec: 0, allowPhysical: false, allowCamera: false
  }, patch || {});
}

// センサーが全部読める端末（スマホ相当）。本物の端末が役割と一緒に送ってくるもの
const ALL_CAPS = { orientation: true, compass: true, motion: true, camera: true };

// 同意（出ていれば）と役割決めを済ませて、解除が始まるところまで進める。
// roles は [端末, 'defuser'|'manual'] の並び
async function toPlay(srv, rm, roles, caps) {
  const w = () => defuseOf(srv, rm.code);
  if (w().phase === 'consent') {
    for (const d of rm.all) await d.call('wolf:act', { targetId: 'yes' });
    await waitUntil(() => w().phase === 'roles', '役割決めに進む');
  }
  for (const [d, role] of roles) {
    await d.call('wolf:act', { targetId: role, caps: caps === undefined ? ALL_CAPS : caps });
  }
  await waitUntil(() => w().phase === 'play', '解除が始まる');
}

/**
 * テストだけが使える覗き見。端末には届いていない答えを取り出して、正解の操作を送る。
 * センサーの読み取りそのものは実機でしか確かめられないので、
 * ここでは「端末が正しい値を送ってきたらサーバーが解除と判定するか」を見ている。
 */
async function solveModule(srv, rm, d, uid) {
  const w = defuseOf(srv, rm.code);
  const inst = w.modules.find((m) => m.uid === uid);
  const open = await d.call('wolf:act', { targetId: uid });
  if (!open.ok) return open;
  const send = (action) => d.call('wolf:vote', { action });
  let last = null;
  switch (inst.type) {
    case 'face':
      for (let i = 0; i < 4; i++) {
        last = await send({ type: 'press', face: inst.hint.order[i], color: inst.answer.buttons[i] });
      }
      return last;
    case 'maze': {
      // ゴールまでの道を幅優先で先に全部求めてから、そのとおりに進む。
      // 「ゴールに近づく方へ進む」だけだと、迂回が必要な地形で行き止まりになる
      const n = inst.hint.size;
      const dirs = [['right', 1, 0], ['down', 0, 1], ['left', -1, 0], ['up', 0, -1]];
      const passable = (x, y) => {
        if (x < 0 || y < 0 || x >= n || y >= n) return false;
        const k = x + ',' + y;
        return !inst.answer.blocked[k] && !inst.answer.traps[k];
      };
      const start = inst.progress.at;
      const goal = inst.answer.goal;
      const prev = {};
      const seen = { [start.x + ',' + start.y]: true };
      const queue = [start];
      while (queue.length) {
        const cur = queue.shift();
        if (cur.x === goal.x && cur.y === goal.y) break;
        for (const [dir, dx, dy] of dirs) {
          const to = { x: cur.x + dx, y: cur.y + dy };
          const k = to.x + ',' + to.y;
          if (seen[k] || !passable(to.x, to.y)) continue;
          seen[k] = true;
          prev[k] = { from: cur, dir };
          queue.push(to);
        }
      }
      const route = [];
      let node = goal.x + ',' + goal.y;
      while (prev[node]) {
        route.unshift(prev[node].dir);
        const f = prev[node].from;
        node = f.x + ',' + f.y;
      }
      assert(route.length > 0, '傾け迷路にゴールまでの道がある（必ず1本引いてあるはず）');
      for (const dir of route) {
        last = await send({ type: 'step', dir });
        if (last && last.solved) break;
      }
      return last;
    }
    case 'shake': {
      const gap = inst.answer.tempo === 'fast' ? 300 : 1200;
      const gaps = [];
      for (let i = 1; i < inst.answer.count; i++) gaps.push(gap);
      return send({ type: 'shakes', count: inst.answer.count, gaps });
    }
    case 'compass': {
      const deg = DefuseLogic.dirById(inst.answer.dir).deg;
      for (let i = 0; i < 6; i++) {
        last = await send({ type: 'heading', deg, dtMs: 400 });
        if (last.solved) break;
      }
      return last;
    }
    case 'level': {
      for (let i = 0; i < 20; i++) {
        last = await send({ type: 'tilt', deg: 0, dtMs: 500 });
        if (last.solved) break;
      }
      return last;
    }
    case 'rhythm':
      return send({ type: 'taps', beats: inst.answer.beats.slice() });
    case 'pose':
      return send({ type: 'pose', pose: inst.answer.pose });
    case 'cipher':
      return send({ type: 'code', text: inst.answer.code });
    case 'yesno':
      return send({ type: 'guess', name: inst.answer.name });
    default:
      throw new Error('知らないモジュール: ' + inst.type);
  }
}

async function solveAll(srv, rm, d) {
  const w = () => defuseOf(srv, rm.code);
  for (const m of w().modules.slice()) {
    if (m.solved) continue;
    await solveModule(srv, rm, d, m.uid);
    await sleep(20);
  }
}

(async function main() {
  const r = createRunner('realtime-defuse：1人1台の実物解除');

  await r.test('役割を決めて、9種のモジュールを全部解除して成功できる', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 3, false);
      // 9種すべてが出るように、モジュール数を9・マニュアル役2人にする
      const res = await rm.host.call('wolf:start', startConfig({
        moduleCount: 8, allowPhysical: true, allowCamera: true
      }));
      assertEqual(res.ok, true, 'ホストが始められる');
      await waitUntil(() => defuseOf(srv, rm.code).phase === 'consent',
        '体を動かす同意から始まる');
      await toPlay(srv, rm, [
        [rm.host, 'defuser'], [rm.guests[0], 'manual'], [rm.guests[1], 'manual']
      ]);

      const w = defuseOf(srv, rm.code);
      assertEqual(w.modules.length, 8, '設定した数だけモジュールが載る');
      await solveAll(srv, rm, rm.host);
      await waitUntil(() => rm.host.you && rm.host.you.result, '結果が届く');
      const result = rm.host.you.result;
      assertEqual(result.success, true, '解除に成功した');
      assertEqual(result.solved, result.total, '全部解除できている');
    } finally { await srv.close(); }
  });

  await r.test('載っているモジュールは、どれも正しい操作で解除できる', async () => {
    // 種類は8個までしか載らない（全9種なので毎回1種類は漏れる）。
    // 9種すべての判定そのものは tests/defuse-logic.js で1つずつ見ている。
    // ここでは「通信を通しても同じように解除できるか」を確かめる
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 3, false);
      await rm.host.call('wolf:start', startConfig({
        moduleCount: 8, allowPhysical: true, allowCamera: true
      }));
      await toPlay(srv, rm, [
        [rm.host, 'defuser'], [rm.guests[0], 'manual'], [rm.guests[1], 'manual']
      ]);
      const mods = defuseOf(srv, rm.code).modules.slice();
      for (const inst of mods) {
        const def = DefuseLogic.moduleById(inst.type);
        const out = await solveModule(srv, rm, rm.host, inst.uid);
        assert(out && out.ok, def.name + ' の操作が受け付けられる');
        assertEqual(defuseOf(srv, rm.code).modules.find((m) => m.uid === inst.uid).solved, true,
          def.name + ' が解除できる');
      }
      assertEqual(defuseOf(srv, rm.code).strikesLeft, 3, '正しく操作したのでミスは増えていない');
    } finally { await srv.close(); }
  });

  await r.test('通しで遊ぶ回に、センサーを使うモジュールが実際に載っている', async () => {
    // 端末が「センサーが読める」と伝えていないと、載るのは3種類だけになる。
    // それに気づかないまま通ると、6種類が一度も試されないテストになってしまう
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 3, false);
      await rm.host.call('wolf:start', startConfig({
        moduleCount: 8, allowPhysical: true, allowCamera: true
      }));
      await toPlay(srv, rm, [
        [rm.host, 'defuser'], [rm.guests[0], 'manual'], [rm.guests[1], 'manual']
      ]);
      const types = defuseOf(srv, rm.code).modules.map((m) => m.type);
      const sensor = ['face', 'maze', 'shake', 'compass', 'level', 'pose'];
      const loaded = sensor.filter((t) => types.indexOf(t) >= 0);
      assert(loaded.length >= 4,
        'センサーを使うモジュールが載っている（' + loaded.join(',') + '）');
    } finally { await srv.close(); }
  });

  await r.test('センサーが読めない端末が解除役なら、そのモジュールは載せない', async () => {
    // PCから参加した人が解除役、という場面は普通に起きる。
    // 傾きも方位も読めない端末に傾け迷路を出したら、一生解けないマスになる
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 2, false);
      await rm.host.call('wolf:start', startConfig({
        moduleCount: 4, allowPhysical: true, allowCamera: true
      }));
      await toPlay(srv, rm, [[rm.host, 'defuser'], [rm.guests[0], 'manual']],
        { orientation: false, compass: false, motion: false, camera: false });
      const types = defuseOf(srv, rm.code).modules.map((m) => m.type);
      ['face', 'maze', 'shake', 'compass', 'level', 'pose'].forEach((t) => {
        assert(types.indexOf(t) === -1, t + ' は載らない');
      });
      assertEqual(types.length, 4, 'それでも頼まれた数のモジュールは載る');
    } finally { await srv.close(); }
  });

  await r.test('解除役が2人いれば、どちらかの端末で読めるセンサーは使える', async () => {
    // スマホの人に爆弾を持ってもらえばいいので、全員がスマホである必要はない
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 3, false);
      await rm.host.call('wolf:start', startConfig({
        moduleCount: 6, allowPhysical: true, allowCamera: true, manual: false
      }));
      await waitUntil(() => defuseOf(srv, rm.code).phase === 'consent', '同意から始まる');
      for (const d of rm.all) await d.call('wolf:act', { targetId: 'yes' });
      await waitUntil(() => defuseOf(srv, rm.code).phase === 'roles', '役割決めに進む');
      // PC（何も読めない）とスマホ（全部読める）が解除役
      await rm.host.call('wolf:act', {
        targetId: 'defuser', caps: { orientation: false, compass: false, motion: false, camera: false }
      });
      await rm.guests[0].call('wolf:act', { targetId: 'defuser', caps: ALL_CAPS });
      await rm.guests[1].call('wolf:act', { targetId: 'defuser', caps: ALL_CAPS });
      await waitUntil(() => defuseOf(srv, rm.code).phase === 'play', '解除が始まる');
      const types = defuseOf(srv, rm.code).modules.map((m) => m.type);
      const sensor = ['face', 'maze', 'shake', 'compass', 'level', 'pose'];
      assert(sensor.some((t) => types.indexOf(t) >= 0), 'センサーのモジュールも載る');
    } finally { await srv.close(); }
  });

  // ---- 秘密の扱い ----

  await r.test('対応表はマニュアル役だけに届き、答えは誰にも届かない', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 3, true);
      await rm.host.call('wolf:start', startConfig({ moduleCount: 5 }));
      await toPlay(srv, rm, [
        [rm.host, 'defuser'], [rm.guests[0], 'manual'], [rm.guests[1], 'manual']
      ]);

      // マニュアル役には対応表が届く
      await waitUntil(() => (rm.guests[0].you.manualPages || []).length > 0, '対応表が届く');
      const pages = rm.guests[0].you.manualPages.concat(rm.guests[1].you.manualPages || []);
      const withManual = defuseOf(srv, rm.code).modules.filter((m) => !!m.manual).length;
      assertEqual(pages.length, withManual, '対応表は全部どちらかの手元にある（分けて配る）');

      // 解除役には対応表が届かない
      const uid = defuseOf(srv, rm.code).modules.find((m) => !!m.manual).uid;
      await rm.host.call('wolf:act', { targetId: uid });
      await waitUntil(() => rm.host.you.open && rm.host.you.open.uid === uid, 'モジュールが開く');
      assertEqual(rm.host.you.open.manual, undefined, 'マニュアルありでは対応表が来ない');

      // 答えは、誰の端末にも・公開情報にも一度も出ない
      const w = defuseOf(srv, rm.code);
      const everything = JSON.stringify(rm.all.concat([rm.big]).map((d) => [d.youLog, d.roomLog]));
      w.modules.forEach((m) => {
        const key = JSON.stringify(m.answer);
        assert(everything.indexOf(key) === -1,
          m.type + ' の答えがそのまま流れていない');
      });
      // 大画面には秘密が1つも届かない
      assertEqual(rm.big.you, null, '大画面に秘密は届かない');
      assertEqual(rm.big.youLog.length, 0, '一度も届いていない');
      const pub = viewOf(rm.big);
      assert(pub.board && pub.board.modules.every((m) => !m.hint && !m.manual),
        '公開情報にはモジュール名と解除済みかだけ');
    } finally { await srv.close(); }
  });

  await r.test('マニュアルなしにすると、同じ対応表が解除役に届く', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 2, false);
      await rm.host.call('wolf:start', startConfig({ manual: false, moduleCount: 4 }));
      await toPlay(srv, rm, [[rm.host, 'defuser'], [rm.guests[0], 'defuser']]);
      const uid = defuseOf(srv, rm.code).modules.find((m) => !!m.manual).uid;
      await rm.host.call('wolf:act', { targetId: uid });
      await waitUntil(() => rm.host.you.open && rm.host.you.open.uid === uid, 'モジュールが開く');
      assert(rm.host.you.open.manual, '自力で解けるよう対応表が来る');
      // それでも答えそのものは来ない
      const inst = defuseOf(srv, rm.code).modules.find((m) => m.uid === uid);
      assert(JSON.stringify(rm.host.you).indexOf(JSON.stringify(inst.answer)) === -1,
        '答えは相変わらず届かない');
    } finally { await srv.close(); }
  });

  // ---- モジュールの選ばれ方 ----

  await r.test('分割暗号は、マニュアル役が2人以上いる時だけ出る', async () => {
    const cfg = DefuseLogic.normalizeConfig({ manual: true, allowPhysical: true, allowCamera: true });
    const with1 = DefuseLogic.availableModules(cfg, 1).map((m) => m.id);
    const with2 = DefuseLogic.availableModules(cfg, 2).map((m) => m.id);
    assert(with1.indexOf('cipher') === -1, '1人では出ない');
    assert(with2.indexOf('cipher') >= 0, '2人なら出る');
  });

  await r.test('マニュアル表示端末が0台でも、遊べるモジュールが必ず残る', async () => {
    // マニュアルありの設定なのに渡す人がいない、という状況でも体験を削らない
    const cfg = DefuseLogic.normalizeConfig({ manual: true, allowPhysical: true, allowCamera: true });
    const none = DefuseLogic.availableModules(cfg, 0);
    assert(none.length > 0, '候補が空にならない');
    assert(none.every((m) => m.noManualNeeded), '対応表の要らないものだけが残る');
  });

  await r.test('体を動かす同意を全員が断ったら、振る・ポーズは出ない', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 2, false);
      await rm.host.call('wolf:start', startConfig({
        moduleCount: 6, allowPhysical: true, allowCamera: true
      }));
      await waitUntil(() => defuseOf(srv, rm.code).phase === 'consent', '同意から始まる');
      // 何に同意するのかが、押す前に本人に届いている
      await waitUntil(() => !!rm.host.you.consentAsk, '同意の中身が届く');
      assert(rm.host.you.consentAsk.moves.length > 0, 'どんな動作があるかが書いてある');
      assert(/参加しない/.test(rm.host.you.consentAsk.declineNote), '断っても遊べると書いてある');

      for (const d of rm.all) await d.call('wolf:act', { targetId: 'no' });
      await waitUntil(() => defuseOf(srv, rm.code).phase === 'roles', '役割決めに進む');
      await rm.host.call('wolf:act', { targetId: 'defuser', caps: ALL_CAPS });
      await rm.guests[0].call('wolf:act', { targetId: 'manual', caps: ALL_CAPS });
      await waitUntil(() => defuseOf(srv, rm.code).phase === 'play', '解除が始まる');

      const types = defuseOf(srv, rm.code).modules.map((m) => m.type);
      assert(types.indexOf('shake') === -1, '振るモジュールは出ない');
      assert(types.indexOf('pose') === -1, 'ポーズは出ない');
      assert(types.length > 0, 'それでも遊べるモジュールは載る');
    } finally { await srv.close(); }
  });

  await r.test('体を動かすものが無い設定なら、同意画面を挟まない', async () => {
    // 同意を出しすぎると読まれなくなり、本当に大事な警告が埋もれる
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 2, false);
      await rm.host.call('wolf:start', startConfig({ allowPhysical: false }));
      await waitUntil(() => defuseOf(srv, rm.code).phase === 'roles', 'いきなり役割決め');
      assertEqual(defuseOf(srv, rm.code).phase, 'roles', '同意画面は出ない');
    } finally { await srv.close(); }
  });

  // ---- 役割 ----

  await r.test('解除役が1人もいないままでは始まらない', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 2, false);
      await rm.host.call('wolf:start', startConfig());
      await waitUntil(() => defuseOf(srv, rm.code).phase === 'roles', '役割決めになる');
      for (const d of rm.all) await d.call('wolf:act', { targetId: 'manual' });
      await sleep(200);
      assertEqual(defuseOf(srv, rm.code).phase, 'roles', '全員マニュアル役では進まない');
      // 進行役が押しても進まない
      await rm.host.call('wolf:next', {});
      await sleep(100);
      assertEqual(defuseOf(srv, rm.code).phase, 'roles', '押しても進まない');
      // 1人が解除役に変えれば進む
      await rm.host.call('wolf:act', { targetId: 'defuser' });
      await waitUntil(() => defuseOf(srv, rm.code).phase === 'play', '進めるようになる');
    } finally { await srv.close(); }
  });

  await r.test('集中解除では、マニュアル役は1人だけになる', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 3, false);
      await rm.host.call('wolf:start', startConfig({ mode: 'focus', moduleCount: 4 }));
      await waitUntil(() => defuseOf(srv, rm.code).phase === 'roles', '役割決めになる');
      const first = await rm.guests[0].call('wolf:act', { targetId: 'manual' });
      assertEqual(first.ok, true, '1人目はマニュアル役になれる');
      const second = await rm.guests[1].call('wolf:act', { targetId: 'manual' });
      assertEqual(second.ok, false, '2人目はなれない');
      assertEqual(second.error, 'manual_taken', '埋まっていることが伝わる');
      await rm.guests[1].call('wolf:act', { targetId: 'defuser' });
      await rm.host.call('wolf:act', { targetId: 'defuser' });
      await waitUntil(() => defuseOf(srv, rm.code).phase === 'play', '解除が始まる');
      assertEqual(defuseOf(srv, rm.code).modules.length, 4, 'モジュールが載る');
    } finally { await srv.close(); }
  });

  // ---- ミス・終わり方 ----

  await r.test('ミス上限は全体で共有され、尽きると爆発する', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 2, false);
      await rm.host.call('wolf:start', startConfig({ strikes: 2, moduleCount: 4 }));
      await toPlay(srv, rm, [[rm.host, 'defuser'], [rm.guests[0], 'manual']]);

      // わざと外せるモジュール（面認証）を探して、違う色を押す
      const w = defuseOf(srv, rm.code);
      let inst = w.modules.find((m) => m.type === 'face');
      if (!inst) {
        // 面認証が載っていない回もあるので、リズム合わせで代用する
        inst = w.modules.find((m) => m.type === 'rhythm');
      }
      assert(inst, '外せるモジュールがある');
      await rm.host.call('wolf:act', { targetId: inst.uid });
      const wrong = inst.type === 'face'
        ? { type: 'press', face: inst.hint.order[0], color: inst.answer.buttons[0] === 'red' ? 'blue' : 'red' }
        : { type: 'taps', beats: [0, 1, 2, 3, 4, 5, 6, 7] };
      const miss1 = await rm.host.call('wolf:vote', { action: wrong });
      assertEqual(miss1.miss, true, 'ミスとして返る');
      await waitUntil(() => defuseOf(srv, rm.code).strikesLeft === 1, 'ミスが1つ減る');
      // 相手（マニュアル役）の画面にも同じ残り数が届く
      await waitUntil(() => rm.guests[0].you.strikesLeft === 1, 'ミスは全員で共有される');

      await rm.host.call('wolf:vote', { action: wrong });
      await waitUntil(() => rm.host.you && rm.host.you.result, '爆発して結果が届く');
      assertEqual(rm.host.you.result.success, false, '失敗');
      assertEqual(rm.host.you.result.cause, 'strikes', '理由はミス上限');
    } finally { await srv.close(); }
  });

  await r.test('同じモジュールに2人が同時には挑めない', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 2, false);
      await rm.host.call('wolf:start', startConfig({ manual: false, moduleCount: 4 }));
      await toPlay(srv, rm, [[rm.host, 'defuser'], [rm.guests[0], 'defuser']]);
      const uid = defuseOf(srv, rm.code).modules[0].uid;
      const first = await rm.host.call('wolf:act', { targetId: uid });
      assertEqual(first.ok, true, '先に押した人は開ける');
      const second = await rm.guests[0].call('wolf:act', { targetId: uid });
      assertEqual(second.ok, false, 'あとからは開けない');
      assertEqual(second.error, 'taken', 'ふさがっていることが伝わる');
    } finally { await srv.close(); }
  });

  await r.test('マニュアル役は解除の操作ができない', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 2, false);
      await rm.host.call('wolf:start', startConfig({ moduleCount: 4 }));
      await toPlay(srv, rm, [[rm.host, 'defuser'], [rm.guests[0], 'manual']]);
      const uid = defuseOf(srv, rm.code).modules[0].uid;
      const res = await rm.guests[0].call('wolf:act', { targetId: uid });
      assertEqual(res.ok, false, 'モジュールを開けない');
      assertEqual(res.error, 'not_defuser', '理由が返る');
    } finally { await srv.close(); }
  });

  await r.test('時間切れになったら、解けた分で締まる', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 2, false);
      await rm.host.call('wolf:start', startConfig({ timerSec: 1, moduleCount: 4 }));
      await toPlay(srv, rm, [[rm.host, 'defuser'], [rm.guests[0], 'manual']]);
      await waitUntil(() => rm.host.you && rm.host.you.result, '時間切れの結果が届く', 5000);
      assertEqual(rm.host.you.result.success, false, '失敗');
      assertEqual(rm.host.you.result.cause, 'time', '理由は時間切れ');
    } finally { await srv.close(); }
  });

  await r.test('決着したら、部屋のオーナーの記録として残る', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 2, false);
      await rm.host.call('wolf:start', startConfig({ moduleCount: 4, preset: 'defuse' }));
      await toPlay(srv, rm, [[rm.host, 'defuser'], [rm.guests[0], 'manual']]);
      await solveAll(srv, rm, rm.host);
      await waitUntil(() => defuseOf(srv, rm.code).phase === 'ended', '決着する');
      await waitUntil(() => srv.db.inserted.length > 0, '記録が書かれる');
      const row = srv.db.inserted[0];
      assertEqual(row[0], 5150, '部屋のオーナーの記録として残る');
      const rounds = JSON.parse(row[2]);
      assertEqual(rounds[0].detail.game, 'defuse', 'ゲームは実物解除');
      assertEqual(rounds[0].detail.style, 'realtime', '1人1台の記録だと分かる');
      assertEqual(rounds[0].detail.success, true, '成功したことが残る');
      assert(rounds[0].detail.roles.length === 2, '誰がどの役だったかが残る');
    } finally { await srv.close(); }
  });

  await r.test('遊び終わって別のゲームを選ぶと、実物解除の進行は捨てられる', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 2, false);
      await rm.host.call('wolf:start', startConfig({ moduleCount: 4 }));
      await toPlay(srv, rm, [[rm.host, 'defuser'], [rm.guests[0], 'manual']]);
      const reset = await rm.host.call('room:setState', { phase: 'lobby', game: null, reset: true });
      assertEqual(reset.ok, true, '選び直せる');
      assertEqual(defuseOf(srv, rm.code), undefined, 'サーバー側の進行が消える');
      await waitUntil(() => rm.guests[0].room.state.game === null, '全員が待合にもどる');
    } finally { await srv.close(); }
  });

  r.finish();
})();
