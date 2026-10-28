// tests/quiz2-tv.js — クイズ王2.0 の TV（指示68-5 の直し・Claude チャットが動画を見て 10/28）
//
// 2：次の問題が始まったら、前の問題の「いちばん早かったのは〇〇」は TV に残らない（同じ箱に描き直す本物の流れで見る）
// 5：答えている間の TV に、数字の時計（00:23）は出さない（のこり時間は ちぢむ帯）
// 3：いちばん早かった人・1位の名前は、画面の幅の半分より広い箱で大きく。順位は白い箱をやめて舞台の上の行（入れかわりの動きの量を持つ）
// 見本は本物の進行役（qhaya-room.js）を動かして作る（tools/v2-lab/quiz2-scenes.js・落とし穴25）
const path = require('path');
const { createRunner, assert, assertEqual, launch } = require('./harness');
const S = require('../tools/v2-lab/quiz2-scenes.js');
const QHaya = require(path.join(__dirname, '..', 'qhaya-room.js'));

function tvView(room) {
  return { data: JSON.parse(JSON.stringify(QHaya.publicView(room))), members: [], meId: 'tv', you: {}, fes: null, end: Date.now() + 8000 };
}

(async function main() {
  const r = createRunner('quiz2-tv：クイズ王2.0 の TV（指示68-5 の直し）');
  const t = await launch({ fakeSocket: true });
  const W = t.win, D = t.doc;
  const box = D.createElement('div');
  box.className = 'screen v2';
  D.body.appendChild(box);

  await r.test('2：開いた（いちばん早かった人あり）→ 次の問題 の順に同じ箱へ描くと、次の問題に前の「いちばん早かった」が残らない', async () => {
    const room = S.早答え(6, 1);                    // 1問目を開いたところ
    let v = tvView(room);
    assertEqual(v.data.phase, 'unveil', '1問目は開いている');
    box.innerHTML = W.V2Quiz2.haya.tv(v);
    assert(box.querySelector('.v2-q2fast b'), '開いた TV には いちばん早かった人が出る');
    QHaya.advance(room);                             // 2問目へ
    v = tvView(room);
    assertEqual(v.data.phase, 'choose', '2問目は答えている間');
    assertEqual(v.data.reveal, null, '答えている間の知らせに、前の開いた中身は入っていない');
    box.innerHTML = W.V2Quiz2.haya.tv(v);
    assertEqual(box.querySelectorAll('.v2-q2fast, .v2-otag, .v2-q2rank').length, 0, '前の問題の いちばん早かった人・名前の札・順位は無い');
    assert(box.textContent.indexOf(W.UiText.QUIZ2.いちばん早い) === -1, '「いちばん早かったのは」の字も無い');
  });

  await r.test('5：答えている間の TV に数字の時計は無い（スマホには のこり秒がある）', async () => {
    const room = S.早答え(4, 1, { next: true });
    const v = tvView(room);
    assertEqual(v.data.phase, 'choose', '答えている間');
    box.innerHTML = W.V2Quiz2.haya.tv(v);
    assertEqual(box.querySelectorAll('[data-v2-cd]').length, 0, 'TV に時計の数字は無い');
    assert(box.querySelector('.v2-q2bar'), 'のこり時間の帯はある');
    box.innerHTML = W.V2Quiz2.haya.phone(Object.assign({}, v, { meId: 'm1', you: {} }));
    assertEqual(box.querySelectorAll('[data-v2-cd]').length, 1, 'スマホには のこり秒');
  });

  await r.test('3：いちばん早かった人と1位の名前は、画面の半分より広い箱（長い名前は字を小さくして1行）', async () => {
    const room = S.早答え(16, 1);
    box.innerHTML = W.V2Quiz2.haya.tv(tvView(room));
    const fs = parseFloat(box.querySelector('.v2-q2fast b').style.fontSize);
    assert(fs >= 96 && fs <= 150, 'いちばん早かった人の字は 96〜150px（' + fs + '）');
    // 箱の幅の下限は CSS（960px＝1920 の半分）。jsdom は版組みをしないので、決まりが書いてあることを見る
    const css = D.documentElement.outerHTML;
    assert(/\.v2 \.v2-q2tv \.v2-q2fast b\{min-width:960px;/.test(css), 'いちばん早かった人の箱は 960px 以上');
    assert(/\.v2 \.v2-q2c-nm\{min-width:960px;/.test(css), '1位の箱は 960px 以上');
  });

  await r.test('3：3問ごとの順位は舞台の上の行。上がった人の行は、前の場所から動く量（--mv）を持つ', async () => {
    const room = S.早答え(16, 3);
    box.innerHTML = W.V2Quiz2.haya.tv(tvView(room));
    const rows = Array.from(box.querySelectorAll('.v2-q2rk'));
    assert(rows.length >= 2 && rows.length <= 8, '順位の行は8行まで（' + rows.length + '）');
    assert(rows.some((x) => +x.style.getPropertyValue('--mv') !== 0), 'どこかの行が入れかわる（動きが見える）');
    const css = D.documentElement.outerHTML;
    assert(/\.v2 \.v2-q2rank\{inset:0;[^}]*background:none;/.test(css), '順位は白い箱にしない');
  });

  t.win.close();
  r.finish();
})();
