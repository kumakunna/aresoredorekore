// tests/fixes45.js — 第45弾（テストプレイの発見）で直したことの再発防止
//
// 出どころは `docs/遊んだ記録.md` の 2026-09-10 ①（くまくん以外の1人が
// クイズ解除・協力版・部屋を遊んだ報告）。**遊んだ人が見たことを、機械の側に写す。**
//
// 落とし穴10の型を踏まないよう、次を守って書く：
//   (a) 自己参照   … 実装の定数を検査の入力にしない。約束は**具体の数字・具体の文字**で書く
//   (b) 条件未成立 … 「その状況が本当に起きているか」を、主張の前に1つ確かめる
//   (c) 分岐未試験 … 3択・仮面あり/なしのように分岐があるものは、全部の入力を回す
//   (d) 実データ依存 … 変わるデータではなく、変わらない性質（門が効くこと）を試す

const fs = require('fs');
const path = require('path');
const {
  createRunner, assert, assertEqual, assertNoErrors,
  launch, activeScreen, sleep, waitFor, el, click } = require('./harness');

const INDEX_HTML = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const CSS = (INDEX_HTML.match(/<style>([\s\S]*?)<\/style>/) || [null, ''])[1];

// CSSを「セレクタ{宣言}」で拾う。**読めなかったものは件数で赤くする**（落とし穴10-e）
function rulesOf(css) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    out.push({ sel: m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim(), body: m[2].trim() });
  }
  return out;
}
const RULES = rulesOf(CSS);

(async function main() {
  const r = createRunner('fixes45：テストプレイの発見');

  // ===================== 45-1 =====================

  await r.test('45-1：残り時間の既定は「常に表示」で、まっさらな端末では時計が隠れない', async () => {
    // **具体の値で書く**（落とし穴10-a）。実装から `appPrefs.timerView` を
    // 読んで比べると、既定を `peek` に戻した日に検査も一緒に緩む
    const { win, doc, errors } = await launch();
    assertEqual(el(doc, 'app').dataset.timerView, 'always',
      'まっさらな端末は「常に表示」で始まる（制限時間のあるゲームで、既定が隠すは成立しない）');
    assertEqual(win.prefsProbe().timerView, 'always', '保存される値も「常に表示」');
    // 窓口の側は、**その画面を出した時に**光る（設定は renderSettings、
    // ウィザードは renderTimerStep が面倒を見る）ので、起動直後はまだどれも光っていない。
    // 見たいのは「印がどこかに付いているか」ではなく、
    // **2か所の窓口が、同じ1か所の値をそろって指しているか**（落とし穴1）
    const 光り = () => Array.from(doc.querySelectorAll('[data-timerview].on'))
      .map((b) => b.dataset.timerview);
    ['always', 'peek', 'hidden', 'always'].forEach((v) => {                     // 型(c)
      click(doc, doc.querySelector('[data-timerview="' + v + '"]'));
      const 光った = 光り();
      assert(光った.length >= 2, v + ' を押すと2か所とも光る（いま ' + 光った.length + '個）');
      assertEqual(光った.filter((x) => x !== v).join(','), '',
        '光っているのは ' + v + ' だけ（設定とウィザードで食い違わない）');
    });
    assertNoErrors(errors);
    win.close();
  });

  await r.test('45-1：「見たい時」の仮面は、押せることが読み取れる', async () => {
    // 遊んだ人は最後まで `--:--` のままだった。**押せば出ると、どこにも書いていなかった。**
    // 直したのは仮面の中身なので、中身そのものを名指しで見る
    const 仮面 = RULES.filter((x) =>
      /\[data-timer-view="peek"\]/.test(x.sel) && /::after/.test(x.sel));
    assertEqual(仮面.length, 1, '「見たい時」の仮面を描く規則が1つある');        // 型(b)
    assert(/content\s*:\s*'タップで見る'/.test(仮面[0].body),
      '仮面は「タップで見る」と言う（`--:--` は押せることを何も伝えない）');
    assertEqual((CSS.match(/content\s*:\s*'--:--'/g) || []).length, 0,
      '押せることを伝えない仮面（--:--）が、CSSに1つも残っていない');
    // 形でも分かるようにする（色だけに頼らない）
    const 覆い = RULES.filter((x) =>
      /\[data-timer-view="peek"\]/.test(x.sel) && /:not\(\.peek-on\)/.test(x.sel) && !/::after/.test(x.sel));
    assertEqual(覆い.length, 1, '仮面を掛ける規則が1つある');                    // 型(b)
    assert(/border-style\s*:\s*dashed/.test(覆い[0].body), '縁が破線で、押せる場所だと形でも分かる');
    const 押せる = RULES.filter((x) =>
      x.sel === '.app[data-timer-view="peek"] [data-timer]');
    assertEqual(押せる.length, 1, '「見たい時」の時計そのものへの規則が1つある');
    assert(/cursor\s*:\s*pointer/.test(押せる[0].body), '指のかたちになる');
    // 仮面の言葉（6文字 × 0.6em ＝ 3.6em）が入る幅を、先に取ってある。
    // いちばん小さい時計では余りが6pxしかなかった——書体が変わった日に静かにはみ出す
    const minW = /min-width\s*:\s*([\d.]+)em/.exec(押せる[0].body);
    assert(minW && parseFloat(minW[1]) >= 3.6,
      '仮面の言葉が必ず収まる幅を取ってある（' + (minW ? minW[1] + 'em' : '指定なし') + '）');
  });

  await r.test('45-1：残りわずかになったら、押さなくても数字が出る（全テーマで同じ）', async () => {
    // **これが第45弾の本題。**それまでは事故で、爆弾テーマだけが漏れていた：
    // `.app.theme-bomb .timer-chip.warn` と仮面の規則は詳細度がどちらも 0,4,0 で並び、
    // 後ろにある爆弾テーマだけが勝って、仮面の上に赤い数字が透けていた（落とし穴23）。
    const 覆い = RULES.filter((x) =>
      /\[data-timer-view="peek"\]/.test(x.sel) && /:not\(\.peek-on\)/.test(x.sel));
    assertEqual(覆い.length, 2, '仮面の規則は2つ（覆いと、その上の言葉）');       // 型(b)
    覆い.forEach((x) => {
      assert(/:not\(\.warn\)/.test(x.sel) && /:not\(\.done\)/.test(x.sel),
        '仮面は .warn / .done を外している（' + x.sel.slice(0, 60) + '）');
    });
    // テーマ側が `.timer-chip.warn` の色を上書きしていること自体は正しい。
    // **上書きが1つも無ければ、この検査は何も守っていない**ので、あることを先に確かめる（型(b)）
    const テーマの上書き = RULES.filter((x) => /\.timer-chip\.(warn|done)/.test(x.sel) && /theme-/.test(x.sel));
    assert(テーマの上書き.length >= 1,
      'テーマが残りわずかの色を上書きしている（この状況が無ければ、上の検査は自明に通る）');
  });

  await r.test('45-1：時計の1目盛りは、どの時計も同じ1本を通る', async () => {
    // 直前まで `classList.toggle('warn', sec <= 10 && sec > 0)` の写しが
    // **8か所に散っていた**。散っていると、新しいゲームで付け忘れる（落とし穴1・4）
    // **自分の説明文を数えない**（落とし穴30：説明のために書いた名前を
    // 「使っている」と読むと、自分の目を塞ぐ）。行頭が // や * の行は読み飛ばす
    const 写し = INDEX_HTML.split('\n')
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .filter((line) => /classList\.(toggle|add)\(\s*'warn'/.test(line));
    assertEqual(写し.length, 1,
      "'warn' を付ける行は1つだけ（見つかった: " + 写し.map((x) => x.trim()).join(' / ') + '）');
    const 通し = (INDEX_HTML.match(/timerChipTick\(/g) || []).length;
    assert(通し >= 9, '時計の描画がその1本を呼んでいる（定義1 ＋ 呼び出し8つ以上／いま ' + 通し + '）');

    // 印の付き方そのものを、境目の両側で見る（型(c)：分岐を書いたら両方の入力を通す）
    const { win, doc, errors } = await launch();
    const t = (sec, opts) => win.timerProbe('playTimer', sec, opts);
    assert(/\bwarn\b/.test(t(10).cls), '残り10秒は「のこりわずか」');
    assert(!/\bwarn\b/.test(t(11).cls), '残り11秒は、まだふつう');
    assert(/\bdone\b/.test(t(0).cls) && !/\bwarn\b/.test(t(0).cls), '0秒は「おわり」');
    assert(/\bdone\b/.test(t(-3).cls), '行き過ぎた時計（負の値）も「おわり」のまま');
    // 境目はゲームごとに違う。早押しは3秒・人狼の夜は5秒
    assert(/\bwarn\b/.test(t(3, { warnAt: 3 }).cls), '境目を3秒にすると、3秒で「のこりわずか」');
    assert(!/\bwarn\b/.test(t(4, { warnAt: 3 }).cls), '境目を3秒にすると、4秒はまだふつう');
    // 脈打ちは、頼んだ時だけ付く
    assert(/\bhurry\b/.test(t(5, { hurry: true }).cls), '頼めば脈打つ');
    assert(!/\bhurry\b/.test(t(5).cls), '頼まなければ脈打たない');
    assertNoErrors(errors);
    win.close();
  });

  await r.test('45-1：仮面が自分から外れた時は、なぜ出たかを1度だけ言う', async () => {
    const { win, doc, errors } = await launch();
    click(doc, doc.querySelector('[data-timerview="peek"]'));
    const notices = () => Array.from(doc.querySelectorAll('#fxNotices .fx-notice'))
      .map((n) => n.textContent);
    assertEqual(notices().length, 0, 'まだ何も言っていない');                    // 型(b)
    win.timerProbe('playTimer', 30);
    assertEqual(notices().length, 0, 'ふつうの残り時間では、何も言わない');
    win.timerProbe('playTimer', 9);
    assertEqual(notices().length, 1, '仮面が外れた瞬間に、1つだけ言う');
    assert(/のこり/.test(notices()[0]), '言うのは「のこりが少ない」こと（' + notices()[0] + '）');
    win.timerProbe('playTimer', 8);
    win.timerProbe('playTimer', 7);
    assertEqual(notices().length, 1, '毎目盛り言わない（うるさくしない）');
    // 「常に表示」の人には、そもそも仮面が無いので何も言わない（型(c)）
    click(doc, doc.querySelector('[data-timerview="always"]'));
    win.timerProbe('qzTimer', 30);
    win.timerProbe('qzTimer', 5);
    assertEqual(notices().length, 1, '「常に表示」の人には言わない（外れる仮面が無い）');
    assertNoErrors(errors);
    win.close();
  });

  await r.test('45-1：選んだ覚えのない「見たい時」は、1度だけ「常に表示」へもどす', async () => {
    // 印より前に保存された `peek`（＝本人が選んだのか分からない値）
    const 古い端末 = await launch({
      storage: { 'acac-app-prefs': JSON.stringify({ timerView: 'peek' }) } });
    assertEqual(古い端末.win.prefsProbe().timerView, 'always',
      '印の無い peek は「常に表示」へもどる');
    assertEqual(古い端末.win.prefsProbe().chosen.timerView, true,
      'もどした時に印を立てる（次からは選択として扱う）');
    // 黙って変えない。最初の画面移りで一言出す
    await waitFor(古い端末.win,
      () => 古い端末.doc.querySelectorAll('#fxNotices .fx-notice').length > 0,
      4000, 'もどしたことを知らせる一言');
    const 文 = 古い端末.doc.querySelector('#fxNotices .fx-notice').textContent;
    assert(/常に表示/.test(文) && /設定/.test(文),
      'もどしたことと、もどし方の両方を言う（' + 文 + '）');
    古い端末.win.close();

    // 自分で選んだ人は尊重する（型(c)：印のある/ないの両方を通す）
    const 選んだ端末 = await launch({
      storage: { 'acac-app-prefs': JSON.stringify({ timerView: 'peek', _chosen: { timerView: true } }) } });
    assertEqual(選んだ端末.win.prefsProbe().timerView, 'peek',
      '自分で「見たい時」を選んだ端末は、そのまま');
    assertEqual(選んだ端末.doc.querySelectorAll('#fxNotices .fx-notice').length, 0,
      '尊重した人には何も言わない');
    選んだ端末.win.close();

    // 「表示しない」を自分で選ぶ人はいる。印が無くても動かさない（型(c)）
    const 隠す端末 = await launch({
      storage: { 'acac-app-prefs': JSON.stringify({ timerView: 'hidden' }) } });
    assertEqual(隠す端末.win.prefsProbe().timerView, 'hidden',
      '「表示しない」は、印が無くても動かさない');
    隠す端末.win.close();
  });

  await r.test('45-1：見えていないホイールは、制限時間を書き換えない', async () => {
    // **再戦（「もう一度」）が始まった瞬間に時間切れになっていた。**
    // 分・秒の列はスクロール位置で値を決めているので、画面が display:none に
    // なった瞬間に scrollTop が 0 へ戻り、`scroll` が1回鳴る。
    // 秒の列は0分の時だけ最小1秒なので、落ち着く先は必ず 0:01——
    // `state.customTimer = 1` が残り、`|| 180` にも落ちずにサーバーへ渡っていた
    const { win, doc, errors } = await launch();
    // 時間の画面を出して、5分にする
    win.__test_goTo ? win.__test_goTo('scr-set-timer') : null;
    const seg = doc.querySelector('#timerPresets [data-sec="300"]');
    // ウィザードを通らずに時間の画面だけを出す道は無いので、
    // 押せる状態でなければ「窓口があること」だけ確かめて先へ進む（型(b)）
    assert(doc.getElementById('wheelM') && doc.getElementById('wheelS'),
      '分・秒のホイールがある');
    if (seg) seg.click();

    const 前 = win.customTimerProbe();
    // 画面を離れた時と同じことを起こす：ホイールの位置が0に戻って scroll が鳴る
    const ws = doc.getElementById('wheelS');
    const wm = doc.getElementById('wheelM');
    assertEqual(activeScreen(doc) !== 'scr-set-timer', true,
      '時間の画面は出ていない（この状況が無ければ、下の主張は自明に通る）');  // 型(b)
    wm.scrollTop = 0; ws.scrollTop = 0;
    wm.dispatchEvent(new win.Event('scroll', { bubbles: true }));
    ws.dispatchEvent(new win.Event('scroll', { bubbles: true }));
    await sleep(win, 250);   // 落ち着くまでの120msを跨ぐ
    assertEqual(win.customTimerProbe(), 前,
      '見えていない所からのスクロールでは、制限時間が変わらない（前: ' + 前 + '）');
    assert(win.customTimerProbe() !== 1,
      '0:01 になっていない（再戦が始まった瞬間に時間切れになる値）');
    assertNoErrors(errors);
    win.close();
  });

  r.finish();
})();
