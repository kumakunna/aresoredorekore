#!/usr/bin/env node
// tools/gen-fonts.js — 新しい見た目（v2）の書体を、使う字だけに絞ってアプリのサーバーから配る（指示66-2・くまくんの決め 2026-10-23）
//
//   node tools/gen-fonts.js            … .cache/fonts/ の元の書体から public/fonts/ を作り直す（無ければ google/fonts から取る）
//   node tools/gen-fonts.js --check    … 作り直さずに、今の public/fonts/ がアプリの字を全部持っているかだけ見る
//
// **なぜ**：文化祭の会場の通信が弱くても字が変わらないように。Google Fonts（外のサーバー）に頼らない。
// **形**：ブラウザは unicode-range を見て、画面に出た字を含む束だけを取りに来る（@font-face を束ごとに分ける）。
//   ・ui      … アプリの字（index.html と public/js の字。問題バンクは除く）＋かな・英数・記号。いつも要る小さな束
//   ・k01〜   … 漢字を約250字ずつ。JIS第1水準（名前に使われる字のほとんど）と、問題バンクの漢字。出た時だけ取りに来る
//   JIS第1水準にも問題バンクにも無い漢字（第2水準の名前の字など）は、端末の書体で出る（字は欠けない・形だけ違う）
// 太さは v2 が使うものだけ：M PLUS 1 は 700・800・900、League Spartan は 800・900（index.html の v2 の節）。
// 書体は SIL Open Font License。ライセンスの写しを public/fonts/ に置く（OFL の決まり）。

const fs = require('fs');
const path = require('path');
const subsetFont = require('subset-font');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, '.cache', 'fonts');
const OUT = path.join(ROOT, 'public', 'fonts');
const CHECK = process.argv.includes('--check');
const JP = { file: 'MPLUS1.ttf', family: 'M PLUS 1', key: 'mplus1', weights: [700, 800, 900],
  url: 'https://github.com/google/fonts/raw/main/ofl/mplus1/MPLUS1%5Bwght%5D.ttf', ofl: 'https://github.com/google/fonts/raw/main/ofl/mplus1/OFL.txt' };
const EN = { file: 'LeagueSpartan.ttf', family: 'League Spartan', key: 'spartan', weights: [800, 900],
  url: 'https://github.com/google/fonts/raw/main/ofl/leaguespartan/LeagueSpartan%5Bwght%5D.ttf', ofl: 'https://github.com/google/fonts/raw/main/ofl/leaguespartan/OFL.txt' };
const CHUNK = 250;

const isKanji = (c) => /\p{Script=Han}/u.test(c);
function 字(text) { const s = new Set(); for (const c of text) { const p = c.codePointAt(0); if (p >= 0x20 && !/\s/.test(c)) s.add(c); } return s; }
function 範囲(cps) {
  // unicode-range は U+XXXX と U+XXXX-YYYY の並び。続いている所はまとめる
  const a = cps.slice().sort((x, y) => x - y), out = [];
  for (let i = 0; i < a.length; i++) {
    let j = i; while (j + 1 < a.length && a[j + 1] === a[j] + 1) j++;
    out.push(i === j ? 'U+' + a[i].toString(16).toUpperCase() : 'U+' + a[i].toString(16).toUpperCase() + '-' + a[j].toString(16).toUpperCase());
    i = j;
  }
  return out.join(',');
}
/** JIS第1水準の漢字（Shift_JIS の 0x889F〜0x9872 を文字に戻して数える。表を手で持たない） */
function JIS第1水準() {
  const dec = new TextDecoder('shift_jis');
  const out = new Set();
  for (let hi = 0x88; hi <= 0x98; hi++) {
    for (let lo = 0x40; lo <= 0xFC; lo++) {
      if (lo === 0x7F) continue;
      const code = (hi << 8) | lo;
      if (code < 0x889F || code > 0x9872) continue;
      const c = dec.decode(Uint8Array.from([hi, lo]));
      if (c && c.length === 1 && isKanji(c)) out.add(c);
    }
  }
  return out;
}
/** アプリの字：index.html と public/js（問題バンクは別に数える。全部入れると いつも要る束が重くなる） */
function アプリの字() {
  const ui = new Set(), quiz = new Set();
  const add = (set, t) => 字(t).forEach((c) => set.add(c));
  add(ui, fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8'));
  fs.readdirSync(path.join(ROOT, 'public', 'js')).filter((f) => f.endsWith('.js')).forEach((f) => {
    const t = fs.readFileSync(path.join(ROOT, 'public', 'js', f), 'utf8');
    add(/^quiz-bank|^emoji-list|^budoux|^v2-art/.test(f) ? quiz : ui, t);
  });
  // かな・英数・記号は全部（名前に打たれる字）
  const 範囲で = (a, b) => { for (let p = a; p <= b; p++) ui.add(String.fromCodePoint(p)); };
  範囲で(0x21, 0x7E); 範囲で(0x3001, 0x303F); 範囲で(0x3041, 0x309F); 範囲で(0x30A0, 0x30FF); 範囲で(0xFF01, 0xFF5E); 範囲で(0x2460, 0x2473);
  ['ー', '〜', '・', '…', '●', '★', '☆', '♪', '♡', '♥', '→', '←', '×', '÷', '°'].forEach((c) => ui.add(c));
  return { ui, quiz };
}

async function 取る(url, file) {
  if (fs.existsSync(file)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const r = await fetch(url);
  if (!r.ok) throw new Error('取れません：' + url + '（' + r.status + '）');
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
}

(async () => {
  const { ui, quiz } = アプリの字();
  const jis1 = JIS第1水準();
  const uiKanji = [...ui].filter(isKanji);
  const rest = new Set([...jis1, ...[...quiz].filter(isKanji)]);
  uiKanji.forEach((c) => rest.delete(c));
  const uiChars = [...ui].filter((c) => !isKanji(c) || uiKanji.indexOf(c) !== -1);
  const chunks = [];
  const restSorted = [...rest].sort((a, b) => a.codePointAt(0) - b.codePointAt(0));
  for (let i = 0; i < restSorted.length; i += CHUNK) chunks.push(restSorted.slice(i, i + CHUNK));
  console.log('アプリの字 ' + uiChars.length + '（うち漢字 ' + uiKanji.length + '）・ほかの漢字 ' + restSorted.length + '（' + chunks.length + '束）・JIS第1水準 ' + jis1.size);

  if (CHECK) {
    const css = fs.readFileSync(path.join(OUT, 'fonts.css'), 'utf8');
    const 持っている = new Set();
    (css.match(/unicode-range:([^;]+);/g) || []).forEach((m) => m.slice(14, -1).split(',').forEach((r) => {
      const [a, b] = r.trim().slice(2).split('-').map((x) => parseInt(x, 16));
      for (let p = a; p <= (b || a); p++) 持っている.add(p);
    }));
    const 無い = uiChars.filter((c) => !持っている.has(c.codePointAt(0)));
    console.log(無い.length ? '✖ 書体の束に無いアプリの字 ' + 無い.length + '：' + 無い.slice(0, 40).join('') : '✔ アプリの字は全部、書体の束にある');
    process.exitCode = 無い.length ? 1 : 0;
    return;
  }

  for (const f of [JP, EN]) { await 取る(f.url, path.join(SRC, f.file)); await 取る(f.ofl, path.join(SRC, 'OFL-' + f.key + '.txt')); }
  fs.mkdirSync(OUT, { recursive: true });
  fs.readdirSync(OUT).filter((n) => /\.(woff2|css)$/.test(n)).forEach((n) => fs.unlinkSync(path.join(OUT, n)));
  let css = '/* tools/gen-fonts.js が作る（手で直さない）。新しい見た目（v2）の書体を、使う字だけに絞って配る（指示66-2）。SIL OFL：OFL-*.txt */\n';
  let total = 0;
  const 書く = async (font, w, name, chars) => {
    const buf = await subsetFont(fs.readFileSync(path.join(SRC, font.file)), chars.join(''), { targetFormat: 'woff2', variationAxes: { wght: w } });
    fs.writeFileSync(path.join(OUT, name), buf);
    total += buf.length;
    css += '@font-face{font-family:"' + font.family + '";font-style:normal;font-weight:' + w + ';font-display:swap;src:url(' + name + ') format("woff2");' +
      'unicode-range:' + 範囲(chars.map((c) => c.codePointAt(0))) + ';}\n';
    return buf.length;
  };
  for (const w of JP.weights) {
    const kb = await 書く(JP, w, JP.key + '-' + w + '-ui.woff2', uiChars);
    let ks = 0;
    for (let i = 0; i < chunks.length; i++) ks += await 書く(JP, w, JP.key + '-' + w + '-k' + String(i + 1).padStart(2, '0') + '.woff2', chunks[i]);
    console.log('M PLUS 1 ' + w + '：アプリの字 ' + (kb / 1024).toFixed(0) + 'KB・漢字の束 ' + chunks.length + '個で ' + (ks / 1024).toFixed(0) + 'KB');
  }
  const enChars = []; for (let p = 0x20; p <= 0x7E; p++) enChars.push(String.fromCodePoint(p));
  ['…', '–', '—', '’', '“', '”', '°', '×'].forEach((c) => enChars.push(c));
  for (const w of EN.weights) console.log('League Spartan ' + w + '：' + ((await 書く(EN, w, EN.key + '-' + w + '.woff2', enChars)) / 1024).toFixed(0) + 'KB');
  fs.writeFileSync(path.join(OUT, 'fonts.css'), css);
  for (const f of [JP, EN]) fs.copyFileSync(path.join(SRC, 'OFL-' + f.key + '.txt'), path.join(OUT, 'OFL-' + f.key + '.txt'));
  console.log('合計 ' + (total / 1024).toFixed(0) + 'KB（いつも要るのは アプリの字の3つと英字の2つだけ）→ public/fonts/');
})().catch((e) => { console.error(e); process.exit(1); });
