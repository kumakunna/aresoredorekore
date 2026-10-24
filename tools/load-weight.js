#!/usr/bin/env node
// tools/load-weight.js — 読み込みの重さを、遅い端末と遅いネットの形で測る（指示68-0a M10）
//
//   node tools/load-weight.js                    … 入口（/）と文化祭の入口（/fes）を3回ずつ
//   --runs 3  --cpu 4  --out FILE（既定 docs/監査_指示66の画像/材料68/重さ.json）  --port 3320  --cdp 9720
//
// 条件：Chrome の CPU を4倍遅く（Emulation.setCPUThrottlingRate）＋ネットは DevTools の「Fast 3G」と同じ値
//   （往復 562.5ms・下り 1.6Mbps×0.9・上り 750kbps×0.9。Lighthouse の遅い 4G 以前の既定と同じ）。
// 毎回まっさらな端末（キャッシュも localStorage も無い＝はじめて来た人）で開く。
// **本番に近づけるため、HTML だけ gzip して配る**（本番の nginx は text/html を gzip し、JS は gzip しない：
//   2026-10-24 に本番の応答の頭を見て確かめた）。検証用サーバーの前に、そのとおりに縮める小さな中継を置く。
//
// 測るもの（ページの中で、読み込みの始まりからのミリ秒）：
//   最初に描く … first-contentful-paint
//   押せる     … 扉（scr-door）が開いて、押せるボタンが画面に出た時（はじめての人は安全の案内の「はじめる」）
//   DOM・load  … DOMContentLoaded・load
//   運んだ量   … 届いたファイルの合計（転送の大きさ）と、いちばん大きいもの
// 中央値を出す。本番には向けない（検証用サーバーだけ）

const fs = require('fs');
const path = require('path');
const http = require('http');
const zlib = require('zlib');
const { spawn } = require('child_process');
const { launch, sleep } = require('./cdp');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const PORT = +arg('port', 3320), PROXY = PORT + 1, CDP = +arg('cdp', 9720), RUNS = +arg('runs', 3), CPU = +arg('cpu', 4);
const OUT = path.resolve(arg('out', path.join(ROOT, 'docs', '監査_指示66の画像', '材料68', '重さ.json')));
const FAST3G = { offline: false, latency: 562.5, downloadThroughput: 1.6 * 1024 * 1024 / 8 * 0.9, uploadThroughput: 750 * 1024 / 8 * 0.9 };

async function サーバー() {
  const base = 'http://127.0.0.1:' + PORT;
  let up = false;
  try { up = (await fetch(base + '/')).ok; } catch (e) {}
  if (up) return null;
  const out = fs.openSync(path.join(require('os').tmpdir(), 'load-weight-' + PORT + '.log'), 'w');
  const child = spawn(process.execPath, [path.join(__dirname, 'dev-server.js')], { env: Object.assign({}, process.env, { PORT: PORT }), stdio: ['ignore', out, out] });
  for (let i = 0; i < 80 && !up; i++) { await sleep(250); try { up = (await fetch(base + '/')).ok; } catch (e) {} }
  if (!up) throw new Error('検証用サーバーが立ちません（port ' + PORT + '）');
  return child;
}

/** 本番の nginx と同じ縮め方の中継：text/html だけ gzip（ほかはそのまま） */
function 中継() {
  const server = http.createServer((req, res) => {
    const up = http.request({ host: '127.0.0.1', port: PORT, path: req.url, method: req.method, headers: Object.assign({}, req.headers, { host: '127.0.0.1:' + PORT, 'accept-encoding': 'identity' }) }, (r) => {
      const type = String(r.headers['content-type'] || '');
      const gz = /text\/html/.test(type) && /gzip/.test(String(req.headers['accept-encoding'] || ''));
      const h = Object.assign({}, r.headers);
      if (h.location) h.location = h.location.replace('127.0.0.1:' + PORT, '127.0.0.1:' + PROXY).replace('localhost:' + PORT, '127.0.0.1:' + PROXY);
      if (gz) { delete h['content-length']; h['content-encoding'] = 'gzip'; res.writeHead(r.statusCode, h); r.pipe(zlib.createGzip()).pipe(res); }
      else { res.writeHead(r.statusCode, h); r.pipe(res); }
    });
    up.on('error', () => { res.writeHead(502); res.end(); });
    req.pipe(up);
  });
  // socket.io の WebSocket は中継しない（往復は長いポーリングで届く。押せるまでの時間には効かない）
  return new Promise((ok) => server.listen(PROXY, () => ok(server)));
}

/** 読み込みの始まりから見張る（ページの最初の台本より前に入る） */
const 見張り = `(function(){
  window.__lw = { 押せる: null, 何: null };
  function 見える(e){ if(!e) return false; var r=e.getBoundingClientRect(); if(r.width<1||r.height<1) return false;
    var cs=getComputedStyle(e); return cs.visibility!=='hidden' && cs.display!=='none' && +cs.opacity>0.5; }
  function 見る(){
    if(window.__lw.押せる != null) return;
    var g=document.getElementById('safetyGate'), sg=document.getElementById('sgStartBtn');
    if(g && g.style.display==='flex' && 見える(sg) && !sg.disabled){ window.__lw.押せる=performance.now(); window.__lw.何='安全の案内：' + sg.textContent.trim(); return; }
    var a=document.querySelector('.screen.active');
    if(a && a.id!=='scr-door'){
      var b=Array.prototype.find.call(a.querySelectorAll('button'), function(x){ return !x.disabled && 見える(x) && (x.textContent||'').trim(); });
      if(b){ window.__lw.押せる=performance.now(); window.__lw.何=a.id + '：' + b.textContent.trim().replace(/\\s+/g,' ').slice(0,30); return; }
    }
    requestAnimationFrame(見る);
  }
  requestAnimationFrame(見る);
})();`;

const 結果を読む = `(function(){
  var nav=performance.getEntriesByType('navigation')[0]||{}, paint=performance.getEntriesByType('paint');
  var fcp=(paint.filter(function(p){return p.name==='first-contentful-paint';})[0]||{}).startTime;
  var res=performance.getEntriesByType('resource');
  var all=res.concat([nav]); var sum=all.reduce(function(a,r){return a+(r.transferSize||0);},0);
  var big=all.slice().sort(function(a,b){return (b.transferSize||0)-(a.transferSize||0);}).slice(0,5).map(function(r){return { 名: String(r.name).replace(location.origin,''), 転送KB: Math.round((r.transferSize||0)/1024), 中身KB: Math.round((r.decodedBodySize||0)/1024), ms: Math.round(r.responseEnd||r.duration||0) };});
  return { 最初に描く: fcp==null?null:Math.round(fcp), 押せる: window.__lw.押せる==null?null:Math.round(window.__lw.押せる), 押せたもの: window.__lw.何,
    DOM: Math.round(nav.domContentLoadedEventEnd||0), load: Math.round(nav.loadEventEnd||0), 運んだKB: Math.round(sum/1024), ファイル数: all.length, 大きい順: big,
    着いた所: location.pathname + location.search };
})()`;

const 中央値 = (a) => { const v = a.filter((x) => x != null).sort((x, y) => x - y); return v.length ? v[Math.floor((v.length - 1) / 2)] : null; };

(async () => {
  const child = await サーバー();
  const proxy = await 中継();
  const b = await launch({ port: CDP });
  const base = 'http://127.0.0.1:' + PROXY;
  const 記録 = { いつ: new Date().toISOString(), 条件: { CPU: CPU + '倍遅く', ネット: 'Fast 3G 相当 ' + JSON.stringify(FAST3G), 縮め: 'HTML だけ gzip（本番の nginx と同じ）', 端末: '390×844・毎回まっさら（はじめて来た人）', 回数: RUNS }, 入口: {} };
  try {
    // 測る前に、測り方が効くかを1つ確かめる：遅くしない時の方が速いか（遅くする設定が本当に効いているか・落とし穴28）
    for (const url of ['/', '/fes']) {
      const runs = [];
      for (let i = 0; i <= RUNS; i++) {
        const 素 = i === 0;   // 0回目は遅くしない（物差しの確かめ）
        const d = await b.newDevice('重さ' + i, { width: 390, height: 844, mobile: true, deviceScaleFactor: 2 });
        await d.raw('Network.enable');
        if (!素) {
          await d.raw('Network.emulateNetworkConditions', FAST3G);
          await d.raw('Emulation.setCPUThrottlingRate', { rate: CPU });
        }
        await d.raw('Page.addScriptToEvaluateOnNewDocument', { source: 見張り });
        await d.raw('Page.navigate', { url: base + url });
        const t0 = Date.now();
        let r = null;
        for (;;) {
          await sleep(500);
          try { r = await d.ev(結果を読む); } catch (e) { r = null; }
          if (r && r.load && r.押せる != null) break;
          if (Date.now() - t0 > 180000) break;
        }
        if (!素) await d.raw('Emulation.setCPUThrottlingRate', { rate: 1 });
        (素 ? (記録.入口[url + '（遅くしない）'] = r) : runs.push(r));
        console.log(url, 素 ? '遅くしない' : (i + '回目'), JSON.stringify({ 最初に描く: r && r.最初に描く, 押せる: r && r.押せる, DOM: r && r.DOM, load: r && r.load, KB: r && r.運んだKB, 何: r && r.押せたもの }));
        await d.close();
      }
      記録.入口[url] = { 中央値: { 最初に描く: 中央値(runs.map((r) => r && r.最初に描く)), 押せる: 中央値(runs.map((r) => r && r.押せる)),
        DOM: 中央値(runs.map((r) => r && r.DOM)), load: 中央値(runs.map((r) => r && r.load)), 運んだKB: 中央値(runs.map((r) => r && r.運んだKB)) }, 毎回: runs };
      const 素 = 記録.入口[url + '（遅くしない）'];
      記録.入口[url].物差し = { 遅くしない時の押せる: 素 && 素.押せる, 遅くした時の方が遅い: !!(素 && 素.押せる != null && 記録.入口[url].中央値.押せる > 素.押せる) };
    }
  } finally {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(記録, null, 1));
    await b.close();
    proxy.close();
    if (child) { try { child.kill(); } catch (e) {} }
  }
  for (const u of ['/', '/fes']) console.log(u, '中央値', JSON.stringify((記録.入口[u] || {}).中央値), '物差し', JSON.stringify((記録.入口[u] || {}).物差し));
  console.log('→', path.relative(ROOT, OUT));
})().catch((e) => { console.error(e); process.exit(2); });
