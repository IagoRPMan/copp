#!/usr/bin/env bash
# Publica uma versão nova do COPP na VPS. Roda como root, na VPS.
# Uso: bash publicar.sh /tmp/copp-publicar.tar.gz [--sem-contabilidade]
#
# Passos: backup do banco → instala a versão nova ao lado da atual → roda os testes →
# confere se há alguém da Contabilidade com acesso → troca as pastas → reinicia →
# confere /saude. Se o sistema não responder, volta sozinho para a versão anterior.
set -euo pipefail

PACOTE="${1:-}"
APP=/opt/copp
DADOS=/var/lib/copp
NOVA="$APP.nova"
ANTERIOR="$APP.anterior"
PORTA=3210

passo() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
falha() { printf '\n\033[1;31mERRO: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || falha "rode como root."
[ -f "$PACOTE" ] || falha "pacote não encontrado: '$PACOTE'. Uso: bash publicar.sh /tmp/copp-publicar.tar.gz"
[ -d "$APP" ] || falha "$APP não existe. Este script atualiza uma instalação existente."
command -v node >/dev/null || falha "node não encontrado."

passo "1/7 Backup do banco antes de mexer em qualquer coisa"
( cd "$APP" && sudo -u copp DATA_DIR="$DADOS" node --disable-warning=ExperimentalWarning scripts/backup.js )

passo "2/7 Instalando a versão nova em $NOVA (a atual continua no ar)"
rm -rf "$NOVA"
mkdir -p "$NOVA"
tar -xzf "$PACOTE" -C "$NOVA"
( cd "$NOVA" && npm ci --omit=dev --no-audit --no-fund --loglevel=error )

passo "3/7 Rodando os testes da versão nova (em banco descartável)"
( cd "$NOVA" && node --disable-warning=ExperimentalWarning --test ) || { rm -rf "$NOVA"; falha "testes falharam. Nada foi trocado; o sistema continua na versão atual."; }

passo "4/7 Conferindo se alguém da Contabilidade tem acesso (agora só ela libera lançamentos)"
QTD=$(cd "$NOVA" && DB="$DADOS/copp.db" node --disable-warning=ExperimentalWarning -e '
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(process.env.DB, { readOnly: true });
  const lista = db.prepare(`SELECT u.login, u.nome FROM usuarios u JOIN departamentos d ON d.id = u.departamento_id
                            WHERE d.funcao = ? AND u.ativo = 1 AND u.senha_hash IS NOT NULL`).all("contabilidade");
  for (const u of lista) console.error("   - " + u.login + " (" + u.nome + ")");
  console.log(lista.length);')
if [ "$QTD" -eq 0 ]; then
  if [ "${2:-}" != "--sem-contabilidade" ]; then
    rm -rf "$NOVA"
    falha "ninguém da Contabilidade tem senha. Depois da publicação, só o administrador conseguiria liberar.
Coloque a pessoa no departamento CONTABILIDADE e gere a senha em Cadastros → Usuários, ou rode de novo com --sem-contabilidade."
  fi
  echo "   Nenhuma pessoa da Contabilidade com acesso; seguindo por causa de --sem-contabilidade."
else
  echo "   $QTD pessoa(s) da Contabilidade com acesso."
fi

passo "5/7 Trocando as versões (a atual fica guardada em $ANTERIOR)"
rm -rf "$ANTERIOR"
mv "$APP" "$ANTERIOR"
mv "$NOVA" "$APP"
chown -R --reference="$ANTERIOR" "$APP"

passo "6/7 Reiniciando o serviço"
systemctl restart copp

passo "7/7 Conferindo se o sistema respondeu"
for _ in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:$PORTA/saude" >/dev/null 2>&1; then
    rm -f "$PACOTE"
    printf '\n\033[1;32mPublicado. O sistema respondeu em /saude.\033[0m\n'
    echo "Versão anterior guardada em $ANTERIOR. Para voltar: bash $APP/deploy/voltar.sh"
    exit 0
  fi
  sleep 1
done

echo "O sistema não respondeu em 20 segundos. Últimas linhas do log:"
journalctl -u copp -n 30 --no-pager || true
echo "Voltando para a versão anterior..."
rm -rf "$APP"
mv "$ANTERIOR" "$APP"
systemctl restart copp
falha "a publicação foi desfeita e a versão anterior está no ar de novo. Veja o log acima."
