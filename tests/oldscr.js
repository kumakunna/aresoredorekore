// tests/oldscr.js — ログイン・新しく登録・称号・名前を変えるを、新しい見た目の箱で着せ直した（指示71-7・68-7 の2・68-0b C23）
//
// 流れと部品（id・JS が付ける印）は変えない。見た目は .v2.v2-oldscr の中の CSS だけ。写真と check.js は tools/oldscr-shot.js
// （3つの形とも0件）。ここでは、その約束が崩れていないか（箱の印・まちがえた時の言葉・無くなった「棚」を言わない）を見る
const fs = require('fs');
const path = require('path');
const { createRunner, assert, assertEqual, launch, waitFor, sleep } = require('./harness');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

(async function main() {
  const r = createRunner('oldscr：ログイン・称号・名前を変えるを新しい見た目に（指示71-7）');

  await r.test('3つの画面は新しい見た目の箱（.v2.v2-w-wait.v2-oldscr）。id はそのまま', async () => {
    const { win, doc } = await launch({});
    ['scr-login', 'scr-titles', 'scr-rename'].forEach((id) => {
      const s = doc.getElementById(id);
      assert(s, id + ' がある');
      ['screen', 'v2', 'v2-w-wait', 'v2-oldscr'].forEach((c) => assert(s.classList.contains(c), id + ' に ' + c));
    });
    // 部品はそのまま（JS がつかむ id）
    ['loginUsername', 'loginPassword', 'regUsername', 'regPassword', 'regCode', 'loginError', 'loginSubmitBtn', 'loginToggleBtn', 'loginJoinRoomBtn', 'loginBrowseBtn', 'loginBackBtn',
      'profOwned', 'profIconBtn', 'profNameBtn', 'renameInput', 'renameBtn'].forEach((id) => assert(doc.getElementById(id), id + ' がある'));
    win.close();
  });

  await r.test('まちがえた時は、赤い字で責めず、何をすればいいかを言う（空の時は札を出さない）', async () => {
    assert(/\.v2\.v2-oldscr \.serial-error\{[^}]*color:var\(--wi\)/.test(HTML), 'まちがえた時の札は、ふつうの字の色（赤で責めない）');
    assert(/\.v2\.v2-oldscr \.serial-error:empty\{display:none;\}/.test(HTML), '空の時は札を出さない');
    const 言葉 = ['登録コード（合言葉）がちがうようです。係の人にたずねてね', 'ユーザー名と、6文字以上のパスワードを入れてね',
      'そのユーザー名は、もう使われています。ほかの名前にしてね', 'ユーザー名かパスワードがちがうようです。もう一度たしかめてね'];
    言葉.forEach((x) => assert(SERVER.indexOf("'" + x + "'") !== -1, 'サーバーの言葉：' + x));
    assert(!/違います'/.test(SERVER), '「違います」で終わる言葉が残っていない');
  });

  await r.test('無くなった「棚」を言わない（名前を変える・ログインせずに見る）', async () => {
    const { win, doc } = await launch({});
    const lead = doc.querySelector('#scr-rename .wiz-lead').textContent;
    assert(lead.indexOf('棚') === -1 && lead.indexOf('称号の画面') !== -1, '名前を変えるの説明（' + lead + '）');
    assertEqual(win.UiText.ENTRY.見るだけ, 'ログインせずにゲームを見る', 'ログインの画面の「見るだけ」');
    win.close();
  });

  r.finish();
  process.exit(0);
})();
