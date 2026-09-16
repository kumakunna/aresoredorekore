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

const { hex2lab, deltaE2000, contrast } = require('./color-diff');

/** 現物の7色（public/index.html の `.cassette-warp, .shelf-stage` の行と同じ値） */
const 現物 = {
  共通: '#EFE8D3', あれそれ: '#FBD9BC', 人狼: '#261A55', 爆弾: '#17181B',
  クイズ: '#04365F', オク: '#3B1220', すごろく: '#D9ECCC'
};
const 門 = 10.8;

/** rgba(0,0,0,a) を hex の上に重ねた色（つまみの縁の評価用） */
function かさねる(hex, a) {
  const s = hex.replace('#', '');
  return '#' + [0, 2, 4]
    .map((i) => Math.round(parseInt(s.slice(i, i + 2), 16) * (1 - a)).toString(16).padStart(2, '0').toUpperCase())
    .join('');
}
const 比 = (a, b) => +contrast(a, b).toFixed(2);

/** 案：同じ方向（緑を帯びた黒）の強さ違い。光の2色は共通 */
const TRUE_光 = '#54D97E';
const FALSE_光 = '#F58C80';
const 案 = [
  { 名: '案A 「消えかけの黒」（控えめ）', 地: '#15231B', 深: '#0E1913', カード: '#1F2E24', 墨: '#E9F2EA', 薄墨: '#AEC3B4', on: '#33A85E' },
  { 名: '案B 「非常灯の黒」（おすすめ）', 地: '#122A1B', 深: '#0B1C12', カード: '#1C3826', 墨: '#EAF4EC', 薄墨: '#AFC9B7', on: '#33A85E' },
  { 名: '案C 「深緑の黒」（はっきり）', 地: '#0E2E1C', 深: '#081E12', カード: '#173C26', 墨: '#EBF5ED', 薄墨: '#B0CBB8', on: '#33A85E' }
];

function 色差(地) {
  return Object.entries(現物)
    .map(([k, v]) => [k, +deltaE2000(hex2lab(地), hex2lab(v)).toFixed(1)])
    .sort((a, b) => a[1] - b[1]);
}

function 採点(p) {
  const d = 色差(p.地);
  const lab = hex2lab(p.地);
  console.log('');
  console.log('======== ' + p.名 + ' ========');
  console.log(`  地 ${p.地}   L*=${lab[0].toFixed(1)}  a*=${lab[1].toFixed(1)}  b*=${lab[2].toFixed(1)}`);
  console.log('  ΔE2000（現物の7色）: ' + d.map((x) => x[0] + ' ' + x[1]).join(' / '));
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
    ['地×TRUEの緑', 比(p.地, TRUE_光), 4.5],
    ['カード×TRUEの緑', 比(p.カード, TRUE_光), 4.5],
    ['地×FALSEの赤', 比(p.地, FALSE_光), 4.5],
    ['カード×FALSEの赤', 比(p.カード, FALSE_光), 4.5]
  ];
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
  console.log('=== L*=14 の色相を一周して、「7色すべてと ΔE2000 ≥ ' + 門 + ' を満たす最小の彩度」 ===');
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

const 引数 = process.argv[2];
if (引数 === 'space') {
  空きを測る();
} else if (引数 &&引数[0] === '#') {
  const d = 色差(引数);
  console.log(引数 + ' と現物の7色：');
  d.forEach(([k, v]) => console.log(`  ${k.padEnd(6)} ΔE2000 = ${v}  ${v >= 門 ? '' : '← 門(' + 門 + ')に届かない'}`));
} else {
  let 全部通った = 0;
  案.forEach((p) => { if (採点(p) === 0) 全部通った++; });
  console.log('');
  console.log(`=== ${全部通った} / ${案.length} 案が、門を全項目通った ===`);
  console.log(`  TRUE の緑 ${TRUE_光} と 爆弾のON #3FBFA5 の ΔE2000 = ${deltaE2000(hex2lab(TRUE_光), hex2lab('#3FBFA5')).toFixed(1)}`);
}

module.exports = { 案, 色差, 現物, TRUE_光, FALSE_光 };
