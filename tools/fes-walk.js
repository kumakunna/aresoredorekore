#!/usr/bin/env node
// tools/fes-walk.js — 文化祭の部屋（指示66-2）を、スマホ3台とTVで何周も回す（門1・門11）
//
//   node tools/fes-walk.js                       … 3周（いまの候補はクイズ解除だけ。投票を飛ばして回る・指示68-1）
//   node tools/fes-walk.js --laps 3 --fx skip    … 演出「なし」で回す（門11）
//   --games bomb-coop,shinka,rcard   周ごとに投票するゲーム（ほかの候補を on にした部屋で）（足りなければ頭から繰り返す）
//   --games onaji-many               係の入／切で「切」のゲームは、係が部屋を作った直後に入にする（指示68-T 二の束1）
//   --port 3301  --cdp 9701  --out DIR（既定 docs/監査_指示66の画像/fes-walk）
//
// **係は部屋を作るだけ。そのあと係の操作は1つもしない**（「人がいなくても回る」を確かめるため）。
// スマホは、投票と準備OKを押すだけ。遊んでいる間はゲームに任せる（ゲームの締め切りで進む）。
// クイズ解除だけは、決着を早めるために1台が3択の1つ目を押し続ける（外れたら爆発）。
// 3台目は「つづける？」を押さない（押さなければ「つづける」になるのを見る）。
// 記録：周ごとの段階と時刻・画面の例外・写真。検証用サーバーは自分で立てる（立っていればそれを使う）。
// 検証の Chrome は音を消してある（tools/cdp.js の --mute-audio）

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { launch, sleep } = require('./cdp');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const PORT = +arg('port', 3301), CDP = +arg('cdp', 9701), LAPS = +arg('laps', 3), FX = arg('fx', 'normal');
const GAMES = String(arg('games', 'bomb-coop')).split(',');
const OUT = path.resolve(arg('out', path.join(ROOT, 'docs', '監査_指示66の画像', 'fes-walk' + (FX === 'skip' ? '-skip' : ''))));

const 記録 = { いつ: new Date().toISOString(), 演出: FX, 周: [], 例外: [], 失敗: null };
const t0 = Date.now();
const log = (...a) => { const line = ((Date.now() - t0) / 1000).toFixed(1).padStart(6) + 's ' + a.join(' '); console.log(line); };

async function サーバー() {
  const base = 'http://localhost:' + PORT;
  let up = false;
  try { up = (await fetch(base + '/')).ok; } catch (e) {}
  if (up) return { base, child: null };
  const out = fs.openSync(path.join(require('os').tmpdir(), 'fes-walk-server-' + PORT + '.log'), 'w');
  const child = spawn(process.execPath, [path.join(__dirname, 'dev-server.js')], { env: Object.assign({}, process.env, { PORT: PORT }), stdio: ['ignore', out, out] });
  for (let i = 0; i < 80 && !up; i++) { await sleep(250); try { up = (await fetch(base + '/')).ok; } catch (e) {} }
  if (!up) throw new Error('検証用サーバーが立ちません（port ' + PORT + '）');
  return { base, child };
}

/** 開いて、安全の案内（はじめの1回）と扉を通す。演出の速さは開く前に端末へ入れておく */
async function 開く(d, base, url) {
  await d.go(base + '/');
  await d.ev("(function(){ localStorage.setItem('acac-app-prefs', JSON.stringify({fxSpeed:" + JSON.stringify(FX) + "})); return 1; })()");
  await d.go(base + url);
  for (let i = 0; i < 40; i++) {
    const st = await d.ev("({gate:(function(){var g=document.getElementById('safetyGate');return !!g&&getComputedStyle(g).display!=='none';})(),scr:(document.querySelector('.screen.active')||{}).id})");
    if (st.gate) { await d.ev("document.getElementById('sgStartBtn').click()"); await sleep(300); continue; }
    if (st.scr && st.scr !== 'scr-door') return st.scr;
    await d.ev("(function(){var p=document.getElementById('doorPanel');if(p)p.click();})()"); await sleep(300);
  }
  return d.screen();
}
const 画面 = (d) => d.screen();
/** 進化じゃんけん・ロシアンカードで、押せる所を1つ押す（ページの中で評価する式） */
const 自動で遊ぶ = "(function(){var s=(document.querySelector('.screen.active')||{}).id;" +
  "function pick(sel){var a=[].slice.call(document.querySelectorAll(sel)).filter(function(b){return !b.disabled&&b.offsetParent!==null;});return a.length?a[Math.floor(Math.random()*a.length)]:null;}" +
  "if(s==='scr-rt-sh-play'||s==='scr-rt-sh-match'){var h=pick('#'+s+' [data-sh-hand]');if(h){h.click();return 'hand';}}" +
  "if(s==='scr-rt-rc-place'){var c=pick('#rcPlaceBoard [data-rc-cell]');if(c)c.click();var d=document.getElementById('rcPlaceDoneBtn');if(d&&!d.disabled&&d.offsetParent!==null){d.click();return 'place';}return 'pick';}" +
  "if(s==='scr-rt-rc-play'){var f=pick('#rcPlayBoard [data-rc-cell]');if(f){f.click();return 'flip';}}" +
  "if(s==='scr-v2-onaji'){var o=pick('#scr-v2-onaji [data-onaji-pick]:not([aria-disabled=true])');if(o){o.click();return 'pick';}}" +
  "if(s==='scr-v2-pittari'){var p=pick('#scr-v2-pittari [data-pt-stop]');if(p){p.click();return 'stop';}}" +
  "if(s==='scr-v2-soroe'){var f=pick('#scr-v2-soroe [data-so-fire]');if(f){f.click();return 'fire';}}" +
  "return s;})()";
const 押す = (d, sel) => d.ev('(function(){var b=document.querySelector(' + JSON.stringify(sel) + ');if(b&&!b.disabled){b.click();return true;}return false;})()');
async function 撮る(d, name) { try { await d.shot(path.join(OUT, name + '.jpg')); } catch (e) {} }
/** 文化祭の部屋の段階（スマホの画面から読む。描いた画面の目印で） */
const 段階 = (d) => d.ev("(function(){var s=(document.querySelector('.screen.active')||{}).id;if(s!=='scr-v2-fes-lobby'&&s!=='scr-v2-fes-tv')return s;" +
  "var q=function(x){return !!document.querySelector('#'+s+' '+x);};" +
  "return q('.v2-vlist')||q('.v2-tvVote')?'vote':q('.v2-dec')||q('.v2-tdec2')?'decide':q('[data-fes-act=ready],[data-fes-unready]')||q('.v2-tvB')?'ready':q('.v2-contsheet')||q('.v2-tend')?'result':q('.v2-tvIdle')?'idle':'lobby';})()");

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.readdirSync(OUT).filter((f) => /\.(jpg|json)$/.test(f)).forEach((f) => fs.unlinkSync(path.join(OUT, f)));
  const { base, child } = await サーバー();
  const b = await launch({ port: CDP });
  const devs = [];
  try {
    // 係：部屋を作り直す（まっさらから）。**ここから先、係は何も押さない**
    const staff = await b.newDevice('係', { width: 390, height: 844, mobile: true }); devs.push(staff);
    await staff.go(base + '/dev-login');
    await 開く(staff, base, '/fes?staff=1');
    await sleep(800);
    if (!(await 押す(staff, '[data-fes-act=create]'))) { await 押す(staff, '[data-v2-open="#v2Recreate"]'); await sleep(400); await 押す(staff, '[data-v2-act=recreate]'); }
    await sleep(1500);
    log('係が部屋を作った');
    // 指示68-T 二の束1：回すゲームが「切」なら、係（くまくん）が入／切の「切」を押して入にする（部屋を作る支度の一部。そのあとは何も押さない）
    for (const m of GAMES.filter((x, i, a) => a.indexOf(x) === i)) {
      const sel = '[data-fes-game="' + m + '"]';
      if (!(await staff.ev('!!document.querySelector(' + JSON.stringify(sel) + ')'))) continue;
      if (await staff.ev('!document.querySelector(' + JSON.stringify(sel) + ').getAttribute("data-on")')) {
        await 押す(staff, sel); await sleep(600);
        log('係が ' + m + ' を入にした');
      }
    }
    const tv = await b.newDevice('TV', { width: 1280, height: 720 }); devs.push(tv);
    log('TV', await 開く(tv, base, '/fes?tv=1'));
    const names = ['ふう', 'ひろ', 'びび'], diffs = ['easy', 'normal', 'hard'];
    const ph = [];
    for (let i = 0; i < 3; i++) {
      const d = await b.newDevice('スマホ' + (i + 1), { width: 390, height: 844, mobile: true }); devs.push(d);
      await 開く(d, base, '/fes');
      await d.ev("(function(){var n=document.querySelector('[data-fes-name]');n.value=" + JSON.stringify(names[i]) + ";n.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()");
      await 押す(d, '[data-fes-diff=' + diffs[i] + ']'); await sleep(150);
      await 押す(d, '[data-fes-act=join]');
      await d.until("(document.querySelector('.screen.active')||{}).id==='scr-v2-fes-lobby'", 10000, '入れた');
      ph.push(d);
    }
    log('3人入った');
    for (let lap = 1; lap <= LAPS; lap++) {
      const mode = GAMES[(lap - 1) % GAMES.length];
      const 周 = { 周: lap, 投票: mode, 段階: [] };
      記録.周.push(周);
      const 着いた = (s) => { 周.段階.push({ 段階: s, 秒: +((Date.now() - t0) / 1000).toFixed(1) }); log('周' + lap, s); };
      // 指示68-1：候補が1つの時（いまはクイズ解除だけ）は投票を飛ばして決定のカードへ。どちらが来たかを記録する
      await ph[0].until("!!document.querySelector('#scr-v2-fes-lobby .v2-vlist')||!!document.querySelector('#scr-v2-fes-lobby .v2-dec')", 90000, '投票か決定へ');
      周.投票を飛ばした = await ph[0].ev("!document.querySelector('#scr-v2-fes-lobby .v2-vlist')");
      if (!周.投票を飛ばした) {
        着いた('投票'); await 撮る(ph[0], lap + '_1_投票'); await 撮る(tv, lap + '_1_投票_TV');
        // TV に票の数が出ていないこと（門4）：投票中の TV の字に「人」の数字が無い
        周.TVに票の数 = await tv.ev("/\\d+\\s*(人|票)/.test((document.querySelector('#scr-v2-fes-tv .v2-vrows')||{}).innerText||'')");
        for (const d of ph) { await 押す(d, '[data-fes-pick="' + mode + '"]'); await sleep(120); await 押す(d, '[data-fes-act=vote]'); }
      } else {
        着いた('投票を飛ばした');
        周.決定の字 = await ph[0].ev("(document.querySelector('#scr-v2-fes-lobby .v2-dec')||{}).innerText||''");
      }
      await ph[0].until("!!document.querySelector('#scr-v2-fes-lobby .v2-dec')", 40000, '決定');
      着いた('決定'); await sleep(2500); await 撮る(ph[0], lap + '_2_決定'); await 撮る(tv, lap + '_2_決定_TV');
      await ph[0].until("!!document.querySelector('[data-fes-act=ready]')", 20000, '準備OK');
      着いた('準備OK');
      for (const d of ph) await 押す(d, '[data-fes-act=ready]');
      await sleep(500); await 撮る(tv, lap + '_3_準備_TV');
      // 遊ぶ画面へ：ほかのゲームは今の画面へ移る。クイズ解除（協力版）の解除中は、新しい見た目の盤（F11）のまま
      await ph[0].until("(document.querySelector('.screen.active')||{}).id!=='scr-v2-fes-lobby'||!!document.querySelector('#scr-v2-fes-lobby .v2-bgrid')", 40000, '遊ぶ');
      着いた('遊ぶ:' + (await 画面(ph[0]))); await sleep(4000); await 撮る(ph[0], lap + '_4_遊ぶ'); await 撮る(tv, lap + '_4_遊ぶ_TV');
      // 遊ぶ間：クイズ解除だけは決着を早める。ほかはゲームの締め切りに任せる（押せる所を押すだけ）
      const until = Date.now() + 6 * 60 * 1000;
      while (Date.now() < until) {
        if (await ph[0].ev("!!document.querySelector('#scr-v2-fes-lobby .v2-contsheet')")) break;
        if (mode === 'bomb-coop') {
          // 新しい見た目の盤（F11）：空いているマスを押して、3択の1つ目を押す（外れたら爆発）
          await ph[0].ev("(async function(){var b=document.querySelector('#scr-v2-fes-lobby .v2-bcell:not(:disabled)');if(!b)return 0;b.click();for(var i=0;i<20&&!document.querySelector('#scr-v2-fes-lobby [data-fes-ans]');i++)await new Promise(function(r){setTimeout(r,100);});var a=document.querySelector('#scr-v2-fes-lobby [data-fes-ans]');if(a)a.click();return 1;})()");
        } else {
          // 進化じゃんけん・ロシアンカード：遊ぶ人がするように、押せる所を押す（手を出す・しかける・めくる）。
          // だれも押さないと、進化じゃんけんは10分の打ち切りまで続く（ゲームの決まり）
          for (const d of ph) await d.ev(自動で遊ぶ).catch(() => null);
        }
        await sleep(1000);
      }
      await ph[0].until("!!document.querySelector('#scr-v2-fes-lobby .v2-contsheet')", 30000, '結果');
      着いた('結果'); await sleep(800); await 撮る(ph[0], lap + '_5_結果'); await 撮る(tv, lap + '_5_結果_TV');
      await 押す(ph[0], '[data-fes-act=continue]'); await 押す(ph[1], '[data-fes-act=continue]');   // 3台目は押さない
      await ph[0].until("!!document.querySelector('#scr-v2-fes-lobby .v2-facesbtn')", 40000, '待合へ');
      着いた('待合'); await sleep(600); await 撮る(ph[0], lap + '_6_待合'); await 撮る(tv, lap + '_6_待合_TV');
      周.残った人 = await tv.ev("(document.querySelectorAll('#scr-v2-fes-tv .v2-tmem')||[]).length");
      周.完了 = true;
    }
  } catch (e) {
    記録.失敗 = String(e && e.stack || e);
    console.error('失敗：' + 記録.失敗);
  } finally {
    devs.forEach((d) => { if (d.logs && d.logs.length) 記録.例外.push({ 端末: d.name, 中身: d.logs.slice(0, 10) }); });
    fs.writeFileSync(path.join(OUT, '記録.json'), JSON.stringify(記録, null, 1));
    await b.close();
    if (child) { try { child.kill(); } catch (e) {} }
  }
  const 回った = 記録.周.filter((x) => x.完了).length;
  console.log((回った === LAPS && !記録.例外.length ? '✔ ' : '✖ ') + LAPS + '周のうち ' + 回った + '周 回った（演出 ' + FX + '）・画面の例外 ' + 記録.例外.length + '台・' +
    ((Date.now() - t0) / 1000).toFixed(0) + '秒。記録：' + path.relative(ROOT, OUT));
  process.exitCode = (回った === LAPS && !記録.例外.length) ? 0 : 1;
})();
