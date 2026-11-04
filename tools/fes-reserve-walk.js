#!/usr/bin/env node
// tools/fes-reserve-walk.js — 満員の時の予約を、本物の Chrome で1回通す（指示71 追記1 の門）
//
//   node tools/fes-reserve-walk.js [--port 3321] [--cdp 9721]
//
// 検証用サーバーで文化祭の部屋を作り、ボット16人（socket）で満員にする。本物の Chrome のスマホが /fes から入ろうとして満員 →
// 予約（1番目）。ページを開き直す（つなぎも切れる）→ 合い札で同じ予約にもどり、「予約しました（1番目）」のまま。
// ボットが1人出ていく → スマホに「どうぞ！」（画面いっぱい）→ そのまま自分で入って待合へ。記録は docs/監査_指示71/fes-reserve/
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ioClient = require('socket.io-client');
const { launch, sleep } = require('./cdp');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : argv[i + 1]; };
const PORT = Number(arg('port', 3321)), CDP = Number(arg('cdp', 9721));
const OUT = path.join(__dirname, '..', 'docs', '監査_指示71', 'fes-reserve');
fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://localhost:' + PORT;
const 記録 = [];
const note = (k, v) => { 記録.push({ k, v }); console.log('・' + k + '：' + (typeof v === 'string' ? v : JSON.stringify(v))); };

(async () => {
  const out = fs.openSync(path.join(OUT, 'server.log'), 'w');
  const srv = spawn(process.execPath, [path.join(__dirname, 'dev-server.js')], { env: Object.assign({}, process.env, { PORT: String(PORT) }), stdio: ['ignore', out, out] });
  let up = false;
  for (let i = 0; i < 80 && !up; i++) { await sleep(250); try { up = (await fetch(BASE + '/')).ok; } catch (e) {} }
  const cookie = (await fetch(BASE + '/dev-login')).headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const staff = ioClient(BASE, { transports: ['websocket'], extraHeaders: { Cookie: cookie } });
  await new Promise((r) => staff.on('connect', r));
  const made = await new Promise((r) => staff.emit('fes:create', { recreate: true }, r));
  const code = made.code;
  const bots = [];
  for (let i = 0; i < 16; i++) {
    const b = ioClient(BASE, { transports: ['websocket'], forceNew: true });
    b.on('hb:ping', () => b.emit('hb:pong'));
    await new Promise((r) => b.on('connect', r));
    const j = await new Promise((r) => b.emit('room:join', { code, name: 'ボ' + (i + 1), diff: 'normal' }, r));
    if (!j.ok) throw new Error('ボットが入れない：' + JSON.stringify(j));
    bots.push(b);
  }
  note('満員', code + '・ボット16人');
  const br = await launch({ port: CDP });
  let ok = false;
  try {
    const d = await br.newDevice('スマホ', { width: 390, height: 844, mobile: true, deviceScaleFactor: 2 });
    await d.go(BASE + '/');
    await d.ev("(function(){ localStorage.setItem('acac-app-prefs', JSON.stringify({ fxSpeed: 'skip' })); localStorage.setItem('acac-safety-seen','1'); return 1; })()");
    await d.go(BASE + '/fes');
    await d.until("!!document.querySelector('[data-fes-name]')", 15000, '入る画面');
    await d.ev("(function(){ var n = document.querySelector('[data-fes-name]'); n.value = 'まつ'; n.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('[data-fes-diff=normal]').click(); return 1; })()");
    await sleep(200);
    await d.ev("document.querySelector('[data-fes-act=join]').click()");
    await d.until("!!document.querySelector('[data-fes-act=reserve]')", 6000, '満員 → 予約のボタン');
    await d.ev("document.querySelector('[data-fes-act=reserve]').click()");
    await d.until("/予約しました（1番目/.test(document.getElementById('scr-v2-fes-join').textContent)", 6000, '予約しました（1番目）');
    note('予約した', await d.ev("document.querySelector('#scr-v2-fes-join .v2-note').textContent"));
    await d.shot(path.join(OUT, '1-予約した.png'));
    // 開き直す（つなぎも切れる）→ 合い札でもどる
    await d.go(BASE + '/fes');
    await d.until("/予約しました（1番目/.test((document.getElementById('scr-v2-fes-join') || {}).textContent || '')", 15000, '開き直しても予約しました（1番目）');
    note('開き直した', await d.ev("document.querySelector('#scr-v2-fes-join .v2-note').textContent"));
    await d.shot(path.join(OUT, '2-開き直した.png'));
    // 1人出ていく → 「どうぞ！」→ 自分で入って待合へ
    await new Promise((r) => bots[0].emit('room:leave', { code }, r));
    bots[0].close();
    const どうぞ = await d.until("(function(){ var t = document.querySelector('#scr-v2-fes-join .v2-turn'); var a = (document.querySelector('.screen.active') || {}).id; return t ? 'どうぞの画面' : (a === 'scr-v2-fes-lobby' ? '待合' : null); })()", 10000, '「どうぞ」か待合');
    note('席が空いた', どうぞ);
    await d.until("(document.querySelector('.screen.active') || {}).id === 'scr-v2-fes-lobby'", 10000, '自分で入って待合へ');
    note('入れた', '待合（scr-v2-fes-lobby）');
    note('合い札', await d.ev("localStorage.getItem('acac-fes-reserve') === null ? '入ったので忘れた' : '残っている'"));
    await d.shot(path.join(OUT, '3-入れた.png'));
    note('例外', d.logs.length);
    ok = d.logs.length === 0;
  } catch (e) {
    note('止まった', e.message);
  } finally {
    fs.writeFileSync(path.join(OUT, '記録.json'), JSON.stringify(記録, null, 1));
    try { await br.close(); } catch (e) {}
    bots.forEach((b) => b.close()); staff.close(); srv.kill();
    console.log(ok ? '通しおわり' : '通しが止まりました');
    process.exit(ok ? 0 : 1);
  }
})();
