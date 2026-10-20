#!/usr/bin/env node
// tools/fx-doc.js — 演出の一覧の表（docs/監査_演出の一覧.md の「全部の演出」の節）を、記録から作る（指示62-3）
//
//   node tools/fx-inventory.js && node tools/fx-catalog.js && node tools/fx-doc.js > 出力.md
//
// 1行＝1つの演出（fx-catalog の行）。列は指示62-3 2章のとおり：
//   番号・名前 ／ どこで ／ いつ ／ 長さ（①で実測） ／ 使うもの ／ 伝えている情報 ／ 分類（案） ／ ①〜⑤
// ①〜⑤の欄は「出た回数・長さ」。出なかったら「—」。設定どおりでない時は ✗ と理由。
// 押した手ごたえ（act）は tools/fx-press-probe.js の結果で埋める（通しの台本は click() で押すので :active が起きない）。

const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..', 'docs', '監査_演出の画像');
const cat = JSON.parse(fs.readFileSync(path.join(DIR, 'catalog.json'), 'utf8'));
const { 注釈 } = require('./fx-notes');
const press = {};
for (let s = 1; s <= 5; s++) {
  const f = path.join(DIR, 'press', s + '.json');
  if (fs.existsSync(f)) JSON.parse(fs.readFileSync(f, 'utf8')).押した.forEach((x) => { (press[x.行] = press[x.行] || {})[s] = x; });
}
const 強い光 = /^(fxEdge|edgeGlow|flashHit|fxFlashGood|fxFlashBad|fxDawn|bgmBeatFade|dangerEdge|livesBreak|bombBoom|nightWipe|fxCelGlow|tutRingGlow)$/;
const 揺れ = /^(shakeX|fxShake|fxShakeBig|bombShake|sugoShiver)$/;
const 部品の使うもの = { flash: '光・音', edge: '光', dawn: '光', shake: '揺れ', burst: '動き', blackout: '（隠す幕）', banner: '動き', shutter: '動き',
  celebrate: '動き・光（輪）', countdown: '動き・音・振動', vibe: '振動', notice: '動き', alive: '動き（明滅）', stagger: '動き', flip: '動き', fly: '動き',
  flipMove: '動き', spotlight: '動き', countUp: '動き（数字）' };

const esc = (s) => String(s == null ? '' : s).replace(/\|/g, '／').replace(/\n/g, ' ');
const 秒 = (v) => v == null ? '' : (v >= 10 ? Math.round(v) + 's' : (Math.round(v * 100) / 100) + 's');
const 名札 = { 進行役: '進', 参加者: '参', 大画面: '大', 手渡し: '手' };
const カセット名 = { aresoredorekore: 'あれそれ', jinro: '人狼', bakudan: '爆弾', quizou: 'クイズ', auction: 'オークション', sugoroku: 'すごろく', falsetrue: 'F/T', rcard: 'ロシアン', shinka: '進化', 'bakudan-boom': '爆弾（爆発）' };

function 使うもの(r, n) {
  let s;
  if (r.種 === 'fx') s = 部品の使うもの[r.部品] || '動き';
  else if (r.種 === 'snd') s = '音';
  else if (r.種 === 'vib') s = '振動';
  else if (r.種 === 'css') s = 強い光.test(r.部品) ? '光の点滅' : 揺れ.test(r.部品) ? '揺れ' : '動き';
  else s = '動き';
  const 付 = [];
  const sv = r.音や振動 || {};
  if (Object.keys(sv).some((k) => /^snd/.test(k)) && s.indexOf('音') === -1) 付.push('音');
  if (Object.keys(sv).some((k) => /^vib/.test(k)) && s.indexOf('振動') === -1) 付.push('振動');
  return s + (付.length ? '・' + 付.join('・') : '');
}

function 欄(r, s) {
  if (r.種 === 'act') {
    const p = (press[r.行] || {})[s];
    if (!p) return '—（押せなかった）';
    const t = (p.遷移[0] || '').split(' ').slice(1, 2).join('').replace(/,.*$/, '');
    return (p.変わった.length ? '変わった' : '✗変わらない') + (t ? ' ' + t : '');
  }
  const o = r.設定別[s];
  if (!o) return '—';
  let x = o.回 + '回' + (o.長さ != null ? ' ' + 秒(o.長さ) : '');
  // FxKit の部品：呼ばれた回数と、本当に出た（要素が置かれた・振動が鳴った）回数を分ける
  if (r.種 === 'fx' && r.部品 === 'vibe') x = '呼' + o.回 + '／鳴' + o.鳴った振動;
  else if (r.種 === 'fx' && /^(flash|edge|dawn|burst|banner|shutter|blackout|celebrate|countdown|notice)$/.test(r.部品)) x = '呼' + o.回 + '／出' + o.出た + (o.長さ != null ? ' ' + 秒(o.長さ) : '') + (o.鳴った音 ? '・音' + o.鳴った音 : '') + (o.鳴った振動 ? '・振' + o.鳴った振動 : '');
  else if (r.種 === 'snd' && o.鳴った振動) x += '・振' + o.鳴った振動;
  if (s === 3 && r.種 === 'fx' && r.部品 === 'vibe' && o.鳴った振動) x = '✗' + x + '（スキップなのに鳴った）';
  const 光 = r.種 === 'css' && 強い光.test(r.部品), 揺 = r.種 === 'css' && 揺れ.test(r.部品);
  if (s === 4 && (光 || (r.種 === 'fx' && /^(flash|edge|dawn)$/.test(r.部品) && o.出た))) x = '✗' + x + '（光を切ったのに）';
  if (s === 5 && 揺) x = '✗' + x + '（揺れを切ったのに）';
  // 4節1：光を切ると、光の部品が鳴らしていた音・振動まで消える
  if (s === 4 && r.種 === 'fx' && r.部品 === 'flash' && !o.出た && !o.鳴った音 && r.設定別[1] && r.設定別[1].鳴った音) x = '✗' + x + '（光と一緒に音も消える）';
  if (s === 3 && r.種 === 'css' && o.長さ != null && o.長さ > 0.05) x = '✗' + x + '（スキップなのに）';
  return x;
}

const 行 = cat.行.map((r) => Object.assign({}, r, { n: 注釈(r) }));
const out = [];
out.push('| 番号 | 名前 | どこで（実測：カセット・端末・画面） | いつ（呼んでいる所） | 長さ① | 使うもの | 伝えている情報 | 分類（案） | ① | ② | ③ | ④ | ⑤ |');
out.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
行.forEach((r) => {
  const 見 = [1, 2, 3, 4, 5].map((s) => r.設定別[s]).filter(Boolean)[0];
  const どこ = r.種 === 'act' ? Object.values(press[r.行] || {}).map((p) => p.画面).filter((v, i, a) => a.indexOf(v) === i).slice(0, 3).join('・') :
    見 ? 見.カセット.map((c) => カセット名[c] || c).join('・') + '（' + 見.端末.map((t) => 名札[t] || t).join('') + '）' + (見.画面.length ? ' ' + 見.画面.slice(0, 3).join('・') : '') : '（通しでは出なかった）';
  const いつ = r.種 === 'css' || r.種 === 'tr' || r.種 === 'act' ? '`' + esc(r.選択子).slice(0, 60) + '`（' + r.行 + '行）' : (r.関数 || '') + '（' + (r.ファイル && r.ファイル !== 'index.html' ? r.ファイル + ':' : '') + (r.行 || '時計') + '行）';
  const 長 = r.種 === 'act' ? ((press[r.行] || {})[1] ? ((press[r.行][1].遷移[0] || '').split(' ')[1] || '').replace(/,.*$/, '') : '') : (r.設定別[1] ? 秒(r.設定別[1].長さ) : '');
  const 分類 = r.n.分類 + (r.n.迷った ? '：' + r.n.迷った : '') + (r.n.注 ? '。' + r.n.注 : '');
  out.push('| ' + r.id + ' | ' + esc(r.n.名) + ' | ' + esc(どこ) + ' | ' + esc(いつ) + ' | ' + 長 + ' | ' + 使うもの(r, r.n) + ' | ' + esc(r.n.情報) + ' | ' + esc(分類) +
    ' | ' + [1, 2, 3, 4, 5].map((s) => esc(欄(r, s))).join(' | ') + ' |');
});
// 集計（4章）
const 数 = { 情報: 0, 賑やかし: 0, 迷った: 0 };
行.forEach((r) => { 数[r.n.分類] = (数[r.n.分類] || 0) + 1; });
const 種 = {}; 行.forEach((r) => { 種[r.種] = (種[r.種] || 0) + 1; });
const 出た = 行.filter((r) => r.種 === 'act' ? !!press[r.行] : [1, 2, 3, 4, 5].some((s) => r.設定別[s])).length;
console.log('<!-- 集計 ' + JSON.stringify({ 行: 行.length, 分類: 数, 種, 確かめた: 出た, 未分類: 行.filter((r) => /未分類/.test(r.n.名)).length }) + ' -->');
console.log(out.join('\n'));
if (process.argv.indexOf('--small') !== -1) {
  console.log('\n\n<!-- 小に入れる案 -->');
  行.filter((r) => r.n.分類 === '情報' && r.種 !== 'act' && r.種 !== 'tr').forEach((r) => console.log('- ' + r.id + ' ' + r.n.名 + '：' + r.n.情報));
}
