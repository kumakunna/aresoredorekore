// tools/measure-catalog.js — 部品カタログの崩れを測る（第39弾 門A1〜A3・B4）
//
// **これは npm test に入っていない。手で回す。**
// jsdom にはレイアウトが無く、この作業場にはヘッドレスブラウザも入っていないので、
// 「はみ出し・重なり・文字の切れ」は本物のブラウザでしか測れない。
//
// ただし**手で回す検査は、時間が経つと誰も回さなくなる。**
// そこで「回した時に、そもそも全部を見ているか」（部品・テーマ・サイズの網羅）だけは
// tests/ui-kit.js が機械で見張っている。ここが緑なら、下の計測は全組み合わせを通る。
//
// ── 回し方 ────────────────────────────────
//   1. サーバーを立てる（.claude/launch.json の aresore-dev）
//   2. ブラウザで  http://localhost:3001/?catalog=1  を開く
//   3. 端末の幅を 375×667 と 375×812 にする
//   4. 開発者ツールのコンソールに、下の SNIPPET を貼って実行する
//   5. 返ってきた表に「崩れ」が1つも無いことを確かめる
//
// ── いつ回すか ─────────────────────────────
//   docs/デザインの正本.md の **1（色）・2（書体）・3（余白と形）を変えた時**。
//   部品を足した時。新しいテーマを足した時。
//   （何も変えていないなら回さなくてよい。回さないと腐るのは網羅の方で、
//     そちらは上に書いたとおり機械が見張っている）

const SNIPPET = `
(async () => {
  const w = ms => new Promise(r => setTimeout(r, ms));
  // 崩れの見方は3つ。**3つ目を忘れると、黙って切れている箱を素通りする**
  // 横に送れる箱の中身は、外へ出ていて当たり前。**そこを崩れと数えない**
  const inScroller = (e) => {
    for (let p = e.parentElement; p && p.id !== 'scr-catalog'; p = p.parentElement) {
      const o = getComputedStyle(p).overflowX;
      if (o === 'auto' || o === 'scroll') return true;
    }
    return false;
  };
  const measure = () => {
    const scr = document.getElementById('scr-catalog');
    const box = scr.getBoundingClientRect();
    const out = [];
    scr.querySelectorAll('*').forEach(e => {
      const r = e.getBoundingClientRect(); if (r.width === 0) return;
      const cs = getComputedStyle(e);
      const oR = Math.round(r.right - box.right), oL = Math.round(box.left - r.left);
      if ((oR > 1 || oL > 1) && !inScroller(e))
        out.push((e.id||e.className||'').slice(0,20) + ' はみ出し 右' + oR + ' 左' + oL);
      const clipped = e.scrollWidth - e.clientWidth;
      if (clipped > 1 && !['auto','scroll'].includes(cs.overflowX)) {
        out.push((e.id||e.className||'').slice(0,20) +
          (cs.overflowX === 'visible' ? ' 中身がはみ出し +' : ' 文字が切れ +') + clipped +
          '（' + (e.textContent||'').trim().slice(0,12) + '）');
      }
    });
    return out;
  };
  const themes = window.CAT_THEMES.map(t => t.id);
  const sizes = ['small', '', 'large'];
  const res = {};
  for (const t of themes) for (const s of sizes) {
    window.catalogSet(t, s); await w(90);
    const bad = measure();
    if (bad.length) res[(t||'共通') + '/' + (s||'標準')] = bad;
  }
  window.catalogSet('', '');
  console.log('画面の幅:', document.getElementById('scr-catalog').getBoundingClientRect().width);
  console.log('見た組み合わせ:', themes.length * sizes.length);
  console.log('崩れた組み合わせ:', Object.keys(res).length);
  console.table ? console.table(res) : console.log(res);
  return res;
})();
`;

// 測り方そのものが正しいか、その場で確かめるための一節。
// **わざと崩したものを入れて、3種類とも捕まえられることを見てから使う。**
// （最初、文字の切れを text-overflow:ellipsis の時だけ見る形にしていて、
//   「…」を出さずに黙って切っている箱を素通りしていた）
const SELFTEST = `
(() => {
  const box = document.getElementById('catType');
  const wide = document.createElement('div');
  wide.style.cssText = 'width:600px;height:8px;';
  box.appendChild(wide);
  const cut = document.createElement('div');
  cut.style.cssText = 'width:60px;overflow:hidden;white-space:nowrap;';
  cut.textContent = 'とても長い文字列がここに入っていて切られる';
  box.appendChild(cut);
  console.log('※ ここで「はみ出し」と「文字が切れ」の両方が出れば、測り方は効いています');
})();
`;

if (require.main === module) {
  console.log(__filename.replace(/\\\\/g, '/'));
  console.log('');
  console.log('【回し方】');
  console.log(' 1. サーバーを立てて http://localhost:3001/?catalog=1 を開く');
  console.log(' 2. 幅を 375×667 と 375×812 にする');
  console.log(' 3. コンソールに下の SNIPPET を貼る');
  console.log(' 4. 「崩れた組み合わせ: 0」を確かめる');
  console.log('');
  console.log('--- まず測り方が効くか（わざと崩す） ---');
  console.log(SELFTEST);
  console.log('--- 本番 ---');
  console.log(SNIPPET);
}

module.exports = { SNIPPET, SELFTEST };
