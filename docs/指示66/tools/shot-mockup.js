// 見本の画面を、1枚ずつ本物の大きさ（スマホ 390×844・TV 1920×1080）で撮る。
// 演出は「なし」（動きの最後の形）で撮る。
//
//   初回だけ: npm i -D playwright && npx playwright install chromium
//   撮る    : node tools/shot-mockup.js 見本 out/mockup
//   → out/mockup/<ページ>/<番号>_<画面のid>.png
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const dir = process.argv[2] || '見本';
const out = process.argv[3] || 'out/mockup';
const pages = ['festival.html', 'select.html', 'entry.html'];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  for (const f of pages) {
    await page.goto('file://' + path.resolve(dir, f));
    await page.waitForTimeout(1500);
    await page.click('[data-fxset="none"]');
    await page.evaluate(() => {
      document.documentElement.classList.add('native');
      document.querySelectorAll('.frame').forEach(DS.fit);
      document.querySelectorAll('.scr,.tv').forEach((s) => {
        s.classList.remove('play'); void s.offsetWidth; s.classList.add('play');
        s.dispatchEvent(new CustomEvent('ds:start', { detail: 'shot' }));
      });
    });
    await page.waitForTimeout(900);
    const od = path.join(out, f.replace('.html', ''));
    fs.mkdirSync(od, { recursive: true });
    const stages = await page.$$('.stage');
    let i = 0;
    for (const st of stages) {
      i++;
      await st.scrollIntoViewIfNeeded();
      const id = await st.evaluate((e) => e.firstElementChild.getAttribute('data-id') || 'x');
      await st.screenshot({ path: path.join(od, String(i).padStart(2, '0') + '_' + id + '.png') });
    }
    console.log(f, i, '枚');
  }
  await browser.close();
})();
