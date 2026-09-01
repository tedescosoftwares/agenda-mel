#!/usr/bin/env bash
#
# Empurra a fila de mensagens na hora, sem esperar o cron.
#
#   ./disparar.sh          envia o que está na fila
#   ./disparar.sh --trocar esquece as credenciais e pergunta de novo
#
# Na primeira vez pergunta o ref do projeto e a chave de serviço, e
# guarda em .supabase para as próximas.

set -euo pipefail
cd "$(dirname "$0")"

verde()   { printf '\033[1;32m%s\033[0m\n' "$*"; }
amarelo() { printf '\033[1;33m%s\033[0m\n' "$*"; }
vermelho(){ printf '\033[1;31m%s\033[0m\n' "$*"; }

[ "${1:-}" = '--trocar' ] && rm -f .supabase

# A chave de serviço tem duas formas conhecidas. Qualquer outra coisa
# é engano — e o erro que o Supabase devolve ("Invalid JWT") não ajuda
# em nada a descobrir que você colou a chave errada.
chave_valida() {
  case "$1" in
    eyJ*)        [ ${#1} -gt 100 ] ;;   # JWT (projetos antigos)
    sb_secret_*) [ ${#1} -gt 20 ]  ;;   # formato novo
    *)           return 1 ;;
  esac
}

if [ -f .supabase ]; then
  # shellcheck disable=SC1091
  set -a; . ./.supabase; set +a
fi

if [ -z "${SERVICE_ROLE_KEY:-}" ] || ! chave_valida "${SERVICE_ROLE_KEY:-}"; then
  if [ -n "${SERVICE_ROLE_KEY:-}" ]; then
    vermelho 'A chave guardada não parece uma chave de serviço do Supabase.'
    echo "   (guardada: ${#SERVICE_ROLE_KEY} caracteres, começa com ${SERVICE_ROLE_KEY:0:10})"
    echo
  fi

  echo 'Preciso de duas coisas do Supabase:'
  echo
  echo '  REF DO PROJETO — Project Settings -> General -> Reference ID'
  read -rp '    > ' PROJECT_REF

  echo
  echo '  CHAVE DE SERVIÇO — Project Settings -> API Keys'
  echo '    Use o botão de copiar. É a "service_role" ou a "secret",'
  echo '    NUNCA a anon/publishable. Ela começa com eyJ ou sb_secret_.'
  read -rsp '    > ' SERVICE_ROLE_KEY
  echo

  SERVICE_ROLE_KEY=$(printf '%s' "$SERVICE_ROLE_KEY" | tr -d ' \t\r\n')
  PROJECT_REF=$(printf '%s' "$PROJECT_REF" | tr -d ' \t\r\n')

  if ! chave_valida "$SERVICE_ROLE_KEY"; then
    echo
    vermelho 'Essa não é a chave de serviço.'
    echo "   Você colou ${#SERVICE_ROLE_KEY} caracteres começando com '${SERVICE_ROLE_KEY:0:10}'."
    echo '   A certa começa com eyJ (projeto antigo) ou sb_secret_ (novo).'
    echo '   Não é a chave da Evolution, nem a anon.'
    exit 1
  fi

  printf 'PROJECT_REF=%s\nSERVICE_ROLE_KEY=%s\n' "$PROJECT_REF" "$SERVICE_ROLE_KEY" > .supabase
  chmod 600 .supabase
  verde 'Guardado.'
fi

echo 'Empurrando a fila...'
RESPOSTA=$(curl -sS -X POST \
  "https://${PROJECT_REF}.supabase.co/functions/v1/enviar-whatsapp" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H 'Content-Type: application/json' \
  -d '{}' 2>&1 || true)

echo "$RESPOSTA"

case "$RESPOSTA" in
  *INVALID_JWT*|*'Invalid JWT'*)
    echo
    vermelho 'O Supabase recusou a chave.'
    echo 'Rode  ./disparar.sh --trocar  e cole a chave de serviço certa.'
    ;;
  *'não autorizado'*)
    echo
    vermelho 'A chave passou pelo portão mas a função recusou.'
    echo 'Isso é chave de serviço de OUTRO projeto. Confira o ref.'
    ;;
  *puxadas*)
    echo
    verde 'A função rodou. Confira o resultado no banco:'
    echo '    select status, erro from public.message_outbox'
    echo '    order by criado_em desc limit 5;'
    ;;
esac
