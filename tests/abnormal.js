// tests/abnormal.js — 異常系シナリオの検証（第35弾D）
//
// docs/監査_異常系シナリオ.md の d07/d08/d09/d11/d13 をサーバー直叩きで固定する。
// 原則：サーバー権威。不正・重複・手遅れ・故障は、サーバー側で拒否または吸収され、
// 部屋が壊れたりプロセスが落ちたりしないこと。

const { startTestServer, device, waitUntil, makeRoom, sleep } = require('./room-edge');
const { createRunner, assert, assertEqual } = require('./harness');
const { RT_START_EVENT } = require('./inventory');

const WW_CFG = {
  game: 'wordwolf', wolfCount: 1, wolfAware: true, roles: {},
  multiTurn: false, meetingSec: 0, discussSec: 0
};

// ワードウルフ3人を「あと1票で決着」まで進める
async function toFinalVote(srv, rm) {
  const room = () => srv.store.get(rm.code);
  for (const d of rm.all) await d.call('wolf:act', { targetId: null });
  await rm.host.call('wolf:next', {});
  await rm.host.call('wolf:next', {});
  await waitUntil(() => room().wordwolf.phase === 'vote', '投票フェーズに入る');
  const wolfId = room().wordwolf.wolfIds[0];
  const devs = rm.all;
  const wolfDev = devs.find((d) => d.memberId === wolfId);
  const sheep = devs.filter((d) => d !== wolfDev);
  // シープ1人目とウルフが投票済み・シープ2人目が最後の1票
  await sheep[0].call('wolf:vote', { targetId: wolfId });
  await wolfDev.call('wolf:vote', { targetId: sheep[0].memberId });
  return { room, lastVoter: sheep[1], wolfId };
}

async function run() {
  const r = createRunner('abnormal：通信・異常系・状態復帰');

  await r.test('d13：記録のDB書き込みが失敗しても、サーバーが落ちず決着まで進む', async () => {
    // saveMatchRecord の INSERT はゲーム決着の最後の1票のハンドラ内で走る。
    // ここで例外が漏れると uncaughtException＝プロセス落ち＝部屋全滅になる
    const brokenDb = {
      prepare() { throw new Error('テスト用：DBが書けません（ディスク満杯を想定）'); },
      countPairs() {}, pairInfo() { return null; }
    };
    const srv = await startTestServer({ db: brokenDb });
    const caught = [];
    const trap = (e) => { caught.push(e && e.message); };
    process.on('uncaughtException', trap);
    try {
      const rm = await makeRoom(srv, 3);
      await rm.host.call(RT_START_EVENT, WW_CFG);
      const { room, lastVoter, wolfId } = await toFinalVote(srv, rm);
      const res = await lastVoter.call('wolf:vote', { targetId: wolfId });
      assertEqual(res.ok, true, '最後の1票は受け付けられる');
      await waitUntil(() => room().wordwolf.phase === 'roundResult', 'ターン結果が出る');
      // 記録はホストが結果を送って ended になった瞬間に走る（そこでDBが失敗する）
      const nx = await rm.host.call('wolf:next', {});
      assertEqual(nx.ok, true, '結果送りは受け付けられる');
      await sleep(400);
      assertEqual(caught.length, 0,
        'DB失敗がプロセスまで漏れない（漏れた: ' + caught.join(' / ') + '）');
      assertEqual(room().wordwolf.phase, 'ended', '記録に失敗してもゲームは決着する');
      // 部屋はその後も生きている（別の操作が通る）
      const peek = await rm.host.call('room:peek', { code: rm.code, memberId: rm.host.memberId });
      assertEqual(peek.ok, true, '決着後も部屋は操作できる');
    } finally {
      process.removeListener('uncaughtException', trap);
      await srv.close();
    }
  });

  await r.test('d07：同じ人の二重投票は1票のまま・集計は一度だけ', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 3);
      await rm.host.call(RT_START_EVENT, WW_CFG);
      const { room, lastVoter, wolfId } = await toFinalVote(srv, rm);
      // 最後の1票を「同時に」2連射（awaitせず同フレームで送る）
      const p1 = lastVoter.call('wolf:vote', { targetId: wolfId });
      const p2 = lastVoter.call('wolf:vote', { targetId: wolfId });
      const [r1, r2] = await Promise.all([p1, p2]);
      await sleep(300);
      assertEqual(room().wordwolf.phase, 'roundResult', '締切が成立して集計に入る');
      // 2発目は「もう投票フェーズではない」拒否か、上書きの冪等either。二重集計だけは起きない
      const votes = room().wordwolf.voteRounds[0];
      assertEqual(Object.keys(votes).length, 3, '票は3人ぶんだけ（二重集計なし・実際:' +
        Object.keys(votes).length + '票）');
      assert(r1.ok || r2.ok, '少なくとも一方は受理される');
    } finally { await srv.close(); }
  });

  await r.test('d07：開始の二重送信は2発目が「もう始まっています」で拒否される', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 3);
      const p1 = rm.host.call(RT_START_EVENT, WW_CFG);
      const p2 = rm.host.call(RT_START_EVENT, WW_CFG);
      const [r1, r2] = await Promise.all([p1, p2]);
      const oks = [r1, r2].filter((x) => x.ok).length;
      assertEqual(oks, 1, '開始は1回だけ通る（実際:' + oks + '回）');
      const rejected = [r1, r2].find((x) => !x.ok);
      assertEqual(rejected.error, 'already_started', '2発目の理由が「もう始まっています」');
      // ついでに：ホスト以外の開始はそもそも拒否
      const r3 = await rm.all[1].call(RT_START_EVENT, WW_CFG);
      assertEqual(r3.error, 'not_host', 'ホスト以外は始められない');
    } finally { await srv.close(); }
  });

  await r.test('d11：締切（全員投票）と同時に届いた遅れ票は拒否され、集計は一度だけ', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 3);
      await rm.host.call(RT_START_EVENT, WW_CFG);
      const { room, lastVoter, wolfId } = await toFinalVote(srv, rm);
      // 最後の1票（締切成立）と、別の人の「出し直し」を同フレームで送る
      const someoneElse = rm.all.find((d) => d !== lastVoter);
      const pFinal = lastVoter.call('wolf:vote', { targetId: wolfId });
      const pLate = someoneElse.call('wolf:vote', { targetId: lastVoter.memberId });
      const [rf, rl] = await Promise.all([pFinal, pLate]);
      await sleep(300);
      assertEqual(room().wordwolf.phase, 'roundResult', '締切が成立して集計に入る');
      assertEqual(rf.ok, true, '締切を成立させた票は受理');
      assertEqual(rl.ok, false, '締切後に処理された票は拒否（実際:' + JSON.stringify(rl) + '）');
      assertEqual(room().wordwolf.voteRounds.length, 1, '集計は1回だけ');
    } finally { await srv.close(); }
  });

  await r.test('d09：存在しない・解散済みの部屋コードは、入室も在室確認も正しく断られる', async () => {
    const srv = await startTestServer();
    try {
      const d = await device(srv.url);
      const r1 = await d.call('room:join', { code: 'ZZZZZZ', name: 'まいご' });
      assertEqual(r1.ok, false, '存在しないコードは入れない');
      assertEqual(r1.error, 'room_not_found', '理由が room_not_found');
      // 部屋を作って解散→古いコード（=古いQR相当）で入り直し
      const rm = await makeRoom(srv, 2);
      const code = rm.code;
      await rm.host.call('room:close', {});
      await sleep(200);
      const r2 = await d.call('room:join', { code, name: 'おそい' });
      assertEqual(r2.ok, false, '解散済みの部屋には入れない');
      const r3 = await d.call('room:peek', { code, memberId: 'm_x' });
      assertEqual(r3.ok, false, '在室確認も「無い」と答える（フェーズAのdropRoom導線）');
    } finally { await srv.close(); }
  });

  await r.test('d08：同じmemberIdの入り直しは復帰扱い・接続中の同名は別人として増える', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 2);
      const room = () => srv.store.get(rm.code);
      const before = room().members.size;
      // 2つ目のタブ相当：同じmemberIdで別socketから入り直す
      const tab2 = await device(srv.url);
      const r1 = await tab2.call('room:join', { code: rm.code, name: rm.host.name || 'ホスト', memberId: rm.host.memberId });
      assertEqual(r1.ok, true, '同じmemberIdの入り直しは受け付ける');
      assertEqual(r1.memberId, rm.host.memberId, '別人にならず同じ枠に復帰する');
      assertEqual(room().members.size, before, '名簿は増えない');
      // 接続中の同名（memberIdなし）は別人として増える（設計コメントどおり）
      const dup = await device(srv.url);
      const r2 = await dup.call('room:join', { code: rm.code, name: 'ゲスト1' });
      assertEqual(r2.ok, true, '同名でも入れる');
      assert(r2.memberId !== rm.all[1].memberId, '接続中の同名は別人として扱う');
      assertEqual(room().members.size, before + 1, '名簿が1人増える');
    } finally { await srv.close(); }
  });

  r.finish();
}

if (require.main === module) run();
module.exports = { run };
