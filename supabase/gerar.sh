#!/usr/bin/env bash
#
# Agenda Mel — junta as migrações num arquivo só para colar no Supabase.
#
#   ./gerar.sh        os dois arquivos de sempre
#   ./gerar.sh 40     só o pedaço da 040 em diante, para quem está
#                     atrasado em poucas migrações e não quer colar
#                     oito mil linhas no SQL Editor
#
# Produz, sempre a partir dos mesmos 0NN_*.sql:
#
#   setup_completo.sql            todas, para banco vazio ou pela metade
#   atualizacao_020_em_diante.sql da 020 em diante, para quem já rodou
#                                 o setup antigo e só quer o que falta
#   atualizacao_0NN_em_diante.sql pedaço avulso, quando você pede
#
# Existe porque manter os dois na mão é como manter duas verdades: uma
# hora divergem e ninguém sabe qual vale. Rode depois de mexer em
# qualquer migração, e teste com ./testar.sh antes de mandar para alguém.

set -euo pipefail
cd "$(dirname "$0")"

barra() { printf -- '-- =============================================================\n'; }

juntar() {  # $1 = arquivo de saída ; $2... = migrações
  local saida="$1"; shift
  local cab="cabecalho_$(basename "$saida" .sql).txt"
  : > "$saida"
  if [ -f "$cab" ]; then
    cat "$cab" >> "$saida"
  else
    cabecalho_avulso "$@" >> "$saida"
  fi
  local f
  for f in "$@"; do
    { barra; printf -- '-- >>> %s\n' "$f"; barra; echo; } >> "$saida"
    cat "$f" >> "$saida"
    echo >> "$saida"
  done
  echo "  $saida  ($(wc -l < "$saida") linhas, $# migrações)"
}

# Para um pedaço avulso não existe texto escrito à mão: o cabeçalho sai
# da primeira linha de comentário de cada migração, que já diz o que ela
# faz. Um resumo que se escreve sozinho não tem como envelhecer.
cabecalho_avulso() {
  barra
  printf -- '--  AGENDA MEL — ATUALIZAÇÃO: da migração %s em diante\n' "${1%%_*}"
  printf -- '--\n'
  printf -- '--  Cole ISTO INTEIRO no SQL Editor do Supabase e Run. Pode rodar\n'
  printf -- '--  de novo quantas vezes quiser: nada é duplicado.\n'
  printf -- '--\n'
  printf -- '--  O que entra aqui:\n'
  local f
  for f in "$@"; do
    printf -- '--    %s  %s\n' "${f%%_*}" \
      "$(sed -n '2s/^-- Agenda Mel — [0-9]*: //p' "$f")"
  done
  printf -- '--\n'
  printf -- '--  Se der erro, me mande a mensagem inteira: cada bloco abaixo está\n'
  printf -- '--  marcado com o nome do arquivo de origem.\n'
  barra
  echo
}

TODAS=$(ls -1 [0-9][0-9][0-9]_*.sql | sort)
DA_020=$(echo "$TODAS" | awk -F_ '$1+0 >= 20')

if [ $# -gt 0 ]; then
  DE=$1
  PEDACO=$(echo "$TODAS" | awk -F_ -v de="$DE" '$1+0 >= de+0')
  [ -n "$PEDACO" ] || { echo "Não existe migração $DE ou depois." >&2; exit 1; }
  echo 'Gerando:'
  # shellcheck disable=SC2086
  juntar "atualizacao_$(printf '%03d' "$DE")_em_diante.sql" $PEDACO
  exit 0
fi

echo 'Gerando:'
# shellcheck disable=SC2086
juntar setup_completo.sql $TODAS
# shellcheck disable=SC2086
juntar atualizacao_020_em_diante.sql $DA_020
