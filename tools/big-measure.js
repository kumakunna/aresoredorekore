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
//   読めない … 名前が省略で3字（3字より短い名前は全部）より少なくしか見えていない（✖ に数える・指示64の監査）
//   重なり … 入場の知らせが QR・準備OKの数に重なる（切れに入れて ✖ に数える）
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
//
// ほかに2つの式を置く（どちらも2本の道具が読む。写さない・落とし穴1）：
//   走る演出() … 終わりのある動き（演出）のうち、いま走っているもの。**BGMの拍（縁の脈）は除く**
//   形の式     … 大画面の「形」。big-census.js がいつ測るかを決める鍵（版組みは1つも読まない）

const fs = require('fs');
const path = require('path');

/**
 * 数字の段（正本 §11-5「数字（得点・時計・残り・ライフ）は48」）を名乗る要素。**ここに入る要素だけ下限を 48 にする**。
 * 数字の入った字をなんでも 48 で測ると、名前（kensho34）や問題文の中の数字まで拾って、直せない赤が立つ
 * （指示64の見直しの反証）。役割で数える。数字の段を足したら、ここにも足す
 */
const 数字の段 = ['.tv-n', '.rk-n', '.bl-v:not(.is-word):not(.is-icons)', '.br-num', '.br-of', '.bs-clock',
  '.bft-case', '.bk-v', '.sh-tier-count', '.bb-meta'];

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
  var 数字の段=${JSON.stringify(数字の段.join(','))};
  // 省略（…）で切れた名前。**切れには数えない**（箱の中で自分で省略している）が、
  // 名前が読めない場面を数えるために出す（指示64の見直し：切れ 0 なのに「こう…」が並んでいた）
  var 省略=[], 薄め=[];
  // 見えている字の数：箱の右端から「…」の幅（1字ぶん）を引いた所より左に収まっている字。
  // 「省略した」だけでは「たかは…」と「た…」が同じ1件になる——1字まで縮んだ名前は、4m 先から誰か分からない
  //（指示64の監査：進化じゃんけん12人の結果で、2字の「ひろ」まで「ひ」になっていた）
  function 見える字(e){
    var r=e.getBoundingClientRect(), cs=getComputedStyle(e);
    var 右 = r.left + e.clientLeft + e.clientWidth - parseFloat(cs.paddingRight) - parseFloat(cs.fontSize)*0.9;
    var tw=document.createTreeWalker(e, NodeFilter.SHOW_TEXT), n, 全=0, 見=0, 字='', rg=document.createRange();
    while((n=tw.nextNode())){ var s=n.nodeValue; for(var i=0;i<s.length;i++){ if(/\\s/.test(s[i])) continue; 全++; 字+=s[i]; rg.setStart(n,i); rg.setEnd(n,i+1); var rr=rg.getBoundingClientRect(); if(rr.width>0 && rr.right<=右+0.5) 見++; } }
    return {名:字.slice(0,14), 見:見, 全:全};
  }
  // 読めない名前：**3字（3字より短い名前は全部）が見えていない**もの。✖ に数える（指示64の監査）。
  //   3字にしたのは、長い名前の「たかは…」「あいう…」は4m先でも誰か分かり、「た…」「ひ」は分からないから。
  //   4字より短い名前は、省略記号（1字ぶん）の幅で全部が入るので、実際には切れずに出る
  var 読めない=[];
  scr.querySelectorAll('.bl-name, .blc-name, .rk-name, .be-name').forEach(function(e){
    if(!見える(e) || 演出か(e)) return;
    if(e.scrollWidth > e.clientWidth + 1){ var v=見える字(e); v.何=名(e); 省略.push(v); if(v.見 < Math.min(v.全, 3)) 読めない.push(v); }
  });
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
      // 薄め：先祖ぜんぶの opacity を掛けた値が1未満の字（§11-9「opacity で薄めない」。薄くするのは色で）
      var 不透明 = 1; for(var q=e; q && q!==document.body; q=q.parentElement){ 不透明 *= +getComputedStyle(q).opacity; }
      if(不透明 < 0.99) 薄め.push({何:名(e), 文字:t, opacity:Math.round(不透明*100)/100});
      var px=parseFloat(getComputedStyle(e).fontSize);
      var 下限 = (e.matches && e.matches(数字の段)) ? 48 : 28;
      if(px < 下限*倍 - 0.5) 小さい.push({何:名(e), 文字:t, px:Math.round(px), 下限:Math.round(下限*倍)});
    }
  });
  // 重なり：入場の知らせは QR と「準備OKの数」に重ならない（E1）。切れと同じく ✖ に数える
  //（指示64の見直しで、知らせが2行に伸びて QR を覆ったのに、切れ 0 のまま通っていた）
  var 守る = Array.prototype.filter.call(scr.querySelectorAll('#bigQr svg, #bigReady .br-num, #bigReady .br-of'), 見える);
  Array.prototype.filter.call(scr.querySelectorAll('.be-item'), 見える).forEach(function(b){
    var r1 = b.getBoundingClientRect();
    守る.forEach(function(g){
      var r2 = g.getBoundingClientRect();
      if(r1.left < r2.right - 1 && r2.left < r1.right - 1 && r1.top < r2.bottom - 1 && r2.top < r1.bottom - 1)
        切れ.push({何:'重なり：' + 名(b) + ' が ' + 名(g) + ' に', 文字:(b.innerText||'').trim().slice(0,20)});
    });
  });
  var ボタン = Array.prototype.filter.call(scr.querySelectorAll('button, .btn'), 見える).map(function(b){var r=b.getBoundingClientRect(); var cs=getComputedStyle(b); return {文字:(b.innerText||'').trim().replace(/\\s+/g,' ').slice(0,24), 面積:Math.round(r.width*r.height), 色:cs.backgroundColor, 字:Math.round(parseFloat(cs.fontSize))};}).sort(function(a,b){return b.面積-a.面積;});
  var 段階=((document.getElementById('bigPhase')||{}).textContent||'').trim();
  var 主役=((document.getElementById('bigMain')||{}).textContent||'').trim().slice(0,30);
  var 名簿=document.querySelectorAll('#scr-rt-big .bl-item, #scr-rt-big .bl-card, #scr-rt-big .rk-row').length;
  return { 画面:scr.id, class:scr.className, 段階:段階, 主役:主役, 名簿の数:名簿, W:W, H:H, ページの巻き:ページの巻き, 箱の巻き:箱の巻き, 切れ:切れ.slice(0,40), 切れの数:切れ.length, 小さい:小さい.slice(0,40), 小さいの数:小さい.length, 省略:省略.slice(0,20), 省略の数:省略.length, 読めない:読めない.slice(0,20), 読めないの数:読めない.length, 薄め:薄め.slice(0,20), 薄めの数:薄め.length, 文字の数:文字, 演出で除いた:演出で除いた, 除いた例:除いた例,いちばん大きいボタン:ボタン[0]||null, ボタン:ボタン.slice(0,6) };
})()`;

// ======================= 走っている演出（BGMの拍を除く） =======================
// 「落ち着いたか」は、終わりのある動き（演出）が1つも走っていないことで見る（big-lab.js の 落ち着いた・big-census.js の 動き中）。
// ところが BGM が鳴っている間、大画面は 0.46秒ごとに縁を脈打たせる（index.html の bgmBeat）——
// #scr-rt-big の class から bgm-beat を外して付け直し、0.9秒の ::before のアニメーションを始め直す。
// 0.9秒の動きが 0.46秒ごとに始め直されるので、**終わりのある動きが一度も0にならない**。
// オークションの競りの最中、実験台は毎回「落ち着かず」のまま6秒待って測っていた（指示64）。
// 縁の脈は版組みを動かさない（position:fixed・pointer-events:none の影だけ）ので、待つ理由にならない。除く。
//
// 拍の名前は index.html の規則から**その場で読む**（写さない）。見つからなければ止める——
// 名前が変わったのに古い名前で除くと、黙って元の「落ち着かない」に戻る（落とし穴10-e）
let 拍の名 = null;
function BGMの拍の名() {
  if (拍の名) return 拍の名;
  const file = path.join(__dirname, '..', 'public', 'index.html');
  const src = fs.readFileSync(file, 'utf8');
  const m = /#scr-rt-big\.bgm-beat::before\s*\{[^}]*?\banimation(?:-name)?\s*:\s*([A-Za-z_][\w-]*)/.exec(src);
  if (!m) {
    throw new Error('public/index.html に「#scr-rt-big.bgm-beat::before{ … animation:名前 … }」が見つかりません。' +
      'BGMの拍（縁の脈）の書き方が変わった？　拍の名が分からないまま測ると、拍を演出と取り違えて' +
      'ずっと「落ち着かない」と読む。tools/big-measure.js の BGMの拍の名 を直してください（落とし穴10-e）');
  }
  if (src.indexOf('@keyframes ' + m[1]) === -1) {
    throw new Error('public/index.html の BGMの拍の規則は animation:' + m[1] + ' だが、@keyframes ' + m[1] + ' が見つかりません（読み方がずれた？）');
  }
  return (拍の名 = m[1]);
}
/** ページの中の関数の式：そのアニメーションが大画面の BGM の拍か（自己検査も同じこれで数える） */
function 拍か() {
  return `function(a){ return a.animationName===${JSON.stringify(BGMの拍の名())} && !!a.effect && !!a.effect.target && a.effect.target.id==='scr-rt-big'; }`;
}
/** ページの中で評価すると、走っている終わりのある動き（Animation の配列）を返す式。BGM の拍は除く */
function 走る演出() {
  return `(function(){ var 拍か=${拍か()};
    return document.getAnimations().filter(function(a){
      if(a.playState!=='running' || 拍か(a)) return false;
      var t=a.effect&&a.effect.getComputedTiming&&a.effect.getComputedTiming();
      return !!t && isFinite(t.endTime);
    }); })()`;
}
/** 同じものの名前（記録に「なぜ落ち着かなかったか」を残すため） */
function 走る演出の名() {
  return `(${走る演出()}).map(function(a){ var t=a.effect&&a.effect.target; ` +
    `return (a.animationName||a.id||'(名なし)') + (t ? '@' + (t.id ? '#'+t.id : (typeof t.className==='string' && t.className ? '.'+t.className.trim().split(/\\s+/)[0] : t.tagName||'')) : '') + (a.effect&&a.effect.pseudoElement ? a.effect.pseudoElement : ''); }).slice(0, 8)`;
}
/** いま走っている BGM の拍の数（自己検査：除く相手が本当にいるか・落とし穴10-b） */
function 拍の数() {
  return `(function(){ var 拍か=${拍か()}; return document.getAnimations().filter(function(a){ return a.playState==='running' && 拍か(a); }).length; })()`;
}

// ======================= 大画面の形（big-census.js の鍵） =======================
// big-census.js は、大画面の「形」が変わった時に測る。前は 画面|class|段階|主役|名簿の数 を鍵にしていて、
//   ・クイズの遊ぶ間と決着が同じ鍵になり、結果の画面を一度も測っていなかった（段階の札も主役も空になるため）
//   ・待合A（ゲーム未選択）と待合B（選んだあと）が同じ鍵だった
//   ・協力版の爆弾は主役の字が刻むたびに鍵が変わり、同じ形を何十回も測っていた
// **版組みは1つも読まない**（getBoundingClientRect を呼ばない・見えるかは hidden と display だけ）。
// 窓の大きさで変わるもの——--bl-cols・--lb-cols・data-podnote・data-tight・一枚看板が添え書きの頭へ移ったか
// （bigFitMain）——も入れない。入れると 1920 で測って 1280 に戻した時に形が変わり、同じ状態を測り直す。
//   ※ data-shape（表彰台 c2／2列 c1）は、入らない時に bigFitRank が c1 に描き直すので大きさで変わりうる。
//     census は 1280×720 で見回るので、見回りの形はそろう（1920 で測った形が違えば 形1920 に残す）
// 返す形：{ 形, 細部, 待ち }。細部は形の鍵に入れない（同じ形の中で字が変わったら、上限まで測り直す）。
// 待ち は名簿・順位表の測り直し（bigReflowSoon）の途中——列や c1/c2 がまだ決まっていない
const 形の式 = `(function(){
  var scr=document.querySelector('.screen.active'); if(!scr) return null;
  var big=document.getElementById('scr-rt-big');
  var 待ち=!!window.__bigReflowPending;
  if(!big || scr!==big) return { 形:{ 画面:scr.id }, 細部:'', 待ち:待ち };
  function 字(e){ return e ? String(e.textContent||'').replace(/\\s+/g,' ').trim() : ''; }
  function 段(s){ var n=Array.from(s).length; return n===0?0 : n<=6?6 : n<=12?12 : n<=24?24 : 99; }
  function 出る(e){ if(!e) return false; for(var p=e; p && p!==document.body; p=p.parentElement){ if(p.hidden || getComputedStyle(p).display==='none') return false; if(p===big) break; } return true; }
  function 子あり(id){ var e=document.getElementById(id); return !!e && e.children.length>0 && 出る(e); }
  function 印(k){ return big.getAttribute(k)||''; }
  var main=document.getElementById('bigMain'), sub=document.getElementById('bigSub');
  // 一枚看板の字は、#bigMain にあっても添え書きの頭（.big-lead）に移っても同じに数える（どこにあるかは窓の大きさで変わる）
  var 頭=sub ? Array.prototype.map.call(sub.querySelectorAll('.big-lead'), 字).join(' ') : '';
  var 主=(字(main)+' '+頭).trim();
  // 添え書き：#bigSub から頭（.big-lead）を除いた字。はみ出しを決めるのは添え書きの長さ
  var 添え='';
  if(sub){ var c=sub.cloneNode(true); Array.prototype.forEach.call(c.querySelectorAll('.big-lead'), function(x){ x.remove(); }); 添え=字(c); }
  var 主の形 = (main && main.querySelector('.bomb-coop')) ? 'coop'
    : document.querySelector('#bigMain .tv-vs, #bigSub .big-lead .tv-vs') ? 'vs' : 段(主);
  var tv=document.querySelector('#bigRank > .rk-tv');
  var 順位=tv ? ['data-shape','data-pod','data-cols','data-note','data-main'].map(function(k){ return tv.getAttribute(k)||''; }).join('/') : '';
  var 出ている=['bigQrBox','bigRules','bigBoard','bigSugoBoard','bigAuMarket','bigFtCases'].filter(function(id){ return 出る(document.getElementById(id)); })
    .concat(['bigRank','bigList'].filter(子あり));
  var 形={
    画面:big.id, big:印('data-big'), phase:印('data-phase'), game:印('data-game'), size:印('data-size'),
    段階:字(document.getElementById('bigPhase')),
    名簿:big.querySelectorAll('.bl-item, .bl-card, .rk-row, .bcb-row').length,
    順位:順位, 出ている:出ている.join(','), 主:主の形, 添え:段(添え),
    入場:!!big.querySelector('#bigEntry .be-item'),
    手番:!!字(document.getElementById('bigTurn'))
  };
  var 細部=主.slice(0,40)+'|'+字(document.getElementById('bigReady'));
  return { 形:形, 細部:細部, 待ち:待ち };
})()`;

module.exports = { 測る, 演出の重なり, 数字の段, 走る演出, 走る演出の名, 拍の数, BGMの拍の名, 形の式 };
