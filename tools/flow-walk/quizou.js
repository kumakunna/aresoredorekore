// tools/flow-walk/quizou.js — クイズ王を、部屋（QR参加）で最後まで通す（指示62 第1部）
//
// 遊び方：ゲーム選択で最初に選ばれている「クイズラッシュ」（quizrush）。設定は何も変えない
// （制限時間 180秒・パス3回・難易度は途中で変えられる・ラウンド制なし＝1本勝負）。
//
// クイズラッシュは「全員が同時に、自分のペースで解き続ける」遊び。1問ごとに難易度をえらび直し、
// 外すと「おてつき」で5秒は次を引けない（quiz-room.js）。だから台本も
//   人の役（参加者）と進行役が、**本物の画面のボタンを押して**1問ずつ交互に解く
//   （難易度のカード → 問題を読む間 → 3択）。**ときどき外す・1回パスする**（ふつうの人の手）
// とし、bot 2人は tools/bot-play/quizrush.js で同時に解き続ける。
// 制限時間が来ると決着 → 結果。最初の数問だけ撮り、あとは 撮らない で数だけ残す。

const QB = "(function(q){var all=[];Object.keys(QuizBank.QUESTIONS).forEach(function(k){all=all.concat(QuizBank.QUESTIONS[k]);});var h=all.find(function(x){return x.q===q;});return h?h.choices[h.correct]:null;})";

/** クイズの画面のいまの様子（押せる難易度・問題・選択肢・時計） */
const 様子式 = "(function(){var b=document.getElementById('qzBody');if(!b)return null;" +
  "var t=Array.from(b.querySelectorAll('[data-qztier]'));var a=Array.from(b.querySelectorAll('[data-qzans]'));var q=b.querySelector('.quiz-q');" +
  "return {段階:(document.getElementById('qzPhase')||{}).textContent||'',画面:(document.querySelector('.screen.active')||{}).id," +
  "難易度:t.filter(function(x){return !x.disabled;}).map(function(x){return x.dataset.qztier;}),おてつき:t.length>0&&t.every(function(x){return x.disabled;})," +
  "問題:q?q.textContent:null,選択肢:a.map(function(x){return x.textContent;}),パス:!!b.querySelector('[data-qzpass]')," +
  "時計:(document.getElementById('qzTimer')||{}).textContent||'',点:(document.getElementById('qzScore')||{}).textContent||''};})()";
const 終わった式 = "/結果$/.test((document.getElementById('qzPhase')||{}).textContent||'') || !!((document.getElementById('qzResult')||{}).innerHTML||'').trim()";

const 様子 = (dev) => dev.ev(様子式);
const 終わった = (dev) => dev.ev(終わった式);

/** 難易度のカードを押して、問題が出るまで待つ */
async function 難易度を押す(W, dev, tier) {
  await W.click(dev, '#qzBody [data-qztier="' + tier + '"]');
  await dev.until("!!document.querySelector('#qzBody .quiz-q') || (" + 終わった式 + ")", 6000, '問題が出る');
}

/**
 * 問題を読んで3択を押す。外す=true なら、わざと外れを押す（ふつうの人はときどき外す）。
 * 押したあと、問題が引っ込む（＝難易度の画面にもどる）まで待つ
 */
async function 答える(W, dev, 外す, 読む間) {
  const 様 = await 様子(dev);
  if (!様 || !様.問題) throw new Error('問題が出ていない');
  await W.sleep(読む間 == null ? 1500 : 読む間);   // 人が問題と3択を読む間
  const 正解 = await dev.ev(QB + '(' + JSON.stringify(様.問題) + ')');
  let i = 様.選択肢.indexOf(正解);
  if (外す || i === -1) i = 様.選択肢.findIndex((c, k) => k !== 様.選択肢.indexOf(正解));
  await W.click(dev, '#qzBody [data-qzans="' + i + '"]');
  await dev.until("!document.querySelector('#qzBody .quiz-q') || (" + 終わった式 + ")", 6000, '答えが届く');
  return { 問題: 様.問題, 押した: 様.選択肢[i], 正解, 当たり: 様.選択肢[i] === 正解 };
}

/**
 * 演出の出入りを、端末の中の見張り（MutationObserver）に拾わせる（落とし穴28：時々覗くと取りこぼす）。
 * 祝い（.fx-cel）は 1.7秒で引くので、手順の撮影だけでは「出たか」が分からない
 */
const 演出の見張り = "(function(){if(window.__演出)return true;window.__演出=[];var t0=Date.now();var now={};" +
  "var sels=['.fx-countdown','.fx-cel','.fx-banner','.fx-flash','.fx-blackout','.fx-burst','.fx-confetti','.fx-edge','.fx-notice','#titleGotOverlay.show','.tut-say'];" +
  "function look(){sels.forEach(function(s){var e=document.querySelector(s);if(e&&!now[s]){now[s]=1;window.__演出.push(((Date.now()-t0)/1000).toFixed(1)+'秒 出た '+s+' 「'+(e.innerText||'').replace(/\\s+/g,' ').trim().slice(0,50)+'」');}" +
  "else if(!e&&now[s]){now[s]=0;window.__演出.push(((Date.now()-t0)/1000).toFixed(1)+'秒 消えた '+s);}});}" +
  "new MutationObserver(look).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});look();return true;})()";

/** 大画面の端末を、⚙ の「この画面を大画面にする」で大画面にもどす（ふつうの人が直す道） */
async function 大画面にもどす(W, big) {
  await W.click(big, '#floatingGearBtn');
  await W.sleep(600);
  // 遊ぶ人の ⚙ の一番上には無い。「部屋（メンバー・つながり具合・部屋コード）」の中にある
  if (!(await W.ボタンあり(big, /この画面を大画面にする/))) {
    if (!(await W.pressIf(big, /^部屋\s*メンバー/))) throw new Error('⚙ に「部屋」が見つからない');
    await W.sleep(600);
  }
  if (!(await W.pressIf(big, /この画面を大画面にする/))) throw new Error('⚙ →「部屋」に「この画面を大画面にする」が見つからない');
  await W.sleep(600);
  // 確認が出たら進む側を押す（進行役でなければ出ないはず）
  await W.pressIf(big, /^大画面にする$/, '.ui-layer button');
}

/** 重なり（.overlay.show）を ✕ で閉じる。結果のボタンを試したあとの後始末 */
async function 重なりを閉じる(W, dev) {
  const ok = await dev.ev("(function(){var x=Array.from(document.querySelectorAll('.overlay.show .close-x')).filter(function(b){return b.getBoundingClientRect().width>0;}).pop(); if(!x) return false; x.click(); return true;})()");
  if (ok) await W.sleep(400);
  return ok;
}

module.exports = {
  way: 'room',
  async run(W) {
    const { host, part, big } = W;
    await W.進行役が部屋をつくる('quizou', 'クイズ王');
    await W.手順を('進行役', '待合：QRをみんなに見せる', '見せる', null);
    await W.参加者がQRで入る('ひろ');
    await W.大画面が入る();
    await W.botを入れる(2);
    await W.手順を('全員', 'bot 2人が入った（4人そろう）', '待つ', null);

    // ---- 進行役：ゲームをえらぶ（参加者は待合でそれを待っている） ----
    await W.手順を('進行役', '待合：ゲームをえらぶ', '押す', () => W.click(host, '#rtPickGameBtn'),
      { 待ち: { 種類: '演出待ち', 何を: '棚', until: () => W.画面は(host, 'scr-shelf') }, 間: 800 });
    await W.設定を進める({ cassetteId: 'quizou', 名: 'クイズ王' });
    if (W.ゲーム) W.メモ書き.push('ゲーム選択で最初に選ばれていたもの：' + W.ゲーム);
    await W.手順を('進行役', '待合に戻った（ゲームが決まった）', '見る', null);

    // ---- 準備OK：参加者 → 進行役 ----
    for (const d of [host, part, big]) await d.ev(演出の見張り);
    await W.準備OKまで(part);
    await W.準備OKまで(host);

    // ---- 3-2-1：出ている最中に撮る（1-3：カウントダウン中に吹き出しが出るか） ----
    await W.待つ('参加者', '3-2-1（始まりの合図）', '他の人待ち',
      () => part.until("!!document.querySelector('.fx-countdown')", 20000), { 間: 250 });
    const 吹き出しを見る = "(function(){var t=document.querySelector('.tut-say');var cd=!!document.querySelector('.fx-countdown');return {吹き出し: !!t && t.getBoundingClientRect().width>0 && getComputedStyle(t).opacity!=='0', 数字: cd};})()";
    await W.手順を('参加者', '3-2-1の途中', '見る', null, { 間: 900 });
    const cd = await part.ev(吹き出しを見る);
    W.メモ('カウントダウン中の吹き出し：' + JSON.stringify(cd));
    if (cd.吹き出し && cd.数字) W.気づいた('困る', 'カウントダウンの数字が出ている最中に、チュートリアルの吹き出しが出ている（1-3 再現）', 'scr-rt-quiz');
    await W.待つ('参加者', '難易度のカードが出る', '演出待ち',
      () => part.until("document.querySelectorAll('#qzBody [data-qztier]').length>0 && !document.querySelector('.fx-countdown')", 15000), { 間: 600 });
    const 始めの時計 = (await 様子(part)).時計;
    W.メモ('3-2-1が明けた時の時計：' + 始めの時計 + '（設定は180秒）');

    // チュートリアルの吹き出し（台本のあるゲームだけ）が出ていれば、1手順として撮る
    if (await part.ev("(function(){var t=document.querySelector('.tut-say');return !!t && t.getBoundingClientRect().width>0;})()")) {
      await W.手順を('参加者', 'チュートリアル：吹き出しが出ている', '見る', null);
    }

    // ---- 遊ぶ：最初の数問は、段階ごとに撮る ----
    let 記録 = [];
    const 一問 = async (dev, tier, 外す, 名) => {
      let r = null;
      await W.手順を(dev.name, '難易度：' + 名 + ' を押す', '押す', () => 難易度を押す(W, dev, tier), { 間: 300 });
      const rec = await W.手順を(dev.name, '問題を読んで3択を押す' + (外す ? '（わからないので勘で押す→外れ）' : ''), '読んで押す', async () => { r = await 答える(W, dev, 外す); }, { 間: 500 });
      if (r) { 記録.push(Object.assign({ 誰: dev.name }, r)); W.メモ('問題「' + r.問題 + '」→ ' + r.押した + (r.当たり ? '（正解）' : '（外れ。正解は ' + r.正解 + '）')); }
      return rec;
    };
    await 一問(part, 'normal', false, '🟡 ふつう');
    await 一問(host, 'easy', false, '🟢 かんたん');
    // 人の役：むずかしいに挑む → わからないのでパス → 次の問題を勘で押して外す（おてつき）
    await W.手順を('参加者', '難易度：🟠 むずかしい を押す', '押す', () => 難易度を押す(W, part, 'hard'), { 間: 300 });
    const パス前 = (await 様子(part)).問題;
    await W.手順を('参加者', 'わからないので「パスする」', '押す', async () => {
      await W.sleep(1800);
      await W.click(part, '#qzBody [data-qzpass]');
      await part.until("(function(){var q=document.querySelector('#qzBody .quiz-q');return !!q && q.textContent!==" + JSON.stringify(パス前) + ";})()", 6000, '次の問題');
    }, { 間: 400 });
    await W.手順を('参加者', '問題を読んで3択を押す（わからないので勘で押す→外れ）', '読んで押す', async () => {
      const r = await 答える(W, part, true, 2200);
      W.メモ('問題「' + r.問題 + '」→ ' + r.押した + '（外れ。正解は ' + r.正解 + '）');
    }, { 間: 300 });
    const おて = await 様子(part);
    W.メモ('外したあとの画面：おてつき=' + おて.おてつき + '・押せる難易度=' + JSON.stringify(おて.難易度));
    await W.待つ('参加者', 'おてつきの待ち（外すと5秒は次を引けない）', '演出待ち',
      () => part.until("(function(){var t=document.querySelectorAll('#qzBody [data-qztier]');return t.length>0&&Array.from(t).some(function(x){return !x.disabled;});})() || (" + 終わった式 + ")", 9000), { 間: 300 });
    await 一問(host, 'normal', true, '🟡 ふつう');
    await 一問(part, 'easy', false, '🟢 かんたん');

    // ---- 遊ぶ：時間いっぱいまで、2人が交互に解き続ける（ここからは数だけ残す） ----
    let 回 = 0, 終わり近く = false;
    for (let i = 0; i < 400; i++) {
      if (await 終わった(part)) break;
      const dev = (i % 2 === 0) ? part : host;
      const 様 = await 様子(dev);
      if (!様 || 様.画面 !== 'scr-rt-quiz') { await W.sleep(500); continue; }
      // のこり10秒を切ったら、1度だけ3台を撮る（時計の出方を見る）
      if (!終わり近く && /^00:(0\d|10)$/.test(様.時計)) {
        終わり近く = true;
        await W.手順を(dev.name, 'のこり10秒（時計）', '見る', null, { 間: 0 });
      }
      // のこり4秒を切ったら、押すのをやめて決着を待つ（決着の演出を撮り逃さないため。
      // 1回目の通しは問題を読んでいる最中に時間切れになり、祝いが引いたあとにしか撮れなかった）
      if (/^00:0[0-4]$/.test(様.時計)) break;
      if (様.おてつき || !様.難易度.length) { await W.sleep(400); continue; }
      const r = Math.random();
      const tier = 様.難易度.indexOf(r < 0.3 ? 'easy' : r < 0.85 ? 'normal' : 'hard') !== -1 ? (r < 0.3 ? 'easy' : r < 0.85 ? 'normal' : 'hard') : 様.難易度[0];
      const 外す = Math.random() < (tier === 'hard' ? 0.4 : tier === 'normal' ? 0.25 : 0.12);
      let 答 = null;
      const rec = await W.手順を(dev.name, '1問解く（難易度 ' + tier + ' → 3択' + (外す ? '・外れ' : '') + '）', '押す', async () => {
        await 難易度を押す(W, dev, tier);
        if (await 終わった(dev)) return;
        答 = await 答える(W, dev, 外す, 1200 + Math.random() * 1500);
      }, { 失敗してよい: true, 間: 200, 撮らない: 回 >= 4 && 回 % 6 !== 0 });
      回++;
      if (答) 記録.push(Object.assign({ 誰: dev.name }, 答));
      if (rec.失敗) { rec.名 += '（途中で時間切れ／押せなかった）'; }
    }
    W.メモ書き.push('人の役と進行役が解いた問題：' + 記録.length + '問（正解 ' + 記録.filter((x) => x.当たり).length + '）');

    // ---- 決着 ----
    // 祝い（勝った人の端末と大画面にだけ出る・1.7秒で引く）が出ている間に撮る
    await W.待つ('全員', '時間切れ → 決着の演出', '演出待ち', async () => {
      await part.until(終わった式, 30000);
      await big.until("!!document.querySelector('.fx-cel')", 2500).catch(() => {});
    }, { 間: 100 });
    const 祝い = {};
    for (const [k, d] of [['進行役', host], ['参加者', part], ['大画面', big]]) 祝い[k] = await d.ev("!!document.querySelector('.fx-cel')");
    W.メモ('撮った直後に祝い（.fx-cel）が出ていた端末：' + JSON.stringify(祝い));
    // もう1枚（祝いの文字＝名前と「優勝」が入ってくるところ。1枚目は王冠しか写っていなかった）
    if (祝い.大画面 || 祝い.進行役 || 祝い.参加者) {
      await W.手順を('全員', '決着の演出の続き（名前と「優勝」）', '見る', null, { 間: 350 });
      const 字 = {};
      for (const [k, d] of [['進行役', host], ['参加者', part], ['大画面', big]]) 字[k] = await d.ev("(function(){var c=document.querySelector('.fx-cel');if(!c)return null;var t=c.querySelector('.fx-cel-text'),s=c.querySelector('.fx-cel-sub');return {文字:t?t.textContent:'',下:s?s.textContent:'',文字の濃さ:t?getComputedStyle(t).opacity:null};})()");
      W.メモ('祝いの文字：' + JSON.stringify(字));
    }
    await W.待つ('参加者', '結果（祝いが引くまで）', '演出待ち', async () => {
      for (const d of [part, host, big]) await d.until("!document.querySelector('.fx-blackout,.fx-cel,.fx-shutter')", 20000).catch(() => {});
    }, { 間: 900 });
    const 称号 = {};
    for (const [k, d] of [['進行役', host], ['参加者', part]]) 称号[k] = await d.ev("!!document.querySelector('#titleGotOverlay.show')");
    W.メモ('称号の幕：' + JSON.stringify(称号));
    // 演出の出入り（見張りが拾ったもの）を、端末ごとに残す
    const 演出 = {};
    for (const [k, d] of [['進行役', host], ['参加者', part], ['大画面', big]]) 演出[k] = await d.ev('window.__演出||[]');
    W.終わり方を('演出の出入り（3-2-1から結果まで）', 演出);
    const 結果の順位 = await part.ev("Array.from(document.querySelectorAll('#qzResult .rk-list > div')).map(function(x){return x.innerText.replace(/\\s+/g,' ').trim();})");
    W.メモ書き.push('結果の順位（参加者の画面）：' + JSON.stringify(結果の順位));

    // ---- 終わり方：ボタン・放置・行き先・もう1回 ----
    await W.結果のあと({
      async 試す() {
        // 称号の幕が出ていたら、幕のボタンから（参加者は既定の「すぐ着ける」、進行役は「あとで」）
        if (await W.ボタンあり(part, /^すぐ着ける/)) await W.ボタンを試す(part, /^すぐ着ける/, { 名: '称号の幕：すぐ着ける' });
        if (await W.ボタンあり(host, /^あとで/)) await W.ボタンを試す(host, /^あとで/, { 名: '称号の幕：あとで' });
        if (await W.ボタンあり(part, /^あとで/)) await W.ボタンを試す(part, /^あとで/, { 名: '称号の幕：あとで' });
        // 浮いている丸ボタン（⚙ 設定・👥 みんなの状況・🎁 ありがとう）。開いたら ✕ で閉じる
        for (const [dev, 誰] of [[part, '参加者'], [host, '進行役'], [big, '大画面']]) {
          for (const [re, 名] of [[/^⚙$/, '⚙（設定）'], [/^👥$/, '👥（みんなの状況）'], [/^🎁$/, '🎁（ありがとうを贈る）']]) {
            if (await W.ボタンあり(dev, re)) await W.ボタンを試す(dev, re, { 名: 誰 + '：' + 名, 戻す: (d) => 重なりを閉じる(W, d) });
          }
        }
        // 参加者の「進行役が つぎをえらんでいます…」は押せない札（disabled）——押せるかだけ記録
        const 札 = await part.ev("(function(){var b=document.getElementById('qzAgainBtn');return b&&b.getBoundingClientRect().width>0?{字:b.innerText.trim(),押せない:b.disabled}:null;})()");
        if (札) W.終わり方を('参加者のつぎは？の札', 札);
        await W.ボタンを試す(host, /部屋をとじる/, { 名: '部屋をとじる（確認が出たら やめる）' });
        // 大画面の「プレイヤーにもどる」は、押すと遊ぶ人に数えられる。行き先を見て、大画面にもどす
        if (await W.ボタンあり(big, /プレイヤーにもどる/)) {
          const r = await W.ボタンを試す(big, /プレイヤーにもどる/, { 名: '大画面：プレイヤーにもどる' });
          if (!/確認/.test(r.行き先) && (await big.screen()) !== 'scr-rt-big') {
            await W.手順を('大画面', '大画面にもどす（⚙ →「この画面を大画面にする」）', '押す', () => 大画面にもどす(W, big),
              { 待ち: { 種類: '通信待ち', 何を: '大画面', until: () => W.画面は(big, 'scr-rt-big', 8000) } });
          }
        }
        // 出る系は最後に。確認なしで出てしまったら、QRを読み直して戻る（その道も手順に残す）
        const 出た = await W.ボタンを試す(part, /部屋を出る/, { 名: '部屋を出る（確認が出たら やめる）' });
        if (!出た.確認あり) await W.参加者が戻る();
        const 大出た = await W.ボタンを試す(big, /部屋を出る/, { 名: '大画面：部屋を出る（確認が出たら やめる）' });
        if (!大出た.確認あり) await W.大画面が戻る();
      },
      async もう一回() {
        await W.手順を('進行役', '結果：つぎは？', '押す', () => W.click(host, '#qzAgainBtn'),
          { 待ち: { 種類: '演出待ち', 何を: 'つぎは？の画面', until: () => W.画面は(host, 'scr-next') }, 間: 700 });
        W.終わり方を('つぎは？の選択肢', await W.ボタン一覧(host));
        await W.手順を('進行役', 'つぎは？：もう一度（さっきと同じ設定でそのまま）', '押す', () => W.press(host, /^もう一度/), { 間: 1200 });
        await W.準備OKまで(part);
        await W.準備OKまで(host);
        await W.待つ('参加者', '2回目の3-2-1', '他の人待ち', () => part.until("!!document.querySelector('.fx-countdown') || ((document.querySelector('.screen.active')||{}).id==='scr-rt-quiz' && !(" + 終わった式 + "))", 20000), { 間: 800 });
      }
    });
  }
};
