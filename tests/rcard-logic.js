// tests/rcard-logic.js — ロシアンカードのルール層（指示55-①）
//
// 見張るのは、この遊びが成り立つための約束：
//   ① 盤は9枚。爆弾の数は設定で変わるが、**上限と下限の両方**で止まる
//   ② 決勝（残り2人）は爆弾5つ。**2人で遊ぶ時は最初から決勝**
//   ③ 爆弾の位置は 1〜9 の重複なし。**個数がちょうど**そろう
//   ④ めくる：同じ場所は2度めくれない・盤の外は受け付けない
//   ⑤ 順位：最後の1人が1位、負けた順に下がる、**同じ回に負けた人は同着**
//
// 落とし穴10-a を避けるため、**守りたい約束は具体の数字で書く**
//（`既定.爆弾` のような実装側の定数を期待値に使わない。
//  定数を緩めた日に、検査も一緒に緩んで素通りする）。

const L = require('../public/js/rcard-logic');
const { createRunner, assert, assertEqual } = require('./harness');

/** 決まった順で引く乱数（同じ並びを何度でも作れる） */
function seeded(seed) {
  let s = seed || 1;
  return function () { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
}

(async function main() {
  const r = createRunner('rcard-logic：ロシアンカードのルール');

  // ---------- ① 盤と設定 ----------

  await r.test('盤は3×3の9枚（画面に入る大きさの根拠）', async () => {
    assertEqual(L.列, 3, '3列');
    assertEqual(L.枚数, 9, '9枚');
  });

  await r.test('設定は上限でも下限でも止まる（落とし穴8：片方向にしか効かないチェックを作らない）', async () => {
    // **具体の数字で書く。**実装の 幅 を借りると、幅を広げた日に検査も広がる
    assertEqual(L.normalizeConfig({ lives: 99 }).lives, 5, '体力の上限は5');
    assertEqual(L.normalizeConfig({ lives: 0 }).lives, 1, '体力の下限は1');
    assertEqual(L.normalizeConfig({ bombs: 99 }).bombs, 8, '爆弾の上限は8（9枚全部にはしない）');
    assertEqual(L.normalizeConfig({ bombs: 0 }).bombs, 1, '爆弾の下限は1');
    assertEqual(L.normalizeConfig({ turnSec: 999 }).turnSec, 60, '持ち時間の上限は60秒');
    assertEqual(L.normalizeConfig({ turnSec: 1 }).turnSec, 5, '持ち時間の下限は5秒');
    // 何も渡さなければ既定
    const 既定 = L.normalizeConfig();
    assertEqual([既定.lives, 既定.bombs, 既定.finalBombs, 既定.turnSec].join(','),
      '3,3,5,15', '既定は 体力3・爆弾3・決勝5・15秒');
  });

  await r.test('文字や壊れた値を渡しても、遊べる値になる', async () => {
    assertEqual(L.normalizeConfig({ lives: 'いっぱい' }).lives, 3, '読めない値は既定');
    assertEqual(L.normalizeConfig({ bombs: null }).bombs, 3, 'null も既定');
  });

  // ---------- ② 決勝の爆弾 ----------

  await r.test('残り2人なら爆弾5つ。3人以上なら3つ', async () => {
    assertEqual(L.bombsForMatch(2), 5, '残り2人は決勝');
    assertEqual(L.bombsForMatch(3), 3, '3人ならふだんの数');
    assertEqual(L.bombsForMatch(8), 3, '8人でもふだんの数');
  });

  await r.test('2人で遊ぶ時（手渡し・2人の部屋）も、最初から決勝の数', async () => {
    // **遊ぶ人から見て同じ場面。**ここを「生き残り戦の時だけ決勝」にすると、
    // 2人で遊ぶ人は5つの盤を一生見ない
    assertEqual(L.bombsForMatch(2), 5, '2人なら最初から5つ');
    // 設定で変えたら、そちらに従う（型(c)：分岐の両側）
    assertEqual(L.bombsForMatch(2, { finalBombs: 7 }), 7, '決勝の数は運営が変えられる');
    assertEqual(L.bombsForMatch(5, { bombs: 2 }), 2, 'ふだんの数も運営が変えられる');
  });

  // ---------- ③ 爆弾の置き方 ----------

  await r.test('爆弾の位置は 1〜9 の重複なしで、個数がちょうどそろう', async () => {
    const rnd = seeded(7);
    for (let n = 1; n <= 8; n++) {
      const b = L.makeBombs(rnd, n);
      assertEqual(b.length, n, n + '個の時、ちょうど' + n + '個');
      assertEqual(new Set(b).size, n, n + '個の時、重複が無い');
      assertEqual(b.every((x) => x >= 1 && x <= 9), true, n + '個の時、全部 1〜9 の中');
      assertEqual(b.join(','), b.slice().sort((x, y) => x - y).join(','), '小さい順に並んでいる');
    }
  });

  await r.test('9枚より多く頼まれても、9枚までしか置かない', async () => {
    const b = L.makeBombs(seeded(7), 99);
    assertEqual(b.length, 9, '9個で止まる');
    assertEqual(new Set(b).size, 9, '重複しない');
  });

  await r.test('同じ種なら同じ置き方になる（秘匿の差分検査の前提）', async () => {
    const 一 = L.makeBombs(seeded(42), 3);
    const 二 = L.makeBombs(seeded(42), 3);
    assertEqual(一.join(','), 二.join(','), '同じ種＝同じ置き方');
    // 型(b)：**種を変えれば本当に変わる**ことも見る（でないと「同じ」が自明になる）
    let 違った = false;
    for (let s = 43; s < 60 && !違った; s++) {
      if (L.makeBombs(seeded(s), 3).join(',') !== 一.join(',')) 違った = true;
    }
    assert(違った, '種を変えれば置き方も変わる');
  });

  // ---------- ④ めくる ----------

  await r.test('爆弾のある場所をめくれば当たり、無い場所は安全', async () => {
    const 盤 = { flipped: [] };
    assertEqual(L.flip(盤, 2, [2, 5, 8]).hit, true, '2は爆弾');
    assertEqual(L.flip(盤, 3, [2, 5, 8]).hit, false, '3は安全');
  });

  await r.test('同じ場所は2度めくれない', async () => {
    const 盤 = { flipped: [4] };
    const res = L.flip(盤, 4, [2]);
    assertEqual(res.ok, false, '受け付けない');
    assertEqual(res.error, 'already', '理由は「もうめくった」');
    assertEqual(res.hit, false, '当たり判定を返さない');
  });

  await r.test('盤の外は受け付けない（0・10・文字・null）', async () => {
    const 盤 = { flipped: [] };
    [0, 10, -1, 'あ', null, undefined].forEach((v) => {
      const res = L.flip(盤, v, [1]);
      assertEqual(res.ok, false, String(v) + ' は受け付けない');
      assertEqual(res.error, 'bad_cell', String(v) + ' の理由は bad_cell');
    });
    // 型(c)：**もう一方の入力**。境目の 1 と 9 は通ること
    assertEqual(L.flip(盤, 1, []).ok, true, '1 は通る');
    assertEqual(L.flip(盤, 9, []).ok, true, '9 は通る');
  });

  await r.test('まだめくっていない場所を数えられる（時間切れで1枚めくる時に使う）', async () => {
    assertEqual(L.remaining({ flipped: [] }).join(','), '1,2,3,4,5,6,7,8,9', '最初は9枚');
    assertEqual(L.remaining({ flipped: [1, 5, 9] }).join(','), '2,3,4,6,7,8', 'めくった分は出ない');
    assertEqual(L.remaining({ flipped: [1, 2, 3, 4, 5, 6, 7, 8, 9] }).length, 0, '全部めくれば0');
  });

  // ---------- ⑤ 順位 ----------

  await r.test('最後の1人が1位。負けた順に下がり、同じ回に負けた人は同着', async () => {
    const 出 = L.rankPlayers([
      { id: 'a', name: 'あき', 敗退回: null },
      { id: 'b', name: 'びび', 敗退回: 3 },
      { id: 'c', name: 'ちか', 敗退回: 2 },
      { id: 'd', name: 'でん', 敗退回: 1 },
      { id: 'e', name: 'えみ', 敗退回: 1 }
    ]);
    // **順位そのものを見る。**並び順は「同着の中では名前順」なので、
    // 期待値に並びを書くと、名前を変えた日に赤くなる（検査の都合で遊びを歪めない）
    const 位 = {}; 出.forEach((x) => { 位[x.id] = x.rank; });
    assertEqual([位.a, 位.b, 位.c, 位.d, 位.e].join(','), '1,2,3,4,4',
      '1位から順に、同じ回の2人が4位ならび');
    // 型(b)：**そもそも5人ぶん返っているか**を先に見る
    assertEqual(出.length, 5, '5人ぶん返っている');
  });

  await r.test('同着が3人以上でも、次の順位が飛ぶ（5位ならびが3人なら、その下は8位）', async () => {
    const 出 = L.rankPlayers([
      { id: 'a', name: 'あ', 敗退回: null },
      { id: 'b', name: 'い', 敗退回: 3 },
      { id: 'c', name: 'う', 敗退回: 2 },
      { id: 'd', name: 'え', 敗退回: 2 },
      { id: 'e', name: 'お', 敗退回: 2 },
      { id: 'f', name: 'か', 敗退回: 1 }
    ]);
    const 位 = {}; 出.forEach((x) => { 位[x.id] = x.rank; });
    assertEqual([位.a, 位.b, 位.c, 位.d, 位.e, 位.f].join(','), '1,2,3,3,3,6',
      '3人ならびの下は6位');
  });

  await r.test('勝ち残りが2人以上いても、同着1位になる（途中で数えた時）', async () => {
    // 生き残り戦の**途中**で順位表を出すと、まだ負けていない人が複数いる。
    // その時は全員が1位ならび——「並びを見せない」のではなく、事実どおり出す
    const 出 = L.rankPlayers([
      { id: 'a', name: 'あ', 敗退回: null },
      { id: 'b', name: 'い', 敗退回: null },
      { id: 'c', name: 'う', 敗退回: 1 }
    ]);
    const 位 = {}; 出.forEach((x) => { 位[x.id] = x.rank; });
    assertEqual([位.a, 位.b, 位.c].join(','), '1,1,3', '2人が1位ならび');
  });

  await r.test('同じ回に負けた人の並びは、名前順で毎回同じ（表示がちらつかない）', async () => {
    const 検体 = [
      { id: 'z', name: 'あき', 敗退回: 1 },
      { id: 'a', name: 'びび', 敗退回: 1 }
    ];
    const 一 = L.rankPlayers(検体).map((x) => x.id).join(',');
    const 二 = L.rankPlayers(検体.slice().reverse()).map((x) => x.id).join(',');
    assertEqual(一, 二, '入力の順を変えても並びが同じ');
    assertEqual(一, 'z,a', '名前順（あき→びび）');
  });

  await r.test('誰もいない・1人だけでも落ちない', async () => {
    assertEqual(L.rankPlayers([]).length, 0, '0人');
    assertEqual(L.rankPlayers(null).length, 0, 'null');
    assertEqual(L.rankPlayers([{ id: 'a', name: 'あ', 敗退回: null }])[0].rank, 1, '1人なら1位');
  });

  // ---------- 安全弁 ----------

  await r.test('同じ回に両方0になったら、直前に多く残していた方が勝ち', async () => {
    assertEqual(L.tieBreak(2, 1), 'a', 'a の方が残していた');
    assertEqual(L.tieBreak(1, 2), 'b', 'b の方が残していた');
    assertEqual(L.tieBreak(1, 1), null, '同じなら引き分け');
  });

  r.finish();
})();
