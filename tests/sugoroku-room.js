// tests/sugoroku-room.js — すごろくの進行役（第36弾）
//
// socket.io を立てずに確かめる。realtime.js が driver に求める約束の形
// （startGame / publicView / privateFor / submitAction / isAllDone / advance /
//  expectedMembers）は、部屋オブジェクトの形さえ合っていれば単体で回せる。
//
// ここでいちばん見たいのは **手番が止まらないこと**（落とし穴17）。
// すごろくは1人ずつ順番に動くので、手番の人が消えると全員が待ち続ける。
// 切断・退室・時間切れの3経路で、必ず次へ進むことを固定する。
//
// 出目と盤は useRandom で固定する（乱数任せのテストは、たまに落ちて信用を失う）。

const R = require('../sugoroku-room');
const S = require('../public/js/sugoroku-logic');
const { createRunner, assert, assertEqual } = require('./harness');

// 部屋の最低限の形（realtime.js が driver に渡しているもの）
function makeRoom(n) {
  const members = new Map();
  for (let i = 1; i <= n; i++) {
    members.set('p' + i, { id: 'p' + i, name: 'ひと' + i, role: 'player', connected: true });
  }
  return { code: 'TEST01', members, state: { phase: 'lobby', game: null, data: {} } };
}
// 呼ばれた順に決まった値を返す乱数
function rndSeq(values) {
  let i = 0;
  return () => values[i++ % values.length];
}
// 出目を固定する。盤は素にしたいので、効果マスの抽選が当たらない値を混ぜる
function fixDice(v) {
  R.useRandom(() => (v - 1) / 6 + 0.001);
}
// 全員が READY を押して、手番まで進める
function toFirstTurn(room) {
  room.sugoroku.playerIds.forEach((id) => R.submitAction(room, id, null, { act: 'ready' }));
  R.advance(room);
}
// 盤を素にする（効果マスの偶然で期待値がぶれないように）
function flattenBoard(room) {
  const w = room.sugoroku;
  for (let i = 1; i < w.board.length - 1; i++) w.board[i] = 'plain';
}

function start(n, cfg) {
  const room = makeRoom(n);
  const res = R.startGame(room, Object.assign({ game: 'sugotoll' }, cfg || {}));
  return { room, res };
}

(async function main() {
  const r = createRunner('sugoroku-room：すごろくの進行役');

  // つうこうりょうを遊べる状態にしてから確かめる
  // （性格表の ready は「棚に出してよいか」の印なので、テストでは立てて回す）
  const spec = S.gameById('sugotoll');
  const wasReady = spec.ready;
  spec.ready = true;

  // ---- 開始 ----

  await r.test('人数が足りない・多すぎると始まらない（両方向・落とし穴8）', async () => {
    assertEqual(start(2).res.ok, false, '3人未満では始まらない');
    assertEqual(start(3).res.ok, true, 'ちょうど下限なら始まる');
    assertEqual(start(8).res.ok, true, 'ちょうど上限なら始まる');
    assertEqual(start(9).res.ok, false, '上限を超えたら始まらない');
  });

  await r.test('まだ完成していないすごろくは始められない', async () => {
    const room = makeRoom(4);
    const res = R.startGame(room, { game: 'sugohide' });
    assertEqual(res.ok, false, '準備中のゲームは始まらない');
    assertEqual(res.error, 'not_ready', '理由が分かる');
  });

  await r.test('始まると、全員がふりだしで同じ枚数のコインを持つ', async () => {
    const { room } = start(4);
    const w = room.sugoroku;
    w.playerIds.forEach((id) => {
      assertEqual(w.pos[id], 0, 'ふりだし');
      assertEqual(w.coins[id], S.gameById('sugotoll').startCoins, '初期コイン');
    });
    assertEqual(w.phase, R.PHASE.READY, 'まず盤と持ちものの確認から');
    assertEqual(room.state.game, 'sugotoll', '部屋のゲームが記録される');
  });

  // ---- 手番 ----

  await r.test('全員が確認を押すと、手番が始まる', async () => {
    const { room } = start(4);
    const w = room.sugoroku;
    R.submitAction(room, 'p1', null, { act: 'ready' });
    assertEqual(R.isAllDone(room), false, 'まだ待っている人がいる');
    ['p2', 'p3', 'p4'].forEach((id) => R.submitAction(room, id, null, { act: 'ready' }));
    assertEqual(R.isAllDone(room), true, '全員そろった');
    R.advance(room);
    assertEqual(w.phase, R.PHASE.TURN, '手番へ');
    assert(w.deadline > Date.now(), '手番には期限がつく（考え込んで止まらないように）');
  });

  await r.test('手番でない人は振れない', async () => {
    const { room } = start(4);
    toFirstTurn(room);
    const turnId = room.sugoroku.turnId;
    const other = room.sugoroku.playerIds.find((id) => id !== turnId);
    assertEqual(R.submitAction(room, other, null, { act: 'roll' }).ok, false, '他人は振れない');
    assertEqual(R.submitAction(room, turnId, null, { act: 'roll' }).ok, true, '手番の人は振れる');
  });

  await r.test('待っているのは、手番の人ただ1人', async () => {
    const { room } = start(4);
    toFirstTurn(room);
    const exp = R.expectedMembers(room);
    assertEqual(exp.length, 1, '1人だけ');
    assertEqual(exp[0], room.sugoroku.turnId, '手番の人');
  });

  // ---- 通行料 ----

  await r.test('4位以下は無料で進める', async () => {
    const { room } = start(4);
    flattenBoard(room);
    toFirstTurn(room);
    fixDice(3);
    const w = room.sugoroku;
    const id = w.turnId;
    const before = w.coins[id];
    R.submitAction(room, id, null, { act: 'roll' });
    R.advance(room);
    assertEqual(w.last.rank, 1, '全員ふりだしなので、みんな1位');
    assertEqual(w.last.toll, 3, '1位は出目と同じ枚数');
    assertEqual(w.coins[id], before - 3, 'そのぶん減る');
    assertEqual(w.pos[id], 3, '進んでいる');
  });

  await r.test('先頭でなくなれば、通行料は下がる', async () => {
    const { room } = start(4);
    flattenBoard(room);
    toFirstTurn(room);
    const w = room.sugoroku;
    // 手番でない3人を前に出して、手番の人を最下位にする
    w.playerIds.filter((id) => id !== w.turnId).forEach((id, i) => { w.pos[id] = 20 + i; });
    fixDice(4);
    const id = w.turnId;
    const before = w.coins[id];
    R.submitAction(room, id, null, { act: 'roll' });
    R.advance(room);
    assertEqual(w.last.rank, 4, '最下位');
    assertEqual(w.last.toll, 0, '4位以下は無料');
    assertEqual(w.coins[id], before, 'コインは減らない');
  });

  await r.test('払えないと足止めになり、代わりにコインが3枚入る', async () => {
    const { room } = start(4);
    flattenBoard(room);
    toFirstTurn(room);
    const w = room.sugoroku;
    const id = w.turnId;
    w.coins[id] = 1;            // 1位なのに払えない
    fixDice(6);
    R.submitAction(room, id, null, { act: 'roll' });
    R.advance(room);
    assertEqual(w.last.stalled, true, '足止め');
    assertEqual(w.pos[id], 0, '進んでいない');
    assertEqual(w.coins[id], 1 + S.TOLL_RELIEF, '代わりにコインが入る');
    assertEqual(w.last.relief, S.TOLL_RELIEF, '何枚入ったかが結果に出る（前向きな情報を主語にできる）');
  });

  // ---- 手番が止まらないこと（落とし穴17） ----

  await r.test('手番の人が切断すると、待ち人が空になり、手番が飛ぶ', async () => {
    const { room } = start(4);
    flattenBoard(room);
    toFirstTurn(room);
    const w = room.sugoroku;
    const gone = w.turnId;
    room.members.get(gone).connected = false;
    assertEqual(R.expectedMembers(room).length, 0, '誰も待っていない状態になる');
    assertEqual(R.isAllDone(room), true, 'realtime.js が advance を呼べる形になる');
    // realtime.js の settleAfterMemberGone と同じ流れ
    R.advance(room);            // 手番を消化（サーバーが代わりに振る）
    assertEqual(w.phase, R.PHASE.RESULT, '結果へ進む');
    assertEqual(w.last.auto, true, 'サーバーが代わりに振ったことが分かる');
    R.advance(room);            // 次の人へ
    assert(w.turnId !== gone, '手番が次の人へ移った');
    assertEqual(w.phase, R.PHASE.TURN, '止まらずに続く');
  });

  await r.test('手番の人が部屋から消えると、駒を動かさずに飛ばす', async () => {
    const { room } = start(4);
    flattenBoard(room);
    toFirstTurn(room);
    const w = room.sugoroku;
    const gone = w.turnId;
    room.members.delete(gone);   // 退室・kick
    R.advance(room);
    assertEqual(w.last.skipped, true, '居ない人の駒は動かさない');
    assertEqual(w.pos[gone], 0, 'ふりだしのまま');
    R.advance(room);
    assert(w.turnId !== gone, '手番が次の人へ移った');
  });

  await r.test('消えた人の席には、二度と手番が回らない', async () => {
    const { room } = start(4);
    flattenBoard(room);
    toFirstTurn(room);
    const w = room.sugoroku;
    const gone = w.turnId;
    room.members.delete(gone);
    // 消した直後は、まだ手番がその人のまま。realtime.js の settleAfterMemberGone が
    // すぐ advance を呼ぶので、そこからが「回らない」を見るべき区間になる
    R.advance(room);
    fixDice(1);
    for (let i = 0; i < 24 && w.phase !== R.PHASE.ENDED; i++) {
      if (w.phase === R.PHASE.TURN) {
        assert(w.turnId !== gone, '消えた人に手番が戻ってきた（' + (i + 1) + '周目）');
        R.submitAction(room, w.turnId, null, { act: 'roll' });
      }
      R.advance(room);
    }
    assertEqual(w.goalOrder[gone], undefined, '消えた人はあがらない');
  });

  await r.test('時間切れでも、サーバーが振って先へ進む', async () => {
    const { room } = start(4);
    flattenBoard(room);
    toFirstTurn(room);
    const w = room.sugoroku;
    fixDice(2);
    // 見回り（realtime.js）が期限切れを見つけて advance を呼ぶのと同じ
    w.deadline = Date.now() - 1;
    R.advance(room);
    assertEqual(w.last.auto, true, '押していないので、サーバーが振った');
    assert(w.last.move, '駒は動いている（置いていかれない）');
  });

  await r.test('あがった人には、もう手番が回らない', async () => {
    const { room } = start(4);
    flattenBoard(room);
    toFirstTurn(room);
    const w = room.sugoroku;
    const first = w.turnId;
    w.pos[first] = S.gameById('sugotoll').cells - 1;
    w.coins[first] = 99;
    fixDice(6);
    R.submitAction(room, first, null, { act: 'roll' });
    R.advance(room);
    assertEqual(w.last.goal, true, 'あがった');
    assertEqual(w.goalOrder[first], 1, 'あがった順が記録される');
  });

  // ---- 決着 ----

  await r.test('誰かがあがったら決着し、順位が出る', async () => {
    const { room } = start(4);
    flattenBoard(room);
    toFirstTurn(room);
    const w = room.sugoroku;
    const winner = w.turnId;
    w.pos[winner] = S.gameById('sugotoll').cells - 1;
    w.coins[winner] = 99;
    fixDice(6);
    R.submitAction(room, winner, null, { act: 'roll' });
    R.advance(room);      // 手番 → 結果
    R.advance(room);      // 結果 → 決着
    assertEqual(w.phase, R.PHASE.ENDED, '先にあがった人が出たら終わり');
    const res = R.resultView(room);
    assertEqual(res.players[0].name, w.names[winner], 'あがった人が1位');
    assertEqual(res.players[0].goaled, true, 'あがったことが分かる');
    assertEqual(res.players.length, 4, '全員ぶんの順位が出る');
  });

  await r.test('決着後に advance を呼んでも、何も起きない', async () => {
    const { room } = start(4);
    toFirstTurn(room);
    const w = room.sugoroku;
    w.phase = R.PHASE.ENDED;
    const res = R.advance(room);
    assertEqual(res.changed, false, '決着後は動かない');
    assertEqual(w.phase, R.PHASE.ENDED, '決着のまま');
  });

  // ---- 公開してよい情報 ----

  await r.test('つうこうりょうには秘密が無いので、個別配信をしない', async () => {
    const { room } = start(4);
    assertEqual(R.privateFor(room, 'p1'), null, '配るものが無い時は配らない');
  });

  await r.test('公開情報に、盤・順位・コイン・誰の番かが載る', async () => {
    const { room } = start(4);
    toFirstTurn(room);
    const v = R.publicView(room);
    assertEqual(v.game, 'sugotoll', 'どのすごろくか');
    assertEqual(v.board.length, S.gameById('sugotoll').cells + 1, '盤が載る');
    assertEqual(v.coinsUsed, true, 'コインを使うゲームだと分かる');
    assert(v.turn && v.turn.name, '誰の番かが分かる');
    assertEqual(v.players.length, 4, '全員ぶん');
    assert(v.players[0].rank >= 1, '順位が載る');
    assertEqual(typeof v.players[0].coins, 'number', 'コインが載る');
  });

  // ---- 突然イベント ----

  await r.test('突然イベントは、一巡の切れ目でしか起きない', async () => {
    const { room } = start(4);
    flattenBoard(room);
    toFirstTurn(room);
    const w = room.sugoroku;
    // 必ずイベントを引く乱数（出目1・判定は常に当たり）
    R.useRandom(rndSeq([0.001]));
    // 1人目・2人目の手番の直後には起きない
    for (let i = 0; i < 2; i++) {
      R.submitAction(room, w.turnId, null, { act: 'roll' });
      R.advance(room);   // → 結果
      R.advance(room);   // → 次の手番（イベントなら EVENT）
      assert(w.phase !== R.PHASE.EVENT, (i + 1) + '人目の直後にイベントが起きている');
    }
  });

  await r.test('イベントを切ると、一度も起きない', async () => {
    const { room } = start(4, { events: false });
    flattenBoard(room);
    toFirstTurn(room);
    const w = room.sugoroku;
    R.useRandom(rndSeq([0.001]));
    for (let i = 0; i < 12 && w.phase !== R.PHASE.ENDED; i++) {
      if (w.phase === R.PHASE.TURN) R.submitAction(room, w.turnId, null, { act: 'roll' });
      assert(w.phase !== R.PHASE.EVENT, 'イベントが起きている');
      R.advance(room);
    }
  });

  spec.ready = wasReady;
  R.useRandom(null);
  r.finish();
})();
