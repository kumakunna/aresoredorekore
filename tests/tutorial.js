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

const { createRunner, assert, assertEqual, launch, sleep, autoDialog,
        waitScreen, waitFor, openCassette, activeScreen } = require('./harness');
const TutorialKit = require('../public/js/tutorial');

const OLD_KEY = 'acac-bomb-tap-seen';   // 48-3 の印（移行のためだけに読む）
const SEEN_KEY = 'acac-tut-seen';      // 指示57 の「もう見た」

/** 本物の盤を組み立てて、48-3 の札が残っていないかを見る */
function 盤のHTML(win) {
  return win.bombCellProbe([
    { uid: 'a1', tier: 'easy' }, { uid: 'a2', tier: 'easy' },
    { uid: 'a3', tier: 'normal' },
  ]);
}

async function run() {
  const r = createRunner('指示57：初プレイのチュートリアル');

  // ---- 57-0：48-3 の吸収（同じことを決める場所を2つにしない） ----

  await r.test('57-0：盤から「ここをタップ」が消えている（案内は1つの仕組みが決める）', async () => {
    const { win } = await launch({ keepPlayGuide: true });
    try {
      const html = 盤のHTML(win);
      // **本物の組み立てを通して数える**（落とし穴25）。
      // 先に「盤が本当に組み立てられたか」を1つ測る（型(b)：自明に通らないように）
      assert(/bomb-wire-btn/.test(html), '盤が組み立てられていない（この検査は何も見ていない）');
      assertEqual((html.match(/bw-tip/g) || []).length, 0, '48-3 の札が残っている');
      assert(html.indexOf('ここをタップ') === -1, '48-3 の文言が残っている');
    } finally { win.close(); }
  });

  await r.test('57-0：48-3 を見終えた端末は、チュートリアルでも「見た」扱いになる（移行）', async () => {
    const { win } = await launch({ keepPlayGuide: true });
    try {
      // **移行の約束**（本人の裁定 2026-09-21）：
      // 既に見た端末の人が、新しい仕組みで再び見ることはない
      assertEqual(win.tutProbe().初めて, true, '何も無い端末で「初めて」にならない');

      win.localStorage.setItem(OLD_KEY, '1');
      // 印が本当に保存されたかを1つ測る（落とし穴10-f）
      assertEqual(win.localStorage.getItem(OLD_KEY), '1', '旧キーが保存されていない');

      assertEqual(win.tutProbe().初めて, false, '48-3 の印が読み替えられていない');
    } finally { win.close(); }
  });

  await r.test('57-0：チュートリアルを見終えた端末では、二度と初めてにならない', async () => {
    const { win } = await launch({ keepPlayGuide: true });
    try {
      assertEqual(win.tutProbe().初めて, true, '前提：まだ見ていない');
      win.tutProbe().見たことにする('bomb');
      assertEqual(win.tutProbe().初めて, false, '「見た」が効いていない');
      // 端末に残っているか（立ち上げ直しても残る形か）を1つ測る
      assert(/"bomb"\s*:\s*true/.test(win.localStorage.getItem(SEEN_KEY) || ''),
        '端末に印が残っていない（' + win.localStorage.getItem(SEEN_KEY) + '）');
    } finally { win.close(); }
  });

  await r.test('57-0：設定を入れ直すと、また見られる（2回目以降の人のため）', async () => {
    const { win } = await launch({ keepPlayGuide: true });
    try {
      win.localStorage.setItem(OLD_KEY, '1');
      win.tutProbe().見たことにする('bomb');
      assertEqual(win.tutProbe().初めて, false, '前提：見た状態が作れている');

      win.tutProbe().忘れる();
      // **旧キーも一緒に捨てる。**残すと移行の読み替えが毎回それを拾い直して、
      // ONにしても二度と出ない（忘れる道を、移行が塞ぐ形になる）
      assertEqual(win.tutProbe().初めて, true, 'ONにしても、また見られない');
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

  // ---- 57-4：出すかどうかの門（W4・W5・W12） ----

  await r.test('57-4：「いらない」を選ぶと出ない。二度と聞かれない（門W5）', async () => {
    const { win, doc } = await launch({ keepPlayGuide: true });
    try {
      assertEqual(win.tutProbe().初めて, true, '前提：初めての人になっている');
      const 止める = autoDialog(win, doc, false);   // ✕ ではなく「いらない」を押す
      const 出す = await win.tutProbe().聞く('bomb');
      止める();
      assertEqual(出す, false, '断ったのに出そうとしている');
      assertEqual(win.tutProbe().聞いた結果('bomb'), false, '断ったのに札が立っている');
      // **断ったら、もう聞かない**（毎回聞かれるのが一番うるさい）
      assertEqual(win.tutProbe().初めて, false, '次にまた聞かれてしまう');
    } finally { win.close(); }
  });

  await r.test('57-4：「見る」を選ぶと札が立ち、盤が出た時に動く（門W4）', async () => {
    const { win, doc } = await launch({ keepPlayGuide: true });
    try {
      const 止める = autoDialog(win, doc, true);
      const 出す = await win.tutProbe().聞く('bomb');
      止める();
      assertEqual(出す, true, '「見る」なのに出さない');
      assertEqual(win.tutProbe().聞いた結果('bomb'), true, '札が立っていない');
      // **まだ「見た」ことにはしない。**見る前に印を立てると、
      // 盤に着く前に切れた人が二度と見られない（2-8）
      assertEqual(win.tutProbe().初めて, true, '見る前に「見た」ことにしている');
    } finally { win.close(); }
  });

  await r.test('57-4：設定を切っている人には、聞きもしない（門W5）', async () => {
    const { win, doc } = await launch({ keepPlayGuide: true });
    try {
      // 本物の窓口を押して切る（設定の値を直接いじらない・落とし穴25）
      doc.getElementById('setGuideToggle').click();
      await sleep(win, 60);
      assertEqual(win.prefsProbe().playGuide, false, '前提：設定が切れていない');
      let 聞かれた = 0;
      const 止める = autoDialog(win, doc, () => { 聞かれた++; return true; });
      const 出す = await win.tutProbe().聞く('bomb');
      止める();
      assertEqual(出す, false, '切っているのに出そうとしている');
      assertEqual(聞かれた, 0, '切っているのに聞いている');
    } finally { win.close(); }
  });

  /**
   * 門W12。**役を手で差し替えない**——`rt` は窓に出ていないし、
   * 出させるのも違う。**本物の入室を通して、本物の `rt.me()` に役を持たせる**
   *（落とし穴25。fixes48 の 48-6 と同じ形）
   */
  async function 大画面で入室(win, doc) {
    await waitScreen(win, doc, 'scr-shelf', 9000);
    await openCassette(win, doc, 'bakudan');
    const way = doc.querySelector('#wayChoices [data-way="room"]');
    if (way) way.click();
    await waitScreen(win, doc, 'scr-rt-lobby', 5000);
    const fake = win.__rtFake;
    await waitFor(win, () => fake.connected, 5000, '疑似socket');
    const 名簿 = [{ id: 'tv', name: 'テレビ', role: 'bigscreen', connected: true, isHost: true, ready: true }];
    const snap = { code: 'ABC234', ownerUserId: 1, ownerUsername: 'kuma', hostMemberId: 'tv',
      playerCount: 0, memberCount: 1,
      ready: { count: 1, total: 1, waitingNames: [], all: true },
      members: 名簿, state: { phase: 'lobby', game: null, data: {} } };
    fake.replies = { 'room:join': () => ({ ok: true, code: 'ABC234', memberId: 'tv', room: snap }) };
    doc.getElementById('rtJoinCode').value = 'ABC234';
    doc.getElementById('rtJoinName').value = 'テレビ';
    doc.getElementById('rtJoinBtn').click();
    // 画面idを直接書くと、第42弾の「検査が名指しする画面idは実在するか」に
    // 幽霊として拾われる。その場で組み立てる（落とし穴10-a）
    const 前置き = 'scr-' + 'rt-';
    await waitFor(win, () => String(activeScreen(doc)).indexOf(前置き) === 0, 8000, '部屋の画面に入る');
  }

  await r.test('57-4：大画面には、そもそも組み立てない（門W12）', async () => {
    const { win, doc } = await launch({ keepPlayGuide: true, fakeSocket: true });
    try {
      await 大画面で入室(win, doc);
      // 前提：本当に大画面の役になっているか（型(b)：条件が作れたことを1つ測る）
      assertEqual(win.tutProbe().大画面, true, '大画面の役になっていない');
      let 聞かれた = 0;
      const 止める = autoDialog(win, doc, () => { 聞かれた++; return true; });
      const 出す = await win.tutProbe().聞く('bomb');
      止める();
      assertEqual(出す, false, '大画面で出そうとしている');
      assertEqual(聞かれた, 0, '大画面で聞いている');
      // **元栓で守る**ので、画面には1つも生えない（big-screen.js と同じ流儀）
      assertEqual(doc.querySelectorAll('.tut-veil, .tut-say, .tut-ring').length, 0,
        '大画面に部品が出ている');
    } finally { win.close(); }
  });

  await r.test('57-4：止められた時は「見た」ことにしない（門W10）', async () => {
    const { win, doc } = await launch({ keepPlayGuide: true });
    try {
      const 的 = doc.createElement('div');
      的.className = 'tut-ためしの的';
      doc.getElementById('app').appendChild(的);
      的.getBoundingClientRect = () => ({ left: 20, top: 30, width: 60, height: 60, right: 80, bottom: 90 });

      const 返り = win.TutorialKit.start([{ 的: '.tut-ためしの的', 文: 'ここ', 待つ: 'tap' }]);
      await sleep(win, 60);
      assert(win.TutorialKit.いま(), '前提：出ている');

      // 退室・通信断・決着はすべてこの形で止まる（2-8）
      win.TutorialKit.stop('gone');
      const 結果 = await 返り;
      assertEqual(結果.理由, 'gone', '理由が違う');
      assertEqual(doc.querySelector('.tut-root').hidden, true, '止めたのに幕が残っている');
      // **次にまた聞く**——途中で切れた人が、二度と見られないことにならないように
      assertEqual(win.tutProbe().初めて, true, '止められただけで「見た」になっている');
    } finally { win.close(); }
  });

  r.finish();
}

run();
