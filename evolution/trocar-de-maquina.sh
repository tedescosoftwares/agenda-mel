#!/usr/bin/env bash
#
# Agenda Mel — trocar o tipo da instância sem quebrar o que já funciona.
#
#   ./trocar-de-maquina.sh antes     # ANTES de parar a instância
#   ./trocar-de-maquina.sh depois    # depois que ela voltar
#
# Trocar o tipo parece inofensivo e não é: parar a instância troca o IP
# público se você não tiver Elastic IP, e o seu domínio aponta para ele.
# Sem o domínio resolvendo, o certificado não renova, o webhook do
# Supabase para de chegar e o WhatsApp cai. O "antes" anota tudo o que
# importa; o "depois" compara e diz exatamente o que consertar.

set -uo pipefail

azul()    { printf '\033[1;34m%s\033[0m\n' "$*"; }
verde()   { printf '\033[1;32m%s\033[0m\n' "$*"; }
amarelo() { printf '\033[1;33m%s\033[0m\n' "$*"; }
vermelho(){ printf '\033[1;31m%s\033[0m\n' "$*"; }

cd "$(dirname "$0")"
[ -f .env ] || { vermelho 'Não achei o .env.'; exit 1; }
set -a; . ./.env; set +a

RETRATO='.antes-da-troca'

# Lê um campo do metadata da EC2 (IMDSv2). Fora da AWS, ou atrás de um
# proxy, esse endereço responde com uma página de erro — que não é
# resposta. Por isso o formato é conferido antes de devolver: melhor
# vazio e um "?" na tela do que gravar lixo no retrato.
imds() {
  local t v
  t=$(curl -s --max-time 3 -X PUT http://169.254.169.254/latest/api/token \
        -H 'X-aws-ec2-metadata-token-ttl-seconds: 120' 2>/dev/null) || true
  v=$(curl -s --max-time 3 -H "X-aws-ec2-metadata-token: ${t}" \
        "http://169.254.169.254/latest/meta-data/$1" 2>/dev/null) || true
  case "$1" in
    public-ipv4)   echo "$v" | grep -Eqx '[0-9]{1,3}(\.[0-9]{1,3}){3}' || v='' ;;
    instance-type) echo "$v" | grep -Eqx '[a-z0-9]+\.[a-z0-9]+'         || v='' ;;
  esac
  printf '%s' "$v"
}

# O IMDS é a fonte certa, mas se ele estiver mudo o checkip serve:
# saber o IP público é o item mais importante desta troca.
meu_ip() {
  local ip
  ip=$(imds public-ipv4)
  [ -n "$ip" ] && { printf '%s' "$ip"; return; }
  ip=$(curl -s --max-time 5 https://checkip.amazonaws.com 2>/dev/null | tr -d '[:space:]')
  echo "$ip" | grep -Eqx '[0-9]{1,3}(\.[0-9]{1,3}){3}' && printf '%s' "$ip"
}


case "${1:-}" in

# =================================================================
antes)
  azul '== Retrato da máquina antes da troca =='

  IP=$(meu_ip)
  TIPO=$(imds instance-type)
  ARQ=$(uname -m)
  RAM_MB=$(free -m | awk '/^Mem:/{print $2}')
  DISCO_GB=$(df -BG --output=size / | tail -1 | tr -dc '0-9')

  printf '  IP público .... %s\n' "${IP:-?}"
  printf '  Instância ..... %s\n' "${TIPO:-?}"
  printf '  Arquitetura ... %s\n' "$ARQ"
  printf '  RAM ........... %s MB\n' "$RAM_MB"
  printf '  Disco ......... %s GB\n' "$DISCO_GB"
  printf '  Domínio ....... %s\n' "$DOMINIO"

  IP_DOMINIO=$(getent hosts "$DOMINIO" | awk '{print $1}' | head -1)
  printf '  %s aponta para %s\n' "$DOMINIO" "${IP_DOMINIO:-?}"

  { echo "IP_ANTES='${IP}'"; echo "TIPO_ANTES='${TIPO}'"; echo "ARQ_ANTES='${ARQ}'"
    echo "RAM_ANTES='${RAM_MB}'"; echo "DISCO_ANTES='${DISCO_GB}'"; } > "$RETRATO"
  echo
  verde "Anotado em ${RETRATO}."

  # ---------------------------------------------------------------
  azul '== O que serve para esta máquina =='
  echo
  if [ "$ARQ" = 'x86_64' ]; then
    echo "  Seu sistema é x86_64. Você NÃO pode trocar para Graviton"
    echo "  (m7g, c7g, t4g): o disco tem um sistema compilado para Intel/AMD"
    echo "  e a máquina não dá boot. Graviton só recomeçando do zero."
    echo
    echo '  Com 8 GB, na mesma arquitetura:'
    echo '    t3.large    2 vCPU · 8 GB · burstable · mais barata'
    echo '    t3a.large   2 vCPU · 8 GB · burstable · AMD, um pouco mais barata'
    echo '    m7i.large   2 vCPU · 8 GB · CPU cheia, sem crédito para acabar'
    echo '    c7i.xlarge  4 vCPU · 8 GB · o dobro de núcleos, gera texto mais rápido'
    echo
    echo '  Para só experimentar, t3.large com Unlimited ligado resolve.'
    echo '  Se a bancada acusar lentidão, o que falta é vCPU: c7i.xlarge.'
  else
    echo "  Seu sistema é ${ARQ} (Graviton/ARM). Fique na família ARM:"
    echo '    m7g.large   2 vCPU · 8 GB'
    echo '    c7g.xlarge  4 vCPU · 8 GB'
    echo '  Trocar para t3/m7i (Intel) não dá boot.'
  fi

  # ---------------------------------------------------------------
  # o modelo pesa uns 3 GB e o Docker precisa de folga para descompactar;
  # abaixo de 30 GB o download falha no meio
  if [ "$DISCO_GB" -ge 30 ]; then
    RECADO_DISCO="${DISCO_GB} GB já basta, não precisa mexer."
  else
    RECADO_DISCO="${DISCO_GB} GB é pouco. Pode aumentar com a máquina ligada:
     EC2 -> Volumes -> marque o volume -> Actions -> Modify volume ->
     Size de ${DISCO_GB} para 30 -> Modify. Espere o State sair de
     \"optimizing\". Depois da troca, rode ./crescer-disco.sh aqui dentro."
  fi

  echo
  azul '== Passo a passo =='
  cat <<TXT

  1. IP fixo — faça isto ANTES de parar qualquer coisa.
     Console AWS -> EC2 -> Elastic IPs. Se o IP ${IP:-desta máquina}
     NÃO estiver nessa lista, ele é temporário e você vai perdê-lo ao
     parar a instância. Nesse caso: Allocate Elastic IP address ->
     Associate -> escolha esta instância. É de graça enquanto estiver
     associada a uma instância ligada.

     Pulou este passo? Dá para consertar depois atualizando o DuckDNS,
     mas o site fica fora do ar nesse meio tempo.

  2. Disco: ${RECADO_DISCO}

  3. Trocar o tipo.
     EC2 -> Instances -> marque -> Instance state -> Stop instance.
     Espere ficar "stopped" de verdade. Depois:
     Actions -> Instance settings -> Change instance type -> escolha ->
     Apply. Depois Instance state -> Start instance.

  4. Voltar aqui pelo SSH e rodar:
       cd ~/agenda-mel/evolution
       ./trocar-de-maquina.sh depois

TXT
  amarelo 'Os containers têm restart: always, então sobem sozinhos no boot.'
  amarelo 'Os dados (instância do WhatsApp, Postgres, certificado) ficam em'
  amarelo 'volumes do Docker, que vivem no disco. Nada disso se perde.'
  ;;

# =================================================================
depois)
  [ -f "$RETRATO" ] || { vermelho "Não achei o ${RETRATO}. Você rodou o 'antes'?"; exit 1; }
  . "$RETRATO"

  azul '== Comparando com o retrato de antes =='

  IP=$(meu_ip)
  TIPO=$(imds instance-type)
  RAM_MB=$(free -m | awk '/^Mem:/{print $2}')
  DISCO_GB=$(df -BG --output=size / | tail -1 | tr -dc '0-9')

  printf '  instância ... %s  ->  %s\n' "$TIPO_ANTES" "${TIPO:-?}"
  printf '  RAM ......... %s MB  ->  %s MB\n' "$RAM_ANTES" "$RAM_MB"
  printf '  disco ....... %s GB  ->  %s GB\n' "$DISCO_ANTES" "$DISCO_GB"
  printf '  IP público .. %s  ->  %s\n' "$IP_ANTES" "${IP:-?}"
  echo

  FALTA=0

  if [ -z "$IP" ] || [ -z "$IP_ANTES" ]; then
    amarelo 'Não consegui ler o IP público, então não posso dizer se mudou.'
    echo "  Confira na mão: o ${DOMINIO} tem que apontar para esta máquina."
    echo "    dig +short ${DOMINIO}"
    echo '    curl -s https://checkip.amazonaws.com'
    echo '  Se os dois não baterem, atualize o DuckDNS antes de seguir.'
    FALTA=1
  elif [ "$IP" != "$IP_ANTES" ]; then
    vermelho 'O IP PÚBLICO MUDOU. Você não tinha Elastic IP.'
    echo
    echo "  O ${DOMINIO} ainda aponta para ${IP_ANTES}. Enquanto isso não"
    echo '  for corrigido, o Supabase não alcança a Evolution.'
    echo
    echo '  DuckDNS — troque SEU_TOKEN pelo token do painel do duckdns.org:'
    echo "    curl \"https://www.duckdns.org/update?domains=${DOMINIO%%.*}&token=SEU_TOKEN&ip=${IP}\""
    echo
    echo '  Depois disso, considere alocar um Elastic IP para não passar'
    echo '  por isto de novo.'
    FALTA=1
  else
    verde 'IP público continua o mesmo.'
  fi

  if [ "$DISCO_GB" -gt "$DISCO_ANTES" ]; then
    verde "Volume maior detectado (${DISCO_ANTES} -> ${DISCO_GB} GB)."
  else
    LIVRE=$(df -BG --output=avail / | tail -1 | tr -dc '0-9')
    if [ "$LIVRE" -lt 8 ]; then
      amarelo "Só ${LIVRE} GB livres e o sistema de arquivos não cresceu."
      amarelo 'Se você aumentou o volume na AWS, rode:  ./crescer-disco.sh'
      FALTA=1
    fi
  fi

  if [ "$RAM_MB" -le "$RAM_ANTES" ]; then
    amarelo "A RAM não aumentou (${RAM_MB} MB). O tipo da instância trocou mesmo?"
    FALTA=1
  else
    verde "RAM subiu para ${RAM_MB} MB."
  fi

  azul '== Os containers voltaram? =='
  docker compose up -d 2>/dev/null
  sleep 3
  docker compose ps --format '  {{.Name}}\t{{.Status}}' 2>/dev/null || docker compose ps

  echo
  azul '== Corrente inteira =='
  ./diagnostico.sh

  echo
  if [ "$FALTA" -eq 0 ]; then
    verde 'Máquina trocada e no ar. Próximo passo:'
    echo '  ./subir-ia.sh    # sobe o modelo'
    echo '  ./bancada-ia.sh  # diz se ele serve'
  else
    amarelo 'Resolva os pontos acima e rode este comando de novo.'
  fi
  ;;

# =================================================================
*)
  echo 'Uso:'
  echo '  ./trocar-de-maquina.sh antes    # antes de parar a instância'
  echo '  ./trocar-de-maquina.sh depois   # depois que ela voltar'
  exit 1
  ;;
esac
