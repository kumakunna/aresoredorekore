#!/usr/bin/env node
// tools/old-screens-walk.js — 古い見た目のままの画面を、本物のサーバーで撮る（指示68-0a M6・M7）
//
//   node tools/old-screens-walk.js --part gear    … ⚙ から開く画面（設定の全ページ・ログイン・新しく登録・称号・達成状況・
//                                                     遊んだ記録・名前を変える）と、待合の ⚙（アルバム・ルールをもう一度みんなに見せる）
//   node tools/old-screens-walk.js --part rules   … ルールと準備OK（scr-rt-rules）：爆弾解除・人狼 × 進行役・参加者・TV。
//                                                     あれそれどれこれは部屋で遊べないので、1台のルール（scr-mode-rules）と「準備はいい？」
//   --out DIR（既定 docs/監査_指示66の画像/材料68）  --port 3310  --cdp 9710  --fx normal|skip
//
// スマホは 390×844 と 375×667 の両方を撮る（同じ端末のまま大きさだけ変えて撮り直す）。TV は 1920×1080。
// 中が巻ける画面は、いちばん下まで送った写真（…_下）も撮る。
// 進行役は /dev-login（検証用ユーザー）、参加者はログインしない別の端末（127.0.0.1・別の localStorage）。
// 押すのは本物の画面のボタン（click()）。アプリの中身は変えない。
// 写真と 記録.json は OUT/gear・OUT/rules（git に入れない置き場）。検証の Chrome は音を消してある（tools/cdp.js）

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { launch, sleep } = require('./cdp');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const PART = arg('part', 'gear'), PORT = +arg('port', 3310), CDP = +arg('cdp', 9710), FX = arg('fx', 'normal');
const OUT = path.resolve(arg('out', path.join(ROOT, 'docs', '監査_指示66の画像', '材料68')), PART);
const PHONES = [{ w: 390, h: 844 }, { w: 375, h: 667 }];
const 記録 = { いつ: new Date().toISOString(), part: PART, 演出: FX, 写真: [], 手順: [], 失敗: null, 例外: {} };
const t0 = Date.now();
const log = (...a) => { const line = ((Date.now() - t0) / 1000).toFixed(1).padStart(6) + 's ' + a.join(' '); console.log(line); 記録.手順.push(line); };

async function サーバー() {
  const base = 'http://localhost:' + PORT;
  let up = false;
  try { up = (await fetch(base + '/')).ok; } catch (e) {}
  if (up) return { child: null };
  const out = fs.openSync(path.join(require('os').tmpdir(), 'old-screens-walk-' + PORT + '.log'), 'w');
  const child = spawn(process.execPath, [path.join(__dirname, 'dev-server.js')], { env: Object.assign({}, process.env, { PORT: PORT }), stdio: ['ignore', out, out] });
  for (let i = 0; i < 80 && !up; i++) { await sleep(250); try { up = (await fetch(base + '/')).ok; } catch (e) {} }
  if (!up) throw new Error('検証用サーバーが立ちません（port ' + PORT + '）');
  return { child };
}

/** 開いて、扉を通す（安全の案内は撮らない：新しい見た目の F1 として v2-shot が撮っている） */
async function 開く(d, base, url) {
  await d.go(base + '/');
  await d.ev("(function(){ localStorage.setItem('acac-app-prefs', JSON.stringify({fxSpeed:" + JSON.stringify(FX) + "})); localStorage.setItem('acac-safety-seen','1'); return 1; })()");
  await d.go(base + url);
  await d.until("(document.querySelector('.screen.active')||{}).id && (document.querySelector('.screen.active')||{}).id !== 'scr-door'", 12000, d.name + '：扉が開く');
}
const 押す = async (d, sel) => {
  const ok = await d.ev('(function(){var b=document.querySelector(' + JSON.stringify(sel) + ');if(b&&!b.disabled){b.click();return true;}return false;})()');
  if (!ok) throw new Error(d.name + '：押せません ' + sel);
};
/** 字で探して押す（見えているボタンだけ） */
const 字で押す = async (d, re, scope) => {
  const t = await d.ev("(function(){var re=new RegExp(" + JSON.stringify(re.source) + ");var bs=Array.from(document.querySelectorAll(" + JSON.stringify(scope || 'button') + ")).filter(function(b){var r=b.getBoundingClientRect();return r.width>0&&r.height>0&&re.test((b.innerText||b.textContent||'').trim());});" +
    "var b=bs[bs.length-1]; if(!b) return null; b.click(); return (b.innerText||b.textContent).trim().replace(/\\s+/g,' ');})()");
  if (!t) throw new Error(d.name + '：押すものが見つかりません ' + re);
  return t;
};
const 画面 = (d) => d.screen();
const 画面は = (d, id, ms) => d.until("(document.querySelector('.screen.active')||{}).id===" + JSON.stringify(id), ms || 12000, d.name + '：' + id);

/** いまの形（記録に残す）：画面・開いている重なり・新しい見た目のシート */
const いまの形 = "(function(){ var a=(document.querySelector('.screen.active')||{}).id||null;" +
  "var ov=Array.from(document.querySelectorAll('.overlay.show')).map(function(o){return o.id||String(o.className);});" +
  "var ui=Array.from(document.querySelectorAll('#uiLayerRoot > *')).filter(function(o){return o.getBoundingClientRect().width>0&&(typeof o.checkVisibility!=='function'||o.checkVisibility({opacityProperty:true,visibilityProperty:true}));}).map(function(o){return String(o.className).split(' ')[0];});" +
  "var v2=Array.from(document.querySelectorAll('.v2-sheet.is-open,.v2-dlg.is-open')).map(function(o){return o.getAttribute('data-v2-id')||String(o.className);});" +
  "var sp=document.getElementById('settingsOverlay'); var pg=sp&&sp.classList.contains('show')?Array.from(sp.querySelectorAll('.set-page')).filter(function(p){return p.style.display==='block';}).map(function(p){return p.dataset.page;}):[];" +
  "return { 画面:a, 重なり:ov, ui:ui, v2:v2, 設定のページ:pg }; })()";

/**
 * いちばん上の層の中で、巻ける箱を探す（重なり → シート → 画面 → ページ全体の順）。
 * to：'end'＝いちばん下へ、'top'＝上へ。返り値：巻けたか
 */
// 見えていない層（称号の知らせ title-toast は、出ていない間も幅を持って #uiLayerRoot にいる）は「いちばん上」に数えない
const 巻く = (to) => "(function(){ function 見える(o){ var r=o.getBoundingClientRect(); if(r.width<1||r.height<1||r.bottom<=0||r.top>=innerHeight) return false;" +
  " return typeof o.checkVisibility==='function'?o.checkVisibility({opacityProperty:true,visibilityProperty:true}):true; }" +
  " var tops=[].concat(Array.from(document.querySelectorAll('#uiLayerRoot > *')).filter(見える).slice(-1)," +
  "Array.from(document.querySelectorAll('.v2-dlg.is-open,.v2-sheet.is-open')).slice(-1), Array.from(document.querySelectorAll('.overlay.show')).slice(-1), [document.querySelector('.screen.active')]).filter(Boolean);" +
  "var top=tops[0]; if(!top) return false; var best=null, area=0;" +
  "[top].concat(Array.from(top.querySelectorAll('*'))).forEach(function(e){ var cs=getComputedStyle(e); if(!/(auto|scroll)/.test(cs.overflowY)) return; if(e.scrollHeight<=e.clientHeight+8) return;" +
  "  var r=e.getBoundingClientRect(); if(r.width*r.height>area){ area=r.width*r.height; best=e; } });" +
  "var se=document.scrollingElement; if(!best && se && se.scrollHeight>se.clientHeight+8 && top.classList.contains('screen')) best=se;" +
  "if(!best) return false; best.scrollTop=" + (to === 'end' ? 'best.scrollHeight' : '0') + "; return true; })()";

async function 大きさ(d, s) {
  await d.raw('Emulation.setDeviceMetricsOverride', { width: s.w, height: s.h, deviceScaleFactor: 2, mobile: true });
  await sleep(450);
}
/** スマホ：2つの大きさで撮る（巻ける時は下まで送ったものも）。終わったら最初の大きさにもどす */
async function 撮る(d, name) {
  for (const s of PHONES) {
    await 大きさ(d, s);
    await d.ev(巻く('top'));
    await sleep(FX === 'skip' ? 150 : 500);
    const f = path.join(OUT, name + '_' + s.w + 'x' + s.h + '.jpg');
    await d.shot(f);
    const 形 = await d.ev(いまの形);
    記録.写真.push({ 名前: path.basename(f), 端末: d.name, 形 });
    if (await d.ev(巻く('end'))) {
      await sleep(350);
      const f2 = path.join(OUT, name + '_' + s.w + 'x' + s.h + '_下.jpg');
      await d.shot(f2);
      記録.写真.push({ 名前: path.basename(f2), 端末: d.name, 形, 巻いた: true });
      await d.ev(巻く('top'));
    }
  }
  await 大きさ(d, PHONES[0]);
  log('撮った', name);
}
async function TVを撮る(d, name) {
  await sleep(FX === 'skip' ? 200 : 700);
  const f = path.join(OUT, name + '_1920x1080.jpg');
  await d.shot(f);
  記録.写真.push({ 名前: path.basename(f), 端末: d.name, 形: await d.ev(いまの形) });
  log('撮った', name, '（TV）');
}
/** いちばん上の重なりを閉じる（新しい見た目のシート → UiKit の層 → 古い重なりの ✕） */
async function 閉じる(d) {
  await d.ev("(function(){ if(window.V2 && V2.closeTop && V2.closeTop()) return 'v2'; if(window.UiKit && UiKit.closeTop && document.querySelector('#uiLayerRoot > *')){ UiKit.closeTop(); return 'ui'; }" +
    "var ov=Array.from(document.querySelectorAll('.overlay.show')).slice(-1)[0]; var x=ov&&ov.querySelector('.close-x'); if(x){ x.click(); return 'x'; } return null; })()");
  await sleep(450);
}

/** 進行役が入口の「部屋をつくる」で部屋をつくる。コードを返す */
async function 部屋をつくる(h, hb) {
  await 開く(h, hb, '/');
  await 画面は(h, 'scr-v2-home');
  await 押す(h, '#scr-v2-home [data-home-act="make"]');
  await 画面は(h, 'scr-v2-room');
  return h.ev("document.querySelector('#scr-v2-room .v2-ecode b').textContent.trim()");
}
async function 参加者が入る(g, gb, code, name) {
  await 開く(g, gb, '/?room=' + code);
  await g.until("!!document.querySelector('#scr-v2-join [data-home-name]')", 10000, '参加者：名前の画面');
  await g.ev("(function(){var i=document.querySelector('#scr-v2-join [data-home-name]'); i.value=" + JSON.stringify(name) + "; i.dispatchEvent(new Event('input',{bubbles:true})); return 1;})()");
  await 押す(g, '#scr-v2-join [data-home-act="join-go"]');
  await g.until("['scr-v2-room','scr-rt-rules'].indexOf((document.querySelector('.screen.active')||{}).id)!==-1", 10000, '参加者：待合');
}
async function TVが入る(t, hb, code) {
  await 開く(t, hb, '/tv');
  await t.until("!!document.querySelector('#scr-v2-join [data-home-code]')", 10000, 'TV：コードの画面');
  await t.ev("(function(){var i=document.querySelector('#scr-v2-join [data-home-code]'); i.value=" + JSON.stringify(code) + "; i.dispatchEvent(new Event('input',{bubbles:true})); return 1;})()");
  await 押す(t, '#scr-v2-join [data-home-act="code-go"]');
  await t.until("['scr-v2-room-tv','scr-rt-big'].indexOf((document.querySelector('.screen.active')||{}).id)!==-1", 10000, 'TV：待合');
}
/**
 * 進行役：待合（または ⚙ の「えらびなおす」）から一覧 → 札 → ページの「このゲームにする」→ S4 は既定のまま。
 * ルールと準備OK（scr-rt-rules）に着いたら止まる（押さない）
 */
async function ゲームを決める(h, cassetteId) {
  if (await h.ev("!!document.querySelector('#scr-v2-room [data-home-act=\"room-pick\"]')")) await 押す(h, '#scr-v2-room [data-home-act="room-pick"]');
  else { await 押す(h, '#scr-v2-room [data-v2-act="gear"]'); await sleep(400); await 押す(h, '#scr-v2-room [data-v2-id="v2RoomMenu"] [data-home-act="room-pick"]'); }
  await 画面は(h, 'scr-v2-pick');
  await h.tap('#scr-v2-pick [data-home-id="' + cassetteId + '"] .v2-tile');
  await h.until("(function(){var o=document.querySelector('#scr-v2-pick [data-home-ov]');return !!o&&o.classList.contains('is-open');})()", 5000, 'ページが開く');
  await sleep(300);
  await 押す(h, '#scr-v2-pick [data-home-act="pick-go"]');
  for (let i = 0; i < 30; i++) {
    const s = await 画面(h);
    if (s === 'scr-rt-rules') return;
    if (s === 'scr-game') await 押す(h, '#gameNextBtn');
    else if (s === 'scr-mode') await 押す(h, '#modeNextBtn');
    else if (s === 'scr-mode-rules') await 押す(h, '#rulesStartBtn');
    else if (s === 'scr-v2-room' && i > 3) return;
    else if (s !== 'scr-v2-pick') {
      // 設定の画面（scr-set-*）は既定のまま「つぎへ」（tools/flow-walk.js の 設定を進める と同じ見方）
      await h.ev("(function(){var n=Array.from(document.querySelectorAll('.screen.active [data-wiz-next]')).find(function(b){return b.getBoundingClientRect().width>0&&!b.disabled;}); if(n) n.click(); return !!n;})()");
    }
    await sleep(400);
  }
  throw new Error('ゲームを決められません（いま ' + (await 画面(h)) + '）');
}

// ======================== M6：⚙ から開く画面 ========================
async function gear(b, hb, gb) {
  const h = await b.newDevice('進行役', { width: 390, height: 844, mobile: true, deviceScaleFactor: 2 });
  const g = await b.newDevice('参加者', { width: 390, height: 844, mobile: true, deviceScaleFactor: 2 });
  記録.例外 = { 進行役: h.logs, 参加者: g.logs };
  // ---- ログインしていない人：⚙ → 設定 → ログイン → 新しく登録 ----
  await 開く(g, gb, '/');
  await 画面は(g, 'scr-v2-home');
  await 押す(g, '#scr-v2-home [data-v2-act="gear"]');
  await g.until("document.getElementById('settingsOverlay').classList.contains('show')", 5000, '設定が開く');
  await 撮る(g, 'g01-設定-ログインしていない');
  await 押す(g, '#settingsLoginBtn');
  await 画面は(g, 'scr-login');
  await 撮る(g, 'g02-ログイン');
  await 押す(g, '#loginToggleBtn');
  await sleep(400);
  await 撮る(g, 'g03-新しく登録');

  // ---- ログインした人：⚙ → 設定の全ページ ----
  await h.go(hb + '/dev-login');
  await 開く(h, hb, '/');
  await 画面は(h, 'scr-v2-home');
  await 押す(h, '#scr-v2-home [data-v2-act="gear"]');
  await h.until("document.getElementById('settingsOverlay').classList.contains('show')", 5000, '設定が開く');
  await 撮る(h, 'g10-設定');
  const pages = await h.ev("Array.from(document.querySelectorAll('#settingsOverlay .set-page')).filter(function(p){return p.style.display==='block';})[0].querySelectorAll('.set-row[data-setpage]').length");
  const rows = await h.ev("Array.from(Array.from(document.querySelectorAll('#settingsOverlay .set-page')).filter(function(p){return p.style.display==='block';})[0].querySelectorAll('.set-row[data-setpage]')).map(function(r){return r.dataset.setpage;})");
  log('設定のページ', pages, rows.join(','));
  let k = 11;
  for (const p of rows) {
    // 「記録を見る」を開くと設定は閉じる。閉じていたら ⚙ から開き直す（最初のページ＝アプリの設定にもどる）
    if (!(await h.ev("document.getElementById('settingsOverlay').classList.contains('show')"))) {
      await 押す(h, '#scr-v2-home [data-v2-act="gear"]');
      await h.until("document.getElementById('settingsOverlay').classList.contains('show')", 5000, '設定が開く');
    }
    await 押す(h, '#settingsOverlay .set-row[data-setpage="' + p + '"]');
    await sleep(400);
    await 撮る(h, 'g' + (k++) + '-設定-' + p);
    if (p === 'records') {
      // 遊んだ記録（記録を見る）
      await 押す(h, '#openRecordsBtn');
      await h.until("document.getElementById('recordsOverlay').classList.contains('show')", 6000, '記録が開く');
      await sleep(800);
      await 撮る(h, 'g' + (k++) + '-遊んだ記録');
      await 押す(h, '#closeRecordsBtn');
      await sleep(400);
      continue;
    }
    await 押す(h, '#setBackBtn');
    await sleep(350);
  }
  if (!(await h.ev("document.getElementById('settingsOverlay').classList.contains('show')"))) {
    await 押す(h, '#scr-v2-home [data-v2-act="gear"]');
    await h.until("document.getElementById('settingsOverlay').classList.contains('show')", 5000, '設定が開く');
  }
  // ---- 称号（アイコン・二つ名）→ 達成状況・名前を変える ----
  await 押す(h, '#settingsOverlay .set-row[data-setact="titles"]');
  await 画面は(h, 'scr-titles');
  await sleep(500);
  await 撮る(h, 'g30-称号');
  if (await h.ev("!!document.querySelector('#scr-titles [data-tsheet]')")) {
    await 押す(h, '#scr-titles [data-tsheet]');
    await sleep(700);
    await 撮る(h, 'g31-達成状況');
    await 閉じる(h);
  } else log('達成状況の札が無い（記録が無い？）');
  await 押す(h, '#profIconBtn'); await sleep(700); await 撮る(h, 'g32-アイコンをえらぶ'); await 閉じる(h);
  await 押す(h, '#profNameBtn'); await sleep(700); await 撮る(h, 'g33-二つ名をえらぶ'); await 閉じる(h);
  await 押す(h, '#scr-titles [data-profgo="rename"]');
  await 画面は(h, 'scr-rename');
  await 撮る(h, 'g34-名前を変える');
  await 押す(h, '#renameBackBtn');
  await sleep(500);

  // ---- 待合の ⚙：アルバム・ルールをもう一度みんなに見せる ----
  const code = await 部屋をつくる(h, hb);
  log('部屋', code);
  await 押す(h, '#scr-v2-room [data-v2-act="gear"]');
  await sleep(500);
  await 撮る(h, 'g40-待合の歯車');
  await 押す(h, '#scr-v2-room [data-v2-id="v2RoomMenu"] [data-home-act="room-album"]');
  await sleep(700);
  await 撮る(h, 'g41-アルバム');
  await 閉じる(h);
  await 参加者が入る(g, gb, code, 'ひろ');
  await ゲームを決める(h, 'bakudan');
  // 進行役はルールを読んで準備OK → 待合（決めたあと）。参加者は読まずに待つ（押すと始まってしまう）
  await 押す(h, '#rtRulesOkBtn');
  await 画面は(h, 'scr-v2-room');
  await sleep(600);
  await 押す(h, '#scr-v2-room [data-v2-act="gear"]');
  await sleep(500);
  await 撮る(h, 'g42-待合の歯車-決めたあと');
  await 押す(h, '#scr-v2-room [data-v2-id="v2RoomMenu"] [data-home-act="room-reshow"]');
  await sleep(700);
  await 撮る(h, 'g43-ルールをもう一度みんなに見せる');
  await 閉じる(h);
}

// ======================== M7：ルールと準備OK ========================
async function rules(b, hb, gb) {
  const h = await b.newDevice('進行役', { width: 390, height: 844, mobile: true, deviceScaleFactor: 2 });
  const g = await b.newDevice('参加者', { width: 390, height: 844, mobile: true, deviceScaleFactor: 2 });
  const t = await b.newDevice('TV', { width: 1920, height: 1080, mobile: false, deviceScaleFactor: 1 });
  記録.例外 = { 進行役: h.logs, 参加者: g.logs, TV: t.logs };
  await h.go(hb + '/dev-login');
  const code = await 部屋をつくる(h, hb);
  log('部屋', code);
  await 参加者が入る(g, gb, code, 'ひろ');
  await TVが入る(t, hb, code);
  // 人狼は人数が要るので bot 2人を入れる（準備OKは押さない＝勝手に始まらない）
  const botLog = fs.openSync(path.join(OUT, 'bots.log'), 'w');
  const bots = spawn(process.execPath, [path.join(__dirname, 'room-bots.js'), '--url', hb, '--code', code, '--n', '2', '--hold', '900'], { stdio: ['ignore', botLog, botLog] });
  try {
    await h.until("document.querySelectorAll('#scr-v2-room .v2-mems .v2-mem').length>=4", 15000, 'bot が名簿に載る');
    for (const [id, 名] of [['bakudan', '爆弾解除'], ['jinro', '人狼']]) {
      await ゲームを決める(h, id);
      await g.until("(document.querySelector('.screen.active')||{}).id==='scr-rt-rules'", 10000, '参加者：ルール');
      await sleep(1800);   // 決めた時のカード（1.5秒）が消えてから
      const gname = await h.ev("(document.querySelector('#scr-rt-rules h2,#scr-rt-rules .scr-title')||{}).textContent||''");
      log(名, 'ルールの画面', gname.trim());
      await 撮る(h, 'r-' + id + '-進行役');
      await 撮る(g, 'r-' + id + '-参加者');
      await TVを撮る(t, 'r-' + id + '-TV');
      // 進行役だけ準備OK（参加者は押さない＝始まらない）→ 待合の「待っています」も撮る
      await 押す(h, '#rtRulesOkBtn');
      await 画面は(h, 'scr-v2-room');
      await sleep(700);
      await 撮る(h, 'r-' + id + '-進行役-準備OKのあと');
      await TVを撮る(t, 'r-' + id + '-TV-準備OKのあと');
    }
  } finally { try { bots.kill(); } catch (e) {} }

  // ---- あれそれどれこれ：部屋では遊べない。1台で、ルール（scr-mode-rules）と「準備はいい？」 ----
  const o = await b.newDevice('1台', { width: 390, height: 844, mobile: true, deviceScaleFactor: 2 });
  記録.例外['1台'] = o.logs;
  await o.go(hb + '/dev-login');
  await 開く(o, hb, '/');
  await 画面は(o, 'scr-v2-home');
  await 押す(o, '#scr-v2-home [data-home-act="one"]');
  await 画面は(o, 'scr-v2-pick');
  await o.tap('#scr-v2-pick [data-home-id="aresoredorekore"] .v2-tile');
  await o.until("(function(){var x=document.querySelector('#scr-v2-pick [data-home-ov]');return !!x&&x.classList.contains('is-open');})()", 5000, 'ページが開く');
  await sleep(300);
  await 押す(o, '#scr-v2-pick [data-home-act="pick-go"]');
  const 撮った = new Set();
  for (let i = 0; i < 40; i++) {
    const s = await 画面(o);
    if (s === 'scr-setup' && !撮った.has(s)) {
      撮った.add(s);
      await 撮る(o, 'r-aresoredorekore-1台-' + s);
      for (let j = 0; j < 2; j++) { await o.tap('#playerPlusBtn'); await sleep(250); }
      const n = await o.ev("document.querySelectorAll('.draft-name').length");
      for (let j = 0; j < n; j++) await o.ev("(function(){var i=document.querySelector('.draft-name[data-idx=\"" + j + "\"]'); if(!i) return 0; i.value=" + JSON.stringify(['ふう', 'ひろ', 'びび', 'ちか'][j % 4]) + "; i.dispatchEvent(new Event('input',{bubbles:true})); return 1;})()");
      await 押す(o, '#setupNextBtn');
    } else if (s === 'scr-mode') { await 押す(o, '#modeNextBtn'); }
    else if (s === 'scr-mode-rules') { await 撮る(o, 'r-aresoredorekore-1台-ルール'); await 押す(o, '#rulesStartBtn'); }
    else if (s === 'scr-ready') { await sleep(500); await 撮る(o, 'r-aresoredorekore-1台-準備はいい'); break; }
    else {
      const next = await o.ev("(function(){var n=Array.from(document.querySelectorAll('.screen.active [data-wiz-next]')).find(function(b){return b.getBoundingClientRect().width>0&&!b.disabled;}); if(!n) return null; n.click(); return (n.innerText||'').trim();})()");
      if (next === null) throw new Error('1台：知らない画面 ' + s);
      log('1台：' + s + ' を既定のまま「' + next + '」');
    }
    await sleep(500);
  }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.readdirSync(OUT).filter((f) => /\.(jpg|json)$/.test(f)).forEach((f) => fs.unlinkSync(path.join(OUT, f)));
  const { child } = await サーバー();
  const b = await launch({ port: CDP });
  const hb = 'http://localhost:' + PORT, gb = 'http://127.0.0.1:' + PORT;
  try {
    if (PART === 'gear') await gear(b, hb, gb);
    else if (PART === 'rules') await rules(b, hb, gb);
    else throw new Error('--part は gear か rules');
  } catch (e) {
    記録.失敗 = String(e && e.stack || e);
    console.error('失敗：' + 記録.失敗);
  } finally {
    fs.writeFileSync(path.join(OUT, '記録.json'), JSON.stringify(記録, null, 1));
    await b.close();
    if (child) { try { child.kill(); } catch (e) {} }
  }
  console.log((記録.失敗 ? '✖ 途中で止まりました' : '✔') + ' 写真 ' + 記録.写真.length + ' 枚 → ' + path.relative(ROOT, OUT));
  process.exit(記録.失敗 ? 1 : 0);
})();
