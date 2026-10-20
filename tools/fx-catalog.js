#!/usr/bin/env node
// tools/fx-catalog.js — 棚卸し（fx-inventory）と記録（fx-census）を突き合わせて、演出を1行ずつの表にする（指示62-3）
//
//   node tools/fx-inventory.js && node tools/fx-catalog.js
//
// 行の決め方（「同じ部品を別の場所で使っている時は、場所ごとに1行」）
//   fx   … FxKit の部品を呼んでいる場所1か所＝1行（待つだけの hold/linger/stage などの段取りは行にしない）
//   snd  … 効果音を鳴らしている場所1か所＝1行（音の関数の中で別の音を呼んでいる所は、音の中身なので行にしない）
//   vib  … 振動を鳴らしている場所1か所＝1行（FxKit.vibe は fx の行）
//   css  … @keyframes を animation で当てている規則1本＝1行（FxKit の部品の中身＝.fx-* は、その部品の行に含める）
//   tr   … transition を持つ規則1本＝1行 ／ act … 押した手ごたえ（:active）の規則1本＝1行
//
// 記録との突き合わせ
//   fx・snd・vib … 記録係が拾ったスタックの「呼んだ行」で照らす（同じ部品でも呼んだ行が違えば別の行）
//   css … アニメの名前＋要素の class が選択子の class を全部持っているか
//   tr・act … プロパティ＋要素の class
// 設定①〜⑤ごとに、出た回数・どのカセット・どの端末・長さ（宣言の長さ／部品が置かれていた時間）を集める。
//
// 出力：docs/監査_演出の画像/catalog.json（行と、設定どおりでないものの候補）

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'docs', '監査_演出の画像');
const inv = JSON.parse(fs.readFileSync(path.join(DIR, 'inventory.json'), 'utf8'));
const censusDir = path.join(DIR, 'census');
const 記録たち = fs.existsSync(censusDir) ? fs.readdirSync(censusDir).filter((f) => /\.json$/.test(f)).map((f) => JSON.parse(fs.readFileSync(path.join(censusDir, f), 'utf8'))) : [];

// ---- 物差し（keyframes の中身を読んで決めた。指示62-3 の 正本6 の確かめに使う） ----
// 強い光（画面いっぱい・縁の明滅・閃光）＝「光の点滅を使わない」で止まるべきもの
const 強い光 = new Set(['fxEdge', 'edgeGlow', 'flashHit', 'fxFlashGood', 'fxFlashBad', 'fxDawn', 'bgmBeatFade', 'dangerEdge', 'livesBreak', 'bombBoom', 'nightWipe', 'fxCelGlow', 'tutRingGlow']);
// 穏やかな明滅（待っている間の脈・急かす脈）。安全の設定で止めるべきかは「迷った」
const 穏やかな明滅 = new Set(['fxAlive', 'fxAliveMoon', 'fxAliveLamp', 'fxAliveBreath', 'fxAliveSumi', 'fxAliveCandle', 'aiWaitPulse', 'timerHurry', 'nextGlow']);
const 揺れ = new Set(['shakeX', 'fxShake', 'fxShakeBig', 'bombShake', 'sugoShiver']);
const 段取り = new Set(['hold', 'linger', 'stage', 'stageClear', 'init', 'skipNow', 'busy', 'stageState']);
// FxKit の部品が置く要素（置かれていた時間＝見えていた長さ）
const 部品の要素 = { flash: 'fx-flash', burst: 'fx-burst', banner: 'fx-banner', shutter: 'fx-banner', blackout: 'fx-blackout',
  celebrate: 'fx-cel', edge: 'fx-edge', dawn: 'fx-dawn', countdown: 'fx-countdown', notice: 'fx-notice', fly: 'fx-fly' };
// 部品の CSS（.fx-* の keyframes）を、どの部品のものか
const 部品の動き = { fxFlashGood: 'flash', fxFlashBad: 'flash', fxBannerIn: 'banner', fxBannerOut: 'banner', fxBurst: 'burst', fxShutterIn: 'shutter',
  fxBlackoutOut: 'blackout', fxEdge: 'edge', fxDawn: 'dawn', fxShake: 'shake', fxShakeBig: 'shake', fxRowIn: 'stagger', fxHit: 'fly', fxFlipA: 'flip', fxFlipB: 'flip',
  fxConfettiFall: 'confetti', bigCdPulse: 'countdown' };

const 秒 = (s) => { if (s == null) return null; const v = String(s).split(',')[0].trim(); return /ms$/.test(v) ? parseFloat(v) / 1000 : parseFloat(v); };
const { 名前 } = require('./fx-src');
// スタックの1段。名前の無い関数（function(){…} の受け口）は、ソースから囲む関数の名前を引く
const 頁 = (f) => { const m = f.match(/^(.*)@(.*):(\d+)$/); if (!m) return null; let file = m[2]; if (!/\.js$/.test(file) && file !== '<anonymous>') file = 'index';
  let 名 = m[1]; if (file !== '<anonymous>' && (名 === '?' || /anonymous|^HTML\w*Element\.|^Object\.|^Array\./.test(名))) 名 = 名前(file, +m[3]) || 名;
  return { 名: 名.replace(/^Object\./, ''), file, 行: +m[3] }; };

// ---- 行を作る ----
const 行 = [];
let n = 0;
const 番 = (p) => p + '-' + String(++n).padStart(3, '0');
const 音の関数 = new Set(inv.音の関数);
inv.A.filter((a) => !段取り.has(a.部品)).forEach((a) => 行.push({ id: 番('E'), 種: 'fx', 部品: a.部品, ファイル: a.ファイル, 行: a.行, 関数: a.関数, 文: a.文,
  鍵: a.部品 + '@' + (a.ファイル === 'index.html' ? '' : a.ファイル + ':') + a.行 }));
// FxKit の音の表（good/tick など・index.html の FxKit.init）は、部品の行の「音」として数える
const 音の表 = /^(good|bad|tick|big|cheer)$/;
inv.D.filter((d) => !音の関数.has(d.関数) && !音の表.test(d.関数)).forEach((d) => 行.push({ id: 番('E'), 種: 'snd', 部品: d.音, 行: d.行, 関数: d.関数, 文: d.文, 鍵: 'snd:' + d.音 + '@' + d.行 }));
// 音の関数の中の振動（wrongSound の doVibrate(150) など）は、その音の行の「振動」として数える。doVibrate 自身も行にしない
inv.E.filter((e) => e.入口 === 'E' && !音の関数.has(e.関数) && e.関数 !== 'doVibrate').forEach((e) => 行.push({ id: 番('E'), 種: 'vib', 部品: (e.文.match(/(doVibrate|navigator\.vibrate|countdownVibe)/) || [])[1], 行: e.行, 関数: e.関数, 文: e.文, 鍵: 'vib@' + e.行 }));
const 部品のCSS = [];
inv.B.forEach((b) => {
  if (部品の動き[b.keyframes] || /(^|[\s,.])fx-/.test(b.選択子)) { 部品のCSS.push(b); return; }
  行.push({ id: 番('E'), 種: 'css', 部品: b.keyframes, 選択子: b.選択子, 行: b.行, 宣言: b.宣言, 速さに乗る: b.速さに乗る, 鍵: 'css:' + b.keyframes + '|' + b.選択子 });
});
inv.C.forEach((c) => 行.push({ id: 番('E'), 種: 'tr', 選択子: c.選択子, 行: c.行, 宣言: c.宣言, 速さに乗る: c.速さに乗る, 鍵: 'tr:' + c.選択子 }));
inv.手ごたえ.forEach((c) => 行.push({ id: 番('E'), 種: 'act', 選択子: c.選択子, 行: c.行, 宣言: c.宣言, 鍵: 'act:' + c.選択子 }));
const 鍵で = {}; 行.forEach((r) => { 鍵で[r.鍵] = r; r.観測 = {}; });

// css の行を keyframes ごとに引く（要素の class で選ぶ）
const cssの行 = {}; 行.filter((r) => r.種 === 'css').forEach((r) => { (cssの行[r.部品] = cssの行[r.部品] || []).push(r); });
const 選択子のclass = (sel) => {
  // 最後の複合選択子（対象）の class だけを見る。:active などは外す
  const last = sel.split(',').map((x) => x.trim()).map((x) => x.split(/\s+|>/).filter(Boolean).pop() || '');
  return last.map((x) => ((x.replace(/::?[\w-]+(\([^)]*\))?/g, '')).match(/\.[\w-]+|#[\w-]+/g) || []));
};
const 当たる = (sel, el) => 選択子のclass(sel).some((need) => need.length && need.every((t) => (t[0] === '#' ? el.indexOf(t) !== -1 : new RegExp('\\.' + t.slice(1).replace(/[-]/g, '\\-') + '(\\.|$)').test(el))));
const trの行 = 行.filter((r) => r.種 === 'tr' || r.種 === 'act');

// ---- 記録を行に配る ----
const 見つからない = {};
function 記す(r, set, 記録, e, 長さ) {
  const o = r.観測[set] = r.観測[set] || { 回: 0, カセット: {}, 端末: {}, 画面: {}, 長さ: [] };
  o.回++; o.カセット[記録.カセット] = 1; o.端末[e.dev] = 1; if (e.scr) o.画面[e.scr] = 1;
  if (長さ != null && !isNaN(長さ)) o.長さ.push(長さ);
}
const 余り = {};
const 部品の長さ = {}, 光と揺れ = {}, 光と揺れの場所 = {};
記録たち.forEach((記録) => {
  const set = String((記録.設定 || '').match(/[①②③④⑤]/) ? '①②③④⑤'.indexOf(記録.設定[0]) + 1 : 0);
  const ev = 記録.記録;
  // 端末ごとに、要素の置かれた／外れた時刻を並べる（部品の見えていた時間を出す）
  const 置き = {};
  ev.forEach((e) => { if (e.k === 'node') (置き[e.dev] = 置き[e.dev] || []).push(e); });
  ev.forEach((e) => {
    if (e.k === 'fx') {
      if (段取り.has(e.fn)) return;
      // 呼んだ行：記録係の包み（<anonymous>）と fx.js を飛ばした最初の段。UiKit の vibe() の中継（ui.js:46）も飛ばす
      const fr = (e.from || []).map(頁).filter(Boolean).filter((f) => f.file !== '<anonymous>' && f.file !== 'fx.js' && !(f.file === 'ui.js' && /^(vibe|hold)$/.test(f.名)));
      const 鍵 = fr.length ? e.fn + '@' + (fr[0].file === 'index' ? '' : fr[0].file + ':') + fr[0].行 : null;
      const r = 鍵 && 鍵で[鍵];
      let 長さ = null;
      const cls = 部品の要素[e.fn];
      if (cls) {
        const list = 置き[e.dev] || [];
        const add = list.find((x) => x.ev === 'add' && x.t >= e.t - 5 && x.t <= e.t + 2500 && x.el.indexOf('.' + cls) !== -1);
        if (add) { const del = list.find((x) => x.ev === 'del' && x.t >= add.t && x.el.split('.').slice(0, 2).join('.') === add.el.split('.').slice(0, 2).join('.')); if (del) 長さ = (del.t - add.t) / 1000; }
      }
      if (r) 記す(r, set, 記録, e, 長さ); else { const k = 'fx ' + e.fn + ' ' + (e.from || []).slice(0, 3).join(' < '); 余り[k] = (余り[k] || 0) + 1; }
      return;
    }
    if (e.k === 'snd' || e.k === 'vib') {
      const fr = (e.from || []).map(頁).filter(Boolean);
      // FxKit の部品の中で鳴った音・振動は、その部品を呼んだ行の印にする
      const 部品内 = fr.map((f, i) => ({ f, i })).filter((x) => x.f.file === 'fx.js');
      if (部品内.length) {
        const 外 = 部品内[部品内.length - 1];
        // 部品の中の小さな関数（3-2-1 の show など）は、その部品の名前に読みかえる
        const api = ({ show: 'countdown', step: 'countdown', buzzIt: 'vibe' })[外.f.名] || 外.f.名.replace(/^Object\./, '');
        const 呼んだ = fr.slice(外.i + 1).find((f) => f.file !== '<anonymous>' && f.file !== 'fx.js' && !(f.file === 'ui.js' && /^(vibe|hold)$/.test(f.名)));
        const r = 呼んだ && (鍵で[api + '@' + (呼んだ.file === 'index' ? '' : 呼んだ.file + ':') + 呼んだ.行]);
        if (r) { r.音や振動 = r.音や振動 || {}; r.音や振動[e.k + set] = (r.音や振動[e.k + set] || 0) + 1; }
        else if (呼んだ) { const k = e.k + '（' + api + ' の中）' + api + '@' + 呼んだ.行; 余り[k] = (余り[k] || 0) + 1; }
        return;
      }
      if (e.k === 'snd') {
        // 鳴らした音の関数（いちばん外側）と、それを呼んだ行
        let i = fr.findIndex((f) => 音の関数.has(f.名));
        if (i === -1) { const k = 'snd ' + fr.slice(0, 3).map((f) => f.名 + '@' + f.行).join(' < '); 余り[k] = (余り[k] || 0) + 1; return; }
        while (i + 1 < fr.length && 音の関数.has(fr[i + 1].名)) i++;
        const 呼 = fr[i + 1];
        let r = 呼 && 鍵で['snd:' + fr[i].名 + '@' + 呼.行];
        if (!r && !呼) {
          // 時計（setInterval など）から直に鳴っている。その音を鳴らす場所が1か所ならそこ、無ければ「時計から」の行を作る
          const 同じ音 = 行.filter((x) => x.種 === 'snd' && x.部品 === fr[i].名);
          r = 同じ音.length === 1 ? 同じ音[0] : (鍵で['snd:' + fr[i].名 + '@時計'] || (function () {
            const nr = { id: 番('E'), 種: 'snd', 部品: fr[i].名, 行: null, 関数: '（時計から直に鳴る）', 文: '', 鍵: 'snd:' + fr[i].名 + '@時計', 観測: {} };
            行.push(nr); 鍵で[nr.鍵] = nr; return nr; })());
        }
        if (!r && 呼 && 呼.file === 'index') {
          // 棚卸しの書き方（tick() の呼び方など）で拾えなかった呼び出し。見つけた所で行を作る（一覧から漏らさない）
          const nr = { id: 番('E'), 種: 'snd', 部品: fr[i].名, 行: 呼.行, 関数: 呼.名 + '（記録で見つけた）', 文: '', 鍵: 'snd:' + fr[i].名 + '@' + 呼.行, 観測: {} };
          行.push(nr); 鍵で[nr.鍵] = nr; r = nr;
        }
        if (r) 記す(r, set, 記録, e, null); else { const k = 'snd ' + fr[i].名 + ' ← ' + (呼 ? 呼.名 + '@' + 呼.行 : '?'); 余り[k] = (余り[k] || 0) + 1; }
        return;
      }
      // 振動：doVibrate／countdownVibe を呼んだ行
      const j = fr.findIndex((f) => /doVibrate|countdownVibe/.test(f.名));
      let 呼 = j !== -1 ? fr[j + 1] : null;
      if (呼 && 音の関数.has(呼.名)) {
        // 音に付いた振動：その音を鳴らした場所の行の印にする
        let i = j + 1;
        while (i + 1 < fr.length && 音の関数.has(fr[i + 1].名)) i++;
        const 鳴らした = fr[i + 1];
        let r2 = 鳴らした && 鍵で['snd:' + fr[i].名 + '@' + 鳴らした.行];
        if (!r2 && !鳴らした) { const 同じ音 = 行.filter((x) => x.種 === 'snd' && x.部品 === fr[i].名); r2 = 同じ音.length === 1 ? 同じ音[0] : 鍵で['snd:' + fr[i].名 + '@時計']; }
        if (r2) { r2.音や振動 = r2.音や振動 || {}; r2.音や振動['vib' + set] = (r2.音や振動['vib' + set] || 0) + 1; return; }
        const k = 'vib（音 ' + fr[i].名 + ' の中）← ' + (鳴らした ? 鳴らした.名 + '@' + 鳴らした.行 : '?'); 余り[k] = (余り[k] || 0) + 1; return;
      }
      const r = 呼 && 鍵で['vib@' + 呼.行];
      if (r) 記す(r, set, 記録, e, null); else { const k = 'vib ' + fr.slice(0, 3).map((f) => f.名 + '@' + f.行).join(' < '); 余り[k] = (余り[k] || 0) + 1; }
      return;
    }
    if (e.k === 'anim' && e.ev === 'start') {
      const 部品 = 部品の動き[e.name];
      const cand = cssの行[e.name] || [];
      const r = cand.find((x) => 当たる(x.選択子, e.el + (e.pe ? '' : ''))) || (cand.length === 1 ? cand[0] : null);
      if (r) 記す(r, set, 記録, e, 秒(e.dur));
      else if (!部品 && !/^fx/.test(e.name)) { const k = 'anim ' + e.name + ' ' + e.el; 余り[k] = (余り[k] || 0) + 1; }
      // 部品の中身の動き（.fx-*）は、部品ごとの宣言の長さとして集める
      if (部品 || /^fx/.test(e.name)) { const k = e.name; (部品の長さ[k] = 部品の長さ[k] || {})[set] = (部品の長さ[k][set] || []).concat([秒(e.dur)]); }
      // 光・揺れの記録（設定どおりかを見る）
      if (強い光.has(e.name) || 揺れ.has(e.name) || 穏やかな明滅.has(e.name)) {
        const k = e.name; (光と揺れ[k] = 光と揺れ[k] || {})[set] = (光と揺れ[k][set] || 0) + 1;
        (光と揺れの場所[k] = 光と揺れの場所[k] || {})[記録.カセット + '/' + e.dev + '/' + e.scr] = 1;
      }
      return;
    }
    if (e.k === 'tr' && e.ev === 'start') {
      const r = trの行.find((x) => 当たる(x.選択子, e.el) && (x.宣言 || '').indexOf(e.prop) !== -1) || trの行.find((x) => 当たる(x.選択子, e.el) && /\ball\b/.test(x.宣言 || ''));
      if (r) 記す(r, set, 記録, e, 秒(e.dur));
      return;
    }
  });
});

// ---- まとめる ----
const 中 = (a) => { if (!a || !a.length) return null; const b = a.slice().sort((x, y) => x - y); return Math.round(b[Math.floor(b.length / 2)] * 1000) / 1000; };
行.forEach((r) => {
  r.設定別 = {};
  for (let s = 1; s <= 5; s++) {
    const o = r.観測[s];
    const sv = r.音や振動 || {};
    r.設定別[s] = o ? { 回: o.回, 出た: o.長さ.length, カセット: Object.keys(o.カセット), 端末: Object.keys(o.端末), 画面: Object.keys(o.画面).slice(0, 6), 長さ: 中(o.長さ), 最長: o.長さ.length ? Math.max.apply(null, o.長さ) : null,
      鳴った音: sv['snd' + s] || 0, 鳴った振動: sv['vib' + s] || 0 } : null;
  }
  delete r.観測;
});
// ---- 設定どおりでないものの候補（最後は人が画像と記録で確かめる） ----
const 候補 = [];
行.forEach((r) => {
  const a = r.設定別;
  if (a[3] && a[3].長さ != null && a[3].長さ > 0.05 && (r.種 === 'css' || r.種 === 'tr')) 候補.push({ 型: '③スキップなのに動く', id: r.id, 何: r.部品 || r.選択子, 長さ: a[3].長さ, 回: a[3].回, どこ: a[3].カセット.join('・') });
  if (r.種 === 'fx' && a[3] && a[3].長さ != null && a[3].長さ > 0.3) 候補.push({ 型: '③スキップなのに出ている（部品が置かれていた秒）', id: r.id, 何: r.部品 + '@' + r.行 + '（' + r.関数 + '）', 長さ: a[3].長さ, 回: a[3].回, どこ: a[3].カセット.join('・') });
  if ((r.種 === 'css') && a[1] && a[2] && a[1].長さ >= 0.2 && a[2].長さ != null && Math.abs(a[2].長さ - a[1].長さ) < 0.01) 候補.push({ 型: '②速いが効かない（宣言の長さが同じ）', id: r.id, 何: r.部品 + ' ' + r.選択子, 長さ: a[1].長さ });
  if (r.種 === 'fx' && /^(flash|edge|dawn)$/.test(r.部品) && a[4] && a[4].出た) 候補.push({ 型: '④光を切ったのに呼ばれて出た', id: r.id, 何: r.部品 + '@' + r.行, 回: a[4].回, 長さ: a[4].長さ });
  if (r.種 === 'fx' && r.部品 === 'shake' && a[5] && a[5].長さ) 候補.push({ 型: '⑤揺れを切ったのに出た', id: r.id, 何: r.部品 + '@' + r.行 });
});
Object.keys(光と揺れ).forEach((k) => {
  const v = 光と揺れ[k];
  if (強い光.has(k) && v[4]) 候補.push({ 型: '④光の点滅を切ったのに、強い光のアニメが走った', 何: k, 回: v[4], どこ: Object.keys(光と揺れの場所[k]).slice(0, 6).join(' ／ ') });
  if (穏やかな明滅.has(k) && v[4]) 候補.push({ 型: '④光の点滅を切っても、穏やかな明滅は走る（迷った）', 何: k, 回: v[4], どこ: Object.keys(光と揺れの場所[k]).slice(0, 4).join(' ／ ') });
  if (揺れ.has(k) && v[5]) 候補.push({ 型: '⑤画面の揺れを切ったのに、揺れのアニメが走った', 何: k, 回: v[5], どこ: Object.keys(光と揺れの場所[k]).slice(0, 6).join(' ／ ') });
});
// 正本 正本4：長さ（0.15／0.25／0.75、並べ替えだけ 0.4）と曲線（3つ）
const 長さの正本 = [0.15, 0.25, 0.75, 0.4];
const 曲線の正本 = ['cubic-bezier(.32,.72,0,1)', 'cubic-bezier(.2,1.6,.4,1)', 'cubic-bezier(.2,1.5,.4,1)'];
const 正本4 = [];
inv.B.concat(inv.C).forEach((b) => {
  const decl = (b.宣言 || '').replace(/\s+/g, '');
  const 長さ = (decl.match(/(?:calc\()?(\d*\.?\d+)(m?s)/g) || []).map((x) => { const m = x.match(/(\d*\.?\d+)(m?s)/); return m[2] === 'ms' ? +m[1] / 1000 : +m[1]; });
  const 曲線 = decl.match(/cubic-bezier\([^)]*\)|ease-in-out|ease-out|ease-in|ease|linear|steps\([^)]*\)/g) || [];
  const 外れ長さ = 長さ.filter((x) => x > 0.001 && 長さの正本.indexOf(Math.round(x * 100) / 100) === -1);
  const 外れ曲線 = 曲線.filter((c) => 曲線の正本.indexOf(c.replace(/0\./g, '.')) === -1);
  if (外れ長さ.length || 外れ曲線.length) 正本4.push({ 何: (b.keyframes ? b.keyframes + ' ' : '') + b.選択子, 行: b.行, 長さ: 外れ長さ, 曲線: 外れ曲線 });
});
// 正本 正本6：点滅は1秒に3回まで（くり返す強い光の1周の長さ）
const 正本6 = [];
inv.B.forEach((b) => {
  if (!(強い光.has(b.keyframes) || 穏やかな明滅.has(b.keyframes))) return;
  if (!/infinite/.test(b.宣言)) return;
  const m = (b.宣言.match(/(\d*\.?\d+)(m?s)/) || []); const 周 = m[2] === 'ms' ? +m[1] / 1000 : +m[1];
  正本6.push({ 何: b.keyframes + ' ' + b.選択子, 行: b.行, 一周の秒: 周, 一秒あたり: 周 ? Math.round(10 / 周) / 10 : null, 三回を超える: 周 && 1 / 周 > 3 });
});

const out = { 作った: new Date().toISOString(), 記録の数: 記録たち.map((x) => x.カセット + '_' + x.設定 + (x.失敗 ? '（途中で止まった）' : '')),
  行, 部品のCSS: 部品のCSS.map((b) => ({ keyframes: b.keyframes, 選択子: b.選択子, 行: b.行, 宣言: b.宣言, 速さに乗る: b.速さに乗る, 設定別の宣言: 部品の長さ[b.keyframes] ? Object.fromEntries(Object.entries(部品の長さ[b.keyframes]).map(([k, v]) => [k, 中(v)])) : null })),
  光と揺れ, 光と揺れの場所, 候補, 正本4, 正本6, 突き合わせられなかった記録: Object.entries(余り).sort((a, b) => b[1] - a[1]).slice(0, 80) };
fs.writeFileSync(path.join(DIR, 'catalog.json'), JSON.stringify(out, null, 1));
const 種 = {}; 行.forEach((r) => { 種[r.種] = (種[r.種] || 0) + 1; });
console.log('行 ' + 行.length + '：' + JSON.stringify(種) + ' ／ 記録 ' + 記録たち.length + '本');
console.log('出た行（①）：' + 行.filter((r) => r.設定別[1]).length + ' ／ 一度も出ない行：' + 行.filter((r) => ![1, 2, 3, 4, 5].some((s) => r.設定別[s])).length);
console.log('設定どおりでない候補 ' + 候補.length + ' ／ 正本4 から外れる ' + 正本4.length + ' ／ 正本6 のくり返す光 ' + 正本6.length + '（3回超 ' + 正本6.filter((x) => x.三回を超える).length + '）');
console.log('突き合わせられなかった記録（種類）' + Object.keys(余り).length);
