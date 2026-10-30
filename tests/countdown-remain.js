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

  r.finish();
})();
