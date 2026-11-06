#!/usr/bin/env node
// tools/name-box-shot.js — 名前の箱（.v2-inp）を Android の形で撮って測る（指示74 3）
//
//   node tools/name-box-shot.js --tag after
//   直す前：この道具を直す前の作業ツリーへ写して、そこで動かす（/v2lab はその木の public/index.html を読む）
//     (cd ../aresore-74base && node tools/name-box-shot.js --tag before --out <このリポジトリ>/docs/指示74/写真/名前の箱)
//
// 11/6 の実機（Samsung Internet）：名前を入れる時、入力の中に白い箱と緑っぽい枠が出て、字の上下が切れた。
// Chrome（tools/cdp.js）を Android の形（Galaxy S の 360×780・DPR 3・Samsung Internet の UA・タッチ）にして、
// 文化祭の入る画面（fes2-join-on）とふつうの入口の名前（home-e2b）の名前の箱を、さわる前／さわった時（focus）／自動入力の色、で撮る。
// 測る物：**描かれた字の画素**（落とし穴50）——入力の中に「ふうたろうgyj」を入れて、
// 字の上の端から下の端までの高さを、同じ入力に「字の行を詰めない（text-box:normal）」を当てたものと比べる（切れていれば低い）。ほかに、入力の箱の高さと行の高さ、
// focus の時の outline（外の決まりが中に効いていないか）、背景色と枠。textarea（ひとこと）も同じに見る。
// 11/6 の「字の上下が切れる」の本当の理由は、v2 の `.v2 *{text-box:trim-both cap alphabetic}` が入力にも効いていたこと（字の行が 13px ほどの帯に詰まる）
// 本物の Samsung Internet ではない（同じ形が出ない時もある）。出ない時も、どのブラウザでも同じになるように固めた CSS が効いているかを測る。

const fs = require('fs');
const path = require('path');
const { launch, sleep } = require('./cdp');
const { decodePng } = require('./gif-lite');
const { 配り手, 開く } = require('./v2-lab/open');
const { SCENES } = require('./v2-lab/scenes');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const TAG = arg('tag', 'after');
const OUT = path.resolve(arg('out', path.join(ROOT, 'docs', '指示74', '写真', '名前の箱')), String(TAG));
const PORT = +arg('port', 3977), CDP = +arg('cdp', 9677);
const UA = 'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36';
const CASES = [
  { scene: 'fes2-join-on', sel: '[data-fes-name]' },
  { scene: 'home-e2b', sel: '[data-home-name]' },
  { scene: 'fes2-fb', sel: '[data-v2-id="v2FbText"] textarea', open: 'v2FbText' }
];
const 測る = `(function(sel){
  var i = document.querySelector('.screen.active ' + sel); if (!i) return null;
  var box = i.closest('.v2-inp') || i, c = getComputedStyle(i), r = i.getBoundingClientRect(), br = box.getBoundingClientRect();
  var fs = parseFloat(c.fontSize), lh = c.lineHeight === 'normal' ? null : parseFloat(c.lineHeight);
  return { tag: i.tagName, h: Math.round(r.height * 10) / 10, boxH: Math.round(br.height), fontSize: fs, lineHeight: c.lineHeight,
    // 字の行が箱の中に入っているか：行の高さ（normal なら 字×1.5 と見る）と箱の高さの差を上下に分けた余白
    room: Math.round(((r.height - parseFloat(c.paddingTop) - parseFloat(c.paddingBottom)) - (lh || fs * 1.5)) / 2 * 10) / 10,
    outline: c.outlineStyle === 'none' || parseFloat(c.outlineWidth) === 0 ? 'なし' : c.outlineWidth + ' ' + c.outlineStyle + ' ' + c.outlineColor,
    bg: c.backgroundColor, border: c.borderTopWidth + ' ' + c.borderTopStyle, appearance: c.appearance || c.webkitAppearance,
    boxBorder: getComputedStyle(box).borderTopColor, focused: document.activeElement === i };
})`;

(async function main() {
  const server = await 配り手(PORT);
  const chrome = await launch({ port: CDP });
  const rows = [];
  try {
    for (const k of CASES) {
      const dev = await chrome.newDevice(k.scene, { width: 360, height: 780, mobile: true, deviceScaleFactor: 3 });
      await dev.cdp('Emulation.setUserAgentOverride', { userAgent: UA, platform: 'Linux armv8l' });
      await 開く(dev, PORT, SCENES.find((s) => s.id === k.scene), { freeze: 20, open: k.open });
      const 撮る = async (state) => {
        const m = await dev.ev(測る + '(' + JSON.stringify(k.sel) + ')');
        const clip = await dev.ev('(function(){ var i=document.querySelector(' + JSON.stringify('.screen.active ' + k.sel) + '); var b=(i.closest(".v2-inp")||i).getBoundingClientRect(); return {x:Math.max(0,b.left-8),y:Math.max(0,b.top-8),width:b.width+16,height:b.height+16}; })()');
        const r = await dev.cdp('Page.captureScreenshot', { format: 'png', clip: Object.assign({ scale: 2 }, clip) });
        const file = path.join(OUT, k.scene + '_' + state + '.png');
        fs.mkdirSync(OUT, { recursive: true });
        fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
        rows.push(Object.assign({ scene: k.scene, state, file: path.relative(ROOT, file) }, m));
      };
      // 描かれた字の高さ：同じ入力を、そのまま（subject）と「字の行を詰めない」をその場で当てたもの（見本）で撮り比べる。
      // 同じ箱・同じ書体・同じ字なので、ちがいは「入力の中で字が切れているか」だけ。枠の線を数えないよう、箱の内側だけを見る
      const 字の行 = async (ref) => {
        const clip = await dev.ev('(function(){ var i=document.querySelector(' + JSON.stringify('.screen.active ' + k.sel) + '); i.value="ふうたろうgyj";' +
          ' i.style.textBox=' + (ref ? '"normal"' : '""') + '; void i.offsetHeight; var b=i.getBoundingClientRect(); return {x:b.left,y:b.top,width:b.width,height:Math.min(b.height,60)}; })()');
        await sleep(150);
        const shot = await dev.cdp('Page.captureScreenshot', { format: 'png', clip: Object.assign({ scale: 1 }, clip) });
        const p = decodePng(Buffer.from(shot.data, 'base64'));
        let top = 1e9, bot = -1;
        const x0 = Math.round(p.w * 0.04), x1 = Math.round(p.w * 0.55), y0 = Math.round(p.h * 0.08), y1 = Math.round(p.h * 0.92);
        for (let y = y0; y < y1; y++) {
          let dark = 0;
          for (let x = x0; x < x1; x++) { const o = (y * p.w + x) * 4; if (p.rgba[o] < 90 && p.rgba[o + 1] < 90 && p.rgba[o + 2] < 90) dark++; }
          if (dark && dark < (x1 - x0) * 0.6) { if (y < top) top = y; if (y > bot) bot = y; }   // 横いっぱいの線（枠）は数えない
        }
        await dev.ev('(function(){ var i=document.querySelector(' + JSON.stringify('.screen.active ' + k.sel) + '); i.style.textBox=""; return 1; })()');
        return bot < 0 ? null : bot - top + 1;
      };
      const 入力の字 = await 字の行(false), 見本の字 = await 字の行(true);   // 見本＝字の行を詰めない
      rows.push({ scene: k.scene, state: '字の行', inputInk: 入力の字, refInk: 見本の字, cut: 入力の字 == null || 見本の字 == null ? null : 見本の字 - 入力の字 > 2 });
      await dev.ev('(function(){ var i=document.querySelector(' + JSON.stringify('.screen.active ' + k.sel) + '); i.value=' + JSON.stringify(k.sel.indexOf('textarea') >= 0 ? '' : 'ふう') + '; return 1; })()');
      await 撮る('rest');
      await dev.ev('(function(){ var i=document.querySelector(' + JSON.stringify('.screen.active ' + k.sel) + '); i.focus(); if(!i.value) i.value="ふうたろう"; return document.activeElement===i; })()');
      await sleep(300);
      await 撮る('focus');
      // 自動入力の色（ブラウザが付ける :-webkit-autofill / :autofill）を作れないので、同じ形の色を外から当てた時に字が隠れないか、は見ない。
      // ここで見るのは「さわった時」まで。自動入力の色は CSS の決まりが入っているかを検査（tests）で見る
      await dev.close();
    }
  } finally { await chrome.close(); server.close(); }
  fs.writeFileSync(path.join(OUT, '記録.json'), JSON.stringify(rows, null, 1));
  rows.filter((r) => r.state === '字の行').forEach((r) => console.log('[' + TAG + '] ' + r.scene + ' 描かれた字の高さ：入力の中 ' + r.inputInk + 'px／詰めない見本 ' + r.refInk + 'px（端末の画素）→ ' + (r.cut ? '切れている' : '切れていない')));
  rows.filter((r) => r.state !== '字の行').forEach((r) => console.log('[' + TAG + '] ' + r.scene + ' ' + r.state + '：高さ ' + r.h + 'px（外の箱 ' + r.boxH + '）・字 ' + r.fontSize + 'px・行 ' + r.lineHeight +
    '・上下の余白 ' + r.room + 'px・outline ' + r.outline + '・背景 ' + r.bg + '・枠 ' + r.border + '・外の枠の色 ' + r.boxBorder + '・appearance ' + r.appearance));
  console.log('  写真と記録: ' + path.relative(ROOT, OUT));
  process.exitCode = rows.some((r) => r.cut || r.cut === null) ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(2); });
