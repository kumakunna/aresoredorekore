// emoji.js — 絵文字をSVGに差し替える（第32弾-B 第3部）
//
// ---- なぜ必要か ----
// 絵文字は iOS・Android・PC で見た目がまったく違う。
// 同じ部屋に iPhone と Android が混ざるのは普通のことで、
// その時、同じ「🐺」が人によって違う絵に見える。
// 称号のアイコンは「集めたものを見せ合う」対象なので、見え方がバラバラだと台無しになる。
//
// ---- なぜ Twemoji か（判断の記録）----
// Noto Color Emoji はフォントなので、全部入りだと数MB〜10MB。
// 軽くするにはサブセット化のビルド工程が要るが、このプロジェクトに
// ビルド工程は無い（index.html 1枚＋静的なJS）。
// Twemoji は「1絵文字＝1SVGファイル」なので、**使っているものだけ**を置けば済む。
// 全部入りの3723個（17MB）ではなく127個・合計356KB。これで起動を重くしない。
// ライセンスは CC-BY 4.0。表記が要るが、設定の中に1行入れれば済む。
//
// ---- どうやって当てるか ----
// 727箇所の文字列を書き換えて回ると、必ずどこかを直し忘れる（落とし穴1）。
// だから「画面に出た絵文字を、出たときに差し替える」形にした。
// 差し替えても元の文字はDOMに残す（画像が読めなかった時に文字で出るように）。

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EmojiSvg = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 置き場所。ここに使っている絵文字のSVGだけを置く
  var BASE = 'img/emoji/';

  // 絵文字らしい文字の並び。異体字セレクタ・ZWJ・肌の色までひとまとまりで拾う
  // © ® ™ や ← → ★ は、文章や部品の中では「記号」として使う。
  // FE0F（絵文字にする印）が付いている時だけ絵文字あつかいにする。
  // 付いていないものまで拾うと、ライセンス表記の © まで画像になってしまう。
  var RE = new RegExp(
    '(?:' +
      // 明らかに絵文字の範囲
      '[\\u{1F000}-\\u{1FAFF}\\u{2600}-\\u{27BF}\\u{2B00}-\\u{2BFF}\\u{1F1E6}-\\u{1F1FF}]' +
      '(?:\\u{FE0F})?(?:[\\u{1F3FB}-\\u{1F3FF}])?' +
      '(?:\\u{200D}[\\u{1F000}-\\u{1FAFF}\\u{2600}-\\u{27BF}](?:\\u{FE0F})?)*' +
      '(?:\\u{20E3})?' +
    '|' +
      // 記号だが、FE0F が付いていれば絵文字として出す
      '[\\u{00A9}\\u{00AE}\\u{2122}\\u{2190}-\\u{21FF}\\u{3030}\\u{303D}\\u{3297}\\u{3299}]\\u{FE0F}' +
    '|' +
      // キーキャップ（1️⃣ など）
      '[0-9#*]\\u{FE0F}?\\u{20E3}' +
    ')',
    'gu'
  );

  /**
   * Twemoji のファイル名の決まり。
   * コードポイントを16進で '-' 区切り。
   * 異体字セレクタ（FE0F）は落とす。ただしキーキャップ（20E3付き）は残す。
   */
  function fileName(seq) {
    var cps = [];
    for (var i = 0; i < seq.length; i++) {
      var cp = seq.codePointAt(i);
      if (cp > 0xFFFF) i++;
      cps.push(cp);
    }
    var keycap = cps.indexOf(0x20E3) !== -1;
    if (!keycap) cps = cps.filter(function (c) { return c !== 0xFE0F; });
    return cps.map(function (c) { return c.toString(16); }).join('-');
  }

  // 手元に置いてあるSVGの一覧（emoji-list.js が入れる）。
  // ここに無いものは、差し替えずに文字のまま出す。
  //
  // これが大事：「←」「→」「★」「✕」のような記号は絵文字ではなく、
  // UIの部品として文字で出ているのが正しい。Twemoji にも入っていない。
  // 一覧と突き合わせる形にしておけば、そういうものを勝手に画像にしないし、
  // 読めない画像（壊れたアイコン）も絶対に出ない。
  var FILES = null;
  function setFiles(list) {
    FILES = {};
    (list || []).forEach(function (n) { FILES[n] = true; });
  }
  function hasFile(name) { return !FILES || !!FILES[name]; }

  /**
   * 1つぶんのHTML。
   * 元の文字も一緒に残す。画像が読めなかったら文字の方を出す
   * （絵文字が消えてボタンが空になる、という壊れ方をさせない）。
   */
  function spanHtml(seq) {
    if (!hasFile(fileName(seq))) return seq;
    // 既定では文字の方を出しておき、**画像が読めた時にだけ**入れ替える。
    // 逆（既定で画像・失敗したら文字）にすると、
    // 読み込みが始まらない環境で「何も出ない」状態になる。実際にそうなった。
    //
    // loading="lazy" は付けない。2〜4KBのアイコンに遅延読み込みは向いておらず、
    // 環境によっては読み込み自体が始まらない。
    // 「起動を重くしない」は、置くファイルを使っている分だけに絞ることで達成している
    // （全部入りの3723個ではなく127個・合計356KB）。
    return '<span class="emj" role="img" aria-label="' + seq + '">' +
      '<img src="' + BASE + fileName(seq) + '.svg" alt="" decoding="async" ' +
      'onload="this.parentNode.classList.add(\'emj-ok\')">' +
      '<span class="emj-txt">' + seq + '</span></span>';
  }

  // 文字列の中の絵文字をSVGに差し替える（HTMLを組み立てる側から使う）
  function html(text) {
    return String(text == null ? '' : text).replace(RE, spanHtml);
  }

  /**
   * DOMの中の絵文字を差し替える。
   * すでに差し替えたものには触らない（何度呼んでも増えない）。
   */
  function parse(root2, doc) {
    if (!root2) return 0;
    var d = doc || root2.ownerDocument || (typeof document !== 'undefined' ? document : null);
    if (!d) return 0;
    var walker = d.createTreeWalker(root2, 4 /* SHOW_TEXT */, null);
    var targets = [];
    var node;
    while ((node = walker.nextNode())) {
      var p = node.parentNode;
      if (!p) continue;
      var tag = (p.nodeName || '').toLowerCase();
      // 入力欄・スクリプト・すでに差し替えた中身は触らない
      if (tag === 'script' || tag === 'style' || tag === 'textarea' || tag === 'title') continue;
      if (p.classList && p.classList.contains('emj-txt')) continue;
      if (!node.nodeValue) continue;
      RE.lastIndex = 0;
      if (!RE.test(node.nodeValue)) continue;
      // 手元にSVGがあるものが1つも無ければ、触らない（無駄に span を増やさない）
      if (html(node.nodeValue) === node.nodeValue) continue;
      targets.push(node);
    }
    targets.forEach(function (t) {
      var span = d.createElement('span');
      span.innerHTML = html(t.nodeValue);
      t.parentNode.replaceChild(span, t);
      // 余計な入れ子を残さないよう、中身だけを移す
      while (span.firstChild) span.parentNode.insertBefore(span.firstChild, span);
      span.parentNode.removeChild(span);
    });
    return targets.length;
  }

  // アプリで使っている絵文字を全部集める（置くべきSVGの一覧を作るために使う）
  function collect(text) {
    var out = {};
    String(text || '').replace(RE, function (m) { out[m] = fileName(m); return m; });
    return out;
  }

  return {
    BASE: BASE, RE: RE, fileName: fileName, html: html, parse: parse, collect: collect,
    setFiles: setFiles, hasFile: hasFile
  };
}));
