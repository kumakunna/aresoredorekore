// tools/soroe-overlap.js — そろえて発射の、通りすぎる看板と右はしの高さの目じるしが重ならないかを、止めた時計で0.1秒ごとに測る（指示68-T）
//
//   node tools/soroe-overlap.js so-tv-film-space   … 場面（tools/v2-lab/button-scenes.js）。重なった時刻と看板を出す（無ければ「重なり無し」）
const { launch } = require('./cdp');
const { 配り手, 開く } = require('./v2-lab/open');
const B = require('./v2-lab/button-scenes');
(async () => {
  const s = await 配り手(3984); const br = await launch({ port: 9684 });
  const d = await br.newDevice('tv', { width: 1920, height: 1080 });
  const sc = B.SCENES.find((x) => x.id === process.argv[2]);
  await 開く(d, 3984, sc, { fx: 'normal' });
  const r = await d.ev(`(function(){ var A = document.getAnimations(); A.forEach(function(a){ a.pause(); });
    var out = [], parts = Array.prototype.slice.call(document.querySelectorAll('.screen.active .v2-sogauge .v2-sog-m b, .screen.active .v2-sogauge .v2-sog-m i, .screen.active .v2-sog-flag, .screen.active .v2-sog-rk'));
    for (var t = 0; t <= 5000; t += 100) {
      A.forEach(function(a){ a.currentTime = t; });
      parts.forEach(function(p){ var S = p.getBoundingClientRect(); var who = (p.textContent || p.parentNode.className || p.className).trim();
      document.querySelectorAll('.screen.active .v2-sobb').forEach(function(b){
        var cs = getComputedStyle(b); if (cs.visibility === 'hidden') return;
        var R = b.getBoundingClientRect();
        var ox = Math.min(R.right, S.right) - Math.max(R.left, S.left), oy = Math.min(R.bottom, S.bottom) - Math.max(R.top, S.top);
        if (ox > 0 && oy > 0) out.push(t + 'ms ' + who + ' ← ' + b.textContent + ' x' + Math.round(R.left) + '-' + Math.round(R.right) + ' y' + Math.round(R.top));
      });
      });
    }
    return out; })()`);
  console.log(r.length ? r.join('\n') : '重なり無し');
  await br.close(); s.close();
})();
