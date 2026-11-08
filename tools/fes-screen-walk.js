#!/usr/bin/env node
// tools/fes-screen-walk.js — 文化祭の本物の流れで、全部のゲームの全部の画面を、4つのスマホの大きさと TV で撮って測る（11/7 の検査の準備 4）
// 投票の候補は毎回3つだけなので、まだ遊んでいないゲームが候補に出た回にそれへ入れ、全部のゲームを遊ぶまで回る（--min で打ち切り）
//
//   node tools/fes-screen-walk.js                           … 文化祭で入にできるゲームを全部1回ずつ（棚から下ろした物は入にできないので外す）
//   node tools/fes-screen-walk.js --games bomb-coop,shinka   … このゲームだけ
//   --sizes 360x740,390x844,412x915,820x1180  --tv 1920x1080  --bots 2  --port 3421  --cdp 9721  --min 45
//   --vision deuteranopia（protanopia・tritanopia・achromatopsia・blurredVision）… 全部の端末の色の見え方を変えて撮る（5：色だけで分けていないか）
//   --out DIR（既定 docs/検査_1107/写真/walk・git に入れない）
//
// 手元の検証用サーバーだけ（本番にはつながない）。係（/dev-login）が部屋を作り、回すゲームだけ入にする（終わったら元にもどす）。
// スマホは本物のページ（Chrome・tools/cdp.js・音なし）。中に tools/fes-agent.js の「遊ぶ人」を入れて、名前を入れて入る・投票・準備OK・遊ぶ・つづける。
// 人数の足りない分は tools/fes-bots.js（Node だけのプレイヤー）が入って、同じゲームに投票する。
// 画面（.screen.active の id）か段（投票・決定・準備OK・遊ぶ・結果）が変わるたびに、1.5秒待ってから撮って、
// tools/screen-measure.js（はみ出し・字が切れている・重なり・小さい字・ボタンの大きさ・コントラスト）で測る。同じゲーム×画面×段は端末ごとに1回。
// 測る前に、物差しの自己検査（わざと悪い物を足して言うか）。言わない物差しがあれば止める（落とし穴10-f）。
// 記録：記録.json（端末×ゲーム×画面×段 ごとの issues）と 一覧.md（種類ごとの数と、どの画面・どの大きさか）。

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const io = require('socket.io-client');
const { launch, sleep } = require('./cdp');
const { AGENT } = require('./fes-agent');
const { MEASURE, SELFTEST } = require('./screen-measure');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const PORT = +arg('port', 3421), CDP = +arg('cdp', 9721), MIN = +arg('min', 45), BOTS = +arg('bots', 2);
const GAMES = String(arg('games', 'bomb-coop,onaji-many,pittari,soroe,qhaya,qnear,shinka,rcard')).split(',');
const SIZES = String(arg('sizes', '360x740,390x844,412x915,820x1180')).split(',').map((s) => { const m = /^(\d+)x(\d+)$/.exec(s); return { w: +m[1], h: +m[2] }; });
const TVS = /^(\d+)x(\d+)$/.exec(String(arg('tv', '1920x1080')));
const OUT = path.resolve(arg('out', path.join(ROOT, 'docs', '検査_1107', '写真', 'walk')));
const BASE = 'http://localhost:' + PORT;
const VISION = arg('vision', null);
const NAMES = ['あき', 'いお', 'うた', 'えま', 'おと', 'かい'];
const t0 = Date.now();
const 分 = () => ((Date.now() - t0) / 60000).toFixed(1);
const log = (...a) => console.log(String(分()).padStart(5) + '分 ' + a.join(' '));

function サーバー() {
  const out = fs.openSync(path.join(OUT, 'server.log'), 'w');
  return spawn(process.execPath, [path.join(ROOT, 'tools', 'dev-server.js')], { cwd: ROOT, env: Object.assign({}, process.env, { PORT: String(PORT), PROBE: '' }), stdio: ['ignore', out, out] });
}
async function 係() {
  const r = await fetch(BASE + '/dev-login', { redirect: 'manual' });
  const cookie = (r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')]).map((c) => String(c).split(';')[0]).join('; ');
  const s = io(BASE, { extraHeaders: { cookie }, transports: ['websocket'] });
  await new Promise((ok) => s.once('connect', ok));
  const call = (ev, p) => new Promise((ok) => s.timeout(8000).emit(ev, p || {}, (err, res) => ok(err ? { ok: false, error: 'timeout' } : res)));
  return { s, call };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = サーバー();
  let up = false;
  for (let i = 0; i < 80 && !up; i++) { await sleep(250); try { up = (await fetch(BASE + '/')).ok; } catch (e) {} }
  if (!up) throw new Error('サーバーが立ちません');
  const staff = await 係();
  const c = await staff.call('fes:create', { recreate: false });
  if (!c || !c.ok) throw new Error('部屋を作れません ' + JSON.stringify(c));
  const code = c.code;
  const sw0 = ((await staff.call('fes:watch', { code })).staff || {}).games || [];
  const もと = sw0.map((g) => ({ mode: g.mode, on: !!g.on }));
  for (const g of sw0) if (GAMES.includes(g.mode) && !g.on) await staff.call('fes:game', { code, mode: g.mode, on: true });
  for (const g of sw0) if (!GAMES.includes(g.mode) && g.on) await staff.call('fes:game', { code, mode: g.mode, on: false });
  // 棚から下ろしたゲーム（進化じゃんけん・ロシアンカードなど）は、係の入／切に出ず、候補にもならない。入にできた物だけを回す
  const 入 = (((await staff.call('fes:watch', { code })).staff || {}).games || []).filter((g) => g.on).map((g) => g.mode);
  const 外した = GAMES.filter((g) => !入.includes(g));
  GAMES.splice(0, GAMES.length, ...GAMES.filter((g) => 入.includes(g)));
  log('部屋', code, '入：', GAMES.join(','), 外した.length ? '（入にできない＝棚から下ろした：' + 外した.join(',') + '）' : '');

  const b = await launch({ port: CDP });
  const 記録 = { いつ: new Date().toISOString(), 見え方: VISION || 'ふつう', 入にできない: 外した, 大きさ: SIZES.map((s) => s.w + 'x' + s.h), tv: TVS[0], ゲーム: GAMES, 撮った: [], 回: [], 例外: [], 自己検査: null };
  let bots = null;
  const 終わる = async (why) => {
    記録.終わり方 = why;
    try { if (bots) bots.kill('SIGINT'); } catch (e) {}
    try { for (const g of もと) await staff.call('fes:game', { code, mode: g.mode, on: g.on }); } catch (e) {}
    fs.writeFileSync(path.join(OUT, '記録.json'), JSON.stringify(記録, null, 1));
    fs.writeFileSync(path.join(OUT, '一覧.md'), 一覧(記録));
    try { await b.close(); } catch (e) {}
    srv.kill();
    log('終わり：' + why + '・撮った ' + 記録.撮った.length + ' 枚 → ' + path.relative(ROOT, OUT));
    process.exit(0);
  };
  try {
    const devs = [];
    const tv = await b.newDevice('TV', { width: +TVS[1], height: +TVS[2] });
    tv.tag = 'tv' + TVS[0]; tv.isTv = true; devs.push(tv);
    const 見え方 = async (d) => { if (VISION) await d.cdp('Emulation.setEmulatedVisionDeficiency', { type: String(VISION) }); };
    await 見え方(tv);
    await tv.go(BASE + '/'); await tv.ev("(localStorage.setItem('acac-app-prefs', JSON.stringify({fxSpeed:'normal'})), 1)"); await tv.go(BASE + '/fes?tv=1');
    // 物差しの自己検査（TV ではなくスマホの1台目で）
    for (let i = 0; i < SIZES.length; i++) {
      const s = SIZES[i];
      const d = await b.newDevice('スマホ' + s.w, { width: s.w, height: s.h, mobile: true, deviceScaleFactor: 2 });
      d.tag = s.w + 'x' + s.h; devs.push(d);
      await 見え方(d);
      await d.go(BASE + '/'); await d.ev("(localStorage.setItem('acac-app-prefs', JSON.stringify({fxSpeed:'normal'})), 1)"); await d.go(BASE + '/fes');
      if (i === 0) {
        const miss = await d.ev('(' + SELFTEST.toString() + ')(' + JSON.stringify(MEASURE.toString()) + ')');
        記録.自己検査 = miss;
        if (miss.length) throw new Error('物差しが言わない：' + miss.join('・'));
        log('物差しの自己検査 ○（わざと足した物を全部言った）');
      }
      d.cfg = { name: NAMES[i], diff: i % 2 ? 'easy' : 'normal', round: 0, target: null };
    }
    const 入れる = async (d) => d.ev('(function(){(' + AGENT.toString() + ')();window.__soak.cfg=' + JSON.stringify(d.isTv ? { tv: true } : d.cfg) + ';return 1;})()').catch(() => 0);
    for (const d of devs) await 入れる(d);
    // 人数の足りない分：Node のプレイヤー（同じ順に投票する）
    if (BOTS > 0) {
      bots = spawn(process.execPath, [path.join(ROOT, 'tools', 'fes-bots.js'), '--url', BASE, '--n', String(BOTS), '--vote', GAMES.join(','), '--min', String(MIN), '--quiet', '--name', 'ボット',
        '--out', path.join(OUT, 'bots')], { cwd: ROOT, stdio: 'ignore' });
    }
    const 済み = new Set();
    let round = 0, 前の段 = null, 遊んだ = null, 票の回 = null;
    const 締め = Date.now() + MIN * 60000;
    let 連番 = 0;
    while (Date.now() < 締め) {
      // サーバーの段（係の目）
      const w = await staff.call('fes:watch', { code });
      const f = (w && w.staff && w.staff.fes) || {};
      if (f.phase === 'play' && f.played && 遊んだ !== f.round) { 遊んだ = f.round; 記録.回.push({ round: f.round, mode: f.played.mode, 人: f.played.ids.length, 分: +分() }); log('遊ぶ', f.played.mode, f.played.ids.length + '人'); }
      const 遊んだ物 = new Set(記録.回.map((x) => x.mode));
      if (前の段 === 'result' && f.phase !== 'result') {
        round++;
        if (GAMES.every((g) => 遊んだ物.has(g))) { await sleep(4000); break; }
      }
      // 投票：候補は毎回3つだけ。まだ遊んでいないゲームが候補にあれば、全部のスマホがそれに入れる
      if (f.phase === 'vote' && 票の回 !== f.round) {
        票の回 = f.round;
        const want = GAMES.find((g) => (f.candidates || []).includes(g) && !遊んだ物.has(g)) || null;
        for (const d of devs) if (!d.isTv) { d.cfg.round = f.round; d.cfg.target = want; await d.ev('window.__soak&&(window.__soak.cfg=' + JSON.stringify(d.cfg) + ')').catch(() => 0); }
        log('投票', (f.candidates || []).join(','), '→', want || '（まだの物が無い・ばらばら）');
      }
      前の段 = f.phase;
      const mode = (f.played && f.played.mode) || GAMES[round] || '-';
      for (const d of devs) {
        let rep = await d.ev('window.__soak ? window.__soak.report() : null').catch(() => null);
        if (!rep) { await 入れる(d); continue; }
        (rep.errs || []).forEach((e) => 記録.例外.push({ dev: d.tag, e }));
        const key = d.tag + '|' + mode + '|' + rep.scr + '|' + rep.stage;
        if (済み.has(key) || !rep.scr) continue;
        済み.add(key);
        await sleep(1500);   // 出る動きが終わってから
        const now = await d.ev('window.__soak.report()').catch(() => null);
        if (!now || now.scr !== rep.scr) { 済み.delete(key); continue; }
        const file = String(++連番).padStart(3, '0') + '_' + d.tag + '_' + mode + '_' + now.scr.replace(/^scr-/, '') + '_' + now.stage + '.jpg';
        await d.shot(path.join(OUT, file)).catch(() => 0);
        const m = await d.ev('(' + MEASURE.toString() + ')(' + JSON.stringify({ tv: !!d.isTv }) + ')').catch((e) => ({ n: 0, issues: [{ kind: '測れない', text: String(e.message).slice(0, 80) }] }));
        記録.撮った.push({ file, dev: d.tag, tv: !!d.isTv, mode, scr: now.scr, stage: now.stage, n: m.n, issues: m.issues, txt: m.txt || '' });
        if (m.issues.length) log(d.tag, mode, now.scr, now.stage, m.issues.length + '件');
      }
      await sleep(700);
    }
    const 済 = new Set(記録.回.map((x) => x.mode));
    await 終わる(GAMES.every((g) => 済.has(g)) ? '全部のゲームを回した（' + round + '回）' : MIN + '分たった（' + GAMES.filter((g) => 済.has(g)).length + '/' + GAMES.length + '本）');
  } catch (e) { 記録.失敗 = String(e && e.stack || e); console.error(e); await 終わる('失敗'); }
})().catch((e) => { console.error(e); process.exit(1); });

/** 種類ごとの数と、どこで出たか（同じ字・同じ要素は1行にまとめる） */
function 一覧(r) {
  const by = new Map();
  r.撮った.forEach((s) => s.issues.forEach((x) => {
    const k = x.kind + '|' + (x.el || '') + '|' + (x.text || '');
    const y = by.get(k) || { kind: x.kind, el: x.el, text: x.text, where: new Set(), devs: new Set(), ex: x, file: s.file };
    y.where.add(s.mode + ' ' + s.scr.replace(/^scr-/, '') + ' ' + s.stage); y.devs.add(s.dev); by.set(k, y);
  }));
  const kinds = new Map();
  by.forEach((y) => { (kinds.get(y.kind) || kinds.set(y.kind, []).get(y.kind)).push(y); });
  let md = '# 画面監査：本物の流れ（tools/fes-screen-walk.js）\n\n';
  md += `いつ：${r.いつ}・大きさ：${r.大きさ.join('・')}・TV ${r.tv}・ゲーム：${r.ゲーム.join('・')}・撮った ${r.撮った.length} 枚・終わり方：${r.終わり方}\n\n`;
  md += `回ったゲーム：${r.回.map((x) => x.mode + '(' + x.人 + '人)').join('・') || 'なし'}　画面の例外：${r.例外.length} 件\n\n`;
  md += '| 種類 | 何か所（まとめた数） |\n|---|---|\n';
  Array.from(kinds.keys()).sort().forEach((k) => { md += `| ${k} | ${kinds.get(k).length} |\n`; });
  Array.from(kinds.keys()).sort().forEach((k) => {
    md += `\n## ${k}\n\n| 字 | 要素 | どの画面（ゲーム 画面 段） | 大きさ | 数 | 写真の例 |\n|---|---|---|---|---|---|\n`;
    kinds.get(k).sort((a, b) => b.devs.size - a.devs.size).slice(0, 60).forEach((y) => {
      const ex = y.ex, num = ex.px != null ? ex.px + 'px' : ex.ratio != null ? ex.ratio + ':1' : ex.w != null ? ex.w + '×' + ex.h : ex.sw != null ? ex.sw + '>' + ex.cw : '';
      md += `| ${String(y.text || '').replace(/\|/g, '｜')} | \`${y.el}\` | ${Array.from(y.where).slice(0, 4).join('<br>')} | ${Array.from(y.devs).join('・')} | ${num} | ${y.file} |\n`;
    });
    if (kinds.get(k).length > 60) md += `\n（ほか ${kinds.get(k).length - 60} か所は 記録.json）\n`;
  });
  return md;
}
