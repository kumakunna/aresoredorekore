// tests/quiz2-logic.js — クイズ王2.0（指示68-5）の点の決め方・問題の選び方・数直線
const { createRunner, assert, assertEqual } = require('./harness');
const L = require('../public/js/quiz2-logic.js');
const Bank = require('../public/js/quiz-bank.js');

(async function main() {
  const r = createRunner('quiz2-logic：クイズ王2.0の決め方（指示68-5）');
  const H = L.RULES.HAYA, N = L.RULES.NEAR;

  await r.test('門2：早答えの点…正解は100点＋早さの点（0秒で100・10秒で0、まっすぐ減る）・まちがいと時間切れは0点・最後は2倍', async () => {
    assertEqual([L.speedPoints(0), L.speedPoints(5000), L.speedPoints(10000), L.speedPoints(12000), L.speedPoints(-5)].join(','), '100,50,0,0,100', '早さの点');
    const ids = ['a', 'b', 'c', 'd'];
    const ans = { a: { pick: 1, ms: 1200 }, b: { pick: 1, ms: 4000 }, c: { pick: 0, ms: 500 } };   // d は時間切れ
    const s = L.scoreHaya(3, ans, 1, ids, false);
    assertEqual(s.rows.a.points, 100 + 88, '正解・1.2秒');
    assertEqual(s.rows.b.points, 100 + 60, '正解・4秒');
    assertEqual(s.rows.c.points, 0, 'まちがいは0点（引かない）');
    assertEqual(s.rows.d.points, 0, '時間切れは0点');
    assertEqual(s.counts.join(','), '1,2,0', '答えごとの人数');
    assertEqual(s.fastest.join(','), 'a', 'いちばん早かった正解の人（まちがえた c は早くても入らない）');
    assertEqual(s.fastestMs, 1200, 'いちばん早かった時間');
    const d = L.scoreHaya(3, ans, 1, ids, true);
    assertEqual([d.rows.a.points, d.rows.c.points].join(','), (188 * 2) + ',0', '最後の問題は2倍（0点は0点のまま）');
    const none = L.scoreHaya(3, { a: { pick: 0, ms: 1 } }, 2, ids, false);
    assertEqual(none.fastest.length, 0, 'だれも当てなければ「いちばん早かった人」はいない');
  });

  await r.test('門2：順位…点の高い順・同じ点は同じ順位（1,1,3）', async () => {
    const rk = L.rankOf({ a: 300, b: 300, c: 120, d: 0 }, ['d', 'c', 'b', 'a']);
    assertEqual(rk.map((x) => x.id + x.rank).join(','), 'b1,a1,c3,d4', '順位');
  });

  await r.test('門3：数字ちかい方の点…近い順に5・3・1点・差が同じなら同じ順位・ぴったりは＋5点・答えない人は0点', async () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    const s = L.scoreNear({ a: 3776, b: 3700, c: 3852, d: 3000, e: 9999 }, 3776, ids);
    assertEqual([s.rows.a.rank, s.rows.a.points, s.rows.a.perfect].join(','), '1,10,true', 'ぴったりは1位5点＋5点');
    assertEqual([s.rows.b.rank, s.rows.c.rank].join(','), '2,2', '差が同じ（76）なら同じ順位');
    assertEqual([s.rows.b.points, s.rows.c.points].join(','), '3,3', '同じ順位は同じ点');
    assertEqual([s.rows.d.rank, s.rows.d.points].join(','), '4,0', '2位が2人なら次は4位（点なし）');
    assertEqual([s.rows.f.rank, s.rows.f.points].join(','), ',0', '答えない人は順位なし・0点');
    assertEqual(s.crowned.join(','), 'a', 'いちばん近い人');
    assertEqual(s.perfect.join(','), 'a', 'ぴったりの人');
    const tie = L.scoreNear({ a: 90, b: 110 }, 100, ['a', 'b']);
    assertEqual(tie.crowned.sort().join(','), 'a,b', '差が同じなら冠は2人');
  });

  await r.test('門3：数直線…答えの散らばりに合わせ、とても遠い答えは端の「→」にまとめる', async () => {
    const ax = L.axisOf([3700, 3852, 3000, 3600, 99999, 5], 3776);
    assert(ax.min < 3000 && ax.max > 3852, 'ふつうの答えは目盛りの中（' + ax.min + '〜' + ax.max + '）');
    assertEqual(ax.far.right.join(','), '4', 'とても大きい答えは右の束');
    assertEqual(ax.far.left.join(','), '5', 'とても小さい答えは左の束');
    const one = L.axisOf([3776], 3776);
    assert(one.max > one.min, 'ぴったり1人でも幅がある');
  });

  await r.test('数の入れ方：全角・カンマは読む。小数・負・文字・10けたははじく', async () => {
    assertEqual([L.parseNumber('３７７６'), L.parseNumber('3,776'), L.parseNumber(42)].join(','), '3776,3776,42', '読める');
    [null, '', '-3', '3.5', 'abc', '1234567890', -1, 2.5, NaN].forEach((x) => assertEqual(L.parseNumber(x), null, String(x) + ' ははじく'));
  });

  await r.test('門4：1回の中で同じ問題が出ない（早答え10問・数字ちかい方5問）・早答えは やさしい3→ふつう4→むずかしい3', async () => {
    let seed = 7; const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    for (let i = 0; i < 30; i++) {
      const qs = L.pickHaya(Bank, {}, rnd);
      assertEqual(qs.length, H.ROUNDS, '10問');
      assertEqual(new Set(qs.map((q) => q.q)).size, H.ROUNDS, '同じ問題が無い（' + i + '）');
      assertEqual(qs.map((q) => q.tier).join(','), H.TIERS.join(','), '層の並び');
      const ns = L.pickNear(Bank, {}, rnd);
      assertEqual(ns.length, N.ROUNDS, '5問');
      assertEqual(new Set(ns.map((q) => q.q)).size, N.ROUNDS, '同じ問題が無い（' + i + '）');
      assertEqual(new Set(ns.map((q) => q.table)).size, N.ROUNDS, 'ちがう表から5問（同じ山ばかりにしない）');
      assert(ns.every((q) => typeof q.answer === 'number' && q.unit), '答えの数と単位がある');
    }
    // 部屋で出した問題は、足りるうちは出さない
    const used = {}; L.pickHaya(Bank, {}, rnd).forEach((q) => { used[q.q] = true; });
    const next = L.pickHaya(Bank, used, rnd);
    assertEqual(next.filter((q) => used[q.q]).length, 0, '続けて遊んでも、前の回の問題は出ない');
  });

  r.finish();
})();
