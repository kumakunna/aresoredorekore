// tests/aresore.js — 「あれそれどれこれ」の基本動作
//
// お題の選択 → 人間/AIの説明 → 正解・不正解・パスの判定 → スコア反映 まで。
// 判定まわりは何度も仕様が変わっている場所なので、決まった挙動を固定しておく。

const H = require('./harness');
const { launch, activeScreen, sleep, waitFor, waitScreen, el, click,
  setupPlayers, chooseNext, createRunner, assert, assertEqual, assertNoErrors } = H;

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
    // 第32弾-C-2：音声判定のスイッチは、遊んでいる画面から⚙の中へ移した
    //（説明している最中に見るものではないため）
    click(doc, 'floatingGearBtn');
    await sleep(win, 80);
    doc.querySelector('#setRootMenu [data-setpage="game"]').click();
    await sleep(win, 60);
    doc.querySelector('#setGameMenu [data-setpage="gamecfg"]').click();
    await sleep(win, 60);
    const vsw = doc.querySelector('#setGameCfgBody [data-cfgtoggle="voiceDetect"]');
    assert(vsw, '⚙の中に「音声で判定」がある');
    vsw.click();
    click(doc, 'closeSettingsBtn');
    await sleep(win, 60);
    await waitFor(win, () => !!win.__rec, 3000, '音声認識が開始される');

    // 別名を持つお題が出るまで送る。
    // 同一マッチ内はお題が重複しない（pickUnused）ので、プールを一周すれば必ず当たる。
    // パスは演出待ちが入るため、待ち時間のない「正解者を選ばずに次へ」で素早く送る。
    const aliasOf = { 'パトロールカー': 'パトカー', 'スマートフォン': 'スマホ', '自動販売機': '自販機', '遊園地': 'テーマパーク' };
    let target = null;
    for (let i = 0; i < 250 && !target; i++) {
      const t = topicText(doc);
      if (aliasOf[t]) { target = t; break; }
      click(doc, 'btnCorrect');
      const skip = doc.getElementById('pickerSkipBtn');
      if (!skip) break;
      skip.click();
      await sleep(win, 5);
    }
    assert(target, '別名を持つお題に到達する（プールを一周しても見つからない）');

    // 略称を発話 → 正解ピッカーが開く
    win.__rec.onresult({ resultIndex: 0, results: { 0: { 0: { transcript: aliasOf[target] }, length: 1 }, length: 1 } });
    await waitFor(win, () => el(doc, 'correctPickerOverlay').classList.contains('show'), 3000,
      '略称「' + aliasOf[target] + '」で正解になる');
    assertEqual(topicText(doc), target, '表示は正式名称のまま');
    assertNoErrors(errors, '別名判定で未捕捉の例外');
    win.close();
  });

  // ===================================================================
  // 第32弾-C 第2部：あそびの流れ
  // 演出そのものを見るので、ここだけ本物の速さで動かす（launch({fx:true})）
  // ===================================================================

  await r.test('手渡し：人が説明するモードは、渡してから始まる', async () => {
    const { win, doc, errors } = await launch({ fx: true });
    await setupPlayers(win, doc, ['あき', 'びび']);
    await waitScreen(win, doc, 'scr-mode', 3000);
    click(doc, doc.querySelector('.mode-card[data-id="normal"]'));
    click(doc, 'modeNextBtn');
    for (let i = 0; i < 10; i++) {
      const cur = activeScreen(doc);
      if (cur === 'scr-ready' || cur === 'scr-mode-rules') break;
      const next = doc.querySelector('#' + cur + ' [data-wiz-next]');
      if (!next) break;
      next.click();
      await sleep(win, 25);
    }
    if (activeScreen(doc) === 'scr-mode-rules') { click(doc, 'rulesStartBtn'); await sleep(win, 50); }
    await waitScreen(win, doc, 'scr-ready', 3000);
    el(doc, 'holdBtn').dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true }));
    // カウントダウンのあと、いきなりお題ではなく手渡しに入る
    await waitFor(win, () => activeScreen(doc) === 'scr-topic-pass', 8000, '手渡しに入る');
    // この画面でやることは1つだけ（原則A）
    assertEqual(doc.querySelectorAll('#scr-topic-pass button').length, 1,
      '手渡し画面のボタンは1つだけ');
    assert(/わたして|説明します/.test(el(doc, 'topicPassSub').textContent),
      '誰に渡すのかが書いてある');
    click(doc, 'topicPassBtn');
    await waitScreen(win, doc, 'scr-play', 3000);
    assertNoErrors(errors, '手渡しで未捕捉の例外');
    win.close();
  });

  await r.test('手渡し：出題者がいないモードでは、余計なタップを増やさない', async () => {
    // AI読み上げは出題者がいない。渡す相手がいないのに画面を挟むと、
    // 意味のないタップが1回増えるだけになる
    const { win, doc, errors } = await launch({ fx: true });
    await startPlay(win, doc, 'ai');
    assertEqual(activeScreen(doc), 'scr-play', '手渡しを挟まずに始まる');
    assertNoErrors(errors, 'AI読み上げで未捕捉の例外');
    win.close();
  });

  await r.test('お題は、カードがめくれてから見える', async () => {
    const { win, doc, errors } = await launch({ fx: true });
    await startPlay(win, doc, 'normal');
    const card = doc.querySelector('#scr-play .topic-card');
    assert(card, 'お題カードがある');
    // めくり終わればお題が出ている
    await waitFor(win, () => topicText(doc) !== '-' && topicText(doc) !== '', 3000, 'お題が出る');
    await waitFor(win, () => card.className === 'topic-card', 2000, 'めくりの印が残らない');
    assertNoErrors(errors, 'お題のめくりで未捕捉の例外');
    win.close();
  });

  await r.test('残り10秒を切ると、タイマーが赤く脈打つ', async () => {
    // 音を切っている人にも終わりが近いと分かるように、画面の側でも出す。
    // 実際に30秒のラウンドを走らせて確かめる（時計まわりは作り物だと嘘になりやすい）
    const { win, doc, errors } = await launch();
    await setupPlayers(win, doc, ['あき', 'びび']);
    await waitScreen(win, doc, 'scr-mode', 3000);
    click(doc, doc.querySelector('.mode-card[data-id="normal"]'));
    click(doc, 'modeNextBtn');
    for (let i = 0; i < 10; i++) {
      const cur = activeScreen(doc);
      if (cur === 'scr-ready' || cur === 'scr-mode-rules') break;
      if (cur === 'scr-set-timer') {
        // タイマーは入れたまま、いちばん短い30秒にする
        doc.querySelector('#timerPresets [data-sec="30"]').click();
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
    const t = el(doc, 'playTimer');
    assert(!t.classList.contains('hurry'), '始まったばかりでは脈打たない');
    await waitFor(win, () => t.classList.contains('hurry'), 26000, '残り10秒で脈打ちはじめる');
    assert(/^00:0\d$|^00:10$/.test(t.textContent),
      '脈打ちはじめるのは10秒を切ってから（実際: ' + t.textContent + '）');
    assertNoErrors(errors, 'タイマーの脈で未捕捉の例外');
    win.close();
  });

  await r.test('正解：画面いっぱいで褒め、お題と入った点を出す（原則C）', async () => {
    const { win, doc, errors } = await launch({ fx: true });
    await startPlay(win, doc, 'normal');
    await waitFor(win, () => topicText(doc) !== '-', 3000, 'お題が出る');
    const topic = topicText(doc);
    click(doc, 'btnCorrect');
    await sleep(win, 60);
    doc.querySelector('#pickerGrid button[data-id]').click();
    await sleep(win, 80);
    const b = doc.querySelector('.fx-banner');
    assert(b, '画面いっぱいの演出が出る');
    assert(b.classList.contains('fx-banner-good'), '褒める色で出る');
    assert(b.textContent.indexOf(topic) >= 0, '当てたお題が大きく出る');
    assert(/＋1点/.test(b.textContent), '入った点が出る（実際: ' + b.textContent + '）');
    // 演出はタップで飛ばせる（2周目の人を毎回待たせない）
    doc.getElementById('app').dispatchEvent(new win.Event('pointerdown', { bubbles: true }));
    await waitFor(win, () => !doc.querySelector('.fx-banner'), 2000, '演出が飛ぶ');
    assertNoErrors(errors, '正解の演出で未捕捉の例外');
    win.close();
  });

  await r.test('不正解：画面いっぱいの演出は出さない（原則C）', async () => {
    // みんなで遊ぶ場で恥をかかせない。赤いフラッシュと短い文字だけ
    const { win, doc, errors } = await launch({ fx: true });
    await startPlay(win, doc, 'normal');
    await waitFor(win, () => topicText(doc) !== '-', 3000, 'お題が出る');
    click(doc, 'btnWrong');
    await sleep(win, 60);
    assert(!doc.querySelector('.fx-banner'), '画面いっぱいの演出は出ない');
    assert(doc.querySelector('.fx-flash-bad'), '控えめな赤いフラッシュだけ出る');
    assert(el(doc, 'foulToast').classList.contains('show'),
      '何が起きたかは文字でも伝わる（音を切っていても分かる）');
    assertNoErrors(errors, '不正解の演出で未捕捉の例外');
    win.close();
  });

  await r.test('結果：順位が1位から順に出て、最後は全員そろう', async () => {
    const { win, doc, errors } = await launch({ fx: true });
    await startPlay(win, doc, 'normal');
    await waitFor(win, () => topicText(doc) !== '-', 3000, 'お題が出る');
    click(doc, 'btnCorrect');
    await sleep(win, 60);
    doc.querySelector('#pickerGrid button[data-id]').click();
    doc.getElementById('app').dispatchEvent(new win.Event('pointerdown', { bubbles: true }));
    await sleep(win, 120);
    click(doc, 'endRoundBtn');
    await waitScreen(win, doc, 'scr-score', 8000);
    const rows = doc.querySelectorAll('#scoreList .player-row');
    assert(rows.length >= 2, '全員ぶんの行がある');
    // 飛ばしても、途中で止まって誰かが消えたままにならない
    doc.getElementById('app').dispatchEvent(new win.Event('pointerdown', { bubbles: true }));
    await waitFor(win, () => doc.querySelectorAll('#scoreList .fx-in').length === rows.length,
      3000, '全員ぶんが出そろう');
    assertNoErrors(errors, '結果の順位発表で未捕捉の例外');
    win.close();
  });

  await r.test('原則A：遊んでいる画面に、設定のスイッチを置かない', async () => {
    // 「ハードモード」「音声で判定」は説明している最中に見るものではない。
    // 画面に据え置くと、何に集中すればいいか分からなくなる
    const { win, doc, errors } = await launch();
    await startPlay(win, doc, 'normal');
    assertEqual(doc.querySelectorAll('#scr-play .switch').length, 0,
      '遊んでいる画面にスイッチが無い');
    // ⚙の中には、ちゃんとある（消したのではなく移した）
    click(doc, 'floatingGearBtn');
    await sleep(win, 80);
    doc.querySelector('#setRootMenu [data-setpage="game"]').click();
    await sleep(win, 60);
    doc.querySelector('#setGameMenu [data-setpage="gamecfg"]').click();
    await sleep(win, 60);
    const hard = doc.querySelector('#setGameCfgBody [data-cfgtoggle="hardMode"]');
    assert(hard, '⚙の中に「ハードモード」がある');
    assert(!hard.classList.contains('on'), 'はじめはオフ');
    hard.click();
    assert(hard.classList.contains('on'), '切り替えられる');
    click(doc, 'closeSettingsBtn');
    await sleep(win, 60);
    // 見た目だけでなく、本当に効いていること
    //（ハードモード＝不正解で自動的に次のお題へ進む）
    await waitFor(win, () => topicText(doc) !== '-', 3000, 'お題が出る');
    const before = topicText(doc);
    click(doc, 'btnWrong');
    await waitFor(win, () => topicText(doc) !== before, 3000,
      'ハードモードでは不正解で次のお題へ進む');
    assertNoErrors(errors, '⚙のスイッチで未捕捉の例外');
    win.close();
  });

  // ===================================================================
  // 第32弾-C 第7部：結果のあとの「つぎは？」（全カセット共通）
  // ===================================================================

  // 1ラウンド遊びきって、結果画面まで進む
  async function playToScore(win, doc, modeId) {
    await startPlay(win, doc, modeId || 'normal');
    await waitFor(win, () => topicText(doc) !== '-', 3000, 'お題が出る');
    click(doc, 'btnCorrect');
    await sleep(win, 60);
    doc.querySelector('#pickerGrid button[data-id]').click();
    await sleep(win, 120);
    click(doc, 'endRoundBtn');
    await waitScreen(win, doc, 'scr-score', 8000);
  }

  await r.test('つぎは？：結果を見る画面と、次を決める画面を分ける', async () => {
    const { win, doc, errors } = await launch();
    win.confirm = () => true;
    await playToScore(win, doc);
    // 結果の画面の出口は1つだけ（原則A）
    assertEqual(doc.querySelectorAll('#scr-score .score-actions button').length, 1,
      '結果の画面には出口が1つだけ');
    click(doc, 'toNextBtn');
    await waitScreen(win, doc, 'scr-next', 3000);
    const ids = Array.from(doc.querySelectorAll('#nextChoices [data-next]')).map(b => b.dataset.next);
    assertEqual(ids[0], 'again', '「もう一度」がいちばん上');
    assert(doc.querySelector('[data-next="again"]').classList.contains('main'),
      '「もう一度」がいちばん大きい');
    assert(ids.indexOf('shelf') >= 0, '別のカセットへ戻れる');
    assertNoErrors(errors, 'つぎは？画面で未捕捉の例外');
    win.close();
  });

  await r.test('つぎは？：もう一度は、設定を選び直さずに長押しの画面へ', async () => {
    // 「さっき楽しかったから、もう1回」に、いちばん少ない手順で応える。
    //
    // 第32弾-C（実機の指摘）：はじめカウントダウンへ直行させていたが、
    // 押した人以外はまだ心の準備ができていない。
    // 省きたいのは「設定の選び直し」であって、始まる合図ではない。
    const { win, doc, errors } = await launch();
    win.confirm = () => true;
    await playToScore(win, doc);
    await chooseNext(win, doc, 'again');
    await waitScreen(win, doc, 'scr-ready', 4000);
    // モード選択にもウィザードにも戻らない
    assert(doc.getElementById('holdBtn'), '長押しで始められる');
    // 押せば、そのまま始まる（設定の画面は1つも挟まらない）
    el(doc, 'holdBtn').dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true }));
    await waitFor(win, () => ['scr-countdown', 'scr-topic-pass', 'scr-play']
      .indexOf(activeScreen(doc)) >= 0, 4000, 'そのまま始まる');
    assertNoErrors(errors, 'もう一度で未捕捉の例外');
    win.close();
  });

  await r.test('つぎは？：ゲームが1つしかないカセットでは、その選択肢を出さない', async () => {
    // あれそれどれこれのカセットに入っているゲームは1つだけ。
    // 押しても何も起きない選択肢は置かない
    const { win, doc, errors } = await launch();
    win.confirm = () => true;
    await playToScore(win, doc);
    click(doc, 'toNextBtn');
    await waitScreen(win, doc, 'scr-next', 3000);
    assert(!doc.querySelector('[data-next="game"]'),
      'ゲームが1つなら「別のゲームへ」は出さない');
    assert(doc.querySelector('[data-next="mode"]'), 'モードは複数あるので出す');
    assertNoErrors(errors, '選択肢の出し分けで未捕捉の例外');
    win.close();
  });

  await r.test('つぎは？：別のカセットへ選ぶと、記録が残って棚に戻る', async () => {
    const { win, doc, errors } = await launch();
    win.confirm = () => true;
    await playToScore(win, doc);
    await chooseNext(win, doc, 'shelf');
    await waitScreen(win, doc, 'scr-shelf', 6000);
    // 記録画面に、いま遊んだ試合が入っている
    click(doc, 'floatingGearBtn');
    await sleep(win, 100);
    click(doc, 'openRecordsBtn');
    await waitFor(win, () => doc.querySelectorAll('#recordsList .record-item').length > 0,
      6000, '記録が残っている');
    assertNoErrors(errors, '記録して棚に戻る流れで未捕捉の例外');
    win.close();
  });

  await r.test('つぎは？：サバイバルは、決着するまで抜け道を出さない', async () => {
    // 途中でモードを変えられると、勝ち抜き戦が成立しない（第20弾の決まり）
    const { win, doc, errors } = await launch();
    win.confirm = () => true;
    await startPlay(win, doc, 'normal');
    // サバイバルのオプションは設定ウィザードにあるので、直接この状態を作れない。
    // ここでは「決まりが選択肢の表に書いてある」ことを確かめる
    const html = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'public', 'index.html'), 'utf8');
    assert(/nextSurvival === 'ongoing'/.test(html),
      'サバイバルの途中はモード変更を出さない決まりがある');
    assert(/nextSurvival !== 'champion'/.test(html),
      '決着したら「もう一度」を出さない決まりがある');
    assertNoErrors(errors, 'サバイバルの出し分けで未捕捉の例外');
    win.close();
  });

  r.finish();
})();
