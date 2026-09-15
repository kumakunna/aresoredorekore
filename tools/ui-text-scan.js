// tools/ui-text-scan.js — 画面に出る文言を2つの層から集める（唯一の実装）
//
// **ここが正本。**もとは tests/ui-text.js の中にだけあったが、
// 指示49 49-5 で「全数を書き出して人が読む」道具が要るので外に出した。
// **写さずに、両方がここを呼ぶ**——写すと、片方だけ直す日が来る（落とし穴1）。
//
//   ① JSの文字列（`'…'`）  ② HTMLに直接書かれた地の文（タグの外）
//
// ②を見ていなかったせいで「全角数字0件」が長いあいだ嘘をついていた（第40弾）。

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/**
 * 見た目の指定とコメントを落とす。コメントの中の語を「画面に出ている」と誤って数えないため。
 * **落とすが、行はずらさない。**改行の数を保って空にする——
 * 詰めてしまうと、報告した行番号が実ファイルとずれる。
 */
function strip(src) {
  const blank = (s) => s.replace(/[^\n]/g, '');
  return src
    .replace(/<style[\s\S]*?<\/style>/g, blank)
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    // **`\s` は改行も食う。**`^\s*//` と書くと、空行をまたいで
    // 次の行のコメントに届き、あいだの改行ごと消える
    .replace(/^[^\S\n]*\/\/.*$/gm, '');
}

/** ボタンの札が書かれている場所。**画面を組んでいるのは index.html だけではない** */
const SOURCES_FOR_LABEL = ['public/index.html', 'public/js/ui.js'].map((f) => ({
  file: f,
  text: fs.readFileSync(path.join(ROOT, f), 'utf8')
}));

/**
 * 文言を掃く対象（第40弾）。画面に文字を出しうるファイル全部。
 * **ui-text.js だけは外す**——そこは台帳そのもので、
 * 「直す前の言い方」が直し方の説明として載っている。
 */
const SOURCES = ['public/index.html'].concat(
  fs.readdirSync(path.join(ROOT, 'public', 'js'))
    .filter((f) => f.endsWith('.js') && f !== 'ui-text.js')
    .map((f) => 'public/js/' + f)
).map((f) => ({ file: f, text: fs.readFileSync(path.join(ROOT, f), 'utf8') }));

const 日本語 = /[ぁ-んァ-ヶ一-龠]/;

function 画面の文言() {
  const out = [];
  const blank = (x) => x.replace(/[^\n]/g, '');
  SOURCES.forEach((src) => {
    // ① JSの文字列
    strip(src.text).split('\n').forEach((line, i) => {
      let m;
      const re = /'([^'\\\n]{2,140})'/g;
      while ((m = re.exec(line))) {
        if (日本語.test(m[1])) out.push({ 場所: src.file + ':' + (i + 1), t: m[1], 層: 'JS' });
      }
    });
    // ② HTMLに直接書かれた地の文（タグの外）
    if (!/\.html$/.test(src.file)) return;
    src.text
      .replace(/<style[\s\S]*?<\/style>/g, blank)
      .replace(/<script[\s\S]*?<\/script>/g, blank)
      .replace(/<!--[\s\S]*?-->/g, blank)
      // **`<br>` は文を切らない。**外さずに拾うと、1つの文の後半だけが「短い案内」に見える
      .replace(/<br\s*\/?>/g, '')
      .split('\n').forEach((line, i) => {
        line.replace(/>([^<>]+)</g, (m, t) => {
          const x = t.trim();
          if (x.length >= 2 && 日本語.test(x)) {
            out.push({ 場所: src.file + ':' + (i + 1), t: x, 層: 'HTML' });
          }
          return m;
        });
      });
  });
  return out;
}

// ---- ここから下は 49-5（書き出し）のためだけの付け足し ----

/**
 * 行番号 → 画面id。`<div class="screen" id="scr-…">` の開きを数え、
 * 対応する `</div>` の深さまでをその画面とみなす。
 * **推測ではなく括弧の対応で決める**——「直前に見た画面id」方式だと、
 * 画面と画面のあいだに書かれたものまで前の画面に押し込む。
 */
function 画面の範囲() {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const lines = html.split('\n');
  const 範囲 = [];
  let cur = null, depth = 0;
  lines.forEach((line, i) => {
    const body = line.replace(/<!--[\s\S]*?-->/g, '');
    const open = (body.match(/<div\b[^>]*>/g) || []).length;
    const close = (body.match(/<\/div>/g) || []).length;
    // **`class="screen"` と決め打ちしない。**`class="screen active"` の scr-door が
    // 1枚だけ漏れていた（DOMは77枚、こちらは76枚だった。落とし穴4）
    const m = body.match(/<div class="screen[^"]*"[^>]*id="(scr-[a-zA-Z0-9-]+)"/);
    if (!cur && m) { cur = { id: m[1], from: i + 1 }; depth = 0; }
    if (cur) {
      depth += open - close;
      if (depth <= 0 && (i + 1) > cur.from - 1 && (open || close)) {
        cur.to = i + 1; 範囲.push(cur); cur = null;
      }
    }
  });
  if (cur) { cur.to = lines.length; 範囲.push(cur); }
  return 範囲;
}

/** 行番号 → その行を含む関数名（JSの層で「場面」を出すため） */
function 関数の範囲(text) {
  const lines = text.split('\n');
  const out = [];
  let cur = null, depth = 0;
  lines.forEach((line, i) => {
    const m = line.match(/^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/);
    if (!cur && m) { cur = { name: m[1], from: i + 1 }; depth = 0; }
    if (cur) {
      depth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
      if (depth <= 0 && i + 1 > cur.from) { cur.to = i + 1; out.push(cur); cur = null; }
    }
  });
  if (cur) { cur.to = lines.length; out.push(cur); }
  return out;
}

module.exports = { strip, SOURCES, SOURCES_FOR_LABEL, 画面の文言, 画面の範囲, 関数の範囲, ROOT };
