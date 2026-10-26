// tools/gif-lite.js — 道具だけで使う、小さな PNG の読み取りと GIF の書き出し（指示68-4）
//
// ffmpeg も画像の部品（sharp など）も入っていないので、見せ場の動画（tools/v2-film.js）を GIF にするために書いた。
// 読める PNG は、ブラウザ（CDP）の写真の形だけ：8ビット・RGB か RGBA・インターレースなし。
// 色は 6×7×6＋灰4 の決まった 256色にまるめる（見るための動画なので、色の細かさよりも軽さ）。
// 本番（public/）では使わない。
'use strict';
const zlib = require('zlib');

/** PNG → { w, h, rgba }（RGBA の Uint8Array） */
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('PNG ではありません');
  let pos = 8, w = 0, h = 0, type = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), name = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (name === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0) throw new Error('8ビット・インターレースなしの PNG だけ読めます');
      type = data[9];
      if (type !== 2 && type !== 6) throw new Error('RGB か RGBA の PNG だけ読めます');
    } else if (name === 'IDAT') idat.push(data);
    else if (name === 'IEND') break;
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = type === 6 ? 4 : 3, stride = w * bpp;
  const out = new Uint8Array(w * h * 4), prev = new Uint8Array(stride), cur = new Uint8Array(stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[p++];
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0, v = raw[p++];
      let r;
      if (f === 0) r = v;
      else if (f === 1) r = v + a;
      else if (f === 2) r = v + b;
      else if (f === 3) r = v + ((a + b) >> 1);
      else { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
      cur[x] = r & 255;
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      out[o] = cur[x * bpp]; out[o + 1] = cur[x * bpp + 1]; out[o + 2] = cur[x * bpp + 2]; out[o + 3] = bpp === 4 ? cur[x * bpp + 3] : 255;
    }
    prev.set(cur);
  }
  return { w, h, rgba: out };
}

// 決まった 256色：赤6・緑7・青6（252色）＋灰4
const PAL = (() => {
  const p = [];
  for (let r = 0; r < 6; r++) for (let g = 0; g < 7; g++) for (let b = 0; b < 6; b++) p.push([Math.round(r * 51), Math.round(g * 42.5), Math.round(b * 51)]);
  [32, 96, 160, 224].forEach((v) => p.push([v, v, v]));
  return p;
})();
function indexOf(r, g, b) { return Math.round(r / 51) * 42 + Math.round(g / 42.5) * 6 + Math.round(b / 51); }

/** LZW（GIF の圧縮）。最小のコードの長さは 8 */
function lzw(pixels) {
  const out = [];
  let cur = 0, bits = 0;
  const put = (code, size) => { cur |= code << bits; bits += size; while (bits >= 8) { out.push(cur & 255); cur >>>= 8; bits -= 8; } };
  const CLEAR = 256, END = 257;
  let size = 9, next = 258, dict = new Map();
  put(CLEAR, size);
  let prefix = pixels[0];
  for (let i = 1; i < pixels.length; i++) {
    const k = pixels[i], key = prefix * 256 + k;
    const hit = dict.get(key);
    if (hit !== undefined) { prefix = hit; continue; }
    put(prefix, size);
    if (next < 4096) {
      dict.set(key, next++);
      if (next > (1 << size) && size < 12) size++;
    } else { put(CLEAR, size); dict = new Map(); size = 9; next = 258; }
    prefix = k;
  }
  put(prefix, size);
  put(END, size);
  if (bits > 0) out.push(cur & 255);
  return Buffer.from(out);
}

/** frames：[{ w, h, rgba }]（同じ大きさ）、delayCs：1コマの長さ（100分の1秒）。くり返し再生する GIF を返す */
function encodeGif(frames, delayCs) {
  const { w, h } = frames[0];
  const parts = [];
  const hdr = Buffer.alloc(13);
  hdr.write('GIF89a', 0, 'ascii'); hdr.writeUInt16LE(w, 6); hdr.writeUInt16LE(h, 8); hdr[10] = 0xF7; hdr[11] = 0; hdr[12] = 0;
  parts.push(hdr);
  const pal = Buffer.alloc(768);
  PAL.forEach((c, i) => { pal[i * 3] = c[0]; pal[i * 3 + 1] = c[1]; pal[i * 3 + 2] = c[2]; });
  parts.push(pal);
  parts.push(Buffer.from([0x21, 0xFF, 0x0B]), Buffer.from('NETSCAPE2.0', 'ascii'), Buffer.from([3, 1, 0, 0, 0]));
  for (const f of frames) {
    const gce = Buffer.from([0x21, 0xF9, 4, 0, delayCs & 255, delayCs >> 8, 0, 0]);
    const desc = Buffer.alloc(10);
    desc[0] = 0x2C; desc.writeUInt16LE(0, 1); desc.writeUInt16LE(0, 3); desc.writeUInt16LE(w, 5); desc.writeUInt16LE(h, 7); desc[9] = 0;
    const px = new Uint8Array(w * h);
    for (let i = 0, o = 0; i < px.length; i++, o += 4) px[i] = indexOf(f.rgba[o], f.rgba[o + 1], f.rgba[o + 2]);
    const data = lzw(px);
    const blocks = [Buffer.from([8])];
    for (let i = 0; i < data.length; i += 255) { const c = data.subarray(i, i + 255); blocks.push(Buffer.from([c.length]), c); }
    blocks.push(Buffer.from([0]));
    parts.push(gce, desc, ...blocks);
  }
  parts.push(Buffer.from([0x3B]));
  return Buffer.concat(parts);
}

module.exports = { decodePng, encodeGif, lzw };
