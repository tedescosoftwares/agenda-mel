#!/usr/bin/env bash
#
# Empurra a fila de mensagens na hora, sem esperar o cron.
#
#   ./disparar.sh
#
# Na primeira vez ele pergunta o ref do projeto e a service role key,
# e guarda em .supabase para as próximas.

set -euo pipefail
cd "$(dirname "$0")"

if [ -f .supabase ]; then
  # shellcheck disable=SC1091
  set -a; . ./.supabase; set +a
else
  echo 'Ref do projeto (supabase.com/dashboard/project/XXXX):'
  read -rp '  > ' PROJECT_REF
  echo 'Service role key (Project Settings -> API -> service_role):'
  read -rsp '  > ' SERVICE_ROLE_KEY
  echo
  printf 'PROJECT_REF=%s\nSERVICE_ROLE_KEY=%s\n' "$PROJECT_REF" "$SERVICE_ROLE_KEY" > .supabase
  chmod 600 .supabase
fi

curl -sS -X POST "https://${PROJECT_REF}.supabase.co/functions/v1/enviar-whatsapp" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H 'Content-Type: application/json' \
  -d '{}'
echo
