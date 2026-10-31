#!/usr/bin/env node
// tools/fes-tv-first.js — 記憶（localStorage）が空のブラウザで、文化祭の TV を初めて開いた時に何が出るか（くまくんの手順そのまま）
//
//   node tools/fes-tv-first.js            … 本物のサーバー（tools/dev-server.js）と本物の Chrome で。0.5秒ごとの画面を出す。TV の画面に着かなければ終わりの数が 1
//   --port 3311  --cdp 9711  --shot DIR（TV の写真を残す）  --slow 300（TV の通信に遅れを入れる・ミリ秒。本番の回線に近づける）
//   --tv-first（TV を先に開いて待たせ、そのあと係が部屋を作る。作るのと開くのがほぼ同時だった時の道）
//   --film FILE.gif（TV の画面を開いた所から 12秒、GIF に撮る・960×540・8コマ/秒）
//
// 手順（10/31 12:45 本番・部屋 U3GU55・v2.13 で起きた）：
//   1. 係（/dev-login のくまくん）が係の画面で文化祭の部屋を作る
//   2. **記憶の空のブラウザ**で /fes?tv=1 を開く（演出の速さも安全の案内も、何も入れない）
//   3. 安全の案内が出たら「はじめる」を押す（人が押すのと同じ）。扉は押さない（本物の TV は押さない）
//   4. 係の画面が「TV：つながっている」になっているか、TV の画面が文化祭の TV（scr-v2-fes-tv）か
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { launch, sleep } = require('./cdp');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const PORT = +arg('port', 3311), CDP = +arg('cdp', 9711), SHOT = arg('shot', null), SLOW = +arg('slow', 0), TV_FIRST = argv.includes('--tv-first'), FILM = arg('film', null);

async function サーバー() {
  const base = 'http://localhost:' + PORT;
  const out = fs.openSync(path.join(require('os').tmpdir(), 'fes-tv-first-' + PORT + '.log'), 'w');
  const child = spawn(process.execPath, [path.join(__dirname, 'dev-server.js')], { env: Object.assign({}, process.env, { PORT: PORT }), stdio: ['ignore', out, out] });
  let up = false;
  for (let i = 0; i < 80 && !up; i++) { await sleep(250); try { up = (await fetch(base + '/')).ok; } catch (e) {} }
  if (!up) throw new Error('検証用サーバーが立ちません（port ' + PORT + '）');
  return { base, child };
}
const 見る = "(function(){ var a=document.querySelector('.screen.active'); var g=document.getElementById('safetyGate');" +
  "return { scr: a ? a.id : null, gate: !!g && getComputedStyle(g).display !== 'none', len: a ? a.innerText.trim().length : 0, big: document.documentElement.classList.contains('big-screen')," +
  " me: window.rt && rt.me ? (function(m){ return m ? m.role : null; })(rt.me()) : 'rt無し', fes: !!(window.rt && rt.state && rt.state.room && rt.state.room.fes), url: location.pathname + location.search }; })()";

(async () => {
  const { base, child } = await サーバー();
  const b = await launch({ port: CDP });
  let code = 1;
  try {
    let tv = null, 送り = null, 撮り始め = 0;
    if (TV_FIRST) {
      tv = await b.newDevice('TV', { width: 1920, height: 1080, deviceScaleFactor: 0.5 });
      if (SLOW) { await tv.raw('Network.enable', {}); await tv.raw('Network.emulateNetworkConditions', { offline: false, latency: SLOW, downloadThroughput: -1, uploadThroughput: -1 }); }
      await tv.go(base + '/fes?tv=1');
      await sleep(2500);
      const g = await tv.ev("(function(){ var g=document.getElementById('safetyGate'); return !!g && getComputedStyle(g).display !== 'none'; })()");
      if (g) await tv.ev("document.getElementById('sgStartBtn').click()");
      await sleep(2000);
      console.log('TV を先に開いた：' + JSON.stringify(await tv.ev(見る)));
    }
    const staff = await b.newDevice('係', { width: 390, height: 844, mobile: true });
    await staff.go(base + '/');
    await staff.ev("(function(){ localStorage.setItem('acac-safety-seen','1'); return 1; })()");
    await staff.go(base + '/dev-login');
    await sleep(800);
    await staff.go(base + '/fes?staff=1');
    await staff.until("(document.querySelector('.screen.active')||{}).id === 'scr-v2-fes-staff'", 15000, '係の画面');
    await sleep(800);
    const made = await staff.ev("(function(){ var b=document.querySelector('[data-fes-act=create]'); if(b){ b.click(); return 'create'; } return 'exists'; })()");
    if (made === 'exists') { await staff.ev("document.querySelector('[data-v2-open=\"#v2Recreate\"]').click()"); await sleep(400); await staff.ev("document.querySelector('[data-v2-act=recreate]').click()"); }
    await sleep(1500);
    const cur = await (await fetch(base + '/api/fes/current')).json();
    console.log('係が部屋を作った：' + cur.code);

    if (!TV_FIRST) {
      tv = await b.newDevice('TV', { width: 1920, height: 1080, deviceScaleFactor: 0.5 });
      if (SLOW) { await tv.raw('Network.enable', {}); await tv.raw('Network.emulateNetworkConditions', { offline: false, latency: SLOW, downloadThroughput: -1, uploadThroughput: -1 }); }
      if (FILM) { 送り = require('./film-pair').送りを受ける(tv, 960, 540); await 送り.start(); 撮り始め = Date.now(); }
      await tv.go(base + '/fes?tv=1');   // 記憶は空のまま
    }
    const 道 = [];
    for (let i = 0; i < 24; i++) {
      await sleep(500);
      const st = await tv.ev(見る);
      道.push(JSON.stringify(st));
      if (st.gate) { await tv.ev("document.getElementById('sgStartBtn').click()"); 道.push('（安全の案内の「はじめる」を押した）'); }
    }
    const last = await tv.ev(見る);
    const tvSt = await staff.ev("(function(){ var b=document.querySelector('#scr-v2-fes-staff .v2-adm-st'); return b ? b.innerText.replace(/\\s+/g,' ') : null; })()");
    console.log([...new Set(道)].join('\n'));
    console.log('係の画面：' + tvSt);
    if (SHOT) { fs.mkdirSync(SHOT, { recursive: true }); await tv.shot(path.join(SHOT, 'fes-tv-first.png')); }
    if (送り) {
      await 送り.stop();
      const Pair = require('./film-pair'), { encodeGif } = require('./gif-lite');
      const コマ = Pair.コマを並べる(送り.got, 撮り始め, 12, 8);
      fs.mkdirSync(path.dirname(path.resolve(FILM)), { recursive: true });
      fs.writeFileSync(path.resolve(FILM), encodeGif(コマ, Math.round(100 / 8)));
      console.log('動画：' + FILM + '（' + コマ.length + 'コマ）');
    }
    const errs = await tv.ev("JSON.stringify((window.__appErrors || []).slice(-5))");
    if (errs && errs !== '[]') console.log('例外：' + errs);
    code = last.scr === 'scr-v2-fes-tv' ? 0 : 1;
    console.log(code ? '✖ TV の画面に着かない（' + last.scr + '）' : '✔ 文化祭の TV の画面に着いた');
  } catch (e) {
    console.error('✖ ' + (e && e.stack || e));
    code = 2;
  } finally {
    await b.close();
    child.kill();
  }
  process.exit(code);
})();
