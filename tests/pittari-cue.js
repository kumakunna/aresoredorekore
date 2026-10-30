// tests/pittari-cue.js — ぴったり10秒の「いつ押すのか」の合図（指示68-T 3）
//
// 声（v08「スタート！」）を止めたので、合図は字と音でする：
//   ・スタート：TV とスマホの両方に大きな「スタート！」（0.6秒）。音は「決まった」の音（TV が鳴らす・スマホは TV がいれば鳴らさない）
//   ・時計が消える時：「時計は消えても、そのまま数えつづけて」を1回だけ（0.8秒）
//   ・4回目（時計が最初から見えない回）：「よーい……」と「スタート！」の字を、ほかの回より大きく
//   ・合図の字は押す邪魔をしない（pointer-events なし）。演出「なし」でも同じ長さで出て、消える
// 部屋の知らせは本物の進行役で作った見本データ（tools/v2-lab/button-scenes.js）を流す（落とし穴25）
const { createRunner, assert, assertEqual, launch, waitFor, sleep } = require('./harness');
const H = require('./harness');
const ButtonScenes = require('../tools/v2-lab/button-scenes');

const act = (doc) => (doc.querySelector('.screen.active') || {}).id;

/** 部屋をつくって、pittari の見本の場面を流す。me：自分の memberId（'tv' なら TV として） */
async function 場面(sceneId, o) {
  o = o || {};
  const t = await launch(Object.assign({ fakeSocket: true }, o.launch || {}));
  const lab = ButtonScenes.view(sceneId);
  const me = o.me || 'm1';
  const room = JSON.parse(JSON.stringify(lab.room));
  if (o.edit) o.edit(room.state.data);
  t.win.__rtFake.replies = { 'room:create': () => ({ ok: true, code: room.code, memberId: me, room }) };
  await H.makeRoomV2(t.win, t.doc);
  t.win.__rtFake.fire('room:update', room);
  t.win.__rtFake.fire('wolf:you', lab.you || {});
  const want = me === 'tv' ? 'scr-v2-pittari-tv' : 'scr-v2-pittari';
  await waitFor(t.win, () => act(t.doc) === want, 3000, want + ' へ');
  return Object.assign(t, { room, lab });
}
const 合図 = (doc) => doc.querySelector('.fx-cue');

(async function main() {
  const r = createRunner('pittari-cue：ぴったり10秒の合図（指示68-T 3）');

  await r.test('スタート：スマホに大きな「スタート！」が 0.6秒。押す邪魔をしない。「決まった」の音を鳴らそうとする', async () => {
    const t = await 場面('pt-run');
    const c = 合図(t.doc);
    assert(c, '「スタート！」が出た');
    assertEqual(c.textContent, 'スタート！', '字');
    assert(c.classList.contains('fx-cue-l'), 'ふつうの回は l の大きさ');
    assertEqual(t.win.getComputedStyle(c).pointerEvents, 'none', '押す邪魔をしない');
    assert(t.win.sfxProbe().log.some((x) => x.id === 'decide'), '「決まった」の音（TV がいる部屋のスマホでは off）');
    // ストップは押せる（合図が出ている間も）
    assert(t.doc.querySelector('#scr-v2-pittari [data-pt-stop]'), 'ストップのボタンがある');
    await sleep(t.win, 900);
    assert(!合図(t.doc), '0.6秒で消える');
    // 知らせがもう一度来ても、くり返さない
    t.win.__rtFake.fire('room:update', t.room);
    await sleep(t.win, 50);
    assert(!合図(t.doc), '同じ回で2回出さない');
    t.win.close();
  });

  await r.test('スタート：TV にも「スタート！」。声は鳴らさない（字と音だけ）', async () => {
    const t = await 場面('pt-tv-run', { me: 'tv' });
    const c = 合図(t.doc);
    assert(c && c.textContent === 'スタート！', 'TV にも出た');
    const log = t.win.sfxProbe().log;
    assert(log.some((x) => x.id === 'decide' && x.how !== 'off'), 'TV は「決まった」の音を鳴らす（' + JSON.stringify(log) + '）');
    assert(log.filter((x) => /^v\d/.test(x.id)).every((x) => x.how === 'off'), '声はどれも鳴らさない');
    t.win.close();
  });

  await r.test('4回目（時計が最初から見えない回）：「よーい……」と「スタート！」がほかの回より大きい', async () => {
    const set = await 場面('pt-set', { edit: (d) => { d.show = false; d.round = 4; } });
    const 大 = set.doc.querySelector('#scr-v2-pittari .v2-ptset');
    assert(大.classList.contains('is-blind'), '見えない回の印');
    const fsBlind = parseFloat(set.win.getComputedStyle(set.doc.querySelector('#scr-v2-pittari .v2-ptready')).fontSize);
    set.win.close();
    const ふつう = await 場面('pt-set');
    const fsNormal = parseFloat(ふつう.win.getComputedStyle(ふつう.doc.querySelector('#scr-v2-pittari .v2-ptready')).fontSize);
    ふつう.win.close();
    assert(fsBlind > fsNormal, '「よーい……」が大きい（' + fsBlind + ' > ' + fsNormal + '）');
    const run = await 場面('pt-run', { edit: (d) => { d.show = false; d.round = 4; } });
    assert(合図(run.doc).classList.contains('fx-cue-xl'), '「スタート！」も大きい（xl）');
    run.win.close();
  });

  await r.test('時計が消える時に「時計は消えても、そのまま数えつづけて」を1回だけ（0.8秒）。見えない回は出さない', async () => {
    const t = await 場面('pt-run', { edit: (d) => { d.showMs = 1600; } });
    await sleep(t.win, 900);   // スタートの字が消えるまで
    assert(!合図(t.doc), 'まだ時計が見えている（字は出ていない）');
    await waitFor(t.win, () => 合図(t.doc) && /数えつづけて/.test(合図(t.doc).textContent), 1500, '時計が消えた時の字');
    assertEqual(合図(t.doc).textContent, '時計は消えても、そのまま数えつづけて', '字');
    assert(t.doc.querySelector('#scr-v2-pittari [data-pt-clock]').classList.contains('is-hidden'), '時計は「？」になっている');
    await sleep(t.win, 1100);
    assert(!合図(t.doc), '0.8秒で消える');
    await sleep(t.win, 400);
    assert(!合図(t.doc), '1回だけ');
    t.win.close();
    const blind = await 場面('pt-run', { edit: (d) => { d.show = false; d.round = 4; } });
    await sleep(blind.win, 1200);
    assert(!合図(blind.doc), '見えない回は「消えても」を出さない');
    blind.win.close();
  });

  await r.test('演出「なし」でも、合図は同じ長さで出て消える（止まらない）', async () => {
    const t = await 場面('pt-run', { launch: { fxSkip: true } });
    assert(合図(t.doc), '「なし」でも「スタート！」は出る（合図そのものなので）');
    await sleep(t.win, 900);
    assert(!合図(t.doc), '消える');
    t.win.close();
  });

  r.finish();
})();
