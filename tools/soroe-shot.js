#!/usr/bin/env node
// tools/soroe-shot.js — そろえて発射の全場面を、TV（1920×1080）とスマホ（390×844）で撮る（指示75 2-7 の門）
//
//   node tools/dev-server.js（PORT=3471）を立ててから：
//   node tools/soroe-shot.js [--base http://127.0.0.1:3471] [--out docs/検査_1107/写真/soroe75]
//
// 場面は見本データ（tools/v2-lab/button-scenes.js の so-…・本物の進行役で作る）。/v2lab で開いて撮るだけ（サーバーも bot も要らない）。
// 撮るたびに測る：TV の ⚙・縦のロゴ・「今日の最高」・長い文の有無、旗と「宇宙」の札の重なり、スマホのはみ出し（ページが画面より長い）。
// 記録は OUT/記録.json。写真は git に入れない（docs/検査_1107/写真/）
'use strict';

const fs = require('fs');
const path = require('path');
const { launch, sleep } = require('./cdp');
const { SCENES } = require('./v2-lab/button-scenes');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : argv[i + 1]; };
const BASE = arg('base', 'http://127.0.0.1:3471');
const OUT = arg('out', path.join(__dirname, '..', 'docs', '検査_1107', '写真', 'soroe75'));

const MEASURE = `(function(){
  var s = document.querySelector('.screen.active'); if(!s) return null;
  var R = function(e){ if(!e) return null; var r = e.getBoundingClientRect(); return r.width ? [r.left, r.top, r.right, r.bottom] : null; };
  var hit = function(a, b){ return !!(a && b && a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]); };
  var flag = R(s.querySelector('.v2-sog-flag i')), space = R(s.querySelector('.v2-sog-m.is-space b'));
  var gear = Array.prototype.filter.call(document.querySelectorAll('#floatingGearBtn, .screen.active .v2-cbtn.is-gear'), function(g){ var r = g.getBoundingClientRect(); return r.width > 0 && getComputedStyle(g).display !== 'none'; }).length;
  var t = s.textContent;
  return { scr: s.id, gear: gear, brand: !!s.querySelector('.v2-tbrand'), best: /今日の最高/.test(t) && !s.querySelector('.v2-osync'),
    long: /0 になった瞬間|途中で消えます|アプリは合図を出しません/.test(t), flagOverSpace: hit(flag, space),
    taller: document.documentElement.scrollHeight > innerHeight + 1 };
})()`;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const ids = SCENES.map((s) => s.id).filter((id) => /^so-/.test(id));
  const b = await launch({ port: 9561 });
  const tv = await b.newDevice('tv', { width: 1920, height: 1080 });
  const ph = await b.newDevice('phone', { width: 390, height: 844, mobile: true });
  const rec = [];
  for (const id of ids) {
    const d = /-tv-|^so-tv/.test(id) ? tv : ph;
    await d.go(BASE + '/v2lab?scene=' + id);
    await sleep(2200);
    const m = await d.ev(MEASURE);
    const file = id + '.png';
    await d.shot(path.join(OUT, file));
    rec.push(Object.assign({ id, file }, m || {}));
    console.log(id, JSON.stringify(m));
  }
  fs.writeFileSync(path.join(OUT, '記録.json'), JSON.stringify(rec, null, 1));
  await b.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
