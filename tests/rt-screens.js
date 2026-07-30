// tests/rt-screens.js — 1人1台モードの画面（第21弾 第6・7部）
//
// 通信そのものは tests/realtime-wolf.js（本物のサーバー＋複数接続）で見ている。
// ここで見るのは「サーバーから届いたものを、画面が正しく出し分けるか」。
// jsdom には socket.io が無いので、ハーネスの疑似socketでイベントを流し込む。

const H = require('./harness');
const { launch, activeScreen, sleep, waitFor, waitScreen, el, click, fillPlayerForm,
  pickGame, createRunner, assert, assertEqual, assertNoErrors } = H;

const LAUNCH = { fakeSocket: true };

// 部屋に入った状態まで進める。room は疑似サーバーが返す部屋の中身
function roomSnapshot(over) {
  return Object.assign({
    code: 'ABC234', ownerUserId: 1, ownerUsername: 'kuma',
    hostMemberId: 'm1', playerCount: 5, memberCount: 5,
    members: [
      { id: 'm1', name: 'あき', role: 'player', connected: true, isHost: true },
      { id: 'm2', name: 'びび', role: 'player', connected: true, isHost: false },
      { id: 'm3', name: 'ちか', role: 'player', connected: true, isHost: false },
      { id: 'm4', name: 'でん', role: 'player', connected: true, isHost: false },
      { id: 'm5', name: 'えみ', role: 'player', connected: true, isHost: false }
    ],
    // 第26弾-3：待合でホストがゲームを選ぶと、サーバーが state.game を全員に配る。
    // ここのテストはどれも人狼の部屋なので、選び終わった状態を既定にしておく
    state: { phase: 'lobby', game: 'wolfrole', data: {} }
  }, over || {});
}
function wolfView(over) {
  return Object.assign({
    phase: 'roleReveal', turn: 1, turnLimit: 5,
    counts: { wolf: 1, seer: 1 }, aliveCount: 5,
    players: [
      { id: 'm1', name: 'あき', alive: true, role: null },
      { id: 'm2', name: 'びび', alive: true, role: null },
      { id: 'm3', name: 'ちか', alive: true, role: null },
      { id: 'm4', name: 'でん', alive: true, role: null },
      { id: 'm5', name: 'えみ', alive: true, role: null }
    ],
    waiting: ['びび', 'ちか'], deadline: null
  }, over || {});
}

// 第26弾-3：棚の「部屋」→ 立てる／参加する → 待合。
// 何を遊ぶかは部屋に入ってから選ぶ（部屋はカセットに紐づかない箱）
async function toRoom(win, doc, opts) {
  opts = opts || {};
  click(doc, 'shelfRoomBtn');
  await waitScreen(win, doc, 'scr-rt-lobby', 3000);

  const fake = win.__rtFake;
  await waitFor(win, () => fake.connected, 3000, '疑似socketがつながる');

  const memberId = opts.memberId || 'm1';
  const role = opts.role || 'player';
  fake.replies = {
    'room:create': () => ({ ok: true, code: 'ABC234', memberId, room: roomSnapshot() }),
    'room:join': () => ({ ok: true, code: 'ABC234', memberId, room: roomSnapshot() })
  };
  if (opts.join) {
    el(doc, 'rtJoinCode').value = 'ABC234';
    el(doc, 'rtJoinName').value = 'びび';
    if (role === 'bigscreen') click(doc, doc.querySelector('#rtJoinRoleSeg [data-rtrole="bigscreen"]'));
    click(doc, 'rtJoinBtn');
  } else {
    el(doc, 'rtCreateName').value = 'あき';
    click(doc, 'rtCreateBtn');
  }
  await waitFor(win, () => ['scr-rt-room','scr-rt-big'].indexOf(activeScreen(doc)) >= 0, 4000, '部屋の画面に入る');
  if (opts.pick !== false && !opts.join && role !== 'bigscreen') {
    await pickGameForRoom(win, doc, opts.game || 'wolfrole');
  }
  return fake;
}

// 第27弾：ゲームがどのカセットに入っているか。
// 1つしか入っていないカセットはゲーム選択画面を飛ばすので、歩き方が変わる
const CASSETTE_OF = { wolfrole: 'jinro', wordwolf: 'jinro', bomb: 'bakudan' };

// 待合から棚へ出て、カセット→（ゲーム）→モードを歩いて待合にもどる（ホストの流れ）
async function pickGameForRoom(win, doc, gameId, modeId) {
  click(doc, 'rtPickGameBtn');
  await waitScreen(win, doc, 'scr-shelf', 3000);
  const cart = doc.querySelector('.cart[data-cart="' + (CASSETTE_OF[gameId] || 'jinro') + '"]');
  assert(cart, gameId + ' のカセットが棚にある');
  cart.click();
  if (activeScreen(doc) === 'scr-shelf') cart.click();
  // ゲームが1つだけのカセットは、選択画面を通らずモードへ進む
  if (activeScreen(doc) === 'scr-game') {
    pickGame(doc, gameId);
  }
  await waitScreen(win, doc, 'scr-mode', 3000);
  if (modeId) click(doc, doc.querySelector('.mode-card[data-id="' + modeId + '"]'));
  click(doc, 'modeAutoBtn');
  await sleep(win, 100);
  if (activeScreen(doc) === 'scr-mode-rules') { click(doc, 'rulesStartBtn'); await sleep(win, 80); }
  await waitScreen(win, doc, 'scr-rt-room', 3000);
}

// ---- 第27弾：クイズ解除の部屋 ----
// サーバー（bomb-room.js）が配る形をそのまま真似る。
// 公開情報にお題の名前・説明文が入っていないのは realtime-bomb.js で見ているので、
// ここでは「届いたものを画面がどう出すか」だけを見る
function bombView(over) {
  return Object.assign({
    phase: 'play', mode: 'coop', endWhen: 'first', layout: 'sorted',
    total: 4, livesMax: 3, timerSec: 180,
    prep: { ready: 4, dropped: 0, total: 4 },
    team: { solved: 1, total: 4, pct: 25, lives: 2, livesMax: 3, misses: 1 },
    board: [
      { uid: 'w0', tier: 'easy', solved: true, solvedBy: 'あき', by: null },
      { uid: 'w1', tier: 'easy', solved: false, solvedBy: null, by: 'びび' },
      { uid: 'w2', tier: 'normal', solved: false, solvedBy: null, by: null },
      { uid: 'w3', tier: 'hard', solved: false, solvedBy: null, by: null }
    ],
    players: [
      { id: 'm1', name: 'あき', connected: true, solved: 1, total: 4, pct: 25, lives: 2, livesMax: 3, misses: 1, failed: false, timedOut: false, finished: false, working: null, remainingMs: 120000 },
      { id: 'm2', name: 'びび', connected: true, solved: 1, total: 4, pct: 25, lives: 2, livesMax: 3, misses: 1, failed: false, timedOut: false, finished: false, working: 'easy', remainingMs: 120000 }
    ],
    remainingMs: 120000
  }, over || {});
}
function bombYou(over) {
  return Object.assign({
    phase: 'play', mode: 'coop', total: 4, solvedCount: 1,
    lives: 2, livesMax: 3, misses: 1,
    failed: false, timedOut: false, finished: false,
    remainingMs: 120000, layout: 'sorted',
    prep: { ready: 4, dropped: 0, total: 4 },
    board: bombView().board
  }, over || {});
}
function bombRoom(over) {
  return roomSnapshot(Object.assign({
    playerCount: 2, memberCount: 2,
    members: [
      { id: 'm1', name: 'あき', role: 'player', connected: true, isHost: true },
      { id: 'm2', name: 'びび', role: 'player', connected: true, isHost: false }
    ],
    state: { phase: 'play', game: 'bomb', data: bombView() }
  }, over || {}));
}

// サーバーからの配信を流し込む
function push(fake, room) { fake.fire('room:update', room); }
function pushYou(fake, you) { fake.fire('wolf:you', you); }

(async function main() {
  const r = createRunner('rt-screens：1人1台の画面');

  await r.test('部屋の画面：コードと参加者が出て、進行役だけが始められる', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc);
    assertEqual(el(doc, 'rtRoomCode').textContent, 'ABC234', '部屋コードが大きく出る');
    assertEqual(el(doc, 'rtRoomCount').textContent, '5人', '人数が出る');
    const rows = doc.querySelectorAll('#rtMemberList .rt-member');
    assertEqual(rows.length, 5, '参加者がそのまま名簿になる');
    assert(/進行役/.test(rows[0].textContent), '進行役が分かる');
    assert(/あなた/.test(rows[0].textContent), '自分が分かる');
    assert(!el(doc, 'rtStartBtn').disabled, '進行役なら始められる');

    // 進行役でなければ押せない
    push(fake, roomSnapshot({ hostMemberId: 'm2' }));
    await sleep(win, 60);
    assert(el(doc, 'rtStartBtn').disabled, '進行役でなければ始められない');
    assert(/待っています/.test(el(doc, 'rtRoomNote').textContent), '待つように出る');
    assertNoErrors(errors, '部屋の画面で未捕捉の例外');
    win.close();
  });

  await r.test('部屋の画面：人数が足りないと始められない', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc);
    push(fake, roomSnapshot({ playerCount: 2, members: roomSnapshot().members.slice(0, 2) }));
    await sleep(win, 60);
    assert(el(doc, 'rtStartBtn').disabled, '2人では始められない');
    assert(/人以上そろうと/.test(el(doc, 'rtRoomNote').textContent),
      '何人必要か分かる（' + el(doc, 'rtRoomNote').textContent + '）');
    assertNoErrors(errors, '人数不足で未捕捉の例外');
    win.close();
  });

  await r.test('自分の端末：役職を確認し、夜は選んで、結果を受け取る', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc);

    // 役職確認
    push(fake, roomSnapshot({ state: { phase: 'roleReveal', game: 'wolfrole', data: wolfView() } }));
    pushYou(fake, {
      phase: 'roleReveal', roleId: 'seer', roleName: '占い師', roleDesc: '夜に1人を占います。',
      alive: true, done: false, info: null, choices: []
    });
    await waitScreen(win, doc, 'scr-rt-play', 4000);
    assert(/占い師/.test(el(doc, 'rtYouBox').textContent), '自分の役職が出る');
    assertEqual(el(doc, 'rtChoiceGrid').style.display, 'none', 'この段階では選ばない');
    assert(el(doc, 'rtConfirmBtn').style.display !== 'none', '確認ボタンが出る');
    click(doc, 'rtConfirmBtn');
    await sleep(win, 60);
    const acted = fake.emits.filter(e => e.name === 'wolf:act');
    assertEqual(acted.length, 1, '確認をサーバーに送る');
    assertEqual(acted[0].payload.targetId, null, '選んでいないので targetId は空');

    // 夜：選ぶ
    push(fake, roomSnapshot({ state: { phase: 'night', game: 'wolfrole', data: wolfView({ phase: 'night' }) } }));
    pushYou(fake, {
      phase: 'night', roleId: 'seer', roleName: '占い師', roleDesc: '', alive: true, done: false,
      action: 'divine', info: null,
      choices: [{ id: 'm2', name: 'びび' }, { id: 'm3', name: 'ちか' }]
    });
    await sleep(win, 80);
    assertEqual(el(doc, 'rtChoiceGrid').style.display, 'flex', '選ぶ相手が出る');
    assertEqual(doc.querySelectorAll('#rtChoiceGrid button').length, 2, '選択肢が並ぶ');
    doc.querySelector('#rtChoiceGrid button').click();
    await sleep(win, 60);
    const divined = fake.emits.filter(e => e.name === 'wolf:act');
    assertEqual(divined.length, 2, '選んだ相手を送る');
    assertEqual(divined[1].payload.targetId, 'm2', '選んだ相手が正しい');

    // 結果が届く
    pushYou(fake, {
      phase: 'night', roleId: 'seer', roleName: '占い師', roleDesc: '', alive: true, done: true,
      info: { kind: 'divine', targetName: 'びび', result: { label: '人狼側' } }, choices: []
    });
    await sleep(win, 80);
    assert(/占いの結果/.test(el(doc, 'rtYouBox').textContent), 'その場で結果が出る');
    assert(/びび は 人狼側/.test(el(doc, 'rtYouBox').textContent.replace(/\s+/g, ' ')), '中身も出る');
    assert(/まだの人/.test(el(doc, 'rtWaitNote').textContent), '誰を待っているか分かる');
    assertNoErrors(errors, '自分の端末で未捕捉の例外');
    win.close();
  });

  await r.test('自分の端末：行動が無い人にも同じ形の画面が出る', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc);
    push(fake, roomSnapshot({ state: { phase: 'night', game: 'wolfrole', data: wolfView({ phase: 'night' }) } }));
    pushYou(fake, {
      phase: 'night', roleId: 'villager', roleName: '村人', roleDesc: '特別な力はありません。',
      alive: true, done: false, info: null, choices: []
    });
    await waitScreen(win, doc, 'scr-rt-play', 4000);
    assert(el(doc, 'rtConfirmBtn').style.display !== 'none', '確認ボタンで同じ手数になる');
    assertEqual(el(doc, 'rtChoiceGrid').style.display, 'none', '選ぶものは無い');
    assertEqual(el(doc, 'rtPhase').textContent, '夜', '同じ見出しが出る');
    assertNoErrors(errors, '行動なしの画面で未捕捉の例外');
    win.close();
  });

  await r.test('自分の端末：朝と結果は、進行役だけが進められる', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc);
    const morning = wolfView({
      phase: 'day', aliveCount: 4,
      morning: { deaths: [{ name: 'でん', cause: 'attacked', role: '村人' }], attackOverlap: false }
    });
    push(fake, roomSnapshot({ state: { phase: 'day', game: 'wolfrole', data: morning } }));
    pushYou(fake, { phase: 'day', roleId: 'seer', roleName: '占い師', roleDesc: '', alive: true, done: false, choices: [] });
    await waitScreen(win, doc, 'scr-rt-play', 4000);
    assert(/でん/.test(el(doc, 'rtPublicBox').textContent), '欠けた人が出る');
    assert(/襲われた/.test(el(doc, 'rtPublicBox').textContent), '原因も出る');
    assert(el(doc, 'rtNextBtn').style.display !== 'none', '進行役には進むボタンが出る');
    assertEqual(el(doc, 'rtNextBtn').textContent, '投票へすすむ ▶', 'ボタンの文言');

    // 進行役でない端末には出さない
    push(fake, roomSnapshot({ hostMemberId: 'm3', state: { phase: 'day', game: 'wolfrole', data: morning } }));
    await sleep(win, 80);
    assertEqual(el(doc, 'rtNextBtn').style.display, 'none', '進行役以外には出さない');
    assert(/進行役が/.test(el(doc, 'rtWaitNote').textContent), '待つように出る');
    assertNoErrors(errors, '朝の画面で未捕捉の例外');
    win.close();
  });

  await r.test('大画面：公開情報だけを大きく出し、役職は決着まで出さない', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm5', role: 'bigscreen' });
    // 大画面として参加した端末は、大画面の画面へ行く
    push(fake, roomSnapshot({
      members: roomSnapshot().members.map(m => m.id === 'm5' ? Object.assign({}, m, { role: 'bigscreen' }) : m),
      playerCount: 4,
      state: { phase: 'night', game: 'wolfrole', data: wolfView({ phase: 'night' }) }
    }));
    await waitScreen(win, doc, 'scr-rt-big', 4000);
    assertEqual(el(doc, 'bigPhase').textContent, '夜', 'いまのフェーズが大きく出る');
    assert(/1 \/ 5/.test(el(doc, 'bigTurn').textContent), 'ターン数が出る');
    assert(/まだの人/.test(el(doc, 'bigSub').textContent), '誰を待っているかは公開情報なので出す');
    // 生死は出るが、役職は出さない
    const items = doc.querySelectorAll('#bigList .bl-item');
    assertEqual(items.length, 5, '全員が並ぶ');
    const txt = el(doc, 'scr-rt-big').textContent;
    ['占い師', '人狼', '騎士', '霊媒師'].forEach(n => {
      assert(txt.indexOf(n) === -1, '役職名を出さない（' + n + '）');
    });

    // 決着したら、そこで初めて役職が出る
    push(fake, roomSnapshot({
      members: roomSnapshot().members.map(m => m.id === 'm5' ? Object.assign({}, m, { role: 'bigscreen' }) : m),
      state: { phase: 'ended', game: 'wolfrole', data: wolfView({
        phase: 'ended',
        result: {
          winner: 'village', reason: null, teruteruWin: false,
          roles: [{ name: 'あき', role: 'wolf', roleName: '人狼', alive: false },
                  { name: 'びび', role: 'seer', roleName: '占い師', alive: true }],
          scores: {}
        }
      }) }
    }));
    await sleep(win, 100);
    assert(/村人陣営の勝ち/.test(el(doc, 'bigMain').textContent), '勝った陣営が出る');
    assert(/人狼/.test(el(doc, 'bigSub').textContent), '決着したので役職が出る');
    assertNoErrors(errors, '大画面で未捕捉の例外');
    win.close();
  });

  await r.test('大画面：始まる前は部屋コードを大きく出す', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm5', role: 'bigscreen' });
    // 待合の間も、大画面はコードを出しておきたい
    push(fake, roomSnapshot({
      members: roomSnapshot().members.map(m => m.id === 'm5' ? Object.assign({}, m, { role: 'bigscreen' }) : m),
      playerCount: 4
    }));
    await sleep(win, 100);
    assertEqual(el(doc, 'bigMain').textContent, 'ABC234', '部屋コードを大きく出す');
    assert(/参加/.test(el(doc, 'bigSub').textContent), '入り方の案内が出る');
    const names = Array.from(doc.querySelectorAll('#bigList .bl-item')).map(x => x.textContent);
    assert(names.indexOf('えみ') === -1, '大画面自身は名簿に出さない（人数に数えないため）');
    assertNoErrors(errors, '待合の大画面で未捕捉の例外');
    win.close();
  });

  // ---- 第22弾 第1部／第26弾 第2部：ゲームに紐づかない参加の入り口 ----
  await r.test('棚の「部屋」ボタンから、立てるにも参加するにも進める', async () => {
    const b = await launch(LAUNCH);
    await waitScreen(b.win, b.doc, 'scr-shelf', 4000);
    assert(b.doc.getElementById('shelfRoomBtn'), '棚に「部屋」ボタンがある');
    click(b.doc, 'shelfRoomBtn');
    await waitScreen(b.win, b.doc, 'scr-rt-lobby', 3000);
    assert(b.doc.getElementById('rtJoinCode'), '部屋コードを入れられる');
    assert(b.doc.getElementById('rtJoinName'), '名前を入れられる');
    assertEqual(el(b.doc, 'rtCreateCard').style.display, '', '棚からは「立てる」も出る');
    // どのカセットにも属さない画面なので、前のテーマを引きずらない
    assert(!el(b.doc, 'app').classList.contains('theme-wolf'), '前のカセットのテーマが乗らない');
    click(b.doc, 'rtLobbyBackBtn');
    await waitScreen(b.win, b.doc, 'scr-shelf', 3000);
    assertNoErrors(b.errors, '棚からの部屋で未捕捉の例外');
    b.win.close();
  });

  await r.test('呼ばれて入るだけの人には「部屋をつくる」を出さない', async () => {
    // QRから来た人・ログイン画面から来た人は、部屋を立てには来ていない
    const { win, doc, errors } = await launch(Object.assign({}, LAUNCH, { url: 'http://localhost/?room=ABC234' }));
    await waitScreen(win, doc, 'scr-rt-lobby', 4000);
    assertEqual(el(doc, 'rtJoinCode').value, 'ABC234', 'QRのコードが入っている');
    assertEqual(el(doc, 'rtCreateCard').style.display, 'none', '「立てる」は出さない');
    assertNoErrors(errors, 'QRからの参加で未捕捉の例外');
    win.close();
  });

  // ---- 第26弾 第3部：部屋はカセットに紐づかない箱 ----

  await r.test('待合でゲームを選んでいない間は、はじめられない', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { pick: false });
    push(fake, roomSnapshot({ state: { phase: 'lobby', game: null, data: {} } }));
    await sleep(win, 100);
    assert(el(doc, 'rtStartBtn').disabled, 'ゲームが決まるまで始められない');
    assert(el(doc, 'rtPickGameBtn').style.display !== 'none', 'ホストには「ゲームをえらぶ」が出る');
    assert(/ゲームをえらぶ/.test(el(doc, 'rtRoomNote').textContent), '何をすればいいか書いてある');

    // ホストでない人には、選ぶ側の案内は出さない
    push(fake, roomSnapshot({ hostMemberId: 'm2', state: { phase: 'lobby', game: null, data: {} } }));
    await sleep(win, 80);
    assertEqual(el(doc, 'rtPickGameBtn').style.display, 'none', '選ぶのは進行役だけ');
    assert(/進行役がゲームを選んでいます/.test(el(doc, 'rtRoomNote').textContent), '待つ側の案内が出る');
    assertNoErrors(errors, 'ゲーム未選択の待合で未捕捉の例外');
    win.close();
  });

  await r.test('人狼もワードウルフも、部屋のために同じ流れを歩く', async () => {
    // 第24弾では人狼だけウィザードを飛ばしていた（カードに設定が入っているため）。
    // 第26弾-3で「何台で遊ぶ？」を消し、ホストが必ずカセット→ゲーム→モードを
    // 歩くようになったので、飛ばす側／通す側の区別そのものが無くなった。
    for (const gameId of ['wolfrole', 'wordwolf']) {
      const { win, doc, errors } = await launch(LAUNCH);
      await toRoom(win, doc, { pick: false });
      click(doc, 'rtPickGameBtn');
      await waitScreen(win, doc, 'scr-shelf', 3000);
      const cart = doc.querySelector('.cart[data-cart="jinro"]');
      cart.click();
      if (activeScreen(doc) === 'scr-shelf') cart.click();
      await waitScreen(win, doc, 'scr-game', 3000);
      pickGame(doc, gameId);
      await waitScreen(win, doc, 'scr-mode', 3000);
      assert(/部屋/.test(el(doc, 'modeRoomNote').textContent), gameId + '：部屋のために選んでいると分かる');

      click(doc, 'modeNextBtn');
      await sleep(win, 120);
      const after = activeScreen(doc);
      assert(/^scr-set-/.test(after), gameId + '：設定ウィザードを通る（' + after + '）');

      // つぎへを繰り返せば、必ず待合にもどる
      let guard = 0;
      while (activeScreen(doc) !== 'scr-rt-room' && guard++ < 12) {
        const cur = activeScreen(doc);
        const next = doc.querySelector('#' + cur + ' [data-wiz-next]')
          || (cur === 'scr-mode-rules' ? doc.getElementById('rulesStartBtn') : null);
        if (!next) break;
        next.click();
        await sleep(win, 60);
      }
      assertEqual(activeScreen(doc), 'scr-rt-room', gameId + '：設定を終えると待合にもどる');
      assertNoErrors(errors, gameId + ' の設定で未捕捉の例外');
      win.close();
    }
  });

  await r.test('まだ1人1台に対応していないカセットを選んでも、待合で止まって理由が出る', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { pick: false });
    // ホストがあれそれどれこれを選んだ状態
    win.eval('(function(){ })');
    push(fake, roomSnapshot({ hostMemberId: 'm2', state: { phase: 'lobby', game: 'aresoredorekore', data: {} } }));
    await sleep(win, 100);
    assertEqual(activeScreen(doc), 'scr-rt-room', '待合に留まる');
    assert(el(doc, 'rtStartBtn').disabled, 'はじめられない');
    assert(/まだ1人1台に対応していません/.test(el(doc, 'rtRoomNote').textContent),
      '理由が書いてある（' + el(doc, 'rtRoomNote').textContent.slice(0, 30) + '）');
    assertNoErrors(errors, '未対応カセットの待合で未捕捉の例外');
    win.close();
  });

  await r.test('遊び終わっても部屋は解散せず、次のゲームを選びに行ける', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc);
    push(fake, roomSnapshot({
      state: {
        phase: 'ended', game: 'wolfrole',
        data: wolfView({
          phase: 'ended',
          result: { winner: 'village', reason: null, teruteruWin: false, roles: [], scores: {}, voteLog: [] }
        })
      }
    }));
    pushYou(fake, { phase: 'ended', roleId: 'villager', roleName: '村人', roleDesc: '', alive: true, done: true, choices: [] });
    await waitScreen(win, doc, 'scr-rt-play', 4000);

    click(doc, 'rtAgainBtn');
    await waitScreen(win, doc, 'scr-shelf', 4000);
    // 部屋を閉じてはいない（room:close を送っていない）
    const sent = fake.emits.map(e => e.name);
    assertEqual(sent.indexOf('room:close'), -1, '部屋は閉じない');
    const reset = fake.emits.filter(e => e.name === 'room:setState').pop();
    assert(reset && reset.payload.reset === true, '前のゲームを捨てるよう頼んでいる');
    assertNoErrors(errors, '次のゲームを選ぶところで未捕捉の例外');
    win.close();
  });

  await r.test('参加すると、ホストが選んでいるゲームの画面へ進む', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    await waitScreen(win, doc, 'scr-shelf', 4000);
    click(doc, 'shelfRoomBtn');
    await waitScreen(win, doc, 'scr-rt-lobby', 3000);
    const fake = win.__rtFake;
    await waitFor(win, () => fake.connected, 3000, '疑似socketがつながる');

    // まだ始まっていない部屋 → 待合へ
    fake.replies = { 'room:join': () => ({ ok: true, code: 'ABC234', memberId: 'm2', room: roomSnapshot() }) };
    el(doc, 'rtJoinCode').value = 'ABC234';
    el(doc, 'rtJoinName').value = 'びび';
    click(doc, 'rtJoinBtn');
    await waitScreen(win, doc, 'scr-rt-room', 4000);
    assertEqual(el(doc, 'rtRoomCode').textContent, 'ABC234', '部屋コードが出る');

    // ホストが人狼を始めたら、人狼の画面へ移る
    push(fake, roomSnapshot({ state: { phase: 'roleReveal', game: 'wolfrole', data: wolfView() } }));
    pushYou(fake, {
      phase: 'roleReveal', roleId: 'villager', roleName: '村人', roleDesc: '',
      alive: true, done: false, info: null, choices: []
    });
    await waitScreen(win, doc, 'scr-rt-play', 4000);
    assert(/村人/.test(el(doc, 'rtYouBox').textContent), '自分の役職が出る');
    assertNoErrors(errors, '参加後の遷移で未捕捉の例外');
    win.close();
  });

  await r.test('まだ対応していないゲームの部屋でも、置き去りにしない', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    await waitScreen(win, doc, 'scr-shelf', 4000);
    click(doc, 'shelfRoomBtn');
    await waitScreen(win, doc, 'scr-rt-lobby', 3000);
    const fake = win.__rtFake;
    await waitFor(win, () => fake.connected, 3000, '疑似socketがつながる');
    fake.replies = { 'room:join': () => ({ ok: true, code: 'ABC234', memberId: 'm2', room: roomSnapshot() }) };
    el(doc, 'rtJoinCode').value = 'ABC234';
    el(doc, 'rtJoinName').value = 'びび';
    click(doc, 'rtJoinBtn');
    await waitScreen(win, doc, 'scr-rt-room', 4000);

    // まだ1人1台に対応していないゲーム（クイズ王）が始まった場合。
    // 第27弾で爆弾解除が対応済みになったので、ここは別のゲームに差し替えてある
    push(fake, roomSnapshot({ state: { phase: 'playing', game: 'quizking', data: { phase: 'playing' } } }));
    await sleep(win, 150);
    assertEqual(activeScreen(doc), 'scr-rt-room', '待合に留まる（真っ白な画面にしない）');
    assertNoErrors(errors, '未対応ゲームで未捕捉の例外');
    win.close();
  });

  await r.test('部屋コードのQRが、待合と大画面に出る', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc);
    const svg = doc.querySelector('#rtQr svg');
    assert(svg, '待合にQRが出る');
    assert(/viewBox/.test(svg.outerHTML), 'SVGとして描かれている');
    // xmlns に http が入るので、外部参照そのもの（画像・href・url()）だけを見る
    assert(!/<image|href=|url\(/.test(svg.outerHTML), '外部の画像を読み込まない');
    win.close();

    // 大画面：始まる前はQRあり、始まったら消える
    const b = await launch(LAUNCH);
    const fake2 = await toRoom(b.win, b.doc, { join: true, memberId: 'm5', role: 'bigscreen' });
    push(fake2, roomSnapshot({
      members: roomSnapshot().members.map(m => m.id === 'm5' ? Object.assign({}, m, { role: 'bigscreen' }) : m),
      playerCount: 4
    }));
    await sleep(b.win, 120);
    assertEqual(el(b.doc, 'bigQrBox').style.display, 'flex', '始まる前はQRを出す');
    assert(b.doc.querySelector('#bigQr svg'), '大画面にもQRが描かれる');

    push(fake2, roomSnapshot({
      members: roomSnapshot().members.map(m => m.id === 'm5' ? Object.assign({}, m, { role: 'bigscreen' }) : m),
      state: { phase: 'night', game: 'wolfrole', data: wolfView({ phase: 'night' }) }
    }));
    await sleep(b.win, 120);
    assertEqual(el(b.doc, 'bigQrBox').style.display, 'none', '始まったらQRは消す');
    assertNoErrors(errors, 'QR表示で未捕捉の例外');
    assertNoErrors(b.errors, '大画面のQRで未捕捉の例外');
    b.win.close();
  });

  // ---- 第26弾-1：QRが出せなかった時の見え方 ----

  await r.test('QRを出せなかったら、そのことが読む人に伝わる', async () => {
    // 以前は黙って空欄になるので、画面からは「QRが使えない」としか見えず、
    // 手入力に切り替えればよいことも伝わらなかった
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc);
    const note = doc.querySelector('#rtQrBox .qr-note');
    assert(note, 'QRの下に説明が付いている');

    el(doc, 'rtQr').dataset.code = '';
    el(doc, 'rtQr').innerHTML = '';
    win.QR.toSvg = () => { throw new Error('QRを作れない端末'); };
    push(fake, roomSnapshot({ playerCount: 3 }));
    await sleep(win, 120);
    assertEqual(doc.querySelector('#rtQr svg'), null, '失敗したらSVGは残さない');
    assert(/手で入れて/.test(note.textContent), '手入力に切り替えられることを伝える');
    assertNoErrors(errors, 'QR失敗で未捕捉の例外');
    win.close();
  });

  await r.test('一度失敗したQRが、次の更新で描き直される', async () => {
    // 描く前に「この部屋コードは済み」と覚えていたので、
    // 最初の1回が失敗するとその部屋では二度とQRが出なかった
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc);
    const real = win.QR.toSvg;

    el(doc, 'rtQr').dataset.code = '';
    el(doc, 'rtQr').innerHTML = '';
    win.QR.toSvg = () => { throw new Error('一度だけ失敗'); };
    push(fake, roomSnapshot({ playerCount: 3 }));
    await sleep(win, 120);
    assertEqual(doc.querySelector('#rtQr svg'), null, '失敗した回はQRが無い');
    assertEqual(el(doc, 'rtQr').dataset.code, '', '失敗を「済み」と覚えない');

    win.QR.toSvg = real;
    push(fake, roomSnapshot({ playerCount: 4 }));
    await sleep(win, 120);
    assert(doc.querySelector('#rtQr svg'), '次の更新で描き直される');
    assertNoErrors(errors, 'QR再描画で未捕捉の例外');
    win.close();
  });

  // ---- 第24弾-3：実機フィードバックの修正 ----

  await r.test('決着したら、行き先のボタンが必ず出る', async () => {
    // 以前はボタンが1つも出ず、結果を見たあと何もできなくなっていた
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc); // m1 ＝ ホスト
    push(fake, roomSnapshot({
      state: {
        phase: 'ended', game: 'wolfrole', data: wolfView({
          phase: 'ended',
          result: {
            winner: 'village', reason: null, teruteruWin: false,
            roles: [{ name: 'あき', role: 'wolf', roleName: '人狼', alive: false }],
            scores: {}, voteLog: []
          }
        })
      }
    }));
    await sleep(win, 150);
    assertEqual(activeScreen(doc), 'scr-rt-play', '自分の端末は進行画面のまま');
    assert(el(doc, 'rtPlayLeaveBtn').style.display !== 'none', '部屋を出るボタンが出る');
    // 第26弾-3：遊び終わっても部屋は解散しない。次を選ぶ道が先に来る
    assert(el(doc, 'rtAgainBtn').style.display !== 'none', 'ホストには「べつのゲームをえらぶ」が出る');
    assert(el(doc, 'rtEndBtn').style.display !== 'none', 'ホストには「部屋を閉じる」も出る');
    assert(/そのまま残ります/.test(el(doc, 'rtWaitNote').textContent), '部屋が残ることを伝える');
    assertNoErrors(errors, '決着後の画面で未捕捉の例外');
    win.close();
  });

  await r.test('決着後、ホスト以外には終了ボタンを出さない', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' }); // ホストは m1
    push(fake, roomSnapshot({
      state: {
        phase: 'ended', game: 'wolfrole', data: wolfView({
          phase: 'ended',
          result: { winner: 'wolf', roles: [], scores: {}, voteLog: [] }
        })
      }
    }));
    await sleep(win, 150);
    assertEqual(el(doc, 'rtEndBtn').style.display, 'none', 'ホスト以外に終了ボタンは出さない');
    assert(el(doc, 'rtPlayLeaveBtn').style.display !== 'none', '自分で抜けることはできる');
    assertNoErrors(errors, '参加者側の決着画面で未捕捉の例外');
    win.close();
  });

  await r.test('ホストが終了したら、部屋の画面から出る', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    win.alert = () => {};
    assertEqual(activeScreen(doc), 'scr-rt-room', '部屋にいる');
    fake.fire('room:closed', { by: 'あき' });
    await sleep(win, 200);
    assertEqual(activeScreen(doc), 'scr-shelf', '棚に戻る（置き去りにしない）');
    assertNoErrors(errors, '部屋が畳まれた時に未捕捉の例外');
    win.close();
  });

  await r.test('部屋コードで参加した人にも、人狼のテーマが当たる', async () => {
    // 棚からカセットを選ばずに入ると、テーマが当たらず
    // 「ホストだけ暗い画面」になっていた
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = win.__rtFake;
    fake.replies = {
      'room:join': () => ({
        ok: true, code: 'ABC234', memberId: 'm2',
        room: roomSnapshot({ state: { phase: 'roleReveal', game: 'wolfrole', data: wolfView() } })
      })
    };
    // 棚を通らずに「部屋に参加する」から入る
    click(doc, 'shelfRoomBtn');
    await waitScreen(win, doc, 'scr-rt-lobby', 3000);
    assert(!el(doc, 'app').classList.contains('theme-wolf'), '入り口ではまだテーマは付かない');
    el(doc, 'rtJoinCode').value = 'ABC234';
    el(doc, 'rtJoinName').value = 'びび';
    click(doc, 'rtJoinBtn');
    await waitFor(win, () => activeScreen(doc) === 'scr-rt-play', 4000, '進行画面へ');
    assert(el(doc, 'app').classList.contains('theme-wolf'),
      '部屋のゲームからテーマが決まる（ホストだけ夜、にならない）');
    assertNoErrors(errors, '部屋コード参加のテーマで未捕捉の例外');
    win.close();
  });

  // ---- 第27弾：クイズ解除の画面 ----

  await r.test('クイズ解除：待合から爆弾解除カセットを選んで戻れる', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { pick: false });
    await pickGameForRoom(win, doc, 'bomb', 'bomb');
    const picked = fake.emits.filter(e => e.name === 'room:setState').pop();
    assertEqual(picked.payload.game, 'bomb', '遊ぶゲームを部屋に伝えている');
    // 待合の案内にも、何を遊ぶかが出る
    push(fake, bombRoom({ state: { phase: 'lobby', game: 'bomb', data: {} } }));
    await sleep(win, 80);
    assert(/クイズ解除/.test(el(doc, 'rtRoomNote').textContent), '何を遊ぶかが待っている人にも見える');
    assert(!el(doc, 'rtStartBtn').disabled, '進行役なら始められる');
    assertNoErrors(errors, '爆弾解除カセットを選ぶところで未捕捉の例外');
    win.close();
  });

  await r.test('クイズ解除：はじめる時に、お題プールと設定をサーバーへ渡す', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { pick: false });
    await pickGameForRoom(win, doc, 'bomb', 'bomb');
    push(fake, bombRoom({ state: { phase: 'lobby', game: 'bomb', data: {} } }));
    await sleep(win, 80);
    click(doc, 'rtStartBtn');
    await sleep(win, 120);
    const start = fake.emits.filter(e => e.name === 'wolf:start').pop();
    assert(start, '開始を送っている');
    assertEqual(start.payload.game, 'bomb', 'ゲームは爆弾解除');
    assertEqual(start.payload.mode, 'coop', '通常版として始める');
    assert(start.payload.topics.length > 0, 'お題プールを渡している');
    assert(start.payload.topics.every(t => t.name && t.tier), 'お題には名前と難易度がある');
    assert(start.payload.lives >= 1, 'ライフの設定を渡している');
    assertNoErrors(errors, '開始で未捕捉の例外');
    win.close();
  });

  await r.test('クイズ解除：準備中は本数だけ出て、盤面も説明文も出ない', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    push(fake, bombRoom({
      state: { phase: 'prep', game: 'bomb', data: bombView({ phase: 'prep', prep: { ready: 2, dropped: 0, total: 6 } }) }
    }));
    pushYou(fake, bombYou({ phase: 'prep', board: undefined, prep: { ready: 2, dropped: 0, total: 6 } }));
    await waitScreen(win, doc, 'scr-rt-bomb', 4000);
    assertEqual(el(doc, 'rtBombPhase').textContent, '準備中', '準備中だと分かる');
    assertEqual(el(doc, 'rtBombPrepBox').style.display, 'block', '進み具合のバーが出る');
    assert(/2 \/ 6本/.test(el(doc, 'rtBombPrepNote').textContent), '本数だけが出る');
    assertEqual(el(doc, 'rtBombBoard').innerHTML, '', '盤面はまだ出さない');
    assertEqual(el(doc, 'rtBombOverlay').classList.contains('show'), false, '説明文も出さない');
    assertNoErrors(errors, '準備中の画面で未捕捉の例外');
    win.close();
  });

  await r.test('クイズ解除：自分の盤面・ライフ・残り時間が出る', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    push(fake, bombRoom());
    pushYou(fake, bombYou());
    await waitScreen(win, doc, 'scr-rt-bomb', 4000);
    assertEqual(el(doc, 'rtBombLives').textContent, '❤️❤️🖤', 'ライフが減った分だけ黒くなる');
    assertEqual(el(doc, 'rtBombProgress').textContent, '1 / 4 解除', '進捗が出る');
    assert(/^0[12]:/.test(el(doc, 'rtBombTimer').textContent), '残り時間が出る（' + el(doc, 'rtBombTimer').textContent + '）');

    const cells = doc.querySelectorAll('#rtBombBoard .bomb-wire-btn');
    assertEqual(cells.length, 4, '4本のコードが並ぶ');
    assert(cells[0].classList.contains('solved'), '解除済みが分かる');
    assert(cells[1].classList.contains('taken'), '他の人が挑戦中のコードは押せない見た目になる');
    // 誰が挑戦中かは名前で分かる（お題の中身は出さない）
    assert(/びびが挑戦中/.test(el(doc, 'rtBombBoard').textContent), '誰が挑戦中かが分かる');
    assert(!/せつめい/.test(el(doc, 'rtBombBoard').textContent), '説明文は盤面に出ない');
    // 難易度別に整列していると、見出しが付く
    assert(doc.querySelectorAll('#rtBombBoard .sec-title').length >= 2, '難易度ごとに区切られる');
    assertNoErrors(errors, '盤面の表示で未捕捉の例外');
    win.close();
  });

  await r.test('クイズ解除：コードを押すとサーバーに伝え、開いた分だけ3択が出る', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    push(fake, bombRoom());
    pushYou(fake, bombYou());
    await waitScreen(win, doc, 'scr-rt-bomb', 4000);

    // ふさがっているコードは押しても何も送らない
    const before = fake.emits.filter(e => e.name === 'wolf:act').length;
    doc.querySelectorAll('#rtBombBoard .bomb-wire-btn')[1].click();
    await sleep(win, 60);
    assertEqual(fake.emits.filter(e => e.name === 'wolf:act').length, before,
      '他の人が挑戦中のコードは送らない');

    // 空いているコードを押す
    doc.querySelectorAll('#rtBombBoard .bomb-wire-btn')[2].click();
    await sleep(win, 80);
    const act = fake.emits.filter(e => e.name === 'wolf:act').pop();
    assertEqual(act.payload.targetId, 'w2', '押したコードを伝えている');

    // サーバーが説明文と3択を返してきたら、そのコードだけを出す
    pushYou(fake, bombYou({
      open: { uid: 'w2', tier: 'normal', description: 'まるくて甘い果物です', choices: ['りんご', 'みかん', 'すいか'] }
    }));
    await sleep(win, 100);
    assert(el(doc, 'rtBombOverlay').classList.contains('show'), '3択が出る');
    assertEqual(el(doc, 'rtBombDescription').textContent, 'まるくて甘い果物です', '説明文が出る');
    assertEqual(doc.querySelectorAll('#rtBombChoices .pk-btn').length, 3, '3択');

    // 答えると、選んだ言葉をそのまま送る
    doc.querySelectorAll('#rtBombChoices .pk-btn')[0].click();
    await sleep(win, 80);
    const vote = fake.emits.filter(e => e.name === 'wolf:vote').pop();
    assertEqual(vote.payload.targetId, 'りんご', '選んだ答えを送っている');

    // 正解して閉じたら、3択は消える
    pushYou(fake, bombYou({ solvedCount: 2 }));
    await sleep(win, 80);
    assert(!el(doc, 'rtBombOverlay').classList.contains('show'), '答えたら3択は閉じる');
    assertNoErrors(errors, '3択のやりとりで未捕捉の例外');
    win.close();
  });

  await r.test('クイズ解除：競争版では、他の人の残り本数だけが見える', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    const race = bombView({
      mode: 'race', layout: 'mixed', team: undefined, board: undefined,
      players: [
        { id: 'm1', name: 'あき', connected: true, solved: 3, total: 4, pct: 75, lives: 1, livesMax: 3, misses: 2, failed: false, timedOut: false, finished: false, working: 'easy', remainingMs: 90000 },
        { id: 'm2', name: 'びび', connected: true, solved: 1, total: 4, pct: 25, lives: 3, livesMax: 3, misses: 0, failed: false, timedOut: false, finished: false, working: null, remainingMs: 150000 }
      ]
    });
    push(fake, bombRoom({ state: { phase: 'play', game: 'bomb', data: race } }));
    pushYou(fake, bombYou({ mode: 'race', layout: 'mixed' }));
    await waitScreen(win, doc, 'scr-rt-bomb', 4000);
    assertEqual(el(doc, 'rtBombPhase').textContent, '競争版・解除中', '競争版だと分かる');
    const note = el(doc, 'rtBombNote').textContent;
    assert(/あき/.test(note) && /あと1/.test(note), '他の人の残り本数が出る');
    assert(!/びび/.test(note), '自分の分は一覧に入れない');
    // ごちゃまぜなら難易度の見出しは付かない
    assertEqual(doc.querySelectorAll('#rtBombBoard .sec-title').length, 0, 'ごちゃまぜは区切らない');
    assertNoErrors(errors, '競争版の画面で未捕捉の例外');
    win.close();
  });

  await r.test('クイズ解除：決着したら結果と、次に進むボタンが出る', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { pick: false });   // 自分がホスト（m1）
    await pickGameForRoom(win, doc, 'bomb', 'bomb');
    const ended = bombView({
      phase: 'ended',
      result: {
        mode: 'coop', success: true, cause: 'defused', solved: 4, total: 4,
        lives: 2, livesMax: 3, misses: 1, elapsedSec: 95,
        codes: [{ tier: 'easy', name: '傘', solved: true }, { tier: 'normal', name: '冷蔵庫', solved: true }]
      }
    });
    push(fake, bombRoom({ state: { phase: 'ended', game: 'bomb', data: ended } }));
    pushYou(fake, bombYou({ phase: 'ended', result: ended.result }));
    await waitScreen(win, doc, 'scr-rt-bomb', 4000);
    const text = el(doc, 'rtBombResult').textContent;
    assert(/解除成功/.test(text), '成功したことが出る');
    assert(/ミス 1回/.test(text), 'ミス数が出る');
    // 決着したこの瞬間だけ、答え合わせのために中身を開ける
    assert(/傘/.test(text) && /冷蔵庫/.test(text), 'コードの正体が出る');
    assert(el(doc, 'rtBombAgainBtn').style.display !== 'none', '次のゲームを選びに行ける');
    assert(el(doc, 'rtBombEndBtn').style.display !== 'none', 'ホストは部屋を閉じられる');
    assert(el(doc, 'rtBombLeaveBtn').style.display !== 'none', '部屋から出られる');
    assertNoErrors(errors, '決着の画面で未捕捉の例外');
    win.close();
  });

  await r.test('クイズ解除：始められなかった時は、理由が出て行き止まりにならない', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    const aborted = bombView({
      phase: 'ended',
      result: { aborted: true, message: 'AIの説明文を1本も作れなかったので、始められませんでした' }
    });
    push(fake, bombRoom({ state: { phase: 'ended', game: 'bomb', data: aborted } }));
    pushYou(fake, bombYou({ phase: 'ended', result: aborted.result }));
    await waitScreen(win, doc, 'scr-rt-bomb', 4000);
    assert(/作れなかった/.test(el(doc, 'rtBombResult').textContent), '理由が出る');
    assert(el(doc, 'rtBombLeaveBtn').style.display !== 'none', '部屋から出られる');
    assertNoErrors(errors, '始められなかった時に未捕捉の例外');
    win.close();
  });

  await r.test('大画面：クイズ解除は横棒グラフで進捗とライフだけを出す', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm5', role: 'bigscreen' });
    const members = bombRoom().members.concat([
      { id: 'm5', name: 'テレビ', role: 'bigscreen', connected: true, isHost: false }
    ]);
    push(fake, bombRoom({ members, memberCount: 3 }));
    await sleep(win, 150);
    assertEqual(activeScreen(doc), 'scr-rt-big', '大画面のまま');
    assertEqual(el(doc, 'bigBoard').style.display, 'flex', '横棒グラフが出る');
    const rows = doc.querySelectorAll('#bigBoard .bb-row');
    assertEqual(rows.length, 2, 'プレイヤーぶんの棒が並ぶ');
    assert(/あき/.test(rows[0].textContent), '名前が出る');
    assert(/1 \/ 4/.test(rows[0].textContent), '解けた本数が出る');
    assert(/❤️❤️🖤/.test(rows[0].textContent), 'ライフが出る');
    assertEqual(rows[0].querySelector('.bb-fill').style.width, '25%', '棒の長さが進捗を表す');
    // 大画面に秘密は出さない
    const big = el(doc, 'scr-rt-big').textContent;
    assert(!/せつめい/.test(big), '説明文は出ない');
    assertEqual(el(doc, 'bigList').innerHTML, '', '名前だけの一覧は使わない（棒に差し替える）');
    assertNoErrors(errors, '大画面のリーダーボードで未捕捉の例外');
    win.close();
  });

  await r.test('大画面：爆弾解除以外にもどったら、横棒グラフは消える', async () => {
    // 残したままだと、人狼の部屋に前の試合の棒が出たままになる
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm5', role: 'bigscreen' });
    const members = bombRoom().members.concat([
      { id: 'm5', name: 'テレビ', role: 'bigscreen', connected: true, isHost: false }
    ]);
    push(fake, bombRoom({ members, memberCount: 3 }));
    await sleep(win, 120);
    assertEqual(el(doc, 'bigBoard').style.display, 'flex', 'まずは出ている');
    // m5（この端末）が大画面のまま、部屋のゲームだけが人狼に切り替わった状態
    push(fake, roomSnapshot({
      members: roomSnapshot().members.map(m => m.id === 'm5' ? Object.assign({}, m, { role: 'bigscreen' }) : m),
      playerCount: 4,
      state: { phase: 'night', game: 'wolfrole', data: wolfView({ phase: 'night' }) }
    }));
    await sleep(win, 120);
    assertEqual(activeScreen(doc), 'scr-rt-big', '大画面のまま');
    assertEqual(el(doc, 'bigBoard').style.display, 'none', '別のゲームでは消える');
    assertNoErrors(errors, '大画面の切り替えで未捕捉の例外');
    win.close();
  });

  // ---- 第27弾-1：実機で起きた「全員が固まる」の直し ----

  await r.test('つなぎ直して部屋が無くなっていたら、固まらずに理由が出て棚にもどる', async () => {
    // サーバーが再起動した（メモリ上の部屋は消える仕様）か、
    // 誰も繋がっていない時間が続いて部屋が片付けられたか。
    // 以前は入り直しの失敗を黙って捨てていたので、画面が前のまま固まり、
    // ブラウザを立ち上げ直すまで直らなかった。
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc);
    assertEqual(activeScreen(doc), 'scr-rt-room', 'まず部屋にいる');

    let msg = null;
    win.alert = (m) => { msg = m; };
    fake.replies = {
      'room:join': () => ({ ok: false, error: 'room_not_found', message: 'その部屋コードは見つかりません' })
    };
    // 接続が切れて、socket.io が自動でつなぎ直したところ
    fake.fire('disconnect');
    fake.fire('connect');

    await waitFor(win, () => activeScreen(doc) === 'scr-shelf', 3000,
      '棚にもどる（現在: ' + activeScreen(doc) + '）');
    await waitFor(win, () => !!msg, 2000, '理由が出る');
    assert(/部屋がなくなって/.test(msg), '何が起きたかが伝わる（実際: ' + msg + '）');
    assertNoErrors(errors, '部屋が消えていた時に未捕捉の例外');
    win.close();
  });

  await r.test('一時的に切れただけなら、入り直せて部屋に留まる', async () => {
    // 上の直しが効きすぎて、ふつうの再接続まで追い出さないことを見る
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc);
    let msg = null;
    win.alert = (m) => { msg = m; };
    fake.replies = {
      'room:join': () => ({ ok: true, code: 'ABC234', memberId: 'm1', room: roomSnapshot() })
    };
    fake.fire('disconnect');
    fake.fire('connect');
    await sleep(win, 300);
    assertEqual(activeScreen(doc), 'scr-rt-room', '部屋に留まる');
    assertEqual(msg, null, '余計な知らせは出さない');
    assertNoErrors(errors, '再接続で未捕捉の例外');
    win.close();
  });

  await r.test('大画面は、横長の画面では幅の制限を外す', async () => {
    // jsdom はレイアウトしないので、CSSの決まりごとを直接確かめる
    const fs = require('fs');
    const path = require('path');
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    assert(/\.app:has\(#scr-rt-big\.active\)\s*\{[^}]*max-width:\s*none/.test(html),
      '大画面を出している間はスマホ幅の制限を外す');
    assert(/@media\s*\(min-width:\s*900px\)\s*\{[\s\S]*?#scr-rt-big\.active/.test(html),
      '広い画面ではレイアウトを組み替える');
    // ふだんの画面は今までどおり460pxのまま
    assert(/\.app\{[^}]*max-width:\s*460px/.test(html), 'ふだんの幅は変えていない');
  });

  r.finish();
})();
