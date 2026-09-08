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

  // ── 輪になった棚を測るための下ごしらえ ───────────────
  //
  // jsdom はレイアウトしないので、席（flexのorder）から座標を作る。
  // **本物と同じ出し方にする**——実物も、並びの順ではなく席の順に並ぶ。
  // 手で「i番目は i*132」と書くと、輪にした瞬間に嘘になる（落とし穴25）
  const STEP = 132;
  function 席から座標を作る(win, carts) {
    carts.forEach((c) => Object.defineProperty(c, 'offsetLeft', {
      get: () => (Number(c.style.order) || 0) * STEP, configurable: true
    }));
    // 座標が付いたので、位置を計算し直させる。
    // **アプリ側の本物の道を通す**——幅が変わった時と同じ入口（resize）。
    // ここで検査専用の関数を呼ぶと、本番で誰も呼んでいない道を試すことになる
    win.dispatchEvent(new win.Event('resize'));
  }
  const 席 = (c) => Number(c.style.order) || 0;
  const 帯の位置 = (track) => {
    const m = /translateX\((-?\d+(?:\.\d+)?)px\)/.exec(track.style.transform || '');
    return m ? Number(m[1]) : null;
  };

  /**
   * **この検査の芯。**
   *
   * 壊れていた時は「印だけが進んで、棚が動かない」だった。
   * 輪にしたいまは、中央のカセットが**いつも同じ場所に見えている**ことが
   * その裏返しになる：
   *
   *     中央のカセットの席 × 送り幅 ＋ 帯の位置 ＝ 0
   *
   * 帯の位置には「まんなかの席を窓の中央へ置くためのずらし」が入っているので、
   * 0 が「窓のまんなかに見えている」を意味する。
   *
   * 送っている最中（席はまだ前のまま・帯がずれている）でも、
   * 座り直したあと（席が新しい・帯は休みの位置）でも、この式は成り立つ。
   * どちらか片方だけを見ると、ちぐはぐを捕まえられない。
   */
  function 中央が真ん中に見えているか(rail, track) {
    const c = rail.querySelector('.cart.center');
    if (!c) return { ok: false, why: '中央のカセットが無い' };
    const 実際 = 席(c) * STEP + (帯の位置(track) || 0);
    return { ok: 実際 === 0, why: '中央の見えている位置 ' + 実際 + '（期待 0）' };
  }
  /** 休んでいる時の帯の位置（まんなかの席を窓の中央へ置くぶんだけ左） */
  const 休みの位置 = (rail) => -Math.floor(rail.querySelectorAll('.cart').length / 2) * STEP;

  await r.test('矢印で送っても、中央のカセットはいつも真ん中に見えている', async () => {
    const { win, doc, errors } = await launch();
    const rail = doc.querySelector('#shelfList .rail');
    assert(rail, '棚のレールがある');
    const track = rail.querySelector('.rail-track');
    assert(track, '動く帯（.rail-track）がある');
    const carts = Array.from(rail.querySelectorAll('.cart'));
    assert(carts.length >= 5,
      '輪にできるだけ札がある（実際:' + carts.length + '枚）。' +
      '少なすぎると、輪の反対側の空白が見えてしまう');  // 型(b)
    席から座標を作る(win, carts);

    const 中央 = () => (rail.querySelector('.cart.center') || {}).dataset;
    const 見え = () => 中央が真ん中に見えているか(rail, track);
    assertEqual(中央().cart, carts[0].dataset.cart, '最初は1枚目');
    assert(見え().ok, '最初から真ん中に見えている：' + 見え().why);

    const 右 = rail.parentNode.querySelector('.rail-arrow.right');
    const 左 = rail.parentNode.querySelector('.rail-arrow.left');

    // **輪なので、矢印が使えなくなる端が無い**
    assert(!右.disabled && !左.disabled, '最初から両方の矢印が押せる');

    for (let k = 1; k <= carts.length; k++) {
      右.click();
      // 滑っている最中（席はまだ前のまま）でも式は成り立つ
      assert(見え().ok, k + '回目・滑っている最中：' + 見え().why);
      await sleep(win, 350);   // 座り直し（fxMs(250)+30）を待つ
      assert(見え().ok, k + '回目・座り直したあと：' + 見え().why);
      assertEqual(帯の位置(track), 休みの位置(rail), k + '回目・休んだら帯は休みの位置にもどる');
      assertEqual(中央().cart, carts[k % carts.length].dataset.cart, k + '回目の中央');
    }
    // **一周して戻ってきている**（この検査の要）
    assertEqual(中央().cart, carts[0].dataset.cart, '一周すると最初のカセットに戻る');
    assert(!右.disabled && !左.disabled, '一周しても矢印は押せるまま');

    // 逆向きにも回れる（先頭から左で、最後尾へ回り込む）
    左.click();
    await sleep(win, 350);
    assertEqual(中央().cart, carts[carts.length - 1].dataset.cart,
      '先頭から左で、最後尾に回り込む');
    assert(見え().ok, '回り込んでも真ん中に見えている：' + 見え().why);

    assertNoErrors(errors, '棚を送る操作で未捕捉の例外');
    win.close();
  });

  await r.test('位置の目印が、いま何枚目かを出している（2-2）', async () => {
    // 輪にすると「端まで来た」という手応えが消える。
    // **代わりに、いま何枚目かを目で分かるようにする**のが 2-2 の条件
    const { win, doc, errors } = await launch();
    const rail = doc.querySelector('#shelfList .rail');
    const carts = Array.from(rail.querySelectorAll('.cart'));
    席から座標を作る(win, carts);
    const dots = doc.getElementById('shelfDots');
    assert(dots, '位置の目印がある');
    assertEqual(dots.children.length, carts.length, '点の数と札の数が合っている');

    const 光っている = () => Array.from(dots.children).findIndex((d) => d.classList.contains('on'));
    assertEqual(光っている(), 0, '最初は1つ目が光る');
    assertEqual(dots.children.length > 0 ? Array.from(dots.children).filter((d) => d.classList.contains('on')).length : -1,
      1, '光っているのは1つだけ');

    rail.parentNode.querySelector('.rail-arrow.right').click();
    await sleep(win, 350);
    assertEqual(光っている(), 1, '送ると目印も動く');

    // 目印そのものを押して飛べる（片手で端まで送るのは遠い）
    dots.children[3].click();
    await sleep(win, 350);
    assertEqual(光っている(), 3, '目印を押すと、そこへ飛ぶ');
    assertEqual((rail.querySelector('.cart.center') || {}).dataset.cart, carts[3].dataset.cart,
      '飛んだ先が中央になっている');
    assert(中央が真ん中に見えているか(rail, rail.querySelector('.rail-track')).ok,
      '飛んだあとも真ん中に見えている');

    // 読み上げにも、いま何枚目かが出る（点は目でしか分からない）
    assert(/\d+ \/ \d+/.test(dots.getAttribute('aria-label') || ''),
      '読み上げにも位置が出る（実際: ' + dots.getAttribute('aria-label') + '）');
    assertNoErrors(errors, '位置の目印で未捕捉の例外');
    win.close();
  });

  await r.test('準備中のカセットは、最後尾に1枚だけ畳まれている（2-2）', async () => {
    // **7枚の「？」が並ぶ棚は、遊べるものを探しに来た人の邪魔でしかない。**
    // それでも0枚にはしない——「まだ増える」ことは伝えたい
    const { win, doc, errors } = await launch();
    const rail = doc.querySelector('#shelfList .rail');
    const carts = Array.from(rail.querySelectorAll('.cart'));
    const 畳んだ札 = carts.filter((c) => c.dataset.more);
    assertEqual(畳んだ札.length, 1, '畳んだ札はちょうど1枚');
    assertEqual(carts.indexOf(畳んだ札[0]), carts.length - 1, '最後尾にいる');
    assert(/準備中/.test(畳んだ札[0].textContent), '何の札かが読める');
    assert(/\d/.test(畳んだ札[0].textContent), '何枚ぶんかが出ている：' + 畳んだ札[0].textContent.replace(/\s+/g, ''));

    // **逆向きも見る**（落とし穴20）。個別の準備中カセットは1枚も出ていない
    const INV = require('./inventory');
    const 出ている = carts.filter((c) => c.dataset.cart).map((c) => c.dataset.cart);
    assert(出ている.length > 0, 'カセットが出ている（実際:' + 出ている.length + '枚）');  // 型(b)
    assertEqual(出ている.slice().sort().join(','), INV.READY_CASSETTE_IDS.slice().sort().join(','),
      '棚に出ているのは、完成しているカセットちょうど全部');

    // 畳んだ札には data-cart を付けない（1枚が特定のidを名乗る嘘にしない）
    assert(!畳んだ札[0].dataset.cart, '畳んだ札は、どれか1つのカセットを名乗らない');
    assertNoErrors(errors, '畳んだ札で未捕捉の例外');
    win.close();
  });

  await r.test('指で送ると、いちばん近い1枚に吸い付く（2-2）', async () => {
    // 2-2「1本ずつ吸い付く」を、自前で持つことにした分の検査。
    // ブラウザの scroll-snap に任せていた頃は、この振る舞いを
    // 誰も検査していなかった（ブラウザを信じていた）——
    // そのブラウザが動かなくなっていたのが今回のバグ。
    const { win, doc, errors } = await launch();
    const rail = doc.querySelector('#shelfList .rail');
    const track = rail.querySelector('.rail-track');
    const carts = Array.from(rail.querySelectorAll('.cart'));
    席から座標を作る(win, carts);
    const 中央 = () => (rail.querySelector('.cart.center') || {}).dataset.cart;
    const 指 = (type, x) => carts[0].dispatchEvent(new win.PointerEvent(type, {
      bubbles: true, pointerType: 'touch', pointerId: 7, clientX: x, clientY: 10
    }));

    // ① 送っている間は、指に貼り付いて動く（1枚ずつ飛ばない）
    指('pointerdown', 300);
    指('pointermove', 220);                       // 左へ80px
    assertEqual(帯の位置(track) - 休みの位置(rail), -80, '指の動きぶん、そのまま動く');
    assert(track.classList.contains('rail-grab'), '送っている間は滑らせない');

    // ② 離すと、いちばん近い1枚へ（80px は送り幅132pxの半分より大きい → 次へ）
    指('pointerup', 220);
    await sleep(win, 350);
    assertEqual(中央(), carts[1].dataset.cart, '半分を越えたら次の1枚に吸い付く');
    assertEqual(帯の位置(track), 休みの位置(rail), '休んだら帯は休みの位置');
    assert(中央が真ん中に見えているか(rail, track).ok, '吸い付いた先が真ん中に見えている');

    // ③ **半分に足りない時は戻る**（分岐の反対側も試す。落とし穴10-c）
    指('pointerdown', 300);
    指('pointermove', 260);                       // 左へ40px（132の半分未満）
    指('pointerup', 260);
    await sleep(win, 350);
    assertEqual(中央(), carts[1].dataset.cart, '半分に足りなければ、元の1枚に戻る');
    assertEqual(帯の位置(track), 休みの位置(rail), '位置も元に戻る');

    // ④ **1枚ぶんより先へは指で行けない**（輪の反対側の空白を見せない）
    指('pointerdown', 400);
    指('pointermove', 0);                         // 左へ400px（3枚ぶん）
    const 限度 = Math.abs(帯の位置(track) - 休みの位置(rail));
    assert(限度 <= STEP * 1.2,
      '大きく振っても1枚ぶん強で止まる（実際:' + 限度 + 'px）');
    指('pointerup', 0);
    await sleep(win, 350);

    // ⑤ 8px 以内の揺れでは送りに入らない（押したつもりが送りにならない）
    const 前 = 中央();
    指('pointerdown', 300);
    指('pointermove', 295);
    assert(!track.classList.contains('rail-grab'), '指の小さな揺れは送りにしない');
    指('pointerup', 295);
    await sleep(win, 350);
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
    const rail = doc.querySelector('#shelfList .rail');
    const carts = Array.from(rail.querySelectorAll('.cart'));
    assert(carts.length >= 3, '離れた位置に焦点を当てられる（実際:' + carts.length + '枚）');  // 型(b)
    席から座標を作る(win, carts);
    const 中央 = () => (rail.querySelector('.cart.center') || {}).dataset.cart;

    assertEqual(中央(), carts[0].dataset.cart, '最初は1枚目');
    carts[2].focus();
    await sleep(win, 350);
    assertEqual(中央(), carts[2].dataset.cart, '焦点を追って棚が送られる');

    // **押したことによる焦点では動かさない。**
    //
    // button は押すと焦点が当たる。そこで中央を移してしまうと
    // 「中央でない1枚目のタップ＝寄せる／2枚目＝あそぶ」の2段が壊れ、
    // 1回のタップでいきなりゲームに入る。棚の操作の要なので、両方見る
    const 前 = 中央();
    const 別 = carts.find((c) => c.dataset.cart && c.dataset.cart !== 前);
    assert(別, '中央でないカセットがある');  // 型(b)

    別.dispatchEvent(new win.PointerEvent('pointerdown', {
      bubbles: true, pointerType: 'touch', pointerId: 3, clientX: 100, clientY: 10
    }));
    別.focus();
    await sleep(win, 40);
    assertEqual(中央(), 前, '押したことによる焦点では、まだ中央を移さない');

    別.click();
    await sleep(win, 400);
    assertEqual(activeScreen(doc), 'scr-shelf', '1回目のタップでは、まだ遊び始めない');
    assertEqual(中央(), 別.dataset.cart, '1回目のタップで中央に寄る');

    assertNoErrors(errors, '焦点の移動で未捕捉の例外');
    win.close();
  });

  r.finish();
})();
