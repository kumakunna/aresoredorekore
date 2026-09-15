// tools/dump-ui-text.js — 画面に出る文言を**全数** docs/文言一覧.md に書き出す（指示49 49-5）
//
// **指示40は「候補だけ読んで校正済み」にしてしまった。**
// 候補を絞る前に、まず全部を1つのファイルに並べる。
// 並べ方は「読む単位」＝**文言の種類**（同じ文が10か所にあっても、読むのは1回）。
// のべ件数も併記して、畳んだことを隠さない。
//
//   node tools/dump-ui-text.js          … docs/文言一覧.md を作る
//   node tools/dump-ui-text.js --count  … 件数だけ出す（着手前の報告用）

const fs = require('fs');
const path = require('path');
const scan = require('./ui-text-scan');

const ROOT = scan.ROOT;

/** 画面idの日本語名を docs/監査_画面一覧.md の表から読む（手書きの一覧は持たない） */
function 画面の名前() {
  const p = path.join(ROOT, 'docs', '監査_画面一覧.md');
  const map = {};
  if (!fs.existsSync(p)) return map;
  fs.readFileSync(p, 'utf8').split('\n').forEach((line) => {
    const m = line.match(/^\|\s*`(scr-[a-zA-Z0-9-]+)`\s*\|\s*([^|]+?)\s*\|/);
    if (m) map[m[1]] = m[2];
  });
  return map;
}

/**
 * JSの文字列に「どの画面のものか」の手がかりを付ける。
 * その文字列を含む関数の中に `scr-xxx` が**ちょうど1つ**出てくる時だけ。
 * **これは手がかりであって権威ではない**ので、表では「≒」を付けて出す。
 */
function 関数から画面の手がかり(text) {
  const 関数 = scan.関数の範囲(text);
  const lines = text.split('\n');
  return 関数.map((f) => {
    const body = lines.slice(f.from - 1, f.to).join('\n');
    const ids = Array.from(new Set((body.match(/scr-[a-zA-Z0-9-]+/g) || [])));
    return { ...f, 画面: ids.length === 1 ? ids[0] : '' };
  });
}

function 集める() {
  const 全部 = scan.画面の文言();
  const 範囲 = scan.画面の範囲();
  const 名前 = 画面の名前();

  // ファイルごとに関数の範囲を1回だけ作る
  const 関数表 = {};
  scan.SOURCES.forEach((s) => { 関数表[s.file] = 関数から画面の手がかり(s.text); });

  全部.forEach((x) => {
    const [file, lineStr] = x.場所.split(':');
    const line = Number(lineStr);
    if (x.層 === 'HTML') {
      const r = 範囲.find((s) => line >= s.from && line <= s.to);
      x.画面 = r ? r.id : '(画面の外)';
      x.場面 = r ? (名前[r.id] || '（名前の記載なし）') : 'HTMLの共通部分';
    } else {
      const f = (関数表[file] || []).find((g) => line >= g.from && line <= g.to);
      x.画面 = f && f.画面 ? '≒' + f.画面 : '—';
      x.場面 = (f ? f.name + '()' : '（関数の外）') + ' … ' + file.replace('public/', '');
    }
  });
  return 全部;
}

/** 同じ文言を1行に畳む。読む単位はこれ */
function 畳む(全部) {
  const map = new Map();
  全部.forEach((x) => {
    if (!map.has(x.t)) map.set(x.t, { t: x.t, 層: new Set(), 画面: new Set(), 場面: new Set(), 場所: [] });
    const e = map.get(x.t);
    e.層.add(x.層); e.画面.add(x.画面); e.場面.add(x.場面); e.場所.push(x.場所);
  });
  return Array.from(map.values());
}

function esc(s) { return String(s).replace(/\|/g, '\\|'); }

function main() {
  const 全部 = 集める();
  const 種類 = 畳む(全部);
  const JS = 全部.filter((x) => x.層 === 'JS').length;
  const HTML = 全部.filter((x) => x.層 === 'HTML').length;

  if (process.argv.includes('--count')) {
    console.log('のべ件数     : ' + 全部.length);
    console.log('  JSの文字列 : ' + JS);
    console.log('  HTMLの地の文: ' + HTML + '  ← 指示40が見落とした層');
    console.log('文言の種類   : ' + 種類.length + '  ← **読む単位**');
    console.log('画面の数     : ' + scan.画面の範囲().length);
    return;
  }

  // 画面ごとに並べる（HTML層）。同じ画面の中は行番号順
  const 画面順 = scan.画面の範囲();
  const out = [];
  out.push('# 文言一覧（画面に出る日本語の全数・指示49 49-5）');
  out.push('');
  out.push('`node tools/dump-ui-text.js` が作る。**手で書き足さない。**');
  out.push('集め方は `tools/ui-text-scan.js`（tests/ui-text.js と同じ実装を呼ぶ）。');
  out.push('');
  out.push('| | 件数 |');
  out.push('|---|---|');
  out.push('| のべ | ' + 全部.length + ' |');
  out.push('| └ JSの文字列 | ' + JS + ' |');
  out.push('| └ HTMLの地の文 | ' + HTML + '（指示40が見落とした層） |');
  out.push('| **文言の種類（読む単位）** | **' + 種類.length + '** |');
  out.push('| 画面の数 | ' + 画面順.length + ' |');
  out.push('');
  out.push('「画面」の列：HTMLの地の文は**その文字が書かれている画面**（`<div class="screen">` の');
  out.push('括弧の対応で決めた）。JSの文字列は、その関数の中に `scr-…` が**ちょうど1つ**');
  out.push('出てくる時だけ `≒` を付けて手がかりとして出す——**権威ではない**。');
  out.push('');
  out.push('---');
  out.push('');
  out.push('## A. HTMLの地の文（画面ごと・' + HTML + '件）');
  out.push('');
  const 名前 = 画面の名前();
  画面順.forEach((s) => {
    const 行 = 全部.filter((x) => x.層 === 'HTML' && x.画面 === s.id);
    if (!行.length) return;
    out.push('### ' + s.id + ' — ' + (名前[s.id] || '（名前の記載なし）') + '（' + 行.length + '件）');
    out.push('');
    out.push('| # | 行 | 文言 |');
    out.push('|---|---|---|');
    行.forEach((x, i) => out.push('| ' + (i + 1) + ' | ' + x.場所.split(':')[1] + ' | ' + esc(x.t) + ' |'));
    out.push('');
  });
  const 外 = 全部.filter((x) => x.層 === 'HTML' && x.画面 === '(画面の外)');
  if (外.length) {
    out.push('### （画面の外＝共通部分・' + 外.length + '件）');
    out.push('');
    out.push('| # | 行 | 文言 |');
    out.push('|---|---|---|');
    外.forEach((x, i) => out.push('| ' + (i + 1) + ' | ' + x.場所.split(':')[1] + ' | ' + esc(x.t) + ' |'));
    out.push('');
  }

  out.push('---');
  out.push('');
  out.push('## B. JSの文字列（ファイル・場面ごと・' + JS + '件）');
  out.push('');
  const files = Array.from(new Set(全部.filter((x) => x.層 === 'JS').map((x) => x.場所.split(':')[0])));
  files.forEach((f) => {
    const 行 = 全部.filter((x) => x.層 === 'JS' && x.場所.split(':')[0] === f);
    out.push('### ' + f + '（' + 行.length + '件）');
    out.push('');
    out.push('| # | 行 | 場面 | 画面 | 文言 |');
    out.push('|---|---|---|---|---|');
    行.forEach((x, i) => out.push('| ' + (i + 1) + ' | ' + x.場所.split(':')[1] + ' | ' +
      esc(x.場面.split(' … ')[0]) + ' | ' + esc(x.画面) + ' | ' + esc(x.t) + ' |'));
    out.push('');
  });

  out.push('---');
  out.push('');
  out.push('## C. 読む台帳（文言の種類・' + 種類.length + '件）');
  out.push('');
  out.push('**ここが読了件数を数える場所。**同じ文が何か所にあっても1行。');
  out.push('');
  out.push('| # | 層 | 画面/場面 | 出る数 | 文言 |');
  out.push('|---|---|---|---|---|');
  種類.sort((a, b) => a.場所[0].localeCompare(b.場所[0], 'en', { numeric: true }));
  種類.forEach((e, i) => {
    const 画面 = Array.from(e.画面).filter((v) => v && v !== '—').slice(0, 2).join('・') || '—';
    const 場面 = Array.from(e.場面)[0].split(' … ')[0];
    out.push('| ' + (i + 1) + ' | ' + Array.from(e.層).join('/') + ' | ' +
      esc(画面 === '—' ? 場面 : 画面) + ' | ' + e.場所.length + ' | ' + esc(e.t) + ' |');
  });
  out.push('');

  const p = path.join(ROOT, 'docs', '文言一覧.md');
  fs.writeFileSync(p, out.join('\n') + '\n', 'utf8');
  console.log('書き出した：docs/文言一覧.md');
  console.log('  のべ ' + 全部.length + '件（JS ' + JS + ' / HTML ' + HTML + '）');
  console.log('  文言の種類 ' + 種類.length + '件 ← 読む単位');
}

module.exports = { 集める, 畳む };
if (require.main === module) main();
