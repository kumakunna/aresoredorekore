// public/js/wake-keep.js — スマホと TV の画面を消さない（指示71-1・Screen Wake Lock）
//
// 待合・投票・ほかの人の番・予約待ちの間にスマホの画面が消えると、つながりが切れる。30秒で席が空き、
// 戻った時に満員なら「つぎの回」になる（文化祭 F2）。だから部屋にいる間は、ブラウザーの「画面を消さない」を取っておく。
//   ・取るかどうかは want() の1つだけで決める（部屋にいるか・予約して待っているか）。入る・出る・出される・閉じる・
//     つなぎ直しと道がたくさんあるので、道ごとに取る／外すを書かず、2秒ごとと見え直した時に want() を見る（落とし穴1）
//   ・画面が見えなくなると、ブラウザーが自分で外す決まり。見え直したら取り直す（visibilitychange）
//   ・使えない端末（wakeLock が無い・断られた）では何もしない。エラーも案内も出さない。設定には足さない（いつも入）
// iOS は 18.4 から・Chrome は 84 から

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WakeKeep = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * opts.want：取りたい時 true を返す関数。opts.nav・opts.doc：navigator・document（検査でにせ物を渡す）
   * opts.everyMs：want() を見直す間（0 なら見直さない・検査用。既定 2000）
   */
  function create(opts) {
    var o = opts || {};
    var nav = o.nav, doc = o.doc, want = o.want || function () { return false; };
    var held = null, asking = false, stopped = false;

    function can() { return !!(nav && nav.wakeLock && typeof nav.wakeLock.request === 'function'); }
    function visible() { return !doc || doc.visibilityState === undefined || doc.visibilityState === 'visible'; }
    function wanted() { try { return !!want(); } catch (e) { return false; } }

    function acquire() {
      if (held || asking || stopped || !can() || !visible()) return;
      asking = true;
      var p;
      try { p = nav.wakeLock.request('screen'); } catch (e) { asking = false; return; }
      Promise.resolve(p).then(function (s) {
        asking = false;
        if (!s) return;
        // 取りに行っている間に部屋を出た・止めた：持ちっぱなしにしない
        if (stopped || !wanted()) { try { Promise.resolve(s.release()).catch(function () {}); } catch (e) {} return; }
        held = s;
        try { s.addEventListener('release', function () { if (held === s) held = null; }); } catch (e) {}
      }, function () { asking = false; });
    }
    function release() {
      var s = held; held = null;
      if (s) { try { Promise.resolve(s.release()).catch(function () {}); } catch (e) {} }
    }
    function sync() { if (wanted()) acquire(); else release(); }

    if (doc && typeof doc.addEventListener === 'function') {
      doc.addEventListener('visibilitychange', function () { if (visible()) sync(); });
    }
    var every = o.everyMs === undefined ? 2000 : o.everyMs;
    var timer = every > 0 ? setInterval(sync, every) : null;
    sync();
    return {
      sync: sync,
      held: function () { return !!held; },
      stop: function () { stopped = true; if (timer) clearInterval(timer); release(); }
    };
  }

  return { create: create };
});
