// tests/falsetrue-logic.js — 「False or True」のルール層（指示53）
//
// 見張るのは、この遊びが成り立つための約束：
//   ① ケースの数＝人数。true と false の数が設計メモの表どおり（true は必ず1つ以上）
//   ② 結果表の4通りが、設計メモ 7 の表と1行ずつ一致する
//   ③ **4通りすべてで「生存 ⟺ 中身が true」**（着手前に見つけた性質・表が歪んだ日に赤くする）
//   ④ 対面の相手は「未対面を優先」、選ぶ人は候補に入らない
//   ⑤ 終了条件は2つだけ
//
// 落とし穴10-a を避けるため、**守りたい約束は具体の数字で書く**。
// `RULES.TALK_SEC` や `trueCount()` の戻り値を検査の期待値に使うと、
// 実装を変えた瞬間に検査も一緒に動いて素通りする。

const L = require('../public/js/falsetrue-logic');
const { createRunner, assert, assertEqual } = require('./harness');

/** 決まった順で引く乱数（同じ並びを何度でも作れる） */
function seeded(seed) {
  let s = seed || 1;
  return function () { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
}

(async function main() {
  const r = createRunner('falsetrue-logic：False or True のルール');

  // ---------- ① 中身の数 ----------

  await r.test('ケースの数と中身の比が、設計メモの表どおり（本人の裁定：表を正・round）', async () => {
    // **具体の数字で書く**（落とし穴10-a）。実装の式を呼んで比べない
    const 表 = [
      { 人: 4, ケース: 4, true: 1, false: 3 },
      { 人: 5, ケース: 5, true: 1, false: 4 },
      { 人: 6, ケース: 6, true: 2, false: 4 },   // 設計メモの表。本文の「端数は false 側」だと 1:5 になる
      { 人: 7, ケース: 7, true: 2, false: 5 },   // 表に無い。本人の裁定（2026-09-16）で 2
      { 人: 8, ケース: 8, true: 2, false: 6 }
    ];
    表.forEach((行) => {
      assertEqual(L.caseCount(行.人), 行.ケース, 行.人 + '人のケースは ' + 行.ケース + ' 枚');
      assertEqual(L.trueCount(行.人), 行.true, 行.人 + '人の true は ' + 行.true + ' 枚');
      assertEqual(L.falseCount(行.人), 行.false, 行.人 + '人の false は ' + 行.false + ' 枚');
    });
    assertEqual(表.length, 5, '4〜8人を全部見た（実際:' + 表.length + '）');   // 型(b)：数を先に主張する
  });

  await r.test('true は必ず1つ以上。false のほうが必ず多い', async () => {
    const 見た = [];
    for (let n = 4; n <= 8; n++) {
      assert(L.trueCount(n) >= 1, n + '人：true が1つ以上ある');
      assert(L.falseCount(n) > L.trueCount(n),
        n + '人：false のほうが多い（' + L.trueCount(n) + ' : ' + L.falseCount(n) + '）');
      見た.push(n);
    }
    assertEqual(見た.length, 5, '5通りの人数を見た');
  });

  await r.test('中身の並びは、数が合っていて、種が違えば並びも変わる', async () => {
    for (let n = 4; n <= 8; n++) {
      const a = L.makeContents(n, seeded(1));
      assertEqual(a.length, L.caseCount(n), n + '人：枚数が合っている');
      assertEqual(a.filter(Boolean).length, L.trueCount(n), n + '人：true の数が合っている');
      // 同じ種なら同じ並び（検査が再現できること自体の担保）
      assertEqual(L.makeContents(n, seeded(1)).join(','), a.join(','), n + '人：同じ種なら同じ並び');
    }
    // 8人で種を変えたら、並びが1つでも違うものが出る（＝固定の並びを返していない）
    const 並び = new Set();
    for (let s = 1; s <= 40; s++) 並び.add(L.makeContents(8, seeded(s)).join(','));
    assert(並び.size > 1, '種を変えると並びも変わる（実際:' + 並び.size + '通り）');
  });

  // ---------- ② 結果表 ----------

  await r.test('結果表の4通りが、設計メモ 7 の表と1行ずつ一致する', async () => {
    // 設計メモの表をそのまま書き写したもの。実装の OUTCOME を期待値に使わない
    const 期待 = [
      { 選択: '奪う', 中身: true, 決まる: 'opp', 運命: 'alive', 次の選ぶ人: 'holder' },
      { 選択: '奪う', 中身: false, 決まる: 'opp', 運命: 'out', 次の選ぶ人: 'holder' },
      { 選択: '奪わない', 中身: false, 決まる: 'holder', 運命: 'out', 次の選ぶ人: 'opp' },
      { 選択: '奪わない', 中身: true, 決まる: 'holder', 運命: 'alive', 次の選ぶ人: 'opp' }
    ];
    期待.forEach((行) => {
      const o = L.outcomeOf(行.選択 === '奪う', 行.中身);
      assert(o, 行.選択 + ' × 中身' + 行.中身 + ' の行がある');
      assertEqual(o.決まる, 行.決まる, 行.選択 + ' × 中身' + 行.中身 + '：決まるのは ' + 行.決まる);
      assertEqual(o.fate, 行.運命, 行.選択 + ' × 中身' + 行.中身 + '：運命は ' + 行.運命);
      assertEqual(o.次の選ぶ人, 行.次の選ぶ人, 行.選択 + ' × 中身' + 行.中身 + '：次に選ぶのは ' + 行.次の選ぶ人);
    });
    assertEqual(期待.length, 4, '4通りすべてを見た');
    assertEqual(L.OUTCOME.length, 4, '実装の表も4行ちょうど（増えても減ってもいない）');
  });

  // ---------- ③ 着手前に見つけた性質 ----------

  await r.test('4通りすべてで「生存 ⟺ 中身が true」（奪う/奪わないは、誰が受け取るかだけを決める）', async () => {
    // 着手前に机上で見つけた性質（docs/監査_指示53の門.md ③）。
    // **表が歪んだ日に、ここが赤くなる**——たとえば「奪う×false で相手が生存」に
    // 書き換わると、遊びの芯（false を押しつける駆け引き）が壊れる
    let 見た = 0;
    [true, false].forEach((taken) => {
      [true, false].forEach((content) => {
        const o = L.outcomeOf(taken, content);
        assertEqual(o.fate === 'alive', content,
          (taken ? '奪う' : '奪わない') + ' × 中身' + content + '：生存かどうかは中身だけで決まる');
        見た++;
      });
    });
    assertEqual(見た, 4, '4通りすべてで確かめた');

    // 「決まるのは誰か」は、逆に**選択だけ**で決まる（中身に依らない）
    assertEqual(L.outcomeOf(true, true).決まる, L.outcomeOf(true, false).決まる,
      '奪った時に決まるのは、中身に関係なく同じ側');
    assertEqual(L.outcomeOf(false, true).決まる, L.outcomeOf(false, false).決まる,
      '奪わなかった時に決まるのは、中身に関係なく同じ側');
    assert(L.outcomeOf(true, true).決まる !== L.outcomeOf(false, true).決まる,
      '奪う と 奪わない では、決まる人が入れ替わる');
  });

  // ---------- ④ 対面の相手 ----------

  await r.test('相手の候補：選ぶ人は入らず、まだ対面していない人が優先される', async () => {
    const 未確定 = ['a', 'b', 'c', 'd'];
    // 誰も対面していない → 選ぶ人を除いた全員
    assertEqual(L.opponentPool(未確定, 'a', []).join(','), 'b,c,d', '選ぶ人は候補に入らない');
    // b が対面済み → c,d だけ
    assertEqual(L.opponentPool(未確定, 'a', ['b']).join(','), 'c,d', 'まだ対面していない人が優先される');
    // 全員が対面済み → 選ぶ人以外の全員に戻る（候補が空にならない）
    assertEqual(L.opponentPool(未確定, 'a', ['b', 'c', 'd']).join(','), 'b,c,d',
      '全員が対面済みなら、選ぶ人以外の全員から選ぶ');
    // 2人になった時も、相手が1人だけ残る
    assertEqual(L.opponentPool(['a', 'b'], 'a', ['b']).join(','), 'b', '2人なら相手は1人（候補は空にならない）');
  });

  // ---------- ⑤ 終わり ----------

  await r.test('終了条件は2つだけ。まだ続く時は null', async () => {
    assertEqual(L.endReason(1, 5), 'last', '決まっていない人が1人 → 終わり');
    assertEqual(L.endReason(0, 5), 'last', '0人になっても終わり（全員が抜けた時）');
    assertEqual(L.endReason(3, 0), 'cases', 'ケースが尽きた → 終わり');
    assertEqual(L.endReason(3, 2), null, 'どちらでもなければ続く');
    // 両方そろった時は「1人残り」が先（残った1人は自動で生存＝そちらのほうが親切）
    assertEqual(L.endReason(1, 0), 'last', '両方そろったら「1人残り」が先');
  });

  // ---------- 設定 ----------

  await r.test('話し合いの長さは3択。それ以外はどんな値でも既定に落ちる', async () => {
    assertEqual(L.normalizeConfig({ talkSec: 30 }).talkSec, 30, '30秒はそのまま');
    assertEqual(L.normalizeConfig({ talkSec: 60 }).talkSec, 60, '60秒はそのまま');
    assertEqual(L.normalizeConfig({ talkSec: 90 }).talkSec, 90, '90秒はそのまま');
    // 端末が嘘をついても、サーバーは3択の外を受け取らない（落とし穴：数字を信じない）
    [0, -1, 1, 45, 999, 99999, null, undefined, 'すごくながい', NaN, {}].forEach((v) => {
      assertEqual(L.normalizeConfig({ talkSec: v }).talkSec, 60,
        JSON.stringify(v) + ' は既定の60秒に落ちる');
    });
    assertEqual(L.normalizeConfig().talkSec, 60, '設定そのものが無くても既定になる');
    assertEqual(L.RULES.TALK_CHOICES.join(','), '30,60,90', '選べるのは3つだけ');
  });

  await r.test('締め切りの安全弁は、全部の段階に値がある（押さなくても止まらない）', async () => {
    // 段階を足したのに安全弁を書き忘れる、を捕まえる（落とし穴4）
    const 要る = ['PICK_SEC', 'PEEK_SEC', 'FACE_SEC', 'DECIDE_SEC', 'REVEAL_SEC'];
    要る.forEach((k) => {
      assert(typeof L.RULES[k] === 'number' && L.RULES[k] > 0, k + ' に正の秒数がある');
    });
    assertEqual(要る.length, 5, '5つの段階ぶん見た');
    // 切れた時の既定が3つとも決まっている
    assertEqual(L.DEFAULT_ON_TIMEOUT.decide, 'keep',
      '決めなかった人は「奪わない」（1:3 なのでそれが素の判断）');
    assertEqual(Object.keys(L.DEFAULT_ON_TIMEOUT).sort().join(','), 'decide,peek,pick',
      '既定が要る段階は3つ');
  });

  r.finish();
})();
