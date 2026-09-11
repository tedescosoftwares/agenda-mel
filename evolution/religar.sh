#!/usr/bin/env bash
#
# MIMO — religa a instância "mimo" da Evolution sem parear de novo.
#
#   ./religar.sh
#
# Para quando a fila devolve "Error: Connection Closed": a Evolution
# está de pé, o número continua pareado, mas o túnel com o WhatsApp
# caiu (acontece depois de um pareamento recente, de uma queda de rede
# ou de o celular do chip ficar muito tempo sem internet).
#
# Faz: mostra o estado, reinicia a instância, espera até 2 min ela
# voltar a "open". Se não voltar, diz o que fazer em seguida.
set -euo pipefail
cd "$(dirname "$0")"
azul()    { printf '\033[1;34m%s\033[0m\n' "$*"; }
verde()   { printf '\033[1;32m%s\033[0m\n' "$*"; }
amarelo() { printf '\033[1;33m%s\033[0m\n' "$*"; }
vermelho(){ printf '\033[1;31m%s\033[0m\n' "$*"; }

[ -f .env ] || { vermelho 'Não achei o .env. Rode o ./bootstrap.sh primeiro.'; exit 1; }
# shellcheck disable=SC1091
set -a; . ./.env; set +a
[ -n "${DOMINIO:-}" ] && [ -n "${API_KEY:-}" ] || { vermelho 'Falta DOMINIO ou API_KEY no .env.'; exit 1; }
INST=${1:-mimo}
API="https://${DOMINIO}"
chamar() { # metodo caminho
  curl -sS --max-time 25 -X "$1" "${API}$2" -H "apikey: ${API_KEY}" -H 'Content-Type: application/json'
}
estado() { chamar GET "/instance/connectionState/${INST}" | python3 -c 'import sys,json
try: print(json.load(sys.stdin).get("instance",{}).get("state",""))
except Exception: print("")' 2>/dev/null || true; }

azul "== 1/3  Como está a instância '${INST}' =="
ANTES=$(estado)
case "$ANTES" in
  open)  verde "  estado: open (o túnel está de pé)";
         amarelo '  Se mesmo assim a fila diz "Connection Closed", o túnel está oscilando. Vou reiniciar do mesmo jeito.' ;;
  "")    vermelho "  A Evolution não respondeu pela instância '${INST}'."
         echo   '  Veja se ela está de pé:  docker compose ps   e   docker compose logs evolution --tail 40'
         exit 1 ;;
  *)     amarelo "  estado: ${ANTES}" ;;
esac
echo '  últimas linhas do log que falam de conexão:'
docker compose logs evolution --tail 400 2>/dev/null | grep -iE 'connection|logged ?out|closed|restart|conflict|4[0-9]{2}' | tail -8 | sed 's/^/    /' || true

azul "== 2/3  Reiniciando =="
chamar PUT "/instance/restart/${INST}" >/dev/null 2>&1 || chamar POST "/instance/restart/${INST}" >/dev/null 2>&1 || true
printf '  esperando o WhatsApp responder'
DEPOIS=""
for _ in $(seq 1 24); do
  sleep 5; printf '.'
  DEPOIS=$(estado)
  [ "$DEPOIS" = "open" ] && break
done
echo

azul "== 3/3  Resultado =="
if [ "$DEPOIS" = "open" ]; then
  verde "  '${INST}' está open. Mande o teste de novo na Plataforma › Mensagens."
  echo  '  A fila anda sozinha; para empurrar agora:  ./disparar.sh'
  exit 0
fi
vermelho "  Não voltou (estado: ${DEPOIS:-?})."
echo
case "$DEPOIS" in
  close)
    echo '  "close" depois de reiniciar quer dizer que o WhatsApp derrubou a sessão:'
    echo '  ou o chip perdeu o pareamento, ou a conta foi restringida de novo.'
    echo '  No celular do chip: WhatsApp → Aparelhos conectados. Se a Evolution'
    echo '  não estiver lá, pareie de novo:'
    echo "      ./trocar-numero.sh 55DDDNUMERO      (mesmo número serve)"
    echo '  Se estiver lá e continuar close, veja o log completo:'
    echo '      docker compose logs evolution --tail 120' ;;
  connecting)
    echo '  Ficou em "connecting": o WhatsApp não completa o handshake. Costuma ser'
    echo '  rede do servidor ou a conta em observação. Espere 10 min e rode de novo.'
    echo '  Se persistir:  docker compose restart evolution   e rode este script outra vez.' ;;
  *)
    echo '  Veja o log:  docker compose logs evolution --tail 120' ;;
esac
exit 1
