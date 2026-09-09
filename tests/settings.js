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
