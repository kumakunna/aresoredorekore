#!/usr/bin/env node
// tools/fx-press-probe.js — 「押した手ごたえ」（:active で沈む・明るくなる）を、本物の指で押して確かめる（指示62-3）
//
//   node tools/fx-press-probe.js --set 1 --port 3851 --cdp 9951
//
// 通しの台本（flow-walk）はボタンを click() で押すので、:active は一度も起きない。
// ここでは 375×667 の手元で、入口 → 棚 → ⚙設定の各ページ → 爆弾解除（手渡し）の設定〜準備の画面を歩き、
// 各画面で「:active の規則がある選択子」に当たる見えている要素を1つずつ、
// **指を置いたまま**にして、その間に
//   ・transition が始まったか（記録係の tr）と宣言の長さ
//   ・押している間の見た目（transform・filter・background）が押す前と変わったか
// を測り、**指をずらしてから離す**（押した先へ進まないように）。
//
// 出力：docs/監査_演出の画像/press/<set>.json

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const rec = require('./fx-recorder');
const { launch, sleep } = require('./cdp');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : argv[i + 1]; };
const SET = String(arg('set', '1'));
const 設定 = rec.SETTINGS[SET];
const PORT = String(arg('port', '3851'));
const BASE = 'http://localhost:' + PORT;
const OUT = path.join(__dirname, '..', 'docs', '監査_演出の画像', 'press');
const inv = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', '監査_演出の画像', 'inventory.json'), 'utf8'));

// :active の規則の選択子から、押す相手（:active を外したもの）を作る
const 相手 = [];
inv.手ごたえ.forEach((r) => r.選択子.split(',').forEach((s) => {
  const base = s.trim().replace(/::?-(webkit|moz)-[\w-]+/g, '').replace(/:active/g, '').replace(/\s+$/, '');
  if (base && 相手.indexOf(base) === -1) 相手.push({ 規則: r.選択子, 行: r.行, 選択子: base });
}));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  let server = null, up = false;
  try { up = (await fetch(BASE + '/')).ok; } catch (e) {}
  if (!up) {
    server = spawn(process.execPath, [path.join(__dirname, 'dev-server.js')], { env: Object.assign({}, process.env, { PORT }), stdio: 'ignore' });
    for (let i = 0; i < 60 && !up; i++) { await sleep(250); try { up = (await fetch(BASE + '/')).ok; } catch (e) {} }
  }
  const b = await launch({ port: parseInt(arg('cdp', '9951'), 10) });
  const d = await b.newDevice('手元', { width: 375, height: 667, mobile: false, deviceScaleFactor: 2 });
  await rec.attach(d, 設定.prefs);
  const 結果 = { 設定: 設定.名, 押した: [] };
  const 押した選択子 = {};

  /** いまの画面で、まだ押していない相手を全部押す */
  async function この画面で押す(どこ) {
    (結果.歩いた = 結果.歩いた || []).push(どこ + '（重なり ' + (await d.ev("Array.from(document.querySelectorAll('.ui-layer, .overlay.show')).filter(function(x){return x.getBoundingClientRect().width>0;}).map(function(x){return x.id||x.className;}).join(',')")) + '）');
    for (const t of 相手) {
      if (押した選択子[t.選択子]) continue;
      const c = await d.ev("(function(){var es=[];try{es=Array.from(document.querySelectorAll(" + JSON.stringify(t.選択子) + "));}catch(e){return null;}" +
        "var e=es.find(function(x){var r=x.getBoundingClientRect();return r.width>0&&r.height>0&&r.top>=0&&r.bottom<=innerHeight&&!x.disabled&&(typeof x.checkVisibility!=='function'||x.checkVisibility({opacityProperty:true,visibilityProperty:true}));});" +
        "if(!e) return null; var r=e.getBoundingClientRect(); var cs=getComputedStyle(e); window.__押す相手=e;" +
        "return {x:r.left+r.width/2,y:r.top+r.height/2,前:{transform:cs.transform,filter:cs.filter,bg:cs.backgroundColor,opacity:cs.opacity}};})()");
      if (!c) continue;
      // 上に何か重なっていて、その点を押すと別のものに当たる時は押さない
      const 当たる = await d.ev("(function(){var e=document.elementFromPoint(" + c.x + "," + c.y + ");return !!e && (e===window.__押す相手||window.__押す相手.contains(e));})()");
      if (!当たる) continue;
      await rec.take(d);
      // 指を置いたまま（マウスの押し下げ。headless の Chrome は touchStart では :active を付けなかった）
      await d.raw('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y });
      await d.raw('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', clickCount: 1 });
      await sleep(260);
      const 中 = await d.ev("(function(){var e=window.__押す相手;var cs=getComputedStyle(e);return {transform:cs.transform,filter:cs.filter,bg:cs.backgroundColor,opacity:cs.opacity,active:e.matches(':active')};})()");
      const ev = (await rec.take(d)).filter((x) => x.k === 'tr' && x.ev === 'start');
      // 離す前に指をずらす（押した先へ進まないように。押した要素の外の、何も無い隅で離す）
      await d.raw('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 660, button: 'left' });
      await d.raw('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 2, y: 660, button: 'left', clickCount: 1 });
      await sleep(250);
      const 変わった = ['transform', 'filter', 'bg', 'opacity'].filter((k) => c.前[k] !== 中[k]);
      押した選択子[t.選択子] = 1;
      結果.押した.push({ 規則: t.規則, 行: t.行, 選択子: t.選択子, 画面: どこ, 押している間: 中.active, 変わった, 前: c.前, 中,
        遷移: ev.map((x) => x.prop + ' ' + x.dur + ' ' + x.el.slice(0, 60)) });
    }
  }
  const 画面 = () => d.screen();
  try {
    await d.go(BASE + '/dev-login');
    await d.go(BASE + '/');
    await d.until("document.getElementById('safetyGate').style.display==='flex'||(document.querySelector('.screen.active')||{}).id!=='scr-door'", 10000, '起動');
    if (await d.ev("document.getElementById('safetyGate').style.display==='flex'")) { await d.click('#sgStartBtn'); await sleep(900); }
    await d.until("(document.querySelector('.screen.active')||{}).id==='scr-entry'", 10000, '入口');
    await この画面で押す('scr-entry');
    await d.click('[data-entry="choose"]'); await sleep(1200);
    await この画面で押す(await 画面());
    // ⚙ 設定：各ページ
    if (await d.ev("!!document.getElementById('floatingGearBtn')")) {
      await d.click('#floatingGearBtn'); await sleep(700);
      await この画面で押す('⚙設定（目次）');
      const pages = await d.ev("Array.from(document.querySelectorAll('#settingsOverlay [data-setpage]')).map(function(b){return b.dataset.setpage;})");
      for (const p of pages) {
        const ok = await d.ev("(function(){var b=document.querySelector('#settingsOverlay [data-setpage=\"" + p + "\"]'); if(!b) return false; b.click(); return true;})()");
        if (!ok) continue;
        await sleep(600);
        await この画面で押す('⚙設定：' + p);
        await d.ev("(function(){var b=document.querySelector('#setBackBtn'); if(b) b.click(); return true;})()");
        await sleep(500);
      }
      await d.ev("(function(){var b=document.querySelector('#closeSettingsBtn'); if(b) b.click(); return true;})()");
      await sleep(700);
    }
    // 爆弾解除（手渡し）：カセット → 遊び方 → ゲーム → 名前 → モード → 設定 → 準備
    await d.click('.cart[data-cart="bakudan"]'); await sleep(800);
    if ((await 画面()) === 'scr-shelf') { await d.click('.cart[data-cart="bakudan"]'); await sleep(1200); }
    for (let i = 0; i < 16; i++) {
      const scr = await 画面();
      await この画面で押す(scr);
      if (scr === 'scr-bomb-play') break;
      if (scr === 'scr-ready') {
        const c = await d.ev("(function(){var e=document.getElementById('holdBtn'); var r=e.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2};})()");
        await d.raw('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', clickCount: 1 });
        await sleep(1600);
        await d.raw('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', clickCount: 1 });
        await sleep(1500);
        continue;
      }
      // 「はじめてですね」のダイアログ：ダイアログのボタンも押してから、断る
      if (await d.ev("!!Array.from(document.querySelectorAll('.ui-layer button')).find(function(x){return /^いらない$/.test(x.textContent.trim());})")) await この画面で押す(scr + '（はじめてですね）');
      const 問い = await d.ev("(function(){var b=Array.from(document.querySelectorAll('.ui-layer button')).find(function(x){return /^いらない$/.test(x.textContent.trim());}); if(b){b.click();return true;} return false;})()");
      if (問い) { await sleep(500); continue; }
      if (scr === 'scr-play-way') await d.click('#wayChoices [data-way="handoff"]');
      else if (scr === 'scr-game') await d.ev("(function(){document.querySelector('#gameCards .mode-card[data-game=\"bomb\"]').click(); document.getElementById('gameNextBtn').click(); return true;})()");
      else if (scr === 'scr-setup') await d.ev("(function(){var ins=document.querySelectorAll('#scr-setup input.draft-name'); ['あき','びび'].forEach(function(n,i){ if(ins[i]){ ins[i].value=n; ins[i].dispatchEvent(new Event('input',{bubbles:true})); } }); document.getElementById('setupNextBtn').click(); return true;})()");
      else if (scr === 'scr-mode') await d.ev("(function(){document.querySelector('.mode-card[data-id=\"bomb-coop\"]').click(); document.getElementById('modeNextBtn').click(); return true;})()");
      else if (scr === 'scr-mode-rules') await d.click('#rulesStartBtn');
      else await d.ev("(function(){var n=Array.from(document.querySelectorAll('.screen.active [data-wiz-next]')).find(function(b){return b.getBoundingClientRect().width>0&&!b.disabled;}); if(n) n.click(); return true;})()");
      await sleep(1000);
    }
    // 爆弾の盤：コードと3択
    if ((await 画面()) === 'scr-countdown') await sleep(4000);
    if (await d.ev("(document.querySelector('.screen.active')||{}).id==='scr-bomb-play'")) {
      await sleep(800);
      await この画面で押す('scr-bomb-play（盤）');
      await d.ev("(function(){var b=document.querySelector('#bombWireList .bomb-wire-btn:not(.solved)'); if(b) b.click(); return true;})()");
      await sleep(900);
      await この画面で押す('scr-bomb-play（3択）');
    }
  } catch (e) {
    結果.失敗 = String(e && e.stack || e);
    console.error(結果.失敗);
  } finally {
    結果.押せなかった = 相手.filter((t) => !押した選択子[t.選択子]).map((t) => t.選択子);
    fs.writeFileSync(path.join(OUT, SET + '.json'), JSON.stringify(結果, null, 1));
    await b.close();
    if (server) server.kill();
  }
  console.log(設定.名 + '：押した ' + 結果.押した.length + ' ／ 押せなかった ' + 結果.押せなかった.length + ' ／ 見た目が変わった ' + 結果.押した.filter((x) => x.変わった.length).length);
  process.exit(結果.失敗 ? 1 : 0);
})();
