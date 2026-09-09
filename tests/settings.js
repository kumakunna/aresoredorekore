// tests/settings.js — 設定画面（第43弾）
//
// 指示43の門のうち、機械で見られるものをここに集める。
//   ・F9  行がすべてデータから描かれている（`setRowHtml` 以外の行が0）
//   ・2-1 題名と説明が別の行／並んだ行の高さが揃う／押した反応が共通部品と同じ
//   ・2-2 入口の先頭は文脈で変わる／棚では入口を飛ばす
//   ・F7  「音を消す」で3つの音量が0になり、戻すと元の値（**保存値は壊さない**）
//   ・2-3 「アイコン・二つ名」は未ログインでも開ける
//   ・F5  15個の設定が「切り替えた瞬間に効く」
//
// 部屋がある文脈（進行役・ゲスト・大画面）の先頭3つは、
// 疑似socketを持っている tests/rt-screens.js の側で見る。

const H = require('./harness');
const { launch, activeScreen, sleep, waitScreen, el, click, passPlayWay, pickGame,
  fillPlayerForm, setupPlayers, createRunner, assert, assertEqual, assertNoErrors,
  autoDialog, cssRules } = H;

const fs = require('fs');
const path = require('path');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

/**
 * `#settingsOverlay` の markup を、**入れ子を数えて**切り出す（門F9）。
 * 「開いた所から適当な目印まで」で切ると、目印を動かした日に範囲が変わり、
 * 検査が静かに緩む（落とし穴10-a の親戚）
 */
function overlayMarkup(html) {
  const 印 = html.indexOf('id="settingsOverlay"');
  assert(印 > 0, '設定の重なりが実在する');
  const 開き = html.lastIndexOf('<div', 印);
  const re = /<(\/?)div\b/g;
  re.lastIndex = 開き;
  let 深さ = 0, m;
  while ((m = re.exec(html))) {
    深さ += m[1] ? -1 : 1;
    if (深さ === 0) return html.slice(開き, re.lastIndex);
  }
  throw new Error('設定の重なりの閉じタグが見つからない');
}

// ---- 設定を開く道具 ----

// 棚から。棚では入口（root）を飛ばして「アプリの設定」が直接開く（2-2）
async function openFromShelf(win, doc) {
  click(doc, 'shelfGearBtn');
  await sleep(win, 120);
}

// 手渡しでゲームを始めてから開く
async function toHandoffPlay(win, doc) {
  // 準備の途中に出る案内は自動で通す。**遊びはじめたら止める**——
  // 止め忘れると、このあと出す確認まで勝手に「はい」を押してしまい、
  // 「確認を挟んでいるか」の検査が自明に通る（落とし穴10-b）
  const 止める = autoDialog(win, doc);
  await setupPlayers(win, doc);
  await waitScreen(win, doc, 'scr-mode', 4000);
  click(doc, 'modeAutoBtn');
  await sleep(win, 80);
  if (activeScreen(doc) === 'scr-mode-rules') { click(doc, 'rulesStartBtn'); await sleep(win, 60); }
  await waitScreen(win, doc, 'scr-ready', 4000);
  el(doc, 'holdBtn').dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true }));
  await waitScreen(win, doc, 'scr-play', 9000);
  return 止める;
}
async function openDuringPlay(win, doc, opts) {
  const 止める = await toHandoffPlay(win, doc);
  if (opts && opts.手で答える) 止める();
  click(doc, 'floatingGearBtn');
  await sleep(win, 120);
}

// いま開いているページ
function openPage(doc) {
  return Array.from(doc.querySelectorAll('#settingsOverlay .set-page'))
    .find((p) => p.style.display === 'block');
}
function pageName(doc) {
  const p = openPage(doc);
  return p ? p.dataset.page : null;
}
// 開いているページの行（見えているものだけ）
function shownRows(doc) {
  const p = openPage(doc);
  assert(p, '設定のページが1つ開いている');
  return Array.from(p.querySelectorAll('.set-row'));
}
function labelOf(b) {
  return b.querySelector('.sr-text').childNodes[0].textContent.trim();
}

/**
 * 人狼の夜（**手渡しでBGMが鳴る唯一の画面**）まで運ぶ。
 * 音そのものを鳴らして確かめるので、ここを通らないと門F5-3が書けない
 */
async function toWolfNight(win, doc, players) {
  const cart = doc.querySelector('.cart[data-cart="jinro"]');
  assert(cart, '人狼のカセットが棚にある');
  cart.click();
  if (activeScreen(doc) === 'scr-shelf') cart.click();
  await sleep(win, 120);
  passPlayWay(doc);
  await sleep(win, 80);
  if (activeScreen(doc) === 'scr-game') { pickGame(doc, 'wolfrole'); await sleep(win, 80); }
  if (activeScreen(doc) === 'scr-setup') await fillPlayerForm(win, doc, players);
  await waitScreen(win, doc, 'scr-mode', 4000);
  click(doc, doc.querySelector('.mode-card[data-id="wolf-casual"]'));
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
  await waitScreen(win, doc, 'scr-wr-pass', 9000);
}

/**
 * 設定の中を、**人が押せる道だけ**歩いて回る（門F4・F9の材料）。
 * 行の一覧を手で持たない——持つと、ページが増えた日に静かに腐る（落とし穴4）
 */
async function walkSettings(win, doc, onPage) {
  const 訪ねた = [];
  async function 潜る(depth) {
    const here = pageName(doc);
    if (!here || 訪ねた.indexOf(here) >= 0 || depth > 4) return;
    訪ねた.push(here);
    await onPage(here, shownRows(doc));
    const 先 = shownRows(doc).map((b) => b.dataset.setpage).filter(Boolean);
    for (const p of 先) {
      if (訪ねた.indexOf(p) >= 0) continue;
      const row = shownRows(doc).find((b) => b.dataset.setpage === p);
      if (!row) continue;
      row.click();
      await sleep(win, 70);
      await 潜る(depth + 1);
      click(doc, 'setBackBtn');
      await sleep(win, 70);
    }
  }
  await 潜る(0);
  return 訪ねた;
}

(async function main() {
  const r = createRunner('settings：設定画面（第43弾）');

  // ================= 門F9：行はデータからしか描かない =================

  await r.test('門F9：設定の行は、1つ残らずデータから描かれる', async () => {
    // ── 行き：HTMLに直接書かれた行が0件 ──
    // 範囲は #settingsOverlay の中だけ。外にも .set-row を使っている所があると
    // まとめて数えてしまう（棚卸しで掃引が「静的38個」と誤報した型）
    const 範囲 = overlayMarkup(HTML);
    // 型(b)：切り出しが空でないこと。空なら下の「0件」は自明に通る
    assert(/id="setRootMenu"/.test(範囲) && /data-page="danger"/.test(範囲),
      '切り出した範囲に、設定の中身が入っている（' + 範囲.length + '文字）');
    const 静的 = (範囲.match(/class="set-row/g) || []);
    assertEqual(静的.length, 0, 'HTMLに直接書かれた行は0件（' + 静的.length + '件）');

    // ── 帰り：実際に開いた時、行はすべて .set-menu（setMenuHtml の包み）の中にいる ──
    const { win, doc, errors } = await launch();
    await openDuringPlay(win, doc);
    let 数えた = 0;
    const 訪ねた = await walkSettings(win, doc, async (page, rows) => {
      rows.forEach((b) => {
        assert(b.parentElement && b.parentElement.classList.contains('set-menu'),
          page + ' の行「' + labelOf(b) + '」が setMenuHtml を通っていない');
        数えた++;
      });
    });
    // 型(b)：数えるものが本当にあったか。0件なら上の主張は自明に通ってしまう
    assert(訪ねた.length >= 8, 'ページを実際に歩いた（' + 訪ねた.join('／') + '）');
    assert(数えた >= 15, '行を実際に数えた（' + 数えた + '行）');
    assertNoErrors(errors, '全ページを歩いて未捕捉の例外');
    win.close();
  });

  await r.test('門F9の検査が、実際に赤くなることを確かめる（落とし穴10）', async () => {
    const { win, doc } = await launch();
    await openDuringPlay(win, doc);
    // 幽霊のクラス名はその場で組み立てる。直接書くと、上の掃引が自分の検体を拾う
    //（落とし穴10-a・自己参照。42①で実際に踏んだ）
    const 名 = ['set', 'row'].join('-');
    const box = openPage(doc);
    const b = doc.createElement('button');
    b.className = 名;
    box.appendChild(b);
    const 外れ = Array.from(box.querySelectorAll('.' + 名))
      .filter((x) => !(x.parentElement && x.parentElement.classList.contains('set-menu')));
    assertEqual(外れ.length, 1, '包みの外に行を足すと、検査が見つける');
    b.remove();
    win.close();
  });

  // ================= 2-1：行の見た目 =================

  await r.test('2-1：題名と説明が別の行になり、並んだ行の高さが揃う', async () => {
    // cssRules の選択子には、直前の注釈まで入ってくる。末尾で照合する
    const rules = cssRules(HTML);
    const sel = (name) => rules.find((x) => x.sel === name || x.sel.endsWith('\n  ' + name)
      || x.sel.endsWith(' ' + name) || x.sel.endsWith(name));
    const sub = sel('.set-row .sr-sub');
    assert(sub, '.sr-sub に規則がある');
    assert(/display\s*:\s*block/.test(sub.body),
      '説明はブロック（span のままだと margin が効かず、題名と同じ行に流れる）');

    const menu = sel('.set-menu');
    assert(menu, '.set-menu に規則がある');
    assert(/display\s*:\s*grid/.test(menu.body), '行の並びは grid');
    assert(/grid-auto-rows\s*:\s*1fr/.test(menu.body),
      '高さは 1fr で揃える（min-height だと、折り返した行だけ伸びる）');

    // 押した反応は、共通部品と同じ「縮む」形（正本 §4）
    const act = sel('.set-row:active');
    assert(act, '.set-row:active に規則がある');
    assert(/transform\s*:\s*scale/.test(act.body), '押すと縮む（.btn:active と同じ）');
    const btnAct = sel('.btn:active');
    assert(btnAct && /transform\s*:\s*scale/.test(btnAct.body), '共通部品の側も縮む形のまま');
  });

  await r.test('2-1：説明は、開いた時に必ず2行目にある（実際に描かれた行で見る）', async () => {
    const { win, doc } = await launch();
    await openDuringPlay(win, doc);
    const subs = shownRows(doc).map((b) => b.querySelector('.sr-sub')).filter(Boolean);
    assert(subs.length >= 3, '説明のある行が実際にある（' + subs.length + '件）');
    subs.forEach((s) => {
      assertEqual(win.getComputedStyle(s).display, 'block', '説明はブロックとして出ている');
    });
    win.close();
  });

  // ================= 2-2：入口は文脈で変わる =================

  await r.test('2-2：棚では入口を飛ばして「アプリの設定」が直接開く', async () => {
    const { win, doc, errors } = await launch();
    await openFromShelf(win, doc);
    assert(el(doc, 'settingsOverlay').classList.contains('show'), '設定が開く');
    assertEqual(el(doc, 'setTitle').textContent, 'アプリの設定', '入口を飛ばして中身が出る');
    assertEqual(el(doc, 'setBackBtn').style.display, 'none', 'ここが先頭なので、戻る矢印は出さない');
    // 棚には「いま遊んでいるゲーム」も「いま要るもの」も無い
    assertEqual(doc.querySelectorAll('#setQuickMenu .set-row').length, 0, '先頭の3つは出さない');
    // **危険な操作へ行く道が消えていないこと**（入口を飛ばした分、ここに現れる）
    assert(doc.querySelector('.set-page[data-page="app"] [data-setpage="danger"]'),
      '棚からでも「危険な操作」に行ける');
    assertNoErrors(errors, '棚から設定を開いて未捕捉の例外');
    win.close();
  });

  await r.test('2-2：手渡しのゲーム中は、先頭に「音を消す・ルール・ゲームを終了」が出る', async () => {
    const { win, doc, errors } = await launch();
    await openDuringPlay(win, doc);
    assertEqual(el(doc, 'setTitle').textContent, '設定', '遊んでいる時は入口が出る');
    const quick = Array.from(doc.querySelectorAll('#setQuickMenu .set-row'));
    assertEqual(quick.length, 3, '先頭は3つ（' + quick.map(labelOf).join('／') + '）');
    assertEqual(labelOf(quick[0]), 'すべての音を消す', '1つ目は音');
    assertEqual(labelOf(quick[1]), 'ルールをもう一度見る', '2つ目はルール');
    assertEqual(labelOf(quick[2]), 'ゲームを終了する', '3つ目は終了');
    // 先頭の3つは、その下の項目より前にいる（親指の届く所・2-9）
    const all = shownRows(doc);
    assertEqual(all.length, 3 + 3, '入口は 先頭3つ ＋ 4項目のうち「部屋」を除く3つ');
    assertEqual(all[0].dataset.setact, 'muteAll', '一番上は音を消す');
    // 新しい経路を作っていない：⏹ は「ゲームを終了する」と同じ動きを指す
    assertEqual(all[2].dataset.setact, 'endGame', '⏹ は既存のゲーム終了と同じ動き');
    // 棚では「アプリの設定」に出ていた危険な操作が、ここでは入口の側にいる（二重に出さない）
    assertEqual(all.filter((b) => b.dataset.setpage === 'danger').length, 1, '危険な操作は1つだけ');
    assertNoErrors(errors, '遊んでいる時に設定を開いて未捕捉の例外');
    win.close();
  });

  await r.test('2-2：先頭の⏹を押すと、ゲーム終了と同じ確認が出る（経路を増やしていない）', async () => {
    const { win, doc } = await launch();
    await openDuringPlay(win, doc, { 手で答える: true });
    click(doc, 'quickEndGameBtn');
    await sleep(win, 150);
    const dlg = H.openDialog(doc);
    assert(dlg, '確認のダイアログが出る');
    assert(/終了しますか/.test(dlg.見出し), 'ゲーム終了と同じ見出し（' + dlg.見出し + '）');
    click(doc, doc.querySelector('.ui-panel [data-ui="cancel"]'));
    await sleep(win, 100);
    assertEqual(activeScreen(doc), 'scr-play', '断ったらゲームは続く');
    win.close();
  });

  // ================= 門F7：音を消す =================

  // 音量を、設定の画面から実際に動かす（保存まで通す）
  async function setVolumes(win, doc, se, speech, bgm) {
    const row = doc.querySelector('#settingsOverlay [data-setpage="sound"]');
    assert(row, '音量の入口がある');
    row.click();
    await sleep(win, 80);
    [['setSeVol', se], ['setSpeechVol', speech], ['setBgmVol', bgm]].forEach(([id, v]) => {
      const s = el(doc, id);
      s.value = String(v);
      s.dispatchEvent(new win.Event('input', { bubbles: true }));
    });
    await sleep(win, 60);
    click(doc, 'setBackBtn');
    await sleep(win, 80);
  }

  await r.test('門F7：「音を消す」は3つの音量をまとめて0にし、押し直すと元にもどる', async () => {
    const { win, doc, errors } = await launch();
    await openDuringPlay(win, doc);
    // 既定とは違う値にしておく（「0に戻っただけ」「既定に戻っただけ」と見分けるため）
    doc.querySelector('#settingsOverlay [data-setpage="app"]').click();
    await sleep(win, 80);
    await setVolumes(win, doc, 55, 77, 33);
    click(doc, 'setBackBtn');
    await sleep(win, 80);
    assertEqual(pageName(doc), 'root', '入口までもどった');
    const probe = () => win.prefsProbe();
    assertEqual(probe().se, 55, '前提：効果音は55');

    click(doc, 'setMuteRow');
    await sleep(win, 100);
    const 消した = probe();
    assertEqual(消した.se, 0, '効果音が0');
    assertEqual(消した.speech, 0, '読み上げが0');
    assertEqual(消した.bgm, 0, 'BGMが0');
    // **保存値は1つも書き換えない**（指示43 6節）
    const 保存 = JSON.parse(win.localStorage.getItem('acac-app-prefs'));
    assertEqual(保存.seVolume, 55, '保存値の効果音は無事');
    assertEqual(保存.speechVolume, 77, '保存値の読み上げは無事');
    assertEqual(保存.bgmVolume, 33, '保存値のBGMは無事');
    // 見た目でも状態が分かる（音なしへの配慮・2-9）
    assertEqual(labelOf(el(doc, 'setMuteRow')), '音をもどす', '押した後は、もどす側の言葉になる');

    click(doc, 'setMuteRow');
    await sleep(win, 100);
    const もどした = probe();
    assertEqual(もどした.se, 55, '効果音が元の値にもどる');
    assertEqual(もどした.speech, 77, '読み上げが元の値にもどる');
    assertEqual(もどした.bgm, 33, 'BGMが元の値にもどる');
    assertNoErrors(errors, '音を消して未捕捉の例外');
    win.close();
  });

  await r.test('門F7：一時ミュートは保存されない（立ち上げ直すと元にもどる）', async () => {
    const a = await launch();
    await openDuringPlay(a.win, a.doc);
    click(a.doc, 'setMuteRow');
    await sleep(a.win, 100);
    assertEqual(a.win.prefsProbe().se, 0, '前提：消えている');
    const 保存 = { 'acac-app-prefs': a.win.localStorage.getItem('acac-app-prefs') };
    a.win.close();

    // 同じ端末で開き直す（保存されていたものだけを持ち越す）
    const b = await launch({ storage: 保存 });
    await sleep(b.win, 80);
    assert(b.win.prefsProbe().se > 0,
      '立ち上げ直すと音はもどっている（ミュートは一時的・2-7）');
    assertEqual(b.win.prefsProbe().muted, false, 'ミュートの印も残っていない');
    b.win.close();
  });

  // ================= 2-3 =================


  // ================= 門F5：15個の設定が、切り替えた瞬間に効く =================
  //
  // 見るのは「appPrefs が変わったか」ではない——それは
  // 「設定したことを設定した」と言っているだけで、効いているかは何も言っていない。
  // **効く先が変わったか**を見る（落とし穴21・落とし穴10-b）。

  /**
   * 15個すべての窓口の表。**門F5の台帳そのもの。**
   * 一覧は手で書くが、appPrefs の側と**両方向で**照合するので腐らない（落とし穴20）。
   * どこで効くかを見ている検査も、行ごとに名前で残す
   */
  const 窓口表 = {
    seVolume:     { page: 'sound',   窓口: 'setSeVol',           検査: 'F5-1（作り置きの出口にも届く）／smoke「音量を0にすると」' },
    speechVolume: { page: 'sound',   窓口: 'setSpeechVol',       検査: 'F5-2' },
    bgmVolume:    { page: 'sound',   窓口: 'setBgmVol',          検査: 'F5-3（人狼の夜で実際に鳴らす）' },
    speechRate:   { page: 'speech',  窓口: 'setRate',            検査: 'F5-2' },
    speechVoice:  { page: 'speech',  窓口: 'setVoice',           検査: 'F5-2 ＋ 2-8（端末に無い声）' },
    brightness:   { page: 'display', 窓口: 'setBright',          検査: 'F5-4' },
    fontScale:    { page: 'display', 窓口: 'setFont',            検査: 'F5-5（10段すべてが別の大きさ）' },
    timerView:    { page: 'display', 窓口: '[data-timerview]',   検査: 'F5-6／fixes36' },
    reactions:    { page: 'display', 窓口: 'setReactionsToggle',検査: 'rt-screens（送る側・受ける側の両方）' },
    titleFanfare: { page: 'display', 窓口: 'setFanfareToggle',   検査: 'F5-7（設定から両方向に動く）' },
    fxSpeed:      { page: 'safety',  窓口: '#setFxSeg [data-fx]',検査: 'F5-4' },
    fxFlash:      { page: 'safety',  窓口: 'setFlashToggle',     検査: 'F5-8（演出の部品も門を読む）' },
    fxShake:      { page: 'safety',  窓口: 'setShakeToggle',     検査: 'F5-8（共通部品を通らない揺れも止まる）' },
    fxBody:       { page: 'safety',  窓口: 'setBodyToggle',      検査: 'rt-screens（同意画面がその場で描き直る）' },
    vibrate:      { page: 'safety',  窓口: 'setVibrateToggle',   検査: 'F5-9' }
  };

  // 効果音・BGMの出口（スピーカーに直結する GainNode）だけを捕まえる
  async function launchWithAudio(opts) {
    const t = await launch(opts);
    const outs = [], closed = [], made = [];
    const orig = t.win.AudioContext;
    t.win.AudioContext = t.win.webkitAudioContext = function () {
      const ctx = orig();
      made.push(ctx);
      const cg = ctx.createGain.bind(ctx);
      ctx.createGain = function () {
        const g = cg();
        const c = g.connect ? g.connect.bind(g) : function () {};
        g.connect = function (to) { if (to === ctx.destination) outs.push(g); return c(to); };
        return g;
      };
      const cl = ctx.close.bind(ctx);
      ctx.close = function () { closed.push(ctx); return cl(); };
      return ctx;
    };
    t.outs = outs; t.closed = closed; t.made = made;
    return t;
  }
  // 読み上げの中身（rate・volume・voice）を捕まえる
  function catchSpeech(win, voices) {
    const said = [];
    win.speechSynthesis = { speak(u) { said.push(u); }, cancel() {}, getVoices() { return voices || []; } };
    win.SpeechSynthesisUtterance = function () {};
    return said;
  }
  const rootStyle = (win, name) =>
    win.document.documentElement.style.getPropertyValue(name).trim();

  // 棚から設定を開いて、設定のページへ（棚では入口を飛ばして「アプリの設定」が出る）
  async function toPrefPage(win, doc, page) {
    if (!el(doc, 'settingsOverlay').classList.contains('show')) {
      click(doc, 'shelfGearBtn');
      await sleep(win, 120);
    }
    const row = doc.querySelector('#settingsOverlay [data-setpage="' + page + '"]');
    assert(row, page + ' の入口がある');
    row.click();
    await sleep(win, 90);
    return doc.querySelector('.set-page[data-page="' + page + '"]');
  }
  function slide(win, doc, id, v) {
    const sl = el(doc, id);
    sl.value = String(v);
    sl.dispatchEvent(new win.Event('input', { bubbles: true }));
  }

  await r.test('門F5：15個の設定に、設定画面の窓口が1つずつある（両方向）', async () => {
    // 「効かない設定」の前に「**触れない設定**」を潰す。
    // titleFanfare がまさにそれで、設定のどのページにも行が無いのに、
    // 獲得の重なりの中の一度きりの窓口で切ると二度と戻せなかった（落とし穴21）
    const { win, doc } = await launch();
    const keys = win.prefsProbe().keys;
    assertEqual(keys.length, 15, '設定は15個（' + keys.length + '個）');
    // 行き：実装の15個が、表に載っている
    keys.forEach((k) => assert(窓口表[k], k + ' が門F5の表に無い'));
    // 帰り：表に載っているものが、実装にある（消した設定が表に残らない）
    Object.keys(窓口表).forEach((k) =>
      assert(keys.indexOf(k) >= 0, '表の ' + k + ' は、もう実装に無い'));

    // 窓口が実際に画面へ出るか
    for (const k of keys) {
      const 行 = 窓口表[k];
      await toPrefPage(win, doc, 行.page);
      const page = doc.querySelector('.set-page[data-page="' + 行.page + '"]');
      const 見つけ方 = 行.窓口.indexOf('[') >= 0 || 行.窓口.indexOf('#') >= 0
        ? 行.窓口 : '#' + 行.窓口;
      assert(page.querySelector(見つけ方) || doc.querySelector(見つけ方),
        k + ' の窓口（' + 行.窓口 + '）が ' + 行.page + ' に出ていない');
      click(doc, 'setBackBtn');
      await sleep(win, 60);
    }
    win.close();
  });

  await r.test('門F5-1：効果音の音量は、あとから変えても作り置きの出口に届く', async () => {
    // 爆弾の心拍は AudioContext を使い回すので、出口は一度しか作られない。
    // 「作る時に読む」だけだと、解除中に音量を変えても心拍だけ元のままだった
    const t = await launchWithAudio();
    await toPrefPage(t.win, t.doc, 'sound');
    slide(t.win, t.doc, 'setSeVol', 100);
    click(t.doc, 'setSeTestBtn');
    await sleep(t.win, 80);
    assert(t.outs.length > 0, '出口が作られた（' + t.outs.length + '個）');
    assert(t.outs.every((g) => g.gain.value === 1), '100にすると出口が最大');
    // **鳴らし直さずに**音量を変える
    slide(t.win, t.doc, 'setSeVol', 30);
    await sleep(t.win, 60);
    assert(t.outs.every((g) => g.gain.value === 0.3),
      '作り置きの出口も、その場で追随する（' + t.outs.map((g) => g.gain.value).join(',') + '）');
    slide(t.win, t.doc, 'setSeVol', 0);
    await sleep(t.win, 60);
    assert(t.outs.every((g) => g.gain.value === 0), '0にすると全部の出口が0');
    t.win.close();
  });

  await r.test('門F5-2：読み上げの音量・速さ・声が、生まれる読み上げに届く', async () => {
    const t = await launch();
    const { win, doc } = t;
    const voices = [{ name: 'テスト音声A', lang: 'ja-JP' }, { name: 'テスト音声B', lang: 'ja-JP' }];
    const said = catchSpeech(win, voices);
    await toPrefPage(win, doc, 'speech');

    slide(win, doc, 'setRate', 130);
    click(doc, 'setSpeechTestBtn');
    await sleep(win, 60);
    assertEqual(said.length, 1, '読み上げが1つ生まれた');
    assertEqual(said[0].rate, 1.3, '速さが効く');

    const sel2 = el(doc, 'setVoice');
    assert(sel2.querySelector('option[value="テスト音声B"]'), '端末の声が一覧に出る');
    sel2.value = 'テスト音声B';
    sel2.dispatchEvent(new win.Event('change', { bubbles: true }));
    click(doc, 'setSpeechTestBtn');
    await sleep(win, 60);
    assertEqual(said.length, 2, '2つ目が生まれた');
    assertEqual(said[1].voice && said[1].voice.name, 'テスト音声B', '声が効く');

    click(doc, 'setBackBtn');
    await sleep(win, 80);
    await toPrefPage(win, doc, 'sound');
    slide(win, doc, 'setSpeechVol', 0);
    click(doc, 'setSpeechTestBtn');
    await sleep(win, 60);
    assertEqual(said.length, 2, '0にすると、読み上げそのものが生まれない');
    slide(win, doc, 'setSpeechVol', 60);
    click(doc, 'setSpeechTestBtn');
    await sleep(win, 60);
    assertEqual(said.length, 3, 'もどすとまた鳴る');
    assertEqual(said[2].volume, 0.6, '音量が効く');
    win.close();
  });

  await r.test('2-8：えらんだ声が、この端末に無い時は一言そえる（読み上げは止めない）', async () => {
    const t = await launch();
    const { win, doc } = t;
    const said = catchSpeech(win, [{ name: 'テスト音声A', lang: 'ja-JP' }]);
    // 別の端末で選んだ設定が同期された、という形（保存には残っているが、声は無い）
    const 保存 = JSON.parse(win.localStorage.getItem('acac-app-prefs') || '{}');
    保存.speechVoice = 'もういない声';
    win.localStorage.setItem('acac-app-prefs', JSON.stringify(保存));
    const b = await launch({ storage: { 'acac-app-prefs': JSON.stringify(保存) } });
    const said2 = catchSpeech(b.win, [{ name: 'テスト音声A', lang: 'ja-JP' }]);
    await toPrefPage(b.win, b.doc, 'speech');
    assertEqual(el(b.doc, 'setVoiceNote').textContent,
      'えらんだ声は、この端末にはありません（端末の既定の声で読み上げます）',
      '行に一言そえる');
    click(b.doc, 'setSpeechTestBtn');
    await sleep(b.win, 60);
    assertEqual(said2.length, 1, '読み上げそのものは止めない');
    assertEqual(said2[0].voice, undefined, '端末の既定の声に落ちる');
    win.close(); b.win.close();
    void said;
  });

  await r.test('門F5-3：BGMの音量が、鳴っているBGMに届く', async () => {
    const t = await launchWithAudio();
    // BGMのつまみは 音量/100*0.12。効果音の出口（既定0.7）と値で見分けられる
    const bgm = (v) => t.outs.filter((g) => Math.abs(g.gain.value - v / 100 * 0.12) < 1e-9);
    await toWolfNight(t.win, t.doc, ['あき', 'びび', 'ちか', 'でん']);
    // **落ち着くまで待つ。**ここへ来るまでの画面替わりでBGMは何度も入り切りするので、
    // 数だけ見ていると「前の画面の止まり」を「いま止めた」と読み違える
    //（測る道具の側が嘘をつく形・落とし穴28）
    await H.waitFor(t.win, () => bgm(40).length > 0, 4000,
      '型(b)：既定の音量（40）でBGMが鳴っている');

    click(t.doc, 'floatingGearBtn');
    await sleep(t.win, 120);
    await toPrefPage(t.win, t.doc, 'app');
    await toPrefPage(t.win, t.doc, 'sound');
    // 上げ下げは、鳴らし直さずにその場で効く
    slide(t.win, t.doc, 'setBgmVol', 100);
    await H.waitFor(t.win, () => bgm(100).length > 0, 3000, '上げるとその場で大きくなる');
    slide(t.win, t.doc, 'setBgmVol', 20);
    await H.waitFor(t.win, () => bgm(20).length > 0, 3000, '下げるとその場で小さくなる');
    // 0 は「小さくする」ではなく「止める」
    const 閉じた = t.closed.length;
    slide(t.win, t.doc, 'setBgmVol', 0);
    await H.waitFor(t.win, () => t.closed.length > 閉じた, 3000, '0にするとBGMが止まる');
    const 作った = t.made.length;
    slide(t.win, t.doc, 'setBgmVol', 60);
    await H.waitFor(t.win, () => t.made.length > 作った && bgm(60).length > 0, 3000,
      'もどすとまた鳴りはじめる');
    t.win.close();
  });

  await r.test('門F5-4：明るさと演出の速さが、その場で画面に届く', async () => {
    const t = await launch();
    const { win, doc } = t;
    await toPrefPage(win, doc, 'display');
    slide(win, doc, 'setBright', 130);
    await sleep(win, 40);
    assertEqual(rootStyle(win, '--screen-bright'), '1.30', '明るさが効く');
    slide(win, doc, 'setBright', 70);
    await sleep(win, 40);
    assertEqual(rootStyle(win, '--screen-bright'), '0.70', '逆向きにも効く');

    click(doc, 'setBackBtn');
    await sleep(win, 80);
    await toPrefPage(win, doc, 'safety');
    doc.querySelector('#setFxSeg [data-fx="fast"]').click();
    await sleep(win, 40);
    assertEqual(rootStyle(win, '--fx-scale'), '0.5', '「速い」が効く');
    doc.querySelector('#setFxSeg [data-fx="skip"]').click();
    await sleep(win, 40);
    assert(win.document.documentElement.classList.contains('fx-skip'), '「スキップ」が効く');
    doc.querySelector('#setFxSeg [data-fx="normal"]').click();
    await sleep(win, 40);
    assertEqual(rootStyle(win, '--fx-scale'), '1', 'もどせる');
    win.close();
  });

  await r.test('門F5-5：文字サイズは、10段のどこを動かしても必ず大きさが変わる', async () => {
    // それまで印は「92%以下＝小」「115%以上＝大」の2つしか無く、
    // **95・100・105・110 の4段は1pxも動かなかった**（動かしたのに何も起きない）
    const 段 = [85, 90, 95, 100, 105, 110, 115, 120, 125, 130];
    const 役割 = ['--fs-title', '--fs-body', '--fs-sub', '--fs-btn'];
    // トークンの表そのものを読む（jsdom は :root のクラスからの継承を解かない）
    const 表 = {};
    段.forEach((p) => {
      // 100% は土台（:root そのもの）。ここに別の規則を書くと、
      // 同じ値が2か所になって片方だけ直す日が来る（落とし穴1）
      const m = p === 100
        ? HTML.match(/:root\{([^}]*--fs-title[^}]*)\}/)
        : HTML.match(new RegExp(':root\\.fs-' + p + '\\{([^}]*)\\}'));
      assert(m, p + '% のトークンが書かれていない');
      表[p] = 役割.map((v) => {
        const mm = m[1].match(new RegExp(v + '\\s*:\\s*([\\d.]+)px'));
        assert(mm, p + '% に ' + v + ' が無い');
        return parseFloat(mm[1]);
      });
    });
    役割.forEach((v, i) => {
      for (let k = 1; k < 段.length; k++) {
        assert(表[段[k]][i] > 表[段[k - 1]][i],
          v + ' が ' + 段[k - 1] + '% → ' + 段[k] + '% で大きくならない（' +
          表[段[k - 1]][i] + ' → ' + 表[段[k]][i] + '）');
      }
    });

    // 印が実際に付き替わること（印が無ければ、上の表は誰も読まない）
    const t = await launch();
    const { win, doc } = t;
    await toPrefPage(win, doc, 'display');
    for (const p of 段) {
      slide(win, doc, 'setFont', p);
      await sleep(win, 25);
      const cls = win.document.documentElement.className;
      assert(new RegExp('(^|\\s)fs-' + p + '(\\s|$)').test(cls),
        p + '% の印が付く（' + cls + '）');
    }
    // 正本と既存の検査が名前で見ている両端の印も残っている
    assert(win.document.documentElement.classList.contains('fs-large'), '大の印も付く');
    slide(win, doc, 'setFont', 85);
    await sleep(win, 25);
    assert(win.document.documentElement.classList.contains('fs-small'), '小の印も付く');
    win.close();
  });

  await r.test('門F5-6：残り時間の見せ方が、その場で全部の時計に届く', async () => {
    const t = await launch();
    const { win, doc } = t;
    await toPrefPage(win, doc, 'display');
    ['hidden', 'peek', 'always'].forEach((v) => {
      doc.querySelector('.set-page[data-page="display"] [data-timerview="' + v + '"]').click();
      assertEqual(el(doc, 'app').dataset.timerView, v, v + ' が効く');
    });
    win.close();
  });

  await r.test('門F5-7：称号の演出は、設定から切れて、設定からもどせる', async () => {
    // それまで窓口は獲得の重なりの中だけで、一度切ると重なりが二度と出ないため
    // **戻す道が無かった**。しかも案内文は「設定の『見た目と演出』からもどせます」
    // と、存在しない行を指していた（落とし穴21）
    const t = await launch();
    const { win, doc } = t;
    await toPrefPage(win, doc, 'display');
    const row = el(doc, 'setFanfareToggle');
    assert(row.classList.contains('on'), '既定は「大きく出す」');
    click(doc, 'setFanfareToggle');
    await sleep(win, 40);
    assert(!row.classList.contains('on'), '切れる');
    assertEqual(JSON.parse(win.localStorage.getItem('acac-app-prefs')).titleFanfare, false,
      '切ったことが残る');
    click(doc, 'setFanfareToggle');
    await sleep(win, 40);
    assert(row.classList.contains('on'), '**もどせる**（片道になっていない）');
    win.close();
  });

  await r.test('門F5-8：光の点滅・画面の揺れを切ると、実際に出なくなる', async () => {
    const t = await launch();
    const { win, doc } = t;
    await toPrefPage(win, doc, 'safety');
    click(doc, 'setFlashToggle');
    await sleep(win, 40);
    assert(el(doc, 'app').classList.contains('no-flash'), '光の点滅を切ると印が付く');
    // **演出の部品そのものも、この門を読む。**
    // それまで効いていたのはCSSの1行だけで、fx.js に渡していた門は
    // 読む行が1つも無かった（揺れは同じ形の門を持っていた・落とし穴1）
    const 前 = doc.querySelectorAll('.fx-flash').length;
    const 待った = await win.FxKit.flash('good');
    assertEqual(doc.querySelectorAll('.fx-flash').length, 前,
      '切っている間は、光そのものを作らない');
    assertEqual(待った, true, '切っていても、呼んだ側は止まらずに進む');
    click(doc, 'setFlashToggle');
    await sleep(win, 40);
    assert(!el(doc, 'app').classList.contains('no-flash'), 'もどせる');

    click(doc, 'setShakeToggle');
    await sleep(win, 40);
    assert(el(doc, 'app').classList.contains('no-shake'), '揺れを切ると印が付く');
    // **共通部品を通らない揺れも止まる**（画面に直接付ける .shake・爆弾の残機）
    const 止める = cssRules(HTML).filter((x) => /\.no-shake/.test(x.sel))
      .map((x) => x.sel).join(' ');
    assert(/no-shake\s+\.shake/.test(止める), '画面に直接付ける .shake も止める');
    assert(/bomb-lives/.test(止める), '爆弾の残機の揺れも止める');
    win.close();
  });

  await r.test('門F5-9：振動を切ると端末を震わせない（入れると1回だけ震える）', async () => {
    const t = await launch();
    const { win, doc } = t;
    const 震え = [];
    win.navigator.vibrate = (p) => { 震え.push(p); return true; };
    await toPrefPage(win, doc, 'safety');
    assert(el(doc, 'setVibrateToggle').classList.contains('on'), '前提：既定はON');
    click(doc, 'setVibrateToggle');   // OFF へ
    await sleep(win, 40);
    assertEqual(震え.length, 0, '切った時は震わせない');
    click(doc, 'setVibrateToggle');   // ON へ
    await sleep(win, 40);
    assertEqual(震え.length, 1, 'ONにすると1回だけ震える（効いていることが分かる）');
    // 切ったあとは、鳴らしにくる場所があっても震えない
    click(doc, 'setVibrateToggle');
    await sleep(win, 40);
    assertEqual(震え.length, 1, '切ったら、それ以上は震えない');
    win.close();
  });

  // ================= 2-8：異常系 =================

  await r.test('2-8：設定を端末に保存できない時は、黙って捨てずに一言だす', async () => {
    const t = await launch();
    const { win, doc } = t;
    await toPrefPage(win, doc, 'display');
    // 端末の保存領域がいっぱい・プライベートモードなどで起きる形
    win.localStorage.setItem = function () { throw new Error('QuotaExceeded'); };
    slide(win, doc, 'setBright', 120);
    await sleep(win, 120);
    // 画面の値はそのまま（この回は効いている）
    assertEqual(rootStyle(win, '--screen-bright'), '1.20', 'いまの画面には効いている');
    const 知らせ = doc.body.textContent;
    assert(/次に開くと元にもどります/.test(知らせ),
      '保存できなかったことを伝える（' + 知らせ.slice(-80) + '）');
    win.close();
  });

  await r.test('2-3：「アイコン・二つ名」は、ログインしていなくても開ける', async () => {
    const 行 = (doc) => doc.querySelector('.set-page[data-page="app"] [data-setact="titles"]');

    const 未 = await launch({ loggedOut: true });
    await openFromShelf(未.win, 未.doc);
    const r1 = 行(未.doc);
    assert(r1, '未ログインでも行が出る（指示42で開放した）');
    assertEqual(r1.querySelector('.sr-sub').textContent, 'ログインすると記録が残ります',
      '責めずに、次にできることを言う');
    r1.click();
    await sleep(未.win, 200);
    assertEqual(activeScreen(未.doc), 'scr-titles', '実際に開く');
    未.win.close();

    // 逆から（落とし穴20）：ログインしていれば、案内ではなく本来の説明が出る
    const 済 = await launch();
    await openFromShelf(済.win, 済.doc);
    assertEqual(行(済.doc).querySelector('.sr-sub').textContent, '集めたものからえらびます',
      'ログイン済みなら、案内ではなく説明');
    済.win.close();
  });

  r.finish();
})();
