// tools/measure-screens.js — 全画面が「初期表示に収まるか」を測る（指示49 49-2）
//
// measure-catalog.js が**部品カタログ1画面**を測るのに対して、こちらは**77画面ぜんぶ**。
// jsdom にはレイアウトが無いので、本物のブラウザでしか測れない（手で回す道具）。
//
// ── 回し方 ────────────────────────────────
//   1. `node tools/dev-server.js`（または launch.json の aresore-dev）
//   2. `http://localhost:3001/dev-login` を一度開く（ログインが要る画面のため）
//   3. `http://localhost:3001/` を開き、幅を 375×667／375×812／1280×720 にする
//   4. コンソールに SELFTEST を貼って、**測り方が効くこと**を先に見る
//   5. SNIPPET を貼って `await __measure()`
//   6. 文字サイズ「大」も見る：`document.documentElement.classList.add('fs-large')` のあと再実行
//
// ── 測る前に、測定そのものが健全かを見る（落とし穴28） ──────────
//   ・`innerHeight` と `documentElement.clientHeight` が**食い違う**ことがある。
//     ブラウザ枠が偽装した画面より大きいと、`innerHeight` は枠の実寸を返す。
//     **折り返し（fold）の権威は `clientHeight`**——偽装した画面の高さ。
//   ・同じ理由で `window.scrollY` は当てにならない。枠のほうが背が高いと、
//     はみ出していてもスクロールが起きない。だから「はみ出し」は
//     **要素の矩形 対 clientHeight** で決め、実スクロールは参考値として並べるだけ。
//   ・`getComputedStyle(x).backgroundColor` は、枠が裏に回っていると
//     **遷移の途中の値で止まる**（落とし穴47）。色を測るなら遷移を切ってから
//     （SELFTEST_COLOR 参照）。
//
// ── 測れない画面がある、と正直に出す ──────────────────
//   ゲーム中の画面は、進行の状態が無いと中身が描かれない。
//   `window.goToScreen(id)` は例外を投げるか、空の器のまま出る。
//   **空の器を「収まっている」と数えない**ため、文字量（len）を必ず併記する。

const SNIPPET = `
window.__ids = [...document.querySelectorAll('.screen')].map(s=>s.id);
window.__measure = async function(only){
  const sleep = ms => new Promise(r=>setTimeout(r,ms));
  const ids = only && only.length ? only : window.__ids;
  const fold = document.documentElement.clientHeight;   // ← 折り返しの権威
  const W = document.documentElement.clientWidth;
  const rows = []; const errors = [];
  for(const id of ids){
    try{ window.goToScreen(id); }catch(e){ errors.push(id+': '+e.message); continue; }
    await sleep(55);
    window.scrollTo(0,0); await sleep(10);
    const scr = document.getElementById(id);
    if(!scr || !scr.classList.contains('active')){ errors.push(id+': activeにならない'); continue; }
    let bottom = 0, right = 0;
    const els = scr.querySelectorAll('*');
    els.forEach(e=>{
      const r = e.getBoundingClientRect();
      if(r.width===0 && r.height===0) return;
      const cs = getComputedStyle(e);
      if(cs.display==='none'||cs.visibility==='hidden'||cs.position==='fixed') return;
      if(r.bottom>bottom) bottom = r.bottom;
      if(r.right>right) right = r.right;
    });
    window.scrollTo(0,4000); await sleep(25);
    const scrolled = Math.round(window.scrollY||document.documentElement.scrollTop||0);
    window.scrollTo(0,0); await sleep(10);
    let mb = null;
    const cand = [...scr.querySelectorAll('.btn-main')].filter(b=>{
      const r=b.getBoundingClientRect(); const cs=getComputedStyle(b);
      return r.height>0 && cs.display!=='none' && cs.visibility!=='hidden';
    });
    if(cand.length){
      const b = cand[0]; const r = b.getBoundingClientRect();
      mb = {札:(b.textContent||'').trim().slice(0,14), bottom:Math.round(r.bottom), 入る: r.bottom<=fold+0.5};
    }
    const below = [];
    els.forEach(e=>{
      if(e.children.length) return;
      const t=(e.textContent||'').trim(); if(t.length<2) return;
      const r=e.getBoundingClientRect(); const cs=getComputedStyle(e);
      if(r.height===0||cs.display==='none'||cs.visibility==='hidden'||cs.position==='fixed') return;
      if(r.top>=fold-0.5) below.push(t.slice(0,18));
    });
    rows.push({id, h:Math.round(bottom), over:Math.max(0,Math.round(bottom-fold)),
      scrolled, xover:Math.max(0,Math.round(right-W)),
      mb, below:below.slice(0,5), nbelow:below.length,
      len:(scr.innerText||'').replace(/\\s/g,'').length});
  }
  return {W, fold, n:ids.length, errors, rows};
};
console.log('画面の数:', window.__ids.length, ' 折り返し:', document.documentElement.clientHeight,
            ' (innerHeight:', innerHeight, '← 食い違うのが普通)');
`;

// **測り方が効くことを先に見る。**3つの数（はみ出し・実スクロール・折り返しの下）が
// 全部動くことを確かめてから本番を回す。動かない数があれば、その数は使わない
const SELFTEST = `
(async () => {
  const one = async () => (await window.__measure(['scr-entry'])).rows[0];
  const scr = document.getElementById('scr-entry');
  const before = await one();
  const sp = document.createElement('div'); sp.style.cssText='height:900px;';
  const tx = document.createElement('p'); tx.textContent='これは折り返しの下にある文字';
  scr.appendChild(sp); scr.appendChild(tx);
  const after = await one();
  sp.remove(); tx.remove();
  const back = await one();
  console.log('壊す前 ', before.over, before.scrolled, before.nbelow);
  console.log('壊した後', after.over, after.scrolled, after.nbelow, after.below);
  console.log('戻した後', back.over, back.scrolled, back.nbelow);
  console.log('※ 3つとも 0 → 0以外 → 0 に動いていれば、測り方は効いています');
})();
`;

// 世界の色とコントラストを測る時は、**遷移を切ってから**。
// 切らずに測ると、止まった時計のせいで「途中の色」が返る（落とし穴47）。
// 切れているかは、宣言値（--warp-color）と computed の背景色が一致するかで分かる
const SELFTEST_COLOR = `
(async () => {
  const kill = document.createElement('style');
  kill.textContent = '#scr-shelf *, #scr-shelf{transition:none!important;animation:none!important;}';
  document.head.appendChild(kill);
  const stage = document.getElementById('shelfStage');
  const hex = c => '#' + c.match(/\\d+/g).slice(0,3).map(v=>(+v).toString(16).padStart(2,'0')).join('').toUpperCase();
  for (const th of ['','wolf','bomb','quiz','auction','sugoroku']) {
    stage.setAttribute('data-theme', th);
    await new Promise(r=>setTimeout(r,60));
    const cs = getComputedStyle(stage);
    const 宣言 = cs.getPropertyValue('--warp-color').trim().toUpperCase();
    const 実際 = hex(cs.backgroundColor);
    console.log((th||'共通').padEnd(10), '宣言', 宣言, '実際', 実際, 宣言===実際 ? 'OK' : '**遷移の途中を読んでいる**');
  }
  stage.setAttribute('data-theme',''); kill.remove();
})();
`;

if (require.main === module) {
  console.log('【回し方】');
  console.log(' 1. node tools/dev-server.js');
  console.log(' 2. http://localhost:3001/dev-login を一度開く');
  console.log(' 3. http://localhost:3001/ を開き、幅を 375x667 / 375x812 / 1280x720 に');
  console.log(' 4. 下の SNIPPET を貼る');
  console.log(' 5. SELFTEST を貼って、3つの数が動くことを見る');
  console.log(' 6. await __measure() で全画面');
  console.log('');
  console.log('--- SNIPPET ---');
  console.log(SNIPPET);
  console.log('--- SELFTEST（測り方が効くか） ---');
  console.log(SELFTEST);
  console.log('--- SELFTEST_COLOR（色を測る前に遷移を切る） ---');
  console.log(SELFTEST_COLOR);
}

module.exports = { SNIPPET, SELFTEST, SELFTEST_COLOR };
