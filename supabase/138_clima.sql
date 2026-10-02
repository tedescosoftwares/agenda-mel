-- 138: o tempo lá fora (2.86)
--
-- A Edge Function `clima` consulta a Weather API do Google com o pino do
-- salão e guarda aqui por uma hora, por "célula" de ~5 km (lat/lng
-- arredondados a 0,05°): salões vizinhos dividem a mesma consulta e a
-- cota mensal do Google fica longe. Só a função (service role) lê e grava.

create table if not exists public.clima_cache (
  celula text primary key,          -- 'lat,lng' arredondados a 0,05°
  dados jsonb not null,             -- {condicao, tipo_google, temperatura, sensacao, dia, descricao}
  atualizado_em timestamptz not null default now()
);
alter table public.clima_cache enable row level security;
revoke all on public.clima_cache from anon, authenticated;

-- o que a função precisa do salão: o pino e a cidade (quem é da casa vê)
create or replace function public.clima_do_salao_base(salao uuid)
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select jsonb_build_object('lat', s.lat, 'lng', s.lng, 'cidade', s.city, 'uf', s.uf)
  from public.salons s
  where s.id = salao
    and (public.is_admin_do_salao(s.id) or public.eh_plataforma()
         or exists (select 1 from public.professionals p where p.salon_id = s.id and p.user_id = auth.uid()));
$$;
revoke execute on function public.clima_do_salao_base(uuid) from public, anon;
grant execute on function public.clima_do_salao_base(uuid) to authenticated;

-- limpa o que tem mais de um dia
create or replace function public.clima_limpar()
returns integer
language plpgsql
security definer set search_path = public
as $$
declare n integer;
begin
  delete from public.clima_cache where atualizado_em < now() - interval '1 day';
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.clima_limpar() from public, anon, authenticated;
