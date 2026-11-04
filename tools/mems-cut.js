#!/usr/bin/env node
// tools/mems-cut.js — ふだんの部屋の待合で、入った人の箱の下で途中で切れた札が無いか（指示71-5・68-0b B4）
//
//   node tools/mems-cut.js [--port 3980] [--cdp 9780]
//
// 6・10・13・16人 × 390×844・375×667 × 文字「ふつう」「大」（130）× 進行役（home-e3）・参加者（home-e4）で、見本データ（tools/v2-lab）を開き、
// 箱（.v2-mems-box）の見えている範囲と、札（.v2-mem）の四角をくらべる。札の一部だけが箱の外にあれば「切れた」。
// 全部入っていない（箱を送らないと見えない札がある）時も数える（16人まで全員が入る、が直し方の約束）。サーバーも bot も要らない
'use strict';
const { launch } = require('./cdp');
const { 配り手, 開く } = require('./v2-lab/open');
const { SCENES } = require('./v2-lab/scenes');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : argv[i + 1]; };
const PORT = +arg('port', 3980), CDP = +arg('cdp', 9780);

const 測る = `(function(){
  var box = document.querySelector('.screen.active .v2-mems-box'); if(!box) return { none: true };
  var b = box.getBoundingClientRect(), cut = 0, hidden = 0, all = 0;
  box.querySelectorAll('.v2-mem').forEach(function(m){
    all++;
    var r = m.getBoundingClientRect();
    if (m.offsetParent === null) return;   // 「ほか◯人」にまとめて隠した札（.is-clipped）は数えない
    var inside = r.top >= b.top - 0.5 && r.bottom <= b.bottom + 0.5;
    var outside = r.bottom <= b.top + 0.5 || r.top >= b.bottom - 0.5;
    if (!inside && !outside) cut++; else if (outside) hidden++;
  });
  return { all: all, cut: cut, hidden: hidden, boxH: Math.round(b.height), rowH: Math.round((box.querySelector('.v2-mem') || box).getBoundingClientRect().height) };
})()`;

(async () => {
  const server = await 配り手(PORT);
  const br = await launch({ port: CDP });
  let bad = 0;
  try {
    for (const id of ['home-e3', 'home-e4']) {
      const scene = SCENES.find((s) => s.id === id);
      if (!scene) throw new Error('場面がありません：' + id);
      for (const [w, h] of [[390, 844], [375, 667]]) {
        for (const font of [100, 130]) {
          const dev = await br.newDevice('mems', { width: w, height: h, mobile: true, deviceScaleFactor: 1 });
          const 行 = [];
          for (const n of [6, 10, 13, 16]) {
            await 開く(dev, PORT, scene, { n, freeze: 20, font, fx: 'skip' });
            const r = await dev.ev(測る);
            const ng = !r.none && (r.cut > 0 || r.hidden > 0);
            if (ng) bad++;
            行.push(n + '人 ' + (r.none ? '箱なし' : (ng ? '✖' : '○') + ' 札' + r.all + '・切れた' + r.cut + '・見えない' + r.hidden + '（箱' + r.boxH + '・札' + r.rowH + '）'));
          }
          console.log(id + ' ' + w + '×' + h + ' 文字' + font + '：' + 行.join(' ／ '));
          await dev.close();
        }
      }
    }
  } finally {
    await br.close(); server.close();
  }
  console.log(bad ? '✖ 切れた札・見えない札あり：' + bad + '件' : '✔ 箱の下で切れた札も、見えない札も無い');
  process.exit(bad ? 1 : 0);
})();
