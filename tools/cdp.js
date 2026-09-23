// tools/cdp.js — Chrome を DevTools の口（CDP）で動かす、最小の部品（指示60 B-2）
//
// **なぜ作ったか。**審査会のデモ手順書（docs/審査会_デモ手順.md）には、
// 手順ごとのスクショが要る。ブラウザ枠（Claude の Browser pane）のスクショは
// ファイルに残せず、しかも枠が裏に回ると時計が止まる（落とし穴28）。
// puppeteer は入っていない（依存を足したくない）ので、**Chrome 本体を CDP で直に動かす**。
// Node 24 の組み込み WebSocket と fetch だけで動く。
//
// **端末を別々に作れる**：`newDevice()` は Chrome の「ブラウザの箱」（BrowserContext）を
// 1つずつ作るので、localStorage もクッキーも分かれる——
// 進行役・QRで入る参加者・大画面を、1つの Chrome の中で別々の人として動かせる
// （同じタブを2つ開くと memberId を引き継いで別人になれない・CLAUDE.md 技術構成）。
//
// 使い方は tools/demo-walk.js（デモの流れを通してスクショを撮る台本）を見る。
// **本番には向けない**（検証用サーバー `node tools/dev-server.js` に向ける）。

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME_CANDIDATES = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium'
].filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch(opt) {
  const o = opt || {};
  const exe = CHROME_CANDIDATES.find((p) => { try { return fs.existsSync(p); } catch (e) { return false; } });
  if (!exe) throw new Error('Chrome が見つかりません（CHROME=... で場所を渡せます）');
  const port = o.port || 9333;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acac-cdp-'));
  const args = [
    '--headless=new', '--remote-debugging-port=' + port, '--user-data-dir=' + dir,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    // 裏のタブでも時計を止めない（落とし穴28：止まった時計で測らない）
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows', '--autoplay-policy=no-user-gesture-required',
    'about:blank'
  ];
  const proc = spawn(exe, args, { stdio: 'ignore' });
  let ver = null;
  for (let i = 0; i < 50 && !ver; i++) {
    await sleep(200);
    try { ver = await (await fetch('http://127.0.0.1:' + port + '/json/version')).json(); } catch (e) {}
  }
  if (!ver) { proc.kill(); throw new Error('Chrome の CDP に繋がりません'); }
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      if (m.error) p.rej(new Error(m.error.message)); else p.res(m.result);
    } else if (m.method) {
      listeners.forEach((f) => { try { f(m); } catch (e) {} });
    }
  };
  function send(method, params, sessionId) {
    const id = ++seq;
    const msg = { id, method, params: params || {} };
    if (sessionId) msg.sessionId = sessionId;
    ws.send(JSON.stringify(msg));
    return new Promise((res, rej) => pending.set(id, { res, rej }));
  }

  /** 別の端末（localStorage もクッキーも分かれる）を1つ作る */
  async function newDevice(name, viewport) {
    const vp = viewport || { width: 375, height: 812, mobile: true, deviceScaleFactor: 2 };
    const { browserContextId } = await send('Target.createBrowserContext', { disposeOnDetach: true });
    const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const s = (m, p) => send(m, p, sessionId);
    await s('Page.enable');
    await s('Runtime.enable');
    await s('Emulation.setDeviceMetricsOverride', {
      width: vp.width, height: vp.height, deviceScaleFactor: vp.deviceScaleFactor || 1, mobile: !!vp.mobile });
    if (vp.mobile) await s('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    const logs = [];
    listeners.push((m) => {
      if (m.sessionId !== sessionId) return;
      if (m.method === 'Runtime.exceptionThrown') logs.push('例外: ' + ((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text));
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push('console.error: ' + m.params.args.map((a) => a.value || a.description || '').join(' '));
    });
    const dev = {
      name, logs,
      async go(url) {
        await s('Page.navigate', { url });
        await sleep(1200);
      },
      /** ページの中で式を評価する（await してよい）。戻り値は JSON で返る */
      async ev(expr) {
        const r = await s('Runtime.evaluate', {
          expression: '(async()=>{ return (' + expr + '); })()', awaitPromise: true, returnByValue: true,
          userGesture: true
        });
        if (r.exceptionDetails) throw new Error(name + '：' + (r.exceptionDetails.exception || {}).description);
        return r.result.value;
      },
      /** 条件が成り立つまで待つ（時間ではなく「出たか」で待つ・落とし穴24） */
      async until(expr, ms, what) {
        const t0 = Date.now();
        for (;;) {
          let ok = false;
          try { ok = await dev.ev(expr); } catch (e) {}
          if (ok) return ok;
          if (Date.now() - t0 > (ms || 8000)) throw new Error(name + '：待ちきれませんでした（' + (what || expr) + '）');
          await sleep(120);
        }
      },
      screen() { return dev.ev("(document.querySelector('.screen.active')||{}).id"); },
      /** 本物のタップ（pointerdown→up→click）を座標で送る */
      async tapAt(x, y) {
        for (const type of ['mousePressed', 'mouseReleased']) {
          await s('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
        }
      },
      /** 要素の真ん中を本物のタップで押す */
      async tap(sel) {
        const c = await dev.ev('(function(){var e=document.querySelector(' + JSON.stringify(sel) + ');' +
          'if(!e) return null; e.scrollIntoView({block:"center"}); var r=e.getBoundingClientRect();' +
          'return {x:r.left+r.width/2, y:r.top+r.height/2};})()');
        if (!c) throw new Error(name + '：押すものが見つかりません ' + sel);
        await sleep(80);
        await dev.tapAt(c.x, c.y);
      },
      /**
       * 要素の click() を呼ぶ（押した先の処理は本物のまま）。
       * 棚のように「押すと動いて位置が変わる」ものは、座標のタップだと途中の位置を押す
       */
      async click(sel) {
        const ok = await dev.ev('(function(){var e=document.querySelector(' + JSON.stringify(sel) + ');' +
          'if(!e) return false; e.click(); return true;})()');
        if (!ok) throw new Error(name + '：押すものが見つかりません ' + sel);
      },
      async shot(file) {
        // .jpg なら JPEG（手順書に置くスクショは容量を抑える）
        const jpg = /\.jpe?g$/i.test(file);
        const r = await s('Page.captureScreenshot', jpg ? { format: 'jpeg', quality: 72 } : { format: 'png' });
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
        return file;
      },
      async close() { try { await send('Target.disposeBrowserContext', { browserContextId }); } catch (e) {} }
    };
    return dev;
  }

  async function close() {
    try { ws.close(); } catch (e) {}
    try { proc.kill(); } catch (e) {}
    await sleep(300);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  }
  return { newDevice, close, send };
}

module.exports = { launch, sleep };
