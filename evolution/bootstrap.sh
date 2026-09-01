#!/usr/bin/env bash
#
# Agenda Mel — instala a Evolution API numa Ubuntu limpa.
#
#   git clone https://github.com/tedescosoftwares/agenda-mel.git
#   cd agenda-mel/evolution
#   ./bootstrap.sh
#
# Pode rodar de novo quantas vezes quiser: o que já está feito é pulado.

set -euo pipefail

azul()   { printf '\033[1;34m%s\033[0m\n' "$*"; }
verde()  { printf '\033[1;32m%s\033[0m\n' "$*"; }
amarelo(){ printf '\033[1;33m%s\033[0m\n' "$*"; }
vermelho(){ printf '\033[1;31m%s\033[0m\n' "$*"; }

cd "$(dirname "$0")"

# ---------------------------------------------------------------
azul '== 1/6  Conferindo a máquina =='

if [ ! -f /etc/os-release ] || ! grep -qi ubuntu /etc/os-release; then
  amarelo 'Isto foi escrito para Ubuntu. Em outra distro, siga o LEIAME na mão.'
fi

RAM_MB=$(free -m | awk '/^Mem:/{print $2}')
echo "RAM: ${RAM_MB} MB · arquitetura: $(uname -m) · $(. /etc/os-release && echo "$PRETTY_NAME")"

IP_PUBLICO=$(curl -s --max-time 5 https://checkip.amazonaws.com || echo '?')
echo "IP público desta máquina: ${IP_PUBLICO}"

# ---------------------------------------------------------------
azul '== 2/6  Swap (instância pequena aperta com Postgres + Evolution) =='

if [ "$RAM_MB" -lt 2048 ] && [ "$(swapon --show | wc -l)" -eq 0 ]; then
  echo 'Menos de 2 GB e sem swap: criando 2 GB.'
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null
  sudo swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
  verde 'Swap criado.'
else
  echo 'Nada a fazer.'
fi

# ---------------------------------------------------------------
azul '== 3/6  Docker =='

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  echo "Já instalado: $(docker --version)"
else
  echo 'Instalando do repositório oficial (o docker.io do Ubuntu vem velho)...'
  sudo apt-get update -qq
  sudo apt-get install -y -qq ca-certificates curl gnupg

  sudo install -m 0755 -d /etc/apt/keyrings
  if [ ! -f /etc/apt/keyrings/docker.gpg ]; then
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
      | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    sudo chmod a+r /etc/apt/keyrings/docker.gpg
  fi

  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

  sudo apt-get update -qq
  sudo apt-get install -y -qq docker-ce docker-ce-cli containerd.io \
    docker-buildx-plugin docker-compose-plugin

  sudo usermod -aG docker "$USER"
  verde "Instalado: $(docker --version)"
fi

# O usermod acima só vale para sessões novas: a que está aberta agora
# continua sem o grupo docker. Melhor parar aqui, com instrução clara,
# do que morrer lá embaixo num "permission denied ... docker.sock".
if ! docker info >/dev/null 2>&1; then
  echo
  amarelo 'O Docker está instalado, mas esta sessão de SSH ainda não'
  amarelo 'enxerga o grupo docker — ela carrega os grupos de quando você'
  amarelo 'entrou, e você acabou de ser adicionado.'
  echo
  echo 'Reconecte e rode de novo (o que já foi feito é pulado):'
  echo
  echo '    exit'
  echo '    ssh -i sua-chave.pem ubuntu@'"${IP_PUBLICO}"
  echo '    cd agenda-mel/evolution && ./bootstrap.sh'
  echo
  echo 'Ou, sem reconectar:'
  echo
  echo '    newgrp docker'
  echo '    ./bootstrap.sh'
  echo
  exit 0
fi

# ---------------------------------------------------------------
azul '== 4/6  Configuração =='

if [ -f .env ]; then
  echo 'Já existe um .env — mantendo. (apague se quiser refazer)'
  # shellcheck disable=SC1091
  set -a; . ./.env; set +a
else
  echo
  echo 'Preciso de duas coisas suas. O resto eu gero.'
  echo
  read -rp 'Domínio que aponta para este IP (ex.: agendamel.duckdns.org): ' DOMINIO
  read -rp 'E-mail para a Let'"'"'s Encrypt avisar sobre o certificado: ' EMAIL

  if [ -z "$DOMINIO" ] || [ -z "$EMAIL" ]; then
    vermelho 'Domínio e e-mail são obrigatórios. O HTTPS depende dos dois.'
    exit 1
  fi

  API_KEY=$(openssl rand -hex 32)
  POSTGRES_SENHA=$(openssl rand -hex 16)
  WEBHOOK_TOKEN=$(openssl rand -hex 32)

  cat > .env <<EOF
DOMINIO=${DOMINIO}
EMAIL=${EMAIL}
API_KEY=${API_KEY}
POSTGRES_SENHA=${POSTGRES_SENHA}
# não é usado pelo compose; fica guardado aqui para você configurar o
# webhook e os secrets do Supabase depois
WEBHOOK_TOKEN=${WEBHOOK_TOKEN}
EOF
  chmod 600 .env
  verde 'Escrevi o .env com as chaves geradas.'
fi

# o domínio realmente aponta para cá?
IP_DOMINIO=$(getent hosts "$DOMINIO" 2>/dev/null | awk '{print $1}' | head -1 || true)
if [ -z "$IP_DOMINIO" ]; then
  amarelo "AVISO: ${DOMINIO} não resolve. O certificado vai falhar até apontar."
elif [ "$IP_DOMINIO" != "$IP_PUBLICO" ]; then
  amarelo "AVISO: ${DOMINIO} aponta para ${IP_DOMINIO}, mas esta máquina é ${IP_PUBLICO}."
  amarelo 'O Let'"'"'s Encrypt vai recusar o certificado enquanto isso não bater.'
else
  verde "DNS conferido: ${DOMINIO} → ${IP_PUBLICO}"
fi

# ---------------------------------------------------------------
azul '== 5/6  Subindo a stack =='

# As quatro imagens descompactadas passam de 2 GB. O volume padrão da
# EC2 tem 8 GB, e o swap acima já come 2 — dá para acabar no meio do
# pull, que falha com "no space left on device" depois de baixar tudo.
LIVRE_MB=$(df -Pm / | awk 'NR==2{print $4}')
echo "Espaço livre em /: ${LIVRE_MB} MB"

if [ "$LIVRE_MB" -lt 3000 ]; then
  echo
  vermelho "Pouco espaço: as imagens precisam de uns 3 GB e há ${LIVRE_MB} MB."
  echo
  DISCO=$(lsblk -no PKNAME "$(findmnt -no SOURCE /)" 2>/dev/null | head -1)
  PARTICAO=$(findmnt -no SOURCE / 2>/dev/null)
  echo 'Aumente o volume — dá para fazer com a máquina ligada:'
  echo
  echo '  1. Console da AWS: EC2 -> Volumes -> o volume desta instância'
  echo '     -> Actions -> Modify volume -> Size: 20 -> Modify'
  echo '     (espere sair de "optimizing")'
  echo
  echo '  2. Aqui, avise o Linux que o disco cresceu:'
  echo
  if [ -n "$DISCO" ]; then
    NUM=$(echo "$PARTICAO" | grep -o '[0-9]*$')
    echo "       sudo growpart /dev/${DISCO} ${NUM}"
    echo "       sudo resize2fs ${PARTICAO}"
  else
    echo '       sudo growpart /dev/nvme0n1 1'
    echo '       sudo resize2fs /dev/nvme0n1p1'
  fi
  echo
  echo '  3. Rode este script de novo.'
  echo
  exit 1
fi

docker compose pull -q 2>/dev/null || docker compose pull
docker compose up -d

echo 'Esperando a Evolution responder (o certificado leva alguns segundos)...'
OK=nao
for i in $(seq 1 30); do
  if curl -fsS --max-time 5 "https://${DOMINIO}/" >/dev/null 2>&1; then
    OK=sim
    break
  fi
  sleep 5
  printf '.'
done
echo

# ---------------------------------------------------------------
azul '== 6/6  Resultado =='
echo

if [ "$OK" = 'sim' ]; then
  verde "NO AR:  https://${DOMINIO}"
  echo
  echo "Painel para escanear o QR code:"
  echo "    https://${DOMINIO}/manager"
  echo
  echo "Entre com esta chave:"
  echo "    $(grep '^API_KEY=' .env | cut -d= -f2)"
  echo
  echo "Crie a instância com o nome:  espaco-mel"
  echo
  echo "Depois, no seu computador, publique os segredos no Supabase:"
  echo
  echo "    supabase secrets set \\"
  echo "      EVOLUTION_URL=https://${DOMINIO} \\"
  echo "      EVOLUTION_API_KEY=$(grep '^API_KEY=' .env | cut -d= -f2) \\"
  echo "      EVOLUTION_WEBHOOK_TOKEN=$(grep '^WEBHOOK_TOKEN=' .env | cut -d= -f2)"
  echo
else
  vermelho 'Ainda não respondeu. Os três suspeitos de sempre:'
  echo
  echo '  1. Security Group sem as portas 80 e 443 abertas para 0.0.0.0/0'
  echo "  2. O domínio não aponta para ${IP_PUBLICO}"
  echo '  3. A Evolution não subiu — veja o log abaixo'
  echo
  echo '--- containers ---'
  docker compose ps
  echo
  echo '--- log da evolution (últimas 40 linhas) ---'
  docker compose logs --tail=40 evolution 2>&1 || true
  echo
  echo '--- log do caddy (últimas 20 linhas) ---'
  docker compose logs --tail=20 caddy 2>&1 || true
  echo
  amarelo 'Cole isto tudo na conversa que eu digo o que é.'
fi
