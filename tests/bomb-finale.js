// tests/bomb-finale.js — クイズ解除（協力版）の終わりの演出（指示68-2 第1節）
//
// 見るもの：
//   門1：決まった順に出る（ため 0.75秒 → 開く → 字）。TV は全員の名前、スマホは自分の名前だけ／静かに「ばくはつ…」。
//        爆発は「演出 → 結果」：煙が晴れてから字が出る（演出と字を重ねない）。幕は最初から不透明（結果が透けない）
//   門2：光を切っても音と振動は残る／音を切っても光は残る
// 4面（手渡し・部屋のスマホ・TV・文化祭）は index.html の bombFinale 1本を呼ぶ（呼ぶ所は grep で見る）
const fs = require('fs');
const path = require('path');
const { createRunner, assert, assertEqual, launch, sleep } = require('./harness');

const ROOT = path.join(__dirname, '..');
const 幕 = (doc) => doc.querySelector('.fx-finale');
const 字 = (doc) => (幕(doc) && 幕(doc).querySelector('.fx-fin-body').textContent) || '';
const 音 = (win, id) => win.sfxProbe().log.filter((x) => x.id === id);

async function 開く(prefs) {
  const t = await launch({ fakeSocket: true, prefs });
  t.震え = [];
  t.win.navigator.vibrate = (p) => { t.震え.push(p); return true; };
  return t;
}
async function 終わらせる(t) {
  for (let i = 0; i < 4 && 幕(t.doc); i++) { t.win.FxKit.skipNow(); await sleep(t.win, 120); }
}

(async function main() {
  const r = createRunner('bomb-finale：クイズ解除の終わりの演出（指示68-2 第1節）');

  await r.test('門1：解除成功（TV）… ため 0.75秒 → 「解除」→ 全員の名前を大きく。音は開いた時', async () => {
    const t = await 開く();
    let 後ろ = 0;
    const p = t.win.bombFinaleProbe({ success: true, tv: true, names: ['ふう', 'ひろ', 'びび'], 結果へ: () => { 後ろ++; } });
    await sleep(t.win, 20);
    assert(幕(t.doc), '幕がすぐ出る（結果が透けない）');
    assertEqual(t.win.getComputedStyle(幕(t.doc)).backgroundColor !== 'rgba(0, 0, 0, 0)', true, '幕に地の色がある');
    assert(!幕(t.doc).classList.contains('is-open'), 'ためのあいだは開かない');
    assertEqual(音(t.win, 'defuse').length, 0, 'ためのあいだは鳴らない');
    await sleep(t.win, 900);
    assert(幕(t.doc).classList.contains('is-open'), '0.75秒で開く');
    assertEqual(音(t.win, 'defuse').length, 1, '開いた時に解除の音');
    assert(/解除/.test(幕(t.doc).querySelector('.fx-fin-title').textContent), '「解除」');
    await sleep(t.win, 500);
    assert(幕(t.doc).classList.contains('is-text'), '名前が出る');
    ['ふう', 'ひろ', 'びび'].forEach((n) => assert(字(t.doc).indexOf(n) !== -1, n + ' の名前（協力なので全員）'));
    assertEqual(後ろ, 0, 'まだ結果へ移らない');
    await 終わらせる(t);
    await p;
    assertEqual(後ろ, 1, '幕の後ろで結果へ移る（1回だけ）');
    assert(!幕(t.doc), '幕は上がる');
    t.win.close();
  });

  await r.test('門1：爆発（TV）… ため → 爆発（光1回・揺れ0.2秒を1回）→ 煙が晴れてから静かに「あと◯本だった」', async () => {
    const t = await 開く();
    t.win.bombFinaleProbe({ success: false, tv: true, left: 3, cause: 'lives' });
    await sleep(t.win, 900);
    const n = 幕(t.doc);
    assert(n.classList.contains('is-open'), '0.75秒で爆発');
    assertEqual(n.querySelectorAll('.fx-fin-flash').length, 1, '明るさが変わるのは1回だけ（光の要素は1つ）');
    assert(n.classList.contains('is-shake'), '揺れ');
    assertEqual(音(t.win, 'boom').length, 1, '爆発の音');
    assert(!n.classList.contains('is-text'), '煙が晴れるまでは字を出さない（演出と字を重ねない）');
    await sleep(t.win, 1300);
    assert(n.classList.contains('is-text'), '煙が晴れて字');
    assert(/あと3本だった/.test(字(t.doc)), '「あと3本だった」（' + 字(t.doc) + '）');
    // CSS：揺れは 0.2秒を1回、明るさは1回（くり返さない）
    const css = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
    assert(/\.fx-finale\.is-shake[^{]*\{[^}]*fxShake 0\.2s linear 1/.test(css), '揺れは0.2秒を1回');
    assert(/@keyframes fxFinFlash\{0%\{opacity:\.8;\}100%\{opacity:0;\}\}/.test(css), '明るさは1回だけ変わって戻る');
    await 終わらせる(t);
    t.win.close();
  });

  await r.test('門1：スマホ … 解除は「解除！」と自分の名前だけ・短い振動／爆発は静かに「ばくはつ…」・長めの振動', async () => {
    const t = await 開く();
    t.win.bombFinaleProbe({ success: true, tv: false, me: 'ふう', names: ['ふう', 'ひろ'] });
    await sleep(t.win, 1400);
    assert(/解除！/.test(字(t.doc)) && /ふう/.test(字(t.doc)), '「解除！」と自分の名前');
    assert(!/ひろ/.test(字(t.doc)), 'ほかの人の名前は出さない');
    assert(t.震え.some((p) => p === 60), '短い振動1回（' + JSON.stringify(t.震え) + '）');
    await 終わらせる(t);
    t.震え.length = 0;
    t.win.bombFinaleProbe({ success: false, tv: false, left: 2 });
    await sleep(t.win, 1400);
    const n = 幕(t.doc);
    assert(/ばくはつ…/.test(字(t.doc)), '静かに「ばくはつ…」');
    assertEqual(n.querySelectorAll('.fx-fin-flash, .fx-fin-smoke').length, 0, 'スマホの爆発に光と煙は無い');
    assert(!n.classList.contains('is-shake'), 'スマホは揺らさない');
    assert(t.震え.some((p) => p === 400), '長めの振動1回（' + JSON.stringify(t.震え) + '）');
    await 終わらせる(t);
    t.win.close();
  });

  await r.test('門2：光を切っても音と振動は残る', async () => {
    const t = await 開く({ fxFlash: false, fxShake: false });
    t.win.bombFinaleProbe({ success: false, tv: true, left: 1 });
    await sleep(t.win, 900);
    const n = 幕(t.doc);
    assertEqual(n.querySelectorAll('.fx-fin-flash').length, 0, '明るさの変化は無い');
    assert(!n.classList.contains('is-shake'), '揺れない');
    const b = 音(t.win, 'boom');
    assert(b.length === 1 && b[0].how !== 'off', '爆発の音は鳴る（' + JSON.stringify(b) + '）');
    await 終わらせる(t);
    t.win.bombFinaleProbe({ success: true, tv: true, names: ['ふう'] });
    await sleep(t.win, 900);
    assertEqual(幕(t.doc).querySelectorAll('.fx-fin-dot').length, 0, '光を切ると粒も無い');
    await 終わらせる(t);
    t.win.bombFinaleProbe({ success: true, tv: false, me: 'ふう' });
    await sleep(t.win, 900);
    assert(t.震え.length > 0, '振動は残る');
    await 終わらせる(t);
    t.win.close();
  });

  await r.test('門2：音を切っても光は残る', async () => {
    const t = await 開く({ seVolume: 0 });
    t.win.bombFinaleProbe({ success: false, tv: true, left: 1 });
    await sleep(t.win, 900);
    assertEqual(幕(t.doc).querySelectorAll('.fx-fin-flash').length, 1, '明るさの変化はある');
    assert(幕(t.doc).classList.contains('is-shake'), '揺れる');
    assertEqual(音(t.win, 'boom').map((x) => x.how).join(','), 'off', '音は鳴らない');
    await 終わらせる(t);
    t.win.close();
  });

  await r.test('演出「なし」でも、言葉は出て、押せば終わる（すべての演出はスキップできる）', async () => {
    const t = await launch({ fakeSocket: true, fxSkip: true });
    t.win.bombFinaleProbe({ success: false, tv: true, left: 2 });
    await sleep(t.win, 60);
    assert(幕(t.doc).classList.contains('is-text'), 'ためと動きは0、言葉はすぐ');
    assert(/あと2本だった/.test(字(t.doc)), '言葉は読める');
    await 終わらせる(t);
    assert(!幕(t.doc), '押せば終わる');
    t.win.close();
  });

  await r.test('4面（手渡し・部屋のスマホ・TV・文化祭）が同じ1本を呼ぶ', async () => {
    const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
    const 呼ぶ = (html.match(/bombFinale\(\{/g) || []).length;
    assertEqual(呼ぶ, 5, '手渡し2（解除・爆発）＋部屋のスマホ＋TV＋文化祭（' + 呼ぶ + '）');
    assert(/rtOnce\('fes:bomb:end:/.test(html), '文化祭も呼ぶ');
  });

  r.finish();
})();
