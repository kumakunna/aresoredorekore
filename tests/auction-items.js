// tests/auction-items.js — オークションの品物プール（第31弾 第3部-2）
//
// ここで見張っているのは、遊びの根っこにある2つの決まり:
//   ・一言だけで価値が分からないこと（同じ一言が2つ以上の階層に出る）
//   ・大ハズレだけがマイナスで、それ以外はプラスであること
// どちらかが崩れると、値をつける駆け引きが成立しなくなる。

const { createRunner, assert, assertEqual } = require('./harness');
const Items = require('../public/js/auction-items');

async function run() {
  const r = createRunner('auction-items：オークションの品物');

  await r.test('5つの階層すべてに品物がある', async () => {
    const c = Items.counts();
    Items.TIERS.forEach((t) => {
      assert(c[t.id] > 0, t.label + ' に品物がある');
    });
  });

  await r.test('一言だけでは価値が分からない（同じ一言が2つ以上の階層に出る）', async () => {
    const bad = Items.allTeasers().filter((t) => Items.tiersOfTeaser(t).length < 2);
    assertEqual(bad.join('、'), '', '1つの階層にしか出ない一言は無い');
  });

  await r.test('大ハズレだけがマイナス、それ以外はプラス', async () => {
    Items.ITEMS.forEach((x) => {
      if (x.tier === 'dud') assert(x.value < 0, x.teaser + '（大ハズレ）はマイナス');
      else assert(x.value > 0, x.teaser + '（' + x.tier + '）はプラス');
    });
  });

  await r.test('高い階層ほど、もらえるチップが多い', async () => {
    const order = ['dud', 'bad', 'plain', 'good', 'jackpot'];
    let prevMax = -Infinity;
    order.forEach((tier) => {
      const vals = Items.itemsOf(tier).map((x) => x.value);
      const min = Math.min.apply(null, vals);
      assert(min > prevMax, tier + ' は1つ下の階層より必ず高い');
      prevMax = Math.max.apply(null, vals);
    });
  });

  await r.test('どの品物にも、正体と鑑定眼のヒントが2つ入っている', async () => {
    Items.ITEMS.forEach((x) => {
      assert(x.reveal && x.reveal.length > 5, x.teaser + ' に正体がある');
      assertEqual((x.hints || []).length, 2, x.teaser + '（' + x.tier + '）のヒントは2つ');
      x.hints.forEach((h) => assert(h && h.length > 3, 'ヒントが空でない'));
    });
  });

  await r.test('同じ一言の2つの品物は、ヒントも違う', async () => {
    Items.allTeasers().forEach((t) => {
      const group = Items.ITEMS.filter((x) => x.teaser === t);
      const all = [];
      group.forEach((x) => x.hints.forEach((h) => all.push(h)));
      const uniq = {};
      all.forEach((h) => { uniq[h] = true; });
      assertEqual(Object.keys(uniq).length, all.length,
        t + ' のヒントが使い回されていない（使い回すと鑑定眼が無意味になる）');
    });
  });

  await r.test('同じ品物を続けて出さない（使い切ったら復活する）', async () => {
    const used = {};
    const first = Items.pickItems(6, used, null);
    assertEqual(first.length, 6, '6つ出る');
    first.forEach((x) => { used[Items.keyOf(x)] = true; });
    const second = Items.pickItems(6, used, null);
    second.forEach((x) => {
      assertEqual(!!used[Items.keyOf(x)], false, '前に出たものは出ない');
    });
    // 全部使い切っても、止まらずに出し続けられる
    Items.ITEMS.forEach((x) => { used[Items.keyOf(x)] = true; });
    assertEqual(Items.pickItems(3, used, null).length, 3, '使い切っても出せる');
  });

  await r.test('日本語の中に、別の言語の文字が混ざっていない', async () => {
    // 実際に「old な工房の品」と書いてしまったことがあるので、機械で見張る。
    // キリル文字・ハングル・ローマ字の単語が、遊ぶ人に見える文に無いこと
    const foreign = /[Ѐ-ӿ가-힯]|[A-Za-z]{2,}/;
    Items.ITEMS.forEach((x) => {
      [x.teaser, x.reveal].concat(x.hints).forEach((s) => {
        assertEqual(foreign.test(s), false, '「' + s + '」に別の言語が混ざっていない');
      });
    });
  });

  // finish() は失敗した時だけ process.exit(1) する。
  // 成功時に何も返さないので、返り値で終了コードを決めてはいけない
  // （緑なのに exit 1 になり、npm test の連鎖がそこで止まる）
  r.finish();
}

if (require.main === module) run();
module.exports = { run };
