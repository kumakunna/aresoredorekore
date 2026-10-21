#!/usr/bin/env node
// tools/big-census.js — 大画面（TV）を、人数を変えて最後まで通しながら撮って測る（指示64 着手前の確かめ1）
//
//   node tools/big-census.js bakudan --players 16 --port 3901 --cdp 9601
//   node tools/big-census.js quizou --players 8 --per 5     # 同じ形の測り直しを 5 回まで（既定 3）
//
// 通し方は tools/flow-walk.js の台本（tools/flow-walk/<id>.js）をそのまま使い、bot の数だけ増やす
//（人数＝進行役＋参加者＋bot。4人＝bot 2、8人＝bot 6、16人＝bot 14）。
//
// **いつ測るか（鍵）**：大画面の「形」が初めて出た時に測る。形は tools/big-measure.js の 形の式 で、
//   画面id・data-big（待合A／待合B／遊ぶ）・data-phase（部屋の段階）・data-game・data-size（人数の段）・
//   段階の札（#bigPhase）の字・名簿の数・順位表の形（data-shape/pod/cols/note/main）・出ている板
//   （QR・ルール・盤・すごろくの盤・市場・ケース・順位表・名簿）・一枚看板の種類（協力版の盤／対戦／字の長さの段）・
//   添え書きの長さの段・入場の知らせがあるか・手番の札があるか。
//   **版組みは読まない**（getBoundingClientRect を呼ばない）。窓の大きさで変わるもの（列の数・表彰台の注記の置き方・
//   一枚看板が添え書きへ移ったか）も入れない——入れると 1920 で測って戻した時に、同じ状態を測り直す。
//   前の鍵（画面|class|段階|主役|名簿の数）は、クイズの遊ぶ間と決着が同じ鍵になって結果を一度も測らず、
//   待合A と B も同じ鍵、協力版の爆弾は主役が刻むたびに鍵が変わって同じ形を何十回も測っていた（指示64）。
// **同じ形の測り直し**：細部（一枚看板の字の先頭40字・準備OKの数）が変わったら、--per 回まで測り直す。
//   上限で飛ばした数は 記録.json の 形ごと[…].飛ばした と 飛ばした合計 に残す（0 に見せない・落とし穴47）。
// 名簿・順位表の測り直し（bigReflowSoon）の途中は見回らない。測る直前にも形を読み直し、**測ったものの形**を
//   記録の 形 に残す（見回りから測るまで 350ms 以上あり、その間に次の状態へ進むことがある）。
//   1920 で読んだ形が違えば 形1920 にも残す。上限は、測った形の方に数える。
//
// 測るもの（**1280×720 と 1920×1080 の両方**。式は tools/big-measure.js の 測る）：
//   巻き … ページが縦に巻けるか（scrollHeight と clientHeight。落とし穴28：同じ物差しで比べる）
//           ／中の箱が縦に巻けるか（overflow auto/scroll で scrollHeight > clientHeight）
//   切れ … 見えている文字・ボタン・行のうち、画面の外へ出ている／先祖の overflow:hidden で切られているもの
//   字   … 見えている文字のうち、正本§11-5 の下限（1280×720 で本文28px。1920×1080 は 1.5倍の 42px）より小さいもの
//   目立つ … 大画面でいちばん大きいボタン（面積）と、その文字
//
// **頼んだ人数で本当に回ったか**を最後に確かめる（人狼の 8人・16人が、黙って全部4人だった・指示64）：
//   待合で見えた名簿の最大（待合で見えた人数）が人数と違う・bot数＋2 が人数と違う・bot が名簿に載りきらなかった・
//   大画面を使う台本なのに大画面の状態を1つも測っていない——どれかなら ✖ を出して 1 で終わる。
// 見回りの読み取りの失敗は黙って飛ばさず、数と最初の1件を 記録.json に残す（落とし穴10-e）。
// 出力：docs/監査_大画面の画像/<id>_<人数>/（画像と 記録.json。git に入れない）

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { makeWalk } = require('./flow-walk');
const { sleep } = require('./cdp');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : argv[i + 1]; };
const id = argv[0];
const 人数 = parseInt(arg('players', '4'), 10);
const PORT = String(arg('port', '3901'));
const CDP = parseInt(arg('cdp', '9601'), 10);
const PER = parseInt(arg('per', '3'), 10);
if (!Number.isFinite(PER) || PER < 0) { console.error('--per は 0 以上の数で渡してください'); process.exit(1); }
const BASE = 'http://localhost:' + PORT;
const OUT = path.join(__dirname, '..', 'docs', '監査_大画面の画像', id + '_' + 人数);
const 大きさ = [[1280, 720], [1920, 1080]];

// 測る式・形の式・走っている演出の式は tools/big-lab.js と共有する（写さない・落とし穴1）。中身は tools/big-measure.js
const { 測る, 走る演出, 形の式 } = require('./big-measure');
// ページの名簿・一枚看板の測り直し（bigReflowSoon・150ms）が残っている間も、まだ落ち着いていない。
// 走っている演出から **BGM の拍（縁の脈）は除く**——競りの間は 0.46秒ごとに始め直されて、一度も 0 にならない。
// 拍の規則が index.html に見つからなければ、ここ（起動の時）で止まる
const 動き中 = '(!!window.__bigReflowPending) || (' + 走る演出() + ').length > 0';

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.readdirSync(OUT).filter((f) => /\.(jpg|json)$/.test(f)).forEach((f) => fs.unlinkSync(path.join(OUT, f)));
  let server = null, up = false;
  try { up = (await fetch(BASE + '/')).ok; } catch (e) {}
  if (!up) {
    const log = fs.openSync(path.join(require('os').tmpdir(), 'big-census-' + PORT + '.log'), 'w');
    server = spawn(process.execPath, [path.join(__dirname, 'dev-server.js')], { env: Object.assign({}, process.env, { PORT }), stdio: ['ignore', log, log] });
    for (let i = 0; i < 60 && !up; i++) { await sleep(250); try { up = (await fetch(BASE + '/')).ok; } catch (e) {} }
  }
  const scenario = require(path.join(__dirname, 'flow-walk', id + '.js'));
  // 端末の並びを渡さない台本は、進行役・参加者・大画面の3台（flow-walk.js の W.始める）
  const 大画面を使う = !scenario.端末 || scenario.端末.indexOf('大画面') !== -1;
  const W = makeWalk({ cassette: id, base: BASE, out: path.join(OUT, 'walk'), cdp: CDP, bots: Math.max(0, 人数 - 2) });
  W.idleMs = 5000;
  const 記録 = [];
  /** 鍵（形の JSON）→ { 形, 測った, 測り直し, 飛ばした, 細部 } */
  const 形ごと = {};
  const 見回り = { 回数: 0, 待ちで飛ばした: 0, 失敗: 0, 最初の失敗: null };
  const 失敗を数える = (どこ, e) => {
    見回り.失敗++;
    if (!見回り.最初の失敗) 見回り.最初の失敗 = どこ + '：' + String(e && e.stack || e).split('\n').slice(0, 3).join(' / ');
  };
  const 鍵に = (形) => JSON.stringify(形 == null ? null : 形);
  let 止める = false, 失敗 = null, 番 = 0, 前に見た = null;

  /** 1280×720 と 1920×1080 で測って撮る。**測る直前に形を読み直し**、測ったものの形を残す */
  const 測って残す = async (big) => {
    番++;
    const rec = { 番, 手順: W.手順.length, 鍵: null, 形: null, 細部: null, 測り: {} };
    try {
      for (let k = 0; k < 大きさ.length; k++) {
        const [w, h] = 大きさ[k];
        await big.raw('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
        await sleep(350);
        // 終わりのある動き（演出）が走っている間は測らない——実験台（big-lab.js）と同じく、落ち着いた版組みを測る。
        // 名簿の行の「当たった」演出（fx-hit・1.09倍）の最中の1コマで、端の札の縁が「切れ」に数えられていた（指示64）
        for (let i = 0; i < 20 && await big.ev(動き中).catch((e) => { 失敗を数える('動き中', e); return false; }); i++) await sleep(100);
        const s = await big.ev(形の式);
        rec.測り[w + 'x' + h] = await big.ev(測る);
        if (k === 0) { rec.形 = s ? s.形 : null; rec.細部 = s ? s.細部 : null; rec.鍵 = 鍵に(rec.形); }
        else if (鍵に(s ? s.形 : null) !== rec.鍵) rec['形' + w] = s ? s.形 : null;
        const f = String(番).padStart(3, '0') + '_' + w + '.jpg';
        await big.shot(path.join(OUT, f));
        rec.測り[w + 'x' + h].画像 = f;
      }
    } finally {
      // 途中で失敗しても、見回りは 1280×720 にもどす（1920 のまま見回ると、形が窓の大きさで変わる）
      await big.raw('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    }
    記録.push(rec);
    // 上限は、見回りで見た形ではなく**測った形**に数える
    const o = 形ごと[rec.鍵] || (形ごと[rec.鍵] = { 形: rec.形, 測った: 0, 測り直し: 0, 飛ばした: 0, 細部: [] });
    if (o.測った > 0) o.測り直し++;
    o.測った++;
    o.細部.push(rec.細部);
    const a = rec.測り['1280x720'], b = rec.測り['1920x1080'];
    const 形の名 = rec.形 && rec.形.画面 === 'scr-rt-big'
      ? [rec.形.big, rec.形.phase && '〔' + rec.形.phase + '〕', rec.形.順位 && '順位表 ' + rec.形.順位, rec.形.出ている].filter(Boolean).join(' ') : '';
    console.log('  [大画面 ' + 番 + (o.測り直し ? '・測り直し' + o.測り直し : '') + '] ' + a.画面 + ' ' + 形の名 + ' ' + (a.段階 || '') + (rec.形1920 ? ' ⚠1920 で形が違う' : '') +
      ' ／ 巻き ' + a.ページの巻き + '・' + b.ページの巻き + ' 箱' + a.箱の巻き.length +
      ' ／ 切れ ' + a.切れの数 + '・' + b.切れの数 + ' ／ 小さい字 ' + a.小さいの数 + '・' + b.小さいの数 + ' ／ 読めない名前 ' + (a.読めないの数 || 0) + '・' + (b.読めないの数 || 0) + ' ／ 演出で除いた ' + a.演出で除いた + '・' + b.演出で除いた + ' ／ 一番大きいボタン「' + ((a.いちばん大きいボタン || {}).文字 || '') + '」');
  };

  const 見回る = async () => {
    while (!止める) {
      const big = W.devices().大画面;
      if (big) {
        try {
          見回り.回数++;
          const s = await big.ev(形の式);
          if (s && s.待ち) {
            // 名簿・順位表の測り直しの途中（列や表彰台の形がまだ決まっていない）。次の見回りで見る
            見回り.待ちで飛ばした++;
          } else if (s) {
            const 見た = 鍵に(s.形) + '#' + s.細部;
            if (見た !== 前に見た) {
              前に見た = 見た;
              const o = 形ごと[鍵に(s.形)];
              if (o && o.細部.indexOf(s.細部) !== -1) {
                // 測ったことのある形と細部に戻っただけ（測り直さない・上限にも数えない）
              } else if (o && o.測り直し >= PER) {
                o.飛ばした++;
              } else {
                await 測って残す(big);
              }
            }
          }
        } catch (e) { 失敗を数える('見回り', e); }
      }
      await sleep(900);
    }
  };

  let 食い違い = [];
  try {
    await W.始める(scenario.端末);
    const loop = 見回る();
    try { await scenario.run(W); } catch (e) { 失敗 = String(e && e.stack || e); console.error('失敗：' + 失敗.split('\n')[0]); }
    await sleep(2500);
    止める = true;
    await loop;
  } finally {
    // ---- 頼んだ人数で本当に回ったか（人狼の census が黙って4人だった・指示64） ----
    const 待合 = 記録.filter((r) => r.形 && r.形.画面 === 'scr-rt-big' && (r.形.big === 'a' || r.形.big === 'b'));
    const 待合で見えた人数 = 待合.length ? Math.max.apply(null, 待合.map((r) => r.形.名簿)) : null;
    const 大画面の状態 = 記録.filter((r) => r.測り['1280x720'] && r.測り['1280x720'].画面 === 'scr-rt-big').length;
    食い違い = [];
    if (待合.length && 待合で見えた人数 !== 人数) 食い違い.push('待合の名簿は最大 ' + 待合で見えた人数 + ' 人（頼んだのは ' + 人数 + ' 人）');
    if (大画面を使う && !大画面の状態) 食い違い.push('大画面を使う台本なのに、大画面（scr-rt-big）の状態を1つも測っていない');
    if (W.bot数 != null && W.bot数 + 2 !== 人数) 食い違い.push('bot ' + W.bot数 + ' 人＋進行役と参加者 2 人 ≠ ' + 人数 + ' 人');
    if (W.bot不足) 食い違い.push('bot が名簿に載りきらなかった（walk/bots.log を見る）');
    const 飛ばした合計 = Object.values(形ごと).reduce((s, o) => s + o.飛ばした, 0);
    fs.writeFileSync(path.join(OUT, '記録.json'), JSON.stringify({ カセット: id, 人数, 失敗, per: PER,
      bot数: W.bot数 == null ? null : W.bot数, bot不足: W.bot不足 == null ? null : W.bot不足, 待合で見えた人数, 大画面の状態, 食い違い,
      見回り, 飛ばした合計, 形の数: Object.keys(形ごと).length, 形ごと, 記録 }, null, 1));
    await W.片付ける();
    if (server) { try { server.kill(); } catch (e) {} }
    console.log(id + ' ' + 人数 + '人：大画面の状態 ' + 記録.length + '（形 ' + Object.keys(形ごと).length + '・--per ' + PER + ' の上限で飛ばした ' + 飛ばした合計 + '）' + (失敗 ? ' ／ 途中で止まった' : ''));
    console.log('  見回り ' + 見回り.回数 + ' 回（測り直しの途中で飛ばした ' + 見回り.待ちで飛ばした + '）' +
      (見回り.失敗 ? ' ／ ⚠ 読み取りの失敗 ' + 見回り.失敗 + ' 回（最初：' + 見回り.最初の失敗.split(' / ')[0] + '）' : ''));
    console.log('  待合で見えた人数：' + (待合で見えた人数 == null ? '（待合を測っていない）' : 待合で見えた人数) + '・bot ' + (W.bot数 == null ? '（入れていない）' : W.bot数) + (W.bot不足 ? '（載りきらず）' : ''));
    食い違い.forEach((x) => console.log('✖ 人数の食い違い：' + x));
    process.exit(失敗 || 食い違い.length ? 1 : 0);
  }
})();
