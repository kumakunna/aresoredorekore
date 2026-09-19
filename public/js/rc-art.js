// rc-art.js — ロシアンカードの絵柄（指示55-①）
//
// ---- なぜ「SVGは地紋と枠だけ・意味はHTMLで重ねる」の二層なのか ----
// ① **インラインSVGの中に絵文字を置くと壊れる。**
//    `public/js/emoji.js` の差し替えが触らないタグは script / style / textarea / title の
//    4つだけで、**SVG の `<text>` が入っていない**。MutationObserver が
//    SVG 名前空間の中に HTML の span を挿し込むので、絵が出ない・崩れる。
// ② **SVG の presentation attribute には `var()` を書けない。**
//    リポジトリ全体に `fill="var(` は1件も無く、既存2例（`.hold-track` / `.sugo-path path`）は
//    どちらも CSS の規則側で色を当てている。属性に書くと**色が効かず、エラーも出ない**。
//
// だから ここが返すのは**地紋と枠だけ**。💣 や「ばくだん」は HTML の子要素として重ねる。
//
// ---- 色に頼らない（指示55-① 2-10・正本 §6） ----
// 4種は、色を全部抜いても**形だけで見分けられる**：
//   裏     … 斜線の地紋がある（裏だけ）
//   表・素 … 無地＋単線
//   爆弾   … 二重線＋四隅の切り欠き
//   セーフ … 単線＋チェック（HTML側）
//
// ---- CS版の差し替え口 ----
// 束（`window.RcArtPack`）があればそちら、無ければ既定に落ちる。
// これは `emoji.js` の `hasFile()`（手元にSVGが無ければ文字のまま返す）と同じ型で、
// **道具として既に検証済みの落ち方**を借りている。
// `<script src>` を2本並べる形にはしない——束の無いビルドで 404 がコンソールに出る。

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(null);
  else root.RcArt = factory(root.RcArtPack);
})(typeof self !== 'undefined' ? self : this, function (PACK) {
  'use strict';

  var KINDS = ['back', 'blank', 'bomb', 'safe'];

  // viewBox は 90×120（3:4）。**xmlns も width も height も書かない**
  //（index.html の既存のインラインSVG4件と同じ慣習）。
  // 装飾なので aria-hidden——意味は HTML 側の文字と aria-label が持つ
  var 既定 = {
    // ① 裏：二重の枠＋45度の斜線6本＋中央の菱形（輪郭だけ）
    back:
      '<svg class="rc-face" viewBox="0 0 90 120" aria-hidden="true">' +
      '<rect class="rc-bg" x="0" y="0" width="90" height="120" rx="10"/>' +
      '<g class="rc-hatch">' +
      '<path d="M-20 40 L40 -20"/><path d="M-20 70 L70 -20"/><path d="M-20 100 L100 -20"/>' +
      '<path d="M-10 130 L110 10"/><path d="M20 130 L110 40"/><path d="M50 130 L110 70"/>' +
      '</g>' +
      '<rect class="rc-edge" x="4" y="4" width="82" height="112" rx="7"/>' +
      '<rect class="rc-edge" x="7" y="7" width="76" height="106" rx="5"/>' +
      '<path class="rc-edge" d="M45 42 L58 60 L45 78 L32 60 Z"/>' +
      '</svg>',
    // ② 表・素：単線・地紋なし（まだ中身が決まっていない表）
    blank:
      '<svg class="rc-face" viewBox="0 0 90 120" aria-hidden="true">' +
      '<rect class="rc-bg is-face" x="0" y="0" width="90" height="120" rx="10"/>' +
      '<rect class="rc-edge" x="5" y="5" width="80" height="110" rx="6"/>' +
      '</svg>',
    // ③ 爆弾：二重線＋四隅の切り欠き（色を抜いても②と見分けられる）
    bomb:
      '<svg class="rc-face" viewBox="0 0 90 120" aria-hidden="true">' +
      '<rect class="rc-bg is-face" x="0" y="0" width="90" height="120" rx="10"/>' +
      '<rect class="rc-edge" x="5" y="5" width="80" height="110" rx="6"/>' +
      '<rect class="rc-edge" x="9" y="9" width="72" height="102" rx="4"/>' +
      '<g class="rc-edge">' +
      '<path d="M5 18 L18 5"/><path d="M72 5 L85 18"/>' +
      '<path d="M5 102 L18 115"/><path d="M72 115 L85 102"/>' +
      '</g>' +
      '</svg>',
    // ④ セーフ：②と同じ単線（中央の ✓ は HTML 側）
    safe:
      '<svg class="rc-face" viewBox="0 0 90 120" aria-hidden="true">' +
      '<rect class="rc-bg is-face" x="0" y="0" width="90" height="120" rx="10"/>' +
      '<rect class="rc-edge" x="5" y="5" width="80" height="110" rx="6"/>' +
      '</svg>'
  };

  /**
   * その種類の絵柄（SVGの文字列）。
   * **束が無ければ既定に落ちる。**空を返さない——空だと、何も無い札が出る
   */
  function face(kind) {
    var k = (KINDS.indexOf(kind) !== -1) ? kind : 'back';
    var p = PACK && PACK[k];
    return (typeof p === 'string' && p) ? p : 既定[k];
  }

  /** 束が入っているか（設定や検査から見るため。**判定を2か所に書かない**） */
  function hasPack() { return !!(PACK && KINDS.some(function (k) { return !!PACK[k]; })); }

  return { KINDS: KINDS, 既定: 既定, face: face, hasPack: hasPack };
});
