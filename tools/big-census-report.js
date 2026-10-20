#!/usr/bin/env node
// tools/big-census-report.js — big-census の記録を、指示64の表にする（着手前の確かめ1・門B1〜B3）
//
//   node tools/big-census-report.js              # docs/監査_大画面の画像/*/記録.json を読み、Markdown を標準出力へ
//   node tools/big-census-report.js --json OUT   # 集計を JSON でも書く
//
// 1行＝（カセット・人数・大画面の状態）。状態は「画面＋段階」でまとめ、同じ状態が何度出ても
// いちばん悪かった時の数字を出す（巻きの最大・切れの最大・小さい字の最大）。

const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..', 'docs', '監査_大画面の画像');
const 名 = { jinro: '人狼', bakudan: '爆弾', quizou: 'クイズ', auction: 'オークション', sugoroku: 'すごろく', falsetrue: 'F/T', rcard: 'ロシアン', shinka: '進化' };
const 並び = ['jinro', 'bakudan', 'quizou', 'auction', 'sugoroku', 'falsetrue', 'rcard', 'shinka'];

const runs = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((d) => fs.existsSync(path.join(DIR, d, '記録.json'))).map((d) => JSON.parse(fs.readFileSync(path.join(DIR, d, '記録.json'), 'utf8'))) : [];
runs.sort((a, b) => 並び.indexOf(a.カセット) - 並び.indexOf(b.カセット) || a.人数 - b.人数);

function 状態名(m) {
  if (!m) return '?';
  if (m.画面 !== 'scr-rt-big') return m.画面;
  const lobby = /big-lobby/.test(m.class);
  return (lobby ? '待合' : '遊ぶ') + (m.段階 ? '：' + m.段階.slice(0, 14) : '');
}
const 集 = [];
runs.forEach((r) => {
  const by = {};
  r.記録.forEach((rec) => {
    const a = rec.測り['1280x720'], b = rec.測り['1920x1080'];
    if (!a || a.画面 !== 'scr-rt-big') return;
    const k = 状態名(a);
    const o = by[k] = by[k] || { 状態: k, 巻き: [0, 0], 箱: 0, 切れ: [0, 0], 小さい: [0, 0], ボタン: null, 例: null, 切れた物: {}, 小さい物: {} };
    o.巻き = [Math.max(o.巻き[0], a.ページの巻き), Math.max(o.巻き[1], b.ページの巻き)];
    o.箱 = Math.max(o.箱, a.箱の巻き.length, b.箱の巻き.length);
    o.切れ = [Math.max(o.切れ[0], a.切れの数), Math.max(o.切れ[1], b.切れの数)];
    o.小さい = [Math.max(o.小さい[0], a.小さいの数), Math.max(o.小さい[1], b.小さいの数)];
    o.ボタン = (a.いちばん大きいボタン || {}).文字 || o.ボタン;
    if (!o.例 || a.ページの巻き + a.切れの数 > 0) o.例 = a.画像;
    a.切れ.concat(b.切れ).forEach((x) => { const kk = x.何.replace(/#[\w-]+/, '') + (x.切る箱 ? '（' + x.切る箱 + 'で切れる）' : '（画面の外）'); o.切れた物[kk] = 1; });
    a.小さい.forEach((x) => { o.小さい物[x.何 + ' ' + x.px + 'px「' + x.文字.slice(0, 10) + '」'] = 1; });
  });
  Object.values(by).forEach((o) => 集.push(Object.assign({ カセット: r.カセット, 人数: r.人数, 失敗: !!r.失敗, 置き場: r.カセット + '_' + r.人数 }, o)));
});

const 行 = ['| カセット | 人数 | 大画面の状態 | 巻き（px）720／1080 | 中の箱の巻き | 切れ 720／1080 | 28px未満の字 720／1080 | いちばん大きいボタン | 画像 |', '|---|---|---|---|---|---|---|---|---|'];
集.forEach((o) => {
  const 悪 = (v) => v > 0 ? '**' + v + '**' : '0';
  行.push('| ' + (名[o.カセット] || o.カセット) + (o.失敗 ? '（途中まで）' : '') + ' | ' + o.人数 + ' | ' + o.状態 + ' | ' + 悪(o.巻き[0]) + '／' + 悪(o.巻き[1]) + ' | ' + o.箱 + ' | ' + 悪(o.切れ[0]) + '／' + 悪(o.切れ[1]) +
    ' | ' + 悪(o.小さい[0]) + '／' + 悪(o.小さい[1]) + ' | ' + (o.ボタン || '') + ' | `' + o.置き場 + '/' + (o.例 || '') + '` |');
});
console.log(行.join('\n'));
const 合計 = { 状態: 集.length, 巻きあり: 集.filter((o) => o.巻き[0] > 0 || o.巻き[1] > 0).length, 切れあり: 集.filter((o) => o.切れ[0] + o.切れ[1] > 0).length, 小さいあり: 集.filter((o) => o.小さい[0] + o.小さい[1] > 0).length,
  プレイヤーにもどるが一番: 集.filter((o) => /プレイヤーにもどる/.test(o.ボタン || '')).length };
console.log('\n<!-- 合計 ' + JSON.stringify(合計) + ' -->');
const 小さい物 = {}; 集.forEach((o) => Object.keys(o.小さい物).forEach((k) => { const key = k.replace(/「.*$/, ''); 小さい物[key] = (小さい物[key] || 0) + 1; }));
const 切れた物 = {}; 集.forEach((o) => Object.keys(o.切れた物).forEach((k) => { 切れた物[k] = (切れた物[k] || 0) + 1; }));
console.log('\n### 28px未満の字（1280×720・出た状態の数）\n');
Object.entries(小さい物).sort((a, b) => b[1] - a[1]).slice(0, 30).forEach(([k, v]) => console.log('- ' + k + '：' + v));
console.log('\n### 切れていたもの（出た状態の数）\n');
Object.entries(切れた物).sort((a, b) => b[1] - a[1]).slice(0, 30).forEach(([k, v]) => console.log('- ' + k + '：' + v));
const j = process.argv.indexOf('--json');
if (j !== -1) fs.writeFileSync(process.argv[j + 1], JSON.stringify({ 集, 合計 }, null, 1));
