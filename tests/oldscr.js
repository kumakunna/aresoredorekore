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

  await r.test('68-0b C19：/tv（TV として入る）は、横に広い画面では TV の大きさの形（字は 42px 以上）', async () => {
    const t = await launch({ url: 'http://localhost/?tv=1', fakeSocket: true });
    await waitFor(t.win, () => t.doc.querySelector('.screen.active') && t.doc.querySelector('.screen.active').id === 'scr-v2-join', 4000, 'TV として入る画面');
    assert(t.doc.getElementById('scr-v2-join').classList.contains('is-tvjoin'), 'TV として入る印（is-tvjoin）');
    t.win.close();
    const m = /@media \(min-width:900px\) and \(min-aspect-ratio:4\/3\)\{([\s\S]*?)\n  \}/.exec(HTML);
    assert(m && /\.screen\.v2\.is-tvjoin/.test(m[1]), '横に広い画面の時だけの決まりがある');
    const 大きさ = (m[1].match(/font-size:(\d+)px/g) || []).map((x) => +x.replace(/\D/g, ''));
    assert(大きさ.length >= 5 && 大きさ.every((x) => x >= 42), 'TV の字はどれも 42px 以上（' + 大きさ.join(',') + '）');
  });

  await r.test('68-0b C21：今までの見た目の画面の見出しは ← の丸のぶん右へ・「不正解」の知らせは時計の下（tools/aresore-walk.js で重なり0）', async () => {
    assert(/\.screen:not\(\.v2\) > \.wiz-head, \.screen:not\(\.v2\) > \.scr-title\{padding-left:40px;\}/.test(HTML), '見出しを ← の丸のぶん右へ（タグで縛らない・tests/ui-kit.js）');
    assert(/\.foul-toast\{\s*position:fixed;top:100px;/.test(HTML), '知らせは時計の下（top:100px）');
    assert(!/棚にもどる</.test(HTML), '無くなった棚へ「もどる」と書いたボタンが無い');
  });

  await r.test('68-0b C15：部屋の知らせ・たずねる文は ui-text.js（HOME.部屋の知らせ）だけに書く。index.html に同じ字をじかに書かない', async () => {
    const U = require('../public/js/ui-text.js');
    const 知らせ = U.HOME.部屋の知らせ;
    assert(知らせ && Object.keys(知らせ).length >= 17, '部屋の知らせが17種ある（' + Object.keys(知らせ || {}).length + '）');
    const じか = Object.keys(知らせ).filter((k) => HTML.indexOf("'" + 知らせ[k] + "'") !== -1 || HTML.indexOf('"' + 知らせ[k] + '"') !== -1);
    assertEqual(じか.join('・'), '', 'index.html にじかに書いた知らせが無い');
    assert((HTML.match(/UiText\.HOME\.部屋の知らせ\./g) || []).length >= 30, 'index.html は ui-text の名前で呼ぶ（新しい画面のつなぎと今までの部屋の画面の両方）');
  });

  r.finish();
  process.exit(0);
})();
