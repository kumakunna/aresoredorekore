// auction-items.js — オークションバトルの品物プール（第31弾 第3部-2）
//
// ゲーム中にAIは呼ばない（第29弾-6の方針）。ここに書いてあるものだけを出す。
// レビュー用の一覧は docs/レビュー_オークション品物プール.md に出してある。
//
// ---- 品物の形 ----
//   { teaser: 出すときの謎めいた一言, tier: 価値の階層, value: もらえるチップ,
//     reveal: 正体, hints: [鑑定眼で1つ出るヒント] }
//
// ---- 設計でいちばん大事にしたこと（判断の記録）----
// 「価値の階層ごとに一言のプールを作る」と素直に作ると、
// 遊んでいるうちに『重そうな箱＝大当たり』と覚えられてしまう。
// 一言そのものが答えになったら、値をつける駆け引きが消える。
//
// そこで、**同じ一言を必ず2つ以上の階層で使い回す**形にした。
//   「古びた壺」… 大当たり（名品）でもあり、大ハズレ（ただの植木鉢）でもある
// こうすると、一言だけでは何も分からない。分かるのは「鑑定眼」で引いたヒントだけ。
// アイテムに意味が生まれ、他の人の入札額を読む遊びになる。
//
// この決まりはテストで見張っている（tests/auction-items.js）。
// 品物を足す時は、その一言が2つ以上の階層に出てくるようにすること。

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AuctionItems = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 価値の階層。value はチップ。大ハズレだけマイナス（払った上に損をする）
  var TIERS = [
    { id: 'jackpot', label: '大当たり', icon: '💎' },
    { id: 'good', label: '当たり', icon: '✨' },
    { id: 'plain', label: 'ふつう', icon: '📦' },
    { id: 'bad', label: 'ハズレ', icon: '🥀' },
    { id: 'dud', label: '大ハズレ', icon: '💀' }
  ];

  var ITEMS = [
    // ---- 古びた壺 ----
    { teaser: '古びた壺', tier: 'jackpot', value: 15,
      reveal: '三百年前の窯で焼かれた名品。専門家が見れば一目で分かる',
      hints: ['底に、消えかけた印が彫ってある', '持つと、思ったより軽い'] },
    { teaser: '古びた壺', tier: 'good', value: 8,
      reveal: '有名な作家の弟子が焼いたもの。本物ほどではないが値は付く',
      hints: ['印はあるが、少しにじんでいる', '同じ形のものを、前にも見た気がする'] },

    // ---- 重そうな箱 ----
    { teaser: '重そうな箱', tier: 'good', value: 9,
      reveal: '中身は銀の食器ひとそろい。使い込まれているが揃っている',
      hints: ['振ると、中で何かがぶつかる音がする', '角の金具だけ、やけに丁寧な作り'] },
    { teaser: '重そうな箱', tier: 'plain', value: 5,
      reveal: '中身は工具。よく手入れされていて、まだ使える',
      hints: ['持ち上げると、重さが片側に寄っている', '蓋の裏に、油の染みがある'] },

    // ---- 布にくるまれた何か ----
    { teaser: '布にくるまれた何か', tier: 'plain', value: 6,
      reveal: '古いミシン。動くし、部品も揃っている',
      hints: ['布ごしに、角ばった形がわかる', '布は新しく、最近包み直されたようだ'] },
    { teaser: '布にくるまれた何か', tier: 'bad', value: 2,
      reveal: '割れた鏡。枠だけは立派だが、直すのに手間がかかる',
      hints: ['布の内側に、細かい破片が落ちている', '包み方が雑で、急いで隠したように見える'] },

    // ---- ガラスケースの中の小さいもの ----
    { teaser: 'ガラスケースの中の小さいもの', tier: 'bad', value: 1,
      reveal: '土産物の記念コイン。作られた数が多すぎて、値が付かない',
      hints: ['同じものが、まだ何十個も倉庫にあるらしい', 'ケースの方が中身より新しい'] },
    { teaser: 'ガラスケースの中の小さいもの', tier: 'dud', value: -4,
      reveal: '虫の標本。保存が悪く、引き取り手を探すのに費用がかかる',
      hints: ['ケースの隅に、粉のようなものが溜まっている', '近づくと、かすかに薬品のにおいがする'] },

    // ---- 錆びた鍵 ----
    { teaser: '錆びた鍵', tier: 'dud', value: -3,
      reveal: 'どの扉にも合わない鍵。持ち主はとうに引っ越している',
      hints: ['歯の形が、途中で削り直されている', '同じ鍵が、束で見つかったらしい'] },
    { teaser: '錆びた鍵', tier: 'jackpot', value: 16,
      reveal: '銀行の貸金庫の鍵。中身ごと引き継げる',
      hints: ['番号が刻まれていて、まだ読み取れる', '錆びているのは表だけで、奥は光っている'] },

    // ---- 分厚い本 ----
    { teaser: '分厚い本', tier: 'jackpot', value: 14,
      reveal: '初版本。署名入りで、状態も良い',
      hints: ['最初のページだけ、紙の色が違う', '背表紙の糸が、手縫いになっている'] },
    { teaser: '分厚い本', tier: 'good', value: 7,
      reveal: '古い図鑑。挿絵が美しく、集めている人がいる',
      hints: ['ページの端に、細かい書き込みがある', '中ほどに、押し花が挟まっている'] },

    // ---- 折りたたまれた紙 ----
    { teaser: '折りたたまれた紙', tier: 'good', value: 10,
      reveal: '有名な建物の設計図。原本で、額装すれば飾れる',
      hints: ['折り目が均等で、丁寧に扱われてきた', '隅に、小さな判子が押してある'] },
    { teaser: '折りたたまれた紙', tier: 'plain', value: 4,
      reveal: '昔の路線図。懐かしがる人はいるが、数はある',
      hints: ['折り目が擦り切れて、破れかけている', '裏に、広告が印刷されている'] },

    // ---- 銀色のトランク ----
    { teaser: '銀色のトランク', tier: 'plain', value: 6,
      reveal: 'カメラ機材一式。型は古いが、レンズは無傷',
      hints: ['中に、仕切りの跡がきっちり残っている', '鍵は無いが、留め具は生きている'] },
    { teaser: '銀色のトランク', tier: 'bad', value: 2,
      reveal: '空のトランク。傷が多く、見た目より値が付かない',
      hints: ['持ち上げると、驚くほど軽い', '内側の布が、はがれかけている'] },

    // ---- 小さな木の彫り物 ----
    { teaser: '小さな木の彫り物', tier: 'bad', value: 1,
      reveal: '観光地の土産。同じものが今も売られている',
      hints: ['底に、機械で彫った跡がある', '木の目が、どこも同じ向きに揃っている'] },
    { teaser: '小さな木の彫り物', tier: 'dud', value: -5,
      reveal: '白蟻に食われている。他の荷物に移る前に処分がいる',
      hints: ['置いた場所に、細かい木くずが落ちる', '軽く押すと、表面がへこむ'] },

    // ---- ほこりをかぶった額縁 ----
    { teaser: 'ほこりをかぶった額縁', tier: 'dud', value: -4,
      reveal: '中の絵は複製。額も合板で、飾ると却って安く見える',
      hints: ['角の彫りが、左右でぴったり同じ', '裏板が、新しいねじで留められている'] },
    { teaser: 'ほこりをかぶった額縁', tier: 'jackpot', value: 17,
      reveal: '裏に、もう一枚別の絵が隠されていた',
      hints: ['厚みが、額の見た目より深い', '裏板だけ、あとから釘を打ち直してある'] },

    // ---- 丸められた絨毯 ----
    { teaser: '丸められた絨毯', tier: 'jackpot', value: 13,
      reveal: '手織りの一点もの。同じ模様は二つとない',
      hints: ['端の房が、一本ずつ結んである', '裏から見ると、模様が透けて見える'] },
    { teaser: '丸められた絨毯', tier: 'good', value: 8,
      reveal: '上等な機械織り。使用感はあるが、まだ長く使える',
      hints: ['模様の繰り返しが、きっちり揃っている', '裏に、織り工場の札が縫い付けてある'] },

    // ---- 革のカバン ----
    { teaser: '革のカバン', tier: 'good', value: 9,
      reveal: '古い工房の品。手入れをすれば、まだ何十年も使える',
      hints: ['持ち手の革が、手の形に馴染んでいる', '金具に、小さな刻印がある'] },
    { teaser: '革のカバン', tier: 'plain', value: 5,
      reveal: '合成皮革のカバン。丈夫だが、値打ちものではない',
      hints: ['表面の傷が、めくれるように剥がれている', '縫い目の幅が、機械のように均一'] },

    // ---- 缶に入った何か ----
    { teaser: '缶に入った何か', tier: 'plain', value: 4,
      reveal: '古いボタンの詰め合わせ。手芸をする人には嬉しい',
      hints: ['振ると、細かいものが擦れる音がする', '缶そのものは、菓子の空き缶'] },
    { teaser: '缶に入った何か', tier: 'bad', value: 2,
      reveal: '固まった絵の具。色は残っているが、ほとんど使えない',
      hints: ['蓋が、なかなか開かない', '缶の底が、少しふくらんでいる'] },

    // ---- 割れた皿の山 ----
    { teaser: '割れた皿の山', tier: 'bad', value: 1,
      reveal: '割れた食器。かけらを繋げば飾れなくもない、という程度',
      hints: ['どのかけらも、同じ模様で揃っている', '一枚だけ、割れずに残っている'] },
    { teaser: '割れた皿の山', tier: 'dud', value: -3,
      reveal: 'ただの割れ物。運び出すのに人手と費用がかかる',
      hints: ['模様がばらばらで、揃いものではない', 'かけらが細かすぎて、繋がりそうにない'] },

    // ---- 動かない時計 ----
    { teaser: '動かない時計', tier: 'dud', value: -5,
      reveal: '中の部品が失われている。直せる職人がもういない',
      hints: ['裏蓋を開けた跡が、何度もある', '針が、ねじで止めてある'] },
    { teaser: '動かない時計', tier: 'jackpot', value: 15,
      reveal: '名のある工房の品。ぜんまいを巻けば、その場で動き出した',
      hints: ['文字盤の下に、細かい彫りが入っている', '振ると、中で規則正しい手応えがある'] }
  ];

  function tierById(id) {
    return TIERS.find(function (t) { return t.id === id; }) || null;
  }
  function itemsOf(tier) {
    if (!tier) return ITEMS.slice();
    return ITEMS.filter(function (x) { return x.tier === tier; });
  }
  // 同じ一言が、いくつの階層で使われているか。設計の決まりを確かめるためのもの
  function tiersOfTeaser(teaser) {
    var seen = {};
    ITEMS.forEach(function (x) { if (x.teaser === teaser) seen[x.tier] = true; });
    return Object.keys(seen);
  }
  function allTeasers() {
    var seen = {}, out = [];
    ITEMS.forEach(function (x) {
      if (!seen[x.teaser]) { seen[x.teaser] = true; out.push(x.teaser); }
    });
    return out;
  }
  function counts() {
    var out = {};
    TIERS.forEach(function (t) { out[t.id] = itemsOf(t.id).length; });
    return out;
  }

  // 同じ品物を続けて出さない抽選。使い切ったら復活する（お題プールと同じ考え方）
  function pickItems(n, used, rnd) {
    var r = rnd || Math.random;
    var key = function (x) { return x.teaser + '/' + x.tier; };
    var fresh = ITEMS.filter(function (x) { return !(used || {})[key(x)]; });
    var bank = fresh.length >= n ? fresh : ITEMS;
    var a = bank.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(r() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a.slice(0, Math.min(n, a.length));
  }

  return {
    TIERS: TIERS, ITEMS: ITEMS,
    tierById: tierById, itemsOf: itemsOf, counts: counts,
    tiersOfTeaser: tiersOfTeaser, allTeasers: allTeasers,
    pickItems: pickItems, keyOf: function (x) { return x.teaser + '/' + x.tier; }
  };
}));
