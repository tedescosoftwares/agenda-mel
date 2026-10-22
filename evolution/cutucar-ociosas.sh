#!/usr/bin/env bash
#
# O relógio do ocioso da Mel (3.52). A Mel (o WhatsApp do guia) só fala quando
# chega mensagem; para ela cutucar sozinha uma conversa que ficou parada, algo
# precisa lembrá-la de tempos em tempos. É isto: chama o whatsapp-webhook com
# ?tarefa=ociosas, que varre as conversas paradas e, pela Evolution, manda a
# pergunta "posso encerrar?" (quando passou ocioso_perguntar_min) ou o
# encerramento e fecha (quando passou ocioso_encerrar_min desde a pergunta).
# Os tempos, os textos e o liga/desliga ficam na aba WhatsApp da Plataforma;
# se o ocioso estiver desligado lá, esta chamada não faz nada (sai calado).
#
#   ./cutucar-ociosas.sh          roda uma vez (mostra quantas perguntou/encerrou)
#   ./cutucar-ociosas.sh --cron   instala no cron: a cada 5 minutos (log em cutucar.log)
#   ./cutucar-ociosas.sh --sem-cron  tira do cron
#
# Precisa, no .env (da Evolution ou da raiz): VITE_SUPABASE_URL e
# EVOLUTION_WEBHOOK_TOKEN (o mesmo segredo que você pôs no Supabase e que já
# protege o webhook). Nada aqui expõe segredo nenhum no log.

set -euo pipefail
cd "$(dirname "$0")"
AQUI=$(pwd)
RAIZ=$(cd .. && pwd)
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"

verde()   { printf '\033[1;32m%s\033[0m\n' "$*"; }
amarelo() { printf '\033[1;33m%s\033[0m\n' "$*"; }
vermelho(){ printf '\033[1;31m%s\033[0m\n' "$*"; }

LINHA_CRON="*/5 * * * * $AQUI/cutucar-ociosas.sh >> $AQUI/cutucar.log 2>&1"
MARCA='# agenda-mel: cutuca as conversas paradas da Mel (ocioso ativo)'

case "${1:-}" in
  --sem-cron)
    command -v crontab >/dev/null || { amarelo 'Não existe crontab nesta máquina.'; exit 0; }
    crontab -l 2>/dev/null | grep -vF "$MARCA" | grep -vF "$AQUI/cutucar-ociosas.sh" | crontab - || true
    verde 'Tirado do cron. A Mel não cutuca mais as conversas paradas sozinha (o resto do ciclo segue valendo).'
    exit 0
    ;;
  --cron)
    command -v crontab >/dev/null || { vermelho 'Não achei o crontab. No Ubuntu: sudo apt-get install -y cron && sudo systemctl enable --now cron'; exit 1; }
    { crontab -l 2>/dev/null | grep -vF "$MARCA" | grep -vF "$AQUI/cutucar-ociosas.sh"
      echo "$MARCA"
      echo "$LINHA_CRON"
    } | crontab -
    verde 'No cron: a cada 5 minutos varre as conversas paradas. Log em cutucar.log. Ligue o ocioso na aba WhatsApp da Plataforma.'
    exit 0
    ;;
esac

# as chaves: no .env da Evolution ou no da raiz, como no republicar-se-mudou.sh
# shellcheck disable=SC1091
[ -f .env ] && { set -a; . ./.env; set +a; }
# shellcheck disable=SC1091
[ -f "$RAIZ/.env" ] && { set -a; . "$RAIZ/.env"; set +a; }
case "${VITE_SUPABASE_URL:-}" in https://*) ;; *) vermelho 'Falta VITE_SUPABASE_URL no .env.'; exit 1 ;; esac
[ -n "${EVOLUTION_WEBHOOK_TOKEN:-}" ] || { vermelho 'Falta EVOLUTION_WEBHOOK_TOKEN no .env (o mesmo segredo do webhook, que você pôs no Supabase). Adicione-o ao .env e tente de novo.'; exit 1; }
command -v curl >/dev/null || { vermelho 'Não achei o curl no PATH.'; exit 1; }

RESP=$(curl -s -m 30 -G "$VITE_SUPABASE_URL/functions/v1/whatsapp-webhook" \
  --data-urlencode 'tarefa=ociosas' \
  --data-urlencode "token=$EVOLUTION_WEBHOOK_TOKEN" || true)

case "$RESP" in
  *'"ok":true'*'"ativo":false'*) verde "$(date '+%F %T') ocioso desligado na Plataforma (nada a fazer)";;
  *'"ok":true'*)                  verde "$(date '+%F %T') ok: $RESP";;
  *'não autorizado'*|*'403'*)     vermelho "$(date '+%F %T') token recusado: confira EVOLUTION_WEBHOOK_TOKEN no .env e no Supabase"; exit 1;;
  '')                             vermelho "$(date '+%F %T') sem resposta do webhook (confira VITE_SUPABASE_URL e a conexão)"; exit 1;;
  *)                              amarelo  "$(date '+%F %T') resposta inesperada: $RESP";;
esac
