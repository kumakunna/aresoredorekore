// tools/fx-src.js — 演出の棚卸し（fx-inventory）と突き合わせ（fx-catalog）が共有する、ソースの読み方（指示62-3）
//
// 「この行は、どの関数の中か」を1か所で決める。2か所に書くと、片方だけ直した日に
// 棚卸しの行と記録の行が別の名前になって、突き合わせが静かに外れる（落とし穴1）。

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8').split(/\r?\n/);
const JS_DIR = path.join(ROOT, 'public', 'js');
const JS = {};
fs.readdirSync(JS_DIR).filter((f) => f.endsWith('.js')).forEach((f) => { JS[f] = fs.readFileSync(path.join(JS_DIR, f), 'utf8').split(/\r?\n/); });

// 包むだけの呼び出し（withAudio(function(ctx){ など）は関数の名前ではない。さらに上へ
const 包むだけ = /^(if|for|while|switch|catch|function|withAudio|setTimeout|setInterval|forEach|map|filter|some|find|then|Promise|requestAnimationFrame|addEventListener|try|return)$/;

/** lines の i 行目（0始まり）を含む、いちばん近い名前付きの関数（字下げで上の階層へたどる） */
function 囲む関数(lines, i) {
  const ind = (s) => (s.match(/^\s*/) || [''])[0].length;
  const myInd = ind(lines[i] || '');
  for (let j = i; j >= 0; j--) {
    const l = lines[j];
    if (ind(l) > myInd) continue;
    const m = l.match(/^\s*(?:async\s+)?function\s+([\w$぀-ヿ一-鿿]+)\s*\(/) ||
      l.match(/^\s*(?:var|let|const)?\s*([\w$.぀-ヿ一-鿿]+)\s*[:=]\s*(?:async\s+)?function\b/) ||
      l.match(/^\s*([\w$぀-ヿ一-鿿]+)\s*\([^)]*\)\s*\{\s*$/);
    if (m && !包むだけ.test(m[1])) return { 名: m[1], 行: j + 1 };
    if (j === i) continue;
    // 知らせの受け口：rt.on('countdown', function…) ／ el('x').addEventListener('click', …)
    const on = l.match(/\b(\w+)\.on\(\s*['"]([\w:]+)['"]\s*,/);
    if (on && ind(l) < myInd) return { 名: on[1] + '.on:' + on[2], 行: j + 1 };
    const ev = l.match(/(?:el|getElementById)\(['"]([\w-]+)['"]\)\.addEventListener\(\s*['"](\w+)/) ||
      l.match(/([\w$.]+)\.addEventListener\(\s*['"](\w+)/);
    if (ev && ind(l) < myInd) return { 名: (/^[\w-]+$/.test(ev[1]) && l.indexOf("('" + ev[1] + "')") !== -1 ? '#' : '') + ev[1] + ':' + ev[2], 行: j + 1 };
  }
  return { 名: '(地)', 行: 0 };
}

/** index.html の行番号（1始まり）から、囲む関数の名前 */
function 名前(file, 行) {
  const lines = file === 'index' || file === 'index.html' ? HTML : JS[file];
  if (!lines) return '?';
  return 囲む関数(lines, 行 - 1).名;
}

module.exports = { ROOT, HTML, JS, 囲む関数, 名前 };
