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

  await r.test('門1：解除成功（TV・指示68-S の台本を 68-T 二の束4 で縮めた）… ため 0.75秒 → ランプが緑「カチッ」→ 1.25秒 ふたが開いて「解除成功！」→ 2.0秒 名前が飛び出す → 3.0秒 結果の札 → 4.0秒までに幕が上がる', async () => {
    const t = await 開く();
    let 後ろ = 0;
    const p = t.win.bombFinaleProbe({ success: true, tv: true, names: ['ふう', 'ひろ', 'びび'], solved: 30, total: 30, sec: 147, lives: 2,
      missed: { question: '「枕草子」の書き出しは？', answer: '春はあけぼの' }, 結果へ: () => { 後ろ++; } });
    await sleep(t.win, 20);
    const n = 幕(t.doc);
    assert(n, '幕がすぐ出る（結果が透けない）');
    assertEqual(t.win.getComputedStyle(n).backgroundColor !== 'rgba(0, 0, 0, 0)', true, '幕に地の色がある');
    assert(!n.classList.contains('is-open'), 'ためのあいだは開かない');
    assertEqual(音(t.win, 'tick').length + 音(t.win, 'defuse').length, 0, 'ためのあいだは鳴らない');
    assert(n.querySelector('.fx-fin-case'), '爆弾（ふた・ランプ・時計）');
    // 68-S の残り1（くまくん 10/31）：爆弾らしく、丸い玉と導火線（先に火花）
    assert(n.querySelector('.fx-fin-case .fx-fin-fuse .fx-fin-spark') && n.querySelector('.fx-fin-case .fx-fin-lid'), '導火線と火花・口金（ふた）がある');
    const css0 = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
    assert(/\.fx-fin-case\{position:relative;width:46vmin;height:46vmin;margin-top:15vmin;border-radius:50%;/.test(css0), '丸い玉（直径 46vmin・前の四角い箱 44×27vmin より大きい）');
    assert(/\.fx-fin-clear\.is-tv\.is-open \.fx-fin-spark\{animation:fxSparkOut/.test(css0), '解除でランプが緑になる時に、火花は1回だけ消える（点滅しない）');
    assertEqual(n.querySelector('.fx-fin-clock').textContent, '02:27', '時計は止まった時刻のまま');
    assertEqual(n.querySelectorAll('.fx-fin-w').length, 30, 'コードは全部の本数');
    assertEqual(n.querySelectorAll('.fx-fin-w.is-last').length, 1, '最後のコードが切れる');
    assert(!/ふう/.test(字(t.doc)) || !n.classList.contains('is-names'), 'ためのあいだは名前を出さない');
    await sleep(t.win, 900);
    assert(n.classList.contains('is-open'), '0.75秒で開く（ランプが赤 → 消える → 緑）');
    assertEqual(音(t.win, 'tick').length, 1, '「カチッ」');
    // 時刻で見ずに順番で見る（並走で機械が重いと、待っている間に 1.5秒を越えることがある）：ふたが開く前は鳴っていない
    assertEqual(音(t.win, 'defuse').length, n.classList.contains('is-text') ? 1 : 0, 'ほめる音は、ふたが開いてから');
    await sleep(t.win, 500);
    assert(n.classList.contains('is-text'), '1.25秒：ふたが開いて字');
    assertEqual(音(t.win, 'defuse').length, 1, 'ふたが開いた時にほめる音');
    assert(/解除成功！/.test(n.querySelector('.fx-fin-title').textContent), '「解除成功！」');
    assert(!n.classList.contains('is-names'), '名前はまだ');
    await sleep(t.win, 750);
    assert(n.classList.contains('is-names'), '2.0秒：名前が飛び出す');
    ['ふう', 'ひろ', 'びび'].forEach((x) => assert(字(t.doc).indexOf(x) !== -1, x + ' の名前（協力なので全員）'));
    assertEqual(n.querySelectorAll('.fx-fin-heart').length, 2, '残ったライフのハート');
    assertEqual(後ろ, 0, 'まだ結果へ移らない');
    await sleep(t.win, 950);
    assert(n.classList.contains('is-card'), '3.0秒：結果の札が上がる');
    const 札 = n.querySelector('.fx-fin-card').textContent;
    assert(/30\/30/.test(札) && /02:27/.test(札) && /枕草子/.test(札), '札に本数・時間・迷った問題（' + 札 + '）');
    await 終わらせる(t);
    await p;
    assertEqual(後ろ, 1, '幕の後ろで結果へ移る（1回だけ）');
    assert(!幕(t.doc), '幕は上がる');
    t.win.close();
  });

  await r.test('門1：爆発（TV・指示68-S の台本を 68-T 二の束4 で縮めた）… ため → 0.75秒 爆発（光1回・揺れ0.2秒を1回）→ 煙がほぼ晴れて切れなかったコードが光る → 2.0秒「あと3本だった！」', async () => {
    const t = await 開く();
    t.win.bombFinaleProbe({ success: false, tv: true, left: 3, solved: 27, total: 30, sec: 153, cause: 'lives' });
    await sleep(t.win, 20);
    const n = 幕(t.doc);
    assertEqual(n.querySelectorAll('.fx-fin-w.is-live').length, 3, '切れなかったコードは3本（ほかは切れている）');
    assert(!n.querySelector('.fx-fin-w.is-last'), '爆発では最後のコードを切らない');
    await sleep(t.win, 900);
    assert(n.classList.contains('is-open'), '0.75秒で爆発');
    assertEqual(n.querySelectorAll('.fx-fin-flash').length, 1, '明るさが変わるのは1回だけ（光の要素は1つ）');
    assert(n.classList.contains('is-shake'), '揺れ');
    assertEqual(音(t.win, 'boom').length, 1, '爆発の音');
    assert(n.querySelectorAll('.fx-fin-deb').length > 0 && n.querySelector('.fx-fin-ring'), 'マンガのような破片と輪');
    // 68-S の残り3（くまくん 10/31）：迫力は「光は1回・揺れは1回」の中で。破片18・2つ目の衝撃波の輪・玉が弾け飛ぶ・揺れの幅だけ大きく
    assertEqual(n.querySelectorAll('.fx-fin-deb').length, 18, '破片は18');
    assert(n.querySelector('.fx-fin-ring.is-wave'), '少し遅れて2つ目の衝撃波の輪');
    const css3 = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
    assert(/\.fx-fin-boom\.is-tv\.is-open \.fx-fin-case\{animation:fxCaseBlow/.test(css3), '玉は弾け飛んで消える（煙が晴れると、こげた盤だけ）');
    assert(/\.fx-finale\.is-tv\.is-shake \.fx-fin-rig\{animation:fxShakeBig 0\.2s linear 1;\}/.test(css3), '揺れは0.2秒を1回のまま（幅だけ大きく）');
    await sleep(t.win, 600);
    assert(!n.classList.contains('is-text'), '煙が晴れるまでは字を出さない（演出と字を重ねない）');
    await sleep(t.win, 700);
    assert(n.classList.contains('is-text'), '2.0秒：字');
    assert(/あと3本だった！/.test(字(t.doc)) && /つぎはいけるかも/.test(字(t.doc)), '「あと3本だった！」「つぎはいけるかも」（' + 字(t.doc) + '）');
    // CSS：揺れは 0.2秒を1回、明るさは1回（くり返さない）
    const css = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
    assert(/\.fx-finale\.is-shake[^{]*\{[^}]*fxShake 0\.2s linear 1/.test(css), '揺れは0.2秒を1回');
    assert(/@keyframes fxFinFlash\{0%\{opacity:\.8;\}100%\{opacity:0;\}\}/.test(css), '明るさは1回だけ変わって戻る');
    await 終わらせる(t);
    t.win.close();
  });

  await r.test('二の束4：幕は TV もスマホも、解除も爆発も、全部で4秒以内（同じ時刻に上がる）。文化祭の結果へは幕が消えるまでに移る（68-S の残り2）', async () => {
    const 長さ = async (o) => {
      const t = await 開く();
      const t0 = Date.now();
      await t.win.bombFinaleProbe(Object.assign({ total: 30, solved: 27 }, o));
      const ms = Date.now() - t0;
      t.win.close();
      return ms;
    };
    const ms = {
      TV解除: await 長さ({ success: true, tv: true, names: ['ふう', 'ひろ', 'びび', 'ちか', 'でん', 'えみ', 'あき', 'くまくん', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], solved: 30 }),
      TV爆発: await 長さ({ success: false, tv: true, left: 3, cause: 'lives' }),
      スマホ解除: await 長さ({ success: true, tv: false, me: 'ふう', names: ['ふう'], solved: 30 }),
      スマホ爆発: await 長さ({ success: false, tv: false, left: 3 })
    };
    Object.keys(ms).forEach((k) => assert(ms[k] <= 4200, k + ' は4秒以内（' + ms[k] + 'ms）'));
    const 差 = Math.max.apply(null, Object.values(ms)) - Math.min.apply(null, Object.values(ms));
    assert(差 <= 300, 'TV とスマホ・解除と爆発の幕が同じ時刻に上がる（差 ' + 差 + 'ms・' + JSON.stringify(ms) + '）');
    const FesRoom = require('../fes-room');
    // 68-S の残り2（10/31）：幕が上がったらすぐ文化祭の結果。見回り（0.5秒ごと）の分を足しても、幕が消える 4.0秒までに結果へ移る
    assert(FesRoom.TIMES.endGraceMs + 500 <= 4000, '文化祭の結果へは、幕が消えるまでに移る（' + FesRoom.TIMES.endGraceMs + 'ms＋見回り0.5秒）');
    assert(FesRoom.TIMES.endGraceMs >= 3000, '幕が上がる前に結果へ移りすぎない（結果の見せ場が幕の下で終わらない）');
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
    // 指示68-S：解除も、最後の形（名前の集合写真・ハート・結果の札）がすぐ出る
    t.win.bombFinaleProbe({ success: true, tv: true, names: ['ふう', 'ひろ'], total: 10, sec: 60, lives: 1 });
    await sleep(t.win, 60);
    ['is-open', 'is-text', 'is-names', 'is-card'].forEach((c) => assert(幕(t.doc).classList.contains(c), '解除：' + c + ' がすぐ'));
    await 終わらせる(t);
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
