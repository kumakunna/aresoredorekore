#!/usr/bin/env node
// tools/flow-sheet.js — tools/flow-walk.js が撮った手順ごとの画像を、1枚の「一覧の画像」にする（指示62）
//
//   node tools/flow-sheet.js docs/監査_審査会の指摘_画像/bakudan
//
// **並べ方**：上から 参加者の段（主）→ 進行役の段 → 大画面の段。
// どの段も手順番号つきで縮小して左から並べる。**前の手順と同じ画面のままの時は、
// 小さな「（同じ）」の札にする**——同じ絵が何十枚も並ぶと、変わった所が見えなくなる。
// 「同じ」は、画面id＋見えている文字＋重なりが前と同じかで決める（画像の比較はしない）。
//
// 画像は Chrome（tools/cdp.js）で HTML を描いて撮る。依存を足さない。
// 出来上がりは <置き場>/一覧.jpg。

const fs = require('fs');
const path = require('path');
const { launch, sleep } = require('./cdp');

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function sheetHtml(dir, data) {
  const 段 = [['参加者', 150], ['進行役', 110], ['大画面', 260]];
  const 手順 = data.手順 || [];
  const 鍵 = (r, k) => { const m = (r.測り || {})[k] || {}; return (m.画面 || '') + '|' + (m.重なり || []).join(',') + '|' + (m.字 || ''); };
  let html = '<!doctype html><meta charset="utf-8"><style>' +
    'body{margin:0;padding:24px;background:#f4f1ea;font:14px/1.4 "Yu Gothic UI","Meiryo",sans-serif;color:#222;width:max-content;max-width:2400px}' +
    'h1{font-size:26px;margin:0 0 4px}h2{font-size:18px;margin:22px 0 8px;border-bottom:2px solid #333;padding-bottom:2px}' +
    '.meta{color:#555;margin-bottom:6px}.row{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-start}' +
    '.c{display:flex;flex-direction:column;align-items:center;gap:2px}.c img{display:block;border:1px solid #999;background:#fff}' +
    '.n{font-weight:700;font-size:13px}.l{font-size:10.5px;color:#444;text-align:center;line-height:1.25;overflow:hidden;max-height:2.6em}' +
    '.same{display:flex;align-items:center;justify-content:center;border:1px dashed #aaa;color:#999;font-size:11px;background:#fbfaf6}' +
    '.fail{outline:3px solid #d33}.who{display:inline-block;padding:0 6px;border-radius:4px;background:#333;color:#fff;font-size:10px}' +
    '</style>';
  html += '<h1>' + esc(data.カセット) + (data.モード ? '：' + esc(data.モード.名) : '') + '</h1>';
  html += '<div class="meta">遊び方：' + esc(data.遊び方 === 'hand' ? '手渡し（1台）' : '部屋（QRで参加・4人＝進行役＋人の役＋bot 2）') +
    ' ／ 手順 ' + 手順.length + ' ／ ' + esc(data.かかった秒) + '秒' + (data.失敗 ? ' ／ <b style="color:#c00">途中で止まった</b>' : '') + '</div>';
  for (const [k, w] of 段) {
    const 撮れた = 手順.filter((r) => r.画像 && r.画像[k]);
    if (!撮れた.length) continue;
    html += '<h2>' + esc(k) + (k === '参加者' ? '（375×667・人の役）' : k === '進行役' ? '（375×812）' : '（1280×720）') + '</h2><div class="row">';
    let prev = null;
    for (const r of 撮れた) {
      const key = 鍵(r, k);
      const 主 = r.誰 === k || r.誰 === '全員';
      const h = Math.round(w * (k === '大画面' ? 720 / 1280 : k === '参加者' ? 667 / 375 : 812 / 375));
      if (key === prev && !主) {
        html += '<div class="c"><div class="n">' + r.no + '</div><div class="same" style="width:' + Math.round(w * 0.35) + 'px;height:' + h + 'px">同じ</div></div>';
        continue;
      }
      prev = key;
      html += '<div class="c' + (r.失敗 ? ' fail' : '') + '"><div class="n">' + r.no + (主 ? ' <span class="who">' + esc(r.する) + '</span>' : '') + '</div>' +
        '<img src="' + esc(r.画像[k]) + '" style="width:' + w + 'px;height:' + h + 'px">' +
        '<div class="l" style="width:' + w + 'px">' + esc(主 ? r.名 : (r.画面 || {})[k] || '') + '</div></div>';
    }
    html += '</div>';
  }
  return html;
}

async function build(dir, opt) {
  const data = JSON.parse(fs.readFileSync(path.join(dir, '記録.json'), 'utf8'));
  const file = path.join(dir, '一覧.html');
  fs.writeFileSync(file, sheetHtml(dir, data));
  const b = await launch({ port: (opt && opt.port) || 9390 });
  try {
    const d = await b.newDevice('一覧', { width: 2400, height: 1000, mobile: false, deviceScaleFactor: 1 });
    await d.go('file:///' + file.replace(/\\/g, '/'));
    await d.until("Array.from(document.images).every(function(i){return i.complete;})", 20000, '画像の読み込み');
    await sleep(300);
    const size = await d.ev("({w:Math.ceil(document.body.scrollWidth), h:Math.ceil(document.body.scrollHeight)})");
    // 全体を1枚に撮る（captureBeyondViewport）
    return await d.shotFull(path.join(dir, '一覧.jpg'), size);
  } finally { await b.close(); }
}

module.exports = { build, sheetHtml };
if (require.main === module) {
  const dir = path.resolve(process.argv[2] || '.');
  build(dir).then((f) => console.log('一覧の画像：' + f)).catch((e) => { console.error(e); process.exit(1); });
}
