-- =============================================================
-- Agenda Mel — 014: correções da revisão
-- Rode este arquivo no SQL Editor do Supabase (DEPOIS do 013).
--
-- Fecha os defeitos de regra encontrados na revisão adversarial das
-- três features: horário no passado, vaga que some da fila, saldo
-- negativo, crédito dobrado e as discordâncias sobre "faltou".
-- =============================================================

-- -------------------------------------------------------------
-- 1. "Faltou" agora é horário LIVRE para todo mundo
--
-- O 011 passou a tratar falta como vaga livre, mas as funções de
-- adiantar agenda continuaram contando quem faltou como ocupado.
-- As duas features discordavam sobre a mesma agenda.
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
  if not found or appt.status not in ('pendente', 'confirmado') then
    return null;
  end if;

  duracao := appt.end_time - appt.start_time;

  select h.start_time into expediente_inicio
  from public.professional_hours h
  where h.professional_id = appt.professional_id
    and h.weekday = extract(dow from appt.date)
    and h.open;
  if expediente_inicio is null then
    return null;
  end if;

  select max(a.end_time) into limite_anterior
  from public.appointments a
  where a.professional_id = appt.professional_id
    and a.date = appt.date
    and a.id <> appt.id
    and a.status not in ('cancelado', 'faltou')
    and a.end_time <= appt.start_time;

  candidato := greatest(expediente_inicio, coalesce(limite_anterior, expediente_inicio));

  if appt.date < agora::date then
    return null;
  end if;
  if appt.date = agora::date then
    candidato := greatest(candidato, (agora + interval '5 minutes')::time);
  end if;

  minutos := extract(hour from candidato)::int * 60 + extract(minute from candidato)::int;
  minutos := (ceil(minutos / 5.0) * 5)::int;
  if minutos >= 24 * 60 then
    return null;
  end if;
  candidato := make_time(minutos / 60, minutos % 60, 0);

  if candidato >= appt.start_time then
    return null;
  end if;

  if exists (
    select 1 from public.appointments a
    where a.professional_id = appt.professional_id
      and a.date = appt.date
      and a.id <> appt.id
      and a.status not in ('cancelado', 'faltou')
      and candidato < a.end_time
      and (candidato + duracao) > a.start_time
  ) then
    return null;
  end if;

  return candidato;
end;
$$;

-- -------------------------------------------------------------
-- 2. Convite não pode propor (nem ser aceito para) horário passado
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
  expediente_inicio time;
  prof_nome text;
  serv_nome text;
  oferta_id uuid;
  agora timestamp := public.agora_local();
begin
  select * into appt from public.appointments where id = appt_id;
  if not found then
    raise exception 'Agendamento não encontrado';
  end if;

  if not (public.is_admin() or public.is_professional(appt.professional_id)) then
    raise exception 'Só a profissional do atendimento pode propor adiantar';
  end if;

  if appt.status not in ('pendente', 'confirmado') then
    raise exception 'Este agendamento não está mais aberto';
  end if;

  if novo_inicio >= appt.start_time then
    raise exception 'O novo horário precisa ser mais cedo que o atual';
  end if;

  -- nunca para o passado
  if (appt.date + novo_inicio) <= agora then
    raise exception 'Esse horário já passou';
  end if;

  -- nem antes de a profissional abrir
  select h.start_time into expediente_inicio
  from public.professional_hours h
  where h.professional_id = appt.professional_id
    and h.weekday = extract(dow from appt.date)
    and h.open;
  if expediente_inicio is null or novo_inicio < expediente_inicio then
    raise exception 'Esse horário está fora do seu expediente';
  end if;

  if minutos_para_responder < 5 or minutos_para_responder > 240 then
    raise exception 'O prazo de resposta deve ficar entre 5 e 240 minutos';
  end if;

  duracao := appt.end_time - appt.start_time;
  novo_fim := novo_inicio + duracao;

  if exists (
    select 1 from public.appointments a
    where a.professional_id = appt.professional_id
      and a.date = appt.date
      and a.id <> appt.id
      and a.status not in ('cancelado', 'faltou')
      and novo_inicio < a.end_time
      and novo_fim > a.start_time
  ) then
    raise exception 'Esse horário conflita com outro atendimento';
  end if;

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
    -- o prazo nunca passa do próprio horário proposto
    least(now() + make_interval(mins => minutos_para_responder),
          now() + greatest(
            interval '1 minute',
            (appt.date + novo_inicio) - agora - interval '5 minutes')),
    auth.uid()
  )
  returning id into oferta_id;

  select p.name into prof_nome from public.professionals p where p.id = appt.professional_id;
  select s.name into serv_nome from public.services s where s.id = appt.service_id;

  perform public.notificar(
    appt.client_id,
    'agenda_adiantada',
    'Dá para adiantar seu horário?',
    format('%s pode te atender às %s em vez de %s (%s).',
           coalesce(prof_nome, 'Sua profissional'),
           to_char(novo_inicio, 'HH24:MI'),
           to_char(appt.start_time, 'HH24:MI'),
           coalesce(serv_nome, 'seu serviço')),
    '/',
    jsonb_build_object('offer_id', oferta_id, 'appointment_id', appt_id),
    now() + make_interval(mins => minutos_para_responder)
  );

  return oferta_id;
end;
$$;

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
  agora timestamp := public.agora_local();
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

  -- o agendamento pode ter sido cancelado ou marcado como falta
  if appt.status not in ('pendente', 'confirmado') then
    update public.appointment_offers
    set status = 'cancelada', responded_at = now()
    where id = oferta_id;
    return 'expirada';
  end if;

  -- prazo vencido OU o horário proposto já passou
  if oferta.expires_at <= now()
     or (oferta.proposed_date + oferta.proposed_start_time) <= agora then
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

  if exists (
    select 1 from public.appointments a
    where a.professional_id = appt.professional_id
      and a.date = oferta.proposed_date
      and a.id <> appt.id
      and a.status not in ('cancelado', 'faltou')
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
-- 3. A vaga oferecida precisa lembrar a janela inteira que abriu
--
-- Antes a vaga era re-oferecida com a duração do serviço de quem
-- recusou: a cada recusa a janela encolhia e quem tinha serviço mais
-- longo era pulada para sempre.
-- -------------------------------------------------------------
alter table public.waitlist_offers
  add column if not exists slot_end_time time;

update public.waitlist_offers set slot_end_time = end_time where slot_end_time is null;

-- -------------------------------------------------------------
-- 4. A vaga guardada fica realmente reservada
--
-- Enquanto está guardada com alguém, ela some da grade pública.
-- -------------------------------------------------------------
create or replace function public.get_busy_slots(dia date, prof uuid)
returns table (start_time time, end_time time)
language sql
stable
security definer set search_path = public
as $$
  select a.start_time, a.end_time
  from public.appointments a
  where a.date = dia
    and a.professional_id = prof
    and a.status not in ('cancelado', 'faltou')
  union all
  select o.start_time, o.end_time
  from public.waitlist_offers o
  join public.waitlist_entries e on e.id = o.entry_id
  where o.date = dia
    and e.professional_id = prof
    and o.status = 'pendente'
    and o.expires_at > now();
$$;

grant execute on function public.get_busy_slots(date, uuid) to anon, authenticated;

-- -------------------------------------------------------------
-- 5. Oferta de vaga: por PESSOA, não por entrada da fila
-- -------------------------------------------------------------
create or replace function public.ofertar_vaga(
  prof uuid,
  dia date,
  inicio time,
  fim time
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  entrada public.waitlist_entries%rowtype;
  cfg public.professionals%rowtype;
  duracao_servico integer;
  agora timestamp := public.agora_local();
  oferta_id uuid;
  serv_nome text;
begin
  select * into cfg from public.professionals where id = prof;
  if not found then
    return null;
  end if;

  if (dia + inicio) < agora + make_interval(mins => cfg.waitlist_min_notice_minutes) then
    return null;
  end if;

  if exists (
    select 1 from public.appointments a
    where a.professional_id = prof and a.date = dia
      and a.status not in ('cancelado', 'faltou')
      and inicio < a.end_time and fim > a.start_time
  ) then
    return null;
  end if;

  -- alguém já está com esta vaga guardada
  if exists (
    select 1 from public.waitlist_offers o
    join public.waitlist_entries e on e.id = o.entry_id
    where e.professional_id = prof and o.date = dia
      and o.status = 'pendente' and o.expires_at > now()
      and inicio < o.end_time and fim > o.start_time
  ) then
    return null;
  end if;

  select e.* into entrada
  from public.waitlist_entries e
  join public.services s on s.id = e.service_id
  where e.professional_id = prof
    and e.status = 'aguardando'
    and dia between e.date_from and e.date_to
    and inicio >= e.window_start
    and (inicio + make_interval(mins => s.duration_minutes)) <= e.window_end
    and (inicio + make_interval(mins => s.duration_minutes)) <= fim
    -- a mesma PESSOA não recebe a mesma vaga duas vezes
    and not exists (
      select 1 from public.waitlist_offers o
      join public.waitlist_entries e2 on e2.id = o.entry_id
      where e2.client_id = e.client_id and o.date = dia and o.start_time = inicio
    )
    -- nem tem duas ofertas abertas ao mesmo tempo
    and not exists (
      select 1 from public.waitlist_offers o
      join public.waitlist_entries e3 on e3.id = o.entry_id
      where e3.client_id = e.client_id
        and o.status = 'pendente' and o.expires_at > now()
    )
  order by e.created_at
  limit 1;

  if not found then
    return null;
  end if;

  select duration_minutes, name into duracao_servico, serv_nome
  from public.services where id = entrada.service_id;

  insert into public.waitlist_offers
    (entry_id, date, start_time, end_time, slot_end_time, expires_at)
  values (
    entrada.id, dia, inicio,
    (inicio + make_interval(mins => duracao_servico))::time,
    fim,
    least(
      now() + make_interval(mins => cfg.waitlist_hold_minutes),
      now() + greatest(interval '1 minute', (dia + inicio) - agora - interval '5 minutes')
    )
  )
  returning id into oferta_id;

  perform public.notificar(
    entrada.client_id,
    'vaga_disponivel',
    'Abriu uma vaga! 🎉',
    format('%s tem %s livre dia %s às %s. A vaga fica guardada para você por %s minutos.',
           cfg.name, coalesce(serv_nome, 'o serviço'),
           to_char(dia, 'DD/MM'), to_char(inicio, 'HH24:MI'),
           cfg.waitlist_hold_minutes),
    '/',
    jsonb_build_object('offer_id', oferta_id, 'entry_id', entrada.id),
    now() + make_interval(mins => cfg.waitlist_hold_minutes)
  );

  return oferta_id;
end;
$$;

revoke execute on function public.ofertar_vaga(uuid, date, time, time)
  from public, anon, authenticated;

-- -------------------------------------------------------------
-- 6. Recusar / sair da fila devolve a JANELA INTEIRA para a próxima
-- -------------------------------------------------------------
create or replace function public.responder_vaga(oferta_id uuid, aceitar boolean)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  oferta public.waitlist_offers%rowtype;
  entrada public.waitlist_entries%rowtype;
  prof_user uuid;
  cliente_nome text;
  janela_fim time;
  agora timestamp := public.agora_local();
begin
  select * into oferta from public.waitlist_offers where id = oferta_id;
  if not found then
    raise exception 'Oferta não encontrada';
  end if;

  select * into entrada from public.waitlist_entries where id = oferta.entry_id;

  if entrada.client_id <> auth.uid() then
    raise exception 'Esta vaga não é sua';
  end if;

  if oferta.status <> 'pendente' then
    raise exception 'Esta vaga já foi respondida';
  end if;

  janela_fim := coalesce(oferta.slot_end_time, oferta.end_time);

  if oferta.expires_at <= now() or (oferta.date + oferta.start_time) <= agora then
    update public.waitlist_offers set status = 'expirada' where id = oferta_id;
    perform public.ofertar_vaga(entrada.professional_id, oferta.date, oferta.start_time, janela_fim);
    return 'expirada';
  end if;

  if not aceitar then
    update public.waitlist_offers set status = 'recusada' where id = oferta_id;
    perform public.ofertar_vaga(entrada.professional_id, oferta.date, oferta.start_time, janela_fim);
    return 'recusada';
  end if;

  if exists (
    select 1 from public.appointments a
    where a.professional_id = entrada.professional_id and a.date = oferta.date
      and a.status not in ('cancelado', 'faltou')
      and oferta.start_time < a.end_time and oferta.end_time > a.start_time
  ) then
    update public.waitlist_offers set status = 'expirada' where id = oferta_id;
    return 'conflito';
  end if;

  insert into public.appointments
    (client_id, professional_id, service_id, date, start_time, end_time, status)
  values
    (entrada.client_id, entrada.professional_id, entrada.service_id,
     oferta.date, oferta.start_time, oferta.end_time, 'confirmado');

  update public.waitlist_offers set status = 'aceita' where id = oferta_id;
  update public.waitlist_entries set status = 'convertida' where id = entrada.id;

  select user_id into prof_user from public.professionals where id = entrada.professional_id;
  select full_name into cliente_nome from public.profiles where id = entrada.client_id;

  if prof_user is not null then
    perform public.notificar(
      prof_user, 'novo_agendamento', 'Vaga preenchida pela lista de espera 🎉',
      format('%s pegou o horário de %s às %s.',
             coalesce(cliente_nome, 'Uma cliente'),
             to_char(oferta.date, 'DD/MM'), to_char(oferta.start_time, 'HH24:MI')),
      '/pro', jsonb_build_object('date', oferta.date), null
    );
  end if;

  return 'aceita';
end;
$$;

create or replace function public.sair_lista_espera(entrada_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  entrada public.waitlist_entries%rowtype;
  o record;
begin
  select * into entrada from public.waitlist_entries where id = entrada_id;
  if not found or entrada.client_id <> auth.uid() then
    raise exception 'Esta fila não é sua';
  end if;

  update public.waitlist_entries
  set status = 'cancelada'
  where id = entrada_id and status = 'aguardando';

  -- se ela estava segurando uma vaga, a vaga vai para a próxima
  for o in
    select id, date, start_time, coalesce(slot_end_time, end_time) as janela_fim
    from public.waitlist_offers
    where entry_id = entrada_id and status = 'pendente'
  loop
    update public.waitlist_offers set status = 'recusada' where id = o.id;
    perform public.ofertar_vaga(entrada.professional_id, o.date, o.start_time, o.janela_fim);
  end loop;
end;
$$;

create or replace function public.avancar_ofertas_expiradas()
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  o record;
  n integer := 0;
begin
  for o in
    select wo.id, wo.date, wo.start_time,
           coalesce(wo.slot_end_time, wo.end_time) as janela_fim,
           we.professional_id
    from public.waitlist_offers wo
    join public.waitlist_entries we on we.id = wo.entry_id
    where wo.status = 'pendente' and wo.expires_at <= now()
    limit 50
  loop
    update public.waitlist_offers set status = 'expirada' where id = o.id;
    perform public.ofertar_vaga(o.professional_id, o.date, o.start_time, o.janela_fim);
    n := n + 1;
  end loop;

  update public.waitlist_entries
  set status = 'expirada'
  where status = 'aguardando' and date_to < public.agora_local()::date;

  return n;
end;
$$;

-- -------------------------------------------------------------
-- 7. A profissional enxerga quem está na fila dela
-- -------------------------------------------------------------
drop policy if exists "profissional ve quem espera" on public.profiles;
create policy "profissional ve quem espera"
  on public.profiles for select
  to authenticated
  using (
    exists (
      select 1 from public.waitlist_entries w
      where w.client_id = profiles.id
        and w.status = 'aguardando'
        and public.is_professional(w.professional_id)
    )
  );

-- -------------------------------------------------------------
-- 8. Saldo nunca fica negativo
--
-- O crédito ganho expira, mas o uso não: quando o lançamento
-- original vencia, a cliente ficava com saldo negativo eterno.
-- -------------------------------------------------------------
create or replace function public.saldo_creditos(cliente uuid default auth.uid())
returns integer
language plpgsql
stable
security definer set search_path = public
as $$
begin
  if cliente is null then
    return 0;
  end if;
  if not (
    cliente = auth.uid()
    or public.is_admin()
    or public.atende_esta_cliente(cliente)
  ) then
    raise exception 'Sem permissão para ver este saldo';
  end if;

  return greatest(0, (
    select coalesce(sum(amount_cents), 0)::integer
    from public.credit_transactions
    where client_id = cliente
      and (expires_at is null or expires_at > now())
  ));
end;
$$;

grant execute on function public.saldo_creditos(uuid) to authenticated;

-- -------------------------------------------------------------
-- 9. Crédito de indicação: uma vez só, mês local, e o bônus da
--    indicada não morre por causa do teto de quem indicou
-- -------------------------------------------------------------
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

  -- concluir é ato da profissional ou do salão
  if not (public.is_admin() or public.is_professional(new.professional_id)) then
    return new;
  end if;

  select * into cfg from public.referral_settings where id;
  if not cfg.ativo then
    return new;
  end if;

  -- trava atômica: quem pegar a linha 'pendente' primeiro é quem credita
  update public.referrals
  set status = 'creditada', credited_at = now(), appointment_id = new.id
  where referred_id = new.client_id and status = 'pendente'
  returning * into ind;

  if not found then
    return new;
  end if;

  -- precisa ser o PRIMEIRO atendimento concluído dela
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

  -- teto mensal de quem indica, no mês local
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

  -- o bônus da indicada vale mesmo se quem indicou bateu o teto
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
    update public.referrals
    set motivo_bloqueio = 'teto mensal de quem indicou'
    where id = ind.id;
  end if;

  return new;
end;
$$;

revoke execute on function public.creditar_indicacao_se_couber()
  from public, anon, authenticated;

-- -------------------------------------------------------------
-- 10. Tolerância de falta vem da configuração da profissional
-- -------------------------------------------------------------
create or replace function public.config_agenda_profissional(prof uuid)
returns table (
  no_show_tolerance_minutes integer,
  waitlist_hold_minutes integer,
  waitlist_min_notice_minutes integer,
  agora timestamp
)
language sql
stable
security definer set search_path = public
as $$
  select p.no_show_tolerance_minutes,
         p.waitlist_hold_minutes,
         p.waitlist_min_notice_minutes,
         public.agora_local()
  from public.professionals p
  where p.id = prof;
$$;

grant execute on function public.config_agenda_profissional(uuid) to authenticated;
