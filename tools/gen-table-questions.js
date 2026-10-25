#!/usr/bin/env node
// tools/gen-table-questions.js — 表から問題を作る（指示68-1 第6項）
//
// question-tables/*.json（表1つに出典1つ）から、2つの形の問題を作って
// public/js/quiz-tables.js に書き出す。手で直さない（直すのは表の方）。
//   ・どっちが上？ … 「AとB、高いのはどっち？」の2択（形は quiz-bank の3択・4択と同じ { q, choices, correct }）
//   ・数字ちかい方 … 「Aの標高は何m？」答えの数と単位（quiz-bank の数字で答える問題の箱と同じ形）
//
// **表を出典で確かめたら、その表から作った問題は1問ずつ確かめ直さなくてよい**（くまくんの決め）。
// だから表には、出典（URL）と「いつ・何を確かめたか」（checked）を必ず書く。無ければここで止まる。
//
// 使い方：
//   node tools/gen-table-questions.js           # 作り直して書き出す
//   node tools/gen-table-questions.js --check   # 書き出した物が表と合っているかだけ見る（tests/quiz-bank.js が使う）
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'question-tables');
const OUT = path.join(ROOT, 'public', 'js', 'quiz-tables.js');
const TIERS = ['easy', 'normal', 'hard'];   // 表から作る問題は、この3つの層だけ（マニアックな層は手で足す）

function readTables() {
  return fs.readdirSync(DIR).filter((f) => /\.json$/.test(f)).sort()
    .map((f) => Object.assign({ file: f }, JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'))));
}

/** 表の形を確かめる。おかしい所を文で返す（空なら通る） */
function problemsOf(t) {
  const out = [];
  const at = t.file + '：';
  if (!t.id || !/^[a-z0-9-]+$/.test(t.id)) out.push(at + 'id は英小文字と数字');
  if (!t.unit) out.push(at + '単位（unit）が無い');
  if (!t.source || !/https?:\/\/\S+/.test(t.source)) out.push(at + '出典（source）に URL が無い');
  if (!t.checked) out.push(at + 'いつ・何を確かめたか（checked）が無い');
  if (!t.ask || !/\{a\}/.test(t.ask.compare || '') || !/\{b\}/.test(t.ask.compare || '')) out.push(at + 'ask.compare に {a} と {b} が要る');
  if (!t.ask || !/\{a\}/.test(t.ask.number || '')) out.push(at + 'ask.number に {a} が要る');
  const rows = t.rows || [];
  if (rows.length < 2) out.push(at + '行が2つ以上要る');
  const names = new Set();
  rows.forEach((r, i) => {
    if (!r.name) out.push(at + (i + 1) + '行目に名前が無い');
    if (names.has(r.name)) out.push(at + '同じ名前が2行：' + r.name);
    names.add(r.name);
    if (typeof r.value !== 'number' || !isFinite(r.value)) out.push(at + r.name + ' の値が数でない');
    if (TIERS.indexOf(r.tier) === -1) out.push(at + r.name + ' の層は ' + TIERS.join('・') + ' のどれか');
  });
  return out;
}

const fill = (s, a, b) => s.replace('{a}', a).replace('{b}', b == null ? '' : b);
const harder = (x, y) => TIERS[Math.max(TIERS.indexOf(x), TIERS.indexOf(y))];

/**
 * 1つの表から問題を作る。
 * どっちが上？は、差が minGap より小さい組を作らない（同じ高さ・ほぼ同じ高さを当てさせない）。
 * 層は2つのうち難しい方。選択肢の並びは出す時に混ぜる（quiz-bank の shuffleChoices）ので、ここでは上を先に置く
 */
function questionsFrom(t) {
  const rows = t.rows;
  const gap = t.minGap || 0;
  const compare = [];
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i], b = rows[j];
      if (Math.abs(a.value - b.value) < Math.max(gap, 1)) continue;
      const top = a.value > b.value ? a : b;
      compare.push({ q: fill(t.ask.compare, a.name, b.name), choices: [top.name, top === a ? b.name : a.name], correct: 0,
        tier: harder(a.tier, b.tier), table: t.id });
    }
  }
  const number = rows.map((r) => ({ q: fill(t.ask.number, r.name), answer: r.value, unit: t.unit, tier: r.tier, table: t.id }));
  return { compare, number };
}

function build() {
  const tables = readTables();
  const bad = [].concat.apply([], tables.map(problemsOf));
  if (bad.length) throw new Error('表がおかしい：\n  ' + bad.join('\n  '));
  const all = { compare: [], number: [] };
  const sources = {};   // 出典は表ごとに1つ。問題は table で引く（quiz-bank が source を貼る）
  tables.forEach((t) => { sources[t.id] = t.source; const q = questionsFrom(t); all.compare.push.apply(all.compare, q.compare); all.number.push.apply(all.number, q.number); });
  const head = '// public/js/quiz-tables.js — 表から作った問題（tools/gen-table-questions.js が書く。手で直さない・直すのは question-tables/ の表）\n' +
    '// 表：' + tables.map((t) => t.file + '（' + t.rows.length + '行）').join('・') + '\n' +
    '// どっちが上？ ' + all.compare.length + '問・数字ちかい方 ' + all.number.length + '問\n';
  const body = '(function (root, data) {\n' +
    "  if (typeof module === 'object' && module.exports) module.exports = data;\n" +
    '  else root.QuizTables = data;\n' +
    "})(typeof self !== 'undefined' ? self : this, {\n" +
    '  sources: ' + JSON.stringify(sources) + ',\n' +
    ['compare', 'number'].map((k) => '  ' + k + ': [\n' + all[k].map((q) => '    ' + JSON.stringify(q)).join(',\n') + '\n  ]').join(',\n') +
    '\n});\n';
  return head + body;
}

if (require.main === module) {
  const text = build();
  if (process.argv.indexOf('--check') !== -1) {
    const now = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') : '';
    if (now !== text) { console.error('public/js/quiz-tables.js が表と合っていません。node tools/gen-table-questions.js で作り直してください'); process.exit(1); }
    console.log('quiz-tables.js は表と合っています');
  } else {
    fs.writeFileSync(OUT, text);
    console.log('書き出しました：' + path.relative(ROOT, OUT) + '（' + text.split('\n')[2].replace('// ', '') + '）');
  }
}

module.exports = { build, problemsOf, questionsFrom, readTables, OUT };
