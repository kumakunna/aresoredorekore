// tests/tools-guard.js — 検証の道具そのものの見張り（指示68-0b）
//
// 画面の門（check.js 0件）は道具を信じて決める。道具が黙って壊れたり、毎回ちがう絵を撮ったりすると、門ごと信じられなくなる。
//   K4：見本データの場面は、何回作っても同じ（乱数に種を決めた・tools/v2-lab/serve.js）
//   K10：古い入口（棚・「大画面として部屋に入る」）を押す道具は、黙って壊れずに「新しい入口に合わせていません」と言う（tools/cdp.js）
// 物差し（check.js の K1・K2・K5・K6・K7）が効くかは、実ブラウザでしか測れないので tools/v2-shot.js が毎回自分で確かめる（K9）

const { createRunner, assert, assertEqual } = require('./harness');
const { 古い入口なら } = require('../tools/cdp');
const { labHtml } = require('../tools/v2-lab/serve');

(async function main() {
  const r = createRunner('tools-guard：検証の道具の見張り（指示68-0b）');

  await r.test('K10：古い入口の目印で失敗したら、道具の名前を言って止まる。新しい入口の失敗はそのまま', async () => {
    const もと = new Error('進行役：押すものが見つかりません #rtPickGameBtn');
    const e = 古い入口なら(もと, '#rtPickGameBtn');
    assert(e.古い入口 === true, '古い入口の印が付く');
    assert(/新しい入口に合わせていません（.+）/.test(e.message), '「新しい入口に合わせていません（道具）」と言う：' + e.message);
    assert(e.message.indexOf(もと.message) !== -1, 'もとの失敗も残す');
    ['[data-entry="choose"]', "(document.querySelector('.screen.active')||{}).id==='scr-shelf'", '.cart[data-cart="bakudan"]', '#rtJoinName'].forEach((w) =>
      assert(古い入口なら(new Error('x'), w).古い入口, '古い入口として見分ける：' + w));
    const 新 = new Error('進行役：押すものが見つかりません #scr-v2-room [data-home-act="room-pick"]');
    assertEqual(古い入口なら(新, '#scr-v2-room [data-home-act="room-pick"]'), 新, '新しい入口の失敗は、そのまま返す');
  });

  await r.test('K4：見本データの場面は、何回作っても同じ問題・同じ並び（文化祭のクイズ解除の途中）', async () => {
    const 中身 = () => {
      const html = labHtml({ scene: 'fes2-play' });
      const m = /window\.__V2LAB_VIEW=(.*?);Math\.random=/.exec(html);
      assert(m, '見本データが差し込まれている');
      const v = JSON.parse(m[1]);
      // のこり時間・時刻は作った瞬間の時計で変わる（重い時は 1ms ずれて赤くなった）。乱数で決まる所だけを比べる
      return JSON.stringify(v.secret, (k, x) => (/remaining|endsAt|At$|Ms$/.test(k) ? undefined : x));
    };
    const a = 中身(), b = 中身();
    assert(a.length > 20, '自分の問題が入っている');
    assertEqual(a, b, '2回作っても同じ問題');
    assert(/Math\.random=\(function 乱数/.test(labHtml({ scene: 'fes2-play' })), 'ページの中の乱数にも種を決める');
  });

  r.finish();
})();
