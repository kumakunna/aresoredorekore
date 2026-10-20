#!/usr/bin/env node
// tools/fx-boom-report.js — fx-boom-film の時間表（設定①〜⑤ × 3面）を、読める表にする（指示62-3 門E4）
//
//   node tools/fx-boom-report.js     # docs/監査_演出の画像/boom/<set>/時間表.json を読み、Markdown を標準出力へ
//
// 1面1設定につき「何が・いつ（0秒＝💥が呼ばれた瞬間）」を、演出として意味のあるものだけ並べる：
// FxKit の部品・演出の要素が置かれた／外れた・アニメの開始（宣言の長さ）・画面の切り替わり・音・振動・class（揺れ・赤い縁）

const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..', 'docs', '監査_演出の画像', 'boom');
const 面 = ['手元', '大画面', '手渡し'];
const 意味がある = (x) => /^FxKit\.(burst|blackout|shutter|shake|flash|edge|banner|celebrate)|^置かれた|^外れた|^アニメ開始|^音 |^振動|^class/.test(x.何) && !/fxAlive|aiWait|scrIn|panelUp|fx-notice|now-line/.test(x.何);

const 行 = [];
行.push('| 設定 | 面 | 0秒の決め方 | 起きたこと（秒：何） |');
行.push('|---|---|---|---|');
const まとめ = {};
for (let s = 1; s <= 5; s++) {
  const f = path.join(DIR, String(s), '時間表.json');
  if (!fs.existsSync(f)) continue;
  const d = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const k of 面) {
    const m = d.面[k];
    if (!m) { 行.push('| ' + d.設定 + ' | ' + k + ' | （撮れなかった） | |'); continue; }
    const xs = m.時間表.filter(意味がある).filter((x) => x.秒 >= -0.5 && x.秒 <= 3.5);
    // 同じ秒・同じ内容は1つに
    const seen = {}; const ys = [];
    xs.forEach((x) => { const key = x.秒 + x.何.replace(/\s*（宣言.*$/, ''); if (seen[key]) return; seen[key] = 1; ys.push(x); });
    行.push('| ' + d.設定 + ' | ' + k + ' | ' + m.零 + ' | ' + ys.map((x) => x.秒.toFixed(1) + '：' + x.何.replace(/\|/g, '／').replace(/div\./g, '.').slice(0, 70)).join('<br>') + ' |');
    // 何が出たか（3つの物差し）
    const has = (re) => m.時間表.some((x) => x.秒 >= -0.2 && x.秒 <= 3.5 && re.test(x.何));
    const 終わり = m.時間表.filter((x) => /外れた .*fx-blackout/.test(x.何)).map((x) => x.秒)[0];
    (まとめ[k] = まとめ[k] || {})[s] = {
      '💥': has(/FxKit\.burst/) ? (has(/アニメ開始 fxBurst/) ? 'あり（動く）' : 'あり（動かない）') : 'なし',
      '黒い幕': has(/置かれた .*fx-blackout/) ? 'あり' : 'なし',
      '閃光': has(/置かれた .*fx-flash|bombBoom/) ? 'あり' : 'なし',
      '揺れ': has(/fx-shake|bombShake|shakeX/) ? 'あり' : 'なし',
      '赤い縁（0秒以降に出た）': has(/class .*\+bomb-danger|アニメ開始 dangerEdge|置かれた .*fx-edge/) ? 'あり' : 'なし',
      '音(0秒)': m.時間表.some((x) => Math.abs(x.秒) <= 0.1 && /^音 /.test(x.何)) ? 'あり' : 'なし',
      '振動(0秒)': (m.時間表.find((x) => Math.abs(x.秒) <= 0.1 && /^振動/.test(x.何)) || {}).何 || 'なし',
      '帯（爆発しました）': (m.時間表.find((x) => /FxKit\.shutter/.test(x.何)) || {}).秒,
      '幕が上がる': 終わり
    };
  }
}
console.log(行.join('\n'));
console.log('\n### 3つの物差しでまとめる\n');
const 項目 = ['💥', '黒い幕', '閃光', '揺れ', '赤い縁（0秒以降に出た）', '音(0秒)', '振動(0秒)', '帯（爆発しました）', '幕が上がる'];
for (const k of 面) {
  if (!まとめ[k]) continue;
  console.log('\n**' + k + '**\n');
  console.log('| | ' + [1, 2, 3, 4, 5].map((s) => '①②③④⑤'[s - 1]).join(' | ') + ' |');
  console.log('|---|' + [1, 2, 3, 4, 5].map(() => '---').join('|') + '|');
  項目.forEach((it) => console.log('| ' + it + ' | ' + [1, 2, 3, 4, 5].map((s) => { const v = (まとめ[k][s] || {})[it]; return v == null ? '—' : (typeof v === 'number' ? v.toFixed(1) + '秒' : String(v).replace(/\|/g, '／')); }).join(' | ') + ' |'));
}
