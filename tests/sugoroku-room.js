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
    // 数字はテストに直書きせず、性格表（正本）から引く。
    // 直書きすると、人数を変えた時に片方だけ直して食い違う
    const g = S.gameById('sugotoll');
    const few = start(g.minPlayers - 1);
    assertEqual(few.res.ok, false, '下限未満では始まらない');
    assertEqual(few.res.error, 'too_few_players', '断る理由が端末へ届く');
    assertEqual(start(g.minPlayers).res.ok, true, 'ちょうど下限なら始まる');
    assertEqual(start(g.maxPlayers).res.ok, true, 'ちょうど上限なら始まる');
    const many = start(g.maxPlayers + 1);
    assertEqual(many.res.ok, false, '上限を超えたら始まらない');
    assertEqual(many.res.error, 'too_many_players', '断る理由が端末へ届く');
  });

  await r.test('まだ完成していないすごろくは始められない', async () => {
    // **どのゲームが未完成かは、実装が進むたびに変わる。**
    // 検体をゲーム名で決め打ちすると、そのゲームが完成した日に赤くなる（実際になった）。
    // 見たいのは「ready の門が効くこと」なので、門そのものを試す
    const g = S.gameById('sugotoll');
    const was = g.ready;
    try {
      g.ready = false;
      const room = makeRoom(4);
      const res = R.startGame(room, { game: 'sugotoll' });
      assertEqual(res.ok, false, '準備中のゲームは始まらない');
      assertEqual(res.error, 'not_ready', '理由が分かる');
    } finally { g.ready = was; }
    // 性格表に無いゲームも、当然始まらない
    assertEqual(R.startGame(makeRoom(4), { game: 'sonzai-shinai' }).error, 'not_ready',
      '知らないゲームも断る');
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

  // ---- 第36弾-2：監査（指示35）を経た作法に合わせる ----

  await r.test('突然イベントの効き目は、宣言した巡を越えて残らない（型2）', async () => {
    // 失効の判定を「参照する場所」と別の段階に置くと、巡が変わった直後の1人だけが
    // 古い効き目を受け取る。つうこうりょうでは、その人の通行料だけがタダになる
    const { room } = start(3, { events: false });
    flattenBoard(room);
    toFirstTurn(room);
    const w = room.sugoroku;
    w.playerIds.forEach((id) => { w.coins[id] = 99; });
    fixDice(1);
    const startLap = w.lap;
    w.event = { id: 'toll-free', untilLap: startLap };   // 「この巡だけ」
    let guard = 0;
    while (w.lap === startLap && guard++ < 40) {
      if (w.phase === R.PHASE.TURN) R.submitAction(room, w.turnId, null, { act: 'roll' });
      R.advance(room);
    }
    assert(w.lap > startLap, '一巡して、巡が変わった');
    assertEqual(w.event, null, '宣言した巡を越えたら、効き目は消えている');
    while (w.phase !== R.PHASE.TURN && guard++ < 40) R.advance(room);
    R.submitAction(room, w.turnId, null, { act: 'roll' });
    R.advance(room);
    assertEqual(w.last.free, false, '新しい巡の1人目から、通行料が復活する');
    assert(w.last.toll > 0, '実際に通行料が取られている');
  });

  await r.test('結果を見ている間は「全員そろった」と言わない', async () => {
    // 誰も待っていない段階で every() を通すと必ず true になり、
    // 誰か1人が切れただけで settleAfterMemberGone が advance を呼んで、
    // まだ見ている途中の演出が全員ぶん切り捨てられる
    const { room } = start(4, { events: false });
    flattenBoard(room);
    toFirstTurn(room);
    const w = room.sugoroku;
    R.submitAction(room, w.turnId, null, { act: 'roll' });
    R.advance(room);
    assertEqual(w.phase, R.PHASE.RESULT, '結果を見ている');
    assertEqual(R.isAllDone(room), false, '見ている途中では、そろったと言わない');
    w.phase = R.PHASE.ENDED;
    assertEqual(R.isAllDone(room), false, '決着後も、そろったと言わない');
  });

  await r.test('操作を断る時は、理由（error）を必ず返す', async () => {
    // realtime.js は res.error をそのまま端末へ返す。undefined だと
    // 「なぜ押せないのか」が誰にも分からなくなる
    const { room } = start(4);
    toFirstTurn(room);
    const w = room.sugoroku;
    const other = w.playerIds.find((id) => id !== w.turnId);
    const notMine = R.submitAction(room, other, null, { act: 'roll' });
    assertEqual(notMine.ok, false, '手番でない人は断られる');
    assertEqual(notMine.error, 'not_your_turn', '理由が分かる');
    const weird = R.submitAction(room, w.turnId, null, { act: 'teleport' });
    assertEqual(weird.ok, false, '知らない操作は断られる');
    assertEqual(weird.error, 'bad_action', '理由が分かる');
  });

  await r.test('確認の受付は、いま待っている人だけ', async () => {
    const { room } = start(4);
    const w = room.sugoroku;
    const off = w.playerIds[1];
    room.members.get(off).connected = false;
    const res = R.submitAction(room, off, null, { act: 'ready' });
    assertEqual(res.ok, false, '待っていない人は受け付けない');
    assertEqual(res.error, 'not_expected', '理由が分かる');
  });

  await r.test('居ないID・あがった人を指した操作は、受け付けない（幽霊IDの門）', async () => {
    // つうこうりょう自身は相手を指さないが、共通の門をここで固めておく。
    // ゲームごとに書くと、相手を指す遊び（ふたり・てふだ）で必ず書き忘れる
    const { room } = start(4);
    flattenBoard(room);
    toFirstTurn(room);
    const w = room.sugoroku;
    const id = w.turnId;
    const ghost = R.submitAction(room, id, 'p999', { act: 'roll', targetId: 'p999' });
    assertEqual(ghost.ok, false, '居ないIDは断る');
    assertEqual(ghost.error, 'unknown_target', '理由が分かる');
    assertEqual(w.intent, null, '断った操作で、受付中の内容が汚れない');
    const other = w.playerIds.find((x) => x !== id);
    w.goalOrder[other] = 1;
    const goaled = R.submitAction(room, id, other, { act: 'roll', targetId: other });
    assertEqual(goaled.ok, false, 'もうあがった人は対象にできない');
    assertEqual(goaled.error, 'unknown_target', '理由が分かる');
  });

  spec.ready = wasReady;
  R.useRandom(null);
  r.finish();
})();
