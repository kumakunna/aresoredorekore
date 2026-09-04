// tests/safety-rules.js — 安全基準と、表示している約束（第39弾 門A8・A9）
//
// docs/デザインの正本.md 6 の安全基準を、CSSとコードから機械で見る。
// 「点滅は1秒に3回まで」「揺れは0.2秒・1回」「赤は縁のみ」——
// **書いてあるだけで守られない決まりは、書いていないのと同じ。**

const fs = require('fs');
const path = require('path');
const { createRunner, assert, assertEqual } = require('./harness');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const CSS = HTML.slice(HTML.indexOf('<style>') + 7, HTML.indexOf('</style>'))
  .replace(/\/\*[\s\S]*?\*\//g, '');
const FX = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'fx.js'), 'utf8');

/** アニメーションの指定から「長さ・回数」を拾う */
function animations() {
  const out = [];
  const re = /animation:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(CSS))) {
    const v = m[1];
    const sec = (v.match(/([0-9.]+)s/g) || []).map((x) => parseFloat(x));
    const infinite = /infinite/.test(v);
    const count = (v.match(/\s(\d+)(\s|$)/) || [])[1];
    out.push({ 指定: v.trim(), 秒: sec, 無限: infinite, 回数: count ? parseInt(count, 10) : 1 });
  }
  return out;
}

(async function main() {
  const r = createRunner('safety-rules：安全基準と、表示している約束（第39弾）');

  await r.test('揺れは0.2秒・1回まで（正本6）', async () => {
    // 前庭系に響くのは「長い揺れ」と「繰り返す揺れ」。
    // 1回で短ければ、衝撃としては伝わっても体調には響きにくい
    const 揺れ = CSS.match(/\.fx-shake[a-z-]*\{[^}]*\}/g) || [];
    assert(揺れ.length >= 2, '揺れの指定がある（実際:' + 揺れ.length + '件）');  // 型(b)
    揺れ.forEach((rule) => {
      const sec = (rule.match(/([0-9.]+)s/) || [])[1];
      if (!sec) return;
      assert(parseFloat(sec) <= 0.2,
        '揺れは0.2秒まで（実際: ' + sec + 's ／ ' + rule.slice(0, 40) + '）');
      assert(!/infinite/.test(rule), '揺れは繰り返さない');
    });
    // 止める道もある（設定で切れる）
    assert(/no-shake/.test(CSS), '「画面の揺れをつかう」を切ると止まる');
  });

  await r.test('点滅は1秒に3回まで。全画面の明滅は1回だけ（正本6）', async () => {
    // 光の点滅が発作を誘発しうるのは**速さ**の問題で、繰り返すこと自体ではない。
    // 最初この検査を「繰り返す明滅を1つも置かない」と書いたが、
    // それは正本より厳しく、1.2秒周期の淡い文字（AIの待機表示）まで
    // 消させることになっていた。**正本が言っているのは回数の上限。**
    const 明滅 = animations().filter((a) => a.無限 && /blink|flash|pulse|glow/i.test(a.指定));
    assert(明滅.length > 0, '繰り返す明滅がある（実際:' + 明滅.length + '件）');  // 型(b)
    明滅.forEach((a) => {
      const 周期 = a.秒[0];
      assert(周期 > 0, '周期が読める（' + a.指定 + '）');
      const 毎秒 = Math.round((1 / 周期) * 100) / 100;
      assert(毎秒 <= 3,
        '1秒に3回まで（' + a.指定.slice(0, 40) + ' は毎秒' + 毎秒 + '回）');
    });

    // **全画面**の明滅だけは、繰り返さない（1回きり）
    ['\\.fx-flash', '\\.flash-overlay'].forEach((sel) => {
      const m = CSS.match(new RegExp(sel + '\\{[^}]*\\}'));
      assert(m, sel + ' の指定がある');
      assert(!/infinite/.test(m[0]), sel + '：全画面の明滅は繰り返さない');
    });
    assert(/no-flash|fxFlash|can\.flash/.test(CSS + FX), '「光の点滅をつかう」を切ると止まる');
  });

  await r.test('赤は縁のみ。面で塗らない（正本6）', async () => {
    // 赤い面は、それだけで「叱られている」に見える。
    // 原則C（責める時は静かに）と同じ理由で、赤は輪郭にとどめる
    const 危険 = CSS.match(/\.ui-dialog-in\.is-danger\{[^}]*\}/);
    assert(危険, '取り返しがつかないダイアログの指定がある');
    assert(/border/.test(危険[0]), '赤は縁で出す');
    assert(!/background:\s*var\(--stamp\)/.test(危険[0]), '赤の面で塗らない');
  });

  await r.test('初回起動で自衛できる（正本6）', async () => {
    // 「光の点滅」「画面の揺れ」を、遊び始める前にその場で切れること。
    // あとから設定に潜って探すのでは、最初の1回に間に合わない
    assert(/maybeShowSafetyGate/.test(HTML), '初回の案内がある');
    assert(/sgFlashBtn/.test(HTML) && /sgShakeBtn/.test(HTML),
      '光の点滅と画面の揺れを、その場で切れる');
  });

  await r.test('表示している約束が、本当のことになっている（門A8）', async () => {
    // 画面に「〜します」と書いてあることが、実装と食い違っていないか。
    // 第38弾で、決めても効かない設定（はじめのチップ・救済）を画面に出していた——
    // **決めたのに効かない**のは、嘘を表示しているのと同じ（落とし穴21）
    const 約束 = [
      {
        言っていること: '設定で決められるのは、ラウンド数と下見の長さだけ',
        画面に出ている: /auRoundsSlider/.test(HTML) && /auPreviewSlider/.test(HTML),
        効いている: /previewSec:\s*c\.previewSec/.test(HTML) && /rounds:\s*c\.rounds/.test(HTML),
        消えている: !/auChipsSlider|auRescueToggle/.test(HTML)
      },
      {
        言っていること: '文字サイズの設定が、見出し・本文・ボタンに効く',
        画面に出ている: /setFont/.test(HTML),
        効いている: /fs-small/.test(HTML) && /fs-large/.test(HTML) && /var\(--fs-title\)/.test(HTML),
        消えている: true
      },
      {
        言っていること: '時間の見せ方の3択（いつも／見たい時／出さない）',
        画面に出ている: /timerView/.test(HTML),
        効いている: /data-timer-view/.test(HTML),
        消えている: true
      }
    ];
    約束.forEach((p) => {
      assert(p.画面に出ている, p.言っていること + '：画面に出ている');
      assert(p.効いている, p.言っていること + '：**実際に効いている**');
      assert(p.消えている, p.言っていること + '：効かない設定が残っていない');
    });
  });

  r.finish();
})();
