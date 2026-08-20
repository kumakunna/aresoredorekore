// tests/sugoroku-hand-room.js — 「てふだ」の進行役（第36弾-22）
//
// 見るのは4つ:
//   ・**手札の数字が、公開ビューのどこにも入っていない**（枚数だけ見える）
//   ・交渉（売り札を出す → 手番の人が買う）でコインと札が正しく動く
//   ・ぴったり上がり。ゴールを超える札は、門で断られる
//   ・補充が無いので**終わらなくなる**状況を、ちゃんと打ち切る
//
// 秘密の検査は「無いこと」の確認なので、入れ物ごと文字列にして探す。
// 個別のキーを1つずつ見ると、新しいキーを足した時に漏れる（型1）。

const R = require('../sugoroku-room');
const S = require('../public/js/sugoroku-logic');
const Hand = require('../public/js/sugoroku-hand');
const { createRunner, assert, assertEqual } = require('./harness');

function makeRoom(n) {
  const members = new Map();
  for (let i = 1; i <= n; i++) {
    members.set('p' + i, { id: 'p' + i, name: 'ひと' + i, role: 'player', connected: true });
  }
  return { code: 'HAND01', members, state: { phase: 'lobby', game: null, data: {} } };
}
function start(n) {
  const room = makeRoom(n);
  const res = R.startGame(room, { game: 'sugohand', events: false });
  return { room, res };
}
// じゅんびを済ませて、最初の「売り札を出す」段階まで進める
function toOffer(room) {
  const w = room.sugoroku;
  w.playerIds.forEach((id) => R.submitAction(room, id, null, { act: 'ready' }));
  R.advance(room);
  return w;
}

(async function main() {
  const r = createRunner('sugoroku-hand-room：てふだの進行役');

  const spec = S.gameById('sugohand');
  const was = spec.ready;
  spec.ready = true;

  // ---- 秘密 ----

  await r.test('公開ビューに、誰の手札の数字も入っていない', async () => {
    const { room } = start(4);
    const w = room.sugoroku;
    // わざと分かりやすい手札にする（0のままだと「たまたま一致」で見逃す）
    w.hands.p1 = [6, 6, 6, 5, 5];
    w.hands.p2 = [1, 1, 2];
    const v = R.publicView(room);
    v.players.forEach((p) => {
      assertEqual(p.cards, (w.hands[p.id] || []).length, p.name + ' の枚数は見えてよい');
      assertEqual(p.hand, undefined, p.name + ' の手札の数字が公開ビューに入っている');
    });
    // 入れ物ごと文字列にして、手札そのものが紛れていないかを見る
    const dump = JSON.stringify(v);
    assert(dump.indexOf('[6,6,6,5,5]') === -1, 'p1 の手札が丸ごと入っている');
    assert(dump.indexOf('[1,1,2]') === -1, 'p2 の手札が丸ごと入っている');
    assert(dump.indexOf('"sum"') === -1, '手札の合計が入っている（あと何マス進めるかが割れる）');
  });

  await r.test('その人の秘密には、自分の手札と「いま出せる札」が入っている', async () => {
    const { room } = start(4);
    const w = room.sugoroku;
    w.hands.p1 = [1, 3, 6];
    w.pos.p1 = 27;                      // 盤は30。あと3マス
    const mine = R.privateFor(room, 'p1');
    assertEqual(mine.hand.join(','), '1,3,6', '自分の手札は分かる');
    assertEqual(mine.playable.join(','), '1,3', 'ゴールを超える6は出せない');
    assertEqual(mine.sum, 10, '合計も自分にだけ出す');
    // 他人の手札が混ざっていないこと
    const dump = JSON.stringify(mine);
    assert(dump.indexOf('p2') === -1, '他人のIDが入っている');
  });

  // ---- 交渉 ----

  await r.test('売り札を出せるのは手番の人以外。手番の人は出せない', async () => {
    const { room } = start(4);
    const w = toOffer(room);
    assertEqual(w.phase, R.PHASE.OFFER, '売り札の段階になる');
    const turn = w.turnId;
    const other = w.playerIds.find((id) => id !== turn);
    const card = w.hands[other][0];
    assertEqual(R.submitAction(room, other, null, { act: 'offer', card, price: 3 }).ok, true,
      '手番でない人は出せる');
    assertEqual(R.submitAction(room, turn, null, { act: 'offer', card: w.hands[turn][0], price: 3 }).ok,
      false, '手番の人は出せない（自分で買う番だから）');
  });

  await r.test('持っていない札や、範囲外の値段は受け取らない', async () => {
    const { room } = start(4);
    const w = toOffer(room);
    const other = w.playerIds.find((id) => id !== w.turnId);
    w.hands[other] = [2, 4];
    assertEqual(R.submitAction(room, other, null, { act: 'offer', card: 5, price: 3 }).error,
      'bad_action', '持っていない札は出せない');
    assertEqual(R.submitAction(room, other, null, { act: 'offer', card: 2, price: 99 }).error,
      'bad_action', '範囲外の値段は受け取らない');
    assertEqual(R.submitAction(room, other, null, { act: 'offer', card: 2, price: 3 }).ok, true,
      '正しい形なら通る');
  });

  await r.test('買うと、コインと札が入れ替わる', async () => {
    const { room } = start(4);
    const w = toOffer(room);
    const buyer = w.turnId;
    const seller = w.playerIds.find((id) => id !== buyer);
    w.hands[seller] = [4, 4, 2];
    w.hands[buyer] = [1, 1];
    w.coins[buyer] = 10;
    w.coins[seller] = 10;
    R.submitAction(room, seller, null, { act: 'offer', card: 4, price: 3 });
    R.advance(room);                                  // OFFER → BUY
    assertEqual(w.phase, R.PHASE.BUY, '買う段階になる');
    assertEqual(R.submitAction(room, buyer, null, { act: 'buy', sellerId: seller }).ok, true, '買える');
    assertEqual(w.hands[buyer].join(','), '1,1,4', '買った札が手元に来る');
    assertEqual(w.hands[seller].join(','), '4,2', '売った札は1枚だけ減る');
    assertEqual(w.coins[buyer], 7, 'コインが減る');
    assertEqual(w.coins[seller], 13, '売った人に入る');
    const v = R.publicView(room);
    assertEqual(v.bought.card, 4, '何を買ったかは全員に見える');
    assertEqual(v.bought.price, 3, 'いくらで買ったかも見える');
  });

  await r.test('コインが足りなければ買えない', async () => {
    const { room } = start(4);
    const w = toOffer(room);
    const buyer = w.turnId;
    const seller = w.playerIds.find((id) => id !== buyer);
    w.hands[seller] = [5];
    w.coins[buyer] = 2;
    R.submitAction(room, seller, null, { act: 'offer', card: 5, price: 8 });
    R.advance(room);
    assertEqual(R.submitAction(room, buyer, null, { act: 'buy', sellerId: seller }).error,
      'no_coins', 'コイン不足は断る');
    assertEqual(w.coins[buyer], 2, 'コインは減らない');
    assertEqual(w.hands[seller].join(','), '5', '札も動かない');
  });

  await r.test('買わずに進むこともできる', async () => {
    const { room } = start(4);
    const w = toOffer(room);
    R.advance(room);
    assertEqual(R.submitAction(room, w.turnId, null, { act: 'pass' }).ok, true, '買わないを選べる');
    R.advance(room);
    assertEqual(w.phase, R.PHASE.TURN, '札を出す段階へ進む');
  });

  // ---- 札を出して進む ----

  await r.test('ゴールを超える札は、受け口が断る', async () => {
    const { room } = start(4);
    const w = toOffer(room);
    R.advance(room); R.advance(room);                 // OFFER → BUY → TURN
    assertEqual(w.phase, R.PHASE.TURN, '札を出す段階');
    const id = w.turnId;
    w.pos[id] = 27;                                   // 盤30。あと3マス
    w.hands[id] = [3, 6];
    assertEqual(R.submitAction(room, id, null, { act: 'play', card: 6 }).error, 'bad_action',
      '超える札は断る');
    assertEqual(R.submitAction(room, id, null, { act: 'play', card: 3 }).ok, true,
      'ぴったりなら出せる');
    R.advance(room);
    assertEqual(w.pos[id], 30, 'ゴールに着く');
    assert(w.goalOrder[id] != null, 'あがりになる');
  });

  await r.test('出した札は手元から消える', async () => {
    const { room } = start(4);
    const w = toOffer(room);
    R.advance(room); R.advance(room);
    const id = w.turnId;
    w.pos[id] = 0;
    w.hands[id] = [2, 2, 5];
    R.submitAction(room, id, null, { act: 'play', card: 2 });
    R.advance(room);
    assertEqual(w.hands[id].join(','), '2,5', '同じ数字が2枚あっても1枚だけ減る');
    assertEqual(w.pos[id], 2, '出した数だけ進む');
  });

  await r.test('出せる札が無い時は進めない。そのかわりコインが入る', async () => {
    const { room } = start(4);
    const w = toOffer(room);
    R.advance(room); R.advance(room);
    const id = w.turnId;
    w.pos[id] = 27;                                   // あと3マス
    w.hands[id] = [4, 5, 6];                          // どれも超える
    w.coins[id] = 5;
    R.advance(room);                                  // 時間切れと同じ流れ
    assertEqual(w.pos[id], 27, '進んでいない');
    assertEqual(w.coins[id], 5 + Hand.STUCK_RELIEF, 'コインが入る');
    const v = R.publicView(room);
    assertEqual(v.moves[0].stuck, true, '進めなかったことは全員に見える');
    // 責める言い方をサーバー側で作らない（言葉は画面が持つ）
    assertEqual(v.moves[0].relief, Hand.STUCK_RELIEF, '入った分も伝える');
  });

  await r.test('押していない人の札は、いちばん小さいものが出る', async () => {
    // 止まらないことを優先する。ただし**大きい札を勝手に使わない**
    const { room } = start(4);
    const w = toOffer(room);
    R.advance(room); R.advance(room);
    const id = w.turnId;
    w.pos[id] = 0;
    w.hands[id] = [6, 1, 4];
    R.advance(room);                                  // 押さないまま締め切り
    assertEqual(w.pos[id], 1, 'いちばん小さい札で進む');
    assertEqual(w.hands[id].slice().sort().join(','), '4,6', '1だけが消える');
    assertEqual(w.moves[0].auto, true, 'サーバーが代わりに出したことが分かる');
  });

  // ---- 終わり方 ----

  await r.test('一巡して誰も進めなければ、その時点で決着する', async () => {
    // 補充が無いので、置かないと永久に終わらない（決めごと㊴）。
    // まず「誰も進めない」状況が本当に作れることを確かめる
    const { room } = start(3);
    const w = toOffer(room);
    w.playerIds.forEach((id) => { w.pos[id] = 29; w.hands[id] = [5, 6]; });   // あと1マス
    w.playerIds.forEach((id) => {
      assertEqual(Hand.canMove(w.hands[id], w.pos[id], 30), false, id + ' は進めない');
    });
    let guard = 0;
    while (w.phase !== R.PHASE.ENDED && guard++ < 30) R.advance(room);
    assertEqual(w.phase, R.PHASE.ENDED, '止まらずに決着する（' + guard + '回で）');
    assertEqual(w.goalCount, 0, '誰もあがっていない');
    const res = R.resultView(room);
    assertEqual(res.players.length, 3, '全員ぶん順位がつく');
    assertEqual(res.players[0].rank, 1, '1位がいる');
  });

  await r.test('1人でも進めれば、まだ終わらない', async () => {
    // 「誰も進めなかったら終わり」の片側だけを試すと、
    // いつでも終わってしまう実装でも緑になる（落とし穴10の型c）
    const { room } = start(3);
    const w = toOffer(room);
    w.playerIds.forEach((id) => { w.pos[id] = 29; w.hands[id] = [5, 6]; });
    w.hands[w.playerIds[1]] = [1, 5];                 // この人だけ進める
    let guard = 0;
    while (w.phase !== R.PHASE.ENDED && guard++ < 12) R.advance(room);
    assert(w.goalCount > 0, '進めた人があがって決着した（' + w.goalCount + '人）');
  });

  await r.test('人がいなくなっても、待ち人が空になって進む', async () => {
    const { room } = start(4);
    const w = toOffer(room);
    // 売り札を出す段階。手番以外が全員いなくなる
    w.playerIds.filter((id) => id !== w.turnId).forEach((id) => {
      room.members.get(id).connected = false;
    });
    assertEqual(R.expectedMembers(room).length, 0, '誰も待っていない');
    assertEqual(R.isAllDone(room), true, 'realtime.js が advance を呼べる形');
    R.advance(room);
    assert(w.phase !== R.PHASE.OFFER, '止まらずに先へ進む');
  });

  await r.test('決着したら、手札の中身がはじめて意味を持たなくなる（順位はコインで割れる）', async () => {
    const { room } = start(3);
    const w = toOffer(room);
    w.pos.p1 = 20; w.coins.p1 = 3;
    w.pos.p2 = 20; w.coins.p2 = 9;
    w.pos.p3 = 30; w.goalOrder.p3 = 1; w.goalCount = 1;
    w.phase = R.PHASE.RESULT;
    R.advance(room);
    assertEqual(w.phase, R.PHASE.ENDED, '決着した');
    const res = R.resultView(room);
    assertEqual(res.players[0].id, 'p3', 'あがった人が1位');
    assertEqual(res.players[1].id, 'p2', '同じマスならコインの多い方が上');
    assertEqual(res.players[2].id, 'p1', '残りが最下位');
  });

  spec.ready = was;
  R.useRandom(null);
  r.finish();
})();
