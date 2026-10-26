# tools/sound — 効果音と司会の声を作る台本（指示68-2 第3節・第6節）

アプリの音は `public/js/sound.js`（音の箱）が `public/sound/` から読む。ここは、そのファイルを作る台本の置き場。

## earshot を使う条件（くまくんの決め 2026-10-26・変えない）

1. **コミット `591fa3e`（release 0.4.0）に固定して、上げない。**台本は動く前に `.cache/earshot` のコミットを確かめ、違えば止まる
2. **音の部品（`earshot.forge` の `bank`）だけを使う。**モデル（torch・CLAP・AST）は入れない・使わない。
   台本が読むのは `bank.render`（部品から音を作る）と、`bank` が中で使う大きさの測り（`forge.polish.lufs_max`）だけ
3. **earshot を動かすのは `tools/sound/` の台本だけ。**アプリ・テスト・ほかの道具からは読まない（アプリに入るのは書き出した mp3 だけ）

Claude Code の許可は `.claude/settings.local.json`（その端末だけ・git に入れない）に `.cache/earshot-venv/Scripts/python` を足してある。

## 下ごしらえ（1回だけ。`.cache/` は git に入れない）

```
git clone https://github.com/Leonxlnx/earshot.git .cache/earshot
git -C .cache/earshot checkout 591fa3e
python -m venv .cache/earshot-venv
.cache/earshot-venv/Scripts/python -m pip install numpy scipy soundfile soxr pyloudnorm
```

mp3 は ffmpeg を使わず、soundfile（libsndfile 1.2.2）で読み書きする。

## 台本

| 台本 | すること | 書き出す物 |
|---|---|---|
| `make-se.py` | 効果音を表 `SE` から作る。大きさを「瞬間の大きさの最大」-25 ±2 LUFS・最大 -1dBFS 以下にそろえる。`--check` で、作り直すと同じ音になるかを見る | `public/sound/se/<ID>-<n>.mp3`・`public/sound/index.json` の `se`・`記録.json`・`docs/音の見本帳/` |
| `import-voice.py` | くまくんの録音（`docs/声の素材/`・git に入れない）から司会の声を作る。前後の無音を切る・1つのファイルに何回か録ってあれば分ける・大きさをそろえる | `public/sound/voice/<ID>-<n>.mp3`・`public/sound/index.json` の `voice`・`声の記録.json` |

音を変える時は、表を直して作り直す（mp3 を手で直さない）。「いい音か」は台本には決められないので、`docs/音の見本帳/見本帳.mp3` をくまくんが聞いて決める。
