// tools/flow-walk/rcard.js — ロシアンカードを、部屋（QR参加）で最後まで通す（指示62 第1部）
//
// 遊び方：モード画面で最初に選ばれているもの（＝「ロシアンカード」生き残り戦）。
// 「いっきうち」（2人まで）は4人の部屋でも閉じられていない——部屋では人数で止めない作り
// （index.html modeLockReason のコメント）。並びはメモ書きに残す。設定は何も変えない。
// 4人＝2組の生き残り戦 → 勝った2人の決勝 → 最後の1人。
//
// 人の役（参加者）と進行役は、**本物の画面の札を本物のタップで押す**：
//   しかける … 相手の9まいから、言われた数をランダムにえらび「しかける ▶」
//   めくる   … 自分の番なら、まだ伏せてある札を1まいランダムに押す
// bot 2人は tools/bot-play/rcard.js（同じ考え方・考える間 2.5〜5.5秒・1つの番に1まい）。
// どの組に入るか・誰が勝ち残るかは運なので、**負けた人の画面（観戦）も撮れる**ことが多い。

/** 手元の画面から、いま何をする場面かを読む（DOM だけを見る） */
const 状態式 = "(function(){" +
  "var cv=typeof Element.prototype.checkVisibility==='function';" +
  "function shown(e){if(!e)return false;var r=e.getBoundingClientRect();if(r.width<1||r.height<1)return false;return cv?e.checkVisibility({opacityProperty:true,visibilityProperty:true}):true;}" +
  "function tx(id){var e=document.getElementById(id);return e&&shown(e)?e.innerText.trim().replace(/\\s+/g,' '):'';}" +
  "var s=(document.querySelector('.screen.active')||{}).id||null;var o={画面:s,題:'',案内:'',注:'',押せる札:[],ボタン:false,対戦:''};" +
  "if(s==='scr-rt-rc-place'){o.題=tx('rcPlaceTitle');o.案内=tx('rcPlaceLead');o.注=tx('rcPlaceNote');" +
  " o.押せる札=Array.from(document.querySelectorAll('#rcPlaceBoard [data-rc-cell]')).filter(function(b){return !b.disabled&&shown(b);}).map(function(b){return +b.dataset.rcCell;});" +
  " var d=document.getElementById('rcPlaceDoneBtn');o.ボタン=!!d&&shown(d);o.ボタン押せる=!!d&&shown(d)&&!d.disabled;}" +
  "if(s==='scr-rt-rc-play'){o.題=tx('rcPlayTitle');o.案内=tx('rcPlayLead');o.対戦=tx('rcPlayVs');o.ほか=tx('rcPlayOthers');" +
  " o.押せる札=Array.from(document.querySelectorAll('#rcPlayBoard [data-rc-cell]')).filter(function(b){return !b.disabled&&shown(b);}).map(function(b){return +b.dataset.rcCell;});" +
  " o.めくった=document.querySelectorAll('#rcPlayBoard .rc-card:disabled').length;}" +
  "var nl=document.querySelector('.screen.active .now-line');o.今=nl&&shown(nl)?nl.innerText.trim().replace(/\\s+/g,' '):'';" +
  "o.祝い=!!document.querySelector('.fx-cel,.fx-shutter,.fx-blackout');" +
  "o.縁=!!document.querySelector('.fx-edge');" +
  "return o;})()";

const 大画面式 = "(function(){function t(id){var e=document.getElementById(id);return e?e.innerText.trim().replace(/\\s+/g,' '):'';}" +
  "return {画面:(document.querySelector('.screen.active')||{}).id, 段階:t('bigPhase'), 主:t('bigMain'), 副:t('bigSub'), 名簿:t('bigList').slice(0,200)};})()";

/** ランダムに n 個（人が適当にえらぶ手） */
function いくつか(list, n) {
  const 残り = list.slice(), 出 = [];
  for (let i = 0; i < n && 残り.length; i++) 出.push(残り.splice(Math.floor(Math.random() * 残り.length), 1)[0]);
  return 出;
}

module.exports = {
  way: 'room',
  async run(W) {
    const { host, part, big } = W;
    const 人 = [part, host];

    await W.進行役が部屋をつくる('rcard', 'ロシアンカード');
    await W.手順を('進行役', '待合：QRをみんなに見せる', '見せる', null);
    await W.参加者がQRで入る('ひろ');
    await W.大画面が入る();
    await W.botを入れる(2);
    await W.手順を('全員', 'bot 2人が入った（4人そろう）', '待つ', null);

    // ---- 進行役：ゲームをえらぶ（参加者はその間、待合で何を見ているか＝この間の手順の参加者の画像） ----
    await W.手順を('進行役', '待合：ゲームをえらぶ', '押す', () => W.click(host, '#rtPickGameBtn'),
      { 待ち: { 種類: '演出待ち', 何を: '棚', until: () => W.画面は(host, 'scr-shelf') }, 間: 800 });
    // モード画面で何がえらべて、何が閉じているかを残す（いっきうちは2人まで）
    await W.設定を進める({
      cassetteId: 'rcard', 名: 'ロシアンカード',
      handlers: {
        'scr-mode': async () => {
          const 一覧 = await host.ev("Array.from(document.querySelectorAll('#modeCards .mode-card')).map(function(c){return {id:c.dataset.id, 題:(c.querySelector('.m-title')||{}).textContent, 選ばれ:c.classList.contains('selected'), 閉じ:c.classList.contains('locked')||c.classList.contains('disabled')||c.getAttribute('aria-disabled')==='true', 字:c.innerText.replace(/\\s+/g,' ').trim().slice(0,80)};})");
          W.メモ書き.push('モード画面の並び：' + JSON.stringify(一覧));
          return false;   // 押すのは既定に任せる（何も変えない）
        },
        'scr-set-rcard': async () => {
          const 既定 = await host.ev("(function(){function on(id){var b=document.querySelector('#'+id+' .on');return b?b.innerText.trim():null;}return {体力:on('rcLivesSeg'),爆弾:on('rcBombsSeg'),持ち時間:on('rcTurnSeg'),注1:(document.getElementById('rcFinalNote')||{}).innerText,注2:(document.getElementById('rcCfgNote')||{}).innerText};})()");
          W.メモ書き.push('設定の既定（変えずに進む）：' + JSON.stringify(既定));
          return false;
        }
      }
    });
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
    const cdHost = await host.ev(吹き出しを見る);
    W.メモ('カウントダウン中の吹き出し：参加者 ' + JSON.stringify(cd) + ' ／ 進行役 ' + JSON.stringify(cdHost) + '（ロシアンカードはチュートリアルの台本を持たない＝tutScriptFor が bomb 以外は null）');
    if ((cd.吹き出し && cd.数字) || (cdHost.吹き出し && cdHost.数字)) W.気づいた('困る', 'カウントダウンの数字が出ている最中に、チュートリアルの吹き出しが出ている（1-3 再現）', 'scr-rt-rc-place');
    await W.待つ('参加者', '盤が出る（しかける画面）', '演出待ち',
      () => part.until("!document.querySelector('.fx-countdown') && (document.querySelector('.screen.active')||{}).id==='scr-rt-rc-place' && document.querySelectorAll('#rcPlaceBoard [data-rc-cell]').length>0", 20000), { 間: 600 });

    // ---- 遊ぶ ----
    const 回数 = { しかけた: 0, めくった: 0, 待った: {} };
    const 署名 = async () => {
      const a = await part.ev(状態式), b = await host.ev(状態式);
      return { a, b, k: JSON.stringify([a.画面, a.題, a.案内, a.押せる札.length, a.めくった, b.画面, b.題, b.案内, b.押せる札.length, b.めくった]) };
    };
    let 見た大画面 = {};
    const 置く場面 = { 参加者: 0, 進行役: 0 }, 置いた場面 = { 参加者: -1, 進行役: -1 }, 前の画面 = { 参加者: null, 進行役: null };
    const めくり済み = { 参加者: false, 進行役: false };   // この番でもうめくったか（めくる画面の題が変わるまで）
    const 一度だけ = {};
    const 気づく = (鍵, 重さ, 何が, どこ) => { if (一度だけ[鍵]) return; 一度だけ[鍵] = true; W.気づいた(重さ, 何が, どこ); };
    let 二度押し試した = false;
    for (let i = 0; i < 400; i++) {
      const now = await 署名();
      if (now.a.画面 === 'scr-rt-rc-result' || now.b.画面 === 'scr-rt-rc-result') break;
      // 大画面と手元が食い違っていないか（f）：毎回見る（しかける段階は人が先に押すので、待ちの枝を通らないことがある）
      const 大 = await big.ev(大画面式);
      if (/しかける/.test(大.段階 || '') && /めくります/.test(大.副 || '')) 気づく('大画面しかける中のめくります', '気になる', '大画面は段階「' + 大.段階 + '」なのに、副題が「' + 大.副 + '」（まだ誰もめくらない。手元は「爆弾をしかける」）', 'scr-rt-big');
      // ---- 押す前に、2台そろって「見るだけ」の確かめをする（押す人が先に動くと、相手の場面が過ぎてしまう） ----
      for (const [名, st] of [['参加者', now.a], ['進行役', now.b]]) {
        if (st.画面 === 'scr-rt-rc-place' && 前の画面[名] !== 'scr-rt-rc-place') 置く場面[名]++;
        前の画面[名] = st.画面;
        if (st.画面 !== 'scr-rt-rc-play' || st.題 !== 'カードをめくる') めくり済み[名] = false;
        // しかけていないのに「しかけました」と出ていないか（負けて組から外れた人）
        if (st.画面 === 'scr-rt-rc-place' && /しかけました/.test(st.題) && 置いた場面[名] !== 置く場面[名] && !一度だけ['見た:' + 名 + ':' + 置く場面[名]]) {
          一度だけ['見た:' + 名 + ':' + 置く場面[名]] = true;
          await W.手順を(名, 'しかける画面（この回はしかけていない）：「' + st.題 + '：' + st.案内 + '」', '見る', null, { 間: 200 });
          気づく('負けた人のしかけました:' + 名, '困る', 名 + 'はこの回しかけていない（負けて組に入っていない）のに、しかける画面に「' + st.題 + '」「' + st.案内 + '」「' + st.注 + '」と出る', 'scr-rt-rc-place');
        }
        // 帯（now-line）の名前が抜けていないか
        if (/^さんが/.test(st.今 || '')) 気づく('帯の名前が空:' + 名, '気になる', 名 + 'の画面の帯が「' + st.今 + '」——だれの名前も入っていない（自分の組の勝負が終わった人の画面。勝って待っている人も、負けた人も）', st.画面);
      }
      let した = false;
      for (const dev of 人) {
        const st = await dev.ev(状態式);   // 同じ回の中で先の人が押したあとの姿で読む
        const 名 = dev.name;
        // しかける
        // 案内に数が出るまで（＝本人の秘密が部屋に追いつくまで・落とし穴18）は押さない
        const 数 = /(\d+)つえらんで/.exec(st.案内 || '');
        if (st.画面 === 'scr-rt-rc-place' && st.ボタン && st.押せる札.length && 数) {
          const n = parseInt(数[1], 10);
          const 選ぶ = いくつか(st.押せる札, n);
          回数.しかけた++;
          await W.手順を(名, '爆弾をしかける：' + n + 'まいえらぶ（' + 選ぶ.join('・') + 'ばん）', '押す', async () => {
            for (const no of 選ぶ) { await W.tap(dev, '#rcPlaceBoard [data-rc-cell="' + no + '"]'); await W.sleep(450); }
          }, { 間: 300, 撮らない: 回数.しかけた > 4 });
          await W.手順を(名, '「しかける ▶」を押す', '押す', async () => {
            await W.tap(dev, '#rcPlaceDoneBtn');
          }, { 待ち: { 種類: '通信待ち', 何を: 'しかけた知らせ', until: () => dev.until("(function(){var d=document.getElementById('rcPlaceDoneBtn');return !d||d.style.display==='none'||(document.querySelector('.screen.active')||{}).id!=='scr-rt-rc-place';})()", 8000) }, 間: 300, 撮らない: 回数.しかけた > 4 });
          置いた場面[名] = 置く場面[名];
          した = true;
          continue;
        }
        // めくる（自分の番）。**1つの番に1まい**——ふつうの人は、めくったら結果を待つ
        if (st.画面 === 'scr-rt-rc-play' && st.押せる札.length && !めくり済み[名]) {
          const no = st.押せる札[Math.floor(Math.random() * st.押せる札.length)];
          回数.めくった++;
          await W.手順を(名, 'じぶんの番：カードを1まいめくる（' + no + 'ばん）', '押す', async () => {
            await W.sleep(1200);   // 人が9まいを見て決める間
            await W.tap(dev, '#rcPlayBoard [data-rc-cell="' + no + '"]');
          }, { 待ち: { 種類: '通信待ち', 何を: 'めくった結果', until: () => dev.until("(function(){var t=(document.getElementById('rcPlayTitle')||{}).textContent||'';return t!=='カードをめくる'||(document.querySelector('.screen.active')||{}).id!=='scr-rt-rc-play';})()", 2500).catch(() => true) }, 間: 300, 撮らない: 回数.めくった > 4 && 回数.めくった % 5 !== 0 });
          const 後 = await dev.ev(状態式);
          W.メモ('めくったあと：' + 後.題 + '／' + 後.案内 + (後.縁 ? '（縁が光っている）' : '') + '・まだ押せる札 ' + 後.押せる札.length + 'まい');
          めくり済み[名] = true;
          if (後.画面 === 'scr-rt-rc-play' && 後.題 === 'カードをめくる' && 後.押せる札.length) {
            気づく('めくったあと', '困る', 'めくったあとも、ほかの組がめくり終わるまで題が「カードをめくる」・案内が「' + 後.案内 + '」のままで、残りの札も押せる（待っていることが出ない）', 'scr-rt-rc-play');
            // **迷った人の手を1回だけ試す**：題が「カードをめくる」のままなので、もう1まい押す
            if (!二度押し試した) {
              二度押し試した = true;
              const no2 = 後.押せる札[Math.floor(Math.random() * 後.押せる札.length)];
              const 前の枚数 = 後.めくった;
              await W.手順を(名, '確かめ：題が「カードをめくる」のままなので、同じ番にもう1まい押してみる（' + no2 + 'ばん）', '押す', async () => {
                await W.tap(dev, '#rcPlayBoard [data-rc-cell="' + no2 + '"]');
                await W.sleep(900);
              }, { 間: 200 });
              const 後2 = await dev.ev(状態式);
              // ※「めくった」は押せない札の数なので、押した拍子に段階が「けっか」へ移ると9になる。
              //   受けたかどうかの本当の根拠は、撮った盤（同じ番に2まいがひらいている）の方
              const 受けた = 後2.めくった > 前の枚数;
              W.メモ('2まい目：めくられた札 ' + 前の枚数 + ' → ' + 後2.めくった + 'まい（' + (受けた ? 'サーバーが受けた' : '受けなかった') + '）・題「' + 後2.題 + '」');
              if (受けた) 気づく('二度めくれる', '遊べなくなる', '同じ番に2まい目も押せて、サーバーがそのまま受ける（rcard-room.js flipCard が m.acted を見ていない）。1つの番に何まいでもめくれるので、ルールが崩れる', 'scr-rt-rc-play');
            }
          }
          した = true;
          continue;
        }
      }
      if (した) continue;

      // ---- だれも押すものが無い：何を待っているかを、画面の言葉で残す ----
      const bv = await big.ev(大画面式);
      const 題 = now.a.題 || now.a.画面;
      // 大画面と手元が食い違っていないか（f）：しかける段階なのに、大画面の副題が「〇〇 がめくります」
      if (/しかける/.test(bv.段階 || '') && /めくります/.test(bv.副 || '')) 気づく('大画面しかける中のめくります', '気になる', '大画面は段階「' + bv.段階 + '」なのに、副題が「' + bv.副 + '」（まだ誰もめくらない。手元は「しかける」「ほかの人を待っています」）', 'scr-rt-big');
      if (/生きのこり/.test(bv.段階 || '')) {
        [['参加者', now.a], ['進行役', now.b]].forEach(([k, x]) => {
          if (x.画面 === 'scr-rt-rc-play' && x.題 === 'あいての番') 気づく('生きのこりであいての番:' + k, '気になる', '回の終わり（大画面は「生きのこり」）なのに、' + k + 'の題が「あいての番」のまま（だれの番でもない）', 'scr-rt-rc-play');
        });
      }
      // 大画面の段階名は RT_PHASE_LABEL（show='けっか'・round='生きのこり'）。見せるための間は演出待ち
      const 種類 = (/けっか/.test(題) || /けっか|生きのこり|決着/.test(bv.段階 || '')) ? '演出待ち' : '他の人待ち';
      const 名 = '参加者「' + 題 + (now.a.案内 ? '：' + now.a.案内 : '') + '」／進行役「' + (now.b.題 || now.b.画面) + (now.b.案内 ? '：' + now.b.案内 : '') + '」／大画面「' + bv.段階 + '・' + bv.主 + '」';
      回数.待った[名] = (回数.待った[名] || 0) + 1;
      const 新しい大画面 = !見た大画面[bv.段階 + bv.主];
      見た大画面[bv.段階 + bv.主] = true;
      await W.待つ('参加者', 名, 種類, async () => {
        const t0 = Date.now();
        for (;;) {
          const x = await 署名();
          if (x.k !== now.k) return true;
          if (Date.now() - t0 > 40000) throw new Error('40秒たっても画面が変わりません：' + 名);
          await W.sleep(150);
        }
      }, { 間: 150, 撮らない: 回数.待った[名] > 2 && !新しい大画面 });
    }
    W.メモ書き.push('遊んだ回数：' + JSON.stringify({ しかけた: 回数.しかけた, めくった: 回数.めくった }));

    // ---- 決着 ----
    await W.待つ('参加者', '決着の演出', '演出待ち', () => part.until("(document.querySelector('.screen.active')||{}).id==='scr-rt-rc-result' || !!document.querySelector('.fx-cel')", 30000), { 間: 100 });
    if (await part.ev("!!document.querySelector('.fx-cel,.fx-shutter,.fx-blackout')")) {
      await W.手順を('参加者', '決着の演出（出ている最中）', '見る', null, { 間: 300 });
    }
    await W.待つ('参加者', '結果', '演出待ち', () => part.until("!document.querySelector('.fx-blackout,.fx-cel,.fx-shutter') && (document.querySelector('.screen.active')||{}).id==='scr-rt-rc-result'", 30000), { 間: 900 });
    await host.until("(document.querySelector('.screen.active')||{}).id==='scr-rt-rc-result'", 15000, '進行役の結果').catch(() => {});
    await W.手順を('全員', '結果（3台）', '見る', null, { 間: 600 });
    W.メモ('しかけた ' + 回数.しかけた + '回・めくった ' + 回数.めくった + '回（人の役＋進行役）');
    const 称号 = await part.ev("!!document.querySelector('#titleGotOverlay.show')");
    if (称号) W.メモ('参加者に称号の幕が出ている');
    const 称号h = await host.ev("!!document.querySelector('#titleGotOverlay.show')");
    if (称号h) W.メモ('進行役に称号の幕が出ている');

    // ---- 終わり方：ボタン・放置・行き先・もう1回 ----
    await W.結果のあと({
      async 試す() {
        // 称号の幕：大きい方（すぐ着ける）は参加者で、小さい方（あとで）は進行役で試す。
        // 進行役に幕が無い回は、参加者の「すぐ着ける」だけ（幕は1回しか閉じられない）
        const 幕あり = { 参加者: await W.ボタンあり(part, /^すぐ着ける/), 進行役: await W.ボタンあり(host, /^あとで/) };
        if (幕あり.参加者) await W.ボタンを試す(part, /^すぐ着ける/, { 名: '称号の幕：すぐ着ける' });
        if (幕あり.進行役) await W.ボタンを試す(host, /^あとで/, { 名: '称号の幕：あとで' });
        for (const dev of [part, host]) {   // まだ幕が残っていたら（押した先で閉じなかったら）あとでで閉じる
          if (await W.ボタンあり(dev, /^あとで/)) await W.ボタンを試す(dev, /^あとで/, { 名: '称号の幕：あとで（残っていたので）' });
        }
        // 画面のすみの丸いボタン（👥 みんなの状況・🎁 ありがとう・⚙ 設定）。開いて、✕で閉じる。
        // 反応（👏😂😮❤️🔥）の並びは除く
        const 閉じる = async (d) => {
          const ok = await d.ev("(function(){var x=Array.from(document.querySelectorAll('.overlay.show .close-x')).filter(function(b){return b.getBoundingClientRect().width>0;}).pop(); if(!x) return false; x.click(); return true;})()");
          if (!ok) await W.pressIf(d, /^✕$|^とじる$|^もどる$|^←$/);
        };
        for (const dev of [part, host, big]) {
          for (const [re, 名] of [[/^👥$/, '👥（みんなの状況）'], [/^🎁$/, '🎁（ありがとうを贈る）'], [/^⚙$/, '⚙（設定）']]) {
            if (await W.ボタンあり(dev, re)) await W.ボタンを試す(dev, re, { 名, 戻す: 閉じる });
          }
        }
        // 大画面の「プレイヤーにもどる」は押さない：押すと大画面が5人目のプレイヤーになり、
        // 準備OKの数が変わって「もう一回」の通しが別物になる
        if (await W.ボタンあり(big, /プレイヤーにもどる/)) W.メモ('大画面の結果に「プレイヤーにもどる」が見えている（押していない：押すと大画面が遊ぶ人に変わる）');
        await W.ボタンを試す(host, /部屋をとじる/, { 名: '部屋をとじる（確認が出たら やめる）' });
        // 進行役の「← 部屋を出る」は押さない（お手本 bakudan と同じ）。押すと進行役が名簿から消え、
        // 進行役の役目がほかの人へ移る（realtime.js ensureHost）ので、このあとの「もう一回」を進行役で通せない。
        // 同じボタンは参加者の側で押して行き先を記録する（どちらも [id$="LeaveBtn"] の rtLeaveRoom 1本）
        if (await W.ボタンあり(host, /部屋を出る/)) W.メモ('進行役の結果にも「← 部屋を出る」が見えている（押していない：押すと進行役が移り、もう一回を通せない）');
        // 出る系は最後に。確認なしで出てしまったら、QRを読み直して戻る（その道も手順に残す）
        const 出た = await W.ボタンを試す(part, /部屋を出る/, { 名: '部屋を出る（確認が出たら やめる）' });
        if (!出た.確認あり) await W.参加者が戻る();
        if (await W.ボタンあり(big, /部屋を出る|出る/)) {
          const 大出た = await W.ボタンを試す(big, /部屋を出る|出る/, { 名: '大画面：部屋を出る（確認が出たら やめる）' });
          if (!大出た.確認あり) await W.大画面が戻る();
        } else {
          W.メモ('大画面の結果には、押せるボタンが無い');
        }
        // 戻った参加者が、いまどの画面にいるか
        W.終わり方を('戻った参加者の画面', await part.screen());
      },
      async もう一回() {
        await W.手順を('進行役', '結果：つぎは？', '押す', () => W.press(host, /^つぎは？/),
          { 待ち: { 種類: '演出待ち', 何を: 'つぎは？の画面', until: () => W.画面は(host, 'scr-next') }, 間: 700 });
        W.終わり方を('つぎは？の選択肢', await W.ボタン一覧(host));
        await W.手順を('進行役', 'つぎは？：もう一度（さっきと同じ設定でそのまま）', '押す', () => W.press(host, /^もう一度/), { 間: 1200 });
        await W.準備OKまで(part);
        await W.準備OKまで(host);
        await W.待つ('参加者', '2回目の3-2-1', '他の人待ち', () => part.until("!!document.querySelector('.fx-countdown') || (document.querySelector('.screen.active')||{}).id==='scr-rt-rc-place'", 20000), { 間: 800 });
      }
    });
  }
};
