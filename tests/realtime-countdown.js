// tests/realtime-countdown.js — 開始の 3-2-1 が0になるまで、ゲームは始まっていない（指示63 第4部）
//
// それまでは `room:countdown` を送るのと同時にゲームが始まっていて、
// 3-2-1 の最中に持ち時間が減り、盤も押せた（指示62：6カセットで再現）。
// 直す場所は芯（realtime.js）の開始の1か所：
//   ・進行役の状態の絶対時刻を、数える長さぶん後ろへずらす（ポーズと同じ shiftTimes）
//   ・数えている間の操作（act／vote／next）は not_started で断る
//
// **全ゲームを正本（GAME_DRIVERS）から回す**（落とし穴4）。
// ほかの実サーバーの検査は 3-2-1 を0にしている（1本ごとに3秒延びるため・落とし穴24）。
// だから**実時間で数える検査を、ここに1本残す**。

const { createRunner, assert, assertEqual } = require('./harness');
const { startTestServer, makeRoom, sleep } = require('./room-edge');
const { RT_GAME_IDS, RT_START_EVENT, RT_START_MIN_CONFIG } = require('./inventory');
const { GAME_DRIVERS } = require('../realtime');

/** 進行役の状態から、いちばん近い締め切り（絶対時刻）を拾う。無ければ null */
function 締め切り(w) {
  if (!w) return null;
  if (typeof w.deadline === 'number' && w.deadline > 1e12) return w.deadline;
  // 爆弾解除のように、入れ物ごとに持つもの
  const 入れ物 = w.entries ? Object.keys(w.entries).map((k) => w.entries[k]) : [];
  const ds = 入れ物.map((e) => e && e.deadline).filter((d) => typeof d === 'number' && d > 1e12);
  return ds.length ? Math.min.apply(null, ds) : null;
}

/** そのゲームを始めて、始めた時刻と、進行役の状態と、部屋を返す */
async function 始める(gameId, countdownMs) {
  const srv = await startTestServer({ countdownMs });
  const rm = await makeRoom(srv, 6);
  const t0 = Date.now();
  const res = await rm.host.call(RT_START_EVENT, RT_START_MIN_CONFIG[gameId]);
  const room = srv.store.get(rm.code);
  const w = room && room[GAME_DRIVERS[gameId].key];
  return { srv, rm, t0, res, room, w };
}
async function 片付け(x) { x.rm.all.forEach((d) => d.close()); await x.srv.close(); }

async function run() {
  const r = createRunner('realtime-countdown：開始の3-2-1が0になるまで始まらない（指示63 第4部）');

  await r.test('全ゲーム：3-2-1 の最中の操作は not_started で断られ、締め切りは3-2-1のぶん後ろへずれる', async () => {
    let 締め切りを見た = 0;
    for (const gameId of RT_GAME_IDS) {
      // 比べる相手：3-2-1 を0にした同じゲーム（始めてから締め切りまでの長さ）
      const 無し = await 始める(gameId, 0);
      assertEqual(無し.res.ok, true, gameId + '：始められる（' + (無し.res.error || '') + '）');
      const d0 = 締め切り(無し.w);
      const 無しの長さ = d0 ? d0 - 無し.t0 : null;
      // 型(c)：0 の時は、すぐ操作が通る側（断られない）——門が「0なら開く」ことも見る
      const 無しの操作 = await 無し.rm.host.call('wolf:act', {});
      assert(無しの操作.error !== 'not_started', gameId + '：3-2-1 が0なら、not_started では断られない');
      await 片付け(無し);

      const 有り = await 始める(gameId, 3000);
      assertEqual(有り.res.ok, true, gameId + '：3-2-1 ありでも始められる');
      const 操作 = await 有り.rm.host.call('wolf:act', {});
      assertEqual(操作.error, 'not_started', gameId + '：3-2-1 の最中の act は断られる');
      const 投票 = await 有り.rm.guests[0].call('wolf:vote', {});
      assertEqual(投票.error, 'not_started', gameId + '：3-2-1 の最中の vote も断られる');
      const 次 = await 有り.rm.host.call('wolf:next', {});
      assertEqual(次.error, 'not_started', gameId + '：3-2-1 の最中は、進行役も進められない');
      const d1 = 締め切り(有り.w);
      if (d0 && d1) {
        締め切りを見た++;
        const 差 = (d1 - 有り.t0) - 無しの長さ;
        // 上限をゆるめに取る：とくとくクイズの最初の締め切りは「次の1文字が出る時刻」で、
        // 問題の長さで毎回少し違う。ずらし忘れなら差は 0 付近になるので、下限で見分けられる
        assert(差 > 2600 && 差 < 4200,
          gameId + '：締め切りが 3-2-1 のぶん（3秒）後ろへずれている（いま ' + 差 + 'ms）');
      }
      await 片付け(有り);
    }
    // 型(b)：締め切りを持つゲームで、本当に比べられているか
    assert(締め切りを見た >= 5, '締め切りを持つゲームで比べられている（いま ' + 締め切りを見た + '）');
  });

  /**
   * **3-2-1 の合図は、盤より先に届く。**
   * 爆弾解除は startGame の中で盤を配りきっていて（問題バンクの説明文がその場でそろう）、
   * 合図より先に盤が届いていた。手元は数字が無いまま盤を描き、吹き出しを出した（指示62・1-3 が残っていた）。
   * 型(c)：全ゲームで見る（盤をその場で配るゲームと、配らないゲームの両方が入る）
   */
  await r.test('全ゲーム：参加者の端末には、3-2-1 の合図が、始まった状態や手元の秘密より先に届く', async () => {
    let 先に盤が来た = 0;
    for (const gameId of RT_GAME_IDS) {
      const srv = await startTestServer({ countdownMs: 3000 });
      const rm = await makeRoom(srv, 6);
      try {
        const 届いた順 = [];
        const g = rm.guests[0].socket;
        g.on('room:countdown', () => 届いた順.push('合図'));
        g.on('room:update', (v) => { if (v && v.state && v.state.phase && v.state.phase !== 'lobby') 届いた順.push('始まった状態'); });
        g.on('wolf:you', () => 届いた順.push('秘密'));
        const res = await rm.host.call(RT_START_EVENT, RT_START_MIN_CONFIG[gameId]);
        assertEqual(res.ok, true, gameId + '：始められる（' + (res.error || '') + '）');
        await sleep(400);
        assert(届いた順.length >= 2, gameId + '：合図と状態が届いている（型(b)：いま ' + 届いた順.join('→') + '）');
        if (届いた順[0] !== '合図') 先に盤が来た++;
        assertEqual(届いた順[0], '合図', gameId + '：最初に届くのは 3-2-1 の合図（いま ' + 届いた順.join('→') + '）');
      } finally { rm.all.forEach((d) => d.close()); await srv.close(); }
    }
    assertEqual(先に盤が来た, 0, '合図より先に盤が届いたゲームが無い');
  });

  /**
   * **実時間で数える1本**（落とし穴24）。
   * 爆弾解除の協力版で：数えている間は持ち時間が減らず、押しても断られ、
   * 0 になったら押せる
   */
  await r.test('実時間：爆弾解除は 3-2-1 の間は持ち時間が減らず、0 になったら押せる', async () => {
    const x = await 始める('bomb', 3000);
    try {
      assertEqual(x.res.ok, true, '始められる');
      assertEqual(x.w.phase, 'play', '盤が配られている（型(b)：押す相手がいる）');
      const 持ち時間 = x.w.timerSec * 1000;
      assert(持ち時間 > 0, '持ち時間のある設定で試している');
      await sleep(2000);
      const 途中 = 締め切り(x.w) - Date.now();
      assert(途中 >= 持ち時間, '2秒たっても持ち時間は減っていない（残り ' + 途中 + 'ms／持ち時間 ' + 持ち時間 + 'ms）');
      const 盤 = x.rm.host.you && x.rm.host.you.board;
      assert(盤 && 盤.length, '盤が届いている');
      const 早い = await x.rm.host.call('wolf:act', { targetId: 盤[0].uid });
      assertEqual(早い.error, 'not_started', '数えている間は押せない');
      await sleep(1200);
      const 後 = await x.rm.host.call('wolf:act', { targetId: 盤[0].uid });
      assertEqual(後.ok, true, '0 になったら押せる（' + (後.error || '') + '）');
      const 減り始め = 締め切り(x.w) - Date.now();
      assert(減り始め < 持ち時間, '0 になったあとは持ち時間が減り始める');
    } finally { await 片付け(x); }
  });

  r.finish();
}

module.exports = { run };
if (require.main === module) run();
