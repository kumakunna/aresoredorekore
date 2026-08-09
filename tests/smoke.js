// tests/smoke.js — 実装済み全モードのセットアップを一周させ、play画面まで到達できることを確認する
//
// 「別の変更で他のモードが壊れる」ことが何度かあったため、非表示中の独立ゲームも含めて全部通す。
// 過去の再発防止ケース：
//   - ワードウルフの設定画面でクラッシュ（未捕捉例外を見逃した）
//   - サバイバルの脱落フラグが他モードに残る
//   - タイマーを 00:00 に設定できてしまう

const H = require('./harness');
const { launch, activeScreen, sleep, waitFor, waitScreen, el, click, fillPlayerForm, setupPlayers, pickGame, holdPress, passNightfall, createRunner, assert, assertEqual, assertNoErrors, chooseNext } = H;

// 各モードの「所属ゲーム」と「開始後に到達すべき画面」。独立ゲームは専用画面へ進む
const MODES = [
  { id: 'normal', game: 'aresoredorekore', screen: 'scr-play' },
  { id: 'seal', game: 'aresoredorekore', screen: 'scr-play' },
  { id: 'outstrict', game: 'aresoredorekore', screen: 'scr-play' },
  { id: 'oneword', game: 'aresoredorekore', screen: 'scr-play' },
  { id: 'ai', game: 'aresoredorekore', screen: 'scr-play' },
  { id: 'survival', game: 'aresoredorekore', screen: 'scr-play' },
  { id: 'speed', game: 'aresoredorekore', screen: 'scr-play' },
  { id: 'wordwolf', game: 'wordwolf', screen: 'scr-wolf-pass' },
  { id: 'bomb-coop', game: 'bomb', screen: 'scr-bomb-play' },
  { id: 'quizking', game: 'quizking', screen: 'scr-quiz-turn' },
  { id: 'buzzer', game: 'buzzer', screen: 'scr-tourney-vs' },
  { id: 'auction', game: 'auction', screen: 'scr-auction-bid' }
];

// 全ゲームを1本に詰めたテスト用カセット。
// 本番のカセット構成は変えずに、3階層（カセット→ゲーム→モード）を通って全モードに到達する。
const ALL_GAMES_CASSETTE = {
  id: 'testall', genre: 'word', ready: true, icon: '🧪', title: 'テスト用',
  games: MODES.map(m => m.game).filter((g, i, a) => a.indexOf(g) === i),
  meta: 'テスト用'
};
const LAUNCH = { showHiddenModes: true, testCassettes: [ALL_GAMES_CASSETTE] };
const PLAYERS = ['あき', 'びび', 'ちか'];

// 棚 → テスト用カセット → ゲーム選択 →（必要ならプレイヤー設定）→ モード選択
async function gotoModeScreen(win, doc, gameId) {
  if (activeScreen(doc) !== 'scr-shelf') {
    const back = doc.getElementById('backToShelfBtn');
    if (back && activeScreen(doc) === 'scr-mode') back.click();
    await sleep(win, 60);
  }
  if (activeScreen(doc) === 'scr-game') {
    // すでにゲーム選択にいる場合はそのまま選ぶ
  } else {
    await waitScreen(win, doc, 'scr-shelf', 3000);
    const cart = doc.querySelector('.cart[data-cart="testall"]');
    assert(cart, 'テスト用カセットが棚にある');
    cart.click();
    if (activeScreen(doc) === 'scr-shelf') cart.click(); // 中央でなければ2回目で選択
    await waitScreen(win, doc, 'scr-game', 3000);
  }
  pickGame(doc, gameId);
  await sleep(win, 60);
  await fillPlayerForm(win, doc, PLAYERS); // 初回だけプレイヤー設定を通る
  await waitScreen(win, doc, 'scr-mode', 4000);
}

async function startMode(win, doc, id) {
  const info = MODES.find(m => m.id === id) || { game: 'aresoredorekore' };
  await gotoModeScreen(win, doc, info.game);
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
  const info = MODES.find(m => m.id === id) || { game: 'aresoredorekore' };
  await gotoModeScreen(win, doc, info.game);
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
      const { win, doc, errors } = await launch(LAUNCH);
      await startMode(win, doc, m.id);
      await waitScreen(win, doc, m.screen, 6000);
      assertEqual(activeScreen(doc), m.screen, m.id + ' の到達画面');
      // 過去にワードウルフの設定画面クラッシュを見逃したので、必ず例外も確認する
      assertNoErrors(errors, m.id + ' で未捕捉の例外');
      win.close();
    });
  }

  // ---- 第16弾：人狼ゲームカセットを本番データのまま通しでプレイする ----
  await r.test('人狼ゲームカセット：お題配布→話し合い→投票→結果まで通る', async () => {
    // テスト用の細工なしで、棚に出ている本番のカセットをそのまま遊ぶ
    const { win, doc, errors } = await launch();
    const cart = doc.querySelector('.cart[data-cart="jinro"]');
    assert(cart, '人狼ゲームのカセットが棚にある');
    cart.click();
    if (activeScreen(doc) === 'scr-shelf') cart.click();
    // ゲームが2つ（ワードウルフ／人狼）になったので、ゲーム選択を経由する
    await waitScreen(win, doc, 'scr-game', 3000);
    pickGame(doc, 'wordwolf');
    await sleep(win, 60);
    await fillPlayerForm(win, doc, PLAYERS);
    await waitScreen(win, doc, 'scr-mode', 3000);
    const ids = Array.from(doc.querySelectorAll('#modeCards .mode-card')).map(c => c.dataset.id);
    assert(ids.indexOf('wordwolf') >= 0, 'モード選択にワードウルフがある');
    assert(ids.indexOf('wordwolf-multi') >= 0, '2〜ターン版も並ぶ');
    assert(ids.every(id => /^wordwolf/.test(id)), 'ワードウルフのモードだけが並ぶ（' + ids.join(',') + '）');

    click(doc, doc.querySelector('.mode-card[data-id="wordwolf"]'));
    click(doc, 'modeAutoBtn');
    await sleep(win, 80);
    if (activeScreen(doc) === 'scr-mode-rules') { click(doc, 'rulesStartBtn'); await sleep(win, 60); }
    await waitScreen(win, doc, 'scr-ready', 3000);
    el(doc, 'holdBtn').dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true }));

    // お題配布：1人ずつスマホを渡して自分のお題を見る
    await waitScreen(win, doc, 'scr-wolf-pass', 8000);
    for (let i = 0; i < PLAYERS.length; i++) {
      click(doc, 'wolfRevealBtn');
      await sleep(win, 40);
      const next = doc.querySelector('#wolfContentScreen .btn');
      assert(next, (i + 1) + '人目のお題確認に進むボタンがある');
      next.click();
      await sleep(win, 60);
    }
    // 話し合い（既存のプレイ画面を流用）→ 手動で終了して投票へ
    await waitScreen(win, doc, 'scr-play', 5000);
    click(doc, 'endRoundBtn');
    await waitScreen(win, doc, 'scr-wolf-pass', 6000);

    // 投票：1人ずつ誰かに投票する
    for (let i = 0; i < PLAYERS.length; i++) {
      click(doc, 'wolfRevealBtn');
      await sleep(win, 40);
      const target = doc.querySelector('#wolfVoteGrid button');
      assert(target, (i + 1) + '人目の投票先が出る');
      target.click();
      await sleep(win, 60);
    }
    // 集計 → 結果
    await waitScreen(win, doc, 'scr-wolf-gather', 5000);
    click(doc, 'wolfTallyBtn');
    await waitScreen(win, doc, 'scr-wolf-result', 8000);
    assert(el(doc, 'wolfResultNextBtn'), '結果画面に「つぎへ」がある');
    assertNoErrors(errors, 'ワードウルフの通しプレイで未捕捉の例外');
    win.close();
  });

  // ---- 第17弾：役職あり人狼が手渡し方式で1試合通ること ----
  await r.test('役職あり人狼：役職確認→夜→朝→投票→集計が通り、決着する', async () => {
    const { win, doc, errors } = await launch();
    win.confirm = () => true;
    // 棚 → 人狼カセット → プレイヤー4人
    const cart = doc.querySelector('.cart[data-cart="jinro"]');
    cart.click();
    if (activeScreen(doc) === 'scr-shelf') cart.click();
    await waitScreen(win, doc, 'scr-game', 3000);
    pickGame(doc, 'wolfrole');
    await sleep(win, 60);
    await fillPlayerForm(win, doc, ['あき', 'びび', 'ちか', 'でん']);
    await waitScreen(win, doc, 'scr-mode', 3000);
    const card = doc.querySelector('.mode-card[data-id="wolf-normal"]');
    assert(card, 'モード一覧にノーマル人狼がある');
    click(doc, card);

    // 役職の配分はプリセットのまま。話し合いタイマーは切っておく（テストで待たないため）
    click(doc, 'modeNextBtn');
    await waitScreen(win, doc, 'scr-set-wolfrole', 3000);
    assert(el(doc, 'wrVillagerCount').textContent !== '', '村人の人数が自動計算される');
    click(doc, doc.querySelector('#scr-set-wolfrole [data-wiz-next]'));
    await waitScreen(win, doc, 'scr-set-timer', 3000);
    if (el(doc, 'timerEnableToggle').classList.contains('on')) click(doc, 'timerEnableToggle');
    click(doc, doc.querySelector('#scr-set-timer [data-wiz-next]'));
    await sleep(win, 60);
    if (activeScreen(doc) === 'scr-mode-rules') { click(doc, 'rulesStartBtn'); await sleep(win, 60); }
    await waitScreen(win, doc, 'scr-ready', 3000);
    el(doc, 'holdBtn').dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true }));

    // 役職確認：4人ぶん手渡し
    await waitScreen(win, doc, 'scr-wr-pass', 8000);
    const seenRoles = [];
    for (let i = 0; i < 4; i++) {
      click(doc, 'wrRevealBtn');
      await sleep(win, 40);
      seenRoles.push(el(doc, 'wrContentBody').textContent);
      click(doc, 'wrNextBtn');
      await sleep(win, 40);
    }
    assert(seenRoles.some(t => /人狼/.test(t)), '誰かに人狼が配られている');

    // 第24弾-2：役職確認のあとは、まず作戦会議
    assertEqual(activeScreen(doc), 'scr-wr-day', '役職確認のあとは作戦会議');
    assert(/作戦会議/.test(el(doc, 'wrDayTurn').textContent), '作戦会議だと分かる');

    // 夜の行動：選択肢が出た人は選ぶ、出ない人は次へ
    await waitScreen(win, doc, 'scr-wr-pass', 9000);
    let guard = 0;
    while (activeScreen(doc) === 'scr-wr-pass' && guard++ < 20) {
      click(doc, 'wrRevealBtn');
      await sleep(win, 40);
      const choice = doc.querySelector('#wrChoiceGrid button[data-choice]');
      if (choice) choice.click();
      else click(doc, 'wrNextBtn');
      await sleep(win, 50);
    }
    // 夜が明けるか、決着していればそのまま結果へ
    assert(['scr-wr-day', 'scr-wr-result'].indexOf(activeScreen(doc)) >= 0,
      '夜のあと朝か結果に進む（現在: ' + activeScreen(doc) + '）');

    if (activeScreen(doc) === 'scr-wr-day') {
      assert(el(doc, 'wrDayNews').textContent.length > 0, '朝に夜の結果が出る');
      await holdPress(win, doc, 'wrToVoteBtn');
      // 投票：生存者ぶん手渡し
      await waitScreen(win, doc, 'scr-wr-pass', 3000);
      guard = 0;
      while (activeScreen(doc) === 'scr-wr-pass' && guard++ < 20) {
        click(doc, 'wrRevealBtn');
        await sleep(win, 40);
        const v = doc.querySelector('#wrChoiceGrid button[data-choice]');
        if (v) v.click(); else click(doc, 'wrNextBtn');
        await sleep(win, 50);
      }
      await waitScreen(win, doc, 'scr-wr-gather', 3000);
      click(doc, 'wrTallyBtn');
      await waitScreen(win, doc, 'scr-wr-result', 8000);
    }
    assert(el(doc, 'wrResultSummary').textContent.length > 0, '結果が表示される');
    assertNoErrors(errors, '役職あり人狼で未捕捉の例外');
    win.close();
  });

  await r.test('人狼カセット：ゲーム選択を経由し、ゲームごとにモードが分かれる', async () => {
    const { win, doc, errors } = await launch();
    const cart = doc.querySelector('.cart[data-cart="jinro"]');
    cart.click();
    if (activeScreen(doc) === 'scr-shelf') cart.click();
    await waitScreen(win, doc, 'scr-game', 3000);
    const games = Array.from(doc.querySelectorAll('#gameCards .mode-card')).map(c => c.dataset.game);
    assertEqual(games.join(','), 'wordwolf,wolfrole', 'ワードウルフと人狼の2ゲームが並ぶ');

    // 人狼側：プリセットがそれぞれ独立したモードカードになっている
    pickGame(doc, 'wolfrole');
    await sleep(win, 60);
    await fillPlayerForm(win, doc, PLAYERS);
    await waitScreen(win, doc, 'scr-mode', 3000);
    const ids = Array.from(doc.querySelectorAll('#modeCards .mode-card')).map(c => c.dataset.id);
    assert(ids.length >= 5, 'プリセットが5枚以上並ぶ（' + ids.length + '枚）');
    ['wolf-casual', 'wolf-normal', 'wolf-special', 'wolf-deep', 'wolf-chaos'].forEach(id => {
      assert(ids.indexOf(id) >= 0, id + ' がモードカードとして並ぶ');
    });
    assert(ids.every(id => /^wolf-/.test(id)), 'ワードウルフのモードが混ざらない');
    assertNoErrors(errors, 'ゲーム選択で未捕捉の例外');
    win.close();
  });

  // ---- 第18弾：役職あり人狼の是正 ----
  // 役職あり人狼を、指定した手順で1ターン進めるヘルパー
  // onWizard: 役職設定画面（scr-set-wolfrole）で追加の操作をしたいときに使う
  async function startWolfRole(win, doc, presetId, players, onWizard) {
    const cart = doc.querySelector('.cart[data-cart="jinro"]');
    cart.click();
    if (activeScreen(doc) === 'scr-shelf') cart.click();
    await waitScreen(win, doc, 'scr-game', 3000);
    pickGame(doc, 'wolfrole');
    await sleep(win, 60);
    await fillPlayerForm(win, doc, players);
    await waitScreen(win, doc, 'scr-mode', 3000);
    click(doc, doc.querySelector('.mode-card[data-id="' + presetId + '"]'));
    click(doc, 'modeNextBtn');
    await waitScreen(win, doc, 'scr-set-wolfrole', 3000);
    if (onWizard) { onWizard(); await sleep(win, 40); }
    click(doc, doc.querySelector('#scr-set-wolfrole [data-wiz-next]'));
    await waitScreen(win, doc, 'scr-set-timer', 3000);
    if (el(doc, 'timerEnableToggle').classList.contains('on')) click(doc, 'timerEnableToggle');
    click(doc, doc.querySelector('#scr-set-timer [data-wiz-next]'));
    await sleep(win, 60);
    if (activeScreen(doc) === 'scr-mode-rules') { click(doc, 'rulesStartBtn'); await sleep(win, 60); }
    await waitScreen(win, doc, 'scr-ready', 3000);
    el(doc, 'holdBtn').dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true }));
    await waitScreen(win, doc, 'scr-wr-pass', 8000);
  }

  // 手渡しをちょうど count 人ぶん流す。
  // 役職確認も夜も投票も同じ scr-wr-pass を使うので、人数で区切らないと隣の段階まで進んでしまう。
  // 第20弾-2で、夜と投票前は中身が2画面（行動 → 確認）になった。
  // onShow に渡すのは「1画面目」＝手渡された人が最初に見るもの。
  async function runWrHandoffs(win, doc, count, onShow, pick) {
    // 段階の変わり目には「作戦会議」（第24弾-2）と「夜になりました」（第20弾-4-1）が挟まる。
    // 待っているあいだに自動で通過するので、まず手渡しの画面に着くまで待つ
    await waitScreen(win, doc, 'scr-wr-pass', 9000);
    if (passNightfall(doc)) await sleep(win, 60);
    for (let i = 0; i < count; i++) {
      if (activeScreen(doc) !== 'scr-wr-pass') break;
      const name = el(doc, 'wrHandoffName').textContent;
      click(doc, 'wrRevealBtn');
      await sleep(win, 30);
      let first = true;
      let g = 0;
      // その人の中身の画面をすべて流し切ってから、次の人へ
      while (g++ < 5 && activeScreen(doc) === 'scr-wr-pass' && el(doc, 'wrContent').style.display !== 'none') {
        const choices = Array.from(doc.querySelectorAll('#wrChoiceGrid button[data-choice]'));
        if (first && onShow) {
          onShow({ name: name, body: el(doc, 'wrContentBody').textContent, choices: choices.length });
        }
        first = false;
        if (choices.length) {
          const target = pick ? pick(name, choices) : choices[0];
          (target || choices[0]).click();
        } else {
          click(doc, 'wrNextBtn');
        }
        await sleep(win, 45);
      }
    }
  }

  await r.test('再発防止：全員が同じ人に投票したら、その人が必ず処刑される', async () => {
    const { win, doc, errors } = await launch();
    win.confirm = () => true;
    const players = ['あき', 'びび', 'ちか', 'でん', 'えみ'];
    await startWolfRole(win, doc, 'wolf-casual', players);

    await runWrHandoffs(win, doc, players.length);  // 役職確認
    await runWrHandoffs(win, doc, players.length);  // 夜（全員に回る）
    await waitScreen(win, doc, 'scr-wr-day', 6000);
    const deadAtNight = /🌙/.test(el(doc, 'wrDayNews').textContent);
    await holdPress(win, doc, 'wrToVoteBtn');
    await waitScreen(win, doc, 'scr-wr-pass', 3000);

    // 全員が「あき」に投票する（あき本人の番だけは別の人へ）
    const voters = players.length - (deadAtNight ? 1 : 0);
    await runWrHandoffs(win, doc, voters, null, function (voter, choices) {
      const aki = choices.find(c => c.textContent === 'あき');
      return (voter === 'あき') ? choices[0] : (aki || choices[0]);
    });
    await waitScreen(win, doc, 'scr-wr-gather', 5000);
    click(doc, 'wrTallyBtn');
    await waitScreen(win, doc, 'scr-wr-result', 8000);

    // 「あき」が生きていれば処刑されているはず。
    // （夜に襲われていた場合は投票対象から外れるので、その時は検証をスキップする）
    const summary = el(doc, 'wrResultSummary').textContent;
    const list = el(doc, 'wrResultList').textContent;
    assert(!/同数/.test(summary), '票が入っているので「同数」にはならない（' + summary + '）');
    assert(/あき/.test(list), '結果一覧にあきがいる');
    assert(/あき\s*💀/.test(list.replace(/\s+/g, ' ')) || /あき/.test(summary),
      'あきが処刑されている（結果: ' + summary + ' / ' + list.replace(/\s+/g, ' ').slice(0, 80) + '）');
    assertNoErrors(errors, '投票処刑で未捕捉の例外');
    win.close();
  });

  await r.test('夜フェーズ：行動が無い人にもスマホが回り、消去法でバレない', async () => {
    const { win, doc, errors } = await launch();
    const players = ['あき', 'びび', 'ちか', 'でん', 'えみ'];
    await startWolfRole(win, doc, 'wolf-casual', players); // 人狼1・村人4
    await runWrHandoffs(win, doc, players.length);          // 役職確認

    // 夜：全員に回ること、行動が無い人にも画面が出ることを確認する
    const shown = [];
    await runWrHandoffs(win, doc, players.length, function (info) { shown.push(info); });
    assertEqual(shown.length, players.length, '生存者全員にスマホが回る（' + shown.length + '人）');
    const withChoice = shown.filter(s => s.choices > 0);
    assertEqual(withChoice.length, 1, '実際に行動するのは人狼1人だけ');
    const without = shown.filter(s => s.choices === 0);
    assertEqual(without.length, players.length - 1, '残りの人にも画面が出る');
    without.forEach(s => {
      assert(/静かに夜を過ごしましょう/.test(s.body), '行動が無い人には一律の案内が出る');
    });
    assertNoErrors(errors, '夜フェーズで未捕捉の例外');
    win.close();
  });

  await r.test('再発防止：投票前の単発行動も、生存者全員にスマホが回る', async () => {
    const { win, doc, errors } = await launch();
    const players = ['あき', 'びび', 'ちか', 'でん', 'えみ'];
    // ターン数を1にすると1ターン専用の役職セットに切り替わる。
    // のぞき見役・まきこみ役だけに回すと消去法でバレるので、全員に回るかを見る
    await startWolfRole(win, doc, 'wolf-casual', players, function () {
      // ターン数を1まで下げてから、のぞき見役を1人入れる
      const minus = doc.querySelector('#scr-set-wolfrole [data-wrturn="-1"]');
      for (let i = 0; i < 8; i++) minus.click();
      assertEqual(el(doc, 'wrTurnValue').textContent, '1', 'ターン数が1になる');
      const peekPlus = doc.querySelector('#scr-set-wolfrole [data-wrrole="peek"][data-d="1"]');
      assert(peekPlus, 'ターン数1では、のぞき見役が選べるようになる');
      peekPlus.click();
    });
    await runWrHandoffs(win, doc, players.length);   // 役職確認

    const shown = [];
    await runWrHandoffs(win, doc, players.length, function (info) { shown.push(info); });
    assertEqual(shown.length, players.length, '投票前の行動でも全員にスマホが回る');
    const acting = shown.filter(s => s.choices > 0);
    assert(acting.length >= 1 && acting.length < players.length, '実際に行動するのは一部だけ');
    shown.filter(s => s.choices === 0).forEach(s => {
      assert(/静かに待ちましょう/.test(s.body), '行動が無い人には一律の案内が出る（' + s.body.slice(0, 20) + '）');
    });
    assertNoErrors(errors, '投票前の単発行動で未捕捉の例外');
    win.close();
  });

  await r.test('匿名性：夜の画面は、役職が違っても行動が無ければ同じ文言になる', async () => {
    const { win, doc, errors } = await launch();
    const players = ['あき', 'びび', 'ちか', 'でん', 'えみ'];
    // ノーマル人狼には霊媒師が入る。霊媒師は夜に選ぶことがないので、
    // 村人と同じ文言でないと「霊媒師だ」と分かってしまう
    await startWolfRole(win, doc, 'wolf-normal', players);
    await runWrHandoffs(win, doc, players.length);   // 役職確認

    const shown = [];
    await runWrHandoffs(win, doc, players.length, function (info) { shown.push(info); });
    const idle = shown.filter(s => s.choices === 0);
    assert(idle.length >= 1, '行動しない人がいる（霊媒師や村人）');
    const texts = idle.map(s => s.body.replace(/\s+/g, ''));
    const uniq = texts.filter((t, i, a) => a.indexOf(t) === i);
    assertEqual(uniq.length, 1, '行動が無い人の画面はすべて同じ文言（' + uniq.join(' / ') + '）');
    assert(/静かに夜を過ごしましょう/.test(uniq[0]), '一律の案内になっている');
    assertNoErrors(errors, '夜の匿名性で未捕捉の例外');
    win.close();
  });

  await r.test('占い師・霊媒師は、投票の直前に自分の結果を見られる', async () => {
    const { win, doc, errors } = await launch();
    const players = ['あき', 'びび', 'ちか', 'でん', 'えみ'];
    await startWolfRole(win, doc, 'wolf-normal', players);
    await runWrHandoffs(win, doc, players.length);   // 役職確認
    await runWrHandoffs(win, doc, players.length);   // 夜（占い・護衛・襲撃）
    await waitScreen(win, doc, 'scr-wr-day', 6000);
    await holdPress(win, doc, 'wrToVoteBtn');
    await waitScreen(win, doc, 'scr-wr-pass', 3000);

    const shown = [];
    await runWrHandoffs(win, doc, players.length, function (info) { shown.push(info); });
    // 能力を使った人には結果が出ていること（出ないと占う意味がない）
    const withResult = shown.filter(s => /占いの結果|霊媒の結果/.test(s.body));
    assert(withResult.length >= 1, '占い師か霊媒師に結果が表示される');
    const divine = shown.find(s => /占いの結果/.test(s.body));
    if (divine) assert(/人狼|村人|第三/.test(divine.body), '占い結果に相手の陣営が出る（' + divine.body.slice(0, 40) + '）');
    assertNoErrors(errors, '結果表示で未捕捉の例外');
    win.close();
  });

  await r.test('再発防止：おまかせで始めても、初回のルール説明は出る', async () => {
    const { win, doc, errors } = await launch();
    const cart = doc.querySelector('.cart[data-cart="jinro"]');
    cart.click();
    if (activeScreen(doc) === 'scr-shelf') cart.click();
    await waitScreen(win, doc, 'scr-game', 3000);
    pickGame(doc, 'wordwolf');
    await sleep(win, 60);
    await fillPlayerForm(win, doc, PLAYERS);
    await waitScreen(win, doc, 'scr-mode', 3000);
    click(doc, doc.querySelector('.mode-card[data-id="wordwolf"]'));
    click(doc, 'modeAutoBtn');                       // ⚡ おまかせ
    await sleep(win, 100);
    assertEqual(activeScreen(doc), 'scr-mode-rules', 'はじめてのモードでは説明が出る');
    assert(/ウルフ/.test(el(doc, 'rulesBody').textContent), 'ワードウルフの説明が出ている');

    // 2回目は説明を飛ばす
    click(doc, 'rulesStartBtn');
    await waitScreen(win, doc, 'scr-ready', 3000);
    click(doc, 'readyBackBtn');
    await waitScreen(win, doc, 'scr-mode', 3000);
    click(doc, 'modeAutoBtn');
    await sleep(win, 100);
    assertEqual(activeScreen(doc), 'scr-ready', '2回目は説明を飛ばして準備画面へ');
    assertNoErrors(errors, 'おまかせで未捕捉の例外');
    win.close();
  });

  await r.test('第18弾：ワードウルフの話し合いは、時間を待たずに投票へ進める', async () => {
    const { win, doc, errors } = await launch();
    const cart = doc.querySelector('.cart[data-cart="jinro"]');
    cart.click();
    if (activeScreen(doc) === 'scr-shelf') cart.click();
    await waitScreen(win, doc, 'scr-game', 3000);
    pickGame(doc, 'wordwolf');
    await sleep(win, 60);
    await fillPlayerForm(win, doc, PLAYERS);
    await waitScreen(win, doc, 'scr-mode', 3000);
    click(doc, doc.querySelector('.mode-card[data-id="wordwolf"]'));
    // タイマーONのまま進める（スキップできることを確かめたいので切らない）
    click(doc, 'modeAutoBtn');
    await sleep(win, 80);
    if (activeScreen(doc) === 'scr-mode-rules') { click(doc, 'rulesStartBtn'); await sleep(win, 60); }
    await waitScreen(win, doc, 'scr-ready', 3000);
    el(doc, 'holdBtn').dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true }));

    await waitScreen(win, doc, 'scr-wolf-pass', 8000);
    for (let i = 0; i < PLAYERS.length; i++) {
      click(doc, 'wolfRevealBtn');
      await sleep(win, 40);
      click(doc, 'wolfNextRevealBtn');
      await sleep(win, 50);
    }
    await waitScreen(win, doc, 'scr-play', 5000);
    // タイマーONなので「🏁（手動終了）」は出ないが、スキップは出る
    assertEqual(el(doc, 'endRoundBtn').style.display, 'none', 'タイマーONでは手動終了は出ない');
    // 第20弾-3-2：小さい⏭ボタンをやめ、人狼と同じ大きな長押しボタンに統一した
    assert(el(doc, 'wolfDiscussHold').style.display !== 'none', '話し合いを終える長押しボタンが出る');
    await holdPress(win, doc, 'wolfDiscussBtn');
    await waitScreen(win, doc, 'scr-wolf-pass', 6000);   // 待たずに投票へ進む
    assertNoErrors(errors, 'タイマースキップで未捕捉の例外');
    win.close();
  });

  // ---- 第6部：対戦履歴に、どちらのゲームだったかが残ること ----
  // サーバーへ送る /round の中身をそのまま覗いて確認する
  function captureRounds(win) {
    const posts = [];
    const orig = win.fetch;
    win.fetch = function (u, o) {
      if (o && o.method && /\/round$/.test(String(u))) {
        try { posts.push(JSON.parse(o.body)); } catch (e) { /* 解析できないものは無視 */ }
      }
      return orig.apply(this, arguments);
    };
    return posts;
  }

  await r.test('履歴：役職あり人狼の記録に game:wolfrole と役職構成が残る', async () => {
    const { win, doc, errors } = await launch();
    win.confirm = () => true;
    const posts = captureRounds(win);

    const cart = doc.querySelector('.cart[data-cart="jinro"]');
    cart.click();
    if (activeScreen(doc) === 'scr-shelf') cart.click();
    await waitScreen(win, doc, 'scr-game', 3000);
    pickGame(doc, 'wolfrole');
    await sleep(win, 60);
    await fillPlayerForm(win, doc, ['あき', 'びび', 'ちか', 'でん']);
    await waitScreen(win, doc, 'scr-mode', 3000);
    click(doc, doc.querySelector('.mode-card[data-id="wolf-casual"]')); // 役職が少なく早く決着する
    click(doc, 'modeNextBtn');
    await waitScreen(win, doc, 'scr-set-wolfrole', 3000);
    click(doc, doc.querySelector('#scr-set-wolfrole [data-wiz-next]'));
    await waitScreen(win, doc, 'scr-set-timer', 3000);
    if (el(doc, 'timerEnableToggle').classList.contains('on')) click(doc, 'timerEnableToggle');
    click(doc, doc.querySelector('#scr-set-timer [data-wiz-next]'));
    await sleep(win, 60);
    if (activeScreen(doc) === 'scr-mode-rules') { click(doc, 'rulesStartBtn'); await sleep(win, 60); }
    await waitScreen(win, doc, 'scr-ready', 3000);
    el(doc, 'holdBtn').dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true }));

    // 決着するまでターンを回す（カウントダウンを抜けるまで少し待つ）
    await waitScreen(win, doc, 'scr-wr-pass', 8000);
    let guard = 0;
    while (guard++ < 200) {
      const cur = activeScreen(doc);
      if (cur === 'scr-nightfall') { passNightfall(doc); await sleep(win, 60); continue; }
      if (cur === 'scr-wr-pass') {
        click(doc, 'wrRevealBtn');
        await sleep(win, 30);
        const c = doc.querySelector('#wrChoiceGrid button[data-choice]');
        if (c) c.click(); else click(doc, 'wrNextBtn');
        await sleep(win, 40);
      } else if (cur === 'scr-wr-day') {
        await holdPress(win, doc, 'wrToVoteBtn');
        await sleep(win, 60);
      } else if (cur === 'scr-wr-gather') {
        click(doc, 'wrTallyBtn');
        await sleep(win, 2600); // 集計のカウントダウンを待つ
      } else if (cur === 'scr-wr-result') {
        const done = /スコアへ/.test(el(doc, 'wrResultNextBtn').textContent);
        click(doc, 'wrResultNextBtn');
        await sleep(win, 100);
        if (done) break;
      } else {
        await sleep(win, 60);
      }
    }
    await waitScreen(win, doc, 'scr-score', 5000);

    // ここが今回の確認点：記録にゲーム種別が入っているか
    // （ターンごとのラウンドも送られるので、詳細が付いたものを取り出す）
    const detailed = posts.filter(p => p.detail);
    const last = detailed[detailed.length - 1];
    assert(posts.length > 0, 'サーバーへラウンドが送られている');
    assert(last, '詳細（detail）付きのラウンドが送られている');
    assertEqual(detailed.length, 1, '詳細付きの記録は1件だけ（重複しない）');
    assertEqual(last.detail.game, 'wolfrole', '記録に game:wolfrole が残る');
    assert(last.detail.preset && /^wolf-/.test(last.detail.preset), 'どのプリセットで遊んだかが残る（' + last.detail.preset + '）');
    assert(last.detail.roles && last.detail.roles.wolf >= 1, '役職構成が残る');
    assert(['village', 'wolf', 'fox'].indexOf(last.detail.winner) >= 0, '勝った陣営が残る（' + last.detail.winner + '）');
    assert(typeof last.detail.turnsPlayed === 'number', '何ターンで終わったかが残る');
    assertNoErrors(errors, '履歴の記録で未捕捉の例外');
    win.close();
  });

  // ---- 第17弾改訂：ワードウルフ（2〜ターン） ----
  // 1周（お題配布→話し合い→投票→集計）を回すヘルパー
  async function runWolfRound(win, doc, opts) {
    opts = opts || {};
    if (!opts.skipReveal) {
      await waitScreen(win, doc, 'scr-wolf-pass', 8000);
      let g = 0;
      while (activeScreen(doc) === 'scr-wolf-pass' && g++ < 20) {
        click(doc, 'wolfRevealBtn');
        await sleep(win, 40);
        click(doc, 'wolfNextRevealBtn'); // お題を見た → つぎの人へ
        await sleep(win, 50);
      }
    }
    await waitScreen(win, doc, 'scr-play', 5000);
    click(doc, 'endRoundBtn');
    await waitScreen(win, doc, 'scr-wolf-pass', 6000);
    let g2 = 0;
    while (activeScreen(doc) === 'scr-wolf-pass' && g2++ < 20) {
      click(doc, 'wolfRevealBtn');
      await sleep(win, 40);
      const t = doc.querySelector('#wolfVoteGrid button');
      if (t) t.click(); else break;
      await sleep(win, 50);
    }
    await waitScreen(win, doc, 'scr-wolf-gather', 5000);
    click(doc, 'wolfTallyBtn');
    await waitScreen(win, doc, 'scr-wolf-result', 8000);
  }

  async function startWolfMulti(win, doc, changeTopic) {
    const cart = doc.querySelector('.cart[data-cart="jinro"]');
    cart.click();
    if (activeScreen(doc) === 'scr-shelf') cart.click();
    await waitScreen(win, doc, 'scr-game', 3000);
    pickGame(doc, 'wordwolf');
    await sleep(win, 60);
    await fillPlayerForm(win, doc, PLAYERS);
    await waitScreen(win, doc, 'scr-mode', 3000);
    click(doc, doc.querySelector('.mode-card[data-id="wordwolf-multi"]'));
    click(doc, 'modeNextBtn');
    await waitScreen(win, doc, 'scr-set-wolfmulti', 3000);
    // ターン数を2にして、お題変更の有無を設定する
    const minus = doc.querySelector('#scr-set-wolfmulti [data-wmturn="-1"]');
    for (let i = 0; i < 5; i++) minus.click();
    assertEqual(el(doc, 'wmTurnValue').textContent, '2', 'ターン数の下限は2');
    if (el(doc, 'wmChangeToggle').classList.contains('on') !== changeTopic) click(doc, 'wmChangeToggle');
    // 残りのウィザードを進めつつ、タイマーは切る
    for (let i = 0; i < 6; i++) {
      const cur = activeScreen(doc);
      if (cur === 'scr-ready' || cur === 'scr-mode-rules') break;
      if (cur === 'scr-set-timer' && el(doc, 'timerEnableToggle').classList.contains('on')) {
        click(doc, 'timerEnableToggle');
        await sleep(win, 30);
      }
      const next = doc.querySelector('#' + cur + ' [data-wiz-next]');
      if (!next) break;
      next.click();
      await sleep(win, 30);
    }
    if (activeScreen(doc) === 'scr-mode-rules') { click(doc, 'rulesStartBtn'); await sleep(win, 60); }
    await waitScreen(win, doc, 'scr-ready', 3000);
    el(doc, 'holdBtn').dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true }));
  }

  await r.test('ワードウルフ2〜ターン（お題変更あり）：2ターン遊んで合計得点で決着する', async () => {
    const { win, doc, errors } = await launch();
    await startWolfMulti(win, doc, true);
    await runWolfRound(win, doc);                    // 1ターン目
    assertEqual(el(doc, 'wolfResultNextBtn').textContent.indexOf('スコアへ'), -1, '1ターン目ではまだ終わらない');
    click(doc, 'wolfResultNextBtn');
    await runWolfRound(win, doc);                    // 2ターン目（お題が変わるので配布からやり直す）
    click(doc, 'wolfResultNextBtn');
    await waitScreen(win, doc, 'scr-wolf-result', 5000);
    assert(/ターン終了/.test(el(doc, 'wolfResultTopics').textContent), '合計得点での決着が表示される');
    assertNoErrors(errors, '2〜ターン（お題変更あり）で未捕捉の例外');
    win.close();
  });

  await r.test('ワードウルフ2〜ターン（お題変更なし）：逃げ切られたらウルフ側の勝ち', async () => {
    const { win, doc, errors } = await launch();
    const posts = captureRounds(win);
    await startWolfMulti(win, doc, false);
    await runWolfRound(win, doc);                    // 1ターン目
    click(doc, 'wolfResultNextBtn');
    await sleep(win, 200);
    // 1ターン目でウルフを当てていれば即決着。当てていなければ、
    // お題は変わらないので配布を挟まず話し合いから2ターン目が始まる
    if (activeScreen(doc) === 'scr-play') {
      await runWolfRound(win, doc, { skipReveal: true });
      click(doc, 'wolfResultNextBtn');
      await sleep(win, 200);
    }
    await waitScreen(win, doc, 'scr-wolf-result', 5000);
    const text = el(doc, 'wolfResultTopics').textContent;
    assert(/ウルフ🐺側の勝ち|シープ🐑側の勝ち/.test(text), '当てたか逃げ切ったかで決着する（' + text + '）');
    // 履歴：こちらは wordwolf 側のゲームとして残ること
    const detailed = posts.filter(p => p.detail);
    const last = detailed[detailed.length - 1];
    assert(last, 'ラウンドの詳細が送られている');
    assertEqual(detailed.length, 1, '詳細付きの記録は1件だけ（二重に残らない）');
    assertEqual(last.detail.game, 'wordwolf', '記録に game:wordwolf が残る');
    assert(['sameTopic', 'newTopic'].indexOf(last.detail.variant) >= 0, 'お題変更の有無が残る（' + last.detail.variant + '）');
    assertNoErrors(errors, '2〜ターン（お題変更なし）で未捕捉の例外');
    win.close();
  });

  // ---- 第18弾 第6部-2：役職ありワードウルフ ----
  // ワードウルフを、役職を配った状態で始める。
  // modeId: 'wordwolf'（1ターン）/ 'wordwolf-multi'（2〜ターン）
  async function startWordwolfWithRoles(win, doc, modeId, roleIds, players) {
    const cart = doc.querySelector('.cart[data-cart="jinro"]');
    cart.click();
    if (activeScreen(doc) === 'scr-shelf') cart.click();
    await waitScreen(win, doc, 'scr-game', 3000);
    pickGame(doc, 'wordwolf');
    await sleep(win, 60);
    await fillPlayerForm(win, doc, players);
    await waitScreen(win, doc, 'scr-mode', 3000);
    click(doc, doc.querySelector('.mode-card[data-id="' + modeId + '"]'));
    click(doc, 'modeNextBtn');
    await sleep(win, 60);
    if (activeScreen(doc) === 'scr-set-wolfmulti') {
      const minus = doc.querySelector('#scr-set-wolfmulti [data-wmturn="-1"]');
      for (let i = 0; i < 5; i++) minus.click();          // 2ターンに固定
      click(doc, doc.querySelector('#scr-set-wolfmulti [data-wiz-next]'));
      await sleep(win, 40);
    }
    await waitScreen(win, doc, 'scr-set-wolf', 3000);
    assert(el(doc, 'wolfRoleSection').style.display !== 'none', '役職の欄が出る');
    roleIds.forEach(id => {
      const plus = doc.querySelector('#wolfRoleRows [data-wwrole="' + id + '"][data-d="1"]');
      assert(plus && !plus.disabled, id + ' を選べる');
      plus.click();
    });
    await sleep(win, 40);
    for (let i = 0; i < 6; i++) {
      const cur = activeScreen(doc);
      if (cur === 'scr-ready' || cur === 'scr-mode-rules') break;
      if (cur === 'scr-set-timer' && el(doc, 'timerEnableToggle').classList.contains('on')) {
        click(doc, 'timerEnableToggle');
        await sleep(win, 30);
      }
      const next = doc.querySelector('#' + cur + ' [data-wiz-next]');
      if (!next) break;
      next.click();
      await sleep(win, 30);
    }
    if (activeScreen(doc) === 'scr-mode-rules') { click(doc, 'rulesStartBtn'); await sleep(win, 60); }
    await waitScreen(win, doc, 'scr-ready', 3000);
    el(doc, 'holdBtn').dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true }));
    await waitScreen(win, doc, 'scr-wolf-pass', 8000);
  }

  // scr-wolf-pass を1人ぶん流し、その人が何回タップしたかを返す
  async function passOneWithTapCount(win, doc, onReveal) {
    const name = el(doc, 'wrHandoffName') && false; // 使わない（人狼カセット側の要素）
    let taps = 0;
    click(doc, 'wolfRevealBtn'); taps++;
    await sleep(win, 40);
    if (onReveal) onReveal();
    const pick = doc.querySelector('#wolfRolePickGrid button[data-wwpick]');
    const nextBtn = el(doc, 'wolfNextRevealBtn');
    if (pick && el(doc, 'wolfRolePickGrid').style.display !== 'none') {
      assertEqual(nextBtn.style.display, 'none', '選ぶ画面では「つぎへ」を出さない（タップ数を増やさない）');
      pick.click(); taps++;
    } else {
      click(doc, 'wolfNextRevealBtn'); taps++;
    }
    await sleep(win, 50);
    return taps;
  }

  await r.test('役職ありワードウルフ：役職の有無にかかわらずタップ数が揃う', async () => {
    const { win, doc, errors } = await launch();
    const players = ['あき', 'びび', 'ちか', 'でん', 'えみ'];
    await startWordwolfWithRoles(win, doc, 'wordwolf', ['peek', 'involve'], players);

    const taps = [];
    const bodies = [];
    let guard = 0;
    while (activeScreen(doc) === 'scr-wolf-pass' && guard++ < 12) {
      taps.push(await passOneWithTapCount(win, doc, () => {
        bodies.push(el(doc, 'wolfRoleBox').textContent);
      }));
    }
    assertEqual(taps.length, players.length, '全員にスマホが回る');
    assert(taps.every(t => t === taps[0]), 'お題を見るフェーズのタップ数が全員同じ（' + taps.join(',') + '）');
    assertEqual(taps[0], 2, 'お題を見る＋選ぶ／つぎへ で2タップ');
    assert(bodies.every(b => /あなたの役職/.test(b)), '役職欄は全員に出る（消去法で役職がバレない）');
    // 第22弾-4：のぞき見・まきこみは、お題を見る時には動かない
    assert(!bodies.some(b => /覗きますか|投票先を公開しますか/.test(b)),
      'お題を見る画面では、投票直前の役職は動かない');

    // 話し合いのあと、投票の直前の手渡し
    await waitScreen(win, doc, 'scr-play', 5000);
    click(doc, 'endRoundBtn');
    await waitScreen(win, doc, 'scr-wolf-pass', 6000);
    // 投票のまえと投票は同じ画面を使うので、人数ぶんで区切らないと隣の段階まで進む
    const preTaps = [], preBodies = [], preHandoffs = [];
    for (let i = 0; i < players.length; i++) {
      if (activeScreen(doc) !== 'scr-wolf-pass') break;
      let t = 0;
      // 渡す前の画面は、役職があってもなくても同じでなければならない。
      // ここに差が出ると、覗く人が誰かを渡す側に悟られる（第22弾-7で追加）
      preHandoffs.push(el(doc, 'wolfHandoffScreen').textContent
        .replace(el(doc, 'wolfHandoffName').textContent.trim(), '＿')
        .replace(/\s+/g, ''));
      click(doc, 'wolfRevealBtn'); t++;
      await sleep(win, 40);
      preBodies.push(el(doc, 'wolfRoleBox').textContent);
      const pick = doc.querySelector('#wolfRolePickGrid button[data-wwpick]');
      if (pick && el(doc, 'wolfRolePickGrid').style.display !== 'none') { pick.click(); t++; }
      else { click(doc, 'wolfNextRevealBtn'); t++; }
      await sleep(win, 50);
      preTaps.push(t);
    }
    assert(preHandoffs.every(h => h === preHandoffs[0]),
      '渡す前の画面は、名前以外まったく同じ（' + preHandoffs.join(' / ') + '）');
    assertEqual(preTaps.length, players.length, '投票のまえも全員にスマホが回る');
    assert(preTaps.every(t => t === 2), '投票のまえのタップ数も全員2で揃う（' + preTaps.join(',') + '）');
    assert(preBodies.some(b => /覗きますか/.test(b)), 'ここでのぞき見役が動く');
    assert(preBodies.some(b => /投票先を公開しますか/.test(b)), 'ここでまきこみ役が動く');
    // 行動が無い人は、全員まったく同じ文言でなければならない
    const idle = preBodies.filter(b => !/覗きますか|投票先を公開しますか/.test(b))
      .map(b => b.replace(/\s+/g, ''));
    assert(idle.length >= 1, '行動が無い人がいる');
    assert(idle.every(b => b === idle[0]), '行動が無い人の文言は完全に同じ（' + idle.join(' / ') + '）');

    await waitScreen(win, doc, 'scr-wolf-pass', 6000);
    const voteTaps = [];
    let sawInfo = false;
    guard = 0;
    while (activeScreen(doc) === 'scr-wolf-pass' && guard++ < 12) {
      let t = 0;
      click(doc, 'wolfRevealBtn'); t++;
      await sleep(win, 40);
      if (el(doc, 'wolfVoteInfo').style.display !== 'none') sawInfo = true;
      const target = doc.querySelector('#wolfVoteGrid button');
      if (!target) break;
      target.click(); t++;
      await sleep(win, 50);
      voteTaps.push(t);
    }
    assert(voteTaps.every(t => t === 2), '投票フェーズも全員2タップ（' + voteTaps.join(',') + '）');
    assert(sawInfo, 'のぞき見の結果が、投票の直前に本人だけに出る');

    await waitScreen(win, doc, 'scr-wolf-gather', 5000);
    click(doc, 'wolfTallyBtn');
    await waitScreen(win, doc, 'scr-wolf-result', 8000);
    const res = el(doc, 'wolfResultTopics').textContent;
    assert(/📢/.test(res), 'まきこみ役が指名した人の投票先が公開される');
    assert(/のぞき見役/.test(res) && /まきこみ役/.test(res), '結果画面で役職の答え合わせが出る');
    assertNoErrors(errors, '役職ありワードウルフで未捕捉の例外');
    win.close();
  });

  await r.test('役職ありワードウルフ：2〜ターン版も、占い師の有無が外から分からない', async () => {
    const { win, doc, errors } = await launch();
    const players = ['あき', 'びび', 'ちか', 'でん', 'えみ'];
    await startWordwolfWithRoles(win, doc, 'wordwolf-multi', ['seer', 'madman'], players);
    // 1ターン専用の役職は出ない（逆も同様）
    assert(!doc.querySelector('#wolfRoleRows [data-wwrole="peek"]'), '2〜ターン版に のぞき見役 は出ない');

    const taps = [], handoffs = [], boxes = [];
    let guard = 0, seerSeen = false, madmanSeen = false;
    while (activeScreen(doc) === 'scr-wolf-pass' && guard++ < 12) {
      // 手渡し画面の文言は、役職の有無にかかわらず同じでなければならない
      handoffs.push(doc.querySelector('.wolf-handoff-sub').textContent.trim() +
        '|' + el(doc, 'wolfRevealBtn').textContent.trim());
      let t = 0;
      click(doc, 'wolfRevealBtn'); t++;
      await sleep(win, 40);
      const box = el(doc, 'wolfRoleBox').textContent;
      boxes.push(box);
      if (/占い師/.test(box)) seerSeen = true;
      if (/狂人/.test(box)) madmanSeen = true;
      const pick = doc.querySelector('#wolfRolePickGrid button[data-wwpick]');
      if (pick && el(doc, 'wolfRolePickGrid').style.display !== 'none') { pick.click(); t++; }
      else { click(doc, 'wolfNextRevealBtn'); t++; }
      taps.push(t);
      await sleep(win, 50);
    }
    assert(seerSeen, '占い師が配られる');
    assert(madmanSeen, '狂人が配られる');
    assertEqual(taps.length, players.length, '全員にスマホが回る');
    assert(handoffs.every(h => h === handoffs[0]), '手渡し画面の文言が全員同じ');
    assert(taps.every(t => t === 2), '占い師も村人も2タップで揃う（' + taps.join(',') + '）');
    assert(boxes.every(b => /あなたの役職/.test(b)), '役職欄は全員に出る');
    // 狂人の画面は村人と同じ構え（選択グリッドなし・つぎへボタンあり）でなければならない
    const madmanBox = boxes.find(b => /狂人/.test(b));
    assert(!/占います|覗きます|公開します/.test(madmanBox), '狂人には選択を求めない（村人と同じ構え）');
    assert(!/夜/.test(boxes.join('')), 'ワードウルフに夜は無いので、説明文に「夜」を出さない');

    // 1ターン目の結果で役職を割ってしまうと、残りのターンが成立しない
    await waitScreen(win, doc, 'scr-play', 5000);
    click(doc, 'endRoundBtn');
    await waitScreen(win, doc, 'scr-wolf-pass', 6000);
    guard = 0;
    while (activeScreen(doc) === 'scr-wolf-pass' && guard++ < 12) {
      click(doc, 'wolfRevealBtn');
      await sleep(win, 40);
      const t = doc.querySelector('#wolfVoteGrid button');
      if (!t) break;
      t.click();
      await sleep(win, 50);
    }
    await waitScreen(win, doc, 'scr-wolf-gather', 5000);
    click(doc, 'wolfTallyBtn');
    await waitScreen(win, doc, 'scr-wolf-result', 8000);
    const mid = el(doc, 'wolfResultTopics').textContent;
    assert(!/占い師|狂人/.test(mid), '途中のターンでは役職の答え合わせを出さない');

    // 決着したターンでは明かす
    click(doc, 'wolfResultNextBtn');
    await sleep(win, 200);
    let g2 = 0;
    while (!/スコアへ/.test(el(doc, 'wolfResultNextBtn').textContent) && g2++ < 6) {
      if (activeScreen(doc) === 'scr-play') {
        click(doc, 'endRoundBtn');
        await waitScreen(win, doc, 'scr-wolf-pass', 6000);
        let g3 = 0;
        while (activeScreen(doc) === 'scr-wolf-pass' && g3++ < 12) {
          click(doc, 'wolfRevealBtn');
          await sleep(win, 40);
          const t = doc.querySelector('#wolfVoteGrid button');
          if (!t) break;
          t.click();
          await sleep(win, 50);
        }
        await waitScreen(win, doc, 'scr-wolf-gather', 5000);
        click(doc, 'wolfTallyBtn');
        await waitScreen(win, doc, 'scr-wolf-result', 8000);
      }
      if (/スコアへ/.test(el(doc, 'wolfResultNextBtn').textContent)) break;
      click(doc, 'wolfResultNextBtn');
      await sleep(win, 200);
    }
    const final = el(doc, 'wolfResultTopics').textContent;
    assert(/占い師/.test(final) && /狂人/.test(final), '決着したら役職の答え合わせが出る');
    assertNoErrors(errors, '2〜ターン版の役職ありワードウルフで未捕捉の例外');
    win.close();
  });

  // 役職ありワードウルフを1ターンぶん流し、だれがウルフ／狂人だったかと結果画面の加点を返す。
  // voteFor(wolfId, players) が投票先のプレイヤーIDを返す
  async function playWordwolfRoleTurn(win, doc, roleIds, players, voteFor) {
    await startWordwolfWithRoles(win, doc, 'wordwolf-multi', roleIds, players);
    const topics = {}; const roles = {};
    let guard = 0;
    while (activeScreen(doc) === 'scr-wolf-pass' && guard++ < 12) {
      const who = el(doc, 'wolfHandoffName').textContent.trim();
      click(doc, 'wolfRevealBtn');
      await sleep(win, 40);
      topics[who] = el(doc, 'wolfTopicText').textContent.trim();
      roles[who] = el(doc, 'wolfRoleBox').textContent;
      const pick = doc.querySelector('#wolfRolePickGrid button[data-wwpick]');
      if (pick && el(doc, 'wolfRolePickGrid').style.display !== 'none') pick.click();
      else click(doc, 'wolfNextRevealBtn');
      await sleep(win, 50);
    }
    // 少数派＝そのお題を持つのが1人だけの方
    const counts = {};
    Object.keys(topics).forEach(n => { counts[topics[n]] = (counts[topics[n]] || 0) + 1; });
    const wolfName = Object.keys(topics).find(n => counts[topics[n]] === 1);
    const madmanName = Object.keys(roles).find(n => /狂人/.test(roles[n]));

    await waitScreen(win, doc, 'scr-play', 5000);
    click(doc, 'endRoundBtn');
    await waitScreen(win, doc, 'scr-wolf-pass', 6000);
    guard = 0;
    while (activeScreen(doc) === 'scr-wolf-pass' && guard++ < 12) {
      const who = el(doc, 'wolfHandoffName').textContent.trim();
      click(doc, 'wolfRevealBtn');
      await sleep(win, 40);
      const want = voteFor(wolfName, who);
      const btns = Array.from(doc.querySelectorAll('#wolfVoteGrid button'));
      const target = btns.find(b => b.textContent.trim() === want) || btns[0];
      target.click();
      await sleep(win, 50);
    }
    await waitScreen(win, doc, 'scr-wolf-gather', 5000);
    click(doc, 'wolfTallyBtn');
    await waitScreen(win, doc, 'scr-wolf-result', 8000);
    const deltas = {};
    doc.querySelectorAll('#wolfResultList .reveal-row').forEach(row => {
      const name = row.querySelector('.rn').textContent.replace('🐺', '').trim();
      deltas[name] = row.querySelector('.rd').textContent.trim();
    });
    return { wolfName, madmanName, deltas };
  }

  await r.test('狂人はワードウルフのスコアで人狼側として扱われる', async () => {
    const players = ['あき', 'びび', 'ちか', 'でん', 'えみ'];

    // ① ウルフが当てられたケース：狂人は当てても加点されない
    {
      const { win, doc, errors } = await launch();
      const { wolfName, madmanName, deltas } = await playWordwolfRoleTurn(
        win, doc, ['madman'], players,
        (wolf, me) => (me === wolf ? players.find(n => n !== wolf) : wolf) // ウルフ以外は全員ウルフに投票
      );
      assert(madmanName, '狂人が配られる');
      assertEqual(deltas[wolfName], '', 'ウルフは当てられたので加点なし');
      assertEqual(deltas[madmanName], '', '狂人はウルフに投票しても加点されない');
      const villagers = players.filter(n => n !== wolfName && n !== madmanName);
      villagers.forEach(n => assertEqual(deltas[n], '+1', n + ' は当てたので +1'));
      assertNoErrors(errors, '狂人あり（ウルフ発覚）で未捕捉の例外');
      win.close();
    }

    // ② ウルフが逃げ切ったケース：狂人もウルフと一緒に加点される
    {
      const { win, doc, errors } = await launch();
      const { wolfName, madmanName, deltas } = await playWordwolfRoleTurn(
        win, doc, ['madman'], players,
        (wolf, me) => players.find(n => n !== wolf && n !== me) // だれもウルフに投票しない
      );
      assertEqual(deltas[wolfName], '+1', 'ウルフは逃げ切ったので +1');
      assertEqual(deltas[madmanName], '+1', '狂人は人狼側として一緒に +1');
      assertNoErrors(errors, '狂人あり（逃げ切り）で未捕捉の例外');
      win.close();
    }
  });

  // ---- 第22弾 第5部：集計のカウントダウンが止まる ----
  await r.test('再発防止：2回目の集計画面でも「集計する」が出る', async () => {
    // ワードウルフ側が人狼側と別のカウントダウンを持っていて、
    // そちらは「集計する」を隠したまま戻していなかった。
    // 1回で終わる遊び方では気づかず、投票を2回まわす時だけ詰まっていた。
    const { win, doc, errors } = await launch();
    const players = ['あき', 'びび', 'ちか', 'でん', 'えみ', 'ふう', 'げん'];
    await startWordwolfWithWolves(win, doc, players, 2); // ウルフ2人＝投票が2回

    for (let round = 1; round <= 2; round++) {
      let k = 0;
      while (activeScreen(doc) === 'scr-wolf-pass' && k++ < 12) {
        click(doc, 'wolfRevealBtn');
        await sleep(win, 35);
        const t = doc.querySelector('#wolfVoteGrid button');
        if (!t) break;
        t.click();
        await sleep(win, 45);
      }
      await waitScreen(win, doc, 'scr-wolf-gather', 5000);
      assert(el(doc, 'wolfTallyBtn').style.display !== 'none',
        round + '回目：「集計する」が出ている');
      assertEqual(el(doc, 'wolfCdNumber').style.display, 'none',
        round + '回目：前回の数字が残っていない');
      click(doc, 'wolfTallyBtn');
      await waitScreen(win, doc, 'scr-wolf-result', 8000);
      if (!/つぎの投票/.test(el(doc, 'wolfResultNextBtn').textContent)) break;
      click(doc, 'wolfResultNextBtn');
      await waitScreen(win, doc, 'scr-wolf-pass', 5000);
    }
    assertNoErrors(errors, '2回目の集計で未捕捉の例外');
    win.close();
  });

  await r.test('再発防止：集計の途中で画面を離れても、あとから勝手に飛ばされない', async () => {
    const { win, doc, errors } = await launch();
    win.confirm = () => true;
    win.alert = () => {};
    const players = ['あき', 'びび', 'ちか', 'でん', 'えみ'];
    await startWordwolfWithWolves(win, doc, players, 1);
    let k = 0;
    while (activeScreen(doc) === 'scr-wolf-pass' && k++ < 12) {
      click(doc, 'wolfRevealBtn');
      await sleep(win, 35);
      const t = doc.querySelector('#wolfVoteGrid button');
      if (!t) break;
      t.click();
      await sleep(win, 45);
    }
    await waitScreen(win, doc, 'scr-wolf-gather', 5000);
    click(doc, 'wolfTallyBtn');
    await sleep(win, 100); // カウントダウンの途中
    // 途中でゲームを終える
    click(doc, 'floatingGearBtn');
    await sleep(win, 100);
    click(doc, 'endGameBtn');
    await waitScreen(win, doc, 'scr-shelf', 6000);
    // カウントダウンが生き残っていると、ここで結果画面へ飛ばされてしまう
    await sleep(win, 2500);
    assertEqual(activeScreen(doc), 'scr-shelf', '棚にいたまま動かない');
    assertNoErrors(errors, '集計の中断で未捕捉の例外');
    win.close();
  });

  // ---- 第22弾 第2〜3部：表記と、カオス人狼の稀な村人 ----
  await r.test('人狼カセットのタイマーは「話し合いの時間」と出る', async () => {
    const { win, doc, errors } = await launch();
    const players = ['あき', 'びび', 'ちか', 'でん', 'えみ'];
    // 人狼（役職あり）
    const cart = doc.querySelector('.cart[data-cart="jinro"]');
    cart.click();
    if (activeScreen(doc) === 'scr-shelf') cart.click();
    await waitScreen(win, doc, 'scr-game', 3000);
    pickGame(doc, 'wolfrole');
    await sleep(win, 60);
    await fillPlayerForm(win, doc, players);
    await waitScreen(win, doc, 'scr-mode', 3000);
    click(doc, doc.querySelector('.mode-card[data-id="wolf-casual"]'));
    click(doc, 'modeNextBtn');
    await waitScreen(win, doc, 'scr-set-wolfrole', 3000);
    click(doc, doc.querySelector('#scr-set-wolfrole [data-wiz-next]'));
    await waitScreen(win, doc, 'scr-set-timer', 3000);
    assertEqual(el(doc, 'timerStepTitle').textContent, '話し合いの時間', '人狼：見出しが正しい');
    assert(/話し合いの時間を決めよう/.test(el(doc, 'timerStepLead').textContent), '人狼：説明も正しい');
    assert(!/せいげん時間|ラウンドの制限時間/.test(
      el(doc, 'timerStepTitle').textContent + el(doc, 'timerStepLead').textContent),
      '人狼：古い表記が残っていない');
    win.close();

    // ワードウルフ
    const b = await launch();
    const cart2 = b.doc.querySelector('.cart[data-cart="jinro"]');
    cart2.click();
    if (activeScreen(b.doc) === 'scr-shelf') cart2.click();
    await waitScreen(b.win, b.doc, 'scr-game', 3000);
    pickGame(b.doc, 'wordwolf');
    await sleep(b.win, 60);
    await fillPlayerForm(b.win, b.doc, players);
    await waitScreen(b.win, b.doc, 'scr-mode', 3000);
    click(b.doc, b.doc.querySelector('.mode-card[data-id="wordwolf"]'));
    click(b.doc, 'modeNextBtn');
    await waitScreen(b.win, b.doc, 'scr-set-wolf', 3000);
    click(b.doc, b.doc.querySelector('#scr-set-wolf [data-wiz-next]'));
    await waitScreen(b.win, b.doc, 'scr-set-timer', 3000);
    assertEqual(el(b.doc, 'timerStepTitle').textContent, '話し合いの時間', 'ワードウルフ：見出しが正しい');
    assertNoErrors(errors, 'タイマー表記で未捕捉の例外');
    assertNoErrors(b.errors, 'タイマー表記（ワードウルフ）で未捕捉の例外');
    b.win.close();
  });

  await r.test('カオス人狼：ルール文に英語が混ざっていない', async () => {
    const { win, doc, errors } = await launch();
    const players = ['あ', 'い', 'う', 'え', 'お', 'か', 'き', 'く'];
    const cart = doc.querySelector('.cart[data-cart="jinro"]');
    cart.click();
    if (activeScreen(doc) === 'scr-shelf') cart.click();
    await waitScreen(win, doc, 'scr-game', 3000);
    pickGame(doc, 'wolfrole');
    await sleep(win, 60);
    await fillPlayerForm(win, doc, players);
    await waitScreen(win, doc, 'scr-mode', 3000);
    click(doc, doc.querySelector('.mode-card[data-id="wolf-yaminabe"]'));
    click(doc, 'modeNextBtn');
    await sleep(win, 80);
    if (activeScreen(doc) === 'scr-mode-rules') {
      const t = el(doc, 'scr-mode-rules').textContent;
      assert(!/village/i.test(t), 'ルール説明に英語が混ざっていない');
      assert(/稀に/.test(t), 'ごく稀に村人が紛れることが書いてある');
    }
    assertNoErrors(errors, 'カオス人狼のルールで未捕捉の例外');
    win.close();
  });

  await r.test('カオス人狼：設定画面では、稀な村人をネタバレしない', async () => {
    // ここで「村人 1人」と出ると、始まる前に全員に分かってしまう
    const { win, doc, errors } = await launch();
    const players = ['あ', 'い', 'う', 'え', 'お', 'か', 'き', 'く'];
    const cart = doc.querySelector('.cart[data-cart="jinro"]');
    cart.click();
    if (activeScreen(doc) === 'scr-shelf') cart.click();
    await waitScreen(win, doc, 'scr-game', 3000);
    pickGame(doc, 'wolfrole');
    await sleep(win, 60);
    await fillPlayerForm(win, doc, players);
    await waitScreen(win, doc, 'scr-mode', 3000);
    // 何度選び直しても、設定画面は必ず「全員が役職あり」でなければならない
    for (let i = 0; i < 30; i++) {
      click(doc, doc.querySelector('.mode-card[data-id="wolf-normal"]'));
      await sleep(win, 10);
      click(doc, doc.querySelector('.mode-card[data-id="wolf-yaminabe"]'));
      await sleep(win, 10);
      click(doc, 'modeNextBtn');
      await waitScreen(win, doc, 'scr-set-wolfrole', 3000);
      const note = el(doc, 'scr-set-wolfrole').textContent;
      assert(/全員が役職あり/.test(note), '設定画面は常に闇鍋として出る（' + i + '回目）');
      assert(!/村人 1人/.test(note), '村人の人数を見せない（' + i + '回目）');
      click(doc, doc.querySelector('#scr-set-wolfrole [data-wiz-back]'));
      await waitScreen(win, doc, 'scr-mode', 3000);
    }
    assertNoErrors(errors, '闇鍋の設定画面で未捕捉の例外');
    win.close();
  });

  // ---- 第26弾 第3部：遊び方は入り口で決まる（「何台で遊ぶ？」の選択は消した） ----
  await r.test('棚からカセットを直接タップしたら、これまで通り手渡しのウィザードへ行く', async () => {
    const { win, doc, errors } = await launch();
    const cart = doc.querySelector('.cart[data-cart="jinro"]');
    cart.click();
    if (activeScreen(doc) === 'scr-shelf') cart.click();
    await waitScreen(win, doc, 'scr-game', 3000);
    pickGame(doc, 'wolfrole');
    await sleep(win, 60);
    await fillPlayerForm(win, doc, ['あき', 'びび', 'ちか', 'でん', 'えみ']);
    await waitScreen(win, doc, 'scr-mode', 3000);
    // 「何台のスマホで遊ぶ？」はもう聞かない
    assert(!doc.getElementById('wolfStyleRow'), '遊び方の選択は残っていない');
    assertEqual(el(doc, 'modeRoomNote').style.display, 'none', '部屋のための選択ではない');
    click(doc, 'modeNextBtn');
    await waitScreen(win, doc, 'scr-set-wolfrole', 3000);
    assertNoErrors(errors, '手渡しの入り口で未捕捉の例外');
    win.close();
  });

  await r.test('手渡しのプレイヤー設定に、1人1台で遊びたい人への案内がある', async () => {
    const { win, doc, errors } = await launch();
    const cart = doc.querySelector('.cart[data-cart="aresoredorekore"]');
    cart.click();
    if (activeScreen(doc) === 'scr-shelf') cart.click();
    await waitScreen(win, doc, 'scr-setup', 3000);
    assert(/「部屋」から始めて/.test(el(doc, 'scr-setup').textContent),
      '先に「部屋」から始める道があることを伝える');
    // 止めはしない（ポップアップにしない）
    assertEqual(doc.querySelectorAll('#scr-setup .overlay.show').length, 0, '進行は止めない');
    assertNoErrors(errors, 'プレイヤー設定の案内で未捕捉の例外');
    win.close();
  });

  await r.test('部屋の入り口は「あそびかたをえらぶ」から入れて、つながらない時は理由が出る', async () => {
    // 第32弾-A：部屋への導線はここ1本になった（棚の下部バーからは無くなった）
    const { win, doc, errors } = await launch({ playFlow: false });
    click(doc, doc.querySelector('#scr-howto [data-howto="room"]'));
    await waitScreen(win, doc, 'scr-rt-lobby', 3000);
    assert(doc.getElementById('rtCreateBtn'), '部屋をつくる導線がある');
    assert(doc.getElementById('rtJoinCode'), '部屋コードで入る導線がある');
    // socket.io を読み込めない環境では、その旨を出して手渡しへ誘導する
    assert(/通信の準備/.test(el(doc, 'rtLobbyStatus').textContent),
      'つながらない時は理由が出る（' + el(doc, 'rtLobbyStatus').textContent.slice(0, 20) + '）');
    assert(el(doc, 'rtCreateBtn').disabled, 'つながらないうちは押せない');
    click(doc, 'rtLobbyBackBtn');
    await waitScreen(win, doc, 'scr-howto', 3000);
    assertNoErrors(errors, '部屋の入り口で未捕捉の例外');
    win.close();
  });

  // ---- 第21弾 第3部：記録画面に detail を出す ----
  await r.test('記録：人狼の記録に、勝った陣営・ターン数・役職構成が出る', async () => {
    const { win, doc, errors } = await launch();
    win.confirm = () => true;
    win.alert = () => {};
    const players = ['あき', 'びび', 'ちか', 'でん', 'えみ'];
    await startWolfRole(win, doc, 'wolf-normal', players);

    // 決着まで回して記録を作る
    let g = 0;
    while (g++ < 200) {
      const cur = activeScreen(doc);
      if (cur === 'scr-nightfall') { passNightfall(doc); await sleep(win, 60); continue; }
      if (cur === 'scr-wr-pass') { await runWrHandoffs(win, doc, players.length); continue; }
      if (cur === 'scr-wr-day') { await holdPress(win, doc, 'wrToVoteBtn'); await sleep(win, 60); continue; }
      if (cur === 'scr-wr-gather') { click(doc, 'wrTallyBtn'); await sleep(win, 2600); continue; }
      if (cur === 'scr-wr-result') { click(doc, 'wrResultNextBtn'); await sleep(win, 120); continue; }
      if (cur === 'scr-score') break;
      await sleep(win, 60);
    }
    await waitScreen(win, doc, 'scr-score', 8000);
    await chooseNext(win, doc, 'shelf');
    await waitScreen(win, doc, 'scr-shelf', 6000);

    // 記録画面を開く
    click(doc, 'floatingGearBtn');
    await sleep(win, 100);
    click(doc, 'openRecordsBtn');
    await waitFor(win, () => doc.querySelectorAll('#recordsList .record-item').length > 0,
      6000, '記録が並ぶ');

    const item = doc.querySelector('#recordsList .record-item');
    const detail = item.querySelector('.record-detail');
    assert(detail, '結末の欄が出る');
    const txt = detail.textContent;
    assert(/陣営の勝ち|妖狐の勝ち/.test(txt), 'どちらが勝ったか分かる（' + txt.slice(0, 40) + '）');
    assert(/ターン/.test(txt), '何ターンで終わったか分かる');
    const roles = item.querySelector('.record-detail-roles');
    assert(roles, '役職構成が出る');
    assert(/人狼/.test(roles.textContent), '人狼が構成に含まれる（' + roles.textContent + '）');
    assert(/占い師|霊媒師|騎士|村人/.test(roles.textContent), '他の役職も出る');
    assertNoErrors(errors, '記録画面で未捕捉の例外');
    win.close();
  });

  // ---- 第21弾 第2部：恋人の手動選択 ----
  await r.test('恋人：手動で2人えらぶと、その2人が恋人になる', async () => {
    const { win, doc, errors } = await launch();
    const players = ['あき', 'びび', 'ちか', 'でん', 'えみ', 'ふう', 'げん', 'はな'];
    const cart = doc.querySelector('.cart[data-cart="jinro"]');
    cart.click();
    if (activeScreen(doc) === 'scr-shelf') cart.click();
    await waitScreen(win, doc, 'scr-game', 3000);
    pickGame(doc, 'wolfrole');
    await sleep(win, 60);
    await fillPlayerForm(win, doc, players);
    await waitScreen(win, doc, 'scr-mode', 3000);
    click(doc, doc.querySelector('.mode-card[data-id="wolf-chaos"]')); // 恋人ありのプリセット
    click(doc, 'modeNextBtn');
    await waitScreen(win, doc, 'scr-set-wolfrole', 3000);
    assert(el(doc, 'wrLoversToggle').classList.contains('on'), 'このプリセットは恋人あり');

    // 恋人ありなら「恋人の決め方」の画面が挟まる
    click(doc, doc.querySelector('#scr-set-wolfrole [data-wiz-next]'));
    await waitScreen(win, doc, 'scr-set-lovers', 3000);
    assertEqual(el(doc, 'wrLoversPickBox').style.display, 'none', '既定はランダム（選ぶ欄は出ない）');
    assert(/ランダム/.test(el(doc, 'wrLoversPickNote').textContent), 'ランダムだと分かる');

    click(doc, 'wrLoversPickToggle');
    await sleep(win, 60);
    assertEqual(el(doc, 'wrLoversPickBox').style.display, 'block', '手動にすると選ぶ欄が出る');
    assertEqual(el(doc, 'wrLoversCount').textContent, '0 / 2', '何人えらんだか分かる');
    assert(/2人えらんでください/.test(el(doc, 'wrLoversWarn').textContent), '足りないと促される');

    const chips = () => Array.from(doc.querySelectorAll('#wrLoversGrid .hp-chip'));
    chips()[0].click(); await sleep(win, 40);
    chips()[2].click(); await sleep(win, 40);
    assertEqual(el(doc, 'wrLoversCount').textContent, '2 / 2', '2人えらべる');
    assertEqual(el(doc, 'wrLoversWarn').textContent, '', '2人そろえば促されない');
    // 3人目は選べない（恋人は2人1組）
    chips()[4].click(); await sleep(win, 40);
    assertEqual(el(doc, 'wrLoversCount').textContent, '2 / 2', '3人目は選べない');
    // 選び直しはできる
    chips()[0].click(); await sleep(win, 40);
    assertEqual(el(doc, 'wrLoversCount').textContent, '1 / 2', 'もう一度押すと外れる');
    chips()[0].click(); await sleep(win, 40);

    const chosen = chips().filter(c => /💞/.test(c.textContent))
      .map(c => c.textContent.replace('💞', '').trim());
    assertEqual(chosen.length, 2, '2人が選ばれている');

    // 実際に配られた恋人が、選んだ2人と一致すること
    click(doc, doc.querySelector('#scr-set-lovers [data-wiz-next]'));
    await waitScreen(win, doc, 'scr-set-timer', 3000);
    if (el(doc, 'timerEnableToggle').classList.contains('on')) click(doc, 'timerEnableToggle');
    click(doc, doc.querySelector('#scr-set-timer [data-wiz-next]'));
    await sleep(win, 60);
    if (activeScreen(doc) === 'scr-mode-rules') { click(doc, 'rulesStartBtn'); await sleep(win, 60); }
    await waitScreen(win, doc, 'scr-ready', 3000);
    el(doc, 'holdBtn').dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true }));
    await waitScreen(win, doc, 'scr-wr-pass', 8000);

    const lovers = [];
    await runWrHandoffs(win, doc, players.length, (info) => {
      if (/恋人/.test(info.body)) lovers.push(info.name);
    });
    assertEqual(lovers.length, 2, '恋人は2人だけ');
    assertEqual(lovers.slice().sort().join(','), chosen.slice().sort().join(','),
      'えらんだ2人がそのまま恋人になる（えらんだ: ' + chosen + ' / 実際: ' + lovers + '）');
    assertNoErrors(errors, '恋人の手動選択で未捕捉の例外');
    win.close();
  });

  await r.test('恋人を使わないプリセットでは、恋人の画面を出さない', async () => {
    const { win, doc, errors } = await launch();
    await startWolfRole(win, doc, 'wolf-normal', ['あき', 'びび', 'ちか', 'でん', 'えみ'], () => {
      assert(!el(doc, 'wrLoversToggle').classList.contains('on'), 'このプリセットは恋人なし');
    });
    // ウィザードに恋人の画面が挟まらないまま、ゲームが始まっている
    assertNoErrors(errors, '恋人なしで未捕捉の例外');
    win.close();
  });

  // ---- 第21弾 第1部：夜の持ち時間 ----
  await r.test('夜の持ち時間：設定でき、時間切れで次の人に渡る', async () => {
    const { win, doc, errors } = await launch();
    const players = ['あき', 'びび', 'ちか', 'でん', 'えみ'];
    await startWolfRole(win, doc, 'wolf-normal', players, () => {
      // 既定はなし。＋で15秒ずつ増える
      assertEqual(el(doc, 'wrNightValue').textContent, 'なし', '既定は時間制限なし');
      const plus = doc.querySelector('#scr-set-wolfrole [data-wrnight="15"]');
      assert(plus, '夜の持ち時間を増やせる');
      plus.click();
      assertEqual(el(doc, 'wrNightValue').textContent, '15秒', '15秒刻みで増える');
      assert(/時間切れ/.test(el(doc, 'wrNightNote').textContent), '時間切れの扱いが説明される');
      const minus = doc.querySelector('#scr-set-wolfrole [data-wrnight="-15"]');
      minus.click();
      assertEqual(el(doc, 'wrNightValue').textContent, 'なし', '0未満にはならない');
      plus.click(); // 15秒で始める
    });

    // 役職確認では時間を計らない（考える必要が無く、急かす意味がない）
    assertEqual(el(doc, 'wrNightTimerRow').style.display, 'none', '手渡し画面ではまだ出ない');
    click(doc, 'wrRevealBtn');
    await sleep(win, 60);
    assertEqual(el(doc, 'wrNightTimerRow').style.display, 'none', '役職確認では出ない');
    click(doc, 'wrNextBtn');
    await sleep(win, 60);
    await runWrHandoffs(win, doc, players.length - 1); // 残りの役職確認

    // 夜：中身を見た瞬間からカウントが始まる
    passNightfall(doc);
    await waitScreen(win, doc, 'scr-wr-pass', 4000);
    assertEqual(el(doc, 'wrNightTimerRow').style.display, 'none', '手渡し中は計らない');
    click(doc, 'wrRevealBtn');
    await sleep(win, 60);
    assertEqual(el(doc, 'wrNightTimerRow').style.display, 'flex', '中身を見たら出る');
    const t0 = el(doc, 'wrNightTimer').textContent;
    assertEqual(t0, '00:15', '設定した秒数から始まる');
    await sleep(win, 1200);
    assert(el(doc, 'wrNightTimer').textContent !== t0, 'カウントが進む');

    // 時間切れ：何も選ばないまま次の人へ渡る
    const who = el(doc, 'wrContentName').textContent;
    // 残り時間を短くして、時間切れを待つ
    await waitFor(win, () => {
      const now = el(doc, 'wrHandoffName').textContent;
      return el(doc, 'wrHandoff').style.display !== 'none' && now !== who;
    }, 20000, '時間切れで次の人に渡る');
    assertEqual(el(doc, 'wrNightTimerRow').style.display, 'none', '渡したら止まる');
    assertNoErrors(errors, '夜の持ち時間で未捕捉の例外');
    win.close();
  });

  // ---- 第20弾 第10部：複数ウルフ時の投票回数 ----
  // ワードウルフを、ウルフ人数を指定して話し合いまで進める。
  // 誰がウルフかは、配られたお題の少数派から割り出す。
  async function startWordwolfWithWolves(win, doc, players, wolfCount) {
    const cart = doc.querySelector('.cart[data-cart="jinro"]');
    cart.click();
    if (activeScreen(doc) === 'scr-shelf') cart.click();
    await waitScreen(win, doc, 'scr-game', 3000);
    pickGame(doc, 'wordwolf');
    await sleep(win, 60);
    await fillPlayerForm(win, doc, players);
    await waitScreen(win, doc, 'scr-mode', 3000);
    click(doc, doc.querySelector('.mode-card[data-id="wordwolf"]'));
    click(doc, 'modeNextBtn');
    await waitScreen(win, doc, 'scr-set-wolf', 3000);
    const sl = el(doc, 'wolfCountSlider');
    sl.value = String(wolfCount);
    sl.dispatchEvent(new win.Event('input', { bubbles: true }));
    assertEqual(el(doc, 'wolfCountValue').textContent, String(wolfCount), 'ウルフの人数を設定できる');
    for (let i = 0; i < 8; i++) {
      const cur = activeScreen(doc);
      if (cur === 'scr-ready' || cur === 'scr-mode-rules') break;
      if (cur === 'scr-set-timer' && el(doc, 'timerEnableToggle').classList.contains('on')) {
        click(doc, 'timerEnableToggle'); await sleep(win, 30);
      }
      const next = doc.querySelector('#' + cur + ' [data-wiz-next]');
      if (!next) break;
      next.click(); await sleep(win, 35);
    }
    if (activeScreen(doc) === 'scr-mode-rules') { click(doc, 'rulesStartBtn'); await sleep(win, 60); }
    await waitScreen(win, doc, 'scr-ready', 3000);
    el(doc, 'holdBtn').dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true }));
    await waitScreen(win, doc, 'scr-wolf-pass', 8000);

    const topicOf = {};
    for (let i = 0; i < players.length; i++) {
      if (activeScreen(doc) !== 'scr-wolf-pass') break;
      const who = el(doc, 'wolfHandoffName').textContent.trim();
      click(doc, 'wolfRevealBtn'); await sleep(win, 35);
      topicOf[who] = el(doc, 'wolfTopicText').textContent.trim();
      click(doc, 'wolfNextRevealBtn'); await sleep(win, 45);
    }
    const counts = {};
    Object.keys(topicOf).forEach(n => { counts[topicOf[n]] = (counts[topicOf[n]] || 0) + 1; });
    const minTopic = Object.keys(counts).sort((a, b) => counts[a] - counts[b])[0];
    const wolves = Object.keys(topicOf).filter(n => topicOf[n] === minTopic);
    await waitScreen(win, doc, 'scr-play', 5000);
    await holdPress(win, doc, 'wolfDiscussBtn');
    await waitScreen(win, doc, 'scr-wolf-pass', 6000);
    return wolves;
  }

  // 投票を1周ぶん流す。pick は (投票する人, ボタン配列) => 押すボタン
  async function wolfVotePass(win, doc, pick) {
    const voters = [];
    let g = 0;
    while (activeScreen(doc) === 'scr-wolf-pass' && g++ < 20) {
      const who = el(doc, 'wolfHandoffName').textContent.trim();
      voters.push(who);
      click(doc, 'wolfRevealBtn'); await sleep(win, 35);
      const c = Array.from(doc.querySelectorAll('#wolfVoteGrid button'));
      if (!c.length) break;
      (pick(who, c) || c[0]).click();
      await sleep(win, 45);
    }
    await waitScreen(win, doc, 'scr-wolf-gather', 5000);
    click(doc, 'wolfTallyBtn');
    // 第23弾-1：同数だと決選投票の1周が挟まる。その周も同じ選び方で流す
    await waitFor(win, () => ['scr-wolf-result', 'scr-wolf-pass'].indexOf(activeScreen(doc)) >= 0,
      8000, '結果 または 決選投票');
    if (activeScreen(doc) === 'scr-wolf-pass') {
      let g2 = 0;
      while (activeScreen(doc) === 'scr-wolf-pass' && g2++ < 20) {
        const who = el(doc, 'wolfHandoffName').textContent.trim();
        click(doc, 'wolfRevealBtn'); await sleep(win, 35);
        const c = Array.from(doc.querySelectorAll('#wolfVoteGrid button'));
        if (!c.length) break;
        (pick(who, c) || c[0]).click();
        await sleep(win, 45);
      }
      await waitScreen(win, doc, 'scr-wolf-gather', 5000);
      click(doc, 'wolfTallyBtn');
      await waitScreen(win, doc, 'scr-wolf-result', 8000);
    }
    return voters;
  }

  await r.test('ウルフが1人なら、投票は今までどおり1回で終わる', async () => {
    const { win, doc, errors } = await launch();
    const players = ['あき', 'びび', 'ちか', 'でん', 'えみ'];
    const wolves = await startWordwolfWithWolves(win, doc, players, 1);
    assertEqual(wolves.length, 1, 'ウルフは1人');
    await wolfVotePass(win, doc, (who, c) => c[0]);
    assert(!/つぎの投票/.test(el(doc, 'wolfResultNextBtn').textContent),
      '投票をくり返さない（' + el(doc, 'wolfResultNextBtn').textContent + '）');
    assert(/シープ🐑のお題/.test(el(doc, 'wolfResultTopics').textContent), 'そのまま結果が出る');
    assertNoErrors(errors, 'ウルフ1人で未捕捉の例外');
    win.close();
  });

  await r.test('ウルフが2人なら、全員あぶり出すまで投票をくり返す', async () => {
    const { win, doc, errors } = await launch();
    const players = ['あき', 'びび', 'ちか', 'でん', 'えみ', 'ふう', 'げん'];
    const wolves = await startWordwolfWithWolves(win, doc, players, 2);
    assertEqual(wolves.length, 2, 'ウルフは2人');

    // シープは生きているウルフに投票し、ウルフはシープに逃げる
    const toWolf = (who, c) => {
      if (wolves.indexOf(who) !== -1) return c.find(b => wolves.indexOf(b.textContent.trim()) === -1);
      return c.find(b => wolves.indexOf(b.textContent.trim()) !== -1);
    };

    const v1 = await wolfVotePass(win, doc, toWolf);
    assertEqual(v1.length, players.length, '1回目は全員が投票する');
    assertEqual(el(doc, 'wolfResultNextBtn').textContent, 'つぎの投票へ ▶', 'もう一度投票する');
    assert(/1回目の投票/.test(el(doc, 'wolfResultTopics').textContent), '何回目か分かる');
    assert(/ウルフでした/.test(el(doc, 'wolfResultTopics').textContent), '処刑された人の正体が分かる');
    assert(/のこりのウルフ🐺 1人/.test(el(doc, 'wolfResultTopics').textContent), '残りの人数が分かる');
    // まだ決着していないので、お題は伏せたまま
    assert(!/シープ🐑のお題/.test(el(doc, 'wolfResultTopics').textContent), '途中でお題は明かさない');

    click(doc, 'wolfResultNextBtn');
    await waitScreen(win, doc, 'scr-wolf-pass', 5000);
    const v2 = await wolfVotePass(win, doc, toWolf);
    assertEqual(v2.length, players.length - 1, '処刑された人は投票に加わらない');
    const res = el(doc, 'wolfResultTopics').textContent;
    assert(/シープ🐑側の勝ち/.test(res), 'ウルフを全員あぶり出せば村人側の勝ち');
    assert(/シープ🐑のお題/.test(res), '決着したのでお題が明かされる');
    assertEqual(el(doc, 'wolfResultNextBtn').textContent, 'つぎへ', 'ボタンが元に戻る');
    assertNoErrors(errors, 'ウルフ2人で未捕捉の例外');
    win.close();
  });

  await r.test('ウルフを当てられないまま回数を使い切ると、ウルフ側の勝ち', async () => {
    const { win, doc, errors } = await launch();
    const players = ['あき', 'びび', 'ちか', 'でん', 'えみ', 'ふう', 'げん'];
    const wolves = await startWordwolfWithWolves(win, doc, players, 2);
    // 全員がシープに投票し続ける＝ウルフは1人も処刑されない
    const toSheep = (who, c) => c.find(b => wolves.indexOf(b.textContent.trim()) === -1) || c[0];

    await wolfVotePass(win, doc, toSheep);
    assertEqual(el(doc, 'wolfResultNextBtn').textContent, 'つぎの投票へ ▶', '2回目がある');
    click(doc, 'wolfResultNextBtn');
    await waitScreen(win, doc, 'scr-wolf-pass', 5000);
    await wolfVotePass(win, doc, toSheep);

    const res = el(doc, 'wolfResultTopics').textContent;
    assert(/ウルフ側の勝ち/.test(res), '回数を使い切ったらウルフ側の勝ち（' + res.slice(0, 30) + '）');
    assert(!/つぎの投票/.test(el(doc, 'wolfResultNextBtn').textContent), 'これ以上は投票しない');
    assertNoErrors(errors, '逃げ切りで未捕捉の例外');
    win.close();
  });

  await r.test('ウルフを当てられないまま回数を使い切ると、必ず止まる（ウルフ側の勝ち）', async () => {
    // 指示17改訂で決めた「決着しなければウルフ側の勝ち」というフェイルセーフ。
    // 第23弾-1で同数のときに決選投票が挟まるようになったので、
    // それでも無限に投票し続けず、必ず打ち切られることをここで固定する。
    const { win, doc, errors } = await launch();
    const players = ['あき', 'びび', 'ちか', 'でん', 'えみ', 'ふう', 'げん'];
    const wolves = await startWordwolfWithWolves(win, doc, players, 2);
    assertEqual(wolves.length, 2, 'ウルフは2人');

    // 誰もウルフに入れない＝ウルフは最後まで生き残る。
    // 誰が吊られるかは回によって変わるので、シープの中から順に選ぶ
    const avoidWolves = (who, c) => {
      const sheep = c.filter(b => wolves.indexOf(b.textContent.trim()) === -1);
      const pool = sheep.length ? sheep : c;
      return pool[players.indexOf(who) % pool.length];
    };

    await wolfVotePass(win, doc, avoidWolves);
    let res = el(doc, 'wolfResultTopics').textContent;
    assert(/のこりのウルフ🐺 2人/.test(res), '1回目でウルフは減っていない（' + res.slice(0, 60) + '）');
    assertEqual(el(doc, 'wolfResultNextBtn').textContent, 'つぎの投票へ ▶', '回数はまだ残っている');

    click(doc, 'wolfResultNextBtn');
    await waitScreen(win, doc, 'scr-wolf-pass', 5000);
    await wolfVotePass(win, doc, avoidWolves);

    res = el(doc, 'wolfResultTopics').textContent;
    assert(/ウルフ側の勝ち/.test(res), '回数を使い切ったらウルフ側の勝ち（' + res.slice(0, 60) + '）');
    assert(!/つぎの投票/.test(el(doc, 'wolfResultNextBtn').textContent), 'ここで必ず止まる（無限に投票しない）');
    assert(/シープ🐑のお題/.test(res), '決着したのでお題が明かされる');
    assertNoErrors(errors, '決選投票をはさんでも打ち切られること');
    win.close();
  });

  // ---- 第20弾 第9部：プリセットの再編 ----
  await r.test('プリセット：全部のせ人狼とカオス人狼（闇鍋）が別々に並ぶ', async () => {
    const { win, doc, errors } = await launch();
    const cart = doc.querySelector('.cart[data-cart="jinro"]');
    cart.click();
    if (activeScreen(doc) === 'scr-shelf') cart.click();
    await waitScreen(win, doc, 'scr-game', 3000);
    pickGame(doc, 'wolfrole');
    await sleep(win, 60);
    await fillPlayerForm(win, doc, ['あ', 'い', 'う', 'え', 'お', 'か', 'き', 'く', 'け']);
    await waitScreen(win, doc, 'scr-mode', 3000);

    const title = id => doc.querySelector('.mode-card[data-id="' + id + '"] .m-title').textContent;
    assertEqual(title('wolf-chaos'), '全部のせ人狼', '元のカオス人狼は名前だけ変わった');
    assertEqual(title('wolf-yaminabe'), 'カオス人狼', '新しいカオス人狼が入った');
    // 記録との整合：中身を持つidは変えていない
    const ids = Array.from(doc.querySelectorAll('#modeCards .mode-card')).map(c => c.dataset.id);
    assert(ids.indexOf('wolf-chaos') >= 0, '既存のidは残っている（過去の記録が迷子にならない）');
    assertNoErrors(errors, 'プリセット一覧で未捕捉の例外');
    win.close();
  });

  await r.test('カオス人狼（闇鍋）を選ぶと、ただの村人は多くても1人になる', async () => {
    const { win, doc, errors } = await launch();
    const players = ['あ', 'い', 'う', 'え', 'お', 'か', 'き', 'く'];
    const cart = doc.querySelector('.cart[data-cart="jinro"]');
    cart.click();
    if (activeScreen(doc) === 'scr-shelf') cart.click();
    await waitScreen(win, doc, 'scr-game', 3000);
    pickGame(doc, 'wolfrole');
    await sleep(win, 60);
    await fillPlayerForm(win, doc, players);
    await waitScreen(win, doc, 'scr-mode', 3000);
    click(doc, doc.querySelector('.mode-card[data-id="wolf-yaminabe"]'));
    click(doc, 'modeNextBtn');
    await waitScreen(win, doc, 'scr-set-wolfrole', 3000);

    assert(/闇鍋|全員が役職/.test(doc.getElementById('scr-set-wolfrole').textContent),
      '「全員が役職あり（闇鍋）」と出る');

    // そのまま始めて、全員に村人でない役職が配られること
    click(doc, doc.querySelector('#scr-set-wolfrole [data-wiz-next]'));
    await waitScreen(win, doc, 'scr-set-timer', 3000);
    if (el(doc, 'timerEnableToggle').classList.contains('on')) click(doc, 'timerEnableToggle');
    click(doc, doc.querySelector('#scr-set-timer [data-wiz-next]'));
    await sleep(win, 60);
    if (activeScreen(doc) === 'scr-mode-rules') { click(doc, 'rulesStartBtn'); await sleep(win, 60); }
    await waitScreen(win, doc, 'scr-ready', 3000);
    el(doc, 'holdBtn').dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true }));
    await waitScreen(win, doc, 'scr-wr-pass', 8000);

    const roles = [];
    await runWrHandoffs(win, doc, players.length, (info) => { roles.push(info.body); });
    assertEqual(roles.length, players.length, '全員に配られる');
    // 闇鍋は「ごく稀に、ただの村人が1人だけ紛れる」仕様（第22弾-3・CHAOS_VILLAGER_CHANCE）。
    // 「村人が0人」と決め打つと、その抽選を引いた回だけ落ちる。
    // 落ちる原因が本物の不具合か抽選かを見分けられないテストは、あっても信用できない。
    // ルールどおり「多くても1人」で固定する（全員村人なら、それは本物の不具合）
    const villagers = roles.filter(b => /あなたの役職\s*村人/.test(b.replace(/\s+/g, ' ')));
    assert(villagers.length <= 1,
      'ただの村人は多くても1人（実際: ' + villagers.length + '人）');
    assertNoErrors(errors, '闇鍋で未捕捉の例外');
    win.close();
  });

  // ---- 第20弾 第8部：役職ありワードウルフをカードにする ----
  // ワードウルフのモード選択まで進む
  async function toWordwolfModes(win, doc, players) {
    const cart = doc.querySelector('.cart[data-cart="jinro"]');
    cart.click();
    if (activeScreen(doc) === 'scr-shelf') cart.click();
    await waitScreen(win, doc, 'scr-game', 3000);
    pickGame(doc, 'wordwolf');
    await sleep(win, 60);
    await fillPlayerForm(win, doc, players);
    await waitScreen(win, doc, 'scr-mode', 3000);
  }

  await r.test('役職ありワードウルフが、独立したカードとして並ぶ', async () => {
    const { win, doc, errors } = await launch();
    await toWordwolfModes(win, doc, ['あき', 'びび', 'ちか', 'でん', 'えみ', 'ふう', 'げん']);
    const ids = Array.from(doc.querySelectorAll('#modeCards .mode-card')).map(c => c.dataset.id);
    ['wordwolf', 'wordwolf-multi', 'wordwolf-peek', 'wordwolf-trick', 'wordwolf-seer']
      .forEach(id => assert(ids.indexOf(id) >= 0, id + ' が並ぶ'));
    assert(ids.every(id => /^wordwolf/.test(id)), '人狼側のカードは混ざらない（' + ids.join(',') + '）');
    assertNoErrors(errors, 'カード一覧で未捕捉の例外');
    win.close();
  });

  await r.test('カードを選んだ瞬間、人数に合った役職が入っている', async () => {
    const { win, doc, errors } = await launch();
    await toWordwolfModes(win, doc, ['あき', 'びび', 'ちか', 'でん', 'えみ', 'ふう', 'げん']);

    // かき乱し（3役職）を選んでウィザードへ
    click(doc, doc.querySelector('.mode-card[data-id="wordwolf-trick"]'));
    click(doc, 'modeNextBtn');
    await waitScreen(win, doc, 'scr-set-wolf', 3000);
    const val = id => el(doc, 'wwCount-' + id).textContent;
    assertEqual(val('peek'), '1', 'のぞき見役が入っている');
    assertEqual(val('fake'), '1', 'にせもの役が入っている');
    assertEqual(val('involve'), '1', 'まきこみ役が入っている');
    assert(/役職 3人/.test(el(doc, 'wolfRoleNote').textContent), '注記も合っている');

    // 役職なしのカードに戻すと、前の配分が残らない
    click(doc, doc.querySelector('#scr-set-wolf [data-wiz-back]'));
    await waitScreen(win, doc, 'scr-mode', 3000);
    click(doc, doc.querySelector('.mode-card[data-id="wordwolf"]'));
    click(doc, 'modeNextBtn');
    await waitScreen(win, doc, 'scr-set-wolf', 3000);
    assertEqual(val('peek'), '0', '前のカードの役職を持ち越さない');
    assert(/役職なし/.test(el(doc, 'wolfRoleNote').textContent), 'いつものワードウルフに戻る');
    assertNoErrors(errors, 'カード切り替えで未捕捉の例外');
    win.close();
  });

  await r.test('人数が足りない役職カードは、選べないようにする', async () => {
    const { win, doc, errors } = await launch();
    await toWordwolfModes(win, doc, ['あき', 'びび', 'ちか']); // 3人
    const locked = id => doc.querySelector('.mode-card[data-id="' + id + '"]').classList.contains('locked');
    assert(!locked('wordwolf'), 'いつものワードウルフは3人でも遊べる');
    assert(locked('wordwolf-peek'), 'のぞき見（4人〜）は選べない');
    assert(locked('wordwolf-trick'), 'かき乱し（6人〜）は選べない');
    assert(locked('wordwolf-seer'), '占い（5人〜）は選べない');
    assertNoErrors(errors, '人数制限で未捕捉の例外');
    win.close();
  });

  await r.test('人数が少ないと、入りきらない役職は自動で落とす', async () => {
    // 村人が1人も残らない配分にしないこと（かき乱しは3役職だが、6人だと全部は入らない）
    const { win, doc, errors } = await launch();
    await toWordwolfModes(win, doc, ['あき', 'びび', 'ちか', 'でん', 'えみ', 'ふう']); // 6人
    click(doc, doc.querySelector('.mode-card[data-id="wordwolf-trick"]'));
    click(doc, 'modeNextBtn');
    await waitScreen(win, doc, 'scr-set-wolf', 3000);
    const n = ['peek', 'fake', 'involve']
      .reduce((s, id) => s + parseInt(el(doc, 'wwCount-' + id).textContent, 10), 0);
    // 6人・ウルフ1人なら、村人を1人残すと役職は4人まで入る
    assert(n >= 1 && n <= 4, '人数に収まる配分になる（役職' + n + '人）');
    assert(n + 1 + 1 <= 6, 'ウルフと村人のぶんが残っている');
    assertNoErrors(errors, '自動配分で未捕捉の例外');
    win.close();
  });

  // ---- 第20弾 第7部：テーマ範囲とフォント ----
  await r.test('フォント：筆文字は大きな一行の演出だけ、実用テキストには使わない', async () => {
    // 読みやすさが未検証の書体を、頻繁に読む文字に使わないための歯止め
    const fs = require('fs');
    const path = require('path');
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const css = html.slice(html.indexOf('<style>') + 7, html.indexOf('</style>'));

    assert(/Yuji\+Syuku/.test(html), 'Yuji Syuku を読み込んでいる');

    // Yuji Syuku を指定しているセレクタを全部集める
    const users = [];
    css.replace(/([^{}]+)\{([^{}]*)\}/g, (m, sel, body) => {
      if (/Yuji Syuku/.test(body)) users.push(sel.trim().replace(/\s+/g, ' '));
      return m;
    });
    assert(users.length > 0, '実際に使われている');
    users.forEach(sel => {
      assert(/\.theme-wolf/.test(sel), '人狼カセットの外では使わない（' + sel + '）');
    });
    // 演出テキスト以外に混ざっていないか、名指しで確かめる
    const allowed = ['.nf-title', '.fx-word', '#wrResultTitle', '.scr-title', '.big-main'];
    users.forEach(sel => {
      assert(allowed.some(a => sel.indexOf(a) >= 0),
        '演出テキスト以外には使わない（' + sel + '）');
    });
    // 役職名・お題・手渡しの名前など、よく読む文字には入っていないこと
    ['.wolf-topic-name', '.wolf-handoff-name', '.mic-status', '.pk-btn', '.mode-card']
      .forEach(k => {
        assert(!users.some(sel => sel.indexOf(k) >= 0), k + ' には筆文字を使わない');
      });
    // 数字は桁が揃う書体のままにする
    assert(/\.app\.theme-wolf[^{]*\.play-timer[^{]*\{[^}]*DotGothic16/.test(css.replace(/\s+/g, ' ')),
      'タイマーの数字は DotGothic16 のまま');
    // 部屋コードは「読んで入力する文字」なので筆文字にしない
    assert(/\.big-main\.is-code\s*\{[^}]*DotGothic16/.test(css.replace(/\s+/g, ' ')),
      '部屋コードは桁の揃う書体で出す');
    users.forEach(sel => {
      assert(!/\.big-main(?!:not)/.test(sel) || /:not\(\.is-code\)/.test(sel),
        '大画面の見出しは、コード表示のときは筆文字を外す（' + sel + '）');
    });
  });

  // ---- 第20弾 第6部：最終ターンの2段階表示 ----
  await r.test('最終ターンは、投票結果を見てから最終結果に進む', async () => {
    const { win, doc, errors } = await launch();
    const players = ['あき', 'びび', 'ちか', 'でん', 'えみ'];
    // ターン数1にすれば、その1回の投票が必ず最終ターンになる
    await startWolfRole(win, doc, 'wolf-casual', players, () => {
      const m = doc.querySelector('#scr-set-wolfrole [data-wrturn="-1"]');
      for (let i = 0; i < 8; i++) m.click();
      assertEqual(el(doc, 'wrTurnValue').textContent, '1', 'ターン数を1にする');
    });
    await runWrHandoffs(win, doc, players.length); // 役職確認
    await runWrHandoffs(win, doc, players.length); // 投票前の単発行動
    await runWrHandoffs(win, doc, players.length); // 投票
    await waitScreen(win, doc, 'scr-wr-gather', 5000);
    click(doc, 'wrTallyBtn');
    await waitScreen(win, doc, 'scr-wr-result', 8000);

    // 1段目：そのターンの投票結果
    const title1 = el(doc, 'wrResultTitle').textContent;
    assert(/日目の結果/.test(title1), 'まずターンの結果が出る（' + title1 + '）');
    assert(!/決着/.test(title1), 'いきなり決着画面にはしない');
    const summary1 = el(doc, 'wrResultSummary').textContent;
    assert(/処刑されました|誰も処刑されませんでした/.test(summary1), '誰が処刑されたか分かる');
    assert(el(doc, 'wrResultSummary').querySelector('.vote-counts'),
      '最後の投票でも票数が見られる（ここが今回直したところ）');
    assertEqual(el(doc, 'wrResultNextBtn').textContent, '結果を見る ▶',
      '次に進むボタンが「結果を見る」になる');

    // 2段目：試合全体の決着
    click(doc, 'wrResultNextBtn');
    await sleep(win, 120);
    assertEqual(el(doc, 'wrResultTitle').textContent, '決着！', '押すと最終結果になる');
    assert(/勝ち|決着/.test(el(doc, 'wrResultSummary').textContent), '勝った陣営が出る');
    assert(el(doc, 'wrResultList').textContent.length > 0, '全員の役職と結果が並ぶ');
    assertEqual(el(doc, 'wrResultNextBtn').textContent, 'スコアへ ▶', '最後はスコアへ');

    click(doc, 'wrResultNextBtn');
    await waitScreen(win, doc, 'scr-score', 5000);
    assertNoErrors(errors, '最終ターンの2段階表示で未捕捉の例外');
    win.close();
  });

  await r.test('決着していないターンは、今までどおり次の夜へ進む', async () => {
    const { win, doc, errors } = await launch();
    const players = ['あき', 'びび', 'ちか', 'でん', 'えみ', 'ふう', 'げん'];
    await startWolfRole(win, doc, 'wolf-normal', players); // ターン数5
    await playOneWolfTurn(win, doc, players);
    await waitScreen(win, doc, 'scr-wr-gather', 5000);
    click(doc, 'wrTallyBtn');
    await waitScreen(win, doc, 'scr-wr-result', 8000);
    assertEqual(el(doc, 'wrResultNextBtn').textContent, 'つぎの夜へ ▶', '決着前は次の夜へ');
    click(doc, 'wrResultNextBtn');
    await waitScreen(win, doc, 'scr-nightfall', 5000);
    assert(/夜になりました/.test(el(doc, 'scr-nightfall').textContent), '次の夜が始まる');
    assertNoErrors(errors, '通常ターンの進行で未捕捉の例外');
    win.close();
  });

  // ---- 第20弾 第5部：情報表示の充実 ----
  // 人狼を1ターン進めて、投票直前に各自が見る画面を集める。
  //
  // 役職はランダムに配られるので、そのまま流すと「騎士が夜に死んで守りの結果が出ない」
  // 「1ターン目で決着して結果画面に届かない」といった揺れでテストが不安定になる。
  // 役職確認の画面から誰が何かを読み取り、夜の狙いをこちらで決めて固定する。
  async function playOneWolfTurn(win, doc, players) {
    const roleOf = {};
    await runWrHandoffs(win, doc, players.length, (info) => {
      const m = /あなたの役職\s*(\S+?)(?:夜|昼|前の|特別|話し合い|人狼の味方|どちら)/.exec(
        info.body.replace(/\s+/g, ''));
      roleOf[info.name] = m ? m[1] : info.body.replace(/\s+/g, '').slice(5, 9);
    });

    // 人狼が狙う相手＝役職を持たない村人（騎士や占い師を落とさない）
    const villager = players.find(n => /村人/.test(roleOf[n] || ''));
    await runWrHandoffs(win, doc, players.length, null, (name, choices) => {
      const role = roleOf[name] || '';
      // 人狼も騎士も同じ村人を選ぶ → 守りが働き、騎士は生き残る
      if (/人狼|騎士/.test(role)) {
        return choices.find(b => b.textContent.trim() === villager) || choices[0];
      }
      // 占い師などは、その村人以外を選ぶ（呪殺で人数が減るのを避ける）
      return choices.find(b => b.textContent.trim() !== villager) || choices[0];
    });

    await waitScreen(win, doc, 'scr-wr-day', 6000);
    await holdPress(win, doc, 'wrToVoteBtn');
    await waitScreen(win, doc, 'scr-wr-pass', 5000);
    const voteScreens = [];
    for (let i = 0; i < players.length; i++) {
      if (activeScreen(doc) !== 'scr-wr-pass') break;
      click(doc, 'wrRevealBtn');
      await sleep(win, 40);
      voteScreens.push(el(doc, 'wrContentBody').textContent);
      const c = Array.from(doc.querySelectorAll('#wrChoiceGrid button[data-choice]'));
      // 人狼を吊ると1ターン目で決着してしまい、ターンの結果画面に届かない。
      // 確かめたいのは結果画面の中身なので、村人に票を集めてゲームを続かせる。
      if (c.length) {
        const safe = c.find(b => /村人/.test(roleOf[b.textContent.trim()] || ''));
        (safe || c[0]).click();
      } else click(doc, 'wrNextBtn');
      await sleep(win, 45);
    }
    return { voteScreens, roleOf };
  }

  await r.test('騎士は、自分の守りが働いたかどうかを知れる', async () => {
    const { win, doc, errors } = await launch();
    const players = ['あき', 'びび', 'ちか', 'でん', 'えみ', 'ふう', 'げん'];
    await startWolfRole(win, doc, 'wolf-normal', players); // 騎士が入る構成
    const { voteScreens: seen } = await playOneWolfTurn(win, doc, players);
    const all = seen.join('\n');
    assert(/守りの結果/.test(all), '騎士に守りの結果が出る');
    assert(/守りきりました|襲われませんでした/.test(all), '守れたかどうかが言葉で分かる');
    // 守りの結果を見るのは1人だけ（他の人に漏れていない）
    const guards = seen.filter(s => /守りの結果/.test(s));
    assertEqual(guards.length, 1, '守りの結果を見るのは騎士だけ（' + guards.length + '人）');
    assertNoErrors(errors, '守りの結果表示で未捕捉の例外');
    win.close();
  });

  await r.test('投票の票数は、設定で出し分けられる', async () => {
    // 1ターン目で決着するとターンの結果画面に届かないので、人数に余裕をもたせる
    const players = ['あき', 'びび', 'ちか', 'でん', 'えみ', 'ふう', 'げん'];

    // 既定はON：誰に何票入ったかが出る
    {
      const { win, doc, errors } = await launch();
      await startWolfRole(win, doc, 'wolf-casual', players, () => {
        assert(el(doc, 'wrShowVotesToggle').classList.contains('on'), '既定はON');
      });
      await playOneWolfTurn(win, doc, players);
      await waitScreen(win, doc, 'scr-wr-gather', 5000);
      click(doc, 'wrTallyBtn');
      await waitScreen(win, doc, 'scr-wr-result', 8000);
      const box = el(doc, 'wrResultSummary');
      assert(box.querySelector('.vote-counts'), '票数が出る');
      assert(box.querySelectorAll('.vc-item').length >= 1, '名前と票数の組が並ぶ');
      assertNoErrors(errors, '票数表示で未捕捉の例外');
      win.close();
    }

    // OFFにすると出ない
    {
      const { win, doc, errors } = await launch();
      await startWolfRole(win, doc, 'wolf-casual', players, () => {
        click(doc, 'wrShowVotesToggle');
        assert(!el(doc, 'wrShowVotesToggle').classList.contains('on'), 'OFFにできる');
      });
      await playOneWolfTurn(win, doc, players);
      await waitScreen(win, doc, 'scr-wr-gather', 5000);
      click(doc, 'wrTallyBtn');
      await waitScreen(win, doc, 'scr-wr-result', 8000);
      assert(!el(doc, 'wrResultSummary').querySelector('.vote-counts'), 'OFFなら票数は出さない');
      assert(/処刑されました|誰も処刑されませんでした/.test(el(doc, 'wrResultSummary').textContent),
        '結果そのものは出る');
      assertNoErrors(errors, '票数OFFで未捕捉の例外');
      win.close();
    }
  });

  await r.test('結果画面に、脱落した原因と何日目かが出る', async () => {
    const { win, doc, errors } = await launch();
    const players = ['あき', 'びび', 'ちか', 'でん', 'えみ', 'ふう', 'げん'];
    await startWolfRole(win, doc, 'wolf-normal', players);
    await playOneWolfTurn(win, doc, players);
    await waitScreen(win, doc, 'scr-wr-gather', 5000);
    click(doc, 'wrTallyBtn');
    await waitScreen(win, doc, 'scr-wr-result', 8000);

    const rows = Array.from(doc.querySelectorAll('#wrResultList .reveal-row'));
    assertEqual(rows.length, players.length, '全員ぶん並ぶ');
    const dead = rows.filter(rw => /💀/.test(rw.textContent));
    assert(dead.length >= 1, '誰かは欠けている');
    dead.forEach(rw => {
      assert(/処刑|襲撃|呪殺|後追い/.test(rw.textContent),
        '原因が分かる（' + rw.textContent.replace(/\s+/g, ' ').trim() + '）');
      assert(/日目/.test(rw.textContent), '何日目かも分かる');
    });
    assert(rows.filter(rw => !/💀/.test(rw.textContent)).every(rw => /生存/.test(rw.textContent)),
      '生きている人は「生存」のまま');
    assertNoErrors(errors, '脱落原因の表示で未捕捉の例外');
    win.close();
  });

  // ---- 第20弾 第4部：夜・朝の画面 ----
  await r.test('夜は「押すまで進まない」画面になり、ターン数が大きく出る', async () => {
    const { win, doc, errors } = await launch();
    const players = ['あき', 'びび', 'ちか', 'でん', 'えみ'];
    await startWolfRole(win, doc, 'wolf-casual', players); // ターン数3のプリセット

    // 役職確認を全員ぶん流すと、夜の入り口で止まる
    for (let i = 0; i < players.length; i++) {
      click(doc, 'wrRevealBtn'); await sleep(win, 30);
      click(doc, 'wrNextBtn'); await sleep(win, 45);
    }
    await waitScreen(win, doc, 'scr-nightfall', 4000);

    assert(/夜になりました/.test(el(doc, 'scr-nightfall').textContent), '「夜になりました」が出る');
    assert(/全員伏せてください/.test(el(doc, 'scr-nightfall').textContent), '「全員伏せてください」が出る');
    assertEqual(el(doc, 'nfTurn').style.display, 'block', 'ターン数の欄が出る');
    assertEqual(el(doc, 'nfTurnLabel').textContent, '全3ターン中', '全体のターン数が分かる');
    assert(/1 \/ 3/.test(el(doc, 'nfTurnBig').textContent), 'いま何ターン目かが分かる');
    assert(!/最終ターン/.test(el(doc, 'nfTurnBig').textContent), '1ターン目はまだ最終ではない');
    assert(el(doc, 'app').classList.contains('phase-night'), '夜の配色になる');

    // 押すまで進まない（時間が経っても勝手に動かない）
    await sleep(win, 900);
    assertEqual(activeScreen(doc), 'scr-nightfall', '自動では進まない');
    click(doc, 'nfNextBtn');
    await waitScreen(win, doc, 'scr-wr-pass', 4000);
    assertEqual(activeScreen(doc), 'scr-wr-pass', '「つぎへ」で手渡しが始まる');
    assertNoErrors(errors, '夜の入り口で未捕捉の例外');
    win.close();
  });

  await r.test('ワードウルフでも、お題を配る前に伏せる画面が出る', async () => {
    const { win, doc, errors } = await launch();
    const cart = doc.querySelector('.cart[data-cart="jinro"]');
    cart.click();
    if (activeScreen(doc) === 'scr-shelf') cart.click();
    await waitScreen(win, doc, 'scr-game', 3000);
    pickGame(doc, 'wordwolf');
    await sleep(win, 60);
    await fillPlayerForm(win, doc, PLAYERS);
    await waitScreen(win, doc, 'scr-mode', 3000);
    click(doc, doc.querySelector('.mode-card[data-id="wordwolf"]'));
    click(doc, 'modeNextBtn');
    await sleep(win, 60);
    for (let i = 0; i < 8; i++) {
      const cur = activeScreen(doc);
      if (cur === 'scr-ready' || cur === 'scr-mode-rules') break;
      const next = doc.querySelector('#' + cur + ' [data-wiz-next]');
      if (!next) break;
      next.click(); await sleep(win, 30);
    }
    if (activeScreen(doc) === 'scr-mode-rules') { click(doc, 'rulesStartBtn'); await sleep(win, 60); }
    await waitScreen(win, doc, 'scr-ready', 3000);
    el(doc, 'holdBtn').dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true }));
    await waitScreen(win, doc, 'scr-nightfall', 8000);
    assert(/全員伏せてください/.test(el(doc, 'scr-nightfall').textContent), 'ワードウルフでも出る');
    // 1ターンしかない遊び方では、数字を出しても意味が無い
    assertEqual(el(doc, 'nfTurn').style.display, 'none', '1ターンならターン数は出さない');
    click(doc, 'nfNextBtn');
    await waitScreen(win, doc, 'scr-wolf-pass', 4000);
    assertNoErrors(errors, 'ワードウルフの夜の入り口で未捕捉の例外');
    win.close();
  });

  await r.test('朝は明るい配色になり、欠けた人が目立つ形で出る', async () => {
    const { win, doc, errors } = await launch();
    const players = ['あき', 'びび', 'ちか', 'でん', 'えみ', 'ふう', 'げん'];
    await startWolfRole(win, doc, 'wolf-normal', players);
    await runWrHandoffs(win, doc, players.length); // 役職確認
    await runWrHandoffs(win, doc, players.length); // 夜
    await waitScreen(win, doc, 'scr-wr-day', 6000);

    const app = el(doc, 'app');
    assert(app.classList.contains('phase-day'), '朝は明るい配色に切り替わる');
    assert(!app.classList.contains('phase-night'), '夜の配色は外れる');
    assert(app.classList.contains('theme-wolf'), '人狼のテーマ自体は続いている');

    const turn = el(doc, 'wrDayTurn');
    assert(/日目の朝/.test(turn.textContent), '朝の見出しが出る');
    assert(turn.querySelector('b'), 'ターンの見出しは大きく出す（b要素）');

    const news = el(doc, 'wrDayNews');
    const died = news.querySelector('.day-death');
    const peace = news.querySelector('.day-peace');
    assert(died || peace, '欠けた人か「誰も欠けませんでした」のどちらかが出る');
    if (died) assert(/襲われた|謎の死|後を追った/.test(died.textContent), '原因まで分かる');
    assertNoErrors(errors, '朝の画面で未捕捉の例外');
    win.close();
  });

  // ---- 第20弾 第3部：操作方式の統一 ----
  await r.test('ゲーム選択はタップで即決定せず、「つぎへ」で確定する', async () => {
    // 実機で、棚から来た勢いのまま誤って選んでしまう問題があった
    const { win, doc, errors } = await launch();
    const cart = doc.querySelector('.cart[data-cart="jinro"]');
    cart.click();
    if (activeScreen(doc) === 'scr-shelf') cart.click();
    await waitScreen(win, doc, 'scr-game', 3000);

    const wordwolf = doc.querySelector('#gameCards .mode-card[data-game="wordwolf"]');
    const wolfrole = doc.querySelector('#gameCards .mode-card[data-game="wolfrole"]');
    assert(wordwolf.classList.contains('selected'), '最初は先頭が選ばれている（未選択にしない）');

    // 押しても画面は動かない
    wolfrole.click();
    await sleep(win, 80);
    assertEqual(activeScreen(doc), 'scr-game', 'タップだけでは進まない');
    assert(doc.querySelector('#gameCards .mode-card[data-game="wolfrole"]').classList.contains('selected'),
      '選択だけが移る');
    assert(!doc.querySelector('#gameCards .mode-card[data-game="wordwolf"]').classList.contains('selected'),
      '前の選択は外れる');

    // 選び直しても大丈夫
    doc.querySelector('#gameCards .mode-card[data-game="wordwolf"]').click();
    await sleep(win, 60);
    assertEqual(activeScreen(doc), 'scr-game', '選び直しても進まない');

    click(doc, 'gameNextBtn');
    await sleep(win, 100);
    assert(activeScreen(doc) !== 'scr-game', '「つぎへ」で初めて進む（' + activeScreen(doc) + '）');
    assertNoErrors(errors, 'ゲーム選択で未捕捉の例外');
    win.close();
  });

  await r.test('人狼の朝：話し合いの時間を止められる', async () => {
    const { win, doc, errors } = await launch();
    const players = ['あき', 'びび', 'ちか', 'でん', 'えみ'];
    // タイマーONのまま始めたいので、ウィザードでは時間設定を触らない
    const cart = doc.querySelector('.cart[data-cart="jinro"]');
    cart.click();
    if (activeScreen(doc) === 'scr-shelf') cart.click();
    await waitScreen(win, doc, 'scr-game', 3000);
    pickGame(doc, 'wolfrole');
    await sleep(win, 60);
    await fillPlayerForm(win, doc, players);
    await waitScreen(win, doc, 'scr-mode', 3000);
    click(doc, doc.querySelector('.mode-card[data-id="wolf-casual"]'));
    click(doc, 'modeNextBtn');
    await sleep(win, 80);
    for (let i = 0; i < 8; i++) {
      const cur = activeScreen(doc);
      if (cur === 'scr-ready' || cur === 'scr-mode-rules') break;
      const next = doc.querySelector('#' + cur + ' [data-wiz-next]');
      if (!next) break;
      next.click(); await sleep(win, 40);
    }
    if (activeScreen(doc) === 'scr-mode-rules') { click(doc, 'rulesStartBtn'); await sleep(win, 60); }
    await waitScreen(win, doc, 'scr-ready', 3000);
    el(doc, 'holdBtn').dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true }));
    await waitScreen(win, doc, 'scr-wr-pass', 8000);
    await runWrHandoffs(win, doc, players.length); // 役職確認
    await runWrHandoffs(win, doc, players.length); // 夜
    await waitScreen(win, doc, 'scr-wr-day', 6000);

    assert(el(doc, 'wrDayTimer').style.display !== 'none', '朝にタイマーが出る');
    assert(el(doc, 'wrDayPauseBtn').style.display !== 'none', '一時停止ボタンが出る');
    const t0 = el(doc, 'wrDayTimer').textContent;
    await sleep(win, 1200);
    assert(el(doc, 'wrDayTimer').textContent !== t0, '動いている');

    click(doc, 'wrDayPauseBtn');
    const paused = el(doc, 'wrDayTimer').textContent;
    assertEqual(el(doc, 'wrDayPauseBtn').textContent, '▶', '止めたことがボタンで分かる');
    await sleep(win, 1200);
    assertEqual(el(doc, 'wrDayTimer').textContent, paused, '止まっている');

    click(doc, 'wrDayPauseBtn');
    assertEqual(el(doc, 'wrDayPauseBtn').textContent, '⏸', '再開したことが分かる');
    await sleep(win, 1200);
    assert(el(doc, 'wrDayTimer').textContent !== paused, 'また動き出す');

    // 第22弾-6：話し合いのタイマーは、ワードウルフ側（scr-play）と人狼側（scr-wr-day）で
    // 別々に書かれている。片方だけ直して片方が取り残される事故が実際に起きているので、
    // 「設定を開いて閉じたら戻る」を人狼側でも固定しておく。
    // （あれそれどれこれ側は「再発防止：設定を開いて閉じたら〜」で固定済み）
    win.confirm = () => true;
    win.alert = () => {};
    click(doc, 'floatingGearBtn');
    await sleep(win, 80);
    const gearPaused = el(doc, 'wrDayTimer').textContent;
    assertEqual(el(doc, 'wrDayPauseBtn').textContent, '▶', '設定を開くと止まる');
    await sleep(win, 1200);
    assertEqual(el(doc, 'wrDayTimer').textContent, gearPaused, '開いている間は止まったまま');

    click(doc, 'closeSettingsBtn');
    await sleep(win, 80);
    assertEqual(el(doc, 'wrDayPauseBtn').textContent, '⏸', '閉じたら再生中の表示に戻る');
    await sleep(win, 1200);
    assert(el(doc, 'wrDayTimer').textContent !== gearPaused, '閉じたら人狼の朝のタイマーも動き出す');
    assertNoErrors(errors, '朝のタイマー操作で未捕捉の例外');
    win.close();
  });

  // ---- 第20弾 第2部：情報はその場で渡す ----
  await r.test('占い師は、占ったその場で結果を受け取る', async () => {
    const { win, doc, errors } = await launch();
    const players = ['あき', 'びび', 'ちか', 'でん', 'えみ', 'ふう', 'げん'];
    await startWolfRole(win, doc, 'wolf-normal', players);
    await runWrHandoffs(win, doc, players.length); // 役職確認

    // 夜：全員ぶん流し、誰が何を見たかと、何タップしたかを集める
    // （役職確認と夜のあいだに作戦会議が入る。待つあいだに自動で通過する）
    const taps = [], seen = [], handoffs = [];
    await waitScreen(win, doc, 'scr-wr-pass', 9000);
    for (let i = 0; i < players.length; i++) {
      if (activeScreen(doc) !== 'scr-wr-pass') break;
      handoffs.push(doc.querySelector('#wrHandoff .wolf-handoff-sub').textContent.trim() +
        '|' + el(doc, 'wrRevealBtn').textContent.trim());
      let t = 0;
      click(doc, 'wrRevealBtn'); t++;
      await sleep(win, 40);
      const screens = [];
      let g = 0;
      while (g++ < 5 && activeScreen(doc) === 'scr-wr-pass' && el(doc, 'wrContent').style.display !== 'none') {
        screens.push(el(doc, 'wrContentBody').textContent);
        const c = doc.querySelectorAll('#wrChoiceGrid button[data-choice]');
        if (c.length) { c[0].click(); t++; } else { click(doc, 'wrNextBtn'); t++; }
        await sleep(win, 50);
      }
      taps.push(t);
      seen.push(screens.join(' → '));
    }

    const all = seen.join('\n');
    assert(/占いの結果/.test(all), '夜のうちに占いの結果が出る（投票直前ではなく）');
    assert(/霊媒の結果/.test(all), '霊媒の結果も夜のうちに出る');
    assert(/今夜おそう相手/.test(all), '人狼にも選んだ相手の確認が出る');
    assert(/今夜まもる相手/.test(all), '騎士にも選んだ相手の確認が出る');

    // ここが肝心：占い師だけタップ数が増えると、数えるだけで占い師が特定できる
    assertEqual(taps.length, players.length, '全員にスマホが回る');
    assert(taps.every(t => t === taps[0]), '夜のタップ数が全員同じ（' + taps.join(',') + '）');
    assertEqual(taps[0], 3, '見る→選ぶ/確認→つぎの人へ で3タップ');
    assert(handoffs.every(h => h === handoffs[0]), '手渡し画面の文言が全員同じ');

    // 行動が無い人と霊媒師の1画面目は、まったく同じ文言でなければならない
    const first = seen.map(s => s.split(' → ')[0]);
    const idle = first.filter(s => /夜がふけました/.test(s));
    assert(idle.length >= 2, '行動が無い人が複数いる');
    assert(idle.every(s => s === idle[0]), '行動が無い人の文言は完全に同じ');
    assertNoErrors(errors, '夜の情報表示で未捕捉の例外');
    win.close();
  });

  await r.test('のぞき見役も、覗いたその場で結果を受け取る', async () => {
    const { win, doc, errors } = await launch();
    const players = ['あき', 'びび', 'ちか', 'でん', 'えみ'];
    // ターン数1にすると、夜のかわりに投票前の単発行動になる
    await startWolfRole(win, doc, 'wolf-casual', players, () => {
      const m = doc.querySelector('#scr-set-wolfrole [data-wrturn="-1"]');
      for (let i = 0; i < 8; i++) m.click();
      assertEqual(el(doc, 'wrTurnValue').textContent, '1', 'ターン数を1にする');
      // 1ターン戦の役職一覧にのぞき見役が出るので、1人配る
      const peek = doc.querySelector('#wrRoleRows [data-wrrole="peek"][data-d="1"]');
      assert(peek, 'ターン数1ならのぞき見役を選べる');
      peek.click();
    });
    await runWrHandoffs(win, doc, players.length); // 役職確認

    const taps = [], seen = [];

    // 作戦会議を抜けて、投票前の単発行動へ（待つあいだに自動で通過する）
    await waitScreen(win, doc, 'scr-wr-pass', 9000);
    for (let i = 0; i < players.length; i++) {
      if (activeScreen(doc) !== 'scr-wr-pass') break;
      let t = 0;
      click(doc, 'wrRevealBtn'); t++;
      await sleep(win, 40);
      const screens = [];
      let g = 0;
      while (g++ < 5 && activeScreen(doc) === 'scr-wr-pass' && el(doc, 'wrContent').style.display !== 'none') {
        screens.push(el(doc, 'wrContentBody').textContent);
        const c = doc.querySelectorAll('#wrChoiceGrid button[data-choice]');
        if (c.length) { c[0].click(); t++; } else { click(doc, 'wrNextBtn'); t++; }
        await sleep(win, 50);
      }
      taps.push(t);
      seen.push(screens.join(' → '));
    }
    assert(/のぞき見の結果/.test(seen.join('\n')), '覗いたその場で結果が出る');
    assert(taps.every(t => t === taps[0]), '投票前のタップ数も全員同じ（' + taps.join(',') + '）');
    assertEqual(taps[0], 3, 'ここも3タップに揃う');
    assertNoErrors(errors, '投票前の情報表示で未捕捉の例外');
    win.close();
  });

  // ---- 第20弾 第1部：実機で見つかったバグ ----
  await r.test('再発防止：設定を開いて閉じたら、タイマーが元どおり動く', async () => {
    // 実機で「人数を変えるとタイマーが止まる」と報告された件。
    // 実際の原因は「設定を開くと止めるのに、閉じても戻していなかった」で、
    // 人数変更は無関係だった。全ゲーム共通の経路なので、あれそれどれこれで固定する。
    const { win, doc, errors } = await launch();
    win.confirm = () => true;
    win.alert = () => {};
    await setupPlayers(win, doc, ['あき', 'びび']);
    await waitScreen(win, doc, 'scr-mode', 3000);
    click(doc, doc.querySelector('.mode-card[data-id="normal"]'));
    click(doc, 'modeNextBtn');
    await sleep(win, 60);
    for (let i = 0; i < 8; i++) {
      const cur = activeScreen(doc);
      if (cur === 'scr-ready' || cur === 'scr-mode-rules') break;
      const next = doc.querySelector('#' + cur + ' [data-wiz-next]');
      if (!next) break;
      next.click(); await sleep(win, 30);
    }
    if (activeScreen(doc) === 'scr-mode-rules') { click(doc, 'rulesStartBtn'); await sleep(win, 60); }
    await waitScreen(win, doc, 'scr-ready', 3000);
    el(doc, 'holdBtn').dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true }));
    await waitScreen(win, doc, 'scr-play', 8000);

    const t0 = el(doc, 'playTimer').textContent;
    await sleep(win, 1200);
    assert(el(doc, 'playTimer').textContent !== t0, '開く前は動いている');

    click(doc, 'floatingGearBtn');
    await sleep(win, 80);
    const paused = el(doc, 'playTimer').textContent;
    await sleep(win, 1200);
    assertEqual(el(doc, 'playTimer').textContent, paused, '設定を開いている間は止まる');

    click(doc, 'closeSettingsBtn');
    await sleep(win, 80);
    const resumed = el(doc, 'playTimer').textContent;
    await sleep(win, 1200);
    assert(el(doc, 'playTimer').textContent !== resumed, '閉じたら動き出す（ここが直したところ）');
    assertEqual(el(doc, 'pauseBtn').textContent, '⏸', 'ボタンの表示も再生中に戻る');
    assertNoErrors(errors, 'タイマー再開で未捕捉の例外');
    win.close();
  });

  await r.test('人数が足りない遊び方は選べず、理由が出る', async () => {
    const { win, doc, errors } = await launch();
    const cart = doc.querySelector('.cart[data-cart="jinro"]');
    cart.click();
    if (activeScreen(doc) === 'scr-shelf') cart.click();
    await waitScreen(win, doc, 'scr-game', 3000);
    pickGame(doc, 'wolfrole');
    await sleep(win, 60);
    await fillPlayerForm(win, doc, ['あき', 'びび', 'ちか']); // 3人
    await waitScreen(win, doc, 'scr-mode', 3000);

    const casual = doc.querySelector('.mode-card[data-id="wolf-casual"]');
    const normal = doc.querySelector('.mode-card[data-id="wolf-normal"]');
    assert(!casual.classList.contains('locked'), 'カジュアル（3人〜）は3人で選べる');
    assert(normal.classList.contains('locked'), 'ノーマル（5人〜）は3人では選べない');
    assert(/5人以上/.test(normal.textContent), '必要な人数が読める（' + normal.textContent.trim() + '）');

    // 押しても選択が移らない
    normal.click();
    await sleep(win, 60);
    assert(doc.querySelector('.mode-card[data-id="wolf-normal"]').classList.contains('locked'),
      '押しても選ばれない');
    assert(!doc.querySelector('.mode-card[data-id="wolf-normal"]').classList.contains('selected'),
      '選択状態にならない');
    assertNoErrors(errors, '人数制限で未捕捉の例外');
    win.close();
  });

  await r.test('遊んでいる途中は、人を増やしたり減らしたりできない', async () => {
    // お題や役職を配ったあとに名簿が変わると、配った相手とズレて破綻する
    const { win, doc, errors } = await launch();
    const players = ['あき', 'びび', 'ちか', 'でん', 'えみ'];
    await startWolfRole(win, doc, 'wolf-casual', players);
    let alerted = '';
    win.confirm = () => true;
    win.alert = (m) => { alerted = m; };

    click(doc, 'floatingGearBtn');
    await sleep(win, 80);
    click(doc, 'setPlayerPlusBtn');
    await sleep(win, 40);
    const rows = doc.querySelectorAll('#setNameRows input');
    rows[rows.length - 1].value = 'あとから';
    rows[rows.length - 1].dispatchEvent(new win.Event('input', { bubbles: true }));
    click(doc, 'applyPlayersBtn');
    await sleep(win, 80);

    assert(/途中は/.test(alerted), '理由が出る（' + alerted.split('\n')[0] + '）');
    assertEqual(doc.querySelectorAll('#setNameRows input').length, players.length,
      '下書きも元に戻る（増やしかけが残らない）');

    // 名前の変更は今までどおりできる
    alerted = '';
    const first = doc.querySelectorAll('#setNameRows input')[0];
    first.value = 'あき改';
    first.dispatchEvent(new win.Event('input', { bubbles: true }));
    click(doc, 'applyPlayersBtn');
    await sleep(win, 80);
    assert(!/途中は/.test(alerted), '名前の変更は止めない');
    assertNoErrors(errors, '途中の人数変更で未捕捉の例外');
    win.close();
  });

  // ---- 第18弾 第5部：設定画面の分離とターン表示 ----
  await r.test('設定：人狼カセットでは「お題を追加」を出さない', async () => {
    const { win, doc, errors } = await launch();
    await startWolfRole(win, doc, 'wolf-casual', ['あき', 'びび', 'ちか', 'でん', 'えみ']);
    click(doc, 'floatingGearBtn');
    await sleep(win, 80);
    assert(el(doc, 'settingsOverlay').classList.contains('show'), '設定が開く');
    // 第32弾-B-1：設定は「項目を選ぶ→専用画面が開く」形になった。
    // お題を追加は「いま遊んでいるゲーム」の中に入り、使うゲームの時だけ入口が出る
    doc.querySelector('#setRootMenu [data-setpage="game"]').click();
    await sleep(win, 60);
    assert(!doc.querySelector('#setGameMenu [data-setpage="topics"]'), '人狼ではお題の入口を出さない');
    // 共通の項目は残っていること（隠しすぎていないか）
    assert(doc.querySelector('#setGameMenu [data-setpage="rules"]'), 'ルールの見返しは出る');
    assert(el(doc, 'endGameBtn'), 'ゲーム終了は残る');
    assert(el(doc, 'setNameRows'), 'プレイヤー編集は残る');
    assert(el(doc, 'autoSaveToggle'), '記録の保存は残る');
    assertNoErrors(errors, '人狼の設定画面で未捕捉の例外');
    win.close();
  });

  await r.test('設定：あれそれどれこれでは「お題を追加」が出る', async () => {
    const { win, doc, errors } = await launch();
    const cart = doc.querySelector('.cart[data-cart="aresoredorekore"]');
    cart.click();
    if (activeScreen(doc) === 'scr-shelf') cart.click();
    await sleep(win, 80);
    await fillPlayerForm(win, doc, PLAYERS);
    await waitScreen(win, doc, 'scr-mode', 3000);
    click(doc, doc.querySelector('.mode-card[data-id="normal"]'));
    click(doc, 'modeNextBtn');
    await sleep(win, 60);
    click(doc, 'floatingGearBtn');
    await sleep(win, 80);
    doc.querySelector('#setRootMenu [data-setpage="game"]').click();
    await sleep(win, 60);
    const topicRow = doc.querySelector('#setGameMenu [data-setpage="topics"]');
    assert(topicRow, 'あれそれどれこれではお題の入口が出る');
    topicRow.click();
    await sleep(win, 60);
    assertEqual(doc.querySelector('.set-page[data-page="topics"]').style.display, 'block', 'お題の画面が開く');
    assert(el(doc, 'packNameInput'), 'お題を足す入力欄がある');
    assertNoErrors(errors, 'あれそれどれこれの設定画面で未捕捉の例外');
    win.close();
  });

  await r.test('人狼：朝も夜も、いま何ターン目かと最終ターンが分かる', async () => {
    const { win, doc, errors } = await launch();
    const players = ['あき', 'びび', 'ちか', 'でん', 'えみ'];
    // ターン数2の設定にして、2ターン目で「最終ターン」が出ることを確かめる
    await startWolfRole(win, doc, 'wolf-casual', players, () => {
      const minus = doc.querySelector('#scr-set-wolfrole [data-wrturn="-1"]');
      for (let i = 0; i < 8; i++) minus.click();
      const plus = doc.querySelector('#scr-set-wolfrole [data-wrturn="1"]');
      plus.click();
      assertEqual(el(doc, 'wrTurnValue').textContent, '2', 'ターン数を2にする');
    });
    // 役職確認中はターン数を出さない（まだゲームが始まっていない）
    assertEqual(el(doc, 'wrTurnBanner').style.display, 'none', '役職確認では帯を出さない');
    await runWrHandoffs(win, doc, players.length);

    // 1日目の夜（「夜になりました」の関門を抜けてから）
    passNightfall(doc);
    await waitScreen(win, doc, 'scr-wr-pass', 4000);
    assertEqual(el(doc, 'wrTurnBanner').style.display, 'block', '夜には帯が出る');
    const night1 = el(doc, 'wrTurnBanner').textContent;
    assert(/1日目の夜/.test(night1), '「1日目の夜」が出る（' + night1 + '）');
    assert(/1／2/.test(night1), '上限つきで何ターン目かが分かる（' + night1 + '）');
    assert(!/最終ターン/.test(night1), '1ターン目はまだ最終ではない');
    await runWrHandoffs(win, doc, players.length);

    // 1日目の朝
    if (activeScreen(doc) === 'scr-wr-day') {
      const day1 = el(doc, 'wrDayTurn').textContent;
      assert(/日目の朝/.test(day1) && /／2/.test(day1), '朝にも上限つきターン数が出る（' + day1 + '）');
      await holdPress(win, doc, 'wrToVoteBtn');
      await sleep(win, 80);
    }
    // 1日目の投票
    if (activeScreen(doc) === 'scr-wr-pass') {
      assert(/投票/.test(el(doc, 'wrTurnBanner').textContent), '投票フェーズも帯に出る');
    }
    assertNoErrors(errors, 'ターン表示で未捕捉の例外');
    win.close();

    // ターン数1なら、最初から「最終ターン」と分かる
    const one = await launch();
    await startWolfRole(one.win, one.doc, 'wolf-casual', players, () => {
      const m = one.doc.querySelector('#scr-set-wolfrole [data-wrturn="-1"]');
      for (let i = 0; i < 8; i++) m.click();
      assertEqual(el(one.doc, 'wrTurnValue').textContent, '1', 'ターン数を1にする');
    });
    await runWrHandoffs(one.win, one.doc, players.length);   // 役職確認
    await waitScreen(one.win, one.doc, 'scr-wr-pass', 4000); // 投票前の単発行動へ
    const banner = el(one.doc, 'wrTurnBanner');
    assertEqual(banner.style.display, 'block', '1ターン版でも帯は出る');
    assert(/最終ターン/.test(banner.textContent), '最終ターンだと分かる（' + banner.textContent + '）');
    assert(!/1／1/.test(banner.textContent), '最終ターンのときは「1／1」を重ねて出さない');
    assertNoErrors(one.errors, '最終ターン表示で未捕捉の例外');
    one.win.close();
  });

  await r.test('ワードウルフ2〜ターン：何ターン目かが手渡し画面に出る', async () => {
    const { win, doc, errors } = await launch();
    await startWolfMulti(win, doc, true);
    await waitScreen(win, doc, 'scr-wolf-pass', 8000);
    const b1 = el(doc, 'wolfTurnBanner');
    assertEqual(b1.style.display, 'block', '2〜ターン版では帯を出す');
    assert(/1ターン目/.test(b1.textContent), '1ターン目と出る（' + b1.textContent + '）');
    assert(/1／2/.test(b1.textContent), '上限つきで出る（' + b1.textContent + '）');
    win.close();

    // 1ターン版では帯そのものを出さない
    const two = await launch();
    const cart = two.doc.querySelector('.cart[data-cart="jinro"]');
    cart.click();
    if (activeScreen(two.doc) === 'scr-shelf') cart.click();
    await waitScreen(two.win, two.doc, 'scr-game', 3000);
    pickGame(two.doc, 'wordwolf');
    await sleep(two.win, 60);
    await fillPlayerForm(two.win, two.doc, PLAYERS);
    await waitScreen(two.win, two.doc, 'scr-mode', 3000);
    click(two.doc, two.doc.querySelector('.mode-card[data-id="wordwolf"]'));
    click(two.doc, 'modeNextBtn');
    await sleep(two.win, 60);
    for (let i = 0; i < 6; i++) {
      const cur = activeScreen(two.doc);
      if (cur === 'scr-ready' || cur === 'scr-mode-rules') break;
      if (cur === 'scr-set-timer' && el(two.doc, 'timerEnableToggle').classList.contains('on')) {
        click(two.doc, 'timerEnableToggle'); await sleep(two.win, 30);
      }
      const next = two.doc.querySelector('#' + cur + ' [data-wiz-next]');
      if (!next) break;
      next.click(); await sleep(two.win, 30);
    }
    if (activeScreen(two.doc) === 'scr-mode-rules') { click(two.doc, 'rulesStartBtn'); await sleep(two.win, 60); }
    await waitScreen(two.win, two.doc, 'scr-ready', 3000);
    el(two.doc, 'holdBtn').dispatchEvent(new two.win.PointerEvent('pointerdown', { bubbles: true }));
    await waitScreen(two.win, two.doc, 'scr-wolf-pass', 8000);
    assertEqual(el(two.doc, 'wolfTurnBanner').style.display, 'none', '1ターン版では帯を出さない');
    assertNoErrors(two.errors, 'ワードウルフのターン表示で未捕捉の例外');
    two.win.close();
  });

  // ---- 第18弾 第5部：夜のテーマ ----
  await r.test('テーマ：カセットを選んだ時点から、その先すべてが夜になる', async () => {
    // 第20弾-7-1で範囲を広げた。棚と扉だけが例外
    const { win, doc, errors } = await launch();
    const app = el(doc, 'app');
    const players = ['あき', 'びび', 'ちか', 'でん', 'えみ'];

    assert(!app.classList.contains('theme-wolf'), '棚では素のまま');
    const cart = doc.querySelector('.cart[data-cart="jinro"]');
    cart.click();
    if (activeScreen(doc) === 'scr-shelf') cart.click();
    await waitScreen(win, doc, 'scr-game', 3000);
    assert(app.classList.contains('theme-wolf'), 'ゲーム選択からもう夜になる');
    pickGame(doc, 'wolfrole');
    await sleep(win, 60);
    assert(app.classList.contains('theme-wolf'), 'プレイヤー設定でも続く');
    await fillPlayerForm(win, doc, players);
    await waitScreen(win, doc, 'scr-mode', 3000);
    assert(app.classList.contains('theme-wolf'), 'モード選択でも続く');
    click(doc, doc.querySelector('.mode-card[data-id="wolf-casual"]'));
    click(doc, 'modeNextBtn');
    await waitScreen(win, doc, 'scr-set-wolfrole', 3000);
    assert(app.classList.contains('theme-wolf'), '設定ウィザードでも続く');
    click(doc, doc.querySelector('#scr-set-wolfrole [data-wiz-next]'));
    await waitScreen(win, doc, 'scr-set-timer', 3000);
    if (el(doc, 'timerEnableToggle').classList.contains('on')) click(doc, 'timerEnableToggle');
    click(doc, doc.querySelector('#scr-set-timer [data-wiz-next]'));
    await sleep(win, 60);
    if (activeScreen(doc) === 'scr-mode-rules') { click(doc, 'rulesStartBtn'); await sleep(win, 60); }
    await waitScreen(win, doc, 'scr-ready', 3000);
    el(doc, 'holdBtn').dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true }));
    await waitScreen(win, doc, 'scr-wr-pass', 8000);

    // 実際に遊びはじめたら夜になる
    assert(app.classList.contains('theme-wolf'), '遊んでいる画面は夜になる');
    await runWrHandoffs(win, doc, players.length);   // 役職確認
    await waitScreen(win, doc, 'scr-wr-pass', 9000); // 作戦会議を抜けて夜へ
    assert(app.classList.contains('phase-night'), '夜フェーズはさらに沈める');
    await runWrHandoffs(win, doc, players.length);   // 夜 → 朝
    if (activeScreen(doc) === 'scr-wr-day') {
      assert(app.classList.contains('phase-day'), '朝は藍を明るくする');
      assert(!app.classList.contains('phase-night'), '朝と夜は同時に立たない');
    }
    assertNoErrors(errors, '夜テーマで未捕捉の例外');
    win.close();
  });

  await r.test('テーマ：あれそれどれこれには一切漏れない', async () => {
    const { win, doc, errors } = await launch();
    const app = el(doc, 'app');
    // 先に人狼を遊んで夜にしてから、あれそれどれこれへ移る
    await startWolfRole(win, doc, 'wolf-casual', ['あき', 'びび', 'ちか', 'でん', 'えみ']);
    assert(app.classList.contains('theme-wolf'), '人狼では夜になっている');

    // jsdomのconfirm/alertは未実装なので、OKを押した扱いにする
    win.confirm = () => true;
    win.alert = () => {};
    click(doc, 'floatingGearBtn');
    await sleep(win, 80);
    click(doc, 'endGameBtn');
    await waitScreen(win, doc, 'scr-shelf', 5000);
    assert(!app.classList.contains('theme-wolf'), 'ゲームを終えたら夜が外れる');

    const cart = doc.querySelector('.cart[data-cart="aresoredorekore"]');
    if (cart) {
      cart.click();
      if (activeScreen(doc) === 'scr-shelf') cart.click();
      await sleep(win, 80);
      if (activeScreen(doc) === 'scr-setup') await fillPlayerForm(win, doc, PLAYERS);
      await waitScreen(win, doc, 'scr-mode', 3000);
      click(doc, doc.querySelector('.mode-card[data-id="normal"]'));
      click(doc, 'modeNextBtn');
      await sleep(win, 60);
      for (let i = 0; i < 8; i++) {
        const cur = activeScreen(doc);
        if (cur === 'scr-ready' || cur === 'scr-mode-rules') break;
        if (cur === 'scr-set-timer' && el(doc, 'timerEnableToggle').classList.contains('on')) {
          click(doc, 'timerEnableToggle'); await sleep(win, 30);
        }
        const next = doc.querySelector('#' + cur + ' [data-wiz-next]');
        if (!next) break;
        next.click(); await sleep(win, 30);
      }
      if (activeScreen(doc) === 'scr-mode-rules') { click(doc, 'rulesStartBtn'); await sleep(win, 60); }
      await waitScreen(win, doc, 'scr-ready', 3000);
      el(doc, 'holdBtn').dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true }));
      await waitScreen(win, doc, 'scr-play', 8000);
      assert(!app.classList.contains('theme-wolf'),
        'あれそれどれこれのプレイ画面に夜が乗らない（scr-playは両者で共用なので要注意）');
    }
    assertNoErrors(errors, 'テーマの持ち越しで未捕捉の例外');
    win.close();
  });

  // ---- 再発防止：サバイバルの脱落フラグが他モードに持ち越されないこと ----
  await r.test('再発防止：サバイバルで脱落しても、次のモードに脱落状態が残らない', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
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
    await chooseNext(win, doc, 'shelf');
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
    const { win, doc, errors } = await launch(LAUNCH);
    await gotoModeScreen(win, doc, 'aresoredorekore');
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

  // ---- 第27弾：爆弾解除カセットを本番データのまま通しでプレイする ----
  await r.test('爆弾解除カセット：カウントダウン→3択→全解除まで通る', async () => {
    // テスト用の細工なしで、棚に出ている本番のカセットをそのまま遊ぶ
    const { win, doc, errors } = await launch();
    const cart = doc.querySelector('.cart[data-cart="bakudan"]');
    assert(cart, '爆弾解除のカセットが棚にある');
    assert(!cart.classList.contains('soon'), '近日公開ではなく、遊べる状態');
    cart.click();
    if (activeScreen(doc) === 'scr-shelf') cart.click();
    // 第27弾-3で実物解除が入り、ゲームが2つになったので選択画面を通る
    await waitScreen(win, doc, 'scr-game', 3000);
    pickGame(doc, 'bomb');
    await sleep(win, 60);
    await fillPlayerForm(win, doc, PLAYERS);
    await waitScreen(win, doc, 'scr-mode', 3000);
    const ids = Array.from(doc.querySelectorAll('#modeCards .mode-card')).map(c => c.dataset.id);
    assertEqual(ids.join(','), 'bomb-coop,bomb-race', 'クイズ解除の2枚だけが並ぶ');
    const cards = Array.from(doc.querySelectorAll('#modeCards .mode-card'));
    assert(/クイズ解除/.test(cards[0].textContent), 'モードカードの名前が「クイズ解除」になっている');

    // 競争版は部屋が必須なので、手渡し方式では選べない（理由が読める）
    assert(cards[1].classList.contains('locked'), '競争版は手渡しでは選べない');
    assert(/部屋/.test(cards[1].dataset.locked), '押した時に部屋が要ると分かる');

    // コードの本数を少なくして、最後まで解けるようにする
    click(doc, cards[0]);
    click(doc, 'modeNextBtn');
    await waitScreen(win, doc, 'scr-set-bomb', 3000);
    assert(doc.querySelectorAll('#bombTierRows .bomb-tier-row').length > 0,
      '難易度ごとのステッパーが出る');
    // いったん全部0にして、かんたんだけ2本にする。
    // 押すたびに一覧が作り直されるので、その都度引き直す
    for (const tier of ['easy', 'normal', 'hard', 'nanisore', 'muri']) {
      for (let i = 0; i < 30; i++) {
        if (el(doc, 'bombCount-' + tier).textContent === '0') break;
        doc.querySelector('#bombTierRows .bomb-minus[data-tier="' + tier + '"]').click();
      }
      assertEqual(el(doc, 'bombCount-' + tier).textContent, '0', tier + 'を0本にした');
    }
    for (let i = 0; i < 2; i++) {
      doc.querySelector('#bombTierRows .bomb-plus[data-tier="easy"]').click();
    }
    await sleep(win, 40);
    assertEqual(el(doc, 'bombCount-easy').textContent, '2', 'かんたんを2本にした');

    // 残りのウィザードを進めて開始
    for (let i = 0; i < 8; i++) {
      const cur = activeScreen(doc);
      if (cur === 'scr-ready' || cur === 'scr-mode-rules') break;
      const next = doc.querySelector('#' + cur + ' [data-wiz-next]');
      if (!next) break;
      next.click();
      await sleep(win, 30);
    }
    if (activeScreen(doc) === 'scr-mode-rules') { click(doc, 'rulesStartBtn'); await sleep(win, 60); }
    await waitScreen(win, doc, 'scr-ready', 3000);
    el(doc, 'holdBtn').dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true }));

    // 第32弾-A-3-6：出題を問題バンクへ移したので、
    // 説明文をそろえる待ち画面そのものが無くなった
    await waitScreen(win, doc, 'scr-bomb-play', 12000);
    const wires = doc.querySelectorAll('#bombWireList .bomb-wire-btn');
    assertEqual(wires.length, 2, '設定した本数だけコードが並ぶ');

    // 2本とも正解して全解除する。正解は問題バンクの中にある（画面には出ていない）
    for (let i = 0; i < 2; i++) {
      const btn = doc.querySelector('#bombWireList .bomb-wire-btn:not(.solved)');
      assert(btn, (i + 1) + '本目のコードがある');
      btn.click();
      await waitFor(win, () => doc.querySelectorAll('#bombWireChoices .pk-btn').length === 3,
        4000, (i + 1) + '本目の3択が出る');
      // 問題文から、問題バンクの元データを引いて正解を知る（画面には出ていない）
      const desc = el(doc, 'bombWireDescription').textContent;
      const choices = Array.from(doc.querySelectorAll('#bombWireChoices .pk-btn'));
      const bank = win.QuizBank.QUESTIONS.easy.find(q => q.q === desc);
      assert(bank, (i + 1) + '本目の問題文が問題バンクから来ている');
      const right = choices.find(c => c.textContent === bank.choices[bank.correct]);
      assert(right, (i + 1) + '本目の正解が3択に入っている');
      right.click();
      await sleep(win, 600);
    }
    await waitScreen(win, doc, 'scr-bomb-end', 4000);
    assert(/解除成功/.test(el(doc, 'bombEndTitle').textContent), '全解除で成功になる');
    assertNoErrors(errors, '爆弾解除の通しプレイで未捕捉の例外');
    win.close();
  });

  await r.test('爆弾解除：心拍は盤面に入ってから鳴り、画面を離れたら止まる', async () => {
    // 常時BGMは入れない方針なので、解除中だけ鳴って、離れたら必ず止まること
    const { win, doc, errors } = await launch(LAUNCH);
    // 心拍は setInterval で刻む。鳴っているかは AudioContext が作られたかで見る
    let contexts = 0;
    const origAC = win.AudioContext;
    win.AudioContext = win.webkitAudioContext = function () { contexts++; return origAC(); };

    await startMode(win, doc, 'bomb-coop');
    // 第28弾-1：盤面に入ってから鳴りはじめる
    const beforePlay = contexts;
    await waitScreen(win, doc, 'scr-bomb-play', 12000);
    await sleep(win, 120);
    assert(contexts > beforePlay, '盤面に入ったら心拍が鳴りはじめる');

    // 画面を離れたら止まる（別のゲームを遊んでいる間も鳴り続けないこと）
    win.confirm = () => true;
    const stamp = contexts;
    el(doc, 'floatingGearBtn').click();
    await sleep(win, 1400);
    assertEqual(contexts, stamp, '画面を離れたら心拍は鳴らない');
    assertNoErrors(errors, '心拍演出で未捕捉の例外');
    win.close();
  });

  // ---- 第29弾-7：見つかっていた2件のバグ ----

  await r.test('コード数の「＋」は、上限に達したらそれ以上増やせない', async () => {
    // 以前は上限そのものを引き上げていたので、押し続ければいくらでも増やせた
    const { win, doc, errors } = await launch();
    const cart = doc.querySelector('.cart[data-cart="bakudan"]');
    cart.click();
    if (activeScreen(doc) === 'scr-shelf') cart.click();
    await waitScreen(win, doc, 'scr-game', 3000);
    pickGame(doc, 'bomb');
    await sleep(win, 60);
    await fillPlayerForm(win, doc, PLAYERS);
    await waitScreen(win, doc, 'scr-mode', 3000);
    click(doc, doc.querySelector('.mode-card[data-id="bomb-coop"]'));
    click(doc, 'modeNextBtn');
    await waitScreen(win, doc, 'scr-set-bomb', 3000);

    const max = parseInt(el(doc, 'bombMaxValue').textContent, 10);
    assert(max > 0, '上限が読める（' + max + '）');
    // ひたすら押す（上限＋30回）
    for (let i = 0; i < max + 30; i++) {
      doc.querySelector('#bombTierRows .bomb-plus[data-tier="easy"]').click();
    }
    await sleep(win, 60);
    const sum = ['easy', 'normal', 'hard', 'nanisore', 'muri']
      .reduce((s, t) => s + parseInt(el(doc, 'bombCount-' + t).textContent, 10), 0);
    assert(sum <= max, '合計が上限を超えない（合計' + sum + ' / 上限' + max + '）');
    assertEqual(parseInt(el(doc, 'bombMaxValue').textContent, 10), max, '上限そのものが動かない');
    assertNoErrors(errors, 'コード数の設定で未捕捉の例外');
    win.close();
  });

  await r.test('テーマ：設定・ウィザードの部品にも色が届いている（白背景に白文字を作らない）', async () => {
    // テーマ自体は全画面に当たっているが、部品の中に白を直に書いてあると
    // 文字色だけが明るく置き換わって読めなくなる。人狼テーマでも同じ見落としがあった
    const fs = require('fs');
    const path = require('path');
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    // 設定画面で使う部品に、テーマ側の指定があること
    const mustCover = [
      '.bomb-tier-controls button', '.bomblife-controls button',
      '.bomb-minus', '.bomb-plus', '.bomb-tier-row',
      '.mode-card', '.switch', '.toggle-row-mini',
      'input\\[type="range"\\]', '.picker-grid .pk-btn',
      '.floating-gear', '.floating-back'
    ];
    mustCover.forEach((sel) => {
      const re = new RegExp('\\.app\\.theme-bomb[^{]*' + sel);
      assert(re.test(html), sel + ' に爆弾解除テーマの指定がある');
    });
    // ウィザードの画面がテーマ対象外になっていないこと
    assert(!/THEME_FREE_SCREENS\s*=\s*\[[^\]]*scr-set-/.test(html),
      '設定ウィザードをテーマの対象外にしていない');
  });

  await r.test('テーマ：爆弾解除の設定画面まで制御盤の見た目が続く', async () => {
    const { win, doc, errors } = await launch();
    const app = el(doc, 'app');
    const cart = doc.querySelector('.cart[data-cart="bakudan"]');
    cart.click();
    if (activeScreen(doc) === 'scr-shelf') cart.click();
    await waitScreen(win, doc, 'scr-game', 3000);
    pickGame(doc, 'bomb');
    await sleep(win, 60);
    await fillPlayerForm(win, doc, PLAYERS);
    await waitScreen(win, doc, 'scr-mode', 3000);
    click(doc, doc.querySelector('.mode-card[data-id="bomb-coop"]'));
    click(doc, 'modeNextBtn');
    // コード配分 → ライフ → タイマー、どの設定画面でもテーマが続く
    for (let i = 0; i < 4; i++) {
      const cur = activeScreen(doc);
      if (cur === 'scr-ready' || cur === 'scr-mode-rules') break;
      assert(app.classList.contains('theme-bomb'), cur + ' でもテーマが当たっている');
      const next = doc.querySelector('#' + cur + ' [data-wiz-next]');
      if (!next) break;
      next.click();
      await sleep(win, 40);
    }
    assertNoErrors(errors, '設定画面のテーマで未捕捉の例外');
    win.close();
  });

  // ---- 第28弾-2：爆弾解除カセット専用テーマ ----

  await r.test('テーマ：爆弾解除カセットを選ぶと、その先すべてが制御盤になる', async () => {
    const { win, doc, errors } = await launch();
    const app = el(doc, 'app');
    assert(!app.classList.contains('theme-bomb'), '棚では素のまま');

    const cart = doc.querySelector('.cart[data-cart="bakudan"]');
    cart.click();
    if (activeScreen(doc) === 'scr-shelf') cart.click();
    await waitScreen(win, doc, 'scr-game', 3000);
    assert(app.classList.contains('theme-bomb'), 'ゲーム選択からもう制御盤になる');
    pickGame(doc, 'bomb');
    await sleep(win, 60);
    await fillPlayerForm(win, doc, PLAYERS);
    await waitScreen(win, doc, 'scr-mode', 3000);
    assert(app.classList.contains('theme-bomb'), 'モード選択でも続く');
    click(doc, doc.querySelector('.mode-card[data-id="bomb-coop"]'));
    click(doc, 'modeNextBtn');
    await waitScreen(win, doc, 'scr-set-bomb', 3000);
    assert(app.classList.contains('theme-bomb'), '設定ウィザードでも続く');
    // 人狼のテーマは混ざらない
    assert(!app.classList.contains('theme-wolf'), '別のカセットのテーマは付かない');
    assertNoErrors(errors, '爆弾解除のテーマで未捕捉の例外');
    win.close();
  });

  // 第30弾 第4部：テーマの適用範囲が漏れていないこと（落とし穴3）。
  // 棚 → ゲーム選択 → モード選択 → 設定ウィザード まで実際にたどる
  // 第32弾-A-3-5：部屋が必須のカセットは、ゲームを選ぶ前に分かるようにする。
  // 以前は「選べるのに、モード画面で押せなくなる」形で、そこで詰んでいた。
  // （クイズ王・オークションのテーマが最後まで続くことは、
  //   部屋がある状態で歩く rt-screens.js の方で見ている）
  await r.test('手渡しの棚では、部屋が必須のカセットは押す前に理由が読める', async () => {
    const { win, doc, errors } = await launch({ playFlow: 'handoff' });
    for (const id of ['quizou', 'auction']) {
      const cart = doc.querySelector('.cart[data-cart="' + id + '"]');
      assert(cart, id + ' のカセットは棚に並んでいる（隠さない）');
      assert(cart.classList.contains('locked'), id + '：遊べないことが見て分かる');
      assert(/みんなのスマホ/.test(cart.textContent), id + '：理由が読める');
    }
    // 押しても始まらず、理由が出るだけ（行き止まりにしない）
    const cart = doc.querySelector('.cart[data-cart="quizou"]');
    cart.click();
    if (activeScreen(doc) === 'scr-shelf') cart.click();
    await sleep(win, 120);
    assertEqual(activeScreen(doc), 'scr-shelf', '押しても棚から出ない');
    assertNoErrors(errors, '手渡しの棚で未捕捉の例外');
    win.close();
  });

  await r.test('みんなのスマホの棚では、1台専用のカセットに理由が出る', async () => {
    // あれそれどれこれは部屋に未対応。逆向きも同じように分かる形にする
    const { win, doc, errors } = await launch({ playFlow: false });
    // 棚だけ見たいので、部屋を立てずに棚のあそびかただけ切り替える
    click(doc, doc.querySelector('#scr-howto [data-howto="browse"]'));
    await waitScreen(win, doc, 'scr-shelf', 3000);
    assert(!doc.querySelector('.cart[data-cart="quizou"]').classList.contains('locked'),
      '見るだけの時は、どれも開ける');
    assertNoErrors(errors, '見るだけの棚で未捕捉の例外');
    win.close();
  });

  // ---- 第32弾-B 第1部：設定の再設計 ----

  await r.test('設定：項目を選ぶと専用画面が開き、もどれる', async () => {
    const { win, doc, errors } = await launch();
    click(doc, 'shelfGearBtn');
    await sleep(win, 100);
    assertEqual(el(doc, 'setTitle').textContent, '設定', '入口の見出し');
    assertEqual(el(doc, 'setBackBtn').style.display, 'none', '入口では戻る矢印を出さない');

    doc.querySelector('#setRootMenu [data-setpage="app"]').click();
    await sleep(win, 60);
    assertEqual(el(doc, 'setTitle').textContent, 'アプリ全体', '専用画面が開く');
    assert(el(doc, 'setBackBtn').style.display !== 'none', '戻る矢印が出る');
    doc.querySelector('#setAppMenu [data-setpage="sound"]').click();
    await sleep(win, 60);
    assertEqual(el(doc, 'setTitle').textContent, '音量', 'さらに奥へ進める');

    click(doc, 'setBackBtn');
    await sleep(win, 60);
    assertEqual(el(doc, 'setTitle').textContent, 'アプリ全体', '1つ前にもどる');
    click(doc, 'setBackBtn');
    await sleep(win, 60);
    assertEqual(el(doc, 'setTitle').textContent, '設定', '入口までもどる');
    assertNoErrors(errors, '設定の行き来で未捕捉の例外');
    win.close();
  });

  await r.test('設定：危険な操作は、他とはっきり分けて一番下に置く', async () => {
    const fs = require('fs');
    const path = require('path');
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    // 色でも見分けられる
    assert(/\.set-row\.danger\{[^}]*var\(--stamp\)/.test(html), '危険な操作は色を分ける');

    const { win, doc, errors } = await launch();
    click(doc, 'shelfGearBtn');
    await sleep(win, 100);
    const rows = Array.from(doc.querySelectorAll('#setRootMenu .set-row'));
    const danger = rows[rows.length - 1];
    assertEqual(danger.dataset.setpage, 'danger', '危険な操作は一番下');
    assert(danger.classList.contains('danger'), '見た目でも分かれている');

    // ゲーム終了も、以前は一番上にあって誤って押しやすかった
    doc.querySelector('#setRootMenu [data-setpage="game"]').click();
    await sleep(win, 60);
    const gameRows = Array.from(doc.querySelectorAll('.set-page[data-page="game"] .set-row'));
    assertEqual(gameRows[gameRows.length - 1].id, 'endGameBtn', 'ゲーム終了は一番下');
    assert(el(doc, 'endGameBtn').classList.contains('danger'), '見た目でも分かれている');

    // 確認なしでは進まない
    let asked = 0;
    win.confirm = () => { asked++; return false; };
    click(doc, 'endGameBtn');
    await sleep(win, 100);
    assertEqual(asked, 1, '確認を挟む');
    assert(el(doc, 'settingsOverlay').classList.contains('show'), '断ったら何も起きない');
    assertNoErrors(errors, '危険な操作の表示で未捕捉の例外');
    win.close();
  });

  await r.test('設定：音量・文字サイズ・演出の速さが、その場で効く', async () => {
    const { win, doc, errors } = await launch();
    click(doc, 'shelfGearBtn');
    await sleep(win, 100);
    doc.querySelector('#setRootMenu [data-setpage="app"]').click();
    await sleep(win, 60);
    doc.querySelector('#setAppMenu [data-setpage="display"]').click();
    await sleep(win, 60);

    // 文字サイズ
    const font = el(doc, 'setFont');
    font.value = '125';
    font.dispatchEvent(new win.Event('input'));
    await sleep(win, 60);
    assertEqual(el(doc, 'app').style.getPropertyValue('--font-scale'), '1.25', '文字サイズが効く');
    // 明るさ
    const bright = el(doc, 'setBright');
    bright.value = '130';
    bright.dispatchEvent(new win.Event('input'));
    await sleep(win, 60);
    assertEqual(el(doc, 'app').style.getPropertyValue('--screen-bright'), '1.30', '明るさが効く');
    // 演出の速さ（スキップにすると、動きを止める印が付く）
    doc.querySelector('#setFxSeg [data-fx="skip"]').click();
    await sleep(win, 60);
    assert(el(doc, 'app').classList.contains('fx-skip'), 'スキップが効く');

    // 開き直しても覚えている
    click(doc, 'closeSettingsBtn');
    await sleep(win, 60);
    const saved = JSON.parse(win.localStorage.getItem('acac-app-prefs') || '{}');
    assertEqual(saved.fontScale, 125, '文字サイズを覚えている');
    assertEqual(saved.fxSpeed, 'skip', '演出の速さも覚えている');
    assertNoErrors(errors, '設定の反映で未捕捉の例外');
    win.close();
  });

  await r.test('設定：音を鳴らす所は、すべて音量の設定を通る', async () => {
    // 音を鳴らす場所は15か所ある。それぞれに音量を効かせて回ると、
    // 必ずどこかが半分だけ効く形になるので、出口を1つに絞ってある
    const fs = require('fs');
    const path = require('path');
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    assert(/function sfxOut\(ctx\)/.test(html), '音の出口が1か所にある');
    // 第32弾-C：以前ここは「ctx.destination へつなぐ場所は0か所」と書いていた。
    // ところが出口そのものはスピーカーにつながないと音が出ない。
    // その矛盾を通すために出口が自分自身を呼ぶ形になり、
    // つまみが数珠つなぎになって音量が壊れていた（テストがバグを作った）。
    // 正しくは「出口の中で1回だけ、外では0回」。
    const outStart = html.indexOf('function sfxOut(ctx)');
    const outEnd = html.indexOf('function doVibrate', outStart);
    assert(outStart > 0 && outEnd > outStart, '音の出口の範囲が取れる');
    const inside = html.slice(outStart, outEnd);
    const outside = html.slice(0, outStart) + html.slice(outEnd);
    const rx = /connect\((?:ctx|bombHeart\.ctx)\.destination\)/g;
    assertEqual((inside.match(rx) || []).length, 1, '出口はスピーカーに1回だけつながる');
    assertEqual((outside.match(rx) || []).length, 0, '音の出口を素通りしている場所が無い');
    // 出口の中から出口を呼ばないこと。外の音源が g.connect(sfxOut(ctx)) と書くのは正しい
    assert(!/sfxOut\(/.test(inside.replace('function sfxOut(ctx)', '')),
      '出口が自分自身を呼んでいない');
    // 振動も1か所を通る
    const rawVibrate = (html.match(/navigator\.vibrate\(/g) || []).length;
    assertEqual(rawVibrate, 1, '振動を鳴らす場所も1か所だけ（doVibrate の中）');
  });

  await r.test('設定：音量を0にすると、効果音が鳴らなくなる', async () => {
    const { win, doc, errors } = await launch();
    // 鳴らそうとした時に作られる音量つまみを全部集めて、
    // 「出口のつまみ」が設定どおりになっているかを見る
    const OrigAC = win.AudioContext;
    let gains = [];
    win.AudioContext = win.webkitAudioContext = function () {
      const ctx = new OrigAC();
      const origCreateGain = ctx.createGain.bind(ctx);
      ctx.createGain = function () { const g = origCreateGain(); gains.push(g); return g; };
      return ctx;
    };
    click(doc, 'shelfGearBtn');
    await sleep(win, 100);
    doc.querySelector('#setRootMenu [data-setpage="app"]').click();
    await sleep(win, 60);
    doc.querySelector('#setAppMenu [data-setpage="sound"]').click();
    await sleep(win, 60);

    // まず、鳴る状態で出口のつまみが上がっていること
    const vol = el(doc, 'setSeVol');
    vol.value = '100';
    vol.dispatchEvent(new win.Event('input'));
    await sleep(win, 40);
    gains = [];
    click(doc, 'setSeTestBtn');
    await sleep(win, 120);
    assert(gains.length > 0, '音を作ろうとする');
    assert(gains.some((g) => g.gain.value === 1), '出口のつまみが最大になっている');
    // 第32弾-C：出口が自分自身を呼んでいて、つまみが数珠つなぎになっていた。
    // 掛け算で効いてしまうので、100未満にすると完全な無音になっていた。
    // 「どれかが正しい値」だけを見ていたので、この壊れ方を見逃していた。
    // 1回の音で作られるつまみは、出口1つと音そのもの1つの、ほんの数個で足りる
    assert(gains.length <= 4,
      '1回の音でつまみを作りすぎていない（実際: ' + gains.length + '個）');

    // 0にすると、出口のつまみが0になる（鳴らす場所を1つも直さずに全部が静かになる）
    vol.value = '0';
    vol.dispatchEvent(new win.Event('input'));
    await sleep(win, 40);
    gains = [];
    click(doc, 'setSeTestBtn');
    await sleep(win, 120);
    assert(gains.length > 0, '音を作ろうとはする');
    assert(gains.some((g) => g.gain.value === 0), '出口のつまみが0になっている');
    assertNoErrors(errors, '音量0で未捕捉の例外');
    win.close();
  });

  await r.test('準備OK画面に、この設定だと だいたい何分かかるかが出る', async () => {
    // 第32弾-A-3-9：カセットの「15分〜」は設定で大きく変わる。
    // 集まりの中では「あと何分で終わるか」が分からないと遊びづらい
    const t = await launch();
    const cart = t.doc.querySelector('.cart[data-cart="aresoredorekore"]');
    cart.click();
    if (activeScreen(t.doc) === 'scr-shelf') cart.click();
    await fillPlayerForm(t.win, t.doc, PLAYERS);
    await waitScreen(t.win, t.doc, 'scr-mode', 3000);
    click(t.doc, 'modeAutoBtn');
    await sleep(t.win, 100);
    if (activeScreen(t.doc) === 'scr-mode-rules') { click(t.doc, 'rulesStartBtn'); await sleep(t.win, 80); }
    await waitScreen(t.win, t.doc, 'scr-ready', 3000);
    const est = el(t.doc, 'readyEst');
    assert(est, '目安が出ている');
    assert(/だいたい\s*\d+\s*分/.test(est.textContent), '「だいたい〇分」の形（' + est.textContent + '）');
    assertNoErrors(t.errors, '目安の表示で未捕捉の例外');
    t.win.close();
  });

  await r.test('選んだモードのカードが、どのテーマでも読める', async () => {
    // 第32弾-A-3-3：.mode-card.selected が background:#fff を直書きしていた。
    // 暗いテーマでは文字色が明るくなるので「白背景×白文字」で読めなくなる。
    // 指示28で直した「爆弾解除の設定画面が白背景に白文字」とまったく同じ形なので、
    // 色を決め打ちしていないこと自体を見張る
    const fs = require('fs');
    const path = require('path');
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const rule = html.match(/\.mode-card\.selected\{[^}]*\}/);
    assert(rule, '.mode-card.selected の決まりごとがある');
    assertEqual(/background:#fff/i.test(rule[0]), false, '白を直書きしていない');
    assert(/var\(--/.test(rule[0]), 'テーマが持っている色から作っている');

    // 選択中と分かる手がかりは、色以外にも残っている
    assert(/\.mode-card\.selected\{[^}]*border-color/.test(html), '枠の濃さで分かる');
    assert(/\.mode-card\.selected \.m-check\{/.test(html), 'チェックマークでも分かる');

    // 実際に各テーマで選んでも、背景に白が入らない
    for (const c of [{ cart: 'jinro', game: 'wolfrole', theme: 'theme-wolf' },
                     { cart: 'bakudan', game: 'bomb', theme: 'theme-bomb' }]) {
      const { win, doc, errors } = await launch();
      const cart = doc.querySelector('.cart[data-cart="' + c.cart + '"]');
      cart.click();
      if (activeScreen(doc) === 'scr-shelf') cart.click();
      await sleep(win, 100);
      // ゲームが2つ以上入っているカセットは、どれで遊ぶかを選ぶ画面を挟む
      if (activeScreen(doc) === 'scr-game') { pickGame(doc, c.game); await sleep(win, 80); }
      if (activeScreen(doc) === 'scr-setup') await fillPlayerForm(win, doc, PLAYERS);
      await waitScreen(win, doc, 'scr-mode', 3000);
      assert(el(doc, 'app').classList.contains(c.theme), c.cart + '：テーマが当たっている');
      const sel = doc.querySelector('.mode-card.selected');
      assert(sel, c.cart + '：選ばれているカードがある');
      const bg = win.getComputedStyle(sel).backgroundColor;
      assertEqual(/^rgb\(255,\s*255,\s*255\)$/.test(bg), false,
        c.cart + '：選択中の背景が真っ白になっていない（' + bg + '）');
      assertNoErrors(errors, c.cart + ' のモードカードで未捕捉の例外');
      win.close();
    }
  });

  await r.test('テーマ：スタジオと競り市が、追加専用のスコープで書かれている（オークション）', async () => {
    const fs = require('fs');
    const path = require('path');
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    assert(/\.app\.theme-auction\{[\s\S]*?--paper:#1A1012/.test(html), '背景が濃いえんじになっている');
    assert(/\.app\.theme-auction\{[\s\S]*?--gold:#D4A537/.test(html), '金色が入っている');
    assert(/\.app\.theme-auction\{[\s\S]*?radial-gradient\(ellipse[^;]*rgba\(212,165,55/.test(html),
      '品物に光が当たっている');
    // 品物の一枚だけを光らせる（そこが競り市の主役なので）
    assert(/\.app\.theme-auction \.au-teaser\{[\s\S]*?rgba\(212,165,55/.test(html),
      '品物の一枚だけが光る');
  });

  await r.test('カセットの説明で、何台のスマホが要るかと中身が読める', async () => {
    // 第32弾-A：「棚を見る」から開く説明画面。ここでは遊び始めない
    const { win, doc, errors } = await launch({ playFlow: 'browse' });
    const CASES = [
      { cart: 'auction',  need: true,  words: ['せり上げ式', '秘密入札'] },
      { cart: 'quizou',   need: true,  words: ['クイズラッシュ', 'つぎつぎクイズ', 'とくとくクイズ', '早押し'] },
      { cart: 'aresoredorekore', need: false, words: ['あれそれどれこれ'] }
    ];
    for (const c of CASES) {
      const cart = doc.querySelector('.cart[data-cart="' + c.cart + '"]');
      assert(cart, c.cart + ' のカセットが棚にある');
      cart.click();
      if (activeScreen(doc) === 'scr-shelf') cart.click();
      await waitScreen(win, doc, 'scr-cassette', 3000);
      const text = el(doc, 'scr-cassette').textContent;
      if (c.need) assert(/みんなのスマホが必要/.test(text), c.cart + '：みんなのスマホが要ると分かる');
      else assert(/1台でもあそべる/.test(text), c.cart + '：1台でも遊べると分かる');
      c.words.forEach((w) => {
        assert(text.indexOf(w) !== -1, c.cart + '：中身に「' + w + '」が出る');
      });
      click(doc, 'ctBackBtn');
      await waitScreen(win, doc, 'scr-shelf', 3000);
    }
    assertNoErrors(errors, 'カセットの説明で未捕捉の例外');
    win.close();
  });

  await r.test('テーマ：カセットを移ると、前のテーマが残らない', async () => {
    // 一覧で付け外ししていないと「爆弾解除の黒いまま人狼を遊ぶ」ことになる
    const { win, doc, errors } = await launch();
    const app = el(doc, 'app');
    const bomb = doc.querySelector('.cart[data-cart="bakudan"]');
    bomb.click();
    if (activeScreen(doc) === 'scr-shelf') bomb.click();
    await waitScreen(win, doc, 'scr-game', 3000);
    assert(app.classList.contains('theme-bomb'), 'まず爆弾解除のテーマ');

    click(doc, doc.querySelector('#scr-game [data-go-shelf]'));
    await waitScreen(win, doc, 'scr-shelf', 3000);
    assert(!app.classList.contains('theme-bomb'), '棚では外れる');

    const wolf = doc.querySelector('.cart[data-cart="jinro"]');
    wolf.click();
    if (activeScreen(doc) === 'scr-shelf') wolf.click();
    await waitScreen(win, doc, 'scr-game', 3000);
    assert(app.classList.contains('theme-wolf'), '人狼のテーマが付く');
    assert(!app.classList.contains('theme-bomb'), '爆弾解除のテーマは残らない');
    assertNoErrors(errors, 'テーマの切り替えで未捕捉の例外');
    win.close();
  });

  await r.test('テーマ：制御盤の見た目が、追加専用のスコープで書かれている', async () => {
    // jsdom はレイアウトしないので、決まりごとそのものを読んで確かめる
    const fs = require('fs');
    const path = require('path');
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    // 濃い背景・角を落とさないパネル・ハザードストライプ
    assert(/\.app\.theme-bomb\{[^}]*--paper:#1[0-9A-Fa-f]/.test(html), '背景が濃い色になっている');
    assert(/\.app\.theme-bomb \.bomb-wire-btn\{[^}]*border-radius:2px/.test(html),
      'コードのボタンが四角い');
    assert(/\.app\.theme-bomb \.bomb-wire-btn::before\{[\s\S]*?repeating-linear-gradient/.test(html),
      '難易度がハザードストライプで示される');
    // 数字はDotGothic16のまま（桁が揃う書体を崩さない）
    assert(/\.app\.theme-bomb \.big-main:not\(\.is-code\)\{[\s\S]*?DotGothic16/.test(html),
      '見出しは角ばった書体');
    // テーマの外の見た目を書き換えていない。
    // ここから下は「カセット専用テーマだけを書く場所」なので、
    // どのテーマが増えても .app.theme-〇〇 で始まっていなければならない。
    // テーマ名を手で書き足す形にすると、増やした時に見張りから漏れる（落とし穴4）
    const block = html.slice(html.indexOf('第28弾-2 第2部'), html.indexOf('</style>'));
    const selectors = block.match(/^\s{2}([.#][^{]*)\{/gm) || [];
    const leaked = selectors.filter(s => !/\.app\.theme-[a-z]+/.test(s));
    assertEqual(leaked.join(''), '', 'テーマの外を書き換えていない');
  });

  await r.test('テーマ：スタジオの見た目が、追加専用のスコープで書かれている', async () => {
    const fs = require('fs');
    const path = require('path');
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    // 濃い紺の背景・金色・上から降りるスポットライト
    assert(/\.app\.theme-quiz\{[\s\S]*?--paper:#10182E/.test(html), '背景が濃い紺になっている');
    assert(/\.app\.theme-quiz\{[\s\S]*?--gold:#F0B429/.test(html), '金色が入っている');
    assert(/\.app\.theme-quiz\{[\s\S]*?radial-gradient\(ellipse[^;]*rgba\(240,180,41/.test(html),
      'スポットライトが当たっている');
    assert(/\.app\.theme-quiz \.big-main:not\(\.is-code\)\{[\s\S]*?DotGothic16/.test(html),
      '見出しは角ばった書体');
    // 問題のパネルだけ光らせる（スポットライトが当たっているように見せる）
    assert(/\.app\.theme-quiz \.quiz-q,[\s\S]*?box-shadow:0 0 0 1px rgba\(240,180,41/.test(html),
      'いま出ている問題が光る');
  });

  // ---- 第28弾-1：モードのIDを変えても、昔の記録が迷子にならないこと ----

  await r.test('昔のIDで残っている記録も、正しいゲームとして表示される', async () => {
    // 記録は rounds[].mode にモードIDをそのまま持っている。
    // IDを変えた時に対応表を置き忘れると、爆弾解除で遊んだ記録が
    // 「あれそれどれこれ」として表示される（実際に起こりうる壊れ方）
    const { win, doc, errors } = await launch({
      seedMatches: [{
        player_names: ['あき', 'びび'],
        // 第28弾-1より前に書かれた記録。モードIDは古い 'bomb'
        rounds: [{ mode: 'bomb', score_deltas: { あき: 1, びび: 1 }, at: new Date().toISOString() }],
        final_scores: { あき: 1, びび: 1 }
      }]
    });
    click(doc, 'recordsBtn');
    await sleep(win, 300);
    const item = doc.querySelector('#recordsList .record-item');
    assert(item, '記録が1件出る');
    const gameName = item.querySelector('.record-game').textContent;
    assert(/クイズ解除/.test(gameName),
      '古いIDでも爆弾解除の記録として出る（実際: ' + gameName + '）');
    assert(!/あれそれどれこれ/.test(gameName), 'ほかのゲームに化けない');
    assertNoErrors(errors, '古い記録の表示で未捕捉の例外');
    win.close();
  });

  await r.test('これから書く記録には、いまのモードIDが入る', async () => {
    // 古いIDを書き続けると、対応表を永久に外せなくなる
    const { win, doc, errors } = await launch();
    const cart = doc.querySelector('.cart[data-cart="bakudan"]');
    cart.click();
    if (activeScreen(doc) === 'scr-shelf') cart.click();
    await waitScreen(win, doc, 'scr-game', 3000);
    pickGame(doc, 'bomb');
    await sleep(win, 60);
    await fillPlayerForm(win, doc, PLAYERS);
    await waitScreen(win, doc, 'scr-mode', 3000);
    const card = doc.querySelector('.mode-card[data-id="bomb-coop"]');
    assert(card, '協力版のカードがある（IDが bomb-coop になっている）');
    assert(/協力版/.test(card.textContent), 'カードの名前が「協力版」になっている');
    assertNoErrors(errors, 'モード一覧で未捕捉の例外');
    win.close();
  });

  // ---- 再発防止：早押しの正解ボタンを連打しても1点しか入らないこと ----
  await r.test('再発防止：早押しの正解ボタンを連打しても1点しか入らない', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
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
