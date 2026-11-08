#!/usr/bin/env node
// tools/kanji-check.js — スマホと TV の画面に出た漢字のうち、小学2年までに習わない字の一覧（11/7 の検査の準備 5）
//
//   node tools/kanji-check.js [--walk docs/検査_1107/写真/walk/記録.json]   … docs/検査_1107/5_漢字の一覧.md を書く
//
// 字は tools/fes-screen-walk.js が撮った時の画面の字（innerText）から取る（本物の流れで出た字だけ。コードの中の使わない字は入れない）。
// 学年別漢字配当表（2020年度からの小学校学習指導要領）の 1年 80字・2年 160字。**直すかは、くまくんが決める**（ここは数えるだけ）。
// ルビ（<ruby>）が付いているかは、画面の HTML に ruby があるかを index.html と v2 の部品で数える（いまは0なら「ルビなし」）。

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : argv[i + 1]; };
const WALK = path.resolve(arg('walk', path.join(ROOT, 'docs', '検査_1107', '写真', 'walk', '記録.json')));

const G1 = '一右雨円王音下火花貝学気九休玉金空月犬見五口校左三山子四糸字耳七車手十出女小上森人水正生青夕石赤千川先早草足村大男竹中虫町天田土二日入年白八百文木本名目立力林六';
const G2 = '引羽雲園遠何科夏家歌画回会海絵外角楽活間丸岩顔汽記帰弓牛魚京強教近兄形計元言原戸古午後語工公広交光考行高黄合谷国黒今才細作算止市矢姉思紙寺自時室社弱首秋週春書少場色食心新親図数西声星晴切雪船線前組走多太体台地池知茶昼長鳥朝直通弟店点電刀冬当東答頭同道読内南肉馬売買麦半番父風分聞米歩母方北毎妹万明鳴毛門夜野友用曜来里理話';
if ([...G1].length !== 80 || [...G2].length !== 160) throw new Error('配当表の字の数が合わない（1年 ' + [...G1].length + '・2年 ' + [...G2].length + '）');
const OK = new Set([...G1, ...G2]);
const isKanji = (c) => /[一-鿿㐀-䶿々]/.test(c);

const r = JSON.parse(fs.readFileSync(WALK, 'utf8'));
const per = new Map();   // 字 -> { n, where:Set, ex }
let shots = 0;
r.撮った.forEach((s) => {
  if (!s.txt) return;
  shots++;
  const where = (s.tv ? 'TV ' : 'スマホ ') + s.mode + ' ' + s.scr.replace(/^scr-/, '') + ' ' + s.stage;
  const seen = new Set();
  [...s.txt].forEach((c, i) => {
    if (!isKanji(c) || OK.has(c) || c === '々') return;
    const y = per.get(c) || { n: 0, where: new Set(), ex: s.txt.slice(Math.max(0, i - 8), i + 9) };
    if (!seen.has(c)) { y.n++; seen.add(c); }
    y.where.add(where); per.set(c, y);
  });
});
const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const ruby = (html.match(/<ruby/g) || []).length + fs.readdirSync(path.join(ROOT, 'public', 'js')).filter((f) => f.startsWith('v2-')).reduce((n, f) => n + (fs.readFileSync(path.join(ROOT, 'public', 'js', f), 'utf8').match(/<ruby/g) || []).length, 0);
const rows = Array.from(per.entries()).sort((a, b) => b[1].n - a[1].n);
let md = '# 5：画面に出る漢字のうち、小学2年までに習わない字（`node tools/kanji-check.js`）\n\n';
md += `- もと：${path.relative(ROOT, WALK).replace(/\\/g, '/')}（本物の流れで撮った ${shots} 枚の画面の字）。配当表 1年80字・2年160字\n`;
md += `- **${rows.length} 字**が2年までに習わない字。ルビ（<ruby>）：index.html と v2 の部品で ${ruby} か所${ruby ? '' : '＝**ルビは無い**'}\n`;
md += '- **直すかは、くまくんが決める**（ここは数えるだけ）。多く出る字から並べた。「出た画面の数」はスマホと TV を合わせた数\n\n';
md += '| 字 | 出た画面の数 | 例（前後の字） | どこで（はじめの4つ） |\n|---|---|---|---|\n';
rows.forEach(([c, y]) => { md += `| ${c} | ${y.n} | ${y.ex.replace(/\|/g, '｜')} | ${Array.from(y.where).slice(0, 4).join('<br>')} |\n`; });
fs.writeFileSync(path.join(ROOT, 'docs', '検査_1107', '5_漢字の一覧.md'), md);
console.log(rows.length + ' 字（' + shots + ' 枚）→ docs/検査_1107/5_漢字の一覧.md・ルビ ' + ruby);
