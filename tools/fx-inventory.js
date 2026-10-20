#!/usr/bin/env node
// tools/fx-inventory.js — アプリの演出の「入口」を、コードから機械で全部たどる（指示62-3 門E1）
//
//   node tools/fx-inventory.js            # 一覧を docs/監査_演出の画像/inventory.json に書き、件数を出す
//
// 目で探して「たぶん全部」にしないために、入口ごとに掃く：
//   A. FxKit の部品（fx.js が外へ出しているもの）と、それを呼んでいる場所（index.html と public/js/*.js）
//   B. CSS の @keyframes と、それを animation で使っている選択子（index.html の <style>）
//   C. CSS の transition（演出として動くもの・押した手ごたえ :active を含む）
//   D. 効果音：音を鳴らす関数（WebAudio の発振器を作る関数）と、それを呼んでいる場所
//   E. 振動：doVibrate / navigator.vibrate / FxKit.vibe を呼んでいる場所
//   F. JS で動かすもの：element.animate・requestAnimationFrame
// それぞれの呼び出しに「どの関数の中か」（最も近い名前付き function）を添える——
// 記録係（fx-recorder）が拾うスタックの関数名・行と突き合わせるため。

const fs = require('fs');
const path = require('path');
const { ROOT, HTML, JS, 囲む関数 } = require('./fx-src');
const styleStart = HTML.findIndex((l) => /^<style>/.test(l));
const styleEnd = HTML.findIndex((l, i) => i > styleStart && /^<\/style>/.test(l));

// ---- A. FxKit ----
const fxSrc = JS['fx.js'].join('\n');
const 出口 = (fxSrc.match(/var api = \{([\s\S]*?)\};/) || [])[1] || '';
const 部品 = Array.from(new Set((出口.match(/(\w+)\s*:\s*\w+/g) || []).map((x) => x.split(':')[0].trim()))).filter((k) => k !== '_cfg');
const A = [];
function 掃くFx(lines, file) {
  lines.forEach((l, i) => {
    if (file === 'index.html' && i >= styleStart && i <= styleEnd) return;
    const re = /FxKit\.(\w+)\s*\(/g; let m;
    while ((m = re.exec(l))) {
      if (/^\s*\/\/|^\s*\*/.test(l)) continue;
      const f = 囲む関数(lines, i);
      A.push({ 入口: 'A', 部品: m[1], ファイル: file, 行: i + 1, 関数: f.名, 関数の行: f.行, 文: l.trim().slice(0, 140) });
    }
  });
}
掃くFx(HTML, 'index.html');
Object.keys(JS).filter((f) => f !== 'fx.js').forEach((f) => 掃くFx(JS[f], f));

// ---- B / C. CSS ----
const css = HTML.slice(styleStart + 1, styleEnd).join('\n');
const cssLine0 = styleStart + 2;
const 行の番号 = (pos) => cssLine0 + css.slice(0, pos).split('\n').length - 1;
const keyframes = {};
{ const re = /@keyframes\s+([\w-]+)\s*\{/g; let m; while ((m = re.exec(css))) keyframes[m[1]] = { 名: m[1], 行: 行の番号(m.index), 使う所: [] }; }
// keyframes の中身（光の点滅か・揺れか を見るため）
Object.values(keyframes).forEach((k) => {
  const i = css.indexOf('@keyframes ' + k.名);
  let d = 0, j = css.indexOf('{', i), s = j;
  for (; j < css.length; j++) { if (css[j] === '{') d++; else if (css[j] === '}') { d--; if (!d) break; } }
  k.中身 = css.slice(s, j + 1).replace(/\s+/g, ' ').slice(0, 400);
});
// 規則を平らに読む（@keyframes の中身は飛ばす。@media の中は読む）
const 規則 = [];
(function 読む(text, base) {
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open === -1) break;
    const head = text.slice(i, open).replace(/\/\*[\s\S]*?\*\//g, '').trim();
    let d = 0, j = open;
    for (; j < text.length; j++) { if (text[j] === '{') d++; else if (text[j] === '}') { d--; if (!d) break; } }
    const body = text.slice(open + 1, j);
    if (/^@keyframes/.test(head)) { /* 飛ばす */ }
    else if (/^@(media|supports)/.test(head)) 読む(body, base + open + 1);
    else 規則.push({ sel: head.replace(/\s+/g, ' '), body: body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim(), 行: 行の番号(base + i + (text.slice(i, open).length - text.slice(i, open).trimStart().length)) });
    i = j + 1;
  }
})(css, 0);
const B = [], C = [];
規則.forEach((r) => {
  const am = r.body.match(/(?:^|;)\s*animation(?:-name)?\s*:\s*([^;]+)/);
  if (am && !/^\s*none\b/.test(am[1])) {
    const 名 = Object.keys(keyframes).filter((k) => new RegExp('(^|[\\s,])' + k + '([\\s,]|$)').test(am[1]));
    名.forEach((k) => { keyframes[k].使う所.push(r.sel); B.push({ 入口: 'B', keyframes: k, 選択子: r.sel, 宣言: am[1].trim().slice(0, 120), 行: r.行, 速さに乗る: /--fx-scale/.test(am[1]) }); });
  }
  const tm = r.body.match(/(?:^|;)\s*transition\s*:\s*([^;]+)/);
  if (tm && !/^\s*none\b/.test(tm[1])) {
    C.push({ 入口: 'C', 選択子: r.sel, 宣言: tm[1].trim().slice(0, 140), 行: r.行, 速さに乗る: /--fx-scale/.test(tm[1]) });
  }
});
// 押した手ごたえ（:active で形・色が変わる規則）も数える
const 手ごたえ = 規則.filter((r) => /:active/.test(r.sel) && /transform|background|box-shadow|filter|opacity/.test(r.body))
  .map((r) => ({ 入口: 'C:active', 選択子: r.sel, 宣言: r.body.slice(0, 120), 行: r.行 }));

// ---- D. 効果音 ----
// 音の関数＝本体で createOscillator / createBufferSource を呼ぶ名前付き関数
const 音の関数 = new Set();
HTML.forEach((l, i) => {
  if (/createOscillator|createBufferSource/.test(l)) { const f = 囲む関数(HTML, i); if (f.名 && f.名 !== '(地)') 音の関数.add(f.名); }
});
// beep を呼んで音を作る関数も音の関数（tick など）
HTML.forEach((l, i) => { if (/\bbeep\(/.test(l) && !/function beep/.test(l)) { const f = 囲む関数(HTML, i); if (/Sound$|^sfx|^tick$|^play/.test(f.名)) 音の関数.add(f.名); } });
// 音そのものではない下ごしらえ（出口・雑音の素・音を鳴らせる時だけ包む）は外す。BGM の1音（bgmNote）も演出の音ではない
['setTimeout', 'withAudio', 'noiseSource', 'bgmNote'].forEach((n) => 音の関数.delete(n));
const D = [];
const 音名 = Array.from(音の関数);
HTML.forEach((l, i) => {
  if (i >= styleStart && i <= styleEnd) return;
  if (/^\s*\/\/|^\s*\*/.test(l)) return;
  音名.forEach((n) => {
    const re = new RegExp('(^|[^\\w.$])' + n.replace(/\$/g, '\\$') + '\\s*\\(', 'g');
    if (re.test(l) && !new RegExp('function\\s+' + n + '\\s*\\(').test(l)) {
      const f = 囲む関数(HTML, i);
      D.push({ 入口: 'D', 音: n, 行: i + 1, 関数: f.名, 関数の行: f.行, 文: l.trim().slice(0, 140) });
    }
  });
});

// ---- E. 振動 ----
const E = [];
HTML.forEach((l, i) => {
  if (/^\s*\/\/|^\s*\*/.test(l)) return;
  if (/\bdoVibrate\s*\(|navigator\.vibrate\s*\(|countdownVibe\s*\(/.test(l) && !/function (doVibrate|countdownVibe)/.test(l)) {
    const f = 囲む関数(HTML, i);
    E.push({ 入口: 'E', 文: l.trim().slice(0, 140), 行: i + 1, 関数: f.名, 関数の行: f.行 });
  }
});
// UiKit（ui.js）は自分の vibe() を通して FxKit.vibe を呼ぶ（ダイアログ・シートの手ごたえ）
(JS['ui.js'] || []).forEach((l, i) => {
  if (/\bvibe\(/.test(l) && !/function vibe/.test(l) && !/cfg\.fx\.vibe/.test(l)) {
    const f = 囲む関数(JS['ui.js'], i);
    A.push({ 入口: 'A', 部品: 'vibe', ファイル: 'ui.js', 行: i + 1, 関数: 'UiKit.' + f.名, 関数の行: f.行, 文: l.trim().slice(0, 140) });
  }
});
A.filter((a) => a.部品 === 'vibe').forEach((a) => E.push({ 入口: 'E(FxKit.vibe)', 文: a.文, 行: a.行, ファイル: a.ファイル, 関数: a.関数, 関数の行: a.関数の行 }));

// ---- F. JS で動かすもの ----
const F = [];
const 全部 = [['index.html', HTML]].concat(Object.keys(JS).map((f) => [f, JS[f]]));
全部.forEach(([file, lines]) => lines.forEach((l, i) => {
  if (/\.animate\(|requestAnimationFrame\(/.test(l) && !/^\s*\/\/|^\s*\*/.test(l)) {
    const f = 囲む関数(lines, i);
    F.push({ 入口: 'F', ファイル: file, 行: i + 1, 関数: f.名, 文: l.trim().slice(0, 140) });
  }
}));

const 呼ばれている部品 = new Set(A.map((a) => a.部品));
const 呼ばれない部品 = 部品.filter((k) => !呼ばれている部品.has(k) && !/^(stageState|busy|init|skipNow|linger|hold)$/.test(k));
const out = { 作った: new Date().toISOString(), 部品, 呼ばれない部品, A, keyframes: Object.values(keyframes), B, C, 手ごたえ, 音の関数: 音名, D, E, F };
const dir = path.join(ROOT, 'docs', '監査_演出の画像');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'inventory.json'), JSON.stringify(out, null, 1));
console.log('A FxKit の部品 ' + 部品.length + ' 種 ／ 呼び出し ' + A.length + ' か所（index.html ' + A.filter((a) => a.ファイル === 'index.html').length + '）／ アプリから呼ばれない部品：' + 呼ばれない部品.join('・'));
console.log('B @keyframes ' + Object.keys(keyframes).length + ' 個 ／ animation で使う規則 ' + B.length + ' 本（使われていない keyframes ' + Object.values(keyframes).filter((k) => !k.使う所.length).length + '）');
console.log('C transition ' + C.length + ' 本 ／ 押した手ごたえ（:active）' + 手ごたえ.length + ' 本');
console.log('D 音の関数 ' + 音名.length + ' 個（' + 音名.join('・') + '）／ 呼び出し ' + D.length + ' か所');
console.log('E 振動の呼び出し ' + E.length + ' か所');
console.log('F JS で動かすもの ' + F.length + ' か所');
