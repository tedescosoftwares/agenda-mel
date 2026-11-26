-- =============================================================
-- MIMO — 270: quem fica sabendo de quê (4.18)
--
-- O levantamento dos avisos por papel achou lacunas. Esta migração fecha as que a dona do produto escolheu:
--
--  1. Profissional sem conta, fora do modo "a casa confirma": o pedido ficava pendente sem ninguém para aceitar e a
--     cliente não recebia nada. Agora o pedido é da casa (so_a_casa), em qualquer modo: as admins aceitam por ela e
--     a cliente recebe "pedido enviado" (ou "confirmado", quando o horário já entra confirmado).
--  2. No modo "a casa confirma", a dona que é a própria profissional do horário não era avisada do pedido.
--  3. A dona fica sabendo do que a profissional decide: aceitou, recusou, cancelou um horário dela.
--  4. O salão (ou a profissional) marca um horário para a cliente: ela recebe o aviso no app.
--  5. O lembrete de fechar o dia vai para quem dá a baixa (quem_da_baixa): no modo casa, para o salão.
--  6. A profissional recebe à noite o resumo da agenda de amanhã (tipo novo: agenda_de_amanha).
-- =============================================================

-- 1. Sem conta, o pedido é da casa ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pedir_aceite(appt uuid, forcar boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  a public.appointments%rowtype;
  o public.appointments%rowtype;
  p public.professionals%rowtype;
  tel_prof text;
  tel_cli text;
  nome_cli text;
  quando text;
  antes text;
  prazo timestamptz;
  aviso uuid;
  na_fila record;
  titulo text;
  corpo text;
  so_casa boolean;
begin
  select * into a from public.appointments where id = appt;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'sem agendamento'); end if;

  select * into p from public.professionals where id = a.professional_id;
  if not found or (not p.aceite_manual and not forcar) then
    return jsonb_build_object('ok', false, 'motivo', 'aceite desligado');
  end if;
  -- 245: no modo "a casa confirma" o pedido é só da casa: não depende da conta da profissional e não vai para ela
  -- 270: e também quando ela ainda não tem conta, em qualquer modo: alguém do salão responde por ela
  so_casa := coalesce((select s.aceite_modo = 'casa' from public.salons s where s.id = a.salon_id), false) or p.user_id is null;

  select public.telefone_e164(pf.phone) into tel_prof
  from public.profiles pf where pf.id = p.user_id;

  select public.telefone_e164(pf.phone), nullif(btrim(pf.full_name), '')
    into tel_cli, nome_cli
  from public.profiles pf where pf.id = a.client_id;

  prazo := now() + make_interval(mins => coalesce(p.minutos_para_aceitar, 120));
  quando := public.dia_por_extenso(a.date) || ' às ' || to_char(a.start_time, 'HH24:MI');

  -- sem o telefone da profissional no pedido da casa: o "1" dela no WhatsApp não decide o que é da casa
  insert into public.aceites
    (appointment_id, professional_id, salon_id, telefone_prof, telefone_cliente, expira_em, so_a_casa)
  values (appt, p.id, a.salon_id, case when so_casa then '' else coalesce(tel_prof, '') end, coalesce(tel_cli, ''), prazo, so_casa)
  on conflict (appointment_id) do nothing;

  -- a casa é avisada pelo gatilho aceites_avisa_a_casa; a profissional, só depois de confirmado (avisa_profissional_ao_confirmar)
  if so_casa then
    return jsonb_build_object('ok', true, 'expira_em', prazo, 'minutos', p.minutos_para_aceitar, 'so_a_casa', true);
  end if;

  if a.remarca_de is not null then
    select * into o from public.appointments where id = a.remarca_de;
    antes := case when o.id is not null then public.dia_por_extenso(o.date) || ' às ' || to_char(o.start_time, 'HH24:MI') end;
    titulo := 'Pedido de troca de horário';
    corpo := coalesce(nome_cli, 'Uma cliente') || ' quer mudar ' || coalesce(a.service_name, 'o atendimento')
             || coalesce(' de ' || antes, '') || ' para ' || quando;
  else
    titulo := 'Pedido de horário';
    corpo := coalesce(nome_cli, 'Uma cliente') || ' quer ' || coalesce(a.service_name, 'um atendimento') || ' ' || quando;
  end if;
  if forcar then corpo := corpo || '. Passou por você porque ela já faltou ou cancelou com você.'; end if;

  aviso := public.notificar(
    p.user_id, 'pedido_de_aceite', titulo, corpo, '/pro/pedidos',
    jsonb_build_object('appointment_id', appt, 'professional_id', p.id, 'por_historico', forcar, 'remarcacao', a.remarca_de is not null));

  select o2.id, o2.telefone, o2.corpo into na_fila
  from public.message_outbox o2
  where o2.notification_id = aviso and o2.status = 'na_fila'
  limit 1;

  return jsonb_build_object('ok', true, 'expira_em', prazo,
    'minutos', p.minutos_para_aceitar,
    'avisar', case when na_fila.id is not null then
      jsonb_build_object('fila_id', na_fila.id,
                         'telefone', na_fila.telefone,
                         'corpo', na_fila.corpo)
    end);
end;
$function$;

CREATE OR REPLACE FUNCTION public.avisa_profissional_do_agendamento()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  conta uuid;
  manual boolean;
  por_historico boolean;
  eh_dona boolean;
  r jsonb;
  pediu boolean := false;
  res record;
  pagina text;
  pago boolean;
  sit jsonb;
  forcado boolean := false;
  casa boolean;
begin
  if new.status = 'cancelado' then
    return new;
  end if;

  select p.user_id, p.aceite_manual, coalesce(p.confirmar_historico_ruim, true) into conta, manual, por_historico
  from public.professionals p where p.id = new.professional_id;

  -- 245: no modo "a casa confirma" o pedido é da casa, tenha a profissional conta ou não
  casa := coalesce((select s.aceite_modo = 'casa' from public.salons s where s.id = new.salon_id), false);
  -- 270: sem conta e fora do modo casa, o gatilho saía aqui: o pedido ficava pendente sem ninguém para aceitar e a
  -- cliente não recebia nem "pedido enviado" nem "confirmado". Agora segue: o pedido abre para a casa (pedir_aceite)

  if conta = new.client_id or conta = auth.uid() then
    return new;
  end if;

  -- pago pelo app (ou troca de um horário pago): entra confirmado, sem aceite
  pago := coalesce(new.pago_cents, 0) > 0
          or (new.remarca_de is not null and exists (select 1 from public.appointments o where o.id = new.remarca_de and coalesce(o.pago_cents, 0) > 0));
  if pago then
    if conta is null then
      return new;                    -- como antes: sem conta, não há a quem avisar
    end if;
    if new.status = 'pendente' then
      update public.appointments set status = 'confirmado' where id = new.id;
    end if;
    perform public.avisar_horario_pago(new.id, new.remarca_de is not null);
    if new.client_id is not null and new.client_id = auth.uid() and new.remarca_de is null then
      select * into res from public.resumo_do_agendamento(new.id);
      perform public.notificar(new.client_id, 'agendamento_confirmado', 'Agendamento confirmado! 🎉',
        res.servico || ' com ' || res.profissional || ', ' || res.quando_longo || '. Seu crédito entrou como sinal.',
        '/cliente/agendamento/' || new.id::text, jsonb_build_object('appointment_id', new.id, 'professional_id', new.professional_id));
    end if;
    return new;
  end if;

  eh_dona := public.is_admin_do_salao(new.salon_id);
  -- histórico ruim com ELA: o pedido passa pela mão dela mesmo no automático
  por_historico := por_historico and not coalesce(manual, false)
                   and new.client_id is not null and public.historico_ruim_comigo(new.client_id, new.professional_id);

  -- 3.98 (242): as regras do salão para a cliente que marca sozinha (app ou assistente): o primeiro horário de cliente
  -- nova (a casa confirma / só a equipe) e as faltas além do limite viram pedido para a casa confirmar
  if new.client_id is not null and new.client_id = auth.uid() and new.remarca_de is null and new.status = 'pendente' then
    sit := public.situacao_da_cliente(new.salon_id, new.client_id, new.id);
    forcado := coalesce(((sit ->> 'nova')::boolean and sit ->> 'cliente_nova' in ('casa_confirma', 'so_equipe'))
                        or (sit ->> 'faltas')::integer >= (sit ->> 'limite_faltas')::integer, false);
  end if;

  if (coalesce(manual, false) or casa or por_historico or forcado) and not eh_dona and new.status = 'pendente' then
    r := public.pedir_aceite(new.id, por_historico or forcado);
    if coalesce((r ->> 'ok')::boolean, false) then
      pediu := true;
    else
      update public.appointments set status = 'confirmado' where id = new.id;
    end if;
  elsif new.status = 'pendente' then
    update public.appointments set status = 'confirmado' where id = new.id;
  end if;

  -- 245: um aviso só (a regra da 078, que a 095 perdeu): se abriu o pedido para ela, o pedido já avisou; se o pedido é
  -- da casa, ela só fica sabendo depois que a casa confirmar (avisa_profissional_ao_confirmar)
  if conta is not null and not pediu then
    -- 264: o aviso diz o que é (quem, o quê, quando), e quando foi a casa que mudou o horário ele diz isso
    select * into res from public.resumo_do_agendamento(new.id);
    perform public.notificar(
      conta, 'novo_agendamento',
      case when new.remarca_de is not null and eh_dona then 'O salão mudou um horário seu' else 'Horário novo na sua agenda' end,
      public.nome_da_cliente_do_horario(new.id) || ' · ' || coalesce(res.servico, 'atendimento') || ' · ' || coalesce(res.quando_longo, ''),
      '/pro',
      jsonb_build_object('appointment_id', new.id,
                         'professional_id', new.professional_id));
  end if;

  if new.client_id is not null and new.client_id = auth.uid() and new.remarca_de is null then
    select * into res from public.resumo_do_agendamento(new.id);
    pagina := '/cliente/agendamento/' || new.id::text;
    if pediu then
      perform public.notificar(new.client_id, 'pedido_enviado', 'Pedido enviado! ⏳',
        res.servico || ' com ' || res.profissional || ', ' || res.quando_longo || '. ' || coalesce((select nullif(btrim(sx.name), '') from public.salons sx where sx.id = new.salon_id), 'O salão') || ' confirma em breve.',
        pagina, jsonb_build_object('appointment_id', new.id, 'professional_id', new.professional_id));
    else
      perform public.notificar(new.client_id, 'agendamento_confirmado', 'Agendamento confirmado! 🎉',
        res.servico || ' com ' || res.profissional || ', ' || res.quando_longo || '.',
        pagina, jsonb_build_object('appointment_id', new.id, 'professional_id', new.professional_id));
    end if;
  end if;
  return new;
end;
$function$;

-- 2. A casa é avisada do pedido que é dela --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.aceites_avisa_a_casa()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare s public.salons%rowtype; a public.appointments%rowtype; res record; nome_cli text; conta_prof uuid; adm uuid; por_ela boolean;
begin
  select * into s from public.salons where id = new.salon_id;
  select user_id into conta_prof from public.professionals where id = new.professional_id;
  -- no modo 'profissional', a casa só entra quando ela ainda não ativou o acesso
  por_ela := s.aceite_modo <> 'casa' and conta_prof is null;   -- 270: em qualquer modo, não só no 'profissional'
  if s.aceite_modo <> 'casa' and not por_ela and not new.so_a_casa then return new; end if;
  select * into a from public.appointments where id = new.appointment_id;
  select * into res from public.resumo_do_agendamento(new.appointment_id);
  select nullif(btrim(pf.full_name), '') into nome_cli from public.profiles pf where pf.id = a.client_id;
  for adm in select m.user_id from public.salon_members m where m.salon_id = new.salon_id and m.papel = 'admin' loop   -- 270: sem pular a dona que atende: o pedido da casa é dela também
    perform public.notificar(adm, 'pedido_de_aceite',
      case when a.remarca_de is not null then 'Pedido de troca de horário' else 'Pedido de horário' end,
      coalesce(nome_cli, 'Uma cliente') || ' quer ' || coalesce(res.servico, 'um atendimento') || ' com ' || coalesce(res.profissional, 'a equipe') || ', ' || coalesce(res.quando_longo, '') || '. '
        || case when por_ela then coalesce(split_part(res.profissional, ' ', 1), 'Ela') || ' ainda não ativou o acesso: confirme por ela em até ' else 'A casa confirma em até ' end
        || coalesce(greatest(1, round(extract(epoch from (new.expira_em - new.pedido_em)) / 60))::int, s.minutos_para_aceitar) || ' min.',
      '/admin/agenda',
      jsonb_build_object('appointment_id', new.appointment_id, 'professional_id', new.professional_id, 'pela_casa', true));
  end loop;
  return new;
end;
$function$;

-- 3. A dona fica sabendo do que a profissional decide ----------------------------------------------
CREATE OR REPLACE FUNCTION public.avisa_a_outra_ponta()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  quem text; conta_prof uuid; conta_antiga uuid; res record; cli text; adm uuid; ant public.appointments%rowtype; linha text;
begin
  quem := public.quem_age_e(new);
  select user_id into conta_prof from public.professionals where id = new.professional_id;

  if tg_op = 'UPDATE' then
    -- 270: a profissional aceitou um pedido: a dona fica sabendo
    if new.status = 'confirmado' and old.status = 'pendente' and quem = 'profissional' then
      select * into res from public.resumo_do_agendamento(new.id);
      cli := public.nome_da_cliente_do_horario(new.id);
      for adm in select m.user_id from public.salon_members m
                 where m.salon_id = new.salon_id and m.papel = 'admin' and m.user_id is distinct from conta_prof loop
        perform public.notificar(adm, 'novo_agendamento', coalesce(split_part(res.profissional, ' ', 1), 'A profissional') || ' aceitou um pedido',
          cli || ' · ' || coalesce(res.servico, 'atendimento') || ' · ' || coalesce(res.quando_longo, ''), '/admin/agenda',
          jsonb_build_object('appointment_id', new.id, 'professional_id', new.professional_id, 'pela_profissional', true));
      end loop;
      return new;
    end if;
    if new.status <> 'cancelado' or old.status = 'cancelado' or old.status not in ('pendente', 'confirmado') then return new; end if;
    -- a troca de horário avisa pelo horário novo, não pelo antigo que sai
    if new.remarcado_para is not null or new.motivo_cancelamento = 'remarcado_pela_casa' or new.cancelado_por = 'remarcacao' then return new; end if;
    select * into res from public.resumo_do_agendamento(new.id);
    cli := public.nome_da_cliente_do_horario(new.id);
    linha := cli || ' · ' || coalesce(res.servico, 'atendimento') || ' · ' || coalesce(res.quando_longo, '');
    if quem = 'salao' and conta_prof is not null and conta_prof <> auth.uid() then
      -- pedido que era só da casa e caiu antes de confirmar: ela nunca soube dele
      if old.status = 'pendente' and coalesce((select bool_or(x.so_a_casa) from public.aceites x where x.appointment_id = new.id), false) then return new; end if;
      perform public.notificar(conta_prof, 'cancelou_comigo', 'O salão cancelou um horário seu', linha, '/pro',
        jsonb_build_object('appointment_id', new.id, 'professional_id', new.professional_id, 'pela_casa', true));
    elsif quem = 'cliente' and not public.gatilho_silenciado() then
      for adm in select m.user_id from public.salon_members m
                 where m.salon_id = new.salon_id and m.papel = 'admin' and m.user_id is distinct from conta_prof loop
        perform public.notificar(adm, 'cancelou_comigo', 'A cliente cancelou um horário',
          linha || ', com ' || coalesce(res.profissional, 'a equipe'), '/admin/agenda',
          jsonb_build_object('appointment_id', new.id, 'professional_id', new.professional_id));
      end loop;
    elsif quem = 'profissional' then
      -- 270: a profissional recusou um pedido ou cancelou um horário dela: a dona fica sabendo
      for adm in select m.user_id from public.salon_members m
                 where m.salon_id = new.salon_id and m.papel = 'admin' and m.user_id is distinct from conta_prof loop
        perform public.notificar(adm, 'cancelou_comigo',
          coalesce(split_part(res.profissional, ' ', 1), 'A profissional') || case when old.status = 'pendente' then ' recusou um pedido' else ' cancelou um horário' end,
          linha, '/admin/agenda',
          jsonb_build_object('appointment_id', new.id, 'professional_id', new.professional_id, 'pela_profissional', true));
      end loop;
    end if;
    return new;
  end if;

  -- INSERT
  if new.status = 'cancelado' then return new; end if;
  select * into res from public.resumo_do_agendamento(new.id);
  cli := public.nome_da_cliente_do_horario(new.id);
  linha := cli || ' · ' || coalesce(res.servico, 'atendimento') || ' · ' || coalesce(res.quando_longo, '');

  -- a casa passou o horário para outra profissional: a que perdeu fica sabendo
  if new.remarca_de is not null and quem = 'salao' then
    select * into ant from public.appointments where id = new.remarca_de;
    if ant.id is not null and ant.professional_id <> new.professional_id then
      select user_id into conta_antiga from public.professionals where id = ant.professional_id;
      if conta_antiga is not null and conta_antiga <> auth.uid() then
        perform public.notificar(conta_antiga, 'cancelou_comigo', 'O salão passou um horário seu para ' || coalesce(split_part(res.profissional, ' ', 1), 'outra profissional'),
          cli || ' · ' || coalesce(ant.service_name, res.servico, 'atendimento') || ' · ' || public.dia_por_extenso(ant.date) || ' às ' || to_char(ant.start_time, 'HH24:MI'),
          '/pro', jsonb_build_object('appointment_id', ant.id, 'professional_id', ant.professional_id, 'pela_casa', true));
      end if;
    end if;
    return new;
  end if;

  -- a cliente marcou (pelo app ou pela assistente): a dona que não é a profissional do horário fica sabendo.
  -- Se o pedido já foi para a casa confirmar, o pedido é o aviso.
  if quem in ('cliente', 'sistema') then
    if exists (select 1 from public.aceites x join public.salons s on s.id = x.salon_id
               where x.appointment_id = new.id and (s.aceite_modo = 'casa' or conta_prof is null)) then
      return new;
    end if;
    for adm in select m.user_id from public.salon_members m
               where m.salon_id = new.salon_id and m.papel = 'admin' and m.user_id is distinct from conta_prof loop
      perform public.notificar(adm, 'novo_agendamento',
        case when new.remarca_de is not null then 'A cliente pediu para trocar um horário'
             when exists (select 1 from public.aceites x where x.appointment_id = new.id and x.resultado is null)
               then 'Pedido de horário para ' || coalesce(split_part(res.profissional, ' ', 1), 'a equipe')
             else 'Horário novo no salão' end,
        linha || ', com ' || coalesce(res.profissional, 'a equipe'), '/admin/agenda',
        jsonb_build_object('appointment_id', new.id, 'professional_id', new.professional_id));
    end loop;
  end if;
  return new;
end;
$function$;

-- 4. O salão marcou para a cliente: ela fica sabendo -------------------------------------------------
create or replace function public.avisa_cliente_que_marcaram()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare res record; casa text;
begin
  -- só o horário que já entra valendo, marcado por outra pessoa, para quem tem conta. A troca avisa pelo caminho dela
  if new.client_id is null or new.status <> 'confirmado' or new.remarca_de is not null then return new; end if;
  if public.quem_age_e(new) not in ('salao', 'profissional') or public.gatilho_silenciado() then return new; end if;
  -- o encaixe de quem já está no salão não precisa de aviso
  if (new.date + new.start_time) < public.agora_local() + interval '30 minutes' then return new; end if;
  select * into res from public.resumo_do_agendamento(new.id);
  select coalesce(nullif(btrim(s.name), ''), 'O salão') into casa from public.salons s where s.id = new.salon_id;
  perform public.notificar(new.client_id, 'agendamento_confirmado', 'Horário marcado',
    coalesce(casa, 'O salão') || ' marcou ' || coalesce(res.servico, 'um atendimento') || coalesce(' com ' || res.profissional, '') || coalesce(', ' || res.quando_longo, '') || '.',
    '/cliente/agendamento/' || new.id::text,
    jsonb_build_object('appointment_id', new.id, 'professional_id', new.professional_id, 'pela_casa', true));
  return new;
end;
$$;
drop trigger if exists tg_zzzz_avisa_cliente_marcaram on public.appointments;
create trigger tg_zzzz_avisa_cliente_marcaram after insert on public.appointments
  for each row when (new.status = 'confirmado') execute function public.avisa_cliente_que_marcaram();

-- 5. Fechar o dia: o lembrete vai para quem dá a baixa ------------------------------------------------
create or replace function public.lembrar_fechar_dia()
returns integer
language plpgsql
security definer set search_path = public
as $$
declare r record; n integer := 0; agora timestamp := public.agora_local(); hoje date := public.agora_local()::date;
begin
  create temp table if not exists _fechar_hoje (professional_id uuid, quantos integer) on commit drop;
  truncate _fechar_hoje;
  insert into _fechar_hoje
    select a.professional_id, count(*)
    from public.appointments a
    where a.date = hoje and a.status = 'confirmado'
      and not exists (select 1 from public.fechamentos_lembrados f where f.professional_id = a.professional_id and f.dia = hoje)
    group by a.professional_id
    having (hoje + max(a.end_time)) + interval '30 minutes' < agora;
  insert into public.fechamentos_lembrados (professional_id, dia) select professional_id, hoje from _fechar_hoje on conflict do nothing;
  -- 270: um aviso por pessoa que dá a baixa. No modo "cada profissional decide" é ela; nos outros, o salão
  -- (antes ia sempre para a profissional, que no modo casa abria a tela e não tinha nada para fechar)
  for r in
    select q.user_id, q.papel, sum(f.quantos)::integer as quantos
    from _fechar_hoje f cross join lateral public.quem_da_baixa(f.professional_id) q
    where q.user_id is not null
    group by q.user_id, q.papel
  loop
    perform public.notificar(r.user_id, 'fechar_dia', 'Como foi hoje?',
      r.quantos || case when r.quantos = 1 then ' atendimento' else ' atendimentos' end
        || case when r.papel = 'salao' then ' do salão esperando a baixa.' else ' esperando sua baixa.' end
        || ' Quem você não responder conclui sozinho em 3 horas.',
      case when r.papel = 'salao' then '/admin/fechar-dia' else '/pro/fechar-dia' end,
      jsonb_build_object('dia', hoje, 'quantos', r.quantos));
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.lembrar_fechar_dia() from public, anon, authenticated;

-- 6. O resumo da agenda de amanhã, para quem atende --------------------------------------------------
create or replace function public.avisar_agenda_de_amanha()
returns integer
language plpgsql
security definer set search_path = public
as $$
declare r record; n integer := 0; agora timestamp := public.agora_local(); amanha date := public.agora_local()::date + 1;
begin
  -- das 19h às 22h, uma vez por profissional e por dia (a rotina roda a cada 5 minutos)
  if agora::time < time '19:00' or agora::time >= time '22:00' then return 0; end if;
  for r in
    select p.id as professional_id, p.user_id, count(*)::integer as quantos, min(a.start_time) as primeiro
    from public.appointments a
    join public.professionals p on p.id = a.professional_id
    where a.date = amanha and a.status = 'confirmado' and p.user_id is not null
      and not exists (select 1 from public.notifications x
                      where x.user_id = p.user_id and x.kind = 'agenda_de_amanha'
                        and x.data ->> 'dia' = amanha::text and x.data ->> 'agenda' = p.id::text)
    group by p.id, p.user_id
  loop
    perform public.notificar(r.user_id, 'agenda_de_amanha', 'Sua agenda de amanhã',
      case when r.quantos = 1 then '1 horário, às ' || to_char(r.primeiro, 'HH24:MI') || '.'
           else r.quantos || ' horários, o primeiro às ' || to_char(r.primeiro, 'HH24:MI') || '.' end,
      '/pro/agenda?dia=' || amanha::text,
      jsonb_build_object('dia', amanha, 'agenda', r.professional_id, 'quantos', r.quantos));
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.avisar_agenda_de_amanha() from public, anon, authenticated;

insert into public.modelos_de_mensagem (chave, grupo, titulo, descricao, variaveis, padrao, ordem, exemplo) values
('push.agenda_de_amanha', 'push', 'Agenda de amanhã', 'À noite, para quem atende: quantos horários tem amanhã e a que horas começa.', '{titulo,texto,nome}', E'{titulo}\n{texto}', 830,
  '{"titulo":"Sua agenda de amanhã","texto":"4 horários, o primeiro às 09:00."}')
on conflict (chave) do update set grupo = excluded.grupo, titulo = excluded.titulo, descricao = excluded.descricao,
  variaveis = excluded.variaveis, ordem = excluded.ordem, exemplo = excluded.exemplo;
insert into public.push_regras (kind, envia) values ('agenda_de_amanha', true) on conflict (kind) do nothing;

CREATE OR REPLACE FUNCTION public.rodar_rotinas()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  vencidos integer := 0;
  ofertas integer := 0;
  lembretes integer := 0;
  perguntas integer := 0;
  fechamentos integer := 0;
  concluidos integer := 0;
  avaliacoes integer := 0;
  reservas integer := 0;
  creditos integer := 0;
  assinaturas integer := 0;
  pagamentos jsonb := '{}'::jsonb;
  resumos integer := 0;
begin
  vencidos   := coalesce(public.resolver_aceites_vencidos(), 0);
  ofertas    := coalesce(public.avancar_ofertas_expiradas(), 0);
  lembretes  := coalesce(public.enviar_lembretes(), 0);
  begin
    perguntas := coalesce(public.perguntar_se_veio(), 0);
  exception when others then perguntas := -1;
  end;
  begin
    fechamentos := coalesce(public.lembrar_fechar_dia(), 0);
  exception when others then fechamentos := -1;
  end;
  begin
    resumos := coalesce(public.avisar_agenda_de_amanha(), 0);
  exception when others then resumos := -1;
  end;
  begin
    concluidos := coalesce(public.concluir_atendimentos_passados(), 0);
  exception when others then concluidos := -1;
  end;
  begin
    avaliacoes := coalesce(public.convidar_avaliacoes(), 0);
  exception when others then avaliacoes := -1;
  end;
  begin
    reservas := coalesce(public.expirar_reservas_nao_pagas(), 0);
  exception when others then reservas := -1;
  end;
  begin
    creditos := coalesce(public.expirar_creditos(), 0);
  exception when others then creditos := -1;
  end;
  begin
    assinaturas := coalesce(public.cuidar_das_assinaturas(), 0);
  exception when others then assinaturas := -1;
  end;
  begin
    pagamentos := public.chutar_pagamentos();
  exception when others then pagamentos := jsonb_build_object('ok', false, 'motivo', sqlerrm);
  end;
  return jsonb_build_object(
    'aceites_vencidos', vencidos,
    'ofertas_expiradas', ofertas,
    'lembretes', lembretes,
    'perguntas', perguntas,
    'fechamentos', fechamentos,
    'resumos_de_amanha', resumos,
    'concluidos', concluidos,
    'avaliacoes', avaliacoes,
    'reservas_expiradas', reservas,
    'creditos_vencidos', creditos,
    'assinaturas', assinaturas,
    'pagamentos', pagamentos,
    'em', now());
end;
$function$;

do $$ begin raise notice '270: pedido da casa para quem não tem conta, a dona sabe das decisões, a cliente sabe quando marcam por ela, fechar o dia para quem dá a baixa, agenda de amanhã'; end $$;
