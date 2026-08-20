// sugoroku-hide.js — すごろく「どこにいる？」の区画と手がかり（第36弾）
//
// 自分の位置は自分にしか見えない。申告では嘘をついてよい。
// 人狼の「正体を隠す」を「位置を隠す」に置き換えた遊び。
//
// このファイルは、その**区画と手がかりだけ**を持つ。
//   DOM も socket.io も知らない。Node.js から require できる純粋な計算だけ。
//   誰がいつ申告するか・実位置をどう隠すかは sugoroku-room.js が持つ。
//
// **手がかりを区画にまたがらせている理由**（設計書の決めごと⑲）:
//   1区画1手がかりにすると、嘘の位置を申告した瞬間に手がかりが食い違って
//   100%即バレる。そうなると誰も嘘をつかなくなり、**このゲームの核が消える**。
//   同じ手がかりを複数の区画に持たせると、「隣の区画までなら通る安全な嘘」が
//   最初から存在し、遊び込むほど「どの手がかりがどこまで通用するか」が分かってくる。
//
// **秘密の線引き**（sugoroku-room.js 側で守るが、ここにも書いておく）:
//   実際の位置は本人だけ。公開ビューにも大画面にも入れない。
//   申告した位置・手がかり・矛盾が出たかどうかは、全員に見せる（遊びの材料だから）。

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SugorokuHide = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 盤を何区画に分けるか。30マスを5区画（1区画6マス）。
  // 細かすぎると手がかりが増えて覚えきれず、粗すぎると嘘が通りすぎる
  var AREA_COUNT = 5;

  // 矛盾がバレた時に戻る数（設計書の決めごと⑳）。盤面30の10%
  var CAUGHT_BACK = 3;

  // ===== 区画の名前 =====
  // ふりだしから、あがりへ向かう順に並べる。
  // 和のトーンに合わせて、道中の景色として並べた
  var AREAS = [
    { id: 'a0', name: 'ふもと' },
    { id: 'a1', name: 'かわぞい' },
    { id: 'a2', name: 'まちなか' },
    { id: 'a3', name: 'さかみち' },
    { id: 'a4', name: 'みねちかく' }
  ];

  // ===== 手がかり（20種類） =====
  //
  // areas に、その手がかりが「本当に見える」区画を並べる。
  // **わざと重ねてある。** 1つの区画にしか無い手がかりは、
  // それを言った瞬間に居場所が確定してしまう（＝嘘がつけない側にも、
  // 本当のことを言えない側にもなる）。
  //
  // 重なりの目安：
  //   ・隣り合う区画で共有するものを多くする（「隣までなら通る嘘」を作る）
  //   ・端の区画だけにしか無いものも少しだけ置く（そこにいると強く言える手札）
  var CLUES = [
    { id: 'c01', text: '川の音が聞こえる',       areas: ['a0', 'a1'] },
    { id: 'c02', text: '橋がかかっている',       areas: ['a1'] },
    { id: 'c03', text: '石だたみが続いている',   areas: ['a1', 'a2'] },
    { id: 'c04', text: '人の話し声がする',       areas: ['a2'] },
    { id: 'c05', text: '軒先に提灯が下がる',     areas: ['a2', 'a3'] },
    { id: 'c06', text: '坂の途中にいる',         areas: ['a3'] },
    { id: 'c07', text: '霧が濃い',               areas: ['a0', 'a3', 'a4'] },
    { id: 'c08', text: '風が冷たい',             areas: ['a3', 'a4'] },
    { id: 'c09', text: '見晴らしがいい',         areas: ['a4'] },
    { id: 'c10', text: '土の道がぬかるんでいる', areas: ['a0', 'a1'] },
    { id: 'c11', text: '田んぼが広がる',         areas: ['a0'] },
    { id: 'c12', text: '木立に囲まれている',     areas: ['a0', 'a3'] },
    { id: 'c13', text: '鳥の声がする',           areas: ['a0', 'a1', 'a4'] },
    { id: 'c14', text: '足もとに小石が多い',     areas: ['a3', 'a4'] },
    { id: 'c15', text: '茶屋のにおいがする',     areas: ['a2'] },
    { id: 'c16', text: '道が細くなっている',     areas: ['a1', 'a3'] },
    { id: 'c17', text: '灯りがまばらになった',   areas: ['a3', 'a4'] },
    { id: 'c18', text: '看板が立っている',       areas: ['a1', 'a2'] },
    { id: 'c19', text: '遠くに山が見える',       areas: ['a0', 'a1', 'a2'] },
    { id: 'c20', text: '空気が薄い気がする',     areas: ['a4'] }
  ];

  function areaCount() { return AREA_COUNT; }
  function areas() { return AREAS.slice(); }
  function clues() { return CLUES.slice(); }
  function clueById(id) { return CLUES.find(function (c) { return c.id === id; }) || null; }
  function areaById(id) { return AREAS.find(function (a) { return a.id === id; }) || null; }

  /**
   * マスがどの区画か。
   * ふりだし（0）は最初の区画、あがりは最後の区画に入れる。
   * @param {number} pos いまのマス
   * @param {number} cells 盤の長さ（あがりのマス番号）
   */
  function areaOf(pos, cells) {
    var n = Math.max(1, cells | 0);
    var p = Math.max(0, Math.min(n, pos | 0));
    var idx = Math.floor((p / n) * AREA_COUNT);
    if (idx >= AREA_COUNT) idx = AREA_COUNT - 1;
    return AREAS[idx];
  }

  /** その区画で「本当に見える」手がかり */
  function cluesOf(areaId) {
    return CLUES.filter(function (c) { return c.areas.indexOf(areaId) !== -1; });
  }

  /**
   * 申告が矛盾しているか。
   *
   * **見るのは「申告した区画に、その手がかりが在るか」だけ。**
   * 実際の位置とは比べない——本当のことを言っているかどうかではなく、
   * 「その場所からそう見えるはずか」を見るのがこの遊びの筋なので。
   * だから、**嘘の位置でも、その区画に在る手がかりを選べば通る**。
   *
   * @param {string} clueId 申告と一緒に答えた手がかり
   * @param {string} saidAreaId 申告した区画
   * @returns {boolean} 食い違っていれば true
   */
  function isContradiction(clueId, saidAreaId) {
    var c = clueById(clueId);
    if (!c) return true;                       // 知らない手がかりは通さない
    if (!areaById(saidAreaId)) return true;    // 知らない区画も通さない
    return c.areas.indexOf(saidAreaId) === -1;
  }

  /**
   * 「隣の区画までなら通る嘘」が実際に存在するか。
   * これが無いとゲームの核が消えるので、データの側で確かめられるようにしておく。
   * @returns {number} 2区画以上にまたがる手がかりの数
   */
  function overlappingClueCount() {
    return CLUES.filter(function (c) { return c.areas.length >= 2; }).length;
  }

  /**
   * 申告を求める相手を選ぶ。
   * **まだ申告していない人から先に選ぶ**（設計書の決めごと㉑）。
   * 完全ランダムだと同じ人に続けて当たり、
   * 「毎ターン必ず誰かが申告する」というたるみ防止の仕掛けが効かなくなる。
   *
   * @param {string[]} candidates いま選べる人
   * @param {Object} askedCount memberId -> これまで求められた回数
   */
  function pickAsked(candidates, askedCount, rnd) {
    var list = (candidates || []).slice();
    if (!list.length) return null;
    var counts = askedCount || {};
    var least = Math.min.apply(null, list.map(function (id) { return counts[id] || 0; }));
    var pool = list.filter(function (id) { return (counts[id] || 0) === least; });
    var r = rnd || Math.random;
    return pool[Math.floor(r() * pool.length)] || pool[0];
  }

  /**
   * 申告をどう言うか。**手渡し版と部屋版で同じ言葉を通す**ための1か所。
   * つじつまが合わなかった時も、責める言い方にしない（原則7）
   */
  function sayWords(said) {
    if (!said) return { note: '', hint: '' };
    if (said.silent) return { note: said.name + ' さんは何も言いませんでした', hint: '' };
    var head = said.name + ' さんは「' + said.areaName + '」にいると言いました';
    if (said.caught) {
      return {
        note: 'つじつまが合いません。' + said.back + 'マスもどる',
        hint: head + '（' + said.clueText + '）'
      };
    }
    return { note: head, hint: '「' + said.clueText + '」' };
  }

  return {
    AREA_COUNT: AREA_COUNT, CAUGHT_BACK: CAUGHT_BACK,
    AREAS: AREAS, CLUES: CLUES,
    areaCount: areaCount, areas: areas, clues: clues,
    areaById: areaById, clueById: clueById,
    areaOf: areaOf, cluesOf: cluesOf,
    isContradiction: isContradiction, overlappingClueCount: overlappingClueCount,
    pickAsked: pickAsked, sayWords: sayWords
  };
}));
