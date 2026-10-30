// tools/cue-fit.js — 合図の字（FxKit.cue の l・xl。「スタート！」）が、どの幅でも1行のまま入るかを測って撮る（指示68-T）
//
//   node tools/cue-fit.js   … 表を出し、docs/監査_指示68-Tの画像/cue-320-*.png と cue-fit.json を書く。1つでも外れたら終わりの数が 1
//
// ぴったり10秒の「数えている」画面（見本の pt-run・tools/v2-lab/button-scenes.js）を開き、本番と同じ呼び方
// （index.html の pittariFx：FxKit.cue(UiText.PITTARI.スタート, { size: 'l'|'xl', cls: 'is-pt-go' })）で字を出して測る。
// 形：
//   ・スマホ 320×568・375×667・390×844、TV 1920×1080
//   ・細い箱：置き場（#uiLayerRoot）を幅 200px にして、その中に出す（fixed の基準が箱になる・落とし穴26の形）
//   ・文字サイズの設定「大」（130）
//   ・長い字：「ラストチャンス！」（8字）。CSS の大きさのままでは 320 幅に入らないので、縮める仕組みが本当に動くかを見る
// 合格：字の箱の高さが1行分（字の大きさ × 2 より低い。1行は 行の高さ1.15＋上下の余白 で 1.55〜1.65倍、2行なら 2.7倍を超える）・左右が箱の内側に収まる。
//   字が縮んだ時は、どれだけ縮んだか（CSS の大きさ → 実際）を表に出す
const fs = require('fs');
const path = require('path');
const { launch, sleep } = require('./cdp');
const { 配り手, 開く, ROOT } = require('./v2-lab/open');
const ButtonScenes = require('./v2-lab/button-scenes');

const PORT = 3465;
const DIR = path.join(ROOT, 'docs', '監査_指示68-Tの画像');
const 場面 = ButtonScenes.SCENES.find((s) => s.id === 'pt-run');
const 場面TV = ButtonScenes.SCENES.find((s) => s.id === 'pt-tv-run');

const FORMS = [
  { id: '320', vp: { width: 320, height: 568, mobile: true, deviceScaleFactor: 2 }, shot: true },
  { id: '375', vp: { width: 375, height: 667, mobile: true, deviceScaleFactor: 2 } },
  { id: '390', vp: { width: 390, height: 844, mobile: true, deviceScaleFactor: 2 } },
  { id: '320・文字「大」', vp: { width: 320, height: 568, mobile: true, deviceScaleFactor: 2 }, font: 130 },
  { id: '390・細い箱200px', vp: { width: 390, height: 844, mobile: true, deviceScaleFactor: 2 }, narrow: 200, shot: true },
  { id: 'TV', vp: { width: 1920, height: 1080 }, tv: true }
];
const TEXTS = [{ id: 'スタート', text: null }, { id: 'ラストチャンス', text: 'ラストチャンス！' }];

const 測る = (text, size, narrow, tv) => `(async function(){
  ${tv ? "document.documentElement.classList.add('big-screen');   // 見本の画面は大画面の印を付けないので、本番の TV と同じに付ける" : ''}
  ${narrow ? `var L = document.getElementById('uiLayerRoot'); L.style.cssText += ';position:fixed;left:0;top:0;width:${narrow}px;height:100%;transform:translateZ(0);outline:2px dashed #f0a';` : ''}
  var n = FxKit.cue(${text ? JSON.stringify(text) : 'UiText.PITTARI.スタート'}, { ms: 4000, size: ${JSON.stringify(size)}, cls: 'is-pt-go' });
  await new Promise(function(r){ setTimeout(r, 450); });   // 出てくる拡大（0.18秒）が済むまで
  var t = n.firstChild, b = n.getBoundingClientRect(), r = t.getBoundingClientRect(), cs = getComputedStyle(n);
  var fs = parseFloat(getComputedStyle(t).fontSize);
  t.style.fontSize = ''; var css = parseFloat(getComputedStyle(t).fontSize); t.style.fontSize = fs + 'px';
  return { text: t.textContent, fs: fs, css: css, h: r.height, w: r.width,
    left: r.left - (b.left + parseFloat(cs.paddingLeft)), right: (b.right - parseFloat(cs.paddingRight)) - r.right, box: b.width };
})()`;

(async function main() {
  const server = await 配り手(PORT);
  const br = await launch({ port: 9343 });
  const rows = [], bad = [];
  try {
    for (const f of FORMS) {
      for (const size of ['l', 'xl']) {
        for (const tx of TEXTS) {
          const dev = await br.newDevice(f.id, f.vp);
          await 開く(dev, PORT, f.tv ? 場面TV : 場面, { fx: 'normal', font: f.font || 100 });
          const m = await dev.ev(測る(tx.text, size, f.narrow, f.tv));
          const 一行 = m.h < m.fs * 2;
          const 入る = m.left >= -0.5 && m.right >= -0.5;
          const row = Object.assign({ form: f.id, size, 字: tx.id, 一行, 入る }, m);
          rows.push(row);
          const 縮み = m.fs < m.css - 0.01 ? '（' + m.css.toFixed(1) + ' → ' + m.fs.toFixed(1) + 'px に縮めた）' : '';
          console.log((一行 && 入る ? '✔ ' : '✖ ') + f.id.padEnd(14) + ' ' + size.padEnd(2) + ' ' + m.text + '：字 ' + m.fs.toFixed(1) + 'px' + 縮み +
            '・高さ ' + Math.round(m.h) + '・左右の余り ' + Math.round(m.left) + '／' + Math.round(m.right) + 'px（箱 ' + Math.round(m.box) + '）');
          if (!一行 || !入る) bad.push(f.id + ' ' + size + ' ' + m.text);
          if (f.shot) await dev.shot(path.join(DIR, 'cue-' + (f.narrow ? 'narrow' : f.id) + '-' + size + (tx.text ? '-long' : '') + '.png'));
          await dev.close();
        }
      }
    }
  } finally {
    await br.close();
    server.close();
  }
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(path.join(DIR, 'cue-fit.json'), JSON.stringify({ at: new Date().toISOString(), rows, bad }, null, 1));
  console.log(bad.length ? '✖ 1行に入らない：' + bad.join('／') : '✔ ' + rows.length + '通りとも、合図の字は1行のまま箱に入る');
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
