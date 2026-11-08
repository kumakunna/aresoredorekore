#!/usr/bin/env node
// tools/stale-walk.js — 指示75 1-2 を本物の Chrome で通す：つながっていない間の「つなぎ直しています」と、押せないこと
//
//   node tools/dev-server.js（PORT=3471 など）を立ててから：
//   node tools/stale-walk.js [--base http://127.0.0.1:3471] [--out DIR]
//
// 係（/dev-login）が文化祭の部屋を作り、スマホ1台（390×844・音なし）が名前を入れて入る。テスト用プレイヤー1人（Node）も入る。
// 1 回線を切る（CDP の Network.emulateNetworkConditions offline・navigator.onLine も false になる）→ 0.3秒で幕と「電波が…」
//   → 幕の下のボタンを押しても何も送らない（押す前と後で、サーバーの名簿の ready が変わらない）→ 回線をもどす → 幕が消えるまでの時間
// 2 裏に回す（CDP の Page.setWebLifecycleState frozen・40秒のかわりに3秒）→ もどす → 幕が出て、いまの全部が届いたら消える
// 写真：幕が出た時・消えた時（--out・既定 docs/検査_1107/写真/stale・git に入れない）
// **本番には向けない**（手元の検証用サーバーだけ）
'use strict';

const fs = require('fs');
const path = require('path');
const io = require('socket.io-client');
const { launch, sleep } = require('./cdp');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : argv[i + 1]; };
const BASE = arg('base', 'http://127.0.0.1:3471');
const OUT = arg('out', path.join(__dirname, '..', 'docs', '検査_1107', '写真', 'stale'));
if (/duckdns|https:/.test(BASE)) { console.error('本番には向けません'); process.exit(1); }

async function 係() {
  const r = await fetch(BASE + '/dev-login', { redirect: 'manual' });
  const cookie = r.headers.getSetCookie().map((c) => String(c).split(';')[0]).join('; ');
  const s = io(BASE, { extraHeaders: { cookie }, transports: ['websocket'] });
  await new Promise((ok) => s.once('connect', ok));
  const call = (ev, p) => new Promise((ok) => s.timeout(8000).emit(ev, p || {}, (err, res) => ok(err ? { ok: false, error: 'timeout' } : res)));
  return { s, call };
}
const 幕 = "(function(){ var v = document.getElementById('rtStale'); return { block: !!(v && v.classList.contains('is-block')), show: !!(v && v.classList.contains('is-show')), text: v ? v.textContent : '' }; })()";

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const staff = await 係();
  let c = await staff.call('fes:create', { recreate: false });
  const code = c.code || (/（([A-Z0-9]+)）/.exec(c.message || '') || [])[1];
  if (!code) throw new Error('部屋を作れません ' + JSON.stringify(c));
  // テスト用プレイヤー（2人そろうと待合の時計が動く）
  const bot = io(BASE, { transports: ['websocket'] });
  await new Promise((ok) => bot.once('connect', ok));
  bot.on('hb:ping', () => bot.emit('hb:pong'));
  await new Promise((ok) => bot.emit('room:join', { code, name: 'ぼっと', diff: 'normal', dev: 'bot-stale' }, ok));

  const b = await launch({});
  const d = await b.newDevice('phone', { width: 390, height: 844, mobile: true });
  await d.go(BASE + '/'); await d.ev("(localStorage.setItem('acac-app-prefs', JSON.stringify({fxSpeed:'skip'})), localStorage.setItem('acac-safety-seen', '1'), 1)");
  await d.go(BASE + '/fes');
  await d.until("!!document.querySelector('#scr-v2-fes-join [data-fes-name]')", 10000, '入る画面');
  await d.ev("(function(){ var n = document.querySelector('[data-fes-name]'); n.value = 'すてい'; n.dispatchEvent(new Event('input', {bubbles:true})); document.querySelector('[data-fes-act=\"join\"]').click(); return 1; })()");
  await d.until("(document.querySelector('.screen.active')||{}).id === 'scr-v2-fes-lobby'", 8000, '待合');
  const 結果 = [];

  // 1 回線を切る
  await d.cdp('Network.enable');
  await d.cdp('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  const t0 = Date.now();
  await d.until(幕 + '.show', 3000, '幕が出る');
  await d.until(幕 + ".text.indexOf('電波') !== -1", 3000, 'オフラインの字');
  const 出た = Date.now() - t0;
  const m1 = await d.ev(幕);
  await d.shot(path.join(OUT, '1_offline.png'));
  // 幕の上から「着替え」を押す（押せたらシートが開く）
  const 押せた = await d.ev("(function(){ var b = document.querySelector('.screen.active button'); if(!b) return 'ボタンなし'; var r = b.getBoundingClientRect(); var hit = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2); return hit && (hit.id === 'rtStale' || hit.closest('#rtStale')) ? '幕がふさぐ' : '押せてしまう：' + (hit && hit.className); })()");
  await d.cdp('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  const t1 = Date.now();
  await d.until('!' + 幕 + '.block', 15000, '幕が消える');
  const 消えた = Date.now() - t1;
  await d.shot(path.join(OUT, '1_online.png'));
  結果.push({ 何: '回線を切る', 幕が出るまで: 出た + 'ms', 字: m1.text, 押す所: 押せた, もどって消えるまで: 消えた + 'ms' });

  // 2 裏に回す（凍らせる）
  await d.cdp('Page.setWebLifecycleState', { state: 'frozen' }).catch(() => null);
  await d.ev("(Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }), document.dispatchEvent(new Event('visibilitychange')), 1)").catch(() => null);
  await sleep(3000);
  await d.cdp('Page.setWebLifecycleState', { state: 'active' }).catch(() => null);
  const t2 = Date.now();
  await d.ev("(Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }), document.dispatchEvent(new Event('visibilitychange')), 1)");
  const すぐ = await d.ev(幕);
  await d.until('!' + 幕 + '.block', 8000, '届いたら消える');
  結果.push({ 何: '3秒 裏に回してもどす', もどった瞬間: すぐ.block ? '押せない' : '押せる（幕なし）', 消えるまで: (Date.now() - t2) + 'ms' });

  console.log(JSON.stringify(結果, null, 1));
  fs.writeFileSync(path.join(OUT, '結果.json'), JSON.stringify(結果, null, 1));
  await b.close(); bot.close(); staff.s.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
