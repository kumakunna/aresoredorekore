#!/usr/bin/env node
// tools/v2-shot-check.js — tools/v2-shot.js を「テストの形」（✅／❌ と → の行）で回す（指示68-0b の変異のため）
//
//   node tools/v2-shot-check.js --only fes2-tv-lobby --fx skip
//
// 変異の道具（tools/mutate.js）は、スイートの出力の ❌ と → の行から「狙った理由で赤くなったか」を読む。
// 物差しそのもの（check.js の K1・K2）と、実ブラウザでしか測れない直し（B14 演出「なし」の名前・B15 待合の名前）は
// tests/ の jsdom では測れないので、この道具で v2-shot をそのまま回して、その形に直して出す。
//   ・物差しの自己検査で止まった（拾うべき物を拾えない）→ ❌ 物差しの自己検査 → 止まった理由
//   ・場面に指摘が出た → ❌ <場面> → 指摘の種類と字
// 引数は v2-shot.js にそのまま渡す（--out は一時の置き場に決める）。npm test には入らない（tests/ の外）

const path = require('path');
const os = require('os');
const cp = require('child_process');

const args = process.argv.slice(2);
const out = path.join(os.tmpdir(), 'v2-shot-check-' + process.pid);
const r = cp.spawnSync(process.execPath, [path.join(__dirname, 'v2-shot.js')].concat(args, ['--out', out]), { encoding: 'utf8' });
const text = String(r.stdout || '') + String(r.stderr || '');
let 赤 = 0;
text.split(/\r?\n/).forEach((行) => {
  const m = /^(?:\[[^\]]+\] )?(✔|✖) (\S+)\s+check\.js (\d+) 件(?:：(.*))?$/.exec(行.trim());
  if (!m) return;
  if (m[1] === '✔') console.log('✅ ' + m[2]);
  else { 赤++; console.log('❌ ' + m[2]); console.log('     → ' + (m[4] || '')); }
});
if (r.status === 2 || /物差しが効いていません|新しい物差し .* を/.test(text)) {
  赤++;
  console.log('❌ 物差しの自己検査');
  console.log('     → ' + ((/(物差しが効いていません[^\n]*|新しい物差し [^\n]*)/.exec(text) || [])[1] || text.split(/\r?\n/).filter(Boolean).slice(-3).join(' / ')).slice(0, 300));
}
console.log(赤 ? '赤 ' + 赤 + ' 件' : '緑');
process.exit(赤 ? 1 : 0);
