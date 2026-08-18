// qr.js — 部屋コードを配るためのQRコード生成（第22弾-1）
//
// 外部ライブラリを足さずに済ませたいので自前で書いている。
// 対応は「バイトモード・誤り訂正レベルL・バージョン1〜10」だけ。
// 部屋への参加URL（40文字程度）が入れば十分で、それ以上は要らない。
//
// 正しさは tests/qr.js で確かめている:
//   ・Reed-Solomon の符号語を、規格の公開されている例と突き合わせる
//   ・形式情報を規格の対応表と突き合わせる
//   ・自分で作った matrix を読み戻して、元の文字列に戻ることを確かめる
//   ・独立実装のデコーダー（jsqr・テスト専用）で読めて、中身が一致する
// （読み戻しは自分の配置ロジックを共有するので、置き場所の系統誤りは
//  独立デコーダーでしか捕まらない——実機報告「QRが読み取れない」8/18の教訓）

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QR = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---- ガロア体 GF(256)。QRの規格で決まっている原始多項式 0x11d ----
  var EXP = new Array(512), LOG = new Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      EXP[i] = x; LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  }());
  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP[LOG[a] + LOG[b]];
  }
  // 誤り訂正用の生成多項式
  function rsGenerator(n) {
    var poly = [1];
    for (var i = 0; i < n; i++) {
      var next = poly.concat([0]);
      for (var j = 0; j < poly.length; j++) {
        next[j + 1] ^= gfMul(poly[j], EXP[i]);
      }
      poly = next;
    }
    return poly;
  }
  function rsEncode(data, ecLen) {
    var gen = rsGenerator(ecLen);
    var res = data.concat(new Array(ecLen).fill(0));
    for (var i = 0; i < data.length; i++) {
      var coef = res[i];
      if (coef === 0) continue;
      for (var j = 1; j < gen.length; j++) {
        res[i + j] ^= gfMul(gen[j], coef);
      }
    }
    return res.slice(data.length);
  }

  // ---- バージョンごとの諸元（誤り訂正レベルLのみ） ----
  // [総符号語数, 誤り訂正符号語数/ブロック, ブロック数]
  var VERSIONS = {
    1:  [26,   7, 1],
    2:  [44,  10, 1],
    3:  [70,  15, 1],
    4:  [100, 20, 1],
    5:  [134, 26, 1],
    6:  [172, 18, 2],
    7:  [196, 20, 2],
    8:  [242, 24, 2],
    9:  [292, 30, 2],
    10: [346, 18, 4]
  };
  // 位置合わせパターンの中心座標
  var ALIGN = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
    6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50]
  };

  function dataCapacity(v) {
    var spec = VERSIONS[v];
    return spec[0] - spec[1] * spec[2];
  }

  // ---- 文字列 → データ符号語 ----
  function toUtf8Bytes(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) { out.push(0xc0 | (c >> 6), 0x80 | (c & 63)); }
      else { out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); }
    }
    return out;
  }
  function pickVersion(byteLen) {
    for (var v = 1; v <= 10; v++) {
      var lenBits = (v < 10) ? 8 : 16;
      var need = 4 + lenBits + byteLen * 8;
      if (need <= dataCapacity(v) * 8) return v;
    }
    return null;
  }
  function buildData(bytes, version) {
    var bits = [];
    function push(val, len) {
      for (var i = len - 1; i >= 0; i--) bits.push((val >> i) & 1);
    }
    push(0x4, 4);                       // バイトモード
    push(bytes.length, version < 10 ? 8 : 16);
    bytes.forEach(function (b) { push(b, 8); });
    var cap = dataCapacity(version) * 8;
    // 終端子（最大4bit）
    for (var t = 0; t < 4 && bits.length < cap; t++) bits.push(0);
    while (bits.length % 8 !== 0) bits.push(0);
    var words = [];
    for (var i = 0; i < bits.length; i += 8) {
      var b = 0;
      for (var k = 0; k < 8; k++) b = (b << 1) | bits[i + k];
      words.push(b);
    }
    // 埋め草は 0xEC / 0x11 の繰り返し
    var pad = [0xEC, 0x11], p = 0;
    while (words.length < dataCapacity(version)) words.push(pad[p++ % 2]);
    return words;
  }
  // ブロックに分けて、データと誤り訂正をそれぞれ交互に並べる
  function interleave(words, version) {
    var spec = VERSIONS[version];
    var ecLen = spec[1], blocks = spec[2];
    var per = Math.floor(words.length / blocks);
    var extra = words.length % blocks; // 後ろのブロックが1語ずつ多い
    var dataBlocks = [], ecBlocks = [];
    var at = 0;
    for (var i = 0; i < blocks; i++) {
      var size = per + (i >= blocks - extra ? 1 : 0);
      var d = words.slice(at, at + size);
      at += size;
      dataBlocks.push(d);
      ecBlocks.push(rsEncode(d, ecLen));
    }
    var out = [];
    var maxD = Math.max.apply(null, dataBlocks.map(function (b) { return b.length; }));
    for (var c = 0; c < maxD; c++) {
      for (var b = 0; b < blocks; b++) if (c < dataBlocks[b].length) out.push(dataBlocks[b][c]);
    }
    for (var e = 0; e < ecLen; e++) {
      for (var b2 = 0; b2 < blocks; b2++) out.push(ecBlocks[b2][e]);
    }
    return out;
  }

  // ---- 行列の組み立て ----
  function newMatrix(size) {
    var m = [];
    for (var i = 0; i < size; i++) m.push(new Array(size).fill(null));
    return m;
  }
  function placeFinder(m, r, c) {
    for (var i = -1; i <= 7; i++) {
      for (var j = -1; j <= 7; j++) {
        var rr = r + i, cc = c + j;
        if (rr < 0 || cc < 0 || rr >= m.length || cc >= m.length) continue;
        var on = (i >= 0 && i <= 6 && (j === 0 || j === 6)) ||
                 (j >= 0 && j <= 6 && (i === 0 || i === 6)) ||
                 (i >= 2 && i <= 4 && j >= 2 && j <= 4);
        m[rr][cc] = on ? 1 : 0;
      }
    }
  }
  function placeFixed(m, version) {
    var size = m.length;
    placeFinder(m, 0, 0);
    placeFinder(m, 0, size - 7);
    placeFinder(m, size - 7, 0);
    // タイミングパターン
    for (var i = 8; i < size - 8; i++) {
      m[6][i] = (i % 2 === 0) ? 1 : 0;
      m[i][6] = (i % 2 === 0) ? 1 : 0;
    }
    // 位置合わせパターン。外すのは3つのファインダーと重なる角の組み合わせだけ。
    // 「中心が埋まっていたら置かない」で代用すると、バージョン7以上で規格が要求する
    // タイミングパターン上の位置合わせ（例：v7の(6,22)）まで消えてしまう。
    // 重なるタイミングパターンのマスとは明暗が一致するので、上書きしてよい
    var pos = ALIGN[version];
    var lastPos = pos.length ? pos[pos.length - 1] : 0;
    for (var a = 0; a < pos.length; a++) {
      for (var b = 0; b < pos.length; b++) {
        var r = pos[a], c = pos[b];
        if ((r === 6 && c === 6) || (r === 6 && c === lastPos) || (r === lastPos && c === 6)) continue;
        for (var dr = -2; dr <= 2; dr++) {
          for (var dc = -2; dc <= 2; dc++) {
            var on = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
            m[r + dr][c + dc] = on ? 1 : 0;
          }
        }
      }
    }
    m[size - 8][8] = 1; // 常に暗いモジュール
  }
  // 形式情報・バージョン情報を置く場所（データを書けない領域）
  function reserveFormat(m) {
    var size = m.length;
    for (var i = 0; i <= 8; i++) {
      if (m[8][i] === null) m[8][i] = 0;
      if (m[i][8] === null) m[i][8] = 0;
    }
    for (var j = 0; j < 8; j++) {
      if (m[8][size - 1 - j] === null) m[8][size - 1 - j] = 0;
      if (m[size - 1 - j][8] === null) m[size - 1 - j][8] = 0;
    }
  }

  var MASKS = [
    function (r, c) { return (r + c) % 2 === 0; },
    function (r) { return r % 2 === 0; },
    function (r, c) { return c % 3 === 0; },
    function (r, c) { return (r + c) % 3 === 0; },
    function (r, c) { return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0; },
    function (r, c) { return (r * c) % 2 + (r * c) % 3 === 0; },
    function (r, c) { return ((r * c) % 2 + (r * c) % 3) % 2 === 0; },
    function (r, c) { return ((r + c) % 2 + (r * c) % 3) % 2 === 0; }
  ];

  // 右下から、2列ずつジグザグにデータを置く
  function dataPositions(m) {
    var size = m.length, pos = [], up = true;
    for (var right = size - 1; right > 0; right -= 2) {
      if (right === 6) right = 5; // タイミング列は飛ばす
      for (var k = 0; k < size; k++) {
        var row = up ? (size - 1 - k) : k;
        for (var t = 0; t < 2; t++) {
          var col = right - t;
          if (m[row][col] === null) pos.push([row, col]);
        }
      }
      up = !up;
    }
    return pos;
  }

  // 形式情報（レベルL＋マスク番号）。規格の生成多項式で誤り訂正を付ける
  function formatBits(maskId) {
    var data = (0x1 << 3) | maskId; // Lは 01
    var v = data << 10;
    var g = 0x537;
    for (var i = 14; i >= 10; i--) {
      if ((v >> i) & 1) v ^= g << (i - 10);
    }
    return ((data << 10) | v) ^ 0x5412;
  }
  function placeFormat(m, maskId) {
    var size = m.length;
    var bits = formatBits(maskId);
    function bit(i) { return (bits >> i) & 1; }
    // 向きは規格で固定：左上は「縦0..5→角→横9..14」、もう1組は「右上の横0..7＋左下の縦8..14」。
    // 行と列を入れ替えても readBack の検算は通ってしまう（読み戻しは形式情報を使わない）ので、
    // 正しさは tests/qr.js の独立デコーダーで固定している
    for (var i = 0; i <= 5; i++) m[i][8] = bit(i);
    m[7][8] = bit(6); m[8][8] = bit(7); m[8][7] = bit(8);
    for (var j = 9; j <= 14; j++) m[8][14 - j] = bit(j);
    for (var k = 0; k <= 7; k++) m[8][size - 1 - k] = bit(k);
    for (var n = 8; n <= 14; n++) m[size - 15 + n][8] = bit(n);
    m[size - 8][8] = 1; // 常に暗いモジュール（形式情報のビットで潰さない）
  }
  // バージョン7以上には、別途バージョン情報が入る
  function placeVersionInfo(m, version) {
    if (version < 7) return;
    var v = version << 12;
    var g = 0x1f25;
    for (var i = 17; i >= 12; i--) {
      if ((v >> i) & 1) v ^= g << (i - 12);
    }
    var bits = (version << 12) | v;
    var size = m.length;
    for (var k = 0; k < 18; k++) {
      var b = (bits >> k) & 1;
      m[Math.floor(k / 3)][size - 11 + (k % 3)] = b;
      m[size - 11 + (k % 3)][Math.floor(k / 3)] = b;
    }
  }

  // 見やすさの評価（規格のペナルティ計算を簡略化したもの）
  function penalty(m) {
    var size = m.length, score = 0;
    // 同じ色が続く
    for (var i = 0; i < size; i++) {
      for (var dir = 0; dir < 2; dir++) {
        var run = 1;
        for (var j = 1; j < size; j++) {
          var a = dir ? m[j - 1][i] : m[i][j - 1];
          var b = dir ? m[j][i] : m[i][j];
          if (a === b) run++;
          else { if (run >= 5) score += 3 + (run - 5); run = 1; }
        }
        if (run >= 5) score += 3 + (run - 5);
      }
    }
    // 2x2の同色
    for (var r = 0; r < size - 1; r++) {
      for (var c = 0; c < size - 1; c++) {
        var v = m[r][c];
        if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
      }
    }
    // 全体の暗さの偏り
    var dark = 0;
    for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) if (m[y][x]) dark++;
    var ratio = dark * 100 / (size * size);
    score += Math.floor(Math.abs(ratio - 50) / 5) * 10;
    return score;
  }

  // ---- 本体 ----
  function generate(text) {
    var bytes = toUtf8Bytes(String(text));
    var version = pickVersion(bytes.length);
    if (!version) throw new Error('QRに入れるには長すぎます: ' + bytes.length + 'バイト');
    var words = interleave(buildData(bytes, version), version);

    var size = version * 4 + 17;
    var base = newMatrix(size);
    placeFixed(base, version);
    placeVersionInfo(base, version);
    reserveFormat(base);

    var pos = dataPositions(base);
    var best = null;
    for (var maskId = 0; maskId < 8; maskId++) {
      var m = base.map(function (row) { return row.slice(); });
      var maskFn = MASKS[maskId];
      for (var i = 0; i < pos.length; i++) {
        var byteI = i >> 3, bitI = 7 - (i & 7);
        var b = (byteI < words.length) ? ((words[byteI] >> bitI) & 1) : 0;
        var r = pos[i][0], c = pos[i][1];
        m[r][c] = maskFn(r, c) ? (b ^ 1) : b;
      }
      placeFormat(m, maskId);
      var p = penalty(m);
      if (!best || p < best.score) best = { matrix: m, score: p, maskId: maskId };
    }
    return { matrix: best.matrix, size: size, version: version, maskId: best.maskId };
  }

  // 生成した行列から、置いたデータを読み戻す（自分の出力の検算用）
  function readBack(res) {
    var m = res.matrix, maskFn = MASKS[res.maskId];
    var base = newMatrix(res.size);
    placeFixed(base, res.version);
    placeVersionInfo(base, res.version);
    reserveFormat(base);
    var pos = dataPositions(base);
    var bits = pos.map(function (p) {
      var v = m[p[0]][p[1]];
      return maskFn(p[0], p[1]) ? (v ^ 1) : v;
    });
    var words = [];
    for (var i = 0; i + 8 <= bits.length; i += 8) {
      var b = 0;
      for (var k = 0; k < 8; k++) b = (b << 1) | bits[i + k];
      words.push(b);
    }
    return words;
  }

  // SVGとして描く（画像ファイルを増やさずに済む）
  function toSvg(text, opts) {
    opts = opts || {};
    var res = generate(text);
    var quiet = (opts.quiet === undefined) ? 4 : opts.quiet;
    var total = res.size + quiet * 2;
    var d = [];
    for (var r = 0; r < res.size; r++) {
      for (var c = 0; c < res.size; c++) {
        if (res.matrix[r][c]) d.push('M' + (c + quiet) + ' ' + (r + quiet) + 'h1v1h-1z');
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + total + ' ' + total + '" ' +
      'shape-rendering="crispEdges" role="img" aria-label="' + (opts.label || '部屋コードのQRコード') + '">' +
      '<rect width="' + total + '" height="' + total + '" fill="' + (opts.bg || '#fff') + '"/>' +
      '<path d="' + d.join('') + '" fill="' + (opts.fg || '#000') + '"/></svg>';
  }

  return {
    generate: generate, toSvg: toSvg, readBack: readBack,
    // 検算のために内部も出しておく
    _rsEncode: rsEncode, _formatBits: formatBits, _buildData: buildData,
    _interleave: interleave, _pickVersion: pickVersion, _toUtf8Bytes: toUtf8Bytes,
    VERSIONS: VERSIONS
  };
}));
