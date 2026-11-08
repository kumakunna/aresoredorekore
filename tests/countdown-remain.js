// tests/countdown-remain.js — 3・2・1 は「0になるサーバーの時刻」の残りから数える（指示68-T 二の束5）
//
// 10/30：3・2・1 は「3秒」とだけ届き、受けた時から数えていた。遅れて受けた TV は遅れて終わり、
// つなぎ直しの最中に知らせを逃すと、その回は出なかった（調べもの3節の3）。
// いまは知らせと部屋の状態（countdownEndsAt）に0になる時刻が入り、端末は残りから数える。残りが1秒より短い時は出さない。
// 時計合わせ（so.offset）は疑似の socket では決まらないので、ここでは「知らせに添えた送った時刻」と端末の時計の道を見る
const { createRunner, assert, assertEqual, launch, sleep } = require('./harness');
const H = require('./harness');
const ButtonScenes = require('../tools/v2-lab/button-scenes');

const 数字 = (doc) => { const n = doc.querySelector('.fx-countdown .fx-cd-num'); return n ? n.textContent : null; };

/** 本物の進行役で作った部屋（ぴったり10秒の「よーい」）に入った端末。room は流し直せる写し */
async function 部屋() {
  const t = await launch({ fakeSocket: true });
  const lab = ButtonScenes.view('pt-set');
  const room = JSON.parse(JSON.stringify(lab.room));
  t.win.__rtFake.replies = { 'room:create': () => ({ ok: true, code: room.code, memberId: 'm1', room }) };
  await H.makeRoomV2(t.win, t.doc);
  t.win.__rtFake.fire('room:update', room);
  await sleep(t.win, 50);
  return Object.assign(t, { room });
}

(async function main() {
  const r = createRunner('countdown-remain：3・2・1 は0になる時刻の残りから（指示68-T 二の束5）');

  await r.test('ふつうに届いた合図：3 から数える（送った時刻から3秒）', async () => {
    const t = await 部屋();
    const now = Date.now();
    t.win.__rtFake.fire('room:countdown', { seconds: 3, endsAt: now + 3000, now: now });
    await sleep(t.win, 30);
    assertEqual(数字(t.doc), '3', '3 から');
    t.win.close();
  });

  await r.test('つなぎ直した端末：部屋の状態の countdownEndsAt から、残りの数で出る（残り2.2秒なら 3 を0.2秒 → 2 → 1）', async () => {
    const t = await 部屋();
    const room = JSON.parse(JSON.stringify(t.room));
    room.countdownEndsAt = Date.now() + 2200;
    t.win.__rtFake.fire('room:update', room);
    await sleep(t.win, 30);
    assertEqual(数字(t.doc), '3', '残り2.2秒は「3」から（切り上げ）');
    await sleep(t.win, 350);
    assertEqual(数字(t.doc), '2', '0.2秒で「2」（ほかの端末と同じ時刻に変わる）');
    // 同じ回の知らせがあとから来ても、2回出さない
    t.win.__rtFake.fire('room:update', room);
    await sleep(t.win, 30);
    assertEqual(t.doc.querySelectorAll('.fx-countdown').length, 1, '2回出さない');
    t.win.close();
  });

  await r.test('残りが1秒より短い時は出さない', async () => {
    const t = await 部屋();
    const room = JSON.parse(JSON.stringify(t.room));
    room.countdownEndsAt = Date.now() + 700;
    t.win.__rtFake.fire('room:update', room);
    await sleep(t.win, 30);
    assertEqual(数字(t.doc), null, '出さない');
    t.win.close();
  });

  // 指示75 1-5（A12）：端末の時計がずれていても（11/7、TV を出す PC が1.9秒進んでいた）、3・2・1 の0は ほかの端末と0.3秒以内。
  // つなぎ直した端末は「送った時刻」を持たない（部屋の状態の countdownEndsAt だけ）ので、端末の時計で数えると、ずれの分だけ早く・遅く0になった。
  // サーバーの時計とのずれ（clock:sync）を測ってから数える
  for (const skew of [2000, -2000]) {
    await r.test('指示75 1-5：端末の時計が ' + (skew > 0 ? '+' : '') + skew / 1000 + '秒ずれていても、つなぎ直した端末の 3・2・1 はサーバーの0の時刻に合う（0.3秒以内）', async () => {
      const t = await launch({ fakeSocket: true });
      const lab = ButtonScenes.view('pt-set');
      const room = JSON.parse(JSON.stringify(lab.room));
      // サーバーの時計＝端末の時計 − skew（端末が skew だけ進んでいる）。
      // 読み込み直した端末：はじめて届く部屋の状態に、もう countdownEndsAt が入っている（時計合わせより先に届く）
      let serverNow = 0;
      t.win.__rtFake.replies = { 'room:create': () => { serverNow = Date.now() - skew; room.countdownEndsAt = serverNow + 2200; return { ok: true, code: room.code, memberId: 'm1', room }; },
        'clock:sync': () => ({ ok: true, now: Date.now() - skew }) };
      await H.makeRoomV2(t.win, t.doc);
      t.win.__rtFake.fire('room:update', room);       // サーバーでは、0まであと2.2秒
      // 「3」は0.2秒だけ。全部の検査を並べて回すと描くのが遅れるので、出たかどうかと「2」になる時刻で見る（落とし穴24：時間は変えない）
      await sleep(t.win, 30);
      assert(数字(t.doc) === '3' || 数字(t.doc) === '2', '3・2・1 が出る（端末の時計で数えると ' + (skew > 0 ? '0.2秒＝出ない' : '4.2秒から') + '・いま ' + 数字(t.doc) + '）');
      const at = Date.now();
      let seen2 = null;
      while (Date.now() - at < 1500 && !seen2) { await sleep(t.win, 20); if (数字(t.doc) === '2') seen2 = Date.now(); }
      assert(seen2, '「2」に変わる');
      const want = serverNow + 200 + skew;          // サーバーの「2」になる時刻を、端末の時計に直した物
      assert(Math.abs(seen2 - want) <= 300, '「2」に変わる時刻のずれ ' + (seen2 - want) + 'ms（0.3秒以内）');
      t.win.close();
    });
  }

  r.finish();
})();
