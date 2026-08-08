// tests/quiz-logic.js — カセット「クイズ王」4ゲームのルール層（第30弾）
//
// 4つの遊びを1つのファイルにまとめてあるので、
// 「片方だけ直してもう片方が古いまま」が起きないかを、ここで見張る。
//
// 境界の値は必ず両側を試す（上限の手前・上限・上限の先）。
// 今日、片方向にしか効いていない上限チェックのバグを踏んだため。

const L = require('../public/js/quiz-logic');
const { createRunner, assert, assertEqual } = require('./harness');

(async function main() {
  const r = createRunner('quiz-logic：クイズ王のルール');

  // ---- 設定の整え ----

  await r.test('設定は端末の言い値を鵜呑みにせず、枠に収める', async () => {
    const c = L.normalizeConfig({ variant: 'quizrush', timerSec: 999999, passLimit: 999, roundsToWin: 99 });
    assert(c.timerSec <= 59 * 60 + 59, '制限時間は59:59まで');
    assert(c.passLimit <= 20, 'パス回数に上限がある');
    assert(c.roundsToWin <= 9, '先取ポイントに上限がある');
    // 下側も効いているか（片方向しか効いていないバグを今日踏んだ）
    const low = L.normalizeConfig({ variant: 'quizrush', timerSec: 1, passLimit: -5, roundsToWin: -3 });
    assert(low.timerSec >= 10, '短すぎる制限時間は持ち上げる');
    assertEqual(low.passLimit, 0, 'パス回数は0未満にならない');
    assertEqual(low.roundsToWin, 0, '先取ポイントも0未満にならない');
  });

  await r.test('知らない遊び方が来たら、既定に寄せる（行き止まりを作らない）', async () => {
    assertEqual(L.normalizeConfig({ variant: 'なにこれ' }).variant, L.VARIANT.RUSH, '既定はクイズラッシュ');
    assertEqual(L.normalizeConfig({ variant: 'quizlist', style: 'なにこれ' }).style,
      L.LIST_STYLE.COOP, 'つぎつぎの既定は協力形式');
    assertEqual(L.normalizeConfig({ variant: 'buzzer', delivery: 'なにこれ' }).delivery,
      L.BUZZER_DELIVERY.SPEAK, '早押しの既定は読み上げ');
  });

  await r.test('遊び方ごとに、要る設定だけが入る', async () => {
    const rush = L.normalizeConfig({ variant: 'quizrush' });
    assert('passLimit' in rush, 'ラッシュにはパス回数がある');
    assertEqual(rush.targetCount, undefined, 'つぎつぎ用の設定は混ざらない');
    const list = L.normalizeConfig({ variant: 'quizlist' });
    assert('targetCount' in list && 'turnSec' in list, 'つぎつぎには目標数と持ち時間');
    assertEqual(list.passLimit, undefined, 'ラッシュ用の設定は混ざらない');
  });

  // ---- クイズラッシュ ----

  await r.test('クイズラッシュ：難易度が高いほど得点が高い', async () => {
    // 旧クイズ王決定戦の配点をそのまま引き継ぐ（記録の点数の意味を変えない）
    assertEqual(L.rushScoreFor('easy'), 1, 'かんたんは1点');
    assertEqual(L.rushScoreFor('muri'), 8, 'むりなんだがは8点');
    let prev = 0;
    L.TIERS.forEach((t) => {
      const p = L.rushScoreFor(t);
      assert(p >= prev, t + ' は前の階層以上の点（' + p + '）');
      prev = p;
    });
  });

  await r.test('クイズラッシュ：正解なら難易度ぶん入り、外れたら0', async () => {
    const q = { q: 'x', choices: ['a', 'b', 'c'], correct: 2, tier: 'nanisore' };
    assertEqual(L.rushJudge(q, 2).correct, true, '合っていれば正解');
    assertEqual(L.rushJudge(q, 2).gained, 5, 'なにそれは5点');
    assertEqual(L.rushJudge(q, 0).correct, false, '違えば不正解');
    assertEqual(L.rushJudge(q, 0).gained, 0, '外したら入らない（減点もしない）');
  });

  await r.test('クイズラッシュ：ラウンドの勝者は同点なら全員、0点なら誰も選ばない', async () => {
    assertEqual(L.rushRoundWinners({ a: 5, b: 3 }).join(','), 'a', '一番多い人');
    assertEqual(L.rushRoundWinners({ a: 5, b: 5, c: 1 }).sort().join(','), 'a,b', '同点なら全員');
    assertEqual(L.rushRoundWinners({ a: 0, b: 0 }).length, 0, '誰も得点していなければ勝者なし');
    assertEqual(L.rushRoundWinners({}).length, 0, '空でも落ちない');
  });

  await r.test('クイズラッシュ：先取ポイントは、遊ぶラウンド数に見合った数だけ選べる', async () => {
    // 3ラウンドしか遊ばないのに「7ポイント先取」だと永久に終わらない
    assertEqual(L.winTargetsFor(7).join(','), '3,5,7', '7ラウンドなら3つとも選べる');
    assertEqual(L.winTargetsFor(5).join(','), '3,5', '5ラウンドなら7は選べない');
    assertEqual(L.winTargetsFor(3).join(','), '3', '3ラウンドなら3だけ');
    assertEqual(L.winTargetsFor(1).join(','), '1', '1ラウンドでも選択肢が空にならない');
    assertEqual(L.winTargetsFor(0).join(','), '1', '0でも落ちない');
  });

  // ---- つぎつぎクイズ ----

  await r.test('つぎつぎ：順番は、脱落した人を飛ばして回る', async () => {
    const order = ['a', 'b', 'c', 'd'];
    const alive = { a: true, b: false, c: true, d: false };
    const isActive = (id) => alive[id];
    assertEqual(order[L.nextTurnIndex(order, 0, isActive)], 'c', 'bを飛ばしてc');
    assertEqual(order[L.nextTurnIndex(order, 2, isActive)], 'a', '一周してaに戻る');
  });

  await r.test('つぎつぎ：残りが1人でも、その人に回り続ける', async () => {
    const order = ['a', 'b'];
    const isActive = (id) => id === 'a';
    assertEqual(order[L.nextTurnIndex(order, 0, isActive)], 'a', '自分に戻る');
  });

  await r.test('つぎつぎ：誰も残っていなければ -1（無限ループにしない）', async () => {
    assertEqual(L.nextTurnIndex(['a', 'b'], 0, () => false), -1, '止まる');
    assertEqual(L.nextTurnIndex([], 0, () => true), -1, '空でも止まる');
  });

  await r.test('つぎつぎ：正解・重複・不正解を見分ける（判定は問題バンクと同じもの）', async () => {
    const topic = { topic: 'テスト', answers: ['りんご', 'みかん'] };
    assertEqual(L.listJudge(topic, 'りんご', []), 'correct', '一覧にあれば正解');
    assertEqual(L.listJudge(topic, 'リンゴ', ['りんご']), 'duplicate', '書き方を変えても重複');
    assertEqual(L.listJudge(topic, 'ぶどう', []), 'wrong', '一覧に無ければ不正解');
  });

  await r.test('つぎつぎ：協力形式は目標に届けば成功、時間切れなら失敗', async () => {
    const S = L.LIST_STYLE.COOP;
    assertEqual(L.listOutcome(S, { saidCount: 10, targetCount: 10 }).success, true, '届けば成功');
    assertEqual(L.listOutcome(S, { saidCount: 9, targetCount: 10 }).done, false, '途中では終わらない');
    const out = L.listOutcome(S, { saidCount: 9, targetCount: 10, timedOut: true });
    assertEqual(out.done, true, '時間切れで終わる');
    assertEqual(out.success, false, '届いていなければ失敗');
  });

  await r.test('つぎつぎ：協力形式では、間違えても終わらせない', async () => {
    // みんなで積み上げる遊びなので、1人のミスで打ち切るとつまらない
    const out = L.listOutcome(L.LIST_STYLE.COOP, { saidCount: 3, targetCount: 10 });
    assertEqual(out.done, false, '続く');
  });

  await r.test('つぎつぎ：脱落形式は、残り1人になったらその人の勝ち', async () => {
    const S = L.LIST_STYLE.SURVIVAL;
    const out = L.listOutcome(S, { aliveIds: ['b'] });
    assertEqual(out.done, true, '終わる');
    assertEqual(out.winnerId, 'b', '残った人が勝ち');
    assertEqual(L.listOutcome(S, { aliveIds: ['a', 'b'] }).done, false, '2人いれば続く');
  });

  // ---- とくとくクイズ ----

  await r.test('とくとく：時間がたつほど文字が開いていく', async () => {
    const text = '日本の首都はどこ';
    assertEqual(L.revealedCount(text, 0, 20), 0, '最初は0文字');
    assertEqual(L.revealedCount(text, 20000, 20), text.length, '時間いっぱいで全部');
    const half = L.revealedCount(text, 10000, 20);
    assert(half > 0 && half < text.length, '途中は途中まで（' + half + '）');
    // 時間を過ぎても、文字数を超えない
    assertEqual(L.revealedCount(text, 999999, 20), text.length, '超えない');
  });

  await r.test('とくとく：伏せ字にしても、句読点と空白は最初から見せる', async () => {
    // 形が分かる方が「読もう」という気になる
    const masked = L.maskedText('これは、なに？', 0);
    assert(masked.indexOf('、') >= 0 && masked.indexOf('？') >= 0, '記号は見える');
    assert(masked.indexOf('◻') >= 0, '中身は伏せる');
    assertEqual(masked.length, 'これは、なに？'.length, '長さは変わらない（形が分かる）');
    assertEqual(L.maskedText('あい', 2), 'あい', '全部開けばそのまま');
  });

  await r.test('とくとく：早いほど高得点。ただし最後まで待っても0にはしない', async () => {
    const early = L.revealScore('normal', 0, 20);
    const late = L.revealScore('normal', 20000, 20);
    assert(early > late, '早い方が高い（' + early + ' > ' + late + '）');
    assert(late >= 1, '待っても0点にはしない（0だと誰も答えなくなる）');
    // 難易度が高いほど、同じ早さでも高い
    assert(L.revealScore('muri', 0, 20) > L.revealScore('easy', 0, 20), '難しい方が高い');
  });

  // ---- 早押しトーナメント ----

  await r.test('早押し：組み合わせは2人ずつ。奇数なら1人が不戦勝', async () => {
    assertEqual(JSON.stringify(L.buildPairs(['a', 'b', 'c', 'd'])), '[["a","b"],["c","d"]]', '4人');
    assertEqual(JSON.stringify(L.buildPairs(['a', 'b', 'c'])), '[["a","b"],["c",null]]', '3人は1人が不戦勝');
    assertEqual(JSON.stringify(L.buildPairs(['a'])), '[["a",null]]', '1人でも落ちない');
  });

  await r.test('早押し：不戦勝は自動で勝ち上がる（待たせない）', async () => {
    const b = L.newBracket(['a', 'b', 'c'], () => 0);
    const first = L.advanceBracket(b);
    assertEqual(first.done, false, 'まだ続く');
    assertEqual(first.pair.length, 2, '2人の対戦が返る');
    assert(first.pair[1], '不戦勝の枠は返らない（自動で処理される）');
  });

  await r.test('早押し：勝ち上がっていくと、いつか優勝が決まる', async () => {
    const b = L.newBracket(['a', 'b', 'c', 'd'], () => 0);
    let guard = 0;
    for (;;) {
      const step = L.advanceBracket(b);
      if (step.done) break;
      L.finishMatch(b, step.pair[0], step.pair[1]); // いつも先の人が勝つ
      assert(guard++ < 20, '無限ループにならない');
    }
    assert(b.champion, '優勝が決まる（' + b.champion + '）');
    assert(b.runnerUp, '準優勝も残る（' + b.runnerUp + '）');
  });

  await r.test('早押し：1人しかいなくても、優勝が決まって終わる', async () => {
    const b = L.newBracket(['a'], () => 0);
    const step = L.advanceBracket(b);
    assertEqual(step.done, true, 'すぐ終わる');
    assertEqual(b.champion, 'a', 'その人が優勝');
  });

  // ---- 共通 ----

  await r.test('順位は得点順。同点は同じ順位で、並びがちらつかない', async () => {
    const rows = [
      { id: 'a', name: 'あき', score: 3 },
      { id: 'b', name: 'びび', score: 5 },
      { id: 'c', name: 'ちか', score: 3 }
    ];
    const ranked = L.rank(rows);
    assertEqual(ranked[0].name, 'びび', '一番多い人が先頭');
    assertEqual(ranked[0].rank, 1, '1位');
    assertEqual(ranked[1].rank, 2, '同点は同じ順位');
    assertEqual(ranked[2].rank, 2, '同点は同じ順位');
    // 何度並べても同じ順番（表示がちらつかない）
    assertEqual(L.rank(rows).map((x) => x.name).join(','),
      L.rank(rows.slice().reverse()).map((x) => x.name).join(','), '並べ直しても同じ');
  });

  r.finish();
})();
