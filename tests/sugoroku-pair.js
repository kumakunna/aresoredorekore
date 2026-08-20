// tests/sugoroku-pair.js — 「ふたりでひとつ」の進行（第36弾）
//
// socket.io を立てずに、部屋の形だけ偽装して確かめる。
// これまでの2つと違うのは、**待つ単位が「人」ではなく「組」**であること。
//
// いちばん見たいのは3つ:
//   ・**相方が消えても止まらない**（残った1人が出目を全部使える・決めごと⑭）。
//     合計が一致するまで確定しない遊びなので、これまでで一番深刻な止まり方をする
//   ・**1組の停滞が、他の組を止めない**（まとまった組は待たれない）
//   ・駒が「組」に付いていることが、公開情報の形にも出ている

const R = require('../sugoroku-room');
const S = require('../public/js/sugoroku-logic');
const { createRunner, assert, assertEqual } = require('./harness');

function makeRoom(n) {
  const members = new Map();
  for (let i = 1; i <= n; i++) {
    members.set('p' + i, { id: 'p' + i, name: 'ひと' + i, role: 'player', connected: true });
  }
  return { code: 'PAIR01', members, state: { phase: 'lobby', game: null, data: {} } };
}
function start(n, cfg) {
  const room = makeRoom(n);
  const res = R.startGame(room, Object.assign({ game: 'sugopair', events: false }, cfg || {}));
  return { room, res };
}
function flatten(room) {
  const w = room.sugoroku;
  for (let i = 1; i < w.board.length - 1; i++) w.board[i] = 'plain';
}
// 確認を済ませて、振る段階まで進める
function toRoll(room) {
  const w = room.sugoroku;
  w.playerIds.forEach((id) => R.submitAction(room, id, null, { act: 'ready' }));
  R.advance(room);
  return w;
}
// 全部の組が振った状態にして、配分の段階へ。
// **必ず本来の経路（誰かが振る）を通す。** 出目だけ直接入れると、
// 配分の入れ物を用意する処理を飛ばしてしまい、実際には起きない状況で試すことになる
function toSplit(room, dice) {
  const w = toRoll(room);
  w.groups.forEach((g) => {
    R.submitAction(room, g.members[0], null, { act: 'roll' });
    w.dice[g.id] = dice;          // 出目だけ、確かめたい値に固定する
  });
  R.advance(room);
  return w;
}
function groupOf(w, id) {
  return w.groups.find((g) => g.members.indexOf(id) !== -1);
}

(async function main() {
  const r = createRunner('sugoroku-pair：ふたりでひとつの進行');

  const spec = S.gameById('sugopair');
  const was = spec.ready;
  spec.ready = true;

  await r.test('人数の門が両方向に効く（4人以上）', async () => {
    assertEqual(start(3).res.ok, false, '3人では始まらない');
    assertEqual(start(3).res.error, 'too_few_players', '理由が届く');
    assertEqual(start(4).res.ok, true, 'ちょうど下限');
    assertEqual(start(8).res.ok, true, 'ちょうど上限');
    assertEqual(start(9).res.ok, false, '上限超過');
  });

  await r.test('駒は「組」に付く（人ごとの位置を持たない）', async () => {
    const { room } = start(4);
    const v = R.publicView(room);
    assertEqual(v.pairs, true, '組で遊ぶと分かる');
    assertEqual(v.groups.length, 2, '4人なら2組');
    v.groups.forEach((g) => {
      assertEqual(g.pos, 0, '組の駒はふりだし');
      assertEqual(g.names.length, 2, '2人組');
    });
    // 同じ組の2人は、同じ位置を見る
    const w = room.sugoroku;
    w.groups[0].pos = 7;
    const v2 = R.publicView(room);
    const pair = v2.players.filter((p) => p.groupId === w.groups[0].id);
    assertEqual(pair.length, 2, '2人が同じ組');
    pair.forEach((p) => assertEqual(p.pos, 7, '同じ組は同じ位置'));
  });

  await r.test('振るのは組ごと。誰が振ってもよく、2回は振れない', async () => {
    const { room } = start(4);
    const w = toRoll(room);
    assertEqual(w.phase, R.PHASE.ROLL, '振る段階');
    const g = w.groups[0];
    assertEqual(R.submitAction(room, g.members[0], null, { act: 'roll' }).ok, true, '1人目が振れる');
    assert(w.dice[g.id] >= 1 && w.dice[g.id] <= 6, '出目が1〜6');
    assertEqual(R.submitAction(room, g.members[1], null, { act: 'roll' }).error, 'taken',
      '同じ組は2回振れない');
  });

  await r.test('振った組の人は、もう待たれない（1組の停滞が他を止めない）', async () => {
    const { room } = start(4);
    const w = toRoll(room);
    const g0 = w.groups[0], g1 = w.groups[1];
    R.submitAction(room, g0.members[0], null, { act: 'roll' });
    const waiting = R.expectedMembers(room);
    g0.members.forEach((id) => assertEqual(waiting.indexOf(id), -1, '振った組は待たれない'));
    g1.members.forEach((id) => assert(waiting.indexOf(id) !== -1, 'まだの組は待たれる'));
  });

  await r.test('配分は、合計が出目と一致した時だけ確定する', async () => {
    const { room } = start(4);
    const w = toSplit(room, 5);
    assertEqual(w.phase, R.PHASE.SPLIT, '配分の段階');
    const g = w.groups[0];
    const [a, b] = g.members;
    R.submitAction(room, a, null, { act: 'split', steps: 3 });
    assertEqual(!!w.locked[g.id], false, '片方だけでは確定しない');
    R.submitAction(room, b, null, { act: 'split', steps: 1 });
    assertEqual(!!w.locked[g.id], false, '合計4では確定しない（出目は5）');
    R.submitAction(room, b, null, { act: 'split', steps: 2 });
    assertEqual(w.locked[g.id], true, '合計5でぴったり確定');
  });

  await r.test('出目より多い数は入れられない', async () => {
    const { room } = start(4);
    const w = toSplit(room, 3);
    const g = w.groups[0];
    assertEqual(R.submitAction(room, g.members[0], null, { act: 'split', steps: 4 }).error,
      'bad_action', '出目を超える数は断る');
  });

  await r.test('確定した組は待たれない。まだの組だけが待たれる', async () => {
    const { room } = start(4);
    const w = toSplit(room, 4);
    const g0 = w.groups[0], g1 = w.groups[1];
    R.submitAction(room, g0.members[0], null, { act: 'split', steps: 4 });
    R.submitAction(room, g0.members[1], null, { act: 'split', steps: 0 });
    assertEqual(w.locked[g0.id], true, '1組目が確定');
    const waiting = R.expectedMembers(room);
    g0.members.forEach((id) => assertEqual(waiting.indexOf(id), -1, '確定した組は待たれない'));
    g1.members.forEach((id) => assert(waiting.indexOf(id) !== -1, 'まだの組は待たれる'));
  });

  // ---- このゲーム固有の止まり方（決めごと⑭） ----

  await r.test('相方が退室したら、残った1人が出目を全部使えてその場で確定する', async () => {
    // 合計が一致するまで確定しない遊びなので、相方が消えると
    // 配分が永久に一致しない。「相談する相手がいないのに相談を待つ」を作らない
    const { room } = start(4);
    const w = toRoll(room);
    const g = w.groups[0];
    const gone = g.members[1];
    room.members.delete(gone);
    R.submitAction(room, g.members[0], null, { act: 'roll' });
    assertEqual(w.locked[g.id], true, 'その場で確定している（待たされない）');
    assertEqual(w.solo[g.id], true, '1人になったことが分かる');
    assertEqual(S.splitSum(w.parts[g.id]), w.dice[g.id], '出目をそのまま使える');
    assertEqual(w.parts[g.id][gone], undefined, '居ない人の枠は作らない');
  });

  await r.test('相方が切断していても、残った1人だけで進められる', async () => {
    const { room } = start(4);
    const w = toSplit(room, 6);
    const g = w.groups[0];
    room.members.get(g.members[1]).connected = false;
    // 待たれるのは、繋がっている方だけ（絞り込みは芯がやる）
    const waiting = R.expectedMembers(room);
    assertEqual(waiting.indexOf(g.members[1]), -1, '切れている人は待たれない');
    assert(waiting.indexOf(g.members[0]) !== -1, '繋がっている人は待たれる');
  });

  await r.test('まとまらないまま締め切られたら、等分して端数は切り捨てる', async () => {
    const { room } = start(4);
    flatten(room);
    const w = toSplit(room, 5);
    R.advance(room);   // 時間切れと同じ流れ
    w.groups.forEach((g) => {
      assertEqual(w.autoUsed[g.id], true, '自動で分けたことが分かる');
      assertEqual(g.pos, 4, '出目5が4マスになる（1マス分が失われる）');
    });
  });

  await r.test('全員が切断しても、待ち人が空になって進める', async () => {
    const { room } = start(4);
    const w = toSplit(room, 4);
    w.playerIds.forEach((id) => { room.members.get(id).connected = false; });
    assertEqual(R.expectedMembers(room).length, 0, '誰も待っていない');
    assertEqual(R.isAllDone(room), true, 'realtime.js が advance を呼べる形');
    R.advance(room);
    assert(w.phase !== R.PHASE.SPLIT, '止まらずに先へ進む');
  });

  await r.test('3人1組でも、3人の合計が出目と一致した時だけ確定する', async () => {
    // 奇数人数では必ず3人組ができる。2人組だけを試していると、
    // 「3人ぶんの合計」という条件そのものを一度も通らない
    const { room } = start(5);
    const w = toRoll(room);
    const g3 = w.groups.find((g) => g.members.length === 3);
    assert(g3, '5人なら3人組が1つできる');
    R.submitAction(room, g3.members[0], null, { act: 'roll' });
    w.dice[g3.id] = 6;
    R.advance(room);
    R.submitAction(room, g3.members[0], null, { act: 'split', steps: 3 });
    R.submitAction(room, g3.members[1], null, { act: 'split', steps: 2 });
    assertEqual(!!w.locked[g3.id], false, '2人ぶんだけでは確定しない（合計5）');
    R.submitAction(room, g3.members[2], null, { act: 'split', steps: 1 });
    assertEqual(w.locked[g3.id], true, '3人ぶんで合計6になって確定');
  });

  await r.test('3人組でまとまらない時も、等分して端数は切り捨てる', async () => {
    const { room } = start(5);
    flatten(room);
    const w = toSplit(room, 5);
    const g3 = w.groups.find((g) => g.members.length === 3);
    R.advance(room);   // 時間切れと同じ流れ
    assertEqual(g3.pos, 3, '出目5を3人で分けて3マス（2マス分が失われる）');
  });

  // ---- 決着 ----

  await r.test('決着は「組」で並び、コインは使わない', async () => {
    const { room } = start(4);
    flatten(room);
    const w = toSplit(room, 6);
    const g = w.groups[0];
    g.pos = w.board.length - 2;
    R.submitAction(room, g.members[0], null, { act: 'split', steps: 6 });
    R.submitAction(room, g.members[1], null, { act: 'split', steps: 0 });
    w.groups[1].members.forEach(function(id, i){
      R.submitAction(room, id, null, { act: 'split', steps: i === 0 ? 6 : 0 });
    });
    R.advance(room);            // SPLIT → RESULT
    assert(w.goalCount > 0, '誰かがあがった');
    R.advance(room);            // RESULT → 決着
    assertEqual(w.phase, R.PHASE.ENDED, '決着した');
    const res = R.resultView(room);
    assertEqual(res.pairs, true, '組で並ぶ');
    assertEqual(res.players.length, 2, '2組ぶん');
    assert(res.players[0].name.indexOf('・') !== -1, '組の名前は2人が並ぶ');
    res.players.forEach((p) => assertEqual(p.coins, null, 'コインは使わない'));
  });

  await r.test('組み分けは、始めた時の設定に従う', async () => {
    const nine = { members: new Map(), state: { phase: 'lobby', game: null, data: {} }, code: 'P9' };
    // 9人はこのゲームの上限（8人）を超えるので、上限内の5人で分け方だけ見る
    const { room } = start(5, { pairStyle: 'one' });
    const w = room.sugoroku;
    assertEqual(w.groups.length, 2, '5人なら2組（3人＋2人）');
    const sizes = w.groups.map((g) => g.members.length).sort().join('-');
    assertEqual(sizes, '2-3', '3人組が1つできる');
    assertEqual(w.groups.reduce((a, g) => a + g.members.length, 0), 5, '全員が入る');
  });

  spec.ready = was;
  R.useRandom(null);
  r.finish();
})();
