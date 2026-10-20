// tools/flow-walk/falsetrue.js — False or True を、部屋（QR参加）で最後まで通す（指示62 第1部）
//
// 遊び方：棚の「False or True」。ゲームは1つ・設定は「話し合いの長さ」だけで、**何も変えない**（既定 60秒）。
// 4人（進行役＋人の役＋bot 2）なので、ケースは4枚（TRUE 1・FALSE 3）、ラウンドは必ず3回。
// 1ラウンドで対面の2人のうち1人が上がるので、**4人とも少なくとも1回は対面する**
// （falsetrue-logic.js の opponentPool は「まだ対面していない人」を優先する）。
//
// 人の役（参加者）と進行役は、**画面に出ている押しものだけを見て**押す（ふつうの人がしそうな手）：
//   ケースが押せる → 1つ選ぶ ／ 「ひらく」→ 中身を見て「みた」／
//   話し合い → 少し話してから「話し終わった」（持ち主なら一度「長押しで、もう一度みる」も試す）／
//   「奪う／奪わない」→ 参加者は素の判断の「奪わない」、進行役は「奪う」
// bot は tools/bot-play/falsetrue.js。
//
// 手順の切り方：参加者の画面が変わるたび（＝段階が変わるたび）に1手順。
// 人が押さない段階は「見る」（その瞬間の3台）＋「待つ」（何を・どの種類か）の2つで残す。

/** 画面から「いま自分が押せるもの」を読む（人が見て分かるものだけ） */
const 状態式 = "(function(){" +
  "var s=(document.querySelector('.screen.active')||{}).id||'';" +
  "function vis(id){var e=document.getElementById(id); if(!e||e.hidden||e.disabled) return false; var r=e.getBoundingClientRect(); return r.width>0&&r.height>0;}" +
  "var 番=null;" +
  "if(s==='scr-rt-ft-pick' && document.querySelector('#ftPickCases .ft-case:not([disabled])')) 番='pick';" +
  "else if(s==='scr-rt-ft-peek' && vis('ftPeekOpenBtn')) 番='open';" +
  "else if(s==='scr-rt-ft-peek' && vis('ftPeekSeenBtn')) 番='seen';" +
  "else if(s==='scr-rt-ft-talk' && vis('ftTalkDoneBtn')) 番='talk';" +
  "else if(s==='scr-rt-ft-decide' && vis('ftDecideChoose')) 番='decide';" +
  "var t=document.querySelector('.screen.active .scr-title');" +
  "var lead=['ftPickLead','ftPeekLead','ftTalkLead','ftDecideLead','ftDecideWait','ftFaceBox','ftOpenVerdict'].map(function(id){var e=document.getElementById(id);return e&&e.closest('.screen.active')?e.innerText.replace(/\\s+/g,' ').trim():'';}).filter(Boolean).join(' ／ ');" +
  "return {s:s, 番:番, title:t?t.textContent.trim():'', lead:lead, cd:!!document.querySelector('.fx-countdown')};" +
  "})()";

const 段の名 = {
  'scr-rt-ft-pick': 'ケースをえらぶ', 'scr-rt-ft-peek': '中身をみる', 'scr-rt-ft-face': '対面の発表',
  'scr-rt-ft-talk': '話し合い', 'scr-rt-ft-decide': '奪うか決める', 'scr-rt-ft-open': 'ケースがひらく',
  'scr-rt-ft-result': '結果発表'
};
const 演出の段 = { 'scr-rt-ft-face': true, 'scr-rt-ft-open': true };

/** ボタンの字を、そのまま一致させる正規表現の材料にする */
function 字のまま(t) { return String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** 長押し（押している間だけ中身が出る）。押している最中に1手順撮る */
async function 長押しで見る(W, dev) {
  const rec = await W.手順を(dev.name, '話し合い：「長押しで、もう一度みる」を押したまま', '長押し', async () => {
    const ok = await dev.ev("(function(){var b=document.getElementById('ftTalkHoldBtn'); if(!b||b.getBoundingClientRect().width<1) return false;" +
      "b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerType:'touch'})); return true;})()");
    if (!ok) throw new Error('長押しのボタンが見えない');
  }, { 間: 700, 失敗してよい: true });
  // 撮ったあとで指を離す
  const 中身 = await dev.ev("(function(){var c=document.getElementById('ftTalkContent');return c&&!c.hidden?c.innerText.replace(/\\s+/g,' ').trim():null;})()");
  await dev.ev("(function(){var b=document.getElementById('ftTalkHoldBtn'); b.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerType:'touch'})); return true;})()");
  await W.sleep(300);
  const 離した = await dev.ev("(function(){var c=document.getElementById('ftTalkContent');return c&&!c.hidden;})()");
  if (!rec.失敗) rec.押す回数 += 1;   // dispatchEvent で押したので、ここで数える
  W.メモ('押している間の中身：' + (中身 || '（出ない）') + ' ／ 指を離したあと中身が' + (離した ? '残っている' : '消えた'));
  if (離した) W.気づいた('困る', '話し合いの「長押しで、もう一度みる」から指を離しても、中身が出たまま', 'scr-rt-ft-talk');
}

module.exports = {
  way: 'room',
  async run(W) {
    const { host, part, big } = W;
    await W.進行役が部屋をつくる('falsetrue', 'False or True');
    await W.手順を('進行役', '待合：QRをみんなに見せる', '見せる', null);
    await W.参加者がQRで入る('ひろ');
    await W.大画面が入る();
    await W.botを入れる(2);
    await W.手順を('全員', 'bot 2人が入った（4人そろう）', '待つ', null);

    // ---- 進行役：ゲームをえらぶ ----
    await W.手順を('進行役', '待合：ゲームをえらぶ', '押す', () => W.click(host, '#rtPickGameBtn'),
      { 待ち: { 種類: '演出待ち', 何を: '棚', until: () => W.画面は(host, 'scr-shelf') }, 間: 800 });
    await W.設定を進める({ cassetteId: 'falsetrue', 名: 'False or True' });
    if (!W.モード) W.モードを('False or True（falsetrue）', 'カセットのゲームは1つ（games:[\'falsetrue\']）。設定は「話し合いの長さ」だけで、既定の60秒のまま');
    await W.手順を('進行役', '待合に戻った（ゲームが決まった）', '見る', null);

    // ---- 準備OK：参加者 → 進行役 ----
    await W.準備OKまで(part);
    await W.準備OKまで(host);

    // ---- 3-2-1：出ている最中に撮る（1-3：カウントダウン中に吹き出しが出るか） ----
    await W.待つ('参加者', '3-2-1（始まりの合図）', '他の人待ち',
      () => part.until("!!document.querySelector('.fx-countdown')", 20000), { 間: 250 });
    const 吹き出しを見る = "(function(){var t=document.querySelector('.tut-say');var cd=!!document.querySelector('.fx-countdown');return {吹き出し: !!t && t.getBoundingClientRect().width>0 && getComputedStyle(t).opacity!=='0', 数字: cd};})()";
    await W.手順を('参加者', '3-2-1の途中', '見る', null, { 間: 900 });
    const cd = await part.ev(吹き出しを見る);
    W.メモ('カウントダウン中の吹き出し：' + JSON.stringify(cd));
    if (cd.吹き出し && cd.数字) W.気づいた('困る', 'カウントダウンの数字が出ている最中に、チュートリアルの吹き出しが出ている（1-3 再現）', '3-2-1');
    await W.待つ('参加者', '最初の画面が出る', '演出待ち',
      () => part.until("((document.querySelector('.screen.active')||{}).id||'').indexOf('scr-rt-ft-')===0 && !document.querySelector('.fx-countdown')", 15000), { 間: 600 });
    const 吹き出し = await part.ev("(function(){var t=document.querySelector('.tut-say');return !!t && t.getBoundingClientRect().width>0;})()");
    if (吹き出し) await W.手順を('参加者', 'チュートリアル：吹き出しが出ている', '見る', null);
    else W.メモ('チュートリアルは出なかった（このゲームには台本が無い：tutScriptFor）');

    // ---- 遊ぶ ----
    let 前 = null, ラウンド = 1, 長押しした = false;
    const 回数 = {};
    const 人の手 = { 参加者: { 決める: '奪わない' }, 進行役: { 決める: '奪う' } };
    for (let i = 0; i < 400; i++) {
      const [p, h] = await Promise.all([part.ev(状態式), host.ev(状態式)]);
      if (p.s === 'scr-rt-ft-result' && h.s === 'scr-rt-ft-result') break;
      if (p.s === 'scr-rt-ft-result' || h.s === 'scr-rt-ft-result') { await W.sleep(300); continue; }
      if (p.s !== 前) {
        if (p.s === 'scr-rt-ft-pick' && 前 && 前 !== 'scr-rt-ft-pick') ラウンド++;
        前 = p.s;
      }
      const 誰の番 = p.番 ? { dev: part, st: p } : h.番 ? { dev: host, st: h } : null;
      if (誰の番) {
        const { dev, st } = 誰の番;
        const 名 = dev.name;
        const 段 = (段の名[st.s] || st.s) + '（' + ラウンド + '回目）';
        if (st.番 === 'pick') {
          const 番号 = await dev.ev("(function(){var b=Array.from(document.querySelectorAll('#ftPickCases .ft-case:not([disabled])'));return b.length?b[Math.floor(Math.random()*b.length)].dataset.no:null;})()");
          await W.手順を(名, 段 + '：ケース ' + 番号 + ' を押す', '押す', async () => {
            await W.sleep(1200);   // どれにするか迷う間
            await W.tap(dev, '#ftPickCases .ft-case[data-no="' + 番号 + '"]');
          }, { 待ち: { 種類: '通信待ち', 何を: '中身をみる画面', until: () => dev.until("((document.querySelector('.screen.active')||{}).id)!=='scr-rt-ft-pick'", 8000) }, 間: 600 });
        } else if (st.番 === 'open') {
          await W.手順を(名, 段 + '：「ひらく」', '押す', async () => {
            await W.sleep(800);    // まわりを見る間
            await W.tap(dev, '#ftPeekOpenBtn');
          }, { 待ち: { 種類: '演出待ち', 何を: '中身', until: () => dev.until("!document.getElementById('ftPeekContent').hidden", 5000) }, 間: 600 });
          const 中身 = await dev.ev("document.getElementById('ftPeekContent').innerText.replace(/\\s+/g,' ').trim()");
          W.メモ('自分のケースの中身：' + 中身);
          // 参加者の中身が、横の大画面・ほかの手元に出ていないか（秘密の漏れ）
          const 大の字 = await big.ev("(document.querySelector('.screen.active')||document.body).innerText");
          if (/TRUE|FALSE|あたり|はずれ/.test(大の字)) W.気づいた('遊べなくなる', '持ち主が中身を見ている間に、大画面に TRUE/FALSE の字が出ている', 'scr-rt-big');
        } else if (st.番 === 'seen') {
          await W.手順を(名, 段 + '：中身を見たので「みた ▶」', '押す', async () => {
            await W.sleep(1500);   // 中身を覚える間
            await W.tap(dev, '#ftPeekSeenBtn');
          }, { 待ち: { 種類: '通信待ち', 何を: '次の段階', until: () => dev.until("((document.querySelector('.screen.active')||{}).id)!=='scr-rt-ft-peek'", 8000) }, 間: 400 });
        } else if (st.番 === 'talk') {
          const 持ち主 = await dev.ev("(function(){var b=document.getElementById('ftTalkHoldBtn');return !!b&&b.getBoundingClientRect().width>0;})()");
          await W.手順を(名, 段 + '：話し合いの画面（' + (持ち主 ? 'ケースを持っている側' : '奪うかを決める側') + '）', '見る', null, { 間: 300 });
          if (持ち主 && !長押しした) { 長押しした = true; await 長押しで見る(W, dev); }
          await W.手順を(名, 段 + '：少し話してから「話し終わった」', '押す', async () => {
            await W.sleep(3500);   // 相手と話す間（人の役は短めに）
            await W.tap(dev, '#ftTalkDoneBtn');
          }, { 待ち: { 種類: '通信待ち', 何を: '受け付け', until: () => dev.until("((document.querySelector('.screen.active')||{}).id)!=='scr-rt-ft-talk' || document.getElementById('ftTalkDoneBtn').disabled", 8000) }, 間: 400 });
        } else if (st.番 === 'decide') {
          const 手 = 人の手[名].決める;
          await W.手順を(名, 段 + '：どうする？の画面', '見る', null, { 間: 300 });
          await W.手順を(名, 段 + '：「' + 手 + '」を押す', '押す', async () => {
            await W.sleep(1500);   // 迷う間
            await W.tap(dev, 手 === '奪う' ? '#ftTakeBtn' : '#ftKeepBtn');
          }, { 待ち: { 種類: '通信待ち', 何を: 'ケースがひらく', until: () => dev.until("((document.querySelector('.screen.active')||{}).id)!=='scr-rt-ft-decide'", 8000) }, 間: 300 });
        }
        continue;
      }

      // ---- 人の役も進行役も押すものが無い：見る＋待つ ----
      const 鍵 = p.s + '#' + ラウンド + '#' + h.s;
      if (回数[鍵]) { await W.sleep(250); continue; }
      回数[鍵] = 1;
      const 段名 = 段の名[p.s] || p.s;
      const 同じ段の何回目 = Object.keys(回数).filter((k) => k.split('#')[0] === p.s).length;
      const 撮らない = 同じ段の何回目 > 3;
      const 演出 = !!演出の段[p.s];
      const 何を = 演出 ? 段名 + 'の演出（時計で進む）' : (p.lead || 段名).slice(0, 60);
      await W.手順を('全員', 段名 + '（' + ラウンド + '回目）：' + (演出 ? '見るだけ' : 'ほかの人の番'), '見る', null, { 間: 演出 ? 500 : 200, 撮らない });
      if (演出 && p.s === 'scr-rt-ft-open') {
        const v = await big.ev("(function(){return {main:(document.getElementById('bigMain')||{}).textContent||'', sub:(document.getElementById('bigSub')||{}).textContent||''};})()");
        W.メモ('参加者の札：' + p.lead + ' ／ 大画面：' + v.main + '・' + v.sub);
      }
      await W.待つ('全員', 何を, 演出 ? '演出待ち' : '他の人待ち', async () => {
        const t0 = Date.now();
        for (;;) {
          const [p2, h2] = await Promise.all([part.ev(状態式), host.ev(状態式)]);
          if (p2.s !== p.s || h2.s !== h.s || p2.番 || h2.番) return;
          if (Date.now() - t0 > 100000) throw new Error('段階が進みません：' + p.s);
          await W.sleep(150);
        }
      }, { 間: 0, 撮らない: true });
    }

    // ---- 決着 ----
    // 祝い（.fx-cel）は2秒ほどで消えるので、結果の画面に着いたらすぐ1枚撮る
    await W.手順を('全員', '決着の演出（出ている最中）', '見る', null, { 間: 100 });
    const 祝い = {};
    for (const [k, d] of [['参加者', part], ['進行役', host], ['大画面', big]]) {
      祝い[k] = await d.ev("(function(){var c=document.querySelector('.fx-cel');return c?c.innerText.replace(/\\s+/g,' ').trim()||'（字なし）':null;})()");
    }
    W.メモ('祝いの幕（.fx-cel）：' + JSON.stringify(祝い));
    await W.待つ('全員', '結果発表（決着の演出）', '演出待ち', () => part.until("!document.querySelector('.fx-blackout,.fx-cel,.fx-shutter') && (document.querySelector('.screen.active')||{}).id==='scr-rt-ft-result'", 20000), { 間: 400 });
    // 祝いが出ていれば、出ている最中を1枚撮る
    await W.手順を('全員', '結果発表', '見る', null, { 間: 1500 });
    const 称号 = await part.ev("!!document.querySelector('#titleGotOverlay.show')");
    if (称号) W.メモ('参加者に称号の幕が出ている');
    const 称号ホスト = await host.ev("!!document.querySelector('#titleGotOverlay.show')");
    if (称号ホスト) W.メモ('進行役に称号の幕が出ている');

    // ---- 終わり方：ボタン・放置・行き先・もう1回 ----
    await W.結果のあと({
      async 試す() {
        for (const d of [part, host]) {
          if (await W.ボタンあり(d, /^あとで/)) await W.ボタンを試す(d, /^あとで/, { 名: '称号の幕：あとで' });
        }
        // 重なり（設定・みんなの状況）を閉じる。ふつうの人が押す ✕ / とじる で
        const 閉じる = async (dd) => {
          for (let k = 0; k < 3; k++) {
            const 出ている = await dd.ev("Array.from(document.querySelectorAll('.overlay.show, .ui-layer')).some(function(x){return x.getBoundingClientRect().width>0;})");
            if (!出ている) return;
            const ok = await W.pressIf(dd, /^(✕|×|とじる|閉じる|もどる|← もどる)$/, '.overlay.show button, .ui-layer button');
            if (!ok) await dd.ev("(function(){var x=Array.from(document.querySelectorAll('.overlay.show .close-x, .ui-layer [data-ui=close]')).pop(); if(x) x.click(); return !!x;})()");
            await W.sleep(400);
          }
        };
        const 名札 = { '⚙': '⚙（設定）', '👥': '👥（みんなの状況）', '🎁': '🎁（ありがとうを贈る）' };
        // 結果で見えているボタンを全部。反応ボタン（下の👏😂😮❤️🔥の並び。🎁＝ありがとうを贈る は別のボタンなので試す）・「つぎは？」（もう一回で押す）・
        // 出る/とじる系（最後に）・大画面の「プレイヤーにもどる」（下で別に）は除く
        for (const d of [part, host, big]) {
          const bs = await W.ボタン一覧(d);
          for (const t of bs) {
            if (!t || /部屋を出る|部屋をとじる|つぎは|^あとで|プレイヤーにもどる/.test(t)) continue;
            if (/^(👏|😂|😮|❤️|❤|🔥)$/.test(t)) continue;
            await W.ボタンを試す(d, new RegExp('^' + 字のまま(t) + '$'), { 名: 名札[t] || t, 戻す: 閉じる });
          }
        }
        // 1-3 の2つ目：設定の「体を動かす」の説明に、棚から下ろした「実物解除」の名前が残っているか。
        // 参加者の ⚙ → アプリの設定 → 安全 の順に、ふつうに押して開く
        await W.手順を('参加者', '⚙ → アプリの設定（1-3：体を動かすの説明を見に行く）', '押す', async () => {
          await W.press(part, /^⚙$/);
          await W.sleep(500);
          await W.press(part, /アプリの設定/, '.overlay.show .set-row');
        }, { 間: 700, 失敗してよい: true });
        const 安全 = await W.手順を('参加者', 'アプリの設定 → 安全', '押す', async () => {
          await W.press(part, /安全に関する設定/, '.overlay.show .set-row');
        }, { 間: 700, 失敗してよい: true });
        const 体 = await part.ev("(function(){var p=document.querySelector('.set-page[data-page=safety]'); if(!p||p.style.display==='none') return null; var r=Array.from(p.querySelectorAll('.toggle-row-mini')).find(function(x){return /体を動かす/.test(x.innerText);}); if(!r) return '（体を動かすの行が無い）'; r.scrollIntoView({block:'center'}); return r.innerText.replace(/\\s+/g,' ').trim();})()");
        if (体) {
          await W.手順を('参加者', '安全：「体を動かす」の行', '見る', null, { 間: 400 });
          W.メモ('「体を動かす」の行：' + 体);
          if (/実物解除/.test(体)) W.気づいた('気になる', '設定（アプリの設定→安全）の「体を動かす遊びをする」の説明に、棚から下ろした「実物解除」の名前が残っている（1-3 再現）', 'settingsOverlay 安全');
        } else {
          W.メモ('安全のページを開けなかった（' + (安全.失敗 || '画面が出ない') + '）');
        }
        await 閉じる(part);
        // 大画面の「🙋 プレイヤーにもどる」：押すとその端末がプレイヤーの画面になる。
        // 大画面に戻す道（部屋を出る → 入口から大画面として入り直す）も手順に残す。
        // 指示64 D1：TVの画面にはボタンが無い。出口は ⚙ の中
        {
          await W.大画面の歯車を試す(big, /プレイヤーにもどる/, { 名: '大画面：⚙ → 🙋 プレイヤーにもどる' });
          if ((await big.screen()) !== 'scr-rt-big') {
            const 札 = await W.ボタン一覧(big);
            W.メモ('プレイヤーになった大画面のボタン：' + 札.join(' ／ '));
            const 戻る札 = 札.find((x) => /大画面/.test(x));
            if (戻る札) {
              await W.手順を('大画面', '大画面に戻す：「' + 戻る札 + '」', '押す', () => W.press(big, new RegExp(字のまま(戻る札))), { 間: 1200 });
              await W.pressIf(big, /^(大画面にする|OK|はい)$/, '.ui-layer button');
              await W.sleep(800);
            }
            if ((await big.screen()) !== 'scr-rt-big') {
              await W.手順を('大画面', '大画面に戻す道が見えないので「← 部屋を出る」', '押す', () => W.press(big, /部屋を出る/), { 間: 1200 });
              await W.大画面が戻る();
            }
          }
        }
        await W.ボタンを試す(host, /部屋をとじる/, { 名: '部屋をとじる（確認が出たら やめる）' });
        // 出る系は最後に。確認なしで出てしまったら、QRを読み直して戻る（その道も手順に残す）
        const 出た = await W.ボタンを試す(part, /部屋を出る/, { 名: '部屋を出る（確認が出たら やめる）' });
        if (!出た.確認あり) await W.参加者が戻る();
        {
          const 大出た = await W.大画面の歯車を試す(big, /部屋を出る/, { 名: '大画面：⚙ → 部屋を出る（確認が出たら やめる）' });
          if (!大出た.確認あり && (await big.screen()) !== 'scr-rt-big') await W.大画面が戻る();
        }
        // 進行役の「← 部屋を出る」は押さない：確認なしで抜けると、もう一回（進行役が押す道）が試せなくなる。
        // 参加者の同じボタンと同じ処理（[id$="LeaveBtn"] の一括結線 → rtLeaveRoom）
        if (await W.ボタンあり(host, /部屋を出る/)) W.メモ('進行役の「← 部屋を出る」は押さなかった（参加者と同じ rtLeaveRoom。押すと進行役が抜け、もう一回が試せない）');
      },
      async もう一回() {
        await W.手順を('進行役', '結果：つぎは？', '押す', () => W.press(host, /つぎは/),
          { 待ち: { 種類: '演出待ち', 何を: 'つぎは？の画面', until: () => W.画面は(host, 'scr-next') }, 間: 700 });
        W.終わり方を('つぎは？の選択肢', await W.ボタン一覧(host));
        await W.手順を('進行役', 'つぎは？：もう一度（さっきと同じ設定でそのまま）', '押す', () => W.press(host, /^もう一度/), { 間: 1200 });
        await W.準備OKまで(part);
        await W.準備OKまで(host);
        await W.待つ('参加者', '2回目の3-2-1', '他の人待ち', () => part.until("!!document.querySelector('.fx-countdown') || ((document.querySelector('.screen.active')||{}).id||'').indexOf('scr-rt-ft-')===0 && (document.querySelector('.screen.active')||{}).id!=='scr-rt-ft-result'", 20000), { 間: 800 });
      }
    });
  }
};
