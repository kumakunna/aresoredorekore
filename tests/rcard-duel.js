// tests/rcard-duel.js — いっきうちで、えらんだ爆弾の数がそのまま効くか（2026-09-21）
//
// ## なぜ専用に1本置いたか
//
// 本人の実機報告：**「いっきうちモードが、数を指定しても5になる」**。
//
// 真因は `rcard-logic.js` の `bombsForMatch` が「生存者2人以下なら決勝の数」
// だけを見ていたこと。いっきうちは**常に2人**なので必ず決勝あつかいになり、
// 設定画面の「しかける爆弾の数」を何に変えても `finalBombs`（既定5）が使われていた
// ——**設定は出るのに、何も起きない**（落とし穴21）。
//
// 直したうえで掃いたら、**手渡し側の呼び出しを見ている検査が1件も無かった**
// （`grep rcHand|bombsPerBoard|initRcardRound tests/` は rcard-room 以外 0件）。
// 部屋側は `tests/rcard-room.js` が見ているが、**手渡しは誰も見ていない**——
// つまり手渡しの呼び出しから開始人数を落としても、変異が素通りする。
// **報告された当のモードが、いちばん見張られていなかった**（落とし穴1）。
//
// だから**本物の画面を歩いて、置く画面に出る数を読む**。
// 「◯◯の9まいから、Nつえらんでください」の N が、えらんだ数と一致すること。
// ルール層だけを見る検査（tests/rcard-logic.js）とは別の向きの照合になる。

const H = require('./harness');
const { launch, activeScreen, sleep, passPlayWay, waitScreen, el, click,
  fillPlayerForm, pickGame, createRunner, assert, assertEqual } = H;

const NAMES = ['あき', 'びび'];

/** 棚 → カセット → ゲーム → プレイヤー設定 → モード選択（secrecy-gates と同じ最小運転） */
async function toModeScreen(win, doc) {
  const cart = doc.querySelector('.cart[data-cart="rcard"]');
  assert(cart, 'ロシアンカードのカセットが棚にある');
  cart.click();
  if (activeScreen(doc) === 'scr-shelf') cart.click();
  await sleep(win, 100);
  passPlayWay(doc);
  await sleep(win, 80);
  if (activeScreen(doc) === 'scr-game') { pickGame(doc, 'rcard'); await sleep(win, 80); }
  if (activeScreen(doc) === 'scr-setup') await fillPlayerForm(win, doc, NAMES);
  await waitScreen(win, doc, 'scr-mode', 4000);
}

/**
 * いっきうちを選び、**設定画面で爆弾の数をえらんでから**始める。
 * secrecy-gates の `startMode` は既定のまま通り抜けるので、ここは自前で持つ
 */
async function 爆弾の数をえらんで始める(win, doc, 数) {
  const card = doc.querySelector('.mode-card[data-id="rcard-duel"]');
  assert(card, 'いっきうちのカードがある');
  click(doc, card);
  click(doc, 'modeNextBtn');
  await waitScreen(win, doc, 'scr-set-rcard', 4000);

  const 札 = doc.querySelector('#rcBombsSeg [data-rcbombs="' + 数 + '"]');
  assert(札, 数 + 'つの札が設定画面にある');
  札.click();
  await sleep(win, 60);
  // **えらべたことを1つ測る**（落とし穴10-b：条件が作れていないまま先へ進まない）
  assert(札.classList.contains('on'), 数 + 'つが選ばれた印になっている');

  for (let i = 0; i < 10; i++) {
    const cur = activeScreen(doc);
    if (cur === 'scr-ready' || cur === 'scr-mode-rules') break;
    const next = doc.querySelector('#' + cur + ' [data-wiz-next]');
    if (!next) break;
    next.click();
    await sleep(win, 40);
  }
  if (activeScreen(doc) === 'scr-mode-rules') { click(doc, 'rulesStartBtn'); await sleep(win, 80); }
  await waitScreen(win, doc, 'scr-ready', 4000);
  el(doc, 'holdBtn').dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true }));
  await waitScreen(win, doc, 'scr-rc-pass', 8000);
}

/** 置く画面に出ている「Nつえらんでください」の N */
function 出ている数(doc) {
  const m = (el(doc, 'rcPassLead').textContent || '').match(/(\d+)つえらんで/);
  return m ? parseInt(m[1], 10) : null;
}

async function run() {
  const r = createRunner('rcard-duel：いっきうちの爆弾の数');

  // 2つ・4つ・5つ。**5つも入れる**——
  // 遊びの側で5つに固定するのをやめた代わりに、設定でえらべる道を作ったので、
  // その道が本当に通っていることまで見る（片側だけ試さない・落とし穴10-c）
  for (const 数 of [2, 4, 5]) {
    await r.test('手渡しのいっきうち：' + 数 + 'つをえらんだら、' + 数 + 'つしかける', async () => {
      const { win, doc } = await launch({});
      try {
        await toModeScreen(win, doc);
        await 爆弾の数をえらんで始める(win, doc, 数);

        click(doc, 'rcPassRevealBtn');
        await sleep(win, 80);
        // 型(b)：**盤が本当に開いたか**を先に測る（0枚なら以下は自明に成立する）
        assertEqual(doc.querySelectorAll('#rcPassBoard [data-rc-cell]').length, 9,
          '9まいの盤が開いた');

        assertEqual(出ている数(doc), 数,
          '置く画面が「' + 数 + 'つ」と言っていない（' + el(doc, 'rcPassLead').textContent + '）');

        // **言葉だけでなく、実際に受け付ける数も見る。**
        // 文言が正しくても、しかけ終わりの判定が別の数を見ていたら遊べない。
        //
        // **札は毎回引き直す。**押すたびに `renderRcPass()` が盤を innerHTML ごと
        // 作り直すので、配列に取っておくと2枚目以降は「もう居ない札」を押すことになる
        //（良い型2：毎描画の自己リセット。tutorial.js で同じ形を踏んだ）
        for (let i = 0; i < 数; i++) {
          const 札 = doc.querySelectorAll('#rcPassBoard [data-rc-cell]');
          札[i].click();
          await sleep(win, 30);
        }
        assertEqual(el(doc, 'rcPassDoneBtn').disabled, false,
          数 + 'つえらんだら「しかけて、伏せる」が押せる');
      } finally { win.close(); }
    });
  }

  await r.test('設定画面の注記が、いっきうちでは「増えない」と言う', async () => {
    const { win, doc } = await launch({});
    try {
      await toModeScreen(win, doc);
      const card = doc.querySelector('.mode-card[data-id="rcard-duel"]');
      click(doc, card);
      click(doc, 'modeNextBtn');
      await waitScreen(win, doc, 'scr-set-rcard', 4000);
      const 注記 = el(doc, 'rcFinalNote').textContent || '';
      // **嘘を言わないこと**が門（落とし穴33）。
      // 以前はどのモードでも「2人であそぶときは、最初から5つです」と出していて、
      // それは設定が無視されていたから本当だった
      assert(注記.indexOf('増えることはありません') !== -1,
        'いっきうちなのに「増える」と言っている（' + 注記 + '）');
      assert(注記.indexOf('最初から 5つ') === -1 && 注記.indexOf('最初から5つ') === -1,
        '古い「最初から5つ」が残っている（' + 注記 + '）');
    } finally { win.close(); }
  });

  r.finish();
}

run();
