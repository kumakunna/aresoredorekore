#!/usr/bin/env node
// tools/oldscr-shot.js — ⚙ や入口から開く「今までの見た目」の残り（ログイン・新しく登録・まちがえた時・称号・名前を変える）を撮って、
// check.js で測る（指示71-7 の 68-7 の2・C23）
//
//   node tools/oldscr-shot.js [--port 3037] [--cdp 9352] [--out DIR]
//
// 検証用サーバー（tools/dev-server.js）を立てる。ログインの画面は、ログインしていないスマホで入口の「部屋をつくる」から（人と同じ道）。
// 新しく登録・まちがえた時（ユーザー名とパスワードをわざと違えて「ログイン」）も撮る。称号と名前を変えるは /dev-login のあと goToProbe で開く。
// 375×667・390×844・375×667 の文字「大」。記録は docs/監査_指示71/oldscr/（git に入れない）。検証のブラウザは音を出さない（tools/cdp.js）

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { launch, sleep } = require('./cdp');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : argv[i + 1]; };
const PORT = Number(arg('port', 3037)), CDP = Number(arg('cdp', 9352));
const OUT = path.resolve(arg('out', path.join(ROOT, 'docs', '監査_指示71', 'oldscr')));
const BASE = 'http://localhost:' + PORT;
const CHECK_JS = fs.readFileSync(path.join(ROOT, 'docs', '指示66', 'tools', 'check.js'), 'utf8');
fs.mkdirSync(OUT, { recursive: true });
const FORMS = [
  { name: '375x667', w: 375, h: 667, font: 100 },
  { name: '390x844', w: 390, h: 844, font: 100 },
  { name: '375x667-font130', w: 375, h: 667, font: 130 }
];
const scr = (d) => d.ev("(document.querySelector('.screen.active') || {}).id");

async function 測る(d, id) {
  await d.ev('(function(){' + CHECK_JS + '; return typeof UICHECK; })()');
  return d.ev(`(function(){ var s = document.getElementById(${JSON.stringify(id)});
    var out = UICHECK(s, { tv: false, band: '.v2-none', content: ':scope *', deco: '.v2-none', layers: '.v2-none', icons: '.v2-none', tiles: '.v2-none', layerPlace: false, over: '.v2-none', buttons: 'button,.btn,[role=button]' });
    return out.map(function(x){ return typeof x === 'string' ? x : JSON.stringify(x); }); })()`).catch((e) => ['測れない：' + e.message]);
}
async function 見た目(d, id) {
  return d.ev(`(function(){ var s = document.getElementById(${JSON.stringify(id)}); var cs = getComputedStyle(s);
    return { v2: s.classList.contains('v2'), bg: cs.backgroundImage.slice(0, 40), font: getComputedStyle(s.querySelector('h2,.v2-hd-ttl,.prof-name,.scr-title') || s).fontFamily.slice(0, 40) }; })()`);
}

async function main() {
  const log = fs.openSync(path.join(OUT, 'server.log'), 'w');
  const srv = spawn(process.execPath, ['tools/dev-server.js'], { cwd: ROOT, stdio: ['ignore', log, log], env: Object.assign({}, process.env, { PORT: String(PORT) }) });
  let up = false;
  for (let i = 0; i < 80 && !up; i++) { await sleep(250); try { up = (await fetch(BASE + '/')).ok; } catch (e) {} }
  if (!up) throw new Error('検証用サーバーが立たない');
  const br = await launch({ port: CDP });
  const 記録 = { 画面: {}, 指摘: [] };
  const 撮る = async (d, form, name, id) => {
    const r = await 測る(d, id);
    r.forEach((x) => 記録.指摘.push(form.name + ' ' + name + '：' + x));
    記録.画面[name] = Object.assign(記録.画面[name] || {}, { [form.name]: Object.assign(await 見た目(d, id), { 指摘: r.length }) });
    await d.shot(path.join(OUT, form.name + '-' + name + '.png'));
  };
  try {
    for (const form of FORMS) {
      const d = await br.newDevice('phone-' + form.name, { width: form.w, height: form.h, mobile: true, deviceScaleFactor: 2 });
      await d.go(BASE + '/');
      await d.ev("(function(){ localStorage.setItem('acac-app-prefs', JSON.stringify({ fxSpeed: 'skip', fontScale: " + form.font + " })); localStorage.setItem('acac-safety-seen', '1'); return 1; })()");
      await d.go(BASE + '/');
      await d.until("(document.querySelector('.screen.active') || {}).id === 'scr-v2-home'", 10000, '入口');
      // ログイン（入口の「部屋をつくる」→ ログインが要る）
      await d.ev("document.querySelector('#scr-v2-home [data-home-act=\"make\"]').click()");
      await d.until("(document.querySelector('.screen.active') || {}).id === 'scr-login'", 8000, 'ログインの画面');
      await sleep(300);
      await 撮る(d, form, 'login', 'scr-login');
      // まちがえた時
      await d.ev("(function(){ document.getElementById('loginUsername').value = 'まちがい'; document.getElementById('loginPassword').value = 'xxxxxx'; document.getElementById('loginSubmitBtn').click(); return 1; })()");
      await d.until("!!document.getElementById('loginError').textContent", 6000, 'まちがえた時の言葉');
      記録.まちがえた時 = await d.ev("document.getElementById('loginError').textContent");
      await sleep(500);
      await 撮る(d, form, 'login-error', 'scr-login');
      // 新しく登録
      await d.ev("document.getElementById('loginToggleBtn').click()"); await sleep(300);
      await 撮る(d, form, 'register', 'scr-login');
      await d.ev("document.getElementById('loginToggleBtn').click()"); await sleep(200);
      // 称号・名前を変える（ログインしてから）
      await d.go(BASE + '/dev-login');
      await d.go(BASE + '/');
      await d.until("(document.querySelector('.screen.active') || {}).id && (document.querySelector('.screen.active') || {}).id !== 'scr-door'", 10000, 'ログインして入口');
      await d.ev("window.goToProbe('scr-titles')"); await sleep(600);
      if ((await scr(d)) === 'scr-titles') await 撮る(d, form, 'titles', 'scr-titles');
      await d.ev("window.goToProbe('scr-rename')"); await sleep(600);
      if ((await scr(d)) === 'scr-rename') await 撮る(d, form, 'rename', 'scr-rename');
      記録.例外 = (記録.例外 || []).concat(d.logs);
      await d.close();
    }
  } finally {
    fs.writeFileSync(path.join(OUT, '記録.json'), JSON.stringify(記録, null, 1));
    try { await br.close(); } catch (e) {}
    srv.kill();
  }
  console.log('・画面：' + Object.keys(記録.画面).map((k) => k + (Object.values(記録.画面[k]).every((x) => x.v2) ? '（新）' : '（今まで）')).join('・'));
  console.log('・まちがえた時：' + 記録.まちがえた時);
  console.log('・check.js：' + 記録.指摘.length + '件・例外 ' + (記録.例外 || []).length);
  記録.指摘.slice(0, 40).forEach((x) => console.log('   ' + x.slice(0, 200)));
  process.exit(記録.指摘.length || (記録.例外 || []).length ? 1 : 0);
}
main().catch((e) => { console.error('止まった：' + e.message); process.exit(1); });
