/**
 * public/js/probe.js — 検査のための記録（11/7 の検査の準備 7・6）。サーバーの probe.js と組。
 *
 * 7：スマホと TV で起きた JavaScript のエラー（window の error・unhandledrejection）を、機種（UA）・画面・時刻と一緒にサーバーへ送る。
 * 6：知らせの遅れ（サーバーが出した → 受け取った → 受け口が終わった → 画面に出た）を測って送る。
 *
 * **サーバーが「入っている」と言った時だけ送る**（app:version の probe。本番の .env に PROBE が無ければ、何も送らない）。
 * エラーは、読み込んですぐから手元にためておく（入っているかが分かる前のエラーも落とさないため。20件まで）。
 * 同じエラー（字・ファイル・行が同じ）は1回だけ送り、何回起きたかは数だけ（n）。**名前など個人の情報は入れない**
 *（送るのはエラーの字・ファイルの道・行・スタックの頭・画面の id・役（スマホ／TV／係）・UA・版）。
 * 送れなかった時は、あきらめる（送り直しで回線を詰まらせない）。
 */
(function (root) {
  var MAX_ERRS = 20, LAG_FLUSH_MS = 5000, LAG_MAX = 1000;
  var P = { flags: null, errs: [], seen: {}, sentErr: 0, lag: [], lagAll: [], offset: null, rtt: null, info: null, rt: null };

  function scr() { try { return (document.querySelector('.screen.active') || {}).id || null; } catch (e) { return null; } }
  function role() { try { return P.info && P.info.role ? P.info.role() : 'phone'; } catch (e) { return 'phone'; } }
  function post(url, list) {
    try {
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ list: list }),
        credentials: 'same-origin', keepalive: true }).catch(function () {});
    } catch (e) { /* 送れない時はあきらめる */ }
  }

  // ---- 7：エラー ----
  function addErr(kind, msg, src, line, col, stack) {
    var key = String(msg) + '|' + String(src || '') + '|' + (line | 0);
    if (P.seen[key]) { P.seen[key].n++; return; }
    if (P.errs.length + P.sentErr >= MAX_ERRS) return;
    var e = { kind: kind, msg: String(msg || '').slice(0, 300), src: src || null, line: line | 0, col: col | 0,
      stack: stack ? String(stack).slice(0, 800) : null, at: Date.now(), scr: scr(), role: role(),
      ua: (root.navigator && navigator.userAgent) || '', v: (root.AppVersion && AppVersion.VERSION) || null, n: 1,
      // 追加（調べた結果から）：その時、画面が見えていたか・通信がつながっていたか（もどった直後のエラーを見分ける）
      vis: (root.document && document.visibilityState) || null, conn: !!(P.rt && P.rt.state && P.rt.state.connected) };
    P.seen[key] = e;
    P.errs.push(e);
    flushErr();
  }
  function flushErr() {
    if (!P.flags || !P.flags.err || !P.errs.length) return;
    var list = P.errs.splice(0);
    P.sentErr += list.length;
    post('/api/probe/err', list);
  }
  if (root.addEventListener) {
    root.addEventListener('error', function (ev) {
      // 画像や音の読み込みの失敗（ev.error が無く target が要素）は、JavaScript のエラーではないので数えない
      if (!ev || (ev.target && ev.target !== root && ev.target.tagName)) return;
      addErr('error', ev.message, ev.filename, ev.lineno, ev.colno, ev.error && ev.error.stack);
    }, true);
    root.addEventListener('unhandledrejection', function (ev) {
      var r = ev && ev.reason;
      addErr('rejection', (r && (r.message || r.name)) || String(r), null, 0, 0, r && r.stack);
    });
  }

  // ---- 6：遅れ ----
  function syncClock() {
    if (!P.rt || !P.rt.clockSync) return;
    // 8回たずねて、往復がいちばん短かった回の差を使う（追加：調べた結果から）
    P.rt.clockSync(8).then(function (samples) {
      var best = null;
      (samples || []).forEach(function (s) { var rtt = s.t1 - s.t0; if (!best || rtt < best.rtt) best = { rtt: rtt, offset: s.server - (s.t0 + s.t1) / 2 }; });
      if (best) { P.offset = best.offset; P.rtt = best.rtt; }
    });
  }
  function onLag(m) {
    if (!P.flags || !P.flags.lag || !m) return;
    var raf = root.requestAnimationFrame || function (f) { return setTimeout(f, 16); };
    // 画面に出た時刻：受け口が終わったあとの、次のコマ（requestAnimationFrame の中で取る＝そのコマを描く直前）
    raf(function () {
      (function () {
        var paint = Date.now();
        var x = { e: m.e, net: P.offset == null ? null : (m.recv + P.offset - m.t), handle: m.done - m.recv, paint: paint - m.recv,
          rtt: P.rtt, scr: scr(), role: m.e === 'fes:staff' ? 'staff' : role(), at: m.t };   // 係の画面の知らせは係（係の画面の id が無い時も）
        try { if (P.info && P.info.phase) x.ph = P.info.phase(); if (P.info && P.info.game) x.game = P.info.game(); } catch (e) {}
        P.lag.push(x);
        P.lagAll.push(x); if (P.lagAll.length > LAG_MAX) P.lagAll.shift();
      })();
    });
  }
  setInterval(function () {
    if (!P.flags || !P.flags.lag || !P.lag.length) return;
    post('/api/probe/lag', P.lag.splice(0, 200));
  }, LAG_FLUSH_MS);

  /**
   * つなぐ（index.html で rt を作った直後に1回）。info：{ role(), phase(), game() } を画面の側から渡す
   */
  P.attach = function (rt, info) {
    if (!rt || P.rt) return;
    P.rt = rt; P.info = info || null;
    rt.on('version', function (p) { P.setFlags(p && p.probe ? { err: !!p.probe.err, lag: !!p.probe.lag } : null); });
    rt.on('lag', onLag);
    // 時計を合わせ直す：つなぎ直した時・画面がまた見えた時（回線が変わることがある）・1分ごと
    rt.on('status', function (st) { if (st && st.connected && P.flags && P.flags.lag) syncClock(); });
    if (root.document && document.addEventListener) document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && P.flags && P.flags.lag) syncClock(); });
    setInterval(function () { if (P.flags && P.flags.lag) syncClock(); }, 60000);
  };
  /** サーバーが「入っている」か（app:version に添うものと同じ）。true／false の欄がそろっている時だけ受け取る */
  P.setFlags = function (f) {
    var ok = f && typeof f.err === 'boolean' && typeof f.lag === 'boolean';
    var was = P.flags;
    P.flags = ok ? { err: f.err, lag: f.lag } : null;
    flushErr();
    if (P.flags && P.flags.lag && !(was && was.lag)) syncClock();
  };
  // 読み込んだら1回だけ聞く（部屋に入らない画面でも、エラーを送れるように。入っていなければ 404 で、何もしない）
  try {
    if (root.fetch && root.location && /^https?:$/.test(root.location.protocol)) {
      root.fetch('/api/probe/flags', { credentials: 'same-origin', cache: 'no-store' })
        .then(function (r) { return r && r.ok && r.json ? r.json() : null; })
        .then(function (f) { if (f) P.setFlags(f); }).catch(function () {});
    }
  } catch (e) { /* 聞けない時は、app:version を待つ */ }
  root.ProbeKit = P;
})(typeof window !== 'undefined' ? window : this);
