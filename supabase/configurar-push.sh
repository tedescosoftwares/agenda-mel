#!/usr/bin/env bash
#
# MIMO — liga os avisos no celular (push) e o e-mail do domínio.
#
#   ./supabase/configurar-push.sh
#
# Roda na VPS (ou em qualquer máquina com node e a CLI do Supabase). Faz:
#   1. gera o par de chaves VAPID, se ainda não existir em evolution/.env
#   2. grava os segredos nas Edge Functions (VAPID_*, EMAIL_DE, EMAIL_RESPONDER)
#   3. imprime o SQL para colar no SQL Editor, já com a chave pública
#
# A chave privada fica só em evolution/.env (600) e nos segredos do
# Supabase. Nunca cole ela em chat nenhum. Rodar de novo não troca as
# chaves: trocar invalida todo celular já cadastrado.

set -euo pipefail
cd "$(dirname "$0")/.."
ENV=evolution/.env

verde()   { printf '\033[1;32m%s\033[0m\n' "$*"; }
amarelo() { printf '\033[1;33m%s\033[0m\n' "$*"; }
vermelho(){ printf '\033[1;31m%s\033[0m\n' "$*"; }
azul()    { printf '\033[1;34m%s\033[0m\n' "$*"; }

command -v supabase >/dev/null || { vermelho 'A CLI do Supabase não está instalada. Rode ./supabase/publicar.sh uma vez: ele explica.'; exit 1; }
command -v node >/dev/null || { vermelho 'node não encontrado. O publicar-site.sh instala.'; exit 1; }

if [ -f "$ENV" ]; then
  set -a; . "./$ENV"; set +a
fi
if [ -z "${PROJECT_REF:-}" ]; then
  echo 'REF DO PROJETO: no dashboard do Supabase a URL é'
  echo '   supabase.com/dashboard/project/XXXXXXXX   <- é esse XXXXXXXX'
  read -rp '   Ref: ' PROJECT_REF
  PROJECT_REF=$(printf '%s' "$PROJECT_REF" | tr -d ' \t\r\n')
  [ -n "$PROJECT_REF" ] || { vermelho 'Sem o ref do projeto não dá.'; exit 1; }
  [ -f "$ENV" ] && printf 'PROJECT_REF=%s\n' "$PROJECT_REF" >> "$ENV"
fi
[ -n "${SUPABASE_ACCESS_TOKEN:-}" ] || { vermelho "Falta SUPABASE_ACCESS_TOKEN em $ENV. Rode ./supabase/publicar.sh primeiro."; exit 1; }
export SUPABASE_ACCESS_TOKEN

DOMINIO=${DOMINIO_SITE:-mimo.com.vc}
EMAIL_DE=${EMAIL_DE:-"MIMO <oi@$DOMINIO>"}
EMAIL_RESPONDER=${EMAIL_RESPONDER:-"contato@$DOMINIO"}

# 1. Chaves VAPID -------------------------------------------------------------
if [ -z "${VAPID_PUBLIC_KEY:-}" ] || [ -z "${VAPID_PRIVATE_KEY:-}" ]; then
  azul '== Gerando o par de chaves VAPID =='
  JSON=$(npx --yes web-push@3.6.7 generate-vapid-keys --json)
  VAPID_PUBLIC_KEY=$(printf '%s' "$JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).publicKey))')
  VAPID_PRIVATE_KEY=$(printf '%s' "$JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).privateKey))')
  [ -n "$VAPID_PUBLIC_KEY" ] && [ -n "$VAPID_PRIVATE_KEY" ] || { vermelho 'Não consegui gerar as chaves.'; exit 1; }
  {
    printf 'VAPID_PUBLIC_KEY=%s\n' "$VAPID_PUBLIC_KEY"
    printf 'VAPID_PRIVATE_KEY=%s\n' "$VAPID_PRIVATE_KEY"
  } >> "$ENV"
  chmod 600 "$ENV"
  verde "  geradas e guardadas em $ENV"
else
  verde '== Chaves VAPID já existem em evolution/.env; reaproveitando =='
fi

# 2. Segredos das funções ---------------------------------------------------
azul "== Gravando os segredos em $PROJECT_REF =="
supabase secrets set --project-ref "$PROJECT_REF" \
  "VAPID_PUBLIC_KEY=$VAPID_PUBLIC_KEY" \
  "VAPID_PRIVATE_KEY=$VAPID_PRIVATE_KEY" \
  "VAPID_SUBJECT=mailto:$EMAIL_RESPONDER" \
  "EMAIL_DE=$EMAIL_DE" \
  "EMAIL_RESPONDER=$EMAIL_RESPONDER" >/dev/null
verde '  VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, EMAIL_DE, EMAIL_RESPONDER'

if ! supabase secrets list --project-ref "$PROJECT_REF" 2>/dev/null | grep -q RESEND_API_KEY; then
  echo
  amarelo 'Ainda não tem RESEND_API_KEY. Pegue em resend.com/api-keys (começa com re_).'
  read -rsp '   Cole aqui (ou Enter para pular): ' RESEND
  echo
  RESEND=$(printf '%s' "$RESEND" | tr -d ' \t\r\n')
  if [ -n "$RESEND" ]; then
    supabase secrets set --project-ref "$PROJECT_REF" "RESEND_API_KEY=$RESEND" >/dev/null
    verde '  RESEND_API_KEY gravada'
  else
    amarelo '  sem ela o e-mail fica na fila até você gravar: supabase secrets set RESEND_API_KEY=re_...'
  fi
fi

# 3. O SQL --------------------------------------------------------------------
echo
azul '== Agora cole isto no SQL Editor do Supabase (depois do atualizacao_040_em_diante.sql) =='
echo
cat <<SQL
select public.definir_config_publica('vapid_public', '$VAPID_PUBLIC_KEY');
select public.definir_config_publica('app_url', 'https://$DOMINIO');
update public.salons set app_url = 'https://$DOMINIO';
select public.desligar_relogio();
select public.ligar_relogio('https://$PROJECT_REF.supabase.co', 'SUA SERVICE ROLE KEY AQUI');
select public.relogio_status();
SQL
echo
amarelo 'A service role fica em Project Settings > API > service_role. Só cole lá no SQL Editor.'
echo
verde 'Depois: ./supabase/publicar.sh (se ainda não publicou as funções) e reinstalar o app no celular.'
