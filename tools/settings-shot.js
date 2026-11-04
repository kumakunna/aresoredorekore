#!/usr/bin/env node
// tools/settings-shot.js — 文化祭のスマホから ⚙ を押した時に開く画面を、全部たどって撮り、check.js で測る（指示71-2）
//
//   node tools/settings-shot.js [--port 3036] [--out DIR]
//
// 1. 検証用サーバー（tools/dev-server.js）を立て、係（/dev-login）が文化祭の部屋を作る
// 2. スマホ（ゲスト）が /fes から入り、待合で右上の ⚙ を押す
// 3. ⚙ の中の、押して行ける所を全部たどる（入口 → 行 → 行…）。同じページは1回だけ。押すと出ていく行（部屋を出る・音を消す・アイコン・二つ名）は押さない
// 4. 375×667・390×844・375×667 の文字「大」で、1ページずつ撮って docs/指示66/tools/check.js（UICHECK）を当てる
// 記録は docs/監査_指示71/settings/（git に入れない）。一覧（どのページが新しい見た目か）は list.json
// 検証のブラウザは音を出さない（tools/cdp.js の --mute-audio）

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ioClient = require('socket.io-client');
const { launch, sleep } = require('./cdp');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : argv[i + 1]; };
const PORT = Number(arg('port', 3036));
const OUT = path.resolve(arg('out', path.join(ROOT, 'docs', '監査_指示71', 'settings')));
const BASE = 'http://localhost:' + PORT;
const CHECK_JS = fs.readFileSync(path.join(ROOT, 'docs', '指示66', 'tools', 'check.js'), 'utf8');
fs.mkdirSync(OUT, { recursive: true });
const FORMS = [
  { name: '375x667', w: 375, h: 667, font: 100 },
  { name: '390x844', w: 390, h: 844, font: 100 },
  { name: '375x667-font130', w: 375, h: 667, font: 130 }
];
// 押すと ⚙ の外へ出る・何かが起きる行（たどらない）
const DONT = ['muteAll', 'leaveRoom', 'titles', 'endGame', 'closeRoom', 'resetAll', 'pause', 'pickGame', 'toBig', 'toPlayer'];

async function main() {
  const log = fs.openSync(path.join(OUT, 'server.log'), 'w');
  const srv = spawn(process.execPath, ['tools/dev-server.js'], { cwd: ROOT, stdio: ['ignore', log, log], env: Object.assign({}, process.env, { PORT: String(PORT) }) });
  let up = false;
  for (let i = 0; i < 80 && !up; i++) { await sleep(250); try { up = (await fetch(BASE + '/')).ok; } catch (e) {} }
  if (!up) throw new Error('検証用サーバーが立たない');
  const cookie = (await fetch(BASE + '/dev-login')).headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const staff = ioClient(BASE, { transports: ['websocket'], extraHeaders: { Cookie: cookie } });
  await new Promise((r) => staff.on('connect', r));
  const made = await new Promise((r) => staff.emit('fes:create', { recreate: true }, r));
  if (!made || !made.ok) throw new Error('文化祭の部屋を作れない：' + JSON.stringify(made));
  const br = await launch({ port: 9351 });
  const list = {};
  const issues = [];
  try {
    for (const form of FORMS) {
      const d = await br.newDevice('phone-' + form.name, { width: form.w, height: form.h, mobile: true, deviceScaleFactor: 2 });
      await d.go(BASE + '/');
      await d.ev("(function(){ localStorage.setItem('acac-app-prefs', JSON.stringify({ fxSpeed: 'skip', fontScale: " + form.font + " })); return 1; })()");
      await d.go(BASE + '/fes');
      for (let i = 0; i < 40; i++) {
        const st = await d.ev("({ gate: (function(){ var g = document.getElementById('safetyGate'); return !!g && getComputedStyle(g).display !== 'none'; })(), scr: (document.querySelector('.screen.active') || {}).id })");
        if (st.gate) { await d.ev("document.getElementById('sgStartBtn').click()"); await sleep(300); continue; }
        if (st.scr === 'scr-v2-fes-join') break;
        await d.ev("(function(){ var p = document.getElementById('doorPanel'); if(p) p.click(); })()"); await sleep(300);
      }
      await d.ev("(function(){ var n = document.querySelector('[data-fes-name]'); n.value = 'せってい" + form.w + "'; n.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()");
      await d.ev("document.querySelector('[data-fes-diff=normal]').click()"); await sleep(200);
      await d.ev("document.querySelector('[data-fes-act=join]').click()");
      await d.until("(document.querySelector('.screen.active') || {}).id === 'scr-v2-fes-lobby'", 10000, '文化祭の待合');
      await sleep(500);
      await d.ev("document.querySelector('.screen.active [data-v2-act=gear]').click()"); await sleep(400);
      // たどる：入口から、ページへ行く行を順に
      const seen = new Set();
      const queue = [['root']];
      while (queue.length) {
        const route = queue.shift();
        const page = route[route.length - 1];
        if (seen.has(page)) continue;
        seen.add(page);
        // 入口から、その道を押して行く（毎回 ⚙ を開き直す）
        await d.ev("(function(){ var o = document.getElementById('settingsOverlay'); o.classList.remove('show'); return 1; })()");
        await d.ev("document.querySelector('.screen.active [data-v2-act=gear]').click()"); await sleep(250);
        for (const p of route.slice(1)) { await d.ev("document.querySelector('#settingsOverlay .set-page:not([style*=\"none\"]) [data-setpage=\"" + p + "\"]').click()"); await sleep(200); }
        const info = await d.ev(`(function(){
          var ov = document.getElementById('settingsOverlay');
          var cur = [].filter.call(ov.querySelectorAll('.set-page'), function(p){ return p.style.display !== 'none'; })[0];
          var rows = [].map.call(cur.querySelectorAll('[data-setpage],[data-setact]'), function(b){ return { page: b.getAttribute('data-setpage'), act: b.getAttribute('data-setact'), label: (b.querySelector('.sr-text') || b).textContent.trim().slice(0, 30) }; });
          return { page: cur.getAttribute('data-page'), title: document.getElementById('setTitle').textContent, v2: ov.classList.contains('v2'), bg: getComputedStyle(ov).backgroundImage.slice(0, 30), rows: rows };
        })()`);
        list[page] = list[page] || { title: info.title, newLook: info.v2 && /gradient/.test(info.bg), rows: info.rows };
        for (const r of info.rows) if (r.page && !seen.has(r.page)) queue.push(route.concat(r.page));
        // 撮る・測る（ページの下まで巻いて1枚ずつ）
        await d.ev('(function(){' + CHECK_JS + '; return typeof UICHECK; })()');
        const res = await d.ev(`(function(){ var ov = document.getElementById('settingsOverlay');
          var out = UICHECK(ov, { tv: false, band: '.v2-none', content: '.set-page:not([style*="none"]) *', deco: '.v2-none', layers: '.v2-none', icons: '.v2-none', tiles: '.v2-none', layerPlace: false, over: '.v2-none', buttons: 'button,[role=button]', cutOk: '.v2-none' });
          return out.map(function(x){ return typeof x === 'string' ? x : JSON.stringify(x); }); })()`).catch((e) => ['測れない：' + e.message]);
        res.forEach((x) => issues.push(form.name + ' ' + page + '：' + x));
        await d.shot(path.join(OUT, form.name + '-' + page + '.png'));
        const scrollH = await d.ev("(function(){ var o = document.querySelector('#settingsOverlay .overlay-panel'); return o.scrollHeight - o.clientHeight; })()");
        if (scrollH > 40) {
          await d.ev("(function(){ var o = document.querySelector('#settingsOverlay .overlay-panel'); o.scrollTop = o.scrollHeight; return 1; })()"); await sleep(150);
          await d.shot(path.join(OUT, form.name + '-' + page + '-下.png'));
        }
      }
      // 部屋の中の「アイコン・二つ名」：待合では新しい見た目の着替えのシートが開く（古い scr-titles へ行かない）
      await d.ev("(function(){ var o = document.getElementById('settingsOverlay'); o.classList.remove('show'); return 1; })()");
      await d.ev("document.querySelector('.screen.active [data-v2-act=gear]').click()"); await sleep(250);
      await d.ev("document.querySelector('#settingsOverlay [data-setpage=app]').click()"); await sleep(200);
      await d.ev("document.querySelector('#settingsOverlay [data-setact=titles]').click()"); await sleep(600);
      const look = await d.ev("({ scr: (document.querySelector('.screen.active') || {}).id, sheet: !!document.querySelector('.screen.active .v2-sheet.is-open'), sheets: [].map.call(document.querySelectorAll('.screen.active .v2-sheet'), function(x){ return (x.getAttribute('data-v2-id') || x.id) + ':' + x.className; }).join(' | '), btn: [].map.call(document.querySelectorAll('.screen.active [data-fes-act=look], .screen.active [data-v2-act=look]'), function(b){ return b.outerHTML.slice(0, 90); }).join(' | ') })");
      // 比べる：待合のボタンを、人と同じように直に押した時
      await d.ev("(function(){ var x = document.querySelector('.screen.active .v2-sheet.is-open'); if(x && window.V2) V2.close(x); return 1; })()"); await sleep(500);
      await d.ev("document.querySelector('.screen.active [data-fes-act=look]').click()"); await sleep(600);
      look.direct = await d.ev("!!document.querySelector('.screen.active .v2-sheet.is-open')");
      list.titles = { title: 'アイコン・二つ名（⚙ → アプリの設定）', newLook: look.scr === 'scr-v2-fes-lobby' && look.sheet, opened: look };
      await d.shot(path.join(OUT, form.name + '-titles.png'));
      await d.close();
    }
  } finally {
    fs.writeFileSync(path.join(OUT, 'list.json'), JSON.stringify({ list, issues }, null, 1));
    try { await br.close(); } catch (e) {}
    staff.close(); srv.kill();
  }
  console.log('・ページ：' + Object.keys(list).map((k) => k + (list[k].newLook ? '（新）' : '（古い）')).join('・'));
  console.log('・check.js：' + issues.length + '件');
  issues.slice(0, 30).forEach((x) => console.log('   ' + x.slice(0, 200)));
}
main().then(() => process.exit(0), (e) => { console.error('止まった：' + e.message); process.exit(1); });
