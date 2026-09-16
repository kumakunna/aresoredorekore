// tools/dump-ui-text.js — 画面に出る文言を**全数** docs/文言一覧.md に書き出す（指示49 49-5）
//
// **指示40は「候補だけ読んで校正済み」にしてしまった。**
// 候補を絞る前に、まず全部を1つのファイルに並べる。
// 並べ方は「読む単位」＝**文言の種類**（同じ文が10か所にあっても、読むのは1回）。
// のべ件数も併記して、畳んだことを隠さない。
//
//   node tools/dump-ui-text.js          … docs/文言一覧.md を作る
//   node tools/dump-ui-text.js --count  … 件数だけ出す（報告用）

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
    return Object.assign({}, f, { 画面: ids.length === 1 ? ids[0] : '' });
  });
}

function 集める() {
  const 全部 = scan.画面の文言();
  const 範囲 = scan.画面の範囲();
  const 名前 = 画面の名前();

  const 関数表 = {};
  scan.SOURCES.concat(scan.SERVER_SOURCES).forEach((s) => {
    関数表[s.file] = 関数から画面の手がかり(s.text);
  });

  全部.forEach((x) => {
    const file = x.場所.slice(0, x.場所.lastIndexOf(':'));
    const line = Number(x.場所.slice(x.場所.lastIndexOf(':') + 1));
    if (x.層 === 'HTML' || x.層 === '属性' || x.層 === 'CSS') {
      const r = 範囲.find((s) => line >= s.from && line <= s.to);
      x.画面 = r ? r.id : '(画面の外)';
      x.場面 = r ? (名前[r.id] || '（名前の記載なし）')
        : (x.層 === 'CSS' ? 'CSSの content' : 'HTMLの共通部分');
    } else {
      const f = (関数表[file] || []).find((g) => line >= g.from && line <= g.to);
      x.画面 = f && f.画面 ? '≒' + f.画面 : '—';
      x.場面 = (f ? f.name + '()' : '（関数の外）');
    }
  });
  return 全部;
}

/** 同じ文言を1行に畳む。読む単位はこれ */
function 畳む(全部) {
  const map = new Map();
  全部.forEach((x) => {
    if (!map.has(x.t)) {
      map.set(x.t, { t: x.t, 層: new Set(), 画面: new Set(), 場面: new Set(), 場所: [], 対象外: x.対象外 || '' });
    }
    const e = map.get(x.t);
    e.層.add(x.層); e.画面.add(x.画面); e.場面.add(x.場面); e.場所.push(x.場所);
    if (!x.対象外) e.対象外 = '';   // 1か所でも対象なら、対象として読む
  });
  return Array.from(map.values());
}

function esc(s) { return String(s).replace(/\|/g, '\\|').replace(/\n/g, '⏎'); }
function 種類数(a) { return new Set(a.map((x) => x.t)).size; }

function main() {
  const 全部 = 集める();
  const 種類 = 畳む(全部);
  const 対象 = 全部.filter((x) => !x.対象外);
  const 対象種 = 種類.filter((x) => !x.対象外);
  const 層別 = {};
  全部.forEach((x) => { 層別[x.層] = (層別[x.層] || 0) + 1; });

  if (process.argv.includes('--count')) {
    scan.LAYERS.forEach((l) => console.log('  ' + l.id.padEnd(6) +
      String(層別[l.id] || 0).padStart(6) + '   ' + l.説明));
    console.log('  のべ合計   : ' + 全部.length);
    console.log('  種類       : ' + 種類.length);
    console.log('  対象外     : のべ' + (全部.length - 対象.length) + ' / 種類' + (種類.length - 対象種.length));
    console.log('  **読む単位**: ' + 対象種.length + '件（のべ ' + 対象.length + '）');
    return;
  }

  const 画面順 = scan.画面の範囲();
  const 名前 = 画面の名前();
  const o = [];
  o.push('# 文言一覧（画面に出る日本語の全数・指示49 49-5）');
  o.push('');
  o.push('`node tools/dump-ui-text.js` が作る。**手で書き足さない。**');
  o.push('集め方は `tools/ui-text-scan.js`（`tests/ui-text.js` と同じ実装を呼ぶ）。');
  o.push('');
  o.push('## 層ごとの件数');
  o.push('');
  o.push('**「0件」と「その層を見ていなかった」を分けるために、層ごとに数える。**');
  o.push('第40弾はHTMLの地の文を一度も見ずに「全角数字0件」で緑だった。');
  o.push('指示49の着手前で、同じ形の漏れがさらに3つ見つかっている。');
  o.push('');
  o.push('| 層 | のべ | 中身 |');
  o.push('|---|---|---|');
  scan.LAYERS.forEach((l) => o.push('| ' + l.id + ' | ' + (層別[l.id] || 0) + ' | ' + l.説明 + ' |'));
  o.push('| **合計** | **' + 全部.length + '** | 種類 ' + 種類.length + ' |');
  o.push('');
  o.push('| | のべ | 種類 |');
  o.push('|---|---|---|');
  o.push('| 全部 | ' + 全部.length + ' | ' + 種類.length + ' |');
  o.push('| 対象外（お題データ） | ' + (全部.length - 対象.length) + ' | ' + (種類.length - 対象種.length) + ' |');
  o.push('| **校正の対象（読む単位）** | **' + 対象.length + '** | **' + 対象種.length + '** |');
  o.push('');
  o.push('お題データ（`QUIZ_BANK`）は**数えるが、49-5 のトーン校正の対象にはしない**。');
  o.push('性質が「UIの文言」ではなく「お題のデータ」で、軸が別だから（指示49での裁定）。');
  o.push('誤字の点検は `docs/切り出した宿題.md` に別件として置いた。');
  o.push('**「見ていない」のではなく「対象外と決めた」**——この2つは必ず分ける。');
  o.push('');
  o.push('「画面」の列：HTML・属性・CSS は**その文字が書かれている画面**');
  o.push('（`<div class="screen">` の括弧の対応で決めた）。');
  o.push('JS・SRV は、その関数の中に `scr-…` が**ちょうど1つ**出てくる時だけ `≒` を付けた手がかり。');
  o.push('**権威ではない。**');
  o.push('');
  o.push('---');
  o.push('');

  // ---- A：画面ごと（HTML・属性・CSS） ----
  const 画面層 = 全部.filter((x) => ['HTML', '属性', 'CSS'].indexOf(x.層) >= 0);
  o.push('## A. 画面に書かれている文字（' + 画面層.length + '件）');
  o.push('');
  画面順.forEach((s) => {
    const 行 = 画面層.filter((x) => x.画面 === s.id);
    if (!行.length) return;
    o.push('### ' + s.id + ' — ' + (名前[s.id] || '（名前の記載なし）') + '（' + 行.length + '件）');
    o.push('');
    o.push('| # | 層 | 行 | 文言 |');
    o.push('|---|---|---|---|');
    行.forEach((x, i) => o.push('| ' + (i + 1) + ' | ' + x.層 + ' | ' +
      x.場所.slice(x.場所.lastIndexOf(':') + 1) + ' | ' + esc(x.t) + ' |'));
    o.push('');
  });
  const 外 = 画面層.filter((x) => x.画面 === '(画面の外)');
  if (外.length) {
    o.push('### （画面の外＝共通部分・' + 外.length + '件）');
    o.push('');
    o.push('| # | 層 | 場所 | 文言 |');
    o.push('|---|---|---|---|');
    外.forEach((x, i) => o.push('| ' + (i + 1) + ' | ' + x.層 + ' | ' + x.場所 + ' | ' + esc(x.t) + ' |'));
    o.push('');
  }

  // ---- B：JS ----
  o.push('---');
  o.push('');
  o.push('## B. JSの文字列（ファイル・場面ごと・' + (層別.JS || 0) + '件）');
  o.push('');
  const files = Array.from(new Set(全部.filter((x) => x.層 === 'JS')
    .map((x) => x.場所.slice(0, x.場所.lastIndexOf(':')))));
  files.forEach((f) => {
    const 行 = 全部.filter((x) => x.層 === 'JS' && x.場所.slice(0, x.場所.lastIndexOf(':')) === f);
    o.push('### ' + f + '（' + 行.length + '件）');
    o.push('');
    o.push('| # | 行 | 場面 | 画面 | 対象 | 文言 |');
    o.push('|---|---|---|---|---|---|');
    行.forEach((x, i) => o.push('| ' + (i + 1) + ' | ' + x.場所.slice(x.場所.lastIndexOf(':') + 1) +
      ' | ' + esc(x.場面) + ' | ' + esc(x.画面) + ' | ' + (x.対象外 ? '対象外' : '○') +
      ' | ' + esc(x.t) + ' |'));
    o.push('');
  });

  // ---- C：サーバー ----
  o.push('---');
  o.push('');
  o.push('## C. サーバーが返す文言（' + (層別.SRV || 0) + '件）');
  o.push('');
  o.push('`el(\'loginError\').textContent = e.message` のように、**そのまま画面に出る**。');
  o.push('指示40も、指示49の着手前の1回目も、この層を見ていなかった。');
  o.push('');
  o.push('| # | 場所 | 場面 | 文言 |');
  o.push('|---|---|---|---|');
  全部.filter((x) => x.層 === 'SRV').forEach((x, i) =>
    o.push('| ' + (i + 1) + ' | ' + x.場所 + ' | ' + esc(x.場面) + ' | ' + esc(x.t) + ' |'));
  o.push('');

  // ---- D：読む台帳 ----
  o.push('---');
  o.push('');
  o.push('## D. 読む台帳（文言の種類・' + 対象種.length + '件）');
  o.push('');
  o.push('**ここが読了件数を数える場所。**同じ文が何か所にあっても1行。');
  o.push('');
  o.push('| # | 層 | 画面/場面 | 出る数 | 文言 |');
  o.push('|---|---|---|---|---|');
  対象種.sort((a, b) => a.場所[0].localeCompare(b.場所[0], 'en', { numeric: true }));
  対象種.forEach((e, i) => {
    const 画面 = Array.from(e.画面).filter((v) => v && v !== '—').slice(0, 2).join('・');
    const 場面 = Array.from(e.場面)[0];
    o.push('| ' + (i + 1) + ' | ' + Array.from(e.層).join('/') + ' | ' +
      esc(画面 || 場面) + ' | ' + e.場所.length + ' | ' + esc(e.t) + ' |');
  });
  o.push('');
  o.push('---');
  o.push('');
  o.push('## E. 対象外（お題データ・' + (種類.length - 対象種.length) + '件）');
  o.push('');
  o.push('読まないと決めたもの。**見落としではない。**');
  o.push('');
  o.push('| # | 場所 | 文言 |');
  o.push('|---|---|---|');
  種類.filter((x) => x.対象外).forEach((e, i) =>
    o.push('| ' + (i + 1) + ' | ' + e.場所[0] + ' | ' + esc(e.t) + ' |'));
  o.push('');

  fs.writeFileSync(path.join(ROOT, 'docs', '文言一覧.md'), o.join('\n') + '\n', 'utf8');
  console.log('書き出した：docs/文言一覧.md');
  scan.LAYERS.forEach((l) => console.log('  ' + l.id.padEnd(6) + String(層別[l.id] || 0).padStart(6)));
  console.log('  のべ ' + 全部.length + ' / 種類 ' + 種類.length);
  console.log('  **読む単位** ' + 対象種.length + '件（対象外 ' + (種類.length - 対象種.length) + '件）');
}

module.exports = { 集める, 畳む };
if (require.main === module) main();
