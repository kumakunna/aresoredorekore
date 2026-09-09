// tests/dead-style.js — 名乗っているだけのクラスと、もう誰も着られない服（第43弾）
//
// **CSSの取り違えは、どこからもエラーにならない。**
// JSなら未定義の関数を呼べば落ちるが、CSSは
//   ・規則の無いクラスを名乗る → 既定の見た目のまま、黙って出る
//   ・使われない規則を残す     → 名前がぶつかった日に、半分だけ効く（落とし穴23）
// のどちらも静かに通る。全テストが緑のまま、実機で見て初めて分かる。
//
// 実際に2回起きた（どちらも第43弾で本人の指摘・掃引から出た）：
//   ・第41弾⑥で scr-howto を消した時、.howto-card のCSSも一緒に消えたのに、
//     入口と「遊び方の確認」はそのクラスを使い続けていた。
//     **ブラウザ既定の灰色のボタン**として本番に出ていた
//   ・同じ第41弾④で書いた .wiz-title には、そもそも規則が一度も無かった。
//     見出しが本文と同じ大きさで出ていた
//   ・第42弾で4画面を消した時、.ti-item / .tn-slot / .ts-row のCSSが残り、
//     **新しいシートと名前がぶつかって**半分だけ効いていた
//
// **照合には向きがある**（落とし穴20）。片方だけでは、逆から入った事故を素通りする。
//   行き：markup が名乗るクラス → 規則があるか
//   帰り：CSSの規則           → 誰かが着ているか

const fs = require('fs');
const path = require('path');
const { createRunner, assert, assertEqual, cssRules } = require('./harness');

const R = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(R, 'public', 'index.html'), 'utf8');
const CSS = HTML.slice(HTML.indexOf('<style>') + 7, HTML.indexOf('</style>'))
  .replace(/\/\*[\s\S]*?\*\//g, '');
// 画面を組み立てているのは index.html だけではない（共通部品は public/js が組む）
const JS = fs.readdirSync(path.join(R, 'public', 'js'))
  .filter((f) => f.endsWith('.js'))
  .map((f) => fs.readFileSync(path.join(R, 'public', 'js', f), 'utf8')).join('\n');
// **検査が掴むための印も「役目」のうち。**
// 見た目を持たないクラスには2種類ある——JSが選択子として使うものと、
// **検査だけが選択子として使うもの**（`js-` の前置きが付いているのはたいていこれ）。
// tests/ を見ないと、後者を「誰も使っていない」と読んで消してしまう。
//
// 実際に消した：第43弾で `.js-timerview` を「規則も役目も無い」と判断して外したら、
// `tests/fixes36.js` が `doc.querySelectorAll('.js-timerview')` で
// 「設定とウィザードの両方に窓口がある」を数えていた。
// **45スイート目でようやく赤になり、通し運転を1回まるごと使った。**
// **この見張り自身は数に入れない。**
// ここには説明のためにクラス名がいくつも書いてある。
// それを「使っている」と読むと、**自分の説明文が自分の目を塞ぐ**——
// 実際、変異の自己赤チェックが「捕まえられない」に転んだ（落とし穴10-a・自己参照）。
// 見張りの説明は、そのクラスの利用者ではない
const 自分 = path.basename(__filename);
const TESTS = fs.readdirSync(path.join(R, 'tests'))
  .filter((f) => f.endsWith('.js') && f !== 自分)
  .map((f) => fs.readFileSync(path.join(R, 'tests', f), 'utf8')).join('\n');
// **注釈は落とさない。**最初は「説明文の中の .howto-card を『使われている』と
// 読んでしまう」ので落とそうとしたが、`/* … */` を HTML ごと掃くと
// 文字列や正規表現の中の `/*` が偽の注釈の口になり、**本文を40クラスぶん飲み込んだ**
// （帰りの検査に嘘の赤が40件出て気づいた）。
// 代わりに、名指しの照合の側で**行をまたがせない**ようにした（下）
const SRC = HTML.replace(/<style>[\s\S]*?<\/style>/, '') + '\n' + JS + '\n' + TESTS;

/** CSSで規則を持っているクラス名 */
function 規則のあるクラス(css) {
  const out = new Set();
  cssRules(css).forEach((r) => (r.sel.match(/\.[A-Za-z][A-Za-z0-9_-]*/g) || [])
    .forEach((c) => out.add(c.slice(1))));
  return out;
}

/**
 * **手で書いた markup が名乗っているクラス。**
 * JSが組む文字列は含めない——`'t-' + level` のように
 * 名前を継ぎ足す書き方があり、切れ端まで拾うと嘘の赤が出る。
 * 手書きの markup にはその書き方が無いので、ここだけは厳密に照らせる
 */
function markupのクラス(html) {
  const BODY = html.slice(html.indexOf('<body'));
  const MARK = BODY.slice(0, BODY.indexOf('<script'));
  const out = new Map();
  let m;
  const re = /class\s*=\s*["']([^"']+)["']/g;
  while ((m = re.exec(MARK))) {
    const 行 = MARK.slice(0, m.index).split('\n').length;
    m[1].split(/\s+/).forEach((c) => { if (c && !out.has(c)) out.set(c, 行); });
  }
  return out;
}

/**
 * そのクラスを、**JSか検査が**選択子として名指ししているか（見た目を持たない印）。
 * **行をまたがせない**——またぐと、遠くの引用符から始まって
 * 注釈の中の名前まで拾ってしまう
 */
function JSが名指ししている(名, src) {
  return new RegExp('[\'"`][^\'"`\\n]*\\.' + 名.replace(/[-]/g, '\\-') + '\\b').test(src);
}

(async function main() {
  const r = createRunner('dead-style：名乗っているだけのクラス／誰も着ない服（第43弾）');

  await r.test('行き：markup が名乗るクラスには、見た目か役目のどちらかがある', async () => {
    const 規則 = 規則のあるクラス(CSS);
    const 名乗り = markupのクラス(HTML);

    // **数を先に主張する**（型b）。0件なら「全部にある」は自明に成立する
    assert(名乗り.size > 200, 'markup のクラスを集められている（実際:' + 名乗り.size + '件）');
    assert(規則.size > 200, 'CSSの規則を集められている（実際:' + 規則.size + '件）');

    const 裸 = [];
    名乗り.forEach((行, c) => {
      if (規則.has(c)) return;
      // 見た目を持たないクラスは、JSが選択子として使っている印であるはず
      if (JSが名指ししている(c, SRC)) return;
      裸.push('.' + c + '（markup ' + 行 + '行目あたり）');
    });
    assertEqual(裸.join('\n       '), '',
      '規則も役目も無いクラス（名乗っているだけ）');
  });

  await r.test('帰り：CSSの規則は、誰かが着ている', async () => {
    // **逆から見ないと、画面を消した時の取り残しが残る**（落とし穴20）。
    // ただし名前をJSが継ぎ足す書き方（`'fx-flash-' + tone`）があるので、
    // **名前そのもの**が出てこなくても、**頭**が出てくれば着られていると見なす。
    // ここを厳しくすると嘘の赤が100件以上出て、誰も読まなくなる
    const 規則 = 規則のあるクラス(CSS);
    assert(規則.size > 200, 'CSSの規則を集められている（実際:' + 規則.size + '件）');

    const 誰も着ない = [...規則].filter((c) => {
      if (SRC.indexOf(c) >= 0) return false;                          // そのままの名前が出る
      const i = c.lastIndexOf('-');
      if (i > 0 && SRC.indexOf(c.slice(0, i + 1)) >= 0) return false; // 頭が出る（JSが組む）
      return true;
    }).sort();
    assertEqual(誰も着ない.join('・'), '',
      '誰も着ていないCSSクラス（画面を消した時の取り残し）');
  });

  await r.test('この検査が、実際に赤くなることを確かめる（落とし穴10）', async () => {
    // **緑は「違反が無い」か「見えていない」かの区別が付かない。**
    // わざと両方向の違反を混ぜて、それぞれが自分の理由で赤くなることを見る。
    //
    // **検体の名前は、その場で組み立てる**（落とし穴10-a・自己参照）。
    // 検体の名前をこのファイルに**続けて**書くと、
    // 掃引が tests/ も読むようになった日に**自分の検体を拾って**、
    // 「誰も着ていない服」が見つからなくなる——実際にそうなった。
    // 同じ罠を、直前に room-paths の幽霊の見張りでも踏んでいる
    const 印 = 'kore-wa-' + 'dare-mo-shiranai';
    const 服 = 'dare-mo-' + 'kinai-fuku';

    // ── 行き：規則の無いクラスを markup に足す ──
    const 汚1 = HTML.replace('<div class="wiz-body">',
      '<div class="wiz-body ' + 印 + '">');
    assert(汚1 !== HTML, '検体を汚せた（行き）');
    const 裸 = [];
    markupのクラス(汚1).forEach((行, c) => {
      if (規則のあるクラス(CSS).has(c)) return;
      if (JSが名指ししている(c, SRC)) return;
      裸.push(c);
    });
    assertEqual(裸.join('・'), 印, '規則の無いクラスを足すと、行きが赤くなる');

    // ── 帰り：誰も着ない規則をCSSに足す ──
    assertEqual(SRC.indexOf(服), -1, 'その服は、どこにも書かれていない');   // 型(a)対策
    const 汚2 = CSS + '\n  .' + 服 + '{color:red;}\n';
    const 着ない = [...規則のあるクラス(汚2)].filter((c) => {
      if (SRC.indexOf(c) >= 0) return false;
      const i = c.lastIndexOf('-');
      if (i > 0 && SRC.indexOf(c.slice(0, i + 1)) >= 0) return false;
      return true;
    });
    assertEqual(着ない.join('・'), 服, '誰も着ない規則を足すと、帰りが赤くなる');

    // ── 実際に起きた事故そのものを、もう一度起こしてみる ──
    // .howto-card の規則を丸ごと消すと、入口の札が裸になる
    const i = CSS.indexOf('.btn.howto-card{');
    assert(i > 0, '入口の札の規則が実在する');
    const 汚3 = CSS.slice(0, i) + CSS.slice(CSS.indexOf('}', i) + 1)
      .replace(/\.howto-card/g, '.howto-card-KESHITA');
    const 裸3 = [];
    markupのクラス(HTML).forEach((行, c) => {
      if (規則のあるクラス(汚3).has(c)) return;
      if (JSが名指ししている(c, SRC)) return;
      裸3.push(c);
    });
    assertEqual(裸3.join('・'), 'howto-card',
      '第41弾⑥で起きたこと（画面と一緒に見た目が消える）を、この検査は捕まえる');
  });

  r.finish();
})();
