/* =====================================================================
   あつまれ、あれこれ ― 新しい画面案の共通スクリプト（ds.js）
   ・枠の拡大縮小（本物の大きさで描いて、縮めて見せる）
   ・絵文字 → Twemoji（アプリと同じ絵）
   ・アイコンとゲームの印（SVG）
   ・のこり時間（1行・5秒以下は赤い札・1桁で寄る）と、同じ時計から描くバー
   ・帯の上から出るもの／シート／たずねる枠／長押し
   ・「もう一度」（動きの再生）と、見えていない枠の動きを止める
   ===================================================================== */
(function(){
'use strict';
var DS = window.DS = window.DS || {};
var root = document.documentElement;

/* ---------- 演出の速さ（ページ上の切り替え） ---------- */
function fx(){ var v = parseFloat(getComputedStyle(root).getPropertyValue('--fx')); return isFinite(v) && v > 0 ? v : 1; }
DS.fx = fx;
function store(k, v){ try{ if(v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); }catch(e){ return null; } }

/* ---------- アイコン（UIの部品。currentColor で塗る） ---------- */
var S = 'fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"';
var ICONS = {
  gear:'<path fill="currentColor" d="M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7.03 7.03 0 0 0-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.47.47 0 0 0-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.48.48 0 0 0-.59.22L2.74 8.87a.48.48 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.48.48 0 0 0-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z"/>',
  close:'<path '+S+' d="M6 6l12 12M18 6L6 18"/>',
  back:'<path '+S+' d="M19 12H5M11 6l-6 6 6 6"/>',
  next:'<path '+S+' d="M5 12h14M13 6l6 6-6 6"/>',
  chev:'<path '+S+' d="M9 5l7 7-7 7"/>',
  check:'<path '+S+' stroke-width="3" d="M5 12.5l4.5 4.5L19 7"/>',
  info:'<circle '+S+' cx="12" cy="12" r="9"/><path '+S+' d="M12 11v6"/><circle fill="currentColor" cx="12" cy="7.6" r="1.5"/>',
  rules:'<rect '+S+' x="5" y="3" width="14" height="18" rx="2.5"/><path '+S+' d="M9 8h6M9 12h6M9 16h4"/>',
  heart:'<path fill="currentColor" d="M12 20.3s-7.2-4.5-9.3-9.1C1.2 7.7 3.3 4.5 6.6 4.5c2.1 0 3.6 1.1 5.4 3 1.8-1.9 3.3-3 5.4-3 3.3 0 5.4 3.2 3.9 6.7-2.1 4.6-9.3 9.1-9.3 9.1z"/>',
  timer:'<circle '+S+' cx="12" cy="13.5" r="7.5"/><path '+S+' d="M12 13.5V9.5M9.5 2.5h5M18.5 6.5l1.5-1.5"/>',
  people:'<circle '+S+' cx="9" cy="8.5" r="3.4"/><path '+S+' d="M2.8 19.5c.9-3.4 3.3-5.3 6.2-5.3s5.3 1.9 6.2 5.3"/><path '+S+' d="M15.6 5.4a3.2 3.2 0 0 1 0 6.2M17.4 14.6c2 .6 3.3 2.3 3.8 4.9"/>',
  person:'<circle '+S+' cx="12" cy="8" r="4"/><path '+S+' d="M4.5 20c1.3-4 4.3-6 7.5-6s6.2 2 7.5 6"/>',
  crown:'<path '+S+' d="M3.5 18l-1-10 5.5 4.5L12 5l4 7.5L21.5 8l-1 10z"/>',
  lock:'<rect '+S+' x="5" y="10.5" width="14" height="10" rx="2.5"/><path '+S+' d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  star:'<path fill="currentColor" d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z"/>',
  starline:'<path '+S+' d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z"/>',
  qr:'<path '+S+' d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z"/><path fill="currentColor" d="M14 14h3v3h-3zM17 17h3v3h-3zM14 19h2v1h-2zM19 14h1v2h-1z"/>',
  camera:'<path '+S+' d="M4 8.5h3.2L9 6h6l1.8 2.5H20v10.5H4z"/><circle '+S+' cx="12" cy="13.5" r="3.4"/>',
  pen:'<path '+S+' d="M4 20l1.2-4.3L16.5 4.4a2 2 0 0 1 2.9 0l.2.2a2 2 0 0 1 0 2.9L8.3 18.8z"/>',
  phone:'<rect '+S+' x="7" y="2.5" width="10" height="19" rx="2.5"/><path '+S+' d="M11 18.5h2"/>',
  tv:'<g transform="translate(0 -1)">'+'<rect '+S+' x="2.5" y="5" width="19" height="12.5" rx="2"/><path '+S+' d="M8 21h8M12 17.5V21"/>'+'</g>',
  door:'<path '+S+' d="M6 21V4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21M3.5 21h17"/><circle fill="currentColor" cx="14.6" cy="12.5" r="1.3"/>',
  plus:'<path '+S+' d="M12 5v14M5 12h14"/>',
  minus:'<path '+S+' d="M5 12h14"/>',
  refresh:'<path '+S+' d="M20 6v5h-5"/><path '+S+' d="M19.4 11A7.5 7.5 0 1 0 17 17.5"/>',
  pause:'<path '+S+' stroke-width="3.2" d="M9 5v14M15 5v14"/>',
  play:'<path fill="currentColor" d="M8 5l11 7-11 7z"/>',
  skip:'<path fill="currentColor" d="M5 5l9 7-9 7zM16 5h2.6v14H16z"/>',
  trash:'<path '+S+' d="M4.5 6.5h15M9.5 6.5V4h5v2.5M6.5 6.5l1 13.5h9l1-13.5"/>',
  shield:'<path '+S+' d="M12 3l7.5 3v5.5c0 4.6-3.2 8.2-7.5 9.5-4.3-1.3-7.5-4.9-7.5-9.5V6z"/>',
  tag:'<path '+S+' d="M3.5 12.5V4.5a1 1 0 0 1 1-1h8L21 12l-8.5 8.5z"/><circle fill="currentColor" cx="8" cy="8" r="1.6"/>',
  smile:'<circle '+S+' cx="12" cy="12" r="9"/><path '+S+' d="M8.3 14.2c1 1.4 2.2 2 3.7 2s2.7-.6 3.7-2"/><circle fill="currentColor" cx="9" cy="10" r="1.3"/><circle fill="currentColor" cx="15" cy="10" r="1.3"/>',
  eyeoff:'<path '+S+' d="M3 3l18 18M10.6 6.2A9.9 9.9 0 0 1 12 6c5 0 8.5 4.5 9.5 6-.5.8-1.6 2.3-3.2 3.6M6.4 7.5C4.6 8.8 3.3 10.6 2.5 12c1 1.5 4.5 6 9.5 6 1.5 0 2.9-.4 4.1-1"/>',
  eye:'<path '+S+' d="M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"/><circle '+S+' cx="12" cy="12" r="3"/>',
  sound:'<path '+S+' d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path '+S+' d="M16 9a4 4 0 0 1 0 6M18.6 6.5a7.5 7.5 0 0 1 0 11"/>',
  mute:'<g transform="translate(-0.75 0)">'+'<path '+S+' d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path '+S+' d="M16.5 9.5l5 5M21.5 9.5l-5 5"/>'+'</g>',
  bolt:'<path '+S+' d="M13 2.5L5 13.5h6L10 21.5 19 10h-6z"/>',
  vibe:'<rect '+S+' x="7.5" y="4" width="9" height="16" rx="2"/><path '+S+' d="M4 8.5v7M20 8.5v7"/>',
  sparkle:'<g transform="translate(-1.25 0)">'+'<path fill="currentColor" d="M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9zM19 15l.9 2.6 2.6.9-2.6.9L19 22l-.9-2.6-2.6-.9 2.6-.9z"/>'+'</g>',
  hand:'<g transform="translate(2.06 0.5)">'+'<path '+S+' d="M8 12V5.5a1.5 1.5 0 0 1 3 0V11M11 10V4a1.5 1.5 0 0 1 3 0v6M14 10.5V5.5a1.5 1.5 0 0 1 3 0V13c0 4-2.5 7.5-6.5 7.5-2.6 0-4.3-1.3-5.6-3.4L3 13.2a1.5 1.5 0 0 1 2.4-1.7L8 14"/>'+'</g>',
  list:'<path '+S+' d="M9 6h11M9 12h11M9 18h11"/><circle fill="currentColor" cx="4.5" cy="6" r="1.4"/><circle fill="currentColor" cx="4.5" cy="12" r="1.4"/><circle fill="currentColor" cx="4.5" cy="18" r="1.4"/>',
  grid:'<rect '+S+' x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect '+S+' x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect '+S+' x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect '+S+' x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
  send:'<path '+S+' d="M21 3L10 14M21 3l-6.5 18-4.5-7-7-4.5z"/>',
  flag:'<path '+S+' d="M5 21V4M5 4.5c4-2 7 2 14 0v9c-7 2-10-2-14 0"/>',
  trophy:'<path '+S+' d="M7.5 4h9v5a4.5 4.5 0 0 1-9 0zM7.5 6H4c0 3 1.5 4.5 3.7 4.8M16.5 6H20c0 3-1.5 4.5-3.7 4.8M12 13.5V17M8.5 20.5h7M9.5 17h5v3.5h-5z"/>',
  key:'<circle '+S+' cx="8" cy="12" r="4"/><path '+S+' d="M12 12h9M18 12v3M21 12v2"/>',
  calib:'<path '+S+' d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5"/>',
  dice:'<rect '+S+' x="4" y="4" width="16" height="16" rx="3.5"/><circle fill="currentColor" cx="8.5" cy="8.5" r="1.5"/><circle fill="currentColor" cx="15.5" cy="15.5" r="1.5"/><circle fill="currentColor" cx="12" cy="12" r="1.5"/>',
  shuffle:'<path '+S+' d="M3 7h3.5c5 0 6 10 11 10H21M17.5 13.5L21 17l-3.5 3.5M3 17h3.5c1.5 0 2.6-.8 3.4-1.9M14 8.9C14.8 7.8 15.9 7 17.5 7H21M17.5 3.5L21 7l-3.5 3.5"/>',
  wifi:'<path '+S+' d="M2.5 9a14 14 0 0 1 19 0M5.5 12.3a9.5 9.5 0 0 1 13 0M8.6 15.6a5 5 0 0 1 6.8 0"/><circle fill="currentColor" cx="12" cy="19" r="1.5"/>'
};
DS.icon = function(name){ return '<svg viewBox="0 0 24 24" aria-hidden="true">'+(ICONS[name]||'')+'</svg>'; };

/* ---------- ゲームの印（カセットの顔）。線は currentColor（世界の字の色） ---------- */
var uid = 0;
var EMB = {
  bomb:function(){ return ''+
    '<path d="M96 10l4.2 12.8L113 27l-12.8 4.2L96 44l-4.2-12.8L79 27l12.8-4.2z" fill="var(--e2,#FFD54A)"/>'+
    '<path d="M74 46c3-10 9-16 16-17" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round"/>'+
    '<rect x="61" y="38" width="21" height="17" rx="3.5" transform="rotate(45 71.5 46.5)" fill="var(--e1,#232327)" stroke="currentColor" stroke-width="6" stroke-linejoin="round"/>'+
    '<circle cx="52" cy="73" r="35" fill="var(--e1,#232327)" stroke="currentColor" stroke-width="6"/>'+
    '<path d="M33 66a21 21 0 0 1 14-17" fill="none" stroke="currentColor" stroke-width="5.5" stroke-linecap="round" opacity=".5"/>'; },
  quiz:function(){ return ''+
    '<path d="M38 103l-6 13 17-8" fill="var(--e1,#F2F7FF)" stroke="currentColor" stroke-width="6" stroke-linejoin="round"/>'+
    '<circle cx="60" cy="72" r="37" fill="var(--e1,#F2F7FF)" stroke="currentColor" stroke-width="6"/>'+
    '<path d="M48.5 63.5a11.5 11.5 0 1 1 17 10c-3.4 1.9-5.5 4.2-5.5 8v2.5" fill="none" stroke="var(--e3,#0B2D72)" stroke-width="9" stroke-linecap="round"/>'+
    '<circle cx="60" cy="96" r="5.6" fill="var(--e3,#0B2D72)"/>'+
    '<path d="M35 37L40 11l13 14 7-19 7 19 13-14 5 26z" fill="var(--e2,#F5C542)" stroke="currentColor" stroke-width="6" stroke-linejoin="round"/>'; },
  wolf:function(){ return ''+
    '<circle cx="90" cy="26" r="15" fill="var(--e2,#FFE38A)" stroke="currentColor" stroke-width="5.5"/>'+
    '<path d="M36 56L40 22l17 18" fill="var(--e1,#160A33)" stroke="currentColor" stroke-width="6" stroke-linejoin="round"/>'+
    '<path d="M84 56L80 22 63 40" fill="var(--e1,#160A33)" stroke="currentColor" stroke-width="6" stroke-linejoin="round"/>'+
    '<circle cx="60" cy="64" r="27" fill="var(--e1,#160A33)" stroke="currentColor" stroke-width="6"/>'+
    '<path d="M44.5 58q6.5-7 13 0q-6.5 4.6-13 0z" fill="var(--e2,#FFE38A)"/>'+
    '<path d="M62.5 58q6.5-7 13 0q-6.5 4.6-13 0z" fill="var(--e2,#FFE38A)"/>'+
    '<path d="M6 112a54 46 0 0 1 108 0z" fill="var(--e3,#2E1A6B)" stroke="currentColor" stroke-width="6" stroke-linejoin="round"/>'; },
  auction:function(){ return ''+
    '<rect x="14" y="92" width="62" height="17" rx="6" fill="var(--e1,#3A2408)" stroke="currentColor" stroke-width="6"/>'+
    '<path d="M60 60l42 42" stroke="currentColor" stroke-width="16" stroke-linecap="round"/>'+
    '<path d="M60 60l42 42" stroke="var(--e1,#3A2408)" stroke-width="6" stroke-linecap="round"/>'+
    '<g transform="rotate(-45 50 50)">'+
      '<rect x="27" y="36" width="46" height="28" rx="7" fill="var(--e2,#F2C14E)" stroke="currentColor" stroke-width="6"/>'+
      '<rect x="19" y="30" width="12" height="40" rx="4" fill="var(--e2,#F2C14E)" stroke="currentColor" stroke-width="6"/>'+
      '<rect x="69" y="30" width="12" height="40" rx="4" fill="var(--e2,#F2C14E)" stroke="currentColor" stroke-width="6"/>'+
    '</g>'+
    '<path d="M18 78l-9-5M27 70l-5-9" stroke="var(--e2,#F2C14E)" stroke-width="5.5" stroke-linecap="round"/>'; },
  sugoroku:function(){ return ''+
    '<rect x="8" y="96" width="17" height="17" rx="4" fill="var(--e2,#E0483E)" stroke="currentColor" stroke-width="4.5"/>'+
    '<rect x="31" y="100" width="17" height="13" rx="4" fill="var(--e1,#FFFFFF)" stroke="currentColor" stroke-width="4.5"/>'+
    '<g transform="rotate(-13 66 56)">'+
      '<rect x="31" y="21" width="70" height="70" rx="15" fill="var(--e1,#FFFFFF)" stroke="currentColor" stroke-width="6"/>'+
      '<circle cx="48" cy="38" r="6.5" fill="var(--e3,#11200C)"/><circle cx="84" cy="38" r="6.5" fill="var(--e3,#11200C)"/>'+
      '<circle cx="66" cy="56" r="8" fill="var(--e2,#E0483E)"/>'+
      '<circle cx="48" cy="74" r="6.5" fill="var(--e3,#11200C)"/><circle cx="84" cy="74" r="6.5" fill="var(--e3,#11200C)"/>'+
    '</g>'; },
  falsetrue:function(){ var id='ftc'+(++uid); return ''+
    '<path d="M44 34v-9a7 7 0 0 1 7-7h18a7 7 0 0 1 7 7v9" fill="none" stroke="currentColor" stroke-width="6"/>'+
    '<clipPath id="'+id+'"><rect x="12" y="34" width="96" height="70" rx="13"/></clipPath>'+
    '<g clip-path="url(#'+id+')"><rect x="12" y="34" width="96" height="70" fill="var(--e2,#4FD28A)"/><path d="M76 34H108V104H44z" fill="var(--e3,#F07C70)"/></g>'+
    '<rect x="12" y="34" width="96" height="70" rx="13" fill="none" stroke="currentColor" stroke-width="6"/>'+
    '<rect x="49" y="58" width="22" height="18" rx="5" fill="var(--e1,#F4F4F4)" stroke="currentColor" stroke-width="5"/>'; },
  rcard:function(){ return ''+
    '<g transform="rotate(-9 60 62)">'+
      '<rect x="25" y="12" width="70" height="98" rx="11" fill="var(--e1,#F3E3C3)" stroke="currentColor" stroke-width="6"/>'+
      '<path d="M38 24l5 7-5 7-5-7z" fill="var(--e3,#2A0A10)"/>'+
      '<path d="M82 86l5 7-5 7-5-7z" fill="var(--e3,#2A0A10)"/>'+
      '<circle cx="58" cy="67" r="17" fill="var(--e3,#2A0A10)"/>'+
      '<path d="M68 54c3-6 7-9 12-9" fill="none" stroke="var(--e3,#2A0A10)" stroke-width="5" stroke-linecap="round"/>'+
      '<path d="M84 37l2.4 6.6 6.6 2.4-6.6 2.4L84 55l-2.4-6.6L75 46l6.6-2.4z" fill="var(--e2,#E4572E)"/>'+
    '</g>'; },
  shinka:function(){ return ''+
    '<path d="M60 10c24 0 39 39 39 63 0 25-17 38-39 38S21 98 21 73c0-24 15-63 39-63z" fill="var(--e1,#FFF6DD)"/>'+
    '<path d="M22.5 64l13-9 11 12 13-12 13 12 11-12 13.5 9" fill="none" stroke="var(--e2,#E4572E)" stroke-width="6.5" stroke-linejoin="round" stroke-linecap="round"/>'+
    '<path d="M60 10c24 0 39 39 39 63 0 25-17 38-39 38S21 98 21 73c0-24 15-63 39-63z" fill="none" stroke="currentColor" stroke-width="6"/>'+
    '<path d="M104 12v14M97 19h14" stroke="var(--e2,#E4572E)" stroke-width="5" stroke-linecap="round"/>'+
    '<path d="M14 18v9M9.5 22.5h9" stroke="var(--e2,#E4572E)" stroke-width="4" stroke-linecap="round"/>'; }
};
DS.emblem = function(name){
  if(name === 'aresore') return '<img class="logo" src="assets/logo-aresore.png" alt="あれそれどれこれ">';
  var f = EMB[name]; return f ? '<svg viewBox="0 0 120 120" aria-hidden="true">'+f()+'</svg>' : '';
};
/* カセットの一覧（棚・投票・印でつかう。名前・世界・説明・人数） */
DS.CASSETTES = [
  {id:'bomb',     w:'bomb',     name:'爆弾解除',        game:'クイズ解除', blurb:'問題を解いて、爆発を止める', ppl:'2〜8人', min:'5分〜', genre:'あたまをつかう', ways:'両方'},
  {id:'quiz',     w:'quiz',     name:'クイズ王',        blurb:'1人1台で解いて競う',         ppl:'2人〜',  min:'5分〜', genre:'あたまをつかう', ways:'部屋'},
  {id:'shinka',   w:'shinka',   name:'進化じゃんけん',  blurb:'勝てば1つ上の段へ進化する',  ppl:'3〜12人',min:'5分〜', genre:'かけひき', ways:'部屋'},
  {id:'rcard',    w:'rcard',    name:'ロシアンカード',  blurb:'しかけ合って、めくり合う',   ppl:'2〜8人', min:'5分〜', genre:'かけひき', ways:'部屋'},
  {id:'falsetrue',w:'falsetrue',name:'False or True',   blurb:'奪うか、奪わないか',          ppl:'4〜12人',min:'10分〜',genre:'正体をさぐる', ways:'部屋'},
  {id:'wolf',     w:'wolf',     name:'人狼ゲーム',      blurb:'正体を隠して探り合う',        ppl:'3人〜',  min:'10分〜',genre:'正体をさぐる', ways:'両方'},
  {id:'sugoroku', w:'sugoroku', name:'すごろく',        blurb:'先頭ほど、進むのが高くつく',  ppl:'3〜8人', min:'15分〜',genre:'かけひき', ways:'両方'},
  {id:'auction',  w:'auction',  name:'オークション',    blurb:'値をつけて競り合う',          ppl:'3〜8人', min:'15分〜',genre:'かけひき', ways:'部屋'},
  {id:'aresore',  w:'aresore',  name:'あれそれどれこれ',blurb:'ことばで説明して当てる',      ppl:'2〜8人', min:'7分〜', genre:'ことばであそぶ', ways:'1台'}
];

/* ---------- 絵文字 → Twemoji（アプリと同じ。置いてある絵だけ差し替える） ---------- */
var EMO = /(?:[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{1F1E6}-\u{1F1FF}](?:\u{FE0F})?(?:[\u{1F3FB}-\u{1F3FF}])?(?:\u{200D}[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}](?:\u{FE0F})?)*(?:\u{20E3})?|[0-9#*]\u{FE0F}?\u{20E3}|[\u{00A9}\u{00AE}\u{2122}\u{2190}-\u{21FF}\u{3030}\u{303D}\u{3297}\u{3299}]\u{FE0F})/gu;
function twCode(s){
  var cps = Array.from(s).map(function(c){ return c.codePointAt(0).toString(16); });
  if(s.indexOf('‍') < 0) cps = cps.filter(function(c){ return c !== 'fe0f'; });
  return cps.join('-');
}
DS.twCode = twCode;
function twemojify(el){
  var have = window.TW_LIST || null;
  var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
  var nodes = [], n;
  while((n = walker.nextNode())){ if(EMO.test(n.nodeValue)) nodes.push(n); EMO.lastIndex = 0; }
  nodes.forEach(function(node){
    var p = node.parentNode; if(!p || p.closest && p.closest('svg,script,style,.no-tw')) return;
    var frag = document.createDocumentFragment(), s = node.nodeValue, last = 0;
    s.replace(EMO, function(m, off){
      var code = twCode(m);
      if(have && !have[code]){ return m; }
      if(off > last) frag.appendChild(document.createTextNode(s.slice(last, off)));
      var img = document.createElement('img');
      img.className = 'emj'; img.alt = m; img.draggable = false; img.src = 'tw/' + code + '.svg';
      frag.appendChild(img); last = off + m.length; return m;
    });
    if(last === 0) return;
    if(last < s.length) frag.appendChild(document.createTextNode(s.slice(last)));
    p.replaceChild(frag, node);
  });
}
DS.twemojify = twemojify;
/* あとから描いた部分に、アイコン・印・絵文字を入れる */
DS.fitText = function(root){
  (root || document).querySelectorAll('[data-fit]').forEach(function(el){
    el.style.fontSize = ''; el.style.whiteSpace = 'nowrap';
    var fs = parseFloat(getComputedStyle(el).fontSize), min = fs * 0.7, n = 0;
    while(el.scrollWidth > el.clientWidth + 1 && fs > min && n++ < 60){ fs -= 0.5; el.style.fontSize = fs + 'px'; }
  });
};
DS.hydrate = function(el){
  el.querySelectorAll('.ic[data-ic]').forEach(function(i){ if(!i.firstChild) i.innerHTML = DS.icon(i.getAttribute('data-ic')); });
  el.querySelectorAll('.emb[data-emb]').forEach(function(i){ if(!i.firstChild) i.innerHTML = DS.emblem(i.getAttribute('data-emb')); });
  twemojify(el);
  DS.fitText(el);
};

/* ---------- 名前の壁 ---------- */
var DEF_NAMES = ['あき','ひろ','びび','ちか','でん','えみ','ふう','くまくん'];
function fillNames(el){
  var list = (el.getAttribute('data-names') || '').split(',').filter(Boolean);
  if(!list.length) list = DEF_NAMES;
  var rows = parseInt(el.getAttribute('data-rows') || (el.closest('.tv') ? 13 : 20), 10);
  var line = (list.join(' / ') + ' / ');
  var html = '';
  for(var r = 0; r < rows; r++){
    var k = r % list.length, rot = list.slice(k).concat(list.slice(0, k));
    var seg = rot.join(' / ') + ' / ';
    var rep = seg.repeat(Math.max(3, Math.ceil(60 / seg.length)));
    html += '<div class="nr">' + rep + rep + '</div>';
  }
  el.innerHTML = html;
}
/* 名前を1つ光らせる（入場の知らせ） */
DS.glowName = function(wall, name){
  var rows = wall.querySelectorAll('.nr'); if(!rows.length) return;
  var mid = rows[Math.floor(rows.length / 2) - 1] || rows[0];
  var wr = wall.closest('.scr,.tv').getBoundingClientRect();
  // まん中あたりの行の中から、画面のまん中に近い位置の名前を光らせる
  var target = null, best = 1e9;
  [rows[Math.floor(rows.length*0.42)], rows[Math.floor(rows.length*0.5)], mid].forEach(function(row){
    if(!row) return;
    if(row.childNodes.length !== 1 || row.firstChild.nodeType !== 3){ row.textContent = row.textContent; }
    var txt = row.textContent, i = -1;
    while((i = txt.indexOf(name, i + 1)) >= 0){
      var range = document.createRange();
      var tn = row.firstChild; if(!tn || tn.nodeType !== 3 || i + name.length > tn.length) continue;
      range.setStart(tn, i); range.setEnd(tn, i + name.length);
      var rr = range.getBoundingClientRect();
      var cx = rr.left + rr.width/2 - (wr.left + wr.width*0.55), cy = rr.top + rr.height/2 - (wr.top + wr.height*0.45);
      var d = cx*cx + cy*cy;
      if(d < best && rr.left > wr.left && rr.right < wr.right && rr.top > wr.top){ best = d; target = {row:row, i:i}; }
    }
  });
  if(!target) return;
  var row = target.row, t = row.textContent;
  row.innerHTML = '';
  row.appendChild(document.createTextNode(t.slice(0, target.i)));
  var sp = document.createElement('span'); sp.className = 'hi'; sp.textContent = name; row.appendChild(sp);
  row.appendChild(document.createTextNode(t.slice(target.i + name.length)));
  setTimeout(function(){ row.textContent = t; }, 2700 * fx());
};

/* ---------- のこり時間 ---------- */
var groups = {};
function digits(n){ return String(n).split('').map(function(d){ return '<i>'+d+'</i>'; }).join(''); }
function renderCd(el, v){
  var lo = parseInt(el.getAttribute('data-lo') || '5', 10);
  var n = el.querySelector('.n'); if(n) n.innerHTML = digits(v);
  el.classList.toggle('lo', v <= lo);
  el.classList.toggle('one', v < 10);
  if(v <= lo && n){ n.style.animation = 'none'; void n.offsetWidth; n.style.animation = ''; }
}
function setupCd(el){
  var start = parseInt(el.getAttribute('data-cd'), 10);
  var label = el.hasAttribute('data-label') ? el.getAttribute('data-label') : 'のこり';
  var unit = el.hasAttribute('data-unit') ? el.getAttribute('data-unit') : '秒';
  el.innerHTML = (label ? '<span class="l">'+label+'</span>' : '') + '<b class="n"></b>' + (unit ? '<span class="u">'+unit+'</span>' : '');
  var g = el.getAttribute('data-group') || ('g' + (++uid));
  el.setAttribute('data-group', g);
  if(!groups[g]) groups[g] = {start:start, v:start, members:[], hold:el.hasAttribute('data-hold'), wait:0};
  groups[g].members.push(el);
  renderCd(el, start);
}
function tickGroups(){
  Object.keys(groups).forEach(function(k){
    var g = groups[k];
    if(g.paused) return;
    if(g.v <= 0){ if(g.hold) return; if(++g.wait < 2) return; g.wait = 0; g.v = g.start + 1; }
    g.v--;
    g.members.forEach(function(el){ renderCd(el, g.v); });
    document.querySelectorAll('[data-cdnum][data-group="'+k+'"]').forEach(function(b){ b.textContent = g.v; });
    document.querySelectorAll('.syncbar[data-group="'+k+'"] i').forEach(function(i){
      i.style.transition = g.v === g.start ? 'none' : 'transform 1s linear';
      i.style.transform = 'scaleX(' + (g.v / g.start) + ')';
    });
  });
}
DS.resetGroup = function(k, v){ var g = groups[k]; if(!g) return; g.v = (v === undefined ? g.start : v); g.wait = 0;
  g.members.forEach(function(el){ renderCd(el, g.v); });
  document.querySelectorAll('.syncbar[data-group="'+k+'"] i').forEach(function(i){ i.style.transition='none'; i.style.transform='scaleX('+(g.v/g.start)+')'; });
  document.querySelectorAll('[data-cdnum][data-group="'+k+'"]').forEach(function(b){ b.textContent = g.v; });
};
DS.groups = groups;

/* ---------- 開く・閉じる ---------- */
function screenOf(el){ return el.closest('.scr,.tv'); }
function q(scr, sel){ return sel.charAt(0) === '#' ? (scr.querySelector('[data-id="'+sel.slice(1)+'"]') || document.querySelector(sel)) : scr.querySelector(sel); }
DS.q = q;
function openT(scr, t){
  if(!t) return;
  t.classList.add('open');
  var sc = t.getAttribute('data-scrim');
  if(sc){ var s = q(scr, sc); if(s) s.classList.add('open'); }
  t.dispatchEvent(new CustomEvent('ds:open', {bubbles:true}));
}
function closeT(scr, t){
  if(!t) return;
  t.classList.remove('open');
  var sc = t.getAttribute('data-scrim');
  if(sc){ var s = q(scr, sc); if(s) s.classList.remove('open'); }
  t.dispatchEvent(new CustomEvent('ds:close', {bubbles:true}));
}
DS.open = function(scr, sel){ openT(scr, q(scr, sel)); };
DS.close = function(scr, sel){ closeT(scr, q(scr, sel)); };

var lpFired = false;
document.addEventListener('click', function(e){
  var el = e.target.closest('[data-open],[data-close],[data-toggle],[data-pick],[data-replay],[data-zoom]');
  if(!el) return;
  if(lpFired){ lpFired = false; e.preventDefault(); return; }
  var scr = screenOf(el);
  if(el.hasAttribute('data-replay')){ replay(el.closest('.frame')); return; }
  if(el.hasAttribute('data-zoom')){ zoom(el.closest('.frame')); return; }
  if(el.hasAttribute('data-pick')){
    var box = el.closest('[data-picks]');
    if(box){ box.querySelectorAll('[data-pick]').forEach(function(x){ x.classList.toggle('on', x === el); }); }
    el.dispatchEvent(new CustomEvent('ds:pick', {bubbles:true, detail:el.getAttribute('data-pick')}));
  }
  if(!scr) return;
  if(el.hasAttribute('data-toggle')){ var t = q(scr, el.getAttribute('data-toggle')); if(t){ t.classList.contains('open') ? closeT(scr, t) : openT(scr, t); } }
  if(el.hasAttribute('data-open')){ openT(scr, q(scr, el.getAttribute('data-open'))); }
  if(el.hasAttribute('data-close')){
    var v = el.getAttribute('data-close');
    var t2 = v ? q(scr, v) : el.closest('.sheet,.dlg,.pop,.toast');
    closeT(scr, t2);
  }
});

/* ---------- 長押し（450ミリ秒。速さの設定ではかわらない） ---------- */
var lp = null;
function scrScale(scr){ var r = scr.getBoundingClientRect(); return r.width / scr.offsetWidth; }
document.addEventListener('pointerdown', function(e){
  var el = e.target.closest('[data-lp]'); if(!el) return;
  var scr = screenOf(el); if(!scr) return;
  var s = scrScale(scr), r = scr.getBoundingClientRect();
  var ring = scr.querySelector('.lpring');
  if(!ring){ ring = document.createElement('div'); ring.className = 'lpring';
    ring.innerHTML = '<svg viewBox="0 0 56 56"><circle class="base" cx="28" cy="28" r="24"/><circle class="run" cx="28" cy="28" r="24" transform="rotate(-90 28 28)"/></svg>';
    scr.appendChild(ring); }
  ring.style.left = ((e.clientX - r.left) / s) + 'px'; ring.style.top = ((e.clientY - r.top) / s - 34) + 'px';
  ring.classList.remove('on'); void ring.offsetWidth; ring.classList.add('on');
  lp = {el:el, x:e.clientX, y:e.clientY, ring:ring, t:setTimeout(function(){
    ring.classList.remove('on'); lpFired = true;
    el.dispatchEvent(new CustomEvent('ds:longpress', {bubbles:true}));
    openT(scr, q(scr, el.getAttribute('data-lp')));
    setTimeout(function(){ lpFired = false; }, 600);
  }, 450)};
});
function lpCancel(){ if(!lp) return; clearTimeout(lp.t); lp.ring.classList.remove('on'); lp = null; }
document.addEventListener('pointerup', lpCancel);
document.addEventListener('pointercancel', lpCancel);
document.addEventListener('pointermove', function(e){ if(lp && (Math.abs(e.clientX-lp.x) > 10 || Math.abs(e.clientY-lp.y) > 10)) lpCancel(); });
document.addEventListener('contextmenu', function(e){ if(e.target.closest('[data-lp]')) e.preventDefault(); });

/* ---------- 再生（動きのある画面）。画面ごとのタイマーは「もう一度」で全部消す ---------- */
var timers = new WeakMap();
DS.later = function(scr, ms, fn){
  var list = timers.get(scr) || []; timers.set(scr, list);
  var id = setTimeout(fn, ms * fx()); list.push(id); return id;
};
DS.every = function(scr, ms, fn){
  var list = timers.get(scr) || []; timers.set(scr, list);
  var id = setInterval(fn, ms * fx()); list.push(id); return id;
};
function clearScr(scr){ (timers.get(scr) || []).forEach(function(id){ clearTimeout(id); clearInterval(id); }); timers.set(scr, []); }
function startScr(scr, why){
  clearScr(scr);
  scr.classList.remove('play'); void scr.offsetWidth; scr.classList.add('play');
  scr.dispatchEvent(new CustomEvent('ds:start', {detail:why}));
}
function replay(frame){
  if(!frame) return;
  frame.querySelectorAll('.scr,.tv').forEach(function(s){
    s.querySelectorAll('[data-group]').forEach(function(c){ var g = c.getAttribute('data-group'); if(groups[g]) DS.resetGroup(g); });
    s.querySelectorAll('.open').forEach(function(o){ o.classList.remove('open'); });
    startScr(s, 'replay');
  });
}
DS.replay = replay;
/* 画面ごとの台本：DS.scene(scrの data-id, function(scr){ ... }) */
var scenes = {};
DS.scene = function(id, fn){ scenes[id] = fn; };

/* ---------- 枠の縮め方 ---------- */
function fit(frame){
  var stage = frame.querySelector('.stage'); if(!stage) return;
  var child = stage.firstElementChild; if(!child) return;
  var w = child.offsetWidth, h = child.offsetHeight;
  var box = frame.classList.contains('zoomed') ? null : stage;
  var cw = box ? box.clientWidth : w;
  var s = cw / w;
  if(root.classList.contains('native')){ s = 1; stage.style.width = w + 'px'; stage.style.height = h + 'px'; child.style.setProperty('--s', 1); return; }
  if(frame.classList.contains('zoomed')){
    var vw = window.innerWidth - 32, vh = window.innerHeight - 100;
    s = Math.min(vw / w, vh / h);
    stage.style.width = (w * s) + 'px';
  } else { stage.style.width = ''; }
  stage.style.height = (h * s) + 'px';
  child.style.setProperty('--s', s);
}
DS.fit = fit;

/* ---------- 大きく見る ---------- */
var zoomer = null, zoomBack = null;
function zoom(frame){
  if(!zoomer){
    zoomer = document.createElement('div'); zoomer.className = 'zoomer';
    zoomer.innerHTML = '<button class="zclose" type="button">とじる</button><div class="zbox"></div>';
    document.body.appendChild(zoomer);
    zoomer.addEventListener('click', function(e){ if(e.target === zoomer || e.target.classList.contains('zclose')) unzoom(); });
    document.addEventListener('keydown', function(e){ if(e.key === 'Escape') unzoom(); });
  }
  var holder = frame.querySelector('.ph,.tvf');
  zoomBack = {frame:frame, holder:holder, ph:document.createComment('z')};
  holder.parentNode.insertBefore(zoomBack.ph, holder);
  zoomer.querySelector('.zbox').appendChild(holder);
  frame.classList.add('zoomed'); holder.classList.add('zoomed');
  holder.style.width = 'auto';
  zoomer.classList.add('open');
  fitZoom();
}
function fitZoom(){
  if(!zoomBack) return;
  var holder = zoomBack.holder, stage = holder.querySelector('.stage'), child = stage.firstElementChild;
  var w = child.offsetWidth, h = child.offsetHeight;
  var s = Math.min((window.innerWidth - 40) / w, (window.innerHeight - 110) / h);
  stage.style.width = (w * s) + 'px'; stage.style.height = (h * s) + 'px'; child.style.setProperty('--s', s);
}
function unzoom(){
  if(!zoomBack) return;
  var z = zoomBack; zoomBack = null;
  z.ph.parentNode.insertBefore(z.holder, z.ph); z.ph.remove();
  z.frame.classList.remove('zoomed'); z.holder.classList.remove('zoomed'); z.holder.style.width = '';
  zoomer.classList.remove('open');
  var st = z.holder.querySelector('.stage'); st.style.width = '';
  fit(z.frame);
}
window.addEventListener('resize', function(){ if(zoomBack) fitZoom(); });

/* ---------- ページ上の切り替え（演出・スマホの大きさ・TVの安全な枠） ---------- */
function setFx(v){
  var map = {normal:1, fast:.5, none:.001};
  root.style.setProperty('--fx', map[v] || 1);
  root.classList.toggle('fx-none', v === 'none');
  document.querySelectorAll('[data-fxset]').forEach(function(b){ b.setAttribute('aria-pressed', b.getAttribute('data-fxset') === v ? 'true' : 'false'); });
  store('ds-fx', v);
}
function setPh(v){
  root.classList.toggle('ph-small', v === 'small');
  document.querySelectorAll('[data-phset]').forEach(function(b){ b.setAttribute('aria-pressed', b.getAttribute('data-phset') === v ? 'true' : 'false'); });
  store('ds-ph', v);
  requestAnimationFrame(function(){ document.querySelectorAll('.frame').forEach(fit); });
}
function wireControls(){
  document.querySelectorAll('[data-fxset]').forEach(function(b){ b.addEventListener('click', function(){ setFx(b.getAttribute('data-fxset')); document.querySelectorAll('.frame').forEach(function(f){ if(!f.classList.contains('off')) replay(f); }); }); });
  document.querySelectorAll('[data-phset]').forEach(function(b){ b.addEventListener('click', function(){ setPh(b.getAttribute('data-phset')); }); });
  var sa = document.getElementById('ctl-safe');
  if(sa){ sa.addEventListener('change', function(){ root.classList.toggle('show-safe', sa.checked); store('ds-safe', sa.checked ? '1' : '0'); });
    if(store('ds-safe') === '1'){ sa.checked = true; root.classList.add('show-safe'); } }
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  setFx(store('ds-fx') || (reduce ? 'none' : 'normal'));
  setPh(store('ds-ph') || 'normal');
}

/* ---------- 枠の組み立て：<div class="frame" data-cap="…"><div class="scr …">…</div></div> だけ書けばよい ---------- */
var DARK = /\bw-(wolf|bomb|quiz|auction|falsetrue|rcard)\b/;
function assemble(){
  document.querySelectorAll('.frame').forEach(function(fr){
    if(fr.querySelector('.stage')) return;
    var scr = null;
    for(var i = 0; i < fr.children.length; i++){ var c = fr.children[i]; if(c.classList.contains('scr') || c.classList.contains('tv')){ scr = c; break; } }
    if(!scr) return;
    var isTV = scr.classList.contains('tv');
    var size = fr.getAttribute('data-size') || '';
    var cap = fr.getAttribute('data-cap') || (isTV ? '大画面（TV）' : 'スマホ');
    var capEl = document.createElement('div'); capEl.className = 'frame-cap';
    capEl.innerHTML = '<span>' + cap + '</span><span class="sp"></span>' +
      (fr.hasAttribute('data-noreplay') ? '' : '<button type="button" data-replay>もう一度</button>') +
      '<button type="button" data-zoom>大きく</button>';
    var holder = document.createElement('div'); holder.className = (isTV ? 'tvf' : 'ph') + (size ? ' ' + size : '');
    holder.innerHTML = '<div class="bezel"><div class="stage"></div></div>';
    holder.querySelector('.stage').appendChild(scr);
    fr.appendChild(capEl); fr.appendChild(holder);
    // 背景の層（円・名前の壁）
    var hasBg = false; for(var j = 0; j < scr.children.length; j++){ if(scr.children[j].classList.contains('bg')) hasBg = true; }
    if(!hasBg && !scr.hasAttribute('data-nobg')){
      var want = scr.getAttribute('data-bg') || (DARK.test(scr.className) ? 'circles names' : 'circles');
      var bg = document.createElement('div'); bg.className = 'bg'; var h = '';
      if(want.indexOf('circles') >= 0) h += '<div class="circles"><i></i><i></i><i></i></div>';
      if(want.indexOf('names') >= 0) h += '<div class="names"' + (scr.getAttribute('data-names') ? ' data-names="' + scr.getAttribute('data-names') + '"' : '') + '></div>';
      bg.innerHTML = h; scr.insertBefore(bg, scr.firstChild);
    }
    if(isTV){
      if(!scr.hasAttribute('data-nobrand') && !scr.querySelector('.tbrand')){ var tb = document.createElement('div'); tb.className = 'tbrand'; tb.textContent = 'ATSUMARE AREKORE.'; scr.appendChild(tb); }
      if(!scr.querySelector('.guide')){ var gd = document.createElement('div'); gd.className = 'guide'; scr.appendChild(gd); }
    } else {
      if(!scr.hasAttribute('data-nobrand') && !scr.querySelector('.brand')){ var br = document.createElement('div'); br.className = 'brand'; br.textContent = 'ATSUMARE AREKORE.'; scr.appendChild(br); }
      if(!scr.hasAttribute('data-nogear') && !scr.querySelector('.corner.r')){
        var cr = document.createElement('div'); cr.className = 'corner r';
        var who = scr.getAttribute('data-who');
        cr.innerHTML = (who ? '<button type="button" class="cbtn who" aria-label="いる人"' + (scr.getAttribute('data-who-open') ? ' data-open="' + scr.getAttribute('data-who-open') + '"' : '') + '><span class="ring"><i class="ic" data-ic="people"></i>' + who + '</span></button>' : '') +
          '<button type="button" class="cbtn" aria-label="設定"' + (scr.getAttribute('data-gear-open') ? ' data-open="' + scr.getAttribute('data-gear-open') + '"' : '') + '><span class="ring"><i class="ic" data-ic="gear"></i></span></button>';
        scr.appendChild(cr);
      }
    }
  });
}
DS.assemble = assemble;

/* ---------- はじまり ---------- */
function boot(){
  assemble();
  wireControls();
  document.querySelectorAll('.ic[data-ic]').forEach(function(i){ i.innerHTML = DS.icon(i.getAttribute('data-ic')); });
  document.querySelectorAll('.emb[data-emb]').forEach(function(i){ i.innerHTML = DS.emblem(i.getAttribute('data-emb')); });
  document.querySelectorAll('.names').forEach(fillNames);
  document.querySelectorAll('.scr,.tv').forEach(twemojify);
  document.querySelectorAll('.cdx[data-cd],.tcd[data-cd]').forEach(setupCd);
  document.querySelectorAll('.frame').forEach(fit);
  if(window.ResizeObserver){ var ro = new ResizeObserver(function(es){ es.forEach(function(en){ var f = en.target.closest('.frame'); if(f && !f.classList.contains('zoomed')) fit(f); }); });
    document.querySelectorAll('.frame .ph,.frame .tvf').forEach(function(h){ ro.observe(h); }); }
  // 画面ごとの台本
  document.querySelectorAll('.scr[data-id],.tv[data-id]').forEach(function(scr){
    var id = scr.getAttribute('data-id'); if(scenes[id]) scenes[id](scr);
  });
  // 見えたら再生、見えなくなったら背景の動きを止める
  if('IntersectionObserver' in window){
    var io = new IntersectionObserver(function(es){ es.forEach(function(en){
      var f = en.target;
      if(en.isIntersecting){ f.classList.remove('off');
        if(!f.dataset.seen){ f.dataset.seen = '1'; f.querySelectorAll('.scr,.tv').forEach(function(s){ startScr(s, 'enter'); }); } }
      else { f.classList.add('off'); }
    }); }, {threshold:0.35});
    document.querySelectorAll('.frame').forEach(function(f){ io.observe(f); });
  } else { document.querySelectorAll('.scr,.tv').forEach(function(s){ startScr(s, 'enter'); }); }
  setInterval(tickGroups, 1000);
  DS.fitText(document);
  if(document.fonts && document.fonts.ready) document.fonts.ready.then(function(){ DS.fitText(document); });
  document.querySelectorAll('[data-phset]').forEach(function(b){ b.addEventListener('click', function(){ setTimeout(function(){ DS.fitText(document); }, 80); }); });
  document.dispatchEvent(new CustomEvent('ds:ready'));
}
if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
