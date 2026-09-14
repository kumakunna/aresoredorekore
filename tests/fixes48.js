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
  fillPlayerForm, pickGame } = require('./harness');

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
    await sleep(win, 60);
    const 前 = 秒(el(doc, 'wrNightTimer').textContent);
    assert(前 !== null, '夜の時計が読める');

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

    // 出し直されたら、**準備OKも外れて**もう一度読む
    fake.fire('room:update', 選ばれた({ data: { rulesEpoch: 1 } }));
    await sleep(win, 300);
    assertEqual(activeScreen(doc), 'scr-rt-rules', '出し直されたら、押した人にも出る');
    assertNoErrors(errors, '48-1（出し直し）で未捕捉の例外');
    win.close();
  });

  await r.test('48-1③：手渡しの「読んだ記憶」は、端末に焼き付けない', async () => {
    const { win, doc } = await launch({});
    await waitScreen(win, doc, 'scr-shelf', 8000);
    // **具体の鍵で見る**（実装の定数を読んで使うと自己参照・落とし穴10-a）
    win.localStorage.setItem('aresoredorekore-prefs',
      JSON.stringify({ seenRules: { 'bomb-coop': true, normal: true }, selectedModeId: 'normal' }));
    win.close();

    const b = await launch({});
    await waitScreen(b.win, b.doc, 'scr-shelf', 8000);
    const 保存された = b.win.localStorage.getItem('aresoredorekore-prefs') || '';
    assert(保存された.indexOf('seenRules') === -1,
      '保存したものの中に seenRules が残らない（いま: ' + 保存された.slice(0, 120) + '）');
    b.win.close();
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

  r.finish();
}

run();
