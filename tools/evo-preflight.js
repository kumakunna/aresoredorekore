// tools/evo-preflight.js — 進化じゃんけん（指示55-②）の規則を、実装の前に回して確かめる道具
//
// 手本は tools/fot-preflight.js（指示53）。CLAUDE.md「ゲームの規則は、実装の前に回して確かめる」。
//
// **いちばんの用件**：指示書 2-5 の
//   「`'parity'`（奇数の余り）はこのゲームでは起きない想定。起きるかどうかを着手前に確認」
// を、机上ではなく**本物の部品A（public/js/versus.js）を require して回して**確かめる。
//
// ---- この道具が持っているもの／持っていないもの ----
//   ・組をつくる  … **本物**（public/js/versus.js を require。写していない・落とし穴25）
//   ・ランク移動  … **この道具の中に書き下した**（②の実装はまだ無い。preflight の役目そのもの）
//   ・乱数        … 種つき（Math.random を使わない）。同じ結果が何度でも出る
//
// 使い方：
//   node tools/evo-preflight.js selftest … 測り方が効くことを先に見る（必ず最初に）
//   node tools/evo-preflight.js hand     … 3人の部屋の第1回を、手で追った答えと突き合わせる
//   node tools/evo-preflight.js zero     … 「候補ゼロの隣に立つ人」だけを取り出して見る
//   node tools/evo-preflight.js sweep    … 人数3〜12 × 段5/6/10 × 種を変えて何万回も回す
//   node tools/evo-preflight.js streak   … 同じ人が何回続けて不戦勝／AIになるか
//   node tools/evo-preflight.js ai       … AIの出どころ・AIばかりになる分布
//   node tools/evo-preflight.js end      … 決着の回に何が起きているか
//   node tools/evo-preflight.js          … 全部

'use strict';
const path = require('path');
const V = require(path.join(__dirname, '..', 'public', 'js', 'versus.js'));

// ---- 種つき乱数（線形合同法。再現できることだけが要件。fot-preflight.js と同じ式） ----
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// ---- 数えるときに使う文字列は**literalで書く** ----
// 落とし穴10-a（自己参照）：V.理由なし.余り をそのまま検査の入力にすると、
// 実装側で値を変えた日に検査も一緒にずれて素通りする。値そのものの一致は selftest で別に見る。
const PARITY = 'parity';
const NOCAND = 'no-candidate';

// ================= ②の規則（この道具の中に書き下したもの） =================
//
// 指示書 2-2 / 2-3 から。**どれも「まだ実装が無い」ので、ここが仮の正本**。
//   ・全員 最下段（段0）から開始
//   ・第1希望＝同ランク／第2希望＝1つ上（2-5 そのまま）
//   ・勝ち＝1つ上／負け＝そのまま＋連敗1／2連敗で1つ下（最下段は落ちない）／上がったら連敗リセット
//   ・'1つ上' の組（＝挑戦）… 挑戦側：勝てば2つ上（チャンピオンにはならない＝最終段-1 で止まる）
//                              負けても落ちない・連敗も数えない
//                            上の人：勝っても上がらない／負けは数えるが**1回目は落ちない**
//   ・'no-candidate' … 弱いAIと1戦（75%でAIが負け／10%でAIが勝ち／15%あいこ）
//                      勝てば1つ上／負けても落ちない
//   ・'parity'       … 不戦勝。**何も動かない**（2-5・禁止「不戦勝でランクを上げる」）
//   ・あいこは3回まで。3連続あいこ＝引き分けで両者動かない（2-3）
//   ・最終段で勝てば、その瞬間に全体終了／最終段で負けたら1つ下へ
//
// **はっきりしない所は下に「※」で書いて、両方の読みで回して差を見る。**
const 最大回 = 60;   // 10分 ÷ 1回およそ10秒（発表＋3秒＋開く）。打ち切りの代わり

function 希望を作る(案) {
  const h = [
    { 理由: '同ランク', 候補: (名簿, 人) => 名簿.filter((x) => x.id !== 人.id && x.段 === 人.段) },
    { 理由: '1つ上', 候補: (名簿, 人) => 名簿.filter((x) => x.id !== 人.id && x.段 === 人.段 + 1) }
  ];
  // **部品Aを1行も書き換えずにできる直し方の候補**（指示書2-5「足りないものがあれば報告」）。
  // 第3希望「1つ下」を足すと、上の段に1人でいる人が **候補ゼロに落ちなくなる**ので、
  // その人を第2希望に持っていた下の人も届くようになる。効き目はここで測る（fix モード）
  if (案 === '3段') {
    h.push({ 理由: '1つ下', 候補: (名簿, 人) => 名簿.filter((x) => x.id !== 人.id && x.段 === 人.段 - 1) });
  }
  return h;
}

/** 人どうしのじゃんけん。あいこは3回まで → 4回目を作らず引き分け */
function じゃんけん(R) {
  for (let i = 0; i < 3; i++) {
    const r = R();
    if (r < 1 / 3) return 'a';
    if (r < 2 / 3) return 'b';
  }
  return 'draw';
}

/** AI戦。**AIの側から見た**：75%で負ける手／10%で勝つ手／15%であいこ */
function AI戦(R) {
  for (let i = 0; i < 3; i++) {
    const r = R();
    if (r < 0.75) return 'win';     // 人の勝ち
    if (r < 0.85) return 'lose';    // 人の負け
  }
  return 'draw';
}

function 新しい人() {
  return { 段: 0, 連敗: 0, 挑戦負け: 0, 直前の相手: null, 不戦勝連続: 0, AI連続: 0, 不戦勝計: 0, AI計: 0, 最大不戦勝連続: 0, 最大AI連続: 0 };
}

/**
 * 1局を最後まで回す。
 * @param {number} n 人数
 * @param {number} 段数 段の数（通常5/6・CS10）
 * @param {number} seed 種
 * @param {object} opt { 読み:'A'|'B' … 「上の人の負けは1回目は落ちない」の2通りの読み }
 */
function 一局(n, 段数, seed, opt) {
  opt = opt || {};
  const 読み = opt.読み || 'A';
  // **指示書 2-1 と 2-2 は食い違っている**（着手前に見つけたズレ）：
  //   2-1「最終形に**達したら**優勝」  … 到達で優勝 = true
  //   2-2「最終形で**勝てば**その瞬間に1位」＋「チャンピオンで負けたら1つ下」 … false
  // 2-1 が正なら「チャンピオンで負ける」という場面が**原理的に作れない**。
  // どちらが正かは本人の裁定。ここでは両方で回して、結論が変わるかを測る（goal モード）
  const 到達で優勝 = !!opt.到達で優勝;
  const R = rng(seed);
  const 最終段 = 段数 - 1;
  const ids = [];
  for (let i = 0; i < n; i++) ids.push('p' + i);
  const W = {};
  ids.forEach((id) => { W[id] = 新しい人(); });
  let 直前の不戦勝 = null;

  const 記 = {
    n, 段数, seed,
    回: 0, 組: 0, 同ランク組: 0, 挑戦組: 0, 挑戦だが単独でない: 0,
    parity: 0, parityの回: 0, nocand: 0, nocandの回: 0,
    全員nocandの回: 0, 最大nocand: 0, 最大parity: 0, parity2人以上の回: 0,
    parity分布: [],        // parity が出た瞬間の段の分布（署名）
    parity型: { 同ランクの余り: 0, 上が全員候補ゼロ: 0, 上が先に取られた: 0, 説明できない: 0 },
    向きが逆の挑戦: 0,     // 道具の健全さ：'1つ上' の組で a が下でなかった回
    終わり方: '打ち切り', 優勝: null, 決着の理由: null
  };

  for (let 回 = 1; 回 <= 最大回; 回++) {
    const 名簿 = ids.map((id) => ({ id, 段: W[id].段 }));
    const res = V.組をつくる(名簿, {
      rnd: R,
      希望: 希望を作る(opt.希望案),
      避ける: (a, b) => W[a.id].直前の相手 === b.id,
      余りの吸収: 'bye',
      // 既定は true（指示書 2-5）。**対照（false）と並べないと「効いた」と言えない**ので切れる形にする
      連続不戦勝を避ける: opt.連続を避けない ? false : true,
      直前の不戦勝: 直前の不戦勝
    });
    記.回++;
    記.組 += res.組.length;

    const parity達 = res.相手なし.filter((x) => x.なぜ === PARITY).map((x) => x.id);
    const nocand達 = res.相手なし.filter((x) => x.なぜ === NOCAND).map((x) => x.id);
    if (parity達.length) {
      記.parity += parity達.length;
      記.parityの回++;
      // **1回に何人 parity が出るか**。rcard-room.js:177-180 は 余り[0] しか見ない形なので、
      // ②が同じ形を写すと2人目以降が黙って消える（落とし穴1・借りたものはその世界観ごと運ばれる）
      if (parity達.length > 記.最大parity) 記.最大parity = parity達.length;
      if (parity達.length >= 2) 記.parity2人以上の回++;
      記.parity分布.push(分布署名(名簿));
      // **parity は2通りある**。どちらが多いかで、直し方が変わる
      parity達.forEach((id) => {
        const 段 = W[id].段;
        const 同 = 名簿.filter((x) => x.id !== id && x.段 === 段).length;
        const 上 = 名簿.filter((x) => x.段 === 段 + 1).map((x) => x.id);
        if (同 > 0) 記.parity型.同ランクの余り++;
        else if (上.length && 上.every((u) => nocand達.indexOf(u) !== -1)) 記.parity型.上が全員候補ゼロ++;
        else if (上.length) 記.parity型.上が先に取られた++;
        else 記.parity型.説明できない++;   // 起きたら道具か読みが間違っている
      });
    }
    if (nocand達.length) {
      記.nocand += nocand達.length;
      記.nocandの回++;
      if (nocand達.length > 記.最大nocand) 記.最大nocand = nocand達.length;
      if (nocand達.length === n) 記.全員nocandの回++;
    }

    // ---- 組を片付ける ----
    let 終了 = null;
    for (const g of res.組) {
      const a = g.a, b = g.b;
      W[a].直前の相手 = b; W[b].直前の相手 = a;
      W[a].不戦勝連続 = 0; W[b].不戦勝連続 = 0;
      W[a].AI連続 = 0; W[b].AI連続 = 0;
      const 手 = じゃんけん(R);
      if (g.理由 === '1つ上' || g.理由 === '1つ下') {
        記.挑戦組++;
        // 下の人が挑戦側。**印の向きに頼らず段で決める**（道具の健全さ・落とし穴28）
        const 下 = W[a].段 <= W[b].段 ? a : b;
        const 上 = 下 === a ? b : a;
        if (W[下].段 + 1 !== W[上].段) 記.向きが逆の挑戦++;
        // 「1人ランクの人が上と当たる」はずだが、**同ランクの相手が取られただけ**でも
        // 第2希望に落ちる。その回を数える（部品Aの形と、指示書の言葉のずれ）
        const 同ランクの人数 = 名簿.filter((x) => x.段 === W[下].段).length;
        if (同ランクの人数 > 1) 記.挑戦だが単独でない++;
        const 下の勝ち = (手 === 'a') === (下 === a);
        if (手 !== 'draw' && 下の勝ち) {          // 挑戦側の勝ち
          W[下].段 = Math.min(W[下].段 + 2, 最終段 - 1);
          W[下].連敗 = 0;
          // 上の人の負け
          W[上].挑戦負け++;
          if (W[上].段 === 最終段) { W[上].段 = 最終段 - 1; W[上].連敗 = 0; }
          else if (読み === 'A') {
            W[上].連敗++;
            if (W[上].連敗 >= 2) {
              if (W[上].挑戦負け === 1) W[上].連敗 = 0;      // ※1回目は落ちない
              else { if (W[上].段 > 0) W[上].段--; W[上].連敗 = 0; }
            }
          } else {
            // ※読みB：1回目の挑戦負けは連敗にも数えない
            if (W[上].挑戦負け > 1) {
              W[上].連敗++;
              if (W[上].連敗 >= 2) { if (W[上].段 > 0) W[上].段--; W[上].連敗 = 0; }
            }
          }
        } else if (手 !== 'draw') {                // 上の人の勝ち
          if (W[上].段 === 最終段) { 終了 = { 優勝: 上, 理由: '挑戦を受けて勝ち' }; break; }
          // 勝っても上がらない。挑戦側は負けても落ちない・連敗も数えない
        }
        // draw は両者動かない
      } else {
        記.同ランク組++;
        if (手 === 'draw') continue;
        const 勝 = 手 === 'a' ? a : b;
        const 負 = 手 === 'a' ? b : a;
        if (W[勝].段 === 最終段) { 終了 = { 優勝: 勝, 理由: '同ランクで勝ち' }; break; }
        W[勝].段++; W[勝].連敗 = 0;
        // ※読みC（指示書 2-1「最終形に達したら優勝」）：**達した瞬間**に終わる
        if (到達で優勝 && W[勝].段 === 最終段) { 終了 = { 優勝: 勝, 理由: '同ランクで勝ち' }; break; }
        if (W[負].段 === 最終段) { W[負].段 = 最終段 - 1; W[負].連敗 = 0; }
        else {
          W[負].連敗++;
          if (W[負].連敗 >= 2) { if (W[負].段 > 0) W[負].段--; W[負].連敗 = 0; }
        }
      }
    }
    if (終了) { 記.終わり方 = '優勝'; 記.優勝 = 終了.優勝; 記.決着の理由 = 終了.理由; break; }

    // ---- 相手なし ----
    直前の不戦勝 = parity達.length ? parity達[0] : null;   // rcard-room.js:177-182 と同じ形（1人だけ）
    parity達.forEach((id) => {
      W[id].直前の相手 = null;
      W[id].不戦勝計++; W[id].不戦勝連続++; W[id].AI連続 = 0;
      if (W[id].不戦勝連続 > W[id].最大不戦勝連続) W[id].最大不戦勝連続 = W[id].不戦勝連続;
      // **何も動かない**（禁止：不戦勝でランクを上げる）
    });
    for (const id of nocand達) {
      W[id].直前の相手 = null;
      W[id].AI計++; W[id].AI連続++; W[id].不戦勝連続 = 0;
      if (W[id].AI連続 > W[id].最大AI連続) W[id].最大AI連続 = W[id].AI連続;
      const 手 = AI戦(R);
      if (手 === 'win') {
        if (W[id].段 === 最終段) { 終了 = { 優勝: id, 理由: 'AIに勝ち' }; break; }
        W[id].段++; W[id].連敗 = 0;
        if (到達で優勝 && W[id].段 === 最終段) { 終了 = { 優勝: id, 理由: 'AIに勝ち' }; break; }
      }
      // lose も draw も何も動かない（負けても落ちない・連敗も数えない）
    }
    if (終了) { 記.終わり方 = '優勝'; 記.優勝 = 終了.優勝; 記.決着の理由 = 終了.理由; break; }
  }
  記.W = W;
  return 記;
}

/** その回の段の分布を1つの文字列に（例 "0:1,1:2"） */
function 分布署名(名簿) {
  const c = {};
  名簿.forEach((x) => { c[x.段] = (c[x.段] || 0) + 1; });
  return Object.keys(c).map(Number).sort((a, b) => a - b).map((k) => k + ':' + c[k]).join(',');
}

// ================= selftest：測り方が効くことを先に見る =================
let 失敗 = 0;
function 見る(名, 実, 期) {
  const ok = String(実) === String(期);
  if (!ok) 失敗++;
  console.log(`  ${ok ? 'OK ' : '×  '} ${名}： ${実}${ok ? '' : `（期待 ${期}）`}`);
}

function selftest() {
  console.log('=== SELFTEST：この道具そのものが嘘をついていないか（落とし穴28） ===');
  console.log('');
  console.log('  -- (1) 本物の部品Aを読んでいるか --');
  見る('組をつくる が関数', typeof V.組をつくる, 'function');
  見る('理由なし.余り の実値', V.理由なし.余り, PARITY);
  見る('理由なし.候補ゼロ の実値', V.理由なし.候補ゼロ, NOCAND);

  console.log('');
  console.log('  -- (2) parity を**必ず**起こす入力で、ちゃんと数えられるか --');
  {
    // 同じ段に3人。1組できて1人余る。この余りは「候補はいた」ので parity
    const 名簿 = [{ id: 'a', 段: 0 }, { id: 'b', 段: 0 }, { id: 'c', 段: 0 }];
    const res = V.組をつくる(名簿, { rnd: rng(7), 希望: 希望を作る() });
    const p = res.相手なし.filter((x) => x.なぜ === PARITY);
    const nc = res.相手なし.filter((x) => x.なぜ === NOCAND);
    見る('組の数', res.組.length, 1);
    見る('parity の人数', p.length, 1);
    見る('no-candidate の人数', nc.length, 0);
  }

  console.log('');
  console.log('  -- (3) 分岐の逆側：parity が**出ない**入力で 0 と数えられるか（落とし穴10-c） --');
  {
    const 名簿 = [{ id: 'a', 段: 0 }, { id: 'b', 段: 0 }, { id: 'c', 段: 3 }, { id: 'd', 段: 3 }];
    const res = V.組をつくる(名簿, { rnd: rng(7), 希望: 希望を作る() });
    見る('組の数', res.組.length, 2);
    見る('parity の人数', res.相手なし.filter((x) => x.なぜ === PARITY).length, 0);
    見る('no-candidate の人数', res.相手なし.filter((x) => x.なぜ === NOCAND).length, 0);
  }

  console.log('');
  console.log('  -- (4) no-candidate を必ず起こす入力（AIの側も数えられるか） --');
  {
    // 段が2つ以上離れた3人。どの段階でも候補が1人もいない
    const 名簿 = [{ id: 'a', 段: 0 }, { id: 'b', 段: 4 }, { id: 'c', 段: 8 }];
    const res = V.組をつくる(名簿, { rnd: rng(7), 希望: 希望を作る() });
    見る('組の数', res.組.length, 0);
    見る('no-candidate の人数', res.相手なし.filter((x) => x.なぜ === NOCAND).length, 3);
    見る('parity の人数', res.相手なし.filter((x) => x.なぜ === PARITY).length, 0);
  }

  console.log('');
  console.log('  -- (5) ランク移動の書き下しが、指示書の6行どおりか --');
  {
    // 同ランクの勝ち／負け／2連敗／最下段／上がって連敗リセット
    const 段数 = 6, 最終段 = 5;
    const w = 新しい人(); w.段 = 2;
    // 2連敗で1つ下
    w.連敗 = 1; w.連敗++; if (w.連敗 >= 2) { if (w.段 > 0) w.段--; w.連敗 = 0; }
    見る('段2で2連敗 → 段1', w.段, 1);
    // 最下段は落ちない
    const x = 新しい人(); x.段 = 0; x.連敗 = 1; x.連敗++;
    if (x.連敗 >= 2) { if (x.段 > 0) x.段--; x.連敗 = 0; }
    見る('最下段で2連敗 → 段0のまま', x.段, 0);
    // 挑戦で勝てば2つ上・チャンピオンにはならない
    const y = 新しい人(); y.段 = 最終段 - 2;
    見る('チャレンジャーの1つ下から挑戦勝ち → 最終段-1 で止まる', Math.min(y.段 + 2, 最終段 - 1), 最終段 - 1);
    const z = 新しい人(); z.段 = 1;
    見る('段1から挑戦勝ち → 段3', Math.min(z.段 + 2, 最終段 - 1), 3);
  }

  console.log('');
  console.log('  -- (6) AIの分布（75/10/15）が、書いたとおりに出るか --');
  {
    const R = rng(99);
    let w = 0, l = 0, d = 0;
    const N = 200000;
    for (let i = 0; i < N; i++) { const r = R(); if (r < 0.75) w++; else if (r < 0.85) l++; else d++; }
    const p = (x) => (x / N * 100).toFixed(2) + '%';
    console.log(`     1手あたり： 人の勝ち ${p(w)} ／ 人の負け ${p(l)} ／ あいこ ${p(d)}（期待 75 / 10 / 15）`);
    見る('人の勝ちが 74〜76%', (w / N > 0.74 && w / N < 0.76), 'true');
    見る('人の負けが 9〜11%', (l / N > 0.09 && l / N < 0.11), 'true');
  }

  console.log('');
  console.log('  -- (7) 種を固定すれば同じ結果が出るか --');
  {
    const a = 一局(7, 6, 1234);
    const b = 一局(7, 6, 1234);
    見る('同じ種で同じ回数', a.回, b.回);
    見る('同じ種で同じ parity 数', a.parity, b.parity);
    const c = 一局(7, 6, 1235);
    見る('種を変えれば違う（どちらかが違う）', (a.回 !== c.回 || a.parity !== c.parity), 'true');
  }

  console.log('');
  console.log(`  → SELFTEST：${失敗 === 0 ? '全部 OK' : `**${失敗}件 失敗**`}`);
}

// ================= hand：3人の部屋の第1回を、手で追う =================
function 手で追う() {
  console.log('=== 3人の部屋（最小人数）の第1回を、手で追った答えと突き合わせる ===');
  console.log('  前提：全員 最下段（段0）から開始（指示書 2-2）。');
  console.log('  手で追う：3人とも段0なので、第1希望（同ランク）の候補は互いに2人ずつ。');
  console.log('            → 3人とも「候補あり」＝組める。候補ゼロは0人。');
  console.log('            → 貪欲に組むと1組できて、**必ず1人余る**。');
  console.log('            → 余った人の第2希望は段1だが、第1回は誰も段1にいない＝空。');
  console.log('            → よってその人は **parity（不戦勝）**。no-candidate ではない。');
  console.log('');
  let 一致 = 0, 全 = 0, 余りの内訳 = {};
  for (let s = 1; s <= 12; s++) {
    const 名簿 = [{ id: 'あき', 段: 0 }, { id: 'びび', 段: 0 }, { id: 'ちこ', 段: 0 }];
    // **本物と同じ順**を作る：組をつくる は o.rnd を shuffled に1度だけ使う（versus.js:165）
    const 順 = V.shuffled(名簿, rng(s)).map((x) => x.id);
    // 手で追った答え：順の先頭が、名簿の並び順で最初に見つかる相手と組む
    const 先 = 順[0];
    const 相手 = 名簿.map((x) => x.id).filter((id) => id !== 先)[0];
    const 手の余り = 名簿.map((x) => x.id).filter((id) => id !== 先 && id !== 相手)[0];
    const res = V.組をつくる(名簿, { rnd: rng(s), 希望: 希望を作る() });
    const 実の余り = res.相手なし.length === 1 ? res.相手なし[0].id : '(' + res.相手なし.length + '人)';
    const 実の理由 = res.相手なし.length === 1 ? res.相手なし[0].なぜ : '-';
    const ok = (実の余り === 手の余り) && 実の理由 === PARITY && res.組.length === 1;
    全++; if (ok) 一致++;
    余りの内訳[実の余り] = (余りの内訳[実の余り] || 0) + 1;
    if (s <= 6) {
      console.log(`  種${String(s).padStart(2)}： 順=${順.join('>')}  手で追った余り=${手の余り}  実際=${実の余り}(${実の理由})  組=${res.組.map((g) => g.a + '×' + g.b + '[' + g.理由 + ']').join(' ')}  ${ok ? '一致' : '★ずれ'}`);
    }
  }
  console.log('');
  console.log(`  ${全}種すべて一致： ${一致}/${全}`);
  console.log(`  余りになった人の内訳： ${JSON.stringify(余りの内訳)}`);
  console.log('  → **3人の部屋は、第1回で必ず parity が1人出る。**「起きない想定」は成り立たない。');
  console.log('');
  console.log('  ※ 内訳に「あき」が1回も出ていないことに注意。**これは種の偏りではなく、部品Aの性質**。');
  console.log('    詳しくは  node tools/evo-preflight.js seat');
}

// ================= seat：誰が余るかは、名簿の並び順で決まっている =================
//
// 手で追う の内訳で「先頭の人が1回も余らない」ことに気づいて足した（第55弾・②の着手前調査）。
// **これは②だけの話ではない**——①ロシアンカードも同じ部品Aで不戦勝を出している
// （rcard-room.js:157-182）ので、①の不戦勝も同じ偏り方をしている。
function 席の偏り() {
  console.log('=== 全員が同じ段の回で、**誰が** parity になるか（名簿の並び順ごと） ===');
  console.log('  原因は versus.js:193   var 相手 = (好み.length ? 好み : 空いている)[0];');
  console.log('  候補たち(:145) は 全員 の並び順を保つ。**先に選ぶ人は、いつも名簿の先頭に近い方を取る**ので、');
  console.log('  先頭の席は早く埋まり、余るのはいつも後ろの席になる。');
  console.log('');
  const N = 20000;
  for (const n of [3, 5, 7, 9, 11]) {
    const 名簿 = [];
    for (let i = 0; i < n; i++) 名簿.push({ id: 'p' + i, 段: 0 });
    const c = new Array(n).fill(0);
    for (let s = 1; s <= N; s++) {
      const res = V.組をつくる(名簿, { rnd: rng(s), 希望: 希望を作る() });
      const x = res.相手なし.filter((y) => y.なぜ === PARITY)[0];
      if (x) c[Number(x.id.slice(1))]++;
    }
    const 決して余らない = c.filter((v) => v === 0).length;
    console.log(`  ${String(n).padStart(2)}人（${N}回）  公平なら各 ${(100 / n).toFixed(1)}%`);
    console.log(`     ${c.map((v, i) => 'p' + i + ':' + (v / N * 100).toFixed(1) + '%').join('  ')}`);
    console.log(`     → **1度も余らない席が ${決して余らない}/${n}**。いちばん余る席は ${(Math.max.apply(null, c) / N * 100).toFixed(1)}%（公平の ${(Math.max.apply(null, c) / N * n).toFixed(1)}倍）`);
  }
  console.log('');
  console.log('  ※ ①では不戦勝＝体力を減らさずに次へ進めるので**得**（設計メモの ④ がすでに指摘している）。');
  console.log('    ②では不戦勝＝その回は何も動かない＝**上がれない**ので**損**。**向きは逆だが、偏りは同じ**。');
}

// ================= many：1回に parity が何人出るか =================
function 余りが何人() {
  console.log('=== 1回の parity は何人まで出るか（rcard-room.js:177-180 は 余り[0] しか見ない） ===');
  console.log('  ①は 希望 を渡さないので余りは必ず1人以下。**②は希望があるので2人以上出る。**');
  console.log('  ①の形（余り[0]）をそのまま写すと、2人目以降が黙って消える（落とし穴1・2）。');
  console.log('');
  const 局数 = 1500;
  console.log('   人数  段数   回(合計)  1回の最大parity人数  parityが2人以上だった回  その割合');
  for (const 段数 of [5, 6, 10]) {
    for (let n = 3; n <= 12; n++) {
      let 回 = 0, 最大 = 0, 複数 = 0;
      for (let s = 1; s <= 局数; s++) {
        const r = 一局(n, 段数, s * 7919 + n * 131 + 段数);
        回 += r.回; 複数 += r.parity2人以上の回;
        if (r.最大parity > 最大) 最大 = r.最大parity;
      }
      console.log(
        `   ${String(n).padStart(2)}人  ${String(段数).padStart(2)}段  ${String(回).padStart(8)}  ` +
        `${String(最大).padStart(18)}  ${String(複数).padStart(22)}  ${(複数 / 回 * 100).toFixed(1).padStart(7)}%`
      );
    }
    console.log('');
  }
  console.log('  ※ `連続不戦勝を避ける` に渡せる `直前の不戦勝` は **id 1つだけ**（versus.js:169-174）。');
  console.log('    2人以上あぶれた回は、**次の回に守れるのは1人だけ**。');
}

// ================= zero：候補ゼロの隣に立つ人 =================
function 候補ゼロの隣() {
  console.log('=== 「候補ゼロの人しか候補がいない人」は組めるか（versus.js:156-162 の読み） ===');
  console.log('  versus.js は **名簿全体**に対して候補があるかで「組める／候補ゼロ」を分ける（:158-162）。');
  console.log('  ところが貪欲に組む相手は **組める人の中だけ**（:177-178 の 空き）。');
  console.log('  → 自分の候補が「候補ゼロに落ちた人」しかいない人は、**組めるのに相手がいない**。');
  console.log('');
  const 例 = [
    { 名: 'A=段1に1人／B=段0に1人／他は段5で2人（4人部屋）', 名簿: [{ id: 'A', 段: 1 }, { id: 'B', 段: 0 }, { id: 'D', 段: 5 }, { id: 'E', 段: 5 }] },
    { 名: 'A=段1に1人／B=段0に1人／C=段4に1人（3人部屋）', 名簿: [{ id: 'A', 段: 1 }, { id: 'B', 段: 0 }, { id: 'C', 段: 4 }] },
    { 名: '**決着の直前**：チャンピオン1人＋チャレンジャー1人＋段0が2人', 名簿: [{ id: 'CH', 段: 5 }, { id: 'CL', 段: 4 }, { id: 'x', 段: 0 }, { id: 'y', 段: 0 }] },
    { 名: '段が1つずつ違う3人（0/1/2）', 名簿: [{ id: 'A', 段: 2 }, { id: 'B', 段: 1 }, { id: 'C', 段: 0 }] }
  ];
  for (const e of 例) {
    const res = V.組をつくる(e.名簿, { rnd: rng(3), 希望: 希望を作る() });
    console.log(`  ${e.名}`);
    console.log(`    組        ： ${res.組.length ? res.組.map((g) => g.a + '×' + g.b + '[' + g.理由 + ']').join(' ') : '（なし）'}`);
    console.log(`    相手なし  ： ${res.相手なし.map((x) => x.id + '(' + x.なぜ + ')').join(' ') || '（なし）'}`);
    // その人の第2希望が誰だったかを、名簿全体に対して出す
    res.相手なし.filter((x) => x.なぜ === PARITY).forEach((x) => {
      const 人 = e.名簿.find((y) => y.id === x.id);
      const 上 = e.名簿.filter((y) => y.段 === 人.段 + 1).map((y) => y.id);
      const 同 = e.名簿.filter((y) => y.id !== 人.id && y.段 === 人.段).map((y) => y.id);
      console.log(`    ★ ${x.id} は parity。第1希望(同ランク)=[${同.join(',')}] 第2希望(1つ上)=[${上.join(',')}]`);
      console.log(`       → 第2希望に人が居るのに組めていない場合、原因は「その人が候補ゼロで先に外れた」`);
    });
    console.log('');
  }
}

// ================= sweep：人数 × 段数 × 種 =================
function 掃く(opt) {
  opt = opt || {};
  const 局数 = opt.局数 || 2000;
  const 読み = opt.読み || 'A';
  console.log(`=== 人数3〜12 × 段5/6/10 × 種${局数}通り（読み${読み}）。parity は起きるか ===`);
  console.log('');
  let 総回 = 0, 総局 = 0;
  for (const 段数 of [5, 6, 10]) {
    console.log(`  --- 段数 ${段数} ---`);
    console.log('   人数   局数   回(合計)  parityが出た回  parity人数  1局あたりparity  AIが出た回  優勝で終わった局');
    for (let n = 3; n <= 12; n++) {
      let 回 = 0, pr = 0, pc = 0, nr = 0, 優勝 = 0, 逆 = 0;
      for (let s = 1; s <= 局数; s++) {
        const r = 一局(n, 段数, s * 7919 + n * 131 + 段数, { 読み });
        回 += r.回; pr += r.parityの回; pc += r.parity; nr += r.nocandの回;
        if (r.終わり方 === '優勝') 優勝++;
        逆 += r.向きが逆の挑戦;
      }
      総回 += 回; 総局 += 局数;
      console.log(
        `   ${String(n).padStart(2)}人  ${String(局数).padStart(5)}  ${String(回).padStart(8)}  ` +
        `${String(pr).padStart(12)}  ${String(pc).padStart(10)}  ${(pc / 局数).toFixed(2).padStart(14)}  ` +
        `${String(nr).padStart(9)}  ${String(優勝).padStart(14)}` + (逆 ? `  ★向きが逆の挑戦 ${逆}` : '')
      );
    }
    console.log('');
  }
  console.log(`  合計： ${総局} 局 / ${総回} 回（＝組をつくる を ${総回} 回呼んだ）`);
}

/** parity が出た瞬間の分布を数える */
function parityの分布(opt) {
  opt = opt || {};
  const 局数 = opt.局数 || 2000;
  console.log('=== parity が出た瞬間、段の分布はどうなっているか（上位15） ===');
  const c = {};
  let 合計 = 0;
  for (const 段数 of [5, 6, 10]) {
    for (let n = 3; n <= 12; n++) {
      for (let s = 1; s <= 局数; s++) {
        const r = 一局(n, 段数, s * 7919 + n * 131 + 段数);
        r.parity分布.forEach((sig) => { const k = `${n}人 ${sig}`; c[k] = (c[k] || 0) + 1; 合計++; });
      }
    }
  }
  const 並び = Object.keys(c).sort((a, b) => c[b] - c[a]).slice(0, 15);
  console.log(`  parity の総数 ${合計}`);
  並び.forEach((k) => console.log(`    ${String(c[k]).padStart(7)} 回  ${k}`));
  console.log('');
  // 奇数人数・偶数人数で分ける
  let 奇 = 0, 偶 = 0, 奇回 = 0, 偶回 = 0;
  for (const 段数 of [5, 6, 10]) {
    for (let n = 3; n <= 12; n++) {
      for (let s = 1; s <= 局数; s++) {
        const r = 一局(n, 段数, s * 7919 + n * 131 + 段数);
        if (n % 2) { 奇 += r.parity; 奇回 += r.回; } else { 偶 += r.parity; 偶回 += r.回; }
      }
    }
  }
  console.log(`  奇数人数： ${奇回}回のうち parity ${奇}人ぶん（1回あたり ${(奇 / 奇回).toFixed(3)}）`);
  console.log(`  偶数人数： ${偶回}回のうち parity ${偶}人ぶん（1回あたり ${(偶 / 偶回).toFixed(3)}）`);
}

// ================= parity の型と、挑戦の中身 =================
function 型を分ける() {
  const 局数 = 2000;
  console.log('=== parity は2通りある。どちらが多いか ===');
  console.log('   (i)  同ランクの余り      … 同じ段に奇数人いて、1人あぶれた（相手は全員取られた）');
  console.log('   (ii) 上が全員候補ゼロ    … 同ランクが0人。第2希望(1つ上)に人は居るが、');
  console.log('        **その人が先に「候補ゼロ」として外れている**ので届かない');
  console.log('        （versus.js:156-162 で組めるを決め、:177-178 の 空き だけで組むことの帰結）');
  console.log('   (iii)上が先に取られた    … 同ランクが0人。上の人は組めたが、別の人と先に組んだ');
  console.log('');
  console.log('   段数   parity合計   (i)同ランクの余り   (ii)上が全員候補ゼロ   (iii)上が先に取られた   説明できない');
  for (const 段数 of [5, 6, 10]) {
    const t = { 同ランクの余り: 0, 上が全員候補ゼロ: 0, 上が先に取られた: 0, 説明できない: 0 };
    for (let n = 3; n <= 12; n++) {
      for (let s = 1; s <= 局数; s++) {
        const r = 一局(n, 段数, s * 7919 + n * 131 + 段数);
        Object.keys(t).forEach((k) => { t[k] += r.parity型[k]; });
      }
    }
    const 合 = t.同ランクの余り + t.上が全員候補ゼロ + t.上が先に取られた + t.説明できない;
    const p = (x) => `${x}（${(x / 合 * 100).toFixed(1)}%）`;
    console.log(`   ${String(段数).padStart(2)}段  ${String(合).padStart(10)}   ${p(t.同ランクの余り).padStart(18)}   ${p(t.上が全員候補ゼロ).padStart(20)}   ${p(t.上が先に取られた).padStart(20)}   ${String(t.説明できない).padStart(12)}`);
  }
  console.log('');
  console.log('=== 「1つ上」の組は、本当に「1人ランクの人」か ===');
  console.log('   指示書 2-2 は「**1人しかいないランクの人**が上と当たる」と書いてある。');
  console.log('   部品Aの段階は全員に同じ形で当たるので、**同ランクの相手を取られただけ**の人も');
  console.log('   第2希望に落ちる。落ちた先の組には 理由 "1つ上" の印が付き、');
  console.log('   「勝てば2つ上・負けても落ちない」が**1人ランクでない人にも効いてしまう**。');
  console.log('');
  console.log('   段数   1つ上の組(合計)   うち 1人ランクでない人の挑戦   割合');
  for (const 段数 of [5, 6, 10]) {
    let 挑戦 = 0, 単独でない = 0;
    for (let n = 3; n <= 12; n++) {
      for (let s = 1; s <= 局数; s++) {
        const r = 一局(n, 段数, s * 7919 + n * 131 + 段数);
        挑戦 += r.挑戦組; 単独でない += r.挑戦だが単独でない;
      }
    }
    console.log(`   ${String(段数).padStart(2)}段  ${String(挑戦).padStart(14)}   ${String(単独でない).padStart(26)}   ${挑戦 ? (単独でない / 挑戦 * 100).toFixed(1) + '%' : '-'}`);
  }
}

/** 「上の人の負けは1回目は落ちない」の2通りの読みで、parity の数が変わるか */
function 読み比べ() {
  console.log('=== 読みの違いで parity の結論が変わるか（この道具の弱点を自分で測る） ===');
  console.log('   読みA … 挑戦負けも連敗に数える。2連敗になっても**1回目の挑戦負けなら落ちない**');
  console.log('   読みB … **1回目の挑戦負けは連敗にも数えない**');
  console.log('');
  console.log('   段数   読みA parity/回     読みB parity/回');
  for (const 段数 of [5, 6, 10]) {
    const 出 = {};
    for (const 読み of ['A', 'B']) {
      let 回 = 0, p = 0;
      for (let n = 3; n <= 12; n++) {
        for (let s = 1; s <= 1000; s++) {
          const r = 一局(n, 段数, s * 7919 + n * 131 + 段数, { 読み });
          回 += r.回; p += r.parity;
        }
      }
      出[読み] = (p / 回).toFixed(3) + `（${p}/${回}）`;
    }
    console.log(`   ${String(段数).padStart(2)}段   ${出.A.padStart(18)}   ${出.B.padStart(18)}`);
  }
  console.log('');
  console.log('   → どちらの読みでも parity は同じくらい起きる。**結論は読みに依存しない**。');
}

// ================= fix：部品Aを書き換えずに直せるか =================
function 直し方を測る() {
  console.log('=== 第3希望「1つ下」を足すと何が変わるか（部品Aは1行も触らない・opts だけ） ===');
  console.log('  もとの読み：上の段に1人でいる人は、いま「同ランク0人・1つ上0人」で**候補ゼロ**に落ちる。');
  console.log('  「1つ下」を足せばその人は候補を持つので **組める** 側に残り、');
  console.log('  その人を第2希望にしていた下の人が届く（型(ii)の原因が消える）。');
  console.log('');
  console.log('  **回して分かったのは、半分だけ当たっていたということ：**');
  console.log('   ・型(ii) は本当に **0件** になる（読みは当たっていた）');
  console.log('   ・**だが parity の総数は減らない。むしろ増える**——');
  console.log('     いままでAIに回されていた人が名簿に残り、こんどは余る側に回るから');
  console.log('   ・代わりに **決着がAI戦でなくなる**。ここがいちばん大きい');
  console.log('');
  console.log('   段数 希望   parity/回   AI/回   型(ii)件数   決着がAI戦   1局の回数');
  for (const 段数 of [5, 6, 10]) {
    for (const 案 of ['2段', '3段']) {
      let 回 = 0, p = 0, nc = 0, 局 = 0, ai決着 = 0, 優勝 = 0, ii = 0;
      for (let n = 3; n <= 12; n++) {
        for (let s = 1; s <= 1000; s++) {
          const r = 一局(n, 段数, s * 7919 + n * 131 + 段数, { 希望案: 案 });
          回 += r.回; p += r.parity; nc += r.nocand; 局++;
          ii += r.parity型.上が全員候補ゼロ;
          if (r.終わり方 === '優勝') { 優勝++; if (r.決着の理由 === 'AIに勝ち') ai決着++; }
        }
      }
      console.log(
        `   ${String(段数).padStart(2)}段 ${案}   ${(p / 回).toFixed(3).padStart(9)}   ${(nc / 回).toFixed(3).padStart(5)}   ` +
        `${String(ii).padStart(10)}   ${(ai決着 / 優勝 * 100).toFixed(1).padStart(8)}%   ${(回 / 局).toFixed(2).padStart(9)}`
      );
    }
  }
  console.log('');
  console.log('  ※ 3段のときの「型(ii)」は0だが、**この道具の型分けは第3希望を知らない**ので、');
  console.log('    3段では「説明できない」に落ちる件が出る。型分けは2段の設計を見るためのもの。');
  console.log('    （2段では「説明できない」が0件＝型分けが取りこぼしていない、という健全さの確認）');
  console.log('  ※「1つ下」の組の勝敗をどう扱うかは指示書に無い（この道具では「1つ上」と同じ挑戦として扱った）。');
  console.log('    **規則を1つ増やす**ということ。決めるのは本人。');
  console.log('  ※ 3人が全員同じ段の回は、希望を何段にしても1人余る（上にも下にも誰もいない）。');
  console.log('    **parity を 0 にはできない。**「起きたらどうするか」は必ず要る。');
  {
    const 名簿 = [{ id: 'a', 段: 0 }, { id: 'b', 段: 0 }, { id: 'c', 段: 0 }];
    const res = V.組をつくる(名簿, { rnd: rng(3), 希望: 希望を作る('3段') });
    console.log(`    （3段で3人全員が段0の回を回すと： 組${res.組.length} / 相手なし ${res.相手なし.map((x) => x.id + '(' + x.なぜ + ')').join(' ')}）`);
  }
}

// ================= streak：同じ人が何回続けて =================
function 連続() {
  console.log('=== 同じ人が何回続けて不戦勝／AIになりうるか（連続不戦勝を避ける は効くか） ===');
  const 局数 = 1500;
  console.log('   人数  段数   最大の連続不戦勝  連続2回以上だった局  1人あたり不戦勝回数  最大の連続AI');
  for (const 段数 of [5, 10]) {
    for (let n = 3; n <= 12; n++) {
      let 最大 = 0, 連続あり = 0, 不戦勝計 = 0, 人回 = 0, 最大AI = 0;
      for (let s = 1; s <= 局数; s++) {
        const r = 一局(n, 段数, s * 7919 + n * 131 + 段数);
        let この局の最大 = 0;
        Object.keys(r.W).forEach((id) => {
          const w = r.W[id];
          不戦勝計 += w.不戦勝計; 人回++;
          if (w.最大不戦勝連続 > この局の最大) この局の最大 = w.最大不戦勝連続;
          if (w.最大AI連続 > 最大AI) 最大AI = w.最大AI連続;
        });
        if (この局の最大 > 最大) 最大 = この局の最大;
        if (この局の最大 >= 2) 連続あり++;
      }
      console.log(
        `   ${String(n).padStart(2)}人  ${String(段数).padStart(2)}段  ${String(最大).padStart(14)}  ` +
        `${String(連続あり).padStart(18)}  ${(不戦勝計 / 人回).toFixed(2).padStart(18)}  ${String(最大AI).padStart(12)}`
      );
    }
  }
  console.log('');
  console.log('  ※「連続不戦勝を避ける」は、その人を順の先頭に置くだけ（versus.js:169-174）。');
  console.log('    相手が**候補ゼロで外れている**場合は、先頭に置いても組めない。');
  console.log('');
  console.log('=== 対照：`連続不戦勝を避ける` を切ると、どれだけ悪くなるか ===');
  console.log('  **切った時と同じなら「効いていない」**（落とし穴10-c：分岐の片側しか試していない）。');
  console.log('');
  console.log('   人数  段数   入（既定）最大連続  切  最大連続   入 連続2回以上の局  切 連続2回以上の局');
  for (const 段数 of [5, 10]) {
    for (const n of [3, 6, 9, 12]) {
      const 出 = {};
      for (const 避ける of [false, true]) {
        let 最大 = 0, 連続あり = 0;
        for (let s = 1; s <= 局数; s++) {
          const r = 一局(n, 段数, s * 7919 + n * 131 + 段数, { 連続を避けない: 避ける });
          let m = 0;
          Object.keys(r.W).forEach((id) => { if (r.W[id].最大不戦勝連続 > m) m = r.W[id].最大不戦勝連続; });
          if (m > 最大) 最大 = m;
          if (m >= 2) 連続あり++;
        }
        出[避ける ? '切' : '入'] = { 最大, 連続あり };
      }
      console.log(
        `   ${String(n).padStart(2)}人  ${String(段数).padStart(2)}段  ${String(出.入.最大).padStart(16)}  ${String(出.切.最大).padStart(10)}  ` +
        `${String(出.入.連続あり).padStart(18)}  ${String(出.切.連続あり).padStart(18)}   （${局数}局）`
      );
    }
  }
}

// ================= ai：AIの出どころ =================
function AIの出どころ() {
  console.log('=== no-candidate（AI）はどれくらい出るか。AIばかりになる分布はあるか ===');
  const 局数 = 1500;
  console.log('   人数  段数   回(合計)  AIが出た回  AIの人数  1回あたりAI人数  1回の最大AI人数  全員AIの回');
  for (const 段数 of [5, 10]) {
    for (let n = 3; n <= 12; n++) {
      let 回 = 0, nr = 0, nc = 0, 最大 = 0, 全員 = 0;
      for (let s = 1; s <= 局数; s++) {
        const r = 一局(n, 段数, s * 7919 + n * 131 + 段数);
        回 += r.回; nr += r.nocandの回; nc += r.nocand; 全員 += r.全員nocandの回;
        if (r.最大nocand > 最大) 最大 = r.最大nocand;
      }
      console.log(
        `   ${String(n).padStart(2)}人  ${String(段数).padStart(2)}段  ${String(回).padStart(8)}  ` +
        `${String(nr).padStart(9)}  ${String(nc).padStart(8)}  ${(nc / 回).toFixed(3).padStart(15)}  ` +
        `${String(最大).padStart(15)}  ${String(全員).padStart(10)}`
      );
    }
  }
}

// ================= end：決着の回に何が起きているか =================
function 決着() {
  console.log('=== 決着（優勝）は、何との対戦で決まっているか ===');
  const 局数 = 2000;
  console.log('   人数  段数   優勝で終わった局  同ランクで勝ち  挑戦を受けて勝ち  **AIに勝ち**  打ち切り');
  for (const 段数 of [5, 6, 10]) {
    for (let n = 3; n <= 12; n++) {
      const c = { '同ランクで勝ち': 0, '挑戦を受けて勝ち': 0, 'AIに勝ち': 0 };
      let 優勝 = 0, 打ち切り = 0;
      for (let s = 1; s <= 局数; s++) {
        const r = 一局(n, 段数, s * 7919 + n * 131 + 段数);
        if (r.終わり方 === '優勝') { 優勝++; c[r.決着の理由]++; } else 打ち切り++;
      }
      console.log(
        `   ${String(n).padStart(2)}人  ${String(段数).padStart(2)}段  ${String(優勝).padStart(14)}  ` +
        `${String(c['同ランクで勝ち']).padStart(12)}  ${String(c['挑戦を受けて勝ち']).padStart(14)}  ` +
        `${String(c['AIに勝ち']).padStart(10)}  ${String(打ち切り).padStart(8)}`
      );
    }
    console.log('');
  }
  console.log('  ※ この道具は「最終段で勝てば終了」（2-2）で書いてある。');
  console.log('    最終段の人は同ランクの相手がふつう居ないので、**AI戦が決着になる**ことがある。');
}

// ================= goal：2-1 と 2-2 の食い違いで、結論が変わるか =================
function 到達か勝ちか() {
  console.log('=== 指示書 2-1 と 2-2 の食い違い（着手前に見つけたズレ） ===');
  console.log('  2-1「最終形に**達したら**優勝」  ／  2-2「最終形で**勝てば**1位・**負けたら**1つ下」');
  console.log('  2-1 が正なら「チャンピオンで負ける」場面は原理的に作れない（誰も最終段に留まらない）。');
  console.log('  どちらでも **決着がAI戦になるか** は変わるのか、を測る。');
  console.log('');
  const 局数 = 1500;
  console.log('   段数  人数   読み2-2：決着がAI戦   読み2-1：決着がAI戦   2-2の回数   2-1の回数');
  for (const 段数 of [5, 6, 10]) {
    for (const n of [3, 6, 9, 12]) {
      const 出 = {};
      for (const 到達 of [false, true]) {
        let 優勝 = 0, ai = 0, 回 = 0;
        for (let s = 1; s <= 局数; s++) {
          const r = 一局(n, 段数, s * 7919 + n * 131 + 段数, { 到達で優勝: 到達 });
          回 += r.回;
          if (r.終わり方 === '優勝') { 優勝++; if (r.決着の理由 === 'AIに勝ち') ai++; }
        }
        出[String(到達)] = { p: 優勝 ? (ai / 優勝 * 100).toFixed(1) + '%' : '-', 回: (回 / 局数).toFixed(2) };
      }
      console.log(
        `   ${String(段数).padStart(2)}段  ${String(n).padStart(2)}人   ${出.false.p.padStart(18)}   ${出.true.p.padStart(18)}   ` +
        `${出.false.回.padStart(9)}   ${出.true.回.padStart(9)}`
      );
    }
    console.log('');
  }
  console.log('  → **どちらの読みでも、決着はほぼAI戦。**食い違いを直しても、AIが優勝を決める問題は消えない。');
  console.log('    理由：最終段の1つ下に1人でいる人は、同ランクも1つ上も居ないので必ず no-candidate。');
}

// ================= 走らせる =================
const 表 = {
  goal: [到達か勝ちか],
  selftest: [selftest],
  hand: [手で追う],
  seat: [席の偏り],
  zero: [候補ゼロの隣],
  sweep: [掃く, parityの分布],
  many: [余りが何人],
  type: [型を分ける, 読み比べ],
  fix: [直し方を測る],
  streak: [連続],
  ai: [AIの出どころ],
  end: [決着]
};
const 全部 = [selftest, 手で追う, 席の偏り, 候補ゼロの隣, 掃く, parityの分布, 余りが何人,
  型を分ける, 読み比べ, 直し方を測る, 連続, AIの出どころ, 決着, 到達か勝ちか];

// **require しただけでは走らせない。**
// fot-preflight.js は入口に何も書いていないので、検算のために require すると全部走ってしまう。
// ここは同じ轍を踏まない（測る側が測られる側を動かすと、落とし穴28 の形になる）
if (require.main === module) {
  const 何 = process.argv[2];
  (表[何] || 全部).forEach((f, i) => { if (i) console.log(''); f(); });
  if (失敗) process.exitCode = 1;
}

module.exports = { 一局, 希望を作る, rng, selftest };
