// tools/film-pair.js — TV とスマホを左右に並べた動画（GIF）を作る部品（tools/pittari-start-film.js・tools/sync-film.js が使う）
//
// 送りを受ける：Chrome の画面の送り（Page.startScreencast）を、届いた時刻つきでためる（合図は JS の時計なので「本当の時計」で撮る）
// コマを並べる：ためた送りから、t0 から sec 秒を fps コマ/秒に並べ直す（その時刻より前の、いちばん新しい送り）
// 並べる：左に TV、右にスマホ（高さを TV に合わせて、近いほうの画素で縮める）
'use strict';
const { decodePng } = require('./gif-lite');

function 送りを受ける(dev, w, h) {
  const got = [];
  const off = dev.onEvent((m) => {
    if (m.method !== 'Page.screencastFrame') return;
    got.push({ t: m.params.metadata.timestamp * 1000, data: m.params.data });
    dev.raw('Page.screencastFrameAck', { sessionId: m.params.sessionId }).catch(() => {});
  });
  return { got, start: () => dev.raw('Page.startScreencast', { format: 'png', maxWidth: w, maxHeight: h, everyNthFrame: 1 }),
    stop: async () => { await dev.raw('Page.stopScreencast'); off(); } };
}
function コマを並べる(got, t0, sec, fps) {
  const out = [];
  for (let i = 0; i <= Math.round(sec * fps); i++) {
    const want = t0 + i * 1000 / fps;
    let pick = got[0];
    for (const f of got) { if (f.t <= want) pick = f; else break; }
    out.push(decodePng(Buffer.from(pick.data, 'base64')));
  }
  return out;
}
function 並べる(a, b) {
  const h = a.h, k = b.h / h, bw = Math.round(b.w / k), gap = 8, w = a.w + gap + bw;
  const rgba = new Uint8Array(w * h * 4).fill(255);
  for (let y = 0; y < h; y++) {
    rgba.set(a.rgba.subarray((y * a.w) * 4, (y * a.w + a.w) * 4), (y * w) * 4);
    const sy = Math.min(b.h - 1, Math.floor(y * k));
    for (let x = 0; x < bw; x++) {
      const sx = Math.min(b.w - 1, Math.floor(x * k));
      rgba.set(b.rgba.subarray((sy * b.w + sx) * 4, (sy * b.w + sx) * 4 + 4), (y * w + a.w + gap + x) * 4);
    }
  }
  return { w, h, rgba };
}
module.exports = { 送りを受ける, コマを並べる, 並べる };
