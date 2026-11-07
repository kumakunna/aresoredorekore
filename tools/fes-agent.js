// tools/fes-agent.js — 文化祭のページの中に入れる「遊ぶ人」（もと tools/fes-soak.js の AGENT・2026-11-07 に切り出した）
//
// 使う道具：tools/fes-soak.js（耐久）・tools/fes-screen-walk.js（画面監査・11/7 の検査の準備 4）。
// ページの中で動く関数なので、外の変数は使わない（toString() でページへ送る）。cfg：{ name, diff, round, target, lazy, tv }

// ---- ページの中の「遊ぶ人」。1.2秒ごとに、今の画面で押すべき所を1つ押す ----
const AGENT = function () {
  if (window.__soak) return 'old';
  var S = window.__soak = { cfg: {}, errs: [], did: {}, last: '' };
  window.addEventListener('error', function (e) { S.errs.push(String(e.message).slice(0, 200)); });
  window.addEventListener('unhandledrejection', function (e) { S.errs.push('rej ' + String(e.reason && (e.reason.stack || e.reason)).slice(0, 200)); });
  function vis(b) { return b && !b.disabled && b.getAttribute('aria-disabled') !== 'true' && b.offsetParent !== null; }
  function all(sel) { return [].slice.call(document.querySelectorAll(sel)).filter(vis); }
  function pick(sel) { var a = all(sel); return a.length ? a[Math.floor(Math.random() * a.length)] : null; }
  function click(sel) { var b = typeof sel === 'string' ? all(sel)[0] : sel; if (b) { b.click(); return true; } return false; }
  function scr() { return (document.querySelector('.screen.active') || {}).id || ''; }
  S.stage = function () {
    var s = scr();
    var g = document.getElementById('safetyGate');
    if (g && getComputedStyle(g).display !== 'none') return 'gate';
    if (s === 'scr-v2-fes-join') return 'join';
    if (s !== 'scr-v2-fes-lobby' && s !== 'scr-v2-fes-tv') return s;
    var q = function (x) { return !!document.querySelector('#' + s + ' ' + x); };
    return q('.v2-vlist') || q('.v2-tvVote') ? 'vote' : q('.v2-dec') || q('.v2-tdec2') ? 'decide' : q('[data-fes-act=ready],[data-fes-unready]') || q('.v2-tvB') ? 'ready' :
      q('.v2-bgrid') ? 'play' : q('.v2-contsheet') || q('.v2-tend') ? 'result' : q('.v2-tvIdle') ? 'idle' : q('[data-fes-act=join]') ? 'join' : 'lobby';
  };
  function bombAnswer() {
    var bs = all('#scr-v2-fes-lobby [data-fes-ans]'); if (!bs.length) return false;
    var texts = bs.map(function (b) { return b.getAttribute('data-fes-ans'); });
    var right = null;
    try {
      var Q = window.QuizBank && window.QuizBank.QUESTIONS;
      if (Q) Object.keys(Q).some(function (k) { return Q[k].some(function (x) { if (x.choices && texts.every(function (t) { return x.choices.indexOf(t) !== -1; })) { right = x.choices[x.correct]; return true; } }); });
    } catch (e) {}
    var b = (right && Math.random() < 0.8) ? bs.filter(function (x) { return x.getAttribute('data-fes-ans') === right; })[0] : bs[Math.floor(Math.random() * bs.length)];
    (b || bs[0]).click(); return true;
  }
  S.step = function () {
    var c = S.cfg, s = scr(), st = S.stage();
    if (st === 'gate') return click('#sgStartBtn') && 'gate';
    if (s === 'scr-door') { var p = document.getElementById('doorPanel'); if (p) p.click(); return 'door'; }
    if (c.tv) return st;
    if (st === 'join') {
      var n = document.querySelector('[data-fes-name]');
      if (n && n.value !== c.name) { n.value = c.name; n.dispatchEvent(new Event('input', { bubbles: true })); }
      if (!document.querySelector('[data-fes-diff].is-on,[data-fes-diff][aria-pressed=true]')) click('[data-fes-diff=' + (c.diff || 'normal') + ']');
      return click('[data-fes-act=join]') ? 'join' : 'join?';
    }
    if (st === 'vote') {
      if (S.did.vote === c.round) return 'voted';
      if (c.target && click('[data-fes-pick="' + c.target + '"]')) {} else { var o = pick('[data-fes-pick]'); if (o && Math.random() < 0.7) o.click(); }
      if (click('[data-fes-act=vote]')) { S.did.vote = c.round; return 'vote'; }
      return 'vote?';
    }
    if (st === 'ready') return click('[data-fes-act=ready]') ? 'ready' : 'ready-wait';
    if (st === 'result') { if (!c.lazy && S.did.cont !== c.round && click('[data-fes-act=continue]')) { S.did.cont = c.round; return 'cont'; } return 'result'; }
    if (st === 'play') { if (Math.random() < 0.35) { var cell = pick('#scr-v2-fes-lobby .v2-bcell'); if (cell && !document.querySelector('#scr-v2-fes-lobby [data-fes-ans]')) { cell.click(); return 'cell'; } if (bombAnswer()) return 'ans'; } return 'play'; }
    if (s === 'scr-v2-onaji') { var a = pick('#scr-v2-onaji [data-onaji-pick]'); if (a && Math.random() < 0.5) { a.click(); return 'onaji'; } return s; }
    if (s === 'scr-v2-pittari') { var b = pick('#scr-v2-pittari [data-pt-stop]'); if (b && Math.random() < 0.15) { b.click(); return 'stop'; } return s; }
    if (s === 'scr-v2-soroe') { var f = pick('#scr-v2-soroe [data-so-fire]'); if (f && Math.random() < 0.2) { f.click(); return 'fire'; } return s; }
    if (s === 'scr-v2-qhaya') { var h = pick('#scr-v2-qhaya [data-qh-pick]'); if (h && Math.random() < 0.3) { h.click(); return 'qh'; } return s; }
    if (s === 'scr-v2-qnear') {
      var k = pick('#scr-v2-qnear [data-qn-key]');
      if (k && Math.random() < 0.5) { k.click(); if (Math.random() < 0.3) click('#scr-v2-qnear [data-qn-go]'); return 'qn'; }
      return s;
    }
    return st;
  };
  S.report = function () {
    var a = document.querySelector('.screen.active');
    // 2026-11-01：先頭400字だけ比べると、TV は名前の札が先頭に並ぶので、ゲームが進んでも「変わらない」に見えた（誤報）。
    // 画面の名前・段階・字の全部（ハッシュ）で比べる。記録に残す字は、名前の札のあとの所（末尾）
    var all = a ? (a.innerText || '').replace(/\s+/g, ' ') : '';
    var h = 5381;
    for (var i = 0; i < all.length; i++) h = ((h * 33) ^ all.charCodeAt(i)) >>> 0;
    var e = S.errs.splice(0);
    return { scr: scr(), stage: S.stage(), sig: scr() + '|' + S.stage() + '|' + all.length + ':' + h.toString(36), txt: all.slice(-160), errs: e, tmem: document.querySelectorAll('#scr-v2-fes-tv .v2-tmem').length, stuck: !!document.querySelector('[data-tv-stuck]') };
  };
  S.timer = setInterval(function () { try { S.last = S.step(); } catch (e) { S.errs.push('step ' + e.message); } }, 1200);
  return 'new';
};

module.exports = { AGENT };
