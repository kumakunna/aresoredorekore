// tests/tv-wait.js — TV がいる部屋のスマホは、TV の台本で同じ物が出る時刻まで結果を出さない（指示68-T 二の束3）
//
// 10/30 のあそびテスト：8人がスマホを見ていると、TV の「ため」が全部ばれていた（調べもの2節）。
// そろえて発射の phoneRevealHtml と同じ考えを、投票の決定・ぴったり10秒・みんなと同じ・クイズ王2 に入れた：
//   ・部品に「TV で出る秒」（data-tvat・V2.tvAt）。その時刻まで .is-tvwait で隠し、中の動きも止める
//   ・時計は「この段階を最初に描いた時」から。描き直しても数え直さない。演出「なし」でも TV より先に出さない
//   ・TV がいない部屋は今までどおりすぐ出す
// 部屋の知らせは本物の進行役で作った見本データ（tools/v2-lab/）を流す（落とし穴25）
const { createRunner, assert, assertEqual, launch, waitFor, sleep } = require('./harness');
const H = require('./harness');
const ButtonScenes = require('../tools/v2-lab/button-scenes');
const OnajiScenes = require('../tools/v2-lab/onaji-scenes');
const Quiz2Scenes = require('../tools/v2-lab/quiz2-scenes');

const act = (doc) => (doc.querySelector('.screen.active') || {}).id;

/** 見本の部屋をスマホ（me）として流す。tv:false なら TV の端末を部屋から外す */
async function 場面(lab, screen, o) {
  o = o || {};
  const t = await launch(Object.assign({ fakeSocket: true }, o.launch || {}));
  const room = JSON.parse(JSON.stringify(lab.room));
  if (o.tv === false) room.members = room.members.filter((m) => m.role !== 'bigscreen');
  t.win.__rtFake.replies = { 'room:create': () => ({ ok: true, code: room.code, memberId: lab.meId || 'm1', room }) };
  await H.makeRoomV2(t.win, t.doc);
  t.win.__rtFake.fire('room:update', room);
  t.win.__rtFake.fire('wolf:you', lab.you || {});
  await waitFor(t.win, () => act(t.doc) === screen, 3000, screen + ' へ');
  return Object.assign(t, { room, lab });
}
const 隠れている = (doc, sel) => { const n = doc.querySelector('.screen.active ' + sel); return !!n && n.classList.contains('is-tvwait'); };

(async function main() {
  const r = createRunner('tv-wait：TV がいる部屋のスマホは、TV より先に結果を出さない（指示68-T 二の束3）');
  const W = await launch();
  const V2Pittari = W.win.V2Pittari, V2Onaji = W.win.V2Onaji, V2Quiz2 = W.win.V2Quiz2;

  await r.test('ぴったり10秒：自分の差・順位・+点は TV の冠（timeline の end）まで出ない。札は TV で刺さる時刻に1枚ずつ', async () => {
    const lab = ButtonScenes.view('pt-reveal');
    const t = await 場面(lab, 'scr-v2-pittari');
    const rows = lab.room.state.data.reveal.rows;
    const end = V2Pittari.timeline(rows).end;
    const mine = t.doc.querySelector('#scr-v2-pittari .v2-omine');
    assert(mine, '自分の結果の箱がある');
    assertEqual(+mine.getAttribute('data-tvat'), +end.toFixed(2), 'TV の冠の秒');
    assert(mine.classList.contains('is-tvwait'), '描いた直後は隠れている');
    const pins = t.doc.querySelectorAll('#scr-v2-pittari .v2-ptpin');
    assertEqual(pins.length, rows.length, '札が人数分');
    const tl = V2Pittari.timeline(rows);
    Array.prototype.forEach.call(pins, (p, i) => assertEqual(+p.getAttribute('data-tvat'), +(tl.pins[i].at + tl.pins[i].dur).toFixed(2), i + '枚目は TV で刺さる秒'));
    assert(!t.win.sfxProbe().log.some((x) => x.id === 'cheer'), '歓声もまだ鳴らさない');
    // 描き直しても、頭から数え直さない（残りだけ待つ）
    await sleep(t.win, 1000);
    t.win.__rtFake.fire('room:update', t.room);
    await sleep(t.win, 50);
    assert(隠れている(t.doc, '.v2-omine'), '描き直しても、まだ隠れている');
    await sleep(t.win, Math.max(0, end * 1000 - 1050) + 300);
    assert(!隠れている(t.doc, '.v2-omine'), 'TV の冠の時刻を過ぎたら出る（描き直しで遅れない）');
    assertEqual(t.win.tvWaitProbe().waiting, 0, '隠れている物は残っていない');
    t.win.close();
  });

  await r.test('ぴったり10秒：TV がいない部屋は、今までどおりすぐ出す', async () => {
    const t = await 場面(ButtonScenes.view('pt-reveal'), 'scr-v2-pittari', { tv: false });
    assert(!t.doc.querySelector('#scr-v2-pittari [data-tvat]'), '待つ印が無い');
    assertEqual(t.win.tvWaitProbe().waiting, 0, '隠れている物が無い');
    t.win.close();
  });

  await r.test('ぴったり10秒：演出「なし」でも、TV より先に出さない', async () => {
    const t = await 場面(ButtonScenes.view('pt-reveal'), 'scr-v2-pittari', { launch: { fxSkip: true } });
    assert(隠れている(t.doc, '.v2-omine'), '「なし」でも隠れている');
    t.win.close();
  });

  await r.test('みんなと同じ：人数と冠は TV の冠（tl.crown）、名前と自分の +1 は TV の名前の札（tl.tags）まで出ない', async () => {
    const lab = OnajiScenes.view('onaji-unveil');
    const t = await 場面(lab, 'scr-v2-onaji');
    const tl = V2Onaji.timeline({ data: lab.room.state.data });
    const bars = t.doc.querySelector('#scr-v2-onaji .v2-obars');
    assertEqual(+bars.getAttribute('data-tvat'), +tl.crown.toFixed(2), '人数の棒は TV の冠の秒');
    assert(bars.classList.contains('is-tvwait'), '人数はまだ見えない（0秒で出ていた）');
    const mine = t.doc.querySelector('#scr-v2-onaji .v2-omine');
    if (mine) assertEqual(+mine.getAttribute('data-tvat'), +tl.tags.toFixed(2), '自分の答えと +1 は TV の名前の札の秒');
    const names = t.doc.querySelector('#scr-v2-onaji .v2-onames');
    if (names) assertEqual(+names.getAttribute('data-tvat'), +tl.tags.toFixed(2), '名前は TV の名前の札の秒');
    t.win.close();
  });

  await r.test('クイズ王2（早答え）：正解と自分の結果は TV の正解の札が光る時刻（tl.stop）まで出ない', async () => {
    const lab = Quiz2Scenes.view('qh-open');
    const t = await 場面(lab, 'scr-v2-qhaya');
    const n = t.doc.querySelector('#scr-v2-qhaya .v2-q2mine');
    assertEqual(+n.getAttribute('data-tvat'), +V2Quiz2.haya.timeline({ data: lab.room.state.data }).stop.toFixed(2), 'TV の正解の秒');
    assert(n.classList.contains('is-tvwait'), '隠れている');
    t.win.close();
  });

  await r.test('クイズ王2（数字ちかい方）：正解と自分の結果は TV の冠（tl.end）まで出ない', async () => {
    const lab = Quiz2Scenes.view('qn-open');
    const t = await 場面(lab, 'scr-v2-qnear');
    const n = t.doc.querySelector('#scr-v2-qnear .v2-q2mine');
    assertEqual(+n.getAttribute('data-tvat'), +V2Quiz2.near.timeline(lab.room.state.data.reveal.rows || []).end.toFixed(2), 'TV の冠の秒');
    assert(n.classList.contains('is-tvwait'), '隠れている');
    t.win.close();
  });

  await r.test('二の束5 の時計合わせが終わっても、そろえて発射でなければ見せ場を描き直さない（動きが消えて終わりの形に飛ばない）', async () => {
    const t = await 場面(ButtonScenes.view('pt-reveal'), 'scr-v2-pittari');
    // 疑似の socket は時計の返事をしない＝合わせに失敗して、2秒後に「描き直すか」を決める所を通る
    const scr = t.doc.getElementById('scr-v2-pittari'), first = scr.firstElementChild;
    await sleep(t.win, 2400);
    assert(scr.firstElementChild === first, '描き直していない（同じ部品のまま）');
    t.win.close();
  });

  await r.test('スマホの見せ場の動き：部屋の知らせのすぐあとに本人だけの知らせが来ても、動きは消えない（頭から1回だけ）。少したってからの描き直しでは流しなおさない', async () => {
    const t = await 場面(ButtonScenes.view('pt-reveal'), 'scr-v2-pittari');   // 部屋の知らせ → 本人だけの知らせ（本番と同じ順）
    const scr = t.doc.getElementById('scr-v2-pittari');
    assert(scr.classList.contains('is-play'), '本人だけの知らせのあとも、見せ場の動きが付いている');
    const 歓声 = () => t.win.sfxProbe().log.filter((x) => x.id === 'cheer' || x.id === 'decide').length;
    const n0 = 歓声();
    await sleep(t.win, 1000);
    t.win.__rtFake.fire('room:update', t.room);
    await sleep(t.win, 30);
    assert(!scr.classList.contains('is-play'), '1秒たってからの描き直しでは、頭から流しなおさない（終わりの形）');
    assertEqual(歓声(), n0, '描き直しで音を2回鳴らさない');
    t.win.close();
  });

  W.win.close();
  r.finish();
})();
