// public/js/sound.js — 音の箱（指示68-2 第6節）と、司会の声の差し込み口（第3節）
//
// **効果音を鳴らす所は、全部ここを通す。**`Sound.play('ok')` のように音の ID で呼ぶ。
// index.html の beep・buzz などの電子音は「ファイルが読めない時の代わり」としてだけ残す（文化祭の当日に音が消えないように）。
//
// ---- だれが鳴らすか（くまくんの決定 2026-10-25） ----
//   ・音は TV だけで鳴らす。スマホは「押した時のコツ」（tap）1つだけ
//   ・TV が無い遊び方（1台で遊ぶ・TV をつないでいない部屋）の時だけ、スマホで TV の音を鳴らす
//   ・司会の声は TV だけ。スマホでは鳴らさない（TV が無くても鳴らさない）
//   ・音量（効果音のつまみ・一時ミュート）が 0 なら、何も鳴らさない
//
// ---- ファイル ----
//   public/sound/index.json   … { se: { ok: 3, ... }, voice: { v24: 2, ... } }（ある本数。tools/sound/ の台本が書く）
//   public/sound/se/<ID>-<n>.mp3・public/sound/voice/<ID>-<n>.mp3（n は 1 から）
//   **入口では読み込まない。**TV の画面になった時は全部、スマホは tap だけを、あとから読む（preload）。
//   index.json が無い・ファイルが読めない時は、効果音は代わりの電子音、声は何も鳴らさない（エラーにしない）
//
// ---- AudioContext は1つを使い回す ----
//   1回ごとに作ると6個前後で音が止まる（爆弾の心拍の所に書いてある落とし穴）。iOS は触った時に起こす
//
// このファイルは DOM を知らない（Node.js から require してテストできる）。鳴らす先・音量・TV かどうかは setup で受ける
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Sound = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** 効果音の ID（指示68-2 第6節の表）。tap だけがスマホでも鳴る */
  var IDS = ['tick', 'count', 'ok', 'decide', 'tap', 'ng', 'miss', 'fanfare', 'cheer', 'timeup', 'gavel', 'sold',
    'cut', 'spark', 'defuse', 'boom'];
  /** 司会の声の ID（第3節の表。くまくんの録音リストと同じ・変えない） */
  var VOICES = ['v01', 'v02', 'v03', 'v04', 'v05', 'v06', 'v07a', 'v07b', 'v07c', 'v08', 'v09', 'v10', 'v11', 'v12', 'v13',
    'v14', 'v15', 'v16', 'v17', 'v18', 'v19', 'v20', 'v21', 'v22', 'v23', 'v24', 'v25', 'v26', 'v27', 'v28', 'v29',
    'v30', 'v31', 'v32', 'v33'];
  var PHONE_ONLY = ['tap'];

  var cfg = {
    base: 'sound/',
    volume: function () { return 1; },                       // 0〜1。0 なら鳴らさない
    where: function () { return { tv: false, tvInRoom: false }; },
    out: null,                                               // function(ctx) → 鳴らす先（index.html の sfxOut）
    fallback: {},                                            // { id: function(opt) } ファイルが無い時の電子音
    fetch: null,                                             // 検査が差しかえる
    makeContext: null,                                       // 検査が差しかえる
    rnd: Math.random
  };
  var st = { ctx: null, manifest: null, manifestTried: false, buffers: {}, last: {}, loading: {}, log: [] };

  /**
   * この端末で、この音を鳴らすか（DOM を見ない・検査が表で回す）。
   * w：{ tv: この端末が TV, tvInRoom: 部屋に TV がつながっている }
   */
  function shouldPlay(id, w, vol) {
    if (!(vol > 0)) return false;
    w = w || {};
    if (w.tv) return true;
    if (w.tvInRoom) return PHONE_ONLY.indexOf(id) !== -1;
    return true;   // TV が無い遊び方：スマホが TV の代わりに鳴らす
  }
  function voiceShouldPlay(w, vol) { return !!(w && w.tv) && vol > 0; }

  function ctx() {
    if (st.ctx) return st.ctx;
    try {
      var make = cfg.makeContext || function () {
        var AC = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);
        return AC ? new AC() : null;
      };
      st.ctx = make();
    } catch (e) { st.ctx = null; }
    return st.ctx;
  }
  /** iOS：触った時に眠っていたら起こす（index.html が pointerdown で呼ぶ） */
  function wake() {
    var c = st.ctx;
    if (c && c.state === 'suspended' && c.resume) { try { c.resume(); } catch (e) {} }
  }

  function getJson(url) {
    var f = cfg.fetch || (typeof fetch === 'function' ? fetch : null);
    if (!f) return Promise.resolve(null);
    return f(url).then(function (r) { return r && r.ok ? r.json() : null; }).catch(function () { return null; });
  }
  function getBuffer(url) {
    var f = cfg.fetch || (typeof fetch === 'function' ? fetch : null);
    var c = ctx();
    if (!f || !c) return Promise.resolve(null);
    return f(url).then(function (r) { return r && r.ok ? r.arrayBuffer() : null; })
      .then(function (ab) {
        if (!ab) return null;
        return new Promise(function (ok) {
          try {
            var p = c.decodeAudioData(ab, ok, function () { ok(null); });
            if (p && p.then) p.then(ok, function () { ok(null); });
          } catch (e) { ok(null); }
        });
      }).catch(function () { return null; });
  }
  function manifest() {
    if (st.manifestTried) return Promise.resolve(st.manifest);
    if (st.loading.manifest) return st.loading.manifest;
    st.loading.manifest = getJson(cfg.base + 'index.json').then(function (m) {
      st.manifest = m && typeof m === 'object' ? m : null;
      st.manifestTried = true;
      return st.manifest;
    });
    return st.loading.manifest;
  }
  /** あとから読む。which：'tv'（効果音と声を全部）・'all'（効果音を全部）・'tap'（コツだけ） */
  function preload(which) {
    return manifest().then(function (m) {
      if (!m) return 0;
      var jobs = [];
      var want = function (kind, id) {
        var n = +((m[kind] || {})[id]) || 0;
        for (var i = 1; i <= n; i++) {
          (function (key, url) {
            if (st.buffers[key] !== undefined || st.loading[key]) return;
            st.loading[key] = getBuffer(url).then(function (b) { st.buffers[key] = b; delete st.loading[key]; });
            jobs.push(st.loading[key]);
          })(kind + '/' + id + '-' + i, cfg.base + kind + '/' + id + '-' + i + '.mp3');
        }
      };
      (which === 'tap' ? PHONE_ONLY : IDS).forEach(function (id) { want('se', id); });
      if (which === 'tv') VOICES.forEach(function (id) { want('voice', id); });
      return Promise.all(jobs).then(function () { return jobs.length; });
    });
  }
  /** 読めた本数の中から、前と違う1本を選ぶ（同じ音が続くと安っぽく聞こえる） */
  function pick(kind, id) {
    var list = [];
    for (var i = 1; i <= 9; i++) { var b = st.buffers[kind + '/' + id + '-' + i]; if (b) list.push(i); }
    if (!list.length) return null;
    var key = kind + '/' + id;
    var choices = list.length > 1 ? list.filter(function (i) { return i !== st.last[key]; }) : list;
    var n = choices[Math.floor(cfg.rnd() * choices.length) % choices.length];
    st.last[key] = n;
    return { n: n, buf: st.buffers[kind + '/' + id + '-' + n] };
  }
  function playBuffer(buf) {
    var c = ctx();
    if (!c || !buf) return false;
    try {
      var s = c.createBufferSource();
      s.buffer = buf;
      s.connect((cfg.out && cfg.out(c)) || c.destination);
      s.start(0);
      return true;
    } catch (e) { return false; }
  }
  function note(what) { st.log.push(what); if (st.log.length > 50) st.log.shift(); return what.how; }

  /**
   * 効果音を鳴らす。返す値：'off'（この端末では鳴らさない）・'file'・'fallback'（電子音）・'none'
   * opt はそのまま代わりの電子音に渡す（3・2・1 の高さなど）
   */
  function play(id, opt) {
    var vol = +cfg.volume();
    // force：音量を試すボタンなど、この端末で鳴らすと決まっている時（音量 0 なら鳴らさないのは同じ）
    var here = opt && opt.force ? vol > 0 : shouldPlay(id, cfg.where(), vol);
    if (!here) return note({ id: id, how: 'off' });
    var p = pick('se', id);
    if (p && playBuffer(p.buf)) return note({ id: id, how: 'file', n: p.n });
    var fb = cfg.fallback[id];
    if (typeof fb === 'function') { try { fb(opt); } catch (e) {} return note({ id: id, how: 'fallback' }); }
    return note({ id: id, how: 'none' });
  }
  /** 司会の声。TV だけ。ファイルが無い言葉は何も鳴らさない（くまくんの録音は、あとから届く） */
  function voice(id) {
    var vol = +cfg.volume();
    if (!voiceShouldPlay(cfg.where(), vol)) return note({ id: id, how: 'off' });
    var p = pick('voice', id);
    if (p && playBuffer(p.buf)) return note({ id: id, how: 'file', n: p.n });
    return note({ id: id, how: 'none' });
  }

  function setup(o) {
    Object.keys(o || {}).forEach(function (k) { cfg[k] = o[k]; });
    return api;
  }
  /** 検査用：読み込みと記録を空にする */
  function reset() { st = { ctx: null, manifest: null, manifestTried: false, buffers: {}, last: {}, loading: {}, log: [] }; }

  var api = {
    IDS: IDS, VOICES: VOICES, PHONE_ONLY: PHONE_ONLY,
    setup: setup, play: play, voice: voice, preload: preload, wake: wake,
    shouldPlay: shouldPlay, voiceShouldPlay: voiceShouldPlay,
    log: function () { return st.log.slice(); }, reset: reset,
    loaded: function () { return Object.keys(st.buffers).filter(function (k) { return !!st.buffers[k]; }); }
  };
  return api;
});
