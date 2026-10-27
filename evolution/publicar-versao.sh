#!/usr/bin/env bash
#
# Põe no ar, de uma vez só, o que está em ../dist (3.74.3: publicação atômica).
#
#   ./publicar-versao.sh            tira uma foto do dist em ../site/versoes/<carimbo> e aponta ../site/atual para ela
#   ./publicar-versao.sh --voltar   volta para a versão anterior (o "desfazer" da publicação, em um segundo)
#   ./publicar-versao.sh --estado   mostra o que está no ar e as versões guardadas
#
# Por quê: o Caddy servia a pasta dist diretamente. O build (vite) esvazia essa pasta, e a regeneração do guia apaga
# /saloes antes de regravar as 18 mil páginas: por minutos, qualquer página pedida nesse intervalo saía como a casca
# do app (o index.html com noindex). O Google caiu nisso centenas de vezes (Search Console: "excluída por noindex"
# em páginas indexáveis, e páginas de bairro que nunca levam noindex). Agora o dist é só a oficina: o que vai ao ar é
# uma foto dele, e ../site/atual (um link, é o que o Caddy serve) passa a apontar para a foto nova num único rename.
# Nenhum pedido, em nenhum segundo, vê o site pela metade.
#
# As fotos usam hard links entre si (rsync --link-dest): o que não mudou de uma versão para a outra não ocupa disco de
# novo. Ficam guardadas as duas mais novas (a que está no ar e a anterior). Sem rsync na máquina, a foto é uma cópia
# inteira (cp -a); cp -al não serve, porque a oficina regrava os arquivos no lugar e a foto mudaria junto.

set -euo pipefail
cd "$(dirname "$0")"
RAIZ=$(cd .. && pwd)
DIST="$RAIZ/dist"
SITE="$RAIZ/site"
VERSOES="$SITE/versoes"
ATUAL="$SITE/atual"
GUARDAR=2

verde()   { printf '\033[1;32m%s\033[0m\n' "$*"; }
amarelo() { printf '\033[1;33m%s\033[0m\n' "$*"; }
vermelho(){ printf '\033[1;31m%s\033[0m\n' "$*"; }

no_ar() { if [ -L "$ATUAL" ]; then basename "$(readlink "$ATUAL")"; fi; }
listar() { if [ -d "$VERSOES" ]; then ls -1 "$VERSOES" | sort; fi; }
# a troca: um link novo ao lado e um rename por cima do antigo (o rename é atômico; ln -sfn não é)
apontar() {
  rm -f "$SITE/.atual.novo"
  ln -s "versoes/$1" "$SITE/.atual.novo"
  mv -T "$SITE/.atual.novo" "$ATUAL"
}
sem_permissao() {
  vermelho "Não consigo escrever em $SITE (dono: $(stat -c %U "$SITE" 2>/dev/null || echo '?'))."
  echo "  Se o Docker criou a pasta antes da primeira publicação, devolva-a para você:  sudo chown -R $(id -un) $SITE"
  exit 1
}

case "${1:-}" in
  --estado)
    AR=$(no_ar)
    if [ -z "$AR" ]; then amarelo "Nada no ar ainda ($ATUAL não existe). Rode ./publicar-site.sh."; exit 0; fi
    verde "No ar: $AR"
    for v in $(listar); do
      printf '  %s  %s%s\n' "$v" "$(du -sh "$VERSOES/$v" 2>/dev/null | cut -f1)" "$([ "$v" = "$AR" ] && echo '  <- no ar')"
    done
    echo "  disco das versões, descontando o que é compartilhado: $(du -shc "$VERSOES"/* 2>/dev/null | tail -1 | cut -f1)"
    exit 0 ;;
  --voltar)
    AR=$(no_ar); [ -n "$AR" ] || { vermelho 'Nada no ar ainda; não há para onde voltar.'; exit 1; }
    ANTES=$(listar | awk -v a="$AR" '$0 < a' | tail -1)
    [ -n "$ANTES" ] || { vermelho "Só existe a versão $AR; não há anterior guardada."; exit 1; }
    apontar "$ANTES"
    verde "Voltou: no ar $ANTES (era $AR). A versão $AR continua guardada; a próxima publicação apaga a mais velha."
    exit 0 ;;
  '') ;;
  *) echo 'uso: ./publicar-versao.sh [--voltar | --estado]'; exit 1 ;;
esac

# 1. a oficina tem de estar completa: sem o index.html, o sitemap e a home estática não se publica
for f in index.html sitemap.xml _home.html; do
  [ -f "$DIST/$f" ] || { vermelho "Falta $DIST/$f: o build (ou a regeneração) não terminou. A versão no ar não muda."; exit 1; }
done
# 2. a pasta das versões (se o Docker a criou como root, avisa como consertar)
if [ -d "$SITE" ] && [ ! -w "$SITE" ]; then sem_permissao; fi
mkdir -p "$VERSOES" 2>/dev/null || sem_permissao
[ -w "$VERSOES" ] || sem_permissao
# 3. a foto
NOVA=$(date +%Y%m%d-%H%M%S)
[ -e "$VERSOES/$NOVA" ] && NOVA="${NOVA}-$$"
DESTINO="$VERSOES/$NOVA"
ANTERIOR=$(no_ar)
if command -v rsync >/dev/null; then
  if [ -n "$ANTERIOR" ] && [ -d "$VERSOES/$ANTERIOR" ]; then
    rsync -a --link-dest="$VERSOES/$ANTERIOR" "$DIST/" "$DESTINO/"
  else
    rsync -a "$DIST/" "$DESTINO/"
  fi
else
  cp -a "$DIST" "$DESTINO"
fi
# 4. conferir a foto antes de apontar para ela
for f in index.html sitemap.xml _home.html; do
  [ -f "$DESTINO/$f" ] || { vermelho "A foto saiu sem $f; a versão no ar não muda."; rm -rf "$DESTINO"; exit 1; }
done
# o Caddy roda como outro usuário dentro do container: precisa ler
chmod a+rX "$SITE" "$VERSOES"
chmod -R a+rX "$DESTINO"
# 5. a troca
apontar "$NOVA"
# 6. as versões antigas: ficam as GUARDAR mais novas e a que está no ar
MANTER=$( { listar | tail -n "$GUARDAR"; echo "$NOVA"; } | sort -u)
for v in $(listar); do
  if ! printf '%s\n' "$MANTER" | grep -qx "$v"; then rm -rf "$VERSOES/$v"; fi
done
# as URLs do sitemap (3.75: o índice aponta para as partes em sitemaps/)
URLS=$(cat "$DESTINO/sitemap.xml" "$DESTINO"/sitemaps/*.xml 2>/dev/null | grep -o '<url>' | wc -l | tr -d ' ')
verde "  no ar: a versão $NOVA ($URLS URLs no sitemap)${ANTERIOR:+ · anterior guardada: $ANTERIOR}"
