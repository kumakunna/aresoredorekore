// tests/bomb-tv.js — クイズ解除の TV の舞台（指示68-2 第2節）
//
// 門4：正しく切った瞬間に TV のそのマスが切れる（火花は1回・「〇〇 が切った」）。外した人の名前は TV に出ない
// 門5：終わったあとに「みんながいちばん迷った問題」が出る（外した数がいちばん多い物・同じなら後の物）。だれが外したかは出さない
// ほか：盤が TV の主役（本数で列が変わる・50本でも並ぶ）・のこり1本のマスを大きく
const { createRunner, assert, assertEqual, launch, sleep } = require('./harness');
const FesScenes = require('../tools/v2-lab/fes-scenes');

const TV = (doc) => doc.getElementById('scr-v2-fes-tv');

(async function main() {
  const r = createRunner('bomb-tv：クイズ解除の TV の舞台（指示68-2 第2節）');

  await r.test('盤が主役：本数ぶんのマス・本数で列が変わる（30本は8列・50本は10列）', async () => {
    const t = await launch({ fakeSocket: true, atEntry: true });
    t.win.V2Screens.fes(FesScenes.view('fes2-tv-play'));
    await sleep(t.win, 60);
    assertEqual(TV(t.doc).querySelectorAll('.v2-tcell').length, 30, '30マス');
    assert(TV(t.doc).querySelector('.v2-tboard.is-c8'), '30本は8列');
    t.win.V2Screens.fes(FesScenes.view('fes2-tv-play16'));
    await sleep(t.win, 60);
    assertEqual(TV(t.doc).querySelectorAll('.v2-tcell').length, 50, '16人は50マス');
    assert(TV(t.doc).querySelector('.v2-tboard.is-c10'), '50本は10列');
    t.win.close();
  });

  await r.test('門4：挑戦中のマスはアイコン・解いたマスは ✓。盤に名前は出ない（外した人の名前も出さない）', async () => {
    const t = await launch({ fakeSocket: true, atEntry: true });
    const lab = FesScenes.view('fes2-tv-play');
    t.win.V2Screens.fes(lab);
    await sleep(t.win, 60);
    const board = lab.room.state.data.board;
    const tries = board.filter((c) => c.by && !c.solved).length;
    assert(tries >= 1, '前提：挑戦中のマスがある');   // 型(b)
    assertEqual(TV(t.doc).querySelectorAll('.v2-tcell.is-try .v2-av').length, tries, '挑戦中はアイコン');
    const 盤の字 = TV(t.doc).querySelector('.v2-tboard').textContent;
    lab.room.members.forEach((m) => { if (m.role === 'player') assert(盤の字.indexOf(m.name) === -1, '盤に名前「' + m.name + '」が出ない'); });
    assertEqual(TV(t.doc).querySelectorAll('.v2-tcell.is-solved').length, board.filter((c) => c.solved).length, '解いたマスに印');
    t.win.close();
  });

  await r.test('門4：正しく切った瞬間（知らせの前と後で比べる）… そのマスに火花が1回・「〇〇 が切った」・TV の音。外した時は何も出ない', async () => {
    const t = await launch({ fakeSocket: true, atEntry: true });
    const B = (s) => [{ uid: 'a', solved: s.a, solvedBy: s.a ? 'ふう' : null }, { uid: 'b', solved: false }];
    assertEqual(t.win.bombTvCutProbe(B({}), 'R:1'), null, '最初の知らせは比べる相手が無いので何もしない');
    assertEqual(t.win.bombTvCutProbe(B({}), 'R:1'), null, '外した時（盤の解いた数は変わらない）は何もしない');
    const c1 = t.win.bombTvCutProbe(B({ a: true }), 'R:1');
    assert(c1 && c1.uid === 'a' && c1.name === 'ふう' && c1.fresh === true, '切った瞬間（' + JSON.stringify(c1) + '）');
    const c2 = t.win.bombTvCutProbe(B({ a: true }), 'R:1');
    assert(c2 && c2.fresh === false, '描き直しでは火花をくり返さない（名前は少しのあいだ残る）');
    const 音 = t.win.sfxProbe().log.map((x) => x.id);
    assert(音.indexOf('cut') !== -1 && 音.indexOf('spark') !== -1, '切る音と火花の音（' + 音.join(',') + '）');
    assertEqual(t.win.bombTvCutProbe(B({ a: true }), 'R:2'), null, '次の試合では前の試合と比べない');
    // 画面：fresh の時だけマスに火花、名前の帯
    t.win.V2Screens.fes(FesScenes.view('fes2-tv-play-cut'));
    await sleep(t.win, 60);
    assertEqual(TV(t.doc).querySelectorAll('.v2-tcell.is-cutnow').length, 1, '火花はそのマス1つ');
    assert(/ が切った/.test(TV(t.doc).querySelector('.v2-tcut').textContent), '「〇〇 が切った」');
    t.win.close();
  });

  await r.test('のこり1本：そのマスを大きく（ほかのマスは大きくしない）', async () => {
    const t = await launch({ fakeSocket: true, atEntry: true });
    t.win.V2Screens.fes(FesScenes.view('fes2-tv-play-last'));
    await sleep(t.win, 60);
    assertEqual(TV(t.doc).querySelectorAll('.v2-tcell.is-last').length, 1, 'のこり1本のマスだけ');
    t.win.V2Screens.fes(FesScenes.view('fes2-tv-play'));
    await sleep(t.win, 60);
    assertEqual(TV(t.doc).querySelectorAll('.v2-tcell.is-last').length, 0, 'のこりが多い時は出さない');
    t.win.close();
  });

  await r.test('門5：みんながいちばん迷った問題（外した数がいちばん多い・同じなら後の物）。だれも外していなければ出さない', async () => {
    const t = await launch({ fakeSocket: true, atEntry: true });
    const M = t.win.V2Fes.mostMissed;
    const 試 = (name, ok) => ({ name, correct: ok });
    const codes = [
      { question: 'Q1', name: 'A1', tries: [試('ふう', false), 試('ひろ', true)] },
      { question: 'Q2', name: 'A2', tries: [試('びび', false), 試('ふう', false), 試('ちか', true)] },
      { question: 'Q3', name: 'A3', tries: [試('でん', false), 試('えみ', false)] }
    ];
    const m = M(codes);
    assertEqual(JSON.stringify([m.question, m.answer, m.wrong]), JSON.stringify(['Q3', 'A3', 2]), '2つ外した Q2 と Q3 は同じ → 後の Q3');
    assertEqual(M([{ question: 'Q', name: 'A', tries: [試('ふう', true)] }]), null, 'だれも外していなければ出さない');
    // 画面：爆発の結果に出る。問題と正解だけで、名前は出ない
    const lab = FesScenes.view('fes2-tv-boom');
    t.win.V2Screens.fes(lab);
    await sleep(t.win, 60);
    const box = TV(t.doc).querySelector('.v2-tmiss');
    assert(box, '迷った問題の箱が出る');
    const 字 = box.textContent;
    const want = M(lab.room.state.data.result.codes);
    assert(字.indexOf(want.answer) !== -1, '正解が出る（' + want.answer + '）');
    lab.room.members.forEach((m2) => assert(字.indexOf(m2.name) === -1, 'だれが外したか（' + m2.name + '）は出さない'));
    t.win.close();
  });

  r.finish();
})();
