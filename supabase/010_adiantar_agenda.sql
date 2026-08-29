-- =============================================================
-- Agenda Mel — 010: adiantar a agenda
-- Rode este arquivo no SQL Editor do Supabase (DEPOIS do 009).
--
-- A profissional terminou antes e quer puxar os próximos horários.
-- REGRA CENTRAL: nunca se adianta à força. O app cria um CONVITE com
-- prazo; a cliente aceita ou recusa. Sem resposta, nada muda.
-- =============================================================

-- O app é usado no Brasil; a agenda é sempre lida no horário local.
create or replace function public.agora_local()
returns timestamp
language sql
stable
as $$
  select (now() at time zone 'America/Sao_Paulo')::timestamp;
$$;

create table if not exists public.appointment_offers (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments (id) on delete cascade,
  -- para onde estamos propondo mover
  proposed_date date not null,
  proposed_start_time time not null,
  proposed_end_time time not null,
  -- de onde saiu (permite desfazer e auditar)
  previous_date date not null,
  previous_start_time time not null,
  previous_end_time time not null,
  status text not null default 'pendente'
    check (status in ('pendente', 'aceita', 'recusada', 'expirada', 'cancelada')),
  expires_at timestamptz not null,
  created_by uuid references public.profiles (id) on delete set null,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  check (proposed_end_time > proposed_start_time)
);

-- No máximo um convite aberto por agendamento
create unique index if not exists appointment_offers_um_pendente
  on public.appointment_offers (appointment_id)
  where status = 'pendente';

create index if not exists appointment_offers_appt_idx
  on public.appointment_offers (appointment_id, created_at desc);

alter table public.appointment_offers enable row level security;

-- Cliente vê os convites dos agendamentos dela; profissional, os dela
drop policy if exists "ver convites de antecipacao" on public.appointment_offers;
create policy "ver convites de antecipacao"
  on public.appointment_offers for select
  to authenticated
  using (
    exists (
      select 1 from public.appointments a
      where a.id = appointment_offers.appointment_id
        and (
          a.client_id = auth.uid()
          or public.is_admin()
          or public.is_professional(a.professional_id)
        )
    )
  );

-- Escrita só pelas funções abaixo
revoke insert, update, delete on public.appointment_offers from authenticated, anon;

-- -------------------------------------------------------------
-- Quanto dá para adiantar: o horário mais cedo possível para um
-- agendamento, sem colidir com o que já está marcado nem cair no
-- passado. Devolve null quando não há espaço.
-- -------------------------------------------------------------
create or replace function public.horario_mais_cedo_possivel(appt_id uuid)
returns time
language plpgsql
stable
security definer set search_path = public
as $$
declare
  appt public.appointments%rowtype;
  duracao interval;
  limite_anterior time;
  expediente_inicio time;
  candidato time;
  minutos integer;
  agora timestamp := public.agora_local();
begin
  select * into appt from public.appointments where id = appt_id;
  if not found or appt.status in ('cancelado', 'concluido') then
    return null;
  end if;

  duracao := appt.end_time - appt.start_time;

  -- não adiantamos para antes da abertura do expediente dela
  select h.start_time into expediente_inicio
  from public.professional_hours h
  where h.professional_id = appt.professional_id
    and h.weekday = extract(dow from appt.date)
    and h.open;
  if expediente_inicio is null then
    return null;
  end if;

  -- nem para cima do atendimento anterior do mesmo dia
  select max(a.end_time) into limite_anterior
  from public.appointments a
  where a.professional_id = appt.professional_id
    and a.date = appt.date
    and a.id <> appt.id
    and a.status <> 'cancelado'
    and a.end_time <= appt.start_time;

  candidato := greatest(expediente_inicio, coalesce(limite_anterior, expediente_inicio));

  -- se é hoje, nunca para antes de agora
  if appt.date = agora::date then
    candidato := greatest(candidato, (agora + interval '5 minutes')::time);
  end if;

  -- arredonda para os 5 minutos seguintes, para não propor 13:47
  minutos := extract(hour from candidato)::int * 60 + extract(minute from candidato)::int;
  minutos := (ceil(minutos / 5.0) * 5)::int;
  if minutos >= 24 * 60 then
    return null;
  end if;
  candidato := make_time(minutos / 60, minutos % 60, 0);

  if candidato >= appt.start_time then
    return null; -- não há nada a adiantar
  end if;

  -- o horário proposto ainda precisa caber antes do próximo atendimento
  if exists (
    select 1 from public.appointments a
    where a.professional_id = appt.professional_id
      and a.date = appt.date
      and a.id <> appt.id
      and a.status <> 'cancelado'
      and candidato < a.end_time
      and (candidato + duracao) > a.start_time
  ) then
    return null;
  end if;

  return candidato;
end;
$$;

-- -------------------------------------------------------------
-- A profissional convida a cliente a adiantar
-- -------------------------------------------------------------
create or replace function public.propor_antecipacao(
  appt_id uuid,
  novo_inicio time,
  minutos_para_responder integer default 15
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  appt public.appointments%rowtype;
  duracao interval;
  novo_fim time;
  prof_nome text;
  serv_nome text;
  oferta_id uuid;
begin
  select * into appt from public.appointments where id = appt_id;
  if not found then
    raise exception 'Agendamento não encontrado';
  end if;

  if not (public.is_admin() or public.is_professional(appt.professional_id)) then
    raise exception 'Só a profissional do atendimento pode propor adiantar';
  end if;

  if appt.status in ('cancelado', 'concluido') then
    raise exception 'Este agendamento não está mais aberto';
  end if;

  if novo_inicio >= appt.start_time then
    raise exception 'O novo horário precisa ser mais cedo que o atual';
  end if;

  if minutos_para_responder < 5 or minutos_para_responder > 240 then
    raise exception 'O prazo de resposta deve ficar entre 5 e 240 minutos';
  end if;

  duracao := appt.end_time - appt.start_time;
  novo_fim := novo_inicio + duracao;

  -- o horário proposto precisa estar livre na agenda dela
  if exists (
    select 1 from public.appointments a
    where a.professional_id = appt.professional_id
      and a.date = appt.date
      and a.id <> appt.id
      and a.status <> 'cancelado'
      and novo_inicio < a.end_time
      and novo_fim > a.start_time
  ) then
    raise exception 'Esse horário conflita com outro atendimento';
  end if;

  -- fecha convite anterior ainda aberto para este agendamento
  update public.appointment_offers
  set status = 'cancelada', responded_at = now()
  where appointment_id = appt_id and status = 'pendente';

  insert into public.appointment_offers (
    appointment_id, proposed_date, proposed_start_time, proposed_end_time,
    previous_date, previous_start_time, previous_end_time,
    expires_at, created_by
  ) values (
    appt_id, appt.date, novo_inicio, novo_fim,
    appt.date, appt.start_time, appt.end_time,
    now() + make_interval(mins => minutos_para_responder), auth.uid()
  )
  returning id into oferta_id;

  select p.name into prof_nome from public.professionals p where p.id = appt.professional_id;
  select s.name into serv_nome from public.services s where s.id = appt.service_id;

  perform public.notificar(
    appt.client_id,
    'agenda_adiantada',
    'Dá para adiantar seu horário?',
    format('%s pode te atender às %s em vez de %s (%s). Responda em até %s minutos.',
           coalesce(prof_nome, 'Sua profissional'),
           to_char(novo_inicio, 'HH24:MI'),
           to_char(appt.start_time, 'HH24:MI'),
           coalesce(serv_nome, 'seu serviço'),
           minutos_para_responder),
    '/',
    jsonb_build_object('offer_id', oferta_id, 'appointment_id', appt_id),
    now() + make_interval(mins => minutos_para_responder)
  );

  return oferta_id;
end;
$$;

-- -------------------------------------------------------------
-- A cliente responde
-- -------------------------------------------------------------
create or replace function public.responder_antecipacao(
  oferta_id uuid,
  aceitar boolean
)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  oferta public.appointment_offers%rowtype;
  appt public.appointments%rowtype;
  cliente_nome text;
  prof_user uuid;
begin
  select * into oferta from public.appointment_offers where id = oferta_id;
  if not found then
    raise exception 'Convite não encontrado';
  end if;

  select * into appt from public.appointments where id = oferta.appointment_id;

  if appt.client_id <> auth.uid() then
    raise exception 'Só a cliente do agendamento pode responder';
  end if;

  if oferta.status <> 'pendente' then
    raise exception 'Este convite já foi respondido';
  end if;

  if oferta.expires_at <= now() then
    update public.appointment_offers
    set status = 'expirada', responded_at = now()
    where id = oferta_id;
    return 'expirada';
  end if;

  select full_name into cliente_nome from public.profiles where id = appt.client_id;
  select user_id into prof_user from public.professionals where id = appt.professional_id;

  if not aceitar then
    update public.appointment_offers
    set status = 'recusada', responded_at = now()
    where id = oferta_id;

    if prof_user is not null then
      perform public.notificar(
        prof_user, 'agenda_adiantada', 'Adiantamento recusado',
        format('%s prefere manter as %s.',
               coalesce(cliente_nome, 'A cliente'),
               to_char(oferta.previous_start_time, 'HH24:MI')),
        '/pro', jsonb_build_object('appointment_id', appt.id), null
      );
    end if;
    return 'recusada';
  end if;

  -- alguém pode ter ocupado o horário entre o convite e o aceite
  if exists (
    select 1 from public.appointments a
    where a.professional_id = appt.professional_id
      and a.date = oferta.proposed_date
      and a.id <> appt.id
      and a.status <> 'cancelado'
      and oferta.proposed_start_time < a.end_time
      and oferta.proposed_end_time > a.start_time
  ) then
    update public.appointment_offers
    set status = 'expirada', responded_at = now()
    where id = oferta_id;
    return 'conflito';
  end if;

  update public.appointments
  set date = oferta.proposed_date,
      start_time = oferta.proposed_start_time,
      end_time = oferta.proposed_end_time
  where id = appt.id;

  update public.appointment_offers
  set status = 'aceita', responded_at = now()
  where id = oferta_id;

  if prof_user is not null then
    perform public.notificar(
      prof_user, 'agenda_adiantada', 'Horário adiantado ✅',
      format('%s aceitou vir às %s.',
             coalesce(cliente_nome, 'A cliente'),
             to_char(oferta.proposed_start_time, 'HH24:MI')),
      '/pro', jsonb_build_object('appointment_id', appt.id), null
    );
  end if;

  return 'aceita';
end;
$$;

-- -------------------------------------------------------------
-- A profissional desiste do convite / desfaz o adiantamento
-- -------------------------------------------------------------
create or replace function public.cancelar_antecipacao(oferta_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  oferta public.appointment_offers%rowtype;
  appt public.appointments%rowtype;
begin
  select * into oferta from public.appointment_offers where id = oferta_id;
  if not found then
    raise exception 'Convite não encontrado';
  end if;

  select * into appt from public.appointments where id = oferta.appointment_id;

  if not (public.is_admin() or public.is_professional(appt.professional_id)) then
    raise exception 'Sem permissão';
  end if;

  if oferta.status = 'pendente' then
    update public.appointment_offers
    set status = 'cancelada', responded_at = now()
    where id = oferta_id;
    return;
  end if;

  -- desfazer um adiantamento já aceito, se o horário antigo estiver livre
  if oferta.status = 'aceita' then
    if exists (
      select 1 from public.appointments a
      where a.professional_id = appt.professional_id
        and a.date = oferta.previous_date
        and a.id <> appt.id
        and a.status <> 'cancelado'
        and oferta.previous_start_time < a.end_time
        and oferta.previous_end_time > a.start_time
    ) then
      raise exception 'O horário original já foi ocupado';
    end if;

    update public.appointments
    set date = oferta.previous_date,
        start_time = oferta.previous_start_time,
        end_time = oferta.previous_end_time
    where id = appt.id;

    update public.appointment_offers
    set status = 'cancelada'
    where id = oferta_id;

    perform public.notificar(
      appt.client_id, 'agenda_adiantada', 'Seu horário voltou ao original',
      format('Voltamos para as %s.', to_char(oferta.previous_start_time, 'HH24:MI')),
      '/', jsonb_build_object('appointment_id', appt.id), null
    );
  end if;
end;
$$;

grant execute on function public.agora_local() to anon, authenticated;
grant execute on function public.horario_mais_cedo_possivel(uuid) to authenticated;
grant execute on function public.propor_antecipacao(uuid, time, integer) to authenticated;
grant execute on function public.responder_antecipacao(uuid, boolean) to authenticated;
grant execute on function public.cancelar_antecipacao(uuid) to authenticated;
