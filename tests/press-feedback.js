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
const { createRunner, assert, assertEqual } = require('./harness');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
// **コメントを先に落とす。**コメントの中の { } で規則の切り出しがずれると、
// 選択子と中身の対応が狂って、あるはずの :active を見落とす
const CSS = HTML.slice(HTML.indexOf('<style>'), HTML.indexOf('</style>'))
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

/** CSSの規則を（選択子, 中身）で拾う */
function rules() {
  return Array.from(CSS.matchAll(/([^{}]+)\{([^}]*)\}/g))
    .map((m) => ({ sel: m[1].trim(), body: m[2] }))
    .filter((r) => r.sel && !r.sel.startsWith('@'));
}

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

  await r.test('押せないものは、押しても反応しない（見た目でも分かる）', async () => {
    // 押せないのに沈むと「効いた」と誤解する。
    // 逆に、押せないことが見た目で分からないのも困る
    assert(/button:active:not\(:disabled\)/.test(CSS),
      '押せない時は沈まない（:not(:disabled) が付いている）');
    assert(/button:disabled\{[^}]*opacity/.test(CSS),
      '押せないものは、見た目で分かる');
  });

  r.finish();
})();
