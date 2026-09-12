#!/usr/bin/env bash
#
# MIMO — aplica no Supabase só as migrações que ainda não rodaram.
#
#   ./supabase/aplicar.sh                 roda o que falta, na ordem
#   ./supabase/aplicar.sh --listar        só mostra o que falta
#   ./supabase/aplicar.sh --ja-rodei 079  primeira vez: "já colei no editor
#                                         até a 079", anota sem rodar
#   ./supabase/aplicar.sh --se-configurado   silencioso se não há conexão
#                                         (é como o publicar-site chama)
#
# Precisa da conexão com o banco (SUPABASE_DB_URL no evolution/.env).
# Onde pegar: Supabase → botão "Connect" no topo → Session pooler →
# copie a URI e troque [YOUR-PASSWORD] pela senha do banco. Fica no
# servidor, nunca no chat.
#
# Cada migração roda numa transação: deu erro, nada dela fica, e o
# script para ali dizendo qual foi.
set -euo pipefail
cd "$(dirname "$0")"
azul()    { printf '\033[1;34m%s\033[0m\n' "$*"; }
verde()   { printf '\033[1;32m%s\033[0m\n' "$*"; }
amarelo() { printf '\033[1;33m%s\033[0m\n' "$*"; }
vermelho(){ printf '\033[1;31m%s\033[0m\n' "$*"; }

ENV=../evolution/.env
MODO=${1:-}
[ -f "$ENV" ] && { set -a; . "$ENV"; set +a; }

if [ -z "${SUPABASE_DB_URL:-}" ]; then
  if [ "$MODO" = "--se-configurado" ]; then
    amarelo 'Banco: SUPABASE_DB_URL não está no evolution/.env; pulei a atualização do banco (rode ./supabase/aplicar.sh para configurar).'
    exit 0
  fi
  echo 'Preciso da conexão com o banco, uma vez só.'
  echo '  Supabase → botão "Connect" (topo) → aba Session pooler → copie a URI'
  echo '  e troque [YOUR-PASSWORD] pela senha do banco (Settings → Database).'
  read -rp '  SUPABASE_DB_URL: ' SUPABASE_DB_URL
  SUPABASE_DB_URL=$(printf '%s' "$SUPABASE_DB_URL" | tr -d ' \t\r\n')
  [ -n "$SUPABASE_DB_URL" ] || { vermelho 'Sem conexão, sem atualização.'; exit 1; }
  printf 'SUPABASE_DB_URL=%s\n' "$SUPABASE_DB_URL" >> "$ENV"
  verde '  guardada no evolution/.env'
fi

if ! command -v psql >/dev/null; then
  amarelo 'Instalando o cliente do Postgres (psql)...'
  sudo apt-get update -qq && sudo apt-get install -y -qq postgresql-client >/dev/null
fi

export PGOPTIONS="-c client_min_messages=warning"
PSQL=(psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q -X)
if ! "${PSQL[@]}" -tAc 'select 1' >/dev/null 2>&1; then
  vermelho 'Não consegui conectar no banco. Confira a SUPABASE_DB_URL no evolution/.env (senha certa? pooler de sessão, porta 5432?).'
  exit 1
fi

"${PSQL[@]}" -c 'create table if not exists public.migracoes_aplicadas (arquivo text primary key, aplicada_em timestamptz not null default now()); alter table public.migracoes_aplicadas enable row level security;' >/dev/null

if [ "$MODO" = "--ja-rodei" ]; then
  ATE=${2:-}
  [ -n "$ATE" ] || { vermelho 'Uso: --ja-rodei 079'; exit 1; }
  n=0
  for f in $(ls -1 [0-9][0-9][0-9]_*.sql | sort | awk -F_ -v ate="$ATE" '$1+0 <= ate+0'); do
    "${PSQL[@]}" -c "insert into public.migracoes_aplicadas (arquivo) values ('$f') on conflict (arquivo) do nothing;" >/dev/null
    n=$((n+1))
  done
  verde "Anotadas $n migrações até a $ATE como já aplicadas."
  exit 0
fi

APLICADAS=$("${PSQL[@]}" -tAc 'select arquivo from public.migracoes_aplicadas' | tr -d '\r')
PENDENTES=()
for f in $(ls -1 [0-9][0-9][0-9]_*.sql | sort); do
  if ! grep -qxF "$f" <<< "$APLICADAS"; then PENDENTES+=("$f"); fi
done

if [ ${#PENDENTES[@]} -eq 0 ]; then
  verde 'Banco em dia: nenhuma migração pendente.'
  exit 0
fi

# banco que nunca anotou nada: ou é novo (roda tudo), ou já foi
# atualizado pelo editor (anote com --ja-rodei NNN e rode de novo)
if [ -z "$APLICADAS" ] && [ "$MODO" != "--listar" ]; then
  if "${PSQL[@]}" -tAc "select 1 from information_schema.tables where table_schema='public' and table_name='appointments'" | grep -q 1; then
    amarelo 'Este banco já tem as tabelas do MIMO, mas nunca anotou migração.'
    echo '  Se você já colou o atualizacao_040_em_diante.sql no editor, diga até qual:'
    echo "     ./supabase/aplicar.sh --ja-rodei 079"
    echo '  Depois rode ./supabase/aplicar.sh de novo. (Rodar tudo de novo também'
    echo '  funciona, só demora: as migrações são feitas para repetir.)'
    read -rp '  Rodar TODAS agora mesmo assim? (s/N) ' ok
    [ "${ok:-n}" = "s" ] || exit 0
  fi
fi

azul "== ${#PENDENTES[@]} migração(ões) pendente(s) =="
for f in "${PENDENTES[@]}"; do echo "   $f"; done
[ "$MODO" = "--listar" ] && exit 0
echo

for f in "${PENDENTES[@]}"; do
  printf '  %-45s ' "$f"
  if "${PSQL[@]}" --single-transaction -f "$f" >/tmp/aplicar.log 2>&1; then
    "${PSQL[@]}" -c "insert into public.migracoes_aplicadas (arquivo) values ('$f') on conflict (arquivo) do nothing;" >/dev/null
    verde 'ok'
  else
    vermelho 'ERRO'
    echo
    tail -20 /tmp/aplicar.log
    echo
    vermelho "Parei na $f. Nada dela ficou no banco (transação desfeita). Me mande a mensagem acima."
    exit 1
  fi
done
verde 'Banco atualizado.'
