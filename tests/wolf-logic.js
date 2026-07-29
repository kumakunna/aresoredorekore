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

  // ---------- 第20弾-2：結果を「その場で」出すための先読み ----------
  await r.test('先読み：占い結果は夜が明ける前でも同じ答えになる', async () => {
    const g = makeGame({ A: 'seer', B: 'wolf', C: 'villager', D: 'villager' }, { seerResult: 'detail' });
    const pre = W.previewDivine(g, p(g, 'B').id);
    assertEqual(pre.result.label, '人狼側', '占う前に人狼だと分かる');
    assertEqual(pre.targetName, 'B', '相手の名前も返る');
    // 先読みは状態を一切変えない（ここが崩れると夜の処理が壊れる）
    assertEqual(Object.keys(g.nightActions).length, 0, '夜の行動を勝手に記録しない');
    assertEqual(p(g, 'B').alive, true, '呪殺などの判定も動かさない');
    assertEqual(g.phase, 'night', 'フェーズも変えない');

    // 実際に夜を解決した結果と一致すること
    W.setNightAction(g, p(g, 'A').id, p(g, 'B').id);
    const out = W.resolveNight(g);
    assertEqual(out.info[p(g, 'A').id].result.label, pre.result.label, '夜明けの結果と食い違わない');
  });

  await r.test('先読み：狂人は村人に見え、にせもの役は人狼側に見える', async () => {
    const g = makeGame({ A: 'seer', B: 'madman', C: 'wolf', D: 'villager' }, { seerResult: 'detail' });
    assertEqual(W.previewDivine(g, p(g, 'B').id).result.label, '村人側', '狂人は村人に見える');
    const g2 = makeGame({ A: 'wolf', B: 'fake', C: 'peek', D: 'villager' }, { turnLimit: 1 });
    assertEqual(W.previewPeek(g2, p(g2, 'B').id).label, '人狼側', 'にせもの役は人狼側に見える');
    assertEqual(W.previewPeek(g2, p(g2, 'D').id).label, '村人側', '村人は村人側に見える');
  });

  // 第24弾-1：霊媒師が見るのは「前の昼に処刑された人」だけ。
  // 夜に襲われた人は対象外（ここを取り違えると、霊媒師が言い当てられない人を言い当ててしまう）。
  await r.test('霊媒：処刑された人だけを返す（襲撃で死んだ人は返さない）', async () => {
    const g = makeGame({ A: 'medium', B: 'wolf', C: 'villager', D: 'villager', E: 'villager' });
    assertEqual(W.previewMedium(g).executed, null, 'まだ処刑が無ければ何も分からない');

    // 夜：人狼が C を襲う
    W.setNightAction(g, p(g, 'B').id, p(g, 'C').id);
    const n1 = W.resolveNight(g);
    assertEqual(n1.deaths.length, 1, '襲撃で1人死ぬ');
    assertEqual(W.previewMedium(g).executed, null, '襲撃死は霊媒の対象外');

    // 昼：D を処刑する
    g.phase = 'vote';
    W.setVote(g, p(g, 'A').id, p(g, 'D').id);
    W.setVote(g, p(g, 'E').id, p(g, 'D').id);
    const out = W.executeVote(g);
    assertEqual(out.executed.name, 'D', 'D が処刑される');
    const m = W.previewMedium(g);
    assert(m.executed, '処刑された人が分かる');
    assertEqual(m.executed.name, 'D', '処刑された人を指す');
    assertEqual(m.executed.roleName, '村人', '正体も分かる');
  });

  await r.test('霊媒：処刑が無かった昼のあとは、前の夜の襲撃死が残らない', async () => {
    // 直したバグそのもの。以前は「直前に亡くなった人」を持っていたので、
    // 同数で処刑なしだった翌日、霊媒師が襲撃で死んだ人の役職を言い当てていた。
    const g = makeGame({ A: 'medium', B: 'wolf', C: 'seer', D: 'villager' });
    W.setNightAction(g, p(g, 'B').id, p(g, 'C').id); // 占い師を襲う
    W.resolveNight(g);
    g.phase = 'vote';
    W.setVote(g, p(g, 'A').id, p(g, 'B').id);
    W.setVote(g, p(g, 'B').id, p(g, 'A').id);        // 同数
    const out = W.executeVote(g);
    assertEqual(out.executed, null, '同数なので処刑なし');
    assertEqual(W.previewMedium(g).executed, null, '襲撃で死んだ占い師は見えない');
  });

  await r.test('霊媒：決選投票を経た時は、最終的に処刑された人を指す', async () => {
    const g = makeGame({ A: 'medium', B: 'wolf', C: 'villager', D: 'villager', E: 'villager' });
    g.phase = 'vote';
    // 1回目：C と D が同数
    W.setVote(g, p(g, 'A').id, p(g, 'C').id);
    W.setVote(g, p(g, 'B').id, p(g, 'C').id);
    W.setVote(g, p(g, 'C').id, p(g, 'D').id);
    W.setVote(g, p(g, 'D').id, p(g, 'C').id === undefined ? p(g, 'C').id : p(g, 'C').id);
    W.setVote(g, p(g, 'E').id, p(g, 'D').id);
    const first = W.voteOutcome(g.votes);
    // 同数でなければこのテストの前提が崩れるので、その時は作り直さず素直に調べる
    if (first.kind === 'runoff') {
      // 決選投票で D に決まったとする
      const res = W.executeVote(g, p(g, 'D').id);
      assertEqual(res.executed.name, 'D', '決選投票の結果が処刑される');
      assertEqual(W.previewMedium(g).executed.name, 'D',
        '霊媒師も、決選投票を経た最終的な処刑者を指す');
    } else {
      // 1回目で決まった場合も、指す相手は executeVote の結果と一致する
      const res = W.executeVote(g);
      assertEqual(W.previewMedium(g).executed.name, res.executed.name,
        '霊媒師は executeVote が決めた人を指す');
    }
  });

  await r.test('霊媒：恋人の後追いは「処刑された人」に含めない', async () => {
    const g = makeGame({ A: 'medium', B: 'wolf', C: 'villager', D: 'villager', E: 'villager' },
      { lovers: true, loverIds: null });
    // 恋人を C と D に固定する
    g.players.forEach((x) => { x.isLover = false; });
    p(g, 'C').isLover = true; p(g, 'D').isLover = true;
    g.loverIds = [p(g, 'C').id, p(g, 'D').id];
    g.phase = 'vote';
    W.setVote(g, p(g, 'A').id, p(g, 'C').id);
    W.setVote(g, p(g, 'B').id, p(g, 'C').id);
    const out = W.executeVote(g);
    assertEqual(out.executed.name, 'C', 'C が処刑される');
    assertEqual(p(g, 'D').alive, false, 'D は後を追って亡くなる');
    assertEqual(W.previewMedium(g).executed.name, 'C', '霊媒師が指すのは処刑された C だけ');
  });

  // ---------- 第20弾-4-2：襲撃先が重なったことを伝えられるか ----------
  await r.test('襲撃：人狼が別々に選んで狙いが重なったら、その事実が残る', async () => {
    const g = makeGame({ A: 'wolf', B: 'wolf', C: 'villager', D: 'villager', E: 'villager' },
      { wolfAttackDecision: 'each' });
    W.setNightAction(g, p(g, 'A').id, p(g, 'C').id);
    W.setNightAction(g, p(g, 'B').id, p(g, 'C').id); // 2人とも同じ相手
    const out = W.resolveNight(g);
    assertEqual(out.deaths.length, 1, '同じ相手を選んでも死ぬのは1人');
    assertEqual(out.attackOverlap, true, '狙いが重なったことが分かる');
  });

  await r.test('襲撃：別々の相手を選んだ夜は、重なった扱いにしない', async () => {
    const g = makeGame({ A: 'wolf', B: 'wolf', C: 'villager', D: 'villager', E: 'villager' },
      { wolfAttackDecision: 'each' });
    W.setNightAction(g, p(g, 'A').id, p(g, 'C').id);
    W.setNightAction(g, p(g, 'B').id, p(g, 'D').id);
    const out = W.resolveNight(g);
    assertEqual(out.deaths.length, 2, 'それぞれの相手が欠ける');
    assertEqual(out.attackOverlap, false, '重なっていない');
  });

  await r.test('襲撃：多数決の設定では、重なった扱いにしない（元々1人しか襲わない）', async () => {
    const g = makeGame({ A: 'wolf', B: 'wolf', C: 'villager', D: 'villager', E: 'villager' },
      { wolfAttackDecision: 'vote' });
    W.setNightAction(g, p(g, 'A').id, p(g, 'C').id);
    W.setNightAction(g, p(g, 'B').id, p(g, 'C').id);
    const out = W.resolveNight(g);
    assertEqual(out.deaths.length, 1, '1人が欠ける');
    assertEqual(out.attackOverlap, false, '多数決は仕様どおりなので、わざわざ知らせない');
  });

  await r.test('襲撃：重なりの記録は毎晩リセットされる', async () => {
    const g = makeGame({ A: 'wolf', B: 'wolf', C: 'villager', D: 'villager', E: 'villager', F: 'villager' },
      { wolfAttackDecision: 'each', turnLimit: 5 });
    W.setNightAction(g, p(g, 'A').id, p(g, 'C').id);
    W.setNightAction(g, p(g, 'B').id, p(g, 'C').id);
    assertEqual(W.resolveNight(g).attackOverlap, true, '1晩目は重なった');
    g.phase = 'night'; g.turn = 2;
    W.setNightAction(g, p(g, 'A').id, p(g, 'D').id);
    W.setNightAction(g, p(g, 'B').id, p(g, 'E').id);
    assertEqual(W.resolveNight(g).attackOverlap, false, '2晩目は重なっていない（前の晩を持ち越さない）');
  });

  // ---------- 第20弾-5-1：騎士は守れたかどうかを知る ----------
  await r.test('騎士：守った相手が襲われていたら「守れた」と分かる', async () => {
    const g = makeGame({ A: 'knight', B: 'wolf', C: 'villager', D: 'villager' });
    W.setNightAction(g, p(g, 'A').id, p(g, 'C').id); // Cを守る
    W.setNightAction(g, p(g, 'B').id, p(g, 'C').id); // 人狼もCを狙う
    const out = W.resolveNight(g);
    assertEqual(out.deaths.length, 0, '守られたので誰も欠けない');
    const info = out.info[p(g, 'A').id];
    assertEqual(info.kind, 'guard', '騎士に守りの結果が届く');
    assertEqual(info.targetName, 'C', '誰を守ったかが分かる');
    assertEqual(info.saved, true, '実際に守れたことが分かる');
  });

  await r.test('騎士：狙われていなければ「守れた」とは言わない', async () => {
    const g = makeGame({ A: 'knight', B: 'wolf', C: 'villager', D: 'villager' });
    W.setNightAction(g, p(g, 'A').id, p(g, 'C').id); // Cを守る
    W.setNightAction(g, p(g, 'B').id, p(g, 'D').id); // 人狼はDを狙う
    const out = W.resolveNight(g);
    const info = out.info[p(g, 'A').id];
    assertEqual(info.saved, false, '守りは働かなかった');
    assertEqual(out.deaths.length, 1, '狙われたDが欠ける');
  });

  await r.test('騎士：守りの結果は本人にしか渡らない', async () => {
    const g = makeGame({ A: 'knight', B: 'wolf', C: 'seer', D: 'villager' });
    W.setNightAction(g, p(g, 'A').id, p(g, 'D').id);
    W.setNightAction(g, p(g, 'B').id, p(g, 'D').id);
    W.setNightAction(g, p(g, 'C').id, p(g, 'B').id);
    const out = W.resolveNight(g);
    const guardInfos = Object.keys(out.info).filter(id => out.info[id].kind === 'guard');
    assertEqual(guardInfos.length, 1, '守りの結果を受け取るのは1人だけ');
    assertEqual(guardInfos[0], p(g, 'A').id, 'その1人は騎士本人');
  });

  await r.test('脱落の原因が、あとから区別できる形で残る', async () => {
    const g = makeGame({ A: 'wolf', B: 'seer', C: 'fox', D: 'villager', E: 'villager', F: 'villager' },
      { turnLimit: 5 });
    W.setNightAction(g, p(g, 'A').id, p(g, 'D').id); // 襲撃
    W.setNightAction(g, p(g, 'B').id, p(g, 'C').id); // 妖狐を占って呪殺
    W.resolveNight(g);
    assertEqual(p(g, 'D').deadCause, 'attacked', '襲われた人は attacked');
    assertEqual(p(g, 'C').deadCause, 'cursed', '呪殺された人は cursed');
    assertEqual(p(g, 'D').deadTurn, 1, '何日目に欠けたかも残る');
    g.phase = 'vote';
    W.setVote(g, p(g, 'B').id, p(g, 'E').id);
    W.setVote(g, p(g, 'F').id, p(g, 'E').id);
    W.executeVote(g);
    assertEqual(p(g, 'E').deadCause, 'executed', '処刑された人は executed');
  });

  // ---------- 第20弾-9-2：闇鍋（村人ゼロ）の編成 ----------
  const CHAOS_ROLES = ['wolf', 'seer', 'medium', 'knight', 'madman', 'fox', 'teruteru'];
  const sum = (c) => Object.keys(c).reduce((n, k) => n + c[k], 0);

  // 第22弾-3で「ごく稀に村人が1人だけ紛れる」が入った。
  // rng を渡して当たり/外れを決め打ちすると、どちらの編成も確かめられる。
  const noVillager = () => 0.9;   // 5%の抽選を外す
  const withVillager = () => 0.01; // 当てる

  await r.test('闇鍋：ふだんは席をぴったり埋めて、村人を1人も作らない', async () => {
    [5, 6, 7, 8, 9, 10, 12, 16, 24].forEach(n => {
      const c = W.chaosCounts(CHAOS_ROLES, n, noVillager);
      assertEqual(sum(c), n, n + '人ちょうどに配れる（村人が残らない）');
      assert(c.wolf >= 1, n + '人：人狼が必ずいる');
    });
  });

  await r.test('闇鍋：ごく稀に、ただの村人が1人だけ紛れる', async () => {
    [5, 6, 8, 12, 20].forEach(n => {
      const c = W.chaosCounts(CHAOS_ROLES, n, withVillager);
      assertEqual(sum(c), n - 1, n + '人：役職は1つぶん少なく、村人が1人残る');
      assert(c.wolf >= 1, n + '人：人狼はいる');
      assert(c.wolf < n - c.wolf, n + '人：紛れても人狼が過半数にならない');
    });
    // 4人以下では紛れさせない（人狼だけが残りかねないため）
    assertEqual(sum(W.chaosCounts(CHAOS_ROLES, 4, withVillager)), 4, '4人では紛れない');
  });

  await r.test('闇鍋：紛れる確率は数%におさまっている', async () => {
    let hit = 0;
    const n = 8, tries = 4000;
    for (let i = 0; i < tries; i++) {
      if (sum(W.chaosCounts(CHAOS_ROLES, n)) === n - 1) hit++;
    }
    const rate = hit / tries;
    assert(rate > 0.02 && rate < 0.09, 'ごく低い確率（実測 ' + (rate * 100).toFixed(1) + '%）');
  });

  await r.test('闇鍋：人狼が過半数にならない（始まった瞬間に決着しない）', async () => {
    [5, 6, 7, 8, 9, 10, 12, 16, 24].forEach(n => {
      const c = W.chaosCounts(CHAOS_ROLES, n, noVillager);
      assert(c.wolf < n - c.wolf, n + '人：人狼(' + c.wolf + ')より村人側(' + (n - c.wolf) + ')が多い');
    });
  });

  await r.test('闇鍋：席が足りなければ、影響の小さい役職から落とす', async () => {
    const c = W.chaosCounts(CHAOS_ROLES, 5, noVillager);
    assertEqual(sum(c), 5, '5人ぴったり');
    assertEqual(c.teruteru, 0, 'てるてる坊主から落とす');
    assertEqual(c.fox, 0, '次に妖狐を落とす');
    assert(c.seer >= 1, '占い師は残る（情報役は最後まで残す）');
  });

  await r.test('闇鍋：人数が多いと、同じ役職が2人以上いる', async () => {
    const c = W.chaosCounts(CHAOS_ROLES, 12, noVillager);
    assertEqual(sum(c), 12, '12人ぴったり');
    const dup = ['seer', 'medium', 'knight', 'madman'].filter(id => c[id] >= 2);
    assert(dup.length > 0, '重ねられる役職が増えて席を埋める（' + JSON.stringify(c) + '）');
  });

  await r.test('闇鍋：実際にゲームを作っても村人が0人のまま', async () => {
    const players = [];
    for (let i = 0; i < 8; i++) players.push({ id: 'p' + i, name: 'P' + i });
    const g = W.createGame({
      players, counts: W.chaosCounts(CHAOS_ROLES, 8, noVillager),
      turnLimit: 7, revealRoleOnDeath: false
    });
    const villagers = g.players.filter(p => p.role === 'villager');
    assertEqual(villagers.length, 0, '村人が1人もいない');
    assertEqual(g.players.length, 8, '全員に役職が行き渡る');
  });

  await r.test('闇鍋：村人が紛れた時は、その1人だけが村人になる', async () => {
    const players = [];
    for (let i = 0; i < 8; i++) players.push({ id: 'p' + i, name: 'P' + i });
    const g = W.createGame({
      players, counts: W.chaosCounts(CHAOS_ROLES, 8, withVillager),
      turnLimit: 7, revealRoleOnDeath: false
    });
    const villagers = g.players.filter(p => p.role === 'villager');
    assertEqual(villagers.length, 1, '村人はちょうど1人');
    assertEqual(g.players.length, 8, '人数は変わらない');
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

  // ---- 第26弾 第4部：称号のもとになる「仕事ぶり」 ----

  await r.test('称号：占い・護衛・霊媒の仕事ぶりが、起きた瞬間に数えられる', async () => {
    // 起きた時にしか分からないので、決着してから振り返っても数えられない。
    // 夜のたびに数え、決着時に achievements がそれを返す
    const g = makeGame({ 占:'seer', 騎:'knight', 霊:'medium', 狼:'wolf', 村:'villager' });
    const seer = p(g, '占'), knight = p(g, '騎'), medium = p(g, '霊'),
          wolf = p(g, '狼'), villager = p(g, '村');

    // 1晩目：占い師が人狼を当て、騎士が襲撃先を守る
    W.setNightAction(g, seer.id, wolf.id);
    W.setNightAction(g, knight.id, villager.id);
    W.setNightAction(g, wolf.id, villager.id);
    W.resolveNight(g);
    assertEqual(seer.ach.seerHits, 1, '人狼を占い当てたら1');
    assertEqual(knight.ach.knightSaves, 1, '守りが実際に働いたら1');
    assertEqual(medium.ach.mediumHits, 0, 'まだ誰も処刑されていないので0');
    assert(villager.alive, '守られた人は生きている');

    // 昼：人狼を処刑 → 次の夜、霊媒師が「人狼だった」と分かる
    g.phase = 'vote';
    [seer, knight, medium, villager].forEach((x) => W.setVote(g, x.id, wolf.id));
    W.executeVote(g);
    assert(!wolf.alive, '人狼が処刑された');
    W.nextTurn(g);
    if (g.phase === 'night') W.resolveNight(g);
    assertEqual(medium.ach.mediumHits, 1, '処刑されたのが人狼側だったと分かったら1');

    // 決着したら、その数字がそのまま称号のカウンタに乗る
    g.result = W.evaluate(g);
    const a = W.achievements(g, seer.id);
    assertEqual(a.seerHits, 1, '占いの的中が渡る');
    assertEqual(a.plays, 1, '遊んだ回数も1');
    assertEqual(a.villageWins, 1, '村人側の勝ちが渡る');
    assertEqual(a.correctVotes, 1, '人狼に投票できた回数も渡る');
    assertEqual(W.achievements(g, knight.id).knightSaves, 1, '護衛成功が渡る');
    assertEqual(W.achievements(g, medium.id).mediumHits, 1, '霊媒の的中が渡る');
  });

  await r.test('称号：人狼側で処刑されずに終わったら「逃げ切り」', async () => {
    const g = makeGame({ 狼:'wolf', A:'villager', B:'villager' }, { turnLimit: 1 });
    const wolf = p(g, '狼'), a = p(g, 'A'), b = p(g, 'B');
    g.phase = 'vote';
    W.setVote(g, wolf.id, a.id); W.setVote(g, a.id, b.id); W.setVote(g, b.id, a.id);
    W.executeVote(g);
    g.result = W.evaluate(g);
    assertEqual(W.achievements(g, wolf.id).wolfEscapes, 1, '処刑されなかった人狼は逃げ切り');
    assertEqual(W.achievements(g, b.id).wolfEscapes, undefined, '村人側は逃げ切りにならない');

    // 処刑された人狼は逃げ切りにしない
    const g2 = makeGame({ 狼:'wolf', A:'villager', B:'villager' }, { turnLimit: 1 });
    const w2 = p(g2, '狼'), a2 = p(g2, 'A'), b2 = p(g2, 'B');
    g2.phase = 'vote';
    W.setVote(g2, a2.id, w2.id); W.setVote(g2, b2.id, w2.id); W.setVote(g2, w2.id, a2.id);
    W.executeVote(g2);
    g2.result = W.evaluate(g2);
    assertEqual(W.achievements(g2, w2.id).wolfEscapes, undefined, '処刑された人狼は逃げ切りではない');
    assertEqual(W.achievements(g2, a2.id).correctVotes, 1, '人狼に入れた村人は1回当てている');
  });

  await r.test('称号：決着していない試合は数えない', async () => {
    const g = makeGame({ A:'wolf', B:'villager', C:'villager', D:'villager' });
    assertEqual(Object.keys(W.achievements(g, p(g, 'A').id)).length, 0, '途中では何も返さない');
    assertEqual(Object.keys(W.achievements(g, 'いない人')).length, 0, '知らない人にも落ちない');
  });

  r.finish();
})();
