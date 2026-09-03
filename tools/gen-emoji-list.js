// public/img/emoji/ に置いてあるSVGから、一覧ファイルを作り直す。
// 手で書き足すと、ファイルを足した時に更新し忘れる（落とし穴4）。
//
//   node tools/gen-emoji-list.js          … 一覧を作り直し、足りないものを知らせる
//   node tools/gen-emoji-list.js --fetch  … 足りないものを取ってきてから作り直す
//
// 第32弾-C：新しい絵文字を使うたびに、SVGの置き忘れで通し検証が止まった（3回）。
// テストが見つけてはくれるが、20分待ってから気づくのは遅い。
// 「いま何が足りないか」をその場で言い、頼めば取ってくるところまでやる。
const fs = require('fs');
const path = require('path');
const https = require('https');

const DIR = 'public/img/emoji';
// Twemoji（CC-BY 4.0）。docs/絵文字とアイコン.md に選んだ理由が書いてある
const CDN = 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/svg/';
// アプリの中で「画面に出す絵文字」を書いている場所。増えたらここに足す。
//
// 第36弾のメモ：一度 public/js を丸ごと見る形にしてみたが、広すぎて駄目だった。
// ロジックのファイルには「画面に出さない絵文字」も混ざっていて（クイズの選択肢に
// 使われる数字のキーキャップなど）、Twemojiに同じ名前で置かれていないものを
// 取りに行ってツールごと落ちる。**画面に出すものを、意識して並べる**のが正しい。
const SOURCES = [
  'public/index.html',
  'public/js/titles.js',
  // 第36弾：すごろくのマスの絵文字（CELL_KINDS）と、突然イベントの絵文字
  'public/js/sugoroku-logic.js',
  // 第38弾：ここは tests/shelf.js にもう一つ手書きの一覧があって、
  // そちらの方が広かった。ツールが狭いと「足りない」と言われないまま素通りする
  // （相場オークションの 🏺 が実際にそうなった）。**この一覧を正本にする**
  'public/js/defuse-logic.js',
  'public/js/auction-items.js',
  'public/js/auction-logic.js',
  'public/js/quiz-logic.js'
];
// 絵文字にしないもの。UIの部品として文字で出ているのが正しく、Twemojiにも無い
// （2713 ✓ は第32弾-D 第4部・安全の案内のチェック印）
// 第36弾：すごろくの駒（♥ ♣）も足した。★ ✚ と同じ「形で見分けるための記号」で、
// 絵になってしまうと、盤の上で駒として読めなくなる
const NOT_EMOJI = ['2605', '2715', '2190', '2192', '271a', '2713', '2663', '2665'];

function listFiles() {
  return fs.readdirSync(DIR)
    .filter((f) => f.endsWith('.svg'))
    .map((f) => f.replace(/\.svg$/, ''))
    .sort();
}

function writeList(names) {
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
}

// アプリで使っている絵文字のうち、SVGが手元に無いものを挙げる
function findMissing(have) {
  const EmojiSvg = require('../public/js/emoji.js');
  const known = {};
  have.forEach((n) => { known[n] = true; });
  const missing = {};
  SOURCES.forEach((src) => {
    if (!fs.existsSync(src)) return;
    const found = EmojiSvg.collect(fs.readFileSync(src, 'utf8'));
    Object.keys(found).forEach((ch) => {
      const name = found[ch];
      if (known[name] || NOT_EMOJI.indexOf(name) !== -1) return;
      missing[name] = ch;
    });
  });
  return missing;
}

function fetchOne(name) {
  return new Promise((resolve, reject) => {
    https.get(CDN + name + '.svg', (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(name + ' が取れませんでした（HTTP ' + res.statusCode + '）'));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        fs.writeFileSync(path.join(DIR, name + '.svg'), Buffer.concat(chunks));
        resolve(name);
      });
    }).on('error', reject);
  });
}

// テスト（tests/shelf.js）が同じ一覧を使えるように外に出す。
// 手書きの一覧が2つあると、片方だけ広くなって取りこぼす
module.exports = { SOURCES, NOT_EMOJI, findMissing, listFiles };

if (require.main !== module) return;

(async function main() {
  const wantFetch = process.argv.indexOf('--fetch') !== -1;
  let have = listFiles();
  let missing = findMissing(have);
  let names = Object.keys(missing);

  if (names.length && wantFetch) {
    for (const name of names) {
      await fetchOne(name);
      console.log('取ってきた: ' + missing[name] + ' (' + name + ')');
    }
    have = listFiles();
    missing = findMissing(have);
    names = Object.keys(missing);
  }

  writeList(have);
  console.log('一覧を作った: ' + have.length + ' 個');

  if (names.length) {
    console.log('');
    console.log('⚠️ SVGが足りない絵文字があります:');
    names.forEach((n) => console.log('   ' + missing[n] + '  (' + n + '.svg)'));
    console.log('');
    console.log('   取ってくる: node tools/gen-emoji-list.js --fetch');
    console.log('   文字のまま出したい記号なら、このファイルの NOT_EMOJI に足してください');
    process.exit(1);
  }
})();
