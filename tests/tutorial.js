// tests/tutorial.js — 指示57「初プレイのチュートリアル」
//
// ## なぜこのスイートを、実装より先に置いたか
//
// 着手前に掃いたら、**48-3 の「ここをタップ」を試す検査が1件も無かった**——
// `grep -rn "bombTapSeen|markBombTapSeen|acac-bomb-tap-seen|BOMB_TAP_KEY" tests/ tools/` は 0件。
// 実際に動かして見ているのは tests/fixes48.js:450 の `bombCellProbe` だけで、
// そこは cells を直接渡すので **`bombTapSeen()` の分岐は片側しか通っていない**（落とし穴10-c）。
//
// 指示57 はこの案内を**吸収する**（本人の裁定 2026-09-21）。
// 吸収する前に「いま何が守られているか」を1本固定しておかないと、
// **壊したことに気づけない**（落とし穴10：テストは、実際に赤くなることを確認してから直す）。
//
// だからこのスイートは2段で育つ：
//   1. 吸収する前 … 48-3 の「初回だけ出る／2回目は出ない」を固定する（下の 57-0）
//   2. 吸収した後 … 同じ約束を、チュートリアルの1手目で固定し直す
//
// **検体は本物の組み立てを通す**（落とし穴25）。`window.bombCellProbe` は
// 本物の `bombGridHtml` をそのまま呼ぶので、手で並べた偽の盤にはならない。

const { createRunner, assert, assertEqual, launch } = require('./harness');

const BOMB_TAP_KEY = 'acac-bomb-tap-seen';

/** 本物の盤を組み立てて、案内の札が何枚出たかを数える */
function 案内の数(win, cells) {
  const html = win.bombCellProbe(cells);
  return (html.match(/class="bw-tip"/g) || []).length;
}

/** まだ挑んでいないマスだけの盤（案内が出る条件がそろっている） */
function 手つかずの盤() {
  return [
    { uid: 'a1', tier: 'easy' }, { uid: 'a2', tier: 'easy' },
    { uid: 'a3', tier: 'normal' }, { uid: 'a4', tier: 'normal' },
  ];
}

async function run() {
  const r = createRunner('指示57：初プレイのチュートリアル');

  // ---- 57-0：48-3 の「ここをタップ」を、吸収する前に固定する ----

  await r.test('57-0：はじめての端末では、案内がちょうど1枚だけ出る', async () => {
    const { win } = await launch();
    try {
      const n = 案内の数(win, 手つかずの盤());
      // **具体の数字で書く**（落とし穴10-a：実装側の定数を借りると、
      // 定数を緩めた日に検査も一緒に緩む）。48-3 の約束は「先頭の1マスだけ」
      assertEqual(n, 1, '手つかずの盤に案内が' + n + '枚');
    } finally { win.close(); }
  });

  await r.test('57-0：一度押した端末では、案内が1枚も出ない', async () => {
    const { win } = await launch();
    try {
      // 先に「壊れたこと」ではなく「条件が作れたこと」を1つ測る（落とし穴10-b）。
      // 印を立てる前は出ている、を確かめてから印を立てる
      assertEqual(案内の数(win, 手つかずの盤()), 1, '印を立てる前は1枚のはず');

      win.localStorage.setItem(BOMB_TAP_KEY, '1');
      // 読み戻して、本当に保存されたかを1つ測る
      //（落とし穴10-f：壊したつもりで、壊せていない）
      assertEqual(win.localStorage.getItem(BOMB_TAP_KEY), '1', '印が保存されていない');

      const n = 案内の数(win, 手つかずの盤());
      assertEqual(n, 0, '印を立てた端末に案内が' + n + '枚');
    } finally { win.close(); }
  });

  await r.test('57-0：解除ずみ・挑戦中のマスには、案内を添えない', async () => {
    const { win } = await launch();
    try {
      // 分岐の**もう一方の入力**を1つ足す（落とし穴10-c）。
      // 実装は `!cell.solved && !cell.extraClass` で弾いているので、
      // 弾かれる側だけの盤を作って0枚になることを見る
      const n = 案内の数(win, [
        { uid: 'b1', tier: 'easy', solved: true },
        { uid: 'b2', tier: 'easy', extraClass: 'taken' },
      ]);
      assertEqual(n, 0, '押せないマスに案内が' + n + '枚');
    } finally { win.close(); }
  });

  r.finish();
}

run();
