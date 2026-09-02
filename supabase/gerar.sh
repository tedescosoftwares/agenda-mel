#!/usr/bin/env bash
#
# Agenda Mel — junta as migrações num arquivo só para colar no Supabase.
#
#   ./gerar.sh
#
# Produz dois arquivos, sempre a partir dos mesmos 0NN_*.sql:
#
#   setup_completo.sql            todas, para banco vazio ou pela metade
#   atualizacao_020_em_diante.sql da 020 em diante, para quem já rodou
#                                 o setup antigo e só quer o que falta
#
# Existe porque manter os dois na mão é como manter duas verdades: uma
# hora divergem e ninguém sabe qual vale. Rode depois de mexer em
# qualquer migração, e teste com ./testar.sh antes de mandar para alguém.

set -euo pipefail
cd "$(dirname "$0")"

barra() { printf -- '-- =============================================================\n'; }

juntar() {  # $1 = arquivo de saída ; $2... = migrações
  local saida="$1"; shift
  : > "$saida"
  cat cabecalho_"$(basename "$saida" .sql)".txt >> "$saida"
  local f
  for f in "$@"; do
    { barra; printf -- '-- >>> %s\n' "$f"; barra; echo; } >> "$saida"
    cat "$f" >> "$saida"
    echo >> "$saida"
  done
  echo "  $saida  ($(wc -l < "$saida") linhas, $# migrações)"
}

TODAS=$(ls -1 [0-9][0-9][0-9]_*.sql | sort)
DA_020=$(echo "$TODAS" | awk -F_ '$1+0 >= 20')

echo 'Gerando:'
# shellcheck disable=SC2086
juntar setup_completo.sql $TODAS
# shellcheck disable=SC2086
juntar atualizacao_020_em_diante.sql $DA_020
