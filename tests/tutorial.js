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

const { createRunner, assert, assertEqual, launch, sleep, autoDialog, cssRules,
        waitScreen, waitFor, openCassette, activeScreen } = require('./harness');
const fs = require('fs');
const path = require('path');
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

  await r.test('57-2：的が少し遅れて現れても、その手を飛ばさない（実機で出た）', async () => {
    const { win, doc } = await launch({ keepPlayGuide: true });
    try {
      const 出す = (cls) => {
        const d = doc.createElement('div');
        d.className = cls;
        doc.getElementById('app').appendChild(d);
        d.getBoundingClientRect = () => ({ left: 20, top: 30, width: 60, height: 60, right: 80, bottom: 90 });
        return d;
      };
      出す('tut-いまある');   // 1手目の的は最初からある

      const 返り = win.TutorialKit.start([
        { 的: '.tut-いまある', 文: 'ひとつめ', 待つ: 'auto', 秒: 0.1 },
        { 的: '.tut-あとで',   文: 'ふたつめ', 待つ: 'tap' },
      ]);
      // 1手目が終わるのを待ってから、**2手目の的を遅れて出す**。
      // これが部屋の往復（rt.act の返事で3択が届く）の形
      await sleep(win, 300);
      // 条件が本当に作れているかを1つ測る（型(b)）——
      // この時点で2手目の的が既にあると、検査が自明に通ってしまう
      assertEqual(doc.querySelectorAll('.tut-あとで').length, 0, '前提：まだ的が無い');
      assertEqual(win.TutorialKit.いま().手, 1, '前提：1手目のまま待っている');

      出す('tut-あとで');
      await sleep(win, 200);
      const 状態 = win.TutorialKit.いま();
      assert(状態, '待っているうちに終わってしまった');
      assertEqual(状態.手, 2, '遅れて現れた的を飛ばしてしまった');
      assertEqual(doc.querySelector('.tut-word').textContent, 'ふたつめ', '2手目の文が出ていない');

      win.TutorialKit.stop('gone');
      const 結果 = await 返り;
      assertEqual(結果.飛ばした, 0, '1つも飛ばしていないはず');
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

  await r.test('57-3：同じクラスが2画面にある時、出ている方を指す', async () => {
    const { win, doc } = await launch({ keepPlayGuide: true });
    try {
      // **画面は全部いつでもDOMにいる。**`.bomb-lives` は手渡し（#bombLives）と
      // 部屋（#rtBombLives）の2つとも当たるので、先頭を取ると
      // 遊んでいない側の画面を指す。出ている方（大きさを持つ方）を選ぶ
      const 作る = (id, 見えるか) => {
        const d = doc.createElement('div');
        d.className = 'tut-ふたつある'; d.id = id;
        doc.getElementById('app').appendChild(d);
        d.getBoundingClientRect = () => 見えるか
          ? ({ left: 20, top: 300, width: 60, height: 60, right: 80, bottom: 360 })
          : ({ left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 });
        return d;
      };
      const 隠れている = 作る('tut-かくれ', false);   // 先に置く＝querySelector はこちらを返す
      const 出ている = 作る('tut-でてる', true);
      // 前提：先頭は隠れている方（型(b)：条件が本当に作れているか）
      assertEqual(doc.querySelector('.tut-ふたつある').id, 'tut-かくれ', '前提：先頭が隠れている方');

      win.TutorialKit.start([{ 的: '.tut-ふたつある', 文: 'ここ', 待つ: 'tap' }]);
      await sleep(win, 120);
      assert(win.TutorialKit.いま(), '出ている方があるのに飛ばした');

      // 穴が「出ている方」の座標に開いているか（隠れている方なら 0,0 のはず）
      const 輪 = doc.querySelector('.tut-ring');
      assertEqual(輪.style.top, (300 - 8) + 'px', '隠れている方を指している（top=' + 輪.style.top + '）');
      win.TutorialKit.stop('gone');
    } finally { win.close(); }
  });

  // ---- 57-5：CSSでしか守れないもの（幕が指を受ける／光を切ると止まる） ----

  await r.test('57-5：幕は指を受け、光の点滅を切ると輪が止まる', async () => {
    // **jsdom では見え方を測れない**ので、CSSそのものを読む（hidden-attr と同じ形）。
    // 実際の当たり判定と静止は、実ブラウザで測って門の文書に残してある
    const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    // **コメントを先に落とす。**中の { } で規則の切り出しがずれると、
    // 選択子と中身の対応が狂って、あるはずの指定を見落とす（press-feedback と同じ）
    const CSS = HTML.slice(HTML.indexOf('<style>') + 7, HTML.indexOf('</style>'))
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const 規則 = (sel) => {
      const r2 = cssRules(CSS).find((x) => x.sel.trim() === sel);
      assert(r2, sel + ' の規則がある');   // 型(b)：読めていないまま緑にしない
      return r2.body;
    };
    // 置き場（#uiLayerRoot）は pointer-events:none なので、幕が自分で立て直す
    assert(/pointer-events\s*:\s*auto/.test(規則('.tut-veil')),
      '幕が指を受けない（暗幕を押しても何も起きなくなる）');
    // 光の点滅を切っている人には、**脈動なし・静止**（正本§6・2-2）
    assert(/animation\s*:\s*none/.test(規則(':root.no-flash .tut-ring')),
      '光の点滅を切っても、輪が脈動し続ける');
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

      // **本物の道を通す。**
      // 最初これを `TutorialKit.start` の直呼びで書いたら、
      // 「止められた時も『見た』にする」という変異が**素通りした**——
      // 印を立てているのは `tutRun` の中なので、直呼びではその行を一度も通らず、
      // 最後の主張が**自明に成立していた**（落とし穴10-b：条件が作れていない）。
      // 呼ぶ道（聞く → 動かす）から入って、初めて意味のある検査になる
      const 止める = autoDialog(win, doc, true);
      assertEqual(await win.tutProbe().聞く('bomb'), true, '前提：「見る」まで行けている');
      止める();
      const 返り = win.tutProbe().動かす('bomb');
      await sleep(win, 80);
      assert(win.TutorialKit.いま(), '前提：出ている');

      // 退室・通信断・決着はすべてこの形で止まる（2-8）
      win.TutorialKit.stop('gone');
      await 返り;
      assertEqual(doc.querySelector('.tut-root').hidden, true, '止めたのに幕が残っている');
      // **次にまた聞く**——途中で切れた人が、二度と見られないことにならないように
      assertEqual(win.tutProbe().初めて, true, '止められただけで「見た」になっている');

    } finally { win.close(); }
  });

  await r.test('57-4：本物の台本を最後まで通すと「見た」になる（門W4の対照）', async () => {
    const { win, doc } = await launch({ keepPlayGuide: true });
    try {
      // **上の検査だけだと、「いつも印を立てない」実装でも通ってしまう。**
      // 止めた時に立たないことと、最後まで見たら立つことは、対で見る
      //
      // jsdom は版組みを持たないので `clientWidth/clientHeight` が 0 になり、
      // 穴の大きさが NaN になる（最初これで輪を測れずに落ちた）。
      // **ブラウザが持っていない能力の分だけ**こちらで与える
      ['clientWidth', 'clientHeight'].forEach((k, i) => {
        Object.defineProperty(doc.documentElement, k, { value: i ? 800 : 375, configurable: true });
      });
      const 置く = (cls, top) => {
        const d = doc.createElement('div');
        d.className = cls;
        doc.getElementById('app').appendChild(d);
        d.getBoundingClientRect = () => ({ left: 20, top: top, width: 60, height: 60,
          right: 80, bottom: top + 60 });
        return d;
      };
      const マス = 置く('bomb-wire-btn', 60);   // 1手目の的
      置く('bomb-lives', 300);                  // 3手目の的
      // 4手目（.bomb-wire-btn.missed）は置かない＝猶予のあと飛ぶ（門W9も一緒に通る）

      const 止める = autoDialog(win, doc, true);
      assertEqual(await win.tutProbe().聞く('bomb'), true, '前提：「見る」まで行けている');
      止める();
      const 返り = win.tutProbe().動かす('bomb');

      await sleep(win, 100);
      assertEqual(win.TutorialKit.いま().手, 1, '1手目に着いていない');
      マス.click();                              // 「コードをえらぶ」
      // 2手目の的（3択）は、部屋では往復のあとに現れる。ここでも遅れて出す
      await sleep(win, 120);
      const 重なり = doc.createElement('div');
      重なり.className = 'overlay show';
      重なり.innerHTML = '<div class="picker-grid">' +
        '<button class="pk-btn">いち</button>' +
        '<button class="pk-btn">に</button>' +
        '<button class="pk-btn">さん</button></div>';
      doc.getElementById('app').appendChild(重なり);
      const 入れ物 = 重なり.querySelector('.picker-grid');
      const 札 = Array.from(重なり.querySelectorAll('.pk-btn'));
      入れ物.getBoundingClientRect =
        () => ({ left: 20, top: 400, width: 300, height: 180, right: 320, bottom: 580 });
      札.forEach((b, i) => {
        const t = 400 + i * 60;
        b.getBoundingClientRect = () => ({ left: 20, top: t, width: 300, height: 50, right: 320, bottom: t + 50 });
      });
      await sleep(win, 150);
      assertEqual(win.TutorialKit.いま().手, 2, '遅れて出た3択に着いていない');

      // **3枚とも明るく残っているか。**
      // 的を `.pk-btn` にすると先頭の1枚しか穴が開かず、
      // 「3つから、こたえをえらびます」と言いながら1枚だけ指すことになる——
      // 実機で通した時、その1枚を押して外した（答えを指し示す形になっていた）
      const 輪 = doc.querySelector('.tut-ring');
      const 上 = parseFloat(輪.style.top), 高さ = parseFloat(輪.style.height);
      札.forEach((b, i) => {
        const r = b.getBoundingClientRect();
        assert(上 <= r.top + 1 && 上 + 高さ >= r.bottom - 1,
          (i + 1) + '枚目が暗いまま（輪 ' + 上 + '〜' + (上 + 高さ) + ' / 札 ' + r.top + '〜' + r.bottom + '）');
      });

      札[2].click();   // **3枚目**を押しても進む（先頭だけの的なら、ここで止まる）

      const 結果 = await 返り;                   // 3手目(auto 2秒) → 4手目(無いので猶予) → done
      assert(結果, '動かせていない');
      assertEqual(win.tutProbe().初めて, false, '最後まで見たのに「見た」になっていない');
    } finally { win.close(); }
  });

  r.finish();
}

run();
