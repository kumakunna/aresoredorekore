// tools/safe-area.js — iPhone のホームバー（画面の下の線）に、いちばん下のボタンが近すぎないかを測る（指示68-T 二の束7 D2）
//
//   node tools/safe-area.js   … 表を出し、docs/監査_指示68-Tの画像/safe-area-*.png と safe-area.json を書く。1つでも近すぎたら終わりの数が 1
//
// Chrome の「画面の安全な所」の差しかえ（CDP Emulation.setSafeAreaInsetsOverride）で、下に 34px（iPhone のホームバー）を作り、
// 見本データの画面（tools/v2-lab/・v2-shot.js と同じ開き方）を 390×844 で開く。
// 測るのは、画面の中で押せる物（button・a・[data-v2-act] など）のうち、いちばん下の物の下の辺と、画面の下の辺の間。
// 合格：ホームバー（34px）より上にあること（ボタンの下の辺 ≤ 844 − 34）。
// 比べるため、差しかえなし（0px）でも同じ画面を測る（帯の高さが 68px のまま変わらないこと）
const fs = require('fs');
const path = require('path');
const { launch } = require('./cdp');
const { 配り手, 開く, ROOT } = require('./v2-lab/open');
const FesScenes = require('./v2-lab/fes-scenes');
const ButtonScenes = require('./v2-lab/button-scenes');
const OnajiScenes = require('./v2-lab/onaji-scenes');

const PORT = 3466;
const VP = { width: 390, height: 844, mobile: true, deviceScaleFactor: 2 };
const BAR = 34;
const DIR = path.join(ROOT, 'docs', '監査_指示68-Tの画像');
const 場面 = (list, id) => list.SCENES.find((s) => s.id === id);
const SCENES = [
  場面(FesScenes, 'fes2-lobby'), 場面(FesScenes, 'fes2-vote'), 場面(FesScenes, 'fes2-ready'), 場面(FesScenes, 'fes2-result'),
  場面(ButtonScenes, 'pt-run'), 場面(ButtonScenes, 'so-press'), 場面(OnajiScenes, 'onaji-choose')
].filter(Boolean);

const 測る = `(function(){
  var scr = document.querySelector('.screen.active'); if(!scr) return null;
  var H = window.innerHeight, low = null;
  scr.querySelectorAll('button, a[href], [data-v2-act], [data-fes-act], [data-pt-stop], [data-so-press]').forEach(function(n){
    var r = n.getBoundingClientRect(), cs = getComputedStyle(n);
    if (!r.width || !r.height || cs.visibility === 'hidden' || cs.display === 'none') return;
    if (r.top >= H || r.bottom <= 0) return;
    if (n.closest('.v2-sheet:not(.is-open), .v2-dlg:not(.is-open), .v2-pop:not(.is-open)')) return;
    if (!low || r.bottom > low.bottom) low = { bottom: Math.round(r.bottom), text: (n.textContent || n.getAttribute('aria-label') || '').trim().slice(0, 20) };
  });
  var band = scr.querySelector('.v2-band'), bh = band ? Math.round(band.getBoundingClientRect().height) : null;
  return { H: H, low: low, bandH: bh, safe: getComputedStyle(document.documentElement).getPropertyValue('--v2-safe-b').trim() };
})()`;

(async function main() {
  const server = await 配り手(PORT);
  const br = await launch({ port: 9344 });
  const rows = [], bad = [];
  try {
    for (const sc of SCENES) {
      for (const inset of [0, BAR]) {
        const dev = await br.newDevice(sc.id, VP);
        let ok = true;
        try { await dev.raw('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, bottom: inset, left: 0, right: 0 } }); }
        catch (e) { ok = false; }
        if (!ok) { console.log('✖ この Chrome は安全な所の差しかえができません（Emulation.setSafeAreaInsetsOverride）'); process.exit(2); }
        await 開く(dev, PORT, sc, { fx: 'skip' });
        const m = await dev.ev(測る);
        const 余り = m && m.low ? m.H - m.low.bottom : null;
        const 合格 = inset === 0 || (余り != null && 余り >= BAR);
        rows.push({ scene: sc.id, inset, 余り, bandH: m && m.bandH, low: m && m.low });
        console.log((合格 ? '✔ ' : '✖ ') + sc.id.padEnd(14) + ' 下の線 ' + String(inset).padStart(2) + 'px：いちばん下のボタン「' + (m && m.low ? m.low.text : '-') + '」の下 ' +
          (m && m.low ? m.low.bottom : '-') + 'px・画面の下まで ' + 余り + 'px' + (m && m.bandH ? '・帯の高さ ' + m.bandH + 'px' : ''));
        if (!合格) bad.push(sc.id);
        if (inset) await dev.shot(path.join(DIR, 'safe-area-' + sc.id + '.png'));
        await dev.close();
      }
    }
  } finally {
    await br.close();
    server.close();
  }
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(path.join(DIR, 'safe-area.json'), JSON.stringify({ at: new Date().toISOString(), bar: BAR, rows, bad }, null, 1));
  console.log(bad.length ? '✖ ホームバーに近すぎる：' + bad.join('・') : '✔ ' + SCENES.length + '画面とも、いちばん下のボタンはホームバー（' + BAR + 'px）より上');
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
