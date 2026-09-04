#!/usr/bin/env bash
#
# Empurra a fila de mensagens na hora, sem esperar o cron.
#
#   ./disparar.sh           envia o que está na fila, agora
#   ./disparar.sh --cron    instala no cron: de minuto em minuto, sozinho
#   ./disparar.sh --sem-cron  tira do cron
#   ./disparar.sh --trocar  esquece as credenciais e pergunta de novo
#
# Sem o --cron, a fila SÓ anda quando alguém roda isto na mão.
#
# Desde a migração 052 existe um relógio DENTRO do Supabase (pg_cron +
# pg_net) que faz o mesmo que este cron, sem depender da VPS. Com ele
# ligado (select public.ligar_relogio(url, chave) no SQL Editor), o cron
# daqui vira redundante: rode ./disparar.sh --sem-cron. Rodar na mão
# continua útil para não esperar o minuto virar.
#
# Na primeira vez pergunta o ref do projeto e a chave de serviço, e
# guarda em .supabase para as próximas.

set -euo pipefail
cd "$(dirname "$0")"

verde()   { printf '\033[1;32m%s\033[0m\n' "$*"; }
amarelo() { printf '\033[1;33m%s\033[0m\n' "$*"; }
vermelho(){ printf '\033[1;31m%s\033[0m\n' "$*"; }

AQUI=$(cd "$(dirname "$0")" && pwd)
LINHA_CRON="* * * * * $AQUI/disparar.sh >> $AQUI/disparar.log 2>&1"
MARCA='# agenda-mel: escoa a fila de WhatsApp'

case "${1:-}" in
  --sem-cron)
    if ! command -v crontab >/dev/null; then
      amarelo 'Não existe crontab nesta máquina, então não há o que tirar.'
      exit 0
    fi
    crontab -l 2>/dev/null | grep -vF "$MARCA" | grep -vF "$AQUI/disparar.sh" | crontab - || true
    verde 'Tirado do cron. A fila volta a andar só na mão.'
    exit 0
    ;;
  --cron)
    if ! command -v crontab >/dev/null; then
      vermelho 'Não achei o crontab nesta máquina.'
      echo '   No Ubuntu:  sudo apt-get install -y cron && sudo systemctl enable --now cron'
      exit 1
    fi

    # Sem credenciais guardadas o cron não serve para nada: ele roda sem
    # terminal, a pergunta interativa não aparece, e o script sai. Melhor
    # recusar agora do que instalar algo que só falha em silêncio.
    if [ ! -f .supabase ]; then
      vermelho 'Antes preciso das credenciais guardadas.'
      echo '   Rode  ./disparar.sh  uma vez na mão, e depois  ./disparar.sh --cron'
      exit 1
    fi

    # sem duplicar: tira o que já houver nosso antes de pôr de volta
    { crontab -l 2>/dev/null | grep -vF "$MARCA" | grep -vF "$AQUI/disparar.sh"
      echo "$MARCA"
      echo "$LINHA_CRON"; } | crontab -

    # Conferir, não anunciar. Dizer "instalado" sem olhar de volta é como
    # esta fila ficou parada dias sem ninguém notar.
    if crontab -l 2>/dev/null | grep -qF "$AQUI/disparar.sh"; then
      verde 'Instalado e conferido:'
      crontab -l | grep -F "$AQUI/disparar.sh" | sed 's/^/     /'
    else
      vermelho 'Escrevi no crontab e ele não está lá. Algo recusou a gravação.'
      echo '   Tente:  crontab -e   e cole a linha:'
      echo "     $LINHA_CRON"
      exit 1
    fi

    # De nada adianta a linha estar no crontab se o serviço não roda.
    if command -v systemctl >/dev/null; then
      if [ "$(systemctl is-active cron 2>/dev/null || echo inativo)" != 'active' ]; then
        amarelo 'O crontab tem a linha, mas o serviço cron NÃO está rodando.'
        echo '   Ligue com:  sudo systemctl enable --now cron'
      else
        verde 'Serviço cron ativo.'
      fi
    fi

    echo
    echo "   Log:    $AQUI/disparar.log   (aparece no primeiro minuto)"
    echo '   Tirar:  ./disparar.sh --sem-cron'
    exit 0
    ;;
  --trocar)
    rm -f .supabase
    ;;
esac

# O cron roda sem terminal. Se as credenciais ainda não estão guardadas,
# a pergunta interativa abaixo travaria para sempre — melhor sair
# dizendo o que fazer do que ficar pendurado todo minuto.
if [ ! -t 0 ] && [ ! -f .supabase ]; then
  vermelho 'Sem credenciais guardadas e sem terminal para perguntar.'
  echo 'Rode ./disparar.sh uma vez na mão.'
  exit 1
fi

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
