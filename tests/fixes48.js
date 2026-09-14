// tests/fixes48.js — 第48弾の着手前調査で見つかった「遊べなくなる穴」の再発防止
//
// 指示48そのものは「進行と分かりやすさ」だが、下調べの途中で
// **その指示の範囲外の穴**がいくつも出た。本人の裁定（2026-09-14）で
// 「遊べなくなる3件だけ今すぐ直す」ことにしたので、その3件をここで固定する。
//
//   ① すごろくの決着で「← 部屋を出る」が押せない
//      → tests/room-paths.js（正本の逆向き照合）と rt-screens.js（正本ループ）で見張る
//   ② 設定を開くと、手渡し人狼の「夜の持ち時間」だけ止まらない  ← このファイル
//   ③ 部屋のミニゲームで、押した速さが全員 0 になる            ← このファイル
//
// 落とし穴10の型を踏まないよう、次を守って書く：
//   (a) 自己参照   … 実装の定数を検査の入力にしない
//   (b) 条件未成立 … **「止めなければ本当に減る」を先に確かめてから**「止めたら減らない」を見る
//   (c) 分岐未試験 … 片側の入力だけで通さない
//   (g) 片付いたあとに数えない … 動いている最中に測る

const {
  createRunner, assert, assertEqual, assertNoErrors,
  launch, activeScreen, sleep, waitFor, waitScreen, el, click,
  fillPlayerForm, setupPlayers, pickGame } = require('./harness');

const Sugo = require('../sugoroku-room.js');
const Mini = require('../public/js/sugoroku-mini.js');

// 「01:23」を秒に直す。読めなかったら null（黙って0にしない・落とし穴10-e）
function 秒(txt) {
  const m = /^(\d+):(\d+)$/.exec(String(txt || '').trim());
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
}

async function run() {
  const r = createRunner('fixes48：第48弾で直した「遊べなくなる穴」');

  // ===================== ② 手渡し人狼の夜の持ち時間 =====================
  //
  // ⚙を押した時に止めるのは `play.interval`（あれそれ）と `wr.timer`（人狼の朝）の
  // 2つだけで、`wr.nightTimer`（夜）は別変数なので止まらなかった。
  // 重なりの裏で切れると `advanceWrQueue()` が走り、**次の人にスマホが渡る**。
  // すぐ上のコメントが「設定を開いただけで時間が進まなくなっていた」を直した話なのに、
  // 夜だけ入れ忘れていた（落とし穴1）。

  // 夜の持ち時間つきで、手渡し人狼の「夜」の画面まで進める
  async function 夜まで進む(win, doc) {
    const players = ['あき', 'びび', 'ちか', 'でん', 'えみ'];
    const cart = doc.querySelector('.cart[data-cart="jinro"]');
    cart.click();
    if (activeScreen(doc) === 'scr-shelf') cart.click();
    await waitScreen(win, doc, 'scr-game', 4000);
    pickGame(doc, 'wolfrole');
    await sleep(win, 60);
    await fillPlayerForm(win, doc, players);
    await waitScreen(win, doc, 'scr-mode', 4000);
    click(doc, doc.querySelector('.mode-card[data-id="wolf-casual"]'));
    click(doc, 'modeNextBtn');
    await waitScreen(win, doc, 'scr-set-wolfrole', 4000);
    // 夜の持ち時間を 60秒 にする（15秒刻み × 4）。
    // **具体の数字で書く**（実装の既定値を読んで入力にすると自己参照・落とし穴10-a）
    const 増やす = doc.querySelector('#scr-set-wolfrole [data-wrnight="15"]');
    assert(増やす, '夜の持ち時間のステッパーが設定画面にある');
    for (let i = 0; i < 4; i++) 増やす.click();
    assertEqual(el(doc, 'wrNightValue').textContent, '60秒', '夜の持ち時間を60秒にした');
    click(doc, doc.querySelector('#scr-set-wolfrole [data-wiz-next]'));
    await waitScreen(win, doc, 'scr-set-timer', 4000);
    if (el(doc, 'timerEnableToggle').classList.contains('on')) click(doc, 'timerEnableToggle');
    click(doc, doc.querySelector('#scr-set-timer [data-wiz-next]'));
    await sleep(win, 60);
    if (activeScreen(doc) === 'scr-mode-rules') { click(doc, 'rulesStartBtn'); await sleep(win, 60); }
    await waitScreen(win, doc, 'scr-ready', 4000);
    el(doc, 'holdBtn').dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true }));

    // 1周目＝役職確認（持ち時間なし）、2周目＝夜（持ち時間あり）
    for (let pass = 0; pass < 2; pass++) {
      await waitScreen(win, doc, 'scr-wr-pass', 9000);
      if (pass === 1) return;   // 夜の1人目の「見る」直前で止める
      let i = 0;
      while (i++ < players.length && activeScreen(doc) === 'scr-wr-pass') {
        click(doc, 'wrRevealBtn');
        await sleep(win, 40);
        let g = 0;
        while (g++ < 4 && activeScreen(doc) === 'scr-wr-pass'
               && el(doc, 'wrContent').style.display !== 'none') {
          const ch = Array.from(doc.querySelectorAll('#wrChoiceGrid button[data-choice]'));
          if (ch.length) {
            ch[0].click();
            const ok = doc.getElementById('wrVoteOkBtn');
            if (ok) ok.click();
          } else click(doc, 'wrNextBtn');
          await sleep(win, 45);
        }
      }
    }
  }

  await r.test('夜の持ち時間：設定を開いていない間は、ちゃんと減る（対照）', async () => {
    const { win, doc, errors } = await launch();
    await waitScreen(win, doc, 'scr-shelf', 8000);
    await 夜まで進む(win, doc);
    click(doc, 'wrRevealBtn');           // 中身を見た瞬間から計り始める
    await sleep(win, 60);
    assert(el(doc, 'wrNightTimerRow').style.display !== 'none', '夜の時計が出ている');
    const 前 = 秒(el(doc, 'wrNightTimer').textContent);
    assert(前 !== null, '夜の時計が読める（いま「' + el(doc, 'wrNightTimer').textContent + '」）');
    await sleep(win, 2400);
    const 後 = 秒(el(doc, 'wrNightTimer').textContent);
    assert(後 !== null && 後 < 前,
      '設定を開かなければ、夜の持ち時間は減る（' + 前 + '秒 → ' + 後 + '秒）。' +
      'ここが減らないなら、下の検査は何も試していない（落とし穴10-b）');
    assertNoErrors(errors, '夜の持ち時間の対照で未捕捉の例外');
    win.close();
  });

  await r.test('夜の持ち時間：設定を開いている間は止まり、閉じると続きから再開する', async () => {
    const { win, doc, errors } = await launch();
    await waitScreen(win, doc, 'scr-shelf', 8000);
    await 夜まで進む(win, doc);
    const 誰の番か = el(doc, 'wrHandoffName').textContent.trim();
    click(doc, 'wrRevealBtn');
    /**
     * **先に少し減らしてから止める。**
     * 満タンのまま止めると、「閉じた時に満タンへ戻す」形（＝止めた人が得をする）と
     * 見分けがつかない——60秒で止めて60秒に戻されても、値が同じなので気づけない
     * （変異が素通りした。落とし穴10-b の親戚）。
     */
    await sleep(win, 2400);
    const 前 = 秒(el(doc, 'wrNightTimer').textContent);
    assert(前 !== null, '夜の時計が読める');
    assert(前 < 60, '止める前に、満タン（60秒）から減っている（いま ' + 前 + '秒）。'
      + 'ここが60のままだと、満タンに戻す形と見分けがつかない');

    click(doc, 'floatingGearBtn');
    await sleep(win, 120);
    assert(el(doc, 'settingsOverlay').classList.contains('show'), '設定が開いた');
    await sleep(win, 2400);
    const 開いている間 = 秒(el(doc, 'wrNightTimer').textContent);
    assertEqual(開いている間, 前,
      '設定を開いている間、夜の持ち時間は1秒も減らない（' + 前 + '秒 → ' + 開いている間 + '秒）');
    assertEqual(activeScreen(doc), 'scr-wr-pass', '重なりの裏で次の人へ渡っていない');

    click(doc, 'closeSettingsBtn');
    await sleep(win, 60);
    /**
     * **満タンに戻っていないことまで見る。**
     * 「閉じたあと < 前」だけだと、`startWrNightTimer()` で60秒に戻してから
     * 刻み直す形（＝止めた人が得をする）も通ってしまう（変異が素通りした）。
     * 閉じた直後の値が、止めていた間の値より**増えていない**ことを見る。
     */
    const 閉じた直後 = 秒(el(doc, 'wrNightTimer').textContent);
    assert(閉じた直後 !== null && 閉じた直後 <= 開いている間,
      '閉じた瞬間に時間が増えていない（止めた時 ' + 開いている間 +
      '秒 → 閉じた直後 ' + 閉じた直後 + '秒）。増えていたら、'
      + '止めた人が得をする形（満タンに戻している）');
    assertEqual(el(doc, 'wrHandoffName').textContent.trim(), 誰の番か,
      '設定を閉じても、同じ人の番のまま');
    assert(el(doc, 'wrNightTimerRow').style.display !== 'none',
      '閉じたあとも夜の時計が出ている（止めた時に消してしまわない）');
    await sleep(win, 2400);
    const 閉じたあと = 秒(el(doc, 'wrNightTimer').textContent);
    assert(閉じたあと !== null && 閉じたあと < 前,
      '設定を閉じたら、続きから減り始める（' + 前 + '秒 → ' + 閉じたあと + '秒）');
    assertNoErrors(errors, '夜の持ち時間の停止・再開で未捕捉の例外');
    win.close();
  });

  // ===================== 48-1 ルール・準備OKの画面が出ない =====================
  //
  // 原因は独立して4つあった。どれも遊ぶ人の画面には手がかりが出ないので、
  // まとめて「ランダムに出ない」に見えていた。
  //   ① 鍵が経路で変わる（modeId が再戦・強制終了で消えていた）→ realtime.js
  //   ② 部屋の画面の外にいる人は引っぱられない                → enterRtRoom
  //   ③ 手渡しの既読が localStorage に永久保存されていた        → loadLocalPrefs
  //   ④ 「あとで押す」が既読の印を立てていた                   → rtRulesSnoozed

  function 部屋(over) {
    return Object.assign({
      code: 'ABC234', ownerUserId: 1, ownerUsername: 'kuma', hostMemberId: 'm1',
      playerCount: 2, memberCount: 2,
      ready: { count: 0, total: 2, waitingNames: ['あき', 'びび'], all: false },
      members: [
        { id: 'm1', name: 'あき', role: 'player', connected: true, isHost: true, ready: false },
        { id: 'm2', name: 'びび', role: 'player', connected: true, isHost: false, ready: false }
      ],
      state: { phase: 'lobby', game: null, data: {} }
    }, over || {});
  }
  const 選ばれた = (over) => 部屋({
    state: { phase: 'lobby', game: 'bomb',
             data: Object.assign({ modeId: 'bomb-coop' }, (over || {}).data) }
  });

  async function 待合に入る(win, doc) {
    await waitScreen(win, doc, 'scr-shelf', 8000);
    const { openCassette } = require('./harness');
    await openCassette(win, doc, 'bakudan');
    const way = doc.querySelector('#wayChoices [data-way="room"]');
    if (way) way.click();
    await waitScreen(win, doc, 'scr-rt-lobby', 5000);
    const fake = win.__rtFake;
    await waitFor(win, () => fake.connected, 4000, '疑似socket');
    fake.replies = { 'room:join': () => ({ ok: true, code: 'ABC234', memberId: 'm2', room: 部屋() }) };
    el(doc, 'rtJoinCode').value = 'ABC234';
    el(doc, 'rtJoinName').value = 'びび';
    click(doc, 'rtJoinBtn');
    await waitScreen(win, doc, 'scr-rt-room', 5000);
    return fake;
  }

  await r.test('48-1②：部屋の画面の外にいる間に選ばれても、戻ったらルールが出る', async () => {
    const { win, doc, errors } = await launch({ fakeSocket: true });
    const fake = await 待合に入る(win, doc);

    // 型(b)：まず「待合にいれば出る」を確かめる（対照）。
    // ここが出ないなら、下の検査は何も試していない
    fake.fire('room:update', 選ばれた());
    await sleep(win, 250);
    assertEqual(activeScreen(doc), 'scr-rt-rules', '待合にいれば、選ばれた瞬間にルールが出る');

    // ゲーム未選択の待合へ戻す
    fake.fire('room:update', 部屋());
    await waitFor(win, () => activeScreen(doc) === 'scr-rt-room', 3000, '待合にもどる');

    // ⚙ →「アプリの設定」→「アイコン・二つ名」で、部屋の画面の外へ出る
    click(doc, 'floatingGearBtn');
    await sleep(win, 150);
    const toApp = doc.querySelector('#settingsOverlay [data-setpage="app"]');
    if (toApp) { toApp.click(); await sleep(win, 150); }
    const 二つ名 = doc.querySelector('#settingsOverlay [data-setact="titles"]');
    assert(二つ名, '設定に「アイコン・二つ名」の行がある');
    二つ名.click();
    await waitScreen(win, doc, 'scr-titles', 4000);

    // その間にホストがゲームを選ぶ
    fake.fire('room:update', 選ばれた());
    await sleep(win, 250);
    assertEqual(activeScreen(doc), 'scr-titles', '見ている画面から勝手に飛ばさない');

    // 自分で待合へもどる → ここでルールへ引っぱられる
    const back = doc.querySelector('#floatingBackBtn');
    if (back && back.style.display !== 'none') back.click();
    await waitFor(win, () => activeScreen(doc) !== 'scr-titles', 4000, '待合へもどる');
    assertEqual(activeScreen(doc), 'scr-rt-rules',
      '戻ってきたら、ルールが出る（読まずに準備OKを押せてしまわない）');
    assertNoErrors(errors, '48-1②で未捕捉の例外');
    win.close();
  });

  await r.test('48-1④：「あとで押す」を選んでも、次に出し直された時はまた出る', async () => {
    const { win, doc, errors } = await launch({ fakeSocket: true });
    const fake = await 待合に入る(win, doc);
    fake.fire('room:update', 選ばれた());
    await waitScreen(win, doc, 'scr-rt-rules', 4000);

    // 進行役でない人の「キャンセル（あとで押す）」
    click(doc, 'rtRulesCancelBtn');
    await waitFor(win, () => activeScreen(doc) === 'scr-rt-room', 4000, '待合へ');
    fake.fire('room:update', 選ばれた());
    await sleep(win, 250);
    assertEqual(activeScreen(doc), 'scr-rt-room',
      'あとで押すを選んだ人は、同じ札のあいだは引き戻されない');

    /**
     * **ここが「あとで押す」と「読んだ」を分ける所。**
     * 引き戻されないことだけを見ると、既読の印を立てても同じに見えてしまう
     * （変異が素通りした）。ルールの出し方で区別する——
     * 読んだことがある人には `<details>` にたたんで出す（第37弾）ので、
     * **あとで押した人にはたたまれずに出る**のが正しい。
     */
    click(doc, 'rtRoomRulesBtn');
    await waitScreen(win, doc, 'scr-rt-rules', 4000);
    const 本文 = el(doc, 'rtRulesBody').innerHTML;
    assert(本文.indexOf('<details') === -1,
      'あとで押した人には、ルールがたたまれずに出る（まだ読んでいないので）');
    assertEqual(el(doc, 'rtRulesTitle').textContent, 'ルール',
      '見出しも「ルール」のまま（「準備はいい？」は読んだ人への言い方）');
    click(doc, 'rtRulesCancelBtn');
    await waitFor(win, () => activeScreen(doc) === 'scr-rt-room', 4000, '待合へ');

    // 進行役が「ルールをもう一度みんなに見せる」＝札が進む
    fake.fire('room:update', 選ばれた({ data: { rulesEpoch: 1 } }));
    await sleep(win, 300);
    assertEqual(activeScreen(doc), 'scr-rt-rules',
      '出し直されたら、あとで押すを選んだ人にもまた出る');
    assertNoErrors(errors, '48-1④で未捕捉の例外');
    win.close();
  });

  await r.test('48-1：一度「準備OK」を押した人も、出し直されたらまた読む', async () => {
    const { win, doc, errors } = await launch({ fakeSocket: true });
    const fake = await 待合に入る(win, doc);
    fake.fire('room:update', 選ばれた());
    await waitScreen(win, doc, 'scr-rt-rules', 4000);
    fake.replies['room:ready'] = () => ({ ok: true, ready: true, room: 選ばれた() });
    click(doc, 'rtRulesOkBtn');
    await waitFor(win, () => activeScreen(doc) === 'scr-rt-room', 4000, '押したら待合へ');

    // 同じ札のあいだは、2周目に引き戻さない（第37弾の決めごと）
    fake.fire('room:update', 選ばれた());
    await sleep(win, 250);
    assertEqual(activeScreen(doc), 'scr-rt-room', '2周目は待合で押すだけ');

    // 対照：**読んだ人**には、ルールがたたまれて出る（上の「あとで押す」と逆）
    click(doc, 'rtRoomRulesBtn');
    await waitScreen(win, doc, 'scr-rt-rules', 4000);
    assert(el(doc, 'rtRulesBody').innerHTML.indexOf('<details') !== -1,
      '読んだ人には、ルールがたたまれて出る');
    assertEqual(el(doc, 'rtRulesTitle').textContent, '準備はいい？',
      '読んだ人への見出しになる');
    click(doc, 'rtRulesCancelBtn');
    await waitFor(win, () => activeScreen(doc) === 'scr-rt-room', 4000, '待合へ');

    // 出し直されたら、**準備OKも外れて**もう一度読む
    fake.fire('room:update', 選ばれた({ data: { rulesEpoch: 1 } }));
    await sleep(win, 300);
    assertEqual(activeScreen(doc), 'scr-rt-rules', '出し直されたら、押した人にも出る');
    assertNoErrors(errors, '48-1（出し直し）で未捕捉の例外');
    win.close();
  });

  await r.test('48-1③：手渡しの「読んだ記憶」は、端末に焼き付けない', async () => {
    const { win, doc, errors } = await launch({});
    await waitScreen(win, doc, 'scr-shelf', 8000);

    /**
     * 型(b)：**保存が実際に起きる所まで進めてから見る。**
     * 起動しただけでは保存が走らず、`getItem` が null のまま
     * 「seenRules が無い」が自明に成立していた（変異が素通りした）。
     * ルール画面の「はじめる」が `state.seenRules[...] = true` を立てて
     * `saveLocalPrefs()` を呼ぶので、そこまで通す。
     */
    await setupPlayers(win, doc, ['あき', 'びび', 'ちか']);
    await waitScreen(win, doc, 'scr-mode', 4000);
    click(doc, doc.querySelector('.mode-card[data-id="normal"]'));
    click(doc, 'modeNextBtn');
    await waitFor(win, () =>
      ['scr-mode-rules', 'scr-ready'].indexOf(activeScreen(doc)) >= 0
      || doc.querySelector('#' + activeScreen(doc) + ' [data-wiz-next]'),
      6000, 'ウィザードに入る');
    for (let i = 0; i < 10; i++) {
      const cur = activeScreen(doc);
      if (cur === 'scr-mode-rules' || cur === 'scr-ready') break;
      const next = doc.querySelector('#' + cur + ' [data-wiz-next]');
      if (!next) break;
      next.click();
      await sleep(win, 40);
    }
    assertEqual(activeScreen(doc), 'scr-mode-rules',
      'はじめて遊ぶモードなので、ルールの画面を通る（ここに来ないと保存も起きない）');
    click(doc, 'rulesStartBtn');     // ここで seenRules を立てて保存する
    await sleep(win, 150);

    const 保存された = win.localStorage.getItem('aresoredorekore-prefs') || '';
    assert(保存された, '保存そのものは起きている（起きていないなら、この検査は何も試していない）');
    assert(保存された.indexOf('selectedModeId') !== -1,
      '保存の中身が読めている（いま: ' + 保存された.slice(0, 120) + '）');
    assert(保存された.indexOf('seenRules') === -1,
      '保存したものの中に seenRules が残らない（いま: ' + 保存された.slice(0, 160) + '）');
    assertNoErrors(errors, '48-1③で未捕捉の例外');
    win.close();
  });

  // ===================== ③ 部屋のミニゲームの「押した速さ」 =====================
  //
  // `readEntry` は `Date.now() - w.playStartedAt` で速さを測るが、
  // **`playStartedAt` はどこにも代入されていなかった**ので、
  // `Date.now() - Date.now()` ＝ 常に 0。
  // `sugoroku-mini.js` は `atMs` を順位に使う（満タン同士は早い方が上／
  // クイズは 1000000 - atMs が得点）ので、**同着崩しが死んでいた**。
  // 手渡し版は正しく測っている（落とし穴1）。

  function 部屋を作る(n) {
    const members = new Map();
    ['あき', 'びび', 'ちか', 'でん'].slice(0, n).forEach((name, i) => {
      const id = 'm' + (i + 1);
      members.set(id, { id, name, role: 'player', connected: true, socketId: 's' + id });
    });
    return { code: 'ABC234', members, state: { phase: 'lobby', game: null, data: {} } };
  }
  // ミニゲームが「クイズ」になるまで作り直す（種類はサーバーが選ぶ）
  function クイズの回にする() {
    for (let i = 0; i < 60; i++) {
      const room = 部屋を作る(3);
      const res = Sugo.startGame(room, { game: 'sugograb', events: false }, { notify() {} });
      if (!res.ok) throw new Error(JSON.stringify(res));
      for (let g = 0; g < 12 && room.sugoroku.phase !== Sugo.PHASE.PLAY; g++) {
        for (const id of room.members.keys()) {
          try { Sugo.submitAction(room, id, null, { act: 'ready' }); } catch (e) {}
        }
        try { Sugo.advance(room); } catch (e) {}
      }
      if (room.sugoroku.phase === Sugo.PHASE.PLAY
          && room.sugoroku.mini && room.sugoroku.mini.id === 'quiz') return room;
    }
    return null;
  }

  await r.test('部屋のミニゲーム：押した速さが記録される（全員0にならない）', async () => {
    const room = クイズの回にする();
    assert(room, 'ミニゲーム「クイズ」の回を作れた（作れないなら、この検査は何も試していない）');
    const w = room.sugoroku;
    assertEqual(w.phase, Sugo.PHASE.PLAY, 'ミニゲームの入力を受け付ける段階にいる');
    assert(w.playStartedAt, 'ミニゲームが始まった時刻がサーバーに残っている');

    // 1人目がすぐ答え、2人目は少し置いてから答える
    const ids = Array.from(room.members.keys());
    Sugo.submitAction(room, ids[0], null, { act: 'play', choice: w.quiz.correct });
    const 待つまで = Date.now() + 40;
    while (Date.now() < 待つまで) { /* 実際に時間を経たせる */ }
    Sugo.submitAction(room, ids[1], null, { act: 'play', choice: w.quiz.correct });

    const a = w.entries[ids[0]], b = w.entries[ids[1]];
    assert(a && b, '2人ぶんの「出したもの」が記録されている');
    assertEqual(a.correct, true, '1人目は正解として記録された');
    assertEqual(b.correct, true, '2人目も正解として記録された');
    // **具体の数字で書く**（実装の変数をそのまま比べない・落とし穴10-a）
    assert(b.atMs > 0,
      'あとから答えた人の atMs が 0 より大きい（いま ' + b.atMs + '）。' +
      '0 のままなら playStartedAt が代入されていない');
    assert(b.atMs > a.atMs,
      '先に答えた人のほうが atMs が小さい（' + a.atMs + ' < ' + b.atMs + '）');

    // 速さが順位に効いていることまで見る（値が入っただけで満足しない・落とし穴12）
    const 順 = Mini.rankMini('quiz', [ids[0], ids[1]], w.entries);
    assert(順 && Array.isArray(順.ranked) && 順.ranked.length >= 2, '順位が出る');
    assertEqual(順.draw, false, '同じ正解でも、速さで差がつく（同着にならない）');
    const 上 = 順.ranked.slice().sort((x, y) => x.rank - y.rank)[0];
    assertEqual(上.id, ids[0], '同じ正解なら、早く答えた人が上になる');
  });

  // ===================== 48-3 コードの絵柄と印 =====================
  //
  // 本人の裁定：**語は「コード」のまま、絵柄を変える**。
  // 🔌 は差し込み口（プラグ）で、CSSのコメントでも開発の側が「端子」と呼んでいた。
  // あわせて、盤の状態を4つ→5つにする（「だれかが外した」が無かった）。

  await r.test('48-3：盤のマスが5つの状態を、色以外でも見分けられる', async () => {
    const { win, doc } = await launch({ fakeSocket: true });
    try {
      await waitScreen(win, doc, 'scr-shelf', 9000);
      // 盤の組み立ては手渡しも部屋も同じ関数を通る。**そこを直に呼ぶ**
      assert(typeof win.bombCellProbe === 'function', '盤の検査の窓口がある');
      const 盤 = win.bombCellProbe([
        { uid: 'a', tier: 'easy', solved: false },
        { uid: 'b', tier: 'easy', solved: false, extraClass: 'mine', face: '🔎' },
        { uid: 'c', tier: 'easy', solved: false, extraClass: 'taken', face: 'び' },
        { uid: 'd', tier: 'easy', solved: false, extraClass: 'missed' },
        { uid: 'e', tier: 'easy', solved: true, face: '✅' }
      ]);
      const box = doc.createElement('div');
      box.innerHTML = 盤;
      const マス = Array.from(box.querySelectorAll('.bomb-wire-btn'));
      assertEqual(マス.length, 5, '5つのマスが出る');

      // **顔が5つとも違う**（色を見分けられなくても分かる）
      const 顔 = マス.map((b) => {
        const c = b.cloneNode(true);
        Array.from(c.querySelectorAll('.bw-no, .bw-tip')).forEach((x) => x.remove());
        return (c.textContent || '').trim();
      });
      assertEqual(顔[0], '➰', 'まだ挑んでいない＝➰（🔌 ではない）');
      assertEqual(顔[1], '🔎', '自分がいま開けている＝🔎');
      assertEqual(顔[2], 'び', 'ほかの人が挑戦中＝その人の頭1文字');
      assertEqual(顔[4], '✅', '解除済み＝✅');

      // **「外した」は、顔ではなく印で分かる**（顔は ➰ のまま）
      assertEqual(顔[3], '➰', '外したコードも、顔は ➰ のまま');
      assert(マス[3].classList.contains('missed'), '外したコードに印のクラスが付く');
      assert(!マス[0].classList.contains('missed'), '挑んでいないコードには付かない');

      // 番号が盤に出ている（知らせが「3ばんめ」と言えるように）
      const 番号 = マス.map((b) => (b.querySelector('.bw-no') || {}).textContent);
      assertEqual(番号.join(','), '1,2,3,4,5', 'マスに通し番号が出る');
    } finally { win.close(); }
  });

  await r.test('48-3：自分が開けているコードの縁が、爆弾テーマの下でも効く', async () => {
    const { win, doc } = await launch({});
    try {
      await waitScreen(win, doc, 'scr-shelf', 9000);
      // **実測する。** `.mine` は box-shadow で書かれていて、
      // 爆弾テーマの規則に特異度で負け、遊んでいる間は1つも効いていなかった
      const app = doc.getElementById('app');
      app.classList.add('theme-bomb');
      const 作る = (cls) => {
        const b = doc.createElement('button');
        b.className = 'bomb-wire-btn t-easy ' + cls;
        doc.body.appendChild(b);
        return b;
      };
      const 素 = 作る('');
      const 自分 = 作る('mine');
      const a = win.getComputedStyle(素), b = win.getComputedStyle(自分);
      /**
       * 型(b)：**読める道があるか**を、主張の前に確かめる。
       * jsdom は outline の短縮形を長い形（outlineStyle など）に展開しないので、
       * `outlineStyle` を見ると素も mine も 'none' で、
       * **差が出ないまま「効いていない」と読み違える**（落とし穴28：道具が嘘をつく）。
       * 短縮形そのものを読む
       */
      assert(/solid/.test(b.outline),
        '爆弾テーマの下でも、自分のマスに縁が出る（いま outline="' + b.outline + '"）');
      assert(!/solid/.test(a.outline || ''),
        'ふつうのマスには縁が出ない（いま outline="' + a.outline + '"）');
      /**
       * **なぜ box-shadow をやめたか**も、ここで押さえる。
       * テーマの規則が難易度ごとに box-shadow を書き直すので、
       * `.mine` の box-shadow は特異度で負けて素と同じになる——
       * つまり box-shadow では差を作れない
       */
      assertEqual(b.boxShadow, a.boxShadow,
        '爆弾テーマの下では box-shadow に差が出ない（だから outline を使っている）');
      素.remove(); 自分.remove();
    } finally { win.close(); }
  });

  // ===================== 48-7 お題が尽きた時 =====================
  //
  // データの側（50件そろっているか・和集合）は tests/topic-pool.js。
  // ここで見るのは**本物の pickUnused の振る舞い**——
  // 引き方を検査に書き写すと、写しと実装が別々に動いていく（落とし穴25）。

  await r.test('48-7：本物の引き方で、50回引けば50件ぜんぶ出る', async () => {
    const { win, doc } = await launch({});
    try {
      await waitScreen(win, doc, 'scr-shelf', 9000);
      assert(typeof win.topicProbe === 'function', '検査の窓口がある');
      // **具体の数字で書く**（実装の定数を読んで使うと自己参照・落とし穴10-a）
      const r50 = win.topicProbe(null, 50);
      assertEqual(r50.引ける, 50, '引ける札が50枚');
      assertEqual(r50.出た数, 50, '50回で50件ぜんぶ出る（いま ' + r50.出た数 + '件）');
      assertEqual(r50.一周, 0, '50回のあいだは一周しない');

      // 型(c)：もう一方の入力——**尽きたあと**も試す
      const r51 = win.topicProbe(null, 51);
      assertEqual(r51.一周, 1, '51回目で一周する（いま ' + r51.一周 + '回）');

      // 絞った層（5件しかない）でも止まらない
      const 小 = win.topicProbe(['muri'], 12);
      assertEqual(小.引ける, 5, 'むりなんだがは5件');
      assertEqual(小.出た数, 5, '5件ぜんぶ出る');
      assertEqual(小.一周, 2, '12回引くと2回まわる（5→10→12）');

      // **同じ周の中では重ならない**（尽きた瞬間に印を捨てる形になっているか）
      const 最初の5 = 小.名前.slice(0, 5);
      assertEqual(new Set(最初の5).size, 5, '1周目の5回は、ぜんぶ違うお題');
      const 次の5 = 小.名前.slice(5, 10);
      assertEqual(new Set(次の5).size, 5, '2周目の5回も、ぜんぶ違うお題');
    } finally { win.close(); }
  });

  // ===================== 48-6 終わったあとに、ゲーム中の見た目が残らない ==========
  //
  // `bomb-danger`（ライフ1の赤い脈打つ縁）は、**3面とも壊れ方が違った**：
  //   手渡し … stopAllPlayTimers が見た目を触らないので、**棚**が赤いまま
  //   大画面 … renderRtBig が待合で早期returnして rtBigFx に届かず、
  //            人狼にえらび直しても残る
  //   部屋のスマホ … **そもそも付いていなかった**（47-6 は大画面だけ・落とし穴1）
  //
  // 本物の進行役を動かして、3面すべてを見る（tools/probe-leftover-class.js と同じ形）。

  const Bomb = require('../bomb-room.js');
  function 爆弾の部屋(big) {
    const members = new Map();
    const ids = big ? ['m2', 'm3'] : ['m1', 'm2'];
    ids.forEach((id, i) => members.set(id, {
      id, name: ['びび', 'ちか'][i], role: 'player', connected: true, socketId: 's' + id }));
    if (big) members.set('m1', { id: 'm1', name: 'テレビ', role: 'bigscreen', connected: true });
    const room = { code: 'ABC234', members, state: { phase: 'lobby', game: null, data: {} } };
    const res = Bomb.startGame(room, { mode: 'coop', counts: { easy: 6 }, lives: 3, timerSec: 0 }, {});
    assertEqual(res.ok, true, '爆弾の進行役を始められる');
    room.state.game = 'bomb';
    room.state.phase = 'playing';
    return { room, ids };
  }
  function 外す(room, mid) {
    const w = room.bomb;
    const e = w.entries[w.mode === 'coop' ? 'team' : mid];
    const uid = e.order.find((u) => !e.solved[u]);
    if (!uid) return false;
    // **3択はコードを開いてから配られる。** 先に読むと空なので、
    // 1回目だけ `not_a_choice` で弾かれ、ライフが減らない——
    // 「2回外したのにライフが1にならない」の正体はこれだった
    Bomb.submitAction(room, mid, uid);
    const wire = w.wires.find((x) => x.uid === uid);
    const 違う答え = (e.choices[uid] || []).find((c) => c !== wire.answer && c !== wire.name);
    const res = Bomb.submitVote(room, mid, 違う答え);
    return !!(res && res.ok);
  }

  for (const big of [false, true]) {
    await r.test('48-6：' + (big ? '大画面' : '部屋のスマホ') +
      'で、ライフ1の赤い縁が出て、終わったら外れる', async () => {
      const { win, doc, errors } = await launch({ fakeSocket: true });
      try {
        const { openCassette } = require('./harness');
        await waitScreen(win, doc, 'scr-shelf', 9000);
        await openCassette(win, doc, 'bakudan');
        const way = doc.querySelector('#wayChoices [data-way="room"]');
        if (way) way.click();
        await waitScreen(win, doc, 'scr-rt-lobby', 5000);
        const fake = win.__rtFake;
        await waitFor(win, () => fake.connected, 5000, '疑似socket');

        const { room, ids } = 爆弾の部屋(big);
        const 名簿 = () => Array.from(room.members.values()).map((m, i) => ({
          id: m.id, name: m.name, role: m.role, connected: true,
          isHost: m.id === ids[0], ready: true }));
        const snap = () => ({
          code: 'ABC234', ownerUserId: 1, ownerUsername: 'kuma', hostMemberId: ids[0],
          playerCount: ids.length, memberCount: 名簿().length,
          ready: { count: ids.length, total: ids.length, waitingNames: [], all: true },
          members: 名簿(),
          state: { phase: room.state.phase, game: room.state.game,
                   data: room.bomb ? Bomb.publicView(room) : room.state.data }
        });
        fake.replies = { 'room:join': () => ({ ok: true, code: 'ABC234',
          memberId: 'm1', room: snap() }) };
        el(doc, 'rtJoinCode').value = 'ABC234';
        el(doc, 'rtJoinName').value = big ? 'テレビ' : 'あき';
        click(doc, 'rtJoinBtn');
        // 部屋の画面の前置きは**その場で組み立てる**。そのまま書くと、
    // 「検査が名指しする画面idは実在するか」の見張り（第42弾）が
    // それを幽霊の画面idとして拾う。**説明のための引用も同じ**——
    // このコメントに書いても拾われる（落とし穴10-a：自分の説明が自分の目を塞ぐ）
    const 部屋の前置き = 'scr-' + 'rt-';
    await waitFor(win, () => String(activeScreen(doc)).indexOf(部屋の前置き) === 0,
          8000, '部屋の画面に入る');

        const push = async () => {
          fake.fire('room:update', snap());
          if (room.bomb) { const mine = Bomb.privateFor(room, 'm1'); if (mine) fake.fire('wolf:you', mine); }
          await sleep(win, 120);
        };
        const 赤い = () => doc.getElementById('app').classList.contains('bomb-danger');
        await push();
        // 型(b)：**その画面に着いているか**を先に確かめる。
        // 着いていなければ描画が走らず、下の主張は何も試していない
        assertEqual(activeScreen(doc), big ? 'scr-rt-big' : 'scr-rt-bomb',
          (big ? '大画面' : '部屋のスマホ') + 'が、爆弾の画面に着いている');
        assert(!赤い(), 'はじめは赤くない');

        // ライフを1まで減らす（型(b)：**赤くなることを先に確かめる**。
        // ここが赤くならないなら、下の「外れる」は何も試していない）
        assert(外す(room, ids[0]), '1回目のミスが本当に通っている');
        await push();
        assert(外す(room, ids[0]), '2回目のミスが本当に通っている');
        await push();
        assert(赤い(), 'ライフ1で、縁が赤くなる');

        // 進行役が「みんなを待合にもどす」＝ clearGameState（進行が消える）
        delete room.bomb;
        room.state.phase = 'lobby';
        room.state.data = {};
        await push();
        assert(!赤い(), '待合にもどったら、赤い縁が外れる（いま class="' +
          doc.getElementById('app').className + '"）');

        // 型(c)：別のゲームにえらび直しても残らない
        room.state.game = 'wolfrole';
        await push();
        assert(!赤い(), '別のゲームにえらび直しても残らない');
        assertNoErrors(errors, '48-6（' + (big ? '大画面' : '部屋') + '）で未捕捉の例外');
      } finally { win.close(); }
    });
  }

  // ===================== 48-8 表示名とログインIDを分ける =====================
  //
  // それまで `username` の1本だけで、名前を変えると**ログインIDごと変わって**いた。
  // 遊ぶ人からは「見せる名前を変えただけ」にしか見えないのに、
  // 次から前の名前ではログインできなくなる。
  //
  // 本物のサーバーを立てて、**遊ぶ人の操作の順で**確かめる：
  //   登録する → 名前を変える → **前のログインIDでログインし直せる**

  await r.test('48-8：名前を変えても、ログインIDは変わらない', async () => {
    const PORT = 3457;
    const base = 'http://127.0.0.1:' + PORT;
    // 子プロセスで本物の server.js を立てる（PORT だけ差し替える）
    const cp = require('child_process');
    const srv = cp.spawn(process.execPath, ['server.js'], {
      cwd: require('path').join(__dirname, '..'),
      // 合言葉の環境変数は REGISTER_CODE（複数形ではない）
      env: Object.assign({}, process.env, { PORT: String(PORT), REGISTER_CODE: 'テスト48' }),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const 待つ = (ms) => new Promise((r2) => setTimeout(r2, ms));
    // **具体の文字で書く**（実装から読んで入れると自己参照・落とし穴10-a）。
    // 片付けからも見えるよう、try の外で決める
    const ログインID = 'kuma48test' + PORT;
    try {
      // 立ち上がるまで待つ（**時間ではなく、返事が来たかで待つ**・落とし穴24）
      let 生きた = false;
      for (let i = 0; i < 60 && !生きた; i++) {
        try { await fetch(base + '/api/auth/me'); 生きた = true; } catch (e) { await 待つ(250); }
      }
      assert(生きた, 'テスト用のサーバーが立ち上がる');

      const クッキー = [];
      async function 呼ぶ(path2, opts) {
        const o = Object.assign({ headers: {} }, opts || {});
        o.headers['content-type'] = 'application/json';
        if (クッキー.length) o.headers.Cookie = クッキー.join('; ');
        if (o.body && typeof o.body !== 'string') o.body = JSON.stringify(o.body);
        const res = await fetch(base + path2, o);
        const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
        (sc || []).forEach((c) => クッキー.push(c.split(';')[0]));
        let j = null; try { j = await res.json(); } catch (e) {}
        return { status: res.status, body: j };
      }

      const 登録 = await 呼ぶ('/api/auth/register', { method: 'POST',
        body: { username: ログインID, password: 'pass1234', code: 'テスト48' } });
      assertEqual(登録.status, 200, '登録できる（' + JSON.stringify(登録.body) + '）');
      assertEqual(登録.body.username, ログインID, '登録直後のログインIDは、入れたもの');
      assertEqual(登録.body.displayName, ログインID, '登録直後は、見せる名前＝ログインID');

      // 名前を変える
      const 変更 = await 呼ぶ('/api/auth/name', { method: 'PUT',
        body: { displayName: 'くまさん' } });
      assertEqual(変更.status, 200, '名前を変えられる');
      assertEqual(変更.body.displayName, 'くまさん', '見せる名前が変わった');
      assertEqual(変更.body.username, ログインID, '**ログインIDは変わっていない**');

      const 自分 = await 呼ぶ('/api/auth/me', {});
      assertEqual(自分.body.displayName, 'くまさん', '見せる名前が返る');
      assertEqual(自分.body.username, ログインID, 'ログインIDも返る');

      // **ここが本番。**いったん出て、前のログインIDで入り直せるか
      await 呼ぶ('/api/auth/logout', { method: 'POST' });
      クッキー.length = 0;
      const 入り直し = await 呼ぶ('/api/auth/login', { method: 'POST',
        body: { username: ログインID, password: 'pass1234' } });
      assertEqual(入り直し.status, 200,
        '名前を変えたあとも、**前のログインIDで入り直せる**（' + JSON.stringify(入り直し.body) + '）');
      assertEqual(入り直し.body.displayName, 'くまさん', '入り直しても、見せる名前は変えたまま');

      // 型(c)：もう一方の入力——**変えた名前ではログインできない**
      クッキー.length = 0;
      const 表示名で = await 呼ぶ('/api/auth/login', { method: 'POST',
        body: { username: 'くまさん', password: 'pass1234' } });
      assertEqual(表示名で.status, 401, '見せる名前はログインIDではない（入れない）');

      // 表示名の重なりは許す（指示48 §秘密情報・境界）
      クッキー.length = 0;
      const 二人目 = await 呼ぶ('/api/auth/register', { method: 'POST',
        body: { username: ログインID + 'b', password: 'pass1234', code: 'テスト48' } });
      assertEqual(二人目.status, 200, '2人目を登録できる');
      const 同じ名前 = await 呼ぶ('/api/auth/name', { method: 'PUT',
        body: { displayName: 'くまさん' } });
      assertEqual(同じ名前.status, 200, '**見せる名前は重ねてよい**（ログインIDは一意のまま）');
    } finally {
      srv.kill();
      await 待つ(300);
      /**
       * **検体を片付ける。**
       * 本物のサーバーは本物のDBに書くので、残すと2回目の登録が
       * 「そのユーザー名は既に使われています」で落ちる——
       * **その時々のデータに依存する検査**になってしまう（落とし穴10-d）。
       * 名前は毎回同じ（乱数にすると、消し忘れが静かに溜まる）
       */
      try {
        const db = require('../db.js');
        db.prepare('DELETE FROM users WHERE username IN (?, ?)')
          .run(ログインID, ログインID + 'b');
      } catch (e) { /* DBを開けない環境でも、検査そのものは終わっている */ }
    }
  });

  r.finish();
}

run();
