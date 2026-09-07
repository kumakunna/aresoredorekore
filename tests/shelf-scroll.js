// tests/shelf-scroll.js — 棚を横に送れなくなるバグ（第41弾 2-9・門D17）
//
// ── 実測（Chrome・375px幅）────────────────────────────
//   `deal` の段：送れる余地 **396px**
//
//   | 操作                              | 動いた量 |
//   |----------------------------------|---------|
//   | 矢印を3回押す                      | **0px** |
//   | `rail.scrollLeft = 396` と直接代入  | **0px** |
//
//   そのとき `rail._centerEl` は4枚目（deal-soon-3）だった。
//   **選択の印だけが3つ進み、棚は1pxも動いていない。**
//   遊ぶ人には「押しても棚が動かないのに、画面に出ていないカセットが
//   選ばれている」と見える。
//
// ── 直し方 ────────────────────────────────────────
//   スクロール位置ではなく、**いま何枚目かという数**を権威にした。
//   `.rail` は窓（はみ出しを切るだけ）、中の `.rail-track` を
//   `transform` で動かす。中央の印・矢印の可否・帯の位置は、
//   すべて `rail._index` から描き直す——ずれようがない形。
//
// ── 確かめられなかったこと ─────────────────────────
//   この検査の前の版は「mandatory と smooth の同居が原因」と書いていた。
//   その内訳（どちらが主犯か）を、今日の環境では**検算できていない**。
//   ブラウザ枠が裏に回ると `requestAnimationFrame` が止まり、
//   `scroll-behavior:smooth` の動きそのものが進まなくなるため
//   （60msのタイマーが1000msかかる状態で測っていた）。
//   **不動が起きること自体は上のとおり再現済み。**
//   直しは両方を使わない形なので、内訳が分からなくても先へ進める。

const fs = require('fs');
const path = require('path');
const { launch, sleep, activeScreen, createRunner, assert, assertEqual, assertNoErrors, cssRules } = require('./harness');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const CSS = HTML.slice(HTML.indexOf('<style>') + 7, HTML.indexOf('</style>'))
  .replace(/\/\*[\s\S]*?\*\//g, '');

/** CSSの規則を（選択子, 中身）で拾う。切り出しは harness に1本だけ置いてある */
function rules() { return cssRules(CSS); }

/** その選択子の規則をぜんぶ集める（同じ名前が2度書かれていても取りこぼさない） */
function bodyOf(sel) {
  return rules().filter((r) => r.sel === sel).map((r) => r.body).join(' ');
}

(async function main() {
  const r = createRunner('shelf-scroll：棚を横に送る（第41弾 2-9）');

  await r.test('棚のレールは、ブラウザのスクロールに頼っていない', async () => {
    // **不動の再発を、根から断つ。**
    // レールがスクロールの容れ物である限り、吸い付きと滑りの組み合わせや
    // 慣性の扱いで同じことが起きうる。容れ物であることをやめたので、
    // 「やめたままである」ことを見張る。
    const rail = bodyOf('.rail');
    assert(rail, '.rail の指定を読めている');   // 型(b)：読めていないのに緑にしない
    assert(!/overflow-x:\s*(auto|scroll)/.test(rail), '.rail は横スクロールの容れ物ではない');
    assert(!/scroll-snap-type/.test(rail), '.rail は scroll-snap を使わない');
    assert(!/scroll-behavior/.test(rail), '.rail は scroll-behavior を使わない');
    // 縦のページ送りは指に残す（横だけ自前で受ける）
    assert(/touch-action:\s*pan-y/.test(rail), '縦のページ送りは指に残っている');

    // カセット側にも、対になる指定を残さない（効かない指定は誤解のもと）
    assert(!/scroll-snap-align/.test(bodyOf('.cart')), '.cart に効かない scroll-snap-align が残っていない');

    // **横は切って、縦は切らない。**
    //
    // 中央のカセットは translateY(-10px) で浮く。縦も切ると、その10pxが消える。
    // 実測（Chrome）：窓の上端773に対してカセットの上端763。
    // 上端より7px上の点で `elementFromPoint` を撃つと——
    //   両軸を切る（auto/auto）→ `shelf-inner`（カセットは描かれていない）
    //   いまの指定（clip/visible）→ 中央のカセット
    // つまり浮きは**一度も見えていなかった**。作り直し以前からで、
    // `overflow-x:auto` を書くと `overflow-y` は visible ではいられない、
    // というCSSの決まりから来ていた。`clip` だけが片軸に visible を残せる。
    assert(/overflow-x:\s*clip/.test(rail), '横ははみ出しを切る（カルーセルの窓）');
    assert(/overflow-y:\s*visible/.test(rail), '縦は切らない（中央の浮きを削らない）');
    assert(!/overflow-y:\s*(hidden|auto|scroll)/.test(rail), '縦を切る指定に戻っていない');
  });

  await r.test('横に送る帯が他に残っていても、動かなくなる組み合わせを持たない', async () => {
    // 棚は容れ物をやめたが、**他の部品はまだスクロールで送っている**
    // （カタログの並び・数字の輪）。同じ轍を踏ませない。
    //
    // ここは前の版から残した規則。ただし**前の版はこれ1つで緑になっていた**——
    // 棚がスクロールをやめた瞬間、拾われるのは #catThemeSeg だけになり、
    // 「棚が送れる」を何も見ていないのに通る状態だった（実際に確かめた）。
    // だから上の1件目（棚そのもの）と、下の3件目（実際に動くか）を足した。
    const 横に送る = rules().filter((x) => /overflow-x:\s*(auto|scroll)/.test(x.body));
    const 縦に送る = rules().filter((x) => /overflow-y:\s*(auto|scroll)/.test(x.body));
    const 送る = 横に送る.concat(縦に送る);
    assert(送る.length > 0, 'スクロールで送る帯がある（実際:' + 送る.length + '件）');  // 型(b)

    const 止まる = 送る.filter((x) =>
      /scroll-snap-type:\s*[xy]?\s*mandatory/.test(x.body) &&
      /scroll-behavior:\s*smooth/.test(x.body));
    assertEqual(止まる.map((x) => x.sel).join('・'), '',
      '吸い付きと滑りを同居させている帯');
  });

  await r.test('矢印で、中央の印と帯の位置が**そろって**動く', async () => {
    // **これが今回の本題。**壊れていた時は、印だけが動いて帯が動かなかった。
    // 片方だけを見る検査ではその形を捕まえられないので、両方を1つの検査で見る。
    const { win, doc, errors } = await launch();
    const rail = doc.querySelector('#shelfList .rail[data-rail="deal"]');
    assert(rail, '4枚あるレールがある');
    const track = rail.querySelector('.rail-track');
    assert(track, '動く帯（.rail-track）がある');
    const carts = Array.from(rail.querySelectorAll('.cart'));
    assert(carts.length >= 3, '送れるだけカセットがある（実際:' + carts.length + '枚）');  // 型(b)

    // jsdom はレイアウトしないので、送り幅（実物では124+8）だけ与える。
    // **中央がどれかは数が持っている**ので、偽装するのはここだけで足りる
    const STEP = 132;
    carts.forEach((c, i) => Object.defineProperty(c, 'offsetLeft', { get: () => i * STEP, configurable: true }));

    const 位置 = () => {
      const m = /translateX\((-?\d+(?:\.\d+)?)px\)/.exec(track.style.transform || '');
      return m ? Number(m[1]) : null;
    };
    const 中央 = () => (rail.querySelector('.cart.center') || {}).dataset.cart;

    const 右 = rail.parentNode.querySelector('.rail-arrow.right');
    const 左 = rail.parentNode.querySelector('.rail-arrow.left');
    assert(左.disabled, '先頭では左矢印が無効');
    assertEqual(中央(), carts[0].dataset.cart, '最初は1枚目が中央');

    右.click(); await sleep(win, 60);
    assertEqual(中央(), carts[1].dataset.cart, '右矢印で2枚目が中央になる');
    assertEqual(位置(), -STEP, '帯も1枚ぶん動いている（印だけ進む形にしない）');
    assert(!左.disabled, '動いたら左矢印が有効');

    右.click(); await sleep(win, 60);
    assertEqual(中央(), carts[2].dataset.cart, 'もう一度で3枚目');
    assertEqual(位置(), -STEP * 2, '帯も2枚ぶん');

    左.click(); await sleep(win, 60);
    assertEqual(中央(), carts[1].dataset.cart, '左矢印で戻る');
    assertEqual(位置(), -STEP, '帯も戻る');

    // **端を越えて送ろうとしても、印と位置がちぐはぐにならない。**
    //
    // ここは最初、矢印を6回押して確かめていた。**それでは何も試せていなかった**——
    // 末尾で矢印は `disabled` になり、押しても何も起きないので、
    // 端の止めを外す変異が素通りした（実際に変異で確かめて気づいた）。
    // 端の止めが本当に効くのは**キーボード**の側（`disabled` を見ない）なので、
    // そちらで押しすぎる（落とし穴10-c：分岐の反対側を実際に作りに行く）
    for (let i = 0; i < 6; i++) {
      doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      await sleep(win, 20);
    }
    assertEqual(中央(), carts[carts.length - 1].dataset.cart, '押しすぎても最後で止まる');
    assertEqual(位置(), -STEP * (carts.length - 1), '帯も最後で止まる');
    assert(右.disabled, '末尾では右矢印が無効');

    // 逆の端も同じ（片方向だけ効く止めを作らない。落とし穴8）
    for (let i = 0; i < 6; i++) {
      doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      await sleep(win, 20);
    }
    assertEqual(中央(), carts[0].dataset.cart, '戻しすぎても先頭で止まる');
    assertEqual(位置(), 0, '帯も先頭で止まる');
    assert(左.disabled, '先頭では左矢印が無効');

    assertNoErrors(errors, '棚を送る操作で未捕捉の例外');
    win.close();
  });

  await r.test('指で送ると、いちばん近い1枚に吸い付く（2-2）', async () => {
    // 2-2「1本ずつ吸い付く」を、自前で持つことにした分の検査。
    // ブラウザの scroll-snap に任せていた頃は、この振る舞いを
    // 誰も検査していなかった（ブラウザを信じていた）——
    // そのブラウザが動かなくなっていたのが今回のバグ。
    const { win, doc, errors } = await launch();
    const rail = doc.querySelector('#shelfList .rail[data-rail="deal"]');
    const track = rail.querySelector('.rail-track');
    const carts = Array.from(rail.querySelectorAll('.cart'));
    const STEP = 132;
    carts.forEach((c, i) => Object.defineProperty(c, 'offsetLeft', { get: () => i * STEP, configurable: true }));
    const 中央 = () => (rail.querySelector('.cart.center') || {}).dataset.cart;
    const 指 = (type, x) => carts[0].dispatchEvent(new win.PointerEvent(type, {
      bubbles: true, pointerType: 'touch', pointerId: 7, clientX: x, clientY: 10
    }));

    // ① 送っている間は、指に貼り付いて動く（1枚ずつ飛ばない）
    指('pointerdown', 300);
    指('pointermove', 220);                       // 左へ80px
    assertEqual(track.style.transform, 'translateX(-80px)', '指の動きぶん、そのまま動く');
    assert(track.classList.contains('rail-grab'), '送っている間は滑らせない');

    // ② 離すと、いちばん近い1枚へ（80px は送り幅132pxの半分より大きい → 次へ）
    指('pointerup', 220);
    await sleep(win, 80);
    assertEqual(中央(), carts[1].dataset.cart, '半分を越えたら次の1枚に吸い付く');
    assertEqual(track.style.transform, 'translateX(-132px)', 'きっちり1枚ぶんの位置に着く');

    // ③ **半分に足りない時は戻る**（分岐の反対側も試す。落とし穴10-c）
    指('pointerdown', 300);
    指('pointermove', 260);                       // 左へ40px（132の半分未満）
    指('pointerup', 260);
    await sleep(win, 80);
    assertEqual(中央(), carts[1].dataset.cart, '半分に足りなければ、元の1枚に戻る');
    assertEqual(track.style.transform, 'translateX(-132px)', '位置も元に戻る');

    // ④ 逆向きにも送れる
    指('pointerdown', 100);
    指('pointermove', 260);                       // 右へ160px
    指('pointerup', 260);
    await sleep(win, 80);
    assertEqual(中央(), carts[0].dataset.cart, '逆向きにも送れる');

    // ⑤ 8px 以内の揺れでは送りに入らない（押したつもりが送りにならない）
    const 前 = 中央();
    指('pointerdown', 300);
    指('pointermove', 295);
    assert(!track.classList.contains('rail-grab'), '指の小さな揺れは送りにしない');
    指('pointerup', 295);
    await sleep(win, 80);
    assertEqual(中央(), 前, '揺れただけでは中央が変わらない');

    assertNoErrors(errors, '指で送る操作で未捕捉の例外');
    win.close();
  });

  await r.test('Tabで焦点が当たったカセットまで棚が送られる（ただし押した時は動かない）', async () => {
    // カセットは button なので Tab で辿れる。以前はブラウザが
    // 「焦点の当たったものを見えるところまでスクロールする」をやっていたが、
    // 横を clip にした今、ブラウザには寄せる手立てが無い。
    // **見えないカセットに焦点だけが乗る**ので、こちらで追う。
    const { win, doc, errors } = await launch();
    const rail = doc.querySelector('#shelfList .rail[data-rail="deal"]');
    const carts = Array.from(rail.querySelectorAll('.cart'));
    assert(carts.length >= 3, '離れた位置に焦点を当てられる（実際:' + carts.length + '枚）');  // 型(b)
    const 中央 = () => (rail.querySelector('.cart.center') || {}).dataset.cart;

    assertEqual(中央(), carts[0].dataset.cart, '最初は1枚目');
    carts[2].focus();
    await sleep(win, 60);
    assertEqual(中央(), carts[2].dataset.cart, '焦点を追って棚が送られる');

    // **押したことによる焦点では動かさない。**
    //
    // button は押すと焦点が当たる。そこで中央を移してしまうと
    // 「中央でない1枚目のタップ＝寄せる／2枚目＝あそぶ」の2段が壊れ、
    // 1回のタップでいきなりゲームに入る。棚の操作の要なので、両方見る
    const w = doc.querySelector('#shelfList .rail[data-rail="word"]');
    const wc = Array.from(w.querySelectorAll('.cart'));
    const 中央w = () => (w.querySelector('.cart.center') || {}).dataset.cart;
    const 前 = 中央w();
    assert(wc[1] && wc[1].dataset.cart !== 前, '中央でないカセットがある');  // 型(b)

    wc[1].dispatchEvent(new win.PointerEvent('pointerdown', {
      bubbles: true, pointerType: 'touch', pointerId: 3, clientX: 100, clientY: 10
    }));
    wc[1].focus();
    await sleep(win, 40);
    assertEqual(中央w(), 前, '押したことによる焦点では、まだ中央を移さない');

    wc[1].click();
    await sleep(win, 100);
    assertEqual(activeScreen(doc), 'scr-shelf', '1回目のタップでは、まだ遊び始めない');
    assertEqual(中央w(), wc[1].dataset.cart, '1回目のタップで中央に寄る');

    assertNoErrors(errors, '焦点の移動で未捕捉の例外');
    win.close();
  });

  r.finish();
})();
