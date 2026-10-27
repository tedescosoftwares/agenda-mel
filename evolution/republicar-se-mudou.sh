#!/usr/bin/env bash
#
# Regenera o HTML estático e o sitemap quando algo publicado na Plataforma
# mudou: artigo do blog, página SEO, salão ou página do guia. É o que faltava
# para a Plataforma e o Google andarem juntos sem ninguém rodar o publicar.
#
#   ./republicar-se-mudou.sh          confere e, se mudou, regenera (uns segundos)
#   ./republicar-se-mudou.sh --forcar regenera mesmo sem mudança
#   ./republicar-se-mudou.sh --cron   instala no cron: de hora em hora, sozinho, e a cada minuto o "Publicar agora"
#   ./republicar-se-mudou.sh --pedidos atende o "Publicar agora" da Plataforma, se houver pedido (o cron do minuto)
#   ./republicar-se-mudou.sh --sem-cron
#
# Como funciona: o banco tem site_conteudo_versao() (migração 164), um
# carimbo que muda sempre que o conteúdo publicado muda. O script compara
# com o carimbo da última geração (dist/.conteudo-versao) e, se for outro,
# roda scripts/paginas-estaticas.mjs sobre o dist que já está no ar. Não
# refaz o build do app (isso é o publicar-site.sh, quando o CÓDIGO muda) e
# não mexe no Caddy: ele serve os arquivos novos na hora. Depois de regenerar,
# avisa o Bing na hora do que mudou no sitemap (IndexNow, scripts/indexnow.mjs),
# se INDEXNOW_KEY estiver no .env.
# 3.41: o "Publicar agora" da Plataforma (migração 189). O cron do minuto roda --pedidos: sem pedido, sai calado; com
# pedido, regenera na hora. Toda publicação (a da hora, a pedida, a do --forcar) fica registrada no banco
# (scripts/registrar-publicacao.mjs, com GUIA_CHAVE_GERADOR), e é dela que a Plataforma tira o que está pendente.
# Uma rodada por vez: a trava /tmp/mimo-republicar.lock vale também para o build do publicar-site.sh.

set -euo pipefail
cd "$(dirname "$0")"
AQUI=$(pwd)
RAIZ=$(cd .. && pwd)
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"

verde()   { printf '\033[1;32m%s\033[0m\n' "$*"; }
amarelo() { printf '\033[1;33m%s\033[0m\n' "$*"; }
vermelho(){ printf '\033[1;31m%s\033[0m\n' "$*"; }

LINHA_CRON="17 * * * * $AQUI/republicar-se-mudou.sh >> $AQUI/republicar.log 2>&1"
LINHA_PEDIDOS="* * * * * $AQUI/republicar-se-mudou.sh --pedidos >> $AQUI/republicar.log 2>&1"
MARCA='# agenda-mel: regenera as páginas estáticas quando a Plataforma publica algo'

case "${1:-}" in
  --sem-cron)
    command -v crontab >/dev/null || { amarelo 'Não existe crontab nesta máquina.'; exit 0; }
    crontab -l 2>/dev/null | grep -vF "$MARCA" | grep -vF "$AQUI/republicar-se-mudou.sh" | crontab - || true
    verde 'Tirado do cron. As páginas só mudam no publicar-site.sh ou rodando isto na mão.'
    exit 0
    ;;
  --cron)
    command -v crontab >/dev/null || { vermelho 'Não achei o crontab. No Ubuntu: sudo apt-get install -y cron && sudo systemctl enable --now cron'; exit 1; }
    { crontab -l 2>/dev/null | grep -vF "$MARCA" | grep -vF "$AQUI/republicar-se-mudou.sh" || true
      echo "$MARCA"
      echo "$LINHA_CRON"
      echo "$LINHA_PEDIDOS"
    } | crontab -
    verde 'No cron: de hora em hora (minuto 17) confere e regenera se mudou, e a cada minuto atende o "Publicar agora" da Plataforma. Log em republicar.log'
    exit 0
    ;;
esac

MODO="${1:-}"
# 3.42: o --pedidos roda a cada minuto: o mesmo aviso vai ao republicar.log uma vez só (de novo quando muda) e sai
# quando tudo volta ao normal. Antes ele ficava calado e um .env sem a chave do gerador não deixava rastro nenhum.
AVISO_PEDIDOS="$AQUI/.pedidos-aviso"
avisar_pedidos() { # $1 = o aviso ('' = tudo certo)
  if [ -z "$1" ]; then rm -f "$AVISO_PEDIDOS"; return 0; fi
  [ "$(cat "$AVISO_PEDIDOS" 2>/dev/null || true)" = "$1" ] && return 0
  printf '%s' "$1" > "$AVISO_PEDIDOS"
  amarelo "$(date '+%F %T') Publicar agora: $1"
}
falhar() { if [ "$MODO" = '--pedidos' ]; then avisar_pedidos "$1"; else vermelho "$1"; fi; exit 1; }

# as chaves: no .env da Evolution ou no da raiz, como no publicar-site.sh
# shellcheck disable=SC1091
[ -f .env ] && { set -a; . ./.env; set +a; }
# shellcheck disable=SC1091
[ -f "$RAIZ/.env" ] && { set -a; . "$RAIZ/.env"; set +a; }
case "${VITE_SUPABASE_URL:-}" in https://*) ;; *) falhar 'Falta VITE_SUPABASE_URL (e VITE_SUPABASE_ANON_KEY) no .env.' ;; esac
[ -n "${VITE_SUPABASE_ANON_KEY:-}" ] || falhar 'Falta VITE_SUPABASE_ANON_KEY no .env.'
export VITE_SUPABASE_URL VITE_SUPABASE_ANON_KEY
[ -f "$RAIZ/dist/index.html" ] || falhar "Não existe $RAIZ/dist/index.html: rode o publicar-site.sh uma vez antes."
command -v node >/dev/null || falhar 'Não achei o node no PATH do cron.'

# 3.41: uma rodada por vez (a da hora, a do "Publicar agora", a de quem roda na mão e o build do publicar-site.sh)
if command -v flock >/dev/null; then
  exec 9>/tmp/mimo-republicar.lock
  if ! flock -n 9; then
    # 3.42: o cron do minuto avisa o banco que conferiu e está ocupado (a Plataforma diz "entra em seguida")
    if [ "$MODO" = '--pedidos' ]; then node "$RAIZ/scripts/registrar-publicacao.mjs" ocupado >/dev/null 2>&1 || true
    else amarelo "$(date '+%F %T') outra regeneração (ou um build) está em andamento; esta fica para a próxima"; fi
    exit 0
  fi
fi

CARIMBO="$RAIZ/dist/.conteudo-versao"
REGISTRADA="$AQUI/.publicacao-registrada" # a versão que o banco já tem como publicada (fora do dist: o build não apaga)
# 3.41: o pedido do "Publicar agora" (se houver). A hora do banco vira o começo desta publicação (a régua das pendências)
ERRO_INICIO=$(mktemp)
PEDIDO=$(node "$RAIZ/scripts/registrar-publicacao.mjs" inicio 2>"$ERRO_INICIO" || true)
AVISO=$(sed 's/^registrar-publicacao: //' "$ERRO_INICIO" | head -1); rm -f "$ERRO_INICIO"
if [ "$MODO" = '--pedidos' ]; then avisar_pedidos "$AVISO"; elif [ -n "$AVISO" ]; then amarelo "$AVISO"; fi
campo() { printf '%s\n' "$PEDIDO" | sed -n "s/^$1=//p" | head -1; }
PEDIDO_ID=$(campo id); [ "$PEDIDO_ID" = '-' ] && PEDIDO_ID=''
INICIO=$(campo agora); [ "$INICIO" = '-' ] && INICIO=''
VERSAO_INICIO=$(campo versao); [ "$VERSAO_INICIO" = '-' ] && VERSAO_INICIO=''
# o cron do minuto sem pedido: silêncio
if [ "$MODO" = '--pedidos' ] && [ -z "$PEDIDO_ID" ]; then exit 0; fi
FORCAR=0
if [ "$MODO" = '--forcar' ] || [ -n "$PEDIDO_ID" ]; then FORCAR=1; fi
ORIGEM=automatico; [ "$MODO" = '--forcar' ] && ORIGEM=manual
[ -n "$PEDIDO_ID" ] && verde "$(date '+%F %T') publicando a pedido da Plataforma (pedido $PEDIDO_ID)"
# 3.75: as URLs do sitemap, no índice com as partes (sitemaps/) ou no arquivo único de antes
contar_urls() { cat "$1/sitemap.xml" "$1"/sitemaps/*.xml 2>/dev/null | grep -o '<url>' | wc -l | tr -d ' '; }
registrar() { # $1 = 1 (feito) ou 0 (falhou); $2 = resumo
  local urls; urls=$(contar_urls "$RAIZ/dist")
  local r; r=$(node "$RAIZ/scripts/registrar-publicacao.mjs" fim --ok "$1" --id "${PEDIDO_ID:--}" --origem "$ORIGEM" --inicio "${INICIO:--}" \
    --versao "${VERSAO:--}" --urls "${urls:--}" --resumo "$2" || true)
  if [ "$1" = 1 ] && [ "$r" = 'registrado' ] && [ -n "${VERSAO:-}" ]; then printf '%s' "$VERSAO" > "$REGISTRADA"; fi
}
ler_versao() {
  curl -s -m 20 -X POST "$VITE_SUPABASE_URL/rest/v1/rpc/site_conteudo_versao" \
    -H "apikey: $VITE_SUPABASE_ANON_KEY" -H "Authorization: Bearer $VITE_SUPABASE_ANON_KEY" \
    -H 'Content-Type: application/json' -d '{}' | tr -d '" \n' || true
}
eh_versao() { printf '%s' "$1" | grep -Eq '^[0-9a-f]{32}$'; }
# a versão: a que o banco deu junto com o pedido (o mesmo instante do começo) ou lida agora
if eh_versao "$VERSAO_INICIO"; then VERSAO="$VERSAO_INICIO"; else VERSAO=$(ler_versao); fi
# 3.38.4: um pico passa (uma migração, um lote, o disco do plano grátis no limite): uma segunda tentativa depois de 15 s
eh_versao "$VERSAO" || { sleep 15; VERSAO=$(ler_versao); }
if ! eh_versao "$VERSAO"; then
  case "$VERSAO" in
    *57014*|*statement*timeout*)
      MOTIVO="o banco passou do tempo limite (statement timeout): alguma consulta ou migração longa está segurando as tabelas do guia. No SQL Editor do Supabase: select pid, state, now() - xact_start as ha, left(query, 70) from pg_stat_activity where state <> 'idle'; e encerre a presa com select pg_terminate_backend(<pid>);" ;;
    *PGRST202*|*Couldnotfind*) MOTIVO='a função site_conteudo_versao() não existe neste banco: rode a migração 164 (bat B)' ;;
    '') MOTIVO='o Supabase não respondeu (rede, ou o projeto pausado)' ;;
    *) MOTIVO="resposta inesperada: $VERSAO" ;;
  esac
  if [ "$FORCAR" = 1 ]; then
    # --forcar (ou o pedido da Plataforma) regenera assim mesmo; sem a versão não grava o carimbo, e a próxima rodada confere de novo
    amarelo "$(date '+%F %T') não li a versão do conteúdo ($MOTIVO). Regenero assim mesmo, sem gravar o carimbo."
    VERSAO=''
  else
    vermelho "$(date '+%F %T') não consegui ler a versão do conteúdo: $MOTIVO"
    exit 1
  fi
fi
ANTERIOR=$(cat "$CARIMBO" 2>/dev/null || true)
cd "$RAIZ"
MUDOU=0  # nada mudou: silêncio (o cron roda isto a toda hora)
if [ "$FORCAR" = 1 ] || [ "$VERSAO" != "$ANTERIOR" ]; then
  if node scripts/paginas-estaticas.mjs > /tmp/mimo-republicar.log 2>&1; then
    [ -n "$VERSAO" ] && printf '%s' "$VERSAO" > "$CARIMBO"
    chmod -R a+rX dist
    # 3.74.3: até aqui o site no ar não mudou (o Caddy serve ../site/atual, não o dist). A foto do dist vai ao ar num
    # único rename; se a troca falhar, a versão anterior continua servindo e a Plataforma fica sabendo
    if ! "$AQUI/publicar-versao.sh" >> /tmp/mimo-republicar.log 2>&1; then
      vermelho "$(date '+%F %T') a troca da versão no ar falhou:"; tail -5 /tmp/mimo-republicar.log
      registrar 0 "a troca da versão no ar falhou: $(tail -3 /tmp/mimo-republicar.log | tr '\n' ' ' | cut -c1-600)"
      exit 1
    fi
    verde "$(date '+%F %T') páginas regeneradas e no ar: $(contar_urls dist) URLs no sitemap ($(grep -v 'no ar: a versão' /tmp/mimo-republicar.log | tail -1))"
    # 3.38.2: o que o guia disse nesta rodada (cidades, salões, uma cidade do cache ou fora da rodada) fica no log também
    grep -E 'guia-fonte:|guia: |guia de salões|ATENÇÃO' /tmp/mimo-republicar.log | sed 's/^/    /' || true
    MUDOU=1
    registrar 1 "$(grep -v 'no ar: a versão' /tmp/mimo-republicar.log | tail -1 | cut -c1-300)"
  else
    vermelho "$(date '+%F %T') a regeneração falhou:"; tail -20 /tmp/mimo-republicar.log
    registrar 0 "a regeneração falhou: $(tail -5 /tmp/mimo-republicar.log | tr '\n' ' ' | cut -c1-600)"
    exit 1
  fi
elif [ ! -L "$RAIZ/site/atual" ] && [ -f "$RAIZ/dist/sitemap.xml" ] && [ -f "$RAIZ/dist/_home.html" ]; then
  # 3.74.3: nada mudou, mas ainda não existe versão no ar (a primeira rodada depois da troca para ../site): publica o dist
  mkdir -p "$RAIZ/site"
  "$AQUI/publicar-versao.sh" || amarelo "$(date '+%F %T') não consegui pôr o dist no ar (publicar-versao.sh); rode ./publicar-site.sh"
elif [ -n "$VERSAO" ] && [ "$VERSAO" != "$(cat "$REGISTRADA" 2>/dev/null || true)" ]; then
  # 3.41: o site já está nesta versão, mas o banco ainda não sabe (logo depois da migração 189, ou de um build): registra,
  # para a Plataforma saber o que já está no ar
  registrar 1 'já estava no ar'
fi

# IndexNow (3.21): avisa o Bing na hora do que entrou, mudou ou saiu do sitemap.
# scripts/indexnow.mjs compara com o último sitemap avisado (indexnow-ultimo.xml,
# aqui na pasta) e regrava dist/<chave>.txt, que o Bing confere. Roda também quando
# um aviso anterior falhou e ficou pendente: o sitemap no ar ainda é diferente do
# último avisado. Sem mudança e sem pendência, silêncio.
if [ -n "${INDEXNOW_KEY:-}" ]; then
  # 3.75: o sitemap.xml é um índice (não dá mais para comparar o arquivo): sem regeneração, o --se-pendente confere as
  # URLs das partes contra o último aviso e só fala se houver o que avisar
  if [ "$MUDOU" = 1 ]; then
    node scripts/indexnow.mjs || amarelo "$(date '+%F %T') o aviso ao Bing (IndexNow) falhou; fica para a próxima hora"
  else
    node scripts/indexnow.mjs --se-pendente || amarelo "$(date '+%F %T') o aviso ao Bing (IndexNow) falhou; fica para a próxima hora"
  fi
elif [ "$MUDOU" = 1 ]; then
  amarelo 'Sem INDEXNOW_KEY no .env o Bing não é avisado na hora. Para ligar: node scripts/indexnow.mjs --gerar-chave'
fi
