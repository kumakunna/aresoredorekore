// tests/design-tokens.js — デザインの正本（docs/デザインの正本.md）を機械照合する
//
// **色は単体では正しさが決まらない。**「背景×文字」の対でしか読めるかどうかは決まらない。
// 第39弾の着手前に、設定パネルの背景だけがテーマに追従して文字色が固定のままだったせいで、
// 暗いテーマではコントラスト比 1.11:1（必要な最低線は4.5:1）という
// 「見えているのに読めない」状態が起きていた。
// 単体の色を見る検査では、この事故は絶対に捕まらない。
//
// そこでこのファイルは、**共通＋5カセットの6配色それぞれについて、
// 実際に画面で隣り合う「地と文字」の組を総当たりで**見る。

const fs = require('fs');
const path = require('path');
const { createRunner, assert, assertEqual } = require('./harness');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

// ---------- 色の読み取り ----------
function parseBlock(selector) {
  // その選択子のブロックから --トークン:値 を拾う。
  // **同じ選択子のブロックは複数ある**（テーマは書体だけのブロックと
  // 色トークンのブロックに分かれている）。1つ目だけ読むと、
  // 書体だけのブロックを拾って色の上書きを丸ごと見落とし、
  // 「そのテーマを見ているつもりで共通色を見ている」検査になる（実際にそうなった）
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(esc + '\\{([\\s\\S]*?)\\n  \\}', 'gm');
  const out = {};
  let m;
  let found = 0;
  while ((m = re.exec(HTML))) {
    found++;
    const tok = /--([a-z-]+)\s*:\s*([^;]+);/g;
    let t;
    while ((t = tok.exec(m[1]))) out['--' + t[1]] = t[2].trim();
  }
  return found ? out : null;
}

// rgba(...) を、その下にある地の色と合成して不透明な色にする
function toRgb(v, under) {
  v = String(v).trim();
  // 3桁の #fff も受ける（受けそこねると、その組を数えずに黙って飛ばしてしまう）
  let m = v.match(/^#([0-9a-fA-F]{3})$/);
  if (m) v = '#' + m[1].split('').map((c) => c + c).join('');
  m = v.match(/^#([0-9a-fA-F]{6})$/);
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  m = v.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const p = m[1].split(',').map((x) => parseFloat(x.trim()));
    const a = p.length > 3 ? p[3] : 1;
    if (a >= 1 || !under) return [p[0], p[1], p[2]];
    return [0, 1, 2].map((i) => Math.round(p[i] * a + under[i] * (1 - a)));
  }
  return null;
}

function lum(rgb) {
  const c = rgb.map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(fg, bg) {
  const l1 = lum(fg), l2 = lum(bg);
  const r = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  return Math.round(r * 100) / 100;
}

// ---------- 6つの配色 ----------
const ROOT = parseBlock(':root');
const THEMES = {
  共通: {},
  wolf: parseBlock('.app.theme-wolf'),
  bomb: parseBlock('.app.theme-bomb'),
  quiz: parseBlock('.app.theme-quiz'),
  auction: parseBlock('.app.theme-auction'),
  sugoroku: parseBlock('.app.theme-sugoroku')
};

function paletteOf(name) {
  return Object.assign({}, ROOT, THEMES[name] || {});
}

/**
 * 画面で実際に隣り合う「地と文字」の組。
 * **単体の色ではなく、この対で見る。**
 * min は必要な最低線：本文は 4.5、大きい文字とUIの部品は 3.0（WCAG AA）
 */
const PAIRS = [
  { bg: '--paper', fg: '--ink', min: 4.5, 何: '画面の地に、本文' },
  { bg: '--paper', fg: '--ink-soft', min: 4.5, 何: '画面の地に、補足' },
  { bg: '--card', fg: '--ink', min: 4.5, 何: 'カードの地に、本文' },
  { bg: '--card', fg: '--ink-soft', min: 4.5, 何: 'カードの地に、補足' },
  { bg: '--paper-deep', fg: '--ink', min: 4.5, 何: '一段深い地に、本文' },
  { bg: '--paper-deep', fg: '--ink-soft', min: 4.5, 何: '一段深い地に、補足' },
  // 朱は「大事な数字」に使う。本文サイズで出るので 4.5 を求める
  { bg: '--card', fg: '--stamp-deep', min: 4.5, 何: 'カードの地に、朱（濃）' },
  { bg: '--paper', fg: '--stamp', min: 3.0, 何: '画面の地に、朱（見出し・大きい字）' },
  // 主ボタンは地と文字が反転する
  { bg: '--ink', fg: '--paper', min: 4.5, 何: '主ボタン（地＝墨・文字＝紙）' },
  // 切り替えスイッチ。**見るべきは「つまみと、その下の帯」**——
  // 正本2の「色が見分けられなくても位置で分かる」は、
  // つまみの位置が読めることが前提なので、境目が要る（部品なので 3.0）。
  // つまみの白は明るい帯（クイズの金など）に溶けるので、
  // 境目を作っているのは**縁**。縁は帯の上に重ねて評価する
  { bg: '--switch-off', fg: '--switch-knob-edge', min: 3.0, 何: 'OFFの帯と、つまみの縁' },
  { bg: '--switch-on', fg: '--switch-knob-edge', min: 3.0, 何: 'ONの帯と、つまみの縁' },
  // つまみ本体と帯の差も見ておく（縁が消えた時に気づけるように、こちらは 1.5 で足りる）
  { bg: '--switch-off', fg: '--switch-knob', min: 1.5, 何: 'OFFの帯と、つまみ本体' },
  { bg: '--switch-on', fg: '--switch-knob', min: 1.5, 何: 'ONの帯と、つまみ本体' }
];

(async function main() {
  const r = createRunner('design-tokens：デザインの正本（色・書体・寸法）');

  await r.test('コントラスト比の計算が、答えの分かっている組で正しい値を返す', async () => {
    // **自作の計算式を、自分の実装だけで正しいと判断しない**（落とし穴19）。
    // 66組に当てる前に、答えが決まっている組で計算そのものを検算する。
    // これをやらないと、式が間違っていても「全部緑」か「全部赤」になるだけで、
    // どちらも「正しく測れている」ようにしか見えない。
    const hex = (h) => toRgb(h);

    // ① 定義から必ずこうなる組（式を追わなくても答えが決まる）
    assertEqual(contrast(hex('#000000'), hex('#FFFFFF')), 21,
      '黒と白は 21:1（(1.0+0.05)/(0+0.05) の定義そのもの）');
    assertEqual(contrast(hex('#FFFFFF'), hex('#FFFFFF')), 1,
      '同じ色どうしは 1:1');
    assertEqual(contrast(hex('#000000'), hex('#000000')), 1,
      '黒どうしも 1:1');

    // ② 向きを入れ替えても同じ（比なので対称）
    assertEqual(contrast(hex('#123456'), hex('#EEDDCC')),
      contrast(hex('#EEDDCC'), hex('#123456')),
      '地と文字を入れ替えても同じ値');

    // ③ **覚えている数字を書かない。**その場で導けるものだけを使う。
    //
    // 純色を目いっぱい出した時、その成分の線形値は 1.0 になる（ガンマ補正の定義）。
    // つまり輝度は**係数そのもの**になり、係数を直に検算できる。
    //   赤 #FF0000 → L = 0.2126
    //   緑 #00FF00 → L = 0.7152
    //   青 #0000FF → L = 0.0722
    // 係数を1つでも取り違えていたら、ここで必ず出る
    const 係数 = { '#FF0000': 0.2126, '#00FF00': 0.7152, '#0000FF': 0.0722 };
    Object.keys(係数).forEach((c) => {
      const L = lum(hex(c));
      assert(Math.abs(L - 係数[c]) < 0.0001,
        c + ' の輝度は係数そのもの（' + 係数[c] + '）。実際: ' + Math.round(L * 10000) / 10000);
      // 白地とのコントラストは 1.05 / (係数 + 0.05) で決まる
      const 期待 = Math.round((1.05 / (係数[c] + 0.05)) * 100) / 100;
      assertEqual(contrast(hex(c), hex('#FFFFFF')), 期待,
        c + ' と白は 1.05/(' + 係数[c] + '+0.05) = ' + 期待 + ':1');
    });

    // ④ 灰色は、逆ガンマ補正の式を手で追って確かめる。
    //   #808080 → v = 128/255 = 0.501961
    //   線形     = ((0.501961 + 0.055) / 1.055) ^ 2.4 = 0.527present…
    //   実際の計算は下の1行で書き下している（実装とは別に、ここで組み立て直している）
    const v = 128 / 255;
    const 手で求めた線形 = Math.pow((v + 0.055) / 1.055, 2.4);
    assert(Math.abs(lum(hex('#808080')) - 手で求めた線形) < 1e-12,
      '灰の輝度が、式を書き下したものと一致する');
    const 手で求めた比 = Math.round((1.05 / (手で求めた線形 + 0.05)) * 100) / 100;
    assertEqual(contrast(hex('#808080'), hex('#FFFFFF')), 手で求めた比,
      '#808080 と白のコントラストが、書き下した式と一致する（' + 手で求めた比 + ':1）');

    // ④ 暗いほど白地とのコントラストが上がる（単調性）
    const grays = ['#FFFFFF', '#CCCCCC', '#999999', '#666666', '#333333', '#000000'];
    let prev = 0;
    grays.forEach((g) => {
      const c = contrast(hex(g), hex('#FFFFFF'));
      assert(c >= prev, g + ' は、ひとつ明るい灰より白地とのコントラストが高い');
      prev = c;
    });

    // ⑤ 透けている色を下の地と混ぜる計算（--line などが rgba のため）
    // 黒を50%で白に重ねたら、ちょうど中間の灰になる
    const half = toRgb('rgba(0,0,0,0.5)', hex('#FFFFFF'));
    assertEqual(half.join(','), '128,128,128', '黒50%を白に重ねると中間の灰');
  });

  await r.test('6つの配色が、どれも同じトークンを持っている', async () => {
    // テーマが上書きし忘れたトークンは、共通の値のまま残る。
    // それ自体は正しい（継承）が、**地の色だけ上書きして文字色を上書きし忘れる**と
    // 第39弾の着手前に見つけた「読めない設定パネル」になる。
    // ここでは「6つとも palette が組み立てられる」ことだけ確かめ、
    // 読めるかどうかは次の検査で対にして見る
    assert(ROOT && Object.keys(ROOT).length > 10, ':root のトークンが読めている');
    Object.keys(THEMES).forEach((name) => {
      const p = paletteOf(name);
      ['--paper', '--card', '--ink', '--ink-soft', '--stamp', '--line'].forEach((t) => {
        assert(p[t], name + ' の ' + t + ' が決まっている');
      });
    });
  });

  await r.test('地と文字の組が、6配色すべてで読める明るさの差を持っている', async () => {
    // **これが第39弾で足した検査。**
    // 色を1つずつ見るのではなく、画面で隣り合う組を総当たりで見る。
    // 地だけテーマに追従して文字が追従しない、という形はここでしか捕まらない
    const bad = [];
    const table = [];
    Object.keys(THEMES).forEach((name) => {
      const p = paletteOf(name);
      PAIRS.forEach((pair) => {
        const bg = toRgb(p[pair.bg] || pair.bg);
        const fg = toRgb(p[pair.fg] || pair.fg, bg);
        if (!bg || !fg) { bad.push(name + '：' + pair.何 + ' の色が読めない'); return; }
        const c = contrast(fg, bg);
        table.push(name + ' ' + pair.何 + ' = ' + c);
        if (c < pair.min) {
          bad.push(name + '：' + pair.何 + ' が ' + c + ':1（最低 ' + pair.min + ':1）');
        }
      });
    });
    assert(table.length === Object.keys(THEMES).length * PAIRS.length,
      '6配色 × ' + PAIRS.length + '組 を全部見た（実際:' + table.length + '）');
    assertEqual(bad.join('\n       '), '', '読めない組み合わせ');
  });

  r.finish();
})();
