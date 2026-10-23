/* name-filter.js — 文化祭の部屋の名前の決まり（指示66-2・見本 F2）
 *
 * 「自分の名前がTVに出た！」がこの遊びのいちばんの喜びなので、自由に入れられる形は残す。
 * 守り方は3つ重ねる：①短い禁止リスト ②8字まで ③係が1回押せば隠せる（fes-room.js の hidden）。
 * ここは①と②。**サーバーが門**（realtime.js の room:join）で、スマホは同じこのファイルで先に知らせるだけ
 * （端末で隠しただけにしない・落とし穴14）。
 *
 * 見る前に、ひらがな・カタカナ・全角・空白・記号をそろえる（「8 1 0」「ハチイチゼロ」もすり抜けにくい）。
 * 禁止リストは**短く**保つ。長くすると、ふつうの名前（「しんじ」など）を巻き込む——
 * 取りこぼしは③の係が拾う。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NameFilter = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_LEN = 8;

  // そろえたあと（ひらがな・小文字・空白と記号なし）で、**含んでいたら**はじく語。
  // 短い語（2字）はふつうの名前に混ざりやすいので、名前そのものと同じ時だけはじく（EXACT）
  var CONTAINS = [
    'うんこ', 'うんち', 'ちんこ', 'ちんちん', 'まんこ', 'おっぱい', 'せっくす', 'ぱんつ', 'おなに',
    'しね', 'ころす', 'きもい', 'うざい', 'ばーか', 'ばか', 'あほ', 'ぶす', 'でぶ', 'はげ',
    'fuck', 'shit', 'sex', 'penis', 'dick', 'bitch'
  ];
  // 「かすみ」「くずは」「えっちゃん」のような名前を巻き込まないよう、名前そのものと同じ時だけ
  var EXACT = ['かす', 'くず', 'ごみ', 'えっち', 'しっこ'];

  // 数字のネタ（語呂）。数字にそろえたあとで、含んでいたらはじく
  var DIGITS = ['810', '114514', '1919', '0721', '4545', '889464'];

  // 数字の読み（ハチイチゼロ → 810）。**名前ぜんぶが読みだけでできている時だけ**数字にする
  // （「にこ」「いちか」のような名前を、数字として読まない）
  var READINGS = [
    ['きゅう', '9'], ['ぜろ', '0'], ['れい', '0'], ['いち', '1'], ['さん', '3'], ['よん', '4'], ['ろく', '6'],
    ['なな', '7'], ['しち', '7'], ['はち', '8'], ['いい', '11'], ['ご', '5'], ['に', '2'], ['し', '4'], ['く', '9'],
    ['ひと', '1'], ['ふた', '2'], ['み', '3'], ['よ', '4'], ['は', '8'], ['や', '8'], ['お', '0']
  ];

  /** 字の数（絵文字も1字に数える） */
  function length(s) { return Array.from(String(s == null ? '' : s)).length; }

  /** 見る前にそろえる：全角→半角・半角カナ→全角（NFKC）、カタカナ→ひらがな、小文字、空白と記号を消す */
  function normalize(s) {
    var t = String(s == null ? '' : s);
    try { t = t.normalize('NFKC'); } catch (e) { /* 古い端末はそのまま */ }
    t = t.toLowerCase();
    t = t.replace(/[ァ-ヶ]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0x60); });
    t = t.replace(/ー/g, '');
    // 空白・記号・句読点（字と数字だけ残す）
    t = t.replace(/[\s　.,、。・!?！？'"`~^_\-=+*/\\|()（）\[\]{}<>「」『』【】…:;：；@#$%&♪☆★○●◎◇◆□■△▲▽▼※〜]/g, '');
    return t;
  }

  /**
   * 名前ぜんぶが「数字」と「数字の読み」だけでできていれば、数字の並びにして返す（できなければ null）。
   * 「はち10」→ 810、「ハチイチゼロ」→ 810。「いちか」は「か」が読みではないので null
   */
  function readAsDigits(t) {
    var out = '', i = 0;
    while (i < t.length) {
      if (/[0-9]/.test(t[i])) { out += t[i]; i++; continue; }
      var hit = null;
      for (var k = 0; k < READINGS.length; k++) {
        if (t.substr(i, READINGS[k][0].length) === READINGS[k][0]) { hit = READINGS[k]; break; }
      }
      if (!hit) return null;
      out += hit[1];
      i += hit[0].length;
    }
    return out || null;
  }

  /**
   * 名前を見る。{ ok, name, reason } を返す。
   * reason：'empty'（空）／'long'（8字を超える）／'blocked'（使えない言葉）
   * name は前後の空白を落としたもの（見せる名前はそろえない。そろえるのは見る時だけ）
   */
  function check(raw) {
    var name = String(raw == null ? '' : raw).replace(/^[\s　]+|[\s　]+$/g, '');
    if (!name) return { ok: false, name: name, reason: 'empty' };
    if (length(name) > MAX_LEN) return { ok: false, name: name, reason: 'long' };
    var t = normalize(name);
    // 数字は「名前の中の数字だけを並べたもの」と「読みも数字にしたもの」の2つで見る
    var 数 = [t.replace(/[^0-9]/g, ''), readAsDigits(t) || ''];
    var bad = CONTAINS.some(function (w) { return t.indexOf(w) !== -1; }) ||
      EXACT.indexOf(t) !== -1 ||
      DIGITS.some(function (d) { return 数.some(function (x) { return x.indexOf(d) !== -1; }); });
    return bad ? { ok: false, name: name, reason: 'blocked' } : { ok: true, name: name, reason: null };
  }

  /** 同じ名前が部屋にいたら、2人目から「ふう②」（taken：いま使われている名前の一覧） */
  function dedupe(name, taken) {
    var set = {};
    (taken || []).forEach(function (n) { set[n] = true; });
    if (!set[name]) return name;
    var marks = '②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
    for (var i = 0; i < marks.length; i++) {
      var c = name + marks[i];
      if (!set[c]) return c;
    }
    return name + '＋';
  }

  return { MAX_LEN: MAX_LEN, length: length, normalize: normalize, readAsDigits: readAsDigits, check: check, dedupe: dedupe, DIGITS: DIGITS };
});
