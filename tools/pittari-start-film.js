#!/usr/bin/env node
// tools/pittari-start-film.js — ぴったり10秒のスタートを、TV とスマホを並べた動画（GIF）に撮る（指示68-T 3 の門2）
//
//   node tools/pittari-start-film.js            … 1回目（時計が3秒見える）と4回目（時計が最初から見えない）
//   --sec 4.5  --fps 10  --out DIR（1コマだけの見本 pt-start-N_0.3s.gif も書く）
//
// 声を止めたので、スタートは字（FxKit.cue「スタート！」）と音で知らせる。**本物の道で撮る**：
// public/ を開き（tools/v2-lab/open.js の配り手・疑似 socket）、部屋をつくって、本物の進行役（pittari-room.js）で作った
// 「よーい」の知らせ → 「はかる」の知らせ を TV とスマホに同時に流す。描く関数も合図も本番と同じ（index.html の v2GameRender・pittariFx）。
// 合図は JS の時計で出入りするので「本当の時計」で撮る（Chrome の画面の送り Page.startScreencast を 0.1秒ごとに並べ直す・v2-film.js と同じ）。
// 左に TV（1920×1080 を半分）、右にスマホ（390×844 を TV の高さに合わせて縮める）。音は写らない（検証の Chrome は音を消してある）
'use strict';
const fs = require('fs');
const path = require('path');
const { launch, sleep } = require('./cdp');
const { 配り手, ROOT } = require('./v2-lab/open');
const { encodeGif } = require('./gif-lite');
const RT = require('../realtime');
const PittariRoom = require('../pittari-room');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const SEC = +arg('sec', 4.5), FPS = +arg('fps', 10);
const OUT = path.resolve(arg('out', path.join(ROOT, 'docs', '監査_指示68-Tの画像', 'film')));
const PORT = +arg('port', 3974), CDP = +arg('cdp', 9674);
const NAMES = ['ふう', 'ひろ', 'びび', 'ちか', 'でん', 'えみ'];

/** 本物の進行役で、q 回目の「よーい」と「はかる」の知らせを作る */
function 知らせ(q) {
  const store = new RT.RoomStore();
  const room = store.create({ ownerUserId: 1, ownerUsername: 'kuma' });
  room.code = 'TST754';
  NAMES.forEach((name, i) => room.members.set('m' + (i + 1), { id: 'm' + (i + 1), name, role: RT.ROLE_PLAYER, socketId: null, connected: true,
    joinedAt: i, lastSeen: Date.now(), readyGame: null, userId: null, look: { icon: '🙂', title: '' } }));
  room.members.set('tv', { id: 'tv', name: 'テレビ', role: RT.ROLE_BIGSCREEN, socketId: null, connected: true, joinedAt: 0, lastSeen: Date.now(), readyGame: null, userId: null, look: null });
  room.hostMemberId = 'm1';
  if (!PittariRoom.startGame(room, { game: 'pittari' }, { notify() {} }).ok) throw new Error('ぴったり10秒を始められません');
  // q 回目まで進める（だれも押さずに開いて、つぎへ）
  for (let k = 1; k < q; k++) { PittariRoom.advance(room); PittariRoom.advance(room); PittariRoom.advance(room); }
  const snap = () => { const s = JSON.parse(JSON.stringify(RT.publicSnapshot(room))); s.state = { phase: room.state.phase, game: 'pittari', data: JSON.parse(JSON.stringify(PittariRoom.publicView(room))) }; return s; };
  const set = snap();
  if (set.state.data.phase !== 'set' || set.state.data.round !== q) throw new Error(q + '回目の「よーい」になりません（' + set.state.data.phase + '・' + set.state.data.round + '）');
  PittariRoom.advance(room);
  const run = snap();
  if (run.state.data.phase !== 'run') throw new Error('「はかる」になりません');
  return { set, run, show: run.state.data.show };
}

/** 端末を開いて、部屋をつくって「よーい」まで（本物の入口から：部屋をつくる → 部屋の知らせ） */
async function 端末(br, name, size, me, set) {
  const dev = await br.newDevice(name, size);
  const base = 'http://127.0.0.1:' + PORT;
  await dev.go(base + '/');
  // 演出は「ふつう」。はじめの1回の安全の案内は通したことにする（tools/home-walk.js と同じ）
  await dev.ev("(function(){ localStorage.setItem('acac-app-prefs', JSON.stringify({ fxSpeed: 'normal' })); localStorage.setItem('acac-safety-seen','1'); return 1; })()");
  await dev.go(base + '/');
  await dev.until('window.__rtFake && window.__rtFake.connected && document.querySelector("#scr-v2-home [data-home-act=\\"join\\"]")', 15000, '入口');
  // 部屋に入る（ログインの要らない道：コード → 名前。TV は /tv と同じ関数から・tests/harness.js の joinRoomV2 と同じ押し方）
  await dev.ev(`(function(){ var room = ${JSON.stringify(set)};
    window.__rtFake.replies = { 'room:peek': function(){ return { ok: true, code: room.code, game: 'pittari', phase: 'play', playerCount: 6, fes: false }; },
      'room:join': function(){ return { ok: true, code: room.code, memberId: ${JSON.stringify(me)}, room: room }; } };
    if (${JSON.stringify(me)} === 'tv') window.homeOpenJoin({ tv: true });
    else { window.goToScreen('scr-v2-home'); document.querySelector('#scr-v2-home [data-home-act="join"]').click(); }
    return 1; })()`);
  await dev.until("document.querySelector('#scr-v2-join [data-home-code]')", 8000, 'コードの画面');
  await dev.ev("(function(){ var i=document.querySelector('#scr-v2-join [data-home-code]'); i.value='TST754'; i.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('#scr-v2-join [data-home-act=\"code-go\"]').click(); return 1; })()");
  if (me !== 'tv') {
    await dev.until("document.querySelector('#scr-v2-join [data-home-name]') || (document.querySelector('.screen.active')||{}).id !== 'scr-v2-join'", 8000, '名前の画面');
    await dev.ev("(function(){ var n=document.querySelector('#scr-v2-join [data-home-name]'); if(!n) return 0; n.value='ふう'; n.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('#scr-v2-join [data-home-act=\"join-go\"]').click(); return 1; })()");
  }
  await dev.until("(document.querySelector('.screen.active')||{}).id !== 'scr-v2-join'", 8000, '部屋に入った');
  await dev.ev(`(function(){ window.__rtFake.fire('room:update', ${JSON.stringify(set)}); return 1; })()`);
  const want = me === 'tv' ? 'scr-v2-pittari-tv' : 'scr-v2-pittari';
  try { await dev.until("(document.querySelector('.screen.active')||{}).id === " + JSON.stringify(want), 8000, want); }
  catch (e) { throw new Error(e.message + '・いまの画面 ' + await dev.screen() + '・me ' + await dev.ev('JSON.stringify(window.rtProbe ? window.rtProbe() : null)')); }
  await dev.ev("document.fonts.ready.then(function(){ return 1; })");
  return dev;
}
const Pair = require('./film-pair');
const 送りを受ける = Pair.送りを受ける, 並べる = Pair.並べる;
const コマを並べる = (got, t0) => Pair.コマを並べる(got, t0, SEC, FPS);

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await 配り手(PORT);
  const br = await launch({ port: CDP });
  const 記録 = [];
  try {
    for (const q of [1, 4]) {
      const k = 知らせ(q);
      const tv = await 端末(br, 'tv' + q, { width: 1920, height: 1080, mobile: false, deviceScaleFactor: 0.5 }, 'tv', k.set);
      const ph = await 端末(br, 'phone' + q, { width: 390, height: 844, mobile: true, deviceScaleFactor: 1 }, 'm1', k.set);
      const rt = 送りを受ける(tv, 960, 540), rp = 送りを受ける(ph, 390, 844);
      await rt.start(); await rp.start();
      await sleep(500);
      const t0 = Date.now() - 300;   // 0秒は「はかる」の知らせを流す 0.3秒前（よーいの終わりも写す）
      const fire = (dev) => dev.ev(`(function(){ window.__rtFake.fire('room:update', ${JSON.stringify(k.run)}); return 1; })()`);
      await Promise.all([fire(tv), fire(ph)]);
      // 合図が本当に出たか（字と大きさ）を、ページの中で数える
      const 見る = "(function(){ var c=document.querySelector('.fx-cue'); return c ? { text: c.textContent, size: c.className.replace(/.*fx-cue-(m|l|xl).*/, '$1'), px: parseFloat(getComputedStyle(c.querySelector('.fx-cue-text')).fontSize) } : null; })()";
      const 合図 = { tv: await tv.ev(見る), phone: await ph.ev(見る) };
      await sleep(SEC * 1000);
      await rt.stop(); await rp.stop();
      if (!rt.got.length || !rp.got.length) throw new Error(q + '回目：画面の送りが届きませんでした');
      const a = コマを並べる(rt.got, t0), b = コマを並べる(rp.got, t0);
      const frames = a.map((f, i) => 並べる(f, b[i]));
      const gif = encodeGif(frames, Math.round(100 / FPS));
      // 1コマだけの見本（「はかる」の知らせから 0.3秒＝合図が出きった所）。人が目で見る時は、まずこれ
      fs.writeFileSync(path.join(OUT, 'pt-start-' + q + '_0.3s.gif'), encodeGif([frames[Math.round(0.6 * FPS)]], 100));
      const file = path.join(OUT, 'pt-start-' + q + '.gif');
      fs.writeFileSync(file, gif);
      記録.push({ 回: q, 時計: k.show === false ? '最初から見えない' : '3秒見える', 合図, コマ: frames.length, 送られたコマ: { tv: rt.got.length, phone: rp.got.length }, KB: Math.round(gif.length / 1024) });
      console.log('✔ ' + q + '回目（時計' + (k.show === false ? 'なし' : 'あり') + '）：合図 TV ' + JSON.stringify(合図.tv) + '・スマホ ' + JSON.stringify(合図.phone) + ' → ' + path.relative(ROOT, file) + '（' + Math.round(gif.length / 1024) + 'KB）');
      await tv.close(); await ph.close();
    }
  } catch (e) {
    console.error('✖ ' + (e && e.stack || e));
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(path.join(OUT, 'pt-start-記録.json'), JSON.stringify(記録, null, 1));
    await br.close();
    server.close();
  }
})();
