// tests/v2-layers.js — v2 の重なりの順（指示75 2-4・11/7 の検査 A35）
//
// 縦の「ATSUMARE AREKORE.」（.v2-brand）が z-index 36 で、暗い幕（.v2-scrim 29）とシート（.v2-sheet 30）・
// 確かめの枠（.v2-dlg 41 の手前）より上にあり、シートを開くと、シートの字の上に縦の字が乗っていた
//（アイコン・二つ名・⚙・感想・ひとこと・係の画面の全部のシート）。飾りは、上に開く物（幕・シート・枠）より下に置く。
// jsdom は z-index の重なりを描かないので、CSS そのものを読む（落とし穴47：測っていない物は 0 に見える）
'use strict';

const fs = require('fs');
const path = require('path');
const { createRunner, assert } = require('./harness');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const css = Array.from(html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)).map((m) => m[1]).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');

/** その選択子だけの規則（ほかの選択子とまとめていない物）の z-index。無ければ null */
function zOf(sel) {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp('(?:^|[}\\s])' + esc + '\\{([^}]*)\\}').exec(css);
  if (!m) return null;
  const z = /z-index:\s*(-?\d+)/.exec(m[1]);
  return z ? +z[1] : null;
}

(async function main() {
  const r = createRunner('v2-layers：v2 の重なりの順（指示75 2-4）');

  await r.test('縦の字（.v2-brand）は、暗い幕・シート・確かめの枠より下', async () => {
    const brand = zOf('.v2 .v2-brand'), scrim = zOf('.v2 .v2-scrim'), sheet = zOf('.v2 .v2-sheet'), dlg = zOf('.v2 .v2-dlg');
    assert([brand, scrim, sheet, dlg].every((z) => typeof z === 'number'), '4つとも z-index を読めた（' + [brand, scrim, sheet, dlg].join('・') + '）');
    assert(brand < scrim && brand < sheet && brand < dlg, '縦の字 ' + brand + ' ＜ 幕 ' + scrim + '・シート ' + sheet + '・枠 ' + dlg);
  });

  await r.test('縦の字は、帯・知らせ・感想のカードより上（ふだんは見える）', async () => {
    const brand = zOf('.v2 .v2-brand');
    ['.v2 .v2-band', '.v2 .v2-toast', '.v2 .v2-pop'].forEach((s) => {
      const z = zOf(s);
      assert(typeof z === 'number' && brand > z, '縦の字 ' + brand + ' ＞ ' + s + ' ' + z);
    });
  });

  r.finish();
})();
