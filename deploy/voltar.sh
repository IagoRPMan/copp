#!/usr/bin/env bash
# Volta o COPP para a versão anterior à última publicação. Roda como root, na VPS.
# O banco não é mexido: esta versão não muda a estrutura das tabelas, então a anterior lê os mesmos dados.
set -euo pipefail
APP=/opt/copp
ANTERIOR="$APP.anterior"
[ "$(id -u)" -eq 0 ] || { echo "Rode como root." >&2; exit 1; }
[ -d "$ANTERIOR" ] || { echo "Não há versão anterior guardada em $ANTERIOR." >&2; exit 1; }
rm -rf "$APP.desfeita"
mv "$APP" "$APP.desfeita"
mv "$ANTERIOR" "$APP"
systemctl restart copp
sleep 3
if curl -fsS http://127.0.0.1:3210/saude >/dev/null 2>&1; then
  echo "Versão anterior no ar. A versão retirada ficou em $APP.desfeita."
else
  echo "Atenção: o sistema não respondeu em /saude. Veja: journalctl -u copp -n 50" >&2
  exit 1
fi
