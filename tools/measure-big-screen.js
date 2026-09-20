#!/usr/bin/env node
// tools/measure-big-screen.js — 大画面の文字が、正本§11-5 の下限を満たすかを測る（指示55）
//
// jsdom にはレイアウトが無く `clamp()` も解けないので、**本物のブラウザでしか測れない**
// （`tools/measure-screens.js` と同じ形の、手で回す道具）。
//
// ── 回し方 ────────────────────────────────
//   1. `node tools/dev-server.js`（または launch.json の aresore-dev）
//   2. `http://localhost:3001/dev-login` を一度開く
//   3. `http://localhost:3001/` を開き、**幅を 1280×720 にする**
//   4. コンソールに SELFTEST を貼って、**測り方が効くこと**を先に見る（落とし穴28）
//   5. SNIPPET を貼って `__measureBig()`
//
// ── 正本§11-5 の下限（1280×720・50型16:9・4m・ISO 9241-303 の20分角） ──
//   主役 96px ／ 数字 48px ／ 本文・名前・札 28px
//   **これ以下でよい文字は、大画面に出さない。**逃げ道は作らない
//
// ── 測る前に、測定そのものが健全かを見る（落とし穴28） ──────────
//   ・`innerWidth`（1280）と `documentElement.clientWidth`（1265＝スクロールバー分）は
//     **食い違う**。CSS の `vw` は `innerWidth` 側に付く。混ぜると 1.2% ずれる
//   ・捨て要素に 37px を当てて 37px が返ることを1つ見る

const SELFTEST = `
(() => {
  const scr = document.getElementById('scr-rt-big');
  const pr = document.createElement('div');
  pr.style.cssText = 'font-size:37px'; scr.appendChild(pr);
  const got = getComputedStyle(pr).fontSize; pr.remove();
  return { 捨て要素: got, 期待: '37px', 健全: got === '37px',
    innerWidth: innerWidth, clientWidth: document.documentElement.clientWidth };
})()
`;

const SNIPPET = `
window.__measureBig = function(){
  window.goToScreen('scr-rt-big');
  const scr = document.getElementById('scr-rt-big');
  const h = document.createElement('div');
  // **本物と同じ入れ子で測る**。.sugo-piece は .bl-item の中、.blc-x は .bl-card.out の中
  h.innerHTML = \`
   <div class="big-status"><div class="bs-lives">❤️❤️🖤</div><div class="bs-clock">02:14</div></div>
   <div class="big-board" style="display:flex"><div class="bb-row"><div class="bb-head"><span class="bb-name">なまえ</span><span class="bb-meta">2 / 6</span></div><div class="bb-bar"><div class="bb-fill"></div></div></div></div>
   <div class="big-list"><span class="bl-item"><b class="sugo-piece">1位</b>なまえ<span class="bl-title">ふたつな</span></span>
     <span class="bl-card out"><span class="blc-face">A</span><span class="blc-name">なまえ</span><span class="blc-title">ふたつな</span><span class="blc-x">✕</span></span></div>
   <div class="big-ft" style="display:flex"><span class="bft-case">3</span><span class="bft-note">のこり 4 枚</span></div>
   <div class="big-mk"><div class="bmk-market"><span class="bmk-k"><span class="bk-i">A</span><span class="bk-l">壺もの</span><span class="bk-v">9</span><span class="bk-hot">HOT</span></span></div>
     <div class="bmk-line"><div class="bmk-c"><span class="bc-no">1</span><span class="bc-i">I</span><span class="bc-l">しな</span><span class="bc-sold">SOLD</span></div></div></div>
   <div class="big-rules"><div class="big-rules-title">T</div><div class="big-rules-count">3つ</div><ol class="rules-ol"><li>R</li></ol></div>
   <div class="sh-stairs"><div class="sh-tier"><span class="sh-tier-face">🥚</span><span class="sh-tier-name">たまご</span><span class="sh-tier-who"><span class="sh-who">なまえ</span></span><span class="sh-tier-count">4</span></div></div>\`;
  scr.appendChild(h);
  // 50型16:9 → 画の高さ623mm ÷ 720px = 0.865mm/px。4m から見た視角（分角）
  const MMPX = 623/720, D = 4000;
  const 主役 = ['.big-main'];
  // 指示55-②：段の人数は「その段に何人いるか」の数字なので 48px の側
  const 数字 = ['.bb-meta','.bk-v','.bs-clock','.bs-lives','.bft-case','.sugo-piece','.sh-tier-count'];
  const 見る = [
    ['.big-main','#bigMain'],['.big-sub','#bigSub'],['.big-phase','#bigPhase'],['.big-turn','#bigTurn'],
    ['.bs-lives','.bs-lives'],['.bs-clock','.bs-clock'],
    ['.bb-head','.bb-head'],['.bb-name','.bb-name'],['.bb-meta','.bb-meta'],
    ['.big-list','.big-list'],['.bl-item','.bl-item'],['.bl-title','.bl-title'],['.sugo-piece','.bl-item .sugo-piece'],
    ['.blc-face','.blc-face'],['.blc-name','.blc-name'],['.blc-title','.blc-title'],['.blc-x','.bl-card.out .blc-x'],
    ['.bft-case','.bft-case'],['.bft-note','.bft-note'],
    ['.bk-l','.bk-l'],['.bk-v','.bk-v'],['.bk-hot','.bk-hot'],
    ['.bc-no','.bc-no'],['.bc-l','.bc-l'],['.bc-sold','.bc-sold'],
    ['.rules-ol','.rules-ol'],['.big-rules-count','.big-rules-count'],
    // 指示55-②：進化じゃんけんの大画面（主役＝段の階段）
    ['.sh-tier-face','.sh-tier-face'],['.sh-tier-name','.sh-tier-name'],
    ['.sh-who','.sh-who'],['.sh-tier-count','.sh-tier-count']
  ];
  const rows = [], 未達 = [];
  見る.forEach(([name, sel]) => {
    const e = scr.querySelector(sel);
    if(!e){ 未達.push(name + '：検体が作れていない'); return; }   // 読めなかったものは数えて赤くする（落とし穴10-e）
    const px = parseFloat(getComputedStyle(e).fontSize);
    const 下限 = 主役.includes(name) ? 96 : (数字.includes(name) ? 48 : 28);
    const 分角 = Math.atan(px*MMPX/D)*180/Math.PI*60;
    rows.push({ セレクタ:name, px:+px.toFixed(1), 下限, 分角:+分角.toFixed(1), 可: px >= 下限 - 0.5 });
    if(px < 下限 - 0.5) 未達.push(name + '：' + px.toFixed(1) + 'px（下限 ' + 下限 + '）');
  });
  h.remove();
  console.table(rows);
  return { 測った: rows.length, 未達 };
};
`;

console.log('== tools/measure-big-screen.js ==');
console.log('1280×720 の実ブラウザで回す。手順はこのファイルの先頭コメント。\n');
console.log('---- SELFTEST（先にこれ。測り方が効くことを見る） ----');
console.log(SELFTEST);
console.log('---- SNIPPET（貼ったあと __measureBig()） ----');
console.log(SNIPPET);
console.log('下限：主役 96px ／ 数字 48px ／ 本文 28px（正本 §11-5）');

module.exports = { SELFTEST, SNIPPET };
