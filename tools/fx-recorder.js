// tools/fx-recorder.js — 演出の「記録係」（指示62-3）
//
// 本物のブラウザ（tools/cdp.js の端末）のページに、**読み込みの最初から**差し込む小さな見張り。
// アプリのコードは1行も変えない。ページの外側から、起きたことを拾って溜めるだけ。
//
// 拾うもの（どれも「出た瞬間」に拾う。時々覗きに行かない・落とし穴28）
//   anim  … CSS アニメーションの始まり／終わり／取り消し（animationstart/end/cancel）。名前・要素・宣言の長さ
//   tr    … CSS の遷移（transitionstart/end）。プロパティ・要素・宣言の長さ
//   node  … 演出の部品（.fx-* など）が置かれた／外された瞬間。**スキップ設定でアニメが走らなくても**残る
//   cls   … <html>・<body>・#app の class が変わった瞬間（bomb-danger・no-flash・揺れ など）
//   fx    … FxKit の部品が呼ばれた瞬間と、呼んだ場所（スタックから関数名と行）
//   vib   … navigator.vibrate（振動の型）と呼んだ場所
//   snd   … WebAudio の音が鳴り始めた瞬間（AudioScheduledSourceNode.start）と、鳴らした関数
//   media … <audio> の再生 ／ speech … 読み上げ
//
// 設定（演出の速さ・光の点滅・画面の揺れ）は、**ページが自分の設定を読む前に** localStorage へ置く。
// 設定画面を押して回るのと同じ値が、アプリ自身の loadAppPrefs を通って効く。
//
// 使い方：
//   const rec = require('./fx-recorder');
//   await rec.attach(dev, { fxSpeed: 'skip', fxFlash: true, fxShake: true });   // 開く前に
//   const events = await rec.take(dev);   // 溜まった分を取り出す（取り出すと空になる）

const PREFS_KEY = 'acac-app-prefs';

/** ページの中で走る見張り。prefs は JSON で埋め込む */
function script(prefs) {
  return '(' + function (PREFS, PREFS_KEY) {
    if (window.__fxRec) return;
    window.__fxRec = true;
    if (PREFS && /^https?:/.test(location.protocol)) {
      try {
        var p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') || {};
        Object.keys(PREFS).forEach(function (k) { p[k] = PREFS[k]; });
        localStorage.setItem(PREFS_KEY, JSON.stringify(p));
      } catch (e) {}
    }
    var log = [];
    var 演出らしい = /(^|\s)(fx-|bomb-boom|bomb-danger|tut-|title-toast|shake|warp|door|cel-|confetti|sparkle|burst|flash|edge|banner|shutter|blackout|dawn)/;
    function who(el) {
      if (!el || !el.tagName) return el === document ? 'document' : String(el && el.nodeName);
      var s = el.tagName.toLowerCase();
      if (el.id) s += '#' + el.id;
      var c = (typeof el.className === 'string' ? el.className : (el.className && el.className.baseVal) || '').trim().split(/\s+/).filter(Boolean).slice(0, 4);
      if (c.length) s += '.' + c.join('.');
      return s;
    }
    function 画面() { var a = document.querySelector && document.querySelector('.screen.active'); return a ? a.id : null; }
    function 呼んだ所() {
      var st = (new Error().stack || '').split('\n').slice(2);
      var out = [];
      for (var i = 0; i < st.length && out.length < 6; i++) {
        var m = st[i].match(/at (?:async )?(?:([^\s(]+) )?\(?([^\s)]*?):(\d+):\d+\)?$/);
        if (!m) continue;
        var file = (m[2] || '').replace(/^.*\//, '') || 'index';
        out.push((m[1] || '?') + '@' + file + ':' + m[3]);
      }
      return out;
    }
    function push(o) { o.t = Date.now(); o.scr = 画面(); log.push(o); if (log.length > 40000) log.splice(0, 10000); }
    window.__fxTake = function () { var a = log; log = []; return a; };

    ['animationstart', 'animationend', 'animationcancel'].forEach(function (ev) {
      document.addEventListener(ev, function (e) {
        var cs = null;
        try { cs = getComputedStyle(e.target, e.pseudoElement || null); } catch (x) {}
        push({ k: 'anim', ev: ev.replace('animation', ''), name: e.animationName, el: who(e.target), pe: e.pseudoElement || '',
          dur: cs ? cs.animationDuration : null, it: cs ? cs.animationIterationCount : null, el2: e.target && e.target.parentElement ? who(e.target.parentElement) : '' });
      }, true);
    });
    ['transitionstart', 'transitionend', 'transitioncancel'].forEach(function (ev) {
      document.addEventListener(ev, function (e) {
        var cs = null;
        try { cs = getComputedStyle(e.target, e.pseudoElement || null); } catch (x) {}
        push({ k: 'tr', ev: ev.replace('transition', ''), prop: e.propertyName, el: who(e.target), pe: e.pseudoElement || '',
          dur: cs ? cs.transitionDuration : null, el2: e.target && e.target.parentElement ? who(e.target.parentElement) : '' });
      }, true);
    });

    function 見張りを付ける() {
      if (!document.documentElement) return setTimeout(見張りを付ける, 10);
      var mo = new MutationObserver(function (recs) {
        recs.forEach(function (r) {
          if (r.type === 'attributes') {
            var t = r.target;
            if (t === document.documentElement || t === document.body || t.id === 'app') {
              var 前 = (r.oldValue || '').split(/\s+/).filter(Boolean), 今 = (typeof t.className === 'string' ? t.className : '').split(/\s+/).filter(Boolean);
              var 足 = 今.filter(function (c) { return 前.indexOf(c) === -1; }), 引 = 前.filter(function (c) { return 今.indexOf(c) === -1; });
              if (足.length || 引.length) push({ k: 'cls', el: who(t), add: 足, del: 引 });
            }
            return;
          }
          Array.prototype.forEach.call(r.addedNodes, function (n) {
            if (n.nodeType === 1 && 演出らしい.test(typeof n.className === 'string' ? n.className : '')) push({ k: 'node', ev: 'add', el: who(n), in: who(r.target) });
          });
          Array.prototype.forEach.call(r.removedNodes, function (n) {
            if (n.nodeType === 1 && 演出らしい.test(typeof n.className === 'string' ? n.className : '')) push({ k: 'node', ev: 'del', el: who(n), in: who(r.target) });
          });
        });
      });
      mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true });
    }
    見張りを付ける();

    // FxKit：**置かれた瞬間に**部品を1つずつ包む（中身は本物のまま呼ぶ）。
    // 時々覗いて包むと、読み込み直後の呼び出しを取りこぼす
    function 包む(F) {
      if (!F || F.__包んだ) return F;
      Object.keys(F).forEach(function (k) {
        var f = F[k];
        if (typeof f !== 'function' || /^(stageState|busy|init|_)/.test(k)) return;
        F[k] = function () {
          var a = Array.prototype.slice.call(arguments).map(function (x) {
            if (x == null) return x;
            if (typeof x === 'function') return 'fn';
            if (x && x.nodeType) return who(x);
            if (typeof x === 'object') { try { return JSON.stringify(x).slice(0, 120); } catch (e) { return 'obj'; } }
            return x;
          });
          push({ k: 'fx', fn: k, arg: a, from: 呼んだ所() });
          return f.apply(this, arguments);
        };
      });
      try { Object.defineProperty(F, '__包んだ', { value: true }); } catch (e) {}
      return F;
    }
    var 本物の部品 = window.FxKit ? 包む(window.FxKit) : undefined;
    try {
      Object.defineProperty(window, 'FxKit', { configurable: true, enumerable: true,
        get: function () { return 本物の部品; }, set: function (v) { 本物の部品 = 包む(v); } });
    } catch (e) {}
    if (navigator.vibrate) {
      var v = navigator.vibrate.bind(navigator);
      navigator.vibrate = function (p) { push({ k: 'vib', p: p, from: 呼んだ所() }); try { return v(p); } catch (e) { return false; } };
    }
    if (window.AudioScheduledSourceNode) {
      var st = AudioScheduledSourceNode.prototype.start;
      AudioScheduledSourceNode.prototype.start = function () { push({ k: 'snd', node: this.constructor && this.constructor.name, from: 呼んだ所() }); return st.apply(this, arguments); };
    }
    if (window.HTMLMediaElement) {
      var pl = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () { push({ k: 'media', src: String(this.currentSrc || this.src || '').slice(-60), from: 呼んだ所() }); return pl.apply(this, arguments); };
    }
    if (window.speechSynthesis) {
      var sp = speechSynthesis.speak.bind(speechSynthesis);
      speechSynthesis.speak = function (u) { push({ k: 'speech', text: String(u && u.text || '').slice(0, 30) }); return sp(u); };
    }
  }.toString() + ')(' + JSON.stringify(prefs || null) + ',' + JSON.stringify(PREFS_KEY) + ');';
}

/** 端末に見張りを差し込む。**ページを開く前に**呼ぶ（以後どのページを開いても最初から付く） */
async function attach(dev, prefs) {
  await dev.raw('Page.addScriptToEvaluateOnNewDocument', { source: script(prefs) });
}

/** 溜まった記録を取り出す（取り出すと空になる）。ページが無い・読み込み中なら空 */
async function take(dev) {
  try { return (await dev.ev('window.__fxTake ? window.__fxTake() : []')) || []; } catch (e) { return []; }
}

/** 調べる5つの設定（指示62-3 の表） */
const SETTINGS = {
  '1': { 名: '①ふつう・光あり・揺れあり', prefs: { fxSpeed: 'normal', fxFlash: true, fxShake: true } },
  '2': { 名: '②速い', prefs: { fxSpeed: 'fast', fxFlash: true, fxShake: true } },
  '3': { 名: '③スキップ', prefs: { fxSpeed: 'skip', fxFlash: true, fxShake: true } },
  '4': { 名: '④光の点滅を使わない', prefs: { fxSpeed: 'normal', fxFlash: false, fxShake: true } },
  '5': { 名: '⑤画面の揺れを使わない', prefs: { fxSpeed: 'normal', fxFlash: true, fxShake: false } }
};

module.exports = { script, attach, take, SETTINGS, PREFS_KEY };
