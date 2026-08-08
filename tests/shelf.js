// tests/shelf.js — 棚と扉まわり
//
// 扉が開いて棚が出る／カセットを選ぶ／並び替え／どこからでも棚に戻れる、を確認する。
// 「棚に戻る」導線は、プレイヤー設定で行き止まりになった実績があるので必ず通す。

const H = require('./harness');
const { launch, activeScreen, sleep, waitFor, waitScreen, el, click, fakeRects,
  setupPlayers, pickGame, createRunner, assert, assertEqual, assertNoErrors } = H;

function cart(doc, id) { return doc.querySelector('.cart[data-cart="' + id + '"]'); }
function cartIds(rail) { return Array.from(rail.querySelectorAll('.cart')).map(c => c.dataset.cart); }

// カセットを選ぶ（中央でなければ2回押して選択する）
function pickCart(doc, id) {
  const c = cart(doc, id);
  c.click();
  if (activeScreen(doc) === 'scr-shelf') c.click();
  return c;
}

(async function main() {
  const r = createRunner('shelf：棚と扉');

  await r.test('扉が自動で開き、棚が表示される（扉は残らない）', async () => {
    const { win, doc, errors } = await launch();
    assertEqual(activeScreen(doc), 'scr-shelf', '扉のあと棚に入る');
    // 扉が棚を覆ったままにならないこと（過去に起きやすい不具合）
    const door = el(doc, 'scr-door');
    assert(!door.classList.contains('active'), '扉の画面は非アクティブ');
    assertEqual(win.getComputedStyle(door).display, 'none', '扉は表示されていない');
    assertNoErrors(errors, '起動時に未捕捉の例外');
    win.close();
  });

  await r.test('棚の構成：3段・シール・カセットが並ぶ', async () => {
    const { win, doc, errors } = await launch();
    const stickers = Array.from(doc.querySelectorAll('#shelfList .sticker')).map(s => s.textContent);
    assertEqual(stickers.length, 3, '段は3つ');
    assertEqual(stickers[0], 'ことばであそぶ', '1段目のジャンル名');
    assert(!stickers.includes('ぜんぶ'), '「ぜんぶ」の段は出していない');
    assert(cart(doc, 'aresoredorekore'), 'あれそれどれこれのカセットがある');
    // ロゴ画像を貼っていること
    const logo = doc.querySelector('.cart[data-cart="aresoredorekore"] .cart-logo');
    assert(logo && /logo-aresoredorekore\.png$/.test(logo.getAttribute('src')), 'カセットにロゴ画像が貼られている');
    assertNoErrors(errors, '棚の描画で未捕捉の例外');
    win.close();
  });

  await r.test('近日公開のカセットを押しても棚に留まる（壊れない）', async () => {
    const { win, doc, errors } = await launch();
    const soon = doc.querySelector('.cart.soon');
    assert(soon, '近日公開のカセットがある');
    assert(soon.querySelector('.soon-tag'), '「近日公開予定」タグが付いている');
    soon.click(); soon.click();
    await sleep(win, 150);
    assertEqual(activeScreen(doc), 'scr-shelf', '押しても棚のまま');
    assertNoErrors(errors, '近日公開カセットで未捕捉の例外');
    win.close();
  });

  await r.test('カセットを選ぶと、初回はプレイヤー設定に進む', async () => {
    const { win, doc, errors } = await launch();
    pickCart(doc, 'aresoredorekore');
    await waitScreen(win, doc, 'scr-setup', 3000);
    assertNoErrors(errors, 'カセット選択で未捕捉の例外');
    win.close();
  });

  await r.test('2回目以降はプレイヤー設定を飛ばしてモード選択へ行く', async () => {
    const { win, doc, errors } = await launch();
    await setupPlayers(win, doc);           // 1回目：設定を通る
    await waitScreen(win, doc, 'scr-mode', 3000);
    click(doc, 'backToShelfBtn');
    await waitScreen(win, doc, 'scr-shelf', 3000);
    pickCart(doc, 'aresoredorekore');       // 2回目
    await waitScreen(win, doc, 'scr-mode', 3000);
    assertEqual(activeScreen(doc), 'scr-mode', '設定を飛ばしてモード選択へ');
    assertNoErrors(errors, '2回目の選択で未捕捉の例外');
    win.close();
  });

  // ---- 指示13で追加した「棚に戻る」導線 ----
  await r.test('プレイヤー設定から棚に戻れる（行き止まりにならない）', async () => {
    const { win, doc, errors } = await launch();
    pickCart(doc, 'aresoredorekore');
    await waitScreen(win, doc, 'scr-setup', 3000);
    const home = doc.querySelector('#scr-setup [data-go-shelf]');
    assert(home, 'プレイヤー設定に「棚にもどる」がある');
    home.click();
    await waitScreen(win, doc, 'scr-shelf', 3000);
    assertNoErrors(errors, 'プレイヤー設定からの復帰で未捕捉の例外');
    win.close();
  });

  await r.test('準備OK画面とモード説明にも「棚にもどる」がある', async () => {
    const { win, doc } = await launch();
    assert(doc.querySelector('#scr-ready [data-go-shelf]'), '準備OK画面にある');
    assert(doc.querySelector('#scr-mode-rules [data-go-shelf]'), 'モード説明にある');
    win.close();
  });

  await r.test('ウィザードには「棚へ」を置かず、もどるを繰り返せば棚に着く', async () => {
    const { win, doc, errors } = await launch();
    await setupPlayers(win, doc);
    await waitScreen(win, doc, 'scr-mode', 3000);
    click(doc, doc.querySelector('.mode-card[data-id="normal"]'));
    click(doc, 'modeNextBtn');

    // 一番奥の設定画面まで進む
    for (let i = 0; i < 8; i++) {
      const cur = activeScreen(doc);
      if (cur === 'scr-ready' || cur === 'scr-mode-rules') break;
      const next = doc.querySelector('#' + cur + ' [data-wiz-next]');
      if (!next) break;
      // 設定画面にはボタンが2つ（もどる・つぎへ）だけであること
      assert(!doc.querySelector('#' + cur + ' [data-go-shelf]'), cur + ' に「棚へ」を置かない');
      assertEqual(doc.querySelectorAll('#' + cur + ' .wiz-foot button').length, 2, cur + ' のボタンは2つ');
      next.click();
      await sleep(win, 25);
    }

    // 「もどる」だけで棚まで戻れること
    let presses = 0;
    while (activeScreen(doc) !== 'scr-shelf' && presses < 12) {
      const cur = activeScreen(doc);
      let btn = doc.querySelector('#' + cur + ' [data-wiz-back]');
      if (!btn && cur === 'scr-mode') btn = doc.getElementById('backToShelfBtn');
      if (!btn && cur === 'scr-mode-rules') btn = doc.querySelector('#scr-mode-rules [data-go-shelf]');
      if (!btn && cur === 'scr-ready') btn = doc.getElementById('readyBackBtn');
      if (!btn) break;
      btn.click();
      presses++;
      await sleep(win, 60);
    }
    assertEqual(activeScreen(doc), 'scr-shelf', 'もどるを繰り返すと棚に着く（' + presses + '回）');
    assertNoErrors(errors, '戻り操作で未捕捉の例外');
    win.close();
  });

  // ---- PC操作（指示13） ----
  await r.test('矢印ボタンで中央のカセットが移動し、端では無効になる', async () => {
    const { win, doc, errors } = await launch();
    const rail = doc.querySelector('#shelfList .rail[data-rail="word"]');
    fakeRects(win, doc, rail); // jsdomは座標を持たないので矩形を偽装する
    const inner = rail.parentNode;
    const left = inner.querySelector('.rail-arrow.left');
    const right = inner.querySelector('.rail-arrow.right');
    assert(left && right, '両端に矢印がある');
    assert(left.disabled, '先頭では左矢印が無効');

    const ids = cartIds(rail);
    right.click();
    await sleep(win, 60);
    assertEqual(rail.querySelector('.cart.center').dataset.cart, ids[1], '右矢印で次のカセットが中央になる');
    assert(!left.disabled, '移動後は左矢印が有効');
    left.click();
    await sleep(win, 60);
    assertEqual(rail.querySelector('.cart.center').dataset.cart, ids[0], '左矢印で戻る');
    assertNoErrors(errors, '矢印操作で未捕捉の例外');
    win.close();
  });

  await r.test('キーボードの左右でカセットを移動できる', async () => {
    const { win, doc, errors } = await launch();
    const rail = doc.querySelector('#shelfList .rail[data-rail="word"]');
    fakeRects(win, doc, rail);
    const ids = cartIds(rail);
    doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await sleep(win, 60);
    assertEqual(rail.querySelector('.cart.center').dataset.cart, ids[1], '→で次へ');
    doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    await sleep(win, 60);
    assertEqual(rail.querySelector('.cart.center').dataset.cart, ids[0], '←で戻る');
    assertNoErrors(errors, 'キーボード操作で未捕捉の例外');
    win.close();
  });

  await r.test('長押しドラッグで並び替えでき、localStorageに保存される', async () => {
    const { win, doc, errors } = await launch();
    const rail = doc.querySelector('#shelfList .rail[data-rail="word"]');
    const carts = fakeRects(win, doc, rail);
    const before = cartIds(rail);
    const a = carts[0], b = carts[1];
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();

    a.dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse', clientX: ra.left + 60, clientY: 10 }));
    await sleep(win, 520); // 長押し成立（450ms）を待つ
    assert(rail.classList.contains('reordering'), '並び替えモードに入る');
    assert(doc.getElementById('shelfReorderNote'), '操作の案内が出る');

    el(doc, 'shelfList').dispatchEvent(new win.PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse', clientX: rb.left + 60, clientY: 10 }));
    await sleep(win, 60);
    el(doc, 'shelfList').dispatchEvent(new win.PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }));
    await sleep(win, 100);

    const after = cartIds(rail);
    assertEqual(after[0], before[1], '順番が入れ替わる');
    assert(!rail.classList.contains('reordering'), '並び替えモードを抜ける');
    const saved = JSON.parse(win.localStorage.getItem('acac-shelf-order') || '{}');
    assertEqual((saved.word || [])[0], before[1], '並び順がlocalStorageに保存される');
    assertNoErrors(errors, '並び替えで未捕捉の例外');
    win.close();
  });

  // ---- 第16弾：人狼ゲームカセットが棚に出ている ----
  await r.test('人狼ゲームカセットが棚に出ていて、近日公開ではない', async () => {
    const { win, doc, errors } = await launch();
    const c = cart(doc, 'jinro');
    assert(c, '人狼ゲームのカセットが棚にある');
    assert(!c.classList.contains('soon'), '近日公開ではなく、遊べる状態');
    assert(!c.querySelector('.soon-tag'), '「近日公開予定」タグが付いていない');
    assertNoErrors(errors, '棚の描画で未捕捉の例外');
    win.close();
  });

  // ---- 第27弾：爆弾解除カセットが棚に出ている ----
  await r.test('爆弾解除カセットが棚に出ていて、近日公開ではない', async () => {
    const { win, doc, errors } = await launch();
    const c = cart(doc, 'bakudan');
    assert(c, '爆弾解除のカセットが棚にある');
    assert(!c.classList.contains('soon'), '近日公開ではなく、遊べる状態');
    assert(!c.querySelector('.soon-tag'), '「近日公開予定」タグが付いていない');
    assert(/爆弾/.test(c.textContent), 'カセットの名前が出ている');
    assertNoErrors(errors, '棚の描画で未捕捉の例外');
    win.close();
  });

  await r.test('爆弾解除カセット：2つのゲームから選べ、選んだ方のモードだけが出る', async () => {
    // 第27弾-3で実物解除が入り、ゲームが2つになったので選択画面を通る
    const { win, doc, errors } = await launch();
    pickCart(doc, 'bakudan');
    await waitScreen(win, doc, 'scr-game', 3000);
    const games = Array.from(doc.querySelectorAll('#gameCards .mode-card')).map(c2 => c2.dataset.game);
    assertEqual(games.join(','), 'bomb,defuse', 'クイズ解除と実物解除が並ぶ');

    pickGame(doc, 'bomb');
    await sleep(win, 60);
    await H.fillPlayerForm(win, doc, ['あき', 'びび']);
    await waitScreen(win, doc, 'scr-mode', 3000);
    const ids = Array.from(doc.querySelectorAll('#modeCards .mode-card')).map(c2 => c2.dataset.id);
    assertEqual(ids.join(','), 'bomb-coop,bomb-race', 'クイズ解除のモードだけが並ぶ');
    assertNoErrors(errors, '爆弾解除カセットで未捕捉の例外');
    win.close();
  });

  await r.test('実物解除は手渡しでは選べず、部屋が要ると理由が出る', async () => {
    // 解除役とマニュアル役が別々の画面を同時に見るのが肝なので、1台では成立しない
    const { win, doc, errors } = await launch();
    pickCart(doc, 'bakudan');
    await waitScreen(win, doc, 'scr-game', 3000);
    pickGame(doc, 'defuse');
    await sleep(win, 60);
    await H.fillPlayerForm(win, doc, ['あき', 'びび']);
    await waitScreen(win, doc, 'scr-mode', 3000);
    const cards = Array.from(doc.querySelectorAll('#modeCards .mode-card'));
    assertEqual(cards.map(c2 => c2.dataset.id).join(','), 'defuse,defuse-focus',
      '実物解除のモードだけが並ぶ');
    assert(cards.every(c2 => c2.classList.contains('locked')), 'どちらも手渡しでは選べない');
    assert(/部屋/.test(cards[0].dataset.locked), '部屋が要ると分かる');
    assertNoErrors(errors, '実物解除のモード一覧で未捕捉の例外');
    win.close();
  });

  await r.test('人狼ゲームカセット：ゲーム選択を経由し、選んだゲームのモードだけが出る', async () => {
    const { win, doc, errors } = await launch();
    pickCart(doc, 'jinro');
    // games が2件になったので scr-game を経由する
    await waitScreen(win, doc, 'scr-game', 3000);
    pickGame(doc, 'wordwolf');
    await sleep(win, 60);
    await H.fillPlayerForm(win, doc, ['あき', 'びび', 'ちか']);
    await waitScreen(win, doc, 'scr-mode', 3000);
    const ids = Array.from(doc.querySelectorAll('#modeCards .mode-card')).map(c2 => c2.dataset.id);
    assert(ids.indexOf('wordwolf') >= 0, 'ワードウルフがある');
    assert(ids.every(id => /^wordwolf/.test(id)),
      'ワードウルフのモードだけが並ぶ（人狼が混ざらない）: ' + ids.join(','));

    // 複数ゲームのカセットなので「もどる」はゲーム選択へ
    click(doc, 'backToShelfBtn');
    await waitScreen(win, doc, 'scr-game', 3000);
    assertNoErrors(errors, '人狼カセットの導線で未捕捉の例外');
    win.close();
  });

  await r.test('あれそれどれこれのモード一覧に、ワードウルフが混ざらない', async () => {
    const { win, doc, errors } = await launch();
    await setupPlayers(win, doc);
    await waitScreen(win, doc, 'scr-mode', 3000);
    const ids = Array.from(doc.querySelectorAll('#modeCards .mode-card')).map(c2 => c2.dataset.id);
    assert(ids.indexOf('wordwolf') === -1, 'ワードウルフが混ざらない（' + ids.join(',') + '）');
    assert(ids.length >= 5, 'あれそれどれこれのモードは揃っている');
    assertNoErrors(errors, 'モード一覧で未捕捉の例外');
    win.close();
  });

  // ---- 第18弾：人数上限をゲームごとに分ける ----
  await r.test('人数上限：あれそれどれこれは8人まで、人狼は8人を超えて増やせる', async () => {
    // あれそれどれこれ：物理カード由来の8人上限は据え置き
    const a = await launch();
    pickCart(a.doc, 'aresoredorekore');
    await waitScreen(a.win, a.doc, 'scr-setup', 3000);
    for (let i = 0; i < 20; i++) click(a.doc, 'playerPlusBtn');
    await sleep(a.win, 60);
    assertEqual(el(a.doc, 'playerCountLabel').textContent, '8', 'あれそれどれこれは8人が上限');
    assertNoErrors(a.errors, 'あれそれどれこれの人数設定で未捕捉の例外');
    a.win.close();

    // 人狼：上限なし（8人を超えて増やせる）
    const b = await launch();
    pickCart(b.doc, 'jinro');
    await waitScreen(b.win, b.doc, 'scr-game', 3000);
    pickGame(b.doc, 'wolfrole');
    await sleep(b.win, 60);
    await waitScreen(b.win, b.doc, 'scr-setup', 3000);
    for (let i = 0; i < 12; i++) click(b.doc, 'playerPlusBtn');
    await sleep(b.win, 60);
    const n = parseInt(el(b.doc, 'playerCountLabel').textContent, 10);
    assert(n > 8, '人狼は8人を超えて増やせる（' + n + '人）');
    assertEqual(b.doc.querySelectorAll('#nameRows .name-row').length, n, '人数ぶん入力欄が増える');
    assertNoErrors(b.errors, '人狼の人数設定で未捕捉の例外');
    b.win.close();
  });

  // ---- 第15弾：カセット → ゲーム → モードの3階層 ----
  // 複数ゲームのカセットは本番にまだ無いので、テスト時だけ差し込んで経路を確認する
  const MULTI = {
    id: 'testmulti', genre: 'word', ready: true, icon: '🧪', title: 'テスト用カセット',
    games: ['aresoredorekore', 'wordwolf'], meta: 'テスト用'
  };

  await r.test('ゲームが1つのカセットは、ゲーム選択を飛ばして直接すすむ', async () => {
    const { win, doc, errors } = await launch();
    pickCart(doc, 'aresoredorekore');
    await waitScreen(win, doc, 'scr-setup', 3000);
    assertEqual(activeScreen(doc), 'scr-setup', 'scr-game を経由しない');
    assertNoErrors(errors, '1ゲームのカセットで未捕捉の例外');
    win.close();
  });

  await r.test('ゲームが2つのカセットは、ゲーム選択画面が出る', async () => {
    const { win, doc, errors } = await launch({ testCassettes: [MULTI] });
    pickCart(doc, 'testmulti');
    await waitScreen(win, doc, 'scr-game', 3000);
    const cards = Array.from(doc.querySelectorAll('#gameCards .mode-card'));
    assertEqual(cards.length, 2, '2つのゲームが並ぶ');
    assert(/あれそれどれこれ/.test(cards[0].textContent), '1つ目はあれそれどれこれ');
    assert(/ワードウルフ/.test(cards[1].textContent), '2つ目はワードウルフ');
    assert(doc.querySelector('#scr-game [data-go-shelf]'), 'ゲーム選択にも「棚にもどる」がある');
    assertNoErrors(errors, 'ゲーム選択画面で未捕捉の例外');
    win.close();
  });

  await r.test('ゲームを選ぶと、そのゲームのモードだけがモード選択に出る', async () => {
    // ワードウルフは本番では hidden なので、モードが見える状態にして絞り込みを確かめる
    const { win, doc, errors } = await launch({ testCassettes: [MULTI], showHiddenModes: true });
    await setupPlayers(win, doc);          // 先にプレイヤーを登録しておく
    await waitScreen(win, doc, 'scr-mode', 3000);
    click(doc, 'backToShelfBtn');
    await waitScreen(win, doc, 'scr-shelf', 3000);

    pickCart(doc, 'testmulti');
    await waitScreen(win, doc, 'scr-game', 3000);
    // ワードウルフを選ぶ → ワードウルフのモードだけが出る
    pickGame(doc, 'wordwolf');
    await waitScreen(win, doc, 'scr-mode', 3000);
    const ids = Array.from(doc.querySelectorAll('#modeCards .mode-card')).map(c => c.dataset.id);
    assert(ids.indexOf('wordwolf') >= 0, 'ワードウルフが出る');
    assert(ids.every(id => /^wordwolf/.test(id)), 'ワードウルフのモードだけが並ぶ（' + ids.join(',') + '）');
    assert(ids.indexOf('normal') === -1, 'あれそれどれこれのモードが混ざらない');

    // あれそれどれこれを選び直すと、そちらのモードに切り替わる
    click(doc, 'backToShelfBtn');
    await waitScreen(win, doc, 'scr-game', 3000);
    pickGame(doc, 'aresoredorekore');
    await waitScreen(win, doc, 'scr-mode', 3000);
    const ids2 = Array.from(doc.querySelectorAll('#modeCards .mode-card')).map(c => c.dataset.id);
    assert(ids2.length >= 5, 'あれそれどれこれのモードが並ぶ（' + ids2.length + '件）');
    assert(ids2.indexOf('wordwolf') === -1, 'ワードウルフが混ざらない');
    assertNoErrors(errors, 'ゲーム切替で未捕捉の例外');
    win.close();
  });

  await r.test('モード選択の「もどる」：1ゲームなら棚、複数ゲームならゲーム選択へ', async () => {
    // 1ゲームのカセット → 棚に戻る
    const a = await launch();
    await setupPlayers(a.win, a.doc);
    await waitScreen(a.win, a.doc, 'scr-mode', 3000);
    click(a.doc, 'backToShelfBtn');
    await waitScreen(a.win, a.doc, 'scr-shelf', 3000);
    assertEqual(activeScreen(a.doc), 'scr-shelf', '1ゲームなら棚へ直接戻る');
    assertNoErrors(a.errors, '1ゲームの戻りで未捕捉の例外');
    a.win.close();

    // 2ゲームのカセット → ゲーム選択に戻る
    const b = await launch({ testCassettes: [MULTI] });
    await setupPlayers(b.win, b.doc);
    await waitScreen(b.win, b.doc, 'scr-mode', 3000);
    click(b.doc, 'backToShelfBtn');
    await waitScreen(b.win, b.doc, 'scr-shelf', 3000);
    pickCart(b.doc, 'testmulti');
    await waitScreen(b.win, b.doc, 'scr-game', 3000);
    pickGame(b.doc, 'aresoredorekore');
    await waitScreen(b.win, b.doc, 'scr-mode', 3000);
    click(b.doc, 'backToShelfBtn');
    await waitScreen(b.win, b.doc, 'scr-game', 3000);
    assertEqual(activeScreen(b.doc), 'scr-game', '複数ゲームならゲーム選択へ戻る');
    assertNoErrors(b.errors, '複数ゲームの戻りで未捕捉の例外');
    b.win.close();
  });

  await r.test('ゲームを終えると棚に戻り、扉は再表示されない', async () => {
    const { win, doc, errors } = await launch();
    win.confirm = () => true;
    await setupPlayers(win, doc);
    await waitScreen(win, doc, 'scr-mode', 3000);
    click(doc, 'modeAutoBtn');
    await sleep(win, 80);
    if (activeScreen(doc) === 'scr-mode-rules') { click(doc, 'rulesStartBtn'); await sleep(win, 60); }
    await waitScreen(win, doc, 'scr-ready', 3000);
    el(doc, 'holdBtn').dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true }));
    await waitScreen(win, doc, 'scr-play', 8000);

    click(doc, 'floatingGearBtn');
    await sleep(win, 60);
    click(doc, 'endGameBtn');
    await waitScreen(win, doc, 'scr-shelf', 5000);
    assertEqual(win.getComputedStyle(el(doc, 'scr-door')).display, 'none', '終了後に扉は出ない');
    assertNoErrors(errors, 'ゲーム終了で未捕捉の例外');
    win.close();
  });

  // ---- 第28弾-4：どの画面からも「一個前」に戻れる矢印 ----

  await r.test('戻る矢印：来た道を1つずつ戻れる', async () => {
    const { win, doc, errors } = await launch();
    const back = el(doc, 'floatingBackBtn');
    // 棚は起点なので出さない
    assertEqual(back.style.display, 'none', '棚では出ない');

    pickCart(doc, 'aresoredorekore');
    await waitScreen(win, doc, 'scr-setup', 3000);
    assert(back.style.display !== 'none', 'プレイヤー設定では出る');

    await H.fillPlayerForm(win, doc, ['あき', 'びび']);
    await waitScreen(win, doc, 'scr-mode', 3000);
    click(doc, doc.querySelector('.mode-card[data-id="normal"]'));
    click(doc, 'modeNextBtn');
    await sleep(win, 100);
    const wizard = activeScreen(doc);
    assert(/^scr-set-/.test(wizard), '設定ウィザードに入る（' + wizard + '）');

    // 1つ戻るとモード選択、もう1つ戻るとプレイヤー設定
    click(doc, 'floatingBackBtn');
    await waitScreen(win, doc, 'scr-mode', 3000);
    click(doc, 'floatingBackBtn');
    await waitScreen(win, doc, 'scr-setup', 3000);
    click(doc, 'floatingBackBtn');
    await waitScreen(win, doc, 'scr-shelf', 3000);
    assertEqual(back.style.display, 'none', '棚に着いたら出なくなる');
    assertNoErrors(errors, '戻る矢印で未捕捉の例外');
    win.close();
  });

  await r.test('戻る矢印：行ったり来たりしても、道が積み上がらない', async () => {
    // 押すたびに1つずつ戻れないと、何回押せば着くのか分からなくなる
    const { win, doc, errors } = await launch();
    await setupPlayers(win, doc);
    await waitScreen(win, doc, 'scr-mode', 3000);
    // モード⇄棚を3往復する
    for (let i = 0; i < 3; i++) {
      click(doc, 'backToShelfBtn');
      await waitScreen(win, doc, 'scr-shelf', 3000);
      pickCart(doc, 'aresoredorekore');
      await waitScreen(win, doc, 'scr-mode', 3000);
    }
    // 1回押せば棚に着く（往復ぶんが溜まっていない）
    click(doc, 'floatingBackBtn');
    await waitScreen(win, doc, 'scr-shelf', 3000);
    assertEqual(activeScreen(doc), 'scr-shelf', '1回で棚に着く');
    assertNoErrors(errors, '往復で未捕捉の例外');
    win.close();
  });

  await r.test('戻る矢印：遊んでいる最中は出さない（進行が壊れないように）', async () => {
    const { win, doc, errors } = await launch();
    await setupPlayers(win, doc);
    await waitScreen(win, doc, 'scr-mode', 3000);
    click(doc, doc.querySelector('.mode-card[data-id="normal"]'));
    click(doc, 'modeAutoBtn');
    await sleep(win, 100);
    if (activeScreen(doc) === 'scr-mode-rules') { click(doc, 'rulesStartBtn'); await sleep(win, 80); }
    await waitScreen(win, doc, 'scr-ready', 3000);
    assert(el(doc, 'floatingBackBtn').style.display !== 'none', '準備OKでは出る');

    el(doc, 'holdBtn').dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true }));
    await waitScreen(win, doc, 'scr-play', 9000);
    assertEqual(el(doc, 'floatingBackBtn').style.display, 'none',
      '遊んでいる最中は出さない（⚙から終わるのが正しい出口）');
    assertNoErrors(errors, 'プレイ中の戻る矢印で未捕捉の例外');
    win.close();
  });

  await r.test('戻る矢印：枠線だけの正方形で、画面の中の「もどる」と見分けられる', async () => {
    const fs = require('fs');
    const path = require('path');
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const rule = html.match(/\.floating-back\{[^}]*\}/);
    assert(rule, '.floating-back の決まりごとがある');
    assert(/background:transparent/.test(rule[0]), '枠線だけ（塗りつぶさない）');
    assert(/border:1\.5px solid/.test(rule[0]), '枠線がある');
    assert(/width:32px;height:32px/.test(rule[0]), '正方形');
    assert(/border-radius:4px/.test(rule[0]), '丸ではない（⚙と見分けられる）');
    // 画面の中の「もどる」は横長のボタンなので、位置でも形でも混ざらない
    assert(/position:absolute;top:6px;left:8px/.test(rule[0]), '画面の隅に置く');
  });

  // ---- 第27弾-2：下部バーを画面の下に固定する ----

  await r.test('下部バーは画面の下に貼り付き、本文の上に重なっても読める', async () => {
    // jsdom はレイアウトしないので、決まりごとそのものを読んで確かめる
    const fs = require('fs');
    const path = require('path');
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const bar = html.match(/\.shelf-bar\{[^}]*\}/);
    assert(bar, '.shelf-bar の決まりごとがある');
    assert(/position:sticky/.test(bar[0]), 'スクロールしても画面の下に留まる');
    assert(/bottom:0/.test(bar[0]), '留まる先は画面の下');
    // 本文の上に重なるので、背景が透けると読めなくなる
    assert(/background:var\(--card\)/.test(bar[0]), '背景が不透明');
    assert(/z-index:\s*\d/.test(bar[0]), '本文より前に出る');
    // iPhoneのホームバーに隠れないようにする
    assert(/safe-area-inset-bottom/.test(bar[0]), 'ホームバーぶんを避ける');
    // 棚の下の余白は0。残っていると、いちばん下でバーが跳ねる
    assert(/#scr-shelf\{padding:18px 0 0;\}/.test(html), '棚の下に余白を残さない');
    // スマホの 100vh はブラウザバーの裏まで含むので、dvh も併記する
    assert(/min-height:100dvh/.test(html), '実際に見えている高さ（dvh）も使う');
  });

  await r.test('下部バーの3つのボタンは、どれも押すと反応する', async () => {
    // 「押しにくい・反応しない」の報告があったので、的の大きさと反応の両方を見る
    const fs = require('fs');
    const path = require('path');
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const btns = html.match(/\.shelf-bar-btns \.btn\{[^}]*\}/);
    assert(btns && /min-height:44px/.test(btns[0]), 'ボタンの的が44px以上ある');
    const me = html.match(/\.shelf-me\{[^}]*\}/);
    assert(me && /min-height:44px/.test(me[0]), '名前のところの的も44px以上ある');

    const { win, doc, errors } = await launch();
    // 「部屋」
    click(doc, 'shelfRoomBtn');
    await waitScreen(win, doc, 'scr-rt-lobby', 3000);
    click(doc, 'rtLobbyBackBtn');
    await waitScreen(win, doc, 'scr-shelf', 3000);
    // 「称号」（ログイン済みなら押せる）
    click(doc, 'shelfMeBtn');
    await waitScreen(win, doc, 'scr-titles', 3000);
    click(doc, 'titlesBackBtn');
    await waitScreen(win, doc, 'scr-shelf', 3000);
    // 「設定」
    click(doc, 'shelfGearBtn');
    await sleep(win, 100);
    assert(el(doc, 'settingsOverlay').classList.contains('show'), '設定が開く');
    assertNoErrors(errors, '下部バーの操作で未捕捉の例外');
    win.close();
  });

  // ---- 第26弾 第2部：ログインしていなくても棚まで来られる ----

  await r.test('ログインしていなくても、扉のあとは棚に着く', async () => {
    const { win, doc, errors } = await launch({ loggedOut: true });
    assertEqual(activeScreen(doc), 'scr-shelf', 'ログイン画面で止めない');
    assert(doc.querySelector('.shelf-bar'), '下部バーが出ている');
    assert(doc.getElementById('shelfRoomBtn'), '「部屋」ボタンがある');
    assert(doc.getElementById('shelfGearBtn'), '「設定」ボタンがある');
    assertNoErrors(errors, '未ログインの起動で未捕捉の例外');
    win.close();
  });

  await r.test('未ログインの名前と二つ名は、候補から選ばれて開いている間は変わらない', async () => {
    const NAMES = ['準備中！', 'まだログインしてない', 'まだ待ってね', 'ログインしないと！'];
    const TITLES = ['まだ準備してるよ！', 'ログインしないとまだできない', 'みらいのげんせき', 'まだがんばっているとちゅう！'];
    const { win, doc, errors } = await launch({ loggedOut: true });
    const name0 = el(doc, 'shelfName').textContent;
    const title0 = el(doc, 'shelfTitle').textContent;
    assert(NAMES.includes(name0), '名前が候補の中から選ばれている：' + name0);
    assert(TITLES.includes(title0), '二つ名が候補の中から選ばれている：' + title0);

    // 画面を往復しても選び直さない（自分の名前がチラつくと壊れて見える）
    click(doc, 'shelfRoomBtn');
    await waitScreen(win, doc, 'scr-rt-lobby', 3000);
    click(doc, 'rtLobbyBackBtn');
    await waitScreen(win, doc, 'scr-shelf', 3000);
    assertEqual(el(doc, 'shelfName').textContent, name0, '名前は開いている間ずっと同じ');
    assertEqual(el(doc, 'shelfTitle').textContent, title0, '二つ名も同じ');
    assertNoErrors(errors, '未ログインの棚で未捕捉の例外');
    win.close();

    // 開き直した時は選び直してよい（同じ端末で必ず同じにはしない）
    const seen = new Set();
    for (let i = 0; i < 12; i++) {
      const t = await launch({ loggedOut: true });
      seen.add(el(t.doc, 'shelfName').textContent);
      t.win.close();
    }
    assert(seen.size > 1, '開き直すと選び直される（12回で' + seen.size + '種類）');
  });

  await r.test('ログインしていない人がカセットを押すと、ログインに案内される', async () => {
    const { win, doc, errors } = await launch({ loggedOut: true });
    pickCart(doc, 'aresoredorekore');
    await sleep(win, 80);
    assertEqual(activeScreen(doc), 'scr-login', '手渡しで遊ぶにはログインが要る');
    // 断らずに棚へ戻れる（行き止まりにしない）
    click(doc, 'loginBackBtn');
    await waitScreen(win, doc, 'scr-shelf', 3000);
    assertNoErrors(errors, 'ログイン案内で未捕捉の例外');
    win.close();
  });

  await r.test('ログインすると、頼まれた用事の続きに戻る', async () => {
    const { win, doc, errors } = await launch({ loggedOut: true, fakeSocket: true });
    click(doc, 'shelfRoomBtn');
    await waitScreen(win, doc, 'scr-rt-lobby', 3000);
    click(doc, 'rtCreateBtn'); // 立てるにはログインが要る
    await waitScreen(win, doc, 'scr-login', 3000);
    el(doc, 'loginUsername').value = 'test';
    el(doc, 'loginPassword').value = 'pw';
    click(doc, 'loginSubmitBtn');
    await waitScreen(win, doc, 'scr-rt-lobby', 4000);
    assertEqual(el(doc, 'shelfName').textContent, 'test', 'バーの名前がログイン名になる');
    assertNoErrors(errors, 'ログイン後の復帰で未捕捉の例外');
    win.close();
  });

  // ---- 第26弾 第4部：称号 ----

  await r.test('棚のバーから、称号を選び直せる', async () => {
    const { win, doc, errors } = await launch();
    await waitScreen(win, doc, 'scr-shelf', 4000);
    assert(!el(doc, 'shelfMeBtn').disabled, 'ログインしていれば押せる');
    click(doc, 'shelfMeBtn');
    await waitScreen(win, doc, 'scr-titles', 3000);
    assertEqual(el(doc, 'titlePreviewTitle').textContent, 'はじめの一歩', '初期の名乗り');
    assertEqual(el(doc, 'titlePreviewName').textContent, 'test', 'ユーザー名が出る');
    // 持っていないパーツは中身を伏せ、どうすれば手に入るかだけ見せる
    const locked = doc.querySelectorAll('#titleGroups .tg-item.locked');
    assert(locked.length > 0, 'まだ持っていないパーツも並んでいる（' + locked.length + '個）');
    assert(locked[0].disabled, '持っていないものは選べない');
    assert(/？？？/.test(locked[0].textContent), '中身は伏せる');
    assert(!/？？？/.test(locked[0].querySelector('.tg-hint').textContent), '手に入れ方は見せる');
    // 手渡しで自分の活躍として数えてもらう方法を案内する
    assert(/test/.test(el(doc, 'titleHandoffNote').textContent), '名前を合わせる案内が出る');
    click(doc, 'titlesBackBtn');
    await waitScreen(win, doc, 'scr-shelf', 3000);
    assertNoErrors(errors, '称号画面で未捕捉の例外');
    win.close();
  });

  await r.test('ログインしていない人は、称号を選べない', async () => {
    const { win, doc, errors } = await launch({ loggedOut: true });
    assert(el(doc, 'shelfMeBtn').disabled, '押せない（まだ持ち物が無い）');
    assertNoErrors(errors, '未ログインのバーで未捕捉の例外');
    win.close();
  });

  await r.test('あれそれどれこれを1回あそぶと、参加証が手に入る', async () => {
    // 手渡しでは「プレイヤー名＝ユーザー名」の人を本人とみなす。
    // ここでは本人がいない編成でも、遊んだ回数だけは数えることを確かめる
    const { win, doc, errors } = await launch();
    win.confirm = () => true;
    await setupPlayers(win, doc);
    await waitScreen(win, doc, 'scr-mode', 3000);
    click(doc, 'modeAutoBtn');
    await sleep(win, 80);
    if (activeScreen(doc) === 'scr-mode-rules') { click(doc, 'rulesStartBtn'); await sleep(win, 60); }
    await waitScreen(win, doc, 'scr-ready', 3000);
    el(doc, 'holdBtn').dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true }));
    await waitScreen(win, doc, 'scr-play', 8000);
    click(doc, 'btnCorrect');
    await sleep(win, 80);
    const who = doc.querySelectorAll('#pickerGrid button[data-id]');
    if (who.length) { who[0].click(); await sleep(win, 120); }
    click(doc, 'endRoundBtn');
    await waitScreen(win, doc, 'scr-score', 8000);

    // 称号の画面で、参加証が持ち物に入っている
    click(doc, 'chooseModeBtn');
    await waitScreen(win, doc, 'scr-mode', 3000);
    click(doc, 'backToShelfBtn');
    await waitScreen(win, doc, 'scr-shelf', 3000);
    click(doc, 'shelfMeBtn');
    await waitScreen(win, doc, 'scr-titles', 3000);
    const balloon = doc.querySelector('#titleGroups [data-tid="icon-are-1"]');
    assert(balloon && !balloon.classList.contains('locked'), '🎈 はじめの参加証が手に入っている');
    // 選んで確定すると、棚のバーに反映される
    balloon.click();
    await sleep(win, 60);
    click(doc, 'titlesDoneBtn');
    await waitScreen(win, doc, 'scr-shelf', 3000);
    assertEqual(el(doc, 'shelfAvatar').textContent, '🎈', 'バーのアイコンが変わる');
    assertNoErrors(errors, '称号の獲得で未捕捉の例外');
    win.close();
  });

  // ---- 第26弾 第4部（続き）：残りの3条件 ----

  await r.test('一言ヒント：ヒント1つで当てたら「聞き上手」が手に入る', async () => {
    // ヒントが何個出ていたかは、正解が出たその瞬間にしか分からない
    // （次のお題に進むと作り直される）。そこで数えられていることを確かめる
    const { win, doc, errors } = await launch();
    win.confirm = () => true;
    // 自分（test）を含む2人で、一言ヒントの遊び方を始める
    await setupPlayers(win, doc, ['test', 'びび']);
    await waitScreen(win, doc, 'scr-mode', 3000);
    click(doc, doc.querySelector('.mode-card[data-id="oneword"]'));
    click(doc, 'modeAutoBtn');
    await sleep(win, 100);
    if (activeScreen(doc) === 'scr-mode-rules') { click(doc, 'rulesStartBtn'); await sleep(win, 60); }
    await waitScreen(win, doc, 'scr-ready', 3000);
    el(doc, 'holdBtn').dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true }));
    await waitScreen(win, doc, 'scr-play', 8000);

    // 一言ヒントは出題者を置かないので、当てた側だけが数えられる
    click(doc, 'btnCorrect');
    await sleep(win, 80);
    const who = Array.from(doc.querySelectorAll('#pickerGrid button[data-id]'));
    const meBtn = who.find(b => /test/.test(b.textContent)) || who[0];
    meBtn.click();
    await sleep(win, 150);
    click(doc, 'endRoundBtn');
    await waitScreen(win, doc, 'scr-score', 8000);

    const stats = win.eval('JSON.stringify(0)') && null; // 内部は見ないで、画面から確かめる
    click(doc, 'chooseModeBtn');
    await waitScreen(win, doc, 'scr-mode', 3000);
    click(doc, 'backToShelfBtn');
    await waitScreen(win, doc, 'scr-shelf', 3000);
    click(doc, 'shelfMeBtn');
    await waitScreen(win, doc, 'scr-titles', 3000);
    const kiki = doc.querySelector('#titleGroups [data-tid="first-kikijozu"]');
    assert(kiki && !kiki.classList.contains('locked'),
      'ヒント1つで当てたので「聞き上手」が手に入る');
    assertNoErrors(errors, '一言ヒントの称号で未捕捉の例外');
    win.close();
  });

  await r.test('一言ヒント：もう一言もらってから当てたら、数えない', async () => {
    const { win, doc, errors } = await launch();
    win.confirm = () => true;
    await setupPlayers(win, doc, ['test', 'びび']);
    await waitScreen(win, doc, 'scr-mode', 3000);
    click(doc, doc.querySelector('.mode-card[data-id="oneword"]'));
    click(doc, 'modeAutoBtn');
    await sleep(win, 100);
    if (activeScreen(doc) === 'scr-mode-rules') { click(doc, 'rulesStartBtn'); await sleep(win, 60); }
    await waitScreen(win, doc, 'scr-ready', 3000);
    el(doc, 'holdBtn').dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true }));
    await waitScreen(win, doc, 'scr-play', 8000);

    click(doc, 'moreHintBtn');            // ヒントを増やしてもらう
    await sleep(win, 250);
    click(doc, 'btnCorrect');
    await sleep(win, 80);
    const who = Array.from(doc.querySelectorAll('#pickerGrid button[data-id]'));
    (who.find(b => /test/.test(b.textContent)) || who[0]).click();
    await sleep(win, 150);
    click(doc, 'endRoundBtn');
    await waitScreen(win, doc, 'scr-score', 8000);

    click(doc, 'chooseModeBtn');
    await waitScreen(win, doc, 'scr-mode', 3000);
    click(doc, 'backToShelfBtn');
    await waitScreen(win, doc, 'scr-shelf', 3000);
    click(doc, 'shelfMeBtn');
    await waitScreen(win, doc, 'scr-titles', 3000);
    const kiki = doc.querySelector('#titleGroups [data-tid="first-kikijozu"]');
    assert(kiki && kiki.classList.contains('locked'),
      'ヒントを増やしてもらったら「一発」ではない');
    assertNoErrors(errors, 'ヒント追加の称号で未捕捉の例外');
    win.close();
  });

  r.finish();
})();
