// tools/sound-volume.js — 効果音の音量のつまみが、本当に音の大きさを変えているかを数で見る（指示68-T・smoke.js の赤の前に）
//
//   node tools/sound-volume.js   … 音量 0・35・70・100 で同じ場面を鳴らし、ピークを表にする。docs/監査_指示68-Tの画像/sound-volume.json も書く
//
// **本番と同じ道すじ**で測る（つまみの値を横から書き換えない）：
//   1. Chrome（tools/cdp.js）で public/ を開き、設定の「効果音」の入力欄（#setSeVol）に値を入れて input を起こす
//      （bindPref → applyAppPrefs → refreshSfxGain。人が指で動かした時と同じ）
//   2. OfflineAudioContext に、本物の音の箱（sound.js）と本物の出口（index.html の sfxOut：リミッター → つまみ）をつなぐ。
//      音の箱の「鳴らすかどうか」も本物の音量（prefsProbe().se）で決める
//   3. クイズ解除の爆発と歓声（tools/sound-peak.js の③と同じ場面）を記録して、同じ時刻に鳴らす。ピークを dBFS で数える
// 2つの形を測る：
//   ・先に決める … つまみを動かしてから、新しい音の場を作る（端末を開いた時）
//   ・あとで動かす … 音量100で出口を作り置きしたあとに、つまみを動かす（遊んでいる途中で設定を変えた時）
// 合格：0 は無音（ピーク −∞）。35 < 70 < 100 の順に大きく、35 と 100 の差が 20·log10(35/100) ≈ −9.1dB（±0.5dB まで。つまみがリミッターの後ろにあるので、比どおりになるはず）。
//      「先に決める」と「あとで動かす」が同じ値
const fs = require('fs');
const path = require('path');
const { launch } = require('./cdp');
const { 配り手, ROOT } = require('./v2-lab/open');

const PORT = 3464;
const VOLS = [0, 35, 70, 100];
const SEC = 9;

const 場面 = '(function(){ window.bombFinaleProbe({ success: false, tv: true, left: 2, cause: "lives", total: 30, solved: 28 });' +
  ' window.bombFinaleProbe({ success: true, tv: true, names: ["ふう","ひろ","びび","ちか"], lives: 2, total: 30, solved: 30, sec: 41 });' +
  ' [0.75, 0.8].forEach(function(s){ setTimeout(function(){ Sound.play("cheer"); }, s * 1000); });' +
  ' return 1; })()';

const 記録を始める = `(function(){
  window.__sp = { t0: performance.now(), log: [] };
  window.__spOrig = window.__spOrig || Sound.play;
  Sound.play = function(id, opt){ window.__sp.log.push({ id: id, opt: opt ? { rate: opt.rate } : null, t: (performance.now() - window.__sp.t0) / 1000 }); return 'rec'; };
  return 1; })()`;
const 記録を終える = `(function(){ Sound.play = window.__spOrig; return window.__sp.log; })()`;

/** 設定の入力欄を、人が動かしたのと同じに動かす */
const つまみ = (v) => `(function(){ var s = document.getElementById('setSeVol'); s.value = ${v};
  s.dispatchEvent(new Event('input', { bubbles: true })); return window.prefsProbe().se; })()`;

/** later：音量100で出口を作り置きしてから、つまみを v に動かす */
function 鳴らす式(log, v, later) {
  return `(async function(){
    var log = ${JSON.stringify(log)}, SR = 48000, len = ${SEC + 3};
    var set = function(x){ var s = document.getElementById('setSeVol'); s.value = x; s.dispatchEvent(new Event('input', { bubbles: true })); };
    set(${later ? 100 : v});
    var off = new OfflineAudioContext(2, Math.ceil(SR * len), SR);
    var out = window.sfxVolProbe(off);          // 本物の出口の、音量のつまみ（作った時の音量が入る）
    var made = out.gain.value;
    // 同じ音にいくつか版があり、どれを鳴らすかはくじ（音の箱の rnd）。くらべるので、毎回同じ並びのくじにする
    var seed = 7, rnd = function(){ seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    if (${later ? 'true' : 'false'}) set(${v});  // 作り置きのあとに動かす
    Sound.reset();
    Sound.setup({ makeContext: function(){ return off; }, out: window.sfxOutProbe, rnd: rnd,
      volume: function(){ return window.prefsProbe().se / 100; },
      where: function(){ return { tv: true, tvInRoom: true }; }, fetch: function(u){ return fetch(u); } });
    await Sound.preload('all');
    var how = [], q = 128 / SR, groups = {};
    log.forEach(function(x){ var k = Math.max(1, Math.round(x.t / q)); (groups[k] = groups[k] || []).push(x); });
    Object.keys(groups).forEach(function(k){
      var t = (+k) * q;
      if (t >= len) return;
      off.suspend(t).then(function(){ groups[k].forEach(function(x){ how.push(Sound.play(x.id, x.opt || undefined)); }); off.resume(); });
    });
    var buf = await off.startRendering();
    var peak = 0;
    for (var ch = 0; ch < buf.numberOfChannels; ch++) { var a = buf.getChannelData(ch); for (var i = 0; i < a.length; i++) { var y = Math.abs(a[i]); if (y > peak) peak = y; } }
    return { peakDb: peak > 0 ? 20 * Math.log10(peak) : null, made: made, gain: out.gain.value, se: window.prefsProbe().se,
      file: how.filter(function(h){ return h === 'file'; }).length, off: how.filter(function(h){ return h === 'off'; }).length };
  })()`;
}

(async function main() {
  const server = await 配り手(PORT);
  const br = await launch({ port: 9342 });
  const out = { at: new Date().toISOString(), rows: [] };
  const bad = [];
  try {
    const dev = await br.newDevice('TV', { width: 1920, height: 1080 });
    await dev.go('http://127.0.0.1:' + PORT + '/');
    await dev.until('window.Sound && window.sfxVolProbe && window.bombFinaleProbe && window.prefsProbe && document.getElementById("setSeVol")', 15000, 'ページ');
    await dev.ev(つまみ(100));
    await dev.ev(記録を始める);
    await dev.ev(場面);
    await new Promise((r) => setTimeout(r, SEC * 1000));
    const log = await dev.ev(記録を終える);
    console.log('場面：クイズ解除の爆発と歓声（TV）・鳴らした ' + log.length + '回');
    for (const v of VOLS) {
      const a = await dev.ev(鳴らす式(log, v, false));
      const b = await dev.ev(鳴らす式(log, v, true));
      const row = { vol: v, se: a.se, 先に決める: a.peakDb, あとで動かす: b.peakDb, つまみ: a.gain, 作り置き後のつまみ: b.gain, 鳴らした: a.file, 鳴らさない: a.off };
      out.rows.push(row);
      const f = (x) => (x == null ? '無音' : x.toFixed(2) + 'dB');
      console.log('音量 ' + String(v).padStart(3) + '：つまみ ' + a.gain.toFixed(2) + '・ピーク ' + f(a.peakDb) + '（あとで動かす：つまみ ' + b.gain.toFixed(2) + '・' + f(b.peakDb) + '）・鳴らした ' + a.file + '回');
      if (a.se !== v) bad.push('音量 ' + v + '：設定に入った値が ' + a.se);
      if (Math.abs(a.gain - v / 100) > 1e-6 || Math.abs(b.gain - v / 100) > 1e-6) bad.push('音量 ' + v + '：出口のつまみが ' + a.gain + '／' + b.gain);
      if (v === 0 && (a.peakDb != null || b.peakDb != null)) bad.push('音量 0 で音が出た');
      if (v > 0 && (a.peakDb == null || b.peakDb == null)) bad.push('音量 ' + v + ' で無音');
      if (a.peakDb != null && b.peakDb != null && Math.abs(a.peakDb - b.peakDb) > 0.01) bad.push('音量 ' + v + '：先に決めるのと、あとで動かすのが違う');
    }
    const pk = (v) => out.rows.find((r) => r.vol === v).先に決める;
    if (!(pk(35) < pk(70) && pk(70) < pk(100))) bad.push('35 < 70 < 100 の順になっていない');
    const d = pk(35) - pk(100), want = 20 * Math.log10(35 / 100);
    out.diff35to100 = d;
    console.log('35 と 100 の差：' + d.toFixed(2) + 'dB（つまみどおりなら ' + want.toFixed(2) + 'dB）');
    if (Math.abs(d - want) > 0.5) bad.push('35 と 100 の差が、つまみの比からずれている（' + d.toFixed(2) + 'dB）');
    await dev.close();
  } finally {
    await br.close();
    server.close();
  }
  out.bad = bad;
  const dir = path.join(ROOT, 'docs', '監査_指示68-Tの画像');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'sound-volume.json'), JSON.stringify(out, null, 1));
  console.log(bad.length ? '✖ ' + bad.join('／') : '✔ 音量のつまみは効いている（0 は無音・大きさはつまみの比どおり）');
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
