#!/usr/bin/env node
// tools/qnear-keys-shot.js — 数字ちかい方のスマホで、長い問題（4行）でも数字のキーと「決定」が見えて押せるかを撮って測る（指示78 エ-2 のあと）
//
//   node tools/qnear-keys-shot.js --out DIR [--sizes 375x667,390x844] [--q "問題文1|問題文2"]
//
// 見本の場面 qn-guess（数字を入れる画面）・qn-open（開いた画面）を開き、問題文だけを差しかえて描き直す（V2Screens.v2game）。
// --q が無ければ、いまの quiz-tables.js の数字ちかい方から長い順に8問と、沖縄本島・北海道本島・四万十川。
// 測る物：
//   ・数字のキー10個・「けす」・「決定」が、画面（innerWidth×innerHeight）の中に全部入っていて、真ん中を押すとそのキーに当たる（ほかの物の下にない）
//   ・ページがスクロールしない（画面より長くない）
//   ・問題文の箱が、ほかの物（キー・数字の窓・時計・帯・答えの列）と重ならない
// 1件でもあれば終了コード 1。写真は DIR/<大きさ>_<場面>_<番号>.png
const path = require('path');
const fs = require('fs');
const { launch, sleep } = require('./cdp');
const { 配り手, 開く } = require('./v2-lab/open');
const { SCENES } = require('./v2-lab/scenes');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const OUT = path.resolve(arg('out', path.join(__dirname, '..', '..', '検査_1107_証拠', '監査_全画面', '指示78', 'qnear-keys')));
const SIZES = String(arg('sizes', '375x667,390x844')).split(',').map((s) => { const m = /^(\d+)x(\d+)$/.exec(s); return { w: +m[1], h: +m[2] }; });
const T = require('../public/js/quiz-tables.js').number;
const 名指し = ['沖縄本島', '北海道本島', '四万十川'];
const LIST = arg('q', null) ? String(arg('q')).split('|').map((t) => T.find((x) => x.q === t) || { q: t, unit: '' })
  : T.slice().sort((a, b) => b.q.length - a.q.length).slice(0, 8).concat(名指し.map((n) => T.find((x) => x.q.indexOf(n) === 0)).filter(Boolean));

const 測る = `function(q, unit, open){
  var view = JSON.parse(JSON.stringify(window.__V2LAB_VIEW));
  view.room.state.data.topic = Object.assign({}, view.room.state.data.topic, { q: q, unit: unit });
  if (view.room.state.data.reveal) view.room.state.data.reveal = Object.assign({}, view.room.state.data.reveal, { q: q, unit: unit });   // 開いた画面は reveal の問題文を出す
  window.V2Screens.v2game(view);
  var s = document.querySelector('.screen.active'); V2.relayout(s);
  var W = innerWidth, H = innerHeight, bad = [];
  function vis(e){ var r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; }
  var keys = [].slice.call(s.querySelectorAll('[data-qn-key],[data-qn-go]')).filter(vis);
  if (!open) {
    var names = keys.map(function(k){ return k.getAttribute('data-qn-key') || 'go'; });
    ['0','1','2','3','4','5','6','7','8','9','del','go'].forEach(function(n){ if (names.indexOf(n) === -1) bad.push('キーが無い：' + n); });
    keys.forEach(function(k){
      var r = k.getBoundingClientRect(), n = k.getAttribute('data-qn-key') || '決定';
      if (r.left < -0.5 || r.top < -0.5 || r.right > W + 0.5 || r.bottom > H + 0.5) bad.push('キー「' + n + '」が画面の外（' + Math.round(r.top) + '〜' + Math.round(r.bottom) + ' / ' + H + '）');
      var hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!hit || !(hit === k || k.contains(hit))) bad.push('キー「' + n + '」の上にほかの物（' + (hit ? hit.className || hit.tagName : 'なし') + '）');
    });
  }
  var se = document.scrollingElement; if (se.scrollHeight > H + 1) bad.push('ページが画面より長い（' + se.scrollHeight + ' > ' + H + '）');
  var qel = s.querySelector('[data-v2-wrap]');
  if (qel.textContent !== q) bad.push('差しかえた問題文が出ていない（' + qel.textContent.slice(0, 12) + '…）');   // 道具の自己検査
  var qr = qel.getBoundingClientRect();
  if (qr.bottom > H + 0.5 || qr.top < -0.5) bad.push('問題文が画面の外');
  var others = [].slice.call(s.querySelectorAll('button, .v2-q2disp, .v2-cd, .v2-band, .v2-tband, .v2-q2ans, .v2-q2row, .v2-rk, .v2-sheet.is-open, .v2-q2bar')).filter(function(e){ return vis(e) && !e.contains(qel) && !qel.contains(e); });
  others.forEach(function(e){
    var r = e.getBoundingClientRect();
    var ix = Math.min(r.right, qr.right) - Math.max(r.left, qr.left), iy = Math.min(r.bottom, qr.bottom) - Math.max(r.top, qr.top);
    if (ix > 1 && iy > 1) bad.push('問題文が「' + (e.className || e.tagName) + '」に重なる（' + Math.round(ix) + '×' + Math.round(iy) + '）');
  });
  var lines = Math.round(qr.height / parseFloat(getComputedStyle(qel).lineHeight || 20));
  var kb = keys.length ? Math.max.apply(null, keys.map(function(k){ return k.getBoundingClientRect().bottom; })) : null;
  return { bad: bad, qTop: Math.round(qr.top), qBottom: Math.round(qr.bottom), keysBottom: kb == null ? null : Math.round(kb), H: H, keys: keys.length };
}`;

(async () => {
  const srv = await 配り手(3994); const b = await launch({ port: 9694 });
  const 記録 = []; let 悪い = 0;
  try {
    for (const sz of SIZES) {
      const dev = await b.newDevice('qk', { width: sz.w, height: sz.h, mobile: true, deviceScaleFactor: 2 });
      for (const id of ['qn-guess', 'qn-open']) {
        await 開く(dev, 3994, SCENES.find((s) => s.id === id), { freeze: 20 });
        for (let i = 0; i < LIST.length; i++) {
          const m = await dev.ev('(' + 測る + ')(' + JSON.stringify(LIST[i].q) + ',' + JSON.stringify(LIST[i].unit || '') + ',' + (id === 'qn-open') + ')');
          await sleep(150);
          const file = sz.w + 'x' + sz.h + '_' + id + '_' + String(i + 1).padStart(2, '0') + '.png';
          fs.mkdirSync(OUT, { recursive: true });
          await dev.shot(path.join(OUT, file));
          記録.push(Object.assign({ size: sz.w + 'x' + sz.h, scene: id, q: LIST[i].q, file }, m));
          if (m.bad.length) 悪い++;
          console.log((m.bad.length ? '✖ ' : '✔ ') + sz.w + 'x' + sz.h + ' ' + id + ' ' + LIST[i].q.slice(0, 24) + '…　問題 ' + m.qTop + '〜' + m.qBottom + (m.keysBottom != null ? '・キーの下 ' + m.keysBottom + '/' + m.H + '（' + m.keys + '個）' : '') + (m.bad.length ? '　' + m.bad.join('・') : ''));
        }
      }
      await dev.close();
    }
  } finally { await b.close(); srv.close(); }
  fs.writeFileSync(path.join(OUT, '記録.json'), JSON.stringify(記録, null, 1));
  console.log('\n' + 記録.length + ' 枚・悪い ' + 悪い + ' 件 → ' + OUT);
  process.exit(悪い ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
