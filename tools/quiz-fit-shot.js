#!/usr/bin/env node
// tools/quiz-fit-shot.js — 指示77 束3 の門：直した問題が、TV の早答え（1920×1080・答えている間）で2行に収まり、選択肢が1行に収まるかを撮って測る
//
//   node tools/quiz-fit-shot.js --q "問題文1|問題文2" --out DIR      … 問題は quiz-bank.js の文で探す（無ければ止まる）
//   --size 1920x1080（スマホは 390x844 でも測れる：その時は答える画面）
//
// 見本の部屋は tools/v2-lab/quiz2-scenes.js の早答え（本物の進行役 qhaya-room.js）で作り、1問目をその問題に差しかえる。
// 行の数は、問題文の箱の高さ ÷ 計算した行の高さ。選択肢は字の箱の高さ（1行より高ければ折れている）と、はみ出し（scrollWidth）
const path = require('path');
const { launch, sleep } = require('./cdp');
const { 配り手, 開く } = require('./v2-lab/open');
const { SCENES } = require('./v2-lab/scenes');
const S = require('./v2-lab/quiz2-scenes');
const QHaya = require('../qhaya-room');
const Q = require('../public/js/quiz-bank');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : argv[i + 1]; };
const LIST = String(arg('q', '')).split('|').map((s) => s.trim()).filter(Boolean);
const OUT = path.resolve(arg('out', path.join(__dirname, '..', 'docs', '検査_1107', '写真', 'quiz-fit')));
const SZ = /^(\d+)x(\d+)$/.exec(arg('size', '1920x1080'));
const TV = +SZ[1] >= 1000;
const all = []; Q.TIERS.forEach((t) => Q.questionsOf(t).forEach((q) => all.push(Object.assign({ tier: t }, q))));

(async () => {
  const srv = await 配り手(3993); const b = await launch({ port: 9693 });
  const ng = [];
  try {
    const dev = await b.newDevice('fit', TV ? { width: +SZ[1], height: +SZ[2], mobile: false, deviceScaleFactor: 1 } : { width: +SZ[1], height: +SZ[2], mobile: true, deviceScaleFactor: 2 });
    await 開く(dev, 3993, SCENES.find((s) => s.id === (TV ? 'qh-tv-choose' : 'qh-choose')), { freeze: 20 });
    for (let i = 0; i < LIST.length; i++) {
      const hit = all.find((q) => q.q === LIST[i]);
      if (!hit) { ng.push('問題が無い：' + LIST[i]); continue; }
      const r = S.早答え(6, 0); const w = r.qhaya;
      w.qs[w.round] = Object.assign({}, w.qs[w.round], { q: hit.q, choices: hit.choices.slice(), correct: 0, tier: hit.tier });
      const data = JSON.parse(JSON.stringify(QHaya.publicView(r)));
      if (!data.topic || data.topic.q !== hit.q) { ng.push('差しかえられない：' + hit.q); continue; }
      const m = await dev.ev(`(function(data, tv){ var s=document.querySelector('.screen.active');
        s.innerHTML = tv ? V2Quiz2.haya.tv({ data: data, members: [], meId: 'tv', you: {}, fes: null, end: Date.now() + 8000 })
                         : V2Quiz2.haya.phone({ data: data, members: [], meId: 'm1', you: {}, fes: null, end: Date.now() + 8000 });
        V2.fitTv(s); V2.relayout(s);
        var q = s.querySelector('[data-v2-wrap]'), cs = getComputedStyle(q), lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
        var rg = document.createRange(); rg.selectNodeContents(q); var rects = [].slice.call(rg.getClientRects()); var tops = {}; rects.forEach(function(x){ if (x.width > 1) tops[Math.round(x.top / 4)] = 1; });
        var ch = [].slice.call(s.querySelectorAll('[data-v2-wrap]')).slice(1).map(function(c){ var r2 = document.createRange(); r2.selectNodeContents(c); var t2 = {}; [].slice.call(r2.getClientRects()).forEach(function(x){ if (x.width > 1) t2[Math.round(x.top / 4)] = 1; }); return { t: c.textContent, lines: Object.keys(t2).length, over: c.scrollWidth > c.clientWidth + 1 }; });
        return { qLines: Object.keys(tops).length, ch: ch }; })(${JSON.stringify(data)}, ${TV})`);
      await sleep(250);
      const file = path.join(OUT, (TV ? 'tv' : 'phone') + '_' + String(i + 1).padStart(2, '0') + '.png');
      await dev.shot(file);
      const bad = m.qLines > 2 || m.ch.some((c) => c.lines > 1 || c.over);
      if (bad) ng.push(hit.q + '：問題 ' + m.qLines + '行・選択肢 ' + m.ch.map((c) => c.t + '=' + c.lines + '行' + (c.over ? '（はみ出し）' : '')).join('／'));
      console.log((bad ? '✖ ' : '✔ ') + '問題 ' + m.qLines + '行・選択肢 ' + m.ch.map((c) => c.lines).join('/') + '行　' + hit.q + '　→ ' + path.basename(file));
    }
  } finally { await b.close(); srv.close(); }
  console.log(ng.length ? '\n✖ ' + ng.length + '件\n  ' + ng.join('\n  ') : '\n✓ どれも問題は2行まで・選択肢は1行（' + OUT + '）');
  process.exit(ng.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
