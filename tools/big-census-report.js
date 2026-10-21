#!/usr/bin/env node
// tools/big-census-report.js — big-census の記録を、指示64の表にする（着手前の確かめ1・門B1〜B3）
//
//   node tools/big-census-report.js              # docs/監査_大画面の画像/*/記録.json を読み、Markdown を標準出力へ
//   node tools/big-census-report.js --json OUT   # 集計を JSON でも書く
//
// 1行＝（カセット・人数・大画面の状態）。状態は census が残した形（待合A／待合B／遊ぶ・段階・順位表の形）でまとめ
//（形の無い古い記録は「画面＋段階」）、同じ状態が何度出てもいちばん悪かった時の数字を出す（巻きの最大・切れの最大・小さい字の最大）。
// 頼んだ人数で回っていない回（待合の名簿の最大が人数と違う・census の 食い違い）は、人数の欄に「（実は ◯）」と印を付け、
// 合計の 人数の食い違い に並べ、1 で終わる（人狼の 8人・16人が全部4人だった・指示64）。

const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..', 'docs', '監査_大画面の画像');
const 名 = { jinro: '人狼', bakudan: '爆弾', quizou: 'クイズ', auction: 'オークション', sugoroku: 'すごろく', falsetrue: 'F/T', rcard: 'ロシアン', shinka: '進化' };
const 並び = ['jinro', 'bakudan', 'quizou', 'auction', 'sugoroku', 'falsetrue', 'rcard', 'shinka'];

const runs = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((d) => fs.existsSync(path.join(DIR, d, '記録.json'))).map((d) => JSON.parse(fs.readFileSync(path.join(DIR, d, '記録.json'), 'utf8'))) : [];
// 置き場には実験台（tools/big-lab.js）の記録（lab/）もある。**census の形（記録の配列）だけを読む**
//（読めないものを黙って落とさず、何を外したかを出す・落とし穴10-e）
const 外した = runs.filter((r) => !Array.isArray(r.記録)).length;
if (外した) console.error('census の形でない記録を ' + 外した + ' 件外しました（実験台の lab/ など）');
runs.splice(0, runs.length, ...runs.filter((r) => Array.isArray(r.記録)));
runs.sort((a, b) => 並び.indexOf(a.カセット) - 並び.indexOf(b.カセット) || a.人数 - b.人数);

// 状態の名前。新しい記録は census が測った時の形（rec.形・tools/big-measure.js の 形の式）から付ける：
//   待合A（ゲーム未選択）／待合B（選んだあと）／遊ぶ ＋〔段階〕（data-phase が play 以外の時。決着など）
//   ＋「：段階の札」＋「・順位表 形」（順位表が出ている時）。
// 前の名前（class の big-lobby と段階の札だけ）では、クイズの遊ぶ間と決着、待合A と B が同じ行に畳まれていた（指示64）。
// 形の無い古い記録は、前の名前のまま
function 状態名(rec, m) {
  const f = rec && rec.形;
  if (f && f.画面) {
    if (f.画面 !== 'scr-rt-big') return f.画面;
    const 何 = f.big === 'a' ? '待合A' : f.big === 'b' ? '待合B' : '遊ぶ';
    return 何 + (f.phase && f.phase !== 'play' ? '〔' + f.phase + '〕' : '') + (f.段階 ? '：' + String(f.段階).slice(0, 14) : '') +
      (f.順位 ? '・順位表' + f.順位 : '');
  }
  if (!m) return '?';
  if (m.画面 !== 'scr-rt-big') return m.画面;
  const lobby = /big-lobby/.test(m.class);
  return (lobby ? '待合' : '遊ぶ') + (m.段階 ? '：' + m.段階.slice(0, 14) : '');
}
// 頼んだ人数で本当に回ったか：待合で見えた名簿の最大を人数と比べる（人狼の 8人・16人が、黙って全部4人だった・指示64）。
// 新しい記録は形（big が a/b）と形の名簿、古い記録は class の big-lobby と 名簿の数 で待合を見分ける。
// census 自身が書いた 食い違い（bot の数・載りきらなかった bot）があれば、それも食い違いに数える
function 待合の人数(r) {
  let 最大 = null;
  r.記録.forEach((rec) => {
    const a = rec.測り && rec.測り['1280x720'];
    let n = null;
    if (rec.形 && rec.形.画面) {
      if (rec.形.画面 === 'scr-rt-big' && (rec.形.big === 'a' || rec.形.big === 'b')) n = rec.形.名簿;
    } else if (a && a.画面 === 'scr-rt-big' && /big-lobby/.test(a.class || '')) n = a.名簿の数;
    if (n != null) 最大 = 最大 == null ? n : Math.max(最大, n);
  });
  return 最大;
}
const 人数の食い違い = [];
runs.forEach((r) => {
  const 見えた = 待合の人数(r);
  const 理由 = [];
  if (見えた != null && 見えた !== r.人数) 理由.push('待合の名簿は最大 ' + 見えた + ' 人');
  (r.食い違い || []).forEach((x) => { if (理由.indexOf(x) === -1) 理由.push(x); });
  r.実は = 理由.length ? (見えた != null && 見えた !== r.人数 ? 見えた : '食い違い') : null;
  if (理由.length) 人数の食い違い.push(r.カセット + '_' + r.人数 + '（' + 理由.join('・') + '）');
});
if (人数の食い違い.length) {
  人数の食い違い.forEach((x) => console.error('✖ 人数の食い違い：' + x));
  process.exitCode = 1;
}
const 集 = [];
runs.forEach((r) => {
  const by = {};
  r.記録.forEach((rec) => {
    const a = rec.測り['1280x720'], b = rec.測り['1920x1080'];
    if (!a || a.画面 !== 'scr-rt-big') return;
    const k = 状態名(rec, a);
    const o = by[k] = by[k] || { 状態: k, 巻き: [0, 0], 箱: 0, 切れ: [0, 0], 小さい: [0, 0], 読めない: [0, 0], ボタン: null, 例: null, 切れた物: {}, 小さい物: {} };
    o.巻き = [Math.max(o.巻き[0], a.ページの巻き), Math.max(o.巻き[1], b.ページの巻き)];
    o.箱 = Math.max(o.箱, a.箱の巻き.length, b.箱の巻き.length);
    o.切れ = [Math.max(o.切れ[0], a.切れの数), Math.max(o.切れ[1], b.切れの数)];
    o.小さい = [Math.max(o.小さい[0], a.小さいの数), Math.max(o.小さい[1], b.小さいの数)];
    // 読めない名前（3字未満まで省略された名前・指示64の監査）。古い記録には無いので 0 とみなす
    o.読めない = [Math.max(o.読めない[0], a.読めないの数 || 0), Math.max(o.読めない[1], b.読めないの数 || 0)];
    o.ボタン = (a.いちばん大きいボタン || {}).文字 || o.ボタン;
    if (!o.例 || a.ページの巻き + a.切れの数 > 0) o.例 = a.画像;
    a.切れ.concat(b.切れ).forEach((x) => { const kk = x.何.replace(/#[\w-]+/, '') + (x.切る箱 ? '（' + x.切る箱 + 'で切れる）' : '（画面の外）'); o.切れた物[kk] = 1; });
    a.小さい.forEach((x) => { o.小さい物[x.何 + ' ' + x.px + 'px「' + x.文字.slice(0, 10) + '」'] = 1; });
  });
  Object.values(by).forEach((o) => 集.push(Object.assign({ カセット: r.カセット, 人数: r.人数, 実は: r.実は, 失敗: !!r.失敗, 置き場: r.カセット + '_' + r.人数 }, o)));
});

const 行 = ['| カセット | 人数 | 大画面の状態 | 巻き（px）720／1080 | 中の箱の巻き | 切れ 720／1080 | 28px未満の字 720／1080 | 読めない名前 720／1080 | いちばん大きいボタン | 画像 |', '|---|---|---|---|---|---|---|---|---|---|'];
集.forEach((o) => {
  const 悪 = (v) => v > 0 ? '**' + v + '**' : '0';
  // 頼んだ人数で回っていない行は、人数の欄に印を付ける（その行の数字は、その人数のものではない）
  const 人数欄 = o.実は != null ? '**' + o.人数 + '（実は ' + o.実は + '）**' : o.人数;
  行.push('| ' + (名[o.カセット] || o.カセット) + (o.失敗 ? '（途中まで）' : '') + ' | ' + 人数欄 + ' | ' + o.状態 + ' | ' + 悪(o.巻き[0]) + '／' + 悪(o.巻き[1]) + ' | ' + o.箱 + ' | ' + 悪(o.切れ[0]) + '／' + 悪(o.切れ[1]) +
    ' | ' + 悪(o.小さい[0]) + '／' + 悪(o.小さい[1]) + ' | ' + 悪(o.読めない[0]) + '／' + 悪(o.読めない[1]) + ' | ' + (o.ボタン || '') + ' | `' + o.置き場 + '/' + (o.例 || '') + '` |');
});
console.log(行.join('\n'));
const 合計 = { 状態: 集.length, 巻きあり: 集.filter((o) => o.巻き[0] > 0 || o.巻き[1] > 0).length, 切れあり: 集.filter((o) => o.切れ[0] + o.切れ[1] > 0).length, 小さいあり: 集.filter((o) => o.小さい[0] + o.小さい[1] > 0).length, 読めないあり: 集.filter((o) => o.読めない[0] + o.読めない[1] > 0).length,
  プレイヤーにもどるが一番: 集.filter((o) => /プレイヤーにもどる/.test(o.ボタン || '')).length, 人数の食い違い };
console.log('\n<!-- 合計 ' + JSON.stringify(合計) + ' -->');
const 小さい物 = {}; 集.forEach((o) => Object.keys(o.小さい物).forEach((k) => { const key = k.replace(/「.*$/, ''); 小さい物[key] = (小さい物[key] || 0) + 1; }));
const 切れた物 = {}; 集.forEach((o) => Object.keys(o.切れた物).forEach((k) => { 切れた物[k] = (切れた物[k] || 0) + 1; }));
console.log('\n### 28px未満の字（1280×720・出た状態の数）\n');
Object.entries(小さい物).sort((a, b) => b[1] - a[1]).slice(0, 30).forEach(([k, v]) => console.log('- ' + k + '：' + v));
console.log('\n### 切れていたもの（出た状態の数）\n');
Object.entries(切れた物).sort((a, b) => b[1] - a[1]).slice(0, 30).forEach(([k, v]) => console.log('- ' + k + '：' + v));
const j = process.argv.indexOf('--json');
if (j !== -1) fs.writeFileSync(process.argv[j + 1], JSON.stringify({ 集, 合計 }, null, 1));
