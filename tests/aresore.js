// tests/aresore.js — 「あれそれどれこれ」の基本動作
//
// お題の選択 → 人間/AIの説明 → 正解・不正解・パスの判定 → スコア反映 まで。
// 判定まわりは何度も仕様が変わっている場所なので、決まった挙動を固定しておく。

const H = require('./harness');
const { launch, activeScreen, sleep, waitFor, waitScreen, el, click,
  setupPlayers, createRunner, assert, assertEqual, assertNoErrors } = H;

// 指定モードを、タイマーOFF（手動でラウンドを終えられる）で開始する
async function startPlay(win, doc, modeId, names) {
  await setupPlayers(win, doc, names || ['あき', 'びび']);
  await waitScreen(win, doc, 'scr-mode', 3000);
  click(doc, doc.querySelector('.mode-card[data-id="' + modeId + '"]'));
  click(doc, 'modeNextBtn');
  for (let i = 0; i < 10; i++) {
    const cur = activeScreen(doc);
    if (cur === 'scr-ready' || cur === 'scr-mode-rules') break;
    if (cur === 'scr-set-timer' && el(doc, 'timerEnableToggle').classList.contains('on')) {
      click(doc, 'timerEnableToggle');
      await sleep(win, 30);
    }
    const next = doc.querySelector('#' + cur + ' [data-wiz-next]');
    if (!next) break;
    next.click();
    await sleep(win, 25);
  }
  if (activeScreen(doc) === 'scr-mode-rules') { click(doc, 'rulesStartBtn'); await sleep(win, 50); }
  await waitScreen(win, doc, 'scr-ready', 3000);
  el(doc, 'holdBtn').dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true }));
  await waitScreen(win, doc, 'scr-play', 8000);
}

function topicText(doc) { return el(doc, 'topicName').textContent; }

(async function main() {
  const r = createRunner('aresore：あれそれどれこれの基本動作');

  await r.test('通常プレイ：お題が表示され、正解でスコアが入って次のお題へ進む', async () => {
    const { win, doc, errors } = await launch();
    await startPlay(win, doc, 'normal');
    const first = topicText(doc);
    assert(first && first !== '-', 'お題が表示されている');

    click(doc, 'btnCorrect');
    await sleep(win, 60);
    const buttons = doc.querySelectorAll('#pickerGrid button[data-id]');
    assertEqual(buttons.length, 2, '正解者を2人から選べる');
    buttons[0].click();
    await waitFor(win, () => topicText(doc) !== first, 3000, 'お題が次に進む');

    // スコアに反映されていること
    click(doc, 'endRoundBtn');
    await waitScreen(win, doc, 'scr-score', 8000);
    const scores = Array.from(doc.querySelectorAll('#scoreList .p-score')).map(e => parseInt(e.textContent, 10));
    assertEqual(scores.filter(s => s === 1).length, 1, '1人だけ1点入っている');
    assertNoErrors(errors, '通常プレイで未捕捉の例外');
    win.close();
  });

  await r.test('不正解：スコアは変わらず、お題も変わらない（カルタとして正しい挙動）', async () => {
    const { win, doc, errors } = await launch();
    await startPlay(win, doc, 'normal');
    const before = topicText(doc);
    click(doc, 'btnWrong');
    await sleep(win, 200);
    assertEqual(topicText(doc), before, '不正解ではお題を変えない');

    click(doc, 'endRoundBtn');
    await waitScreen(win, doc, 'scr-score', 8000);
    const scores = Array.from(doc.querySelectorAll('#scoreList .p-score')).map(e => parseInt(e.textContent, 10));
    assert(scores.every(s => s === 0), '不正解では誰にも点が入らない');
    assertNoErrors(errors, '不正解の処理で未捕捉の例外');
    win.close();
  });

  await r.test('パス：点は動かさずに必ず次のお題へ進む', async () => {
    const { win, doc, errors } = await launch();
    await startPlay(win, doc, 'normal');
    const before = topicText(doc);
    click(doc, 'btnPass');
    await waitFor(win, () => topicText(doc) !== before, 3000, 'パスで次のお題へ');

    click(doc, 'endRoundBtn');
    await waitScreen(win, doc, 'scr-score', 8000);
    const scores = Array.from(doc.querySelectorAll('#scoreList .p-score')).map(e => parseInt(e.textContent, 10));
    assert(scores.every(s => s === 0), 'パスでは点が動かない');
    assertNoErrors(errors, 'パスの処理で未捕捉の例外');
    win.close();
  });

  await r.test('封印ワード：禁止ワードが表示され、反則ボタンが使える', async () => {
    const { win, doc, errors } = await launch();
    await startPlay(win, doc, 'seal');
    const ng = el(doc, 'ngWordsBox');
    assert(ng.style.display !== 'none', '禁止ワードが表示されている');
    assert(ng.textContent.length > 0, '禁止ワードの中身がある');
    assert(el(doc, 'btnFoul').style.display !== 'none', '反則ボタンが出ている');
    assertNoErrors(errors, '封印ワードで未捕捉の例外');
    win.close();
  });

  await r.test('AI読み上げ：説明文が届き、お題名は画面に出ない', async () => {
    const { win, doc, errors } = await launch();
    await startPlay(win, doc, 'ai');
    await waitFor(win, () => el(doc, 'aiDescriptionBox').textContent.indexOf('テスト用の説明文') >= 0, 5000, 'AIの説明が届く');
    assert(topicText(doc).indexOf('聞いて') >= 0, 'お題名ではなく案内が出ている（実際: ' + topicText(doc) + '）');
    // AI出題では出題者向けの注意書きと反則ボタンを出さない
    assertEqual(el(doc, 'describerOnlyNote').style.display, 'none', 'AI出題では出題者向けの注意書きを出さない');
    assertEqual(el(doc, 'btnFoul').style.display, 'none', 'AI出題では反則ボタンを出さない');
    assertNoErrors(errors, 'AI読み上げで未捕捉の例外');
    win.close();
  });

  await r.test('一言ヒント：ヒントが1つ出て、「もう一言」で増える', async () => {
    const { win, doc, errors } = await launch();
    await startPlay(win, doc, 'oneword');
    await waitFor(win, () => /ヒント1/.test(el(doc, 'aiDescriptionBox').textContent), 5000, '最初のヒントが届く');
    click(doc, 'moreHintBtn');
    await waitFor(win, () => /ヒント2/.test(el(doc, 'aiDescriptionBox').textContent), 5000, '2つ目のヒントが増える');
    assertNoErrors(errors, '一言ヒントで未捕捉の例外');
    win.close();
  });

  await r.test('AIが失敗しても操作不能にならず、2回連続で失敗すると案内が出る', async () => {
    const { win, doc, errors } = await launch({ failAI: true });
    await startPlay(win, doc, 'ai');
    await waitFor(win, () => !!doc.getElementById('aiRetryBtn'), 5000, '「もう一度取得」が出る');

    // 1回目の失敗では案内を出さない（閾値は2）
    assert(!doc.querySelector('.ai-fallback-note'), '1回目の失敗では案内を出さない');
    // ロックが解除されて操作できること（ここが詰むと最悪）
    assert(!el(doc, 'btnPass').disabled, 'AI失敗後もパスが押せる');
    assert(!el(doc, 'btnCorrect').disabled, 'AI失敗後も正解が押せる');

    click(doc, 'aiRetryBtn');
    await waitFor(win, () => !!doc.querySelector('.ai-fallback-note'), 6000, '2回目の失敗で案内が出る');
    const note = doc.querySelector('.ai-fallback-note').textContent;
    assert(/人が説明/.test(note), 'あれそれどれこれでは「人が説明」への切り替えを案内する（実際: ' + note + '）');
    win.close();
  });

  await r.test('別名：略称でも正解になり、表示は正式名称のまま', async () => {
    const { win, doc, errors } = await launch();
    // 音声認識を偽装して、別名を発話したことにする
    await startPlay(win, doc, 'normal');
    win.SpeechRecognition = function () {
      this.lang = ''; this.continuous = false; this.interimResults = false; this.maxAlternatives = 1;
      this.start = () => { win.__rec = this; };
      this.stop = () => {};
      this.onresult = null; this.onerror = null; this.onend = null;
    };
    win.webkitSpeechRecognition = win.SpeechRecognition;
    click(doc, 'voiceToggle');
    await waitFor(win, () => !!win.__rec, 3000, '音声認識が開始される');

    // 別名を持つお題が出るまでパスで送る
    const aliasOf = { 'パトロールカー': 'パトカー', 'スマートフォン': 'スマホ', '自動販売機': '自販機', '遊園地': 'テーマパーク' };
    let target = null;
    for (let i = 0; i < 30 && !target; i++) {
      const t = topicText(doc);
      if (aliasOf[t]) { target = t; break; }
      const before = t;
      click(doc, 'btnPass');
      await waitFor(win, () => topicText(doc) !== before, 3000, 'パスで次へ');
    }
    assert(target, '別名を持つお題に到達する');

    // 略称を発話 → 正解ピッカーが開く
    win.__rec.onresult({ resultIndex: 0, results: { 0: { 0: { transcript: aliasOf[target] }, length: 1 }, length: 1 } });
    await waitFor(win, () => el(doc, 'correctPickerOverlay').classList.contains('show'), 3000,
      '略称「' + aliasOf[target] + '」で正解になる');
    assertEqual(topicText(doc), target, '表示は正式名称のまま');
    assertNoErrors(errors, '別名判定で未捕捉の例外');
    win.close();
  });

  r.finish();
})();
