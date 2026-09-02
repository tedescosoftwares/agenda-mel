#!/usr/bin/env bash
#
# Agenda Mel — prova que os arquivos gerados fazem o que prometem.
#
#   ./testar.sh
#
# Roda num Postgres local com uma imitação mínima do Supabase e confere
# três coisas que, se estiverem erradas, só apareceriam no banco de
# produção de alguém:
#
#   1. a atualização aplica em cima de um banco na versão 019
#   2. rodar de novo não quebra nem duplica (3 vezes seguidas)
#   3. quem atualizou fica com o MESMO schema de quem instalou do zero
#
# O terceiro é o que pega divergência de verdade: é fácil um arquivo
# consolidado ficar para trás e ninguém notar até alguém reclamar de uma
# coluna que não existe.

set -euo pipefail
cd "$(dirname "$0")"

PSQL='/usr/lib/postgresql/16/bin/psql -h /tmp -p 5433 -U postgres -v ON_ERROR_STOP=1 -q'
TRAB=/tmp/pgwork
verde(){ printf '\033[1;32m%s\033[0m\n' "$*"; }
vermelho(){ printf '\033[1;31m%s\033[0m\n' "$*"; }
azul(){ printf '\033[1;34m%s\033[0m\n' "$*"; }

mkdir -p "$TRAB"; cp -f ./*.sql "$TRAB"/ 2>/dev/null || true
chmod -R a+rX "$TRAB"

# client_min_messages=warning porque os NOTICE de "policy does not exist,
# skipping" são o idempotente FUNCIONANDO, e afogam o que importa
rodar() { su pgtest -c "PGOPTIONS='-c client_min_messages=warning' $PSQL -d $1 -f $TRAB/$2" >/dev/null; }
criar() { su pgtest -c "$PSQL -d postgres -c 'drop database if exists $1'" >/dev/null
          su pgtest -c "$PSQL -d postgres -c 'create database $1'"          >/dev/null
          rodar "$1" shim.sql; }

# retrato do schema: tabelas, colunas, tipos, funções. É isto que tem de
# bater entre os dois caminhos.
retrato() {
  su pgtest -c "$PSQL -d $1 -At -c \"
    select 'C '||table_name||'.'||column_name||' '||data_type||' '||is_nullable
      from information_schema.columns where table_schema='public'
    union all
    select 'F '||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')'
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
    union all
    select 'I '||indexname from pg_indexes where schemaname='public'
    order by 1\"" 
}

# ---------------------------------------------------------------
azul '== 1/3  Banco na versão 019 recebendo a atualização =='
criar t_atualiza
for f in $(ls -1 [0-9][0-9][0-9]_*.sql | sort | awk -F_ '$1+0 < 20'); do
  rodar t_atualiza "$f"
done
verde '  base 001..019 no ar'
rodar t_atualiza atualizacao_020_em_diante.sql
verde '  atualização aplicada'

azul '== 2/3  Rodando a atualização de novo, duas vezes =='
rodar t_atualiza atualizacao_020_em_diante.sql; verde '  2a vez ok'
rodar t_atualiza atualizacao_020_em_diante.sql; verde '  3a vez ok'

azul '== 3/3  Instalação do zero, e comparação dos dois schemas =='
criar t_zero
rodar t_zero setup_completo.sql; verde '  setup_completo aplicado'
rodar t_zero setup_completo.sql; verde '  2a vez ok'

retrato t_atualiza > /tmp/r_atualiza.txt
retrato t_zero     > /tmp/r_zero.txt
if diff -u /tmp/r_zero.txt /tmp/r_atualiza.txt > /tmp/r_diff.txt; then
  echo
  verde "================================================"
  verde " Os dois caminhos chegam ao mesmo schema."
  verde " $(wc -l < /tmp/r_zero.txt) objetos conferidos."
  verde "================================================"
else
  echo
  vermelho 'DIVERGÊNCIA entre atualizar e instalar do zero:'
  head -40 /tmp/r_diff.txt
  exit 1
fi
