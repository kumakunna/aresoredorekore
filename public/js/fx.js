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
    root: null,                       // 演出を差し込む親（.app）
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
    var t = cfg.ms(ms == null ? 0 : ms);
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
  function doc() { return cfg.doc || (typeof document !== 'undefined' ? document : null); }
  function host() {
    return cfg.root || (doc() ? doc().getElementById('app') || doc().body : null);
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
    if (typeof opt.ms === 'function') cfg.ms = opt.ms;
    if (opt.sound) cfg.sound = opt.sound;
    if (typeof opt.vibrate === 'function') cfg.vibrate = opt.vibrate;
    if (opt.can) cfg.can = Object.assign(cfg.can, opt.can);
    var d = doc();
    if (d && !init._bound) {
      // 画面のどこを触ってもスキップ。押した内容は殺さない
      //（ボタンを押しながら演出を飛ばす、が同時に起きてよい）
      d.addEventListener('pointerdown', function () { if (busy()) skipNow(); }, true);
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
    var h = host();
    if (!h) return Promise.resolve(true);
    var k = FLASH_MS[kind] ? kind : 'good';
    var n = mk('fx-flash fx-flash-' + k);
    if (!n) return Promise.resolve(true);
    h.appendChild(n);
    if (k === 'bad') { play('bad'); buzzIt(60); }
    else { play('good'); }
    return hold(FLASH_MS[k]).then(function (skipped) {
      if (n.parentNode) n.parentNode.removeChild(n);
      return skipped;
    });
  }

  // ---------- 原則C：褒める時は全力で ----------
  /**
   * 画面いっぱいの演出。正解・勝利・成功の瞬間だけに使う。
   * kind に 'bad' は無い。責める側でこれを使えないようにしてある。
   *   opt: { text, sub, icon, kind:'good'|'gold'|'gray'|'plain', ms }
   */
  function banner(opt) {
    opt = opt || {};
    var h = host();
    if (!h) return Promise.resolve(true);
    var kind = opt.kind || 'good';
    var n = mk('fx-banner fx-banner-' + kind);
    if (!n) return Promise.resolve(true);
    n.innerHTML =
      (opt.icon ? '<div class="fx-banner-icon">' + opt.icon + '</div>' : '') +
      '<div class="fx-banner-text">' + esc(opt.text || '') + '</div>' +
      (opt.sub ? '<div class="fx-banner-sub">' + esc(opt.sub) + '</div>' : '') +
      '<div class="fx-banner-skip">タップでとばす</div>';
    h.appendChild(n);
    if (kind === 'gold' || kind === 'good') { play('big'); buzzIt([30, 40, 60]); }
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
    var h = host();
    var d = doc();
    if (!h || !d || !fromEl || !toEl || !fromEl.getBoundingClientRect) return hold(100);
    var a = fromEl.getBoundingClientRect();
    var b = toEl.getBoundingClientRect();
    var n = mk('fx-fly', label == null ? '●' : String(label));
    if (!n) return hold(100);
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
    var h = host();
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
    var h = host();
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
    return hold(1800).then(function (skipped) {
      if (box.parentNode) box.parentNode.removeChild(box);
      return skipped;
    });
  }

  // ---------- 第32弾-D 第2部：テキストコールアウト ----------
  /**
   * 緊張が高まる瞬間の、短い英単語（TIEBREAKER / DEFUSED など）。
   * 大画面にだけ出す約束（スマホは自分の操作に集中させる）。
   * 「大画面かどうか」はここでは分からないので、呼ぶ側が判断する。
   *   opt: { kind:'danger'|'gold'|なし, ms }
   */
  function callout(text, opt) {
    opt = opt || {};
    var h = host();
    if (!h) return Promise.resolve(true);
    var n = mk('fx-callout' + (opt.kind ? ' fx-callout-' + opt.kind : ''), esc(text));
    if (!n) return Promise.resolve(true);
    h.appendChild(n);
    play(opt.kind === 'danger' ? 'bad' : 'big');
    return hold(opt.ms == null ? 1100 : opt.ms).then(function (skipped) {
      n.classList.add('fx-out');
      return hold(150).then(function () {
        if (n.parentNode) n.parentNode.removeChild(n);
        return skipped;
      });
    });
  }

  // ---------- 第32弾-D 第3部：場面に合わせた振動 ----------
  // 名前で呼べる振動パターン。ゲーム側が配列を直書きすると場面ごとにばらばらになる。
  // ON/OFFは cfg.vibrate（呼び出し側が設定を見て握りつぶす）に任せる
  var VIBES = {
    rise:   [40, 90, 45, 75, 50, 60, 55, 45, 60, 30, 70],  // 鼓動が速くなっていく感覚
    win:    [120],                  // 短く・強く・1回（手応え）
    miss:   [40],                   // 短く・弱く・1回だけ（原則C）
    sold:   [160],                  // 木槌のように「ドン」と1回
    count3: [50], count2: [80], count1: [120]  // カウントダウンの最後3秒
  };
  function vibe(name) { buzzIt(VIBES[name] || 60); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  var api = {
    init: init, hold: hold, skipNow: skipNow, busy: busy,
    flash: flash, banner: banner, flip: flip, countUp: countUp,
    stagger: stagger, fly: fly, alive: alive, notice: notice,
    shake: shake, confetti: confetti, callout: callout, vibe: vibe,
    _cfg: cfg
  };
  return api;
}));
