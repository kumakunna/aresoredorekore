// tools/flow-walk/jinro.js — 人狼ゲーム（カセット jinro）を、部屋（QR参加）で最後まで通す（指示62 第1部）
//
// 遊び方：棚で人狼ゲームを選び、ゲーム選択・モード・設定で**最初に選ばれているもの**のまま進む
// （何を通したかは W.ゲーム／W.モード に自動で残る。2026-10 時点ではワードウルフの「ワードウルフ」＝1回勝負）。
// 人の役（参加者）と進行役は、画面のボタンを押して遊ぶ：
//   お題の確認 … お題を読む間（1.5秒）を置いて「確認しました」
//   作戦会議・話し合い … 参加者は話す（台本は何も押さない）。進行役が話し終わったら「すすむ」を押す
//   投票 … 並んでいる名前から1人を押す（参加者は先頭、進行役は最後——人が押しがちな端）
// bot 2人は tools/bot-play/wordwolf.js（くじで投票）。だから処刑される人も勝ち負けも毎回変わる。
//
// 終わり方を見たあと、**2回目の話し合いをだれも押さずに放っておく**（設定の3分が切れたら何が起きるか。指示63 で作戦会議は無くなった）。
// 文化祭では進行役が「すすむ」を押さずに話し続ける卓が必ずあるので、その道も撮っておく。
// この放置は「待ち」に数えない（する＝'放置'。カセットどうしの待ち時間の比べに混ぜない）。

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

/** いまの画面の「やること」を DOM から読む（rt は閉じた変数なので、画面だけを見る） */
const 状態式 = "(function(){" +
  "function vis(id){var e=document.getElementById(id);if(!e)return false;var r=e.getBoundingClientRect();if(r.width<1||r.height<1)return false;return typeof e.checkVisibility==='function'?e.checkVisibility({opacityProperty:true,visibilityProperty:true}):true;}" +
  "var scr=(document.querySelector('.screen.active')||{}).id||null;" +
  "var ph=((document.getElementById('rtPhase')||{}).textContent||'').trim();" +
  "var big=scr==='scr-rt-big'?['bigTurn','bigPhase','bigMain','bigSub'].map(function(id){return ((document.getElementById(id)||{}).innerText||'').replace(/\\s+/g,' ').trim();}).filter(Boolean).join('｜'):null;" +
  "var clock=scr==='scr-rt-big'?((document.getElementById('bigClock')||{}).textContent||'').trim():null;" +
  "var cf=vis('rtConfirmBtn')&&!document.getElementById('rtConfirmBtn').disabled?document.getElementById('rtConfirmBtn').textContent.trim():null;" +
  "var pick=Array.from(document.querySelectorAll('#rtChoiceGrid .pk-btn')).filter(function(b){return b.getBoundingClientRect().width>0&&!b.disabled;}).map(function(b){return b.textContent.trim();});" +
  "var nx=vis('rtNextBtn')&&!document.getElementById('rtNextBtn').disabled?document.getElementById('rtNextBtn').textContent.trim():null;" +
  "var again=vis('rtAgainBtn');" +
  "var wait=((document.getElementById('rtWaitNote')||{}).textContent||'').trim();" +
  "var ov=Array.from(document.querySelectorAll('.fx-countdown,.fx-blackout,.fx-cel,.fx-shutter,.fx-banner')).filter(function(x){return x.getBoundingClientRect().width>0;}).map(function(x){return String(x.className).split(' ')[0];});" +
  "return {scr:scr,段階:ph,big:big,時計:clock,確認:cf,選ぶ:pick,すすむ:nx,つぎは:again,待ち:wait,演出:ov};})()";

const 署名 = (s) => [s.scr, s.段階, s.big, s.確認, (s.選ぶ || []).join('|'), s.すすむ, s.つぎは, s.待ち].join('/');

/** その文字を含む、見えている文の位置（画面の中か、下に隠れているか）。src は正規表現の文字列 */
const 文の位置 = (src) => "(function(){var re=new RegExp(" + JSON.stringify(src) + ");var H=document.documentElement.clientHeight;" +
  "var tw=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT,null);var n,out=[];" +
  "while((n=tw.nextNode())){if(!re.test(n.nodeValue))continue;var p=n.parentElement;if(!p||p.closest('script,style'))continue;" +
  "var r=p.getBoundingClientRect();if(r.width<1||r.height<1)continue;" +
  "if(typeof p.checkVisibility==='function'&&!p.checkVisibility({opacityProperty:true,visibilityProperty:true}))continue;" +
  "out.push({文:n.nodeValue.trim().replace(/\\s+/g,' ').slice(0,60),上:Math.round(r.top),下:Math.round(r.bottom),画面内:r.bottom>0&&r.top<H});}" +
  "return {画面の高さ:H,見つかった:out};})()";

/** ボタンの上に、別のもの（反応の列・🎁 など）が重なっていないか。4点で elementFromPoint を見る */
const 覆い式 = (ids) => "(function(ids){return ids.map(function(id){var b=document.getElementById(id);if(!b)return {id:id,なし:true};" +
  "var r=b.getBoundingClientRect();if(r.width<1)return {id:id,見えない:true};" +
  "var pts=[[r.left+r.width/2,r.top+r.height/2],[r.left+10,r.bottom-6],[r.right-10,r.bottom-6],[r.right-10,r.top+6]];var 覆い=[];" +
  "pts.forEach(function(p){var e=document.elementFromPoint(p[0],p[1]);if(e&&e!==b&&!b.contains(e)){var c=e.closest('[id],[class]');覆い.push((c&&(c.id||String(c.className).split(' ')[0]))||e.tagName);}});" +
  "return {id:id,文字:b.textContent.trim().replace(/\\s+/g,' ').slice(0,20),上:Math.round(r.top),下:Math.round(r.bottom),覆われた点:覆い.length+'/4',何に:覆い.filter(function(x,i,a){return a.indexOf(x)===i;})};});})(" + JSON.stringify(ids) + ")";

/**
 * bot を入れる（W.botを入れる と同じ起動の仕方。**待ち方だけ違う**）。
 * 共有の W.botを入れる は名簿を '#rtMembers …' で数えるが、その id は画面に無い（実物は #rtMemberList）。
 * 数えられないまま15秒待って先へ進むので、その15秒のあいだに bot は脈（hb:ping）に答えず
 * 切断扱いへ近づく（tools/bot-play/wordwolf.js の先頭）。ここでは部屋の人数（#rtRoomCount）で待つ
 */
async function botを入れる(W, n) {
  const logFile = path.join(W.OUT, 'bots.log');
  const out = fs.openSync(logFile, 'w');
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'room-bots.js'), '--url', W.BASE, '--code', W.code,
    '--n', String(n), '--ready', '--play', '--hold', '7200'], { stdio: ['ignore', out, out] });
  W.bots = child;
  await W.host.until("parseInt((document.getElementById('rtRoomCount')||{}).textContent,10)>=" + (2 + n), 15000, 'bot が名簿に載る');
  await W.sleep(800);
}

module.exports = {
  way: 'room',
  async run(W) {
    const { host, part, big } = W;
    const 見る = (d) => d.ev(状態式);

    await W.進行役が部屋をつくる('jinro', '人狼ゲーム');
    await W.手順を('進行役', '待合：QRをみんなに見せる', '見せる', null);
    await W.参加者がQRで入る('ひろ');
    await W.大画面が入る();
    await botを入れる(W, 2);
    await W.手順を('全員', 'bot 2人が入った（4人そろう）', '待つ', null);
    // 参加者は、進行役がゲームを選ぶあいだ何を見ているか（待っている理由の文は画面の中にあるか）
    const 待合の文 = await part.ev(文の位置('進行役がゲームを|えらんでいます|待っています'));
    W.メモ('参加者の待合で「何を待っているか」の文：' + JSON.stringify(待合の文));
    if (!待合の文.見つかった.some((x) => x.画面内)) {
      W.気づいた('困る', '参加者の待合（375×667）で、「進行役がゲームをえらんでいます」が画面の下に隠れている。見えているのは部屋コードとQRと「← 部屋を出る」だけ（物差しc）', 'scr-rt-room');
    }
    // 大画面の名簿に出る称号（「〜の」＋「の」＋「一歩」の重なり）
    const 名簿 = await big.ev("(document.querySelector('.screen.active')||document.body).innerText");
    const のの = (名簿.match(/\S*のの\S*/g) || []);
    if (のの.length) {
      W.メモ('大画面の名簿の称号：' + のの.join('／'));
      W.気づいた('気になる', '大画面の名簿で、進行役（検証用ユーザー）の称号が「' + のの[0] + '」と「の」が2つ重なって出る（titles.js の first「なつまつりの」「はじまりの」が自分で「の」を持ち、まん中の「の」と重なる）', 'scr-rt-big');
    }

    // ---- 進行役：ゲームをえらぶ ----
    await W.手順を('進行役', '待合：ゲームをえらぶ', '押す', () => W.click(host, '#rtPickGameBtn'),
      { 待ち: { 種類: '演出待ち', 何を: '棚', until: () => W.画面は(host, 'scr-shelf') }, 間: 800 });
    await W.設定を進める({ cassetteId: 'jinro', 名: '人狼ゲーム' });
    await W.手順を('進行役', '待合に戻った（ゲームが決まった）', '見る', null);
    if (W.モード) W.モード.なぜ = (W.モード.なぜ || '') + '。ゲーム選択画面で最初に選ばれていたのは「' + (W.ゲーム || '?') + '」で、それも変えずに「つぎへ」';
    const 進行役の待ち = await host.ev(文の位置('さんを待っています|準備OK'));
    W.メモ('進行役（準備OKのあと）の「だれを待っているか」：' + JSON.stringify(進行役の待ち));
    if (!進行役の待ち.見つかった.some((x) => /待っています/.test(x.文) && x.画面内)) {
      W.気づいた('困る', '進行役が準備OKを押したあとの待合（375×812）で、「◯◯ さんを待っています」が画面の下に隠れている。見えている所はQRと、うすい「はじめる ▶」だけで、なぜ始まらないのかが分からない（物差しc）', 'scr-rt-room');
    }

    // ---- 準備OK：参加者 → 進行役 ----
    await W.準備OKまで(part);
    await W.準備OKまで(host);

    // ---- 3-2-1：出ている最中に撮る（1-3：カウントダウン中に吹き出しが出るか） ----
    await W.待つ('参加者', '3-2-1（始まりの合図）', '他の人待ち',
      () => part.until("!!document.querySelector('.fx-countdown')", 20000), { 間: 250 });
    const 吹き出しを見る = "(function(){var t=document.querySelector('.tut-say');var cd=!!document.querySelector('.fx-countdown');return {吹き出し: !!t && t.getBoundingClientRect().width>0 && getComputedStyle(t).opacity!=='0', 数字: cd};})()";
    await W.手順を('参加者', '3-2-1の途中', '見る', null, { 間: 900 });
    const cd = await part.ev(吹き出しを見る);
    const cdH = await host.ev(吹き出しを見る);
    W.メモ('カウントダウン中の吹き出し：参加者 ' + JSON.stringify(cd) + '／進行役 ' + JSON.stringify(cdH));
    if ((cd.吹き出し && cd.数字) || (cdH.吹き出し && cdH.数字)) W.気づいた('困る', 'カウントダウンの数字が出ている最中に、チュートリアルの吹き出しが出ている（1-3 再現）', 'scr-rt-play');
    await W.待つ('参加者', 'お題が出る', '演出待ち',
      () => part.until("(document.querySelector('.screen.active')||{}).id==='scr-rt-play' && !document.querySelector('.fx-countdown') && !!(document.getElementById('rtYouBox')||{}).textContent", 15000), { 間: 800 });
    const 吹き出し = await part.ev("(function(){var t=document.querySelector('.tut-say');return !!t && t.getBoundingClientRect().width>0;})()");
    if (吹き出し) await W.手順を('参加者', 'チュートリアル：吹き出しが出ている', '見る', null);
    else W.メモ('参加者：盤（お題）が出たあと、チュートリアルの吹き出しは出ていない（ワードウルフには台本が無く、「はじめてですね」も聞かれなかった）');

    // ---- 遊ぶ：画面に出ている「やること」を、参加者・進行役が1つずつ片付ける ----
    const 回数 = {};
    const 撮るか = (名) => { 回数[名] = (回数[名] || 0) + 1; return 回数[名] > 3; };   // 同じことは3回まで撮る
    const 片付ける = async (dev, s, 誰) => {
      if (s.確認) {
        const 名 = s.段階 + '：お題を読んで「' + s.確認 + '」';
        await W.sleep(1500);   // 自分のお題を読む間
        await W.手順を(誰, 名, '読んで押す', () => W.tap(dev, '#rtConfirmBtn'), { 間: 600, 撮らない: 撮るか(名) });
        return true;
      }
      if (s.選ぶ && s.選ぶ.length) {
        const 先 = 誰 === '参加者' ? s.選ぶ[0] : s.選ぶ[s.選ぶ.length - 1];
        const 名 = s.段階 + '：「' + 先 + '」をえらぶ';
        await W.sleep(1500);   // 誰に入れるか考える間
        await W.手順を(誰, 名, '押す', async () => {
          const ok = await dev.ev("(function(){var b=Array.from(document.querySelectorAll('#rtChoiceGrid .pk-btn')).find(function(x){return x.textContent.trim()===" + JSON.stringify(先) + "&&!x.disabled;});if(!b)return false;b.click();return true;})()");
          if (!ok) throw new Error('えらぶボタンが消えた');
        }, { 間: 600, 撮らない: 撮るか(s.段階 + '：えらぶ') });
        W.手順[W.手順.length - 1].押す回数 += 1;   // dev.ev で押したので、ここで数える
        return true;
      }
      return false;
    };

    let 前 = null, 同じ = 0;
    for (let i = 0; i < 80; i++) {
      const sp = await 見る(part), sh = await 見る(host);
      if (/決着/.test(sp.段階) || /決着/.test(sh.段階)) break;
      if (sp.scr !== 'scr-rt-play' && sh.scr !== 'scr-rt-play') throw new Error('遊ぶ画面から外れました：参加者 ' + sp.scr + '／進行役 ' + sh.scr);

      // 参加者のやること → 進行役のやること
      if (await 片付ける(part, sp, '参加者')) continue;
      if (await 片付ける(host, sh, '進行役')) continue;

      // 進行役が進める段階（作戦会議・話し合い・結果）
      if (sh.すすむ) {
        const 話す = /作戦会議|話し合い/.test(sh.段階);
        if (話す) {
          // 話している間、参加者と大画面に何が出ているか（何を待っているか）を撮る
          await W.手順を('参加者', sh.段階 + '：話している（進行役が「' + sh.すすむ + '」を押すのを待つ）', '待つ', null,
            { 間: 3000, 撮らない: 撮るか(sh.段階 + '：話す') });
          const 大 = await 見る(big);
          const 手元の時計 = await part.ev(文の位置('^\\s*\\d{1,2}:\\d{2}\\s*$'));
          const 進行役の時計 = await host.ev(文の位置('^\\s*\\d{1,2}:\\d{2}\\s*$'));
          W.メモ('参加者の待ち文：' + (sp.待ち || '（なし）') + '／大画面：' + 大.big + '・時計 ' + (大.時計 || '（なし）') +
            '／手元の時計：参加者 ' + 手元の時計.見つかった.length + '個・進行役 ' + 進行役の時計.見つかった.length + '個');
          if (大.時計 && !手元の時計.見つかった.length && !進行役の時計.見つかった.length && !回数['時計の食い違い:' + sh.段階]) {
            回数['時計の食い違い:' + sh.段階] = 1;
            W.気づいた('困る', sh.段階 + 'のあいだ、大画面には残り時間（' + 大.時計 + '）が出ているのに、参加者にも進行役にも時計が1つも出ていない。設定は「タイマーを使う：3:00・時間の見せ方：常に表示」（物差しf）', 'scr-rt-play / scr-rt-big');
          }
        } else {
          await W.sleep(1500);   // 結果を読む間
        }
        const 名 = sh.段階 + '：「' + sh.すすむ + '」';
        await W.手順を('進行役', 名, '押す', () => W.tap(host, '#rtNextBtn'),
          { 待ち: { 種類: '通信待ち', 何を: '次の段階', until: () => host.until("(function(s){return s!==" + JSON.stringify(sh.段階) + "||!document.getElementById('rtNextBtn').checkVisibility();})(((document.getElementById('rtPhase')||{}).textContent||'').trim())", 10000) },
            間: 900, 撮らない: 撮るか(名) });
        continue;
      }

      // だれも何もできない＝ほかの人（bot）の操作か、演出を待っている
      const sig = 署名(sp) + '#' + 署名(sh);
      if (sig === 前) { if (++同じ > 40) throw new Error('進みません：' + sig); } else { 前 = sig; 同じ = 0; }
      const 何を = sp.演出.length ? '演出（' + sp.演出.join(',') + '）' : 'ほかの人の操作（' + (sp.待ち || sh.待ち || '待ち文なし') + '）';
      const 種類 = sp.演出.length ? '演出待ち' : '他の人待ち';
      await W.待つ('参加者', sp.段階 + '：' + 何を, 種類, async () => {
        const t0 = Date.now();
        for (;;) {
          const a = await 見る(part), b = await 見る(host);
          if (署名(a) + '#' + 署名(b) !== sig) return;
          if (Date.now() - t0 > 30000) throw new Error('30秒たっても変わりません：' + sig);
          await W.sleep(150);
        }
      }, { 間: 300, 撮らない: 撮るか('待つ：' + sp.段階 + 種類) });
    }

    // ---- 決着 ----
    await W.待つ('参加者', '決着の演出', '演出待ち', () => part.until("/決着/.test((document.getElementById('rtPhase')||{}).textContent||'')", 20000), { 間: 600 });
    await W.待つ('参加者', '結果', '演出待ち', () => part.until("!document.querySelector('.fx-blackout,.fx-cel,.fx-shutter,.fx-banner') && /決着/.test((document.getElementById('rtPhase')||{}).textContent||'')", 20000), { 間: 900 });
    for (const [誰, d] of [['参加者', part], ['進行役', host]]) {
      const 幕 = await d.ev("(function(){var o=document.querySelector('#titleGotOverlay.show');return o?o.innerText.replace(/\\s+/g,' ').trim().slice(0,200):null;})()");
      if (幕) W.メモ(誰 + 'に称号の幕が出て、結果の上にかぶさっている：' + 幕);
    }

    // ---- 終わり方：ボタン・放置・行き先・もう1回 ----
    await W.結果のあと({
      async 試す() {
        for (const d of [part, host]) {
          if (await W.ボタンあり(d, /^あとで/)) await W.ボタンを試す(d, /^あとで/, { 名: '称号の幕：あとで' });
        }
        // 幕を閉じたあとの結果を、下まで送って撮る（だれがだれに入れたか・ボタン）
        const 下まで = "(function(){var b=document.querySelector('.screen.active .wiz-body');if(b)b.scrollTop=b.scrollHeight;window.scrollTo(0,document.body.scrollHeight);return true;})()";
        await W.手順を('参加者', '結果を下まで見る', 'スクロール', () => part.ev(下まで), { 間: 700 });
        await W.手順を('進行役', '結果を下まで見る', 'スクロール', () => host.ev(下まで), { 間: 700 });
        const 覆い参 = await part.ev(覆い式(['rtAgainBtn', 'rtPlayLeaveBtn']));
        const 覆い進 = await host.ev(覆い式(['rtAgainBtn', 'rtEndBtn', 'rtPlayLeaveBtn']));
        W.メモ('結果のボタンに重なるもの：参加者 ' + JSON.stringify(覆い参) + '／進行役 ' + JSON.stringify(覆い進));
        W.終わり方を('結果のボタンに重なるもの', { 参加者: 覆い参, 進行役: 覆い進 });
        const 覆われた = 覆い参.concat(覆い進).filter((x) => x.何に && x.何に.length);
        if (覆われた.length) {
          W.気づいた('困る', '結果の画面を下まで送っても、ボタンの上に反応の列（👏😂😮❤️🔥）や🎁が重なっている：' +
            覆われた.map((x) => x.文字 + '（' + x.覆われた点 + '点が ' + x.何に.join(',') + '）').join('／'), 'scr-rt-play');
        }
        // 参加者の「つぎは？」の場所にある、押せない札（進行役が つぎをえらんでいます…）
        W.終わり方を('参加者の押せない札', await part.ev("(function(){var b=document.getElementById('rtAgainBtn');return b&&b.getBoundingClientRect().width>0?{文字:b.textContent.trim(),押せない:b.disabled}:null;})()"));
        await W.ボタンを試す(host, /部屋をとじる/, { 名: '部屋をとじる（確認が出たら やめる）' });
        // 進行役の「← 部屋を出る」は押さない：押すと進行役が bot に移り、「もう1回」をたどれなくなる。
        // 同じ処理（[id$=LeaveBtn] → rtLeaveRoom）に繋がる参加者のボタンで、行き先を確かめる
        W.終わり方を('進行役の部屋を出るを押さなかった理由', '押すと進行役が bot に移り、もう1回をたどれなくなるため。同じ処理（[id$="LeaveBtn"] → rtLeaveRoom）につながる参加者・大画面のボタンで行き先を確かめた');
        const 出た = await W.ボタンを試す(part, /部屋を出る/, { 名: '部屋を出る（確認が出たら やめる）' });
        if (!出た.確認あり) await W.参加者が戻る();
        const 大出た = await W.ボタンを試す(big, /部屋を出る/, { 名: '大画面：部屋を出る（確認が出たら やめる）' });
        if (!大出た.確認あり) await W.大画面が戻る();
      },
      async もう一回() {
        await W.手順を('進行役', '結果：つぎは？', '押す', () => W.click(host, '#rtAgainBtn'),
          { 待ち: { 種類: '演出待ち', 何を: 'つぎは？の画面', until: () => W.画面は(host, 'scr-next') }, 間: 700 });
        W.終わり方を('つぎは？の選択肢', await W.ボタン一覧(host));
        await W.手順を('進行役', 'つぎは？：もう一度（さっきと同じ設定でそのまま）', '押す', () => W.press(host, /^もう一度/), { 間: 1200 });
        await W.準備OKまで(part);
        await W.準備OKまで(host);
        await W.待つ('参加者', '2回目の3-2-1', '他の人待ち', () => part.until("!!document.querySelector('.fx-countdown') || (document.querySelector('.screen.active')||{}).id==='scr-rt-play'", 20000), { 間: 800 });
      }
    });

    // ---- 2回目：作戦会議を、だれも押さずに時間切れまで放っておく ----
    await W.待つ('参加者', '2回目：お題が出る', '演出待ち',
      () => part.until("(document.querySelector('.screen.active')||{}).id==='scr-rt-play' && !document.querySelector('.fx-countdown') && document.getElementById('rtConfirmBtn').checkVisibility()", 15000), { 間: 600 });
    for (const [誰, d] of [['参加者', part], ['進行役', host]]) {
      if ((await 見る(d)).確認) await W.手順を(誰, '2回目：お題を読んで「確認しました」', '読んで押す', () => W.tap(d, '#rtConfirmBtn'), { 間: 600 });
    }
    // 指示63 第5部：作戦会議は無くなった。お題を見たら、すぐ話し合い。
    // 話し合いを、だれも押さずに時間切れまで放っておく（投票へ進むか）。手元にも時計が出ているか
    await host.until("((document.getElementById('rtPhase')||{}).textContent||'').trim()==='話し合い'", 20000, '2回目の話し合い');
    const 話の始め = await 見る(big);
    const 手元の時計 = await part.ev("(function(){var t=document.getElementById('rtPlayTimer');if(!t)return null;var r=t.getBoundingClientRect();return r.width>0&&getComputedStyle(t).display!=='none'?t.textContent.trim():null;})()");
    const 始めの時刻 = Date.now();
    await W.手順を('全員', '2回目：話し合い（だれも押さない。大画面の時計 ' + (話の始め.時計 || 'なし') + '・参加者の手元の時計 ' + (手元の時計 || 'なし') + '）', '見る', null, { 間: 500 });
    let 話の後 = null;
    await W.手順を('全員', '2回目：話し合いを、進行役が押さずに時間切れまで放っておく', '放置', async () => {
      await host.until("((document.getElementById('rtPhase')||{}).textContent||'').trim()!=='話し合い'", 260000, '話し合いの時間切れ');
      話の後 = { 参加者: await 見る(part), 進行役: await 見る(host), 大画面: await 見る(big) };
    }, { 間: 1500 });
    const 秒 = Math.round((Date.now() - 始めの時刻) / 1000);
    W.メモ('話し合いの時間切れ：約' + 秒 + '秒で、進行役は ' + 話の後.進行役.段階 + '、参加者は ' + 話の後.参加者.段階 +
      '、大画面は ' + 話の後.大画面.big + '・時計 ' + (話の後.大画面.時計 || 'なし') + ' に変わった。手元の時計（話し合いの始め）：' + (手元の時計 || 'なし'));
    W.終わり方を('2回目：話し合いを放っておいたら', { 秒, 手元の時計, 後: 話の後 });
    if (!手元の時計) W.気づいた('困る', '話し合いの間、参加者の手元に時計が出ていない（設定「常に表示」）', 'scr-rt-play #rtPlayTimer');
    if (!/投票/.test(話の後.進行役.段階)) W.気づいた('困る', '話し合いの時間切れで、投票へ進まない（いま ' + 話の後.進行役.段階 + '）', 'scr-rt-play');
  }
};
