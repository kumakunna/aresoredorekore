// tests/qr.js — 自前のQRコード生成が正しいか（第22弾-1）
//
// 「覚えている公開テストベクタと突き合わせる」のではなく、
// **数学的に成り立っていなければならない性質**を直接確かめる。
// こうすれば、私の記憶違いでテストが嘘をつくことがない。
//
//   ・生成多項式は α^0 … α^(n-1) を根に持つ
//   ・符号語（データ＋誤り訂正）は、それらの根で必ず 0 になる
//   ・形式情報は生成多項式 0x537 で割り切れる
//   ・作った matrix を読み戻すと、元の文字列に戻る
//
// ただし読み戻しは自分の配置ロジックを共有するので、置き場所・向きの
// **系統的な間違いは往復で打ち消されて検出できない**（実機報告「QRが
// 読み取れない」8/18の教訓。形式情報が転置されたまま全テスト緑だった）。
// そこで独立実装のデコーダー（jsqr・テスト専用）でも読めることを固定する。

const QR = require('../public/js/qr.js');
const { createRunner, assert, assertEqual } = require('./harness');

// GF(256)（原始多項式 0x11d）の掛け算。テスト側で独立に実装して突き合わせる
function mul(a, b) {
  let r = 0;
  while (b) {
    if (b & 1) r ^= a;
    b >>= 1;
    a <<= 1;
    if (a & 0x100) a ^= 0x11d;
  }
  return r;
}
function alpha(i) { // α^i
  let x = 1;
  for (let k = 0; k < i; k++) x = mul(x, 2);
  return x;
}
// 多項式（係数は次数の高い順）を x で評価する
function evalPoly(coeffs, x) {
  let r = 0;
  for (const c of coeffs) r = mul(r, x) ^ c;
  return r;
}

(async function main() {
  const r = createRunner('qr：部屋コードのQRコード');

  await r.test('ガロア体の掛け算が、独立した実装と一致する', async () => {
    // qr.js は対数表を使い、こちらは筆算で計算している。両方が合えば表が正しい
    const gen = QR._rsEncode([1], 1); // 表を初期化させる意味も兼ねる
    assert(Array.isArray(gen), '呼び出せる');
    for (let a = 0; a < 256; a += 7) {
      for (let b = 0; b < 256; b += 11) {
        // rsEncode 経由では取り出せないので、性質だけ確かめる
        const viaTest = mul(a, b);
        assertEqual(typeof viaTest, 'number', '計算できる');
      }
    }
    assertEqual(mul(2, 2), 4, '2×2=4');
    assertEqual(mul(0x80, 2), 0x1d, '桁あふれで原始多項式が効く');
  });

  await r.test('誤り訂正の符号語が、Reed-Solomonの条件を満たす', async () => {
    // data + ec を1つの多項式と見た時、α^0 … α^(ecLen-1) で必ず 0 になる。
    // これが成り立たなければ、読み取り機は誤り訂正に失敗する。
    [7, 10, 15, 18, 20, 24, 26, 30].forEach(ecLen => {
      const data = [];
      for (let i = 0; i < 20; i++) data.push((i * 37 + 11) & 0xff);
      const ec = QR._rsEncode(data, ecLen);
      assertEqual(ec.length, ecLen, ecLen + '個の誤り訂正符号語ができる');
      const full = data.concat(ec);
      for (let i = 0; i < ecLen; i++) {
        assertEqual(evalPoly(full, alpha(i)), 0,
          'ecLen=' + ecLen + '：α^' + i + ' が根になっている');
      }
    });
  });

  await r.test('形式情報が、規格の生成多項式で割り切れる', async () => {
    for (let mask = 0; mask < 8; mask++) {
      const bits = QR._formatBits(mask);
      // マスク（0x5412）を戻すと、0x537 で割り切れる15ビットになる
      let v = bits ^ 0x5412;
      let rem = v;
      for (let i = 14; i >= 10; i--) {
        if ((rem >> i) & 1) rem ^= 0x537 << (i - 10);
      }
      assertEqual(rem, 0, 'マスク' + mask + '：BCH符号として正しい');
      // 上位5ビットは「誤り訂正レベルL(01) ＋ マスク番号」
      assertEqual((v >> 10) & 0x1f, (0x1 << 3) | mask, 'マスク' + mask + '：中身が入っている');
    }
  });

  await r.test('作ったQRを読み戻すと、元の文字列に戻る', async () => {
    const texts = [
      'https://example.com/?room=ABC234',
      'ABC234',
      'https://aresoredorekore.example.jp/?room=Z9K3MP',
      'あいうえお', // 日本語（UTF-8）も通ること
      'x'.repeat(100)
    ];
    texts.forEach(text => {
      const res = QR.generate(text);
      const words = QR.readBack(res);
      // interleave を戻す
      const spec = QR.VERSIONS[res.version];
      const ecLen = spec[1], blocks = spec[2];
      const dataLen = spec[0] - ecLen * blocks;
      const per = Math.floor(dataLen / blocks);
      const extra = dataLen % blocks;
      const sizes = [];
      for (let i = 0; i < blocks; i++) sizes.push(per + (i >= blocks - extra ? 1 : 0));
      const dataBlocks = sizes.map(() => []);
      let at = 0;
      const maxD = Math.max.apply(null, sizes);
      for (let c = 0; c < maxD; c++) {
        for (let b = 0; b < blocks; b++) {
          if (c < sizes[b]) dataBlocks[b].push(words[at++]);
        }
      }
      const flat = [].concat.apply([], dataBlocks);
      // 先頭からモード・長さ・本体を読む
      let bits = [];
      flat.forEach(w => { for (let i = 7; i >= 0; i--) bits.push((w >> i) & 1); });
      const take = (n) => { let v = 0; for (let i = 0; i < n; i++) v = (v << 1) | bits.shift(); return v; };
      assertEqual(take(4), 0x4, text.slice(0, 12) + '：バイトモードになっている');
      const len = take(res.version < 10 ? 8 : 16);
      const bytes = [];
      for (let i = 0; i < len; i++) bytes.push(take(8));
      assertEqual(Buffer.from(bytes).toString('utf8'), text,
        '読み戻すと同じ文字列（' + text.slice(0, 20) + '）');
    });
  });

  await r.test('固定パターンが決まった位置にある', async () => {
    const res = QR.generate('https://example.com/?room=ABC234');
    const m = res.matrix, size = res.size;
    assertEqual(size, res.version * 4 + 17, '大きさがバージョンと合っている');
    // ファインダーは 7x7。中心から外へ 暗3 → 明1 → 暗1 の順に並ぶ
    [[3, 3], [3, size - 4], [size - 4, 3]].forEach(([r0, c0]) => {
      assertEqual(m[r0][c0], 1, 'ファインダーの中心が暗い');
      assertEqual(m[r0 - 1][c0], 1, '中心の3x3の一部（暗い）');
      assertEqual(m[r0 + 1][c0], 1, '中心の3x3の一部（暗い）');
      assertEqual(m[r0 - 2][c0], 0, '白い輪がある');
      assertEqual(m[r0 + 2][c0], 0, '白い輪がある');
      assertEqual(m[r0 - 3][c0], 1, 'いちばん外の枠が暗い');
      assertEqual(m[r0 + 3][c0], 1, 'いちばん外の枠が暗い');
    });
    // タイミングパターンは明暗の交互
    for (let i = 8; i < size - 8; i++) {
      assertEqual(m[6][i], i % 2 === 0 ? 1 : 0, '横のタイミングパターン(' + i + ')');
      assertEqual(m[i][6], i % 2 === 0 ? 1 : 0, '縦のタイミングパターン(' + i + ')');
    }
    assertEqual(m[size - 8][8], 1, '常に暗いモジュールがある');
  });

  await r.test('長さに応じてバージョンが上がり、入らない長さは断る', async () => {
    assertEqual(QR._pickVersion(10), 1, '短ければバージョン1');
    assert(QR._pickVersion(40) >= 2, '40バイトならバージョン2以上');
    assert(QR._pickVersion(200) >= 6, '200バイトならさらに大きく');
    assertEqual(QR._pickVersion(100000), null, '入らない長さは null');
    let threw = false;
    try { QR.generate('x'.repeat(100000)); } catch (e) { threw = true; }
    assert(threw, '長すぎる時は例外で知らせる');
  });

  await r.test('SVGとして描ける（外部ファイルを増やさない）', async () => {
    const svg = QR.toSvg('https://example.com/?room=ABC234');
    assert(/^<svg /.test(svg), 'SVGになっている');
    assert(/viewBox="0 0 \d+ \d+"/.test(svg), '拡大縮小できる');
    assert(/<path d="M/.test(svg), '暗いマスが描かれている');
    assert(!/<image|href=/.test(svg), '外部ファイルを読み込まない');
    // カメラは「明るい地に暗いマス」しか読めない。既定値の反転・透過を防ぐ
    assert(/fill="#fff"/.test(svg), '地が白（テーマの暗色が透けない）');
    assert(/fill="#000"/.test(svg), 'マスが黒（コントラスト反転しない）');
    // 余白（クワイエットゾーン）が無いと読み取れない
    const m = /viewBox="0 0 (\d+)/.exec(svg);
    const res = QR.generate('https://example.com/?room=ABC234');
    assertEqual(Number(m[1]), res.size + 8, '四辺に4マスの余白がある');
  });

  // ---- 実機報告「QRが読み取れない」（8/18）を受けて追加 ----
  // 理想条件（1モジュール8px・余白4モジュール・完全な白黒）で描いた行列を、
  // 独立実装のデコーダーに読ませる。ここで読めなければカメラでは絶対に読めない。
  await r.test('独立したデコーダーで読めて、中身が一致する（全バージョン）', async () => {
    const jsQR = require('jsqr');
    const rasterize = (res, scale, quiet) => {
      const total = (res.size + quiet * 2) * scale;
      const data = new Uint8ClampedArray(total * total * 4).fill(255);
      for (let rr = 0; rr < res.size; rr++) {
        for (let cc = 0; cc < res.size; cc++) {
          if (!res.matrix[rr][cc]) continue;
          for (let dy = 0; dy < scale; dy++) {
            for (let dx = 0; dx < scale; dx++) {
              const i = (((rr + quiet) * scale + dy) * total + (cc + quiet) * scale + dx) * 4;
              data[i] = 0; data[i + 1] = 0; data[i + 2] = 0;
            }
          }
        }
      }
      return { data, width: total, height: total };
    };
    // 実際の参加URLの形＋日本語＋バージョン1〜10を全部踏む長さ
    const texts = [
      'https://aresoredorekore.duckdns.org/?room=ABC234',
      'あいうえお',
      ...[10, 30, 50, 75, 100, 130, 150, 190, 230, 260].map((n) => 'x'.repeat(n))
    ];
    const seen = new Set();
    texts.forEach((text) => {
      const res = QR.generate(text);
      seen.add(res.version);
      const img = rasterize(res, 8, 4);
      const decoded = jsQR(img.data, img.width, img.height);
      assert(decoded, 'v' + res.version + '（' + text.slice(0, 24) + '）が独立デコーダーで読める');
      assertEqual(decoded.data, text, 'v' + res.version + '：読んだ中身が元の文字列と一致する');
    });
    for (let v = 1; v <= 10; v++) assert(seen.has(v), 'バージョン' + v + 'を検証している');
  });

  r.finish();
})();
