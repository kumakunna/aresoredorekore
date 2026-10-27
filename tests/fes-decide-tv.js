// tests/fes-decide-tv.js — 投票の「決定」（TV）を台本どおりに（指示68-S 3）
//
// 台本：0〜0.75 ため（候補の札・照明が落ちる）→ 0.75〜2.5 スポットライトが札から札へ、だんだんゆっくり（行き先は決まった物）
// → 2.5 決まった札で止まり、まん中へ飛び出す・世界の色が広がる → 3.0「◯人がえらびました！」。全部で5秒以内。
// 候補が1つの時は、札が上から落ちてきて「これだ！」のはんこ。
// 見本は本物の進行役（fes-room.js）を動かして作る（tools/v2-lab/fes-scenes.js・落とし穴25）

const { createRunner, assert, assertEqual, launch } = require('./harness');
const SC = require('../tools/v2-lab/scenes.js');

(async function main() {
  const r = createRunner('fes-decide-tv：投票の決定（TV・指示68-S の台本）');
  const t = await launch({ fakeSocket: true });
  const W = t.win;
  function 描く(id) {
    const lab = SC.view(id, {});
    W.V2Screens.fes(lab);
    return { box: W.document.getElementById('scr-v2-fes-tv'), view: { fes: lab.room.fes } };
  }

  await r.test('候補が3つ：スポットライトは札から札へ、だんだんゆっくり、決まった札で止まる（2.5秒）', async () => {
    const { box, view } = 描く('fes2-tv-decide');
    const tl = W.V2Fes.decideTimeline(view);
    assert(!tl.single && tl.list.length >= 2, '候補が2つ以上（' + tl.list.join(',') + '）');
    assertEqual(tl.list[tl.pick], view.fes.pick.mode, '止まる札は、決まったゲーム');
    assertEqual(tl.hops[tl.hops.length - 1].k, tl.pick, '最後のスポットライトは決まった札');
    assert(Math.abs(tl.hops[0].at - 0.75) < 1e-9, 'ため（0.75秒）のあとに動き出す');
    for (let i = 1; i < tl.hops.length; i++) {
      assert(tl.hops[i].dur > tl.hops[i - 1].dur, 'だんだんゆっくり（' + i + '）');
      assert(tl.hops[i].k !== tl.hops[i - 1].k, '毎回となりの札へ移る（' + i + '）');
    }
    const 終わり = tl.hops[tl.hops.length - 1].at + tl.hops[tl.hops.length - 1].dur;
    assert(Math.abs(終わり - 2.5) < 1e-6, '2.5秒で止まる（' + 終わり + '）');
    assertEqual(tl.stop, 2.5, '止まる時刻'); assertEqual(tl.who, 3, '人数の一言');
    assert(tl.who + 0.25 <= 5, '全部で5秒以内');
    assertEqual(box.querySelectorAll('.v2-dcard').length, tl.list.length, '候補の札が並ぶ');
    assertEqual(box.querySelectorAll('.v2-dhop').length, tl.hops.length, 'スポットライト');
    assert(/えらびました/.test(box.querySelector('.v2-dwin .v2-who5').textContent), '「◯人がえらびました！」');
    assert(!box.querySelector('.v2-dstamp'), '候補が複数の時は、はんこを押さない');
  });

  await r.test('候補が1つ：札が上から落ちてきて「これだ！」のはんこ（スポットライトは無い）', async () => {
    const { box, view } = 描く('fes2-tv-decide-one');
    const tl = W.V2Fes.decideTimeline(view);
    assert(tl.single, '候補が1つの回');
    assertEqual(tl.hops.length, 0, 'スポットライトは動かない');
    assertEqual(box.querySelectorAll('.v2-dcard, .v2-dhop').length, 0, '並べる札は無い');
    assert(/これだ！/.test(box.querySelector('.v2-dstamp').textContent), '「これだ！」');
    assert(box.querySelector('.v2-tdec2.is-single'), '落ちてくる形');
  });

  t.win.close();
  r.finish();
})();
