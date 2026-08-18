// tests/sugoroku-grab.js — 「こまはひとつ」の進行（第36弾）
//
// socket.io を立てずに、部屋の形だけ偽装して確かめる。
// つうこうりょう（tests/sugoroku-room.js）と違い、このゲームは
//   ・駒が1つしかない
//   ・手番が並び順で回らず、ミニゲームの順位で決まる
//   ・段階が READY → MINI → PLAY → GRAB → RESULT
// ので、共通の芯との噛み合わせをここで固定する。
//
// いちばん見たいのは3つ:
//   ・**1位が動かした時点であがったら、敗者移動が行われない**（勝者が横取りされない）
//   ・全員同時に出す段階で、**出さない人がいても止まらない**
//   ・駒が1つしかないことが、公開情報の形にも出ている

const R = require('../sugoroku-room');
const S = require('../public/js/sugoroku-logic');
const M = require('../public/js/sugoroku-mini');
const { createRunner, assert, assertEqual } = require('./harness');

function makeRoom(n) {
  const members = new Map();
  for (let i = 1; i <= n; i++) {
    members.set('p' + i, { id: 'p' + i, name: 'ひと' + i, role: 'player', connected: true });
  }
  return { code: 'GRAB01', members, state: { phase: 'lobby', game: null, data: {} } };
}
function start(n, cfg) {
  const room = makeRoom(n);
  const res = R.startGame(room, Object.assign({ game: 'sugograb', events: false }, cfg || {}));
  return { room, res };
}
// 盤を素にする（効果マスの偶然で期待値がぶれないように）
function flatten(room) {
  const w = room.sugoroku;
  for (let i = 1; i < w.board.length - 1; i++) w.board[i] = 'plain';
}
function toPlay(room) {
  const w = room.sugoroku;
  w.playerIds.forEach((id) => R.submitAction(room, id, null, { act: 'ready' }));
  R.advance(room);            // READY → MINI
  R.advance(room);            // MINI → PLAY
  return w;
}
// ミニゲームを「連打」に固定する。回数で1位・2位・3位がはっきり分かれるので、
// 敗者移動のように「順位ごとの違い」を見たい時はこちらを使う
function forceTap(room, byId) {
  const w = room.sugoroku;
  w.mini = M.miniById('tap');
  w.quiz = null;
  w.entries = {};
  Object.keys(byId).forEach((id) => { w.entries[id] = { count: byId[id], atMs: 3000 }; });
}
// ミニゲームを「指の数当て」に固定して、順位を意図した形にする
function forceFingers(room, byId) {
  const w = room.sugoroku;
  w.mini = M.miniById('fingers');
  w.quiz = null;
  w.entries = {};
  Object.keys(byId).forEach((id) => { w.entries[id] = { fingers: byId[id] }; });
}

(async function main() {
  const r = createRunner('sugoroku-grab：こまはひとつの進行');

  const spec = S.gameById('sugograb');
  const was = spec.ready;
  spec.ready = true;

  await r.test('駒は1つしかない（公開情報の形にも出る）', async () => {
    const { room } = start(4);
    const v = R.publicView(room);
    assertEqual(v.sharedPiece, true, '共有の駒だと分かる');
    assertEqual(v.piece, 0, '駒はふりだし');
    v.players.forEach((p) => {
      assertEqual(p.pos, null, '人ごとの位置は持たない');
      assertEqual(typeof p.coins, 'number', 'コインは人ごとに持つ');
    });
  });

  await r.test('確認のあと、何のミニゲームかを出してから本体に入る', async () => {
    const { room } = start(4);
    const w = room.sugoroku;
    w.playerIds.forEach((id) => R.submitAction(room, id, null, { act: 'ready' }));
    R.advance(room);
    assertEqual(w.phase, R.PHASE.MINI, 'まず題を出す段階');
    const v = R.publicView(room);
    assert(v.mini && v.mini.title && v.mini.lead, '何が始まるかが分かる');
    R.advance(room);
    assertEqual(w.phase, R.PHASE.PLAY, '本体へ');
    assert(w.deadline > Date.now(), '締め切りがある（揃わなくても止まらない）');
  });

  await r.test('同時に出す段階では、全員を待つ', async () => {
    const { room } = start(4);
    toPlay(room);
    assertEqual(R.expectedMembers(room).length, 4, '全員ぶん待つ');
    forceFingers(room, {});
    R.submitAction(room, 'p1', null, { fingers: 3 });
    assertEqual(R.isAllDone(room), false, 'まだ揃っていない');
    ['p2', 'p3', 'p4'].forEach((id) => R.submitAction(room, id, null, { fingers: 1 }));
    assertEqual(R.isAllDone(room), true, '揃った');
  });

  await r.test('出していない人がいても、締め切れば順位がつく（止まらない）', async () => {
    const { room } = start(4);
    flatten(room);
    const w = toPlay(room);
    forceFingers(room, { p1: 4 });          // p1 以外は出していない
    R.advance(room);                         // 時間切れと同じ流れ
    assert(w.phase !== R.PHASE.PLAY, '先へ進んだ');
    const first = w.miniRank[0];
    assertEqual(first.id, 'p1', '出した人が1位');
    const last = Math.max(...w.miniRank.map((x) => x.rank));
    ['p2', 'p3', 'p4'].forEach((id) => {
      assertEqual((w.miniRank.find((x) => x.id === id) || {}).rank, last, id + ' が最下位');
    });
  });

  await r.test('1位がサイコロを振り、たった1つの駒が動く', async () => {
    const { room } = start(4);
    flatten(room);
    const w = toPlay(room);
    forceFingers(room, { p1: 5, p2: 1, p3: 1, p4: 1 });
    R.advance(room);                         // PLAY → GRAB
    assertEqual(w.phase, R.PHASE.GRAB, '駒を動かす段階');
    assertEqual(w.turnId, 'p1', '1位が動かす');
    assertEqual(R.submitAction(room, 'p2', null, { act: 'roll' }).error, 'not_your_turn',
      '1位でない人は振れない');
    R.submitAction(room, 'p1', null, { act: 'roll' });
    R.advance(room);
    assert(w.piece > 0, '駒が進んだ');
    const mv = w.moves.find((x) => x.winner);
    assert(mv && mv.dice >= 1 && mv.dice <= 6, '出目が1〜6');
    assertEqual(mv.id, 'p1', '動かしたのは1位');
  });

  await r.test('敗者も、順位に応じて少しだけ動く（2位2マス・3位1マス）', async () => {
    const { room } = start(4);
    flatten(room);
    const w = toPlay(room);
    forceTap(room, { p1: 25, p2: 20, p3: 15, p4: 10 });   // 1位〜4位がはっきり分かれる
    R.advance(room);
    R.submitAction(room, 'p1', null, { act: 'roll' });
    R.advance(room);
    const losers = w.moves.filter((x) => x.loser);
    assert(losers.length >= 1, '敗者も動いている');
    losers.forEach((l) => {
      assertEqual(l.move.path.length, M.loserSteps(l.rank), l.rank + '位の移動マス数');
    });
    assertEqual(losers.some((l) => l.rank === 4), false, '4位以下は動かない');
  });

  await r.test('1位が同着なら、その全員が動かす権利を得る', async () => {
    // ミニゲームによっては1位が複数出る（指の数当てで、珍しい本数が2人いる等）。
    // 「勝った人が駒を動かせる」の素直な帰結として、同着1位は全員が振る。
    // 誰かが先にあがらせたら、そこで終わる
    const { room } = start(4);
    flatten(room);
    const w = toPlay(room);
    forceFingers(room, { p1: 5, p2: 4, p3: 0, p4: 0 });   // p1 と p2 がどちらも1人だけ＝同着1位
    R.advance(room);
    assertEqual(w.turnId, 'p1', 'まず片方が振る');
    R.submitAction(room, 'p1', null, { act: 'roll' });
    R.advance(room);
    if (!w.winnerId) {
      assertEqual(w.phase, R.PHASE.GRAB, 'あがっていなければ、もう片方にも番が回る');
      assertEqual(w.turnId, 'p2', '同着のもう1人');
    }
  });

  await r.test('敗者移動を切ると、1位しか動かない', async () => {
    const { room } = start(4, { losersMove: false });
    flatten(room);
    const w = toPlay(room);
    forceFingers(room, { p1: 5, p2: 4, p3: 0, p4: 0 });
    R.advance(room);
    R.submitAction(room, 'p1', null, { act: 'roll' });
    R.advance(room);
    assertEqual(w.moves.filter((x) => x.loser).length, 0, '敗者は動かない');
  });

  // ---- 決めごと⑩：勝者が横取りされない ----

  await r.test('1位が動かした時点であがったら、敗者移動は行われない', async () => {
    // 「あと1マス」を残した1位の隙を2位が突く、という山場は残しつつ、
    // 1位が自分で届かせた時にそれを奪われることは無い、という形
    const { room } = start(4);
    flatten(room);
    const w = toPlay(room);
    w.piece = w.board.length - 2;            // あと1マス
    // **順位がはっきり分かれる連打を使う。** 指の数当てだと p2 も1位に同着してしまい、
    // 「そもそも敗者が存在しない」条件になって、この検査が空振りする（実際にそうなっていた）
    forceTap(room, { p1: 25, p2: 20, p3: 15, p4: 10 });
    R.advance(room);
    R.submitAction(room, 'p1', null, { act: 'roll' });
    R.advance(room);                          // GRAB を消化
    assertEqual(w.winnerId, 'p1', 'あがらせたのは1位');
    assertEqual(w.moves.filter((x) => x.loser).length, 0, '敗者移動は起きていない');
  });

  await r.test('1位が届かなければ、2位以下が動いて届かせることがある', async () => {
    const { room } = start(4);
    flatten(room);
    const w = toPlay(room);
    forceFingers(room, { p1: 5, p2: 4, p3: 0, p4: 0 });
    R.advance(room);
    // 1位が振ったあとに、2位の移動でちょうど届く位置へ寄せる
    w.piece = w.board.length - 1 - 1;         // あと1マス（1位の出目は乱数なので、下で判定）
    R.submitAction(room, 'p1', null, { act: 'roll' });
    R.advance(room);
    assert(w.winnerId, '誰かがあがった');
    const goalMove = w.moves.find((x) => x.goal);
    assertEqual(goalMove.id, w.winnerId, 'あがらせた人が勝者として記録される');
  });

  // ---- じゃんけんのあいこ ----

  await r.test('あいこは、もう一度やり直す（黙って勝者を作らない）', async () => {
    const { room } = start(3);
    const w = toPlay(room);
    w.mini = M.miniById('janken');
    w.entries = { p1: { hand: 'g' }, p2: { hand: 'g' }, p3: { hand: 'g' } };
    R.advance(room);
    assertEqual(w.phase, R.PHASE.PLAY, 'もう一度、同じミニゲーム');
    assertEqual(w.last.draw, true, 'あいこだったと分かる');
    assertEqual(Object.keys(w.entries).length, 0, '出したものは仕切り直す');
  });

  await r.test('あいこが続いても、無限に繰り返さない', async () => {
    const { room } = start(3);
    const w = toPlay(room);
    w.mini = M.miniById('janken');
    for (let i = 0; i < 6 && w.phase === R.PHASE.PLAY; i++) {
      w.entries = { p1: { hand: 'p' }, p2: { hand: 'p' }, p3: { hand: 'p' } };
      R.advance(room);
    }
    assert(w.phase !== R.PHASE.PLAY, 'いつかは打ち切られる');
    assertEqual(w.last.gaveUp, true, '打ち切ったことが分かる');
    assertEqual(w.piece, 0, '誰も動かしていない');
  });

  // ---- 止まらないこと（落とし穴17） ----

  await r.test('全員が切断しても、待ち人が空になって進める', async () => {
    const { room } = start(3);
    const w = toPlay(room);
    forceFingers(room, {});
    w.playerIds.forEach((id) => { room.members.get(id).connected = false; });
    assertEqual(R.expectedMembers(room).length, 0, '誰も待っていない');
    assertEqual(R.isAllDone(room), true, 'realtime.js が advance を呼べる形');
    R.advance(room);
    assert(w.phase !== R.PHASE.PLAY, '止まらずに先へ進む');
  });

  await r.test('1位が切断していても、サーバーが代わりに振る', async () => {
    const { room } = start(4);
    flatten(room);
    const w = toPlay(room);
    forceFingers(room, { p1: 5, p2: 1, p3: 1, p4: 1 });
    R.advance(room);
    assertEqual(w.turnId, 'p1', '1位が動かす番');
    room.members.get('p1').connected = false;
    assertEqual(R.expectedMembers(room).length, 0, '待ち人が空になる');
    R.advance(room);
    const mv = w.moves.find((x) => x.winner);
    assertEqual(mv.auto, true, 'サーバーが代わりに振った');
    assert(w.piece > 0, '駒は進んでいる（置いていかれない）');
  });

  await r.test('退室した人は、動かす順番から外れる', async () => {
    const { room } = start(4);
    flatten(room);
    const w = toPlay(room);
    forceFingers(room, { p1: 5, p2: 4, p3: 0, p4: 0 });
    room.members.delete('p2');               // 2位が退室
    R.advance(room);
    assertEqual(w.order.indexOf('p2'), -1, '居ない人は順番に入らない');
  });

  // ---- 決着 ----

  await r.test('決着では、あがらせた人が1位・2位以下はコインの多い順', async () => {
    const { room } = start(4);
    flatten(room);
    const w = toPlay(room);
    w.coins.p2 = 30; w.coins.p3 = 10; w.coins.p4 = 20;
    w.piece = w.board.length - 2;
    forceFingers(room, { p1: 5, p2: 1, p3: 1, p4: 1 });
    R.advance(room);
    R.submitAction(room, 'p1', null, { act: 'roll' });
    R.advance(room);
    R.advance(room);                          // RESULT → 決着
    assertEqual(w.phase, R.PHASE.ENDED, '決着した');
    const res = R.resultView(room);
    assertEqual(res.players[0].name, w.names.p1, 'あがらせた人が1位');
    assertEqual(res.players[0].goaled, true, 'あがったことが分かる');
    const rest = res.players.slice(1).map((p) => p.coins);
    for (let i = 1; i < rest.length; i++) {
      assert(rest[i - 1] >= rest[i], '2位以下はコインの多い順（' + rest.join(',') + '）');
    }
  });

  spec.ready = was;
  R.useRandom(null);
  r.finish();
})();
