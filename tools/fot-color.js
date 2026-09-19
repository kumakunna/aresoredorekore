// tools/fot-color.js — False or True（指示53 2-10）の世界の色を、門ぜんぶに当てて採点する
//
// `tools/color-diff.js` が**現物**を測り、`tools/color-palette.js` が**案の7色まるごと**を採点する道具。
// こちらは「**1つの世界を足す**」ための道具——8色目の案を、通らなければならない門に
// 1つずつ当てて、落ちた項目を数える。
//
// 当てる門（正本 §1-2b・§1-4・49-1・36-5）：
//   ・7色との ΔE2000 ≥ 10.8（指示53 の門。tests/design-tokens.js の閾値は 10）
//   ・地×墨／カード×墨／深地×墨 ≥ 4.5（本文）
//   ・**地×薄墨 ≥ 7.0**（世界の上に載る小さい字・49-1）
//   ・カード×薄墨／深地×薄墨 ≥ 4.5
//   ・主ボタン（墨の地に、地の色の文字）≥ 4.5
//   ・ONの帯 × つまみの縁 rgba(0,0,0,0.70) ≥ 3.0（1-5）
//   ・地／カードの上で TRUE の緑・FALSE の赤 ≥ 4.5（2-11「色だけに頼らない」の文字が読めること）
//
// 使い方：
//   node tools/fot-color.js            … 3案を採点
//   node tools/fot-color.js space      … 「どの色相なら空いているか」を測る（L*=14 の一周）
//   node tools/fot-color.js '#122A1B'  … その地を、現物の7色と比べるだけ

const { hex2lab, deltaE2000, contrast, 世界の色 } = require('./color-diff');

/**
 * 現物の世界の色。**ベタ書きしない**（指示55-① の着手前に直した）。
 *
 * もとは7色を手で書いていて、**指示53で足した8色目（falsetrue #122A1B）が入っていなかった**。
 * その状態で9色目の案を採点すると、いちばん近い相手を一度も見ないまま「OK」と言う——
 * 実証：`node tools/fot-color.js '#0A4028'` は7色版では「爆弾 23.3」で通るが、
 * 8色で測ると falsetrue と **8.5** で門に落ちる（落とし穴28：測る道具が壊れていると
 * 測定そのものが嘘をつく／落とし穴4：手書きの一覧は腐る）。
 *
 * いまは `color-diff.js` の `世界の色()` が `public/index.html` の現物を掃いたものを使う。
 * 色を足した日に、この道具は何もしなくても正しくなる。
 */
function 現物を読む() {
  const 表 = {};
  世界の色().forEach((w) => { 表[w.theme === '(共通)' ? '共通' : w.theme] = w.color; });
  return 表;
}
const 現物 = 現物を読む();
const 色数 = Object.keys(現物).length;
const 門 = 10.8;

/** rgba(0,0,0,a) を hex の上に重ねた色（つまみの縁の評価用） */
function かさねる(hex, a) {
  const s = hex.replace('#', '');
  return '#' + [0, 2, 4]
    .map((i) => Math.round(parseInt(s.slice(i, i + 2), 16) * (1 - a)).toString(16).padStart(2, '0').toUpperCase())
    .join('');
}
const 比 = (a, b) => +contrast(a, b).toFixed(2);

/** 指示53（False or True）の案：同じ方向（緑を帯びた黒）の強さ違い。光の2色は共通 */
const TRUE_光 = '#54D97E';
const FALSE_光 = '#F58C80';
const FOT_光 = [['TRUEの緑', TRUE_光], ['FALSEの赤', FALSE_光]];
const 案 = [
  { 名: '案A 「消えかけの黒」（控えめ）', 地: '#15231B', 深: '#0E1913', カード: '#1F2E24', 墨: '#E9F2EA', 薄墨: '#AEC3B4', on: '#33A85E', 光: FOT_光, 除く: 'falsetrue' },
  { 名: '案B 「非常灯の黒」（採用）', 地: '#122A1B', 深: '#0B1C12', カード: '#1C3826', 墨: '#EAF4EC', 薄墨: '#AFC9B7', on: '#33A85E', 光: FOT_光, 除く: 'falsetrue' },
  { 名: '案C 「深緑の黒」（はっきり）', 地: '#0E2E1C', 深: '#081E12', カード: '#173C26', 墨: '#EBF5ED', 薄墨: '#B0CBB8', on: '#33A85E', 光: FOT_光, 除く: 'falsetrue' }
];

/**
 * 指示55-①（ロシアンカード）の案。**方向違いの4つ**——緑の台／紫のビロード／煤けた黒／血の赤黒。
 * 光の2色は「めくった瞬間に出るもの」＝爆弾の赤と、無事の色。
 * `node tools/fot-color.js rcard` で採点する。
 */
const RC_案 = [
  { 名: '案A 「ラシャの緑」（賭場のカード台）', 地: '#0E4F33', 深: '#082F1F', カード: '#125335', 墨: '#F1FAF4', 薄墨: '#D4E9DC', on: '#B8863B',
    光: [['爆弾の赤', '#FF9F92'], ['無事の象牙', '#F2EBD8']] },
  { 名: '案B 「ビロードの紫」（賭けの卓布）', 地: '#602C5B', 深: '#3C1A39', カード: '#6A3465', 墨: '#FBF1FA', 薄墨: '#EDD5E9', on: '#C46A8C',
    光: [['爆弾の赤', '#FFA49C'], ['無事の金', '#F0D08A']] },
  { 名: '案C 「煤けた黒に金」（賭場の隅）', 地: '#332617', 深: '#1E160D', カード: '#463622', 墨: '#F7F1E4', 薄墨: '#D6C9AC', on: '#B8863B',
    光: [['爆弾の赤', '#F2857A'], ['無事の金', '#E9C96B']] },
  { 名: '案D 「血の赤黒」（カードの赤）', 地: '#5A0F00', 深: '#360900', カード: '#661A08', 墨: '#FFF1EC', 薄墨: '#F0C9BC', on: '#E79CA8',
    光: [['爆弾の赤', '#FFB0A4'], ['無事の金', '#F2D98C']] }
];

/**
 * 候補と現物の色差。
 *
 * `除く` は「その案が**採用されて現物になった**世界」を比較から外すためのもの。
 * 指示53の3案は、まだ falsetrue が無かった頃に採点したもので、
 * いま素直に測ると**案B が自分自身と ΔE 0** になり「0/3 通った」と出る——
 * 当時の採点を再現できないと、記録として読めない（落とし穴33の予防）。
 * 新しい色を採点する時は `除く` を書かない（＝全部と比べる）。
 */
function 色差(地, 除く) {
  return Object.entries(現物)
    .filter(([k]) => k !== 除く)
    .map(([k, v]) => [k, +deltaE2000(hex2lab(地), hex2lab(v)).toFixed(1)])
    .sort((a, b) => a[1] - b[1]);
}

function 採点(p) {
  const d = 色差(p.地, p.除く);
  const lab = hex2lab(p.地);
  console.log('');
  console.log('======== ' + p.名 + ' ========');
  console.log(`  地 ${p.地}   L*=${lab[0].toFixed(1)}  a*=${lab[1].toFixed(1)}  b*=${lab[2].toFixed(1)}`);
  const 断り = p.除く ? '／' + p.除く + ' は自分自身なので外した' : '';
  console.log(`  ΔE2000（現物の${色数 - (p.除く ? 1 : 0)}色${断り}）: ` + d.map((x) => x[0] + ' ' + x[1]).join(' / '));
  const 最小 = d[0][1];
  console.log(`  → 最小 ${最小}（対 ${d[0][0]}）  ${最小 >= 門 ? 'OK ≥' + 門 : 'NG < ' + 門}`);

  const 行 = [
    ['地×墨', 比(p.地, p.墨), 4.5],
    ['地×薄墨【世界 7:1】', 比(p.地, p.薄墨), 7.0],
    ['カード×墨', 比(p.カード, p.墨), 4.5],
    ['カード×薄墨', 比(p.カード, p.薄墨), 4.5],
    ['深地×墨', 比(p.深, p.墨), 4.5],
    ['深地×薄墨', 比(p.深, p.薄墨), 4.5],
    ['主ボタン(墨地×地文字)', 比(p.墨, p.地), 4.5],
    ['ONの帯×つまみの縁', 比(p.on, かさねる(p.on, 0.70)), 3.0],
    // 第39弾 1-5：白いつまみが帯に溶けないこと（tests/design-tokens.js:163-167 の追加分）
    ['ONの帯×白つまみ', 比(p.on, '#FFFFFF'), 1.5]
  ];
  // その世界に載せる光（ゲームごとに違う）。地とカードの両方で読めること
  (p.光 || []).forEach(([名, hex]) => {
    行.push(['地×' + 名, 比(p.地, hex), 4.5]);
    行.push(['カード×' + 名, 比(p.カード, hex), 4.5]);
  });
  let 落ちた = 最小 >= 門 ? 0 : 1;
  for (const [名, v, m] of 行) {
    if (v < m) 落ちた++;
    console.log(`   ${v >= m ? 'OK' : 'NG'}  ${名.padEnd(22)} ${String(v).padStart(6)}   (最低 ${m})`);
  }
  console.log(`  → 落ちた項目: ${落ちた}`);
  return 落ちた;
}

/** Lab → sRGB（域外かどうかも返す）。空きを探すのに使う */
function lab2hex(L, a, bb) {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - bb / 200;
  const f = (t) => (t > 6 / 29 ? t * t * t : 3 * Math.pow(6 / 29, 2) * (t - 4 / 29));
  const W = [0.95047, 1, 1.08883];
  const X = W[0] * f(fx), Y = W[1] * f(fy), Z = W[2] * f(fz);
  const r = X * 3.2404542 + Y * -1.5371385 + Z * -0.4985314;
  const g = X * -0.9692660 + Y * 1.8760108 + Z * 0.0415560;
  const b2 = X * 0.0556434 + Y * -0.2040259 + Z * 1.0572252;
  const 域外 = [r, g, b2].some((c) => c < -0.002 || c > 1.002);
  const gam = (c) => Math.round(Math.min(1, Math.max(0, c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055)) * 255);
  return ['#' + [gam(r), gam(g), gam(b2)].map((x) => x.toString(16).padStart(2, '0').toUpperCase()).join(''), 域外];
}

function 空きを測る() {
  console.log(`=== L*=14 の色相を一周して、「${色数}色すべてと ΔE2000 ≥ ${門} を満たす最小の彩度」 ===`);
  console.log('（＝その方向へ行くのに、どれだけ色味を混ぜる必要があるか。小さいほど「黒のまま」でいられる）');
  console.log('');
  console.log('  色相    名      最小C*   16進       minΔE  効いている制約');
  for (let h = 0; h < 360; h += 15) {
    let 見つけた = null, 域外 = false;
    for (let c = 0; c <= 60; c++) {
      const a = c * Math.cos(h * Math.PI / 180), b = c * Math.sin(h * Math.PI / 180);
      const [hex, out] = lab2hex(14, a, b);
      if (out) { 域外 = true; break; }
      const d = 色差(hex)[0];
      if (d[1] >= 門) { 見つけた = { c, hex, de: d[1], who: d[0] }; break; }
    }
    const 名 = h < 25 ? '赤' : h < 70 ? '橙' : h < 100 ? '黄' : h < 160 ? '緑' : h < 200 ? '青緑' : h < 260 ? '青' : h < 310 ? '紫' : '赤紫';
    if (見つけた) {
      console.log(`  ${String(h).padStart(3)}°   ${名.padEnd(3)}   ${String(見つけた.c).padStart(5)}   ${見つけた.hex}   ${見つけた.de}   ${見つけた.who}`);
    } else {
      console.log(`  ${String(h).padStart(3)}°   ${名.padEnd(3)}      —     ${域外 ? '(sRGBの外)' : '(届かない)'}`);
    }
  }
  console.log('');
  console.log('  ついでに：無彩色（#NNNNNN）はどこから通るか');
  for (let v = 0x30; v <= 0x44; v += 4) {
    const hex = '#' + [v, v, v].map((x) => x.toString(16).padStart(2, '0').toUpperCase()).join('');
    const d = 色差(hex)[0];
    console.log(`    ${hex}  L*=${hex2lab(hex)[0].toFixed(1)}  minΔE=${d[1]} (対 ${d[0]})  ${d[1] >= 門 ? 'OK' : 'NG'}`);
  }
  console.log('  → 純黒は L* 25 あたりまで明るくしないと通らない＝「黒」では居られない。');
}

/** ONの色どうしの近さ。**ここに門は無い**（tests/design-tokens.js が見ているのは地だけ）ので、道具で見る */
const 現物のON = {
  共通: '#C08A3C', あれそれ: '#B26A1E', 人狼: '#7C8AE0', 爆弾: '#3FBFA5',
  クイズ: '#F0B429', オク: '#D4A537', すごろく: '#C0392B', falsetrue: '#33A85E'
};
function ONの近さ(on) {
  return Object.entries(現物のON)
    .map(([k, v]) => [k, +deltaE2000(hex2lab(on), hex2lab(v)).toFixed(1)])
    .sort((a, b) => a[1] - b[1])[0];
}

const 引数 = process.argv[2];
if (引数 === 'rcard') {
  let 全部通った = 0;
  RC_案.forEach((p) => {
    if (採点(p) === 0) 全部通った++;
    const [誰, de] = ONの近さ(p.on);
    console.log(`  ONの色 ${p.on} … いちばん近い既存のON は ${誰} で ΔE2000 = ${de}` +
      (de < 8 ? '  ← 近すぎる（設定のトグルが見分けにくくなる）' : ''));
  });
  console.log('');
  console.log(`=== ${全部通った} / ${RC_案.length} 案が、門を全項目通った ===`);
  // **「余裕」を語る相手を明示する**：門は 10.8 だが、いま暗い世界どうしで
  // いちばん近い組がいくつかを出しておかないと、「通った」だけでは比べられない
  const 暗い = 世界の色().filter((w) => hex2lab(w.color)[0] < 35);
  let 最小 = { de: 999 };
  for (let i = 0; i < 暗い.length; i++) {
    for (let j = i + 1; j < 暗い.length; j++) {
      const de = +deltaE2000(hex2lab(暗い[i].color), hex2lab(暗い[j].color)).toFixed(1);
      if (de < 最小.de) 最小 = { de, a: 暗い[i].theme, b: 暗い[j].theme };
    }
  }
  console.log(`  いま暗い世界どうしで、いちばん近い組は ${最小.a} × ${最小.b} = ${最小.de}`);
  console.log('  → これを下回る案は、門(10.8)を通っていても「史上いちばん近い組」を新しく作る');
} else if (引数 === 'space') {
  空きを測る();
} else if (引数 &&引数[0] === '#') {
  const d = 色差(引数);
  console.log(引数 + ` と現物の${色数}色：`);
  d.forEach(([k, v]) => console.log(`  ${k.padEnd(6)} ΔE2000 = ${v}  ${v >= 門 ? '' : '← 門(' + 門 + ')に届かない'}`));
} else {
  let 全部通った = 0;
  案.forEach((p) => { if (採点(p) === 0) 全部通った++; });
  console.log('');
  console.log(`=== ${全部通った} / ${案.length} 案が、門を全項目通った ===`);
  console.log(`  TRUE の緑 ${TRUE_光} と 爆弾のON #3FBFA5 の ΔE2000 = ${deltaE2000(hex2lab(TRUE_光), hex2lab('#3FBFA5')).toFixed(1)}`);
}

module.exports = { 案, 色差, 現物, TRUE_光, FALSE_光 };
