#!/usr/bin/env node
// tools/tvs-walk.js — TV の切りかえ（指示69）を、本物の Chrome＋拡張機能で通して測る
//
//   node tools/tvs-walk.js                 … 速さ・開き直さないか・音・リモコンの写真（数分）
//   node tools/tvs-walk.js --hidden 6.5    … ＋あつまれの TV を 6.5分 裏にして、遅れ・tv-stuck・F5 の札を見る（門14）
//   --port 3011（検証用サーバー）  --cdp 9721  --out DIR（既定 docs/監査_指示69/walk）
//
// **Chrome for Testing を使う。**ふつうの Chrome（137 から）は --load-extension を受けつけない。
// puppeteer が置く ~/.cache/puppeteer/chrome/*/chrome-win64/chrome.exe（CHROME_CFT で場所を渡せる）。
// 音は出さない：--disable-audio-output（音の出口を、にせの出口にする。PC のスピーカーを開かない）。
// --mute-audio だと、Chrome がタブの「鳴っている」の印（audible）を付けなくなり、呼び出しと動画の音の門が測れない（11/02 に確かめた）。
// 念のため、にせのモニターの音と動画の音はとても小さく作る
// あそびまちは本物を使わない：同じ形の「にせのモニター」（押すと始まります・数秒ごとに聞きに行く・呼ばれたら鳴る）を
// この道具が 127.0.0.1:(port+1) に立てる。**本物の key は使わない・出さない**。
// 指示71 追記（11/04）：TV の PC の Chrome は --autoplay-policy=no-user-gesture-required で起動する（tv-switcher/TVを開く.cmd）。この道具の Chrome も同じにする。
// 「押すと始まります」は**だれも押さない**——拡張機能（asobi-start.js）が押すのを見る。にせのモニターも本物と同じ形（div.mon-start を押すと音の箱を起こす）。
// （前の形のメモ：人の押し方（CDP の Input・信頼されたクリック）で押していた。自動再生の許しのフラグは付けなかった（動画の音の門を本物に近く見るため）
//   --restart 0：最後の「Chrome を開き直す」を飛ばす

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
    '<div class="mon-start" role="button" tabindex="0" style="font-size:40px">押すと始まります</div><div id="n">0</div><script>' +
    'var id=Math.random().toString(36).slice(2),seen=null,ac=null,n=0;window.__id=id;window.__beeps=0;window.__iv=[];setInterval(function(){window.__iv.push(Date.now())},2000);' +
    'document.querySelector(".mon-start").addEventListener("click",function(){ac=new AudioContext();window.__acState=ac.state;this.remove();tick();});' +
    'function beep(){window.__beeps++;var o=ac.createOscillator(),g=ac.createGain();g.gain.value=.02;o.connect(g);g.connect(ac.destination);o.start();o.stop(ac.currentTime+1.5);}' +
    'function tick(){fetch("/poll?id="+id).then(function(r){return r.json()}).then(function(j){document.getElementById("n").textContent=++n;' +
    'if(seen!==null&&j.call!==seen)beep();seen=j.call;}).catch(function(){}).then(function(){setTimeout(tick,2000)});}' +
    '</script></body>');
});

// ---- CDP（ブラウザの口1本・flatten） ----
let ws, mid = 0;
const wait = {}, events = [];
async function cdpOpen() {
  ws = null;
  for (let i = 0; i < 240 && !ws; i++) {
    try { const j = await (await fetch('http://127.0.0.1:' + CDP + '/json/version')).json(); ws = new WebSocket(j.webSocketDebuggerUrl); } catch (e) { await sleep(250); }
  }
  if (!ws) throw new Error('Chrome の口（CDP ' + CDP + '）が60秒たっても開かない');
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
    const t = setTimeout(() => { delete wait[id]; reject(new Error(method + '：30秒たっても返事が無い')); }, 30000);
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
  monitor.__socks = new Set();
  monitor.on('connection', (sk) => { monitor.__socks.add(sk); sk.on('close', () => monitor.__socks.delete(sk)); });
  await new Promise((r) => monitor.listen(MON, '127.0.0.1', r));
  await until(async () => (await fetch(BASE + '/api/fes/current')).ok, 'サーバー');

  // ---- Chrome（拡張機能を読み込む） ----
  const ext = path.join(ROOT, 'tv-switcher', 'extension');
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'tvs-walk-'));
  const launchChrome = (dir) => spawn(cft(), ['--remote-debugging-port=' + CDP, '--user-data-dir=' + dir, '--load-extension=' + ext, '--disable-extensions-except=' + ext,
    '--disable-audio-output', '--autoplay-policy=no-user-gesture-required', '--no-first-run', '--no-default-browser-check', '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' });
  // 前の通しの Chrome がまだ閉じきっていない時は、その口が閉じるまで待つ（同じポートにつなぐと、閉じる途中の Chrome と話してしまう）
  await until(async () => { try { await fetch('http://127.0.0.1:' + CDP + '/json/version'); return false; } catch (e) { return true; } }, '前の Chrome が閉じる', 30000);
  const cx = { ch: launchChrome(prof), launchChrome, prof };
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
    await sv('self.__aud = []; chrome.tabs.onUpdated.addListener((id, i) => { if ("audible" in i) self.__aud.push({ t: Date.now(), id, a: i.audible }); }); true');
    // 係（node の socket）：設定をはじめの形にもどす（検証用サーバーの SQLite には前の通しの設定が残っている）
    const cookie = await (async () => { const r = await fetch(BASE + '/dev-login'); return (r.headers.getSetCookie() || []).map((c) => c.split(';')[0]).join('; '); })();
    cx.staff = ioClient(BASE + '/tvs', { transports: ['websocket'], extraHeaders: { Cookie: cookie }, auth: { as: 'remote' } });
    await new Promise((r) => cx.staff.on('connect', r));
    const scall = (e, p) => new Promise((r) => cx.staff.emit(e, p || {}, r));
    await scall('tvs:settings', { auto: undefined, rot: { 1: [], 2: [{ item: 'menu', sec: 20 }, { item: 'asobi', sec: 20 }, { item: 'video', sec: null }] }, chime: true, fesBack: true, rest: '準備中です', notice: { 1: '', 2: '' } });
    await scall('tvs:auto', { tv: 1, on: false }); await scall('tvs:auto', { tv: 2, on: false });
    await scall('tvs:items:update', { id: 'video', sound: false });
    // 指示75 3-8：TV 専用の印が無い Chrome では「はじめる」を押せない（大きな札）。印のページ（/tvs/mark）を開くと押せる
    await sleep(3500);   // 「はじめる」の画面は3秒ごとに状態を読み直す
    const 印の前 = await ev(start, '({ 押せない: document.getElementById("start").disabled, 札: getComputedStyle(document.getElementById("notTv")).display !== "none" })');
    const r0 = await sv('chrome.runtime.sendMessage({ t: "start", server: ' + JSON.stringify(BASE) + ' })');
    await cdp('Target.createTarget', { url: BASE + '/tvs/mark', newWindow: false });
    await until(async () => (await sv('chrome.storage.local.get("S").then((v) => !!(v.S && v.S.tvProfile))')), 'TV 専用の印', 15000);
    await sleep(3500);
    const 印の後 = await ev(start, '({ 押せない: document.getElementById("start").disabled, 札: getComputedStyle(document.getElementById("notTv")).display !== "none" })');
    const markTabs = (await targets()).filter((t) => t.type === 'page' && /\/tvs\/mark/.test(t.url)).length;
    note('75 3-8 TV 専用の印', { 印の前: 印の前, 裏から押しても: r0 && r0.error, 印の後: 印の後, 印のタブ: markTabs ? '残っている' : '閉じた' });
    await ev(start, 'document.getElementById("server").value = ' + JSON.stringify(BASE) + '; document.getElementById("start").click(); true');
    const S = () => sv('chrome.storage.local.get("S").then((v) => v.S)');
    await until(async () => { const s = await S(); return s && Object.keys(s.tabs[1] || {}).length === 5 && Object.keys(s.tabs[2] || {}).length === 5; }, '窓2つ・タブ5つずつ', 30000);
    let st = await S();
    note('はじめる', 'TV① と TV② の窓・タブ5つずつ');

    // 動画と画像を「はじめる」の画面に入れる（キャンバスで作る・4秒の動画と画像2枚）
    { const s = await attach(start); await cdp('Page.bringToFront', {}, s).catch(() => {}); for (const type of ['mousePressed', 'mouseReleased']) await cdp('Input.dispatchMouseEvent', { type, x: 5, y: 5, button: 'left', clickCount: 1 }, s); }
    await ev(start, `(async () => {
      const c = document.createElement('canvas'); c.width = 320; c.height = 180; const g = c.getContext('2d');
      const ac = new AudioContext(); await ac.resume(); const osc = ac.createOscillator(), gn = ac.createGain(), dst = ac.createMediaStreamDestination(); gn.gain.value = 0.02; osc.connect(gn); gn.connect(dst); osc.start();
      const ms = c.captureStream(30); dst.stream.getAudioTracks().forEach((t) => ms.addTrack(t));
      // 録った動画が出せない形になることがある（NotSupportedError・11/02 に見た）。この画面で一度読んでみて、だめなら録り直す（3回まで）
      let blob = null;
      for (let k = 0; k < 3 && !blob; k++) {
        const rec = new MediaRecorder(ms, { mimeType: 'video/webm;codecs=vp8,opus' }); const parts = []; rec.ondataavailable = (e) => { if (e.data && e.data.size) parts.push(e.data); };
        rec.start(500); let f = 0; const t = setInterval(() => { g.fillStyle = 'hsl(' + (f++ * 7) + ',70%,50%)'; g.fillRect(0, 0, 320, 180); }, 33);
        await new Promise((r) => setTimeout(r, 4000)); rec.stop(); clearInterval(t); await new Promise((r) => (rec.onstop = r));
        const b = new Blob(parts, { type: 'video/webm' });
        // 読めるかは、ファイルの頭（WebM の印 1A 45 DF A3）と大きさで見る（この画面は裏にいることがあり、裏では動画を読みこまない）
        const head = new Uint8Array(await b.slice(0, 4).arrayBuffer());
        if (b.size > 20000 && head[0] === 0x1A && head[1] === 0x45 && head[2] === 0xDF && head[3] === 0xA3) blob = b;
      }
      if (!blob) throw new Error('出せる動画を録れない');
      await MediaDb.put('video', [{ name: 'test.webm', type: 'video/webm', blob }]);
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
    // だれも押さない。拡張機能（asobi-start.js）が「押すと始まります」を押し、音の箱が動いている（running）こと
    const 始まった = await until(async () => { const v = await Promise.all(asobiT.map((t) => ev(t.targetId, '({ 押した: !document.querySelector(".mon-start"), 音の箱: window.__acState || null })'))); return v.every((x) => x.押した) ? v : null; }, '拡張機能が押すと始まりますを押す', 15000).catch(() => null);
    note('あそびまち（だれも押さない）', 始まった || '押されなかった');

    // リモコン
    const { targetId: remote } = await cdp('Target.createTarget', { url: BASE + '/tvs', newWindow: true });
    await until(() => ev(remote, '!!document.querySelector(".tv[data-tv=\\"1\\"] .grid button")'), 'リモコン');
    await until(() => ev(remote, '(document.querySelector(".tv[data-tv=\\"1\\"] .st .c")||{}).textContent === "● つながっている" && (document.querySelector(".tv[data-tv=\\"2\\"] .st .c")||{}).textContent === "● つながっている"'), 'リモコンに ● つながっている', 20000);
    note('リモコン', '両方 ● つながっている');
    // リモコンの一言（変わりました・TV から返事がありません）を、ページの中で時刻つきで書き留める。
    // 外から何度も読みに行く形だと、読むのが遅れた間に「変わりました」（4秒で消える）を見のがす（11/02 に見た）
    await ev(remote, `(() => { window.__fb = []; let last = {}; new MutationObserver(() => { document.querySelectorAll('.tv').forEach((x) => { const tv = x.getAttribute('data-tv'); const f = x.querySelector('.fb'); const t = f ? f.textContent : ''; if (t !== last[tv]) { last[tv] = t; window.__fb.push({ t: Date.now(), tv: +tv, text: t }); } }); }).observe(document.body, { childList: true, subtree: true, characterData: true }); return true; })()`);

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
      const changed = await until(async () => { const a = await sv('self.__act.filter((x) => x.tab === ' + tid(tv, item) + ' && x.t >= ' + t0 + ')[0] || null'); return a; }, 'タブが変わる', 5000).catch(async (e) => {
        const s2 = await S();
        const box = await ev(remote, 'document.querySelector(".tv[data-tv=\\"' + tv + '\\"]").innerText.replace(/\\s+/g, " ").slice(0, 160)');
        console.log('  押した：TV' + tv + ' ' + item + ' / リモコン：' + box +
          ' / 拡張機能：' + JSON.stringify({ active: s2.active, tab: tid(tv, item), now: s2.tabs[tv] }) + ' / 変わったタブ：' + JSON.stringify(await sv('self.__act.slice(-5)')));
        throw e;
      });
      const said = await until(async () => { const l = await ev(remote, 'window.__fb.filter((x) => x.tv === ' + tv + ' && x.t >= ' + t0 + ')'); const h = l.find((x) => x.text === '変わりました'); return h ? h.t : null; }, '変わりました', 5000).catch(async (e) => {
        console.log('  押した：TV' + tv + ' ' + item + '・タブは ' + (changed.t - t0) + 'ms で変わった / リモコンの一言：' + JSON.stringify(await ev(remote, 'window.__fb.slice(-6)')));
        throw e;
      });
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
      // 二の束で、ボタンの画面の下に記録を足した（記録はスクロールで見る）。見るのは「ボタンが全部、最初の画面に入っているか」
      const m = await ev(remote, `(() => { const main = document.querySelector('main'); const bs = Array.from(document.querySelectorAll('.grid button, .back, .auto'));
        return { scroll: main.getBoundingClientRect().bottom > innerHeight + 1, out: bs.filter((b) => { const r = b.getBoundingClientRect(); return r.bottom > innerHeight || r.top < 0 || r.right > innerWidth; }).length,
          small: bs.filter((b) => b.closest('.grid') && b.getBoundingClientRect().height < 56).length, n: bs.length }; })()`);
      note('門7 ' + w + '×' + h, m);
      const shot = await cdp('Page.captureScreenshot', { format: 'png' }, rs);
      fs.writeFileSync(path.join(OUT, 'remote-' + w + 'x' + h + '.png'), Buffer.from(shot.data, 'base64'));
    }
    await cdp('Emulation.clearDeviceMetricsOverride', {}, rs);

    await part75({ remote, press, sv, S, pick, ev, start, scall, BASE });
    await part2({ remote, press, sv, S, pick, staff: cx.staff });
    // 門14：あつまれの TV を裏にしたまま、文化祭の部屋を回す
    if (HIDDEN_MIN > 0) await hidden(remote, press, sv, S, born);
    if (String(arg('restart', '1')) !== '0') await reopen(cx);
    ok = true;
  } catch (e) {
    note('止まった', e.message);
  } finally {
    fs.writeFileSync(path.join(OUT, 'record.json'), JSON.stringify(rec, null, 1));
    try { await cdp('Browser.close'); } catch (e) {}
    try { cx.ch.kill(); } catch (e) {}
    try { cx.staff && cx.staff.close(); } catch (e) {}
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
  const fesAud = (await sv('self.__aud')).filter((x) => x.id === st.tabs[1].fes && x.a).length;
  note('あつまれの TV（だれもそのタブを押していない）が音を出した回数（鳴っている印）', fesAud);
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

// ---- 指示75 束3：呼び出しのまちがい・全画面を自分でもどす・あそびまちが開けない時 ----
async function part75(c) {
  const chimes = async () => ((await new Promise((r) => c.scall('tvs:state', {}, r))) || {}).log;
  const logNow = async () => { const st = await fetch(c.BASE + '/tvs', {}); void st; };
  void logNow;
  // 3-1：「はじめる」を5回（3秒おき）と、あそびまちのタブの読み込み直し → 呼び出しは0回
  const before = (await c.sv('chrome.storage.local.get("S").then((v) => v.S.chimeAt || 0)'));
  for (let i = 0; i < 5; i++) { await c.ev(c.start, 'document.getElementById("start").click(); true'); await sleep(3000); }
  await c.sv('chrome.storage.local.get("S").then((v) => Promise.all([1, 2].map((n) => chrome.tabs.reload(v.S.tabs[n].asobi))))');
  await sleep(6000);
  const after = (await c.sv('chrome.storage.local.get("S").then((v) => v.S.chimeAt || 0)'));
  note('75 3-1 はじめる5回＋あそびまちの読み込み直し：呼び出しに数えた', after > before ? 'あり（まちがい）' : '0回');
  // 3-1 の裏：20秒をすぎたら、本物の呼び出し（にせのモニターが鳴る）は数える（数えない時間を足しすぎていない）
  await sleep(21000);
  callAt = Date.now();
  const ok31 = await until(async () => (await c.sv('chrome.storage.local.get("S").then((v) => v.S.chimeAt || 0)')) > after, '20秒すぎの呼び出し', 15000).then(() => true).catch(() => false);
  note('75 3-1 20秒をすぎた本物の呼び出し', ok31 ? '数えた' : '数えなかった（まちがい）');

  // 3-2：TV① の全画面を外す（Esc の代わり）→ 自分でもどるまで
  const S0 = await c.S();
  const 状態 = (tv) => c.sv('chrome.windows.get(' + S0.win[tv] + ').then((w) => w.state)');
  await c.sv('self.__bc = []; chrome.windows.onBoundsChanged.addListener((w) => self.__bc.push(w.id + ":" + w.state)); true');
  await c.sv('chrome.windows.update(' + S0.win[1] + ', { state: "normal" }).then(() => true)');
  const t0 = Date.now();
  let back = null;
  while (Date.now() - t0 < 5000) { if ((await 状態(1)) === 'fullscreen') { back = Date.now() - t0; break; } await sleep(50); }
  note('75 3-2 全画面を外した → もどるまで（ms）', back == null ? 'もどらない' : back);
  note('75 3-2 （調べ）窓の大きさが変わった知らせ・今の状態・placingUntil', { 知らせ: await c.sv('self.__bc'), 今: await 状態(1), placing: (await c.S()).placingUntil - Date.now() });
  // 3-2：TV② にあそびまちを出したまま「はじめる」を押し直す → TV② の窓は一度もふつうの大きさにならない（アドレス欄に URL が出ない）
  // 直前の本物の呼び出しで TV② がもうあそびまちのことがある。いったん休けいにしてから
  if ((await c.S()).active[2] === 'asobi') await c.press(2, 'rest');
  await c.press(2, 'asobi');
  await c.sv('self.__ws = []; self.__wt = setInterval(() => chrome.windows.get(' + S0.win[2] + ').then((w) => self.__ws.push(w.state)), 30); true');
  await c.ev(c.start, 'document.getElementById("start").click(); true');
  await sleep(2500);
  const ws = await c.sv('(clearInterval(self.__wt), Array.from(new Set(self.__ws)))');
  note('75 3-2 あそびまちを出したまま はじめる を押し直した時の TV② の窓', ws);
  await c.press(2, 'rest');

  // 3-3：あそびまちを開けない形（にせのモニターを止める）→ TV② のあそびまちを読み込み直す → エラーの画面 → モニターをもどす → 30秒以内に自分で開き直す
  await new Promise((r) => monitor.close(r));
  for (const sk of monitor.__socks || []) { try { sk.destroy(); } catch (e) {} }
  await c.sv('chrome.storage.local.get("S").then((v) => chrome.tabs.reload(v.S.tabs[2].asobi))');
  await until(async () => Object.keys((await c.S()).asobiErr || {}).length > 0, 'あそびまちが開けない形', 15000).catch(() => null);
  const errSeen = Object.keys((await c.S()).asobiErr || {}).length;
  await new Promise((r) => monitor.listen(MON, '127.0.0.1', r));
  const t1 = Date.now();
  const ok = await until(async () => Object.keys((await c.S()).asobiErr || {}).length === 0, 'あそびまちがもどる', 45000).then(() => true).catch(() => false);
  note('75 3-3 あそびまちが開けない → もどしてから自分で開き直すまで（秒）', { 開けない形になった: errSeen > 0, もどった: ok, 秒: +((Date.now() - t1) / 1000).toFixed(1) });
  void chimes;
}

// ---- 二の束（指示69）：お知らせの一言・休けいの字・動画の音・自動で回す・呼び出し・記録 ----
async function part2(c) {
  const { remote, press, sv, S, pick, staff } = c;
  const call = (e, p) => new Promise((r) => staff.emit(e, p || {}, r));
  let state = null;
  staff.on('tvs:state', (s) => { state = s; });
  await until(() => state, '係の状態');

  // 呼び出し（門3 でにせのモニターを鳴らした）：TV② があそびまちへ・記録は「あそびまちの呼び出し」
  const aud = await sv('self.__aud');
  const st = await S();
  const nameOf = (id) => { for (const tv of [1, 2]) for (const k of Object.keys(st.tabs[tv])) if (st.tabs[tv][k] === id) return 'TV' + tv + ':' + k; return 'ほか'; };
  note('二 呼び出し：タブの音の始まり（audible）', aud.filter((x) => x.a).map((x) => nameOf(x.id)));
  note('二 呼び出し：記録', (state.log || []).filter((x) => x.who === 'あそびまちの呼び出し').map((x) => 'TV' + x.tv + ' ' + x.item));

  // お知らせの一言：どのタブの上にも出る（TV ごと）
  await call('tvs:settings', { notice: { 1: 'TV1 のお知らせ', 2: 'TV2 のお知らせ' } });
  await sleep(1500);
  const band = {};
  for (const tv of [1, 2]) for (const item of ['fes', 'menu', 'asobi', 'video', 'rest']) {
    const t = await pick(tv, item);
    band[tv + item] = await ev(t.targetId, '(() => { const h = document.querySelector("[data-tvs-notice]"); return h && h.style.display !== "none" ? h.getAttribute("data-text") : "なし"; })()').catch((e) => '読めない');
  }
  note('二 お知らせの一言（タブごと）', band);
  await call('tvs:settings', { notice: { 1: '', 2: '' } });
  await sleep(1000);
  const gone = [];
  for (const tv of [1, 2]) { const t = await pick(tv, 'fes'); gone.push(await ev(t.targetId, '(() => { const h = document.querySelector("[data-tvs-notice]"); return !h || h.style.display === "none"; })()')); }
  note('二 お知らせを消した', gone.every(Boolean) ? '消えた' : '残っている');

  // 休けいの字
  await call('tvs:settings', { rest: 'テストの休けい' });
  await sleep(800);
  note('二 休けいの字（TV①の休けい）', await ev((await pick(1, 'rest')).targetId, 'document.getElementById("msg").textContent'));
  await call('tvs:settings', { rest: '準備中です' });

  // 動画の音を入 → 本当に鳴るか（タブの音を消していない・動画の音を消していない・止まっていない・Chrome の「鳴っている」の印）
  await call('tvs:items:update', { id: 'video', sound: true });
  await press(1, 'menu');
  await sleep(500);
  const a0 = Date.now();
  await press(1, 'video'); await sleep(2500);
  const vtab = st.tabs[1].video;
  const vinfo = await sv('chrome.tabs.get(' + vtab + ').then((t) => ({ muted: !!(t.mutedInfo && t.mutedInfo.muted), audible: !!t.audible }))');
  const vel = await ev((await pick(1, 'video')).targetId, '(() => { const v = document.querySelector("video"); return v ? { muted: v.muted, paused: v.paused, volume: v.volume, t: +v.currentTime.toFixed(2), play: window.__play } : null; })()');
  const vaud = (await sv('self.__aud')).filter((x) => x.id === vtab && x.t >= a0 && x.a).length;
  note('二 動画の音を入（TV①）', { タブの音を消している: vinfo.muted, 鳴っている印: vinfo.audible, 印が付いた回数: vaud, 動画: vel });
  await call('tvs:items:update', { id: 'video', sound: false });

  // 自動で回す（短い秒で TV②）
  await call('tvs:settings', { rot: { 2: [{ item: 'menu', sec: 5 }, { item: 'rest', sec: 5 }] } });
  const t0 = Date.now();
  await call('tvs:auto', { tv: 2, on: true });
  await sleep(12500);
  const autoLog = (state.log || []).filter((x) => x.who === '自動で回す' && x.at >= t0 - 1000).map((x) => 'TV' + x.tv + ' ' + x.item).reverse();
  const act2 = (await sv('self.__act')).filter((x) => x.t >= t0 && Object.values(st.tabs[2]).indexOf(x.tab) !== -1).map((x) => nameOf(x.tab));
  note('二 自動で回す（TV②・5秒ずつ）：記録', autoLog);
  note('二 自動で回す：TV② のタブが変わった', act2);
  await call('tvs:auto', { tv: 2, on: false });
  await call('tvs:settings', { rot: { 2: [{ item: 'menu', sec: 20 }, { item: 'asobi', sec: 20 }, { item: 'video', sec: null }] } });

  // リモコンの記録（10件）
  note('二 リモコンの記録の行', await ev(remote, 'document.querySelectorAll("#log li").length'));
}

// ---- Chrome を開き直す（同じ箱で）→「はじめる」→ 前の画面にもどるか ----
async function reopen(c) {
  const { launchChrome, prof, staff } = c;
  let state = null;
  staff.on('tvs:state', (s) => { state = s; });
  await until(() => state, '状態');
  const want = { 1: state.tvs[1].item, 2: state.tvs[2].item };
  try { await cdp('Browser.close'); } catch (e) {}
  // 前の Chrome が口（CDP のポート）を閉じきるまで待つ。閉じる途中の Chrome につなぐと、返事が来ないまま止まる（11/02 に見た）
  await until(async () => { try { await fetch('http://127.0.0.1:' + CDP + '/json/version'); return false; } catch (e) { return true; } }, '前の Chrome が閉じる', 20000);
  try { c.ch.kill(); } catch (e) {}
  try { ws.close(); } catch (e) {}
  await sleep(1000);
  Object.keys(sessions).forEach((k) => delete sessions[k]);
  c.ch = launchChrome(prof);
  await cdpOpen();
  const startT = await until(async () => (await targets()).find((t) => t.type === 'page' && /\/start\.html$/.test(t.url)), 'はじめるの画面（Chrome を開いた時に自分で開く）', 30000);
  note('開き直し：はじめるの画面', '自分で開いた');
  const start = startT.targetId;
  await until(() => ev(start, '!!document.getElementById("start") && !!document.getElementById("server").value'), 'サーバーの欄が入る');
  const t0 = Date.now();
  await ev(start, 'document.getElementById("start").click(); true');
  const sv = (expr) => ev(start, expr);
  const S = () => sv('chrome.storage.local.get("S").then((v) => v.S)');
  const got = await until(async () => {
    const s = await S();
    if (!s || Object.keys(s.tabs[1] || {}).length !== 5 || Object.keys(s.tabs[2] || {}).length !== 5) return null;
    const act = {};
    for (const tv of [1, 2]) {
      const tabs = await sv('chrome.tabs.query({ windowId: ' + s.win[tv] + ', active: true }).then((t) => t.map((x) => x.id))');
      act[tv] = Object.keys(s.tabs[tv]).find((k) => s.tabs[tv][k] === tabs[0]);
    }
    return act[1] === want[1] && act[2] === want[2] ? act : null;
  }, '前の画面にもどる', 30000).catch(async () => {
    const s = await S().catch(() => null);
    const rest = (await targets()).filter((t) => t.type === 'page' && t.url.indexOf('/tvs/screen') !== -1);
    for (const t of rest) console.log('  休けいのタブ：' + t.url + ' / ' + await ev(t.targetId, 'document.title + " / " + document.body.innerText.slice(0, 80)').catch((e) => e.message));
    console.log('  サーバーから見た TV：' + JSON.stringify(state && state.tvs));
    console.log('  開き直しの様子：' + JSON.stringify({ win: s && s.win, tabs: s && s.tabs, active: s && s.active, pages: (await targets()).filter((t) => t.type === 'page').map((t) => t.url.slice(0, 60)) }));
    return null;
  });
  note('開き直し：前の画面', { 前: want, もどった: got || 'もどらない', 秒: +((Date.now() - t0) / 1000).toFixed(1) });
}
