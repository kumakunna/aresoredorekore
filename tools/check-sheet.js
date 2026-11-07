#!/usr/bin/env node
// tools/check-sheet.js — 11/7 の学校の検査のチェック表（検査の準備 1）を、今ある一覧から作る
//
//   node tools/check-sheet.js            … docs/検査_1107/1_チェック表.md と 1_チェック表.csv を書き直す
//   node tools/check-sheet.js --no-net   … 証明書の期限を見に行かない（手元だけ）
//
// **行を手で書かない所**（落とし穴4）：
//   ・文化祭のゲーム＝fes-room.js の FES_GAMES。ゲームの画面＝index.html の RT_GAME_SCREENS
//   ・文化祭の段＝fes-room.js の PHASE。係・遊ぶ人の操作＝realtime.js の socket.on('fes:…')・socket.on('room:…')
//   ・画面＝tests/inventory.js の SCREEN_IDS・OVERLAY_IDS。入る道・出る道・いじわる＝ROOM_ENTRY_PATHS・ROOM_EXIT_PATHS・ABNORMAL_SCENARIOS
//   ・ページ＝server.js・fes.js・tvs.js などの app.get('/…')（/api はのぞく）
// 手で書く行（当日の運用・実機でしか見られない物）は、下の MANUAL にまとめて、出どころ（§6 の15 など）を添える。
// 新しいゲーム・操作・画面が増えると、表にも自動で増える。名前を付けていない操作は「（名前なし）」で出る＝ここに1行足す合図。
//
// 合い言葉（HAICHI_KEY）・あそびまちの key は、この表に書かない（/haichi の行も「合い言葉は係が打つ」とだけ書く）。

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs', '検査_1107');
const argv = process.argv.slice(2);
const NO_NET = argv.includes('--no-net');

const I = require(path.join(ROOT, 'tests', 'inventory'));
const FesRoom = require(path.join(ROOT, 'fes-room'));
const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const realtimeSrc = fs.readFileSync(path.join(ROOT, 'realtime.js'), 'utf8');

// ---- index.html の RT_GAME_SCREENS（ゲーム → 画面）を読む ----
function gameScreens() {
  const m = /var RT_GAME_SCREENS = \{([\s\S]*?)\n  \};/.exec(html);
  if (!m) throw new Error('index.html に RT_GAME_SCREENS が見つかりません（名前が変わった？）');
  const body = m[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const out = {};
  for (const x of body.matchAll(/([a-z0-9]+)\s*:\s*(\[[^\]]*\]|'[^']*')/g)) {
    out[x[1]] = x[2].startsWith('[') ? Array.from(x[2].matchAll(/'([^']+)'/g)).map((y) => y[1]) : [x[2].slice(1, -1)];
  }
  return out;
}
const GS = gameScreens();

// ---- 操作（socket.on）の名前。名前を付けていない物は「（名前なし）」で出る ----
const EVENT_LABEL = {
  // 係の画面から
  'fes:bgm': ['係', 'BGM の入／切（はじめは切）。TV で鳴る・止まる'],
  'fes:game': ['係', 'ゲームごとの入／切（いつも2本以上は入）。投票の候補に出る・消える'],
  'fes:hide': ['係', '名前を隠す。TV（待合・遊ぶ間・結果）で隠れる'],
  'fes:inset': ['係', 'TV の小窓（インセット）の入／切'],
  'fes:kick': ['係', '人を外す。外された人のスマホは入る画面（「部屋から出ました。もう一度入れます」）'],
  'fes:pause': ['係', '止める／再開。止まっている間の TV とスマホ'],
  'fes:skip': ['係', 'この回をとばす（確かめが出る）'],
  // 遊ぶ人のスマホから
  'fes:vote': ['遊ぶ人', '投票する・変える（締め切りまで）'],
  'fes:continue': ['遊ぶ人', '結果のあと「つづける」'],
  'fes:feedback': ['遊ぶ人', '結果のあとの ひとこと（書く箱・送る）'],
  'fes:reserve': ['遊ぶ人', '満員の時に「つぎの回」を予約'],
  'fes:unreserve': ['遊ぶ人', '予約を取り消す'],
  // 画面を開いた時
  'fes:create': ['係', '文化祭の部屋を作る（朝・再起動のあと）'],
  'fes:watch': ['TV', 'TV として見る（/fes を TV で開く）'],
  'room:join': ['遊ぶ人', '入る（名前・むずかしさ・入る）'],
  'room:here': ['遊ぶ人', '別のアプリからもどった時の「いるよ」（指示74）'],
  'room:leave': ['遊ぶ人', '⚙→部屋を出る'],
  'room:ready': ['遊ぶ人', '準備OK（全員でのこり3秒・長押しで取り消し）'],
  'room:react': ['遊ぶ人', 'リアクション'],
  'room:kick': ['係', '（ふだんの部屋）進行役が外す'],
  'room:close': ['係', '（ふだんの部屋）部屋を閉じる'],
  'room:pause': ['係', '（ふだんの部屋）止める'],
  'room:peek': ['遊ぶ人', '（ふだんの部屋）のぞく'],
  'room:thanks': ['遊ぶ人', '（ふだんの部屋）ありがとう'],
  'room:create': ['係', '（ふだんの部屋）部屋を作る']
};
const events = Array.from(new Set(Array.from(realtimeSrc.matchAll(/socket\.on\('((?:fes|room):[a-z-]+)'/g)).map((m) => m[1]))).sort();

// ---- ページ（app.get('/…')。/api はのぞく） ----
function pages() {
  const files = fs.readdirSync(ROOT).filter((f) => f.endsWith('.js')).map((f) => path.join(ROOT, f));
  const set = new Map();
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/app\.get\(\s*'(\/[^']*)'/g)) {
      if (m[1].startsWith('/api/') || m[1] === '/dev-login') continue;
      if (!set.has(m[1])) set.set(m[1], path.basename(f));
    }
  }
  return set;
}
const PAGE_NOTE = {
  '/fes': '文化祭のスマホの入口（/?fes=1 に送る）。QR から入る',
  '/tv': 'TV として入る（/?tv=1）',
  '/tvs': 'TV の切りかえ（指示69）。あそびまちを映す所・あつまれにもどす所',
  '/tvs/items': 'TV の切りかえの中身の一覧',
  '/tvs/screen': 'TV に映す側の画面',
  '/fes/names': '係：名前の一覧（係のログインが要る）',
  '/fes/rounds': '係：回ごとの記録',
  '/fes/bomb-stats': '係：クイズ解除の記録（FES_OWNER だけ）',
  '/haichi': '配置づくり（合い言葉は係が打つ・ここには書かない）'
};

// ---- 手で書く行（出どころつき） ----
const DEV = ['iPhone', 'Android', 'iPad'];
const BACK_KINDS = [
  ['別のアプリに40秒 → もどる', '指示74 ①・押せる・盤が出る（合格の線：もどって押せるまで3秒以内）'],
  ['別のアプリに3分 → もどる', '指示74 ②・入る画面に「しばらく はなれていたので、もう一度 入ってね」・名前とむずかしさが入ったまま・入る1回で入れる'],
  ['画面ロック（電源ボタン）→ もどる', '追加：40秒と3分の両方'],
  ['5分以上はなれる → もどる', '追加'],
  ['機内モード → もどす', '追加：つながるまでの秒数をメモ'],
  ['Safari／Chrome の別のタブ → もどる', '追加']
];
const MANUAL = [
  // [区分, 画面・ゲーム, 見る所, 出どころ]
  ['当日の朝', 'HTTPS の証明書', '期限が文化祭（11/14）より後か', '追加'],
  ['当日の朝', '学校の Wi-Fi', 'ログイン画面（キャプティブポータル）が出ないか・出たら何を押すか', '追加'],
  ['当日の朝', '学校の Wi-Fi', 'WebSocket がふさがれていないか（スマホで /fes に入って、係の画面で「つながっている」になる・すぐ切れない）', '追加・§6 の14'],
  ['当日の朝', 'TV の PC', '/fes を TV として開く・全画面（F11）・音の出る先', '運用メモ'],
  ['当日の朝', '係の PC', '係の画面にログインする（朝1回）', 'くまくん'],
  ['係の画面', '係の画面', '読み込み直しても、ログインしたまま', '1'],
  ['係の画面', '係の画面', '数時間（昼休みをこえて）たっても、ログインしたまま', '1'],
  ['係の画面', '係の画面', 'PC と iPad で同時に開ける・両方で同じ様子が出る・片方の操作がもう片方に出る', '1'],
  ['係の画面', '係の画面', '休憩の代わりの人が、朝ログインした PC をそのまま触って困らない（押してはいけない所が分かる）', 'くまくん（§6 の8）'],
  ['§6 の15', 'クイズ解除', 'コードを2回続けて押す → 出た3択に答えが入ってしまわないか（E3・A15）', '§6 の15 (a)'],
  ['§6 の15', '文化祭のスマホ', '⚙→「部屋を出る」の行き先（Z1）', '§6 の15 (b)'],
  ['§6 の15', '文化祭のスマホ', '⚙→部屋→「この画面を大画面にする」の行き先（Z2）', '§6 の15 (b)'],
  ['§6 の15', 'iPhone', '⚙→名前を変える の左上（F1）', '§6 の15 (c)'],
  ['iPad', 'iPad（貸し出し）', '何人かで順番に使う：前の人の名前・むずかしさが残っていないか（A8）', '1・A8'],
  ['iPad', 'iPad（貸し出し）', '前の人として入り直してしまわないか（同じ席・同じ記録）（A8）', '1・A8'],
  ['iPad', 'iPad（貸し出し）', '光と揺れの確認が2人目にも出るか（A8）', 'A8'],
  ['iPad', 'iPad（縦 820×1180）', 'スマホと同じ形で出る（アプリは UA で見分けていない＝幅で決まる。900px 未満）', '追加：UA の一覧'],
  ['iPad', 'iPad（横 1180×820）', '900px をこえる：スマホの画面が崩れない・/tv で開いた時だけ TV の形（min-width:900px かつ 4:3 より横長）', '追加：UA の一覧'],
  ['席', '文化祭のスマホ', '同じ人が QR を何度も読む → 席が2つにならない', '追加'],
  ['席', '文化祭のスマホ', '「戻る」ボタン → 席と名前', '追加'],
  ['席', '文化祭のスマホ', '読み込み直し（待合・投票・遊ぶ間・結果）→ 同じ席にもどる', '追加・d04'],
  ['席', '文化祭のスマホ', '同じ人が2台で入る → どちらが席か・もう片方に何が出るか', '追加・d08'],
  ['席', '文化祭のスマホ', '2つのタブで同じ部屋を開く（裏のタブに本人だけの知らせが行かないか）', '指示74 の見直し（低）'],
  ['画面を消さない', 'スマホ', '待合・投票・ほかの人の番の間、画面が暗くならない（Wake Lock・iOS 18.4 から）', '追加・指示71-1'],
  ['画面を消さない', 'スマホ', '別のアプリからもどったあとも、画面が暗くならない（取り直している）', '追加'],
  ['画面を消さない', 'スマホ', '低電力モード（iPhone）・省電力（Android）の時も同じか', '追加'],
  ['TV の PC', 'TV（Chrome・全画面）', '何時間も動かして重くならない（昼・夕方に1回ずつ 3-2-1 と幕を見る）', '追加'],
  ['TV の PC', 'TV', '「TVさんがもどりました」が遊ぶ人のスマホにも出るか（出すかはくまくんが決める）', '明日の一覧'],
  ['係が外す', '外された人のスマホ', '入る画面に「部屋から出ました。もう一度入れます」・止まった部屋の画面のままにならない・名前は入ったまま（むずかしさは選び直し）', '明日の一覧（指示74 で道が変わった）'],
  ['指示74', '文化祭のスマホ', 'ひとことの書く箱がつぶれない（結果のあと）', '指示74 ③'],
  ['指示74', 'Android の名前の箱', '字の上下が切れない・緑っぽい枠が出ない', '指示74 ④'],
  ['指示74', '文化祭のスマホ', '押せなかった時に「つなぎ直しています」が出て、そのあと押せる', '指示74 門5'],
  ['あそびまち', '/tvs', 'あそびまちを TV に映す・あつまれにもどす', 'くまくん（あつまれ側だけ）'],
  ['あそびまち', 'あそびまちの札', '札から /fes に入れる（QR・リンク）', 'くまくん（あつまれ側だけ）'],
  ['音', 'TV', 'TV の音量を決める（8 の手順）', '8'],
  ['見ている人', 'TV', 'ゲームをしない人が TV だけ見て、何をしているか分かる（5 の一覧）', '5']
];

// ---- 証明書の期限（読むだけ） ----
async function certEnd() {
  if (NO_NET) return null;
  const tls = require('tls');
  return new Promise((res) => {
    const s = tls.connect({ host: 'aresoredorekore.duckdns.org', port: 443, servername: 'aresoredorekore.duckdns.org', timeout: 8000 }, () => {
      const c = s.getPeerCertificate(); s.end(); res(c && c.valid_to ? new Date(c.valid_to) : null);
    });
    s.on('error', () => res(null)); s.on('timeout', () => { s.destroy(); res(null); });
  });
}

(async () => {
  const rows = [];   // { sec, what, look, src }
  const add = (sec, what, look, src) => rows.push({ sec, what, look, src: src || '' });

  // A. 当日の朝・係（手で書く物の前半）
  const end = await certEnd();
  MANUAL.filter((r) => r[0] === '当日の朝').forEach((r) => add(r[0], r[1], r[2] + (r[1] === 'HTTPS の証明書' && end ? `（いまの期限 ${end.toISOString().slice(0, 10)}）` : ''), r[3]));

  // B. 文化祭のスマホと TV（段ごと）
  const PH = FesRoom.PHASE;
  const PH_LOOK = {
    idle: '部屋がまだ無い・止まっている時の画面',
    lobby: '待合：名前・人数・QR（TV）・次に押す所が分かる',
    vote: '投票：候補の札・締め切りの時計・押した印・変えられる',
    decide: '決定の演出（スポットライト）・スキップできる',
    ready: '準備OK：ルール・押した人の数・全員でのこり3秒・長押しで取り消し',
    play: '遊ぶ間（ゲームごとの行は下）',
    result: '結果：順位・ひとこと・つづける'
  };
  add('文化祭の入口', '/fes（スマホ）', '光と揺れの確認 → 名前 → むずかしさ → 入る。1画面に1つ', 'scr-door・scr-v2-fes-join');
  add('文化祭の入口', '/fes（スマホ・満員）', '17人目：「つぎの回」の予約・取り消し', 'fes:reserve');
  add('文化祭の入口', '/fes（スマホ・やめる）', 'やめる画面（scr-v2-fes-quit）', 'scr-v2-fes-quit');
  Object.values(PH).forEach((p) => {
    if (p === 'play') return;
    add('文化祭の段', `スマホ：${p}`, PH_LOOK[p] || '', 'fes-room.js PHASE・scr-v2-fes-lobby');
    add('文化祭の段', `TV：${p}`, PH_LOOK[p] ? PH_LOOK[p] + '（3m 離れて読める）' : '', 'scr-v2-fes-tv');
  });

  // C. 文化祭のゲーム（FES_GAMES × スマホ／TV × 準備OK・遊ぶ・結果）
  // 係が入／切できない物（on も testing も無い＝棚から下ろした）は、文化祭の候補に出ない。行を作らず1行の注記にする（fes-room.js の switchable と同じ決め）
  const 出る = FesRoom.FES_GAMES.filter((g) => g.on || g.testing), 出ない = FesRoom.FES_GAMES.filter((g) => !(g.on || g.testing));
  if (出ない.length) add('文化祭のゲーム', '棚から下ろした：' + 出ない.map((g) => g.mode).join('・'), '係の入／切に出ない・投票の候補にならない（見る所なし。出ていたら NG）', 'fes-room.js switchable');
  出る.forEach((g) => {
    const scr = GS[g.game] || [];
    const tag = `${g.mode}（${g.min}〜${g.max}人・はじめは${g.on || g.def ? '入' : '切'}${g.testing ? '・テスト中' : ''}）`;
    const phone = scr.filter((s) => !/-tv$/.test(s));
    const tv = scr.filter((s) => /-tv$/.test(s));
    if (!scr.length) add('文化祭のゲーム', tag, '（画面の対応が見つからない：RT_GAME_SCREENS に無い）', '');
    add('文化祭のゲーム', tag + '：準備OK', 'ルールの1行目・字を読まずに分かるか・失敗の一言が重ならないか', 'scr-v2-fes-lobby');
    if (g.game === 'bomb') {
      add('文化祭のゲーム', tag + '：遊ぶ（スマホ）', '解除中は新しい見た目（scr-v2-fes-lobby）・決着のあとは ' + phone.join('・'), 'fesWantScreen');
      add('文化祭のゲーム', tag + '：遊ぶ（TV）', '解除中は scr-v2-fes-tv・決着の 💥／解除の祝いは scr-rt-big', 'fesWantScreen');
    } else {
      add('文化祭のゲーム', tag + '：遊ぶ（スマホ）', phone.join('・') || '-', 'RT_GAME_SCREENS');
      add('文化祭のゲーム', tag + '：遊ぶ（TV）', tv.length ? tv.join('・') : 'scr-rt-big（今までの大画面）', 'RT_GAME_SCREENS');
    }
    add('文化祭のゲーム', tag + '：結果', 'スマホと TV の結果・つぎは？', 'scr-v2-fes-lobby・scr-v2-fes-tv');
  });

  // D. 操作（係・遊ぶ人・TV）
  events.forEach((e) => {
    const l = EVENT_LABEL[e] || ['（名前なし）', '（tools/check-sheet.js の EVENT_LABEL に1行足す）'];
    add(l[0].startsWith('（') ? '操作' : '操作：' + l[0], e, l[1], 'realtime.js');
  });

  // E. 手で書く行（係・§6 の15・iPad・席・画面を消さない・TV の PC・係が外す・指示74・あそびまち・音・見ている人）
  MANUAL.filter((r) => r[0] !== '当日の朝').forEach((r) => add(r[0], r[1], r[2], r[3]));

  // F. もどるテスト（種類 × 端末。3回ずつ）
  BACK_KINDS.forEach((k) => DEV.forEach((d) => add('もどる（3回ずつ）', `${d}：${k[0]}`, k[1] + '・1回目／2回目／3回目', '追加・指示74')));

  // G. ページ
  pages().forEach((file, p) => add('ページ', p, PAGE_NOTE[p] || '（中身を書いていないページ：開けるかだけ）', file));

  // H. ふだんの部屋（ホーム）：入る道・出る道・いじわる
  I.ROOM_ENTRY_PATHS.forEach((p) => add('ホーム：入る道', p.id, p.label, 'inventory ROOM_ENTRY_PATHS'));
  I.ROOM_EXIT_PATHS.forEach((p) => add('ホーム：出る道', p.id, p.label, 'inventory ROOM_EXIT_PATHS'));
  I.ABNORMAL_SCENARIOS.forEach((p) => add('いじわる', p.id, p.name, 'inventory ABNORMAL_SCENARIOS'));

  // I. 全部の画面（ホーム・古い画面も。文化祭で上に出た物は「上にも」）
  const fesScr = new Set(['scr-door', 'scr-v2-fes-join', 'scr-v2-fes-quit', 'scr-v2-fes-lobby', 'scr-v2-fes-tv', 'scr-rt-big']);
  FesRoom.FES_GAMES.filter((g) => g.on || g.testing).forEach((g) => (GS[g.game] || []).forEach((s) => fesScr.add(s)));
  const group = (id) => /^scr-v2-fes|^scr-door$/.test(id) ? '文化祭' : /^scr-v2-/.test(id) ? '新しい見た目' : /^scr-rt-/.test(id) ? 'ふだんの部屋' : /^scr-set-/.test(id) ? '設定（手渡し）' : '手渡し・ホーム';
  I.SCREEN_IDS.forEach((id) => add('全部の画面：' + group(id), id, '開く・字の見切れ・重なり・はみ出し（4 の写真）' + (fesScr.has(id) ? '（文化祭で上にも）' : ''), 'inventory SCREEN_IDS'));
  I.OVERLAY_IDS.forEach((id) => add('全部の画面：かぶさる物', id, '開く・閉じる・下の画面が押せない', 'inventory OVERLAY_IDS'));

  // 書く
  const esc = (s) => String(s).replace(/\|/g, '｜').replace(/\n/g, ' ');
  const secs = Array.from(new Set(rows.map((r) => r.sec)));
  let md = '# 11/7 学校の検査：チェック表（検査の準備 1）\n\n';
  md += '`node tools/check-sheet.js` が作る（**手で行を足さない**。足す時は tools/check-sheet.js の MANUAL か、もとの一覧に足す）。\n';
  md += `作った時：${new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ')}・${rows.length} 行。表計算で使う時は同じ中身の \`1_チェック表.csv\`。\n\n`;
  md += '- 端末：iPhone（Safari）・Android（Samsung Internet）・iPad（Safari）・TV の PC（Chrome）・係の PC\n';
  md += '- 合格の線（仮・追加）：もどって押せるまで3秒以内／押してから返事 95% が 150ms 以内／ボタン 主な操作 60px・どこでも 44px／字 入力欄 16px・スマホの本文 18px・TV 48px／点滅 1秒に3回まで\n';
  md += '- 「OK・NG」が NG の行は、メモに **端末・時刻・写真の名前** を書く（夜に順位をつける）\n';
  md += '- **iPad を PC と思う所（追加）**：アプリの中で `navigator.userAgent`・`maxTouchPoints` で端末を分けている所は **無い**（UA を読むのは検査の記録 public/js/probe.js だけ）。' +
    '分けているのは幅だけ：`@media (min-width:900px)`（TV の字の大きさの変数）・`(min-width:900px) and (min-aspect-ratio:4/3)`（/tv で開いた時の形）・`(min-width:1024px)`（遊び方の並び）・`(hover:hover) and (pointer:fine)`（PC のホバー）・JS の `matchMedia(\'(min-width:900px)\')`（すごろくの列）。' +
    'iPad の縦（820）はスマホと同じ、**横（1180）は 900px をこえる**ので、iPad の行で横向きも見る\n\n';
  md += '目次：' + secs.map((s) => s).join('／') + '\n';
  secs.forEach((s) => {
    md += `\n## ${s}\n\n| # | 画面・ゲーム | 見る所 | OK・NG | メモ |\n|---|---|---|---|---|\n`;
    rows.filter((r) => r.sec === s).forEach((r) => { md += `| ${rows.indexOf(r) + 1} | ${esc(r.what)} | ${esc(r.look)}${r.src ? ' <sub>' + esc(r.src) + '</sub>' : ''} |  |  |\n`; });
  });
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, '1_チェック表.md'), md);
  const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';
  const csv = '﻿' + ['#,区分,画面・ゲーム,見る所,出どころ,OK・NG,メモ'].concat(rows.map((r, i) => [i + 1, r.sec, r.what, r.look, r.src, '', ''].map(q).join(','))).join('\r\n') + '\r\n';
  fs.writeFileSync(path.join(OUT, '1_チェック表.csv'), csv);
  const unnamed = events.filter((e) => !EVENT_LABEL[e]);
  console.log(`${rows.length} 行・${secs.length} 区分 → docs/検査_1107/1_チェック表.md・.csv` + (end ? `・証明書 ${end.toISOString().slice(0, 10)}` : '') + (unnamed.length ? `・名前なしの操作 ${unnamed.join(',')}` : ''));
})().catch((e) => { console.error(e); process.exit(1); });
