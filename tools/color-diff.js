// tools/color-diff.js — 世界の色（--warp-color）の総当たり色差（指示49 49-3・49-4）
//
// **「色が被る」を、印象ではなく数字で決めるための道具。**
// 表は public/index.html の `.cassette-warp, .shelf-stage` の行から読む
// （正本や頭の中の値ではなく、**実際に画面へ出ている値**。落とし穴10-a を避ける）。
//
// 出すもの：
//   ・7色の一覧（16進・Lab・明度L*・地×墨のコントラスト）
//   ・総当たり21組の ΔE2000 と、明度差 ΔL*
//   ・棚の共通色（--paper）との一致（49-4 の「棚と被る」の正体）
//
// 使い方：
//   node tools/color-diff.js            … 現物の表
//   node tools/color-diff.js '#RRGGBB'  … その色を「候補」として現物の全色と比べる（複数可）

const fs = require('fs');
const path = require('path');

// ---- 色空間 ----
function hex2rgb(h) {
  const s = h.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
}
function lin(c) {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}
function rgb2xyz(rgb) {
  const [r, g, b] = rgb.map(lin);
  return [
    r * 0.4124564 + g * 0.3575761 + b * 0.1804375,
    r * 0.2126729 + g * 0.7151522 + b * 0.0721750,
    r * 0.0193339 + g * 0.1191920 + b * 0.9503041
  ];
}
function xyz2lab(xyz) {
  // D65 白色点
  const W = [0.95047, 1.00000, 1.08883];
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
  const [fx, fy, fz] = xyz.map((v, i) => f(v / W[i]));
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
function hex2lab(h) { return xyz2lab(rgb2xyz(hex2rgb(h))); }

/** CIEDE2000（Sharma らの定式どおり） */
function deltaE2000(lab1, lab2) {
  const [L1, a1, b1] = lab1, [L2, a2, b2] = lab2;
  const rad = Math.PI / 180, deg = 180 / Math.PI;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Math.pow(Cbar, 7) / (Math.pow(Cbar, 7) + Math.pow(25, 7))));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const hue = (ap, bp) => {
    if (ap === 0 && bp === 0) return 0;
    const t = Math.atan2(bp, ap) * deg;
    return t >= 0 ? t : t + 360;
  };
  const h1p = hue(a1p, b1), h2p = hue(a2p, b2);
  const dLp = L2 - L1, dCp = C2p - C1p;
  let dhp;
  if (C1p * C2p === 0) dhp = 0;
  else if (Math.abs(h2p - h1p) <= 180) dhp = h2p - h1p;
  else if (h2p - h1p > 180) dhp = h2p - h1p - 360;
  else dhp = h2p - h1p + 360;
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad);
  const Lbp = (L1 + L2) / 2, Cbp = (C1p + C2p) / 2;
  let hbp;
  if (C1p * C2p === 0) hbp = h1p + h2p;
  else if (Math.abs(h1p - h2p) <= 180) hbp = (h1p + h2p) / 2;
  else if (h1p + h2p < 360) hbp = (h1p + h2p + 360) / 2;
  else hbp = (h1p + h2p - 360) / 2;
  const T = 1 - 0.17 * Math.cos((hbp - 30) * rad) + 0.24 * Math.cos(2 * hbp * rad)
    + 0.32 * Math.cos((3 * hbp + 6) * rad) - 0.20 * Math.cos((4 * hbp - 63) * rad);
  const dTh = 30 * Math.exp(-Math.pow((hbp - 275) / 25, 2));
  const Rc = 2 * Math.sqrt(Math.pow(Cbp, 7) / (Math.pow(Cbp, 7) + Math.pow(25, 7)));
  const Sl = 1 + (0.015 * Math.pow(Lbp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbp - 50, 2));
  const Sc = 1 + 0.045 * Cbp;
  const Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(2 * dTh * rad) * Rc;
  return Math.sqrt(
    Math.pow(dLp / Sl, 2) + Math.pow(dCp / Sc, 2) + Math.pow(dHp / Sh, 2) +
    Rt * (dCp / Sc) * (dHp / Sh)
  );
}

/** 相対輝度とコントラスト比（正本 1-4 と同じ式） */
function lum(rgb) {
  const [r, g, b] = rgb.map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(fg, bg) {
  const a = lum(hex2rgb(fg)), b = lum(hex2rgb(bg));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * 世界の色の表を、実装から読む。
 * `.cassette-warp[data-theme="x"], .shelf-stage[...]{--warp-color:#…;…}` の形を掃く。
 * 既定行（data-theme なし）は「共通」として拾う。
 */
function 世界の色() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const out = [];
  const re = /\.cassette-warp(\[data-theme="([a-z]+)"\])?,\s*\.shelf-stage[^{]*\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(html))) {
    const body = m[3];
    const g = (name) => (body.match(new RegExp('--' + name + ':\\s*(#[0-9A-Fa-f]{6})')) || [])[1];
    const color = g('warp-color');
    if (!color) continue;
    out.push({ theme: m[2] || '(共通)', color, ink: g('warp-ink'), soft: g('warp-soft') });
  }
  return out;
}

/** カセット表から「テーマ指定の無い完成カセット」を拾う（＝共通色のまま出ている） */
function テーマ無しのカセット() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const 本体 = html.slice(html.indexOf('var CASSETTES = ['), html.indexOf('function cassetteById'));
  const out = [];
  本体.split(/\{\s*id:/).slice(1).forEach((blk) => {
    const id = (blk.match(/^\s*'([a-z0-9-]+)'/) || [])[1];
    if (!id) return;
    if (!/ready:\s*true/.test(blk)) return;
    if (!/theme:\s*'/.test(blk)) out.push(id);
  });
  return out;
}

function pad(s, n) {
  let w = 0;
  for (const ch of String(s)) w += /[^\x00-\xff]/.test(ch) ? 2 : 1;
  return String(s) + ' '.repeat(Math.max(0, n - w));
}

function main() {
  const 候補 = process.argv.slice(2).filter((a) => /^#[0-9A-Fa-f]{6}$/.test(a));
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const 表 = 世界の色();
  const paper = (html.match(/--paper:\s*(#[0-9A-Fa-f]{6})/) || [])[1];

  const 名 = { '(共通)': '共通', wolf: '人狼', bomb: '爆弾', quiz: 'クイズ',
    auction: 'オク', sugoroku: 'すごろく' };

  console.log('=== 世界の色（public/index.html の現物） ===');
  console.log(pad('テーマ', 12) + pad('地', 10) + pad('L*', 8) + pad('a*', 8) + pad('b*', 8) +
    pad('墨', 10) + '地×墨');
  const 色 = [];
  表.forEach((t) => {
    const lab = hex2lab(t.color);
    色.push({ 名: 名[t.theme] || t.theme, hex: t.color, lab });
    console.log(pad(名[t.theme] || t.theme, 12) + pad(t.color, 10) +
      pad(lab[0].toFixed(1), 8) + pad(lab[1].toFixed(1), 8) + pad(lab[2].toFixed(1), 8) +
      pad(t.ink, 10) + contrast(t.ink, t.color).toFixed(2) + ' : 1');
  });

  console.log('');
  console.log('--paper（棚・共通画面の地） = ' + paper);
  const 無し = テーマ無しのカセット();
  console.log('テーマ指定の無い「完成」カセット：' + (無し.join('・') || 'なし') +
    '  → 共通色 ' + 表[0].color + ' で出る');
  console.log('共通の世界の色 === --paper ? ' +
    (表[0].color.toUpperCase() === String(paper).toUpperCase() ? '**同一**' : '別'));

  // 候補を「仮のテーマ」として足す
  候補.forEach((h, i) => 色.push({ 名: '候補' + (i + 1), hex: h, lab: hex2lab(h) }));

  console.log('');
  console.log('=== 総当たり ΔE2000（下段は 明度差 ΔL*） ===');
  console.log(pad('', 12) + 色.map((c) => pad(c.名, 11)).join(''));
  色.forEach((a, i) => {
    let l1 = pad(a.名, 12), l2 = pad('', 12);
    色.forEach((b, j) => {
      if (i === j) { l1 += pad('—', 11); l2 += pad('', 11); return; }
      l1 += pad(deltaE2000(a.lab, b.lab).toFixed(1), 11);
      l2 += pad('(' + (b.lab[0] - a.lab[0]).toFixed(1) + ')', 11);
    });
    console.log(l1); console.log(l2);
  });

  console.log('');
  console.log('=== 近い順（ΔE2000 の小さい組から） ===');
  const 組 = [];
  for (let i = 0; i < 色.length; i++) {
    for (let j = i + 1; j < 色.length; j++) {
      組.push({ a: 色[i], b: 色[j], de: deltaE2000(色[i].lab, 色[j].lab),
        dl: Math.abs(色[i].lab[0] - 色[j].lab[0]) });
    }
  }
  組.sort((x, y) => x.de - y.de);
  console.log(pad('組', 26) + pad('ΔE2000', 10) + pad('|ΔL*|', 9) + '見え方の目安');
  組.forEach((p) => {
    const 目安 = p.de < 1 ? '**区別できない**' : p.de < 2.3 ? '**ほぼ同じ**（並べて気づかない）'
      : p.de < 5 ? '近い（見比べれば分かる）' : p.de < 10 ? '違う色に見える' : '明らかに別';
    console.log(pad(p.a.名 + ' × ' + p.b.名, 26) + pad(p.de.toFixed(1), 10) +
      pad(p.dl.toFixed(1), 9) + 目安);
  });
  console.log('');
  console.log('組の数：' + 組.length);
}

module.exports = { hex2lab, deltaE2000, contrast, 世界の色, テーマ無しのカセット };
if (require.main === module) main();
