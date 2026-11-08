// tests/viewport-height.js — ページを画面より長くしない（指示75 1-1・11/7 の検査 A05・A13）
//
// **11/7、iPhone（iOS 26.5）と iPad（iOS 27.0.1）の Safari で、画面が切りかわったあと上が切れ、下にベージュの帯が出た。**
// クイズ解除ではライフ・時計・⚙ が見えなくなった。指でスクロールしても直らない。
// Android（Samsung Internet・411×758）の全359場面で、ページの高さ（scrollHeight 854）が見えている高さ（innerHeight 758）より
// **96px 長かった**。96px は、ブラウザの上と下のバーの高さ。
//
// 元は `body{min-height:100vh}`。スマホの 100vh は「バーを全部かくした時の高さ」（いちばん大きい画面）なので、
// バーが出ている間は、ページがバーの分だけ画面より長くなる。v2 の画面そのものは 100dvh（いま見えている高さ）で組んでいて、
// その下に body の背景（--paper のベージュ）が96px 余る。iOS の Safari はキーボードを閉じたあとなどにこの余りへスクロールし、
// 上が切れて下にベージュの帯が出る（Apple の開発者フォーラムの報告と同じ形）。
//
// **この差は、PC の Chrome（端末の大きさの真似）では出ない**——真似の画面にはバーが無く、100vh と innerHeight が同じになる。
// だから、測る道具（tools/fes-screen-walk.js）で「scrollHeight ≤ innerHeight」を見ても、壊れていても緑になる（落とし穴47）。
// ここは**CSS そのものを読む**：高さ（height・min-height・max-height）に 100vh を書いた規則は、同じ規則の中で、
// あとに dvh か svh の書き直しを持つこと（知らない古い端末は 100vh のまま読む・第27弾-2 の作法）。
'use strict';

const fs = require('fs');
const path = require('path');
const { createRunner, assert, assertEqual } = require('./harness');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
// <style> の中だけ（スクリプトの中の字は見ない）。コメントは消す（落とし穴45：コメントの中の字で赤・緑にしない）
const css = Array.from(html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)).map((m) => m[1]).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');

/** 規則（{ と } の間）ごとに、宣言を [プロパティ, 値] で */
function rules(text) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(text))) {
    const decls = m[2].split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
      const i = d.indexOf(':');
      return i === -1 ? null : [d.slice(0, i).trim(), d.slice(i + 1).trim()];
    }).filter(Boolean);
    out.push({ sel: m[1].trim().split('\n').pop().trim(), decls });
  }
  return out;
}

(async function main() {
  const r = createRunner('viewport-height：ページを画面より長くしない（指示75 1-1）');

  await r.test('高さに 100vh を書いた規則は、同じ規則の中で dvh か svh に書き直している（バーが出ている時に、ページが画面より長くならない）', () => {
    const bad = [];
    let seen = 0;
    rules(css).forEach((rule) => {
      rule.decls.forEach(([p, v], i) => {
        if (!/^(min-|max-)?height$/.test(p) || !/100vh/.test(v)) return;
        seen++;
        const fixed = rule.decls.slice(i + 1).some(([p2, v2]) => p2 === p && /\d+(dvh|svh)/.test(v2));
        if (!fixed) bad.push(rule.sel + ' { ' + p + ':' + v + ' }');
      });
    });
    assert(seen >= 5, '100vh の高さを見つけられている（' + seen + '）＝読み方が壊れていない');
    assert(!bad.length, '書き直しの無い 100vh：\n  ' + bad.join('\n  '));
  });

  await r.test('自己検査：わざと書き直しの無い 100vh を足すと、上の見張りが言う（落とし穴10-f）', () => {
    const fake = rules('.x{min-height:100vh;}.y{height:100vh;height:100dvh;}');
    const flagged = fake.filter((rule) => rule.decls.some(([p, v], i) => /^(min-|max-)?height$/.test(p) && /100vh/.test(v) &&
      !rule.decls.slice(i + 1).some(([p2, v2]) => p2 === p && /\d+(dvh|svh)/.test(v2))));
    assert(flagged.length === 1 && flagged[0].sel === '.x', '書き直しの無い .x だけを言う');
  });

  await r.test('body は、v2 の画面が出ている間、画面の高さより長くならない（html・body の高さを 100% に止め、はみ出しを隠す）', () => {
    assert(/html:has\(\.v2\.active\),body:has\(\.v2\.active\)\{[^}]*overflow:hidden/.test(css), 'v2 の画面の間は、html と body ではみ出しを隠す');
    assert(/html:has\(\.v2\.active\),body:has\(\.v2\.active\)\{[^}]*height:100%/.test(css), 'v2 の画面の間は、html と body の高さを 100%（画面の高さ）に止める');
  });

  // (c) 起きる条件を探す記録：画面が変わるたびに 高さ・位置 をこの端末にだけ残す（最近50件・送らない）。#vplog で係が見る
  await r.test('(c) 画面が変わるたびに、高さと位置をこの端末に残す（最近50件まで）。#vplog で一覧が出て、とじられる。どこにも送らない', async () => {
    const H = require('./harness');
    const { win, doc } = await H.launch({ url: 'http://localhost/?fes=1', fakeSocket: true, atEntry: true });
    for (let i = 0; i < 60; i++) win.goToScreen(i % 2 ? 'scr-v2-home' : 'scr-v2-fes-join');
    const log = JSON.parse(win.localStorage.getItem('acac-vplog') || '[]');
    assertEqual(log.length, 50, '最近50件だけ');
    const x = log[log.length - 1];
    ['t', 'why', 'scr', 'ih', 'vh', 'top', 'sy', 'sh'].forEach((k) => assert(k in x, '記録に ' + k));
    assert(/^screen/.test(x.why) && /^scr-v2-/.test(x.scr), '画面が変わった時の記録（' + x.why + ' ' + x.scr + '）');
    const sent = (win.__rtFake ? win.__rtFake.emits : []).filter((e) => JSON.stringify(e.payload || {}).indexOf('"sh"') !== -1);
    assertEqual(sent.length, 0, 'サーバーへは送らない');
    win.location.hash = '#vplog';
    win.dispatchEvent(new win.HashChangeEvent('hashchange'));
    await H.sleep(win, 30);
    const box = doc.getElementById('vpLogBox');
    assert(box && /画面の高さの記録/.test(box.textContent) && /scr-v2|v2-fes-join/.test(box.textContent), '#vplog で一覧が出る');
    box.querySelector('button').click();
    assert(!doc.getElementById('vpLogBox'), 'とじられる');
    win.close();
  });

  r.finish();
})();
