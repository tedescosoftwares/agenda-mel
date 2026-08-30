-- =============================================================
-- Agenda Mel — 016: a agenda diz a verdade do dia
-- Rode este arquivo no SQL Editor do Supabase (DEPOIS do 015).
--
-- Almoço, folga e compromisso; tempo de arrumação entre
-- atendimentos; encaixe manual de cliente que não usa o app;
-- preço congelado no atendimento; e perdoar uma falta.
-- =============================================================

-- 1. Almoço, folga e compromisso -----------------------------------------
create table if not exists public.professional_blocks (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.professionals (id) on delete cascade,
  -- 'semanal' = todo dia da semana (almoço, folga fixa)
  -- 'data'    = um dia específico (médico, viagem, feriado)
  kind text not null check (kind in ('semanal', 'data')),
  weekday smallint check (weekday between 0 and 6),
  date date,
  all_day boolean not null default false,
  start_time time,
  end_time time,
  reason text,
  created_at timestamptz not null default now(),
  check (kind <> 'semanal' or weekday is not null),
  check (kind <> 'data' or date is not null),
  check (all_day or (start_time is not null and end_time is not null and end_time > start_time))
);

create index if not exists blocks_prof_idx
  on public.professional_blocks (professional_id, kind, weekday, date);

alter table public.professional_blocks enable row level security;

-- a grade pública precisa saber o que está bloqueado
drop policy if exists "ver bloqueios" on public.professional_blocks;
create policy "ver bloqueios"
  on public.professional_blocks for select
  to anon, authenticated using (true);

drop policy if exists "equipe gerencia bloqueios" on public.professional_blocks;
create policy "equipe gerencia bloqueios"
  on public.professional_blocks for all
  to authenticated
  using (
    public.is_professional(professional_id)
    or public.is_admin_do_salao(
      (select salon_id from public.professionals where id = professional_id))
  )
  with check (
    public.is_professional(professional_id)
    or public.is_admin_do_salao(
      (select salon_id from public.professionals where id = professional_id))
  );

-- 2. Tempo de arrumação entre atendimentos -------------------------------
alter table public.professionals
  add column if not exists buffer_minutes integer not null default 0
    check (buffer_minutes between 0 and 120);

-- 3. Cliente que não usa o app (encaixe manual) --------------------------
alter table public.appointments alter column client_id drop not null;
alter table public.appointments add column if not exists guest_name text;
alter table public.appointments add column if not exists guest_phone text;
alter table public.appointments
  add constraint appointments_tem_cliente
  check (client_id is not null or guest_name is not null) not valid;

-- 4. Preço congelado no momento do atendimento ---------------------------
alter table public.appointments add column if not exists price_cents integer;
alter table public.appointments add column if not exists service_name text;

-- histórico antigo recebe o preço atual do serviço (melhor que nada)
update public.appointments a
set price_cents = round(s.price * 100)::integer,
    service_name = s.name
from public.services s
where s.id = a.service_id and a.price_cents is null;

create or replace function public.congela_preco_agendamento()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.price_cents is null or new.service_name is null then
    select round(price * 100)::integer, name
      into new.price_cents, new.service_name
    from public.services where id = new.service_id;
  end if;
  return new;
end;
$$;

revoke execute on function public.congela_preco_agendamento() from public, anon, authenticated;

drop trigger if exists on_congela_preco on public.appointments;
create trigger on_congela_preco
  before insert on public.appointments
  for each row execute function public.congela_preco_agendamento();

-- 5. A grade passa a considerar bloqueio e arrumação ---------------------
create or replace function public.get_busy_slots(dia date, prof uuid)
returns table (start_time time, end_time time)
language sql
stable
security definer set search_path = public
as $$
  with cfg as (
    select coalesce(buffer_minutes, 0) as buffer from public.professionals where id = prof
  ),
  expediente as (
    select h.start_time as abre, h.end_time as fecha
    from public.professional_hours h
    where h.professional_id = prof
      and h.weekday = extract(dow from dia)
  )
  -- atendimentos, esticados pelo tempo de arrumação
  select a.start_time,
         least(
           (a.end_time + make_interval(mins => (select buffer from cfg)))::time,
           coalesce((select fecha from expediente), '23:59'::time)
         )
  from public.appointments a
  where a.date = dia
    and a.professional_id = prof
    and a.status not in ('cancelado', 'faltou')

  union all

  -- vagas guardadas para quem está na fila
  select o.start_time, o.end_time
  from public.waitlist_offers o
  join public.waitlist_entries e on e.id = o.entry_id
  where o.date = dia
    and e.professional_id = prof
    and o.status = 'pendente'
    and o.expires_at > now()

  union all

  -- almoço, folga e compromissos
  select
    case when b.all_day then coalesce((select abre from expediente), '00:00'::time)
         else b.start_time end,
    case when b.all_day then coalesce((select fecha from expediente), '23:59'::time)
         else b.end_time end
  from public.professional_blocks b
  where b.professional_id = prof
    and (
      (b.kind = 'semanal' and b.weekday = extract(dow from dia))
      or (b.kind = 'data' and b.date = dia)
    );
$$;

grant execute on function public.get_busy_slots(date, uuid) to anon, authenticated;

-- 6. Encaixe manual ------------------------------------------------------
create or replace function public.encaixar_atendimento(
  prof uuid,
  servico uuid,
  dia date,
  inicio time,
  nome_cliente text default null,
  telefone text default null,
  cliente uuid default null,
  duracao_min integer default null
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  salao uuid;
  duracao integer;
  fim time;
  novo_id uuid;
begin
  select salon_id into salao from public.professionals where id = prof;
  if salao is null then
    raise exception 'Profissional não encontrada';
  end if;

  if not (public.is_professional(prof) or public.is_admin_do_salao(salao)) then
    raise exception 'Só a profissional ou o salão podem encaixar';
  end if;

  if cliente is null and coalesce(trim(nome_cliente), '') = '' then
    raise exception 'Informe o nome da cliente';
  end if;

  select duration_minutes into duracao from public.services where id = servico;
  if duracao is null then
    raise exception 'Serviço não encontrado';
  end if;
  duracao := coalesce(duracao_min, duracao);
  fim := inicio + make_interval(mins => duracao);

  -- o encaixe pode furar a grade de 30 em 30, mas nunca sobrepor
  if exists (
    select 1 from public.appointments a
    where a.professional_id = prof and a.date = dia
      and a.status not in ('cancelado', 'faltou')
      and inicio < a.end_time and fim > a.start_time
  ) then
    raise exception 'Esse horário conflita com outro atendimento';
  end if;

  insert into public.appointments
    (client_id, professional_id, service_id, date, start_time, end_time,
     status, guest_name, guest_phone)
  values
    (cliente, prof, servico, dia, inicio, fim, 'confirmado',
     case when cliente is null then trim(nome_cliente) else null end,
     case when cliente is null then nullif(trim(telefone), '') else null end)
  returning id into novo_id;

  return novo_id;
end;
$$;

grant execute on function public.encaixar_atendimento(uuid, uuid, date, time, text, text, uuid, integer) to authenticated;

-- 7. Perdoar uma falta ---------------------------------------------------
create or replace function public.perdoar_falta(appt_id uuid)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  appt public.appointments%rowtype;
begin
  select * into appt from public.appointments where id = appt_id;
  if not found then
    raise exception 'Agendamento não encontrado';
  end if;

  if not (public.is_professional(appt.professional_id)
          or public.is_admin_do_salao(appt.salon_id)) then
    raise exception 'Sem permissão';
  end if;

  if appt.status <> 'faltou' then
    raise exception 'Este atendimento não está marcado como falta';
  end if;

  -- a vaga pode ter sido ocupada por outra pessoa nesse meio-tempo
  if exists (
    select 1 from public.appointments a
    where a.professional_id = appt.professional_id and a.date = appt.date
      and a.id <> appt.id
      and a.status not in ('cancelado', 'faltou')
      and appt.start_time < a.end_time and appt.end_time > a.start_time
  ) then
    return 'ocupado';
  end if;

  update public.appointments set status = 'confirmado' where id = appt_id;
  return 'perdoada';
end;
$$;

grant execute on function public.perdoar_falta(uuid) to authenticated;

-- 8. O crédito de indicação não quebra com cliente sem conta -------------
create or replace function public.creditar_indicacao_se_couber()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  ind public.referrals%rowtype;
  cfg public.referral_settings%rowtype;
  premiados_no_mes integer;
  nome_indicada text;
  nome_indicou text;
  validade timestamptz;
  paga_indicador boolean := true;
begin
  if new.status <> 'concluido' or old.status = 'concluido' then
    return new;
  end if;

  -- encaixe de cliente sem conta não gera indicação
  if new.client_id is null then
    return new;
  end if;

  if not (public.is_admin_do_salao(new.salon_id)
          or public.is_professional(new.professional_id)) then
    return new;
  end if;

  select * into cfg from public.referral_settings where id;
  if not cfg.ativo then
    return new;
  end if;

  update public.referrals
  set status = 'creditada', credited_at = now(), appointment_id = new.id
  where referred_id = new.client_id and status = 'pendente'
  returning * into ind;

  if not found then
    return new;
  end if;

  if exists (
    select 1 from public.appointments
    where client_id = new.client_id and status = 'concluido' and id <> new.id
  ) then
    update public.referrals
    set status = 'bloqueada', credited_at = null, appointment_id = null,
        motivo_bloqueio = 'nao era o primeiro atendimento'
    where id = ind.id;
    return new;
  end if;

  select count(*) into premiados_no_mes
  from public.referrals
  where referrer_id = ind.referrer_id
    and status = 'creditada'
    and id <> ind.id
    and (credited_at at time zone 'America/Sao_Paulo')
        >= date_trunc('month', public.agora_local());

  if premiados_no_mes >= cfg.max_premios_por_mes then
    paga_indicador := false;
  end if;

  select full_name into nome_indicada from public.profiles where id = ind.referred_id;
  select full_name into nome_indicou from public.profiles where id = ind.referrer_id;
  validade := now() + make_interval(days => cfg.validade_dias);

  if paga_indicador and cfg.premio_indicou_cents > 0 then
    insert into public.credit_transactions
      (client_id, amount_cents, kind, description, referral_id, appointment_id, expires_at)
    values (ind.referrer_id, cfg.premio_indicou_cents, 'indicacao',
            format('Indicação de %s', coalesce(nome_indicada, 'uma amiga')),
            ind.id, new.id, validade);

    perform public.notificar(
      ind.referrer_id, 'indicacao_creditada', 'Seu crédito chegou! 🎁',
      format('%s fez o primeiro atendimento e você ganhou %s de crédito.',
             coalesce(nome_indicada, 'Sua indicada'),
             to_char(cfg.premio_indicou_cents / 100.0, 'FM999G990D00')),
      '/indique', jsonb_build_object('referral_id', ind.id), null
    );
  end if;

  if cfg.premio_indicada_cents > 0 then
    insert into public.credit_transactions
      (client_id, amount_cents, kind, description, referral_id, appointment_id, expires_at)
    values (ind.referred_id, cfg.premio_indicada_cents, 'indicacao_bonus',
            format('Bônus de boas-vindas (indicada por %s)', coalesce(nome_indicou, 'uma amiga')),
            ind.id, new.id, validade);

    perform public.notificar(
      ind.referred_id, 'indicacao_creditada', 'Bônus de boas-vindas 🎁',
      format('Você ganhou %s de crédito para o próximo atendimento.',
             to_char(cfg.premio_indicada_cents / 100.0, 'FM999G990D00')),
      '/indique', jsonb_build_object('referral_id', ind.id), null
    );
  end if;

  if not paga_indicador then
    update public.referrals set motivo_bloqueio = 'teto mensal de quem indicou'
    where id = ind.id;
  end if;

  return new;
end;
$$;

revoke execute on function public.creditar_indicacao_se_couber() from public, anon, authenticated;

-- 9. O abatimento de crédito usa o preço congelado -----------------------
create or replace function public.usar_credito(appt_id uuid, valor_cents integer)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  appt public.appointments%rowtype;
  saldo integer;
begin
  select * into appt from public.appointments where id = appt_id;
  if not found then
    raise exception 'Agendamento não encontrado';
  end if;

  if not (public.is_admin_do_salao(appt.salon_id)
          or public.is_professional(appt.professional_id)) then
    raise exception 'Só a profissional do atendimento pode abater crédito';
  end if;

  if appt.client_id is null then
    raise exception 'Cliente sem conta no app não tem carteira de crédito';
  end if;

  if valor_cents <= 0 then
    raise exception 'Valor inválido';
  end if;

  saldo := public.saldo_creditos(appt.client_id);
  if valor_cents > saldo then
    raise exception 'Crédito insuficiente';
  end if;

  if appt.price_cents is not null and valor_cents > appt.price_cents then
    raise exception 'O abatimento não pode passar do valor do atendimento';
  end if;

  if exists (
    select 1 from public.credit_transactions
    where appointment_id = appt_id and kind = 'uso'
  ) then
    raise exception 'Este atendimento já teve crédito abatido';
  end if;

  insert into public.credit_transactions
    (client_id, amount_cents, kind, description, appointment_id)
  values (appt.client_id, -valor_cents, 'uso', 'Abatido no atendimento', appt_id);

  perform public.notificar(
    appt.client_id, 'indicacao_creditada', 'Crédito usado',
    format('Abatemos %s no seu atendimento.',
           to_char(valor_cents / 100.0, 'FM999G990D00')),
    '/indique', jsonb_build_object('appointment_id', appt_id), null
  );

  return public.saldo_creditos(appt.client_id);
end;
$$;

grant execute on function public.usar_credito(uuid, integer) to authenticated;
