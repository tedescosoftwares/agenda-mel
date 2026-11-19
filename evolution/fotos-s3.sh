#!/usr/bin/env bash
#
# MIMO — as fotos do guia no S3 da AWS (4.3). Rode na VPS, pela opção 1 do bat (cai nesta pasta):
#
#   ./fotos-s3.sh teste       confere as chaves e o img.mimo.com.vc (grava, lê e apaga um arquivinho)
#   ./fotos-s3.sh copiar      copia as fotos do Supabase para o S3, em segundo plano: pode fechar o terminal
#   ./fotos-s3.sh andamento   mostra como vai a cópia (Ctrl+C só para de mostrar; a cópia continua)
#   ./fotos-s3.sh conferir    confere se cada foto que o banco aponta já está no S3
#   ./fotos-s3.sh trocar      confere e troca os links no banco; depois, a opção 2 do bat republica as páginas
#
# Precisa no evolution/.env: AWS_FOTOS_CHAVE_ID e AWS_FOTOS_CHAVE_SECRETA (o usuário IAM do bucket) e a
# SUPABASE_DB_URL do bat B. Nada é apagado do Supabase aqui.
set -euo pipefail
cd "$(dirname "$0")"
ENV=.env
[ -f "$ENV" ] && { set -a; . "./$ENV"; set +a; }
cd ..
LOG="$HOME/fotos-s3.log"
SCRIPT=scripts/guia/fotos-s3.mjs

[ -f "$SCRIPT" ] || { echo "Não achei $SCRIPT: rode a opção 2 do bat (git pull) antes."; exit 1; }
command -v node >/dev/null || { echo 'Sem o node: rode a opção 2 do bat uma vez (ela instala).'; exit 1; }

case "${1:-}" in
  copiar)
    if pgrep -f "$SCRIPT copiar" >/dev/null; then
      echo 'A cópia já está rodando. Mostrando o andamento (Ctrl+C só para de mostrar):'
    else
      nohup node "$SCRIPT" copiar > "$LOG" 2>&1 &
      echo "A cópia começou em segundo plano (registro em $LOG). Ctrl+C só para de mostrar; ela continua."
      sleep 2
    fi
    tail -n +1 -f "$LOG"
    ;;
  andamento)
    [ -f "$LOG" ] || { echo 'Nenhuma cópia ainda: ./fotos-s3.sh copiar'; exit 0; }
    pgrep -f "$SCRIPT copiar" >/dev/null && echo '(copiando agora)' || echo '(a cópia não está rodando; este é o registro da última)'
    tail -n 15 -f "$LOG"
    ;;
  teste|conferir|trocar)
    node "$SCRIPT" "$1" "${@:2}"
    ;;
  *)
    sed -n '3,10p' "$0" | sed 's/^# \{0,1\}//'
    ;;
esac
