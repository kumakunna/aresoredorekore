// tools/tier-scan.js — 指示58：なにそれ・むりが入りうる入口を、コードから掃き出す
//
// 「層を引く・並べる・受け取る」語（下の SOURCES）が出てくる場所ごとに、
// **いちばん内側の関数**を探し、その関数が門（GATES）を通っているかを返す。
// 検査（tests/tier-gate.js の X3）と、人が読む時（node tools/tier-scan.js）の両方が
// **この1つを呼ぶ**（写さない・落とし穴25）。
//
// 読めなかったものは数えて返す（落とし穴10-e：握りつぶすと、読めていないのに緑になる）。

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// 走査する本番のファイル。**入口（呼び手）だけ**——ルール層の中身（quiz-bank の取り出し等）は
// 「引数で層を受ける下請け」で、門は呼び手に置く決まり（quiz-bank.js の指示58の節）
const FILES = [
  'public/index.html',
  'quiz-room.js',
  'bomb-room.js',
  'sugoroku-room.js',
  'realtime.js'
];

// 層を「引く・並べる・受け取る」語。ここに出てくる関数は、門を通るか、理由つきで除外される
const SOURCES = [
  /\bpoolByTier\(/g, /\bpoolForTiers\(/g, /\bgetPool\(/g,
  /\bpickQuestionWires\(/g, /\bpickQuestions\(/g, /\blistTopicsOf\(/g, /\bdrawQuestion\(/g,
  /\bBOMB_TIERS\b/g, /\bQuizLogic\.TIERS\b/g, /\bQuizBank\.TIERS\b/g, /\bBombLogic\.TIERS\b/g,
  /\bQUIZ_BANK\b/g,
  /\bstate\.bombCounts\b/g, /\bstate\.topicDifficulties\b/g, /\bqkCfg\.tier\b/g,
  /\bcfg\.tier\b/g, /data-tier=/g, /data-qztier=/g, /dataset\.tier\b/g, /dataset\.qztier\b/g
];
// 門。QuizBank.allowedTiers を直接・間接に通る名前
// ページ全体を包む関数（index.html の大きな即時関数）。これを「入口」と数えると、
// 中に門が1つでもあれば全部が門を通ったことになる
const OUTER_LINES = 3000;
// quiz-room.js の drawQuestion は、中で QuizLogic.fitTier を通る**サーバーの最後の関所**。
// それを呼ぶ所は門を通ったことにする（本当に中で通っているかは tests/tier-gate.js が見る）
const GATES = /\bdrawQuestion\(|\ballowedTiers\b|\beffectiveTiers\(|\btierRows\(|\btiersFor\(|\bfitTier\(|\bfitCounts\(|\bfitBombCounts\(|\bbombSum\(/;

/** index.html からは <script>（src の無いもの）の中身だけを、行位置を保って取り出す */
function scriptOnly(text) {
  const out = text.split('');
  let keep = false;
  const re = /<script(\s[^>]*)?>|<\/script>/g;
  let m, last = 0;
  const marks = [];
  while ((m = re.exec(text))) marks.push({ at: m.index, end: re.lastIndex, open: m[0] !== '</script>', src: /\ssrc=/.test(m[1] || '') });
  // 開きと閉じの間だけ残す。ほかは改行以外を空白に（行番号を保つ）
  let inside = false, from = 0;
  const blank = (a, b) => { for (let i = a; i < b; i++) if (out[i] !== '\n' && out[i] !== '\r') out[i] = ' '; };
  for (const k of marks) {
    if (k.open && !k.src) { blank(from, k.end); inside = true; from = k.end; }
    else if (!k.open && inside) { inside = false; from = k.at; }
    else if (k.open && k.src) { /* 外部ファイル。中身は無い */ }
  }
  blank(from, out.length);
  return out.join('');
}

/**
 * JS の文字列・コメント・正規表現を空白に置き換える（行位置は保つ）。
 * 波かっこを数える時に、文字列の中の { } を拾わないため
 */
function stripCode(src) {
  const out = src.split('');
  const n = src.length;
  const blank = (a, b) => { for (let i = a; i < b; i++) if (out[i] !== '\n' && out[i] !== '\r') out[i] = ' '; };
  let i = 0;
  let prevSig = '';   // 直前の意味のある文字（正規表現の開きかを見分ける）
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { const e = src.indexOf('\n', i); const end = e < 0 ? n : e; blank(i, end); i = end; continue; }
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? n : e + 2; blank(i, end); i = end; continue; }
    if (c === '\'' || c === '"') {
      let j = i + 1;
      while (j < n && src[j] !== c) { if (src[j] === '\\') j++; if (src[j] === '\n') break; j++; }
      blank(i + 1, j); i = j + 1; prevSig = c; continue;
    }
    if (c === '`') {
      // テンプレートの ${ } の中は式なので残す（入れ子は1段だけ見る）
      let j = i + 1, depth = 0, segStart = i + 1;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (depth === 0 && src[j] === '`') break;
        if (depth === 0 && src[j] === '$' && src[j + 1] === '{') { blank(segStart, j); depth = 1; j += 2; continue; }
        if (depth > 0 && src[j] === '{') depth++;
        if (depth > 0 && src[j] === '}') { depth--; if (depth === 0) segStart = j + 1; }
        j++;
      }
      blank(segStart, j); i = j + 1; prevSig = '`'; continue;
    }
    if (c === '/' && /[(,=:\[!&|?{};+\-*%<>~^]|^$/.test(prevSig)) {
      // 正規表現の字句
      let j = i + 1, inClass = false;
      while (j < n && src[j] !== '\n') {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '[') inClass = true;
        else if (src[j] === ']') inClass = false;
        else if (src[j] === '/' && !inClass) break;
        j++;
      }
      blank(i + 1, j); i = j + 1; prevSig = '/'; continue;
    }
    if (!/\s/.test(c)) prevSig = c;
    i++;
  }
  return out.join('');
}

/** 関数の範囲（名前・開き・閉じ）を全部集める。名前の無い関数は、置かれ方から名前を作る */
function functionRanges(code, raw) {
  const ranges = [];
  let unread = 0;
  const re = /\bfunction\b\s*([A-Za-z_$぀-ヿ一-鿿][\w$぀-ヿ一-鿿]*)?\s*\(/g;
  let m;
  while ((m = re.exec(code))) {
    const open = code.indexOf('{', re.lastIndex);
    if (open < 0) { unread++; continue; }
    let depth = 0, j = open, close = -1;
    for (; j < code.length; j++) {
      if (code[j] === '{') depth++;
      else if (code[j] === '}') { depth--; if (depth === 0) { close = j; break; } }
    }
    if (close < 0) { unread++; continue; }
    let name = m[1];
    if (!name) {
      // 置かれ方から名前を作る（元の文字列が要るので raw を見る）
      const lineStart = raw.lastIndexOf('\n', m.index) + 1;
      const before = raw.slice(Math.max(lineStart, m.index - 160), m.index);
      let k;
      if ((k = before.match(/el\('([^']+)'\)\.addEventListener\('([^']+)'[\s,]*(?:async\s+)?$/))) name = k[1] + ':' + k[2];
      else if ((k = before.match(/window\.([\w$]+)\s*=\s*$/))) name = 'window.' + k[1];
      else if ((k = before.match(/([\w$぀-ヿ一-鿿]+)\s*:\s*$/))) name = k[1];
      else if ((k = before.match(/(?:var|let|const)\s+([\w$]+)\s*=\s*$/))) name = k[1];
      else name = '（無名）';
    }
    ranges.push({ name, start: m.index, open, close, lines: lineOf(code.slice(open, close), close - open) });
  }
  return { ranges, unread };
}

// 位置→行番号を、改行の位置の表から二分探索で引く（全文を数え直さない）
function lineIndex(text) {
  const nl = [];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) nl.push(i);
  return function (at) {
    let lo = 0, hi = nl.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (nl[mid] < at) lo = mid + 1; else hi = mid; }
    return lo + 1;
  };
}
function lineOf(text, at) {
  let n = 1;
  for (let i = 0; i < at; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

/**
 * 掃き出す。返すのは「語が出てきた関数」の一覧（同じ関数は1つにまとめる）。
 * @returns {{sites:Array<{file,name,line,sources:string[],gated:boolean}>, unread:number, files:number}}
 */
function scan() {
  const sites = {};
  let unread = 0;
  for (const rel of FILES) {
    const raw = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const lineAt = lineIndex(raw);
    const js = rel.endsWith('.html') ? scriptOnly(raw) : raw;
    const code = stripCode(js);
    const { ranges, unread: u } = functionRanges(code, js);
    unread += u;
    for (const re of SOURCES) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(code))) {
        // 宣言そのもの（function poolByTier(）は、語が「出てきた」のではない
        if (/function\s*$/.test(code.slice(Math.max(0, m.index - 12), m.index))) continue;
        // いちばん内側の**名前のある**関数。名前の無いもの（.map(function(t){…}) の中身など）は
        // 外側の関数の一部として読む。ページ全体を包む関数（OUTER_LINES 行を超えるもの）は数えない
        let best = null;
        for (const r of ranges) {
          if (r.name === "（無名）" || r.lines > OUTER_LINES) continue;
          if (r.open < m.index && m.index < r.close && (!best || r.open > best.open)) best = r;
        }
        // 関数の外（ページ全体の中の地の文）は、行ごとに別の場所として数える
        const name = best ? best.name : '（関数の外）';
        const key = rel + '#' + name + '#' + (best ? best.start : 'L' + lineAt(m.index));
        if (!sites[key]) {
          const body = best ? code.slice(best.open, best.close + 1) : '';
          sites[key] = {
            file: rel, name, line: best ? lineAt(best.start) : lineAt(m.index),
            sources: [], gated: GATES.test(body)
          };
        }
        const tok = m[0].replace(/\($/, '').replace(/=$/, '');
        if (sites[key].sources.indexOf(tok) < 0) sites[key].sources.push(tok);
      }
    }
  }
  return { sites: Object.values(sites), unread, files: FILES.length };
}

module.exports = { scan, stripCode, scriptOnly, functionRanges, FILES, SOURCES, GATES };

if (require.main === module) {
  const r = scan();
  console.log('読んだファイル ' + r.files + ' ／ 読めなかった関数 ' + r.unread);
  r.sites.sort((a, b) => (a.gated - b.gated) || a.file.localeCompare(b.file) || a.line - b.line);
  for (const s of r.sites) {
    console.log((s.gated ? '  門 ' : '  ✗  ') + s.file + ':' + s.line + '  ' + s.name + '  [' + s.sources.join(' ') + ']');
  }
  console.log('語が出てくる関数 ' + r.sites.length + '（門を通る ' + r.sites.filter((s) => s.gated).length +
    '・通らない ' + r.sites.filter((s) => !s.gated).length + '）');
}
