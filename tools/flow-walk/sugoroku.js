// tools/flow-walk/sugoroku.js — すごろくを、部屋（QR参加）で最後まで通す（指示62 第1部）
//
// 遊び方：ゲーム選択で最初に選ばれているもの（設定は何も変えない）。
// 4人（進行役＋人の役＋bot 2）で、既定の盤のまま、駒があがるまで通す。
// 人の役（参加者）と進行役は、**画面に出ているものを押して**遊ぶ：
//   ・ミニゲームの説明の幕 … 1.2秒読んで ✕ でとじる → 「じゅんびOK」
//   ・れんだ … 「れんだ！」を30回（満タン）
//   ・じゃんけん／ゆびのかずあて … ランダムに1つ
//   ・はやおしクイズ … 問題バンクで答えを引いて、正解を押す
//   ・サイコロ … 最初の1回だけ「ふつうの人がまずやる手」＝軽く1回タップを試し、
//                振れなければ長押し（0.7秒）して離す。長押しは CDP の本物のマウス押下で送る
// bot は tools/bot-play/sugograb.js。
//
// **待つ場面は、待っている最中に撮る。**手順を(…, {待ち}) の形だと撮るのが待ち終わったあとになり、
// 物差し(c)（何を待っているかが画面に出ているか）を見られないので、
// 先に1枚撮ってから待ち、待った時間をその手順の記録に書き足す（下の 待ちを撮る）。
//
// **3-2-1 のあと入力が出るまでの時間**を毎回測る（数え終わっても、ほかの誰かが出すまで
// 画面が描き直されないのではないか、という疑い。bots.log の時刻と突き合わせる）。

const fs = require('fs');
const path = require('path');

// ---- 画面から、いまの場面を読む（ページの中で走る） ----
const 状態式 = `(function(){
  var cv = typeof Element.prototype.checkVisibility === 'function';
  function shown(e){ if(!e) return false; var r = e.getBoundingClientRect(); if(r.width < 1 || r.height < 1) return false;
    return cv ? e.checkVisibility({opacityProperty:true, visibilityProperty:true}) : true; }
  function tx(id){ var e = document.getElementById(id); return e && shown(e) ? e.innerText.replace(/\\s+/g,' ').trim() : ''; }
  var scr = (document.querySelector('.screen.active') || {}).id || null;
  var inp = document.getElementById('rtSugoInput');
  // 開いている幕（.is-on）。出始めの透明な間も「開いている」に数える——
  // 幕の後ろの「じゅんびOK」は暗幕にふさがれていて、人には押せないから
  var 幕 = Array.from(document.querySelectorAll('.ui-layer.is-on')).map(function(l){
    var n = l.querySelector('.ui-popup-name, .ui-head'); return n ? n.textContent.trim() : '(名前なし)'; });
  var dice = document.getElementById('rtSugoDice');
  return {
    画面: scr,
    帯: tx('rtSugoLap'), 番: tx('rtSugoTurn'), ことば: tx('rtSugoNote'), 添え: tx('rtSugoHint'),
    入力: inp ? inp.innerText.replace(/\\s+/g,' ').trim().slice(0, 120) : '',
    じゅんび: !!(inp && Array.from(inp.querySelectorAll('[data-rtsugo=ready]')).some(shown)),
    れんだ: shown(document.getElementById('rtSugoInputTapBtn')),
    のこり: tx('rtSugoInputTapLeft'),
    手: !!(inp && Array.from(inp.querySelectorAll('[data-hand]')).some(shown)),
    ゆび: !!(inp && Array.from(inp.querySelectorAll('[data-fingers]')).some(shown)),
    クイズ: !!(inp && Array.from(inp.querySelectorAll('[data-choice]')).some(shown)),
    サイコロ: shown(dice), 転がり中: !!(dice && dice.classList.contains('rolling')),
    幕: 幕,
    数え中: !!document.querySelector('.fx-countdown'),
    盤: shown(document.getElementById('rtSugoBoard')),
    祝い: !!document.querySelector('.fx-cel, .fx-shutter, .fx-blackout'),
    吹き出し: (function(){ var t = document.querySelector('.tut-say'); return !!t && t.getBoundingClientRect().width > 0 && getComputedStyle(t).opacity !== '0'; })()
  };
})()`;
const 状態 = (dev) => dev.ev(状態式);

/** 画面の様子から、いまの場面の名前をつける（サーバーの段階は端末からは読めないので、見えるものから） */
function 段階(st) {
  if (!st) return '?';
  if (st.画面 === 'scr-rt-sugo-result') return 'ended';
  if (st.画面 !== 'scr-rt-sugoroku') return 'other:' + st.画面;
  if (st.数え中) return 'countdown';
  if (st.幕.length) return 'popup';
  if (st.じゅんび) return st.盤 ? 'ready' : 'mini';
  if (st.れんだ) return 'play:tap';
  if (st.手) return 'play:janken';
  if (st.ゆび) return 'play:fingers';
  if (st.クイズ) return 'play:quiz';
  if (st.サイコロ && !st.転がり中) return 'roll';
  return 'watch';
}
const 人がすること = (d) => /^(popup|ready|mini|play:|roll)/.test(d);
/** 参加者の画面の「いまの様子」を1行に（変わったら次の手順） */
const 様子 = (st) => [段階(st), st.帯, st.番, st.ことば, st.添え, st.入力].join('｜');
const 待ちの種類 = (st) => /待って|待ち/.test(st.入力 + st.添え + st.ことば) ? '他の人待ち' : '演出待ち';
const 何を待つか = (st) => (st.入力 || st.添え || st.ことば || st.帯 || '（画面に言葉なし）').slice(0, 60);

/** 先に撮ってから待つ。待った時間は、その手順の記録に書き足す */
async function 待ちを撮る(W, 誰, 何を, 種類, until, o) {
  const rec = await W.手順を(誰, '待つ：' + 何を, '待つ', null, Object.assign({ 間: 120 }, o || {}));
  const t0 = Date.now();
  const r = await until();
  rec.待ちms = Date.now() - t0; rec.待ちの種類 = 種類; rec.待つもの = 何を;
  console.log('      （待った ' + (rec.待ちms / 1000).toFixed(1) + '秒＝' + 種類 + '）');
  return r;
}

/** 参加者か進行役に「すること」が出るか、参加者の画面の様子が変わるまで待つ */
async function 変わるまで(W, 前, ms) {
  const t0 = Date.now();
  for (;;) {
    const sp = await 状態(W.part), sh = await 状態(W.host);
    const dp = 段階(sp), dh = 段階(sh);
    if (人がすること(dp) || 人がすること(dh) || dp === 'countdown' || dp === 'ended' || dh === 'ended' || 様子(sp) !== 前) return { sp, sh };
    if (Date.now() - t0 > (ms || 100000)) throw new Error('参加者の画面が ' + Math.round((ms || 100000) / 1000) + '秒 変わりません：' + 前);
    await W.sleep(150);
  }
}

// ---- 長押し：CDP の本物のマウス押下を、押したまま ms 保つ ----
// tools/cdp.js の端末は sessionId を外に出さないので、同じページにもう1本つなぎ直す
// （共有の道具は変えない約束なので、ここで書く）。ページに目印を置いて、どのページかを見分ける
const 口 = new Map();
async function 生の口(W, dev) {
  const mark = 'fw-' + dev.name + '-' + Math.random().toString(36).slice(2);
  await dev.ev('(window.__fwMark=' + JSON.stringify(mark) + ', true)');
  const 前 = 口.get(dev.name);
  if (前) {
    try { const r = await W._b.send('Runtime.evaluate', { expression: 'window.__fwMark', returnByValue: true }, 前); if (r.result.value === mark) return 前; } catch (e) {}
  }
  const { targetInfos } = await W._b.send('Target.getTargets');
  for (const t of targetInfos.filter((x) => x.type === 'page')) {
    const { sessionId } = await W._b.send('Target.attachToTarget', { targetId: t.targetId, flatten: true });
    const r = await W._b.send('Runtime.evaluate', { expression: 'window.__fwMark', returnByValue: true }, sessionId);
    if (r.result && r.result.value === mark) { 口.set(dev.name, sessionId); return sessionId; }
  }
  throw new Error(dev.name + '：長押しのための口が見つかりません');
}
async function 長押し(W, dev, sel, ms) {
  const sid = await 生の口(W, dev);
  const c = await dev.ev('(function(){var e=document.querySelector(' + JSON.stringify(sel) + ');if(!e)return null;var r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()');
  if (!c) throw new Error(dev.name + '：長押しする所がありません ' + sel);
  await W._b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y }, sid);
  await W._b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', clickCount: 1 }, sid);
  await W.sleep(ms);
  await W._b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', clickCount: 1 }, sid);
}

// ---- bots.log から、bot が出した時刻を読む（3-2-1 のあと入力が出るまでの突き合わせ） ----
function botが出した時刻(W) {
  try {
    return fs.readFileSync(path.join(W.OUT, 'bots.log'), 'utf8').split(/\r?\n/)
      .map((l) => { const m = l.match(/^\[(.+?)\] .*を出した.*t=(\d+)/); return m ? { 誰: m[1], t: +m[2] } : null; })
      .filter(Boolean);
  } catch (e) { return []; }
}

/** はやおしクイズの正解のボタン番号（問題バンクで引く。人の役は正解を押す） */
const 正解式 = "(function(){var q=(document.querySelector('#rtSugoInput .sugo-quiz-q')||{}).textContent||'';var all=[];Object.keys(QuizBank.QUESTIONS).forEach(function(k){all=all.concat(QuizBank.QUESTIONS[k]);});var h=all.find(function(x){return x.q===q;});if(!h)return null;var a=h.choices[h.correct];var b=Array.from(document.querySelectorAll('#rtSugoInput [data-choice]')).find(function(x){return x.textContent===a;});return b?b.dataset.choice:null;})()";

module.exports = {
  way: 'room',
  async run(W) {
    const { host, part, big } = W;
    await W.進行役が部屋をつくる('sugoroku', 'すごろく');
    await W.手順を('進行役', '待合：QRをみんなに見せる', '見せる', null);
    await W.参加者がQRで入る('ひろ');
    await W.大画面が入る();
    await W.botを入れる(2);
    await W.手順を('全員', 'bot 2人が入った（4人そろう）', '待つ', null);

    // ---- 進行役：ゲームをえらぶ ----
    await W.手順を('進行役', '待合：ゲームをえらぶ', '押す', () => W.click(host, '#rtPickGameBtn'),
      { 待ち: { 種類: '演出待ち', 何を: '棚', until: () => W.画面は(host, 'scr-shelf') }, 間: 800 });
    await W.設定を進める({ cassetteId: 'sugoroku', 名: 'すごろく' });
    await W.手順を('進行役', '待合に戻った（ゲームが決まった）', '見る', null);
    W.メモ('ゲーム：' + W.ゲーム + ' ／ モード：' + JSON.stringify(W.モード));
    if (!/sugograb/.test(String(W.ゲーム || '') + JSON.stringify(W.モード || ''))) {
      throw new Error('最初に選ばれていたのが こまはひとつ（sugograb）ではありません：' + W.ゲーム + ' ' + JSON.stringify(W.モード) + '（bot の台本を足す）');
    }

    // ---- 準備OK：参加者 → 進行役 ----
    await W.準備OKまで(part);
    await W.準備OKまで(host);

    // ---- 3-2-1：出ている最中に撮る（1-3：カウントダウン中に吹き出しが出るか） ----
    await W.待つ('参加者', '3-2-1（始まりの合図）', '他の人待ち',
      () => part.until("!!document.querySelector('.fx-countdown')", 20000), { 間: 250 });
    await W.手順を('参加者', '3-2-1の途中', '見る', null, { 間: 700 });
    const cd = await 状態(part);
    W.メモ('カウントダウン中の吹き出し：' + JSON.stringify({ 吹き出し: cd.吹き出し, 数字: cd.数え中 }));
    if (cd.吹き出し && cd.数え中) W.気づいた('困る', 'カウントダウンの数字が出ている最中に、チュートリアルの吹き出しが出ている（1-3 再現）', 'scr-rt-sugoroku');
    await W.待つ('参加者', '盤が出る', '演出待ち',
      () => part.until("!document.querySelector('.fx-countdown') && (document.querySelector('.screen.active')||{}).id==='scr-rt-sugoroku'", 15000), { 間: 600 });

    // ---- 遊ぶ ----
    const 始め = Date.now();
    let ラウンド = 0;
    const 見た = new Set();           // 撮る・撮らないの判定（初めての場面は撮る）
    const 入力までの記録 = [];
    let 軽くタップした = false;
    let 吹き出し数え中 = 0, 数え中を見た = 0;
    const 撮るか = (鍵) => { if (ラウンド <= 3) return true; if (見た.has(鍵)) return false; 見た.add(鍵); return true; };

    for (let i = 0; i < 2000; i++) {
      if (Date.now() - 始め > 20 * 60 * 1000) throw new Error('20分たっても決着しません');
      // 確かめの実験（SUGO_FW_ROUNDS=n）：n回のミニゲームで打ち切る。本番の通しでは使わない
      if (process.env.SUGO_FW_ROUNDS && ラウンド > +process.env.SUGO_FW_ROUNDS) { W.メモ('（実験）' + process.env.SUGO_FW_ROUNDS + '回で打ち切り'); break; }
      const sp = await 状態(part), sh = await 状態(host);
      const dp = 段階(sp), dh = 段階(sh);
      if (dp === 'ended') break;
      if (/^other:/.test(dp)) throw new Error('参加者が すごろくの画面にいません：' + dp);

      // 人の役 → 進行役の順に、すること があれば1つやる
      let 動いた = false;
      for (const [dev, st, d] of [[part, sp, dp], [host, sh, dh]]) {
        if (!人がすること(d)) continue;
        動いた = true;
        if (d === 'popup') {
          const 題 = st.幕[0];
          if (dev === part) ラウンド++;
          const ok = await W.手順を(dev.name, 'ミニゲームの説明「' + 題 + '」が自動で開く → 読んで ✕ でとじる' + (dev === part ? '（' + ラウンド + '回目）' : ''), '読んで押す', async () => {
            await W.sleep(1200);   // 人が読む間
            await W.press(dev, /^✕$/, '.ui-layer button');
          }, { 間: 400, 撮らない: !撮るか(dev.name + ':popup:' + 題) });
          if (!見た.has('幕の注意')) { 見た.add('幕の注意'); W.メモ('ミニゲームのたびに説明の幕が自動で開き、閉じてから「じゅんびOK」を押す（毎回2タップ）'); }
          void ok;
        } else if (d === 'ready') {
          await W.手順を(dev.name, 'すごろくの はじめ：盤を見て「じゅんびOK」', '押す', () => W.click(dev, '#rtSugoInput [data-rtsugo=ready]'), { 間: 500 });
        } else if (d === 'mini') {
          await W.手順を(dev.name, 'ミニゲームの前：「じゅんびOK」', '押す', () => W.click(dev, '#rtSugoInput [data-rtsugo=ready]'), { 間: 400, 撮らない: !撮るか(dev.name + ':mini:' + st.帯 + st.ことば) });
        } else if (d === 'play:tap') {
          let 叩いた = 0;
          const 出た時ののこり = (await 状態(dev)).のこり;
          await W.手順を(dev.name, 'れんだ：「れんだ！」を30回おす', '連打', async () => {
            for (let k = 0; k < 30; k++) {
              if (!(await dev.ev(W.見える('#rtSugoInputTapBtn')))) break;
              await W.click(dev, '#rtSugoInputTapBtn');
              叩いた++;
              await W.sleep(35);
            }
          }, { 間: 400, 撮らない: !撮るか(dev.name + ':tap') });
          W.メモ('れんだのボタンが出た時の のこり時間：「' + 出た時ののこり + '」（持ち時間は6秒）。叩けたのは ' + 叩いた + '回');
        } else if (d === 'play:janken') {
          const 手 = ['g', 'c', 'p'][Math.floor(Math.random() * 3)];
          await W.手順を(dev.name, 'じゃんけん：' + { g: 'グー', c: 'チョキ', p: 'パー' }[手] + 'をおす', '押す', async () => {
            await W.sleep(700);
            await W.click(dev, '#rtSugoInput [data-hand="' + 手 + '"]');
          }, { 間: 400, 撮らない: !撮るか(dev.name + ':janken') });
        } else if (d === 'play:fingers') {
          const n = Math.floor(Math.random() * 6);
          await W.手順を(dev.name, 'ゆびのかずあて：' + n + '本をおす', '押す', async () => {
            await W.sleep(900);
            await W.click(dev, '#rtSugoInput [data-fingers="' + n + '"]');
          }, { 間: 400, 撮らない: !撮るか(dev.name + ':fingers') });
        } else if (d === 'play:quiz') {
          await W.手順を(dev.name, 'はやおしクイズ：問題を読んで正解をおす', '読んで押す', async () => {
            await W.sleep(1500);
            const i2 = await dev.ev(正解式);
            await W.click(dev, '#rtSugoInput [data-choice="' + (i2 == null ? 0 : i2) + '"]');
          }, { 間: 400, 撮らない: !撮るか(dev.name + ':quiz') });
        } else if (d === 'roll') {
          if (!軽くタップした) {
            軽くタップした = true;
            // タップがサイコロに届いたことを、その場で数える（届いていないのに「振れない」と書かない）
            await dev.ev("(function(){var d=document.getElementById('rtSugoDice');window.__fwTap=[];['pointerdown','pointerup'].forEach(function(t){d.addEventListener(t,function(e){window.__fwTap.push(t+'@'+Math.round(performance.now()));},{once:true});});return true;})()");
            const 前の添え = (await 状態(dev)).添え;
            const rec = await W.手順を(dev.name, 'ミニゲームに勝った：サイコロを軽く1回タップ（ふつうの人がまずやる手）', '押す', async () => {
              await W.tap(dev, '#rtSugoDice');
              await W.sleep(900);
            }, { 間: 0 });
            const 後 = await 状態(dev);
            const 届いた = await dev.ev('window.__fwTap||[]');
            const 振れた = 段階(後) !== 'roll' || 後.転がり中;
            W.メモ('軽く1回タップ → ' + (振れた ? '振れた' : '振れない') + '。サイコロに届いたイベント：' + JSON.stringify(届いた) +
              '。添え書き：前「' + 前の添え + '」→ 後「' + 後.添え + '」');
            if (!振れた && 届いた.length >= 2) W.気づいた('困る', 'サイコロは軽く1回タップしても振れない（0.5秒以上の長押しかスワイプが要る）。タップは届いている（' + 届いた.join(' ') + '）。添え書きは「' + 後.添え + '」のまま変わらず、何が足りなかったかは出ない', 'scr-rt-sugoroku #rtSugoDice');
            void rec;
            if (振れた) continue;
          }
          const rec2 = await W.手順を(dev.name, 'サイコロを長押し（0.7秒）して離す', '長押し', async () => {
            await 長押し(W, dev, '#rtSugoDice', 700);
          }, { 間: 300, 撮らない: !撮るか(dev.name + ':roll') });
          rec2.押す回数 += 1;   // 長押しは W.tap を通らないので、ここで数える
        }
        break;   // 1つやったら、画面を読み直す
      }
      if (動いた) continue;

      // ---- 3-2-1（ミニゲームの始まり）。数えている最中に撮り、そのあと入力が出るまでを測る ----
      if (dp === 'countdown') {
        数え中を見た++;
        if (sp.吹き出し) 吹き出し数え中++;
        await 待ちを撮る(W, '参加者', 'ミニゲームの3-2-1', '演出待ち',
          () => part.until("!document.querySelector('.fx-countdown')", 15000), { 撮らない: !撮るか('countdown') });
        const t終わり = Date.now();
        // 数え終わってから、押すものが出るまで（参加者の画面）
        let 出た = null, 見えた字 = '', 撮った = null;
        for (;;) {
          const s2 = await 状態(part);
          if (/^play:/.test(段階(s2))) { 出た = Date.now(); break; }
          if (!見えた字) 見えた字 = s2.入力;
          // 数え終わって0.6秒たっても出ていなければ、その画面を1枚撮る（最初の2回だけ）
          if (!撮った && ラウンド <= 2 && Date.now() - t終わり > 600 && 段階(s2) === 'watch') {
            撮った = await W.手順を('参加者', '3-2-1 が終わった：押すものがまだ出ていない（「' + s2.入力 + '」）', '見る', null, { 間: 0 });
            continue;
          }
          if (段階(s2) !== 'watch' && 段階(s2) !== 'countdown') break;
          if (Date.now() - t終わり > 30000) break;
          await W.sleep(50);
        }
        // 数え終わり（＝サーバーの startAt）より前に出されたもの（あいこのやり直しの前の回）は数えない
        const bots = botが出した時刻(W).filter((b) => b.t >= t終わり - 500);
        const 最初のbot = bots.length ? Math.min.apply(null, bots.map((b) => b.t)) : null;
        const 記録 = { ラウンド, 数え終わりから入力まで_ms: 出た ? 出た - t終わり : null, その間の字: 見えた字,
          botが最初に出したのは_ms: 最初のbot ? 最初のbot - t終わり : null };
        入力までの記録.push(記録);
        // この待ちも手順の記録に残す（撮らなかった回は、撮らずに1手順として数える）。
        // 押すものが出ないのは、ほかの誰かが出して部屋の知らせが届くまで——なので「他の人待ち」に入れる
        if (!撮った) 撮った = await W.手順を('参加者', '3-2-1 が終わった：押すものが出るのを待った（「' + 見えた字 + '」）', '見る', null, { 間: 0, 撮らない: true });
        撮った.する = '待つ';
        撮った.待ちms = (出た || Date.now()) - t終わり; 撮った.待ちの種類 = '他の人待ち';
        撮った.待つもの = '3-2-1のあと、押すもの（答え・手・れんだ）が出るまで（「' + 見えた字 + '」のまま）';
        W.メモ('3-2-1 のあと入力が出るまで：' + JSON.stringify(記録));
        console.log('      3-2-1 → 入力：' + JSON.stringify(記録));
        continue;
      }

      // ---- 待つ（他の人の番・駒が動く・できごと）。待っている最中を撮る ----
      const 前 = 様子(sp);
      const 鍵 = 'wait:' + sp.ことば.replace(/[0-9+]/g, '') + ':' + sp.入力.replace(/[0-9]/g, '');
      await 待ちを撮る(W, '参加者', 何を待つか(sp), 待ちの種類(sp), () => 変わるまで(W, 前, 100000), { 撮らない: !撮るか(鍵) });
    }
    W.終わり方を('遊んだ', { ラウンド, かかった秒: Math.round((Date.now() - 始め) / 1000), '3-2-1→入力': 入力までの記録,
      ミニゲームの3_2_1を見た回数: 数え中を見た, そのうち吹き出しが出ていた: 吹き出し数え中 });
    const 出ない = 入力までの記録.filter((r) => r.数え終わりから入力まで_ms == null);
    if (出ない.length) W.気づいた('遊べなくなる', 'ミニゲームの3-2-1が終わっても、押すもの（れんだ・手・答え）が最後まで出なかった：' + 出ない.length + '/' + 入力までの記録.length + '回（「' + 出ない[0].その間の字 + '」のまま締め切り）', 'scr-rt-sugoroku #rtSugoInput（3-2-1 のあと）');
    if (process.env.SUGO_FW_ROUNDS) return;
    const 遅い = 入力までの記録.filter((r) => r.数え終わりから入力まで_ms != null && r.数え終わりから入力まで_ms > 1000);
    const 揃う = 遅い.filter((r) => r.botが最初に出したのは_ms != null && Math.abs(r.数え終わりから入力まで_ms - r.botが最初に出したのは_ms) < 600);
    if (遅い.length) {
      W.気づいた(揃う.length === 遅い.length ? '遊べなくなる' : '困る',
        'ミニゲームの3-2-1が終わっても、押すもの（れんだ・手・答え）がすぐに出ない：' + 遅い.length + '/' + 入力までの記録.length + '回。' +
        '出たのは平均' + Math.round(遅い.reduce((a, r) => a + r.数え終わりから入力まで_ms, 0) / 遅い.length) + 'ms後で、' +
        揃う.length + '回は bot が最初に出した時刻（±0.6秒）と一致——誰かが出して部屋の知らせが届くまで描き直されていない疑い。' +
        '全員が人の部屋だと、誰も押せないまま締め切りまで進む', 'scr-rt-sugoroku #rtSugoInput（3-2-1 のあと）');
    }

    // ---- 決着 ----
    await W.手順を('参加者', '決着：結果発表の画面に切り替わった瞬間', '見る', null, { 間: 200 });
    const 決 = await 状態(part);
    W.メモ('参加者の画面の祝い：' + (決.祝い ? 'あり' : 'なし'));
    await W.待つ('参加者', '結果（演出が終わる）', '演出待ち',
      () => part.until("!document.querySelector('.fx-cel,.fx-shutter,.fx-blackout') && (document.querySelector('.screen.active')||{}).id==='scr-rt-sugo-result'", 20000), { 間: 900 });
    await W.待つ('進行役', '結果（演出が終わる）', '演出待ち',
      () => host.until("!document.querySelector('.fx-cel,.fx-shutter,.fx-blackout') && (document.querySelector('.screen.active')||{}).id==='scr-rt-sugo-result'", 20000), { 間: 900 });
    const 称号 = await part.ev("!!document.querySelector('#titleGotOverlay.show')");
    if (称号) W.メモ('参加者に称号の幕が出ている');

    // ---- 終わり方：ボタン・放置・行き先・もう1回 ----
    await W.結果のあと({
      async 試す() {
        // 称号の幕が出ていたら、幕のボタンも行き先を見る
        for (const dev of [part, host]) {
          if (await W.ボタンあり(dev, /^あとで/)) await W.ボタンを試す(dev, /^あとで/, { 名: '称号の幕：あとで' });
        }
        // 🎁（感謝）は結果に出ていれば押してみる（出たものは閉じて戻る）
        for (const dev of [part, host]) {
          if (await W.ボタンあり(dev, /🎁/)) await W.ボタンを試す(dev, /🎁/, { 名: '🎁', 戻す: (d) => W.pressIf(d, /^(とじる|✕|もどる|閉じる|キャンセル)$/) });
        }
        // 参加者の「つぎは？」は押せない（進行役が えらんでいます…）。押せるかだけ試す
        if (await W.ボタンあり(part, /つぎ/)) await W.ボタンを試す(part, /つぎ/, { 名: '参加者：つぎは？（押せる時だけ）' });
        // 右上の ⚙ と 👥（結果の画面にも出ている）。開いたものは ✕ でとじて戻る
        const バツでとじる = async (d) => { if (!(await W.pressIf(d, /^✕$/, '.overlay.show button, .ui-layer button'))) await W.pressIf(d, /^(とじる|もどる|閉じる)$/); };
        for (const dev of [part, host]) {
          if (await W.ボタンあり(dev, /^⚙$/)) await W.ボタンを試す(dev, /^⚙$/, { 名: '⚙（設定）', 戻す: バツでとじる });
        }
        if (await W.ボタンあり(part, /^👥$/)) await W.ボタンを試す(part, /^👥$/, { 名: '👥（みんなの状況）', 戻す: バツでとじる });
        // 大画面のいちばん大きいボタン「🙋 プレイヤーにもどる」。押したら、⚙ → 部屋 → この画面を大画面にする で戻す
        if (await W.ボタンあり(big, /プレイヤーにもどる/)) {
          const r = await W.ボタンを試す(big, /プレイヤーにもどる/, { 名: '大画面：🙋 プレイヤーにもどる' });
          W.メモ('押したあと大画面の端末は ' + (await big.screen()));
          if (!r.確認あり && (await big.screen()) !== 'scr-rt-big') {
            await W.手順を('大画面', '大画面にもどす：⚙ → 部屋 → この画面を大画面にする', '押す', async () => {
              await W.click(big, '#gearBtn'); await W.sleep(500);
              await W.click(big, '#settingsOverlay [data-setpage="room"]'); await W.sleep(500);
              await W.click(big, '#settingsOverlay [data-setact="toBig"]');
            }, { 待ち: { 種類: '通信待ち', 何を: '大画面', until: () => W.画面は(big, 'scr-rt-big', 8000) }, 間: 900 });
          }
        }
        await W.ボタンを試す(host, /部屋をとじる/, { 名: '部屋をとじる（確認が出たら やめる）' });
        // 出る系は最後に。確認なしで出てしまったら、QRを読み直して戻る（その道も手順に残す）
        const 出た = await W.ボタンを試す(part, /部屋を出る/, { 名: '部屋を出る（確認が出たら やめる）' });
        if (!出た.確認あり) await W.参加者が戻る();
        if (await W.ボタンあり(big, /部屋を出る|出る/)) {
          const 大出た = await W.ボタンを試す(big, /部屋を出る|出る/, { 名: '大画面：部屋を出る（確認が出たら やめる）' });
          if (!大出た.確認あり) await W.大画面が戻る();
        } else {
          W.終わり方を('大画面のボタン', '結果の大画面に押せるボタンは無い（' + JSON.stringify(await W.ボタン一覧(big)) + '）');
        }
        // 進行役の「← 部屋を出る」は押さない：参加者のものと同じ処理（[id$="LeaveBtn"] → rtLeaveRoom、確認なし）なので、
        // 押すと進行役が部屋から出て「もう一回」の道が試せなくなる
        W.終わり方を('進行役の部屋を出るは押していない', '参加者と同じ [id$="LeaveBtn"] → rtLeaveRoom（確認なし）。押すと進行役が抜けて、もう一回を試せない');
      },
      async もう一回() {
        await W.手順を('進行役', '結果：つぎは？', '押す', () => W.click(host, '#rtSugoAgainBtn'),
          { 待ち: { 種類: '演出待ち', 何を: 'つぎは？の画面', until: () => W.画面は(host, 'scr-next') }, 間: 700 });
        W.終わり方を('つぎは？の選択肢', await W.ボタン一覧(host));
        await W.手順を('進行役', 'つぎは？：もう一度（さっきと同じ設定でそのまま）', '押す', () => W.press(host, /^もう一度/), { 間: 1200 });
        await W.準備OKまで(part);
        await W.準備OKまで(host);
        await W.待つ('参加者', '2回目の3-2-1', '他の人待ち', () => part.until("!!document.querySelector('.fx-countdown') || !!document.querySelector('#rtSugoInput [data-rtsugo=ready]')", 20000), { 間: 400 });
        const 二回目 = await 状態(part);
        W.メモ('撮った時：3-2-1 ' + (二回目.数え中 ? 'が出ている' : 'は出ていない') + '／画面 ' + 二回目.画面 + '／吹き出し ' + (二回目.吹き出し ? 'あり' : 'なし'));
      }
    });
  }
};
