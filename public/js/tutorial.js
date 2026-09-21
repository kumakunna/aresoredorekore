// tutorial.js — 初プレイのチュートリアル（指示57）
//
// **カセットごとに「手順の台本」を渡すだけで動く。**ゲーム側にロジックを書かない。
//
// ## 台本の形
//
//   [ { 的:'.bomb-wire-btn:not(.solved)', 文:'コードをえらぶと、もんだいが出ます', 待つ:'tap' },
//     { 的:'.bomb-lives',                 文:'ライフはみんなで1つ',            待つ:'auto', 秒:2 } ]
//
//   的   … 明るく残す要素（セレクタ1つ）。**無ければその手は飛ばす**
//   文   … 1行。**説明ではなく、いまやること**を書く
//   待つ … 'tap'（その要素が押されるまで）／'auto'（秒）／'done'（ゲーム側から合図）
//
// ## 着手前に実測して決めたこと（docs/監査_指示57の門.md 2節）
//
// **穴は `clip-path`。**375×812 の実ブラウザで4案を当てた結果：
//   - CSS/SVGマスクは**塗りだけを切って、指を通さない**。穴が見えているのに押せない
//   - 「的の z-index を上げる」は、**明るさを既定から動かした人だけ壊れる**——
//     `:root[data-bright] #app > *` の filter が `.screen` に乗り、重なりの基準になる。
//     ほぼ全員で動くのでテストも実装も通り、スライダーを1目盛り動かした人にだけ
//     チュートリアルがゲームを操作不能にする（落とし穴36）
//
// **`clip-path` は子も切る。**だから文・閉じる・光の輪は、幕の**兄弟**に置く。
// 幕の子にすると、穴の中に出したものまで消える（実測ずみ）。
//
// **置き場は `#uiLayerRoot`。**`#app` の中に置くと上の filter に巻き込まれる（落とし穴26）。
// その箱は `pointer-events:none` なので、**中で自分で立て直す**（`.pause-veil` と同じ）。
//
// ## 進み方に fxMs() を通さない
//
// 幕の出入り（演出）は CSS transition に任せる——`:root.fx-skip *` が
// `transition-duration:0.001s` にするので、スキップの人には自動で瞬時になる。
// **手の進行（文を読む時間）は通さない。**通すとスキップの人は 0ms で流れて、
// 出ないのと同じになる（2-8「チュートリアルは消さない」）。
//
// ## 的の参照を握らない
//
// 盤も3択も**毎描画 innerHTML で作り直される**（index.html:20142・24956）。
// 節点を握ると、他の人が1本解いた知らせ1つで腐る。毎フレーム、選択子から引き直す。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TutorialKit = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var 余白 = 8;    // 穴を的より少し大きく取る（縁が食い込まない）
  var 角 = 14;     // 穴の角丸
  var 長押し = 600; // 「画面のどこかを長めに押す」＝閉じる（2-5）
  /**
   * **的が現れるのを、これだけ待ってから「無い」と決める。**
   *
   * 実機で回して出た（指示57・本物の部屋で2端末）。
   * 手渡しはマスを押すとその場で3択が出るが、**部屋は往復を待つ**——
   * 押した瞬間には `.overlay.show .pk-btn` が0件なので、
   * 「的が無ければ飛ばす」が効いて、**いちばん大事な「こたえをえらびます」が飛んでいた**。
   * 2.5秒後には3択が3つそろっていたので、選択子は正しく、**早すぎただけ**。
   *
   * 落とし穴18そのもの（部屋の知らせと手元の秘密は別便で、順番の保証がない）。
   * **jsdom の検査では出ない**——往復が無いので、的は常に即座にあるか、永久に無いかのどちらかになる。
   */
  var 既定の猶予 = 2500;

  var 状態 = null;  // 動いている間だけ中身が入る

  /**
   * 台本が「1手に1つの新要素」になっているか（門W13）。
   * **機械で見るために、データの側で分かる形にしてある**——
   * セレクタに `,` があれば複数を同時に光らせられてしまうので、そこで止める。
   * 検査もこの関数を呼ぶ（写さない・落とし穴1）
   */
  function 台本を調べる(台本) {
    var 悪い = [];
    (台本 || []).forEach(function (手, i) {
      var 番 = '第' + (i + 1) + '手';
      if (!手 || typeof 手.的 !== 'string' || !手.的) 悪い.push(番 + '：的が1つの選択子でない');
      else if (手.的.indexOf(',') !== -1) 悪い.push(番 + '：的が複数（' + 手.的 + '）');
      if (typeof 手.文 !== 'string' || !手.文) 悪い.push(番 + '：文が無い');
      else if (手.文.indexOf('\n') !== -1) 悪い.push(番 + '：文が2行以上');
      if (['tap', 'auto', 'done'].indexOf(手.待つ) === -1) 悪い.push(番 + '：待ち方が不明（' + 手.待つ + '）');
      if (手.待つ === 'auto' && !(手.秒 > 0)) 悪い.push(番 + '：auto なのに秒が無い');
    });
    return 悪い;
  }

  function 箱をつくる(doc, 置き場) {
    var 根 = doc.createElement('div');
    根.className = 'tut-root';
    根.hidden = true;
    // **幕・輪・文は兄弟。**clip-path は子も切るので、入れ子にできない
    根.innerHTML =
      '<div class="tut-veil"></div>' +
      '<div class="tut-ring"></div>' +
      '<div class="tut-say">' +
        '<div class="tut-word"></div>' +
        '<div class="tut-foot"><span class="tut-count"></span>' +
        '<button type="button" class="tut-x" aria-label="とじる">✕</button></div>' +
      '</div>';
    置き場.appendChild(根);
    return 根;
  }

  /**
   * 的を毎回セレクタから引き直す。
   *
   * **`querySelector` では足りない。**画面（`.screen`）は全部いつでもDOMにいて、
   * 見えていないものが `display:none` になっているだけ——
   * だから `.bomb-lives` は手渡し（`#bombLives`）と部屋（`#rtBombLives`）の
   * **2つとも当たる**。先頭を取ると、遊んでいない側の画面を指すことがある。
   *
   * 当たったもの全部から、**大きさを持っている最初の1つ**を選ぶ。
   * これで「画面に出ていない」と「そもそも無い」が同じ扱いになり、
   * どちらも「その手を飛ばす」に落ちる（2-1）
   */
  function 的をさがす(doc, sel) {
    var list;
    try { list = doc.querySelectorAll(sel); } catch (e) { return null; }
    for (var i = 0; i < list.length; i++) {
      var r = list[i].getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return list[i];
    }
    return null;
  }

  function 穴をあける(状態) {
    var win = 状態.win, doc = 状態.doc;
    var el = 的をさがす(doc, 状態.手.的);
    if (!el) return false;
    var r = el.getBoundingClientRect();
    var W = doc.documentElement.clientWidth;
    var H = doc.documentElement.clientHeight;
    var x = Math.max(0, r.left - 余白), y = Math.max(0, r.top - 余白);
    var w = Math.min(W - x, r.width + 余白 * 2), h = Math.min(H - y, r.height + 余白 * 2);
    var k = Math.min(角, w / 2, h / 2);
    // 外枠を時計回り・穴を反時計回りに描き、evenodd で内側を抜く
    var d = 'M0,0 H' + W + ' V' + H + ' H0 Z' +
      ' M' + (x + k) + ',' + y +
      ' H' + (x + w - k) + ' A' + k + ',' + k + ' 0 0 1 ' + (x + w) + ',' + (y + k) +
      ' V' + (y + h - k) + ' A' + k + ',' + k + ' 0 0 1 ' + (x + w - k) + ',' + (y + h) +
      ' H' + (x + k) + ' A' + k + ',' + k + ' 0 0 1 ' + x + ',' + (y + h - k) +
      ' V' + (y + k) + ' A' + k + ',' + k + ' 0 0 1 ' + (x + k) + ',' + y + ' Z';
    状態.幕.style.clipPath = "path(evenodd,'" + d + "')";
    状態.幕.style.webkitClipPath = 状態.幕.style.clipPath;

    状態.輪.style.left = x + 'px'; 状態.輪.style.top = y + 'px';
    状態.輪.style.width = w + 'px'; 状態.輪.style.height = h + 'px';
    状態.輪.style.borderRadius = k + 'px';

    // **文は的の近くに出す。**上半分の的なら下、下半分なら上（重ならない）
    var 下に出す = (r.top + r.height / 2) < H / 2;
    状態.文箱.classList.toggle('is-below', 下に出す);
    if (下に出す) { 状態.文箱.style.top = (y + h + 12) + 'px'; 状態.文箱.style.bottom = 'auto'; }
    else { 状態.文箱.style.bottom = (H - y + 12) + 'px'; 状態.文箱.style.top = 'auto'; }
    return true;
  }

  /**
   * その手を出す。**的があることは、呼ぶ側（`見定める`）が保証している。**
   * ここで飛ばす判断をしない——早すぎる判断が、遅れて現れる的を捨てる
   */
  function 手をおく(状態, i) {
    状態.位置 = i;
    状態.手 = 状態.台本[i];
    状態.根.hidden = false;   // **最初の穴が決まってから出す**（穴の無い真っ黒を見せない）
    状態.語.textContent = 状態.手.文;
    // 残りが見えると、人は最後まで見る
    状態.数.textContent = (i + 1) + ' / ' + 状態.台本.length;
    穴をあける(状態);
    if (状態.待ちタイマ) { 状態.win.clearTimeout(状態.待ちタイマ); 状態.待ちタイマ = null; }
    if (状態.手.待つ === 'auto') {
      // **fxMs() を通さない。**文を読む時間は演出ではない
      状態.待ちタイマ = 状態.win.setTimeout(function () { すすむ(状態); }, 状態.手.秒 * 1000);
    }
  }

  /**
   * 次の手へ移る。**すぐに「無い」と決めない。**
   * 的が現れるのを `猶予` だけ待ち、それでも来なければ飛ばす。
   * 待っている間は**前の手の穴と文がそのまま残る**——
   * 押した直後に問題を待っている状態なので、それが自然な見え方になる
   */
  function 次へ(状態, i) {
    if (!状態.生きている) return;
    if (i >= 状態.台本.length) return 終わる(状態, 'done');
    if (状態.待ちタイマ) { 状態.win.clearTimeout(状態.待ちタイマ); 状態.待ちタイマ = null; }
    状態.待ち = { i: i, 期限: 状態.win.performance.now() + 状態.猶予 };
    見定める(状態);
  }

  /** 待っている手の的が現れたか、待ちきったかを1回だけ見る（毎フレーム呼ばれる） */
  function 見定める(状態) {
    var w = 状態.待ち;
    if (!w) return;
    if (的をさがす(状態.doc, 状態.台本[w.i].的)) {
      状態.待ち = null;
      手をおく(状態, w.i);
      return;
    }
    if (状態.win.performance.now() >= w.期限) {
      状態.待ち = null;
      状態.飛ばした++;
      次へ(状態, w.i + 1);
    }
  }

  function すすむ(状態) {
    if (!状態.生きている) return;
    次へ(状態, 状態.位置 + 1);
  }

  function 見はる(状態) {
    if (!状態.生きている) return;
    if (状態.待ち) {
      // 次の的が現れるのを待っている間は、**前の穴をそのままにする**
      見定める(状態);
    } else if (!穴をあける(状態)) {
      // 出ていた的が消えた（他の人が先に解除した等）→ 次へ
      状態.飛ばした++; すすむ(状態);
    }
    if (!状態.生きている) return;
    状態.こま = 状態.win.requestAnimationFrame(function () { 見はる(状態); });
  }

  function 終わる(状態, 理由) {
    if (!状態.生きている) return;
    状態.生きている = false;
    if (状態.こま) 状態.win.cancelAnimationFrame(状態.こま);
    if (状態.待ちタイマ) 状態.win.clearTimeout(状態.待ちタイマ);
    if (状態.長押しタイマ) 状態.win.clearTimeout(状態.長押しタイマ);
    状態.doc.removeEventListener('click', 状態.押された, true);
    状態.doc.removeEventListener('pointerdown', 状態.押しはじめ, true);
    状態.doc.removeEventListener('pointerup', 状態.押しおわり, true);
    状態.根.hidden = true;
    var 解決 = 状態.解決;
    if (状態 === 状態.親.いまの状態) 状態.親.いまの状態 = null;
    if (解決) 解決({ 理由: 理由, 進んだ: 状態.位置, 全: 状態.台本.length, 飛ばした: 状態.飛ばした });
  }

  var 親 = {
    いまの状態: null,

    /** 置き場（#uiLayerRoot）を受け取る。fx.js の init と同じ形 */
    init: function (o) {
      親.doc = o.doc; 親.win = o.win; 親.置き場 = o.layer;
      // **猶予は外から変えられる。**遊びの数字を検査の都合で縮めない（落とし穴24）——
      // 縮めたいのは検査の側なので、道具の側に早送りの口を作る
      親.猶予 = (typeof o.猶予 === 'number') ? o.猶予 : 既定の猶予;
      return 親;
    },

    台本を調べる: 台本を調べる,

    /** 出ているか（検査とゲーム側の両方が見る） */
    いま: function () {
      var s = 親.いまの状態;
      return s ? { 手: s.位置 + 1, 全: s.台本.length } : null;
    },

    /**
     * 台本を動かす。終わったら理由つきで返る。
     *   'done'   … 最後まで見た
     *   'closed' … 本人が閉じた（＝見たことにする・2-5）
     *   'gone'   … ゲーム側が止めた（退室・通信断。**見たことにしない**）
     */
    start: function (台本, o) {
      o = o || {};
      if (親.いまの状態) 終わる(親.いまの状態, 'gone');
      var 悪い = 台本を調べる(台本);
      if (悪い.length) return Promise.reject(new Error('台本が正しくない：' + 悪い.join(' / ')));
      if (!台本.length) return Promise.resolve({ 理由: 'done', 進んだ: 0, 全: 0, 飛ばした: 0 });

      var doc = 親.doc, win = 親.win;
      if (!親.根 || !親.根.isConnected) 親.根 = 箱をつくる(doc, 親.置き場);
      var 状態 = {
        親: 親, doc: doc, win: win, 台本: 台本, 位置: -1, 手: null,
        生きている: true, こま: null, 待ちタイマ: null, 長押しタイマ: null, 飛ばした: 0,
        待ち: null, 猶予: (typeof 親.猶予 === 'number') ? 親.猶予 : 既定の猶予,
        根: 親.根,
        幕: 親.根.querySelector('.tut-veil'),
        輪: 親.根.querySelector('.tut-ring'),
        文箱: 親.根.querySelector('.tut-say'),
        語: 親.根.querySelector('.tut-word'),
        数: 親.根.querySelector('.tut-count')
      };
      親.いまの状態 = 状態;

      状態.押された = function (e) {
        if (!状態.生きている) return;
        var t = e.target;
        if (t && t.closest && t.closest('.tut-x')) { 終わる(状態, 'closed'); return; }
        if (状態.手 && 状態.手.待つ === 'tap' && t && t.closest && t.closest(状態.手.的)) {
          // **押したあと**に進める。押した結果（問題が出る等）が先に起きる
          win.setTimeout(function () { すすむ(状態); }, 0);
        }
      };
      // 「画面のどこかを長めに押す」でも閉じられる（2-5）
      状態.押しはじめ = function () {
        if (!状態.生きている) return;
        状態.長押しタイマ = win.setTimeout(function () { 終わる(状態, 'closed'); }, 長押し);
      };
      状態.押しおわり = function () {
        if (状態.長押しタイマ) { win.clearTimeout(状態.長押しタイマ); 状態.長押しタイマ = null; }
      };
      doc.addEventListener('click', 状態.押された, true);
      doc.addEventListener('pointerdown', 状態.押しはじめ, true);
      doc.addEventListener('pointerup', 状態.押しおわり, true);

      // **返り先を、動かす前に作る。**
      // 台本の的がどれも画面に無いと、`手をおく` は**その場で最後まで走り抜けて**
      // `終わる` を呼ぶ。Promise を後から作ると、その回だけ誰も返事を受け取れない
      //（門W9 の検査が、返事を待ったまま止まって見つかった）
      var 返り = new Promise(function (res) { 状態.解決 = res; });
      // **最初の手も猶予を通す。**盤が描かれる前に呼ばれても、飛ばさない
      次へ(状態, 0);
      if (状態.生きている) 見はる(状態);
      return 返り;
    },

    /** ゲーム側から止める（退室・通信断・決着）。**見たことにしない** */
    stop: function (理由) {
      if (親.いまの状態) 終わる(親.いまの状態, 理由 || 'gone');
    },

    /** 待つ:'done' の手を、ゲーム側から進める */
    合図: function () {
      var s = 親.いまの状態;
      if (s && s.手 && s.手.待つ === 'done') すすむ(s);
    }
  };

  return 親;
}));
