// tests/ui-text.js — 共通の言い回しと、標準ダイアログの全廃（第39弾 2-3・2-5）
//
// **「0件になった」だけでは足りない。**
// 全部を info に潰しても 0件にはなるので、
// 「どの場面が、どの種類で出るか」まで台帳と突き合わせる。

const fs = require('fs');
const path = require('path');
const { createRunner, assert, assertEqual } = require('./harness');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const UiText = require('../public/js/ui-text');

/**
 * 置換の台帳（docs/監査_標準ダイアログ置換.md の一覧と同じもの）。
 * **場面を表す語**と、そこで出るべき種類の対。
 * 行番号ではなく文言で照らすので、コードが上下に動いても腐らない。
 */
const SITES = [
  { 何: '手渡しへ切り替える（進行役）', 探す: '部屋を閉じて、1台のスマホで遊びますか？', 種類: 'danger' },
  { 何: '手渡しへ切り替える（参加者）', 探す: '部屋を抜けて、1台のスマホで遊びますか？', 種類: 'confirm' },
  { 何: 'ゲームをえらび直す', 探す: 'ゲームをえらび直しますか？', 種類: 'confirm' },
  { 何: '進行役をゆずる', 探す: '進行役をゆずりますか？', 種類: 'confirm' },
  { 何: '大画面にする', 探す: '大画面にしますか？', 種類: 'confirm' },
  { 何: '人を部屋から出す（名簿）', 探す: 'さんを部屋から出しますか？', 種類: 'danger' },
  { 何: '人を部屋から出す（設定）', 探す: 'この人を部屋から出しますか？', 種類: 'danger' },
  { 何: '部屋を閉じる', 探す: '部屋を閉じますか？', 種類: 'danger' },
  { 何: '部屋を解散する', 探す: '部屋を解散しますか？', 種類: 'danger' },
  { 何: '鑑定眼を使う', 探す: 'この品を鑑定しますか？', 種類: 'confirm' },
  { 何: '入札の額を入れる', 探す: 'いくらで出しますか？', 種類: 'ask' },
  { 何: '部屋がもう無い', 探す: '部屋がなくなっていました', 種類: 'info' },
  { 何: 'ゲームが終了した', 探す: 'ゲームが終了しました', 種類: 'info' },
  { 何: '部屋から出された', 探す: '部屋から出ました', 種類: 'info' },
  { 何: 'アルバムにまとめる', 探す: 'みんなの写真をまとめますか？', 種類: 'confirm' },
  { 何: '写真を箱から出す', 探す: '自分の写真を箱から出しますか？', 種類: 'confirm' },
  { 何: 'アルバムを消す', 探す: 'アルバムは保存できましたか？', 種類: 'danger' },
  { 何: 'つぎはメンバーを入力しなおすか', 探す: 'メンバーを入力しなおしますか？', 種類: 'confirm' },
  { 何: '部屋を出る', 探す: '部屋を出ますか？', 種類: 'confirm' },
  { 何: 'ゲームを終了する', 探す: 'いまのゲームを終了しますか？', 種類: 'confirm' },
  { 何: '終了できなかった', 探す: '終了できませんでした', 種類: 'info' },
  { 何: '部屋から抜ける', 探す: 'この部屋から抜けますか？', 種類: 'confirm' },
  { 何: 'できなかった知らせ', 探す: 'できませんでした', 種類: 'info' },
  { 何: '途中は人を変えられない', 探す: 'いまは人を変えられません', 種類: 'info' },
  { 何: 'プレイヤーを削除', 探す: 'この人たちを削除しますか？', 種類: 'danger' },
  { 何: 'プレイヤーを更新した', 探す: 'プレイヤーを更新しました', 種類: 'toast' },
  { 何: 'お題を追加できなかった', 探す: 'お題を追加できませんでした', 種類: 'info' },
  { 何: '削除できなかった', 探す: '削除できませんでした', 種類: 'info' },
  { 何: 'すべて削除', 探す: 'すべて削除して最初からはじめますか？', 種類: 'danger' },
  { 何: 'ログアウト', 探す: 'ログアウトしますか？', 種類: 'confirm' }
];

/**
 * UiKit の呼び出しを、**1件ずつ区切って**拾う。
 *
 * 手前へさかのぼる形にしていたら、直前にある別の呼び出しを拾って
 * 「info のはずが danger」と誤って報告した。呼び出しの範囲は
 * 「その呼び出しから、次の呼び出しまで」で区切るのが正しい
 */
const CALLS = (function () {
  const out = [];
  const re = /UiKit\.(confirm|danger|info|ask|toast|sheet|popup)\(/g;
  let m;
  while ((m = re.exec(HTML))) {
    // **括弧の対応で、その呼び出しの中身ちょうどを取る。**
    // 「次の呼び出しまで」や「300文字」で区切っていた頃は、
    // 呼び出しの外にある同じ文言（画面に直接入れている文字列など）まで拾って、
    // 「info のはずが danger」と誤って報告した
    let depth = 1;
    let i = re.lastIndex;
    while (i < HTML.length && depth > 0) {
      const c = HTML[i];
      if (c === '(') depth++;
      else if (c === ')') depth--;
      i++;
    }
    out.push({ kind: m[1], head: HTML.slice(re.lastIndex, i - 1) });
  }
  return out;
})();

/** その文言が、どの UiKit の入口から出ているか調べる */
function kindOf(mark) {
  const hit = CALLS.filter((c) => c.head.indexOf(mark) >= 0);
  if (!hit.length) return null;
  // 同じ文言が複数の呼び出しから出ることはある（部屋を閉じるは3か所）。
  // その場合、種類が食い違っていないことまで確かめる
  const kinds = Array.from(new Set(hit.map((c) => c.kind)));
  return kinds.length === 1 ? kinds[0] : kinds.join('と');
}

(async function main() {
  const r = createRunner('ui-text：共通の言い回しと、標準ダイアログの全廃（第39弾）');

  await r.test('ブラウザ標準の confirm / alert / prompt が0件', async () => {
    // 書けば赤くなる。これが再発防止の本体
    const bad = [];
    HTML.split('\n').forEach((l, i) => {
      if (/\b(confirm|alert|prompt)\s*\(/.test(l) && l.indexOf('UiKit') === -1) {
        bad.push((i + 1) + ': ' + l.trim().slice(0, 70));
      }
    });
    assertEqual(bad.join('\n       '), '', 'ブラウザ標準のダイアログが残っている');
  });

  await r.test('置換した全箇所が、台帳どおりの種類で出る（数だけでは足りない）', async () => {
    // **0件になったことだけを見ると、全部を info に潰しても通ってしまう。**
    // 取り返しがつかない操作が「はい/OK」の軽い顔で出るのが、いちばん危ない
    const bad = [];
    SITES.forEach((s) => {
      const got = kindOf(s.探す);
      if (got === null) bad.push(s.何 + '：文言が見つからない（「' + s.探す + '」）');
      else if (got !== s.種類) bad.push(s.何 + '：' + s.種類 + ' のはずが ' + got);
    });
    assertEqual(bad.join('\n       '), '', '台帳と食い違う場面');
    assert(SITES.length >= 30, '台帳の件数（実際:' + SITES.length + '）');
  });

  await r.test('取り返しがつかない場面が、ちゃんと danger になっている', async () => {
    // 台帳を書き換えれば上の検査は通ってしまうので、
    // **「全員が終わる」「元にもどせない」と書いてある場面**を別口で数える
    const dangers = SITES.filter((s) => s.種類 === 'danger');
    assert(dangers.length >= 7, '取り返しがつかない場面が数えられている（実際:' + dangers.length + '）');
    dangers.forEach((s) => {
      const i = HTML.indexOf(s.探す);
      const around = HTML.slice(i, i + 300);
      assert(/全員が終わ|元にもどせ|そこで終わ|すべての写真を消/.test(around),
        s.何 + '：何が起きるかが本文に書いてある');
    });
  });

  await r.test('共通ボタンの語が、正本のとおりに1か所で決まっている', async () => {
    const w = UiText.WORDS;
    assertEqual(w.close, 'とじる', '閉じるは「とじる」');
    assertEqual(w.back, 'もどる', '戻るは「もどる」');
    assertEqual(w.start, 'はじめる', '開始は「はじめる」');
    assertEqual(w.cancel, 'キャンセル', 'ダイアログの逃げ道');
    assertEqual(w.ready, '準備OK', 'ルールを読み終えた');
    assert(Object.keys(w).length >= 9, '共通の語が揃っている');
  });

  await r.test('言い換えの見張りが、正本と食い違っていない', async () => {
    // BANNED に「正本の語」として書いたものが、WORDS に実在すること。
    // ここが食い違うと、「直せ」と言っている先が存在しない
    const values = Object.keys(UiText.WORDS).map((k) => UiText.WORDS[k]);
    UiText.BANNED.forEach((b) => {
      assert(values.indexOf(b.正本) >= 0,
        '「' + b.見つけたら + '」の直し先「' + b.正本 + '」が共通の語にある');
    });
  });

  r.finish();
})();
