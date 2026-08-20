// tests/sugoroku-hand.js — すごろく「てふだ」のルール層（第36弾-22）
//
// このゲームはサイコロを振らない。芯は2つ:
//   ・**配り方が公平か**（合計に差があると、配った時点で勝負がつく）
//   ・**ぴったり上がり**が効いているか（超える札は出せない＝交渉が意味を持つ）
//
// どちらも「守りたい約束」を具体の数字で書く。実装側の定数を検査の範囲に
// そのまま使うと、定数を緩めた時に検査も一緒に緩んで素通りする（落とし穴10の型a）。

const H = require('../public/js/sugoroku-hand');
const { createRunner, assert, assertEqual } = require('./harness');

// 決まった順で回る乱数。配り方の確かめは、たまたま通ることがあってはいけない
function seeded(seed) {
  let s = seed || 1;
  return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

(async function main() {
  const r = createRunner('sugoroku-hand：てふだのルール');

  // ---- 配り方 ----

  await r.test('全員の手札の合計が、ぴったり同じになる', async () => {
    // 合計に差があると、配った時点で勝負がつく。
    // 運の要素は合計ではなく「数字の内訳」の側に置く（決めごと㊲）
    for (let seed = 1; seed <= 40; seed++) {
      const hands = H.dealHands(6, seeded(seed));
      const sums = hands.map((h) => H.handSum(h));
      assertEqual(new Set(sums).size, 1,
        'seed=' + seed + ' で合計が割れた（' + sums.join(',') + '）');
    }
  });

  await r.test('手札は10枚ちょうどで、数字は1〜6に収まる', async () => {
    for (let seed = 1; seed <= 40; seed++) {
      H.dealHands(6, seeded(seed)).forEach((h) => {
        assertEqual(h.length, 10, 'seed=' + seed + ' で枚数が10枚でない');
        h.forEach((c) => {
          assert(c >= 1 && c <= 6, 'seed=' + seed + ' に ' + c + ' が混ざった');
        });
      });
    }
  });

  await r.test('合計は、盤(30)を超えて少しだけ余裕がある', async () => {
    // 30ちょうどだと1枚も無駄にできず、多すぎると出し方を間違えても届いてしまう。
    // **具体の数字で書く**（定数を緩めた時に、この検査も一緒に緩まないように）
    for (let seed = 1; seed <= 40; seed++) {
      const sum = H.handSum(H.dealHands(1, seeded(seed))[0]);
      assert(sum >= 33 && sum <= 38, 'seed=' + seed + ' の合計が ' + sum);
      assert(sum > 30, '盤に届かない手札が配られた（' + sum + '）');
      assert(sum - 30 <= 8, '余裕がありすぎる（' + (sum - 30) + 'マスぶん）');
    }
  });

  await r.test('配るたびに内訳は変わる（同じ手札ばかりにならない）', async () => {
    const seen = new Set();
    for (let seed = 1; seed <= 30; seed++) {
      seen.add(H.dealHands(1, seeded(seed))[0].slice().sort().join(','));
    }
    assert(seen.size >= 10, '内訳がほとんど同じ（' + seen.size + '通り）');
  });

  // ---- ぴったり上がり ----

  await r.test('ゴールを超える札は出せない（このゲームだけの決めごと）', async () => {
    // 盤30・いま27マス目なら、出せるのは3まで
    assertEqual(H.canPlay(3, 27, 30), true, 'ぴったりなら出せる');
    assertEqual(H.canPlay(2, 27, 30), true, '手前で止まるのも出せる');
    assertEqual(H.canPlay(4, 27, 30), false, '1マスでも超えたら出せない');
    assertEqual(H.canPlay(6, 27, 30), false, '大きく超えるのも出せない');
  });

  await r.test('出せる札の一覧に、超える札が混ざらない', async () => {
    const hand = [1, 2, 3, 4, 5, 6];
    assertEqual(H.playable(hand, 27, 30).join(','), '1,2,3', 'あと3マスなら1〜3だけ');
    assertEqual(H.playable(hand, 0, 30).join(','), '1,2,3,4,5,6', '序盤は全部出せる');
    assertEqual(H.playable(hand, 29, 30).join(','), '1', 'あと1マスなら1だけ');
  });

  await r.test('出せる札が1枚も無い時が、ちゃんと起こる', async () => {
    // 起こらないなら「進めない」の救済（決めごと㊳）が一度も動かない＝作っても無意味。
    // 検査したい状況が本当に作れることを、先に1つ確かめる（落とし穴10の型b）
    assertEqual(H.canMove([4, 5, 6], 27, 30), false, '大きい札しか無いと進めない');
    assertEqual(H.canMove([4, 5, 6, 1], 27, 30), true, '1枚でもあれば進める');
    assertEqual(H.canMove([], 10, 30), false, '札が尽きても進めない');
  });

  await r.test('大きい札から出していくと、最後に届かなくなる', async () => {
    // これが無いと「ぴったり上がり」の緊張が生まれない。
    // 6を4枚使って24。残り6マスに対して、手元に6しか無ければ出せる（ぴったり）が、
    // 5しか無ければ詰まる
    let pos = 0;
    [6, 6, 6, 6].forEach((c) => { pos += c; });
    assertEqual(pos, 24, '24マス目にいる');
    assertEqual(H.canMove([5, 5], pos, 30), true, '5なら29まで進める（まだ詰まらない）');
    assertEqual(H.canMove([5, 5], 29, 30), false, 'そこから先は5では出られない');
    assertEqual(H.canPlay(6, 24, 30), true, '6を1枚残していれば、ぴったり上がれる');
  });

  // ---- 札を使う ----

  await r.test('同じ数字が2枚あっても、出すのは1枚だけ', async () => {
    const after = H.useCard([3, 3, 5], 3);
    assertEqual(after.join(','), '3,5', '1枚だけ減る');
    assertEqual(H.useCard([3, 5], 4), null, '持っていない札は出せない');
  });

  // ---- 交渉 ----

  await r.test('値段は1〜9。それ以外は受け取らない', async () => {
    [1, 5, 9].forEach((n) => assertEqual(H.priceOk(n), true, n + ' は値段として通る'));
    [0, 10, -3, 1.5, NaN, null, '3'].forEach((n) => {
      assertEqual(H.priceOk(n), false, JSON.stringify(n) + ' を値段として受け取ってはいけない');
    });
  });

  await r.test('買えない時は、理由が返る', async () => {
    const offer = { sellerId: 'p2', card: 3, price: 5 };
    assertEqual(H.buyError(offer, 9, 'p1'), null, 'コインが足りていれば買える');
    assertEqual(H.buyError(offer, 4, 'p1'), 'no_coins', 'コインが足りない');
    assertEqual(H.buyError(offer, 9, 'p2'), 'not_expected', '自分の札は買えない');
    assertEqual(H.buyError(null, 9, 'p1'), 'unknown_target', '無い札は買えない');
    assertEqual(H.buyError({ sellerId: 'p2', card: 3, price: 99 }, 99, 'p1'), 'bad_action',
      '範囲外の値段は受け取らない');
  });

  // ---- 決着 ----

  await r.test('決着は、あがった人 → 進んだマス → 残ったコインの順', async () => {
    const out = H.rankHands([
      { id: 'a', name: 'あ', pos: 20, coins: 5, goalOrder: null },
      { id: 'b', name: 'い', pos: 30, coins: 1, goalOrder: 1 },
      { id: 'c', name: 'う', pos: 20, coins: 9, goalOrder: null },
      { id: 'd', name: 'え', pos: 12, coins: 20, goalOrder: null }
    ]);
    assertEqual(out.map((p) => p.id).join(','), 'b,c,a,d', '並び順');
    assertEqual(out[0].rank, 1, 'あがった人が1位');
    assertEqual(out[1].rank, 2, '同じマスでもコインが多い方が上');
    assertEqual(out[3].rank, 4, '一番手前が最下位');
  });

  await r.test('まったく同じなら同着になる', async () => {
    const out = H.rankHands([
      { id: 'a', name: 'あ', pos: 18, coins: 7, goalOrder: null },
      { id: 'b', name: 'い', pos: 18, coins: 7, goalOrder: null },
      { id: 'c', name: 'う', pos: 4, coins: 2, goalOrder: null }
    ]);
    // 同着が本当に作れていることを先に確かめる（作れていないと、次の主張が自明に通る）
    assertEqual(out[0].rank, out[1].rank, '同じ順位になっている');
    assertEqual(out[0].tied, true, '同着の印が付く');
    assertEqual(out[2].tied, false, '同着でない人には付かない');
    assertEqual(out[2].rank, 3, '同着の次は3位（2位が2人いる）');
  });

  await r.test('誰もあがれなくても、順位はつく', async () => {
    // 補充が無いので、全員が進めなくなって終わることがある（決めごと㊴）。
    // その時に順位がつかないと、勝負が終わらない
    const out = H.rankHands([
      { id: 'a', name: 'あ', pos: 26, coins: 3, goalOrder: null },
      { id: 'b', name: 'い', pos: 28, coins: 0, goalOrder: null }
    ]);
    assertEqual(out[0].id, 'b', '一番進んでいる人が1位');
    assertEqual(out[0].goalOrder, null, 'あがっていないことも分かる');
  });

  r.finish();
})();
