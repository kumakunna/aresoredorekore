#!/usr/bin/env node
// tools/probe-62-checks.js — 指示62 1-3 の「見るだけ」の2つを、実物の画面で撮って確かめる
//
//   node tools/probe-62-checks.js [--port 3120] [--cdp 9420]
//
//   ① 設定「安全に関する設定」の「体を動かす遊びをする」の説明に、棚から下ろした「実物解除」が残っているか
//   ② 季節イベント「リリース記念」（public/js/titles.js の SEASONS・9/24〜10/24）が、いま画面に出ているか
//      （扉の一言の 🎊・棚の帯・棚の金色の霞）。**変えない、見るだけ**
//
// 端末はログインしていないゲスト（375×667・QRから来た人と同じ）。
// 画像は docs/監査_審査会の指摘_画像/_1-3/ に置く（git には入れない）。

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { launch, sleep } = require('./cdp');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : argv[i + 1]; };
const PORT = String(arg('port', '3120'));
const BASE = 'http://localhost:' + PORT;
const OUT = path.join(__dirname, '..', 'docs', '監査_審査会の指摘_画像', '_1-3');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  let server = null, up = false;
  try { up = (await fetch(BASE + '/')).ok; } catch (e) {}
  if (!up) {
    server = spawn(process.execPath, [path.join(__dirname, 'dev-server.js')], { env: Object.assign({}, process.env, { PORT }), stdio: 'ignore' });
    for (let i = 0; i < 60 && !up; i++) { await sleep(250); try { up = (await fetch(BASE + '/')).ok; } catch (e) {} }
  }
  const b = await launch({ port: parseInt(arg('cdp', '9420'), 10) });
  const 結果 = { 日付: new Date().toISOString().slice(0, 10) };
  try {
    const d = await b.newDevice('ゲスト', { width: 375, height: 667, mobile: true, deviceScaleFactor: 2 });
    await d.go(BASE + '/');
    // ② 扉の一言（::after の 🎊）は扉が開く前に撮る
    結果.扉の一言 = await d.ev("(function(){var l=document.querySelector('#scr-door .door-lead');return l?{文字:l.textContent.trim(),後ろ:getComputedStyle(l,'::after').content}:null;})()");
    結果.季節のclass = await d.ev("document.getElementById('app').className.split(' ').filter(function(c){return /^season-/.test(c);})");
    await d.shot(path.join(OUT, '1_扉.jpg'));
    await d.until("document.getElementById('safetyGate').style.display==='flex'||(document.querySelector('.screen.active')||{}).id!=='scr-door'", 10000);
    if (await d.ev("document.getElementById('safetyGate').style.display==='flex'")) { await d.shot(path.join(OUT, '2_安全の案内.jpg')); await d.click('#sgStartBtn'); }
    await d.until("(document.querySelector('.screen.active')||{}).id==='scr-entry'", 10000);
    await sleep(600);
    await d.shot(path.join(OUT, '3_入口.jpg'));
    await d.click('[data-entry="choose"]');
    await d.until("(document.querySelector('.screen.active')||{}).id!=='scr-entry'", 10000);
    await sleep(900);
    結果.ゲームをえらぶの先 = await d.screen();
    if (結果.ゲームをえらぶの先 !== 'scr-shelf') {
      await d.shot(path.join(OUT, '3b_ゲームをえらぶの先.jpg'));
      // ゲストは棚の前に止められる。見るだけで棚に入る道があれば押す
      結果.棚の前のボタン = await d.ev("Array.from(document.querySelectorAll('.screen.active button')).filter(function(x){return x.getBoundingClientRect().width>0;}).map(function(x){return x.innerText.trim().replace(/\s+/g,' ');})");
      await d.ev("(function(){var b=Array.from(document.querySelectorAll('.screen.active button')).find(function(x){return /見る|棚|のぞ|ゲスト/.test(x.textContent)&&x.getBoundingClientRect().width>0;}); if(b) b.click(); return !!b;})()");
      await sleep(1200);
    }
    結果.棚の帯 = await d.ev("(function(){var b=document.getElementById('seasonBadge');if(!b)return null;var r=b.getBoundingClientRect();return {見える:r.width>0&&getComputedStyle(b).display!=='none',文字:b.textContent.trim(),y:Math.round(r.top),h:Math.round(r.height)};})()");
    結果.棚の時の季節class = await d.ev("document.getElementById('app').className.split(' ').filter(function(c){return /^season-/.test(c);})");
    結果.棚の霞 = await d.ev("getComputedStyle(document.querySelector('.shelf-stage')||document.getElementById('scr-shelf')).backgroundImage.slice(0,120)");
    await d.shot(path.join(OUT, '4_棚.jpg'));
    // ① 設定：棚の⚙ → 安全に関する設定
    const gear = await d.ev("(function(){var g=Array.from(document.querySelectorAll('.screen.active .gear-btn, .screen.active [data-open-settings], .screen.active button')).find(function(x){return /⚙/.test(x.textContent)&&x.getBoundingClientRect().width>0;}); if(!g) return false; g.click(); return true;})()");
    結果.歯車 = gear;
    await sleep(900);
    await d.shot(path.join(OUT, '5_設定.jpg'));
    const row = await d.ev("(function(){var r=Array.from(document.querySelectorAll('.set-row[data-setpage=safety]')).find(function(x){return x.getBoundingClientRect().width>0;}); if(!r) return false; r.click(); return true;})()");
    結果.安全の行 = row;
    await sleep(900);
    await d.ev("(function(){var t=document.getElementById('setBodyToggle'); if(t) t.scrollIntoView({block:'center'}); return !!t;})()");
    await sleep(400);
    結果.体を動かす = await d.ev("(function(){var t=document.getElementById('setBodyToggle'); if(!t) return null; var row=t.closest('.toggle-row-mini'); var r=t.getBoundingClientRect(); return {見える:r.width>0, 文字: row?row.innerText.trim().replace(/\\s+/g,' '):''};})()");
    await d.shot(path.join(OUT, '6_安全に関する設定_体を動かす.jpg'));
    結果.ページの字 = await d.ev("(document.querySelector('.set-page[data-page=safety]')||{}).innerText||''");
    結果.エラー = d.logs;
  } finally {
    await b.close();
    if (server) server.kill();
  }
  fs.writeFileSync(path.join(OUT, '記録.json'), JSON.stringify(結果, null, 2));
  console.log(JSON.stringify(結果, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
