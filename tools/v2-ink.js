#!/usr/bin/env node
// tools/v2-ink.js — 箱の中の字が「描かれている所で」まん中にあるかを、画素で測る（指示66-1「字の高さ」「ルールの番号」）
//
//   node tools/v2-ink.js            … アプリ（見本データ）と見本の両方で、同じ部品の字のずれを並べる
//   --port 3967 --cdp 9667
//
// **CSS の数字ではなく、写真の画素で測る。**M PLUS 1 は字の箱の中で少し下に、League Spartan の数字は少し上に
// 描かれる——箱の寸法をいくら見ても分からない（どちらも箱としてはまん中にいる）。
// 測り方：部品の箱の中（縁と角の丸みを避けて内側）を3倍の解像度で撮り、
// 地の色（箱の角の内側の色）と字の色（その部品の color）の中間より字の側にある画素を「描かれている所」とする。
// その外形の中心と、箱の中心の差を出す（プラス＝下／右）。
// 先に物差しを確かめる：わざと字を 4px 下げた箱で、+4 前後と言うか（落とし穴10-f・28）。

const fs = require('fs');
const path = require('path');
const { launch, sleep } = require('./cdp');
const { 配り手, 開く } = require('./v2-lab/open');
const { SCENES } = require('./v2-lab/scenes');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : argv[i + 1]; };
const PORT = +arg('port', 3967), CDP = +arg('cdp', 9667), K = 3;
const MOCK = path.join(__dirname, '..', 'docs', '指示66', '見本', 'festival.html');

/**
 * 測る部品：アプリのセレクタ・見本のセレクタ・内側へ避ける量（px。[横, 縦] か1つの数）・横も測るか。
 * **横は角の丸みより内側まで避ける**——角の丸い縁の画素が「描かれている所」に入ると、
 * 外形が下へ伸びる（最初の版で踏んだ：着替えのボタンが +4.8px と出た。目で見るとまん中だった）
 */
const PARTS = [
  { 何: 'YOU の札', app: '.v2-me .v2-you', mock: '[data-id="f3"] .me .you', inset: [8, 2] },
  { 何: '5秒以下の赤い札（4）', app: '.v2-band .v2-cd-n', mock: null, inset: [10, 2], state: 'lo' },
  { 何: 'ルールの番号 1', app: '[data-v2-id="v2Rules-bomb-coop"] .v2-rb:nth-child(1) .v2-rb-k', mock: '[data-id="rules3"] .rb:nth-child(1) .k', inset: 6, x: true, state: 'rules' },
  { 何: 'ルールの番号 2', app: '[data-v2-id="v2Rules-bomb-coop"] .v2-rb:nth-child(2) .v2-rb-k', mock: '[data-id="rules3"] .rb:nth-child(2) .k', inset: 6, x: true, state: 'rules' },
  { 何: 'ルールの番号 3', app: '[data-v2-id="v2Rules-bomb-coop"] .v2-rb:nth-child(3) .v2-rb-k', mock: '[data-id="rules3"] .rb:nth-child(3) .k', inset: 6, x: true, state: 'rules' },
  { 何: 'シートの「とじる」', app: '[data-v2-id="v2Rules-bomb-coop"] .v2-sfoot .v2-btn', mock: '[data-id="rules3"] .sfoot .btn', inset: [18, 5], state: 'rules' },
  { 何: '着替えのボタン', app: '#scr-v2-fes-lobby .v2-in > .v2-btn.is-lite', mock: '[data-id="f3"] .btn.lite', inset: [18, 5] }
];

/** ページの中：その要素の内側を撮った画像から、描かれている所の外形を出す */
const 外形 = `async function(sel, inset, k, shot){
  var ix = Array.isArray(inset) ? inset[0] : inset, iy = Array.isArray(inset) ? inset[1] : inset;
  var e = document.querySelector(sel); if(!e) return null;
  var r = e.getBoundingClientRect(), cs = getComputedStyle(e);
  function rgb(s){ var m = s.match(/[\\d.]+/g); return m ? m.slice(0,3).map(Number) : [0,0,0]; }
  function L(c){ return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2]; }
  var im = new Image(); im.src = shot; await im.decode();
  var c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
  var g = c.getContext('2d'); g.drawImage(im, 0, 0);
  var W = im.width, H = im.height, d = g.getImageData(0, 0, W, H).data;
  var px = function(x, y){ var i = (y*W + x)*4; return [d[i], d[i+1], d[i+2]]; };
  var bg = L(px(Math.round(ix*k), Math.round(iy*k)));
  var ink = L(rgb(cs.color));
  var mid = (bg + ink) / 2, inkSide = ink > bg;
  var x0 = Math.round(ix*k), y0 = Math.round(iy*k), x1 = W - x0, y1 = H - y0;
  var top = -1, bot = -1, left = 1e9, right = -1;
  for(var y = y0; y < y1; y++) for(var x = x0; x < x1; x++){
    var v = L(px(x, y));
    if(inkSide ? v > mid : v < mid){ if(top < 0) top = y; bot = y; if(x < left) left = x; if(x > right) right = x; }
  }
  if(top < 0) return { 無い: true };
  return { dy: +(((top + bot + 1)/2 - H/2) / k).toFixed(2), dx: +(((left + right + 1)/2 - W/2) / k).toFixed(2),
           h: +(r.height).toFixed(1), fs: parseFloat(cs.fontSize) };
}`;

async function 測る(dev, sel, inset) {
  const r = await dev.ev(`(function(){ var e=document.querySelector(${JSON.stringify(sel)}); if(!e) return null; e.scrollIntoView({block:'center'}); var b=e.getBoundingClientRect(); return {x:b.left+scrollX,y:b.top+scrollY,w:b.width,h:b.height}; })()`);
  if (!r) return null;
  await sleep(150);
  const res = await dev.raw('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: r.x, y: r.y, width: r.w, height: r.h, scale: K } });
  return dev.ev(`(${外形})(${JSON.stringify(sel)}, ${JSON.stringify(inset)}, ${K}, 'data:image/png;base64,${res.data}')`);
}

(async () => {
  const server = await 配り手(PORT);
  const br = await launch({ port: CDP });
  const lobby = SCENES.find((s) => s.id === 'fes-lobby');
  const 表 = [];
  try {
    const dev = await br.newDevice('ink', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    // ---- 物差しの自己検査：字を 4px 下げた箱 ----
    await 開く(dev, PORT, lobby, { freeze: 23 });
    await dev.ev(`(function(){ var b=document.createElement('div'); b.id='inkTest'; b.style.cssText='position:absolute;left:20px;top:300px;width:120px;height:60px;background:#000;color:#fff;display:flex;align-items:center;justify-content:center;font:900 20px sans-serif;z-index:99';
      b.innerHTML='<span style="position:relative;top:4px">HHH</span>'; document.getElementById('scr-v2-fes-lobby').appendChild(b); return 1; })()`);
    const t = await 測る(dev, '#inkTest', 4);
    await dev.ev("document.getElementById('inkTest').remove()");
    const 効く = t && Math.abs(t.dy - 4) <= 1;
    console.log((効く ? '✔' : '✖') + ' 物差し：字を4px下げた箱を ' + (t && t.dy) + 'px と測った');
    if (!効く) throw new Error('物差しが効いていません');

    const 状態 = { base: { freeze: 23 }, lo: { freeze: 4 }, rules: { freeze: 23, open: 'v2Rules-bomb-coop' } };
    for (const p of PARTS) {
      await 開く(dev, PORT, lobby, 状態[p.state || 'base']);
      const a = await 測る(dev, p.app, p.inset);
      表.push({ 何: p.何, アプリ: a });
    }
    await dev.close();
    // ---- 見本の同じ部品 ----
    const mk = await br.newDevice('mock', { width: 2100, height: 1300, deviceScaleFactor: 1 });
    await mk.go('file:///' + MOCK.replace(/\\/g, '/'));
    await mk.until("window.DS && document.fonts.status==='loaded'", 20000, '見本');
    await mk.ev("(function(){ var b=document.querySelector('[data-fxset=\"none\"]'); if(b) b.click(); document.documentElement.classList.add('native'); document.querySelectorAll('.frame').forEach(DS.fit); return 1; })()");
    await mk.ev("(function(){ var s=document.querySelector('[data-id=\"f3\"]'); s.scrollIntoView(); return 1; })()");
    await sleep(1300);
    await mk.ev("(function(){ var s=document.querySelector('[data-id=\"f3\"]'); DS.open(s,'#rules3'); return 1; })()");
    await sleep(700);
    for (const row of 表) {
      const p = PARTS.find((x) => x.何 === row.何);
      row.見本 = p.mock ? await 測る(mk, p.mock, p.inset) : null;
    }
    await mk.close();
  } finally {
    await br.close(); server.close();
  }
  console.log('部品'.padEnd(16) + '  見本（縦／横）      アプリ（縦／横）   ※プラス＝下・右。単位 px');
  const f = (m, x) => (m ? (m.無い ? '字が無い' : (m.dy >= 0 ? '+' : '') + m.dy + (x ? ' / ' + (m.dx >= 0 ? '+' : '') + m.dx : '')) : '—');
  let 悪い = 0;
  表.forEach((r) => {
    const p = PARTS.find((x) => x.何 === r.何);
    const ok = r.アプリ && !r.アプリ.無い && Math.abs(r.アプリ.dy) <= 1 && (!p.x || Math.abs(r.アプリ.dx) <= 1);
    if (!ok) 悪い++;
    console.log((ok ? '✔ ' : '✖ ') + r.何.padEnd(14) + '  ' + f(r.見本, p.x).padEnd(18) + '  ' + f(r.アプリ, p.x));
  });
  console.log(悪い ? '✖ ' + 悪い + ' つが 1px を超えてずれている' : '✔ どれも描かれている所が箱のまん中（±1px）');
  process.exitCode = 悪い ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(2); });
