#!/usr/bin/env node
// tools/v2-regress.js — 新しい見た目を入れても、古い画面が1つも変わっていないか（指示66-1 門1）
//
//   git worktree add ../aresore-66base 4d55f88      … 入れかえ前を別の作業ツリーに出しておく
//   node tools/v2-regress.js --base ../aresore-66base
//   --out DIR（既定 docs/監査_指示66の画像/regress）  --port 3970（と +1） --cdp 9670
//
// 入れかえ前（--base の public/）と今（このリポジトリの public/）を、同じ Chrome・同じ手順で撮り、画素で比べる。
// 撮るもの：
//   ① スマホ 390×844：古い画面ぜんぶ（index.html の .screen のうち scr-v2- 以外）。window.goToScreen で入る
//   ② スマホ 390×844：設定（⚙）を開いた入口
//   ③ TV 1920×1080・1280×720：部屋の待合（6人。本物の部屋の箱の公開スナップショットを疑似 socket で流す）
// 動きは止めて撮る（*{animation:none;transition:none} を差し込む。両方に同じことをする）。
// **雑音を先に測る**：入れかえ前を2回撮り、それだけで変わる画面（時計・乱数を出す画面）は「比べられない」として別に出す。

const fs = require('fs');
const path = require('path');
const { launch, sleep } = require('./cdp');
const { 配り手, ROOT } = require('./v2-lab/open');
const { 部屋を作る, スナップ } = require('./big-lab-scenes');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : argv[i + 1]; };
const BASE = arg('base', null);
if (!BASE) { console.error('--base（入れかえ前の作業ツリー）を渡してください'); process.exit(2); }
const PORT = +arg('port', 3970), CDP = +arg('cdp', 9670);
const OUT = path.resolve(arg('out', path.join(ROOT, 'docs', '監査_指示66の画像', 'regress')));
const 止める = "(function(){ var s=document.createElement('style'); s.textContent='*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important} html,body{scrollbar-width:none!important} ::-webkit-scrollbar{display:none!important}'; document.head.appendChild(s); return 1; })()";

/**
 * 撮る時だけ、ページの乱数を種つきにする（棚の下のあいさつの一言などは、くじで選ぶ——入れかえ前どうしでも毎回ちがった）。
 * 入れかえ前と今に同じ種を入れるので、同じくじが出る。アプリの中身は変えない
 */
async function 乱数を止める(dev) {
  await dev.raw('Page.addScriptToEvaluateOnNewDocument', { source:
    '(function(){ var s = 20261023; Math.random = function(){ s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; })();' });
}
async function 入口まで(dev, port) {
  await dev.go('http://127.0.0.1:' + port + '/');
  await dev.ev("(function(){ localStorage.clear(); localStorage.setItem('acac-safety-seen','1'); return 1; })()");
  await dev.go('http://127.0.0.1:' + port + '/');
  await dev.until("(document.querySelector('.screen.active')||{}).id && document.querySelector('.screen.active').id !== 'scr-door'", 10000, '扉');
  await dev.until("document.fonts.status==='loaded'", 15000, '書体');
  await dev.ev(止める);
}
async function 撮る(dev) { const r = await dev.raw('Page.captureScreenshot', { format: 'png' }); return r.data; }
const 違う = `async function(a, b){
  async function px(src){ var im = new Image(); im.src = 'data:image/png;base64,' + src; await im.decode();
    var c = document.createElement('canvas'); c.width = im.width; c.height = im.height; var g = c.getContext('2d'); g.drawImage(im, 0, 0);
    return { d: g.getImageData(0, 0, im.width, im.height).data, w: im.width, h: im.height }; }
  var A = await px(a), B = await px(b); if (A.w !== B.w || A.h !== B.h) return -1;
  var n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  // 明るさの差が 8 段を超える画素だけ数える（絵文字の縁のにじみ＝4段ほどは描画のゆれ。目では区別できない）
  for (var i = 0; i < A.d.length; i += 4) if (Math.abs(A.d[i] - B.d[i]) > 8 || Math.abs(A.d[i+1] - B.d[i+1]) > 8 || Math.abs(A.d[i+2] - B.d[i+2]) > 8) {
    n++; var p = i / 4, x = p % A.w, y = (p - x) / A.w; if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  return n ? n + ' 画素・場所 ' + x0 + ',' + y0 + '〜' + x1 + ',' + y1 : 0;
}`;

/** 1つの public/ で、決まった順に全部撮る。返り値：{ 名前: base64 } */
async function 全部撮る(br, port, 名) {
  const out = {};
  const dev = await br.newDevice(名, { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await 乱数を止める(dev);
  await 入口まで(dev, port);
  const ids = await dev.ev("[...document.querySelectorAll('.screen')].map(function(s){ return s.id; }).filter(function(id){ return id && id.indexOf('scr-v2-') !== 0; })");
  for (const id of ids) {
    await dev.ev('(function(){ try{ window.goToScreen(' + JSON.stringify(id) + '); }catch(e){} window.scrollTo(0,0); return 1; })()');
    // 入った時に一瞬だけ出る合図（はずれの光など）が消えてから撮る
    await sleep(600);
    out['phone_' + id] = await 撮る(dev);
  }
  // 設定（⚙）を開いた入口
  await 入口まで(dev, port);
  await dev.ev("(function(){ var b=document.getElementById('floatingGearBtn')||document.getElementById('gearBtn'); if(b) b.click(); return !!b; })()");
  await sleep(300);
  out['phone_settings'] = await 撮る(dev);
  await dev.close();
  // TV：部屋の待合（大画面として入り、本物の公開スナップショットを流す。tools/big-lab.js と同じ入り方）
  for (const size of [{ w: 1920, h: 1080 }, { w: 1280, h: 720 }]) {
    const tv = await br.newDevice(名 + 'tv' + size.w, { width: size.w, height: size.h, deviceScaleFactor: 1, mobile: false });
    await 乱数を止める(tv);
    await tv.go('http://127.0.0.1:' + port + '/');
    await tv.ev("(function(){ localStorage.clear(); return 1; })()");
    await tv.go('http://127.0.0.1:' + port + '/');
    await tv.until("document.getElementById('safetyGate') && window.__rtFake", 10000, '安全の案内');
    await tv.click('#sgStartBtn');
    await tv.until("(document.querySelector('.screen.active')||{}).id === 'scr-entry'", 10000, '入口');
    await tv.click('[data-entry="big"]');
    await tv.until("(document.querySelector('.screen.active')||{}).id === 'scr-rt-lobby'", 10000, '部屋の入口');
    const snap = スナップ(部屋を作る(6));
    // 返事は丸ごと置く（tools/big-lab.js と同じ。replies は始めは無い）
    await tv.ev(`(function(){ var R = ${JSON.stringify(snap)}; window.__rtFake.replies = { 'room:join': function(){ return { ok:true, code:R.code, memberId:'tv', room:R }; } };
      document.getElementById('rtJoinCode').value = ${JSON.stringify(snap.code)}; document.getElementById('rtJoinName').value = 'テレビ';
      document.getElementById('rtJoinBtn').click(); return 1; })()`);
    await tv.until("(document.querySelector('.screen.active')||{}).id === 'scr-rt-big'", 10000, '大画面');
    await tv.ev('(function(){ window.__rtFake.fire("room:update", ' + JSON.stringify(snap) + '); return 1; })()');
    await tv.until("document.fonts.status==='loaded'", 15000, '書体');
    await sleep(900);
    await tv.ev(止める);
    await sleep(300);
    out['tv' + size.w + '_scr-rt-big_lobby'] = await 撮る(tv);
    await tv.close();
  }
  return out;
}

(async () => {
  const baseDir = path.resolve(BASE, 'public');
  if (!fs.existsSync(path.join(baseDir, 'index.html'))) throw new Error('入れかえ前の public/ が見つかりません: ' + baseDir);
  fs.mkdirSync(OUT, { recursive: true });
  // **入れかえ前と今は、同じポートで順に配る**——QR に入る URL にポートが入るので、別のポートだと QR だけ違って見える（最初の版で踏んだ）
  const br = await launch({ port: CDP });
  const 表 = [];
  try {
    let sv = await 配り手(PORT, baseDir);
    const 前1 = await 全部撮る(br, PORT, 'base1');
    const 前2 = await 全部撮る(br, PORT, 'base2');
    await new Promise((r) => sv.close(r));
    sv = await 配り手(PORT);
    const 今 = await 全部撮る(br, PORT, 'now');
    sv.close();
    const cmp = await br.newDevice('cmp', { width: 200, height: 200, deviceScaleFactor: 1 });
    await cmp.go('about:blank');
    const names = Object.keys(前1);
    for (const n of names) {
      if (!今[n]) { 表.push({ 名前: n, 結果: '今は無い' }); continue; }
      const 雑音 = await cmp.ev(`(${違う})(${JSON.stringify(前1[n])}, ${JSON.stringify(前2[n])})`);
      const 差 = await cmp.ev(`(${違う})(${JSON.stringify(前1[n])}, ${JSON.stringify(今[n])})`);
      const 結果 = 雑音 !== 0 ? '比べられない（入れかえ前どうしで ' + 雑音 + '）' : (差 === 0 ? '同じ' : '変わった（' + 差 + '）');
      表.push({ 名前: n, 結果 });
      if (差 !== 0 || 雑音 !== 0) {
        fs.writeFileSync(path.join(OUT, n + '_前.png'), Buffer.from(前1[n], 'base64'));
        fs.writeFileSync(path.join(OUT, n + '_今.png'), Buffer.from(今[n], 'base64'));
      }
    }
    Object.keys(今).filter((n) => !前1[n]).forEach((n) => 表.push({ 名前: n, 結果: '今だけにある' }));
    // ---- 再確認：差や雑音が出たスマホの画面だけ、ページを開き直してその画面に**直接**入る ----
    // 続けて回すと、前の画面のタイマー（数え読み・手渡しの幕）が次の画面に出て、順番と待ち時間で写りが変わる。
    // 開き直せば前の画面の名残りは無い。入れかえ前2回（雑音）と今1回で、もう一度比べる
    const 疑い = 表.filter((x) => x.名前.indexOf('phone_scr-') === 0 && x.結果 !== '同じ');
    const 単独 = async (port, id) => {
      const dev = await br.newDevice('one', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      await 乱数を止める(dev);
      await 入口まで(dev, port);
      await dev.ev('(function(){ try{ window.goToScreen(' + JSON.stringify(id) + '); }catch(e){} window.scrollTo(0,0); return 1; })()');
      await sleep(600);
      const s = await 撮る(dev); await dev.close(); return s;
    };
    for (const x of 疑い) {
      const id = x.名前.slice('phone_'.length);
      let sv2 = await 配り手(PORT, baseDir);
      const a1 = await 単独(PORT, id), a2 = await 単独(PORT, id);
      await new Promise((r) => sv2.close(r));
      sv2 = await 配り手(PORT);
      const b1 = await 単独(PORT, id);
      await new Promise((r) => sv2.close(r));
      const 雑音 = await cmp.ev(`(${違う})(${JSON.stringify(a1)}, ${JSON.stringify(a2)})`);
      const 差 = await cmp.ev(`(${違う})(${JSON.stringify(a1)}, ${JSON.stringify(b1)})`);
      x.続けて回した時 = x.結果;
      x.結果 = 雑音 !== 0 ? '比べられない（開き直しても、入れかえ前どうしで ' + 雑音 + '）' : (差 === 0 ? '同じ' : '変わった（' + 差 + '）');
      x.再確認 = true;
      if (差 !== 0 || 雑音 !== 0) {
        fs.writeFileSync(path.join(OUT, x.名前 + '_単独_前.png'), Buffer.from(a1, 'base64'));
        fs.writeFileSync(path.join(OUT, x.名前 + '_単独_今.png'), Buffer.from(b1, 'base64'));
      }
      console.log('  再確認 ' + x.名前 + '：' + x.結果 + '（続けて回した時は ' + x.続けて回した時 + '）');
    }
    await cmp.close();
  } finally {
    await br.close();
  }
  fs.writeFileSync(path.join(OUT, '記録.json'), JSON.stringify(表, null, 1));
  const 同じ = 表.filter((x) => x.結果 === '同じ').length;
  const 変わった = 表.filter((x) => /^変わった|今は無い|今だけ/.test(x.結果));
  const 比べられない = 表.filter((x) => /^比べられない/.test(x.結果));
  変わった.concat(比べられない).forEach((x) => console.log('  ' + x.名前 + '：' + x.結果));
  console.log((変わった.length ? '✖ ' : '✔ ') + '古い画面 ' + 表.length + ' 枚：同じ ' + 同じ + '・変わった ' + 変わった.length + '・比べられない ' + 比べられない.length + '（記録：' + path.relative(ROOT, OUT) + '）');
  process.exitCode = 変わった.length ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(2); });
