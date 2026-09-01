#!/bin/bash
# tools/vps-setup.sh — まっさらなUbuntuサーバーに「あつまれ、あれこれ」を立て直す
#
# 2026-09、旧VPSがデータごと消えた時に、手順が誰の頭の中にも無かった。
# 次に同じことが起きた時、この1本を流せば戻せるようにする。
#
# 使い方（サーバーにrootでSSHしてから）：
#   apt-get update && apt-get install -y git
#   git clone https://github.com/kumakunna/aresoredorekore.git /root/backend
#   bash /root/backend/tools/vps-setup.sh
#
# 何度流しても壊れない（入っているものは入れ直さない）ように書いてある。
# HTTPS（Let's Encrypt）だけは、ドメインが新しいIPを向いた後でないと取れないので、
# この script の最後に出る案内にしたがって別に実行すること。

set -uo pipefail

APP_DIR="${APP_DIR:-/root/backend}"
APP_NAME="${APP_NAME:-aresoredorekore-backend}"
REPO="https://github.com/kumakunna/aresoredorekore.git"
NODE_MAJOR=24           # package.json の engines は >=22。開発機と同じ24系に揃える
DOMAIN="${DOMAIN:-aresoredorekore.duckdns.org}"
BACKUP_DIR="${BACKUP_DIR:-/root/backups/aresoredorekore}"

say() { echo ""; echo "=== $* ==="; }

# ---------- 1. 土台 ----------
say "1. パッケージの更新と、必要なものの導入"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
# build-essential と python3 は better-sqlite3 の保険。
# 出来合いのバイナリが落ちてこない時、ここが無いと npm install がその場で失敗する
apt-get install -y curl git ca-certificates build-essential python3 ufw nginx cron

say "2. Node.js ${NODE_MAJOR}.x（NodeSource）"
# Ubuntu標準のnodeは古く、better-sqlite3（engines: >=22）が動かない
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi
echo "node $(node -v) / npm $(npm -v)"

say "3. pm2"
command -v pm2 >/dev/null 2>&1 || npm install -g pm2

# ---------- 2. コード ----------
say "4. コードの配置（$APP_DIR）"
if [ ! -d "$APP_DIR/.git" ]; then
  git clone "$REPO" "$APP_DIR"
fi
cd "$APP_DIR" || exit 1
git pull --ff-only
npm install --omit=dev --no-audit --no-fund

# ---------- 3. .env ----------
say "5. .env（秘密の値。ここで作る）"
if [ -f "$APP_DIR/.env" ]; then
  echo ".env は既にあります。作り直したい時は消してから流し直してください"
else
  # 合言葉とAPIキーは、公開リポジトリに書けない。ここで手で入れてもらう
  read -rp "登録コード（合言葉／カンマ区切りで複数可）: " REG
  read -rp "Gemini APIキー（後で入れるなら空のままEnter）: " GKEY
  SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  cat > "$APP_DIR/.env" <<ENVEOF
REGISTER_CODE=${REG}
SESSION_SECRET=${SECRET}
GEMINI_API_KEY=${GKEY}
NODE_ENV=production
PORT=3001
ENVEOF
  chmod 600 "$APP_DIR/.env"
  echo ".env を作りました（600・所有者だけが読める）"
fi

# ---------- 4. 起動 ----------
say "6. pm2 で起動し、再起動後も自動で上がるようにする"
if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  pm2 restart "$APP_NAME" --update-env
else
  pm2 start "$APP_DIR/server.js" --name "$APP_NAME"
fi
pm2 startup systemd -u root --hp /root >/dev/null
pm2 save

# ---------- 5. Nginx ----------
say "7. Nginx（リバースプロキシ）"
# socket.io（WebSocket）が通るように Upgrade ヘッダを渡すこと。
# ここが抜けると、画面は出るのに部屋だけ繋がらない、という分かりにくい壊れ方をする
cat > /etc/nginx/sites-available/aresoredorekore <<NGINXEOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    client_max_body_size 2m;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 600s;
    }
}
NGINXEOF
ln -sf /etc/nginx/sites-available/aresoredorekore /etc/nginx/sites-enabled/aresoredorekore
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# ---------- 6. ファイアウォール ----------
say "8. ファイアウォール（ufw）"
# SSHのポートを sshd_config から読んで開ける。決め打ちにすると、
# ポートを変えていた時に自分で自分を締め出す
SSH_PORT=$(awk '/^[[:space:]]*Port[[:space:]]+[0-9]+/ {print $2; exit}' /etc/ssh/sshd_config)
SSH_PORT=${SSH_PORT:-22}
echo "SSHポートは ${SSH_PORT} と判断しました"
ufw allow "${SSH_PORT}/tcp"
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ufw status verbose
# アプリのポート3001は開けない。外からはNginx（80/443）だけを通す

# ---------- 7. cron ----------
say "9. cron（自動反映と、毎日のバックアップ）"
chmod +x "$APP_DIR/tools/deploy.sh"
mkdir -p "$BACKUP_DIR"
CRON_DEPLOY="*/2 * * * * ${APP_DIR}/tools/deploy.sh >> ${APP_DIR}/deploy.log 2>&1"
CRON_BACKUP="10 4 * * * /usr/bin/node ${APP_DIR}/tools/backup-db.js >> ${APP_DIR}/backup.log 2>&1"
CRON_LOGCUT="0 5 * * 0 /usr/bin/find ${APP_DIR} -maxdepth 1 -name '*.log' -size +10M -delete"
# DuckDNSは、長く更新の無いドメインを消すことがある。
# 設定ファイル（/root/duckdns.env）を置いてあれば、生かし続ける見張りも入れる
CRON_DUCK=''
if [ -f /root/duckdns.env ]; then
  chmod +x "$APP_DIR/tools/duckdns-update.sh"
  CRON_DUCK="*/5 * * * * ${APP_DIR}/tools/duckdns-update.sh >> ${APP_DIR}/duckdns.log 2>&1"
  echo "DuckDNSの定期更新も入れます（/root/duckdns.env を見つけました）"
else
  echo "DuckDNSの定期更新は入れません（/root/duckdns.env が無い。作り方は tools/duckdns-update.sh の先頭）"
fi

CUR=$(crontab -l 2>/dev/null | grep -v 'tools/deploy.sh' | grep -v 'tools/backup-db.js' | grep -v 'tools/duckdns-update.sh' | grep -v "maxdepth 1 -name '\*.log'")
printf '%s\n%s\n%s\n%s\n%s\n' "$CUR" "$CRON_DEPLOY" "$CRON_BACKUP" "$CRON_LOGCUT" "$CRON_DUCK" | grep -v '^$' | crontab -
crontab -l

say "10. バックアップを1回、いま取ってみる"
node "$APP_DIR/tools/backup-db.js"

say "ここまで完了"
cat <<DONE

いまの状態：
  ・アプリ    http://$(hostname -I | awk '{print $1}')/  （IP直打ちで見えるはず）
  ・pm2       pm2 status / pm2 logs ${APP_NAME}
  ・自動反映  2分おき（${APP_DIR}/deploy.log）
  ・バックアップ 毎日4:10（${BACKUP_DIR}、${APP_DIR}/backup.log）

つぎにやること（この順番で）：
  1) DuckDNSの管理画面で ${DOMAIN} を、このサーバーのIPに向け直す
     （あわせて /root/duckdns.env にトークンを置き、この script を流し直すと、
       ドメインが放置で消えないように5分おきの見張りが入る）
  2) 向いたことを確かめる：  dig +short ${DOMAIN}
  3) HTTPSを取る：
       apt-get install -y certbot python3-certbot-nginx
       certbot --nginx -d ${DOMAIN} --redirect -m <メールアドレス> --agree-tos --no-eff-email
     （certbotが自動更新のタイマーも入れてくれる）
DONE
