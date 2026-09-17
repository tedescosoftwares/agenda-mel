-- 084 · Promoção com desconto
--
-- A promoção pode promover um serviço (combo inclusive) e dar um
-- desconto em %. O desconto é aplicado na finalização, dentro do
-- marcar_servicos, só para a cliente que ENXERGA a promoção (a regra da
-- carteira do 083). O item guarda o preço cheio e a promoção, para a
-- cliente ver "de/por" e a profissional saber de onde veio.
--
-- O que muda:
--   promocoes.desconto_pct
--   appointment_services.promocao_id, preco_cheio_cents; appointments.desconto_cents
--   promocoes_visiveis_para(cliente)   a regra da carteira num lugar só
--   promocoes_para_mim()               agora com desconto e de/por
--   descontos_para_mim([servicos])     o melhor desconto por serviço
--   marcar_servicos                    aplica o desconto

alter table public.promocoes add column if not exists desconto_pct integer check (desconto_pct is null or desconto_pct between 1 and 90);
alter table public.appointment_services add column if not exists promocao_id uuid references public.promocoes (id) on delete set null;
alter table public.appointment_services add column if not exists preco_cheio_cents integer;
alter table public.appointments add column if not exists desconto_cents integer not null default 0;

-- a regra da carteira, para reaproveitar
create or replace function public.promocoes_visiveis_para(cliente uuid)
returns setof public.promocoes
language sql
stable
security definer set search_path = public
as $$
  with minhas_profs as (
    select f.professional_id from public.client_favorites f where f.client_id = cliente
    union
    select a.professional_id from public.appointments a where a.client_id = cliente and a.professional_id is not null
    union
    select v.trazida_por from public.vinculos v where v.client_id = cliente and v.saiu_em is null and v.trazida_por is not null
  ),
  meus_saloes as (
    select v.salon_id from public.vinculos v where v.client_id = cliente and v.saiu_em is null
    union
    select p.salon_id from public.professionals p join minhas_profs m on m.professional_id = p.id
  ),
  hoje as (select (public.agora_local())::date as d)
  select pr.*
  from public.promocoes pr
  cross join hoje
  left join public.professionals p on p.id = pr.professional_id
  where cliente is not null
    and pr.ativa and pr.inicio <= hoje.d and (pr.fim is null or pr.fim >= hoje.d)
    and (p.id is null or p.active)
    and (pr.salon_id is null
         or (pr.professional_id is not null and pr.professional_id in (select professional_id from minhas_profs))
         or (pr.professional_id is null and pr.salon_id in (select salon_id from meus_saloes)));
$$;
revoke execute on function public.promocoes_visiveis_para(uuid) from public, anon, authenticated;

drop function if exists public.promocoes_para_mim();
create function public.promocoes_para_mim()
returns table (
  id uuid, titulo text, texto text, imagem_url text,
  salon_id uuid, salao text, professional_id uuid, profissional text, service_id uuid, servico text,
  fim date, desconto_pct integer, preco_de numeric, preco_por numeric
)
language sql
stable
security definer set search_path = public
as $$
  select pr.id, pr.titulo, pr.texto, pr.imagem_url,
         pr.salon_id, s.name,
         coalesce(pr.professional_id,
                  (select ps.professional_id from public.professional_services ps
                     join public.professionals p2 on p2.id = ps.professional_id and p2.active and p2.salon_id = pr.salon_id
                    where ps.service_id = pr.service_id
                    order by (exists (select 1 from public.appointments a where a.client_id = auth.uid() and a.professional_id = ps.professional_id)) desc, p2.name limit 1)),
         p.name, pr.service_id, sv.name, pr.fim,
         case when sv.id is not null then pr.desconto_pct end,
         sv.price,
         case when sv.id is not null and pr.desconto_pct is not null then round(sv.price * (100 - pr.desconto_pct) / 100.0, 2) end
  from public.promocoes_visiveis_para(auth.uid()) pr
  left join public.salons s on s.id = pr.salon_id
  left join public.professionals p on p.id = pr.professional_id
  left join public.services sv on sv.id = pr.service_id and sv.active
  order by (pr.professional_id is not null) desc, (pr.salon_id is not null) desc, pr.created_at desc
  limit 12;
$$;
revoke execute on function public.promocoes_para_mim() from public, anon;
grant execute on function public.promocoes_para_mim() to authenticated;

-- o melhor desconto que a cliente tem em cada serviço
create or replace function public.descontos_para_mim(servicos uuid[])
returns table (service_id uuid, promocao_id uuid, titulo text, desconto_pct integer, preco_cents integer, preco_com_desconto_cents integer)
language sql
stable
security definer set search_path = public
as $$
  select distinct on (sv.id)
         sv.id, pr.id, pr.titulo, pr.desconto_pct,
         round(sv.price * 100)::integer,
         round(sv.price * 100 * (100 - pr.desconto_pct) / 100.0)::integer
  from public.services sv
  join public.promocoes_visiveis_para(auth.uid()) pr on pr.service_id = sv.id and pr.desconto_pct is not null
  where sv.id = any (coalesce(servicos, '{}'))
  order by sv.id, pr.desconto_pct desc, pr.created_at desc;
$$;
revoke execute on function public.descontos_para_mim(uuid[]) from public, anon;
grant execute on function public.descontos_para_mim(uuid[]) to authenticated;

-- marcar_servicos aplica o desconto e guarda de onde veio
create or replace function public.marcar_servicos(prof uuid, servicos uuid[], dia date, hora time, obs text default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  eu uuid := auth.uid();
  itens record;
  total_min integer := 0;
  total_cents integer := 0;
  total_desconto integer := 0;
  nomes text := '';
  novo uuid;
  n integer := 0;
  sal uuid;
begin
  if eu is null then raise exception 'Entre na sua conta para marcar.'; end if;
  if servicos is null or array_length(servicos, 1) is null then raise exception 'Escolha pelo menos um serviço.'; end if;
  if array_length(servicos, 1) > 6 then raise exception 'No máximo 6 serviços por horário.'; end if;
  select p.salon_id into sal from public.professionals p where p.id = prof and p.active;
  if sal is null and not exists (select 1 from public.professionals p where p.id = prof and p.active) then raise exception 'Profissional não encontrada.'; end if;

  -- os itens, já com o desconto de quem pode ter
  create temp table if not exists itens_do_pedido (
    ord integer, service_id uuid, name text, cents integer, cheio integer, promocao_id uuid, duration_minutes integer
  ) on commit drop;
  delete from itens_do_pedido where true;
  insert into itens_do_pedido (ord, service_id, name, cents, cheio, promocao_id, duration_minutes)
  select x.ord, s.id, s.name,
         coalesce(d.preco_com_desconto_cents, round(s.price * 100)::integer),
         round(s.price * 100)::integer,
         d.promocao_id,
         s.duration_minutes
  from unnest(servicos) with ordinality as x(id, ord)
  join public.services s on s.id = x.id and s.active
  join public.professional_services ps on ps.service_id = s.id and ps.professional_id = prof
  left join public.descontos_para_mim(servicos) d on d.service_id = s.id;

  for itens in select * from itens_do_pedido order by ord loop
    n := n + 1;
    total_min := total_min + coalesce(itens.duration_minutes, 0);
    total_cents := total_cents + coalesce(itens.cents, 0);
    total_desconto := total_desconto + (coalesce(itens.cheio, 0) - coalesce(itens.cents, 0));
    nomes := nomes || case when nomes = '' then '' else ' + ' end || itens.name;
  end loop;
  if n <> array_length(servicos, 1) then raise exception 'Algum serviço não está disponível com essa profissional.'; end if;
  if total_min <= 0 then raise exception 'Serviço sem duração.'; end if;

  begin
    insert into public.appointments
      (client_id, professional_id, service_id, service_name, price_cents, desconto_cents, date, start_time, end_time, notes, status)
    values
      (eu, prof, servicos[1], nomes, total_cents, total_desconto, dia, hora, (hora + make_interval(mins => total_min))::time, nullif(btrim(coalesce(obs, '')), ''), 'pendente')
    returning id into novo;
  exception when unique_violation or exclusion_violation then
    return jsonb_build_object('ok', false, 'motivo', 'ocupado');
  end;

  insert into public.appointment_services (appointment_id, service_id, name, price_cents, preco_cheio_cents, promocao_id, duration_minutes, ordem)
  select novo, i.service_id, i.name, i.cents, i.cheio, i.promocao_id, i.duration_minutes, i.ord
  from itens_do_pedido i order by i.ord;

  return jsonb_build_object('ok', true, 'appointment_id', novo, 'servicos', n, 'minutos', total_min, 'cents', total_cents, 'desconto_cents', total_desconto);
end;
$$;

-- a troca leva o desconto junto
create or replace function public.copia_itens_da_remarcacao()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.remarca_de is not null then
    insert into public.appointment_services (appointment_id, service_id, name, price_cents, preco_cheio_cents, promocao_id, duration_minutes, ordem)
    select new.id, i.service_id, i.name, i.price_cents, i.preco_cheio_cents, i.promocao_id, i.duration_minutes, i.ordem
    from public.appointment_services i where i.appointment_id = new.remarca_de
    order by i.ordem;
    update public.appointments set desconto_cents = (select coalesce(o.desconto_cents, 0) from public.appointments o where o.id = new.remarca_de) where id = new.id;
  end if;
  return new;
end;
$$;
