#!/usr/bin/env bash
#
# Agenda Mel — sobe um modelo de linguagem na própria VPS.
#
#   cd agenda-mel/evolution
#   git pull
#   ./subir-ia.sh
#
# O que ele faz, nessa ordem:
#   1. mede RAM, disco, swap e CPU da máquina
#   2. recusa subir se não couber (e explica o que falta)
#   3. escolhe o modelo que cabe, ou usa o IA_MODELO do .env
#   4. cria o IA_TOKEN se estiver vazio
#   5. sobe o container e baixa o modelo
#   6. faz uma pergunta de verdade em português e cronometra
#
# Pode rodar de novo quantas vezes quiser.

set -euo pipefail

azul()    { printf '\033[1;34m%s\033[0m\n' "$*"; }
verde()   { printf '\033[1;32m%s\033[0m\n' "$*"; }
amarelo() { printf '\033[1;33m%s\033[0m\n' "$*"; }
vermelho(){ printf '\033[1;31m%s\033[0m\n' "$*"; }

cd "$(dirname "$0")"

[ -f .env ] || { vermelho 'Não achei o .env aqui. Rode o bootstrap.sh primeiro.'; exit 1; }
set -a; . ./.env; set +a

# ---------------------------------------------------------------
azul '== 1/6  Medindo a máquina =='

RAM_MB=$(free -m | awk '/^Mem:/{print $2}')
RAM_LIVRE_MB=$(free -m | awk '/^Mem:/{print $7}')   # "available", não "free"
SWAP_MB=$(free -m | awk '/^Swap:/{print $2}')
NUCLEOS=$(nproc)
DISCO_LIVRE_GB=$(df -BG --output=avail / | tail -1 | tr -dc '0-9')
TIPO=$(curl -s --max-time 3 -H "X-aws-ec2-metadata-token: $(curl -s --max-time 3 -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 60' || true)" \
        http://169.254.169.254/latest/meta-data/instance-type 2>/dev/null || echo '')

echo "  RAM total ..... ${RAM_MB} MB   (livre agora: ${RAM_LIVRE_MB} MB)"
echo "  Swap .......... ${SWAP_MB} MB"
echo "  Núcleos ....... ${NUCLEOS}"
echo "  Disco livre ... ${DISCO_LIVRE_GB} GB"
[ -n "$TIPO" ] && echo "  Instância ..... ${TIPO}"

# ---------------------------------------------------------------
azul '== 2/6  Isso cabe aqui? =='

# O modelo é medido em RAM, não em disco. Disco só guarda o arquivo.
# A conta é: tamanho do modelo + ~800 MB de contexto e overhead,
# e ainda tem que sobrar o que a Evolution + Postgres + Redis usam
# (uns 1,2 GB em regime).
if   [ "$RAM_MB" -ge 15000 ]; then SUGERIDO='qwen3:8b';    PESO_GB=6
elif [ "$RAM_MB" -ge 7000  ]; then SUGERIDO='qwen3:4b';    PESO_GB=4
elif [ "$RAM_MB" -ge 3500  ]; then SUGERIDO='qwen3:1.7b';  PESO_GB=2
else                               SUGERIDO='';            PESO_GB=0
fi

if [ -z "$SUGERIDO" ]; then
  vermelho "Com ${RAM_MB} MB de RAM não dá para rodar modelo nenhum junto com a Evolution."
  echo
  echo 'O que fazer, em ordem de preferência:'
  echo '  a) Trocar a instância por uma com 8 GB (t3.large / t3a.large / m7g.large).'
  echo '     Console AWS -> EC2 -> Instances -> Stop -> Actions -> Instance settings'
  echo '     -> Change instance type -> Start. O disco e o Elastic IP continuam.'
  echo '  b) Usar um modelo por API (Gemini e Groq têm camada gratuita).'
  echo '  c) Ficar no menu numérico, que não usa modelo nenhum.'
  echo
  vermelho 'Aumentar o DISCO não resolve isto. O que falta é memória.'
  exit 1
fi

MODELO="${IA_MODELO:-$SUGERIDO}"
echo "  Modelo escolhido: ${MODELO}"
[ "$MODELO" != "$SUGERIDO" ] && amarelo "  (veio do IA_MODELO no .env; pela RAM eu sugeriria ${SUGERIDO})"

if [ "$DISCO_LIVRE_GB" -lt $((PESO_GB + 3)) ]; then
  vermelho "Disco insuficiente: ${DISCO_LIVRE_GB} GB livres, preciso de uns $((PESO_GB + 3)) GB."
  echo 'Rode o ./crescer-disco.sh (depois de aumentar o volume no console da AWS).'
  exit 1
fi

if [ "$SWAP_MB" -lt 2048 ]; then
  amarelo "Swap de ${SWAP_MB} MB é pouco. Vou criar 4 GB — é rede de segurança"
  amarelo 'contra o kernel matar a Evolution, não substituto de RAM: se o modelo'
  amarelo 'começar a usar swap de verdade, a resposta passa de segundos a minutos.'
  sudo swapoff /swapfile 2>/dev/null || true
  sudo rm -f /swapfile
  sudo fallocate -l 4G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null
  sudo swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
  verde 'Swap de 4 GB no ar.'
fi

case "$TIPO" in
  t2.*|t3.*|t3a.*|t4g.*)
    echo
    amarelo "Atenção: ${TIPO} é instância burstable."
    amarelo 'Gerar texto usa 100% da CPU o tempo todo. Você queima os créditos'
    amarelo 'em pouco tempo e a AWS te limita ao baseline (uma fração de um vCPU),'
    amarelo 'aí o modelo fica lento demais para conversar. Para uso de verdade,'
    amarelo 'ligue Unlimited (cobra por hora extra) ou vá para m7g/c7g.'
    ;;
esac

# ---------------------------------------------------------------
azul '== 3/6  Token da rota /ia =='

if [ -z "${IA_TOKEN:-}" ]; then
  IA_TOKEN=$(openssl rand -hex 32)
  # apaga a linha antiga (vazia ou não) e escreve a nova
  sed -i '/^IA_TOKEN=/d' .env
  echo "IA_TOKEN=${IA_TOKEN}" >> .env
  verde 'Token gerado e gravado no .env.'
else
  echo 'Já tinha um no .env, mantido.'
fi
export IA_TOKEN

# ---------------------------------------------------------------
azul '== 4/6  Subindo o container =='

docker compose --profile ia up -d ollama
# o Caddy precisa reler o Caddyfile e enxergar o IA_TOKEN
docker compose up -d --force-recreate caddy

echo -n 'Esperando o Ollama responder'
for _ in $(seq 30); do
  if docker exec evolution_ollama ollama list >/dev/null 2>&1; then echo; break; fi
  echo -n '.'; sleep 2
done
docker exec evolution_ollama ollama list >/dev/null 2>&1 || {
  echo; vermelho 'O Ollama não subiu. Veja:  docker logs evolution_ollama'; exit 1; }
verde 'Container no ar.'

# ---------------------------------------------------------------
azul "== 5/6  Baixando o ${MODELO} =="
echo 'Alguns GB. Na primeira vez demora; depois fica no volume.'
docker exec evolution_ollama ollama pull "$MODELO"

sed -i '/^IA_MODELO=/d' .env
echo "IA_MODELO=${MODELO}" >> .env

# ---------------------------------------------------------------
azul '== 6/6  Perguntando de verdade, em português =='

INICIO=$(date +%s)
RESPOSTA=$(docker exec evolution_ollama ollama run "$MODELO" \
  'Responda em uma frase curta, em português do Brasil: o que é um agendamento?' 2>/dev/null || true)
FIM=$(date +%s)

echo
echo "  resposta: ${RESPOSTA}"
echo "  levou:    $((FIM - INICIO)) s"
echo

if [ -z "$RESPOSTA" ]; then
  vermelho 'Não veio resposta. Veja:  docker logs evolution_ollama'
  exit 1
fi

verde '================================================'
verde " Modelo local no ar: ${MODELO}"
verde '================================================'
echo
echo 'Endereço para o Supabase (por HTTPS, com token):'
echo "  https://${DOMINIO}/ia/api/chat"
echo
echo 'Confira de fora, do seu computador:'
echo "  curl -s https://${DOMINIO}/ia/api/tags -H \"Authorization: Bearer ${IA_TOKEN}\""
echo
echo 'Agora rode a bancada, que é o que decide se ele serve:'
echo '  ./bancada-ia.sh'
echo
echo 'Para desligar e devolver a RAM:'
echo '  docker compose --profile ia down'
