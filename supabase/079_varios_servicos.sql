-- 079 · Vários serviços num agendamento só
--
-- A cliente escolhe mais de um serviço (manicure + pedicure) e marca um
-- horário só: a duração é a soma, o preço é a soma, e o nome vira
-- "Manicure + Pedicure". O agendamento continua sendo UMA linha em
-- appointments (service_id = o primeiro, service_name/price_cents/
-- end_time somados), então agenda, avisos, ficha e números seguem
-- funcionando; os itens ficam em appointment_services.
--
--   appointment_services                     os itens
--   marcar_servicos(prof, servicos[], dia, hora, obs)   a cliente marca
--   copia_itens_da_remarcacao()              troca leva os itens junto

create table if not exists public.appointment_services (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments (id) on delete cascade,
  service_id uuid references public.services (id) on delete set null,
  name text not null,
  price_cents integer not null default 0,
  duration_minutes integer not null default 0,
  ordem integer not null default 1
);
create index if not exists appointment_services_appt_idx on public.appointment_services (appointment_id, ordem);
alter table public.appointment_services enable row level security;
drop policy if exists "itens de quem pode ver o agendamento" on public.appointment_services;
create policy "itens de quem pode ver o agendamento"
  on public.appointment_services for select
  to authenticated
  using (exists (
    select 1 from public.appointments a
    where a.id = appointment_id
      and (a.client_id = auth.uid() or public.is_professional(a.professional_id)
           or public.is_admin_do_salao(a.salon_id) or public.eh_plataforma())));
revoke insert, update, delete on public.appointment_services from anon, authenticated;

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

  for itens in
    select s.id, s.name, round(s.price * 100)::integer as cents, s.duration_minutes, x.ord
    from unnest(servicos) with ordinality as x(id, ord)
    join public.services s on s.id = x.id and s.active
    join public.professional_services ps on ps.service_id = s.id and ps.professional_id = prof
    order by x.ord
  loop
    n := n + 1;
    total_min := total_min + coalesce(itens.duration_minutes, 0);
    total_cents := total_cents + coalesce(itens.cents, 0);
    nomes := nomes || case when nomes = '' then '' else ' + ' end || itens.name;
  end loop;
  if n <> array_length(servicos, 1) then raise exception 'Algum serviço não está disponível com essa profissional.'; end if;
  if total_min <= 0 then raise exception 'Serviço sem duração.'; end if;

  begin
    insert into public.appointments
      (client_id, professional_id, service_id, service_name, price_cents, date, start_time, end_time, notes, status)
    values
      (eu, prof, servicos[1], nomes, total_cents, dia, hora, (hora + make_interval(mins => total_min))::time, nullif(btrim(coalesce(obs, '')), ''), 'pendente')
    returning id into novo;
  exception when unique_violation or exclusion_violation then
    return jsonb_build_object('ok', false, 'motivo', 'ocupado');
  end;

  insert into public.appointment_services (appointment_id, service_id, name, price_cents, duration_minutes, ordem)
  select novo, s.id, s.name, round(s.price * 100)::integer, s.duration_minutes, x.ord
  from unnest(servicos) with ordinality as x(id, ord)
  join public.services s on s.id = x.id
  order by x.ord;

  return jsonb_build_object('ok', true, 'appointment_id', novo, 'servicos', n, 'minutos', total_min, 'cents', total_cents);
end;
$$;
revoke execute on function public.marcar_servicos(uuid, uuid[], date, time, text) from public, anon;
grant execute on function public.marcar_servicos(uuid, uuid[], date, time, text) to authenticated;

-- a troca (pedido da cliente ou "Remarcamos" da profissional) leva os itens
create or replace function public.copia_itens_da_remarcacao()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.remarca_de is not null then
    insert into public.appointment_services (appointment_id, service_id, name, price_cents, duration_minutes, ordem)
    select new.id, i.service_id, i.name, i.price_cents, i.duration_minutes, i.ordem
    from public.appointment_services i where i.appointment_id = new.remarca_de
    order by i.ordem;
  end if;
  return new;
end;
$$;
drop trigger if exists tg_copia_itens_da_remarcacao on public.appointments;
create trigger tg_copia_itens_da_remarcacao
  after insert on public.appointments
  for each row execute function public.copia_itens_da_remarcacao();
