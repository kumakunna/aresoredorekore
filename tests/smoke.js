// tests/smoke.js — 実装済み全モードのセットアップを一周させ、play画面まで到達できることを確認する
//
// 「別の変更で他のモードが壊れる」ことが何度かあったため、非表示中の独立ゲームも含めて全部通す。
// 過去の再発防止ケース：
//   - ワードウルフの設定画面でクラッシュ（未捕捉例外を見逃した）
//   - サバイバルの脱落フラグが他モードに残る
//   - タイマーを 00:00 に設定できてしまう

const H = require('./harness');
const { launch, activeScreen, sleep, waitScreen, el, click, fillPlayerForm, setupPlayers, pickGame, holdPress, passNightfall, createRunner, assert, assertEqual, assertNoErrors } = H;

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
  { id: 'bomb', game: 'bomb', screen: 'scr-bomb-play' },
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

    // 夜の行動：選択肢が出た人は選ぶ、出ない人は次へ
    if (passNightfall(doc)) await sleep(win, 60);
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
    // 夜の頭には「夜になりました」の関門が入る（第20弾-4-1）
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
    assert(/ウルフ側の勝ち|村人側の勝ち/.test(text), '当てたか逃げ切ったかで決着する（' + text + '）');
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

    // 投票フェーズも、能力持ちだけ操作が増えたりしない
    await waitScreen(win, doc, 'scr-play', 5000);
    click(doc, 'endRoundBtn');
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
    const taps = [], seen = [], handoffs = [];
    if (passNightfall(doc)) await sleep(win, 60);
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

    if (passNightfall(doc)) await sleep(win, 60);
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
    assertEqual(el(doc, 'topicPoolSettings').style.display, 'none', '人狼ではお題まわりを隠す');
    // 共通の項目は残っていること（隠しすぎていないか）
    assert(el(doc, 'endGameBtn').offsetParent !== undefined, 'ゲーム終了は残る');
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
    assertEqual(el(doc, 'topicPoolSettings').style.display, 'block', 'あれそれどれこれではお題まわりを出す');
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
  await r.test('テーマ：夜の配色は人狼カセットの遊んでいる画面にだけ乗る', async () => {
    const { win, doc, errors } = await launch();
    const app = el(doc, 'app');
    const players = ['あき', 'びび', 'ちか', 'でん', 'えみ'];

    // 棚・ゲーム選択・プレイヤー設定・モード選択・ウィザードは素のまま
    const cart = doc.querySelector('.cart[data-cart="jinro"]');
    cart.click();
    if (activeScreen(doc) === 'scr-shelf') cart.click();
    await waitScreen(win, doc, 'scr-game', 3000);
    assert(!app.classList.contains('theme-wolf'), 'ゲーム選択では夜にしない');
    pickGame(doc, 'wolfrole');
    await sleep(win, 60);
    await fillPlayerForm(win, doc, players);
    await waitScreen(win, doc, 'scr-mode', 3000);
    assert(!app.classList.contains('theme-wolf'), 'モード選択では夜にしない');
    click(doc, doc.querySelector('.mode-card[data-id="wolf-casual"]'));
    click(doc, 'modeNextBtn');
    await waitScreen(win, doc, 'scr-set-wolfrole', 3000);
    assert(!app.classList.contains('theme-wolf'), '設定ウィザードでは夜にしない');
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
    await runWrHandoffs(win, doc, players.length);   // 役職確認 → 夜
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
