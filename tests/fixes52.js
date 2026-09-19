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
  launch, activeScreen, sleep, waitScreen, waitFor, el, click, openCassette, autoDialog,
  assertNoErrors } = require('./harness');
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

  await r.test('52-1：チップに一度も答えていない人から、名簿まで取り上げない', async () => {
    /**
     * **クリーンな1回が見つけた、私の設計の穴。**
     *
     * 「棚に戻ったら名簿は人数の権威を手放す」を素直に書いたら、
     * チップに一度も答えていない端末（`shelfHeads` が null）では
     * `currentPlayerCount()` が **0** に落ちた。
     * その結果、ゲームを終えて同じ顔ぶれでもう1つ遊ぼうとすると
     * **どのモードも「いま0人」で押せない**——`smoke` が3件赤くなって分かった。
     *
     * 権威を手放すことと、人数を忘れることは別。
     * チップは「答えてあれば勝つ」だけで、無い時の代わりにはならない。
     */
    const { win, doc } = await launch({ fakeSocket: true });
    const stop = autoDialog(win, doc, (dlg) => {
      if (/入力しなおしますか/.test(dlg.見出し)) return false;   // このまま続ける
      return true;
    });
    try {
      // **チップを一度も押さない**（ここが型(b)：その状況を本当に作る）
      assertEqual(win.headsProbe().見当, null, 'チップにまだ答えていない');
      await 手渡しで登録(win, doc, ['あき', 'びび', 'ちか']);
      assertEqual(win.headsProbe().heads, 3, 'ゲーム中は名簿が権威');

      await ゲームを終了(win, doc);
      assertEqual(win.headsProbe().heads, 3,
        '棚に戻っても、チップが無いなら名簿の人数が残る（0人にしない）');

      // 同じ顔ぶれで、もう1つ遊びに行ける
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
      const 押せない = Array.from(doc.querySelectorAll('#modeCards .mode-card'))
        .filter((c) => c.dataset.locked);
      assert(押せない.length < doc.querySelectorAll('#modeCards .mode-card').length,
        '3人で遊べるモードが押せる（「いま0人」で全部止まらない）');
    } finally { stop(); win.close(); }
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

  // ===================== 52-6 爆発は「演出 → 結果」の順 =====================
  //
  // 本人の実機フィードバック：**閃光が終わってから**「爆発」の文字を出す。
  //
  // `bombBoomFx` は `FxKit.boom()` を**待たずに**バナーを出していたので、
  // 光っている最中に文字が重なっていた。
  // 大画面（`bigBoomCallout`・第47弾 47-6）は最初から `boom().then(callout)` と
  // 正しい順で書いてあったのに、**共通部品のこちらだけが古いまま**だった（落とし穴1）。
  //
  // 新しい仕組みは作らない——`FxKit.boom()` はもともと `hold(700)` を返すので、
  // `.then` でつなぐだけ。スキップ設定では `hold` が 0ms で返るので即座に結果が出る。
  //
  // `node tools/fx-probe.js bomb coop`（本物の進行役を動かす道具）でも確かめた：
  //
  //   ミス3    爆発:1 帯:0   ← 閃光が出て、文字はまだ無い
  //   あと     爆発:1 帯:0
  //   少しあと  爆発:0 帯:1   ← 閃光が消えてから、文字が出た
  //
  // **出ている最中に数える**（落とし穴10-g）。片付いたあとに数えると、
  // 順番が逆でも同じ「1」に見える。

  for (const [種, 光, 語] of [['boom', 'bomb-boom', '爆発'], ['clear', 'fx-flash', '解除成功']]) {
    await r.test('52-6：' + (種 === 'boom' ? '爆発' : '解除成功') + 'は、演出が終わってから結果の文字が出る', async () => {
      const { win, doc } = await launch({});
      try {
        await sleep(win, 300);
        // **出ている最中に見張る**（落とし穴10-g）。
        // `banner()` は**帯が消えてから**解決するので、
        // `await` してから数えると、順番が逆でも同じ「0」に見える
        //（最初そう書いて、3件とも赤くなって気づいた）
        let 光った = -1, 文字が出た = -1, 同時にあった = 0, t = 0;
        const 見張り = setInterval(() => {
          t += 25;
          const 光の数 = doc.querySelectorAll('.' + 光).length;
          const 帯の数 = doc.querySelectorAll('.fx-banner').length;
          if (光の数 > 0 && 光った < 0) 光った = t;
          if (帯の数 > 0 && 文字が出た < 0) 文字が出た = t;
          if (光の数 > 0 && 帯の数 > 0) 同時にあった++;
        }, 25);

        // **本物の関数を呼ぶ**（手で FxKit を並べ直さない・落とし穴25）
        await win.bombFxProbe(種);
        clearInterval(見張り);

        // 型(b)：どちらも本当に出たか。出ていなければ、順番の話は自明に通る
        assert(光った >= 0, '演出が実際に出た（.' + 光 + '）');
        assert(文字が出た >= 0, '結果の文字が実際に出た（.fx-banner）');
        assert(文字が出た > 光った,
          '文字は、演出より**あとに**出る（演出 ' + 光った + 'ms → 文字 ' + 文字が出た + 'ms）');
        assertEqual(同時にあった, 0,
          '光っている最中に文字が重なっている瞬間が無い（' + 同時にあった + '回）');
      } finally { win.close(); }
    });
  }

  await r.test('52-6：スキップにした人には、待たずに結果が出る（大切なこと7）', async () => {
    // `fxSkip` は**遊ぶ人が設定で選べるのと同じ状態**を先に置くだけ（harness の説明どおり）。
    // テスト専用の細工ではないので、本番の道をそのまま通る
    const { win, doc } = await launch({ fxSkip: true });
    try {
      await sleep(win, 300);
      const t0 = Date.now();
      await win.bombFxProbe('boom');
      const かかった = Date.now() - t0;
      assert(かかった < 400,
        'スキップなら、演出を待たずに結果まで進む（いま ' + かかった + 'ms）');
    } finally { win.close(); }
  });

  // ===================== 52-3 すごろくの結果発表 =====================
  //
  // 実機フィードバック：「すごろくは決着後『← 部屋を出る』だけで、**結果発表画面が無い**」。
  //
  // 調べたら、**サーバーは決着の瞬間から `view.result` を配っていた**
  //（`sugoroku-room.js:157`）。順位・同着・位置・コイン・あがりが全部入っている。
  // 端末はそれを `rtSugoEndWords`（1位の名前）にしか使っておらず、
  // 決着画面には**進行中とまったく同じもの**が出ていた——
  // 上帯は「◯◯さんの番」を出し続け、順位表は5ゲームとも存在しない。
  //
  // だから 52-3 は「新しく計算する」話ではなく、**すでに届いているものを出す**話。
  //
  // 形は `scr-rt-au-result`（第38弾・いちばん整った結果画面）に合わせた：
  //   帯 → 見出し「結果発表」→ 勝者 → 全員の順位 → 出口3段
  //
  // **本物の進行役を動かして、本物の publicView を本物の画面へ流す**（落とし穴25）。
  // 進め方は tests/now-line.js と同じ形。

  {
    const { RT_START_MIN_CONFIG } = require('./inventory');
    const { GAME_DRIVERS } = require('../realtime');
    const NAMES = ['あき', 'びび', 'ちか', 'でん', 'えみ'];
    const すごろく = [
      { game: 'sugotoll', n: 3 }, { game: 'sugograb', n: 3 },
      { game: 'sugopair', n: 4 }, { game: 'sugohide', n: 3 },
      { game: 'sugohand', n: 3 },
    ];

    /** 本物の進行役を決着まで回して、本物の画面に流す */
    async function 決着まで(gameId, n, big) {
      const entry = GAME_DRIVERS[gameId];
      const d = entry.driver;
      const { win, doc, errors } = await launch({ fakeSocket: true });
      await waitScreen(win, doc, 'scr-shelf', 9000);
      await openCassette(win, doc, 'sugoroku');
      const way = doc.querySelector('#wayChoices [data-way="room"]');
      if (way) way.click();
      await waitScreen(win, doc, 'scr-rt-lobby', 5000);
      const fake = win.__rtFake;
      await waitFor(win, () => fake.connected, 5000, '疑似socket');

      const members = new Map();
      for (let i = 0; i < n; i++) {
        const id = 'm' + (i + 1);
        members.set(id, { id, name: NAMES[i], role: 'player', connected: true, socketId: 's' + id });
      }
      if (big) members.set('tv', { id: 'tv', name: 'テレビ', role: 'bigscreen', connected: true });
      const room = { code: 'ABC234', members, state: { phase: 'lobby', game: null, data: {} } };
      const res = d.startGame(room, RT_START_MIN_CONFIG[gameId], { notify() {} });
      assertEqual(res.ok, true, gameId + '：進行役を始められる');
      room.state.game = gameId; room.state.phase = 'playing';

      const snap = () => ({
        code: 'ABC234', ownerUserId: 1, ownerUsername: 'kuma', hostMemberId: 'm1',
        playerCount: n, memberCount: n,
        ready: { count: n, total: n, waitingNames: [], all: true },
        members: Array.from(room.members.values()).map((m) => ({
          id: m.id, name: m.name, role: m.role, connected: true,
          isHost: m.id === 'm1', ready: true })),
        state: { phase: room.state.phase, game: gameId, data: d.publicView(room) },
      });
      const 自分 = big ? 'tv' : 'm1';
      fake.replies = { 'room:join': () => ({ ok: true, code: 'ABC234', memberId: 自分, room: snap() }) };
      el(doc, 'rtJoinCode').value = 'ABC234';
      el(doc, 'rtJoinName').value = big ? 'テレビ' : NAMES[0];
      click(doc, 'rtJoinBtn');
      const 前置き = 'scr-' + 'rt-';   // 幽霊の画面idとして拾われないよう組み立てる
      await waitFor(win, () => String(activeScreen(doc)).indexOf(前置き) === 0, 8000, '部屋の画面へ');

      const push = async () => {
        fake.fire('room:update', snap());
        if (d.privateFor) { const mine = d.privateFor(room, 自分); if (mine) fake.fire('wolf:you', mine); }
        await sleep(win, 60);
      };
      const w = room[entry.key];
      const ids = Array.from(room.members.keys());
      await push();
      for (let step = 0; step < 300 && w.phase !== d.PHASE.ENDED; step++) {
        const 前 = w.phase;
        ids.forEach((id) => { try { d.submitAction(room, id, null, {}); } catch (e) {} });
        if (w.deadline && w.deadline > Date.now()) w.deadline = Date.now() - 1;
        try { if (d.advance) d.advance(room); } catch (e) {}
        await push();
        if (w.phase === 前 && step > 60) break;
      }
      assertEqual(w.phase, d.PHASE.ENDED, gameId + '：決着まで回せた');  // 型(b)
      await push(); await sleep(win, 220);
      return { win, doc, errors, snap, fake, result: d.publicView(room).result };
    }

    for (const t of すごろく) {
      await r.test('52-3：' + t.game + ' は決着すると、結果発表の画面に着く', async () => {
        const g = await 決着まで(t.game, t.n);
        try {
          assertEqual(activeScreen(g.doc), 'scr-rt-sugo-result',
            t.game + '：決着したら結果発表へ（盤に留まらない）');

          // 勝者（同着なら全員）
          const 勝ち = g.result.players.filter((p) => p.rank === 1);
          assert(勝ち.length > 0, t.game + '：1位が居る');   // 型(b)
          const 名 = g.doc.getElementById('rtSugoRsWin').textContent;
          勝ち.forEach((p) => assert(名.indexOf(p.name) >= 0,
            t.game + '：1位の「' + p.name + '」が大きく出ている（同着なら全員）'));

          // 全員の順位
          const 行 = g.doc.querySelectorAll('#rtSugoRsRank .rk-row');
          assertEqual(行.length, g.result.players.length,
            t.game + '：全員ぶんの順位が並ぶ');
          const 一覧 = g.doc.getElementById('rtSugoRsRank').textContent;
          g.result.players.forEach((p) => assert(一覧.indexOf(p.name) >= 0,
            t.game + '：「' + p.name + '」が順位表に居る'));

          // 出口（他のカセットと同じ3段）
          const 出 = (id) => {
            const b = g.doc.getElementById(id);
            return b && b.style.display !== 'none';
          };
          assert(出('rtSugoAgainBtn'), t.game + '：「つぎは？」がある（他のカセットと同じ）');
          assert(出('rtSugoResultLeaveBtn'), t.game + '：「← 部屋を出る」がある');
          assert(出('rtSugoEndBtn'), t.game + '：進行役には「部屋を閉じる」がある');

          // **進行中の言葉が残っていない**（実機報告：上帯が「◯◯さんの番」のままだった）
          const 画面 = g.doc.querySelector('.screen.active').textContent;
          assert(画面.indexOf('さんの番') === -1,
            t.game + '：決着の画面に「さんの番」が残っていない（いまの文：'
              + 画面.replace(/\s+/g, ' ').slice(0, 80) + '）');
          assertNoErrors(g.errors, t.game + ' の結果発表で未捕捉の例外');
        } finally { g.win.close(); }
      });
    }

    await r.test('52-3：決着のあとに開き直しても、結果発表に戻る（rtOnce の型）', async () => {
      // 52-3 の境界：「結果画面で開き直し → 結果に復帰」。
      // 端末は何も覚えていない——**どの画面に行くかは、サーバーの段階から導く**
      //（`sugoWantScreen`）。だから開き直しても同じ所に着く。
      // ここは「決着した部屋に、まっさらな端末が入り直す」を作って確かめる
      const 元 = await 決着まで('sugotoll', 3);
      const 決着の知らせ = 元.snap();
      元.win.close();

      const { win, doc } = await launch({ fakeSocket: true });
      try {
        await waitScreen(win, doc, 'scr-shelf', 9000);
        await openCassette(win, doc, 'sugoroku');
        const way = doc.querySelector('#wayChoices [data-way="room"]');
        if (way) way.click();
        await waitScreen(win, doc, 'scr-rt-lobby', 5000);
        const fake = win.__rtFake;
        await waitFor(win, () => fake.connected, 5000, '疑似socket');
        fake.replies = { 'room:join': () => ({ ok: true, code: 'ABC234', memberId: 'm1', room: 決着の知らせ }) };
        el(doc, 'rtJoinCode').value = 'ABC234';
        el(doc, 'rtJoinName').value = 'あき';
        click(doc, 'rtJoinBtn');
        await waitFor(win, () => activeScreen(doc) === 'scr-rt-sugo-result', 8000,
          '入り直しで結果発表へ（現在: ' + activeScreen(doc) + '）');
        assert(doc.getElementById('rtSugoRsWin').textContent.trim(),
          '入り直した端末にも、勝者が出ている');
        assert(doc.querySelectorAll('#rtSugoRsRank .rk-row').length > 0,
          '入り直した端末にも、順位が出ている');
      } finally { win.close(); }
    });

    await r.test('52-3：大画面も、決着したら確定した順位を出す', async () => {
      // 離れた席から見ている人に「誰が勝ったか」が一覧から分からないのは、
      // 大画面の役目を果たしていない。端末と同じものを出す
      const g = await 決着まで('sugotoll', 3, true);
      try {
        const 文 = doc手(g).textContent;
        g.result.players.forEach((p) => assert(文.indexOf(p.name) >= 0,
          '大画面に「' + p.name + '」が出ている'));
        assert(/1位/.test(文), '大画面に順位が出ている（進行中の「あと◯マス」のままにしない）');
        assert(文.indexOf('さんの番') === -1, '大画面に「さんの番」が残っていない');
      } finally { g.win.close(); }
      function doc手(x){ return x.doc.querySelector('.screen.active'); }
    });

    await r.test('52-3：1位が同着なら、勝者を全員出す', async () => {
      /**
       * **この検査が無いと、勝者の欄は素通りする。**
       * 変異「1位を1人しか出さない」（`slice(0,1)`）を入れても、
       * 進行役を普通に回して出た5ゲームには**1位同着が一度も現れない**ので、
       * `勝ち.forEach` が1人ぶんしか回らず、主張が自明に成立していた（落とし穴10-b）。
       *
       * 同着はサーバーが `tied:true` で表す実在の形（`rankPlayers`）。
       * **その形の知らせを流して、描き方を見る**——`tests/rt-screens.js` と同じやり方
       */
      const g = await 決着まで('sugotoll', 3);
      try {
        const 知らせ = g.snap();
        const res = 知らせ.state.data.result;
        // 1位を2人にする（同着）
        res.players[0].rank = 1; res.players[0].tied = true;
        res.players[1].rank = 1; res.players[1].tied = true;
        g.fake.fire('room:update', 知らせ);
        await sleep(g.win, 200);

        const 同着 = res.players.filter((p) => p.rank === 1);
        assertEqual(同着.length, 2, '1位が2人の状況を作れている');   // 型(b)
        const 名 = g.doc.getElementById('rtSugoRsWin').textContent;
        同着.forEach((p) => assert(名.indexOf(p.name) >= 0,
          '同着の「' + p.name + '」も勝者として出る（いまの文：' + 名.replace(/\s+/g, ' ') + '）'));
      } finally { g.win.close(); }
    });

    await r.test('52-3：「どこにいる？」は、決着ではじめて本当の場所を出す', async () => {
      // `sugoroku-room.js:820` は「決着してはじめて、実位置を明かす」と宣言している。
      // 盤の画面は申告しか描けないので、**明かす場所は結果発表しかない**。
      // 明かさないと、宣言だけが残って実装が伴わない（落とし穴33）
      const g = await 決着まで('sugohide', 3);
      try {
        const 一覧 = g.doc.getElementById('rtSugoRsRank').textContent;
        assert(g.result.players.some((p) => p.pos > 0),
          '実位置がサーバーから届いている');   // 型(b)
        assert(一覧.indexOf('まだ申告なし') === -1,
          '決着後に「まだ申告なし」が残っていない（明かすと宣言した以上、明かす）');
        const あがり = g.result.players.filter((p) => p.goaled);
        if (あがり.length) assert(一覧.indexOf('あがり') >= 0, 'あがった人が分かる');
      } finally { g.win.close(); }
    });
  }

  // ===================== 52-4 ミニゲームの開始様式 =====================
  //
  // 指示52 52-4：画面が切り替わる → ルール説明のポップアップ →
  // **全員が「準備OK」を押すまで誰も操作できない** → 3-2-1 → 専用画面。
  //
  // サーバー側の門は指示37の流用（新しい通信は0本）。
  // ここは**端末側**——盤が消えるか、押せるものが出るか、
  // 数えている間に押せてしまわないか。
  //
  // 本人の裁定（2026-09-15）：**(a) 毎回きちんと挟む**。
  // 「今回は要る／要らない」の基準が見えないと、かえって混乱するため。

  {
    const { RT_START_MIN_CONFIG } = require('./inventory');
    const { GAME_DRIVERS } = require('../realtime');
    const SugorokuMini = require('../public/js/sugoroku-mini');
    const NAMES = ['あき', 'びび', 'ちか'];

    /** 本物の sugograb を MINI まで進めて、本物の画面に流す */
    async function ミニまで(big) {
      const entry = GAME_DRIVERS['sugograb'];
      const d = entry.driver;
      const { win, doc, errors } = await launch({ fakeSocket: true });
      await waitScreen(win, doc, 'scr-shelf', 9000);
      await openCassette(win, doc, 'sugoroku');
      const way = doc.querySelector('#wayChoices [data-way="room"]');
      if (way) way.click();
      await waitScreen(win, doc, 'scr-rt-lobby', 5000);
      const fake = win.__rtFake;
      await waitFor(win, () => fake.connected, 5000, '疑似socket');

      const members = new Map();
      for (let i = 0; i < 3; i++) {
        const id = 'm' + (i + 1);
        members.set(id, { id, name: NAMES[i], role: 'player', connected: true, socketId: 's' + id });
      }
      if (big) members.set('tv', { id: 'tv', name: 'テレビ', role: 'bigscreen', connected: true });
      const room = { code: 'ABC234', members, state: { phase: 'lobby', game: null, data: {} } };
      assertEqual(d.startGame(room, RT_START_MIN_CONFIG.sugograb, { notify() {} }).ok, true, '始められる');
      room.state.game = 'sugograb'; room.state.phase = 'playing';
      const w = room[entry.key];
      const 自分 = big ? 'tv' : 'm1';

      const snap = () => ({
        code: 'ABC234', ownerUserId: 1, ownerUsername: 'kuma', hostMemberId: 'm1',
        playerCount: 3, memberCount: members.size,
        ready: { count: 3, total: 3, waitingNames: [], all: true },
        members: Array.from(room.members.values()).map((m) => ({
          id: m.id, name: m.name, role: m.role, connected: true,
          isHost: m.id === 'm1', ready: true })),
        state: { phase: room.state.phase, game: 'sugograb', data: d.publicView(room) },
      });
      fake.replies = { 'room:join': () => ({ ok: true, code: 'ABC234', memberId: 自分, room: snap() }) };
      el(doc, 'rtJoinCode').value = 'ABC234';
      el(doc, 'rtJoinName').value = big ? 'テレビ' : NAMES[0];
      click(doc, 'rtJoinBtn');
      const 前置き = 'scr-' + 'rt-';
      await waitFor(win, () => String(activeScreen(doc)).indexOf(前置き) === 0, 8000, '部屋の画面へ');

      const push = async () => {
        fake.fire('room:update', snap());
        if (d.privateFor) { const mine = d.privateFor(room, 自分); if (mine) fake.fire('wolf:you', mine); }
        await sleep(win, 90);
      };
      await push();
      // READY を全員で抜けて MINI へ（**本物の門を通す**）
      ['m1', 'm2', 'm3'].forEach((id) => d.submitAction(room, id, null, { act: 'ready' }));
      d.advance(room);
      await push();
      assertEqual(w.phase, 'mini', 'ミニゲームの段階に来ている');   // 型(b)
      return { win, doc, errors, room, w, d, push, snap, fake };
    }

    await r.test('52-4：ミニゲームの間は盤が消え、準備OKを押すまで操作できない', async () => {
      const g = await ミニまで(false);
      try {
        // (1) 画面が切り替わる＝盤が消える
        assertEqual(g.doc.getElementById('rtSugoBoard').hidden, true,
          'ミニゲームの間、盤は出ていない（指示52 52-4 の(1)）');

        // **誰の番でもない段階で「さんの番」を出さない**（52-2 と同じ型）
        assertEqual((g.doc.getElementById('rtSugoTurn').textContent || '').trim(), '',
          'ミニゲーム中に「◯◯ さんの番」が残っていない');

        // (3) 準備OKが出ていて、ミニゲームの入力は出ていない
        const 入力 = g.doc.getElementById('rtSugoInput');
        assert(入力.querySelector('[data-rtsugo="ready"]'), '「じゅんびOK」が出ている');
        assertEqual(入力.querySelectorAll('[data-sugopick]').length, 0,
          '押すまでミニゲームの入力は出ない');

        // (2) ルール説明のポップアップが、1回だけ開いている
        const 幕 = g.doc.querySelector('#uiLayerRoot .ui-popup-in');
        assert(幕, 'ルール説明のポップアップが開いている');
        const 文 = 幕.textContent;
        assert(文.indexOf(g.w.mini.title) >= 0, 'ミニゲームの名前が出ている');
        assert(文.indexOf(g.w.mini.lead) >= 0, '遊び方（lead）が出ている');
        if (g.w.mini.note) assert(文.indexOf(g.w.mini.note) >= 0,
          '勝ち方（note）も同時に出ている（それまで同時に出る瞬間が無かった）');
        assert(/おす|えらぶ/.test(文), '操作方法が出ている（いまの文：' + 文.replace(/\s+/g, ' ').slice(0, 90) + '）');
      } finally { g.win.close(); }
    });

    await r.test('52-4：押した人には、あと何人かが出る', async () => {
      const g = await ミニまで(false);
      try {
        // 自分（m1）が押す＝本物の道（rtSugoSend → fake → submitAction）を通したいが、
        // 疑似socketは返事だけなので、**進行役に直接届けてから**知らせを流す
        g.d.submitAction(g.room, 'm1', null, { act: 'ready' });
        await g.push();
        const 文 = g.doc.getElementById('rtSugoInput').textContent;
        assert(文.indexOf('待') >= 0, '待っていることが出る（いま：' + 文 + '）');
        assert(/1\/3|2\/3/.test(文), 'あと何人かが数で出る（いま：' + 文 + '）');
        assert(!g.doc.querySelector('#rtSugoInput [data-rtsugo="ready"]'),
          '押したあとは「じゅんびOK」が消える');
      } finally { g.win.close(); }
    });

    await r.test('52-4：3つ数えている間は、まだ出せない（フライングを作らない）', async () => {
      const g = await ミニまで(false);
      try {
        ['m1', 'm2', 'm3'].forEach((id) => g.d.submitAction(g.room, id, null, { act: 'ready' }));
        g.d.advance(g.room);
        await g.push();
        assertEqual(g.w.phase, 'play', '全員そろったら本体へ');
        assert(g.w.playStartedAt > Date.now(), 'まだ数えている最中');   // 型(b)

        const 入力 = g.doc.getElementById('rtSugoInput');
        assertEqual(入力.querySelectorAll('button').length, 0,
          '数えている間は、押せるものが1つも無い');
        assert((入力.textContent || '').indexOf('始まります') >= 0,
          'もうすぐ始まる、と出ている（いま：' + 入力.textContent + '）');

        /**
         * **サーバーも弾く**（押せる端末が1つでもあると順位が壊れるので、権威はサーバー）。
         *
         * 検体は**そのミニゲームに合った形**にする。最初は `{count:30}`（れんだの形）を
         * 固定で送っていたが、ミニゲームは毎回ちがうので `readEntry` が
         * **`bad_action` で先に弾いていた**——門が効いていなくても同じ「ok:false」に見える
         *（落とし穴10-b：条件が作れていない）。変異 52-4B が素通りして分かった
         */
        const 中身 = { tap:{count:30}, janken:{hand:SugorokuMini.HANDS[0]},
                       fingers:{fingers:3}, quiz:{choice:0} }[g.w.mini.id];
        assert(中身, 'そのミニゲームに合った出し方が作れている（' + g.w.mini.id + '）');
        const 早出し = g.d.submitAction(g.room, 'm1', null, 中身);
        assertEqual(早出し.ok, false, '数えている間は、サーバーが受け取らない');
        assertEqual(早出し.error, 'not_started', '理由が分かる');

        // 数え終わったら出せる
        g.w.playStartedAt = Date.now() - 1;
        await g.push();
        assert(g.doc.getElementById('rtSugoInput').querySelectorAll('button').length > 0,
          '数え終わったら、ミニゲームの入力が出る');
      } finally { g.win.close(); }
    });

    await r.test('52-4：全員がそろうまで、進んでよいと言わない（門そのもの）', async () => {
      /**
       * **ここが (3) の芯。**`realtime.js:1328` は `submitAction` の返す
       * `allDone` を見て `advance` を呼ぶ——つまり **`allDone` が門**。
       *
       * それまでの検査は画面の文字しか見ておらず、`waitingPhases` から
       * MINI を外す変異（52-4A）が**素通りした**。画面の「◯/◯」は
       * `waitingIds` だけで出るので、門が外れても見た目は変わらない。
       */
      const g = await ミニまで(false);
      try {
        const r1 = g.d.submitAction(g.room, 'm1', null, { act: 'ready' });
        assertEqual(r1.allDone, false, '1人では、まだ進んでよいと言わない');
        const r2 = g.d.submitAction(g.room, 'm2', null, { act: 'ready' });
        assertEqual(r2.allDone, false, '2人でも、まだ');
        const r3 = g.d.submitAction(g.room, 'm3', null, { act: 'ready' });
        assertEqual(r3.allDone, true, '全員そろって、はじめて進んでよいと言う');

        // **押していないのに進まない**ことも、段階で確かめる
        const g2 = await ミニまで(false);
        try {
          g2.d.submitAction(g2.room, 'm1', null, { act: 'ready' });
          assertEqual(g2.w.phase, 'mini', '1人押しただけでは、まだミニゲームの題のまま');
        } finally { g2.win.close(); }
      } finally { g.win.close(); }
    });

    await r.test('52-4：大画面には準備OKを出さない（見世物の画面）', async () => {
      const g = await ミニまで(true);
      try {
        assertEqual(activeScreen(g.doc), 'scr-rt-big', '大画面として入っている');  // 型(b)
        assert(!g.doc.querySelector('#scr-rt-big [data-rtsugo="ready"]'),
          '大画面に「じゅんびOK」は出ない');
        assert(!g.doc.querySelector('#uiLayerRoot .ui-popup-in'),
          '大画面にルール説明のポップアップは開かない（押す人がいない）');

        // **出さないのは押しもの。待っていることは出す**——
        // 離れた席から「誰を待っているのか」が分からないと、全員が止まって見える
        const main = g.doc.getElementById('bigMain').textContent;
        const sub = g.doc.getElementById('bigSub').textContent;
        assertEqual(main, g.w.mini.title,
          '大画面には、何のミニゲームかが大きく出る（「◯◯ さんの番」ではなく）');
        assert(main.indexOf('さんの番') === -1,
          '大画面に「さんの番」が残っていない（端末の上帯と同じ穴）');
        assert(sub.indexOf('待っています') >= 0, '誰を待っているかが出る（いま：' + sub + '）');
        assert(/0\/3|1\/3|2\/3/.test(sub), 'あと何人かが数でも出る（いま：' + sub + '）');

        // 1人押したら、待ちが減る
        g.d.submitAction(g.room, 'm1', null, { act: 'ready' });
        await g.push();
        const sub2 = g.doc.getElementById('bigSub').textContent;
        assert(/1\/3/.test(sub2), '押した人数が大画面にも反映される（いま：' + sub2 + '）');
      } finally { g.win.close(); }
    });
  }

  r.finish();
})();
