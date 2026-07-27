// tests/wolf-logic.js — 役職あり人狼の「ルール」の単体テスト
//
// ここは画面を一切使わないので jsdom は不要。ルールだけを固定する。
// 勝敗判定は間違えると試合が壊れるので、陣営ごとに1件ずつ必ず確認する。

const W = require('../public/js/wolf-logic.js');
const { createRunner, assert, assertEqual } = require('./harness');

// 役職を狙った通りに配るため、乱数を固定できる形でゲームを作る
function makeGame(roleByName, cfg) {
  const names = Object.keys(roleByName);
  const players = names.map((n, i) => ({ id: 'p' + i, name: n }));
  const game = W.createGame(Object.assign({
    players: players,
    turnLimit: 5,
    counts: { wolf: 0 }
  }, cfg || {}));
  // 配布結果をテストの意図どおりに上書きする（配布そのものは別テストで確認する）
  game.players.forEach(p => { p.role = roleByName[p.name]; });
  return game;
}
function p(game, name) { return game.players.find(x => x.name === name); }
function kill(game, name, cause) {
  const t = p(game, name);
  t.alive = false; t.deadCause = cause || 'attacked'; t.deadTurn = game.turn;
}

(async function main() {
  const r = createRunner('wolf-logic：役職あり人狼のルール');

  // ---------- 役職の配布 ----------
  await r.test('配布：設定した数どおりに役職が配られ、残りは村人になる', async () => {
    const players = ['A', 'B', 'C', 'D', 'E'].map((n, i) => ({ id: 'p' + i, name: n }));
    const g = W.createGame({ players, turnLimit: 5, counts: { wolf: 1, seer: 1, knight: 1 } });
    const roles = g.players.map(x => x.role);
    assertEqual(roles.filter(x => x === 'wolf').length, 1, '人狼は1人');
    assertEqual(roles.filter(x => x === 'seer').length, 1, '占い師は1人');
    assertEqual(roles.filter(x => x === 'knight').length, 1, '騎士は1人');
    assertEqual(roles.filter(x => x === 'villager').length, 2, '残りは村人');
    assertEqual(g.players.length, 5, '全員に役職がある');
  });

  await r.test('共有者：ペアが組めない人数なら自動で無効になる', async () => {
    // 3人で 人狼1＋共有者2 だと村人が0人になるので、共有者は外れる
    const few = W.normalizeCounts({ wolf: 1, mason: 2 }, 3, 5);
    assertEqual(few.mason, 0, '3人では共有者を配らない');
    // 6人なら成立する
    const ok = W.normalizeCounts({ wolf: 1, mason: 2 }, 6, 5);
    assertEqual(ok.mason, 2, '6人なら共有者は2人1組で成立する');
  });

  await r.test('霊媒師：死亡者の役職を公開する設定では選択肢から外れる', async () => {
    assertEqual(W.isRoleSelectable('medium', { revealRoleOnDeath: true }), false, '公開設定では選べない');
    assertEqual(W.isRoleSelectable('medium', { revealRoleOnDeath: false }), true, '伏せる設定では選べる');
    const g = W.createGame({
      players: [1, 2, 3, 4, 5].map(i => ({ id: 'p' + i, name: 'P' + i })),
      turnLimit: 5, counts: { wolf: 1, medium: 1 }, revealRoleOnDeath: true
    });
    assertEqual(g.players.filter(x => x.role === 'medium').length, 0, '公開設定なら霊媒師は配られない');
  });

  await r.test('ターン数で選べる役職セットが切り替わる', async () => {
    const one = W.selectableRoles(1).map(x => x.id);
    const many = W.selectableRoles(3).map(x => x.id);
    assert(one.indexOf('peek') >= 0 && one.indexOf('seer') === -1, 'ターン1では単発役職だけ');
    assert(many.indexOf('seer') >= 0 && many.indexOf('peek') === -1, 'ターン2以上では通常役職だけ');
  });

  // ---------- 勝敗判定 ----------
  await r.test('勝敗：人狼が全滅したら村人陣営の勝ち', async () => {
    const g = makeGame({ A: 'wolf', B: 'villager', C: 'villager', D: 'seer' });
    kill(g, 'A', 'executed');
    const res = W.evaluate(g);
    assert(res.ended, '決着している');
    assertEqual(res.winner, 'village', '村人陣営の勝ち');
  });

  await r.test('勝敗：人狼の数が村人以上になったら人狼陣営の勝ち', async () => {
    const g = makeGame({ A: 'wolf', B: 'villager', C: 'villager', D: 'villager' });
    assertEqual(W.evaluate(g).ended, false, '1対3ではまだ続く');
    kill(g, 'B'); kill(g, 'C');
    const res = W.evaluate(g);
    assert(res.ended, '1対1で決着する');
    assertEqual(res.winner, 'wolf', '人狼陣営の勝ち');
  });

  await r.test('勝敗：狂人は人間として数える（人狼側だが数合わせには入らない）', async () => {
    const g = makeGame({ A: 'wolf', B: 'madman', C: 'villager' });
    // 人狼1・狂人1・村人1 → 数える側は狂人と村人の2人なので、まだ決着しない
    assertEqual(W.evaluate(g).ended, false, '狂人がいる分まだ続く');
    kill(g, 'C');
    assertEqual(W.evaluate(g).winner, 'wolf', '狂人1人だけになれば人狼の勝ち');
  });

  await r.test('勝敗：妖狐が生きていれば、どちらの決着でも妖狐の勝ち', async () => {
    // 村人側の決着（人狼全滅）でも妖狐が勝つ
    const g1 = makeGame({ A: 'wolf', B: 'villager', C: 'fox' });
    kill(g1, 'A', 'executed');
    assertEqual(W.evaluate(g1).winner, 'fox', '人狼全滅でも妖狐が優先される');
    // 人狼側の決着でも妖狐が勝つ
    const g2 = makeGame({ A: 'wolf', B: 'villager', C: 'fox', D: 'villager' });
    kill(g2, 'B'); kill(g2, 'D');
    assertEqual(W.evaluate(g2).winner, 'fox', '人狼が数で上回っても妖狐が優先される');
    // 妖狐が死んでいれば通常どおり
    const g3 = makeGame({ A: 'wolf', B: 'villager', C: 'fox' });
    kill(g3, 'C', 'cursed'); kill(g3, 'A', 'executed');
    assertEqual(W.evaluate(g3).winner, 'village', '妖狐が死んでいれば村人陣営の勝ち');
  });

  await r.test('妖狐：占われると死ぬ（呪殺）。人狼の襲撃では死なない', async () => {
    const g = makeGame({ A: 'wolf', B: 'seer', C: 'fox', D: 'villager' }, { turnLimit: 3 });
    // 占い師が妖狐を占う → 呪殺
    W.setNightAction(g, p(g, 'B').id, p(g, 'C').id);
    W.setNightAction(g, p(g, 'A').id, p(g, 'D').id);
    const out = W.resolveNight(g);
    assertEqual(p(g, 'C').alive, false, '占われた妖狐は死ぬ');
    assertEqual(p(g, 'C').deadCause, 'cursed', '死因は呪殺');
    assert(out.deaths.some(d => d.cause === 'cursed'), '呪殺が結果に含まれる');

    // 襲撃では死なない
    const g2 = makeGame({ A: 'wolf', B: 'villager', C: 'fox', D: 'villager' }, { turnLimit: 3 });
    W.setNightAction(g2, p(g2, 'A').id, p(g2, 'C').id);
    W.resolveNight(g2);
    assertEqual(p(g2, 'C').alive, true, '妖狐は襲撃されても生きている');
  });

  await r.test('騎士：守った人は襲撃されない', async () => {
    const g = makeGame({ A: 'wolf', B: 'knight', C: 'villager', D: 'villager' }, { turnLimit: 3 });
    W.setNightAction(g, p(g, 'A').id, p(g, 'C').id);
    W.setNightAction(g, p(g, 'B').id, p(g, 'C').id);
    const out = W.resolveNight(g);
    assertEqual(p(g, 'C').alive, true, '守られた人は生き残る');
    assertEqual(out.deaths.length, 0, '誰も死なない');
  });

  await r.test('占い結果：狂人は村人に見える／表示形式が設定で変わる', async () => {
    const g = makeGame({ A: 'wolf', B: 'seer', C: 'madman', D: 'villager' }, { turnLimit: 3, seerResult: 'binary' });
    W.setNightAction(g, p(g, 'B').id, p(g, 'C').id);
    const out = W.resolveNight(g);
    const info = out.info[p(g, 'B').id];
    assertEqual(info.result.team, 'village', '狂人は村人に見える');

    // 詳細表示でも狂人は村人側
    const g2 = makeGame({ A: 'wolf', B: 'seer', C: 'madman', D: 'villager' }, { turnLimit: 3, seerResult: 'detail' });
    W.setNightAction(g2, p(g2, 'B').id, p(g2, 'C').id);
    const info2 = W.resolveNight(g2).info[p(g2, 'B').id];
    assertEqual(info2.result.team, 'village', '詳細表示でも狂人は村人側');

    // 人狼はきちんと黒に出る
    const g3 = makeGame({ A: 'wolf', B: 'seer', C: 'villager', D: 'villager' }, { turnLimit: 3 });
    W.setNightAction(g3, p(g3, 'B').id, p(g3, 'A').id);
    const info3 = W.resolveNight(g3).info[p(g3, 'B').id];
    assertEqual(info3.result.team, 'wolf', '人狼は人狼と分かる');
  });

  await r.test('恋人：片方が死ぬともう片方も死に、2人生存なら恋人の勝ち', async () => {
    const g = makeGame({ A: 'wolf', B: 'villager', C: 'villager', D: 'villager' }, { turnLimit: 3 });
    p(g, 'B').isLover = true; p(g, 'C').isLover = true;
    g.loverIds = [p(g, 'B').id, p(g, 'C').id];
    W.setNightAction(g, p(g, 'A').id, p(g, 'B').id);
    const out = W.resolveNight(g);
    assertEqual(p(g, 'B').alive, false, '襲撃された恋人は死ぬ');
    assertEqual(p(g, 'C').alive, false, 'もう片方も後を追う');
    assert(out.deaths.some(d => d.cause === 'lover'), '後追いが結果に含まれる');

    // 2人とも生き残って決着した場合は恋人の勝ち
    const g2 = makeGame({ A: 'wolf', B: 'villager', C: 'villager', D: 'villager' });
    p(g2, 'B').isLover = true; p(g2, 'C').isLover = true;
    g2.loverIds = [p(g2, 'B').id, p(g2, 'C').id];
    kill(g2, 'A', 'executed');
    const res = W.evaluate(g2);
    assert(res.ended, '決着している');
    assertEqual(res.loversWin, true, '2人とも生存していれば恋人の勝ち');
  });

  await r.test('てるてる坊主：処刑されると個人勝利になる', async () => {
    const g = makeGame({ A: 'wolf', B: 'teruteru', C: 'villager', D: 'villager' });
    g.phase = 'vote';
    W.setVote(g, p(g, 'A').id, p(g, 'B').id);
    W.setVote(g, p(g, 'C').id, p(g, 'B').id);
    W.setVote(g, p(g, 'D').id, p(g, 'B').id);
    const out = W.executeVote(g);
    assertEqual(out.executed.role, 'teruteru', 'てるてる坊主が処刑された');
    assertEqual(W.checkTeruteru(g, out.executed), true, '個人勝利が成立する');
    assertEqual(W.evaluate(g).teruteruWin, true, '判定結果にも個人勝利が乗る');

    // 処刑されなければ勝ちにならない
    const g2 = makeGame({ A: 'wolf', B: 'teruteru', C: 'villager' });
    g2.phase = 'vote';
    W.setVote(g2, p(g2, 'B').id, p(g2, 'A').id);
    W.setVote(g2, p(g2, 'C').id, p(g2, 'A').id);
    const out2 = W.executeVote(g2);
    assertEqual(W.checkTeruteru(g2, out2.executed), false, '別の人が処刑されれば成立しない');
  });

  // ---------- 投票 ----------
  await r.test('投票：最多得票者が処刑され、同数なら誰も処刑されない', async () => {
    const g = makeGame({ A: 'wolf', B: 'villager', C: 'villager', D: 'villager' });
    g.phase = 'vote';
    W.setVote(g, p(g, 'B').id, p(g, 'A').id);
    W.setVote(g, p(g, 'C').id, p(g, 'A').id);
    W.setVote(g, p(g, 'D').id, p(g, 'B').id);
    const out = W.executeVote(g);
    assertEqual(out.executed.name, 'A', '最多得票のAが処刑される');
    assertEqual(p(g, 'A').alive, false, 'Aは死亡している');

    const g2 = makeGame({ A: 'wolf', B: 'villager', C: 'villager', D: 'villager' });
    g2.phase = 'vote';
    W.setVote(g2, p(g2, 'C').id, p(g2, 'A').id);
    W.setVote(g2, p(g2, 'D').id, p(g2, 'B').id);
    const out2 = W.executeVote(g2);
    assertEqual(out2.tally.tie, true, '同数と判定される');
    assertEqual(out2.executed, null, '同数では誰も処刑されない');
  });

  // ---------- ターン上限 ----------
  await r.test('ターン上限：夜を飛ばして最終投票になり、決着しなければ村人陣営の勝ち', async () => {
    const g = makeGame({ A: 'wolf', B: 'villager', C: 'villager', D: 'villager' }, { turnLimit: 2 });
    g.turn = 1;
    assertEqual(W.isFinalTurn(g), false, '1ターン目はまだ上限ではない');
    W.nextTurn(g);
    assertEqual(g.turn, 2, '2ターン目に進む');
    assertEqual(W.isFinalTurn(g), true, '上限に達した');
    assertEqual(W.nextTurn(g), 'finalVote', '夜を飛ばして最終投票になる');

    // 最終投票で村人を処刑しても決着しない → フェイルセーフで村人陣営の勝ち
    g.phase = 'vote';
    W.setVote(g, p(g, 'A').id, p(g, 'B').id);
    W.setVote(g, p(g, 'C').id, p(g, 'B').id);
    W.executeVote(g);
    const res = W.finish(g);
    assert(res.ended, '必ず決着する');
    assertEqual(res.winner, 'village', '決着しなければ村人陣営の勝ち');
    assertEqual(res.reason, 'turnLimit', '理由がターン上限だと分かる');
  });

  // ---------- 1ターン専用役職 ----------
  await r.test('のぞき見役：相手の陣営が分かる。にせもの役は人狼側に見える', async () => {
    const g = makeGame({ A: 'peek', B: 'wolf', C: 'villager', D: 'fake' }, { turnLimit: 1 });
    g.phase = 'preVote';
    // 人狼を覗く
    W.setPreVoteAction(g, p(g, 'A').id, p(g, 'B').id);
    let info = W.resolvePreVote(g).info[p(g, 'A').id];
    assertEqual(info.team, 'wolf', '人狼は人狼側に見える');

    // 村人を覗く
    const g2 = makeGame({ A: 'peek', B: 'wolf', C: 'villager', D: 'fake' }, { turnLimit: 1 });
    g2.phase = 'preVote';
    W.setPreVoteAction(g2, p(g2, 'A').id, p(g2, 'C').id);
    info = W.resolvePreVote(g2).info[p(g2, 'A').id];
    assertEqual(info.team, 'village', '村人は村人側に見える');

    // にせもの役を覗くと人狼側に見える
    const g3 = makeGame({ A: 'peek', B: 'wolf', C: 'villager', D: 'fake' }, { turnLimit: 1 });
    g3.phase = 'preVote';
    W.setPreVoteAction(g3, p(g3, 'A').id, p(g3, 'D').id);
    info = W.resolvePreVote(g3).info[p(g3, 'A').id];
    assertEqual(info.team, 'wolf', 'にせもの役は人狼側に見える');
  });

  await r.test('まきこみ役：指名した人の投票先が公開対象になる', async () => {
    const g = makeGame({ A: 'involve', B: 'wolf', C: 'villager', D: 'villager' }, { turnLimit: 1 });
    g.phase = 'preVote';
    W.setPreVoteAction(g, p(g, 'A').id, p(g, 'C').id);
    const out = W.resolvePreVote(g);
    assertEqual(out.revealVoteOf, p(g, 'C').id, '指名した人が公開対象になる');
    assertEqual(g.phase, 'vote', '投票フェーズに進む');
  });

  await r.test('ターン数1のゲームは夜を持たず、投票前の行動から始まる', async () => {
    const g = W.createGame({
      players: [1, 2, 3, 4].map(i => ({ id: 'p' + i, name: 'P' + i })),
      turnLimit: 1, counts: { wolf: 1, peek: 1 }
    });
    assertEqual(g.phase, 'preVote', '夜フェーズが無い');
    assertEqual(W.pendingNightActions(g).length, 0, '夜の行動は発生しない');
  });

  // ---------- 夜の行動の割り当て ----------
  await r.test('夜の行動：能力を持つ人だけに、正しい選択肢が配られる', async () => {
    const g = makeGame({ A: 'wolf', B: 'seer', C: 'knight', D: 'villager' }, { turnLimit: 3 });
    const acts = W.pendingNightActions(g);
    const kinds = acts.map(a => a.kind).sort();
    assertEqual(kinds.join(','), 'attack,divine,guard', '人狼・占い師・騎士だけが行動する');

    const attack = acts.find(a => a.kind === 'attack');
    assert(!attack.targets.some(t => t.id === p(g, 'A').id), '人狼は仲間を襲撃先に選べない');
    const divine = acts.find(a => a.kind === 'divine');
    assert(!divine.targets.some(t => t.id === p(g, 'B').id), '占い師は自分を占えない');
    const guard = acts.find(a => a.kind === 'guard');
    assert(!guard.targets.some(t => t.id === p(g, 'C').id), '騎士は自分を守れない');
  });

  await r.test('人狼が複数：多数決と代表決めのどちらでも襲撃先が決まる', async () => {
    // 多数決
    const g = makeGame({ A: 'wolf', B: 'wolf', C: 'villager', D: 'villager', E: 'villager' },
      { turnLimit: 3, wolfAttackDecision: 'vote' });
    W.setNightAction(g, p(g, 'A').id, p(g, 'C').id);
    W.setNightAction(g, p(g, 'B').id, p(g, 'C').id);
    W.resolveNight(g);
    assertEqual(p(g, 'C').alive, false, '多数決で選ばれた人が襲撃される');

    // 代表決め：代表だけが行動対象になる
    const g2 = makeGame({ A: 'wolf', B: 'wolf', C: 'villager', D: 'villager', E: 'villager' },
      { turnLimit: 3, wolfAttackDecision: 'leader' });
    const attackers = W.pendingNightActions(g2).filter(a => a.kind === 'attack');
    assertEqual(attackers.length, 1, '代表1人だけが襲撃先を選ぶ');
  });

  // ---------- 履歴 ----------
  await r.test('履歴：ターン数・役職構成・勝敗が残る', async () => {
    const g = makeGame({ A: 'wolf', B: 'villager', C: 'seer', D: 'villager' }, { turnLimit: 4 });
    g.turn = 3;
    kill(g, 'A', 'executed');
    W.finish(g);
    const s = W.summary(g);
    assertEqual(s.turnLimit, 4, '設定した上限が残る');
    assertEqual(s.turnsPlayed, 3, '実際に何ターンで終わったかが残る');
    assertEqual(s.winner, 'village', '勝った陣営が残る');
    assertEqual(s.roles.wolf, 1, '使った役職構成が残る');
    assertEqual(s.roles.seer, 1, '占い師の数も残る');
    assertEqual(s.players.length, 4, '全員分の結果が残る');
  });

  r.finish();
})();
