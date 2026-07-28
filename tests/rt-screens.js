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
    state: { phase: 'lobby', game: null, data: {} }
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

// モード選択 →「1人1台」→ 部屋（作成側 or 参加側）
async function toRoom(win, doc, opts) {
  opts = opts || {};
  const cart = doc.querySelector('.cart[data-cart="jinro"]');
  cart.click();
  if (activeScreen(doc) === 'scr-shelf') cart.click();
  await waitScreen(win, doc, 'scr-game', 3000);
  pickGame(doc, 'wolfrole');
  await sleep(win, 60);
  await fillPlayerForm(win, doc, ['あき', 'びび', 'ちか', 'でん', 'えみ']);
  await waitScreen(win, doc, 'scr-mode', 3000);
  click(doc, doc.querySelector('#wolfStyleSeg [data-wolfstyle="realtime"]'));
  click(doc, 'modeNextBtn');
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
  return fake;
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

  r.finish();
})();
