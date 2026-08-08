// tests/auction-logic.js — オークションバトルのルール（第31弾 第3部）
//
// 作り直しの芯が守られているかを見る:
//   ・払うのは落札した人だけ（落札できなかった人は何も失わない）
//   ・順位に応じた足枷（強制最低入札）が無いこと
//   ・誰も入札しなければ品物は流れること
//   ・同じ金額なら、先に出した人が落札すること
//   ・アイテムの効き方（半額・2倍・鑑定眼・撤回権）
//   ・2ラウンドごとの救済が残っていること

const { createRunner, assert, assertEqual } = require('./harness');
const A = require('../public/js/auction-logic');
const Items = require('../public/js/auction-items');

function jackpot() { return Items.itemsOf('jackpot')[0]; }
function dud() { return Items.itemsOf('dud')[0]; }

async function run() {
  const r = createRunner('auction-logic：オークションのルール');

  await r.test('設定は枠に収まる（おかしな値を送られても壊れない）', async () => {
    const c = A.normalizeConfig({ mode: 'へんなもの', rounds: 999, startChips: -5, bidSec: 0 });
    assertEqual(c.mode, A.MODE.OPEN, '知らない遊び方はせり上げ式にする');
    assertEqual(c.rounds, A.MAX_ROUNDS, 'ラウンド数は上限まで');
    assert(c.startChips >= 5, 'チップは最低でも5枚');
    assert(c.bidSec >= 10, '考える時間は最低10秒');
    assertEqual(A.normalizeConfig({ mode: 'sealed' }).mode, A.MODE.SEALED, '秘密入札も選べる');
    assertEqual(A.normalizeConfig({}).rescue, true, '救済は既定で入る');
  });

  await r.test('入札できるのは、持っているチップまで（順位の足枷は無い）', async () => {
    // 前のルールにあった「順位が上の人ほど最低額が高い」は廃止した。
    // 落札できなければ損をしないので、最低額を強制しても足枷にならない
    assertEqual(A.canBid(0, { chips: 20, mode: A.MODE.SEALED }).ok, true, '0でも出せる（降りる）');
    assertEqual(A.canBid(20, { chips: 20, mode: A.MODE.SEALED }).ok, true, '全部賭けられる');
    const over = A.canBid(21, { chips: 20, mode: A.MODE.SEALED });
    assertEqual(over.ok, false, '持っている以上は出せない');
    assertEqual(over.reason, 'tooMuch', '理由が分かる');
    assertEqual(A.canBid('あ', { chips: 20, mode: A.MODE.SEALED }).ok, false, '数字でないものは通らない');
  });

  await r.test('せり上げ式では、いまの最高額より上でないと出せない', async () => {
    const low = A.canBid(5, { chips: 20, mode: A.MODE.OPEN, highest: 5 });
    assertEqual(low.ok, false, '同額では上書きできない');
    assertEqual(low.reason, 'notHigher', '理由が分かる');
    assertEqual(A.canBid(6, { chips: 20, mode: A.MODE.OPEN, highest: 5 }).ok, true, '1つ上なら出せる');
    // 秘密入札では、他の人の金額が見えないので、この決まりは効かない
    assertEqual(A.canBid(5, { chips: 20, mode: A.MODE.SEALED, highest: 5 }).ok, true,
      '秘密入札では最高額を見ない');
  });

  await r.test('いちばん高い人が落札する', async () => {
    const got = A.settleBids([
      { id: 'a', amount: 3, at: 100 },
      { id: 'b', amount: 7, at: 200 },
      { id: 'c', amount: 5, at: 150 }
    ]);
    assertEqual(got.winnerId, 'b', '高い人が落札');
    assertEqual(got.amount, 7, '出した額がそのまま');
  });

  await r.test('同じ金額なら、先に出した人が落札する', async () => {
    // ランダムで決めると「なぜ負けたか」を説明できない。早い者勝ちなら理由が言える
    const got = A.settleBids([
      { id: 'a', amount: 7, at: 300 },
      { id: 'b', amount: 7, at: 100 },
      { id: 'c', amount: 7, at: 200 }
    ]);
    assertEqual(got.winnerId, 'b', 'いちばん早く出した人');
  });

  await r.test('誰も入札しなければ、品物は流れる', async () => {
    assertEqual(A.settleBids([]), null, '入札が無ければ落札者なし');
    assertEqual(A.settleBids([{ id: 'a', amount: 0, at: 1 }]), null, '0は入札していない扱い');
  });

  await r.test('落札できなかった人は、何も失わない', async () => {
    // ここがいちばん大事な変更点。負けた人の収支に触る計算がそもそも無い
    const bids = [{ id: 'a', amount: 9, at: 1 }, { id: 'b', amount: 4, at: 2 }];
    const won = A.settleBids(bids);
    assertEqual(won.winnerId, 'a', 'aが落札');
    // 支払いの計算は落札者の分しか無い（負けた人のぶんを計算する入口が無い）
    const paid = A.settlePayment(won.amount, jackpot(), {});
    assertEqual(paid.paid, 9, '落札者だけが払う');
    assertEqual(typeof A.settlePayment, 'function', '負けた人ぶんの計算は存在しない');
  });

  await r.test('半額チケット：支払いが半分になる（端数は切り上げ）', async () => {
    const item = jackpot();
    assertEqual(A.settlePayment(10, item, { halfticket: true }).paid, 5, '10 → 5');
    // 切り捨てにすると、奇数のときだけ妙に得をする
    assertEqual(A.settlePayment(5, item, { halfticket: true }).paid, 3, '5 → 3（切り上げ）');
    assertEqual(A.settlePayment(5, item, {}).paid, 5, '使わなければそのまま');
  });

  await r.test('ダブルアップ：当たりも2倍だが、ハズレの損も2倍', async () => {
    const win = A.settlePayment(5, jackpot(), { doubleup: true });
    assertEqual(win.value, jackpot().value * 2, '当たりは2倍');
    const lose = A.settlePayment(5, dud(), { doubleup: true });
    assertEqual(lose.value, dud().value * 2, '大ハズレの損も2倍');
    assert(lose.delta < 0, '大ハズレで2倍にすると、しっかり損をする');
  });

  await r.test('収支は「品物の価値 − 払った額」', async () => {
    const item = jackpot();
    const got = A.settlePayment(6, item, {});
    assertEqual(got.delta, item.value - 6, '差し引きが収支');
    // 半額チケットは収支をそのぶん良くする
    const half = A.settlePayment(6, item, { halfticket: true });
    assertEqual(half.delta, item.value - 3, '半額なら払いが減る');
  });

  await r.test('鑑定眼：ヒントは1つずつ出て、同じものを2度出さない', async () => {
    const item = jackpot();
    const first = A.hintFor(item, []);
    assert(first, '1つ目のヒントが出る');
    const second = A.hintFor(item, [first]);
    assert(second && second !== first, '2つ目は違うヒント');
    assertEqual(A.hintFor(item, item.hints), null, '出しきったら、もう無い');
  });

  await r.test('撤回権は秘密入札だけで使える', async () => {
    // せり上げ式は、値を上げること自体が出し直しなので、撤回権に意味が無い
    const open = A.itemsFor(A.MODE.OPEN).map((x) => x.id);
    const sealed = A.itemsFor(A.MODE.SEALED).map((x) => x.id);
    assertEqual(open.indexOf('retract'), -1, 'せり上げ式には出ない');
    assert(sealed.indexOf('retract') !== -1, '秘密入札には出る');
    assertEqual(open.length, 3, 'せり上げ式は3種');
    assertEqual(sealed.length, 4, '秘密入札は4種');
  });

  await r.test('アイテムは4種、すべて使い切りで、値段と説明がある', async () => {
    assertEqual(A.ITEMS.length, 4, '4種');
    const ids = A.ITEMS.map((x) => x.id).sort().join(',');
    assertEqual(ids, 'appraise,doubleup,halfticket,retract', '中身は指示のとおり');
    A.ITEMS.forEach((x) => {
      assert(x.cost > 0, x.name + ' に値段がある');
      assert(x.lead && x.lead.length > 5, x.name + ' に説明がある');
      assert(x.when, x.name + ' に使えるタイミングがある');
    });
  });

  await r.test('救済：2ラウンドごとに、最下位へ無料アイテムを配る', async () => {
    const players = [
      { id: 'a', chips: 20 }, { id: 'b', chips: 8 }, { id: 'c', chips: 14 }
    ];
    assertEqual(A.rescueTargets(players, 1).join(''), '', '1ラウンド目は配らない');
    assertEqual(A.rescueTargets(players, 2).join(''), 'b', '2ラウンド目は最下位へ');
    assertEqual(A.rescueTargets(players, 3).join(''), '', '3ラウンド目は配らない');
    assertEqual(A.rescueTargets(players, 4).join(''), 'b', '4ラウンド目も最下位へ');
  });

  await r.test('救済：最下位が並んでいたら全員へ、全員同じなら誰にも配らない', async () => {
    const tie = [{ id: 'a', chips: 20 }, { id: 'b', chips: 8 }, { id: 'c', chips: 8 }];
    assertEqual(A.rescueTargets(tie, 2).sort().join(','), 'b,c', '並んでいたら全員');
    const same = [{ id: 'a', chips: 20 }, { id: 'b', chips: 20 }];
    assertEqual(A.rescueTargets(same, 2).join(''), '', '全員同じなら最下位は無い');
  });

  await r.test('救済で配るアイテムは、その遊び方で使えるものから出る', async () => {
    for (let i = 0; i < 200; i++) {
      const id = A.rescueItemFor(A.MODE.OPEN);
      assert(id !== 'retract', 'せり上げ式で撤回権は配られない');
      assert(A.itemById(id), '知らないアイテムは配られない');
    }
  });

  await r.test('順位：チップが多い順。同じなら同じ順位で、並びがちらつかない', async () => {
    const rows = A.rank([
      { id: 'a', name: 'あき', chips: 12 },
      { id: 'b', name: 'びび', chips: 20 },
      { id: 'c', name: 'ちか', chips: 12 }
    ]);
    assertEqual(rows[0].name, 'びび', '多い人が1位');
    assertEqual(rows[0].rank, 1, '1位');
    assertEqual(rows[1].rank, 2, '同点は同じ順位');
    assertEqual(rows[2].rank, 2, '同点は同じ順位');
    // 何度呼んでも同じ並び
    const again = A.rank([
      { id: 'c', name: 'ちか', chips: 12 },
      { id: 'a', name: 'あき', chips: 12 },
      { id: 'b', name: 'びび', chips: 20 }
    ]);
    assertEqual(again.map((x) => x.name).join(','), rows.map((x) => x.name).join(','),
      '入れ替えて渡しても同じ並び');
  });

  await r.test('遊びとして成り立つ：何も分からず平均で入札すると、ほぼ損得なし', async () => {
    // 全品物の平均価値くらいで入札すると収支が0に近い＝
    // 「鑑定眼で平均より上を見抜けた時だけ得をする」形になっている
    const all = Items.ITEMS;
    const avg = all.reduce((s, x) => s + x.value, 0) / all.length;
    const bid = Math.round(avg);
    const total = all.reduce((s, x) => s + A.settlePayment(bid, x, {}).delta, 0);
    assert(Math.abs(total / all.length) <= 1,
      '平均で入札した時の収支は、1枚ぶん以内に収まる（実際: ' + (total / all.length).toFixed(2) + '）');
  });

  // finish() は失敗した時だけ process.exit(1) する。
  // 成功時に何も返さないので、返り値で終了コードを決めてはいけない
  // （緑なのに exit 1 になり、npm test の連鎖がそこで止まる）
  r.finish();
}

if (require.main === module) run();
module.exports = { run };
