// tests/smoke.js — 実装済み全モードのセットアップを一周させ、play画面まで到達できることを確認する
//
// 「別の変更で他のモードが壊れる」ことが何度かあったため、非表示中の独立ゲームも含めて全部通す。
// 過去の再発防止ケース：
//   - ワードウルフの設定画面でクラッシュ（未捕捉例外を見逃した）
//   - サバイバルの脱落フラグが他モードに残る
//   - タイマーを 00:00 に設定できてしまう

const H = require('./harness');
const { launch, activeScreen, sleep, waitScreen, el, click, fillPlayerForm, createRunner, assert, assertEqual, assertNoErrors } = H;

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
  const gcard = doc.querySelector('#gameCards .mode-card[data-game="' + gameId + '"]');
  assert(gcard, 'ゲーム ' + gameId + ' がカセットに含まれる');
  gcard.click();
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
    doc.querySelector('#gameCards .mode-card[data-game="wordwolf"]').click();
    await sleep(win, 60);
    await fillPlayerForm(win, doc, PLAYERS);
    await waitScreen(win, doc, 'scr-mode', 3000);
    const ids = Array.from(doc.querySelectorAll('#modeCards .mode-card')).map(c => c.dataset.id);
    assert(ids.indexOf('wordwolf') >= 0, 'モード選択にワードウルフがある');
    assert(ids.indexOf('wordwolf-multi') >= 0, '2〜ターン版も並ぶ');
    assert(ids.every(id => /^wordwolf/.test(id)), 'ワードウルフのモードだけが並ぶ（' + ids.join(',') + '）');

    click(doc, doc.querySelector('.mode-card[data-id="wordwolf"]'));
    click(doc, 'modeAutoBtn');
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
    doc.querySelector('#gameCards .mode-card[data-game="wolfrole"]').click();
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
      click(doc, 'wrToVoteBtn');
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
    doc.querySelector('#gameCards .mode-card[data-game="wolfrole"]').click();
    await sleep(win, 60);
    await fillPlayerForm(win, doc, PLAYERS);
    await waitScreen(win, doc, 'scr-mode', 3000);
    const ids = Array.from(doc.querySelectorAll('#modeCards .mode-card')).map(c => c.dataset.id);
    assert(ids.length >= 6, 'プリセットが6枚以上並ぶ（' + ids.length + '枚）');
    ['wolf-casual', 'wolf-normal', 'wolf-special', 'wolf-quick', 'wolf-deep', 'wolf-chaos'].forEach(id => {
      assert(ids.indexOf(id) >= 0, id + ' がモードカードとして並ぶ');
    });
    assert(ids.every(id => /^wolf-/.test(id)), 'ワードウルフのモードが混ざらない');
    assertNoErrors(errors, 'ゲーム選択で未捕捉の例外');
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
    doc.querySelector('#gameCards .mode-card[data-game="wolfrole"]').click();
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
      if (cur === 'scr-wr-pass') {
        click(doc, 'wrRevealBtn');
        await sleep(win, 30);
        const c = doc.querySelector('#wrChoiceGrid button[data-choice]');
        if (c) c.click(); else click(doc, 'wrNextBtn');
        await sleep(win, 40);
      } else if (cur === 'scr-wr-day') {
        click(doc, 'wrToVoteBtn');
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
    doc.querySelector('#gameCards .mode-card[data-game="wordwolf"]').click();
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
