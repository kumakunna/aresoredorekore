// register-code.js — 新規登録の合言葉（登録コード）の照合。
//
// 合言葉は**複数持てる**。`.env` の REGISTER_CODE にカンマ区切りで並べる。
//   REGISTER_CODE=kumakunn,claude,test
// 1つだけ書けば、これまで通り1つだけが通る。
//
// 照合は「前後の空白を落とす」「大文字小文字を区別しない」。
// スマホのキーボードは先頭を勝手に大文字にしたり、貼り付けに空白を混ぜたりする。
// そこで弾かれても、遊ぶ人には「合っているのに違うと言われる」としか見えず、
// 自分では直しようがない（プレイヤーファースト）。

function parseRegisterCodes(raw) {
  return String(raw == null ? '' : raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizeCode(s) {
  return String(s == null ? '' : s).trim().toLowerCase();
}

function matchesRegisterCode(input, codes) {
  const typed = normalizeCode(input);
  if (!typed) return false;
  return (codes || []).some((c) => normalizeCode(c) === typed);
}

module.exports = { parseRegisterCodes, normalizeCode, matchesRegisterCode };
