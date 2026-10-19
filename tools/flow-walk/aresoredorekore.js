// tools/flow-walk/aresoredorekore.js — あれそれどれこれを、手渡し（1台を回す）で最後まで通す（指示62 第1部）
//
// **部屋では遊べない**（public/index.html の RT_GAME_SCREENS に無い）ので、手渡しで通す。
// 手渡しはログインが要る（goPlayWay が requireLogin を通す）ので、/dev-login 済みの1台を4人で回す想定。
// 端末は「進行役」の1台だけ。手順の 誰 は '進行役'（＝その1台）のまま、
// 名 に「［ひろ］…」のように、いまその1台を持っている人を書く。
//
// 遊び方：棚で選ぶとそのまま手渡しへ素通りする（遊び方の確認は出ない＝playWayPlan の through）。
// モード画面で最初に選ばれている「通常プレイ」を、設定は何も変えずに通す（既定のまま「つぎへ」）。
// 出題者は既定で「指定なし」。いちばんふつうの回し方として、
// **ひろ が1台を持って説明し、くま・ゆい・そうた が当てる**。
// 当たったら持っている人が「正解」→「だれが正解した？」で当てた人を押す。
// ときどき外れ（不正解）とパスも入れる。説明している時間は人の話す時間なので、
// W.待つ の「他の人待ち」に分けて残す（機械の待ちではない）。
//
// 1ラウンドは既定のタイマー（3分）。**タイマーが入っていると 🏁（ラウンドを終える）が出ない**ので、
// 3分は必ず待つ。1回目の結果で ⚙・つぎは？ を試し、「もう一度」で2回目の3-2-1までたどる（もう1回の手順）。
// つぎは？ の残りの選択肢は、押すと つぎは？ に戻れないので、1回に1つずつ見る：
//   2回目（途中で ⚙ を開いて見るだけ）→ 結果 → つぎは？ →「モードを変える」→ ← → プレイヤー → つぎへ
//   → 何も変えずに3回目 → 結果 → つぎは？ →「別のカセットへ」（試合を終えるので、いちばん最後）。
// 全部で3ラウンド（9分あまり）かかる。
//
// 開発中だけ：FW_UNTIL=ready / play1 / result1 で、その手前で止める（止めると 失敗 が入る）。

const 名前 = ['くま', 'ひろ', 'ゆい', 'そうた'];
const 出題者 = 'ひろ';
const 当てる人 = ['ゆい', 'そうた', 'くま', 'ゆい', 'くま', 'そうた'];
// 説明して誰かが当てるまでの秒（人が話す時間）。毎回少しずつ違う
const 説明秒 = [9, 7, 11, 8, 10, 6, 9, 12, 7, 8, 10, 9, 6, 11, 8, 7, 9, 10];

function 止める(where) {
  if (process.env.FW_UNTIL === where) throw new Error('開発用：FW_UNTIL=' + where + ' で止めた');
}

/** 長押し（pointerdown → ms → pointerup）。makeHoldButton は pointer の出来事だけを聞く */
async function 長押し(W, dev, sel, ms) {
  const ok = await dev.ev("(function(){var b=document.querySelector(" + JSON.stringify(sel) + ");if(!b)return false;var r=b.getBoundingClientRect();" +
    "var o={bubbles:true,cancelable:true,pointerId:7,pointerType:'touch',isPrimary:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2};" +
    "window.__fwHold=o;b.dispatchEvent(new PointerEvent('pointerdown',o));return true;})()");
  if (!ok) throw new Error('長押しするものが見つかりません ' + sel);
  await W.sleep(ms);
  await dev.ev("(function(){var b=document.querySelector(" + JSON.stringify(sel) + ");if(b)b.dispatchEvent(new PointerEvent('pointerup',window.__fwHold||{bubbles:true}));return true;})()");
}

/** 2つの要素の重なり（CSS px の面積）。どちらかが見えていなければ 0 */
async function 重なりを測る(dev, a, b) {
  return dev.ev("(function(){function r(s){var e=document.querySelector(s);if(!e)return null;var q=e.getBoundingClientRect();if(q.width<1||q.height<1)return null;if(typeof e.checkVisibility==='function'&&!e.checkVisibility({opacityProperty:true,visibilityProperty:true}))return null;return q;}" +
    "var A=r(" + JSON.stringify(a) + "),B=r(" + JSON.stringify(b) + ");if(!A||!B)return {面積:0};" +
    "var w=Math.min(A.right,B.right)-Math.max(A.left,B.left),h=Math.min(A.bottom,B.bottom)-Math.max(A.top,B.top);" +
    "return {面積:(w>0&&h>0)?Math.round(w*h):0, A:[Math.round(A.left),Math.round(A.top),Math.round(A.width),Math.round(A.height)], B:[Math.round(B.left),Math.round(B.top),Math.round(B.width),Math.round(B.height)]};})()");
}

/** タイマーの残り秒（表示から読む。見えていなければ null） */
const 残り秒式 = "(function(){var t=(document.getElementById('playTimer')||{}).textContent||'';var m=t.match(/(\\d+):(\\d+)/);return m?(+m[1])*60+(+m[2]):null;})()";
const お題式 = "((document.getElementById('topicName')||{}).textContent||'').trim()";
const 帯が出ている式 = "!!document.querySelector('.fx-banner')";
const 選ぶ幕式 = "document.getElementById('correctPickerOverlay').classList.contains('show')";

/** 1ラウンドを遊ぶ（scr-play にいる間）。o.撮る数 だけ最初の何問かを細かく撮る */
async function ラウンドを遊ぶ(W, h, o) {
  const 細かく = o.細かく || 2;
  let k = 0, 急かし撮った = false;
  const 集計 = { 正解: 0, 不正解: 0, パス: 0 };
  for (; k < 40; k++) {
    if ((await h.screen()) !== 'scr-play') break;
    const 残り = await h.ev(残り秒式);
    const 秒 = 説明秒[(k + (o.ずらす || 0)) % 説明秒.length];
    // 残りが少ない時は、説明しているうちに時間切れになる（それもふつうの終わり方）
    if (残り !== null && 残り <= 秒 + 3) break;
    const お題 = await h.ev(お題式);
    const 撮らない = k >= 細かく;
    // ---- 説明して、誰かが当てるまで（人が話している時間） ----
    await W.待つ('進行役', '［' + 出題者 + '］' + (k + 1) + '問目「' + お題 + '」を説明して、だれかが答える', '他の人待ち',
      () => W.sleep(秒 * 1000), { 撮らない, 間: 0 });
    if ((await h.screen()) !== 'scr-play') break;
    // ---- 1問目のあとで1回だけ、外れ（不正解）を入れる ----
    if (k === 1) {
      await W.手順を('進行役', '［' + 出題者 + '］ちがう答えが出た：❌ 不正解を押す', '押す', () => W.tap(h, '#btnWrong'), { 間: 500, 撮らない });
      集計.不正解++;
      if (o.知らせを測る) {
        const 重 = await 重なりを測る(h, '#foulToast', '#playTimer');
        W.メモ('不正解の知らせ（#foulToast）と時計（#playTimer）の重なり：' + JSON.stringify(重));
        if (重.面積 > 0) W.気づいた('気になる', '「❌ 不正解：（お題）」の知らせが、残り時間の時計に重なって隠す（重なり ' + 重.面積 + 'px²・1.6秒）', 'scr-play');
      }
      await W.待つ('進行役', '［' + 出題者 + '］説明をつづけて、だれかが当てる', '他の人待ち', () => W.sleep(4000), { 撮らない: true, 間: 0 });
      if ((await h.screen()) !== 'scr-play') break;
    }
    // ---- 4問目は、むずかしくてパス ----
    if (k === 3) {
      await W.手順を('進行役', '［' + 出題者 + '］伝わらないので ⏭ パス', '押す', () => W.tap(h, '#btnPass'),
        { 待ち: { 種類: '演出待ち', 何を: 'つぎのお題', until: () => h.until("(" + お題式 + ")!==" + JSON.stringify(お題), 5000) }, 間: 400, 撮らない: k > 細かく + 1 });
      集計.パス++;
      continue;
    }
    const だれ = 当てる人[k % 当てる人.length];
    if (!撮らない) {
      await W.手順を('進行役', '［' + 出題者 + '］当たった：✅ 正解を押す', '押す', () => W.tap(h, '#btnCorrect'),
        { 待ち: { 種類: '演出待ち', 何を: '「だれが正解した？」', until: () => h.until(選ぶ幕式, 3000) }, 間: 350 });
      await W.手順を('進行役', '［' + 出題者 + '］「だれが正解した？」：' + だれ + ' を押す', '押す', () => W.press(h, '^' + だれ + '( ★)?$', '#pickerGrid .pk-btn'),
        { 待ち: { 種類: '演出待ち', 何を: '正解の帯', until: () => h.until(帯が出ている式, 3000) }, 間: 250 });
      await W.待つ('進行役', '正解の帯 → つぎのお題がめくれる', '演出待ち',
        () => h.until("!(" + 帯が出ている式 + ") && (" + お題式 + ")!==" + JSON.stringify(お題), 6000), { 間: 400 });
    } else {
      const rec = await W.手順を('進行役', '［' + 出題者 + '］✅ 正解 →「だれが正解した？」で ' + だれ + ' を押す', '押す', async () => {
        await W.tap(h, '#btnCorrect');
        await h.until(選ぶ幕式, 3000);
        await W.sleep(400);
        await W.press(h, '^' + だれ + '( ★)?$', '#pickerGrid .pk-btn');
      }, { 待ち: { 種類: '演出待ち', 何を: '正解の帯 → つぎのお題', until: () => h.until("!(" + 帯が出ている式 + ") && (" + お題式 + ")!==" + JSON.stringify(お題), 6000) }, 間: 200, 撮らない: true, 失敗してよい: true });
      if (rec.失敗) { W.メモ('（時間切れと重なった）'); break; }
    }
    集計.正解++;
    // ---- 残り10秒の急かし（赤く脈打つ）を1回だけ撮る ----
    const 今 = await h.ev(残り秒式);
    if (!急かし撮った && 今 !== null && 今 <= 20 && o.急かしを撮る) {
      急かし撮った = true;
      await W.待つ('進行役', '残り10秒（秒読み）', '他の人待ち', () => h.until(残り秒式 + "<=9", 25000), { 間: 0 });
    }
  }
  // ---- 時間切れ ----
  await W.待つ('進行役', '［' + 出題者 + '］説明しているうちに時間切れ → ラウンド終了の発表', '他の人待ち',
    () => h.until("(document.querySelector('.screen.active')||{}).id==='scr-reveal'", 40000), { 間: 700 });
  return 集計;
}

/** 3-2-1 から、お題が出るまで（1-3：カウントダウン中に吹き出しが出るか） */
async function 数えて渡す(W, h, 何回目) {
  await W.手順を('進行役', '［くま］準備はいい？：長押しでスタート（1秒）', '長押し', () => 長押し(W, h, '#holdBtn', 1300),
    { 待ち: { 種類: '演出待ち', 何を: '3-2-1', until: () => W.画面は(h, 'scr-countdown', 5000) }, 間: 150 }).then((r) => { r.押す回数 += 1; });
  const 吹き出しを見る = "(function(){var t=document.querySelector('.tut-say');return {吹き出し: !!t && t.getBoundingClientRect().width>0 && getComputedStyle(t).opacity!=='0', 数字: (document.querySelector('.screen.active')||{}).id==='scr-countdown' || !!document.querySelector('.fx-countdown'), 見えている数字: ((document.getElementById('cdNumber')||{}).textContent||'').trim()};})()";
  await W.手順を('進行役', 何回目 + 'の3-2-1の途中', '見る', null, { 間: 600 });
  const cd = await h.ev(吹き出しを見る);
  W.メモ('カウントダウン中の吹き出し：' + JSON.stringify(cd) + '（手渡しの3-2-1は .fx-countdown ではなく scr-countdown の画面）');
  if (cd.吹き出し && cd.数字) W.気づいた('困る', 'カウントダウンの数字が出ている最中に、チュートリアルの吹き出しが出ている（1-3 再現）', 'scr-countdown');
  await W.待つ('進行役', '3-2-1 → 「スマホをわたす」', '演出待ち', () => W.画面は(h, 'scr-topic-pass', 10000), { 間: 500 });
  const 渡す字 = await h.ev("({名:(document.getElementById('topicPassName')||{}).textContent,補足:(document.getElementById('topicPassSub')||{}).textContent})");
  W.メモ('手渡しの画面：' + JSON.stringify(渡す字));
  await W.手順を('進行役', '［くま→' + 出題者 + 'に渡す］「わたしました」', '渡して押す', () => W.tap(h, '#topicPassBtn'),
    { 待ち: { 種類: '演出待ち', 何を: 'お題カードがめくれる', until: () => h.until("(document.querySelector('.screen.active')||{}).id==='scr-play' && (" + お題式 + ")!=='-' && (" + お題式 + ")!==''", 6000) }, 間: 700 });
}

/** スコアの画面まで（発表 → 祝い → 結果） */
async function 結果まで(W, h, 何回目) {
  await W.待つ('進行役', 何回目 + '：ラウンド終了の発表 → スコアと祝い', '演出待ち',
    () => h.until("(document.querySelector('.screen.active')||{}).id==='scr-score' && !!document.querySelector('.fx-cel')", 15000).catch(() => W.画面は(h, 'scr-score', 5000)), { 間: 950 });
  // 祝いの中身（名前と一言は 0.45秒・0.6秒遅れて出る）を、出ている最中に読む
  const 祝い = await h.ev("(function(){var c=document.querySelector('.fx-cel');if(!c)return null;var q=function(s){var e=c.querySelector(s);return e?e.textContent.trim():'';};return {文:q('.fx-cel-text'),一言:q('.fx-cel-sub'),絵:q('.fx-cel-hero')};})()");
  W.メモ('祝いの中身：' + JSON.stringify(祝い));
  await W.待つ('進行役', 何回目 + '：祝いが消えて結果が見える', '演出待ち',
    () => h.until("!document.querySelector('.fx-cel,.fx-banner')", 10000), { 間: 1200 });
  const 称号 = await h.ev("!!document.querySelector('#titleGotOverlay.show')");
  if (称号) W.メモ('称号の幕が出ている');
  const 並び = await h.ev("Array.from(document.querySelectorAll('#scoreList .player-row')).map(function(r){var g=function(s){var e=r.querySelector(s);return e?e.textContent.trim():'';};return (g('.rank')||'👑')+' '+g('.p-name')+' '+g('.p-score');})");
  W.メモ('スコアの並び：' + 並び.join(' ／ '));
  // 同じ点なのに順位の数字が違う（👑 と 2 など）ことがあるので、数で確かめる
  const 点 = 並び.map((s) => +s.split(' ').pop());
  if (点.length > 1 && 点[0] === 点[1] && 点[0] > 0) {
    W.気づいた('気になる', 何回目 + '：同じ点（' + 点[0] + '点）なのに、スコアの順位が「' + 並び[0].split(' ')[0] + '」と「' + 並び[1].split(' ')[0] + '」に分かれている（直前の祝い：' + JSON.stringify(祝い) + '）', 'scr-score');
  }
}

module.exports = {
  way: 'hand',
  端末: ['進行役'],
  async run(W) {
    const h = W.host;

    // ---- 1台をひらく（ログイン済み） ----
    await h.go(W.BASE + '/dev-login');
    await W.手順を('進行役', 'アプリを開く（ログイン済みの1台）', '開く', async () => {
      await h.go(W.BASE + '/');
      await W.扉を越える(h, true);
    }, { 待ち: { 種類: '演出待ち', 何を: '入口', until: () => W.画面は(h, 'scr-entry') } });
    await W.手順を('進行役', '入口：ゲームをえらぶ', '押す', () => W.click(h, '[data-entry="choose"]'),
      { 待ち: { 種類: '通信待ち', 何を: '棚', until: () => W.画面は(h, 'scr-shelf') }, 間: 700 });
    await W.棚でカセットを選ぶ(h, 'aresoredorekore', 'あれそれどれこれ');
    let scr = await h.screen();
    if (scr === 'scr-play-way') {
      // 1台でしか遊べないので、ふつうは聞かれない（through）。出たら「1台で」を押す
      await W.手順を('進行役', '遊び方の確認：1台で', '押す', () => W.click(h, '#wayChoices [data-way="handoff"]'), { 間: 900 });
      scr = await h.screen();
    } else {
      W.メモ('遊び方の確認（1台か部屋か）は出ず、そのまま ' + scr + ' に着いた（部屋で遊べないカセットなので素通り）');
    }

    // ---- 人の登録（4人） ----
    await W.画面は(h, 'scr-setup', 8000);
    const 見出しの重なり = [];
    const 見出しを測る = async (dev) => {
      const 重 = await 重なりを測る(dev, '#floatingBackBtn', '.screen.active .scr-title');
      const s = await dev.screen();
      if (重.面積 > 0) 見出しの重なり.push(s + '「' + (await dev.ev("((document.querySelector('.screen.active .scr-title')||{}).textContent||'').trim()")) + '」' + 重.面積 + 'px²');
      return 重;
    };
    await 見出しを測る(h);
    // プレイヤーの画面の注意書きが指す「下の『部屋』」が、この画面にあるか
    const 部屋の注意 = await h.ev("(function(){var s=document.getElementById('scr-setup');var t=Array.from(s.querySelectorAll('.mic-status')).map(function(e){return e.textContent.trim();}).find(function(x){return /部屋/.test(x);})||'';" +
      "var b=Array.from(s.querySelectorAll('button')).filter(function(x){return x.getBoundingClientRect().width>0;}).map(function(x){return (x.innerText||'').trim();});return {注意:t, ボタン:b};})()");
    W.メモ('プレイヤーの画面の注意書き：' + JSON.stringify(部屋の注意));
    if (部屋の注意.注意 && !部屋の注意.ボタン.some((t) => /部屋/.test(t))) {
      W.気づいた('困る', 'プレイヤーの画面に「' + 部屋の注意.注意 + '」とあるが、この画面に「部屋」のボタンは無い（見えているボタン：' + 部屋の注意.ボタン.join('／') + '）。部屋の入口は入口の画面にしか無い', 'scr-setup');
    }
    await W.手順を('進行役', 'プレイヤー：人数を4人にする（＋を2回）', '押す', async () => {
      await W.tap(h, '#playerPlusBtn');
      await W.sleep(250);
      await W.tap(h, '#playerPlusBtn');
    }, { 間: 400 });
    await W.手順を('進行役', 'プレイヤー：4人の名前を入れる', '入力', async () => {
      for (let i = 0; i < 名前.length; i++) await W.type(h, '.draft-name[data-idx="' + i + '"]', 名前[i]);
    }, { 間: 400 });
    await W.手順を('進行役', 'プレイヤー：つぎへ', '押す', () => W.tap(h, '#setupNextBtn'),
      { 待ち: { 種類: '通信待ち', 何を: 'モードの画面', until: () => W.画面は(h, 'scr-mode', 10000) }, 間: 800 });
    await 見出しを測る(h);

    // ---- モード → 設定 → ルール → 準備はいい？（何も変えない） ----
    await W.設定を進める({ cassetteId: 'aresoredorekore', 名: 'あれそれどれこれ', 終わり: 'scr-ready', handlers: {
      // ルールの画面は、押す前に「左上の ← が見出しに重なっていないか」だけ測る（押し方は既定に任せる）
      'scr-mode-rules': async (dev) => { await 見出しを測る(dev); return false; }
    } });
    W.メモ('左上の ← と見出しの重なり：' + JSON.stringify(見出しの重なり));
    if (見出しの重なり.length) {
      W.気づいた('気になる', '左上に浮いている ← が、画面の見出しの頭に重なって字を隠している：' + 見出しの重なり.join('、'), 見出しの重なり.map((s) => s.split('「')[0]).join(','));
    }
    const 目安 = await h.ev("((document.getElementById('readyEst')||{}).textContent||'').trim()");
    W.メモ('準備はいい？の目安：' + 目安);
    if (W.モード) W.モード.なぜ = 'モード画面で最初に選ばれていたもの（何も変えずに「つぎへ」）。部屋で遊べないので手渡しで通した';
    // 初めての人への「あそびかたを見ますか？」（チュートリアルはクイズ解除にしか台本が無い）
    const 問い = await h.ev("(function(){var b=Array.from(document.querySelectorAll('.ui-layer button, #uiLayerRoot button')).find(function(x){return /いらない/.test(x.textContent)&&x.getBoundingClientRect().width>0;});return !!b;})()");
    if (問い) {
      await W.手順を('進行役', '「はじめてですね」：見る', '押す', () => W.press(h, /^見る$/, '.ui-layer button, #uiLayerRoot button'), { 間: 800 });
    } else {
      W.メモ('「はじめてですね（チュートリアル）」は出なかった（tutScriptFor は bomb だけ）');
    }
    止める('ready');

    // ---- 1回目 ----
    await 数えて渡す(W, h, '1回目');
    止める('play1');
    const 始まり = Date.now();
    const 一回目 = await ラウンドを遊ぶ(W, h, { 細かく: 2, 急かしを撮る: true, 知らせを測る: true });
    const 分 = Math.round((Date.now() - 始まり) / 6000) / 10;
    W.メモ('1回目のラウンド：お題が出てから「ラウンド終了！」まで ' + 分 + '分');
    const 目安分 = +(String(目安).match(/(\d+)分/) || [])[1];
    if (目安分 && 目安分 >= 分 * 2) {
      W.気づいた('気になる', '準備はいい？ は「' + 目安 + '」と出すが、1ラウンドはタイマーの3:00で「ラウンド終了！」になる（実測 ' + 分 + '分）。同じ「ラウンド」が別の長さを指している', 'scr-ready');
    }
    W.メモ('1回目の集計：' + JSON.stringify(一回目));
    await 結果まで(W, h, '1回目');
    止める('result1');

    // ---- 終わり方：ボタン・放置・行き先・もう1回 ----
    await W.結果のあと({
      async 試す() {
        if (await W.ボタンあり(h, /^あとで/)) await W.ボタンを試す(h, /^あとで/, { 名: '称号の幕：あとで' });
        // 右上の ⚙（設定）。遊び終わったあとに何が並ぶかを見る
        if (await W.ボタンあり(h, /^⚙$/)) {
          await W.ボタンを試す(h, /^⚙$/, { 名: '⚙（設定）', 戻す: (d) => W.click(d, '#closeSettingsBtn') });
        }
        // つぎは？ → 戻る矢印で、結果にもどれるか
        await W.ボタンを試す(h, /つぎは/, { 名: 'つぎは？', 戻す: async (d) => {
          W.終わり方を('つぎは？の選択肢（試した時）', await W.ボタン一覧(d));
          await W.手順を('進行役', 'つぎは？：左上の ← で一個前へ', '押す', () => W.press(d, /^←$/), { 間: 900 });
          W.メモ('← で ' + (await d.screen()) + ' に戻った');
        } });
        if ((await h.screen()) !== 'scr-score') W.気づいた('気になる', 'つぎは？ から ← で戻ると、結果（scr-score）ではなく ' + (await h.screen()) + ' に着いた', 'scr-next');
      },
      async もう一回() {
        await W.手順を('進行役', '結果：つぎは？', '押す', () => W.tap(h, '#toNextBtn'),
          { 待ち: { 種類: '演出待ち', 何を: 'つぎは？の画面', until: () => W.画面は(h, 'scr-next') }, 間: 700 });
        W.終わり方を('つぎは？の選択肢', await W.ボタン一覧(h));
        await W.手順を('進行役', 'つぎは？：もう一度（さっきと同じ設定でそのまま）', '押す', () => W.press(h, /^もう一度/),
          { 待ち: { 種類: '演出待ち', 何を: '準備はいい？', until: () => W.画面は(h, 'scr-ready', 6000) }, 間: 900 });
        await W.手順を('進行役', '［くま］準備はいい？：長押しでスタート（1秒）', '長押し', () => 長押し(W, h, '#holdBtn', 1300),
          { 待ち: { 種類: '演出待ち', 何を: '2回目の3-2-1', until: () => W.画面は(h, 'scr-countdown', 5000) }, 間: 300 }).then((r) => { r.押す回数 += 1; });
      }
    });

    // ---- 2回目：遊んでいる途中の ⚙ と、つぎは？ の残りの選択肢 ----
    await W.待つ('進行役', '2回目：3-2-1 → 「スマホをわたす」', '演出待ち', () => W.画面は(h, 'scr-topic-pass', 10000), { 間: 500 });
    await W.手順を('進行役', '［くま→' + 出題者 + 'に渡す］「わたしました」', '渡して押す', () => W.tap(h, '#topicPassBtn'),
      { 待ち: { 種類: '演出待ち', 何を: 'お題カードがめくれる', until: () => h.until("(document.querySelector('.screen.active')||{}).id==='scr-play' && (" + お題式 + ")!=='-'", 6000) }, 間: 700 });
    // 遊んでいる途中の出口：⚙ に何が並ぶか（押して見るだけ。ゲームは終えない）
    const 歯車 = await W.ボタンを試す(h, /^⚙$/, { 名: '遊んでいる途中の ⚙（出口を見る）', 戻す: (d) => W.click(d, '#closeSettingsBtn') });
    W.終わり方を('遊んでいる途中の⚙', 歯車.行き先);
    const 二回目 = await ラウンドを遊ぶ(W, h, { 細かく: 0, ずらす: 5 });
    W.メモ('2回目の集計：' + JSON.stringify(二回目));
    await 結果まで(W, h, '2回目');
    await W.手順を('進行役', '2回目の結果：つぎは？', '押す', () => W.tap(h, '#toNextBtn'),
      { 待ち: { 種類: '演出待ち', 何を: 'つぎは？の画面', until: () => W.画面は(h, 'scr-next') }, 間: 700 });
    W.終わり方を('2回目のつぎは？の選択肢', await W.ボタン一覧(h));
    // ---- モードを変える → どこへ行くか。← で戻るとどこか ----
    const 得点式 = "(function(){var b=document.getElementById('modeScorePreview');return b&&b.style.display!=='none'?b.textContent.replace(/\\s+/g,' ').trim():'';})()";
    let モード後 = null;
    const モード = await W.ボタンを試す(h, /モードを変える/, { 名: 'つぎは？：モードを変える', 戻す: async (d) => {
      モード後 = await d.ev(得点式);
      W.メモ('モードの画面に出ている得点：' + JSON.stringify(モード後));
      await W.手順を('進行役', 'モードの画面：左上の ← で一個前へ', '押す', () => W.press(d, /^←$/), { 間: 900 });
      W.メモ('← で ' + (await d.screen()) + ' に着いた');
    } });
    W.終わり方を('モードを変えるの行き先', モード.行き先);
    const 戻った先 = await h.screen();
    if (戻った先 !== 'scr-next' && 戻った先 !== 'scr-score') {
      W.気づいた('気になる', 'つぎは？ →「モードを変える」のあと、左上の ← で ' + 戻った先 + ' に着く（つぎは？ にも結果にも戻らない）', 戻った先);
    }
    // ---- ← で着いたプレイヤーの画面から、何も変えずに「つぎへ」（ふつうに前へ進む）。得点はどうなるか ----
    if (戻った先 === 'scr-setup') {
      await W.手順を('進行役', 'プレイヤー：何も変えずに つぎへ', '押す', () => W.tap(h, '#setupNextBtn'),
        { 待ち: { 種類: '通信待ち', 何を: 'モードの画面', until: () => W.画面は(h, 'scr-mode', 10000) }, 間: 800 });
      const 得点 = await h.ev(得点式);
      W.メモ('プレイヤーの画面を通ったあとの得点：' + JSON.stringify(得点));
      if (モード後 && !得点) {
        W.気づいた('困る', '「モードを変える」→ ← → プレイヤーの画面で何も変えずに「つぎへ」を押すと、それまでの得点（' + モード後 + '）が消えて、0点からの新しい試合になる。確認は出ない', 'scr-setup');
      }
    }
    // ---- そのまま3回目へ（モード・設定は何も変えない） ----
    if ((await h.screen()) !== 'scr-ready') {
      await W.設定を進める({ cassetteId: 'aresoredorekore', 名: 'あれそれどれこれ', 終わり: 'scr-ready' });
    }
    await W.手順を('進行役', '［くま］準備はいい？：長押しでスタート（1秒）', '長押し', () => 長押し(W, h, '#holdBtn', 1300),
      { 待ち: { 種類: '演出待ち', 何を: '3回目の3-2-1', until: () => W.画面は(h, 'scr-countdown', 5000) }, 間: 300 }).then((r) => { r.押す回数 += 1; });
    await W.待つ('進行役', '3回目：3-2-1 → 「スマホをわたす」', '演出待ち', () => W.画面は(h, 'scr-topic-pass', 10000), { 間: 500 });
    await W.手順を('進行役', '［くま→' + 出題者 + 'に渡す］「わたしました」', '渡して押す', () => W.tap(h, '#topicPassBtn'),
      { 待ち: { 種類: '演出待ち', 何を: 'お題カードがめくれる', until: () => h.until("(document.querySelector('.screen.active')||{}).id==='scr-play' && (" + お題式 + ")!=='-'", 6000) }, 間: 700 });
    const 三回目 = await ラウンドを遊ぶ(W, h, { 細かく: 0, ずらす: 9 });
    W.メモ('3回目の集計：' + JSON.stringify(三回目));
    await 結果まで(W, h, '3回目');
    await W.手順を('進行役', '3回目の結果：つぎは？', '押す', () => W.tap(h, '#toNextBtn'),
      { 待ち: { 種類: '演出待ち', 何を: 'つぎは？の画面', until: () => W.画面は(h, 'scr-next') }, 間: 700 });
    // ---- 別のカセットへ（試合を終える）。いちばん最後 ----
    const 別 = await W.ボタンを試す(h, /別のカセットへ/, { 名: 'つぎは？：別のカセットへ（いちばん最後）', 間: 1500, 確かめて進む: true });
    W.終わり方を('別のカセットへの行き先', 別.行き先 + '（後ろの画面：' + (await h.screen()) + '）');
    if (await W.ボタンあり(h, /^このまま続ける$/)) {
      await W.手順を('進行役', '「つぎは、メンバーを入力しなおしますか？」：このまま続ける', '押す', () => W.press(h, /^このまま続ける$/, '.ui-layer button'), { 間: 900 });
    }
    W.終わり方を('別のカセットへのあと', await h.screen());
  }
};
