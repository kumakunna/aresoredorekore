// tests/tvs-auto.js — TV の切りかえの「自動」（指示69 二の束・tvs-auto.js）。時計を手で進めて見る（サーバーは立てない）
//
// 二の束の門：自動で回す（はじめは TV② が入：メニュー20秒→あそびまち20秒→動画1回分・TV① は切）・
// 呼び出しで TV② をあそびまちに30秒→元へ／回すのへ・人が入ったら TV① をあつまれへ・
// **ゲーム中にあつまれを映している TV は、自動では決して切りかえない**
const { createRunner, assert, assertEqual } = require('./harness');
const { createAuto, DEFAULT_SETTINGS } = require('../tvs-auto');

const ITEMS = ['fes', 'menu', 'asobi', 'video', 'rest'].map((id) => ({ id, tvs: [1, 2], have: true }));
const clone = (v) => JSON.parse(JSON.stringify(v));

/** 小さな世界：時計・設定・今の画面・文化祭の段。tick を回すと、自動が出した物を今の画面にする */
function world(opt) {
  const o = opt || {};
  const w = { t: 0, settings: Object.assign(clone(DEFAULT_SETTINGS), o.settings || {}), screens: { 1: { item: 'fes' }, 2: { item: 'rest' } },
    phase: o.phase || 'idle', items: o.items || ITEMS, durations: o.durations || {}, log: [] };
  const auto = createAuto();
  const ctx = () => ({ now: w.t, settings: w.settings, screens: w.screens, phase: w.phase, items: w.items, durations: w.durations });
  const take = (acts) => acts.forEach((a) => { w.screens[a.tv] = { item: a.item }; w.log.push(Math.round(w.t / 1000) + 's TV' + a.tv + ' ' + a.item + ' ' + a.why); });
  w.tick = () => take(auto.tick(ctx()));
  w.run = (sec) => { for (let i = 0; i < sec; i++) { w.t += 1000; w.tick(); } };
  w.chime = () => take(auto.chime(ctx()));
  w.reset = (tv) => auto.reset(tv);
  return w;
}

(async function main() {
  const r = createRunner('tvs-auto：TV の切りかえの自動（指示69 二の束）');

  await r.test('はじめは TV② が入（メニュー20秒→あそびまち20秒→動画1回分＝動画の長さ）・TV① は切。くり返す', async () => {
    const w = world({ durations: { video: 12 } });
    w.tick();
    w.run(20 + 20 + 12 + 1);
    assertEqual(w.log.join('|'), '0s TV2 menu auto|20s TV2 asobi auto|40s TV2 video auto|52s TV2 menu auto', '回る順と秒');
    assert(w.log.every((x) => x.indexOf('TV1') === -1), 'TV① は切なので動かない');
  });

  await r.test('動画の長さが分からない時は30秒。出せない物（まだありません）は飛ばす', async () => {
    const items = ITEMS.map((it) => (it.id === 'asobi' ? Object.assign({}, it, { have: false }) : it));
    const w = world({ items });
    w.tick(); w.run(20 + 30 + 1);
    assertEqual(w.log.join('|'), '0s TV2 menu auto|20s TV2 video auto|50s TV2 menu auto', 'あそびまちを飛ばし、動画は30秒');
  });

  await r.test('今の画面が回す物の中にあれば、そこから時計を始める（入れた瞬間に変えない）', async () => {
    const w = world();
    w.screens[2] = { item: 'asobi' };
    w.tick(); w.run(20);
    assertEqual(w.log.join('|'), '20s TV2 video auto', 'あそびまちの20秒が終わってから動画');
  });

  await r.test('呼び出し：TV② をあそびまちに30秒。自動が切なら元の画面へ・入なら回すのへもどる', async () => {
    const off = world({ settings: { auto: { 1: false, 2: false } } });
    off.screens[2] = { item: 'menu' };
    off.chime(); off.run(29);
    assertEqual(off.screens[2].item, 'asobi', '30秒の間はあそびまち');
    off.run(1);
    assertEqual(off.log.join('|'), '0s TV2 asobi chime|30s TV2 menu chime-end', '元のメニューへ');
    const on = world();
    on.tick(); on.run(5);
    on.chime(); on.run(30);
    assertEqual(on.log.slice(0, 3).join('|'), '0s TV2 menu auto|5s TV2 asobi chime|35s TV2 menu auto', '30秒のあと、回すのにもどる（次の物から）');
  });

  await r.test('回していてあそびまちを出している時に呼ばれた → そこから30秒あそびまち、そのあとは次の動画へ（さらに20秒あそびまちにしない）', async () => {
    const w = world({ durations: { video: 12 } });
    w.tick(); w.run(25);
    w.chime(); w.run(30);
    assertEqual(w.log.join('|'), '0s TV2 menu auto|20s TV2 asobi auto|55s TV2 video auto', '呼ばれてから30秒で動画');
  });

  await r.test('呼び出しの間にもう一度鳴った → そこから30秒（元の画面は最初のまま）。呼び出しを切にすると何もしない', async () => {
    const w = world({ settings: { auto: { 1: false, 2: false } } });
    w.screens[2] = { item: 'video' };
    w.chime(); w.run(20); w.chime(); w.run(29);
    assertEqual(w.screens[2].item, 'asobi', '2回目から30秒の間');
    w.run(1);
    assertEqual(w.screens[2].item, 'video', '元の動画へ');
    const off = world({ settings: { chime: false, auto: { 1: false, 2: false } } });
    off.chime();
    assertEqual(off.log.length, 0, '呼び出しが切');
  });

  await r.test('人が入った（呼び込み→待合）→ TV① をあつまれへ。切なら何もしない。待合のままでは何度も出さない', async () => {
    const w = world();
    w.screens[1] = { item: 'menu' };
    w.tick(); w.phase = 'lobby'; w.tick(); w.run(5);
    assertEqual(w.log.filter((x) => x.indexOf('TV1') !== -1).join('|'), '0s TV1 fes fes', 'あつまれへ1回');
    const off = world({ settings: { fesBack: false } });
    off.screens[1] = { item: 'menu' };
    off.tick(); off.phase = 'lobby'; off.tick();
    assertEqual(off.screens[1].item, 'menu', '切なら動かない');
  });

  await r.test('門：ゲーム中（play）にあつまれを映している TV は、自動では決して切りかえない（回す・呼び出し）', async () => {
    const w = world({ phase: 'play', settings: { auto: { 1: true, 2: true }, rot: { 1: [{ item: 'menu', sec: 5 }], 2: [{ item: 'menu', sec: 5 }, { item: 'video', sec: 5 }] } } });
    w.screens[1] = { item: 'fes' }; w.screens[2] = { item: 'fes' };
    w.tick(); w.run(60); w.chime(); w.run(60);
    assertEqual(w.log.join('|'), '', 'ゲーム中は1度も変えない');
    w.phase = 'result'; w.run(30);
    assertEqual(w.log.join('|'), '', '結果・待合など人がいる間も、あつまれを映している TV は回さない（決めごと）');
    w.phase = 'idle'; w.run(1);
    assert(w.log.length > 0 && w.log.every((x) => /auto$/.test(x)), 'だれもいなくなったら回し始める（' + w.log.join('|') + '）');
  });

  // 指示75 3-6（A24(b)・11/7 の本物の TV で起きた）：TV② にあつまれを出している時、投票・準備・結果の間に呼び出しが鳴ると30秒あそびまちへ行っていた。
  // 人がいる間（呼び込み idle 以外）は、回すのと同じく呼び出しでも動かさない
  for (const phase of ['lobby', 'vote', 'decide', 'ready', 'result']) {
    await r.test('指示75 3-6：TV② にあつまれを出していて人がいる間（' + phase + '）は、呼び出しでも動かさない', async () => {
      const w = world({ phase, settings: { auto: { 1: false, 2: false } } });
      w.screens[2] = { item: 'fes' };
      w.chime(); w.run(40);
      assertEqual(w.log.join('|'), '', 'TV② はあつまれのまま');
    });
  }
  await r.test('指示75 3-6：呼び込み（idle）の間は、TV② にあつまれを出していても呼び出しで あそびまちへ（今までどおり）', async () => {
    const w = world({ phase: 'idle', settings: { auto: { 1: false, 2: false } } });
    w.screens[2] = { item: 'fes' };
    w.chime(); w.run(31);
    assertEqual(w.log.join('|'), '0s TV2 asobi chime|30s TV2 fes chime-end', 'あそびまちへ行って、もどる');
  });

  await r.test('ゲーム中でも、あつまれを映していない TV は回る。呼び出しも TV② があつまれでなければ出す', async () => {
    const w = world({ phase: 'play' });
    w.screens[1] = { item: 'fes' };
    w.tick(); w.run(21); w.chime();
    assertEqual(w.log.join('|'), '0s TV2 menu auto|20s TV2 asobi auto', '回る（あそびまちを出している間の呼び出しは、出し直さない）');
    assertEqual(w.screens[1].item, 'fes', 'TV① はそのまま');
  });

  await r.test('係が手で押した（reset）→ 回している所を忘れ、入れなおすと今の画面から始める', async () => {
    const w = world();
    w.tick(); w.run(10);
    w.reset(2); w.settings.auto[2] = false; w.screens[2] = { item: 'rest' };
    w.run(60);
    assertEqual(w.log.join('|'), '0s TV2 menu auto', '切の間は動かない');
    w.settings.auto[2] = true; w.tick();
    assertEqual(w.screens[2].item, 'menu', '入れなおすと1つ目から');
  });

  r.finish();
})();
