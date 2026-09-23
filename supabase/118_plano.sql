-- 118: o plano do negócio, gravado no salão. Autônoma é grátis; salão
-- cai no MIMO Pro (até 10 agendas) ou no MIMO Pro+ (11 ou mais) pelo
-- tamanho da equipe prevista no onboarding. Um gatilho mantém a coluna
-- em dia; a cobrança em si ainda não passa pelo app.

alter table public.salons add column if not exists plano text not null default 'pro' check (plano in ('autonoma', 'pro', 'promais'));
grant select (plano) on public.salons to authenticated;

create or replace function public.plano_do_negocio(tipo text, agendas integer)
returns text
language sql
immutable
as $$
  select case when tipo = 'autonoma' then 'autonoma' when coalesce(agendas, 1) > 10 then 'promais' else 'pro' end;
$$;

-- quanto custa por mês, em centavos: Pro 4990 com 3 inclusas + 990 da 4ª à 10ª;
-- Pro+ 14990 com 11 inclusas + 790 da 12ª em diante
create or replace function public.mensalidade_cents(plano text, agendas integer)
returns integer
language sql
immutable
as $$
  select case plano
    when 'autonoma' then 0
    when 'promais' then 14990 + greatest(0, coalesce(agendas, 1) - 11) * 790
    else 4990 + greatest(0, least(coalesce(agendas, 1), 10) - 3) * 990
  end;
$$;

create or replace function public.salons_plano_tg()
returns trigger
language plpgsql
as $$
begin
  new.plano := public.plano_do_negocio(new.tipo, new.equipe_prevista);
  return new;
end;
$$;
drop trigger if exists salons_plano on public.salons;
create trigger salons_plano before insert or update of tipo, equipe_prevista on public.salons for each row execute function public.salons_plano_tg();
update public.salons set plano = public.plano_do_negocio(tipo, equipe_prevista);
