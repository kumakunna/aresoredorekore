// public/img/emoji/ に置いてあるSVGから、一覧ファイルを作り直す。
// 手で書き足すと、ファイルを足した時に更新し忘れる（落とし穴4）。
const fs = require('fs');
const dir = 'public/img/emoji';
const names = fs.readdirSync(dir)
  .filter((f) => f.endsWith('.svg'))
  .map((f) => f.replace(/\.svg$/, ''))
  .sort();
const out = [
  '// emoji-list.js — public/img/emoji/ に置いてあるSVGの一覧（自動生成）',
  '//',
  '// 手で書くと、ファイルを足した時に更新し忘れる。',
  '// 作り直すには: node tools/gen-emoji-list.js',
  '// ここに無い文字は、差し替えずに文字のまま出る（← → ★ ✕ などのUI記号）。',
  '(function (root) {',
  "  var files = " + JSON.stringify(names, null, 0).replace(/","/g, '", "') + ';',
  '  if (typeof module === "object" && module.exports) module.exports = files;',
  '  else if (root.EmojiSvg) root.EmojiSvg.setFiles(files);',
  '}(typeof self !== "undefined" ? self : this));',
  ''
].join('\n');
fs.writeFileSync('public/js/emoji-list.js', out);
console.log('一覧を作った: ' + names.length + ' 個');
