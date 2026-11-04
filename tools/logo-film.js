#!/usr/bin/env node
// tools/logo-film.js — 起動のロゴの動き（指示71-4・68-7 の3）を、本物の Chrome で時刻ごとに撮って測る
//
//   node tools/logo-film.js [--port 3361] [--cdp 9761]
//
// 検証用サーバー（tools/dev-server.js）を立て、記憶の空のスマホ（390×844）で / を開く。
// ロゴの動き（CSS の animation）を全部止めて、0.00・0.10・0.20・0.40・0.62・0.90・1.30秒に時刻を合わせて写す（tools/v2-film.js と同じ「止めた時計」）。
// 同時に、各部品の不透明度を読んで、見本（docs/指示68/見本_ロゴの動き.html）の時間と合っているかを確かめる：
//   半円3つ：0 / 0.08 / 0.16 秒に出はじめ、0.42秒で出きる・「あ」：0.36秒から 0.40秒・英字：0.62秒から 0.25秒
// そのあと、同じ日にもう一度開くと出ない・演出「なし」でも出ない・/fes でも出ない、を見る。写真と記録は docs/監査_指示71/logo-film/
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { launch, sleep } = require('./cdp');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : argv[i + 1]; };
const PORT = +arg('port', 3361), CDP = +arg('cdp', 9761);
const OUT = path.join(__dirname, '..', 'docs', '監査_指示71', 'logo-film');
fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://localhost:' + PORT;

// 見本の時間（秒）：部品ごとに [出はじめ, 長さ]
const 見本 = { s3: [0, 0.42], s2: [0.08, 0.42], s1: [0.16, 0.42], a: [0.36, 0.40], w: [0.62, 0.25] };
const 時刻 = [0, 0.1, 0.2, 0.4, 0.62, 0.9, 1.3];

const 読む = (t) => `(function(t){
  var sc = document.getElementById('doorScene');
  document.getAnimations().forEach(function(a){ a.pause(); a.currentTime = t * 1000; });
  var o = {};
  ['s3','s2','s1','a','w'].forEach(function(k){ var n = sc.querySelector('.' + k); o[k] = n ? +(+getComputedStyle(n).opacity).toFixed(2) : null; });
  o.play = sc.classList.contains('play');
  return o;
})(${t})`;

(async () => {
  const out = fs.openSync(path.join(OUT, 'server.log'), 'w');
  const srv = spawn(process.execPath, [path.join(__dirname, 'dev-server.js')], { env: Object.assign({}, process.env, { PORT: String(PORT) }), stdio: ['ignore', out, out] });
  let up = false;
  for (let i = 0; i < 80 && !up; i++) { await sleep(250); try { up = (await fetch(BASE + '/')).ok; } catch (e) {} }
  const br = await launch({ port: CDP });
  const 記録 = { 時刻ごと: [], ずれ: [], 二回目: null, なし: null, fes: null };
  let ok = true;
  try {
    const d = await br.newDevice('スマホ', { width: 390, height: 844, mobile: true, deviceScaleFactor: 1 });
    // 安全の案内をもう見た端末（ふだんの2日目の朝）。/fes ではロゴが出ないので、そこで印だけ置いてから / を開く
    await d.go(BASE + '/fes');
    await d.ev("(function(){ localStorage.setItem('acac-safety-seen', '1'); localStorage.removeItem('acac-logo-day'); return 1; })()");
    await d.go(BASE + '/');
    await d.until("document.getElementById('doorScene') && document.getElementById('doorScene').classList.contains('play')", 8000, 'ロゴが動きはじめる');
    for (const t of 時刻) {
      const o = await d.ev(読む(t));
      await d.ev('new Promise(function(r){ requestAnimationFrame(function(){ requestAnimationFrame(function(){ r(1); }); }); })');
      await d.shot(path.join(OUT, 'logo-' + t.toFixed(2) + 's.png'));
      記録.時刻ごと.push(Object.assign({ 秒: t }, o));
      // 見本との照らし合わせ：出はじめ前は 0、出きったら 1、途中は 0 と 1 の間
      Object.keys(見本).forEach((k) => {
        const [s, len] = 見本[k], v = o[k];
        const want = t <= s ? 0 : (t >= s + len ? 1 : null);
        if (want !== null && Math.abs(v - want) > 0.02) 記録.ずれ.push({ 秒: t, 部品: k, 不透明度: v, 見本: want });
        if (want === null && !(v > 0 && v <= 1)) 記録.ずれ.push({ 秒: t, 部品: k, 不透明度: v, 見本: '0と1の間' });
      });
    }
    await d.ev("(function(){ document.getAnimations().forEach(function(a){ a.play(); }); return 1; })()");
    // はじめての端末は安全の案内が出る（ロゴは読みこみの間にその下で動き終わっている）。人と同じく「はじめる」を押す
    await d.until("(function(){ var g = document.getElementById('safetyGate'); if (g && g.style.display !== 'none') { document.getElementById('sgStartBtn').click(); } return (document.querySelector('.screen.active') || {}).id === 'scr-v2-home'; })()", 15000, '入口へ');
    // 同じ日の2回目
    await d.go(BASE + '/');
    await sleep(1500);
    記録.二回目 = await d.ev("document.getElementById('doorScene').classList.contains('play') ? '出た' : '出ない'");
    // 演出「なし」
    const n = await br.newDevice('なし', { width: 390, height: 844, mobile: true, deviceScaleFactor: 1 });
    await n.go(BASE + '/'); await n.ev("(function(){ localStorage.clear(); localStorage.setItem('acac-app-prefs', JSON.stringify({ fxSpeed: 'skip' })); return 1; })()");
    await n.go(BASE + '/'); await sleep(1500);
    記録.なし = await n.ev("document.getElementById('doorScene').classList.contains('play') ? '出た' : '出ない'");
    // /fes
    const f = await br.newDevice('fes', { width: 390, height: 844, mobile: true, deviceScaleFactor: 1 });
    await f.go(BASE + '/fes'); await sleep(2000);
    記録.fes = await f.ev("document.getElementById('doorScene').classList.contains('play') ? '出た' : '出ない'");
    記録.例外 = [].concat(d.logs, n.logs, f.logs);
    ok = !記録.ずれ.length && 記録.二回目 === '出ない' && 記録.なし === '出ない' && 記録.fes === '出ない' && !記録.例外.length;
  } catch (e) {
    記録.失敗 = String(e && e.message || e); ok = false;
  } finally {
    fs.writeFileSync(path.join(OUT, '記録.json'), JSON.stringify(記録, null, 1));
    try { await br.close(); } catch (e) {}
    srv.kill();
    console.log(JSON.stringify({ ずれ: 記録.ずれ.length, 二回目: 記録.二回目, なし: 記録.なし, fes: 記録.fes, 例外: (記録.例外 || []).length, 失敗: 記録.失敗 }));
    console.log(ok ? '✔ ロゴの動きは見本の時間どおり・2回目／演出「なし」／/fes では出ない' : '✖ 記録.json を見てください');
    process.exit(ok ? 0 : 1);
  }
})();
