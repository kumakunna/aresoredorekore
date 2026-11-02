#!/usr/bin/env node
// tools/tvs-walk.js — TV の切りかえ（指示69）を、本物の Chrome＋拡張機能で通して測る
//
//   node tools/tvs-walk.js                 … 速さ・開き直さないか・音・リモコンの写真（数分）
//   node tools/tvs-walk.js --hidden 6.5    … ＋あつまれの TV を 6.5分 裏にして、遅れ・tv-stuck・F5 の札を見る（門14）
//   --port 3011（検証用サーバー）  --cdp 9721  --out DIR（既定 docs/監査_指示69/walk）
//
// **Chrome for Testing を使う。**ふつうの Chrome（137 から）は --load-extension を受けつけない。
// puppeteer が置く ~/.cache/puppeteer/chrome/*/chrome-win64/chrome.exe（CHROME_CFT で場所を渡せる）。
// 音は消す（--mute-audio・落とし穴の決まり）。タブの「鳴っている」の印（audible）は、音を消しても Chrome が付ける。
// あそびまちは本物を使わない：同じ形の「にせのモニター」（押すと始まります・数秒ごとに聞きに行く・呼ばれたら鳴る）を
// この道具が 127.0.0.1:(port+1) に立てる。**本物の key は使わない・出さない**。
// 検査の都合で、Chrome に --autoplay-policy=no-user-gesture-required を付ける（にせのモニターの音のため。TV の PC には付けない）

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const ioClient = require('socket.io-client');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const PORT = Number(arg('port', 3011)), MON = PORT + 1, CDP = Number(arg('cdp', 9721));
const HIDDEN_MIN = Number(arg('hidden', 0));
const OUT = path.resolve(arg('out', path.join(ROOT, 'docs', '監査_指示69', 'walk')));
const BASE = 'http://localhost:' + PORT;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });
const rec = [];
const note = (k, v) => { rec.push({ t: Date.now(), k, v }); console.log('・' + k + '：' + (typeof v === 'string' ? v : JSON.stringify(v))); };

function cft() {
  if (process.env.CHROME_CFT) return process.env.CHROME_CFT;
  const d = path.join(os.homedir(), '.cache', 'puppeteer', 'chrome');
  const v = fs.readdirSync(d).filter((x) => /^win64-/.test(x)).sort().pop();
  return path.join(d, v, 'chrome-win64', 'chrome.exe');
}

// ---- にせのモニター（あそびまちと同じ形） ----
const polls = {};   // ページごとに、聞きに来た時刻
let callAt = 0;
const monitor = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/poll') {
    const id = u.searchParams.get('id');
    (polls[id] = polls[id] || []).push(Date.now());
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ call: callAt }));
  }
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end('<!doctype html><title>にせのモニター</title><body style="font:40px sans-serif">' +
    '<button id="go" style="font-size:40px">押すと始まります</button><div id="n">0</div><script>' +
    'var id=Math.random().toString(36).slice(2),seen=null,ac=null,n=0;window.__id=id;window.__beeps=0;window.__iv=[];setInterval(function(){window.__iv.push(Date.now())},2000);' +
    'document.getElementById("go").onclick=function(){ac=new AudioContext();this.remove();tick();};' +
    'function beep(){window.__beeps++;var o=ac.createOscillator(),g=ac.createGain();g.gain.value=.2;o.connect(g);g.connect(ac.destination);o.start();o.stop(ac.currentTime+1.5);}' +
    'function tick(){fetch("/poll?id="+id).then(function(r){return r.json()}).then(function(j){document.getElementById("n").textContent=++n;' +
    'if(seen!==null&&j.call!==seen)beep();seen=j.call;}).catch(function(){}).then(function(){setTimeout(tick,2000)});}' +
    '</script></body>');
});

// ---- CDP（ブラウザの口1本・flatten） ----
let ws, mid = 0;
const wait = {}, events = [];
async function cdpOpen() {
  for (let i = 0; i < 60; i++) {
    try { const j = await (await fetch('http://127.0.0.1:' + CDP + '/json/version')).json(); ws = new WebSocket(j.webSocketDebuggerUrl); break; } catch (e) { await sleep(250); }
  }
  if (ws.readyState !== 1) await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  console.log('・CDP：つながった');
  ws.addEventListener('message', (m) => {
    const d = JSON.parse(m.data);
    if (d.id && wait[d.id]) { const f = wait[d.id]; delete wait[d.id]; f(d); } else events.push(d);
  });
}
function cdp(method, params, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++mid;
    const t = setTimeout(() => { delete wait[id]; reject(new Error(method + '：10秒たっても返事が無い')); }, 10000);
    wait[id] = (d) => { clearTimeout(t); return d.error ? reject(new Error(method + ': ' + d.error.message)) : resolve(d.result); };
    ws.send(JSON.stringify({ id, method, params: params || {}, sessionId }));
  });
}
const sessions = {};
async function attach(targetId) {
  if (sessions[targetId]) return sessions[targetId];
  const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
  sessions[targetId] = sessionId;
  return sessionId;
}
async function ev(targetId, expr) {
  const s = await attach(targetId);
  const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, s);
  if (r.exceptionDetails) throw new Error('評価で例外: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
  return r.result.value;
}
async function targets() { return (await cdp('Target.getTargets')).targetInfos; }
async function until(fn, label, ms) {
  const limit = Date.now() + (ms || 15000);
  while (Date.now() < limit) { try { const v = await fn(); if (v) return v; } catch (e) {} await sleep(150); }
  throw new Error('待ちきれませんでした：' + label);
}

(async function main() {
  // ---- サーバー ----
  const log = fs.openSync(path.join(OUT, 'server.log'), 'w');
  const srv = spawn(process.execPath, ['tools/dev-server.js'], { cwd: ROOT, stdio: ['ignore', log, log],
    env: Object.assign({}, process.env, { PORT: String(PORT), TVS_ASOBI_URL: 'http://127.0.0.1:' + MON + '/monitor?key=FAKE-NOT-REAL' }) });
  await new Promise((r) => monitor.listen(MON, '127.0.0.1', r));
  await until(async () => (await fetch(BASE + '/api/fes/current')).ok, 'サーバー');

  // ---- Chrome（拡張機能を読み込む） ----
  const ext = path.join(ROOT, 'tv-switcher', 'extension');
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'tvs-walk-'));
  const ch = spawn(cft(), ['--remote-debugging-port=' + CDP, '--user-data-dir=' + prof, '--load-extension=' + ext, '--disable-extensions-except=' + ext,
    '--mute-audio', '--no-first-run', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required', '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' });
  let ok = false;
  try {
    await cdpOpen();
    // 拡張機能の場所は、拡張機能が入った時に自分で開く「はじめる」の画面から引く（Chrome for Testing には background.js という名前の別の拡張機能もある）
    const startT = await until(async () => (await targets()).find((t) => t.type === 'page' && /^chrome-extension:\/\/[a-p]{32}\/start\.html$/.test(t.url)), 'はじめるの画面（拡張機能が入った）', 20000);
    const EXT = startT.url.replace(/start\.html$/, '');
    note('拡張機能', '読み込めた');

    // 係のログイン（この Chrome のクッキー）と、「はじめる」
    const { targetId: login } = await cdp('Target.createTarget', { url: BASE + '/dev-login', newWindow: true });
    await until(async () => /dev-login OK/.test(await ev(login, 'document.body ? document.body.textContent : ""')), 'ログイン');
    // 「はじめる」の画面は、拡張機能が入った時に自分で開く（background.js onInstalled）。外から開くと開かないことがある
    const start = startT.targetId;
    await until(() => ev(start, '!!document.getElementById("start")'), 'はじめるの画面の中身');
    // 拡張機能の API は、眠る裏の処理（service worker）ではなく、この画面（拡張機能のページ）で使う
    const sv = (expr) => ev(start, expr);
    await sv('self.__act = []; chrome.tabs.onActivated.addListener((i) => self.__act.push({ t: Date.now(), tab: i.tabId })); true');
    await ev(start, 'document.getElementById("server").value = ' + JSON.stringify(BASE) + '; document.getElementById("start").click(); true');
    const S = () => sv('chrome.storage.local.get("S").then((v) => v.S)');
    await until(async () => { const s = await S(); return s && Object.keys(s.tabs[1] || {}).length === 5 && Object.keys(s.tabs[2] || {}).length === 5; }, '窓2つ・タブ5つずつ', 30000);
    let st = await S();
    note('はじめる', 'TV① と TV② の窓・タブ5つずつ');

    // 動画と画像を「はじめる」の画面に入れる（キャンバスで作る・4秒の動画と画像2枚）
    await ev(start, `(async () => {
      const c = document.createElement('canvas'); c.width = 320; c.height = 180; const g = c.getContext('2d');
      const rec = new MediaRecorder(c.captureStream(30), { mimeType: 'video/webm' }); const parts = []; rec.ondataavailable = (e) => parts.push(e.data);
      rec.start(); let f = 0; const t = setInterval(() => { g.fillStyle = 'hsl(' + (f++ * 7) + ',70%,50%)'; g.fillRect(0, 0, 320, 180); }, 33);
      await new Promise((r) => setTimeout(r, 4000)); rec.stop(); clearInterval(t); await new Promise((r) => (rec.onstop = r));
      await MediaDb.put('video', [{ name: 'test.webm', type: 'video/webm', blob: new Blob(parts, { type: 'video/webm' }) }]);
      const img = async (col) => { g.fillStyle = col; g.fillRect(0, 0, 320, 180); return new Promise((r) => c.toBlob(r)); };
      await MediaDb.put('menu', [{ name: 'a.png', type: 'image/png', blob: await img('#c33') }, { name: 'b.png', type: 'image/png', blob: await img('#33c') }]);
      await chrome.runtime.sendMessage({ t: 'media-changed', id: 'video' }); await chrome.runtime.sendMessage({ t: 'media-changed', id: 'menu' });
      return true; })()`);
    note('動画・画像', '入れた');

    // あそびまちの「押すと始まります」（両方の TV）
    const tid = (tv, item) => st.tabs[tv][item];
    const T = async () => targets();
    const tgt = async (tabId) => {
      // タブの id と CDP の target の対応は URL で引く（同じ物は2つの窓にあるので、2つ返ることがある）
      const all = await T();
      const tab = await sv('chrome.tabs.get(' + tabId + ').then((t) => t.url)');
      return all.filter((x) => x.type === 'page' && x.url === tab);
    };
    // その窓のタブだけ（CDP の窓の番号は、拡張機能の窓の番号と同じ）
    const pick = async (tv, item) => {
      for (const t of await tgt(tid(tv, item))) { const w = await cdp('Browser.getWindowForTarget', { targetId: t.targetId }); if (w.windowId === st.win[tv]) return t; }
      throw new Error('タブが見つからない：TV' + tv + ' ' + item);
    };
    st = await S();
    const asobiT = await until(async () => { const c = await tgt(tid(1, 'asobi')); return c.length === 2 ? c : null; }, 'あそびまちのタブ2つ', 20000);
    for (const t of asobiT) await ev(t.targetId, 'document.getElementById("go") && document.getElementById("go").click(); true');
    note('あそびまち', '両方の TV で「押すと始まります」を押した（にせのモニター）');

    // リモコン
    const { targetId: remote } = await cdp('Target.createTarget', { url: BASE + '/tvs', newWindow: true });
    await until(() => ev(remote, '!!document.querySelector(".tv[data-tv=\\"1\\"] .grid button")'), 'リモコン');
    await until(() => ev(remote, '(document.querySelector(".tv[data-tv=\\"1\\"] .st .c")||{}).textContent === "● つながっている" && (document.querySelector(".tv[data-tv=\\"2\\"] .st .c")||{}).textContent === "● つながっている"'), 'リモコンに ● つながっている', 20000);
    note('リモコン', '両方 ● つながっている');

    // 開き直していないかの印：はじめの timeOrigin
    const born = {};
    for (const tv of [1, 2]) for (const item of ['fes', 'asobi', 'video', 'menu', 'rest']) {
      const t = await pick(tv, item);
      born[tv + item] = [{ id: t.targetId, o: await ev(t.targetId, 'performance.timeOrigin') }];
    }

    // 門1：押してから TV のタブが変わるまで（10回）
    const press = async (tv, item) => {
      const t0 = Date.now();
      await ev(remote, 'document.querySelector(\'.tv[data-tv="' + tv + '"] button[data-item="' + item + '"]\').click(); true');
      const changed = await until(async () => { const a = await sv('self.__act.filter((x) => x.tab === ' + tid(tv, item) + ' && x.t >= ' + t0 + ')[0] || null'); return a; }, 'タブが変わる', 5000);
      const said = await until(async () => { const s = await ev(remote, 'document.querySelector(\'.tv[data-tv="' + tv + '"] .fb\').textContent'); return s === '変わりました' ? Date.now() : null; }, '変わりました', 5000);
      return { tv, item, tab: changed.t - t0, said: said - t0 };
    };
    const seq = [[1, 'menu'], [2, 'video'], [1, 'asobi'], [2, 'fes'], [1, 'video'], [2, 'menu'], [1, 'rest'], [2, 'asobi'], [1, 'fes'], [2, 'rest']];
    const times = [];
    for (const [tv, item] of seq) { times.push(await press(tv, item)); await sleep(300); }
    note('門1 押してからタブが変わるまで（ms）', times.map((x) => x.tab));
    note('門1 押してから「変わりました」まで（ms）', times.map((x) => x.said));

    // 門2：開き直していない（timeOrigin が同じ）・動画は続いている
    let reloaded = [];
    for (const k of Object.keys(born)) for (const b of born[k]) { const o = await ev(b.id, 'performance.timeOrigin').catch(() => null); if (o !== b.o) reloaded.push(k); }
    note('門2 開き直したタブ', reloaded.length ? reloaded : 'なし');
    const vid = born['1video'][0].id;
    const v0 = await ev(vid, '(() => { const v = document.querySelector("video"); return v ? v.currentTime + "/" + v.paused : "なし"; })()');
    // Chrome は、一度も見えていないタブの動画を、見えるまで始めない（はじめて出した時に頭から始まる）。
    // 見るのは「一度出した動画を裏にしても、止まらずに進み、表にもどすと途中から続く」こと
    const vt = '(() => { const v = document.querySelector("video"); return v ? +v.currentTime.toFixed(2) + "/" + (v.paused ? "止まっている" : "動いている") : "なし"; })()';
    await press(1, 'video'); await sleep(1500);
    const v1 = await ev(vid, vt);
    await press(1, 'menu'); await sleep(2500);
    const v2 = await ev(vid, vt);
    await sleep(2500);
    const v3 = await ev(vid, vt);
    await press(1, 'video'); await sleep(500);
    const v4 = await ev(vid, vt);
    note('門2 動画（まだ出していない→表→裏→裏→表）', [v0, v1, v2, v3, v4].join(' → '));

    // 門3：音。TV① 動画（音は切）・TV② メニュー で、にせのモニターを鳴らす → 鳴っていて音を消していないタブを数える
    await press(2, 'menu');
    callAt = Date.now();
    await sleep(3500);
    const tabs = await sv('chrome.tabs.query({}).then((ts) => ts.map((t) => ({ id: t.id, w: t.windowId, audible: !!t.audible, muted: !!(t.mutedInfo && t.mutedInfo.muted) })))');
    st = await S();
    const name = (id) => { for (const tv of [1, 2]) for (const k of Object.keys(st.tabs[tv])) if (st.tabs[tv][k] === id) return 'TV' + tv + ':' + k; return 'ほか'; };
    note('門3 鳴っている（audible）タブ', tabs.filter((t) => t.audible).map((t) => name(t.id) + (t.muted ? '（音を消してある）' : '（鳴る）')));
    note('門3 音を消していないタブ', tabs.filter((t) => !t.muted).map((t) => name(t.id)));
    const beeps = [];
    for (const t of asobiT) beeps.push(await ev(t.targetId, 'window.__beeps'));
    note('門3 にせのモニターが鳴らした回数（タブごと）', beeps);

    // 門7：リモコンの写真と、はみ出し（390×844・375×667）
    const rs = await attach(remote);
    for (const [w, h] of [[390, 844], [375, 667]]) {
      await cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: true }, rs);
      await sleep(400);
      const m = await ev(remote, `(() => { const de = document.documentElement; const bs = Array.from(document.querySelectorAll('.grid button, .back'));
        return { scroll: de.scrollHeight > innerHeight || document.body.scrollHeight > innerHeight, out: bs.filter((b) => { const r = b.getBoundingClientRect(); return r.bottom > innerHeight || r.top < 0 || r.right > innerWidth; }).length,
          small: bs.filter((b) => b.closest('.grid') && b.getBoundingClientRect().height < 56).length, n: bs.length }; })()`);
      note('門7 ' + w + '×' + h, m);
      const shot = await cdp('Page.captureScreenshot', { format: 'png' }, rs);
      fs.writeFileSync(path.join(OUT, 'remote-' + w + 'x' + h + '.png'), Buffer.from(shot.data, 'base64'));
    }
    await cdp('Emulation.clearDeviceMetricsOverride', {}, rs);

    // 門14：あつまれの TV を裏にしたまま、文化祭の部屋を回す
    if (HIDDEN_MIN > 0) await hidden(remote, press, sv, S, born);
    ok = true;
  } catch (e) {
    note('止まった', e.message);
  } finally {
    fs.writeFileSync(path.join(OUT, 'record.json'), JSON.stringify(rec, null, 1));
    try { await cdp('Browser.close'); } catch (e) {}
    try { ch.kill(); } catch (e) {}
    srv.kill(); monitor.close();
    const L = fs.readFileSync(path.join(OUT, 'server.log'), 'utf8');
    console.log('・サーバーのログ：tv-stuck ' + (L.match(/tv-stuck/g) || []).length + '行・FAKE-NOT-REAL（にせの key） ' + (L.match(/FAKE-NOT-REAL/g) || []).length + '回');
    console.log(ok ? '通しおわり' : '通しが止まりました');
    process.exit(ok ? 0 : 1);
  }
})();

async function hidden(remote, press, sv, S, born) {
  const cookie = await (async () => { const r = await fetch(BASE + '/dev-login'); return (r.headers.getSetCookie() || []).map((c) => c.split(';')[0]).join('; '); })();
  const staff = ioClient(BASE, { transports: ['websocket'], extraHeaders: { Cookie: cookie } });
  await new Promise((r) => staff.on('connect', r));
  const call = (e, p) => new Promise((r) => staff.emit(e, p || {}, r));
  const c = await call('fes:create', { recreate: true });
  if (!c || !c.ok) throw new Error('文化祭の部屋を作れない：' + JSON.stringify(c));
  await call('fes:watch', {});
  const phases = [];
  let last = null;
  staff.on('room:update', (r) => { const p = r && r.fes && r.fes.phase; if (p && p !== last) { phases.push({ t: Date.now(), p, n: (r.members || []).length }); last = p; } });
  await press(1, 'fes');
  const st = await S();
  const fesT = born['1fes'][0].id;
  // 新しい Chrome の箱なので、はじめての「光と揺れの確認」が出ている（端末ごとに1回）。本物の TV の PC でも、はじめての日に1回押す
  await ev(fesT, '(() => { const b = document.getElementById("sgStartBtn"); if (b && b.offsetParent) b.click(); return true; })()');
  await until(() => ev(fesT, '(document.querySelector(".screen.active")||{}).id === "scr-v2-fes-tv"'), 'TV① のあつまれが文化祭の TV の画面に着く', 30000)
    .catch(async (e) => { console.log('  いま：' + JSON.stringify(await ev(fesT, '({ url: location.href, scr: (document.querySelector(".screen.active")||{}).id, vis: document.visibilityState, text: document.body.innerText.slice(0, 120) })'))); throw e; });
  note('門14 部屋', c.code + '・TV① のあつまれが TV の画面に着いた');
  // 着いたあと、アプリは自分で1回 /?room=… へ移る（表のままでも同じ・11/02 に確かめた）。比べる印はそのあとで取る
  await until(async () => /[?&]room=/.test(await ev(fesT, 'location.search')) && (await ev(fesT, '(document.querySelector(".screen.active")||{}).id')) === 'scr-v2-fes-tv', '部屋のアドレスへ移る', 30000);
  const arrived = await ev(fesT, 'performance.timeOrigin');
  note('門14 着いた時', { origin: arrived, href: await ev(fesT, 'location.pathname + location.search') });
  // 文化祭のスマホ3台のふり（入る・準備OK を押す・心拍に返す）。遊びの中身は押さない（ゲームは時間で終わる）
  const bots = [];
  for (let i = 0; i < 3; i++) {
    const b = ioClient(BASE, { transports: ['websocket'], forceNew: true });
    b.on('hb:ping', () => b.emit('hb:pong'));
    b.on('room:update', (r) => { const f = r && r.fes; if (f && f.phase === 'ready' && r.state && r.state.game && b.__readyFor !== f.round) { b.__readyFor = f.round; b.emit('room:ready', { ready: true, game: r.state.game }, () => {}); } });
    await new Promise((r) => b.on('connect', r));
    const j = await new Promise((r) => b.emit('room:join', { code: c.code, name: 'ボット' + (i + 1), diff: 'normal' }, r));
    if (!j || !j.ok) throw new Error('ボットが入れない：' + JSON.stringify(j));
    bots.push(b);
  }
  await sleep(4000);
  // --visible：比べるため、あつまれを表のままにして同じことをする
  if (!arg('visible', false)) await press(1, 'menu');
  const t0 = Date.now();
  note('門14 裏にした', 'TV① をメニューへ（あつまれは裏）');
  const samples = [];
  while (Date.now() - t0 < HIDDEN_MIN * 60000) {
    await sleep(30000);
    const s = await ev(fesT, '({ origin: performance.timeOrigin, href: location.pathname + location.search, vis: document.visibilityState, scr: (document.querySelector(".screen.active")||{}).id, stuck: document.querySelectorAll("[data-tv-stuck]").length })');
    s.min = +((Date.now() - t0) / 60000).toFixed(1);
    samples.push(s);
    console.log('  ' + s.min + '分 ' + JSON.stringify(s));
  }
  note('門14 裏の間の様子（30秒ごと）', samples);
  const remoteStuck = await ev(remote, 'document.querySelector(\'.tv[data-tv="1"]\').classList.contains("is-stuck")');
  if (!arg('visible', false)) await press(1, 'fes');
  await sleep(2000);
  const after = await ev(fesT, '({ scr: (document.querySelector(".screen.active")||{}).id, stuck: document.querySelectorAll("[data-tv-stuck]").length, origin: performance.timeOrigin })');
  after.active = await sv('chrome.tabs.get(' + st.tabs[1].fes + ').then((t) => t.active)');
  note('門14 表にもどした', Object.assign(after, { reloaded: after.origin !== arrived, remoteStuck }));
  // 段ごとの長さ（裏の TV が進みを遅らせていないか：決めた長さのままか）
  const dur = phases.slice(0, -1).map((x, i) => x.p + ' ' + ((phases[i + 1].t - x.t) / 1000).toFixed(1) + '秒');
  note('門14 段の長さ（裏の間）', dur);
  note('門14 段の並び', phases.map((x) => x.p + '(' + x.n + '人)').join(' → '));
  // 裏のにせのモニターの、聞きに行く間（はじめの5分と、5分より後）
  for (const id of Object.keys(polls)) {
    const ts = polls[id].filter((t) => t >= t0);
    const gaps = ts.slice(1).map((t, i) => t - ts[i]);
    const early = gaps.filter((g, i) => ts[i] - t0 < 5 * 60000), late = gaps.filter((g, i) => ts[i] - t0 >= 5 * 60000);
    const mx = (a) => (a.length ? Math.max.apply(null, a) : null);
    note('門14 にせのモニターの聞きに行く間 ' + id, { 回: ts.length, はじめ5分の最大ms: mx(early), 五分より後の最大ms: mx(late) });
  }
  // setInterval の形（2秒ごと）が、裏で何秒おきになったか
  for (const t of (await targets()).filter((x) => x.type === 'page' && x.url.indexOf(':' + MON + '/monitor') !== -1)) {
    const iv = (await ev(t.targetId, 'window.__iv')).filter((x) => x >= t0);
    const gaps = iv.slice(1).map((x, i) => x - iv[i]);
    const late = gaps.filter((g, i) => iv[i] - t0 >= 5 * 60000), early = gaps.filter((g, i) => iv[i] - t0 < 5 * 60000);
    const mx = (a) => (a.length ? Math.max.apply(null, a) : null);
    note('門14 にせのモニターの setInterval(2秒) の間', { 回: iv.length, はじめ5分の最大ms: mx(early), 五分より後の最大ms: mx(late) });
  }
  bots.forEach((b) => b.close()); staff.close();
}
