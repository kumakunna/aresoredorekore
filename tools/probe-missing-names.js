#!/usr/bin/env node
// tools/probe-missing-names.js — 「実在すると思い込んで呼んでいる名前」を掃き出す（指示53）
//
// **なぜ要るか。**指示53で `esc()` を7か所書いた。実在するのは `escapeHtml()` で、
// `esc` はどこにも無い。**全テストは緑のまま**だった——
// 部屋の描画関数は、実サーバーでその段階に入った時にしか走らないから。
// 実際に出たのは、本物のサーバーで4人そろえて「ケースが開く」まで来た瞬間で、
// 同じ形がもう1つ（`rtIsHost`）、まだ走っていない結果発表の中に潜んでいた。
//
// JSは「名前があって中身が無い」を、**その行が走るまで黙っている**（落とし穴30のJS版）。
// CSSは何も言わないが、JSも呼ばれるまでは何も言わない。
//
// 使い方：  node tools/probe-missing-names.js
//
const fs = require('fs');
const h = fs.readFileSync('public/index.html', 'utf8');

// 私が足したかたまりを、コメントの目印で切り出す
const 範囲 = [];
const marks = [
  ['指示53：False or True（部屋・1人1台）の画面', 'var auClock ='],
  ['指示53：False or True の帯', 'NOW_LINE.auction ='],
  ['指示53：False or True の押しもの', "el('rtEndBtn').addEventListener"],
  ['大画面（指示53 2-9）', 'function renderRtBigSugoroku'],
  ['指示53：False or True の設定（話し合いの長さ）', 'function renderSugorokuStep'],
];
for (const [from, to] of marks) {
  const a = h.indexOf(from);
  if (a < 0) { console.log('!! 目印が見つからない:', from); continue; }
  const b = h.indexOf(to, a);
  範囲.push(h.slice(a, b < 0 ? a + 8000 : b));
}
const mine = 範囲.join('\n');
console.log('切り出した行数:', mine.split('\n').length);

// 呼んでいる識別子を集める（`名前(` の形）
const 呼び出し = [...new Set([...mine.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)].map(m => m[1]))];
// JS 組み込み・自前で定義しているものは除く
const 組み込み = new Set(['function', 'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof',
  'Math', 'Object', 'Array', 'String', 'Number', 'Date', 'JSON', 'Promise', 'parseInt', 'parseFloat',
  'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'isNaN', 'Boolean']);
const 自前 = new Set([...mine.matchAll(/function\s+([A-Za-z_$][\w$]*)/g)].map(m => m[1]));

const 足りない = [];
for (const name of 呼び出し) {
  if (組み込み.has(name) || 自前.has(name)) continue;
  const 定義あり =
    new RegExp('function\\s+' + name + '\\s*\\(').test(h) ||
    new RegExp('(var|let|const)\\s+' + name + '\\s*=').test(h) ||
    new RegExp('\\b' + name + '\\s*=\\s*function').test(h);
  if (!定義あり) 足りない.push(name);
}
console.log('呼んでいる外の名前:', 呼び出し.filter(n => !組み込み.has(n) && !自前.has(n)).join(' '));
console.log(足りない.length ? '❌ 実在しない: ' + 足りない.join(' ') : '✅ 呼んでいる関数は全部実在する');

// 使っている要素idが、markup に実在するか
const ids = [...new Set([...mine.matchAll(/el\('([A-Za-z][\w-]*)'\)/g)].map(m => m[1]))];
const idなし = ids.filter(id => !h.includes('id="' + id + '"'));
console.log('使っている要素id:', ids.length, '個');
console.log(idなし.length ? '❌ markup に無いid: ' + idなし.join(' ') : '✅ 使っている要素idは全部 markup にある');

// CSS変数
const vars = [...new Set([...mine.matchAll(/var\(--([\w-]+)\)/g)].map(m => m[1]))];
console.log('CSS変数:', vars.join(' ') || '（なし）');
