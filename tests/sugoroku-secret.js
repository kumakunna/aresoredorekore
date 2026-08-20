// tests/sugoroku-secret.js — 「どこにいる？」の秘密（第36弾）
//
// このゲームは**秘密が漏れた時点で成立しなくなる**ので、
// 進行の確認より先に、秘密の線引きを固定する。
//
// 見るのは3つ:
//   ・**実位置が、公開ビューのどこにも入っていない**（大画面も同じものを見る）
//   ・実位置を知っているのは privateFor だけで、**他人のぶんは入っていない**
//   ・**嘘の申告で勝利を宣言できない**（あがり判定はサーバーが実位置で行う）
//
// 秘密の検査は「無いこと」の確認なので、**入れ物ごと文字列にして探す**。
// 個別のキーを1つずつ見ると、新しいキーを足した時に漏れる（型1）。

const R = require('../sugoroku-room');
const S = require('../public/js/sugoroku-logic');
const H = require('../public/js/sugoroku-hide');
const { createRunner, assert, assertEqual } = require('./harness');

function makeRoom(n) {
  const members = new Map();
  for (let i = 1; i <= n; i++) {
    members.set('p' + i, { id: 'p' + i, name: 'ひと' + i, role: 'player', connected: true });
  }
  return { code: 'HIDE01', members, state: { phase: 'lobby', game: null, data: {} } };
}
function start(n) {
  const room = makeRoom(n);
  const res = R.startGame(room, Object.assign({ game: 'sugohide', events: false }));
  return { room, res };
}
function toTurn(room) {
  const w = room.sugoroku;
  w.playerIds.forEach((id) => R.submitAction(room, id, null, { act: 'ready' }));
  R.advance(room);
  return w;
}

(async function main() {
  const r = createRunner('sugoroku-secret：どこにいる？の秘密');

  const spec = S.gameById('sugohide');
  const was = spec.ready;
  spec.ready = true;

  await r.test('公開ビューに、誰の実位置も入っていない', async () => {
    const { room } = start(4);
    const w = room.sugoroku;
    // わざとバラバラの位置にする。0のままだと「たまたま一致」で見逃す
    w.pos.p1 = 13; w.pos.p2 = 7; w.pos.p3 = 22; w.pos.p4 = 4;
    const v = R.publicView(room);
    v.players.forEach((p) => {
      assertEqual(p.pos, null, p.name + ' の位置が公開ビューに入っている');
    });
    // 入れ物ごと文字列にして、位置の数字が紛れていないかを見る。
    // キーを1つずつ見ると、新しいキーを足した時に漏れる
    const dump = JSON.stringify(v);
    [13, 7, 22, 4].forEach((n) => {
      assert(dump.indexOf('"pos":' + n) === -1, '位置 ' + n + ' が公開ビューに紛れている');
    });
  });

  await r.test('その人の秘密には、自分の位置だけが入っている', async () => {
    const { room } = start(4);
    const w = room.sugoroku;
    w.pos.p1 = 13; w.pos.p2 = 7;
    const mine = R.privateFor(room, 'p1');
    assertEqual(mine.pos, 13, '自分の位置は分かる');
    assert(mine.area && mine.area.name, 'いまどの区画かも分かる');
    assert(mine.clues.length >= 1, 'そこから何が見えるかが分かる');
    // 他人の位置が混ざっていないこと
    const dump = JSON.stringify(mine);
    assert(dump.indexOf('p2') === -1, '他人のIDが入っている');
    assert(dump.indexOf('"pos":7') === -1, '他人の位置が入っている');
  });

  await r.test('大画面も、同じ公開ビューを見る（そこに実位置は無い）', async () => {
    // 大画面には privateFor が届かない作りなので、
    // 公開ビューに入れていないことが、そのまま大画面の秘匿になる
    const { room } = start(4);
    room.sugoroku.pos.p1 = 19;
    const dump = JSON.stringify(R.publicView(room));
    assert(dump.indexOf('"pos":19') === -1, '大画面が見る情報に実位置が入っている');
    assert(dump.indexOf('"board"') !== -1, '盤そのものは全員に見せてよい');
  });

  await r.test('申告した区画は全員に見えるが、それは本当とは限らない', async () => {
    const { room } = start(4);
    const w = toTurn(room);
    w.pos[w.turnId] = 2;                       // 本当はふもと近く
    R.submitAction(room, w.turnId, null, { act: 'roll' });
    R.advance(room);                            // TURN → SAY
    const sayer = w.sayerId;
    w.pos[sayer] = 2;
    const lieArea = H.AREAS[H.AREAS.length - 1];   // みねちかくだと嘘をつく
    const lieClue = H.cluesOf(lieArea.id)[0];
    R.submitAction(room, sayer, null, { act: 'say', areaId: lieArea.id, clueId: lieClue.id });
    R.advance(room);                            // SAY → JUDGE
    const v = R.publicView(room);
    assertEqual(v.said.areaId, lieArea.id, '申告した区画は全員に見える');
    assertEqual(v.said.caught, false, '筋が通っているので通る（嘘でも）');
    // それでも実位置は漏れない
    assert(JSON.stringify(v).indexOf('"pos":2') === -1, '実位置が漏れている');
  });

  await r.test('申告した区画に無い手がかりを言うと、矛盾として全員に出る', async () => {
    const { room } = start(4);
    const w = toTurn(room);
    R.submitAction(room, w.turnId, null, { act: 'roll' });
    R.advance(room);
    const sayer = w.sayerId;
    w.pos[sayer] = 10;
    const area = H.AREAS[0];
    const far = H.clues().find((c) => c.areas.indexOf(area.id) === -1);
    R.submitAction(room, sayer, null, { act: 'say', areaId: area.id, clueId: far.id });
    R.advance(room);
    const v = R.publicView(room);
    assertEqual(v.said.caught, true, '矛盾として出る');
    assertEqual(v.said.back, H.CAUGHT_BACK, '何マス戻ったかも出る');
    assertEqual(w.pos[sayer], 10 - H.CAUGHT_BACK, '実際に戻っている');
  });

  await r.test('戻される時も、ふりだしより手前へは行かない', async () => {
    const { room } = start(4);
    const w = toTurn(room);
    R.submitAction(room, w.turnId, null, { act: 'roll' });
    R.advance(room);
    const sayer = w.sayerId;
    w.pos[sayer] = 1;
    const area = H.AREAS[0];
    const far = H.clues().find((c) => c.areas.indexOf(area.id) === -1);
    R.submitAction(room, sayer, null, { act: 'say', areaId: area.id, clueId: far.id });
    R.advance(room);
    assertEqual(w.pos[sayer], 0, 'ふりだしで止まる');
  });

  // ---- 嘘で勝てないこと ----

  await r.test('嘘の申告では、あがりにならない（判定はサーバーが実位置で行う）', async () => {
    const { room } = start(4);
    const w = toTurn(room);
    const sayer0 = w.turnId;
    w.pos[sayer0] = 3;                          // 本当はまだ序盤
    R.submitAction(room, sayer0, null, { act: 'roll' });
    R.advance(room);
    const sayer = w.sayerId;
    w.pos[sayer] = 3;
    const lastArea = H.AREAS[H.AREAS.length - 1];
    const clue = H.cluesOf(lastArea.id)[0];
    // 「もうあがりの近くにいる」と申告する
    R.submitAction(room, sayer, null, { act: 'say', areaId: lastArea.id, clueId: clue.id });
    R.advance(room);
    assertEqual(w.goalOrder[sayer], undefined, '申告しただけではあがれない');
    assertEqual(R.publicView(room).phase !== 'ended', true, '決着していない');
  });

  await r.test('実位置があがりに届けば、申告と関係なくあがる', async () => {
    const { room } = start(4);
    const w = toTurn(room);
    const id = w.turnId;
    w.pos[id] = w.board.length - 1 - 1;          // あと1マス
    for (let i = 1; i < w.board.length - 1; i++) w.board[i] = 'plain';
    R.submitAction(room, id, null, { act: 'roll' });
    R.advance(room);
    assert(w.goalOrder[id] != null, 'サーバーが実位置で判定してあがる');
  });

  // ---- 申告しないまま締め切られた時 ----

  await r.test('申告しないまま締め切られても止まらず、黙ったことが全員に出る', async () => {
    const { room } = start(4);
    const w = toTurn(room);
    R.submitAction(room, w.turnId, null, { act: 'roll' });
    R.advance(room);
    assertEqual(w.phase, R.PHASE.SAY, '申告を待っている');
    R.advance(room);                            // 時間切れと同じ流れ
    assertEqual(w.phase, R.PHASE.JUDGE, '先へ進む');
    assertEqual(R.publicView(room).said.silent, true, '何も言わなかったことが分かる');
  });

  await r.test('申告を求められた人が切断しても、待ち人が空になって進む', async () => {
    const { room } = start(4);
    const w = toTurn(room);
    R.submitAction(room, w.turnId, null, { act: 'roll' });
    R.advance(room);
    room.members.get(w.sayerId).connected = false;
    assertEqual(R.expectedMembers(room).length, 0, '誰も待っていない');
    assertEqual(R.isAllDone(room), true, 'realtime.js が advance を呼べる形');
    R.advance(room);
    assert(w.phase !== R.PHASE.SAY, '止まらずに先へ進む');
  });

  await r.test('申告を求める相手が偏らない（毎ターン誰かが申告する仕掛けが効く）', async () => {
    const { room } = start(4);
    const w = toTurn(room);
    for (let i = 0; i < 8; i++) {
      if (w.phase === R.PHASE.TURN) R.submitAction(room, w.turnId, null, { act: 'roll' });
      R.advance(room);
      if (w.phase === R.PHASE.SAY) R.advance(room);   // 黙ったまま進める
      if (w.phase === R.PHASE.JUDGE) R.advance(room);
      if (w.phase === R.PHASE.ENDED) break;
    }
    const counts = w.playerIds.map((id) => w.asked[id] || 0);
    const gap = Math.max(...counts) - Math.min(...counts);
    assert(gap <= 1, '求められた回数の差が開いている（' + counts.join(',') + '）');
  });

  // ---- 決着 ----

  await r.test('決着してはじめて、実位置が明かされる', async () => {
    const { room } = start(4);
    const w = toTurn(room);
    w.pos.p1 = 11; w.pos.p2 = 5;
    w.goalOrder[w.turnId] = 1; w.goalCount = 1;
    w.phase = R.PHASE.RESULT;
    R.advance(room);
    assertEqual(w.phase, R.PHASE.ENDED, '決着した');
    const res = R.resultView(room);
    assertEqual(res.players.length, 4, '全員ぶん');
    assert(res.players.some((p) => p.pos > 0), '決着では位置が出る');
    res.players.forEach((p) => assertEqual(p.coins, null, 'コインは使わない'));
  });

  spec.ready = was;
  R.useRandom(null);
  r.finish();
})();
