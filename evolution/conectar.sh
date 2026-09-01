#!/usr/bin/env bash
#
# Agenda Mel — liga a Evolution ao Supabase.
#
# Roda DEPOIS do bootstrap.sh, com a instância já conectada ao WhatsApp.
#
#   cd ~/agenda-mel/evolution && ./conectar.sh
#
# Faz: troca as chaves, descobre o nome da instância, aponta o webhook,
# instala a CLI do Supabase, publica os segredos e as duas funções, e
# imprime no fim o SQL para você colar.
#
# Pode rodar de novo à vontade.

set -euo pipefail

azul()    { printf '\033[1;34m%s\033[0m\n' "$*"; }
verde()   { printf '\033[1;32m%s\033[0m\n' "$*"; }
amarelo() { printf '\033[1;33m%s\033[0m\n' "$*"; }
vermelho(){ printf '\033[1;31m%s\033[0m\n' "$*"; }

cd "$(dirname "$0")"

if [ ! -f .env ]; then
  vermelho 'Não achei o .env. Rode o ./bootstrap.sh primeiro.'
  exit 1
fi

# shellcheck disable=SC1091
set -a; . ./.env; set +a

# ---------------------------------------------------------------
azul '== 1/7  O que eu preciso saber =='
echo
echo 'Duas coisas do Supabase. As duas estão no navegador.'
echo

if [ -z "${PROJECT_REF:-}" ]; then
  echo 'REF DO PROJETO: abra o dashboard do Supabase. Na URL fica'
  echo '   supabase.com/dashboard/project/XXXXXXXX  <- é esse XXXXXXXX'
  read -rp '   Ref do projeto: ' PROJECT_REF
fi

if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  echo
  echo 'TOKEN DE ACESSO: supabase.com/dashboard/account/tokens'
  echo '   -> Generate new token -> copie (começa com sbp_)'
  read -rsp '   Token: ' SUPABASE_ACCESS_TOKEN
  echo
fi
export SUPABASE_ACCESS_TOKEN

if [ -z "$PROJECT_REF" ] || [ -z "$SUPABASE_ACCESS_TOKEN" ]; then
  vermelho 'Preciso dos dois para continuar.'
  exit 1
fi

# ---------------------------------------------------------------
azul '== 2/7  Trocando as chaves =='

# Elas foram expostas numa conversa; melhor não confiar mais nelas.
API_KEY_NOVA=$(openssl rand -hex 32)
WEBHOOK_TOKEN_NOVO=$(openssl rand -hex 32)

sed -i "s|^API_KEY=.*|API_KEY=${API_KEY_NOVA}|" .env
sed -i "s|^WEBHOOK_TOKEN=.*|WEBHOOK_TOKEN=${WEBHOOK_TOKEN_NOVO}|" .env

docker compose up -d >/dev/null
echo 'Esperando a Evolution voltar com a chave nova...'
for _ in $(seq 1 24); do
  if curl -fsS --max-time 4 "https://${DOMINIO}/" >/dev/null 2>&1; then break; fi
  sleep 5
done

API_KEY="$API_KEY_NOVA"
WEBHOOK_TOKEN="$WEBHOOK_TOKEN_NOVO"
verde 'Chaves trocadas. A sessão do WhatsApp continua conectada.'
amarelo "Para entrar no painel agora use:  grep ^API_KEY= .env"

# ---------------------------------------------------------------
azul '== 3/7  Achando a instância =='

# A Evolution demora um pouco a montar as rotas depois de reiniciar.
# Tenta algumas vezes, e guarda o código HTTP para poder explicar a
# falha em vez de dizer só "não encontrei".
RESPOSTA=''
CODIGO=''
for tentativa in 1 2 3 4 5 6; do
  CODIGO=$(curl -sS --max-time 15 -o /tmp/inst.json -w '%{http_code}' \
    "https://${DOMINIO}/instance/fetchInstances" \
    -H "apikey: ${API_KEY}" 2>/dev/null || echo '000')
  if [ "$CODIGO" = '200' ]; then
    RESPOSTA=$(cat /tmp/inst.json)
    break
  fi
  echo "  tentativa ${tentativa}: HTTP ${CODIGO}, esperando..."
  sleep 5
done

INSTANCIA=$(printf '%s' "$RESPOSTA" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
itens = d if isinstance(d, list) else d.get("instances", [])
for i in itens:
    if not isinstance(i, dict):
        continue
    ninho = i.get("instance") if isinstance(i.get("instance"), dict) else i
    nome = ninho.get("name") or ninho.get("instanceName")
    if nome:
        print(nome)
        break
' 2>/dev/null || true)

if [ -z "$INSTANCIA" ]; then
  vermelho "Não consegui listar as instâncias (HTTP ${CODIGO})."
  echo
  case "$CODIGO" in
    401|403)
      echo 'A Evolution recusou a chave. Ela reiniciou com a chave nova'
      echo 'há pouco — espere uns segundos e rode este script de novo.'
      echo 'Se insistir, veja se o container subiu:  docker compose ps'
      ;;
    000|502|503|504)
      echo 'A Evolution não respondeu. Provavelmente ainda está subindo,'
      echo 'ou caiu. Veja:'
      echo '    docker compose ps'
      echo '    docker compose logs --tail=40 evolution'
      ;;
    200)
      echo 'Ela respondeu, mas sem nenhuma instância na lista.'
      echo "Abra https://${DOMINIO}/manager, crie uma instância e escaneie"
      echo 'o QR code com o celular do chip.'
      ;;
    *)
      echo 'Resposta inesperada.'
      ;;
  esac
  echo
  echo 'Resposta crua:'
  printf '%s\n' "${RESPOSTA:0:600}"
  exit 1
fi
verde "Instância: ${INSTANCIA}"

# ---------------------------------------------------------------
azul '== 4/7  Apontando o webhook =='

URL_WEBHOOK="https://${PROJECT_REF}.supabase.co/functions/v1/whatsapp-webhook?token=${WEBHOOK_TOKEN}"

CORPO=$(URL="$URL_WEBHOOK" python3 -c '
import json, os
print(json.dumps({"webhook": {
    "enabled": True,
    "url": os.environ["URL"],
    "byEvents": False,
    "base64": False,
    "events": ["MESSAGES_UPSERT", "MESSAGES_UPDATE"],
}}))')

if curl -fsS --max-time 20 -X POST "https://${DOMINIO}/webhook/set/${INSTANCIA}" \
     -H 'Content-Type: application/json' \
     -H "apikey: ${API_KEY}" \
     -d "$CORPO" >/dev/null; then
  verde 'Webhook apontado para o app.'
else
  amarelo 'A Evolution recusou o webhook. Dá para configurar pelo painel:'
  amarelo "  https://${DOMINIO}/manager -> instância -> Webhook"
  amarelo "  URL: ${URL_WEBHOOK}"
fi

# ---------------------------------------------------------------
azul '== 5/7  CLI do Supabase =='

if command -v supabase >/dev/null 2>&1; then
  echo "Já instalada: $(supabase --version 2>/dev/null | head -1)"
else
  echo 'Baixando...'
  ARQ=supabase_linux_amd64.tar.gz
  [ "$(uname -m)" = 'aarch64' ] && ARQ=supabase_linux_arm64.tar.gz
  curl -fsSL "https://github.com/supabase/cli/releases/latest/download/${ARQ}" \
    | tar -xz -C /tmp supabase
  sudo mv /tmp/supabase /usr/local/bin/supabase
  verde "Instalada: $(supabase --version 2>/dev/null | head -1)"
fi

# ---------------------------------------------------------------
azul '== 6/7  Publicando no Supabase =='

cd ..

echo 'Segredos...'
supabase secrets set --project-ref "$PROJECT_REF" \
  "EVOLUTION_URL=https://${DOMINIO}" \
  "EVOLUTION_API_KEY=${API_KEY}" \
  "EVOLUTION_WEBHOOK_TOKEN=${WEBHOOK_TOKEN}" >/dev/null
verde 'Segredos publicados.'

echo 'Função de envio...'
supabase functions deploy enviar-whatsapp --project-ref "$PROJECT_REF" >/dev/null
verde 'enviar-whatsapp no ar.'

echo 'Função de webhook...'
supabase functions deploy whatsapp-webhook --project-ref "$PROJECT_REF" --no-verify-jwt >/dev/null
verde 'whatsapp-webhook no ar.'

cd evolution

# ---------------------------------------------------------------
azul '== 7/7  Falta só um passo, e é copiar e colar =='
echo
echo 'Abra o SQL Editor do Supabase e rode isto:'
echo
printf '\033[1;33m%s\033[0m\n' "update public.whatsapp_channels
set canal = 'evolution',
    identificador = '${INSTANCIA}',
    ativo = true
where salon_id = (select id from public.salons where slug = 'espaco-mel');"
echo
echo '-------------------------------------------------------------'
echo
echo 'Depois, para testar de ponta a ponta, ainda no SQL Editor:'
echo
printf '\033[1;33m%s\033[0m\n' "-- 1. põe o SEU celular na cliente de teste
update public.profiles
set phone = '(13) 99999-0000', accepts_reminders = true
where id = (select id from auth.users where email = 'cliente@exemplo.com');

-- 2. marque um horário para amanhã pelo app, e então:
select public.enviar_lembretes();

-- 3. veja a mensagem na fila
select status, telefone, corpo from public.message_outbox
order by criado_em desc limit 3;"
echo
echo 'E aqui no servidor, para empurrar a fila na hora:'
echo
printf '\033[1;33m%s\033[0m\n' "  ./disparar.sh"
echo
verde 'A mensagem chega no seu celular. Responda 1 e veja confirmar no app.'
