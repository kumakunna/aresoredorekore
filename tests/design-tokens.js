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
const { createRunner, assert, assertEqual, cssRules } = require('./harness');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
// **CSSだけを切り出す。**HTML全体を規則として読むと、JSの `{}` が
// 「選択子」に化けて混ざる（落とし穴10-e の親戚）。
// 混ざったまま querySelectorAll に渡すと投げるので、
// 握り潰す実装なら静かに素通りし、握り潰さない実装なら中身の分からない赤になる
const CSS_ONLY = (function () {
  const m = /<style>([\s\S]*?)<\/style>/.exec(HTML);
  if (!m) throw new Error('index.html の <style> が見つからない');
  // **コメントは先に落とす。**`cssRules` は `{` `}` で切るので、
  // 中括弧を含むコメントはコメントの途中で切られ、
  // 「`*/` で始まる選択子」という直しようのない破片になる。
  // 破片を選択子として扱うと querySelectorAll が投げ、
  // 握り潰す実装なら静かに素通りする（落とし穴10-e）
  return m[1].replace(/\/\*[\s\S]*?\*\//g, '');
})();

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

/**
 * 棚の染まる場（`.shelf-stage`）の色。`.app.theme-◯◯` とは**別の表**。
 * 2つの検査（対の総当たりと、44-2 の「誰がその色を使っているか」）が
 * 同じものを見るので、**表は1つだけ持つ**（落とし穴1）。
 */
const 世界 = (function () {
  const out = {};
  cssRules(HTML).forEach((r) => {
    if (r.sel.indexOf('.shelf-stage') === -1) return;
    const m = /\[data-theme="([a-z]+)"\]/.exec(r.sel);
    const 名 = m ? m[1] : '共通';
    const 取る = (v) => {
      const g = new RegExp('--warp-' + v + '\s*:\s*(#[0-9A-Fa-f]{3,8})').exec(r.body);
      return g ? g[1] : null;
    };
    const 地 = 取る('color'), 字 = 取る('ink'), 補 = 取る('soft');
    if (地 && 字) out[名] = { 地, 字, 補 };
  });
  return out;
})();
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

  await r.test('棚の染まる場も、6つの世界すべてで読める（第41弾 2-2・第43弾）', async () => {
    // **この対は、上の検査の外にいた。**
    // 上は `.app.theme-◯◯` のブロックしか読まないが、
    // 棚の場は `--warp-color`（世界の地）と `--warp-ink`（その上の文字）という
    // **別の表**を使う。scr-shelf は THEME_FREE_SCREENS なので `.app` は染めない
    //（染めると設定も下部バーも全部その色になる）。
    // 表を分けた以上、コントラストの検査も届かせないと、
    // 「暗い帯に暗い字」を誰も見ていない状態になる。
    //
    // 表そのものは**幕（.cassette-warp）と共有している1つだけ**なので、
    // ここで通れば、タップした時に広がる幕の色も同時に確かめたことになる。
    // 表は module の頭で1つだけ作っている（この検査と、下の 44-2 の検査が
    // 同じものを見る。2つ持つと、色を変えた日に片方だけ古くなる・落とし穴1）。

    // **数を先に主張する。**0件なら「全部読める」は自明に成立する（型b）
    const 名前 = Object.keys(世界);
    assertEqual(名前.length, Object.keys(THEMES).length,
      '世界の数が、配色の数と合っている（実際:' + 名前.join('・') + '）');

    const bad = [], 表 = [];
    名前.forEach((名) => {
      const w = 世界[名];
      [['本文', w.字, 4.5], ['補足', w.補, 4.5]].forEach(([何, 色, 最低]) => {
        if (!色) { bad.push(名 + '：' + 何 + 'の色が無い'); return; }
        const 比 = contrast(toRgb(色), toRgb(w.地));
        表.push(名 + '/' + 何 + '=' + 比);
        if (比 < 最低) bad.push(名 + '：場の地に' + 何 + '（' + 比 + ' < ' + 最低 + '）');
      });
    });
    assertEqual(表.length, 名前.length * 2, '全部の世界で、本文と補足の両方を見た');
    assertEqual(bad.join('\n       '), '', '帯の上で読めない組み合わせ');
  });

  await r.test('世界を借りる領域に載るものは、6つの世界すべてで読める（正本1-6・指示44 44-2）', async () => {
    // **上の検査は「トークンの対」を見る。ここは「その対を、誰が実際に使っているか」を見る。**
    //
    // 指示44の着手前、`.cart-meta`（選んだカセットの「3〜8人 / 13分〜」）は
    // `--ink-soft` を直に使っていた。トークンの対の表は全部緑のまま——
    // **表に載っていない色を使っている要素は、誰も見ていなかった**（落とし穴20：
    // A⊆B は書いてあったが B⊆A が無い）。人狼の地で 2.49:1、いちばん知りたい行が読めない。
    // 位置の点も、`currentColor` と書いてあったのに `<button>` は `color` を
    // 継承しないので**ブラウザ既定の黒**で、1.21:1 だった（落とし穴30）。
    //
    // ここでは、場の上に載る要素それぞれについて
    // **6つの世界ぶんの地と突き合わせて比を出す**。
    // 地は「自分か、場との間の先祖が塗っているもの」——半透明なら世界の色に重ねて解く。
    const { launch, activeScreen } = require('./harness');
    const { win, doc } = await launch();
    assertEqual(activeScreen(doc), 'scr-shelf', '棚に着いている');

    const stage = doc.getElementById('shelfStage');
    assert(stage, '染まる場がある');

    // **規則の側から回す。**要素ごとに3800本の規則を当てると jsdom では終わらない
    //（実測：2分で戻ってこなかった）。規則1本につき querySelectorAll 1回なら軽い。
    // 後ろの規則が勝つので、順に上書きすれば「最後に効く宣言」が残る
    const 色 = new Map(), 地 = new Map(), 透 = new Map();
    function 拾う(body, prop) {
      // 空白は文字集合で書く。\s と書くと、この行を機械で書き換えた日に
      // エスケープが1段落ちて「s が0個以上」になり、**改行をまたいだ宣言を
      // 静かに見落とす**（実際に踏んだ：background だけ拾えず、地が無いことにされた）
      const 空 = "[ \t\r\n]*";
      const m = new RegExp("(?:^|;)" + 空 + prop + 空 + ":" + 空 + "([^;]+)").exec(body);
      return m ? m[1].trim() : null;
    }
    let 当たった = 0, 読めない = [];
    cssRules(CSS_ONLY).forEach((r2) => {
      r2.sel.split(',').forEach((s) => {
        // **選択子には直前のコメントが入っている**（cssRules の作り）。
        // 外さずに querySelectorAll へ渡すと投げる——そこを catch で握り潰すと、
        // 地を決めている規則を丸ごと見落として「地が無い」と読む（落とし穴10-e）。
        s = s.trim();
        if (!s) return;
        if (/:/.test(s)) return;             // 擬似クラスは jsdom で当たらない（意図して外す）
        // @keyframes の区切り（0% / from / to）は選択子ではない。
        // **「読めなかった」に混ぜない**——混ぜると本物の読み落としが埋もれる
        if (/^(from|to|[\d.]+%)$/.test(s)) return;
        let 対象;
        try { 対象 = stage.querySelectorAll(s); }
        catch (e) { 読めない.push(s); return; }   // 握り潰さず、数えて赤くする
        if (!対象.length) return;
        当たった++;
        const c = 拾う(r2.body, 'color');
        const b = 拾う(r2.body, 'background') || 拾う(r2.body, 'background-color');
        const o = 拾う(r2.body, 'opacity');
        対象.forEach((el) => {
          if (c) 色.set(el, c);
          if (b) 地.set(el, b);
          if (o) 透.set(el, parseFloat(o));
        });
      });
    });
    assertEqual(読めない.join('・'), '', '読めなかった選択子（読めないまま先へ進まない）');
    assert(当たった > 20, '場の中の要素に当たる規則を実際に読めている（実際:' + 当たった + '本）');

    // var(--x) と #hex と rgba() を、その世界の値に解く
    function 解く(v, 世, 下) {
      if (!v) return null;
      v = v.trim();
      const m = /^var\(\s*(--[a-z-]+)\s*\)$/.exec(v);
      if (m) {
        const 名 = m[1];
        if (名 === '--warp-color') return toRgb(世.地);
        if (名 === '--warp-ink') return toRgb(世.字);
        if (名 === '--warp-soft') return toRgb(世.補);
        return ROOT[名] ? toRgb(ROOT[名], 下) : null;   // 共通トークン（棚は .app を染めない）
      }
      return toRgb(v, 下);
    }
    // その要素の地を、世界の色まで遡って解く（半透明は下に重ねる）。
    // **自分の地を含めるかは、前景が何かで変わる。**
    //   文字 … 自分の地の上に載るので含める
    //   印（点）… 自分の地そのものが前景なので、含めると必ず 1:1 になる
    function 地の色(el, 世, 自分も) {
      const 積 = [];
      let n = 自分も ? el : el.parentElement;
      while (n && n !== stage) { if (地.has(n)) 積.push(地.get(n)); n = n.parentElement; }
      let 下 = toRgb(世.地);
      for (let i = 積.length - 1; i >= 0; i--) {
        const c = 解く(積[i], 世, 下);
        if (c) 下 = c;                       // toRgb が rgba を 下 と合成して返す
      }
      return 下;
    }

    // **見えていないものは測らない。**
    // `.cart-meta` は中央以外 `opacity:0`（畳んである）。それを混ぜると
    // 前景と地が完全に一致して 1:1 になり、**直しようのない赤**が6テーマぶん出る
    function 見えている(el) {
      let n = el;
      while (n && n !== stage) {
        if (透.has(n) && 透.get(n) === 0) return false;
        n = n.parentElement;
      }
      return true;
    }

    const 悪い = [], 表 = [];
    const 対象 = [];
    stage.querySelectorAll('*').forEach((el) => {
      if (!色.has(el) && !el.classList.contains('rail-dot')) return;
      if (!見えている(el)) return;
      対象.push(el);
    });
    // **0件なら自明に成立する**ので、先に数を主張する（落とし穴10-b）
    assert(対象.length >= 5, '場の上の要素を実際に拾えている（実際:' + 対象.length + '件）');

    Object.keys(世界).forEach((名) => {
      const 世 = 世界[名];
      対象.forEach((el) => {
        const 点 = el.classList.contains('rail-dot');
        // 点は「塗り」か「輪郭」が信号。塗っていない○は border の色を見る
        const 前景 = 点
          ? (el.classList.contains('on') ? 地.get(el) : 'var(--warp-soft)')
          : 色.get(el);
        if (!前景) return;
        // 継承・currentColor は場から降りてくる（＝--warp-ink）
        const v = /inherit|currentColor/i.test(前景) ? 'var(--warp-ink)' : 前景;
        const fg = 解く(v, 世, toRgb(世.地));
        if (!fg) return;
        const bg = 地の色(el, 世, !点);
        // 自分の opacity で薄まっているなら、そのぶん地に沈む
        const a = 透.has(el) ? 透.get(el) : 1;
        const 実 = a >= 1 ? fg : fg.map((x, i) => Math.round(x * a + bg[i] * (1 - a)));
        const 必要 = 点 ? 3.0 : 4.5;
        const 比 = contrast(実, bg);
        表.push(名 + '/' + (el.className || el.tagName) + '=' + 比);
        if (比 < 必要) {
          悪い.push(名 + '：' + (el.className || el.tagName) +
            '（' + 比 + ' < ' + 必要 + '・色=' + 前景 + '）');
        }
      });
    });
    assert(表.length >= Object.keys(世界).length * 5,
      '6つの世界すべてで測っている（実際:' + 表.length + '組）');
    assertEqual(悪い.join('\n       '), '', '世界の上で読めない文字・印');
    win.close();
  });

  r.finish();
})();
