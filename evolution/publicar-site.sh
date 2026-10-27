#!/usr/bin/env bash
#
# Publica o app nesta máquina, ao lado da Evolution.
#
#   ./publicar-site.sh          puxa o código, builda e põe no ar
#   ./publicar-site.sh --so-build   sem git pull (código já está aqui)
#
# O que faz, em ordem:
#   1. garante Node 22 (instala pelo NodeSource se não tiver)
#   2. pergunta o domínio do site UMA vez e guarda em .env
#   3. confere que ../.env tem as chaves do Supabase (o build precisa)
#   4. git pull, npm ci, npm run build  →  ../dist (a oficina)
#      e põe no ar uma foto do dist: ../site/versoes/<carimbo>, com ../site/atual
#      apontando para ela num único rename (publicar-versao.sh, 3.74.3)
#   5. sobe o Caddy de novo para ele enxergar o domínio e a pasta
#   6. confere pela internet que o site responde
#
# Depois disso, publicar de novo é só rodar este script outra vez.

set -euo pipefail
cd "$(dirname "$0")"
AQUI=$(pwd)
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
# 22 porque o supabase-js pede >=22 (com 20 builda, mas reclama em cada
# pacote — e reclamação que se ignora todo dia esconde a que importa)
if ! command -v node >/dev/null || [ "$(node -v | cut -c2-3)" -lt 22 ]; then
  echo 'Instalando Node 22…'
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - >/dev/null
  sudo apt-get install -y nodejs >/dev/null
fi
verde "  node $(node -v) · npm $(npm -v)"
# 3.74.3: o rsync faz a foto do site com hard links (rápida, sem gastar disco); sem ele a publicação copia o site inteiro
if ! command -v rsync >/dev/null; then
  sudo apt-get install -y rsync >/dev/null 2>&1 || amarelo '  sem rsync: cada publicação copia o site inteiro (funciona, só é mais lenta)'
fi

# 2. Domínio ------------------------------------------------------------------
azul '== 2/6  Domínio do site =='
if [ -z "${DOMINIO_SITE:-}" ]; then
  echo 'O site precisa de um nome próprio, diferente do da Evolution.'
  echo 'No painel do duckdns.org, crie um segundo nome apontando para'
  echo "o MESMO IP desta máquina (ex.: mimo.com.vc)."
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
# o Google Maps (2.82.1) é opcional: sem a chave, o mapa cai no OpenStreetMap
if [ -n "${VITE_GOOGLE_MAPS_KEY:-}" ]; then
  export VITE_GOOGLE_MAPS_KEY
  verde '  Google Maps ligado'
else
  amarelo '  Sem VITE_GOOGLE_MAPS_KEY: o mapa usa OpenStreetMap. Para o Google, ponha a chave no .env.'
fi

# o Caddy precisa do ref do projeto para a prévia do link (/p/<slug>
# vista pelo robô do WhatsApp). Sai da própria URL: https://REF.supabase.co
if [ -z "${SUPABASE_REF:-}" ]; then
  SUPABASE_REF=$(printf '%s' "$VITE_SUPABASE_URL" | sed -E 's#https://([^.]+)\.supabase\.co.*#\1#')
  if [ -n "$SUPABASE_REF" ] && [ "$SUPABASE_REF" != "$VITE_SUPABASE_URL" ]; then
    printf 'SUPABASE_REF=%s\n' "$SUPABASE_REF" >> "$AQUI/.env"
    export SUPABASE_REF
    verde "  SUPABASE_REF=$SUPABASE_REF guardado em $AQUI/.env"
  fi
fi

# 4. Build ----------------------------------------------------------------------
azul '== 4/6  Build =='
# npm ci reinstala o node_modules inteiro e o build escreve o dist: sem folga
# no disco o build morre no fim (service worker) com um erro que parece outra coisa
LIVRE_MB=$(df -Pm "$RAIZ" | awk 'NR==2 {print $4}')
if [ "${LIVRE_MB:-0}" -lt 1024 ]; then
  amarelo "  ATENÇÃO: só ${LIVRE_MB} MB livres no disco. O build precisa de folga; veja ./crescer-disco.sh ou limpe (docker system prune, npm cache clean --force)."
fi
cd "$RAIZ"
if [ "${1:-}" != '--so-build' ]; then
  git pull --ff-only
fi
npm ci --no-audit --no-fund >/dev/null
# 3.41: a mesma trava do republicar-se-mudou.sh (o build e a regeneração escrevem no mesmo dist); espera a que estiver
# rodando terminar, até 15 minutos
if command -v flock >/dev/null; then
  exec 9>/tmp/mimo-republicar.lock
  flock -w 900 9 || amarelo '  uma regeneração passou de 15 minutos; sigo com o build assim mesmo'
fi
# 3.41: o build também é uma publicação: atende o "Publicar agora" que estiver esperando e fica registrado no banco
PEDIDO=$(node scripts/registrar-publicacao.mjs inicio || true)
campo() { printf '%s\n' "$PEDIDO" | sed -n "s/^$1=//p" | head -1; }
PEDIDO_ID=$(campo id); [ "$PEDIDO_ID" = '-' ] && PEDIDO_ID=''
INICIO_PUB=$(campo agora); [ "$INICIO_PUB" = '-' ] && INICIO_PUB=''
VERSAO_PUB=$(campo versao); [ "$VERSAO_PUB" = '-' ] && VERSAO_PUB=''
registrar_pub() { # $1 = 1 (feito) ou 0 (falhou); $2 = resumo
  local urls; urls=$(grep -c '<loc>' dist/sitemap.xml 2>/dev/null || echo '')
  local r; r=$(node scripts/registrar-publicacao.mjs fim --ok "$1" --id "${PEDIDO_ID:--}" --origem manual --inicio "${INICIO_PUB:--}" \
    --versao "${VERSAO_PUB:--}" --urls "${urls:--}" --resumo "$2" || true)
  if [ "$1" = 1 ] && [ "$r" = 'registrado' ] && [ -n "$VERSAO_PUB" ]; then printf '%s' "$VERSAO_PUB" > "$AQUI/.publicacao-registrada"; fi
}
# 3.40: o vite esvazia o dist no build e, com ele, o guia que está no ar (/saloes, /dados/guia e o sitemap). Ele fica
# guardado ao lado (mover não gasta disco) e o gerador o devolve antes de escrever: se o banco não entregar o guia nesta
# rodada, o que estava no ar continua no ar, com as URLs no sitemap. Antes, um build com o banco ocupado tirava o guia
# inteiro do ar e deixava o sitemap com 42 endereços
GUIA_ANTERIOR="$RAIZ/.guia-anterior"
rm -rf "$GUIA_ANTERIOR"; mkdir -p "$GUIA_ANTERIOR/dados"
[ -d dist/saloes ] && mv dist/saloes "$GUIA_ANTERIOR/saloes"
[ -d dist/dados/guia ] && mv dist/dados/guia "$GUIA_ANTERIOR/dados/guia"
[ -f dist/sitemap.xml ] && cp dist/sitemap.xml "$GUIA_ANTERIOR/sitemap.xml"
export GUIA_ANTERIOR
# o build falhou: o guia volta para o dist do jeito que estava
devolver_guia() {
  [ -d "$GUIA_ANTERIOR/saloes" ] && [ ! -d dist/saloes ] && mkdir -p dist && mv "$GUIA_ANTERIOR/saloes" dist/saloes
  [ -d "$GUIA_ANTERIOR/dados/guia" ] && [ ! -d dist/dados/guia ] && mkdir -p dist/dados && mv "$GUIA_ANTERIOR/dados/guia" dist/dados/guia
  [ -f "$GUIA_ANTERIOR/sitemap.xml" ] && [ ! -f dist/sitemap.xml ] && cp "$GUIA_ANTERIOR/sitemap.xml" dist/sitemap.xml
  true
}
# o build inteiro vai para um log; na tela só o fim. Se falhar, as últimas
# 40 linhas aparecem aqui mesmo (o erro do vite vem antes do "closeBundle")
LOG_BUILD=/tmp/mimo-build.log
if ! npm run build > "$LOG_BUILD" 2>&1; then
  devolver_guia
  registrar_pub 0 'o build falhou'
  echo; tail -40 "$LOG_BUILD"; echo
  vermelho "O build falhou. Acima, o fim do log; o log inteiro está em $LOG_BUILD"
  vermelho "Antes de tentar de novo, confira espaço em disco (df -h /) e memória (free -m)."
  exit 1
fi
tail -3 "$LOG_BUILD"
# o que o guia disse no build (cidades, salões, cache, lista de reserva, fora da rodada)
grep -E 'guia-fonte:|guia: |guia de salões|ATENÇÃO' "$LOG_BUILD" | sed 's/^/  /' || true
[ -f dist/index.html ] || { devolver_guia; vermelho 'O build não gerou dist/index.html.'; exit 1; }
# As páginas estáticas e o sitemap são o que o Google lê (scripts/paginas-estaticas.mjs):
# um index.html por rota com título, descrição e canonical próprios. Sem elas o site
# abre, mas toda rota entrega o título da home. Não se publica pela metade.
if [ ! -f dist/sitemap.xml ]; then
  amarelo '  o build não deixou dist/sitemap.xml: gerando as páginas estáticas de novo…'
  node scripts/paginas-estaticas.mjs
fi
[ -f dist/sitemap.xml ] && [ -f dist/_home.html ] || { vermelho 'Sem as páginas estáticas (dist/sitemap.xml, dist/_home.html). Rode: node scripts/paginas-estaticas.mjs'; exit 1; }
verde "  SEO: $(grep -c '<loc>' dist/sitemap.xml) URLs no sitemap, páginas estáticas no lugar"
# o carimbo do conteúdo, para a rodada da hora não regenerar de novo o que o build acabou de gerar
[ -n "$VERSAO_PUB" ] && printf '%s' "$VERSAO_PUB" > dist/.conteudo-versao
# Bing na hora (IndexNow, 3.21): o build apagou o dist e, com ele, o arquivo da chave que o
# Bing confere (dist/<chave>.txt). O indexnow.mjs regrava a chave (ela vai na foto, logo abaixo) e avisa o que mudou.
if [ -n "${INDEXNOW_KEY:-}" ]; then
  node scripts/indexnow.mjs || amarelo '  o aviso ao Bing (IndexNow) falhou; o republicar-se-mudou.sh tenta de novo na próxima hora'
else
  amarelo '  Sem INDEXNOW_KEY no .env o Bing não é avisado na hora. Para ligar: node scripts/indexnow.mjs --gerar-chave'
fi
# o guia guardado já voltou (ou foi refeito): a pasta do lado sai
rm -rf "$GUIA_ANTERIOR"
chmod -R a+rX dist
verde "  dist/ pronto ($(du -sh dist | cut -f1))"
# 3.74.3: até aqui o site no ar não mudou. O dist é a oficina; o que vai ao ar é uma foto dele em ../site/versoes/<carimbo>,
# e ../site/atual (o que o Caddy serve) passa a apontar para ela num único rename. Nenhum pedido vê o site pela metade.
mkdir -p "$RAIZ/site"
if ! "$AQUI/publicar-versao.sh"; then
  registrar_pub 0 'a troca da versão no ar falhou (publicar-versao.sh)'
  vermelho 'A foto do site não foi ao ar; a versão anterior continua servindo. Veja o erro acima.'
  exit 1
fi
# 3.41: registra a publicação (a Plataforma zera o que estava pendente)
registrar_pub 1 "build $(git rev-parse --short HEAD)"
[ -n "$PEDIDO_ID" ] && verde "  o \"Publicar agora\" que esperava (pedido $PEDIDO_ID) foi atendido por este build"
# para não restar dúvida sobre O QUE foi publicado
verde "  publicado o commit $(git rev-parse --short HEAD) — $(git log -1 --format=%s | cut -c1-60)"
verde "  versão do app: $(grep -o "VERSAO = '[^']*'" src/lib/versao.js | cut -d"'" -f2)"
# a versão está no ar: a regeneração (a da hora, a do "Publicar agora") pode voltar a rodar
exec 9>&-
# 3.42: o bat 2 liga o cron sozinho (a rodada da hora e a conferência do minuto, que atende o "Publicar agora")
if ! command -v crontab >/dev/null; then
  amarelo 'Sem crontab nesta máquina: o "Publicar agora" da Plataforma não é atendido. No Ubuntu: sudo apt-get install -y cron && ./republicar-se-mudou.sh --cron'
elif ! crontab -l 2>/dev/null | grep -q 'republicar-se-mudou.sh --pedidos'; then
  "$AQUI/republicar-se-mudou.sh" --cron >/dev/null 2>&1 \
    && verde 'Cron ligado: o "Publicar agora" da Plataforma é atendido em até 1 minuto, e de hora em hora o site se republica sozinho.' \
    || amarelo 'Não consegui ligar o cron: rode ./republicar-se-mudou.sh --cron para ligar o "Publicar agora".'
fi
# de volta para a pasta da Evolution pelo caminho ABSOLUTO: o $0 era
# relativo e, depois do cd para a raiz, apontava para o lugar errado —
# e o docker compose não achava o arquivo
cd "$AQUI"

# 5. Caddy --------------------------------------------------------------------
azul '== 5/6  Caddy =='
# o Caddy daqui é o oficial + plugin de DNS da Cloudflare (caddy/Dockerfile,
# 2.80). A primeira compilação demora uns minutos; depois fica em cache.
echo '  conferindo o Caddy (a primeira vez compila e demora uns minutos)…'
docker compose build --quiet caddy
# up -d recria só o caddy se algo mudou (a variável nova, a pasta nova; na primeira vez depois da 3.74.3, a montagem
# de ../site no lugar de ../dist: alguns segundos fora do ar, uma vez)
docker compose up -d caddy >/dev/null
# O Caddyfile é montado por ARQUIVO (./Caddyfile:/etc/caddy/Caddyfile). O Docker
# prende a montagem ao inode: quando o git pull troca o arquivo, o container
# continua lendo o antigo, e o reload diz "config is unchanged" olhando para a
# versão velha (foi assim que a regra da barra, 3.15.1, ficou meses sem valer).
# Se o de dentro for diferente do de fora, recria o container: alguns segundos
# fora do ar, certificados ficam no volume.
FORA=$(md5sum Caddyfile | cut -c1-32)
DENTRO=$(docker compose exec -T caddy md5sum /etc/caddy/Caddyfile 2>/dev/null | cut -c1-32)
if [ -n "$DENTRO" ] && [ "$DENTRO" != "$FORA" ]; then
  amarelo '  o Caddy estava lendo um Caddyfile antigo (montagem por arquivo): recriando o container…'
  docker compose up -d --force-recreate caddy >/dev/null
  sleep 2
fi
# o reload lê o arquivo de novo sem derrubar ninguém — e é ele que faz o Caddy
# pedir certificado para um domínio novo (pro.)
docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1 \
  && verde '  caddy no ar (configuração relida)' \
  || amarelo '  caddy no ar, mas não consegui reler a configuração: docker compose logs caddy --tail 30'

# 6. Conferir ----------------------------------------------------------------
azul '== 6/6  Conferindo =='
for i in 1 2 3 4 5 6; do
  CODIGO=$(curl -s -o /dev/null -w '%{http_code}' -m 10 "https://${DOMINIO_SITE}/" || echo 000)
  [ "$CODIGO" = 200 ] && break
  sleep 5
done
case "$CODIGO" in
  200) verde "  https://${DOMINIO_SITE} está no ar."
       # o sitemap tem de sair como XML; se vier HTML, o Caddy está devolvendo o index.html no lugar
       TIPO=$(curl -s -o /dev/null -w '%{content_type}' -m 10 "https://${DOMINIO_SITE}/sitemap.xml" || true)
       case "$TIPO" in
         *xml*) verde '  sitemap.xml no ar' ;;
         *) amarelo "  sitemap.xml respondeu '$TIPO' (esperava xml): confira dist/sitemap.xml e o Caddy" ;;
       esac
       # a barra no fim tem de virar 301 (SEO 3.15.1); 200 aqui = o Caddy está com o Caddyfile antigo
       BARRA=$(curl -s -o /dev/null -w '%{http_code}' -m 10 "https://${DOMINIO_SITE}/sobre/" || echo 000)
       case "$BARRA" in
         301) verde '  /sobre/ → 301 (endereço com barra redireciona)' ;;
         *) amarelo "  /sobre/ respondeu $BARRA (esperava 301): o Caddy pode estar lendo um Caddyfile antigo; rode: docker compose up -d --force-recreate caddy" ;;
       esac
       # a chave do IndexNow tem de responder no ar, senão o Bing recusa os avisos (403)
       if [ -n "${INDEXNOW_KEY:-}" ]; then
         CHAVE_NO_AR=$(curl -s -m 10 "https://${DOMINIO_SITE}/${INDEXNOW_KEY}.txt" || true)
         if [ "$CHAVE_NO_AR" = "$INDEXNOW_KEY" ]; then verde '  chave do IndexNow no ar (o Bing consegue conferir)'
         else amarelo "  https://${DOMINIO_SITE}/${INDEXNOW_KEY}.txt não devolveu a chave: o Bing vai recusar os avisos"; fi
       fi ;;
  000) amarelo '  Ainda não respondeu. Se o DNS acabou de mudar, espere um minuto e abra no navegador.'
       echo '  Log:  docker compose logs caddy --tail 30' ;;
  *)   amarelo "  Respondeu $CODIGO. Veja:  docker compose logs caddy --tail 30" ;;
esac
echo
echo 'Para publicar de novo depois de um git pull: ./publicar-site.sh'

