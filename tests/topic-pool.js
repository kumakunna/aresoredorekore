// tests/topic-pool.js — あれそれどれこれのお題50件を、機械で見張る（第46弾）
//
// 指示46で、お題は「物理カードと同じ50件」に固定した。
// サーバーから足す道（/api/topics）も、設定の「お題を追加」も撤去したので、
// **お題の正本は index.html の QUIZ_BANK ただ1つ**になった。
//
// **なぜ人の目では足りないか。**
// 正解も封印語も `normalizeJp(発話).indexOf(語) !== -1` の部分一致で判定する。
// だから同じ名前でなくても事故る——第46弾の機械照合で、実際に2件見つかった：
//   ・easy「靴」を出題中に「靴下」と言うと、**靴の正解が出てしまう**（包含）
//   ・normal「靴下」の封印語「布」があるので、「財布」と言うと **反則になる**（1文字の封印語）
// どちらも遊ぶ人には原因がまったく見えない。50件を人が突き合わせても見つからない。
//
// **検体は手で写さない**（落とし穴25）。QUIZ_BANK を index.html から切り出して読む。
// 手書きの写しを持つと、実装から静かに離れていって、両方が同じ間違い方をする。

const fs = require('fs');
const path = require('path');
const { createRunner, assert, assertEqual } = require('./harness');

const R = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(R, 'public', 'index.html'), 'utf8');

/** index.html の中の `var 名前 = {...};` を、そのまま値として読む */
function 切り出す(名前) {
  const 頭 = 'var ' + 名前 + ' = ';
  const i = HTML.indexOf(頭);
  assert(i >= 0, 名前 + ' が index.html にある');
  const j = HTML.indexOf('\n  };', i);
  assert(j > i, 名前 + ' の終わりが見つかる');
  const 本文 = HTML.slice(i + 頭.length, j + 4);
  return new Function('return (' + 本文 + ')')();
}

// 判定と同じ正規化（index.html の normalizeJp と同じ形）。
// **写しなので、下の「食い違っていないか」で実装とつき合わせる**（落とし穴25）
function normalizeJp(s) {
  return (s || '').replace(/[\s。、！？!?「」『』・,.　ー]/g, '').toLowerCase();
}

// **物理カードの枚数。**指示46で決めた正本で、実装の定数から導かない（落とし穴10-a）
const 枠 = { easy: 18, normal: 14, hard: 8, nanisore: 5, muri: 5 };
const 総数 = 50;

/** プールを {name, yomi, ng_words, tier, aliases} の平らな並びにする */
function 平らにする(bank, aliases) {
  const out = [];
  Object.keys(bank).forEach((tier) => {
    bank[tier].forEach((t) => {
      const ex = aliases[t.name] || {};
      out.push({
        name: ex.display || t.name,
        yomi: t.yomi || '',
        ng_words: t.ng_words || [],
        tier: tier,
        aliases: (ex.aliases || []).concat(ex.display ? [t.name] : [])
      });
    });
  });
  return out;
}

/** 正解として認められる語（名前・よみ・別名） */
function 正解の語(t) {
  return [t.name, t.yomi].concat(t.aliases || []).filter(Boolean);
}

/**
 * 「Aを出題中にBと言うと、Aの正解が出る」組を全部返す。
 * 判定が部分一致なので、Aの正解語がBの正解語に**含まれている**と起きる。
 */
function 誤って正解になる組(pool) {
  const 事故 = [];
  pool.forEach((a) => {
    pool.forEach((b) => {
      if (a === b) return;
      正解の語(a).forEach((x) => {
        const nx = normalizeJp(x);
        if (!nx) return;
        正解の語(b).forEach((y) => {
          const ny = normalizeJp(y);
          if (!ny || ny === nx) return;
          if (ny.indexOf(nx) !== -1) 事故.push(a.name + '←「' + y + '」(' + b.name + ')');
        });
      });
    });
  });
  return 事故;
}

/**
 * 「Bと言っただけで、Aの封印語に**紛れて**当たり、反則になる」組を全部返す。
 *
 * **完全一致は事故ではない。**踏切の封印語「電車」は、電車がお題として別にあっても
 * 「踏切を説明する人に電車と言わせない」という意図そのもの。テレビ⟷リモコンも同じ。
 * 事故になるのは**一部として紛れ込む**場合だけ——
 * 靴下の封印語「布」が「財布」に、火吹き竹の封印語「火」が「火鉢」に入ってしまう形。
 * ここを区別しないと、まともな封印まで赤くなって、直す気のない赤を毎回踏むことになる。
 */
function 誤って反則になる組(pool) {
  const 事故 = [];
  pool.forEach((a) => {
    (a.ng_words || []).forEach((g) => {
      const ng = normalizeJp(g);
      if (!ng) return;
      pool.forEach((b) => {
        if (a === b) return;
        // **そのお題を名指しで封印しているなら、同じお題の別の言い方も意図のうち。**
        // リモコンが「テレビ」を封印しているのに、テレビの別名「テレビジョン」で
        // 事故だと言われては、直しようがない（同じものを指しているので封印して正しい）
        const 名指し = 正解の語(b).some((y) => normalizeJp(y) === ng);
        if (名指し) return;
        正解の語(b).forEach((y) => {
          const ny = normalizeJp(y);
          if (!ny || ny === ng) return;
          if (ny.indexOf(ng) !== -1) {
            事故.push(a.name + 'の封印「' + g + '」←「' + y + '」(' + b.name + ')');
          }
        });
      });
    });
  });
  return 事故;
}

(async () => {
  const r = createRunner('topic-pool');

  await r.test('お題は50件ちょうど。層ごとの枚数も物理カードと同じ', async () => {
    const bank = 切り出す('QUIZ_BANK');
    const 層 = Object.keys(枠);
    assertEqual(Object.keys(bank).sort().join(','), 層.slice().sort().join(','), '層は5つ');
    層.forEach((t) => { assertEqual(bank[t].length, 枠[t], t + ' の枚数'); });
    assertEqual(層.reduce((n, t) => n + bank[t].length, 0), 総数, 'お題の総数');
  });

  await r.test('同じ名前のお題が2つない（重複は先勝ちで黙って消える）', async () => {
    const bank = 切り出す('QUIZ_BANK');
    const 見た = {};
    const 重複 = [];
    Object.keys(bank).forEach((tier) => {
      bank[tier].forEach((t) => {
        const n = normalizeJp(t.name);
        if (見た[n]) 重複.push(t.name + '（' + 見た[n] + ' と ' + tier + '）');
        見た[n] = tier;
      });
    });
    // getPool() は名前で先勝ちの重複排除をするので、重複した分は**静かに消える**。
    // 第46弾より前は、火吹き竹と千歯こきが nanisore と muri の両方にいて、
    // muri 側の2件は一度も出題されていなかった
    assertEqual(重複.join('・'), '', '重複したお題');
  });

  await r.test('どのお題にも、よみと封印語3つがある', async () => {
    const bank = 切り出す('QUIZ_BANK');
    const 足りない = [];
    Object.keys(bank).forEach((tier) => {
      bank[tier].forEach((t) => {
        if (!t.yomi) 足りない.push(t.name + '：よみが無い');
        if (!t.ng_words || t.ng_words.length !== 3) {
          足りない.push(t.name + '：封印語が' + ((t.ng_words || []).length) + 'つ');
        }
      });
    });
    assertEqual(足りない.join('\n       '), '', 'よみ・封印語が揃っていないお題');
  });

  // **1文字の封印語そのものは、門にしない。**
  // 最初は「1文字は全部だめ」と書いたが、それだと傘の「雨」や電車の「駅」まで赤くなる。
  // どちらも何ともぶつかっていない、良い封印語だった（64件中、実害があるのはごく一部）。
  // **判断の要ることを機械の門にすると、直す気のない赤を毎回踏むことになる。**
  // 機械で確かに言えるのは「プールの中でぶつかるか」だけなので、それだけを見る（下）。
  // 「月」が今月・月曜日に紛れるような、**プールの外**での誤爆は人が見るしかない。

  await r.test('別のお題を言っただけで、正解になったり反則になったりしない', async () => {
    const pool = 平らにする(切り出す('QUIZ_BANK'), 切り出す('TOPIC_ALIASES'));
    assertEqual(誤って正解になる組(pool).join('\n       '), '', '誤って正解になる組');
    assertEqual(誤って反則になる組(pool).join('\n       '), '', '誤って反則になる組');
  });

  await r.test('別名の表に、もう居ないお題の行が残っていない（両方向・落とし穴20）', async () => {
    const bank = 切り出す('QUIZ_BANK');
    const aliases = 切り出す('TOPIC_ALIASES');
    const ある = {};
    Object.keys(bank).forEach((tier) => { bank[tier].forEach((t) => { ある[t.name] = true; }); });
    // 帰り：表の行が、実在するお題を指しているか
    assertEqual(Object.keys(aliases).filter((k) => !ある[k]).join('・'), '', 'もう居ないお題の別名');
    // 行き：同じ言い方が、2つのお題の正解になっていないか
    const 持ち主 = {};
    const ぶつかり = [];
    Object.keys(aliases).forEach((k) => {
      (aliases[k].aliases || []).forEach((a) => {
        const n = normalizeJp(a);
        if (持ち主[n] && 持ち主[n] !== k) ぶつかり.push('「' + a + '」＝' + 持ち主[n] + ' と ' + k);
        持ち主[n] = k;
      });
    });
    assertEqual(ぶつかり.join('・'), '', '2つのお題の正解になる言い方');
  });

  await r.test('判定の正規化が、この見張りの写しと食い違っていない', async () => {
    // 上の検査は normalizeJp を写している。**写しが古びると、見張りごと嘘になる**（落とし穴25）。
    // 実装の本体を取り出して、同じ入力で同じ答えになることを確かめる
    const i = HTML.indexOf('function normalizeJp(s){');
    assert(i > 0, '実装の normalizeJp が実在する');
    const 本体 = HTML.slice(i, HTML.indexOf('\n  }', i) + 4);
    const 実装 = new Function('return (' + 本体.replace('function normalizeJp', 'function') + ')')();
    ['傘立て', 'エレベーター', 'ＡＢ　ｃ', 'あ、い。う！', 'ヘッドホン', ''].forEach((s) => {
      assertEqual(実装(s), normalizeJp(s), '「' + s + '」の正規化');
    });
  });

  await r.test('この見張り自身が、わざと壊したお題を捕まえる', async () => {
    // 落とし穴10：**赤くなることを確かめていない検査は、緑でも意味がない**
    const 汚 = [
      { name: '靴', yomi: 'くつ', ng_words: ['履く', '足', '歩く'], tier: 'easy', aliases: [] },
      { name: '靴下', yomi: 'くつした', ng_words: ['足', '布', '履く'], tier: 'normal', aliases: [] },
      { name: '財布', yomi: 'さいふ', ng_words: ['お金', '小銭', 'カード'], tier: 'normal', aliases: [] }
    ];
    assert(誤って正解になる組(汚).some((x) => x.indexOf('靴←') === 0),
      '「靴を出題中に靴下と言うと正解が出る」を捕まえる');
    assert(誤って反則になる組(汚).some((x) => x.indexOf('布') !== -1 && x.indexOf('財布') !== -1),
      '「靴下の封印語“布”が、財布で誤爆する」を捕まえる');
    // 壊していない並びでは何も言わないこと（型(b)：条件が作れているかを1つ確かめる）
    const 綺麗 = [
      { name: '傘', yomi: 'かさ', ng_words: ['雨', '濡れる', 'さす'], tier: 'easy', aliases: [] },
      { name: '犬', yomi: 'いぬ', ng_words: ['動物', '散歩', 'ペット'], tier: 'easy', aliases: [] }
    ];
    assertEqual(誤って正解になる組(綺麗).join('・'), '', '綺麗な並びでは何も言わない');
    assertEqual(誤って反則になる組(綺麗).join('・'), '', '綺麗な並びでは反則の事故も言わない');

    // **完全一致は通す**ことも、その場で1つ確かめる（型(b)：緩めた側が効いているか）。
    // ここを見ないと、上の「紛れ込む」だけを見て安心し、
    // あとで完全一致まで弾く形に戻しても誰も気づかない
    const 意図した封印 = [
      { name: '踏切', yomi: 'ふみきり', ng_words: ['電車', '遮断機', 'カンカン'], tier: 'normal', aliases: [] },
      { name: '電車', yomi: 'でんしゃ', ng_words: ['乗り物', 'レール', '線路'], tier: 'easy', aliases: [] }
    ];
    assertEqual(誤って反則になる組(意図した封印).join('・'), '',
      '踏切の封印「電車」は、電車がお題として別にあっても事故ではない');
  });

  r.finish();
})();
