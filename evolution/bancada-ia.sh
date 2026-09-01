#!/usr/bin/env bash
#
# Agenda Mel — bancada do modelo local.
#
#   ./bancada-ia.sh
#
# Manda dez frases que uma cliente realmente escreveria no WhatsApp,
# com abreviação e sem acento, e confere se o modelo devolve o JSON
# certo. Bate no mesmo endereço que o Supabase vai usar, com token e
# tudo, então testa o caminho inteiro e não só o container.
#
# Isto existe porque "o modelo é bom" não se decide lendo benchmark
# de internet: decide-se com as frases das suas clientes, nesta
# máquina, com este modelo. O número que importa é o placar no fim
# e o tempo por resposta.

set -uo pipefail

azul()    { printf '\033[1;34m%s\033[0m\n' "$*"; }
verde()   { printf '\033[1;32m%s\033[0m\n' "$*"; }
amarelo() { printf '\033[1;33m%s\033[0m\n' "$*"; }
vermelho(){ printf '\033[1;31m%s\033[0m\n' "$*"; }

cd "$(dirname "$0")"
[ -f .env ] || { vermelho 'Não achei o .env.'; exit 1; }
set -a; . ./.env; set +a

[ -n "${IA_TOKEN:-}" ]  || { vermelho 'IA_TOKEN vazio no .env. Rode o ./subir-ia.sh.'; exit 1; }
[ -n "${IA_MODELO:-}" ] || { vermelho 'IA_MODELO vazio no .env. Rode o ./subir-ia.sh.'; exit 1; }

command -v jq >/dev/null || { amarelo 'Instalando jq...'; sudo apt-get update -qq && sudo apt-get install -y jq >/dev/null; }

URL="https://${DOMINIO}/ia/api/chat"

# O prompt de sistema é o mesmo que o bot vai usar. Curto de propósito:
# cada token aqui é somado em toda mensagem, e num modelo pequeno
# instrução comprida atrapalha mais do que ajuda.
SISTEMA='Você lê a mensagem de uma cliente de um salão de beleza no WhatsApp e devolve só o JSON.

intencao, escolha uma:
  agendar    quer marcar horário
  remarcar   quer mudar um horário que já tem
  cancelar   quer desmarcar
  confirmar  está confirmando que vem
  preco      pergunta quanto custa
  horarios   pergunta que horários existem
  outro      qualquer outra coisa

servico: manicure, pedicure, sobrancelha, cilios, cabelo, depilacao, ou null
dia: segunda, terca, quarta, quinta, sexta, sabado, domingo, hoje, amanha, ou null
hora: HH:MM em 24h, ou null. "de tarde" sem hora é null.'

ESQUEMA='{
  "type":"object",
  "properties":{
    "intencao":{"type":"string","enum":["agendar","remarcar","cancelar","confirmar","preco","horarios","outro"]},
    "servico":{"type":["string","null"]},
    "dia":{"type":["string","null"]},
    "hora":{"type":["string","null"]}
  },
  "required":["intencao","servico","dia","hora"]
}'

# frase | intencao esperada | servico esperado (- = não confere) | dia esperado
CASOS='oi queria marcar uma manicure pra quinta de tarde|agendar|manicure|quinta
da pra sexta 15h com a mel?|agendar|-|sexta
bom dia, tem horario pro cilios semana que vem?|agendar|cilios|-
preciso desmarcar meu horario de amanha|cancelar|-|amanha
nao vou poder ir infelizmente|cancelar|-|-
consigo mudar pra outro dia?|remarcar|-|-
quanto custa o design de sobrancelha|preco|sobrancelha|-
que horario voce tem livre sabado|horarios|-|sabado
confirmado, pode contar comigo|confirmar|-|-
obrigada linda!!! ate mais|outro|-|-'

azul "== Bancada · modelo ${IA_MODELO} · ${URL} =="
echo

ACERTOS=0
TOTAL=0
SOMA_MS=0

while IFS='|' read -r FRASE ESP_INT ESP_SRV ESP_DIA; do
  [ -z "$FRASE" ] && continue
  TOTAL=$((TOTAL + 1))

  # think:false porque o Qwen3 é modelo de raciocínio e vem pensando por
  # padrão: centenas de tokens de monólogo interno antes da resposta. Numa
  # CPU de 2 núcleos isso vira minutos por mensagem, e para decidir se a
  # cliente quer marcar ou desmarcar o raciocínio não acrescenta nada.
  # Em modelo que não pensa, o campo é simplesmente ignorado.
  CORPO=$(jq -n --arg m "$IA_MODELO" --arg s "$SISTEMA" --arg u "$FRASE" --argjson f "$ESQUEMA" '{
    model: $m,
    stream: false,
    think: false,
    format: $f,
    options: { temperature: 0, num_predict: 120 },
    messages: [ {role:"system", content:$s}, {role:"user", content:$u} ]
  }')

  T0=$(date +%s%3N)
  BRUTO=$(curl -s --max-time 600 "$URL" \
            -H "Authorization: Bearer ${IA_TOKEN}" \
            -H 'Content-Type: application/json' \
            -d "$CORPO")
  T1=$(date +%s%3N)
  MS=$((T1 - T0))
  SOMA_MS=$((SOMA_MS + MS))

  JSON=$(echo "$BRUTO" | jq -r '.message.content // empty' 2>/dev/null)
  if [ -z "$JSON" ] || ! echo "$JSON" | jq -e . >/dev/null 2>&1; then
    vermelho "✗ ${FRASE}"
    echo "   não veio JSON. resposta crua: $(echo "$BRUTO" | head -c 200)"
    continue
  fi

  INT=$(echo "$JSON" | jq -r '.intencao // "null"')
  SRV=$(echo "$JSON" | jq -r '.servico  // "null"')
  DIA=$(echo "$JSON" | jq -r '.dia      // "null"')
  HORA=$(echo "$JSON" | jq -r '.hora    // "null"')

  ERROS=''
  [ "$INT" != "$ESP_INT" ] && ERROS="${ERROS} intencao=${INT} (esperava ${ESP_INT});"
  [ "$ESP_SRV" != '-' ] && [ "$SRV" != "$ESP_SRV" ] && ERROS="${ERROS} servico=${SRV} (esperava ${ESP_SRV});"
  [ "$ESP_DIA" != '-' ] && [ "$DIA" != "$ESP_DIA" ] && ERROS="${ERROS} dia=${DIA} (esperava ${ESP_DIA});"

  if [ -z "$ERROS" ]; then
    ACERTOS=$((ACERTOS + 1))
    verde "✓ ${FRASE}"
    printf '   %s / %s / %s / %s   ·  %s ms\n' "$INT" "$SRV" "$DIA" "$HORA" "$MS"
  else
    vermelho "✗ ${FRASE}"
    printf '   %s  ·  %s ms\n' "$ERROS" "$MS"
  fi
done <<< "$CASOS"

echo
MEDIA=$(( TOTAL > 0 ? SOMA_MS / TOTAL : 0 ))
azul '== Placar =='
echo "  acertos ......... ${ACERTOS}/${TOTAL}"
echo "  tempo médio ..... ${MEDIA} ms por mensagem"
echo

# Estes cortes não são chute: abaixo de 8/10 o bot erra na frente da
# cliente, e acima de 6 s ela acha que ninguém respondeu e escreve de novo.
if [ "$ACERTOS" -ge 8 ] && [ "$MEDIA" -le 6000 ]; then
  verde 'Serve. Dá para usar este modelo no bot.'
elif [ "$ACERTOS" -ge 8 ]; then
  amarelo 'Entende bem, mas está lento demais para conversa de WhatsApp.'
  amarelo 'Caminhos: instância com mais CPU, ou um modelo menor, ou API.'
else
  amarelo 'Erra demais para atender cliente sozinho.'
  amarelo 'Tente um modelo maior (IA_MODELO no .env) se a RAM permitir,'
  amarelo 'ou compare com Gemini/Groq antes de decidir.'
fi
