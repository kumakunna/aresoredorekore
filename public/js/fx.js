// fx.js — 演出の共通部品（第32弾-C）
//
// ---- なぜ必要か ----
// 「カードをめくる」「正解のフラッシュ」「点数のカウントアップ」「順位を1位から出す」は、
// どのカセットにも出てくる。ゲームごとに別々に書くと、片方だけ直して
// もう片方に反映し忘れる事故が必ず起きる（このプロジェクトで何度も踏んだ）。
// だから演出は全部ここに集め、各ゲームからは呼ぶだけにする。
//
// ---- 守っている決めごと ----
// 原則B：スキップできない演出は1つも作らない。
//        待ち時間は必ず hold() を通す。hold() は画面のどこかを触れば即座に終わる。
//        「演出の速さ」設定（32-B）は ms() 1か所で効かせる。
// 原則C：褒める時は全力（banner＝画面いっぱい）、責める時は静か（flash('bad')＝0.15秒）。
//        だから banner に 'bad' は無い。作れないようにしてある。
// 原則D：何も起きていない時間には alive()（ごく控えめな脈）を出す。
// 原則E：切断・復帰は notice()。慌てさせないよう、音も振動も鳴らさない。

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FxKit = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var cfg = {
    doc: null,
    root: null,                       // **揺らす箱**（#app）。shake だけがここを使う
    layer: null,                      // **重ねる層**（#uiLayerRoot）。画面いっぱいの演出はここ
    ms: function (n) { return n; },   // 演出の速さ設定を通す関数
    sound: {},                        // { good, bad, tick, big, cheer } 無くてよい
    vibrate: function () {},
    // 第32弾-D 第4部：安全に関する設定。「今の設定」を返す関数を渡してもらう
    //（設定を切り替えた瞬間から効くように、値ではなく関数で持つ）
    can: { flash: function () { return true; }, shake: function () { return true; } }
  };

  // ---------- スキップ ----------
  // 待っている演出をここに積む。画面を触ったら全部いっぺんに終わらせる。
  // 「今の演出だけ」ではなく全部にしているのは、2周目の人が
  // 連なった演出を1つずつ叩いて飛ばすはめになるのを避けるため。
  var waiters = [];
  // 指がいま画面に触れているか（init が pointerdown/up で書く）。
  // 待ち は「指が離れたら呼ぶ」関数の列
  var 指 = { 下りている: false, 待ち: [] };

  function skipNow() {
    var list = waiters.slice();
    waiters.length = 0;
    list.forEach(function (f) { f(true); });
    return list.length;
  }
  function busy() { return waiters.length > 0; }

  /**
   * 演出の待ち時間。setTimeout の代わりにこれを使う。
   * 返り値は「スキップされたか」。演出を短縮したい側が見られるようにしてある。
   */
  function hold(ms) {
    return 待つ(cfg.ms(ms == null ? 0 : ms));
  }
  /**
   * **速さの設定では縮まない。タップでは必ず終わる**待ち（指示60 A-1a①）。
   *
   * 「爆発しました」のあと「2秒待つか、押すか」で結果へ進む——
   * これは**スキップ設定の人にも**効かせる約束なので、`hold` は使えない
   * （`hold` はスキップで 0 になり、一度も読めないまま結果へ飛ぶ）。
   * `beat`（3-2-1）とも違う：あちらはタップでも縮まない合図。
   * ここは原則B（すべての演出はスキップできる）の内側——**押せば終わる**。
   * 中身は hold と同じ1本（`待つ`）を分け合う（写すと片方だけ直す日が来る・落とし穴1）
   */
  function linger(ms) {
    return 待つ(ms == null ? 0 : ms);
  }
  function 待つ(t) {
    return new Promise(function (resolve) {
      if (!(t > 0)) return resolve(true);
      var done = false;
      var timer = setTimeout(function () { finish(false); }, t);
      function finish(skipped) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        var i = waiters.indexOf(finish);
        if (i >= 0) waiters.splice(i, 1);
        resolve(skipped);
      }
      waiters.push(finish);
    });
  }

  // ---------- 土台 ----------
  //
  // **置き場は2つある。混ぜてはいけない**（第47弾）。
  //
  //   host()  … アプリ本体の箱（#app）。**揺らす相手**。
  //             画面そのものを揺らすので、ここでなければ意味がない
  //   layer() … 画面いっぱいに重ねるものの置き場（#uiLayerRoot）。
  //             閃光・帯・黒い幕・クリア演出・紙吹雪・巨大カウントダウン・通知・飛ぶ印
  //
  // **なぜ分けたか。** #app は `filter:brightness(...)` と `max-width:460px` を持つ。
  //   ・filter があると `position:fixed` の基準が #app になる（落とし穴26）
  //   ・max-width があると、TVやPCで**画面いっぱいの演出が中央460pxの柱**になる
  // 第39弾で UiKit だけを外へ出し、FxKit は取り残されていた。
  //
  // layer が渡されていない時は host に落ちるので、**古い呼び方でも動く**。
  function doc() { return cfg.doc || (typeof document !== 'undefined' ? document : null); }
  function host() {
    return cfg.root || (doc() ? doc().getElementById('app') || doc().body : null);
  }
  function layer() {
    if (cfg.layer) return cfg.layer;
    var d = doc();
    return (d && d.getElementById('uiLayerRoot')) || host();
  }
  function mk(cls, html) {
    var d = doc();
    if (!d) return null;
    var n = d.createElement('div');
    n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function play(name) {
    var f = cfg.sound && cfg.sound[name];
    if (typeof f === 'function') { try { f(); } catch (e) {} }
  }
  function buzzIt(p) { try { cfg.vibrate(p); } catch (e) {} }

  function init(opt) {
    opt = opt || {};
    if (opt.doc) cfg.doc = opt.doc;
    if (opt.root) cfg.root = opt.root;
    if (opt.layer) cfg.layer = opt.layer;
    if (typeof opt.ms === 'function') cfg.ms = opt.ms;
    if (opt.sound) cfg.sound = opt.sound;
    if (typeof opt.vibrate === 'function') cfg.vibrate = opt.vibrate;
    if (opt.can) cfg.can = Object.assign(cfg.can, opt.can);
    var d = doc();
    if (d && !init._bound) {
      // 画面のどこを触ってもスキップ。押した内容は殺さない
      //（ボタンを押しながら演出を飛ばす、が同時に起きてよい）
      d.addEventListener('pointerdown', function () {
        指.下りている = true;
        if (busy()) skipNow();
      }, true);
      // 指が離れた瞬間を覚える（黒い幕を上げる時に、同じタップの click を
      // 幕の後ろのボタンへ落とさないため。指示60 A-1a①）
      var 離れた = function () {
        指.下りている = false;
        var q = 指.待ち.slice(); 指.待ち.length = 0;
        q.forEach(function (f) { f(); });
      };
      d.addEventListener('pointerup', 離れた, true);
      d.addEventListener('pointercancel', 離れた, true);
      init._bound = true;
    }
    return api;
  }

  // ---------- 原則C：責める時は静かに ----------
  /**
   * 画面全体のフラッシュ。
   * 'bad' は0.15秒・薄め。みんなの前で恥をかかせないための長さと明るさ。
   */
  var FLASH_MS = { good: 420, bad: 150, gold: 700, gray: 500 };
  function flash(kind) {
    var h = layer();
    if (!h) return Promise.resolve(true);
    // **設定の「光の点滅」を、ここでも見る**（第43弾）。
    // それまで cfg.can.flash を渡していたのに、**読む行が1つも無かった**——
    // 効いていたのはCSSの1行（.app.no-flash .fx-flash{display:none}）だけで、
    // 音と振動（下の play/vibe）は切っても鳴っていた。
    // 揺れ（shake）は同じ形の門を持っている。片方だけ持っている状態だった（落とし穴1）
    if (cfg.can.flash && !cfg.can.flash()) return Promise.resolve(true);
    var k = FLASH_MS[kind] ? kind : 'good';
    var n = mk('fx-flash fx-flash-' + k);
    if (!n) return Promise.resolve(true);
    h.appendChild(n);
    // 原則C：責める時は静かに。外れの振動はいちばん軽い型にする
    if (k === 'bad') { play('bad'); vibe('tick'); }
    else { play('good'); }
    return 前座に乗せる(hold(FLASH_MS[k]).then(function (skipped) {
      if (n.parentNode) n.parentNode.removeChild(n);
      return skipped;
    }));
  }

  /**
   * 爆発の閃光（第47弾でここへ集めた）。
   *
   * **それまで同じ11行が2か所に手書きされていた**——手渡し／部屋の `bombBoomFx` と、
   * 大画面の `rtBigFx`。まさに落とし穴1の形で、片方だけ直す日が来る。
   * 置き場を #app から層へ移す時に、2か所とも直す必要が出て気づいた。
   *
   * `flash()` と同じ門を通す（設定で「光の点滅」を切っている人には出さない）。
   * CSS 側の `:root.no-flash .bomb-boom{display:none}` は二重の守り——
   * どちらか片方だけにすると、呼ぶ道が増えた日に漏れる（落とし穴10-h）。
   */
  function boom() {
    var h = layer();
    if (!h) return Promise.resolve(true);
    if (cfg.can.flash && !cfg.can.flash()) return Promise.resolve(true);
    var n = mk('bomb-boom');
    if (!n) return Promise.resolve(true);
    h.appendChild(n);
    return 前座に乗せる(hold(700).then(function (skipped) {
      if (n.parentNode) n.parentNode.removeChild(n);
      return skipped;
    }));
  }

  /**
   * 夜が明ける（第47弾 47-6）。**大画面のための、ゆっくりした一度きりの明るさ**。
   *
   * 藍色の夜から、朝焼けの色が下から差してきて、引いていく。
   * 正本§4 の「長（0.75秒）＝見せ場」に合わせた尺。
   *
   * **点滅ではない。**明るさが一方向にゆっくり動いて戻るだけで、
   * 正本§6 の「全画面の明滅は1回だけ」を満たす。
   * それでも「光の点滅をつかう」を切っている人には出さない——
   * 夜が明けたことは配色そのものが伝えるので、これが無くても分からなくならない。
   */
  function dawn() {
    var h = layer();
    if (!h) return Promise.resolve(true);
    if (cfg.can.flash && !cfg.can.flash()) return Promise.resolve(true);
    var n = mk('fx-dawn');
    if (!n) return Promise.resolve(true);
    h.appendChild(n);
    return 前座に乗せる(hold(750).then(function (skipped) {
      if (n.parentNode) n.parentNode.removeChild(n);
      return skipped;
    }));
  }

  // ---------- 原則C：褒める時は全力で ----------
  /**
   * 画面いっぱいの演出。正解・勝利・成功の瞬間だけに使う。
   * kind に 'bad' は無い。責める側でこれを使えないようにしてある。
   *   opt: { text, sub, icon, kind:'good'|'gold'|'gray'|'plain', ms }
   */
  // ---------- 第45弾 45-2：画面いっぱいの演出を、順番に出す ----------
  /**
   * **同時に起きたことは、順番に見せる。**
   *
   * テストプレイで「爆発」の帯の上に「新しく手に入れた！解除班の証」が半透明で重なり、
   * どちらも読めなかった。どちらも `rtRenderCurrent` の同じ1回のパスから出る。
   *
   * ここで大事なのは、**個別に「爆発の後に称号」と書かないこと**（落とし穴4）。
   * 書くと、演出を1つ足すたびに順序も1つ足すことになる。
   * 代わりに、演出の**性質**を2つに分ける：
   *
   *   ・結果（既定）… 決着・爆発・勝敗。舞台が空いていれば、その場で出る
   *   ・褒める（`praise:true`）… 称号・お祝い。**必ず1拍おいてから**舞台の空きを待つ
   *
   * 「褒めるのは静まってから」（大切なこと7）が、順序そのものになっている。
   * 同じ間（tick）に両方が起きても、褒める側が1拍おくので結果が先に舞台へ上がる。
   *
   * **舞台が空いている時は、その場で（同期で）出す。**
   * 遅らせると「出した直後に数える」検査が捕まえられなくなるし、
   * 演出が一拍遅れて見える（落とし穴10-g の裏返し）。
   */
  var 舞台 = { 走っている: false, 待ち: [] };
  function 走らせる(fn) {
    舞台.走っている = true;
    var p;
    try { p = fn(); } catch (e) { p = null; }
    return Promise.resolve(p).catch(function () { return true; }).then(function (v) {
      舞台.走っている = false;
      if (舞台.待ち.length) setTimeout(次へ, 0);
      return v;
    });
  }
  function 次へ() {
    if (舞台.走っている || !舞台.待ち.length) return;
    // **褒めるのは、前座も済んでから**（指示60 A-1a②）。
    // 前座＝舞台を通らない画面いっぱいの演出（💥・閃光・紙吹雪・縁・黒い幕）。
    // それまで舞台は「走っているもの」と「待ち行列」しか見ていなかったので、
    // 💥の最中は舞台が空いて見え、称号が1拍で割り込んでいた（実機で報告）。
    // **「爆発の後に称号」とは書かない**——前座かどうかは演出の性質で決まる
    if (舞台.待ち[0].褒める && 前座.札.length) return;
    var x = 舞台.待ち.shift();
    走らせる(x.fn).then(x.resolve, x.resolve);
  }
  // ---------- 前座（指示60 A-1a②） ----------
  /**
   * 舞台を通らずにその場で出る、画面いっぱいの演出を数える。
   * 結果（帯・シャッター・クリア演出）は前座を待たない——
   * 💥と「爆発しました」、閃光と「解除成功！」は、今までどおりの順で出る。
   * 待つのは「褒める」だけ。前座がみんな降りたら、舞台をもう一度見る
   */
  var 前座 = { 札: [] };
  function 前座に乗せる(p) {
    var 札 = {};
    前座.札.push(札);
    function 降りる() {
      var i = 前座.札.indexOf(札);
      if (i >= 0) 前座.札.splice(i, 1);
      if (!前座.札.length && 舞台.待ち.length) setTimeout(次へ, 0);
    }
    Promise.resolve(p).then(降りる, 降りる);
    return p;
  }
  function stage(fn, opt) {
    var 褒める = !!(opt && opt.praise);
    if (!褒める && !舞台.走っている) return 走らせる(fn);
    return new Promise(function (resolve) {
      var 札 = { fn: fn, resolve: resolve, 褒める: 褒める };
      // **結果は、待っている「褒める」を追い越す。**
      // 追い越さないと、決着の帯が2つ続く場面（爆発 → 順位）で
      // 2つ目が称号の後ろに回り、「褒めてから、まだ結果が続く」形になる。
      // 順序の決めごとは1つだけ——**褒めるのは、結果が全部済んでから**
      var i = 舞台.待ち.length;
      if (!褒める) { while (i > 0 && 舞台.待ち[i - 1].褒める) i--; }
      舞台.待ち.splice(i, 0, 札);
      if (!舞台.走っている) setTimeout(次へ, 0);
    });
  }
  /**
   * 舞台を空にする。ゲームを捨てる時に呼ぶ（前の試合の演出を持ち越さない）。
   * 前座の札も捨て、黒い幕が下りていたら上げる（黒いまま棚に出ない）
   */
  function stageClear() {
    舞台.待ち.length = 0; 舞台.走っている = false;
    前座.札.length = 0;
    if (幕.いま) 幕.いま.片付ける();
  }
  /** いま舞台に何が乗っているか（検査用） */
  function stageState() {
    return { 走っている: 舞台.走っている, 待ち: 舞台.待ち.length,
      前座: 前座.札.length, 幕: !!幕.いま };
  }

  // ---------- 黒い幕（指示60 A-1a①） ----------
  /**
   * **💥と同じ瞬間に、画面を黒で覆う。**戻り値は「幕を上げる」関数。
   *
   * 実機で「爆発の💥の後ろに、もう結果画面が透けて見える」と報告された。
   * 部屋と大画面では、結果が💥と**同じ回の描画**で描かれ、
   * しかも💥の層（.fx-burst）に背景が無かったから。
   *
   *   ・**入りのアニメーションを持たない**——出た瞬間から不透明。
   *     0.25秒かけて入ると、その間だけ結果が透ける（直したい症状そのもの）
   *   ・**光を弱くする設定でも出す**——光の変化ではなく、隠すための幕。
   *     止めると、その設定の人にだけ結果が透ける（落とし穴1の形）。burst と同じ判断
   *   ・**後ろのボタンは押させない**（pointer-events:auto）。見えない「部屋を出る」を
   *     押せてしまうのを防ぐ。タップは document のキャプチャが拾うので、スキップは効く
   *   ・下りている間は**前座**に数える（称号が幕の上に割り込まない）
   *   ・二重には下ろさない。下りていれば、同じ「上げる」を返す
   *
   * **上げる時**：指がまだ触れていたら離れるまで待ち、少しおいてから引く。
   * 先に消すと、幕を上げたのと同じタップの click が、結果画面のボタン
   * （「もう一度」「部屋を出る」）に落ちる（ゴーストクリック）
   */
  var 幕 = { いま: null };
  function blackout() {
    if (幕.いま) return 幕.いま.上げる;
    var h = layer();
    var n = h ? mk('fx-blackout') : null;
    if (!n) return function () { return Promise.resolve(true); };
    h.appendChild(n);
    var 降りた;
    var 下りている = new Promise(function (r) { 降りた = r; });
    前座に乗せる(下りている);
    var 上げ中 = null;
    var me = {
      片付ける: function () {
        if (n.parentNode) n.parentNode.removeChild(n);
        if (幕.いま === me) 幕.いま = null;
        降りた(true);
      },
      上げる: function () {
        if (上げ中) return 上げ中;
        上げ中 = 指が離れるまで().then(function () {
          n.classList.add('fx-out');
          return hold(250);
        }).then(function () { me.片付ける(); return true; });
        return 上げ中;
      }
    };
    幕.いま = me;
    return me.上げる;
  }
  /**
   * 指が離れて、同じタップの click が済むまで待つ。
   * 触れていなければすぐ返る。**触れっぱなしでも 800ms で見切る**
   * （pointerup が来ない環境で幕が永久に下りたままになるのを防ぐ）
   */
  function 指が離れるまで() {
    return new Promise(function (resolve) {
      var done = false;
      function 済む() { if (done) return; done = true; setTimeout(resolve, 60); }
      if (!指.下りている) return resolve();
      指.待ち.push(済む);
      setTimeout(済む, 800);
    });
  }

  /** banner と shutter が共有する中身（icon/text/sub/skip案内）の組み立て（第59弾） */
  function bannerInnerHtml(opt) {
    // `linger` の帯は、スキップ設定の人にも2秒出る。**その人にも「押せば進む」を見せる**
    //（ふつうの案内はスキップ設定では隠す：もう出ていないので）。印は is-always
    var 案内 = opt.linger != null
      ? '<div class="fx-banner-skip is-always">タップで結果へ</div>'
      : '<div class="fx-banner-skip">タップでとばす</div>';
    return (opt.icon ? '<div class="fx-banner-icon">' + opt.icon + '</div>' : '') +
      '<div class="fx-banner-text">' + esc(opt.text || '') + '</div>' +
      (opt.sub ? '<div class="fx-banner-sub">' + esc(opt.sub) + '</div>' : '') +
      案内;
  }
  function banner(opt) {
    return stage(function () { return bannerNow(opt); }, opt);
  }
  function bannerNow(opt) {
    opt = opt || {};
    var h = layer();
    if (!h) return Promise.resolve(true);
    var kind = opt.kind || 'good';
    var n = mk('fx-banner fx-banner-' + kind);
    if (!n) return Promise.resolve(true);
    n.innerHTML = bannerInnerHtml(opt);
    h.appendChild(n);
    if (kind === 'gold' || kind === 'good') { play('big'); vibe('ok'); }
    else if (kind === 'gray') { play('bad'); }
    // 出てすぐ消えないよう、入りの分だけは必ず見せる
    return hold(opt.ms == null ? 800 : opt.ms).then(function (skipped) {
      n.classList.add('fx-out');
      return hold(120).then(function () {
        if (n.parentNode) n.parentNode.removeChild(n);
        return skipped;
      });
    });
  }

  /**
   * 大きな絵文字が、大きさだけで伝える（第59弾）。
   * 「大きく→少し小さく→大きく」の拡大縮小だけで、点滅・明滅はしない。
   * `flash`・`boom` と違って `cfg.can.flash` を通さない——
   * 光ではなく大きさの変化なので、光の点滅を切っている人にも同じように出す（安全基準§6の対象外）
   */
  function burst(icon, ms) {
    var h = layer();
    if (!h) return Promise.resolve(true);
    var n = mk('fx-burst', '<div class="fx-burst-icon">' + esc(icon || '💥') + '</div>');
    if (!n) return Promise.resolve(true);
    h.appendChild(n);
    return 前座に乗せる(hold(ms == null ? 800 : ms).then(function (skipped) {
      if (n.parentNode) n.parentNode.removeChild(n);
      return skipped;
    }));
  }

  /**
   * 上から一気に落ちて、少し跳ねて止まる帯（第59弾）。
   * 中身（icon/text/sub）は `banner` と同じ組み立てを使う——違うのは出方だけ
   * （沸き出る vs 落ちてくる）。責める場面にも使うので、banner と違い kind:'bad' の縛りは無い
   */
  function shutter(opt) {
    return stage(function () { return shutterNow(opt); }, opt);
  }
  function shutterNow(opt) {
    opt = opt || {};
    var h = layer();
    if (!h) return Promise.resolve(true);
    var kind = opt.kind || 'gray';
    var n = mk('fx-banner fx-shutter fx-banner-' + kind);
    if (!n) return Promise.resolve(true);
    n.innerHTML = bannerInnerHtml(opt);
    h.appendChild(n);
    if (kind === 'gold' || kind === 'good') { play('big'); vibe('ok'); }
    else if (kind === 'gray') { play('bad'); }
    // `linger` を渡されたら、速さの設定で縮めない（タップでは終わる）。指示60 A-1a①
    var 待ち = opt.linger != null ? linger(opt.linger) : hold(opt.ms == null ? 800 : opt.ms);
    return 待ち.then(function (skipped) {
      n.classList.add('fx-out');
      return hold(120).then(function () {
        if (n.parentNode) n.parentNode.removeChild(n);
        return skipped;
      });
    });
  }

  // ---------- カードをめくる ----------
  /**
   * 裏から表へ。中身の差し替えは「一番裏を向いた瞬間」に渡した関数でやる
   * （先に差し替えると、めくる前に答えが見えてしまう）。
   */
  function flip(node, onHalf, ms) {
    if (!node) return Promise.resolve(true);
    var half = (ms == null ? 300 : ms) / 2;
    node.classList.remove('fx-flip-a', 'fx-flip-b');
    void node.offsetWidth;
    node.classList.add('fx-flip-a');
    play('tick');
    return hold(half).then(function () {
      if (typeof onHalf === 'function') { try { onHalf(); } catch (e) {} }
      node.classList.remove('fx-flip-a');
      node.classList.add('fx-flip-b');
      return hold(half);
    }).then(function (skipped) {
      node.classList.remove('fx-flip-a', 'fx-flip-b');
      return skipped;
    });
  }

  // ---------- 点数のカウントアップ ----------
  /**
   * 数字が増えていくのを見せる。「増えた」ことが分かるのが目的なので、
   * 途中の値そのものには意味がない。スキップされたら最終値をすぐ出す。
   */
  function countUp(node, from, to, ms) {
    if (!node) return Promise.resolve(true);
    var span = cfg.ms(ms == null ? 600 : ms);
    var a = Number(from) || 0, b = Number(to) || 0;
    if (!(span > 0) || a === b) { node.textContent = String(b); return Promise.resolve(true); }
    var steps = Math.min(24, Math.max(6, Math.abs(b - a)));
    var i = 0;
    node.classList.add('fx-counting');
    return new Promise(function (resolve) {
      var done = false;
      var timer = setInterval(function () {
        i++;
        node.textContent = String(Math.round(a + (b - a) * (i / steps)));
        if (i >= steps) finish(false);
      }, span / steps);
      function finish(skipped) {
        if (done) return;
        done = true;
        clearInterval(timer);
        var k = waiters.indexOf(finish);
        if (k >= 0) waiters.splice(k, 1);
        node.textContent = String(b);
        node.classList.remove('fx-counting');
        resolve(skipped);
      }
      waiters.push(finish);
    });
  }

  // ---------- 順に出す（順位発表・コードの点灯など） ----------
  /**
   * 渡した要素を、頭から1つずつ見せる。
   * 順位発表は「1位から順に」なので、1位を先頭にした配列で渡す。
   */
  var TICK_MAX = 8;
  function stagger(nodes, gap, cls) {
    var list = Array.prototype.slice.call(nodes || []);
    var c = cls || 'fx-in';
    var g = gap == null ? 120 : gap;
    // たくさん並ぶ時は、1つずつ音を鳴らさない。
    // 30個のコードが点灯するだけで30回鳴ることになり、うるさいだけで何も伝わらない。
    // 数えられるくらいの数（順位発表など）の時だけ、1つずつ鳴らす。
    var tickable = list.length <= TICK_MAX;
    list.forEach(function (n) { if (n && n.classList) n.classList.remove(c); });
    var p = Promise.resolve(true);
    list.forEach(function (n, i) {
      p = p.then(function () {
        return hold(i === 0 ? 0 : g).then(function (s) {
          if (n && n.classList) n.classList.add(c);
          if (i > 0 && tickable) play('tick');
          return s;
        });
      });
    });
    return p.then(function (s) {
      // スキップされた時に途中で止まらないよう、最後は必ず全部出す
      list.forEach(function (n) { if (n && n.classList) n.classList.add(c); });
      return s;
    });
  }

  // ---------- 票が飛ぶ ----------
  /**
   * 小さな印が、投票した人から投票された人の名前へ飛ぶ。
   * 人狼とワードウルフの両方が使う。片方だけ直す事故を防ぐため共通にしてある。
   */
  function fly(fromEl, toEl, label) {
    var h = layer();
    var d = doc();
    if (!h || !d || !fromEl || !toEl || !fromEl.getBoundingClientRect) return hold(100);
    var a = fromEl.getBoundingClientRect();
    var b = toEl.getBoundingClientRect();
    // **ラベルは文字として入れる（第47弾 47-6b）。**
    // `mk` の第2引数は innerHTML なので、ここに人の名前を渡すと
    // 名前に書いたHTMLがそのまま動く。サーバーは名前を trim() しかしていない。
    // 呼ぶ道が1つも無いうちに見つけたので実害は出ていないが、
    // **これから呼ぶ**ので、先に塞ぐ（大切なこと10：誰もが守られる状態にする）
    var n = mk('fx-fly');
    if (!n) return hold(100);
    n.textContent = (label == null) ? '●' : String(label);
    n.style.left = (a.left + a.width / 2) + 'px';
    n.style.top = (a.top + a.height / 2) + 'px';
    n.style.setProperty('--fx-dx', ((b.left + b.width / 2) - (a.left + a.width / 2)) + 'px');
    n.style.setProperty('--fx-dy', ((b.top + b.height / 2) - (a.top + a.height / 2)) + 'px');
    h.appendChild(n);
    void n.offsetWidth;
    n.classList.add('fx-fly-go');
    play('tick');
    return hold(260).then(function (skipped) {
      if (n.parentNode) n.parentNode.removeChild(n);
      if (toEl.classList) {
        toEl.classList.add('fx-hit');
        setTimeout(function () { if (toEl.classList) toEl.classList.remove('fx-hit'); }, 220);
      }
      return skipped;
    });
  }

  // ---------- 原則D：待っている時間 ----------
  /**
   * 「止まっていない」ことだけを伝える、ごく控えめな脈。
   * 見た目はカセットのテーマ側（CSSの .theme-◯◯ .fx-alive）で変える。
   */
  function alive(node, on) {
    if (!node || !node.classList) return;
    node.classList.toggle('fx-alive', on !== false);
  }

  // ---------- 原則E：切断・復帰 ----------
  /**
   * 控えめな通知。慌てさせないよう、音も振動も鳴らさない。
   * 進行は止めない（呼んだ側は返り値を待たなくてよい）。
   */
  var noticeTimer = null;
  function notice(text, kind) {
    var h = layer();
    if (!h) return;
    var d = doc();
    var box = d.getElementById('fxNotices');
    if (!box) {
      box = mk('fx-notices');
      if (!box) return;
      box.id = 'fxNotices';
      h.appendChild(box);
    }
    var n = mk('fx-notice' + (kind ? ' fx-notice-' + kind : ''), esc(text));
    if (!n) return;
    box.appendChild(n);
    void n.offsetWidth;
    n.classList.add('fx-in');
    setTimeout(function () {
      n.classList.remove('fx-in');
      setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 300);
    }, 2600);
    // 積みすぎない。同時に何人も落ちた時に画面を埋めない
    while (box.children.length > 3) box.removeChild(box.firstChild);
  }

  // ---------- 第32弾-D 4-1：画面の揺れ ----------
  /**
   * 衝撃の大きい瞬間に、画面全体が一瞬だけ揺れる。
   * 0.2秒以内・1回だけ。繰り返さない（乗り物酔いのような不快感を避ける）。
   * 「画面の揺れをつかう」を切っている人には出さない。
   *   strength: 'big' なら少し大きく（爆発など）。省略でふつう
   */
  /**
   * **画面の縁を、全周ひとまわり光らせる**（指示55・正本 §11-5）。
   *
   * 大画面だからできる知らせ。面は塗らない——正本 §6 は「赤は縁のみ」。
   * 1回きりで、`fxMs` の刻みに乗るのでスキップも「速い」も効く。
   *
   * `kind` は 'danger'（赤・ライフが減った）／'village'／'wolf'／'third'（陣営の色）。
   * **置き場は層（#uiLayerRoot）**——`#app` は明るさ補正の `filter` を持っているので、
   * そこに `position:fixed` を置くと画面ではなくページの座標になる（落とし穴26）。
   *
   * それまで人狼の陣営色だけが index.html に個別実装されていた（`flashRoleEdge`）。
   * **演出は fx.js に足す**のが決まり（CLAUDE.md §4）なので、ここへ寄せた
   */
  function edge(kind) {
    var L = layer();
    if (!L) return Promise.resolve(true);
    if (cfg.can.flash && !cfg.can.flash()) return Promise.resolve(true);
    var n = mk('fx-edge fx-edge-' + (kind || 'danger'));
    if (!n) return Promise.resolve(true);
    L.appendChild(n);
    return 前座に乗せる(hold(300).then(function (skipped) {
      if (n.parentNode) n.parentNode.removeChild(n);
      return skipped;
    }));
  }

  function shake(strength) {
    var h = host();
    if (!h) return Promise.resolve(true);
    if (cfg.can.shake && !cfg.can.shake()) return Promise.resolve(true);
    var cls = strength === 'big' ? 'fx-shake-big' : 'fx-shake';
    h.classList.remove('fx-shake', 'fx-shake-big');
    void h.offsetWidth;
    h.classList.add(cls);
    return hold(200).then(function (skipped) {
      h.classList.remove(cls);
      return skipped;
    });
  }

  // ---------- 第32弾-D 4-2：紙吹雪・光の粒子 ----------
  /**
   * 一番の勝利の瞬間だけに使う。1ラウンド勝った程度では使わない
   * （使いすぎると安っぽくなる）。色はカセットのテーマに合わせて渡す。
   * 歓声（4-3）もここで重ねる：実際には無音のはずの瞬間に、
   * その場にいる人数分の歓声があるような感覚を足す。
   */
  function confetti(colors) {
    var h = layer();
    var d = doc();
    if (!h || !d) return Promise.resolve(true);
    var box = mk('fx-confetti');
    if (!box) return Promise.resolve(true);
    var palette = (colors && colors.length) ? colors : ['#f0c44a', '#3fbfa5', '#e2584a', '#5a8fd6'];
    for (var i = 0; i < 54; i++) {
      var p = d.createElement('i');
      p.style.left = (Math.random() * 100) + '%';
      p.style.background = palette[i % palette.length];
      p.style.animationDelay = (Math.random() * 0.5) + 's';
      p.style.animationDuration = (1.1 + Math.random() * 0.9) + 's';
      p.style.setProperty('--fx-cx', ((Math.random() * 2 - 1) * 60) + 'px');
      p.style.setProperty('--fx-cr', ((Math.random() * 2 - 1) * 540) + 'deg');
      box.appendChild(p);
    }
    h.appendChild(box);
    play('cheer');
    return 前座に乗せる(hold(1800).then(function (skipped) {
      if (box.parentNode) box.parentNode.removeChild(box);
      return skipped;
    }));
  }

  // ---------- 第32弾-D 第2部：テキストコールアウト（指示60 で削除） ----------
  // 緊張が高まる瞬間の英単語（TIEBREAKER / DEFUSED など）を大画面に出す部品があった。
  // 本人の決定で通常では使わないことになり、呼び出し13か所ごと消した
  //（チャンピオンシップ用には作り直すので、今の仕組みは残さない）。
  // 13か所それぞれを何で知らせ直したかは docs/監査_指示60の門.md の表。
  // **ここに戻さない**——tests/fx.js「60 コールアウトの部品・文字列は0件」が赤くなる

  // ---------- 指示60 A-2：クリア演出 ----------
  /**
   * **そのゲームの「クリア」を、そのゲームの世界で祝う。**
   * ゲームは「絵・色・言葉」を渡すだけ。動きの種類はここにしか無い
   * （ゲームの中に演出を直書きしない・CLAUDE.md §4）。
   *
   * 紙吹雪（confetti）の色を変えるだけでは、どのカセットも同じ祝い方になる
   * （指示60 §5 の禁止）。そこで**主役の出方**と**舞うもの**を、世界ごとに選べるようにした。
   *
   *   opt.motion … 主役の出方
   *     'flip'   札がめくれて表が出る（icons:[裏, 表]）
   *     'evolve' 絵が下から順に入れ替わり、最後の形で大きく止まる（icons:[…]）
   *     'stamp'  上から押される。opt.seal を渡すと、絵の代わりに朱の印（字）を押す
   *     'drop'   上から降りてきて、少し跳ねて止まる
   *     'rise'   下から昇ってくる（日の出・月の出）
   *     'pop'    その場で大きく弾ける（既定）
   *   opt.icon / opt.icons … 主役の絵
   *   opt.pieces … 舞うもの：'spark'（中心から散る火花）'card'（字の書いた札）
   *                'coin'（金貨）'washi'（和紙の片）'tape'（紙テープ）。省略で無し
   *   opt.words  … 'card' の札に書く字（順に使い回す）
   *   opt.colors … 舞うものの色
   *   opt.bg     … 地 [内, 外]（世界の色。不透明に近い値を渡す）
   *   opt.ink    … 文字の色
   *   opt.text / opt.sub … 言葉（大画面では二人称を使わないのは呼ぶ側の約束）
   *   opt.ms     … 見せる長さ（既定 1700。速さの設定に従う）
   *
   * 守っていること：
   *   ・**結果の前に出る**（舞台を通る。結果の帯と同じ性質＝称号はこの後）
   *   ・**地は出た瞬間から不透明**——後ろで結果が描かれていても透けない（A-1a① と同じ理由）
   *   ・**点滅しない**。光（主役の後ろの輪）は1回ふわっと出るだけで、
   *     光を弱くする設定では出さない。**大きさと動き（主役・舞うもの）は、その設定でも出す**
   *   ・スキップ設定なら何も描かずにすぐ返る（＝すぐ結果）。タップでも終わる
   *   ・後ろのボタンは押させない。片付ける時は、指が離れるのを待つ（ゴーストクリック）
   */
  var CEL_MOTIONS = ['flip', 'evolve', 'stamp', 'drop', 'rise', 'pop'];
  var CEL_PIECES = { spark: 28, card: 16, coin: 20, washi: 26, tape: 24 };
  function celebrate(opt) {
    return stage(function () { return celebrateNow(opt); }, opt);
  }
  function celebrateNow(opt) {
    opt = opt || {};
    var h = layer();
    var 後ろで = function () {
      if (typeof opt.behind === 'function') { try { opt.behind(); } catch (e) {} }
      return Promise.resolve(true);
    };
    if (!h) return 後ろで();
    // スキップ設定：一度も描かずに返す（結果がすぐ見える）
    if (!(cfg.ms(1000) > 0)) return 後ろで();
    var motion = CEL_MOTIONS.indexOf(opt.motion) >= 0 ? opt.motion : 'pop';
    var n = mk('fx-cel fx-cel-' + motion);
    if (!n) return 後ろで();
    var bg = opt.bg || ['rgba(52,56,68,.97)', 'rgba(16,18,23,.97)'];
    n.style.setProperty('--fx-cel-in', bg[0]);
    n.style.setProperty('--fx-cel-out', bg[1] || bg[0]);
    if (opt.ink) n.style.setProperty('--fx-cel-ink', opt.ink);
    if (opt.glow) n.style.setProperty('--fx-cel-glow', opt.glow);
    var icons = (opt.icons && opt.icons.length) ? opt.icons.slice() : [opt.icon || '🏆'];
    var 主役;
    if (motion === 'flip') {
      主役 = '<div class="fx-cel-card">' +
        '<div class="fx-cel-face fx-cel-back">' + esc(icons[0]) + '</div>' +
        '<div class="fx-cel-face fx-cel-front">' + esc(icons[icons.length - 1]) + '</div></div>';
    } else if (motion === 'stamp' && opt.seal) {
      主役 = '<div class="fx-cel-seal">' + esc(opt.seal) + '</div>';
    } else {
      主役 = '<div class="fx-cel-icon">' + esc(icons[0]) + '</div>';
    }
    n.innerHTML = '<div class="fx-cel-glow"></div><div class="fx-cel-pieces"></div>' +
      '<div class="fx-cel-hero">' + 主役 + '</div>' +
      '<div class="fx-cel-text">' + esc(opt.text || '') + '</div>' +
      (opt.sub ? '<div class="fx-cel-sub">' + esc(opt.sub) + '</div>' : '') +
      '<div class="fx-banner-skip">タップでとばす</div>';
    舞わせる(n.querySelector('.fx-cel-pieces'), opt);
    h.appendChild(n);
    play('big'); vibe('ok');
    if (opt.pieces) play('cheer');

    var 長さ = opt.ms == null ? 1700 : opt.ms;
    var p;
    if (motion === 'evolve' && icons.length > 1) {
      // 1段ずつ入れ替える。**途中で押されたら、最後の形へ飛ぶ**
      //（1段ずつ叩かせない。stagger と同じ考え）
      var 絵 = n.querySelector('.fx-cel-icon');
      var i = 0;
      var 次の段 = function () {
        return hold(i === 0 ? 420 : 240).then(function (skipped) {
          i++;
          if (skipped) i = icons.length - 1;
          絵.textContent = icons[i];
          絵.classList.remove('fx-cel-step');
          void 絵.offsetWidth;
          絵.classList.add('fx-cel-step');
          if (i >= icons.length - 1) {
            n.classList.add('is-final');
            return skipped;
          }
          play('tick');
          return 次の段();
        });
      };
      p = 次の段().then(function (skipped) { return skipped ? true : hold(長さ); });
    } else {
      p = hold(長さ);
    }
    return p.then(function (skipped) {
      // **祝いの後ろで**先にすること（手渡しの画面遷移）。消える時には、もう結果画面にいる
      if (typeof opt.behind === 'function') { try { opt.behind(); } catch (e) {} }
      n.classList.add('fx-out');
      return hold(160).then(function () { return 指が離れるまで(); }).then(function () {
        if (n.parentNode) n.parentNode.removeChild(n);
        return skipped;
      });
    });
  }
  /** 舞うものを並べる。形と動きは CSS の .fx-cel-p-◯◯ が持つ */
  function 舞わせる(box, opt) {
    var kind = opt.pieces;
    var 数 = CEL_PIECES[kind];
    var d = doc();
    if (!box || !数 || !d) return;
    var 色 = (opt.colors && opt.colors.length) ? opt.colors : ['#f0c44a', '#fff3c4', '#e2584a'];
    var 字 = (opt.words && opt.words.length) ? opt.words : null;
    for (var i = 0; i < 数; i++) {
      var p = d.createElement('i');
      p.className = 'fx-cel-p fx-cel-p-' + kind;
      p.style.setProperty('--c', 色[i % 色.length]);
      p.style.animationDelay = (Math.random() * (kind === 'spark' ? 0.18 : 0.6)).toFixed(2) + 's';
      if (kind === 'spark') {
        // 中心から放射状に。角度をそろえて散らす（偏らない）
        var a = (i / 数) * Math.PI * 2 + Math.random() * 0.3;
        var r = 120 + Math.random() * 160;
        p.style.setProperty('--dx', Math.round(Math.cos(a) * r) + 'px');
        p.style.setProperty('--dy', Math.round(Math.sin(a) * r) + 'px');
      } else {
        p.style.left = (Math.random() * 100).toFixed(1) + '%';
        p.style.setProperty('--dx', Math.round((Math.random() * 2 - 1) * 70) + 'px');
        p.style.setProperty('--r', Math.round((Math.random() * 2 - 1) * 420) + 'deg');
        p.style.animationDuration = (1.5 + Math.random() * 1.0).toFixed(2) + 's';
      }
      if (kind === 'card' && 字) p.textContent = 字[i % 字.length];
      box.appendChild(p);
    }
  }

  // ---------- 第34弾 2-1：みんなで見る 3-2-1 ----------
  /**
   * ゲームが始まる前の合図。数字が画面いっぱいに1秒ずつ脈打つ。
   * 部屋では、全員の端末に同じ放送が届いた瞬間から数えるので、そろって見える。
   * 振動は1秒ごとに少しずつ強く（第32弾-D 第3部と同じ考え）。
   *
   * 第36弾 36-1：**これは演出ではなく「全員が同じ瞬間に始まるための合図」なので、
   * 原則Bの例外として飛ばせない。** タップでも縮まないし、「演出の速さ」設定
   * （cfg.ms）でも縮まない。自分だけ先に数え終わると、始まる瞬間が人によってずれる。
   * 実機で、3-2-1の途中を叩くと自分だけ先に進んでしまう状態だった。
   *
   * 本当に飛ばしてよい場面（手渡しの、その人ひとりのための合図など）のためだけに
   * { skippable:true } を残してある。既定では飛ばせない。
   */
  function beat(ms) {
    // 合図の1拍。waiters に積まない＝タップの巻き添えで消えない。
    // cfg.ms も通さない＝速さの設定でも縮まない
    return new Promise(function (resolve) {
      setTimeout(function () { resolve(false); }, ms);
    });
  }
  function countdown(n, opts) {
    var h = layer();
    if (!h) return Promise.resolve(true);
    var skippable = !!(opts && opts.skippable);
    var wait = skippable ? function () { return hold(1000); } : function () { return beat(1000); };
    var total = (n == null || !(n > 0)) ? 3 : Math.min(9, Math.floor(n));
    var box = mk('fx-countdown');
    if (!box) return Promise.resolve(true);
    h.appendChild(box);
    function show(num) {
      box.innerHTML = '<div class="fx-cd-num">' + num + '</div>';
      play('tick');
      vibe(num <= 1 ? 'ok' : 'tick');   // 最後の1つだけ決定の重さにする
    }
    // 最初の数字はその場で出す（合図が届いた瞬間から数え始めて見える）
    show(total);
    var p = wait();
    var step = function (num) {
      p = p.then(function (skipped) {
        if (skipped) return true;
        show(num);
        return wait();
      });
    };
    for (var i = total - 1; i >= 1; i--) step(i);
    return p.then(function (skipped) {
      if (box.parentNode) box.parentNode.removeChild(box);
      return skipped;
    });
  }

  // ---------- 振動（第39弾で4つの型に絞った） ----------
  /**
   * **振動の型はこの4つだけ。**（docs/デザインの正本.md 5）
   *
   * それまでは rise / win / miss / sold / count1-3 の7つあり、
   * 名前が「その場面での気持ち」で付いていた。そのせいで
   * **人狼の襲撃と処刑に `win`（勝ち）が鳴っていた**——
   * いちばん重い瞬間に、勝ちの名前の振動が当たっていた（落とし穴2）。
   *
   * そこで名前を**手の感じ**で付け直した。気持ちは画面が伝えるもので、
   * 手は「短いか長いか・1回か2回か」しか伝えられない。
   * iOS Safari では鳴らないので、**振動だけで伝わる情報を作らない**という
   * 決めごととも、この割り切りは噛み合っている。
   */
  var VIBES = {
    tick: [12],            // ごく短く1回。切り替え・刻み
    ok:   [30],            // 短く1回。決定
    warn: [25, 60, 25],    // 短く2回。注意（取り返しがつかない確認）
    boom: [200]            // 長く1回。重い一撃。揺れ(fx-shake-big 0.2秒)と同じ長さ
  };
  /**
   * 名前で振動を鳴らす。**知らない名前は鳴らさない**（型を4つに保つため）。
   *
   * 第39弾で見つけた食い違い：ここは演出の速さ設定を通っていなかったので、
   * 「スキップ」にしても振動だけ元の長さで鳴っていた。
   * 画面は止まっているのに手だけ震える形で、
   * 原則「すべての演出はスキップできる」に反していた。
   */
  function vibe(name) {
    var p = VIBES[name];
    if (!p) return false;
    if (cfg.ms(10) <= 0) return false;   // スキップ中は手も鳴らさない
    buzzIt(p);
    return true;
  }
  vibe.NAMES = Object.keys(VIBES);

  // ---------- 並べ替えと、寄り（指示55-①・共通部品B の土台） ----------
  //
  // **ここに「順位表」という言葉は1つも無い。**
  // 鍵にする属性も、巻き取る箱も、呼ぶ側が決める——
  // fx.js がアプリの語彙（rk-row・meId）を知らずに済む形にしてある
  //（CLAUDE.md 技術構成：新しい演出は fx.js に足す／ゲームごとに個別実装しない）。
  //
  // **`flip` とは別物。**あちらはトランプの裏返し（rotateY）で、位置を一度も測らない。
  // 位置を測る手本は `fly`（getBoundingClientRect を2点読む）で、ここはその親戚。

  /**
   * **FLIP**：中身を入れ替える**前に**位置を測り、入れ替えた**後に**
   * 「元いた場所」へ逆変換で置いてから離す。
   * 本物の動きは CSS 側の `transition:transform` が作る。
   *
   * なぜ要るか：中身を `innerHTML` で作り直すと、要素そのものが新品になるので
   * **transition は走る余地が無い**（同じ要素の値が変わる時にしか走らない）。
   * 実際、順位表の `.rk-row` には 0.4秒の transition が書いてあるのに、
   * アプリ全体で**一度も発火していなかった**（指示55-① の着手前に見つけた）。
   *
   * @param {Element} 箱 入れ替えが起きる親
   * @param {string} 選択子 動かしたい要素（例 '.rk-row'）
   * @param {string} 鍵 同じものだと見分けるための属性名（例 'data-rk-id'）
   * @param {Function} 入れ替える 中身を差し替える処理（同期）
   * @param {number} ms 動きの長さ。CSS 側の transition と同じ値を渡す
   * @returns {Promise<boolean>} スキップされたか
   */
  function flipMove(箱, 選択子, 鍵, 入れ替える, ms) {
    var 長さ = cfg.ms(ms == null ? 400 : ms);
    if (!箱 || !箱.querySelectorAll || typeof 入れ替える !== 'function') {
      if (typeof 入れ替える === 'function') 入れ替える();
      return Promise.resolve(true);
    }
    // **スキップ（と「動きを減らす」）の時は、測らずに入れ替えるだけ。**
    // 測ってから捨てると、jsdom のようにレイアウトの無い所で
    // 「動いたつもり」の分岐だけが残る
    if (!(長さ > 0) || 動きを減らす()) { 入れ替える(); return Promise.resolve(true); }

    var 前 = {};
    Array.prototype.forEach.call(箱.querySelectorAll(選択子), function (el) {
      var k = el.getAttribute(鍵);
      if (k) 前[k] = el.offsetTop;
    });
    入れ替える();
    var 動かした = [];
    Array.prototype.forEach.call(箱.querySelectorAll(選択子), function (el) {
      var k = el.getAttribute(鍵);
      if (!k || 前[k] == null) return;          // 新しく増えた行は動かさない
      var dy = 前[k] - el.offsetTop;
      if (!dy) return;                           // 動いていない行に transform を当てない
      el.style.transition = 'none';
      el.style.transform = 'translateY(' + dy + 'px)';
      動かした.push(el);
    });
    if (!動かした.length) return Promise.resolve(false);
    void 箱.offsetWidth;                         // ここで一度、逆変換を反映させる
    動かした.forEach(function (el) {
      el.style.transition = '';                  // CSS の transition に返す
      el.style.transform = '';                   // → ここから本物の動きが始まる
    });
    return hold(長さ).then(function (skipped) {
      // **途中で飛ばされた時は、走っている遷移ごと切って畳む。**
      // そのまま片付けると、行が途中の位置から瞬間移動する
      if (skipped) {
        動かした.forEach(function (el) {
          el.style.transition = 'none'; el.style.transform = '';
        });
        void 箱.offsetWidth;
        動かした.forEach(function (el) { el.style.transition = ''; });
      }
      return skipped;
    });
  }

  /**
   * **寄り**：巻き取る箱の中で、中身ごと拡大して、対象を真ん中に寄せる。
   * `倍率` を 1 にすれば元に戻る（＝引き）。
   *
   * `position:fixed` を使わない。**先祖に filter / transform があると
   * 画面ではなくその箱の座標に置かれる**ので、巻き取る箱の中で完結させる
   * （落とし穴26。#app の filter は第52弾 52-7 で条件付きになったが、
   *  `#uiLayerRoot` は今も自分で filter を持っている）。
   *
   * @param {Element} 箱 巻き取る箱（`overflow:hidden` と高さを持つ）
   * @param {Element} 対象 寄りたい要素（箱の子孫）
   * @param {object} o `{ 倍率, ms }`
   */
  function spotlight(箱, 対象, o) {
    var p = o || {};
    var 中身 = 箱 && 箱.firstElementChild;
    var 長さ = cfg.ms(p.ms == null ? 400 : p.ms);
    if (!箱 || !中身) return Promise.resolve(true);
    var 倍率 = p.倍率 == null ? 1 : p.倍率;
    if (!(長さ > 0) || 動きを減らす()) {
      // スキップ：動かさずに、最終形（＝引いた状態）にする
      中身.style.transition = 'none';
      中身.style.transform = '';
      return Promise.resolve(true);
    }
    var dy = 0;
    if (倍率 !== 1 && 対象) {
      // **箱の真ん中と、対象の真ん中を合わせる。**
      // offsetTop（レイアウトの値）で測る——getBoundingClientRect は
      // 遷移が動いている最中だと途中の値を返す（落とし穴28）
      var 箱の中心 = 箱.clientHeight / 2;
      var 対象の中心 = 対象.offsetTop + 対象.offsetHeight / 2;
      dy = (箱の中心 - 対象の中心 * 倍率);
    }
    中身.style.transition = 'transform ' + 長さ + 'ms cubic-bezier(.32,.72,0,1)';
    中身.style.transformOrigin = '0 0';
    中身.style.transform = 倍率 === 1
      ? 'translateY(0) scale(1)'
      : 'translateY(' + Math.round(dy) + 'px) scale(' + 倍率 + ')';
    return hold(長さ).then(function (skipped) {
      if (skipped) {
        中身.style.transition = 'none';
        中身.style.transform = 倍率 === 1 ? '' : 中身.style.transform;
        void 箱.offsetWidth;
        中身.style.transition = '';
      } else if (倍率 === 1) {
        中身.style.transition = '';
        中身.style.transform = '';      // 引ききったら跡を残さない
      }
      return skipped;
    });
  }

  /**
   * **「動きを減らす」設定**（OS側）。
   * スキップ設定（`.fx-skip` の一括停止）とは**別の門**——
   * 眠っていた transition を起こす以上、こちらにも乗せないと
   * その設定の人にだけ新しい動きが1つ増える。
   */
  function 動きを減らす() {
    var d = doc();
    var w = d && (d.defaultView || d.parentWindow);
    if (!w || !w.matchMedia) return false;
    try { return !!w.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (e) { return false; }
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  var api = {
    init: init, hold: hold, linger: linger, skipNow: skipNow, busy: busy,
    flash: flash, boom: boom, dawn: dawn, banner: banner, burst: burst, shutter: shutter,
    blackout: blackout, celebrate: celebrate,
    flip: flip, countUp: countUp,
    stagger: stagger, fly: fly, alive: alive, notice: notice,
    shake: shake, edge: edge, confetti: confetti, vibe: vibe,
    countdown: countdown,
    flipMove: flipMove, spotlight: spotlight,
    stage: stage, stageClear: stageClear, stageState: stageState,
    _cfg: cfg
  };
  return api;
}));
