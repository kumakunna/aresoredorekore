// quiz-bank.js — クイズ系ゲームの問題バンク（第29弾-6）
//
// なぜ作ったか:
//   クイズ解除・クイズラッシュ・つぎつぎクイズ・とくとくクイズ・早押しトーナメントは、
//   ゲーム中にAIを呼ばない方針に変えた。ライブ生成は失敗率が無視できず、
//   遊んでいる最中に止まるのが一番まずいため。
//   代わりに、あらかじめ作り込んだ問題をここから出す。
//   （あれそれどれこれのAI読み上げだけは対象外。封印ワードが毎回変わるので今まで通り）
//
// このファイルは DOM も socket.io も知らない。Node.js から require できる。
//
// ---- 問題の形 ----
//   { q: '問題文', choices: ['選択肢', ...], correct: 正解の位置(0始まり), tier: '難易度' }
//
// ---- 選択肢を作る時の決まり（ここが品質の要） ----
//   不正解の選択肢は、正解と「同じジャンル・同じくらいの知名度」のものにする。
//   ジャンルがばらけていると、内容を知らなくても消去法で当たってしまう。
//   例）× 富士山 / 東京タワー / カレーライス   ← 1つだけ食べ物で浮いている
//       ○ 富士山 / 北岳 / 奥穂高岳             ← どれも日本の高い山
//
// ---- 難易度の目安 ----
//   easy     … 小学生でも知っている
//   normal   … 大人ならだいたい知っている
//   hard     … 知っている人は知っている
//   nanisore … 知らない人の方が多い
//   muri     … 詳しい人だけが分かる

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QuizBank = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TIERS = ['easy', 'normal', 'hard', 'nanisore', 'muri'];

  // ================= 3択・4択の問題 =================
  var QUESTIONS = {
    easy: [
      { q: '日本でいちばん高い山は？', choices: ['富士山', '北岳', '槍ヶ岳'], correct: 0 },
      { q: '1年は何日？（うるう年でない年）', choices: ['365日', '360日', '366日'], correct: 0 },
      { q: '虹はふつう何色といわれる？', choices: ['7色', '5色', '9色'], correct: 0 },
      { q: '日本の首都は？', choices: ['東京', '大阪', '京都'], correct: 0 },
      { q: '「桃太郎」が腰につけていた食べ物は？', choices: ['きびだんご', 'おにぎり', 'せんべい'], correct: 0 },
      { q: '信号の「進んでよい」色は？', choices: ['青', '黄', '赤'], correct: 0 },
      { q: 'パンダの体の色の組み合わせは？', choices: ['白と黒', '茶と白', '灰と黒'], correct: 0 },
      { q: '1週間は何日？', choices: ['7日', '5日', '10日'], correct: 0 },
      { q: '水がこおる温度は？', choices: ['0度', '10度', '100度'], correct: 0 },
      { q: '日本のお金の単位は？', choices: ['円', 'ドル', 'ウォン'], correct: 0 },
      { q: 'サッカーは1チーム何人でプレーする？', choices: ['11人', '9人', '15人'], correct: 0 },
      { q: '「いろは」で始まる文字は全部で何文字？', choices: ['47文字', '50文字', '45文字'], correct: 0 },
      { q: 'カタツムリが背負っているものは？', choices: ['殻', '甲羅', '巣'], correct: 0 },
      { q: '太陽がのぼる方角は？', choices: ['東', '西', '南'], correct: 0 },
      { q: '「うるう年」は何年に一度くる？', choices: ['4年', '2年', '10年'], correct: 0 },
      { q: 'ひまわりの花の色は？', choices: ['黄', '青', '紫'], correct: 0 },
      { q: '日本で一番大きい湖は？', choices: ['琵琶湖', '霞ヶ浦', '猪苗代湖'], correct: 0 },
      { q: 'ぞうの鼻はどこが伸びたもの？', choices: ['鼻と上くちびる', '口', '耳'], correct: 0 },
      { q: '1ダースは何個？', choices: ['12個', '10個', '20個'], correct: 0 },
      { q: '「ドレミ」の次は？', choices: ['ファ', 'ソ', 'シ'], correct: 0 },
      { q: '雪が積もる季節は？', choices: ['冬', '夏', '春'], correct: 0 },
      { q: 'カレーによく入っている、辛い黄色い粉は？', choices: ['カレー粉', '小麦粉', '片栗粉'], correct: 0 },
      { q: '日本の国旗の真ん中の色は？', choices: ['赤', '青', '黒'], correct: 0 },
      { q: 'にわとりが産むものは？', choices: ['たまご', 'ミルク', 'はちみつ'], correct: 0 },
      { q: '「あいうえお」の次の行は？', choices: ['かきくけこ', 'さしすせそ', 'たちつてと'], correct: 0 }
    ],
    normal: [
      { q: '日本で一番長い川は？', choices: ['信濃川', '利根川', '石狩川'], correct: 0 },
      { q: '「源氏物語」を書いたのは？', choices: ['紫式部', '清少納言', '和泉式部'], correct: 0 },
      { q: '光の三原色は赤・緑と、あと1つは？', choices: ['青', '黄', '白'], correct: 0 },
      { q: '人間の骨はおよそ何本？', choices: ['約200本', '約100本', '約400本'], correct: 0 },
      { q: 'オリンピックは何年に一度？（夏季）', choices: ['4年', '2年', '5年'], correct: 0 },
      { q: '「鳴くよウグイス」で覚える年に都が移った先は？', choices: ['平安京', '平城京', '長岡京'], correct: 0 },
      { q: '地球から見て、いちばん近い恒星は？', choices: ['太陽', 'シリウス', 'ケンタウルス座アルファ星'], correct: 0 },
      { q: '五重塔で有名な、奈良の世界最古の木造建築は？', choices: ['法隆寺', '東大寺', '薬師寺'], correct: 0 },
      { q: '血液型で日本に一番多いのは？', choices: ['A型', 'O型', 'B型'], correct: 0 },
      { q: '「万有引力」を発見したとされるのは？', choices: ['ニュートン', 'ガリレオ', 'アインシュタイン'], correct: 0 },
      { q: '日本の都道府県はいくつ？', choices: ['47', '43', '50'], correct: 0 },
      { q: 'ピアノの鍵盤は全部で何鍵が標準？', choices: ['88鍵', '76鍵', '61鍵'], correct: 0 },
      { q: '「関ヶ原の戦い」で勝ったのは？', choices: ['徳川家康', '石田三成', '豊臣秀頼'], correct: 0 },
      { q: '空気中に一番多く含まれる気体は？', choices: ['窒素', '酸素', '二酸化炭素'], correct: 0 },
      { q: 'マラソンの距離は？', choices: ['42.195km', '40km', '45km'], correct: 0 },
      { q: '「ハムレット」を書いたのは？', choices: ['シェイクスピア', 'ゲーテ', 'トルストイ'], correct: 0 },
      { q: '日本で一番面積が大きい都道府県は？', choices: ['北海道', '岩手県', '福島県'], correct: 0 },
      { q: '音の速さは秒速およそ何メートル？', choices: ['約340m', '約100m', '約1000m'], correct: 0 },
      { q: '「モナ・リザ」を描いたのは？', choices: ['レオナルド・ダ・ヴィンチ', 'ミケランジェロ', 'ラファエロ'], correct: 0 },
      { q: '将棋で、最初に持っている駒は何枚？', choices: ['20枚', '16枚', '24枚'], correct: 0 }
    ],
    hard: [
      { q: '日本で2番目に高い山は？', choices: ['北岳', '奥穂高岳', '間ノ岳'], correct: 0 },
      { q: '元素記号「W」の元素は？', choices: ['タングステン', 'ウラン', 'バナジウム'], correct: 0 },
      { q: '「枕草子」の書き出しは？', choices: ['春はあけぼの', 'ゆく河の流れは', '祇園精舎の鐘の声'], correct: 0 },
      { q: '世界で一番面積が小さい国は？', choices: ['バチカン市国', 'モナコ', 'サンマリノ'], correct: 0 },
      { q: '「フィボナッチ数列」の最初の6つは1,1,2,3,5と、次は？', choices: ['8', '7', '9'], correct: 0 },
      { q: '日本国憲法が施行された年は？', choices: ['1947年', '1946年', '1950年'], correct: 0 },
      { q: 'オーケストラで、指揮者から見て一番左に座るのは？', choices: ['第1ヴァイオリン', 'チェロ', 'ヴィオラ'], correct: 0 },
      { q: '「ゲルニカ」を描いたのは？', choices: ['ピカソ', 'ダリ', 'ミロ'], correct: 0 },
      { q: '人体で一番大きい臓器は？', choices: ['皮膚', '肝臓', '肺'], correct: 0 },
      { q: '囲碁の盤は何路盤が標準？', choices: ['19路', '13路', '9路'], correct: 0 },
      { q: '「白鳥の湖」を作曲したのは？', choices: ['チャイコフスキー', 'ストラヴィンスキー', 'ラフマニノフ'], correct: 0 },
      { q: '日本で最初の鉄道が開通した区間は？', choices: ['新橋〜横浜', '上野〜青森', '東京〜大阪'], correct: 0 },
      { q: '光年は何の単位？', choices: ['距離', '時間', '明るさ'], correct: 0 },
      { q: '「徒然草」の作者は？', choices: ['兼好法師', '鴨長明', '西行'], correct: 0 },
      { q: '世界一長い川は？', choices: ['ナイル川', 'アマゾン川', '長江'], correct: 0 }
    ],
    nanisore: [
      { q: 'アメンボが水に浮くのに使っている力は？', choices: ['表面張力', '浮力', '静電気'], correct: 0 },
      { q: '「シャルル・ド・ゴール」は何の名前になっている？', choices: ['パリの空港', 'ロンドンの駅', 'ベルリンの橋'], correct: 0 },
      { q: 'カフェオレとカフェラテの違いは？', choices: ['ベースがドリップかエスプレッソか', '牛乳の量', '砂糖の有無'], correct: 0 },
      { q: '「シジフォスの岩」の話で、岩はどうなる？', choices: ['頂上の手前で転げ落ちる', '砕ける', '軽くなる'], correct: 0 },
      { q: 'ピタゴラスが発見したとされる音楽と数の関係は？', choices: ['弦の長さの比が和音を作る', '音は空気の重さで決まる', '音階は12個'], correct: 0 },
      { q: '「デジャヴ」の反対の意味を持つ言葉は？', choices: ['ジャメヴ', 'プレスクヴ', 'ソワヴ'], correct: 0 },
      { q: 'ハチミツが腐らないおもな理由は？', choices: ['水分が非常に少ない', '酸性だから', '砂糖だから'], correct: 0 },
      { q: '南極と北極、平均気温が低いのは？', choices: ['南極', '北極', 'ほぼ同じ'], correct: 0 },
      { q: 'キーボードの並びが「QWERTY」になった理由の定説は？', choices: ['タイプライターの絡まりを減らすため', '英語で打ちやすいため', '特許を避けるため'], correct: 0 },
      { q: '「オーロラ」が光る原因は？', choices: ['太陽風と大気の衝突', '氷の反射', '磁石の摩擦'], correct: 0 },
      { q: '一円玉の重さは？', choices: ['1グラム', '2グラム', '0.5グラム'], correct: 0 },
      { q: '「マグニチュード」が1増えると、エネルギーは約何倍？', choices: ['約32倍', '約10倍', '約2倍'], correct: 0 }
    ],
    muri: [
      { q: '「バウムクーヘン」はドイツ語で何という意味？', choices: ['木のケーキ', '丸いパン', '重ねた菓子'], correct: 0 },
      { q: 'モールス信号で「SOS」の最初の S は？', choices: ['トトト', 'ツーツーツー', 'トツート'], correct: 0 },
      { q: '「ゲシュタルト崩壊」が起きやすいのはどんな時？', choices: ['同じ字を見続けた時', '暗い所にいる時', '疲れている時'], correct: 0 },
      { q: 'ハンガリー語・フィンランド語が属する語族は？', choices: ['ウラル語族', 'インド・ヨーロッパ語族', 'アルタイ語族'], correct: 0 },
      { q: '「アボガドロ定数」はおよそ？', choices: ['6.02×10^23', '3.14×10^10', '9.81×10^5'], correct: 0 },
      { q: '囲碁で「劫（コウ）」とは？', choices: ['同じ形の繰り返しを禁じる決まり', '端の石', '二眼の形'], correct: 0 },
      { q: '「テセウスの船」が問うているのは？', choices: ['同一性とは何か', '船の速さ', '海の広さ'], correct: 0 },
      { q: 'カラヴァッジョの絵の特徴といえば？', choices: ['強い明暗の対比', '点描', '淡い色彩'], correct: 0 },
      { q: '「ワルシャワ条約機構」に対抗していたのは？', choices: ['NATO', 'EU', '国連'], correct: 0 },
      { q: '将棋の「千日手」は同じ局面が何回現れると成立する？', choices: ['4回', '3回', '5回'], correct: 0 }
    ]
  };

  // ================= つぎつぎクイズ用（答えが多数あるお題） =================
  // 正誤・重複の判定はこの一覧と突き合わせる（AIは使わない）。
  // 表記ゆれを拾うため、ひらがな・カタカナ・記号の違いは normalize で吸収する。
  var LIST_TOPICS = [
    { topic: '赤い食べ物', tier: 'easy',
      answers: ['りんご', 'いちご', 'トマト', 'さくらんぼ', 'すいか', 'パプリカ', 'にんじん', 'ラズベリー', 'ざくろ', '赤ピーマン', 'かに', 'まぐろ', 'いくら', 'あずき', 'たこ'] },
    { topic: '日本の都道府県', tier: 'easy',
      answers: ['北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県', '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県', '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県', '静岡県', '愛知県', '三重県', '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県', '鳥取県', '島根県', '岡山県', '広島県', '山口県', '徳島県', '香川県', '愛媛県', '高知県', '福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県'] },
    { topic: '野球のポジション', tier: 'easy',
      answers: ['ピッチャー', 'キャッチャー', 'ファースト', 'セカンド', 'サード', 'ショート', 'レフト', 'センター', 'ライト'] },
    { topic: '十二支', tier: 'easy',
      answers: ['ねずみ', 'うし', 'とら', 'うさぎ', 'たつ', 'へび', 'うま', 'ひつじ', 'さる', 'とり', 'いぬ', 'いのしし'] },
    { topic: '緑の野菜', tier: 'easy',
      answers: ['ピーマン', 'きゅうり', 'ほうれん草', 'ブロッコリー', 'キャベツ', 'レタス', 'アスパラガス', 'オクラ', '枝豆', 'にら', '小松菜', 'そら豆', 'ズッキーニ', 'セロリ', '春菊'] },
    { topic: '楽器', tier: 'normal',
      answers: ['ピアノ', 'ギター', 'バイオリン', 'フルート', 'トランペット', 'ドラム', 'チェロ', 'クラリネット', 'サックス', 'ハープ', '三味線', '琴', '太鼓', 'オーボエ', 'トロンボーン', 'ホルン', 'ティンパニ', 'ウクレレ', 'ベース', 'ビオラ'] },
    { topic: '太陽系の惑星', tier: 'normal',
      answers: ['水星', '金星', '地球', '火星', '木星', '土星', '天王星', '海王星'] },
    { topic: '寿司ネタ', tier: 'normal',
      answers: ['まぐろ', 'サーモン', 'えび', 'いか', 'たこ', 'たまご', 'いくら', 'うに', 'あなご', 'はまち', 'たい', 'ほたて', 'あじ', 'かんぱち', 'こはだ', 'ねぎとろ', 'つぶ貝', 'えんがわ'] },
    { topic: '47都道府県の県庁所在地', tier: 'hard',
      answers: ['札幌市', '青森市', '盛岡市', '仙台市', '秋田市', '山形市', '福島市', '水戸市', '宇都宮市', '前橋市', 'さいたま市', '千葉市', '新宿区', '横浜市', '新潟市', '富山市', '金沢市', '福井市', '甲府市', '長野市', '岐阜市', '静岡市', '名古屋市', '津市', '大津市', '京都市', '大阪市', '神戸市', '奈良市', '和歌山市', '鳥取市', '松江市', '岡山市', '広島市', '山口市', '徳島市', '高松市', '松山市', '高知市', '福岡市', '佐賀市', '長崎市', '熊本市', '大分市', '宮崎市', '鹿児島市', '那覇市'] },
    { topic: '歴代の内閣総理大臣', tier: 'hard',
      answers: ['伊藤博文', '黒田清隆', '山縣有朋', '松方正義', '大隈重信', '桂太郎', '西園寺公望', '原敬', '高橋是清', '加藤高明', '若槻礼次郎', '田中義一', '浜口雄幸', '犬養毅', '斎藤実', '岡田啓介', '広田弘毅', '近衛文麿', '東條英機', '吉田茂', '片山哲', '芦田均', '鳩山一郎', '石橋湛山', '岸信介', '池田勇人', '佐藤栄作', '田中角栄', '三木武夫', '福田赳夫', '大平正芳', '鈴木善幸', '中曽根康弘', '竹下登', '宇野宗佑', '海部俊樹', '宮澤喜一', '細川護熙', '羽田孜', '村山富市', '橋本龍太郎', '小渕恵三', '森喜朗', '小泉純一郎', '安倍晋三', '福田康夫', '麻生太郎', '鳩山由紀夫', '菅直人', '野田佳彦', '菅義偉', '岸田文雄'] },
    { topic: '元素記号1文字の元素', tier: 'nanisore',
      answers: ['水素', 'ホウ素', '炭素', '窒素', '酸素', 'フッ素', 'リン', '硫黄', 'カリウム', 'バナジウム', 'イットリウム', 'ヨウ素', 'タングステン', 'ウラン'] }
  ];

  // ---- 表記ゆれの吸収 ----
  // カタカナ→ひらがな、記号・空白・長音の違いを消して比べる。
  // ここが緩すぎると誤答が通り、厳しすぎると正解が弾かれる。
  // 「読みが同じなら同じ」くらいを狙っている。
  function normalize(s) {
    return String(s == null ? '' : s)
      .trim()
      .replace(/[ァ-ヶ]/g, function (c) {   // カタカナ→ひらがな
        return String.fromCharCode(c.charCodeAt(0) - 0x60);
      })
      .replace(/[ぁぃぅぇぉっゃゅょ]/g, function (c) { // 小文字→大文字（きゃ＝きや）
        return 'あいうえおつやゆよ'['ぁぃぅぇぉっゃゅょ'.indexOf(c)];
      })
      .replace(/[ー・\s　,、。･]/g, '')
      .toLowerCase();
  }

  // つぎつぎクイズの答え合わせ。
  // @returns {'correct'|'duplicate'|'wrong'}
  function judgeListAnswer(topic, answer, alreadySaid) {
    var got = normalize(answer);
    if (!got) return 'wrong';
    var said = (alreadySaid || []).map(normalize);
    if (said.indexOf(got) !== -1) return 'duplicate';
    var hit = (topic.answers || []).some(function (a) { return normalize(a) === got; });
    return hit ? 'correct' : 'wrong';
  }

  // ---- 取り出し ----
  function questionsOf(tier) { return (QUESTIONS[tier] || []).slice(); }
  function countOf(tier) { return (QUESTIONS[tier] || []).length; }
  function allCounts() {
    var out = {};
    TIERS.forEach(function (t) { out[t] = countOf(t); });
    return out;
  }
  function listTopicsOf(tier) {
    if (!tier) return LIST_TOPICS.slice();
    return LIST_TOPICS.filter(function (t) { return t.tier === tier; });
  }

  // 同じ問題を続けて出さないための抽選。使い切ったら復活する（お題プールと同じ考え方）
  function pickQuestions(tier, n, used, rnd) {
    var r = rnd || Math.random;
    var pool = questionsOf(tier);
    var fresh = pool.filter(function (q) { return !(used || {})[q.q]; });
    var bank = fresh.length >= n ? fresh : pool;
    var a = bank.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(r() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a.slice(0, Math.min(n, a.length));
  }

  // 選択肢の並びは出すたびに変える（位置で覚えられないように）。
  // 正解の位置も一緒に動かす
  function shuffleChoices(q, rnd) {
    var r = rnd || Math.random;
    var pairs = q.choices.map(function (c, i) { return { c: c, correct: i === q.correct }; });
    for (var i = pairs.length - 1; i > 0; i--) {
      var j = Math.floor(r() * (i + 1));
      var t = pairs[i]; pairs[i] = pairs[j]; pairs[j] = t;
    }
    return {
      q: q.q,
      choices: pairs.map(function (p) { return p.c; }),
      correct: pairs.findIndex(function (p) { return p.correct; }),
      tier: q.tier
    };
  }

  return {
    TIERS: TIERS, QUESTIONS: QUESTIONS, LIST_TOPICS: LIST_TOPICS,
    questionsOf: questionsOf, countOf: countOf, allCounts: allCounts,
    listTopicsOf: listTopicsOf, pickQuestions: pickQuestions,
    shuffleChoices: shuffleChoices,
    normalize: normalize, judgeListAnswer: judgeListAnswer
  };
}));
