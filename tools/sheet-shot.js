#!/usr/bin/env node
// tools/sheet-shot.js — 高さを決めていない（is-tall でない）シートを全部開いて、撮って測る（指示74 2）
//
//   node tools/sheet-shot.js --tag after                       … いまの public/ を撮る
//   直す前を撮る：この道具を直す前の作業ツリーへ写して、そこで動かす（/v2lab はその木の public/index.html を読む・tools/v2-lab/serve.js）
//     git worktree add --detach ../aresore-74base <直す前のコミット> && cp tools/sheet-shot.js ../aresore-74base/tools/
//     (cd ../aresore-74base && node tools/sheet-shot.js --tag before --out <このリポジトリ>/docs/指示74/写真/シート)
//   ※ --public は静的なファイルだけを差しかえる（/v2lab の index.html は変わらない）。前と後の比べには使わない
//   --out DIR（既定 docs/指示74/写真/シート）  --port 3974  --cdp 9674
//
// 11/6 の実機（Android）：待合の「ひとこと書く」のシートで、書く箱がつぶれて下の線しか見えなかった。
// `.v2 .v2-sbody{flex:1}`（flex-basis 0%）なので、高さを決めていないシートでは中身の箱が縮む。
// どのシートが「高さを決めていない」かは手で並べない（落とし穴4）：場面を開いて、`.v2-sheet:not(.is-tall)` を全部拾う。
//
// 測る物（シートごと）：
//   squashed … 中の部品が、見えている所（.v2-sbody）からはみ出しているのに、シートが 90% まで伸びていない＝押しつぶされている
//   textarea … 書く箱の見えている高さ（.v2-sbody の中で見えている分）
// ひとことのシートは、キーボードが出た時の高さ（360×400）でも撮って、書く箱と「送る」が画面の中に見えるかを測る。
// サーバーも bot も要らない（tools/v2-lab/open.js の配り手と見本データ）。写真は git に入れない（docs/指示74/写真/）。

const fs = require('fs');
const path = require('path');
const { launch } = require('./cdp');
const { 配り手, 開く } = require('./v2-lab/open');
const { SCENES } = require('./v2-lab/scenes');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const TAG = arg('tag', 'after');
const PUBLIC = arg('public', null) ? path.resolve(arg('public')) : null;
const OUT = path.resolve(arg('out', path.join(ROOT, 'docs', '指示74', '写真', 'シート')), String(TAG));
const PORT = +arg('port', 3974), CDP = +arg('cdp', 9674);

// シートを持っている場面（文化祭の待合・係・ふつうの入口と待合・ひとりで遊ぶ人数・部品の見本）
const SCENE_IDS = ['fes2-lobby', 'fes2-fb', 'fes2-staff', 'home-e2qr', 'home-e3', 'home-e4', 'pick-one-heads', 'parts'];
const SIZES = [{ w: 360, h: 740 }, { w: 390, h: 844 }];
const KEYBOARD = { w: 360, h: 400 };   // キーボードが出た時

const 測る = `(function(id){
  var scr = document.querySelector('.screen.active');
  var sh = scr.querySelector('.v2-sheet[data-v2-id="' + id + '"]');
  var body = sh && sh.querySelector('.v2-sbody');
  var box = scr.getBoundingClientRect(), r = sh.getBoundingClientRect(), b = body ? body.getBoundingClientRect() : null;
  var ta = sh.querySelector('textarea'), send = sh.querySelector('.v2-sfoot .v2-btn, .v2-sbody .v2-btn.is-pri');
  var tr = ta ? ta.getBoundingClientRect() : null, sr = send ? send.getBoundingClientRect() : null;
  var vis = function(x){ return x ? Math.max(0, Math.min(x.bottom, b ? b.bottom : x.bottom, innerHeight) - Math.max(x.top, b ? b.top : x.top, 0)) : null; };
  return {
    sheetH: Math.round(r.height), maxH: Math.round(box.height * 0.9),
    bodyH: body ? body.clientHeight : null, bodyScrollH: body ? body.scrollHeight : null,
    // 押しつぶされた＝中の部品（大きさのある要素）が、見えている所からはみ出しているのに、シートが 90% まで伸びていない。
    // scrollHeight だけで見ない：大きい字の行の箱は、要素の下へ数 px はみ出す（字は切れていない・直す前から同じ）
    squashed: !!(body && r.height < box.height * 0.9 - 2 && Array.prototype.some.call(body.querySelectorAll('*'), function(k){
      var q = k.getBoundingClientRect(); return q.width > 0 && q.height > 0 && (q.bottom > b.bottom + 1 || q.top < b.top - 1); })),
    overflowPx: body ? body.scrollHeight - body.clientHeight : null,
    textareaH: tr ? Math.round(tr.height) : null, textareaSeen: tr ? Math.round(vis(tr)) : null,
    sendSeen: sr ? (sr.top >= 0 && sr.bottom <= innerHeight + 0.5) : null
  };
})`;

(async function main() {
  const server = await 配り手(PORT, PUBLIC);
  const chrome = await launch({ port: CDP });
  const rows = [];
  try {
    for (const sid of SCENE_IDS) {
      const scene = SCENES.find((s) => s.id === sid);
      if (!scene) throw new Error('場面がありません: ' + sid);
      const sizes = SIZES.concat(sid === 'fes2-fb' ? [KEYBOARD] : []);
      for (const sz of sizes) {
        const dev = await chrome.newDevice(sid + '-' + sz.w + 'x' + sz.h, { width: sz.w, height: sz.h, mobile: true, deviceScaleFactor: 2 });
        await 開く(dev, PORT, scene, { freeze: 20 });
        // 場面が開いたシートは閉じてから、1枚ずつ開く
        await dev.ev("(function(){ document.querySelectorAll('.screen.active .v2-sheet.is-open').forEach(function(s){ V2.close(s); }); return 1; })()");
        await new Promise((r) => setTimeout(r, 400));
        const ids = await dev.ev("Array.prototype.map.call(document.querySelectorAll('.screen.active .v2-sheet:not(.is-tall)'), function(s){ return s.getAttribute('data-v2-id'); })");
        for (const id of (sz === KEYBOARD ? ids.filter((x) => x === 'v2FbText') : ids)) {
          await dev.ev(`(function(){ var l=document.querySelector('.screen.active [data-v2-id="${id}"]'); V2.open(l); return 1; })()`);
          await new Promise((r) => setTimeout(r, 700));
          const m = await dev.ev(測る + '(' + JSON.stringify(id) + ')');
          const file = path.join(OUT, sid + '_' + id + '_' + sz.w + 'x' + sz.h + '.png');
          await dev.shot(file);
          rows.push(Object.assign({ scene: sid, sheet: id, size: sz.w + 'x' + sz.h, file: path.relative(ROOT, file) }, m));
          await dev.ev(`(function(){ V2.close(document.querySelector('.screen.active [data-v2-id="${id}"]')); return 1; })()`);
          await new Promise((r) => setTimeout(r, 400));
        }
        if (dev.logs.length) rows.push({ scene: sid, size: sz.w + 'x' + sz.h, logs: dev.logs.slice() });
        await dev.close();
      }
    }
  } finally {
    await chrome.close(); server.close();
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, '記録.json'), JSON.stringify(rows, null, 1));
  const sheets = rows.filter((r) => r.sheet);
  const bad = sheets.filter((r) => r.squashed);
  const kb = sheets.filter((r) => r.size === KEYBOARD.w + 'x' + KEYBOARD.h);
  console.log('[' + TAG + '] 撮ったシート ' + sheets.length + ' 枚（' + Array.from(new Set(sheets.map((r) => r.sheet))).length + ' 種類）・押しつぶされた ' + bad.length + ' 枚');
  bad.forEach((r) => console.log('  つぶれ: ' + r.scene + ' ' + r.sheet + ' ' + r.size + ' 中身 ' + r.bodyH + '/' + r.bodyScrollH + 'px シート ' + r.sheetH + '/' + r.maxH + 'px'));
  sheets.filter((r) => r.textareaH != null).forEach((r) => console.log('  書く箱: ' + r.scene + ' ' + r.sheet + ' ' + r.size + ' 高さ ' + r.textareaH + 'px・見えている ' + r.textareaSeen + 'px・送るが画面の中 ' + r.sendSeen));
  rows.filter((r) => r.logs).forEach((r) => console.log('  ページの例外: ' + r.scene + ' ' + r.size + ' ' + r.logs.join(' / ')));
  if (!kb.length) console.log('  ※ キーボードの高さのひとことのシートを撮れていません');
  console.log('  写真と記録: ' + path.relative(ROOT, OUT));
  process.exitCode = bad.length || !kb.length ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(2); });
