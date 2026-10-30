// tests/realtime-quiz2.js — クイズ王2.0「みんなで早答え」「数字ちかい方」を本物のサーバーで通す（指示68-5 門1・門5）
//
// 門1：開くまで、正解（3択の番号・数字の答え）が TV にも、どの端末にも届かない（届いた物を全部つないで探す）
// 門5：2人と16人で最後まで回る（早答え10問・数字ちかい方5問）
const { createRunner, assert, assertEqual } = require('./harness');
const { startTestServer, device, waitUntil, makeRoom, sleep } = require('./room-edge');

const viewOf = (d) => (d.room && d.room.state && d.room.state.data) || null;
function 記録する(d) { d.log = []; d.socket.onAny((ev, p) => { d.log.push({ ev, at: Date.now(), json: JSON.stringify(p) }); }); return d; }
function rush(srv, code, game) { const w = srv.store.get(code)[game]; if (w && w.deadline) w.deadline = Date.now() - 1; }

async function 始める(srv, n, game) {
  const rm = await makeRoom(srv, n);
  rm.all.forEach((d) => { d.code = rm.code; 記録する(d); });
  const tv = await device(srv.url);
  記録する(tv);
  assertEqual((await tv.call('room:join', { code: rm.code, name: 'テレビ', role: 'bigscreen' })).ok, true, 'TV が入れる');
  const res = await rm.host.call('wolf:start', { game });
  assertEqual(res.ok, true, game + ' が始まる（' + n + '人）');
  const ph = game === 'qhaya' ? 'choose' : 'guess';
  await waitUntil(() => rm.all.every((d) => viewOf(d) && viewOf(d).phase === ph), '全員に問題が届く', 6000);
  return Object.assign(rm, { tv });
}
const 閉じる = (rm) => [rm.all, [rm.tv]].forEach((list) => list.forEach((d) => d.close()));

(async function main() {
  const r = createRunner('realtime-quiz2：クイズ王2.0（本物のサーバー・指示68-5）');

  await r.test('門1（早答え）：開くまで、正解の番号が TV にもどの端末にも届かない。開いたら正解と、正解の人の名前だけ', async () => {
    const srv = await startTestServer();
    try {
      const rm = await 始める(srv, 3, 'qhaya');
      const w = srv.store.get(rm.code).qhaya;
      const c = w.qs[0].correct, wrong = (c + 1) % w.qs[0].choices.length;
      const t0 = Date.now() - 2000;   // 始めた時の知らせから全部見る
      assertEqual((await rm.all[0].call('wolf:act', { pick: c, ms: 1500 })).ok, true, '1人目が答える（正解）');
      assertEqual((await rm.all[1].call('wolf:act', { pick: wrong, ms: 900 })).ok, true, '2人目が答える（まちがい）');
      await waitUntil(() => rm.all[0].you && rm.all[0].you.myPick === c, '本人に「押した」が届く', 3000);
      await sleep(400);
      [rm.tv, rm.all[0], rm.all[1], rm.all[2]].forEach((d, k) => {
        const 字 = d.log.filter((x) => x.at >= t0).map((x) => x.json).join('\n');
        const 誰 = ['TV', '正解した本人', 'まちがえた本人', '答えていない人'][k];
        assert(!/"correct"/.test(字), 誰 + 'に、正解の番号が届いていない');
        assert(!/"myRight":(true|false)/.test(字), 誰 + 'に、当たったかどうかが届いていない');
        assert(!/"right":\[/.test(字), 誰 + 'に、正解の人の一覧が届いていない');
        assert(/"phase":"choose"/.test(字), 誰 + '：答えている間の知らせそのものは届いている（型b）');
      });
      assert(/"answered":2/.test(rm.tv.log.map((x) => x.json).join('\n')), 'TV には答えた人数だけ（光の粒）');
      rush(srv, rm.code, 'qhaya');
      await waitUntil(() => (viewOf(rm.tv) || {}).phase === 'unveil', '開く', 4000);
      const rv = viewOf(rm.tv).reveal;
      assertEqual(rv.correct, c, '開いたら正解');
      assertEqual(rv.right.map((x) => x.name).join(','), rm.all[0].name, '名前は正解の人だけ（まちがえた人は出さない）');
      assertEqual(rv.fastest.join(','), rm.all[0].name, 'いちばん早かったのは正解の人の中から（まちがいの0.9秒は入らない）');
      assertEqual(rv.counts.reduce((a, b) => a + b, 0), 2, '答えごとの人数');
      閉じる(rm);
    } finally { await srv.close(); }
  });

  await r.test('早さの時間：端末の時間はありえる範囲に寄せる（サーバーの時間より長くない・遅れ1.5秒より短くない）・押したら変えられない', async () => {
    const srv = await startTestServer();
    try {
      const rm = await 始める(srv, 3, 'qhaya');
      const w = srv.store.get(rm.code).qhaya;
      w.startedAt = Date.now() - 4000;                                  // 問題が出てから4秒たったことにする
      await rm.all[0].call('wolf:act', { pick: 0, ms: 100 });          // 0.1秒は早すぎる（遅れは1.5秒まで）
      await rm.all[1].call('wolf:act', { pick: 0, ms: 9000 });         // 9秒はサーバーの時間より長い
      await rm.all[2].call('wolf:act', { pick: 0, ms: 3200 });         // ありえる
      assert(w.answers[rm.all[0].memberId].ms >= 2500, '早すぎる時間は、遅れのぶんまでに寄せる（' + w.answers[rm.all[0].memberId].ms + '）');
      assert(w.answers[rm.all[1].memberId].ms <= 4100, '長すぎる時間は、サーバーの時間に寄せる（' + w.answers[rm.all[1].memberId].ms + '）');
      assertEqual(w.answers[rm.all[2].memberId].ms, 3200, 'ありえる時間はそのまま');
      assertEqual((await rm.all[2].call('wolf:act', { pick: 1, ms: 3300 })).ok, false, '2回目ははねる');
      for (const bad of [-1, 9, 'x', null]) assertEqual((await rm.tv.call('wolf:act', { pick: bad })).ok, false, 'TV・ありえない番号ははねる：' + bad);
      閉じる(rm);
    } finally { await srv.close(); }
  });

  await r.test('門1（数字ちかい方）：開くまで、正解の数が TV にもどの端末にも届かない。開いたら全員の答え（名前つき・遠い人から）', async () => {
    const srv = await startTestServer();
    try {
      const rm = await 始める(srv, 3, 'qnear');
      const w = srv.store.get(rm.code).qnear;
      w.qs[0] = { q: 'ためしの山の標高は何m？', unit: 'm', answer: 98765, table: 'test' };   // ほかの数とまざらない答え
      const t0 = Date.now() - 2000;
      assertEqual((await rm.all[0].call('wolf:act', { value: '98,700' })).ok, true, '1人目（カンマつき）');
      assertEqual((await rm.all[1].call('wolf:act', { value: 50000 })).ok, true, '2人目');
      for (const bad of ['', '-5', '1.5', 'abc', '1234567890']) assertEqual((await rm.all[2].call('wolf:act', { value: bad })).ok, false, 'はねる：' + bad);
      await sleep(400);
      [rm.tv, rm.all[0], rm.all[1], rm.all[2]].forEach((d, k) => {
        const 字 = d.log.filter((x) => x.at >= t0).map((x) => x.json).join('\n');
        const 誰 = ['TV', '答えた本人', '2人目', '答えていない人'][k];
        assert(字.indexOf('98765') === -1, 誰 + 'に、正解の数が届いていない');
        assert(!/"answer":/.test(字), 誰 + 'に、答えの欄が届いていない');
        assert(/"phase":"guess"/.test(字), 誰 + '：入れている間の知らせそのものは届いている（型b）');
      });
      assert(rm.tv.log.map((x) => x.json).join('\n').indexOf('98700') === -1, 'TV に、だれかの答えの数も届いていない');
      rush(srv, rm.code, 'qnear');
      await waitUntil(() => (viewOf(rm.tv) || {}).phase === 'unveil', '開く', 4000);
      const rv = viewOf(rm.tv).reveal;
      assertEqual(rv.answer, 98765, '開いたら正解');
      assertEqual(rv.rows.map((x) => x.name).join(','), [rm.all[1].name, rm.all[0].name].join(','), '遠い人から並ぶ');
      assertEqual(rv.crowned.join(','), rm.all[0].name, 'いちばん近い人に冠');
      assertEqual(rv.missed, 1, '答えなかった人の数（名前は出さない）');
      閉じる(rm);
    } finally { await srv.close(); }
  });

  for (const n of [2, 16]) {
    await r.test('門5：' + n + '人で、早答え10問が最後まで回る（最後は2倍・3問ごとに順位）', async () => {
      const srv = await startTestServer();
      try {
        const rm = await 始める(srv, n, 'qhaya');
        const w = srv.store.get(rm.code).qhaya;
        for (let q = 1; q <= 10; q++) {
          await waitUntil(() => (viewOf(rm.host) || {}).phase === 'choose' && viewOf(rm.host).round === q, q + '問目', 6000);
          const c = w.qs[q - 1].correct;
          for (let i = 0; i < rm.all.length; i++) {
            // 1人目はいつも正解・いちばん早い。ほかは正解とまちがいを交互に
            const pick = i === 0 || (i + q) % 2 === 0 ? c : (c + 1) % w.qs[q - 1].choices.length;
            assertEqual((await rm.all[i].call('wolf:act', { pick, ms: 3000 + i * 10 })).ok, true, q + '問目 ' + (i + 1) + '人目');
          }
          await waitUntil(() => (viewOf(rm.host) || {}).phase === 'unveil' && viewOf(rm.host).round === q, q + '問目が開く（全員答えたら待たない）', 6000);
          const rv = viewOf(rm.host).reveal;
          assertEqual(!!rv.ranking, q % 3 === 0 || q === 10, q + '問目：順位は3問ごとと最後だけ');
          assertEqual(rv.double, q === 10, q + '問目：2倍は最後だけ');
          rush(srv, rm.code, 'qhaya');
        }
        await waitUntil(() => (viewOf(rm.host) || {}).phase === 'ended', '10問で終わる', 6000);
        const res = viewOf(rm.host).result;
        assertEqual(res.questions, 10, '10問');
        assertEqual(res.champion.join(','), rm.all[0].name, 'いつも正解の人が1位');
        assert(res.ranking[0].score >= 9 * 100 + 200, '正解10問ぶん（最後は2倍）以上（' + res.ranking[0].score + '）');
        閉じる(rm);
      } finally { await srv.close(); }
    });

    await r.test('門5：' + n + '人で、数字ちかい方5問が最後まで回る', async () => {
      const srv = await startTestServer();
      try {
        const rm = await 始める(srv, n, 'qnear');
        const w = srv.store.get(rm.code).qnear;
        for (let q = 1; q <= 5; q++) {
          await waitUntil(() => (viewOf(rm.host) || {}).phase === 'guess' && viewOf(rm.host).round === q, q + '問目', 6000);
          const ans = w.qs[q - 1].answer;
          for (let i = 0; i < rm.all.length; i++) {
            // 1人目はいつもぴったり。ほかは少しずつ遠い
            assertEqual((await rm.all[i].call('wolf:act', { value: ans + i * 7 })).ok, true, q + '問目 ' + (i + 1) + '人目');
          }
          await waitUntil(() => (viewOf(rm.host) || {}).phase === 'unveil' && viewOf(rm.host).round === q, q + '問目が開く（全員決定したら待たない）', 6000);
          assertEqual(viewOf(rm.host).reveal.perfect.join(','), rm.all[0].name, q + '問目：ぴったりの人');
          rush(srv, rm.code, 'qnear');
        }
        await waitUntil(() => (viewOf(rm.host) || {}).phase === 'ended', '5問で終わる', 6000);
        const res = viewOf(rm.host).result;
        assertEqual(res.questions, 5, '5問');
        assertEqual(res.ranking[0].name, rm.all[0].name, 'いつもぴったりの人が1位');
        assertEqual(res.ranking[0].score, 5 * (5 + 5), '1位5点＋ぴったり5点 × 5問');
        閉じる(rm);
      } finally { await srv.close(); }
    });
  }

  r.finish();
})();
