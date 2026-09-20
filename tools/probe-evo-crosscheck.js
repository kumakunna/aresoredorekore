// tools/probe-evo-crosscheck.js — 指示55-② 着手前の**独立検算**（落とし穴40：案を作る人と、疑う人を分ける）
//
// `tools/evo-preflight.js` / `tools/probe-versus-janken.js` とは**別実装**で、同じ問いを見る。
// 数字が食い違ったら、どちらかの道具が壊れている（落とし穴28：測る道具が壊れていると
// 測定そのものが嘘をつく）。実際、3本とも同じ数字を出した。
//
//   node tools/probe-evo-crosscheck.js
//
// 検算1 1人ランクが上と当たれた率／検算2 非対称の希望で、組めるはずの1組が消える
// 検算3 最上段の人はAI送りになるか／検算4 `直前の不戦勝` に配列を渡すと黙って無視される
// 検算5 「1つ上」の印は「1人ランク」を意味しない／検算6 候補の並び順で相手を指名できるか
// 検算7 決着は「AIに勝って優勝」か「人に勝って優勝」か
// 検算8 余りの吸収 trio で parity は消えるか、その代償は何か
// 検算9 優勝の読み（2-1 到達／2-2 最終段で勝てば）で決着のAI率はどう変わるか
//
// **AIの勝率の向きに注意**：指示書2-2 は「AIは 75% で**負ける**手を出す」＝**人が 75% で勝つ**。
// 最初これを逆に書いて、決着のAI率を 8〜57% と読み違えた。正しくは 62〜99%（検算7）。
// 向きを1つ間違えるだけで、結論が裏返る種類の数字（落とし穴28）。


(function(){
// 反証用：テーマ色の結論を、現物と独立に測り直す
const fs = require('fs');
const path = require('path');
const ROOTDIR = 'C:/Users/kumak/game/anarogu/aresoredorekore';
const { hex2lab, deltaE2000, contrast, 世界の色 } = require(ROOTDIR + '/tools/color-diff');

const HTML = fs.readFileSync(ROOTDIR + '/public/index.html', 'utf8');
const CSS = /<style>([\s\S]*?)<\/style>/.exec(HTML)[1].replace(/\/\*[\s\S]*?\*\//g, '');

function block(sel) {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(esc + '\\{([^{}]*)\\}', 'gm');
  const out = {}; let m, f = 0;
  while ((m = re.exec(HTML))) {
    f++;
    const t = /--([a-z-]+)\s*:\s*([^;]+);/g; let y;
    while ((y = t.exec(m[1]))) out['--' + y[1]] = y[2].trim();
  }
  return f ? out : null;
}
const ROOT = block(':root');
const NAMES = [...new Set([...CSS.matchAll(/\.app\.theme-([a-z]+)\s*\{([^{}]*)\}/g)]
  .filter(x => /--paper\s*:/.test(x[2])).map(x => x[1]))];

console.log('== 現物のテーマ（' + NAMES.length + '）==');
NAMES.forEach(n => {
  const b = block('.app.theme-' + n);
  console.log(n.padEnd(10),
    'paper', b['--paper'], 'deep', b['--paper-deep'], 'card', b['--card'],
    'ink', b['--ink'], 'soft', b['--ink-soft'],
    'stamp', b['--stamp'] || '(継承)', 'stampdeep', b['--stamp-deep'] || '(継承)',
    'on', b['--switch-on'] || '(継承)');
});

// ---- PAIRS（tests/design-tokens.js:146-168 を写す）----
const PAIRS = [
  ['--paper', '--ink', 4.5, '地×本文'],
  ['--paper', '--ink-soft', 4.5, '地×補足'],
  ['--card', '--ink', 4.5, 'カード×本文'],
  ['--card', '--ink-soft', 4.5, 'カード×補足'],
  ['--paper-deep', '--ink', 4.5, '深地×本文'],
  ['--paper-deep', '--ink-soft', 4.5, '深地×補足'],
  ['--card', '--stamp-deep', 4.5, 'カード×朱(濃)'],
  ['--paper', '--stamp', 3.0, '地×朱'],
  ['--ink', '--paper', 4.5, '主ボタン'],
  ['--switch-off', '--switch-knob-edge', 3.0, 'OFF帯×縁'],
  ['--switch-on', '--switch-knob-edge', 3.0, 'ON帯×縁'],
  ['--switch-off', '--switch-knob', 1.5, 'OFF帯×つまみ'],
  ['--switch-on', '--switch-knob', 1.5, 'ON帯×つまみ']
];
function toRgb(v, under) {
  v = String(v).trim();
  let m = v.match(/^#([0-9a-fA-F]{3})$/);
  if (m) v = '#' + m[1].split('').map(c => c + c).join('');
  m = v.match(/^#([0-9a-fA-F]{6})$/);
  if (m) { const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  m = v.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const p = m[1].split(',').map(x => parseFloat(x.trim()));
    const a = p.length > 3 ? p[3] : 1;
    if (a >= 1 || !under) return [p[0], p[1], p[2]];
    return [0, 1, 2].map(i => Math.round(p[i] * a + under[i] * (1 - a)));
  }
  return null;
}
function lum(rgb) { const c = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }
function ct(fg, bg) { const a = lum(fg), b = lum(bg); return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100; }
const hex = h => toRgb(h);

function pairsCheck(pal, label) {
  const bad = [], all = [];
  PAIRS.forEach(([bgK, fgK, min, name]) => {
    const bg = toRgb(pal[bgK] || bgK);
    const fg = toRgb(pal[fgK] || fgK, bg);
    const c = ct(fg, bg);
    all.push(name + '=' + c);
    if (c < min) bad.push(name + ' ' + c + '<' + min);
  });
  console.log('  [' + label + '] PAIRS13: ' + (bad.length ? 'NG ' + bad.length + '件 → ' + bad.join(' / ') : 'NG 0件'));
  console.log('     ' + all.join('  '));
  return bad.length;
}

// ---- 候補3案（報告に書かれたトークンのまま）----
const 案 = [
  { 名: '案A 昼の空', t: { '--paper': '#9FC6DF', '--paper-deep': '#7AA6C0', '--card': '#C0DEF2', '--ink': '#0C202A', '--ink-soft': '#192C37', '--switch-on': '#E06A3C', '--stamp': '#A32B18' } },
  { 名: '案A 昼の空(朱を既定のまま)', t: { '--paper': '#9FC6DF', '--paper-deep': '#7AA6C0', '--card': '#C0DEF2', '--ink': '#0C202A', '--ink-soft': '#192C37', '--switch-on': '#E06A3C' } },
  { 名: '案B たまごの黄', t: { '--paper': '#D7BF76', '--paper-deep': '#B59F54', '--card': '#EED99D', '--ink': '#29230F', '--ink-soft': '#37301C', '--switch-on': '#1E90C8' } },
  { 名: '案C はじまりの海', t: { '--paper': '#004B50', '--paper-deep': '#00383C', '--card': '#1E5D62', '--ink': '#E6F7F6', '--ink-soft': '#C1E4E3', '--switch-on': '#EF6C4D', '--stamp': '#F59A8C', '--stamp-deep': '#FBC9BE' } },
  { 名: '案C はじまりの海(朱を既定のまま)', t: { '--paper': '#004B50', '--paper-deep': '#00383C', '--card': '#1E5D62', '--ink': '#E6F7F6', '--ink-soft': '#C1E4E3', '--switch-on': '#EF6C4D' } }
];
console.log('\n== 候補の PAIRS 13組（:root を下敷きに）==');
案.forEach(a => pairsCheck(Object.assign({}, ROOT, a.t), a.名));

// ---- 世界7:1 と ΔE ----
console.log('\n== 世界の地×薄墨（7:1）と ΔE2000 最小 ==');
const 現物 = {}; 世界の色().forEach(w => { 現物[w.theme === '(共通)' ? '共通' : w.theme] = w.color; });
[['案A', '#9FC6DF', '#192C37'], ['案B', '#D7BF76', '#37301C'], ['案C', '#004B50', '#C1E4E3']].forEach(([n, g, s]) => {
  const 比 = ct(hex(s), hex(g));
  const d = Object.entries(現物).map(([k, v]) => [k, +deltaE2000(hex2lab(g), hex2lab(v)).toFixed(1)]).sort((a, b) => a[1] - b[1]);
  console.log('  ' + n + ' 地' + g + ' 薄墨' + s + ' → 7:1判定 ' + 比 + (比 >= 7 ? ' OK' : ' NG') +
    ' ／ ΔE最小 ' + d[0][1] + ' (対 ' + d[0][0] + ')' + (d[0][1] >= 10.8 ? ' OK' : ' NG'));
});

// ---- ONの帯 × つまみの縁：現物9つ ----
console.log('\n== 現物の --switch-on を、ON帯×縁 3.0 の門に当てる ==');
NAMES.forEach(n => {
  const b = block('.app.theme-' + n);
  const on = b['--switch-on'] || ROOT['--switch-on'];
  const bg = hex(on);
  const edge = toRgb(ROOT['--switch-knob-edge'], bg);
  const L = hex2lab(on)[0];
  console.log('  ' + n.padEnd(10) + ' ON=' + on + ' L*=' + L.toFixed(1) + '  帯×縁=' + ct(edge, bg) + (ct(edge, bg) >= 3 ? ' OK' : ' NG'));
});
console.log('  (共通) ON=' + ROOT['--switch-on'] + ' L*=' + hex2lab(ROOT['--switch-on'])[0].toFixed(1) +
  '  帯×縁=' + ct(toRgb(ROOT['--switch-knob-edge'], hex(ROOT['--switch-on'])), hex(ROOT['--switch-on'])));

// ---- 「ONは L*45 未満だと原理的に通らない」を反証しにいく ----
console.log('\n== ON の L* と帯×縁：無彩色 vs 彩度の高い色 ==');
[['#6B6B6B'], ['#707070'], ['#757575'], ['#C0392B'], ['#D32F2F'], ['#E53935'], ['#1E5785'], ['#2A5785']].forEach(([h]) => {
  const bg = hex(h); const e = toRgb(ROOT['--switch-knob-edge'], bg);
  console.log('  ' + h + ' L*=' + hex2lab(h)[0].toFixed(1).padStart(5) + '  帯×縁=' + ct(e, bg) + (ct(e, bg) >= 3 ? ' OK' : ' NG'));
});

})();

(function(){
const V=require('C:/Users/kumak/game/anarogu/aresoredorekore/public/js/versus.js');
function rng(s){let a=s>>>0;return()=>{a|=0;a=(a+0x6D2B79F5)|0;let t=Math.imul(a^(a>>>15),1|a);
 t=(t+Math.imul(t^(t>>>7),61|t))^t;return ((t^(t>>>14))>>>0)/4294967296;};}
const 希望=[{理由:'同ランク',候補:(N,p)=>N.filter(x=>x.rank===p.rank)},
           {理由:'1つ上',候補:(N,p)=>N.filter(x=>x.rank===p.rank+1)}];

console.log('=== 検算5：理由「1つ上」が付いた挑戦者は、本当に「その段に1人」か ===');
console.log('   （指示書2-2 は「1人しかいないランクの人」にだけ3つの特典を与える）');
console.log(' 分布                        | 「1つ上」の組 | うち挑戦者に同段の仲間がいた');
for(const [dist,lbl] of [
  [[1,1,1,2,2,2],'段1に3人・段2に3人'],
  [[1,1,1,2,2],  '段1に3人・段2に2人'],
  [[1,1,1,1,1,2],'段1に5人・段2に1人'],
  [[1,2,2],      '段1に1人・段2に2人（本来の形）'],
]){
  let 組数=0, 仲間あり=0;
  for(let s=1;s<=2000;s++){
    const P=dist.map((r,i)=>({id:'p'+i,rank:r,直前:null}));
    const res=V.組をつくる(P,{rnd:rng(s),希望,余りの吸収:'bye',連続不戦勝を避ける:true,直前の不戦勝:null});
    const M={};P.forEach(p=>M[p.id]=p);
    res.組.filter(g=>g.理由==='1つ上').forEach(g=>{
      組数++;
      const 挑=M[g.a];
      const 同段の仲間=P.filter(x=>x.rank===挑.rank&&x.id!==挑.id).length;
      if(同段の仲間>0) 仲間あり++;
    });
  }
  console.log(' '+lbl.padEnd(27)+'| '+String(組数).padStart(12)+' | '+
    String(仲間あり).padStart(6)+' ('+(組数?(100*仲間あり/組数).toFixed(1):'-')+'%)');
}

console.log('\n=== 検算6：候補の「並び順」で相手を指名できるか（反証の主張） ===');
console.log('   段1に1人(L)・段2にN人。上の段の第1希望の先頭に L を置くと当たる率は？');
for(const N of [2,4,6]){
  const 素朴=[{理由:'同ランク',候補:(A,p)=>A.filter(x=>x.rank===p.rank)},
             {理由:'1つ上',候補:(A,p)=>A.filter(x=>x.rank===p.rank+1)}];
  // 「上の段の人の第1希望の先頭に、下の1人ランクの人を置く」＝希望の順序で指名
  const 指名=[{理由:'同ランク',候補:(A,p)=>{
                const 下=A.filter(x=>x.rank===p.rank-1);
                const 待つ=下.length===1?下:[];       // 1人ランクの人だけ
                return 待つ.concat(A.filter(x=>x.rank===p.rank));
              }},
             {理由:'1つ上',候補:(A,p)=>A.filter(x=>x.rank===p.rank+1)}];
  const 測る=(希)=>{let 当=0;
    for(let s=1;s<=2000;s++){
      const P=[{id:'L',rank:1,直前:null}];
      for(let i=0;i<N;i++)P.push({id:'H'+i,rank:2,直前:null});
      const r=V.組をつくる(P,{rnd:rng(s),希望:希,余りの吸収:'bye',連続不戦勝を避ける:true,直前の不戦勝:null});
      if(r.組.some(g=>g.a==='L'||g.b==='L')) 当++;
    } return (100*当/2000).toFixed(1)+'%';};
  // 指名版で、Lが入った組の理由は何になるか
  let 理由集={};
  for(let s=1;s<=500;s++){
    const P=[{id:'L',rank:1,直前:null}];
    for(let i=0;i<N;i++)P.push({id:'H'+i,rank:2,直前:null});
    const r=V.組をつくる(P,{rnd:rng(s),希望:指名,余りの吸収:'bye',連続不戦勝を避ける:true,直前の不戦勝:null});
    const g=r.組.find(g=>g.a==='L'||g.b==='L');
    if(g) 理由集[g.理由+(g.a==='L'?'(a=L)':'(b=L)')]=(理由集[g.理由+(g.a==='L'?'(a=L)':'(b=L)')]||0)+1;
  }
  console.log('  上がN='+N+'人 … 素朴 '+測る(素朴)+' → 指名 '+測る(指名)+
              '   Lの組の理由: '+JSON.stringify(理由集));
}

})();

(function(){
const V=require('C:/Users/kumak/game/anarogu/aresoredorekore/public/js/versus.js');
function rng(s){let a=s>>>0;return()=>{a|=0;a=(a+0x6D2B79F5)|0;let t=Math.imul(a^(a>>>15),1|a);
 t=(t+Math.imul(t^(t>>>7),61|t))^t;return ((t^(t>>>14))>>>0)/4294967296;};}
const H2=[{理由:'同ランク',候補:(N,p)=>N.filter(x=>x.rank===p.rank)},
          {理由:'1つ上',候補:(N,p)=>N.filter(x=>x.rank===p.rank+1)}];
const H3=H2.concat([{理由:'1つ下',候補:(N,p)=>N.filter(x=>x.rank===p.rank-1)}]);

// 指示書2-2 をそのまま実装した一局。決着が「AI戦での勝ち」か「人との勝ち」かを記録する。
function 一局(n,段数,seed,希望,上限){
  const rnd=rng(seed), P=[];
  for(let i=0;i<n;i++)P.push({id:'p'+i,rank:0,連敗:0,直前:null,猶予:true});
  let by=null,回=0,決着=null,全員AI回=0,AI延べ=0;
  for(let t=0;t<上限;t++){
    回++;
    const r=V.組をつくる(P,{rnd,希望,避ける:(a,b)=>a.直前===b.id,余りの吸収:'bye',
      連続不戦勝を避ける:true,直前の不戦勝:by});
    const M={};P.forEach(p=>M[p.id]=p);
    const bye=r.相手なし.filter(x=>x.なぜ==='parity');
    const nc =r.相手なし.filter(x=>x.なぜ==='no-candidate');
    AI延べ+=nc.length;
    if(nc.length===n) 全員AI回++;
    by=bye.length?bye[0].id:null;
    // AI戦：AIが75%で負ける＝人が75%で勝つ。勝てば1つ上・負けても落ちない
    for(const x of nc){ const p=M[x.id], u=rnd();
      if(u<0.75){ p.rank=Math.min(段数-1,p.rank+1); p.連敗=0;
        if(p.rank===段数-1){ 決着='AI'; break; } } }
    if(決着) break;
    for(const g of r.組){
      const a=M[g.a],b=M[g.b],勝=rnd()<0.5?a:b,負=(勝===a)?b:a;
      a.直前=b.id; b.直前=a.id;
      if(g.理由==='同ランク'){
        勝.rank=Math.min(段数-1,勝.rank+1); 勝.連敗=0;
        if(勝.rank===段数-1){ 決着='人'; break; }
        負.連敗++; if(負.連敗>=2){負.rank=Math.max(0,負.rank-1);負.連敗=0;}
      } else {
        // 挑戦：ランクが低い方が挑戦者（理由の文字列に頼らない）
        const 挑=(a.rank<b.rank)?a:b, 受=(a.rank<b.rank)?b:a;
        if(勝===挑){ 挑.rank=Math.min(段数-2,挑.rank+2); 挑.連敗=0; }  // チャンピオンにはならない
        else { if(受.猶予) 受.猶予=false;
               else {受.連敗++; if(受.連敗>=2){受.rank=Math.max(0,受.rank-1);受.連敗=0;}} }
      }
    }
    if(決着) break;
  }
  return {決着,回,全員AI回,AI延べ};
}
for(const [段数,lbl] of [[5,'通常版5段'],[6,'通常版6段'],[10,'CS版10段']]){
  console.log('\n=== '+lbl+' ===');
  console.log('  人数 | 希望 | 決着がAI戦 | 決着が人 | 未決着 | 全員AIの回 | AI延べ/回');
  for(const n of [3,4,6,8,12]){
    for(const [希望,hl] of [[H2,'2段'],[H3,'3段']]){
      let ai=0,hu=0,no=0,zen=0,R=0,AI=0,局=500;
      for(let s=1;s<=局;s++){const o=一局(n,段数,s,希望,300);
        if(o.決着==='AI')ai++; else if(o.決着==='人')hu++; else no++;
        zen+=o.全員AI回; R+=o.回; AI+=o.AI延べ;}
      const 決着計=ai+hu;
      console.log('  '+String(n).padStart(3)+'人 | '+hl+' | '+
        String(ai).padStart(4)+' ('+(決着計?(100*ai/決着計).toFixed(1):'-').padStart(5)+'%) | '+
        String(hu).padStart(4)+' | '+String(no).padStart(3)+' | '+
        (100*zen/R).toFixed(1).padStart(5)+'% | '+(AI/R).toFixed(2));
    }
  }
}

})();

(function(){
const V=require('C:/Users/kumak/game/anarogu/aresoredorekore/public/js/versus.js');
function rng(s){let a=s>>>0;return()=>{a|=0;a=(a+0x6D2B79F5)|0;let t=Math.imul(a^(a>>>15),1|a);
 t=(t+Math.imul(t^(t>>>7),61|t))^t;return ((t^(t>>>14))>>>0)/4294967296;};}
const H2=[{理由:'同ランク',候補:(N,p)=>N.filter(x=>x.rank===p.rank)},
          {理由:'1つ上',候補:(N,p)=>N.filter(x=>x.rank===p.rank+1)}];
const H3=H2.concat([{理由:'1つ下',候補:(N,p)=>N.filter(x=>x.rank===p.rank-1)}]);

// 【検算8】'trio' で parity は本当に0になるか。なるなら、その代償は？
console.log('=== 検算8：余りの吸収 trio で parity は消えるか。段をまたぐか ===');
for(const [dist,lbl] of [[[0,0,0],'3人・全員同じ段'],[[0,0,0,0,0],'5人・全員同じ段'],
                          [[1,1,1,3,3,3],'6人・段1に3人＋段3に3人']]){
  for(const 吸収 of ['bye','trio']){
    let p=0,t=0,またいだ=0;
    for(let s=1;s<=2000;s++){
      const P=dist.map((r,i)=>({id:'p'+i,rank:r,直前:null}));
      const M={};P.forEach(x=>M[x.id]=x);
      const r=V.組をつくる(P,{rnd:rng(s),希望:H2,余りの吸収:吸収,連続不戦勝を避ける:true,直前の不戦勝:null});
      p+=r.相手なし.filter(x=>x.なぜ==='parity').length;
      r.組.forEach(g=>{ if(g.c){ t++;
        const 段=[M[g.a].rank,M[g.b].rank,M[g.c].rank];
        if(new Set(段).size>1) またいだ++; } });
    }
    console.log('  '+lbl.padEnd(22)+吸収.padEnd(6)+' parity計='+String(p).padStart(5)+
                '  3人組='+String(t).padStart(5)+'  うち段をまたいだ='+String(またいだ).padStart(5));
  }
}

// 【検算9】2-1（到達で優勝）と 2-2（最終段で勝てば優勝）で、決着のAI率はどう変わるか
console.log('\n=== 検算9：優勝の読みを変えると、決着のAI率はどうなるか ===');
console.log('   （あいこは「振り直さない＝その回は動かない」控えめな模型。実際の人の勝率はもっと高い）');
function 一局(n,段数,seed,希望,読み){
  const rnd=rng(seed),P=[];
  for(let i=0;i<n;i++)P.push({id:'p'+i,rank:0,連敗:0,直前:null,猶予:true});
  let by=null,決着=null;
  for(let t=0;t<300;t++){
    const r=V.組をつくる(P,{rnd,希望,避ける:(a,b)=>a.直前===b.id,余りの吸収:'bye',
      連続不戦勝を避ける:true,直前の不戦勝:by});
    const M={};P.forEach(x=>M[x.id]=x);
    const bye=r.相手なし.filter(x=>x.なぜ==='parity');
    const nc =r.相手なし.filter(x=>x.なぜ==='no-candidate');
    by=bye.length?bye[0].id:null;
    for(const x of nc){ const p=M[x.id],u=rnd();
      if(p.rank===段数-1){ if(u<0.75){決着='AI';break;} continue; }   // 最終段での1勝
      if(u<0.75){ p.rank=Math.min(段数-1,p.rank+1); p.連敗=0;
        if(読み==='到達' && p.rank===段数-1){決着='AI';break;} } }
    if(決着)break;
    for(const g of r.組){
      const a=M[g.a],b=M[g.b],勝=rnd()<0.5?a:b,負=(勝===a)?b:a;
      a.直前=b.id;b.直前=a.id;
      if(g.理由==='同ランク'){
        if(勝.rank===段数-1){決着='人';break;}                        // 最終段での1勝
        勝.rank=Math.min(段数-1,勝.rank+1);勝.連敗=0;
        if(読み==='到達'&&勝.rank===段数-1){決着='人';break;}
        負.連敗++;if(負.連敗>=2){負.rank=Math.max(0,負.rank-1);負.連敗=0;}
      } else {
        const 挑=(a.rank<b.rank)?a:b,受=(a.rank<b.rank)?b:a;
        if(勝===挑){挑.rank=Math.min(段数-2,挑.rank+2);挑.連敗=0;}
        else{if(受.猶予)受.猶予=false;else{受.連敗++;if(受.連敗>=2){受.rank=Math.max(0,受.rank-1);受.連敗=0;}}}
      }
    }
    if(決着)break;
  }
  return 決着;
}
console.log('  段数 人数 | 読み        | 2段希望のAI率 | 3段希望のAI率');
for(const 段数 of [5,6,10]) for(const n of [3,6,12]){
  const 行=[];
  for(const 読み of ['到達','最終段で勝つ']){
    const 出=[];
    for(const 希望 of [H2,H3]){
      let ai=0,hu=0;
      for(let s=1;s<=400;s++){const d=一局(n,段数,s,希望,読み);if(d==='AI')ai++;else if(d==='人')hu++;}
      出.push((ai+hu)?(100*ai/(ai+hu)).toFixed(1)+'%':'決着せず');
    }
    行.push([読み,出]);
  }
  行.forEach(([読み,出])=>console.log('  '+String(段数).padStart(3)+'段'+String(n).padStart(3)+'人 | '+
    読み.padEnd(11)+' | '+出[0].padStart(12)+' | '+出[1].padStart(12)));
}

})();
