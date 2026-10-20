#!/usr/bin/env node
// tools/mutate.js — 検査が「本当に赤くなるか」を機械で確かめる（第43弾）
//
// **なぜリポジトリに置くか。**
// 落とし穴10「テストは、実際に赤くなることを確認してから直す」を、
// 毎回セッションの中で書き捨ての台本を作って確かめていた。
// 台本が残らないので、次のセッションは同じものを一から書き直すか、
// 面倒になって「たぶん赤くなる」で済ませる（落とし穴29と同じ形）。
//
// ── 使い方 ────────────────────────────────────────
//   node tools/mutate.js 変異.json
//
// 変異.json は、こういう配列：
//   [
//     { "name": "説明",
//       "file": "public/index.html",      // リポジトリからの相対パス
//       "suite": "tests/shelf.js",
//       "from": "壊す前の文字列（1回だけ現れること）",
//       "to":   "壊したあとの文字列",
//       "expect": "赤くなってほしい検査の文言（一部でよい）",
//       "only": "（省略可）名前にこの字を含む検査だけを回す" }
//   ]
//
// ── この道具が守っている2つのこと ──────────────────
//
// **① 後始末を git に任せる。**
// 以前、`process.on('exit')` で書き戻す形にしていたら、
// 外からジョブを止められた時に**変異が作業ツリーに残った**
//（`clearGuestLook()` が消えたまま気づかず先へ進みかけた）。
// いまは「汚れていたら始めない」→「毎回 git checkout で戻す」。
//
// **② 「赤くなった」だけでは足りない。**
// 別の検査が巻き添えで落ちただけなら、その変異は何も証明していない。
// `expect` を出力から探して、**狙った理由で赤くなったか**まで見る。
//
// **④ 壊す前に、その検査が緑かを見る**（指示64で踏んだ）。
// 検査が最初から赤いと、どの変異を当てても「赤くなった」に見える。しかも `expect` を
// 出力全体から探していたので、**緑の ✅ 行に同じ文言があっても「狙った理由で」と読んでいた**。
// いまは (a) 変異を当てる前に (suite, only) ごとに1回回し、赤い検査を「基準の赤」として覚える
// (b) 狙った理由は、**基準より新しく赤くなった検査の行（❌ とその下の → 行）だけ**から探す。
// 基準が赤い変異は、結果に「基準が赤」と並べて出す（緑とは読まない）
//
// **③ 測定が取れなかったことを、緑とも赤とも読まない。**
// 子プロセスが制限時間で殺されると、出力ごと失われて「赤くなった検査0件」に見える。
// それは「素通り」ではなく「測れていない」——**別の結果として報告する**（落とし穴28）。

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const R = path.join(__dirname, '..');
const LF = String.fromCharCode(10), CR = String.fromCharCode(13);
const 制限 = 45 * 60 * 1000;   // いちばん重いスイート（rt-screens）が20分ほどかかる

const 表file = process.argv[2];
if (!表file) {
  console.log('使い方: node tools/mutate.js 変異.json');
  process.exit(1);
}
const MUT = JSON.parse(fs.readFileSync(表file, 'utf8'));
const 対象 = Array.from(new Set(MUT.map((m) => m.file)));

function 戻す() {
  try { cp.execSync('git checkout -- ' + 対象.join(' '), { cwd: R, stdio: 'ignore' }); } catch (e) {}
}
process.on('exit', 戻す);
process.on('SIGINT', () => { 戻す(); process.exit(1); });
process.on('SIGTERM', () => { 戻す(); process.exit(1); });

// **汚れた作業ツリーでは始めない。**戻す先が無い状態で汚すと、元に戻せない
const 差分 = cp.execSync('git status --porcelain ' + 対象.join(' '), { cwd: R, encoding: 'utf8' }).trim();
if (差分) {
  console.log('先にコミットしてください（git checkout で戻せないため）:' + LF + 差分);
  process.exit(1);
}

/** 1回回して、出力と「赤い検査の塊（❌ の行＋その下の → 行）」を返す */
function 回す(m) {
  const env = Object.assign({}, process.env, m.only ? { ACAC_ONLY: m.only } : {});
  try {
    const out = cp.execSync('node ' + m.suite, { cwd: R, encoding: 'utf8', timeout: 制限, stdio: ['ignore', 'pipe', 'pipe'], env });
    return { 緑: true, out, 塊: [], 殺された: false };
  } catch (e) {
    const out = String((e.stdout || '') + (e.stderr || ''));
    const 塊 = [];
    out.split(LF).forEach((行) => {
      const t = 行.trim();
      if (/^❌ /.test(t)) 塊.push({ 名: t.replace(/^❌ /, ''), 字: t });
      else if (/^→/.test(t) && 塊.length) 塊[塊.length - 1].字 += LF + t;
      else if (/^✅ /.test(t)) 塊.push(null);   // 塊の区切り（→ 行を前の ❌ に付けない）
    });
    return { 緑: false, out, 塊: 塊.filter(Boolean), 殺された: !!e.killed || e.signal != null };
  }
}

// ④(a) 基準：変異を当てる前に、(suite, only) ごとに1回
const 基準 = {};
for (const m of MUT) {
  const k = m.suite + '|' + (m.only || '');
  if (基準[k]) continue;
  const b = 回す(m);
  基準[k] = new Set(b.塊.map((x) => x.名));
  console.log('基準 ' + k + '：' + (b.緑 ? '緑' : '**赤 ' + b.塊.length + '件**（' + b.塊.map((x) => x.名).join(' ／ ') + '）'));
}

const 結果 = [];
for (const m of MUT) {
  const P = path.join(R, m.file);
  const src = fs.readFileSync(P, 'utf8');
  const crlf = src.indexOf(CR + LF) >= 0;
  const body = crlf ? src.split(CR + LF).join(LF) : src;
  const n = body.split(m.from).length - 1;
  if (n !== 1) { 結果.push([m.name, '変異を当てられない（' + n + '件見つかった。1件でないと、何を壊したか決まらない）']); continue; }
  const 汚 = body.split(m.from).join(m.to);
  fs.writeFileSync(P, crlf ? 汚.split(LF).join(CR + LF) : 汚);

  // 指示64：only を書いた変異は、名前にその字を含む検査だけを回す（ACAC_ONLY・tests/harness.js）。
  // 狙った検査が赤くなるかを見るのが目的なので、重いスイートを毎回まるごと回さなくてよい
  const 走 = 回す(m);
  戻す();
  const 基 = 基準[m.suite + '|' + (m.only || '')];
  const 基準の注 = 基.size ? '（**基準が赤 ' + 基.size + '件**：変異の前から赤い検査は数えない）' : '';
  const 新しい = 走.塊.filter((x) => !基.has(x.名));
  if (走.緑 || (!走.殺された && 走.塊.length && !新しい.length)) {
    結果.push([m.name, '**素通り（新しく赤くなった検査が無い）** ← 検査に穴がある' + 基準の注]);
  } else if (!走.塊.length) {
    // 赤くなったのでも素通りでもなく、**測れていない**（落とし穴28）
    結果.push([m.name, '**測れていない**（' + (走.殺された ? '制限時間で殺された' : '出力に検査の行が無い') +
      '）。単体で回し直して、出力をファイルに残すこと']);
  } else {
    // ④(b) 狙った理由は、新しく赤くなった検査の行だけから探す（緑の ✅ 行の同じ文言を拾わない）
    const 狙い = 新しい.some((x) => x.字.indexOf(m.expect) >= 0);
    結果.push([m.name, (狙い ? '赤（狙った理由で）' : '**赤だが別の理由**') +
      ' / 新しく赤くなった検査 ' + 新しい.length + '件：' + 新しい.map((x) => x.名).join(' ／ ') + 基準の注]);
  }
  console.log('… ' + m.name + ' 済み');
}
戻す();
console.log('');
console.log('══ 変異の結果 ═══════════════════════════════');
結果.forEach(([a, b]) => console.log('  ' + a + LF + '    → ' + b));
