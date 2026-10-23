// tools/v2-art-src.js — 新しい見た目（指示66）のアイコンとゲームの印の**元の絵**。
// 見本（docs/指示66/見本/assets/ds.js）の絵をそのまま写したもの。**画面はこれを直接読まない。**
// node tools/gen-v2-art.js が Chrome で「描かれている所」を測り、その中心が入れ物の中心に来るように
// viewBox をずらして public/js/v2-art.js に書き出す（指示66-1「中心」。見本では4つだけ手でずらしていた——
// 1つずつ手で合わせると、足した日に合わせ忘れる）。
// アイコンは 24×24・線は currentColor。印は 120×120・色は --e1〜--e3（無ければ既定の色）。
// falsetrue の {{id}} は、描くたびに別の名前にする（同じ画面に2つ出ると clipPath が取り違える）

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
  tv:'<rect '+S+' x="2.5" y="5" width="19" height="12.5" rx="2"/><path '+S+' d="M8 21h8M12 17.5V21"/>',
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
  mute:'<path '+S+' d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path '+S+' d="M16.5 9.5l5 5M21.5 9.5l-5 5"/>',
  bolt:'<path '+S+' d="M13 2.5L5 13.5h6L10 21.5 19 10h-6z"/>',
  vibe:'<rect '+S+' x="7.5" y="4" width="9" height="16" rx="2"/><path '+S+' d="M4 8.5v7M20 8.5v7"/>',
  sparkle:'<path fill="currentColor" d="M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9zM19 15l.9 2.6 2.6.9-2.6.9L19 22l-.9-2.6-2.6-.9 2.6-.9z"/>',
  hand:'<path '+S+' d="M8 12V5.5a1.5 1.5 0 0 1 3 0V11M11 10V4a1.5 1.5 0 0 1 3 0v6M14 10.5V5.5a1.5 1.5 0 0 1 3 0V13c0 4-2.5 7.5-6.5 7.5-2.6 0-4.3-1.3-5.6-3.4L3 13.2a1.5 1.5 0 0 1 2.4-1.7L8 14"/>',
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
  falsetrue:function(){ return ''+
    '<path d="M44 34v-9a7 7 0 0 1 7-7h18a7 7 0 0 1 7 7v9" fill="none" stroke="currentColor" stroke-width="6"/>'+
    '<clipPath id="{{id}}"><rect x="12" y="34" width="96" height="70" rx="13"/></clipPath>'+
    '<g clip-path="url(#{{id}})"><rect x="12" y="34" width="96" height="70" fill="var(--e2,#4FD28A)"/><path d="M76 34H108V104H44z" fill="var(--e3,#F07C70)"/></g>'+
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

module.exports = { ICONS: ICONS, EMB: EMB };
