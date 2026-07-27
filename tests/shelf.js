// tests/shelf.js — 棚と扉まわり
//
// 扉が開いて棚が出る／カセットを選ぶ／並び替え／どこからでも棚に戻れる、を確認する。
// 「棚に戻る」導線は、プレイヤー設定で行き止まりになった実績があるので必ず通す。

const H = require('./harness');
const { launch, activeScreen, sleep, waitFor, waitScreen, el, click, fakeRects,
  setupPlayers, createRunner, assert, assertEqual, assertNoErrors } = H;

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

  await r.test('ゲームを終えると棚に戻り、扉は再表示されない', async () => {
    const { win, doc, errors } = await launch();
    win.confirm = () => true;
    await setupPlayers(win, doc);
    await waitScreen(win, doc, 'scr-mode', 3000);
    click(doc, 'modeAutoBtn');
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

  r.finish();
})();
