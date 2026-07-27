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

  await r.test('襲撃：多数決なら1人だけが襲われる', async () => {
    const g = makeGame({ A: 'wolf', B: 'wolf', C: 'villager', D: 'villager', E: 'villager', F: 'villager' },
      { turnLimit: 3, wolfAttackDecision: 'vote' });
    // 人狼2人が別々の相手を選んでも、多数決では1人しか襲われない
    W.setNightAction(g, p(g, 'A').id, p(g, 'C').id);
    W.setNightAction(g, p(g, 'B').id, p(g, 'D').id);
    const out = W.resolveNight(g);
    assertEqual(out.deaths.length, 1, '多数決では死者は1人');
    // 人狼は全員が襲撃先を選ぶ（代表制は廃止した）
    const g2 = makeGame({ A: 'wolf', B: 'wolf', C: 'villager', D: 'villager', E: 'villager', F: 'villager' },
      { turnLimit: 3, wolfAttackDecision: 'vote' });
    const attackers = W.pendingNightActions(g2).filter(a => a.kind === 'attack');
    assertEqual(attackers.length, 2, '人狼全員が襲撃先を選ぶ');
  });

  await r.test('襲撃：各自が独立に選ぶと、別々なら2人・同じなら1人が死ぬ', async () => {
    // 別々の相手を選んだ場合 → 2人死ぬ
    const g = makeGame({ A: 'wolf', B: 'wolf', C: 'villager', D: 'villager', E: 'villager', F: 'villager' },
      { turnLimit: 3, wolfAttackDecision: 'each' });
    W.setNightAction(g, p(g, 'A').id, p(g, 'C').id);
    W.setNightAction(g, p(g, 'B').id, p(g, 'D').id);
    const out = W.resolveNight(g);
    assertEqual(out.deaths.length, 2, '別々の相手なら2人死ぬ');
    assertEqual(p(g, 'C').alive, false, 'Cが死ぬ');
    assertEqual(p(g, 'D').alive, false, 'Dが死ぬ');

    // 同じ相手を選んだ場合 → 重なるだけで1人しか死なない
    const g2 = makeGame({ A: 'wolf', B: 'wolf', C: 'villager', D: 'villager', E: 'villager', F: 'villager' },
      { turnLimit: 3, wolfAttackDecision: 'each' });
    W.setNightAction(g2, p(g2, 'A').id, p(g2, 'C').id);
    W.setNightAction(g2, p(g2, 'B').id, p(g2, 'C').id);
    const out2 = W.resolveNight(g2);
    assertEqual(out2.deaths.length, 1, '同じ相手なら1人だけ死ぬ（重複しても増えない）');
    assertEqual(p(g2, 'D').alive, true, '選ばれていない人は生きている');
  });

  await r.test('襲撃：各自が独立に選んでも、守られた人は死なない', async () => {
    const g = makeGame({ A: 'wolf', B: 'wolf', C: 'knight', D: 'villager', E: 'villager', F: 'villager' },
      { turnLimit: 3, wolfAttackDecision: 'each' });
    W.setNightAction(g, p(g, 'A').id, p(g, 'D').id);
    W.setNightAction(g, p(g, 'B').id, p(g, 'E').id);
    W.setNightAction(g, p(g, 'C').id, p(g, 'D').id); // 騎士がDを守る
    const out = W.resolveNight(g);
    assertEqual(p(g, 'D').alive, true, '守られたDは生き残る');
    assertEqual(p(g, 'E').alive, false, '守られていないEは死ぬ');
    assertEqual(out.deaths.length, 1, '死者は1人だけ');
  });

  // ---------- プリセットからの自動配置（指示18） ----------
  await r.test('プリセット：人数に応じてバランスよく配られ、村人が最低1人残る', async () => {
    const normal = ['wolf', 'seer', 'medium', 'knight'];
    const c5 = W.balancedCounts(normal, 5);
    assert(W.countAssigned(c5) < 5, '5人でも村人が1人以上残る');
    assertEqual(c5.wolf, 1, '5人なら人狼は1人');
    const c8 = W.balancedCounts(normal, 8);
    assertEqual(c8.wolf, 2, '7人以上なら人狼は2人');
    assert(W.countAssigned(c8) < 8, '8人でも村人が残る');
    const c12 = W.balancedCounts(normal, 12);
    assertEqual(c12.wolf, 3, '11人以上なら人狼は3人');
    // 3人でも破綻しない
    const c3 = W.balancedCounts(normal, 3);
    assert(W.countAssigned(c3) < 3, '3人でも村人が残る');
    assert(c3.wolf >= 1, '人狼は必ず1人以上');
  });

  await r.test('共有者は2人1組、妖狐やてるてる坊主は1人までに制限される', async () => {
    const c = W.balancedCounts(['wolf', 'mason', 'fox', 'teruteru'], 10);
    assertEqual(c.mason, 2, '共有者は2人');
    assertEqual(c.fox, 1, '妖狐は1人');
    assertEqual(c.teruteru, 1, 'てるてる坊主は1人');
    assertEqual(W.roleMax('fox', 10), 1, '妖狐の上限は1');
    assertEqual(W.roleMax('teruteru', 10), 1, 'てるてる坊主の上限は1');
    assertEqual(W.roleMax('mason', 10), 2, '共有者の上限は2');
    assert(W.roleMax('seer', 10) > 1, '占い師は重複配布できる（闇鍋）');
  });

  await r.test('ターン数1のプリセットでは、人狼と専用役職だけが選べる', async () => {
    const ids = W.selectableRoles(1).map(x => x.id);
    assert(ids.indexOf('wolf') >= 0, '人狼は1ターンでも必要');
    assert(ids.indexOf('peek') >= 0, 'のぞき見役が選べる');
    assert(ids.indexOf('seer') === -1, '占い師は選べない');
    const c = W.balancedCounts(['wolf', 'peek', 'fake', 'involve'], 5);
    assertEqual(c.wolf, 1, '人狼が配られる');
    assertEqual(c.peek, 1, 'のぞき見役が1人');
  });

  // ---------- スコア（第18弾） ----------
  // 投票の履歴を作る小道具（誰が誰に入れたかを1ターンぶん記録する）
  function castVotes(game, votes) {
    game.phase = 'vote';
    Object.keys(votes).forEach(function (name) {
      W.setVote(game, p(game, name).id, p(game, votes[name]).id);
    });
    return W.executeVote(game);
  }

  await r.test('スコア：人狼側は人数が少ないぶん、1人あたりの配点が上がる', async () => {
    // 村人4・人狼1で人狼が勝つ → 10 × (4/1) = 40 だが上限20
    const g = makeGame({ A: 'wolf', B: 'villager', C: 'villager', D: 'villager', E: 'villager' });
    ['B', 'C', 'D'].forEach(n => kill(g, n));
    W.finish(g);
    const s = W.scoreGame(g);
    assertEqual(s[p(g, 'A').id].points, 20, '人狼は上限の20点');
    assertEqual(s[p(g, 'A').id].win, true, '人狼は勝ち');
    assertEqual(s[p(g, 'E').id].points, 0, '負けた村人は0点');

    // 村人2・人狼1なら 10 × 2 = 20（ちょうど上限）
    const g2 = makeGame({ A: 'wolf', B: 'villager', C: 'villager' });
    kill(g2, 'B');
    W.finish(g2);
    assertEqual(W.scoreGame(g2)[p(g2, 'A').id].points, 20, '2対1でも20点');
  });

  await r.test('スコア：村人側の勝利は10点、人狼を当てるとターンごとに加点（上限6）', async () => {
    const g = makeGame({ A: 'wolf', B: 'villager', C: 'villager', D: 'villager' }, { turnLimit: 5 });
    // 1ターン目：BとCが人狼Aに投票、Dは外す
    castVotes(g, { B: 'A', C: 'A', D: 'B' });
    W.finish(g);
    const s = W.scoreGame(g);
    assertEqual(s[p(g, 'B').id].points, 12, '勝利10＋人狼を1回当てて2＝12点');
    assertEqual(s[p(g, 'C').id].points, 12, '同じく12点');
    // Dは一度も人狼に投票できなかったので勝利点が半分
    assertEqual(s[p(g, 'D').id].points, 5, '外した人は勝利点が半分（10→5）');
    assertEqual(s[p(g, 'D').id].goodVotes, 0, '当てた回数は0');
  });

  await r.test('スコア：読みの精度は上限6点まで（勝利点を上回らない）', async () => {
    const g = makeGame({ A: 'wolf', B: 'villager', C: 'villager', D: 'villager', E: 'villager' }, { turnLimit: 8 });
    // 5ターンぶん、Bはずっと人狼に投票し続ける（2点×5＝10点ぶんだが上限6）
    for (let i = 0; i < 5; i++) {
      g.turn = i + 1;
      g.log.push({ turn: g.turn, type: 'vote', votes: { [p(g, 'B').id]: p(g, 'A').id } });
    }
    W.finish(g);
    const s = W.scoreGame(g);
    assertEqual(s[p(g, 'B').id].goodVotes, 5, '5回当てている');
    assertEqual(s[p(g, 'B').id].points, 16, '勝利10＋精度は上限6＝16点');
    assert(s[p(g, 'B').id].points < 20, '読みが当たっても、勝った人狼（20点）は超えない');
  });

  await r.test('スコア：半減は人狼を探す側だけ。人狼・狂人・第三陣営は対象外', async () => {
    // 人狼側が勝つ試合。狂人は村人に投票しているが、それは正しい立ち回り
    const g = makeGame({ A: 'wolf', B: 'madman', C: 'villager', D: 'villager' });
    g.log.push({ turn: 1, type: 'vote', votes: { [p(g, 'B').id]: p(g, 'C').id } });
    kill(g, 'C'); kill(g, 'D');
    W.finish(g);
    const s = W.scoreGame(g);
    const wolfPts = s[p(g, 'A').id].points;
    assertEqual(s[p(g, 'B').id].points, wolfPts, '狂人は人狼と同じ点（半減されない）');
    assert(!s[p(g, 'B').id].reasons.some(x => /半分/.test(x)), '狂人に半減の理由が付かない');
    assertEqual(W.isVillageTeam(p(g, 'B')), false, '狂人は村人陣営ではない');
  });

  await r.test('スコア：妖狐・てるてる坊主・恋人の個人勝利', async () => {
    // 妖狐
    const g = makeGame({ A: 'wolf', B: 'villager', C: 'fox' });
    kill(g, 'A', 'executed');
    W.finish(g);
    assertEqual(W.scoreGame(g)[p(g, 'C').id].points, 15, '妖狐の個人勝利は15点');

    // てるてる坊主（処刑されて個人勝利、試合はまだ続く想定でも点は入る）
    const g2 = makeGame({ A: 'wolf', B: 'teruteru', C: 'villager', D: 'villager' });
    g2.phase = 'vote';
    ['A', 'C', 'D'].forEach(n => W.setVote(g2, p(g2, n).id, p(g2, 'B').id));
    const out = W.executeVote(g2);
    W.checkTeruteru(g2, out.executed);
    W.finish(g2);
    assert(W.scoreGame(g2)[p(g2, 'B').id].points >= 15, 'てるてる坊主の個人勝利が入る');

    // 恋人
    const g3 = makeGame({ A: 'wolf', B: 'villager', C: 'villager', D: 'villager' });
    p(g3, 'B').isLover = true; p(g3, 'C').isLover = true;
    g3.loverIds = [p(g3, 'B').id, p(g3, 'C').id];
    kill(g3, 'A', 'executed');
    W.finish(g3);
    const s3 = W.scoreGame(g3);
    assert(s3[p(g3, 'B').id].points >= 12, '恋人の勝利分が入る');
    assert(s3[p(g3, 'B').id].reasons.some(x => /恋人/.test(x)), '理由に恋人の勝利が出る');
  });

  await r.test('スコア：一度も投票していない人は「外した」扱いにしない', async () => {
    const g = makeGame({ A: 'wolf', B: 'villager', C: 'villager' }, { turnLimit: 3 });
    kill(g, 'A', 'executed'); // 投票を経ずに決着した場合
    W.finish(g);
    const s = W.scoreGame(g);
    assertEqual(s[p(g, 'B').id].points, 10, '投票機会が無ければ満額の10点');
  });

  // ---------- フェーズ遷移の契約（第18弾の全体検証） ----------
  // 投票が丸ごと無効になっていたバグは「phase を戻し忘れた」ことが原因だった。
  // 同じ種類の漏れを検出できるよう、各操作が「どの phase を要求するか」を固定する。
  await r.test('フェーズ：各操作は正しい phase でないと受け付けない', async () => {
    const g = makeGame({ A: 'wolf', B: 'seer', C: 'villager', D: 'villager' }, { turnLimit: 3 });
    assertEqual(g.phase, 'night', '夜のあるゲームは night から始まる');

    // night 以外では夜の行動を受け付けない
    g.phase = 'day';
    assertEqual(W.setNightAction(g, p(g, 'A').id, p(g, 'C').id), false, 'day では夜の行動を受け付けない');
    assertEqual(W.pendingNightActions(g).length, 0, 'day では夜の行動一覧も空');
    // vote 以外では投票を受け付けない（これが今回のバグの正体）
    assertEqual(W.setVote(g, p(g, 'C').id, p(g, 'A').id), false, 'day では投票を受け付けない');
    g.phase = 'vote';
    assertEqual(W.setVote(g, p(g, 'C').id, p(g, 'A').id), true, 'vote なら投票できる');
  });

  await r.test('フェーズ：夜→朝→投票→次の夜、と正しく遷移する', async () => {
    const g = makeGame({ A: 'wolf', B: 'seer', C: 'villager', D: 'villager', E: 'villager' }, { turnLimit: 3 });
    const seen = [g.phase];
    W.setNightAction(g, p(g, 'A').id, p(g, 'E').id);
    W.resolveNight(g); seen.push(g.phase);          // → day
    g.phase = 'vote';                                // 画面側が投票に入る時に切り替える
    W.setVote(g, p(g, 'C').id, p(g, 'A').id);
    W.setVote(g, p(g, 'D').id, p(g, 'A').id);
    const out = W.executeVote(g);
    assert(out.executed, '票が入っていれば処刑される');
    seen.push('afterVote');
    W.nextTurn(g); seen.push(g.phase);               // → night（次のターン）
    assertEqual(seen.join('→'), 'night→day→afterVote→night', '遷移の順番が崩れていない');
    assertEqual(g.turn, 2, 'ターンが進む');
    // 2ターン目も夜の行動を受け付ける
    assertEqual(W.setNightAction(g, p(g, 'A').id, p(g, 'D').id), true, '2ターン目も夜の行動ができる');
  });

  await r.test('フェーズ：1ターン戦は preVote から始まり、解決すると vote になる', async () => {
    const g = W.createGame({
      players: [1, 2, 3, 4].map(i => ({ id: 'p' + i, name: 'P' + i })),
      turnLimit: 1, counts: { wolf: 1, peek: 1 }
    });
    assertEqual(g.phase, 'preVote', '1ターン戦は preVote から');
    assertEqual(W.setVote(g, 'p1', 'p2'), false, 'preVote では投票できない');
    W.resolvePreVote(g);
    assertEqual(g.phase, 'vote', '解決すると vote になる');
    assertEqual(W.setVote(g, 'p1', 'p2'), true, 'vote なら投票できる');
  });

  await r.test('フェーズ：最終ターンは夜を飛ばして finalVote になる', async () => {
    const g = makeGame({ A: 'wolf', B: 'villager', C: 'villager', D: 'villager' }, { turnLimit: 2 });
    g.turn = 2;
    assertEqual(W.isFinalTurn(g), true, '上限ターンに達している');
    assertEqual(W.nextTurn(g), 'finalVote', '夜ではなく最終投票へ');
    assertEqual(g.turn, 2, '最終ターンではターンを進めない');
  });

  // ---------- 役職構成の組み合わせ（第18弾の全体検証） ----------
  await r.test('闇鍋（村人0人）でも勝敗判定が破綻しない', async () => {
    // 全員が何らかの役職。村人という役職の人がいない
    const g = makeGame({ A: 'wolf', B: 'seer', C: 'knight', D: 'madman' });
    assertEqual(W.evaluate(g).ended, false, '開始直後は決着しない');
    kill(g, 'B'); kill(g, 'C');
    // 生き残りは 人狼1・狂人1。数える側は狂人だけなので人狼の勝ち
    const res = W.evaluate(g);
    assert(res.ended, '決着する');
    assertEqual(res.winner, 'wolf', '人狼陣営の勝ち');
    // スコアも計算できる（0除算などで壊れない）
    W.finish(g, res);
    const s = W.scoreGame(g);
    assert(s[p(g, 'A').id].points > 0, '人狼に点が入る');
    assert(typeof s[p(g, 'D').id].points === 'number', '狂人の点が数値として出る');
  });

  await r.test('人狼が1人もいない編成でも、計算が壊れない', async () => {
    const g = makeGame({ A: 'seer', B: 'villager', C: 'fox' });
    const res = W.evaluate(g);
    assertEqual(res.ended, true, '人狼0なら即決着');
    // 妖狐が生きているので妖狐の勝ち
    assertEqual(res.winner, 'fox', '妖狐が優先される');
    W.finish(g, res);
    const s = W.scoreGame(g);
    assert(Object.keys(s).length === 3, '全員ぶんのスコアが出る');
    assert(isFinite(s[p(g, 'A').id].points), '0除算にならない（有限の数値）');
  });

  await r.test('恋人が妖狐を兼ねている場合でも、判定が矛盾しない', async () => {
    const g = makeGame({ A: 'wolf', B: 'villager', C: 'fox', D: 'villager' });
    p(g, 'C').isLover = true; p(g, 'D').isLover = true;   // 妖狐が恋人でもある
    g.loverIds = [p(g, 'C').id, p(g, 'D').id];
    kill(g, 'A', 'executed');                              // 人狼が処刑された
    const res = W.evaluate(g);
    assertEqual(res.winner, 'fox', '妖狐が生きているので妖狐の勝ち');
    assertEqual(res.loversWin, true, '恋人2人とも生存しているので恋人も勝ち');
    W.finish(g, res);
    const s = W.scoreGame(g);
    // 妖狐の個人勝利15＋恋人12が両方入る
    assertEqual(s[p(g, 'C').id].points, 27, '妖狐と恋人の両方が加算される');
    assert(s[p(g, 'C').id].reasons.length >= 2, '理由も両方残る');
  });

  await r.test('恋人の片方が呪殺されたら、もう片方も後を追う', async () => {
    const g = makeGame({ A: 'wolf', B: 'seer', C: 'fox', D: 'villager', E: 'villager' }, { turnLimit: 3 });
    p(g, 'C').isLover = true; p(g, 'D').isLover = true;
    g.loverIds = [p(g, 'C').id, p(g, 'D').id];
    W.setNightAction(g, p(g, 'B').id, p(g, 'C').id); // 妖狐を占う → 呪殺
    W.setNightAction(g, p(g, 'A').id, p(g, 'E').id);
    const out = W.resolveNight(g);
    assertEqual(p(g, 'C').alive, false, '妖狐は呪殺される');
    assertEqual(p(g, 'D').alive, false, '恋人も後を追う');
    assert(out.deaths.some(d => d.cause === 'lover'), '後追いが結果に含まれる');
  });

  await r.test('共有者は互いを知り、片方が死んでも判定に影響しない', async () => {
    const g = makeGame({ A: 'wolf', B: 'mason', C: 'mason', D: 'villager', E: 'villager', F: 'villager' });
    const masons = W.playersWithRole(g, 'mason', false);
    assertEqual(masons.length, 2, '共有者は2人1組');
    kill(g, 'B');
    assertEqual(W.evaluate(g).ended, false, '片方が死んでも試合は続く');
    assertEqual(W.playersWithRole(g, 'mason', true).length, 1, '生存している共有者は1人');
  });

  await r.test('スコア：決着していない状態で呼んでも勝利点は入らない', async () => {
    const g = makeGame({ A: 'wolf', B: 'villager', C: 'villager', D: 'villager' }, { turnLimit: 5 });
    g.log.push({ turn: 1, type: 'vote', votes: { [p(g, 'B').id]: p(g, 'A').id } });
    const s = W.scoreGame(g); // finish していない
    assertEqual(s[p(g, 'B').id].win, false, 'まだ勝っていない');
    assertEqual(s[p(g, 'B').id].points, 2, '読みの精度ぶんだけが入る（勝利点は入らない）');
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
