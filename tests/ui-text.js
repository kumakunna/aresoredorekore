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
 * 見た目の指定とコメントを落とす。コメントの中の語を「画面に出ている」と誤って数えないため。
 * **落とすが、行はずらさない。**改行の数を保って空にする——
 * 詰めてしまうと、報告した行番号が実ファイルとずれて、
 * 直しに行った先がまったく別の場所になる（実際に8件ぶん見当外れの行を指した）
 */
function strip(src) {
  const blank = (s) => s.replace(/[^\n]/g, '');
  return src
    .replace(/<style[\s\S]*?<\/style>/g, blank)
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    // **`\s` は改行も食う。**`^\s*//` と書くと、空行をまたいで
    // 次の行のコメントに届き、あいだの改行ごと消える（251行ぶんずれた）
    .replace(/^[^\S\n]*\/\/.*$/gm, '');
}

/** ボタンの札が書かれている場所。**画面を組んでいるのは index.html だけではない** */
const SOURCES_FOR_LABEL = ['public/index.html', 'public/js/ui.js'].map((f) => ({
  file: f,
  text: fs.readFileSync(path.join(__dirname, '..', f), 'utf8')
}));

/**
 * 文言を掃く対象（第40弾）。画面に文字を出しうるファイル全部。
 * **ui-text.js だけは外す**——そこは台帳そのもので、
 * 「直す前の言い方」が直し方の説明として載っている。
 * 外さないと、自分の一覧を違反として数えてしまう（第39弾で踏んだ形）
 */
const SOURCES = ['public/index.html'].concat(
  fs.readdirSync(path.join(__dirname, '..', 'public', 'js'))
    .filter((f) => f.endsWith('.js') && f !== 'ui-text.js')
    .map((f) => 'public/js/' + f)
).map((f) => ({ file: f, text: fs.readFileSync(path.join(__dirname, '..', f), 'utf8') }));

/**
 * 画面に出る文言を、**2つの層から**集める（第40弾）。
 *
 * ① JSの文字列（`'…'`）  ② HTMLに直接書かれた地の文
 *
 * **②を見ていなかった。** 「全角数字0件」の検査が緑だったのは、
 * 実際に無かったからではなく**マークアップを一度も見ていなかったから**。
 * 実機で画面を読んで初めて「🥊 スマホを２人の間へ」が見つかった
 * （落とし穴10-b・12）。494件がまるごと検査の外にあった。
 */
function 画面の文言() {
  const out = [];
  const 日本語 = /[ぁ-んァ-ヶ一-龠]/;
  const blank = (x) => x.replace(/[^\n]/g, '');
  SOURCES.forEach((src) => {
    // ① JSの文字列
    strip(src.text).split('\n').forEach((line, i) => {
      let m;
      const re = /'([^'\\\n]{2,140})'/g;
      while ((m = re.exec(line))) {
        if (日本語.test(m[1])) out.push({ 場所: src.file + ':' + (i + 1), t: m[1], 層: 'JS' });
      }
    });
    // ② HTMLに直接書かれた地の文（タグの外）
    if (!/\.html$/.test(src.file)) return;
    src.text
      .replace(/<style[\s\S]*?<\/style>/g, blank)
      .replace(/<script[\s\S]*?<\/script>/g, blank)
      .replace(/<!--[\s\S]*?-->/g, blank)
      // **`<br>` は文を切らない。**外さずに拾うと、1つの文の後半だけが
      // 「短い案内」に見える（「…揺れを<br>使った演出が含まれます。」の後半）
      .replace(/<br\s*\/?>/g, '')
      .split('\n').forEach((line, i) => {
        line.replace(/>([^<>]+)</g, (m, t) => {
          const x = t.trim();
          if (x.length >= 2 && 日本語.test(x)) {
            out.push({ 場所: src.file + ':' + (i + 1), t: x, 層: 'HTML' });
          }
          return m;
        });
      });
  });
  return out;
}

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

  await r.test('画面に出るボタンの札が、言い換えの見張りに引っかからない（門A7）', async () => {
    // **台帳を書いただけでは、誰も見張っていない。**
    // BANNED は「見つけたら直す」と言っているのに、
    // これまで一度も画面を掃いていなかった。掃いたら6件出た。
    //
    // 掃く先は**ボタンの札**に絞る。地の文まで巻き込むと、
    // 「『参加する』を選びました」のような**札を引用しているだけの文**や、
    // 意味の違う場面まで一律に書き換えることになる（落とし穴9）。
    const 例外 = [{
      場所: 'dfConsentYes',
      札: '参加する',
      理由: '部屋に入る話ではなく、体を使う遊びに加わるかの同意。' +
            'ここを「入る」にすると、断る側の「参加しない」と対にならない'
    }];

    const 見つけた = [];
    SOURCES_FOR_LABEL.forEach((src) => {
      strip(src.text).split('\n').forEach((line, i) => {
        const 場所 = src.file + ':' + (i + 1);
        const 札 = [];
        let m;
        const re1 = /<button[^>]*>([^<]*)</g;          // ①タグに直接書かれた札
        while ((m = re1.exec(line))) 札.push(m[1].trim());
        const re2 = /'([^'\\\n]{1,14})'/g;             // ②三項で選ばれる札は、こちらでしか拾えない
        while ((m = re2.exec(line))) 札.push(m[1].trim());

        札.forEach((t) => {
          UiText.BANNED.forEach((b) => {
            const 当たり = t.endsWith(b.見つけたら) ||
              (/<button/.test(line) && t.indexOf(b.見つけたら) >= 0);
            if (!当たり) return;
            if (例外.some((e) => t.indexOf(e.札) >= 0 && line.indexOf(e.場所) >= 0)) return;
            見つけた.push(場所 + '「' + t + '」→ 正本は「' + b.正本 + '」');
          });
        });
      });
    });

    assertEqual(Array.from(new Set(見つけた)).join('\n       '), '',
      '正本の語に直っていないボタンの札');
  });

  await r.test('掃き方そのものが効いている（型a・型b）', async () => {
    // **上の検査が0件で緑なのは、本当に無いからか、掃けていないからか。**
    // 掃いた数を先に数え、わざと違反を混ぜて捕まることを見る
    const 札の数 = SOURCES_FOR_LABEL.reduce(
      (n, src) => n + (strip(src.text).match(/<button[^>]*>[^<]*</g) || []).length, 0);
    assert(札の数 > 100, 'ボタンの札を集められている（実際:' + 札の数 + '件）');

    const 引っかかる = (s) => UiText.BANNED.some((b) => s.indexOf(b.見つけたら) >= 0);
    assert(引っかかる('閉じる'), 'わざと混ぜた「閉じる」を見張りが捕まえる');
    assert(!引っかかる('とじる'), '直した「とじる」は捕まらない');
  });

  await r.test('うまくいかない知らせが「失敗」と言わない（第40弾 C4）', async () => {
    // **遊んでいる人は何も失敗していない。**
    // 「保存に失敗しました」は、人のしくじりに聞こえる（原則C）。
    // 起きた事実だけを言う形（「保存できませんでした」）に寄せた。
    //
    // 掃く先から ui-text.js は外す——**そこは台帳そのもの**で、
    // 直す前の言い方が「直し方の説明」として載っている（第39弾で踏んだ形）
    const 責める語 = ['に失敗しました', 'エラーが発生', '再試行'];
    const 見つけた = [];
    SOURCES.forEach((src) => {
      strip(src.text).split('\n').forEach((line, i) => {
        let m;
        const re = /'([^'\\\n]{2,140})'/g;
        while ((m = re.exec(line))) {
          責める語.forEach((w) => {
            if (m[1].indexOf(w) >= 0) 見つけた.push(src.file + ':' + (i + 1) + '「' + m[1] + '」');
          });
        }
      });
    });
    assertEqual(見つけた.join('\n       '), '', '責める言い方が残っている');

    // 言い換え先が実在するか（両方向・落とし穴20）
    ['保存できない', '読み込めない', 'うまくいかない', 'あとでためせる'].forEach((k) => {
      assert(typeof UiText.MSG[k] === 'string' && UiText.MSG[k].length > 0,
        'MSG.' + k + ' が用意されている');
      assert(UiText.MSG[k].indexOf('失敗') < 0, 'MSG.' + k + ' 自身が「失敗」と言っていない');
    });
  });

  await r.test('画面に全角数字が出ない（第40弾 C5・回帰防止）', async () => {
    // **この検査は一度、緑なのに見落としていた。**
    // JSの文字列しか見ておらず、HTMLに直接書かれた
    // 「🥊 スマホを２人の間へ」を素通りしていた。
    // 実機で画面を読んで初めて分かった（落とし穴10-b・12）。
    //
    // 数えた件数を**層ごとに**主張する——
    // 0件が「無い」のか「その層を見ていない」のかを分ける
    const 全部 = 画面の文言();
    const JS件数 = 全部.filter((x) => x.層 === 'JS').length;
    const HTML件数 = 全部.filter((x) => x.層 === 'HTML').length;
    assert(JS件数 > 1500, 'JSの文言を数えられている（実際:' + JS件数 + '件）');
    assert(HTML件数 > 300, '**HTMLの地の文も**数えられている（実際:' + HTML件数 + '件）');

    const 見つけた = 全部.filter((x) => /[０-９]/.test(x.t))
      .map((x) => x.層 + ' ' + x.場所 + '「' + x.t.slice(0, 40) + '」');
    assertEqual(見つけた.join('\n       '), '', '全角数字が混ざっている');
  });

  await r.test('単独で出る短い知らせに句点を付けない（第40弾 C6）', async () => {
    // 正本10：短い案内には句点を付けない。2文以上のまとまりには付ける。
    // **文の途中で連結されるものは対象にしない**——
    // 「『参加する』を選びました。」＋続きの文、のような形は句点が正しい。
    // そこで**HTMLに単独で置かれた短い知らせ**だけを見る（連結が起きない層）
    const 短い知らせ = 画面の文言().filter((x) =>
      x.層 === 'HTML' && x.t.length <= 16 && /。$/.test(x.t) &&
      (x.t.match(/。/g) || []).length === 1);
    assertEqual(短い知らせ.map((x) => x.場所 + '「' + x.t + '」').join('\n       '), '',
      '単独の短い知らせに句点が付いている');
  });

  await r.test('専門用語が画面に出ていない（第40弾 C3）', async () => {
    // JARGON の「用語」が、台帳の外で使われていないこと。
    // 除外印（プレイヤー）が付いたものは対象にしない
    const 対象 = UiText.JARGON.filter((j) => !j.除外);
    assert(対象.length >= 4, '言い換える語がある（実際:' + 対象.length + '件）');  // 型(b)
    const 見つけた = [];
    SOURCES.forEach((src) => {
      strip(src.text).split('\n').forEach((line, i) => {
        let m;
        const re = /'([^'\\\n]{2,140})'/g;
        while ((m = re.exec(line))) {
          対象.forEach((j) => {
            if (m[1].indexOf(j.用語) >= 0) {
              見つけた.push(src.file + ':' + (i + 1) + '「' + m[1].slice(0, 40) +
                '」→ ' + j.言い換え);
            }
          });
        }
      });
    });
    assertEqual(見つけた.join('\n       '), '', '専門用語が画面に残っている');
  });

  await r.test('そのまま残す外来語は、理由つきで台帳にある（第40弾 C7）', async () => {
    // **「判断しなかった」と「残すと決めた」を区別する。**
    // 理由の無い居残りは、ただの見落とし
    assert(UiText.KEPT.length >= 4, '残す語が挙がっている（実際:' + UiText.KEPT.length + '件）');
    UiText.KEPT.forEach((k) => {
      assert(k.語 && k.語.length > 0, '語がある');
      assert(k.理由 && k.理由.length >= 10, '「' + k.語 + '」に理由が書いてある');
    });
    // JARGON と食い違っていないか（同じ語が「言い換える」と「残す」の両方に無いこと）
    const 残す = UiText.KEPT.map((k) => k.語);
    const 矛盾 = UiText.JARGON.filter((j) => !j.除外 && 残す.indexOf(j.用語) >= 0);
    assertEqual(矛盾.map((j) => j.用語).join('・'), '',
      '同じ語が「言い換える」と「残す」の両方に載っている');
  });

  await r.test('直した文言は ui-text.js 経由で出る（第40弾 C8）', async () => {
    // **同じ意味の知らせを、画面ごとに書かない。**
    // 直書きに戻ると、次に言い方を変える時に片方だけ直る（落とし穴1）。
    //
    // 最初は各所に `(typeof UiText!=="undefined"?UiText.MSG:{})` と書いていて、
    // 同じ長い式が10回並び、しかも予備の文言として**同じ文が二重に**書いてあった。
    // 受け口を1つにして `MSG.〇〇` で呼ぶ形に寄せた
    assert(/var MSG = \(typeof UiText !== ['"]undefined['"]\) \? UiText\.MSG : \{\};/.test(HTML),
      'MSG の受け口が1か所にある');

    // MSG に入れた文言が、画面に直書きで残っていないこと
    const 直書き = [];
    Object.keys(UiText.MSG).forEach((k) => {
      const v = UiText.MSG[k];
      if (typeof v !== 'string') return;
      SOURCES.forEach((src) => {
        strip(src.text).split('\n').forEach((line, i) => {
          if (line.indexOf("'" + v + "'") >= 0) {
            直書き.push(src.file + ':' + (i + 1) + '「' + v + '」');
          }
        });
      });
    });
    assertEqual(直書き.join('\n       '), '', 'MSG にある文言が画面に直書きされている');

    // 実際に使われているか（両方向・落とし穴20）。
    // 台帳に足しただけで誰も呼んでいない、を防ぐ
    const 使われず = Object.keys(UiText.MSG).filter((k) => HTML.indexOf('MSG.' + k) < 0);
    assertEqual(使われず.join('・'), '', 'MSG に書いたのに、どこからも呼ばれていない言い方');
  });

  await r.test('動詞はかな、固有の名詞は漢字のまま（第40弾 40-Cの裁定）', async () => {
    // 正本10「ひらがな寄り」。**動詞**は かな に寄せる。
    // ただし**固有の名詞は別**——「手渡し」は遊び方の名称、
    // 「決選投票」は決まった言い方で、動詞の言い換えとは種類が違う。
    //
    // ここは一度、**規則ではなく多数決で決めて間違えた**ところ。
    // 「渡して9件・わたして1件だから多いほうへ」と漢字に寄せたが、
    // 正本には「ひらがな寄り」と書いてあった。**書いてある規則が勝つ。**
    const 全部 = 画面の文言();
    assert(全部.length > 1800, '画面の文言を数えられている（実際:' + 全部.length + '件）');  // 型(b)

    const 固有 = ['手渡し', '決選投票'];
    const 見つけた = [];
    全部.forEach((x) => {
      // 固有の名詞を伏せてから、動詞の漢字が残っていないかを見る
      let t = x.t;
      固有.forEach((w) => { t = t.split(w).join(''); });
      const 残り = t.match(/[渡戻]|選(?=[ぁ-ん])/g);
      if (残り) {
        見つけた.push(x.層 + ' ' + x.場所 + '「' + x.t.slice(0, 44) + '」→ ' + 残り.join('・'));
      }
    });
    assertEqual(見つけた.join('\n       '), '', '動詞が漢字のまま残っている');

    // **固有の名詞のほうは、消えていないこと**（両方向・落とし穴20）。
    // かなに寄せすぎて「手わたし」「決えら投票」になっていないか
    固有.forEach((w) => {
      const 数 = 全部.filter((x) => x.t.indexOf(w) >= 0).length;
      assert(数 > 0, '「' + w + '」が残っている（実際:' + 数 + '件）');
    });
    const 壊れ = 全部.filter((x) => /手わた|決えら/.test(x.t));
    assertEqual(壊れ.map((x) => x.場所 + '「' + x.t.slice(0, 30) + '」').join('・'), '',
      '固有の名詞をかなに崩してしまっている');
  });

  r.finish();
})();
