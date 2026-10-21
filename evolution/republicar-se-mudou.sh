#!/usr/bin/env bash
#
# Regenera o HTML estático e o sitemap quando algo publicado na Plataforma
# mudou: artigo do blog, página SEO, salão ou página do guia. É o que faltava
# para a Plataforma e o Google andarem juntos sem ninguém rodar o publicar.
#
#   ./republicar-se-mudou.sh          confere e, se mudou, regenera (uns segundos)
#   ./republicar-se-mudou.sh --forcar regenera mesmo sem mudança
#   ./republicar-se-mudou.sh --cron   instala no cron: de hora em hora, sozinho
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

set -euo pipefail
cd "$(dirname "$0")"
AQUI=$(pwd)
RAIZ=$(cd .. && pwd)
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"

verde()   { printf '\033[1;32m%s\033[0m\n' "$*"; }
amarelo() { printf '\033[1;33m%s\033[0m\n' "$*"; }
vermelho(){ printf '\033[1;31m%s\033[0m\n' "$*"; }

LINHA_CRON="17 * * * * $AQUI/republicar-se-mudou.sh >> $AQUI/republicar.log 2>&1"
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
    { crontab -l 2>/dev/null | grep -vF "$MARCA" | grep -vF "$AQUI/republicar-se-mudou.sh"
      echo "$MARCA"
      echo "$LINHA_CRON"
    } | crontab -
    verde 'No cron: de hora em hora (minuto 17) confere e regenera se mudou. Log em republicar.log'
    exit 0
    ;;
esac

# as chaves: no .env da Evolution ou no da raiz, como no publicar-site.sh
# shellcheck disable=SC1091
[ -f .env ] && { set -a; . ./.env; set +a; }
# shellcheck disable=SC1091
[ -f "$RAIZ/.env" ] && { set -a; . "$RAIZ/.env"; set +a; }
case "${VITE_SUPABASE_URL:-}" in https://*) ;; *) vermelho 'Falta VITE_SUPABASE_URL (e VITE_SUPABASE_ANON_KEY) no .env.'; exit 1 ;; esac
[ -n "${VITE_SUPABASE_ANON_KEY:-}" ] || { vermelho 'Falta VITE_SUPABASE_ANON_KEY no .env.'; exit 1; }
export VITE_SUPABASE_URL VITE_SUPABASE_ANON_KEY
[ -f "$RAIZ/dist/index.html" ] || { vermelho "Não existe $RAIZ/dist/index.html: rode o publicar-site.sh uma vez antes."; exit 1; }
command -v node >/dev/null || { vermelho 'Não achei o node no PATH do cron.'; exit 1; }

CARIMBO="$RAIZ/dist/.conteudo-versao"
VERSAO=$(curl -s -m 20 -X POST "$VITE_SUPABASE_URL/rest/v1/rpc/site_conteudo_versao" \
  -H "apikey: $VITE_SUPABASE_ANON_KEY" -H "Authorization: Bearer $VITE_SUPABASE_ANON_KEY" \
  -H 'Content-Type: application/json' -d '{}' | tr -d '" \n')
if ! printf '%s' "$VERSAO" | grep -Eq '^[0-9a-f]{32}$'; then
  vermelho "$(date '+%F %T') não consegui ler a versão do conteúdo (${VERSAO:-sem resposta}). A migração 164 está aplicada?"
  exit 1
fi
ANTERIOR=$(cat "$CARIMBO" 2>/dev/null || true)
cd "$RAIZ"
MUDOU=0  # nada mudou: silêncio (o cron roda isto a toda hora)
if [ "${1:-}" = '--forcar' ] || [ "$VERSAO" != "$ANTERIOR" ]; then
  if node scripts/paginas-estaticas.mjs > /tmp/mimo-republicar.log 2>&1; then
    printf '%s' "$VERSAO" > "$CARIMBO"
    chmod -R a+rX dist
    verde "$(date '+%F %T') páginas regeneradas: $(grep -c '<loc>' dist/sitemap.xml) URLs no sitemap ($(tail -1 /tmp/mimo-republicar.log))"
    # 3.38.2: o que o guia disse nesta rodada (cidades, salões, uma cidade do cache ou fora da rodada) fica no log também
    grep -E 'guia-fonte:|guia: |guia de salões|ATENÇÃO' /tmp/mimo-republicar.log | sed 's/^/    /' || true
    MUDOU=1
  else
    vermelho "$(date '+%F %T') a regeneração falhou:"; tail -20 /tmp/mimo-republicar.log
    exit 1
  fi
fi

# IndexNow (3.21): avisa o Bing na hora do que entrou, mudou ou saiu do sitemap.
# scripts/indexnow.mjs compara com o último sitemap avisado (indexnow-ultimo.xml,
# aqui na pasta) e regrava dist/<chave>.txt, que o Bing confere. Roda também quando
# um aviso anterior falhou e ficou pendente: o sitemap no ar ainda é diferente do
# último avisado. Sem mudança e sem pendência, silêncio.
if [ -n "${INDEXNOW_KEY:-}" ]; then
  if [ "$MUDOU" = 1 ] || ! cmp -s dist/sitemap.xml "$AQUI/indexnow-ultimo.xml"; then
    node scripts/indexnow.mjs || amarelo "$(date '+%F %T') o aviso ao Bing (IndexNow) falhou; fica para a próxima hora"
  fi
elif [ "$MUDOU" = 1 ]; then
  amarelo 'Sem INDEXNOW_KEY no .env o Bing não é avisado na hora. Para ligar: node scripts/indexnow.mjs --gerar-chave'
fi
