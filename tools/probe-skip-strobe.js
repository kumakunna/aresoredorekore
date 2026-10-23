#!/usr/bin/env node
// tools/probe-skip-strobe.js — 演出を「スキップ」にした時、**古い画面の**くり返す動きがチカチカしていないか（指示66-1 の着手中に見つけた疑い）
//
//   node tools/probe-skip-strobe.js   [--port 3969 --cdp 9669]
//
// アプリ全体のスキップ（index.html の :root.fx-skip *）は、動きの長さを 0.001秒に縮める。
// **回数は止めない**ので、infinite の動きは 1秒に何百回もくり返し、描くたびにでたらめな位置に来る（疑い）。
// 本物の index.html の CSS のまま、くり返す動きを持つ部品を画面に1つずつ置き、
// 「ふつう」と「スキップ」で、コマごとの値（opacity・transform）を 20コマ読んで比べる。
// 読むのは getComputedStyle（演出の時計が進んでいることを先に確かめる・落とし穴28）。
// 安全の基準（正本 §6）は「点滅は1秒に3回まで」。

const path = require('path');
const { launch, sleep } = require('./cdp');
const { 配り手 } = require('./v2-lab/open');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : argv[i + 1]; };
const PORT = +arg('port', 3969), CDP = +arg('cdp', 9669);

/** くり返す動きを持つ部品（index.html の CSS の選択子に合う形で置く） */
const 部品 = [
  { 何: '待っている間の脈（.fx-alive・共通）', html: '<div class="fx-alive">待っています</div>' },
  { 何: '待っている間の脈（爆弾の世界：ランプ）', html: '<div class="fx-alive">待っています</div>', app: 'theme-bomb' },
  { 何: 'のこりわずかの時計（#scr-play .timer-chip.hurry）', html: '<div class="timer-chip hurry">10</div>', screen: 'scr-play' },
  { 何: '説明の輪（.tut-ring）', html: '<div class="tut-ring" style="position:relative;width:40px;height:40px"></div>' },
  { 何: 'AI を待つ一言（.ai-wait-note）', html: '<div class="ai-wait-note">考えています</div>' },
  { 何: 'サイコロを長押し中（.sugo-dice.holding）', html: '<div class="sugo-dice holding">3</div>' }
];

(async () => {
  const server = await 配り手(PORT);
  const br = await launch({ port: CDP });
  const 結果 = [];
  try {
    for (const fx of ['normal', 'skip']) {
      const dev = await br.newDevice('p' + fx, { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      await dev.go('http://127.0.0.1:' + PORT + '/');
      await dev.ev("(function(){ localStorage.setItem('acac-safety-seen','1'); localStorage.setItem('acac-app-prefs', JSON.stringify({fxSpeed:" + JSON.stringify(fx) + "})); return 1; })()");
      await dev.go('http://127.0.0.1:' + PORT + '/');
      await dev.until("(document.querySelector('.screen.active')||{}).id && document.querySelector('.screen.active').id !== 'scr-door'", 10000, '扉');
      const skip = await dev.ev("document.documentElement.classList.contains('fx-skip')");
      for (const p of 部品) {
        const r = await dev.ev(`new Promise(function(res){
          ${p.screen ? 'window.goToScreen(' + JSON.stringify(p.screen) + ');' : ''}
          var app = document.getElementById('app'); ${p.app ? "app.classList.add('" + p.app + "');" : ''}
          var host = document.querySelector('.screen.active');
          var w = document.createElement('div'); w.innerHTML = ${JSON.stringify(p.html)}; var e = w.firstChild; host.appendChild(e);
          var vals = [], n = 0, t0 = document.timeline.currentTime;
          (function 読む(){ var cs = getComputedStyle(e); vals.push(cs.opacity + '|' + cs.transform + '|' + cs.borderColor);
            if(++n < 20) requestAnimationFrame(読む); else {
              var an = e.getAnimations().map(function(a){ var t = a.effect.getComputedTiming(); return { 名: a.animationName, 長さ: t.duration, 回数: t.iterations === Infinity ? '∞' : t.iterations, 状態: a.playState }; });
              var 変化 = 0; for(var i = 1; i < vals.length; i++) if(vals[i] !== vals[i-1]) 変化++;
              var 種類 = {}; vals.forEach(function(v){ 種類[v] = 1; });
              e.remove(); ${p.app ? "app.classList.remove('" + p.app + "');" : ''}
              res({ 動き: an, '20コマのうち変わった回数': 変化, '値の種類': Object.keys(種類).length, 例: vals.slice(0, 6), 時計: Math.round(document.timeline.currentTime - t0) }); } })();
        })`);
        結果.push(Object.assign({ 演出: fx === 'skip' ? 'スキップ' : 'ふつう', 何: p.何, fxSkipの印: skip }, r));
      }
      await dev.close();
    }
  } finally { await br.close(); server.close(); }
  for (const x of 結果) {
    console.log(x.演出.padEnd(5) + ' ' + x.何);
    console.log('       動き: ' + x.動き.map((a) => a.名 + ' ' + a.長さ + 'ms×' + a.回数 + ' ' + a.状態).join('・') +
      '  20コマで変わった回数: ' + x['20コマのうち変わった回数'] + '  値の種類: ' + x.値の種類 + '  時計: ' + x.時計 + 'ms');
    console.log('       はじめの6コマ: ' + x.例.map((v) => v.split('|')[0]).join(' → '));
  }
})().catch((e) => { console.error(e); process.exit(2); });
