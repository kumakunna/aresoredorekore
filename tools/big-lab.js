#!/usr/bin/env node
// tools/big-lab.js — 大画面（TV）の実験台（指示64）
//
//   node tools/big-lab.js --port 3990 --cdp 9690
//   node tools/big-lab.js --only bomb-coop.ended          # 名前（シナリオ.場面）の一部で絞る
//   node tools/big-lab.js --only auction --sizes 1280     # 大きさを絞る（既定 1280,1920）
//   node tools/big-lab.js --port 3991 --cdp 9691 --out docs/監査_大画面の画像/lab-b   # 2本目を別の置き場へ
//
// **なぜ作ったか。**tools/big-census.js は本物のサーバーと bot で1ゲームを最後まで通しながら撮る。
// 流れそのものが見えるかわりに、1本 10〜30 分かかり、16人・同着・爆発の瞬間のような場面には届きにくい。
// この道具は**サーバーも bot も立てない**。かわりに：
//   ・ページは本物（public/ をそのまま配る。index.html も public/js も手を入れない）
//   ・socket.io だけ疑似（tests/harness.js の `window.__rtFake` を**その場で読み出して**配る。写さない）
//   ・部屋の状態は本物の進行役で作る（tools/big-lab-scenes.js：RoomStore＋*-room.js＋publicSnapshot。落とし穴25）
//   ・大画面には、人と同じ道で入る（安全の案内 → 入口「大画面として部屋に入る」→ コードと名前 → 入る）
// 1280×720 と 1920×1080 の両方で、tools/big-measure.js の式で測って撮る（big-census.js と同じ式・写さない）。
//
// **測る前に、測り方が効くかを確かめる**（落とし穴28・10-f）：
//   ① 時計：rAF が回るか・setTimeout が素直か・CSSアニメーションの時計が進むか（落とし穴28 第46・47弾）
//   ② 物差し：大画面の舞台に flex:none の 900px の箱を入れ、本当に 900px になったかを測ってから、
//      「切れ／巻き」として拾われるかを見る。外したら元の数にもどるかも見る（落とし穴10-f 49-2）
//   ③ 小さい字：12px の字を1つ入れて、小さい字の数が1つ増えるかを見る
// どれかが効かなければ、その回の数は信じられないので**止める**。
//
// 出力：docs/監査_大画面の画像/lab/<シナリオ.場面>_<人数>_<幅>.jpg と 記録.json（gitignore 済みの置き場）。
//       --only の回は 記録_<絞り>.json に書き、全部の回の 記録.json と画像の掃除はしない
// 待ち方は「時間」ではなく「出たか・落ち着いたか」（落とし穴24）。検証用の Chrome は音を出さない（cdp.js --mute-audio）。

const fs = require('fs');
const path = require('path');
const http = require('http');
const { launch, sleep } = require('./cdp');
const { 測る, 演出の重なり } = require('./big-measure');
const L = require('./big-lab-scenes');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : argv[i + 1]; };
const PORT = parseInt(arg('port', '3990'), 10);
const CDP = parseInt(arg('cdp', '9690'), 10);
const ONLY = arg('only', null);
const SIZES = String(arg('sizes', '1280,1920')).split(',').map((s) => parseInt(s, 10)).filter(Boolean)
  .map((w) => [w, Math.round(w * 9 / 16)]);
const BASE = 'http://localhost:' + PORT;
// 置き場。**2本を同時に回す時は --out で分ける**——全部の回は始めに置き場の画像と記録を消すので、
// 同じ置き場で2本が走ると、あとから始めた方が先の方の絵を消す（flow-walk.js の --out と同じ考え）
const OUT = arg('out', null) ? path.resolve(arg('out', null)) : path.join(ROOT, 'docs', '監査_大画面の画像', 'lab');
// 絞った回（--only）は、全部を回した回の 記録.json を上書きしない（別の名前に書く）
const 記録の名前 = ONLY ? '記録_' + String(ONLY).replace(/[\\/:*?"<>|\s]/g, '_') + '.json' : '記録.json';

// ======================= 疑似 socket.io（tests/harness.js から読み出す） =======================
// harness.js の launch() の中に、テンプレート文字列として置いてある。**写さずに、その場で切り出す**——
// 写すと、テストの疑似サーバーだけ直った日に、この道具だけ古い振る舞いのまま残る（落とし穴1）
function 疑似socketを読む() {
  const src = fs.readFileSync(path.join(ROOT, 'tests', 'harness.js'), 'utf8');
  const head = 'const fake = `<script>';
  const a = src.indexOf(head);
  const b = src.indexOf('</script>`', a);
  if (a < 0 || b < 0) throw new Error('tests/harness.js に疑似socket（const fake = `<script>…）が見つかりません。書式が変わった？');
  const js = src.slice(a + head.length, b);
  if (js.indexOf('window.__rtFake') === -1 || js.indexOf('window.io = function') === -1 || js.indexOf('${') !== -1) {
    throw new Error('tests/harness.js の疑似socketの形が想定と違います（__rtFake / window.io / 差し込み無し）');
  }
  return js;
}

// ======================= 静的な配り手（サーバーの代わり） =======================
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.json': 'application/json', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.webp': 'image/webp', '.gif': 'image/gif' };
const 届いた頼み = { api: {}, 無い: {} };
function 配り手を立てる(fakeJs) {
  const server = http.createServer((req, res) => {
    const p = decodeURIComponent(String(req.url).split('?')[0]);
    if (p === '/socket.io/socket.io.js') {
      res.writeHead(200, { 'Content-Type': TYPES['.js'], 'Cache-Control': 'no-store' });
      return res.end(fakeJs);
    }
    if (p.indexOf('/api/') === 0) {
      // 大画面はゲスト（ログインしていない）。本物のサーバーも未ログインには 401 を返す（requireAuth）
      届いた頼み.api[req.method + ' ' + p] = (届いた頼み.api[req.method + ' ' + p] || 0) + 1;
      res.writeHead(401, { 'Content-Type': TYPES['.json'] });
      return res.end(JSON.stringify({ error: '未ログイン' }));
    }
    const file = path.normalize(path.join(PUBLIC, p === '/' ? 'index.html' : p));
    if (file.indexOf(PUBLIC) !== 0) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, buf) => {
      if (err) {
        届いた頼み.無い[p] = (届いた頼み.無い[p] || 0) + 1;
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('not found');
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      res.end(buf);
    });
  });
  return new Promise((ok, ng) => { server.once('error', ng); server.listen(PORT, () => ok(server)); });
}

// ======================= ページの中の小道具 =======================
// 落ち着いたか：DOM の書き換えが q ms 止まっていて、終わりのあるアニメーションが1つも走っておらず、
// **演出の重なり（爆発の帯・祝い・巨大カウントダウンなど）が画面に残っていない**。
// 重なりは測り（big-measure.js）からは除いているが、写真には写る——帯が出たままの写真では版組みが見えない。
// 重なりの名前は big-measure.js の一覧をそのまま使う（写さない）。容器（.fx-notices）は空なら大きさ0なので数えない
const 見張りを置く = `(function(){ if(window.__lab) return true;
  window.__lab = { n: 0, last: performance.now() };
  new MutationObserver(function(){ __lab.n++; __lab.last = performance.now(); })
    .observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  return true; })()`;
const 落ち着いた = (q) => `(function(){
  if(!window.__lab) return false;
  var 走る = document.getAnimations().filter(function(a){
    if(a.playState !== 'running') return false;
    var t = a.effect && a.effect.getComputedTiming && a.effect.getComputedTiming();
    return !!t && isFinite(t.endTime);
  });
  var 重 = ${JSON.stringify(演出の重なり)};
  var 残る = Array.prototype.filter.call(document.querySelectorAll('#uiLayerRoot *, #scr-rt-big .big-cd'), function(e){
    var cl = e.classList; var hit = false;
    for(var i=0;i<重.length;i++){ if(cl.contains(重[i])) { hit = true; break; } }
    if(!hit) return false;
    var r = e.getBoundingClientRect(); if(r.width < 1 || r.height < 1) return false;
    var cs = getComputedStyle(e); return cs.visibility !== 'hidden' && +cs.opacity > 0.02 && cs.display !== 'none';
  });
  window.__labOverlay = 残る.map(function(e){ return e.className; }).slice(0, 4);
  return performance.now() - __lab.last > ${q} && 走る.length === 0 && 残る.length === 0;
})()`;
const 二コマ = `new Promise(function(r){ requestAnimationFrame(function(){ requestAnimationFrame(function(){ r(true); }); }); })`;
const 画面 = `(document.querySelector('.screen.active')||{}).id`;

async function 落ち着くまで(dev, ms) {
  const t0 = Date.now();
  for (;;) {
    let ok = false;
    try { ok = await dev.ev(落ち着いた(300)); } catch (e) {}
    if (ok) { await dev.ev(二コマ); return { ms: Date.now() - t0, 落ち着いた: true }; }
    if (Date.now() - t0 > (ms || 6000)) {
      await dev.ev(二コマ);
      const 残った演出 = await dev.ev('window.__labOverlay || []').catch(() => []);
      return { ms: Date.now() - t0, 落ち着いた: false, 残った演出 };
    }
    await sleep(80);
  }
}

async function 大きさを変える(dev, w, h) {
  await dev.raw('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  // 変えた大きさが本当に効いたかを、同じ物差し（clientWidth/Height）で1つ確かめる（落とし穴28）
  await dev.until(`document.documentElement.clientWidth===${w}&&document.documentElement.clientHeight===${h}`, 4000, w + '×' + h + ' に変わる');
  await dev.ev('document.fonts.ready.then(function(){ return true; })');
}

// ======================= 大画面として入る（人と同じ道） =======================
async function 大画面として入る(dev, room) {
  // 前の回の記憶（安全の案内を見た・覚えている部屋）を持ち越さない——毎回「初めて開いた TV」
  try { await dev.ev("(function(){ try{ localStorage.clear(); sessionStorage.clear(); }catch(e){} return true; })()"); } catch (e) {}
  await dev.raw('Page.navigate', { url: BASE + '/?lab=' + Date.now() });
  await dev.until("document.readyState==='complete'&&!!document.getElementById('safetyGate')&&!!window.__rtFake", 15000, 'ページの読み込み');
  // 扉（と初回の安全の案内）を越える：tools/flow-walk.js の 扉を越える と同じ見方
  await dev.until("document.getElementById('safetyGate').style.display==='flex'||" + 画面 + "!=='scr-door'", 10000, '起動');
  if (await dev.ev("document.getElementById('safetyGate').style.display==='flex'")) await dev.click('#sgStartBtn');
  await dev.until(画面 + "==='scr-entry'", 10000, '入口');
  await dev.click('[data-entry="big"]');
  await dev.until(画面 + "==='scr-rt-lobby'", 8000, '部屋に入る画面');
  // 返事を先に置いてから押す（大画面の端末＝memberId 'tv'。役割は bigscreen、進行役ではない）
  await dev.ev('(function(){ var R=' + JSON.stringify(room) + '; window.__rtFake.replies = { "room:join": function(){ return { ok:true, code:R.code, memberId:' +
    JSON.stringify(L.TV_ID) + ', room:R }; } }; ' +
    "document.getElementById('rtJoinCode').value=R.code; document.getElementById('rtJoinName').value='テレビ'; return true; })()");
  await dev.click('#rtJoinBtn');
  await dev.until(画面 + "==='scr-rt-big'", 10000, '大画面の画面');
  await dev.ev(見張りを置く);
}

async function 流す(dev, room) {
  const n0 = await dev.ev('window.__lab ? __lab.n : 0');
  await dev.ev('(function(){ window.__rtFake.fire("room:update", ' + JSON.stringify(room) + '); return true; })()');
  // 描き直しが起きたこと（書き換えが1つ以上）を先に見て、それから落ち着くのを待つ
  try { await dev.until('window.__lab && __lab.n > ' + n0, 3000, '描き直し'); } catch (e) { return { 描き直し: false }; }
  return { 描き直し: true };
}

// ======================= 測り方の自己検査（落とし穴28・10-f） =======================
async function 時計を確かめる(dev) {
  return dev.ev(`(async function(){
    var out = {};
    var t = performance.now(); await new Promise(function(r){ setTimeout(r, 60); }); out.setTimeout60 = Math.round(performance.now() - t);
    t = performance.now(); var ok = await Promise.race([ new Promise(function(r){ requestAnimationFrame(function(){ r(true); }); }), new Promise(function(r){ setTimeout(function(){ r(false); }, 1000); }) ]);
    out.rAF = ok; out.rAFms = Math.round(performance.now() - t);
    var e = document.createElement('div'); e.style.cssText = 'position:fixed;left:-50px;top:0;width:10px;height:10px;';
    document.body.appendChild(e);
    var a = e.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 1000 });
    var t0 = document.timeline.currentTime;
    await new Promise(function(r){ setTimeout(r, 250); });
    out.timeline進み = Math.round(document.timeline.currentTime - t0);
    out.animation進み = Math.round(a.currentTime || 0);
    a.cancel(); e.remove();
    out.見える = document.visibilityState;
    out.健全 = out.setTimeout60 < 300 && out.rAF && out.timeline進み > 100 && out.animation進み > 100;
    return out;
  })()`);
}

async function 物差しを確かめる(dev) {
  const 元 = await dev.ev(測る);
  // ② 900px の箱。**flex:none を付ける**——付けないと縦並びの flex に縮められて、一度もはみ出さない（指示49 49-2）
  const 箱 = await dev.ev(`(function(){
    var host = document.querySelector('#scr-rt-big .big-stage') || document.querySelector('#scr-rt-big');
    var d = document.createElement('div'); d.id = 'labProbe900';
    d.style.cssText = 'flex:none;display:block;height:900px;min-height:900px;width:240px;font-size:40px;background:#f0f;color:#000;';
    d.textContent = '自己検査の箱';
    host.appendChild(d);
    return { 置き場: host.id || host.className, 高さ: Math.round(d.getBoundingClientRect().height) };
  })()`);
  await dev.ev(二コマ);
  const 入れた = await dev.ev(測る);
  await dev.ev("(function(){ var d=document.getElementById('labProbe900'); if(d) d.remove(); return true; })()");
  await dev.ev(二コマ);
  const 外した = await dev.ev(測る);
  // ③ 小さい字（12px）を1つ
  await dev.ev(`(function(){
    var host = document.querySelector('#scr-rt-big .big-stage') || document.querySelector('#scr-rt-big');
    var d = document.createElement('span'); d.id = 'labProbe12'; d.style.cssText = 'font-size:12px;flex:none;';
    d.textContent = '小さい字の検査'; host.insertBefore(d, host.firstChild); return true; })()`);
  await dev.ev(二コマ);
  const 小 = await dev.ev(測る);
  await dev.ev("(function(){ var d=document.getElementById('labProbe12'); if(d) d.remove(); return true; })()");
  await dev.ev(二コマ);
  // ④ 演出の重なり（.big-cd）は、切れにも小さい字にも数えず「演出で除いた」に数える。
  //   画面の外へはみ出す位置に置いて、**除かなければ切れに数えられる形**を作ってから見る（落とし穴10-b）
  await dev.ev(`(function(){
    var host = document.getElementById('scr-rt-big');
    var d = document.createElement('div'); d.id = 'labProbeCd'; d.className = 'big-cd';
    d.style.cssText = 'position:fixed;left:-40px;top:-40px;font-size:12px;animation:none;opacity:1;transform:none;';
    d.textContent = '9'; host.appendChild(d); return true; })()`);
  await dev.ev(二コマ);
  const 演 = await dev.ev(測る);
  await dev.ev("(function(){ var d=document.getElementById('labProbeCd'); if(d) d.remove(); return true; })()");
  await dev.ev(二コマ);
  const 巻きか切れ = (m) => (m.ページの巻き > 0 ? 1 : 0) + m.箱の巻き.length + m.切れの数;
  const 拾った = 入れた.切れ.some((x) => /labProbe900/.test(x.何)) || 入れた.ページの巻き > 元.ページの巻き || 入れた.箱の巻き.length > 元.箱の巻き.length;
  const r = {
    箱の高さ: 箱.高さ, 箱の置き場: 箱.置き場,
    元: { 巻き: 元.ページの巻き, 箱の巻き: 元.箱の巻き.length, 切れ: 元.切れの数, 小さい: 元.小さいの数 },
    入れた: { 巻き: 入れた.ページの巻き, 箱の巻き: 入れた.箱の巻き.length, 切れ: 入れた.切れの数, 小さい: 入れた.小さいの数 },
    外した: { 巻き: 外した.ページの巻き, 箱の巻き: 外した.箱の巻き.length, 切れ: 外した.切れの数, 小さい: 外した.小さいの数 },
    小さい字: { 前: 外した.小さいの数, 入れた: 小.小さいの数 }
  };
  r.箱が本当に900 = 箱.高さ >= 899;                                  // 壊したら、壊れたことを1つ測る（落とし穴10-f）
  r.箱を拾った = 拾った && 巻きか切れ(入れた) > 巻きか切れ(元);
  r.外すと戻る = 巻きか切れ(外した) === 巻きか切れ(元);
  r.小さい字を拾った = 小.小さい.some((x) => /labProbe12/.test(x.何)) && 小.小さいの数 === 外した.小さいの数 + 1;
  r.演出 = { 前: 外した.演出で除いた, 入れた: 演.演出で除いた, 切れ: 演.切れの数, 小さい: 演.小さいの数, 例: 演.除いた例 };
  r.演出を除いた = 演.演出で除いた === 外した.演出で除いた + 1 && 演.除いた例.some((x) => /labProbeCd/.test(x)) &&
    演.切れの数 === 外した.切れの数 && 演.小さいの数 === 外した.小さいの数;
  r.健全 = r.箱が本当に900 && r.箱を拾った && r.外すと戻る && r.小さい字を拾った && r.演出を除いた;
  return r;
}

// ======================= 表 =======================
function 幅をそろえる(s, n) {
  s = String(s);
  let w = 0; for (const ch of s) w += /[　-鿿＀-￯]/.test(ch) ? 2 : 1;
  return s + ' '.repeat(Math.max(0, n - w));
}

(async () => {
  const fakeJs = 疑似socketを読む();
  fs.mkdirSync(OUT, { recursive: true });
  if (!ONLY) fs.readdirSync(OUT).filter((f) => /\.(jpg|json)$/.test(f)).forEach((f) => fs.unlinkSync(path.join(OUT, f)));
  const server = await 配り手を立てる(fakeJs);
  const chrome = await launch({ port: CDP });
  const dev = await chrome.newDevice('大画面', { width: SIZES[0][0], height: SIZES[0][1], deviceScaleFactor: 1, mobile: false });
  const 記録 = { 始めた: new Date().toISOString(), 大きさ: SIZES.map((s) => s.join('x')), only: ONLY, 自己検査: null, 場面: [], 作れなかった: [], ページの例外: [] };
  const t0 = Date.now();
  let 止める = null;
  let 例外の数 = 0;
  const 例外を拾う = (どこ) => {
    while (例外の数 < dev.logs.length) {
      const msg = dev.logs[例外の数++];
      記録.ページの例外.push({ どこ, msg });
    }
  };

  try {
    // ---- 自己検査（いちばん最初の待合で） ----
    const 最初 = L.SCENARIOS[0];
    const 入口 = L.回す(最初, 4).next().value;
    await 大画面として入る(dev, 入口.snap);
    await 落ち着くまで(dev, 8000);
    const 時計 = await 時計を確かめる(dev);
    const 物差し = await 物差しを確かめる(dev);
    記録.自己検査 = { 時計, 物差し };
    console.log('== 自己検査（測り方が効くか）==');
    console.log('  時計：setTimeout(60)=' + 時計.setTimeout60 + 'ms・rAF=' + 時計.rAF + '(' + 時計.rAFms + 'ms)・timeline +' + 時計.timeline進み +
      'ms/250ms・CSSアニメ +' + 時計.animation進み + 'ms・' + 時計.見える + ' → ' + (時計.健全 ? '健全' : '✖ 壊れている'));
    console.log('  物差し：900px の箱（' + 物差し.箱の置き場 + ' に入れて実寸 ' + 物差し.箱の高さ + 'px）→ 巻き ' + 物差し.元.巻き + '→' + 物差し.入れた.巻き +
      '・箱の巻き ' + 物差し.元.箱の巻き + '→' + 物差し.入れた.箱の巻き + '・切れ ' + 物差し.元.切れ + '→' + 物差し.入れた.切れ +
      '／外すと 巻き ' + 物差し.外した.巻き + '・箱の巻き ' + 物差し.外した.箱の巻き + '・切れ ' + 物差し.外した.切れ + ' → ' +
      (物差し.箱を拾った && 物差し.外すと戻る && 物差し.箱が本当に900 ? '拾えた' : '✖ 拾えていない'));
    console.log('  小さい字：12px を1つ入れて ' + 物差し.小さい字.前 + '→' + 物差し.小さい字.入れた + ' → ' + (物差し.小さい字を拾った ? '拾えた' : '✖ 拾えていない'));
    console.log('  演出の重なり：画面の外にはみ出す 12px の .big-cd を1つ入れて 演出で除いた ' + 物差し.演出.前 + '→' + 物差し.演出.入れた +
      '・切れ ' + 物差し.外した.切れ + '→' + 物差し.演出.切れ + '・小さい字 ' + 物差し.小さい字.前 + '→' + 物差し.演出.小さい + ' → ' +
      (物差し.演出を除いた ? '除けた（黙って落とさず数えた）' : '✖ 除けていない'));
    if (!時計.健全 || !物差し.健全) throw new Error('自己検査が通りません。この回の数は信じられないので止めます');
    例外を拾う('自己検査');

    // ---- 本番 ----
    console.log('== 場面 ==');
    for (const spec of L.SCENARIOS) {
      for (const n of L.人数(spec)) {
        // 絞り込み：場面の名前を先に知る（進行役を空回しする。数ms）
        let 名前たち;
        try { 名前たち = Array.from(L.回す(spec, n)).map((f) => spec.name + '.' + f.label); }
        catch (e) { 記録.作れなかった.push({ シナリオ: spec.name, 人数: n, 理由: e.message }); console.log('  ✖ ' + spec.name + ' ' + n + '人：作れません（' + e.message + '）'); continue; }
        if (ONLY && !名前たち.some((x) => x.indexOf(ONLY) !== -1)) continue;

        const it = L.回す(spec, n);
        let 初回 = true;
        const 使った = {};
        try {
          for (const f of it) {
            let 名 = spec.name + '.' + f.label;
            if (使った[名]) 名 += '-' + (++使った[名]); else 使った[名] = 1;
            if (f.作れなかった) { 記録.作れなかった.push({ 場面: 名, 人数: n, 理由: f.作れなかった }); console.log('  ✖ ' + 名 + ' ' + n + '人：' + f.作れなかった); continue; }
            if (ONLY && 名.indexOf(ONLY) === -1 && !初回) continue;
            const 見る = !ONLY || 名.indexOf(ONLY) !== -1;
            let 流れ;
            if (初回) {
              // 1グループに1回、人と同じ道で入り直す（前のゲームの名残りを持ち越さない）
              await 大きさを変える(dev, SIZES[0][0], SIZES[0][1]);
              await 大画面として入る(dev, f.snap);
              流れ = { 描き直し: true };
              初回 = false;
            } else {
              流れ = await 流す(dev, f.snap);
            }
            if (!見る) continue;
            const 待ち = await 落ち着くまで(dev, 6000);
            const rec = { 場面: 名, シナリオ: spec.name, 状態: f.label, 人数: n, 一位: f.一位, 描き直し: 流れ.描き直し, 落ち着き: 待ち, 測り: {} };
            // 大きさの順は1枚ごとに入れ替える（変える回数を半分にする）
            const 順 = (記録.場面.length % 2 === 0) ? SIZES : SIZES.slice().reverse();
            for (const [w, h] of 順) {
              await 大きさを変える(dev, w, h);
              const 待ち2 = await 落ち着くまで(dev, 3000);
              const m = await dev.ev(測る);
              const file = 名 + '_' + n + '_' + w + '.jpg';
              await dev.shot(path.join(OUT, file));
              m.画像 = file;
              m.落ち着き = 待ち2;
              rec.測り[w + 'x' + h] = m;
            }
            例外を拾う(名 + ' ' + n + '人');
            rec.例外 = 記録.ページの例外.filter((x) => x.どこ === 名 + ' ' + n + '人').map((x) => x.msg);
            記録.場面.push(rec);
            const 行 = SIZES.map(([w, h]) => {
              const m = rec.測り[w + 'x' + h];
              const 悪い = m.画面 !== 'scr-rt-big' || m.ページの巻き > 0 || m.箱の巻き.length || m.切れの数 || m.小さいの数;
              return (悪い ? '✖' : '○') + w + ' 巻き' + m.ページの巻き + ' 箱' + m.箱の巻き.length + ' 切れ' + m.切れの数 + ' 小' + m.小さいの数 + (m.演出で除いた ? ' 演除' + m.演出で除いた : '') +
                (m.画面 !== 'scr-rt-big' ? ' 画面=' + m.画面 : '');
            }).join(' ｜ ');
            console.log('  ' + 幅をそろえる(名, 34) + 幅をそろえる(n + '人', 5) + 行 + (rec.例外.length ? ' ⚠例外' + rec.例外.length : '') + (待ち.落ち着いた ? '' : ' (落ち着かず' + ((待ち.残った演出 || []).length ? '：演出 ' + 待ち.残った演出.join(' / ') : '') + ')'));
          }
        } catch (e) {
          記録.作れなかった.push({ シナリオ: spec.name, 人数: n, 理由: '道具：' + String(e && e.message || e) });
          console.log('  ✖ ' + spec.name + ' ' + n + '人：途中で止まりました（' + String(e && e.message || e).split('\n')[0] + '）');
          例外を拾う(spec.name + ' ' + n + '人');
          try { it.return(); } catch (x) {}
        }
      }
    }
  } catch (e) {
    止める = e;
    console.error('止めました：' + (e && e.stack || e));
  } finally {
    例外を拾う('最後');
    記録.かかった秒 = Math.round((Date.now() - t0) / 1000);
    記録.ページが頼んだもの = 届いた頼み;
    fs.writeFileSync(path.join(OUT, 記録の名前), JSON.stringify(記録, null, 1));

    // ---- まとめの表 ----
    console.log('\n== まとめ（' + 記録.場面.length + ' 場面・' + 記録.かかった秒 + '秒）==');
    console.log(幅をそろえる('場面', 36) + 幅をそろえる('人数', 6) + 幅をそろえる('大きさ', 11) + 幅をそろえる('ページの巻きpx', 15) + 幅をそろえる('中の巻き', 10) + 幅をそろえる('切れ', 6) + 幅をそろえる('小さい字', 10) + 幅をそろえる('演出で除いた', 14) + '判定');
    let 悪い数 = 0;
    for (const rec of 記録.場面) {
      for (const [w, h] of SIZES) {
        const m = rec.測り[w + 'x' + h];
        if (!m) continue;
        const 理由 = [];
        if (m.画面 !== 'scr-rt-big') 理由.push('画面=' + m.画面);
        if (m.ページの巻き > 0) 理由.push('巻き');
        if (m.箱の巻き.length) 理由.push('中の巻き');
        if (m.切れの数) 理由.push('切れ');
        if (m.小さいの数) 理由.push('小さい字');
        if (理由.length) 悪い数++;
        console.log(幅をそろえる(rec.場面, 36) + 幅をそろえる(rec.人数, 6) + 幅をそろえる(w + 'x' + h, 11) + 幅をそろえる(m.ページの巻き, 15) +
          幅をそろえる(m.箱の巻き.length ? m.箱の巻き.map((x) => x.中身 - x.見える高さ).join('/') : 0, 10) + 幅をそろえる(m.切れの数, 6) +
          幅をそろえる(m.小さいの数, 10) + 幅をそろえる(m.演出で除いた, 14) + (理由.length ? '✖ ' + 理由.join('・') : '○'));
      }
    }
    console.log('✖ ' + 悪い数 + ' / ' + 記録.場面.length * SIZES.length);
    if (記録.作れなかった.length) {
      console.log('\n== 作れなかった場面 ==');
      記録.作れなかった.forEach((x) => console.log('  ' + (x.場面 || x.シナリオ) + ' ' + x.人数 + '人：' + x.理由));
    }
    console.log('\n== ページの例外（cdp.js の logs）==');
    if (!記録.ページの例外.length) console.log('  なし');
    const 束 = {};
    記録.ページの例外.forEach((x) => { const k = x.msg.split('\n')[0]; (束[k] = 束[k] || []).push(x.どこ); });
    Object.keys(束).forEach((k) => console.log('  ' + k + '\n    → ' + 束[k].length + ' 回（' + Array.from(new Set(束[k])).slice(0, 6).join('、') + (束[k].length > 6 ? ' …' : '') + '）'));
    console.log('\n== ページが頼んだもの ==');
    console.log('  /api：' + (Object.keys(届いた頼み.api).map((k) => k + '×' + 届いた頼み.api[k]).join('、') || 'なし') + '（すべて 401 未ログイン で返した）');
    console.log('  見つからなかったファイル：' + (Object.keys(届いた頼み.無い).join('、') || 'なし'));
    console.log('\n画像と記録：' + path.relative(ROOT, OUT));
    try { await dev.close(); } catch (e) {}
    try { await chrome.close(); } catch (e) {}
    server.close();
    process.exit(止める ? 1 : 0);
  }
})();
