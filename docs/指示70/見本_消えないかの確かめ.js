const {chromium} = require('playwright');
const API = 'http://localhost:3999/api/haichi/plans?key=testkey&since=-1';
const serverPlans = async () => { const r = await fetch(API); const j = await r.json(); return Object.fromEntries(j.plans.map(p => [p.id, p.data])); };
const down = (ms) => fetch('http://localhost:3999/__down?ms=' + ms);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch(); const errs = []; let ok = true;
  const check = (name, cond, extra) => { console.log((cond ? 'OK  ' : 'NG  ') + name + (extra ? '  ' + extra : '')); if (!cond) ok = false; };
  const open = async () => { const c = await b.newContext({viewport: {width: 1366, height: 820}}); const p = await c.newPage(); p.on('pageerror', e => errs.push(e.message)); await p.goto('http://localhost:3999/haichi?key=testkey'); await p.waitForTimeout(3500); return {c, p}; };
  const curId = (p) => p.$$eval('.tab[data-plan]', es => { const t = es.find(e => e.getAttribute('aria-selected') === 'true' || e.classList.contains('on') || e.classList.contains('cur') || e.classList.contains('active')); return t ? t.dataset.plan : null; });
  const pick = async (p, id) => { await p.click('.tab[data-plan="' + id + '"]'); await p.waitForTimeout(200); };
  const setMemo = async (p, text) => { await p.fill('#memo', text); await p.click('#status'); await p.waitForTimeout(100); };
  const status = (p) => p.$eval('#status', e => e.textContent);

  const A = await open(), B = await open();
  const ids = Object.keys(await serverPlans());
  check('12の案が入った', ids.length === 12, String(ids.length));
  const [p1, p2] = ['p-now', 'p-claude2'];
  // 1) ふつうに直す → もう片方に届く
  await pick(A.p, p1); await setMemo(A.p, 'A1'); await sleep(4500);
  check('ふつうの直しが届く', (await serverPlans())[p1].memo === 'A1');
  // 2) サーバーが20秒止まっている間に直す → もどったら届く。ほかの人の直しで消えない
  await down(20000); await sleep(500);
  await setMemo(A.p, 'A2-止まっている間'); await sleep(12000);
  check('止まっている間の表示', /つながりません/.test(await status(A.p)), await status(A.p));
  await sleep(9000);   // サーバーがもどる
  await pick(B.p, p2); await setMemo(B.p, 'B-もどったあと'); await sleep(8000);
  let sp = await serverPlans();
  check('止まっていた間の直しが、もどったあと届く', sp[p1].memo === 'A2-止まっている間', sp[p1].memo);
  check('A の画面からも消えていない', (await A.p.$eval('#memo', e => e.value)) === 'A2-止まっている間');
  check('A の表示が「保存しました」にもどる', /保存しました/.test(await status(A.p)), await status(A.p));
  // 3) 止まっている間に直して、ページを開き直す → もどったら届く
  await down(15000); await sleep(500);
  await setMemo(A.p, 'A3-開き直す前'); await sleep(1500);
  await A.p.reload(); await A.p.waitForTimeout(2000);
  await sleep(16000);
  sp = await serverPlans();
  check('開き直しても、止まっていた間の直しが届く', sp[p1].memo === 'A3-開き直す前', sp[p1].memo);
  // 4) A だけネットが切れている間に、B があとから同じ案を直す → B の形が残る（新しく直した方が残る）
  await A.c.setOffline(true);
  await setMemo(A.p, 'A4-ネットが切れた間'); await sleep(1500);
  await pick(B.p, p1); await sleep(300); await setMemo(B.p, 'B4-あとから直した'); await sleep(4000);
  await A.c.setOffline(false); await sleep(20000);
  sp = await serverPlans();
  check('あとから直した B の形が残る', sp[p1].memo === 'B4-あとから直した', sp[p1].memo);
  check('A の画面も B の形になる', (await A.p.$eval('#memo', e => e.value)) === 'B4-あとから直した');
  // 5) A がネットが切れている間に直し、B はさわらない → A の形が届く
  await A.c.setOffline(true); await setMemo(A.p, 'A5-切れた間だけ'); await sleep(2000); await A.c.setOffline(false); await sleep(18000);
  sp = await serverPlans();
  check('切れた間だけの直しが届く', sp[p1].memo === 'A5-切れた間だけ', sp[p1].memo);
  console.log('errs', errs); console.log(ok ? 'ALL OK' : 'SOME NG');
  await b.close();
})();
