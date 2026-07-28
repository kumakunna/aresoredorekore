// tests/playthrough.js — 通しプレイとデバッグ（第20弾 第11部）
//
// 「1つの画面が動く」ではなく「プレイヤーが実際にやる操作を最後まで通す」ことを見る。
// 重点は指示20で名指しされた3つ:
//   ・進行中に設定を開いてプレイ人数を変更する（第1部-4の横展開）
//   ・極端な人数構成（最小・最大・役職を偏らせる）
//   ・今回追加した画面が、既存の画面遷移や他のモードを壊していないか

const H = require('./harness');
const { launch, activeScreen, sleep, waitScreen, el, click, fillPlayerForm, pickGame,
  holdPress, passNightfall, createRunner, assert, assertEqual, assertNoErrors } = H;

// 本番のカセット構成のまま到達できるモード（棚に出ているもの）
const ARESORE_MODES = ['normal', 'seal', 'outstrict', 'oneword', 'ai', 'survival'];
const WORDWOLF_MODES = ['wordwolf', 'wordwolf-multi', 'wordwolf-peek', 'wordwolf-trick', 'wordwolf-seer'];
const WOLFROLE_MODES = ['wolf-casual', 'wolf-normal', 'wolf-special', 'wolf-deep', 'wolf-chaos', 'wolf-yaminabe'];

const NAMES = ['あき', 'びび', 'ちか', 'でん', 'えみ', 'ふう', 'げん', 'はな', 'いと', 'うみ',
  'えだ', 'おか', 'かい', 'きし', 'くも', 'けや'];

function names(n) { return NAMES.slice(0, n); }

// 棚 → カセット → ゲーム →（初回のみプレイヤー設定）→ モード選択
async function toModeScreen(win, doc, cassette, gameId, players) {
  const cart = doc.querySelector('.cart[data-cart="' + cassette + '"]');
  assert(cart, cassette + ' のカセットが棚にある');
  cart.click();
  if (activeScreen(doc) === 'scr-shelf') cart.click();
  await sleep(win, 100);
  if (activeScreen(doc) === 'scr-game') {
    pickGame(doc, gameId);
    await sleep(win, 80);
  }
  if (activeScreen(doc) === 'scr-setup') await fillPlayerForm(win, doc, players);
  await waitScreen(win, doc, 'scr-mode', 4000);
}

// モードを選んでウィザードを抜け、開始する。タイマーは既定のまま（切らない）
async function startMode(win, doc, modeId, opts) {
  opts = opts || {};
  const card = doc.querySelector('.mode-card[data-id="' + modeId + '"]');
  assert(card, modeId + ' のカードがある');
  assert(!card.classList.contains('locked'), modeId + ' がこの人数で選べる');
  click(doc, card);
  click(doc, 'modeNextBtn');
  await sleep(win, 80);
  for (let i = 0; i < 10; i++) {
    const cur = activeScreen(doc);
    if (cur === 'scr-ready' || cur === 'scr-mode-rules') break;
    if (cur === 'scr-set-timer' && opts.noTimer &&
        el(doc, 'timerEnableToggle').classList.contains('on')) {
      click(doc, 'timerEnableToggle');
      await sleep(win, 30);
    }
    if (opts.onStep) opts.onStep(cur);
    const next = doc.querySelector('#' + cur + ' [data-wiz-next]');
    if (!next) break;
    next.click();
    await sleep(win, 40);
  }
  if (activeScreen(doc) === 'scr-mode-rules') { click(doc, 'rulesStartBtn'); await sleep(win, 80); }
  await waitScreen(win, doc, 'scr-ready', 4000);
  el(doc, 'holdBtn').dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true }));
}

// 確認ダイアログの返事を、文面ごとに決める。
// 一律 true/false にすると「終了しますか？」まで打ち消してしまい、
// テストが本体の不具合ではなく自分の設定で落ちる。
function answerDialogs(win) {
  win.alert = () => {};
  win.confirm = (msg) => {
    if (/プレイヤーを変更/.test(msg)) return false; // このメンバーのまま続ける
    return true;                                    // 終了・記録などは進める
  };
}

// 遊び終わって（あるいは途中で）棚に戻る
async function backToShelf(win, doc) {
  answerDialogs(win);
  click(doc, 'floatingGearBtn');
  await sleep(win, 100);
  click(doc, 'endGameBtn');
  await waitScreen(win, doc, 'scr-shelf', 8000);
}

// ワードウルフ／人狼の手渡しを、その段階のぶんだけ流す
async function drainWolfPass(win, doc, limit) {
  let g = 0;
  while (activeScreen(doc) === 'scr-wolf-pass' && g++ < (limit || 40)) {
    click(doc, 'wolfRevealBtn');
    await sleep(win, 25);
    const pick = doc.querySelector('#wolfRolePickGrid button[data-wwpick]');
    if (pick && el(doc, 'wolfRolePickGrid').style.display !== 'none') { pick.click(); }
    else {
      const v = doc.querySelector('#wolfVoteGrid button');
      if (v && el(doc, 'wolfVoteArea').style.display !== 'none') v.click();
      else click(doc, 'wolfNextRevealBtn');
    }
    await sleep(win, 35);
  }
}
async function drainWrPass(win, doc, limit) {
  if (passNightfall(doc)) await sleep(win, 60);
  let g = 0;
  while (activeScreen(doc) === 'scr-wr-pass' && g++ < (limit || 40)) {
    click(doc, 'wrRevealBtn');
    await sleep(win, 25);
    let s = 0;
    while (s++ < 4 && activeScreen(doc) === 'scr-wr-pass' && el(doc, 'wrContent').style.display !== 'none') {
      const c = doc.querySelectorAll('#wrChoiceGrid button[data-choice]');
      if (c.length) c[0].click(); else click(doc, 'wrNextBtn');
      await sleep(win, 35);
    }
  }
}

// 人狼を決着まで回す（どのプリセットでも同じ手順で終われること自体が確認点）
async function playWolfRoleToEnd(win, doc, guardLimit) {
  let g = 0;
  while (g++ < (guardLimit || 300)) {
    const cur = activeScreen(doc);
    if (cur === 'scr-nightfall') { passNightfall(doc); await sleep(win, 60); continue; }
    if (cur === 'scr-wr-pass') { await drainWrPass(win, doc); continue; }
    if (cur === 'scr-wr-day') { await holdPress(win, doc, 'wrToVoteBtn'); await sleep(win, 60); continue; }
    if (cur === 'scr-wr-gather') { click(doc, 'wrTallyBtn'); await sleep(win, 2600); continue; }
    if (cur === 'scr-wr-result') {
      const done = /スコアへ/.test(el(doc, 'wrResultNextBtn').textContent);
      click(doc, 'wrResultNextBtn');
      await sleep(win, 120);
      if (done) return true;
      continue;
    }
    if (cur === 'scr-score') return true;
    await sleep(win, 60);
  }
  return false;
}

// ワードウルフを決着まで回す
async function playWordwolfToEnd(win, doc, guardLimit) {
  let g = 0;
  while (g++ < (guardLimit || 300)) {
    const cur = activeScreen(doc);
    if (cur === 'scr-nightfall') { passNightfall(doc); await sleep(win, 60); continue; }
    if (cur === 'scr-wolf-pass') { await drainWolfPass(win, doc); continue; }
    if (cur === 'scr-play') { await holdPress(win, doc, 'wolfDiscussBtn'); await sleep(win, 1000); continue; }
    if (cur === 'scr-wolf-gather') { click(doc, 'wolfTallyBtn'); await sleep(win, 2600); continue; }
    if (cur === 'scr-wolf-result') {
      const t = el(doc, 'wolfResultNextBtn').textContent;
      click(doc, 'wolfResultNextBtn');
      await sleep(win, 150);
      if (activeScreen(doc) === 'scr-score') return true;
      continue;
    }
    if (cur === 'scr-score') return true;
    await sleep(win, 60);
  }
  return false;
}

(async function main() {
  const r = createRunner('playthrough：通しプレイとデバッグ');

  // ---------- A. 全モードを3周ずつ ----------
  await r.test('あれそれどれこれ：全モードを3周ずつ開始できる', async () => {
    for (const modeId of ARESORE_MODES) {
      for (let round = 1; round <= 3; round++) {
        const { win, doc, errors } = await launch();
        await toModeScreen(win, doc, 'aresoredorekore', 'aresoredorekore', names(3));
        await startMode(win, doc, modeId, { noTimer: true });
        await waitScreen(win, doc, 'scr-play', 9000);
        assertNoErrors(errors, modeId + ' の ' + round + '周目');
        win.close();
      }
    }
  });

  await r.test('ワードウルフ：全モードを3周ずつ、決着まで通す', async () => {
    for (const modeId of WORDWOLF_MODES) {
      for (let round = 1; round <= 3; round++) {
        const { win, doc, errors } = await launch();
        await toModeScreen(win, doc, 'jinro', 'wordwolf', names(7));
        await startMode(win, doc, modeId, { noTimer: true });
        const done = await playWordwolfToEnd(win, doc);
        assert(done, modeId + ' の ' + round + '周目が決着する（現在: ' + activeScreen(doc) + '）');
        assertNoErrors(errors, modeId + ' の ' + round + '周目');
        win.close();
      }
    }
  });

  await r.test('役職あり人狼：全プリセットを3周ずつ、決着まで通す', async () => {
    for (const modeId of WOLFROLE_MODES) {
      for (let round = 1; round <= 3; round++) {
        const { win, doc, errors } = await launch();
        await toModeScreen(win, doc, 'jinro', 'wolfrole', names(9));
        await startMode(win, doc, modeId, { noTimer: true });
        const done = await playWolfRoleToEnd(win, doc);
        assert(done, modeId + ' の ' + round + '周目が決着する（現在: ' + activeScreen(doc) + '）');
        assertNoErrors(errors, modeId + ' の ' + round + '周目');
        win.close();
      }
    }
  });

  // ---------- B. 進行中に設定を開いて人数を変える（第1部-4の横展開） ----------
  await r.test('進行中に設定を開いて閉じても、どのゲームでも壊れない', async () => {
    const cases = [
      { cassette: 'aresoredorekore', game: 'aresoredorekore', mode: 'normal', screen: 'scr-play', n: 3 },
      { cassette: 'jinro', game: 'wordwolf', mode: 'wordwolf', screen: 'scr-wolf-pass', n: 5 },
      { cassette: 'jinro', game: 'wolfrole', mode: 'wolf-casual', screen: 'scr-wr-pass', n: 5 }
    ];
    for (const c of cases) {
      const { win, doc, errors } = await launch();
      answerDialogs(win);
      await toModeScreen(win, doc, c.cassette, c.game, names(c.n));
      await startMode(win, doc, c.mode, {});
      await waitScreen(win, doc, c.screen, 9000);

      // 開いて閉じるだけ（人数は触らない）
      click(doc, 'floatingGearBtn');
      await sleep(win, 100);
      assert(el(doc, 'settingsOverlay').classList.contains('show'), c.mode + '：設定が開く');
      click(doc, 'closeSettingsBtn');
      await sleep(win, 100);
      assertEqual(activeScreen(doc), c.screen, c.mode + '：閉じても画面が変わらない');
      assertNoErrors(errors, c.mode + '：設定の開閉');
      win.close();
    }
  });

  await r.test('進行中の人数変更：人狼カセットは断り、あれそれどれこれは通す', async () => {
    // 人狼はお題や役職を配ったあとなので、名簿が変わると破綻する
    for (const c of [
      { cassette: 'jinro', game: 'wordwolf', mode: 'wordwolf', screen: 'scr-wolf-pass', blocked: true },
      { cassette: 'jinro', game: 'wolfrole', mode: 'wolf-casual', screen: 'scr-wr-pass', blocked: true },
      { cassette: 'aresoredorekore', game: 'aresoredorekore', mode: 'normal', screen: 'scr-play', blocked: false }
    ]) {
      const { win, doc, errors } = await launch();
      let alerted = '';
      win.confirm = () => true;
      win.alert = (m) => { alerted = m; };
      await toModeScreen(win, doc, c.cassette, c.game, names(5));
      await startMode(win, doc, c.mode, {});
      await waitScreen(win, doc, c.screen, 9000);
      const before = doc.querySelectorAll('#setNameRows input').length;

      click(doc, 'floatingGearBtn');
      await sleep(win, 100);
      click(doc, 'setPlayerPlusBtn');
      await sleep(win, 40);
      const rows = doc.querySelectorAll('#setNameRows input');
      rows[rows.length - 1].value = 'あとから';
      rows[rows.length - 1].dispatchEvent(new win.Event('input', { bubbles: true }));
      click(doc, 'applyPlayersBtn');
      await sleep(win, 120);

      if (c.blocked) {
        assert(/途中は/.test(alerted), c.mode + '：理由を出して断る');
      } else {
        assert(!/途中は/.test(alerted), c.mode + '：あれそれどれこれは今までどおり変えられる');
      }
      click(doc, 'closeSettingsBtn');
      await sleep(win, 100);
      assertEqual(activeScreen(doc), c.screen, c.mode + '：画面が壊れない');
      assertNoErrors(errors, c.mode + '：進行中の人数変更');
      win.close();
    }
  });

  // ---------- C. 極端な人数構成 ----------
  await r.test('最小人数：各プリセットが下限ちょうどで最後まで遊べる', async () => {
    const cases = [
      { game: 'wolfrole', mode: 'wolf-casual', n: 3 },
      { game: 'wolfrole', mode: 'wolf-normal', n: 5 },
      { game: 'wolfrole', mode: 'wolf-yaminabe', n: 5 },
      { game: 'wordwolf', mode: 'wordwolf', n: 3 },
      { game: 'wordwolf', mode: 'wordwolf-peek', n: 4 },
      { game: 'wordwolf', mode: 'wordwolf-trick', n: 6 }
    ];
    for (const c of cases) {
      const { win, doc, errors } = await launch();
      await toModeScreen(win, doc, 'jinro', c.game, names(c.n));
      await startMode(win, doc, c.mode, { noTimer: true });
      const done = c.game === 'wolfrole'
        ? await playWolfRoleToEnd(win, doc)
        : await playWordwolfToEnd(win, doc);
      assert(done, c.mode + '（' + c.n + '人）が決着する（現在: ' + activeScreen(doc) + '）');
      assertNoErrors(errors, c.mode + '（' + c.n + '人）');
      win.close();
    }
  });

  await r.test('大人数：16人でも人狼・ワードウルフが最後まで通る', async () => {
    for (const c of [
      { game: 'wolfrole', mode: 'wolf-special' },
      { game: 'wolfrole', mode: 'wolf-yaminabe' },
      { game: 'wordwolf', mode: 'wordwolf-trick' }
    ]) {
      const { win, doc, errors } = await launch();
      await toModeScreen(win, doc, 'jinro', c.game, names(16));
      await startMode(win, doc, c.mode, { noTimer: true });
      const done = c.game === 'wolfrole'
        ? await playWolfRoleToEnd(win, doc, 600)
        : await playWordwolfToEnd(win, doc, 600);
      assert(done, c.mode + '（16人）が決着する（現在: ' + activeScreen(doc) + '）');
      assertNoErrors(errors, c.mode + '（16人）');
      win.close();
    }
  });

  await r.test('役職を偏らせる：ウルフを最大まで増やしても決着する', async () => {
    const { win, doc, errors } = await launch();
    const players = names(8);
    await toModeScreen(win, doc, 'jinro', 'wordwolf', players);
    click(doc, doc.querySelector('.mode-card[data-id="wordwolf"]'));
    click(doc, 'modeNextBtn');
    await waitScreen(win, doc, 'scr-set-wolf', 4000);
    const sl = el(doc, 'wolfCountSlider');
    sl.value = sl.max;
    sl.dispatchEvent(new win.Event('input', { bubbles: true }));
    const wolves = parseInt(el(doc, 'wolfCountValue').textContent, 10);
    assert(wolves >= 2, 'ウルフを2人以上にできる（' + wolves + '人）');
    assert(wolves < players.length, 'ウルフだけにはならない');
    for (let i = 0; i < 8; i++) {
      const cur = activeScreen(doc);
      if (cur === 'scr-ready' || cur === 'scr-mode-rules') break;
      if (cur === 'scr-set-timer' && el(doc, 'timerEnableToggle').classList.contains('on')) {
        click(doc, 'timerEnableToggle'); await sleep(win, 30);
      }
      const next = doc.querySelector('#' + cur + ' [data-wiz-next]');
      if (!next) break;
      next.click(); await sleep(win, 40);
    }
    if (activeScreen(doc) === 'scr-mode-rules') { click(doc, 'rulesStartBtn'); await sleep(win, 80); }
    await waitScreen(win, doc, 'scr-ready', 4000);
    el(doc, 'holdBtn').dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true }));
    const done = await playWordwolfToEnd(win, doc, 600);
    assert(done, 'ウルフ最大でも決着する（現在: ' + activeScreen(doc) + '）');
    assertNoErrors(errors, 'ウルフ最大');
    win.close();
  });

  // ---------- D. 追加した画面が他をこわしていないか ----------
  await r.test('人狼で遊んだあと、あれそれどれこれが素の見た目で遊べる', async () => {
    const { win, doc, errors } = await launch();
    answerDialogs(win);
    await toModeScreen(win, doc, 'jinro', 'wolfrole', names(5));
    await startMode(win, doc, 'wolf-casual', { noTimer: true });
    await waitScreen(win, doc, 'scr-wr-pass', 9000);
    assert(el(doc, 'app').classList.contains('theme-wolf'), '人狼では夜テーマ');
    await backToShelf(win, doc);
    assert(!el(doc, 'app').classList.contains('theme-wolf'), '棚に戻れば素に戻る');

    await toModeScreen(win, doc, 'aresoredorekore', 'aresoredorekore', names(3));
    assert(!el(doc, 'app').classList.contains('theme-wolf'), 'あれそれどれこれに夜テーマが乗らない');
    await startMode(win, doc, 'normal', { noTimer: true });
    await waitScreen(win, doc, 'scr-play', 9000);
    assert(!el(doc, 'app').classList.contains('theme-wolf'), 'プレイ画面でも素のまま');
    assert(el(doc, 'wolfDiscussHold').style.display === 'none', '話し合いの長押しボタンは出ない');
    assert(el(doc, 'resultRow').style.display !== 'none', '正解ボタンが今までどおり出る');
    assertNoErrors(errors, '人狼のあとのあれそれどれこれ');
    win.close();
  });

  await r.test('同じ端末で人狼カセットを続けて2回遊んでも、前回が残らない', async () => {
    const { win, doc, errors } = await launch();
    answerDialogs(win);
    await toModeScreen(win, doc, 'jinro', 'wolfrole', names(7));
    await startMode(win, doc, 'wolf-normal', { noTimer: true });
    assert(await playWolfRoleToEnd(win, doc), '1回目が決着する');

    // スコア画面から、もう一度同じカセットへ
    click(doc, 'finishMatchBtn');
    await waitScreen(win, doc, 'scr-shelf', 6000);
    await toModeScreen(win, doc, 'jinro', 'wolfrole', names(7));
    await startMode(win, doc, 'wolf-normal', { noTimer: true });
    await waitScreen(win, doc, 'scr-wr-pass', 9000);
    // 前の試合の決着状態が残っていると、1ターン目でいきなり最終結果に飛ぶ
    assert(await playWolfRoleToEnd(win, doc), '2回目も最後まで遊べる');
    assertNoErrors(errors, '連続プレイ');
    win.close();
  });

  r.finish();
})();
