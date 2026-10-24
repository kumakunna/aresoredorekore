#!/usr/bin/env node
// tools/v2-shot.js — 新しい見た目（v2・指示66）の画面を、3つの大きさで撮って同じ物差しで測る（指示66-1 第6項）
//
//   node tools/v2-shot.js                      … 全部の画面 × 大きさ（スマホ 390×844・375×667／TV 1920×1080）× 状態
//   node tools/v2-shot.js --only fes-lobby     … 名前がこの字で始まる画面だけ（--only fes2 で文化祭の流れ全部）
//   node tools/v2-shot.js --mock               … 見本（docs/指示66/見本/）の同じ画面も撮って、左右に並べた画像を作る
//   node tools/v2-shot.js --fx skip            … 演出「なし」で撮る（既定は ふつう）
//   node tools/v2-shot.js --font 130           … 設定の文字サイズ「大」で撮る（ルールとシートの文が 1.15倍）
//   node tools/v2-shot.js --only home-e3,home-te3 --prod-url https://aresoredorekore.duckdns.org … 待合を本番の長さのアドレスで（指示68-0a M8）
//   node tools/v2-shot.js --gate               … 門の形（指示68-0b K8 ①⑧）：ふつう・文字「大」・演出「なし」・大＋なし の4通りを続けて撮る。
//                                                  写真は out の下の normal／font130／skip／font130-skip に分ける
//   node tools/v2-shot.js --mock-check         … 見本（docs/指示66/見本/）の全部の画面にも同じ物差しを当てて、記録に書くだけ（見本は直さない）
//   --out DIR（既定 docs/監査_指示66の画像/shot）  --port 3966  --cdp 9666
//
// **動きが終わってから撮る・測る**（指示68-0b K3）：くり返さない動きが全部終わり、300ms あけて2回撮った絵が同じになるまで待つ。
// くり返す動き（背景の丸・名前の壁）は最初のコマで止めて比べる。10秒で打ち切り、記録に「止まらなかった」と書く。
// 途中の形を見たい時は tools/v2-motion.js で別に撮る（門には使わない）。
// **見本データは毎回同じ**（K4）：見本データの乱数は場面ごとに種を決める（tools/v2-lab/serve.js）。
//
// **サーバーも bot も要らない。**public/ をそのまま配り、socket.io は tests/harness.js の疑似を使い、
// 見本データは tools/v2-lab/（serve.js の labHtml）が index.html に差し込む——人が /v2lab で見る画面と同じもの。
//
// 測るのは見本を作った時と同じ物差し（docs/指示66/tools/check.js の UICHECK）。セレクタはアプリに合わせて渡す。
// **測る前に、物差しが効くことを確かめる**（落とし穴10-f・28）：わざと画面の外へはみ出す字・小さい字・重なる字・
// 薄い字・すき間の狭いボタン・帯の線に近い札・TV の枠の外の部品を足して、UICHECK がそれぞれを言うか（指示68-0b K9）。
// 言わなければ測らずに止める。場面によって試せない物（帯の無い画面の K5 など）は、ほかの場面で1回は試せていることを最後に確かめる。
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
// --prod-url https://…：ふだんの画面の待合を本番と同じ長さのアドレスで撮る（指示68-0a M8）。--only は「,」で区切って複数わたせる
const PROD = arg('prod-url', null);
// 本番のアドレス（K8 ⑤：home-e3-tv はこの長さでも門に数える）
const PROD_URL = 'https://aresoredorekore.duckdns.org';
const GATE = !!arg('gate', false), MOCK_CHECK = !!arg('mock-check', false);
/** 撮る形。--gate は4通り（K8 ①⑧）。ふつうは1通り（--fx・--font） */
const FORMS = GATE
  ? [{ name: 'normal', fx: 'normal', font: 100 }, { name: 'font130', fx: 'normal', font: 130 }, { name: 'skip', fx: 'skip', font: 100 }, { name: 'font130-skip', fx: 'skip', font: 130 }]
  : [{ name: '', fx: FX, font: FONT }];
const ONLY_LIST = ONLY ? String(ONLY).split(',') : null;
const 選ぶ = (id) => !ONLY_LIST || ONLY_LIST.some((p) => id.indexOf(p) === 0);
const OUT = path.resolve(arg('out', path.join(ROOT, 'docs', '監査_指示66の画像', 'shot')));
const CHECK_JS = fs.readFileSync(path.join(ROOT, 'docs', '指示66', 'tools', 'check.js'), 'utf8');
const MOCK_DIR = path.join(ROOT, 'docs', '指示66', '見本');

const SIZES = { phone: [{ w: 390, h: 844 }, { w: 375, h: 667 }], tv: [{ w: 1920, h: 1080 }] };
/**
 * 大きさを足す場面（K8 ②：TV で /tv を開いた画面は、TV の大きさでも撮る）。
 * 画面の形はまだスマホの列（TV の形にするのは 68-7 の C19）なので、物差しはスマホのまま当てる
 */
const MORE_SIZES = { 'home-e2tv': [{ w: 1920, h: 1080 }] };
function sizesOf(scene) { return SIZES[scene.kind].concat(MORE_SIZES[scene.id] || []); }

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
    // くまくんの答え（2026-10-24）：9人からは名前の札を広げる（QR 350px）。15人が全員8字でも切れないことを門に数える
    { id: 'long15', n: 15, long: 1, freeze: 27, mock: null },
    { id: 'long9', n: 9, long: 1, freeze: 27, mock: null }
  ],
  'fes2-tv-full': [
    { id: 'base', freeze: 27, mock: [] },
    { id: 'long16', n: 16, long: 1, freeze: 27, mock: null }
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
  ],
  // 指示68-0b K8 ④⑦：待合を 6・10・13・16人で。名前の札は、いちばん幅の広い8字でも（wide）
  'home-e3': [
    { id: 'base', freeze: 20, mock: [] },
    { id: 'n10', n: 10, freeze: 20, mock: null },
    { id: 'n13', n: 13, freeze: 20, mock: null },
    { id: 'n16', n: 16, freeze: 20, mock: null },
    { id: 'wide', long: 1, freeze: 20, mock: null },
    { id: 'wide10', n: 10, long: 1, freeze: 20, mock: null }
  ],
  'home-e4': [{ id: 'base', freeze: 20, mock: [] }, { id: 'wide', long: 1, freeze: 20, mock: null }],
  'home-te3': [{ id: 'base', freeze: 20, mock: [] }, { id: 'wide', long: 1, freeze: 20, mock: null }],
  'home-tv16': [{ id: 'base', freeze: 20, mock: null }, { id: 'wide', long: 1, freeze: 20, mock: null }],
  'home-e3-16': [{ id: 'base', freeze: 20, mock: null }, { id: 'wide', long: 1, freeze: 20, mock: null }],
  // K8 ⑤：「TVに映す」のシートを本番と同じ長さのアドレスで
  'home-e3-tv': [{ id: 'base', freeze: 20, mock: null }, { id: 'prod', prod: PROD_URL, freeze: 20, mock: null }],
  // K8 ③：QR を読むシートが開いた形。base はカメラが使えない端末（案内だけ）、cam はその場でカメラが映る端末（Android の Chrome）
  'home-e2qr': [{ id: 'base', freeze: 20, mock: null }, { id: 'cam', cam: 1, freeze: 20, mock: null }],
  'fes2-lobby': [{ id: 'base', freeze: 20, mock: [] }, { id: 'wide', long: 1, freeze: 20, mock: null }],
  'fes2-staff': [{ id: 'base', freeze: 20, mock: [] }, { id: 'wide', long: 1, freeze: 20, mock: null }],
  // K8 ⑦：TV の投票も長い名前で。A3（ゲーム名と一言が重ならない）：8字の名前・2行になる一言 × 候補3つ・2つ
  'fes2-tv-vote': [{ id: 'base', freeze: 20, mock: [] }, { id: 'wide', long: 1, freeze: 20, mock: null },
    { id: 'long3', edit: 'tvVoteLong', freeze: 20, mock: null }, { id: 'long2', edit: 'tvVoteLong2', freeze: 20, mock: null }]
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
    over: '.v2-sheet,.v2-dlg,.v2-toast,.v2-scrim,.v2-pop,.v2-ov.is-open', buttons: 'button,.v2-btn,[role=button]',
    cutOk: '.v2-me-tt,.v2-rrow-tt,.v2-band-msg' },
  // extra（K7）：TV の画面に重なる、アプリ全体の浮いた部品。#uicheck-extra-test は自己検査の試し
  tv: { tv: true, band: '.v2-tband', topLine: '.v2-thd .v2-arrow', deco: '.v2-bg,.v2-tbrand',
    layers: '.v2-none', icons: '.v2-x', tiles: '.v2-tile', layerPlace: false,
    over: '.v2-sheet,.v2-dlg,.v2-toast,.v2-scrim,.v2-pop,.v2-ov.is-open', buttons: 'button,.v2-btn,[role=button]',
    extra: '#floatingGearBtn,#floatingBackBtn,#floatingStatusBtn,#uicheck-extra-test',
    cutOk: '.v2-tmem-tt' }
};
/** 字の後ろの色を撮る時に、一緒に消す飾り（名前の壁・縦の英字。背景に入れない・K2） */
const INK_HIDE = '.v2-wall,.v2-brand,.v2-tbrand';

// 配り手と開き方は tools/v2-lab/open.js（v2-ink.js・v2-motion.js と同じもの）
async function 開く(dev, scene, st, form) {
  await 開くの本体(dev, PORT, scene, Object.assign({ fx: form.fx, font: form.font }, st));
  const prod = st.prod || PROD;
  if (prod && scene.home) await 本番のアドレスにする(dev, scene, st, prod);
  // 描いたあとで字だけ差しかえる形（見本データに無い長さを試す。描く関数はそのまま）
  if (st.edit) await dev.ev('(' + EDITS[st.edit] + ')()');
  // カメラが映る端末の形：index.html の homeScanStart が箱に入れるのと同じ video（撮る道具にはカメラが無いので、黒い絵のまま）
  if (st.cam) await dev.ev("(function(){ var b=document.querySelector('.screen.active [data-home-scan]'); if(!b) return 0; var v=document.createElement('video'); v.setAttribute('playsinline',''); v.width=640; v.height=480; v.style.aspectRatio='4/3'; b.innerHTML=''; b.appendChild(v); return 1; })()");
  return 止まるまで(dev);
}

/** 描いたあとで字だけ差しかえる（st.edit）。差しかえたら名前の縮めと短い行の直しをやり直す */
const EDITS = {
  // A3：TV の投票の札に、いちばん幅の広い8字の名前と、2行になる一言（候補3つ）
  tvVoteLong: `function(){ document.querySelectorAll('#scr-v2-fes-tv .v2-tvrow').forEach(function(r){
    r.querySelector('.v2-vn').textContent = 'ながいなまえだよ'; r.querySelector('.v2-vb').textContent = 'みんなで力を合わせて、時間内に爆弾のコードを全部切ろう'; });
    V2.relayout(document.getElementById('scr-v2-fes-tv')); return 1; }`,
  // 候補2つ（人数で出せるゲームが2つだけの回）
  tvVoteLong2: `function(){ var rs = document.querySelectorAll('#scr-v2-fes-tv .v2-tvrow'); if (rs[2]) rs[2].remove();
    document.querySelectorAll('#scr-v2-fes-tv .v2-tvrow').forEach(function(r){
    r.querySelector('.v2-vn').textContent = 'ながいなまえだよ'; r.querySelector('.v2-vb').textContent = 'みんなで力を合わせて、時間内に爆弾のコードを全部切ろう'; });
    V2.relayout(document.getElementById('scr-v2-fes-tv')); return 1; }`
};

/**
 * K3（指示68-0b）：動きが終わってから撮る・測る。動きの途中で撮った写真が、門の証拠になっていた（決めた時のカード）。
 * ①くり返さない動き（CSS の動き・移り変わり。document.getAnimations()）が全部終わるまで待つ。5秒以上の時計の帯は止める側。
 *   くり返す動き（背景の丸・名前の壁）は最初のコマで止める——毎回同じ絵にするため（K4）
 * ②300ms あけて2回撮った絵が同じになるまで待つ（台本の setTimeout で変わる物も拾う）
 * 10秒で打ち切り、「止まらなかった」と返す（撮って測るのは続ける。記録に残す）
 */
const くり返す動きを止める = `(function(){ var k = 0;
  document.getAnimations().forEach(function(x){
    var tm = x.effect && x.effect.getComputedTiming ? x.effect.getComputedTiming() : { iterations: 1, duration: 0 };
    // くり返す動きと、5秒以上かけて進む時計の帯（のこり時間の v2-sync など。V2.freeze で数は止まっても帯は進む）は最初のコマで止める
    if (tm.iterations === Infinity || tm.duration >= 5000) { if (x.playState !== 'paused' || x.currentTime !== 0) { x.pause(); x.currentTime = 0; } return; }
    if (x.playState === 'running' || x.pending) k++;
  });
  return k; })()`;
async function 止まるまで(dev) {
  const t0 = Date.now();
  let 動き = await dev.ev(くり返す動きを止める);
  while (動き) {
    if (Date.now() - t0 > 10000) return { 止まった: false, ms: Date.now() - t0, 何: 'CSS の動きが ' + 動き + ' 個終わらない' };
    await sleep(100);
    動き = await dev.ev(くり返す動きを止める);
  }
  let prev = null;
  for (;;) {
    await sleep(300);
    await dev.ev(くり返す動きを止める);
    // 比べるだけなので軽い形で撮る（同じ絵なら同じバイト列になる）
    const r = await dev.raw('Page.captureScreenshot', { format: 'jpeg', quality: 40, optimizeForSpeed: true });
    if (prev === r.data) return { 止まった: true, ms: Date.now() - t0 };
    prev = r.data;
    if (Date.now() - t0 > 10000) return { 止まった: false, ms: Date.now() - t0, 何: '2回撮った絵が同じにならない' };
  }
}

/**
 * --prod-url（指示68-0a M8）：ふだんの画面の待合を、本番と同じ長さのアドレスで描き直す。
 * 見本は 127.0.0.1 の短いアドレスで描くので、「TVに映す」の手順の字と QR の細かさが本番と違う。
 * 部屋の画面に渡る値（tvUrl・local・qr）だけを差しかえる——描く関数（V2Home.room・roomTv）はそのまま通す。
 * QR に入れる形は index.html の roomJoinUrl と同じ（origin + '/' + '?room=' + コード）
 */
async function 本番のアドレスにする(dev, scene, st, prod) {
  await dev.ev(`(function(){ var P = ${JSON.stringify(String(prod).replace(/\/$/, ''))};
    var wrap = function(f){ return function(v){ v = Object.assign({}, v, { tvUrl: P + '/tv', local: false });
      if (v.qr && v.code && window.QR) v.qr = QR.toSvg(P + '/?room=' + encodeURIComponent(v.code), { quiet: 2 });
      return f(v); }; };
    if (!V2Home.__prod) { V2Home.room = wrap(V2Home.room); V2Home.roomTv = wrap(V2Home.roomTv); V2Home.__prod = 1; }
    V2Screens.home(window.__V2LAB_VIEW);
    ${st.open ? `var l=document.querySelector('[data-v2-id="${st.open}"]'); if(l) V2.open(l);` : ''}
    var s = document.getElementById(${JSON.stringify(scene.screen)}); if (s) { V2.fitTv(s); V2.relayout(s); }
    return 1; })()`);
  await sleep(700);
}

async function 測る(dev, scene, kind) {
  await dev.ev('(function(){' + CHECK_JS + '; return typeof UICHECK; })()');
  const sel = kind === 'tv' ? '#' + scene.screen + ' .v2-tvc' : '#' + scene.screen;
  // K2：字を消して撮った写真を先に渡す（字の後ろの色を画素で測る。名前の壁と縦の英字は背景に入れない）
  await dev.ev(`(function(){ UICHECK.inkOff(${JSON.stringify(INK_HIDE)}); return 1; })()`);
  await sleep(60);
  // 色を読むだけなので JPEG（PNG の 1920×1080 はページに渡すだけで数秒かかる）。字の後ろの色は中央値で読むので、圧縮のにじみは効かない
  const bare = await dev.raw('Page.captureScreenshot', { format: 'jpeg', quality: 92, optimizeForSpeed: true });
  await dev.ev(`(function(){ UICHECK.inkOn(); return 1; })()`);
  await dev.ev(`UICHECK.loadShot('data:image/jpeg;base64,${bare.data}', window.devicePixelRatio || 1)`);
  try { return await 測る本体(dev, kind, sel); } finally { await dev.ev('(function(){ UICHECK.pix = null; return 1; })()'); }
}
async function 測る本体(dev, kind, sel) {
  // 「…で切ってよい」と決めた所（二つ名・帯の一言）。**名前は入れない**（名前は切らない・見本 F3）。
  // check.js は .cut-ok で見分けるので、測る間だけその印を付ける（アプリの markup には持ち込まない）
  return dev.ev(`(function(){ var ok=document.querySelectorAll(${JSON.stringify(OPTS[kind].cutOk)}); ok.forEach(function(e){ e.classList.add('cut-ok'); });
    var out=UICHECK(document.querySelector(${JSON.stringify(sel)}), ${JSON.stringify(OPTS[kind])});
    ok.forEach(function(e){ e.classList.remove('cut-ok'); });
    var r0 = document.querySelector(${JSON.stringify(sel)});
    return out.concat((${重なり})(r0), (${省略})(r0, ${JSON.stringify(OPTS[kind].cutOk)}), (${アドレス})(r0), (${字と印})(r0, ${JSON.stringify(OPTS[kind].layers)}, ${JSON.stringify(OPTS[kind].deco + ',' + INK_HIDE)}, ${JSON.stringify(OPTS[kind].over)}), (${外で切れる})(r0, ${JSON.stringify(OPTS[kind].layers)}, ${JSON.stringify(OPTS[kind].deco + ',' + INK_HIDE)})); })()`);
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

/**
 * check.js が見ない「…で切れている」を足して測る（指示66-2：TV の名前が 1px だけはみ出して「…」になっていたのに、check.js は 0件と言った）。
 * 1行に入れる字（.v2-cut）で、「…で切ってよい」と決めた所（cutOk）でないのに、字の幅が箱より広いもの
 */
const 省略 = `(function(root, ok){
  var out = [];
  root.querySelectorAll('.v2-cut').forEach(function(e){
    if(e.matches(ok)) return;
    var cs = getComputedStyle(e); if(cs.display === 'none' || cs.visibility === 'hidden' || !e.offsetParent) return;
    if(e.scrollWidth > e.clientWidth) out.push({ kind: '…で切れている', text: (e.textContent || '').trim().slice(0, 30) });
  });
  return out;
})`;

/**
 * 新しい物差しの自己検査（指示68-0b K9）：K1・K2・K5・K6・K7 それぞれに「わざと壊した見本」を足して、
 * 本番と同じ測り方（字を消して撮る所から）で拾うかを見る。拾えなければ止める。
 * 試せない場面（帯の無い画面の K5・スマホの K7）は「なし」。どれも1回は試せたことを最後に確かめる（試せた）
 */
const 試せた = { K1: 0, K2: 0, K5: 0, K6: 0, K7: 0 };
async function 新しい物差しを確かめる(dev, scene, kind) {
  const sel = kind === 'tv' ? '#' + scene.screen + ' .v2-tvc' : '#' + scene.screen;
  const fs0 = kind === 'tv' ? 48 : 16;
  const 置いた = await dev.ev(`(function(){
    var root = document.querySelector(${JSON.stringify(sel)}), put = { K5: false, K7: false };
    var box = document.createElement('div'); box.className = 'uicheck-self';
    box.style.cssText = 'position:absolute;left:${kind === 'tv' ? 300 : 30}px;top:${kind === 'tv' ? 200 : 110}px;width:${kind === 'tv' ? 900 : 300}px;height:${kind === 'tv' ? 600 : 300}px;z-index:99;background:#fff;font-family:sans-serif';
    box.innerHTML = '<div style="position:absolute;left:0;top:0;font-size:${fs0}px;color:#000;white-space:nowrap">かさなる字A</div>' +
      '<div style="position:absolute;left:12px;top:${fs0 >> 2}px;font-size:${fs0}px;color:#000;white-space:nowrap">かさなる字B</div>' +
      '<div style="position:absolute;left:0;top:${fs0 * 3}px;font-size:${fs0}px;color:#999;background:#aaa;white-space:nowrap">うすい字</div>' +
      '<button style="position:absolute;left:0;top:${fs0 * 6}px;width:${fs0 * 12}px;height:${fs0 * 2.5}px;font-size:${fs0}px">ボタン上</button>' +
      '<button style="position:absolute;left:0;top:${fs0 * 8.5 + 3}px;width:${fs0 * 12}px;height:${fs0 * 2.5}px;font-size:${fs0}px">ボタン下</button>';
    // 開いた重なり（シート・枠）があれば、その中に置く（重なりの下の字は「隠れている」ので測らない＝正しい振る舞い）
    var tops = [].filter.call(root.querySelectorAll(${JSON.stringify(OPTS[kind].over)}), function (l) { return l.classList.contains('is-open'); });
    (tops.length ? tops[tops.length - 1] : root).appendChild(box);
    // K5：帯の線から 5px 上に札（スマホは中身の層 .v2-in が巻けない画面だけ。巻ける箱の中は帯の測りの外）
    var band = root.querySelector('.v2-band'), inn = root.querySelector(':scope > .v2-in');
    if (${kind === 'phone'} && band && inn && getComputedStyle(inn).overflowY !== 'auto' && getComputedStyle(inn).overflowY !== 'scroll' && band.getBoundingClientRect().height) {
      var B = band.getBoundingClientRect(), I = inn.getBoundingClientRect();
      var f = document.createElement('div'); f.className = 'uicheck-self'; f.textContent = '帯の近くの札';
      f.style.cssText = 'position:absolute;left:150px;top:' + (B.top - I.top - 5 - 30) + 'px;height:30px;width:120px;background:#fff;color:#000;font-size:14px';
      inn.appendChild(f); put.K5 = true;
    }
    // K7：TV の右上に、アプリ全体の浮いた部品（⚙ と同じ所）
    if (${kind === 'tv'}) { var g = document.createElement('button'); g.id = 'uicheck-extra-test'; g.className = 'uicheck-self'; g.textContent = '⚙';
      g.style.cssText = 'position:fixed;top:6px;right:8px;width:44px;height:44px;z-index:999;background:#fff;color:#000'; document.body.appendChild(g); put.K7 = true; }
    return put; })()`);
  let out;
  try { out = await 測る(dev, scene, kind); }
  finally { await dev.ev("(function(){ document.querySelectorAll('.uicheck-self').forEach(function(e){ e.remove(); }); return 1; })()"); }
  const 拾った = (k, t) => out.some((x) => x.kind === k && (x.text === t || x.with === t || x.part === t));
  const r = {
    K1: 拾った('字と字が重なる', 'かさなる字A') || 拾った('字と字が重なる', 'かさなる字B'),
    K2: 拾った('色の差が足りない', 'うすい字'),
    K6: 拾った('ボタンのすき間が狭い', 'ボタン上'),
    K5: 置いた.K5 ? 拾った('下の線に近すぎる', '帯の近くの札') : 'なし',
    K7: 置いた.K7 ? 拾った('TVの安全な枠の外', 'uicheck-extra-test') : 'なし'
  };
  Object.keys(r).forEach((k) => {
    if (r[k] === 'なし') return;
    if (r[k] !== true) throw new Error('新しい物差し ' + k + ' が、わざと壊した見本を拾えません（' + scene.id + '）' + JSON.stringify(out.slice(0, 12)));
    試せた[k]++;
  });
  return r;
}

/**
 * アドレス（.v2-eurl）が、ことばの途中で折れていないか（指示68-0b B12：本番のアドレスが「…duckd／ns.org/tv」と折れていた。
 * check.js は字が切れたわけではないので 0件と言った）。行の頭は、アドレスの頭か「.」「/」の直後だけ
 */
const アドレス = `(function(root){
  var out = [];
  root.querySelectorAll('.v2-eurl').forEach(function(u){
    var w = document.createTreeWalker(u, NodeFilter.SHOW_TEXT), n, chars = [];
    while((n = w.nextNode())) for(var i = 0; i < n.nodeValue.length; i++){
      var rg = document.createRange(); rg.setStart(n, i); rg.setEnd(n, i + 1);
      var b = rg.getClientRects()[0]; if(b && b.width) chars.push({ c: n.nodeValue[i], top: b.top, h: b.height });
    }
    for(var k = 1; k < chars.length; k++){
      if(chars[k].top > chars[k - 1].top + chars[k - 1].h * 0.5 && '.\/'.indexOf(chars[k - 1].c) === -1)
        out.push({ kind: 'アドレスがことばの途中で折れる', text: (u.textContent || '').trim().slice(0, 40), at: k });
    }
  });
  return out;
})`;

/**
 * 字が、外の箱で切れていないか（指示68-0b で足した）。「字が切れている」は字の箱そのものがはみ出す時だけ数えるので、
 * 字の箱が中身の幅まで広がり、さらに外の「はみ出しを隠す」箱（シートなど）で切れた時は 0件と言った（TV に映すアドレス）。
 * 縦に巻ける箱は、縦には巻けば見えるので数えない。ただし**横**は切れる（縦に巻ける箱は横も auto になるが、横には巻かない作り）。
 * 横に巻く作りの箱（overflow-x だけ auto・scroll。チップの列など）は数えない。全部が外にある字（横に送るページの隣など）も数えない
 */
const 外で切れる = `(function(root, closedSel, deco){
  var out = [];
  root.querySelectorAll('*').forEach(function(e){
    if((closedSel && e.closest(closedSel)) || e.closest(deco)) return;
    var t = [].filter.call(e.childNodes, function(n){ return n.nodeType === 3 && n.nodeValue.trim(); });
    if(!t.length) return;
    var cs = getComputedStyle(e); if(cs.visibility === 'hidden' || !e.getClientRects().length || e.closest('.cut-ok,[data-offok]')) return;
    if(cs.textOverflow === 'ellipsis') return;   // 「…」で省く所は「…で切れている」が見る
    var clip = null, cut = function(b){ clip = clip ? { l: Math.max(clip.l, b.left), t: clip.t, r: Math.min(clip.r, b.right), b: clip.b } : { l: b.left, t: -1e9, r: b.right, b: 1e9 }; };
    for(var p = e.parentElement; p; p = p.parentElement){
      var ps = getComputedStyle(p), sy = ps.overflowY === 'auto' || ps.overflowY === 'scroll', sx = ps.overflowX === 'auto' || ps.overflowX === 'scroll';
      // 横に巻く作り（横並びで折り返さない箱・チップの列など）は数えない。縦に巻く箱は横も auto になるので、並べ方で見分ける
      if(sx && ((ps.display.indexOf('flex') !== -1 && ps.flexDirection.indexOf('row') === 0 && ps.flexWrap === 'nowrap') || ps.whiteSpace === 'nowrap')) break;
      if(sx || ps.overflowX === 'hidden' || ps.overflowX === 'clip') cut(p.getBoundingClientRect());
      if(p === root) break;
    }
    if(!clip) return;
    var hit = false;
    t.forEach(function(n){ var rg = document.createRange(); rg.selectNodeContents(n);
      [].forEach.call(rg.getClientRects(), function(r){
        if(!r.width) return;
        var inX = Math.min(r.right, clip.r) - Math.max(r.left, clip.l), inY = Math.min(r.bottom, clip.b) - Math.max(r.top, clip.t);
        if(inX <= 0 || inY <= 0) return;   // 全部が外（隣のページなど）
        if(r.right > clip.r + 2 || r.left < clip.l - 2) hit = true;
      }); });
    if(hit) out.push({ kind: '字が外の箱で切れる', text: (e.textContent || '').trim().slice(0, 30) });
  });
  return out;
})`;

/**
 * 字が、ゲームの印（.v2-tile）に重なっていないか（指示68-0b で足した）。check.js の K1 は字どうししか比べない。
 * TV の決定で、150px の名前が印の白い縁にもぐっていた。字は描かれている所（measureText）で、印は縁の影も入れて比べる
 */
const 字と印 = `(function(root, closedSel, deco, overSel){
  var out = [], g = document.createElement('canvas').getContext('2d');
  // 見えている印だけ（閉じているページの重なりは visibility:hidden のまま並んでいる）
  var seen = function(t){ for(var p = t; p && p !== document.documentElement; p = p.parentElement){ var c = getComputedStyle(p); if(c.display === 'none' || c.visibility === 'hidden' || +c.opacity === 0) return false; } return true; };
  var tiles = [].filter.call(root.querySelectorAll('.v2-tile'), function(t){ return !(closedSel && t.closest(closedSel)) && t.getClientRects().length && seen(t); })
    .map(function(t){ var r = t.getBoundingClientRect(), sh = /0px 0px 0px (\\d+(\\.\\d+)?)px/.exec(getComputedStyle(t).boxShadow || ''), k = sh ? +sh[1] : 0;
      var q = { t: t, l: r.left - k, r: r.right + k, top: r.top - k, b: r.bottom + k };
      // はみ出しを隠す箱（巻ける一覧など）の外の所は見えていない。見えている所だけで比べる
      for(var p = t.parentElement; p && p !== document.documentElement; p = p.parentElement){
        var c = getComputedStyle(p); if(c.overflowX === 'visible' && c.overflowY === 'visible') continue;
        var B = p.getBoundingClientRect(); q.l = Math.max(q.l, B.left); q.r = Math.min(q.r, B.right); q.top = Math.max(q.top, B.top); q.b = Math.min(q.b, B.bottom);
      }
      return q; }).filter(function(q){ return q.r > q.l && q.b > q.top; });
  if(!tiles.length) return out;
  root.querySelectorAll('*').forEach(function(e){
    if((closedSel && e.closest(closedSel)) || e.closest(deco)) return;
    var tn = [].filter.call(e.childNodes, function(n){ return n.nodeType === 3 && n.nodeValue.trim(); }); if(!tn.length) return;
    var cs = getComputedStyle(e); if(cs.visibility === 'hidden' || +cs.opacity === 0) return;
    g.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
    tn.forEach(function(n){
      var m = g.measureText(n.nodeValue.trim()), rg = document.createRange(); rg.selectNodeContents(n);
      [].forEach.call(rg.getClientRects(), function(q){
        if(!q.width) return;
        var k = q.height / ((m.fontBoundingBoxAscent + m.fontBoundingBoxDescent) || q.height), base = q.top + m.fontBoundingBoxAscent * k;
        var y1 = base - m.actualBoundingBoxAscent * k, y2 = base + m.actualBoundingBoxDescent * k, x1 = q.left, x2 = q.right;
        // 字も、はみ出しを隠す箱（巻ける箱）の中で見えている所だけ
        for(var pp = e; pp && pp !== document.documentElement; pp = pp.parentElement){
          var cc = getComputedStyle(pp); if(cc.overflowX === 'visible' && cc.overflowY === 'visible') continue;
          var BB = pp.getBoundingClientRect(); x1 = Math.max(x1, BB.left); x2 = Math.min(x2, BB.right); y1 = Math.max(y1, BB.top); y2 = Math.min(y2, BB.bottom);
        }
        if(x2 <= x1 || y2 <= y1) return;
        tiles.forEach(function(T){
          // 印の中の字・違う重なりの字（開いたシートの字と、その下の印）は比べない
          if(T.t.contains(e) || e.closest(overSel) !== T.t.closest(overSel)) return;
          var ox = Math.min(x2, T.r) - Math.max(x1, T.l), oy = Math.min(y2, T.b) - Math.max(y1, T.top);
          if(ox > 2 && oy > 2) out.push({ kind: '字と印が重なる', text: (e.textContent || '').trim().slice(0, 30), ov: [Math.round(ox), Math.round(oy)] });
        });
      });
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
    // 画面の箱より左に出ているか（TV の大きさで撮るスマホの列は、画面の真ん中にある・指示68-0b K8 ②）
    var 実寸 = b.getBoundingClientRect().left - root.getBoundingClientRect().left;
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

/**
 * 見本にも同じ物差しを当てる（指示68-0b 第1部「check.js に足す物は、見本にも同じに当てる」）。
 * 見本の画面（.scr と .tv で data-id のある物）を1枚ずつ見える所に出して、字を消して撮り、UICHECK を既定のクラス名で当てる。
 * **記録に書くだけで、見本は直さない**（門の数にも入れない）
 */
async function 見本を測る(br) {
  const dev = await br.newDevice('mock-check', { width: 2100, height: 1300, deviceScaleFactor: 1 });
  const 結果 = [];
  try {
    for (const page of ['entry.html', 'select.html', 'festival.html']) {
      await dev.go('file:///' + path.join(MOCK_DIR, page).replace(/\\/g, '/'));
      await dev.until("window.DS && document.fonts.status==='loaded'", 20000, '見本');
      await dev.ev(`(function(){ var b=document.querySelector('[data-fxset="none"]'); if(b) b.click();
        document.documentElement.classList.add('native'); document.querySelectorAll('.frame').forEach(DS.fit); return 1; })()`);
      await dev.ev('(function(){' + CHECK_JS + '; return typeof UICHECK; })()');
      const ids = await dev.ev("[].map.call(document.querySelectorAll('.scr[data-id],.tv[data-id]'), function(e){ return e.getAttribute('data-id'); })");
      for (const id of ids) {
        await dev.ev(`(function(){ var s=document.querySelector('[data-id="${id}"]'); s.scrollIntoView({block:'center'}); s.classList.add('play'); return 1; })()`);
        await sleep(1200);
        await 止まるまで(dev);
        await dev.ev(`(function(){ UICHECK.inkOff(); return 1; })()`);
        await sleep(60);
        const bare = await dev.raw('Page.captureScreenshot', { format: 'png' });
        await dev.ev(`(function(){ UICHECK.inkOn(); return 1; })()`);
        await dev.ev(`UICHECK.loadShot('data:image/png;base64,${bare.data}', 1)`);
        const issues = await dev.ev(`(function(){ var s=document.querySelector('[data-id="${id}"]'); var o=UICHECK(s, { tv: s.classList.contains('tv') }); UICHECK.pix=null; return o; })()`);
        結果.push({ 見本: page + '#' + id, 指摘: issues.length, 中身: issues });
        console.log('見本 ' + page + '#' + id + '  ' + issues.length + ' 件' + (issues.length ? '：' + issues.map((x) => x.kind + '「' + x.text + '」').join(' / ') : ''));
      }
    }
  } finally { await dev.close(); }
  return 結果;
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
  const 記録 = { いつ: new Date().toISOString(), 形: FORMS.map((f) => f.name || (f.fx + '/' + f.font)), 物差し: [], 画面: [], 止まらなかった: [], 見本: [] };
  let 指摘の数 = 0;
  try {
    for (const form of FORMS) {
      const out = form.name ? path.join(OUT, form.name) : OUT;
      fs.mkdirSync(out, { recursive: true });
      for (const scene of SCENES) {
        if (!選ぶ(scene.id)) continue;
        for (const size of sizesOf(scene)) {
          const dev = await br.newDevice(scene.id, { width: size.w, height: size.h, deviceScaleFactor: 1, mobile: size.w < 1000 });
          let 確かめた = false;
          for (const st of statesOf(scene)) {
            const 止まり = await 開く(dev, scene, st, form);
            const name = scene.id + '_' + size.w + 'x' + size.h + '_' + st.id;
            if (!止まり.止まった) { 記録.止まらなかった.push(Object.assign({ 名前: (form.name ? form.name + '/' : '') + name }, 止まり)); console.log('   止まらなかった：' + name + '（' + 止まり.何 + '）'); }
            if (!確かめた) {
              記録.物差し.push({ form: form.name, scene: scene.id, size: size.w + 'x' + size.h,
                結果: await 物差しを確かめる(dev, scene, scene.kind), 新しい物差し: await 新しい物差しを確かめる(dev, scene, scene.kind) });
              確かめた = true;
            }
            const issues = await 測る(dev, scene, scene.kind);
            const file = path.join(out, name + '.png');
            await dev.shot(file);
            記録.画面.push({ 形: form.name, 名前: name, 指摘: issues.length, 参考: !!st.info, 止まるまで: 止まり.ms, 中身: issues });
            if (!st.info) 指摘の数 += issues.length;
            console.log((form.name ? '[' + form.name + '] ' : '') + (st.info ? '（参考）' : '') + (issues.length ? '✖ ' : '✔ ') + name + '  check.js ' + issues.length + ' 件' + (issues.length ? '：' + issues.map((x) => x.kind + '「' + x.text + '」').join(' / ') : ''));
            if (logsOf(dev).length) console.log('   ページの例外:', logsOf(dev).join(' | '));
          }
          await dev.close();
        }
      }
    }
    // 自己検査：K5 と K7 は場面によって試せない。全体で1回も試せなかった物差しがあれば、門に使えない
    if (!ONLY_LIST) Object.keys(試せた).forEach((k) => { if (!試せた[k]) throw new Error('新しい物差し ' + k + ' を1回も試せませんでした'); });
    記録.試せた = 試せた;
    if (MOCK_CHECK) 記録.見本 = await 見本を測る(br);
    if (MOCK) {
      const dev = await br.newDevice('mock', { width: 2100, height: 1300, deviceScaleFactor: 1 });
      for (const scene of SCENES) {
        if (!選ぶ(scene.id)) continue;
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
  if (記録.止まらなかった.length) console.log('✖ 動きが止まらなかった写真 ' + 記録.止まらなかった.length + ' 枚（記録.json の 止まらなかった）');
  if (MOCK_CHECK) console.log('見本の指摘（記録だけ・見本は直さない）：' + 記録.見本.reduce((a, x) => a + x.指摘, 0) + ' 件（' + 記録.見本.length + ' 枚）');
  console.log((指摘の数 ? '✖ ' : '✔ ') + 'check.js の指摘 合計 ' + 指摘の数 + ' 件（' + 記録.画面.length + ' 枚）。写真と記録：' + path.relative(ROOT, OUT));
  process.exitCode = 指摘の数 || 記録.止まらなかった.length ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(2); });

function logsOf(dev) { const l = dev.logs.slice(); dev.logs.length = 0; return l; }
