#!/usr/bin/env node
// tools/aresore-walk.js — あれそれどれこれ（1台・今までの見た目）を、本物の Chrome で「ゲームをえらぶ」から遊ぶ画面までたどり、
// 画面ごとに「左上の ← の丸」と「見出し・時計」の四角が重なっていないか、「不正解」の知らせが時計を隠さないかを測る（指示71-7・68-0b C21）
//
//   node tools/aresore-walk.js [--port 3039] [--cdp 9354]
//
// 検証用サーバー（tools/dev-server.js）。375×667。画面ごとの写真と記録は docs/監査_指示71/aresore/（git に入れない）。音は出さない（tools/cdp.js）
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { launch, sleep } = require('./cdp');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : argv[i + 1]; };
const PORT = Number(arg('port', 3039)), CDP = Number(arg('cdp', 9354));
const OUT = path.join(ROOT, 'docs', '監査_指示71', 'aresore');
fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://localhost:' + PORT;

// ← の丸と、画面の見出し（h2・.scr-title・.wiz-head・時計）の重なり（px）
const 重なり = `(function(){
  var s = document.querySelector('.screen.active'); if(!s) return null;
  var b = document.getElementById('floatingBackBtn');
  var vis = function(e){ if(!e) return false; var cs = getComputedStyle(e); var r = e.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > 0.05 && r.width > 0 && r.height > 0; };
  var hs = [].slice.call(s.querySelectorAll('h2, .scr-title, .wiz-head, .timer-chip, .v2-hd-ttl')).filter(vis);
  var out = [];
  if (vis(b)) {
    var a = b.getBoundingClientRect();
    hs.forEach(function(h){ var rg = document.createRange(); rg.selectNodeContents(h); var r = rg.getBoundingClientRect(); /* 字そのものの四角（すき間を含めない） */ var w = Math.min(a.right, r.right) - Math.max(a.left, r.left), y = Math.min(a.bottom, r.bottom) - Math.max(a.top, r.top);
      if (w > 1 && y > 1) out.push({ 何: (h.className || h.tagName) + '「' + (h.textContent || '').trim().slice(0, 12) + '」', w: Math.round(w), h: Math.round(y) }); });
  }
  return { id: s.id, back: vis(b), 重なり: out };
})()`;

(async () => {
  const log = fs.openSync(path.join(OUT, 'server.log'), 'w');
  const srv = spawn(process.execPath, ['tools/dev-server.js'], { cwd: ROOT, stdio: ['ignore', log, log], env: Object.assign({}, process.env, { PORT: String(PORT) }) });
  let up = false;
  for (let i = 0; i < 80 && !up; i++) { await sleep(250); try { up = (await fetch(BASE + '/')).ok; } catch (e) {} }
  const br = await launch({ port: CDP });
  const 記録 = { 画面: [], 知らせ: null };
  let ok = false;
  try {
    const d = await br.newDevice('スマホ', { width: 375, height: 667, mobile: true, deviceScaleFactor: 2 });
    await d.go(BASE + '/dev-login');   // 1台で始めるところでログインが要る
    await d.go(BASE + '/');
    await d.ev("(function(){ localStorage.setItem('acac-app-prefs', JSON.stringify({ fxSpeed: 'skip' })); localStorage.setItem('acac-safety-seen', '1'); return 1; })()");
    await d.go(BASE + '/');
    await d.until("(document.querySelector('.screen.active') || {}).id === 'scr-v2-home'", 10000, '入口');
    await d.ev("document.querySelector('#scr-v2-home [data-home-act=\"one\"]').click()");
    await d.until("(document.querySelector('.screen.active') || {}).id === 'scr-v2-pick'", 8000, 'ゲームをえらぶ');
    await d.ev("(function(){ if (window.shelfShowProbe) window.shelfShowProbe.showAll(true); var c = document.querySelector('#scr-v2-pick [data-home-id=\"aresoredorekore\"]'); c.click(); return 1; })()");
    await sleep(300);
    await d.ev("(function(){ var g = document.querySelector('#scr-v2-pick [data-home-cta] [data-home-act]'); if (g) g.click(); return 1; })()");
    // 遊ぶ画面まで：画面ごとに測って写し、いちばん先へ進むボタンを押す
    const 進む = ['#modeNextBtn', '#setupNextBtn', '#setupStartBtn', '#rulesStartBtn', '#readyGoBtn', '#readyBtn', '#startPlayBtn', '#gameNextBtn'];
    for (let step = 0; step < 14; step++) {
      await sleep(500);
      const m = await d.ev(重なり);
      if (!m) continue;
      if (!記録.画面.some((x) => x.id === m.id)) { 記録.画面.push(m); await d.shot(path.join(OUT, step + '-' + m.id + '.png')); }
      if (m.id === 'scr-play') break;
      if (m.id === 'scr-ready') {   // 準備の画面は長押し（本物のマウスで押し続ける）
        const c = await d.ev("(function(){ var r = document.getElementById('holdBtn').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()");
        await d.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', buttons: 1, clickCount: 1 });
        await sleep(2500);
        await d.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', buttons: 0, clickCount: 1 });
        continue;
      }
      // 人数の入力が要る画面は、2人を入れる
      await d.ev("(function(){ var add = document.getElementById('addPlayerBtn'); var inp = document.getElementById('playerNameInput'); if (inp && add && document.querySelectorAll('#playerList li, #playerList .player-item').length < 2) { ['あき','びび'].forEach(function(n){ inp.value = n; add.click(); }); } return 1; })()");
      const pushed = await d.ev('(function(){ var ids = ' + JSON.stringify(進む) + '; for (var i = 0; i < ids.length; i++) { var b = document.querySelector(".screen.active " + ids[i]); if (b && !b.disabled && b.offsetParent) { b.click(); return ids[i]; } } var p = document.querySelector(".screen.active .btn-main:not([disabled]), .screen.active .v2-btn.is-pri:not([disabled])"); if (p) { p.click(); return "pri"; } return null; })()');
      if (!pushed) break;
    }
    // 遊ぶ画面で「不正解」を押して、知らせと時計の重なりを測る
    if ((await d.ev("(document.querySelector('.screen.active') || {}).id")) === 'scr-play') {
      await d.ev("(function(){ var b = document.getElementById('btnWrong'); if (b) b.click(); return 1; })()");
      await sleep(200);
      記録.知らせ = await d.ev(`(function(){ var t = document.getElementById('foulToast'), c = document.getElementById('playTimer');
        var a = t.getBoundingClientRect(), r = c.getBoundingClientRect(); var w = Math.min(a.right, r.right) - Math.max(a.left, r.left), y = Math.min(a.bottom, r.bottom) - Math.max(a.top, r.top);
        return { 字: t.textContent, 見える: t.classList.contains('show'), 時計と重なる: w > 1 && y > 1 ? Math.round(w) + 'x' + Math.round(y) : 'なし' }; })()`);
      await d.shot(path.join(OUT, 'play-不正解.png'));
    }
    記録.例外 = d.logs;
    ok = 記録.画面.some((x) => x.id === 'scr-play') && 記録.画面.every((x) => !x.重なり.length) && 記録.知らせ && 記録.知らせ.時計と重なる === 'なし' && !d.logs.length;
  } catch (e) {
    記録.止まった = String(e && e.message);
  } finally {
    fs.writeFileSync(path.join(OUT, '記録.json'), JSON.stringify(記録, null, 1));
    try { await br.close(); } catch (e) {}
    srv.kill();
  }
  記録.画面.forEach((x) => console.log('・' + x.id + (x.back ? '（←あり）' : '') + '：' + (x.重なり.length ? JSON.stringify(x.重なり) : '重なりなし')));
  console.log('・不正解の知らせ：' + JSON.stringify(記録.知らせ) + (記録.止まった ? '・止まった：' + 記録.止まった : ''));
  console.log(ok ? '✔ ← と見出し・知らせと時計の重なりなし' : '✖ 記録.json を見てください');
  process.exit(ok ? 0 : 1);
})();
