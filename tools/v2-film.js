#!/usr/bin/env node
// tools/v2-film.js — 見せ場の動画（GIF）を撮る（指示68 の「棚に出す門」5・68-4 門7）
//
//   node tools/v2-film.js --only pt-tv-film-perfect,so-tv-film-space   … 場面（tools/v2-lab の見本）を撮る
//   --sec 6（何秒ぶん）  --fps 10（0.1秒ごと）  --scale 0.5（1920×1080 を 960×540 の GIF に）  --out DIR
//   --keep … コマの PNG も残す（既定は GIF だけ）
//   node tools/v2-film.js --only bomb-film-clear,bomb-film-boom    … JS の時計で進む見せ場（クイズ解除の終わりの幕）は「本当の時計」で撮る
//
// **ffmpeg が無いので、0.1秒ごとのコマから GIF を作る**（tools/gif-lite.js）。
// コマは「止めた時計」で撮る：ページの動き（document.getAnimations）を全部止めて、0秒・0.1秒・0.2秒…と時刻を合わせてから写す。
// 写真を撮るのに時間がかかっても、コマの間はいつも同じ（動きが速く飛ばない・遅れない）。
// CSS の動きだけが写る（音・JS の時計は写らない）。演出は「ふつう」、大きさは TV 1920×1080。
// **JS の時計で幕を進める見せ場**（FxKit.finale：ため → 開く → 字 を setTimeout で進める）は、止めた時計では写らないので、
// REAL の台本どおりに「本当の時計」で撮る：Chrome の画面の送り（Page.startScreencast・PNG）を受けて、0.1秒ごとに並べ直す。
// サーバーも bot も要らない（tools/v2-lab の見本データ・tools/v2-shot.js と同じ開き方）。検証の Chrome は音を消してある。
'use strict';
const fs = require('fs');
const path = require('path');
const { launch, sleep } = require('./cdp');
const { 配り手, 開く, ROOT } = require('./v2-lab/open');
const { SCENES } = require('./v2-lab/scenes');
const { decodePng, encodeGif } = require('./gif-lite');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const ONLY = String(arg('only', '')).split(',').filter(Boolean);
const SEC = +arg('sec', 6), FPS = +arg('fps', 10), SCALE = +arg('scale', 0.5), KEEP = !!arg('keep', false);
const OUT = path.resolve(arg('out', path.join(ROOT, 'docs', '監査_指示66の画像', 'film')));
const PORT = +arg('port', 3972), CDP = +arg('cdp', 9672);
/** 本当の時計で撮る見せ場：どの場面を開いて、何を呼ぶか（ページの中の式） */
const REAL = {
  // クイズ解除（協力版）の終わりの幕（TV）。名前は見本の6人。window.bombFinaleProbe は tests/bomb-finale.js と同じ窓
  'bomb-film-clear': { scene: 'fes2-tv-result', call: "window.bombFinaleProbe({ success: true, tv: true, names: ['ふう', 'ひろ', 'びび', 'ちか', 'でん', 'えみ'], left: 0 })" },
  'bomb-film-boom': { scene: 'fes2-tv-boom', call: "window.bombFinaleProbe({ success: false, tv: true, left: 3, cause: 'lives' })" }
};

/** 本当の時計で撮る：画面の送りを受けて、0.1秒ごとのコマに並べ直す（足りない所は前のコマをくり返す） */
async function 本当の時計で(br, id, real) {
  const scene = SCENES.find((s) => s.id === real.scene);
  if (!scene) throw new Error('場面がありません：' + real.scene);
  const dev = await br.newDevice('film-' + id, { width: 1920, height: 1080, mobile: false, deviceScaleFactor: SCALE });
  await 開く(dev, PORT, scene, { fx: 'normal', freeze: 23 });
  const got = [];
  const off = dev.onEvent((m) => {
    if (m.method !== 'Page.screencastFrame') return;
    got.push({ t: m.params.metadata.timestamp * 1000, data: m.params.data });
    dev.raw('Page.screencastFrameAck', { sessionId: m.params.sessionId }).catch(() => {});
  });
  await dev.raw('Page.startScreencast', { format: 'png', maxWidth: Math.round(1920 * SCALE), maxHeight: Math.round(1080 * SCALE), everyNthFrame: 1 });
  await sleep(300);
  const t0 = Date.now();
  await dev.ev('(function(){ ' + real.call + '; return 1; })()');
  await sleep(SEC * 1000 + 300);
  await dev.raw('Page.stopScreencast');
  off();
  if (!got.length) throw new Error(id + '：画面の送りが届きませんでした');
  // 呼んだ時刻（ページの外の時計）に近いコマを 0秒 とする
  const start = got.reduce((b, f) => (Math.abs(f.t - t0) < Math.abs(b.t - t0) ? f : b), got[0]).t;
  const frames = [];
  for (let i = 0; i <= Math.round(SEC * FPS); i++) {
    const want = start + i * 1000 / FPS;
    let pick = got[0];
    for (const f of got) { if (f.t <= want) pick = f; else break; }
    const png = Buffer.from(pick.data, 'base64');
    if (KEEP) fs.writeFileSync(path.join(OUT, id + '_' + String(i).padStart(3, '0') + '.png'), png);
    frames.push(decodePng(png));
  }
  const gif = encodeGif(frames, Math.round(100 / FPS));
  const out = path.join(OUT, id + '.gif');
  fs.writeFileSync(out, gif);
  console.log('✔ ' + id + '（本当の時計・送られたコマ ' + got.length + '枚）：' + frames.length + 'コマ → ' + path.relative(ROOT, out) + '（' + Math.round(gif.length / 1024) + 'KB）');
  await dev.close();
  return { 場面: id, コマ: frames.length, 送られたコマ: got.length, 秒: SEC, KB: Math.round(gif.length / 1024), 撮り方: '本当の時計' };
}

(async () => {
  if (!ONLY.length) { console.error('--only で場面を選んでください（例：--only so-tv-film-space）'); process.exit(2); }
  fs.mkdirSync(OUT, { recursive: true });
  const server = await 配り手(PORT);
  const br = await launch({ port: CDP });
  const 記録 = [];
  try {
    for (const id of ONLY) {
      if (REAL[id]) { 記録.push(await 本当の時計で(br, id, REAL[id])); continue; }
      const scene = SCENES.find((s) => s.id === id);
      if (!scene) throw new Error('場面がありません：' + id);
      const size = scene.kind === 'tv' ? { width: 1920, height: 1080, mobile: false } : { width: 390, height: 844, mobile: true };
      const dev = await br.newDevice('film-' + id, Object.assign({ deviceScaleFactor: SCALE }, size));
      await 開く(dev, PORT, scene, { fx: 'normal', freeze: 23 });
      // 動きを頭から：is-play を付け直してから、全部の動きを止めて 0 秒に
      await dev.ev(`(function(){ var s=document.getElementById(${JSON.stringify(scene.screen)}); s.classList.remove('is-play'); void s.offsetWidth; s.classList.add('is-play');
        document.getAnimations().forEach(function(a){ a.pause(); a.currentTime = 0; }); return document.getAnimations().length; })()`);
      const frames = [], n = Math.round(SEC * FPS) + 1;
      for (let i = 0; i < n; i++) {
        const t = Math.round(i * 1000 / FPS);
        await dev.ev(`(function(){ document.getAnimations().forEach(function(a){ a.pause(); a.currentTime = ${t}; }); return 1; })()`);
        await dev.ev('new Promise(function(r){ requestAnimationFrame(function(){ requestAnimationFrame(function(){ r(1); }); }); })');
        const file = path.join(OUT, id + '_' + String(i).padStart(3, '0') + '.png');
        await dev.shot(file);
        frames.push(decodePng(fs.readFileSync(file)));
        if (!KEEP) fs.unlinkSync(file);
      }
      const gif = encodeGif(frames, Math.round(100 / FPS));
      const out = path.join(OUT, id + '.gif');
      fs.writeFileSync(out, gif);
      記録.push({ 場面: id, コマ: frames.length, 秒: SEC, 大きさ: frames[0].w + '×' + frames[0].h, KB: Math.round(gif.length / 1024) });
      console.log('✔ ' + id + '：' + frames.length + 'コマ（' + SEC + '秒・' + frames[0].w + '×' + frames[0].h + '）→ ' + path.relative(ROOT, out) + '（' + Math.round(gif.length / 1024) + 'KB）');
      await dev.close();
    }
  } catch (e) {
    console.error('✖ ' + (e && e.stack || e));
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(path.join(OUT, '記録.json'), JSON.stringify(記録, null, 1));
    await br.close();
    if (server && server.close) server.close();
  }
})();
