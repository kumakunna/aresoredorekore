// tests/shelf.js — 棚と扉まわり
//
// 扉が開いて棚が出る／カセットを選ぶ／横に送る／どこからでも棚に戻れる、を確認する。
// （並び替えは第41弾 2-2「固定順」で廃止。長押しは説明を開く役に変わった）
// 「棚に戻る」導線は、プレイヤー設定で行き止まりになった実績があるので必ず通す。
//
// 指示66-3 で回る棚（scr-shelf）と入口（scr-entry）には入れなくなった（門7）。棚の動きそのものを見ていた次の検査は消した。同じ意味の約束は tests/home-screens.js（一覧・ページ・理由・門2〜7）、tests/fixes52.js（人数のチップ）、tests/play-way.js（遊び方）が新しい画面で見ている：
//   ・棚の構成：1列にカセットが並び、各カセットは1回だけ出る
//   ・近日公開のカセットを押しても棚に留まる（壊れない）
//   ・矢印ボタンで中央のカセットが移動し、端では無効になる
//   ・キーボードの左右でカセットを移動できる
//   ・長押しは、並び替えではなく説明を開く（第41弾 2-2・2-7）
//   ・説明を開いている間、キーで棚が動かない（第41弾で見つけた事故）
//   ・未ログインで「ゲームをえらぶ」を押すと、ログインに案内される（第41弾 2-1）
//   ・棚：いま選んでいるカセットだけが浮き、影が濃くなる
//   ・棚：カセットをタップすると、テーマ色が広がってから中に入る
//   ・棚：演出の途中でタップすれば、待たされずに入れる
//   ・棚：入れないカセットには、世界に入る演出を出さない
//   ・中央の帯が、選んでいるカセットの中身を出す（2-2）
//   ・世界の色は、止まった時にだけ変わる（2-2・第43弾は場ぜんぶ）
//   ・押せない「はじめる」には、理由と次の行動が出る（2-5）
//   ・帯の「はじめる」から、カセットに入れる（2-2）
//   ・人数チップ：答えなくても棚は動く。答えると合わないカセットが沈む（2-3）
//   ・人数が足りない時、帯に理由と「いま何人・何人から」が出る（2-5）
//   ・部屋ができたら、人数チップは実数に置き換わる（2-3・2-11）
//   ・開き直すと、前回あそんだカセットが選ばれている（2-2・門D13）
//   ・帯の「はじめる」も、タイルと同じ確認を通る（2-4・実サーバーで見つけた）
//   ・人数を変えても、いま見ているカセットを失わない（実サーバーで見つけた）
//
// （つづき）棚の下部バー・世界の色の帯・回る速さを見ていた検査も、画面ごと入れなくなったので消した：
//   ・下部バーは、画面の端から浮いている（2-8）
//   ・世界の色は一番下まで届き、帯とはグラデーションで繋がる（指示44 44-3・44-4）
//   ・棚：カセットの切り替えは0.25秒（速さの設定にも従う）

const H = require('./harness');
const { launch, activeScreen, sleep, waitFor, waitScreen, el, click, fakeRects, openCassette,
  setupPlayers, pickGame, createRunner, assert, assertEqual, assertNoErrors, chooseNext, autoDialog } = H;

// 指示66-3：棚は「ゲームをえらぶ」一覧になった。札＝一覧の札（data-home-id）
function cart(doc, id) { return doc.querySelector('#scr-v2-pick [data-home-id="' + id + '"]'); }

// カセットを選ぶ＝札を押してページを開き、ページの下のボタン（このゲームにする 等）を押す
function pickCart(doc, id) {
  const c = cart(doc, id);
  c.click();
  const go = doc.querySelector('#scr-v2-pick [data-home-cta] [data-home-act]');
  if (go) go.click();
  return c;
}

(async function main() {
  const r = createRunner('shelf：棚と扉');

  await r.test('扉が自動で開き、棚が表示される（扉は残らない）', async () => {
    const { win, doc, errors } = await launch();
    assertEqual(activeScreen(doc), 'scr-v2-pick', '扉のあと棚に入る');
    // 扉が棚を覆ったままにならないこと（過去に起きやすい不具合）
    const door = el(doc, 'scr-door');
    assert(!door.classList.contains('active'), '扉の画面は非アクティブ');
    assertEqual(win.getComputedStyle(door).display, 'none', '扉は表示されていない');
    assertNoErrors(errors, '起動時に未捕捉の例外');
    win.close();
  });

  await r.test('棚のタイルの名前に、手で入れた改行が無い（指示49 49-6）', async () => {
    // **「クイズ王」が2行に割れていた。**原因は幅でも文字サイズでもなく、
    // `title:'クイズ<br>王'` と**データに改行が書いてあった**こと（5枚とも）。
    // 実測すると札の使える幅は96pxで、いちばん長い「オークション」でも72px——全部1行に入る。
    //
    // jsdom にレイアウトは無いので、ここで見るのは**改行が書かれていないこと**。
    // 「本当に1行で出るか」は実ブラウザで測る（tools/measure-screens.js の回し方）。
    // 帯（.sw-name）と検査は前から `<br>` を落としていたので、
    // **この改行が効いていたのはタイルだけ**だった——だから誰も気づかなかった
    const fs = require('fs');
    const path = require('path');
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const 本体 = html.slice(html.indexOf('var CASSETTES = ['), html.indexOf('function cassetteById'));
    const 名前 = Array.from(本体.matchAll(/title:\s*'([^']*)'/g)).map((m) => m[1]);
    // **0件でも「改行なし」は成立する**（型b）。先に数を主張する
    assert(名前.length >= 5, 'カセットの名前を数えられている（実際:' + 名前.length + '件）');
    const 割れ = 名前.filter((t) => /<br\s*\/?>/.test(t));
    assertEqual(割れ.join('・'), '', 'タイルの名前に手で入れた改行が残っている');

    // 「ほか◯つ準備中」の札も同じ（カセットではないが、同じ列に並ぶ）
    assert(!/つ<br\s*\/?>準備中/.test(html), '「準備中」の札にも改行が残っている');

    // **見張りそのものが効くか**——わざと改行を混ぜて捕まることを見る（落とし穴10）
    assert(/<br\s*\/?>/.test('クイズ<br>王'), 'わざと混ぜた改行を、見張りが捕まえる');
    assert(!/<br\s*\/?>/.test('クイズ王'), '直した名前は捕まらない');
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
    // **バックスラッシュが落ちていた**（指示55-① で直した）。
    // `/ready:s*true/` は「`ready:` のあとに `s` が0個以上、そのあと `true`」なので、
    // **`ready: true`（コロンの後に空白）を1件も数えない。**
    // 正本側（tests/inventory.js:32）は正しく `ready:\s*true` なので、
    // 空白を入れて書いた日に「抽出数と実数が合わない」で赤くなる——**実装は正しいのに。**
    // 赤を信じられなくする検査は、無いより悪い（本人の裁定 2026-09-19）
    const 実際 = (本体.match(/ready:\s*true/g) || []).length;
    assert(実際 > 0, 'CASSETTES に完成カセットがある（実際:' + 実際 + '件）');
    assertEqual(INV.READY_CASSETTE_IDS.length, 実際,
      '正本の抽出（' + INV.READY_CASSETTE_IDS.join(',') + '）が、実際の ready:true の数と合っている');
  });

  // ---- 指示68-1：棚は3本だけ（門3）・テスト中の札はくまくんだけ（門4） ----
  // 一覧に出す正本は CASSETTES の hidden: と testing:。画面の札（DOM）と homeProbe の両方を見る
  const 棚の札 = (doc) => Array.from(doc.querySelectorAll('#scr-v2-pick [data-home-card]')).map((e) => e.dataset.homeId);
  const 棚の3本 = ['aresoredorekore', 'jinro', 'bakudan'];

  await r.test('門3：棚に並ぶのは3本だけ（ゲストでも、ふつうのログインでも）', async () => {
    const { win, doc, errors } = await launch();
    for (const [名, me] of [['ゲスト', null], ['ふつうのログイン', { username: 'taro', displayName: 'たろう' }]]) {
      win.authProbe(me);
      win.shelfShowProbe.showAll(false);
      await sleep(win, 30);
      assertEqual(win.homeProbe().ready.slice().sort().join(','), 棚の3本.slice().sort().join(','), 名 + '：遊べるカセットは3本');
      assertEqual(win.homeProbe().testing.join(','), '', 名 + '：テスト中の札は出ない');
      const 札 = Array.from(new Set(棚の札(doc)));
      assert(札.length >= 1, 名 + '：一覧の札を数えられている（' + 札.length + '）');   // 型(b)
      札.forEach((id) => assert(棚の3本.indexOf(id) !== -1, 名 + '：棚に出していない ' + id + ' が一覧に出ている'));
    }
    // 型(b)：全部を並べる窓を開ければ、隠した物も数えられる（数え方が効いている）
    win.shelfShowProbe.showAll(true);
    assert(win.homeProbe().ready.length > 棚の3本.length, '隠した物も ready には残っている（消していない）');
    win.shelfShowProbe.showAll(false);
    assertNoErrors(errors, '棚の描画で未捕捉の例外');
    win.close();
  });

  await r.test('門4：テスト中の札は、くまくん（tester）の時だけ、棚の後ろに「テスト中」として出る', async () => {
    const { win, doc, errors } = await launch();
    win.shelfShowProbe.testing('falsetrue', true);
    win.authProbe({ username: 'taro', displayName: 'たろう' });
    await sleep(win, 30);
    assertEqual(win.homeProbe().testing.join(','), '', 'ふつうのログインには出ない');
    assert(!doc.querySelector('#scr-v2-pick [data-home-testing]'), 'ふつうのログインの一覧に「テスト中」の印が無い');
    win.authProbe({ username: 'kuma', displayName: 'くま', tester: true });
    await sleep(win, 30);
    assertEqual(win.homeProbe().testing.join(','), 'falsetrue', 'くまくんにはテスト中の札が出る');
    assertEqual(win.homeProbe().ready.indexOf('falsetrue'), -1, 'ふつうの遊べる札には混ざらない');
    if (activeScreen(doc) === 'scr-v2-pick') {
      const 札 = 棚の札(doc);
      assert(札.indexOf('falsetrue') > 札.indexOf('bakudan'), '棚のいちばん後ろ（' + 札.join(',') + '）');
      assert(doc.querySelector('#scr-v2-pick [data-home-testing]'), '「テスト中」の印がある');
    }
    // ログアウトしたら消える
    win.authProbe(null);
    await sleep(win, 30);
    assertEqual(win.homeProbe().testing.join(','), '', 'ログアウトしたら出ない');
    win.shelfShowProbe.testing('falsetrue', false);
    assertNoErrors(errors, 'テスト中の札で未捕捉の例外');
    win.close();
  });

  await r.test('門4：サーバーは FES_OWNER の人にだけ tester を返す（ログインと /api/auth/me の両方）', async () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8');
    const 返事 = src.match(/tester:\s*isTester\(/g) || [];
    assert(返事.length >= 2, 'ログインと /api/auth/me の両方が tester を返す（' + 返事.length + 'か所）');
    assert(/function isTester\([^)]*\)\s*\{[^}]*FES_OWNER/.test(src), 'tester は FES_OWNER から決める');
  });

  await r.test('門9（指示68-1）：False or True の表示名は「ハッタリケース」（画面・ルール文・称号・記録。ID は falsetrue のまま）', async () => {
    const fs = require('fs'), path = require('path');
    // 画面に出る字（引用符・タグの中）に、古い名前が残っていない。コメントの経緯は残してよい
    ['public/index.html', 'public/js/titles.js', 'public/js/ui-text.js', 'public/js/falsetrue-logic.js', 'public/js/v2-home.js', 'public/js/v2-fes.js'].forEach((f) => {
      const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
      assert(!/['"`>]\s*False or True/i.test(src), f + ' の画面に出る字に「False or True」が残っている');
    });
    const { win, errors } = await launch();
    win.shelfShowProbe.showAll(true);
    const 説明 = win.cassettePopupText('falsetrue');
    assert(説明 && /ハッタリケース/.test(説明), 'カセットの説明（ルール文）が新しい名前');
    // 称号：ハッタリケースの条件の言葉も新しい名前（称号の ID・数える物は変えない）
    const 称号 = require('../public/js/titles');
    const 言葉 = JSON.stringify(称号).match(/ハッタリケース/g) || [];
    assert(言葉.length >= 2, '称号の条件の言葉に新しい名前（' + 言葉.length + 'か所）');
    assert(!/False or True/.test(JSON.stringify(称号)), '称号の言葉に古い名前が無い');
    // 記録：rounds[].mode は falsetrue のまま、表示は新しい名前（ID を変えていないので LEGACY_MODE_IDS は要らない）
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    assert(/\{id:"falsetrue", icon:"💼", title:"ハッタリケース"/.test(html), 'モード（記録の名前の元）');
    assert(/\{ id:'falsetrue',\s+title:'ハッタリケース'/.test(html), 'ゲーム（記録の名前の元）');
    win.shelfShowProbe.showAll(false);
    assertNoErrors(errors, 'ハッタリケースの説明で未捕捉の例外');
    win.close();
  });

  await r.test('指示68-1：実物解除の称号は、取った人には残り、まだの人の「取れる一覧」と分母からは消える', async () => {
    // もう取れない（ゲームを消した）パーツは retired:。どれが retired かは目録から導く（名指ししない）
    const T = require('../public/js/titles');
    const 消した = T.PART_KEYS.reduce((a, k) => a.concat(T.partsOf(k).filter((p) => p.retired).map((p) => p.id)), []);
    assert(消した.length >= 1, 'もう取れないパーツを数えられている（' + 消した.join(',') + '）');   // 型(b)
    const 行 = (win) => win.titleSheetProbe('bakudan').行.map((x) => x.id);
    // まだ取っていない人
    const a = await launch();
    消した.forEach((id) => assert(行(a.win).indexOf(id) === -1, 'まだの人の一覧に ' + id + ' が出ている'));
    assert(行(a.win).length >= 3, '爆弾解除のほかの称号は出る（型(b)）');
    a.win.close();
    // 取った人（2つだけ持っている）
    const 持つ = 消した.slice(0, 2);
    const b = await launch({ seedTitles: 持つ });
    await waitFor(b.win, () => 持つ.every((id) => 行(b.win).indexOf(id) !== -1), 3000, '取った称号が一覧に出る');
    消した.slice(2).forEach((id) => assert(行(b.win).indexOf(id) === -1, '持っていない ' + id + ' は出ない'));
    const d = b.win.titleSheetProbe('bakudan');
    assert(d.取得 >= 持つ.length, '取ったものは数に入る（' + d.取得 + '／' + d.全部 + '）');
    b.win.close();
  });

  await r.test('alsoGenre の綴りが、分類の一覧に実在する（第41弾）', async () => {
    // **棚に出ない値ほど、検査が無いと事故に気づけない。**
    // genre は棚に出るので、綴りを間違えればカセットが消えて分かる。
    // alsoGenre は popup の奥にしか出ないので、間違えても
    // 「その行が出ない」だけで、誰も気づけないまま残る（落とし穴6の型）。
    const { win, doc } = await launch();
    win.shelfShowProbe.showAll(true);   // 指示68-1：棚に出していない物も並べて、全部のカセットを見る
    await sleep(win, 20);
    const ids = Array.from(doc.querySelectorAll('#scr-v2-pick [data-home-card]'))
      .map((e) => e.dataset.homeId);
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
    await waitScreen(win, doc, 'scr-v2-pick', 3000);
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
    await waitScreen(win, doc, 'scr-v2-pick', 3000);
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
    click(doc, doc.querySelector('#modeCards [data-id="normal"]'));
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
    while (activeScreen(doc) !== 'scr-v2-pick' && presses < 12) {
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
    assertEqual(activeScreen(doc), 'scr-v2-pick', 'もどるを繰り返すと棚に着く（' + presses + '回）');
    assertNoErrors(errors, '戻り操作で未捕捉の例外');
    win.close();
  });

  // ---- PC操作（指示13） ----




  // ---- 第16弾：人狼ゲームカセットが棚に出ている ----
  await r.test('人狼ゲームカセットが棚に出ていて、近日公開ではない', async () => {
    const { win, doc, errors } = await launch();
    const c = cart(doc, 'jinro');
    assert(c, '人狼ゲームのカセットが一覧にある');
    assertEqual(c.tagName, 'BUTTON', '近日の枠ではなく、押せる札');
    assertNoErrors(errors, '棚の描画で未捕捉の例外');
    win.close();
  });

  // ---- 第27弾：爆弾解除カセットが棚に出ている ----
  await r.test('爆弾解除カセットが棚に出ていて、近日公開ではない', async () => {
    const { win, doc, errors } = await launch();
    const c = cart(doc, 'bakudan');
    assert(c, '爆弾解除のカセットが一覧にある');
    assertEqual(c.tagName, 'BUTTON', '近日の枠ではなく、押せる札');
    assert(/爆弾/.test(c.textContent), 'カセットの名前が出ている');
    assertNoErrors(errors, '棚の描画で未捕捉の例外');
    win.close();
  });

  await r.test('爆弾解除カセット：ゲームが1つなので、選択画面を挟まない（指示49 49-7）', async () => {
    // **第27弾-3で実物解除が入り2つになったので選択画面を通っていた。**
    // 指示49 49-7 で実物解除を下ろし、指示68-1 で消して、中身はクイズ解除だけになった——
    // `games` が1つのカセットは選択画面を挟まない（CASSETTES の約束）ので、
    // まっすぐ先へ進む（指示66-3：1台の一覧では、両方で遊べるゲームは1台で進む）
    const { win, doc, errors } = await launch();
    pickCart(doc, 'bakudan');
    await sleep(win, 400);
    // **「scr-game を通らない」ことが主張の中心**なので、着いた先を直に見る
    assert(['scr-setup', 'scr-mode'].indexOf(activeScreen(doc)) !== -1, 'ゲーム選択を挟まず先へ進む（実際: ' + activeScreen(doc) + '）');
    assertNoErrors(errors, '爆弾解除カセットで未捕捉の例外');
    win.close();
  });

  await r.test('消したゲーム（実物解除）は、棚にも説明にも残らない（指示68-1）', async () => {
    // 実物解除は指示49 49-7 で「じゅんび中」として下ろし、説明に理由つきで残していた。
    // 2026-10-24、くまくんの決定で消した（傾きセンサーが一部のスマホで動かない）。
    // 下ろした札が残ると「いつか遊べる」と読める——消した物は、説明からも選ぶ所からも消す。
    // 古い記録が読めることは tests/titles.js と rt-screens の称号の表が見る
    const { win, doc, errors } = await launch();
    const 説明 = win.cassettePopupText('bakudan');
    assert(説明 && /クイズ解除/.test(説明), '爆弾解除の説明が読める（型(b)：中身がある）');
    assertEqual(説明.indexOf('実物解除'), -1, '説明に実物解除が出ない');
    assertEqual(JSON.stringify(win.cassettePaused('bakudan')), '[]', '下ろしたゲームの宣言も残っていない');
    const 遊べる = Array.from(doc.querySelectorAll('#gameCards [data-home-opt]')).map((c) => c.dataset.homeOpt);
    assert(遊べる.indexOf('defuse') === -1, '選べるゲームの側にも出ない');
    assertNoErrors(errors, '爆弾解除の説明で未捕捉の例外');
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
    const ids = Array.from(doc.querySelectorAll('#modeCards [data-id]')).map(c2 => c2.dataset.id);
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
    const ids = Array.from(doc.querySelectorAll('#modeCards [data-id]')).map(c2 => c2.dataset.id);
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
    const cards = Array.from(doc.querySelectorAll('#gameCards [data-home-opt]'));
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
    // 先にプレイヤーを登録しておく。ワードウルフは3人から（指示66-3：人数で遊べないゲームの札は押せない）
    await setupPlayers(win, doc, ['あき', 'びび', 'ちか']);
    await waitScreen(win, doc, 'scr-mode', 3000);
    click(doc, 'backToShelfBtn');
    await waitScreen(win, doc, 'scr-v2-pick', 3000);

    pickCart(doc, 'testmulti');
    await waitScreen(win, doc, 'scr-game', 3000);
    // ワードウルフを選ぶ → ワードウルフのモードだけが出る
    pickGame(doc, 'wordwolf');
    await waitScreen(win, doc, 'scr-mode', 3000);
    const ids = Array.from(doc.querySelectorAll('#modeCards [data-id]')).map(c => c.dataset.id);
    assert(ids.indexOf('wordwolf') >= 0, 'ワードウルフが出る');
    assert(ids.every(id => /^wordwolf/.test(id)), 'ワードウルフのモードだけが並ぶ（' + ids.join(',') + '）');
    assert(ids.indexOf('normal') === -1, 'あれそれどれこれのモードが混ざらない');

    // あれそれどれこれを選び直すと、そちらのモードに切り替わる
    click(doc, 'backToShelfBtn');
    await waitScreen(win, doc, 'scr-game', 3000);
    pickGame(doc, 'aresoredorekore');
    await waitScreen(win, doc, 'scr-mode', 3000);
    const ids2 = Array.from(doc.querySelectorAll('#modeCards [data-id]')).map(c => c.dataset.id);
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
    await waitScreen(a.win, a.doc, 'scr-v2-pick', 3000);
    assertEqual(activeScreen(a.doc), 'scr-v2-pick', '1ゲームなら棚へ直接戻る');
    assertNoErrors(a.errors, '1ゲームの戻りで未捕捉の例外');
    a.win.close();

    // 2ゲームのカセット → ゲーム選択に戻る
    const b = await launch({ testCassettes: [MULTI] });
    await setupPlayers(b.win, b.doc);
    await waitScreen(b.win, b.doc, 'scr-mode', 3000);
    click(b.doc, 'backToShelfBtn');
    await waitScreen(b.win, b.doc, 'scr-v2-pick', 3000);
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

    await H.endGameFromSettings(win, doc);
    await waitScreen(win, doc, 'scr-v2-pick', 5000);
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
    click(doc, doc.querySelector('#modeCards [data-id="normal"]'));
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
    await waitScreen(win, doc, 'scr-v2-pick', 3000);
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
      await waitScreen(win, doc, 'scr-v2-pick', 3000);
      pickCart(doc, 'aresoredorekore');
      await waitScreen(win, doc, 'scr-mode', 3000);
    }
    // 1回押せば棚に着く（往復ぶんが溜まっていない）
    click(doc, 'floatingBackBtn');
    await waitScreen(win, doc, 'scr-v2-pick', 3000);
    assertEqual(activeScreen(doc), 'scr-v2-pick', '1回で棚に着く');
    assertNoErrors(errors, '往復で未捕捉の例外');
    win.close();
  });

  await r.test('戻る矢印：遊んでいる最中は出さない（進行が壊れないように）', async () => {
    const { win, doc, errors } = await launch();
    await setupPlayers(win, doc);
    await waitScreen(win, doc, 'scr-mode', 3000);
    click(doc, doc.querySelector('#modeCards [data-id="normal"]'));
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

  await r.test('戻る矢印：丸の中の矢印を、画面の左上に置く（正本7・指示44 44-5）', async () => {
    // **この検査は3回書き換わっている。**中身より、書き換えた理由が大事：
    //   ・第28弾-4      枠線だけの正方形
    //   ・第32弾-A-3-4  **角が矢印に被る**ので枠を消し、矢印1文字にした
    //   ・指示44 44-5   地も縁も無い1文字は「押せるもの」に見えなかったので、
    //                   **丸**の中の矢印にした。丸なら 32弾が嫌った被りは起きない
    //
    // 32弾の検査は「塗りつぶさない・枠線を出さない」と**形の否定**で書いてあった。
    // 否定で書くと、別の形で同じ目的を果たす日にも赤くなる。
    // ここでは**満たしたいこと**（隅にある・押せる大きさ・丸い・地がある）で書く
    const fs = require('fs');
    const path = require('path');
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const rule = html.match(/\.floating-back\{[^}]*\}/);
    assert(rule, '.floating-back の決まりごとがある');
    assert(/border-radius:50%/.test(rule[0]), '丸である（角が矢印に被らない）');
    assert(/background:var\(--card\)/.test(rule[0]), '地がある（押せるものに見える）');
    assert(/color:var\(--ink\)/.test(rule[0]), '矢印は墨（地との対はトークンの表が見張る）');
    const 大きさ = /width:(\d+)px;height:(\d+)px/.exec(rule[0]);
    assert(大きさ, '大きさが書いてある');
    assert(Number(大きさ[1]) >= 32 && Number(大きさ[1]) === Number(大きさ[2]),
      '押せる大きさ（32px以上）の正円（実際:' + 大きさ[1] + 'x' + 大きさ[2] + '）');
    assert(/position:absolute;top:6px;left:8px/.test(rule[0]), '画面の左上に置く');

    // **テーマ側で色を足し直していないこと**（片方だけ直す事故を防ぐ）。
    // 地も縁もトークンから取るので、テーマ側に書く必要が無い
    const themed = html.match(/\.app\.theme-[a-z]+ \.floating-back\{[^}]*\}/g) || [];
    themed.forEach((t) => {
      assertEqual(/background:|border(-color)?:|color:/.test(t), false,
        'テーマ側で色を足していない：' + t);
    });

    // 出る画面／出ない画面は canGoBackOne が1か所で決める。
    // 指示66-3：新しい見た目の画面は自分の ‹ を持つので重ねない。今までの画面（プレイヤー設定など）では出る
    const { win, doc } = await launch();
    assertEqual(el(doc, 'floatingBackBtn').style.display, 'none', '一覧は自分の ‹ があるので出ない');
    await openCassette(win, doc, 'aresoredorekore');
    await waitScreen(win, doc, 'scr-setup', 3000);
    assert(el(doc, 'floatingBackBtn').style.display !== 'none', '今までの画面（プレイヤー設定）では出る');
    win.close();
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

  await r.test('入口の⚙から、アイコン・二つ名と設定に行ける（前の棚の下部バーの役目・指示66-3）', async () => {
    const { win, doc, errors } = await launch({ atEntry: true });
    click(doc, doc.querySelector('#scr-v2-home [data-v2-act="gear"]'));
    await sleep(win, 100);
    assert(el(doc, 'settingsOverlay').classList.contains('show'), '設定が開く');
    const row = doc.querySelector('#settingsOverlay [data-setact="titles"]');
    assert(row, '設定の中に「アイコン・二つ名」がある');
    click(doc, row);
    await waitScreen(win, doc, 'scr-titles', 3000);
    click(doc, 'titlesBackBtn');
    await waitScreen(win, doc, 'scr-v2-home', 3000);
    assertNoErrors(errors, '入口の⚙の操作で未捕捉の例外');
    win.close();
  });

  await r.test('扉のあとは入口に着き、やることの名前で分かれている（第41弾・指示66-3 E1）', async () => {
    // **役割（ホスト／ゲスト）ではなく、やることの名前で分ける。**
    // 初めて来た人には、自分がホストなのかゲストなのか分からない（第41弾の決めごとは変わらない）
    const { win, doc, errors } = await launch({ loggedOut: true, atEntry: true });
    assertEqual(activeScreen(doc), 'scr-v2-home', '扉の次は入口');
    const ids = Array.from(doc.querySelectorAll('#scr-v2-home .v2-in [data-home-act]')).map(c => c.dataset.homeAct).join(',');
    assertEqual(ids, 'make,join,one', '部屋をつくる・部屋に入る・1台で遊ぶ');
    const text = el(doc, 'scr-v2-home').textContent;
    assert(!/ホスト|ゲスト/.test(text),
      '役割の名前が出ていない（実際: ' + text.replace(/\s+/g, ' ').trim().slice(0, 60) + '）');
    assertNoErrors(errors, '未ログインの起動で未捕捉の例外');
    win.close();
  });

  await r.test('ログインしていなくても「1台で遊ぶ」なら一覧に着く（指示66-3 S5）', async () => {
    const { win, doc, errors } = await launch({ loggedOut: true });
    assertEqual(activeScreen(doc), 'scr-v2-pick', 'ログイン画面で止めない');
    assert(doc.querySelector('#scr-v2-pick [data-home-act="pick-exit"]'), '入口へもどる ‹ がある');
    assertNoErrors(errors, '未ログインの起動で未捕捉の例外');
    win.close();
  });

  await r.test('説明は、遊び始めずに読める（第41弾 2-7・指示66-3 のページ）', async () => {
    // ページにルール3つ。さらにくわしい説明（入っているゲーム・ゲームごとの人数）は「くわしく見る」——前の popup のまま。
    // ログインしていなくても読める
    const { win, doc, errors } = await launch({ loggedOut: true });
    click(doc, cart(doc, 'jinro'));
    await sleep(win, 60);
    const page = doc.querySelector('#scr-v2-pick [data-home-page].is-cur');
    assert(page && page.querySelectorAll('.v2-rule').length === 3, 'ページにルール3つ');
    click(doc, doc.querySelector('#scr-v2-pick [data-home-page].is-cur [data-home-act="pick-more"]'));
    await sleep(win, 400);
    const panel = doc.querySelector('#uiLayerRoot .ui-popup-in');
    assert(panel, 'くわしい説明が開く');
    const text = panel.textContent;
    assert(/1台でもあそべる|1台では遊べません/.test(text), '1台で遊べるかが分かる');
    assert(/みんなのスマホ/.test(text), 'みんなのスマホで遊べるかも分かる');
    assert(/人狼|ワードウルフ/.test(text), '中に入っているゲームが分かる');
    // **読んだだけでは遊び始めない**（この検査の本体）
    assertEqual(activeScreen(doc), 'scr-v2-pick', '説明を読んでも一覧から動かない');
    const x = doc.querySelector('#uiLayerRoot [data-ui="close"]');
    assert(x, 'とじる道がある');
    x.click();
    await sleep(win, 400);
    assertNoErrors(errors, '説明で未捕捉の例外');
    win.close();
  });

  await r.test('ログインすると、頼まれた用事の続きに戻る（部屋をつくる → ログイン → そのまま部屋ができる）', async () => {
    const { win, doc, errors } = await launch({ loggedOut: true, fakeSocket: true, atEntry: true });
    win.__rtFake.replies = { 'room:create': () => ({ ok: true, code: 'ABC234', memberId: 'm1',
      room: { code: 'ABC234', hostMemberId: 'm1', playerCount: 1, members: [{ id: 'm1', name: 'test', role: 'player', connected: true, isHost: true }], state: { phase: 'lobby', game: null, data: {} } } }) };
    click(doc, doc.querySelector('#scr-v2-home [data-home-act="make"]'));   // 立てるにはログインが要る
    await waitScreen(win, doc, 'scr-login', 3000);
    el(doc, 'loginUsername').value = 'test';
    el(doc, 'loginPassword').value = 'pw';
    click(doc, 'loginSubmitBtn');
    await waitScreen(win, doc, 'scr-v2-room', 4000);
    assert(win.__rtFake.emits.some((e) => e.name === 'room:create'), 'ログインのあと、そのまま部屋をつくった');
    assertNoErrors(errors, 'ログイン後の復帰で未捕捉の例外');
    win.close();
  });

  await r.test('アイコン・二つ名の画面で、称号を選び直せる', async () => {
    const { win, doc, errors } = await launch();
    await waitScreen(win, doc, 'scr-v2-pick', 4000);
    // 指示66-3：前の棚の下部バー（名前のところ）の役目は、⚙ →「アイコン・二つ名」
    win.eval("document.getElementById('floatingGearBtn')");
    win.goToScreen('scr-titles');
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
      // 指示68-1：もう取れないパーツ（retired・実物解除）は、持っていない人の分母に入れない
      ? win.TitleLogic.PART_KEYS.reduce((n, k) => n + win.TitleLogic.partsOf(k).filter((p) => !p.retired).length, 0)
      : null;
    assertEqual(Number(m[2]), 目録の全数, '分母が目録の実際のパーツ数と一致する');
    assertEqual(Number(m[1]), 並んだ.length, '分子が、実際に並んでいる数と一致する');
    // 手渡しで自分の活躍として数えてもらう方法を案内する
    assert(/test/.test(el(doc, 'titleHandoffNote').textContent), '名前を合わせる案内が出る');
    click(doc, 'titlesBackBtn');
    await waitScreen(win, doc, 'scr-v2-home', 3000);   // 部屋にいない時のもどり先は入口
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

  await r.test('64：絵文字の差し替えは、同じ行の字（名前）を HTML として動かさない', async () => {
    // 文字の節点の中身は、もう escape がほどけた「字」。差し替えのために innerHTML へ戻すと、
    // 名前に書いた HTML が動いた（大画面の「⚖️ 決選投票：〈名前〉」で見つけた。スマホの画面も同じ道を通る）
    const { win, doc } = await launch();
    const EmojiSvg = win.EmojiSvg;
    const box = doc.createElement('div');
    box.textContent = '⚖️ 決選投票：<img src=x data-xss=1>・びび & <b>';
    doc.body.appendChild(box);
    const 差し替えた = EmojiSvg.parse(box, doc);
    assert(差し替えた > 0, '前提：絵文字の差し替えが走った');   // 型(b)：差し替えが走らなければ自明に通る
    assertEqual(box.querySelectorAll('[data-xss], b').length, 0, '名前の HTML が要素にならない');
    assert(/<img src=x data-xss=1>・びび & <b>/.test(box.textContent), '字はそのまま出る（' + box.textContent + '）');
    assert(box.querySelector('.emj'), '絵文字は差し替わる');
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

  /**
   * 指示63 2-2：**称号の知らせは、結果の上にかぶせない。**
   * 結果に着いて1.6秒たってから、画面の下に小さく出て、自分で閉じる。押しても閉じる。
   * 着けるボタンは出さない（着替えは待合で）。手に入れたものには NEW の印が立つ。
   * （それまでは全面の幕「新しく手に入れた！／すぐ着ける／あとで」が結果を覆い、押すまで閉じなかった）
   */
  await r.test('63 2-2：称号の知らせは、結果が読めてから画面の下に小さく出て、自分で閉じる', async () => {
    const { win, doc, errors } = await launch();
    autoDialog(win, doc);
    // このテストが見るのは知らせの仕組み。実行する日が季節イベント中だと
    // 季節のパーツも同時に手に入るので、季節は切っておく
    win.TitleLogic.seasonFor = () => null;
    // あれそれどれこれを1回あそぶと「はじめの参加証」が手に入る
    /**
     * **「褒める」の番が来た時刻を、本物の舞台から拾う。**
     * 最初は「結果に着いて 700ms で出ていない」だけを見ていたが、褒めるは結果の演出が
     * 済んでから回るので、**待ちを外しても 700ms では出ない**——変異が素通りした（落とし穴10-b）。
     * 待ちが効いているかは、褒めるの番が来た瞬間から数える
     */
    let 番が来た = 0;
    const 本物の舞台 = win.FxKit.stage;
    win.FxKit.stage = function(fn, opt){
      return 本物の舞台.call(this, function(){ if (opt && opt.praise && !番が来た) 番が来た = Date.now(); return fn.apply(this, arguments); }, opt);
    };
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
    const toast = el(doc, 'titleGotOverlay');
    // 結果が読める間はかぶせない（着いてすぐには出ない）
    await sleep(win, 700);
    assert(!toast.classList.contains('show'), '結果に着いてすぐには出ない（自分の順位を先に読める）');
    await waitFor(win, () => 番が来た > 0, 8000, '褒めるの番が来る（型(b)：待ちを数える起点がある）');
    await sleep(win, 600);
    assert(!toast.classList.contains('show'), '褒めるの番が来ても、すぐには出さない（1.5秒は結果を読ませる）');
    await waitFor(win, () => toast.classList.contains('show'), 5000, '少しして、知らせが出る');
    const 待った = Date.now() - 番が来た;
    assert(待った >= 1400, '褒めるの番から 1.5秒ほど待って出る（いま ' + 待った + 'ms）');
    assert(toast.closest('#uiLayerRoot'), '置き場は #app の外（長い画面でも画面の下に出る・落とし穴26）');
    assert(toast.classList.contains('title-toast'), '全面の幕ではなく、小さな知らせ');
    assert(/はじめの参加証/.test(toast.textContent), '何を手に入れたかが出る（いま「' + toast.textContent.trim().slice(0, 60) + '」）');
    assert(/称号を手に入れた/.test(toast.textContent), '称号を手に入れたと分かる');
    assertEqual(toast.querySelectorAll('button').length, 0, '着けるボタンは出さない（着替えは待合で）');
    assert(win.titleProbe().newIds.length >= 1, '手に入れたものに NEW の印が立つ');
    // 押すと閉じる
    toast.click();
    await sleep(win, 60);
    assert(!toast.classList.contains('show'), '押すと閉じる');
    assertNoErrors(errors, '称号の知らせで未捕捉の例外');
    win.close();
  });

  await r.test('60 A-1a②：あれそれの称号は、スコア画面に着いてから出る（答えの発表では出ない）', async () => {
    // 実機で「称号の獲得演出が、どの演出よりも先に出る」と報告された。
    // あれそれは答えの発表（scr-reveal）で数え、2.2秒後にスコア画面へ移る——
    // 数えたその場で見せていたので、**スコア画面より前**に出ていた
    const { win, doc, errors } = await launch();
    autoDialog(win, doc);
    win.TitleLogic.seasonFor = () => null;
    // 出た瞬間の画面を、見張りに拾わせる（時々覗くと取りこぼす・落とし穴28）
    const 出た時の画面 = [];
    const mo = new win.MutationObserver(() => {
      if (el(doc, 'titleGotOverlay').classList.contains('show')) 出た時の画面.push(activeScreen(doc));
    });
    mo.observe(el(doc, 'titleGotOverlay'), { attributes: true, attributeFilter: ['class'] });
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
    // 型(b)：答えの発表を本当に通ったか（通っていなければ「そこで出なかった」は自明）
    await waitScreen(win, doc, 'scr-reveal', 8000);
    await waitScreen(win, doc, 'scr-score', 8000);
    await waitFor(win, () => 出た時の画面.length > 0, 5000, '称号が出る');
    mo.disconnect();
    assertEqual(出た時の画面[0], 'scr-score', '称号は、スコア画面に着いてから出る');
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
    // 印は :root（第47弾）。画面いっぱいの演出は #app の外にいるので、
    // #app に付けた印では届かない
    assert(doc.documentElement.classList.contains('no-shake'), '切った瞬間から効いている');
    click(doc, 'sgStartBtn');
    await waitFor(win, () => activeScreen(doc) !== 'scr-door', 4000, '扉が開く');
    assertEqual(el(doc, 'safetyGate').style.display, 'none', '案内は閉じた');
    assertEqual(win.localStorage.getItem('acac-safety-seen'), '1', '2回目からは出ない印が残る');
    assertNoErrors(errors, '安全の案内で未捕捉の例外');
    win.close();
  });

  await r.test('安全に関する設定に、光・揺れ・振動・速さが並ぶ', async () => {
    const t = await launch();
    await H.openAppSettings(t.win, t.doc);
    const row = t.doc.querySelector('#setAppMenu [data-setpage="safety"]');
    assert(row, '「安全に関する設定」の入口がある');
    // 指示68-1：「体を動かす遊び」は実物解除と一緒に消した。入口の説明にも名前を残さない（写真で見つけた）
    assert(!/体を動かす/.test(row.textContent), '入口の説明に、消した「体を動かす遊び」が無い（' + row.textContent.trim() + '）');
    row.click();
    await sleep(t.win, 60);
    ['setFlashToggle', 'setShakeToggle', 'setVibrateToggle', 'setFxSeg']
      .forEach((id) => assert(el(t.doc, id), id + ' が並んでいる'));
    // 光の点滅を切ると、その瞬間から画面に印がつく（CSSがまとめて止める）
    click(t.doc, 'setFlashToggle');
    await sleep(t.win, 30);
    assert(t.doc.documentElement.classList.contains('no-flash'), '光の点滅オフが効いている');
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
    // 指示63：いま登録されているのは文化祭（リリース記念は開催を終えた）。
    // 数えるところは「季節のid＋Plays」で引いているので、季節を入れ替えても書き換えは要らない
    t.win.TitleLogic.seasonFor = () => ({ id: 'bunkasai', label: '文化祭', icon: '🏮', theme: 'season-bunkasai' });
    const stats = await playOneRound(t);
    assertEqual(stats.season.bunkasaiPlays, 1, '集まって遊んだ1回が数えられる');
    assertEqual(stats.season.bunkasaiCrowd, 0, '2人では「5人以上」は数えない');
    assertEqual(stats.season.releasePlays, 0, '終わったリリース記念は、もう数えない');
    assertNoErrors(t.errors, '季節の数えで未捕捉の例外');
    t.win.close();
  });

  await r.test('季節イベント：期間外は、獲得条件が完全に無効', async () => {
    const t = await launch();
    t.win.TitleLogic.seasonFor = () => null;   // 期間外
    const stats = await playOneRound(t);
    assertEqual(stats.season.bunkasaiPlays, 0, '期間外は1つも増えない');
    assertEqual(stats.season.bunkasaiCrowd, 0, '同上');
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

  await r.test('63 2-2：演出をスキップにしていても、称号の知らせ（文字）は出て、自分で閉じる', async () => {
    // スキップは「動きを止める」設定で、知らせ（読む情報）は消さない。出て、数秒で閉じる
    const t = await launch();
    autoDialog(t.win, t.doc);
    t.win.TitleLogic.seasonFor = () => null;
    await H.openAppSettings(t.win, t.doc);
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
    const toast = el(t.doc, 'titleGotOverlay');
    await waitFor(t.win, () => toast.classList.contains('show'), 5000, 'スキップでも知らせは出る');
    // 押さなくても閉じる（5秒）——型(b)：本当に出ていたものが、押さずに消える
    await waitFor(t.win, () => !toast.classList.contains('show'), 8000, '押さなくても、数秒で閉じる');
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
    // 指示63：置き場は「その日の称号」（acac-guest-titles。取った一覧・姿・NEW を日付つきで）
    const 残った = win.localStorage.getItem('acac-guest-titles');
    assert(残った, '選んだ姿が端末に残る（実際: ' + 残った + '）');
    assertEqual(JSON.parse(残った).equipped.icon, picks[0].dataset.pickicon, '選んだアイコンが残っている');

    // **開き直しても残っている**
    const b = await launch({ loggedOut: true, browse: true, storage: { 'acac-guest-titles': 残った } });
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
    // 「ルールを変える」から来たモードの画面の ← は「つぎは？」にもどる（くまくんの決め 2026-10-25）。一覧へは「一覧から えらぶ」
    click(doc, 'backToShelfBtn');
    await chooseNext(win, doc, 'shelf');
    await waitScreen(win, doc, 'scr-v2-pick', 3000);
    win.goToScreen('scr-titles');   // ⚙ →「アイコン・二つ名」と同じ画面
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
    await waitScreen(win, doc, 'scr-v2-home', 3000);
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
    click(doc, doc.querySelector('#modeCards [data-id="oneword"]'));
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
    // 「ルールを変える」から来たモードの画面の ← は「つぎは？」にもどる（くまくんの決め 2026-10-25）。一覧へは「一覧から えらぶ」
    click(doc, 'backToShelfBtn');
    await chooseNext(win, doc, 'shelf');
    await waitScreen(win, doc, 'scr-v2-pick', 3000);
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
    click(doc, doc.querySelector('#modeCards [data-id="oneword"]'));
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
    // 「ルールを変える」から来たモードの画面の ← は「つぎは？」にもどる（くまくんの決め 2026-10-25）。一覧へは「一覧から えらぶ」
    click(doc, 'backToShelfBtn');
    await chooseNext(win, doc, 'shelf');
    await waitScreen(win, doc, 'scr-v2-pick', 3000);
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

  await r.test('はじめて触る人にも、押す前に行き先が分かる（第8部-4・指示66-3 E1）', async () => {
    // 友達の家で初めて触る人が、いきなり棚を見せられても分からない。
    // 入口の3つは、ボタンの中の小さな字が行き先を言う（見本 E1）
    const { win, doc, errors } = await launch({ atEntry: true });
    assertEqual(activeScreen(doc), 'scr-v2-home', '扉のつぎの画面');
    assert(/あつまれ/.test(doc.querySelector('#scr-v2-home .v2-elogo').textContent), 'アプリの名前が大きく出ている');
    const make = doc.querySelector('#scr-v2-home [data-home-act="make"]');
    const join = doc.querySelector('#scr-v2-home [data-home-act="join"]');
    const one = doc.querySelector('#scr-v2-home [data-home-act="one"]');
    assert(/TV|PC/.test(make.textContent), '集める人の行き先が分かる（' + make.textContent + '）');
    assert(/コード/.test(join.textContent), '呼ばれた人の行き先が分かる（' + join.textContent + '）');
    assert(/1台/.test(one.textContent), '1台で遊ぶ人の行き先が分かる（' + one.textContent + '）');
    assertNoErrors(errors, '入口で未捕捉の例外');
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





  // ---- 第41弾 2-3：人数チップ ----










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

  // ═══ 第42弾 門E8：未ログインの経路 ═══════════════════════════
  // 指示42 2-2 は「未ログイン時は端末（既存の経路）」と書いていたが、
  // **その経路は無かった**（着手前の棚卸しで判明）。42で新設した分をここで見張る。

  await r.test('未ログインでも「いまの自分」を開ける（2-5・門E8）', async () => {
    const { win, doc, errors } = await launch({ loggedOut: true, browse: true });
    assert(!el(doc, 'shelfMeBtn').disabled, '下部バーの自分は、未ログインでも押せる');
    click(doc, 'shelfMeBtn');
    await waitScreen(win, doc, 'scr-titles', 3000);

    const note = el(doc, 'titleGuestNote');
    assertEqual(note.style.display, '', '未ログインの一言が出ている');
    assert(note.textContent.length > 0, '一言に中身がある（実際:「' + note.textContent + '」）');
    // **責めない。**「できません」ではなく「〜すると残ります」の向き（第40弾のトーン）
    assert(!/できません|してください/.test(note.textContent),
      '責める言い方になっていない（実際:「' + note.textContent + '」）');
    // 2-5：いまの自分は見える
    assert(el(doc, 'titlePreviewIcon').textContent.length > 0, 'アイコンは出ている');
    assert(el(doc, 'titlePreviewTitle').textContent.length > 0, '二つ名も出ている');
    assertNoErrors(errors, '未ログインの称号画面で未捕捉の例外');
    win.close();
  });

  await r.test('未ログインでは、姿を変える選択肢が各スロット1つしかない（門E8の実態）', async () => {
    // **これは仕様の確認であって、不具合の指摘ではない。**
    // 未ログインで持てるのは無印のパーツだけで、無印は各スロットにちょうど1つ。
    // つまり「未ログインで選んだ姿を端末に残す」経路は生きているが、
    // **今のところ残る値は初期状態しかありえない。**
    // 増やすには CATALOG に無印のパーツを足すことになり、指示42の6節が禁じている。
    // ここを数えておかないと、あとで「端末保存が効いていない」と誤診する
    const { win, doc, errors } = await launch({ loggedOut: true, browse: true });
    click(doc, 'shelfMeBtn');
    await waitScreen(win, doc, 'scr-titles', 3000);

    // アイコンのシート
    click(doc, 'profIconBtn');
    await waitFor(win, () => doc.querySelectorAll('#uiLayerRoot [data-pickicon]').length > 0,
      3000, 'アイコンのシートが開く');
    const アイコン数 = doc.querySelectorAll('[data-pickicon]').length;
    assertEqual(アイコン数, 1, '未ログインで持っているアイコンは1つ');
    win.UiKit.closeTop('とじる');
    await sleep(win, 250);

    // 二つ名の3スロット
    click(doc, 'profNameBtn');
    await waitFor(win, () => !!doc.querySelector('[data-pickslot="first"]'), 3000, '二つ名のシートが開く');
    const 数えた = [];
    for (const part of ['first', 'joiner', 'last']) {
      doc.querySelector('[data-pickslot="' + part + '"]').click();
      await waitFor(win, () => doc.querySelectorAll('#uiLayerRoot [data-pickpart]').length > 0,
        3000, part + ' の候補が出る');
      数えた.push(part + '=' + doc.querySelectorAll('[data-pickpart]').length);
      const 候補 = Array.from(doc.querySelectorAll('[data-pickpart]'));
      assertEqual(候補.length, 1, part + ' の候補は1つ');
      // 押す経路そのものは生きている（同じものを選び直しても保存は走る）
      候補[0].click();
      await sleep(win, 250);
      click(doc, 'profNameBtn');
      await waitFor(win, () => !!doc.querySelector('[data-pickslot="first"]'), 3000, 'シートに戻る');
    }
    assertEqual(数えた.length, 3, '3スロットぜんぶ数えた（実際:' + 数えた.join('・') + '）');  // 型(b)

    // **保存の経路は生きている。**値が初期状態と同じでも、端末に書かれること自体は別の話
    const 端末 = win.guestLookProbe();
    assert(端末, '未ログインでも、選んだ姿が端末に書かれている');
    assertEqual(端末.first, win.titleProbe().equipped.first, '書かれた値は、いまの姿と一致する');

    // 開き直しても同じ姿（読み戻しの経路も生きている）
    const 保存 = win.localStorage.getItem('acac-guest-titles');
    const 前の姿 = JSON.stringify(win.titleProbe().equipped);
    win.close();
    const b = await launch({ loggedOut: true, browse: true, storage: { 'acac-guest-titles': 保存 } });
    assertEqual(JSON.stringify(b.win.titleProbe().equipped), 前の姿,
      '開き直しても、端末に残した姿から始まる');
    assertNoErrors(errors, '未ログインの保存で未捕捉の例外');
    b.win.close();
  });

  await r.test('ログインした瞬間、端末に残っていた姿は捨てる（門E8・本人の裁定）', async () => {
    // **引き継がない。**未ログインで選んだのが、いまログインした人だとは限らない——
    // 1台をみんなで回すアプリなので、友達の端末で棚を眺めてから
    // 自分のアカウントに入る順番は普通に起きる（本人の裁定 2026-09-09）。
    // 引き継ぐと、自分の記録に他人の選択が乗る。
    const 端末の姿 = { icon: 'icon-wolf-1', first: 'first-natsu', joiner: 'joiner-no', last: 'last-ippo' };
    // 指示63：端末の置き場は「その日の称号」。日付は今日（日本時間）——昨日の分なら、そもそも読まれない
    const 今日 = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
    const { win, errors } = await launch({
      storage: { 'acac-guest-titles': JSON.stringify({ day: 今日, stats: {}, unlocked: ['icon-wolf-1', 'first-natsu'], equipped: 端末の姿, newIds: [] }) },
      seedTitles: ['icon-wolf-1', 'first-natsu']   // アカウント側もそのパーツは持っている
    });

    // **前提を先に確かめる**（型b）。端末の姿とアカウントの姿が同じなら、
    // 「捨てた」も「引き継いだ」も見分けが付かない
    const いま = win.titleProbe().equipped;
    const 違う = Object.keys(端末の姿).filter((k) => 端末の姿[k] !== いま[k]);
    assert(違う.length > 0, '端末の姿と、いまの姿が違う（違う所:' + 違う.join('・') + '）');
    // 持っていないから落ちた、ではないことも示す（落ちたなら「捨てた」の証明にならない）
    assert(win.titleProbe().unlocked.indexOf('icon-wolf-1') >= 0,
      'アカウントは icon-wolf-1 を持っている（＝落ちたのではなく、捨てられた）');

    assertEqual(いま.icon, 'icon-default', 'アイコンはアカウント側（初期状態）');
    assertEqual(いま.first, 'first-hajime', '二つ名もアカウント側（初期状態）');
    assertEqual(win.guestLookProbe(), null, '端末に残っていた姿は消えている');
    assertEqual(win.localStorage.getItem('acac-guest-titles'), null, 'localStorage からも消えている');
    assertNoErrors(errors, 'ログイン時の姿の取り直しで未捕捉の例外');
    win.close();
  });

  r.finish();
})();
