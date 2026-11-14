#!/usr/bin/env bash
# Preparação BASE da VPS (rodar UMA vez, serve para todas as aplicações).
# Ubuntu 22.04/24.04. Uso (como root):  bash preparar-vps.sh
#
# Instala: Nginx (proxy de todos os sites), Certbot (HTTPS), Node.js 22,
# Git, SQLite, firewall (UFW), Fail2ban e atualizações automáticas de segurança.
set -euo pipefail
if [[ $EUID -ne 0 ]]; then echo "Rode como root (sudo -i)."; exit 1; fi

echo "==> Atualizando o sistema"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y

echo "==> Pacotes base"
apt-get install -y curl git nginx certbot python3-certbot-nginx ufw fail2ban \
  sqlite3 ca-certificates unattended-upgrades htop

echo "==> Node.js 22"
if ! command -v node >/dev/null || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

echo "==> Atualizações automáticas de segurança"
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "==> Fail2ban (bloqueia força bruta no SSH)"
systemctl enable --now fail2ban

echo "==> Firewall: libera só SSH, HTTP e HTTPS"
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

echo "==> Nginx: site padrão responde 444 para domínios desconhecidos"
cat > /etc/nginx/sites-available/000-default <<'EOF'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
    return 444;
}
EOF
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/000-default /etc/nginx/sites-enabled/000-default
nginx -t && systemctl reload nginx

echo "==> Registro de portas das aplicações"
touch /etc/apps-portas.txt
mkdir -p /var/www /var/lib /var/backups

echo
echo "VPS pronta. Versões:"
echo "  node  $(node -v)"
echo "  nginx $(nginx -v 2>&1 | cut -d/ -f2)"
echo "Próximo passo: instalar cada aplicação (ex.: deploy/instalar-vps.sh do Bem Bordado)."
