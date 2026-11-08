#!/usr/bin/env node
// tools/v2-pair-shot.js — 直す前と後を、同じ見本データの場面で撮る（指示76 の「前と後の写真」）
//
//   git worktree add ../aresore-before <直す前のコミット>      … 直す前を別の作業ツリーに出しておく（終わったら git worktree remove）
//   node tools/v2-pair-shot.js --base ../aresore-before --scenes qh-tv-open,onaji-tv-unveil16 --out DIR
//   --size tv|390x844（既定：場面の kind で TV 1920×1080 かスマホ 390×844）  --port 3985（と +1）  --cdp 9685
//
// 見本データ（tools/v2-lab の場面）は、どちらもこのリポジトリの物を使う（部屋の進行役は同じ・画面の public/ だけを入れかえる）。
// 写真は DIR/<場面>_before.png と _after.png。並べる時は 検査_1107_道具/sheet.ps1（git の外）か、そのまま開く
const path = require('path');
const { launch, sleep } = require('./cdp');
const { 配り手, 開く } = require('./v2-lab/open');
const { SCENES } = require('./v2-lab/scenes');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : argv[i + 1]; };
const BASE = arg('base', null);
if (!BASE) { console.error('--base（直す前の作業ツリー）が要ります'); process.exit(2); }
const LIST = String(arg('scenes', '')).split(',').map((s) => s.trim()).filter(Boolean);
const OUT = path.resolve(arg('out', path.join(__dirname, '..', 'docs', '検査_1107', '写真', 'pair')));
const PORT = +arg('port', 3985), CDP = +arg('cdp', 9685), SIZE = arg('size', null), FREEZE = +arg('freeze', 20);

function 大きさ(sc) {
  const s = SIZE || (sc.kind === 'tv' ? 'tv' : '390x844');
  if (s === 'tv') return { width: 1920, height: 1080, mobile: false, deviceScaleFactor: 1 };
  const m = /^(\d+)x(\d+)$/.exec(s);
  return { width: +m[1], height: +m[2], mobile: true, deviceScaleFactor: 2 };
}
// 動きは止めて、終わりの形で撮る（両方に同じことをする）
const 止める = "(function(){ document.getAnimations().forEach(function(a){ try{ a.finish(); }catch(e){ a.pause(); } }); return 1; })()";

(async () => {
  const before = await 配り手(PORT, path.join(path.resolve(BASE), 'public'));
  const after = await 配り手(PORT + 1);
  const b = await launch({ port: CDP });
  try {
    for (const id of LIST) {
      const sc = SCENES.find((s) => s.id === id);
      if (!sc) { console.log('✖ 場面が無い：' + id); continue; }
      for (const [tag, port] of [['before', PORT], ['after', PORT + 1]]) {
        const dev = await b.newDevice(id + tag, 大きさ(sc));
        await 開く(dev, port, sc, { freeze: FREEZE });
        await dev.ev(止める);
        await sleep(300);
        await dev.shot(path.join(OUT, id + '_' + tag + '.png'));
        await dev.close();
      }
      console.log('✔ ' + id);
    }
  } finally { await b.close(); before.close(); after.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
