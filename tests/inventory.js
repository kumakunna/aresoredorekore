// tests/inventory.js — 監査の正本（第35弾）
//
// 「部屋への出入り」「ゲーム開始のカウントダウン」など、アプリに存在する
// 経路の一覧をここに集約する。チャット報告や docs に書くだけだと、
// 次のゲーム・画面を足した時に一覧が古くなり、検証から漏れる（落とし穴4）。
//
// 決めごと：
//   ・ゲーム一覧のような「実データから導けるもの」は必ず自動導出する（手書き禁止）
//   ・網羅系のテストは、この一覧を回すループ形式で書く（個別ケースの列挙をしない）
//   ・新しい経路を作ったら、実装と同じコミットでここに1行足す
//   ・docs/監査_棚卸し一覧.md には概要とこのファイルへの参照だけを書く（二重管理しない）

const fs = require('fs');
const path = require('path');
const { GAME_DRIVERS } = require('../realtime');

// ---- 部屋（1人1台）で遊べるゲーム一覧（realtime.js の GAME_DRIVERS から自動導出） ----
const RT_GAME_IDS = Object.keys(GAME_DRIVERS);

// ---- カセットに入っている全ゲーム（public/index.html の CASSETTES から自動抽出） ----
// 検証マトリクス（docs/監査_プレイ検証マトリクス.md）の行はこれを正とする。
// 手で一覧を書くと、新しいカセット・ゲームを足した時に検証から漏れる（落とし穴4）
const INDEX_HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const CASSETTE_GAME_IDS = Array.from(new Set(
  Array.from(INDEX_HTML.matchAll(/games:\s*\[([^\]]*)\]/g))
    .flatMap((m) => m[1].split(',').map((s) => s.replace(/['"\s]/g, '')).filter(Boolean))
));

// 手渡し（1台を回す）専用のゲーム。ここは「意識して書く例外の一覧」：
// 新しいゲームをカセットに足したのに GAME_DRIVERS に登録しなかった場合、
// この一覧に書き足さない限り tests/room-paths.js の検出テストが赤くなる。
// （部屋対応を忘れたのか、手渡し専用のつもりなのかを、コミットで宣言させる形）
const HANDOFF_ONLY_GAME_IDS = ['aresoredorekore'];

// 部屋のゲーム開始イベント。全ゲームがこの1本を通る
// （rtStartBtn → rt.startWolf → サーバー wolf:start → room:countdown 放送）。
// 新しいゲームで別の開始イベントを作ってはいけない（カウントダウン等の共通処理が漏れる）
const RT_START_EVENT = 'wolf:start';

// ---- 部屋に入る経路 ----
// via: ui＝画面のボタン / url＝URLパラメータ / socket＝通信層の自動処理
const ROOM_ENTRY_PATHS = [
  { id: 'howto-create', via: 'ui', event: 'room:create',
    label: '「あそびかたをえらぶ」→みんなのスマホ→部屋を立てる（rtCreateBtn）' },
  { id: 'howto-join', via: 'ui', event: 'room:join',
    label: '「あそびかたをえらぶ」→みんなのスマホ→部屋に入る（rtJoinBtn・コード入力）' },
  { id: 'qr-url', via: 'url', event: 'room:join',
    label: 'QRコード（?room=コード付きURL）→参加専用ロビー→部屋に入る' },
  { id: 'login-join', via: 'ui', event: 'room:join',
    label: 'ログイン画面「部屋に参加する（ログイン不要）」→参加専用ロビー' },
  { id: 'shelf-room-btn', via: 'ui', event: '(在室なら遷移のみ / 未在室なら create・join へ)',
    label: '棚の下部バー「部屋」ボタン（shelfRoomBtn・第33弾で復活した近道）' },
  { id: 'auto-rejoin', via: 'socket', event: 'room:join（memberId付き）',
    label: '切断→socket.io自動再接続→rt-client が同じメンバーとして入り直す' },
  { id: 'manual-rejoin', via: 'socket', event: 'room:join（memberId付き）',
    label: '2つ目のタブ・別socketからの入り直し（同じ枠を引き継ぐ）' }
];

// ---- 部屋から出る経路 ----
// kind: leave＝自分だけ出る / close＝部屋ごと終わる / passive＝サーバーから出される
// btn: index.html のボタンid（UIループテストが回す）。ボタン以外は null
const ROOM_EXIT_PATHS = [
  { id: 'wait-leave', kind: 'leave', btn: 'rtLeaveBtn', event: 'room:leave',
    label: '待機画面「← 部屋を出る」' },
  { id: 'play-leave', kind: 'leave', btn: 'rtPlayLeaveBtn', event: 'room:leave',
    label: '人狼・ワードウルフ画面（決着後）「← 部屋を出る」' },
  { id: 'bomb-leave', kind: 'leave', btn: 'rtBombLeaveBtn', event: 'room:leave',
    label: 'クイズ解除画面（決着後）「← 部屋を出る」' },
  { id: 'defuse-leave', kind: 'leave', btn: 'dfLeaveBtn', event: 'room:leave',
    label: '実物解除画面（決着後）「← 部屋を出る」' },
  { id: 'quiz-leave', kind: 'leave', btn: 'qzLeaveBtn', event: 'room:leave',
    label: 'クイズ王画面（決着後）「← 部屋を出る」' },
  { id: 'auction-leave', kind: 'leave', btn: 'auLeaveBtn', event: 'room:leave',
    label: 'オークション画面（決着後）「← 部屋を出る」' },
  { id: 'big-leave', kind: 'leave', btn: 'bigLeaveBtn', event: 'room:leave',
    label: '大画面「← 部屋を出る」' },
  { id: 'settings-leave', kind: 'leave', btn: null, event: 'room:leave',
    label: '設定→部屋→「部屋を出る」（data-setact="leaveRoom"）' },
  { id: 'settings-endgame-guest', kind: 'leave', btn: 'endGameBtn', event: 'room:leave',
    label: '設定→「ゲームを終了」（部屋の非ホスト＝自分だけ抜ける・第33弾B-4）' },
  { id: 'handoff-switch-guest', kind: 'leave', btn: null, event: 'room:leave',
    label: '「1台のスマホで遊ぶ」への切り替え確認（非ホスト・第33弾B-3）' },
  { id: 'host-close', kind: 'close', btn: 'rtEndBtn', event: 'room:close',
    label: '「部屋を閉じる」（rtEndBtn。bigEndBtn・設定→危険な操作→解散も同じ処理へ委譲）' },
  { id: 'handoff-switch-host', kind: 'close', btn: null, event: 'room:close',
    label: '「1台のスマホで遊ぶ」への切り替え確認（ホスト＝部屋を閉じる）' },
  { id: 'kicked', kind: 'passive', btn: null, event: 'room:kicked（受信）',
    label: '進行役に部屋から出された' },
  { id: 'closed', kind: 'passive', btn: null, event: 'room:closed（受信）',
    label: 'ホストが部屋を閉じた（全員が棚へ戻る）' },
  { id: 'lost', kind: 'passive', btn: null, event: 'lost（room_not_found）',
    label: '入り直したら部屋が消えていた（サーバー再起動・空き部屋の片付け）' },
  { id: 'disconnect', kind: 'passive', btn: null, event: 'disconnect',
    label: 'ブラウザ/タブを閉じる・通信断（名簿には「切断中」で残り、復帰を待つ仕様）' }
];

// ---- ゲーム開始のカウントダウンが呼ばれる経路 ----
// 部屋：サーバーが wolf:start 成功後に room:countdown を全員へ放送 →
//       rt-client の 'countdown' → FxKit.countdown()（fx.js・タップでスキップ可）。
//       ゲームを問わずこの1本（新ゲームでも自動的に対象になる）。
// 手渡し：scr-ready の「準備OK」長押し → scr-countdown（3-2-1-スタート！）。
//       全モードが scr-ready を通るのでこれも1本。
const COUNTDOWN_PATHS = [
  { id: 'room-start', mode: 'room', games: RT_GAME_IDS,
    label: '部屋：ホストの「はじめる ▶」→ wolf:start → room:countdown 放送' },
  { id: 'room-again', mode: 'room', games: RT_GAME_IDS,
    label: '部屋：「もう一度」→全員が待合へ→「はじめる ▶」（room-start と同一経路・第33弾B-1）' },
  { id: 'handoff-ready', mode: 'handoff', games: null,
    label: '手渡し：準備OK長押し → scr-countdown（全モード共通）' },
  { id: 'handoff-again', mode: 'handoff', games: null,
    label: '手渡し：「もう一度」→ scr-ready → 長押し → scr-countdown（第32弾-C）' }
];

// ---- 各ゲームを開始できる最小の設定（テスト用の正本） ----
// rtXxxConfig（index.html）が送る形の最小版。実サーバーで全ゲーム開始できることを確認済み。
// 新しいゲームを GAME_DRIVERS に足したのにここへ書き忘れると、
// tests/room-paths.js の「追加漏れ検出」テストが赤くなる（落とし穴4の恒久対策）
const START_TOPICS = ['傘', '冷蔵庫', 'ペンギン', '信号機', 'パトカー', '目覚まし時計', '自動販売機', 'ヘリコプター']
  .map((name) => ({ name, tier: 'easy', ng_words: [], aliases: [] }));
const RT_START_MIN_CONFIG = {
  wolfrole: { game: 'wolfrole', roles: ['wolf', 'seer'], turnLimit: 5, meetingSec: 0 },
  wordwolf: { game: 'wordwolf', wolfCount: 1, wolfAware: false, roles: {}, multiTurn: false, meetingSec: 0, discussSec: 0 },
  bomb: { game: 'bomb', mode: 'coop', counts: { easy: 2, normal: 1, hard: 0 }, lives: 3, timerSec: 120, topics: START_TOPICS },
  defuse: { game: 'defuse', mode: 'normal', manual: true, strikes: 3, timerSec: 0 },
  quizrush: { game: 'quizrush', timerSec: 60 },
  quizlist: { game: 'quizlist', timerSec: 60 },
  quizreveal: { game: 'quizreveal', timerSec: 60 },
  buzzer: { game: 'buzzer' },
  auction: { game: 'auction', mode: 'sealed', rounds: 3, bidSec: 60 }
};

module.exports = {
  RT_GAME_IDS,
  CASSETTE_GAME_IDS,
  HANDOFF_ONLY_GAME_IDS,
  RT_START_EVENT,
  RT_START_MIN_CONFIG,
  ROOM_ENTRY_PATHS,
  ROOM_EXIT_PATHS,
  COUNTDOWN_PATHS
};
