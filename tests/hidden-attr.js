// tests/hidden-attr.js — `hidden` 属性が、本当に効いているか（第51弾）
//
// **第48弾で、アプリが起動できなくなった。**
// `<div class="pause-veil" id="pauseVeil" hidden>` に対して
// `.pause-veil{display:flex}` を書いた瞬間、`hidden` が効かなくなり、
// 扉が開く前から不透明な幕が全面に出て、**誰も1か所も押せなかった**。
//
// 理由はCSSの起点の順序：
//   ・`hidden` を隠しているのは**ブラウザ既定（UAオリジン）**の `[hidden]{display:none}`
//   ・`!important` が付いていない
//   ・**作者オリジンの宣言は、常にUAオリジンより強い**（詳細度の勝負にすらならない）
// つまり `display` を書いた1行が、黙って `hidden` を無効にする。
// 掃いたら、`hidden` の付いた要素**13個が13個とも効いていなかった**
//（`.now-line` 12個＝48-2、`.pause-veil` 1個＝48-5。どちらも第48弾で足したもの）。
//
// ## なぜ全テストが緑だったか（ここが本題）
//
// `el.hidden` は**属性**なので、CSSがどうであろうと `true` を返す。
// だから `assertEqual(幕.hidden, true)` は緑のままだった（tests/fixes48.js:958 ほか）。
//
// **では `getComputedStyle(el).display` を見ればよかったのか——見てもダメだった。**
// jsdom は、この衝突を再現しない。手元で測った実際の値：
//
//   打ち消し無し（＝壊れている状態）: {hidden:true, display:"none"}
//   打ち消し有り（＝直した状態）    : {hidden:true, display:"none"}
//   display の指定が無い            : {hidden:true, display:"none"}
//
// **3つとも同じ。**jsdom は作者とUAの起点の衝突を解かないので、
// 壊れていても直っていても `none` を返す。
// つまり jsdom で `getComputedStyle` を見る検査は**書いた瞬間に空回り**する
//（落とし穴10-f「壊したつもりで、壊せていない」／10-e「読めていないのに緑になる」）。
// 実ブラウザでしか出ない差を、実ブラウザ抜きで捕まえる必要がある。
//
// ## だから、この見張りは**CSSそのものを読む**
//
// `!important` が付いた作者の宣言は、同じく `!important` が付いた作者の宣言にしか負けない。
// よって次の2つが言えれば、**ブラウザを立てなくても**「hidden は必ず効く」が証明できる：
//   (A) `[hidden]{display:none!important}` が実在する
//   (B) `display` を `!important` で指定する規則が、`hidden` の付いた要素に当たらない
// 逆向き（落とし穴20）も見る：
//   (C) 正本（markup の `hidden`）が本当に読めているか＝件数を数える
//
// 一覧は持たない。**markup から導く**ので、`hidden` を足した要素は自動で対象に入る
//（落とし穴4：手書きの一覧は腐る）。

const fs = require('fs');
const path = require('path');
const { createRunner, assert, assertEqual, cssRules } = require('./harness');

const R = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(R, 'public', 'index.html'), 'utf8');
const CSS = HTML.slice(HTML.indexOf('<style>') + 7, HTML.indexOf('</style>'))
  .replace(/\/\*[\s\S]*?\*\//g, '');
const MARKUP = HTML.replace(/<style>[\s\S]*?<\/style>/, '');

/**
 * markup で `hidden` が付いている要素を集める（＝この検査の正本）。
 *
 * **JSの文字列は拾わない。**`innerHTML` を組み立てる行にも `hidden` は出てくるが、
 * そこは `<script>` の中なので、先に `<style>` と同じ要領で落とす……のではなく、
 * **開きタグの形をしているものだけ**を拾う。
 * 属性としての `hidden` は、`>` までの間に単独で現れる。
 */
function hiddenな要素(markup) {
  const scriptを除く = markup.replace(/<script[\s\S]*?<\/script>/g, '');
  const out = [];
  for (const m of scriptを除く.matchAll(/<([a-z][a-z0-9-]*)\s([^>]*?)>/gi)) {
    const attrs = m[2];
    // hidden が属性として単独で立っているか（hidden="..." も属性なので拾う）
    if (!/(^|\s)hidden(\s|=|$)/i.test(attrs)) continue;
    // **前の空白を要求しない。**タグ名の直後の `\s` は既に食べているので、
    // `class` は attrs の0文字目に来る——`/\sclass=/` と書くと全部取りこぼす。
    // （最初そう書いて、13個とも class が空で拾えた。下の「一覧」の検査が赤くなって気づいた）
    const id = (attrs.match(/(?:^|\s)id\s*=\s*["']([^"']+)["']/i) || [])[1] || null;
    const cls = (attrs.match(/(?:^|\s)class\s*=\s*["']([^"']*)["']/i) || [])[1] || '';
    out.push({ tag: m[1].toLowerCase(), id, classes: cls.split(/\s+/).filter(Boolean) });
  }
  return out;
}

/** その選択子は、この要素に当たりうるか（当たる可能性があれば true・安全側に倒す） */
function 当たりうるか(sel, 要素) {
  // 「,」で分かれた1本ずつを見る
  return sel.split(',').some((one) => {
    const s = one.trim();
    if (!s) return false;
    // 末尾の主語（最後の空白／> の右側）だけを見る。先祖の条件は当たりうる側に倒す
    const 主語 = s.split(/\s|>|\+|~/).filter(Boolean).pop() || '';
    if (!主語) return false;
    // [hidden] を名指ししている規則は、まさに打ち消しの側なので対象外
    if (/\[hidden\]/.test(主語)) return false;
    const id = (主語.match(/#([A-Za-z0-9_-]+)/) || [])[1];
    if (id) return 要素.id === id;
    const クラス = Array.from(主語.matchAll(/\.([A-Za-z0-9_-]+)/g)).map((m) => m[1]);
    if (クラス.length) return クラス.every((c) => 要素.classes.includes(c));
    // タグだけ・`*`・属性選択子だけ → 当たりうるとみなす（安全側）
    const タグ = (主語.match(/^([a-z][a-z0-9-]*)/i) || [])[1];
    if (タグ) return タグ.toLowerCase() === 要素.tag;
    return true;
  });
}

/** 宣言の中から display の指定を取り出す */
function displayの指定(body) {
  const m = body.match(/(^|;)\s*display\s*:\s*([^;]+)/i);
  if (!m) return null;
  const 値 = m[2].trim();
  return { 値: 値.replace(/\s*!important\s*$/i, '').trim(), important: /!important/i.test(値) };
}

(async () => {
  const r = createRunner('hidden-attr');

  // ---- (C) 正本が読めているか。読めていないまま緑にしない（落とし穴10-e） ----
  await r.test('正本：markup から hidden の付いた要素を拾えている', async () => {
    const 要素 = hiddenな要素(MARKUP);
    assert(要素.length > 0, 'hidden の付いた要素が1つも拾えていない（読めていない）');
    // 第51弾の時点で13個。減る分には構わないが、**0件で緑**になる形だけは塞ぐ
    assert(CSS.length > 10000, 'CSSが読めていない（' + CSS.length + '文字）');
    const 規則数 = cssRules(CSS).length;
    assert(規則数 > 300, 'CSSの規則が読めていない（' + 規則数 + '本）');
  });

  // ---- (A) 打ち消しが実在するか ----
  await r.test('hidden を必ず効かせる規則が、CSSに1本ある', async () => {
    const 打ち消し = cssRules(CSS).filter((rule) => {
      if (!/\[hidden\]/.test(rule.sel)) return false;
      const d = displayの指定(rule.body);
      return d && d.値 === 'none' && d.important;
    });
    assert(打ち消し.length >= 1,
      '`[hidden]{display:none!important}` が無い。'
      + 'ブラウザ既定の `[hidden]{display:none}` は !important を持たないので、'
      + '作者が書いた display の1行に必ず負ける（第48弾で起動不能になった形）');
  });

  // ---- (B) その打ち消しを、上書きできる規則が無いか（本丸） ----
  await r.test('hidden の付いた要素に、display を !important で当てる規則が無い', async () => {
    const 要素 = hiddenな要素(MARKUP);
    const 規則 = cssRules(CSS);
    const 破る = [];
    for (const rule of 規則) {
      const d = displayの指定(rule.body);
      if (!d || !d.important || d.値 === 'none') continue;
      for (const e of 要素) {
        if (当たりうるか(rule.sel, e)) {
          破る.push(rule.sel.trim() + ' → ' + (e.id || '.' + e.classes.join('.')));
        }
      }
    }
    assertEqual(破る.length, 0,
      'display を !important で当てていて、hidden の打ち消しに勝ってしまう：\n  ' + 破る.join('\n  '));
  });

  // ---- 表：13個それぞれが、どの規則で display を持っているか ----
  // **これは記録であって、赤にはしない。**
  // 打ち消しが !important である以上、非 !important の display は何本あっても負ける。
  // 出しておく理由は、次に見る人が「何が当たっているか」を1秒で分かるようにするため
  await r.test('hidden の付いた要素の一覧が、そのまま報告に使える形で出る', async () => {
    const 要素 = hiddenな要素(MARKUP);
    const 規則 = cssRules(CSS);
    const 表 = 要素.map((e) => {
      const 当たる = 規則.filter((rule) => {
        const d = displayの指定(rule.body);
        return d && d.値 !== 'none' && 当たりうるか(rule.sel, e);
      }).map((rule) => rule.sel.trim() + '{display:' + displayの指定(rule.body).値 + '}');
      return { 名: e.id || '.' + e.classes.join('.'), display規則: 当たる };
    });
    assertEqual(表.length, 要素.length, '全部ぶん並んだ');
    // **1つでも「display を持つ要素」があることを確かめる。**
    // ここが0になるのは、CSSか markup の読み取りが壊れた時
    //（＝(B) の検査が自明に通るようになった時）。型(b) の歯止め
    const displayを持つ = 表.filter((row) => row.display規則.length > 0);
    assert(displayを持つ.length > 0,
      'display を持つ hidden 要素が1つも無い。読み取りが壊れている可能性がある'
      + '（この状態では (B) の検査が何も守っていない）');
  });

  r.finish();
})();
