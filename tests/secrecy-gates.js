// tests/secrecy-gates.js — 手渡しゲートの秘匿検証（第35弾C）
//
// 「スマホを渡す瞬間に、見えてはいけない情報が映らない」を恒久テストにする。
// フェーズBでは実機の可視テキストで確認したが、テストが無ければ将来の変更で静かに壊れる。
// 見るもの：
//   ・ゲート（「タップして見る」の前）で、秘密コンテナが display:none であること
//   ・ゲートの可視テキストに、直後に開かれる秘密（お題・役職）が含まれないこと
//   ・次の人のゲートに、前の人の秘密が残らないこと
// 対象：ワードウルフの配り（scr-wolf-pass）・人狼の夜配り（scr-wr-pass）・
//       あれそれの出題者交代（scr-topic-pass）。
// オークションの手渡し（scr-auction-handoff）はhidden旧モード専用で到達不可のため対象外
// （docs/監査_画面一覧.md参照）。

const H = require('./harness');
const { launch, activeScreen, sleep, passPlayWay, waitScreen, el, click, fillPlayerForm, pickGame,
  createRunner, assert, assertEqual, assertNoErrors, autoDialog } = H;

const NAMES = ['あき', 'びび', 'ちか', 'でん'];

// 表示されている文字だけを集める。インラインの display:none（JSの切替もここに出る）で
// 隠れている枝はまるごと読まない。ゲートの隠しはすべてインラインstyleの切替なので、これで足りる
function visibleText(node) {
  if (node.nodeType === 3) return node.textContent;
  if (node.nodeType !== 1) return '';
  if (node.style && node.style.display === 'none') return '';
  let out = '';
  for (const c of node.childNodes) out += visibleText(c);
  return out;
}

// 棚 → カセット → ゲーム → プレイヤー設定 → モード選択（playthroughと同じ最小運転）
async function toModeScreen(win, doc, cassette, gameId, players) {
  const cart = doc.querySelector('.cart[data-cart="' + cassette + '"]');
  assert(cart, cassette + ' のカセットが棚にある');
  cart.click();
  if (activeScreen(doc) === 'scr-shelf') cart.click();
  await sleep(win, 100);
  // 第41弾：カセットをえらぶと遊び方の確認が挟まる。
  // sleep では通り抜け処理が走らない（waitFor の中でしか動かない）ので明示的に通す
  passPlayWay(doc);
  await sleep(win, 80);
  if (activeScreen(doc) === 'scr-game') {
    pickGame(doc, gameId);
    await sleep(win, 80);
  }
  if (activeScreen(doc) === 'scr-setup') await fillPlayerForm(win, doc, players);
  await waitScreen(win, doc, 'scr-mode', 4000);
}

async function startMode(win, doc, modeId) {
  const card = doc.querySelector('.mode-card[data-id="' + modeId + '"]');
  assert(card, modeId + ' のカードがある');
  click(doc, card);
  click(doc, 'modeNextBtn');
  await sleep(win, 80);
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
}

async function toScreenAfterCountdown(win, doc, screenId) {
  await waitScreen(win, doc, screenId, 8000);
}

async function run() {
  const r = createRunner('secrecy-gates：手渡しゲートの秘匿');
  const LAUNCH = {};

  await r.test('可視テキスト検出器そのものが、隠れた文字を拾わない（自己赤チェック）', async () => {
    const { win, doc } = await launch(LAUNCH);
    const d = doc.createElement('div');
    d.innerHTML = '<span>おもて</span><span id="sx" style="display:none;">ひみつ42</span>';
    doc.body.appendChild(d);
    assert(visibleText(d).indexOf('ひみつ42') === -1, '隠れている文字は読まない');
    d.querySelector('#sx').style.display = '';
    assert(visibleText(d).indexOf('ひみつ42') !== -1, '表示に切り替われば読む（検出器が機能している）');
    win.close();
  });

  await r.test('ワードウルフの配り：ゲートでお題が見えず、次の人に前の人のお題が残らない', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    await toModeScreen(win, doc, 'jinro', 'wordwolf', NAMES.slice(0, 3));
    await startMode(win, doc, 'wordwolf');
    await toScreenAfterCountdown(win, doc, 'scr-wolf-pass');

    // 1人目のゲート：秘密コンテナは閉じている
    assertEqual(el(doc, 'wolfContentScreen').style.display, 'none', '1人目のゲートで中身が閉じている');
    const gate1 = visibleText(el(doc, 'scr-wolf-pass'));
    click(doc, 'wolfRevealBtn');
    await sleep(win, 60);
    const topic1 = el(doc, 'wolfTopicText').textContent.trim();
    assert(topic1.length > 0, 'お題が開かれた（' + topic1 + '）');
    assert(gate1.indexOf(topic1) === -1, '開く前のゲートにお題「' + topic1 + '」が出ていない');

    // 次の人へ → ゲートが閉じ直り、前の人のお題が可視テキストに無い
    click(doc, 'wolfNextRevealBtn');
    await sleep(win, 60);
    assertEqual(activeScreen(doc), 'scr-wolf-pass', '2人目の手渡しに戻る');
    assertEqual(el(doc, 'wolfContentScreen').style.display, 'none', '2人目のゲートで中身が閉じ直る');
    const gate2 = visibleText(el(doc, 'scr-wolf-pass'));
    assert(gate2.indexOf(topic1) === -1, '2人目のゲートに1人目のお題が残っていない');
    // 第35弾C（レビュー決定）：防御はDOMレイヤーでも揃える。
    // 非表示のまま前の人の秘密が残っていると、将来の画面変更（コピー機能など）で露出の芽になる
    assert(el(doc, 'wolfTopicText').textContent.indexOf(topic1) === -1,
      '2人目のゲートではDOMからも1人目のお題が消えている');
    assertEqual(el(doc, 'wolfRoleBox').innerHTML, '', '役職欄もDOMから空');
    assertEqual(el(doc, 'wolfVoteInfo').innerHTML, '', '能力情報の欄もDOMから空');
    assertNoErrors(errors, '配りゲートで未捕捉の例外');
    win.close();
  });

  await r.test('人狼の役職配り：ゲートで役職が見えず、次の人に前の人の役職が残らない', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    await toModeScreen(win, doc, 'jinro', 'wolfrole', NAMES.slice(0, 4));
    await startMode(win, doc, 'wolf-casual');
    await toScreenAfterCountdown(win, doc, 'scr-wr-pass');

    assertEqual(el(doc, 'wrContent').style.display, 'none', '1人目のゲートで中身が閉じている');
    const gate1 = visibleText(el(doc, 'scr-wr-pass'));
    ['人狼', '占い師', '村人'].forEach((w) => {
      assert(gate1.indexOf(w) === -1, 'ゲートに役職語「' + w + '」が出ていない');
    });
    click(doc, 'wrRevealBtn');
    await sleep(win, 60);
    const body1 = el(doc, 'wrContentBody').textContent;
    assert(body1.length > 0, '役職が開かれた');
    // 確認して次の人へ（役職配りは choices が無い＝確認ボタンで進む）
    click(doc, 'wrNextBtn');
    await sleep(win, 60);
    assertEqual(activeScreen(doc), 'scr-wr-pass', '2人目の手渡しに戻る');
    assertEqual(el(doc, 'wrContent').style.display, 'none', '2人目のゲートで中身が閉じ直る');
    const gate2 = visibleText(el(doc, 'scr-wr-pass'));
    ['人狼', '占い師', '村人'].forEach((w) => {
      assert(gate2.indexOf(w) === -1, '2人目のゲートに役職語「' + w + '」が残っていない');
    });
    // 第35弾C（レビュー決定）：非表示のまま残さず、DOMからも消す
    assertEqual(el(doc, 'wrContentBody').innerHTML, '', '2人目のゲートでは役職の中身がDOMから空');
    assertNoErrors(errors, '役職配りゲートで未捕捉の例外');
    win.close();
  });

  await r.test('あれそれの出題者交代：渡し画面にお題が見えない', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    win.alert = () => {};
    autoDialog(win, doc);
    await toModeScreen(win, doc, 'aresoredorekore', 'aresoredorekore', NAMES.slice(0, 2));
    await startMode(win, doc, 'normal');
    await toScreenAfterCountdown(win, doc, 'scr-play');
    // 出題者交代の画面に来るまで正解で回す（1問目→ピッカー→つぎへ）
    for (let i = 0; i < 12 && activeScreen(doc) !== 'scr-topic-pass'; i++) {
      const cur = activeScreen(doc);
      if (cur === 'scr-play') {
        click(doc, 'btnCorrect');
      } else if (el(doc, 'correctPickerOverlay').classList.contains('show')) {
        const b = doc.querySelector('#pickerGrid button');
        if (b) b.click();
      } else if (cur === 'scr-reveal') {
        click(doc, 'revealNextBtn');
      } else if (cur === 'scr-next') {
        const b = doc.querySelector('#nextChoices button');
        if (b) b.click();
      }
      await sleep(win, 80);
    }
    if (activeScreen(doc) === 'scr-topic-pass') {
      const passText = visibleText(el(doc, 'scr-topic-pass'));
      click(doc, 'topicPassBtn');
      await waitScreen(win, doc, 'scr-play', 4000);
      const topic = el(doc, 'topicName').textContent.trim();
      assert(topic.length > 0, '新しいお題が出た');
      assert(passText.indexOf(topic) === -1, '渡し画面に次のお題「' + topic + '」が出ていなかった');
    } else {
      // 2人構成では交代画面を挟まない設定もあり得る。その場合はこの回は対象なし
      assert(true, '出題者交代の画面を通らない構成だった（対象なし）');
    }
    assertNoErrors(errors, '出題者交代で未捕捉の例外');
    win.close();
  });

  await r.test('47-7：あれそれのお題・封印語は、部屋の知らせに1文字も載らない（逆向きの見張り）', async () => {
    // **これは「いま壊れていないこと」ではなく、「将来壊れた日に赤くなること」のための見張り。**
    //
    // 指示47-7 は「あれそれを大画面に対応させる」だったが、**着手前に止めた**——
    // あれそれは手渡し専用（RT_GAME_SCREENS にも GAME_DRIVERS にも無い）で、
    // 部屋にいる人が始めようとすると `playWayPlan` が「部屋を閉じて はじめる」を返す。
    // つまり「1台の手渡し＋大画面」という前提の形に、いまは到達できない。
    // 先に要るのは `docs/切り出した宿題.md` の1番（手渡しと部屋の並走を安全にする）で、
    // 本人の裁定（2026-09-07）は「順番を逆にしない」。
    //
    // **その日が来た時に、お題が大画面へ漏れたら赤くする。**
    // 照合には向きがある（落とし穴20）——「いま漏れていない」を見るだけでは、
    // 部屋対応にした日に静かに漏れる。
    const fs = require('fs');
    const path = require('path');
    const ROOT = path.join(__dirname, '..');
    const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

    // ① いまは「部屋のゲーム」ではない。**この前提が崩れた日に、下の②が意味を持つ**
    const rtMap = html.slice(html.indexOf('var RT_GAME_SCREENS'), html.indexOf('var RT_GAME_SCREENS') + 900);
    const 部屋対応 = /aresoredorekore\s*:/.test(rtMap);
    const drivers = fs.readFileSync(path.join(ROOT, 'realtime.js'), 'utf8');
    const 進行役あり = /aresoredorekore\s*:\s*\{/.test(drivers.slice(drivers.indexOf('GAME_DRIVERS'),
      drivers.indexOf('GAME_DRIVERS') + 1400));
    assertEqual(部屋対応, 進行役あり,
      '部屋の画面と進行役は、そろって在るかそろって無いか（片方だけだと、行き先の無い部屋ができる）');

    // ② **お題と封印語を部屋へ配る経路が、1つも無い。**
    //    サーバー側（部屋の知らせを作る所）に、お題の語が現れないことを見る
    const 部屋を作る側 = ['realtime.js', 'wolf-room.js', 'wordwolf-room.js', 'bomb-room.js',
      'defuse-room.js', 'quiz-room.js', 'auction-room.js', 'sugoroku-room.js']
      .map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join(' ');
    const 漏れ語 = ['topicPool', 'aresoreTopic', 'sealedWord', '封印語'];
    const 見つかった = 漏れ語.filter((w) => 部屋を作る側.indexOf(w) >= 0);
    assertEqual(見つかった.join('・'), '',
      'あれそれのお題・封印語を、部屋の知らせを作る側が触っていない');

    // ③ 自己赤チェック：この検査が本当に効くか（落とし穴10）。
    //    わざと混ぜた文字列を、同じ探し方で拾えることを確かめる
    const 偽物 = '部屋の知らせ topicPool を配る';
    assert(漏れ語.some((w) => 偽物.indexOf(w) >= 0),
      '探し方そのものは効いている（混ぜれば見つかる）');
  });

  r.finish();
}

if (require.main === module) run();
module.exports = { run };
