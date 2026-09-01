#!/bin/bash
# tools/duckdns-update.sh — DuckDNSに「このサーバーのIPだよ」と定期的に伝える
#
# VPSのIPは固定なので、普段は更新の必要が無い。それでも定期的に叩くのは、
# **DuckDNSは長く更新の無いドメインを消すことがある**ため。
# ドメインが消えると、サーバーが元気でも誰も辿り着けない
# （2026-09の障害と同じ「アプリは無事なのに繋がらない」形になる）。
#
# 使い方：
#   1) /root/duckdns.env に token を置く（トークンは秘密。リポジトリには絶対に書かない）
#        DUCKDNS_TOKEN=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
#        DUCKDNS_DOMAIN=aresoredorekore
#      chmod 600 /root/duckdns.env
#   2) cron に置く（tools/vps-setup.sh が、この設定ファイルがあれば自動で入れる）
#        */5 * * * * /root/backend/tools/duckdns-update.sh >> /root/backend/duckdns.log 2>&1

set -uo pipefail
CONF="${DUCKDNS_CONF:-/root/duckdns.env}"

[ -f "$CONF" ] || { echo "[duckdns] $CONF が無い。何もしない"; exit 0; }
# shellcheck disable=SC1090
. "$CONF"

: "${DUCKDNS_TOKEN:?DUCKDNS_TOKEN が設定されていない}"
: "${DUCKDNS_DOMAIN:?DUCKDNS_DOMAIN が設定されていない}"

# ip を空にすると、DuckDNS側が「見えている送信元IP」を使ってくれる
RES=$(curl -fsS "https://www.duckdns.org/update?domains=${DUCKDNS_DOMAIN}&token=${DUCKDNS_TOKEN}&ip=")

if [ "$RES" = "OK" ]; then
  # 毎回書くとログが太るので、変化した時だけ残す
  LAST="/tmp/duckdns-last-ok"
  NOW=$(date '+%F %T')
  [ -f "$LAST" ] || echo "[duckdns] $NOW 更新できました（${DUCKDNS_DOMAIN}.duckdns.org）"
  echo "$NOW" > "$LAST"
  exit 0
fi

echo "[duckdns] $(date '+%F %T') 失敗しました（返事: ${RES:-空}）。トークンとドメイン名を確かめること"
exit 1
