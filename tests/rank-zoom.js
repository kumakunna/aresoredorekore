// tests/rank-zoom.js — 共通部品B（スマホの順位ズーム）の見張り（指示55-①・門T7）
//
// 見張るのは4つ：
//   ① 器（.rk-view）と行の鍵（data-rk-id）が **1か所（rankingHtml）で付く**
//   ② `.rk-row` の持ち時間が **`--fx-scale` に乗っている**
//      （固定値だと3択のうち「速い」だけ何も起きない・正本 §4）
//   ③ `FxKit.flipMove` が **入れ替えを必ず1回だけ**する（スキップでも・動きを減らす設定でも）
//   ④ `FxKit.spotlight` が、引き（倍率1）で **跡を残さない**
//
// **見た目そのものは、ここでは測れない。**
// jsdom にはレイアウトが無いので `offsetTop` も `getBoundingClientRect` も 0 を返す。
// 「本当に上下に動いたか」は門T7（実ブラウザ）でしか見えない——
// ここで守れるのは「落ちない」「スキップで即最終形」「入れ替えが二重に走らない」まで。
// **測れないものを測ったふりにしない**（落とし穴10-f）。

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { createRunner, assert, assertEqual, cssRules } = require('./harness');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const CSS = HTML.slice(HTML.indexOf('<style>') + 7, HTML.indexOf('</style>'))
  .replace(/\/\*[\s\S]*?\*\//g, '');

function freshFx(opt) {
  delete require.cache[require.resolve('../public/js/fx')];
  const Fx = require('../public/js/fx');
  const dom = new JSDOM('<!doctype html><div id="app"></div>');
  Fx.init({
    doc: dom.window.document,
    root: dom.window.document.getElementById('app'),
    ms: (opt && opt.ms) || ((n) => n)
  });
  return { Fx, dom, doc: dom.window.document, app: dom.window.document.getElementById('app') };
}

/** 行を3本持つ、順位表の形の中身を作る */
function 順位表(ids) {
  return '<div class="rk-view"><div class="rk-list">' +
    ids.map((id) => '<div class="rk-row" data-rk-id="' + id + '">' + id + '</div>').join('') +
    '</div></div>';
}

(async function main() {
  const r = createRunner('rank-zoom：スマホの順位ズーム（共通部品B）');

  // ---------- ① 器と鍵は1か所で付く ----------

  await r.test('rankingHtml が、器（.rk-view）と行の鍵（data-rk-id）を自分で付ける', async () => {
    // **呼ぶ側に用意させていないこと**を、実装の文字列で固定する。
    // 9か所のうち片方だけ直す日を作らない（落とし穴1）
    const 本体 = HTML.slice(HTML.indexOf('function rankingHtml'), HTML.indexOf('function putRanking'));
    assert(本体.length > 200, 'rankingHtml の本体を切り出せている（実際:' + 本体.length + '文字）');
    assert(本体.indexOf("'<div class=\"rk-view\"><div class=\"rk-list\">'") !== -1,
      'rankingHtml が .rk-view で包んでいる');
    assert(本体.indexOf('data-rk-id=') !== -1, 'rankingHtml が data-rk-id を付けている');
    // 型(b)：**外に漏れていないこと**も見る。器を呼ぶ側が作っていたら、そこにも文字列が出る
    const 外 = HTML.split('function rankingHtml')[0];
    assertEqual(外.indexOf('class="rk-view"'), -1, '器を作っているのは rankingHtml だけ');
  });

  await r.test('順位表を出す入口が putRanking に寄っている（innerHTML の直書きが残っていない）', async () => {
    // 落とし穴1：入れる瞬間が2通りあると、片方だけ演出が付く
    const 直書き = (HTML.match(/el\('(rtSugoRsRank|auRsRank|qzResult|rtBombResult)'\)\.innerHTML\s*=/g) || []);
    assertEqual(直書き.join(' / '), '',
      'スマホ側の順位表を innerHTML で直に入れている所が残っている');
    // 型(b)：**putRanking が本当に使われているか**を先に数える
    const 使用 = (HTML.match(/putRanking\(/g) || []).length;
    assert(使用 >= 7, 'putRanking が定義1つ＋呼び出し6つ以上ある（実際:' + 使用 + '件）');
  });

  // ---------- ② 持ち時間が --fx-scale に乗っている ----------

  await r.test('.rk-row の持ち時間が --fx-scale に乗っている（「速い」でも効く）', async () => {
    const 規則 = cssRules(CSS).filter((x) => /(^|,)\s*\.rk-row\s*$/.test(x.sel));
    // 型(b)：**その規則が本当に1つ見つかっているか**を先に主張する
    assertEqual(規則.length, 1, '.rk-row の規則がちょうど1つ（実際:' + 規則.length + '件）');
    const 中身 = 規則[0].body;
    assert(/transition:[^;]*transform/.test(中身), '.rk-row が transform の遷移を持っている');
    assert(中身.indexOf('--fx-scale') !== -1,
      '.rk-row の持ち時間が固定値のまま（正本 §4：固定値だと「速い」だけ何も起きない）');
    // 曲線は正本 §4 の3つのうちの「切り替え」だけ（tests/press-feedback.js と同じ線）
    assert(中身.indexOf('cubic-bezier(.32,.72,0,1)') !== -1, '曲線が正本の切り替え用');
  });

  await r.test('巻き取る器（.rk-view）に規則がある（規則の無いクラスを出さない・落とし穴30）', async () => {
    const 規則 = cssRules(CSS).filter((x) => /(^|,)\s*\.rk-view\s*$/.test(x.sel));
    assertEqual(規則.length, 1, '.rk-view の規則がちょうど1つ');
    assert(規則[0].body.indexOf('overflow:hidden') !== -1, '.rk-view が巻き取る');
    // **高さを持たせていないこと。**持たせると、長い順位表が切れる
    assertEqual(/height\s*:/.test(規則[0].body), false,
      '.rk-view が高さを持っている（寄りの最中だけ JS が固定する約束）');
  });

  // ---------- ③ flipMove は、入れ替えを必ず1回だけする ----------

  await r.test('flipMove：ふつうの速さでも、入れ替えはちょうど1回', async () => {
    const t = freshFx();
    t.app.innerHTML = 順位表(['a', 'b', 'c']);
    let 回数 = 0;
    const 入れる = () => { 回数++; t.app.innerHTML = 順位表(['c', 'a', 'b']); };
    await t.Fx.flipMove(t.app, '.rk-row', 'data-rk-id', 入れる, 40);
    assertEqual(回数, 1, '入れ替えは1回だけ');
    assertEqual(t.app.querySelectorAll('.rk-row').length, 3, '行が3本ある');
    assertEqual(t.app.querySelector('.rk-row').getAttribute('data-rk-id'), 'c', '新しい並びになっている');
  });

  await r.test('flipMove：スキップ（ms→0）でも、入れ替えはちょうど1回・即座に最終形', async () => {
    // 落とし穴10-c：分岐の両側を試す
    const t = freshFx({ ms: () => 0 });
    t.app.innerHTML = 順位表(['a', 'b', 'c']);
    let 回数 = 0;
    const 入れる = () => { 回数++; t.app.innerHTML = 順位表(['c', 'a', 'b']); };
    const 飛んだ = await t.Fx.flipMove(t.app, '.rk-row', 'data-rk-id', 入れる, 400);
    assertEqual(回数, 1, '入れ替えは1回だけ');
    assertEqual(飛んだ, true, 'スキップされたと返る');
    assertEqual(t.app.querySelector('.rk-row').getAttribute('data-rk-id'), 'c', '最終形になっている');
    // **跡を残していないこと。**transform が残ると、次の描画で行がずれて出る
    const 残り = Array.from(t.app.querySelectorAll('.rk-row'))
      .filter((el) => el.style.transform).length;
    assertEqual(残り, 0, 'transform の跡が残っている行がある');
  });

  await r.test('flipMove：入れ替えの処理を渡さなければ、何も壊さない', async () => {
    const t = freshFx();
    t.app.innerHTML = 順位表(['a']);
    const 飛んだ = await t.Fx.flipMove(t.app, '.rk-row', 'data-rk-id', null, 40);
    assertEqual(飛んだ, true, '静かに戻る');
    assertEqual(t.app.querySelectorAll('.rk-row').length, 1, '中身はそのまま');
  });

  // ---------- ④ spotlight は、引いたら跡を残さない ----------

  await r.test('spotlight：倍率1（引き）で、中身の transform を空にする', async () => {
    const t = freshFx();
    t.app.innerHTML = 順位表(['a', 'b']);
    const 器 = t.app.querySelector('.rk-view');
    const 中身 = 器.firstElementChild;
    中身.style.transform = 'translateY(-20px) scale(1.25)';   // 寄っている状態を作る
    // 型(b)：**寄っている状態が本当に作れているか**を先に見る
    assert(中身.style.transform.length > 0, '寄っている状態から始めている');
    await t.Fx.spotlight(器, null, { 倍率: 1, ms: 40 });
    assertEqual(中身.style.transform, '', '引ききったら跡を残さない');
  });

  await r.test('spotlight：スキップでも、最終形（引いた状態）になる', async () => {
    const t = freshFx({ ms: () => 0 });
    t.app.innerHTML = 順位表(['a', 'b']);
    const 器 = t.app.querySelector('.rk-view');
    const 中身 = 器.firstElementChild;
    中身.style.transform = 'scale(1.25)';
    assert(中身.style.transform.length > 0, '寄っている状態から始めている');
    await t.Fx.spotlight(器, t.app.querySelector('.rk-row'), { 倍率: 1.25, ms: 400 });
    assertEqual(中身.style.transform, '', 'スキップなら寄らずに最終形');
  });

  await r.test('spotlight：中身の無い箱を渡しても落ちない', async () => {
    const t = freshFx();
    t.app.innerHTML = '<div class="rk-view"></div>';
    const 飛んだ = await t.Fx.spotlight(t.app.querySelector('.rk-view'), null, { 倍率: 1, ms: 40 });
    assertEqual(飛んだ, true, '静かに戻る');
  });

  // ---------- 「動きを減らす」設定（スキップとは別の門） ----------

  await r.test('「動きを減らす」設定の人には、眠っていた動きを起こさない', async () => {
    // **スキップ（.fx-skip の一括停止）とは別の門。**
    // 一度も発火していなかった遷移を起こす以上、ここに乗せないと
    // この設定の人にだけ新しい動きが1つ増える
    delete require.cache[require.resolve('../public/js/fx')];
    const Fx = require('../public/js/fx');
    const dom = new JSDOM('<!doctype html><div id="app"></div>');
    // jsdom の matchMedia は既定で存在しないので、減らす設定の人を作る
    dom.window.matchMedia = (q) => ({ matches: /reduce/.test(q), media: q });
    const doc = dom.window.document;
    Fx.init({ doc, root: doc.getElementById('app'), ms: (n) => n });
    const app = doc.getElementById('app');
    app.innerHTML = 順位表(['a', 'b', 'c']);
    let 回数 = 0;
    const 入れる = () => { 回数++; app.innerHTML = 順位表(['c', 'a', 'b']); };
    const 飛んだ = await Fx.flipMove(app, '.rk-row', 'data-rk-id', 入れる, 400);
    assertEqual(回数, 1, '入れ替えは1回だけ');
    assertEqual(飛んだ, true, '動かさずに最終形にする');
    const 残り = Array.from(app.querySelectorAll('.rk-row')).filter((el) => el.style.transform).length;
    assertEqual(残り, 0, 'transform を1つも当てていない');
  });

  await r.test('「動きを減らす」を切れば、ふつうに動く道を通る（門が片側に効いていないこと）', async () => {
    // 落とし穴10-h：**「起きなかった」は、呼ぶ道があって初めて意味がある。**
    // 減らさない設定でも同じ道を通ることを、1つ測る
    delete require.cache[require.resolve('../public/js/fx')];
    const Fx = require('../public/js/fx');
    const dom = new JSDOM('<!doctype html><div id="app"></div>');
    dom.window.matchMedia = (q) => ({ matches: false, media: q });
    const doc = dom.window.document;
    Fx.init({ doc, root: doc.getElementById('app'), ms: (n) => n });
    const app = doc.getElementById('app');
    app.innerHTML = 順位表(['a', 'b', 'c']);
    const 飛んだ = await Fx.flipMove(app, '.rk-row', 'data-rk-id',
      () => { app.innerHTML = 順位表(['c', 'a', 'b']); }, 20);
    assertEqual(飛んだ, false, '減らさない設定では、待つ道を通っている');
  });

  r.finish();
})();
