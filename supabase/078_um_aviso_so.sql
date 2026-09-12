-- 078 · Um aviso só para a profissional
--
-- A cliente remarcava e chegavam DOIS avisos: "Pedido de horário" (o
-- aceite) e "Horário novo na sua agenda" (o gatilho do insert). O mesmo
-- acontecia num pedido comum com aceite manual. Agora:
--   - abriu pedido de aceite → só o aviso do pedido, que diz se é troca
--     ("quer mudar X de A para B") ou horário novo;
--   - sem aceite (entrou confirmado) → só "Horário novo" ou, na troca,
--     "Cliente remarcou: X agora é B (era A)".

create or replace function public.pedir_aceite(appt uuid, forcar boolean default false)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
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
begin
  select * into a from public.appointments where id = appt;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'sem agendamento'); end if;

  select * into p from public.professionals where id = a.professional_id;
  if not found or (not p.aceite_manual and not forcar) then
    return jsonb_build_object('ok', false, 'motivo', 'aceite desligado');
  end if;
  if p.user_id is null then
    return jsonb_build_object('ok', false, 'motivo', 'profissional sem conta');
  end if;

  select public.telefone_e164(pf.phone) into tel_prof
  from public.profiles pf where pf.id = p.user_id;

  select public.telefone_e164(pf.phone), nullif(btrim(pf.full_name), '')
    into tel_cli, nome_cli
  from public.profiles pf where pf.id = a.client_id;

  prazo := now() + make_interval(mins => coalesce(p.minutos_para_aceitar, 120));
  quando := public.dia_por_extenso(a.date) || ' às ' || to_char(a.start_time, 'HH24:MI');

  insert into public.aceites
    (appointment_id, professional_id, salon_id, telefone_prof, telefone_cliente, expira_em)
  values (appt, p.id, a.salon_id, coalesce(tel_prof, ''), coalesce(tel_cli, ''), prazo)
  on conflict (appointment_id) do nothing;

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
$$;
revoke execute on function public.pedir_aceite(uuid, boolean) from public, anon, authenticated;

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

  -- um aviso só: se abriu o pedido, o pedido já avisou
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

  if new.client_id is not null and new.client_id = auth.uid() and new.remarca_de is null then
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
