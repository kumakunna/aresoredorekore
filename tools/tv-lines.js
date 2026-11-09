#!/usr/bin/env node
// tools/tv-lines.js — 見本データの場面で、字の要素が何行に折れているかを数える（指示76 3-1：投票・準備・結果の TV で「折れた文 0」）
//
//   node tools/tv-lines.js --scenes fes2-tv-vote-a,fes2-tv-ready-pittari --sel ".v2-vb,.v2-trule-t" [--out DIR]
//   --size 1920x1080（既定は場面の kind：TV 1920×1080・スマホ 390×844）
//
// 行は字ごとの箱の高さで分ける（Range を1字ずつ）。2行以上の要素を「折れた」として出す。--out があれば場面の写真も撮る
const path = require('path');
const { launch, sleep } = require('./cdp');
const { 配り手, 開く } = require('./v2-lab/open');
const { SCENES } = require('./v2-lab/scenes');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : argv[i + 1]; };
const LIST = String(arg('scenes', '')).split(',').filter(Boolean);
const SEL = String(arg('sel', '[data-v2-wrap]'));
const OUT = arg('out', null);
const SIZE = arg('size', null);

(async () => {
  const srv = await 配り手(3995); const b = await launch({ port: 9695 });
  let 折れ = 0;
  try {
    for (const id of LIST) {
      const sc = SCENES.find((s) => s.id === id);
      if (!sc) { console.log('✖ 場面が無い：' + id); 折れ++; continue; }
      const m = /^(\d+)x(\d+)$/.exec(SIZE || (sc.kind === 'tv' ? '1920x1080' : '390x844'));
      const tv = +m[1] >= 1000;
      const dev = await b.newDevice(id, { width: +m[1], height: +m[2], mobile: !tv, deviceScaleFactor: tv ? 1 : 2 });
      await 開く(dev, 3995, sc, { freeze: 20 });
      await dev.ev("(function(){ document.getAnimations().forEach(function(a){ try{ a.finish(); }catch(e){ a.pause(); } }); return 1; })()");
      await sleep(250);
      const rows = await dev.ev(`(function(sel){ return [].slice.call(document.querySelectorAll('.screen.active ' + sel.split(',').join(', .screen.active '))).filter(function(e){ return e.getClientRects().length; }).map(function(el){
        var tops = [], w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), n;
        while ((n = w.nextNode())) for (var i = 0; i < n.data.length; i++) { if (!n.data[i].trim()) continue; var rg = document.createRange(); rg.setStart(n, i); rg.setEnd(n, i + 1); var r = rg.getClientRects()[0]; if (!r || !r.width) continue;
          if (!tops.some(function(t){ return Math.abs(t - r.top) < r.height * 0.5; })) tops.push(r.top); }
        return { t: el.textContent.trim(), lines: tops.length, fs: getComputedStyle(el).fontSize };
      }); })(${JSON.stringify(SEL)})`);
      rows.forEach((x) => { if (x.lines > 1) 折れ++; });
      console.log(id + '：' + rows.map((x) => (x.lines > 1 ? '✖' : '✔') + x.lines + '行「' + x.t.slice(0, 30) + '」' + x.fs).join('　'));
      if (OUT) await dev.shot(path.join(path.resolve(OUT), id + '.png'));
      await dev.close();
    }
  } finally { await b.close(); srv.close(); }
  console.log(折れ ? '\n✖ 2行以上の要素 ' + 折れ : '\n✓ どれも1行');
  process.exit(折れ ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
