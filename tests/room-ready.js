// tests/room-ready.js — ルールを読んで「準備OK」（第37弾・サーバー側）
//
// 本物のサーバーと socket.io の接続を複数立てて、
// 「誰が押したか」の集まりが、境界ごとに正しく消えることを確かめる。
// 消し忘れは、押していない人が押したことになる——いちばん危ない形の漏れなので、
// 境界（ゲーム変更・再戦・開始・退室・切断）を1つずつ回す。
//
// 画面側（ルールが出る・✓が付く・全員そろったら始まる）は tests/rt-screens.js。

const { createRunner, assert, assertEqual } = require('./harness');
const { startTestServer, device, waitUntil, makeRoom, sleep } = require('./room-edge');
const { RT_START_MIN_CONFIG, RT_GAME_IDS } = require('./inventory');

function roomOf(srv, code) { return srv.store.get(code); }
// 公開スナップショットから「準備OKの集まり」を取り出す（端末に届く形そのまま）
function tallyOf(dev) { return (dev.room && dev.room.ready) || null; }

async function run() {
  const r = createRunner('room-ready：ルールを読んで準備OK（第37弾）');

  await r.test('ゲームが決まるまでは、準備OKを押せない', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 3);
      const res = await rm.host.call('room:ready', {});
      assertEqual(res.ok, false, 'ゲーム未定では押せない');
      assertEqual(res.error, 'no_game', '理由が「まだゲームが決まっていません」');
      rm.all.forEach((d) => d.close());
    } finally { await srv.close(); }
  });

  await r.test('押した人だけが数えられ、全員そろうと「そろった」になる', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 3);
      await rm.host.call('room:setState', { phase: 'lobby', game: 'quizrush', reset: true });
      await waitUntil(() => tallyOf(rm.guests[0]), '部屋の知らせが届く');

      // 型(b)：主張の前に、数える相手が本当にいることを確かめる
      assertEqual(tallyOf(rm.host).total, 3, '押すべき人が3人いる');
      assertEqual(tallyOf(rm.host).count, 0, 'はじめは誰も押していない');
      assertEqual(tallyOf(rm.host).all, false, 'そろっていない');

      await rm.host.call('room:ready', {});
      await waitUntil(() => tallyOf(rm.guests[0]).count === 1, '1人ぶん届く');
      assertEqual(tallyOf(rm.guests[0]).all, false, '1人では、まだそろわない');
      assert(tallyOf(rm.guests[0]).waitingNames.length === 2, 'まだの人が2人いると分かる');
      assert(tallyOf(rm.guests[0]).waitingNames.indexOf('あき') === -1,
        '押した人は「まだの人」に入らない');

      await rm.guests[0].call('room:ready', {});
      await rm.guests[1].call('room:ready', {});
      await waitUntil(() => tallyOf(rm.host).all === true, '全員そろう');
      assertEqual(tallyOf(rm.host).count, 3, '3人ぶん数えられる');
      assertEqual(tallyOf(rm.host).waitingNames.length, 0, 'まだの人はいない');

      // 名簿の側にも、誰が押したかが出る（✓を出すため。秘密ではない）
      const me = rm.host.room.members.find((m) => m.id === rm.host.memberId);
      assertEqual(me.ready, true, '名簿にも「押した」が出る');
      rm.all.forEach((d) => d.close());
    } finally { await srv.close(); }
  });

  await r.test('取り消せる（キャンセル）。取り消した人はまた「まだの人」に戻る', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 3);
      await rm.host.call('room:setState', { phase: 'lobby', game: 'quizrush', reset: true });
      await rm.guests[0].call('room:ready', {});
      await waitUntil(() => tallyOf(rm.host).count === 1, '押したぶんが届く');
      await rm.guests[0].call('room:ready', { ready: false });
      await waitUntil(() => tallyOf(rm.host).count === 0, '取り消しが届く');
      assert(tallyOf(rm.host).waitingNames.indexOf('P2') >= 0, '取り消した人は、まだの人に戻る');
      rm.all.forEach((d) => d.close());
    } finally { await srv.close(); }
  });

  // ---- 境界：ここが本題。押したことが、どこで消えるべきか ----

  await r.test('境界：ゲームを変えたら、前のゲームの準備OKは消える', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 3);
      await rm.host.call('room:setState', { phase: 'lobby', game: 'quizrush', reset: true });
      await rm.host.call('room:ready', {});
      await rm.guests[0].call('room:ready', {});
      await waitUntil(() => tallyOf(rm.host).count === 2, '2人ぶん押した');   // 型(b)

      await rm.host.call('room:setState', { phase: 'lobby', game: 'quizlist', reset: true });
      await waitUntil(() => tallyOf(rm.host).count === 0, 'ゲームを変えたら0に戻る');
      assertEqual(tallyOf(rm.host).total, 3, '押すべき人数は変わらない');
      assertEqual(tallyOf(rm.host).all, false, '全員そろった扱いにならない');
      rm.all.forEach((d) => d.close());
    } finally { await srv.close(); }
  });

  await r.test('境界：同じゲームで「もう一度」しても、押し直しになる', async () => {
    // 再戦は game が変わらないので、ゲーム変更のリセットだけでは消えない。
    // reset を見て落としているかどうかが、ここで分かれる
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 3);
      await rm.host.call('room:setState', { phase: 'lobby', game: 'quizrush', reset: true });
      await rm.host.call('room:ready', {});
      await waitUntil(() => tallyOf(rm.host).count === 1, '押した');           // 型(b)
      await rm.host.call('room:setState', { phase: 'lobby', game: 'quizrush', reset: true });
      await waitUntil(() => tallyOf(rm.host).count === 0, '再戦でも押し直しになる');
      rm.all.forEach((d) => d.close());
    } finally { await srv.close(); }
  });

  await r.test('境界：始まったら、準備OKは役目を終える', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 3);
      await rm.host.call('room:setState', { phase: 'lobby', game: 'quizrush', reset: true });
      await rm.host.call('room:ready', {});
      await rm.guests[0].call('room:ready', {});
      await rm.guests[1].call('room:ready', {});
      await waitUntil(() => tallyOf(rm.host).all === true, 'そろった');        // 型(b)

      const started = await rm.host.call('wolf:start', RT_START_MIN_CONFIG.quizrush);
      assertEqual(started.ok, true, '始められる');
      await waitUntil(() => tallyOf(rm.host).count === 0, '始まったら0に戻る');
      // 始まっている間は、押しても受け付けない（押す意味が無い）
      const late = await rm.guests[0].call('room:ready', {});
      assertEqual(late.ok, false, '始まったあとは押せない');
      assertEqual(late.error, 'already_started', '理由が「もう始まっています」');
      rm.all.forEach((d) => d.close());
    } finally { await srv.close(); }
  });

  await r.test('境界：切れた人は待たない（寝落ちした1人で全員が止まらない）', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 3);
      await rm.host.call('room:setState', { phase: 'lobby', game: 'quizrush', reset: true });
      await rm.host.call('room:ready', {});
      await rm.guests[0].call('room:ready', {});
      await waitUntil(() => tallyOf(rm.host).count === 2, '2人が押した');
      assertEqual(tallyOf(rm.host).all, false, 'まだ1人待っている');            // 型(b)

      // 3人目がブラウザを閉じた（切断）
      rm.guests[1].close();
      await waitUntil(() => tallyOf(rm.host).total === 2, '待つ相手が2人に減る');
      assertEqual(tallyOf(rm.host).all, true, '残った2人でそろった扱いになる');
      assertEqual(tallyOf(rm.host).waitingNames.length, 0, 'まだの人はいない');
      rm.host.close(); rm.guests[0].close();
    } finally { await srv.close(); }
  });

  await r.test('境界：あとから入った人は、必ず「まだ押していない」から始まる', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 3);
      await rm.host.call('room:setState', { phase: 'lobby', game: 'quizrush', reset: true });
      await rm.host.call('room:ready', {});
      await rm.guests[0].call('room:ready', {});
      await rm.guests[1].call('room:ready', {});
      await waitUntil(() => tallyOf(rm.host).all === true, 'いったん全員そろう'); // 型(b)

      const late = await device(srv.url);
      const res = await late.call('room:join', { code: rm.code, name: 'あと' });
      assertEqual(res.ok, true, 'あとから入れる');
      await waitUntil(() => tallyOf(rm.host).total === 4, '待つ相手が4人になる');
      assertEqual(tallyOf(rm.host).all, false, 'その人が押すまで、そろった扱いにならない');
      assertEqual(tallyOf(rm.host).waitingNames.join(','), 'あと', 'まだの人はその人だけ');
      late.close();
      rm.all.forEach((d) => d.close());
    } finally { await srv.close(); }
  });

  await r.test('大画面にしている人は、押す相手に数えない', async () => {
    // 大画面はTVに映すための表示モードで、遊ぶ人数からも外れている（第32弾-A-2）。
    // ここで数えると、TVの前で誰も押せずに止まる
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 3);
      await rm.guests[1].call('room:setRole', { role: 'bigscreen' });
      await rm.host.call('room:setState', { phase: 'lobby', game: 'quizrush', reset: true });
      await waitUntil(() => tallyOf(rm.host).total === 2, '押す相手は2人');
      await rm.host.call('room:ready', {});
      await rm.guests[0].call('room:ready', {});
      await waitUntil(() => tallyOf(rm.host).all === true, '2人でそろう');
      rm.all.forEach((d) => d.close());
    } finally { await srv.close(); }
  });

  await r.test('古いゲームのつもりで押しても、受け付けない', async () => {
    // 部屋の知らせと、自分の操作がすれ違う瞬間（落とし穴18の型）。
    // 端末が1つ前のゲームのつもりで押したら、それは準備できていない
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 3);
      await rm.host.call('room:setState', { phase: 'lobby', game: 'quizrush', reset: true });
      const stale = await rm.guests[0].call('room:ready', { game: 'quizlist' });
      assertEqual(stale.ok, false, '古いゲームのつもりの「準備OK」は通らない');
      assertEqual(stale.error, 'stale_game', '理由が「ゲームが変わりました」');
      assertEqual(tallyOf(rm.host).count, 0, '数にも入らない');
      rm.all.forEach((d) => d.close());
    } finally { await srv.close(); }
  });

  await r.test('全ゲーム：どのゲームでも、全員そろうまでは始める門が開かない（正本ループ）', async () => {
    // 新しいゲームを GAME_DRIVERS に足したら、このテストは自動的にそのゲームも見る。
    // 「準備OK」の仕組みはゲームに依らない1本なので、どれか1つで漏れたら作りが違うということ
    // 人数は6人。ふたりでひとつ（sugopair）のように、3人では始められないゲームがあるため
    for (const gameId of RT_GAME_IDS) {
      const srv = await startTestServer();
      try {
        const rm = await makeRoom(srv, 6);
        await rm.host.call('room:setState', { phase: 'lobby', game: gameId, reset: true });
        await waitUntil(() => tallyOf(rm.host) && tallyOf(rm.host).total === 6, gameId + '：6人ぶん数える');
        assertEqual(tallyOf(rm.host).all, false, gameId + '：はじめは、そろっていない');
        for (const d of rm.all) {
          const res = await d.call('room:ready', {});
          assertEqual(res.ok, true, gameId + '：押せる');
        }
        await waitUntil(() => tallyOf(rm.host).all === true, gameId + '：そろう');
        const started = await rm.host.call('wolf:start', RT_START_MIN_CONFIG[gameId]);
        assertEqual(started.ok, true, gameId + '：そろってから始められる（' + (started.error || '') + '）');
        await waitUntil(() => tallyOf(rm.host).count === 0, gameId + '：始まったら役目を終える');
        rm.all.forEach((d) => d.close());
      } finally { await srv.close(); }
    }
  });

  await r.test('進行役が切れて交代しても、待っている相手の一覧は正しいまま', async () => {
    // ホストが切れると進行役が移る。移った先の画面に「まだの人」が出るための材料は、
    // 誰がホストかに関係なく同じ公開情報なので、交代で狂わないことを見る
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 3);
      await rm.host.call('room:setState', { phase: 'lobby', game: 'quizrush', reset: true });
      await rm.guests[0].call('room:ready', {});
      await waitUntil(() => tallyOf(rm.guests[1]).count === 1, '1人ぶん届く');
      rm.host.close();
      await waitUntil(() => tallyOf(rm.guests[1]).total === 2, '進行役が抜けて2人になる');
      assertEqual(tallyOf(rm.guests[1]).count, 1, '押した人はそのまま');
      assertEqual(tallyOf(rm.guests[1]).waitingNames.join(','), 'P3', 'まだの人はP3だけ');
      rm.guests.forEach((d) => d.close());
    } finally { await srv.close(); }
  });

  r.finish();
}

run();
