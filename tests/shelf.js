// tests/shelf.js — 棚と扉まわり
//
// 扉が開いて棚が出る／カセットを選ぶ／並び替え／どこからでも棚に戻れる、を確認する。
// 「棚に戻る」導線は、プレイヤー設定で行き止まりになった実績があるので必ず通す。

const H = require('./harness');
const { launch, activeScreen, sleep, waitFor, waitScreen, el, click, fakeRects,
  setupPlayers, pickGame, createRunner, assert, assertEqual, assertNoErrors, chooseNext, autoDialog } = H;

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

  await r.test('棚の構成：段・シール・カセットが並び、どの段も空にならない', async () => {
    const { win, doc, errors } = await launch();
    const stickers = Array.from(doc.querySelectorAll('#shelfList .sticker')).map(s => s.textContent);
    assertEqual(stickers[0], 'ことばであそぶ', '1段目のジャンル名');
    assert(!stickers.includes('ぜんぶ'), '「ぜんぶ」の段は出していない');
    // 第32弾-A-3-8：段の構成を実態に合わせ直した
    ['ことばであそぶ', '正体をさぐる', 'あたまをつかう', 'かけひき', 'からだをうごかす']
      .forEach((label) => {
        assert(stickers.includes(label), '「' + label + '」の段がある');
      });
    // 空の段を出さない（何も無い棚は壊れて見える）
    doc.querySelectorAll('#shelfList .rail').forEach((rail) => {
      assert(rail.querySelectorAll('.cart').length > 0, 'どの段にもカセットが並んでいる');
    });
    // 爆弾解除は、クイズ解除（頭）と実物解除（体）の両方が入っているので2段に並ぶ
    assertEqual(doc.querySelectorAll('.cart[data-cart="bakudan"]').length, 2,
      '性格の違うゲームが入ったカセットは、両方の段から見つかる');
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
    autoDialog(win, doc);
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

  await r.test('戻る矢印：枠線を出さず、矢印だけを画面の隅に置く', async () => {
    // 第32弾-A-3-4：正方形の枠線が文字に被って違和感があったので枠を消した。
    // 押せる大きさ（32px）は残す
    const fs = require('fs');
    const path = require('path');
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const rule = html.match(/\.floating-back\{[^}]*\}/);
    assert(rule, '.floating-back の決まりごとがある');
    assert(/background:transparent/.test(rule[0]), '塗りつぶさない');
    assert(/border:none/.test(rule[0]), '枠線を出さない');
    assert(/width:32px;height:32px/.test(rule[0]), '押せる大きさは残す');
    assert(/position:absolute;top:6px;left:8px/.test(rule[0]), '画面の隅に置く');
    // テーマ側でも枠線を足し直していないこと（片方だけ直す事故を防ぐ）
    const themed = html.match(/\.app\.theme-[a-z]+ \.floating-back\{[^}]*\}/g) || [];
    themed.forEach((t) => {
      assertEqual(/border(-color)?:/.test(t), false, 'テーマ側でも枠線を足していない：' + t);
    });
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
    // 第32弾-A：部屋への入口の本筋は「あそびかたをえらぶ」画面。
    // 第32弾-C：棚を見ている最中に思い立った時のため、下部バーにも近道を戻した
    assert(doc.getElementById('shelfRoomBtn'), '下部バーから部屋へ行ける');
    // 代わりに、棚の見出しからあそびかたを選び直せる
    click(doc, 'shelfFlowBtn');
    await waitScreen(win, doc, 'scr-howto', 3000);
    click(doc, doc.querySelector('#scr-howto [data-howto="handoff"]'));
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

  await r.test('扉のあとは「あそびかたをえらぶ」に着く', async () => {
    // 第32弾-A：ここで何台で遊ぶかが決まるので、このあとの棚には
    // その遊び方でちゃんと遊べるものだけが並ぶ
    const { win, doc, errors } = await launch({ loggedOut: true, playFlow: false });
    assertEqual(activeScreen(doc), 'scr-howto', '扉の次はあそびかた');
    const cards = doc.querySelectorAll('#scr-howto [data-howto]');
    assertEqual(cards.length, 3, '3つの入口がある');
    const ids = Array.from(cards).map(c => c.dataset.howto).join(',');
    assertEqual(ids, 'handoff,room,browse', '1台・みんなのスマホ・見るだけ');
    assertNoErrors(errors, '未ログインの起動で未捕捉の例外');
    win.close();
  });

  await r.test('ログインしていなくても「棚を見る」なら棚に着く', async () => {
    const { win, doc, errors } = await launch({ loggedOut: true, playFlow: 'browse' });
    assertEqual(activeScreen(doc), 'scr-shelf', 'ログイン画面で止めない');
    assert(doc.querySelector('.shelf-bar'), '下部バーが出ている');
    assert(doc.getElementById('shelfGearBtn'), '「設定」ボタンがある');
    assert(doc.getElementById('shelfFlowBtn'), 'あそびかたを選び直すボタンがある');
    assertNoErrors(errors, '未ログインの起動で未捕捉の例外');
    win.close();
  });

  await r.test('「棚を見る」では、タップしても遊び始めずに説明が出る', async () => {
    const { win, doc, errors } = await launch({ loggedOut: true, playFlow: 'browse' });
    pickCart(doc, 'jinro');
    await waitScreen(win, doc, 'scr-cassette', 3000);
    const text = el(doc, 'scr-cassette').textContent;
    assert(/1台でもあそべる|1台では遊べません/.test(text), '1台で遊べるかが分かる');
    assert(/みんなのスマホ/.test(text), 'みんなのスマホで遊べるかも分かる');
    assert(/人狼|ワードウルフ/.test(text), '中に入っているゲームが分かる');
    // 「このゲームであそぶ」を押すと、あそびかたを選ぶ画面に戻る
    click(doc, 'ctPlayBtn');
    await waitScreen(win, doc, 'scr-howto', 3000);
    assertNoErrors(errors, 'カセットの説明で未捕捉の例外');
    win.close();
  });

  await r.test('未ログインの名前と二つ名は、候補から選ばれて開いている間は変わらない', async () => {
    const NAMES = ['準備中！', 'まだログインしてない', 'まだ待ってね', 'ログインしないと！'];
    const TITLES = ['まだ準備してるよ！', 'ログインしないとまだできない', 'みらいのげんせき', 'まだがんばっているとちゅう！'];
    const { win, doc, errors } = await launch({ loggedOut: true, playFlow: 'browse' });
    const name0 = el(doc, 'shelfName').textContent;
    const title0 = el(doc, 'shelfTitle').textContent;
    assert(NAMES.includes(name0), '名前が候補の中から選ばれている：' + name0);
    assert(TITLES.includes(title0), '二つ名が候補の中から選ばれている：' + title0);

    // 画面を往復しても選び直さない（自分の名前がチラつくと壊れて見える）
    click(doc, 'shelfFlowBtn');
    await waitScreen(win, doc, 'scr-howto', 3000);
    click(doc, doc.querySelector('#scr-howto [data-howto="browse"]'));
    await waitScreen(win, doc, 'scr-shelf', 3000);
    assertEqual(el(doc, 'shelfName').textContent, name0, '名前は開いている間ずっと同じ');
    assertEqual(el(doc, 'shelfTitle').textContent, title0, '二つ名も同じ');
    assertNoErrors(errors, '未ログインの棚で未捕捉の例外');
    win.close();

    // 開き直した時は選び直してよい（同じ端末で必ず同じにはしない）
    const seen = new Set();
    for (let i = 0; i < 12; i++) {
      const t = await launch({ loggedOut: true, playFlow: 'browse' });
      seen.add(el(t.doc, 'shelfName').textContent);
      t.win.close();
    }
    assert(seen.size > 1, '開き直すと選び直される（12回で' + seen.size + '種類）');
  });

  await r.test('ログインしていない人が「1台であそぶ」を選ぶと、ログインに案内される', async () => {
    // 第32弾-A：手渡しは遊んだ記録を残すので、あそびかたを選んだ時点でログインを頼む
    const { win, doc, errors } = await launch({ loggedOut: true, playFlow: false });
    click(doc, doc.querySelector('#scr-howto [data-howto="handoff"]'));
    await sleep(win, 80);
    assertEqual(activeScreen(doc), 'scr-login', '手渡しで遊ぶにはログインが要る');
    // 断らずに戻れる（行き止まりにしない）
    click(doc, 'loginBackBtn');
    await waitScreen(win, doc, 'scr-howto', 3000);
    assertNoErrors(errors, 'ログイン案内で未捕捉の例外');
    win.close();
  });

  await r.test('ログインすると、頼まれた用事の続きに戻る', async () => {
    const { win, doc, errors } = await launch({ loggedOut: true, fakeSocket: true, playFlow: false });
    click(doc, doc.querySelector('#scr-howto [data-howto="room"]'));
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
    // 第32弾-B-2：ここはプロフィール。変えたいものを選ぶと専用画面が開く
    assert(doc.querySelector('[data-profgo="icon"]'), 'アイコンを変える入口がある');
    assert(doc.querySelector('[data-profgo="name2"]'), '二つ名を変える入口がある');
    assert(doc.querySelector('[data-profgo="collection"]'), '集めたものへの入口がある');
    // 持っていないパーツは影で出し、どうすれば手に入るかだけ見せる
    doc.querySelector('[data-profgo="icon"]').click();
    await waitScreen(win, doc, 'scr-title-icon', 3000);
    const locked = doc.querySelectorAll('#tiGroups .ti-item.locked');
    assert(locked.length > 0, 'まだ持っていないパーツも並んでいる（' + locked.length + '個）');
    assert(/？？？/.test(locked[0].textContent), '中身は伏せる');
    assert(locked[0].querySelector('.ti-hint'), '手に入れ方は見せる');
    click(doc, 'tiBackBtn');
    await waitScreen(win, doc, 'scr-titles', 3000);
    // 手渡しで自分の活躍として数えてもらう方法を案内する
    assert(/test/.test(el(doc, 'titleHandoffNote').textContent), '名前を合わせる案内が出る');
    click(doc, 'titlesBackBtn');
    await waitScreen(win, doc, 'scr-shelf', 3000);
    assertNoErrors(errors, '称号画面で未捕捉の例外');
    win.close();
  });

  // ---- 第32弾-B 第3部：絵文字をSVGにそろえる ----

  await r.test('絵文字はSVGに差し替わり、必要なぶんだけ読み込む', async () => {
    const { win, doc, errors } = await launch();
    await sleep(win, 200);
    const imgs = Array.from(doc.querySelectorAll('#app .emj img'));
    assert(imgs.length > 10, '絵文字がSVGに差し替わっている（' + imgs.length + '個）');
    imgs.forEach((im) => {
      assert(/^img\/emoji\/[0-9a-f-]+\.svg$/.test(im.getAttribute('src')),
        'SVGを指している：' + im.getAttribute('src'));
      assertEqual(im.getAttribute('loading'), null,
        '遅延読み込みは付けない（2〜4KBのアイコンには向かず、読み込みが始まらない環境がある）');
    });
    assertNoErrors(errors, '絵文字の差し替えで未捕捉の例外');
    win.close();
  });

  await r.test('絵文字を差し替えても、元の文字はDOMに残る', async () => {
    // 画像が読めなかった時に文字で出るようにするため。
    // 「絵文字が消えてボタンが空になる」という壊れ方をさせない
    const { win, doc, errors } = await launch();
    await sleep(win, 200);
    assertEqual(el(doc, 'shelfAvatar').textContent, '🙂', 'アイコンの文字が残っている');
    const span = doc.querySelector('#app .emj');
    assert(span.querySelector('.emj-txt'), '文字を持つ入れ物がある');
    // 画像が読めた時にだけ入れ替える（読めない時に何も出ない、を作らない）
    assertEqual(span.classList.contains('emj-ok'), false, '読めるまでは文字のまま');
    assertEqual(span.getAttribute('role'), 'img', '画像として読み上げられる');
    assert(span.getAttribute('aria-label'), '読み上げ用の名前が付いている');
    assertNoErrors(errors, '絵文字の差し替えで未捕捉の例外');
    win.close();
  });

  await r.test('UIの記号（← → ★ ✕）は、絵文字にせず文字のまま出す', async () => {
    // Twemoji にも入っていない、絵文字ではない記号。
    // 手元にあるSVGとだけ突き合わせるので、勝手に画像にならないし、
    // 読めない画像（壊れたアイコン）も出ない
    const { win, doc, errors } = await launch();
    await sleep(win, 200);
    assertEqual(el(doc, 'floatingBackBtn').querySelectorAll('img').length, 0, '戻る矢印は文字のまま');
    assertEqual(el(doc, 'floatingBackBtn').textContent, '←', '矢印が消えていない');
    const EmojiSvg = require('../public/js/emoji');
    EmojiSvg.setFiles(require('../public/js/emoji-list'));
    ['←', '→', '★', '✕'].forEach((ch) => {
      assertEqual(EmojiSvg.html(ch), ch, '「' + ch + '」は差し替えない');
    });
    assert(EmojiSvg.html('🐺') !== '🐺', '絵文字はちゃんと差し替える');
    assertNoErrors(errors, 'UI記号の表示で未捕捉の例外');
    win.close();
  });

  await r.test('置いてあるSVGと一覧ファイルが食い違っていない', async () => {
    // 一覧を手で書くと、ファイルを足した時に更新し忘れる。
    // node tools/gen-emoji-list.js で作り直せる
    const fs = require('fs');
    const path = require('path');
    const dir = path.join(__dirname, '..', 'public', 'img', 'emoji');
    const onDisk = fs.readdirSync(dir).filter(f => f.endsWith('.svg'))
      .map(f => f.replace(/\.svg$/, '')).sort();
    const listed = require('../public/js/emoji-list').slice().sort();
    assertEqual(listed.join(','), onDisk.join(','), '一覧と置いてあるファイルが一致する');
    assert(onDisk.length > 50, '使っている絵文字ぶんが置いてある（' + onDisk.length + '個）');
  });

  await r.test('アプリで使っている絵文字が、全部そろっている', async () => {
    // 新しい絵文字を使った時に、SVGを置き忘れたまま出さないための見張り
    const fs = require('fs');
    const path = require('path');
    const EmojiSvg = require('../public/js/emoji');
    const root = path.join(__dirname, '..');
    let text = '';
    // 見るファイルの一覧は、作り直すツール（tools/gen-emoji-list.js）が正本。
    // ここに手書きで並べていた頃は、ツール側の方が狭くて、
    // ツールが「足りない」と言わないのにテストだけ赤くなる状態だった（落とし穴20）
    const EmojiTool = require('../tools/gen-emoji-list.js');
    EmojiTool.SOURCES
      .forEach((f) => {
        const p = path.join(root, f);
        if (fs.existsSync(p)) text += fs.readFileSync(p, 'utf8');
      });
    const used = EmojiSvg.collect(text);
    const listed = {};
    require('../public/js/emoji-list').forEach((n) => { listed[n] = true; });
    // 「絵文字にしない記号」もツールが正本（← → ★ ✕ ✚ ✓ と、すごろくの駒 ♥ ♣）。
    // 形で見分けるための記号なので、絵になると読めなくなる
    const NOT_EMOJI = EmojiTool.NOT_EMOJI;
    const missing = Object.keys(used)
      .filter((ch) => !listed[used[ch]] && NOT_EMOJI.indexOf(used[ch]) === -1)
      .map((ch) => ch + '(' + used[ch] + ')');
    assertEqual(missing.join(' '), '', 'SVGを置き忘れている絵文字が無い');
  });

  // ---- 第32弾-B 第2部：称号の画面 ----

  await r.test('二つ名は、スロットごとの一覧から選ぶ（獲得済みが上）', async () => {
    const { win, doc, errors } = await launch();
    click(doc, 'shelfMeBtn');
    await waitScreen(win, doc, 'scr-titles', 3000);
    doc.querySelector('[data-profgo="name2"]').click();
    await waitScreen(win, doc, 'scr-title-name', 3000);
    assertEqual(doc.querySelectorAll('#tnSlots .tn-slot').length, 3, '3つのスロットが並ぶ');
    assertEqual(el(doc, 'tnPreview').textContent, 'はじめの一歩', 'プレビューが常に上にある');

    doc.querySelector('[data-tnslot="first"]').click();
    await waitScreen(win, doc, 'scr-title-slot', 3000);
    const rows = Array.from(doc.querySelectorAll('#tsList .ts-row'));
    assert(rows.length > 1, 'そのスロットの候補が並ぶ');
    // 獲得済みが上、未獲得は下
    const firstLocked = rows.findIndex(x => x.classList.contains('locked'));
    const lastOwned = rows.map(x => x.classList.contains('locked')).lastIndexOf(false);
    assert(lastOwned < firstLocked, '獲得済みが上、未獲得が下');
    assert(/？？？/.test(rows[firstLocked].textContent), '未獲得は中身を伏せる');
    assert(rows[firstLocked].querySelector('.ts-hint'), '未獲得は条件が読める');
    assertNoErrors(errors, '二つ名の画面で未捕捉の例外');
    win.close();
  });

  await r.test('集めたものに、カセットごとの獲得率が出る', async () => {
    const { win, doc, errors } = await launch();
    click(doc, 'shelfMeBtn');
    await waitScreen(win, doc, 'scr-titles', 3000);
    doc.querySelector('[data-profgo="collection"]').click();
    await waitScreen(win, doc, 'scr-collection', 3000);
    const bars = doc.querySelectorAll('#collectBody .tg-cas-bar');
    assert(bars.length >= 5, 'カセットごとにバーが出る（' + bars.length + '本）');
    const text = el(doc, 'collectBody').textContent;
    ['人狼', 'あれそれどれこれ', '爆弾', 'クイズ', 'オーク'].forEach((w) => {
      assert(text.indexOf(w) !== -1, '「' + w + '」の区切りがある');
    });
    assert(/\d+ \/ \d+/.test(text), '「持っている数 / 全部の数」が出る');
    assertNoErrors(errors, '集めたもので未捕捉の例外');
    win.close();
  });

  await r.test('手に入った瞬間に、何をなぜ手に入れたかが大きく出る', async () => {
    const { win, doc, errors } = await launch();
    autoDialog(win, doc);
    // このテストが見るのは演出の仕組み。実行する日が季節イベント中だと
    // 季節のパーツも同時に手に入って装備が変わるので、季節は切っておく
    win.TitleLogic.seasonFor = () => null;
    // あれそれどれこれを1回あそぶと「はじめの参加証」が手に入る
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
    await sleep(win, 200);

    assert(el(doc, 'titleGotOverlay').classList.contains('show'), '手に入った演出が出る');
    const got = el(doc, 'gotList').textContent;
    assert(/はじめの参加証/.test(got), '何を手に入れたかが出る');
    assert(/あそぶ/.test(got), 'なぜ手に入ったかも出る');
    // その場で着けられる
    click(doc, 'gotEquipBtn');
    await sleep(win, 150);
    assert(!el(doc, 'titleGotOverlay').classList.contains('show'), '閉じる');
    assertEqual(el(doc, 'shelfAvatar').textContent, '🎈', 'すぐ着けられる');
    assertNoErrors(errors, '獲得の演出で未捕捉の例外');
    win.close();
  });

  // ---- 第32弾-D 第4部：安全の案内と安全に関する設定 ----

  await r.test('初回は扉の前に安全の案内が出て、その場でオフにできる（第32弾-D 第4部）', async () => {
    const { win, doc, errors } = await launch({ keepSafetyGate: true });
    await sleep(win, 400);
    assert(el(doc, 'safetyGate').style.display !== 'none', '安全の案内が出ている');
    assertEqual(activeScreen(doc), 'scr-door', '扉はまだ開かない');
    // 読むだけでなく、その場で自衛できる
    click(doc, 'sgShakeBtn');
    await sleep(win, 30);
    assert(!el(doc, 'sgShakeBtn').classList.contains('on'), '画面の揺れをその場でオフにできる');
    assert(el(doc, 'app').classList.contains('no-shake'), '切った瞬間から効いている');
    click(doc, 'sgStartBtn');
    await waitFor(win, () => activeScreen(doc) !== 'scr-door', 4000, '扉が開く');
    assertEqual(el(doc, 'safetyGate').style.display, 'none', '案内は閉じた');
    assertEqual(win.localStorage.getItem('acac-safety-seen'), '1', '2回目からは出ない印が残る');
    assertNoErrors(errors, '安全の案内で未捕捉の例外');
    win.close();
  });

  await r.test('安全に関する設定に、光・揺れ・振動・速さ・体を動かす演出が並ぶ', async () => {
    const t = await launch();
    click(t.doc, 'shelfGearBtn');
    await sleep(t.win, 100);
    t.doc.querySelector('#setRootMenu [data-setpage="app"]').click();
    await sleep(t.win, 60);
    const row = t.doc.querySelector('#setAppMenu [data-setpage="safety"]');
    assert(row, '「安全に関する設定」の入口がある');
    row.click();
    await sleep(t.win, 60);
    ['setFlashToggle', 'setShakeToggle', 'setVibrateToggle', 'setFxSeg', 'setBodyToggle']
      .forEach((id) => assert(el(t.doc, id), id + ' が並んでいる'));
    // 光の点滅を切ると、その瞬間から画面に印がつく（CSSがまとめて止める）
    click(t.doc, 'setFlashToggle');
    await sleep(t.win, 30);
    assert(el(t.doc, 'app').classList.contains('no-flash'), '光の点滅オフが効いている');
    assertEqual(t.win.FxKit._cfg.can.flash(), false, '演出部品からも見える');
    assertNoErrors(t.errors, '安全に関する設定で未捕捉の例外');
    t.win.close();
  });

  // ---- 第32弾-F：季節イベント ----

  // あれそれどれこれを1ラウンド遊びきる（季節の数えは、遊んだ事実だけに紐づく）
  async function playOneRound(t){
    await setupPlayers(t.win, t.doc);
    await waitScreen(t.win, t.doc, 'scr-mode', 3000);
    click(t.doc, 'modeAutoBtn');
    await sleep(t.win, 80);
    if (activeScreen(t.doc) === 'scr-mode-rules') { click(t.doc, 'rulesStartBtn'); await sleep(t.win, 60); }
    await waitScreen(t.win, t.doc, 'scr-ready', 3000);
    el(t.doc, 'holdBtn').dispatchEvent(new t.win.PointerEvent('pointerdown', { bubbles: true }));
    await waitScreen(t.win, t.doc, 'scr-play', 8000);
    click(t.doc, 'btnCorrect');
    await sleep(t.win, 80);
    const who = t.doc.querySelectorAll('#pickerGrid button[data-id]');
    if (who.length) { who[0].click(); await sleep(t.win, 120); }
    click(t.doc, 'endRoundBtn');
    await waitScreen(t.win, t.doc, 'scr-score', 8000);
    await waitFor(t.win, () => (t.win.__titlePuts || []).length >= 1, 4000, '称号を預けにいく');
    const puts = t.win.__titlePuts;
    return puts[puts.length - 1].stats;
  }

  await r.test('季節イベント：期間中に集まって遊ぶと、その1回だけが数えられる（第32弾-F）', async () => {
    const t = await launch();
    // 期間の判定だけ差し替える（実行する日の日付に左右されないテストにする）
    // 第36弾 36-7：いま登録されているのはリリース記念。
    // 数えるところは「季節のid＋Plays」で引いているので、季節を入れ替えても書き換えは要らない
    t.win.TitleLogic.seasonFor = () => ({ id: 'release', label: 'リリース記念', icon: '🎊', theme: 'season-release' });
    const stats = await playOneRound(t);
    assertEqual(stats.season.releasePlays, 1, '集まって遊んだ1回が数えられる');
    assertEqual(stats.season.releaseCrowd, 0, '2人では「5人以上」は数えない');
    assertNoErrors(t.errors, '季節の数えで未捕捉の例外');
    t.win.close();
  });

  await r.test('季節イベント：期間外は、獲得条件が完全に無効', async () => {
    const t = await launch();
    t.win.TitleLogic.seasonFor = () => null;   // 期間外
    const stats = await playOneRound(t);
    assertEqual(stats.season.releasePlays, 0, '期間外は1つも増えない');
    assertEqual(stats.season.releaseCrowd, 0, '同上');
    assertNoErrors(t.errors, '期間外の扱いで未捕捉の例外');
    t.win.close();
  });

  await r.test('季節イベント：棚の一言は開催の事実だけ（焦らせる表示は無い）', async () => {
    const { win, doc, errors } = await launch();
    // 実行する日によって開催中かどうかは変わる。どちらの場合も約束を守っていること
    const active = win.TitleLogic.seasonFor();
    const badge = el(doc, 'seasonBadge');
    if (active) {
      assert(badge.style.display !== 'none', '開催中は控えめな一言が出る');
      assert(/開催中/.test(badge.textContent), '開催していることが分かる');
      assert(!/あと\s*\d+\s*日|残り|終了まで/.test(badge.textContent),
        '「あと〇日」のような、焦らせる表示は出さない');
      assert(el(doc, 'app').classList.contains(active.theme), '季節の装飾クラスが当たっている');
    } else {
      assertEqual(badge.style.display, 'none', '期間外は何も出ない');
    }
    // 第36弾 36-6：飾りを四隅に固定して置かない（設定の⚙と重なっていた）
    assertEqual(doc.getElementById('seasonDeco'), null, '隅に固定した飾りは置かない');
    assertNoErrors(errors, '季節の装飾で未捕捉の例外');
    win.close();
  });

  await r.test('手に入った演出は、スキップも「今後出さない」もできる', async () => {
    // 演出をスキップにしていると、大きな演出は出さず一言だけにする
    const t = await launch();
    autoDialog(t.win, t.doc);
    click(t.doc, 'shelfGearBtn');
    await sleep(t.win, 100);
    t.doc.querySelector('#setRootMenu [data-setpage="app"]').click();
    await sleep(t.win, 60);
    // 第32弾-D 第4部：演出の速さは「安全に関する設定」へ移った
    t.doc.querySelector('#setAppMenu [data-setpage="safety"]').click();
    await sleep(t.win, 60);
    t.doc.querySelector('#setFxSeg [data-fx="skip"]').click();
    await sleep(t.win, 60);
    click(t.doc, 'closeSettingsBtn');
    await sleep(t.win, 60);
    await setupPlayers(t.win, t.doc);
    await waitScreen(t.win, t.doc, 'scr-mode', 3000);
    click(t.doc, 'modeAutoBtn');
    await sleep(t.win, 80);
    if (activeScreen(t.doc) === 'scr-mode-rules') { click(t.doc, 'rulesStartBtn'); await sleep(t.win, 60); }
    await waitScreen(t.win, t.doc, 'scr-ready', 3000);
    el(t.doc, 'holdBtn').dispatchEvent(new t.win.PointerEvent('pointerdown', { bubbles: true }));
    await waitScreen(t.win, t.doc, 'scr-play', 8000);
    click(t.doc, 'btnCorrect');
    await sleep(t.win, 80);
    const who2 = t.doc.querySelectorAll('#pickerGrid button[data-id]');
    if (who2.length) { who2[0].click(); await sleep(t.win, 120); }
    click(t.doc, 'endRoundBtn');
    await waitScreen(t.win, t.doc, 'scr-score', 8000);
    await sleep(t.win, 200);
    assert(!el(t.doc, 'titleGotOverlay').classList.contains('show'),
      '演出をスキップにしていたら、大きな演出は出さない');
    t.win.close();
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
    autoDialog(win, doc);
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
    await chooseNext(win, doc, 'mode');
    await waitScreen(win, doc, 'scr-mode', 3000);
    click(doc, 'backToShelfBtn');
    await waitScreen(win, doc, 'scr-shelf', 3000);
    click(doc, 'shelfMeBtn');
    await waitScreen(win, doc, 'scr-titles', 3000);
    doc.querySelector('[data-profgo="icon"]').click();
    await waitScreen(win, doc, 'scr-title-icon', 3000);
    const balloon = doc.querySelector('#tiGroups [data-ticon="icon-are-1"]');
    assert(balloon && !balloon.classList.contains('locked'), '🎈 はじめの参加証が手に入っている');
    // 選んだ瞬間、上のプレビューが変わる
    balloon.click();
    await sleep(win, 60);
    assertEqual(el(doc, 'tiPreviewIcon').textContent, '🎈', 'プレビューがすぐ変わる');
    click(doc, 'tiDoneBtn');
    await waitScreen(win, doc, 'scr-titles', 3000);
    click(doc, 'titlesBackBtn');
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
    autoDialog(win, doc);
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
    await chooseNext(win, doc, 'mode');
    await waitScreen(win, doc, 'scr-mode', 3000);
    click(doc, 'backToShelfBtn');
    await waitScreen(win, doc, 'scr-shelf', 3000);
    click(doc, 'shelfMeBtn');
    await waitScreen(win, doc, 'scr-titles', 3000);
    doc.querySelector('[data-profgo="name2"]').click();
    await waitScreen(win, doc, 'scr-title-name', 3000);
    doc.querySelector('[data-tnslot="first"]').click();
    await waitScreen(win, doc, 'scr-title-slot', 3000);
    const kiki = doc.querySelector('#tsList [data-tsid="first-kikijozu"]');
    assert(kiki && !kiki.classList.contains('locked'),
      'ヒント1つで当てたので「聞き上手」が手に入る');
    assertNoErrors(errors, '一言ヒントの称号で未捕捉の例外');
    win.close();
  });

  await r.test('一言ヒント：もう一言もらってから当てたら、数えない', async () => {
    const { win, doc, errors } = await launch();
    autoDialog(win, doc);
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

    await chooseNext(win, doc, 'mode');
    await waitScreen(win, doc, 'scr-mode', 3000);
    click(doc, 'backToShelfBtn');
    await waitScreen(win, doc, 'scr-shelf', 3000);
    click(doc, 'shelfMeBtn');
    await waitScreen(win, doc, 'scr-titles', 3000);
    doc.querySelector('[data-profgo="name2"]').click();
    await waitScreen(win, doc, 'scr-title-name', 3000);
    doc.querySelector('[data-tnslot="first"]').click();
    await waitScreen(win, doc, 'scr-title-slot', 3000);
    const kiki = doc.querySelector('#tsList [data-tsid="first-kikijozu"]');
    assert(kiki && kiki.classList.contains('locked'),
      'ヒントを増やしてもらったら「一発」ではない');
    assertNoErrors(errors, 'ヒント追加の称号で未捕捉の例外');
    win.close();
  });

  // ===================================================================
  // 第32弾-C 第1部：扉・棚の演出
  // 演出そのものを見るので、ここだけ本物の速さで動かす（launch({fx:true})）
  // ===================================================================

  await r.test('扉：開いた先で何が始まるかが、扉に書いてある', async () => {
    const { win, doc, errors } = await launch();
    // 初めて触る人は、扉が開くまで何が起きるか分からないまま待たされていた
    const lead = el(doc, 'doorLead');
    assert(lead, '扉に一言が置いてある');
    assert(/あそび/.test(lead.textContent), '何をするところかが分かる（実際: ' + lead.textContent + '）');
    assertNoErrors(errors, '扉で未捕捉の例外');
    win.close();
  });

  await r.test('棚：いま選んでいるカセットだけが浮き、影が濃くなる', async () => {
    const { win, doc, errors } = await launch();
    const rail = doc.querySelector('#shelfList .rail');
    const center = rail.querySelector('.cart.center');
    assert(center, '中央のカセットがある');
    // 「中央だけ」であること。全部が浮いていたら、どれを選んでいるか分からない
    assertEqual(rail.querySelectorAll('.cart.center').length, 1, '浮いているのは1つだけ');
    const on = win.getComputedStyle(center.querySelector('.cart-body')).boxShadow;
    const other = Array.from(rail.querySelectorAll('.cart')).find(c => !c.classList.contains('center'));
    if (other) {
      const off = win.getComputedStyle(other.querySelector('.cart-body')).boxShadow;
      assert(on !== off, '中央と両隣で影の濃さが違う');
    }
    assertNoErrors(errors, '棚の中央表示で未捕捉の例外');
    win.close();
  });

  await r.test('棚：カセットの切り替えは0.25秒（速さの設定にも従う）', async () => {
    // jsdom は calc() と CSS変数を解けないので、書いてある指定そのものを見る
    const css = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const rule = css.slice(css.indexOf('\n  .cart{'), css.indexOf('\n  .cart.center{'));
    assert(/transform calc\(0\.25s \* var\(--fx-scale\)\)/.test(rule),
      '0.25秒で横に移る');
    // 「演出の速さ」を掛けてあること。掛け忘れると、速い・スキップにしても棚だけ遅いまま
    assert(/var\(--fx-scale\)/.test(rule), '速さの設定が効く');
    // 段の中も、飛ばずに滑って移る
    assert(/\.rail\{[\s\S]*?scroll-behavior:smooth/.test(css), '中央を移す時、滑って移る');
  });

  await r.test('棚：カセットをタップすると、テーマ色が広がってから中に入る', async () => {
    const { win, doc, errors } = await launch({ fx: true });
    const c = cart(doc, 'jinro');
    c.click();
    if (!doc.querySelector('.cassette-warp')) c.click(); // 中央でなければ2回目で選択
    // 広がっている最中は、まだ棚にいる（色が覆う前に画面が変わると繋がらない）
    const warp = doc.querySelector('.cassette-warp');
    assert(warp, 'テーマ色が広がる幕が出る');
    assertEqual(warp.getAttribute('data-theme'), 'wolf', '人狼カセットの色で広がる');
    assert(c.classList.contains('cart-warp'), 'カセットが手前にせり出す');
    assertEqual(activeScreen(doc), 'scr-shelf', '覆いきるまでは、まだ棚');
    // 覆いきったら中へ
    await waitFor(win, () => activeScreen(doc) !== 'scr-shelf', 2000, 'カセットの中に入る');
    await sleep(win, 400);
    assert(!doc.querySelector('.cassette-warp'), '幕が残らない');
    assertNoErrors(errors, 'カセットに入る演出で未捕捉の例外');
    win.close();
  });

  await r.test('棚：演出の途中でタップすれば、待たされずに入れる', async () => {
    // 2周目の人が毎回0.4秒待たされるのは、パーティゲームとして致命的
    const { win, doc, errors } = await launch({ fx: true });
    const c = cart(doc, 'jinro');
    c.click();
    if (!doc.querySelector('.cassette-warp')) c.click();
    assertEqual(activeScreen(doc), 'scr-shelf', 'まだ棚');
    doc.getElementById('app').dispatchEvent(new win.Event('pointerdown', { bubbles: true }));
    await sleep(win, 30);
    assert(activeScreen(doc) !== 'scr-shelf', 'タップした時点で中に入る');
    assert(!doc.querySelector('.cassette-warp'), '幕もその場で消える');
    assertNoErrors(errors, '演出のスキップで未捕捉の例外');
    win.close();
  });

  await r.test('棚：入れないカセットには、世界に入る演出を出さない', async () => {
    // 近日公開を押した時に「入った」演出が出ると、入れたと勘違いする
    const { win, doc, errors } = await launch({ fx: true });
    const soon = doc.querySelector('.cart.soon');
    soon.click(); soon.click();
    await sleep(win, 60);
    assert(!doc.querySelector('.cassette-warp'), '幕は出ない');
    assertEqual(activeScreen(doc), 'scr-shelf', '棚のまま');
    assertNoErrors(errors, '近日公開カセットで未捕捉の例外');
    win.close();
  });

  await r.test('棚：テーマを持つカセットは、全部ぶんの色が用意されている', async () => {
    // テーマを足した時に色を足し忘れると、そこだけ既定色で広がって世界観が切れる
    const { win, doc, errors } = await launch();
    const css = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const themes = Array.from(new Set(
      (css.match(/theme:'([a-z]+)'/g) || []).map(s => s.replace(/theme:'|'/g, ''))));
    assert(themes.length >= 4, 'テーマを持つカセットが見つかる（' + themes.join(',') + '）');
    themes.forEach((t) => {
      assert(css.indexOf('.cassette-warp[data-theme="' + t + '"]') >= 0,
        t + ' の広がる色が決めてある');
    });
    assertNoErrors(errors, 'テーマ色の確認で未捕捉の例外');
    win.close();
  });

  // ===================================================================
  // 第32弾-C 第8部：全体を通しての配慮
  // ===================================================================

  await r.test('はじめて触る人にも、これが何のアプリか分かる（第8部-4）', async () => {
    // 友達の家で初めて触る人が、いきなり棚を見せられても分からない
    const { win, doc, errors } = await launch({ playFlow: false });
    assertEqual(activeScreen(doc), 'scr-howto', '扉のつぎの画面');
    const text = el(doc, 'scr-howto').textContent;
    assert(/パーティゲーム/.test(text), '何のアプリか書いてある');
    const browse = doc.querySelector('#scr-howto [data-howto="browse"]');
    assert(/はじめての人/.test(browse.textContent),
      'はじめての人の行き先が分かる（実際: ' + browse.textContent.trim() + '）');
    assertNoErrors(errors, 'あそびかたの画面で未捕捉の例外');
    win.close();
  });

  await r.test('専門用語を、集まりで通じる言葉に置き換えてある（第8部-3）', async () => {
    // 子供から年配の人まで遊ぶ。「モジュール」「フェーズ」は通じない
    const html = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'public', 'index.html'), 'utf8');
    // 画面に出る文字だけを見る（コードのコメントや変数名は読む相手が違う）
    const shown = html
      .replace(/\/\*[\s\S]*?\*\//g, '')      // CSSコメント
      .replace(/^\s*\/\/.*$/gm, '')          // 行コメント
      .replace(/<!--[\s\S]*?-->/g, '');      // HTMLコメント
    const bad = [];
    ['モジュール', 'フェーズ'].forEach((w) => {
      // 行をまたがせない。またぐと、行末に書いたコメントまで拾ってしまう
      const re = new RegExp('[>\'"][^<\'"\\r\\n]*' + w, 'g');
      const hit = shown.match(re);
      if (hit) bad.push(w + '（' + hit.length + '件）');
    });
    assertEqual(bad.join('、'), '', '画面に出る文字に専門用語が残っていない');
  });

  r.finish();
})();
