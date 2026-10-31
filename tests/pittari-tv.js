// tests/pittari-tv.js — ぴったり10秒の TV の開く：物差しの外の人の札と名前（10/31 くまくん）
//
// 物差しの外（±3秒より遠い）の名前の札が、右の端で切れて「+3秒」の字やロゴと重なっていた（「+6.07秒」が読めない）。
//   ・札（いちばん近い3人）は、はみ出す時は点から内側へ寄せる（is-l／is-r）。いちばん下の段は両端の「±3秒」の所をふさぐ（重なる札は上の段へ）
//   ・物差しの下の小さな名前は、段が足りない時は名前だけ内側へずらして並べる（--nx）
// 見本は本物の進行役（pittari-room.js）で作る（tools/v2-lab/button-scenes.js・落とし穴25）。実際の重なりは node tools/v2-shot.js --only pt-tv-reveal で測る
const { createRunner, assert, assertEqual, launch } = require('./harness');
const ButtonScenes = require('../tools/v2-lab/button-scenes');

(async function main() {
  const r = createRunner('pittari-tv：ぴったり10秒の TV の開く（物差しの外の人）');
  const t = await launch({ fakeSocket: true });
  const W = t.win, D = t.doc;
  const box = D.createElement('div');
  box.className = 'screen v2 v2-tv';
  D.body.appendChild(box);
  const 描く = (id) => { const lab = ButtonScenes.view(id); box.innerHTML = W.V2Pittari.tv({ data: lab.room.state.data, members: lab.room.members, meId: 'tv', you: {}, fes: null, end: Date.now() + 8000 }); return lab; };
  const 札 = (name) => Array.prototype.find.call(box.querySelectorAll('.v2-ptp'), (p) => p.querySelector('.v2-ptp-nm').textContent === name);

  await r.test('「+6.07秒」「-4.21秒」の札は、端からはみ出さないように内側へ寄り、「±3秒」の字の段より上に出る', async () => {
    描く('pt-tv-reveal-far');
    const 右 = 札('ふう'), 左 = 札('ひろ');
    assert(右 && 右.classList.contains('is-r'), '+6.07秒の札は右の端で内側へ寄せる（' + (右 && 右.className) + '）');
    assert(左 && 左.classList.contains('is-l'), '-4.21秒の札は左の端で内側へ寄せる（' + (左 && 左.className) + '）');
    assert(+右.style.getPropertyValue('--lane') >= 1 && +左.style.getPropertyValue('--lane') >= 1, '「±3秒」の字と同じ段には置かない');
    assert(/\+6\.07秒/.test(右.textContent), '差の字（+6.07秒）がある');
    const 中 = 札('びび');
    assert(中 && !中.classList.contains('is-r') && !中.classList.contains('is-l'), 'まん中の札は今までどおり点の上');
  });

  await r.test('端に遠い人が何人も集まった16人：物差しの下の名前は、段が足りなければ名前だけ内側へずらす（同じ所に重ねない）', async () => {
    描く('pt-tv-reveal16-far');
    const 場所 = {};
    Array.prototype.forEach.call(box.querySelectorAll('.v2-ptd'), (d) => {
      const k = d.style.left + '|' + d.style.getPropertyValue('--row') + '|' + d.style.getPropertyValue('--nx');
      場所[k] = (場所[k] || 0) + 1;
    });
    const 重なり = Object.keys(場所).filter((k) => 場所[k] > 1);
    assertEqual(重なり.join(' / '), '', '同じ所・同じ段・同じずれの名前が2つ以上無い');
    assert(Array.prototype.some.call(box.querySelectorAll('.v2-ptd'), (d) => d.style.getPropertyValue('--nx') !== '0px'), 'ずらした名前がある（端に3人より多く集まった）');
  });

  await r.test('「よーい……」と大きな「10秒」と説明は、TV では間を広く（64px）とって重ねない（4回目の大きな「よーい……」も）', async () => {
    描く('pt-tv-set-blind');
    const s = box.querySelector('.v2-ptset.is-tv.is-blind');
    assert(s, '4回目の「よーい」の画面');
    // jsdom は gap を計算しないので、決まりの字で見る（実際の並びは node tools/v2-shot.js --only pt-tv-set で撮って測る）
    assert(D.documentElement.outerHTML.indexOf('.v2 .v2-ptset.is-tv{gap:64px;}') !== -1, 'TV の間は 64px（スマホは 14px のまま）');
  });

  t.win.close();
  r.finish();
})();
