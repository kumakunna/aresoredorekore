#!/usr/bin/env node
// tools/flow-walk.js — 「QRを読んでから、ゲームが終わったあと」までを、手順ごとに撮って測る（指示62 第1部）
//
// ── 使い方 ────────────────────────────────────────
//   node tools/flow-walk.js bakudan                 # 検証用サーバーを自分で立てて、1カセット通す
//   node tools/flow-walk.js bakudan --port 3105 --cdp 9405   # 並べて走らせる時は、口をずらす
//   node tools/flow-walk.js bakudan --url http://localhost:3001   # 立っているサーバーに向ける
//   node tools/flow-walk.js bakudan --idle 60       # 結果のあと何秒放置するか（既定 60）
//   node tools/flow-walk.js bakudan --out DIR       # 置き場（既定 docs/監査_審査会の指摘_画像/<カセット>）
//
// **何をするか。**
//   ・進行役（375×812・/dev-login 済み）、参加者＝「人の役」（375×667・ログインしない・QRから入る）、
//     大画面（1280×720）の3台を tools/cdp.js の別々の端末として立てる
//   ・残りの2人は tools/room-bots.js（--play）。**4人で遊ぶ**（進行役＋人の役＋bot 2）
//   ・**手順ごとに、3台を同時に撮る**。あわせて、その瞬間の画面から
//     「迷いそうな所」の物差し(a)〜(f)の材料を数で拾う（下の 測る()）
//   ・結果が出たら、ボタンの一覧を取り、**何もしないで --idle 秒**待って、何が起きたかを記録する
//   ・最後に tools/flow-sheet.js で「一覧の画像」を1枚にする
//
// **カセットごとの中身は tools/flow-walk/<カセットid>.js。**
// 共通の部分（入口→部屋→QR→大画面→bot）はここに置き、台本はそれを呼ぶ。
//
// **数えるもの**
//   押す回数 … この台本が押したタップの数（本物のタップ／click()）。入力は「入力」で別に数える
//   かかった時間 … 手順の始まりから、撮る直前まで。**待ち時間は分けて**（他の人待ち／演出待ち）
//   bot は待たせずに即答するので、**他の人待ちは実際より短く出る**（報告に書く）
//
// **本番には向けない**（検証用サーバーだけ）。画像は git に入れない（.gitignore 済み）。

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { launch, sleep } = require('./cdp');
const { 測る: 大画面の測り, 走る演出の名 } = require('./big-measure');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const JSQR = fs.readFileSync(path.join(ROOT, 'node_modules', 'jsqr', 'dist', 'jsQR.js'), 'utf8');

// ---- 画面から「迷いそうな所」の材料を拾う（ページの中で走る） ----
// (a) 同じ強さのボタンが2つ以上 … 見えていて押せる btn-main の数
// (b) 2行より長い文 … 見えている文のかたまりごとの行数（ボタンの中は数えない）
// (c) 何を待っているか … 「待」「まって」などの文が見えているか
// (d) 戻る・やめる … それらしいボタンが見えているか
// (e) 進行役向けの言葉 … 参加者の画面に「進行役」「はじめる」などが見えているか
// 判断そのものは、撮った画像を見て人（とレビュー役）が下す。ここは**材料だけ**
const 測る式 = `(function(){
  var cv = typeof Element.prototype.checkVisibility === 'function';
  function shown(e){
    if(!e || !e.getBoundingClientRect) return false;
    var r = e.getBoundingClientRect(); if(r.width < 1 || r.height < 1) return false;
    if(cv) return e.checkVisibility({opacityProperty:true, visibilityProperty:true});
    var s = getComputedStyle(e); return s.display !== 'none' && s.visibility !== 'hidden' && +s.opacity !== 0;
  }
  var H = document.documentElement.clientHeight, W = document.documentElement.clientWidth;
  var scr = (document.querySelector('.screen.active') || {}).id || null;
  var btns = Array.prototype.filter.call(document.querySelectorAll('button, [role=button], a.btn, .btn'), shown)
    .filter(function(b, i, a){ return a.indexOf(b.parentElement && b.parentElement.closest('button')) === -1; })
    .map(function(b){
      var r = b.getBoundingClientRect(), c = String(b.className || '');
      return { t: (b.innerText || b.textContent || b.getAttribute('aria-label') || '').trim().replace(/\\s+/g, ' ').slice(0, 40),
        k: /btn-main/.test(c) ? 'main' : /btn-outline/.test(c) ? 'outline' : /btn-ghost/.test(c) ? 'ghost' : /btn-teal/.test(c) ? 'teal' : 'other',
        w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left), y: Math.round(r.top),
        dis: !!b.disabled, 画面内: r.bottom > 0 && r.top < H,
        // 幕（確認・称号・チュートリアル）の下に隠れていて、いまは押せないか。
        // 真ん中の点の一番上にあるものが、そのボタン自身（かその中身）でなければ隠れている
        覆われ: (function(){ var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
          if(cy < 0 || cy > H) return false; var top = document.elementFromPoint(cx, cy);
          return !!top && top !== b && !b.contains(top); })() };
    });
  // 文のかたまり：文字の親から、いちばん近い「箱」（block/flex/grid/list-item）まで上がって束ねる
  var blocks = new Map();
  var tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
  var n;
  while((n = tw.nextNode())){
    var s = n.nodeValue.replace(/\\s+/g, ''); if(!s) continue;
    var p = n.parentElement; if(!p || p.closest('script,style,button,.btn,[role=button],svg,noscript')) continue;
    if(!shown(p)) continue;
    var b = p;
    while(b && b !== document.body){ var d = getComputedStyle(b).display; if(d !== 'inline' && d !== 'inline-block' && d !== 'contents') break; b = b.parentElement; }
    if(!b) continue;
    blocks.set(b, (blocks.get(b) || '') + n.nodeValue);
  }
  var 文 = [];
  blocks.forEach(function(t, b){
    var r = b.getBoundingClientRect(); if(r.bottom <= 0 || r.top >= H) return;
    var lh = parseFloat(getComputedStyle(b).lineHeight) || (parseFloat(getComputedStyle(b).fontSize) * 1.5) || 20;
    var 字 = t.replace(/\\s+/g, '');
    文.push({ 字: 字.length, 行: Math.max(1, Math.round(r.height / lh)), t: t.trim().replace(/\\s+/g, ' ').slice(0, 120) });
  });
  文.sort(function(a, b){ return b.字 - a.字; });
  var 見えている字 = (function(){
    var el = document.querySelector('.screen.active'); var out = [];
    if(el && shown(el)) out.push(el.innerText);
    Array.prototype.forEach.call(document.querySelectorAll('.ui-layer, .overlay.show, #uiLayerRoot > *, .fx-shutter, .fx-cel, .tut-bubble, [class*=tut-]'), function(o){ if(shown(o) && o.innerText) out.push(o.innerText); });
    return out.join('\\n').replace(/\\n{2,}/g, '\\n').trim();
  })();
  var 待ち文 = (見えている字.match(/[^\\n]*(待|まって|まだ|中です|しています|そろう|そろったら|のを|順番)[^\\n]*/g) || []).slice(0, 4);
  var 戻る = btns.filter(function(b){ return /戻|もど|やめ|出る|でる|とじ|閉じ|キャンセル|←|‹|ぬけ|おわ|終わ|退/.test(b.t); }).map(function(b){ return b.t; });
  var 進行役語 = (見えている字.match(/[^\\n]*(進行役|ホスト|ゲームをえらぶ|えらびなおす|はじめる|部屋をとじる|部屋を閉じる)[^\\n]*/g) || []).slice(0, 4);
  var 重なり = Array.prototype.filter.call(document.querySelectorAll('.overlay.show, .ui-layer > *, #uiLayerRoot > *'), shown)
    .map(function(o){ return (o.id || String(o.className).split(' ')[0] || o.tagName); }).slice(0, 6);
  var app = document.getElementById('app');
  var appH = app ? Math.round(app.getBoundingClientRect().height) : null;
  return {
    画面: scr, 重なり: 重なり,
    ボタン: btns,
    主ボタン数: btns.filter(function(b){ return b.k === 'main' && !b.dis && b.画面内 && !b.覆われ; }).length,
    文: 文.slice(0, 5), 長い文: 文.filter(function(x){ return x.行 > 2; }).length,
    待ち文: 待ち文, 戻る: 戻る, 進行役語: 進行役語,
    小さい的: btns.filter(function(b){ return b.画面内 && !b.dis && (b.w < 44 || b.h < 44); }).map(function(b){ return b.t + '(' + b.w + '×' + b.h + ')'; }),
    画面外のボタン: btns.filter(function(b){ return !b.画面内 && !b.dis; }).map(function(b){ return b.t; }),
    横はみ出し: document.documentElement.scrollWidth > W,
    // 指示63 門G7：3-2-1 が出ている間、画面の真ん中を押すと数字の幕が受けるか（＝下の盤は押せない）。
    // 時計（data-timer）が見えていないか。吹き出し（.tut-say）が出ていないか
    数え中: (function(){
      var cd = document.querySelector('.fx-countdown');
      if(!cd) return null;
      var top = document.elementFromPoint(W / 2, H / 2);
      var 時計 = Array.prototype.filter.call(document.querySelectorAll('[data-timer]'), function(t){
        var r = t.getBoundingClientRect(); return r.width > 0 && getComputedStyle(t).visibility !== 'hidden' && getComputedStyle(t).display !== 'none';
      }).map(function(t){ return t.id + '=' + t.textContent.trim(); });
      var tut = document.querySelector('.tut-say');
      return { 数字: (cd.textContent || '').trim(), 幕が受ける: !!top && cd.contains(top),
        見えている時計: 時計, 吹き出し: !!tut && tut.getBoundingClientRect().width > 0 && getComputedStyle(tut).opacity !== '0' };
    })(),
    appの高さ: appH, 画面の高さ: H,
    字: 見えている字.slice(0, 600)
  };
})()`;

// ---- 1回分の通し ----
function makeWalk(opts) {
  const OUT = opts.out;
  const 手順 = [];
  const 気づき = [];
  const 終わり方 = {};
  const t0 = Date.now();
  let 番号 = 0;
  let 押した = 0, 入力 = 0;
  let devices = {};

  const W = {
    OUT, BASE: opts.base, 手順, 気づき, 終わり方, sleep,
    get host() { return devices.進行役; }, get part() { return devices.参加者; }, get big() { return devices.大画面; },
    devices: () => devices,
    code: null, qrUrl: null, bots: null, モード: null, メモ書き: [],

    /** 押す（本物のタップ）。数える */
    async tap(dev, sel) { await dev.tap(sel); 押した++; },
    /** 押す（click()）。押した先の処理は本物のまま。棚のように動くものに使う。数える */
    async click(dev, sel) { await dev.click(sel); 押した++; },
    /** 見えていて文字が合うボタンを押す。数える。押したボタンの文字を返す */
    async press(dev, re, scope) {
      const src = re instanceof RegExp ? re.source : String(re);
      // u フラグ：絵文字（サロゲート対）を ? や [] に入れても1文字として扱う（あれそれの担当が踏んだ）
      const t = await dev.ev("(function(){var re=new RegExp(" + JSON.stringify(src) + ",'u');" +
        "var cv=typeof Element.prototype.checkVisibility==='function';" +
        "var bs=Array.from(document.querySelectorAll(" + JSON.stringify(scope || 'button, .btn, [role=button]') + ")).filter(function(b){var r=b.getBoundingClientRect();return r.width>0&&r.height>0&&(!cv||b.checkVisibility({opacityProperty:true,visibilityProperty:true}))&&!b.disabled&&re.test((b.innerText||b.textContent||'').trim());});" +
        "var top=bs.filter(function(b){return !!b.closest('.ui-layer');}); var b=(top.length?top[top.length-1]:bs[0]); if(!b) return null; b.click(); return (b.innerText||b.textContent).trim().replace(/\\s+/g,' ');})()");
      if (t === null) throw new Error(dev.name + '：押すボタンが見つかりません /' + src + '/');
      押した++;
      return t;
    },
    /** あれば押す（無ければ false）。数える */
    async pressIf(dev, re, scope) { try { return await W.press(dev, re, scope); } catch (e) { return false; } },
    /** 入力欄に文字を入れる。「入力」として数える */
    async type(dev, sel, text) {
      await dev.ev("(function(){var i=document.querySelector(" + JSON.stringify(sel) + "); i.focus(); i.value=" + JSON.stringify(text) + ";" +
        "i.dispatchEvent(new Event('input',{bubbles:true})); i.dispatchEvent(new Event('change',{bubbles:true})); return true;})()");
      入力++;
    },
    screen: (dev) => dev.screen(),
    画面は: (dev, id, ms) => dev.until("(document.querySelector('.screen.active')||{}).id===" + JSON.stringify(id), ms || 15000, dev.name + '：' + id),
    見える: (sel) => "(function(){var e=document.querySelector(" + JSON.stringify(sel) + ");if(!e)return false;var r=e.getBoundingClientRect();if(r.width<1||r.height<1)return false;return typeof e.checkVisibility==='function'?e.checkVisibility({opacityProperty:true,visibilityProperty:true}):true;})()",
    /** その文字のボタンが見えているか */
    ボタンあり: (dev, re) => dev.ev("(function(){var re=new RegExp(" + JSON.stringify(re instanceof RegExp ? re.source : String(re)) + ",'u');return Array.from(document.querySelectorAll('button, .btn, [role=button]')).some(function(b){var r=b.getBoundingClientRect();return r.width>0&&r.height>0&&(typeof b.checkVisibility!=='function'||b.checkVisibility({opacityProperty:true,visibilityProperty:true}))&&!b.disabled&&re.test((b.innerText||b.textContent||'').trim());});})()"),

    /**
     * 手順を1つ記録する。
     *   誰 … '進行役' | '参加者' | '大画面' | '全員' | 'bot'
     *   する … '押す' | '入力' | '待つ' | '見る' | 'QRを読む' など
     *   fn … その手順の操作。中で W.tap / W.press / W.type を呼ぶと数えられる
     *   o.待ち … { 種類:'他の人待ち'|'演出待ち'|'通信待ち', 何を:'…', until: async()=>{} }
     *            操作のあとに待つものがあれば渡す。待った時間は「待ち」に分けて残す
     */
    async 手順を(誰, 名, する, fn, o) {
      o = o || {};
      番号++;
      const no = 番号;
      const 押す前 = 押した, 入力前 = 入力;
      const 始め = Date.now();
      let 操作ms = 0, 待ちms = 0, 待ちの種類 = null, 待つもの = null, 失敗 = null;
      try {
        if (fn) await fn();
        操作ms = Date.now() - 始め;
        if (o.待ち && o.待ち.until) {
          const w0 = Date.now();
          await o.待ち.until();
          待ちms = Date.now() - w0;
          待ちの種類 = o.待ち.種類 || null; 待つもの = o.待ち.何を || null;
        }
        if (o.間 !== undefined) await sleep(o.間); else await sleep(450);
      } catch (e) {
        失敗 = String(e && e.message || e);
        console.log('   ✖ ' + 失敗);
      }
      const 撮影 = await W.撮る(no, o.撮らない);
      const rec = {
        no, 誰, 名, する, 押す回数: 押した - 押す前, 入力回数: 入力 - 入力前,
        経過ms: Date.now() - t0, 操作ms, 待ちms, 待ちの種類, 待つもの,
        画面: 撮影.画面, 画像: 撮影.画像, 測り: 撮影.測り, メモ: o.メモ || '', 失敗
      };
      手順.push(rec);
      console.log(String(no).padStart(3) + ' [' + 誰 + '] ' + 名 + '（' + する + (rec.押す回数 ? '・' + rec.押す回数 + '回' : '') +
        (待ちms ? '・待ち' + (待ちms / 1000).toFixed(1) + '秒' + (待ちの種類 ? '=' + 待ちの種類 : '') : '') + '）→ ' +
        Object.keys(撮影.画面).map((k) => k[0] + ':' + 撮影.画面[k]).join(' '));
      if (失敗 && !o.失敗してよい) throw new Error('手順' + no + '「' + 名 + '」で止まりました：' + 失敗);
      return rec;
    },
    /** 待つだけの手順（誰かを待つ・演出を待つ） */
    async 待つ(誰, 何を, 種類, until, o) {
      return W.手順を(誰, 何を + 'を待つ', '待つ', null, Object.assign({}, o || {}, { 待ち: { 種類, 何を, until } }));
    },
    /** 直前の手順にメモを足す */
    メモ(text) { const r = 手順[手順.length - 1]; if (r) r.メモ = (r.メモ ? r.メモ + ' ／ ' : '') + text; },
    /** 気づいたこと（直さない）。重さ：'遊べなくなる' | '困る' | '気になる' */
    気づいた(重さ, 何が, どこ) {
      const r = 手順[手順.length - 1];
      気づき.push({ 重さ, 何が, どこ: どこ || '', 手順: r ? r.no : null });
      console.log('   ★ ' + 重さ + '：' + 何が);
    },

    /** 3台（いる分）を同時に撮る。画面の材料も一緒に拾う */
    async 撮る(no, 撮らない) {
      const 画面 = {}, 画像 = {}, 測り = {};
      await Promise.all(Object.keys(devices).map(async (k) => {
        const d = devices[k];
        // まだアプリを開いていない端末（about:blank）は撮らない——黒い絵が並ぶだけ
        try { if (await d.ev("location.href==='about:blank'")) { 画面[k] = '（まだ開いていない）'; 測り[k] = { 画面: null }; return; } } catch (e) {}
        try { 測り[k] = await d.ev(測る式); 画面[k] = 測り[k].画面; } catch (e) { 画面[k] = '?'; 測り[k] = { 失敗: String(e.message) }; }
        // 指示64 門B8：大画面は、巻き・切れ・小さい字も同じ式で測る（式は tools/big-measure.js の1つだけ。写さない）
        if (k === '大画面' && 測り[k] && 測り[k].画面 === 'scr-rt-big') {
          try {
            const m = await d.ev(大画面の測り);
            // 測った瞬間に走っていた演出も残す（切れが出た時、入れかわりの途中だったかを後で見分けるため）
            const 走る = m && m.切れの数 ? await d.ev(走る演出の名()) : [];
            if (m) 測り[k].大画面 = { 走る演出: 走る, 巻き: m.ページの巻き, 箱の巻き: m.箱の巻き.length, 切れ: m.切れ.slice(0, 8), 切れの数: m.切れの数, 小さい: m.小さい.slice(0, 8), 小さいの数: m.小さいの数, 読めない: (m.読めない || []).slice(0, 8), 読めないの数: m.読めないの数 || 0, 段階: m.段階 };
          } catch (e) { 測り[k].大画面 = { 失敗: String(e.message) }; }
        }
        if (撮らない) return;
        const f = String(no).padStart(3, '0') + '_' + k + '.jpg';
        try { await d.shot(path.join(OUT, f)); 画像[k] = f; } catch (e) { 画像[k] = null; }
      }));
      return { 画面, 画像, 測り };
    },

    // ======== 共通の道筋 ========

    /** 進行役：ログインして、入口から棚へ。カセットを選び、部屋をつくって待合へ */
    async 進行役が部屋をつくる(cassetteId, 名) {
      const h = devices.進行役;
      await h.go(W.BASE + '/dev-login');
      await W.手順を('進行役', 'アプリを開く', '開く', async () => {
        await h.go(W.BASE + '/');
        await W.扉を越える(h, true);
      }, { 待ち: { 種類: '演出待ち', 何を: '入口', until: () => W.画面は(h, 'scr-entry') } });
      await W.手順を('進行役', '入口：ゲームをえらぶ', '押す', async () => {
        await W.click(h, '[data-entry="choose"]');
      }, { 待ち: { 種類: '演出待ち', 何を: '棚', until: () => W.画面は(h, 'scr-shelf') }, 間: 700 });
      await W.棚でカセットを選ぶ(h, cassetteId, 名);
      await W.画面は(h, 'scr-play-way');
      await W.手順を('進行役', '遊び方：みんなのスマホで（部屋）', '押す', async () => {
        await W.click(h, '#wayChoices [data-way="room"]');
      }, { 待ち: { 種類: '演出待ち', 何を: '部屋をつくる画面', until: () => W.画面は(h, 'scr-rt-lobby') } });
      await W.手順を('進行役', '部屋をつくる（名前を入れて つくる）', '入力して押す', async () => {
        const v = await h.ev("(document.getElementById('rtCreateName')||{}).value||''");
        if (!v) await W.type(h, '#rtCreateName', 'くま');
        await W.click(h, '#rtCreateBtn');
      }, { 待ち: { 種類: '通信待ち', 何を: '部屋', until: () => W.画面は(h, 'scr-rt-room') }, 間: 700 });
      W.code = (await h.ev("(document.getElementById('rtRoomCode')||{}).textContent||''")).replace(/\s/g, '');
      console.log('   部屋コード：' + W.code);
      return W.code;
    },

    /** 棚でカセットを1つ選ぶ（中央に寄せる→もう一度押すと決まる、の形） */
    async 棚でカセットを選ぶ(dev, cassetteId, 名) {
      const sel = '.cart[data-cart="' + cassetteId + '"]';
      await W.手順を(dev.name, '棚：' + (名 || cassetteId) + ' を押す', '押す', async () => {
        await W.click(dev, sel);
      }, { 間: 700 });
      if ((await dev.screen()) === 'scr-shelf') {
        await W.手順を(dev.name, '棚：もう一度押して決める', '押す', async () => {
          await W.click(dev, sel);
        }, { 待ち: { 種類: '演出待ち', 何を: '次の画面', until: () => dev.until("(document.querySelector('.screen.active')||{}).id!=='scr-shelf'", 8000) }, 間: 900 });
      }
    },

    /** 扉（と初回の安全の案内）を越える。安全の案内を押したら数える */
    async 扉を越える(dev, 数える) {
      await dev.until("document.getElementById('safetyGate').style.display==='flex'||(document.querySelector('.screen.active')||{}).id!=='scr-door'", 10000, '起動');
      if (await dev.ev("document.getElementById('safetyGate').style.display==='flex'")) {
        if (数える) await W.click(dev, '#sgStartBtn'); else await dev.click('#sgStartBtn');
        await sleep(500);
      }
    },

    /** 待合のQRを、独立したデコーダー（jsqr）で本当に読む（落とし穴19） */
    async QRを読む() {
      const h = devices.進行役;
      const url = await h.ev("(async function(){" + JSQR + ";\n" +
        "var svg=document.querySelector('#rtQr svg'); if(!svg) return null;" +
        "var xml=new XMLSerializer().serializeToString(svg);" +
        "var img=new Image(); img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(xml);" +
        "await new Promise(function(r){img.onload=r;img.onerror=r;});" +
        "var c=document.createElement('canvas'); c.width=400; c.height=400; var g=c.getContext('2d');" +
        "g.fillStyle='#fff'; g.fillRect(0,0,400,400); g.drawImage(img,20,20,360,360);" +
        "var d=g.getImageData(0,0,400,400); var q=(typeof jsQR!=='undefined'?jsQR:window.jsQR)(d.data,400,400);" +
        "return q?q.data:null;})()");
      if (!url) throw new Error('QRが読めませんでした');
      W.qrUrl = url.replace(/^https?:\/\/[^/]+/, W.BASE);
      console.log('   QRの中身：' + url + (W.qrUrl !== url ? '（→ ' + W.qrUrl + ' で開く）' : ''));
      return W.qrUrl;
    },

    /** 参加者（人の役）：QRを読んで入り、名前を入れて、部屋に入る */
    async 参加者がQRで入る(名前) {
      const p = devices.参加者;
      const url = await W.QRを読む();
      await W.手順を('参加者', 'QRを読む（カメラ）→ ページが開く', 'QRを読む', async () => {
        await p.go(url);
      }, { 待ち: { 種類: '通信待ち', 何を: 'ページの読み込み', until: () => p.until("document.getElementById('safetyGate').style.display==='flex'||(document.querySelector('.screen.active')||{}).id!=='scr-door'", 10000) } });
      if (await p.ev("document.getElementById('safetyGate').style.display==='flex'")) {
        await W.手順を('参加者', '安全の案内：はじめる', '押す', async () => {
          await W.click(p, '#sgStartBtn');
        }, { 待ち: { 種類: '演出待ち', 何を: '扉が開く', until: () => p.until("(document.querySelector('.screen.active')||{}).id!=='scr-door'", 10000) }, 間: 1200 });
      }
      if ((await p.screen()) === 'scr-rt-lobby') {
        await W.手順を('参加者', '名前を入れる', '入力', async () => {
          await W.type(p, '#rtJoinName', 名前 || 'ひろ');
        }, { 間: 200 });
        await W.手順を('参加者', '部屋に入る', '押す', async () => {
          await W.click(p, '#rtJoinBtn');
        }, { 待ち: { 種類: '通信待ち', 何を: '部屋', until: () => p.until("['scr-rt-room','scr-rt-rules'].indexOf((document.querySelector('.screen.active')||{}).id)!==-1", 12000) }, 間: 900 });
      } else {
        W.メモ('QRから開くと、名前を入れる画面を通らずに ' + (await p.screen()) + ' に着いた');
      }
    },

    /** 大画面：入口の「大画面として部屋に入る」から、コードを入れて入る */
    async 大画面が入る() {
      const b = devices.大画面;
      await W.手順を('大画面', '大画面：アプリを開く', '開く', async () => {
        await b.go(W.BASE + '/');
        await W.扉を越える(b, true);
      }, { 待ち: { 種類: '演出待ち', 何を: '入口', until: () => W.画面は(b, 'scr-entry') } });
      await W.手順を('大画面', '入口：大画面として部屋に入る', '押す', async () => {
        await W.click(b, '[data-entry="big"]');
      }, { 間: 900 });
      if ((await b.screen()) === 'scr-rt-lobby') {
        await W.手順を('大画面', 'コードと名前を入れて入る', '入力して押す', async () => {
          await W.type(b, '#rtJoinCode', W.code);
          const v = await b.ev("(document.getElementById('rtJoinName')||{}).value||''");
          if (!v) await W.type(b, '#rtJoinName', 'テレビ');
          await W.click(b, '#rtJoinBtn');
        }, { 待ち: { 種類: '通信待ち', 何を: '大画面', until: () => W.画面は(b, 'scr-rt-big', 12000) }, 間: 900 });
      }
    },

    /** bot 2人を入れる（tools/room-bots.js --ready --play） */
    /** o.ready === false で、bot は準備OKを押さない（「だれかを待っている」待合を撮る時・probe-63-lobby） */
    async botを入れる(n, o) {
      const 押す = !(o && o.ready === false) ? ['--ready'] : [];
      // 指示64：部屋の人数を変えて通す（opts.bots で bot の数を上書き。台本は bot 2 のつもりで書いてある）
      if (opts.bots != null) n = opts.bots;
      if (n == null) n = 2;
      n = parseInt(n, 10);
      if (!Number.isFinite(n)) throw new Error('bot の数が数ではありません：' + n);
      // 0人（進行役と参加者の2人で通す）は「入れない」。`n || 2` だと 0 が黙って 2 になり、
      // room-bots.js も --n 0 を 2 と読むので、census --players 2 が4人で回る
      //（人狼の census が 8人・16人のつもりで全部4人だったのと同じ形：頼んだ人数が黙って変わる）
      // 入れた数と、名簿に載りきらなかったかを残す（記録.json の bot数・bot不足）。
      // census は「頼んだ人数で本当に回ったか」をこれで確かめる（人狼が黙って4人だった・指示64）
      W.bot数 = Math.max(0, n);
      W.bot不足 = false;
      if (n <= 0) { console.log('   bot は入れません（' + n + '人）'); return null; }
      const logFile = path.join(OUT, 'bots.log');
      const out = fs.openSync(logFile, 'w');
      const child = spawn(process.execPath, [path.join(__dirname, 'room-bots.js'), '--url', W.BASE, '--code', W.code,
        '--n', String(n)].concat(押す, ['--play', '--hold', '7200']), { stdio: ['ignore', out, out] });
      W.bots = child;
      // 入ったことを部屋の名簿で確かめる（画面の数字だけで読まない）
      // 待合の人数（#rtRoomCount＝playerCount。大画面は数えない）。
      // 最初は実在しない '#rtMembers …' を待っていて、毎回15秒かけて黙って先へ進んでいた（8人の担当が指摘）
      // 載りきらなくても台本は先へ進む（ここでは止めない）。かわりに W.bot不足 に残し、止めるかは台本と census が決める
      await devices.進行役.until("parseInt((document.getElementById('rtRoomCount')||{}).textContent,10)>=" + (2 + n), 15000, 'bot が名簿に載る')
        .catch(() => { W.bot不足 = true; console.log('   ✖ bot が名簿に載りませんでした（bots.log を見る）'); });
      await sleep(800);
      return child;
    },

    /**
     * 進行役：待合の「ゲームをえらぶ」から、設定を終えて待合に戻るまで。
     * **何も変えずに既定のまま進む**（棚で最初に選ばれているゲーム・モードをそのまま使う）。
     * 画面ごとの押し方を変えたい時は o.handlers[画面id] = async (dev) => {...}（false を返すと既定に任せる）
     */
    async 設定を進める(o) {
      const h = devices.進行役;
      let 前 = null, 同じ = 0;
      for (let i = 0; i < 40; i++) {
        const scr = await h.screen();
        if (scr === (o.終わり || 'scr-rt-room')) return;
        if (scr === 前) { if (++同じ > 3) throw new Error('進行役が ' + scr + ' から進めません'); } else { 前 = scr; 同じ = 0; }
        if (o.handlers && o.handlers[scr]) { const r = await o.handlers[scr](h); if (r !== false) continue; }
        if (scr === 'scr-shelf') { await W.棚でカセットを選ぶ(h, o.cassetteId, o.名); continue; }
        if (scr === 'scr-play-way') {
          const ways = await h.ev("Array.from(document.querySelectorAll('#wayChoices [data-way]')).map(function(b){return b.dataset.way+':'+b.innerText.replace(/\\s+/g,' ').trim();})");
          const pick = ways.find((w) => /^room:/.test(w)) || ways[0];
          await W.手順を('進行役', '遊び方の確認：' + pick.replace(/^[a-zA-Z]+:/, ''), '押す', () => W.click(h, '#wayChoices [data-way="' + pick.split(':')[0] + '"]'), { 間: 900 });
          continue;
        }
        if (scr === 'scr-game') {
          const g = await h.ev("(function(){var c=document.querySelector('#gameCards .mode-card.selected');return c?c.dataset.game+'：'+c.querySelector('.m-title').textContent:null;})()");
          W.ゲーム = g;
          await W.手順を('進行役', 'ゲーム：最初に選ばれている「' + g + '」のまま つぎへ', '押す', () => W.click(h, '#gameNextBtn'), { 間: 900 });
          continue;
        }
        if (scr === 'scr-mode') {
          const m = await h.ev("(function(){var c=document.querySelector('#modeCards .mode-card.selected');return c?{id:c.dataset.id,t:c.querySelector('.m-title').textContent}:null;})()");
          if (m && !W.モード) W.モードを(m.t + '（' + m.id + '）', 'モード画面で最初に選ばれていたもの（何も変えずに「つぎへ」）');
          await W.手順を('進行役', 'モード：最初に選ばれている「' + (m && m.t) + '」のまま つぎへ', '押す', () => W.click(h, '#modeNextBtn'), { 間: 900 });
          continue;
        }
        if (scr === 'scr-mode-rules') { await W.手順を('進行役', 'モードのルール：はじめる', '押す', () => W.click(h, '#rulesStartBtn'), { 間: 900 }); continue; }
        if (scr === 'scr-rt-rules') {
          // 「はじめてですね」が出ていたら先に答える（出たまま準備OKを押すと、幕に当たって進まない）。
          // 進行役は会場の係で遊び方を知っている前提なので「いらない」。参加者は 準備OKまで が「見る」を押す
          const 問い = await h.ev("(function(){var b=Array.from(document.querySelectorAll('.ui-layer button, #uiLayerRoot button')).find(function(x){return /いらない/.test(x.textContent)&&x.getBoundingClientRect().width>0;});return !!b;})()");
          if (問い) { await W.手順を('進行役', '「はじめてですね」：いらない', '押す', () => W.press(h, /^いらない$/, '.ui-layer button, #uiLayerRoot button'), { 間: 800 }); 前 = null; continue; }
          await W.手順を('進行役', '部屋のルール：準備OK', '押す', () => W.click(h, '#rtRulesOkBtn'), { 間: 900 });
          continue;
        }
        const next = await h.ev("(function(){var n=Array.from(document.querySelectorAll('.screen.active [data-wiz-next]')).find(function(b){return b.getBoundingClientRect().width>0&&!b.disabled;});return n?(n.innerText||'').trim():null;})()");
        if (next !== null) {
          await W.手順を('進行役', '設定（' + scr + '）：既定のまま「' + next + '」', '押す', () => h.ev("(function(){var n=Array.from(document.querySelectorAll('.screen.active [data-wiz-next]')).find(function(b){return b.getBoundingClientRect().width>0&&!b.disabled;}); n.click(); return true;})()").then(() => { 押した++; }), { 間: 900 });
          continue;
        }
        await W.手順を('進行役', '（わからない画面 ' + scr + '）', '見る', null);
        throw new Error('進行役の設定で、知らない画面に着きました：' + scr);
      }
      throw new Error('進行役の設定が終わりません');
    },

    /**
     * ルールを読んで「準備OK」まで（参加者・進行役どちらにも使う）。
     * **初めての人への「あそびかたを見ますか？」は既定の「見る」を押す**——
     * 文化祭に来る人はみんな初めてで、既定（大きい方）を押すのがふつうの手だから。
     * o.チュートリアル = 'いらない' で断る
     */
    async 準備OKまで(dev, o) {
      o = o || {};
      for (let i = 0; i < 10; i++) {
        const 問い = await dev.ev("(function(){var b=Array.from(document.querySelectorAll('.ui-layer button, #uiLayerRoot button')).find(function(x){return /いらない/.test(x.textContent)&&x.getBoundingClientRect().width>0;});return !!b;})()");
        if (問い) {
          const 押す = o.チュートリアル === 'いらない' ? /^いらない$/ : /^見る$/;
          await W.手順を(dev.name, '「はじめてですね」：' + (o.チュートリアル || '見る'), '押す', () => W.press(dev, 押す, '.ui-layer button, #uiLayerRoot button'), { 間: 800 });
          continue;
        }
        const scr = await dev.screen();
        if (scr === 'scr-rt-rules') {
          await W.手順を(dev.name, 'ルールを読む → 準備OK', '読んで押す', () => W.click(dev, '#rtRulesOkBtn'), { 間: 900 });
          continue;
        }
        if (await dev.ev(W.見える('#rtRoomReadyBtn')) && !(await dev.ev("document.getElementById('rtRoomReadyBtn').disabled"))) {
          const t = await dev.ev("document.getElementById('rtRoomReadyBtn').innerText.trim()");
          if (/OK|準備/.test(t) && !/取り消|やめ|まって/.test(t)) {
            await W.手順を(dev.name, '待合：「' + t + '」', '押す', () => W.click(dev, '#rtRoomReadyBtn'), { 間: 800 });
            continue;
          }
        }
        return;
      }
    },

    /** いまの画面で見えているボタンを全部（終わり方の表に使う） */
    async ボタン一覧(dev) {
      const m = await dev.ev(測る式);
      return m.ボタン.filter((b) => !b.dis).map((b) => b.t);
    },

    /**
     * 結果が出たあと、**何もしないで** ms 待つ。その間に起きたことを3台とも記録する
     * （画面の切り替わり・重なりの出入り・ボタンの増減）
     */
    async 放置する(ms, 名) {
      const 見張り = "(function(){window.__放置=[];var t0=performance.now();var last=(document.querySelector('.screen.active')||{}).id;" +
        "function note(s){window.__放置.push(Math.round((performance.now()-t0)/100)/10+'秒 '+s);}" +
        "window.__放置見張り=new MutationObserver(function(){var cur=(document.querySelector('.screen.active')||{}).id;if(cur!==last){note('画面 '+last+' → '+cur);last=cur;}" +
        "var ov=Array.from(document.querySelectorAll('.overlay.show, .ui-layer > *, #uiLayerRoot > *')).filter(function(o){return o.getBoundingClientRect().width>0;}).map(function(o){return o.id||String(o.className).split(' ')[0];}).join(',');" +
        "if(ov!==window.__放置ov){note('重なり ['+(window.__放置ov||'')+'] → ['+ov+']');window.__放置ov=ov;}});" +
        "window.__放置ov=Array.from(document.querySelectorAll('.overlay.show, .ui-layer > *, #uiLayerRoot > *')).filter(function(o){return o.getBoundingClientRect().width>0;}).map(function(o){return o.id||String(o.className).split(' ')[0];}).join(',');" +
        "window.__放置見張り.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class','style','hidden']});return true;})()";
      const 前 = {};
      for (const k of Object.keys(devices)) { await devices[k].ev(見張り); 前[k] = { 画面: await devices[k].screen(), ボタン: await W.ボタン一覧(devices[k]) }; }
      console.log('   …' + (ms / 1000) + '秒 何もしないで待つ');
      await sleep(ms);
      const 後 = {};
      for (const k of Object.keys(devices)) {
        const ログ = await devices[k].ev('window.__放置||[]');
        await devices[k].ev('(window.__放置見張り&&window.__放置見張り.disconnect(),true)');
        後[k] = { 画面: await devices[k].screen(), ボタン: await W.ボタン一覧(devices[k]), 起きたこと: ログ };
      }
      const rec = await W.手順を('全員', (名 || '結果') + '：' + Math.round(ms / 1000) + '秒 何もしない', '放置', null, { 間: 0 });
      rec.放置 = { 秒: ms / 1000, 前, 後 };
      return rec.放置;
    },

    /**
     * 結果の画面で、ボタンを1つ押して**どこへ行くか**を記録する（終わり方の表）。
     * 確認の幕（UiKit.confirm/danger）が出たら、その文を残して「やめる」側を押して戻る。
     * 画面が変わったら o.戻す(dev) で戻す（無ければ戻さない）。
     */
    async ボタンを試す(dev, re, o) {
      o = o || {};
      const 重なり式 = "Array.from(document.querySelectorAll('.overlay.show, .ui-layer')).filter(function(x){return x.getBoundingClientRect().width>0;}).map(function(x){return x.id||String(x.className).split(' ').slice(0,2).join('.');})";
      const 前 = await dev.screen();
      const 前の重なり = await dev.ev(重なり式);
      let 押したもの = null;
      const rec = await W.手順を(dev.name, '結果のボタンを試す：' + (o.名 || String(re)), '押す', async () => { 押したもの = await W.press(dev, re, o.範囲); }, { 間: o.間 || 1000, 失敗してよい: true });
      const 後 = await dev.screen();
      const 後の重なり = await dev.ev(重なり式);
      const 幕 = await dev.ev("(function(){var l=Array.from(document.querySelectorAll('.ui-layer')).filter(function(x){return x.getBoundingClientRect().width>0;}).pop(); if(!l) return null; var h=l.querySelector('.ui-head,.ui-popup-name'); var b=l.querySelector('.ui-body,.ui-scroll'); var acts=l.querySelectorAll('.ui-acts button'); return {確認: acts.length>=2, 見出し:h?h.innerText.trim():'', 本文:b?b.innerText.trim().replace(/\\s+/g,' ').slice(0,120):'', ボタン:Array.from(l.querySelectorAll('button')).map(function(x){return x.innerText.trim()||x.getAttribute('aria-label')||'';}).filter(Boolean)};})()");
      const 出た = 後の重なり.filter((x) => 前の重なり.indexOf(x) === -1);
      const 消えた = 前の重なり.filter((x) => 後の重なり.indexOf(x) === -1);
      const 行き先 = rec.失敗 ? '（押せなかった：' + rec.失敗 + '）'
        : (幕 && 出た.length) ? (幕.確認 ? '確認の幕' : '重なり') + '「' + 幕.見出し + '」' + (幕.本文 ? '：' + 幕.本文 : '') + ' ［' + 幕.ボタン.join('／') + '］'
        : 後 !== 前 ? '画面 ' + 後 + (出た.length ? '（重なり ' + 出た.join(',') + '）' : '')
        : 出た.length ? '重なり ' + 出た.join(',') + ' が出た'
        : 消えた.length ? '重なり ' + 消えた.join(',') + ' が閉じた（下の画面 ' + 後 + ' が見えた）'
        : '（見た目の変化なし）';
      const r = { 誰: dev.name, ボタン: 押したもの || String(re), 行き先, 確認あり: !!(幕 && 幕.確認 && 出た.length), 手順: rec.no };
      (W.終わり方.行き先 = W.終わり方.行き先 || []).push(r);
      console.log('   → 行き先：' + 行き先.slice(0, 100));
      if (幕 && 出た.length && o.確かめて進む !== true) {
        // 確認なら「やめる」側、ただの重なりなら「とじる」で戻す
        const ok = await W.pressIf(dev, /^(キャンセル|やめる|もどる|いいえ|とじない|このまま続ける|このまま|とじる|✕)$/, '.ui-layer button');
        if (!ok) await dev.ev("(function(){var x=Array.from(document.querySelectorAll('.ui-layer [data-ui=close], .ui-layer [data-ui=cancel]')).pop(); if(x) x.click(); return !!x;})()");
        await sleep(600);
      } else if (o.戻す) {
        try { await o.戻す(dev, 後); } catch (e) { r.戻せなかった = String(e.message); }
        await sleep(600);
      }
      return r;
    },

    /**
     * 指示64 D1：**大画面の出口は ⚙ の中**（TVの画面にはボタンを置かない）。
     * ⚙ を開いて、その行を「試す」（確認が出たら やめる）。済んだら ⚙ を閉じる。
     * re は行の字（/プレイヤーにもどる/ ・ /部屋を出る/）
     */
    async 大画面の歯車を試す(dev, re, o) {
      await W.手順を(dev.name, '⚙ を開く', '押す', () => W.click(dev, '#floatingGearBtn'), { 間: 700 });
      const r = await W.ボタンを試す(dev, re, Object.assign({ 範囲: '#setQuickMenu .set-row' }, o || {}));
      if (await dev.ev("!!document.querySelector('#settingsOverlay.show')")) {
        await W.手順を(dev.name, '⚙ を閉じる', '押す', () => W.click(dev, '#closeSettingsBtn'), { 間: 500 });
      }
      return r;
    },

    /**
     * 「部屋を出る」を試して出てしまった人が、**もう一度QRを読んで戻る**（試すの後始末）。
     * 戻れた道そのものも導線の一部なので、手順として残す
     */
    async 参加者が戻る() {
      const p = devices.参加者;
      await W.手順を('参加者', 'もう一度QRを読んで戻る', 'QRを読む', () => p.go(W.qrUrl), { 間: 1500 });
      if ((await p.screen()) === 'scr-rt-lobby') {
        const v = await p.ev("(document.getElementById('rtJoinName')||{}).value||''");
        await W.手順を('参加者', '名前を確かめて入る' + (v ? '（名前は覚えていた：' + v + '）' : ''), v ? '押す' : '入力して押す', async () => {
          if (!v) await W.type(p, '#rtJoinName', 'ひろ');
          await W.click(p, '#rtJoinBtn');
        }, { 待ち: { 種類: '通信待ち', 何を: '部屋', until: () => p.until("(document.querySelector('.screen.active')||{}).id!=='scr-rt-lobby'", 12000) }, 間: 900 });
      }
    },
    async 大画面が戻る() {
      const b = devices.大画面;
      if ((await b.screen()) === 'scr-rt-big') return;
      await W.手順を('大画面', '大画面：入口へ', '開く', async () => { await b.go(W.BASE + '/'); await W.扉を越える(b, true); }, { 待ち: { 種類: '演出待ち', 何を: '入口', until: () => b.until("['scr-entry','scr-shelf','scr-rt-big','scr-rt-room'].indexOf((document.querySelector('.screen.active')||{}).id)!==-1", 10000) } });
      if ((await b.screen()) === 'scr-entry') {
        await W.手順を('大画面', '入口：大画面として部屋に入る', '押す', () => W.click(b, '[data-entry="big"]'), { 間: 900 });
        if ((await b.screen()) === 'scr-rt-lobby') {
          await W.手順を('大画面', 'コードを入れて入る', '入力して押す', async () => {
            await W.type(b, '#rtJoinCode', W.code);
            const v = await b.ev("(document.getElementById('rtJoinName')||{}).value||''");
            if (!v) await W.type(b, '#rtJoinName', 'テレビ');
            await W.click(b, '#rtJoinBtn');
          }, { 待ち: { 種類: '通信待ち', 何を: '大画面', until: () => W.画面は(b, 'scr-rt-big', 12000) }, 間: 900 });
        }
      }
    },

    /**
     * 結果が出たあとの共通の調べ方（9カセットで同じ形にそろえる）。
     *   ① 3台の画面とボタンの一覧 → ② **何もしないで W.idleMs 待つ** → ③ o.試す()（ボタンの行き先）
     *   → ④ o.もう一回()（結果から次の試合の3-2-1まで。ここで数えた手順が「もう1回までの手順数」）
     */
    async 結果のあと(o) {
      const 画面 = {}, ボタン = {};
      for (const k of Object.keys(devices)) { 画面[k] = await devices[k].screen(); ボタン[k] = await W.ボタン一覧(devices[k]); }
      W.終わり方を('結果の画面', 画面);
      W.終わり方を('ボタン', ボタン);
      W.終わり方を('放置', await W.放置する(W.idleMs, '結果'));
      if (o.試す) await o.試す();
      const 始め = W.手順.length;
      if (o.もう一回) {
        try { await o.もう一回(); } catch (e) { W.終わり方を('もう1回の失敗', String(e.message)); throw e; }
      }
      const seg = W.手順.slice(始め);
      W.終わり方を('もう1回まで', {
        手順数: seg.filter((r) => r.する !== '待つ').length,
        押す回数: seg.reduce((a, r) => a + r.押す回数, 0),
        待ち秒: Math.round(seg.reduce((a, r) => a + r.待ちms, 0) / 100) / 10,
        誰が: seg.map((r) => r.no + ' ' + r.誰 + '：' + r.名)
      });
    },

    /** 終わり方の表の1行（台本が埋める） */
    終わり方を(k, v) { 終わり方[k] = v; },
    /** 何をえらんだか（理由つき） */
    モードを(名, なぜ) { W.モード = { 名, なぜ }; }
  };

  /** 端末を立てる。手渡し（1台を回す）の台本は ['進行役'] だけを渡す */
  W.始める = async (list) => {
    const want = list || ['進行役', '参加者', '大画面'];
    const b = await launch({ port: opts.cdp });
    W._b = b;
    if (want.indexOf('進行役') !== -1) devices.進行役 = await b.newDevice('進行役', { width: 375, height: 812, mobile: true, deviceScaleFactor: 2 });
    if (want.indexOf('参加者') !== -1) devices.参加者 = await b.newDevice('参加者', { width: 375, height: 667, mobile: true, deviceScaleFactor: 2 });
    if (want.indexOf('大画面') !== -1) devices.大画面 = await b.newDevice('大画面', { width: 1280, height: 720, mobile: false, deviceScaleFactor: 1 });
  };
  W.片付ける = async () => {
    if (W.bots) { try { W.bots.kill(); } catch (e) {} }
    if (W._b) await W._b.close();
  };
  W.書き出す = (extra) => {
    const エラー = {};
    Object.keys(devices).forEach((k) => { エラー[k] = devices[k].logs.slice(0, 30); });
    // bot数・bot不足：bot を入れなかった台本（手渡し）では null のまま
    const data = Object.assign({ カセット: opts.cassette, モード: W.モード, url: W.qrUrl, code: W.code,
      かかった秒: Math.round((Date.now() - t0) / 1000), bot数: W.bot数 == null ? null : W.bot数, bot不足: W.bot不足 == null ? null : W.bot不足,
      手順, 気づき, 終わり方, 画面のエラー: エラー, メモ: W.メモ書き }, extra || {});
    fs.writeFileSync(path.join(OUT, '記録.json'), JSON.stringify(data, null, 2));
    return data;
  };
  return W;
}

// ---- 走らせる ----
async function main() {
  const id = argv[0] && !argv[0].startsWith('--') ? argv[0] : null;
  if (!id) { console.error('カセットid を渡してください（例：node tools/flow-walk.js bakudan）'); process.exit(1); }
  const scenarioFile = path.join(__dirname, 'flow-walk', id + '.js');
  if (!fs.existsSync(scenarioFile)) { console.error('台本がありません：' + scenarioFile); process.exit(1); }
  const scenario = require(scenarioFile);
  const port = String(arg('port', '3001'));
  let base = arg('url', null);
  let server = null;
  if (!base) {
    base = 'http://localhost:' + port;
    // 自分で検証用サーバーを立てる（すでに立っていれば、それを使う）
    let up = false;
    try { up = (await fetch(base + '/')).ok; } catch (e) {}
    if (!up) {
      const log = fs.openSync(path.join(require('os').tmpdir(), 'flow-walk-server-' + port + '.log'), 'w');
      server = spawn(process.execPath, [path.join(__dirname, 'dev-server.js')], { env: Object.assign({}, process.env, { PORT: port }), stdio: ['ignore', log, log] });
      for (let i = 0; i < 60 && !up; i++) { await sleep(250); try { up = (await fetch(base + '/')).ok; } catch (e) {} }
      if (!up) throw new Error('検証用サーバーが立ちません（port ' + port + '）');
    }
  }
  const out = path.resolve(arg('out', path.join(ROOT, 'docs', '監査_審査会の指摘_画像', id)));
  fs.mkdirSync(out, { recursive: true });
  fs.readdirSync(out).filter((f) => /\.(png|jpg|json|log|html)$/.test(f)).forEach((f) => fs.unlinkSync(path.join(out, f)));
  const idle = parseInt(arg('idle', '60'), 10) * 1000;
  const W = makeWalk({ cassette: id, base, out, cdp: parseInt(arg('cdp', '9333'), 10) });
  W.idleMs = idle;
  let 失敗 = null;
  try {
    await W.始める(scenario.端末);
    await scenario.run(W);
  } catch (e) {
    失敗 = String(e && e.stack || e);
    console.error('失敗：' + 失敗);
  } finally {
    const data = W.書き出す({ 失敗, 遊び方: scenario.way || 'room' });
    await W.片付ける();
    if (server) { try { server.kill(); } catch (e) {} }
    try { await require('./flow-sheet').build(out, { port: parseInt(arg('cdp', '9333'), 10) + 50 }); } catch (e) { console.error('一覧の画像を作れませんでした：' + e.message); }
    console.log('手順 ' + data.手順.length + ' ／ 気づき ' + data.気づき.length + ' ／ ' + data.かかった秒 + '秒' + (失敗 ? ' ／ 途中で止まりました' : ''));
    process.exit(失敗 ? 1 : 0);
  }
}

module.exports = { makeWalk, 測る式 };
if (require.main === module) main();
