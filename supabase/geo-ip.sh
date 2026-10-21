#!/usr/bin/env bash
#
# MIMO — a base de IP do Brasil para o site ao vivo (3.44, migração 192).
#
#   ./supabase/geo-ip.sh                    baixa a base do mês (DB-IP Lite) e carrega no banco
#   ./supabase/geo-ip.sh --arquivo X.csv.gz usa um arquivo já baixado
#
# O aplicar.sh chama sozinho quando a base está vazia ou tem mais de 45 dias. A base é a "IP to City Lite" da
# DB-IP (db-ip.com, licença CC BY 4.0: a Plataforma dá o crédito na aba Ao vivo). Só o Brasil vai para o banco
# (umas 400 mil faixas, ~40 MB). Carrega numa tabela nova e troca de uma vez: o site ao vivo nunca fica sem base
# no meio. O IP de quem visita nunca é guardado; a base só diz a cidade aproximada de uma faixa.
set -euo pipefail
cd "$(dirname "$0")"
verde()   { printf '\033[1;32m%s\033[0m\n' "$*"; }
amarelo() { printf '\033[1;33m%s\033[0m\n' "$*"; }
vermelho(){ printf '\033[1;31m%s\033[0m\n' "$*"; }
ENV=../evolution/.env
[ -f "$ENV" ] && { set -a; . "$ENV"; set +a; }
[ -n "${SUPABASE_DB_URL:-}" ] || { vermelho 'Sem SUPABASE_DB_URL no evolution/.env (o aplicar.sh configura).'; exit 1; }
command -v node >/dev/null || { vermelho 'Preciso do node para preparar a base de IP.'; exit 1; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
ARQUIVO=''
VERSAO=''
if [ "${1:-}" = '--arquivo' ] && [ -n "${2:-}" ]; then
  ARQUIVO=$2
  VERSAO=$(basename "$2" | grep -oE '[0-9]{4}-[0-9]{2}' | head -1 || true)
  VERSAO=${VERSAO:-local}
else
  # o arquivo do mês sai no comecinho do mês: se ainda não saiu, o do mês passado
  MES=$(date +%Y-%m)
  ANTES=$(date -d "$(date +%Y-%m-01) -1 day" +%Y-%m 2>/dev/null || date -v-1m +%Y-%m)
  for m in "$MES" "$ANTES"; do
    if curl -fsSL --retry 2 -o "$TMP/dbip.csv.gz" "https://download.db-ip.com/free/dbip-city-lite-$m.csv.gz"; then VERSAO=$m; break; fi
  done
  [ -n "$VERSAO" ] || { vermelho 'Não consegui baixar a base de IP da DB-IP (rede?). O site ao vivo segue sem a cidade pelo IP.'; exit 1; }
  ARQUIVO="$TMP/dbip.csv.gz"
fi

node ../scripts/geo-ip.mjs --arquivo "$ARQUIVO" --saida "$TMP"

psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q -X <<SQL
set statement_timeout = 0;
drop table if exists public.geo_ip_br_nova;
create table public.geo_ip_br_nova (inicio inet primary key, fim inet not null, cidade_id integer not null);
\copy public.geo_ip_br_nova from '$TMP/faixas.tsv'
create temp table geo_cidades_nova (like public.geo_cidades);
\copy geo_cidades_nova from '$TMP/cidades.tsv'
analyze public.geo_ip_br_nova;
begin;
set local lock_timeout = '15s';
truncate public.geo_cidades;
insert into public.geo_cidades select * from geo_cidades_nova;
drop table public.geo_ip_br;
alter table public.geo_ip_br_nova rename to geo_ip_br;
alter index public.geo_ip_br_nova_pkey rename to geo_ip_br_pkey;
alter table public.geo_ip_br enable row level security;
revoke all on public.geo_ip_br from public, anon, authenticated;
comment on table public.geo_ip_br is 'Site (192): faixas de IP do Brasil e a cidade aproximada (DB-IP Lite, db-ip.com, CC BY 4.0), carregadas por supabase/geo-ip.sh. O IP de quem visita nunca é guardado.';
insert into public.geo_ip_carga (id, versao, carregado_em, faixas, cidades)
  values (1, '$VERSAO', now(), (select count(*) from public.geo_ip_br), (select count(*) from public.geo_cidades))
  on conflict (id) do update set versao = excluded.versao, carregado_em = excluded.carregado_em, faixas = excluded.faixas, cidades = excluded.cidades;
commit;
SQL
verde "  base de IP carregada (DB-IP Lite $VERSAO): a cidade aproximada do site ao vivo está ligada"
