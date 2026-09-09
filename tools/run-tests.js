#!/usr/bin/env node
// tools/run-tests.js — 全スイートを走らせて、1つの判定にまとめる（第44弾）
//
// ── なぜ作ったか ──────────────────────────────────
//
// それまでは package.json に `node tests/a.js && node tests/b.js && …` と
// 49本を手書きで並べていた。この形には3つの穴があった。
//
// **① 赤が出ると、そこで止まる。**
// 第42弾の通し運転は45スイート目で止まり、**残り4本が一度も走らなかった**。
// 直して回し直す→また別の場所で止まる、を2日で2回やった。
// 赤は最後まで走らせてから、まとめて見たい。
//
// **② 判定が、パイプの向こうへ簡単にすり替わる。**
// `npm test | grep …` にした瞬間、終了コードは grep のものになる。
// 41スイートで止まっていたのに「exit 0」に見えた（落とし穴28）。
// **判定は運用の心がけではなく、仕組みで固定する。**
//
// **③ 手書きの一覧は腐る。**
// 新しいスイートを足して package.json に書き忘れれば、静かに走らなくなる
// （落とし穴4）。ここでは `tests/` から導き出す。
//
// ── 使い方 ────────────────────────────────────────
//   node tools/run-tests.js            # 全スイート（既定の並走数）
//   node tools/run-tests.js --time     # 遅い順も出す（ACAC_TIME=1 を渡す）
//   node tools/run-tests.js --jobs 1   # 並走なし（迷った時の基準）
//   node tools/run-tests.js --list     # 走らせる一覧と、単独/並走の別を見るだけ
//   node tools/run-tests.js --only shelf   # 名前に shelf を含むものだけ
//
// ── 並走の決めごと（落とし穴11の読み直し）────────────
//
// 落とし穴11は「**無制限の**並走はメモリを食い潰して結果が信じられなくなる」
// という記録で、並走そのものを禁じたものではない。上限を決め、
// **実測したピークメモリ**で足りることを確かめてから並べる。
//
//   ・ピークは各スイートが自分で報告する（harness の resourceUsage().maxRSS）
//   ・**実サーバーを立てるスイートは単独で回す。**
//     ポートは listen(0) なのでぶつからないが、本物のタイマーと
//     ハートビートで進むので、他が回っていると時間の測り方が揺れる
//   ・**重いスイートも単独。**1本で1GB近く使うものを並べても速くならない

const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');

const R = path.join(__dirname, '..');
const TESTS = path.join(R, 'tests');

// ---- 引数 ----
const argv = process.argv.slice(2);
function opt(name, def) {
  const i = argv.indexOf('--' + name);
  if (i < 0) return def;
  const v = argv[i + 1];
  return (v === undefined || v.startsWith('--')) ? true : v;
}
const 計測 = !!opt('time', false);
const 一覧だけ = !!opt('list', false);
const 絞り = opt('only', null);
// 既定は3。**実測で決めた**（第44弾）。
//
// 並走できる36本の合計は1386秒だが、そのうち rt-screens 単体が510秒ある。
// **1本で510秒かかるものがある以上、4本以上に増やしても全体は510秒より速くならない。**
// メモリは最悪の3本（shelf 2.5GB＋smoke 1.0GB＋rt-screens 1.0GB）で4.5GB、
// この機械の空き16GBに対して余裕がある。
// 迷ったら --jobs 1 に落とせば、昔と同じ「1本ずつ」に戻る
const 並走上限 = Math.max(1, parseInt(opt('jobs', 3), 10) || 3);

// ---- 走らせるスイートを、tests/ から導く（手書きの一覧を持たない）----
const 除外 = ['harness.js', 'inventory.js', 'playthrough.js'];
const すべて = fs.readdirSync(TESTS)
  .filter((f) => f.endsWith('.js') && 除外.indexOf(f) < 0)
  .filter((f) => /createRunner\(/.test(fs.readFileSync(path.join(TESTS, f), 'utf8')))
  .sort();

// **単独で回すもの。**「実サーバーを立てるか」はコードから判定する——
// ファイル名で決めると、名前の付け方を変えた日に静かに外れる（落とし穴5）
const 重い = ['wolf-vote.js'];
function 単独か(f) {
  if (重い.indexOf(f) >= 0) return '重い';
  const src = fs.readFileSync(path.join(TESTS, f), 'utf8');
  if (/startTestServer|attachRealtime/.test(src)) return '実サーバー';
  return null;
}

const 対象 = すべて.filter((f) => !絞り || 絞り === true || f.indexOf(String(絞り)) >= 0);
const 単独組 = 対象.filter((f) => 単独か(f));
const 並走組 = 対象.filter((f) => !単独か(f));

if (一覧だけ) {
  console.log('スイート ' + 対象.length + '本（単独 ' + 単独組.length + ' / 並走 ' + 並走組.length + '）');
  対象.forEach((f) => console.log('  ' + (単独か(f) ? '[単独:' + 単独か(f) + '] ' : '[並走]     ') + f));
  process.exit(0);
}

// ---- 1本走らせる ----
function 走らせる(f) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const env = Object.assign({}, process.env, { ACAC_JSON: '1' });
    if (計測) env.ACAC_TIME = '1';
    const ch = cp.spawn(process.execPath, [path.join('tests', f)], { cwd: R, env });
    let out = '';
    ch.stdout.on('data', (d) => { out += d; });
    ch.stderr.on('data', (d) => { out += d; });
    ch.on('close', (code, signal) => {
      // **合否は「機械が読む1行」だけで決める。**日本語の本文を正規表現で
      // 拾う形にすると、文言を直した日に判定が壊れる
      let 報告 = null;
      const m = out.match(/^##ACAC## (.+)$/m);
      if (m) { try { 報告 = JSON.parse(m[1]); } catch (e) { 報告 = null; } }
      resolve({
        file: f, code: code, signal: signal, ms: Date.now() - t0,
        報告: 報告,
        out: out.replace(/^##ACAC## .+$/m, '').replace(/\n{3,}/g, '\n\n')
      });
    });
  });
}

// ---- 上限つきで流す ----
//
// **報告を出さずに落ちたものは、1回だけ単独で回し直す。**
// スイートが1件も報告しないのは「検査が赤」ではなく「測れていない」で、
// 原因は並走そのもの（メモリ・ネイティブの落ち）のことがある。
// ただし**黙って回し直さない**——回し直したことは必ず出す。
// 黙って隠すと、たまに落ちる本物の不具合が「たまたま緑」で通ってしまう
async function 流す(list, 本数) {
  const 結果 = [];
  let i = 0;
  const 走る = async () => {
    while (i < list.length) {
      const f = list[i++];
      let r = await 走らせる(f);
      if (!r.報告) {
        console.log('… ' + f + ' が報告を出さずに終わった（' + (r.signal || r.code) +
          '）。**単独で1回だけ回し直す**');
        const r2 = await 走らせる(f);
        r2.回し直した = true;
        r2.前回 = (r.signal || r.code);
        r = r2;
      }
      結果.push(r);
      印字(r);
    }
  };
  await Promise.all(Array.from({ length: Math.min(本数, list.length) }, 走る));
  return 結果;
}

function 印字(r) {
  const s = r.報告;
  if (r.回し直した) console.log('  ↑ ' + r.file + ' は1回目が報告なし（' + r.前回 + '）で、回し直した結果');
  const 印 = (r.code === 0 && s && s.pass === s.total) ? '✅' : '❌';
  const 数 = s ? (s.pass + '/' + s.total) : '（報告なし）';
  const 秒 = (r.ms / 1000).toFixed(1) + '秒';
  const メ = (s && s.peakKb) ? ' ' + (s.peakKb / 1024).toFixed(0) + 'MB' : '';
  console.log(印 + ' ' + r.file.replace(/\.js$/, '').padEnd(22) + 数.padStart(9) + '  ' + 秒.padStart(7) + メ);
}

(async function main() {
  const t0 = Date.now();
  console.log('■ 全スイート（' + 対象.length + '本／並走上限 ' + 並走上限 +
    '／空きメモリ ' + (os.freemem() / 1073741824).toFixed(1) + 'GB）');
  if (単独組.length) console.log('  単独で回す ' + 単独組.length + '本：' + 単独組.map((f) => f.replace(/\.js$/, '')).join('・'));
  console.log('');

  // **単独組が先。**空きメモリがいちばん多いうちに、重いものを通す
  const a = await 流す(単独組, 1);
  const b = await 流す(並走組, 並走上限);
  const 結果 = a.concat(b);

  // ---- 判定は3つそろって初めて緑（仕組みで固定する）----
  const 走った = 結果.length;
  const 報告あり = 結果.filter((r) => r.報告);
  const 終了コード異常 = 結果.filter((r) => r.code !== 0);
  const 合計成功 = 報告あり.reduce((s, r) => s + r.報告.pass, 0);
  const 合計件数 = 報告あり.reduce((s, r) => s + r.報告.total, 0);
  const 赤 = [];
  結果.forEach((r) => {
    if (!r.報告) {
      赤.push([r.file, '（報告が無い。落ちたか、途中で殺された。終了コード ' + (r.signal || r.code) + '）',
        r.out.trim() ? r.out.trim().split('\n').slice(-8).join('\n         ') : '（出力も残っていない）']);
      return;
    }
    r.報告.failed.forEach((x) => 赤.push([r.file, x.name, x.err]));
  });

  console.log('');
  console.log('══ まとめ ═══════════════════════════════════');
  console.log('  スイート    ' + 走った + ' / ' + 対象.length + '（走らせた / 見つけた）');
  console.log('  検査        ' + 合計成功 + ' / ' + 合計件数);
  console.log('  終了コード  ' + (終了コード異常.length ? '異常 ' + 終了コード異常.length + '本：' +
    終了コード異常.map((r) => r.file + '(' + (r.signal || r.code) + ')').join('・') : 'すべて0'));
  console.log('  かかった時間 ' + ((Date.now() - t0) / 1000).toFixed(1) + '秒');
  const 回し直し = 結果.filter((r) => r.回し直した);
  if (回し直し.length) {
    console.log('  **回し直し  ' + 回し直し.length + '本**：' +
      回し直し.map((r) => r.file + '（1回目 ' + r.前回 + '）').join('・') +
      '  ← たまに落ちている。並走の本数かメモリを疑うこと');
  }

  if (計測) {
    console.log('');
    console.log('── 遅いスイート（上位5本）');
    結果.slice().sort((x, y) => y.ms - x.ms).slice(0, 5).forEach((r) => {
      console.log('  ' + ((r.ms / 1000).toFixed(1) + '秒').padStart(8) + '  ' + r.file);
      ((r.報告 && r.報告.slow) || []).slice(0, 3).forEach((t) => {
        console.log('           ' + (t.ms + 'ms').padStart(7) + '  ' + t.name);
      });
    });
    const 全部 = [];
    報告あり.forEach((r) => (r.報告.slow || []).forEach((t) => 全部.push({ f: r.file, t: t })));
    console.log('');
    console.log('── 遅い検査（全スイート横断・上位10件）');
    全部.sort((x, y) => y.t.ms - x.t.ms).slice(0, 10).forEach((x) => {
      console.log('  ' + (x.t.ms + 'ms').padStart(8) + '  ' + x.f.replace(/\.js$/, '') + '  ' + x.t.name);
    });
    const ピーク = 報告あり.filter((r) => r.報告.peakKb).sort((x, y) => y.報告.peakKb - x.報告.peakKb);
    if (ピーク.length) {
      console.log('');
      console.log('── メモリのピーク（上位5本）');
      ピーク.slice(0, 5).forEach((r) => console.log('  ' +
        ((r.報告.peakKb / 1024).toFixed(0) + 'MB').padStart(8) + '  ' + r.file));
    }
  }

  if (赤.length) {
    console.log('');
    console.log('══ 赤 ' + 赤.length + '件 ═══════════════════════════════');
    赤.forEach(([f, name, err]) => {
      console.log('  ❌ ' + f.replace(/\.js$/, '') + '：' + name);
      if (err) console.log('       → ' + String(err).split('\n').join('\n         '));
    });
  }

  // **3つそろって初めて0を返す。**どれか1つでも欠けたら1
  const 緑 = 走った === 対象.length
    && 報告あり.length === 対象.length
    && 終了コード異常.length === 0
    && 合計件数 > 0
    && 合計成功 === 合計件数;
  console.log('');
  console.log(緑 ? '緑：スイート数・件数・終了コードの3つがそろいました。' :
    '赤：スイート数・件数・終了コードのどれかが欠けています。');
  process.exit(緑 ? 0 : 1);
})();
