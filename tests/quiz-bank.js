// tests/quiz-bank.js — クイズ系の問題バンク（第29弾-6）
//
// 中身（問題そのものが正しいか）は人が読むしかない。
// ここで見るのは「データとして壊れていないか」と「遊びが成立するか」:
//   ・正解の位置が選択肢の範囲に入っているか
//   ・選択肢が重複していないか（同じものが2つ並ぶと答えが2つになる）
//   ・問題文が重複していないか
//   ・選択肢の並びを混ぜても、正解が正解のままか
//   ・つぎつぎクイズの答え合わせが、表記ゆれを拾えるか

const Q = require('../public/js/quiz-bank');
const { createRunner, assert, assertEqual } = require('./harness');

(async function main() {
  const r = createRunner('quiz-bank：クイズの問題バンク');

  await r.test('全部の問題が、データとして壊れていない', async () => {
    Q.TIERS.forEach((tier) => {
      Q.questionsOf(tier).forEach((q, i) => {
        const where = tier + ' の ' + (i + 1) + '問目';
        assert(q.q && q.q.length > 0, where + '：問題文がある');
        assert(Array.isArray(q.choices) && q.choices.length >= 3, where + '：選択肢が3つ以上');
        assert(Number.isInteger(q.correct), where + '：正解の位置が数字');
        assert(q.correct >= 0 && q.correct < q.choices.length,
          where + '：正解の位置が選択肢の中にある');
        // 同じ選択肢が並ぶと、正解が2つある問題になってしまう
        assertEqual(new Set(q.choices).size, q.choices.length, where + '：選択肢が重複しない');
        q.choices.forEach((c) => assert(c && String(c).trim(), where + '：空の選択肢がない'));
      });
    });
  });

  await r.test('同じ問題文が2回出てこない（階層をまたいでも）', async () => {
    const seen = {};
    Q.TIERS.forEach((tier) => {
      Q.questionsOf(tier).forEach((q) => {
        assert(!seen[q.q], '重複した問題：' + q.q + '（' + seen[q.q] + ' と ' + tier + '）');
        seen[q.q] = tier;
      });
    });
  });

  await r.test('選択肢を混ぜても、正解は正解のまま', async () => {
    // 位置で覚えられないよう出すたびに混ぜるので、ここがずれると全部誤答になる
    let checked = 0;
    Q.TIERS.forEach((tier) => {
      Q.questionsOf(tier).forEach((q) => {
        const before = q.choices[q.correct];
        for (let i = 0; i < 5; i++) {
          const mixed = Q.shuffleChoices(q);
          assertEqual(mixed.choices[mixed.correct], before,
            '混ぜても正解が変わらない：' + q.q);
          assertEqual(new Set(mixed.choices).size, q.choices.length, '選択肢が減らない');
          checked++;
        }
      });
    });
    assert(checked > 0, '確かめた問題がある');
  });

  await r.test('抽選：頼んだ数だけ返り、同じ問題が2つ入らない', async () => {
    const got = Q.pickQuestions('easy', 5, {});
    assertEqual(got.length, 5, '5問返る');
    assertEqual(new Set(got.map((q) => q.q)).size, 5, '同じ問題が入らない');
    // 出した問題を覚えておくと、次は別の問題が優先される
    const used = {};
    got.forEach((q) => { used[q.q] = true; });
    const next = Q.pickQuestions('easy', 5, used);
    const overlap = next.filter((q) => used[q.q]).length;
    assert(overlap < 5, 'まだ出していない問題が優先される');
  });

  await r.test('抽選：あるだけしか無くても、落ちずに返る', async () => {
    const all = Q.countOf('muri');
    const got = Q.pickQuestions('muri', all + 100, {});
    assertEqual(got.length, all, 'あるぶんだけ返る');
  });

  // ---- つぎつぎクイズ ----

  await r.test('つぎつぎクイズ：お題に正解の一覧が付いている', async () => {
    const topics = Q.listTopicsOf();
    assert(topics.length > 0, 'お題がある');
    topics.forEach((t) => {
      assert(t.topic, 'お題名がある');
      assert(Array.isArray(t.answers) && t.answers.length >= 5,
        t.topic + '：正解が5つ以上ある（少ないとすぐ終わる）');
      assertEqual(new Set(t.answers).size, t.answers.length, t.topic + '：正解が重複しない');
      assert(Q.TIERS.indexOf(t.tier) >= 0, t.topic + '：難易度が付いている');
    });
  });

  await r.test('つぎつぎクイズ：正解・重複・不正解を見分けられる', async () => {
    const t = Q.listTopicsOf().find((x) => x.topic === '赤い食べ物');
    assert(t, '「赤い食べ物」のお題がある');
    assertEqual(Q.judgeListAnswer(t, 'りんご', []), 'correct', '一覧にあれば正解');
    assertEqual(Q.judgeListAnswer(t, 'りんご', ['りんご']), 'duplicate', '出た答えは重複');
    assertEqual(Q.judgeListAnswer(t, 'だいこん', []), 'wrong', '一覧に無ければ不正解');
    assertEqual(Q.judgeListAnswer(t, '', []), 'wrong', '空は不正解');
  });

  await r.test('つぎつぎクイズ：書き方が違っても、読みが同じなら正解にする', async () => {
    // 「リンゴ」と打った人が弾かれるのは理不尽
    const t = Q.listTopicsOf().find((x) => x.topic === '赤い食べ物');
    ['リンゴ', 'りんご', ' りんご ', 'り ん ご'].forEach((s) => {
      assertEqual(Q.judgeListAnswer(t, s, []), 'correct', '「' + s + '」を正解にする');
    });
    // 重複の判定も同じ緩さでないと、書き方を変えれば通ってしまう
    assertEqual(Q.judgeListAnswer(t, 'リンゴ', ['りんご']), 'duplicate',
      'カタカナで書き直しても重複と分かる');
  });

  await r.test('表記ゆれの吸収は、別のものまで同じにしない', async () => {
    // 緩すぎると誤答が通ってしまう
    assert(Q.normalize('りんご') !== Q.normalize('みかん'), '違うものは違うまま');
    assert(Q.normalize('トマト') === Q.normalize('とまと'), 'カタカナとひらがなは同じ');
  });

  // ---- 分量（レビューで増やす前提の記録） ----

  await r.test('いまの分量を記録しておく（目標に届いているかが分かるように）', async () => {
    const counts = Q.allCounts();
    const total = Q.TIERS.reduce((s, t) => s + counts[t], 0);
    console.log('    いまの問題数：' +
      Q.TIERS.map((t) => t + ' ' + counts[t]).join(' / ') + '　合計 ' + total);
    console.log('    つぎつぎクイズのお題：' + Q.listTopicsOf().length + '個');
    // 遊びとして最低限成立する数は確保しておく（1階層が空だと詰む）
    Q.TIERS.forEach((t) => {
      assert(counts[t] >= 10, t + ' に最低10問はある（実際: ' + counts[t] + '）');
    });
  });

  r.finish();
})();
