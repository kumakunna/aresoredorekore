// tests/realtime-onaji.js — 「みんなと同じ」を本物のサーバーで通す（指示68-3 門1・門3）
//
// 門1：開くまで、だれが何を選んだか・何人選んだかが、TV にもほかの端末にも届かない。
//      **届いた物を全部つないで探す**（部屋の知らせも、本人だけの知らせも、TV に届いた物も）
// 門3：3人と16人で、本物のサーバーで5問回る（進むのは芯の見回り。締め切りを過去へずらして追い越す・落とし穴24）
const { createRunner, assert, assertEqual } = require('./harness');
const { startTestServer, device, waitUntil, makeRoom } = require('./room-edge');

const stateOf = (srv, code) => srv.store.get(code).onaji;
const viewOf = (d) => (d.room && d.room.state && d.room.state.data) || null;
function rush(srv, code) { const w = stateOf(srv, code); if (w && w.deadline) w.deadline = Date.now() - 1; }
/** 届いた物を全部ためる（何の知らせでも） */
function 記録する(d) { d.log = []; d.socket.onAny((ev, p) => { d.log.push({ ev, at: Date.now(), json: JSON.stringify(p) }); }); return d; }

async function 始める(srv, n, mode) {
  const rm = await makeRoom(srv, n);
  rm.all.forEach((d) => { d.code = rm.code; 記録する(d); });
  const tv = await device(srv.url);
  記録する(tv);
  const j = await tv.call('room:join', { code: rm.code, name: 'テレビ', role: 'bigscreen' });
  assertEqual(j.ok, true, 'TV が入れる');
  const res = await rm.host.call('wolf:start', { game: 'onaji', mode: mode || 'many' });
  assertEqual(res.ok, true, 'みんなと同じが始まる（' + n + '人）');
  await waitUntil(() => rm.all.every((d) => viewOf(d) && viewOf(d).phase === 'choose'), '全員に「選ぶ」が届く', 6000);
  return Object.assign(rm, { tv });
}

(async function main() {
  const r = createRunner('realtime-onaji：みんなと同じ（本物のサーバー・指示68-3）');

  await r.test('門1：開くまで、だれが何を選んだか・答えごとの人数が、TV にもほかの端末にも届かない（届いた物を全部つないで探す）', async () => {
    const srv = await startTestServer();
    try {
      const rm = await 始める(srv, 4);
      const t0 = Date.now();
      // 3人が選ぶ（4人目はまだ）。選んだ番号はわざとばらばらにして、どこかに漏れたら見つかる形に
      const 選ぶ = [2, 0, 1];
      for (let i = 0; i < 3; i++) {
        const res = await rm.all[i].call('wolf:act', { pick: 選ぶ[i] });
        assertEqual(res.ok, true, (i + 1) + '人目が選べる');
      }
      const again = await rm.all[0].call('wolf:act', { pick: 1 });
      assertEqual(again.ok, false, '選んだら変えられない');
      await waitUntil(() => (viewOf(rm.tv) || {}).chosen && viewOf(rm.tv).chosen.length === 3, 'TV に選び終わった人の名前が3人', 4000);
      const 開く前 = (d) => d.log.filter((x) => x.at >= t0).map((x) => x.ev + ' ' + x.json);
      // TV とほかの端末（4人目）に届いた物：答えの番号・人数・名前と答えの組が無い
      [rm.tv, rm.all[3]].forEach((d, k) => {
        const 字 = 開く前(d).join('\n');
        assert(!/"counts"|"answers"|"winners"|"crowned"/.test(字), (k ? '4人目' : 'TV') + 'に人数や答えが届いていない');
        assert(!/"myChoice":[0-9]/.test(字), (k ? '4人目' : 'TV') + 'に、ほかの人の選んだ番号が届いていない');
        assert(/"chosen":\[/.test(字), '型(b)：選び終わった人の名前は届いている（見張っている物が届いている）');
      });
      // 選んだ本人には、自分の番号だけ
      await waitUntil(() => rm.all[0].you && rm.all[0].you.myChoice === 2, '本人に自分の番号', 3000);
      // 2人目は0を選んだ。ほかの人の番号（2・1）は、2人目に届いた物のどこにも無い
      assert(開く前(rm.all[1]).every((x) => !/"myChoice":[12]\b/.test(x)), 'ほかの人の番号は届かない');
      // 開く（4人目が選ばずに時間切れ）→ 開いたら人数と名前が出る
      rush(srv, rm.code);
      await waitUntil(() => (viewOf(rm.tv) || {}).phase === 'unveil', '開く', 4000);
      const rv = viewOf(rm.tv).reveal;
      assertEqual(rv.counts.join(','), '1,1,1' + (rv.counts.length === 4 ? ',0' : ''), '開いたら答えごとの人数');
      assertEqual(rv.scatter, true, '全員ちがう答え＝ばらばら');
      [rm.all, [rm.tv]].forEach((list) => list.forEach((d) => d.close()));
    } finally { await srv.close(); }
  });

  for (const n of [3, 16]) {
    await r.test('門3：' + n + '人で、本物のサーバーで5問回り、結果（順位・称号）が出る', async () => {
      const srv = await startTestServer();
      try {
        const rm = await 始める(srv, n);
        for (let q = 1; q <= 5; q++) {
          await waitUntil(() => (viewOf(rm.host) || {}).phase === 'choose' && viewOf(rm.host).round === q, q + '問目の「選ぶ」', 6000);
          // 全員が選ぶ（みんな0番＝そろう。最後の1人だけ1番）→ 全員そろえば時間切れを待たずに開く
          for (let i = 0; i < rm.all.length; i++) {
            const res = await rm.all[i].call('wolf:act', { pick: i === rm.all.length - 1 ? 1 : 0 });
            assertEqual(res.ok, true, q + '問目 ' + (i + 1) + '人目');
          }
          await waitUntil(() => (viewOf(rm.host) || {}).phase === 'unveil' && viewOf(rm.host).round === q, q + '問目が開く（全員そろったら待たない）', 6000);
          assertEqual(viewOf(rm.host).reveal.counts[0], n - 1, q + '問目：0番が ' + (n - 1) + '人');
          rush(srv, rm.code);
        }
        await waitUntil(() => (viewOf(rm.host) || {}).phase === 'ended', '5問で終わる', 6000);
        const res = viewOf(rm.host).result;
        assertEqual(res.questions, 5, '5問');
        assertEqual(res.ranking.length, n, '全員の順位');
        assertEqual(res.ranking[0].score, 5, '多い方を選び続けた人は5点');
        assertEqual(res.awards.solo.join(','), rm.all[rm.all.length - 1].name, 'ひとりだけの答えをいちばん多く出した人');
        assertEqual(res.awards.same.length, n - 1, 'いちばんみんなと同じだった人（並んだら全員）');
        [rm.all, [rm.tv]].forEach((list) => list.forEach((d) => d.close()));
      } finally { await srv.close(); }
    });
  }

  await r.test('一致団結：順位を出さず、そろい度だけ', async () => {
    const srv = await startTestServer();
    try {
      const rm = await 始める(srv, 3, 'team');
      for (let q = 1; q <= 5; q++) {
        await waitUntil(() => (viewOf(rm.host) || {}).phase === 'choose' && viewOf(rm.host).round === q, q + '問目', 6000);
        for (const d of rm.all) await d.call('wolf:act', { pick: 0 });
        await waitUntil(() => (viewOf(rm.host) || {}).phase === 'unveil' && viewOf(rm.host).round === q, q + '問目が開く', 6000);
        assertEqual(viewOf(rm.host).reveal.together, true, '全員そろった');
        rush(srv, rm.code);
      }
      await waitUntil(() => (viewOf(rm.host) || {}).phase === 'ended', '終わる', 6000);
      const res = viewOf(rm.host).result;
      assertEqual(res.ranking, null, '順位は出さない');
      assertEqual(res.sync, 100, 'そろい度 100');
      assertEqual(res.together, 5, '5問とも全員そろった');
      [rm.all, [rm.tv]].forEach((list) => list.forEach((d) => d.close()));
    } finally { await srv.close(); }
  });

  r.finish();
})();
