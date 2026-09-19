// tests/versus.js — 共通部品A（1v1の同時マッチング）の見張り（指示55-①・門T6）
//
// 見張るのは、②以降5本が乗るために必要な約束：
//   ① 奇数なら1人だけ余り、その人は `parity`（＝不戦勝）
//   ② 同じ人が2回続けて不戦勝にならない
//   ③ 過去の相手を**できるだけ**避ける（無理なら避けない相手と組む＝柔らかい条件）
//   ④ 希望（絞り込み）を外から渡せる。**段階つき**で、第1希望が空なら第2希望へ
//   ⑤ 組に「理由の印」が付く（②の「勝てば2つ上」が書けるため）
//   ⑥ **`parity` と `no-candidate` を取り違えない**（①の不戦勝と②のAIがぶつかる）
//   ⑦ 余りの吸収は 'bye' と 'trio' の両方が動く
//   ⑧ `buildPairs` の返り値の形が、移設しても1バイトも変わっていない
//
// 落とし穴10-a を避けるため、**守りたい約束は具体の数字で書く**
//（実装の定数を期待値に使わない）。
// 落とし穴10-b を避けるため、**検査したい状況が本当に作れたかを先に1つ主張する**。
// 落とし穴10-c を避けるため、**分岐は両側の入力を与える**（偶数と奇数・'bye' と 'trio'）。

const V = require('../public/js/versus');
const { createRunner, assert, assertEqual } = require('./harness');

/** 決まった順で引く乱数（同じ並びを何度でも作れる） */
function seeded(seed) {
  let s = seed || 1;
  return function () { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
}

/** 組に出てくる id を全部（c も含めて） */
function 組の全員(res) {
  const out = [];
  res.組.forEach((g) => { out.push(g.a, g.b); if (g.c) out.push(g.c); });
  return out;
}
/** 相手なしのうち、その理由の id だけ */
function なぜ(res, 理由) {
  return res.相手なし.filter((x) => x.なぜ === 理由).map((x) => x.id);
}

(async function main() {
  const r = createRunner('versus：1v1の同時マッチング（共通部品A）');

  // ---------- ① 奇数の不戦勝 ----------

  await r.test('偶数なら全員が組になり、余りが1人も出ない', async () => {
    const 名簿 = ['a', 'b', 'c', 'd', 'e', 'f'];
    const res = V.組をつくる(名簿, { rnd: seeded(7) });
    assertEqual(res.組.length, 3, '6人なら3組');
    assertEqual(res.相手なし.length, 0, '余りは0人');
    // **全員がちょうど1回ずつ出ている**（同じ人が2つの組に入っていない）
    assertEqual(組の全員(res).slice().sort().join(','), 'a,b,c,d,e,f', '6人が1回ずつ');
  });

  await r.test('奇数なら1人だけ余り、その人の理由は parity（不戦勝）', async () => {
    const 名簿 = ['a', 'b', 'c', 'd', 'e'];
    const res = V.組をつくる(名簿, { rnd: seeded(7) });
    assertEqual(res.組.length, 2, '5人なら2組');
    assertEqual(res.相手なし.length, 1, '余りは1人');
    assertEqual(res.相手なし[0].なぜ, 'parity', '理由は parity（候補はいたが余った）');
    // 組んだ4人＋余った1人＝5人。**取りこぼしも重複も無い**
    const 全部 = 組の全員(res).concat(res.相手なし.map((x) => x.id)).sort().join(',');
    assertEqual(全部, 'a,b,c,d,e', '5人が1回ずつ、どこかに出ている');
  });

  // ---------- ② 連続不戦勝を避ける ----------

  await r.test('前の回に不戦勝だった人は、次の回で不戦勝にならない（7人・20回まわす）', async () => {
    const 名簿 = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const rnd = seeded(3);
    let 直前 = null;
    let 連続した = [];
    let 見た不戦勝 = 0;
    for (let i = 0; i < 20; i++) {
      const res = V.組をつくる(名簿, { rnd, 連続不戦勝を避ける: true, 直前の不戦勝: 直前 });
      const 今回 = なぜ(res, 'parity');
      assertEqual(今回.length, 1, i + '回目：7人なので不戦勝は必ず1人');
      見た不戦勝++;
      if (直前 && 今回[0] === 直前) 連続した.push(i + '回目：' + 直前);
      直前 = 今回[0];
    }
    // 型(b)：**その状況が本当に作れたか**を先に主張する
    assertEqual(見た不戦勝, 20, '20回とも不戦勝が1人出ている（＝検査する対象が毎回あった）');
    assertEqual(連続した.join(' / '), '', '同じ人が2回続けて不戦勝になっている');
  });

  await r.test('門を外すと、実際に連続不戦勝が起きる（この検査が空回りしていないこと）', async () => {
    // 落とし穴10-f：**壊したら、壊れたことを1つ測る。**
    // 門（連続不戦勝を避ける）を渡さない時に連続が「起きうる」ことを見ておかないと、
    // 上の検査は「たまたま起きなかっただけ」かもしれない
    const 名簿 = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const rnd = seeded(3);
    let 直前 = null, 連続 = 0;
    for (let i = 0; i < 60; i++) {
      const res = V.組をつくる(名簿, { rnd });   // ← 門を渡さない
      const 今回 = なぜ(res, 'parity')[0];
      if (直前 && 今回 === 直前) 連続++;
      直前 = 今回;
    }
    assert(連続 > 0, '門を外した時は連続不戦勝が起きる（実際:' + 連続 + '回）');
  });

  // ---------- ③ 過去の相手を避ける（柔らかい条件） ----------

  await r.test('避けられる相手がいれば避ける', async () => {
    // a は b と当たったことがある。4人いるので、a は c か d と組めるはず
    const 済み = { 'a|b': true, 'b|a': true };
    const res = V.組をつくる(['a', 'b', 'c', 'd'], {
      rnd: seeded(11),
      避ける: (x, y) => !!済み[x + '|' + y]
    });
    const aの組 = res.組.find((g) => g.a === 'a' || g.b === 'a');
    assert(aの組, 'a が組になっている');
    const aの相手 = aの組.a === 'a' ? aの組.b : aの組.a;
    assertEqual(aの相手 === 'b', false, 'a の相手が b ではない（避けられた）');
  });

  await r.test('避けない相手が1人もいなければ、避ける相手と組む（柔らかい条件・折れる）', async () => {
    // 2人しかいないので、当たったことがあっても組むしかない
    const res = V.組をつくる(['a', 'b'], { rnd: seeded(11), 避ける: () => true });
    // 型(b)：**避ける条件が本当に全部に当たっている**ことを先に見る
    assertEqual(res.組.length, 1, '2人なら1組できる（避ける条件で組めなくなっていない）');
    assertEqual([res.組[0].a, res.組[0].b].sort().join(','), 'a,b', 'a と b が組んだ');
    assertEqual(res.相手なし.length, 0, '「避ける」を理由に余らせていない');
  });

  // ---------- ④⑤ 段階つきの希望と、理由の印 ----------

  await r.test('希望を渡すと、その条件どうしで組む（②の「同ランク同士」の形）', async () => {
    const 名簿 = [
      { id: 'a', ランク: 1 }, { id: 'b', ランク: 1 },
      { id: 'c', ランク: 2 }, { id: 'd', ランク: 2 }
    ];
    const res = V.組をつくる(名簿, {
      rnd: seeded(5),
      希望: [{ 理由: '同格', 候補: (名簿, 人) =>
        名簿.filter((x) => x.id !== 人.id && x.ランク === 人.ランク) }]
    });
    assertEqual(res.組.length, 2, '2組できる');
    const 並び = res.組.map((g) => [g.a, g.b].sort().join('')).sort().join(' ');
    assertEqual(並び, 'ab cd', '同じランクどうしで組んでいる');
    assertEqual(res.組.every((g) => g.理由 === '同格'), true, '理由の印が付いている');
  });

  await r.test('第1希望で見つからなければ第2希望へ落ちる。理由の印がその段階になる', async () => {
    // ランク2 が1人しかいないので、第1希望（同ランク）では相手がいない。
    // 第2希望（1つ下）で ランク1 と組み、理由は「挑戦」になる
    const 名簿 = [
      { id: 'a', ランク: 1 }, { id: 'b', ランク: 1 }, { id: 'c', ランク: 2 }
    ];
    const res = V.組をつくる(名簿, {
      rnd: seeded(5),
      希望: [
        { 理由: '同格', 候補: (名簿, 人) =>
          名簿.filter((x) => x.id !== 人.id && x.ランク === 人.ランク) },
        { 理由: '挑戦', 候補: (名簿, 人) =>
          名簿.filter((x) => x.id !== 人.id && Math.abs(x.ランク - 人.ランク) === 1) }
      ]
    });
    // 型(b)：**その状況（c の第1希望が空）が本当に作れているか**を先に見る
    const cの同格 = 名簿.filter((x) => x.id !== 'c' && x.ランク === 2);
    assertEqual(cの同格.length, 0, 'c の第1希望（同ランク）は空になっている');
    const cの組 = res.組.find((g) => g.a === 'c' || g.b === 'c');
    assert(cの組, 'c が組になっている（第2希望へ落ちた）');
    assertEqual(cの組.理由, '挑戦', '理由の印が第2希望のものになっている');
  });

  // ---------- ⑥ parity と no-candidate を取り違えない ----------

  await r.test('希望を全部たどっても候補ゼロの人は no-candidate（②はここでAIを出す）', async () => {
    // ランク9 は1人だけで、希望は「同ランクのみ」。**誰とも組めない**
    const 名簿 = [
      { id: 'a', ランク: 1 }, { id: 'b', ランク: 1 }, { id: 'z', ランク: 9 }
    ];
    const res = V.組をつくる(名簿, {
      rnd: seeded(5),
      希望: [{ 理由: '同格', 候補: (名簿, 人) =>
        名簿.filter((x) => x.id !== 人.id && x.ランク === 人.ランク) }]
    });
    assertEqual(なぜ(res, 'no-candidate').join(','), 'z', 'z は no-candidate');
    assertEqual(なぜ(res, 'parity').join(','), '', 'parity は1人もいない');
    assertEqual(res.組.length, 1, 'a と b は組めている');
  });

  await r.test('候補はいたが余っただけの人は parity（no-candidate にしない）', async () => {
    // 落とし穴10-c：**分岐の両側**。上の検査と同じ形で、理由だけが違う場面を作る
    const 名簿 = [
      { id: 'a', ランク: 1 }, { id: 'b', ランク: 1 }, { id: 'c', ランク: 1 }
    ];
    const res = V.組をつくる(名簿, {
      rnd: seeded(5),
      希望: [{ 理由: '同格', 候補: (名簿, 人) =>
        名簿.filter((x) => x.id !== 人.id && x.ランク === 人.ランク) }]
    });
    assertEqual(なぜ(res, 'no-candidate').join(','), '', 'no-candidate は1人もいない');
    assertEqual(なぜ(res, 'parity').length, 1, '余りは1人で、理由は parity');
    assertEqual(res.組.length, 1, '残り2人は組めている');
  });

  // ---------- ⑦ 余りの吸収（'bye' と 'trio' の両方） ----------

  await r.test("余りの吸収 'trio' なら、3人組にして不戦勝を出さない（すごろくの型）", async () => {
    const res = V.組をつくる(['a', 'b', 'c', 'd', 'e'], {
      rnd: seeded(7), 余りの吸収: 'trio'
    });
    assertEqual(res.相手なし.length, 0, '不戦勝が1人も出ない');
    const 三人 = res.組.filter((g) => !!g.c);
    assertEqual(三人.length, 1, '3人組がちょうど1つ');
    assertEqual(組の全員(res).slice().sort().join(','), 'a,b,c,d,e', '5人が1回ずつ');
  });

  await r.test("既定（'bye'）では3人組を作らない", async () => {
    // 落とし穴10-c：分岐のもう一方
    const res = V.組をつくる(['a', 'b', 'c', 'd', 'e'], { rnd: seeded(7) });
    assertEqual(res.組.filter((g) => !!g.c).length, 0, '3人組は0');
    assertEqual(なぜ(res, 'parity').length, 1, '不戦勝が1人');
  });

  // ---------- ⑧ 移設しても形が変わっていない ----------

  await r.test('buildPairs の返り値の形が、quiz-logic にあった時と同じ', async () => {
    // **具体の値で固定する**（落とし穴10-a）。実装を呼んで比べない
    assertEqual(JSON.stringify(V.buildPairs(['a', 'b', 'c', 'd'])),
      '[["a","b"],["c","d"]]', '偶数');
    assertEqual(JSON.stringify(V.buildPairs(['a', 'b', 'c'])),
      '[["a","b"],["c",null]]', '奇数は相方 null');
    assertEqual(JSON.stringify(V.buildPairs(['a'])), '[["a",null]]', '1人');
    assertEqual(JSON.stringify(V.buildPairs([])), '[]', '0人');
  });

  await r.test('quiz-logic が借りている buildPairs と、versus のそれが同一である', async () => {
    // 落とし穴1：**2つに分かれていないこと**を、参照の同一性で固定する。
    // 値が同じかどうかではなく、**同じ関数であること**を見る
    const QuizLogic = require('../public/js/quiz-logic');
    assertEqual(QuizLogic.buildPairs === V.buildPairs, true,
      'quiz-logic.buildPairs が versus.buildPairs そのものを指している');
  });

  // ---------- 種つきの乱数（秘匿の差分検査が書けること） ----------

  await r.test('同じ種なら同じ組になる（差分法の前提）', async () => {
    const 名簿 = ['a', 'b', 'c', 'd', 'e'];
    const 一 = V.組をつくる(名簿, { rnd: seeded(42) });
    const 二 = V.組をつくる(名簿, { rnd: seeded(42) });
    assertEqual(JSON.stringify(一), JSON.stringify(二), '同じ種＝同じ組');
    const 三 = V.組をつくる(名簿, { rnd: seeded(43) });
    // 型(b)：**種を変えれば本当に変わる**ことも見る（でないと「同じ」が自明になる）
    assert(JSON.stringify(一) !== JSON.stringify(三), '種を変えれば組も変わる');
  });

  r.finish();
})();
