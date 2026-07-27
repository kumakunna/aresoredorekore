// tests/smoke.js — 実装済み全モードのセットアップを一周させ、play画面まで到達できることを確認する
//
// 「別の変更で他のモードが壊れる」ことが何度かあったため、非表示中の独立ゲームも含めて全部通す。
// 過去の再発防止ケース：
//   - ワードウルフの設定画面でクラッシュ（未捕捉例外を見逃した）
//   - サバイバルの脱落フラグが他モードに残る
//   - タイマーを 00:00 に設定できてしまう

const H = require('./harness');
const { launch, activeScreen, sleep, waitScreen, el, click, setupPlayers, createRunner, assert, assertEqual, assertNoErrors } = H;

// 各モードの「開始後に到達すべき画面」。独立ゲームは専用画面へ進む
const MODES = [
  { id: 'normal', screen: 'scr-play' },
  { id: 'seal', screen: 'scr-play' },
  { id: 'outstrict', screen: 'scr-play' },
  { id: 'oneword', screen: 'scr-play' },
  { id: 'ai', screen: 'scr-play' },
  { id: 'survival', screen: 'scr-play' },
  { id: 'speed', screen: 'scr-play', hidden: true },
  { id: 'wordwolf', screen: 'scr-wolf-pass', hidden: true },
  { id: 'bomb', screen: 'scr-bomb-play', hidden: true },
  { id: 'quizking', screen: 'scr-quiz-turn', hidden: true },
  { id: 'buzzer', screen: 'scr-tourney-vs', hidden: true },
  { id: 'auction', screen: 'scr-auction-bid', hidden: true }
];

async function startMode(win, doc, id) {
  // 棚 → プレイヤー設定 → モード
  await setupPlayers(win, doc, ['あき', 'びび', 'ちか']);
  if (activeScreen(doc) !== 'scr-mode') {
    const back = doc.getElementById('backToShelfBtn');
    if (back) { back.click(); await sleep(win, 50); }
    const cart = doc.querySelector('.cart[data-cart="aresoredorekore"]');
    if (cart) { cart.click(); cart.click(); }
    await waitScreen(win, doc, 'scr-mode', 3000);
  }
  const card = doc.querySelector('.mode-card[data-id="' + id + '"]');
  assert(card, 'モードカード ' + id + ' が一覧に無い');
  click(doc, card);
  click(doc, 'modeAutoBtn'); // おまかせで設定を飛ばす
  for (let i = 0; i < 12; i++) {
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
}

// ウィザードを手で進め、タイマーだけ切ってから開始する（手動でラウンドを終えられるようにするため）
async function startModeWithTimerOff(win, doc, id) {
  await setupPlayers(win, doc, ['あき', 'びび', 'ちか']);
  await waitScreen(win, doc, 'scr-mode', 3000);
  click(doc, doc.querySelector('.mode-card[data-id="' + id + '"]'));
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
}

(async function main() {
  const r = createRunner('smoke：全モードのセットアップ');

  for (const m of MODES) {
    await r.test('モード ' + m.id + ' がセットアップを通って ' + m.screen + ' に到達する', async () => {
      const { win, doc, errors } = await launch({ showHiddenModes: true });
      await startMode(win, doc, m.id);
      await waitScreen(win, doc, m.screen, 6000);
      assertEqual(activeScreen(doc), m.screen, m.id + ' の到達画面');
      // 過去にワードウルフの設定画面クラッシュを見逃したので、必ず例外も確認する
      assertNoErrors(errors, m.id + ' で未捕捉の例外');
      win.close();
    });
  }

  // ---- 再発防止：サバイバルの脱落フラグが他モードに持ち越されないこと ----
  await r.test('再発防止：サバイバルで脱落しても、次のモードに脱落状態が残らない', async () => {
    const { win, doc, errors } = await launch({ showHiddenModes: true });
    win.confirm = () => true;
    // タイマーONだと3分待つことになるので、ウィザードでタイマーを切って手動終了できるようにする
    await startModeWithTimerOff(win, doc, 'survival');
    await waitScreen(win, doc, 'scr-play', 6000);

    // 1人だけ得点させてラウンドを終える → 得点しなかった人が脱落する
    click(doc, 'btnCorrect');
    await sleep(win, 60);
    const pick = doc.querySelector('#pickerGrid button[data-id]');
    assert(pick, '正解者ピッカーが開く');
    pick.click();
    await sleep(win, 80);
    click(doc, 'endRoundBtn'); // タイマーOFFのときに出る「🏁」
    await waitScreen(win, doc, 'scr-score', 8000);

    // 脱落が実際に起きたことを確認（ここが確認できないと、次の検証に意味がない）
    const eliminatedInSurvival = doc.querySelectorAll('#scoreList .player-row').length
      ? Array.from(doc.querySelectorAll('#scoreList .player-row')).filter(x => /💀/.test(x.textContent)).length
      : 0;
    assert(eliminatedInSurvival > 0, 'サバイバルで少なくとも1人が脱落している');

    // 通常プレイに切り替えて、1ラウンド遊んでスコア画面を見る
    click(doc, 'finishMatchBtn');
    await waitScreen(win, doc, 'scr-shelf', 4000);
    await startModeWithTimerOff(win, doc, 'normal');
    await waitScreen(win, doc, 'scr-play', 6000);
    click(doc, 'endRoundBtn');
    await waitScreen(win, doc, 'scr-score', 8000);

    // 通常プレイのスコアに脱落マークが残っていないこと（ここが再発ポイント）
    const rows = Array.from(doc.querySelectorAll('#scoreList .player-row'));
    assertEqual(rows.length, 3, 'スコアに全員が並ぶ');
    const stillEliminated = rows.filter(x => /💀/.test(x.textContent)).length;
    assertEqual(stillEliminated, 0, '通常プレイに脱落マークが残っていない');
    assertNoErrors(errors, 'モード切替で未捕捉の例外');
    win.close();
  });

  // ---- 再発防止：タイマーを 00:00 に設定できないこと ----
  await r.test('再発防止：タイマーの秒ホイールが 00:00 を作れない', async () => {
    const { win, doc, errors } = await launch({ showHiddenModes: true });
    await setupPlayers(win, doc);
    click(doc, doc.querySelector('.mode-card[data-id="normal"]'));
    click(doc, 'modeNextBtn');
    // タイマー設定画面まで進む
    for (let i = 0; i < 6; i++) {
      if (activeScreen(doc) === 'scr-set-timer') break;
      const next = doc.querySelector('#' + activeScreen(doc) + ' [data-wiz-next]');
      if (!next) break;
      next.click();
      await sleep(win, 25);
    }
    assertEqual(activeScreen(doc), 'scr-set-timer', 'タイマー設定画面に到達');
    if (!el(doc, 'timerEnableToggle').classList.contains('on')) click(doc, 'timerEnableToggle');
    await sleep(win, 50);
    // 分を 0 にすると、秒の選択肢から 00 が消える
    const wm = el(doc, 'wheelM');
    wm.scrollTop = 0;
    wm.dispatchEvent(new win.Event('scroll'));
    await sleep(win, 250);
    const secValues = Array.from(doc.querySelectorAll('#wheelS .wheel-item')).map(e => e.dataset.v);
    assert(secValues.length > 0, '秒の選択肢が存在する');
    assertEqual(secValues[0], '1', '分が00のとき、秒は01から始まる');
    assert(secValues.indexOf('0') === -1, '分が00のとき、秒に00が無い');
    assertNoErrors(errors, 'タイマー設定で未捕捉の例外');
    win.close();
  });

  // ---- 再発防止：早押しの正解ボタンを連打しても1点しか入らないこと ----
  await r.test('再発防止：早押しの正解ボタンを連打しても1点しか入らない', async () => {
    const { win, doc, errors } = await launch({ showHiddenModes: true });
    await startMode(win, doc, 'buzzer');
    await waitScreen(win, doc, 'scr-tourney-vs', 6000);
    click(doc, 'tourneyVsStartBtn');
    await waitScreen(win, doc, 'scr-tourney-match', 5000);
    assertEqual(el(doc, 'tourneyScoreLine').textContent, '0 - 0', '対戦開始時は0-0');

    // 同じボタンを素早く3回押す（連打）
    const a = el(doc, 'tourneyABtn');
    a.click(); a.click(); a.click();
    await sleep(win, 100);
    assertEqual(el(doc, 'tourneyScoreLine').textContent, '1 - 0', '連打しても1点しか入らない');
    assertNoErrors(errors, '早押しの連打で未捕捉の例外');
    win.close();
  });

  r.finish();
})();
