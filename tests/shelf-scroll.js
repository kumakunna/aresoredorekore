// tests/shelf-scroll.js — 棚が横にスクロールしなくなるバグ（第41弾 2-9・門D17）
//
// **実測で特定した原因を、CSSの決まりとして固定する。**
// jsdom にはレイアウトが無いので、スクロールそのものは動かせない。
// できるのは「その組み合わせを二度と書かない」ことの見張り。
//
// ── 実測（Chrome・375px幅・2026-09-06）────────────────
//   レールのスクロール余地 396px に対して：
//
//   | 条件                          | 指で送る | 矢印ボタン |
//   |------------------------------|---------|-----------|
//   | いまのまま                     | **0**   | **0**     |
//   | scroll-behavior:smooth を切る  | 396     | **0**     |
//   | scroll-snap-type を none に    | 396     | 194       |
//
//   **根は `scroll-snap-type: x mandatory`。**
//   smooth を外すと指の経路だけ直り、矢印は直らない。
//   矢印は「選択の印だけ動いて棚が動かない」形で、
//   **表示と選択状態がずれる**——遊ぶ人には、押したのに何も起きないように見える。

const fs = require('fs');
const path = require('path');
const { createRunner, assert, assertEqual, cssRules } = require('./harness');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const CSS = HTML.slice(HTML.indexOf('<style>') + 7, HTML.indexOf('</style>'))
  .replace(/\/\*[\s\S]*?\*\//g, '');

/** CSSの規則を（選択子, 中身）で拾う。切り出しは harness に1本だけ置いてある */
function rules() { return cssRules(CSS); }

(async function main() {
  const r = createRunner('shelf-scroll：棚の横スクロール（第41弾 2-9）');

  await r.test('同じ要素に mandatory と smooth を同居させない', async () => {
    // **この2つが同じ要素に付くと、レールが1pxも動かなくなる。**
    // どちらか一方なら動く。実測で確かめた組み合わせ（上の表）。
    const all = rules();
    assert(all.length > 100, 'CSSの規則を拾えている（実際:' + all.length + '件）');  // 型(b)

    const 危ない = all.filter((x) =>
      /scroll-snap-type:\s*[xy]?\s*mandatory/.test(x.body) &&
      /scroll-behavior:\s*smooth/.test(x.body));
    assertEqual(危ない.map((x) => x.sel).join('・'), '',
      'mandatory と smooth が同居している要素');
  });

  await r.test('横に送る帯が、実際にスクロールできる形になっている', async () => {
    // **「動かない」の逆を見る。**
    // 横に送る帯（overflow-x が auto/scroll）が1つ以上あり、
    // そのどれも上の組み合わせを持っていないこと。
    // 帯そのものが消えたら、この検査は数で気づく（型b）
    const 横に送る = rules().filter((x) => /overflow-x:\s*(auto|scroll)/.test(x.body));
    assert(横に送る.length > 0,
      '横に送る帯がある（実際:' + 横に送る.length + '件）');

    const 止まる = 横に送る.filter((x) =>
      /scroll-snap-type:\s*[xy]?\s*mandatory/.test(x.body) &&
      /scroll-behavior:\s*smooth/.test(x.body));
    assertEqual(止まる.map((x) => x.sel).join('・'), '',
      '横に送れなくなる帯');
  });

  r.finish();
})();
