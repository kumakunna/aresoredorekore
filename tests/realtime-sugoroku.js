// tests/realtime-sugoroku.js — 1人1台のすごろく（第36弾）
//
// つうこうりょう（1人ずつ順番）と、こまはひとつ（全員同時＋駒が1つ）の両方を見る。
// 待ち方がまったく違うので、片方だけ通っても安心できない。
//
// 実際に socket.io サーバーを立てて、複数の端末をつないで確かめる。
// いちばん見たいのは **手番が止まらないこと**（落とし穴17）。
// すごろくは1人ずつ順番に動くので、手番の人が消えると全員が待ち続ける。
// 監査（指示35）で入った settleAfterMemberGone との噛み合わせを、ここで固定する:
//   ・手番の人が切断したら、サーバーが代わりに振って進む（席は残す）
//   ・手番の人が退室したら、駒を動かさずに手番だけ飛ばす
//
// 出目はサーバーの乱数なので、値そのものではなく「守られるべき関係」を見る
//   （進んだか／通行料のぶん減ったか／範囲に収まっているか）。

const http = require('http');
const express = require('express');
const session = require('express-session');
const { io: ioClient } = require('socket.io-client');

const { createRunner, assert, assertEqual } = require('./harness');
const { attachRealtime, RoomStore } = require('../realtime');
const S = require('../public/js/sugoroku-logic');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fakeDb() {
  const inserted = [];
  return {
    inserted,
    prepare() { return { run: (...args) => { inserted.push(args); return { lastInsertRowid: 1 }; } }; }
  };
}

function startTestServer() {
  const app = express();
  const sessionMiddleware = session({
    secret: 'test-secret-for-realtime-sugoroku',
    resave: false, saveUninitialized: false,
    cookie: { httpOnly: true, secure: false, sameSite: 'lax' }
  });
  app.use(express.json());
  app.use(sessionMiddleware);
  app.post('/test-login', (req, res) => {
    req.session.userId = (req.body && req.body.userId) || 707;
    res.json({ ok: true });
  });
  const httpServer = http.createServer(app);
  const store = new RoomStore();
  const db = fakeDb();
  const io = attachRealtime(httpServer, sessionMiddleware, { store, db });
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
      socket: s, room: null, you: null, ended: null,
      memberId: null, code: null, name: null,
      call(event, payload) {
        return new Promise((res) => {
          const t = setTimeout(() => res({ ok: false, error: 'timeout' }), 6000);
          s.emit(event, payload || {}, (r) => { clearTimeout(t); res(r || {}); });
        });
      },
      view() { return (d.room && d.room.state && d.room.state.data) || {}; },
      close() { s.close(); }
    };
    s.on('room:update', (r) => { d.room = r; });
    s.on('wolf:you', (p) => { d.you = p; });
    s.on('wolf:ended', (p) => { d.ended = p; });
    s.on('hb:ping', () => s.emit('hb:pong'));
    const t = setTimeout(() => reject(new Error('接続がタイムアウト')), 5000);
    s.on('connect', () => { clearTimeout(t); resolve(d); });
    s.on('connect_error', (e) => { clearTimeout(t); reject(e); });
  });
}

async function waitUntil(fn, label, ms) {
  const limit = Date.now() + (ms || 5000);
  while (Date.now() < limit) {
    if (fn()) return true;
    await sleep(25);
  }
  throw new Error('条件が満たされませんでした: ' + label);
}

// 部屋を立てて、人数ぶんつなぐ
async function makeRoom(srv, count) {
  const cookie = await login(srv.url, 4321);
  const host = await device(srv.url, cookie);
  const created = await host.call('room:create', { name: 'あき' });
  assertEqual(created.ok, true, '部屋を作れる');
  host.memberId = created.memberId; host.code = created.code; host.name = 'あき';

  const names = ['びび', 'ちか', 'でん', 'えみ', 'ふう', 'げん'];
  const all = [host];
  for (let i = 1; i < count; i++) {
    const nm = names[i - 1];
    const g = await device(srv.url);
    const res = await g.call('room:join', { code: created.code, name: nm });
    assertEqual(res.ok, true, nm + ' が入れる');
    g.memberId = res.memberId; g.code = created.code; g.name = nm;
    all.push(g);
  }
  await waitUntil(() => host.room && host.room.playerCount === count, '全員そろう');
  return { host, all, code: created.code };
}

// 全員が確認を押して、最初の手番まで進める
async function toFirstTurn(all, host) {
  await waitUntil(() => host.view().phase === 'ready', '確認の段階へ');
  for (const d of all) await d.call('wolf:act', { act: 'ready' });
  await waitUntil(() => host.view().phase === 'turn', '手番へ');
}
function turnDevice(all, host) {
  const id = host.view().turn && host.view().turn.id;
  return all.find((d) => d.memberId === id);
}
function playerOf(view, id) {
  return (view.players || []).find((p) => p.id === id) || {};
}

(async function main() {
  const r = createRunner('realtime-sugoroku：1人1台のつうこうりょう');

  await r.test('人数が足りないと、サーバーが始めさせない', async () => {
    const srv = await startTestServer();
    try {
      const { host } = await makeRoom(srv, 2);
      const res = await host.call('wolf:start', { game: 'sugotoll', events: false });
      assertEqual(res.ok, false, '2人では始まらない');
      assertEqual(res.error, 'too_few_players', '断る理由が端末へ届く');
      assert((res.message || '').indexOf('3') !== -1, '何人必要かが伝わる');
    } finally { await srv.close(); }
  });

  await r.test('3人で始まり、全員がふりだし・同じコインから始まる', async () => {
    const srv = await startTestServer();
    try {
      const { host, all } = await makeRoom(srv, 3);
      const res = await host.call('wolf:start', { game: 'sugotoll', events: false });
      assertEqual(res.ok, true, '始められる');
      await waitUntil(() => host.view().phase === 'ready', '確認の段階へ');
      const v = host.view();
      assertEqual(v.game, 'sugotoll', 'どのすごろくか、全員に見えている');
      assertEqual(v.cells, S.gameById('sugotoll').cells, '盤の長さ');
      assertEqual(v.players.length, 3, '3人ぶん');
      v.players.forEach((p) => {
        assertEqual(p.pos, 0, 'ふりだし');
        assertEqual(p.coins, S.gameById('sugotoll').startCoins, '初期コイン');
      });
      // つうこうりょうに秘密は無いので、個別配信は起きない
      await sleep(150);
      assertEqual(all.every((d) => d.you === null), true, '配るものが無いので、誰にも個別配信しない');
    } finally { await srv.close(); }
  });

  await r.test('手番の人だけが振れる', async () => {
    const srv = await startTestServer();
    try {
      const { host, all } = await makeRoom(srv, 3);
      await host.call('wolf:start', { game: 'sugotoll', events: false });
      await toFirstTurn(all, host);
      const me = turnDevice(all, host);
      const other = all.find((d) => d !== me);
      const ng = await other.call('wolf:act', { act: 'roll' });
      assertEqual(ng.ok, false, '手番でない人は振れない');
      const ok = await me.call('wolf:act', { act: 'roll' });
      assertEqual(ok.ok, true, '手番の人は振れる');
    } finally { await srv.close(); }
  });

  await r.test('振ると、通行料のぶんコインが減って駒が進む', async () => {
    const srv = await startTestServer();
    try {
      const { host, all } = await makeRoom(srv, 3);
      await host.call('wolf:start', { game: 'sugotoll', events: false });
      await toFirstTurn(all, host);
      const me = turnDevice(all, host);
      const before = playerOf(host.view(), me.memberId);
      await me.call('wolf:act', { act: 'roll' });
      await waitUntil(() => host.view().last && host.view().last.id === me.memberId, '結果が届く');
      const last = host.view().last;
      assert(last.dice >= 1 && last.dice <= S.DICE_MAX, '出目が1〜6');
      assertEqual(last.rank, 1, '全員ふりだしなので、みんな1位');
      assertEqual(last.toll, last.dice, '1位は出目と同じ枚数を払う');
      const after = playerOf(host.view(), me.memberId);
      assertEqual(after.coins, before.coins - last.toll + (last.coinsGained || 0), '払ったぶん減っている');
      assert(after.pos > 0, '駒が進んでいる');
    } finally { await srv.close(); }
  });

  await r.test('手番の人が切断すると、サーバーが代わりに振って先へ進む（落とし穴17）', async () => {
    const srv = await startTestServer();
    try {
      const { host, all } = await makeRoom(srv, 3);
      await host.call('wolf:start', { game: 'sugotoll', events: false });
      await toFirstTurn(all, host);
      let me = turnDevice(all, host);
      // ホストが手番だと、見張り役ごと落ちて確かめられない。ホスト以外の番にする
      while (me === host) {
        await me.call('wolf:act', { act: 'roll' });
        await host.call('wolf:next', {});
        await waitUntil(() => host.view().phase === 'turn', '次の手番へ');
        me = turnDevice(all, host);
      }
      const gone = me;
      const goneId = gone.memberId;
      gone.close();   // 通信が切れた（名簿には残る）
      // settleAfterMemberGone が手番を消化し、結果まで進む
      await waitUntil(() => host.view().last && host.view().last.id === goneId,
        '切れた人のぶんが消化される');
      const last = host.view().last;
      assertEqual(last.auto, true, 'サーバーが代わりに振ったことが分かる');
      assert(last.move || last.stalled, '駒が動いた（置いていかれない）');
      await host.call('wolf:next', {});
      await waitUntil(() => host.view().phase === 'turn', '次の手番が始まる');
      assert(host.view().turn.id !== goneId, '手番が次の人へ移った');
    } finally { await srv.close(); }
  });

  await r.test('手番の人が退室すると、駒を動かさずに手番だけ飛ぶ', async () => {
    const srv = await startTestServer();
    try {
      const { host, all } = await makeRoom(srv, 3);
      await host.call('wolf:start', { game: 'sugotoll', events: false });
      await toFirstTurn(all, host);
      let me = turnDevice(all, host);
      while (me === host) {
        await me.call('wolf:act', { act: 'roll' });
        await host.call('wolf:next', {});
        await waitUntil(() => host.view().phase === 'turn', '次の手番へ');
        me = turnDevice(all, host);
      }
      const gone = me;
      const goneId = gone.memberId;
      const posBefore = playerOf(host.view(), goneId).pos;
      await gone.call('room:leave', { code: gone.code, memberId: goneId });
      await waitUntil(() => host.view().last && host.view().last.id === goneId,
        '出て行った人の手番が処理される');
      assertEqual(host.view().last.skipped, true, '居ない人の駒は動かさない');
      const still = playerOf(host.view(), goneId);
      if (still.pos != null) assertEqual(still.pos, posBefore, '駒はその場のまま');
      await host.call('wolf:next', {});
      await waitUntil(() => host.view().phase === 'turn', '次の手番が始まる');
      assert(host.view().turn.id !== goneId, '出て行った人に手番は回らない');
    } finally { await srv.close(); }
  });

  await r.test('決着すると、対戦履歴に残る', async () => {
    const srv = await startTestServer();
    try {
      const { host, all } = await makeRoom(srv, 3);
      await host.call('wolf:start', { game: 'sugotoll', events: false });
      await toFirstTurn(all, host);
      // あがりの直前まで進めておく（盤を直接動かすのは、決着だけを見たいため）
      const w = srv.store.get(host.code).sugoroku;
      const goal = w.board.length - 1;
      const me = turnDevice(all, host);
      w.pos[me.memberId] = goal - 1;
      w.coins[me.memberId] = 99;
      await me.call('wolf:act', { act: 'roll' });
      await waitUntil(() => host.view().phase === 'ended' || (host.view().last || {}).goal,
        'あがりに届く');
      await host.call('wolf:next', {});
      await waitUntil(() => host.view().phase === 'ended', '決着する');
      const res = host.view().result;
      assertEqual(res.players.length, 3, '全員ぶんの順位が出る');
      assertEqual(res.players[0].goaled, true, 'あがった人が1位');
      await waitUntil(() => srv.db.inserted.length > 0, '記録が残る');
      const row = srv.db.inserted[0];
      assert(JSON.stringify(row).indexOf('sugotoll') !== -1, 'すごろくの記録として残る');
    } finally { await srv.close(); }
  });

  // ================= こまはひとつ（全員が同時に出す） =================

  await r.test('こまはひとつ：確認のあと、何のミニゲームかが全員に届く', async () => {
    const srv = await startTestServer();
    try {
      const { host, all } = await makeRoom(srv, 3);
      const res = await host.call('wolf:start', { game: 'sugograb', events: false });
      assertEqual(res.ok, true, '始められる');
      await waitUntil(() => host.view().phase === 'ready', '確認の段階へ');
      assertEqual(host.view().sharedPiece, true, '駒が1つだと分かる');
      assertEqual(host.view().piece, 0, '駒はふりだし');
      for (const d of all) await d.call('wolf:act', { act: 'ready' });
      await waitUntil(() => host.view().phase === 'mini', 'ミニゲームの題へ');
      const v = host.view();
      assert(v.mini && v.mini.title && v.mini.lead, '何が始まるかが全員に見えている');
      await waitUntil(() => host.view().phase === 'play', '本体へ（題は自動で進む）', 8000);
    } finally { await srv.close(); }
  });

  await r.test('こまはひとつ：出していない人がいても、締め切れば先へ進む', async () => {
    const srv = await startTestServer();
    try {
      const { host, all } = await makeRoom(srv, 3);
      await host.call('wolf:start', { game: 'sugograb', events: false });
      await waitUntil(() => host.view().phase === 'ready', '確認へ');
      for (const d of all) await d.call('wolf:act', { act: 'ready' });
      await waitUntil(() => host.view().phase === 'play', '本体へ', 8000);
      // ミニゲームは毎回ランダムに選ばれ、締め切りも6〜20秒と幅がある。
      // **実時間で待つと、負荷の高い時に落ちるテストになる**（実際に落ちた）ので、
      // ゆびのかずあてに固定したうえで、締め切りそのものを過去にして見回りに拾わせる。
      // 確かめたいのは「締め切れば進む」であって、秒数の実測ではない
      const w = srv.store.get(host.code).sugoroku;
      w.mini = { id: 'fingers', kind: 'mind', title: 'ゆびの かずあて', lead: '', sec: 14, simulInput: true };
      w.entries = {};
      await all[0].call('wolf:act', { fingers: 3 });   // 1人だけ出して、あとは放置
      w.deadline = Date.now() - 1;                     // 締め切りが過ぎた状態にする
      await waitUntil(() => host.view().phase !== 'play', '締め切って先へ進む', 10000);
      assert(['grab', 'result', 'mini'].indexOf(host.view().phase) !== -1,
        '止まっていない（' + host.view().phase + '）');
      // 出していない3人は、最下位に同着で並んでいる
      const ranks = (w.miniRank || []).map((x) => x.rank);
      assert(ranks.length === 3, '全員ぶん順位がついている');
    } finally { await srv.close(); }
  });

  await r.test('こまはひとつ：勝った人だけが振れて、駒は1つだけ動く', async () => {
    const srv = await startTestServer();
    try {
      const { host, all } = await makeRoom(srv, 3);
      await host.call('wolf:start', { game: 'sugograb', events: false });
      await waitUntil(() => host.view().phase === 'ready', '確認へ');
      for (const d of all) await d.call('wolf:act', { act: 'ready' });
      await waitUntil(() => host.view().phase === 'play', '本体へ', 8000);
      // ゆびのかずあてに寄せて、勝者を1人に決める
      const w = srv.store.get(host.code).sugoroku;
      w.mini = { id: 'fingers', kind: 'mind', title: 'ゆびの かずあて', lead: '', sec: 14, simulInput: true };
      w.entries = {};
      await all[0].call('wolf:act', { fingers: 5 });
      await all[1].call('wolf:act', { fingers: 1 });
      await all[2].call('wolf:act', { fingers: 1 });
      await waitUntil(() => host.view().phase === 'grab', '駒を動かす段階へ', 20000);
      const mover = host.view().turn.id;
      assertEqual(mover, all[0].memberId, '珍しい本数を出した人が動かす');
      const other = all.find((d) => d.memberId !== mover);
      const ng = await other.call('wolf:act', { act: 'roll' });
      assertEqual(ng.ok, false, '勝っていない人は振れない');
      assertEqual(ng.error, 'not_your_turn', '理由が分かる');
      const me = all.find((d) => d.memberId === mover);
      assertEqual((await me.call('wolf:act', { act: 'roll' })).ok, true, '勝った人は振れる');
      await waitUntil(() => host.view().piece > 0, '駒が進む', 20000);
      host.view().players.forEach((pl) => {
        assertEqual(pl.pos, null, '人ごとの位置は持たない（駒は1つ）');
      });
    } finally { await srv.close(); }
  });

  await r.test('こまはひとつ：勝った人が切断していても、サーバーが代わりに振る', async () => {
    const srv = await startTestServer();
    try {
      const { host, all } = await makeRoom(srv, 3);
      await host.call('wolf:start', { game: 'sugograb', events: false });
      await waitUntil(() => host.view().phase === 'ready', '確認へ');
      for (const d of all) await d.call('wolf:act', { act: 'ready' });
      await waitUntil(() => host.view().phase === 'play', '本体へ', 8000);
      const w = srv.store.get(host.code).sugoroku;
      w.mini = { id: 'fingers', kind: 'mind', title: 'ゆびの かずあて', lead: '', sec: 14, simulInput: true };
      w.entries = {};
      // ホスト以外を勝たせる（ホストが落ちると見張り役ごと消える）
      const winner = all.find((d) => d !== host);
      for (const d of all) await d.call('wolf:act', { fingers: d === winner ? 5 : 1 });
      await waitUntil(() => host.view().phase === 'grab', '駒を動かす段階へ', 20000);
      assertEqual(host.view().turn.id, winner.memberId, '勝った人の番');
      winner.close();
      await waitUntil(() => host.view().piece > 0 || host.view().phase !== 'grab',
        '切れても先へ進む', 20000);
      assert(host.view().piece > 0, '駒は進んでいる（置いていかれない）');
    } finally { await srv.close(); }
  });

  // ================= ふたりでひとつ（待つ単位が「組」） =================

  await r.test('ふたりでひとつ：4人が2組に分かれ、駒は組に付く', async () => {
    const srv = await startTestServer();
    try {
      const { host, all } = await makeRoom(srv, 4);
      const res = await host.call('wolf:start', { game: 'sugopair', events: false });
      assertEqual(res.ok, true, '始められる');
      await waitUntil(() => host.view().phase === 'ready', '確認へ');
      const v = host.view();
      assertEqual(v.pairs, true, '組で遊ぶと分かる');
      assertEqual(v.groups.length, 2, '4人なら2組');
      v.groups.forEach((g) => assertEqual(g.names.length, 2, '2人組'));
      // 同じ組の2人は、同じ位置を見る
      const byGroup = {};
      v.players.forEach((p2) => { (byGroup[p2.groupId] = byGroup[p2.groupId] || []).push(p2.pos); });
      Object.keys(byGroup).forEach((k) => {
        assertEqual(new Set(byGroup[k]).size, 1, '同じ組は同じ位置');
      });
      for (const d of all) await d.call('wolf:act', { act: 'ready' });
      await waitUntil(() => host.view().phase === 'roll', '振る段階へ');
    } finally { await srv.close(); }
  });

  await r.test('ふたりでひとつ：振った組は待たれず、他の組を止めない', async () => {
    const srv = await startTestServer();
    try {
      const { host, all } = await makeRoom(srv, 4);
      await host.call('wolf:start', { game: 'sugopair', events: false });
      await waitUntil(() => host.view().phase === 'ready', '確認へ');
      for (const d of all) await d.call('wolf:act', { act: 'ready' });
      await waitUntil(() => host.view().phase === 'roll', '振る段階へ');
      const g0 = host.view().groups[0];
      const one = all.find((d) => g0.names.indexOf(d.name) !== -1);
      assertEqual((await one.call('wolf:act', { act: 'roll' })).ok, true, '組の誰かが振れる');
      await waitUntil(() => host.view().groups[0].dice != null, '出目が届く');
      const again = all.find((d) => d !== one && g0.names.indexOf(d.name) !== -1);
      assertEqual((await again.call('wolf:act', { act: 'roll' })).error, 'taken',
        '同じ組は2回振れない');
      // まだ振っていない組がいても、振った組は待たれない
      assertEqual(host.view().phase, 'roll', 'もう1組を待っている');
    } finally { await srv.close(); }
  });

  await r.test('ふたりでひとつ：合計が出目と一致した組だけが確定する', async () => {
    const srv = await startTestServer();
    try {
      const { host, all } = await makeRoom(srv, 4);
      await host.call('wolf:start', { game: 'sugopair', events: false });
      await waitUntil(() => host.view().phase === 'ready', '確認へ');
      for (const d of all) await d.call('wolf:act', { act: 'ready' });
      await waitUntil(() => host.view().phase === 'roll', '振る段階へ');
      for (const d of all) await d.call('wolf:act', { act: 'roll' });
      await waitUntil(() => host.view().phase === 'split', '配分の段階へ', 10000);
      const w = srv.store.get(host.code).sugoroku;
      const g = w.groups[0];
      w.dice[g.id] = 5;
      const ds = g.members.map((id) => all.find((d) => d.memberId === id));
      await ds[0].call('wolf:act', { act: 'split', steps: 3 });
      assertEqual(!!w.locked[g.id], false, '片方だけでは確定しない');
      await ds[1].call('wolf:act', { act: 'split', steps: 1 });
      assertEqual(!!w.locked[g.id], false, '合計4では確定しない');
      await ds[1].call('wolf:act', { act: 'split', steps: 2 });
      assertEqual(w.locked[g.id], true, '合計5でぴったり確定');
    } finally { await srv.close(); }
  });

  await r.test('ふたりでひとつ：相方が退室しても、残った1人で進める（落とし穴17）', async () => {
    const srv = await startTestServer();
    try {
      const { host, all } = await makeRoom(srv, 4);
      await host.call('wolf:start', { game: 'sugopair', events: false });
      await waitUntil(() => host.view().phase === 'ready', '確認へ');
      for (const d of all) await d.call('wolf:act', { act: 'ready' });
      await waitUntil(() => host.view().phase === 'roll', '振る段階へ');
      const w = srv.store.get(host.code).sugoroku;
      // ホストが入っていない組を選ぶ（ホストを消すと見張り役ごと消える）
      const g = w.groups.find((x) => x.members.indexOf(host.memberId) === -1);
      const stay = all.find((d) => d.memberId === g.members[0]);
      const gone = all.find((d) => d.memberId === g.members[1]);
      await gone.call('room:leave', { code: gone.code, memberId: gone.memberId });
      await sleep(150);
      await stay.call('wolf:act', { act: 'roll' });
      await waitUntil(() => w.locked[g.id] === true, '相方がいない組は、その場で確定する');
      assertEqual(w.solo[g.id], true, '1人になったことが記録される');
      assertEqual(S.splitSum(w.parts[g.id]), w.dice[g.id], '出目をそのまま使える');
    } finally { await srv.close(); }
  });

  r.finish();
})();
