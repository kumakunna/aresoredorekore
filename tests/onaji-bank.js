// tests/onaji-bank.js — 「みんなと同じ」のお題の検査（指示68-3 門5）
//
// 選択肢が3〜4・同じお題がない・出さない言葉が入っていない（体・見た目・恋愛・家族・成績・お金・宗教・政治・病気・だれか1人を選ばせる物）。
// 中身が人を傷つけないかは機械には見えない——言葉で止められる物だけ止める。最後は Claude（チャット）が読んで通した物だけ APPROVED に入れる
const fs = require('fs');
const path = require('path');
const { createRunner, assert, assertEqual } = require('./harness');
const B = require('../public/js/onaji-bank');

// 出さない言葉。部分一致で見る（「神経衰弱」の「神」のような、ほかの意味の語も止まる＝書き方を変える）
const 出さない = ['体重', '身長', '顔', '見た目', 'かわいい', 'かっこいい', 'ブス', 'デブ', '太', 'やせ', '恋', '好きな人', '彼氏', '彼女', 'デート',
  '家族', '親', 'お父さん', 'お母さん', '兄', '姉', '弟', '妹', '成績', 'テスト', '点数', '通知表', 'お金', '円', 'こづかい', 'お年玉',
  '宗教', '神', '仏', '教会', 'おみくじ', '政治', '選挙', '病気', '病院', '薬', 'けが', 'この中で', 'だれ', '誰'];

(async function main() {
  const r = createRunner('onaji-bank：みんなと同じのお題（指示68-3）');
  const 全部 = B.APPROVED.concat(B.DRAFT);

  await r.test('門5：選択肢は3つか4つ・空の選択肢がない・同じ選択肢が2つない', async () => {
    assert(全部.length >= 100, 'お題を数えられている（' + 全部.length + '）');   // 型(b)
    全部.forEach((t) => {
      assert(t.q && t.q.length >= 4, 'お題の文がある：' + JSON.stringify(t));
      assert(t.choices.length === 3 || t.choices.length === 4, t.q + '：選択肢は3つか4つ（' + t.choices.length + '）');
      assert(t.choices.every((c) => c && c.trim()), t.q + '：空の選択肢がない');
      assertEqual(new Set(t.choices).size, t.choices.length, t.q + '：同じ選択肢が2つない');
    });
  });

  await r.test('門5：同じお題がない（本番と下書きをまたいでも）', async () => {
    const 見た = new Set(), 重なり = [];
    全部.forEach((t) => { if (見た.has(t.q)) 重なり.push(t.q); 見た.add(t.q); });
    assertEqual(重なり.join('・'), '', '同じお題');
  });

  await r.test('門5：出さない言葉が入っていない（体・見た目・恋愛・家族・成績・お金・宗教・政治・病気・だれか1人を選ばせる物）', async () => {
    const 悪い = [];
    全部.forEach((t) => {
      const 字 = t.q + ' ' + t.choices.join(' ');
      出さない.forEach((w) => { if (字.indexOf(w) !== -1) 悪い.push(t.q + '（' + w + '）'); });
    });
    assertEqual(悪い.join('・'), '', '出さない言葉');
    // 型(b)：言葉の見張りが効いている
    assert(['この中でいちばん足がはやいのは？'].some((q) => 出さない.some((w) => q.indexOf(w) !== -1)), '見張りが「この中で」を止める');
  });

  await r.test('本番の箱は Claude（チャット）が通した物だけ。空の間は下書きを使い、そうと分かる（usingDraft）', async () => {
    assertEqual(B.usingDraft(), B.APPROVED.length === 0, '下書きを使っているか');
    assertEqual(B.topics().length, (B.APPROVED.length || B.DRAFT.length), '使うお題');
    // 下書きの文書と、下書きの箱が同じ数（片方だけ直さない）
    const doc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'みんなと同じ_お題の下書き.md'), 'utf8');
    B.DRAFT.forEach((t) => assert(doc.indexOf(t.q) !== -1, '下書きの文書にある：' + t.q));
  });

  await r.test('5問えらぶ：同じお題を続けて出さない（使ったお題は後回し）', async () => {
    const used = {};
    const a = B.pick(5, used, () => 0.3);
    assertEqual(a.length, 5, '5問');
    a.forEach((t) => { used[t.q] = true; });
    const b = B.pick(5, used, () => 0.3);
    assert(b.every((t) => !used[t.q]), '使ったお題は次に出ない');
  });

  r.finish();
})();
