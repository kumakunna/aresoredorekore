// tests/bomb-logic.js — 爆弾解除「クイズ解除」のルール層（第27弾）
//
// ここは DOM も socket.io も使わない純粋な計算なので、jsdom を立てずに確かめる。
// 見るのは5つ:
//   ・端末から届いた設定を、そのまま信じずに枠へ収めること
//   ・コードの抽選が、難易度ごとの希望どおりで、同じお題を二度使わないこと
//   ・3択が「正解1つ＋別のお題2つ」になること
//   ・ミスの罰と心拍の速さが、決めたとおりに効くこと
//   ・競争版の順位が「本数→タイム、ライフ0は最下位」で並ぶこと
//
// ランダムは必ず引数で渡して固定する（乱数任せのテストは、たまに落ちて信用を失う）。

const B = require('../public/js/bomb-logic');
const { createRunner, assert, assertEqual } = require('./harness');

// 常に「先頭を選ぶ」乱数。shuffled が並びを変えないので、期待値を書ける
const rndZero = () => 0;
// 呼ばれた順に決まった値を返す乱数（並びを意図した形にしたい時に使う）
function rndSeq(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

function topic(name, tier) {
  return { name, tier, ng_words: ['ng1', 'ng2'] };
}
// 難易度ごとに n 件ずつのプールを作る
function pool(spec) {
  const out = [];
  Object.keys(spec).forEach((tier) => {
    for (let i = 1; i <= spec[tier]; i++) out.push(topic(tier + i, tier));
  });
  return B.normalizeTopics(out);
}

(async function main() {
  const r = createRunner('bomb-logic：クイズ解除のルール');

  // ---- 設定の整え ----

  await r.test('設定は端末の言い値を鵜呑みにせず、枠に収める', async () => {
    const c = B.normalizeConfig({
      mode: 'race', endWhen: 'all', lives: 99, timerSec: 999999,
      counts: { easy: 999, normal: 3 }
    });
    assertEqual(c.mode, 'race', '遊び方');
    assertEqual(c.endWhen, 'all', '終わり方');
    assertEqual(c.lives, B.MAX_LIVES, 'ライフは上限まで');
    assert(c.timerSec <= 59 * 60 + 59, '時間は59:59まで');
    assertEqual(c.total, B.MAX_WIRES, 'コードの合計は上限を超えない');
    // 前の難易度の希望を優先し、あふれた分は後ろから削る
    assertEqual(c.counts.easy, B.MAX_WIRES, 'かんたんが枠を使い切る');
    assertEqual(c.counts.normal, 0, 'あふれた難易度は0本になる');
  });

  await r.test('知らない値が来ても既定に寄せる（行き止まりを作らない）', async () => {
    const c = B.normalizeConfig({ mode: 'なにこれ', endWhen: 'なにこれ', lives: null });
    assertEqual(c.mode, B.MODE.COOP, '既定は協力版');
    assertEqual(c.endWhen, B.END_WHEN.FIRST, '既定は最初の1人で終了');
    assertEqual(c.lives, 3, '既定のライフは3');
  });

  await r.test('コードの並び順は必ず混ざる（難易度のグラデーションを作らない）', async () => {
    // 難易度ごとに固まったまま並べると、盤面が緑→黄→橙→赤に見えて
    // どこが難しいか一目で分かってしまう。並べ方の設定そのものを無くした
    const topics = pool({ easy: 4, normal: 4, hard: 4 });
    const wires = B.pickWires(topics, { easy: 4, normal: 4, hard: 4 }, rndZero);
    // 抽選した直後は難易度ごとにまとまっている
    assertEqual(wires.map((w) => w.tier).join(','),
      'easy,easy,easy,easy,normal,normal,normal,normal,hard,hard,hard,hard',
      '抽選の直後は難易度順に並んでいる');
    // 盤面に出す前に必ず通す shuffleWires で、そのまとまりが崩れる
    let mixedAtLeastOnce = false;
    for (let i = 0; i < 30; i++) {
      const order = B.shuffleWires(wires).map((w) => w.tier).join(',');
      if (order !== wires.map((w) => w.tier).join(',')) { mixedAtLeastOnce = true; break; }
    }
    assert(mixedAtLeastOnce, '並びが混ざる');
    // 中身は減らない（混ぜるだけ）
    const before = wires.map((w) => w.uid).sort().join(',');
    const after = B.shuffleWires(wires).map((w) => w.uid).sort().join(',');
    assertEqual(after, before, '混ぜても本数と中身は変わらない');
  });

  await r.test('お題プールは、名前が無いもの・重複を捨てる', async () => {
    const t = B.normalizeTopics([
      { name: '傘', tier: 'easy' },
      { name: '傘', tier: 'hard' },   // 重複
      { name: '  ', tier: 'easy' },   // 名前が無い
      { name: '冷蔵庫' },              // 難易度が分からない
      null
    ]);
    assertEqual(t.length, 2, '残るのは2件');
    assertEqual(t[0].name, '傘', '先に来たものが残る');
    assertEqual(t[0].tier, 'easy', '後の重複では難易度が上書きされない');
    assertEqual(t[1].tier, 'normal', '難易度不明は ふつう に寄せる');
  });

  // ---- コードの抽選 ----

  await r.test('コードは難易度ごとに希望の本数だけ引かれる', async () => {
    const wires = B.pickWires(pool({ easy: 5, normal: 5, hard: 5 }),
      { easy: 2, normal: 3, hard: 0 }, rndZero);
    assertEqual(wires.length, 5, '合計の本数');
    assertEqual(wires.filter((w) => w.tier === 'easy').length, 2, 'かんたんの本数');
    assertEqual(wires.filter((w) => w.tier === 'normal').length, 3, 'ふつうの本数');
    assertEqual(wires.filter((w) => w.tier === 'hard').length, 0, 'むずかしいは引かない');
  });

  await r.test('同じお題が2本のコードに入らない', async () => {
    const wires = B.pickWires(pool({ easy: 4 }), { easy: 4 }, rndSeq([0.3, 0.7, 0.1, 0.9]));
    const names = wires.map((w) => w.name);
    assertEqual(new Set(names).size, names.length, '名前が重複していない');
    const uids = wires.map((w) => w.uid);
    assertEqual(new Set(uids).size, uids.length, 'uidが重複していない');
  });

  await r.test('プールが足りない難易度は、あるだけで我慢する（黙って別の難易度で埋めない）', async () => {
    const wires = B.pickWires(pool({ easy: 2, muri: 5 }), { easy: 10 }, rndZero);
    assertEqual(wires.length, 2, 'かんたんが2件しかないので2本');
    assert(wires.every((w) => w.tier === 'easy'), '頼んでいない難易度は混ざらない');
  });

  // ---- 3択 ----

  await r.test('3択は「正解1つ＋別のお題2つ」になる', async () => {
    const topics = pool({ easy: 6 });
    const wires = B.pickWires(topics, { easy: 1 }, rndZero);
    const choices = B.buildChoices(wires[0], topics, rndZero);
    assertEqual(choices.length, B.CHOICE_COUNT, '3択');
    assertEqual(new Set(choices).size, 3, '同じ選択肢が並ばない');
    assertEqual(choices.filter((c) => c === wires[0].name).length, 1, '正解はちょうど1つ');
  });

  await r.test('同じ難易度が足りなければ、ダミーを全体から借りる', async () => {
    // むりなんだが が1件だけ＝同じ難易度からはダミーを作れない
    const topics = pool({ muri: 1, easy: 5 });
    const wires = B.pickWires(topics, { muri: 1 }, rndZero);
    const choices = B.buildChoices(wires[0], topics, rndZero);
    assertEqual(choices.length, 3, '3択が作れる');
    assert(choices.indexOf(wires[0].name) >= 0, '正解が入っている');
  });

  await r.test('答え合わせは、別名でも正解にする', async () => {
    const wire = { name: '眼鏡', tier: 'easy', aliases: ['メガネ'] };
    assert(B.isCorrect(wire, '眼鏡'), '表示名で正解');
    assert(B.isCorrect(wire, 'メガネ'), '別名でも正解');
    assert(!B.isCorrect(wire, '双眼鏡'), '別のお題は不正解');
    assert(!B.isCorrect(wire, null), '空の答えは不正解');
  });

  // ---- ミスの罰と心拍 ----

  await r.test('ミスの時間ペナルティは10秒', async () => {
    assertEqual(B.MISS_TIME_PENALTY_SEC, 10, '競争版のミスで減る秒数');
  });

  await r.test('心拍はミスするほど速くなり、速すぎる手前で止まる', async () => {
    assertEqual(B.heartIntervalMs(0), B.HEART_BASE_MS, 'ミス0なら基準の速さ');
    assert(B.heartIntervalMs(1) < B.heartIntervalMs(0), '1回ミスで速くなる');
    assert(B.heartIntervalMs(3) < B.heartIntervalMs(1), 'ミスが増えるほど速くなる');
    assertEqual(B.heartIntervalMs(100), B.HEART_MIN_MS, '下限より速くはならない');
    assertEqual(B.heartIntervalMs(-5), B.HEART_BASE_MS, '変な値でも基準に戻る');
  });

  // ---- 競争版の順位 ----

  await r.test('順位は「解けた本数が多い順、同数ならタイムが早い順」', async () => {
    const ranked = B.rankPlayers([
      { id: 'a', name: 'あき', solved: 3, lastSolveAt: 9000 },
      { id: 'b', name: 'びび', solved: 5, lastSolveAt: 8000 },
      { id: 'c', name: 'ちか', solved: 3, lastSolveAt: 4000 }
    ]);
    assertEqual(ranked.map((x) => x.name).join(','), 'びび,ちか,あき', '並び順');
    assertEqual(ranked[0].rank, 1, '1位');
    assertEqual(ranked[1].rank, 2, '同数ならタイムが早い方が上');
    assertEqual(ranked[2].rank, 3, '最後');
  });

  await r.test('ライフを0にした人は、何本解いていても最下位あつかい・順位なし', async () => {
    const ranked = B.rankPlayers([
      { id: 'a', name: 'あき', solved: 9, lastSolveAt: 1000, failed: true },
      { id: 'b', name: 'びび', solved: 1, lastSolveAt: 9000 }
    ]);
    assertEqual(ranked[0].name, 'びび', '解けた人が先に来る');
    assertEqual(ranked[0].rank, 1, '1位');
    assertEqual(ranked[1].name, 'あき', '失敗した人は最後');
    assertEqual(ranked[1].rank, null, '順位は付けない（記録なし）');
  });

  await r.test('1問も解けていない人は、解けた人より後ろに並ぶ', async () => {
    const ranked = B.rankPlayers([
      { id: 'a', name: 'あき', solved: 0, lastSolveAt: null },
      { id: 'b', name: 'びび', solved: 0, lastSolveAt: null },
      { id: 'c', name: 'ちか', solved: 1, lastSolveAt: 5000 }
    ]);
    assertEqual(ranked[0].name, 'ちか', '1本でも解けた人が上');
    assertEqual(ranked[1].rank, 2, '0本の2人は同着');
    assertEqual(ranked[2].rank, 2, '同着は同じ順位');
  });

  await r.test('横棒グラフの割合は0〜100に収まる', async () => {
    assertEqual(B.progressPct(0, 10), 0, '0本');
    assertEqual(B.progressPct(5, 10), 50, '半分');
    assertEqual(B.progressPct(10, 10), 100, '全部');
    assertEqual(B.progressPct(3, 0), 0, '0本の爆弾でも壊れない');
  });

  r.finish();
})();
