-- 081 · Visitas: serviços que vão juntos, com profissionais diferentes
--
-- 1. "Costuma ir junto": no cadastro do serviço, o salão (ou a
--    autônoma) marca quais outros serviços fazem sentido oferecer com
--    ele. Não é combo: é sugestão, e vale entre profissionais.
-- 2. Visita: a cliente marca cabelo com a Ana e o app oferece a
--    manicure da Camila LOGO DEPOIS (quando o cabelo acaba) ou, se ela
--    aceitar esperar, mais tarde no mesmo dia. Nasce um agendamento em
--    cada agenda, ligados por visita_id. Cada profissional decide o
--    seu; nada é paralelo, nada é automático.
-- 3. Recusa derruba só a parte recusada e não confirma nada sozinha: a
--    cliente decide (outro dia ou só o que ficou); a outra profissional
--    sabe que está aguardando a cliente.
--
--   servicos_juntos                          a sugestão (service_id → sugerido_id)
--   salvar_servicos_juntos(service, [ids])   quem cuida do serviço configura
--   servicos_sugeridos_para([ids])           o que vai junto com o que ela escolheu
--   cabe_no_horario(prof, dia, hora, min)    encaixe exato (sem grade)
--   sugestoes_de_visita(prof, [ids], dia, hora, com_espera)   as ofertas de outras profissionais
--   marcar_visita(partes, obs)               cria as partes e avisa uma vez
--   appointments.visita_id

create table if not exists public.servicos_juntos (
  service_id uuid not null references public.services (id) on delete cascade,
  sugerido_id uuid not null references public.services (id) on delete cascade,
  primary key (service_id, sugerido_id),
  check (service_id <> sugerido_id)
);
alter table public.servicos_juntos enable row level security;
drop policy if exists "sugestoes sao publicas" on public.servicos_juntos;
create policy "sugestoes sao publicas" on public.servicos_juntos for select to anon, authenticated using (true);
revoke insert, update, delete on public.servicos_juntos from anon, authenticated;

alter table public.appointments add column if not exists visita_id uuid;
create index if not exists appointments_visita_idx on public.appointments (visita_id) where visita_id is not null;

-- quem cuida do serviço: a dona/admins do salão dele, ou a profissional que o faz
create or replace function public.cuida_do_servico(servico uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (select 1 from public.services s where s.id = servico and public.is_admin_do_salao(s.salon_id))
      or exists (select 1 from public.professional_services ps join public.professionals p on p.id = ps.professional_id
                  where ps.service_id = servico and p.user_id = auth.uid());
$$;
revoke execute on function public.cuida_do_servico(uuid) from public, anon, authenticated;

create or replace function public.salvar_servicos_juntos(servico uuid, sugeridos uuid[])
returns void
language plpgsql
security definer set search_path = public
as $$
declare sal uuid;
begin
  if not public.cuida_do_servico(servico) then raise exception 'Sem permissão.'; end if;
  select salon_id into sal from public.services where id = servico;
  delete from public.servicos_juntos where service_id = servico;
  insert into public.servicos_juntos (service_id, sugerido_id)
  select servico, s.id from public.services s
  where s.id = any (coalesce(sugeridos, '{}')) and s.id <> servico and s.salon_id is not distinct from sal
  on conflict do nothing;
end;
$$;
revoke execute on function public.salvar_servicos_juntos(uuid, uuid[]) from public, anon;
grant execute on function public.salvar_servicos_juntos(uuid, uuid[]) to authenticated;

create or replace function public.servicos_sugeridos_para(servicos uuid[])
returns table (sugerido_id uuid)
language sql
stable
security definer set search_path = public
as $$
  select distinct j.sugerido_id from public.servicos_juntos j
  join public.services s on s.id = j.sugerido_id and s.active
  where j.service_id = any (coalesce(servicos, '{}')) and not (j.sugerido_id = any (coalesce(servicos, '{}')));
$$;
grant execute on function public.servicos_sugeridos_para(uuid[]) to anon, authenticated;

-- cabe exatamente ali? (expediente, ocupação, e não no passado)
create or replace function public.cabe_no_horario(prof uuid, dia date, hora time, duracao integer)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.professional_hours h
    where h.professional_id = prof and h.weekday = extract(dow from dia) and h.open
      and hora >= h.start_time and (hora + make_interval(mins => duracao))::time <= h.end_time
      and (hora::interval + make_interval(mins => duracao)) < interval '24 hours'
  )
  and not exists (
    select 1 from public.get_busy_slots(dia, prof) o
    where hora < o.end_time and (hora + make_interval(mins => duracao))::time > o.start_time
  )
  and (dia + hora) > public.agora_local();
$$;
grant execute on function public.cabe_no_horario(uuid, date, time, integer) to anon, authenticated;

-- o que outras profissionais do mesmo salão podem fazer na sequência
-- apos: quando a cliente já emendou outra parte, a próxima só pode começar depois dela
drop function if exists public.sugestoes_de_visita(uuid, uuid[], date, time, boolean);
create or replace function public.sugestoes_de_visita(prof uuid, servicos uuid[], dia date, hora time, com_espera boolean default false, apos time default null)
returns table (
  service_id uuid, service_name text, price numeric, duration_minutes integer,
  professional_id uuid, professional_name text, photo_url text,
  hora_sugerida time, modo text
)
language plpgsql
stable
security definer set search_path = public
as $$
declare sal uuid; total integer; fim time;
begin
  select p.salon_id into sal from public.professionals p where p.id = prof;
  if sal is null then return; end if;
  select coalesce(sum(s.duration_minutes), 0) into total from public.services s where s.id = any (coalesce(servicos, '{}'));
  if total <= 0 then return; end if;
  fim := (hora + make_interval(mins => total))::time;
  if apos is not null and apos > fim then fim := apos; end if;

  return query
  with sugeridos as (
    select distinct j.sugerido_id from public.servicos_juntos j
    where j.service_id = any (coalesce(servicos, '{}')) and not (j.sugerido_id = any (coalesce(servicos, '{}')))
  ),
  candidatos as (
    select s.id as sid, s.name as sname, s.price as sprice, s.duration_minutes as sdur,
           p.id as pid, p.name as pname, p.photo_url as pfoto
    from sugeridos g
    join public.services s on s.id = g.sugerido_id and s.active and s.salon_id = sal
    join public.professional_services ps on ps.service_id = s.id
    join public.professionals p on p.id = ps.professional_id and p.active and p.salon_id = sal and p.id <> prof
  ),
  encaixes as (
    select c.*,
           case when public.cabe_no_horario(c.pid, dia, fim, c.sdur) then fim end as logo_depois,
           case when com_espera then (select min(h.hora) from public.horarios_livres(c.pid, dia, c.sdur) h where h.hora >= fim) end as depois
    from candidatos c
  )
  select e.sid, e.sname, e.sprice, e.sdur, e.pid, e.pname, e.pfoto,
         coalesce(e.logo_depois, e.depois),
         case when e.logo_depois is not null then 'logo_depois' else 'com_espera' end
  from encaixes e
  where coalesce(e.logo_depois, e.depois) is not null
  order by (e.logo_depois is null), coalesce(e.logo_depois, e.depois), e.sname, e.pname;
end;
$$;
grant execute on function public.sugestoes_de_visita(uuid, uuid[], date, time, boolean, time) to anon, authenticated;

-- a visita: partes = [{"prof": uuid, "servicos": [uuid], "hora": "HH:MM"}], todas no mesmo dia
create or replace function public.marcar_visita(dia date, partes jsonb, obs text default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  eu uuid := auth.uid();
  parte jsonb; r jsonb; ids uuid[] := '{}'; visita uuid := gen_random_uuid(); i integer := 0;
  sids uuid[]; primeira uuid; a record; todas_confirmadas boolean; resumo text := ''; res record; nomeprof text;
begin
  if eu is null then raise exception 'Entre na sua conta para marcar.'; end if;
  if partes is null or jsonb_typeof(partes) <> 'array' or jsonb_array_length(partes) = 0 then raise exception 'Nada para marcar.'; end if;
  if jsonb_array_length(partes) > 4 then raise exception 'No máximo 4 partes numa visita.'; end if;

  for parte in select * from jsonb_array_elements(partes) loop
    i := i + 1;
    select array_agg(x::uuid) into sids from jsonb_array_elements_text(parte -> 'servicos') x;
    r := public.marcar_servicos((parte ->> 'prof')::uuid, sids, dia, (parte ->> 'hora')::time, case when i = 1 then obs end);
    if not coalesce((r ->> 'ok')::boolean, false) then
      raise exception 'ocupado:%', i;      -- desfaz a visita inteira
    end if;
    ids := array_append(ids, (r ->> 'appointment_id')::uuid);
  end loop;

  update public.appointments set visita_id = visita where id = any (ids);
  primeira := ids[1];

  -- um aviso só para a cliente, com todas as partes
  select bool_and(status = 'confirmado') into todas_confirmadas from public.appointments where id = any (ids);
  for a in select ap.* from public.appointments ap where ap.id = any (ids) order by ap.start_time loop
    select p.name into nomeprof from public.professionals p where p.id = a.professional_id;
    resumo := resumo || case when resumo = '' then '' else ' · ' end
              || coalesce(a.service_name, 'atendimento') || ' com ' || coalesce(nomeprof, 'a profissional') || ' às ' || to_char(a.start_time, 'HH24:MI');
  end loop;
  if todas_confirmadas then
    perform public.notificar(eu, 'agendamento_confirmado', 'Visita confirmada! 🎉',
      public.dia_por_extenso(dia) || ': ' || resumo || '.',
      '/cliente/agendamento/' || primeira::text, jsonb_build_object('appointment_id', primeira, 'visita_id', visita));
  else
    perform public.notificar(eu, 'pedido_enviado', 'Pedido enviado! ⏳',
      public.dia_por_extenso(dia) || ': ' || resumo || '. Cada profissional confirma a parte dela.',
      '/cliente/agendamento/' || primeira::text, jsonb_build_object('appointment_id', primeira, 'visita_id', visita));
  end if;

  return jsonb_build_object('ok', true, 'appointment_id', primeira, 'visita_id', visita, 'partes', ids, 'confirmada', todas_confirmadas);
end;
$$;
revoke execute on function public.marcar_visita(date, jsonb, text) from public, anon;
grant execute on function public.marcar_visita(date, jsonb, text) to authenticated;

-- as outras partes da visita de um agendamento (para a página da cliente)
create or replace function public.partes_da_visita(appt uuid)
returns table (appointment_id uuid, servico text, profissional text, professional_id uuid, photo_url text, inicio time, fim time, status text, price_cents integer)
language sql
stable
security definer set search_path = public
as $$
  select o.id, coalesce(o.service_name, 'atendimento'), p.name, p.id, p.photo_url, o.start_time, o.end_time, o.status, o.price_cents
  from public.appointments a
  join public.appointments o on o.visita_id = a.visita_id and o.id <> a.id
  join public.professionals p on p.id = o.professional_id
  where a.id = appt and a.visita_id is not null
    and (a.client_id = auth.uid() or public.is_professional(a.professional_id) or public.is_admin_do_salao(a.salon_id) or public.eh_plataforma())
  order by o.start_time;
$$;
revoke execute on function public.partes_da_visita(uuid) from public, anon;
grant execute on function public.partes_da_visita(uuid) to authenticated;

-- ---- o gatilho do insert não avisa a cliente parte por parte -------------
create or replace function public.avisa_profissional_do_agendamento()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  conta uuid;
  manual boolean;
  por_historico boolean;
  eh_dona boolean;
  r jsonb;
  pediu boolean := false;
  res record;
  o public.appointments%rowtype;
  pagina text;
  nome_cli text;
begin
  if new.status = 'cancelado' then
    return new;
  end if;

  select p.user_id, p.aceite_manual, coalesce(p.confirmar_historico_ruim, true) into conta, manual, por_historico
  from public.professionals p where p.id = new.professional_id;

  if conta is null then
    return new;
  end if;

  if conta = new.client_id or conta = auth.uid() then
    return new;
  end if;

  eh_dona := public.is_admin_do_salao(new.salon_id);
  por_historico := por_historico and not coalesce(manual, false)
                   and new.client_id is not null and public.historico_ruim_comigo(new.client_id, new.professional_id);

  if (coalesce(manual, false) or por_historico) and not eh_dona and new.status = 'pendente' then
    r := public.pedir_aceite(new.id, por_historico);
    if coalesce((r ->> 'ok')::boolean, false) then
      pediu := true;
    else
      update public.appointments set status = 'confirmado' where id = new.id;
    end if;
  elsif new.status = 'pendente' then
    update public.appointments set status = 'confirmado' where id = new.id;
  end if;

  if not pediu then
    select * into res from public.resumo_do_agendamento(new.id);
    select nullif(btrim(full_name), '') into nome_cli from public.profiles where id = new.client_id;
    if new.remarca_de is not null then
      select * into o from public.appointments where id = new.remarca_de;
      perform public.notificar(
        conta, 'novo_agendamento', coalesce(nome_cli, 'Uma cliente') || ' remarcou',
        res.servico || ' agora é ' || res.quando_longo
          || coalesce(' (era ' || public.dia_por_extenso(o.date) || ' às ' || to_char(o.start_time, 'HH24:MI') || ')', '') || '.',
        '/pro', jsonb_build_object('appointment_id', new.id, 'professional_id', new.professional_id, 'remarcacao', true));
    else
      perform public.notificar(
        conta, 'novo_agendamento', 'Horário novo na sua agenda',
        coalesce(nome_cli || ' · ', '') || res.servico || ', ' || res.quando_longo || '.',
        '/pro', jsonb_build_object('appointment_id', new.id, 'professional_id', new.professional_id));
    end if;
  end if;

  -- a cliente é avisada aqui só fora de visita (a visita avisa uma vez, no fim)
  if new.client_id is not null and new.client_id = auth.uid() and new.remarca_de is null then
    -- visita_id ainda é nulo dentro do marcar_visita (ele preenche depois);
    -- por isso o marcar_servicos avisa 'visita' via variável de sessão
    if coalesce(current_setting('agenda_mel.em_visita', true), '') = '1' then
      return new;
    end if;
    select * into res from public.resumo_do_agendamento(new.id);
    pagina := '/cliente/agendamento/' || new.id::text;
    if pediu then
      perform public.notificar(new.client_id, 'pedido_enviado', 'Pedido enviado! ⏳',
        res.servico || ' com ' || res.profissional || ', ' || res.quando_longo || '. Aguardando a confirmação da profissional.',
        pagina, jsonb_build_object('appointment_id', new.id, 'professional_id', new.professional_id));
    else
      perform public.notificar(new.client_id, 'agendamento_confirmado', 'Agendamento confirmado! 🎉',
        res.servico || ' com ' || res.profissional || ', ' || res.quando_longo || '.',
        pagina, jsonb_build_object('appointment_id', new.id, 'professional_id', new.professional_id));
    end if;
  end if;
  return new;
end;
$$;

-- marcar_visita liga a flag antes das partes
create or replace function public.marcar_visita(dia date, partes jsonb, obs text default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  eu uuid := auth.uid();
  parte jsonb; r jsonb; ids uuid[] := '{}'; visita uuid := gen_random_uuid(); i integer := 0;
  sids uuid[]; primeira uuid; a record; todas_confirmadas boolean; resumo text := ''; nomeprof text;
begin
  if eu is null then raise exception 'Entre na sua conta para marcar.'; end if;
  if partes is null or jsonb_typeof(partes) <> 'array' or jsonb_array_length(partes) = 0 then raise exception 'Nada para marcar.'; end if;
  if jsonb_array_length(partes) > 4 then raise exception 'No máximo 4 partes numa visita.'; end if;

  perform set_config('agenda_mel.em_visita', '1', true);
  for parte in select * from jsonb_array_elements(partes) loop
    i := i + 1;
    select array_agg(x::uuid) into sids from jsonb_array_elements_text(parte -> 'servicos') x;
    r := public.marcar_servicos((parte ->> 'prof')::uuid, sids, dia, (parte ->> 'hora')::time, case when i = 1 then obs end);
    if not coalesce((r ->> 'ok')::boolean, false) then
      raise exception 'ocupado:%', i;
    end if;
    ids := array_append(ids, (r ->> 'appointment_id')::uuid);
  end loop;
  perform set_config('agenda_mel.em_visita', '', true);

  update public.appointments set visita_id = visita where id = any (ids);
  primeira := ids[1];

  select bool_and(status = 'confirmado') into todas_confirmadas from public.appointments where id = any (ids);
  for a in select ap.* from public.appointments ap where ap.id = any (ids) order by ap.start_time loop
    select p.name into nomeprof from public.professionals p where p.id = a.professional_id;
    resumo := resumo || case when resumo = '' then '' else ' · ' end
              || coalesce(a.service_name, 'atendimento') || ' com ' || coalesce(nomeprof, 'a profissional') || ' às ' || to_char(a.start_time, 'HH24:MI');
  end loop;
  if todas_confirmadas then
    perform public.notificar(eu, 'agendamento_confirmado', 'Visita confirmada! 🎉',
      public.dia_por_extenso(dia) || ': ' || resumo || '.',
      '/cliente/agendamento/' || primeira::text, jsonb_build_object('appointment_id', primeira, 'visita_id', visita));
  else
    perform public.notificar(eu, 'pedido_enviado', 'Pedido enviado! ⏳',
      public.dia_por_extenso(dia) || ': ' || resumo || '. Cada profissional confirma a parte dela.',
      '/cliente/agendamento/' || primeira::text, jsonb_build_object('appointment_id', primeira, 'visita_id', visita));
  end if;

  return jsonb_build_object('ok', true, 'appointment_id', primeira, 'visita_id', visita, 'partes', to_jsonb(ids), 'confirmada', todas_confirmadas);
end;
$$;

-- ---- recusa de uma parte: a cliente decide, a outra profissional sabe ----
create or replace function public.avisar_parte_recusada(appt uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare a public.appointments%rowtype; o record; res record; nome_cli text; nome_b text; nome_a text; outras text := ''; conta_a uuid; primeira uuid;
begin
  select * into a from public.appointments where id = appt;
  if a.visita_id is null or a.client_id is null then return; end if;
  select * into res from public.resumo_do_agendamento(appt);
  select nullif(btrim(full_name), '') into nome_cli from public.profiles where id = a.client_id;
  nome_b := res.profissional;
  for o in
    select x.*, p.name as pnome, p.user_id as pconta from public.appointments x join public.professionals p on p.id = x.professional_id
    where x.visita_id = a.visita_id and x.id <> appt and x.status in ('pendente', 'confirmado') order by x.start_time
  loop
    outras := outras || case when outras = '' then '' else ' · ' end
              || coalesce(o.service_name, 'atendimento') || ' com ' || o.pnome || ' às ' || to_char(o.start_time, 'HH24:MI')
              || case when o.status = 'confirmado' then ' (confirmado)' else ' (aguardando)' end;
    if primeira is null then primeira := o.id; end if;
    if o.pconta is not null then
      perform public.notificar(o.pconta, 'visita_em_espera', nome_b || ' recusou uma parte da visita',
        coalesce(nome_cli, 'A cliente') || ' tinha ' || res.servico || ' com ' || nome_b || ' na mesma visita, e ' || nome_b || ' não pôde. '
          || coalesce(o.service_name, 'O atendimento') || ' com você está mantido; a cliente vai decidir se mantém ou marca outro dia.',
        '/pro/agenda?dia=' || a.date::text, jsonb_build_object('appointment_id', o.id, 'professional_id', o.professional_id, 'visita_id', a.visita_id));
    end if;
  end loop;
  if outras = '' then
    -- era a única parte que restava: vira a recusa comum
    perform public.notificar(a.client_id, 'pedido_recusado', 'Horário não confirmado',
      nome_b || ' não pôde atender ' || res.quando_longo || '. Escolha outro horário.',
      '/cliente/agendamento/' || appt::text, jsonb_build_object('appointment_id', appt, 'professional_id', a.professional_id));
    return;
  end if;
  perform public.notificar(a.client_id, 'parte_recusada', nome_b || ' não pôde fazer ' || res.servico,
    'Na sua visita de ' || public.dia_por_extenso(a.date) || ', ' || res.servico || ' com ' || nome_b || ' às ' || to_char(a.start_time, 'HH24:MI')
      || ' não deu. O resto continua: ' || outras || '. Quer marcar ' || res.servico || ' em outro dia, ou deixar só o que ficou?',
    '/cliente/agendamento/' || coalesce(primeira, appt)::text,
    jsonb_build_object('appointment_id', coalesce(primeira, appt), 'visita_id', a.visita_id, 'recusado', appt, 'service_id', a.service_id, 'professional_id', a.professional_id));
end;
$$;
revoke execute on function public.avisar_parte_recusada(uuid) from public, anon, authenticated;

create or replace function public.resolver_aceite(appt uuid, aceitou boolean)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  ac public.aceites%rowtype;
  a public.appointments%rowtype;
  cliente uuid;
  aviso uuid;
  saiu boolean := false;
  troca boolean;
  res record;
  pagina text;
begin
  select * into ac from public.aceites
  where appointment_id = appt and resultado is null;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'pedido já resolvido');
  end if;

  select * into a from public.appointments where id = appt;

  if a.status <> 'pendente' then
    update public.aceites
    set resultado = 'desistiu', resolvido_em = now()
    where appointment_id = appt;
    return jsonb_build_object('ok', false, 'motivo', 'a cliente já cancelou esse pedido');
  end if;

  cliente := a.client_id;
  troca := a.remarca_de is not null;
  select * into res from public.resumo_do_agendamento(appt);
  pagina := '/cliente/agendamento/' || appt::text;

  perform public.silenciar_gatilho();

  if aceitou then
    update public.appointments set status = 'confirmado'
    where id = appt and status = 'pendente';
    if troca then
      perform public.efetivar_remarcacao(appt);
      aviso := public.notificar(cliente, 'remarcacao_aceita', 'Remarcado! 🎉',
        res.servico || ' com ' || res.profissional || ' agora é ' || res.quando_longo || '.',
        pagina, jsonb_build_object('appointment_id', appt, 'professional_id', ac.professional_id));
    elsif a.visita_id is not null then
      aviso := public.notificar(cliente, 'pedido_aceito', res.profissional || ' confirmou ' || res.servico,
        res.quando_longo || '. ' || case when exists (select 1 from public.appointments x where x.visita_id = a.visita_id and x.id <> appt and x.status = 'pendente')
                                        then 'Falta a outra profissional confirmar a parte dela.' else 'Sua visita está completa. 🎉' end,
        pagina, jsonb_build_object('appointment_id', appt, 'professional_id', ac.professional_id, 'visita_id', a.visita_id));
    else
      aviso := public.notificar(cliente, 'pedido_aceito', 'Agendamento confirmado! 🎉',
        res.servico || ' com ' || res.profissional || ', ' || res.quando_longo || '.',
        pagina, jsonb_build_object('appointment_id', appt, 'professional_id', ac.professional_id));
    end if;
  else
    update public.appointments set status = 'cancelado' where id = appt;
    if troca then
      aviso := public.notificar(cliente, 'remarcacao_recusada', 'Não deu para remarcar',
        'Seu horário de antes continua valendo. Se quiser, tente outra data.',
        '/cliente/meus-agendamentos',
        jsonb_build_object('appointment_id', appt, 'professional_id', ac.professional_id));
    elsif a.visita_id is not null then
      perform public.avisar_parte_recusada(appt);
    else
      aviso := public.notificar(cliente, 'pedido_recusado', 'Horário não confirmado',
        res.profissional || ' não pôde atender ' || res.quando_longo || '. Escolha outro horário.',
        pagina, jsonb_build_object('appointment_id', appt, 'professional_id', ac.professional_id));
    end if;
  end if;

  select exists (
    select 1 from public.message_outbox
    where notification_id = aviso and status <> 'cancelado'
  ) into saiu;

  update public.aceites
  set resultado = case when aceitou then 'aceito' else 'recusado' end,
      resolvido_em = now()
  where appointment_id = appt;

  return jsonb_build_object('ok', true,
    'resultado', case when aceitou then 'aceito' else 'recusado' end,
    'remarcacao', troca,
    'avisou_cliente', saiu);
end;
$$;
revoke execute on function public.resolver_aceite(uuid, boolean) from public, anon, authenticated;

-- ---- modelos de push dos tipos novos ---------------------------------------
insert into public.modelos_de_mensagem (chave, grupo, titulo, descricao, variaveis, padrao, ordem, exemplo) values
('push.parte_recusada', 'push', 'Uma parte da visita não deu', 'Uma das profissionais recusou a parte dela; a cliente decide o resto.', '{titulo,texto,nome,servico,profissional,quando}', E'{titulo}\n{texto}', 716,
  '{"titulo":"Camila não pôde fazer Manicure","texto":"Na sua visita de sábado 12/09, Manicure com Camila às 12:00 não deu. O resto continua: Corte com Ana às 10:30 (confirmado). Quer marcar Manicure em outro dia, ou deixar só o que ficou?"}'),
('push.visita_em_espera', 'push', 'Visita aguardando a cliente', 'A outra profissional recusou a parte dela; a sua está mantida.', '{titulo,texto,nome}', E'{titulo}\n{texto}', 812,
  '{"titulo":"Camila recusou uma parte da visita","texto":"Juliana tinha Manicure com Camila na mesma visita, e Camila não pôde. Corte com você está mantido; a cliente vai decidir se mantém ou marca outro dia."}')
on conflict (chave) do update set grupo = excluded.grupo, titulo = excluded.titulo, descricao = excluded.descricao,
  variaveis = excluded.variaveis, padrao = excluded.padrao, ordem = excluded.ordem, exemplo = excluded.exemplo;
insert into public.push_regras (kind, envia) values ('parte_recusada', true), ('visita_em_espera', true) on conflict (kind) do nothing;
insert into public.email_regras (kind, envia, chamada) values ('parte_recusada', true, 'Ver minha visita') on conflict (kind) do nothing;

-- ---- a profissional vê, no pedido, o que mais a cliente vai fazer no salão ----
drop function if exists public.meus_pedidos();
create function public.meus_pedidos()
returns table (
  appointment_id uuid, cliente text, servico text, quando text, faltam_min integer,
  remarcacao boolean, antes text,
  atendimentos integer, faltas integer, cancelamentos integer, remarcacoes integer,
  ficha jsonb, por_historico boolean, visita text
)
language sql
stable
security definer set search_path = public
as $$
  select ac.appointment_id,
         coalesce(nullif(btrim(pf.full_name), ''), 'Cliente'),
         coalesce(a.service_name, s.name, 'Atendimento'),
         public.dia_por_extenso(a.date) || ' às ' || to_char(a.start_time, 'HH24:MI'),
         greatest(0, extract(epoch from (ac.expira_em - now()))/60)::integer,
         a.remarca_de is not null,
         case when o.id is not null
              then public.dia_por_extenso(o.date) || ' às ' || to_char(o.start_time, 'HH24:MI') end,
         f.concluidos, f.faltas, f.cancelamentos, f.remarcacoes,
         public.ficha_para_profissional(a.client_id, ac.professional_id),
         (not coalesce(p.aceite_manual, false)) and public.historico_ruim_comigo(a.client_id, ac.professional_id),
         (select string_agg(coalesce(v.service_name, 'atendimento') || ' com ' || vp.name || ' às ' || to_char(v.start_time, 'HH24:MI')
                            || case v.status when 'pendente' then ' (aguardando)' when 'cancelado' then ' (recusado)' else '' end, ' · ' order by v.start_time)
            from public.appointments v join public.professionals vp on vp.id = v.professional_id
            where a.visita_id is not null and v.visita_id = a.visita_id and v.id <> a.id)
  from public.aceites ac
  join public.appointments a on a.id = ac.appointment_id
  join public.professionals p on p.id = ac.professional_id
  left join public.appointments o on o.id = a.remarca_de
  left join public.profiles pf on pf.id = a.client_id
  left join public.services s on s.id = a.service_id
  cross join lateral (
    select count(*) filter (where h.status = 'concluido')::integer as concluidos,
           count(*) filter (where h.status = 'faltou')::integer as faltas,
           count(*) filter (where h.status = 'cancelado' and h.cancelado_por = 'cliente')::integer as cancelamentos,
           count(*) filter (where h.remarca_de is not null and h.id <> a.id)::integer as remarcacoes
    from public.appointments h where h.client_id = a.client_id and h.salon_id = ac.salon_id
  ) f
  where ac.resultado is null
    and (public.is_professional(ac.professional_id)
         or public.is_admin_do_salao(ac.salon_id))
  order by ac.expira_em;
$$;
revoke execute on function public.meus_pedidos() from public, anon;
grant execute on function public.meus_pedidos() to authenticated;
