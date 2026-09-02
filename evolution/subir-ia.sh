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
# O que decide a velocidade de geração é núcleo FÍSICO, não vCPU. Uma
# t3.large mostra 2 vCPU, mas são 2 threads do mesmo núcleo: o llama.cpp
# (que roda por baixo do Ollama) usa 1 thread e o CPU% fica em ~100, não 200.
# Hyperthread não dobra aqui porque a geração é limitada por memória, e as
# duas threads do mesmo núcleo disputam o mesmo caminho até a RAM.
FISICOS=$(lscpu 2>/dev/null | awk -F: '/^Core\(s\) per socket/{c=$2} /^Socket\(s\)/{s=$2} END{print (c*s)+0}')
[ "${FISICOS:-0}" -lt 1 ] && FISICOS=$NUCLEOS
DISCO_LIVRE_GB=$(df -BG --output=avail / | tail -1 | tr -dc '0-9')
TIPO=$(curl -s --max-time 3 -H "X-aws-ec2-metadata-token: $(curl -s --max-time 3 -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 60' || true)" \
        http://169.254.169.254/latest/meta-data/instance-type 2>/dev/null || echo '')

echo "  RAM total ..... ${RAM_MB} MB   (livre agora: ${RAM_LIVRE_MB} MB)"
echo "  Swap .......... ${SWAP_MB} MB"
echo "  Núcleos ....... ${NUCLEOS} vCPU / ${FISICOS} físico(s)  <- o que conta é o físico"
echo "  Disco livre ... ${DISCO_LIVRE_GB} GB"
[ -n "$TIPO" ] && echo "  Instância ..... ${TIPO}"

# ---------------------------------------------------------------
azul '== 2/6  Isso cabe aqui? =='

# RAM e disco são contas separadas.
#
# RAM: o modelo fica carregado inteiro enquanto responde, e ainda tem que
# sobrar o que a Evolution + Postgres + Redis usam (uns 1,2 GB em regime).
#
# DISCO: o arquivo do modelo é a parte PEQUENA. A imagem do Ollama traz as
# bibliotecas de CUDA, ROCm e MLX — aceleração de GPU que esta máquina nunca
# vai usar — e passa de 10 GB descompactada. Não existe tag só-CPU: as únicas
# variantes publicadas são a padrão (3,4 GB comprimidos, com CUDA) e a -rocm
# (1,4 GB, para GPU AMD). Por isso o orçamento de disco parece absurdo para
# um modelo de 2,6 GB: quase tudo é imagem.
IMAGEM_GB=12
if   [ "$RAM_MB" -ge 15000 ]; then SUGERIDO='qwen3:8b';    MODELO_GB=6
elif [ "$RAM_MB" -ge 7000  ]; then SUGERIDO='qwen3:4b';    MODELO_GB=3
elif [ "$RAM_MB" -ge 3500  ]; then SUGERIDO='qwen3:1.7b';  MODELO_GB=2
else                               SUGERIDO='';            MODELO_GB=0
fi

if [ -z "$SUGERIDO" ]; then
  vermelho "Com ${RAM_MB} MB de RAM não dá para rodar modelo nenhum junto com a Evolution."
  echo
  echo 'O que fazer, em ordem de preferência:'
  echo '  a) Trocar a instância por uma com 8 GB de RAM.'
  echo '     NÃO faça isso na mão: rode  ./trocar-de-maquina.sh antes'
  echo '     Ele confere o que quebra na troca (IP público, arquitetura) e'
  echo '     te dá o passo a passo certo para esta máquina.'
  echo '  b) Usar um modelo por API (Gemini e Groq têm camada gratuita).'
  echo '  c) Ficar no menu numérico, que não usa modelo nenhum.'
  echo
  vermelho 'Aumentar o DISCO não resolve isto. O que falta é memória.'
  exit 1
fi

if [ "$FISICOS" -le 1 ]; then
  echo
  amarelo 'Esta máquina tem 1 núcleo físico só.'
  amarelo 'Gerar texto é sequencial: cada palavra depende da anterior, então a'
  amarelo 'velocidade é quase proporcional a núcleos físicos. Com 1, espere algo'
  amarelo 'como 3 a 5 palavras por segundo num modelo de 4b.'
  amarelo 'Se a bancada acusar lentidão, as saídas são, em ordem de custo:'
  amarelo '  1. modelo menor (qwen3:1.7b) — de graça, testa com ./bancada-ia.sh qwen3:1.7b'
  amarelo '  2. c7i.xlarge (4 vCPU = 2 núcleos físicos, mesma RAM)'
  amarelo '  3. API'
  echo
fi

MODELO="${IA_MODELO:-$SUGERIDO}"
echo "  Modelo escolhido: ${MODELO}"
[ "$MODELO" != "$SUGERIDO" ] && amarelo "  (veio do IA_MODELO no .env; pela RAM eu sugeriria ${SUGERIDO})"

# O swapfile é criado logo abaixo e ocupa disco, então entra no orçamento
# antes de decidir se cabe — senão a conta fecha aqui e estoura no pull.
SWAP_A_CRIAR_GB=0
[ "$SWAP_MB" -lt 4000 ] && SWAP_A_CRIAR_GB=$(( 4 - (SWAP_MB / 1024) ))
[ "$SWAP_A_CRIAR_GB" -lt 0 ] && SWAP_A_CRIAR_GB=0

PRECISA_GB=$((IMAGEM_GB + MODELO_GB + SWAP_A_CRIAR_GB + 2))

echo "  Disco necessário: ${PRECISA_GB} GB"
echo "    imagem do Ollama ..... ${IMAGEM_GB} GB (CUDA/ROCm que não serão usados)"
echo "    modelo ${MODELO} ..... ${MODELO_GB} GB"
[ "$SWAP_A_CRIAR_GB" -gt 0 ] && echo "    swap a criar ......... ${SWAP_A_CRIAR_GB} GB"
echo "    folga ................ 2 GB"

if [ "$DISCO_LIVRE_GB" -lt "$PRECISA_GB" ]; then
  vermelho "Disco insuficiente: ${DISCO_LIVRE_GB} GB livres, preciso de ${PRECISA_GB} GB."
  echo
  echo 'Para resolver:'
  echo '  1. Console AWS -> EC2 -> Volumes -> marque o volume -> Actions ->'
  echo "     Modify volume -> aumente o Size em pelo menos $((PRECISA_GB - DISCO_LIVRE_GB + 5)) GB -> Modify."
  echo '     Pode fazer com a máquina ligada. Espere sair de "optimizing".'
  echo '  2. Aqui:  ./crescer-disco.sh'
  echo '  3. E rode este script de novo.'
  echo
  echo 'Se sobrou lixo de uma tentativa que falhou no meio, isto devolve espaço'
  echo '(não mexe nos volumes, então a Evolution e o WhatsApp ficam intactos):'
  echo '  docker system prune -af'
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
    amarelo "Nota sobre ${TIPO}: é instância burstable."
    echo '  Ela usa 100% da CPU quando precisa, mas só sustenta uma média'
    echo '  menor. Acima dessa média a AWS gasta um saldo de créditos; se o'
    echo '  saldo zerar, ela te segura no baseline e tudo fica lento.'
    echo
    echo '  O que isso significa aqui: o modelo só usa CPU nos segundos em'
    echo '  que está escrevendo a resposta. Parado, é 0% — ele nem fica'
    echo '  carregado na memória depois de 10 minutos sem uso.'
    case "$TIPO" in
      *.large)
        echo
        echo '  A conta, para uma .large (36 créditos por hora, 2 vCPU):'
        echo '    uma resposta de 5 s custa ~0,17 crédito'
        echo '    dá ~200 respostas por hora sem o saldo nunca cair'
        echo '    e ainda existe um banco de 864 créditos acumulados'
        echo '  Um salão com 100 mensagens por DIA usa uns 2% disso.'
        ;;
    esac
    echo
    echo '  Onde morde de verdade: teste em rajada, ou várias clientes'
    echo '  escrevendo ao mesmo tempo. T3 já vem em Unlimited de fábrica,'
    echo '  que cobra por hora excedente em vez de te limitar. Confira em'
    echo '  Actions -> Instance settings -> Change credit specification.'
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
echo 'Vai pelo mesmo caminho que o Supabase vai usar: HTTPS, pelo Caddy, com'
echo 'token. Assim este teste prova a corrente inteira, não só o container.'
echo
echo 'A PRIMEIRA resposta demora mais: o modelo precisa sair do disco e entrar'
echo 'na RAM antes da primeira palavra. Não digite nada, só espere.'
echo

command -v jq >/dev/null || { sudo apt-get update -qq && sudo apt-get install -y jq >/dev/null; }

# think:false é ESSENCIAL. O Qwen3 é um modelo de raciocínio e vem com o
# "pensamento" ligado de fábrica: antes de responder ele escreve um monólogo
# interno de centenas de tokens. A 3 tokens/s numa CPU de 2 núcleos, isso
# transforma uma resposta de 5 s em vários minutos — e para classificar
# "a cliente quer marcar ou desmarcar?" o raciocínio não acrescenta nada.
CORPO=$(jq -n --arg m "$MODELO" '{
  model: $m, stream: false, think: false,
  options: { temperature: 0, num_predict: 80 },
  messages: [ { role: "user",
    content: "Responda em uma frase curta, em português do Brasil: o que é um agendamento?" } ]
}')

INICIO=$(date +%s)
BRUTO=$(curl -s --max-time 300 "https://${DOMINIO}/ia/api/chat" \
          -H "Authorization: Bearer ${IA_TOKEN}" \
          -H 'Content-Type: application/json' \
          -d "$CORPO")
FIM=$(date +%s)
RESPOSTA=$(echo "$BRUTO" | jq -r '.message.content // empty' 2>/dev/null)

echo
echo "  resposta: ${RESPOSTA}"
echo "  levou:    $((FIM - INICIO)) s"
echo

if [ -z "$RESPOSTA" ]; then
  vermelho 'Não veio resposta.'
  echo "  o que voltou: $(echo "$BRUTO" | head -c 300)"
  echo
  echo 'Para investigar:'
  echo '  docker exec evolution_ollama ollama ps   # o modelo está carregado?'
  echo '  docker logs --tail 50 evolution_ollama'
  echo '  free -m                                  # coube na RAM?'
  echo '  dmesg | tail                             # o kernel matou alguém?'
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
