#!/usr/bin/env node
// tools/flow-report.js — tools/flow-walk.js の 記録.json を9カセット分あつめて、表と「迷いそうな所」の候補を出す（指示62）
//
//   node tools/flow-report.js                 # docs/監査_審査会の指摘_画像/*/記録.json を読む
//   node tools/flow-report.js --json OUT.json # 候補を JSON でも書く（レビュー役に渡す）
//   node tools/flow-report.js --dir docs/監査_審査会の指摘_画像/_63_通し  # 別の置き場の通しを読む
//
// **ここが出すのは「候補」まで。**画面の材料（主ボタンの数・長い文・待ち文・戻るボタン・
// 進行役の言葉）から機械的に拾うので、拾いすぎも取りこぼしもある。
// 当たっているかは、撮った画像を見て決める（判断を機械に任せない）。
//
// 物差し（指示62 1-1）
//   (a) 次に押すものが1つに決まらない … その人の画面で、見えていて押せる主ボタン（btn-main / ui-btn-main）が2つ以上
//   (b) 押す前に、2行より長い文を読まないと分からない … その人が押す手順で、3行以上の文のかたまりが見えている
//   (c) 待っている間、何を待っているかが出ていない … 待つ手順で、その人（と参加者）の画面に「待」などの文が無い
//   (d) 戻る・やめる方法が見えない … その人の画面に、戻る・やめる・出る系のボタンが1つも無い
//   (e) 参加者の画面に、進行役向けの言葉 … 参加者の画面に「進行役」「はじめる」「ゲームをえらぶ」など
//   (f) 大画面と手元で食い違う … 機械では拾わない（画像で見る）

const fs = require('fs');
const path = require('path');

// --dir で置き場を変えられる（指示63：やり直した通しを _63_通し に置き、指示62 の記録と並べる）
const DIR = (function(){ const a = process.argv.indexOf('--dir'); return a !== -1 ? path.resolve(process.argv[a + 1]) : path.join(__dirname, '..', 'docs', '監査_審査会の指摘_画像'); })();
const 並び = ['aresoredorekore', 'jinro', 'bakudan', 'quizou', 'auction', 'sugoroku', 'falsetrue', 'rcard', 'shinka'];
const 名前 = { aresoredorekore: 'あれそれどれこれ', jinro: '人狼ゲーム', bakudan: '爆弾解除', quizou: 'クイズ王', auction: 'オークション', sugoroku: 'すごろく', falsetrue: 'False or True', rcard: 'ロシアンカード', shinka: '進化じゃんけん' };

function 読む(id) {
  const f = path.join(DIR, id, '記録.json');
  if (!fs.existsSync(f)) return null;
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}
const 秒 = (ms) => Math.round((ms || 0) / 100) / 10;
const 人 = ['進行役', '参加者', '大画面'];

/**
 * 1カセットの集計。**「QRから結果まで」と「もう1回まで」を分けて**数える。
 * 台本によっては、結果のあとで選択肢を試すために2試合目・3試合目まで回すので
 *（あれそれどれこれ）、全部を足すとカセットどうしを並べられない。
 *   結果まで … 最初の手順から、最初の「放置」の手順の直前まで
 *   もう1回 … 記録の 終わり方.もう1回まで（W.結果のあと が数えたもの）
 */
function 集計(d) {
  const all = d.手順 || [];
  const i放置 = all.findIndex((r) => r.する === '放置');
  const 結果まで = i放置 === -1 ? all : all.slice(0, i放置);
  const s = 区間(結果まで);
  s.全体 = 区間(all);
  s.もう1回 = (d.終わり方 || {})['もう1回まで'] || null;
  return s;
}
function 区間(手順) {
  const 操作 = 手順.filter((r) => r.押す回数 > 0 || r.入力回数 > 0 || /QRを読む|開く/.test(r.する));
  const 押す = {}; 人.forEach((k) => { 押す[k] = 手順.filter((r) => r.誰 === k).reduce((a, r) => a + r.押す回数, 0); });
  const 入力 = 手順.reduce((a, r) => a + (r.入力回数 || 0), 0);
  const 待ち = {};
  手順.forEach((r) => { if (r.待ちms) { const k = r.待ちの種類 || 'その他'; 待ち[k] = (待ち[k] || 0) + r.待ちms; } });
  const 最後 = 手順[手順.length - 1];
  return {
    手順数: 手順.length, 操作の手順: 操作.length, 押す, 押す計: 人.reduce((a, k) => a + 押す[k], 0), 入力,
    待ち秒: Object.fromEntries(Object.entries(待ち).map(([k, v]) => [k, 秒(v)])),
    待ち計秒: 秒(Object.values(待ち).reduce((a, v) => a + v, 0)),
    秒: 最後 ? 秒(最後.経過ms) : null
  };
}

/** 迷いそうな所の候補 */
function 候補(d) {
  const out = [];
  const 押す手順 = (r) => r.押す回数 > 0 || r.入力回数 > 0;
  (d.手順 || []).forEach((r) => {
    const 誰 = 人.indexOf(r.誰) !== -1 ? r.誰 : null;
    const m = (k) => (r.測り || {})[k] || {};
    if (誰 && 押す手順(r)) {
      // 押す「前」の画面は、1つ前の手順の撮影（その人の画面）
      const prev = (d.手順 || []).filter((x) => x.no < r.no).pop();
      const 前 = prev ? ((prev.測り || {})[誰] || {}) : {};
      if ((前.主ボタン数 || 0) >= 2) out.push({ 手順: r.no, 誰, 物差し: 'a', 根拠: '押す前の画面に主ボタンが' + 前.主ボタン数 + 'つ：' + (前.ボタン || []).filter((b) => b.k === 'main' && !b.dis && b.画面内 && !b.覆われ).map((b) => b.t).join('／') });
      const 長い = (前.文 || []).filter((x) => x.行 > 2 && x.字 >= 40);   // 大きな字の見出しが3行に割れたものは除く
      if (長い.length) out.push({ 手順: r.no, 誰, 物差し: 'b', 根拠: '押す前に' + 長い[0].行 + '行（' + 長い[0].字 + '字）：' + 長い[0].t.slice(0, 60) });
      if (前.画面 && !(前.戻る || []).length && 誰 !== '大画面') out.push({ 手順: r.no, 誰, 物差し: 'd', 根拠: '押す前の画面 ' + 前.画面 + ' に、戻る・やめる・出る系のボタンが無い' });
    }
    if (r.する === '待つ') {
      ['参加者', '進行役'].forEach((k) => {
        const x = m(k);
        if (x.画面 && !(x.待ち文 || []).length && !(x.重なり || []).length) out.push({ 手順: r.no, 誰: k, 物差し: 'c', 根拠: '待つ手順（' + (r.待つもの || r.名) + '）で、' + x.画面 + ' に待ちの文が無い' });
      });
    }
    const p = m('参加者');
    if ((p.進行役語 || []).length) out.push({ 手順: r.no, 誰: '参加者', 物差し: 'e', 根拠: p.画面 + '：' + p.進行役語.join(' ／ ').slice(0, 80) });
  });
  // 同じ画面・同じ根拠が続くものは1つにまとめる
  const seen = new Set();
  return out.filter((c) => { const k = c.誰 + c.物差し + c.根拠; if (seen.has(k)) return false; seen.add(k); return true; });
}

/**
 * 導線の表（手順ごと）を Markdown にする。
 * judged … レビュー役が画像を見て確かめた「迷いそうな所」{ カセットid: [{手順, 誰, 物差し, 根拠}] }。
 * 無ければ機械の候補を「候補」として出す（確定とは書かない）
 */
function 表(id, d, judged) {
  const 手順 = d.手順 || [];
  const 迷い = (judged && judged[id]) || null;
  const 印 = {};
  (迷い || 候補(d)).forEach((c) => { (印[c.手順] = 印[c.手順] || []).push('(' + c.物差し + ')' + (c.誰 && c.誰 !== '参加者' ? c.誰[0] : '')); });
  const out = [];
  out.push('| # | 誰 | すること | 押す | 時間（秒） | 待ち（秒・何を） | 画面（参／進／大） | 迷い' + (迷い ? '' : '（候補）') + ' |');
  out.push('|---|---|---|---|---|---|---|---|');
  let prev = 0;
  手順.forEach((r) => {
    const dt = 秒(r.経過ms - prev); prev = r.経過ms;
    const g = r.画面 || {};
    const 画 = ['参加者', '進行役', '大画面'].map((k) => (g[k] || '－').replace(/^scr-/, '').replace('（まだ開いていない）', '－')).join('／');
    out.push('| ' + r.no + ' | ' + r.誰 + ' | ' + String(r.名).replace(/\|/g, '｜') + (r.失敗 ? '（✖ ' + String(r.失敗).slice(0, 40) + '）' : '') +
      ' | ' + (r.押す回数 || '') + (r.入力回数 ? '＋入力' + r.入力回数 : '') + ' | ' + dt +
      ' | ' + (r.待ちms ? 秒(r.待ちms) + '・' + (r.待ちの種類 || '') + (r.待つもの ? '（' + r.待つもの + '）' : '') : '') +
      ' | ' + 画 + ' | ' + (印[r.no] || []).join(' ') + ' |');
  });
  return out.join('\n');
}

function main() {
  const argv = process.argv.slice(2);
  const all = {};
  const 行 = [];
  for (const id of 並び) {
    const d = 読む(id);
    if (!d) { 行.push('| ' + 名前[id] + ' | （記録なし） |'); continue; }
    const s = 集計(d);
    const c = 候補(d);
    all[id] = { 名前: 名前[id], モード: d.モード, 遊び方: d.遊び方, 失敗: d.失敗, 集計: s, 候補: c, 終わり方: d.終わり方, 気づき: d.気づき };
    const 物 = {}; c.forEach((x) => { 物[x.物差し] = (物[x.物差し] || 0) + 1; });
    const r1 = s.もう1回 || {};
    行.push('| ' + 名前[id] + ' | ' + (d.モード ? d.モード.名 : '') + ' | ' + s.操作の手順 + '（' + s.手順数 + '）' +
      ' | ' + s.押す.参加者 + ' / ' + s.押す.進行役 + ' / ' + s.押す.大画面 + ' | ' + s.入力 +
      ' | ' + s.待ち計秒 + '（' + Object.entries(s.待ち秒).map(([k, v]) => k + ' ' + v).join('・') + '）' +
      ' | ' + s.秒 + ' | ' + (r1.手順数 != null ? r1.手順数 + '手順・' + r1.押す回数 + '回' : '－') + ' | ' +
      ['a', 'b', 'c', 'd', 'e'].map((k) => 物[k] || 0).join('/') + ' |' + (d.失敗 ? ' **止まった**' : '') + ' |');
  }
  console.log('QRから結果まで（台本の最初の手順〜結果。結果のあとの調べは入れない）');
  console.log('| カセット | 通した遊び方 | 操作の手順（全手順） | 押す（参加者/進行役/大画面） | 入力 | 待ち秒（内訳） | 結果までの秒 | もう1回まで | 候補 a/b/c/d/e | |');
  console.log('|---|---|---|---|---|---|---|---|---|---|');
  行.forEach((l) => console.log(l));
  const md = argv.indexOf('--md');
  if (md !== -1) {
    const ji = argv.indexOf('--judged');
    const judged = ji !== -1 ? JSON.parse(fs.readFileSync(argv[ji + 1], 'utf8')) : null;
    const parts = [];
    for (const id of 並び) {
      const d = 読む(id); if (!d) continue;
      parts.push('## ' + 名前[id] + '（' + id + '）\n\n' +
        '通した遊び方：' + (d.遊び方 === 'hand' ? '手渡し（1台）' : '部屋（QR参加）') + ' ／ ' + (d.モード ? d.モード.名 + '（' + d.モード.なぜ + '）' : '') +
        '\n\n一覧の画像：`docs/監査_審査会の指摘_画像/' + id + '/一覧.jpg`\n\n' + 表(id, d, judged));
    }
    fs.writeFileSync(argv[md + 1], parts.join('\n\n') + '\n');
    console.log('→ ' + argv[md + 1]);
  }
  const j = argv.indexOf('--json');
  if (j !== -1) { fs.writeFileSync(argv[j + 1], JSON.stringify(all, null, 2)); console.log('\n→ ' + argv[j + 1]); }
}

module.exports = { 集計, 候補, 表 };
if (require.main === module) main();
