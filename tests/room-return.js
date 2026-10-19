// tests/room-return.js — 「← 部屋を出る」のあと、同じ人として戻る（指示63 2-1）
//
// 退室は名簿から消す（members.delete）。そのまま残して、消す前に**部屋の控え**に写す。
// 同じ memberId で入り直すと、控えから同じ id で作り直す——観戦の表示・自分の行・2試合目が、
// ゲームごとの直しなしでそろう（どの画面も privateFor(memberId) で分かれる）。
//
// くまくんの判断（2026-10-20）：
//   ・戻せるのは**待合と決着のあいだだけ**（試合の途中は、今までどおり新しい人として見るだけ）
//   ・**進行役には戻さない**
// kick（出された人）は控えに写さない。

const { createRunner, assert, assertEqual } = require('./harness');
const { startTestServer, device, makeRoom, waitUntil } = require('./room-edge');
const { RT_START_EVENT, RT_START_MIN_CONFIG } = require('./inventory');

async function 出る(d) {
  const res = await d.call('room:leave', { code: d.code, memberId: d.memberId });
  assertEqual(res.ok, true, d.name + ' が出られる');
}
async function 戻る(srv, d, memberId) {
  const nd = await device(srv.url);
  const res = await nd.call('room:join', { code: d.code, name: d.name, memberId });
  return { nd, res };
}

async function run() {
  const r = createRunner('room-return：部屋を出ても、同じ人として戻る（指示63 2-1）');

  await r.test('待合で出て、同じ memberId で戻ると、同じ人として戻る（名簿の行・名前・役割）', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 4);
      const g = rm.guests[0];
      const 前 = g.memberId;
      await 出る(g);
      const room = srv.store.get(rm.code);
      assert(!room.members.has(前), '出たら名簿から消える（今までどおり）');
      const peek = await rm.host.call('room:peek', { code: rm.code, memberId: 前 });
      assertEqual(peek.canReturn, true, '待合なら「戻れる」とサーバーが答える');
      const { nd, res } = await 戻る(srv, g, 前);
      assertEqual(res.ok, true, '入り直せる');
      assertEqual(res.memberId, 前, '同じ memberId で戻る');
      assert(room.members.has(前), '名簿に同じ人として戻っている');
      assertEqual(room.members.get(前).name, g.name, '名前もそのまま');
      assertEqual(room.members.size, 4, '人数は元どおり（増えていない）');
      nd.close();
      rm.all.forEach((d) => d.close());
    } finally { await srv.close(); }
  });

  await r.test('決着の画面で出て戻ると、自分の結果が届く（観戦にならない）', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 3);
      const res0 = await rm.host.call(RT_START_EVENT, RT_START_MIN_CONFIG.bomb);
      assertEqual(res0.ok, true, '爆弾解除を始められる');
      const room = srv.store.get(rm.code);
      // 本物の道で決着させる：外れを選んでライフを使い切る（協力版はライフ3）
      for (let i = 0; i < 6 && room.bomb.phase !== 'ended'; i++) {
        await waitUntil(() => rm.host.you && rm.host.you.board, '盤が届く');
        const cell = rm.host.you.board.find((c) => !c.solved);
        assertEqual((await rm.host.call('wolf:act', { targetId: cell.uid })).ok, true, 'コードを開ける');
        await waitUntil(() => rm.host.you && rm.host.you.open && rm.host.you.open.uid === cell.uid, '3択が届く');
        const wire = room.bomb.wires.find((w) => w.uid === cell.uid);
        const はずれ = rm.host.you.open.choices.find((c) => c !== wire.choices[wire.correct]);
        await rm.host.call('wolf:vote', { targetId: はずれ });
      }
      assertEqual(room.bomb.phase, 'ended', '決着している（条件が作れている）');
      const g = rm.guests[0];
      const 前 = g.memberId;
      await 出る(g);
      const { nd, res } = await 戻る(srv, g, 前);
      assertEqual(res.ok, true, '入り直せる');
      assertEqual(res.memberId, 前, '決着の画面なら、同じ人として戻る');
      await waitUntil(() => nd.you, '本人の情報（privateFor）が届く＝観戦ではない');
      assertEqual(nd.you.phase, 'ended', '届いたのは決着の情報');
      nd.close();
      rm.all.forEach((d) => d.close());
    } finally { await srv.close(); }
  });

  await r.test('試合の途中で出て戻ると、新しい人（見るだけ）として入る（くまくんの判断2）', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 3);
      assertEqual((await rm.host.call(RT_START_EVENT, RT_START_MIN_CONFIG.bomb)).ok, true, '始められる');
      const room = srv.store.get(rm.code);
      assertEqual(room.bomb.phase, 'play', '遊んでいる途中（条件が作れている）');
      const g = rm.guests[0];
      const 前 = g.memberId;
      await 出る(g);
      const peek = await rm.host.call('room:peek', { code: rm.code, memberId: 前 });
      assertEqual(peek.canReturn, false, '途中は「戻れない」と答える');
      const { nd, res } = await 戻る(srv, g, 前);
      assertEqual(res.ok, true, '入れはする');
      assert(res.memberId !== 前, '途中は同じ人として戻さない（新しい id）');
      nd.close();
      rm.all.forEach((d) => d.close());
    } finally { await srv.close(); }
  });

  await r.test('出された人（kick）は、同じ人として戻さない', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 3);
      const g = rm.guests[0];
      const 前 = g.memberId;
      assertEqual((await rm.host.call('room:kick', { memberId: 前 })).ok, true, '進行役が出せる');
      const peek = await rm.host.call('room:peek', { code: rm.code, memberId: 前 });
      assertEqual(peek.canReturn, false, '出された人は「戻れない」');
      const { nd, res } = await 戻る(srv, g, 前);
      assert(res.memberId !== 前, '出された人は、新しい人として入る');
      nd.close();
      rm.all.forEach((d) => d.close());
    } finally { await srv.close(); }
  });

  await r.test('進行役が出て戻っても、進行役には戻さない（くまくんの判断3）', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 3);
      const 前 = rm.host.memberId;
      await 出る(rm.host);
      const room = srv.store.get(rm.code);
      assert(room.hostMemberId && room.hostMemberId !== 前, '進行役はほかの人へ移る（今までどおり）');
      const { nd, res } = await 戻る(srv, rm.host, 前);
      assertEqual(res.memberId, 前, '同じ人としては戻る');
      assert(room.hostMemberId !== 前, '進行役には戻らない');
      nd.close();
      rm.guests.forEach((d) => d.close());
    } finally { await srv.close(); }
  });

  r.finish();
}

module.exports = { run };
if (require.main === module) run();
