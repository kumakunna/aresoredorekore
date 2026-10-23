// tools/gen-v2-art.js — アイコンとゲームの印を「描かれている所が真ん中」になるように書き出す（指示66-1）
//
// 指示66-1「全部の画面の決まり：中心」：丸いボタンの中の絵・四角の中のアイコン・ゲームの印は、
// **描かれている所の中心**を入れ物の中心に合わせる。見本でずれていた原因は
// 「アイコンの箱（1em）と中の絵（20px）の大きさがちがう」だった——
// 箱と絵の大きさは CSS で同じにそろえ（v2 の .v2-ic）、絵の側の中心はここで合わせる。
//
// 手で1つずつ translate を足す形（見本は tv・mute・sparkle・hand の4つだけそうしていた）は採らない。
// 足した日に合わせ忘れるので、**全部を Chrome で測って、viewBox をずらす**。
// 測るのは getBBox（線の太さは数えない）——tools/../docs/指示66/tools/check.js の「中心がずれている」と同じ物差し。
//
//   node tools/gen-v2-art.js          … 測って public/js/v2-art.js を書き出す
//   node tools/gen-v2-art.js --check  … 書き出し済みのものが、もう一度測っても真ん中か（0.05 以内）だけ見る

const fs = require('fs');
const path = require('path');
const { launch } = require('./cdp');
const { ICONS, EMB } = require('./v2-art-src');

const OUT = path.join(__dirname, '..', 'public', 'js', 'v2-art.js');
const CHECK = process.argv.includes('--check');

function measureExpr(items) {
  // items: [{key, size, d}]。描いた所の四角（viewBox の座標）を返す
  return `(function(){
    var out={}, ns='http://www.w3.org/2000/svg';
    ${JSON.stringify(items)}.forEach(function(it){
      var svg=document.createElementNS(ns,'svg'); svg.setAttribute('viewBox', it.vb || ('0 0 '+it.size+' '+it.size));
      svg.setAttribute('width', it.size*4); svg.setAttribute('height', it.size*4);
      svg.innerHTML='<g>'+it.d.replace(/\\{\\{id\\}\\}/g,'m'+Math.random().toString(36).slice(2))+'</g>';
      document.body.appendChild(svg);
      var b=svg.firstChild.getBBox(); out[it.key]={x:b.x,y:b.y,w:b.width,h:b.height};
      svg.remove();
    });
    return out; })()`;
}

const r2 = (n) => Math.round(n * 100) / 100;

(async () => {
  const br = await launch({ port: 9474 });
  const dev = await br.newDevice('art', { width: 400, height: 400, deviceScaleFactor: 1 });
  await dev.go('about:blank');
  try {
    if (CHECK) {
      const ART = require(OUT);
      const items = Object.keys(ART.ICONS).map((k) => ({ key: 'i:' + k, size: 24, vb: ART.ICONS[k].vb, d: ART.ICONS[k].d }))
        .concat(Object.keys(ART.EMB).map((k) => ({ key: 'e:' + k, size: 120, vb: ART.EMB[k].vb, d: ART.EMB[k].d })));
      const m = await dev.ev(measureExpr(items));
      let bad = 0;
      for (const it of items) {
        const b = m[it.key], vb = it.vb.split(' ').map(Number);
        const dx = (b.x + b.w / 2) - (vb[0] + vb[2] / 2), dy = (b.y + b.h / 2) - (vb[1] + vb[3] / 2);
        if (Math.abs(dx) > 0.05 || Math.abs(dy) > 0.05) { bad++; console.log('ずれ', it.key, r2(dx), r2(dy)); }
      }
      console.log(bad ? '✖ ' + bad + ' 個が真ん中にない' : '✔ ' + items.length + ' 個とも描かれている所が真ん中');
      process.exitCode = bad ? 1 : 0;
      return;
    }
    const items = Object.keys(ICONS).map((k) => ({ key: 'i:' + k, size: 24, d: ICONS[k] }))
      .concat(Object.keys(EMB).map((k) => ({ key: 'e:' + k, size: 120, d: EMB[k]() })));
    const m = await dev.ev(measureExpr(items));
    const icons = {}, embs = {};
    const moved = [];
    for (const it of items) {
      const b = m[it.key];
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2, half = it.size / 2;
      const vb = [r2(cx - half), r2(cy - half), it.size, it.size].join(' ');
      if (Math.abs(cx - half) > 0.3 || Math.abs(cy - half) > 0.3) moved.push(it.key + '(' + r2(cx - half) + ',' + r2(cy - half) + ')');
      const k = it.key.slice(2);
      (it.key[0] === 'i' ? icons : embs)[k] = { vb: vb, d: it.d };
    }
    const src = [
      '/* v2-art.js — 新しい見た目（指示66）のアイコンとゲームの印。',
      ' * tools/gen-v2-art.js が tools/v2-art-src.js（見本の絵）を Chrome で測り、',
      ' * **描かれている所の中心が viewBox の中心に来るように** ずらして書き出したもの。手で直さない。',
      ' * 絵を足す・変える時は v2-art-src.js を直して、node tools/gen-v2-art.js を回す */',
      "(function (root, factory) {",
      "  if (typeof module === 'object' && module.exports) module.exports = factory();",
      '  else root.V2Art = factory();',
      "}(typeof self !== 'undefined' ? self : this, function () {",
      "  'use strict';",
      '  var ICONS = ' + JSON.stringify(icons) + ';',
      '  var EMB = ' + JSON.stringify(embs) + ';',
      '  var uid = 0;',
      '  /** アイコン（24×24・線は currentColor）。知らない名前は空 */',
      "  function icon(name) { var i = ICONS[name]; return i ? '<svg viewBox=\"' + i.vb + '\" aria-hidden=\"true\" focusable=\"false\">' + i.d + '</svg>' : ''; }",
      '  /** ゲームの印（世界の名前で引く）。clipPath の名前は描くたびに別にする */',
      "  function emblem(name) { var e = EMB[name]; if (!e) return ''; var id = 'v2e' + (++uid);",
      "    return '<svg viewBox=\"' + e.vb + '\" aria-hidden=\"true\" focusable=\"false\">' + e.d.replace(/\\{\\{id\\}\\}/g, id) + '</svg>'; }",
      '  return { ICONS: ICONS, EMB: EMB, icon: icon, emblem: emblem };',
      '}));',
      ''
    ].join('\n');
    fs.writeFileSync(OUT, src);
    console.log('書き出しました:', path.relative(process.cwd(), OUT), (src.length / 1024).toFixed(1) + 'KB',
      '・アイコン', Object.keys(icons).length, '・印', Object.keys(embs).length);
    console.log('中心を動かしたもの（0.3 を超えてずれていた）:', moved.length ? moved.join(' ') : 'なし');
  } finally {
    await dev.close(); await br.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
