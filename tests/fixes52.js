// tests/fixes52.js — 指示52で直したこと（実機フィードバック 2026-09-15）
//
// ## 52-1：棚の人数チップが効かない
//
// 本人の実機報告「チップを変えても『いま2人』のまま」。再現した：
//
//   チップ6人にしたあと -> headsProbe: heads=2 / 見当=6
//   棚のチップ: "👥 2人　▾"          ← 6を押したのに 2人
//   localStorage acac-heads = 6      ← 保存はされている
//   jinro dim / auction dim / sugoroku dim   ← 沈んだまま
//
// 真因は `currentPlayerCount()` の優先順位で、
// `state.players.length`（手渡しの名簿）を `shelfHeads`（チップ）より先に読むこと。
// **名簿には「いつ終わるか」の区切りが無く**、空に戻るのは
// 設定＞すべて削除だけだったので、一度でも手渡しで登録した端末では
// チップは押せて・保存されて・**誰にも読まれない**。
// 指示44の着手前とまったく同じ形が、別の入口で復活していた。
//
// 区切りは**棚に戻った時**（本人の裁定 2026-09-15）。
// 名前も得点も消さず、手放すのは「いま何人いるか」の権威だけ。
//
// **もう半分**（こちらが本題）：棚の表示だけ直すと、
// 棚は「6人」と出しているのに名簿の2人で始まる。
// 第12弾-7 が「2回目以降は登録画面を飛ばす」ので、
// **遊ぶ人は気づく画面を1つも通らない**。だから食い違う時は登録画面を通す。
//
// 検体は**本物の経路だけ**を通す（落とし穴25）——
// `state.players` へ手で代入しない。棚→遊び方→ゲーム→登録→終了→棚、と人が歩く順に歩く。

const { createRunner, assert, assertEqual,
  launch, activeScreen, sleep, waitScreen, waitFor, el, click, openCassette, autoDialog } = require('./harness');
const UiText = require('../public/js/ui-text');
const { cssRules } = require('./harness');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

/** 棚のチップで人数を選ぶ（本物のシートを開いて押す） */
async function 人数をえらぶ(win, doc, n) {
  click(doc, 'shelfChip');
  await sleep(win, 200);
  const b = doc.querySelector('[data-heads="' + n + '"]');
  if (!b) throw new Error(n + '人が選べない');
  b.click();
  await sleep(win, 250);
}

/** 手渡しで人狼へ入り、名前を入れて登録する（本物の登録経路） */
async function 手渡しで登録(win, doc, 名前) {
  await openCassette(win, doc, 'jinro');
  if (activeScreen(doc) === 'scr-play-way') {
    click(doc, doc.querySelector('#wayChoices [data-way="handoff"]'));
    await waitScreen(win, doc, 'scr-game', 3000);
  }
  doc.querySelector('#gameCards .mode-card[data-game="wolfrole"]').click();
  await sleep(win, 50);
  Array.from(doc.querySelectorAll('#scr-game button'))
    .find((b) => /つぎへ/.test(b.textContent)).click();
  await waitScreen(win, doc, 'scr-setup', 3000);
  // いまの行数を、欲しい人数に合わせる
  let 守り = 40;
  while (parseInt(el(doc, 'playerCountLabel').textContent, 10) > 名前.length && 守り--) {
    click(doc, 'playerMinusBtn');
  }
  while (parseInt(el(doc, 'playerCountLabel').textContent, 10) < 名前.length && 守り--) {
    click(doc, 'playerPlusBtn');
  }
  await sleep(win, 30);
  const inputs = doc.querySelectorAll('#scr-setup input.draft-name');
  名前.forEach((n, i) => {
    inputs[i].value = n;
    inputs[i].dispatchEvent(new win.Event('input', { bubbles: true }));
  });
  click(doc, 'setupNextBtn');
  await waitScreen(win, doc, 'scr-mode', 4000);
}

/**
 * **着かなくても投げない待ち。**
 * `waitScreen` は着かないと自分の言葉で投げるので、
 * そのあとの `assertEqual` まで届かない——
 * **変異を回した時に「狙った理由で赤くなった」と読めなくなる**
 * （実際、52-1D と 52-1G が「赤だが別の理由」に転んだ）。
 * 待つだけ待って、判定はこちらの言葉でする
 */
async function 着くまで待つ(win, doc, id, ms) {
  const 終わり = Date.now() + (ms || 4000);
  while (Date.now() < 終わり) {
    if (activeScreen(doc) === id) return true;
    await sleep(win, 50);
  }
  return false;
}

/** 設定＞いま遊んでいるゲーム＞ゲームを終了する で棚へ戻る */
async function ゲームを終了(win, doc) {
  const ov = el(doc, 'settingsOverlay');
  if (!ov.classList.contains('show')) { click(doc, 'floatingGearBtn'); await sleep(win, 150); }
  const toGame = doc.querySelector('#setRootMenu [data-setpage="game"]');
  if (toGame) { toGame.click(); await sleep(win, 150); }
  const row = doc.getElementById('endGameBtn');
  if (!row) throw new Error('「ゲームを終了する」の行が出ていない');
  row.click();
  await waitScreen(win, doc, 'scr-shelf', 5000);
}

(async () => {
  const r = createRunner('fixes52');

  // ===================== 52-1 人数チップ =====================

  await r.test('52-1：手渡しで遊んだあと、棚のチップを変えると人数が追随する', async () => {
    const { win, doc } = await launch({ fakeSocket: true });
    const stop = autoDialog(win, doc, (dlg) => {
      if (/入力しなおしますか/.test(dlg.見出し)) return false;  // 「このまま続ける」＝直しにくい側
      return true;
    });
    try {
      await 人数をえらぶ(win, doc, 4);
      assertEqual(win.headsProbe().heads, 4, 'まっさらな端末では、チップがそのまま人数');

      await 手渡しで登録(win, doc, ['あき', 'びび']);
      // **型(b)：直す前の状況が、本当に作れているか。**
      // 名簿がゲーム中の権威であること自体は正しい（44のまま）
      assertEqual(win.headsProbe().heads, 2, 'ゲーム中は、名簿が人数の権威');

      await ゲームを終了(win, doc);
      assertEqual(win.headsProbe().heads, 4,
        '棚に戻ったら、名簿は人数の権威を手放す（チップが勝つ）');

      await 人数をえらぶ(win, doc, 6);
      const p = win.headsProbe();
      assertEqual(p.見当, 6, 'チップの値は6になっている');
      assertEqual(p.heads, 6,
        '**チップを6にしたら、人数も6になる**（実機報告：ここが2のままだった）');
      assert(/6人/.test(el(doc, 'shelfChip').textContent),
        '棚のチップの文字も「6人」（押した本人の目に見える）');
    } finally { stop(); win.close(); }
  });

  await r.test('52-1：チップを変えたら、棚の札の沈みも晴れる', async () => {
    const { win, doc } = await launch({ fakeSocket: true });
    const stop = autoDialog(win, doc, (dlg) => {
      if (/入力しなおしますか/.test(dlg.見出し)) return false;
      return true;
    });
    try {
      await 人数をえらぶ(win, doc, 4);
      await 手渡しで登録(win, doc, ['あき', 'びび']);
      await ゲームを終了(win, doc);

      const 沈み = () => Array.from(doc.querySelectorAll('.cart[data-cart]'))
        .filter((c) => c.classList.contains('dim')).map((c) => c.dataset.cart);

      await 人数をえらぶ(win, doc, 2);
      const 少ない時 = 沈み();
      // **型(b)：沈む状況が本当に作れているか。**
      // ここが0件だと、次の「晴れた」が自明に通る
      assert(少ない時.length > 0,
        '2人では、3人以上のカセットが沈んでいる（' + 少ない時.join('・') + '）');

      await 人数をえらぶ(win, doc, 6);
      assertEqual(沈み().join('・'), '',
        '6人にしたら、3人以上のカセットの沈みが晴れる（実機報告：沈んだままだった）');
    } finally { stop(); win.close(); }
  });

  await r.test('52-1：チップで変えた人数で、実際にゲームが始まる（気づけない上書きを作らない）', async () => {
    // **こちらが本題。**棚の表示だけ直すと、棚は6人と出しているのに
    // 名簿の2人で始まる。第12弾-7 が登録画面を飛ばすので、
    // 遊ぶ人は気づく画面を1つも通らない
    for (const [答え, ラベル] of [[false, 'このまま続ける'], [true, '入力しなおす']]) {
      const { win, doc } = await launch({ fakeSocket: true });
      const stop = autoDialog(win, doc, (dlg) => {
        if (/入力しなおしますか/.test(dlg.見出し)) return 答え;
        return true;
      });
      try {
        await 人数をえらぶ(win, doc, 4);
        await 手渡しで登録(win, doc, ['あき', 'びび']);
        await ゲームを終了(win, doc);
        await 人数をえらぶ(win, doc, 6);

        await openCassette(win, doc, 'jinro');
        if (activeScreen(doc) === 'scr-play-way') {
          click(doc, doc.querySelector('#wayChoices [data-way="handoff"]'));
          await waitScreen(win, doc, 'scr-game', 3000);
        }
        doc.querySelector('#gameCards .mode-card[data-game="wolfrole"]').click();
        await sleep(win, 50);
        Array.from(doc.querySelectorAll('#scr-game button'))
          .find((b) => /つぎへ/.test(b.textContent)).click();
        await 着くまで待つ(win, doc, 'scr-setup', 4000);

        assertEqual(activeScreen(doc), 'scr-setup',
          '「' + ラベル + '」を選んでいても、チップと食い違うなら登録画面を通る');
        assertEqual(el(doc, 'playerCountLabel').textContent, '6',
          '「' + ラベル + '」：登録画面はチップの6人から始まる');
        // **名前は消さない**（手放すのは人数の権威だけ・本人の裁定）
        const 名 = Array.from(doc.querySelectorAll('#scr-setup input.draft-name'))
          .map((i) => i.value);
        assertEqual(名.slice(0, 2).join('・'), 'あき・びび',
          '「' + ラベル + '」：前に入れた名前は持ち越す（入れ直させない）');
      } finally { stop(); win.close(); }
    }
  });

  await r.test('52-1：チップと名簿が同じ数なら、登録画面は出ない（第12弾-7を壊さない）', async () => {
    const { win, doc } = await launch({ fakeSocket: true });
    const stop = autoDialog(win, doc, (dlg) => {
      if (/入力しなおしますか/.test(dlg.見出し)) return false;  // このまま続ける
      return true;
    });
    try {
      await 人数をえらぶ(win, doc, 2);
      await 手渡しで登録(win, doc, ['あき', 'びび']);
      await ゲームを終了(win, doc);
      // チップは触らない（2のまま＝名簿と同じ数）
      await openCassette(win, doc, 'jinro');
      if (activeScreen(doc) === 'scr-play-way') {
        click(doc, doc.querySelector('#wayChoices [data-way="handoff"]'));
        await waitScreen(win, doc, 'scr-game', 3000);
      }
      doc.querySelector('#gameCards .mode-card[data-game="wolfrole"]').click();
      await sleep(win, 50);
      Array.from(doc.querySelectorAll('#scr-game button'))
        .find((b) => /つぎへ/.test(b.textContent)).click();
      await 着くまで待つ(win, doc, 'scr-mode', 4000);
      assertEqual(activeScreen(doc), 'scr-mode',
        '同じ顔ぶれで続ける人は、いままで通り登録画面を飛ばす');
    } finally { stop(); win.close(); }
  });

  // ===================== 52-2 ログインが切れた時 =====================
  //
  // サーバー側（セッションを SQLite に置く）は tests/session-store.js。
  // ここは**端末側**——401を受けた時に、端末が「ログイン済み」のまま固まらないか。

  await r.test('52-2：401を受けたら、端末も「ログイン済み」を降ろして、ログインし直せる', async () => {
    const { win, doc } = await launch({});
    const el2 = (id) => doc.getElementById(id);
    const active = () => (doc.querySelector('.screen.active') || {}).id;
    try {
      await waitFor(win, () => el2('shelfName') && el2('shelfName').textContent, 8000, '起動');
      // **型(b)：ログイン済みの状況が、本当に作れているか。**
      // ここが未ログインのままだと、下の検査は全部自明に通る
      win.authProbe({ id: 1, username: 'kuma-id', displayName: 'くまくん' });
      await sleep(win, 60);
      assertEqual(el2('shelfName').textContent, 'くまくん', 'まずログイン済みにできている');

      // ＝ pm2 restart のあと。以後すべて401
      win.fetch = async function (url) {
        const p = String(url).split('?')[0];
        return { ok: false, status: 401,
          json: async () => ({ error: p === '/api/auth/me' ? '未ログイン' : '要ログイン' }) };
      };

      win.goToProbe('scr-titles');
      await sleep(win, 60);
      doc.querySelector('#scr-titles [data-profgo="rename"]').click();
      await waitFor(win, () => active() === 'scr-rename' || active() === 'scr-login', 4000, '名前変更へ');
      assertEqual(active(), 'scr-rename', '端末はまだログイン済みのつもりなので、名前変更に入る');

      el2('renameInput').value = 'あたらしい名前';
      el2('renameNote').textContent = '';   // 入場時の注記を消してから押す（10-b）
      el2('renameBtn').click();
      await waitFor(win, () => (el2('renameNote').textContent || '').length > 0, 4000, '返事');

      // **サーバーの符丁をそのまま出さない**（指示40のトーン）
      assertEqual(el2('renameNote').textContent, UiText.AUTH.切れた,
        '「要ログイン」ではなく、次の一手が書いてある');
      assert(!/要ログイン/.test(el2('renameNote').textContent),
        'サーバーの符丁が、そのまま画面に出ていない');

      // **ここが本題**：端末の「ログイン済み」が降りたか
      await sleep(win, 100);
      assert(el2('shelfName').textContent !== 'くまくん',
        '401のあと、端末は自分をログイン済みだと思っていない');

      // 降りたので、もう一度押せばログインを頼める（＝詰まない）
      win.goToProbe('scr-titles');
      await sleep(win, 60);
      doc.querySelector('#scr-titles [data-profgo="rename"]').click();
      await waitFor(win, () => active() === 'scr-login' || active() === 'scr-rename', 4000, '2回目');
      assertEqual(active(), 'scr-login',
        '2回目はログイン画面に行ける（開き直す以外に道が無い、を作らない）');
    } finally { win.close(); }
  });

  // ===================== 52-7 画面に貼り付くはずのものが、画面の外へ飛ぶ =====================
  //
  // 実機報告は「アルバムが受け取れない」だったが、**アルバムは壊れていなかった**
  //（サーバー側は 撮る→受け取る→保存→消える まで全部通る）。
  // 壊れていたのは**置き場**で、`#app` が `filter:brightness(...)` を持つため
  // `position:fixed` の基準が画面ではなく `#app`（＝ページ全体）になっていた（落とし穴26）。
  //
  // 実ブラウザで、同じページ・同じスクロール位置（1200px）で A/B した：
  //
  //   直す前（#app に filter あり）… パネル top = **-1144**（画面の外）
  //   直した後（filter 無し）      … パネル top = 86（画面の中）
  //
  // **12個を `#uiLayerRoot` へ移す案は採らなかった。**
  // 動かす前に数えたら、`.app ◯◯` の形で重なりの中身に届いている規則が**64本**あった
  //（テーマ5種の card・btn・switch・seg-btn・overlay-panel・close-x…）。
  // 移すと64本を書き直すことになり、**CSSは何も言わない**ので、
  // 壊れても全テストは緑のまま本番に出る（落とし穴23・27・30）。
  // 代わりに**基準を作るのをやめた**——明るさ補正は、本人が既定から動かした時だけ
  // `#app > *` に掛ける。`.overlay` は自分自身に filter を持つことになるが、
  // **自分の filter は自分の基準にはならない**ので、画面に正しく貼り付く。
  //
  // ## この検査は、既存の見張りの「逆向き」を埋める（落とし穴20）
  //
  // `tests/ui-kit.js` の「重なりの置き場が、filter の付いた箱の中に無い」は
  // **`#uiLayerRoot` の先祖だけ**を見ていた。
  // markup に書かれた12個の `.overlay` は `#app` の中にいるので、
  // その見張りの目には最初から入っていなかった。
  // ここでは **`position:fixed` を持つ要素を全部** markup から拾って、
  // それぞれの先祖を照らす。一覧は持たない（落とし穴4）。

  await r.test('52-7：画面に貼り付くものの先祖に、基準を作る指定が無い', async () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const css = html.slice(html.indexOf('<style>') + 7, html.indexOf('</style>'))
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/@keyframes[^{]*\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, '');  // 動きの定義は基準を作らない
    const 規則 = cssRules(css);

    // ① 画面に貼り付くもの（position:fixed）の選択子を集める
    const 貼り付く = [];
    規則.forEach((x) => {
      if (!/(^|;|\s)position\s*:\s*fixed/.test(x.body)) return;
      x.sel.split(',').forEach((s) => {
        const t = s.trim();
        if (!t || t.indexOf('::') >= 0) return;   // 疑似要素は、その親が基準なので別の話
        貼り付く.push(t);
      });
    });
    // 型(b)：集められていないまま「違反0件」で緑にしない
    assert(貼り付く.length > 10, '貼り付くものを集められている（実際:' + 貼り付く.length + '件）');

    // ② 基準を作りうる指定を集める。
    //    **`#app` を名指ししない**——あとで誰かが body に足した日にも赤くなるように
    const 基準を作る = [];
    規則.forEach((x) => {
      if (/:hover|:active|:focus/.test(x.sel)) return;
      if (!/(^|;|\s)(filter|transform|backdrop-filter|perspective)\s*:/.test(x.body)) return;
      if (/(^|;|\s)(filter|transform)\s*:\s*none\s*(;|$)/.test(x.body)) return;
      x.sel.split(',').forEach((s) => 基準を作る.push(s.trim()));
    });
    assert(基準を作る.length > 5, '基準を作る指定を集められている（実際:' + 基準を作る.length + '件）');

    const dom = new JSDOM(html.replace(/<script[\s\S]*?<\/script>/g, ''));
    const d = dom.window.document;
    const 読めない = [];
    const 悪い = [];
    貼り付く.forEach((sel) => {
      let 要素 = [];
      try { 要素 = Array.from(d.querySelectorAll(sel)); } catch (e) { 読めない.push(sel); return; }
      要素.forEach((n) => {
        // **先祖だけを見る。**自分自身の filter は、自分の基準にはならない
        for (let p = n.parentElement; p; p = p.parentElement) {
          基準を作る.forEach((bs) => {
            let hit = false;
            try { hit = p.matches(bs); } catch (e) { 読めない.push(bs); return; }
            if (hit) {
              悪い.push((n.id ? '#' + n.id : sel) + ' の先祖 '
                + (p.id ? '#' + p.id : p.tagName) + ' ← ' + bs);
            }
          });
        }
      });
    });
    assertEqual(Array.from(new Set(読めない)).join('・'), '',
      '読めない選択子（切り出しがずれている合図・落とし穴10-e）');
    assertEqual(Array.from(new Set(悪い)).join(' ／ '), '',
      '画面に貼り付くものの先祖に、fixed の基準を作る指定が付いている');
  });

  await r.test('52-7：明るさは既定では掛けない（掛けると基準が生まれる）', async () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const css = html.slice(html.indexOf('<style>') + 7, html.indexOf('</style>'))
      .replace(/\/\*[\s\S]*?\*\//g, '');
    // `#app` そのものに filter を置き直した日に、必ず赤くなる
    const appに = cssRules(css).filter((x) =>
      /^(#app|\.app)$/.test(x.sel.trim()) && /(^|;|\s)filter\s*:/.test(x.body));
    assertEqual(appに.length, 0,
      '#app 自身には filter を置かない（置くと fixed の基準になる・落とし穴26）');
    assert(/:root\[data-bright\]\s*#app\s*>\s*\*\s*\{[^}]*filter\s*:\s*brightness/.test(css),
      '明るさは `:root[data-bright] #app > *` に掛ける（印が付いた時だけ）');
    assert(/removeAttribute\('data-bright'\)/.test(html),
      '既定（100%）にもどしたら、印を外す');
  });

  // ===================== 52-5 盤の番号を右下へ =====================
  //
  // 本人の実機フィードバック：「番号はタイルの左上」→ **右下**にする。
  //
  // 番号だけ動かすと重なる——**✕ がすでに右下にいた**ので、場所を入れ替えた。
  // ✕ は「だれかが外した」という一番強い知らせなので、先に目が行く左上へ。
  //
  // さらに実ブラウザで測ったら、**「ここをタップ」と 4×4px かぶっていた**
  //（文字サイズ3段階すべてで）。案内は上へ逃がした——
  // この案内が付くのは「まだ挑んでいないマス」だけ（`bombGridHtml`）なので、
  // 左上の ✕ とは**同じマスに同時に出ない**。ぶつかる相手がいない。
  //
  // 実測（375×812・マス 62×62・番号は右から5px 下から4px）：
  //
  //   小(85%)   かぶり なし
  //   ふつう     かぶり なし
  //   大(130%)  かぶり なし
  //
  // かぶりは 番号／案内／✕／絵柄 の**総当たり**で見た（4つ中2つを選ぶ全通り）。
  //
  // **位置の重なりは jsdom では測れない**（レイアウトを持たない）。
  // だからここはCSSの**錨**を見る——3つが別々の角に錨を下ろしていること。
  // 実際のかぶりは実ブラウザで測って、その数字を上に残す（落とし穴12）。

  await r.test('52-5：番号は右下、✕ は左上、案内は上——3つが別々の角にいる', async () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const css = html.slice(html.indexOf('<style>') + 7, html.indexOf('</style>'))
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const 規則 = cssRules(css);
    const 引く = (sel) => {
      const x = 規則.find((r2) => r2.sel.trim() === sel);
      assert(x, sel + ' の規則がある');   // 型(b)：読めていないまま緑にしない
      const 角 = {};
      ['left', 'right', 'top', 'bottom'].forEach((k) => {
        const m = x.body.match(new RegExp('(^|;|\\s)' + k + '\\s*:\\s*([^;]+)'));
        if (m) 角[k] = m[2].trim();
      });
      return 角;
    };

    const 番号 = 引く('.bw-no');
    assert(番号.right !== undefined && 番号.bottom !== undefined,
      '番号は右下に錨を下ろす（実機フィードバック：左上から移した）');
    assert(番号.left === undefined && 番号.top === undefined,
      '番号が左上にも錨を持っていない（両方あると、どちらが効くか読めない）');

    const バツ = 引く('.bomb-wire-btn.missed::after');
    assert(バツ.left !== undefined && バツ.top !== undefined,
      '✕ は左上（番号と入れ替えた。右下のままだと番号と重なる）');

    const 案内 = 引く('.bw-tip');
    assert(案内.top !== undefined && 案内.bottom === undefined,
      '「ここをタップ」は上（下のままだと、右下の番号と 4×4px かぶった）');

    // **同じマスに ✕ と案内が同時に出ないこと**が、上を使える根拠。
    // その根拠が消えたら、この検査も一緒に赤くなってほしい
    assert(/案内を出す\s*&&\s*!添えた\s*&&\s*!cell\.solved\s*&&\s*!cell\.extraClass/.test(html),
      '案内が付くのは「まだ挑んでいないマス」だけ（✕ の付くマスには出ない）');
  });

  r.finish();
})();
