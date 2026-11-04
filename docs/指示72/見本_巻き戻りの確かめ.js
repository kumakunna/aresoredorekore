// 配置づくり：直した所が勝手にもどらないかの確かめ（本物のサーバーで動かす見本）
// 使い方：BASE=http://localhost:（ポート） HAICHI_KEY=（合い言葉） node 見本_巻き戻りの確かめ.js
//   ・合い言葉は env だけで渡す。このファイル・ログ・報告には書かない（この見本も、合い言葉を表示しない）
//   ・確かめ用の案を1つ作って、終わったら消す（ほかの案にはさわらない）
//   ・(b) は Claude チャットの見本サーバーだけにある道（/__slowget）を使う。無ければ自動で飛ばす
const {chromium} = require('playwright');
const BASE = process.env.BASE, KEY = process.env.HAICHI_KEY;
if (!BASE || !KEY) { console.log('BASE と HAICHI_KEY を env で渡してください'); process.exit(2); }
const Q = 'key=' + encodeURIComponent(KEY), H = {'content-type': 'application/json', 'x-haichi-v': '2'};
const sleep = ms => new Promise(r => setTimeout(r, ms));
// いまの並び（くまくんの図）と同じ19台
const T = [['d1','long',100,148,3],['d2','long',100,293,3],['d3','long',100,438,3],['d4','long',100,583,3],['d5','long',100,728,3],['d6','long',344,148,3],['d7','long',344,293,3],['d8','long',344,438,3],['d9','long',344,583,3],['d10','long',344,728,3],['d11','long',582,148,3],['d12','long',582,293,3],['d13','long',582,438,3],['d14','long',582,583,2],['d15','short',796,148,3],['d16','long',826,293,4],['d17','long',826,438,4],['d18','long',826,583,3],['d19','small',896.5,227.5,0]];
const fresh = name => ({name, order: 900, updated: Date.now(), memo: '', lock: false, desks: T.map(([id, kind, cx, cy, ch]) => ({id, kind, cx, cy, rot: kind === 'small' ? 90 : 0, chairs: ch, side: 'front', tags: [], unused: false})), items: [], tv: {tv1: [], tv2: []}, strokes: []});
const PID = 'zz-check-' + Date.now().toString(36);
const put = (id, data) => fetch(`${BASE}/api/haichi/plans/${id}?${Q}`, {method: 'PUT', headers: H, body: JSON.stringify({data})});
const del = id => fetch(`${BASE}/api/haichi/plans/${id}?${Q}`, {method: 'DELETE', headers: H});
const server = async () => { const j = await (await fetch(`${BASE}/api/haichi/plans?${Q}&since=-1`)).json(); return (j.plans.find(p => p.id === PID) || {}).data; };
const desk = (plan, id) => plan.desks.find(d => d.id === id);
(async () => {
  const r0 = await put(PID, fresh('確かめ用（消してよい）'));
  if (!r0.ok) { console.log('確かめ用の案を作れません', r0.status); process.exit(1); }
  const hasSlow = (await fetch(BASE + '/__slowget?ms=0').catch(() => ({ok: false}))).ok;
  const b = await chromium.launch(); const errs = []; const res = [];
  const check = (name, cond, extra) => { res.push(cond); console.log((cond ? 'OK  ' : 'NG  ') + name + (extra != null ? '  ' + extra : '')); };
  const open = async () => { const c = await b.newContext({viewport: {width: 1440, height: 900}}); const p = await c.newPage(); p.on('pageerror', e => errs.push(e.message)); await p.goto(`${BASE}/haichi?${Q}`); await p.waitForTimeout(3500); await p.click(`.tab[data-plan="${PID}"]`); await p.waitForTimeout(200); await p.click('#fitRoom'); await p.waitForTimeout(200); return p; };
  const tr = (p, id) => p.getAttribute(`g.desk[data-id="${id}"]`, 'transform');
  const drag = async (p, id, dx, dy, ms = 400) => { const bb = await p.locator(`g.desk[data-id="${id}"] > rect`).boundingBox(); const x = bb.x + 8, y = bb.y + bb.height / 2, n = Math.max(4, Math.round(ms / 50)); await p.mouse.move(x, y); await p.mouse.down(); for (let i = 1; i <= n; i++) { await p.mouse.move(x + dx * i / n, y + dy * i / n); await p.waitForTimeout(ms / n); } await p.mouse.up(); await p.waitForTimeout(100); };
  try {
    const A = await open();
    // (a) 1つ動かして、すぐ次の机を、ゆっくり（4秒）動かす → 動かしている間に保存先の答えが来ても、もどらない
    await drag(A, 'd3', 60, 0); await sleep(1200);
    const t0 = await tr(A, 'd8'); await drag(A, 'd8', 60, 0, 4000); const t1 = await tr(A, 'd8'); await sleep(5000); const t2 = await tr(A, 'd8');
    let s = await server();
    check('(a) 続けて動かした机が、手元でもどらない', t2 === t1 && t1 !== t0, `${t0} → ${t1} → ${t2}`);
    check('(a) 保存先にも、動かした場所', desk(s, 'd8').cx !== 344 && desk(s, 'd3').cx !== 100, `d3.cx=${desk(s, 'd3').cx} d8.cx=${desk(s, 'd8').cx}`);
    if (hasSlow) {
      // (b) 保存先の答えが 1.5 秒おくれる（中身は聞いた時の古い物）→ 手元が一度でももどらないか
      await fetch(BASE + '/__slowget?ms=1500'); let flick = 0;
      for (const id of ['d1', 'd2', 'd6']) { await drag(A, id, 50, 0, 300); const t = await tr(A, id); for (let i = 0; i < 45; i++) { await sleep(100); if ((await tr(A, id)) !== t) { flick++; break; } } }
      await fetch(BASE + '/__slowget?ms=0'); await sleep(4000);
      check('(b) 古い答えがおくれて届いても、手元がもどらない', flick === 0, `もどった ${flick}/3`);
    } else console.log('--  (b) は見本サーバーだけ（飛ばした）');
    const B = await open();
    // (c) 2人が同じ案の、別の机を、同じ時に動かす → 両方残る
    s = await server(); const c4 = desk(s, 'd4').cx, c9 = desk(s, 'd9').cx;
    await Promise.all([drag(A, 'd4', 60, 0, 300), drag(B, 'd9', 60, 0, 300)]); await sleep(7000);
    s = await server();
    check('(c) 保存先に、2人の直しが両方ある', desk(s, 'd4').cx !== c4 && desk(s, 'd9').cx !== c9, `d4 ${c4}→${desk(s, 'd4').cx} / d9 ${c9}→${desk(s, 'd9').cx}`);
    check('(c) 2人の画面が同じ', (await tr(A, 'd4')) === (await tr(B, 'd4')) && (await tr(A, 'd9')) === (await tr(B, 'd9')));
    // (d) A がメモを書き、B が同じ案で机を動かす（ほぼ同時）→ 両方残る
    const c10 = desk(s, 'd10').cx;
    await Promise.all([(async () => { await A.click('#memo'); await A.keyboard.type('Aのメモ', {delay: 60}); await A.click('#status'); })(), drag(B, 'd10', 60, 0, 300)]); await sleep(7000);
    s = await server();
    check('(d) メモと机の両方が残る', /Aのメモ/.test(s.memo) && desk(s, 'd10').cx !== c10, `memo=${JSON.stringify(s.memo)} d10 ${c10}→${desk(s, 'd10').cx}`);
    check('(d) B の画面にもメモ', /Aのメモ/.test(await B.$eval('#memo', e => e.value)));
  } finally {
    await del(PID); await b.close();
  }
  console.log('errs', errs); console.log(res.every(Boolean) && !errs.length ? 'ALL OK' : 'SOME NG');
  process.exit(res.every(Boolean) && !errs.length ? 0 : 1);
})();
