#!/bin/bash
# tools/deploy.sh — GitHubに新しいコミットがあれば取り込んで入れ替える（VPSのcronから2分おき）
#
# 旧サーバーで動いていた「2分おきに git pull → npm install → pm2 restart」を、
# リポジトリの中に置き直したもの（サーバーだけにあると、サーバーが消えた時に一緒に消える。
# 2026-09の障害で実際にそうなった）。
#
# cron への登録は tools/vps-setup.sh が行う。手で入れるなら：
#   */2 * * * * /root/backend/tools/deploy.sh >> /root/backend/deploy.log 2>&1
#
# 気をつけていること：
#   ・二重起動しない（flock）。npm install の最中にもう1本走ると壊れる
#   ・**変更が無い時は何もしない**。毎回 restart すると、その度に全部屋が消える（運用メモ参照）
#   ・pm2 restart は、遊んでいる人の部屋を消す。だから「本当に更新がある時だけ」

set -uo pipefail

APP_DIR="${APP_DIR:-/root/backend}"
APP_NAME="${APP_NAME:-aresoredorekore-backend}"
BRANCH="${BRANCH:-main}"
LOCK="/tmp/aresoredorekore-deploy.lock"

exec 9>"$LOCK"
flock -n 9 || exit 0   # 前回がまだ走っている。黙って見送る

cd "$APP_DIR" || { echo "[deploy] $APP_DIR が無い"; exit 1; }

git fetch origin "$BRANCH" --quiet || { echo "[deploy] $(date '+%F %T') git fetch に失敗"; exit 1; }

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "origin/$BRANCH")
[ "$LOCAL" = "$REMOTE" ] && exit 0   # 更新なし。何もしない（restartしない）

echo "[deploy] $(date '+%F %T') 更新あり ${LOCAL:0:7} -> ${REMOTE:0:7}"

# 入れ替えの前に、いまのデータベースを1つ取っておく。
# 「新しいコードが起動しない」だけなら git reset で戻せるが、
# 起動時にスキーマを触る変更が入った時のための保険
node "$APP_DIR/tools/backup-db.js" || echo "[deploy] バックアップに失敗（続行する）"

git reset --hard "origin/$BRANCH" --quiet || { echo "[deploy] git reset に失敗"; exit 1; }
npm install --omit=dev --no-audit --no-fund || { echo "[deploy] npm install に失敗。restartは見送る"; exit 1; }
pm2 restart "$APP_NAME" --update-env || { echo "[deploy] pm2 restart に失敗"; exit 1; }
echo "[deploy] $(date '+%F %T') 反映しました（$(git rev-parse --short HEAD)）"
