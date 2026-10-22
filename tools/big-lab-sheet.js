#!/usr/bin/env node
// tools/big-lab-sheet.js — 実験台（tools/big-lab.js）が撮った大画面の画像を、シナリオごとの「一覧の画像」にする（指示64）
//
//   node tools/big-lab-sheet.js                       # docs/監査_大画面の画像/lab/ を読み、lab/一覧/<シナリオ>.jpg を作る
//   node tools/big-lab-sheet.js --size 1920           # 1920×1080 で撮った方を並べる（既定 1280）
//
// **並べ方**：1行＝1つの場面（待合 → 遊ぶ → 決着の順。実験台が流した順のまま）、1列＝人数（4・8・16・20…）。
// `--fx` で撮った「出ている最中の演出」（始まりの 3-2-1・巨大カウントダウン）は、その場面のすぐ下の行に並べる。
// ✖ の測り（巻き・切れ・小さい字・読めない名前）は赤い枠で囲み、理由を札に書く。
// 画像は Chrome（tools/cdp.js）で HTML を描いて撮る。依存を足さない（tools/flow-sheet.js と同じ作り）。

const fs = require('fs');
const path = require('path');
const { launch, sleep } = require('./cdp');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : argv[i + 1]; };
const DIR = path.resolve(arg('dir', path.join(__dirname, '..', 'docs', '監査_大画面の画像', 'lab')));
const SIZE = String(arg('size', '1280'));
const H = SIZE === '1920' ? 1080 : 720;
const OUT = path.join(DIR, '一覧');
const 幅 = 360;   // 1枚の縮小の幅（1280 の 9/32）

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function 悪い所(m) {
  if (!m) return ['測っていない'];
  const r = [];
  if (m.画面 !== 'scr-rt-big') r.push('画面=' + m.画面);
  if (m.ページの巻き > 0) r.push('巻き');
  if (m.箱の巻き && m.箱の巻き.length) r.push('中の巻き');
  if (m.切れの数) r.push('切れ' + m.切れの数);
  if (m.小さいの数) r.push('小さい字' + m.小さいの数);
  if (m.読めないの数) r.push('読めない名前' + m.読めないの数);
  return r;
}

function sheetHtml(シナリオ, recs) {
  const 人数 = Array.from(new Set(recs.map((r) => r.人数))).sort((a, b) => a - b);
  const 場面 = [];
  recs.forEach((r) => { if (場面.indexOf(r.場面) === -1) 場面.push(r.場面); });
  const 引く = (名, n) => recs.find((r) => r.場面 === 名 && r.人数 === n);
  const 画像 = (file) => file && fs.existsSync(path.join(DIR, file)) ? '../' + encodeURI(file) : null;
  let html = '<!doctype html><meta charset="utf-8"><style>' +
    'body{margin:0;padding:24px;background:#f4f1ea;font:14px/1.4 "Yu Gothic UI","Meiryo",sans-serif;color:#222;width:max-content}' +
    'h1{font-size:28px;margin:0 0 4px}.meta{color:#555;margin-bottom:14px}' +
    'table{border-collapse:separate;border-spacing:10px 8px}th{font-size:15px;text-align:left;padding:0 4px}' +
    'td.l{font-weight:700;font-size:14px;width:190px;vertical-align:top;padding-top:6px;word-break:break-all}' +
    'td.l .s{display:block;font-weight:400;font-size:12px;color:#666}' +
    'td.c{vertical-align:top}td.c img{display:block;width:' + 幅 + 'px;border:1px solid #999;background:#fff}' +
    'td.c .t{font-size:11px;color:#444;margin-top:2px}td.c.bad img{outline:4px solid #d22;outline-offset:-2px}td.c.bad .t{color:#c00;font-weight:700}' +
    'td.fx img{outline:3px dashed #36c;outline-offset:-2px}td.fx .t{color:#246}' +
    '.none{width:' + 幅 + 'px;height:' + Math.round(幅 * 9 / 16) + 'px;display:flex;align-items:center;justify-content:center;color:#aaa;border:1px dashed #bbb;font-size:12px}' +
    '</style>';
  const 悪い数 = recs.filter((r) => 悪い所((r.測り || {})[SIZE + 'x' + H]).length).length;
  html += '<h1>大画面：' + esc(シナリオ) + '</h1><div class="meta">' + SIZE + '×' + H + '・人数 ' + 人数.join('／') + '・場面 ' + 場面.length +
    '・✖ ' + 悪い数 + '（赤い枠）・青い点線の枠は「出ている最中」の演出（--fx）</div>';
  html += '<table><tr><th></th>' + 人数.map((n) => '<th>' + n + '人</th>').join('') + '</tr>';
  for (const 名 of 場面) {
    const 状態 = 名.slice(シナリオ.length + 1);
    html += '<tr><td class="l">' + esc(状態) + '</td>' + 人数.map((n) => {
      const r = 引く(名, n);
      const m = r && (r.測り || {})[SIZE + 'x' + H];
      if (!m) return '<td class="c"><div class="none">（この人数では無い）</div></td>';
      const 悪 = 悪い所(m);
      const src = 画像(m.画像);
      const 添え = [悪.length ? '✖ ' + 悪.join('・') : '', m.省略の数 ? '省略 ' + m.省略の数 : '', (r.落ち着き && r.落ち着き.落ち着いた === false) ? '落ち着く前' : '']
        .filter(Boolean).join('　');
      return '<td class="c' + (悪.length ? ' bad' : '') + '">' + (src ? '<img src="' + src + '">' : '<div class="none">画像なし</div>') +
        '<div class="t">' + esc(添え || '○') + '</div></td>';
    }).join('') + '</tr>';
    // --fx の演出（その場面で撮ったもの）
    const 演出 = {};
    人数.forEach((n) => { const r = 引く(名, n); Object.entries((r && r.演出の画像) || {}).forEach(([k, v]) => { (演出[k] = 演出[k] || {})[n] = v; }); });
    for (const [k, by] of Object.entries(演出)) {
      html += '<tr><td class="l">' + esc(状態) + '<span class="s">＋' + esc(k) + '（出ている最中）</span></td>' + 人数.map((n) => {
        const v = by[n];
        if (!v || !v.画像) return '<td class="c"><div class="none">—</div></td>';
        const src = 画像(v.画像);
        return '<td class="c fx">' + (src ? '<img src="' + src + '">' : '<div class="none">画像なし</div>') +
          '<div class="t">' + (v.出ていた ? '出ている最中' : '✖ 出ていない') + '</div></td>';
      }).join('') + '</tr>';
    }
  }
  html += '</table>';
  return html;
}

(async () => {
  const 記録 = JSON.parse(fs.readFileSync(path.join(DIR, '記録.json'), 'utf8'));
  fs.mkdirSync(OUT, { recursive: true });
  const 組 = {};
  記録.場面.forEach((r) => { (組[r.シナリオ] = 組[r.シナリオ] || []).push(r); });
  const b = await launch({ port: parseInt(arg('cdp', '9391'), 10) });
  const 出来た = [];
  try {
    const d = await b.newDevice('一覧', { width: 2200, height: 1000, mobile: false, deviceScaleFactor: 1 });
    let i = 0;
    for (const [シナリオ, recs] of Object.entries(組)) {
      i++;
      const html = path.join(OUT, String(i).padStart(2, '0') + '_' + シナリオ + '.html');
      fs.writeFileSync(html, sheetHtml(シナリオ, recs));
      await d.go('file:///' + html.replace(/\\/g, '/'));
      await d.until("Array.from(document.images).every(function(i){return i.complete;})", 30000, '画像の読み込み');
      await sleep(200);
      const size = await d.ev("({w:Math.ceil(document.body.scrollWidth), h:Math.ceil(document.body.scrollHeight)})");
      const jpg = html.replace(/\.html$/, '_' + SIZE + '.jpg');
      await d.shotFull(jpg, size);
      出来た.push(jpg);
      console.log('一覧：' + path.relative(process.cwd(), jpg) + '（' + size.w + '×' + size.h + '）');
    }
  } finally { await b.close(); }
  console.log(出来た.length + ' 枚');
})().catch((e) => { console.error(e); process.exit(1); });
