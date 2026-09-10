// tests/mode-screen.js — モード画面（指示44 の 44-1・44-6）
//
// **人数の正本が1か所であること**と、**長押しで説明が出ること**を見る。
//
// 44-1 の着手前、同じ「人数」という言葉で3つの違う数が動いていた：
//   ・棚のチップ … members を数える（大画面も切断中も入る）
//   ・モード画面 … state.players.length（登録した名簿だけ）
//   ・待合       … room.playerCount（サーバー。大画面を除く）
// 棚で「4人」にして人狼を選ぶと、モード画面は全モードが
// 「3人以上で遊べます（いま2人）」で押せなかった。
// **チップの値は生きていて、誰も読んでいなかった**——
// 壊れていたのは棚でもモード画面でもなく、その間の配線。

const fs = require('fs');
const path = require('path');
const { launch, activeScreen, sleep, waitScreen, el, click,
  createRunner, assert, assertEqual, assertNoErrors, openCassette } = require('./harness');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const SCRIPT = HTML.slice(HTML.lastIndexOf('<script>'));
// **コメントを外してから掃く。**
// 実装のコメントには、直した事故の説明として `!m.gone` のような
// 「もう使っていない書き方」がそのまま書いてある。
// 外さずに数えると、**直した説明そのものが違反として数えられる**
// （落とし穴30 の裏返し：自分の説明文が自分の目を塞ぐ）。
// `[^:]` は `https://` を行コメントと読まないための番人
const コード = SCRIPT
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/** 棚で人数を選ぶ（第41弾 2-3 のチップ） */
async function 人数をえらぶ(win, doc, n) {
  click(doc, 'shelfChip');
  await sleep(win, 200);
  const b = doc.querySelector('[data-heads="' + n + '"]');
  if (!b) throw new Error(n + '人が選べない');
  b.click();
  await sleep(win, 250);
}

/** 棚 →（遊び方の確認）→ ゲーム選択 → プレイヤー登録 まで、手渡しで進む */
async function 人狼の登録画面まで(win, doc) {
  await openCassette(win, doc, 'jinro');
  // 人狼は「1台か、みんなのスマホか」を聞かれる（第41弾 2-4・E）
  assertEqual(activeScreen(doc), 'scr-play-way', '遊び方の確認が出る');
  click(doc, doc.querySelector('#wayChoices [data-way="handoff"]'));
  await waitScreen(win, doc, 'scr-game', 3000);
  doc.querySelector('#gameCards .mode-card[data-game="wolfrole"]').click();
  await sleep(win, 50);
  Array.from(doc.querySelectorAll('#scr-game button'))
    .find((b) => /つぎへ/.test(b.textContent)).click();
  await waitScreen(win, doc, 'scr-setup', 3000);
}

/** 長押し（450ms で成立）。指は動かさない */
async function 長押し(win, card) {
  card.dispatchEvent(new win.PointerEvent('pointerdown',
    { bubbles: true, pointerType: 'touch', pointerId: 7, clientX: 100, clientY: 100 }));
  await sleep(win, 520);
}

(async function main() {
  const r = createRunner('mode-screen：モード画面（指示44）');

  await r.test('44-1：棚のチップが、登録画面の初期人数として入る', async () => {
    // ここが切れていた配線そのもの。着手前は playerDraftCount = 2 と手書きで、
    // 棚で4人と答えていても登録画面は必ず2人から始まっていた
    const { win, doc, errors } = await launch();
    await 人数をえらぶ(win, doc, 4);
    assertEqual(win.headsProbe().heads, 4, '棚は4人を持っている');
    await 人狼の登録画面まで(win, doc);

    // **具体の数字で書く。**実装の定数をそのまま使うと、緩めた日に検査も緩む（落とし穴10-a）
    assertEqual(el(doc, 'playerCountLabel').textContent, '4', '登録画面が4人で始まる');
    assertEqual(doc.querySelectorAll('#nameRows input.draft-name').length, 4, '名前の行も4つ');

    // 増減できる（44-1・44-7）。**チップは書き換えない**——
    // チップは「次に棚へ来た時の見当」、名簿は「そのゲーム中の人数」で、別のもの
    click(doc, 'playerPlusBtn');
    await sleep(win, 20);
    assertEqual(el(doc, 'playerCountLabel').textContent, '5', '＋で増える');
    click(doc, 'playerMinusBtn');
    click(doc, 'playerMinusBtn');
    await sleep(win, 20);
    assertEqual(el(doc, 'playerCountLabel').textContent, '3', '−で減る');
    assertEqual(win.headsProbe().見当, 4, '増減してもチップは書き換わらない（44-7の境界）');

    assertNoErrors(errors, '人数の受け渡しで未捕捉の例外');
    win.close();
  });

  await r.test('44-1：モード画面の「いま◯人」が、棚の人数と一致する', async () => {
    // **表示している約束は本当か**（門G12）：
    // 棚が「4人」と言っているなら、その先で実際に遊べる人数も4人でなければならない
    const { win, doc, errors } = await launch();
    await 人数をえらぶ(win, doc, 4);
    await 人狼の登録画面まで(win, doc);
    click(doc, 'setupNextBtn');
    await waitScreen(win, doc, 'scr-mode', 6000);

    const 理由 = Array.from(doc.querySelectorAll('#modeCards .mode-card'))
      .map((c) => c.dataset.locked).filter(Boolean);
    // **その状況が本当に起きているかを、先に1つ確かめる**（落とし穴10-b）。
    // 押せないモードが1つも無ければ「いま2人と出ない」は自明に成立してしまう
    assert(理由.length > 0, '人数が足りないモードが実際にある（実際:' + 理由.length + '件）');
    assertEqual(理由.filter((x) => /いま4人/.test(x)).length, 理由.length,
      'どの理由も「いま4人」（実際:' + 理由.join(' / ') + '）');
    assertEqual(理由.filter((x) => /いま2人/.test(x)).length, 0, '「いま2人」はもう出ない');

    // 3人から遊べるモードは、4人なら押せる
    const casual = doc.querySelector('#modeCards .mode-card[data-id="wolf-casual"]');
    assert(casual && !casual.classList.contains('locked'),
      '3人から遊べるモードは押せる（4人いるので）');

    assertNoErrors(errors, 'モード画面で未捕捉の例外');
    win.close();
  });

  await r.test('44-1：人数の正本は1か所。手書きの人数判定が残っていない（門G7）', async () => {
    // **同じことを2か所で数え始めた瞬間に赤くする。**
    // 着手前は3か所あり、しかも棚の分岐は !m.gone で絞っていた——
    // gone は publicSnapshot が配る項目に無く（すごろくのゲームデータだけが
    // 持つ言葉・落とし穴9）、フィルタは素通りしていた

    // ① 部屋のメンバーを手で数えている所が無い（サーバーの playerCount を使う）
    const 数える = [];
    const re = /rt\.state\.room\.members[\s\S]{0,80}?\.length/g;
    let m;
    while ((m = re.exec(コード))) 数える.push(m[0].replace(/\s+/g, ' ').slice(0, 70));
    assertEqual(数える.join('\n       '), '',
      '部屋のメンバーを手で数えている所は無い（room.playerCount を使う）');

    // ② 存在しない項目で絞っていない
    assertEqual((コード.match(/\.gone\b/g) || []).length, 0,
      'publicSnapshot が配らない gone で絞っている所は無い');

    // ③ 人数の判定は正本を通る。
    //    state.players.length は名簿そのものを扱う所（登録・得点）には残ってよいが、
    //    **「何人以上で遊べるか」の判定**には出てこない
    const 判定 = [], 読めない = [];
    [['canPlayMode', /function canPlayMode\(m\)\{?[\s\S]{0,200}?\n  \}/],
     ['modeLockReason', /function modeLockReason\(m\)[\s\S]{0,900}?\n  \}/],
     ['guardMinPlayers', /function guardMinPlayers\(\)[\s\S]{0,400}?\n  \}/]].forEach(([名, pat]) => {
      const g = pat.exec(コード);
      // **読めなかったものは、件数を数えて赤くする**（落とし穴10-e）。
      // 黙って飛ばすと、関数の名前が変わった日に「違反0件」で緑になる
      if (!g) { 読めない.push(名); return; }
      if (/state\.players\.length/.test(g[0])) 判定.push(名);
    });
    assertEqual(読めない.join('・'), '', '判定の関数を全部読めている');
    assertEqual(判定.join('・'), '', '人数の判定が state.players.length を直に読んでいない');

    // ④ 正本そのものが在る（③が「関数ごと消えた」で緑になるのを防ぐ）
    assert(/function currentPlayerCount\(\)/.test(コード), '人数の正本の関数がある');
    const 呼ぶ = (コード.match(/currentPlayerCount\(\)/g) || []).length;
    assert(呼ぶ >= 5, '正本を、棚・モード画面・理由表示などが読んでいる（実際:' + 呼ぶ + '箇所）');
  });

  await r.test('44-6：モードを長押しすると、説明が popup で出る', async () => {
    const { win, doc, errors } = await launch();
    await 人数をえらぶ(win, doc, 4);
    await 人狼の登録画面まで(win, doc);
    click(doc, 'setupNextBtn');
    await waitScreen(win, doc, 'scr-mode', 6000);

    // ---- 押せるモード ----
    const 押せる = doc.querySelector('#modeCards .mode-card[data-id="wolf-casual"]');
    assert(押せる && !押せる.classList.contains('locked'), '押せるモードがある');
    const 前 = doc.querySelector('#modeCards .mode-card.selected').dataset.id;
    await 長押し(win, 押せる);
    let pop = doc.querySelector('#uiLayerRoot .ui-popup-in');
    assert(pop, '長押しで説明が開く');
    assert(/人狼|村人|投票/.test(pop.textContent), 'ルールの中身が出ている');
    assertEqual(doc.querySelector('#modeCards .mode-card.selected').dataset.id, 前,
      '長押しでは、モードは選ばれない');
    win.UiKit.closeTop('test');
    await sleep(win, 60);

    // ---- 押せないモード（**ここが肝**）----
    // 「人数が足りなくて押せない」時ほど、それが何なのかを知りたい
    const 押せない = doc.querySelector('#modeCards .mode-card.locked');
    assert(押せない, '人数が足りないモードが実際にある');   // 型(b)
    await 長押し(win, 押せない);
    pop = doc.querySelector('#uiLayerRoot .ui-popup-in');
    assert(pop, '押せないモードでも長押しは効く');
    assert(/人以上で遊べます/.test(pop.textContent),
      'なぜ遊べないかが本文に出る（実際:' + pop.textContent.slice(0, 60) + '）');
    win.UiKit.closeTop('test');
    await sleep(win, 60);

    // ---- 指が動いたら開かない（送る操作と取り合わない）----
    const card = doc.querySelector('#modeCards .mode-card');
    card.dispatchEvent(new win.PointerEvent('pointerdown',
      { bubbles: true, pointerType: 'touch', pointerId: 9, clientX: 100, clientY: 100 }));
    card.dispatchEvent(new win.PointerEvent('pointermove',
      { bubbles: true, pointerType: 'touch', pointerId: 9, clientX: 100, clientY: 140 }));
    await sleep(win, 520);
    assert(!doc.querySelector('#uiLayerRoot .ui-popup-in'), '指が動いたら開かない');

    assertNoErrors(errors, '長押しで未捕捉の例外');
    win.close();
  });

  await r.test('44-6：長押しで文字がなぞられない（門G11）', async () => {
    // 長押しは、素のままだと文字の選択とコピーの吹き出しを呼ぶ。
    // **CSSにしか無い**ので、書いてあるかを見る（jsdom は選択を再現しない）
    const rule = HTML.slice(HTML.indexOf('\n  .mode-card{'), HTML.indexOf('\n  .mode-card.selected'));
    assert(rule, '.mode-card の指定を読めている');   // 型(b)
    assert(/user-select:none/.test(rule), '文字がなぞられない');
    assert(/-webkit-touch-callout:none/.test(rule), 'iOS の長押しメニューも出ない');
  });

  await r.test('44-6：ルールの中身は1か所から出る（画面と popup が同じものを読む）', async () => {
    // 2か所に書くと、片方だけ直す日が来る（落とし穴1）
    assert(/function modeRulesHtml\(m, 無い時\)/.test(コード), 'ルールの中身を作る関数が1つある');
    // 定義1 + モードのルール画面 + 長押しの popup + 部屋のルール + 設定の見返し + 検査の窓口
    const 呼ぶ = (コード.match(/modeRulesHtml\(/g) || []).length;
    assert(呼ぶ >= 5, 'ルールを出す画面が、みんなそれを読んでいる（実際:' + 呼ぶ + '箇所）');

    // **箇条書きを組み立てている所が1つだけ。**
    // 44-6 で popup を足す時に数えたら、同じ組み立てが**すでに3か所**あった
    //（部屋のルール画面・モードのルール画面・設定の見返し）。
    // popup を足せば4か所目になるので、足す前に寄せた。
    // カセットの説明にある「最初の3つだけ」の `<ul>` は別物なので数に入らない
    //（あれは全文ではなく、さわりを見せる要約）
    const 組み立て = コード.match(/rules-ol[\s\S]{0,40}?bullets[\s\S]{0,30}?\.map\(/g) || [];
    assertEqual(組み立て.length, 1,
      '箇条書きを組み立てている所は1か所だけ（実際:' + 組み立て.length + '箇所）');
  });

  r.finish();
})();
