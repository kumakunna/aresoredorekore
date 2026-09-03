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

  r.finish();
})();
