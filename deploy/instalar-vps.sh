#!/usr/bin/env bash
# Instala o Bem Bordado numa VPS que já passou pelo preparar-vps.sh.
# Convive com outras aplicações: usa porta própria, usuário próprio e um
# arquivo de site próprio no Nginx; não mexe no firewall nem em outros sites.
#
# Uso (como root):
#   bash instalar-vps.sh <dominio> [porta]
#   ex.: bash instalar-vps.sh bembordado.com.br 3101
#        bash instalar-vps.sh bembordado.seudominio.com.br 3101   (subdomínio)
#
# Variáveis opcionais: EMAIL=voce@exemplo.com (avisos do certificado HTTPS)
set -euo pipefail

DOMAIN="${1:-}"
PORT="${2:-3101}"
APP=bem-bordado
REPO="${REPO:-https://github.com/rodrigoBrandaoDeSouza/bem-bordado.git}"
APP_DIR=/var/www/$APP
DATA_DIR=/var/lib/$APP
ENV_FILE=/etc/$APP.env
APP_USER=bembordado
PORTS_FILE=/etc/apps-portas.txt

if [[ $EUID -ne 0 ]]; then echo "Rode como root (sudo -i)."; exit 1; fi
if [[ -z "$DOMAIN" ]]; then echo "Uso: bash instalar-vps.sh <dominio> [porta]"; exit 1; fi
for bin in node nginx certbot git sqlite3; do
  command -v "$bin" >/dev/null || { echo "Falta '$bin'. Rode antes o preparar-vps.sh."; exit 1; }
done
if [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]]; then
  echo "Node 22+ é necessário (atual: $(node -v))."; exit 1
fi

# Porta: não pode estar em uso por outra aplicação (a não ser este próprio app)
if ss -ltn "( sport = :$PORT )" | grep -q LISTEN && ! grep -q "^$APP $PORT " "$PORTS_FILE" 2>/dev/null; then
  echo "A porta $PORT já está em uso. Escolha outra:  bash instalar-vps.sh $DOMAIN 3102"
  echo "Portas registradas:"; cat "$PORTS_FILE" 2>/dev/null || true
  exit 1
fi

# Subdomínio (a.b.c) não ganha www; domínio raiz (a.com / a.com.br) ganha.
NAMES="$DOMAIN"
DOTS=$(tr -cd '.' <<<"$DOMAIN" | wc -c)
if [[ $DOTS -eq 1 || ( $DOTS -eq 2 && "$DOMAIN" =~ \.(com|net|org|art|blog)\.br$ ) ]]; then
  NAMES="$DOMAIN www.$DOMAIN"
fi

echo "==> Usuário e pastas"
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$DATA_DIR" /var/backups/$APP
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

echo "==> Configuração ($ENV_FILE)"
if [[ ! -f "$ENV_FILE" ]]; then
  ADMIN_PASS="$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 14 || true)"
  cat > "$ENV_FILE" <<EOF
NODE_ENV=production
PORT=$PORT
DATA_DIR=$DATA_DIR
ADMIN_USER=admin
ADMIN_PASS=$ADMIN_PASS
EOF
  chmod 600 "$ENV_FILE"
  NEW_PASS=1
else
  sed -i "s/^PORT=.*/PORT=$PORT/" "$ENV_FILE"
fi

echo "==> Serviço systemd ($APP)"
cat > /etc/systemd/system/$APP.service <<EOF
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
systemctl enable "$APP" >/dev/null
systemctl restart "$APP"

echo "==> Nginx ($NAMES -> 127.0.0.1:$PORT)"
cat > /etc/nginx/sites-available/$APP <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $NAMES;

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
ln -sf /etc/nginx/sites-available/$APP /etc/nginx/sites-enabled/$APP
nginx -t
systemctl reload nginx

echo "==> Registro de porta"
touch "$PORTS_FILE"
sed -i "/^$APP /d" "$PORTS_FILE"
echo "$APP $PORT $DOMAIN" >> "$PORTS_FILE"

echo "==> Backup diário (03:30, guarda 14 dias)"
cat > /etc/cron.d/$APP-backup <<EOF
30 3 * * * root sqlite3 $DATA_DIR/bembordado.db ".backup /var/backups/$APP/bembordado-\$(date +\%F).db" && tar -czf /var/backups/$APP/uploads-\$(date +\%F).tar.gz -C $DATA_DIR uploads && find /var/backups/$APP -type f -mtime +14 -delete
EOF

echo "==> HTTPS (Let's Encrypt)"
CERT_ARGS=()
for n in $NAMES; do CERT_ARGS+=(-d "$n"); done
if [[ -n "${EMAIL:-}" ]]; then MAIL_ARGS=(-m "$EMAIL"); else MAIL_ARGS=(--register-unsafely-without-email); fi
if certbot --nginx "${CERT_ARGS[@]}" --redirect --agree-tos "${MAIL_ARGS[@]}" -n; then
  echo "HTTPS ativo."
else
  echo
  echo "!! Certificado não emitido. Confira se o DNS de: $NAMES"
  echo "!! aponta para o IP desta VPS e rode depois:"
  echo "!!   certbot --nginx ${CERT_ARGS[*]} --redirect"
  echo "!! (Sem HTTPS o login do painel não funciona: o cookie é 'Secure'.)"
fi

sleep 1
systemctl --no-pager --lines=5 status "$APP" || true

echo
echo "=============================================="
echo " Site:   https://$DOMAIN"
echo " Painel: https://$DOMAIN/admin"
echo " Porta interna: $PORT   (registro: $PORTS_FILE)"
if [[ "${NEW_PASS:-}" == 1 ]]; then
  echo " Login:  admin / $ADMIN_PASS"
  echo " (anote! e troque em Configurações depois de entrar)"
fi
echo "=============================================="
