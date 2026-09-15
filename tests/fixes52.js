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
  launch, activeScreen, sleep, waitScreen, el, click, openCassette, autoDialog } = require('./harness');

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

  r.finish();
})();
