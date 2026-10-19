// tools/flow-walk/shinka.js — 進化じゃんけんを、部屋（QR参加）で最後まで通す（指示62 第1部）
//
// 遊び方：棚で最初に選ばれている「進化じゃんけん」（ゲームもモードも1つずつ。設定は何も変えない＝
// はしご「ふつう」5段・手を出すまで3秒・おわりまで10分）。
// 人の役（参加者）と進行役は、**画面の グー／チョキ／パー を本物のタップで押す**（どれを出すかは乱数。
// ふつうの人は手を読まないので、乱数で十分）。少し考える間（0.3〜0.8秒）を置いてから押す。
// bot 2人は tools/room-bots.js の中の shinka の分（手を出す段階になったら、すぐ乱数で1つ出す）。
//
// 段階は 組みあわせ（1.8秒）→ 手を出す（3秒）→ けっか（2.2秒）→ …。
// **最初の3回は全部撮る。そのあとは数だけ残す**（撮らない:true）。
// 段階の見分けは大画面の #bigPhase（秘密に依らないので、いちばん確か）と、手元の #shPlayTitle。
//
// 終わり方：結果のボタンを全部試す（⚙・👥・🎁・称号の幕・部屋をとじる・プレイヤーにもどる・部屋を出る）。
// **進行役の「← 部屋を出る」だけは、もう1回の道（つぎは？→もう一度）を壊すので最後に回す**——
// 2回目の試合を最後まで遊び、その結果の画面で押して、行き先と残った人の画面を撮る。

const 状態式 = "(function(){" +
  "var cv=typeof Element.prototype.checkVisibility==='function';" +
  "function vis(e){if(!e)return false;var r=e.getBoundingClientRect();return r.width>0&&r.height>0&&(!cv||e.checkVisibility({opacityProperty:true,visibilityProperty:true}));}" +
  "var s=(document.querySelector('.screen.active')||{}).id||null;" +
  "var hb=Array.prototype.slice.call(document.querySelectorAll('#shPlayHands [data-sh-hand]'));" +
  "var nl=Array.prototype.filter.call(document.querySelectorAll('.now-line'),vis).map(function(x){return x.innerText.trim();}).join(' ');" +
  "var on=hb.filter(function(b){return b.classList.contains('on');})[0];" +
  "return {画面:s," +
  " 題:(document.getElementById('shPlayTitle')||{}).textContent||''," +
  " 手ボタン:hb.length, 押せる:hb.filter(function(b){return !b.disabled;}).length, 出した:on?on.dataset.shHand:null," +
  " note:s==='scr-rt-sh-play'?(document.getElementById('shPlayNote')||{}).textContent:(s==='scr-rt-sh-match'?(document.getElementById('shMatchNote')||{}).textContent:'')," +
  " vs:((document.querySelector('.screen.active .sh-vs')||{}).innerText||'').replace(/\\s+/g,' ').trim()," +
  " 段:((document.querySelector('.screen.active .sh-me')||{}).innerText||'').replace(/\\s+/g,' ').trim()," +
  " 帯:nl, 大段階:(document.getElementById('bigPhase')||{}).textContent||''," +
  " 数字:!!document.querySelector('.fx-countdown'), 祝い:!!document.querySelector('.fx-cel'), 幕:!!document.querySelector('.fx-blackout,.fx-shutter')};" +
  "})()";

const 手の名 = { g: 'グー', c: 'チョキ', p: 'パー' };
/** 通し全体で1回だけ気づきに書くもの（2試合目は数だけ残す） */
const 書いた = {};

/** 大画面の段階ラベル（RT_PHASE_LABEL：組みあわせ／手を出す／けっか）。結果なら '結果' */
async function 段階(big) {
  const s = await big.ev(状態式);
  if (s.画面 === 'scr-rt-sh-result') return '結果';
  // 大画面は scr-rt-big の中で #bigPhase を書き換える。決着は「決着」などになる
  return s.大段階 || '';
}

/**
 * 手を出す（人の役／進行役）。押せるボタンが出るまで待ち、少し考えてから本物のタップで押す。
 * 押せない（おやすみ・自分の組は決着ずみ）なら、その時の画面の言葉を返す
 */
async function 手を出す(W, dev, 締め) {
  const t0 = Date.now();
  let 数字の上 = false;
  for (;;) {
    const s = await dev.ev(状態式);
    if (s.画面 === 'scr-rt-sh-play' && s.押せる === 3) { 数字の上 = s.数字; break; }
    if (s.画面 === 'scr-rt-sh-play' && s.題 === '手を出す' && s.手ボタン === 0 && Date.now() - t0 > 700) return { 出せない: true, s };
    if (s.画面 === 'scr-rt-sh-play' && s.出した) return { 出せない: true, s, もう出した: true };
    if (s.画面 !== 'scr-rt-sh-play' && Date.now() - t0 > 400 && s.画面 !== 'scr-rt-sh-match') return { 出せない: true, s, 間に合わない: true };
    if (s.画面 === 'scr-rt-sh-play' && s.題 === 'けっか' && Date.now() - t0 > 900) return { 出せない: true, s, 間に合わない: true };
    if (Date.now() - t0 > (締め || 4000)) return { 出せない: true, s, 間に合わない: true };
    await W.sleep(60);
  }
  await W.sleep(300 + Math.floor(Math.random() * 500));   // 人が3つを見比べる間
  const h = ['g', 'c', 'p'][Math.floor(Math.random() * 3)];
  const ok = await dev.ev("(function(){var b=document.querySelector('#shPlayHands [data-sh-hand=\"" + h + "\"]');return !!b&&!b.disabled;})()");
  if (!ok) return { 出せない: true, s: await dev.ev(状態式), 間に合わない: true };
  const まだ数字 = await dev.ev("!!document.querySelector('.fx-countdown')");
  await W.tap(dev, '#shPlayHands [data-sh-hand="' + h + '"]');
  // 押したことがサーバーに届いたか（ボタンが「on」になる）
  const 届いた = await dev.until("!!document.querySelector('#shPlayHands [data-sh-hand].on')", 1500).then(() => true, () => false);
  return { 手: h, 数字の上, まだ数字, 届いた };
}

/** 開いている重なり（設定・みんなの状況・ありがとう・確認の幕）を ✕ / とじる で閉じる */
async function 重なりを閉じる(W, dev) {
  for (let i = 0; i < 3; i++) {
    const r = await dev.ev("(function(){" +
      "function vis(e){var r=e.getBoundingClientRect();return r.width>0&&r.height>0;}" +
      "var l=Array.prototype.filter.call(document.querySelectorAll('.ui-layer'),vis).pop();" +
      "if(l){var c=l.querySelector('[data-ui=close],[data-ui=cancel]')||Array.prototype.filter.call(l.querySelectorAll('button'),function(b){return /^(とじる|✕|やめる|キャンセル|もどる|あとで)/.test(b.innerText.trim());})[0];if(c){c.click();return 'layer';}}" +
      "var o=Array.prototype.filter.call(document.querySelectorAll('.overlay.show'),vis).pop();" +
      "if(o){var x=o.querySelector('.close-x');if(x){x.click();return 'overlay';}o.classList.remove('show');return 'overlay-force';}" +
      "return null;})()");
    if (!r) return;
    await W.sleep(400);
  }
}

/**
 * 1試合を遊ぶ（3-2-1 のあとから、結果が出るまで）。
 *   撮る回 … 最初の何回の「手を出す」を撮るか
 *   名 … 手順名の頭（2回目の試合なら '2試合目：'）
 * 返り値：{ 回: 手を出した段階の数, 人の役の出せなかった回, … }
 */
async function 一試合(W, o) {
  const { host, part, big } = W;
  const 頭 = o.名 || '';
  let 回 = 0, 組 = 0;
  const 記録 = { 手を出した段階: 0, 組みあわせ: 0, 出せなかった: { 参加者: 0, 進行役: 0 }, 間に合わない: { 参加者: 0, 進行役: 0 }, 矛盾: 0 };
  let 前 = '';
  const t0 = Date.now();
  for (;;) {
    if (Date.now() - t0 > 11 * 60 * 1000) throw new Error('11分たっても結果が出ません');
    // 次の段階が来るまで待つ（前と同じ段階のあいだは待つ）
    let 今 = await 段階(big);
    if (今 === 前 && 今 !== '結果') { await W.sleep(80); continue; }
    const 参 = await part.ev(状態式);
    if (参.画面 === 'scr-rt-sh-result' || 今 === '結果' || /決着/.test(今)) break;
    前 = 今;

    if (今 === '組みあわせ') {
      組++; 記録.組みあわせ++;
      const 撮る = 組 <= o.撮る回;
      if (!書いた.組) {
        const 大 = await big.ev("(function(){var t=(document.querySelector('#scr-rt-big')||{}).innerText||'';return {VS:/VS|たい/.test(t.replace(/たいせんする組が きまりました/,'')), 字:t.replace(/\\s+/g,' ').slice(0,200)};})()");
        if (!大.VS && 参.vs && /VS/.test(参.vs)) {
          書いた.組 = true;
          W.気づいた('気になる', '組みあわせの発表で、手元は「' + 参.vs + '」と相手を出すが、大画面は「たいせんする組が きまりました」と言うだけで、だれとだれの組かを出さない（階段に名前が並ぶだけ）', 'scr-rt-big（進化じゃんけん・組みあわせ）');
        }
      }
      const 組rec = await W.手順を('参加者', 頭 + '次の組みあわせの発表（' + 組 + '回目）：だれと当たるか', '見る', null,
        { 間: 350, 撮らない: !撮る, メモ: '手元：' + 参.段 + ' ／ ' + 参.vs + ' ／ ' + 参.note + ' ／ 帯：' + 参.帯 + (参.数字 ? ' ／ 3-2-1 の数字が重なっている' : '') });
      // おやすみの回：同じ文が帯と VS の枠に2回、さらに下にもう1文
      const 参後 = await part.ev(状態式);
      if (!書いた.おやすみ && /おやすみ/.test(参後.vs) && 参後.帯.trim() === 参後.vs.trim()) {
        書いた.おやすみ = true;
        if (!撮る) await W.手順を('参加者', 頭 + '（証拠）おやすみの回の画面', '見る', null, { 間: 0 });
        W.気づいた('気になる', 'おやすみの回、参加者の画面に同じ文「' + 参後.vs + '」が帯とVSの枠に2回出て、下にさらに「' + 参後.note + '」。見出しは「たいせんあいて」のまま（相手はいない）', 'scr-rt-sh-match（isBye）');
      }
      // 段階が変わるまで（組みあわせの発表は1.8秒・だれも押さない）＝演出待ち
      const w0 = Date.now();
      await big.until("(document.getElementById('bigPhase')||{}).textContent!=='組みあわせ'", 6000).catch(() => {});
      組rec.待ちms += Date.now() - w0; 組rec.待ちの種類 = '演出待ち'; 組rec.待つもの = '組みあわせの発表（1.8秒）が終わる';
      continue;
    }
    if (今 === '手を出す') {
      回++; 記録.手を出した段階++;
      const 撮る = 回 <= o.撮る回;
      // 1回目の「手を出す」は 3-2-1 と重なる（サーバーは数え始めと同時に組みあわせ1.8秒を回し始める）。
      // 3秒の締め切りのうち、数字が重なっている時間を測る
      let 数字の残り = null;
      if (回 === 1) {
        const tt = Date.now();
        数字の残り = part.until("!document.querySelector('.fx-countdown')", 6000).then(() => Date.now() - tt, () => null);
      }
      // 人の役 → 進行役 の順に押す。3秒の締め切りに入るように、撮影は軽くする
      if (!書いた.帯) {
        const 重 = await part.ev("(function(){var a=document.querySelector('.screen.active .now-line');var b=document.getElementById('floatingStatusBtn');if(!a||!b)return null;var r=a.getBoundingClientRect(),q=b.getBoundingClientRect();if(r.width<1||q.width<1)return null;var x=Math.max(0,Math.min(r.right,q.right)-Math.max(r.left,q.left)),y=Math.max(0,Math.min(r.bottom,q.bottom)-Math.max(r.top,q.top));return {横:Math.round(x),縦:Math.round(y),帯:[Math.round(r.left),Math.round(r.top),Math.round(r.right),Math.round(r.bottom)],ボタン:[Math.round(q.left),Math.round(q.top),Math.round(q.right),Math.round(q.bottom)],帯の要素:a.tagName,押せる:a.tagName==='BUTTON'||a.getAttribute('role')==='button'};})()");
        if (重 && 重.横 > 0 && 重.縦 > 0) {
          書いた.帯 = true;
          W.気づいた('気になる', '遊ぶ画面の上の帯（▶ 手を出す）が、右上の👥ボタンに重なっている（重なり ' + 重.横 + '×' + 重.縦 + 'px。帯 ' + 重.帯.join(',') + ' ／ 👥 ' + 重.ボタン.join(',') + '）。帯は ' + 重.帯の要素 + (重.押せる ? '' : '（押せない）') + ' だが、▶ と2pxの縁でボタンのように見える', '.now-line と #floatingStatusBtn（375×667）');
        }
      }
      const 結 = {};
      for (const dev of [part, host]) {
        let r = null;
        const rec = await W.手順を(dev.name, 頭 + '手を出す（' + 回 + '回目）', '押す', async () => {
          r = await 手を出す(W, dev, 3200);
        }, { 間: 120, 撮らない: !撮る, 失敗してよい: true });
        結[dev.name] = r;
        if (r && r.手) {
          rec.名 = 頭 + '手を出す（' + 回 + '回目）：' + 手の名[r.手];
          rec.メモ = '押した手：' + 手の名[r.手] + (r.数字の上 || r.まだ数字 ? ' ／ 押す時に 3-2-1 の数字がまだ重なっていた' : '') + (r.届いた ? '' : ' ／ 押したのにボタンが「出した」にならない');
          if (r.数字の上 || r.まだ数字) 記録.数字の上で押した = (記録.数字の上で押した || 0) + 1;
        }
        else if (r && r.出せない) {
          const s = r.s || {};
          rec.する = '見る';
          rec.名 = 頭 + '手を出す（' + 回 + '回目）：押すボタンが無い' + (s.出した ? '（もう出した）' : '');
          rec.メモ = '画面の言葉：「' + (s.note || '') + '」 帯：「' + (s.帯 || '') + '」 VS：「' + (s.vs || '') + '」' + (r.間に合わない ? ' ／ 押す前に締め切りが来た' : '');
          if (r.間に合わない) 記録.間に合わない[dev.name]++; else 記録.出せなかった[dev.name]++;
          // 押せないのに「えらんでください」「手を出す」と言っていないか（ボタンが無いのに促す）
          if (!r.間に合わない && !s.出した && (/えらんで|手を出して/.test(s.note || '') || /^手を出す$|もういちど 手を出す/.test((s.帯 || '').trim()))) {
            記録.矛盾++;
            if (!書いた.矛盾) {
              書いた.矛盾 = true;
              // 撮っていない回なら、この1回は撮り直して証拠にする
              if (!撮る) await W.手順を(dev.name, 頭 + '（証拠）ボタンが無いのに「手を出す」と言っている画面', '見る', null, { 間: 0 });
              W.気づいた('困る', dev.name + 'の画面：自分の組はもう決着していて手のボタンが1つも無いのに、「' + (s.note || '') + '」' + (s.帯 ? '・帯「' + s.帯 + '」' : '') + 'と出る（ほかの組があいこで やり直している間）', 'scr-rt-sh-play #shPlayNote / 帯');
            }
          }
        }
      }
      if (数字の残り) {
        const ms = await 数字の残り;
        記録.数字が重なった秒 = ms == null ? null : Math.round(ms / 100) / 10;
        W.メモ('「手を出す」が始まってから 3-2-1 の数字が消えるまで ' + (ms == null ? '（測れず）' : (ms / 1000).toFixed(1) + '秒') + '（締め切りは3秒）');
        if (ms != null && ms > 300 && !書いた.数字) {
          書いた.数字 = true;
          W.気づいた('困る', '1回目の「手を出す」（3秒）が、3-2-1 の数字の下で始まっている。数字が消えるまで約' + (ms / 1000).toFixed(1) + '秒、残り時間の表示はもう減っている。組みあわせの発表（1.8秒）は丸ごと数字の下で終わる', 'scr-rt-sh-match / scr-rt-sh-play と .fx-countdown');
        }
      }
      // 開くまで待つ（3秒の締め切りは全員同じ拍。早く出しても縮まない）
      await W.待つ('参加者', 頭 + '相手の手と締め切り（3秒）', '他の人待ち',
        () => big.until("(function(){var p=(document.getElementById('bigPhase')||{}).textContent||'';return p!=='手を出す';})()", 8000),
        { 間: 350, 撮らない: !撮る });
      前 = '手を出す';
      const 開 = await part.ev(状態式);
      const 進 = await host.ev(状態式);
      W.メモ('開いた時 参加者：' + 開.vs + ' ／ ' + 開.note + ' ／ ' + 開.段 + ' ｜ 進行役：' + 進.vs + ' ／ ' + 進.note + ' ／ ' + 進.段);
      // 待つの手順が「けっか」を撮ったので、そのあとは撮らずに、けっかの発表（2.2秒）が終わるまでを演出待ちに数える
      await W.待つ('参加者', 頭 + 'けっかの発表（2.2秒）が終わる', '演出待ち',
        () => big.until("(document.getElementById('bigPhase')||{}).textContent!=='けっか'", 6000), { 撮らない: true, 間: 0 });
      前 = 'けっか';
      continue;
    }
    if (今 === 'けっか') { continue; }
    await W.sleep(80);
  }
  return 記録;
}

module.exports = {
  way: 'room',
  async run(W) {
    const { host, part, big } = W;
    await W.進行役が部屋をつくる('shinka', '進化じゃんけん');
    await W.手順を('進行役', '待合：QRをみんなに見せる', '見せる', null);
    await W.参加者がQRで入る('ひろ');
    await W.大画面が入る();
    await W.botを入れる(2);
    await W.手順を('全員', 'bot 2人が入った（4人そろう）', '待つ', null);

    // ---- 進行役：ゲームをえらぶ（参加者がそのあいだ何を見ているかも、同時に撮られる） ----
    await W.手順を('進行役', '待合：ゲームをえらぶ', '押す', () => W.click(host, '#rtPickGameBtn'),
      { 待ち: { 種類: '演出待ち', 何を: '棚', until: () => W.画面は(host, 'scr-shelf') }, 間: 800 });
    await W.設定を進める({ cassetteId: 'shinka', 名: '進化じゃんけん' });
    if (!W.モード) W.モードを('進化じゃんけん（shinka）', 'カセットにゲームもモードも1つしか無く、ゲーム・モードの画面を通らずに設定へ進んだ（設定は既定のまま：はしご「ふつう」・3秒・10分）');
    await W.手順を('進行役', '待合に戻った（ゲームが決まった）', '見る', null);

    // ---- 準備OK：参加者 → 進行役 ----
    await W.準備OKまで(part);
    await W.準備OKまで(host);

    // ---- 3-2-1：出ている最中に撮る（1-3：カウントダウン中に吹き出しが出るか） ----
    await W.待つ('参加者', '3-2-1（始まりの合図）', '他の人待ち',
      () => part.until("!!document.querySelector('.fx-countdown')", 20000), { 間: 250 });
    const 吹き出しを見る = "(function(){var t=document.querySelector('.tut-say');var cd=!!document.querySelector('.fx-countdown');return {吹き出し: !!t && t.getBoundingClientRect().width>0 && getComputedStyle(t).opacity!=='0', 数字: cd};})()";
    await W.手順を('参加者', '3-2-1の途中', '見る', null, { 間: 700 });
    const cd = await part.ev(吹き出しを見る);
    const cdHost = await host.ev(吹き出しを見る);
    W.メモ('カウントダウン中の吹き出し：参加者 ' + JSON.stringify(cd) + ' 進行役 ' + JSON.stringify(cdHost) + '（進化じゃんけんにはチュートリアルの台本が無いので、「はじめてですね」も出ない）。1回戦の組みあわせの発表（1.8秒）は、この数字の下で始まって終わる');
    if ((cd.吹き出し && cd.数字) || (cdHost.吹き出し && cdHost.数字)) W.気づいた('困る', 'カウントダウンの数字が出ている最中に、チュートリアルの吹き出しが出ている（1-3 再現）', 'scr-rt-sh-match');

    // ---- 遊ぶ ----
    const 一回目 = await 一試合(W, { 撮る回: 3 });
    W.メモ書き.push('1試合目：' + JSON.stringify(一回目));

    // ---- 決着 ----
    await W.待つ('大画面', '決着の演出（祝い）', '演出待ち',
      () => big.until("!!document.querySelector('.fx-cel') || (document.getElementById('bigPhase')||{}).textContent==='決着'", 15000), { 間: 500 });
    W.メモ('祝いの最中か：参加者 ' + (await part.ev("!!document.querySelector('.fx-cel')")) + ' 進行役 ' + (await host.ev("!!document.querySelector('.fx-cel')")) + ' 大画面 ' + (await big.ev("!!document.querySelector('.fx-cel')")));
    await W.待つ('参加者', '結果', '演出待ち', () => Promise.all([part, host, big].map((d) =>
      d.until("!document.querySelector('.fx-blackout,.fx-cel,.fx-shutter') && ['scr-rt-sh-result','scr-rt-big'].indexOf((document.querySelector('.screen.active')||{}).id)!==-1", 25000))), { 間: 900 });
    const 収まり = await big.ev("(function(){var H=document.documentElement.clientHeight;var rows=Array.prototype.slice.call(document.querySelectorAll('#bigRank .rk-list > *'));var 見える=rows.filter(function(r){var b=r.getBoundingClientRect();return b.height>0&&b.bottom<=H+1;}).length;var se=document.scrollingElement;var y0=se.scrollTop;se.scrollTop=9999;var 巻ける=se.scrollTop>0;se.scrollTop=y0;var tools=Array.prototype.filter.call(document.querySelectorAll('.big-tools button'),function(b){var r=b.getBoundingClientRect();return r.width>0;}).map(function(b){var r=b.getBoundingClientRect();return b.innerText.trim()+(r.top>=H?'（画面の外）':'');});return {行:rows.length,見える:見える,巻ける:巻ける,画面の高さ:H,ボタン:tools};})()");
    W.メモ('大画面の順位表：' + JSON.stringify(収まり));
    if (収まり.行 > 収まり.見える) W.気づいた('困る', '大画面（1280×720）の結果で、順位表の' + 収まり.行 + '行のうち' + 収まり.見える + '行しか画面に入らない（4人でも最下位が見えない）。右にスクロールバーが出ている——テレビは巻けない' + (収まり.ボタン.some((t) => /画面の外/.test(t)) ? '。「プレイヤーにもどる」「部屋を出る」も画面の外' : ''), 'scr-rt-big #bigRank');
    const 称号 = await part.ev("!!document.querySelector('#titleGotOverlay.show')");
    if (称号) W.メモ('参加者に称号の幕が出ている');
    const 称号進 = await host.ev("!!document.querySelector('#titleGotOverlay.show')");
    if (称号進) W.メモ('進行役に称号の幕が出ている');

    // ---- 終わり方：ボタン・放置・行き先・もう1回 ----
    await W.結果のあと({
      async 試す() {
        // 称号の幕（出ていれば）。「あとで」は幕を閉じるだけのはず
        if (await W.ボタンあり(part, /^あとで/)) await W.ボタンを試す(part, /^あとで/, { 名: '称号の幕：あとで' });
        if (await W.ボタンあり(host, /^あとで/)) await W.ボタンを試す(host, /^あとで/, { 名: '称号の幕：あとで' });
        // 小さい丸ボタン（⚙・👥・🎁）。開いた重なりは ✕ で閉じて戻す
        for (const dev of [part, host]) {
          if (await W.ボタンあり(dev, /^🎁$/)) await W.ボタンを試す(dev, /^🎁$/, { 名: '🎁（ありがとうを贈る）', 戻す: (d) => 重なりを閉じる(W, d) });
          if (await W.ボタンあり(dev, /^👥$/)) await W.ボタンを試す(dev, /^👥$/, { 名: '👥（みんなの状況）', 戻す: (d) => 重なりを閉じる(W, d) });
          if (await W.ボタンあり(dev, /^⚙$/)) await W.ボタンを試す(dev, /^⚙$/, { 名: '⚙（設定）', 戻す: (d) => 重なりを閉じる(W, d) });
        }
        if (await W.ボタンあり(big, /^⚙$/)) await W.ボタンを試す(big, /^⚙$/, { 名: '大画面：⚙（設定）', 戻す: (d) => 重なりを閉じる(W, d) });
        // 進行役：部屋をとじる（確認が出たら やめる）
        await W.ボタンを試す(host, /部屋をとじる/, { 名: '部屋をとじる（確認が出たら やめる）' });
        // 大画面：プレイヤーにもどる。押すと遊ぶ人に数えられるので、⚙→部屋→「この画面を大画面にする」で戻す（その道も撮る）
        if (await W.ボタンあり(big, /プレイヤーにもどる/)) {
          const r = await W.ボタンを試す(big, /プレイヤーにもどる/, { 名: '大画面：プレイヤーにもどる' });
          if ((await big.screen()) !== 'scr-rt-big') {
            await W.手順を('大画面', '大画面にもどす：⚙', '押す', () => W.press(big, /^⚙$/), { 間: 700 });
            await W.手順を('大画面', '大画面にもどす：部屋', '押す', () => W.click(big, '#settingsOverlay [data-setpage="room"]'), { 間: 700 });
            await W.手順を('大画面', '大画面にもどす：この画面を大画面にする', '押す', () => W.click(big, '#settingsOverlay [data-setact="toBig"]'),
              { 待ち: { 種類: '通信待ち', 何を: '大画面', until: () => W.画面は(big, 'scr-rt-big', 8000) }, 間: 900 });
            r.戻し方 = '⚙ → 部屋 → この画面を大画面にする（3回）';
            const 再び = await big.ev("!!document.querySelector('.fx-cel')");
            W.メモ('大画面にもどした直後、祝いが出ているか：' + 再び);
            if (再び && !書いた.再祝い) { 書いた.再祝い = true; W.気づいた('気になる', '大画面を「プレイヤーにもどる」→「この画面を大画面にする」で戻すと、決着の祝い（🦅→🐉と名前）がもう一度はじめから流れる', 'scr-rt-big / clearFx'); }
          }
        }
        // 出る系は最後に。確認なしで出てしまったら、QRを読み直して戻る（その道も手順に残す）
        const 出た = await W.ボタンを試す(part, /部屋を出る/, { 名: '部屋を出る（確認が出たら やめる）' });
        if (!出た.確認あり && (await part.screen()) !== 'scr-rt-sh-result') await W.参加者が戻る();
        const 大出た = await W.ボタンを試す(big, /部屋を出る/, { 名: '大画面：部屋を出る（確認が出たら やめる）' });
        if (!大出た.確認あり) {
          await W.大画面が戻る();
          const 再び = await big.ev("!!document.querySelector('.fx-cel')");
          W.メモ('大画面が入り直した直後、祝いが出ているか：' + 再び);
          if (再び && !書いた.再祝い2) { 書いた.再祝い2 = true; W.気づいた('気になる', '大画面が「部屋を出る」から入り直すと、決着の祝いがもう一度はじめから流れる（結果の画面に入り直すたびに祝う）', 'scr-rt-big / clearFx'); }
        }
        await W.手順を('全員', '試したあと：3台がいまどこにいるか', '見る', null);
      },
      async もう一回() {
        const 前 = await host.screen();
        await W.手順を('進行役', '結果：つぎは？', '押す', () => W.press(host, /^つぎは？/), { 間: 1200 });
        if ((await host.screen()) === 前) {
          // 押しても画面が変わらない。もう一度だけ押してみる（ふつうの人は2度押す）
          await W.手順を('進行役', '結果：つぎは？（反応が無いので、もう一度押す）', '押す', () => W.press(host, /^つぎは？/), { 間: 1500 });
        }
        if ((await host.screen()) === 'scr-next') {
          W.終わり方を('つぎは？の選択肢', await W.ボタン一覧(host));
          await W.手順を('進行役', 'つぎは？：もう一度（さっきと同じ設定でそのまま）', '押す', () => W.press(host, /^🔁|もう一度/), { 間: 1200 });
        } else {
          // **「つぎは？」が行き止まり。**ふつうの人が次に探す道：⚙ →「みんなを待合にもどす」→ 待合 → ゲームをえらぶ
          W.気づいた('遊べなくなる', '進化じゃんけんの結果で、進行役の「つぎは？ ▶」（いちばん大きいボタン）を押しても何も起きない。2度押しても画面が変わらない——もう1回の道が、結果の画面から行き止まり', 'scr-rt-sh-result #rtShAgainBtn');
          W.終わり方を('つぎは？の行き先', '（何も起きない＝行き止まり）');
          await W.手順を('進行役', '（つぎは？が効かないので）⚙を開く', '押す', () => W.press(host, /^⚙$/), { 間: 800 });
          const 行 = await W.ボタン一覧(host);
          W.メモ('⚙の中のボタン：' + 行.join('／'));
          await W.手順を('進行役', '⚙：みんなを待合にもどす', '押す', () => W.press(host, /みんなを待合にもどす/, '#settingsOverlay button, #settingsOverlay [data-setact]'), { 間: 900 });
          // 確認の幕
          const 幕 = await host.ev("(function(){var l=Array.prototype.filter.call(document.querySelectorAll('.ui-layer'),function(x){return x.getBoundingClientRect().width>0;}).pop();return l?l.innerText.replace(/\\s+/g,' ').trim():null;})()");
          if (幕) {
            W.メモ('確認の幕：' + 幕);
            if (/終了しますか/.test(幕)) W.気づいた('気になる', 'もう決着して結果を見ているのに、もう1回のための道（⚙「みんなを待合にもどす」）の確認が「いまのゲームを終了しますか？」と聞く。項目は赤（危険な操作）の見た目', '設定 ⚙ → みんなを待合にもどす');
            await W.手順を('進行役', '確認：' + ((幕.match(/終了する|もどす/) || ['OK'])[0]), '押す', () => W.press(host, /^(終了する|もどす|待合にもどす|OK|はい)$/, '.ui-layer button'),
              { 待ち: { 種類: '通信待ち', 何を: '待合', until: () => W.画面は(host, 'scr-rt-room', 10000) }, 間: 900, 失敗してよい: true });
          }
          if ((await host.screen()) !== 'scr-rt-room') await 重なりを閉じる(W, host);
          // 同じゲームのまま待合にもどる作りなら、選び直さずに準備OKへ。決まっていなければ選び直す
          const 決まっている = await host.ev(W.見える('#rtRoomReadyBtn'));
          if (!決まっている && (await host.screen()) === 'scr-rt-room') {
            await W.手順を('進行役', '待合：ゲームをえらぶ（2回目）', '押す', () => W.click(host, '#rtPickGameBtn'),
              { 待ち: { 種類: '演出待ち', 何を: '棚', until: () => W.画面は(host, 'scr-shelf') }, 間: 800 });
            await W.設定を進める({ cassetteId: 'shinka', 名: '進化じゃんけん' });
          }
        }
        await W.準備OKまで(part);
        await W.準備OKまで(host);
        await W.待つ('参加者', '2回目の3-2-1', '他の人待ち', () => part.until("!!document.querySelector('.fx-countdown')", 25000), { 間: 400 });
      }
    });

    // ---- 2試合目：最後まで遊び、結果で進行役の「← 部屋を出る」を試す（もう1回の道を壊さないよう、最後に回した） ----
    const 二回目 = await 一試合(W, { 撮る回: 1, 名: '2試合目：' });
    W.メモ書き.push('2試合目：' + JSON.stringify(二回目));
    await W.待つ('参加者', '2試合目：結果', '演出待ち', () => Promise.all([part, host, big].map((d) =>
      d.until("!document.querySelector('.fx-blackout,.fx-cel,.fx-shutter') && ['scr-rt-sh-result','scr-rt-big'].indexOf((document.querySelector('.screen.active')||{}).id)!==-1", 30000))), { 間: 900 });
    await 重なりを閉じる(W, part);
    await 重なりを閉じる(W, host);
    const 進出た = await W.ボタンを試す(host, /部屋を出る/, { 名: '進行役：部屋を出る（確認が出たら やめる）' });
    await W.手順を('全員', '進行役が出たあと：残った人の画面', '見る', null, { 間: 2500 });
    const 残 = {};
    for (const [k, d] of [['参加者', part], ['大画面', big]]) {
      残[k] = { 画面: await d.screen(), ボタン: await W.ボタン一覧(d), 帯: (await d.ev(状態式)).帯 };
    }
    W.終わり方を('進行役が部屋を出たあと', { 行き先: 進出た.行き先, 確認あり: 進出た.確認あり, 残った人: 残 });
    if (!進出た.確認あり) {
      const 参が進行役に = 残.参加者.ボタン.some((t) => /つぎは？|部屋をとじる/.test(t));
      W.気づいた('困る', '結果で進行役が「← 部屋を出る」を押すと、確認なしで部屋から出て棚にもどる' + (参が進行役に ? '。進行役は参加者（人の役）に移り、その画面に「つぎは？」「部屋をとじる」が現れる' : ''), 'scr-rt-sh-result #rtShResultLeaveBtn（進行役）');
    }
  }
};
