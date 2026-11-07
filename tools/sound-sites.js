#!/usr/bin/env node
// tools/sound-sites.js — 鳴る音の一覧（どこで・どの音を・TV かスマホか・画面の合図が一緒か）を、コードから作る（11/7 の検査の準備 8）
//
//   node tools/sound-sites.js        … docs/検査_1107/8_音の一覧.md を書き直す（測った数は 8_音の測り.json から読む）
//
// 行を手で書かない：public/index.html と public/js/*.js の sfx('ID') と sfx(式) を全部拾い、
// 囲んでいる関数の名前と、その上の一言（コメント）を添える。だれが鳴らすかは public/js/sound.js の決まり（Sound.shouldPlay）から：
//   ・TV で鳴らす。スマホは tap（押した時のコツ）だけ。TV が無い遊び方の時だけ、スマホで TV の音も鳴らす。司会の声は止めてある
// 画面の合図：sfx の前後6行に、光る・ゆれる・字を出す（FxKit・showFlash・classList・textContent・innerHTML・vibe など）があるかを見る（荒い。○でなければ目で見る）。
// 振動：index.html の SFX_VIBE（音と一緒に震える ID）。

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const files = [path.join(ROOT, 'public', 'index.html')].concat(fs.readdirSync(path.join(ROOT, 'public', 'js')).filter((f) => f.endsWith('.js') && f !== 'sound.js').map((f) => path.join(ROOT, 'public', 'js', f)));
const Sound = require(path.join(ROOT, 'public', 'js', 'sound.js'));
let meas = {};
try { meas = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', '検査_1107', '8_音の測り.json'), 'utf8')); } catch (e) {}
const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const vibe = (() => { const m = /var SFX_VIBE = \{([^}]*)\}/.exec(html); const o = {}; if (m) for (const x of m[1].matchAll(/([a-z]+):\s*(\[[^\]]*\]|\d+)/g)) o[x[1]] = x[2]; return o; })();
const CUE = /FxKit\.|showFlash|showQuietNote|classList\.(add|toggle)|textContent\s*=|innerHTML\s*=|\.vibe\(|doVibrate|animate\(|fx\w*\(|V2\.\w+\(|render\w*\(|tvWaitDo|flash/i;

const sites = [];
files.forEach((f) => {
  const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
  lines.forEach((l, i) => {
    for (const m of l.matchAll(/\bsfx\(\s*([^),]+)/g)) {
      if (/function sfx\b/.test(l) || /^\s*(\/\/|\*)/.test(l)) continue;   // コメントの中の sfx('ID') は数えない
      const raw = m[1].trim();
      const ids = Array.from(raw.matchAll(/'([a-z]+)'/g)).map((x) => x[1]).filter((x) => (Sound.IDS || []).includes(x));
      // 囲んでいる関数（上へさかのぼって最初の function 名）と、その近くの一言
      let fn = '-', note = '';
      for (let k = i; k >= 0 && k > i - 400; k--) {
        const fm = /function\s+([A-Za-z0-9_$぀-ヿ一-鿿]+)\s*\(/.exec(lines[k]) || /([A-Za-z0-9_$]+)\s*[:=]\s*function\s*\(/.exec(lines[k]);
        if (fm) { fn = fm[1]; for (let c = k - 1; c >= 0 && c > k - 6; c--) { const cm = /^\s*(?:\/\/|\*|\/\*\*?)\s*(.+)$/.exec(lines[c]); if (cm && !/^\*\/$/.test(cm[1])) { note = cm[1].replace(/\*\/\s*$/, '').trim(); break; } } break; }
      }
      const near = lines.slice(Math.max(0, i - 6), i + 7).join('\n').replace(/\bsfx\([^)]*\)/g, '');
      sites.push({ file: path.relative(ROOT, f).replace(/\\/g, '/'), line: i + 1, ids: ids.length ? ids : ['（式）' + raw.slice(0, 30)], fn, note: note.slice(0, 60), cue: CUE.test(near) });
    }
  });
});

const ids = Array.from(new Set(Sound.IDS || [])).concat(Array.from(new Set(sites.flatMap((s) => s.ids))).filter((x) => !(Sound.IDS || []).includes(x)));
const who = (id) => {
  const tv = Sound.shouldPlay ? Sound.shouldPlay(id, { tv: true, tvInRoom: true }, 1) : true;
  const ph = Sound.shouldPlay ? Sound.shouldPlay(id, { tv: false, tvInRoom: true }, 1) : false;
  const solo = Sound.shouldPlay ? Sound.shouldPlay(id, { tv: false, tvInRoom: false }, 1) : true;
  return [tv ? 'TV' : '', ph ? 'スマホ' : '', !ph && solo ? '（TV が無い時はスマホ）' : ''].filter(Boolean).join('・') || '鳴らない';
};
const fmt = (k) => { const r = meas['se/' + k + '.mp3']; return r ? `${r.dur_s}s・M最大 ${r.lufs_m_max}・TP ${r.true_peak_dbtp}・4k↑ ${r.above_4k_db}dB・2〜5k ${r.band_2_5k_db}dB・立ち上がり ${r.rise_ms}ms${r.marks.length ? '・**' + r.marks.join('・') + '**' : ''}` : '（測っていない）'; };

let md = '# 8：鳴る音の一覧（`node tools/sound-sites.js` が作る）\n\n';
md += '- だれが鳴らすか（`public/js/sound.js`）：**TV で鳴らす。スマホは tap（押した時のコツ）だけ。** TV が無い遊び方の時だけ、スマホでも鳴らす。司会の声は止めてある（`VOICE_ON=false`・読み込みもしない）\n';
md += '- 同じ音は同時に3つまで（`MAX_SAME`）。音量のつまみ（効果音）が 0 なら鳴らさない。iPhone はウェブから振動しない（振動の列は Android だけ）\n';
md += '- 測った数：`tools/sound/measure-sound.py`（`docs/検査_1107/8_音の測り.json`）。M最大＝瞬間の大きさの最大（LUFS）・TP＝トゥルーピーク（dBTP）・4k↑＝4kHz より上の強さ（全体に対する dB）。\n';
md += '  印（仮の線）：TP −1 dBTP 超／4kHz より上が −10dB より強い／5ms より急に鳴り、しかも M最大 が −26 より大きい\n\n';
md += '## 音ごと\n\n| 音 | 本数 | だれが | 振動（Android） | 鳴らす所の数 | 測った数（1本目・2本目…） |\n|---|---|---|---|---|---|\n';
ids.forEach((id) => {
  const n = Object.keys(meas).filter((k) => k.startsWith('se/' + id + '-')).length;
  const where = sites.filter((s) => s.ids.includes(id)).length;
  const ms = Object.keys(meas).filter((k) => k.startsWith('se/' + id + '-')).map((k) => k.slice(3).replace('.mp3', '') + '：' + fmt(k.slice(3).replace('.mp3', ''))).join('<br>');
  md += `| ${id} | ${n} | ${who(id)} | ${vibe[id] || '-'} | ${where} | ${ms || '（ファイルなし・電子音の代わりだけ）'} |\n`;
});
md += '\n## 鳴らす所（' + sites.length + ' か所）\n\n| 音 | 場所 | 関数 | その上の一言 | 画面の合図が近くにあるか |\n|---|---|---|---|---|\n';
sites.sort((a, b) => a.ids[0].localeCompare(b.ids[0]) || a.line - b.line).forEach((s) => {
  md += `| ${s.ids.join('・')} | ${s.file}:${s.line} | \`${s.fn}\` | ${s.note.replace(/\|/g, '｜')} | ${s.cue ? '○' : '**目で見る**'} |\n`;
});
const b = meas['bgm/wait.mp3'];
md += '\n## BGM\n\n';
md += '- 文化祭：待合の曲 `public/sound/bgm/wait.mp3`（34.3秒でくり返す）。**鳴るのは TV の画面（scr-v2-fes-tv）で、段が「部屋がまだ無い（idle）」か「待合（lobby）」の時だけ。係の画面の BGM を「入」にした時だけ（はじめは切）**。投票・決定・準備OK・遊ぶ・結果では止まる（`bgmDesired`）\n';
if (b) md += `  - 測った数：${b.dur_s}s・曲全体 ${b.lufs_i} LUFS・M最大 ${b.lufs_m_max}・TP ${b.true_peak_dbtp} dBTP・4k↑ ${b.above_4k_db}dB。アプリの中では scale 0.25 で鳴らす（BGM の音量つまみ・はじめ 40）\n`;
md += '- ふだんの部屋（文化祭では使わない）：電子音の BGM（`BGM_KINDS`：人狼の夜・オークションの入札・クイズ解除の待機 prep）\n';
fs.writeFileSync(path.join(ROOT, 'docs', '検査_1107', '8_音の一覧.md'), md);
console.log(sites.length + ' か所・' + ids.length + ' 音 → docs/検査_1107/8_音の一覧.md（画面の合図を目で見る所 ' + sites.filter((s) => !s.cue).length + '）');
