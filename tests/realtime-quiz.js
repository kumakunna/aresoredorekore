// tests/realtime-quiz.js — カセット「クイズ王」4ゲームの1人1台（第30弾 第1部・第2部）
//
// 実機・複数端末を使わず、socket.io-client の接続を複数立てて確かめる。
// 見るのは:
//   ・4つとも、始めてから決着まで通せること
//   ・正解の位置が、どの端末にも一度も届かないこと（大画面を含む）
//   ・つぎつぎクイズの「正解の一覧」が、どの端末にも届かないこと
//   ・とくとくクイズの問題文が、伏せ字のぶんしか届かないこと
//   ・早押しの「先に押した」判定が、サーバーに届いた順で決まること
//   ・早押しの問題が、対戦している2人へ同時に届くこと
//   ・決着したら対戦履歴が残ること

const http = require('http');
const express = require('express');
const session = require('express-session');
const { io: ioClient } = require('socket.io-client');

const { createRunner, assert, assertEqual } = require('./harness');
const { attachRealtime, RoomStore } = require('../realtime');
const QuizLogic = require('../public/js/quiz-logic');

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
    secret: 'test-secret-for-realtime-quiz',
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
      socket: s, room: null, you: null, ended: null,
      youLog: [], roomLog: [], memberId: null, code: null, name: null,
      call(event, payload) {
        return new Promise((res) => {
          const t = setTimeout(() => res({ ok: false, error: 'timeout' }), 6000);
          s.emit(event, payload || {}, (r) => { clearTimeout(t); res(r || {}); });
        });
      },
      // この端末が受け取ったものを全部つなげた文字列。秘密が混ざっていないか探すのに使う
      seen() {
        return JSON.stringify({ r: d.roomLog, y: d.youLog, e: d.ended });
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

async function makeRoom(srv, playerCount, withBigScreen) {
  const cookie = await login(srv.url, 4321);
  const host = await device(srv.url, cookie);
  const created = await host.call('room:create', { name: 'あき' });
  assertEqual(created.ok, true, '部屋を作れる');
  host.memberId = created.memberId; host.code = created.code; host.name = 'あき';

  const names = ['びび', 'ちか', 'でん'];
  const guests = [];
  for (let i = 1; i < playerCount; i++) {
    const nm = names[i - 1] || ('P' + (i + 1));
    const g = await device(srv.url);
    const res = await g.call('room:join', { code: created.code, name: nm });
    assertEqual(res.ok, true, nm + ' が入れる');
    g.memberId = res.memberId; g.name = nm;
    guests.push(g);
  }
  let big = null;
  if (withBigScreen) {
    big = await device(srv.url);
    const res = await big.call('room:join', { code: created.code, name: 'テレビ', role: 'bigscreen' });
    assertEqual(res.ok, true, '大画面が入れる');
    big.memberId = res.memberId;
  }
  return { host, guests, big, code: created.code, all: [host].concat(guests) };
}

function quizOf(srv, code) { return srv.store.get(code).quiz; }
function viewOf(d) { return (d.room && d.room.state && d.room.state.data) || {}; }

// テストだけが使える覗き見。端末には届いていない「正解の位置」を取り出す
function rushAnswerIndex(srv, code, memberId) {
  const s = quizOf(srv, code).rush.seats[memberId];
  return s.q ? s.q.correct : -1;
}

// 期限を過ぎたことにして、見回りに拾わせる。
// 制限時間の下限（10秒）を実時間で待つと、テストが遅くなりすぎるため
function expire(srv, code) {
  quizOf(srv, code).deadline = Date.now() - 1;
}

async function run() {
  const r = createRunner('realtime-quiz：1人1台のクイズ王');

  // ================= クイズラッシュ =================

  await r.test('クイズラッシュ：難易度を選ぶと問題が届き、正解すると点が入る', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 2, false);
      const started = await rm.host.call('wolf:start', { game: 'quizrush', timerSec: 60 });
      assertEqual(started.ok, true, '始められる');
      await waitUntil(() => rm.host.you && rm.host.you.rush, '自分の状態が届く');
      assertEqual(rm.host.you.rush.question, null, '難易度を選ぶまで問題は出ない');

      await rm.host.call('wolf:act', { targetId: 'normal' });
      await waitUntil(() => rm.host.you.rush.question, '問題が届く');
      const q = rm.host.you.rush.question;
      assert(q.text && q.choices.length >= 3, '問題文と選択肢が入っている');

      const idx = rushAnswerIndex(srv, rm.code, rm.host.memberId);
      const res = await rm.host.call('wolf:vote', { targetId: idx });
      assertEqual(res.ok, true, '答えられる');
      await waitUntil(() => rm.host.you.rush.score > 0, '点が入る');
      assertEqual(rm.host.you.rush.score, QuizLogic.TIER_POINTS.normal, 'ふつうは2点');
      assert(rm.host.you.rush.question, '続けて次の問題が出る');
    } finally { await srv.close(); }
  });

  await r.test('クイズラッシュ：決着の結果に、合計得点がちゃんと入る（第33弾 B-5）', async () => {
    // 得点はラウンドの席（seats）にしか足しておらず、
    // 結果画面が見る合計（w.scores）がずっと0のままだった
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 2, false);
      await rm.host.call('wolf:start', { game: 'quizrush', timerSec: 60 });
      await waitUntil(() => rm.host.you && rm.host.you.rush, '自分の状態が届く');
      await rm.host.call('wolf:act', { targetId: 'normal' });
      await waitUntil(() => rm.host.you.rush.question, '問題が届く');
      const idx = rushAnswerIndex(srv, rm.code, rm.host.memberId);
      await rm.host.call('wolf:vote', { targetId: idx });
      await waitUntil(() => rm.host.you.rush.score > 0, '点が入る');

      expire(srv, rm.code);
      await waitUntil(() => viewOf(rm.host).phase === 'ended', '決着する');
      const result = viewOf(rm.host).result;
      const me = (result.ranking || []).find((x) => x.name === 'あき');
      assert(me, '結果に自分がいる');
      assertEqual(me.score, QuizLogic.TIER_POINTS.normal, '取った点が結果に出る');
    } finally { await srv.close(); }
  });

  await r.test('クイズラッシュ：正解の位置は、どの端末にも届かない', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 2, true);
      await rm.host.call('wolf:start', { game: 'quizrush', timerSec: 60 });
      await waitUntil(() => rm.host.you && rm.host.you.rush, '自分の状態が届く');
      await rm.host.call('wolf:act', { targetId: 'easy' });
      await rm.guests[0].call('wolf:act', { targetId: 'hard' });
      await waitUntil(() => rm.host.you.rush.question, '問題が届く');
      const idx = rushAnswerIndex(srv, rm.code, rm.host.memberId);
      await rm.host.call('wolf:vote', { targetId: idx });
      await sleep(120);

      [rm.host, rm.guests[0], rm.big].forEach((d) => {
        assertEqual(d.seen().indexOf('"correct"'), -1, 'correct という名前が1度も出てこない');
      });
      // 相手の問題文も届かない（人それぞれ別の問題を解いている）
      const otherQ = quizOf(srv, rm.code).rush.seats[rm.guests[0].memberId].q;
      assertEqual(rm.host.seen().indexOf(otherQ.q), -1, '他の人の問題文は届かない');
    } finally { await srv.close(); }
  });

  await r.test('いちばん左の選択肢（0番）もちゃんと選べる', async () => {
    // realtime.js は targetId を「payload.targetId || null」で取り出すので、
    // 0 を選ぶと null に化ける。左端だけ永久に選べない、という形の不具合になる。
    // 実際に踏んだので、ここで見張る
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 2, false);
      await rm.host.call('wolf:start', { game: 'quizrush', timerSec: 60 });
      await waitUntil(() => rm.host.you && rm.host.you.rush, '自分の状態が届く');
      await rm.host.call('wolf:act', { targetId: 'easy' });
      await waitUntil(() => rm.host.you.rush.question, '問題が届く');

      // 0番が正解になるまで、パスの代わりに答え続けて問題を送る
      let tries = 0;
      while (rushAnswerIndex(srv, rm.code, rm.host.memberId) !== 0 && tries++ < 40) {
        const idx = rushAnswerIndex(srv, rm.code, rm.host.memberId);
        await rm.host.call('wolf:vote', { targetId: (idx + 1) % 3 });
        await sleep(20);
      }
      assertEqual(rushAnswerIndex(srv, rm.code, rm.host.memberId), 0, '0番が正解の問題が出た');
      const before = rm.host.you.rush.score;
      const res = await rm.host.call('wolf:vote', { targetId: 0 });
      assertEqual(res.ok, true, '0番を選べる');
      await waitUntil(() => rm.host.you.rush.score > before, '0番でも点が入る');
    } finally { await srv.close(); }
  });

  await r.test('クイズラッシュ：パスは決めた回数まで', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 2, false);
      await rm.host.call('wolf:start', { game: 'quizrush', timerSec: 60, passLimit: 1 });
      await waitUntil(() => rm.host.you && rm.host.you.rush, '自分の状態が届く');
      await rm.host.call('wolf:act', { targetId: 'easy' });
      await waitUntil(() => rm.host.you.rush.question, '問題が届く');

      const first = await rm.host.call('wolf:act', { targetId: 'pass' });
      assertEqual(first.ok, true, '1回目はパスできる');
      await waitUntil(() => rm.host.you.rush.passesLeft === 0, 'パスが減る');
      const second = await rm.host.call('wolf:act', { targetId: 'pass' });
      assertEqual(second.ok, false, '2回目はパスできない');
    } finally { await srv.close(); }
  });

  await r.test('クイズラッシュ：時間が来ると締まり、点の多い人がラウンドの勝者', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 2, false);
      await rm.host.call('wolf:start', { game: 'quizrush', timerSec: 60 });
      await waitUntil(() => rm.host.you && rm.host.you.rush, '自分の状態が届く');
      await rm.host.call('wolf:act', { targetId: 'normal' });
      await waitUntil(() => rm.host.you.rush.question, '問題が届く');
      await rm.host.call('wolf:vote', { targetId: rushAnswerIndex(srv, rm.code, rm.host.memberId) });
      await waitUntil(() => rm.host.you.rush.score > 0, '点が入る');

      expire(srv, rm.code);
      await waitUntil(() => rm.host.you.phase === 'ended', '決着する', 3000);
      const result = rm.host.you.result;
      assertEqual(result.ranking[0].name, 'あき', '点の多い人が1位');
      assertEqual(result.ranking[0].rank, 1, '順位が付く');
    } finally { await srv.close(); }
  });

  // ================= つぎつぎクイズ =================

  await r.test('つぎつぎクイズ：自分の番の人だけが答えられる', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 2, false);
      await rm.host.call('wolf:start', { game: 'quizlist', style: 'coop', targetCount: 3 });
      await waitUntil(() => rm.host.you && rm.host.you.list, '自分の状態が届く');
      const w = quizOf(srv, rm.code);
      const turnId = w.list.order[0];
      const mine = rm.all.find((d) => d.memberId === turnId);
      const other = rm.all.find((d) => d.memberId !== turnId);

      const bad = await other.call('wolf:vote', { targetId: w.list.topic.answers[0] });
      assertEqual(bad.ok, false, '順番でない人は答えられない');
      const good = await mine.call('wolf:vote', { targetId: w.list.topic.answers[0] });
      assertEqual(good.ok, true, '順番の人は答えられる');
      await waitUntil(() => viewOf(rm.host).list.saidCount === 1, '出た答えが増える');
    } finally { await srv.close(); }
  });

  await r.test('つぎつぎクイズ：正解の一覧は、どの端末にも届かない', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 2, true);
      await rm.host.call('wolf:start', { game: 'quizlist', style: 'coop', targetCount: 3 });
      await waitUntil(() => rm.host.you && rm.host.you.list, '自分の状態が届く');
      const w = quizOf(srv, rm.code);
      // まだ誰も言っていない答えを1つ選ぶ
      const secret = w.list.topic.answers[w.list.topic.answers.length - 1];
      await sleep(120);
      [rm.host, rm.guests[0], rm.big].forEach((d) => {
        assertEqual(d.seen().indexOf(secret), -1, 'まだ出ていない答えは届かない');
      });
      // お題そのものは公開してよい
      assert(viewOf(rm.host).list.topic, 'お題は届く');
    } finally { await srv.close(); }
  });

  await r.test('つぎつぎクイズ：同じ答えは重複あつかいになる', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 2, false);
      await rm.host.call('wolf:start', { game: 'quizlist', style: 'coop', targetCount: 5 });
      await waitUntil(() => rm.host.you && rm.host.you.list, '自分の状態が届く');
      const w = quizOf(srv, rm.code);
      const ans = w.list.topic.answers[0];

      const first = rm.all.find((d) => d.memberId === w.list.order[0]);
      await first.call('wolf:vote', { targetId: ans });
      await waitUntil(() => viewOf(rm.host).list.saidCount === 1, '1つ目が通る');

      const second = rm.all.find((d) => d.memberId === quizOf(srv, rm.code).list.order[quizOf(srv, rm.code).list.at]);
      await second.call('wolf:vote', { targetId: ans });
      await waitUntil(() => viewOf(rm.host).list.lastNote
        && viewOf(rm.host).list.lastNote.verdict === 'duplicate', '重複として返る');
      assertEqual(viewOf(rm.host).list.saidCount, 1, '数は増えない');
    } finally { await srv.close(); }
  });

  await r.test('つぎつぎクイズ：協力形式は、目標の数に届いたら成功', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 2, false);
      await rm.host.call('wolf:start', { game: 'quizlist', style: 'coop', targetCount: 3 });
      await waitUntil(() => rm.host.you && rm.host.you.list, '自分の状態が届く');
      const answers = quizOf(srv, rm.code).list.topic.answers.slice(0, 3);
      for (const a of answers) {
        const w = quizOf(srv, rm.code);
        if (w.phase === 'ended') break;
        const cur = rm.all.find((d) => d.memberId === w.list.order[w.list.at]);
        await cur.call('wolf:vote', { targetId: a });
        await sleep(40);
      }
      await waitUntil(() => rm.host.you.phase === 'ended', '決着する');
      assertEqual(rm.host.you.result.success, true, '成功');
      assertEqual(rm.host.you.result.said.length, 3, '3つ出せた');
    } finally { await srv.close(); }
  });

  await r.test('つぎつぎクイズ：脱落形式は、間違えると脱落して最後の1人が勝ち', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 2, false);
      await rm.host.call('wolf:start', { game: 'quizlist', style: 'survival' });
      await waitUntil(() => rm.host.you && rm.host.you.list, '自分の状態が届く');
      const w = quizOf(srv, rm.code);
      const loser = rm.all.find((d) => d.memberId === w.list.order[w.list.at]);
      const winner = rm.all.find((d) => d !== loser);

      await loser.call('wolf:vote', { targetId: 'ぜったいにちがう答え' });
      await waitUntil(() => rm.host.you.phase === 'ended', '決着する');
      assertEqual(rm.host.you.result.winner, winner.name, '残った人が勝ち');
    } finally { await srv.close(); }
  });

  // ================= とくとくクイズ =================

  await r.test('とくとくクイズ：問題文は伏せ字で届き、元の文は届かない', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 2, true);
      await rm.host.call('wolf:start', { game: 'quizreveal', questionCount: 2, revealSec: 30 });
      await waitUntil(() => viewOf(rm.host).reveal, '問題が届く');
      const shown = viewOf(rm.host).reveal;
      assert(shown.text.indexOf('◻') !== -1, '伏せ字が入っている');

      const full = quizOf(srv, rm.code).reveal.questions[0].q;
      [rm.host, rm.guests[0], rm.big].forEach((d) => {
        assertEqual(d.seen().indexOf(full), -1, '元の問題文はどこにも届かない');
        assertEqual(d.seen().indexOf('"correct"'), -1, '正解の位置も届かない');
      });
    } finally { await srv.close(); }
  });

  await r.test('とくとくクイズ：早く押して当てるほど、点が高い', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 2, false);
      await rm.host.call('wolf:start', { game: 'quizreveal', questionCount: 3, revealSec: 30 });
      await waitUntil(() => viewOf(rm.host).reveal, '問題が届く');

      const buzz = await rm.host.call('wolf:act', { targetId: 'buzz' });
      assertEqual(buzz.ok, true, '押せる');
      const w = quizOf(srv, rm.code);
      const q = w.reveal.questions[w.reveal.index];
      await rm.host.call('wolf:vote', { targetId: q.correct });
      await waitUntil(() => rm.host.you.score > 0, '点が入る');

      // すぐ押したので、いちばん高い点に近いはず（基準点×4の8割以上）
      const best = QuizLogic.revealScore(q.tier, 0, 30);
      assert(rm.host.you.score >= Math.floor(best * 0.8),
        'すぐ押した時の点は高い（' + rm.host.you.score + ' / 最大 ' + best + '）');
    } finally { await srv.close(); }
  });

  await r.test('とくとくクイズ：外した人はその問題に答えられず、他の人は続けられる', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 2, false);
      await rm.host.call('wolf:start', { game: 'quizreveal', questionCount: 3, revealSec: 30 });
      await waitUntil(() => viewOf(rm.host).reveal, '問題が届く');
      const w = quizOf(srv, rm.code);
      const q = w.reveal.questions[w.reveal.index];
      const wrong = (q.correct + 1) % q.choices.length;

      await rm.host.call('wolf:act', { targetId: 'buzz' });
      await rm.host.call('wolf:vote', { targetId: wrong });
      await waitUntil(() => rm.host.you.reveal && rm.host.you.reveal.locked === true, '外した人は締め出される');

      const again = await rm.host.call('wolf:act', { targetId: 'buzz' });
      assertEqual(again.ok, false, 'もう押せない');
      const other = await rm.guests[0].call('wolf:act', { targetId: 'buzz' });
      assertEqual(other.ok, true, '他の人はまだ押せる');
    } finally { await srv.close(); }
  });

  // ================= 早押しトーナメント =================

  await r.test('早押し：問題は対戦している2人へ同時に届く', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 2, true);
      await rm.host.call('wolf:start', { game: 'buzzer', winsNeeded: 2 });
      await waitUntil(() => viewOf(rm.host).buzzer && viewOf(rm.host).buzzer.question, '問題が届く');
      const v = viewOf(rm.host).buzzer;
      const v2 = viewOf(rm.guests[0]).buzzer;
      assertEqual(v.question.text, v2.question.text, '2人に同じ問題が届く');
      assertEqual(v.askedAt, v2.askedAt, '出した時刻も同じ（＝同時に出している）');
      assertEqual(rm.host.seen().indexOf('"correct"'), -1, '正解の位置は届かない');
      assertEqual(rm.big.seen().indexOf('"correct"'), -1, '大画面にも届かない');
    } finally { await srv.close(); }
  });

  await r.test('早押し：先に押した人だけが答えられる', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 2, false);
      await rm.host.call('wolf:start', { game: 'buzzer', winsNeeded: 2 });
      await waitUntil(() => viewOf(rm.host).buzzer && viewOf(rm.host).buzzer.question, '問題が届く');

      const first = await rm.host.call('wolf:act', { targetId: 'buzz' });
      assertEqual(first.ok, true, '先に押した人は取れる');
      const second = await rm.guests[0].call('wolf:act', { targetId: 'buzz' });
      assertEqual(second.ok, false, 'あとから押しても取れない');
      assertEqual(second.error, 'taken', 'ふさがっていることが伝わる');

      const q = quizOf(srv, rm.code).buzzer.q;
      const bad = await rm.guests[0].call('wolf:vote', { targetId: q.correct });
      assertEqual(bad.ok, false, '押していない人は答えられない');
    } finally { await srv.close(); }
  });

  await r.test('早押し：先に決めた数だけ正解した人が、その対戦の勝ち', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 2, false);
      await rm.host.call('wolf:start', { game: 'buzzer', winsNeeded: 2 });
      await waitUntil(() => viewOf(rm.host).buzzer && viewOf(rm.host).buzzer.question, '問題が届く');

      for (let i = 0; i < 2; i++) {
        await waitUntil(() => quizOf(srv, rm.code).buzzer.q, '次の問題が出る');
        await rm.host.call('wolf:act', { targetId: 'buzz' });
        const q = quizOf(srv, rm.code).buzzer.q;
        await rm.host.call('wolf:vote', { targetId: q.correct });
        await sleep(60);
      }
      // 2人しかいないので、この対戦に勝った時点で優勝。
      // ただし結果を見せる時間（BREAK_MS）を挟むので、そのぶん待つ
      await waitUntil(() => rm.host.you.phase === 'ended', '優勝が決まる', 12000);
      assertEqual(rm.host.you.result.champion, 'あき', '勝った人が優勝');
    } finally { await srv.close(); }
  });

  await r.test('早押し：外すと相手に権利が移り、2人とも外したら次の問題', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 2, false);
      await rm.host.call('wolf:start', { game: 'buzzer', winsNeeded: 3 });
      await waitUntil(() => viewOf(rm.host).buzzer && viewOf(rm.host).buzzer.question, '問題が届く');
      const q0 = quizOf(srv, rm.code).buzzer.q;
      const wrong = (q0.correct + 1) % q0.choices.length;

      await rm.host.call('wolf:act', { targetId: 'buzz' });
      await rm.host.call('wolf:vote', { targetId: wrong });
      await sleep(60);
      assertEqual(quizOf(srv, rm.code).buzzer.q.q, q0.q, '同じ問題が続いている');

      const other = await rm.guests[0].call('wolf:act', { targetId: 'buzz' });
      assertEqual(other.ok, true, '相手は押せる');
      const w2 = quizOf(srv, rm.code).buzzer;
      await rm.guests[0].call('wolf:vote', { targetId: (w2.q.correct + 1) % w2.q.choices.length });
      await waitUntil(() => quizOf(srv, rm.code).buzzer.q.q !== q0.q, '2人とも外したら次の問題');
    } finally { await srv.close(); }
  });

  // ================= 共通 =================

  await r.test('決着したら、部屋のオーナーの記録として残る', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 2, false);
      await rm.host.call('wolf:start', { game: 'quizrush', timerSec: 60 });
      await waitUntil(() => rm.host.you && rm.host.you.rush, '自分の状態が届く');
      await rm.host.call('wolf:act', { targetId: 'easy' });
      await waitUntil(() => rm.host.you.rush.question, '問題が届く');
      await rm.host.call('wolf:vote', { targetId: rushAnswerIndex(srv, rm.code, rm.host.memberId) });
      expire(srv, rm.code);
      await waitUntil(() => rm.host.you.phase === 'ended', '決着する', 3000);
      await waitUntil(() => srv.db.inserted.length > 0, '記録が残る');
      const row = srv.db.inserted[0];
      const rounds = JSON.parse(row[2]);
      assertEqual(rounds[0].detail.game, 'quizrush', 'どのゲームだったかが残る');
    } finally { await srv.close(); }
  });

  await r.test('遊び終わって別のゲームを選ぶと、クイズ王の進行は捨てられる', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 2, false);
      await rm.host.call('wolf:start', { game: 'quizrush', timerSec: 60 });
      await waitUntil(() => quizOf(srv, rm.code), '進行が始まる');
      const reset = await rm.host.call('room:setState', { phase: 'lobby', game: null, reset: true });
      assertEqual(reset.ok, true, '選び直せる');
      assertEqual(quizOf(srv, rm.code), undefined, '前のゲームの進行は残らない');
      await waitUntil(() => rm.guests[0].room.state.phase === 'lobby'
        && rm.guests[0].room.state.game === null, '全員が待合にもどる');
      assertEqual(Object.keys(viewOf(rm.guests[0])).length, 0, '前の盤面は端末にも残らない');
    } finally { await srv.close(); }
  });

  // finish() は失敗した時だけ process.exit(1) する。
  // 成功時に何も返さないので、返り値で終了コードを決めてはいけない
  // （緑なのに exit 1 になり、npm test の連鎖がそこで止まる）
  r.finish();
}

if (require.main === module) run();
module.exports = { run };
