// emoji-list.js — public/img/emoji/ に置いてあるSVGの一覧（自動生成）
//
// 手で書くと、ファイルを足した時に更新し忘れる。
// 作り直すには: node tools/gen-emoji-list.js
// ここに無い文字は、差し替えずに文字のまま出る（← → ★ ✕ などのUI記号）。
(function (root) {
  var files = ["1f0cf", "1f300", "1f319", "1f324", "1f331", "1f372", "1f381", "1f388", "1f389", "1f38a", "1f38f", "1f392", "1f393", "1f399", "1f39b", "1f39f", "1f3a4", "1f3a8", "1f3aa", "1f3ab", "1f3ad", "1f3ae", "1f3af", "1f3b2", "1f3b4", "1f3c1", "1f3c3", "1f3c5", "1f3c6", "1f3d8", "1f3db", "1f3e0", "1f3f7", "1f411", "1f43a", "1f440", "1f447", "1f449", "1f451", "1f465", "1f480", "1f48e", "1f493", "1f494", "1f49a", "1f49e", "1f4a1", "1f4a3", "1f4a5", "1f4ac", "1f4b0", "1f4be", "1f4ca", "1f4d0", "1f4d6", "1f4d8", "1f4db", "1f4e2", "1f4e3", "1f4e6", "1f4f1", "1f4f3", "1f4fa", "1f501", "1f504", "1f50a", "1f50c", "1f50d", "1f50e", "1f510", "1f511", "1f512", "1f525", "1f527", "1f528", "1f52e", "1f534", "1f535", "1f54a", "1f550", "1f552", "1f56f", "1f590", "1f5a4", "1f5bc", "1f5d1", "1f5e3", "1f5f3", "1f642", "1f646", "1f648", "1f64b", "1f6aa", "1f6ab", "1f6d2", "1f6e1", "1f7e0", "1f7e1", "1f7e2", "1f7e3", "1f916", "1f91d", "1f940", "1f94a", "1f98a", "1f9e0", "1f9e8", "1f9e9", "1f9ed", "1f9f0", "1fae7", "2194", "21a9", "2666", "2696", "2699", "26a0", "26a1", "2705", "2709", "2716", "2728", "274c", "2764", "2795", "27a1", "2b55"];
  if (typeof module === "object" && module.exports) module.exports = files;
  else if (root.EmojiSvg) root.EmojiSvg.setFiles(files);
}(typeof self !== "undefined" ? self : this));
