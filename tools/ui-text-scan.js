// tools/ui-text-scan.js — 画面に文字が出る道を、全部ここで数える（唯一の実装）
//
// **ここが正本。**もとは tests/ui-text.js の中にだけあったが、
// 指示49 49-5 で「全数を書き出して人が読む」道具が要るので外に出した。
// **写さずに、両方がここを呼ぶ**——写すと、片方だけ直す日が来る（落とし穴1）。
//
// ── 層を「宣言」で持つ理由 ─────────────────────────
// 第40弾は「全角数字0件」で緑だったが、**HTMLの地の文を一度も見ていなかった**。
// 指示49 の着手前で、同じ形の漏れが**さらに3つ**見つかった
// （二重引用符・HTMLの属性・CSSの content）。
// どれも「0件」ではなく「**見ていなかった**」。
// だから層は `LAYERS` に名前で並べ、**層ごとに件数を主張する**——
// 0件が「無い」のか「その層を見ていない」のかを、いつでも分けられるようにする。
//
// ── 数えた層（2026-09-16 時点で、思いつく道を全部掃いた） ──────
//   JS   … JSの文字列。**単引用・二重引用・バッククォート（複数行も）の3種**
//   HTML … HTMLに直接書かれた地の文。**複数行にまたがる節点も拾う**
//   属性 … placeholder / aria-label / title / alt …（マークアップに直接書かれた分）
//   CSS  … `content:'…'` で画面に出る文字（`<style>` と public/*.css）
//   SRV  … サーバーが返して画面に出る文言（`console.*` の中は除く）
//
// ── 見つけたが、数えないもの ───────────────────────
//   ・連結でHTMLを組み立てている断片（`'…' + x + '…'` の途中）。文言ではない
//   ・`console.*` の引数。遊ぶ人の画面には出ない

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const 日本語 = /[ぁ-んァ-ヶ一-龠]/;
const blank = (s) => s.replace(/[^\n]/g, '');

/** 層の宣言。**ここに無い層は「見ていない」ということ。** */
const LAYERS = [
  { id: 'JS', 説明: 'JSの文字列（単引用・二重引用・バッククォート）' },
  { id: 'HTML', 説明: 'HTMLに直接書かれた地の文' },
  { id: '属性', 説明: 'HTMLの属性（placeholder・aria-label・title…）' },
  { id: 'CSS', 説明: 'CSSの content で画面に出る文字' },
  { id: 'SRV', 説明: 'サーバーが返す文言（console.* は除く）' },
  { id: '文言表', 説明: 'ui-text.js の中の、生きている文言（台帳の表は除く）' }
];

/**
 * ui-text.js の中で、**台帳ではなく生きている文言**が入っているキー。
 * 逆に `LEDGER_KEYS` は「違反の見本」が載っている表なので掃かない——
 * 掃くと、自分の一覧を違反として数えてしまう（第39弾で踏んだ形）。
 *
 * **ファイルまるごと外していたのが、指示49で見つかった6つ目の穴。**
 * ui-text.js は「台帳だから」と掃く対象から外してあったが、
 * 中には `ROLE.渡す相手` のような**そのまま画面に出る文言**も入っていて、
 * そこだけ誰も見ていなかった（実際に正本10違反が4件あった）。
 * **外すのは表であって、ファイルではない。**
 */
const LEDGER_KEYS = ['BANNED', 'JARGON', 'KEPT'];

/**
 * 見た目の指定とコメントを落とす。コメントの中の語を「画面に出ている」と誤って数えないため。
 * **落とすが、行はずらさない。**改行の数を保って空にする——
 * 詰めてしまうと、報告した行番号が実ファイルとずれる。
 */
function strip(src) {
  const s = src
    .replace(/<style[\s\S]*?<\/style>/g, blank)
    .replace(/<!--[\s\S]*?-->/g, blank);
  // JSのコメントを落とす。**`\s` は改行も食う。**`^\s*//` と書くと、空行をまたいで
  // 次の行のコメントに届き、あいだの改行ごと消える
  const JSコメントを落とす = (t) => t
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/^[^\S\n]*\/\/.*$/gm, '');

  // ---- HTML では、**`<script>` の中だけ**でコメントを落とす（指示49で見つけた穴）----
  //
  // 全体に当てると、**マークアップの中の `/*` がコメントの開きになる**。
  // `<input type="file" accept="image/*">` の `/*` が、
  // **1548行先の本物の `*/` と対になって、そのあいだを全部空にしていた**（実測）。
  // 消えていたのは**マークアップ1080行**と、`<script>` の頭のほう。
  //
  // 実害：ボタンの札を掃く門A7（tests/ui-text.js）は strip 後の文字列を見るので、
  // **「🏁 部屋を閉じる」のボタン7つを一度も見ていなかった**——
  // `BANNED` に 閉じる→とじる と書いてあるのに、札に漢字が残っていた理由がこれ。
  // 「見張りがあるのに効いていない」形（落とし穴37 の親戚）。
  if (/<script[\s>]/.test(s)) {
    return s.replace(/<script[\s\S]*?<\/script>/g, JSコメントを落とす);
  }
  return JSコメントを落とす(s);
}

/** ボタンの札が書かれている場所。**画面を組んでいるのは index.html だけではない** */
const SOURCES_FOR_LABEL = ['public/index.html', 'public/js/ui.js'].map((f) => ({
  file: f,
  text: fs.readFileSync(path.join(ROOT, f), 'utf8')
}));

/**
 * 文言を掃く対象。画面に文字を出しうるファイル全部。
 * **ui-text.js だけは外す**——そこは台帳そのもので、
 * 「直す前の言い方」が直し方の説明として載っている。
 */
const SOURCES = ['public/index.html'].concat(
  fs.readdirSync(path.join(ROOT, 'public', 'js'))
    .filter((f) => f.endsWith('.js') && f !== 'ui-text.js')
    .map((f) => 'public/js/' + f)
).map((f) => ({ file: f, text: fs.readFileSync(path.join(ROOT, f), 'utf8') }));

/** サーバー側。返り値が画面に出る（`el('loginError').textContent = e.message` 等） */
const SERVER_SOURCES = ['server.js', 'realtime.js']
  .filter((f) => fs.existsSync(path.join(ROOT, f)))
  .map((f) => ({ file: f, text: fs.readFileSync(path.join(ROOT, f), 'utf8') }));

/** 連結でHTMLを組み立てている途中の断片。文言ではないので数えない */
function 断片か(s) { return /'\s*\+|\+\s*'/.test(s); }

/** 文字位置 → 行番号（1始まり）。複数行にまたがるものを拾うために要る */
function 行番号表(text) {
  const idx = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') idx.push(i + 1);
  return (pos) => {
    let lo = 0, hi = idx.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (idx[mid] <= pos) lo = mid; else hi = mid - 1; }
    return lo + 1;
  };
}

/** お題データ（QUIZ_BANK）の行の範囲。**数えるが、トーンの校正の対象にはしない** */
function お題データの範囲() {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const lines = html.split('\n');
  const from = lines.findIndex((l) => /var QUIZ_BANK\s*=\s*\{/.test(l)) + 1;
  if (!from) return null;
  let depth = 0;
  for (let i = from - 1; i < lines.length; i++) {
    depth += (lines[i].match(/\{/g) || []).length - (lines[i].match(/\}/g) || []).length;
    if (i + 1 > from && depth <= 0) return { from, to: i + 1 };
  }
  return { from, to: lines.length };
}

function 画面の文言() {
  const out = [];
  const 題 = お題データの範囲();
  const 押す = (file, line, t, 層, 印) => {
    if (!日本語.test(t)) return;
    const x = t.trim();
    if (断片か(x)) return;
    // **1文字を落としてよいのは、雑多な文字列が混ざる層だけ。**
    // CSSの `content:'枚'` や属性の1文字は、それだけで画面に出る文字なので数える
    // （最初この線を引かずに 2文字以上で切って、`content:'枚'` を取りこぼした）
    if (x.length < 2 && 層 !== 'CSS' && 層 !== '属性') return;
    if (!x.length) return;
    const e = { 場所: file + ':' + line, t: x, 層 };
    if (印) e.対象外 = 印;
    // **お題データは数えるが、トーンの校正の対象にはしない**（指示49の裁定）。
    // 「判断しなかった」と「対象外と決めた」を分ける（ui-text.js の KEPT と同じ形）
    if (!印 && file === 'public/index.html' && 題 && line >= 題.from && line <= 題.to) {
      e.対象外 = 'お題データ（QUIZ_BANK）';
    }
    out.push(e);
  };

  SOURCES.forEach((src) => {
    const s = strip(src.text);
    const 行 = 行番号表(s);
    // ---- ① JSの文字列：3種の引用符。**バッククォートは改行をまたぐ** ----
    [/'([^'\\\n]{2,140})'/g, /"([^"\\\n]{2,140})"/g, new RegExp('`([^`\\\\]{2,400})`', 'g')]
      .forEach((re) => {
        let m; re.lastIndex = 0;
        while ((m = re.exec(s))) 押す(src.file, 行(m.index), m[1], 'JS');
      });
    if (!/\.html$/.test(src.file)) return;

    // ---- ②③ HTML。`<script>` を落としてから、地の文と属性を掃く ----
    const markup = src.text
      .replace(/<style[\s\S]*?<\/style>/g, blank)
      .replace(/<script[\s\S]*?<\/script>/g, blank)
      .replace(/<!--[\s\S]*?-->/g, blank);
    const 行M = 行番号表(markup);
    // **`<br>` は文を切らない。**外さずに拾うと、1つの文の後半だけが「短い案内」に見える。
    // 位置がずれないように、同じ長さの空白へ置き換える
    const 地 = markup.replace(/<br\s*\/?>/g, (m) => ' '.repeat(m.length));
    {
      // **行ごとではなく、ファイル全体で掃く。**行ごとだと
      // `<div>\n  テキスト\n</div>` のように改行をまたぐ節点を取りこぼす（実測で30件あった）
      let m; const re = />([^<>]+)</g;
      while ((m = re.exec(地))) 押す(src.file, 行M(m.index), m[1], 'HTML');
    }
    {
      let m; const re = /([a-zA-Z-]+)\s*=\s*"([^"]{1,300})"/g;
      while ((m = re.exec(markup))) 押す(src.file, 行M(m.index), m[2], '属性');
    }
    // ---- ④ CSSの content ----
    (src.text.match(/<style[\s\S]*?<\/style>/g) || []).forEach((block) => {
      const at = src.text.indexOf(block);
      const 行C = 行番号表(src.text);
      let m; const re = /content\s*:\s*(['"])([^'"]*)\1/g;
      while ((m = re.exec(block))) 押す(src.file, 行C(at + m.index), m[2], 'CSS');
    });
  });

  // 外部のCSSファイルにも content があるなら同じように
  const pub = path.join(ROOT, 'public');
  fs.readdirSync(pub).filter((f) => f.endsWith('.css')).forEach((f) => {
    const t = fs.readFileSync(path.join(pub, f), 'utf8');
    const 行 = 行番号表(t);
    let m; const re = /content\s*:\s*(['"])([^'"]*)\1/g;
    while ((m = re.exec(t))) 押す('public/' + f, 行(m.index), m[2], 'CSS');
  });

  // ---- ⑤ サーバーが返す文言。`console.*` の中は遊ぶ人に出ないので落とす ----
  SERVER_SOURCES.forEach((src) => {
    const s = strip(src.text)
      // console.xxx( … ) の中身を空にする（行はずらさない）
      .replace(/console\.\w+\([\s\S]*?\);/g, blank);
    const 行 = 行番号表(s);
    [/'([^'\\\n]{2,140})'/g, /"([^"\\\n]{2,140})"/g, new RegExp('`([^`\\\\]{2,400})`', 'g')]
      .forEach((re) => {
        let m; re.lastIndex = 0;
        while ((m = re.exec(s))) 押す(src.file, 行(m.index), m[1], 'SRV');
      });
  });

  // ---- ⑥ ui-text.js の中の、生きている文言 ----
  // 値そのものを歩く（正規表現ではなく、**実際に読み込まれる値**を見る）。
  // 行番号は、その文字列をファイルから探して付ける
  {
    const file = 'public/js/ui-text.js';
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const lines = text.split('\n');
    const U = require(path.join(ROOT, file));
    const 歩く = (v, 道) => {
      if (typeof v === 'string') {
        // 台帳の中の語ではなく、**そのまま画面に出る文言**だけを数えたい。
        // 行が見つからない時は 0 にせず、道（キーの並び）を場所として残す
        const at = lines.findIndex((l) => l.indexOf("'" + v + "'") >= 0 || l.indexOf('"' + v + '"') >= 0);
        押す(file, at >= 0 ? at + 1 : 1, v, '文言表');
        return;
      }
      if (Array.isArray(v)) return v.forEach((x, i) => 歩く(x, 道 + '[' + i + ']'));
      if (v && typeof v === 'object') {
        Object.keys(v).forEach((k) => 歩く(v[k], 道 ? 道 + '.' + k : k));
      }
    };
    Object.keys(U).forEach((k) => { if (LEDGER_KEYS.indexOf(k) < 0) 歩く(U[k], k); });
  }

  return out;
}

/** 校正の対象になるものだけ（お題データ等を落とす） */
function 校正の対象() { return 画面の文言().filter((x) => !x.対象外); }

// ---- ここから下は 49-5（書き出し）のためだけの付け足し ----

/**
 * 行番号 → 画面id。`<div class="screen…" id="scr-…">` の開きから、
 * 対応する `</div>` の深さまでをその画面とみなす。
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

module.exports = {
  LAYERS, strip, SOURCES, SOURCES_FOR_LABEL, SERVER_SOURCES,
  画面の文言, 校正の対象, 画面の範囲, 関数の範囲, お題データの範囲, ROOT
};
