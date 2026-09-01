// tests/fixes36.js — 第36弾で直した不具合の再発防止
//
// 指示36の7件のうち、ここが受け持つのは 36-2 / 36-3 / 36-5 / 36-6 の4件。
// 残りは、それぞれの持ち場に置いてある（同じことを2か所で見張らないため）：
//   36-1（3-2-1がスキップできる）  → tests/fx.js
//   36-4（結果画面のラウンド数）    → tests/rt-screens.js
//   36-7（季節イベントの入れ替え）  → tests/titles.js
//
// 落とし穴10の4つの型を踏まないよう、次を守って書いている：
//   (a) 自己参照   … 実装側の定数を検査の入力や範囲に使わない。約束は具体の数字で書く
//   (b) 条件未成立 … 「その状況が本当に起きているか」を、主張の前に1つ確かめる
//   (c) 分岐未試験 … 3択・全テーマのように分岐があるものは、全部の入力を回す
//   (d) 実データ依存 … 変わるデータではなく、変わらない性質（門が効くこと）を試す

const fs = require('fs');
const path = require('path');
const {
  createRunner, assert, assertEqual, assertNoErrors,
  launch, activeScreen, sleep, waitFor, waitScreen, el, click, fillPlayerForm, pickGame
} = require('./harness');
const INV = require('./inventory');

const INDEX_HTML = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

// index.html の <style> の中身だけを取り出す（CSSの決めごとを機械照合するため）
const CSS = (INDEX_HTML.match(/<style>([\s\S]*?)<\/style>/) || [null, ''])[1];

// ---- CSSの宣言ブロックを、セレクタ単位で拾う小道具 ----
// 正規のパーサは要らない。このファイルのCSSは「セレクタ{宣言}」が素直に並んでいる
function rulesOf(css) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    out.push({ sel: m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim(), body: m[2].trim() });
  }
  return out;
}
const RULES = rulesOf(CSS);
function ruleFor(sel) {
  return RULES.filter((r) => r.sel === sel).map((r) => r.body).join(' ');
}
// 宣言から px の値を1つ取り出す（'12px' → 12 / '50%' や 'auto' は null）
function px(body, prop) {
  const m = new RegExp('(?:^|;|\\s)' + prop + '\\s*:\\s*(-?[\\d.]+)px', 'i').exec(body);
  return m ? parseFloat(m[1]) : null;
}

(async function main() {
  const r = createRunner('fixes36：第36弾で直した不具合');

  // ===================== 36-2 =====================
  await r.test('36-2：時間の見せ方は3択で、全カセットの時計が設定1か所に従う', async () => {
    // --- ① 時計と data-timer が、両方向で一致している（落とし穴20） ---
    // 「時計なのに data-timer が無い」も「data-timer なのに時計でない」も、どちらも赤にする。
    // 片方向だけ見ていると、新しい時計を足した時にすり抜ける
    const tags = Array.from(INDEX_HTML.matchAll(/<[a-z]+[^>]*\bid="([A-Za-z]+Timer)"[^>]*>/g));
    assert(tags.length >= 8, '「〜Timer」という要素が、そもそも見つかっている');  // 型(b)
    const missing = [];
    tags.forEach((m) => {
      const id = m[1];
      if (INV.NOT_A_CLOCK_IDS.indexOf(id) >= 0) return;   // 意識して書いた例外だけ通す
      if (!/\bdata-timer\b/.test(m[0])) missing.push(id);
    });
    assertEqual(missing.join(','), '',
      '残り時間を出す要素には data-timer が付いている（付け忘れ＝設定が効かない時計）');

    const marked = Array.from(INDEX_HTML.matchAll(/<[a-z]+[^>]*\bdata-timer\b[^>]*>/g));
    assert(marked.length >= 8, 'data-timer が付いた要素が見つかっている');        // 型(b)
    const strays = marked
      .map((m) => (/\bid="([^"]+)"/.exec(m[0]) || [null, '(idなし)'])[1])
      .filter((id) => !/Timer$/.test(id));
    assertEqual(strays.join(','), '', '時計でないものに data-timer が付いていない');

    // --- ② 3択が、押した瞬間に画面全体へ効く（分岐を全部通す・型(c)） ---
    const { win, doc, errors } = await launch();
    const app = el(doc, 'app');
    const segs = doc.querySelectorAll('.js-timerview');
    assert(segs.length >= 2,
      '設定画面とウィザードの両方に窓口がある（どちらから変えても同じ1か所を書き換える）');
    ['always', 'peek', 'hidden'].forEach((v) => {
      assert(doc.querySelector('[data-timerview="' + v + '"]'), v + ' が選べる');
    });
    ['peek', 'hidden', 'always', 'hidden'].forEach((v) => {
      click(doc, doc.querySelector('[data-timerview="' + v + '"]'));
      assertEqual(app.dataset.timerView, v, v + ' を選ぶと、画面全体の見せ方がその場で切り替わる');
    });

    // --- ③ 「表示しない」「見たい時だけ」に、実際の効き目の居場所がある ---
    // CSSの決めごとが1つでも欠けると、設定は出るのに何も起きない（落とし穴21）
    assert(/\[data-timer-view="hidden"\][^{]*\[data-timer\]/.test(CSS),
      '「表示しない」を受け止めるCSSがある');
    assert(/\[data-timer-view="peek"\][^{]*\[data-timer\]/.test(CSS),
      '「見たい時だけ」を受け止めるCSSがある');

    // --- ④ 「見たい時だけ」は、時計そのものを押すと開く ---
    click(doc, doc.querySelector('[data-timerview="peek"]'));
    const chip = el(doc, 'playTimer');
    assert(!chip.classList.contains('peek-on'), 'はじめは閉じている');           // 型(b)
    chip.click();
    assert(chip.classList.contains('peek-on'), '時計を押すと、その時計だけ開く');
    chip.click();
    assert(!chip.classList.contains('peek-on'), 'もう一度押すと閉じる');

    // --- ⑤ ゲームごとの「表示するか」の判断が残っていない（落とし穴1） ---
    assertEqual((INDEX_HTML.match(/timerDisplay/g) || []).length, 0,
      '個別実装（state.timerDisplay）が1つも残っていない');
    assertNoErrors(errors);
    win.close();   // jsdomの時計を残すと、テストのプロセスが終わらない
  });

  // ===================== 36-3 =====================
  await r.test('36-3：1台のゲームを途中で終わらせると、走っていた時計が全部止まる', async () => {
    const { win, doc, errors } = await launch();
    win.confirm = () => true;

    // 「このゲームが動かしている時計」だけを数える。
    // 実装の内部変数（play.bombInterval など）を覗くと、変数名を変えただけで
    // テストが黙って素通りする。外から見える「走っている時計」の側で見張る
    const live = new Map();
    const rawSet = win.setInterval.bind(win);
    const rawClear = win.clearInterval.bind(win);
    win.setInterval = function (fn, ms) { const id = rawSet(fn, ms); live.set(id, ms); return id; };
    win.clearInterval = function (id) { live.delete(id); return rawClear(id); };

    await startBombCoop(win, doc);
    // 型(b)：止める対象が本当に走っているか、主張の前に確かめる
    const running = Array.from(live.values());
    assert(running.length > 0, 'ゲーム中は、このゲームの時計が走っている（' + running.join(',') + 'ms）');
    assert(running.indexOf(1000) >= 0, '1秒きざみの残り時間の時計がある');
    const started = Array.from(live.keys());

    // 設定 →「ゲームを終了する」（実機で報告された経路そのもの）
    click(doc, 'floatingGearBtn');
    await sleep(win, 40);
    click(doc, doc.querySelector('#setRootMenu [data-setpage="game"]'));
    await sleep(win, 40);
    click(doc, 'endGameBtn');
    await waitScreen(win, doc, 'scr-shelf', 5000);

    const leftOver = started.filter((id) => live.has(id));
    assertEqual(leftOver.length, 0,
      '棚にもどった時点で、そのゲームの時計は1つも残っていない（残ると、あとで「爆発しました」が出る）');

    // 走り残しが無いことを、時間を進めても何も起きないことでも確かめる
    await sleep(win, 1200);
    assertEqual(activeScreen(doc), 'scr-shelf', '棚にいたまま、勝手に画面が変わらない');
    assertNoErrors(errors);
    win.close();
  });

  // ===================== 36-5 =====================
  await r.test('36-5：トグルは、OFFが共通の灰色・ONがカセットのテーマ色', async () => {
    // OFFは1つに決める。ONはテーマごとに違う。どちらも「1か所の変数」を通す
    const base = ruleFor('.switch');
    const on = ruleFor('.switch.on');
    assert(/background:\s*var\(--switch-off\)/.test(base), 'OFFの色は --switch-off 1つで決まる');
    assert(/background:\s*var\(--switch-on\)/.test(on), 'ONの色は --switch-on 1つで決まる');

    // 具体の色を1つも書いていないこと。ここに直接色を書くと、
    // 「このテーマだけ見分けられない」が復活する（落とし穴1）
    const overrides = RULES.filter((x) =>
      /(^|,|\s)\.app\.theme-[a-z-]+[^,{]*\.switch(\s|$|,)/.test(x.sel) &&
      /(^|;|\s)background\s*:/.test(x.body));
    assertEqual(overrides.map((x) => x.sel).join(' / '), '',
      'テーマ側がスイッチの地の色を直接上書きしていない');

    // 分岐（テーマ）を全部通す・型(c)。棚に出ている全カセットのテーマに ON 色がある
    const themes = ['wolf', 'bomb', 'quiz', 'auction', 'sugoroku'];
    themes.forEach((t) => {
      const body = ruleFor('.app.theme-' + t);
      assert(body, '.app.theme-' + t + ' の定義がある');                       // 型(b)
      const m = /--switch-on\s*:\s*(#[0-9A-Fa-f]{6})/.exec(body);
      assert(m, t + ' テーマに --switch-on がある（無いと共通色のまま＝テーマに馴染まない）');
      assert(m[1].toUpperCase() !== '#C08A3C',
        t + ' テーマの ON は、共通の色そのままではない');
    });
    // 共通（カセットに属さない）側の既定色も、変数として1か所にある
    assert(/--switch-off\s*:\s*#[0-9A-Fa-f]{6}/.test(ruleFor(':root')), '共通のOFF色がある');
    assert(/--switch-on\s*:\s*#[0-9A-Fa-f]{6}/.test(ruleFor(':root')), '共通のON色がある');

    // 色だけに頼らない。つまみの位置は今までどおり左右に動く
    assert(/left\s*:/.test(ruleFor('.switch::after')) && /left\s*:/.test(ruleFor('.switch.on::after')),
      'ON/OFFはつまみの位置でも分かる（色が見分けられなくても伝わる）');
  });

  // ===================== 36-6 =====================
  await r.test('36-6：画面の四隅は、1つの隅に1つの役割だけ', async () => {
    // 隅に居座る要素（画面に固定で浮かぶ小さなもの）を、CSSから機械的に拾う。
    // 拾った全部が docs/デザインの正本.md の表（＝下の登録）に載っていること。
    // 新しく隅に何かを置いたら、表に足すまで赤くなる
    const CORNER = 80;      // 「隅」と見なす距離（px）。実装の定数ではなく、この検査の物差し
    const found = [];
    RULES.forEach((x) => {
      const b = x.body;
      if (!/position\s*:\s*(fixed|absolute)/.test(b)) return;
      if (/inset\s*:\s*0/.test(b)) return;                   // 画面全面のおおいは隅ではない
      const z = /z-index\s*:\s*(\d+)/.exec(b);
      if (!z || parseInt(z[1], 10) < 50) return;             // 前面に浮くものだけを見る
      const v = px(b, 'top') != null ? px(b, 'top') : px(b, 'bottom');
      const h = px(b, 'left') != null ? px(b, 'left') : px(b, 'right');
      if (v == null || h == null || v > CORNER || h > CORNER) return;
      const vs = px(b, 'top') != null ? 'top' : 'bottom';
      const hs = px(b, 'left') != null ? 'left' : 'right';
      found.push({ sel: x.sel, corner: vs + '-' + hs, offset: h });
    });
    assert(found.length >= 4, '隅に置かれた要素が、そもそも拾えている');       // 型(b)

    const known = INV.CORNER_SLOTS.map((s) => s.sel);
    const unknown = found.map((f) => f.sel).filter((s) => known.indexOf(s) < 0);
    assertEqual(unknown.join(' / '), '',
      '四隅に置かれているものが、全部 docs/デザインの正本.md の表に載っている');

    // 逆向きの照合（落とし穴20）：表にあるのに、もう画面に無いものを残さない
    const gone = known.filter((s) => !found.some((f) => f.sel === s));
    assertEqual(gone.join(' / '), '', '表に載っているものは、全部いま画面にある');

    // 同じ隅に2つ以上あるなら、横にずらしてあること（重なりを作らない）
    const byCorner = {};
    found.forEach((f) => { (byCorner[f.corner] = byCorner[f.corner] || []).push(f); });
    Object.keys(byCorner).forEach((c) => {
      const list = byCorner[c].slice().sort((a, b) => a.offset - b.offset);
      for (let i = 1; i < list.length; i++) {
        assert(list[i].offset - list[i - 1].offset >= 32,
          c + ' に並ぶ ' + list[i - 1].sel + ' と ' + list[i].sel + ' が重なっていない');
      }
    });

    // 季節の飾りは、隅から降ろした（実機で⚙と重なっていたもの）
    assertEqual((INDEX_HTML.match(/id="seasonDeco"/g) || []).length, 0,
      '季節の飾りが、隅に固定された要素として残っていない');
  });

  r.finish();
})();

/**
 * クイズ解除（協力版）を、かんたん2本で始める。
 * tests/smoke.js の同名の下ごしらえと同じ歩き方（あちらは演出を見るために使っている）。
 * ここで欲しいのは「時計が走っている状態」なので、コードは開かない。
 */
async function startBombCoop(win, doc) {
  const cart = doc.querySelector('.cart[data-cart="bakudan"]');
  cart.click();
  if (activeScreen(doc) === 'scr-shelf') cart.click();
  await waitScreen(win, doc, 'scr-game', 3000);
  pickGame(doc, 'bomb');
  await sleep(win, 60);
  await fillPlayerForm(win, doc, ['あき', 'びび']);
  await waitScreen(win, doc, 'scr-mode', 3000);
  click(doc, doc.querySelector('.mode-card[data-id="bomb-coop"]'));
  click(doc, 'modeNextBtn');
  await waitScreen(win, doc, 'scr-set-bomb', 3000);
  for (const tier of ['easy', 'normal', 'hard', 'nanisore', 'muri']) {
    for (let i = 0; i < 30; i++) {
      if (el(doc, 'bombCount-' + tier).textContent === '0') break;
      doc.querySelector('#bombTierRows .bomb-minus[data-tier="' + tier + '"]').click();
    }
  }
  for (let i = 0; i < 2; i++) {
    doc.querySelector('#bombTierRows .bomb-plus[data-tier="easy"]').click();
  }
  await sleep(win, 40);
  for (let i = 0; i < 10; i++) {
    const cur = activeScreen(doc);
    if (cur === 'scr-ready' || cur === 'scr-mode-rules') break;
    const next = doc.querySelector('#' + cur + ' [data-wiz-next]');
    if (!next) break;
    next.click();
    await sleep(win, 30);
  }
  if (activeScreen(doc) === 'scr-mode-rules') { click(doc, 'rulesStartBtn'); await sleep(win, 60); }
  await waitScreen(win, doc, 'scr-ready', 3000);
  el(doc, 'holdBtn').dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true }));
  await waitScreen(win, doc, 'scr-bomb-play', 12000);
  await sleep(win, 150);
}
