// tools/triage-ui-text.js — 全数校正の下ごしらえ（指示49 49-5）
//
// **これは「読まなくてよくする道具」ではない。**読む順を決めるための道具。
// 機械で見つけられる形（表記ゆれ・専門用語・句読点・送りがな）を先に潰しておくと、
// 人が読む時に「日本語として不自然か」だけに集中できる。
//
// 指示49 49-5 の分類に合わせて出す：
//   (a) 日本語として不自然  … 機械では出せない。人が読む
//   (b) 誤字脱字            … 送りがな・繰り返し・open括弧の対
//   (c) トーンの違反        … 責める・専門用語・表記ゆれ・定着語
//   (d) 約束と実装の食い違い … ルール文。tests/mode-rules.js の担当
//
//   node tools/triage-ui-text.js          … 候補をまとめて出す
//   node tools/triage-ui-text.js --list   … 読む台帳を素のまま並べる（人が読む用）

const scan = require('./ui-text-scan');
const UiText = require('../public/js/ui-text');

/** 読む単位（種類）にする。同じ文は1回 */
function 種類() {
  const map = new Map();
  scan.校正の対象().forEach((x) => {
    if (!map.has(x.t)) map.set(x.t, { t: x.t, 層: x.層, 場所: [] });
    map.get(x.t).場所.push(x.場所);
  });
  return Array.from(map.values());
}

/** 漢字・かなの違いだけの組（表記ゆれの候補） */
function 表記ゆれ(items) {
  // かなに落として比べる……のは辞書が要る。
  // **辞書を持たずにできるのは「同じ意味で綴りだけ違う」対を、
  // よく揺れる語の一覧で当てること**。一覧は正本10（定着語）から取る
  const 対 = [
    ['もどる', '戻る'], ['もどす', '戻す'], ['えらぶ', '選ぶ'], ['わたす', '渡す'],
    ['はじめる', '始める'], ['おわる', '終わる'], ['つづける', '続ける'],
    ['きめる', '決める'], ['みる', '見る'], ['つかう', '使う'],
    ['できる', '出来る'], ['ください', '下さい'], ['とじる', '閉じる'],
    ['ゆずる', '譲る'], ['さがす', '探す'], ['あそぶ', '遊ぶ']
  ];
  const out = [];
  対.forEach(([かな, 漢字]) => {
    const a = items.filter((x) => x.t.indexOf(かな) >= 0);
    const b = items.filter((x) => x.t.indexOf(漢字) >= 0);
    if (a.length && b.length) {
      out.push({ 語: かな + ' / ' + 漢字, かな: a.length, 漢字: b.length,
        例: b.slice(0, 3).map((x) => x.場所[0] + '「' + x.t.slice(0, 32) + '」') });
    }
  });
  return out;
}

/** 台帳に無い専門用語・カタカナ語の候補 */
function 専門用語の候補(items) {
  const 既知 = (UiText.JARGON || []).map((j) => j.用語)
    .concat((UiText.KEPT || []).map((k) => k.語));
  const 疑い = ['セッション', 'タイムアウト', 'エラー', 'リトライ', 'キャッシュ',
    'ソケット', 'サーバー', 'クライアント', 'ステータス', 'パラメータ', 'クエリ',
    'ルーム', 'メンバー', 'フェーズ', 'ロール', 'デバイス', 'ブラウザ',
    'ログ', 'デバッグ', 'リロード', 'インスタンス', 'オプション', 'デフォルト'];
  const out = [];
  疑い.forEach((w) => {
    if (既知.indexOf(w) >= 0) return;
    const hit = items.filter((x) => x.t.indexOf(w) >= 0);
    if (hit.length) out.push({ 語: w, 件数: hit.length,
      例: hit.slice(0, 4).map((x) => x.層 + ' ' + x.場所[0] + '「' + x.t.slice(0, 40) + '」') });
  });
  return out;
}

/** 誤字の機械的な候補 */
function 誤字の候補(items) {
  const out = [];
  items.forEach((x) => {
    const t = x.t;
    const 理由 = [];
    // 括弧の対
    const 開 = (t.match(/[（(「『]/g) || []).length, 閉 = (t.match(/[）)」』]/g) || []).length;
    if (開 !== 閉) 理由.push('括弧の数が合わない');
    // 同じ字の3連続（ひらがな）
    if (/([ぁ-ん])\1\1/.test(t)) 理由.push('同じ字が3つ続く');
    // 句点のあとに何も無いのに読点
    if (/、$/.test(t)) 理由.push('読点で終わっている');
    // 二重の助詞
    if (/(でで|にに|をを|がが|はは|とと)/.test(t)) 理由.push('助詞が重なっている');
    // 半角カナ
    if (/[｡-ﾟ]/.test(t)) 理由.push('半角カナ');
    // 波線・三点リーダの揺れ
    if (/~/.test(t)) 理由.push('半角チルダ（〜ではない）');
    if (/\.\.\./.test(t)) 理由.push('半角の三点（…ではない）');
    if (理由.length) out.push({ x, 理由 });
  });
  return out;
}

/** 句点の揺れ：同じ長さ帯で「。あり」と「。なし」が混ざっていないか */
function 句点の様子(items) {
  const 帯 = { '〜10文字': [0, 10], '11〜20文字': [11, 20], '21文字〜': [21, 999] };
  const out = {};
  Object.keys(帯).forEach((k) => {
    const [lo, hi] = 帯[k];
    const a = items.filter((x) => x.t.length >= lo && x.t.length <= hi &&
      !/[？！?!]$/.test(x.t) && /[ぁ-んァ-ヶ一-龠]/.test(x.t));
    const あり = a.filter((x) => /。$/.test(x.t)).length;
    out[k] = { 全体: a.length, 句点あり: あり, 句点なし: a.length - あり };
  });
  return out;
}

function main() {
  const items = 種類();
  if (process.argv.includes('--list')) {
    items.forEach((x, i) => console.log((i + 1) + '\t' + x.層 + '\t' + x.場所[0] + '\t' + x.t));
    return;
  }
  console.log('読む単位：' + items.length + '件');
  console.log('');
  console.log('=== (c) 表記ゆれ：かなと漢字が両方使われている語 ===');
  const ゆれ = 表記ゆれ(items);
  if (!ゆれ.length) console.log('  なし');
  ゆれ.forEach((y) => {
    console.log('  ' + y.語 + '  かな' + y.かな + '件 / 漢字' + y.漢字 + '件');
    y.例.forEach((e) => console.log('      ' + e));
  });
  console.log('');
  console.log('=== (c) 台帳に無い専門用語の候補 ===');
  const 用語 = 専門用語の候補(items);
  if (!用語.length) console.log('  なし');
  用語.forEach((u) => {
    console.log('  ' + u.語 + '（' + u.件数 + '件）');
    u.例.forEach((e) => console.log('      ' + e));
  });
  console.log('');
  console.log('=== (b) 誤字の機械的な候補 ===');
  const 誤字 = 誤字の候補(items);
  if (!誤字.length) console.log('  なし');
  誤字.slice(0, 60).forEach((g) =>
    console.log('  ' + g.x.層 + ' ' + g.x.場所[0] + '「' + g.x.t.slice(0, 46) + '」→ ' + g.理由.join('・')));
  if (誤字.length > 60) console.log('  …ほか ' + (誤字.length - 60) + '件');
  console.log('');
  console.log('=== (c) 句点の様子（正本10：短い案内には付けない） ===');
  const 句 = 句点の様子(items);
  Object.keys(句).forEach((k) => console.log('  ' + k.padEnd(12) +
    '全体' + String(句[k].全体).padStart(5) + '  句点あり' + String(句[k].句点あり).padStart(5) +
    '  句点なし' + String(句[k].句点なし).padStart(5)));
}

module.exports = { 種類, 表記ゆれ, 専門用語の候補, 誤字の候補 };
if (require.main === module) main();
