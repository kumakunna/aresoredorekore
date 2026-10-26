// tests/realtime-pittari.js — 「ぴったり10秒」を本物のサーバーで通す（指示68-4 門1・門3・門6）
//
// 門1：タイムが、通信の遅れ（0〜300ミリ秒を足す）で変わらない。
//      遅い端末をまねる：知らせを受けてから遅れて時計を出し（PittariLogic.Stopwatch）、押した知らせも遅れて送る。
//      サーバーに残ったタイムが、**端末が自分で測った値と1ミリ秒もちがわない**ことを見る。
//      型(b)：同じ押し方をサーバーの時計で測ったら、遅れのぶんだけずれることも先に確かめる（見張りが効いている）
// 門3：開くまで、タイムが TV にもほかの端末にも、押した本人にも届かない（届いた物を全部つないで探す）
// 門6：2人と16人で5回まわる
const { createRunner, assert, assertEqual } = require('./harness');
const { startTestServer, device, waitUntil, makeRoom, sleep } = require('./room-edge');
const L = require('../public/js/pittari-logic');

const W = (srv, code) => srv.store.get(code).pittari;
const viewOf = (d) => (d.room && d.room.state && d.room.state.data) || null;
function rush(srv, code) { const w = W(srv, code); if (w && w.deadline) w.deadline = Date.now() - 1; }
function 記録する(d) { d.log = []; d.socket.onAny((ev, p) => { d.log.push({ ev, at: Date.now(), json: JSON.stringify(p) }); }); return d; }
/** 目標を短くする（検査の時間を縮める。数え方そのものは変わらない） */
function 短く(srv, code, targets) { W(srv, code).rounds = targets.map((t) => ({ target: t, show: true })); }

async function 始める(srv, n) {
  const rm = await makeRoom(srv, n);
  rm.all.forEach((d) => { d.code = rm.code; 記録する(d); });
  const tv = await device(srv.url);
  記録する(tv);
  assertEqual((await tv.call('room:join', { code: rm.code, name: 'テレビ', role: 'bigscreen' })).ok, true, 'TV が入れる');
  const res = await rm.host.call('wolf:start', { game: 'pittari' });
  assertEqual(res.ok, true, 'ぴったり10秒が始まる（' + n + '人）');
  await waitUntil(() => rm.all.every((d) => viewOf(d) && viewOf(d).phase === 'set'), '全員に「よーい」が届く', 6000);
  return Object.assign(rm, { tv });
}

/**
 * 遅い端末：run の知らせが届いてから inMs 遅れて時計を出し、plan ミリ秒たったら押し、押した知らせは outMs 遅れて届く
 * 返す：端末が自分で測ったタイム
 */
function 遅い端末(d, round, inMs, outMs, plan) {
  return new Promise((resolve) => {
    let 見た = false;
    const on = (ev, p) => {
      const v = ev === 'room:state' || ev === 'room:update' ? p : null;
      const data = v && v.room ? v.room.state && v.room.state.data : (v && v.state && v.state.data);
      if (見た || !data || data.phase !== 'run' || data.round !== round) return;
      見た = true;
      d.socket.offAny(on);
      setTimeout(() => {
        const sw = new L.Stopwatch().start(Date.now());
        setTimeout(() => {
          const ms = sw.stop(Date.now());
          setTimeout(() => { d.socket.emit('wolf:act', { ms }, () => {}); resolve(ms); }, outMs);
        }, plan);
      }, inMs);
    };
    d.socket.onAny(on);
  });
}

(async function main() {
  const r = createRunner('realtime-pittari：ぴったり10秒（本物のサーバー・指示68-4）');

  await r.test('門1：タイムは端末の中で測るので、通信の遅れ（0〜300ミリ秒）で変わらない', async () => {
    const srv = await startTestServer();
    try {
      const rm = await 始める(srv, 4);
      短く(srv, rm.code, [1, 1]);
      // 端末ごとに、届く遅れと送る遅れを変える（0・120・300・200 / 300・0・150・60）
      const 遅れ = [[0, 300], [120, 0], [300, 150], [200, 60]];
      const 予定 = [1000, 1080, 950, 1210];
      const 端末 = rm.all.map((d, i) => 遅い端末(d, 1, 遅れ[i][0], 遅れ[i][1], 予定[i]));
      rush(srv, rm.code);   // よーい → はかる
      const 測った = await Promise.all(端末);
      await waitUntil(() => (viewOf(rm.tv) || {}).phase === 'roundResult', '開く', 8000);
      const h = W(srv, rm.code).history[0];
      rm.all.forEach((d, i) => {
        const row = h.rows.find((x) => x.id === d.memberId);
        assert(row, (i + 1) + '人目のタイムが残っている');
        assertEqual(row.ms, 測った[i], (i + 1) + '人目：サーバーのタイム＝端末が測ったタイム（遅れ ' + 遅れ[i].join('＋') + 'ms）');
        // 型(b)：サーバーの時計で「知らせを出した時〜受け取った時」を測ると、遅れのぶんだけ長くなる（このずれを入れない、が門）
        const サーバーで測ったら = 測った[i] + 遅れ[i][0] + 遅れ[i][1];
        if (遅れ[i][0] + 遅れ[i][1] > 0) assert(Math.abs(サーバーで測ったら - row.ms) >= 100, (i + 1) + '人目：サーバーの時計で測れば遅れが入る（型b）');
      });
      [rm.all, [rm.tv]].forEach((list) => list.forEach((d) => d.close()));
    } finally { await srv.close(); }
  });

  await r.test('門2・ありえない値：0より小さい・目標＋10秒より大きい・数でない・2回目ははねる', async () => {
    const srv = await startTestServer();
    try {
      const rm = await 始める(srv, 2);
      rush(srv, rm.code);
      await waitUntil(() => (viewOf(rm.host) || {}).phase === 'run', 'はかる', 4000);
      for (const bad of [-1, 20001, 'abc', null, Infinity]) {
        const res = await rm.host.call('wolf:act', { ms: bad });
        assertEqual(res.ok, false, 'はねる：' + JSON.stringify(bad));
      }
      assertEqual((await rm.host.call('wolf:act', { ms: 20000 })).ok, true, '目標＋10秒ちょうどは受ける');
      assertEqual((await rm.host.call('wolf:act', { ms: 10000 })).ok, false, '2回目ははねる');
      [rm.all, [rm.tv]].forEach((list) => list.forEach((d) => d.close()));
    } finally { await srv.close(); }
  });

  await r.test('門3：開くまで、タイムが TV にもほかの端末にも、押した本人にも届かない（届いた物を全部つないで探す）', async () => {
    const srv = await startTestServer();
    try {
      const rm = await 始める(srv, 3);
      rush(srv, rm.code);
      await waitUntil(() => (viewOf(rm.tv) || {}).phase === 'run', 'はかる', 4000);
      const t0 = Date.now();
      const タイム = [10234, 9871];
      assertEqual((await rm.all[0].call('wolf:act', { ms: タイム[0] })).ok, true, '1人目が押せる');
      assertEqual((await rm.all[1].call('wolf:act', { ms: タイム[1] })).ok, true, '2人目が押せる');
      await waitUntil(() => rm.all[0].you && rm.all[0].you.stopped === true, '本人に「押した」が届く', 3000);
      await sleep(600);
      [rm.tv, rm.all[0], rm.all[1], rm.all[2]].forEach((d, k) => {
        const 字 = d.log.filter((x) => x.at >= t0).map((x) => x.json).join('\n');
        const 誰 = ['TV', '押した本人', '2人目', '押していない人'][k];
        タイム.forEach((ms) => assert(字.indexOf(String(ms)) === -1, 誰 + 'に、タイム ' + ms + ' が届いていない'));
        assert(!/"rows"|"diff"|"stops"|"myDiff":-?\d/.test(字), 誰 + 'に、差や順位が届いていない');
        assert(!/"remainingMs":\d/.test(字), 誰 + 'に、のこり時間が届いていない（数える遊びにならない）');
        assert(/"phase":"run"/.test(字), 誰 + '：はかっている間の知らせそのものは届いている（型b・何も届かずに緑にならない）');
      });
      // 押した本人の知らせに「押した」だけが入っている（型b：本人の知らせは届いている）
      assert(rm.all[0].log.some((x) => x.at >= t0 && /"stopped":true/.test(x.json)), '本人の知らせは届いている（型b）');
      // 開いたら、名前とタイムの差が出る
      rush(srv, rm.code);
      await waitUntil(() => (viewOf(rm.tv) || {}).phase === 'roundResult', '開く', 4000);
      const rv = viewOf(rm.tv).reveal;
      assertEqual(rv.rows.map((x) => x.diff).join(','), '230,-130', '開いたら差が出る（遠い順・100分の1秒にまるめる）');
      assertEqual(rv.crowned.join(','), rm.all[1].name, 'いちばん近い人に冠');
      assertEqual(rv.missed, 1, '押さなかった人の数（名前は出さない）');
      [rm.all, [rm.tv]].forEach((list) => list.forEach((d) => d.close()));
    } finally { await srv.close(); }
  });

  for (const n of [2, 16]) {
    await r.test('門6：' + n + '人で、本物のサーバーで5回まわり、結果が出る', async () => {
      const srv = await startTestServer();
      try {
        const rm = await 始める(srv, n);
        const rounds = W(srv, rm.code).rounds;
        for (let q = 1; q <= 5; q++) {
          rush(srv, rm.code);
          await waitUntil(() => (viewOf(rm.host) || {}).phase === 'run' && viewOf(rm.host).round === q, q + '回目のはかる', 6000);
          const target = rounds[q - 1].target;
          for (let i = 0; i < rm.all.length; i++) {
            // 1人目はいつもぴったり。ほかは少しずつずれる
            const res = await rm.all[i].call('wolf:act', { ms: target * 1000 + i * 37 });
            assertEqual(res.ok, true, q + '回目 ' + (i + 1) + '人目');
          }
          await waitUntil(() => (viewOf(rm.host) || {}).phase === 'roundResult' && viewOf(rm.host).round === q, q + '回目が開く（全員押したら待たない）', 6000);
          rush(srv, rm.code);
        }
        await waitUntil(() => (viewOf(rm.host) || {}).phase === 'ended', '5回で終わる', 6000);
        const res = viewOf(rm.host).result;
        assertEqual(res.rounds, 5, '5回');
        assertEqual(res.ranking[0].name, rm.all[0].name, 'いつもぴったりの人が1位');
        assertEqual(res.ranking[0].score, 5 * 4 + 10, '5点×4回＋最後は2倍で10点');
        assertEqual(res.awards.perfect.join(','), rm.all[0].name, 'ぴったりの人');
        assertEqual(res.awards.master.join(','), rm.all[0].name, '体内時計の名人');
        [rm.all, [rm.tv]].forEach((list) => list.forEach((d) => d.close()));
      } finally { await srv.close(); }
    });
  }

  r.finish();
})();
