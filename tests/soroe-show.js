// tests/soroe-show.js — そろえて発射の見せ場（指示68-T 三の束1「台本の直し」）
//
// 10/30 の声：「どこまで上がれるのか分からない」「宇宙までだれも行けない」「ぽてっが横になっただけ」。台本の直し：
//   ・カウントの間から、画面の右はしに高さの目じるし（下から ビルの上・雲の上・月・宇宙＝いちばん上で光る星）。その日の最高の所に小さな旗
//   ・発射は1段 0.9秒。上がっている間、目じるしを小さなロケットの印がのぼる。着く前の0.4秒はゆっくり（最後の段だけ止まる曲線）
//   ・ぽてっは全部で1.6秒（浮く0.4 → ふらふら2回0.6 → 倒れてはねる0.4 → 「ぽてっ」の字0.2）
//   ・宇宙まで行っても6秒以内（0.75＋0.5＋4×0.9＋着いた1.0＝5.85秒）
// 見本は本物の進行役（soroe-room.js）で作る（tools/v2-lab/button-scenes.js・落とし穴25）
const { createRunner, assert, assertEqual, launch } = require('./harness');
const ButtonScenes = require('../tools/v2-lab/button-scenes');

(async function main() {
  const r = createRunner('soroe-show：そろえて発射の見せ場（指示68-T 三の束1）');
  const t = await launch({ fakeSocket: true });
  const W = t.win, D = t.doc;
  const box = D.createElement('div');
  box.className = 'screen v2 v2-tv is-play';
  D.body.appendChild(box);
  const 描く = (id) => { const lab = ButtonScenes.view(id); const v = { data: lab.room.state.data, members: lab.room.members, meId: 'tv', you: {}, fes: null, end: Date.now() + 8000 }; box.innerHTML = W.V2Soroe.tv(v); return v; };

  await r.test('カウントの間：右はしに高さの目じるし（ビルの上・雲の上・月・宇宙の星）。ロケットの印は下で止まっている', async () => {
    描く('so-tv-launch');
    const g = box.querySelector('.v2-sogauge');
    assert(g, '目じるしがある');
    assertEqual(Array.prototype.map.call(g.querySelectorAll('.v2-sog-m b'), (b) => b.textContent).join('・'), 'ビルの上・雲の上・月・宇宙', '下から順に');
    assert(g.querySelector('.v2-sog-m.is-space i'), '宇宙はいちばん上で光る星');
    assert(g.querySelector('.v2-sog-rk.is-still'), 'ロケットの印は下');
    assert(!g.querySelector('.v2-sog-flag'), 'その日の記録がまだ無い時は旗なし');
  });

  await r.test('その日の最高の高さを部屋が覚え、目じるしに旗が立つ（つぎの回のカウントの間も）', async () => {
    const lab = ButtonScenes.view('so-tv-film-moon');
    assertEqual(lab.room.state.data.bestHeight, 'moon', '月まで行ったら、その日の最高は月');
    描く('so-tv-film-moon');
    const flag = box.querySelector('.v2-sog-flag');
    assert(flag, '旗');
    assertEqual(flag.style.bottom, W.V2Soroe.MARK.moon + '%', '旗は月の所');
  });

  await r.test('発射：1段 0.9秒。宇宙まで行っても6秒以内。ロケットの印は着く高さまで同じ長さでのぼる', async () => {
    const v = 描く('so-tv-film-space');
    const tl = W.V2Soroe.timeline(v.data.reveal);
    assertEqual(W.V2Soroe.STEP_S, 0.9, '1段 0.9秒');
    assertEqual(tl.k, 4, '宇宙は4段');
    assert(Math.abs(tl.arrive - (tl.climb + 0.9 * 4 + 0.05)) < 1e-9, '着くのは 4段のあと（' + tl.arrive + '）');
    assert(tl.arrive + 1.0 <= 6.0, '着いた字を1秒見せても6秒以内（' + (tl.arrive + 1.0).toFixed(2) + '秒）');
    const rk = box.querySelector('.v2-sog-rk:not(.is-still)');
    assert(rk, 'のぼるロケットの印');
    assertEqual(rk.style.getPropertyValue('--to'), W.V2Soroe.MARK.space + '%', '宇宙の所まで');
    assert(/3\.60s/.test(rk.style.animationDuration), '長さは景色と同じ 3.6秒（' + rk.style.animationDuration + '）');
    const css = D.documentElement.outerHTML;
    const k4 = css.slice(css.indexOf('@keyframes v2-soclimb4'), css.indexOf('@keyframes v2-soclimb4') + 600);
    assert(k4.indexOf('75%{transform:translateY(60%);animation-timing-function:cubic-bezier(.32,.72,0,1);}') !== -1, '最後の段だけ、ゆっくり止まる曲線');
    assert(k4.indexOf('25%{transform:translateY(20%);animation-timing-function:linear;}') !== -1, '途中の段は同じ速さ');
  });

  await r.test('ぽてっ：ロケットは1.4秒（浮く → ふらふら2回 → 倒れてはねる）、そのあと「ぽてっ」の字が落ちてはねる（0.2秒）。全部で1.6秒', async () => {
    const v = 描く('so-tv-film-plop');
    const tl = W.V2Soroe.timeline(v.data.reveal);
    assertEqual(v.data.reveal.height, 'plop', 'ぽてっの回');
    assert(Math.abs(tl.arrive - (tl.lift + 1.4)) < 1e-9, '字はロケットが止まった時（' + tl.arrive + '）');
    const a = box.querySelector('.v2-soarrive.is-plop');
    assert(a && /ぽてっ/.test(a.textContent), '「ぽてっ」の字');
    const css = D.documentElement.outerHTML;
    assert(/\.v2\.is-play \.v2-soscene\.is-plop \.v2-sorkt\{animation:v2-soplop calc\(1\.4s/.test(css), 'ロケットは1.4秒');
    assert(/\.v2\.is-play \.v2-soarrive\.is-plop\{animation-name:v2-soplopt;animation-duration:calc\(\.2s/.test(css), '字は0.2秒で落ちてはねる');
    const m = /@keyframes v2-soplop\{([\s\S]*?)\}\}/.exec(css);
    const 傾き = (m[1].match(/rotate\(-?\d+deg\)/g) || []).filter((x) => /rotate\(-?1[0-4]deg\)/.test(x)).length;
    assert(傾き >= 4, '左右に2回ふらふら（' + 傾き + '）');
    // 10/31：倒れたロケットが発射台の上で浮いていた。発射台の横の地面（場面の下から8%）まで落ちて、1回はねて止まる
    assert(css.indexOf('.v2 .v2-soscene.is-plop .v2-sorkt{left:64%;bottom:calc(8% - var(--rkw) * .2);') !== -1, '止まった形は発射台の横の地面');
    assert(m[1].indexOf('100%{left:64%;bottom:calc(8% - var(--rkw) * .2);') !== -1 && m[1].indexOf('94%{left:64%;bottom:calc(11% - var(--rkw) * .2);') !== -1, '地面で1回はねて、地面で止まる');
    assert(m[1].indexOf('0%{left:50%;bottom:10%;') !== -1, '発射台の上から始まる');
  });

  await r.test('飛ばない回は、目じるしのロケットの印も下のまま', async () => {
    描く('so-tv-film-notflew');
    assert(box.querySelector('.v2-sog-rk.is-still'), '下のまま');
  });

  t.win.close();
  r.finish();
})();
