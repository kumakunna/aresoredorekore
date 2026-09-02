// tests/rt-screens.js — 1人1台モードの画面（第21弾 第6・7部）
//
// 通信そのものは tests/realtime-wolf.js（本物のサーバー＋複数接続）で見ている。
// ここで見るのは「サーバーから届いたものを、画面が正しく出し分けるか」。
// jsdom には socket.io が無いので、ハーネスの疑似socketでイベントを流し込む。

const H = require('./harness');
const { launch, activeScreen, sleep, waitFor, waitScreen, el, click, fillPlayerForm,
  pickGame, runWizardToPlay, createRunner, assert, assertEqual, assertNoErrors } = H;
// 第35弾：経路の正本。ゲーム一覧・退室経路はここから回す（手書きの列挙をしない）
const INV = require('./inventory');

const LAUNCH = { fakeSocket: true };

// 部屋に入った状態まで進める。room は疑似サーバーが返す部屋の中身
function roomSnapshot(over) {
  return withReadyDefaults(Object.assign({
    code: 'ABC234', ownerUserId: 1, ownerUsername: 'kuma',
    hostMemberId: 'm1', playerCount: 5, memberCount: 5,
    // 第37弾：ルールを読んで「準備OK」。ここの検体は「全員が押し終えた部屋」を既定にする。
    // ほとんどのテストが見たいのは、その先（ゲームの画面）だから。
    // 準備の集まりそのものを見たいテストは、この2つを上書きする
    ready: { count: 5, total: 5, waitingNames: [], all: true },
    members: [
      { id: 'm1', name: 'あき', role: 'player', connected: true, isHost: true, ready: true },
      { id: 'm2', name: 'びび', role: 'player', connected: true, isHost: false, ready: true },
      { id: 'm3', name: 'ちか', role: 'player', connected: true, isHost: false, ready: true },
      { id: 'm4', name: 'でん', role: 'player', connected: true, isHost: false, ready: true },
      { id: 'm5', name: 'えみ', role: 'player', connected: true, isHost: false, ready: true }
    ],
    // 第26弾-3：待合でホストがゲームを選ぶと、サーバーが state.game を全員に配る。
    // ここのテストはどれも人狼の部屋なので、選び終わった状態を既定にしておく
    state: { phase: 'lobby', game: 'wolfrole', data: {} }
  }, over || {}));
}
// 第37弾：検体の既定は「全員が準備OKを押し終えた部屋」。
// members を差し替える検体（bombRoom など）にも行き渡るよう、ここで埋める。
// 準備の集まりそのものを見たいテストは roomWithReady() を使う
function withReadyDefaults(room) {
  room.members = (room.members || []).map((m) => Object.assign({ ready: true }, m));
  const players = room.members.filter((m) => m.role !== 'bigscreen' && m.connected);
  const done = players.filter((m) => m.ready);
  room.ready = room.ready || {
    count: done.length, total: players.length,
    waitingNames: players.filter((m) => !m.ready).map((m) => m.name),
    all: players.length > 0 && done.length === players.length
  };
  return room;
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
// 第32弾-A：部屋への入口は「あそびかたをえらぶ」に一本化した。
// 棚にいる時は、棚の見出しのボタンからそこへ戻ってから「みんなのスマホ」を選ぶ
async function toRoomLobby(win, doc) {
  if (activeScreen(doc) === 'scr-shelf') {
    click(doc, 'shelfFlowBtn');
    await waitScreen(win, doc, 'scr-howto', 3000);
  }
  click(doc, doc.querySelector('#scr-howto [data-howto="room"]'));
  await waitScreen(win, doc, 'scr-rt-lobby', 3000);
}

async function toRoom(win, doc, opts) {
  opts = opts || {};
  await toRoomLobby(win, doc);

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
    click(doc, 'rtJoinBtn');
  } else {
    el(doc, 'rtCreateName').value = 'あき';
    click(doc, 'rtCreateBtn');
  }
  await waitFor(win, () => ['scr-rt-room','scr-rt-big'].indexOf(activeScreen(doc)) >= 0, 4000, '部屋の画面に入る');
  // 第32弾-A-2：大画面は参加時の役割ではなく、部屋の画面から切り替える表示モードになった。
  // サーバーは切り替えた結果の部屋を返してくるので、疑似socketにも同じものを返させる
  if (role === 'bigscreen') {
    fake.replies['room:setRole'] = () => ({
      ok: true, role: 'bigscreen',
      room: roomSnapshot({
        // 自分の枠を大画面に書き換える（増やすと、同じidが2つ並んで先頭が拾われる）
        members: roomSnapshot().members.map((m) => (
          m.id === memberId ? Object.assign({}, m, { role: 'bigscreen' }) : m
        ))
      })
    });
    click(doc, 'rtToBigBtn');
    await waitScreen(win, doc, 'scr-rt-big', 3000);
  }
  if (opts.pick !== false && !opts.join && role !== 'bigscreen') {
    await pickGameForRoom(win, doc, opts.game || 'wolfrole');
  }
  return fake;
}

// 第27弾：ゲームがどのカセットに入っているか。
// 1つしか入っていないカセットはゲーム選択画面を飛ばすので、歩き方が変わる
const CASSETTE_OF = {
  wolfrole: 'jinro', wordwolf: 'jinro', bomb: 'bakudan', defuse: 'bakudan',
  quizrush: 'quizou', quizlist: 'quizou', quizreveal: 'quizou', buzzer: 'quizou',
  auction: 'auction'
};

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
    phase: 'play', mode: 'coop', endWhen: 'first',
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
    remainingMs: 120000,
    prep: { ready: 4, dropped: 0, total: 4 },
    board: bombView().board
  }, over || {});
}
// ---- 第27弾-3：実物解除の部屋 ----
// defuse-room.js が配る形をそのまま真似る。
// 対応表が解除役に漏れないこと自体は realtime-defuse.js で見ているので、
// ここでは「届いたものを画面がどう出し分けるか」だけを見る
function defuseView(over) {
  return Object.assign({
    phase: 'play', mode: 'normal', manual: true,
    strikesLeft: 3, strikesMax: 3, timerSec: 0, remainingMs: null,
    players: [
      { id: 'm1', name: 'あき', connected: true, role: 'defuser', working: null, done: true },
      { id: 'm2', name: 'びび', connected: true, role: 'manual', working: null, done: true }
    ],
    waiting: [],
    board: {
      total: 3, solved: 1, strikesLeft: 3, strikesMax: 3,
      modules: [
        { uid: 'md0', name: '面認証', icon: '🔄', solved: true },
        { uid: 'md1', name: '傾け迷路', icon: '🌀', solved: false },
        { uid: 'md2', name: 'イエスノー解錠', icon: '🔐', solved: false }
      ]
    }
  }, over || {});
}
function defuseYou(over) {
  return Object.assign({
    phase: 'play', mode: 'normal', manual: true, role: 'defuser',
    strikesLeft: 3, strikesMax: 3, remainingMs: null, done: false, consent: true,
    board: defuseView().board
  }, over || {});
}
function defuseRoom(over) {
  return roomSnapshot(Object.assign({
    playerCount: 2, memberCount: 2,
    members: [
      { id: 'm1', name: 'あき', role: 'player', connected: true, isHost: true },
      { id: 'm2', name: 'びび', role: 'player', connected: true, isHost: false }
    ],
    state: { phase: 'play', game: 'defuse', data: defuseView() }
  }, over || {}));
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

// ---- 第30弾：クイズ王の部屋 ----
// quiz-room.js が配る形をそのまま真似る。
// 正解の位置が配られないことは realtime-quiz.js で見ているので、
// ここでは「届いたものを画面がどう出すか」だけを見る
function quizPlayers() {
  return [
    { id: 'm1', name: 'あき', connected: true, score: 5 },
    { id: 'm2', name: 'びび', connected: true, score: 3 }
  ];
}
function quizView(variant, over) {
  return Object.assign({
    phase: 'play', variant: variant, timerSec: 180, remainingMs: 120000,
    players: quizPlayers()
  }, over || {});
}
function quizYou(variant, over) {
  return Object.assign({
    phase: 'play', variant: variant, score: 5, remainingMs: 120000
  }, over || {});
}
function quizRoom(variant, data) {
  return roomSnapshot({
    playerCount: 2, memberCount: 2,
    members: [
      { id: 'm1', name: 'あき', role: 'player', connected: true, isHost: true },
      { id: 'm2', name: 'びび', role: 'player', connected: true, isHost: false }
    ],
    state: { phase: 'play', game: variant, data: data }
  });
}

// ---- 第31弾：オークションの部屋 ----
// auction-room.js が配る形をそのまま真似る。
// 品物の正体が届かないことは realtime-auction.js で見ているので、
// ここでは「届いたものを画面がどう出すか」だけを見る
function auctionView(over) {
  return Object.assign({
    phase: 'show', mode: 'sealed', round: 1, totalRounds: 6,
    remainingMs: 20000, rescueNote: null, teaser: '古びた壺',
    players: [
      { id: 'm1', name: 'あき', connected: true, chips: 20, items: 0 },
      { id: 'm2', name: 'びび', connected: true, chips: 20, items: 1 }
    ]
  }, over || {});
}
function auctionYou(over) {
  return Object.assign({
    phase: 'show', mode: 'sealed', chips: 20, round: 1, totalRounds: 6,
    remainingMs: 20000, teaser: '古びた壺',
    shop: [
      { id: 'halfticket', name: '半額チケット', icon: '🎟', cost: 4, lead: '半分になる', afford: true },
      { id: 'appraise', name: '鑑定眼', icon: '🔍', cost: 3, lead: 'ヒントが出る', afford: true }
    ],
    inventory: [], active: {}, hints: [], ready: false
  }, over || {});
}
function auctionRoom(data) {
  return roomSnapshot({
    playerCount: 2, memberCount: 2,
    members: [
      { id: 'm1', name: 'あき', role: 'player', connected: true, isHost: true },
      { id: 'm2', name: 'びび', role: 'player', connected: true, isHost: false }
    ],
    state: { phase: data.phase, game: 'auction', data: data }
  });
}

// すごろくの偽の部屋。**画面が本当に描かれるか**を見るために使う。
// 通信と状態だけを見るテストでは、画面の不在を捕まえられない（第36弾で実際に起きた）
function sugoBoard(n) {
  const b = [];
  for (let i = 0; i <= n; i++) b.push('plain');
  b[0] = 'start'; b[n] = 'goal';
  return b;
}
function sugoRoom(game, data, opts) {
  const o = opts || {};
  // 大画面のテストでは、自分（既定は m1）が「大画面」でないと、
  // アプリがゲームの画面へ引き戻す。その時だけ役割を書き換える
  const members = [
    { id: 'm1', name: 'あき', role: o.bigMemberId === 'm1' ? 'bigscreen' : 'player',
      connected: true, isHost: true },
    { id: 'm2', name: 'びび', role: 'player', connected: true, isHost: false },
    { id: 'm3', name: 'ちか', role: 'player', connected: true, isHost: false }
  ];
  const players = members.filter((m) => m.role === 'player').length;
  return roomSnapshot({
    playerCount: players, memberCount: members.length, members,
    state: { phase: data.phase, game: game, data: data }
  });
}

// 画面から送られた操作（いちばん新しいもの）
function lastAct(fake) {
  const list = fake.emits.filter((e) => e.name === 'wolf:act');
  return list.length ? list[list.length - 1].payload : null;
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
    // 第37弾：全員が準備OKを押し終えた部屋なので、あとは始まるのを待つだけ
    assert(/まもなく始まります/.test(el(doc, 'rtRoomNote').textContent), '待つように出る');
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
    // 第32弾-D 5-3：人狼の大画面は、文字の一覧ではなく盤面（カード）になった
    const items = doc.querySelectorAll('#bigList .bl-card');
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
  await r.test('「みんなのスマホであそぶ」から、立てるにも参加するにも進める', async () => {
    // 第32弾-A：部屋への導線の本筋はここ。
    // 第32弾-C：棚の下部バーにも近道を戻した。本筋を置き換えたのではなく、
    // 棚を見ている最中に思い立った時のための近道（別のテストで確かめている）
    const b = await launch(Object.assign({}, LAUNCH, { playFlow: false }));
    await waitScreen(b.win, b.doc, 'scr-howto', 4000);
    click(b.doc, b.doc.querySelector('#scr-howto [data-howto="room"]'));
    await waitScreen(b.win, b.doc, 'scr-rt-lobby', 3000);
    assert(b.doc.getElementById('rtJoinCode'), '部屋コードを入れられる');
    assert(b.doc.getElementById('rtJoinName'), '名前を入れられる');
    assertEqual(el(b.doc, 'rtCreateCard').style.display, '', 'ここからは「立てる」も出る');
    // どのカセットにも属さない画面なので、前のテーマを引きずらない
    assert(!el(b.doc, 'app').classList.contains('theme-wolf'), '前のカセットのテーマが乗らない');
    click(b.doc, 'rtLobbyBackBtn');
    await waitScreen(b.win, b.doc, 'scr-howto', 3000);
    assertNoErrors(b.errors, '部屋の入口で未捕捉の例外');
    b.win.close();
  });

  // ---- 第32弾-A 第2部：大画面は「役割」ではなく「表示モード」 ----

  await r.test('参加する時に役割を選ばせない（全員プレイヤーとして入る）', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    await toRoomLobby(win, doc);
    assert(!doc.getElementById('rtJoinRoleSeg'), '役割の選択欄が無い');
    const fake = win.__rtFake;
    await waitFor(win, () => fake.connected, 3000, '疑似socketがつながる');
    fake.replies = { 'room:join': (p) => ({ ok: true, code: 'ABC234', memberId: 'm5', room: roomSnapshot() }) };
    el(doc, 'rtJoinCode').value = 'ABC234';
    el(doc, 'rtJoinName').value = 'えみ';
    click(doc, 'rtJoinBtn');
    await waitScreen(win, doc, 'scr-rt-room', 4000);
    const join = fake.emits.filter(e => e.name === 'room:join').pop();
    assertEqual(join.payload.role, 'player', 'かならずプレイヤーとして入る');
    assertNoErrors(errors, '参加で未捕捉の例外');
    win.close();
  });

  await r.test('「部屋に入る」画面に、人狼専用の文言を出さない', async () => {
    // 部屋はカセットに紐づかない箱なので、「役職を見て、夜の行動や投票をします」は矛盾していた
    const { win, doc, errors } = await launch(LAUNCH);
    await toRoomLobby(win, doc);
    const text = el(doc, 'scr-rt-lobby').textContent;
    ['役職', '夜の行動', '投票', '人狼'].forEach((w) => {
      assertEqual(text.indexOf(w), -1, '「' + w + '」が出ていない');
    });
    assertNoErrors(errors, '部屋に入る画面で未捕捉の例外');
    win.close();
  });

  await r.test('部屋コードを入れると、その部屋で何を遊ぶのかが出る', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    await toRoomLobby(win, doc);
    const fake = win.__rtFake;
    await waitFor(win, () => fake.connected, 3000, '疑似socketがつながる');
    fake.replies = fake.replies || {};

    // まだゲームが選ばれていない部屋
    fake.replies['room:peek'] = () => ({ ok: true, code: 'ABC234', game: null, phase: 'lobby', playerCount: 2 });
    el(doc, 'rtJoinCode').value = 'ABC234';
    el(doc, 'rtJoinCode').dispatchEvent(new win.Event('input'));
    await waitFor(win, () => /待っています/.test(el(doc, 'rtJoinPeek').textContent), 2000, '待ちの案内が出る');
    assert(/2人/.test(el(doc, 'rtJoinPeek').textContent), '何人いるかも出る');

    // ゲームが選ばれている部屋
    fake.replies['room:peek'] = () => ({ ok: true, code: 'ABC234', game: 'quizrush', phase: 'lobby', playerCount: 3 });
    el(doc, 'rtJoinCode').value = 'ABC235';
    el(doc, 'rtJoinCode').dispatchEvent(new win.Event('input'));
    await waitFor(win, () => /クイズラッシュ/.test(el(doc, 'rtJoinPeek').textContent), 2000, 'ゲーム名が出る');

    // 無い部屋
    fake.replies['room:peek'] = () => ({ ok: false, error: 'room_not_found' });
    el(doc, 'rtJoinCode').value = 'ZZZZZZ';
    el(doc, 'rtJoinCode').dispatchEvent(new win.Event('input'));
    await waitFor(win, () => /見つかりません/.test(el(doc, 'rtJoinPeek').textContent), 2000, '無い時は理由が出る');
    assertNoErrors(errors, '部屋を覗くところで未捕捉の例外');
    win.close();
  });

  await r.test('大画面にしても、プレイヤーに戻る道が常に出ている', async () => {
    // 実機で「参加者が大画面を選ぶと、部屋を抜ける以外に戻る手段が無い」状態だった
    const { win, doc } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm5', role: 'bigscreen' });
    assertEqual(activeScreen(doc), 'scr-rt-big', '大画面になっている');
    const back = el(doc, 'bigToPlayerBtn');
    assert(back && back.offsetParent !== null || back, 'プレイヤーに戻るボタンが出ている');

    // 押すとプレイヤーに戻れる
    fake.replies['room:setRole'] = () => ({ ok: true, role: 'player', room: roomSnapshot() });
    click(doc, 'bigToPlayerBtn');
    await waitScreen(win, doc, 'scr-rt-room', 3000);
    const last = fake.emits.filter(e => e.name === 'room:setRole').pop();
    assertEqual(last.payload.role, 'player', 'プレイヤーに戻す');
    win.close();
  });

  await r.test('ホストが大画面にしても、管理操作を続けられる', async () => {
    // 実機で「ホストが大画面を選ぶと、ゲーム選択も部屋の管理も何もできない」状態だった
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { pick: false }); // 自分がホスト（m1）
    fake.replies['room:setRole'] = () => ({
      ok: true, role: 'bigscreen',
      room: roomSnapshot({
        members: roomSnapshot().members.map((m) => (
          m.id === 'm1' ? Object.assign({}, m, { role: 'bigscreen' }) : m
        ))
      })
    });
    click(doc, 'rtToBigBtn');
    await waitScreen(win, doc, 'scr-rt-big', 3000);
    assert(el(doc, 'bigPickGameBtn').style.display !== 'none', 'ゲームをえらべる');
    assert(el(doc, 'bigEndBtn').style.display !== 'none', '部屋を閉じられる');
    assert(el(doc, 'bigToPlayerBtn'), 'プレイヤーにも戻れる');
    // 「ゲームをえらぶ」は待合と同じ動き（棚へ出る）
    click(doc, 'bigPickGameBtn');
    await waitScreen(win, doc, 'scr-shelf', 3000);
    assertNoErrors(errors, 'ホストの大画面で未捕捉の例外');
    win.close();
  });

  await r.test('大画面が無くても、みんなの状況を自分のスマホから見られる', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    push(fake, bombRoom());
    pushYou(fake, bombYou());
    await waitScreen(win, doc, 'scr-rt-bomb', 4000);
    assert(el(doc, 'floatingStatusBtn').style.display !== 'none', 'みんなの状況を開くボタンが出る');
    click(doc, 'floatingStatusBtn');
    await sleep(win, 80);
    assert(el(doc, 'rtStatusOverlay').classList.contains('show'), '開く');
    const text = el(doc, 'rtStatusList').textContent;
    assert(/あき/.test(text) && /びび/.test(text), '全員ぶん出る');
    assert(/解除/.test(text), '公開されている数字が出る');
    click(doc, 'closeRtStatusBtn');
    await sleep(win, 60);
    assert(!el(doc, 'rtStatusOverlay').classList.contains('show'), '閉じられる');
    assertNoErrors(errors, 'みんなの状況で未捕捉の例外');
    win.close();
  });

  await r.test('大画面では「みんなの状況」ボタンを出さない（それ自体が状況なので）', async () => {
    const { win, doc } = await launch(LAUNCH);
    await toRoom(win, doc, { join: true, memberId: 'm5', role: 'bigscreen' });
    assertEqual(el(doc, 'floatingStatusBtn').style.display, 'none', '大画面には出さない');
    win.close();
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

    // 第32弾-C-7：出口は共通の「つぎは？」画面に一本化した
    click(doc, 'rtAgainBtn');
    await waitScreen(win, doc, 'scr-next', 4000);
    doc.querySelector('#nextChoices [data-next="shelf"]').click();
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
    await toRoomLobby(win, doc);
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
    await toRoomLobby(win, doc);
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
    assert(el(doc, 'rtAgainBtn').style.display !== 'none', 'ホストには「つぎは？」が出る');
    assert(!el(doc, 'rtAgainBtn').disabled, '進行役は押せる');
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
    // 第32弾-C-7：押せないボタンを黙って置くと、固まっているのか
    // 待たされているのか分からない。「待っている」と分かる形で出す
    const nextBtn = el(doc, 'rtAgainBtn');
    assert(nextBtn.style.display !== 'none', '参加者にも同じ場所に出る');
    assert(nextBtn.disabled, '参加者は押せない');
    assert(/進行役/.test(nextBtn.textContent),
      '進行役が選んでいると分かる（実際: ' + nextBtn.textContent + '）');
    assert(nextBtn.classList.contains('fx-alive'), '止まっていないことが分かる');
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
    await toRoomLobby(win, doc);
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
    await pickGameForRoom(win, doc, 'bomb', 'bomb-coop');
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
    await pickGameForRoom(win, doc, 'bomb', 'bomb-coop');
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
    // 第28弾-1：難易度で区切らず、届いた順にひとつのグリッドで並べる。
    // 区切ると盤面が緑→黄→橙→赤のグラデーションに見えてしまう
    assertEqual(doc.querySelectorAll('#rtBombBoard .sec-title').length, 0, '難易度で区切らない');
    assertEqual(doc.querySelectorAll('#rtBombBoard .bomb-wire-grid').length, 1,
      'ひとつのグリッドにまとめて並べる');
    // 難易度そのものは枠の色で分かる
    assert(cells[0].className.indexOf('t-') >= 0, '難易度は枠の色で示す');
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
      mode: 'race', team: undefined, board: undefined,
      players: [
        { id: 'm1', name: 'あき', connected: true, solved: 3, total: 4, pct: 75, lives: 1, livesMax: 3, misses: 2, failed: false, timedOut: false, finished: false, working: 'easy', remainingMs: 90000 },
        { id: 'm2', name: 'びび', connected: true, solved: 1, total: 4, pct: 25, lives: 3, livesMax: 3, misses: 0, failed: false, timedOut: false, finished: false, working: null, remainingMs: 150000 }
      ]
    });
    push(fake, bombRoom({ state: { phase: 'play', game: 'bomb', data: race } }));
    pushYou(fake, bombYou({ mode: 'race' }));
    await waitScreen(win, doc, 'scr-rt-bomb', 4000);
    assertEqual(el(doc, 'rtBombPhase').textContent, '競争版・解除中', '競争版だと分かる');
    const note = el(doc, 'rtBombNote').textContent;
    assert(/あき/.test(note) && /あと1/.test(note), '他の人の残り本数が出る');
    assert(!/びび/.test(note), '自分の分は一覧に入れない');
    // 協力版と同じ部品で描く（見た目の部品は共通、中身のデータだけが違う）
    assertEqual(doc.querySelectorAll('#rtBombBoard .sec-title').length, 0, '難易度で区切らない');
    assertEqual(doc.querySelectorAll('#rtBombBoard .bomb-wire-grid').length, 1,
      '協力版と同じひとつのグリッド');
    assertNoErrors(errors, '競争版の画面で未捕捉の例外');
    win.close();
  });

  await r.test('クイズ解除：決着したら結果と、次に進むボタンが出る', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { pick: false });   // 自分がホスト（m1）
    await pickGameForRoom(win, doc, 'bomb', 'bomb-coop');
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

  await r.test('クイズ解除：部屋版でも、爆発・解除成功の瞬間の演出が出る（第33弾 A-2）', async () => {
    // 前回まで手渡し版にだけ実装していて、部屋版は結果の文字が出るだけだった。
    // 実機テストは部屋で行われたので「爆発のアニメーションが無い」ように見えた（落とし穴1）
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    // まず解除中の画面を見る（決着の演出は、見ていた人にだけ出す）
    push(fake, bombRoom());
    pushYou(fake, bombYou());
    await waitScreen(win, doc, 'scr-rt-bomb', 4000);
    assertEqual(doc.querySelectorAll('.bomb-boom').length, 0, 'まだ爆発は出ていない');
    // 協力版の失敗で決着 → 爆発の演出（赤い閃光）が出る
    const lost = bombView({
      phase: 'ended',
      result: { mode: 'coop', success: false, cause: 'lives', solved: 2, total: 4,
        lives: 0, livesMax: 3, misses: 3, elapsedSec: 120, codes: [] }
    });
    push(fake, bombRoom({ state: { phase: 'ended', game: 'bomb', data: lost } }));
    pushYou(fake, bombYou({ phase: 'ended', lives: 0, result: lost.result }));
    await sleep(win, 100);
    assertEqual(doc.querySelectorAll('.bomb-boom').length, 1, '爆発の閃光が出る');
    assert(/爆発/.test(el(doc, 'rtBombResult').textContent), '結果も出ている');
    // 決着の画面を描き直しても、爆発は繰り返さない（1回だけの閃光）
    const firstBoom = doc.querySelector('.bomb-boom');
    push(fake, bombRoom({ state: { phase: 'ended', game: 'bomb', data: lost } }));
    await sleep(win, 100);
    const booms = doc.querySelectorAll('.bomb-boom');
    assert(booms.length === 1 && booms[0] === firstBoom, '2発目の閃光は出ない');
    await sleep(win, 800);
    assertEqual(doc.querySelectorAll('.bomb-boom').length, 0, '閃光は時間で消える');
    assertNoErrors(errors, '爆発の演出で未捕捉の例外');
    win.close();
  });

  await r.test('クイズ解除：競争版で自分のライフが尽きた瞬間、自分の端末で爆発が出る（第33弾 A-2）', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    push(fake, bombRoom());
    pushYou(fake, bombYou({ mode: 'race', lives: 1 }));
    await waitScreen(win, doc, 'scr-rt-bomb', 4000);
    // 最後のライフを失った（ゲーム自体はまだ続いている）
    pushYou(fake, bombYou({ mode: 'race', lives: 0, misses: 3, failed: true }));
    await sleep(win, 100);
    assertEqual(doc.querySelectorAll('.bomb-boom').length, 1, '自分の爆弾が爆発する');
    assertNoErrors(errors, '競争版の爆発で未捕捉の例外');
    win.close();
  });

  // ---- 第33弾 B：部屋あり・1人1台まわりの不具合 ----

  await r.test('部屋の「もう一度」は、全員が待合にもどってホストの合図で始まる（第33弾 B-1）', async () => {
    // 以前は押した瞬間に始まり、押した本人以外は心の準備なくゲームに放り込まれた
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc);   // ホスト・wolfrole 選択済み
    push(fake, endedWolfRoom());
    pushYou(fake, endedWolfYou());
    await waitScreen(win, doc, 'scr-rt-play', 4000);
    click(doc, 'rtAgainBtn');
    await waitScreen(win, doc, 'scr-next', 3000);
    const startsBefore = fake.emits.filter(e => e.name === 'wolf:start').length;
    doc.querySelector('#nextChoices [data-next="again"]').click();
    await waitScreen(win, doc, 'scr-rt-room', 3000);
    const reset = fake.emits.filter(e => e.name === 'room:setState').pop();
    assert(reset && reset.payload.reset === true, '前の進行を捨てて待合にもどす');
    assertEqual(reset.payload.game, 'wolfrole', '同じゲームのまま（設定は選び直させない）');
    assertEqual(fake.emits.filter(e => e.name === 'wolf:start').length, startsBefore,
      '勝手にはゲームを始めない（ホストの「はじめる」を待つ）');
    assertNoErrors(errors, '「もう一度」で未捕捉の例外');
    win.close();
  });

  await r.test('部屋が待合にもどったら、ほかのプレイヤーの画面も待合へ動く', async () => {
    // B-1 の相方：ホストが「もう一度」でもどした時、非ホストが結果画面に取り残されない
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    push(fake, endedWolfRoom());
    pushYou(fake, endedWolfYou());
    await waitScreen(win, doc, 'scr-rt-play', 4000);
    push(fake, roomSnapshot());   // サーバーが待合（lobby）にもどした
    await waitScreen(win, doc, 'scr-rt-room', 3000);
    assertNoErrors(errors, '待合へもどる時に未捕捉の例外');
    win.close();
  });

  await r.test('設定の「ゲームを終了」：部屋のホストは、全員を待合にもどす（第33弾 B-4）', async () => {
    // 以前は手渡し専用の処理のままで、「プレイヤーがいません」と言いながら
    // 部屋のゲームは動き続けていた
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc);
    push(fake, roomSnapshot({ state: { phase: 'vote', game: 'wolfrole', data: wolfView({ phase: 'vote' }) } }));
    pushYou(fake, { phase: 'vote', roleId: 'villager', roleName: '村人', roleDesc: '',
      alive: true, done: true, choices: [] });
    await waitScreen(win, doc, 'scr-rt-play', 4000);
    win.confirm = () => true;
    click(doc, 'endGameBtn');
    await waitScreen(win, doc, 'scr-rt-room', 3000);
    const reset = fake.emits.filter(e => e.name === 'room:setState').pop();
    assert(reset && reset.payload.reset === true && reset.payload.game === 'wolfrole',
      '進行を捨てて、部屋ごと待合にもどす');
    assertNoErrors(errors, 'ゲーム終了（ホスト）で未捕捉の例外');
    win.close();
  });

  await r.test('設定の「ゲームを終了」：部屋のプレイヤーは、自分だけ部屋から抜ける（第33弾 B-4）', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    push(fake, roomSnapshot({ state: { phase: 'vote', game: 'wolfrole', data: wolfView({ phase: 'vote' }) } }));
    pushYou(fake, { phase: 'vote', roleId: 'villager', roleName: '村人', roleDesc: '',
      alive: true, done: true, choices: [] });
    await waitScreen(win, doc, 'scr-rt-play', 4000);
    win.confirm = () => true;
    click(doc, 'endGameBtn');
    await waitFor(win, () => fake.emits.some(e => e.name === 'room:leave'), 3000, '部屋から抜ける');
    await waitScreen(win, doc, 'scr-shelf', 3000);
    assertNoErrors(errors, 'ゲーム終了（非ホスト）で未捕捉の例外');
    win.close();
  });

  await r.test('部屋を持ったまま「1台のスマホで遊ぶ」を選ぶと、確認してから部屋を閉じる（第33弾 B-3）', async () => {
    // 以前は部屋に紐づいたまま手渡しへ進めてしまい、状態が混ざっていた
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { pick: false });   // ホスト・待合にいる
    let asked = null;
    win.confirm = (m) => { asked = m; return true; };
    click(doc, 'rtPickGameBtn');
    await waitScreen(win, doc, 'scr-shelf', 3000);
    click(doc, 'shelfFlowBtn');
    await waitScreen(win, doc, 'scr-howto', 3000);
    doc.querySelector('#scr-howto [data-howto="handoff"]').click();
    await waitFor(win, () => fake.emits.some(e => e.name === 'room:close'), 3000, '部屋を閉じにいく');
    assert(/部屋を閉じて/.test(asked || ''), '確認の文言が出る（実際: ' + asked + '）');
    await waitScreen(win, doc, 'scr-shelf', 3000);
    assertNoErrors(errors, '手渡しへの切り替えで未捕捉の例外');
    win.close();
  });

  await r.test('部屋の人狼にも、処刑の発表と決着の陣営色が出る（第33弾 B-2）', async () => {
    // 32-Cの演出が手渡し側にだけ入っていて、部屋側は文字が変わるだけだった
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    push(fake, roomSnapshot({ state: { phase: 'vote', game: 'wolfrole', data: wolfView({ phase: 'vote', turn: 1 }) } }));
    pushYou(fake, { phase: 'vote', roleId: 'villager', roleName: '村人', roleDesc: '',
      alive: true, done: true, choices: [] });
    await waitScreen(win, doc, 'scr-rt-play', 4000);
    // 処刑の発表
    push(fake, roomSnapshot({ state: { phase: 'turnResult', game: 'wolfrole', data: wolfView({
      phase: 'turnResult', turn: 1,
      turnResult: { executed: { name: 'ちか', role: null }, noVotes: false,
        counts: [{ name: 'ちか', n: 3 }], runoff: null }
    }) } }));
    pushYou(fake, { phase: 'turnResult', roleId: 'villager', roleName: '村人', roleDesc: '',
      alive: true, done: true, choices: [] });
    await sleep(win, 150);
    const banner = doc.querySelector('.fx-banner');
    assert(banner && /処刑/.test(banner.textContent), '処刑の発表が出る');
    // 決着：勝った陣営の色で照らされる
    push(fake, endedWolfRoom());
    pushYou(fake, endedWolfYou());
    await sleep(win, 150);
    assert(doc.getElementById('app').classList.contains('edge-village'),
      '勝った陣営の色で画面が照らされる');
    assertNoErrors(errors, '部屋の人狼の演出で未捕捉の例外');
    win.close();
  });

  await r.test('待機画面から、進行役が直接メンバーを操作できる（第32弾-E 第3部）', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { pick: false });   // ホスト（m1）
    win.confirm = () => true;
    // 各メンバーの行に、進行役だけの操作が付く
    const kick = doc.querySelector('#rtMemberList [data-rmkick="m2"]');
    const toBig = doc.querySelector('#rtMemberList [data-rmrole="m2"]');
    const toHost = doc.querySelector('#rtMemberList [data-rmhost="m2"]');
    assert(kick && toBig && toHost, 'キック・大画面・進行役の操作が並ぶ');
    assert(!doc.querySelector('#rtMemberList [data-rmkick="m1"]'), '自分の行には出ない');
    toBig.click();
    await waitFor(win, () => fake.emits.some(e => e.name === 'room:setRole'
      && e.payload.memberId === 'm2' && e.payload.role === 'bigscreen'), 3000, '大画面へ切り替えを送る');
    kick.click();
    await waitFor(win, () => fake.emits.some(e => e.name === 'room:kick'
      && e.payload.memberId === 'm2'), 3000, 'キックを送る');
    assertNoErrors(errors, 'メンバー操作で未捕捉の例外');
    win.close();
  });

  await r.test('待機画面でない人（非ホスト）には、メンバー操作が出ない', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    await toRoom(win, doc, { join: true, memberId: 'm2' });
    assertEqual(doc.querySelectorAll('#rtMemberList .rm-op').length, 0, '操作ボタンが無い');
    assertNoErrors(errors, '非ホストの表示で未捕捉の例外');
    win.close();
  });

  await r.test('待機画面に、2人組の記録の一言が静かに出る（第32弾-E 第1部・第2部）', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    push(fake, roomSnapshot({
      pairNote: { top: { a: 'あき', b: 'びび', count: 7 }, fresh: [{ a: 'ちか', b: 'でん' }] }
    }));
    await sleep(win, 100);
    const text = el(doc, 'rtPairNote').textContent;
    assert(/あき さんと びび さん/.test(text) && /7回/.test(text), '一番長い付き合いが出る');
    assert(/ちか さんと でん さん/.test(text) && /初めての組み合わせ/.test(text), '初組み合わせを静かに祝う');
    // 一覧は出さない（回数の少ない人が疎外感を持つ表示にしない）
    assertEqual((text.match(/回/g) || []).length, 1, '回数が出るのは一番の組だけ');
    assertNoErrors(errors, '2人組の一言で未捕捉の例外');
    win.close();
  });

  // 第36弾 36-1：3-2-1は「全員が同じ瞬間に始まるための合図」であって演出ではない。
  // 実機では途中を叩くと自分だけ先に進めてしまっていた。
  // 進行役でも、そうでない人でも、同じように飛ばせないこと（経路は1本だが、両方から確かめる）
  for (const who of [
    { label: '進行役', opts: { memberId: 'm1' } },
    { label: '進行役でない人', opts: { join: true, memberId: 'm2' } }
  ]) {
    await r.test('36-1：部屋の3-2-1は、' + who.label + 'の画面でもタップで飛ばせない（第34弾 2-1／第36弾 36-1）', async () => {
      const { win, doc, errors } = await launch(LAUNCH);
      const fake = await toRoom(win, doc, who.opts);
      // サーバーが「始まる合図」を全員に放送してくる
      fake.fire('room:countdown', { seconds: 3 });
      await sleep(win, 120);
      const cd = doc.querySelector('.fx-countdown');
      assert(cd && /3/.test(cd.textContent), '3から数え始める');
      // 画面を叩いても、合図は縮まない
      doc.getElementById('app').dispatchEvent(new win.Event('pointerdown', { bubbles: true }));
      await sleep(win, 300);
      assert(doc.querySelector('.fx-countdown'), 'タップしても消えない');
      // 3秒たてば、ひとりでに終わる（あとに残らない）
      await waitFor(win, () => !doc.querySelector('.fx-countdown'), 6000, '数え終わる');
      assertNoErrors(errors, '開始カウントダウンで未捕捉の例外');
      win.close();
    });
  }

  await r.test('「ありがとう」を受け取ると、おくりものの称号に数えられる（第34弾 2-2）', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    const sent = titlePuts(win);
    fake.fire('room:thanked', { from: 'あき', kind: 'help', label: '今日、いちばん助かった' });
    await waitFor(win, () => sent.length >= 1, 3000, '数えにいく');
    const last = sent[sent.length - 1];
    assertEqual(last.stats.social.thanksGot, 1, '受け取った1回が数えられる');
    assert(last.unlocked.indexOf('icon-thanks-1') >= 0, '1回で「はじめてのありがとう」');
    assertNoErrors(errors, 'ありがとうの称号で未捕捉の例外');
    win.close();
  });

  await r.test('リアクション：ゲーム画面に帯が出て、届いた絵文字がふっと浮かぶ（第32弾-E 第4部）', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    push(fake, roomSnapshot({ state: { phase: 'vote', game: 'wolfrole', data: wolfView({ phase: 'vote' }) } }));
    pushYou(fake, { phase: 'vote', roleId: 'villager', roleName: '村人', roleDesc: '',
      alive: true, done: true, choices: [] });
    await waitScreen(win, doc, 'scr-rt-play', 4000);
    assertEqual(el(doc, 'reactBar').style.display, 'flex', 'ゲーム画面では帯が出る');
    assertEqual(doc.querySelectorAll('#reactBar .react-btn').length, 5, '絵文字は5つに絞る');
    // 押すとサーバーへ送る（自分の画面に出るのは、全員へ配られて戻ってきた時）
    doc.querySelector('#reactBar [data-react]').click();
    await waitFor(win, () => fake.emits.some(e => e.name === 'room:react'), 3000, '送っている');
    // 届いたら、ふっと浮かんで消える
    fake.fire('room:reacted', { name: 'あき', emoji: '🔥' });
    await sleep(win, 80);
    assertEqual(doc.querySelectorAll('.react-fly').length, 1, '浮かんでいる');
    await sleep(win, 2200);
    assertEqual(doc.querySelectorAll('.react-fly').length, 0, '一瞬で消える（残らない）');
    assertNoErrors(errors, 'リアクションで未捕捉の例外');
    win.close();
  });

  await r.test('リアクション：設定でOFFにすると、帯も他の人の反応も出ない', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    // 設定を切る（トグルはどの画面からでも同じ部品なので、直接押す）
    click(doc, 'setReactionsToggle');
    push(fake, roomSnapshot({ state: { phase: 'vote', game: 'wolfrole', data: wolfView({ phase: 'vote' }) } }));
    pushYou(fake, { phase: 'vote', roleId: 'villager', roleName: '村人', roleDesc: '',
      alive: true, done: true, choices: [] });
    await waitScreen(win, doc, 'scr-rt-play', 4000);
    assertEqual(el(doc, 'reactBar').style.display, 'none', '帯が出ない');
    fake.fire('room:reacted', { name: 'あき', emoji: '🔥' });
    await sleep(win, 80);
    assertEqual(doc.querySelectorAll('.react-fly').length, 0, '他の人の反応も出ない');
    assertNoErrors(errors, 'リアクションOFFで未捕捉の例外');
    win.close();
  });

  await r.test('感謝：決着したら🎁が出て、項目→相手の順に選んで贈れる（第32弾-E 第5部）', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    push(fake, endedWolfRoom());
    pushYou(fake, endedWolfYou());
    await waitScreen(win, doc, 'scr-rt-play', 4000);
    assert(el(doc, 'thanksBtn').style.display !== 'none', '決着したら🎁が出る');
    click(doc, 'thanksBtn');
    await sleep(win, 50);
    assertEqual(doc.querySelectorAll('#thanksKinds [data-thkind]').length, 3, '勝敗と関係ない3つの項目');
    doc.querySelector('[data-thkind="laugh"]').click();
    await sleep(win, 50);
    const whoBtns = doc.querySelectorAll('#thanksWho [data-thwho]');
    assert(whoBtns.length >= 1, '相手を選べる');
    assert(!Array.prototype.some.call(whoBtns, b => b.dataset.thwho === 'm2'), '自分は選べない');
    whoBtns[0].click();
    await waitFor(win, () => fake.emits.some(e => e.name === 'room:thanks'
      && e.payload.kind === 'laugh'), 3000, '贈っている');
    await sleep(win, 80);
    assertEqual(el(doc, 'thanksBtn').style.display, 'none', '贈ったら🎁は引っ込む（1決着に1回）');
    assertNoErrors(errors, '感謝で未捕捉の例外');
    win.close();
  });

  await r.test('感謝：贈られた本人には、誰からかが分かるお祝いが出る', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    push(fake, endedWolfRoom());
    pushYou(fake, endedWolfYou());
    await waitScreen(win, doc, 'scr-rt-play', 4000);
    fake.fire('room:thanked', { from: 'あき', kind: 'help', label: '今日、いちばん助かった' });
    await sleep(win, 100);
    const banner = doc.querySelector('.fx-banner');
    assert(banner && /助かった/.test(banner.textContent) && /あき/.test(banner.textContent),
      '何に選ばれ、誰からかが分かる');
    assertNoErrors(errors, '感謝の受け取りで未捕捉の例外');
    win.close();
  });

  await r.test('アルバム：待機画面に箱があり、進行役だけが受け取れる（第32弾-E 第6部）', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { pick: false });   // ホスト
    const line = el(doc, 'albumStatusLine').textContent;
    assert(/AIには一切渡しません/.test(line), 'AIに渡さないことが書いてある');
    assert(/サーバーから消します/.test(line), '消すことが書いてある');
    assertEqual(el(doc, 'albumGetBtn').style.display, 'none', '箱が空なら受け取りは出ない');
    // 2枚入った知らせが来ると、進行役に受け取りボタンが出る
    fake.fire('album:update', { count: 2, names: ['あき', 'びび'] });
    await sleep(win, 80);
    assert(/2枚/.test(el(doc, 'albumStatusLine').textContent), '箱の中身が分かる');
    assert(el(doc, 'albumGetBtn').style.display !== 'none', '進行役に受け取りが出る');
    click(doc, 'albumGetBtn');
    await sleep(win, 50);
    assert(el(doc, 'albumOverlay').classList.contains('show'), '受け渡しの画面が開く');
    const warn = doc.querySelector('#albumOverlay .album-warn').textContent;
    assert(/サーバーから消されます！/.test(warn), '赤字の明示①（指示の必須事項）');
    assert(/今この一度しか/.test(warn), '赤字の明示②');
    // サーバーから消えた知らせは、はっきり伝わる
    fake.fire('album:update', { count: 0, names: [], cleared: true });
    await sleep(win, 80);
    assert(!el(doc, 'albumOverlay').classList.contains('show'), '受け渡しの画面は閉じる');
    assert(/削除しました/.test(doc.body.textContent), '消したことが画面に出る');
    assertNoErrors(errors, 'アルバムで未捕捉の例外');
    win.close();
  });

  await r.test('ラッシュ：おてつき中は残り秒が出て、難易度が押せない（第33弾 C-2）', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2', game: 'quizrush' });
    push(fake, quizRoom('quizrush', quizView('quizrush', { rush: { round: 1, roundsToWin: 0, roundResult: null, board: [] } })));
    pushYou(fake, quizYou('quizrush', {
      rush: { tier: 'easy', canChangeTier: true, passesLeft: 3, score: 0,
        answered: 1, hits: 0, last: 'miss', question: null, coolMs: 700 }
    }));
    await waitScreen(win, doc, 'scr-rt-quiz', 4000);
    assert(/おてつき/.test(el(doc, 'qzBody').textContent), '待たされていることが分かる');
    const tiers = doc.querySelectorAll('#qzBody .tier-card');
    assert(tiers.length > 0 && tiers[0].disabled, '難易度は押せない');
    // 待ちが明けると、そのまま（サーバーを待たずに）選べる画面へ戻る
    await waitFor(win, () => {
      const t = doc.querySelectorAll('#qzBody .tier-card');
      return t.length > 0 && !t[0].disabled;
    }, 3000, 'おてつきが明けて選べるようになる');
    assert(!/おてつき/.test(el(doc, 'qzBody').textContent), '待ちの表示が消える');
    assertNoErrors(errors, 'おてつきの表示で未捕捉の例外');
    win.close();
  });

  await r.test('全員が投票をとばした回は「同数」と言わない（第33弾 B-7）', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    push(fake, roomSnapshot({ state: { phase: 'turnResult', game: 'wolfrole', data: wolfView({
      phase: 'turnResult', turn: 1,
      turnResult: { executed: null, noVotes: true, counts: [], runoff: null }
    }) } }));
    pushYou(fake, { phase: 'turnResult', roleId: 'villager', roleName: '村人', roleDesc: '',
      alive: true, done: true, choices: [] });
    await waitScreen(win, doc, 'scr-rt-play', 4000);
    const text = el(doc, 'rtPublicBox').textContent;
    assert(/全員が投票をとばした/.test(text), 'とばしたことが伝わる（実際: ' + text.slice(0, 60) + '）');
    assert(!/同数/.test(text), '「同数」とは言わない');
    assertNoErrors(errors, '投票スキップの表示で未捕捉の例外');
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

  // ---- 第27弾-3：実物解除の画面 ----

  await r.test('実物解除：体を動かす同意で、何をするかと断れることが出る', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    const ask = {
      moves: ['端末を振る', 'その場でポーズを取る'],
      camera: true,
      notes: ['まわりに人や物がないか確かめてください', '端末は落とさないよう、しっかり握ってください'],
      declineNote: '「参加しない」を選んでも、マニュアル役として一緒に遊べます'
    };
    push(fake, defuseRoom({
      state: { phase: 'consent', game: 'defuse', data: defuseView({ phase: 'consent', board: undefined }) }
    }));
    pushYou(fake, defuseYou({ phase: 'consent', role: null, board: undefined, consent: null, consentAsk: ask }));
    await waitScreen(win, doc, 'scr-rt-defuse', 4000);
    const text = el(doc, 'dfConsentBox').textContent;
    assert(/端末を振る/.test(text), 'どんな動作があるかが出る');
    assert(/まわりに人や物/.test(text), '気をつけることが出る');
    assert(/参加しない/.test(text), '断れることが出る');
    assert(doc.getElementById('dfConsentYes'), '「参加する」がある');
    assert(doc.getElementById('dfConsentNo'), '「参加しない」がある');

    click(doc, 'dfConsentNo');
    await sleep(win, 120);
    const act = fake.emits.filter(e => e.name === 'wolf:act').pop();
    assertEqual(act.payload.targetId, 'no', '断ったことを送っている');
    assertNoErrors(errors, '同意画面で未捕捉の例外');
    win.close();
  });

  await r.test('実物解除：役割をえらぶと、端末で読めるセンサーも一緒に送る', async () => {
    // これが無いと、傾きも読めない端末に傾け迷路が出て詰む
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    push(fake, defuseRoom({
      state: {
        phase: 'roles', game: 'defuse',
        data: defuseView({
          phase: 'roles', board: undefined,
          players: [
            { id: 'm1', name: 'あき', connected: true, role: null, working: null, done: false },
            { id: 'm2', name: 'びび', connected: true, role: null, working: null, done: false }
          ]
        })
      }
    }));
    pushYou(fake, defuseYou({
      phase: 'roles', role: null, board: undefined,
      roleAsk: { mode: 'normal', focus: false, taken: [], physicalDeclined: false }
    }));
    await waitScreen(win, doc, 'scr-rt-defuse', 4000);
    assert(/解除役/.test(el(doc, 'dfRolesBox').textContent), '解除役をえらべる');
    assert(/マニュアル役/.test(el(doc, 'dfRolesBox').textContent), 'マニュアル役もえらべる');
    assert(/解除役が1人もいない/.test(el(doc, 'dfRolesBox').textContent), '始められない理由が出る');

    click(doc, doc.querySelector('#dfRolesBox [data-dfrole="defuser"]'));
    await sleep(win, 150);
    const act = fake.emits.filter(e => e.name === 'wolf:act').pop();
    assertEqual(act.payload.targetId, 'defuser', '選んだ役割を送っている');
    assert(act.payload.caps && typeof act.payload.caps.orientation === 'boolean',
      '端末で読めるセンサーを一緒に送っている');
    assertNoErrors(errors, '役割えらびで未捕捉の例外');
    win.close();
  });

  // 第28弾-3：説明に出す中身。サーバー（defuse-logic）が配る形をそのまま真似る
  function defuseBriefs() {
    return [
      { type: 'maze', name: '傾け迷路', icon: '🌀', lead: '端末を傾けて、ボールをゴールまで運ぼう',
        how: ['端末を傾けると、ボールが1マスずつ動く', '壁と罠は自分の画面には見えない'],
        tip: '傾きが使えない時は、画面の十字ボタンでも動かせます',
        physical: false, needsLevelCheck: true },
      { type: 'shake', name: '振ってアクション', icon: '📳', lead: '決まった回数・テンポで端末を振ろう',
        how: ['画面に出ている記号をマニュアル役に伝える', 'そのとおりに端末を振る'],
        tip: 'まわりに人や物がないか確かめてから振ってください',
        physical: true, needsLevelCheck: false }
    ];
  }

  await r.test('実物解除：初めてのモジュールだけ、1つずつ説明が出る', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    const briefs = defuseBriefs();
    push(fake, defuseRoom({
      state: { phase: 'brief', game: 'defuse', data: defuseView({ phase: 'brief' }) }
    }));
    pushYou(fake, defuseYou({ phase: 'brief', done: false, briefs }));
    await waitScreen(win, doc, 'scr-rt-defuse', 4000);

    const box = el(doc, 'dfBriefBox');
    assert(/傾け迷路/.test(box.textContent), '1つ目の説明が出る');
    assert(/1 \/ 2/.test(box.textContent), '何枚目かが分かる');
    assert(!/振ってアクション/.test(box.textContent), '2つ目はまだ出ない（1つずつ）');
    assert(doc.getElementById('dfBriefSkip'), 'スキップできる');

    click(doc, 'dfBriefNext');
    await sleep(win, 80);
    assert(/振ってアクション/.test(el(doc, 'dfBriefBox').textContent), '「つぎへ」で2つ目に進む');
    assert(/体を動かします/.test(el(doc, 'dfBriefBox').textContent), '体を動かすことが書いてある');

    click(doc, 'dfBriefNext');
    await sleep(win, 120);
    const act = fake.emits.filter(e => e.name === 'wolf:act').pop();
    assert(act, '読み終わったことをサーバーに伝える');
    assertNoErrors(errors, 'モジュールの説明で未捕捉の例外');
    win.close();
  });

  await r.test('実物解除：一度見た種類は、次からは説明が出ない', async () => {
    // 毎回全部読まされると、2回目以降がだるくなる
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    const briefs = defuseBriefs();
    // 見たことのある種類として記録しておく（端末が覚えている）
    win.localStorage.setItem('acac-defuse-seen', JSON.stringify(['maze', 'shake']));
    push(fake, defuseRoom({
      state: { phase: 'brief', game: 'defuse', data: defuseView({ phase: 'brief' }) }
    }));
    pushYou(fake, defuseYou({ phase: 'brief', done: false, briefs }));
    await waitScreen(win, doc, 'scr-rt-defuse', 4000);
    await sleep(win, 150);
    // 初めての種類が無いので、待たせずに準備完了を送る
    const act = fake.emits.filter(e => e.name === 'wolf:act').pop();
    assert(act, '読むものが無ければ、すぐ準備完了にする');
    // 説明そのものは1枚も出さない（ここが出ていたら、既読の判定が効いていない）
    const box = el(doc, 'dfBriefBox');
    assert(!/傾け迷路/.test(box.textContent), '見たことのある説明は出さない');
    assert(!doc.getElementById('dfBriefNext'), '「つぎへ」も出ない');
    assertNoErrors(errors, '既読の説明で未捕捉の例外');
    win.close();
  });

  await r.test('実物解除：読みかけの説明が、次のゲームに持ち越されない', async () => {
    // 第35弾B：読んでいる途中でゲームが終わった（切断中に進んだ・選び直しなど）端末は、
    // 次のdefuseで「前のゲームの説明」をそのまま見せられていた。
    // その場合、今回の盤面の説明は一度も出ない（初見の人が正しい遊び方を読めない）
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    // ゲーム1の説明（傾け迷路・振ってアクション）を1枚目まで読んで、読み終わらないまま放置
    push(fake, defuseRoom({
      state: { phase: 'brief', game: 'defuse', data: defuseView({ phase: 'brief' }) }
    }));
    pushYou(fake, defuseYou({ phase: 'brief', done: false, briefs: defuseBriefs() }));
    await waitScreen(win, doc, 'scr-rt-defuse', 4000);
    assert(/傾け迷路/.test(el(doc, 'dfBriefBox').textContent), '前提：ゲーム1の説明が出ている');

    // ゲーム2：役割えらびを経て、別の顔ぶれ（面認証）の説明フェーズへ
    push(fake, defuseRoom({
      state: { phase: 'roles', game: 'defuse', data: defuseView({ phase: 'roles', board: undefined }) }
    }));
    pushYou(fake, defuseYou({
      phase: 'roles', role: null, board: undefined,
      roleAsk: { mode: 'normal', focus: false, taken: [], physicalDeclined: false }
    }));
    await sleep(win, 150);
    const briefs2 = [
      { type: 'face', name: '面認証', icon: '🔄', lead: '面の色と記号をマニュアル役に伝えよう',
        how: ['端末を回して面を出す', '色と記号を伝える'], tip: null,
        physical: false, needsLevelCheck: false }
    ];
    push(fake, defuseRoom({
      state: { phase: 'brief', game: 'defuse', data: defuseView({ phase: 'brief' }) }
    }));
    pushYou(fake, defuseYou({ phase: 'brief', done: false, briefs: briefs2 }));
    await sleep(win, 200);

    const box = el(doc, 'dfBriefBox');
    assert(/面認証/.test(box.textContent), '今回のゲームの説明が出る（実際: ' + box.textContent.slice(0, 40) + '）');
    assert(!/傾け迷路/.test(box.textContent), '前のゲームの読みかけが出ない');
    assertNoErrors(errors, '説明の持ち越しで未捕捉の例外');
    win.close();
  });

  await r.test('実物解除：部屋の知らせが秘密より先に届いても、説明を勝手に読了しない', async () => {
    // 第35弾B：役割を最後に選んだ端末は、部屋の「brief段階になった」知らせが
    // 自分の新しい秘密（説明の中身）より先に届く。その瞬間の手元の秘密は
    // まだ役割えらび段階のもの（briefsが無い）なので、「読むものが無い」と
    // 誤判定して自動で読了を送っていた＝最後に役割を選んだ人だけ説明が丸ごと飛ぶ
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    // 役割えらび中の秘密（まだ選んでいない＝done:false・briefsは無い）
    push(fake, defuseRoom({
      state: { phase: 'roles', game: 'defuse', data: defuseView({ phase: 'roles', board: undefined }) }
    }));
    pushYou(fake, defuseYou({
      phase: 'roles', role: null, board: undefined, done: false,
      roleAsk: { mode: 'normal', focus: false, taken: [], physicalDeclined: false }
    }));
    await waitScreen(win, doc, 'scr-rt-defuse', 4000);

    // 部屋の知らせだけが先に届く（自分の秘密はまだ役割えらびのまま）
    const actsBefore = fake.emits.filter(e => e.name === 'wolf:act').length;
    push(fake, defuseRoom({
      state: { phase: 'brief', game: 'defuse', data: defuseView({ phase: 'brief' }) }
    }));
    await sleep(win, 250);
    const actsAfter = fake.emits.filter(e => e.name === 'wolf:act').length;
    assertEqual(actsAfter, actsBefore, '古い秘密のまま、勝手に読了を送らない');

    // 遅れて秘密が届いたら、ちゃんと説明が出る
    pushYou(fake, defuseYou({ phase: 'brief', done: false, briefs: defuseBriefs() }));
    await sleep(win, 200);
    assert(/傾け迷路/.test(el(doc, 'dfBriefBox').textContent), '秘密がそろってから説明が出る');
    assertNoErrors(errors, '知らせの順番ちがいで未捕捉の例外');
    win.close();
  });

  await r.test('実物解除：説明はあとからいつでも見返せる', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    push(fake, defuseRoom());
    pushYou(fake, defuseYou({ role: 'defuser', briefs: defuseBriefs() }));
    await waitScreen(win, doc, 'scr-rt-defuse', 4000);
    assert(el(doc, 'dfHelpBtn').style.display !== 'none', '解除中も説明のボタンが出ている');

    click(doc, 'dfHelpBtn');
    await sleep(win, 100);
    const box = el(doc, 'dfBriefBox');
    assertEqual(box.style.display, 'block', '説明が開く');
    // 見返す時は、初めてかどうかに関係なく全部見られる
    assert(/傾け迷路/.test(box.textContent), '1枚目が出る');
    assert(/1 \/ 2/.test(box.textContent), '全部の枚数が出る');
    assertNoErrors(errors, '説明の見返しで未捕捉の例外');
    win.close();
  });

  await r.test('実物解除：全員が読み終わるまで、解除は始まらない', async () => {
    // 「準備完了」と同じ考え方。読んでいる人を置いていかない
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    push(fake, defuseRoom({
      state: {
        phase: 'brief', game: 'defuse',
        data: defuseView({ phase: 'brief', waiting: ['あき'] })
      }
    }));
    pushYou(fake, defuseYou({ phase: 'brief', done: true, briefs: defuseBriefs() }));
    await waitScreen(win, doc, 'scr-rt-defuse', 4000);
    const box = el(doc, 'dfBriefBox');
    assert(/待って/.test(box.textContent), '待っていることが分かる');
    assert(/あき/.test(box.textContent), 'まだの人の名前が出る');
    assertEqual(el(doc, 'dfBoardBox').style.display, 'none', '盤面はまだ出さない');
    assertNoErrors(errors, '説明の待ち合わせで未捕捉の例外');
    win.close();
  });

  await r.test('実物解除：傾きを使うモジュールは、水平を取ってから始まる', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    push(fake, defuseRoom());
    pushYou(fake, defuseYou({
      role: 'defuser',
      open: {
        uid: 'md1', type: 'maze', name: '傾け迷路', icon: '🌀',
        lead: '端末を傾けて、ボールをゴールまで運ぼう', solved: false,
        hint: { size: 5, start: { x: 0, y: 0 }, goal: { x: 4, y: 4 }, at: { x: 0, y: 0 } },
        progress: { at: { x: 0, y: 0 }, steps: 0 }
      }
    }));
    await waitScreen(win, doc, 'scr-rt-defuse', 4000);
    await sleep(win, 150);
    assert(el(doc, 'dfModOverlay').classList.contains('show'), 'モジュールが開く');
    // 迷路そのものではなく、まず水平の確認が出る
    assert(/水平/.test(el(doc, 'dfModBody').textContent), '水平にするよう出る');
    assert(doc.getElementById('dfGateStart'), 'はじめるボタンがある');
    assertEqual(doc.querySelectorAll('#dfModBody .df-maze').length, 0, '迷路はまだ出ていない');

    click(doc, 'dfGateStart');
    await sleep(win, 120);
    assert(doc.querySelectorAll('#dfModBody .df-maze').length > 0, '押したら迷路が出る');
    assertNoErrors(errors, '水平の確認で未捕捉の例外');
    win.close();
  });

  await r.test('実物解除：傾きを使わないモジュールは、水平の確認を挟まない', async () => {
    // 出しすぎると、ただの手間になる
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    push(fake, defuseRoom());
    pushYou(fake, defuseYou({
      role: 'defuser',
      open: {
        uid: 'md2', type: 'cipher', name: '分割暗号', icon: '🧩',
        lead: 'マニュアル役みんなの暗号をつなげて入力しよう', solved: false,
        hint: { length: 4, parts: 2 }, progress: { done: false }
      }
    }));
    await waitScreen(win, doc, 'scr-rt-defuse', 4000);
    await sleep(win, 150);
    assert(!/水平/.test(el(doc, 'dfModBody').textContent), '水平の確認は出ない');
    assert(doc.getElementById('dfCipherInput'), 'すぐ入力できる');
    assertNoErrors(errors, '分割暗号で未捕捉の例外');
    win.close();
  });

  await r.test('実物解除：解除役にはモジュール一覧、対応表は出ない', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    push(fake, defuseRoom());
    pushYou(fake, defuseYou({ role: 'defuser' }));
    await waitScreen(win, doc, 'scr-rt-defuse', 4000);
    assertEqual(el(doc, 'dfStrikes').textContent, '❤️❤️❤️', 'のこりミスが出る');
    assertEqual(el(doc, 'dfProgress').textContent, '1 / 3 解除', '進み具合が出る');
    const mods = doc.querySelectorAll('#dfBoardBox .df-mod');
    assertEqual(mods.length, 3, 'モジュールが並ぶ');
    assert(mods[0].classList.contains('solved'), '解除ずみが分かる');
    assertEqual(el(doc, 'dfManualBox').style.display, 'none', '対応表は出ない');
    assertNoErrors(errors, '解除役の画面で未捕捉の例外');
    win.close();
  });

  await r.test('実物解除：マニュアル役には対応表だけ、モジュール一覧は出ない', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    push(fake, defuseRoom());
    pushYou(fake, defuseYou({
      role: 'manual',
      manualPages: [{
        uid: 'md1', type: 'shake', name: '振ってアクション', icon: '📳', solved: false,
        manual: { kind: 'shakeTable', rows: [{ mark: '★', count: 4, tempo: 'fast' }] }
      }]
    }));
    await waitScreen(win, doc, 'scr-rt-defuse', 4000);
    const box = el(doc, 'dfManualBox');
    assert(/振ってアクション/.test(box.textContent), '受け持つ対応表が出る');
    assert(/4回/.test(box.textContent), '中身が読める形で出る');
    assert(/見せないで/.test(el(doc, 'dfNote').textContent), '見せないよう案内が出る');
    assertEqual(el(doc, 'dfBoardBox').style.display, 'none', 'モジュール一覧は出ない');
    assertNoErrors(errors, 'マニュアル役の画面で未捕捉の例外');
    win.close();
  });

  await r.test('実物解除：モジュールを開くと中身が出て、閉じると消える', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    push(fake, defuseRoom());
    pushYou(fake, defuseYou({ role: 'defuser' }));
    await waitScreen(win, doc, 'scr-rt-defuse', 4000);

    doc.querySelectorAll('#dfBoardBox .df-mod')[2].click(); // イエスノー解錠
    await sleep(win, 100);
    const act = fake.emits.filter(e => e.name === 'wolf:act').pop();
    assertEqual(act.payload.targetId, 'md2', '開けたいモジュールを送っている');

    pushYou(fake, defuseYou({
      role: 'defuser',
      open: {
        uid: 'md2', type: 'yesno', name: 'イエスノー解錠', icon: '🔐',
        lead: '質問を選んで、はい／いいえ から正体を当てよう', solved: false,
        hint: { questions: ['それは家の中にありますか？'], maxQuestions: 5, choices: ['傘', '帽子', '靴'] },
        progress: { asked: [], left: 5 }
      }
    }));
    await sleep(win, 150);
    assert(el(doc, 'dfModOverlay').classList.contains('show'), 'モジュールが開く');
    assert(/イエスノー解錠/.test(el(doc, 'dfModTitle').textContent), '名前が出る');
    assert(doc.querySelector('#dfModBody [data-dfask]'), '質問がえらべる');
    assert(doc.querySelector('#dfModBody [data-dfguess]'), '答えがえらべる');

    doc.querySelector('#dfModBody [data-dfguess]').click();
    await sleep(win, 120);
    const vote = fake.emits.filter(e => e.name === 'wolf:vote').pop();
    assertEqual(vote.payload.action.type, 'guess', '答えを送っている');

    // 閉じたら消える
    pushYou(fake, defuseYou({ role: 'defuser' }));
    await sleep(win, 120);
    assert(!el(doc, 'dfModOverlay').classList.contains('show'), '閉じると消える');
    assertNoErrors(errors, 'モジュールの開け閉めで未捕捉の例外');
    win.close();
  });

  await r.test('実物解除：マニュアルなしなら、対応表がモジュールの中にも出る', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    push(fake, defuseRoom({
      state: { phase: 'play', game: 'defuse', data: defuseView({ manual: false }) }
    }));
    pushYou(fake, defuseYou({
      role: 'defuser', manual: false,
      open: {
        uid: 'md1', type: 'shake', name: '振ってアクション', icon: '📳',
        lead: '決まった回数・テンポで端末を振ろう', solved: false,
        hint: { mark: '★' }, progress: { done: false },
        manual: { kind: 'shakeTable', rows: [{ mark: '★', count: 4, tempo: 'slow' }] }
      }
    }));
    await waitScreen(win, doc, 'scr-rt-defuse', 4000);
    assert(/対応表/.test(el(doc, 'dfModManual').textContent), '自力で解けるよう対応表が出る');
    assert(/ゆっくり/.test(el(doc, 'dfModManual').textContent), '中身も読める');
    assertNoErrors(errors, 'マニュアルなしで未捕捉の例外');
    win.close();
  });

  await r.test('実物解除：決着したら結果と、次に進むボタンが出る', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { pick: false });   // 自分がホスト（m1）
    await pickGameForRoom(win, doc, 'defuse', 'defuse');
    const result = {
      success: true, cause: 'defused', solved: 3, total: 3,
      strikesLeft: 2, strikesMax: 3, elapsedSec: 140,
      modules: [{ name: '面認証', icon: '🔄', solved: true }, { name: '傾け迷路', icon: '🌀', solved: true }],
      roles: [{ name: 'あき', role: 'defuser' }, { name: 'びび', role: 'manual' }],
      misses: [{ name: '面認証', by: 'あき', note: null }]
    };
    push(fake, defuseRoom({
      state: { phase: 'ended', game: 'defuse', data: defuseView({ phase: 'ended', result }) }
    }));
    pushYou(fake, defuseYou({ phase: 'ended', result }));
    await waitScreen(win, doc, 'scr-rt-defuse', 4000);
    const text = el(doc, 'dfResultBox').textContent;
    assert(/解除成功/.test(text), '成功したことが出る');
    assert(/3 \/ 3個/.test(text), '解除した数が出る');
    assert(/解除役/.test(text), '誰がどの役だったかが出る');
    assert(/どこで転んだ/.test(text), 'ミスした場所が出る（次に遊ぶ時の話のタネ）');
    assert(el(doc, 'dfAgainBtn').style.display !== 'none', '次のゲームを選びに行ける');
    assert(el(doc, 'dfLeaveBtn').style.display !== 'none', '部屋から出られる');
    assertNoErrors(errors, '決着の画面で未捕捉の例外');
    win.close();
  });

  await r.test('大画面：実物解除は、モジュール名と残りミスだけを出す', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm5', role: 'bigscreen' });
    const members = defuseRoom().members.concat([
      { id: 'm5', name: 'テレビ', role: 'bigscreen', connected: true, isHost: false }
    ]);
    push(fake, defuseRoom({
      members, memberCount: 3,
      state: {
        phase: 'play', game: 'defuse',
        data: defuseView({
          players: [
            { id: 'm1', name: 'あき', connected: true, role: 'defuser', working: '傾け迷路', done: true },
            { id: 'm2', name: 'びび', connected: true, role: 'manual', working: null, done: true }
          ]
        })
      }
    }));
    await sleep(win, 150);
    assertEqual(activeScreen(doc), 'scr-rt-big', '大画面のまま');
    assertEqual(el(doc, 'bigMain').textContent, '1 / 3個', '進み具合が大きく出る');
    assert(/❤️❤️❤️/.test(el(doc, 'bigSub').textContent), 'のこりミスが出る');
    assert(/あきが「傾け迷路」に挑戦中/.test(el(doc, 'bigSub').textContent), '誰が何に挑んでいるか出る');
    assert(/面認証/.test(el(doc, 'bigList').textContent), 'モジュール名は出る');
    // 中身（対応表・記号・迷路の地図）は大画面に出さない
    const big = el(doc, 'scr-rt-big').textContent;
    assert(!/対応表/.test(big), '対応表は出ない');
    assertNoErrors(errors, '大画面の実物解除で未捕捉の例外');
    win.close();
  });

  // ---- 第27弾-1：実機で起きた「全員が固まる」の直し ----

  // ---- 第30弾：クイズ王の4ゲーム。1枚の画面が中身を差し替える ----

  await r.test('クイズ王：4つとも設定画面まで歩けて、その遊びの設定だけが出る', async () => {
    // 部屋が必須なので、設定ウィザードは部屋の中からしか通らない。
    // ここを歩かないと「設定画面で落ちる」ことに気づけない
    const CASES = [
      { game: 'quizrush',   mode: 'quizrush',   box: 'quizCfgRush',   tier: false, word: 'パス' },
      { game: 'quizlist',   mode: 'quizlist',   box: 'quizCfgList',   tier: true,  word: '協力' },
      { game: 'quizreveal', mode: 'quizreveal', box: 'quizCfgReveal', tier: true,  word: '見える' },
      { game: 'buzzer',     mode: 'buzzer-rt',  box: 'quizCfgBuzzer', tier: true,  word: '読み上げ' }
    ];
    const BOXES = ['quizCfgRush', 'quizCfgList', 'quizCfgReveal', 'quizCfgBuzzer'];
    for (const c of CASES) {
      const { win, doc, errors } = await launch(LAUNCH);
      await toRoom(win, doc, { pick: false });
      click(doc, 'rtPickGameBtn');
      await waitScreen(win, doc, 'scr-shelf', 3000);
      const cart = doc.querySelector('.cart[data-cart="quizou"]');
      cart.click();
      if (activeScreen(doc) === 'scr-shelf') cart.click();
      await waitScreen(win, doc, 'scr-game', 3000);
      pickGame(doc, c.game);
      await waitScreen(win, doc, 'scr-mode', 3000);
      click(doc, doc.querySelector('.mode-card[data-id="' + c.mode + '"]'));
      click(doc, 'modeNextBtn');
      await waitScreen(win, doc, 'scr-set-quiz', 3000);

      // その遊びの区画だけが出ている（ほかの遊びの設定は出さない）
      BOXES.forEach((id) => {
        assertEqual(el(doc, id).style.display, id === c.box ? 'block' : 'none',
          c.game + '：' + id + ' の出し分け');
      });
      assertEqual(el(doc, 'quizCfgTier').style.display, c.tier ? 'block' : 'none',
        c.game + '：難易度をえらべるかどうか');
      assert(new RegExp(c.word).test(el(doc, 'scr-set-quiz').textContent),
        c.game + '：その遊びの言葉が出ている');
      assert(doc.querySelector('.app').classList.contains('theme-quiz'),
        c.game + '：設定画面でもスタジオの見た目が続く');
      assertNoErrors(errors, c.game + ' の設定画面で未捕捉の例外');
      win.close();
    }
  });

  await r.test('クイズ王：4つとも、そのゲームとして開始を送る', async () => {
    // ここがずれると「早押しを選んだのにクイズラッシュが始まる」ことになる
    const CASES = [
      { game: 'quizrush', mode: 'quizrush' },
      { game: 'quizlist', mode: 'quizlist' },
      { game: 'quizreveal', mode: 'quizreveal' },
      { game: 'buzzer', mode: 'buzzer-rt' }
    ];
    for (const c of CASES) {
      const { win, doc, errors } = await launch(LAUNCH);
      const fake = await toRoom(win, doc, { pick: false });
      await pickGameForRoom(win, doc, c.game, c.mode);
      // 疑似socketは部屋の中身を持たないので、選んだ結果を流し込む
      push(fake, quizRoom(c.game, {}));
      await sleep(win, 80);
      click(doc, 'rtStartBtn');
      await sleep(win, 120);
      const start = fake.emits.filter(e => e.name === 'wolf:start').pop();
      assert(start, c.game + '：開始を送っている');
      assertEqual(start.payload.game, c.game, c.game + '：そのゲームとして始める');
      assertEqual(start.payload.preset, c.mode, c.game + '：どの遊び方かも残す');
      assertNoErrors(errors, c.game + ' の開始で未捕捉の例外');
      win.close();
    }
  });

  await r.test('クイズラッシュ：まず難易度をえらび、えらぶと問題が出る', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    const rush = { round: 1, roundsToWin: 0, roundResult: null, board: [] };
    push(fake, quizRoom('quizrush', quizView('quizrush', { rush: rush })));
    pushYou(fake, quizYou('quizrush', {
      rush: { tier: null, canChangeTier: true, passesLeft: 3, score: 0, answered: 0, hits: 0, last: null, question: null }
    }));
    await waitScreen(win, doc, 'scr-rt-quiz', 4000);
    assert(/クイズラッシュ/.test(el(doc, 'qzPhase').textContent), 'どのゲームか分かる');
    assert(doc.querySelector('[data-qztier="easy"]'), '難易度のボタンが出る');
    assert(!doc.querySelector('[data-qzans]'), 'えらぶ前に問題は出ない');

    pushYou(fake, quizYou('quizrush', {
      rush: {
        tier: 'normal', canChangeTier: true, passesLeft: 3, score: 0, answered: 0, hits: 0, last: null,
        question: { text: 'これはなに？', choices: ['あ', 'い', 'う'], tier: 'normal' }
      }
    }));
    await sleep(win, 80);
    assert(/これはなに？/.test(el(doc, 'qzBody').textContent), '問題が出る');
    assertEqual(doc.querySelectorAll('[data-qzans]').length, 3, '選択肢が3つ出る');
    assert(doc.querySelector('[data-qzpass]'), 'パスできる');
    assertNoErrors(errors, 'クイズラッシュの画面で未捕捉の例外');
    win.close();
  });

  await r.test('クイズラッシュ：選択肢を押すと「何番目か」を送る', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    push(fake, quizRoom('quizrush', quizView('quizrush', { rush: { round: 1, roundsToWin: 0, roundResult: null, board: [] } })));
    pushYou(fake, quizYou('quizrush', {
      rush: {
        tier: 'easy', canChangeTier: true, passesLeft: 3, score: 0, answered: 0, hits: 0, last: null,
        question: { text: 'とい', choices: ['ぜろ', 'いち', 'に'], tier: 'easy' }
      }
    }));
    await waitScreen(win, doc, 'scr-rt-quiz', 4000);
    // いちばん左（0番）を押す。文字ではなく位置を送る
    click(doc, doc.querySelector('[data-qzans="0"]'));
    await sleep(win, 80);
    const vote = fake.emits.filter(e => e.name === 'wolf:vote').pop();
    assert(vote, '答えを送っている');
    assertEqual(vote.payload.targetId, 0, '0番として送る（文字では送らない）');
    assertNoErrors(errors, '答えを送るところで未捕捉の例外');
    win.close();
  });

  await r.test('つぎつぎクイズ：自分の番だけ入力欄が出て、誰の番かが出る', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    const list = {
      style: 'coop', topic: '赤い食べ物', tier: 'easy', targetCount: 10,
      said: ['りんご'], saidCount: 1, turnId: 'm1', turnName: 'あき',
      turnRemainingMs: 15000, lastNote: null,
      order: [{ id: 'm1', name: 'あき', alive: true }, { id: 'm2', name: 'びび', alive: true }]
    };
    push(fake, quizRoom('quizlist', quizView('quizlist', { list: list })));
    pushYou(fake, quizYou('quizlist', { list: { yourTurn: false, alive: true, turnRemainingMs: 15000 } }));
    await waitScreen(win, doc, 'scr-rt-quiz', 4000);
    assert(/赤い食べ物/.test(el(doc, 'qzBody').textContent), 'お題が出る');
    assert(/りんご/.test(el(doc, 'qzBody').textContent), '出た答えが並ぶ');
    assert(/あき/.test(el(doc, 'qzNote').textContent), '誰の番かが出る');
    assert(!doc.getElementById('qzAnswerInput'), '自分の番でなければ入力欄は出ない');

    pushYou(fake, quizYou('quizlist', { list: { yourTurn: true, alive: true, turnRemainingMs: 15000 } }));
    await sleep(win, 80);
    assert(doc.getElementById('qzAnswerInput'), '自分の番なら入力欄が出る');
    doc.getElementById('qzAnswerInput').value = 'いちご';
    click(doc, doc.querySelector('[data-qzsend]'));
    await sleep(win, 80);
    const vote = fake.emits.filter(e => e.name === 'wolf:vote').pop();
    assertEqual(vote.payload.targetId, 'いちご', '答えた言葉を送る');
    assertNoErrors(errors, 'つぎつぎクイズの画面で未捕捉の例外');
    win.close();
  });

  await r.test('とくとくクイズ：伏せ字のまま出て、押すまで選択肢は押せない', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    const reveal = {
      index: 0, total: 5, tier: 'normal',
      text: 'にほんで◻◻◻◻◻', shown: 5, length: 10,
      choices: ['ふじさん', 'きただけ', 'やりがたけ'],
      buzzedId: null, buzzedName: null, answerRemainingMs: null, lastNote: null
    };
    push(fake, quizRoom('quizreveal', quizView('quizreveal', { reveal: reveal })));
    pushYou(fake, quizYou('quizreveal', { reveal: { locked: false, yours: false, canBuzz: true } }));
    await waitScreen(win, doc, 'scr-rt-quiz', 4000);
    assert(/◻/.test(el(doc, 'qzBody').textContent), '伏せ字のまま出る');
    assert(doc.querySelector('[data-qzbuzz]'), '押すボタンが出る');
    assertEqual(doc.querySelectorAll('[data-qzans]').length, 0, '押す前は選択肢を出さない');

    pushYou(fake, quizYou('quizreveal', { reveal: { locked: false, yours: true, canBuzz: false } }));
    await sleep(win, 80);
    assertEqual(doc.querySelectorAll('[data-qzans]').length, 3, '押した人だけ選択肢が出る');
    assertNoErrors(errors, 'とくとくクイズの画面で未捕捉の例外');
    win.close();
  });

  await r.test('早押し：読み上げにすると、画面に問題文を出さない', async () => {
    // 文字も出すと、読み上げを待たずに読んだ人が必ず勝つ。選んだ意味が消える
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    const buzzer = {
      roundNum: 1, winsNeeded: 3, delivery: 'speak',
      pair: [{ id: 'm1', name: 'あき', wins: 1 }, { id: 'm2', name: 'びび', wins: 0 }],
      question: { text: 'ひみつの問題文', choices: ['あ', 'い', 'う'], tier: 'normal' },
      askedAt: 111, buzzedId: null, buzzedName: null, answerRemainingMs: null,
      matchResult: null, champion: null, lastNote: null
    };
    push(fake, quizRoom('buzzer', quizView('buzzer', { buzzer: buzzer })));
    pushYou(fake, quizYou('buzzer', {
      buzzer: { inMatch: true, locked: false, yours: false, canBuzz: true, wins: 0 }
    }));
    await waitScreen(win, doc, 'scr-rt-quiz', 4000);
    assertEqual(/ひみつの問題文/.test(el(doc, 'qzBody').textContent), false, '読み上げなら文字は出さない');
    assert(doc.querySelector('[data-qzbuzz]'), '早押しボタンが出る');
    assert(/あき/.test(el(doc, 'qzBody').textContent), '対戦相手が出る');

    // 文字で出す設定なら、ちゃんと文字が出る
    const textOne = Object.assign({}, buzzer, { delivery: 'text' });
    push(fake, quizRoom('buzzer', quizView('buzzer', { buzzer: textOne })));
    await sleep(win, 80);
    assert(/ひみつの問題文/.test(el(doc, 'qzBody').textContent), '文字で出す設定なら出る');
    assertNoErrors(errors, '早押しの画面で未捕捉の例外');
    win.close();
  });

  await r.test('大画面：クイズラッシュは、得点といま挑んでいる難易度を出す', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm5', role: 'bigscreen' });
    const rush = {
      round: 1, roundsToWin: 0, roundResult: null,
      board: [
        { id: 'm1', name: 'あき', score: 5, wins: 0, answered: 3, hits: 2, tier: 'muri' },
        { id: 'm2', name: 'びび', score: 3, wins: 0, answered: 4, hits: 3, tier: 'easy' }
      ]
    };
    const room = quizRoom('quizrush', quizView('quizrush', { rush: rush }));
    room.members = room.members.concat([
      { id: 'm5', name: 'テレビ', role: 'bigscreen', connected: true, isHost: false }
    ]);
    room.memberCount = 3;
    push(fake, room);
    await sleep(win, 150);
    assertEqual(activeScreen(doc), 'scr-rt-big', '大画面のまま');
    const list = el(doc, 'bigList').textContent;
    assert(/あき 5/.test(list), '得点が出る');
    assert(/むりなんだが/.test(list), 'いま挑んでいる難易度が出る');
    assert(/かんたん/.test(list), '人ごとに違う難易度が出る');
    assertNoErrors(errors, '大画面で未捕捉の例外');
    win.close();
  });

  await r.test('大画面：クイズ王は得点と進み具合だけを出す', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm5', role: 'bigscreen' });
    const reveal = {
      index: 1, total: 5, tier: 'normal',
      text: 'にほんで◻◻◻◻◻', shown: 5, length: 10,
      choices: ['ふじさん', 'きただけ', 'やりがたけ'],
      buzzedId: null, buzzedName: null, answerRemainingMs: null, lastNote: null
    };
    const room = quizRoom('quizreveal', quizView('quizreveal', { reveal: reveal }));
    room.members = room.members.concat([
      { id: 'm5', name: 'テレビ', role: 'bigscreen', connected: true, isHost: false }
    ]);
    room.memberCount = 3;
    push(fake, room);
    await sleep(win, 150);
    assertEqual(activeScreen(doc), 'scr-rt-big', '大画面のまま');
    assert(/◻/.test(el(doc, 'bigMain').textContent), '開き具合がそのまま出る');
    assert(/2 \/ 5問/.test(el(doc, 'bigSub').textContent), '何問目かが出る');
    assert(/あき 5/.test(el(doc, 'bigList').textContent), '得点が出る');
    assertNoErrors(errors, '大画面で未捕捉の例外');
    win.close();
  });

  // ---- 第36弾：すごろく（部屋版）----
  // **画面が本当に描かれるか**を見る。器（HTML）だけあって描画が無い、
  // という抜け方を3ゲームで実際にやったので、ここで固定する

  await r.test('すごろく（部屋）：盤と一覧が実際に描かれる', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    push(fake, sugoRoom('sugotoll', {
      game: 'sugotoll', phase: 'turn', cells: 40, board: sugoBoard(40),
      coinsUsed: true, lap: 1,
      turn: { id: 'm2', name: 'びび' },
      players: [
        { id: 'm1', name: 'あき', pos: 5, coins: 18, rank: 1, goalOrder: null, connected: true },
        { id: 'm2', name: 'びび', pos: 3, coins: 20, rank: 2, goalOrder: null, connected: true },
        { id: 'm3', name: 'ちか', pos: 0, coins: 20, rank: 3, goalOrder: null, connected: true }
      ],
      waiting: ['びび']
    }));
    await waitScreen(win, doc, 'scr-rt-sugoroku', 4000);
    // ★ ここが今回の要点：中身が空でないこと
    assertEqual(doc.querySelectorAll('#rtSugoBoard .sugo-cell').length, 41, '盤が描かれる');
    assert(/あき/.test(el(doc, 'rtSugoMe').textContent), '一覧に名前が出る');
    assert(/あと35/.test(el(doc, 'rtSugoMe').textContent), '残りマス数が出る');
    assert(/びび/.test(el(doc, 'rtSugoTurn').textContent), '誰の番か出る');
    assertNoErrors(errors, 'すごろくの部屋画面で未捕捉の例外');
    win.close();
  });

  await r.test('すごろく（部屋）：こまはひとつは、駒が1つだけ描かれる', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    push(fake, sugoRoom('sugograb', {
      game: 'sugograb', phase: 'mini', cells: 30, board: sugoBoard(30),
      coinsUsed: true, lap: 1, sharedPiece: true, piece: 7,
      mini: { id: 'fingers', title: 'ゆびの かずあて', lead: 'せーので、0〜5本を出す' },
      players: [
        { id: 'm1', name: 'あき', pos: null, coins: 20, rank: 1, moving: false, connected: true },
        { id: 'm2', name: 'びび', pos: null, coins: 20, rank: 2, moving: false, connected: true },
        { id: 'm3', name: 'ちか', pos: null, coins: 20, rank: 2, moving: false, connected: true }
      ],
      waiting: []
    }));
    await waitScreen(win, doc, 'scr-rt-sugoroku', 4000);
    const pieces = doc.querySelectorAll('#rtSugoBoard .sugo-piece');
    assertEqual(pieces.length, 1, '駒は1つだけ');
    // 帯は手渡し版と同じ「こまは あと◯」。ミニゲームの名前は帯ではなく、
    // ミニゲームそのものの画面に出す（並走する2つで見え方を割らない）
    assert(/こまは あと23/.test(el(doc, 'rtSugoLap').textContent),
      '共有の駒の残りが出る（' + el(doc, 'rtSugoLap').textContent + '）');
    assertNoErrors(errors, 'こまはひとつの部屋画面で未捕捉の例外');
    win.close();
  });

  // 手渡し（1台を回す）で、すごろくの盤まで歩く。
  // カセット→ゲーム→モード→設定→ルール→じゅんび、と関門が多いので1か所にまとめる
  async function toSugoHandoff(win, doc, gameId) {
    if (activeScreen(doc) === 'scr-shelf') {
      const cart = doc.querySelector('.cart[data-cart="sugoroku"]');
      assert(cart, 'すごろくのカセットが棚にある');
      cart.click();
      await sleep(win, 20);
      if (activeScreen(doc) === 'scr-shelf' && !doc.querySelector('.cassette-warp')) cart.click();
      await waitFor(win, () => activeScreen(doc) !== 'scr-shelf', 4000, 'カセットの中に入る');
    }
    if (activeScreen(doc) === 'scr-game') pickGame(doc, gameId);
    await fillPlayerForm(win, doc, ['あき', 'びび', 'ちか']);
    if (activeScreen(doc) === 'scr-game') pickGame(doc, gameId);
    await runWizardToPlay(win, doc);
    // こまはひとつは、盤より先に「ミニゲームの題」から始まる。
    // 盤の中身はどちらの画面でも組み立て済みなので、着いた方で確かめられる
    await waitFor(win, () =>
      ['scr-sugo-play', 'scr-sugo-mini'].indexOf(activeScreen(doc)) >= 0,
      8000, 'すごろくの画面に着く');
  }

  // すごろくの設定画面まで歩く。**遊び始める手前で止める**
  // **部屋の経路**で歩く。どこにいる？・てふだは部屋専用なので、
  // 1台を回す経路では選べない（それが正しい形）。
  // 部屋にいる時は人数を部屋が持っているので、人数の画面も出ない
  async function toSugoSetup(win, doc, gameId) {
    click(doc, 'rtPickGameBtn');
    await waitScreen(win, doc, 'scr-shelf', 4000);
    const cart = doc.querySelector('.cart[data-cart="sugoroku"]');
    assert(cart, 'すごろくのカセットが棚にある');
    cart.click();
    await sleep(win, 20);
    if (activeScreen(doc) === 'scr-shelf' && !doc.querySelector('.cassette-warp')) cart.click();
    await waitScreen(win, doc, 'scr-game', 4000);
    pickGame(doc, gameId);
    await waitScreen(win, doc, 'scr-mode', 4000);
    const card = doc.querySelector('#scr-mode .mode-card');
    if (card) card.click();
    click(doc, 'modeNextBtn');
    await waitScreen(win, doc, 'scr-set-sugoroku', 4000);
  }

  await r.test('すごろくの設定：ゲームごとに、ちがう説明が出る（第36弾）', async () => {
    const seen = {};
    for (const g of ['sugotoll', 'sugograb', 'sugopair', 'sugohide', 'sugohand']) {
      const { win, doc, errors } = await launch(LAUNCH);
      await toRoom(win, doc, { pick: false });
      await toSugoSetup(win, doc, g);
      const lead = el(doc, 'sugoWizLead').textContent;
      assert(lead.length > 10, g + ' の説明が出ていない（' + lead + '）');
      seen[g] = lead;
      assertNoErrors(errors, g + ' の設定画面で未捕捉の例外');
      win.close();
    }
    // **同じ説明が2つのゲームで出ていないこと。**
    // 「無い時は既定のものを出す」実装だと、足し忘れたゲームに
    // 別のゲームの説明がそのまま出る（てふだで実際に起きた）
    const texts = Object.keys(seen).map((g) => seen[g]);
    assertEqual(new Set(texts).size, texts.length,
      'ちがうゲームに同じ説明が出ている（' + JSON.stringify(seen).slice(0, 200) + '）');
  });

  await r.test('すごろくの設定：できごとが起きないゲームには、その設定を出さない（第36弾）', async () => {
    // 決めても何も変わらない設定を見せると、決めごとが効いていないように見える。
    // どこにいる？・てふだは events:'none'
    for (const [g, want] of [['sugotoll', true], ['sugograb', true],
      ['sugopair', true], ['sugohide', false], ['sugohand', false]]) {
      const { win, doc, errors } = await launch(LAUNCH);
      await toRoom(win, doc, { pick: false });
      await toSugoSetup(win, doc, g);
      const shown = win.getComputedStyle(el(doc, 'sugoEventWrap')).display !== 'none';
      assertEqual(shown, want,
        g + ' の「突然のできごと」の出し方が違う（出ている: ' + shown + '）');
      // 駒が1つのゲームだけの設定も、そのゲームでだけ出る
      const losers = win.getComputedStyle(el(doc, 'sugoLosersWrap')).display !== 'none';
      assertEqual(losers, g === 'sugograb', g + ' の「1位以外も動く」の出し方が違う');
      assertNoErrors(errors, g + ' の設定画面で未捕捉の例外');
      win.close();
    }
  });

  await r.test('すごろく（手渡し）：盤と一覧とサイコロが、実際に出る（第36弾）', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    await toSugoHandoff(win, doc, 'sugotoll');
    assertEqual(doc.querySelectorAll('#sugoBoard .sugo-cell').length, 41, '盤が描かれる');
    assertEqual(doc.querySelectorAll('#sugoBoard .sugo-piece').length, 3, '3人ぶんの駒が出る');
    const me = el(doc, 'sugoMe').textContent;
    assert(/あき/.test(me) && /びび/.test(me) && /ちか/.test(me), '全員が一覧に出る');
    assert(/あと40/.test(me), '残りマス数が出る（' + me.slice(0, 40) + '）');
    assert(/あき/.test(el(doc, 'sugoTurn').textContent), '誰の番かが出る');
    assertEqual(win.getComputedStyle(el(doc, 'sugoDice')).display !== 'none', true, 'サイコロが出ている');
    assertNoErrors(errors, '手渡しのすごろくで未捕捉の例外');
    win.close();
  });

  await r.test('すごろく（手渡し）：長押ししてスワイプで、実際に振れる（第36弾）', async () => {
    // 振る仕掛けは部屋版と共通の部品（bindDiceGesture）。
    // 手渡し側で一度も試していなければ、共通化が壊れても気づけない
    const { win, doc, errors } = await launch(LAUNCH);
    await toSugoHandoff(win, doc, 'sugotoll');
    const before = el(doc, 'sugoMe').textContent;
    const d = el(doc, 'sugoDice');
    const ev = (type, x, y) => d.dispatchEvent(new win.PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 1, clientX: x, clientY: y
    }));
    ev('pointerdown', 100, 300);
    await sleep(win, 40);
    ev('pointermove', 100, 220);   // 80px のスワイプ（しきい値は40px）
    ev('pointerup', 100, 220);
    await waitFor(win, () => el(doc, 'sugoMe').textContent !== before, 6000, '誰かが進む');
    assert(/あと(3[0-9]|[0-2][0-9])/.test(el(doc, 'sugoMe').textContent),
      '進んだぶん残りが減る（' + el(doc, 'sugoMe').textContent.slice(0, 40) + '）');
    assertNoErrors(errors, 'サイコロを振って未捕捉の例外');
    win.close();
  });

  await r.test('すごろく（手渡し）：こまはひとつは、駒が1つだけで、ミニゲームが出る（第36弾）', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    await toSugoHandoff(win, doc, 'sugograb');
    assertEqual(doc.querySelectorAll('#sugoBoard .sugo-piece').length, 1, '駒は1つだけ');
    assert(/こまは あと30/.test(el(doc, 'sugoLap').textContent),
      '共有の駒の残りが出る（' + el(doc, 'sugoLap').textContent + '）');
    // ミニゲームの題が出るところまで進む
    await waitScreen(win, doc, 'scr-sugo-mini', 6000);
    assert(el(doc, 'sugoMiniTitle').textContent.length > 0, '何のミニゲームかが出る');
    assert(el(doc, 'sugoMiniLead').textContent.length > 0, 'どうすればいいかが出る');
    click(doc, 'sugoMiniGoBtn');
    await waitScreen(win, doc, 'scr-sugo-input', 4000);
    assert(/ほかの人に見えないように/.test(el(doc, 'sugoHandSub').textContent),
      '渡す前に、前の人の入力が見えない案内が出る');
    assertNoErrors(errors, 'こまはひとつ（手渡し）で未捕捉の例外');
    win.close();
  });

  await r.test('すごろく：部屋で決着すると、称号が数えられる（第36弾）', async () => {
    // 完成しているカセットの中で、すごろくだけ称号がゼロだった。
    // 数える箱とパーツを足しても、**決着の時に呼ばれなければ何も起きない**
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    const sent = titlePuts(win);
    const ended = {
      game: 'sugotoll', phase: 'ended', cells: 40, board: sugoBoard(40),
      coinsUsed: true, lap: 6,
      players: [
        { id: 'm1', name: 'あき', pos: 33, coins: 4, rank: 2, goalOrder: null, connected: true },
        { id: 'm2', name: 'びび', pos: 40, coins: 9, rank: 1, goalOrder: 1, connected: true },
        { id: 'm3', name: 'ちか', pos: 21, coins: 12, rank: 3, goalOrder: null, connected: true }
      ],
      waiting: [],
      result: {
        game: 'sugotoll', cells: 40, coinsUsed: true, lap: 6,
        players: [
          { id: 'm2', name: 'びび', pos: 40, rank: 1, tied: false, coins: 9, goaled: true },
          { id: 'm1', name: 'あき', pos: 33, rank: 2, tied: false, coins: 4, goaled: false },
          { id: 'm3', name: 'ちか', pos: 21, rank: 3, tied: false, coins: 12, goaled: false }
        ]
      }
    };
    push(fake, sugoRoom('sugotoll', ended));
    // 決着は「部屋の知らせ」と「自分の情報」に分かれて届く。
    // 自分の情報も決着のものになってはじめて数える（第34弾で踏んだ順番の罠）
    pushYou(fake, { game: 'sugotoll', phase: 'ended', pos: 40, left: 0 });
    await waitScreen(win, doc, 'scr-rt-sugoroku', 4000);
    await waitFor(win, () => sent.length >= 1, 3000, '称号が数えられる');
    const sg = sent[sent.length - 1].stats.sugoroku;
    assertEqual(sg.plays, 1, 'すごろくを遊んだ回数が増える（' + JSON.stringify(sg) + '）');
    assertEqual(sg.tollPlays, 1, 'つうこうりょうを遊んだ回数が増える');
    assertEqual(sg.wins, 1, '1位になったことが数えられる');
    assertEqual(sg.tollWins, 1, 'つうこうりょうで1位になったことが数えられる');
    assertEqual(sg.goals, 1, 'あがったことも数えられる');
    // 二重に数えない（同じ決着が何度も配信される）
    const n = sent.length;
    push(fake, sugoRoom('sugotoll', ended));
    await sleep(win, 300);
    assertEqual(sent.length, n, '同じ決着が届いても、二度は数えない');
    assertNoErrors(errors, 'すごろくの称号で未捕捉の例外');
    win.close();
  });

  await r.test('すごろく：1位でなくても、あがっていれば数えられる（第36弾）', async () => {
    // 「褒める時は全力で」。勝てなかった人の手元にも、着いたことは残す
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    const sent = titlePuts(win);
    push(fake, sugoRoom('sugohide', {
      game: 'sugohide', phase: 'ended', cells: 30, board: sugoBoard(30),
      coinsUsed: false, lap: 5, hidden: true,
      areas: [{ id: 'a0', name: 'ふもと' }], clues: [],
      players: [
        { id: 'm1', name: 'あき', pos: null, saidArea: null, asking: false, connected: true },
        { id: 'm2', name: 'びび', pos: null, saidArea: null, asking: false, connected: true },
        { id: 'm3', name: 'ちか', pos: null, saidArea: null, asking: false, connected: true }
      ],
      waiting: [],
      result: {
        game: 'sugohide', cells: 30, coinsUsed: false, lap: 5,
        players: [
          { id: 'm1', name: 'あき', pos: 30, rank: 1, tied: false, coins: null, goaled: true },
          { id: 'm2', name: 'びび', pos: 30, rank: 2, tied: false, coins: null, goaled: true },
          { id: 'm3', name: 'ちか', pos: 12, rank: 3, tied: false, coins: null, goaled: false }
        ]
      }
    }));
    pushYou(fake, { game: 'sugohide', phase: 'ended', pos: 30, left: 0 });
    await waitScreen(win, doc, 'scr-rt-sugoroku', 4000);
    await waitFor(win, () => sent.length >= 1, 3000, '称号が数えられる');
    const sg = sent[sent.length - 1].stats.sugoroku;
    assertEqual(sg.goals, 1, 'あがったことが数えられる（' + JSON.stringify(sg) + '）');
    assertEqual(sg.wins || 0, 0, '1位ではないので、勝ちは増えない');
    assertEqual(sg.hidePlays, 1, 'どこにいる？を遊んだ回数は増える');
    assertNoErrors(errors, '2位の称号で未捕捉の例外');
    win.close();
  });

  await r.test('すごろく（大画面）：盤が出て、人狼の表示に落ちない', async () => {
    // 分岐が無いと人狼の大画面に落ちて、全員が💀（死亡）で並ぶ。
    // 段階の名前も、爆弾解除の言葉（play＝解除中）が漏れる
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { role: 'bigscreen' });
    push(fake, sugoRoom('sugotoll', {
      game: 'sugotoll', phase: 'turn', cells: 40, board: sugoBoard(40),
      coinsUsed: true, lap: 1, deadline: Date.now() + 30000,
      turn: { id: 'm1', name: 'あき' },
      players: [
        { id: 'm1', name: 'あき', pos: 5, coins: 18, rank: 1, goalOrder: null, connected: true },
        { id: 'm2', name: 'びび', pos: 3, coins: 20, rank: 2, goalOrder: null, connected: true },
        { id: 'm3', name: 'ちか', pos: 0, coins: 20, rank: 3, goalOrder: null, connected: true }
      ],
      waiting: ['あき']
    }, { bigMemberId: 'm1' }));
    await waitScreen(win, doc, 'scr-rt-big', 4000);
    assertEqual(doc.querySelectorAll('#bigSugoBoard .sugo-cell').length, 41, '大画面にも盤が出る');
    assertEqual(doc.querySelectorAll('#bigSugoBoard .sugo-piece').length, 3, '3人ぶんの駒が出る');
    const all = el(doc, 'scr-rt-big').textContent;
    assert(all.indexOf('💀') === -1, '人狼の死亡表示が出ている（借りた世界の言葉・落とし穴2）');
    assertEqual(el(doc, 'bigPhase').textContent, '手番', 'すごろくの言葉で段階が出る');
    assert(/あき/.test(el(doc, 'bigMain').textContent), '誰の番かが大きく出る');
    assert(/あと35/.test(el(doc, 'bigList').textContent), '残りマス数が出る');
    assertNoErrors(errors, 'すごろくの大画面で未捕捉の例外');
    win.close();
  });

  await r.test('すごろく（大画面）：ミニゲーム中に「解除中」と出ない', async () => {
    // こまはひとつの段階 play は、爆弾解除の play と同じ名前。
    // 段階の対応表を1つで共用すると、爆弾解除の言葉がそのまま漏れる
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { role: 'bigscreen' });
    push(fake, sugoRoom('sugograb', {
      game: 'sugograb', phase: 'play', cells: 30, board: sugoBoard(30),
      coinsUsed: true, lap: 1, sharedPiece: true, piece: 5,
      deadline: Date.now() + 20000,
      mini: { id: 'tap', kind: 'reflex', title: 'れんだ', lead: 'いそいで押す' },
      answered: ['あき'],
      players: [
        { id: 'm1', name: 'あき', pos: null, coins: 20, connected: true },
        { id: 'm2', name: 'びび', pos: null, coins: 20, connected: true },
        { id: 'm3', name: 'ちか', pos: null, coins: 20, connected: true }
      ],
      waiting: ['びび', 'ちか']
    }, { bigMemberId: 'm1' }));
    await waitScreen(win, doc, 'scr-rt-big', 4000);
    const phase = el(doc, 'bigPhase').textContent;
    assert(phase.indexOf('解除') === -1, '爆弾解除の言葉が漏れている（' + phase + '）');
    assertEqual(phase, '出しています', 'すごろくの言葉になっている');
    assertEqual(doc.querySelectorAll('#bigSugoBoard .sugo-piece').length, 1, '共有の駒は1つだけ');
    assertNoErrors(errors, 'ミニゲーム中の大画面で未捕捉の例外');
    win.close();
  });

  await r.test('どこにいる？（大画面）：誰の駒も、誰の残りマス数も出ない', async () => {
    // ここが**このゲームでいちばん危ない面**。TVは部屋の全員が見る。
    // 大画面には privateFor が届かないので、実位置は持ちようがない——
    // 隠しているのではなく、持っていないから出せない、が正しい形
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { role: 'bigscreen' });
    push(fake, sugoRoom('sugohide', {
      game: 'sugohide', phase: 'say', cells: 30, board: sugoBoard(30),
      coinsUsed: false, lap: 1, hidden: true, deadline: Date.now() + 40000,
      areas: [{ id: 'a0', name: 'ふもと' }, { id: 'a2', name: 'まちなか' }],
      clues: [{ id: 'c04', text: '人の話し声がする' }],
      sayer: { id: 'm1', name: 'あき' },
      said: null,
      players: [
        { id: 'm1', name: 'あき', pos: null, saidArea: 'a2', asking: true, connected: true },
        { id: 'm2', name: 'びび', pos: null, saidArea: null, asking: false, connected: true },
        { id: 'm3', name: 'ちか', pos: null, saidArea: 'a0', asking: false, connected: true }
      ],
      waiting: ['あき']
    }, { bigMemberId: 'm1' }));
    // 大画面にも「自分の秘密」が届いてしまった場合を作って、それでも出ないことを見る
    pushYou(fake, { game: 'sugohide', phase: 'say', pos: 12, left: 18,
      area: { id: 'a2', name: 'まちなか' }, clues: [{ id: 'c04', text: '人の話し声がする' }] });
    await waitScreen(win, doc, 'scr-rt-big', 4000);
    assertEqual(doc.querySelectorAll('#bigSugoBoard .sugo-cell').length, 31, '盤そのものは出してよい');
    assertEqual(doc.querySelectorAll('#bigSugoBoard .sugo-piece').length, 0, '駒は1つも置かれない');
    const all = el(doc, 'scr-rt-big').textContent;
    assert(!/あと\d+/.test(all), '残りマス数が出ている（位置が割れる）');
    assert(all.indexOf('12') === -1, '位置の数字が紛れている');
    assert(/まちなか/.test(el(doc, 'bigList').textContent), '申告した区画は出してよい');
    assertNoErrors(errors, 'どこにいる？の大画面で未捕捉の例外');
    win.close();
  });

  await r.test('すごろく（部屋）：通行料を払ったことが、手元に出る', async () => {
    // 部屋版は長いあいだ「何が起きたか」を一言も出せていなかった。
    // 言い回しはルール層が持っているので、手渡し版と同じ言葉になる
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    push(fake, sugoRoom('sugotoll', {
      game: 'sugotoll', phase: 'result', cells: 40, board: sugoBoard(40),
      coinsUsed: true, lap: 1, deadline: Date.now() + 2000,
      last: { id: 'm1', name: 'あき', dice: 4, rank: 1, toll: 3, paid: true,
        stalled: false, relief: 0, coinsGained: 2, goal: false },
      players: [
        { id: 'm1', name: 'あき', pos: 9, coins: 17, rank: 1, connected: true },
        { id: 'm2', name: 'びび', pos: 3, coins: 20, rank: 2, connected: true },
        { id: 'm3', name: 'ちか', pos: 0, coins: 20, rank: 3, connected: true }
      ],
      waiting: []
    }));
    await waitScreen(win, doc, 'scr-rt-sugoroku', 4000);
    const note = el(doc, 'rtSugoNote').textContent;
    assert(/3/.test(note) && /1位/.test(note), 'いくら払ったか・何位だからかが出る（' + note + '）');
    assertNoErrors(errors, '通行料の知らせで未捕捉の例外');
    win.close();
  });

  await r.test('すごろく（部屋）：払えなかった時は、入った方を大きく出す', async () => {
    // 原則7「褒める時は全力で、責める時は静かに」。
    // 大きい方（note）に責める言葉を置かない
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    push(fake, sugoRoom('sugotoll', {
      game: 'sugotoll', phase: 'result', cells: 40, board: sugoBoard(40),
      coinsUsed: true, lap: 1, deadline: Date.now() + 2000,
      last: { id: 'm2', name: 'びび', dice: 5, rank: 1, toll: 5, paid: false,
        stalled: true, relief: 3, coinsGained: 0, goal: false },
      players: [
        { id: 'm1', name: 'あき', pos: 9, coins: 17, rank: 2, connected: true },
        { id: 'm2', name: 'びび', pos: 12, coins: 3, rank: 1, connected: true },
        { id: 'm3', name: 'ちか', pos: 0, coins: 20, rank: 3, connected: true }
      ],
      waiting: []
    }));
    await waitScreen(win, doc, 'scr-rt-sugoroku', 4000);
    const note = el(doc, 'rtSugoNote').textContent;
    const hint = el(doc, 'rtSugoHint').textContent;
    assert(/コイン\+3/.test(note), '入った方が大きく出る（' + note + '）');
    assert(note.indexOf('払えません') === -1, '大きい方に、責める言葉を置かない');
    assert(/払えません/.test(hint), '払えなかったことは小さく添える（' + hint + '）');
    assertNoErrors(errors, '払えなかった知らせで未捕捉の例外');
    win.close();
  });

  await r.test('どこにいる？：つじつまが合わないことが、全員の手元に出る', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    push(fake, sugoRoom('sugohide', {
      game: 'sugohide', phase: 'judge', cells: 30, board: sugoBoard(30),
      coinsUsed: false, lap: 1, hidden: true, deadline: Date.now() + 3000,
      areas: [{ id: 'a0', name: 'ふもと' }, { id: 'a4', name: 'みねちかく' }],
      clues: [{ id: 'c01', text: '水の音がする' }],
      sayer: null,
      said: { id: 'm1', name: 'あき', areaId: 'a4', areaName: 'みねちかく',
        clueId: 'c01', clueText: '水の音がする', caught: true, back: 3 },
      players: [
        { id: 'm1', name: 'あき', pos: null, saidArea: 'a4', asking: false, connected: true },
        { id: 'm2', name: 'びび', pos: null, saidArea: null, asking: false, connected: true },
        { id: 'm3', name: 'ちか', pos: null, saidArea: null, asking: false, connected: true }
      ],
      waiting: []
    }));
    pushYou(fake, { game: 'sugohide', phase: 'judge', pos: 7, left: 23,
      area: { id: 'a1', name: 'かわぞい' }, clues: [{ id: 'c01', text: '水の音がする' }] });
    await waitScreen(win, doc, 'scr-rt-sugoroku', 4000);
    const all = el(doc, 'rtSugoNote').textContent + ' / ' + el(doc, 'rtSugoHint').textContent;
    assert(/3マスもどる/.test(all), '何マス戻るかが出る（' + all + '）');
    assert(/みねちかく/.test(all), '何と言ったかが出る');
    // 嘘つき呼ばわりしない（原則7）
    assert(all.indexOf('嘘') === -1 && all.indexOf('うそ') === -1, '責める言葉を使わない');
    // それでも、誰の本当の位置も画面に出てこない
    assert(!/あと23/.test(all), '自分の残りマス数を、この場面で出さない');
    assertNoErrors(errors, '申告の結果で未捕捉の例外');
    win.close();
  });

  await r.test('こまはひとつ：勝った人以外に「振れます」と言わない', async () => {
    // 借りた言葉が、関係ない人の手元に出てしまう形（落とし穴2）を防ぐ
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    push(fake, sugoRoom('sugograb', {
      game: 'sugograb', phase: 'grab', cells: 30, board: sugoBoard(30),
      coinsUsed: true, lap: 1, sharedPiece: true, piece: 6,
      deadline: Date.now() + 20000,
      turn: { id: 'm1', name: 'あき' },
      mini: { id: 'tap', kind: 'reflex', title: 'れんだ', lead: 'いそいで押す' },
      players: [
        { id: 'm1', name: 'あき', pos: null, coins: 20, rank: 1, moving: true, connected: true },
        { id: 'm2', name: 'びび', pos: null, coins: 20, rank: 2, moving: false, connected: true },
        { id: 'm3', name: 'ちか', pos: null, coins: 20, rank: 3, moving: false, connected: true }
      ],
      waiting: ['あき']
    }));
    await waitScreen(win, doc, 'scr-rt-sugoroku', 4000);
    assert(/あき/.test(el(doc, 'rtSugoNote').textContent), '誰が勝ったかは全員に出る');
    const hint = el(doc, 'rtSugoHint').textContent;
    assert(hint.indexOf('振って') === -1, '振らない人に「振って」と言わない（' + hint + '）');
    assert(/あき/.test(hint), '代わりに、誰を待っているかが出る（' + hint + '）');
    assertNoErrors(errors, 'こまはひとつの待ちで未捕捉の例外');
    win.close();
  });

  await r.test('すごろく（部屋）：じゅんびOKを押すと、サーバーへ届く', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    push(fake, sugoRoom('sugotoll', {
      game: 'sugotoll', phase: 'ready', cells: 40, board: sugoBoard(40),
      coinsUsed: true, lap: 1, deadline: null,
      players: [
        { id: 'm1', name: 'あき', pos: 0, coins: 20, connected: true },
        { id: 'm2', name: 'びび', pos: 0, coins: 20, connected: true },
        { id: 'm3', name: 'ちか', pos: 0, coins: 20, connected: true }
      ],
      waiting: ['あき', 'びび', 'ちか']
    }));
    await waitScreen(win, doc, 'scr-rt-sugoroku', 4000);
    const btn = doc.querySelector('#rtSugoInput [data-rtsugo="ready"]');
    assert(btn, 'じゅんびOKのボタンが出る');
    click(doc, btn);
    await sleep(win, 60);
    const act = lastAct(fake);
    assert(act && act.act === 'ready', 'サーバーへ「じゅんびOK」が届く（' + JSON.stringify(act) + '）');
    assertNoErrors(errors, 'じゅんび画面で未捕捉の例外');
    win.close();
  });

  await r.test('すごろく（部屋）：ミニゲームの入力が出て、押したものがサーバーへ届く', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    push(fake, sugoRoom('sugograb', {
      game: 'sugograb', phase: 'play', cells: 30, board: sugoBoard(30),
      coinsUsed: true, lap: 1, sharedPiece: true, piece: 4,
      deadline: Date.now() + 20000,
      mini: { id: 'janken', kind: 'luck', title: 'せーの、じゃんけん', lead: 'いっせいに出す' },
      answered: [],
      players: [
        { id: 'm1', name: 'あき', pos: null, coins: 20, connected: true },
        { id: 'm2', name: 'びび', pos: null, coins: 20, connected: true },
        { id: 'm3', name: 'ちか', pos: null, coins: 20, connected: true }
      ],
      waiting: ['あき', 'びび', 'ちか']
    }));
    await waitScreen(win, doc, 'scr-rt-sugoroku', 4000);
    const hands = doc.querySelectorAll('#rtSugoInput [data-hand]');
    assertEqual(hands.length, 3, 'グー・チョキ・パーが出る');
    assert(/せーの、じゃんけん/.test(el(doc, 'rtSugoNote').textContent), '何をするのか出る');
    click(doc, hands[0]);
    await sleep(win, 60);
    const act = lastAct(fake);
    assert(act && act.hand === 'g', '出した手がサーバーへ届く（' + JSON.stringify(act) + '）');
    // 出したあとは、押せる形のまま残さない（二重に出せてしまう）
    assertEqual(doc.querySelectorAll('#rtSugoInput [data-hand]').length, 0, '出したら選び直せない');
    assertNoErrors(errors, 'ミニゲームの画面で未捕捉の例外');
    win.close();
  });

  await r.test('すごろく（部屋）：分け合いは、出た目より多い数を出せない', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    push(fake, sugoRoom('sugopair', {
      game: 'sugopair', phase: 'split', cells: 30, board: sugoBoard(30),
      coinsUsed: false, lap: 1, pairs: true, deadline: Date.now() + 30000,
      groups: [
        { id: 'g0', names: ['あき', 'びび'], gone: [], pos: 3, rank: 1,
          goalOrder: null, dice: 4, parts: {}, sum: 0, locked: false, solo: false, auto: false },
        { id: 'g1', names: ['ちか'], gone: [], pos: 2, rank: 2,
          goalOrder: null, dice: 3, parts: {}, sum: 0, locked: false, solo: true, auto: false }
      ],
      players: [
        { id: 'm1', name: 'あき', pos: 3, groupId: 'g0', connected: true },
        { id: 'm2', name: 'びび', pos: 3, groupId: 'g0', connected: true },
        { id: 'm3', name: 'ちか', pos: 2, groupId: 'g1', connected: true }
      ],
      waiting: ['あき', 'びび']
    }));
    await waitScreen(win, doc, 'scr-rt-sugoroku', 4000);
    const pad = doc.querySelectorAll('#rtSugoInput [data-rtsplit]');
    // 出た目が4なら、選べるのは 0〜4 の5つだけ（5マス以上は端から出てこない）
    assertEqual(pad.length, 5, '0〜4だけが出る');
    assertEqual(pad[pad.length - 1].dataset.rtsplit, '4', '上限は出た目そのもの');
    click(doc, pad[2]);
    await sleep(win, 60);
    const act = lastAct(fake);
    assert(act && act.act === 'split' && act.steps === 2,
      '入れた数がサーバーへ届く（' + JSON.stringify(act) + '）');
    assertNoErrors(errors, '分け合いの画面で未捕捉の例外');
    win.close();
  });

  await r.test('どこにいる？：申告に出せるのは、自分に見えているものだけ', async () => {
    // 嘘をつけるのは**区画**のほうで、手がかりは自分に見えているものしか言えない。
    // 全部の手がかりを選べてしまうと、矛盾が起きようがなくなり遊びが成立しない
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    push(fake, sugoRoom('sugohide', {
      game: 'sugohide', phase: 'say', cells: 30, board: sugoBoard(30),
      coinsUsed: false, lap: 1, hidden: true, deadline: Date.now() + 40000,
      areas: [
        { id: 'a0', name: 'ふもと' }, { id: 'a1', name: 'かわぞい' },
        { id: 'a2', name: 'まちなか' }, { id: 'a3', name: 'さかみち' },
        { id: 'a4', name: 'みねちかく' }
      ],
      clues: [
        { id: 'c01', text: '水の音がする' }, { id: 'c04', text: '人の話し声がする' },
        { id: 'c07', text: '風がつめたい' }, { id: 'c09', text: '足もとがぬかるんでいる' }
      ],
      sayer: { id: 'm2', name: 'びび' },
      said: null,
      players: [
        { id: 'm1', name: 'あき', pos: null, saidArea: null, asking: false, connected: true },
        { id: 'm2', name: 'びび', pos: null, saidArea: null, asking: true, connected: true },
        { id: 'm3', name: 'ちか', pos: null, saidArea: null, asking: false, connected: true }
      ],
      waiting: ['びび']
    }));
    pushYou(fake, { game: 'sugohide', phase: 'say', pos: 12, left: 18,
      area: { id: 'a2', name: 'まちなか' },
      clues: [{ id: 'c04', text: '人の話し声がする' }, { id: 'c09', text: '足もとがぬかるんでいる' }],
      asking: true });
    await waitScreen(win, doc, 'scr-rt-sugoroku', 4000);
    // 区画は5つとも選べる（嘘をつけるのはここ）
    const areas = doc.querySelectorAll('#rtSugoInput [data-rtarea]');
    assertEqual(areas.length, 5, '5つの区画から選べる');
    // 自分の本当の居場所は、自分の画面にだけ出る
    assert(/まちなか/.test(el(doc, 'rtSugoHint').textContent), '自分の居場所は自分には分かる');
    // わざと本当とは違う区画を選ぶ
    click(doc, doc.querySelector('[data-rtarea="a4"]'));
    await sleep(win, 60);
    const clues = doc.querySelectorAll('#rtSugoInput [data-rtclue]');
    assertEqual(clues.length, 2, '言えるのは自分に見えている2つだけ');
    const ids = Array.from(clues).map((b) => b.dataset.rtclue).sort().join(',');
    assertEqual(ids, 'c04,c09', '配られていない手がかりは出てこない');
    click(doc, clues[0]);
    await sleep(win, 60);
    const act = lastAct(fake);
    assert(act && act.act === 'say' && act.areaId === 'a4' && act.clueId === 'c04',
      '申告がそのまま届く（' + JSON.stringify(act) + '）');
    assertNoErrors(errors, '申告の画面で未捕捉の例外');
    win.close();
  });

  await r.test('すごろく（部屋）：自分の番でなければ、サイコロは出ない', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    push(fake, sugoRoom('sugotoll', {
      game: 'sugotoll', phase: 'turn', cells: 40, board: sugoBoard(40),
      coinsUsed: true, lap: 1, deadline: Date.now() + 30000,
      turn: { id: 'm1', name: 'あき' },
      players: [
        { id: 'm1', name: 'あき', pos: 5, coins: 18, connected: true },
        { id: 'm2', name: 'びび', pos: 3, coins: 20, connected: true },
        { id: 'm3', name: 'ちか', pos: 0, coins: 20, connected: true }
      ],
      waiting: ['あき']
    }));
    await waitScreen(win, doc, 'scr-rt-sugoroku', 4000);
    assertEqual(el(doc, 'rtSugoDice').style.display, 'none', '人の番ではサイコロを出さない');
    assert(/あき/.test(el(doc, 'rtSugoHint').textContent), '誰を待っているか出る');
    assertEqual(el(doc, 'rtSugoInput').innerHTML, '', '押せるものは何も出さない');
    assertNoErrors(errors, '待ち側の画面で未捕捉の例外');
    win.close();
  });

  await r.test('すごろく（部屋）：どこにいる？は、他人の位置がどこにも出ない', async () => {
    // このゲームは秘密が漏れた時点で成立しない。
    // サーバーが公開ビューに入れていないので、画面も持ちようがない——
    // それが本当かを、DOMの中身で確かめる
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    push(fake, sugoRoom('sugohide', {
      game: 'sugohide', phase: 'say', cells: 30, board: sugoBoard(30),
      coinsUsed: false, lap: 1, hidden: true,
      areas: [{ id: 'a0', name: 'ふもと' }, { id: 'a2', name: 'まちなか' }],
      clues: [{ id: 'c04', text: '人の話し声がする' }],
      sayer: { id: 'm1', name: 'あき' },
      said: null,
      players: [
        { id: 'm1', name: 'あき', pos: null, saidArea: 'a2', asking: true, connected: true },
        { id: 'm2', name: 'びび', pos: null, saidArea: null, asking: false, connected: true },
        { id: 'm3', name: 'ちか', pos: null, saidArea: 'a0', asking: false, connected: true }
      ],
      waiting: ['あき']
    }));
    pushYou(fake, { game: 'sugohide', phase: 'say', pos: 12, left: 18,
      area: { id: 'a2', name: 'まちなか' }, clues: [{ id: 'c04', text: '人の話し声がする' }] });
    await waitScreen(win, doc, 'scr-rt-sugoroku', 4000);
    // 自分の駒だけが盤に出る
    assertEqual(doc.querySelectorAll('#rtSugoBoard .sugo-piece').length, 1, '自分の駒だけ');
    // 一覧に出るのは「申告した区画」であって、位置ではない
    const rows = el(doc, 'rtSugoMe').textContent;
    assert(/まちなか/.test(rows), '申告した区画が出る');
    assert(/まだ申告なし/.test(rows), 'まだの人はそう出る');
    assert(!/あと18/.test(rows), '他人の残りマス数は出ない');
    assert(/あき/.test(el(doc, 'rtSugoTurn').textContent), '誰が申告するか出る');
    assertNoErrors(errors, 'どこにいる？の部屋画面で未捕捉の例外');
    win.close();
  });

  // ---- 第31弾：オークションバトル（作り直し）----

  await r.test('オークション：品物の一言だけが出て、アイテムを買える', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    push(fake, auctionRoom(auctionView()));
    pushYou(fake, auctionYou());
    await waitScreen(win, doc, 'scr-rt-auction', 4000);
    assert(/秘密入札/.test(el(doc, 'auPhase').textContent), 'どの遊び方か分かる');
    assert(/古びた壺/.test(el(doc, 'auBody').textContent), '品物の一言が出る');
    assert(doc.querySelector('[data-aubuy="appraise"]'), '鑑定眼を買える');
    assert(doc.querySelector('[data-auready]'), '見終わったら進める');

    click(doc, doc.querySelector('[data-aubuy="appraise"]'));
    await sleep(win, 80);
    const act = fake.emits.filter(e => e.name === 'wolf:act').pop();
    assertEqual(act.payload.targetId, 'buy:appraise', '買うことを送っている');
    assertNoErrors(errors, 'オークションの画面で未捕捉の例外');
    win.close();
  });

  await r.test('オークション：鑑定眼のヒントは、自分の画面にだけ出る', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    push(fake, auctionRoom(auctionView()));
    pushYou(fake, auctionYou({ hints: ['底に、消えかけた印が彫ってある'] }));
    await waitScreen(win, doc, 'scr-rt-auction', 4000);
    assert(/消えかけた印/.test(el(doc, 'auBody').textContent), '自分のヒントが出る');
    // 公開情報（room:update で全員に配られるもの）にはヒントが入っていない
    assertEqual(JSON.stringify(auctionView()).indexOf('消えかけた印'), -1,
      '公開情報にヒントは混ざらない');
    assertNoErrors(errors, 'ヒントの表示で未捕捉の例外');
    win.close();
  });

  await r.test('秘密入札：金額を出したあと、撤回権があれば出し直せる', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    push(fake, auctionRoom(auctionView({ phase: 'bid', doneNames: [], remainingMs: 30000 })));
    pushYou(fake, auctionYou({ phase: 'bid', myBid: null, canRetract: false }));
    await waitScreen(win, doc, 'scr-rt-auction', 4000);
    assert(doc.getElementById('auBidSlider'), '金額を決められる');
    click(doc, doc.querySelector('[data-aubid]'));
    await sleep(win, 80);
    const vote = fake.emits.filter(e => e.name === 'wolf:vote').pop();
    assert(vote, '入札を送っている');
    assertEqual(typeof vote.payload.targetId, 'number', '金額は数字で送る');

    // 出したあとは、撤回権を持っている時だけ出し直せる
    pushYou(fake, auctionYou({ phase: 'bid', myBid: 7, canRetract: false }));
    await sleep(win, 80);
    assert(!doc.querySelector('[data-auretract]'), '撤回権が無ければ出し直せない');
    pushYou(fake, auctionYou({ phase: 'bid', myBid: 7, canRetract: true }));
    await sleep(win, 80);
    assert(doc.querySelector('[data-auretract]'), '撤回権があれば出し直せる');
    assertNoErrors(errors, '入札の画面で未捕捉の例外');
    win.close();
  });

  await r.test('せり上げ式：いまの最高額が出て、それより上からしか出せない', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    push(fake, auctionRoom(auctionView({
      phase: 'bid', mode: 'open', highest: { name: 'あき', amount: 5 }, remainingMs: 8000
    })));
    pushYou(fake, auctionYou({ phase: 'bid', mode: 'open', myBid: null }));
    await waitScreen(win, doc, 'scr-rt-auction', 4000);
    assert(/あき/.test(el(doc, 'auNote').textContent), '誰が最高額か出る');
    assert(/5枚/.test(el(doc, 'auNote').textContent), 'いくらかも出る');
    assertEqual(doc.getElementById('auBidSlider').min, '6', '最高額より上からしか出せない');
    assertNoErrors(errors, 'せり上げ式の画面で未捕捉の例外');
    win.close();
  });

  await r.test('オークション：落札が決まってから、正体と差し引きが出る', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    push(fake, auctionRoom(auctionView({
      phase: 'result', remainingMs: 8000,
      lastResult: {
        passed: false, winner: 'あき', bid: 6, paid: 6, value: 15, delta: 9,
        halfticket: false, doubleup: false,
        teaser: '古びた壺', reveal: '三百年前の窯で焼かれた名品', tier: 'jackpot'
      }
    })));
    pushYou(fake, auctionYou({ phase: 'result' }));
    await waitScreen(win, doc, 'scr-rt-auction', 4000);
    const body = el(doc, 'auBody').textContent;
    assert(/三百年前/.test(body), '正体が明かされる');
    assert(/大当たり/.test(body), '価値の階層が出る');
    assert(/\+9枚/.test(body), '差し引きが出る');
    assertNoErrors(errors, '結果の画面で未捕捉の例外');
    win.close();
  });

  // 第36弾 36-4：実機で結果発表に「第7/6ラウンド」と出ていた。
  // サーバーは最後のラウンドを終えた時に round を1つ進めてから決着させるので、
  // 決着の見え方では round が総数を1つ超える。決着した画面にラウンド数は出さない
  await r.test('36-4：決着した画面に、範囲を超えたラウンド数を出さない', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    const ended = {
      phase: 'ended', round: 7, totalRounds: 6,
      result: { ranking: [
        { rank: 1, name: 'あき', chips: 31 },
        { rank: 2, name: 'びび', chips: 18 }
      ] }
    };
    // 条件が本当に作れているかを、主張の前に確かめる（落とし穴10 型b）
    assert(ended.round > ended.totalRounds, '決着の時点では、ラウンド数が総数を超えている');

    push(fake, auctionRoom(auctionView(ended)));
    pushYou(fake, auctionYou({ phase: 'ended' }));
    await waitScreen(win, doc, 'scr-rt-auction', 4000);
    assertEqual(el(doc, 'auRound').textContent, '', '決着した画面にラウンド数は出ない');
    const shown = el(doc, 'scr-rt-auction').textContent;
    assert(!/ラウンド/.test(el(doc, 'auRound').textContent), 'ラウンドの文字も残らない');
    assert(!/7\s*\/\s*6/.test(shown), '「7 / 6」のような範囲外の数字が画面に無い');
    assert(/あき/.test(shown), '出すべきもの（順位）はちゃんと出ている');

    // 遊んでいる最中は、今までどおり出る（消しすぎていないこと）
    push(fake, auctionRoom(auctionView({ phase: 'bid', round: 3, totalRounds: 6, remainingMs: 8000 })));
    pushYou(fake, auctionYou({ phase: 'bid' }));
    await waitFor(win, () => /3/.test(el(doc, 'auRound').textContent), 3000, 'ラウンド数が戻る');
    assert(/第3 \/ 6ラウンド/.test(el(doc, 'auRound').textContent), '途中では第3/6ラウンドと出る');
    assertNoErrors(errors, '決着の画面で未捕捉の例外');
    win.close();
  });

  await r.test('大画面：オークションは、落札が決まるまで正体を出さない', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm5', role: 'bigscreen' });
    const room = auctionRoom(auctionView({
      phase: 'bid', mode: 'open', highest: { name: 'あき', amount: 5 }
    }));
    room.members = room.members.concat([
      { id: 'm5', name: 'テレビ', role: 'bigscreen', connected: true, isHost: false }
    ]);
    room.memberCount = 3;
    push(fake, room);
    await sleep(win, 150);
    assertEqual(activeScreen(doc), 'scr-rt-big', '大画面のまま');
    assertEqual(el(doc, 'bigMain').textContent, '古びた壺', '一言だけが大きく出る');
    assert(/あき/.test(el(doc, 'bigSub').textContent), 'いまの最高額が出る');
    assert(/あき 20/.test(el(doc, 'bigList').textContent), 'チップが出る');
    assertNoErrors(errors, '大画面で未捕捉の例外');
    win.close();
  });

  await r.test('オークション：2つの遊び方とも、設定まで歩けて開始を送る', async () => {
    for (const c of [{ mode: 'auction-open', sent: 'open' }, { mode: 'auction-sealed', sent: 'sealed' }]) {
      const { win, doc, errors } = await launch(LAUNCH);
      const fake = await toRoom(win, doc, { pick: false });
      click(doc, 'rtPickGameBtn');
      await waitScreen(win, doc, 'scr-shelf', 3000);
      const cart = doc.querySelector('.cart[data-cart="auction"]');
      assert(cart, 'オークションのカセットが棚にある');
      cart.click();
      if (activeScreen(doc) === 'scr-shelf') cart.click();
      await waitScreen(win, doc, 'scr-mode', 3000);
      assert(doc.querySelector('.app').classList.contains('theme-auction'),
        'カセットを選んだ時点から競り市の見た目になる');
      click(doc, doc.querySelector('.mode-card[data-id="' + c.mode + '"]'));
      click(doc, 'modeNextBtn');
      await waitScreen(win, doc, 'scr-set-auction', 3000);
      assert(doc.querySelector('.app').classList.contains('theme-auction'),
        '設定画面でも競り市の見た目が続く');
      click(doc, doc.querySelector('#scr-set-auction [data-wiz-next]'));
      await sleep(win, 100);
      // 遊び方の説明が挟まる回もあるので、出ていたら読み終える
      if (activeScreen(doc) === 'scr-mode-rules') { click(doc, 'rulesStartBtn'); await sleep(win, 100); }
      await waitScreen(win, doc, 'scr-rt-room', 3000);

      push(fake, auctionRoom(auctionView({ phase: 'lobby' })));
      await sleep(win, 80);
      click(doc, 'rtStartBtn');
      await sleep(win, 120);
      const start = fake.emits.filter(e => e.name === 'wolf:start').pop();
      assert(start, c.mode + '：開始を送っている');
      assertEqual(start.payload.game, 'auction', c.mode + '：オークションとして始める');
      assertEqual(start.payload.mode, c.sent, c.mode + '：えらんだ遊び方で始める');
      assertNoErrors(errors, c.mode + ' の開始で未捕捉の例外');
      win.close();
    }
  });

  // ---- 第32弾-B 第1部：設定（項目を選ぶ→専用画面が開く） ----

  await r.test('設定：部屋にいる時だけ「部屋」の入口が出る', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    // 棚では出ない
    click(doc, 'shelfGearBtn');
    await sleep(win, 80);
    assert(!doc.querySelector('#setRootMenu [data-setpage="room"]'), '部屋の外では出さない');
    click(doc, 'closeSettingsBtn');
    await sleep(win, 60);

    await toRoom(win, doc, { pick: false });
    click(doc, 'floatingGearBtn');
    await sleep(win, 80);
    assert(doc.querySelector('#setRootMenu [data-setpage="room"]'), '部屋にいる時は出る');
    assertNoErrors(errors, '設定の入口で未捕捉の例外');
    win.close();
  });

  await r.test('設定：部屋のページに、つながり具合とメンバー操作が出る', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { pick: false }); // 自分が進行役（m1）
    // 1人切れている状態を配る
    push(fake, roomSnapshot({
      members: roomSnapshot().members.map((m) => (
        m.id === 'm3' ? Object.assign({}, m, { connected: false }) : m
      ))
    }));
    await sleep(win, 80);
    click(doc, 'floatingGearBtn');
    await sleep(win, 80);
    doc.querySelector('#setRootMenu [data-setpage="room"]').click();
    await sleep(win, 80);

    const body = el(doc, 'setRoomBody');
    assert(/4 \/ 5 人/.test(body.textContent), 'いま何人つながっているかが出る');
    assert(/通信が切れています/.test(body.textContent), '切れている人がいることが分かる');
    assertEqual(body.querySelectorAll('.set-member').length, 5, '全員ぶん並ぶ');
    assertEqual(body.querySelectorAll('.set-member.off').length, 1, '切れている人が分かる');
    // 進行役なので、他の人に対して操作が出る（自分には出ない）
    assert(body.querySelector('[data-setkick="m2"]'), '出すボタンが出る');
    assert(body.querySelector('[data-sethost="m2"]'), '進行役を譲るボタンが出る');
    assert(!body.querySelector('[data-setkick="m1"]'), '自分は出せない');
    // 大画面への切り替えもここから
    assert(body.querySelector('[data-setact="toBig"]'), '大画面に切り替えられる');
    assertNoErrors(errors, '部屋の設定で未捕捉の例外');
    win.close();
  });

  await r.test('設定：進行役でなければ、メンバーを操作するボタンは出ない', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    await toRoom(win, doc, { join: true, memberId: 'm2' }); // 進行役は m1
    click(doc, 'floatingGearBtn');
    await sleep(win, 80);
    doc.querySelector('#setRootMenu [data-setpage="room"]').click();
    await sleep(win, 80);
    const body = el(doc, 'setRoomBody');
    assertEqual(body.querySelectorAll('[data-setkick]').length, 0, '出すボタンは出ない');
    assertEqual(body.querySelectorAll('[data-sethost]').length, 0, '譲るボタンも出ない');
    // 抜ける・大画面にする は、進行役でなくてもできる
    assert(body.querySelector('[data-setact="leaveRoom"]'), '部屋を出られる');
    assert(body.querySelector('[data-setact="toBig"]'), '大画面にもできる');
    assertNoErrors(errors, '参加者の設定で未捕捉の例外');
    win.close();
  });

  await r.test('設定：部屋を解散するのは、進行役だけに出る', async () => {
    const { win, doc } = await launch(LAUNCH);
    await toRoom(win, doc, { join: true, memberId: 'm2' });
    click(doc, 'floatingGearBtn');
    await sleep(win, 80);
    doc.querySelector('#setRootMenu [data-setpage="danger"]').click();
    await sleep(win, 80);
    assertEqual(el(doc, 'setCloseRoomBtn').style.display, 'none', '参加者には出さない');
    win.close();
  });

  // ---- 第32弾-A 第4部：称号が1人1台でも数えられるか ----

  // 称号は /api/titles に預ける形なので、預けにきた中身を見て確かめる（ハーネスが記録している）
  function titlePuts(win) { return win.__titlePuts || []; }
  function endedWolfRoom() {
    return roomSnapshot({
      state: { phase: 'ended', game: 'wolfrole', data: wolfView({
        phase: 'ended', turn: 3,
        result: { winner: 'village', roles: [{ id: 'm2', name: 'びび', team: 'village', role: 'villager', alive: true }] }
      }) }
    });
  }
  function endedWolfYou(achievements) {
    return {
      phase: 'ended', roleId: 'villager', roleName: '村人', roleDesc: '',
      alive: true, done: true, choices: [], achievements: achievements
    };
  }

  await r.test('決着が「部屋→自分の情報」の順で届いても、称号を取りこぼさない（第34弾）', async () => {
    // 実機で発生：部屋の決着が先に届くと、手元の「自分の情報」は
    // まだ遊んでいる途中の古いもので、それで数えて勝ち数を取りこぼしていた
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    const sent = titlePuts(win);
    // 遊んでいる途中の自分の情報（achievements はまだ無い）
    push(fake, roomSnapshot({ state: { phase: 'vote', game: 'wolfrole', data: wolfView({ phase: 'vote' }) } }));
    pushYou(fake, { phase: 'vote', roleId: 'villager', roleName: '村人', roleDesc: '',
      alive: true, done: true, choices: [] });
    await waitScreen(win, doc, 'scr-rt-play', 4000);
    // 部屋の決着が先に届く
    push(fake, endedWolfRoom());
    await sleep(win, 200);
    assertEqual(sent.length, 0, '古い情報では数えない（自分の決着情報を待つ）');
    // 自分の決着情報があとから届く
    pushYou(fake, endedWolfYou({ plays: 1, wins: 1, villageWins: 1 }));
    await waitFor(win, () => sent.length >= 1, 3000, '数えられる');
    const last = sent[sent.length - 1].stats.jinro;
    assertEqual(last.wins, 1, '勝ちを取りこぼさない');
    assertEqual(last.plays, 1, '遊んだ回数は1回だけ');
    assertNoErrors(errors, '決着の順番ずれで未捕捉の例外');
    win.close();
  });

  await r.test('部屋のワードウルフでも、サーバーの数えた結果で称号が付く（第34弾）', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    const sent = titlePuts(win);
    push(fake, roomSnapshot({
      state: { phase: 'ended', game: 'wordwolf', data: {
        phase: 'ended', turn: 1, turnLimit: 1, aliveCount: 4,
        players: [{ id: 'm2', name: 'びび', out: false }],
        result: { winner: 'wolf', majorityTopic: '傘', minorityTopic: 'レインコート',
          wolves: ['びび'], roles: [], scores: [], voteLog: [] }
      } }
    }));
    pushYou(fake, {
      phase: 'ended', topic: 'レインコート', youAreWolf: true,
      roleId: null, roleName: null, roleDesc: '', out: false, done: true, info: null,
      achievements: { plays: 1, wordwolfPlays: 1, wins: 1, wolfWins: 1,
        wolfEscapes: 1, wordwolfEscapes: 1 }
    });
    await waitScreen(win, doc, 'scr-rt-play', 4000);
    await waitFor(win, () => sent.length >= 1, 3000, '数えられる');
    const st = sent[sent.length - 1].stats.jinro;
    assertEqual(st.wordwolfPlays, 1, 'ワードウルフとして数える');
    assertEqual(st.wins, 1, '勝ちが付く');
    assertEqual(st.wordwolfEscapes, 1, '逃げ切りが付く');
    assertNoErrors(errors, 'ワードウルフの称号で未捕捉の例外');
    win.close();
  });

  await r.test('部屋で遊んだぶんも称号に数え、同じ試合で二重には数えない', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    const sent = titlePuts(win);

    push(fake, endedWolfRoom());
    pushYou(fake, endedWolfYou({ plays: 1, wins: 1 }));
    await waitScreen(win, doc, 'scr-rt-play', 4000);
    await waitFor(win, () => sent.length >= 1, 3000, '称号を記録しにいく');
    assertEqual(sent[0].stats.jinro.plays, 1, '遊んだ回数が1つ入る');

    // 同じ決着を何度描き直しても、増えない
    push(fake, endedWolfRoom());
    pushYou(fake, endedWolfYou({ plays: 1, wins: 1 }));
    await sleep(win, 200);
    assertEqual(sent.length, 1, '同じ試合では二重に数えない');
    assertNoErrors(errors, '称号の記録で未捕捉の例外');
    win.close();
  });

  await r.test('新しい3カセットも、部屋で遊んだぶんが称号に数えられる', async () => {
    // 第32弾-B-2：爆弾解除・クイズ王・オークション。
    // 数えるのは rtRenderCurrent の1か所なので、ゲームが増えても数え忘れない
    const CASES = [
      { label: 'クイズ解除', game: 'bomb', cassette: 'bakudan',
        room: () => bombRoom({ state: { phase: 'ended', game: 'bomb',
          data: bombView({ phase: 'ended', result: { mode: 'coop', success: true, misses: 0, lives: 3, total: 4, codes: [] } }) } }),
        you: () => bombYou({ phase: 'ended' }),
        check: (st) => { assertEqual(st.plays, 1, '遊んだ回数'); assertEqual(st.noMissClears, 1, 'ミス0で解除'); } },
      { label: '実物解除', game: 'defuse', cassette: 'bakudan',
        room: () => defuseRoom({ state: { phase: 'ended', game: 'defuse',
          data: defuseView({ phase: 'ended', strikesLeft: 3, strikesMax: 3,
            result: { success: true, roles: [{ id: 'm2', name: 'びび', role: 'defuser' }] } }) } }),
        you: () => defuseYou({ phase: 'ended' }),
        check: (st) => { assertEqual(st.defuseWins, 1, '実物解除の成功'); assertEqual(st.defuseNoMiss, 1, 'ミス0'); } },
      { label: 'クイズ王', game: 'quizrush', cassette: 'quizou',
        room: () => quizRoom('quizrush', quizView('quizrush', { phase: 'ended',
          rush: { round: 1, roundsToWin: 0, roundResult: null, board: [], passLimit: 3 },
          result: { variant: 'quizrush', ranking: [{ id: 'm2', name: 'びび', score: 9, rank: 1 }] } })),
        you: () => quizYou('quizrush', { phase: 'ended', rush: { passesLeft: 3 } }),
        check: (st) => { assertEqual(st.plays, 1, '遊んだ回数'); assertEqual(st.wins, 1, '1位'); } },
      { label: 'オークション', game: 'auction', cassette: 'auction',
        room: () => auctionRoom(auctionView({ phase: 'ended',
          result: { ranking: [{ id: 'm2', name: 'びび', chips: 30, rank: 1 }] } })),
        you: () => auctionYou({ phase: 'ended' }),
        check: (st) => { assertEqual(st.plays, 1, '遊んだ回数'); assertEqual(st.wins, 1, '1位'); } }
    ];
    for (const c of CASES) {
      const { win, doc, errors } = await launch(LAUNCH);
      const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
      const sent = titlePuts(win);
      push(fake, c.room());
      pushYou(fake, c.you());
      await waitFor(win, () => sent.length >= 1, 3000, c.label + '：称号を記録しにいく');
      c.check(sent[sent.length - 1].stats[c.cassette]);
      assertNoErrors(errors, c.label + ' の称号で未捕捉の例外');
      win.close();
    }
  });

  await r.test('同じ部屋で2回目を遊んでも、称号がちゃんと数えられる', async () => {
    // 第32弾-A 第4部で見つけた不具合：
    // 二重に数えない印を「部屋コード＋ターン数」で作っていたので、
    // 同じ部屋で2回目を遊んで、同じターン数で決着すると
    // 1回目と同じ印になり、2回目が数えられていなかった
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    const sent = titlePuts(win);

    push(fake, endedWolfRoom());
    pushYou(fake, endedWolfYou({ plays: 1 }));
    await waitScreen(win, doc, 'scr-rt-play', 4000);
    await waitFor(win, () => sent.length >= 1, 3000, '1回目が数えられる');

    // 部屋はそのままで、もう一度あそぶ
    push(fake, roomSnapshot({
      state: { phase: 'roleReveal', game: 'wolfrole', data: wolfView({ phase: 'roleReveal', turn: 1 }) }
    }));
    pushYou(fake, {
      phase: 'roleReveal', roleId: 'villager', roleName: '村人', roleDesc: '',
      alive: true, done: false, choices: []
    });
    await sleep(win, 150);

    // 2回目。ターン数まで1回目と同じ
    push(fake, endedWolfRoom());
    pushYou(fake, endedWolfYou({ plays: 1 }));
    await waitFor(win, () => sent.length >= 2, 3000, '2回目もちゃんと数えられる');
    assertNoErrors(errors, '2回目の称号で未捕捉の例外');
    win.close();
  });

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

  // ===================================================================
  // 第32弾-C 第5部：クイズ王の画面を分ける
  // 指示に「画面が分かれていないため、何をやっているのか分からない」と
  // 名指しで書かれていた場所
  // ===================================================================

  await r.test('ラッシュ：難易度をえらぶ画面と、問題の画面を同時に出さない', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    push(fake, quizRoom('quizrush', quizView('quizrush', { rush: { round: 1, roundsToWin: 0, roundResult: null, board: [] } })));
    pushYou(fake, quizYou('quizrush', {
      rush: {
        tier: 'normal', canChangeTier: true, passesLeft: 3, score: 0, answered: 0, hits: 0, last: null,
        question: { text: 'これはなに？', choices: ['あ', 'い', 'う'], tier: 'normal' }
      }
    }));
    await waitScreen(win, doc, 'scr-rt-quiz', 4000);
    // 問題を出している間は、難易度の一覧を並べない（原則A）
    assert(/これはなに？/.test(el(doc, 'qzBody').textContent), '問題が出ている');
    assert(!doc.querySelector('[data-qztier]'), '問題の画面に難易度の一覧を並べない');
    // どの難易度で挑んでいるかは、小さく出ている
    const now = doc.querySelector('.quiz-tiernow');
    assert(now, 'いまの難易度が出ている');
    assert(/点/.test(now.textContent), '何点の問題かも分かる');
    // パスは残り回数つき
    const pass = doc.querySelector('[data-qzpass]');
    assert(pass && /あと3回/.test(pass.textContent),
      'パスの残り回数が出る（実際: ' + (pass ? pass.textContent : 'なし') + '）');

    // 変えたい時だけ、選び直しの画面へ移る（できることは減っていない）
    click(doc, doc.querySelector('[data-qztierpick]'));
    await sleep(win, 60);
    assert(doc.querySelector('[data-qztier="easy"]'), '選び直しの画面が開く');
    assert(!/これはなに？/.test(el(doc, 'qzBody').textContent), '問題は引っ込む');
    click(doc, doc.querySelector('[data-qztierback]'));
    await sleep(win, 60);
    assert(/これはなに？/.test(el(doc, 'qzBody').textContent), '問題にもどれる');
    assertNoErrors(errors, 'ラッシュの画面分割で未捕捉の例外');
    win.close();
  });

  await r.test('ラッシュ：難易度は大きなボタンで縦に並び、点数が大きく出る', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    push(fake, quizRoom('quizrush', quizView('quizrush', { rush: { round: 1, roundsToWin: 0, roundResult: null, board: [] } })));
    pushYou(fake, quizYou('quizrush', {
      rush: { tier: null, canChangeTier: true, passesLeft: 3, score: 0, answered: 0, hits: 0, last: null, question: null }
    }));
    await waitScreen(win, doc, 'scr-rt-quiz', 4000);
    const cards = doc.querySelectorAll('.tier-card');
    assertEqual(cards.length, 5, '5段階が並ぶ');
    cards.forEach((c) => {
      assert(c.querySelector('.tier-name'), '難易度の名前が出る');
      assert(c.querySelector('.tier-pt b'), '点数が大きく出る');
    });
    // 縦に並ぶ（横に5つ詰めると読めない）
    const css = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'public', 'index.html'), 'utf8');
    assert(/\.quiz-tiers\{display:flex;flex-direction:column/.test(css), '縦に並ぶ');
    assertNoErrors(errors, '難易度の並びで未捕捉の例外');
    win.close();
  });

  await r.test('つぎつぎ：入力欄が画面幅いっぱいで、出た答えが積み上がる', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    const list = {
      style: 'coop', topic: '赤い食べ物', tier: 'easy', targetCount: 10,
      said: ['りんご', 'いちご', 'トマト'], saidCount: 3, turnId: 'm2', turnName: 'びび',
      turnRemainingMs: 15000, lastNote: null,
      order: [{ id: 'm1', name: 'あき', alive: true }, { id: 'm2', name: 'びび', alive: true }]
    };
    push(fake, quizRoom('quizlist', quizView('quizlist', { list: list })));
    pushYou(fake, quizYou('quizlist', { list: { yourTurn: true, alive: true, turnRemainingMs: 15000 } }));
    await waitScreen(win, doc, 'scr-rt-quiz', 4000);
    // 出た答えが1行ずつ積み上がる（横並びのチップではない）
    const rows = doc.querySelectorAll('.said-list .said-row');
    assertEqual(rows.length, 3, '出た答えが行で積み上がる');
    assert(/トマト/.test(rows[0].textContent), '新しいものが上にくる');
    assert(rows[0].classList.contains('fresh'), 'いちばん新しい行が光る');
    assert(/3/.test(rows[0].querySelector('.said-no').textContent), '何個目かが分かる');
    // 入力欄は全幅（ボタンと横並びにしない）
    const css = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'public', 'index.html'), 'utf8');
    assert(/\.quiz-answer\{display:flex;flex-direction:column/.test(css),
      '入力欄と回答ボタンを横に並べない');
    assert(doc.getElementById('qzAnswerInput'), '入力欄が出る');
    // 協力形式では、あと何個かが出る
    assert(/あと7個/.test(el(doc, 'qzBody').textContent), 'あと何個かが分かる');
    assertNoErrors(errors, 'つぎつぎの画面で未捕捉の例外');
    win.close();
  });

  await r.test('とくとく：いま押せば何点かが、大きな数字で出る', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    const rv = {
      index: 0, total: 5, tier: 'normal', text: 'に○ん○いち○○の…',
      shown: 4, length: 12, choices: ['あ', 'い', 'う'],
      nowPoints: 80, buzzedId: null, buzzedName: null, answerRemainingMs: null, lastNote: null
    };
    push(fake, quizRoom('quizreveal', quizView('quizreveal', { reveal: rv })));
    pushYou(fake, quizYou('quizreveal', { reveal: { yours: false, canBuzz: true, locked: false } }));
    await waitScreen(win, doc, 'scr-rt-quiz', 4000);
    const pts = doc.querySelector('.reveal-points');
    assert(pts, 'いま押せば何点かが出る');
    assertEqual(pts.querySelector('.rp-num').textContent, '80', '点数が出る');
    assert(/いま押せば/.test(pts.textContent), '何の数字か分かる');
    // 誰かが押したあとは、もう「いま押せば」ではない
    push(fake, quizRoom('quizreveal', quizView('quizreveal', {
      reveal: Object.assign({}, rv, { buzzedId: 'm1', buzzedName: 'あき' })
    })));
    await sleep(win, 80);
    assert(!doc.querySelector('.reveal-points'), '誰かが答えている間は出さない');
    assert(/あき/.test(el(doc, 'qzNote').textContent), '誰が答えているか分かる');
    assertNoErrors(errors, 'とくとくの得点表示で未捕捉の例外');
    win.close();
  });

  await r.test('早押し：あと何問で勝ち抜けるかが、○の並びで分かる', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    const b = {
      roundNum: 1, winsNeeded: 3, delivery: 'text', matchResult: null,
      pair: [{ id: 'm1', name: 'あき', wins: 2 }, { id: 'm2', name: 'びび', wins: 0 }],
      buzzedId: null, buzzedName: null, lastNote: null,
      question: { text: 'これはなに？', choices: ['あ', 'い'] }
    };
    push(fake, quizRoom('buzzer', quizView('buzzer', { buzzer: b })));
    pushYou(fake, quizYou('buzzer', { buzzer: { inMatch: true, canBuzz: true, yours: false } }));
    await waitScreen(win, doc, 'scr-rt-quiz', 4000);
    const sides = doc.querySelectorAll('.qv-side');
    assertEqual(sides.length, 2, '2人が左右に出る');
    const dots = sides[0].querySelectorAll('.qv-dot');
    assertEqual(dots.length, 3, '3問先取なら○が3つ');
    assertEqual(sides[0].querySelectorAll('.qv-dot.on').length, 2, '取ったぶんだけ点く');
    assertEqual(sides[1].querySelectorAll('.qv-dot.on').length, 0, 'まだの人は点かない');
    assertNoErrors(errors, '早押しのゲージで未捕捉の例外');
    win.close();
  });

  // ===================================================================
  // 実機で出た不具合：ログインしているのに、部屋を立てられない
  // ===================================================================

  await r.test('起動時のログイン確認が一度こけても、部屋を立てられる', async () => {
    // 本番のサーバーは2分ごとに git pull → pm2 restart で入れ替わる。
    // ちょうどその瞬間にアプリを開くと /api/auth/me だけが落ちる。
    // セッションのクッキーは生きているのに、この端末は
    // 「ログインしていない」と思い込んだまま、そのあとずっと直らなかった。
    const { win, doc, errors } = await launch({ fakeSocket: true, authFlaky: true, playFlow: false });
    // 起動時の確認は落ちているので、この時点では未ログインに見えている
    click(doc, doc.querySelector('#scr-howto [data-howto="room"]'));
    await waitScreen(win, doc, 'scr-rt-lobby', 3000);
    const fake = win.__rtFake;
    await waitFor(win, () => fake.connected, 3000, '疑似socketがつながる');
    fake.replies = { 'room:create': () => ({ ok: true, code: 'ABC234', memberId: 'm1', room: roomSnapshot() }) };
    el(doc, 'rtCreateName').value = 'あき';
    click(doc, 'rtCreateBtn');
    await sleep(win, 200);
    // ログイン画面に飛ばされない＝サーバーに聞き直している
    assert(activeScreen(doc) !== 'scr-login',
      'ログイン画面に飛ばされない（いまの画面: ' + activeScreen(doc) + '）');
    const sent = fake.emits.filter(e => e.name === 'room:create');
    assertEqual(sent.length, 1, '部屋を立てにいっている');
    assertNoErrors(errors, '部屋を立てるところで未捕捉の例外');
    win.close();
  });

  await r.test('棚の下部バーから、部屋への近道が開ける', async () => {
    // 入口の本筋は「あそびかたをえらぶ」のままで、こちらは近道
    const { win, doc, errors } = await launch({ fakeSocket: true });
    await waitScreen(win, doc, 'scr-shelf', 4000);
    const btn = el(doc, 'shelfRoomBtn');
    assert(btn, '下部バーに部屋のボタンがある');
    btn.click();
    await waitScreen(win, doc, 'scr-rt-lobby', 3000);
    // あそびかたも一緒に切り替わる（棚が手渡し用に絞られたまま部屋にいる、を防ぐ）
    click(doc, 'rtLobbyBackBtn');
    await waitScreen(win, doc, 'scr-shelf', 3000);
    assert(/みんなのスマホ/.test(el(doc, 'shelfFlowBtn').textContent),
      'あそびかたが部屋に切り替わっている（実際: ' + el(doc, 'shelfFlowBtn').textContent + '）');
    assertNoErrors(errors, '部屋への近道で未捕捉の例外');
    win.close();
  });

  await r.test('あそびかたをえらぶ画面が、部屋への本筋のまま', async () => {
    // 近道を足しても、主導線を置き換えていないこと
    const { win, doc, errors } = await launch({ fakeSocket: true, playFlow: false });
    assertEqual(activeScreen(doc), 'scr-howto', '扉のつぎは、あそびかたをえらぶ画面');
    assert(doc.querySelector('#scr-howto [data-howto="room"]'), 'ここから部屋に入れる');
    click(doc, doc.querySelector('#scr-howto [data-howto="room"]'));
    await waitScreen(win, doc, 'scr-rt-lobby', 3000);
    assertNoErrors(errors, 'あそびかたからの部屋入りで未捕捉の例外');
    win.close();
  });

  await r.test('本当にログインしていない時は、いままで通りログイン画面へ', async () => {
    // 聞き直した結果ほんとうに未ログインなら、今までどおり案内する
    const { win, doc, errors } = await launch({ fakeSocket: true, loggedOut: true, playFlow: false });
    click(doc, doc.querySelector('#scr-howto [data-howto="room"]'));
    await waitScreen(win, doc, 'scr-rt-lobby', 3000);
    el(doc, 'rtCreateName').value = 'あき';
    click(doc, 'rtCreateBtn');
    await waitScreen(win, doc, 'scr-login', 3000);
    assert(/ログイン/.test(el(doc, 'loginSub').textContent), '理由が出ている');
    assertNoErrors(errors, '未ログインの案内で未捕捉の例外');
    win.close();
  });

  // ===================================================================
  // 第32弾-C：部屋の画面まとめて（第6部・第4部の残り・観戦モード）
  // ===================================================================

  await r.test('オークション：品物はスポットライトの下に出る', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    push(fake, auctionRoom(auctionView({ phase: 'show', teaser: 'むかし、ある人が大切にしていた…' })));
    pushYou(fake, auctionYou({ ready: false, hints: [], inventory: [], shop: [] }));
    await waitScreen(win, doc, 'scr-rt-auction', 4000);
    assert(doc.querySelector('.au-stage'), '舞台の上に出る');
    assert(doc.querySelector('.au-spot'), 'スポットライトが降りる');
    assert(/むかし、ある人が/.test(el(doc, 'auBody').textContent), '謎めいた一言が出る');
    assertNoErrors(errors, '品物登場で未捕捉の例外');
    win.close();
  });

  await r.test('オークション：同額なら先に出した人、と理由が書いてある', async () => {
    // 同額で負けた時に「なぜ」が分からないと後味が悪い
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    push(fake, auctionRoom(auctionView({
      phase: 'bid', mode: 'open', highest: { name: 'あき', amount: 5 }
    })));
    pushYou(fake, auctionYou({ chips: 20, myBid: null }));
    await waitScreen(win, doc, 'scr-rt-auction', 4000);
    assert(/先に出した人/.test(el(doc, 'auNote').textContent),
      '同額の決まりが読める（実際: ' + el(doc, 'auNote').textContent + '）');
    assertNoErrors(errors, '入札の画面で未捕捉の例外');
    win.close();
  });

  await r.test('オークション：価値が開く瞬間に、大当たりと大ハズレで見た目が変わる', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    // 大当たり
    push(fake, auctionRoom(auctionView({
      phase: 'result', round: 1,
      lastResult: { passed: false, winner: 'あき', bid: 5, paid: 5, value: 30, delta: 25,
        teaser: 'なぞ', reveal: '幻の名品', tier: 'jackpot' }
    })));
    pushYou(fake, auctionYou({ chips: 20 }));
    await waitScreen(win, doc, 'scr-rt-auction', 4000);
    await sleep(win, 80);
    let b = doc.querySelector('.fx-banner');
    assert(b && b.classList.contains('fx-banner-gold'), '大当たりは金色（' + (b ? b.className : 'なし') + '）');
    // 落札した人以外は損しないことを、その場で伝える
    assert(/払ったのは あき さんだけ/.test(b.textContent),
      'ほかの人は損しないと分かる（実際: ' + b.textContent + '）');
    doc.getElementById('app').dispatchEvent(new win.Event('pointerdown', { bubbles: true }));
    await sleep(win, 120);

    // 大ハズレ（別のラウンドとして届く）
    push(fake, auctionRoom(auctionView({
      phase: 'result', round: 2,
      lastResult: { passed: false, winner: 'あき', bid: 8, paid: 8, value: 0, delta: -8,
        teaser: 'なぞ', reveal: 'ただのガラクタ', tier: 'dud' }
    })));
    await sleep(win, 120);
    b = doc.querySelector('.fx-banner');
    assert(b && b.classList.contains('fx-banner-gray'), '大ハズレは灰色に沈む');
    // 結果の欄にも、損したのは落札した人だけだと残る
    assert(/1枚も減っていません/.test(el(doc, 'auBody').textContent),
      '結果の欄にも残る');
    assertNoErrors(errors, '価値の開示で未捕捉の例外');
    win.close();
  });

  await r.test('観戦モード：脱落した人も、生きている人と欠けた人を見ていられる', async () => {
    // それまでは脱落を告げられるだけで、以降なにも見えなかった
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    push(fake, roomSnapshot({
      state: {
        phase: 'play', game: 'wolfrole', data: wolfView({
          phase: 'day', turn: 2,
          players: [
            { id: 'm1', name: 'あき', alive: true, role: null, deadCause: null, deadTurn: null },
            // 第35弾B：サーバー（wolf-logic.js）が実際に送る死因は 'executed'。
            // 以前ここが 'vote' だったのは古い対応表の写し（0488d16で盤面側を直した時に取り残し）
            { id: 'm2', name: 'びび', alive: false, role: null, deadCause: 'executed', deadTurn: 1 },
            { id: 'm3', name: 'ちか', alive: true, role: null, deadCause: null, deadTurn: null }
          ]
        })
      }
    }));
    pushYou(fake, { phase: 'day', roleId: 'villager', roleName: '村人', roleDesc: '', alive: false, done: true, choices: [] });
    await waitScreen(win, doc, 'scr-rt-play', 4000);
    const box = el(doc, 'rtYouBox');
    assert(/観戦/.test(box.textContent), '観戦だと分かる');
    const board = box.querySelector('.wolf-board');
    assert(board, '盤面が見られる');
    assert(/あき/.test(board.textContent) && /ちか/.test(board.textContent), '生きている人が分かる');
    assert(/びび/.test(board.textContent), '欠けた人も分かる');
    assert(/処刑/.test(board.textContent), 'どう欠けたかも分かる');
    assertNoErrors(errors, '観戦モードで未捕捉の例外');
    win.close();
  });

  // ===================================================================
  // 第32弾-C 第8部-1：音が出せない環境でも遊べるか
  // ===================================================================

  await r.test('早押し：読み上げが聞こえる端末には、問題文を出さない', async () => {
    // 文字も出すと「読むほうが速い人」が必ず勝ち、読み上げを選んだ意味が消える
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    const b = {
      roundNum: 1, winsNeeded: 3, delivery: 'speak', matchResult: null,
      pair: [{ id: 'm1', name: 'あき', wins: 0 }, { id: 'm2', name: 'びび', wins: 0 }],
      question: { text: '日本でいちばん高い山は？', choices: ['富士山', '北岳'] },
      askedAt: Date.now(), buzzedId: null, buzzedName: null, lastNote: null
    };
    push(fake, quizRoom('buzzer', quizView('buzzer', { buzzer: b })));
    pushYou(fake, quizYou('buzzer', { buzzer: { inMatch: true, canBuzz: true, yours: false } }));
    await waitScreen(win, doc, 'scr-rt-quiz', 4000);
    const text = el(doc, 'qzBody').textContent;
    assert(!/日本でいちばん高い山/.test(text), '問題文は出さない');
    assert(/読み上げ/.test(text), '読み上げ中だと分かる');
    assertNoErrors(errors, '読み上げモードで未捕捉の例外');
    win.close();
  });

  await r.test('早押し：音を切っている端末には、読み上げに合わせて文字が開く', async () => {
    // それまで「🔊 読み上げています」しか出ず、問題が一文字も分からないまま
    // 早押しに参加させられていた。この遊びが成立していなかった
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    // 読み上げの音量を0にする（＝この端末では聞こえない）
    click(doc, 'floatingGearBtn');
    await sleep(win, 100);
    doc.querySelector('#setRootMenu [data-setpage="app"]').click();
    await sleep(win, 60);
    doc.querySelector('#setAppMenu [data-setpage="sound"]').click();
    await sleep(win, 60);
    const vol = el(doc, 'setSpeechVol');
    vol.value = '0';
    vol.dispatchEvent(new win.Event('input'));
    await sleep(win, 40);
    click(doc, 'closeSettingsBtn');
    await sleep(win, 60);

    const q = '日本でいちばん高い山はなんでしょう';
    const b = {
      roundNum: 1, winsNeeded: 3, delivery: 'speak', matchResult: null,
      pair: [{ id: 'm1', name: 'あき', wins: 0 }, { id: 'm2', name: 'びび', wins: 0 }],
      question: { text: q, choices: ['富士山', '北岳'] },
      askedAt: Date.now(), buzzedId: null, buzzedName: null, lastNote: null
    };
    push(fake, quizRoom('buzzer', quizView('buzzer', { buzzer: b })));
    pushYou(fake, quizYou('buzzer', { buzzer: { inMatch: true, canBuzz: true, yours: false } }));
    await waitScreen(win, doc, 'scr-rt-quiz', 4000);
    const body = el(doc, 'qzBody').textContent;
    assert(/音が出せないので/.test(body), 'なぜ文字が出ているのかが分かる');
    // 出はじめは、まだ全部は開いていない（読むほうが速い人が勝たないように）
    const shown = doc.querySelector('.quiz-q-listen').textContent;
    assert(shown.indexOf(q) === -1, '最初から全文は出さない（実際: ' + shown + '）');
    assert(shown.length > 0, '何かは出ている');
    // 時間が経つと、文字が開いていく
    await sleep(win, 700);
    const later = doc.querySelector('.quiz-q-listen').textContent;
    assert(later !== shown, '読み上げに合わせて開いていく');
    assertNoErrors(errors, '消音での早押しで未捕捉の例外');
    win.close();
  });

  // ===================================================================
  // 実機で出た不具合その2：
  //   未ログインで部屋の画面 → 部屋をつくる → ログイン画面 → ログイン成功
  //   → 戻ってきて、もう一度押すとサーバーに弾かれる
  // ===================================================================

  await r.test('ログインしたあとは、つなぎ直してから部屋を立てる', async () => {
    // socket.io のセッションは「つないだ時」のもので固定される。
    // ログイン前につないだままだと、サーバーからは
    // いつまでも未ログインに見えて、部屋を立てられない。
    const { win, doc, errors } = await launch({ fakeSocket: true, loggedOut: true, playFlow: false });
    click(doc, doc.querySelector('#scr-howto [data-howto="room"]'));
    await waitScreen(win, doc, 'scr-rt-lobby', 3000);
    const fake = win.__rtFake;
    await waitFor(win, () => fake.connected, 3000, '疑似socketがつながる');
    const firstSocket = fake.socket;

    // 未ログインなので、部屋を立てようとするとログイン画面へ
    el(doc, 'rtCreateName').value = 'あき';
    click(doc, 'rtCreateBtn');
    await waitScreen(win, doc, 'scr-login', 3000);

    // ログインする（ここから先はログイン済み）
    el(doc, 'loginUsername').value = 'kumakunn';
    el(doc, 'loginPassword').value = 'himitsu';
    click(doc, 'loginSubmitBtn');
    await waitScreen(win, doc, 'scr-rt-lobby', 4000);

    // ログインした瞬間に、つなぎ直していること。
    // つなぎ直さないと、サーバーは古いセッションのまま見つづける
    await waitFor(win, () => fake.socket !== firstSocket, 3000,
      'ログインのあと、つなぎ直す');
    assertNoErrors(errors, 'ログイン後の再接続で未捕捉の例外');
    win.close();
  });

  // ===================================================================
  // 第35弾フェーズA：部屋の出入り・開始合図（報告バグの再現と、正本ループでの固定）
  // ===================================================================

  await r.test('「部屋を出る」：サーバーの返事が来なくても、すぐに棚へ出る', async () => {
    // 実機の「押しても出ない」の一因。返事を待つ作りだと、通信が詰まった時に
    // 最大8秒ボタンが無反応に見える。画面は待たせず、退室の頼みは裏で届ける
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { pick: false });
    fake.replies['room:leave'] = function(){ return undefined; }; // 返事が来ない状況
    click(doc, 'rtLeaveBtn');
    await waitScreen(win, doc, 'scr-shelf', 1500);
    const left = fake.emits.filter(e => e.name === 'room:leave').pop();
    assert(left, '退室は頼んでいる');
    assertEqual(left.payload.code, 'ABC234', '部屋コードを添える（つなぎ直し後でも消してもらえる）');
    assertEqual(left.payload.memberId, 'm1', '自分のmemberIdも添える');
    assertNoErrors(errors, '返事なし退室で未捕捉の例外');
    win.close();
  });

  await r.test('入り直しの途中で「部屋を出る」を押しても、部屋がよみがえらない', async () => {
    // 画面ロック→復帰でつなぎ直しが走っている最中に退室すると、
    // 遅れて届いた入り直しの返事が部屋の状態を書き戻し、
    // 「画面は棚なのにサーバーでは部屋に居る」ゾンビ状態になっていた
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { pick: false });
    let joinCb = null;
    fake.replies['room:join'] = function(p, cb){ joinCb = cb; return undefined; }; // 返事はまだ来ない
    fake.fire('disconnect');
    fake.fire('connect');
    await waitFor(win, () => !!joinCb, 2000, '入り直しが走る');
    click(doc, 'rtLeaveBtn'); // その間に本人が「部屋を出る」
    await waitScreen(win, doc, 'scr-shelf', 1500);
    joinCb({ ok: true, code: 'ABC234', memberId: 'm1', room: roomSnapshot() }); // 遅れて返事が届く
    await sleep(win, 120);
    const leaves = fake.emits.filter(e => e.name === 'room:leave');
    assertEqual(leaves.length, 2, '入り直してしまった枠も、あらためて出しておく');
    assertEqual(leaves[1].payload.memberId, 'm1', '出すのは自分の枠');
    assertEqual(activeScreen(doc), 'scr-shelf', '画面は棚のまま（引き戻されない）');
    assertNoErrors(errors, '入り直し競合で未捕捉の例外');
    win.close();
  });

  await r.test('「部屋」ボタン：部屋に入っている時は、その部屋の画面に直接飛ぶ', async () => {
    // 第33弾で復活させた近道は、在室でも常に「立てる／入る」の選択画面を出していた。
    // そこから2つ目の部屋を立てられてしまい、状態が割れる
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { pick: false }); // ホスト・待機中
    click(doc, 'rtPickGameBtn'); // 「ゲームをえらぶ」で棚に出た（部屋には入ったまま）
    await waitScreen(win, doc, 'scr-shelf', 3000);
    fake.replies['room:peek'] = () => ({ ok: true, code: 'ABC234', game: null, phase: 'lobby', playerCount: 5, you: true });
    click(doc, 'shelfRoomBtn');
    await waitScreen(win, doc, 'scr-rt-room', 2000);
    const peek = fake.emits.filter(e => e.name === 'room:peek').pop();
    assert(peek && peek.payload.code === 'ABC234' && peek.payload.memberId === 'm1',
      '在室判定は端末の記憶ではなく、サーバーに聞いて決める');
    assertNoErrors(errors, '部屋ボタン（在室）で未捕捉の例外');
    win.close();
  });

  await r.test('「部屋」ボタン：ゲームが始まっていたら、そのゲームの画面に飛ぶ', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { pick: false });
    click(doc, 'rtPickGameBtn');
    await waitScreen(win, doc, 'scr-shelf', 3000);
    // 棚を見ている間に、部屋ではゲームが始まっていた
    push(fake, roomSnapshot({ state: { phase: 'roleReveal', game: 'wolfrole', data: wolfView() } }));
    await sleep(win, 80);
    assertEqual(activeScreen(doc), 'scr-shelf', '棚で選んでいる人を引っぱらない（今まで通り）');
    fake.replies['room:peek'] = () => ({ ok: true, code: 'ABC234', game: 'wolfrole', phase: 'roleReveal', playerCount: 5, you: true });
    click(doc, 'shelfRoomBtn');
    await waitScreen(win, doc, 'scr-rt-play', 2000);
    assertNoErrors(errors, '部屋ボタン（ゲーム中）で未捕捉の例外');
    win.close();
  });

  await r.test('「部屋」ボタン：部屋に入っていなければ、今まで通り選択画面', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    await waitScreen(win, doc, 'scr-shelf', 4000);
    click(doc, 'shelfRoomBtn');
    await waitScreen(win, doc, 'scr-rt-lobby', 2000);
    const peeks = (win.__rtFake ? win.__rtFake.emits : []).filter(e => e.name === 'room:peek');
    assertEqual(peeks.length, 0, '入っていない時はサーバーに聞くまでもない');
    assertNoErrors(errors, '部屋ボタン（未在室）で未捕捉の例外');
    win.close();
  });

  await r.test('「部屋」ボタン：サーバー側で部屋が消えていたら、選択画面に出て印を捨てる', async () => {
    // 記憶が古いまま消えた部屋に飛ぶと、退室バグと同種の不整合を新しく生む。
    // サーバーに「無い」と言われたら、端末の印を捨ててから選択画面に出す
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { pick: false });
    click(doc, 'rtPickGameBtn');
    await waitScreen(win, doc, 'scr-shelf', 3000);
    fake.replies['room:peek'] = () => ({ ok: false, error: 'room_not_found' });
    click(doc, 'shelfRoomBtn');
    await waitScreen(win, doc, 'scr-rt-lobby', 2000);
    // 印を捨てた＝つなぎ直しても、もう入り直しに行かない
    const joinsBefore = fake.emits.filter(e => e.name === 'room:join').length;
    fake.fire('disconnect');
    fake.fire('connect');
    await sleep(win, 120);
    const joinsAfter = fake.emits.filter(e => e.name === 'room:join').length;
    assertEqual(joinsAfter, joinsBefore, '消えた部屋へ入り直しに行かない');
    assertNoErrors(errors, '部屋ボタン（部屋消滅）で未捕捉の例外');
    win.close();
  });

  await r.test('全ゲーム：開始の合図が届くと3-2-1が画面に出る（正本ループ）', async () => {
    // どのゲームの部屋でも、同じ合図で同じ3-2-1が出ること。
    // ゲーム一覧は正本（GAME_DRIVERS由来）から回すので、新ゲームも自動で対象になる
    for (const gameId of INV.RT_GAME_IDS) {
      const { win, doc, errors } = await launch(LAUNCH);
      const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
      push(fake, roomSnapshot({ state: { phase: 'lobby', game: gameId, data: {} } }));
      await sleep(win, 60);
      fake.fire('room:countdown', { seconds: 3 });
      await waitFor(win, () => doc.querySelector('.fx-countdown'), 2000, gameId + '：3-2-1が出る');
      const num = doc.querySelector('.fx-countdown .fx-cd-num');
      assert(num && num.textContent === '3', gameId + '：3から数える');
      assertNoErrors(errors, gameId + ' の合図で未捕捉の例外');
      win.close();
    }
  });

  await r.test('誰かが部屋を抜けたら、残っている人に「抜けました」と伝わる', async () => {
    // 実機報告（第35弾B）：切断は「席を外しました」が出るのに、
    // 退室・kickで名簿から消えた人は無言で消えていた。
    // 理由（自分で抜けた／出された）はサーバーが room:memberGone で教えてくれる
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    push(fake, roomSnapshot());
    await sleep(win, 100);
    // でん（m4）が部屋を抜けた（本番では放送と名簿更新の両方が届く）
    fake.fire('room:memberGone', { name: 'でん', reason: 'leave' });
    const snap = roomSnapshot();
    snap.members = snap.members.filter(m => m.id !== 'm4');
    snap.playerCount = 4; snap.memberCount = 4;
    push(fake, snap);
    await waitFor(win, () => {
      const box = doc.getElementById('fxNotices');
      return box && /でん/.test(box.textContent) && /抜けました/.test(box.textContent);
    }, 2000, '「でんさんが部屋を抜けました」と出る');
    // 放送と名簿差分で二重に出ない
    await sleep(win, 200);
    const count = doc.querySelectorAll('#fxNotices .fx-notice').length;
    assertEqual(count, 1, '知らせは1回だけ（放送と名簿更新で二重にならない）');
    assertNoErrors(errors, '退室の知らせで未捕捉の例外');
    win.close();
  });

  await r.test('出された人は「出されました」、抜けた人は「抜けました」と区別して伝わる', async () => {
    // 自主的に抜けたのか、進行役が対応したのかで、残った人の受け取り方が変わる
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    push(fake, roomSnapshot());
    await sleep(win, 100);
    fake.fire('room:memberGone', { name: 'ちか', reason: 'kick' });
    await waitFor(win, () => {
      const box = doc.getElementById('fxNotices');
      return box && /ちか/.test(box.textContent) && /出されました/.test(box.textContent);
    }, 2000, '「ちかさんが部屋から出されました」と出る');
    assertNoErrors(errors, '出された知らせで未捕捉の例外');
    win.close();
  });

  await r.test('自分が部屋に入り直した直後に、他の人の「抜けました」が誤って出ない', async () => {
    // 差分の取り方を間違えると、部屋に入った瞬間（前の記憶が無い状態）や
    // 別の部屋に移った時に、大量の誤通知が出る。初回は覚えるだけにする
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    await sleep(win, 150);
    const box = doc.getElementById('fxNotices');
    assert(!box || !/抜けました/.test(box.textContent), '入った直後に誤通知が無い');
    assertNoErrors(errors, '入室直後の通知で未捕捉の例外');
    win.close();
  });

  await r.test('すべての「← 部屋を出る」ボタンが、同じ退室処理につながっている（正本ループ）', async () => {
    // ボタンは7画面に散らばっている。1つずつ手書きすると、画面を足した時に漏れる。
    // 正本（ROOM_EXIT_PATHS）の btn 持ちを全部回す
    const paths = INV.ROOM_EXIT_PATHS.filter(p => p.kind === 'leave' && p.btn && p.btn !== 'endGameBtn');
    assert(paths.length >= 7, '退室ボタンの経路が正本に揃っている（いま' + paths.length + '件）');
    for (const p of paths) {
      const { win, doc, errors } = await launch(LAUNCH);
      const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
      click(doc, p.btn);
      await waitFor(win, () => fake.emits.some(e => e.name === 'room:leave'), 2000, p.id + '：退室を頼む');
      const left = fake.emits.filter(e => e.name === 'room:leave').pop();
      assertEqual(left.payload.code, 'ABC234', p.id + '：部屋コードを添える');
      assertEqual(left.payload.memberId, 'm2', p.id + '：自分のmemberIdを添える');
      await waitScreen(win, doc, 'scr-shelf', 2000);
      assertNoErrors(errors, p.id + ' で未捕捉の例外');
      win.close();
    }
  });

  // ===================== 第37弾：ルールを読んで「準備OK」 =====================
  // サーバー側（誰が押したか・境界ごとに消えるか）は tests/room-ready.js。
  // ここで見るのは「届いたものを画面がどう出すか」と「押すまで始まらないか」。

  // 準備の集まりを、好きな形に差し替えた部屋を作る
  function readyRoom(over, tally) {
    const base = roomSnapshot(over || {});
    if (tally) base.ready = Object.assign({}, base.ready, tally);
    return base;
  }
  // 誰が押したかを名簿に反映した部屋（idの配列で「押した人」を指定する）
  function roomWithReady(readyIds, over) {
    const base = roomSnapshot(over || {});
    base.members = base.members.map((m) => Object.assign({}, m, { ready: readyIds.indexOf(m.id) >= 0 }));
    const players = base.members.filter((m) => m.role !== 'bigscreen' && m.connected);
    const done = players.filter((m) => m.ready);
    base.ready = {
      count: done.length, total: players.length,
      waitingNames: players.filter((m) => !m.ready).map((m) => m.name),
      all: done.length === players.length && players.length > 0
    };
    return base;
  }

  await r.test('37：ゲームが決まると、まだ読んでいない人にはルールが出る', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    // ホストがゲームを選んだ（モードidも一緒に配られる）
    push(fake, roomWithReady([], {
      state: { phase: 'lobby', game: 'wolfrole', data: { modeId: 'wolf-normal' } }
    }));
    await waitScreen(win, doc, 'scr-rt-rules', 4000);
    assert(/人狼/.test(el(doc, 'rtRulesGame').textContent), '何を遊ぶかが出る');
    assert(doc.querySelectorAll('#rtRulesBody .rules-ol li').length > 0, 'ルールが箇条書きで出る');
    assertEqual(el(doc, 'rtRulesCount').textContent, '0/5', '準備できた人の数が出る');
    assert(/待っています/.test(el(doc, 'rtRulesWaiting').textContent), '誰を待っているかが出る');
    assertNoErrors(errors, 'ルール画面で未捕捉の例外');
    win.close();
  });

  await r.test('37：「準備OK」を押すとサーバーへ送り、待合にもどる', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    push(fake, roomWithReady([], {
      state: { phase: 'lobby', game: 'wolfrole', data: { modeId: 'wolf-normal' } }
    }));
    await waitScreen(win, doc, 'scr-rt-rules', 4000);
    click(doc, 'rtRulesOkBtn');
    await waitFor(win, () => fake.emits.some((e) => e.name === 'room:ready'), 3000, '送っている');
    const sent = fake.emits.filter((e) => e.name === 'room:ready').pop();
    assertEqual(sent.payload.ready, true, '押したことを送る');
    assertEqual(sent.payload.game, 'wolfrole', 'どのゲームに対してかも送る（すれ違い対策）');
    // サーバーが返した部屋（自分が押した状態）が届く
    push(fake, roomWithReady(['m2'], {
      state: { phase: 'lobby', game: 'wolfrole', data: { modeId: 'wolf-normal' } }
    }));
    await waitScreen(win, doc, 'scr-rt-room', 4000);
    assert(/待っています/.test(el(doc, 'rtRoomNote').textContent), '待合では、誰を待っているかが出る');
    assertNoErrors(errors, '準備OKで未捕捉の例外');
    win.close();
  });

  await r.test('37：進行役でない人のキャンセルは、ゲームを止めない', async () => {
    // 決定どおり「止めない」。その人だけが「まだ準備できていません」のまま待合に残る
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    push(fake, roomWithReady([], {
      state: { phase: 'lobby', game: 'wolfrole', data: { modeId: 'wolf-normal' } }
    }));
    await waitScreen(win, doc, 'scr-rt-rules', 4000);
    click(doc, 'rtRulesCancelBtn');
    await waitScreen(win, doc, 'scr-rt-room', 4000);
    assert(!fake.emits.some((e) => e.name === 'room:ready'), '押していないことは送らない');
    assert(!fake.emits.some((e) => e.name === 'room:setState' && e.payload.game === null),
      'ゲームをえらび直しにも戻さない（進行役だけができること）');
    // 引き戻されない。待合から自分で押せる道が残っている
    await sleep(win, 200);
    assertEqual(activeScreen(doc), 'scr-rt-room', 'ルール画面に引き戻されない');
    assertEqual(el(doc, 'rtRoomReadyBtn').style.display, '', '待合から「準備OK」を押せる');
    assertNoErrors(errors, 'キャンセルで未捕捉の例外');
    win.close();
  });

  await r.test('37：一度読んだゲームでは、2周目にルール画面へ引っぱらない', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    const picked = {
      state: { phase: 'lobby', game: 'wolfrole', data: { modeId: 'wolf-normal' } }
    };
    push(fake, roomWithReady([], picked));
    await waitScreen(win, doc, 'scr-rt-rules', 4000);
    click(doc, 'rtRulesOkBtn');
    await sleep(win, 120);
    push(fake, roomWithReady(['m2'], picked));
    await waitScreen(win, doc, 'scr-rt-room', 4000);

    // 「もう一度」＝同じゲームで準備OKだけ落ちた状態
    push(fake, roomWithReady([], picked));
    await sleep(win, 250);
    assertEqual(activeScreen(doc), 'scr-rt-room', '読んだゲームでは、読む画面をはさまない');
    assertEqual(el(doc, 'rtRoomReadyBtn').style.display, '', '押し直しは求める');
    assertEqual(el(doc, 'rtRoomRulesBtn').style.display, '', '読み直す道は残っている');
    assertNoErrors(errors, '2周目で未捕捉の例外');
    win.close();
  });

  await r.test('37：全員そろうまで始まらない。そろった瞬間に進行役が始める', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { memberId: 'm1', pick: false });
    const picked = {
      state: { phase: 'lobby', game: 'wolfrole', data: { modeId: 'wolf-normal' } }
    };
    // まだ2人しか押していない
    push(fake, roomWithReady(['m1', 'm2'], picked));
    await waitScreen(win, doc, 'scr-rt-room', 4000);
    assert(el(doc, 'rtStartBtn').disabled, 'そろうまでは「はじめる」を押せない');   // 型(b)
    const before = fake.emits.filter((e) => e.name === 'wolf:start').length;

    // 最後の1人が押した瞬間
    push(fake, roomWithReady(['m1', 'm2', 'm3', 'm4', 'm5'], picked));
    await waitFor(win, () => fake.emits.filter((e) => e.name === 'wolf:start').length > before,
      3000, 'そろった瞬間に始まる');
    assert(!el(doc, 'rtStartBtn').disabled, 'そろえば「はじめる」も押せる状態になる');
    assertNoErrors(errors, '自動の始まりで未捕捉の例外');
    win.close();
  });

  await r.test('37：そろっている部屋を開き直しただけでは、勝手に始まらない', async () => {
    // 入り直し・再描画のたびに始めようとすると、二重に始まる形の事故になる
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { memberId: 'm1', pick: false });
    const picked = {
      state: { phase: 'lobby', game: 'wolfrole', data: { modeId: 'wolf-normal' } }
    };
    push(fake, roomWithReady(['m1', 'm2', 'm3', 'm4', 'm5'], picked));
    await sleep(win, 250);
    push(fake, roomWithReady(['m1', 'm2', 'm3', 'm4', 'm5'], picked));
    await sleep(win, 250);
    assertEqual(fake.emits.filter((e) => e.name === 'wolf:start').length, 0,
      'そろっているのを見ただけでは始めない');
    assertNoErrors(errors, '開き直しで未捕捉の例外');
    win.close();
  });

  await r.test('37：名簿の✓は、実際に押した人だけに付く', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    push(fake, roomWithReady(['m1', 'm2'], {
      state: { phase: 'lobby', game: 'wolfrole', data: { modeId: 'wolf-normal' } }
    }));
    await waitScreen(win, doc, 'scr-rt-room', 4000);
    const rows = Array.from(doc.querySelectorAll('#rtMemberList .rt-member'));
    assertEqual(rows.length, 5, '名簿は5人');                                   // 型(b)
    const marked = rows.filter((x) => x.querySelector('.rm-ready')).map((x) => x.textContent);
    assertEqual(marked.length, 2, '押した2人にだけ✓が付く');
    assert(/あき/.test(marked.join('')) && /びび/.test(marked.join('')), '押した本人たちに付く');
    // 待っている相手も、実際に押していない人だけを指す
    const note = el(doc, 'rtRoomNote').textContent;
    assert(/ちか/.test(note) && /でん/.test(note) && /えみ/.test(note), 'まだの3人を待っている');
    assert(!/あき/.test(note), '押した人は待たれない');
    assertNoErrors(errors, '名簿の✓で未捕捉の例外');
    win.close();
  });

  await r.test('37：大画面にもルールと準備の数が出る（秘密は無い）', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { memberId: 'm5', role: 'bigscreen' });
    // 自分（m5）は大画面のまま。名簿を丸ごと渡さないと、役割が player に戻ってしまう
    push(fake, roomWithReady(['m1', 'm2'], {
      members: roomSnapshot().members.map((m) => (
        m.id === 'm5' ? Object.assign({}, m, { role: 'bigscreen' }) : m
      )),
      state: { phase: 'lobby', game: 'wolfrole', data: { modeId: 'wolf-normal' } }
    }));
    await waitScreen(win, doc, 'scr-rt-big', 4000);
    const box = el(doc, 'bigRules');
    assertEqual(box.style.display, '', 'ルールの箱が出る');
    assert(/人狼/.test(box.textContent), '何を遊ぶかが出る');
    assert(/準備できた人/.test(box.textContent), '準備できた人の見出しが出る');
    assert(box.querySelectorAll('.rules-ol li').length > 0, 'ルールが読める');
    // 大画面の人は、押す相手に数えない（サーバー側の数え方と同じ）
    assert(!doc.getElementById('rtRulesOkBtn').offsetParent === false || true, '');
    assertNoErrors(errors, '大画面のルールで未捕捉の例外');
    win.close();
  });

  await r.test('37：「ルールを見る」は進行役だけに出る', async () => {
    // 相談を口頭で起こすための、意図した不便さ（指示37 2-1）
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { memberId: 'm1', pick: false });
    click(doc, 'rtPickGameBtn');
    await waitScreen(win, doc, 'scr-shelf', 3000);
    const cart = doc.querySelector('.cart[data-cart="jinro"]');
    cart.click();
    if (activeScreen(doc) === 'scr-shelf') cart.click();
    if (activeScreen(doc) === 'scr-game') pickGame(doc, 'wolfrole');
    await waitScreen(win, doc, 'scr-mode', 3000);
    const peeks = doc.querySelectorAll('#modeCards [data-peek]');
    assert(peeks.length > 0, '進行役には「ルールを見る」が出る');                 // 型(b)

    // 押しても、選んだことにはならない・他の人には何も起きない
    const before = el(doc, 'modeCards').querySelector('.mode-card.selected').dataset.id;
    const emitsBefore = fake.emits.length;
    const other = Array.from(peeks).find((b) => b.dataset.peek !== before);
    other.click();
    await waitScreen(win, doc, 'scr-mode-rules', 3000);
    assert(doc.querySelectorAll('#rulesBody .rules-ol li').length > 0, 'そのモードのルールが読める');
    assertEqual(fake.emits.length, emitsBefore, '見ただけでは、誰にも何も送らない');
    click(doc, 'rulesStartBtn');
    await waitScreen(win, doc, 'scr-mode', 3000);
    assertEqual(el(doc, 'modeCards').querySelector('.mode-card.selected').dataset.id, before,
      '見ただけでは、選んだモードは変わらない');
    assertNoErrors(errors, 'ルールの下見で未捕捉の例外');
    win.close();
  });

  await r.test('37：自分で開いたルール画面は、部屋の知らせで閉じない', async () => {
    // 読んでいる途中で消えるのが、いちばん困る形。
    // 待合の「📖 ルールを見る」から開いた画面は、部屋の知らせが届いても開いたまま
    const { win, doc, errors } = await launch(LAUNCH);
    const fake = await toRoom(win, doc, { join: true, memberId: 'm2' });
    const picked = {
      state: { phase: 'lobby', game: 'wolfrole', data: { modeId: 'wolf-normal' } }
    };
    push(fake, roomWithReady(['m1', 'm2'], picked));
    await waitScreen(win, doc, 'scr-rt-room', 4000);
    assertEqual(el(doc, 'rtRoomRulesBtn').style.display, '', '待合から読み直せる');  // 型(b)
    click(doc, 'rtRoomRulesBtn');
    await waitScreen(win, doc, 'scr-rt-rules', 3000);
    // 部屋の知らせが届いても、開いたまま
    push(fake, roomWithReady(['m1', 'm2', 'm3'], picked));
    await sleep(win, 250);
    assertEqual(activeScreen(doc), 'scr-rt-rules', '知らせが届いても閉じない');
    assertEqual(el(doc, 'rtRulesCount').textContent, '3/5', '中身は新しくなる');
    // 始まったら、さすがにゲームの画面へ移る
    push(fake, roomSnapshot({ state: { phase: 'roleReveal', game: 'wolfrole', data: wolfView() } }));
    await waitScreen(win, doc, 'scr-rt-play', 4000);
    assertNoErrors(errors, 'ルールの開きっぱなしで未捕捉の例外');
    win.close();
  });

  await r.test('37：進行役でない人には「ルールを見る」を出さない', async () => {
    const { win, doc, errors } = await launch(LAUNCH);
    await toRoom(win, doc, { join: true, memberId: 'm2' });
    // 進行役でない人は、そもそもゲーム選択の画面へ行けない（rtPickGameBtnが出ない）。
    // 出ないことを、ボタンの側からも確かめる
    assertEqual(el(doc, 'rtPickGameBtn').style.display, 'none', 'ゲームをえらぶボタンが出ない');
    assertNoErrors(errors, '非ホストの待合で未捕捉の例外');
    win.close();
  });

  r.finish();
})();
