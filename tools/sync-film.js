#!/usr/bin/env node
// tools/sync-film.js — TV（1920×1080）とスマホ（390×844）を左右に並べた動画で、見せ場の時刻がそろっているかを撮って測る（指示68-T 二の束の門）
//
//   node tools/sync-film.js                  … 全部の場面
//   node tools/sync-film.js --only decide,bomb  … 名前で絞る（decide・pittari・onaji・qhaya・qnear・bomb・countdown）
//   --fps 8  --out DIR（既定 docs/監査_指示68-Tの画像/sync-film）  --port 3975  --cdp 9675
//
// **本物の道で撮る**：public/ を開き（tools/v2-lab/open.js の配り手・疑似 socket）、本物の入口から部屋に入り、
// 本物の進行役で作った見本の知らせ（tools/v2-lab/）を TV とスマホに**同時に**流す。描く関数・演出・待ち方は本番と同じ。演出は「ふつう」。
// 場面：
//   decide    … 文化祭の投票の決定（TV のスポットライトが止まる時刻まで、スマホは世界の幕・名前を出さない）
//   pittari   … ぴったり10秒の開く（スマホの札・自分の差・順位・+点は、TV で同じ物が出る時刻に）
//   onaji     … みんなと同じの開く（人数・冠・名前・+1）
//   qhaya     … クイズ王2 みんなで早答えの開く（声だった「正解は……」は字に）
//   qnear     … クイズ王2 数字ちかい方の開く
//   bomb      … クイズ解除の幕（TV の爆発の幕とスマホの幕。どちらも4秒以内で、同じ時刻に上がる）
//   countdown … 3・2・1 の途中で TV をつなぎ直した形（スマホは合図から、TV は1.2秒遅れて部屋の状態から。0になる時刻がそろう）
//   fesend    … 文化祭のクイズ解除が爆発で終わった時：幕が上がってから文化祭の結果までに、今までのゲームの画面が見えないか（68-S の残り2）
// 測るもの（ページの中で数える）：
//   スマホの「TV で出る秒」（data-tvat）の部品が出た時刻と、その秒。**出た時刻 ≥ TV の秒 − 0.05秒**なら合格。描いた直後に出ていた部品は「先に出た」
//   幕：bombFinaleProbe が返るまでの長さ（TV とスマホ）。4.0秒＋0.2秒以内で、差は0.3秒以内
//   3・2・1：両方の端末の数字を0.05秒ごとに読み、消えた時刻（0になった時刻）の差が0.25秒以内
// 写真と記録：OUT/<場面>.gif・OUT/<場面>_<秒>.gif（1コマ）・OUT/記録.json。音は写らない（検証の Chrome は音を消してある）
'use strict';
const fs = require('fs');
const path = require('path');
const { launch, sleep } = require('./cdp');
const { 配り手, ROOT } = require('./v2-lab/open');
const { encodeGif } = require('./gif-lite');
const Pair = require('./film-pair');
const FesScenes = require('./v2-lab/fes-scenes');
const ButtonScenes = require('./v2-lab/button-scenes');
const OnajiScenes = require('./v2-lab/onaji-scenes');
const Quiz2Scenes = require('./v2-lab/quiz2-scenes');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const FPS = +arg('fps', 8);
const OUT = path.resolve(arg('out', path.join(ROOT, 'docs', '監査_指示68-Tの画像', 'sync-film')));
const PORT = +arg('port', 3975), CDP = +arg('cdp', 9675);
const ONLY = arg('only', null);
const TV_VP = { width: 1920, height: 1080, mobile: false, deviceScaleFactor: 0.5 };
const PH_VP = { width: 390, height: 844, mobile: true, deviceScaleFactor: 1 };

/** 場面：before（入ってすぐの知らせ）・after（同時に流す知らせ）・screen・me（スマホの memberId）・sec（撮る長さ）・still（1コマの秒） */
const SCENES = [
  { id: 'decide', kind: 'fes', before: () => FesScenes.view('fes2-vote'), after: () => FesScenes.view('fes2-decide'), sec: 4.0, still: 1.8 },
  // 68-S の残り2：文化祭のクイズ解除が終わった時。幕が上がってから文化祭の結果が出るまで、何が見えるか（0.1秒ごとの画面を記録）。
  // 「爆発した（文化祭はまだ遊ぶ段階）」を流し、endGraceMs（fes-room.js の TIMES）たってから「文化祭の結果」を流す（サーバーと同じ順と間）
  { id: 'fesend', kind: 'fes', me: 'm1', before: () => FesScenes.view('fes2-tv-play-last'), phoneBefore: () => FesScenes.view('fes2-play'), sec: 7.0, still: 4.3 },
  { id: 'pittari', kind: 'game', game: 'pittari', before: () => ButtonScenes.view('pt-run'), after: () => ButtonScenes.view('pt-reveal'), screen: 'scr-v2-pittari', sec: 5.0, still: 2.0 },
  { id: 'onaji', kind: 'game', game: 'onaji', before: () => OnajiScenes.view('onaji-choose'), after: () => OnajiScenes.view('onaji-unveil'), screen: 'scr-v2-onaji', sec: 4.5, still: 1.5 },
  { id: 'qhaya', kind: 'game', game: 'qhaya', before: () => Quiz2Scenes.view('qh-choose'), after: () => Quiz2Scenes.view('qh-open'), screen: 'scr-v2-qhaya', sec: 4.5, still: 2.0 },
  { id: 'qnear', kind: 'game', game: 'qnear', before: () => Quiz2Scenes.view('qn-guess'), after: () => Quiz2Scenes.view('qn-open'), screen: 'scr-v2-qnear', sec: 5.0, still: 2.0 },
  { id: 'bomb', kind: 'game', game: 'pittari', before: () => ButtonScenes.view('pt-set'), screen: 'scr-v2-pittari', sec: 4.6, still: 1.5 },
  { id: 'countdown', kind: 'game', game: 'pittari', before: () => ButtonScenes.view('pt-set'), screen: 'scr-v2-pittari', sec: 3.6, still: 1.6 }
].filter((s) => !ONLY || String(ONLY).split(',').indexOf(s.id) !== -1);

const base = 'http://127.0.0.1:' + PORT;
async function はじめ(dev) {
  await dev.go(base + '/');
  await dev.ev("(function(){ localStorage.setItem('acac-app-prefs', JSON.stringify({ fxSpeed: 'normal' })); localStorage.setItem('acac-safety-seen','1'); return 1; })()");
}
/** ふだんの部屋に入る（コード → 名前。TV はコードだけ）。tools/pittari-start-film.js と同じ押し方 */
async function 部屋に入る(br, name, vp, me, lab, screenFor) {
  const dev = await br.newDevice(name, vp);
  await はじめ(dev);
  await dev.go(base + '/');
  await dev.until('window.__rtFake && window.__rtFake.connected && document.querySelector("#scr-v2-home [data-home-act=\\"join\\"]")', 15000, '入口');
  const room = lab.room;
  await dev.ev(`(function(){ var room = ${JSON.stringify(room)};
    window.__rtFake.replies = { 'room:peek': function(){ return { ok: true, code: room.code, game: ${JSON.stringify(room.state.game)}, phase: 'play', playerCount: 6, fes: false }; },
      'room:join': function(){ return { ok: true, code: room.code, memberId: ${JSON.stringify(me)}, room: room }; } };
    if (${JSON.stringify(me)} === 'tv') window.homeOpenJoin({ tv: true });
    else { window.goToScreen('scr-v2-home'); document.querySelector('#scr-v2-home [data-home-act="join"]').click(); }
    return 1; })()`);
  await dev.until("document.querySelector('#scr-v2-join [data-home-code]')", 8000, 'コードの画面');
  await dev.ev(`(function(){ var i=document.querySelector('#scr-v2-join [data-home-code]'); i.value=${JSON.stringify(room.code)}; i.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('#scr-v2-join [data-home-act="code-go"]').click(); return 1; })()`);
  if (me !== 'tv') {
    await dev.until("document.querySelector('#scr-v2-join [data-home-name]') || (document.querySelector('.screen.active')||{}).id !== 'scr-v2-join'", 8000, '名前の画面');
    await dev.ev("(function(){ var n=document.querySelector('#scr-v2-join [data-home-name]'); if(!n) return 0; n.value='ふう'; n.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('#scr-v2-join [data-home-act=\"join-go\"]').click(); return 1; })()");
  }
  await dev.until("(document.querySelector('.screen.active')||{}).id !== 'scr-v2-join'", 8000, '部屋に入った');
  await 流す(dev, lab, me === 'tv');
  const want = screenFor(me);
  await dev.until("(document.querySelector('.screen.active')||{}).id === " + JSON.stringify(want), 8000, want);
  await dev.ev("document.fonts.ready.then(function(){ return 1; })");
  return dev;
}
/** 文化祭の部屋に入る（TV は /fes?tv=1 の飛び先・スマホは名前とむずかしさ） */
async function 文化祭に入る(br, name, vp, me, lab) {
  const dev = await br.newDevice(name, vp);
  await はじめ(dev);
  await dev.go(base + '/?room=TST754&fes=1' + (me === 'tv' ? '&tv=1' : ''));
  await dev.until('window.__rtFake && window.__rtFake.connected', 15000, '疑似socket');
  await dev.ev(`(function(){ var room = ${JSON.stringify(FesScenes.view('fes2-lobby').room)};
    window.__rtFake.replies = { 'room:peek': function(){ return { ok: true, code: 'TST754', playerCount: 6, fes: true }; },
      'room:join': function(){ return { ok: true, code: 'TST754', memberId: ${JSON.stringify(me)}, room: room }; } }; return 1; })()`);
  if (me !== 'tv') {
    await dev.until("(document.querySelector('.screen.active')||{}).id === 'scr-v2-fes-join' && document.querySelector('[data-fes-name]')", 10000, '入る画面');
    await dev.ev("(function(){ var n=document.querySelector('[data-fes-name]'); n.value='ふう'; n.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('[data-fes-diff=\"normal\"]').click(); document.querySelector('[data-fes-act=\"join\"]').click(); return 1; })()");
  }
  const want = me === 'tv' ? 'scr-v2-fes-tv' : 'scr-v2-fes-lobby';
  await dev.until("(document.querySelector('.screen.active')||{}).id === " + JSON.stringify(want), 10000, want);
  await 流す(dev, lab, me === 'tv');
  await sleep(600);
  await dev.ev("document.fonts.ready.then(function(){ return 1; })");
  return dev;
}
// 本人だけの知らせ（wolf:you・fes:you）は、本番と同じくスマホにだけ、部屋の知らせのあとに流す。
// **TV には流さない**（本番の TV は遊ぶ人ではないので privateFor が null で、届かない。流すと2回目の描き直しで動きが消える）
const 流す式 = (lab, tv) => `(function(){ window.__rtFake.fire('room:update', ${JSON.stringify(lab.room)}); ${lab.you && !tv ? "window.__rtFake.fire(" + (lab.room.fes ? "'fes:you'" : "'wolf:you'") + ", " + JSON.stringify(lab.you) + ");" : ''}${lab.secret && !tv ? " window.__rtFake.fire('wolf:you', " + JSON.stringify(lab.secret) + ");" : ''} return 1; })()`;
const 流す = (dev, lab, tv) => dev.ev(流す式(lab, tv));

/** スマホ：data-tvat の部品が出た時刻を数え始める（流す直前に呼ぶ） */
const 見張る = `(function(){
  window.__tw = { t0: performance.now(), seen: [] };
  if (window.__twObs) window.__twObs.disconnect();
  window.__twObs = new MutationObserver(function(ms){ ms.forEach(function(m){
    if (m.attributeName !== 'class' || !m.target.hasAttribute || !m.target.hasAttribute('data-tvat')) return;
    if ((m.oldValue || '').indexOf('is-tvwait') !== -1 && !m.target.classList.contains('is-tvwait'))
      window.__tw.seen.push({ at: (performance.now() - window.__tw.t0) / 1000, tvat: +m.target.getAttribute('data-tvat'), cls: String(m.target.className).split(' ')[0] });
  }); });
  window.__twObs.observe(document.body, { subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['class'] });
  return 1; })()`;
/** 流した直後：TV の秒が0.1秒より先なのに、もう見えている部品（先に出た） */
const 先に出た = "Array.prototype.map.call(document.querySelectorAll('.screen.active [data-tvat]:not(.is-tvwait)'), function(n){ return { tvat: +n.getAttribute('data-tvat'), cls: String(n.className).split(' ')[0] }; }).filter(function(x){ return x.tvat > 0.1; })";

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await 配り手(PORT);
  const br = await launch({ port: CDP });
  const 記録 = [];
  let bad = 0;
  try {
    for (const sc of SCENES) {
      const before = sc.before(), after = sc.after ? sc.after() : null;
      const me = sc.me || (after && after.meId) || before.meId || 'm1';
      const screenFor = (who) => who === 'tv' ? sc.screen + '-tv' : sc.screen;
      // TV は文化祭でも、ふだんの部屋と同じ入口（コード）から入る（/fes?tv=1 の飛び先は、疑似の返事を置く前に入りに行ってしまう）。部屋の知らせが文化祭なので、文化祭の TV になる
      const tv = await 部屋に入る(br, 'tv-' + sc.id, TV_VP, 'tv', before, sc.kind === 'fes' ? () => 'scr-v2-fes-tv' : screenFor);
      const ph = sc.kind === 'fes' ? await 文化祭に入る(br, 'ph-' + sc.id, PH_VP, me, sc.phoneBefore ? sc.phoneBefore() : before) : await 部屋に入る(br, 'ph-' + sc.id, PH_VP, me, before, screenFor);
      const rt = Pair.送りを受ける(tv, 960, 540), rp = Pair.送りを受ける(ph, 390, 844);
      await rt.start(); await rp.start();
      await sleep(500);
      const t0 = Date.now() - 200;
      const row = { 場面: sc.id };
      if (sc.id === 'bomb') {
        // 幕：本番の bombFinale を、TV は TV の形、スマホはスマホの形で同時に（クイズ解除の終わりの4面は、この1本を呼ぶ）
        const 幕 = (dev, isTv) => dev.ev(`(function(){ var t=performance.now(); return window.bombFinaleProbe({ success: false, tv: ${isTv}, left: 2, cause: 'lives', total: 30, solved: 28 }).then(function(){ return (performance.now()-t)/1000; }); })()`);
        const [a, b] = await Promise.all([幕(tv, true), 幕(ph, false)]);
        row.幕 = { TV: +a.toFixed(2), スマホ: +b.toFixed(2) };
        row.合格 = a <= 4.2 && b <= 4.2 && Math.abs(a - b) <= 0.3;
      } else if (sc.id === 'fesend') {
        const 結果 = FesScenes.view('fes2-tv-boom'), 終わり = JSON.parse(JSON.stringify(結果));
        終わり.room.fes.phase = 'play';   // 爆発した瞬間：ゲームは終わったが、文化祭は結果へ移る前（endGraceMs の間）
        const 結果P = FesScenes.view('fes2-boom'), 終わりP = JSON.parse(JSON.stringify(結果P));   // スマホは手元の知らせ（secret）も
        終わりP.room.fes.phase = 'play';
        const grace = require('../fes-room').TIMES.endGraceMs;
        const 画面 = `(function(){ window.__scr = []; var t0 = performance.now(); var id = setInterval(function(){
          var a = document.querySelector('.screen.active'), f = document.querySelector('.fx-finale');
          window.__scr.push({ t: (performance.now() - t0) / 1000, s: (a ? a.id : '') + (f ? '+幕' : '') });
          if (performance.now() - t0 > 7500) clearInterval(id); }, 100); return 1; })()`;
        await Promise.all([tv.ev(画面), ph.ev(画面)]);
        await Promise.all([流す(tv, 終わり, true), 流す(ph, 終わりP, false)]);
        await sleep(grace);
        await Promise.all([流す(tv, 結果, true), 流す(ph, 結果P, false)]);
        await sleep(sc.sec * 1000 - grace);
        const 区切り = async (dev) => { const l = await dev.ev('window.__scr'); const out = []; l.forEach((x) => { if (!out.length || out[out.length - 1].s !== x.s) out.push({ t: +x.t.toFixed(1), s: x.s }); }); return out; };
        row.TV = await 区切り(tv); row.スマホ = await 区切り(ph); row.endGraceMs = grace;
        // 合格：幕が上がったあと、文化祭の結果の画面より前に、ほかの画面（今までのゲームの画面）が見えていない
        const 見えた = (l) => l.filter((x) => x.s.indexOf('+幕') === -1 && !/scr-v2-fes-(tv|lobby)$/.test(x.s)).map((x) => x.t + '秒 ' + x.s);
        row.幕のあとの別の画面 = { TV: 見えた(row.TV), スマホ: 見えた(row.スマホ) };
        row.合格 = !row.幕のあとの別の画面.TV.length && !row.幕のあとの別の画面.スマホ.length;
      } else if (sc.id === 'countdown') {
        // スマホはふつうに合図を受ける。TV は1.2秒遅れてつなぎ直し、部屋の状態（countdownEndsAt）から数える
        const 読む = `(function(){ window.__cd = []; var t0 = performance.now(); var id = setInterval(function(){
          var n = document.querySelector('.fx-countdown .fx-cd-num, .fx-countdown .v2-cdx-n'); window.__cd.push({ t: (performance.now()-t0)/1000, n: n ? n.textContent : null });
          if (performance.now() - t0 > 4500) clearInterval(id); }, 50); return 1; })()`;
        await Promise.all([tv.ev(読む), ph.ev(読む)]);
        const ends = Date.now() + 3000;
        await ph.ev(`(function(){ window.__rtFake.fire('room:countdown', { seconds: 3, endsAt: ${ends}, now: ${Date.now()} }); return 1; })()`);
        await sleep(1200);
        await tv.ev(`(function(){ var r = ${JSON.stringify(before.room)}; r.countdownEndsAt = ${ends}; window.__rtFake.fire('room:update', r); return 1; })()`);
        await sleep(2800);
        const 消えた = async (dev) => { const l = await dev.ev('window.__cd'); let last = null; l.forEach((x) => { if (x.n) last = x.t; }); return { last, seen: [...new Set(l.map((x) => x.n).filter(Boolean))].join('') }; };
        const [ct, cp] = await Promise.all([消えた(tv), 消えた(ph)]);
        row.三二一 = { TV: ct, スマホ: cp, 差: ct.last != null && cp.last != null ? +Math.abs(ct.last - cp.last).toFixed(2) : null };
        row.合格 = row.三二一.差 != null && row.三二一.差 <= 0.25 && ct.seen.indexOf('1') !== -1;
      } else {
        await ph.ev(見張る);
        await Promise.all([流す(tv, after, true), 流す(ph, after, false)]);
        // TV の見せ場が動いているか（動いていないと、TV の時刻とくらべる意味が無い）
        row.TV動く = await tv.ev("(function(){ var s=document.querySelector('.screen.active'); return !!(s && s.classList.contains('is-play')); })()");
        await sleep(80);
        const 先 = await ph.ev(先に出た);
        await sleep(sc.sec * 1000);
        const seen = await ph.ev('window.__tw.seen');
        const 早い = seen.filter((x) => x.at < x.tvat - 0.05);
        row.スマホ = { 待った部品: seen.length, 先に出た: 先, TVより早い: 早い, 出た: seen.map((x) => x.cls + ' ' + x.at.toFixed(2) + '秒（TV ' + x.tvat + '）') };
        row.合格 = row.TV動く && seen.length > 0 && !先.length && !早い.length;
      }
      await sleep(300);
      await rt.stop(); await rp.stop();
      const a = Pair.コマを並べる(rt.got, t0, sc.sec, FPS), b = Pair.コマを並べる(rp.got, t0, sc.sec, FPS);
      const frames = a.map((f, i) => Pair.並べる(f, b[i]));
      const gif = encodeGif(frames, Math.round(100 / FPS));
      fs.writeFileSync(path.join(OUT, sc.id + '.gif'), gif);
      fs.writeFileSync(path.join(OUT, sc.id + '_' + sc.still + 's.gif'), encodeGif([frames[Math.min(frames.length - 1, Math.round((sc.still + 0.2) * FPS))]], 100));
      row.KB = Math.round(gif.length / 1024);
      記録.push(row);
      if (!row.合格) bad++;
      console.log((row.合格 ? '✔ ' : '✖ ') + sc.id + '：' + JSON.stringify(row.幕のあとの別の画面 ? { 画面: row.TV, 別の画面: row.幕のあとの別の画面 } : row.幕 || row.三二一 || { TV動く: row.TV動く, 待った部品: row.スマホ.待った部品, 先に出た: row.スマホ.先に出た.length, TVより早い: row.スマホ.TVより早い.length }) + '（' + row.KB + 'KB）');
      if (row.スマホ && row.スマホ.出た) row.スマホ.出た.forEach((x) => console.log('    ' + x));
      await tv.close(); await ph.close();
    }
  } catch (e) {
    console.error('✖ ' + (e && e.stack || e));
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(path.join(OUT, '記録.json'), JSON.stringify(記録, null, 1));
    await br.close();
    server.close();
  }
  if (bad) process.exitCode = 1;
})();
