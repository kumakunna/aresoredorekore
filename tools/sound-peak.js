// tools/sound-peak.js — 見せ場の音を重ねて、出てくる音のピークを測る（指示68-T 4）
//
//   node tools/sound-peak.js            … 3場面を測って、表と docs/監査_指示68-Tの画像/sound-peak.json を書く
//   node tools/sound-peak.js --no-limit … くらべるため、リミッターを外した時も測る
//
// **本番と同じ鳴らし方**で測る：
//   1. Chrome（tools/cdp.js）で public/ を開き、見せ場の音を出す関数（index.html の onajiFx・soroeFx・bombFinale）を
//      見本データ（本物の進行役で作った物・tools/v2-lab/）で本当に動かす。そのとき Sound.play を横取りして「何を・いつ」だけ記録する
//   2. OfflineAudioContext に、本物の音の箱（sound.js：同じ音は3つまで）と本物の出口（index.html の sfxOut：
//      リミッター → 音量のつまみ）をつないで、記録した時刻に Sound.play を呼ぶ（suspend で止めて鳴らす）
//   3. できた音の、いちばん大きい所（ピーク）を dBFS で数える。−1dB を超えたら赤（終わりの数が 1）
// 音量は、まっさらな端末の設定（効果音の音量の既定）と、いちばん大きい 100 の2つ
const fs = require('fs');
const path = require('path');
const { launch } = require('./cdp');
const { 配り手, ROOT } = require('./v2-lab/open');
const OnajiScenes = require('./v2-lab/onaji-scenes');
const ButtonScenes = require('./v2-lab/button-scenes');

const PORT = 3463;
const LIMIT_DB = -1;
const noLimit = process.argv.includes('--no-limit');

/** 場面：run はページの中で見せ場を動かす式（記録の間 Sound.play は鳴らさずに書くだけ） */
const SCENES = [
  { id: 'onaji16', name: '① 16人のみんなと同じの開く（TV）', lab: () => OnajiScenes.view('onaji-tv-unveil16'),
    run: (lab) => 'window.v2GameFxProbe("onaji", ' + JSON.stringify(lab) + ', true)', sec: 5 },
  // 火の粒は 0.05秒より近い物を1つにまとめるので、16回近く鳴るのは差が大きい回（ぽてっ）。そろった回（宇宙）は粒が少ない
  { id: 'soroe16', name: '② 16人のそろえて発射の点火（TV・ぽてっ＝火の粒がいちばん多い）', lab: () => ButtonScenes.view('so-tv-plop16'),
    run: (lab) => 'window.v2GameFxProbe("soroe", ' + JSON.stringify(lab) + ', true)', sec: 6 },
  { id: 'soroe16space', name: '②b 16人のそろえて発射（TV・宇宙・歓声まで）', lab: () => ButtonScenes.view('so-tv-film-space16'),
    run: (lab) => 'window.v2GameFxProbe("soroe", ' + JSON.stringify(lab) + ', true)', sec: 6 },
  // 爆発の幕と解除の幕を同時に動かし、爆発が鳴るころに歓声（cheer）を2つ重ねる（いちばん重なる形。ふだんの幕に歓声は無い）
  { id: 'bomb', name: '③ クイズ解除の爆発と歓声（TV・爆発の幕＋解除の幕＋歓声2つ）', lab: () => null,
    run: () => '(function(){ window.bombFinaleProbe({ success: false, tv: true, left: 2, cause: "lives", total: 30, solved: 28 });' +
      ' window.bombFinaleProbe({ success: true, tv: true, names: ["ふう","ひろ","びび","ちか","でん","えみ","あき","くまくん"], lives: 2, total: 30, solved: 30, sec: 41 });' +
      ' [0.75, 0.8].forEach(function(s){ setTimeout(function(){ Sound.play("cheer"); }, s * 1000); });' +
      ' return 1; })()', sec: 9 }
];

/** ページの中：記録を始める（Sound.play を横取り） */
const 記録を始める = `(function(){
  window.__sp = { t0: performance.now(), log: [] };
  window.__spOrig = window.__spOrig || Sound.play;
  Sound.play = function(id, opt){ window.__sp.log.push({ id: id, opt: opt ? { rate: opt.rate } : null, t: (performance.now() - window.__sp.t0) / 1000 }); return 'rec'; };
  return 1; })()`;
const 記録を終える = `(function(){ Sound.play = window.__spOrig; return window.__sp.log; })()`;

/** ページの中：記録を OfflineAudioContext で鳴らして、ピークを返す */
function 鳴らす式(log, o) {
  return `(async function(){
    var log = ${JSON.stringify(log)}, SR = 48000, len = Math.max(1, ${o.sec});
    var off = new OfflineAudioContext(2, Math.ceil(SR * len), SR);
    var vol = ${o.vol == null ? 'null' : o.vol};
    var plain = ${o.plain ? 'true' : 'false'};
    // 出口：本番の sfxOut（音量のつまみ → リミッター）。plain はリミッターを外した物（くらべるため）
    var out = function(c){
      if(!plain){
        var g0 = window.sfxOutProbe(c);
        if(vol != null) window.sfxVolProbe(c).gain.value = vol;
        return g0;
      }
      if(c.__plain) return c.__plain;
      var g = c.createGain(); g.gain.value = vol != null ? vol : window.sfxVolProbe(c).gain.value; g.connect(c.destination); c.__plain = g; return g;
    };
    Sound.reset();
    Sound.setup({ makeContext: function(){ return off; }, out: out, volume: function(){ return 1; },
      where: function(){ return { tv: true, tvInRoom: true }; }, fetch: function(u){ return fetch(u); } });
    await Sound.preload('all');
    var how = [];
    var q = 128 / SR, groups = {};
    log.forEach(function(x){ var k = Math.max(1, Math.round(x.t / q)); (groups[k] = groups[k] || []).push(x); });
    Object.keys(groups).forEach(function(k){
      var t = (+k) * q;
      if (t >= len) return;
      off.suspend(t).then(function(){ groups[k].forEach(function(x){ how.push(x.id + ':' + Sound.play(x.id, x.opt || undefined)); }); off.resume(); });
    });
    var buf = await off.startRendering();
    var peak = 0;
    for (var ch = 0; ch < buf.numberOfChannels; ch++) { var a = buf.getChannelData(ch); for (var i = 0; i < a.length; i++) { var v = Math.abs(a[i]); if (v > peak) peak = v; } }
    var gain = window.sfxVolProbe(new OfflineAudioContext(1, 128, SR)).gain.value;
    return { peakDb: peak > 0 ? 20 * Math.log10(peak) : -Infinity, how: how, defaultGain: gain };
  })()`;
}

(async function main() {
  const server = await 配り手(PORT);
  const br = await launch({ port: 9341 });
  const out = { at: new Date().toISOString(), limitDb: LIMIT_DB, scenes: [] };
  let bad = 0;
  try {
    const dev = await br.newDevice('TV', { width: 1920, height: 1080 });
    await dev.go('http://127.0.0.1:' + PORT + '/');
    await dev.until('window.Sound && window.sfxOutProbe && window.v2GameFxProbe && window.bombFinaleProbe && window.V2Onaji', 15000, 'ページ');
    for (const sc of SCENES) {
      const lab = sc.lab();
      await dev.ev(記録を始める);
      await dev.ev(sc.run(lab));
      await new Promise((r) => setTimeout(r, sc.sec * 1000));
      const log = await dev.ev(記録を終える);
      await dev.ev("(function(){ document.querySelectorAll('.fx-finale,.fx-cue').forEach(function(n){ n.remove(); }); return 1; })()");
      const row = { id: sc.id, name: sc.name, played: log.length, ids: [...new Set(log.map((x) => x.id))].join('・') };
      for (const [k, o] of [['既定の音量', {}], ['音量100', { vol: 1 }]].concat(noLimit ? [['音量100・リミッターなし', { vol: 1, plain: true }]] : [])) {
        const r = await dev.ev(鳴らす式(log, Object.assign({ sec: sc.sec + 3 }, o)));
        row[k] = Math.round(r.peakDb * 100) / 100;
        row.full = r.how.filter((h) => /:full$/.test(h)).length;
        row.defaultGain = r.defaultGain;
        if (!o.plain && r.peakDb > LIMIT_DB) bad++;
      }
      out.scenes.push(row);
      console.log(sc.name + '：鳴らした ' + row.played + '回（' + row.ids + '）・3つを超えて鳴らさなかった ' + row.full + '回・ピーク 既定 ' + row['既定の音量'] + 'dB／音量100 ' + row['音量100'] + 'dB' +
        (noLimit ? '／リミッターなし ' + row['音量100・リミッターなし'] + 'dB' : ''));
    }
    console.log('既定の音量のつまみ：' + (out.scenes[0] || {}).defaultGain);
    await dev.close();
  } finally {
    await br.close();
    server.close();
  }
  const dir = path.join(ROOT, 'docs', '監査_指示68-Tの画像');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'sound-peak.json'), JSON.stringify(out, null, 1));
  console.log(bad ? '✖ ピークが ' + LIMIT_DB + 'dB を超えた場面がある' : '✔ 3場面とも、ピークは ' + LIMIT_DB + 'dB 以下');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
