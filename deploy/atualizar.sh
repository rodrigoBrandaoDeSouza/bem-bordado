#!/usr/bin/env bash
# Publica a versão mais recente do GitHub na VPS.
# Uso (como root, na VPS):  bash /var/www/bem-bordado/deploy/atualizar.sh
set -euo pipefail
cd /var/www/bem-bordado
git pull --ff-only
npm ci --omit=dev
systemctl restart bem-bordado
sleep 1
systemctl --no-pager --lines=3 status bem-bordado
echo "Atualizado: $(git log --oneline -1)"
