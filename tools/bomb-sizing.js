#!/usr/bin/env node
// tools/bomb-sizing.js — クイズ解除（協力版）を16人まで伸ばす時の、人数ごとの見込みの表（指示68-2 第4節）
//
//   node tools/bomb-sizing.js            … 案ごとに 2〜16人の表を出す（Markdown）
//
// **数字は作る前に計算で確かめる**（04の反省）。ここで出すのは「仮の数字」から出した見込み：
//   ・1本にかかる時間 SEC（開く・読む・3択を押す・次を選ぶ）… 難しさごとに 8・10・13 秒と仮に置いた
//   ・1回目で外す割合 MISS … かんたん 5%・ふつう 15%・むずかしい 30% と仮に置いた（3択でまったくの当てずっぽうなら 67%）
//   ・外したコードはもう一度挑む。2回目は選択肢が2つに減るので、外す割合を半分と置いた
//   ・ミスの数はポアソン分布で近づける（1本ごとに独立）。爆発＝ミスがライフに届く
//   ・みんなで並んで切るので、かかる時間 ≒ 1人あたりの本数 × 1本の時間（盤が空かずに待つ時間は入れていない）
// 実測（本番の記録・10/30 のあそびテスト）が取れたら、上の仮の数字を置きかえて出し直す
'use strict';

const SEC = { easy: 8, normal: 10, hard: 13 };
const MISS = { easy: 0.05, normal: 0.15, hard: 0.30 };
const MIX = { easy: 12 / 30, normal: 10 / 30, hard: 8 / 30 };   // 今の既定（12・10・8本）の割合
const TIMER = 180;

function poissonAtLeast(lambda, k) {
  let p = 0, term = Math.exp(-lambda);
  for (let i = 0; i < k; i++) { p += term; term *= lambda / (i + 1); }
  return 1 - p;
}
function 見込み(n, codes, lives) {
  const counts = {};
  let left = codes;
  ['easy', 'normal'].forEach((t) => { counts[t] = Math.round(codes * MIX[t]); left -= counts[t]; });
  counts.hard = left;
  let lambda = 0, sec = 0;
  Object.keys(counts).forEach((t) => {
    const m = MISS[t];
    lambda += counts[t] * (m + m * (m / 2));        // 1回目＋外したコードの2回目
    sec += counts[t] * SEC[t] * (1 + m);              // 外した分、もう一度読む
  });
  const 人あたり = codes / n;
  const 時間 = Math.round(sec / n);
  return { n, codes, counts, lives, 人あたり: Math.round(人あたり * 10) / 10, 時間,
    時間切れ: 時間 > TIMER, ミス: Math.round(lambda * 10) / 10, 爆発: Math.round(poissonAtLeast(lambda, lives) * 100) };
}

const 案 = {
  'A（指示書の例）: コード＝人数×3（上限50）・ライフ＝8人まで3・9人から4': (n) => [Math.min(50, 3 * n), n <= 8 ? 3 : 4],
  'B（今の30本を残す）: 8人まで30本・9人から1人ふえるごとに+2.5本（16人で50）・ライフ＝8人まで3・9人から4':
    (n) => [n <= 8 ? 30 : Math.min(50, Math.round(30 + 2.5 * (n - 8))), n <= 8 ? 3 : 4],
  'D（本数に合わせてライフも）: 8人まで30本・9人から+2.5本（16人で50）・ライフ＝本数÷10（30本で3・50本で5）':
    (n) => { const codes = n <= 8 ? 30 : Math.min(50, Math.round(30 + 2.5 * (n - 8))); return [codes, Math.max(3, Math.round(codes / 10))]; },
  'C（1人あたり4本）: コード＝人数×4（12〜50）・ライフ＝見込みのミス＋1（3〜5）': (n) => {
    const codes = Math.max(12, Math.min(50, 4 * n));
    const lam = 見込み(n, codes, 3).ミス;
    return [codes, Math.max(3, Math.min(5, Math.round(lam) + 1))];
  }
};

if (require.main === module) {
  const out = ['# クイズ解除を16人まで伸ばす時の見込み（tools/bomb-sizing.js の出力）', '',
    '仮の数字：1本の時間 かんたん' + SEC.easy + '秒・ふつう' + SEC.normal + '秒・むずかしい' + SEC.hard + '秒／1回目で外す割合 ' +
    MISS.easy * 100 + '%・' + MISS.normal * 100 + '%・' + MISS.hard * 100 + '%／難しさの割合は今の既定（12:10:8）／時計 ' + TIMER + '秒', ''];
  Object.keys(案).forEach((name) => {
    out.push('## ' + name, '', '| 人数 | コード | ライフ | 1人あたり | 終わるまでの見込み | 見込みのミス | 爆発しやすさ |', '|---|---|---|---|---|---|---|');
    for (let n = 2; n <= 16; n++) {
      const [codes, lives] = 案[name](n);
      const r = 見込み(n, codes, lives);
      out.push('| ' + n + ' | ' + codes + ' | ' + lives + ' | ' + r.人あたり + '本 | ' + r.時間 + '秒' + (r.時間切れ ? '（時計を越える）' : '') +
        ' | ' + r.ミス + ' | ' + r.爆発 + '% |');
    }
    out.push('');
  });
  console.log(out.join('\n'));
}
module.exports = { 見込み, 案 };
