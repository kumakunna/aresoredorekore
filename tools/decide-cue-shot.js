#!/usr/bin/env node
// tools/decide-cue-shot.js — 指示76 束1 の門の道具：TV の「次のゲームは…」の3枚の札（A1）と、ぴったり10秒の「スタート！」（A3）を
// 見本データ（tools/v2-lab の場面）で撮って、位置を測る。サーバーも bot も要らない（tools/v2-lab/open.js の配り手）。
//
//   node tools/decide-cue-shot.js --out DIR     … 写真（*_cards.png・pt-tv-run_cue*.png）と、測った値・判定を出す
//   --tv 1920x1080,1280x720,1440x1080            … TV の大きさ（「スタート！」の置き場所は、縮めた TV の画面に合わせて計算するので、ちがう比でも見る）
//
// 決まる画面の札は、決まったあと消える（.v2-dcards の動き）。写真は「スポットライトが止まる前」の 2.3 秒で動きを止めて撮る。
// 判定：①3枚で絵の上の位置が同じ ②小さい字の箱が、名前の字の箱（Range の上下＝書体の高さ全部）より下 ③「スタート！」の札が
// 上の札（何回目・目標）と時計の間にあり、下の説明にもかからない
const path = require('path');
const { launch, sleep } = require('./cdp');
const { 配り手, 開く } = require('./v2-lab/open');
const { SCENES } = require('./v2-lab/scenes');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : argv[i + 1]; };
const OUT = path.resolve(arg('out', path.join(__dirname, '..', 'docs', '検査_1107', '写真', 'decide-cue')));
const TVS = String(arg('tv', '1920x1080')).split(',').map((s) => { const m = /^(\d+)x(\d+)$/.exec(s.trim()); return { w: +m[1], h: +m[2] }; });
const PORT = +arg('port', 3981), CDP = +arg('cdp', 9681);
const RECT = 'function(el){ if(!el) return null; var r=el.getBoundingClientRect(); return {x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height),b:Math.round(r.bottom)}; }';

(async () => {
  const srv = await 配り手(PORT);
  const b = await launch({ port: CDP });
  const ng = [];
  try {
    for (const tv of TVS) {
      const tag = tv.w + 'x' + tv.h;
      const dev = await b.newDevice('tv' + tag, { width: tv.w, height: tv.h, mobile: false, deviceScaleFactor: 1 });
      for (const id of ['fes2-tv-decide', 'fes2-tv-decide-a', 'fes2-tv-decide-b']) {
        await 開く(dev, PORT, SCENES.find((s) => s.id === id), { freeze: 20 });
        await sleep(300);
        const cards = await dev.ev(`(function(){ var R=${RECT}; var scr=document.querySelector('.screen.active'); var dc=scr.querySelector('.v2-dcards'); if(!dc) return null;
          scr.classList.add('is-play'); document.getAnimations().forEach(function(a){ a.pause(); a.currentTime=2300; });
          return [].map.call(dc.querySelectorAll('.v2-dcard'), function(c){
            var nm=c.querySelector('.v2-dcard-t'), rg=document.createRange(); rg.setStart(nm.firstChild,0); rg.setEnd(nm.firstChild,nm.firstChild.length);
            var q=rg.getBoundingClientRect();
            return { name:nm.textContent, tile:R(c.querySelector('.v2-dcard-tile')), nameTop:Math.round(q.top), nameBottom:Math.round(q.bottom), small:R(c.querySelector('small')), card:R(c) };
          }); })()`);
        if (!cards) { ng.push(tag + ' ' + id + '：札が無い'); continue; }
        const tops = new Set(cards.map((c) => c.tile.y));
        if (tops.size !== 1) ng.push(tag + ' ' + id + '：絵の上の位置がそろわない ' + [...tops].join('/'));
        cards.forEach((c) => {
          if (c.small && c.small.y < c.nameBottom) ng.push(tag + ' ' + id + '：' + c.name + ' の小さい字が名前に重なる（' + c.small.y + ' < ' + c.nameBottom + '）');
          if ((c.small ? c.small.b : c.nameBottom) > c.card.b) ng.push(tag + ' ' + id + '：' + c.name + ' が札の下からはみ出す');
        });
        console.log(tag, id, cards.map((c) => c.name + ' 絵' + c.tile.y + ' 名前' + c.nameTop + '-' + c.nameBottom + (c.small ? ' 小' + c.small.y + '-' + c.small.b : '')).join('｜'));
        await dev.shot(path.join(OUT, tag + '_' + id + '_cards.png'));
      }
      for (const size of ['l', 'xl']) {
        await 開く(dev, PORT, SCENES.find((s) => s.id === 'pt-tv-run'), { freeze: 20 });
        await sleep(300);
        // 本物の TV と同じ印（:root.big-screen）と、pittariFx が TV で出すのと同じ合図。出入りの動き（0.18秒）が済んでから測る
        await dev.ev(`(function(){ document.documentElement.classList.add('big-screen'); FxKit.cue(UiText.PITTARI.スタート, { ms: 60000, size: '${size}', cls: 'is-pt-go is-tv' }); return 1; })()`);
        await sleep(600);
        const m = await dev.ev(`(function(){ var R=${RECT}, s=document.querySelector('.screen.active');
          return { cue:R(document.querySelector('.fx-cue .fx-cue-text')), top:R(s.querySelector('.v2-otv > :first-child')), clock:R(s.querySelector('.v2-ptclock')), hint:R(s.querySelector('.v2-pthint')) }; })()`);
        if (!(m.cue.y >= m.top.b)) ng.push(tag + ' スタート（' + size + '）が上の札にかかる（' + m.cue.y + ' < ' + m.top.b + '）');
        if (!(m.cue.b <= m.clock.y)) ng.push(tag + ' スタート（' + size + '）が時計にかかる（' + m.cue.b + ' > ' + m.clock.y + '）');
        if (m.hint && !(m.cue.b <= m.hint.y)) ng.push(tag + ' スタート（' + size + '）が説明にかかる');
        console.log(tag, 'スタート（' + size + '）', '上の札の下 ' + m.top.b + '・札 ' + m.cue.y + '〜' + m.cue.b + '・時計 ' + m.clock.y + '〜' + m.clock.b + (m.hint ? '・説明 ' + m.hint.y : ''));
        await dev.shot(path.join(OUT, tag + '_pt-tv-run_cue-' + size + '.png'));
      }
      await dev.close();
    }
  } finally { await b.close(); srv.close(); }
  console.log(ng.length ? '\n✗ ' + ng.length + '件\n  ' + ng.join('\n  ') : '\n✓ 札とスタートの重なり 0（' + OUT + '）');
  process.exit(ng.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
