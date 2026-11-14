#!/usr/bin/env bash
# Instala o Bem Bordado numa VPS Ubuntu (22.04/24.04) da Hostinger.
#
# Uso (como root, na VPS):
#   curl -fsSL https://raw.githubusercontent.com/rodrigoBrandaoDeSouza/bem-bordado/main/deploy/instalar-vps.sh -o instalar.sh
#   bash instalar.sh seudominio.com.br
#
# O que faz: Node 22, usuário de sistema, app em /var/www/bem-bordado,
# dados em /var/lib/bem-bordado, serviço systemd, Nginx, HTTPS (Let's Encrypt),
# firewall e backup diário do banco.
set -euo pipefail

DOMAIN="${1:-}"
REPO="${REPO:-https://github.com/rodrigoBrandaoDeSouza/bem-bordado.git}"
APP_DIR=/var/www/bem-bordado
DATA_DIR=/var/lib/bem-bordado
ENV_FILE=/etc/bem-bordado.env
APP_USER=bembordado
PORT=3000

if [[ $EUID -ne 0 ]]; then echo "Rode como root (sudo -i)."; exit 1; fi
if [[ -z "$DOMAIN" ]]; then echo "Uso: bash instalar.sh seudominio.com.br"; exit 1; fi

echo "==> Pacotes do sistema"
apt-get update -y
apt-get install -y curl git nginx certbot python3-certbot-nginx ufw sqlite3 ca-certificates

echo "==> Node.js 22"
if ! command -v node >/dev/null || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v

echo "==> Usuário e pastas"
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$DATA_DIR" /var/backups/bem-bordado
chown -R "$APP_USER:$APP_USER" "$DATA_DIR"
chmod 750 "$DATA_DIR"

echo "==> Código"
if [[ -d "$APP_DIR/.git" ]]; then
  git -C "$APP_DIR" pull --ff-only
else
  git clone "$REPO" "$APP_DIR"
fi
cd "$APP_DIR"
npm ci --omit=dev
chown -R root:root "$APP_DIR"

echo "==> Configuração"
if [[ ! -f "$ENV_FILE" ]]; then
  ADMIN_PASS="$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 14)"
  cat > "$ENV_FILE" <<EOF
NODE_ENV=production
PORT=$PORT
DATA_DIR=$DATA_DIR
ADMIN_USER=admin
ADMIN_PASS=$ADMIN_PASS
EOF
  chmod 600 "$ENV_FILE"
  NEW_PASS=1
fi

echo "==> Serviço systemd"
cat > /etc/systemd/system/bem-bordado.service <<EOF
[Unit]
Description=Bem Bordado (site e painel)
After=network.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$DATA_DIR
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now bem-bordado
systemctl restart bem-bordado

echo "==> Nginx"
cat > /etc/nginx/sites-available/bem-bordado <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN www.$DOMAIN;

    client_max_body_size 8m;

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
ln -sf /etc/nginx/sites-available/bem-bordado /etc/nginx/sites-enabled/bem-bordado
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo "==> Firewall"
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

echo "==> Backup diário do banco (03:30, guarda 14 dias)"
cat > /etc/cron.d/bem-bordado-backup <<EOF
30 3 * * * root sqlite3 $DATA_DIR/bembordado.db ".backup /var/backups/bem-bordado/bembordado-\$(date +\%F).db" && tar -czf /var/backups/bem-bordado/uploads-\$(date +\%F).tar.gz -C $DATA_DIR uploads && find /var/backups/bem-bordado -type f -mtime +14 -delete
EOF

echo "==> HTTPS (Let's Encrypt)"
if certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" --redirect --agree-tos --register-unsafely-without-email -n; then
  echo "HTTPS ativo."
else
  echo
  echo "!! Não consegui emitir o certificado. Confira se o DNS de $DOMAIN e www.$DOMAIN"
  echo "!! aponta para o IP desta VPS e rode depois:"
  echo "!!   certbot --nginx -d $DOMAIN -d www.$DOMAIN --redirect"
  echo "!! (Sem HTTPS o login do painel não funciona, porque o cookie é 'Secure'.)"
fi

sleep 1
systemctl --no-pager --lines=5 status bem-bordado || true

echo
echo "=============================================="
echo " Site:   https://$DOMAIN"
echo " Painel: https://$DOMAIN/admin"
if [[ "${NEW_PASS:-}" == 1 ]]; then
  echo " Login:  admin / $ADMIN_PASS"
  echo " (anote! troque em Configurações depois de entrar)"
fi
echo "=============================================="
