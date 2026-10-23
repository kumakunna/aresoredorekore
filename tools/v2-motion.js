#!/usr/bin/env node
// tools/v2-motion.js — 演出「なし」で、新しい見た目の画面の動きが全部止まるか（指示66-1 門6）
//
//   node tools/v2-motion.js        … 待合（スマホ・TV）と部品の見本を、演出「ふつう」と「なし」で開いて比べる
//   --out DIR（既定 docs/監査_指示66の画像/motion）  --port 3968 --cdp 9668
//
// 見るもの（どちらも「ふつう」で動いていることを先に確かめる——動いていないものが止まっても証拠にならない・落とし穴10-h）：
//   ① 走っている動き：document.getAnimations() のうち、その画面の中で running のもの（名前・長さ・回数）
//   ② 時間ごとの画像：0秒・1.5秒・3秒の3枚。画素が1つも変わらないか（変わった画素の数を出す）
// のこり時間は数を止めて撮る（V2.freeze）——毎秒変わる数は「演出」ではなく「状況」なので、止めないと比べられない。
// **測る前に、ページの時計が進んでいるかを確かめる**（落とし穴28：裏に回った枠では、止まって見えても嘘）。

const fs = require('fs');
const path = require('path');
const { launch, sleep } = require('./cdp');
const { 配り手, 開く, ROOT } = require('./v2-lab/open');
const { SCENES } = require('./v2-lab/scenes');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : argv[i + 1]; };
const PORT = +arg('port', 3968), CDP = +arg('cdp', 9668);
const OUT = path.resolve(arg('out', path.join(ROOT, 'docs', '監査_指示66の画像', 'motion')));
const SIZE = { phone: { width: 390, height: 844, mobile: true }, tv: { width: 1920, height: 1080, mobile: false } };
const WHEN = [0, 1500, 3000];

/** その画面の中で走っている動き */
const 走る = (screen) => `(function(){
  var s = document.getElementById(${JSON.stringify(screen)});
  return document.getAnimations().filter(function(a){ var t = a.effect && a.effect.target; return a.playState === 'running' && t && s.contains(t); })
    .map(function(a){ var t = a.effect.target, tm = a.effect.getComputedTiming();
      return { 名: a.animationName || a.transitionProperty || '?', 長さ: Math.round(tm.duration), 回数: tm.iterations === Infinity ? '∞' : tm.iterations,
               何: (t.className && t.className.baseVal === undefined ? String(t.className) : t.tagName).slice(0, 40) }; });
})()`;

/** 2枚の画像（base64）で変わった画素の数 */
const 違う = `async function(a, b){
  async function px(src){ var im = new Image(); im.src = 'data:image/png;base64,' + src; await im.decode();
    var c = document.createElement('canvas'); c.width = im.width; c.height = im.height; var g = c.getContext('2d'); g.drawImage(im, 0, 0);
    return g.getImageData(0, 0, im.width, im.height).data; }
  var A = await px(a), B = await px(b), n = 0;
  for (var i = 0; i < A.length; i += 4) if (A[i] !== B[i] || A[i+1] !== B[i+1] || A[i+2] !== B[i+2]) n++;
  return n;
}`;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await 配り手(PORT);
  const br = await launch({ port: CDP });
  const 表 = [];
  let 悪い = 0;
  try {
    for (const scene of SCENES) {
      for (const fx of ['normal', 'skip']) {
        const dev = await br.newDevice(scene.id + fx, Object.assign({ deviceScaleFactor: 1 }, SIZE[scene.kind]));
        await 開く(dev, PORT, scene, { fx, freeze: 23, n: 6 });
        // 時計が進んでいるか（timeline と、試しの動き）
        const 時計 = await dev.ev(`new Promise(function(res){ var t0 = document.timeline.currentTime;
          var d = document.createElement('div'); d.style.cssText='position:fixed;left:-50px;top:0;width:10px;height:10px'; document.body.appendChild(d);
          var an = d.animate([{transform:'translateX(0)'},{transform:'translateX(10px)'}], {duration:1000});
          setTimeout(function(){ var r = { 進んだ: document.timeline.currentTime - t0, 試し: an.currentTime }; d.remove(); res(r); }, 300); })`);
        if (!(時計.進んだ > 200 && 時計.試し > 200)) throw new Error('ページの時計が進んでいません ' + JSON.stringify(時計));
        await sleep(1000);   // 出入りの動きが済むまで
        const 動き = await dev.ev(走る(scene.screen));
        const shots = [];
        let t0 = Date.now();
        for (const w of WHEN) {
          const wait = w - (Date.now() - t0); if (wait > 0) await sleep(wait);
          const r = await dev.raw('Page.captureScreenshot', { format: 'png' });
          shots.push(r.data);
          fs.writeFileSync(path.join(OUT, scene.id + '_' + fx + '_' + w + 'ms.png'), Buffer.from(r.data, 'base64'));
        }
        const 差 = [await dev.ev(`(${違う})(${JSON.stringify(shots[0])}, ${JSON.stringify(shots[1])})`),
          await dev.ev(`(${違う})(${JSON.stringify(shots[0])}, ${JSON.stringify(shots[2])})`)];
        // なし：止まっていること。ふつう：動いていること（止まって見えるのが、そもそも動かないからではないこと）
        const ok = fx === 'skip' ? (動き.length === 0 && 差[0] === 0 && 差[1] === 0) : (動き.length > 0 && 差[1] > 0);
        if (!ok) 悪い++;
        表.push({ 画面: scene.id, 演出: fx === 'skip' ? 'なし' : 'ふつう', 走っている動き: 動き, '変わった画素（1.5秒・3秒）': 差, ok });
        console.log((ok ? '✔ ' : '✖ ') + scene.id.padEnd(10) + (fx === 'skip' ? 'なし  ' : 'ふつう') +
          '  走っている動き ' + 動き.length + (動き.length ? '（' + 動き.map((a) => a.名 + ' ' + a.長さ + 'ms×' + a.回数).join('・') + '）' : '') +
          '  変わった画素 ' + 差.join(' / '));
        await dev.close();
      }
    }
  } finally {
    fs.writeFileSync(path.join(OUT, '記録.json'), JSON.stringify(表, null, 1));
    await br.close(); server.close();
  }
  console.log(悪い ? '✖ ' + 悪い + ' 件' : '✔ 演出「なし」で、新しい見た目の画面の動きは全部止まる（「ふつう」では動いている）。画像：' + path.relative(ROOT, OUT));
  process.exitCode = 悪い ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(2); });
