#!/usr/bin/env bash
#
# 3.77: a Evolution passou a guardar as mensagens (DATABASE_SAVE_DATA_NEW_MESSAGE no docker-compose.yml), porque é
# só assim que ela decifra o voto das enquetes da Mel ("vai atender?"). Guardar não é para sempre: isto apaga do banco
# da Evolution as mensagens com mais de 90 dias (o mesmo prazo da política de privacidade) e cria, uma vez, o índice
# que deixa rápida a busca da enquete quando chega um voto.
#
#   ./limpar-mensagens.sh            roda uma vez (mostra quantas apagou)
#   ./limpar-mensagens.sh --cron     instala no cron: todo dia às 4h17 (log em limpar-mensagens.log)
#   ./limpar-mensagens.sh --sem-cron tira do cron
#
# DIAS=120 ./limpar-mensagens.sh muda o prazo numa rodada (se aumentar de vez, mude a política de privacidade).

set -euo pipefail
cd "$(dirname "$0")"
AQUI=$(pwd)
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"
DIAS=${DIAS:-90}

verde()   { printf '\033[1;32m%s\033[0m\n' "$*"; }
amarelo() { printf '\033[1;33m%s\033[0m\n' "$*"; }
vermelho(){ printf '\033[1;31m%s\033[0m\n' "$*"; }

LINHA_CRON="17 4 * * * $AQUI/limpar-mensagens.sh >> $AQUI/limpar-mensagens.log 2>&1"
MARCA='# agenda-mel: apaga as mensagens da Evolution com mais de 90 dias (LGPD)'

case "${1:-}" in
  --sem-cron)
    command -v crontab >/dev/null || { amarelo 'Não existe crontab nesta máquina.'; exit 0; }
    crontab -l 2>/dev/null | grep -vF "$MARCA" | grep -vF "$AQUI/limpar-mensagens.sh" | crontab - || true
    verde 'Tirado do cron. As mensagens da Evolution não são mais apagadas sozinhas.'
    exit 0
    ;;
  --cron)
    command -v crontab >/dev/null || { vermelho 'Não achei o crontab. No Ubuntu: sudo apt-get install -y cron && sudo systemctl enable --now cron'; exit 1; }
    { crontab -l 2>/dev/null | grep -vF "$MARCA" | grep -vF "$AQUI/limpar-mensagens.sh" || true
      echo "$MARCA"
      echo "$LINHA_CRON"
    } | crontab -
    verde "No cron: todo dia às 4h17 apaga as mensagens da Evolution com mais de $DIAS dias. Log em limpar-mensagens.log."
    exit 0
    ;;
esac

case "$DIAS" in ''|*[!0-9]*) vermelho "DIAS precisa ser um número (veio: $DIAS)"; exit 1 ;; esac
command -v docker >/dev/null || { vermelho 'Não achei o docker.'; exit 1; }
if ! docker ps --format '{{.Names}}' | grep -qx evolution_postgres; then
  amarelo "$(date '+%F %T') o banco da Evolution (evolution_postgres) não está rodando: nada a limpar agora"
  exit 0
fi

SQL="create index if not exists mimo_message_key_id on evolution_api.\"Message\" ((\"key\" ->> 'id'));
with x as (delete from evolution_api.\"Message\" where \"messageTimestamp\" < extract(epoch from now() - interval '$DIAS days')::bigint returning 1)
select count(*) from x;"
if N=$(docker exec -i -e PGOPTIONS='-c client_min_messages=warning' evolution_postgres psql -U evolution -d evolution -v ON_ERROR_STOP=1 -qAt <<<"$SQL" 2>&1); then
  verde "$(date '+%F %T') apagadas $(printf '%s' "$N" | tail -1) mensagens com mais de $DIAS dias"
else
  case "$N" in
    *'does not exist'*) amarelo "$(date '+%F %T') a tabela de mensagens da Evolution ainda não existe (nada guardado ainda)";;
    *) vermelho "$(date '+%F %T') não deu para limpar: $(printf '%s' "$N" | tail -2)"; exit 1;;
  esac
fi
