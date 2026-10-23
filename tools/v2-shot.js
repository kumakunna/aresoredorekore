#!/usr/bin/env node
// tools/v2-shot.js — 新しい見た目（v2・指示66）の画面を、3つの大きさで撮って同じ物差しで測る（指示66-1 第6項）
//
//   node tools/v2-shot.js                      … 全部の画面 × 大きさ（スマホ 390×844・375×667／TV 1920×1080）× 状態
//   node tools/v2-shot.js --only fes-lobby     … 名前がこの字で始まる画面だけ（--only fes2 で文化祭の流れ全部）
//   node tools/v2-shot.js --mock               … 見本（docs/指示66/見本/）の同じ画面も撮って、左右に並べた画像を作る
//   node tools/v2-shot.js --fx skip            … 演出「なし」で撮る（既定は ふつう）
//   node tools/v2-shot.js --font 130           … 設定の文字サイズ「大」で撮る（ルールとシートの文が 1.15倍）
//   --out DIR（既定 docs/監査_指示66の画像/shot）  --port 3966  --cdp 9666
//
// **サーバーも bot も要らない。**public/ をそのまま配り、socket.io は tests/harness.js の疑似を使い、
// 見本データは tools/v2-lab/（serve.js の labHtml）が index.html に差し込む——人が /v2lab で見る画面と同じもの。
//
// 測るのは見本を作った時と同じ物差し（docs/指示66/tools/check.js の UICHECK）。セレクタはアプリに合わせて渡す。
// **測る前に、物差しが効くことを1つ確かめる**（落とし穴10-f・28）：わざと画面の外へはみ出す字を足して、
// UICHECK が「画面の外」と言うか。言わなければ測らずに止める。
//
// 撮った写真は docs/監査_指示66の画像/（git に入れない）。数は 記録.json。

const fs = require('fs');
const path = require('path');
const { launch, sleep } = require('./cdp');
const { 配り手: 配り手の本体, 開く: 開くの本体 } = require('./v2-lab/open');
const { SCENES } = require('./v2-lab/scenes');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const PORT = +arg('port', 3966), CDP = +arg('cdp', 9666);
const ONLY = arg('only', null), MOCK = !!arg('mock', false), FX = arg('fx', 'normal');
// --font 130：設定の文字サイズ「大」で撮る（指示66-2 の門：375×667 で check.js 0件）
const FONT = +arg('font', 100);
const OUT = path.resolve(arg('out', path.join(ROOT, 'docs', '監査_指示66の画像', 'shot')));
const CHECK_JS = fs.readFileSync(path.join(ROOT, 'docs', '指示66', 'tools', 'check.js'), 'utf8');
const MOCK_DIR = path.join(ROOT, 'docs', '指示66', '見本');

const SIZES = { phone: [{ w: 390, h: 844 }, { w: 375, h: 667 }], tv: [{ w: 1920, h: 1080 }] };

/**
 * 撮る状態。open：開く重なり（data-v2-id）、freeze：のこりの秒、mock：見本の同じ状態を開く手順（見本の DS.open）。
 * 見本 F3 の「TVを見て！」は入ってから 0.7 秒で出る知らせ
 */
const STATES = {
  'fes-lobby': [
    { id: 'base', freeze: 23, mock: [] },
    { id: 'lo', freeze: 4, mock: null },
    { id: 'toast', freeze: 23, open: 'v2TvLook', mock: ['#tvlook'] },
    { id: 'roster', freeze: 23, open: 'v2Roster', mock: ['#roster3'] },
    { id: 'rules', freeze: 23, open: 'v2Rules-bomb-coop', mock: ['#rules3'] }
  ],
  'fes-tv': [
    { id: 'base', freeze: 22, mock: [] },
    { id: 'lo', freeze: 4, mock: null },
    { id: 'n1', n: 1, freeze: 22, mock: null },
    { id: 'n8', n: 8, freeze: 22, mock: null },
    { id: 'n16', n: 16, freeze: 22, mock: null },
    { id: 'long', n: 8, long: 1, freeze: 22, mock: null },
    // 参考（門の数に入れない）：9〜15人で QR が出ている間に、8字の名前が並ぶ形。3列では TV の字の下限 42px で8字が入らない。
    // 満員（16人）の QR を消す形・名前の段の決め方は 66-2（見本 F6）で決める
    { id: 'long16', n: 15, long: 1, freeze: 22, mock: null, info: true }
  ],
  // 指示66-2：文化祭の TV の待合。見本 F6 の人数（1・6・16）と、くまくんの宿題「15人＋8字の名前」（参考・案を報告に書く）
  'fes2-tv-lobby': [
    { id: 'base', freeze: 27, mock: [] },
    { id: 'n9', n: 9, freeze: 27, mock: null },
    { id: 'n15', n: 15, freeze: 27, mock: null },
    { id: 'long8', n: 8, long: 1, freeze: 27, mock: null },
    { id: 'long15', n: 15, long: 1, freeze: 27, mock: null, info: true }
  ],
  // 部品の見本：明るい世界（待合）と暗い世界（爆弾）の両方で、重なりを1つずつ開いて撮る
  parts: [
    { id: 'wait', world: 'wait', freeze: 23 },
    { id: 'wait-end', world: 'wait', freeze: 23, scroll: 'end' },
    { id: 'bomb-end', world: 'bomb', freeze: 4, scroll: 'end' },
    { id: 'wait-dlg', world: 'wait', freeze: 23, open: 'v2PartsDlg' },
    { id: 'wait-low', world: 'wait', freeze: 23, open: 'v2PartsLow' },
    { id: 'wait-tall', world: 'wait', freeze: 23, open: 'v2PartsTall' },
    { id: 'wait-toast', world: 'wait', freeze: 23, open: 'v2PartsToast' },
    { id: 'bomb', world: 'bomb', freeze: 23 },
    { id: 'bomb-dlg', world: 'bomb', freeze: 23, open: 'v2PartsDlg' },
    { id: 'quiz', world: 'quiz', freeze: 4 },
    { id: 'shinka', world: 'shinka', freeze: 4 }
  ]
};

/**
 * 表に無い場面（指示66-2 の文化祭の場面など）は1つの状態で撮る。のこりは20秒で止める（毎回同じ写真にする）。
 * 見本があれば、見本の同じ場面（そのまま）と並べる
 */
function statesOf(scene) { return STATES[scene.id] || [{ id: 'base', freeze: 20, mock: scene.mock ? [] : null }]; }

/** UICHECK に渡すアプリのセレクタ（見本のクラス名とは違う。名前は合わせなくてよい・66-1「入れ方」） */
const OPTS = {
  phone: { tv: false, band: '.v2-band', content: ':scope > .v2-in *', deco: '.v2-bg,.v2-brand,.v2-lpring',
    layers: '.v2-sheet:not(.is-open),.v2-dlg:not(.is-open),.v2-toast:not(.is-open),.v2-scrim:not(.is-open)',
    icons: '.v2-cbtn.is-gear .v2-ring,.v2-x,.v2-rule-ri', tiles: '.v2-tile', layerPlace: false,
    cutOk: '.v2-me-tt,.v2-rrow-tt,.v2-band-msg' },
  tv: { tv: true, band: '.v2-tband', topLine: '.v2-thd .v2-arrow', deco: '.v2-bg,.v2-tbrand',
    layers: '.v2-none', icons: '.v2-x', tiles: '.v2-tile', layerPlace: false,
    cutOk: '.v2-tmem-tt' }
};

// 配り手と開き方は tools/v2-lab/open.js（v2-ink.js・v2-motion.js と同じもの）
async function 開く(dev, scene, st) { return 開くの本体(dev, PORT, scene, Object.assign({ fx: FX, font: FONT }, st)); }

async function 測る(dev, scene, kind) {
  await dev.ev('(function(){' + CHECK_JS + '; return typeof UICHECK; })()');
  const sel = kind === 'tv' ? '#' + scene.screen + ' .v2-tvc' : '#' + scene.screen;
  // 「…で切ってよい」と決めた所（二つ名・帯の一言）。**名前は入れない**（名前は切らない・見本 F3）。
  // check.js は .cut-ok で見分けるので、測る間だけその印を付ける（アプリの markup には持ち込まない）
  return dev.ev(`(function(){ var ok=document.querySelectorAll(${JSON.stringify(OPTS[kind].cutOk)}); ok.forEach(function(e){ e.classList.add('cut-ok'); });
    var out=UICHECK(document.querySelector(${JSON.stringify(sel)}), ${JSON.stringify(OPTS[kind])});
    ok.forEach(function(e){ e.classList.remove('cut-ok'); });
    return out.concat((${重なり})(document.querySelector(${JSON.stringify(sel)}))); })()`);
}

/**
 * check.js が見ない「重ならない」を足して測る（指示66-1「重ならない：箱どうし、箱と線を重ねない」）。
 * 右上の丸ボタン（.v2-corner）と、中身の層（.v2-in）の字や箱が重なっていないか。
 * 部品の見本で、見出しの字が丸ボタンの下にもぐっていたのを check.js が数えなかったので足した
 */
const 重なり = `(function(root){
  var out = [], c = root.querySelector(':scope > .v2-corner'); if(!c) return out;
  var C = c.getBoundingClientRect();
  root.querySelectorAll(':scope > .v2-in *').forEach(function(e){
    var has = [].some.call(e.childNodes, function(n){ return n.nodeType === 3 && n.nodeValue.trim(); });
    if(!has) return;
    var cs = getComputedStyle(e); if(cs.display === 'none' || cs.visibility === 'hidden') return;
    // 巻いている間は、中身が浮いたボタンの下を通るのがふつう（iPhone の見出しの帯と同じ）。巻く前の形で重ならないことを見る
    for(var p = e.parentElement; p && p !== root; p = p.parentElement) if(p.scrollTop > 0) return;
    var rg = document.createRange(); rg.selectNodeContents(e);
    [].forEach.call(rg.getClientRects(), function(r){
      var ox = Math.min(r.right, C.right) - Math.max(r.left, C.left), oy = Math.min(r.bottom, C.bottom) - Math.max(r.top, C.top);
      if(ox > 1 && oy > 1) out.push({ kind: '右上のボタンと重なる', text: (e.textContent || '').trim().slice(0, 30) });
    });
  });
  return out;
})`;

/** 物差しの自己検査：わざとはみ出す字・小さい字を足すと、UICHECK がそれを言うか */
async function 物差しを確かめる(dev, scene, kind) {
  await dev.ev('(function(){' + CHECK_JS + '; return typeof UICHECK; })()');
  const r = await dev.ev(`(function(){
    // 試しの字は画面の箱の直下に置く（巻ける箱の中だと、check.js は「画面の外」に数えない＝それは正しい振る舞い）
    var root = document.querySelector(${JSON.stringify(kind === 'tv' ? '#' + scene.screen + ' .v2-tvc' : '#' + scene.screen)});
    var b = document.createElement('div'); b.textContent = 'はみ出す字'; b.style.cssText = 'position:absolute;left:-200px;top:10px;font-size:${kind === 'tv' ? 60 : 16}px;white-space:nowrap';
    var s = document.createElement('div'); s.textContent = 'ちいさい字'; s.style.cssText = 'font-size:${kind === 'tv' ? 20 : 8}px';
    root.appendChild(b); root.appendChild(s);
    var 実寸 = b.getBoundingClientRect().left;
    var out = UICHECK(document.querySelector(${JSON.stringify(kind === 'tv' ? '#' + scene.screen + ' .v2-tvc' : '#' + scene.screen)}), ${JSON.stringify(OPTS[kind])});
    b.remove(); s.remove();
    return { 実寸: 実寸, 外: out.some(function(x){ return x.kind === '画面の外' && x.text === 'はみ出す字'; }),
             小: out.some(function(x){ return /小さい字/.test(x.kind) && x.text === 'ちいさい字'; }) };
  })()`);
  if (!(r.実寸 < 0 && r.外 && r.小)) throw new Error('物差しが効いていません（はみ出し・小さい字を拾えない）' + JSON.stringify(r));
  if (kind === 'phone') {
    // 重なりの測りも試す：右上の丸ボタンのちょうど下に字を置くと「右上のボタンと重なる」と言うか
    r.重なり = await dev.ev(`(function(){
      var scr = document.getElementById(${JSON.stringify(scene.screen)}), c = scr.querySelector(':scope > .v2-corner'), inn = scr.querySelector(':scope > .v2-in');
      if(!c || !inn) return 'なし';
      var C = c.getBoundingClientRect(), I = inn.getBoundingClientRect();
      var t = document.createElement('div'); t.textContent = 'もぐる字';
      t.style.cssText = 'position:absolute;left:' + (C.left - I.left + 4) + 'px;top:' + (C.top - I.top + 6) + 'px;font-size:14px';
      inn.appendChild(t);
      var hit = (${重なり})(scr).some(function(x){ return x.text === 'もぐる字'; });
      t.remove(); return hit; })()`);
    // 右上の丸ボタンが無い画面（見本でも ⚙ の無い決定・結果など・指示66-2）では、重なりは起きないので試せない。
    // その時は「なし」と記録して先へ（丸ボタンのある画面で毎回試している）
    if (r.重なり !== true && r.重なり !== 'なし') throw new Error('重なりの測りが効いていません' + JSON.stringify(r));
  }
  return r;
}

async function 見本を撮る(dev, page, id, opens, file) {
  await dev.go('file:///' + path.join(MOCK_DIR, page).replace(/\\/g, '/'));
  await dev.until("window.DS && document.fonts.status==='loaded'", 20000, '見本');
  await dev.ev(`(function(){
    var b=document.querySelector('[data-fxset="none"]'); if(b) b.click();
    document.documentElement.classList.add('native'); document.querySelectorAll('.frame').forEach(DS.fit);
    var scr=document.querySelector('[data-id="${id}"]'); scr.scrollIntoView({block:'start'}); scr.classList.add('play');
    return 1; })()`);
  // 見えた枠は見本の台本が動き出す（知らせを出して閉じる）。それが済んでから開く
  await sleep(1200);
  await dev.ev(`(function(){ var scr=document.querySelector('[data-id="${id}"]');
    ${JSON.stringify(opens || [])}.forEach(function(sel){ DS.open(scr, sel); }); return 1; })()`);
  await sleep(900);
  const r = await dev.ev(`(function(){ var e=document.querySelector('[data-id="${id}"]'); e.scrollIntoView({block:'start'}); var b=e.getBoundingClientRect(); return {x:b.left+scrollX,y:b.top+scrollY,w:b.width,h:b.height}; })()`);
  await sleep(250);
  const res = await dev.raw('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: r.x, y: r.y, width: r.w, height: r.h, scale: 1 } });
  fs.writeFileSync(file, Buffer.from(res.data, 'base64'));
}

/** 2枚を左右に並べた画像（左＝見本・右＝アプリ）を作る */
async function 並べる(dev, left, right, file, w, h) {
  const toUrl = (f) => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');
  const gap = 24, W = w * 2 + gap, H = h + 40;
  await dev.raw('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await dev.go('about:blank');
  await dev.ev(`(function(){ document.body.style.cssText='margin:0;background:#888;font:bold 18px sans-serif;color:#fff';
    document.body.innerHTML='<div style="display:flex;gap:${gap}px"><div><div style="height:40px;line-height:40px">見本</div><img id=a></div><div><div style="height:40px;line-height:40px">アプリ</div><img id=b></div></div>';
    document.getElementById('a').src=${JSON.stringify(toUrl(left))}; document.getElementById('b').src=${JSON.stringify(toUrl(right))}; return 1; })()`);
  await dev.until("document.getElementById('a').complete && document.getElementById('b').complete", 5000, '並べる');
  const res = await dev.raw('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: W, height: H, scale: 1 } });
  fs.writeFileSync(file, Buffer.from(res.data, 'base64'));
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await 配り手の本体(PORT);
  const br = await launch({ port: CDP });
  const 記録 = { いつ: new Date().toISOString(), 演出: FX, 物差し: [], 画面: [] };
  let 指摘の数 = 0;
  try {
    for (const scene of SCENES) {
      if (ONLY && scene.id.indexOf(ONLY) !== 0) continue;
      for (const size of SIZES[scene.kind]) {
        const dev = await br.newDevice(scene.id, { width: size.w, height: size.h, deviceScaleFactor: 1, mobile: scene.kind === 'phone' });
        let 確かめた = false;
        for (const st of statesOf(scene)) {
          await 開く(dev, scene, st);
          if (!確かめた) { 記録.物差し.push({ scene: scene.id, size: size.w + 'x' + size.h, 結果: await 物差しを確かめる(dev, scene, scene.kind) }); 確かめた = true; }
          const issues = await 測る(dev, scene, scene.kind);
          const name = scene.id + '_' + size.w + 'x' + size.h + '_' + st.id;
          const file = path.join(OUT, name + '.png');
          await dev.shot(file);
          記録.画面.push({ 名前: name, 指摘: issues.length, 参考: !!st.info, 中身: issues });
          if (!st.info) 指摘の数 += issues.length;
          console.log((st.info ? '（参考）' : '') + (issues.length ? '✖ ' : '✔ ') + name + '  check.js ' + issues.length + ' 件' + (issues.length ? '：' + issues.map((x) => x.kind + '「' + x.text + '」').join(' / ') : ''));
          if (logsOf(dev).length) console.log('   ページの例外:', logsOf(dev).join(' | '));
        }
        await dev.close();
      }
    }
    if (MOCK) {
      const dev = await br.newDevice('mock', { width: 2100, height: 1300, deviceScaleFactor: 1 });
      for (const scene of SCENES) {
        if (ONLY && scene.id.indexOf(ONLY) !== 0) continue;
        const size = SIZES[scene.kind][0];
        for (const st of statesOf(scene)) {
          if (!st.mock) continue;
          const mf = path.join(OUT, 'mock_' + scene.id + '_' + st.id + '.png');
          await 見本を撮る(dev, scene.mock.page, scene.mock.id, st.mock, mf);
          const af = path.join(OUT, scene.id + '_' + size.w + 'x' + size.h + '_' + st.id + '.png');
          const pf = path.join(OUT, '並べた_' + scene.id + '_' + st.id + '.png');
          await 並べる(dev, mf, af, pf, size.w, size.h);
          await dev.raw('Emulation.setDeviceMetricsOverride', { width: 2100, height: 1300, deviceScaleFactor: 1, mobile: false });
          console.log('並べた:', path.relative(ROOT, pf));
        }
      }
      await dev.close();
    }
  } finally {
    fs.writeFileSync(path.join(OUT, '記録.json'), JSON.stringify(記録, null, 1));
    await br.close();
    server.close();
  }
  console.log((指摘の数 ? '✖ ' : '✔ ') + 'check.js の指摘 合計 ' + 指摘の数 + ' 件（' + 記録.画面.length + ' 枚）。写真と記録：' + path.relative(ROOT, OUT));
  process.exitCode = 指摘の数 ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(2); });

function logsOf(dev) { const l = dev.logs.slice(); dev.logs.length = 0; return l; }
