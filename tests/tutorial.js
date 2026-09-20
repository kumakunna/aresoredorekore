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

const { createRunner, assert, assertEqual, launch, sleep } = require('./harness');
const TutorialKit = require('../public/js/tutorial');

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

  // ---- 57-1：台本の決まり（門W13：1手に1つの新要素） ----

  await r.test('57-1：台本が「1手に1つ」でなければ、動かす前に止まる', async () => {
    // **門W13を機械で見る窓口は、実装と同じ関数**（写さない・落とし穴1）。
    // 検査が別に書いた判定を持つと、実装が緩んだ日に検査だけ厳しいまま残る
    const 良い = [{ 的: '.a', 文: 'ひとつめ', 待つ: 'tap' }];
    assertEqual(TutorialKit.台本を調べる(良い).length, 0, '正しい台本が通らない');

    // 複数を同時に光らせる形は止める
    assert(TutorialKit.台本を調べる([{ 的: '.a, .b', 文: 'ふたつ', 待つ: 'tap' }]).length > 0,
      '的が複数でも通ってしまう');
    // 2行の説明は、手順の切り方が悪い（指示57 6節の禁止）
    const 二行 = ['1行め', '2行め'].join(String.fromCharCode(10));
    assert(TutorialKit.台本を調べる([{ 的: '.a', 文: 二行, 待つ: 'tap' }]).length > 0,
      '2行の文が通ってしまう');
    // auto なのに秒が無い＝永久に止まる
    assert(TutorialKit.台本を調べる([{ 的: '.a', 文: 'あ', 待つ: 'auto' }]).length > 0,
      '秒の無い auto が通ってしまう');
  });

  // ---- 57-2：門W9（的が画面に無い時、その手を飛ばして次へ進む） ----

  await r.test('57-2：的が画面に無い手は飛ばして、最後まで進む', async () => {
    const { win, doc } = await launch();
    try {
      const K = win.TutorialKit;
      assert(K, 'TutorialKit が読み込まれていない');
      // **どれも実在しない選択子**なので、3手とも飛ばして終わるはず。
      // ここは jsdom に大きさが無くても成り立つ（querySelector が null を返す）
      const 結果 = await K.start([
        { 的: '.tut-ないもの-1', 文: 'いち', 待つ: 'tap' },
        { 的: '.tut-ないもの-2', 文: 'に', 待つ: 'tap' },
        { 的: '.tut-ないもの-3', 文: 'さん', 待つ: 'tap' },
      ]);
      assertEqual(結果.理由, 'done', '詰まって終われない（' + 結果.理由 + '）');
      assertEqual(結果.飛ばした, 3, '飛ばした数が合わない');
      assertEqual(K.いま(), null, '終わったのに出たまま');
    } finally { win.close(); }
  });

  // ---- 57-3：置き場（落とし穴26・27） ----

  await r.test('57-3：幕は #uiLayerRoot の中にいる（#app の中ではない）', async () => {
    const { win, doc } = await launch();
    try {
      const K = win.TutorialKit;
      // jsdom には版組みが無いので、的の大きさだけこちらで与える。
      // **ゲームのデータは偽らない**——偽るのはブラウザが持っていない能力の分だけ
      const 的 = doc.createElement('div');
      的.className = 'tut-ためしの的';
      doc.getElementById('app').appendChild(的);
      的.getBoundingClientRect = () => ({ left: 20, top: 30, width: 60, height: 60, right: 80, bottom: 90 });

      K.start([{ 的: '.tut-ためしの的', 文: 'ここ', 待つ: 'tap' }]);
      await sleep(win, 60);

      const 幕 = doc.querySelector('.tut-veil');
      assert(幕, '幕が出ていない');
      // **出ている最中に数える**（落とし穴10-g：片付いたあとに数えない）
      assert(幕.closest('#uiLayerRoot'), '幕が #uiLayerRoot の外にいる');
      assert(!幕.closest('#app'), '幕が #app の中にいる（落とし穴26）');

      // **文は幕の子ではなく兄弟。**clip-path は子も切るので、
      // 入れ子にすると穴の中に出した文まで消える（着手前に実測）
      const 文 = doc.querySelector('.tut-say');
      assert(文, '文が出ていない');
      assert(!幕.contains(文), '文が幕の子になっている（clip-path に切られる）');
      assertEqual(文.parentElement, 幕.parentElement, '文と幕が兄弟でない');

      K.stop('gone');
    } finally { win.close(); }
  });

  await r.test('57-3：残りの手数が見えている（1 / 2 の形）', async () => {
    const { win, doc } = await launch();
    try {
      const K = win.TutorialKit;
      const 的 = doc.createElement('div');
      的.className = 'tut-ためしの的';
      doc.getElementById('app').appendChild(的);
      的.getBoundingClientRect = () => ({ left: 20, top: 30, width: 60, height: 60, right: 80, bottom: 90 });

      K.start([
        { 的: '.tut-ためしの的', 文: 'ひとつめ', 待つ: 'tap' },
        { 的: '.tut-ためしの的', 文: 'ふたつめ', 待つ: 'tap' },
      ]);
      await sleep(win, 60);
      assertEqual(doc.querySelector('.tut-count').textContent, '1 / 2', '進み具合が出ていない');
      assertEqual(doc.querySelector('.tut-word').textContent, 'ひとつめ', '文が出ていない');
      K.stop('gone');
    } finally { win.close(); }
  });

  r.finish();
}

run();
