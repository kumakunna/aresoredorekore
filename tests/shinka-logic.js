// tests/shinka-logic.js — 進化じゃんけんのルール層（指示55-②）
//
// 見張るのは、この遊びが成り立つための約束：
//   ① 段はデータ（配列）。通常版とCS版は**同じエンジン・違う配列**
//   ② 3すくみは**すごろくのミニゲームから借りている**（表を2つ持たない）
//   ③ じゃんけんの勝敗。**出さなかったら負け／両者とも出さなければあいこ**
//   ④ AIの手の分布 75/10/15（**多数回で検定**・門U7）
//   ⑤ 希望の3段が「1人ランク」を候補関数の中で見ている（門U6の1行目）
//   ⑥ ランクの動き全パターン（門U5）と、1人ランクの6条件（門U6）
//   ⑦ 肩慣らしは**どちらも動かない**（本人の裁定・論点②の新規則）
//   ⑧ 優勝の読みが、はしごごとに違う（本人の裁定・論点④）
//   ⑨ 順位：段が高い順、**同じ段は同着**
//
// 落とし穴10-a を避けるため、**守りたい約束は具体の数字で書く**
//（`既定` や `幅` のような実装側の定数を期待値に使わない）。

const L = require('../public/js/shinka-logic');
const V = require('../public/js/versus');
const Mini = require('../public/js/sugoroku-mini');
const { createRunner, assert, assertEqual } = require('./harness');

/** 決まった順で引く乱数（同じ並びを何度でも作れる） */
function seeded(seed) {
  let s = seed >>> 0;
  return function () {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 段の人数を数える */
function 人数表(名簿) {
  const t = {};
  名簿.forEach((p) => { t[p.段] = (t[p.段] || 0) + 1; });
  return t;
}

/** 状態の表をまとめて作る */
function 状態(...段たち) {
  const s = {};
  段たち.forEach((段, i) => { s['p' + i] = { 段: 段, 連敗: 0, 挑戦を受けた: 0 }; });
  return s;
}

(async function main() {
  const r = createRunner('shinka-logic：進化じゃんけんのルール');

  // ---------- ① 段はデータ ----------

  await r.test('通常版は5段。最下段が たまご、最終形が りゅう', async () => {
    const L5 = L.ladderOf('normal');
    assertEqual(L5.段.length, 5, '5段');
    assertEqual(L5.段[0].名, 'たまご', '最下段');
    assertEqual(L5.段[4].名, 'りゅう', '最終形');
    // **段の番号は、ここで1つだけ付ける**（画面が index+1 を書くと0始まりと混ざる）
    assertEqual(L5.段[0].no, 1, '番号は1始まり');
    assertEqual(L5.段[4].no, 5, '最終形は5');
  });

  await r.test('CS版は10段。アンランク〜チャンピオンで、CSポイントを持っている', async () => {
    const C = L.ladderOf('cs');
    assertEqual(C.段.length, 10, '10段');
    assertEqual(C.段[0].名, 'アンランク', '最下段');
    assertEqual(C.段[9].名, 'チャンピオン', '最終形');
    // **この指示では持つだけ**（56で使う）。具体の数字で固定する
    assertEqual(C.段.map((s) => s.cs).join(','), '0,0,1,3,5,7,10,15,20,30', 'CSポイント');
  });

  await r.test('知らないはしごを頼まれたら、通常版に落ちる（不在で表さない・落とし穴36）', async () => {
    assertEqual(L.ladderOf('そんなものは無い').id, 'normal', '既定へ');
    assertEqual(L.normalizeConfig({ ladder: 'ねつ造' }).ladder, 'normal', '設定も既定へ');
    assertEqual(L.normalizeConfig({ ladder: 'cs' }).ladder, 'cs', 'ある名前はそのまま');
  });

  await r.test('段の絵文字は、どの2つも同じでない（2-10：色に頼らない）', async () => {
    L.ladderIds().forEach((id) => {
      const 段 = L.ladderOf(id).段;
      const 絵 = 段.map((s) => s.絵);
      assertEqual(new Set(絵).size, 絵.length, id + ' の絵文字が重複していない');
      const 名 = 段.map((s) => s.名);
      assertEqual(new Set(名).size, 名.length, id + ' の名前が重複していない');
    });
  });

  await r.test('設定は上限でも下限でも止まる（落とし穴8：片方向にしか効かないチェックを作らない）', async () => {
    // **具体の数字で書く。**実装の 幅 を借りると、幅を広げた日に検査も広がる
    assertEqual(L.normalizeConfig({ throwSec: 999 }).throwSec, 15, '持ち時間の上限は15秒');
    assertEqual(L.normalizeConfig({ throwSec: 0 }).throwSec, 2, '持ち時間の下限は2秒');
    assertEqual(L.normalizeConfig({ drawMax: 99 }).drawMax, 9, 'あいこ上限の上限は9');
    assertEqual(L.normalizeConfig({ drawMax: 0 }).drawMax, 1, 'あいこ上限の下限は1');
    assertEqual(L.normalizeConfig({ limitSec: 99999 }).limitSec, 1800, '打ち切りの上限は1800秒');
    assertEqual(L.normalizeConfig({ limitSec: 1 }).limitSec, 60, '打ち切りの下限は60秒');
    // 既定
    const d = L.normalizeConfig({});
    assertEqual(d.throwSec, 3, '既定は3秒');
    assertEqual(d.drawMax, 3, '既定はあいこ3回まで');
    assertEqual(d.limitSec, 600, '既定は10分');
  });

  // ---------- ② 3すくみは借りている ----------

  await r.test('3すくみの表は、すごろくのミニゲームと**同じもの**（落とし穴1：表を2つ持たない）', async () => {
    // 値が等しいだけでなく、**同じオブジェクト**であること。
    // 写しを持つと、片方だけ直す日が来る
    assert(L.BEATS === Mini.BEATS, 'BEATS は借り物（同一オブジェクト）');
    assert(L.HANDS === Mini.HANDS, 'HANDS は借り物');
    assert(L.HAND === Mini.HAND, 'HAND は借り物');
    // 中身も具体の値で固定しておく（借り先が壊れた日に、こちらでも赤くなる）
    assertEqual(JSON.stringify(L.BEATS), '{"g":"c","c":"p","p":"g"}', 'グーはチョキに勝つ');
  });

  // ---------- ③ じゃんけんの勝敗 ----------

  await r.test('3すくみが9通りとも正しい', async () => {
    const 表 = {
      'g,g': 'draw', 'g,c': 'a', 'g,p': 'b',
      'c,g': 'b', 'c,c': 'draw', 'c,p': 'a',
      'p,g': 'a', 'p,c': 'b', 'p,p': 'draw'
    };
    Object.keys(表).forEach((k) => {
      const [x, y] = k.split(',');
      assertEqual(L.judge(x, y), 表[k], k + ' の勝敗');
    });
  });

  await r.test('出さなかったら負け。両者とも出さなければ あいこ（指示書2-3）', async () => {
    assertEqual(L.judge(null, 'g'), 'b', 'aが出さない → bの勝ち');
    assertEqual(L.judge('g', null), 'a', 'bが出さない → aの勝ち');
    assertEqual(L.judge(null, null), 'draw', '両者とも出さない → あいこ');
    // 遊びに無い手は「出していない」と同じ扱い
    assertEqual(L.judge('ねつ造', 'g'), 'b', '知らない手は出していない扱い');
    assertEqual(L.validHand('g'), true, 'グーは手');
    assertEqual(L.validHand('x'), false, 'x は手ではない');
  });

  // ---------- ④ AIの分布（門U7） ----------

  await r.test('AIの手は 75%で負け・10%で勝ち・15%あいこ（多数回で検定・門U7）', async () => {
    const rnd = seeded(20260920);
    const N = 60000;
    // **3つの手すべてを相手にして測る**（片方の入力しか与えない、を避ける・落とし穴10-c）
    L.HANDS.forEach((人の手) => {
      let 勝 = 0, 負 = 0, 分 = 0;
      for (let i = 0; i < N; i++) {
        const ai = L.aiHand(人の手, rnd);
        const j = L.judge(人の手, ai);
        if (j === 'a') 勝++; else if (j === 'b') 負++; else 分++;
      }
      // 具体の数字で書く。N=60000 なら ±1.5% は十分に狭い
      const p勝 = 100 * 勝 / N, p負 = 100 * 負 / N, p分 = 100 * 分 / N;
      assert(Math.abs(p勝 - 75) < 1.5, 人の手 + ' に対して 人の勝ち≒75%（実測 ' + p勝.toFixed(2) + '%）');
      assert(Math.abs(p負 - 10) < 1.5, 人の手 + ' に対して 人の負け≒10%（実測 ' + p負.toFixed(2) + '%）');
      assert(Math.abs(p分 - 15) < 1.5, 人の手 + ' に対して あいこ≒15%（実測 ' + p分.toFixed(2) + '%）');
    });
  });

  await r.test('AIは、相手が出していなくても手を1つ返す（進行を止めない）', async () => {
    const rnd = seeded(7);
    for (let i = 0; i < 50; i++) {
      assert(L.validHand(L.aiHand(null, rnd)), '出していない相手にも手を返す');
    }
  });

  // ---------- ⑤ 希望の3段（門U6の1行目） ----------

  await r.test('希望は3段。「1人ランクか」を**候補関数の中で**見ている（versus.js:37-38 の使い方）', async () => {
    const 希望 = L.希望を作る((x) => x.段);
    assertEqual(希望.length, 3, '同格・挑戦・肩慣らし');
    assertEqual(希望.map((h) => h.理由).join(','), '同格,挑戦,肩慣らし', '段階の名前');

    const 名簿 = [
      { id: 'a', 段: 1 }, { id: 'b', 段: 1 },   // 段1に2人
      { id: 'c', 段: 2 }                        // 段2に1人
    ];
    // 段1の人は仲間がいるので、挑戦も肩慣らしもしない
    assertEqual(希望[1].候補(名簿, 名簿[0]).length, 0, '仲間がいる人は挑戦しない');
    assertEqual(希望[2].候補(名簿, 名簿[0]).length, 0, '仲間がいる人は肩慣らしもしない');
    // 段2の人は1人なので、1つ下（段1）へ肩慣らしに行ける
    assertEqual(希望[1].候補(名簿, 名簿[2]).length, 0, '段3には誰もいない');
    assertEqual(希望[2].候補(名簿, 名簿[2]).length, 2, '1人ランクは1つ下と当たれる');
  });

  await r.test('**組めるはずの1組が消えない**（段5に1人・段6に1人。門の文書1-2の回帰）', async () => {
    // 2段希望（同ランク／1つ上だけ）だと、versus.js:156-162 の候補ゼロ判定が
    // 段6の人を先に外し、段5の人まで parity に落ちる。3段にすると組める
    const 希望 = L.希望を作る((x) => x.段);
    for (let s = 1; s <= 200; s++) {
      const 名簿 = [{ id: 'X', 段: 5 }, { id: 'Y', 段: 6 }];
      const res = V.組をつくる(名簿, {
        rnd: seeded(s), 希望: 希望, 余りの吸収: 'bye', 連続不戦勝を避ける: true
      });
      assertEqual(res.組.length, 1, '種' + s + '：1組できる');
      assertEqual(res.相手なし.length, 0, '種' + s + '：あぶれる人はいない');
    }
  });

  await r.test('**挑戦の印が付くのは、本当に段に1人の時だけ**（門の文書1-4の回帰・門U6）', async () => {
    const 希望 = L.希望を作る((x) => x.段);
    // 段1に3人・段2に3人。素朴な2段希望だと、ここで「挑戦」が大量に付いていた
    let 挑戦 = 0, 誤り = 0;
    for (let s = 1; s <= 500; s++) {
      const 名簿 = [1, 1, 1, 2, 2, 2].map((段, i) => ({ id: 'p' + i, 段: 段 }));
      const M = {}; 名簿.forEach((p) => { M[p.id] = p; });
      const 表 = 人数表(名簿);
      const res = V.組をつくる(名簿, {
        rnd: seeded(s), 希望: 希望, 余りの吸収: 'bye', 連続不戦勝を避ける: true
      });
      res.組.forEach((g) => {
        const 低 = Math.min(M[g.a].段, M[g.b].段);
        const 種 = L.組の種別(g.理由, M[g.a].段, M[g.b].段, 表[低] || 0);
        if (種 === L.種別.挑戦) { 挑戦++; if ((表[低] || 0) !== 1) 誤り++; }
      });
    }
    assertEqual(誤り, 0, '同段に仲間がいる人に、挑戦の印は付かない');
    // **条件が作れていることを1つ確かめる**（落とし穴10-b：自明に成立していないか）
    let 挑戦あり = 0;
    for (let s = 1; s <= 200; s++) {
      const 名簿 = [{ id: 'L', 段: 1 }, { id: 'H1', 段: 2 }, { id: 'H2', 段: 2 }];
      const M = {}; 名簿.forEach((p) => { M[p.id] = p; });
      const 表 = 人数表(名簿);
      const res = V.組をつくる(名簿, {
        rnd: seeded(s), 希望: 希望, 余りの吸収: 'bye', 連続不戦勝を避ける: true
      });
      res.組.forEach((g) => {
        const 低 = Math.min(M[g.a].段, M[g.b].段);
        if (L.組の種別(g.理由, M[g.a].段, M[g.b].段, 表[低] || 0) === L.種別.挑戦) 挑戦あり++;
      });
    }
    assert(挑戦あり > 0, '1人ランクの人には、ちゃんと挑戦の印が付く（検査が自明でない）');
  });

  await r.test('**両方が1人ランクなら、必ず挑戦**（順に依らない・本人の裁定 論点⑧）', async () => {
    const 希望 = L.希望を作る((x) => x.段);
    let 挑戦 = 0, その他 = 0;
    for (let s = 1; s <= 500; s++) {
      const 名簿 = [{ id: 'L', 段: 5 }, { id: 'H', 段: 6 }];
      const M = {}; 名簿.forEach((p) => { M[p.id] = p; });
      const 表 = 人数表(名簿);
      const res = V.組をつくる(名簿, {
        rnd: seeded(s), 希望: 希望, 余りの吸収: 'bye', 連続不戦勝を避ける: true
      });
      res.組.forEach((g) => {
        const 種 = L.組の種別(g.理由, M[g.a].段, M[g.b].段, 表[Math.min(M[g.a].段, M[g.b].段)] || 0);
        if (種 === L.種別.挑戦) 挑戦++; else その他++;
      });
    }
    assertEqual(その他, 0, '500種すべてで挑戦（shuffle の順で揺れない）');
    assertEqual(挑戦, 500, '毎回1組できている');
  });

  // ---------- ⑥ ランクの動き（門U5） ----------

  await r.test('同格：勝てば1つ上、負ければそのまま（門U5）', async () => {
    const s = 状態(1, 1);
    const out = L.applyMatch({ 種別: L.種別.同格, a: 'p0', b: 'p1', 勝者: 'a', 状態: s, 段数: 5 });
    assertEqual(out.状態.p0.段, 2, '勝った人は1つ上');
    assertEqual(out.状態.p0.連敗, 0, '勝った人の連敗は0');
    assertEqual(out.状態.p1.段, 1, '負けた人はそのまま');
    assertEqual(out.状態.p1.連敗, 1, '負けた人は連敗1');
    // **入力を書き換えていない**（進行役が前の値を見られる）
    assertEqual(s.p0.段, 1, '入力は書き換えない');
  });

  await r.test('2連敗で1つ下がる。**最下段は落ちない**（門U5）', async () => {
    let s = 状態(2, 2);
    s.p1.連敗 = 1;
    let out = L.applyMatch({ 種別: L.種別.同格, a: 'p0', b: 'p1', 勝者: 'a', 状態: s, 段数: 5 });
    assertEqual(out.状態.p1.段, 1, '2連敗で1つ下');
    assertEqual(out.状態.p1.連敗, 0, '落ちたら連敗は0に戻る');
    // 最下段
    s = 状態(2, 0);
    s.p1.連敗 = 1;
    out = L.applyMatch({ 種別: L.種別.同格, a: 'p0', b: 'p1', 勝者: 'a', 状態: s, 段数: 5 });
    assertEqual(out.状態.p1.段, 0, '最下段は落ちない');
    assertEqual(out.状態.p1.連敗, 0, 'それでも連敗は0に戻る');
  });

  await r.test('**上がったら連敗はリセット**（門U5）', async () => {
    const s = 状態(1, 1);
    s.p0.連敗 = 1;
    const out = L.applyMatch({ 種別: L.種別.同格, a: 'p0', b: 'p1', 勝者: 'a', 状態: s, 段数: 5 });
    assertEqual(out.状態.p0.段, 2, '上がった');
    assertEqual(out.状態.p0.連敗, 0, '連敗が消えた');
  });

  await r.test('最終段では、それ以上あがらない（上限）', async () => {
    const s = 状態(4, 4);
    const out = L.applyMatch({ 種別: L.種別.同格, a: 'p0', b: 'p1', 勝者: 'a', 状態: s, 段数: 5 });
    assertEqual(out.状態.p0.段, 4, '5段の最終段は index 4 で止まる');
  });

  // ---------- ⑥ 1人ランクの6条件（門U6） ----------

  await r.test('1人ランク①：勝てば**2つ上**（門U6）', async () => {
    const s = 状態(1, 2);   // p0 が挑戦者（段1）、p1 が受け（段2）
    const out = L.applyMatch({
      種別: L.種別.挑戦, a: 'p0', b: 'p1', 挑戦者: 'p0', 受け: 'p1',
      勝者: 'a', 状態: s, 段数: 10
    });
    assertEqual(out.状態.p0.段, 3, '1 → 3（2つ上）');
  });

  await r.test('1人ランク②：**チャンピオンにはならない。1つ手前で止まる**（門U6）', async () => {
    // 段数5（index 0..4）。最終段は4。挑戦者は3で止まる
    const s = 状態(3, 4);
    const out = L.applyMatch({
      種別: L.種別.挑戦, a: 'p0', b: 'p1', 挑戦者: 'p0', 受け: 'p1',
      勝者: 'a', 状態: s, 段数: 5
    });
    assertEqual(out.状態.p0.段, 3, '3+2=5 だが、最終段の1つ手前（3）で止まる');
    // 2つ下から挑んだ時も、最終段には届かない
    const s2 = 状態(2, 3);
    const out2 = L.applyMatch({
      種別: L.種別.挑戦, a: 'p0', b: 'p1', 挑戦者: 'p0', 受け: 'p1',
      勝者: 'a', 状態: s2, 段数: 5
    });
    assertEqual(out2.状態.p0.段, 3, '2+2=4 も、1つ手前（3）で止まる');
  });

  await r.test('1人ランク③：**負けても絶対に落ちない。連敗も数えない**（門U6）', async () => {
    const s = 状態(2, 3);
    s.p0.連敗 = 1;                     // もう1敗したら落ちる状態
    const out = L.applyMatch({
      種別: L.種別.挑戦, a: 'p0', b: 'p1', 挑戦者: 'p0', 受け: 'p1',
      勝者: 'b', 状態: s, 段数: 10
    });
    assertEqual(out.状態.p0.段, 2, '落ちない');
    assertEqual(out.状態.p0.連敗, 1, '連敗も増えない（1のまま）');
  });

  await r.test('1人ランク④：**相手は勝っても上がらない**（門U6）', async () => {
    const s = 状態(2, 3);
    const out = L.applyMatch({
      種別: L.種別.挑戦, a: 'p0', b: 'p1', 挑戦者: 'p0', 受け: 'p1',
      勝者: 'b', 状態: s, 段数: 10
    });
    assertEqual(out.状態.p1.段, 3, '受けは勝っても3のまま');
    assertEqual(out.状態.p1.連敗, 0, '連敗も動かない');
  });

  await r.test('1人ランク⑤：相手の負けは**1回目だけ数えない**（門U6）', async () => {
    // 1回目：挑戦を受けて負けた → 連敗は増えない
    let s = 状態(2, 3);
    let out = L.applyMatch({
      種別: L.種別.挑戦, a: 'p0', b: 'p1', 挑戦者: 'p0', 受け: 'p1',
      勝者: 'a', 状態: s, 段数: 10
    });
    assertEqual(out.状態.p1.連敗, 0, '1回目は連敗に数えない');
    assertEqual(out.状態.p1.挑戦を受けた, 1, '受けた回数は数える');
    // 2回目：こんどは数える
    out = L.applyMatch({
      種別: L.種別.挑戦, a: 'p0', b: 'p1', 挑戦者: 'p0', 受け: 'p1',
      勝者: 'a', 状態: out.状態, 段数: 10
    });
    assertEqual(out.状態.p1.連敗, 1, '2回目からは数える');
    assertEqual(out.状態.p1.挑戦を受けた, 2, '受けた回数も増える');
  });

  await r.test('1人ランク⑥：a と b のどちらが挑戦者でも、同じ結果になる（向きに依らない）', async () => {
    // 部品Aは `a` に「希望が当たった人」を入れるので、肩慣らしでは a が上になる。
    // **段から決めた挑戦者／受けを渡す**ので、a/b の向きは結果に影響しない
    const s1 = 状態(1, 2);
    const 出1 = L.applyMatch({
      種別: L.種別.挑戦, a: 'p0', b: 'p1', 挑戦者: 'p0', 受け: 'p1', 勝者: 'a', 状態: s1, 段数: 10
    });
    const s2 = 状態(1, 2);
    const 出2 = L.applyMatch({
      種別: L.種別.挑戦, a: 'p1', b: 'p0', 挑戦者: 'p0', 受け: 'p1', 勝者: 'b', 状態: s2, 段数: 10
    });
    assertEqual(JSON.stringify(出1.状態), JSON.stringify(出2.状態), '向きを変えても同じ');
  });

  // ---------- ⑦ 肩慣らし（本人の裁定・論点②の新規則） ----------

  await r.test('**肩慣らしは、どちらも動かない。連敗も数えない**（本人の裁定 2026-09-20）', async () => {
    ['a', 'b', null].forEach((勝者) => {
      const s = 状態(3, 2);
      s.p0.連敗 = 1; s.p1.連敗 = 1;
      const out = L.applyMatch({ 種別: L.種別.肩慣らし, a: 'p0', b: 'p1', 勝者: 勝者, 状態: s, 段数: 10 });
      assertEqual(out.状態.p0.段, 3, '勝者=' + 勝者 + '：上の人は動かない');
      assertEqual(out.状態.p1.段, 2, '勝者=' + 勝者 + '：下の人も動かない');
      assertEqual(out.状態.p0.連敗, 1, '勝者=' + 勝者 + '：連敗も増えない（上）');
      assertEqual(out.状態.p1.連敗, 1, '勝者=' + 勝者 + '：連敗も増えない（下）');
      assertEqual(out.動き.length, 0, '勝者=' + 勝者 + '：段の動きは0件');
    });
  });

  // ---------- AI戦のランク移動 ----------

  await r.test('AI戦：勝てば1つ上。**負けても落ちない・連敗も数えない**（門U7）', async () => {
    let s = 状態(2);
    let out = L.applyMatch({ 種別: L.種別.機械, a: 'p0', b: null, 勝者: 'a', 状態: s, 段数: 10 });
    assertEqual(out.状態.p0.段, 3, '勝てば1つ上');
    // 負け
    s = 状態(2);
    s.p0.連敗 = 1;
    out = L.applyMatch({ 種別: L.種別.機械, a: 'p0', b: null, 勝者: 'b', 状態: s, 段数: 10 });
    assertEqual(out.状態.p0.段, 2, '負けても落ちない');
    assertEqual(out.状態.p0.連敗, 1, '連敗も増えない');
  });

  // ---------- あいこの引き分け ----------

  await r.test('あいこ上限に達した引き分けは、どの種別でも両者が動かない（指示書2-3）', async () => {
    [L.種別.同格, L.種別.挑戦, L.種別.肩慣らし, L.種別.機械].forEach((種) => {
      const s = 状態(2, 3);
      s.p0.連敗 = 1;
      const out = L.applyMatch({
        種別: 種, a: 'p0', b: 'p1', 挑戦者: 'p0', 受け: 'p1', 勝者: null, 状態: s, 段数: 10
      });
      assertEqual(out.状態.p0.段, 2, 種 + '：段が動かない');
      assertEqual(out.状態.p0.連敗, 1, 種 + '：連敗も動かない');
      assertEqual(out.動き.length, 0, 種 + '：動きは0件');
    });
  });

  // ---------- ⑧ 優勝の読み（本人の裁定・論点④） ----------

  await r.test('通常版は「最終形に**到達**で優勝」（本人の裁定 論点④）', async () => {
    assertEqual(L.ladderOf('normal').優勝, '到達', '読みが到達');
    // 3 → 4（最終段）へ上がった瞬間
    assertEqual(L.isChampion('到達', 3, 4, true, 5), true, '到達した');
    // すでに最終段に居て勝っても、もう「到達」ではない
    assertEqual(L.isChampion('到達', 4, 4, true, 5), false, '既に居る人は到達しない');
    assertEqual(L.isChampion('到達', 2, 3, true, 5), false, '手前では優勝しない');
  });

  await r.test('CS版は「チャンピオンの席で**勝てば**優勝」（本人の裁定 論点④）', async () => {
    assertEqual(L.ladderOf('cs').優勝, '席で勝つ', '読みが席で勝つ');
    // 最終段(9)に居て、勝った
    assertEqual(L.isChampion('席で勝つ', 9, 9, true, 10), true, '席で勝った');
    // 最終段に着いただけでは優勝しない
    assertEqual(L.isChampion('席で勝つ', 8, 9, true, 10), false, '到達だけでは優勝しない');
    // 席に居ても、負けたら優勝しない
    assertEqual(L.isChampion('席で勝つ', 9, 9, false, 10), false, '席で負けたら優勝しない');
  });

  // ---------- ⑨ 順位 ----------

  await r.test('順位は段が高い順。**同じ段は同着**（指示書2-9）', async () => {
    const rows = L.rankPlayers([
      { id: 'a', name: 'あき', 段: 1 },
      { id: 'b', name: 'びび', 段: 3 },
      { id: 'c', name: 'ちか', 段: 1 },
      { id: 'd', name: 'でん', 段: 0 }
    ]);
    const m = {}; rows.forEach((x) => { m[x.id] = x.rank; });
    assertEqual(m.b, 1, '段3が1位');
    assertEqual(m.a, 2, '段1は2位');
    assertEqual(m.c, 2, '同じ段は同着');
    assertEqual(m.d, 4, '同着が2人いるので、次は4位');
  });

  await r.test('全員が同じ段で止まったら、全員が1位ならび（指示書2-9）', async () => {
    const rows = L.rankPlayers([
      { id: 'a', name: 'あき', 段: 2 },
      { id: 'b', name: 'びび', 段: 2 },
      { id: 'c', name: 'ちか', 段: 2 }
    ]);
    assertEqual(rows.map((x) => x.rank).join(','), '1,1,1', '3人とも1位');
  });

  r.finish();
})();
