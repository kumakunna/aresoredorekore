// tools/flow-walk/auction.js — オークションを、部屋（QR参加）で最後まで通す（指示62 第1部）
//
// 遊び方：棚で最初に選ばれているモードのまま（設定は何も変えない）。どれになったかは W.モードを が残す。
// 人の役（参加者）と進行役は、**本物の画面のボタン**で遊ぶ：
//   ・下見：「🎒 アイテムをえらぶ」→ 1つ選ぶ →（鑑定眼なら）「← 品物を見にもどる」→ 棚の品を押す → 「鑑定する」
//   ・競り：品ごとに「ここまでなら出す」上限を決めておき、せり上げ式なら +1 を、秘密入札なら +1/+3 を押す。
//          上限0の品は何もしない（誰も値をつけなければ「見送る」を押す）
//   ・値踏み：落札しなかった品は、上物／並物／偽物のどれかを押す
//   ・開示：見るだけ
// 人の役の上限は、1ラウンド目の3品目と2ラウンド目の1品目を 8〜9 にしてある（bot の上限は6まで）。
// **必ず1つは落札して、「自分が落札した品」の値踏み画面と、半額チケットを持って落札した時の支払いを撮る。**
// bot 2人は tools/bot-play/auction.js。
//
// 同じことの繰り返し（競りの待ち・開示）は、最初の数回だけ撮り、あとは 撮らない:true で数だけ残す。

const 参加者の名前 = 'ひろ';

// 品ごとの「ここまでなら出す」上限（ラウンド→その回で何番目に競りに出たか→上限）。書いていない品は0＝出さない
const 計画 = {
  参加者: { アイテム: { 1: 'appraise', 2: 'halfticket' }, 上限: { 1: { 1: 3, 3: 8, 5: 2 }, 2: { 1: 9, 4: 2 } } },
  進行役: { アイテム: { 1: 'market', 2: 'appraise' }, 上限: { 1: { 2: 4, 4: 2 }, 2: { 3: 3 } } }
};
const 品質の順 = ['fine', 'plain', 'fake'];

// 画面から、いまの状況を読む（中の状態ではなく、人が見ているものから）
const 見る式 = `(function(){
  var scr=(document.querySelector('.screen.active')||{}).id||null;
  function t(id){var e=document.getElementById(id);return e?(e.innerText||'').replace(/\\s+/g,' ').trim():'';}
  function vis(e){if(!e)return false;var r=e.getBoundingClientRect();return r.width>0&&r.height>0;}
  var o={scr:scr, 幕:!!Array.from(document.querySelectorAll('.ui-layer')).filter(vis).length, cd:!!document.querySelector('.fx-countdown')};
  if(scr==='scr-rt-au-open'){o.chips=t('auOpenChips');o.note=t('auOpenNote');o.power=vis(document.getElementById('auOpenPower'))?t('auOpenPower'):'';o.btn=t('auPowerBtn');
    o.cards=document.querySelectorAll('#auOpenShelf .mk-card').length;o.seen=document.querySelectorAll('#auOpenShelf .mk-card.seen').length;o.shelf=t('auOpenShelf');}
  if(scr==='scr-rt-au-power'){var on=document.querySelector('#auPwList .apw.on');o.on=on?on.dataset.power:null;o.note=t('auPwNote');}
  if(scr==='scr-rt-au-bid'){o.spot=t('auBidSpot');o.high=t('auBidHighest');o.chips=parseInt(t('auBidChips'),10);o.note=t('auBidNote');
    o.pass=!!document.querySelector('#auBidPad [data-aupass]');
    o.bids=Array.from(document.querySelectorAll('#auBidPad [data-aubid]')).map(function(b){return {a:+b.dataset.aubid,d:!!b.disabled};});
    o.hints=t('auBidHints');}
  if(scr==='scr-rt-au-guess'){o.spot=t('auGsSpot');o.lead=t('auGsLead');o.can=document.querySelectorAll('#auGsPad [data-auguess]').length;
    var g=document.querySelector('#auGsPad .agq.on');o.mine=g?g.dataset.auguess:null;o.note=t('auGsNote');}
  if(scr==='scr-rt-au-reveal'){o.spot=t('auRvSpot');o.q=t('auRvQuality');o.text=t('auRvText');o.pts=t('auRvPoints');o.note=t('auRvNote');o.gs=t('auRvGuesses');}
  if(scr==='scr-rt-au-result'){o.rank=t('auRsRank');o.hl=t('auRsHighlight');}
  if(scr==='scr-rt-big'){o.phase=t('bigPhase');o.main=t('bigMain');o.sub=t('bigSub');}
  return o;})()`;

/** 状況が変わったかを見る鍵（時計の数字は入れない） */
function 鍵(o) {
  if (!o) return '';
  // 値踏みの一言（「いま N人が出しました」）は bot が出すたびに変わるが、待つものは同じ（締め切り）なので入れない
  return [o.scr, o.幕 ? '幕' : '', o.cd ? 'cd' : '', o.scr === 'scr-rt-au-guess' ? '' : (o.note || ''), o.power || '', o.on || '', o.spot || '', o.high || '',
    o.pass ? 'pass' : '', o.mine || '', o.can || '', o.lead || '', o.seen || ''].join('|');
}

function 新しい追跡() { return { 回: 0, ラウンド: 0, 前の画面: null, 前の品: null, 見た: {}, 見送った: {}, 出した: {}, 落札: [], 押した額: {} }; }

module.exports = {
  way: 'room',
  async run(W) {
    const { host, part, big } = W;
    await W.進行役が部屋をつくる('auction', 'オークション');
    W.進行役の名前 = await host.ev("(document.getElementById('rtCreateName')||{}).value||''");
    await W.手順を('進行役', '待合：QRをみんなに見せる', '見せる', null);
    await W.参加者がQRで入る(参加者の名前);
    await W.大画面が入る();
    await W.botを入れる(2);
    await W.手順を('全員', 'bot 2人が入った（4人そろう）', '待つ', null);
    // 参加者の待合：入った直後は QR と部屋コードが画面を占める。下まで送ると何が見えるか（いま何を待っているか）
    await W.手順を('参加者', '待合：下までスクロールして見る', 'スクロール', () => part.ev("(function(){var s=document.querySelector('.screen.active');var e=s&&(s.querySelector('#rtWaitNote')||s.lastElementChild);if(e) e.scrollIntoView({block:'end'});window.scrollTo(0,document.body.scrollHeight);return true;})()"), { 間: 500 });

    // ---- 進行役：ゲームをえらぶ ----
    await W.手順を('進行役', '待合：ゲームをえらぶ', '押す', () => W.click(host, '#rtPickGameBtn'),
      { 待ち: { 種類: '演出待ち', 何を: '棚', until: () => W.画面は(host, 'scr-shelf') }, 間: 800 });
    await W.設定を進める({ cassetteId: 'auction', 名: 'オークション' });
    await W.手順を('進行役', '待合に戻った（ゲームが決まった）', '見る', null);

    // ---- 準備OK：参加者 → 進行役 ----
    await W.準備OKまで(part);
    await W.準備OKまで(host);

    await 始まりの合図(W, '');
    await 遊ぶ(W, 1);

    // ---- 決着 ----
    await W.待つ('参加者', '結果', '演出待ち', () => part.until("(document.querySelector('.screen.active')||{}).id==='scr-rt-au-result' && !document.querySelector('.fx-blackout,.fx-cel,.fx-shutter')", 30000), { 間: 900 });
    const 称号 = await part.ev("(function(){var o=document.querySelector('#titleGotOverlay.show');return o?o.innerText.replace(/\\s+/g,' ').trim():null;})()");
    if (称号) {
      W.メモ('参加者に称号の幕が出ている：' + 称号.slice(0, 200));
      // 1-3：季節イベント「リリース記念」（titles.js・9/24〜10/24）が今も出ているか。見るだけ
      W.メモ書き.push({ '1-3 リリース記念': /リリース記念/.test(称号) ? '出ている（参加者の称号の幕：' + 称号.slice(0, 120) + '）' : '出ていない（称号の幕：' + 称号.slice(0, 80) + '）', 手順: W.手順.length });
    }
    const 結果の字 = {};
    for (const [k, d] of [['参加者', part], ['進行役', host], ['大画面', big]]) 結果の字[k] = await d.ev(見る式);
    W.メモ('結果の画面：' + JSON.stringify(結果の字).slice(0, 600));
    // 参加者の結果画面に「進行役が次を選ぶ」ことが出ているか（物差し c）
    const 待ちの字 = await part.ev("(function(){var s=document.querySelector('.screen.active');return s?/進行役|つぎ|待/.test(s.innerText):false;})()");
    W.メモ('参加者の結果画面に「進行役が次をえらぶ／待つ」の字：' + (待ちの字 ? 'ある' : '無い'));

    // ---- 終わり方：ボタン・放置・行き先・もう1回 ----
    await W.結果のあと({
      async 試す() {
        // 称号の幕：ふつうの人が押すのは大きい方（すぐ着ける）。幕を閉じるので、どちらか1つしか試せない
        if (await W.ボタンあり(part, /^すぐ着ける$/)) await W.ボタンを試す(part, /^すぐ着ける$/, { 名: '称号の幕：すぐ着ける' });
        if (await W.ボタンあり(host, /^あとで/)) await W.ボタンを試す(host, /^あとで/, { 名: '称号の幕：あとで' });
        // 結果で見えている小さなボタン（⚙・👥・🎁 など）も、全部行き先を見る。反応ボタンの並びは除く。
        // 出る・とじる・つぎは？ はこのあと別に試す
        const 除く = /^(👏|😂|😮|❤️|🔥|つぎは？.*|.*部屋をとじる|← 部屋を出る|部屋を出る|すぐ着ける|あとで.*|プレイヤーにもどる)$/;
        for (const [dev, nm] of [[part, '参加者'], [host, '進行役'], [big, '大画面']]) {
          const 一覧 = (await W.ボタン一覧(dev)).filter((t) => t && !除く.test(t));
          for (const t of 一覧) {
            const re = new RegExp('^' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$');
            if (!(await W.ボタンあり(dev, re))) continue;
            await W.ボタンを試す(dev, re, { 名: nm + '：' + t, 戻す: async (d) => { if (!(await W.pressIf(d, /^✕$/))) await W.pressIf(d, /^←$|とじる|もどる/); } });
          }
        }
        await W.ボタンを試す(host, /部屋をとじる/, { 名: '部屋をとじる（確認が出たら やめる）' });
        // 出る系は最後に。確認なしで出てしまったら、QRを読み直して戻る（その道も手順に残す）
        const 出た = await W.ボタンを試す(part, /部屋を出る/, { 名: '部屋を出る（確認が出たら やめる）' });
        if (!出た.確認あり) await W.参加者が戻る();
        // 指示64 D1：大画面の出口（部屋を出る・プレイヤーにもどる）は ⚙ の中。TVの画面にはボタンが無い
        const 大出た = await W.大画面の歯車を試す(big, /部屋を出る/, { 名: '大画面：⚙ → 部屋を出る（確認が出たら やめる）' });
        if (!大出た.確認あり && (await big.screen()) !== 'scr-rt-big') await W.大画面が戻る();
        // 大画面の「プレイヤーにもどる」：押すと大画面がその場で参加者の画面に変わる。最後に試して、出て入り直して戻す
        const r = await W.大画面の歯車を試す(big, /プレイヤーにもどる/, { 名: '大画面：⚙ → プレイヤーにもどる（確認が出たら やめる）' });
        if (!r.確認あり && (await big.screen()) !== 'scr-rt-big') {
          await W.手順を('大画面', '（戻すため）参加者になった大画面で「部屋を出る」', '押す', () => W.press(big, /部屋を出る/), { 間: 1200 });
          await W.大画面が戻る();
        }
      },
      async もう一回() {
        await W.手順を('進行役', '結果：つぎは？', '押す', () => W.press(host, /^つぎは/),
          { 待ち: { 種類: '演出待ち', 何を: 'つぎは？の画面', until: () => W.画面は(host, 'scr-next') }, 間: 700 });
        W.終わり方を('つぎは？の選択肢', await W.ボタン一覧(host));
        await W.手順を('進行役', 'つぎは？：もう一度（さっきと同じ設定でそのまま）', '押す', () => W.press(host, /^もう一度/), { 間: 1200 });
        // 待合の名簿に出る「姿（称号）」の字。前置きが「〜の」で終わる称号に、つなぎの「の」が重なっていないか
        const 名簿 = await host.ev("(function(){var s=document.querySelector('.screen.active');return s?s.innerText:'';})()");
        const 重なり = (名簿.match(/[^\n]*のの[^\n]*/g) || []);
        W.メモ('待合の名簿の称号：' + JSON.stringify(重なり));
        await W.手順を('進行役', '待合：名簿までスクロールして見る', 'スクロール', () => host.ev("(function(){var e=document.getElementById('rtMembers');if(e) e.scrollIntoView({block:'center'});return !!e;})()"), { 間: 500 });
        if (重なり.length) W.気づいた('気になる', '待合の名簿に「' + 重なり[0].trim() + '」と出る（前置き「〜の」＋つなぎ「の」で「のの」が重なる。titles.js の titleText がそのままつなぐ）', 'scr-rt-room');
        await W.準備OKまで(part);
        await W.準備OKまで(host);
        await W.待つ('参加者', '2回目の3-2-1', '他の人待ち', () => part.until("!!document.querySelector('.fx-countdown') || (document.querySelector('.screen.active')||{}).id==='scr-rt-au-open'", 20000), { 間: 800 });
      }
    });
  }
};

/** その画面のまま、その要素が見えていて押せる時だけ、本物のタップで押す（数える）。押せなければ false */
async function 押す(W, dev, scr, sel) {
  const ok = await dev.ev("(function(){var s=(document.querySelector('.screen.active')||{}).id;if(s!==" + JSON.stringify(scr) + ")return false;" +
    "var e=document.querySelector(" + JSON.stringify(sel) + ");if(!e||e.disabled)return false;var r=e.getBoundingClientRect();return r.width>0&&r.height>0;})()");
  if (!ok) return false;
  // 確かめてから押すまでの間に、部屋の知らせで札が描き直されることがある（bot の入札で +1 の額が変わる）
  try { await W.tap(dev, sel); } catch (e) { return false; }
  return true;
}

/** 3-2-1（.fx-countdown）が出ている最中に撮る。1-3：カウントダウン中に吹き出し .tut-say が出ていないか */
async function 始まりの合図(W, 名) {
  const { part } = W;
  await W.待つ('参加者', '3-2-1（始まりの合図）' + 名, '他の人待ち',
    () => part.until("!!document.querySelector('.fx-countdown')", 20000), { 間: 250 });
  const 吹き出しを見る = "(function(){var t=document.querySelector('.tut-say');var cd=!!document.querySelector('.fx-countdown');return {吹き出し: !!t && t.getBoundingClientRect().width>0 && getComputedStyle(t).opacity!=='0', 数字: cd};})()";
  await W.手順を('参加者', '3-2-1の途中', '見る', null, { 間: 900 });
  const cd = await part.ev(吹き出しを見る);
  W.メモ('カウントダウン中の吹き出し：' + JSON.stringify(cd));
  if (cd.吹き出し && cd.数字) W.気づいた('困る', 'カウントダウンの数字が出ている最中に、チュートリアルの吹き出しが出ている（1-3 再現）', 'scr-rt-au-open');
  await W.待つ('参加者', '開場の画面が出る', '演出待ち',
    () => part.until("(document.querySelector('.screen.active')||{}).id==='scr-rt-au-open' && !document.querySelector('.fx-countdown')", 15000), { 間: 600 });
}

/**
 * 遊ぶ：参加者と進行役の画面を交互に見て、することがあれば本物のボタンで押す。
 * どちらもすることが無ければ「何を待っているか」を分けて 1手順 として待つ。
 */
async function 遊ぶ(W) {
  const { host, part, big } = W;
  const 追跡 = { 参加者: 新しい追跡(), 進行役: 新しい追跡() };
  追跡.参加者.名前 = 参加者の名前;
  追跡.進行役.名前 = W.進行役の名前 || 'くま';
  const 数 = { 待ち: 0, 開示: 0, 競り: 0, 入札: 0, 値踏み: 0 };
  const 始め = Date.now();
  let 半額の確かめ = null;   // 半額チケットを持って落札した時の、入札額と払った額

  /** 画面を読んで、回・ラウンドの数を進める（その人の目で見た数） */
  function 数える(who, o) {
    const tr = 追跡[who];
    if (o.scr === 'scr-rt-au-open' && tr.前の画面 !== 'scr-rt-au-open' && tr.前の画面 !== 'scr-rt-au-power') { tr.ラウンド++; tr.回 = 0; }
    // 誰も値をつけずに流れた品が「もう一度」出た時：同じ品のまま、最後のひと押し（見送る）→ 競り に戻る
    const 出直し = o.scr === 'scr-rt-au-bid' && tr.前の画面 === 'scr-rt-au-bid' && o.spot === tr.前の品 &&
      tr.前のpass && !o.pass && /まだ値がついていません/.test(o.high || '');
    if (o.scr === 'scr-rt-au-bid' && (tr.前の画面 !== 'scr-rt-au-bid' || o.spot !== tr.前の品 || 出直し)) {
      tr.回++; tr.前の品 = o.spot;
      if (出直し) tr.出直し = Object.assign(tr.出直し || {}, { [回の鍵(tr)]: true });
    }
    tr.前のpass = !!o.pass;
    tr.前の画面 = o.scr;
    return tr;
  }
  const 回の鍵 = (tr) => tr.ラウンド + '-' + tr.回;
  const 上限 = (who, tr) => ((計画[who].上限[tr.ラウンド] || {})[tr.回]) || 0;

  /** その人が、いま何をするか（無ければ null）。純粋に決めるだけ（押すのは 実行） */
  function 決める(who, o, tr) {
    const 主 = who === '参加者';
    if (o.幕) return null;   // 確かめの幕は、押した手順の中で片付ける
    if (o.scr === 'scr-rt-au-open') {
      if (主 && !tr.見た['開場' + tr.ラウンド]) return { k: '開場を見る' };
      if (!o.power) return { k: 'アイテムの画面へ' };
      if (/調べたい品/.test(o.note) && o.seen === 0) return { k: '鑑定する' };
      return null;
    }
    if (o.scr === 'scr-rt-au-power') {
      if (!o.on) return { k: 'アイテムを選ぶ', p: 計画[who].アイテム[tr.ラウンド] || 'appraise' };
      return { k: '品物を見にもどる' };
    }
    if (o.scr === 'scr-rt-au-bid') {
      const k = 回の鍵(tr);
      if (主 && !tr.見た['品' + k]) return { k: '品を見る' };
      if (o.pass) return tr.見送った[k] ? null : { k: '見送る' };
      const max = 上限(who, tr);
      if (/こっそり|あなたの札/.test(o.high)) {   // 秘密入札
        if (tr.出した[k]) return null;
        return { k: '秘密入札', 額: max };
      }
      if (max <= 0) return null;
      if (tr.名前 && o.high.indexOf(tr.名前) !== -1) return null;   // いま自分が最高額
      const one = o.bids[0];
      if (!one || one.d || one.a > max) return null;
      // 半額チケットを持った2ラウンド目の1品目は、最初に +3 で飛び込む（払った額が半分になるかを、1枚ではなく見分けられる額で見る）
      const three = o.bids[1];
      if (who === '参加者' && tr.ラウンド === 2 && tr.回 === 1 && tr.押した額[k] == null && three && !three.d && three.a <= max) return { k: '+1', 額: three.a, max, 段: 1 };
      return { k: '+1', 額: one.a, max, 段: 0 };
    }
    if (o.scr === 'scr-rt-au-guess') {
      const k = 回の鍵(tr);
      if (o.can && !o.mine) return { k: '値踏み' };
      if (!o.can && /落札しました/.test(o.lead) && !tr.見た['落札' + k]) return { k: '落札した品の値踏み画面' };
      return null;
    }
    if (o.scr === 'scr-rt-au-reveal') {
      const k = 回の鍵(tr);
      if (主 && !tr.見た['開示' + k]) return { k: '開示を見る' };
      return null;
    }
    return null;
  }

  async function 実行(who, dev, a, o, tr) {
    const k = 回の鍵(tr);
    const 主 = who === '参加者';
    // 決めてから押すまでに画面が変わっていたら、押さない（次の周でもう一度決める）
    if ((await dev.screen()) !== o.scr) return;
    if (a.k === '開場を見る') {
      tr.見た['開場' + tr.ラウンド] = true;
      await W.手順を(who, tr.ラウンド + 'ラウンド目の開場：6品を見くらべる', '見る', () => W.sleep(1200), {});
      return;
    }
    if (a.k === 'アイテムの画面へ') {
      await W.手順を(who, '開場：「' + (o.btn || 'アイテムをえらぶ') + '」', '押す', () => 押す(W, dev, 'scr-rt-au-open', '#auPowerBtn'),
        { 待ち: { 種類: '演出待ち', 何を: 'アイテムの画面', until: () => W.画面は(dev, 'scr-rt-au-power', 5000).catch(() => {}) }, 撮らない: !主 && tr.ラウンド > 1 });
      return;
    }
    if (a.k === 'アイテムを選ぶ') {
      const 名 = await dev.ev("(function(){var b=document.querySelector('#auPwList [data-power=\"" + a.p + "\"] .apt');return b?b.textContent:'';})()");
      await W.手順を(who, 'アイテム：「' + 名 + '」を選ぶ', '押す', async () => {
        await W.sleep(1500);   // 3つの説明を読む間
        await 押す(W, dev, 'scr-rt-au-power', '#auPwList [data-power="' + a.p + '"]');
      }, { 待ち: { 種類: '通信待ち', 何を: '選んだ印', until: () => dev.until("!!document.querySelector('#auPwList .apw.on') || (document.querySelector('.screen.active')||{}).id!=='scr-rt-au-power'", 5000).catch(() => {}) }, 撮らない: !主 && tr.ラウンド > 1 });
      if (a.p !== 'appraise') {
        // 半額チケット・相場操作を選んだ人の手元に「使う」口があるか（落とし穴21：選べるのに何も起きない）
        const 口 = await dev.ev("(function(){var s=document.querySelector('.screen.active');if(!s)return null;return Array.from(s.querySelectorAll('button')).filter(function(b){return b.getBoundingClientRect().width>0&&/使う|つかう/.test(b.innerText);}).map(function(b){return b.innerText.trim();});})()");
        W.メモ('「' + 名 + '」を選んだあと、画面に「使う」ボタン：' + JSON.stringify(口));
        const 今の画面 = await dev.screen();
        W.メモ書き.push({ 'アイテムの使う口': { who, 名, 画面: 今の画面, 使うボタン: 口, 手順: W.手順.length } });
        if (a.p === 'market' && 口 && !口.length) {
          W.気づいた('困る', '「相場操作」（説明：好きな系統の相場を、落札せずに+1する）を選んでも、系統を選んで使う口が画面に無い（選んだ直後の ' + 今の画面 + ' のボタンに「使う」が無い）', 'scr-rt-au-power');
        }
      }
      return;
    }
    if (a.k === '品物を見にもどる') {
      await W.手順を(who, 'アイテム：「← 品物を見にもどる」', '押す', () => 押す(W, dev, 'scr-rt-au-power', '#auPwBackBtn'),
        { 待ち: { 種類: '演出待ち', 何を: '開場の画面', until: () => W.画面は(dev, 'scr-rt-au-open', 5000).catch(() => {}) }, 撮らない: !主 && tr.ラウンド > 1 });
      if (await dev.screen() === 'scr-rt-au-open') {
        const 字 = await dev.ev("(function(){return {note:(document.getElementById('auOpenNote')||{}).innerText||'', power:(document.getElementById('auOpenPower')||{}).innerText||''};})()");
        W.メモ('開場にもどった画面：' + JSON.stringify(字));
      }
      return;
    }
    if (a.k === '鑑定する') {
      const no = 主 ? 3 : 5;
      await W.手順を(who, '棚の' + no + '番を押す（鑑定眼）', '押す', async () => {
        await W.sleep(800);
        await 押す(W, dev, 'scr-rt-au-open', '#auOpenShelf [data-no="' + no + '"]');
      }, { 待ち: { 種類: '演出待ち', 何を: '確かめの幕', until: () => dev.until("Array.from(document.querySelectorAll('.ui-layer')).some(function(x){return x.getBoundingClientRect().width>0;})", 4000).catch(() => {}) } });
      await W.手順を(who, '確かめ：「鑑定する」', '押す', () => W.pressIf(dev, /^鑑定する$/, '.ui-layer button'),
        { 待ち: { 種類: '通信待ち', 何を: '鑑定の結果', until: () => dev.until("document.querySelectorAll('#auOpenShelf .mk-card.seen').length>0", 5000).catch(() => {}) }, 間: 700 });
      const 見えた = await dev.ev("(function(){var c=document.querySelector('#auOpenShelf .mk-card.seen');return c?c.innerText.replace(/\\s+/g,' '):null;})()");
      W.メモ('鑑定した品：' + 見えた);
      if (主 && tr.ラウンド === 1 && !tr.選び直し) { tr.選び直し = true; await 選び直しを試す(dev); }
      return;
    }
    if (a.k === '品を見る') {
      tr.見た['品' + k] = true;
      数.競り++;
      const 出直し = !!(tr.出直し && tr.出直し[k]);
      await W.手順を(who, (出直し ? '流れた品がもう一度出た：' : tr.ラウンド + 'R ' + tr.回 + '品目の競り：') + (o.spot || '').slice(0, 20), '見る', () => W.sleep(700), { 撮らない: !出直し && 数.競り > 4 && !上限(who, tr), 間: 300 });
      if (出直し) {
        // 「もう一度だけ出ます」の一言が、手元と大画面のどこかに出ているか（AuctionLogic.TEXT.passedAgain）
        const 手元 = await dev.ev("(function(){var s=document.querySelector('.screen.active');return s?s.innerText.replace(/\\s+/g,' '):'';})()");
        const 大 = await big.ev("(function(){var s=document.querySelector('.screen.active');return s?s.innerText.replace(/\\s+/g,' '):'';})()");
        const 言った = /もう一度|流れ|値をつけませんでした/;
        W.メモ('流れた品が戻った瞬間の字：手元「' + 手元.slice(0, 160) + '」／大画面に「もう一度・流れ」：' + 言った.test(大));
        if (!言った.test(手元) && !言った.test(大)) {
          W.気づいた('困る', '誰も値をつけずに「見送る」でそろった品が、何の知らせもなく同じ品のまま競りに戻る（「この品は、次の品のあとにもう一度だけ出ます」の一言が手元にも大画面にも出ない）', 'scr-rt-au-bid');
        }
      }
      return;
    }
    if (a.k === '見送る') {
      tr.見送った[k] = true;
      await W.手順を(who, '最後のひと押し：「見送る」', '押す', async () => { await W.sleep(1200); await W.pressIf(dev, /^見送る$/, '#auBidPad button'); }, { 間: 600 });
      return;
    }
    if (a.k === '秘密入札') {
      tr.出した[k] = true;
      if (a.額 > 0) {
        // +3 と +1 を組み合わせて上限まで（押すたびに額が上書きされる）
        await W.手順を(who, '秘密入札：' + a.額 + '枚にする', '押す', async () => {
          await W.sleep(1500);
          let 今 = 0;
          for (let i = 0; i < 6 && 今 < a.額; i++) {
            const step = (a.額 - 今 >= 3) ? 3 : 1;
            const bs = await dev.ev("Array.from(document.querySelectorAll('#auBidPad [data-aubid]')).map(function(b){return +b.dataset.aubid;})");
            const target = bs[step === 3 ? 1 : 0];
            await W.click(dev, '#auBidPad [data-aubid="' + target + '"]');
            今 = target;
            await W.sleep(600);
          }
        }, { 撮らない: 数.入札++ > 3 });
      } else {
        await W.手順を(who, '秘密入札：降りる（額を指定 → 0）', '押す', async () => {
          await W.sleep(1200);
          await W.click(dev, '#auBidPad [data-auask]');
          await dev.until("!!document.querySelector('.ui-layer input')", 3000);
        }, { 撮らない: 数.入札 > 3 });
        await W.手順を(who, '「いくらで出しますか？」に 0 を入れて「出す」', '入力して押す', async () => {
          await W.type(dev, '.ui-layer input', '0');
          await W.press(dev, /^出す$/, '.ui-layer button');
        }, { 撮らない: 数.入札++ > 3, 間: 600 });
      }
      return;
    }
    if (a.k === '+1') {
      数.入札++;
      let 押した額 = null, 見送り = null;
      const rec = await W.手順を(who, '競り：「+1」を押す', '押す', async () => {
        await W.sleep(1300);   // 人が値を見て決める間
        // 考えている間に、ほかの人が値を上げていることがある。押す瞬間の札を読み直す
        const b = await dev.ev("(function(){var b=document.querySelectorAll('#auBidPad [data-aubid]')[" + (a.段 || 0) + "];var h=(document.getElementById('auBidHighest')||{}).innerText||'';var s=(document.querySelector('.screen.active')||{}).id;return b?{a:+b.dataset.aubid,d:!!b.disabled,h:h,s:s}:{s:s};})()");
        if (b.s !== 'scr-rt-au-bid' || b.a == null) { 見送り = '画面が変わった'; return; }
        if (b.h.indexOf(tr.名前) !== -1) { 見送り = 'いま自分が最高額'; return; }
        if (b.d || b.a > a.max) { 見送り = '先に値が上がって、上限（' + a.max + '枚）をこえた'; return; }
        if (await 押す(W, dev, 'scr-rt-au-bid', '#auBidPad [data-aubid="' + b.a + '"]')) 押した額 = b.a; else 見送り = '押す前に札が消えた';
      }, { 待ち: { 種類: '通信待ち', 何を: '最高額の更新', until: () => 押した額 == null ? Promise.resolve() : dev.until("/" + 押した額 + "/.test((document.getElementById('auBidHighest')||{}).innerText||'') || (document.querySelector('.screen.active')||{}).id!=='scr-rt-au-bid'", 4000).catch(() => {}) }, 撮らない: 数.入札 > 4, 間: 300 });
      rec.名 = 押した額 != null ? '競り：「' + 押した額 + '枚（' + (a.段 ? '+3' : '+1') + '）」を押す' : '競り：+1 を押すのをやめた（' + 見送り + '）';
      if (押した額 == null) { rec.する = '見る'; tr.見送った['上限' + k] = true; }
      tr.押した額[k] = 押した額;
      return;
    }
    if (a.k === '値踏み') {
      const g = 品質の順[(tr.ラウンド * 7 + tr.回 + (主 ? 0 : 1)) % 3];
      数.値踏み++;
      await W.手順を(who, '値踏み：「' + ({ fine: '上物', plain: '並物', fake: '偽物' })[g] + '」を押す', '押す', async () => {
        await W.sleep(900);
        await 押す(W, dev, 'scr-rt-au-guess', '#auGsPad [data-auguess="' + g + '"]');
      }, { 待ち: { 種類: '通信待ち', 何を: '選んだ印', until: () => dev.until("!!document.querySelector('#auGsPad .agq.on') || (document.querySelector('.screen.active')||{}).id!=='scr-rt-au-guess'", 3000).catch(() => {}) }, 撮らない: 数.値踏み > 4, 間: 200 });
      return;
    }
    if (a.k === '落札した品の値踏み画面') {
      tr.見た['落札' + k] = true;
      tr.落札.push({ 回: k, 品: o.spot, 額: tr.押した額[k] || null });
      await W.手順を(who, '自分が落札した（値踏みはしない）', '見る', null, { 間: 300 });
      return;
    }
    if (a.k === '開示を見る') {
      tr.見た['開示' + k] = true;
      数.開示++;
      // 開示は 0.5s→品質、+0.5s→相場、+0.4s→得点 の順に出る。出そろってから撮る
      await W.手順を(who, '開示：' + (o.spot || '').slice(0, 16), '見る', null, {
        待ち: { 種類: '演出待ち', 何を: '品質→相場→得点', until: () => dev.until("((document.getElementById('auRvPoints')||{}).textContent||'').length>0 || (document.querySelector('.screen.active')||{}).id!=='scr-rt-au-reveal'", 4000).catch(() => {}) },
        撮らない: 数.開示 > 3, 間: 200 });
      // 半額チケットを持って落札した品の開示なら、大画面の「◯枚で落札」と入札額を並べる
      const 落 = 追跡.参加者.落札.find((x) => x.回 === 回の鍵(追跡.参加者));
      if (主 && 落 && 追跡.参加者.ラウンド === 2) {
        const sub = await big.ev("(document.getElementById('bigSub')||{}).innerText||''");
        const 払った = (sub.match(/(\d+)\s*枚で落札/) || [])[1];
        半額の確かめ = { 入札: 落.額, 払った: 払った ? +払った : null, 大画面: sub };
        W.メモ書き.push({ '半額チケットの確かめ': 半額の確かめ, 手順: W.手順.length });
        W.メモ('半額チケットを持って落札：入札 ' + 落.額 + '枚／大画面「' + sub + '」');
        if (払った && 落.額 && +払った === 落.額 && 落.額 > 1) {
          W.気づいた('困る', '「半額チケット」を選んで落札したのに、払った額が半分になっていない（入札 ' + 落.額 + '枚 → 大画面「' + sub + '」）。部屋の画面には半額チケットを「使う」口が無い', 'scr-rt-au-power → scr-rt-au-reveal');
        }
      }
      return;
    }
  }

  /**
   * （試し）鑑定したあと、開場の画面でいちばん大きいボタンは「🎒 アイテムをえらび直す」になる。
   * それを押して同じ「鑑定眼」を選び直すと、もう1品鑑定できてしまわないか（1ラウンドに1回のはず）。
   * ふつうの人が「次は何を押す？」と迷って大きいボタンを押す、の手でたどる
   */
  async function 選び直しを試す(dev) {
    const 前 = await dev.ev("document.querySelectorAll('#auOpenShelf .mk-card.seen').length");
    await W.手順を('参加者', '（試し）鑑定のあと、大きいボタン「アイテムをえらび直す」を押す', '押す', () => 押す(W, dev, 'scr-rt-au-open', '#auPowerBtn'),
      { 待ち: { 種類: '演出待ち', 何を: 'アイテムの画面', until: () => W.画面は(dev, 'scr-rt-au-power', 5000).catch(() => {}) } });
    if ((await dev.screen()) !== 'scr-rt-au-power') return;
    await W.手順を('参加者', '（試し）もう一度「鑑定眼」を押す', '押す', async () => { await W.sleep(800); await 押す(W, dev, 'scr-rt-au-power', '#auPwList [data-power="appraise"]'); }, { 間: 700 });
    await W.手順を('参加者', '（試し）「← 品物を見にもどる」', '押す', () => 押す(W, dev, 'scr-rt-au-power', '#auPwBackBtn'),
      { 待ち: { 種類: '演出待ち', 何を: '開場の画面', until: () => W.画面は(dev, 'scr-rt-au-open', 5000).catch(() => {}) } });
    const 字 = await dev.ev("(document.getElementById('auOpenNote')||{}).innerText||''");
    W.メモ('選び直したあとの一言：「' + 字 + '」');
    if (!/調べたい品/.test(字)) return;
    const no = await dev.ev("(function(){var c=Array.from(document.querySelectorAll('#auOpenShelf .mk-card')).find(function(x){return !x.classList.contains('seen');});return c?+c.dataset.no:null;})()");
    if (!no) return;
    await W.手順を('参加者', '（試し）別の品（' + no + '番）を押す', '押す', () => 押す(W, dev, 'scr-rt-au-open', '#auOpenShelf [data-no="' + no + '"]'),
      { 待ち: { 種類: '演出待ち', 何を: '確かめの幕', until: () => dev.until("Array.from(document.querySelectorAll('.ui-layer')).some(function(x){return x.getBoundingClientRect().width>0;})", 4000).catch(() => {}) } });
    await W.手順を('参加者', '（試し）確かめ：「鑑定する」', '押す', () => W.pressIf(dev, /^鑑定する$/, '.ui-layer button'),
      { 待ち: { 種類: '通信待ち', 何を: '鑑定の結果', until: () => dev.until("document.querySelectorAll('#auOpenShelf .mk-card.seen').length>" + 前, 5000).catch(() => {}) }, 間: 700 });
    const 後 = await dev.ev("Array.from(document.querySelectorAll('#auOpenShelf .mk-card.seen')).map(function(c){return c.innerText.replace(/\\s+/g,' ');})");
    W.メモ('選び直したあとに鑑定できた品：' + JSON.stringify(後));
    W.メモ書き.push({ '鑑定眼の選び直し': { 前: 前, 後: 後, 手順: W.手順.length } });
    if (後.length > 前) {
      W.気づいた('困る', '鑑定のあと「アイテムをえらび直す」で同じ「鑑定眼」を選び直すと、同じラウンドでもう1品鑑定できる（鑑定の確かめは「1ラウンドに1回だけ使えます」と言っている）。鑑定した品：' + 後.join('／'), 'scr-rt-au-open → scr-rt-au-power');
    }
  }

  for (let i = 0; i < 600; i++) {
    if (Date.now() - 始め > 20 * 60 * 1000) throw new Error('20分たっても決着しません');
    const op = await part.ev(見る式), oh = await host.ev(見る式);
    if (op.scr === 'scr-rt-au-result') return;
    const tp = 数える('参加者', op), th = 数える('進行役', oh);
    const ap = 決める('参加者', op, tp);
    if (ap) { await 実行('参加者', part, ap, op, tp); continue; }
    const ah = 決める('進行役', oh, th);
    if (ah) { await 実行('進行役', host, ah, oh, th); continue; }
    // どちらもすることが無い → 何を待っているかを分けて待つ
    const kp = 鍵(op), kh = 鍵(oh);
    const 何を = op.scr === 'scr-rt-au-open' || op.scr === 'scr-rt-au-power' ? ['ほかの人がアイテムを選ぶ', '他の人待ち']
      : op.scr === 'scr-rt-au-bid' ? (op.pass ? ['ほかの人の「見送る」（最後のひと押し）', '他の人待ち'] : ['競りの締め切り（ほかの人の入札）', '他の人待ち'])
      : op.scr === 'scr-rt-au-guess' ? ['値踏みの締め切り', '他の人待ち']
      : op.scr === 'scr-rt-au-reveal' ? ['開示のあと、次の品', '演出待ち']
      : ['次の画面（' + op.scr + '）', '通信待ち'];
    数.待ち++;
    const 同じ待ち = W.手順.length && W.手順[W.手順.length - 1].名 === 何を[0] + 'を待つ';
    await W.待つ('参加者', 何を[0], 何を[1], async () => {
      for (;;) {
        const a = await part.ev(見る式), b = await host.ev(見る式);
        if (鍵(a) !== kp || 鍵(b) !== kh) return;
        if (Date.now() - 始め > 20 * 60 * 1000) return;
        await W.sleep(150);
      }
    }, { 撮らない: 数.待ち > 8 || 同じ待ち, 間: 0 });
  }
  throw new Error('遊ぶ：手順が多すぎます');
}
