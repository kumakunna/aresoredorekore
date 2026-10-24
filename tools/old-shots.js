#!/usr/bin/env node
// tools/old-shots.js — 入れかえ前の「ふだんの画面」を撮る（指示66-3 のまとめで、新しい画面・見本と並べるため）
//
//   git worktree add ../aresore-66base <入れかえ前のコミット>
//   node tools/old-shots.js --base ../aresore-66base      … 入口・棚・部屋の画面（つくる／入る）・待合・ゲーム・モード・つぎは？・TV の待合
//   --port 3971  --cdp 9671  --out DIR（既定 docs/監査_指示66の画像/old）
//
// サーバーも bot も要らない：入れかえ前の public/ を配り、socket.io は tests/harness.js の疑似（tools/v2-lab/open.js の配り手）。
// ログインが要る画面は、ページの fetch の `/api/auth/me` だけを「ログインしている」に差しかえて開く（撮るためだけ。アプリの中身は変えない）。
// 部屋の知らせは疑似 socket の返事として置く（名前と人数は見本 entry.html の E3 と同じ6人）

const fs = require('fs');
const path = require('path');
const { launch, sleep } = require('./cdp');
const { 配り手 } = require('./v2-lab/open');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const BASE = arg('base', null);
if (!BASE) { console.error('--base（入れかえ前の作業ツリー）を渡してください'); process.exit(2); }
const PORT = +arg('port', 3971), CDP = +arg('cdp', 9671);
const OUT = path.resolve(arg('out', path.join(ROOT, 'docs', '監査_指示66の画像', 'old')));

const 部屋 = (meId, game) => ({
  code: 'TST754', ownerUserId: 1, ownerUsername: 'kuma', hostMemberId: 'm1', playerCount: 6, memberCount: 7,
  ready: { count: 0, total: 6, waitingNames: [], all: false },
  members: [['m1', 'ふう', '🙂'], ['m2', 'ひろ', '🌙'], ['m3', 'びび', '🐺'], ['m4', 'ちか', '🎈'], ['m5', 'でん', '💣'], ['m6', 'くまくん', '🐤']]
    .map(([id, name, icon]) => ({ id, name, icon, title: 'はじまりの一歩', role: 'player', connected: true, isHost: id === 'm1', ready: false }))
    .concat([{ id: 'tv', name: 'TV', icon: '', title: '', role: 'bigscreen', connected: true, isHost: false, ready: false }]),
  state: { phase: 'lobby', game: game || null, data: game ? { modeId: game } : {} }
});
const ログイン = "(function(){ var f = window.fetch; window.fetch = function(u, o){ if(String(u).indexOf('/api/auth/me') !== -1) return Promise.resolve(new Response(JSON.stringify({ user: { id: 1, username: 'くまくん' } }), { status: 200, headers: { 'Content-Type': 'application/json' } })); if(String(u).indexOf('/api/titles') !== -1) return Promise.resolve(new Response(JSON.stringify({ unlocked: [], equipped: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } })); return f.apply(this, arguments); }; })();";
const 止める = "(function(){ var s=document.createElement('style'); s.textContent='*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}'; document.head.appendChild(s); return 1; })()";

async function 開く(dev, login) {
  if (login) await dev.raw('Page.addScriptToEvaluateOnNewDocument', { source: ログイン });
  await dev.go('http://127.0.0.1:' + PORT + '/');
  await dev.ev("(function(){ localStorage.clear(); localStorage.setItem('acac-safety-seen','1'); return 1; })()");
  await dev.go('http://127.0.0.1:' + PORT + '/');
  await dev.until("(document.querySelector('.screen.active')||{}).id && document.querySelector('.screen.active').id !== 'scr-door'", 10000, '扉');
  await dev.until("document.fonts.status==='loaded'", 15000, '書体');
  await dev.ev(止める);
}
async function 撮る(dev, name) { await sleep(500); await dev.shot(path.join(OUT, name + '.png')); console.log('✔', name, await dev.screen()); }
const 置く = (dev, js) => dev.ev('(function(){ window.__rtFake.replies = ' + js + '; return 1; })()');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await 配り手(PORT, path.resolve(BASE, 'public'));
  const b = await launch({ port: CDP });
  try {
    // 入口・棚（ログインしていない：見るだけの棚）・部屋に入る
    let d = await b.newDevice('前', { width: 390, height: 844, mobile: true, deviceScaleFactor: 1 });
    await 開く(d, false);
    await 撮る(d, 'old-入口');
    await d.ev("window.goToScreen('scr-rt-lobby')"); await d.ev("(function(){ var b=document.querySelector('#scr-entry [data-entry=\"join\"]'); if(b) b.click(); return 1; })()");
    await d.go('http://127.0.0.1:' + PORT + '/'); await d.until("(document.querySelector('.screen.active')||{}).id==='scr-entry'", 10000, '入口'); await d.ev(止める);
    await d.ev("document.querySelector('#scr-entry [data-entry=\"join\"]').click()");
    await 撮る(d, 'old-部屋に入る');
    await d.close();

    // ログインしている進行役：棚 → 部屋をつくる → 待合 → ゲーム → モード → つぎは？
    d = await b.newDevice('前・進行役', { width: 390, height: 844, mobile: true, deviceScaleFactor: 1 });
    await 開く(d, true);
    await d.ev("document.querySelector('#scr-entry [data-entry=\"choose\"]').click()");
    await d.until("(document.querySelector('.screen.active')||{}).id==='scr-shelf'", 8000, '棚');
    await 撮る(d, 'old-棚');
    await 置く(d, "{ 'room:create': function(){ return { ok: true, code: 'TST754', memberId: 'm1', room: " + JSON.stringify(部屋('m1')) + " }; } }");
    await d.ev("window.goToScreen('scr-rt-lobby')");
    await 撮る(d, 'old-部屋をつくる');
    await d.ev("(function(){ document.getElementById('rtCreateName').value='ふう'; document.getElementById('rtCreateBtn').click(); return 1; })()");
    await d.until("(document.querySelector('.screen.active')||{}).id==='scr-rt-room'", 8000, '待合');
    await 撮る(d, 'old-待合-進行役');
    await d.ev("document.getElementById('rtPickGameBtn').click()");
    await d.until("(document.querySelector('.screen.active')||{}).id==='scr-shelf'", 8000, '棚（部屋のため）');
    await 撮る(d, 'old-棚-部屋のため');
    await d.ev("(function(){ var c=document.querySelector('.cart[data-cart=\"quizou\"]'); c.click(); setTimeout(function(){ c.click(); }, 400); return 1; })()");
    await d.until("(document.querySelector('.screen.active')||{}).id==='scr-game'", 8000, 'ゲーム');
    await 撮る(d, 'old-ゲーム');
    await d.ev("document.getElementById('gameNextBtn').click()");
    await d.until("(document.querySelector('.screen.active')||{}).id==='scr-mode'", 8000, 'モード');
    await 撮る(d, 'old-モード');
    await d.ev("window.goToScreen('scr-next')");
    await 撮る(d, 'old-つぎは');
    await d.close();

    // 参加者の待合
    d = await b.newDevice('前・参加者', { width: 390, height: 844, mobile: true, deviceScaleFactor: 1 });
    await 開く(d, false);
    await 置く(d, "{ 'room:join': function(){ return { ok: true, code: 'TST754', memberId: 'm6', room: " + JSON.stringify(部屋('m6')) + " }; }, 'room:peek': function(){ return { ok: true, code: 'TST754', game: null, phase: 'lobby', playerCount: 6 }; } }");
    await d.ev("document.querySelector('#scr-entry [data-entry=\"join\"]').click()");
    await d.ev("(function(){ document.getElementById('rtJoinCode').value='TST754'; document.getElementById('rtJoinName').value='くまくん'; document.getElementById('rtJoinBtn').click(); return 1; })()");
    await d.until("(document.querySelector('.screen.active')||{}).id==='scr-rt-room'", 8000, '参加者の待合');
    await 撮る(d, 'old-待合-参加者');
    await d.close();

    // TV の待合（大画面として入る）
    d = await b.newDevice('前・TV', { width: 1920, height: 1080, mobile: false, deviceScaleFactor: 1 });
    await 開く(d, false);
    const tv = 部屋('tv');
    await 置く(d, "{ 'room:join': function(){ return { ok: true, code: 'TST754', memberId: 'tv', room: " + JSON.stringify(tv) + " }; }, 'room:peek': function(){ return { ok: true, code: 'TST754', game: null, phase: 'lobby', playerCount: 6 }; } }");
    await d.ev("document.querySelector('#scr-entry [data-entry=\"big\"]').click()");
    await d.ev("(function(){ document.getElementById('rtJoinCode').value='TST754'; document.getElementById('rtJoinBtn').click(); return 1; })()");
    await d.until("(document.querySelector('.screen.active')||{}).id==='scr-rt-big'", 8000, 'TV の待合');
    await 撮る(d, 'old-TV待合');
    await d.close();
  } catch (e) {
    console.error('✖', e.message);
    process.exitCode = 1;
  } finally {
    await b.close();
    server.close();
  }
})();
