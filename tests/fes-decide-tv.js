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

  await r.test('指示76 1-1（A1）：札の中は上から「絵→名前→小さい字」。3枚で絵の位置がそろい、小さい字は名前に重ならない', async () => {
    const css = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const card = (css.match(/\.v2 \.v2-dcard\{[^}]*\}/) || [''])[0];
    assert(/justify-content:flex-start/.test(card) && /padding-top:108px/.test(card), '上から詰める（まん中にそろえると、小さい字の無い札だけ絵が下がった）：' + card);
    assert(css.indexOf('.v2 .v2-dcard-t small{display:block;font-size:52px;margin-top:30px;}') !== -1, '小さい字は名前の下の行・間 30px');
    // 小さい字は「（協力版）」「（多い方）」の2つ。並べた札の名前の中に入る
    const { box } = 描く('fes2-tv-decide-a');
    const smalls = Array.from(box.querySelectorAll('.v2-dcard .v2-dcard-t small')).map((x) => x.textContent);
    assertEqual(smalls.join('/'), '（協力版）/（多い方）', '小さい字のある札');
  });

  // ---- 指示78 ウ（11/12 くまくんの実機・答え 1.B）：決まる段の TV が、途中の描き直しで動きを切らない ----
  // それまでは、最初に描いてから 0.8秒より後に部屋の知らせが来て描き直すと is-play が外れ、最後の形に飛んでいた
  //（tools/decide-tv-probe.js --poke：1.5秒目の係の入／切で、札が飛び出す・世界の色が広がる・印がはずむが出なかった）。
  // TV として入る本物の道（部屋の知らせ → rtSync → fesRender）で見る。見本の入口（V2Screens.fes）は描き直しを通らない
  const FesScenes = require('../tools/v2-lab/fes-scenes');
  const { waitFor, sleep } = require('./harness');
  const URL = 'http://localhost/?room=TST754&fes=1&tv=1';
  const 写す = (x) => JSON.parse(JSON.stringify(x));
  async function TVで(sceneId) {
    const room = FesScenes.view(sceneId).room;
    const seed = 'window.__rtFake.replies = { "room:join": function(p, cb){ setTimeout(function(){ cb({ ok: true, code: "TST754", memberId: "tv", room: ' + JSON.stringify(FesScenes.view('fes2-tv-lobby').room) + ' }); }, 30); return undefined; } };';
    const v = await launch({ url: URL, fakeSocket: true, rtSeed: seed, noDoorWait: true });
    const box = () => v.doc.getElementById('scr-v2-fes-tv');
    await waitFor(v.win, () => (v.doc.querySelector('.screen.active') || {}).id === 'scr-v2-fes-tv', 6000, 'TV の画面');
    // 描き直し（中身の入れかえ）の時刻を拾う
    const 描いた = [];
    new v.win.MutationObserver(() => 描いた.push({ t: Date.now(), dec: !!box().querySelector('.v2-tdec2'), play: box().classList.contains('is-play') })).observe(box(), { childList: true });
    const t0 = Date.now();
    v.win.__rtFake.fire('room:update', 写す(room));
    await waitFor(v.win, () => box().querySelector('.v2-tdec2') && box().classList.contains('is-play'), 2000, '決まる段が動き出す');
    return { v, box, room, 描いた, t0 };
  }
  /** 名前を1人だけ変えた知らせ（人が入った・名前が変わった、の代わり。TV の名前の壁に出る） */
  function 名前を変えて(room, name) { const x = 写す(room); x.members.find((m) => m.role === 'player').name = name; return x; }

  await r.test('指示78 ウ：1.5秒目に描き直しの知らせが来ても、is-play が残り、中身を入れかえない（動きが最後まで流れる）', async () => {
    const { v, box, room } = await TVで('fes2-tv-decide');
    const 札 = box().querySelector('.v2-tdec2');
    await sleep(v.win, 1500);
    v.win.__rtFake.fire('room:update', 名前を変えて(room, 'あとから'));
    assert(box().classList.contains('is-play'), '1.5秒目の知らせのあとも is-play が残る');
    assert(box().querySelector('.v2-tdec2') === 札, '中身を入れかえていない（動きの途中の要素がそのまま）');
    const h = v.win.fesTvDecideHoldProbe();
    assert(h && h.waited >= 1, '知らせを待たせている（' + JSON.stringify(h) + '）');
    await sleep(v.win, 1200);
    assert(box().classList.contains('is-play') && box().querySelector('.v2-tdec2') === 札, '2.7秒目（台本の途中）も、そのまま');
    v.win.close();
  });

  await r.test('指示78 ウ：台本が終わったら、知らせが来なくても最新の形で1回描く（係の操作も 4秒以内に TV に出る）', async () => {
    const { v, box, room, 描いた, t0 } = await TVで('fes2-tv-decide');
    await sleep(v.win, 1500);
    v.win.__rtFake.fire('room:update', 名前を変えて(room, 'あとから'));
    assert(!/あとから/.test(box().textContent), '待っている間は、まだ出ない');
    await waitFor(v.win, () => /あとから/.test(box().textContent), 3000, '台本のあと、最新の名前が出る');
    const 出た = Date.now() - t0;
    assert(出た <= 4300, '最初の決まる段の描画から 4秒（＋測りのゆとり）以内に出た（' + 出た + 'ms）');
    assert(!box().classList.contains('is-play'), '描き直したあとは止まった最後の形（動きは流しなおさない）');
    assertEqual(v.win.fesTvDecideHoldProbe(), null, '待つのは終わっている');
    // 知らせが1つも来なくても、時計で1回描く
    const n = 描いた.length;
    v.win.close();
    const b = await TVで('fes2-tv-decide');
    const n0 = b.描いた.length;
    await waitFor(b.v.win, () => b.描いた.length > n0, 4300, '知らせが無くても、台本のあと1回描く');
    assert(Date.now() - b.t0 <= 4300, '4秒以内');
    assert(n >= 2, '描いた記録がある');
    b.v.win.close();
  });

  await r.test('指示78 ウ：待っている間に段が変わったら（準備・作り直し・つながり）、待たずにすぐ描く', async () => {
    const { v, box } = await TVで('fes2-tv-decide');
    await sleep(v.win, 1000);
    v.win.__rtFake.fire('room:update', 写す(FesScenes.view('fes2-tv-ready').room));
    assert(box().querySelector('.v2-tvB') && !box().querySelector('.v2-tdec2'), '準備の段に変わったら、その場で準備の画面');
    assertEqual(v.win.fesTvDecideHoldProbe(), null, '待つのをやめた');
    v.win.close();
    // 部屋の作り直し（部屋のコードが変わる）
    const b = await TVで('fes2-tv-decide');
    await sleep(b.v.win, 1000);
    const 新 = 名前を変えて(b.room, 'つくりなおし'); 新.code = 'NEW999';
    b.v.win.__rtFake.fire('room:update', 新);
    assert(/つくりなおし/.test(b.box().textContent), '部屋が変わったら、その場で描く');
    b.v.win.close();
    // つながりが切れて戻った（つないだ回数が変わる）
    const c = await TVで('fes2-tv-decide');
    await sleep(c.v.win, 1000);
    c.v.win.__rtFake.fire('disconnect'); c.v.win.__rtFake.fire('connect');   // 切れて、つなぎ直した（rt-client がつないだ回数を数える）
    c.v.win.__rtFake.fire('room:update', 名前を変えて(c.room, 'もどった'));
    assert(/もどった/.test(c.box().textContent), 'つなぎ直したら、その場で描く');
    c.v.win.close();
  });

  await r.test('指示78 ウ：4秒をこえて描き直さない形にならない（知らせが続いても、待つのは 4秒まで）', async () => {
    const { v, box, room, t0 } = await TVで('fes2-tv-decide');
    const h = v.win.fesTvDecideHoldProbe();
    assert(h && h.ms > 0 && h.ms <= 4000, '待つ長さは 4秒まで（' + (h && h.ms) + 'ms）');
    let i = 0, 出た = null;
    while (Date.now() - t0 < 6000 && 出た == null) {
      v.win.__rtFake.fire('room:update', 名前を変えて(room, 'つぎ' + (++i)));
      if (new RegExp('つぎ' + i).test(box().textContent)) 出た = Date.now() - t0;
      await sleep(v.win, 250);
    }
    assert(出た != null && 出た <= 4300, '知らせが 0.25秒ごとに続いても、4秒以内に最新が出る（' + 出た + 'ms）');
    // 決まる段が終わる前でも、二度目からは待たない（同じ回の2回目の待ちは作らない）
    assertEqual(v.win.fesTvDecideHoldProbe(), null, '同じ回でまた待ちに入らない');
    v.win.close();
  });

  t.win.close();
  r.finish();
})();
