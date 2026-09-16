// tools/fot-preflight.js — False or True（指示53）の規則を、実装の前に回して確かめる道具
//
// **設計メモの規則をそのままデータにして、机上の想像ではなく回して見る。**
// 指示53の着手前に、これで3つのズレが出た：
//   ① 中身の数：設計メモの**本文**（端数は false 側）と**表**（6人→2:4）が食い違う
//   ② 終了条件「ケースが尽きた」は、規則どおりに回すと一度も起きない
//   ③ 4通りすべてで「生存 ⟺ 中身が true」。奪う/奪わないは**誰が受け取るか**しか決めない
//
// 使い方：
//   node tools/fot-preflight.js          … 全部
//   node tools/fot-preflight.js ratio    … ①だけ
//   node tools/fot-preflight.js end      … ②だけ
//   node tools/fot-preflight.js table    … ③だけ
//   node tools/fot-preflight.js time     … 話し合いの長さごとの所要時間と待ち時間
//
// **乱数は種つき**（Math.random を使わない）。同じ結果が何度でも出る。

// ---- 種つき乱数（線形合同法。再現できることだけが要件） ----
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// ---- 中身の数：2つの読み ----
//   表（4→1 / 5→1 / 6→2 / 8→2）を4行すべて再現するのは round だけ
const TRUE_COUNT = {
  表: (n) => Math.max(1, Math.round(n / 4)),
  本文: (n) => Math.max(1, Math.floor(n / 4))
};

// ---- 設計メモ 7 の結果表（そのまま。ここが正） ----
const 結果表 = [
  { 選択: '奪う', 中身: true, 持ち主: '続投', 相手: '生存' },
  { 選択: '奪う', 中身: false, 持ち主: '続投', 相手: '脱落' },
  { 選択: '奪わない', 中身: false, 持ち主: '脱落', 相手: '選ぶ側へ' },
  { 選択: '奪わない', 中身: true, 持ち主: '生存', 相手: '選ぶ側へ' }
];

/**
 * 1局を最後まで回す。
 * leaveRate を >0 にすると、各段階でその確率で誰かが抜ける（2-8 の3経路）。
 */
function play(n, seed, opt) {
  opt = opt || {};
  const leaveRate = opt.leaveRate || 0;
  const 数え方 = opt.数え方 || '表';
  const R = rng(seed);
  const pick = (a) => a[Math.floor(R() * a.length)];

  const nt = TRUE_COUNT[数え方](n);
  const cases = [];
  for (let i = 0; i < n; i++) cases.push(i < nt);
  for (let i = cases.length - 1; i > 0; i--) {
    const j = Math.floor(R() * (i + 1));
    [cases[i], cases[j]] = [cases[j], cases[i]];
  }

  let undecided = Array.from({ length: n }, (_, i) => i);
  let picker = pick(undecided);
  const everFaced = new Set();
  const faced = new Set();          // 'a-b'（a<b）。二度対面の検出用
  const 二度対面 = [];
  const 初登場 = {};
  let 規則が割れた = 0;             // 完全ランダムと未対面優先が違う候補集合を見た回
  let rounds = 0, guard = 0, end = '';
  const 生存 = [], 脱落 = [], 抜けた = [];

  for (;;) {
    if (++guard > 1000) { end = '詰まった'; break; }
    if (undecided.length <= 1) {
      end = '1人残り';
      if (undecided.length === 1) 生存.push(undecided[0]);
      break;
    }
    if (cases.length === 0) { end = 'ケース尽き'; 生存.push(...undecided); break; }
    if (undecided.indexOf(picker) === -1) picker = pick(undecided);

    // pick 中に「選ぶ人」が抜ける → 次の人へ（ケースは減らない）
    if (R() < leaveRate) {
      抜けた.push(picker);
      undecided = undecided.filter((x) => x !== picker);
      picker = undecided.length ? pick(undecided) : null;
      continue;
    }

    const content = cases.pop();    // ケースを1つ引く

    // peek 中に「中身を見た人」が抜ける → そのケースは消える（人もケースも減る）
    if (R() < leaveRate) {
      抜けた.push(picker);
      undecided = undecided.filter((x) => x !== picker);
      picker = undecided.length ? pick(undecided) : null;
      continue;
    }

    let pool = undecided.filter((x) => x !== picker);
    if (!pool.length) { cases.push(content); end = '相手がいない'; break; }
    const 未対面 = pool.filter((x) => !everFaced.has(x));
    // **2つの案が違う候補集合を見た回を数える**（通常進行では0になるはず）
    if (未対面.length > 0 && 未対面.length < pool.length) 規則が割れた++;
    if (未対面.length) pool = 未対面;
    const opp = pick(pool);

    // talk/decide 中に「対面相手」が抜ける → 対面が流れる（ケースは戻る）
    if (R() < leaveRate) {
      抜けた.push(opp);
      undecided = undecided.filter((x) => x !== opp);
      cases.push(content);
      continue;
    }

    rounds++;
    const key = picker < opp ? picker + '-' + opp : opp + '-' + picker;
    if (faced.has(key)) 二度対面.push(key);
    faced.add(key);
    everFaced.add(picker); everFaced.add(opp);
    if (!(picker in 初登場)) 初登場[picker] = rounds;
    if (!(opp in 初登場)) 初登場[opp] = rounds;

    const 奪う = R() < 0.5;
    if (奪う) {
      (content ? 生存 : 脱落).push(opp);
      undecided = undecided.filter((x) => x !== opp);
    } else {
      (content ? 生存 : 脱落).push(picker);
      undecided = undecided.filter((x) => x !== picker);
      picker = opp;
    }
  }
  return { end, rounds, 生存, 脱落, 抜けた, 二度対面, 初登場, 規則が割れた, 残りケース: cases.length };
}

// ================= ① 中身の数 =================
function 比べる() {
  console.log('=== ① 中身の数：設計メモの「表」と「本文」が食い違う ===');
  console.log('  設計メモの表：4人→1:3 / 5人→1:4 / 6人→2:4 / 8人→2:6');
  console.log('  設計メモの本文：「比は 1:3。端数は false 側へ」');
  console.log('');
  console.log('  人数  表 round(n/4)   本文 floor(n/4)   生存者の期待値（表 → 本文）');
  for (const n of [4, 5, 6, 7, 8]) {
    const a = TRUE_COUNT.表(n), b = TRUE_COUNT.本文(n);
    // N-1ラウンドで N枚中 N-1枚が引かれる。引かれた中の true の期待値 ＋ 最後の1人（自動生存）
    const 生存 = (nt) => nt * (n - 1) / n + 1;
    const 率 = (nt) => (生存(nt) / n * 100).toFixed(0);
    const 同じ = a === b;
    console.log(
      `  ${n}人   ${a} : ${n - a}` + '        ' + `${b} : ${n - b}` +
      `          ${生存(a).toFixed(2)}人(${率(a)}%)` +
      (同じ ? '  ［同じ］' : ` → ${生存(b).toFixed(2)}人(${率(b)}%)  ★食い違う`)
    );
  }
  const 表を再現 = [[4, 1], [5, 1], [6, 2], [8, 2]].every(([n, t]) => TRUE_COUNT.表(n) === t);
  const 本文で再現 = [[4, 1], [5, 1], [6, 2], [8, 2]].every(([n, t]) => TRUE_COUNT.本文(n) === t);
  console.log('');
  console.log(`  表の4行を再現できるか： round=${表を再現 ? 'できる' : 'できない'} / floor=${本文で再現 ? 'できる' : 'できない'}`);
  console.log('  → 表を正とするなら Math.round(n/4)。7人は表に無いので要判断（1 か 2）');
}

// ================= ② 終了条件 =================
function 終わり方() {
  console.log('=== ② 終了条件：「ケースが尽きた」は起きるか ===');
  console.log('  1ラウンドは必ず「ケース1枚」と「確定する人1人」を同時に消す。');
  console.log('  退室は「人だけ」か「人とケース両方」を消す。**ケースだけが減る経路が無い。**');
  console.log('  よって 残りケース数 ≧ 未確定の人数 が崩れない。以下、回して確かめる。');
  console.log('');
  for (const rate of [0, 0.05, 0.15, 0.30]) {
    console.log(`  --- 各段階での退室率 ${(rate * 100).toFixed(0)}% ---`);
    for (const n of [4, 6, 8]) {
      const ends = {};
      for (let s = 1; s <= 30000; s++) {
        const r = play(n, s, { leaveRate: rate });
        ends[r.end] = (ends[r.end] || 0) + 1;
      }
      console.log(`    ${n}人（3万回）: ${JSON.stringify(ends)}`);
    }
  }
  console.log('');
  console.log('  → 合計36万回で「ケース尽き」は0回。条件は保険として実装するが、');
  console.log('     Q7 の証拠は状態を直に組み立てて作るしかない。');
}

// ================= ③ 結果表 =================
function 表を読む() {
  console.log('=== ③ 結果表の4通りが何を決めているか ===');
  let 全部 = true;
  for (const r of 結果表) {
    const 決まる人 = r.選択 === '奪う' ? '相手' : '持ち主';
    const 結果 = r.選択 === '奪う' ? r.相手 : r.持ち主;
    const 一致 = (結果 === '生存') === r.中身;
    if (!一致) 全部 = false;
    console.log(`  ${r.選択.padEnd(5)} × 中身${String(r.中身).padEnd(5)} → 決まるのは【${決まる人}】、結果は【${結果}】  生存⟺true? ${一致 ? 'はい' : 'いいえ'}`);
  }
  console.log('');
  console.log(`  → 4通りすべてで「生存 ⟺ 中身が true」： ${全部 ? '成立' : '不成立'}`);
  console.log('     奪う/奪わないが決めるのは **その運命を誰が受け取るか** だけ。');
  console.log('     だから勝者の人数は、中身の比（①）だけで決まる。');
}

// ================= 二度対面・2案の食い違い =================
function 相手の選び方() {
  console.log('=== 対面の相手：同じ2人が二度対面するか／2案は違う結果を出すか ===');
  for (const n of [4, 5, 6, 7, 8]) {
    let 二度 = 0, 割れ = 0, 最大登場 = 0;
    const rs = [];
    for (let s = 1; s <= 20000; s++) {
      const r = play(n, s);
      if (r.二度対面.length) 二度++;
      割れ += r.規則が割れた;
      rs.push(r.rounds);
    }
    const min = Math.min(...rs), max = Math.max(...rs);
    console.log(`  ${n}人（2万回）: ラウンド ${min}〜${max} / 二度対面 ${二度}回 / 2案が違う候補を見た回 ${割れ}`);
  }
  console.log('');
  console.log('  → 1ラウンドで対面した2人のうち1人が必ず盤から外れるので、二度対面は原理的に起きない。');
  console.log('     「完全ランダム」と「未対面優先」は、通常進行では同じアルゴリズムになる。');
}

// ================= 所要時間と待ち時間 =================
function 時間() {
  const 素 = 39; // 選ぶ10 + 中身を見る8 + 対面3 + 決める10 + 結果8
  console.log(`=== 所要時間（1ラウンド ≒ ${素}秒 ＋ 話し合い） ===`);
  for (const T of [30, 60, 90]) {
    console.log(`  --- 話し合い ${T}秒 ---`);
    for (const n of [4, 5, 6, 8]) {
      const waits = [];
      for (let s = 1; s <= 20000; s++) {
        const r = play(n, s);
        for (let i = 0; i < n; i++) {
          const f = r.初登場[i];
          waits.push(f === undefined ? r.rounds : f - 1);
        }
      }
      waits.sort((a, b) => a - b);
      const per = 素 + T, mx = waits[waits.length - 1];
      console.log(`    ${n}人: 全体 ${((n - 1) * per / 60).toFixed(1)}分 / いちばん長く待つ人の初登場まで ${(mx * per / 60).toFixed(1)}分`);
    }
  }
}

const 何 = process.argv[2];
const 全部 = [比べる, 終わり方, 表を読む, 相手の選び方, 時間];
const 選ぶ = { ratio: [比べる], end: [終わり方], table: [表を読む], pair: [相手の選び方], time: [時間] };
(選ぶ[何] || 全部).forEach((f, i) => { if (i) console.log(''); f(); });

module.exports = { play, TRUE_COUNT, 結果表 };
