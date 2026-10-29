#!/usr/bin/env node
// tools/fes-restart-shot.js — 文化祭の部屋で「サーバーが作り直された」前と後の写真（2026-10-29）
//
//   node tools/fes-restart-shot.js   [--port 3302] [--cdp 9702] [--out DIR（既定 docs/監査_指示66の画像/fes-restart）]
//
// 検証用サーバー（tools/dev-server.js）を自分で立て、係・TV・スマホ1台で部屋に入ってから、**サーバーを止めて立て直す**。
// 撮るのは：①前（待合）②後（スマホと TV は「作り直しています」・係は「部屋が消えました」）③係が作ったあと（スマホは入る画面・TV は待合）。
// 検証の Chrome は音を消してある（tools/cdp.js の --mute-audio）
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { launch, sleep } = require('./cdp');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const PORT = +arg('port', 3302), CDP = +arg('cdp', 9702);
const OUT = path.resolve(arg('out', path.join(ROOT, 'docs', '監査_指示66の画像', 'fes-restart')));
const base = 'http://localhost:' + PORT;
const t0 = Date.now();
const log = (...a) => console.log(((Date.now() - t0) / 1000).toFixed(1).padStart(6) + 's ' + a.join(' '));

async function 立てる() {
  const out = fs.openSync(path.join(require('os').tmpdir(), 'fes-restart-server-' + PORT + '.log'), 'a');
  const child = spawn(process.execPath, [path.join(__dirname, 'dev-server.js')], { env: Object.assign({}, process.env, { PORT: PORT }), stdio: ['ignore', out, out] });
  let up = false;
  for (let i = 0; i < 80 && !up; i++) { await sleep(250); try { up = (await fetch(base + '/')).ok; } catch (e) {} }
  if (!up) throw new Error('検証用サーバーが立ちません（port ' + PORT + '）');
  return child;
}
async function 止める(child) {
  child.kill();
  for (let i = 0; i < 40; i++) { await sleep(150); try { await fetch(base + '/'); } catch (e) { return; } }
}
/** 開いて、安全の案内（はじめの1回）と扉を通す（tools/fes-walk.js と同じ） */
async function 開く(d, url) {
  await d.go(base + url);
  for (let i = 0; i < 40; i++) {
    const st = await d.ev("({gate:(function(){var g=document.getElementById('safetyGate');return !!g&&getComputedStyle(g).display!=='none';})(),scr:(document.querySelector('.screen.active')||{}).id})");
    if (st.gate) { await d.ev("document.getElementById('sgStartBtn').click()"); await sleep(300); continue; }
    if (st.scr && st.scr !== 'scr-door') return st.scr;
    await d.ev("(function(){var p=document.getElementById('doorPanel');if(p)p.click();})()"); await sleep(300);
  }
  return d.screen();
}
const 押す = (d, sel) => d.ev('(function(){var b=document.querySelector(' + JSON.stringify(sel) + ');if(b&&!b.disabled){b.click();return true;}return false;})()');
const 撮る = (d, name) => d.shot(path.join(OUT, name + '.jpg')).catch(() => {});
const 字 = (d) => d.ev("((document.querySelector('.screen.active')||{}).id||'')+' | '+((document.querySelector('.screen.active')||{}).textContent||'').replace(/\\s+/g,' ').slice(0,90)");

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.readdirSync(OUT).filter((f) => /\.jpg$/.test(f)).forEach((f) => fs.unlinkSync(path.join(OUT, f)));
  let child = await 立てる();
  const b = await launch({ port: CDP });
  const 記録 = [];
  try {
    const staff = await b.newDevice('係', { width: 390, height: 844, mobile: true });
    await staff.go(base + '/dev-login');
    await 開く(staff, '/fes?staff=1');
    await sleep(800);
    if (!(await 押す(staff, '[data-fes-act=create]'))) { await 押す(staff, '[data-v2-open="#v2Recreate"]'); await sleep(400); await 押す(staff, '[data-v2-act=recreate]'); }
    await sleep(1500);
    const tv = await b.newDevice('TV', { width: 1280, height: 720 });
    await 開く(tv, '/fes?tv=1');
    const ph = await b.newDevice('スマホ', { width: 390, height: 844, mobile: true });
    await 開く(ph, '/fes');
    await ph.ev("(function(){var n=document.querySelector('[data-fes-name]');n.value='ふう';n.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()");
    await 押す(ph, '[data-fes-diff=normal]'); await sleep(150);
    await 押す(ph, '[data-fes-act=join]');
    await ph.until("(document.querySelector('.screen.active')||{}).id==='scr-v2-fes-lobby'", 10000, '入れた');
    await sleep(1500);
    for (const [d, n] of [[ph, 'スマホ'], [tv, 'TV'], [staff, '係']]) { await 撮る(d, '1_前_' + n); 記録.push('前 ' + n + '：' + await 字(d)); }
    log('前を撮った。サーバーを止めて立て直す');
    await 止める(child);
    child = await 立てる();
    log('立て直した。つなぎ直しを待つ');
    await sleep(9000);
    for (const [d, n] of [[ph, 'スマホ'], [tv, 'TV'], [staff, '係']]) { await 撮る(d, '2_後_' + n); 記録.push('後 ' + n + '：' + await 字(d)); }
    log('後を撮った。係が部屋を作る');
    await 押す(staff, '[data-fes-act=create]');
    const tc = Date.now();
    await tv.until("/room=/.test(location.search)", 15000, 'TV が新しい部屋へ移る');
    log('TV が新しい部屋へ移った', ((Date.now() - tc) / 1000).toFixed(1) + '秒');
    await sleep(3000);
    // くらべる：作ったあとに、まっさらの TV で /fes?tv=1 を開いた時
    const tv2 = await b.newDevice('TV2', { width: 1280, height: 720 });
    await 開く(tv2, '/fes?tv=1'); await sleep(3000);
    await 撮る(tv2, '3_作ったあと_まっさらのTV'); 記録.push('作ったあと まっさらのTV：' + await 字(tv2));
    await sleep(1500);
    for (const [d, n] of [[ph, 'スマホ'], [tv, 'TV'], [staff, '係']]) { await 撮る(d, '3_作ったあと_' + n); 記録.push('作ったあと ' + n + '：' + await 字(d)); }
    記録.forEach((x) => console.log(x));
  } finally {
    try { await b.close(); } catch (e) {}
    try { child.kill(); } catch (e) {}
  }
  log('写真：' + path.relative(ROOT, OUT));
})().catch((e) => { console.error(e); process.exit(1); });
