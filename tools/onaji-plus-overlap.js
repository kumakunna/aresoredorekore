#!/usr/bin/env node
// tools/onaji-plus-overlap.js — みんなと同じの TV（16人）で、名前の札の「+1点！」がほかの札に重なっていないかを測る（指示71 追記2l）
//
//   node tools/onaji-plus-overlap.js [--only onaji-tv-film-unveil16,onaji-tv-film-unveil16-longq] [--port 3974] [--cdp 9774]
//
// 「+1点！」は動きの途中（札が開いたあと 0.3〜1.4秒）にしか出ないので、止めた写真（v2-shot）では測れない。
// tools/v2-film.js と同じ「止めた時計」で 0.05秒ごとに時刻を合わせ、見えている「+1点！」の四角が、自分の札ではないほかの札の四角に
// 何 px 重なるかを数える。重なりが1か所でもあれば赤（終了コード1）。
// 重ならなくても、上の段の札とのすき間が 8px（1920 の大きさで）より狭ければ赤：直す前は 1.4px で、書体や絵文字の描き方が少しちがう端末では
// 重なっていた（11/4 の検査レポート：「2段目の『+1点！』が1段目の名前の札に半分かくれる」）。サーバーも bot も要らない（tools/v2-lab の見本）
'use strict';
const { launch } = require('./cdp');
const { 配り手, 開く } = require('./v2-lab/open');
const { SCENES } = require('./v2-lab/scenes');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : argv[i + 1]; };
const ONLY = String(arg('only', 'onaji-tv-film-unveil16,onaji-tv-film-unveil16-longq')).split(',');
const PORT = +arg('port', 3974), CDP = +arg('cdp', 9774);
const [W, H] = String(arg('size', '1920x1080')).split('x').map(Number);   // TV の PC の窓（1280x720 など）

const 測る = `(function(t){
  document.getAnimations().forEach(function(a){ a.pause(); a.currentTime = t; });
  var tags = [].slice.call(document.querySelectorAll('.screen.active .v2-otag')), out = [], gap = 1e9;
  var k = (document.querySelector('.screen.active .v2-otags') || document.body).getBoundingClientRect().width / ((document.querySelector('.screen.active .v2-otags') || document.body).offsetWidth || 1);
  tags.forEach(function(tag, i){
    var p = tag.querySelector('.v2-oplus'); if(!p || +getComputedStyle(p).opacity < 0.1) return;
    var a = p.getBoundingClientRect();
    tags.forEach(function(o, j){
      if(j === i) return;
      var b = o.getBoundingClientRect();
      var w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if(w > 1 && h > 1) out.push({ plus: i, tag: j, w: Math.round(w), h: Math.round(h) });
      else if(w > 1 && b.bottom <= a.top + 1) gap = Math.min(gap, a.top - b.bottom);   // 上の段の札とのすき間
    });
  });
  return { tags: tags.length, hits: out, gap: gap / (k || 1) };
})`;

(async () => {
  const server = await 配り手(PORT);
  const br = await launch({ port: CDP });
  let bad = 0;
  try {
    for (const id of ONLY) {
      const scene = SCENES.find((s) => s.id === id);
      if (!scene) throw new Error('場面がありません：' + id);
      const dev = await br.newDevice('plus-' + id, { width: W, height: H, mobile: false, deviceScaleFactor: 0.5 });
      await 開く(dev, PORT, scene, { fx: 'normal', freeze: 23, long: arg('long', '') === '1' });
      await dev.ev(`(function(){ var s=document.getElementById(${JSON.stringify(scene.screen)}); s.classList.remove('is-play'); void s.offsetWidth; s.classList.add('is-play'); return 1; })()`);
      let worst = null, n = 0, tags = 0, gap = 1e9;
      for (let t = 2800; t <= 5200; t += 50) {
        await dev.ev('new Promise(function(r){ requestAnimationFrame(function(){ r(1); }); })');
        const r = await dev.ev(測る + '(' + t + ')');
        tags = r.tags; gap = Math.min(gap, r.gap);
        r.hits.forEach((h) => { n++; if (!worst || h.h > worst.h) worst = Object.assign({ t }, h); });
      }
      const ng = n > 0 || gap < 8;
      if (ng) bad++;
      console.log((ng ? '✖ ' : '✔ ') + id + '：札 ' + tags + '枚・重なり ' + n + ' コマ×か所・上の段の札とのすき間の最小 ' + (gap < 1e8 ? gap.toFixed(1) + 'px（1920 の大きさで）' : 'なし') + (worst ? '（いちばん深い：' + JSON.stringify(worst) + '）' : ''));
      await dev.close();
    }
  } finally {
    await br.close(); server.close();
  }
  process.exit(bad ? 1 : 0);
})();
