// tests/shelf.js — 棚と扉まわり
//
// 扉が開いて棚が出る／カセットを選ぶ／横に送る／どこからでも棚に戻れる、を確認する。
// （並び替えは第41弾 2-2「固定順」で廃止。長押しは説明を開く役に変わった）
// 「棚に戻る」導線は、プレイヤー設定で行き止まりになった実績があるので必ず通す。

const H = require('./harness');
const { launch, activeScreen, sleep, waitFor, waitScreen, el, click, fakeRects, openCassette,
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

  await r.test('棚の構成：1列にカセットが並び、各カセットは1回だけ出る', async () => {
    // **段は無くなった**（第41弾 2-2）。
    // 分類ごとに段を作ると、1つのカセットが2つの段に出るか、
    // どちらかに押し込んで嘘になるかのどちらかになる。
    // 分類は中央の帯に小さく出す（そちらは帯の検査で見る）
    const { win, doc, errors } = await launch();
    assertEqual(doc.querySelectorAll('#shelfList .rail').length, 1, '棚は1列');
    assertEqual(doc.querySelectorAll('#shelfList .sticker').length, 0, '段のシールはもう無い');
    assertEqual(doc.querySelectorAll('#shelfList .board').length, 0, '段の板ももう無い');
    const rail = doc.querySelector('#shelfList .rail');
    assert(rail.querySelectorAll('.cart').length > 0, 'カセットが並んでいる');
    // **各カセットは棚に1回だけ出る**（第41弾 2-2）。
    // 第32弾は「性格の違うゲームが入ったカセットは両方の段に並べる」
    // としていた——段のある棚では、それが正しかった。
    // 1列にすると同じものが2回出てしまうので、表示は1回にした。
    //
    // **だが第32弾の判断（どちらかに押し込むと嘘になる）は捨てていない。**
    // もう一方の顔は alsoGenre に移り、長押し／i の popup で見せる。
    // ここでは「1回だけ出る」と「情報が消えていない」の**両方**を見る
    const 数える = (id) => doc.querySelectorAll('.cart[data-cart="' + id + '"]').length;
    ['bakudan', 'jinro'].forEach((id) => {
      assertEqual(数える(id), 1, id + '：棚に1回だけ出る');
      const info = win.cassetteGenreInfo(id);
      assertEqual(info.genre.length, 1, id + '：棚に出す分類は1つ');
      assert(info.also.length > 0, id + '：もう一方の顔が alsoGenre に残っている');
      info.labels.forEach((l, i) => {
        assert(l, id + '：alsoGenre「' + info.also[i] + '」が分類の一覧に実在する');
      });
    });
    assert(cart(doc, 'aresoredorekore'), 'あれそれどれこれのカセットがある');
    // ロゴ画像を貼っていること
    const logo = doc.querySelector('.cart[data-cart="aresoredorekore"] .cart-logo');
    assert(logo && /logo-aresoredorekore\.png$/.test(logo.getAttribute('src')), 'カセットにロゴ画像が貼られている');
    assertNoErrors(errors, '棚の描画で未捕捉の例外');
    win.close();
  });

  await r.test('正本の抽出が、実際のカセットの数と合っている（第41弾）', async () => {
    // **抽出の正規表現は、書式を変えた日に黙って壊れる。**
    // 第41弾で genre:['x'] を genre:'x' に変えたら、
    // tests/inventory.js の抽出が**0件**になった。
    // 消費側（titles.js）に「いま何件」の主張があったので気づけたが、
    // それは >= 6 なので、**7枚目を足して6枚しか取れなくても通る**。
    // 数そのものを突き合わせる（落とし穴20：照合には向きがある）。
    const INV = require('./inventory');
    const fsx = require('fs');
    const pathx = require('path');
    const html = fsx.readFileSync(pathx.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const 本体 = html.slice(html.indexOf('var CASSETTES = ['), html.indexOf('function cassetteById'));
    const 実際 = (本体.match(/ready:s*true/g) || []).length;
    assert(実際 > 0, 'CASSETTES に完成カセットがある（実際:' + 実際 + '件）');
    assertEqual(INV.READY_CASSETTE_IDS.length, 実際,
      '正本の抽出（' + INV.READY_CASSETTE_IDS.join(',') + '）が、実際の ready:true の数と合っている');
  });

  await r.test('alsoGenre の綴りが、分類の一覧に実在する（第41弾）', async () => {
    // **棚に出ない値ほど、検査が無いと事故に気づけない。**
    // genre は棚に出るので、綴りを間違えればカセットが消えて分かる。
    // alsoGenre は popup の奥にしか出ないので、間違えても
    // 「その行が出ない」だけで、誰も気づけないまま残る（落とし穴6の型）。
    const { win, doc } = await launch();
    const ids = Array.from(doc.querySelectorAll('.cart[data-cart]'))
      .map((e) => e.dataset.cart);
    assert(ids.length > 5, 'カセットを数えられている（実際:' + ids.length + '件）');

    const 悪い = [];
    let 見た = 0;
    Array.from(new Set(ids)).forEach((id) => {
      const info = win.cassetteGenreInfo(id);
      if (!info) return;
      info.also.forEach((g, i) => {
        見た++;
        if (!info.labels[i]) 悪い.push(id + '：alsoGenre「' + g + '」が分類の一覧に無い');
      });
    });
    assert(見た > 0, 'alsoGenre を持つカセットがある（実際:' + 見た + '件）');  // 型(b)
    assertEqual(悪い.join('・'), '', '綴りが分類の一覧と合っていない');
    win.close();
  });

  await r.test('近日公開のカセットを押しても棚に留まる（壊れない）', async () => {
    // **準備中は1枚に畳んだ**（第41弾 2-2）。個別には出さない
    const { win, doc, errors } = await launch();
    const soon = doc.querySelector('.cart.soon');
    assert(soon, '準備中の札がある');
    assert(soon.dataset.more, '畳んだ札（何枚ぶんかを持っている）');
    assert(/準備中/.test(soon.textContent), '何の札かが読める：' + soon.textContent.replace(/\s+/g, ''));
    await openCassette(win, doc, null, soon);
    assertEqual(activeScreen(doc), 'scr-shelf', '押しても棚のまま');
    // 長押しでも行き止まりにしない（説明を開く先が無い札なので、理由を出す）
    soon.dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse', clientX: 100, clientY: 10 }));
    await sleep(win, 560);
    assertEqual(activeScreen(doc), 'scr-shelf', '長押ししても棚のまま');
    assertNoErrors(errors, '畳んだ札で未捕捉の例外');
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
    const rail = doc.querySelector('#shelfList .rail');
    const inner = rail.parentNode;
    const left = inner.querySelector('.rail-arrow.left');
    const right = inner.querySelector('.rail-arrow.right');
    assert(left && right, '両端に矢印がある');
    // **輪になったので、矢印が無効になる端が無い**（第41弾 2-2）
    assert(!left.disabled && !right.disabled, '最初から両方押せる');

    const ids = cartIds(rail);
    right.click();
    await sleep(win, 350);
    assertEqual(rail.querySelector('.cart.center').dataset.cart, ids[1], '右矢印で次のカセットが中央になる');
    left.click();
    await sleep(win, 350);
    assertEqual(rail.querySelector('.cart.center').dataset.cart, ids[0], '左矢印で戻る');
    // 先頭から左で、最後尾へ回り込む
    left.click();
    await sleep(win, 350);
    assertEqual(rail.querySelector('.cart.center').dataset.cart, ids[ids.length - 1], '先頭から左で最後尾へ回る');
    assertNoErrors(errors, '矢印操作で未捕捉の例外');
    win.close();
  });

  await r.test('キーボードの左右でカセットを移動できる', async () => {
    const { win, doc, errors } = await launch();
    const rail = doc.querySelector('#shelfList .rail');
    const ids = cartIds(rail);
    doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await sleep(win, 350);
    assertEqual(rail.querySelector('.cart.center').dataset.cart, ids[1], '→で次へ');
    doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    await sleep(win, 350);
    assertEqual(rail.querySelector('.cart.center').dataset.cart, ids[0], '←で戻る');
    assertNoErrors(errors, 'キーボード操作で未捕捉の例外');
    win.close();
  });

  await r.test('長押しは、並び替えではなく説明を開く（第41弾 2-2・2-7）', async () => {
    // **並び替えは廃止した。**2-2 が「固定順・遊ぶたびに並びを変えない」と
    // 決めたため（体の記憶を壊さない）。空いた長押しに、2-7 の説明を載せる。
    //
    // 着手前は「長押しの取り合いになる」と見ていたが、
    // 並び替えが無くなることで衝突は起きなかった。
    const { win, doc, errors } = await launch();
    const rail = doc.querySelector('#shelfList .rail');
    const carts = Array.from(rail.querySelectorAll('.cart'));
    const before = cartIds(rail);
    const a = carts[0];

    a.dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse', clientX: 100, clientY: 10 }));
    await sleep(win, 520); // 長押し成立（450ms）を待つ

    // 説明が開く
    const panel = doc.querySelector('#uiLayerRoot .ui-popup-in');
    assert(panel, '長押しで説明が開く');
    assert(/1台|みんなのスマホ/.test(panel.textContent), '何台のスマホが要るかが分かる');

    // **並び替えは起きない**（順番が変わらない・案内も出ない）
    assert(!rail.classList.contains('reordering'), '並び替えモードに入らない');
    assert(!doc.getElementById('shelfReorderNote'), '並び替えの案内は出ない');
    assertEqual(cartIds(rail).join(','), before.join(','), '順番が変わらない');

    assertNoErrors(errors, '長押しで未捕捉の例外');
    win.close();
  });

  await r.test('説明を開いている間、キーで棚が動かない（第41弾で見つけた事故）', async () => {
    // **④で入れた事故。**長押しに説明を載せるまで、棚には重なりが1つも
    // 無かったので、この問題は存在していなかった。載せた瞬間に生まれた。
    //
    // 実測した壊れ方：説明を開いたまま→で中央が動き、
    // **Enter で説明を開いたままカセットの中（scr-setup）へ入っていた**。
    // 遊ぶ人には「説明を読んでいたら勝手にゲームが始まった」に見える。
    //
    // ui-kit 側に「document のキー操作は全部 anyOpen を見ているか」の掃引を
    // 置いたが、それは**書いてあるか**しか見ない。ここで**効いているか**を見る
    const { win, doc, errors } = await launch();
    const rail = doc.querySelector('#shelfList .rail');
    const carts = Array.from(rail.querySelectorAll('.cart'));
    assert(carts.length > 1, '動かせるだけカセットがある（実際:' + carts.length + '枚）');  // 型(b)

    carts[0].dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse', clientX: 100, clientY: 10 }));
    await sleep(win, 520);
    assert(doc.querySelector('#uiLayerRoot .ui-popup-in'), '説明が開いている');  // 型(b)
    const 中央 = () => (rail.querySelector('.cart.center') || {}).dataset;
    const 前 = 中央() && 中央().cart;
    assert(前, '中央のカセットがある');

    doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await sleep(win, 80);
    assertEqual(中央() && 中央().cart, 前, '説明の後ろで中央が動かない');

    doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await sleep(win, 600);
    assertEqual(activeScreen(doc), 'scr-shelf', '説明の後ろでカセットに入らない');

    // **逆向きも見る**（落とし穴20）。説明を閉じたら、キーはまた効く。
    // これが無いと「キーを全部殺す」でもこの検査は通ってしまう
    const x = doc.querySelector('#uiLayerRoot [data-ui="close"]');
    assert(x, 'とじる道がある');
    x.click();
    await sleep(win, 400);
    doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await sleep(win, 80);
    assert(中央() && 中央().cart !== 前, '説明を閉じたら、キーはまた効く');

    assertNoErrors(errors, '説明を開いたままのキー操作で未捕捉の例外');
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
    // **下部バーに「部屋」ボタンは無い**（第41弾 2-1・2-8）。
    // 部屋に入るのは入口から、部屋をつくるのは遊び方の確認から。
    // 棚から部屋を開く近道があると、入口で分けた意味が薄れる
    assert(!doc.getElementById('shelfRoomBtn'), '下部バーに「部屋」ボタンは無い');
    // **あそびかたを選び直すボタンも無い**（2-1：ドロップダウンは廃止）。
    // 1台か部屋かは、カセットを選んだ後の確認で決まるので、
    // 棚の時点では「いまの遊び方」というものが存在しない
    assert(!doc.getElementById('shelfFlowBtn'), '棚の見出しに、あそびかたのドロップダウンは無い');
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

  await r.test('扉のあとは入口に着き、やることの名前で分かれている（第41弾）', async () => {
    // **役割（ホスト／ゲスト）ではなく、やることの名前で分ける。**
    // 初めて来た人には、自分がホストなのかゲストなのか分からない。
    // 集める人は「ゲームをえらぶ」、呼ばれた人は「部屋に入る」。
    const { win, doc, errors } = await launch({ loggedOut: true, atEntry: true });
    assertEqual(activeScreen(doc), 'scr-entry', '扉の次は入口');
    const cards = doc.querySelectorAll('#scr-entry [data-entry]');
    assertEqual(cards.length, 2, '入口は二択');
    const ids = Array.from(cards).map(c => c.dataset.entry).join(',');
    assertEqual(ids, 'choose,join', 'ゲームをえらぶ・部屋に入る');
    // **役割の名前を出さない**（この検査の本体）
    const text = el(doc, 'scr-entry').textContent;
    assert(!/ホスト|ゲスト/.test(text),
      '役割の名前が出ていない（実際: ' + text.replace(/\s+/g, ' ').trim().slice(0, 60) + '）');
    assertNoErrors(errors, '未ログインの起動で未捕捉の例外');
    win.close();
  });

  await r.test('ログインしていなくても「棚を見る」なら棚に着く', async () => {
    const { win, doc, errors } = await launch({ loggedOut: true, browse: true });
    assertEqual(activeScreen(doc), 'scr-shelf', 'ログイン画面で止めない');
    assert(doc.querySelector('.shelf-bar'), '下部バーが出ている');
    assert(doc.getElementById('shelfGearBtn'), '「設定」ボタンがある');
    assert(!doc.getElementById('shelfRoomBtn'), '「部屋」ボタンは無い（入口で分かれている）');
    assertNoErrors(errors, '未ログインの起動で未捕捉の例外');
    win.close();
  });

  await r.test('説明は、遊び始めずに読める（第41弾 2-7）', async () => {
    // もとは入口の「棚を見る」から専用画面へ行く形だった。
    // ④で遊び方を入口で決めなくなり、その入口ごと無くなったので、
    // **説明を読む手段が消えないよう** popup に移した。
    // ログインしていなくても説明は読める（棚を見るだけならログインは要らない）
    const { win, doc, errors } = await launch({ loggedOut: true, browse: true });
    const cart = doc.querySelector('.cart[data-cart="jinro"]');
    assert(cart, '人狼のカセットが棚にある');
    cart.dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse', clientX: 100, clientY: 10 }));
    await sleep(win, 600);
    const panel = doc.querySelector('#uiLayerRoot .ui-popup-in');
    assert(panel, '説明が開く');
    const text = panel.textContent;
    assert(/1台でもあそべる|1台では遊べません/.test(text), '1台で遊べるかが分かる');
    assert(/みんなのスマホ/.test(text), 'みんなのスマホで遊べるかも分かる');
    assert(/人狼|ワードウルフ/.test(text), '中に入っているゲームが分かる');

    // **読んだだけでは遊び始めない**（この検査の本体）
    assertEqual(activeScreen(doc), 'scr-shelf', '説明を読んでも棚から動かない');

    // とじる道がある
    const x = doc.querySelector('#uiLayerRoot [data-ui="close"]');
    assert(x, 'とじる道がある');
    x.click();
    await sleep(win, 400);
    assertNoErrors(errors, '説明で未捕捉の例外');
    win.close();
  });

  await r.test('未ログインの名前と二つ名は、候補から選ばれて開いている間は変わらない', async () => {
    const NAMES = ['準備中！', 'まだログインしてない', 'まだ待ってね', 'ログインしないと！'];
    const TITLES = ['まだ準備してるよ！', 'ログインしないとまだできない', 'みらいのげんせき', 'まだがんばっているとちゅう！'];
    const { win, doc, errors } = await launch({ loggedOut: true, browse: true });
    const name0 = el(doc, 'shelfName').textContent;
    const title0 = el(doc, 'shelfTitle').textContent;
    assert(NAMES.includes(name0), '名前が候補の中から選ばれている：' + name0);
    assert(TITLES.includes(title0), '二つ名が候補の中から選ばれている：' + title0);

    // 画面を往復しても選び直さない（自分の名前がチラつくと壊れて見える）。
    // 往復の道は、あそびかたの選び直しから「カセット→遊び方の確認→やめる」に変えた
    // （第41弾 2-1 で、あそびかたを選ぶ画面そのものが無くなったため）
    // **1台専用のカセットでは往復できない。**確認を挟まず素通りするので、
    // 未ログインだとそのままログイン画面へ行ってしまう（実際に踏んだ）。
    // 両方対応のカセットなら「どうやって遊ぶ？」が出るので、そこから戻れる
    await openCassette(win, doc, 'jinro');
    assertEqual(activeScreen(doc), 'scr-play-way', '遊び方の確認が出ている');
    click(doc, 'wayCancelBtn');
    await waitScreen(win, doc, 'scr-shelf', 3000);
    assertEqual(el(doc, 'shelfName').textContent, name0, '名前は開いている間ずっと同じ');
    assertEqual(el(doc, 'shelfTitle').textContent, title0, '二つ名も同じ');
    assertNoErrors(errors, '未ログインの棚で未捕捉の例外');
    win.close();

    // 開き直した時は選び直してよい（同じ端末で必ず同じにはしない）
    const seen = new Set();
    for (let i = 0; i < 12; i++) {
      const t = await launch({ loggedOut: true, browse: true });
      seen.add(el(t.doc, 'shelfName').textContent);
      t.win.close();
    }
    assert(seen.size > 1, '開き直すと選び直される（12回で' + seen.size + '種類）');
  });

  await r.test('未ログインで「ゲームをえらぶ」を押すと、ログインに案内される（第41弾 2-1）', async () => {
    // 遊んだ記録を残すのでログインが要る。**それを聞く場所が入口に移った**——
    // 以前は「あそびかたをえらぶ」で1台を選んだ時に聞いていたが、
    // その画面ごと無くなった（2-1）。
    const { win, doc, errors } = await launch({ loggedOut: true, atEntry: true });
    click(doc, doc.querySelector('#scr-entry [data-entry="choose"]'));
    await waitScreen(win, doc, 'scr-login', 3000);

    // **行き止まりにしない道が2つある**（これがこの検査の本体）
    click(doc, 'loginBackBtn');
    await waitScreen(win, doc, 'scr-entry', 3000);
    click(doc, doc.querySelector('#scr-entry [data-entry="choose"]'));
    await waitScreen(win, doc, 'scr-login', 3000);
    const browse = doc.getElementById('loginBrowseBtn');
    assert(browse, 'ログインせずに棚を見る道がある');
    assert(/ログインせず/.test(browse.textContent), 'それが何をする道か、札で分かる：' + browse.textContent);
    click(doc, browse);
    await waitScreen(win, doc, 'scr-shelf', 3000);
    assertNoErrors(errors, 'ログイン案内で未捕捉の例外');
    win.close();
  });

  await r.test('ログインすると、頼まれた用事の続きに戻る', async () => {
    // 用事へ行く道が変わった（第41弾 2-1・2-4）。
    // 以前は「あそびかたをえらぶ→みんなのスマホ」で部屋の画面へ行けた。
    // いまは**部屋専用のカセットを選ぶと、確認が「部屋をつくる」を出す**。
    const { win, doc, errors } = await launch({ loggedOut: true, fakeSocket: true, atEntry: true });
    click(doc, doc.querySelector('#scr-entry [data-entry="choose"]'));
    await waitScreen(win, doc, 'scr-login', 3000);
    click(doc, 'loginBrowseBtn');
    await waitScreen(win, doc, 'scr-shelf', 3000);
    await openCassette(win, doc, 'quizou');   // 部屋でしか遊べないカセット
    // waitFor は「遊び方の確認」を自動で通り抜けるので、この画面は待てない
    assertEqual(activeScreen(doc), 'scr-play-way', '部屋をつくる確認が出ている');
    click(doc, doc.querySelector('#wayChoices [data-way="room"]'));
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

    // **第42弾 2-1：あつめたものだけが並ぶ。**
    // 未取得を灰色や「？？？」で並べると、集めた喜びより
    // 「まだ持っていないもの」の方が目立つ画面になる（6節の禁止）
    assert(el(doc, 'profIconBtn'), 'アイコンをかえる');
    assert(el(doc, 'profNameBtn'), '二つ名をかえる');
    assert(!/顔をかえる/.test(el(doc, 'scr-titles').textContent), '「顔をかえる」とは言わない（6節）');

    // **門E4：未取得が1つも描かれていない。**
    const 並んだ = Array.from(doc.querySelectorAll('#profOwned .prof-part'));
    const have = win.titleSheetProbe(null);   // 「最初から使えるもの」で持ち物の形を見る
    assert(have && have.全部 > 0, '目録を読めている');   // 型(b)
    assert(並んだ.length > 0, '持っているものが並んでいる（実際:' + 並んだ.length + '個）');
    const 全部の文字 = doc.querySelector('#profOwned').textContent;
    assert(!/？？？/.test(全部の文字), '「？？？」が1つも無い');
    assertEqual(doc.querySelectorAll('#profOwned .locked, #profOwned .dead').length, 0,
      '灰色にした未取得も1つも無い');

    // **門E5：分母は CATALOG から導く**（手書きしない）
    const INV2 = require('./inventory');
    const 数 = el(doc, 'profOwnedCount').textContent;
    const m = /(\d+)\s*\/\s*(\d+)/.exec(数);
    assert(m, '「持っている数 / 全部の数」が出る（実際: ' + 数 + '）');
    const 目録の全数 = win.TitleLogic
      ? win.TitleLogic.PART_KEYS.reduce((n, k) => n + win.TitleLogic.partsOf(k).length, 0)
      : null;
    assertEqual(Number(m[2]), 目録の全数, '分母が目録の実際のパーツ数と一致する');
    assertEqual(Number(m[1]), 並んだ.length, '分子が、実際に並んでいる数と一致する');
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

  await r.test('二つ名は、スロットを1つずつ切り替える（第42弾 2-3・門E9）', async () => {
    // **3列を一度に並べない。**
    // 3つ同時に出すと、どれを触っているのかが分からなくなる。
    // 1つ押す → そのスロットの持ち物だけ → 選ぶと上の1行が変わる
    const { win, doc, errors } = await launch();
    click(doc, 'shelfMeBtn');
    await waitScreen(win, doc, 'scr-titles', 3000);
    click(doc, 'profNameBtn');
    await sleep(win, 300);

    const slots = Array.from(doc.querySelectorAll('#uiLayerRoot [data-pickslot]'));
    assertEqual(slots.length, 3, '3つのスロットが「入口として」並ぶ');
    // **門E9：この時点で候補は1つも出ていない**（3列同時になっていない）
    assertEqual(doc.querySelectorAll('#uiLayerRoot [data-pickpart]').length, 0,
      '押す前は、候補を1つも並べない（3列同時にしない）');
    assert(doc.getElementById('tnNow'), 'いまの組み合わせが上に1行ある');

    // 1つ押すと、そのスロットの**持っているものだけ**が出る
    slots[0].click();
    await sleep(win, 300);
    const picks = Array.from(doc.querySelectorAll('#uiLayerRoot [data-pickpart]'));
    assert(picks.length > 0, '押したスロットの候補が出る（実際:' + picks.length + '個）');
    picks.forEach((p) => {
      assert(!/？？？/.test(p.textContent), '未取得を「？？？」で並べない：' + p.textContent);
    });
    // 出ているものは全部、実際に持っているもの
    const 持ち物 = new Set(win.titleProbe().unlocked);
    picks.forEach((p) => {
      assert(持ち物.has(p.dataset.pickid), p.dataset.pickid + ' は持っているものだけ');
    });
    assertNoErrors(errors, '二つ名の sheet で未捕捉の例外');
    win.close();
  });

  await r.test('カセットごとの「あと◯つ ›」から、達成状況のシートが開く（2-4・門E7）', async () => {
    // **41の🏆と、42の「あと◯つ ›」は同じ実装を開く。**
    // 同じ内容を2つ作ると片方が古びる（落とし穴1）
    const { win, doc, errors } = await launch();
    click(doc, 'shelfMeBtn');
    await waitScreen(win, doc, 'scr-titles', 3000);
    const rows = Array.from(doc.querySelectorAll('#profCassettes [data-tsheet]'));
    assert(rows.length >= 5, 'カセットごとに1行ある（実際:' + rows.length + '行）');
    ['人狼', 'あれそれどれこれ', '爆弾', 'クイズ', 'オーク'].forEach((w) => {
      assert(el(doc, 'profCassettes').textContent.indexOf(w) !== -1, '「' + w + '」の行がある');
    });
    // **残りの数だけを出す**（何が足りないかは、押した先のシートで）
    assert(/あと\d+つ|すべて集めました/.test(el(doc, 'profCassettes').textContent),
      '残りの数、または「すべて集めました」が出る');
    assert(!/？？？/.test(el(doc, 'profCassettes').textContent), 'この画面に「？？？」は無い');

    const 対象 = rows.find((x) => x.dataset.tsheet === 'jinro') || rows[1];
    対象.click();
    await sleep(win, 400);
    const sheet = doc.querySelector('#uiLayerRoot .ui-sheet-in');
    assert(sheet, 'シートが開く');
    const 中身 = sheet.textContent;
    assert(/\d+ \/ \d+/.test(中身), '進み具合が出る（' + 中身.slice(0, 40) + '）');
    // シートは**手がかりを出す場所**。まだのものも、伏せずに条件を書く
    const まだ = sheet.querySelectorAll('.ts-row:not(.got)');
    if (まだ.length) {
      assert(まだ[0].querySelector('.ts-hint'), 'まだのものは、どうすれば手に入るかが読める');
      assert(!/？？？/.test(まだ[0].textContent), '「？？？」で伏せない');
    }
    assertNoErrors(errors, '達成状況のシートで未捕捉の例外');
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

  await r.test('ログインしていなくても、いまの自分は見られる（第42弾 2-5・門E8）', async () => {
    // **責めない。**できないことではなく、できることを言う。
    // 何が集められるかを見てから、ログインを決めてよい
    const { win, doc, errors } = await launch({ loggedOut: true, browse: true });
    assert(!el(doc, 'shelfMeBtn').disabled, '未ログインでも押せる');
    click(doc, 'shelfMeBtn');
    await waitScreen(win, doc, 'scr-titles', 3000);
    assert(el(doc, 'titlePreviewIcon').textContent, 'いまの自分が出る');
    const note = el(doc, 'titleGuestNote');
    assertEqual(note.style.display, '', '一言が出ている');
    assert(/ログインすると記録が残ります/.test(note.textContent),
      '責めない言い方（実際: ' + note.textContent + '）');

    // **選んだ姿が端末に残る**（門E8）
    click(doc, 'profIconBtn');
    await sleep(win, 300);
    const picks = Array.from(doc.querySelectorAll('#uiLayerRoot [data-pickicon]'));
    assert(picks.length > 0, '未ログインでも、持っているアイコンは選べる');
    picks[0].click();
    await sleep(win, 300);
    const 残った = win.localStorage.getItem('acac-look');
    assert(残った, '選んだ姿が端末に残る（実際: ' + 残った + '）');
    assertEqual(JSON.parse(残った).icon, picks[0].dataset.pickicon, '選んだアイコンが残っている');

    // **開き直しても残っている**
    const b = await launch({ loggedOut: true, browse: true, storage: { 'acac-look': 残った } });
    assertEqual(b.win.titleProbe().equipped.icon, picks[0].dataset.pickicon,
      '開き直しても、選んだ姿のまま');
    b.win.close();

    assertNoErrors(errors, '未ログインの称号画面で未捕捉の例外');
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
    // 持ち物に入ったかは、**シートと同じ中身**で見る（画面の形に依らない）
    assert(win.titleProbe().unlocked.indexOf('icon-are-1') >= 0,
      '🎈 はじめの参加証が手に入っている');
    // 選んだ瞬間、上の「いまの自分」が変わる（2-11）
    click(doc, 'profIconBtn');
    await waitFor(win, () => !!doc.querySelector('#uiLayerRoot .ui-sheet-in'), 3000, 'アイコンのシートが開く');
    const balloon = doc.querySelector('#uiLayerRoot [data-pickicon="icon-are-1"]');
    assert(balloon, '持っているので、アイコンの候補に出ている');
    balloon.click();
    await sleep(win, 300);
    assertEqual(el(doc, 'titlePreviewIcon').textContent, '🎈', 'いまの自分がすぐ変わる');
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
    assert(win.titleProbe().unlocked.indexOf('first-kikijozu') >= 0,
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
    assertEqual(win.titleProbe().unlocked.indexOf('first-kikijozu'), -1,
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

    // **段の中も、飛ばずに滑って移る。**
    //
    // この1行はもともと `.rail{…scroll-behavior:smooth` を見ていた。
    // 2-9 で横送りをブラウザのスクロールから自前の帯に変えたので、
    // その指定は消えた——が、**「滑って移る」という約束は消えていない**。
    // 見る先を、いま滑らせている側（.rail-track の transform）へ移す。
    //
    // （見張る対象の場所が変わっただけで、規則を緩めてはいない。
    //   前の書き方 `/\.rail\{[\s\S]*?smooth/` は `[\s\S]*?` が
    //   ファイル全体に届くので、そもそも .rail に結び付いていなかった。
    //   ここでは規則の中身を切り出してから見る）
    const 帯 = css.slice(css.indexOf('\n  .rail-track{'), css.indexOf('\n  .rail-track.rail-grab{'));
    assert(帯, '.rail-track の指定を読めている');   // 型(b)
    assert(/transition:transform calc\(0\.25s \* var\(--fx-scale\)\)/.test(帯),
      '中央を移す時、滑って移る（速さの設定にも従う）');
    // 指で送っている最中だけは、滑らせず指に貼り付く
    const 掴み = css.slice(css.indexOf('\n  .rail-track.rail-grab{'), css.indexOf('\n  .cart{'));
    assert(/transition:none/.test(掴み), '指で送っている間は、指に貼り付いて動く');
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
    const { win, doc, errors } = await launch({ atEntry: true });
    assertEqual(activeScreen(doc), 'scr-entry', '扉のつぎの画面');
    const text = el(doc, 'scr-entry').textContent;
    assert(/パーティゲーム/.test(text), '何のアプリか書いてある');
    // 「はじめての人の行き先」は、入口の二択そのものが担う。
    // どちらを押せばいいかが、押す前に読んで分かること
    const choose = doc.querySelector('#scr-entry [data-entry="choose"]');
    const join = doc.querySelector('#scr-entry [data-entry="join"]');
    assert(/えらび|えらぶ/.test(choose.textContent),
      '集める人の行き先が分かる（実際: ' + choose.textContent.replace(/\s+/g, ' ').trim() + '）');
    assert(/コード/.test(join.textContent),
      '呼ばれた人の行き先が分かる（実際: ' + join.textContent.replace(/\s+/g, ' ').trim() + '）');
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

  // ---- 第41弾 2-2：中央の帯（世界を借りる）----

  await r.test('中央の帯が、選んでいるカセットの中身を出す（2-2）', async () => {
    // 段が無くなって、分類の行き場が消えた。**帯が引き受ける。**
    // ここに出るものは 2-2 が並べている：
    // アイコン・名前・分類・人数と時間・遊び方・説明・はじめる・達成状況
    const { win, doc, errors } = await launch();
    const band = doc.getElementById('shelfBand');
    assert(band, '中央の帯がある');

    const 見る = () => band.textContent.replace(/\s+/g, ' ');
    // **1枚ずつ回して、全部の完成カセットで確かめる**（列挙ではなく正本のループ）
    const INV = require('./inventory');
    const rail = doc.querySelector('#shelfList .rail');
    const ids = Array.from(rail.querySelectorAll('.cart')).map((c) => c.dataset.cart);
    const 見た = [];
    for (let i = 0; i < ids.length; i++) {
      if (!ids[i]) continue;                     // 畳んだ札は別の検査で見る
      const 右 = rail.parentNode.querySelector('.rail-arrow.right');
      while ((rail.querySelector('.cart.center') || {}).dataset.cart !== ids[i]) {
        右.click(); await sleep(win, 350);
      }
      const t = 見る();
      const info = win.cassetteGenreInfo(ids[i]);
      const 分類 = win.shelfMeta(ids[i]);
      assert(分類.text && t.indexOf(分類.text) >= 0,
        ids[i] + '：人数と時間が出ている（' + 分類.text + '）');
      assert(/1台|みんなのスマホ/.test(t), ids[i] + '：何台のスマホが要るかが出ている');
      assert(/はじめる/.test(t), ids[i] + '：はじめるが出ている');
      assert(/達成状況/.test(t), ids[i] + '：達成状況が出ている');
      見た.push(ids[i]);
    }
    // **数を先に主張する**（0枚なら上の for は自明に通ってしまう。型b）
    assertEqual(見た.slice().sort().join(','), INV.READY_CASSETTE_IDS.slice().sort().join(','),
      '完成しているカセットを全部見た');
    assertNoErrors(errors, '中央の帯で未捕捉の例外');
    win.close();
  });

  await r.test('帯の世界の色は、止まった時にだけ変わる（2-2）', async () => {
    // **送っている最中に色が動くと、目が落ち着かない。**
    // 時計で「止まったか」を測るのではなく、
    // **指で送っている間は中央の番号が動かない**という作りで守っている
    const { win, doc, errors } = await launch();
    const band = doc.getElementById('shelfBand');
    const rail = doc.querySelector('#shelfList .rail');
    const carts = Array.from(rail.querySelectorAll('.cart'));
    carts.forEach((c, i) => Object.defineProperty(c, 'offsetLeft', {
      get: () => (Number(c.style.order) || 0) * 132, configurable: true
    }));
    win.dispatchEvent(new win.Event('resize'));

    const 世界 = () => band.getAttribute('data-theme');
    const 前 = 世界();
    const 指 = (type, x) => carts[0].dispatchEvent(new win.PointerEvent(type, {
      bubbles: true, pointerType: 'touch', pointerId: 5, clientX: x, clientY: 10
    }));
    指('pointerdown', 300);
    指('pointermove', 220);      // 送っている最中
    assertEqual(世界(), 前, '送っている最中は、世界の色が変わらない');
    指('pointerup', 220);        // 止まった
    await sleep(win, 350);
    assert(世界() !== 前, '止まったら、次のカセットの世界に変わる（' + 前 + ' → ' + 世界() + '）');

    // 上の帯と下部バーはクリームのまま（染めるのは中央だけ）
    assert(!el(doc, 'app').className.split(' ').some((c) => /^theme-/.test(c)),
      '棚そのものは、どのカセットの色にも染まらない');
    assertNoErrors(errors, '世界の切り替えで未捕捉の例外');
    win.close();
  });

  await r.test('押せない「はじめる」には、理由と次の行動が出る（2-5）', async () => {
    // **グレーで終わらせない。**
    // 押せないボタンだけを見せると、遊ぶ人には「壊れている」としか見えない
    const { win, doc, errors } = await launch({ loggedOut: true, browse: true });
    const band = doc.getElementById('shelfBand');
    const 始 = doc.getElementById('swStartBtn');
    assert(始, 'はじめるボタンがある');
    assert(始.disabled, '見るだけの棚では押せない');
    const t = band.textContent.replace(/\s+/g, ' ');
    assert(/ログインすると始められます/.test(t), '理由が出ている（' + t.slice(0, 60) + '）');
    // 次の行動（ログインへ行く道）がある
    const 行動 = band.querySelector('[data-sw-go="login"]');
    assert(行動, '次にすべき行動のボタンがある');
    行動.click();
    await waitScreen(win, doc, 'scr-login', 3000);

    // **逆向きも見る**（落とし穴20）。ログインしていれば押せる
    const x = await launch();
    assert(!el(x.doc, 'swStartBtn').disabled, 'ログインしていれば押せる');
    assert(!/ログインすると始められます/.test(el(x.doc, 'shelfBand').textContent),
      '押せる時に理由は出さない');
    x.win.close();

    assertNoErrors(errors, '押せない理由で未捕捉の例外');
    win.close();
  });

  await r.test('帯の「はじめる」から、カセットに入れる（2-2）', async () => {
    const { win, doc, errors } = await launch();
    assertEqual((doc.querySelector('.cart.center') || {}).dataset.cart, 'aresoredorekore',
      '最初は1枚目が中央');
    click(doc, 'swStartBtn');
    await waitFor(win, () => activeScreen(doc) !== 'scr-shelf', 4000, 'カセットの中に入る');
    assert(activeScreen(doc) !== 'scr-shelf', '帯からも遊び始められる（実際: ' + activeScreen(doc) + '）');
    assertNoErrors(errors, '帯のはじめるで未捕捉の例外');
    win.close();
  });

  // ---- 第41弾 2-3：人数チップ ----

  async function 人数をえらぶ(win, doc, n) {
    click(doc, 'shelfChip');
    await sleep(win, 200);
    const b = doc.querySelector('[data-heads="' + n + '"]');
    if (!b) throw new Error(n + '人が選べない');
    b.click();
    await sleep(win, 250);
  }

  await r.test('人数チップ：答えなくても棚は動く。答えると合わないカセットが沈む（2-3）', async () => {
    // **消さずに沈める。**消すと「あるはずのゲームが無い」になる。
    // 沈めるだけなら、選べるし世界も説明も見える——押せないのは「はじめる」だけ
    const { win, doc, errors } = await launch();
    const chip = el(doc, 'shelfChip');
    assert(chip, '人数チップがある');
    assert(/なんにん/.test(chip.textContent), '答える前は聞いている：' + chip.textContent);
    assertEqual(win.headsProbe().heads, null, '答える前は人数を持っていない');

    // **答えなくても棚は動く**（2-3の要）
    assertEqual(doc.querySelectorAll('.cart.dim').length, 0, '答える前は、どれも沈んでいない');
    assert(!el(doc, 'swStartBtn').disabled, '答える前でも「はじめる」は押せる');

    await 人数をえらぶ(win, doc, 2);
    assertEqual(win.headsProbe().heads, 2, '答えた人数が入る');
    assert(/2人/.test(el(doc, 'shelfChip').textContent), 'チップに出る：' + el(doc, 'shelfChip').textContent);

    // 3人からのカセットが沈む（**消えてはいない**）
    const 沈 = Array.from(doc.querySelectorAll('.cart.dim')).map((c) => c.dataset.cart);
    assert(沈.length > 0, '合わないカセットが沈んでいる（実際:' + 沈.join('・') + '）');  // 型(b)
    沈.forEach((id) => {
      assert(doc.querySelector('.cart[data-cart="' + id + '"]'), id + '：沈んでも棚から消えない');
      assert(win.shelfMeta(id).min > 2, id + '：沈んだのは人数が足りないから（' + win.shelfMeta(id).min + '人から）');
    });
    // **逆向き**（落とし穴20）：2人で遊べるカセットは沈んでいない
    const 沈まず = Array.from(doc.querySelectorAll('.cart[data-cart]'))
      .filter((c) => !c.classList.contains('dim')).map((c) => c.dataset.cart);
    assert(沈まず.length > 0, '沈んでいないカセットもある（実際:' + 沈まず.join('・') + '）');
    沈まず.forEach((id) => {
      const m = win.shelfMeta(id);
      assert(!m.min || m.min <= 2, id + '：沈んでいないのは2人で遊べるから（' + m.min + '人から）');
    });
    assertNoErrors(errors, '人数チップで未捕捉の例外');
    win.close();
  });

  await r.test('人数が足りない時、帯に理由と「いま何人・何人から」が出る（2-5）', async () => {
    // 「足りません」だけでは、遊ぶ人は動けない。
    // **いま何人で、何人からなのか**まで出す
    const { win, doc, errors } = await launch();
    await 人数をえらぶ(win, doc, 2);

    // 沈んでいるカセットを中央へ持ってくる
    const rail = doc.querySelector('#shelfList .rail');
    const 沈 = doc.querySelector('.cart.dim[data-cart]');
    assert(沈, '沈んでいるカセットがある');  // 型(b)
    const id = 沈.dataset.cart;
    // **ここで棚を開き直さないこと。**renderShelf がDOMを作り直すので、
    // いま掴んでいる rail も矢印も、画面から外れた古い要素になる（実際に踏んだ）
    const carts = Array.from(rail.querySelectorAll('.cart'));
    const 右 = rail.parentNode.querySelector('.rail-arrow.right');
    let 回 = 0;
    while ((rail.querySelector('.cart.center') || {}).dataset.cart !== id && 回 < carts.length + 1) {
      右.click(); await sleep(win, 350); 回++;
    }
    assertEqual((rail.querySelector('.cart.center') || {}).dataset.cart, id, '沈んだカセットを中央にできた');

    const band = el(doc, 'shelfBand');
    const t = band.textContent.replace(/\s+/g, ' ');
    assert(el(doc, 'swStartBtn').disabled, '人数が足りないと「はじめる」は押せない');
    assert(/足りません/.test(t), '理由が出ている（' + t.slice(0, 80) + '）');
    assert(/いま2人/.test(t), '**いま何人か**が出ている');
    assert(new RegExp(win.shelfMeta(id).min + '人から').test(t), '**何人からか**も出ている');

    // 沈んでいても、説明と世界は見える（2-3：消さない）
    assert(/正体|爆発|値を|先頭|説明|解いて/.test(t) || t.length > 30, '説明も読める');

    // **人数を増やせば、そのまま遊べるようになる**（行き止まりにしない）
    await 人数をえらぶ(win, doc, 8);
    await sleep(win, 200);
    assert(!el(doc, 'swStartBtn').disabled, '人数を増やすと押せるようになる');
    assertNoErrors(errors, '人数不足の理由で未捕捉の例外');
    win.close();
  });

  await r.test('部屋ができたら、人数チップは実数に置き換わる（2-3・2-11）', async () => {
    // 手で入れた見当より、**実際にそこにいる人数の方が必ず正しい**
    const { win, doc, errors } = await launch({ fakeSocket: true });
    await 人数をえらぶ(win, doc, 4);
    assertEqual(win.headsProbe().heads, 4, '見当は4人');

    // 部屋を作る（部屋でしか遊べないカセット → 確認 → 部屋をつくる）
    await openCassette(win, doc, 'quizou');
    assertEqual(activeScreen(doc), 'scr-play-way', '部屋をつくる確認が出る');
    click(doc, doc.querySelector('#wayChoices [data-way="room"]'));
    await waitScreen(win, doc, 'scr-rt-lobby', 3000);
    const fake = win.__rtFake;
    await waitFor(win, () => fake.connected, 3000, '疑似socketがつながる');
    fake.replies = { 'room:create': () => ({ ok: true, code: 'ABC234', memberId: 'm1',
      room: { code: 'ABC234', hostMemberId: 'm1',
        members: [{ id: 'm1', name: 'あき', role: 'player', connected: true },
                  { id: 'm2', name: 'びび', role: 'player', connected: true },
                  { id: 'm3', name: 'ちか', role: 'player', connected: true },
                  { id: 'm4', name: 'でで', role: 'player', connected: true },
                  { id: 'm5', name: 'えみ', role: 'player', connected: true },
                  { id: 'm6', name: 'ふみ', role: 'player', connected: true }],
        state: { phase: 'lobby', game: null, data: {} } } }) };
    el(doc, 'rtCreateName').value = 'あき';
    click(doc, 'rtCreateBtn');
    await waitScreen(win, doc, 'scr-rt-room', 4000);

    assertEqual(win.headsProbe().heads, 6, '部屋があれば、実数（6人）が勝つ');
    assertEqual(win.headsProbe().見当, 4, '手で入れた見当そのものは消していない');

    // 棚に出ると、チップも実数になっている
    click(doc, 'rtPickGameBtn');
    await waitScreen(win, doc, 'scr-shelf', 3000);
    assert(/6人/.test(el(doc, 'shelfChip').textContent),
      'チップが実数に置き換わる（実際: ' + el(doc, 'shelfChip').textContent + '）');
    assertNoErrors(errors, '部屋の人数で未捕捉の例外');
    win.close();
  });

  await r.test('下部バーは、画面の端から浮いている（2-8）', async () => {
    // 端にぴったり付いていると、iPhone のホームバーと重なって押しにくい（正本7-1）
    const html = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const rule = html.slice(html.indexOf('\n  .shelf-bar{'), html.indexOf('\n  .shelf-me{'));
    assert(rule, '.shelf-bar の指定を読めている');  // 型(b)
    assert(/margin:auto 14px calc\(/.test(rule), '下にも余白がある（端に付けない）');
    assert(/safe-area-inset-bottom/.test(rule), 'ホームバーのぶんも足してある');
    // 部屋のボタンはもう無い（2-1・2-8）
    const { win, doc } = await launch();
    assert(!doc.getElementById('shelfRoomBtn'), '下部バーに「部屋」ボタンは無い');
    assert(doc.getElementById('shelfGearBtn'), '⚙ はある');
    assert(doc.getElementById('shelfMeBtn'), '左は名前とアイコン');
    win.close();
  });

  await r.test('開き直すと、前回あそんだカセットが選ばれている（2-2・門D13）', async () => {
    // 続けて遊ぶ時に毎回同じ距離を送り直すのは、
    // 「いつもの場所」がある棚の意味を薄くする
    const a = await launch();
    // 最初は先頭（まだ何も遊んでいない）
    assertEqual((a.doc.querySelector('.cart.center') || {}).dataset.cart, 'aresoredorekore',
      '何も遊んでいなければ先頭');
    assertEqual(a.doc.querySelectorAll('.cart-last').length, 0, 'まだ「前回」の札は無い');

    // 人狼をあそぶ
    await openCassette(a.win, a.doc, 'jinro');
    await waitFor(a.win, () => activeScreen(a.doc) !== 'scr-shelf', 4000, 'カセットの中に入る');
    assertEqual(a.win.lastCassette(), 'jinro', 'あそんだカセットを覚えている');
    const 保存 = a.win.localStorage.getItem('acac-last-cassette');
    a.win.close();

    // **開き直す**（別の窓＝アプリを立ち上げ直したのと同じ）
    const b = await launch({ storage: { 'acac-last-cassette': 保存 } });
    assertEqual((b.doc.querySelector('.cart.center') || {}).dataset.cart, 'jinro',
      '開き直すと、前回あそんだカセットが中央にいる');
    // **札が出る。**選ばれている理由が見えないと、並びが変わったように見える
    const 札 = b.doc.querySelectorAll('.cart-last');
    assertEqual(札.length, 1, '「前回」の札はちょうど1枚');
    assertEqual(札[0].closest('.cart').dataset.cart, 'jinro', '札は前回あそんだカセットに付く');
    assert(/前回/.test(札[0].textContent), '札に「前回」と書いてある');
    // 帯も、そのカセットの世界になっている
    assertEqual(el(b.doc, 'shelfBand').getAttribute('data-theme'), 'wolf',
      '帯も前回のカセットの世界から始まる');
    b.win.close();
  });

  await r.test('帯の「はじめる」も、タイルと同じ確認を通る（2-4・実サーバーで見つけた）', async () => {
    // **遊び始める入口が2つあって、片方だけ確認を飛ばしていた。**
    // タイルのタップは playWayPlan を通り、帯の「はじめる」は
    // startCassette を直に呼んでいた——人狼（両方対応・部屋なし）で、
    // タイルからは「どうやって遊ぶ？」が出るのに帯からは出ずに
    // ゲーム選択へ行っていた（落とし穴1そのもの。実サーバーで見つけた）
    const 道 = async (どこから) => {
      const { win, doc } = await launch();
      const rail = doc.querySelector('#shelfList .rail');
      const 右 = rail.parentNode.querySelector('.rail-arrow.right');
      for (let i = 0; i < 9 && (rail.querySelector('.cart.center') || {}).dataset.cart !== 'jinro'; i++) {
        右.click(); await sleep(win, 350);
      }
      assertEqual((rail.querySelector('.cart.center') || {}).dataset.cart, 'jinro', '人狼を中央にできた');
      if (どこから === '帯') click(doc, 'swStartBtn');
      else rail.querySelector('.cart.center').click();
      await sleep(win, 900);
      const 着いた先 = activeScreen(doc);
      win.close();
      return 着いた先;
    };
    const タイル = await 道('タイル');
    const 帯 = await 道('帯');
    assertEqual(タイル, 'scr-play-way', 'タイルからは確認が出る');
    assertEqual(帯, タイル, '帯からも同じところに着く（入口で振る舞いを変えない）');
  });

  await r.test('人数を変えても、いま見ているカセットを失わない（実サーバーで見つけた）', async () => {
    // 人数チップを変えると棚を描き直すが、そのたびに先頭へ戻っていた。
    // 遊ぶ人には「人数を直したら、見ていたカセットがどこかへ行った」に見える
    const { win, doc, errors } = await launch();
    const rail = doc.querySelector('#shelfList .rail');
    const 右 = rail.parentNode.querySelector('.rail-arrow.right');
    右.click(); await sleep(win, 350);
    右.click(); await sleep(win, 350);
    const 前 = (rail.querySelector('.cart.center') || {}).dataset.cart;
    assert(前 && 前 !== 'aresoredorekore', '先頭ではないカセットを中央にできた（実際:' + 前 + '）');  // 型(b)

    click(doc, 'shelfChip');
    await sleep(win, 200);
    doc.querySelector('[data-heads="8"]').click();
    await sleep(win, 300);
    const 後 = (doc.querySelector('#shelfList .rail .cart.center') || {}).dataset.cart;
    assertEqual(後, 前, '人数を変えても、見ていたカセットが中央のまま');
    assertNoErrors(errors, '人数を変えた時に未捕捉の例外');
    win.close();
  });

  await r.test('シートには、いつも「とじる」がある（第42弾 2-10・実ブラウザで見つけた）', async () => {
    // **開いたら閉じられること。**
    // sheet は ok を渡さないと閉じるボタンが1つも出ない。
    // 外側を押しても閉じるが、それは知っている人の近道でしかない（落とし穴20の型）。
    // 実ブラウザで、シートが3枚積み上がって閉じられなくなった
    const { win, doc, errors } = await launch();
    click(doc, 'shelfMeBtn');
    await waitScreen(win, doc, 'scr-titles', 3000);
    const 開く = ['[data-tsheet]', '#profIconBtn', '#profNameBtn'];
    for (const sel of 開く) {
      doc.querySelector(sel).click();
      await sleep(win, 300);
      const とじる = doc.querySelector('#uiLayerRoot [data-ui="ok"]');
      assert(とじる, sel + ' のシートに「とじる」がある');
      assertEqual(とじる.textContent.trim(), 'とじる', '札は正本の語（' + とじる.textContent + '）');
      とじる.click();
      await sleep(win, 400);
      assertEqual(doc.querySelectorAll('#uiLayerRoot .ui-sheet-in').length, 0,
        sel + '：押したら閉じる（積み上がらない）');
    }
    assertNoErrors(errors, 'シートの開け閉めで未捕捉の例外');
    win.close();
  });

  await r.test('二つ名をえらぶと、開いたままのシートの1行もその場で変わる（2-3）', async () => {
    // 後ろの画面だけ描き直すと、**いま見ているシートの上の行が古いまま残る**——
    // 選んだのに変わっていないように見える（実ブラウザで見つけた）
    // **持ち物が1つしか無いと、選び直しは自明に成立してしまう**（型b）。
    // 「はじめの言葉」を2つ持っている状態を作ってから試す
    const { win, doc, errors } = await launch({ seedTitles: ['first-natsu'] });
    click(doc, 'shelfMeBtn');
    await waitScreen(win, doc, 'scr-titles', 3000);
    click(doc, 'profNameBtn');
    await waitFor(win, () => !!doc.querySelector('#uiLayerRoot .ui-sheet-in'), 3000, '二つ名のシートが開く');
    doc.querySelector('[data-pickslot="first"]').click();
    await waitFor(win, () => doc.querySelectorAll('#uiLayerRoot [data-pickpart]').length > 0, 3000, 'スロットの候補が出る');

    const いま = win.titleProbe().equipped.first;
    const 候補 = Array.from(doc.querySelectorAll('[data-pickpart]'));
    const 別 = 候補.find((p) => p.dataset.pickid !== いま);
    assert(別, 'いまと違う持ち物がある（実際:' + 候補.length + '個）');   // 型(b)
    const 前 = doc.getElementById('tnNow').textContent;
    別.click();
    await sleep(win, 400);

    const 後 = doc.getElementById('tnNow').textContent;
    assert(後 !== 前, 'シートの上の1行が、その場で変わる（' + 前 + ' → ' + 後 + '）');
    assertEqual(doc.querySelector('[data-pickslot="first"] .tn-slot-val').textContent,
      win.TitleLogic.partById('first', 別.dataset.pickid).label, 'スロットの値も変わる');
    assertEqual(el(doc, 'titlePreviewTitle').textContent, 後, '後ろの「いまの自分」とも一致する');
    assertEqual(el(doc, 'shelfTitle').textContent, 後, '棚のバーにも届いている');
    assertNoErrors(errors, '二つ名の切り替えで未捕捉の例外');
    win.close();
  });

  r.finish();
})();
