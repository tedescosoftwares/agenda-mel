#!/usr/bin/env bash
#
# Agenda Mel — bancada do modelo local.
#
#   ./bancada-ia.sh              # usa o modelo do .env
#   ./bancada-ia.sh qwen3:1.7b   # testa outro, baixando se precisar
#   IA_THREADS=2 ./bancada-ia.sh # força o nº de threads (padrão: o do Ollama)
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
# Um modelo passado na linha de comando ganha do .env: assim dá para
# comparar dois modelos na mesma máquina sem editar configuração e sem
# perder o que já estava valendo.
MODELO="${1:-${IA_MODELO:-}}"
[ -n "$MODELO" ] || { vermelho 'Sem modelo. Rode o ./subir-ia.sh, ou passe um: ./bancada-ia.sh qwen3:1.7b'; exit 1; }

if ! docker exec evolution_ollama ollama list 2>/dev/null | awk '{print $1}' | grep -qx "$MODELO"; then
  amarelo "O ${MODELO} ainda não está aqui. Baixando..."
  docker exec evolution_ollama ollama pull "$MODELO" || {
    vermelho "Não consegui baixar o ${MODELO}."; exit 1; }
fi

command -v jq >/dev/null || { amarelo 'Instalando jq...'; sudo apt-get update -qq && sudo apt-get install -y jq >/dev/null; }


# Medir tempo em ms é surpreendentemente fácil de errar. O truque comum com
# "%s" seguido de "%3N" só funciona no date do GNU; onde a largura de campo
# não é honrada, sai o nanossegundo inteiro, o número fica mil vezes maior e
# vira negativo quando o segundo passa. Foi o que aconteceu na primeira
# rodada aqui. O bash 5 tem EPOCHREALTIME, que é confiável; onde não houver,
# caímos para segundos inteiros — resolução pobre, mas nunca mente.
if [ -n "${EPOCHREALTIME:-}" ]; then
  agora_ms() { local t=${EPOCHREALTIME/,/.}; echo $(( ${t%%.*} * 1000 + 10#${t#*.} / 1000 )); }
else
  agora_ms() { echo $(( $(date +%s) * 1000 )); }
fi

# prova que a régua mede o que diz medir, antes de medir qualquer coisa
__a=$(agora_ms); sleep 1; __b=$(agora_ms); __d=$((__b - __a))
if [ "$__d" -lt 800 ] || [ "$__d" -gt 1400 ]; then
  vermelho "A medição de tempo está errada: 1 s deu ${__d} ms."
  vermelho 'Os tempos abaixo seriam mentira, então prefiro não medir.'
  exit 1
fi

URL="https://${DOMINIO}/ia/api/chat"

# Por padrão o Ollama escolhe as threads sozinho: ele usa núcleos FÍSICOS,
# não vCPU, porque as duas threads de um mesmo núcleo disputam o caminho
# até a RAM e a geração é limitada por memória. Numa t3.large (1 núcleo,
# 2 threads) isso dá CPU% em ~100, e parece que metade da máquina está
# parada. Talvez esteja mesmo — mas isso se mede, não se acredita:
#   ./bancada-ia.sh              (deixa o Ollama decidir)
#   IA_THREADS=2 ./bancada-ia.sh (força as duas)
# e compara o tempo médio das duas rodadas.
THREADS_JSON='{}'
if [ -n "${IA_THREADS:-}" ]; then
  THREADS_JSON=$(jq -n --argjson n "$IA_THREADS" '{num_thread: $n}')
  echo "  (forçando num_thread=${IA_THREADS})"
fi

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

azul "== Bancada · modelo ${MODELO} · ${URL} =="
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
  CORPO=$(jq -n --arg m "$MODELO" --arg s "$SISTEMA" --arg u "$FRASE" \
              --argjson f "$ESQUEMA" --argjson th "$THREADS_JSON" '{
    model: $m,
    stream: false,
    think: false,
    format: $f,
    options: ( { temperature: 0, num_predict: 120 } + $th ),
    messages: [ {role:"system", content:$s}, {role:"user", content:$u} ]
  }')

  T0=$(agora_ms)
  BRUTO=$(curl -s --max-time 600 "$URL" \
            -H "Authorization: Bearer ${IA_TOKEN}" \
            -H 'Content-Type: application/json' \
            -d "$CORPO")
  T1=$(agora_ms)
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
  amarelo 'Tente um modelo maior se a RAM permitir, ou compare com API.'
fi

echo
echo "Para comparar na mesma máquina:"
echo "  ./bancada-ia.sh qwen3:4b-instruct # o 4b SEM a parte que raciocina"
echo "  ./bancada-ia.sh qwen3:1.7b        # menos da metade do tamanho"
echo "  ./bancada-ia.sh qwen2.5:3b        # não raciocina de jeito nenhum"
echo "  IA_THREADS=2 ./bancada-ia.sh      # força as 2 threads do núcleo"
echo "Gostou de um? Grave no .env:  IA_MODELO=<o que ganhou>" 
