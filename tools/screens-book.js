#!/usr/bin/env node
// tools/screens-book.js — 新しい見た目の画面のまとめ（指示66）を1枚の HTML にする
//
//   node tools/v2-shot.js --mock                       … 先に撮る（新しい画面と見本）
//   node tools/old-shots.js --base ../aresore-66base   … 入れかえ前の画面を撮る（あれば）
//   node tools/screens-book.js                         … docs/監査_指示66の画像/まとめ/index.html
//
// 1つの画面につき「前（入れかえ前の画面があれば）｜新しい画面｜見本」を横に並べる。並べるだけで、測るのは v2-shot.js。
// 写真は docs/監査_指示66の画像/ の中（git に入れない）を、相対の道で指す（ファイルを開けばそのまま見られる）

const fs = require('fs');
const path = require('path');
const { SCENES } = require('./v2-lab/scenes');

const ROOT = path.join(__dirname, '..');
const IMG = path.join(ROOT, 'docs', '監査_指示66の画像');
const OUT = path.join(IMG, 'まとめ');

/** 画面の名前（見本の番号と、何の画面か）。並べる順もこの順 */
const 章 = [
  { 題: '指示66-3：ふだんの画面（入口・部屋・ゲームをえらぶ）', 場面: [
    ['home-e1', 'E1 入口（3つだけ・ログインと設定は⚙）', ['old-入口']],
    ['home-e2a', 'E2 部屋に入る：コード（あと何文字か）', ['old-部屋に入る']],
    ['home-e2b', 'E2 部屋に入る：名前（前に使った名前が入っている）', []],
    ['home-e2qr', 'E2 QRを読む（カメラが使えない端末は案内）', []],
    ['home-e2tv', 'E2 TVとして入る（/tv・コードだけ）', []],
    ['home-e3', 'E3 部屋ができた（進行役：コード・TVに映す・ゲームをえらぶ）', ['old-部屋をつくる', 'old-待合-進行役']],
    ['home-e3-16', 'E3 16人の待合', []],
    ['home-e3-qr', 'E3 コードを押すと、部屋の QR', []],
    ['home-e3-tv', 'E3 TVに映す（手順）', []],
    ['home-e3-mem', 'E3 札の長押し（外す・進行役をゆずる・TVにする）', []],
    ['home-e3-menu', 'E3 待合の⚙（アルバム・ルールをもう一度・出る など）', []],
    ['home-e3-picked', '待合：ゲームが決まった後（準備OK・はじめる）', []],
    ['home-e4', 'E4 参加者の待合（自分の札を大きく）', ['old-待合-参加者']],
    ['home-e4-look', 'E4 着替え（文化祭と同じシート）', []],
    ['home-te3', 'TV の待合（QR が主役・コードは下の帯）', ['old-TV待合']],
    ['home-tv10', 'TV：進行役がえらんでいる間（10人・変えない）', []],
    ['home-tv16', 'TV：16人（札を低くして 3列×6段）', []],
    ['pick-list', 'ゲームをえらぶ：一覧（部屋・10人・遊べないものは理由つき）', ['old-棚-部屋のため']],
    ['pick-page', 'ゲームをえらぶ：ページ（人狼ゲーム）', []],
    ['pick-page-no', 'ページ：いまの人数で遊べない（主ボタンに理由）', []],
    ['pick-page-one', 'S5 部屋にいるのに1台で遊ぶゲーム', []],
    ['pick-one', '1台で遊ぶ：一覧（何人で遊ぶ？）', ['old-棚']],
    ['pick-one-heads', '1台で遊ぶ：何人で遊ぶ？', []],
    ['pick-one-login', 'S5 ログインしていない時', []],
    ['pick-one-make', '1台の一覧で、みんなのスマホで遊ぶゲーム（部屋をつくって遊ぶ）', []],
    ['game-quiz', 'S4 カセットの中のゲーム（クイズ王）', ['old-ゲーム']],
    ['game-sugo', 'S4 人数で遊べないゲームは点線で理由（すごろく・7人）', []],
    ['mode-bomb', 'S4 モード（ルール3つ・お休み中のゲーム）', ['old-モード']],
    ['dec', 'S6 決めた時（スマホ）', []],
    ['dec-tv', 'S6 決めた時（TV）', []],
    ['home-e5a', 'E5 つぎは？（進行役）', ['old-つぎは']],
    ['home-e5b', 'E5 つぎは？（参加者は待つ）', []],
    ['home-e5-close', 'E5 部屋をとじる（押した後にたずねる）', []]
  ] },
  { 題: '指示66-2：文化祭の流れ（投票ループ）', 場面: null, 前置き: 'fes2-' },
  { 題: '指示66-1：見た目の土台（文化祭の待合の試し・部品の見本）', 場面: [['fes-lobby', 'F3 待合（スマホ）', []], ['fes-tv', 'F3 待合（TV）', []], ['parts', '部品の見本', []]] }
];

function 画像(dir, name) { const p = path.join(IMG, dir, name); return fs.existsSync(p) ? '../' + dir + '/' + encodeURIComponent(name) : null; }
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); }

const 行 = [];
let 枚 = 0;
for (const c of 章) {
  const 場面 = c.場面 || SCENES.filter((s) => s.id.indexOf(c.前置き) === 0).map((s) => [s.id, (s.mock ? s.mock.id.toUpperCase() + ' ' : '') + s.id, []]);
  行.push('<h2>' + esc(c.題) + '</h2>');
  for (const [id, 題, 前] of 場面) {
    const scene = SCENES.filter((s) => s.id === id)[0];
    if (!scene) continue;
    const size = scene.kind === 'tv' ? '1920x1080' : '390x844';
    const 新 = 画像('shot', id + '_' + size + '_base.png');
    const 見本 = 画像('shot', 'mock_' + id + '_base.png');
    const 古 = 前.map((n) => 画像('old', n + '.png')).filter(Boolean);
    if (!新) continue;
    枚++;
    const fig = (src, cap, cls) => '<figure class="' + cls + '"><a href="' + src + '" target="_blank"><img loading="lazy" src="' + src + '" alt=""></a><figcaption>' + esc(cap) + '</figcaption></figure>';
    行.push('<section class="' + (scene.kind === 'tv' ? 'tv' : 'ph') + '"><h3>' + esc(題) + ' <small>' + esc(id) + '</small></h3><div class="row">' +
      古.map((s, i) => fig(s, '前' + (古.length > 1 ? (i + 1) : ''), 'old')).join('') +
      fig(新, '新しい画面', 'new') + (見本 ? fig(見本, '見本', 'mock') : '') + '</div></section>');
  }
}
const html = '<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>新しい画面のまとめ（指示66）</title><style>' +
  'body{margin:0;padding:16px;font-family:system-ui,sans-serif;background:#2B2B2E;color:#F4F4F5}h1{font-size:22px;margin:0 0 6px}p.n{margin:0 0 16px;color:#CFCFD4;font-size:14px}' +
  'h2{font-size:18px;margin:28px 0 10px;padding-top:10px;border-top:2px solid #555}h3{font-size:15px;margin:14px 0 6px}h3 small{color:#9A9AA2;font-weight:400}' +
  '.row{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-start}figure{margin:0}figcaption{font-size:12px;color:#CFCFD4;margin-top:3px}' +
  '.ph img{height:360px;width:auto;border-radius:8px;display:block}.tv img{height:240px;width:auto;border-radius:6px;display:block}' +
  'figure.new figcaption{color:#FFD782;font-weight:700}figure.old img{opacity:.92}' +
  '</style></head><body><h1>新しい画面のまとめ（指示66）</h1><p class="n">' + 枚 + '画面。1つの画面につき「前（入れかえ前があれば）｜新しい画面｜見本」。写真を押すと大きく開く。撮り直しは tools/screens-book.js の頭の手順。作った日：' + new Date().toISOString().slice(0, 10) + '</p>' +
  行.join('\n') + '</body></html>';
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'index.html'), html);
console.log('✔ ' + 枚 + '画面：' + path.relative(ROOT, path.join(OUT, 'index.html')));
