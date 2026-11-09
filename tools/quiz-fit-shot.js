#!/usr/bin/env node
// tools/quiz-fit-shot.js — TV の早答え（1920×1080・答えている間）で、問題文と選択肢の折れ方を測る（指示77 束3・11/9 の答え 5）
//
//   node tools/quiz-fit-shot.js --all --out DIR              … 3択・4択の問題を全部（数を出す・悪い物は写真）。--choices 4 で4択だけ
//   node tools/quiz-fit-shot.js --q "問題文1|問題文2" --out DIR  … この問題だけ（全部写真）
//   --size 1920x1080（スマホは 390x844：答える画面）  --shots 30（--all で撮る悪い物の数）
//   --near：数字ちかい方（表から作った問題・選択肢なし）。--q が無ければ、読み（yomi）を添えた問題を全部（指示77 5-1）
//
// 決まり（くまくん 11/9）：問題文は2行まで・選択肢は2行まで。どちらも
//   ① 言葉の途中で折れない（折れる所は文節＝BudouX の切れ目だけ）
//   ② 最後の行が1〜2字だけにならない
//   ③ 行の頭に「、」「。」などが来ない
// 行は字ごとの箱の高さで分ける（Range を1字ずつ）。文節は画面と同じ BudouxJa.parse
//
// 見本の部屋は tools/v2-lab/quiz2-scenes.js の早答え（本物の進行役 qhaya-room.js）で作り、いまの問題をその問題に差しかえる
const path = require('path');
const { launch, sleep } = require('./cdp');
const { 配り手, 開く } = require('./v2-lab/open');
const { SCENES } = require('./v2-lab/scenes');
const S = require('./v2-lab/quiz2-scenes');
const QHaya = require('../qhaya-room');
const QNear = require('../qnear-room');
const Q = require('../public/js/quiz-bank');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const ALL = !!arg('all', false);
const NEAR = !!arg('near', false);
const OUT = path.resolve(arg('out', path.join(__dirname, '..', 'docs', '検査_1107', '写真', 'quiz-fit')));
const SZ = /^(\d+)x(\d+)$/.exec(arg('size', '1920x1080'));
const TV = +SZ[1] >= 1000;
const SHOTS = +arg('shots', 30);
const all = []; Q.TIERS.forEach((t) => Q.questionsOf(t).forEach((q) => all.push(Object.assign({ tier: t }, q))));
const 表の数 = require('../public/js/quiz-tables.js').number;
const LIST = NEAR ? (arg('q', null) ? String(arg('q')).split('|').map((t) => 表の数.find((q) => q.q === t) || { missing: t }) : 表の数.filter((q) => /（[ぁ-ゖー]+）/.test(q.q)))
  : ALL ? all.filter((q) => !arg('choices', null) || q.choices.length === +arg('choices')) : String(arg('q', '')).split('|').map((s) => s.trim()).filter(Boolean).map((t) => all.find((q) => q.q === t) || { missing: t });

// ページの中：字ごとの行・文節の切れ目から、3つの決まりを見る
const 測る = `function(data, tv){
  var s = document.querySelector('.screen.active');
  var G = data.__near ? V2Quiz2.near : V2Quiz2.haya;
  s.innerHTML = tv ? G.tv({ data: data, members: [], meId: 'tv', you: {}, fes: null, end: Date.now() + 8000 })
                   : G.phone({ data: data, members: [], meId: 'm1', you: {}, fes: null, end: Date.now() + 8000 });
  V2.fitTv(s); V2.relayout(s);
  var 頭NG = /^[、。，．」』）！？ー…・]/;
  function 見る(el){
    var text = el.textContent, chars = [], walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), n;
    while ((n = walker.nextNode())) for (var i = 0; i < n.data.length; i++) {
      var rg = document.createRange(); rg.setStart(n, i); rg.setEnd(n, i + 1);
      var rs = rg.getClientRects(); if (!rs.length) continue;
      chars.push({ c: n.data[i], top: rs[0].top, h: rs[0].height });
    }
    var lines = [], cur = null;
    chars.forEach(function(x, k){ if (!cur || x.top > cur.top + cur.h * 0.5) { cur = { top: x.top, h: x.h, from: k, s: '' }; lines.push(cur); } cur.s += x.c; });
    var parts = (window.BudouxJa && BudouxJa.parse) ? BudouxJa.parse(text) : [text], cut = {}, at = 0;
    parts.forEach(function(p){ at += p.length; cut[at] = 1; });
    var 途中 = lines.slice(1).some(function(l){ return !cut[l.from] && !/[・＝]/.test(text[l.from - 1] || ''); });   // 「・」「＝」のすぐあと（名前の区切り）はよい
    var 短い = lines.length >= 2 && lines[lines.length - 1].s.replace(/\\s/g, '').length <= 2;
    var 頭 = lines.slice(1).some(function(l){ return 頭NG.test(l.s); });
    return { t: text, lines: lines.map(function(l){ return l.s; }), 途中: 途中, 短い: 短い, 頭: 頭, fs: parseFloat(getComputedStyle(el).fontSize) };
  }
  var els = [].slice.call(s.querySelectorAll('[data-v2-wrap]'));
  return { q: 見る(els[0]), ch: els.slice(1).map(見る) };
}`;

(async () => {
  const srv = await 配り手(3993); const b = await launch({ port: 9693 });
  const 数 = { 問題: 0, 選択肢: 0, 問題3行: 0, 選択肢3行: 0, 途中: 0, 短い: 0, 頭: 0 }, 悪い = [];
  let 撮った = 0;
  try {
    const dev = await b.newDevice('fit', TV ? { width: +SZ[1], height: +SZ[2], mobile: false, deviceScaleFactor: 1 } : { width: +SZ[1], height: +SZ[2], mobile: true, deviceScaleFactor: 2 });
    await 開く(dev, 3993, SCENES.find((s) => s.id === (NEAR ? (TV ? 'qn-tv-guess' : 'qn-guess') : (TV ? 'qh-tv-choose' : 'qh-choose'))), { freeze: 20 });
    for (let i = 0; i < LIST.length; i++) {
      const hit = LIST[i];
      if (hit.missing) { 悪い.push({ q: hit.missing, why: ['問題が無い'] }); continue; }
      let data;
      if (NEAR) {
        const r = S.数字(6, 0); const w = r.qnear;
        w.qs[w.round] = Object.assign({}, w.qs[w.round], { q: hit.q, answer: hit.answer, unit: hit.unit, tier: hit.tier });
        data = Object.assign(JSON.parse(JSON.stringify(QNear.publicView(r))), { __near: true });
      } else {
        const r = S.早答え(6, 0); const w = r.qhaya;
        w.qs[w.round] = Object.assign({}, w.qs[w.round], { q: hit.q, choices: hit.choices.slice(), correct: 0, tier: hit.tier });
        data = JSON.parse(JSON.stringify(QHaya.publicView(r)));
      }
      const m = await dev.ev('(' + 測る + ')(' + JSON.stringify(data) + ',' + TV + ')');
      数.問題++; 数.選択肢 += m.ch.length;
      const why = [];
      if (m.q.lines.length > 2) { 数.問題3行++; why.push('問題 ' + m.q.lines.length + '行'); }
      [m.q].concat(m.ch).forEach((x, k) => {
        const 名 = k ? '選択肢「' + x.t + '」' : '問題';
        if (k && x.lines.length > 2) { 数.選択肢3行++; why.push(名 + ' ' + x.lines.length + '行'); }
        if (x.途中) { 数.途中++; why.push(名 + ' 言葉の途中で折れる（' + x.lines.join('／') + '）'); }
        if (x.短い) { 数.短い++; why.push(名 + ' 最後の行が短い（' + x.lines.join('／') + '）'); }
        if (x.頭) { 数.頭++; why.push(名 + ' 行の頭が「、」など（' + x.lines.join('／') + '）'); }
      });
      const 撮る = !ALL || (why.length && 撮った < SHOTS);
      let file = '';
      if (撮る) { 撮った++; await sleep(150); file = (TV ? 'tv' : 'phone') + '_' + String(i + 1).padStart(3, '0') + '.png'; await dev.shot(path.join(OUT, file)); }
      if (why.length) 悪い.push({ q: hit.q, tier: hit.tier, why, file });
      if (!ALL) console.log((why.length ? '✖ ' : '✔ ') + hit.q + '　問題 ' + m.q.lines.join('／') + '　選択肢 ' + m.ch.map((x) => x.lines.join('／')).join('｜') + (file ? '　→ ' + file : ''));
    }
  } finally { await b.close(); srv.close(); }
  console.log('\n問題 ' + 数.問題 + '・選択肢 ' + 数.選択肢 + '：問題が3行以上 ' + 数.問題3行 + '・選択肢が3行以上 ' + 数.選択肢3行 + '・言葉の途中で折れる ' + 数.途中 + '・最後の行が1〜2字 ' + 数.短い + '・行の頭が「、」など ' + 数.頭);
  if (ALL) 悪い.slice(0, 80).forEach((x) => console.log('  ' + x.q + '（' + x.tier + '）：' + x.why.join('・') + (x.file ? '　→ ' + x.file : '')));
  require('fs').mkdirSync(OUT, { recursive: true });
  require('fs').writeFileSync(path.join(OUT, '記録.json'), JSON.stringify({ 数, 悪い }, null, 1));
  process.exit(悪い.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
