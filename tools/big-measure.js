// tools/big-measure.js — 大画面（TV）の「いま」を測る式（指示64）
//
// **これは1つだけ置く。**大画面を測る道具は2本ある——
//   tools/big-census.js … 本物のサーバーと bot で最後まで通しながら測る（遅いが、流れそのもの）
//   tools/big-lab.js    … サーバーを立てず、本物の進行役で作った状態を流し込んで測る（速い・決め打ちで届く）
// 2本が別々に式を持つと、片方だけ直した日に「同じ場面なのに数が違う」が起きる（落とし穴1）。
// だから式はここに1つだけ置き、両方がこれを読む。**写さない。**
//
// 測るもの（big-census.js の冒頭のとおり）：
//   巻き … ページが縦に巻けるか（scrollingElement.scrollHeight と clientHeight。落とし穴28：同じ物差しで比べる）
//           ／中の箱が縦に巻けるか（overflow auto/scroll で scrollHeight > clientHeight）
//   切れ … 見えている文字・ボタン・行のうち、画面の外へ出ている／先祖の overflow で切られているもの
//   字   … 見えている文字のうち、正本§11-5 の下限（1280×720 で本文28px。H/720 倍する）より小さいもの
//   目立つ … 大画面でいちばん大きいボタン（面積）と、その文字
//
// **演出の重なりは、切れ・小さい字（と文字の数）から除く**（指示64・大画面の版組みを持つ側の依頼）。
//   巨大カウントダウン（.big-cd は 1.25 倍まで膨らむ）・#uiLayerRoot の中身・画面いっぱいの演出
//   （.fx-banner / .fx-cel / .fx-countdown / .bomb-boom など）は、**わざと画面の端を越えて動く**。
//   版組みの物差しで数えると、進化じゃんけん12人の「手を出す」で毎回 div.big-cd が「切れ」に数えられた。
//   演出そのものの検査は別の指示（指示65）の仕事。
//   - **黙って落とさない**：除いた数は 演出で除いた として別に返す
//   - **fx- で始まるクラスを丸ごと除かない**：.fx-alive・.fx-stagger・.fx-counting・.fx-in などは
//     本物の中身（ボタン・名簿・数字）に付く印なので、除くと本物の切れを見落とす。除くのは重なりの名前だけ
//   - 先祖をたどるのは <body> の手前まで（<html> には .fx-skip が付くので、そこまで行くと全部が除かれる）
//   巻き・中の巻き・ボタンの数え方は変えていない
//
// 使い方：dev.ev(測る) を CDP の端末（tools/cdp.js）で評価する。戻り値は JSON にできる形。

/** 演出の重なりの名前（この中にある要素は、切れ・小さい字に数えない） */
const 演出の重なり = ['big-cd', 'bomb-boom', 'fx-banner', 'fx-cel', 'fx-countdown', 'fx-flash', 'fx-burst',
  'fx-blackout', 'fx-confetti', 'fx-edge', 'fx-shutter', 'fx-dawn', 'fx-notices', 'fx-notice', 'fx-fly', 'fx-word'];

/** 大画面の今を測る（ページの中で評価する式） */
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
  var 切れ=[], 小さい=[], 文字=0, 演出で除いた=0, 除いた例=[];
  var 重なり=${JSON.stringify(演出の重なり)};
  function 演出か(e){ for(var p=e; p && p!==document.body && p!==document.documentElement; p=p.parentElement){ if(p.id==='uiLayerRoot') return true; var cl=p.classList; if(cl) for(var i=0;i<重なり.length;i++){ if(cl.contains(重なり[i])) return true; } } return false; }
  var 候補 = Array.prototype.filter.call(scr.querySelectorAll('*'), function(e){ return 見える(e) && (e.tagName==='BUTTON' || /(^|\\s)(bl-item|bl-card|rk-row|bb-row|sh-tier|bmk-c|bmk-k)(\\s|$)/.test(typeof e.className==='string'?e.className:'') || Array.prototype.some.call(e.childNodes,function(n){return n.nodeType===3&&n.textContent.trim().length>0;})); });
  候補.forEach(function(e){
    if(演出か(e)){ 演出で除いた++; if(除いた例.length<10) 除いた例.push(名(e)); return; }
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
  return { 画面:scr.id, class:scr.className, 段階:段階, 主役:主役, 名簿の数:名簿, W:W, H:H, ページの巻き:ページの巻き, 箱の巻き:箱の巻き, 切れ:切れ.slice(0,40), 切れの数:切れ.length, 小さい:小さい.slice(0,40), 小さいの数:小さい.length, 文字の数:文字, 演出で除いた:演出で除いた, 除いた例:除いた例,いちばん大きいボタン:ボタン[0]||null, ボタン:ボタン.slice(0,6) };
})()`;

module.exports = { 測る, 演出の重なり };
