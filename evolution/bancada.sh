#!/usr/bin/env bash
#
# Bancada de teste: manda as variantes de "botão" para um celular, uma
# por vez, com etiqueta, para você ver no aparelho qual renderiza.
#
#   ./bancada.sh 5513991203410
#
# Não passa pelo Agenda Mel: bate direto na Evolution. Se uma variante
# aparecer bonita aqui, ela vai aparecer bonita no app.

set -euo pipefail
cd "$(dirname "$0")"

[ -f .env ] || { echo 'Sem .env. Rode ./bootstrap.sh'; exit 1; }
set -a; . ./.env; set +a

NUMERO="${1:-}"
if [ -z "$NUMERO" ]; then
  read -rp 'Número de destino (só dígitos, com 55): ' NUMERO
fi
NUMERO=$(printf '%s' "$NUMERO" | tr -cd '0-9')

INST=$(curl -s --max-time 15 "https://${DOMINIO}/instance/fetchInstances" -H "apikey: ${API_KEY}" \
  | python3 -c 'import json,sys
d=json.load(sys.stdin)
for i in (d if isinstance(d,list) else []):
    n=i.get("name") or (i.get("instance") or {}).get("instanceName")
    if n: print(n); break')
[ -n "$INST" ] || { echo 'Nenhuma instância conectada.'; exit 1; }

azul()  { printf '\n\033[1;34m%s\033[0m\n' "$*"; }
manda() {
  local rota="$1" corpo="$2"
  local resp codigo
  resp=$(curl -s --max-time 30 -w '\n%{http_code}' -X POST \
    "https://${DOMINIO}/message/${rota}/${INST}" \
    -H 'Content-Type: application/json' -H "apikey: ${API_KEY}" -d "$corpo")
  codigo=$(printf '%s' "$resp" | tail -1)
  if [ "$codigo" = '200' ] || [ "$codigo" = '201' ]; then
    printf '   API: %s  (aceitou — agora olhe o CELULAR)\n' "$codigo"
  else
    printf '   API: %s  (recusou)\n   %s\n' "$codigo" "$(printf '%s' "$resp" | head -c 300)"
  fi
  sleep 4
}

echo "Instância: ${INST} → ${NUMERO}"
echo 'Vou mandar 3 mensagens, uma a cada 4 segundos. Olhe no CELULAR, não no Web.'
sleep 2

azul '[1/3] ENQUETE  (sendPoll)'
manda sendPoll "$(python3 -c 'import json,sys;print(json.dumps({
  "number": sys.argv[1],
  "name": "[1] ENQUETE\n\nAmanhã tem horário marcado\nDesign de sobrancelhas com Ana Paula dia 02/09 às 10:30.",
  "selectableCount": 1,
  "values": ["Confirmar", "Preciso remarcar"],
  "delay": 800
}))' "$NUMERO")"

azul '[2/3] LISTA  (sendList)'
manda sendList "$(python3 -c 'import json,sys;print(json.dumps({
  "number": sys.argv[1],
  "title": "[2] LISTA",
  "description": "Amanhã tem horário marcado\nDesign de sobrancelhas com Ana Paula dia 02/09 às 10:30.",
  "buttonText": "Responder",
  "footerText": "Agenda Mel",
  "sections": [{"title": "O que você prefere?", "rows": [
    {"title": "Confirmar", "description": "Estarei lá", "rowId": "1"},
    {"title": "Preciso remarcar", "description": "Não vou conseguir", "rowId": "2"}
  ]}],
  "delay": 800
}))' "$NUMERO")"

azul '[3/3] BOTÃO NATIVO  (sendButtons) — o que falhou antes'
manda sendButtons "$(python3 -c 'import json,sys;print(json.dumps({
  "number": sys.argv[1],
  "title": "[3] BOTÃO",
  "description": "Amanhã tem horário marcado\nDesign de sobrancelhas com Ana Paula dia 02/09 às 10:30.",
  "footer": "Agenda Mel",
  "buttons": [
    {"type": "reply", "displayText": "Confirmar", "id": "1"},
    {"type": "reply", "displayText": "Preciso remarcar", "id": "2"}
  ],
  "delay": 800
}))' "$NUMERO")"

echo
echo '-------------------------------------------------------------'
echo 'Me diga quais das três apareceram no celular, e como ficaram.'
echo 'Depois TOQUE numa opção da que apareceu — quero ver o que chega'
echo 'no webhook. Para ver o evento cru:'
echo
echo '    docker compose logs --tail=80 evolution | grep -iE "poll|list|button|upsert"'
echo
