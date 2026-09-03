#!/usr/bin/env bash
#
# Publica o app nesta máquina, ao lado da Evolution.
#
#   ./publicar-site.sh          puxa o código, builda e põe no ar
#   ./publicar-site.sh --so-build   sem git pull (código já está aqui)
#
# O que faz, em ordem:
#   1. garante Node 20 (instala pelo NodeSource se não tiver)
#   2. pergunta o domínio do site UMA vez e guarda em .env
#   3. confere que ../.env tem as chaves do Supabase (o build precisa)
#   4. git pull, npm ci, npm run build  →  ../dist
#   5. sobe o Caddy de novo para ele enxergar o domínio e a pasta
#   6. confere pela internet que o site responde
#
# Depois disso, publicar de novo é só rodar este script outra vez.

set -euo pipefail
cd "$(dirname "$0")"
RAIZ=$(cd .. && pwd)

verde()   { printf '\033[1;32m%s\033[0m\n' "$*"; }
amarelo() { printf '\033[1;33m%s\033[0m\n' "$*"; }
vermelho(){ printf '\033[1;31m%s\033[0m\n' "$*"; }
azul()    { printf '\033[1;34m%s\033[0m\n' "$*"; }

[ -f .env ] || { vermelho 'Não achei o .env da Evolution. Rode ./bootstrap.sh antes.'; exit 1; }
# shellcheck disable=SC1091
set -a; . ./.env; set +a

# 1. Node ---------------------------------------------------------------------
azul '== 1/6  Node =='
if ! command -v node >/dev/null || [ "$(node -v | cut -c2-3)" -lt 20 ]; then
  echo 'Instalando Node 20…'
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - >/dev/null
  sudo apt-get install -y nodejs >/dev/null
fi
verde "  node $(node -v) · npm $(npm -v)"

# 2. Domínio ------------------------------------------------------------------
azul '== 2/6  Domínio do site =='
if [ -z "${DOMINIO_SITE:-}" ]; then
  echo 'O site precisa de um nome próprio, diferente do da Evolution.'
  echo 'No painel do duckdns.org, crie um segundo nome apontando para'
  echo "o MESMO IP desta máquina (ex.: mimoapp.duckdns.org)."
  read -rp '   Domínio do site: ' DOMINIO_SITE
  DOMINIO_SITE=$(printf '%s' "$DOMINIO_SITE" | sed -E 's#^[a-zA-Z]+://##; s#/.*$##' | tr -d ' ')
  [ -n "$DOMINIO_SITE" ] || { vermelho 'Sem domínio não dá.'; exit 1; }
  if grep -q '^DOMINIO_SITE=' .env; then
    sed -i "s|^DOMINIO_SITE=.*|DOMINIO_SITE=${DOMINIO_SITE}|" .env
  else
    printf '\nDOMINIO_SITE=%s\n' "$DOMINIO_SITE" >> .env
  fi
fi
verde "  $DOMINIO_SITE"

# o nome tem de apontar para cá; senão o Caddy não consegue o certificado
IP_AQUI=$(curl -s -m 5 https://checkip.amazonaws.com | tr -d ' \n' || true)
IP_DNS=$(getent hosts "$DOMINIO_SITE" | awk '{print $1}' | head -1 || true)
if [ -n "$IP_AQUI" ] && [ "$IP_DNS" != "$IP_AQUI" ]; then
  amarelo "  ATENÇÃO: $DOMINIO_SITE aponta para '${IP_DNS:-nada}', e esta máquina é $IP_AQUI."
  amarelo '  O HTTPS vai falhar até o DNS apontar para cá. No DuckDNS:'
  echo "    curl \"https://www.duckdns.org/update?domains=${DOMINIO_SITE%%.*}&token=SEU_TOKEN&ip=${IP_AQUI}\""
fi

# 3. Chaves do Supabase -------------------------------------------------------
# O build lê VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY. Elas podem estar
# no .env da raiz do repositório (como no PC) OU aqui mesmo, no .env da
# Evolution — que já foi carregado lá em cima. Os dois lugares valem.
azul '== 3/6  Chaves do app =='
if [ -f "$RAIZ/.env" ]; then
  # shellcheck disable=SC1091
  set -a; . "$RAIZ/.env"; set +a
fi
case "${VITE_SUPABASE_URL:-}" in
  https://*) ;;
  *) vermelho '  Falta VITE_SUPABASE_URL (e VITE_SUPABASE_ANON_KEY).'
     echo "  Ponha as duas linhas em $RAIZ/.env ou em $(pwd)/.env — a chave ANON, nunca a de serviço."
     exit 1 ;;
esac
[ -n "${VITE_SUPABASE_ANON_KEY:-}" ] || { vermelho '  Falta VITE_SUPABASE_ANON_KEY.'; exit 1; }
case "$VITE_SUPABASE_ANON_KEY" in
  eyJ*|sb_publishable_*) ;;
  sb_secret_*) vermelho '  Essa é a chave de SERVIÇO. No app vai a anon (publishable) — a de serviço no navegador entrega o banco inteiro.'; exit 1 ;;
  *) amarelo '  A chave anon não tem a cara de sempre (eyJ… ou sb_publishable_…). Confira.' ;;
esac
export VITE_SUPABASE_URL VITE_SUPABASE_ANON_KEY
verde '  chaves do app encontradas'

# 4. Build ----------------------------------------------------------------------
azul '== 4/6  Build =='
cd "$RAIZ"
if [ "${1:-}" != '--so-build' ]; then
  git pull --ff-only
fi
npm ci --no-audit --no-fund >/dev/null
npm run build 2>&1 | tail -2
[ -f dist/index.html ] || { vermelho 'O build não gerou dist/index.html.'; exit 1; }
# o Caddy roda como outro usuário dentro do container: precisa ler
chmod -R a+rX dist
verde "  dist/ pronto ($(du -sh dist | cut -f1))"
cd "$(dirname "$0")"

# 5. Caddy --------------------------------------------------------------------
azul '== 5/6  Caddy =='
# up -d recria só o caddy se algo mudou (a variável nova, a pasta nova)
docker compose up -d caddy >/dev/null
verde '  caddy no ar'

# 6. Conferir ----------------------------------------------------------------
azul '== 6/6  Conferindo =='
for i in 1 2 3 4 5 6; do
  CODIGO=$(curl -s -o /dev/null -w '%{http_code}' -m 10 "https://${DOMINIO_SITE}/" || echo 000)
  [ "$CODIGO" = 200 ] && break
  sleep 5
done
case "$CODIGO" in
  200) verde "  https://${DOMINIO_SITE} está no ar." ;;
  000) amarelo '  Ainda não respondeu. Se o DNS acabou de mudar, espere um minuto e abra no navegador.'
       echo '  Log:  docker compose logs caddy --tail 30' ;;
  *)   amarelo "  Respondeu $CODIGO. Veja:  docker compose logs caddy --tail 30" ;;
esac
echo
echo 'Para publicar de novo depois de um git pull: ./publicar-site.sh'
