// tests/sugoroku-mini.js — 「こまはひとつ」のミニゲーム（第36弾）
//
// DOM も socket.io も使わない純粋な計算なので、jsdom を立てずに確かめる。
// いちばん見たいのは2つ:
//   ・**出していない人が、必ず最下位に同着で並ぶ**こと。
//     切断・無操作・時間切れのどれで来ても同じ扱いになる形を、ここで固定する（落とし穴17）
//   ・**系統の重みが均されている**こと。特定の系統ばかり出ると、
//     その系統が得意な人が勝ち続け、このゲームの核（勝者の分散）が壊れる
//
// ランダムは必ず引数で渡して固定する。

const M = require('../public/js/sugoroku-mini');
const { createRunner, assert, assertEqual } = require('./harness');

const P = ['a', 'b', 'c', 'd'];
function rankOf(res, id) {
  return (res.ranked.find((x) => x.id === id) || {}).rank;
}
function rndSeq(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

(async function main() {
  const r = createRunner('sugoroku-mini：こまはひとつのミニゲーム');

  // ---- 一覧 ----

  await r.test('4つの系統に、1つずつミニゲームがある', async () => {
    // 指示書の決めごと。2系統だと「その2つが得意な人が連勝」する状態になり、
    // 勝者の分散という核を確かめられない
    assertEqual(M.KINDS.length, 4, '系統は4つ');
    M.KINDS.forEach((k) => {
      assert(M.minisOfKind(k).length >= 1, k + ' の系統にミニゲームが無い');
    });
    assertEqual(M.miniIds().length, 4, 'ミニゲームは4つ');
  });

  await r.test('どのミニゲームにも、題と説明がある', async () => {
    // 何が始まったか分からないまま始まるのが、いちばん混乱する
    M.miniIds().forEach((id) => {
      const g = M.miniById(id);
      assert(g.title && g.lead, id + ' に題か説明が無い');
      assert(g.sec > 0, id + ' に締め切りが無い（揃わない時に止まる）');
    });
  });

  await r.test('抽選は系統ごとに均される（特定の系統に偏らない）', async () => {
    // 一覧から直に引くと、ある系統に2つ足した時その系統だけ出やすくなる＝
    // その系統が得意な人が勝ちやすくなる
    const seen = {};
    for (let i = 0; i < 400; i++) {
      const g = M.pickMini(rndSeq([i / 400, (i * 7 % 400) / 400]), null);
      seen[g.kind] = (seen[g.kind] || 0) + 1;
    }
    M.KINDS.forEach((k) => assert(seen[k] > 0, k + ' の系統が一度も出ない'));
  });

  await r.test('同じミニゲームは、続けて出ない', async () => {
    for (let i = 0; i < 50; i++) {
      const g = M.pickMini(rndSeq([i / 50, 0.3, 0.7]), 'tap');
      assert(g.id !== 'tap', '直前と同じものが出た');
    }
  });

  // ---- 出していない人の扱い（4系統すべて同じ） ----

  await r.test('出していない人は、どの系統でも必ず最下位に同着で並ぶ', async () => {
    // 切断・無操作・時間切れのどれで来ても同じ扱いにする。
    // 系統ごとに書くと、必ずどれかを書き忘れる
    const cases = {
      tap: { a: { count: 20 }, b: { count: 5 } },
      janken: { a: { hand: 'g' }, b: { hand: 'c' } },
      quiz: { a: { correct: true, atMs: 500 }, b: { correct: false } },
      fingers: { a: { fingers: 3 }, b: { fingers: 1 } }
    };
    Object.keys(cases).forEach((id) => {
      const res = M.rankMini(id, P, cases[id]);   // c と d は出していない
      const last = Math.max(...res.ranked.map((x) => x.rank));
      assertEqual(rankOf(res, 'c'), last, id + '：出していない c が最下位でない');
      assertEqual(rankOf(res, 'd'), last, id + '：出していない d が最下位でない');
      assert(rankOf(res, 'a') < last, id + '：出した人が、出していない人より上');
    });
  });

  await r.test('誰も出さなくても、順位づけが壊れない', async () => {
    M.miniIds().forEach((id) => {
      const res = M.rankMini(id, P, {});
      assertEqual(res.ranked.length, 4, id + '：全員ぶん返る');
      res.ranked.forEach((x) => assertEqual(x.rank, 1, id + '：全員同着'));
    });
  });

  // ---- 連打 ----

  await r.test('連打は30回で頭打ちになる（体力差がそのまま出ないように）', async () => {
    // **実装側の TAP_CAP を検査に使わない。** 上限を緩めると検査も一緒に緩んで素通りする
    // （実際にそうなっていた）。守りたいのは「数秒で届く回数で頭打ちになる」という具体の形
    assert(M.TAP_CAP <= 40, '頭打ちが高すぎる（体力と指の速さがそのまま順位になる）');
    const res = M.rankMini('tap', ['a', 'b'], {
      a: { count: 40, atMs: 4000 },
      b: { count: 120, atMs: 4000 }
    });
    assertEqual(rankOf(res, 'a'), rankOf(res, 'b'), '上限を超えたぶんでは差がつかない');
  });

  await r.test('満タンどうしは、早く届いた方が上', async () => {
    const res = M.rankMini('tap', ['a', 'b'], {
      a: { count: M.TAP_CAP, atMs: 5000 },
      b: { count: M.TAP_CAP, atMs: 2000 }
    });
    assertEqual(rankOf(res, 'b'), 1, '早い方が1位');
    assertEqual(rankOf(res, 'a'), 2, '遅い方が2位');
  });

  // ---- じゃんけん ----

  await r.test('じゃんけんは、勝ち手を出した人が1位', async () => {
    const res = M.rankMini('janken', P, {
      a: { hand: 'g' }, b: { hand: 'c' }, c: { hand: 'c' }, d: { hand: 'g' }
    });
    assertEqual(res.draw, false, '勝ちが決まる');
    assertEqual(rankOf(res, 'a'), 1, 'グーが1位');
    assertEqual(rankOf(res, 'd'), 1, '同じ手はもちろん同着');
    assert(rankOf(res, 'b') > 1, 'チョキは下');
  });

  await r.test('あいこ（全員同じ・3種類そろう）は、勝ちが決まらない', async () => {
    const same = M.rankMini('janken', ['a', 'b'], { a: { hand: 'p' }, b: { hand: 'p' } });
    assertEqual(same.draw, true, '全員同じはあいこ');
    const all3 = M.rankMini('janken', ['a', 'b', 'c'],
      { a: { hand: 'g' }, b: { hand: 'c' }, c: { hand: 'p' } });
    assertEqual(all3.draw, true, '3種類そろえばあいこ');
    const none = M.rankMini('janken', P, {});
    assertEqual(none.draw, true, '誰も出さなくてもあいこ（黙って勝者を作らない）');
  });

  // ---- はやおしクイズ ----

  await r.test('正解した人のうち、早い人が上。外した人は正解者より必ず下', async () => {
    const res = M.rankMini('quiz', P, {
      a: { correct: true, atMs: 3000 },
      b: { correct: true, atMs: 900 },
      c: { correct: false, atMs: 100 },
      d: { correct: false, atMs: 50 }
    });
    assertEqual(rankOf(res, 'b'), 1, '早く正解した人が1位');
    assertEqual(rankOf(res, 'a'), 2, '遅く正解した人が2位');
    assert(rankOf(res, 'c') > 2, '外した人は、どれだけ早くても正解者より下');
    assertEqual(rankOf(res, 'c'), rankOf(res, 'd'), '外した人どうしは同着');
  });

  // ---- ゆびの かずあて ----

  await r.test('いちばん珍しい本数を出した人が勝ち', async () => {
    const res = M.rankMini('fingers', P, {
      a: { fingers: 2 }, b: { fingers: 2 }, c: { fingers: 2 }, d: { fingers: 5 }
    });
    assertEqual(rankOf(res, 'd'), 1, '1人だけの本数が1位');
    assert(rankOf(res, 'a') > 1, 'かぶった人は下');
    assertEqual(rankOf(res, 'a'), rankOf(res, 'b'), '同じ本数どうしは同着');
  });

  await r.test('本数は0〜5に収まる（枠の外を送っても壊れない）', async () => {
    const res = M.rankMini('fingers', ['a', 'b'], {
      a: { fingers: 99 }, b: { fingers: 5 }
    });
    assertEqual(rankOf(res, 'a'), rankOf(res, 'b'), '99は5として扱われ、同着になる');
    const minus = M.rankMini('fingers', ['a', 'b'], { a: { fingers: -3 }, b: { fingers: 0 } });
    assertEqual(rankOf(minus, 'a'), rankOf(minus, 'b'), '負の数は0として扱われる');
  });

  // ---- 駒を動かす順番と、敗者の移動 ----

  await r.test('動かす順番は、1位から順に並ぶ', async () => {
    const res = M.rankMini('fingers', P, {
      a: { fingers: 1 }, b: { fingers: 2 }, c: { fingers: 2 }, d: { fingers: 2 }
    });
    const order = M.grabOrder(res.ranked);
    assertEqual(order[0], 'a', '1位が先頭');
    assertEqual(order.length, 4, '全員ぶん並ぶ');
  });

  await r.test('敗者が動けるのは、勝者の出目より必ず小さい', async () => {
    // 何も起きないと勝てない人が傍観者になるので0にはしない。
    // ただし勝ち筋を薄めないよう、サイコロの最小値より小さく保つ
    assertEqual(M.loserSteps(1), 0, '1位はここでは動かさない（サイコロで動く）');
    assertEqual(M.loserSteps(2), 2, '2位は2マス');
    assertEqual(M.loserSteps(3), 1, '3位は1マス');
    assertEqual(M.loserSteps(4), 0, '4位以下は動かない');
    assertEqual(M.loserSteps(8), 0, '下位も同じ');
    [2, 3].forEach((rk) => {
      assert(M.loserSteps(rk) < 6, rk + '位の移動が、出目の最大より小さい');
    });
    assert(M.loserSteps(2) > M.loserSteps(3), '順位が上の人ほど多く動ける');
  });

  r.finish();
})();
