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
    assert(全部.length >= 98, 'お題を数えられている（' + 全部.length + '）');   // 型(b)
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

  await r.test('にげ道の選択肢が無い（「どっちも」「人による」「わからない」「なにも〜」など）', async () => {
    // Claude（チャット）の確認 2026-10-26：どちらにも付かない答えがあると、みんながそこに集まり、
    // 考えなくても当たるので盛り上がらない。これから作るお題（下書きも）にも入れない
    const にげ道 = [/^どっちも$/, /^どちらも$/, /^りょうほう$/, /人による/, /わからない/, /^とくにない$/, /^なにも/, /^なんでも$/, /^いない$/, /^ない$/, /^その他$/, /^ほか$/];
    const 悪い = [];
    全部.forEach((t) => t.choices.forEach((c) => { if (にげ道.some((re) => re.test(c))) 悪い.push(t.q + '（' + c + '）'); }));
    assertEqual(悪い.join('・'), '', 'にげ道の選択肢');
    // 型(b)：見張りが本当に止める（直す前のお題の形で）
    ['どっちも', '人による', 'なにもぬらない', 'わからない'].forEach((c) =>
      assert(にげ道.some((re) => re.test(c)), '見張りが「' + c + '」を止める'));
    assert(!にげ道.some((re) => re.test('食べない')), '「食べない」（ふつうの答え）は止めない');
  });

  await r.test('本番の箱は Claude（チャット）が通した物だけ。空の間は下書きを使い、そうと分かる（usingDraft）', async () => {
    assertEqual(B.usingDraft(), B.APPROVED.length === 0, '下書きを使っているか');
    assertEqual(B.topics().length, (B.APPROVED.length || B.DRAFT.length), '使うお題');
    // 文書（docs/みんなと同じ_お題の下書き.md）と箱が両方向で同じ（片方だけ直さない）。選択肢まで照らす
    const doc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'みんなと同じ_お題の下書き.md'), 'utf8');
    const 行 = Array.from(doc.matchAll(/^\| \d+ \| (.+?) \| (.+?) \|$/gm)).map((m) => m[1] + '＝' + m[2]);
    const 箱 = 全部.map((t) => t.q + '＝' + t.choices.join('／'));
    assert(行.length >= 98, '文書の行を読めた（' + 行.length + '）');
    assertEqual(箱.filter((x) => 行.indexOf(x) === -1).join('・'), '', '箱にあって文書に無い（または選択肢がちがう）');
    assertEqual(行.filter((x) => 箱.indexOf(x) === -1).join('・'), '', '文書にあって箱に無い（または選択肢がちがう）');
  });

  await r.test('指示68-T 8：あそびテストのあとで直した14個（一覧の文書と箱が同じ・数は98個のまま）', async () => {
    assertEqual(B.APPROVED.length, 98, '本番のお題は98個のまま');
    const 箱 = B.APPROVED.map((t) => t.q + '＝' + t.choices.join('／'));
    const 直した = ['からあげにレモンは？＝かける／かけない／自分の分だけかける', 'グミ・ガム・あめ、えらぶなら？＝グミ／ガム／あめ',
      '花火といえば？＝打ち上げ花火／線香花火／ねずみ花火', 'おにごっこといえば？＝ふつうのおに／こおりおに／いろおに／ふえおに',
      'あやとり・けん玉・こま、えらぶなら？＝あやとり／けん玉／こま', '雨の日のあそびは？＝ボードゲーム／おえかき／テレビゲーム／本を読む',
      'かくれんぼで隠れるなら？＝カーテンのうしろ／つくえの下／ドアのうしろ／おしいれ', '紙ひこうきを作るなら？＝とがった形／つばさが広い形／作れない',
      '黒板・ホワイトボード・タブレット、どれが好き？＝黒板／ホワイトボード／タブレット', '書くのに使うのは？＝えんぴつ／シャープペン／ボールペン',
      'もしも1日があと1時間長かったら？＝ねる／あそぶ／食べる／べんきょう', '好きな天気は？＝はれ／くもり／雨／雪',
      '夜空で見たいのは？＝オリオン座／北斗七星／天の川／流れ星', 'もらってうれしいのは？＝てがみ／メッセージ／電話'];
    assertEqual(直した.filter((x) => 箱.indexOf(x) === -1).join('・'), '', '直した14個が箱にある');
    // 名前を2つ挙げて選択肢が3つ、の形が残っていない（「AとB、」で始まるのに選択肢が3つ以上）
    assertEqual(B.APPROVED.filter((t) => /^[^、・]+と[^、・]+、/.test(t.q) && t.choices.length > 2).map((t) => t.q).join('・'), '', '「AとB、」なのに選択肢が3つ以上');
    // 一覧の文書（docs/みんなと同じ_お題の一覧.md）も箱と両方向で同じ
    const doc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'みんなと同じ_お題の一覧.md'), 'utf8');
    const 行 = Array.from(doc.matchAll(/^\| \d+ \| (.+?) \| (.+?) \|$/gm)).map((m) => m[1] + '＝' + m[2]);
    assertEqual(行.length, 98, '一覧の行は98');
    assertEqual(箱.filter((x) => 行.indexOf(x) === -1).join('・'), '', '箱にあって一覧に無い');
    assertEqual(行.filter((x) => 箱.indexOf(x) === -1).join('・'), '', '一覧にあって箱に無い');
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
