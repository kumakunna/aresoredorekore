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

  await r.test('取り出した問題には、必ず難易度が付いている', async () => {
    // 難易度は QUESTIONS の鍵として持っているだけなので、
    // 取り出す時に貼り忘れると、得点の計算がどの難易度でも1点になる。
    // 実際にそうなったので、ここで見張る
    Q.TIERS.forEach((tier) => {
      Q.questionsOf(tier).forEach((q) => {
        assertEqual(q.tier, tier, '「' + q.q + '」に難易度が付いている');
      });
      Q.pickQuestions(tier, 3, {}).forEach((q) => {
        assertEqual(q.tier, tier, '抽選で取り出しても難易度が残る');
        assertEqual(Q.shuffleChoices(q).tier, tier, '選択肢を混ぜても難易度が残る');
      });
    });
  });

  await r.test('取り出した問題を書き換えても、バンクは壊れない', async () => {
    const first = Q.questionsOf('easy')[0];
    const text = first.q;
    first.q = '書き換えた';
    first.choices[0] = '書き換えた';
    assertEqual(Q.questionsOf('easy')[0].q, text, 'バンク側は元のまま');
    assert(Q.questionsOf('easy')[0].choices[0] !== '書き換えた', '選択肢も元のまま');
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

  await r.test('指示55：どの問題にも根拠がある（無いものは足せない形にする）', async () => {
    /**
     * 指示55 2-5：**問題バンクに根拠の欄を持たせ、無い問題は赤にする。**
     * 今後、記憶だけで問題を足せない形にするための門。
     *
     * 82問を2段構え（校正→反証）で読んだら、**異議69件のうち33件が「根拠が弱い」**で、
     * 出典のURLを開き直すと**主張がそこに書かれていなかった**（301で販促ページ・403・
     * SPAで条文が返らない・404）。**URLを貼っただけでは根拠にならない。**
     * ここで見られるのは「欄が埋まっているか」までで、**中身が本当かは人が読む**——
     * だからこそ、空欄を通してはいけない
     */
    const 空 = [];
    Q.TIERS.forEach((tier) => {
      Q.QUESTIONS[tier].forEach((q, i) => {
        const s2 = q.source;
        if (!s2 || typeof s2 !== "string" || s2.trim().length < 10) {
          空.push(tier + " の " + (i + 1) + "問目「" + q.q + "」");
        }
      });
    });
    assertEqual(空.length, 0, "根拠の無い問題がある：" + 空.slice(0, 8).join("・"));
    const 総数 = Q.TIERS.reduce((n, t) => n + Q.countOf(t), 0);
    console.log("    根拠つきの問題：" + 総数 + " / " + 総数);
  });

  await r.test("指示55：根拠は、たどれる形で書いてある", async () => {
    // URLも出典名も無い「〜で確認」だけの1行は、**次に読む人がたどれない**。
    // 中身の真偽までは見られないが、**たどれるかどうか**は機械で見られる
    const たどれない = [];
    Q.TIERS.forEach((tier) => {
      Q.QUESTIONS[tier].forEach((q, i) => {
        if ((q.source || "").indexOf("http") === -1) たどれない.push(tier + "[" + i + "]" + q.q);
      });
    });
    assertEqual(たどれない.length, 0, "URLの無い根拠がある：" + たどれない.slice(0, 6).join("・"));
  });

  // ---- つぎつぎクイズの別名（指示55） ----
  //
  // 棚卸しで、**11お題すべてで「正しいのに弾かれる」**が起きていた。
  // normalize は漢字も接尾辞も触らないので、
  //   ・野球のポジション … 正式名称9つ（投手・捕手…）が全部 wrong
  //   ・都道府県         … 「東京」「大阪」（接尾辞なし）が全部 wrong
  // そして罰は減点ではなく退場（quiz-room.js の脱落形式）。
  //
  // ここの見張りは**手書きの一覧を持たない**（落とし穴4）。
  // 「漢字を含む答えには、かなで打つ道がある」のように
  // **データから導ける決まり**で書くので、お題を足した日にも自動で効く。

  const KANJI = /[一-鿿々]/;

  await r.test('つぎつぎクイズ：別名の正本が、かならず実在する', async () => {
    Q.listTopicsOf().forEach((t) => {
      const alias = t.alias || {};
      Object.keys(alias).forEach((k) => {
        assert(t.answers.indexOf(alias[k]) !== -1,
          t.topic + '：別名「' + k + '」の正本「' + alias[k] + '」が answers に無い');
      });
    });
  });

  await r.test('つぎつぎクイズ：別名が、別の答えとぶつからない', async () => {
    // ぶつかると「同じ打ち方で2つの答えが当たる」か「別名が既存の答えを乗っ取る」。
    // どちらも、遊ぶ人には理由の分からない誤判定になる
    Q.listTopicsOf().forEach((t) => {
      const owner = {};
      t.answers.forEach((a) => {
        const n = Q.normalize(a);
        assert(owner[n] === undefined, t.topic + '：答えどうしが同じ読み「' + a + '」と「' + owner[n] + '」');
        owner[n] = a;
      });
      Object.keys(t.alias || {}).forEach((k) => {
        const n = Q.normalize(k);
        const to = t.alias[k];
        assert(owner[n] === undefined || owner[n] === to,
          t.topic + '：別名「' + k + '」→「' + to + '」が、すでに「' + owner[n] + '」を指している');
        owner[n] = to;
      });
    });
  });

  await r.test('つぎつぎクイズ：無駄な別名を持たない', async () => {
    // normalize が既に吸収するもの（全角の数字・カタカナ・長音など）を別名に書くと、
    // **同じ鍵が2つできる**。持つと、片方を消した日に「なぜか弾かれる」が静かに始まる。
    // 落とし穴4 の型——手で持つものは、持たないで済むなら持たない
    const 無駄 = [];
    Q.listTopicsOf().forEach((t) => {
      const seen = {};
      Object.keys(t.alias || {}).forEach((k) => {
        const n = Q.normalize(k);
        if (seen[n]) 無駄.push(t.topic + '：「' + k + '」と「' + seen[n] + '」');
        seen[n] = k;
        if (n === Q.normalize(t.alias[k])) 無駄.push(t.topic + '：「' + k + '」は正本と同じ読み');
      });
    });
    assertEqual(無駄.length, 0, 'normalize が既に吸収する別名がある：' + 無駄.slice(0, 8).join('・'));
  });

  await r.test('つぎつぎクイズ：漢字の答えには、かなで打つ道がある', async () => {
    // normalize は漢字を1文字も触らない。だから漢字だけの答えは、
    // 読みで打った人を必ず弾く。**お題を足した日にも効くよう、データから導く**
    const 抜け = [];
    Q.listTopicsOf().forEach((t) => {
      t.answers.forEach((a) => {
        if (!KANJI.test(a)) return;
        const 読み = Object.keys(t.alias || {})
          .filter((k) => t.alias[k] === a && !KANJI.test(k));
        if (!読み.length) 抜け.push(t.topic + '「' + a + '」');
      });
    });
    assertEqual(抜け.length, 0, 'かなで打てない答えがある：' + 抜け.slice(0, 12).join('・'));
  });

  await r.test('つぎつぎクイズ：接尾辞をそろえた一覧は、接尾辞なしでも通る', async () => {
    // 「都道府県」「県庁所在地」のように、**全件が同じ語で終わる**お題は、
    // 遊ぶ人が接尾辞を省いて打つ。「東京」「札幌」で弾くのは理不尽。
    // お題名を見ないで、**全件が終わる語が同じか**だけで判定する（落とし穴4）
    const 接尾 = ['都', '道', '府', '県', '市', '区'];
    Q.listTopicsOf().forEach((t) => {
      const 全件が接尾辞つき = t.answers.every((a) => 接尾.some((s) => a.endsWith(s)));
      if (!全件が接尾辞つき) return;
      const 抜け = t.answers.filter((a) => {
        const 素 = a.slice(0, -1);
        // 1文字になってしまうもの（「北海道」→「北海」等）は、素の形が言葉にならない
        if (素.length < 2) return false;
        return Q.canonicalOf(t, 素) !== a;
      });
      assertEqual(抜け.length, 0,
        t.topic + '：接尾辞なしで打つと弾かれる（' + 抜け.slice(0, 8).join('・') + '）');
    });
  });

  await r.test('つぎつぎクイズ：別名で言い直しても、2回は得点しない', async () => {
    // ここが器を先に直した理由。別名を answers に素で足すと、
    // 「札幌市」のあとに「札幌」が通って同じ答えが2回入る
    let 試した = 0;
    Q.listTopicsOf().forEach((t) => {
      Object.keys(t.alias || {}).forEach((k) => {
        const 正本 = t.alias[k];
        assertEqual(Q.judgeListAnswer(t, k, [正本]), 'duplicate',
          t.topic + '：「' + 正本 + '」のあとに別名「' + k + '」が通ってしまう');
        assertEqual(Q.judgeListAnswer(t, 正本, [k]), 'duplicate',
          t.topic + '：別名「' + k + '」のあとに正本「' + 正本 + '」が通ってしまう');
        試した++;
      });
    });
    assert(試した > 0, '別名が1つも無い（検体が作れていない・型(b)）');
    console.log('    別名の総数：' + 試した);
  });

  r.finish();
})();
