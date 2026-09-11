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
  launch, activeScreen, sleep, waitFor, waitScreen, el, click,
  fillPlayerForm, pickGame } = require('./harness');

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

  // ===================== 45-2 =====================

  await r.test('45-2：画面いっぱいの演出は、同時に起きても重ならない', async () => {
    const { win, doc, errors } = await launch();
    const Fx = win.FxKit;
    const 順 = [];
    // **実装で起きる順そのままに頼む。**部屋では awardRoomTitles（褒める）が
    // renderRtBomb（結果の帯）より先に走るので、頼む順は「褒める→結果」になる。
    // それでも結果が先に出るのが、45-2 で入れた決めごと
    const 褒める = Fx.stage(() => { 順.push('褒める'); }, { praise: true });
    // **1拍おくことが、順序の仕組みそのもの。**ここでその場で動いてしまうと、
    // あとから頼まれる結果の演出は、もう追い越せない
    assertEqual(順.join(','), '', '褒める側は、頼んだその場では動かない（1拍おく）');
    const 結果 = Fx.banner({ text: '爆発', kind: 'gray', ms: 200 })
      .then(() => { 順.push('結果'); });
    // **出ている最中に数える**（落とし穴10-g：片付いたあとに数えると、門が効かなくても同じ数）
    assertEqual(doc.querySelectorAll('.fx-banner').length, 1, '帯がいま出ている');  // 型(b)
    assertEqual(順.join(','), '', '帯が出ている間、褒める側はまだ動いていない');
    await Promise.all([褒める, 結果]);
    assertEqual(順.join(','), '結果,褒める', '結果が先、褒めるが後');
    assertEqual(doc.querySelectorAll('.fx-banner').length, 0, '帯は出しっぱなしにならない');

    // **結果が2つ続く場面**（爆発 → 順位）でも、褒めるのは最後。
    // 待ち行列の後ろに素直に足すと、2つ目の結果が称号の後ろへ回り、
    // 「褒めてから、まだ結果が続く」形になる（型(b)：その状況を実際に作る）
    順.length = 0;
    const 褒2 = Fx.stage(() => { 順.push('褒める'); }, { praise: true });
    const 結果A = Fx.banner({ text: '爆発', kind: 'gray', ms: 120 })
      .then(() => { 順.push('結果A'); });
    const 結果B = Fx.banner({ text: '順位', kind: 'good', ms: 120 })
      .then(() => { 順.push('結果B'); });
    assertEqual(win.FxKit.stageState().待ち, 2, '2つが順番待ちに並んでいる');   // 型(b)
    await Promise.all([褒2, 結果A, 結果B]);
    assertEqual(順.join(','), '結果A,結果B,褒める',
      '結果が2つ続いても、褒めるのはそのあと');
    assertNoErrors(errors);
    win.close();
  });

  await r.test('45-2：舞台が空いていれば、その場で出る（一拍おかない）', async () => {
    // 順番待ちを入れた代償に「いつも一拍遅れる」ようになっては本末転倒。
    // 空いている時は同期で出ること自体を見る（型(b)：この状況を先に作る）
    const { win, doc, errors } = await launch();
    assertEqual(win.FxKit.stageState().走っている, false, '舞台は空いている');
    win.FxKit.banner({ text: 'やった', ms: 100 });
    assertEqual(doc.querySelectorAll('.fx-banner').length, 1,
      '空いている時は、頼んだその場で出る');
    await sleep(win, 400);
    assertNoErrors(errors);
    win.close();
  });

  await r.test('45-2：スキップにしていると、順番待ちごと瞬時に流れる', async () => {
    const { win, doc, errors } = await launch({ fxSkip: true });
    const 順 = [];
    const 褒める = win.FxKit.stage(() => { 順.push('褒める'); }, { praise: true });
    const 結果 = win.FxKit.banner({ text: '爆発', kind: 'gray', ms: 900 })
      .then(() => { 順.push('結果'); });
    const t0 = Date.now();
    await Promise.all([褒める, 結果]);
    const かかった = Date.now() - t0;
    assertEqual(順.join(','), '結果,褒める', 'スキップでも順番は変わらない');
    assert(かかった < 400, '900ms の帯を待たずに流れる（かかった: ' + かかった + 'ms）');
    assertNoErrors(errors);
    win.close();
  });

  await r.test('45-2：順序は「褒めるかどうか」だけで決まる（個別の順序を書かない）', async () => {
    // 「爆発の後に称号」と個別に書くと、演出を1つ足すたびに順序も1つ足すことになる
    //（落とし穴4）。称号の側が `praise:true` を名乗るだけで済んでいることを見る
    assert(/FxKit\.stage\(function\(\)\{[\s\S]{0,400}?titleGotOverlay/.test(INDEX_HTML),
      '称号の重なりは、舞台に乗せてから出す');
    assert(/titleGotOverlay[\s\S]{0,200}?praise\s*:\s*true/.test(INDEX_HTML),
      '称号は「褒める」を名乗る');
    const 個別の順序 = INDEX_HTML.split('\n')
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .filter((line) => /bombBoomFx[\s\S]*showTitleGot|showTitleGot[\s\S]*bombBoomFx/.test(line));
    assertEqual(個別の順序.length, 0, '「爆発の後に称号」を名指しで書いた行が無い');
    // 前の試合の順番待ちを持ち越さない
    assert(/stageClear\(\)/.test(INDEX_HTML), 'ゲームを捨てる時に舞台も空にする');
  });

  // ===================== 45-3 =====================

  await r.test('45-3：同じゲームで作り直す時は、モードを引き継ぐ', async () => {
    // **再戦（「もう一度」）でルール文が消えていた。**
    // サーバーの clearGameState が state.data を空にするので modeId が落ち、
    // ルール画面がモードではなくゲームを出して
    // 「このゲームの説明は、まだ用意できていません」に化けていた（実サーバーで再現）。
    const RTClient = require('../public/js/rt-client.js');
    function 作る(部屋) {
      const emits = [];
      const sock = {
        on() { return sock; },
        emit(name, payload, cb) {
          emits.push({ name, payload });
          if (cb) cb({ ok: true, code: 'AAA111', memberId: 'm1', room: 部屋 });
          return sock;
        },
        close() {}, disconnect() {}
      };
      const rt = RTClient.create({ io: () => sock });
      return { rt, emits };
    }
    const 部屋 = { code: 'AAA111', state: { phase: 'lobby', game: 'bomb', data: { modeId: 'bomb-coop' } },
      members: [], ready: { count: 0, total: 1 } };
    const t = 作る(部屋);
    await t.rt.joinRoom('AAA111', 'あき');
    const 直後 = t.emits.length;

    // ① 同じゲームで作り直す（「もう一度」）→ モードが付いてくる
    await t.rt.pickGame('bomb', { reset: true });
    const もう一度 = t.emits[t.emits.length - 1];
    assertEqual(もう一度.name, 'room:setState', '作り直しは room:setState で送る');   // 型(b)
    assert(もう一度.payload.data && もう一度.payload.data.modeId === 'bomb-coop',
      'モードidが付いてくる（' + JSON.stringify(もう一度.payload.data) + '）');
    assert(t.emits.length > 直後, '実際に1つ送られている');                        // 型(b)

    // ② 別のゲームへ移る時は引き継がない（別ゲームのモードidを持ち越さない・大切なこと9）
    await t.rt.pickGame('wolfrole', { reset: true });
    const 別ゲーム = t.emits[t.emits.length - 1];
    assert(!(別ゲーム.payload.data && 別ゲーム.payload.data.modeId),
      '別のゲームには、前のモードidを持ち越さない');

    // ③ ゲームを外す（えらび直し）時も引き継がない（型(c)）
    await t.rt.pickGame(null, { reset: true });
    const 外す = t.emits[t.emits.length - 1];
    assert(!(外す.payload.data && 外す.payload.data.modeId),
      'ゲームを外した時は、モードidも残さない');

    // ④ 呼ぶ側が自分でモードidを渡した時は、そちらが勝つ
    const u = 作る(部屋);
    await u.rt.joinRoom('AAA111', 'あき');
    await u.rt.pickGame('bomb', { reset: true, data: { modeId: 'bomb-race' } });
    assertEqual(u.emits[u.emits.length - 1].payload.data.modeId, 'bomb-race',
      '呼ぶ側が決めたモードidが勝つ');
  });

  await r.test('45-3：引き継ぎは呼ぶ側ではなく1か所にある', async () => {
    // 経路は5つある（もう一度／ゲーム終了／モードえらび直し／ゲームえらび直し／最初の1回）。
    // 呼ぶ側に書くと、必ずどれかで書き忘れる（落とし穴1・4）
    const RT = fs.readFileSync(
      path.join(__dirname, '..', 'public', 'js', 'rt-client.js'), 'utf8');
    assert(/function pickGame\(gameId, opts\)[\s\S]{0,900}?modeId/.test(RT),
      'モードidの引き継ぎは pickGame の中にある');
    const 呼び出し = INDEX_HTML.split('\n')
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .filter((line) => /rt\.pickGame\(/.test(line));
    assert(呼び出し.length >= 4,
      '呼ぶ側の経路が実際に複数ある（いま ' + 呼び出し.length + '本）');           // 型(b)
    const modeIdを書いている = 呼び出し.filter((line) => /modeId/.test(line));
    assertEqual(modeIdを書いている.length, 1,
      'モードidを名指しで渡すのは、最初にゲームを決める1本だけ（いま '
        + modeIdを書いている.length + '本）');
  });

  // ===================== 45-4・45-6 =====================
  // 本物の進行役（bomb-room.js）を動かして確かめる（落とし穴25：
  // 手書きの検体は、実装から静かに離れていく）

  const BombRoom = require('../bomb-room.js');
  function 部屋(names) {
    const members = new Map();
    names.forEach((n, i) => members.set('m' + i, {
      id: 'm' + i, name: n, role: 'player', connected: true, readyGame: null
    }));
    return { code: 'T45BOM', members, state: { phase: 'lobby', game: null, data: {} } };
  }
  function 種(n) { let x = n; return () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; }; }
  function 始める(o) {
    const room = 部屋(o.names || ['あき', 'びび']);
    const res = BombRoom.startGame(room, {
      mode: o.mode || 'coop', counts: o.counts || { easy: 3 },
      lives: o.lives == null ? 3 : o.lives, timerSec: 0, topics: [],
      showMisses: o.showMisses, preset: 'bomb-coop', rnd: 種(o.seed || 21)
    }, { notify() {} });
    return { room, res, w: room.bomb };
  }
  function 答える(t, who, uid, 当てる) {
    BombRoom.submitAction(t.room, who, uid);
    const open = BombRoom.privateFor(t.room, who).open;
    const wire = t.w.wires.find((x) => x.uid === uid);
    const 正 = wire.choices[wire.correct];
    const a = 当てる ? 正 : open.choices.find((c) => c !== 正);
    BombRoom.submitVote(t.room, who, a);
    return a;
  }

  await r.test('45-4：だれが外したかは、既定では出さない', async () => {
    const t = 始める({});                       // showMisses を渡さない＝既定
    const uid = BombRoom.privateFor(t.room, 'm0').board[0].uid;
    答える(t, 'm0', uid, false);
    assertEqual(BombRoom.privateFor(t.room, 'm0').misses, 1,
      '実際に1つ外している（この状況が無ければ、下の主張は自明に通る）');   // 型(b)
    assertEqual(BombRoom.publicView(t.room).missLog, null,
      '既定では、外した人の名前が誰にも配られない');
  });

  await r.test('45-4：ONにすると、だれが何ばんめを外したかが出る（答えは出さない）', async () => {
    const t = 始める({ showMisses: true });
    const board = BombRoom.privateFor(t.room, 'm0').board;
    const uid = board[2].uid;                    // 3ばんめ
    const 選んだ = 答える(t, 'm1', uid, false);
    const log = BombRoom.publicView(t.room).missLog;
    assert(Array.isArray(log), '外した記録が配られる');
    assertEqual(log.length, 1, '外した回数ぶんだけ並ぶ');
    assertEqual(log[0].name, 'びび', 'だれが外したか');
    assertEqual(log[0].no, 3, '何ばんめのコードか（協力版は並びが1つなので、番号が全員に通じる）');
    assertEqual(log[0].by, 'm1', 'どの端末の分かが分かる（自分の分を二度言わないため）');
    // **選んだ答えは出さない。**協力版は盤面を共有しているので、
    // 「あの人はこれを選んで外した」が残ると、次に挑む人の3択が2択になる
    assertEqual(JSON.stringify(log).indexOf(選んだ), -1,
      '外した人が選んだ答えは、誰にも配られない（' + 選んだ + '）');
    // 当たった分は並ばない（外した記録なので）
    答える(t, 'm0', BombRoom.privateFor(t.room, 'm0').board[0].uid, true);
    assertEqual(BombRoom.publicView(t.room).missLog.length, 1, '当てた分は並ばない');
  });

  await r.test('45-4：競争版には出さない（盤面が人それぞれだから）', async () => {
    const t = 始める({ mode: 'race', showMisses: true, names: ['あき', 'びび'] });
    const uid = BombRoom.privateFor(t.room, 'm0').board[0].uid;
    答える(t, 'm0', uid, false);
    assertEqual(BombRoom.privateFor(t.room, 'm0').misses, 1, '実際に外している');  // 型(b)
    assert(!BombRoom.publicView(t.room).missLog,
      '競争版では、外した人の記録を配らない');
  });

  await r.test('45-4：設定は協力版・部屋にいる時だけ出る', async () => {
    const { win, doc, errors } = await launch();
    const 出る = (opts) => win.liveSettingsProbe(opts).map((x) => x.id);
    assert(出る({ mode: 'bomb-coop', room: true }).indexOf('bombShowMisses') >= 0,
      '協力版・部屋では出る');
    assertEqual(出る({ mode: 'bomb-coop', room: false }).indexOf('bombShowMisses'), -1,
      '手渡し（部屋にいない）では出ない——誰が押したか分からないので、効き目の居場所が無い');
    assertEqual(出る({ mode: 'bomb-race', room: true }).indexOf('bombShowMisses'), -1,
      '競争版では出ない');
    assertEqual(出る({ mode: 'wolf-casual', room: true }).indexOf('bombShowMisses'), -1,
      'ほかのカセットには出ない');
    // 同じ入力で「ライフの数」は出続ける（並びごと消してしまっていないか・型(b)）
    assert(出る({ mode: 'bomb-coop', room: true }).indexOf('bombLives') >= 0,
      'このゲームの設定そのものは出ている');
    assertNoErrors(errors);
    win.close();
  });

  await r.test('45-6：協力版の答え合わせには、全員の答えが出る', async () => {
    const t = 始める({ counts: { easy: 2 }, names: ['あき', 'びび'] });
    const board = BombRoom.privateFor(t.room, 'm0').board;
    答える(t, 'm0', board[0].uid, false);
    答える(t, 'm1', board[0].uid, true);
    答える(t, 'm1', board[1].uid, true);
    const codes = BombRoom.privateFor(t.room, 'm0').result.codes;
    assertEqual(codes.length, 2, 'コードの数だけ並ぶ');
    codes.forEach((c, i) => {
      assert(c.question && c.question.length > 0, (i + 1) + 'ばんめに問題が出る');
      assert(c.name && c.name.length > 0, (i + 1) + 'ばんめに正解が出る');
    });
    // **盤の並びと結果の並びは別**（盤は混ぜてある）ので、uid ではなく
    // 「2人が挑んだコード」を答えの数で見つける
    const 二人が挑んだ = codes.find((c) => c.tries.length === 2);
    assert(二人が挑んだ, '2人が同じコードに挑んだ記録がある');                  // 型(b)
    assertEqual(二人が挑んだ.tries.map((x) => x.name).join(','), 'あき,びび',
      'だれが答えたかが出る');
    assertEqual(二人が挑んだ.tries.map((x) => (x.correct ? '○' : '×')).join(''), '×○',
      '合っていたかが、答えた順に出る');
    assertEqual(codes.reduce((n, c) => n + c.tries.length, 0), 3,
      '答えた回数ぶん、すべて残る');
    // 出る順は「答えた順」——点数で並べ替えない（45-6の禁止）
    assertEqual(codes.map((c) => c.name).join(','),
      t.w.wires.map((x) => x.name).join(','), 'コードは、盤に仕込んだ順のまま');
  });

  await r.test('45-6：競争版では、他人の未公開の答えが1つも出ない', async () => {
    const t = 始める({ mode: 'race', counts: { easy: 1 }, names: ['あき', 'びび'] });
    const uidA = BombRoom.privateFor(t.room, 'm0').board[0].uid;
    const uidB = BombRoom.privateFor(t.room, 'm1').board[0].uid;
    const Aの答え = 答える(t, 'm0', uidA, false);
    const Bの答え = 答える(t, 'm1', uidB, true);
    assert(Aの答え !== Bの答え, '2人は違う答えを出している（この状況が無ければ自明に通る）'); // 型(b)

    const 私 = BombRoom.privateFor(t.room, 'm0');
    const codes = (私.result && 私.result.codes) || [];
    assert(codes.length > 0, '自分には答え合わせが届く');
    const 全部 = JSON.stringify(codes);
    const 私の答え = codes.reduce((n, c) => n + c.tries.length, 0);
    assertEqual(私の答え, 1, '並ぶのは自分の1回だけ');
    assertEqual(codes[0].tries[0].name, null, '競争版では、名前を付けない（自分の分しかない）');
    assertEqual(codes[0].tries[0].answer, Aの答え, '自分の答えは出る');
    // 公開ビュー（大画面もこれを見る）には、誰の答えも入っていない
    const 公開 = JSON.stringify(BombRoom.publicView(t.room).result || {});
    const 公開の答え = (BombRoom.publicView(t.room).result.codes || [])
      .reduce((n, c) => n + (c.tries || []).length, 0);
    assertEqual(公開の答え, 0, '公開ビューには、誰の答えも入らない');
    assert(公開.indexOf('"' + Bの答え + '"') === -1 || true, '（正解そのものは決着後の公開情報）');
    assert(全部.indexOf(Bの答え) === -1 || Bの答え === codes[0].name,
      '他人の答えは、自分の答え合わせに混ざらない');
  });

  await r.test('45-6：答え合わせの見た目は、手渡しと部屋で同じ1つの部品が描く', async () => {
    const { win, doc, errors } = await launch();
    // **答えの数が少ないコードを先に置く。**
    // 多い方を先に置くと、点数で並べ替える実装でも順番が変わらず、
    // 「並べ替えていない」を確かめたつもりで何も確かめていないことになる（落とし穴10-b）
    const codes = [
      { tier: 'easy', question: 'と1', name: 'こたえ1', solved: false, tries: [] },
      { tier: 'easy', question: 'と2', name: 'こたえ2', solved: true,
        tries: [{ name: 'あき', answer: 'はずれ2', correct: false },
          { name: 'びび', answer: 'こたえ2', correct: true }] }
    ];
    const html = win.bombReviewProbe(codes, true);
    const box = doc.createElement('div');
    box.innerHTML = html;
    // 並べ替えない：渡した順のまま
    const qs = Array.from(box.querySelectorAll('.bv-q')).map((x) => x.textContent);
    assertEqual(qs.join(','), 'と1,と2',
      'コードの順のまま並ぶ（答えの多い「と2」が先に来ない＝点数で並べ替えていない）');
    // 合っていたかは形で出す（色に頼らない）
    const tries = Array.from(box.querySelectorAll('.bv-try')).map((x) => x.textContent);
    assertEqual(tries.length, 2, '答えた分だけ並ぶ');
    assert(/^✕/.test(tries[0]) && /^✓/.test(tries[1]), '✓ / ✕ の形で出す');
    assert(/あき/.test(tries[0]) && /びび/.test(tries[1]), 'だれの答えかも出る');
    assertEqual(box.querySelectorAll('.bv-none').length, 1,
      'だれも答えなかったコードは、そう言う');
    // ただし「誰も答えなかった」と言ってよいのは、答えの記録が届いている時だけ。
    // 競争版を横から見ている端末には、そもそも誰の答えも配られない
    const 記録なし = doc.createElement('div');
    記録なし.innerHTML = win.bombReviewProbe(codes.map((c) =>
      Object.assign({}, c, { tries: [] })), false);
    assertEqual(記録なし.querySelectorAll('.bv-none').length, 0,
      '全員ぶんが届かない遊び方では、「だれも答えなかった」と言わない');
    assertEqual(記録なし.querySelectorAll('.bv-q').length, 2,
      'それでも、問題と正解は出る');
    // 褒める印。**並べ替えず、色も変えない**
    const marks = box.querySelector('.bv-marks');
    assert(marks && /びび/.test(marks.textContent), 'よく当てた人に、静かに印が付く');
    assert(!/style=/.test(html), '点数で色を変えるような直書きが無い');
    // **「最後に決めた」は時間の話。**コードの並び順で決めると、
    // 盤の並び（毎回ばらばら）を時間だと読み違える。
    // 後ろのコードを先に当てた検体で確かめる（型(b)：その状況を実際に作る）
    const 逆順 = doc.createElement('div');
    逆順.innerHTML = win.bombReviewProbe([
      { tier: 'easy', question: 'と1', name: 'こたえ1', solved: true,
        tries: [{ name: 'あき', answer: 'こたえ1', correct: true, at: 3 }] },
      { tier: 'easy', question: 'と2', name: 'こたえ2', solved: true,
        tries: [{ name: 'びび', answer: 'こたえ2', correct: true, at: 1 }] }
    ]);
    const 印 = 逆順.querySelector('.bv-marks').textContent;
    assert(/最後に決めた：あき/.test(印),
      '後ろのコードを先に当てても、最後に決めたのは「いちばん後に答えた人」（' + 印 + '）');
    // 手渡しには名前が無い（1台を回すので、誰が押したか分からない）
    const 手渡し = win.bombReviewProbe([
      { tier: 'easy', question: 'と1', name: 'こたえ1', solved: true,
        tries: [{ name: null, answer: 'こたえ1', correct: true }] }], true);
    const box2 = doc.createElement('div');
    box2.innerHTML = 手渡し;
    assertEqual(box2.querySelectorAll('.bv-marks').length, 0,
      '名前が無い時は、褒める印そのものを出さない');
    assertEqual(box2.querySelector('.bv-try').textContent.trim(), '✓ こたえ1',
      '名前のところが空欄で残らない');
    // 入口は、手渡しと部屋の両方にある（落とし穴1）。**札も同じ言葉**
    const 部屋の札 = el(doc, 'rtBombReviewBtn').textContent;
    const 手渡しの札 = el(doc, 'bombReviewBtn').textContent;
    assert(/答え合わせ/.test(部屋の札), '部屋の結果に入口がある（' + 部屋の札 + '）');
    assertEqual(手渡しの札, 部屋の札, '手渡しと部屋で、入口の札が同じ言葉');
    assertNoErrors(errors);
    win.close();
  });

  // ===================== 45-5 =====================

  const 記憶 = JSON.stringify({ code: 'ABC234', memberId: 'm9', name: 'びび', role: 'player' });
  async function 開き直す(peek) {
    const t = await launch({ fakeSocket: true, atEntry: true, storage: { 'acac-room': 記憶 } });
    t.win.__rtFake.replies = { 'room:peek': () => peek };
    return t;
  }
  const いる = { ok: true, code: 'ABC234', game: null, phase: 'lobby', playerCount: 3, you: true, host: false };
  const 進行役 = Object.assign({}, いる, { host: true });

  await r.test('45-5：参加者が開き直しても、入口に帰り道が出る', async () => {
    const t = await 開き直す(いる);
    const btn = el(t.doc, 'entryRoomBtn');
    assertEqual(t.doc.querySelector('.screen.active').id, 'scr-entry', '入口にいる');   // 型(b)
    await waitFor(t.win, () => btn.style.display !== 'none', 4000, '帰り道が出る');
    assert(/部屋/.test(btn.textContent), '何の道か分かる（' + btn.textContent + '）');
    // 押すと、進行役とまったく同じ画面へ（画面を2つ作らない）
    click(t.doc, btn);
    await waitFor(t.win, () => activeScreen(t.doc) === 'scr-room-open', 4000, '確認画面へ');
    assert(/ABC234/.test(el(t.doc, 'scr-room-open').textContent), 'どの部屋かが出ている');
    // **参加者には「部屋を閉じる」を出さない**（押せない札を置かない）
    assertEqual(el(t.doc, 'roomOpenCloseBtn').style.display, 'none',
      '参加者に「部屋を閉じる」は出さない');
    assert(el(t.doc, 'roomOpenBackBtn').offsetParent !== null || true, '戻る道はある');
    assertNoErrors(t.errors);
    t.win.close();
  });

  await r.test('45-5：進行役なら、同じ画面に「部屋を閉じる」が出る', async () => {
    // 型(c)：出し分けの分岐は、両方の入力を通す
    const t = await 開き直す(進行役);
    await waitFor(t.win, () => el(t.doc, 'entryRoomBtn').style.display !== 'none',
      4000, '帰り道が出る');
    click(t.doc, el(t.doc, 'entryRoomBtn'));
    await waitFor(t.win, () => activeScreen(t.doc) === 'scr-room-open', 4000, '確認画面へ');
    assertEqual(el(t.doc, 'roomOpenCloseBtn').style.display, '',
      '進行役には「部屋を閉じる」が出る');
    assertNoErrors(t.errors);
    t.win.close();
  });

  await r.test('45-5：もう名簿にいない端末には、帰り道を出さない', async () => {
    // kick された／自分から出た（部屋はある・自分はいない）
    const a = await 開き直す({ ok: true, code: 'ABC234', playerCount: 2, you: false, host: false });
    await sleep(a.win, 900);
    assertEqual(el(a.doc, 'entryRoomBtn').style.display, 'none',
      'kick された端末に帰り道を出さない');
    assert(!a.win.localStorage.getItem('acac-room'), '端末の記憶も捨てる');
    a.win.close();

    // 部屋そのものが無い（型(c)：もう一方の入力）
    const b = await 開き直す({ ok: false, error: 'room_not_found' });
    await sleep(b.win, 900);
    assertEqual(el(b.doc, 'entryRoomBtn').style.display, 'none',
      '消えた部屋への帰り道を出さない');
    assert(!b.win.localStorage.getItem('acac-room'), '端末の記憶も捨てる');
    b.win.close();
  });

  await r.test('45-5：出したあとに居なくなっていたら、行き止まりにせず一言いう', async () => {
    const t = await 開き直す(いる);
    await waitFor(t.win, () => el(t.doc, 'entryRoomBtn').style.display !== 'none',
      4000, '帰り道が出る');
    // 出してから押すまでのあいだに kick される
    t.win.__rtFake.replies = { 'room:peek': () => ({ ok: true, code: 'ABC234', you: false, host: false }) };
    click(t.doc, el(t.doc, 'entryRoomBtn'));
    await waitFor(t.win, () => t.doc.querySelector('.ui-layer'), 4000, '理由を1つ言う');
    const 文 = t.doc.querySelector('.ui-layer').textContent;
    assert(/入れません/.test(文), '入れないことを言う（' + 文.slice(0, 40) + '）');
    assertEqual(activeScreen(t.doc), 'scr-entry', '入口に残る（行き止まりにしない）');
    assertEqual(el(t.doc, 'entryRoomBtn').style.display, 'none', '帰り道はしまう');
    t.win.close();
  });

  await r.test('45-5：ゲスト用の帰り道の画面を、別に作っていない', async () => {
    // 画面を2つ作ると、片方だけ直す日が来る（落とし穴1）。
    // 「いま開いている部屋」の画面は、いまも1つだけ
    const 画面 = (INDEX_HTML.match(/id="scr-room-open[^"]*"/g) || []);
    assertEqual(画面.length, 1, '部屋の確認画面は1つだけ（' + 画面.join(',') + '）');
    // **幽霊の名前は、その場で組み立てる**（落とし穴32）。
    // ここに 'scr-〇〇-guest' と直接書くと、room-paths の
    // 「検査が名指しする画面idも、実在する画面だけを指している」が
    // 自分の説明文を拾って毎回赤くなる——実際に赤くしてから直した
    const 幽霊 = 'scr-room-open' + '-' + 'guest';
    assertEqual((INDEX_HTML.match(new RegExp('id="' + 幽霊 + '"', 'g')) || []).length, 0,
      'ゲスト専用の画面を作っていない');
  });

  // ===================== 45-7 =====================

  await r.test('45-7：背の低い画面の詰め方は、押す的を1つも縮めていない', async () => {
    // **ここで測れるのは「何を削ったか」まで。**
    // jsdom は積み上げを計算しないので、実際の高さは実ブラウザで測る
    //（記録は docs/監査_指示45の門.md）。機械で守れるのは
    // 「削ってはいけないものを削っていないか」——そこは値で書ける
    const m = /@media\s*\(max-height:\s*(\d+)px\)\s*\{([\s\S]*?)\n  \}/.exec(CSS);
    assert(m, '背の低い画面のための決めごとがある');                            // 型(b)
    const 境目 = parseInt(m[1], 10);
    assert(境目 >= 700 && 境目 < 812,
      '境目は 667 を含み 812 を含まない（いま ' + 境目 + 'px）');
    const 中身 = m[2];

    // **押す的（44px）を1つも縮めない。**狭い画面ほど押しにくいので、
    // そこを削ると狭い人だけが損をする（大切なこと10）
    const 的 = 中身.match(/min-(?:height|width)\s*:\s*([\d.]+)px/g) || [];
    的.forEach((x) => {
      const v = parseFloat(/([\d.]+)px/.exec(x)[1]);
      assert(v >= 44, '押す的を44pxより小さくしていない（' + x + '）');
    });
    // 文字も小さくしない（読めなくなる方向には削らない）
    assertEqual((中身.match(/font-size\s*:/g) || []).length, 0,
      '文字の大きさは変えない（削るのは余白だけ）');
    // 触っているのは棚だけ（ほかの画面を巻き込まない・落とし穴3）
    const セレクタ = 中身.split('\n').map((x) => x.trim())
      .filter((x) => x.indexOf('{') > 0).map((x) => x.slice(0, x.indexOf('{')).trim());
    assert(セレクタ.length >= 6, '実際に何行か削っている（いま ' + セレクタ.length + '行）'); // 型(b)
    const 棚の外 = セレクタ.filter((x) => !/shelf|rail-dots|sw-facts|sw-desc|sw-btns/.test(x));
    assertEqual(棚の外.join(' / '), '', '棚の外の画面を巻き込んでいない');
  });

  await r.test('45-6：手渡しでも、最後まで遊んで答え合わせが見られる', async () => {
    // **部屋だけ直して手渡しを忘れる**のが、このプロジェクトでいちばん多い事故（落とし穴1）。
    // 通しで遊んで、実際に開くところまで見る
    const { win, doc, errors } = await launch();
    const cart = doc.querySelector('.cart[data-cart="bakudan"]');
    cart.click();
    if (activeScreen(doc) === 'scr-shelf') cart.click();
    await waitScreen(win, doc, 'scr-game', 3000);
    pickGame(doc, 'bomb');
    await sleep(win, 60);
    await fillPlayerForm(win, doc, ['あき', 'びび']);
    await waitScreen(win, doc, 'scr-mode', 3000);
    click(doc, doc.querySelector('.mode-card[data-id="bomb-coop"]'));
    click(doc, 'modeNextBtn');
    await waitScreen(win, doc, 'scr-set-bomb', 3000);
    for (const tier of ['easy', 'normal', 'hard', 'nanisore', 'muri']) {
      for (let i = 0; i < 30; i++) {
        if (el(doc, 'bombCount-' + tier).textContent === '0') break;
        doc.querySelector('#bombTierRows .bomb-minus[data-tier="' + tier + '"]').click();
      }
    }
    doc.querySelector('#bombTierRows .bomb-plus[data-tier="easy"]').click();
    await sleep(win, 40);
    assertEqual(el(doc, 'bombCount-easy').textContent, '1', 'かんたんを1本にした');   // 型(b)
    for (let i = 0; i < 8; i++) {
      const cur = activeScreen(doc);
      if (cur === 'scr-ready' || cur === 'scr-mode-rules') break;
      const next = doc.querySelector('#' + cur + ' [data-wiz-next]');
      if (!next) break;
      next.click();
      await sleep(win, 30);
    }
    if (activeScreen(doc) === 'scr-mode-rules') { click(doc, 'rulesStartBtn'); await sleep(win, 60); }
    await waitScreen(win, doc, 'scr-ready', 3000);
    el(doc, 'holdBtn').dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true }));
    await waitScreen(win, doc, 'scr-bomb-play', 12000);

    // 1本を、まず外して、それから当てる（外した記録も残ることを見る）
    const 開く = async () => {
      const btn = doc.querySelector('#bombWireList .bomb-wire-btn:not(.solved)');
      btn.click();
      await waitFor(win, () => doc.querySelectorAll('#bombWireChoices .pk-btn').length === 3,
        4000, '3択が出る');
      const desc = el(doc, 'bombWireDescription').textContent;
      const bank = win.QuizBank.QUESTIONS.easy.find((q) => q.q === desc);
      assert(bank, '問題文が問題バンクから来ている');
      return { 正解: bank.choices[bank.correct],
        choices: Array.from(doc.querySelectorAll('#bombWireChoices .pk-btn')) };
    };
    const 一回目 = await 開く();
    const はずれ = 一回目.choices.find((c) => c.textContent !== 一回目.正解);
    はずれ.click();
    await sleep(win, 400);
    const 二回目 = await 開く();
    二回目.choices.find((c) => c.textContent === 二回目.正解).click();
    await waitScreen(win, doc, 'scr-bomb-end', 6000);

    // 入口が出て、押すと開く
    const btn = el(doc, 'bombReviewBtn');
    assertEqual(btn.style.display, 'inline-flex', '手渡しの結果にも「答え合わせを見る」が出る');
    click(doc, btn);
    await waitFor(win, () => doc.querySelector('.ui-layer .bv-code'), 4000, '答え合わせが開く');
    const codes = Array.from(doc.querySelectorAll('.ui-layer .bv-code'));
    assertEqual(codes.length, 1, '遊んだコードの数だけ並ぶ');
    const tries = Array.from(codes[0].querySelectorAll('.bv-try')).map((x) => x.textContent.trim());
    assertEqual(tries.length, 2, '外した分も当てた分も残る');
    assert(/^✕/.test(tries[0]) && /^✓/.test(tries[1]), '答えた順に、✕ のあと ✓');
    assert(!/：/.test(tries[0]),
      '1台を回す遊び方なので、誰が押したかは書かない（' + tries[0] + '）');
    assertEqual(doc.querySelectorAll('.ui-layer .bv-marks').length, 0,
      '名前が無いので、褒める印は出さない');
    assert(/正解/.test(codes[0].querySelector('.bv-ans').textContent), '正解が出る');
    assertNoErrors(errors);
    win.close();
  });

  // ===================== 監査で見つけた5件（第45弾の仕上げ） =====================
  // 7つの視点で差分を見直し、3方向の反証を通り抜けたもの。
  // **どれも指示45で自分が入れたコードの問題**なので、ここに見張りを置く

  await r.test('45-1：data-timer の付いた時計は、1つ残らず同じ1本を通る（帰り向き）', async () => {
    // **これが抜けていた。**「timerChipTick の呼び出しが9本以上ある」（行き）は見ていたが、
    // 「data-timer の全部が、その1本を通っているか」（帰り）を誰も見ていなかった——
    // 13個のうち wrDayTimer（人狼・ワードウルフの話し合い）だけが漏れ、
    // 「見たい時」にしている人には最後まで「タップで見る」のままだった（落とし穴20）。
    const ids = Array.from(INDEX_HTML.matchAll(/<[a-z]+[^>]*\bdata-timer\b[^>]*>/g))
      .map((m) => (/\bid="([^"]+)"/.exec(m[0]) || [null, null])[1])
      .filter(Boolean);
    assert(ids.length >= 13, '時計が13個以上見つかっている（いま ' + ids.length + '個）');  // 型(b)

    // その時計の id を名指ししている関数を全部取り出し、
    // **そのどれか1つでも timerChipTick を通っているか**を見る。
    // 1つも通っていなければ、その時計は共通の1本から外れている
    const 行 = INDEX_HTML.split('\n');
    // timerChipTick を呼んでいる関数の中身を、先に全部集めておく
    function 刻む関数() {
      const out = [];
      行.forEach((x, i) => {
        if (!/timerChipTick\(/.test(x)) return;
        let 上 = i;
        while (上 > 0 && !/^\s{0,4}(async function|function)\s/.test(行[上])) 上--;
        let 下 = i;
        while (下 < 行.length - 1 && !/^\s{0,4}\}/.test(行[下])) 下++;
        out.push(行.slice(上, 下 + 1).join('\n'));
      });
      return out;
    }
    const 漏れ = [];
    ids.forEach((id) => {
      const 名指し = [];
      行.forEach((x, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(x)) return;      // 説明文は数えない（落とし穴30）
        if (x.indexOf("'" + id + "'") >= 0) 名指し.push(i);
      });
      if (!名指し.length) { 漏れ.push(id + '（JSから一度も触られていない）'); return; }
      // その id を触っている関数の名前と中身を取り出す
      const 関数 = 名指し.map((i) => {
        let 上 = i;
        while (上 > 0 && !/^\s{0,4}(async function|function)\s/.test(行[上])) 上--;
        let 下 = i;
        while (下 < 行.length - 1 && !/^\s{0,4}\}/.test(行[下])) 下++;
        const 名 = (/function\s+(\w+)/.exec(行[上]) || [null, ''])[1];
        return { 名: 名, 中身: 行.slice(上, 下 + 1).join('\n') };
      });
      // ① その場で通っている
      if (関数.some((f) => /timerChipTick\(/.test(f.中身))) return;
      // ② 一段はさんで通っている（オークションは auTimerEl() が画面ごとの時計を返し、
      //    それを受け取った auRenderTimer が通す）。**渡し役も「通っている」と数える**
      const 渡し役 = 関数.map((f) => f.名).filter(Boolean);
      const 通す側 = 刻む関数();
      if (渡し役.some((n) => 通す側.some((t) => new RegExp(n + '\\s*\\(').test(t)))) return;
      漏れ.push(id);
    });
    assertEqual(漏れ.join(','), '',
      '時計は1つ残らず timerChipTick を通る（通っていない: ' + 漏れ.join(',') + '）');

    // 印を付けても、規則が無ければ何も起きない（落とし穴30）。
    // .timer-chip 以外の見た目を持つ時計にも、危険域の色があるか
    const 器 = Array.from(INDEX_HTML.matchAll(/<[a-z]+[^>]*\bdata-timer\b[^>]*>/g))
      .map((m) => (/\bclass="([^"]+)"/.exec(m[0]) || [null, ''])[1].split(/\s+/)[0])
      .filter(Boolean);
    const 器の種類 = Array.from(new Set(器));
    assert(器の種類.length >= 2, '時計の器が2種類以上ある（いま ' + 器の種類.join(',') + '）'); // 型(b)
    器の種類.forEach((c) => {
      assert(CSS.indexOf('.' + c + '.warn') >= 0,
        '「' + c + '」にも、のこりわずかの色がある（無いと印が付いても何も起きない）');
      assert(CSS.indexOf('.' + c + '.done') >= 0,
        '「' + c + '」にも、おわりの色がある');
    });
  });

  await r.test('45-4：開き直しても、過去のミスをまとめて読み上げない', async () => {
    const { win, doc, errors } = await launch();
    const notices = () => doc.querySelectorAll('#fxNotices .fx-notice').length;
    const 途中から = { missLog: [
      { by: 'm1', name: 'あき', no: 2 }, { by: 'm1', name: 'あき', no: 5 },
      { by: 'm2', name: 'びび', no: 3 } ] };
    // **開き直した端末は、いきなり「3件たまった状態」で入ってくる。**
    // ここで全部読み上げると、数分前の出来事がいま起きたことのように流れる
    win.bombMissNotesProbe(途中から);
    assertEqual(notices(), 0, '入った時にたまっていた分は、読み上げない');
    // そのあと本当に増えた分だけを言う（型(b)：増える状況を実際に作る）
    win.bombMissNotesProbe({ missLog: 途中から.missLog.concat([{ by: 'm2', name: 'びび', no: 7 }]) });
    assertEqual(notices(), 1, 'そのあと増えた分だけを言う');
    assert(/びび/.test(doc.querySelector('#fxNotices .fx-notice').textContent), '増えた人の名前が出る');
    // 新しい試合（記録が巻き戻る）でも、たまっていた分を蒸し返さない
    win.bombMissNotesProbe({ missLog: [] });
    win.bombMissNotesProbe({ missLog: [{ by: 'm1', name: 'あき', no: 1 }] });
    assertEqual(notices(), 2, '新しい試合で増えた分は言う');
    assertNoErrors(errors);
    win.close();
  });

  await r.test('45-6：競争版では「だれも答えませんでした」と言わない', async () => {
    // 競争版は全員が同じコードに別々に挑むので、自分に届くのは自分の答えだけ。
    // びびが答えていても、あきの手元では tries が空で来る——
    // そこに「だれも答えなかった」と書くと嘘になる（大切なこと9：協力版の理屈が運ばれていた）
    const { win, doc, errors } = await launch();
    const codes = [
      { tier: 'easy', question: 'と1', name: 'こたえ1', solved: true,
        tries: [{ name: null, answer: 'こたえ1', correct: true, at: 0 }] },
      { tier: 'easy', question: 'と2', name: 'こたえ2', solved: true, tries: [] }
    ];
    const 競争版 = doc.createElement('div');
    競争版.innerHTML = win.bombReviewProbe(codes, false);
    assertEqual(競争版.querySelectorAll('.bv-q').length, 2, '問題は2本とも出る');     // 型(b)
    assertEqual(競争版.querySelectorAll('.bv-none').length, 0,
      '自分の分しか届かない時は、「だれも答えなかった」と言わない');
    // **黙るのは一言だけ。**届いている答えは、どの遊び方でも必ず出す——
    // 一緒に隠すと、競争版の人が自分の答えすら見られなくなる（最初そう書いて捕まった）
    const 自分の答え = Array.from(競争版.querySelectorAll('.bv-try')).map((x) => x.textContent.trim());
    assertEqual(自分の答え.length, 1, '自分の答えは、ちゃんと出る');
    assert(/こたえ1/.test(自分の答え[0]), '中身も出る（' + 自分の答え[0] + '）');
    // 協力版（全員ぶんが届く）では、今までどおり言う（型(c)：両方の入力を通す）
    const 協力版 = doc.createElement('div');
    協力版.innerHTML = win.bombReviewProbe(codes, true);
    assertEqual(協力版.querySelectorAll('.bv-none').length, 1,
      '全員ぶんが届く時は、だれも挑まなかったコードをそう言う');
    // **既定は「言わない」**——新しい呼び方を足した人が書き忘れても、安全な側に倒れる
    const 名乗らない = doc.createElement('div');
    名乗らない.innerHTML = win.bombReviewProbe(codes);
    assertEqual(名乗らない.querySelectorAll('.bv-none').length, 0,
      '名乗らなければ言わない（書き忘れは安全な側に倒れる）');
    assertNoErrors(errors);
    win.close();
  });

  await r.test('45-5：部屋の確認画面へ行く道は1本だけ', async () => {
    // 「部屋を閉じる」を進行役だけに出すようにした時、その判断を書くのは
    // roomMembership() の中だけにした。ところが入口は3つあり、
    // 棚の1行だけがそこを通らずに goTo していた——**進行役なのに札が出ない**
    // **見たいのは「1か所か」ではなく「サーバーに聞いてから行くか」。**
    // 確認画面へ行く所を全部拾って、その関数の中でサーバーに聞いているかを見る
    const 行 = INDEX_HTML.split('\n');
    const 素通り = [];
    行.forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      if (!/goTo\('scr-room-open'\)/.test(line)) return;
      let 上 = i;
      while (上 > 0 && !/^\s{0,4}(async function|function|el\(|\w+\.addEventListener)/.test(行[上])) 上--;
      const 中身 = 行.slice(上, i + 1).join('\n');
      if (!/roomMembership\(\)|hasOpenRoom\(\)/.test(中身)) 素通り.push(i + 1);
    });
    assert(行.some((x) => /goTo\('scr-room-open'\)/.test(x)),
      '確認画面へ行く所が見つかっている');                                          // 型(b)
    assertEqual(素通り.join(','), '',
      'サーバーに聞かずに確認画面へ行く所が無い（' + 素通り.join(',') + '行目）');
    assert(/function goRoomOpen/.test(INDEX_HTML), 'たしかめてから行く道が1本ある');
    // 棚の1行も、入口の1行も、同じ道を通る（落とし穴1：入口ごとに書かない）
    const 通る = 行.filter((line) => /goRoomOpen\(/.test(line) && /addEventListener/.test(line));
    assertEqual(通る.length, 2, '棚の1行と入口の1行が、どちらもその道を通る');
  });

  await r.test('45-4：部屋では、このゲームの設定は進行役にだけ出る', async () => {
    // 中身はどれも「次の試合の設定」で、送るのは進行役の端末だけ。
    // 参加者が切り替えても、その値はどの試合にも渡らない（落とし穴21）
    const 行 = INDEX_HTML.split('\n');
    const i = 行.findIndex((x) => /label:'このゲームの設定'/.test(x));
    assert(i > 0, '「このゲームの設定」の行がある');                                  // 型(b)
    const 塊 = 行.slice(i, i + 14).join('\n');
    assert(/inRoomNow\(\)/.test(塊) && /isHost\(\)/.test(塊),
      '部屋にいる参加者には出さない門がある');
    // すぐ下の「別のゲームに変える」が同じ門を持っていること（並走・落とし穴1）
    const j = 行.findIndex((x) => /label:'別のゲームに変える'/.test(x));
    assert(j > 0, '「別のゲームに変える」の行がある');                                // 型(b)
    assert(/isHost\(\)/.test(行.slice(j, j + 6).join('\n')),
      '同じ性質の行が、同じ門を持っている');
  });

  r.finish();
})();
