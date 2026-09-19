// rcard-logic.js — カセット「ロシアンカード」のルール層（指示55-①）
//
// 設計の芯は bomb-logic.js / falsetrue-logic.js と同じ：
// **DOM も socket.io も知らない。**Node.js から require できる純粋な計算だけを置く。
//
// ---- 遊び方 ----
// 1試合は1対1。体力3ずつ。各自の前に9枚（3×3）のカードが伏せてある。
// **相手の9枚のうち3枚に、秘密で爆弾を仕掛ける。**
// 順番を決めて、**自分の9枚から1枚ずつ交互にめくる**。爆弾なら体力−1。
// 先に体力が0になった方が負け。
//
// 3人以上（部屋）は生き残り戦：全員を同時に1v1へ組み（部品A＝versus.js）、
// 勝った人は**体力をそのまま持ち越して**次へ。最後の1人が1位。
//
// ---- ここに置かないもの ----
// ・**爆弾がどこにあるか**は、進行役（rcard-room.js）が `room.rcard` に持つ。
//   この層は「位置の配列」を作る・当たったかを答える、までしかしない
// ・段階（phase）の進み方も進行役の仕事。ここは1手ぶんの計算だけ

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RcardLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ===== 盤の形 =====
  // **3×3 の9枚。**375px 幅だと1枚 102.3×136.4px・3段で 433.3px になる
  //（False or True の .ft-case と同じ計算）。これ以上増やすと 375×667 に入らない
  var 列 = 3;
  var 枚数 = 9;

  // ===== 数字は「具体の値」で持つ（落とし穴10-a：検査が実装の定数を借りないように） =====
  var 既定 = {
    体力: 3,
    爆弾: 3,        // ふだんの1試合
    決勝の爆弾: 5,  // 残り2人になった最後の1試合
    持ち時間: 15    // めくるまでの秒数
  };
  // 運営が変えられる幅。**上限と下限の両方を見る**（落とし穴8）
  var 幅 = {
    体力: [1, 5],
    爆弾: [1, 8],       // 9枚すべてが爆弾だと、めくる意味が無くなる
    決勝の爆弾: [1, 8],
    持ち時間: [5, 60]
  };

  function clampInt(v, min, max, fallback) {
    var n = parseInt(v, 10);
    if (!isFinite(n)) n = fallback;
    return Math.max(min, Math.min(max, n));
  }

  /** 設定を、遊べる値の範囲に収める */
  function normalizeConfig(cfg) {
    var c = cfg || {};
    var 爆弾 = clampInt(c.bombs, 幅.爆弾[0], 幅.爆弾[1], 既定.爆弾);
    var 決勝 = clampInt(c.finalBombs, 幅.決勝の爆弾[0], 幅.決勝の爆弾[1], 既定.決勝の爆弾);
    return {
      lives: clampInt(c.lives, 幅.体力[0], 幅.体力[1], 既定.体力),
      bombs: 爆弾,
      finalBombs: 決勝,
      turnSec: clampInt(c.turnSec, 幅.持ち時間[0], 幅.持ち時間[1], 既定.持ち時間)
    };
  }

  /**
   * **その試合で仕掛ける爆弾の数。**
   * 残り2人（＝この試合で最後の1人が決まる）なら「決勝の数」。
   *
   * 2人しかいない部屋・手渡しの1試合も、**最初から決勝**。
   * 「3人以上で遊んで最後に残った2人」と、遊ぶ人から見て同じ場面だから——
   * ここを「生き残り戦の時だけ決勝」にすると、2人で遊ぶ人は一生5つを見ない。
   */
  function bombsForMatch(生存者数, cfg) {
    var c = normalizeConfig(cfg);
    return (生存者数 <= 2) ? c.finalBombs : c.bombs;
  }

  /**
   * 爆弾を置く場所を選ぶ。**1始まりの番号**（1〜9）を、小さい順に返す。
   *
   * 1始まりにしたのは、画面に出る番号（「4ばんめ」）と同じにするため。
   * 0始まりだと、画面・秘匿の検査・変異の3か所で +1/−1 を書き分けることになる
   *（落とし穴5 の芽）。False or True も 1始まり（falsetrue-room.js:130）。
   */
  function makeBombs(rnd, 数) {
    var r = rnd || Math.random;
    var 残り = [];
    for (var i = 1; i <= 枚数; i++) 残り.push(i);
    var n = Math.max(0, Math.min(枚数, 数 == null ? 既定.爆弾 : 数));
    var 出 = [];
    for (var k = 0; k < n; k++) {
      var j = Math.floor(r() * 残り.length);
      出.push(残り.splice(j, 1)[0]);
    }
    return 出.sort(function (a, b) { return a - b; });
  }

  /** その番号が、盤の上の正しい場所か（1〜9の整数か） */
  function validCell(no) {
    var n = parseInt(no, 10);
    return isFinite(n) && n >= 1 && n <= 枚数;
  }

  /**
   * 1枚めくる。
   * @returns {{ok:boolean, hit:boolean, error:string}} `hit` が真なら爆弾
   */
  function flip(盤, no, 爆弾たち) {
    if (!validCell(no)) return { ok: false, hit: false, error: 'bad_cell' };
    var n = parseInt(no, 10);
    if ((盤.flipped || []).indexOf(n) !== -1) return { ok: false, hit: false, error: 'already' };
    return { ok: true, hit: (爆弾たち || []).indexOf(n) !== -1, error: '' };
  }

  /** まだめくっていない場所（時間切れでサーバーが1枚めくる時に使う） */
  function remaining(盤) {
    var out = [];
    for (var i = 1; i <= 枚数; i++) if ((盤.flipped || []).indexOf(i) === -1) out.push(i);
    return out;
  }

  /**
   * **順位をつける。**
   *
   * `敗退回` は「何回目の組み合わせで負けたか」（1から数える）。
   * **まだ負けていない人（＝勝ち残り）は null。**
   *
   * 最後の1人が1位。**負けた順に下がっていき、同じ回に負けた人は同着**。
   * 例）5人で、1回目に D と E が負け、2回目に C、3回目に B が負けたら
   *     A=1位 / B=2位 / C=3位 / D=4位ならび / E=4位ならび
   *
   * 同着は**ここでは数えない**——順位表の部品（`rankingHtml`）が
   * 「同じ rank が2つ以上あれば並び」と1周数えて導く（正本 §11-7）。
   * 作り先を増やさないため（落とし穴1）。
   */
  function rankPlayers(records) {
    var 一覧 = (records || []).slice();
    // 勝ち残りが先。負けた人は「遅く負けたほど上」
    var 並び = 一覧.slice().sort(function (a, b) {
      var A = (a.敗退回 == null) ? Infinity : a.敗退回;
      var B = (b.敗退回 == null) ? Infinity : b.敗退回;
      if (A !== B) return B - A;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
    var 出 = [], 見た = 0, 位 = 0, 前 = undefined;
    並び.forEach(function (x) {
      見た++;
      var key = (x.敗退回 == null) ? 'alive' : x.敗退回;
      if (key !== 前) { 位 = 見た; 前 = key; }
      出.push({ id: x.id, name: x.name, rank: 位, 敗退回: x.敗退回 });
    });
    return 出;
  }

  /**
   * 同じ回に両方が0になった時の勝ち（安全弁・指示 2-9）。
   * 交互にめくるので本来あり得ないが、時間切れの処理が重なった時のために置く。
   * **直前に多く残していた方**が勝ち。それも同じなら null（引き分け）。
   */
  function tieBreak(前の体力A, 前の体力B) {
    if (前の体力A > 前の体力B) return 'a';
    if (前の体力B > 前の体力A) return 'b';
    return null;
  }

  return {
    列: 列, 枚数: 枚数, 既定: 既定, 幅: 幅,
    normalizeConfig: normalizeConfig,
    bombsForMatch: bombsForMatch,
    makeBombs: makeBombs,
    validCell: validCell,
    flip: flip,
    remaining: remaining,
    rankPlayers: rankPlayers,
    tieBreak: tieBreak
  };
});
