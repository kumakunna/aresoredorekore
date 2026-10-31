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
    // 同じ札が光るのは1秒に3回まで（同じ札にもどるまでの間が 1/3 秒より長い）
    for (let i = 0; i < tl.hops.length; i++) for (let j = i + 1; j < tl.hops.length; j++) {
      if (tl.hops[j].k === tl.hops[i].k) { assert(tl.hops[j].at - tl.hops[i].at > 1 / 3, '同じ札の光りなおしは1秒に3回まで（' + i + '→' + j + '）'); break; }
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

  await r.test('68-S の残り5：候補の札を大きく（高さ 640px・印 280px）。名前は1行（入らなければ縮める）', async () => {
    const css = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'index.html'), 'utf8');
    assert(css.indexOf('.v2 .v2-dcards{position:absolute;left:0;right:0;top:50%;margin-top:-250px;height:640px;') !== -1, '札の高さ 640px（前は 460px）');
    assert(css.indexOf('.v2 .v2-dcard-tile{width:280px;height:280px;}') !== -1, '印 280px（前は 200px）');
    const { box } = 描く('fes2-tv-decide');
    const n = box.querySelector('.v2-dcard-n');
    assert(n && n.hasAttribute('data-v2-fit') && n.classList.contains('v2-cut'), '名前は1行で、入らなければ字を小さく');
  });

  t.win.close();
  r.finish();
})();
