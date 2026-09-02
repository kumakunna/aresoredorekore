// tests/auction-items.js — 相場オークションの品物（第38弾で入れ替え）
//
// 見張るのは「遊びが成り立つためにデータが満たしていること」だけ。
// 文章の良し悪しはテストで測れないので、そこには踏み込まない。
//
// いちばん大事なのは **ヒントが品質と矛盾しないこと**（門8）。
// 段階ヒントを品質ごとに持たせた形そのものを、ここで固定する。
// （全品質で同じヒントに戻すと、偽物なのに「作者の落款がある」のような
//   嘘を出すことになる。遊ぶ人は嘘のヒントを疑えないので、これは事故になる）

const Items = require('../public/js/auction-items');
const { createRunner, assert, assertEqual } = require('./harness');

(async function main() {
  const r = createRunner('auction-items：相場オークションの品物');

  await r.test('系統は3つ。どれも名前とアイコンを持っている', async () => {
    assertEqual(Items.KINDS.length, 3, '系統は3つ');
    const ids = Items.KINDS.map((k) => k.id);
    assertEqual(new Set(ids).size, 3, 'idが重複していない');
    Items.KINDS.forEach((k) => {
      assert(k.label && k.icon, k.id + ' に名前とアイコンがある');
    });
  });

  await r.test('品質は3段階で、上物＞並物＞偽物の順に価値が下がる', async () => {
    const v = (id) => Items.valueOf(id);
    assertEqual(v('fine'), 3, '上物は+3');
    assertEqual(v('plain'), 1, '並物は+1');
    assertEqual(v('fake'), -2, '偽物は-2');
    assert(v('fine') > v('plain') && v('plain') > v('fake'), '順に下がる');
    assert(v('fake') < 0, '偽物だけがマイナス（つかむと損をする）');
    assertEqual(v('しらない品質'), 0, '知らない品質でも落ちない');
  });

  await r.test('1ラウンドの内訳は6品ぶん（上物2・並物3・偽物1）', async () => {
    assertEqual(Items.mixTotal(), 6, '合計6品');
    const q = Items.mixQualities();
    assertEqual(q.length, 6, '6つに展開できる');
    assertEqual(q.filter((x) => x === 'fine').length, 2, '上物2');
    assertEqual(q.filter((x) => x === 'plain').length, 3, '並物3');
    assertEqual(q.filter((x) => x === 'fake').length, 1, '偽物1');
  });

  await r.test('品物は30種。どの系統も、6品を並べられるだけある', async () => {
    assertEqual(Items.ITEMS.length, 30, '30種');
    // 1ラウンドは6品。1つの系統に偏っても並べられるよう、各系統に6品以上あること
    Items.KINDS.forEach((k) => {
      const n = Items.itemsOfKind(k.id).length;
      assert(n >= 6, k.label + ' は6品以上ある（実際: ' + n + '）');
    });
  });

  await r.test('見た目の名前が、品物ごとに違う（同じ名前が2つ並ばない）', async () => {
    const looks = Items.ITEMS.map((x) => x.look);
    assertEqual(new Set(looks).size, looks.length, '名前が重複していない');
  });

  await r.test('どの品物も、3つの品質ぶんの段階ヒントと正体を持っている', async () => {
    const qs = Items.QUALITIES.map((q) => q.id);
    Items.ITEMS.forEach((it) => {
      assert(it.look && it.look.length > 0, '見た目の名前がある: ' + it.kind);
      assert(Items.kindById(it.kind), it.look + ' の系統が実在する');
      qs.forEach((q) => {
        const b = it.q[q];
        assert(b, it.look + '／' + q + ' がある');
        assertEqual(b.steps.length, 2, it.look + '／' + q + ' の段階ヒントは2つ');
        b.steps.forEach((s) => assert(s && s.length > 0, it.look + '／' + q + ' のヒストが空でない'));
        assert(b.reveal && b.reveal.length > 0, it.look + '／' + q + ' の正体がある');
      });
    });
  });

  await r.test('段階ヒントは品質ごとに違う（同じ文を使い回していない）', async () => {
    // ここが崩れると「ヒントが品質と矛盾しない」が守れなくなる。
    // 全品質で同じ文にすると、偽物にも上物の根拠を出してしまう
    let same = [];
    Items.ITEMS.forEach((it) => {
      const sets = Items.QUALITIES.map((q) => it.q[q.id].steps.join('｜'));
      if (new Set(sets).size !== sets.length) same.push(it.look);
    });
    assertEqual(same.join('／'), '', '品質ごとに違うヒントになっている');
  });

  await r.test('正体も品質ごとに違う（開示で同じ文が出ない）', async () => {
    let same = [];
    Items.ITEMS.forEach((it) => {
      const rev = Items.QUALITIES.map((q) => it.q[q.id].reveal);
      if (new Set(rev).size !== rev.length) same.push(it.look);
    });
    assertEqual(same.join('／'), '', '品質ごとに違う正体になっている');
  });

  await r.test('偽物の文が、持ち主を責めていない（原則C）', async () => {
    // 「責める時は静かに」。偽物をつかんだ人を笑う言葉を、データの側に置かない
    const 責める言葉 = ['ばか', 'バカ', '愚か', 'まぬけ', '間抜け', 'ざんねん', '残念でした', 'だまされ', '騙され', 'ひっかか', '引っかか'];
    const bad = [];
    Items.ITEMS.forEach((it) => {
      const text = it.q.fake.steps.join('') + it.q.fake.reveal;
      責める言葉.forEach((w) => { if (text.indexOf(w) >= 0) bad.push(it.look + '：' + w); });
    });
    assertEqual(bad.join('／'), '', '偽物の文に、人を責める言葉が入っていない');
  });

  r.finish();
})();
