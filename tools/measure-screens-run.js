#!/usr/bin/env node
// tools/measure-screens-run.js — measure-screens.js の SNIPPET を、Chrome（CDP）で自動で回す（指示60 B-6）
//
// measure-screens.js は「ブラウザのコンソールに貼る」形だった。貼る手間と、
// ブラウザ枠が裏に回ると時計が止まる事故（落とし穴28）を避けるため、
// tools/cdp.js で同じ SNIPPET を流し込み、**画面の大きさ × 文字サイズ3段階**で回す。
//
//   node tools/dev-server.js
//   node tools/measure-screens-run.js                 # 375×667 と 375×812、文字 小・中・大
//   node tools/measure-screens-run.js --json out.json # 全部の行を書き出す
//   node tools/measure-screens-run.js --settings      # 設定の全ページ（歯車→行を押して進む）を、文字3段階で
//     設定は中で巻けるので縦は数えない。**横のはみ出し**と**押す的**だけを見る。
//     設定は世界の色に染まらない（正本1-3：道具は世界の外）ので、テーマごとには回さない
//
// 出すもの（**空の器は数えない**：文字量 len が小さい画面は、中身が描かれていない）：
//   ・縦のはみ出し（over）… 画面の下端より下に中身がある
//   ・横のはみ出し（xover）… 1pxでもあれば出す
//   ・主ボタンが最初から見えない（mb.入る=false）
//   ・押す的が44px未満（見えているボタン・リンクの幅か高さ）
// 先に**測り方が効くこと**を1つ確かめる（900pxの箱を足すと over が動くか・落とし穴10-f）。

const fs = require('fs');
const path = require('path');
const { launch, sleep } = require('./cdp');
const { SNIPPET } = require('./measure-screens');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : (argv[i + 1] || true); };
const BASE = arg('url', 'http://localhost:3001');
const JSON_OUT = arg('json', null);
const SETTINGS = !!arg('settings', false);
const 画面の大きさ = [{ width: 375, height: 667 }, { width: 375, height: 812 }];
// 文字サイズは、遊ぶ人が設定で選ぶのと同じ保存値（fontScale）を置いて開き直す。
// 85＝小、100＝ふつう、130＝大（index.html が fs-85〜fs-130 と、両端に fs-small／fs-large を付ける）
const 文字 = [85, 100, 130];

// 押す的：見えているボタン・リンク・トグルのうち、幅か高さが44px未満のもの
const 的を測る = `(function(){
  var scr=document.querySelector('.screen.active'); if(!scr) return [];
  return Array.from(scr.querySelectorAll('button, a, [role=button], .switch, input[type=range]')).filter(function(e){
    var r=e.getBoundingClientRect(); var cs=getComputedStyle(e);
    return r.width>0 && r.height>0 && cs.display!=='none' && cs.visibility!=='hidden' && !e.closest('[hidden]');
  }).map(function(e){ var r=e.getBoundingClientRect();
    // 押せる範囲：見た目の箱と、::before の「押せる範囲」の大きい方（index.html 指示60 B-6）
    var bf=getComputedStyle(e,'::before'); var 範囲=(bf.content&&bf.content!=='none'&&bf.position==='absolute');
    var w=Math.max(r.width, 範囲?parseFloat(bf.width)||0:0), h=Math.max(r.height, 範囲?parseFloat(bf.height)||0:0);
    return { 札:(e.textContent||e.getAttribute('aria-label')||e.className||'').trim().replace(/\\s+/g,' ').slice(0,16),
             w:Math.round(w), h:Math.round(h) }; })
  .filter(function(x){ return x.w < 44 || x.h < 44; });
})()`;

(async () => {
  const b = await launch({ port: 9335 });
  const 全部 = [];
  try {
    for (const vp of 画面の大きさ) {
      const d = await b.newDevice(vp.width + 'x' + vp.height, Object.assign({ mobile: true, deviceScaleFactor: 1 }, vp));
      await d.go(BASE + '/dev-login');
      const 開く = async (fontScale) => {
        await d.go(BASE + '/');
        await d.ev("(function(){var k='acac-app-prefs'; var p={}; try{p=JSON.parse(localStorage.getItem(k)||'{}')||{};}catch(e){} p.fontScale=" + fontScale + "; localStorage.setItem(k, JSON.stringify(p)); return true;})()");
        await d.go(BASE + '/');
        await d.until("document.getElementById('safetyGate').style.display==='flex'||(document.querySelector('.screen.active')||{}).id==='scr-entry'", 8000);
        if (await d.ev("document.getElementById('safetyGate').style.display==='flex'")) await d.click('#sgStartBtn');
        await d.until("(document.querySelector('.screen.active')||{}).id==='scr-entry'", 8000);
        // 遷移を切る（途中の値を読まない・落とし穴28）
        await d.ev("(function(){var s=document.createElement('style');s.textContent='*{transition:none!important;animation-duration:0s!important;}';document.head.appendChild(s);return true;})()");
        await d.ev('(function(){' + SNIPPET + '; return true;})()');
        return d.ev("Array.from(document.documentElement.classList).filter(function(c){return /^fs-/.test(c);}).join(' ')");
      };
      await 開く(100);
      // 自己検査：900px の箱を足すと over が動くか
      const 自己 = await d.ev(`(async function(){
        var one=async function(){ return (await window.__measure(['scr-entry'])).rows[0]; };
        var scr=document.getElementById('scr-entry'); var before=await one();
        var sp=document.createElement('div'); sp.style.cssText='height:900px;flex:none;'; scr.appendChild(sp);
        var after=await one(); var 実寸=Math.round(sp.getBoundingClientRect().height); sp.remove();
        var back=await one(); return {実寸:実寸, before:before.over, after:after.over, back:back.over};
      })()`);
      const 効く = 自己.実寸 === 900 && 自己.before === 0 && 自己.after > 0 && 自己.back === 0;
      console.log('■ ' + d.name + '  自己検査：' + JSON.stringify(自己) + (効く ? '（測り方は効く）' : '（**効いていない**）'));
      if (!効く) throw new Error('測り方が効いていません');
      if (SETTINGS) {
        for (const f of 文字) {
          const 印 = await 開く(f);
          await d.ev("(function(){window.goToScreen('scr-shelf');return true;})()");
          await sleep(200);
          const 結果 = await d.ev(`(async function(){
            var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms);});};
            document.getElementById('floatingGearBtn').click(); await sleep(250);
            var ov=document.getElementById('settingsOverlay');
            var 見たページ={}; var 出=[];
            var 測る=function(page){
              var pg=ov.querySelector('.set-page[data-page="'+page+'"]'); if(!pg) return;
              var W=ov.getBoundingClientRect().width; var 横=0;
              pg.querySelectorAll('*').forEach(function(e){var r=e.getBoundingClientRect(); if(r.width&&r.right>W+0.5&&getComputedStyle(e).position!=='fixed') 横=Math.max(横,Math.round(r.right-W));});
              var 的=[]; pg.querySelectorAll('button, a, [role=button], .switch, input[type=range]').forEach(function(e){
                var r=e.getBoundingClientRect(); var cs=getComputedStyle(e); if(!r.width||!r.height||cs.display==='none'||cs.visibility==='hidden'||e.closest('[hidden]')) return;
                var bf=getComputedStyle(e,'::before'); var 範囲=(bf.content&&bf.content!=='none'&&bf.position==='absolute');
                var w=Math.max(r.width, 範囲?parseFloat(bf.width)||0:0), h=Math.max(r.height, 範囲?parseFloat(bf.height)||0:0);
                if(w<44||h<44) 的.push((e.textContent||e.id||e.className).trim().replace(/\s+/g,' ').slice(0,14)+' '+Math.round(w)+'x'+Math.round(h));
              });
              出.push({page:page, 横:横, 的:的, len:(pg.innerText||'').replace(/\s/g,'').length});
            };
            // 行を押して進めるページを、たどれるだけたどる（2段まで）
            var 行を集める=function(){ var cur=Array.from(ov.querySelectorAll('.set-page')).find(function(p){return p.style.display!=='none';});
              return cur?Array.from(cur.querySelectorAll('[data-setpage]')).map(function(x){return x.dataset.setpage;}):[]; };
            var root=Array.from(ov.querySelectorAll('.set-page')).find(function(p){return p.style.display!=='none';});
            var 最初=root?root.dataset.page:'?'; 測る(最初); 見たページ[最初]=1;
            var 一段=行を集める();
            for(var i=0;i<一段.length;i++){
              var pg=一段[i]; if(見たページ[pg]) continue;
              var row=ov.querySelector('.set-page[data-page="'+最初+'"] [data-setpage="'+pg+'"]'); if(!row) continue;
              row.click(); await sleep(200); 測る(pg); 見たページ[pg]=1;
              var 二段=行を集める();
              for(var j=0;j<二段.length;j++){
                var pg2=二段[j]; if(見たページ[pg2]) continue;
                var row2=ov.querySelector('.set-page[data-page="'+pg+'"] [data-setpage="'+pg2+'"]'); if(!row2) continue;
                row2.click(); await sleep(200); 測る(pg2); 見たページ[pg2]=1;
                var back=ov.querySelector('#setBackBtn, .set-back'); if(back) { back.click(); await sleep(200); }
              }
              var back1=ov.querySelector('#setBackBtn, .set-back'); if(back1) { back1.click(); await sleep(200); }
            }
            var close=document.getElementById('closeSettingsBtn'); if(close) close.click();
            return 出;
          })()`);
          console.log('■ 設定 ' + d.name + ' 文字 ' + f + '（' + 印 + '）：' + 結果.length + 'ページ／横のはみ出し ' +
            結果.filter((x) => x.横 > 0).length + '／44px未満の的があるページ ' + 結果.filter((x) => x.的.length).length);
          結果.forEach((x) => { if (x.横 > 0 || x.的.length) console.log('     ' + x.page + (x.横 ? ' 横+' + x.横 : '') + (x.的.length ? ' 的：' + x.的.join('／') : '')); });
          結果.forEach((x) => 全部.push({ 画面: d.name, 文字: f, 設定: x }));
        }
        await d.close();
        continue;
      }
      for (const f of 文字) {
        const 印 = await 開く(f);
        const res = await d.ev('window.__measure()');
        // 押す的は画面ごとに測る（__measure と同じ順に goToScreen する）
        const 的 = {};
        for (const row of res.rows) {
          if (row.len < 12) continue;
          try { await d.ev("(function(){window.goToScreen(" + JSON.stringify(row.id) + ");return true;})()"); } catch (e) { continue; }
          await sleep(40);
          const t = await d.ev(的を測る);
          if (t.length) 的[row.id] = t;
        }
        res.rows.forEach((r) => 全部.push(Object.assign({ 画面: d.name, 文字: f, 的: 的[r.id] || [] }, r)));
        const 中身あり = res.rows.filter((r) => r.len >= 12);
        const 縦 = 中身あり.filter((r) => r.over > 0);
        const 横 = 中身あり.filter((r) => r.xover > 0);
        const 主 = 中身あり.filter((r) => r.mb && !r.mb.入る);
        const 小 = Object.keys(的);
        console.log('  文字 ' + f + '（' + 印 + '）：測った ' + 中身あり.length + ' 画面（空の器 ' + (res.rows.length - 中身あり.length) + '）' +
          '／縦のはみ出し ' + 縦.length + '／横 ' + 横.length + '／主ボタンが見えない ' + 主.length + '／44px未満の的がある ' + 小.length);
        横.forEach((r) => console.log('     横 ' + r.id + ' +' + r.xover + 'px'));
        主.forEach((r) => console.log('     主ボタン ' + r.id + '「' + r.mb.札 + '」下端 ' + r.mb.bottom + ' > ' + res.fold));
      }
      await d.close();
    }
  } finally { await b.close(); }
  if (JSON_OUT) fs.writeFileSync(path.resolve(JSON_OUT), JSON.stringify(全部, null, 1));
})().catch((e) => { console.error('失敗：' + (e && e.stack || e)); process.exit(1); });
