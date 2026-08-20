// tests/sugoroku-hide.js — 「どこにいる？」の区画と手がかり（第36弾）
//
// DOM も socket.io も使わない純粋な計算なので、jsdom を立てずに確かめる。
//
// いちばん見たいのは、**このゲームの核が成立していること**:
//   ・手がかりが区画をまたいで重なっていて、「隣までなら通る嘘」が実在する。
//     1区画1手がかりだと嘘が100%即バレて、誰も嘘をつかなくなり遊びが消える
//   ・矛盾の判定が「申告した区画にその手がかりが在るか」だけを見る
//     （実位置と比べない。**嘘でも筋が通っていれば通る**のが芯）
//   ・申告を求める相手が偏らない（毎ターン誰かが申告する仕掛けが効く）

const H = require('../public/js/sugoroku-hide');
const S = require('../public/js/sugoroku-logic');
const { createRunner, assert, assertEqual } = require('./harness');

function rndSeq(values) {
  let i = 0;
  return () => values[i++ % values.length];
}
const rndHalf = () => 0.5;

(async function main() {
  const r = createRunner('sugoroku-hide：どこにいる？の区画と手がかり');

  // ---- 区画 ----

  await r.test('盤のどのマスも、必ずどこかの区画に入る', async () => {
    const cells = S.gameById('sugohide').cells;
    for (let p = 0; p <= cells; p++) {
      const a = H.areaOf(p, cells);
      assert(a && a.id, p + 'マス目が、どの区画にも入っていない');
    }
    assertEqual(H.areaOf(0, cells).id, H.AREAS[0].id, 'ふりだしは最初の区画');
    assertEqual(H.areaOf(cells, cells).id, H.AREAS[H.AREAS.length - 1].id, 'あがりは最後の区画');
  });

  await r.test('区画は、進むほど先の区画になる（前後が入れかわらない）', async () => {
    const cells = S.gameById('sugohide').cells;
    let last = -1;
    for (let p = 0; p <= cells; p++) {
      const idx = H.AREAS.findIndex((a) => a.id === H.areaOf(p, cells).id);
      assert(idx >= last, p + 'マス目で区画が後戻りしている');
      last = idx;
    }
  });

  await r.test('どの区画にも、言える手がかりがある', async () => {
    // 手がかりが1つも無い区画に入ると、その人は何も申告できなくなる
    H.areas().forEach((a) => {
      assert(H.cluesOf(a.id).length >= 2, a.name + ' に手がかりが足りない');
    });
  });

  // ---- 手がかりの重なり（ゲームの核） ----

  await r.test('手がかりは20種類ある', async () => {
    assertEqual(H.clues().length, 20, '指示書どおり20種類');
    const ids = new Set(H.clues().map((c) => c.id));
    assertEqual(ids.size, 20, 'idが重複していない');
    H.clues().forEach((c) => {
      assert(c.text, c.id + ' に文がない');
      assert(c.areas.length >= 1, c.id + ' がどの区画にも属していない');
    });
  });

  await r.test('手がかりが区画をまたいで重なっている（嘘が通る余地がある）', async () => {
    // **ここがこのゲームの核。** 1区画1手がかりだと、嘘の位置を言った瞬間に
    // 手がかりが食い違って100%バレる。そうなると誰も嘘をつかなくなる。
    // 「半分以上が2区画以上にまたがる」という具体の形で守る
    assert(H.overlappingClueCount() >= 10,
      'またがる手がかりが少なすぎる（いま' + H.overlappingClueCount() + '種類）');
  });

  await r.test('どの区画からも、隣の区画だと言い張れる手がかりがある', async () => {
    // 「隣までなら通る安全な嘘」が、全部の区画から作れること。
    // 端の区画だけ嘘がつけない、という偏りを作らない
    const list = H.areas();
    list.forEach((a, i) => {
      const neighbours = [list[i - 1], list[i + 1]].filter(Boolean);
      const mine = H.cluesOf(a.id);
      const canLie = neighbours.some((nb) =>
        mine.some((c) => c.areas.indexOf(nb.id) !== -1));
      assert(canLie, a.name + ' から、隣の区画だと言える手がかりが無い');
    });
  });

  await r.test('その区画にしか無い手がかりも、いくつかある', async () => {
    // 全部がまたがっていると、逆に「ここにいる」と強く言える手札が無くなる
    const only = H.clues().filter((c) => c.areas.length === 1);
    assert(only.length >= 3, 'その区画だけの手がかりが少なすぎる（いま' + only.length + '種類）');
  });

  // ---- 矛盾の判定 ----

  await r.test('申告した区画にその手がかりが在れば、通る', async () => {
    const a = H.AREAS[2];
    const c = H.cluesOf(a.id)[0];
    assertEqual(H.isContradiction(c.id, a.id), false, '在る手がかりは通る');
  });

  await r.test('申告した区画に無い手がかりを言うと、矛盾になる', async () => {
    const a = H.AREAS[0];
    const far = H.clues().find((c) => c.areas.indexOf(a.id) === -1);
    assertEqual(H.isContradiction(far.id, a.id), true, '無い手がかりは矛盾');
  });

  await r.test('嘘の位置でも、その区画に在る手がかりを選べば通る（核の担保）', async () => {
    // 実位置とは比べない。「その場所からそう見えるはずか」だけを見る。
    // これが無いと、嘘という行為そのものが成立しない
    const cells = S.gameById('sugohide').cells;
    const realArea = H.areaOf(2, cells);          // 本当はふもとにいる
    const lieArea = H.AREAS[H.AREAS.length - 1];  // みねちかくだと嘘をつく
    assert(realArea.id !== lieArea.id, '本当の区画と嘘の区画が違う');
    const lieClue = H.cluesOf(lieArea.id)[0];
    assertEqual(H.isContradiction(lieClue.id, lieArea.id), false,
      '嘘の区画でも、そこに在る手がかりなら通る');
  });

  await r.test('知らない手がかり・知らない区画は通さない', async () => {
    // 端末をいじって、存在しない値を送ってきても受け付けない
    assertEqual(H.isContradiction('nope', H.AREAS[0].id), true, '知らない手がかり');
    assertEqual(H.isContradiction(H.CLUES[0].id, 'nowhere'), true, '知らない区画');
    assertEqual(H.isContradiction(null, null), true, '空でも通さない');
  });

  // ---- 申告を求める相手 ----

  await r.test('申告を求める相手は、まだ求められていない人から先に選ぶ', async () => {
    // 完全ランダムだと同じ人に続けて当たり、
    // 「毎ターン必ず誰かが申告する」という たるみ防止の仕掛けが効かなくなる
    const ids = ['a', 'b', 'c', 'd'];
    const counts = { a: 2, b: 0, c: 1, d: 0 };
    for (let i = 0; i < 20; i++) {
      const picked = H.pickAsked(ids, counts, rndSeq([i / 20]));
      assert(picked === 'b' || picked === 'd', '回数の少ない人から選ばれる（' + picked + '）');
    }
  });

  await r.test('一巡したら、また全員から選び直す', async () => {
    const ids = ['a', 'b', 'c'];
    const counts = { a: 1, b: 1, c: 1 };
    const seen = new Set();
    for (let i = 0; i < 60; i++) seen.add(H.pickAsked(ids, counts, rndSeq([i / 60])));
    assertEqual(seen.size, 3, '全員が選ばれうる');
  });

  await r.test('候補がいなくても壊れない', async () => {
    assertEqual(H.pickAsked([], {}, rndHalf), null, '空なら null');
    assertEqual(H.pickAsked(['a'], {}, rndHalf), 'a', '1人ならその人');
  });

  // ---- 戻る量 ----

  await r.test('矛盾がバレたら戻る量は、盤の1割ほどに収まる', async () => {
    // 具体の数字で書く（実装側の定数を検査に使うと、緩めた時に一緒に緩む）
    const cells = S.gameById('sugohide').cells;
    assert(H.CAUGHT_BACK >= 2, '戻る量が少なすぎて、嘘の抑止にならない');
    assert(H.CAUGHT_BACK <= cells / 8, '戻る量が多すぎる（気持ちが折れる）');
    assertEqual(H.CAUGHT_BACK, 3, '30マス盤で3マス');
  });

  r.finish();
})();
