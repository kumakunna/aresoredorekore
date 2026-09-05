// tests/ui-kit.js — 共通UI部品（public/js/ui.js）の約束（第39弾 2-2）
//
// 部品そのものを、jsdom の上で直に動かして見る。
// 画面に組み込んだ状態は tests/rt-screens.js / smoke.js が見るので、
// ここは**部品として守る約束**だけを見る。

const { JSDOM } = require('jsdom');
const { createRunner, assert, assertEqual } = require('./harness');

function fresh() {
  delete require.cache[require.resolve('../public/js/ui')];
  delete require.cache[require.resolve('../public/js/fx')];
  const Ui = require('../public/js/ui');
  const Fx = require('../public/js/fx');
  const dom = new JSDOM('<!doctype html><div id="app"></div>');
  const doc = dom.window.document;
  // jsdom には closest があるが、Element.prototype.closest は使えるので触らない
  const log = { vibes: [] };
  Fx.init({
    doc, root: doc.getElementById('app'),
    ms: (n) => n,
    vibrate: (p) => log.vibes.push(p)
  });
  Ui.init({ doc, root: doc.getElementById('app'), fx: Fx,
    text: require('../public/js/ui-text').WORDS });
  return { Ui, Fx, dom, doc, log, app: doc.getElementById('app') };
}

const tick = (dom, ms) => new Promise((r) => dom.window.setTimeout(r, ms));
function panel(doc) { return doc.querySelector('.ui-layer .ui-panel'); }
function click(doc, sel) {
  const n = typeof sel === 'string' ? doc.querySelector(sel) : sel;
  if (!n) throw new Error('押すものが無い: ' + sel);
  n.dispatchEvent(new (n.ownerDocument.defaultView.MouseEvent)('click', { bubbles: true }));
}

(async function main() {
  const r = createRunner('ui-kit：共通UI部品（第39弾）');

  await r.test('dialog は3種＋入力の4つで、種類ごとに出るものが違う', async () => {
    const { Ui, doc, dom } = fresh();
    assertEqual(Ui.KINDS.join(','), 'confirm,danger,info,ask', '種類は4つ');

    // confirm：主ボタンと逃げ道の2つ
    Ui.confirm('部屋を閉じますか', 'みんなが終わります');
    await tick(dom, 20);
    assertEqual(doc.querySelectorAll('.ui-panel [data-ui]').length, 2, 'confirm は2つ');
    click(doc, '[data-ui="cancel"]');
    await tick(dom, 320);

    // info：ボタン1つだけ（判断が無いので逃げ道も要らない）
    Ui.info('部屋がなくなっていました');
    await tick(dom, 20);
    assertEqual(doc.querySelectorAll('.ui-panel [data-ui]').length, 1, 'info は1つ');
    assert(!doc.querySelector('[data-ui="cancel"]'), 'info に逃げ道は出ない');
    click(doc, '[data-ui="ok"]');
    await tick(dom, 320);

    // ask：入力欄が出る
    Ui.ask('いくらで出しますか', { value: 3, numeric: true });
    await tick(dom, 20);
    const input = doc.querySelector('.ui-input');
    assert(input, 'ask には入力欄が出る');
    assertEqual(input.value, '3', '初期値が入る');
    assertEqual(input.getAttribute('type'), 'number', '数を聞く時は数の入力欄');
  });

  await r.test('danger だけは、外側を押しても閉じない', async () => {
    // **誤操作で消えると、押していないのか取りやめたのかが本人にも分からない。**
    // 取り返しがつかない操作でそれが起きると、確かめようがない
    const { Ui, doc, dom } = fresh();

    // まず confirm は外側で閉じる（型b：違いが本当に作れているか先に見る）
    let closed = false;
    Ui.confirm('ふつうの確認').then(() => { closed = true; });
    await tick(dom, 20);
    click(doc, '.ui-layer');
    await tick(dom, 320);
    assertEqual(closed, true, 'confirm は外側を押すと閉じる');

    let dangerClosed = false;
    Ui.danger('部屋を解散しますか', 'みんなが終わります').then(() => { dangerClosed = true; });
    await tick(dom, 20);
    click(doc, '.ui-layer');
    await tick(dom, 320);
    assertEqual(dangerClosed, false, 'danger は外側を押しても閉じない');
    assert(doc.querySelector('.ui-dialog-in.is-danger'), 'danger だと分かる印がついている');
  });

  await r.test('ESC でいちばん上の重なりが閉じる（danger は閉じない）', async () => {
    const { Ui, doc, dom } = fresh();
    let v = 'まだ';
    Ui.confirm('確認').then((x) => { v = x; });
    await tick(dom, 20);
    assertEqual(Ui.anyOpen(), true, '開いている');  // 型(b)
    doc.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await tick(dom, 320);
    assertEqual(v, null, 'ESCで閉じて、取りやめとして返る');
    assertEqual(Ui.anyOpen(), false, '重なりが残らない');

    Ui.danger('危ない確認');
    await tick(dom, 20);
    doc.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await tick(dom, 320);
    assertEqual(Ui.anyOpen(), true, 'danger は ESC でも閉じない');
  });

  await r.test('「戻る」は、まず重なりを閉じる（後ろの画面を動かさない）', async () => {
    // 第39弾の着手前は、設定を開いたまま戻るを押すと
    // **設定は開いたまま、後ろの画面だけが動いていた**（scr-mode→scr-shelf を確認）
    const { Ui, doc, dom } = fresh();
    assertEqual(Ui.closeTop(), false, '何も開いていなければ、戻るは重なりに使われない');

    Ui.confirm('確認');
    await tick(dom, 20);
    assertEqual(Ui.closeTop(), true, '開いている時は、戻るが重なりに使われる');
    await tick(dom, 320);
    assertEqual(Ui.anyOpen(), false, '閉じている');
  });

  await r.test('重なりが2つでも、暗幕は二重にならない', async () => {
    const { Ui, doc, dom } = fresh();
    Ui.confirm('1つ目');
    await tick(dom, 20);
    Ui.popup({ title: '2つ目', body: 'せつめい' });
    await tick(dom, 20);
    assertEqual(doc.querySelectorAll('.ui-dim').length, 1, '暗幕は1枚だけ');
    assertEqual(doc.querySelectorAll('.ui-layer').length, 2, '重なりは2つ');
    // 上から順に閉じる
    Ui.closeTop(); await tick(dom, 320);
    assertEqual(doc.querySelectorAll('.ui-dim').length, 1, 'まだ1つ開いているので暗幕は残る');
    Ui.closeTop(); await tick(dom, 320);
    assertEqual(doc.querySelectorAll('.ui-dim').length, 0, '全部閉じたら暗幕も消える');
  });

  await r.test('popup は、アイコンと名前が固定で、本文だけがスクロールする', async () => {
    // 長い説明でも「何の説明を読んでいるか」が上に残り続ける
    const { Ui, doc, dom } = fresh();
    Ui.popup({ icon: '🔍', title: '鑑定眼', body: 'ながい説明'.repeat(50) });
    await tick(dom, 20);
    const head = doc.querySelector('.ui-popup-head');
    const scroll = doc.querySelector('.ui-popup-in .ui-scroll');
    assert(head && scroll, '見出しと本文が分かれている');
    assert(!head.contains(scroll), '本文は見出しの外（見出しは一緒に流れない）');
    assert(head.textContent.indexOf('鑑定眼') >= 0, '名前は見出しに残る');
  });

  await r.test('振動は4つの型からしか鳴らない（種類ごとに違う型）', async () => {
    const { Ui, dom, log } = fresh();
    // danger は開いた瞬間に注意の振動
    Ui.danger('危ない');
    await tick(dom, 20);
    assertEqual(log.vibes[0].join(','), '25,60,25', 'danger を開くと warn');
    Ui.closeTop(); await tick(dom, 320);

    log.vibes.length = 0;
    Ui.confirm('ふつう');
    await tick(dom, 20);
    assertEqual(log.vibes.length, 0, 'confirm を開いても鳴らない');
    click(dom.window.document, '[data-ui="ok"]');
    await tick(dom, 320);
    assertEqual(log.vibes[0].join(','), '30', '決めた時に ok');
  });

  await r.test('toast は判断を求めない（押すものが無い）', async () => {
    const { Ui, doc, dom } = fresh();
    Ui.toast('プレイヤーを更新しました');
    await tick(dom, 20);
    const t = doc.querySelector('.ui-toast');
    assert(t, 'トーストが出る');
    assertEqual(t.querySelectorAll('button').length, 0, '押すものが無い');
    assertEqual(t.getAttribute('role'), 'status', '読み上げにも「知らせ」として伝わる');
    assertEqual(Ui.anyOpen(), false, 'トーストは重なりを積まない（戻るの対象にしない）');
  });

  await r.test('部品はテーマに染まらない（共通トークンで描く）', async () => {
    // **道具は世界の外にある。**（正本 1-3）
    // 着手前の設定パネルは、地だけテーマに追従して文字が置き去りになり
    // 1.11:1（読めない）になっていた
    const fsx = require('fs');
    const pathx = require('path');
    const css = fsx.readFileSync(pathx.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const m = css.match(/\.ui-layer\{([\s\S]*?)\n  \}/);
    assert(m, '.ui-layer の指定がある');
    const body = m[1];
    ['--paper', '--card', '--ink', '--ink-soft', '--line'].forEach((t) => {
      assert(body.indexOf(t + ':') >= 0, t + ' を共通の値に戻している');
    });
    // **地と文字はセットで決める**（片方だけだと着手前の事故が再来する）
    assert(/color:var\(--ink\)/.test(body), '文字色も一緒に決めている');
  });

  await r.test('2-6①：文字サイズの3段階が、役割ごとに実際の値を持っている', async () => {
    // 着手前は --font-scale が1か所でしか使われておらず、
    // font-size の宣言411個はどれも固定pxで、設定を動かしても何も変わらなかった。
    // **役割ごとのトークンが、3段階ぶん定義されているか**を見る
    const fsx = require('fs');
    const pathx = require('path');
    const html = fsx.readFileSync(pathx.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const roles = ['--fs-title', '--fs-body', '--fs-sub', '--fs-btn'];
    const steps = [
      { 名: '標準', re: /:root\{([\s\S]*?)\n  \}/ },
      { 名: '小', re: /:root\.fs-small\{([^}]*)\}/ },
      { 名: '大', re: /:root\.fs-large\{([^}]*)\}/ }
    ];
    const 値 = {};
    steps.forEach((s) => {
      const m = html.match(s.re);
      assert(m, s.名 + ' の指定がある');
      値[s.名] = {};
      roles.forEach((r2) => {
        const v = m[1].match(new RegExp(r2 + ':\s*([0-9.]+)px'));
        assert(v, s.名 + ' に ' + r2 + ' がある');
        値[s.名][r2] = parseFloat(v[1]);
      });
    });
    // **3段階が本当に違う値になっている**（同じ値を3つ並べても「効かない」ままになる）
    roles.forEach((r2) => {
      assert(値.小[r2] < 値.標準[r2], r2 + '：小 < 標準（' + 値.小[r2] + ' < ' + 値.標準[r2] + '）');
      assert(値.標準[r2] < 値.大[r2], r2 + '：標準 < 大（' + 値.標準[r2] + ' < ' + 値.大[r2] + '）');
    });
    // 共有クラスがトークンを使っている（固定pxのままだと設定が効かない）
    const 繋ぐ = [
      ['.scr-title{', '--fs-title'], ['.scr-sub{', '--fs-body'],
      ['.mic-status{', '--fs-sub'], ['.btn{', '--fs-btn']
    ];
    繋ぐ.forEach(([sel, tok]) => {
      const i = html.indexOf(sel);
      assert(i > 0, sel + ' がある');
      const body = html.slice(i, i + 300);
      assert(body.indexOf('var(' + tok + ')') >= 0, sel + ' が ' + tok + ' を使っている');
    });
    // **タグで縛らない。**h2/p 以外で書いた時に黙って効かなくなる（第39弾で踏んだ）
    assert(html.indexOf('h2.scr-title{') === -1, '見出しの指定がタグで縛られていない');
    assert(html.indexOf('p.scr-sub{') === -1, '本文の指定がタグで縛られていない');
  });

  await r.test('2-6③④：浮くものの余白と、道具がテーマに染まらないこと', async () => {
    const fsx = require('fs');
    const pathx = require('path');
    const html = fsx.readFileSync(pathx.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    // ③ 下に浮くものがある時、下部のボタンが上がる
    assert(/\.app\.has-float-bottom \.wiz-foot\{[^}]*padding-bottom/.test(html),
      '浮くものが出ている時、下部のボタンが上がる');
    // **出す側と隠す側を別々に書かない**（第35弾Cの型1）
    assert(/function syncFloatBottom\(\)/.test(html),
      '下に浮くものがあるかを、1か所で数えている');

    // ④ 設定パネルが共通トークンに戻していて、**地と文字をセットで**決めている
    const m = html.match(/\.overlay-panel\{([\s\S]*?)\n  \}/);
    assert(m, '.overlay-panel の指定がある');
    ['--paper', '--card', '--ink', '--ink-soft', '--line'].forEach((t) => {
      assert(m[1].indexOf(t + ':') >= 0, '設定パネルが ' + t + ' を共通の値に戻している');
    });
    assert(/color:var\(--ink\)/.test(m[1]),
      '**文字色も一緒に決めている**（地だけ直すと 1.11:1 の事故が戻る）');
  });

  await r.test('カタログが、全部品・全テーマ・全サイズを取りこぼしていない（正本ループ）', async () => {
    // **崩れのピクセル計測は、ヘッドレスブラウザが無いので手で回すしかない。**
    // 手で回す検査は、時間が経つと誰も回さなくなる——だから
    // 「回した時に、そもそも全部を見ているか」だけは機械で守る。
    //
    // 実際に腐るのはピクセルではなく**網羅**の方：
    // 部品やテーマを足したのにカタログに出ていないと、
    // 18通り回したつもりで、新しいものを1度も見ていないことになる（落とし穴20）
    const fsx = require('fs');
    const pathx = require('path');
    const html = fsx.readFileSync(pathx.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const Ui = require('../public/js/ui');

    // ① 部品：UiKit が名乗ったものが、全部カタログに出ている
    const 出ている = new Set(
      Array.from(html.matchAll(/data-cat="([a-z]+)"/g)).map((m) => m[1])
    );
    // チップだけは押して出すものではないので、置き場所があるかで見る
    if (html.indexOf('id="catChip"') >= 0) 出ている.add('chip');
    const 抜け = Ui.SHOWCASE.filter((k) => !出ている.has(k));
    assertEqual(抜け.join('・'), '', 'カタログに出ていない部品');

    // ② テーマ：カタログの一覧は THEME_CLASSES から導いている（手書きではない）
    assert(/CAT_THEMES\s*=\s*\[\{[^\]]*\}\]\.concat\(\s*Object\.keys\(THEME_CLASSES\)/.test(html),
      'テーマの一覧は THEME_CLASSES から導いている（足したら自動で並ぶ）');

    // ③ サイズ：CSSで定義した段階が、全部カタログで選べる。
    // **段階の名前を決め打ちで探さない。**small/large と書いていた頃は、
    // 新しい段階を足しても「見ていない」ことに気づけなかった（この検査自身の穴）
    // 印の付き先は :root（html）。#app に付けると、その兄弟の重なりに届かない
    const css段階 = Array.from(html.matchAll(/[.:][a-z-]*\.?fs-([a-z]+)\{/g)).map((m) => m[1])
      .filter((s) => s !== 'title' && s !== 'body' && s !== 'sub' && s !== 'btn')
      .filter((s, i, a) => a.indexOf(s) === i);
    assert(css段階.length >= 2, 'CSSに文字サイズの段階がある（実際:' + css段階.join('・') + '）');
    const cat段階 = Array.from(html.matchAll(/data-catsize="([a-z]*)"/g)).map((m) => m[1]);
    css段階.forEach((s) => {
      assert(cat段階.indexOf(s) >= 0, '文字サイズ「' + s + '」がカタログで選べる');
    });
    assert(cat段階.indexOf('') >= 0, '標準もカタログで選べる');
    assertEqual(cat段階.length, css段階.length + 1,
      'カタログのサイズの数と、CSSの段階の数が合っている');

    // ④ 外から回せる入口がある（手で計測する時にここを呼ぶ）
    assert(/window\.catalogSet\s*=/.test(html),
      'catalogSet が外から呼べる（計測はこれで18通りを回す）');
  });

  await r.test('重なりの置き場が、filter の付いた箱の中に無い（第39弾・実測で見つけた）', async () => {
    // **`position:fixed` は「画面に固定」ではない。**
    // 先祖に filter / transform / backdrop-filter が付いていると、
    // そこが基準になり、画面ではなく**ページ**の座標に置かれる。
    //
    // #app は明るさ補正のため `filter:brightness(...)` を常に持っていた。
    // そのため長い画面（設定・記録・カタログ）でダイアログを開くと、
    // 実測で 812px の画面に対して y=1015〜1388——**画面の外**に出て、
    // 遊ぶ人には「押したのに何も出ない」としか見えなかった。
    // socket も状態も正しいので、通信を見るテストでは絶対に捕まらない（落とし穴12）。
    const fs = require('fs');
    const path = require('path');
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const css = html.slice(html.indexOf('<style>') + 7, html.indexOf('</style>'))
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/@keyframes[^{]*\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, '');  // 動きの定義は基準を作らない

    const dom = new JSDOM(html.replace(/<script[\s\S]*?<\/script>/g, ''));
    const d = dom.window.document;
    const root = d.getElementById('uiLayerRoot');
    assert(root, '重なりの置き場（#uiLayerRoot）がある');
    assert(!root.closest('#app'), '置き場は #app の外にある');

    // **基準を作る指定を、全部集めてから照らす。**
    // 「#app だけ見る」にすると、あとで body に filter が足された日に素通りする
    const 基準を作る = [];
    Array.from(css.matchAll(/([^{}]+)\{([^}]*)\}/g)).forEach((m) => {
      const sel = m[1].trim();
      const body = m[2];
      if (!sel || sel.startsWith('@')) return;
      if (/:hover|:active|:focus/.test(sel)) return;   // 押した瞬間だけの指定は、開いている間の基準にならない
      if (!/(^|;|\s)(filter|transform|backdrop-filter|perspective)\s*:/.test(body)) return;
      if (/(^|;|\s)(filter|transform)\s*:\s*none\s*(;|$)/.test(body)) return;
      sel.split(',').forEach((s) => 基準を作る.push(s.trim()));
    });
    assert(基準を作る.length > 5,
      '基準を作りうる指定を集められている（実際:' + 基準を作る.length + '件）');  // 型(b)

    // **読めない指定は、黙って見逃さない。**
    // ここを try/catch で false にしていたせいで、
    // わざと body に filter を足しても素通りした（切り出しに <style> タグが
    // 混ざって、最初の1件が '<style>\n  body' になっていた）
    const 読めない = [];
    const 悪い先祖 = [];
    for (let p = root.parentElement; p; p = p.parentElement) {
      基準を作る.forEach((sel) => {
        let hit = false;
        try { hit = p.matches(sel); } catch (e) { 読めない.push(sel); return; }
        if (hit) 悪い先祖.push((p.id ? '#' + p.id : p.tagName) + ' ← ' + sel);
      });
    }
    assertEqual(Array.from(new Set(読めない)).join('・'), '',
      '読めない選択子（切り出しがずれている合図）');
    assertEqual(Array.from(new Set(悪い先祖)).join('・'), '',
      '置き場の先祖に、fixed の基準を作る指定が付いている');

    // 出す側も、その置き場を使っているか（両方向・落とし穴20）
    assert(/root:\s*el\('uiLayerRoot'\)/.test(html),
      'UiKit が、その置き場を使うように渡されている');
  });

  await r.test('置き場を外に出した副作用：設定が重なりにも届いている', async () => {
    // **箱を外に出すと、その箱に付いていた設定から外れる。**
    // 置き場を #app の外へ移した直後、`.app.fs-*` と `.app.fx-skip` は
    // #app の子孫にしか効かないので、**ダイアログだけ**
    //   ・文字サイズ設定が効かない（報告されていた不具合①の再発）
    //   ・出入りの動きが止まらない（大切なこと7「すべての演出はスキップできる」に反する）
    // という状態になっていた。移す時は、**移した先に何が届かなくなるか**を数える。
    const fs = require('fs');
    const path = require('path');
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const css = html.slice(html.indexOf('<style>') + 7, html.indexOf('</style>'))
      .replace(/\/\*[\s\S]*?\*\//g, '');

    // 重なりに**必ず届かないといけない**設定と、それが使う印
    const 届くべき設定 = [
      { 何: '文字サイズ（小）', 印: 'fs-small', 使う: '--fs-title' },
      { 何: '文字サイズ（大）', 印: 'fs-large', 使う: '--fs-title' },
      { 何: '演出のスキップ', 印: 'fx-skip', 使う: null }
    ];
    const 届かない = [];
    届くべき設定.forEach((x) => {
      // その印を使う指定を集めて、**#app に縛られていないこと**を見る
      const 使用 = Array.from(css.matchAll(new RegExp('([^{}]*\\.' + x.印 + '[^{}]*)\\{', 'g')))
        .map((m) => m[1].trim());
      assert(使用.length > 0, x.何 + ' の指定がある（実際:' + 使用.length + '件）');  // 型(b)
      使用.forEach((sel) => {
        if (/\.app\b/.test(sel)) 届かない.push(x.何 + '：' + sel + ' は #app の中だけ');
      });
      // 印を付けている側も html でなければ意味がない
      const 付ける = new RegExp("classList\\.toggle\\('" + x.印 + "'");
      const m = html.match(new RegExp("(\\w+)\\.classList\\.toggle\\('" + x.印 + "'"));
      assert(m, x.何 + ' の印を付けている場所がある');
      if (!/root|documentElement/i.test(m[1])) {
        届かない.push(x.何 + '：印を ' + m[1] + ' に付けている（html でないと重なりに届かない）');
      }
      assert(付ける.test(html), x.何 + ' の印付けがある');
    });
    assertEqual(届かない.join('\n       '), '', '重なりに届いていない設定');

    // 部品が本当にそのトークンを使っているか（使っていなければ、届いても意味がない）
    const uiCss = css.slice(css.indexOf('.ui-layer{'));
    ['--fs-title', '--fs-body', '--fs-btn', '--fs-sub'].forEach((t) => {
      assert(uiCss.indexOf('var(' + t + ')') >= 0, '部品が ' + t + ' を使っている');
    });
  });

  r.finish();
})();
