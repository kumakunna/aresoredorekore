// tests/press-feedback.js — 押した瞬間の反応（第39弾 2-2・門A10）
//
// **「反応が無いボタン」を1つも残さない。**
// 押したのに何も変わらないと、遊ぶ人は「効いていないのかな」と
// もう一度押す。二重送信の元にもなるし、なにより不安になる。
//
// 見方：`cursor:pointer` が付いている＝押せるつもりの要素。
// そのすべてに、触れた瞬間の見た目の変化（`:active`）があること。
// ただし `<button>` は共通規則（`button:active:not(:disabled)`）で効いているので、
// **タグを見て判定する**——クラス名だけでは、共通規則に乗っているか分からない。

const fs = require('fs');
const path = require('path');
const { createRunner, assert, assertEqual, cssRules } = require('./harness');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
// **コメントを先に落とす。**コメントの中の { } で規則の切り出しがずれると、
// 選択子と中身の対応が狂って、あるはずの :active を見落とす
const CSS = HTML.slice(HTML.indexOf('<style>') + 7, HTML.indexOf('</style>'))
  .replace(/\/\*[\s\S]*?\*\//g, '');

// **画面を組み立てているのは index.html だけではない。**
// 共通部品は ui.js が文字列で組んでいるので、そちらも見ないと
// 「HTMLに見あたらない」と誤って報告する
const SOURCES = [HTML]
  .concat(['ui.js', 'fx.js'].map((f) => {
    const p = path.join(__dirname, '..', 'public', 'js', f);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  }))
  .join('\n');

/** CSSの規則を（選択子, 中身）で拾う。切り出しは harness に1本だけ置いてある */
function rules() { return cssRules(CSS); }

/** そのクラス／idが、実際にどのタグに付いているか（JSが組む分も含めて探す） */
function tagsOf(name, kind) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const attr = (kind === 'id')
    ? 'id=["\']' + esc + '["\']'
    : 'class=["\'][^"\']*\\b' + esc + '\\b';
  const re = new RegExp('<([a-z]+)[^>]*' + attr, 'g');
  const out = new Set();
  let m;
  while ((m = re.exec(SOURCES))) out.add(m[1]);
  return Array.from(out);
}

(async function main() {
  const r = createRunner('press-feedback：押した瞬間の反応（第39弾 門A10）');

  await r.test('押せるものすべてに、触れた瞬間の見た目の反応がある', async () => {
    const all = rules();
    const 押せる = new Set();
    const 反応あり = new Set();

    all.forEach((rule) => {
      rule.sel.split(',').forEach((one) => {
        const s = one.trim();
        if (!s || s.startsWith('/*')) return;
        if (/:active/.test(s)) {
          反応あり.add(s.replace(/:active[\s\S]*$/, '').trim());
        }
      });
      if (/cursor:\s*pointer/.test(rule.body)) {
        rule.sel.split(',').forEach((one) => {
          const s = one.trim();
          if (s && !s.startsWith('/*')) 押せる.add(s);
        });
      }
    });

    assert(押せる.size > 20, '押せるものが集められている（実際:' + 押せる.size + '件）');
    assert(反応あり.size > 5, '反応の指定が集められている（実際:' + 反応あり.size + '件）');  // 型(b)

    const 反応なし = [];
    押せる.forEach((s) => {
      // 疑似クラス・疑似要素を落とした形でも照らす
      const base = s.replace(/::?[a-z-]+(\([^)]*\))?/g, '').trim();
      let ok = false;
      反応あり.forEach((a) => {
        if (a === s || a === base || (base && base.endsWith(a))) ok = true;
      });
      if (ok) return;

      // **タグを見る。**<button> は共通規則で効いている
      const cls = base.match(/\.([a-z][a-z0-9_-]*)$/);
      const id = base.match(/#([A-Za-z][A-Za-z0-9_-]*)$/);
      if (!cls && !id) {
        // 要素そのもの（button など）への指定
        if (/(^|\s)button(\s|$|:)/.test(base)) return;
        反応なし.push(s + '（クラスでもidでもない指定）');
        return;
      }
      const tags = cls ? tagsOf(cls[1], 'class') : tagsOf(id[1], 'id');
      if (tags.length && tags.every((t) => t === 'button')) return;
      反応なし.push(s + ' → ' + (tags.join('/') || '見あたらない'));
    });

    assertEqual(反応なし.join('\n       '), '',
      '押せるのに、触れた瞬間の反応が無いもの');
  });

  await r.test('動きの曲線が、正本の3つ以外に増えていない（門A4）', async () => {
    // 正本4：**切り替えは1つ・見せ場は跳ねてよい。**
    // 最初は「1つだけ」と書いたが、実際には9種類あった。
    // 調べると余分は一度きりの書き捨てで、標準に寄せて差し支えなかった。
    // 残した2つの跳ねは**見せ場のために意図して跳ねさせている**もので、
    // ここまで一律にすると「褒める時は全力で」が平板になる
    const 正本 = [
      'cubic-bezier(.32,.72,0,1)',   // 短・中のすべて
      'cubic-bezier(.2,1.6,.4,1)',   // 見せ場の跳ね（強め）
      'cubic-bezier(.2,1.5,.4,1)'    // 見せ場の跳ね（弱め）
    ];
    const 使われている = Array.from(new Set(
      (CSS.match(/cubic-bezier\([^)]*\)/g) || []).map((s) => s.replace(/\s+/g, ''))
    ));
    assert(使われている.length > 0, '曲線が使われている');  // 型(b)
    const 余分 = 使われている.filter((c) => 正本.indexOf(c) === -1);
    assertEqual(余分.join('・'), '', '正本に無い曲線');
    // 逆向きも見る：正本に書いたのに、どこにも使われていない曲線が無いか（落とし穴20）
    const 使われず = 正本.filter((c) => 使われている.indexOf(c) === -1);
    assertEqual(使われず.join('・'), '', '正本に書いたのに使われていない曲線');
  });

  await r.test('押せないものは、押しても反応しない（見た目でも分かる）', async () => {
    // 押せないのに沈むと「効いた」と誤解する。
    // 逆に、押せないことが見た目で分からないのも困る
    assert(/button:active:not\(:disabled\)/.test(CSS),
      '押せない時は沈まない（:not(:disabled) が付いている）');
    assert(/button:disabled\{[^}]*opacity/.test(CSS),
      '押せないものは、見た目で分かる');
  });

  await r.test('CSSの切り出しが、@media の中の1件目も拾う（第41弾・見落としの再発防止）', async () => {
    // **検査そのものの穴を、検査で塞ぐ。**
    //
    // 3つの検査（ここ・shelf-scroll・ui-kit）が同じ正規表現を各自に持っていて、
    // 中身の群が `[^}]*` だった。これは「{」を許すので
    //   @media X{ .a{…} .b{…} }
    // を「選択子＝@media X／中身＝ .a{… 」の1件に飲み込み、
    // そのあと「@で始まる選択子は捨てる」で **.a が丸ごと消えていた**。
    //
    // 実物で確かめた：.rail の違反を @media の1件目へ移す変異は、
    // 直す前の検査では**緑**、直したあとは**赤**。2件目に置けば直す前でも赤。
    // つまり「1件目だけが見えない」という形（落とし穴10-e の親戚）。
    //
    // ここは実データを見ない。**切り出しそのものに、既知の答えを持つ検体を通す**
    // （落とし穴10-d：実データに名指しで依存しない）
    const 検体 = [
      '.そと{color:red;}',
      '@media (hover:hover){',
      '  .なかの1件目{color:green;}',
      '  .なかの2件目{color:blue;}',
      '}',
      '.あと{color:black;}'
    ].join('\n');
    const 出た = cssRules(検体).map((x) => x.sel);
    assertEqual(出た.join('・'), '.そと・.なかの1件目・.なかの2件目・.あと',
      '@media の内も外も、順番どおり全部拾える');

    // 中身も取り違えていないこと（選択子だけ合っていても意味がない）
    const 先頭 = cssRules(検体).find((x) => x.sel === '.なかの1件目');
    assertEqual((先頭 || {}).body, 'color:green;', '@media の1件目の中身が読める');

    // **逆向き**：@ で始まる包みは規則として数えない（落とし穴20）
    assertEqual(cssRules(検体).filter((x) => x.sel.startsWith('@')).length, 0,
      '@media 自体は規則として数えない');
  });

  r.finish();
})();
