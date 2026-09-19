#!/usr/bin/env node
// tools/dump-list-topics.js — つぎつぎクイズの答えと別名を、人が読める表にする（指示55）
//
// 使い方: node tools/dump-list-topics.js  → docs/つぎつぎクイズの答えと別名.md を作り直す
//
// `tools/dump-ui-text.js` → `docs/文言一覧.md` と同じ形。**現物から作る**ので、
// データを足した日に走らせ直せば台帳が古びない（落とし穴33）。
//
// ---- なぜ要るか ----
// 別名は981件あり、コードの中では読み切れない。
// 「この別名は本当に同じものを指しているか」は**人が読んで決める**しかないので、
// 読める形にして置いておく。

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const Q = require(path.join(ROOT, 'public', 'js', 'quiz-bank.js'));

const KANJI = /[一-鿿々]/;

const L = [];
L.push('# つぎつぎクイズの答えと別名');
L.push('');
L.push('**この表は `node tools/dump-list-topics.js` が作る。**手で直さない——');
L.push('直すのは `public/js/quiz-bank.js` の `LIST_TOPICS` で、走らせ直すとここが揃う。');
L.push('');
L.push('## 形');
L.push('');
L.push('    { topic, tier, answers:[正本…], alias:{ 別名: 正本, … } }');
L.push('');
L.push('- **`answers` は「別々の答えは何か」の正本。**数え方（目標数）がここに依存する');
L.push('- **`alias` は同じ答えの別の言い方。**`answers` に素で足すと、');
L.push('  同じ答えが2回得点する（「札幌市」のあとに「札幌」が通る）');
L.push('- 判定は `judgeListAnswer` が**当たった正本**で重複を見る');
L.push('');
L.push('## なぜ別名が要ったか（指示55の棚卸し）');
L.push('');
L.push('`normalize` はカタカナ／小書き／記号・長音・空白しか吸収せず、**漢字も接尾辞も触らない**。');
L.push('そのため **11お題すべてで「正しいのに弾かれる」**が起きていた。');
L.push('**罰は減点ではなく退場**（`quiz-room.js` の脱落形式）——');
L.push('つまり「リコーダー」と正しく答えた子が、その一言でゲームから外れていた。');
L.push('');

let 総答え = 0, 総別名 = 0;
Q.listTopicsOf().forEach((t) => { 総答え += t.answers.length; 総別名 += Object.keys(t.alias || {}).length; });
L.push('| お題 | 難易度 | 答え | 別名 |');
L.push('|---|---|---|---|');
Q.listTopicsOf().forEach((t) => {
  L.push('| ' + t.topic + ' | ' + t.tier + ' | ' + t.answers.length + ' | ' + Object.keys(t.alias || {}).length + ' |');
});
L.push('| **合計** | | **' + 総答え + '** | **' + 総別名 + '** |');
L.push('');
L.push('---');
L.push('');

Q.listTopicsOf().forEach((t) => {
  const alias = t.alias || {};
  // 正本ごとに、その別の言い方をまとめる（人が読む時はこの向きが自然）
  const 束 = {};
  t.answers.forEach((a) => { 束[a] = []; });
  Object.keys(alias).forEach((k) => { if (束[alias[k]]) 束[alias[k]].push(k); });

  L.push('## ' + t.topic + '（' + t.tier + '・答え ' + t.answers.length + '・別名 ' + Object.keys(alias).length + '）');
  L.push('');
  L.push('| 正本 | 別の言い方 |');
  L.push('|---|---|');
  t.answers.forEach((a) => {
    const 別 = 束[a];
    const 印 = (KANJI.test(a) && !別.some((k) => !KANJI.test(k))) ? ' ⚠️かなで打てない' : '';
    L.push('| ' + a + 印 + ' | ' + (別.length ? 別.join('・') : '—') + ' |');
  });
  L.push('');
});

const out = path.join(ROOT, 'docs', 'つぎつぎクイズの答えと別名.md');
fs.writeFileSync(out, L.join('\n') + '\n');
console.log('書いた: ' + out);
console.log('お題 ' + Q.listTopicsOf().length + ' ／ 答え ' + 総答え + ' ／ 別名 ' + 総別名);
