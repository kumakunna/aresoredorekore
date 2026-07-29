// titles.js — 称号（アイコンと二つ名）の目録と、獲得条件の判定。
//
// 二つ名は3つのパーツでできている：はじめの言葉 ＋ 接続詞 ＋ 終わりの言葉。
// 初期状態は全員「はじめ」＋「の」＋「一歩」＝「はじめの一歩」。
//
// 勝敗ではなく「何をやったか」を讃える仕組みなので、条件は勝ち負けだけでなく
// 役職の仕事ぶり・遊んだ回数・遊び方の広さも見る。
//
// カセットを足す時にここだけを触れば済むようにしてある：
//   1. STAT_SHAPE に、そのカセットのカウンタを足す
//   2. CATALOG に cassette: 'そのカセットのid' のパーツを足す
// 画面もサーバーも判定はここを呼ぶだけなので、条件が2か所に散らない。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TitleLogic = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 二つ名のパーツの種類。並べる順がそのまま名乗りの順になる
  var PARTS = ['first', 'joiner', 'last'];

  // カセットごとの、ためていく数字。
  // 「一度でもやったか」で足りるものも数で持つ（1以上かで見るだけ）。
  var STAT_SHAPE = {
    jinro: {
      plays: 0,             // 人狼カセットを遊んだ回数（ワードウルフも含む）
      wordwolfPlays: 0,     // うち、ワードウルフ
      wins: 0,              // 勝った回数
      villageWins: 0,       // 村人側で勝った
      wolfWins: 0,          // 人狼側で勝った
      foxWins: 0,           // 妖狐で勝った
      correctVotes: 0,      // 投票でウルフ・人狼を正しく当てた
      runoffComeback: 0,    // 決選投票で逆転勝利に貢献した
      wolfEscapes: 0,       // 人狼側で、当てられずに逃げ切った
      seerHits: 0,          // 占った相手が人狼だった
      knightSaves: 0,       // 騎士として護衛に成功した
      foxSolo: 0,           // 妖狐として単独勝利した
      loversSurvived: 0,    // 恋人として2人で生き残った
      madmanHidden: 0,      // 狂人として正体がバレずに終わった
      wordwolfEscapes: 0,   // ワードウルフで、当てられずに逃げ切った
      tricks: 0,            // のぞき見役・まきこみ役として相手を欺いた
      mediumHits: 0         // 霊媒師として的中させた
    },
    aresore: {
      plays: 0,             // 遊んだ回数
      wins: 0,              // 勝った回数
      oneHintGiven: 0,      // 出題者として、最初のヒントだけで当てさせた
      sealedSuccess: 0,     // 封印ワード縛りでも当てさせた
      survivalWins: 0,      // サバイバルで優勝した
      normalPlays: 0,       // 通常プレイを遊んだ
      sealedPlays: 0,       // 封印ワードを遊んだ
      survivalPlays: 0,     // サバイバルを遊んだ
      normalWins: 0,
      sealedWins: 0,
      oneHintAnswered: 0,   // 正解者として、ヒント1つで当てた
      ownVoiceQuestions: 0, // AI読み上げを使わず、自分の声で出題した
      asGiver: 0,           // 出題者として出題した回数
      asAnswerer: 0,        // 正解者として正解した回数
      aiReadPlays: 0,       // AI読み上げモードで遊んだ回数
      comebackWins: 0       // 最下位候補から優勝した
    }
  };

  function emptyStats() {
    var out = {};
    Object.keys(STAT_SHAPE).forEach(function (cas) {
      out[cas] = {};
      Object.keys(STAT_SHAPE[cas]).forEach(function (k) { out[cas][k] = 0; });
    });
    return out;
  }
  // 保存されていた数字を、いまの形に揃える（あとから増やしたカウンタを 0 で埋める）
  function normalizeStats(stats) {
    var out = emptyStats();
    if (!stats || typeof stats !== 'object') return out;
    Object.keys(out).forEach(function (cas) {
      var src = stats[cas];
      if (!src || typeof src !== 'object') return;
      Object.keys(out[cas]).forEach(function (k) {
        var v = src[k];
        if (typeof v === 'number' && isFinite(v) && v > 0) out[cas][k] = Math.floor(v);
      });
    });
    return out;
  }
  // s(カセット, カウンタ名) で安全に読む
  function reader(stats) {
    var st = normalizeStats(stats);
    return function (cas, key) { return (st[cas] && st[cas][key]) || 0; };
  }

  // ---- 目録 ----
  // free:true は最初から使えるもの。それ以外は need(s) が真になったら手に入る。
  // hint は「どうすれば手に入るか」。まだ持っていない人にも見せる。
  var CATALOG = {
    icon: [
      { id: 'icon-default', cassette: null, emoji: '🙂', label: 'いつもの顔', free: true,
        hint: '最初から使えます' },

      { id: 'icon-wolf-1', cassette: 'jinro', emoji: '🌙', label: '見習いの証',
        hint: '人狼カセットを1回あそぶ',
        need: function (s) { return s('jinro', 'plays') >= 1; } },
      { id: 'icon-wolf-10', cassette: 'jinro', emoji: '🐺', label: 'ベテランの証',
        hint: '人狼カセットを通算10回あそぶ',
        need: function (s) { return s('jinro', 'plays') >= 10; } },
      { id: 'icon-wolf-teams', cassette: 'jinro', emoji: '🎭', label: '全陣営制覇の証',
        hint: '村人側・人狼側・妖狐で、それぞれ1回ずつ勝つ',
        need: function (s) {
          return s('jinro', 'villageWins') >= 1 && s('jinro', 'wolfWins') >= 1 && s('jinro', 'foxWins') >= 1;
        } },
      { id: 'icon-wolf-sheep', cassette: 'jinro', emoji: '🐑', label: 'シープの友',
        hint: 'ワードウルフを5回あそぶ',
        need: function (s) { return s('jinro', 'wordwolfPlays') >= 5; } },

      { id: 'icon-are-1', cassette: 'aresore', emoji: '🎈', label: 'はじめの参加証',
        hint: 'あれそれどれこれを1回あそぶ',
        need: function (s) { return s('aresore', 'plays') >= 1; } },
      { id: 'icon-are-10', cassette: 'aresore', emoji: '📖', label: '言葉の達人見習い',
        hint: 'あれそれどれこれを通算10回あそぶ',
        need: function (s) { return s('aresore', 'plays') >= 10; } },
      { id: 'icon-are-seal', cassette: 'aresore', emoji: '🚫', label: '封印破りの証',
        hint: '封印ワードモードで1回でも正解させる',
        need: function (s) { return s('aresore', 'sealedSuccess') >= 1; } },
      { id: 'icon-are-survivor', cassette: 'aresore', emoji: '🏆', label: '生き残りの証',
        hint: 'サバイバルで優勝する',
        need: function (s) { return s('aresore', 'survivalWins') >= 1; } }
    ],

    first: [
      { id: 'first-hajime', cassette: null, label: 'はじめ', free: true, hint: '最初から使えます' },

      { id: 'first-utagai', cassette: 'jinro', label: '疑り深き',
        hint: '投票でウルフ・人狼を正しく当てた回数が5回以上',
        need: function (s) { return s('jinro', 'correctVotes') >= 5; } },
      { id: 'first-daitan', cassette: 'jinro', label: '大胆',
        hint: '決選投票で逆転勝利に貢献する',
        need: function (s) { return s('jinro', 'runoffComeback') >= 1; } },
      { id: 'first-minuke', cassette: 'jinro', label: '見抜け',
        hint: '人狼側で3回、当てられずに逃げ切る',
        need: function (s) { return s('jinro', 'wolfEscapes') >= 3; } },
      { id: 'first-senri', cassette: 'jinro', label: '千里眼',
        hint: '占い師として、占った相手が人狼だったことを2回当てる',
        need: function (s) { return s('jinro', 'seerHits') >= 2; } },
      { id: 'first-chujitsu', cassette: 'jinro', label: '忠実',
        hint: '騎士として護衛に成功する',
        need: function (s) { return s('jinro', 'knightSaves') >= 1; } },
      { id: 'first-kodoku', cassette: 'jinro', label: '孤独',
        hint: '妖狐として単独勝利する',
        need: function (s) { return s('jinro', 'foxSolo') >= 1; } },
      { id: 'first-kizuna', cassette: 'jinro', label: '絆',
        hint: '恋人として2人で生き残る',
        need: function (s) { return s('jinro', 'loversSurvived') >= 1; } },

      { id: 'first-takumi', cassette: 'aresore', label: '巧み',
        hint: '出題者として、最初のヒントだけで当てさせた回数が5回以上',
        need: function (s) { return s('aresore', 'oneHintGiven') >= 5; } },
      { id: 'first-kiten', cassette: 'aresore', label: '機転',
        hint: '封印ワード縛りでも相手に当てさせる',
        need: function (s) { return s('aresore', 'sealedSuccess') >= 1; } },
      { id: 'first-nintai', cassette: 'aresore', label: '忍耐',
        hint: 'サバイバルで優勝する',
        need: function (s) { return s('aresore', 'survivalWins') >= 1; } },
      { id: 'first-hakushiki', cassette: 'aresore', label: '博識',
        hint: '通常プレイ・封印ワード・サバイバルを全部1回以上あそぶ',
        need: function (s) {
          return s('aresore', 'normalPlays') >= 1 && s('aresore', 'sealedPlays') >= 1 && s('aresore', 'survivalPlays') >= 1;
        } },
      { id: 'first-kikijozu', cassette: 'aresore', label: '聞き上手',
        hint: '正解者として、ヒント1つで当てる',
        need: function (s) { return s('aresore', 'oneHintAnswered') >= 1; } },
      { id: 'first-jozetsu', cassette: 'aresore', label: '饒舌',
        hint: 'AI読み上げを使わず、自分の声で10回以上出題する',
        need: function (s) { return s('aresore', 'ownVoiceQuestions') >= 10; } }
    ],

    // 接続詞は語彙こそ共通だが、条件はカセットごとに別（どちらで満たしても手に入る）
    joiner: [
      { id: 'joiner-no', cassette: null, label: 'の', free: true, hint: '最初から使えます' },

      { id: 'joiner-naru-wolf', cassette: 'jinro', label: 'なる',
        hint: '人狼カセットで通算5勝する',
        need: function (s) { return s('jinro', 'wins') >= 5; } },
      { id: 'joiner-taru-wolf', cassette: 'jinro', label: 'たる',
        hint: '人狼カセットで3つの陣営で勝つ',
        need: function (s) {
          var n = 0;
          if (s('jinro', 'villageWins') >= 1) n++;
          if (s('jinro', 'wolfWins') >= 1) n++;
          if (s('jinro', 'foxWins') >= 1) n++;
          return n >= 3;
        } },

      { id: 'joiner-naru-are', cassette: 'aresore', label: 'なる',
        hint: 'あれそれどれこれで通算5勝する',
        need: function (s) { return s('aresore', 'wins') >= 5; } },
      { id: 'joiner-taru-are', cassette: 'aresore', label: 'たる',
        hint: '通常プレイ・封印ワード・サバイバルで、それぞれ1勝以上する',
        need: function (s) {
          return s('aresore', 'normalWins') >= 1 && s('aresore', 'sealedWins') >= 1 && s('aresore', 'survivalWins') >= 1;
        } }
    ],

    last: [
      { id: 'last-ippo', cassette: null, label: '一歩', free: true, hint: '最初から使えます' },

      { id: 'last-yogensha', cassette: 'jinro', label: '予言者',
        hint: '占い師として1回でも当てる',
        need: function (s) { return s('jinro', 'seerHits') >= 1; } },
      { id: 'last-shugosha', cassette: 'jinro', label: '守護者',
        hint: '騎士として護衛成功を1回経験する',
        need: function (s) { return s('jinro', 'knightSaves') >= 1; } },
      { id: 'last-doke', cassette: 'jinro', label: '道化',
        hint: '狂人として、正体がバレずに試合を終える',
        need: function (s) { return s('jinro', 'madmanHidden') >= 1; } },
      { id: 'last-ippikiokami', cassette: 'jinro', label: '一匹狼',
        hint: 'ワードウルフで1回、当てられずに逃げ切る',
        need: function (s) { return s('jinro', 'wordwolfEscapes') >= 1; } },
      { id: 'last-sakushi', cassette: 'jinro', label: '策士',
        hint: 'のぞき見役・まきこみ役として相手を欺く',
        need: function (s) { return s('jinro', 'tricks') >= 1; } },
      { id: 'last-borei', cassette: 'jinro', label: '亡霊',
        hint: '霊媒師として2回、情報を的中させる',
        need: function (s) { return s('jinro', 'mediumHits') >= 2; } },

      { id: 'last-meishu', cassette: 'aresore', label: '名手',
        hint: 'あれそれどれこれで通算5勝する',
        need: function (s) { return s('aresore', 'wins') >= 5; } },
      { id: 'last-annainin', cassette: 'aresore', label: '案内人',
        hint: '出題者として通算10回出題する',
        need: function (s) { return s('aresore', 'asGiver') >= 10; } },
      { id: 'last-hayamimi', cassette: 'aresore', label: '早耳',
        hint: '正解者として通算10回正解する',
        need: function (s) { return s('aresore', 'asAnswerer') >= 10; } },
      { id: 'last-kataribe', cassette: 'aresore', label: '語り部',
        hint: 'AI読み上げモードで5回以上あそぶ',
        need: function (s) { return s('aresore', 'aiReadPlays') >= 5; } },
      { id: 'last-fukutsu', cassette: 'aresore', label: '不屈',
        hint: 'サバイバルで、一度最下位候補になってから優勝する',
        need: function (s) { return s('aresore', 'comebackWins') >= 1; } }
    ]
  };

  // 最初から全員が持っているもの
  var DEFAULTS = {};
  Object.keys(CATALOG).forEach(function (part) {
    var free = CATALOG[part].filter(function (p) { return p.free; })[0];
    DEFAULTS[part] = free ? free.id : CATALOG[part][0].id;
  });

  function partsOf(part) { return CATALOG[part] || []; }
  function partById(part, id) {
    return partsOf(part).filter(function (p) { return p.id === id; })[0] || null;
  }
  function allParts() {
    return ['icon'].concat(PARTS).reduce(function (acc, part) {
      return acc.concat(partsOf(part).map(function (p) {
        return { part: part, def: p };
      }));
    }, []);
  }

  /**
   * いまの成績で条件を満たしている全パーツのID。
   * 一度手に入れたものは永久に残るので、呼び出し側はこれと
   * 保存済みの獲得済みIDを足し合わせて使う（減ることはない）。
   */
  function unlockedIds(stats) {
    var s = reader(stats);
    var out = [];
    allParts().forEach(function (x) {
      if (x.def.free || (x.def.need && x.def.need(s))) out.push(x.def.id);
    });
    return out;
  }

  // 保存済みの獲得済みIDに、いまの成績で新しく満たしたものを足す
  function mergeUnlocked(owned, stats) {
    var set = {};
    (owned || []).forEach(function (id) { set[id] = true; });
    unlockedIds(stats).forEach(function (id) { set[id] = true; });
    // 目録に無いID（作り直したパーツ）は捨てる
    return allParts().map(function (x) { return x.def.id; }).filter(function (id) { return set[id]; });
  }

  // 増えたぶんだけを返す（「手に入れました」を出すため）
  function newlyUnlocked(before, after) {
    var had = {};
    (before || []).forEach(function (id) { had[id] = true; });
    return (after || []).filter(function (id) { return !had[id]; });
  }

  // 装備。持っていないものが入っていたら初期に戻す（データが古くても壊れない）
  function normalizeEquipped(equipped, owned) {
    var have = {};
    (owned || []).forEach(function (id) { have[id] = true; });
    var out = {};
    ['icon'].concat(PARTS).forEach(function (part) {
      var id = equipped && equipped[part];
      out[part] = (id && have[id] && partById(part, id)) ? id : DEFAULTS[part];
    });
    return out;
  }

  // 「はじめ」＋「の」＋「一歩」→「はじめの一歩」
  function titleText(equipped) {
    var eq = equipped || DEFAULTS;
    return PARTS.map(function (part) {
      var p = partById(part, eq[part]) || partById(part, DEFAULTS[part]);
      return p ? p.label : '';
    }).join('');
  }
  function iconEmoji(equipped) {
    var p = partById('icon', (equipped || DEFAULTS).icon) || partById('icon', DEFAULTS.icon);
    return p ? p.emoji : '🙂';
  }

  return {
    CATALOG: CATALOG,
    PARTS: PARTS,
    PART_KEYS: ['icon'].concat(PARTS),
    DEFAULTS: DEFAULTS,
    STAT_SHAPE: STAT_SHAPE,
    emptyStats: emptyStats,
    normalizeStats: normalizeStats,
    partsOf: partsOf,
    partById: partById,
    unlockedIds: unlockedIds,
    mergeUnlocked: mergeUnlocked,
    newlyUnlocked: newlyUnlocked,
    normalizeEquipped: normalizeEquipped,
    titleText: titleText,
    iconEmoji: iconEmoji
  };
}));
