// tools/flow-walk/bakudan.js — 爆弾解除を、部屋（QR参加）で最後まで通す（指示62 第1部）
//
// 遊び方：棚で最初に選ばれている「クイズ解除・協力版」（設定は何も変えない）。
// 人の役（参加者）と進行役は、画面の3択を問題バンクで引いて**正解を押す**。
// bot 2人も正解する（tools/bot-play/bomb.js）。だから必ず「解除」で終わる。
// 爆発の回は第3部（爆発演出）で撮るので、ここでは通さない。

const path = require('path');
// 問題文で問題バンクを引き、**いま画面に出ている3択に入っている**正解を返す
const QB = "(function(q){var cs=Array.from(document.querySelectorAll('#rtBombChoices .pk-btn')).map(function(x){return x.textContent;});var all=[];Object.keys(QuizBank.QUESTIONS).forEach(function(k){all=all.concat(QuizBank.QUESTIONS[k]);});var h=all.find(function(x){return x.q===q&&cs.indexOf(x.choices[x.correct])!==-1;});return h?h.choices[h.correct]:null;})";

/** 1本解く（コードを押す→3択で正解を押す）。解けたら true、押せるコードが無ければ false */
async function 一本解く(W, dev) {
  const 開けた = await dev.ev("(function(){var b=Array.from(document.querySelectorAll('#rtBombBoard .bomb-wire-btn')).find(function(x){return !x.classList.contains('solved')&&!x.classList.contains('taken')&&!x.disabled;}); if(!b) return false; b.click(); return true;})()");
  if (!開けた) return false;
  await W.sleep(80);
  const 出た = await dev.until("document.getElementById('rtBombOverlay').classList.contains('show') && document.querySelectorAll('#rtBombChoices .pk-btn').length===3", 4000, '3択').catch(() => false);
  if (!出た) return false;
  // 開けたタップを数える（W.click を通していないので、ここで足す）
  await W.sleep(1200);   // 人が問題を読む間
  const 答え = await dev.ev(QB + "(document.getElementById('rtBombDescription').textContent)");
  await dev.ev("(function(){var a=" + JSON.stringify(答え) + ";var b=Array.from(document.querySelectorAll('#rtBombChoices .pk-btn')).find(function(x){return a?x.textContent===a:true;}) || document.querySelector('#rtBombChoices .pk-btn'); b.click(); return true;})()");
  return true;
}

module.exports = {
  way: 'room',
  async run(W) {
    const { host, part, big } = W;
    await W.進行役が部屋をつくる('bakudan', '爆弾解除');
    await W.手順を('進行役', '待合：QRをみんなに見せる', '見せる', null);
    await W.参加者がQRで入る('ひろ');
    await W.大画面が入る();
    await W.botを入れる(2);
    await W.手順を('全員', 'bot 2人が入った（4人そろう）', '待つ', null);

    // ---- 進行役：ゲームをえらぶ ----
    await W.手順を('進行役', '待合：ゲームをえらぶ', '押す', () => W.click(host, '#rtPickGameBtn'),
      { 待ち: { 種類: '演出待ち', 何を: '棚', until: () => W.画面は(host, 'scr-shelf') }, 間: 800 });
    await W.設定を進める({ cassetteId: 'bakudan', 名: '爆弾解除' });
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
    if (cd.吹き出し && cd.数字) W.気づいた('困る', 'カウントダウンの数字が出ている最中に、チュートリアルの吹き出しが出ている（1-3 再現）', 'scr-rt-bomb');
    await W.待つ('参加者', '盤が出る', '演出待ち',
      () => part.until("document.querySelectorAll('#rtBombBoard .bomb-wire-btn').length>0 && !document.querySelector('.fx-countdown')", 15000), { 間: 800 });

    // ---- チュートリアル（見ると答えた人だけ）：吹き出しが出ていれば、1手順として撮る ----
    const 吹き出し = await part.ev("(function(){var t=document.querySelector('.tut-say');return !!t && t.getBoundingClientRect().width>0;})()");
    if (吹き出し) {
      await W.手順を('参加者', 'チュートリアル：吹き出しが出ている', '見る', null);
    }

    // ---- 遊ぶ：人の役と進行役が、交互に1本ずつ解く（bot も裏で解く） ----
    let 回 = 0;
    for (let i = 0; i < 60; i++) {
      const 終わった = await part.ev("/結果/.test((document.getElementById('rtBombPhase')||{}).textContent||'') || !!document.querySelector('.fx-cel,.fx-blackout')");
      if (終わった) break;
      const dev = (i % 2 === 0) ? part : host;
      const ok = await W.手順を(dev.name, 'コードを1本解く（コード→3択）', '押す', async () => {
        const r = await 一本解く(W, dev);
        if (r) { await W.sleep(10); }
        if (!r) throw new Error('押せるコードが無い');
      }, { 失敗してよい: true, 間: 700, 撮らない: 回 > 5 && i % 4 !== 0 });
      // 一本解く は click() を2回呼ぶ（コード・答え）。数に入れる
      if (!ok.失敗) { ok.押す回数 += 2; 回++; } else { ok.名 = '押せるコードが無い（他の人が挑戦中）'; await W.sleep(1200); }
    }

    // ---- 決着 ----
    await W.待つ('参加者', '解除の祝い', '演出待ち', () => part.until("!!document.querySelector('.fx-cel') || /結果/.test((document.getElementById('rtBombPhase')||{}).textContent||'')", 20000), { 間: 600 });
    await W.待つ('参加者', '結果', '演出待ち', () => part.until("!document.querySelector('.fx-blackout,.fx-cel,.fx-shutter') && /結果/.test((document.getElementById('rtBombPhase')||{}).textContent||'')", 20000), { 間: 900 });
    // 称号の幕が出ていれば、それも撮る（押さない＝放置で消えるかを見る）
    const 称号 = await part.ev("!!document.querySelector('#titleGotOverlay.show')");
    if (称号) W.メモ('参加者に称号の幕が出ている');

    // ---- 終わり方：ボタン・放置・行き先・もう1回 ----
    await W.結果のあと({
      async 試す() {
        // 称号の幕が出ていたら、幕のボタンも行き先を見る（「あとで」は幕を閉じるだけのはず）
        if (await W.ボタンあり(part, /^あとで/)) await W.ボタンを試す(part, /^あとで/, { 名: '称号の幕：あとで' });
        if (await W.ボタンあり(part, /答え合わせ/)) await W.ボタンを試す(part, /答え合わせ/, { 名: '答え合わせを見る', 戻す: (d) => W.pressIf(d, /とじる|✕|もどる|閉じる/) });
        if (await W.ボタンあり(host, /答え合わせ/)) await W.ボタンを試す(host, /答え合わせ/, { 名: '答え合わせを見る', 戻す: (d) => W.pressIf(d, /とじる|✕|もどる|閉じる/) });
        await W.ボタンを試す(host, /部屋をとじる/, { 名: '部屋をとじる（確認が出たら やめる）' });
        // 出る系は最後に。確認なしで出てしまったら、QRを読み直して戻る（その道も手順に残す）
        const 出た = await W.ボタンを試す(part, /部屋を出る/, { 名: '部屋を出る（確認が出たら やめる）' });
        if (!出た.確認あり) await W.参加者が戻る();
        // 指示64 D1：大画面の出口は ⚙ の中
        const 大出た = await W.大画面の歯車を試す(big, /部屋を出る/, { 名: '大画面：⚙ → 部屋を出る（確認が出たら やめる）' });
        if (!大出た.確認あり && (await big.screen()) !== 'scr-rt-big') await W.大画面が戻る();
      },
      async もう一回() {
        await W.手順を('進行役', '結果：つぎは？', '押す', () => W.click(host, '#rtBombAgainBtn'),
          { 待ち: { 種類: '演出待ち', 何を: 'つぎは？の画面', until: () => W.画面は(host, 'scr-next') }, 間: 700 });
        W.終わり方を('つぎは？の選択肢', await W.ボタン一覧(host));
        await W.手順を('進行役', 'つぎは？：もう一度（さっきと同じ設定でそのまま）', '押す', () => W.press(host, /^もう一度/), { 間: 1200 });
        await W.準備OKまで(part);
        await W.準備OKまで(host);
        await W.待つ('参加者', '2回目の3-2-1', '他の人待ち', () => part.until("!!document.querySelector('.fx-countdown') || (document.querySelector('.screen.active')||{}).id==='scr-rt-bomb'", 20000), { 間: 800 });
      }
    });
  }
};
