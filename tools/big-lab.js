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
//   ⑦ BGM の拍：オークションの競りでページ自身が打つ拍（縁の脈）の中でも「落ち着いた」になり、
//      対照の 1500ms の動きを足すと「落ち着かない」になるか（拍を除く・同じ値に戻る書き換えを数えない、が効くか）
// どれかが効かなければ、その回の数は信じられないので**止める**。
//
// 出力：docs/監査_大画面の画像/lab/<シナリオ.場面>_<人数>_<幅>.jpg と 記録.json（gitignore 済みの置き場）。
//       --only の回は 記録_<絞り>.json に書き、全部の回の 記録.json と画像の掃除はしない
// 待ち方は「時間」ではなく「出たか・落ち着いたか」（落とし穴24）。検証用の Chrome は音を出さない（cdp.js --mute-audio）。

const fs = require('fs');
const path = require('path');
const http = require('http');
const { launch, sleep } = require('./cdp');
const { 測る, 演出の重なり, 走る演出, 走る演出の名, 拍の数 } = require('./big-measure');
const L = require('./big-lab-scenes');

// 走っている演出の式（BGMの拍を除く）は big-measure.js から。big-census.js も同じものを読む（写さない・落とし穴1）。
// **ここで1度だけ組み立てる**——拍の規則が index.html に見つからなければ、ここで止まる。
// 落ち着くまで の try の中で組み立てると、失敗が飲み込まれて全部の場面が黙って「落ち着かず」になる（落とし穴10-e）
const 走る式 = 走る演出();
const 走る名の式 = 走る演出の名();
const 拍の数式 = 拍の数();

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
const PROBE = arg('probe', null);
// --fx：出ている最中の演出（始まりの 3-2-1・残り5秒からの巨大カウントダウン）も撮る。下の「--fx」を見る
const FX = argv.indexOf('--fx') !== -1;
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
//
// **同じ値に戻っただけの属性の書き換えは、書き換えに数えない**（指示64）。BGM の拍（bgmBeat）は 0.46秒ごとに
// #scr-rt-big の class から bgm-beat を外して付け直す——数えると、競りの間ずっと「書き換えたばかり」になる。
// 1回の知らせ（MutationObserver の1束）の中で、属性ごとに「始めの値」と「いまの値」を比べ、どれも同じなら数えない
//（class は字の並びではなく、名前の集まりで比べる：外して付け直すと末尾へ回るので）。数えなかった束は 戻った に数える。
// 要素ごとの控えは Object.create(null)——ふつうの {} だと 'constructor' のような名前が「もう控えた」に見える
const 見張りを置く = `(function(){ if(window.__lab) return true;
  window.__lab = { n: 0, last: performance.now(), 戻った: 0 };
  function 同じか(name, a, b){
    if(a === b) return true;
    if(name !== 'class' || a == null || b == null) return false;
    return a.trim().split(/\\s+/).sort().join(' ') === b.trim().split(/\\s+/).sort().join(' ');
  }
  new MutationObserver(function(recs){
    var 変わった = false, 始め = new Map();
    for(var i = 0; i < recs.length; i++){
      var r = recs[i];
      if(r.type !== 'attributes'){ 変わった = true; break; }
      var m = 始め.get(r.target);
      if(!m){ m = Object.create(null); 始め.set(r.target, m); }
      if(!(r.attributeName in m)) m[r.attributeName] = r.oldValue;
    }
    if(!変わった) 始め.forEach(function(m, t){ for(var k in m){ if(!同じか(k, m[k], t.getAttribute(k))) 変わった = true; } });
    if(変わった){ __lab.n++; __lab.last = performance.now(); } else __lab.戻った++;
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true, attributeOldValue: true });
  return true; })()`;
const 落ち着いた = (q) => `(function(){
  if(!window.__lab) return false;
  var 走る = ${走る式};
  var 重 = ${JSON.stringify(演出の重なり)};
  var 残る = Array.prototype.filter.call(document.querySelectorAll('#uiLayerRoot *, #scr-rt-big .big-cd'), function(e){
    var cl = e.classList; var hit = false;
    for(var i=0;i<重.length;i++){ if(cl.contains(重[i])) { hit = true; break; } }
    if(!hit) return false;
    var r = e.getBoundingClientRect(); if(r.width < 1 || r.height < 1) return false;
    var cs = getComputedStyle(e); return cs.visibility !== 'hidden' && +cs.opacity > 0.02 && cs.display !== 'none';
  });
  window.__labOverlay = 残る.map(function(e){ return e.className; }).slice(0, 4);
  // 大画面の名簿の測り直し（bigReflowSoon）が残っている間と、字の形が届く前は、まだ落ち着いていない
  var 待ち = !!window.__bigReflowPending || (document.fonts && document.fonts.status !== 'loaded');
  var 静か = Math.round(performance.now() - __lab.last);
  // 落ち着かなかった時に「なぜ」を記録へ残すための控え（落ち着くまで が読む）
  window.__labWhy = { 書き換えから: 静か, 走る: 走る.length, 重なり: 残る.length, 測り直し待ち: !!window.__bigReflowPending,
    字の形: !(document.fonts && document.fonts.status !== 'loaded') };
  return 静か > ${q} && 走る.length === 0 && 残る.length === 0 && !待ち;
})()`;
const 二コマ = `new Promise(function(r){ requestAnimationFrame(function(){ requestAnimationFrame(function(){ r(true); }); }); })`;
const 画面 = `(document.querySelector('.screen.active')||{}).id`;

async function 落ち着くまで(dev, ms) {
  const t0 = Date.now();
  const 式 = 落ち着いた(300);
  // 評価の失敗は数える（前は catch で黙って false にしていた——式が壊れると、全部の場面が黙って「落ち着かず」になる・落とし穴10-e）
  let 失敗 = 0, 最初の失敗 = null, 測れた = 0;
  const 失敗の控え = () => (失敗 ? { 式の失敗: 失敗, 最初の失敗 } : {});
  for (;;) {
    let ok = false;
    try { ok = await dev.ev(式); 測れた++; } catch (e) { 失敗++; if (!最初の失敗) 最初の失敗 = String(e && e.message || e); }
    if (ok) { await dev.ev(二コマ); return Object.assign({ ms: Date.now() - t0, 落ち着いた: true }, 失敗の控え()); }
    if (Date.now() - t0 > (ms || 6000)) {
      // 一度も評価できなかった＝落ち着いたかを測れていない。「落ち着かず」として先へ進まず、止める
      if (!測れた) throw new Error('落ち着いたかを測る式が、' + 失敗 + ' 回とも評価できません：' + 最初の失敗);
      await dev.ev(二コマ);
      // なぜ落ち着かなかったか（走っていた演出の名前・残った重なり・最後の書き換えから何ms）を記録に残す
      const 読む = (s) => dev.ev(s).catch((e) => '(読めない：' + String(e && e.message || e).split('\n')[0] + ')');
      const 残った演出 = await 読む('window.__labOverlay || []');
      const 走っていた = await 読む(走る名の式);
      const なぜ = await 読む('window.__labWhy || null');
      return Object.assign({ ms: Date.now() - t0, 落ち着いた: false, 残った演出, 走っていた, なぜ }, 失敗の控え());
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
  // ③' 数字の段なのに 40px（28 は越えるが 48 に届かない）。**数字の下限 48 で拾えるか**（指示64の見直し）
  await dev.ev(`(function(){
    var host = document.querySelector('#scr-rt-big .big-stage') || document.querySelector('#scr-rt-big');
    var d = document.createElement('span'); d.id = 'labProbeNum'; d.className = 'tv-n';
    d.style.cssText = 'font-size:40px;flex:none;display:inline-block;';
    d.textContent = '7'; host.insertBefore(d, host.firstChild); return true; })()`);
  await dev.ev(二コマ);
  const 数 = await dev.ev(測る);
  await dev.ev("(function(){ var d=document.getElementById('labProbeNum'); if(d) d.remove(); return true; })()");
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
  // ⑤ 読めない名前：名前の箱を 40px にして、7字の名前を1字まで縮める。**縮んだことを先に1つ測る**（落とし穴10-f）
  await dev.ev(`(function(){
    var host = document.querySelector('#scr-rt-big .big-stage') || document.querySelector('#scr-rt-big');
    var d = document.createElement('span'); d.id = 'labProbeName'; d.className = 'bl-name';
    d.style.cssText = 'flex:none;display:block;width:40px;font-size:32px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    d.textContent = 'あいうえおかき'; host.insertBefore(d, host.firstChild); return true; })()`);
  await dev.ev(二コマ);
  const 名 = await dev.ev(測る);
  const 名の箱 = await dev.ev("(function(){ var d=document.getElementById('labProbeName'); var r={幅:d?d.clientWidth:0, 中身:d?d.scrollWidth:0}; if(d) d.remove(); return r; })()");
  await dev.ev(二コマ);
  // ⑥ 重なり：入場の知らせを QR の上に置く（QR の無い場面でも、置き場ごと作って見る）。切れに「重なり：」で数えるか
  await dev.ev(`(function(){
    var host = document.getElementById('scr-rt-big');
    var w = document.createElement('div'); w.id = 'labProbeOv';
    w.innerHTML = '<div id="bigQr"><svg width="120" height="120" style="position:fixed;left:200px;top:200px;"></svg></div>' +
      '<div class="be-item" style="position:fixed;left:220px;top:220px;width:120px;height:40px;animation:none;opacity:1;">知らせ</div>';
    host.appendChild(w); return true; })()`);
  await dev.ev(二コマ);
  const 重 = await dev.ev(測る);
  await dev.ev("(function(){ var d=document.getElementById('labProbeOv'); if(d) d.remove(); return true; })()");
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
  r.小さい数字 = { 前: 外した.小さいの数, 入れた: 数.小さいの数 };
  r.小さい数字を拾った = 数.小さい.some((x) => /labProbeNum/.test(x.何) && x.下限 >= 48) && 数.小さいの数 === 外した.小さいの数 + 1;
  r.演出 = { 前: 外した.演出で除いた, 入れた: 演.演出で除いた, 切れ: 演.切れの数, 小さい: 演.小さいの数, 例: 演.除いた例 };
  r.演出を除いた = 演.演出で除いた === 外した.演出で除いた + 1 && 演.除いた例.some((x) => /labProbeCd/.test(x)) &&
    演.切れの数 === 外した.切れの数 && 演.小さいの数 === 外した.小さいの数;
  r.読めない名前 = { 箱: 名の箱, 前: 外した.読めないの数, 入れた: 名.読めないの数 };
  r.読めない名前を拾った = 名の箱.中身 > 名の箱.幅 && 名.読めないの数 === 外した.読めないの数 + 1 &&
    (名.読めない || []).some((x) => /labProbe|bl-name/.test(x.何) && x.名 === 'あいうえおかき' && x.見 < 3);
  r.重なり = { 前: 外した.切れの数, 入れた: 重.切れの数 };
  r.重なりを拾った = 重.切れ.some((x) => /^重なり：/.test(x.何)) && 重.切れの数 >= 外した.切れの数 + 1;
  r.健全 = r.箱が本当に900 && r.箱を拾った && r.外すと戻る && r.小さい字を拾った && r.小さい数字を拾った && r.演出を除いた &&
    r.読めない名前を拾った && r.重なりを拾った;
  return r;
}

/**
 * ⑦ BGM の拍（縁の脈）の中でも「落ち着いた」と言えるか（指示64）。
 * **拍はページ自身に打たせる**——オークションの競り（phase bid）を本物の進行役で作って流し、
 * ページの見回り（bgmSync・500ms ごと）が本物の拍を始めるのを待つ。bgmBeat の中身を写して打つと、
 * ページの拍の打ち方が変わった日にも、写した方だけで通り続ける（落とし穴1）。
 *   (a) 拍が本当に走っている（除く相手がいる。いなければ (b) は自明に通る・落とし穴10-b）
 *       ＋同じ値に戻っただけの class の書き換え（戻った）が本当に起きている
 *   (b) その最中に、落ち着いた が true になる（拍が走っているのと同じ瞬間に見る）
 *   (c) 対照：1500ms の element.animate を1つ足すと、落ち着いた が false になる。
 *       DOM を書き換えずに動きだけ足す（要素を足すと、書き換えのせいで false になり、何も確かめていない）。
 *       足した瞬間に「最後の書き換えから 300ms 超」であることも見る
 */
async function 拍を確かめる(dev) {
  const spec = L.SCENARIOS.find((s) => s.name === 'auction-open');
  if (!spec) throw new Error('拍の自己検査：big-lab-scenes.js に auction-open が見つかりません');
  let 入口 = null, 競り = null;
  for (const f of L.回す(spec, 4)) {
    if (f.作れなかった) continue;
    if (!入口) 入口 = f;
    const v = f.snap && f.snap.state && f.snap.state.data;
    if (v && v.phase === 'bid') { 競り = f; break; }
  }
  if (!入口 || !競り) throw new Error('拍の自己検査：オークションの競り（phase bid）が作れません');
  await 大画面として入る(dev, 入口.snap);
  await 落ち着くまで(dev, 8000);
  const 流れ = await 流す(dev, 競り.snap);
  const r = { 場面: 'auction-open.' + 競り.label + ' 4人', 描き直し: 流れ.描き直し };
  // ページの見回りが拍を始めるまで（見回りは 500ms ごと）
  const t0 = Date.now();
  r.拍が出るまで = null;
  while (Date.now() - t0 < 5000) {
    if (await dev.ev(拍の数式) > 0) { r.拍が出るまで = Date.now() - t0; break; }
    await sleep(100);
  }
  // (a)(b) を同じ瞬間に見る。「前の見方」＝拍を除かない数え方（これが 0 にならないのが、直す前の症状）
  const 同時 = `(function(){ var ok = ${落ち着いた(300)};
    return { ok: ok, 拍: ${拍の数式},
      前の見方: document.getAnimations().filter(function(a){ if(a.playState!=='running') return false; var t=a.effect&&a.effect.getComputedTiming&&a.effect.getComputedTiming(); return !!t&&isFinite(t.endTime); }).length,
      戻った: window.__lab ? __lab.戻った : 0, なぜ: window.__labWhy || null }; })()`;
  let 見た = null;
  const t1 = Date.now();
  while (Date.now() - t1 < 8000) {
    見た = await dev.ev(同時);
    if (見た.ok && 見た.拍 > 0) break;
    await sleep(80);
  }
  r.同時 = 見た;
  r.落ち着くまで = Date.now() - t1;
  // (c) 対照。**足す直前に落ち着いている**瞬間を待ってから足す——ほかの理由（書き換え・重なり）で false になったのを
  // 「対照が効いた」と読まない。足した直後にも「最後の書き換えから 300ms 超」を見る
  let 対照 = null;
  for (let i = 0; i < 40; i++) {
    対照 = await dev.ev(`(function(){
      if(!window.__lab || performance.now() - __lab.last <= 400) return null;
      if(!(${落ち着いた(300)})) return null;
      var e = document.getElementById('bigPhase') || document.getElementById('scr-rt-big');
      var a = e.animate([{ opacity: 1 }, { opacity: 1 }], { duration: 1500 }); a.id = 'labControl1500';
      var ok = ${落ち着いた(300)};
      var 名 = ${走る名の式};
      var 書き換えから = Math.round(performance.now() - __lab.last);
      a.cancel();
      return { ok: ok, 名: 名, 書き換えから: 書き換えから };
    })()`);
    if (対照) break;
    await sleep(100);
  }
  r.対照 = 対照;
  r.拍が走っていた = !!見た && 見た.拍 > 0 && 見た.前の見方 > 0 && 見た.戻った > 0;
  r.拍の中で落ち着いた = !!見た && 見た.ok && 見た.拍 > 0;
  r.対照で落ち着かない = !!対照 && 対照.ok === false && 対照.書き換えから > 300 && (対照.名 || []).some((x) => /labControl1500/.test(x));
  r.健全 = !!r.描き直し && r.拍が走っていた && r.拍の中で落ち着いた && r.対照で落ち着かない;
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
    console.log('  数字の下限：数字の段に 40px を1つ入れて ' + 物差し.小さい数字.前 + '→' + 物差し.小さい数字.入れた + ' → ' + (物差し.小さい数字を拾った ? '拾えた（下限48）' : '✖ 拾えていない'));
    console.log('  演出の重なり：画面の外にはみ出す 12px の .big-cd を1つ入れて 演出で除いた ' + 物差し.演出.前 + '→' + 物差し.演出.入れた +
      '・切れ ' + 物差し.外した.切れ + '→' + 物差し.演出.切れ + '・小さい字 ' + 物差し.小さい字.前 + '→' + 物差し.演出.小さい + ' → ' +
      (物差し.演出を除いた ? '除けた（黙って落とさず数えた）' : '✖ 除けていない'));
    console.log('  読めない名前：40px の箱に7字の名前（中身 ' + 物差し.読めない名前.箱.中身 + 'px）を入れて ' + 物差し.読めない名前.前 + '→' + 物差し.読めない名前.入れた +
      ' → ' + (物差し.読めない名前を拾った ? '拾えた（3字未満）' : '✖ 拾えていない'));
    console.log('  知らせと QR の重なり：QR の上に知らせを1つ置いて 切れ ' + 物差し.重なり.前 + '→' + 物差し.重なり.入れた +
      ' → ' + (物差し.重なりを拾った ? '拾えた' : '✖ 拾えていない'));
    // ⑦ BGM の拍。ページ自身が打つ拍の中で（オークションの競りに入り直して）見る
    const 拍 = await 拍を確かめる(dev);
    記録.自己検査.拍 = 拍;
    const 同 = 拍.同時 || {};
    console.log('  BGMの拍：' + 拍.場面 + ' でページが拍を打つまで ' + 拍.拍が出るまで + 'ms・拍 ' + 同.拍 + '本（拍を除かない数え方なら ' + 同.前の見方 +
      '本）・戻っただけの書き換え ' + 同.戻った + '束 → ' + (同.ok ? '落ち着いた（' + 拍.落ち着くまで + 'ms）' : '✖ 落ち着かない ' + JSON.stringify(同.なぜ)) +
      '／対照 1500ms の動きを足すと ' + (拍.対照 ? (拍.対照.ok ? '✖ 落ち着いたまま' : '落ち着かない（' + (拍.対照.名 || []).join(',') + '・書き換えから ' + 拍.対照.書き換えから + 'ms）') : '✖ 足せなかった') +
      ' → ' + (拍.健全 ? '拍を除けた' : '✖ 除けていない'));
    if (!時計.健全 || !物差し.健全 || !拍.健全) throw new Error('自己検査が通りません。この回の数は信じられないので止めます');
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
        const fx = {};   // --fx：このシナリオ×人数で、もう撮った演出
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
            if (f.page) await dev.ev(f.page);
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
            // --fx：落ち着いた画面のほかに、**出ている最中の演出も1枚ずつ撮る**（本人の頼み：待機・カウントダウン中も見たい）。
            //   ① 始まりの 3-2-1：部屋が全員に配る room:countdown を、そのまま流す（受け手は本物の rt.on('countdown')）。
            //      遊ぶ最初の場面で1回。0.45秒後（「3」が出ている最中）に撮る
            //   ② 残り5秒からの巨大カウントダウン：進行役が play と名乗る時計がある最初の場面で1回。
            //      時計だけ残り3.4秒にした部屋の知らせを流し、「3」が出ている最中に撮る（そのあと元の知らせにもどす）
            //   どちらも 1280×720 だけ。**出ている最中に数える**（.fx-countdown／.big-cd の数。片付いたあとに数えない・落とし穴10-g）
            if (FX) {
              rec.演出の画像 = rec.演出の画像 || {};
              const 時計 = f.snap && f.snap.state && f.snap.state.data && f.snap.state.data.clock;
              const 三二一 = !fx.三二一 && !/^lobby|^ended/.test(f.label);
              const 大きな数 = !fx.大きな数 && 時計 && 時計.kind === 'play';
              if (三二一 || 大きな数) await 大きさを変える(dev, 1280, 720);
              if (三二一) {
                fx.三二一 = true;
                await dev.ev('(function(){ window.__rtFake.fire("room:countdown", {seconds:3}); return true; })()');
                await sleep(450);
                const file = 名 + '_' + n + '_1280_演出321.jpg';
                await dev.shot(path.join(OUT, file));
                rec.演出の画像['3-2-1'] = { 画像: file, 出ていた: await dev.ev("document.querySelectorAll('.fx-countdown').length") };
                try { await dev.until("!document.querySelector('.fx-countdown')", 6000, '3-2-1 が片付く'); } catch (e) {}
              }
              if (大きな数) {
                fx.大きな数 = true;
                const c = JSON.parse(JSON.stringify(f.snap)); c.state.data.clock.ms = 3400;
                await dev.ev('(function(){ window.__rtFake.fire("room:update", ' + JSON.stringify(c) + '); return true; })()');
                await sleep(700);
                const file = 名 + '_' + n + '_1280_演出カウントダウン.jpg';
                await dev.shot(path.join(OUT, file));
                rec.演出の画像['巨大カウントダウン'] = { 画像: file, 出ていた: await dev.ev("document.querySelectorAll('.big-cd').length") };
                await 流す(dev, f.snap);
                try { await dev.until("!document.querySelector('.big-cd')", 3000, 'カウントダウンが片付く'); } catch (e) {}
              }
              const 撮った = Object.keys(rec.演出の画像).map((k) => k + (rec.演出の画像[k].出ていた ? '○' : '✖出ていない')).join(' ');
              if (撮った) console.log('    演出の画像：' + 撮った);
            }
            例外を拾う(名 + ' ' + n + '人');
            rec.例外 = 記録.ページの例外.filter((x) => x.どこ === 名 + ' ' + n + '人').map((x) => x.msg);
            記録.場面.push(rec);
            const 行 = SIZES.map(([w, h]) => {
              const m = rec.測り[w + 'x' + h];
              const 悪い = m.画面 !== 'scr-rt-big' || m.ページの巻き > 0 || m.箱の巻き.length || m.切れの数 || m.小さいの数 || m.読めないの数;
              return (悪い ? '✖' : '○') + w + ' 巻き' + m.ページの巻き + ' 箱' + m.箱の巻き.length + ' 切れ' + m.切れの数 + ' 小' + m.小さいの数 + (m.読めないの数 ? ' 読めない' + m.読めないの数 : '') + (m.演出で除いた ? ' 演除' + m.演出で除いた : '') +
                (m.省略の数 ? ' …' + m.省略の数 : '') + (m.薄めの数 ? ' 薄' + m.薄めの数 : '') +
                (m.画面 !== 'scr-rt-big' ? ' 画面=' + m.画面 : '');
            }).join(' ｜ ');
            // --probe：調べもの用。測り終わったページで式を1つ評価して出す（例：名前の幅・舞台の高さ・列の数）
            if (PROBE) { try { console.log('    probe ' + JSON.stringify(await dev.ev(PROBE))); } catch (e) { console.log('    probe ✖ ' + e.message); } }
            // 落ち着かなかった時は、なぜかを並べる（走っていた動きの名前・残った重なり・最後の書き換えから何ms）
            const 並べる = (x) => Array.isArray(x) ? x.join(' / ') : String(x || '');
            const 理由 = 待ち.落ち着いた ? '' : [並べる(待ち.残った演出) && '演出 ' + 並べる(待ち.残った演出), 並べる(待ち.走っていた) && '走る ' + 並べる(待ち.走っていた),
              待ち.なぜ && typeof 待ち.なぜ === 'object' ? '書き換えから ' + 待ち.なぜ.書き換えから + 'ms' + (待ち.なぜ.測り直し待ち ? '・測り直し待ち' : '') + (待ち.なぜ.字の形 ? '' : '・字の形待ち') : ''].filter(Boolean).join('・');
            console.log('  ' + 幅をそろえる(名, 34) + 幅をそろえる(n + '人', 5) + 行 + (rec.例外.length ? ' ⚠例外' + rec.例外.length : '') + (待ち.落ち着いた ? '' : ' (落ち着かず' + (理由 ? '：' + 理由 : '') + ')') + (待ち.式の失敗 ? ' ⚠落ち着きの式の失敗' + 待ち.式の失敗 : ''));
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
        if (m.読めないの数) 理由.push('読めない名前');
        if (理由.length) 悪い数++;
        console.log(幅をそろえる(rec.場面, 36) + 幅をそろえる(rec.人数, 6) + 幅をそろえる(w + 'x' + h, 11) + 幅をそろえる(m.ページの巻き, 15) +
          幅をそろえる(m.箱の巻き.length ? m.箱の巻き.map((x) => x.中身 - x.見える高さ).join('/') : 0, 10) + 幅をそろえる(m.切れの数, 6) +
          幅をそろえる(m.小さいの数, 10) + 幅をそろえる(m.演出で除いた, 14) + (理由.length ? '✖ ' + 理由.join('・') : '○'));
      }
    }
    console.log('✖ ' + 悪い数 + ' / ' + 記録.場面.length * SIZES.length);
    // 名前の省略（…）は切れに数えない（箱の中で自分で省略している）。読めない名前がどれだけあるかを別に出す
    let 省略の場面 = 0, 省略の計 = 0;
    for (const rec of 記録.場面) for (const [w, h] of SIZES) { const m = rec.測り[w + 'x' + h]; if (m && m.省略の数) { 省略の場面++; 省略の計 += m.省略の数; } }
    console.log('名前の省略（…）：' + 省略の場面 + ' / ' + 記録.場面.length * SIZES.length + ' の測りで、のべ ' + 省略の計 + ' 個（切れには数えない）');
    // 何字まで縮んだか（見えている字の数ごと）。「たかは…」と「た…」を同じ1件に数えない
    const 字の分布 = {}, 縮みすぎ = {};
    for (const rec of 記録.場面) for (const [w, h] of SIZES) {
      const m = rec.測り[w + 'x' + h];
      (m && m.省略 || []).forEach((x) => {
        if (typeof x !== 'object') return;
        字の分布[x.見] = (字の分布[x.見] || 0) + 1;
        if (x.見 < 3) (縮みすぎ[rec.場面 + ' ' + rec.人数 + '人'] = 縮みすぎ[rec.場面 + ' ' + rec.人数 + '人'] || new Set()).add(w + ':' + x.名 + '→' + x.見 + '字');
      });
    }
    console.log('  見えている字の数：' + Object.keys(字の分布).sort((a, b) => a - b).map((k) => k + '字 ' + 字の分布[k]).join('・'));
    Object.keys(縮みすぎ).forEach((k) => console.log('  3字未満 ' + k + '：' + Array.from(縮みすぎ[k]).slice(0, 8).join(' ')));
    // opacity で薄めた字（§11-9）。演出の最中の字は除いてある
    const 薄めた = {};
    for (const rec of 記録.場面) for (const [w, h] of SIZES) { const m = rec.測り[w + 'x' + h]; (m && m.薄め || []).forEach((x) => { (薄めた[x.何 + ' ' + x.opacity] = 薄めた[x.何 + ' ' + x.opacity] || []).push(rec.場面); }); }
    console.log('opacity で薄めた字：' + (Object.keys(薄めた).length ? '' : 'なし'));
    Object.keys(薄めた).forEach((k) => console.log('  ' + k + ' → ' + Array.from(new Set(薄めた[k])).slice(0, 6).join('、') + (薄めた[k].length > 6 ? ' …' : '')));
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
