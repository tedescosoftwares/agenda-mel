#!/usr/bin/env bash
#
# Agenda Mel — publica as Edge Functions no Supabase.
#
#   ./supabase/publicar.sh          publica as duas
#   ./supabase/publicar.sh --trocar esquece o token e pergunta de novo
#
# Existe porque `supabase functions deploy` sozinho falha com
# "Access token not provided", e porque o webhook PRECISA do
# --no-verify-jwt: quem chama ele é a Evolution, que não tem JWT do
# Supabase. Publicar sem essa opção derruba o bot inteiro com 401, e o
# erro aparece do lado da Evolution, não aqui — dá para perder uma
# tarde procurando no lugar errado.
#
# O token fica em evolution/.env, o mesmo lugar que o conectar.sh usa.
# Um arquivo só de credenciais é mais fácil de proteger que três.

set -euo pipefail
cd "$(dirname "$0")/.."
RAIZ=$(pwd)
ENV=evolution/.env

verde()   { printf '\033[1;32m%s\033[0m\n' "$*"; }
amarelo() { printf '\033[1;33m%s\033[0m\n' "$*"; }
vermelho(){ printf '\033[1;31m%s\033[0m\n' "$*"; }
azul()    { printf '\033[1;34m%s\033[0m\n' "$*"; }

if ! command -v supabase >/dev/null; then
  vermelho 'A CLI do Supabase não está instalada nesta máquina.'
  echo
  echo '  curl -fsSL https://github.com/supabase/cli/releases/latest/download/supabase_linux_amd64.tar.gz \'
  echo '    | sudo tar -xz -C /usr/local/bin supabase'
  exit 1
fi

if [ "${1:-}" = '--trocar' ]; then
  [ -f "$ENV" ] && sed -i '/^SUPABASE_ACCESS_TOKEN=/d' "$ENV"
  unset SUPABASE_ACCESS_TOKEN
fi

# 1. De onde vêm as credenciais -------------------------------------------
if [ -f "$ENV" ]; then
  # shellcheck disable=SC1090
  set -a; . "./$ENV"; set +a
fi

if [ -z "${PROJECT_REF:-}" ]; then
  echo 'REF DO PROJETO: no dashboard do Supabase a URL é'
  echo '   supabase.com/dashboard/project/XXXXXXXX   <- é esse XXXXXXXX'
  read -rp '   Ref: ' PROJECT_REF
  PROJECT_REF=$(printf '%s' "$PROJECT_REF" | tr -d ' \t\r\n')
fi

if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  echo
  echo 'TOKEN DE ACESSO: supabase.com/dashboard/account/tokens'
  echo '   -> Generate new token -> copie. Começa com sbp_'
  read -rsp '   Token: ' SUPABASE_ACCESS_TOKEN
  echo
  SUPABASE_ACCESS_TOKEN=$(printf '%s' "$SUPABASE_ACCESS_TOKEN" | tr -d ' \t\r\n')

  case "$SUPABASE_ACCESS_TOKEN" in
    sbp_*) ;;
    *) vermelho 'Isso não parece um token de acesso: ele começa com sbp_.'
       echo '   A chave de serviço (eyJ.../sb_secret_...) é outra coisa e não serve aqui.'
       exit 1 ;;
  esac

  if [ -f "$ENV" ]; then
    printf 'SUPABASE_ACCESS_TOKEN=%s\n' "$SUPABASE_ACCESS_TOKEN" >> "$ENV"
    chmod 600 "$ENV"
    verde "Guardado em $ENV — da próxima vez não pergunto."
  fi
fi
export SUPABASE_ACCESS_TOKEN

[ -n "${PROJECT_REF:-}" ] || { vermelho 'Sem o ref do projeto não dá.'; exit 1; }

# 2. Publicar ---------------------------------------------------------------
azul "== Publicando em $PROJECT_REF =="

echo 'enviar-whatsapp...'
supabase functions deploy enviar-whatsapp --project-ref "$PROJECT_REF" >/dev/null
verde '  no ar'

echo 'whatsapp-webhook (com --no-verify-jwt)...'
supabase functions deploy whatsapp-webhook --project-ref "$PROJECT_REF" --no-verify-jwt >/dev/null
verde '  no ar'

echo 'pagina-publica (prévia do link, com --no-verify-jwt)...'
supabase functions deploy pagina-publica --project-ref "$PROJECT_REF" --no-verify-jwt >/dev/null
verde '  no ar'

# 3. Conferir que subiu mesmo ----------------------------------------------
# Sem token na URL, o webhook tem de responder 403: é o segredo dele
# funcionando. 401 quer dizer que o --no-verify-jwt não pegou; 404 quer
# dizer que a função não está lá.
azul '== Conferindo =='
CODIGO=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  "https://${PROJECT_REF}.supabase.co/functions/v1/whatsapp-webhook" \
  -H 'Content-Type: application/json' -d '{"event":"ping"}' || echo '000')

case "$CODIGO" in
  403) verde 'O webhook está no ar e recusando quem não tem o segredo. É o esperado.' ;;
  401) vermelho 'Respondeu 401: o --no-verify-jwt não pegou.'
       echo '   A Evolution vai levar 401 em toda mensagem. Publique de novo.' ;;
  404) vermelho 'Respondeu 404: a função não está publicada nesse projeto.'
       echo "   Confira se o ref $PROJECT_REF é o certo." ;;
  000) amarelo 'Não consegui alcançar a função daqui (rede). Publicou, mas não conferi.' ;;
  *)   amarelo "Respondeu $CODIGO — inesperado, mas a publicação não deu erro." ;;
esac

echo
echo 'Para ver o que a função está registrando:'
echo "  supabase functions logs whatsapp-webhook --project-ref $PROJECT_REF"
