// tools/gen-budoux.js — 文節の切れ目を出す BudouX（Google・Apache-2.0）を、画面で使える1ファイルにする（指示66-1）
//
// **なぜ要るか。**指示66-1「全部の画面の決まり：改行」で、長い文（クイズの問題など）は
// 意味の切れ目（文節）でだけ折る。CSS の `word-break:auto-phrase` は Chrome だけで、
// iPhone の Safari は知らない——文化祭に来るスマホの多くで効かない。
// BudouX は文節の切れ目を返すだけの小さな道具（解析 4.5KB＋日本語の表 23KB）なので、
// それを画面に持たせ、切れ目に <wbr> を入れる（`V2.phrase`）。
//
// **出すもの**：public/js/budoux-ja.js（`window.BudouxJa.parse(文) → 文節の配列`）
// 表（model）は npm の budoux から**そのまま**写し、解析の手順も同じに書く。
// 書き写した解析が本物と同じ答えを返すかを、**本物の budoux（node_modules）と突き合わせて**から書き出す
// （自分の実装の読み戻しだけで済ませない・落とし穴19）。
//
//   npm i -D budoux@0.10.0   （package.json の devDependencies に固定してある）
//   node tools/gen-budoux.js

const fs = require('fs');
const path = require('path');

// budoux は exports で中の道を閉じているので、node_modules の置き場から直に読む
const DIR = path.join(__dirname, '..', 'node_modules', 'budoux');
const pkg = JSON.parse(fs.readFileSync(path.join(DIR, 'package.json'), 'utf8'));
const { Parser } = require(path.join(DIR, 'dist', 'parser.js'));
const { model } = require(path.join(DIR, 'dist', 'data', 'models', 'ja.js'));

// 画面へ持っていく解析（本物の parser.js と同じ手順を、古い端末でも読める書き方で）
function makeParse(M) {
  var keys = ['UW1', 'UW2', 'UW3', 'UW4', 'UW5', 'UW6', 'BW1', 'BW2', 'BW3', 'TW1', 'TW2', 'TW3', 'TW4'];
  var base = 0;
  Object.keys(M).forEach(function (g) { Object.keys(M[g]).forEach(function (k) { base += M[g][k]; }); });
  base = -0.5 * base;
  function get(g, s) { var t = M[g]; return (t && Object.prototype.hasOwnProperty.call(t, s)) ? t[s] : 0; }
  return function parse(s) {
    if (s === '') return [];
    var out = [], start = 0;
    for (var i = 1; i < s.length; i++) {
      var cp = s.codePointAt(i - 1);
      if ((cp || 0) > 0xffff) continue;   // サロゲートの組を割らない
      var score = base;
      score += get('UW1', s.substring(i - 3, i - 2));
      score += get('UW2', s.substring(i - 2, i - 1));
      score += get('UW3', s.substring(i - 1, i));
      score += get('UW4', s.substring(i, i + 1));
      score += get('UW5', s.substring(i + 1, i + 2));
      score += get('UW6', s.substring(i + 2, i + 3));
      score += get('BW1', s.substring(i - 2, i));
      score += get('BW2', s.substring(i - 1, i + 1));
      score += get('BW3', s.substring(i, i + 2));
      score += get('TW1', s.substring(i - 3, i));
      score += get('TW2', s.substring(i - 2, i + 1));
      score += get('TW3', s.substring(i - 1, i + 2));
      score += get('TW4', s.substring(i, i + 3));
      if (score > 0) { out.push(s.slice(start, i)); start = i; }
    }
    out.push(s.slice(start));
    return out;
  };
}

// 突き合わせる文（指示書の例・クイズの問題らしい文・絵文字と英数字の混ざった文）
const SAMPLES = [
  '出題者がお題を、言葉だけで説明する',
  '時間内に全部切れたら、解除成功',
  'コードをえらんで、3択に答える',
  '日本でいちばん高い山は、静岡県と山梨県の境にある富士山です',
  '次の投票の候補からゲームをえらんでください',
  'ニックネームでOK。本名は出さないでね',
  '不適切な言葉の対策のため、入力した名前を1か月記録します',
  '💣 クイズ解除は2〜8人で、約5分です',
  'あいうえおかきくけこさしすせそ',
  ''
];
const real = new Parser(model);
const mine = makeParse(model);
let bad = 0;
for (const s of SAMPLES) {
  const a = JSON.stringify(real.parse(s)), b = JSON.stringify(mine(s));
  if (a !== b) { bad++; console.log('食い違い:', s, '\n  本物:', a, '\n  写し:', b); }
}
if (bad) { console.error('写した解析が本物と違うので、書き出しません'); process.exit(1); }

const out = path.join(__dirname, '..', 'public', 'js', 'budoux-ja.js');
const body = [
  '/* BudouX ' + pkg.version + '（日本語の表）— tools/gen-budoux.js が node_modules/budoux から書き出したもの。手で直さない。',
  ' * Copyright 2021 Google LLC. Licensed under the Apache License, Version 2.0',
  ' * (https://www.apache.org/licenses/LICENSE-2.0). 表（model）は budoux/dist/data/models/ja.js のまま。',
  ' * 使い方：BudouxJa.parse(\'文\') → 文節の配列（つなげると元の文にもどる） */',
  '(function (root) {',
  '  var M = ' + JSON.stringify(model) + ';',
  '  root.BudouxJa = { version: ' + JSON.stringify(pkg.version) + ', parse: (' + makeParse.toString() + ')(M) };',
  '})(typeof window !== \'undefined\' ? window : globalThis);',
  ''
].join('\n');
fs.writeFileSync(out, body);
console.log('書き出しました:', path.relative(process.cwd(), out), (body.length / 1024).toFixed(1) + 'KB', '・突き合わせ', SAMPLES.length, '文 一致');
