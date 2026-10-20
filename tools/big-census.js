#!/usr/bin/env node
// tools/big-census.js — 大画面（TV）を、人数を変えて最後まで通しながら撮って測る（指示64 着手前の確かめ1）
//
//   node tools/big-census.js bakudan --players 16 --port 3901 --cdp 9601
//
// 通し方は tools/flow-walk.js の台本（tools/flow-walk/<id>.js）をそのまま使い、bot の数だけ増やす
//（人数＝進行役＋参加者＋bot。4人＝bot 2、8人＝bot 6、16人＝bot 14）。
// 大画面の中身が変わるたびに（画面id＋段階の文字＋主役の文字＋名簿の数）、
// **1280×720 と 1920×1080 の両方**で次を測り、撮る：
//   巻き … ページが縦に巻けるか（scrollHeight と clientHeight。落とし穴28：同じ物差しで比べる）
//           ／中の箱が縦に巻けるか（overflow auto/scroll で scrollHeight > clientHeight）
//   切れ … 見えている文字・ボタン・行のうち、画面の外へ出ている／先祖の overflow:hidden で切られているもの
//   字   … 見えている文字のうち、正本§11-5 の下限（1280×720 で本文28px。1920×1080 は 1.5倍の 42px）より小さいもの
//   目立つ … 大画面でいちばん大きいボタン（面積）と、その文字
// 出力：docs/監査_大画面の画像/<id>_<人数>/（画像と 記録.json。git に入れない）

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { makeWalk } = require('./flow-walk');
const { sleep } = require('./cdp');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : argv[i + 1]; };
const id = argv[0];
const 人数 = parseInt(arg('players', '4'), 10);
const PORT = String(arg('port', '3901'));
const CDP = parseInt(arg('cdp', '9601'), 10);
const BASE = 'http://localhost:' + PORT;
const OUT = path.join(__dirname, '..', 'docs', '監査_大画面の画像', id + '_' + 人数);
const 大きさ = [[1280, 720], [1920, 1080]];

/** 大画面の今を測る（ページの中で） */
const 測る = `(function(){
  var W=document.documentElement.clientWidth, H=document.documentElement.clientHeight, 倍=H/720;
  var scr=document.querySelector('.screen.active'); if(!scr) return null;
  function 見える(e){ if(!e) return false; var r=e.getBoundingClientRect(); if(r.width<1||r.height<1) return false; var cs=getComputedStyle(e); if(cs.visibility==='hidden'||+cs.opacity===0) return false; if(typeof e.checkVisibility==='function'&&!e.checkVisibility({opacityProperty:true,visibilityProperty:true})) return false; return true; }
  function 名(e){ var s=e.tagName.toLowerCase(); if(e.id) s+='#'+e.id; var c=(typeof e.className==='string'?e.className:'').trim().split(/\\s+/).filter(Boolean).slice(0,2); if(c.length) s+='.'+c.join('.'); return s; }
  var se=document.scrollingElement;
  var ページの巻き = se.scrollHeight - H;
  var 箱の巻き=[];
  scr.querySelectorAll('*').forEach(function(e){ var cs=getComputedStyle(e); if(!/(auto|scroll)/.test(cs.overflowY)) return; if(e.scrollHeight>e.clientHeight+2 && 見える(e)) 箱の巻き.push({箱:名(e), 中身:e.scrollHeight, 見える高さ:e.clientHeight}); });
  // 切れ：文字を持つ要素とボタン・行
  var 切れ=[], 小さい=[], 文字=0;
  var 候補 = Array.prototype.filter.call(scr.querySelectorAll('*'), function(e){ return 見える(e) && (e.tagName==='BUTTON' || /(^|\\s)(bl-item|bl-card|rk-row|bb-row|sh-tier|bmk-c|bmk-k)(\\s|$)/.test(typeof e.className==='string'?e.className:'') || Array.prototype.some.call(e.childNodes,function(n){return n.nodeType===3&&n.textContent.trim().length>0;})); });
  候補.forEach(function(e){
    var r=e.getBoundingClientRect();
    var t=(e.innerText||e.textContent||'').trim().replace(/\\s+/g,' ').slice(0,30);
    if(r.bottom>H+1||r.right>W+1||r.top<-1||r.left<-1){ 切れ.push({何:名(e), 文字:t, 下:Math.round(r.bottom), 右:Math.round(r.right)}); return; }
    for(var p=e.parentElement;p&&p!==document.body;p=p.parentElement){ var cs=getComputedStyle(p); if(cs.overflowY!=='visible'||cs.overflowX!=='visible'){ var pr=p.getBoundingClientRect(); if(r.bottom>pr.bottom+2||r.right>pr.right+2||r.top<pr.top-2||r.left<pr.left-2){ 切れ.push({何:名(e), 文字:t, 切る箱:名(p)}); return; } } }
    if(Array.prototype.some.call(e.childNodes,function(n){return n.nodeType===3&&n.textContent.trim().length>0;})){
      文字++;
      var px=parseFloat(getComputedStyle(e).fontSize);
      if(px < 28*倍 - 0.5) 小さい.push({何:名(e), 文字:t, px:Math.round(px), 下限:Math.round(28*倍)});
    }
  });
  var ボタン = Array.prototype.filter.call(scr.querySelectorAll('button, .btn'), 見える).map(function(b){var r=b.getBoundingClientRect(); var cs=getComputedStyle(b); return {文字:(b.innerText||'').trim().replace(/\\s+/g,' ').slice(0,24), 面積:Math.round(r.width*r.height), 色:cs.backgroundColor, 字:Math.round(parseFloat(cs.fontSize))};}).sort(function(a,b){return b.面積-a.面積;});
  var 段階=((document.getElementById('bigPhase')||{}).textContent||'').trim();
  var 主役=((document.getElementById('bigMain')||{}).textContent||'').trim().slice(0,30);
  var 名簿=document.querySelectorAll('#scr-rt-big .bl-item, #scr-rt-big .bl-card, #scr-rt-big .rk-row').length;
  return { 画面:scr.id, class:scr.className, 段階:段階, 主役:主役, 名簿の数:名簿, W:W, H:H, ページの巻き:ページの巻き, 箱の巻き:箱の巻き, 切れ:切れ.slice(0,40), 切れの数:切れ.length, 小さい:小さい.slice(0,40), 小さいの数:小さい.length, 文字の数:文字, いちばん大きいボタン:ボタン[0]||null, ボタン:ボタン.slice(0,6) };
})()`;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.readdirSync(OUT).filter((f) => /\.(jpg|json)$/.test(f)).forEach((f) => fs.unlinkSync(path.join(OUT, f)));
  let server = null, up = false;
  try { up = (await fetch(BASE + '/')).ok; } catch (e) {}
  if (!up) {
    const log = fs.openSync(path.join(require('os').tmpdir(), 'big-census-' + PORT + '.log'), 'w');
    server = spawn(process.execPath, [path.join(__dirname, 'dev-server.js')], { env: Object.assign({}, process.env, { PORT }), stdio: ['ignore', log, log] });
    for (let i = 0; i < 60 && !up; i++) { await sleep(250); try { up = (await fetch(BASE + '/')).ok; } catch (e) {} }
  }
  const scenario = require(path.join(__dirname, 'flow-walk', id + '.js'));
  const W = makeWalk({ cassette: id, base: BASE, out: path.join(OUT, 'walk'), cdp: CDP, bots: Math.max(0, 人数 - 2) });
  W.idleMs = 5000;
  const 記録 = [];
  let 止める = false, 失敗 = null, 番 = 0, 前の鍵 = null;
  const 見回り = async () => {
    while (!止める) {
      const big = W.devices().大画面;
      if (big) {
        try {
          const m = await big.ev(測る);
          if (m) {
            const 鍵 = [m.画面, m.class.replace(/\s*(active|scr-in-\w+)\s*/g, ' '), m.段階, m.主役, m.名簿の数].join('|');
            if (鍵 !== 前の鍵) {
              前の鍵 = 鍵;
              番++;
              const rec = { 番, 手順: W.手順.length, 鍵, 測り: {} };
              for (const [w, h] of 大きさ) {
                await big.raw('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
                await sleep(350);
                rec.測り[w + 'x' + h] = await big.ev(測る);
                const f = String(番).padStart(3, '0') + '_' + w + '.jpg';
                await big.shot(path.join(OUT, f));
                rec.測り[w + 'x' + h].画像 = f;
              }
              await big.raw('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
              記録.push(rec);
              const a = rec.測り['1280x720'], b = rec.測り['1920x1080'];
              console.log('  [大画面 ' + 番 + '] ' + a.画面 + ' ' + (a.段階 || '') + ' ／ 巻き ' + a.ページの巻き + '・' + b.ページの巻き + ' 箱' + a.箱の巻き.length +
                ' ／ 切れ ' + a.切れの数 + '・' + b.切れの数 + ' ／ 小さい字 ' + a.小さいの数 + '・' + b.小さいの数 + ' ／ 一番大きいボタン「' + ((a.いちばん大きいボタン || {}).文字 || '') + '」');
            }
          }
        } catch (e) {}
      }
      await sleep(900);
    }
  };
  try {
    await W.始める(scenario.端末);
    const loop = 見回り();
    try { await scenario.run(W); } catch (e) { 失敗 = String(e && e.stack || e); console.error('失敗：' + 失敗.split('\n')[0]); }
    await sleep(2500);
    止める = true;
    await loop;
  } finally {
    fs.writeFileSync(path.join(OUT, '記録.json'), JSON.stringify({ カセット: id, 人数, 失敗, 記録 }, null, 1));
    await W.片付ける();
    if (server) { try { server.kill(); } catch (e) {} }
    console.log(id + ' ' + 人数 + '人：大画面の状態 ' + 記録.length + (失敗 ? ' ／ 途中で止まった' : ''));
    process.exit(失敗 ? 1 : 0);
  }
})();
