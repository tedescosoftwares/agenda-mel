-- 247 · A voz é do salão em tudo o que a cliente recebe (3.98.5)
--
-- A cliente marca com o salão. As mensagens falavam como se a profissional tivesse decidido ("A Melissa aceitou",
-- "a Melissa não vai poder atender", "Te espero!"), e isso tira a identidade do salão. Agora: o nome do salão vai no
-- título ("Salão Mimo: horário confirmado"; sem "o/a", que não dá para saber), o corpo fala por "nós" ("Não vamos
-- conseguir atender", "Te esperamos!") e a profissional aparece como quem atende ("👩 com Melissa"), nunca como quem
-- aceitou, recusou ou cancelou. Vale para todos os modos de confirmação; na autônoma, o "salão" já é o nome dela.
-- O que vai para a profissional fica igual, e os modelos editados na Plataforma também.

-- 1. O título com o nome do salão ----------------------------------------------------------------------------------
create or replace function public.titulo_com_salao(nome text, titulo text)
returns text
language sql
immutable
as $$
  select case when nullif(btrim(coalesce(nome, '')), '') is null then titulo
              else btrim(nome) || ': ' || lower(left(titulo, 1)) || substr(titulo, 2) end;
$$;

-- 2. As mensagens de WhatsApp para a cliente (montar_texto_padrao) ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.montar_texto_padrao(tipo text, titulo text, corpo text, appt uuid, prof uuid, cliente uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  d_data date; d_hora time; servico text;
  prof_nome text; prof_slug text; base text;
  link text; link_app text; nome_cliente text;
  nome_na_agenda text; tel_na_agenda text;
  quando text; quando_longo text; prazo integer;
  origem uuid; antes_data date; antes_hora time; quando_antes text;
  desistiu boolean := false;
  nome_salao text;
begin
  if appt is not null then
    select ap.date, ap.start_time, coalesce(ap.service_name, s.name),
           ap.professional_id, ap.remarca_de,
           nullif(btrim(coalesce(cl.full_name, '')), ''), cl.phone
      into d_data, d_hora, servico, prof, origem, nome_na_agenda, tel_na_agenda
    from public.appointments ap
    left join public.services s on s.id = ap.service_id
    left join public.profiles cl on cl.id = ap.client_id
    where ap.id = appt;

    -- é uma troca? o horário de onde ela quer sair
    if origem is not null then
      select o.date, o.start_time into antes_data, antes_hora
      from public.appointments o where o.id = origem;
      if antes_data is not null then
        quando_antes := (array['domingo','segunda','terça','quarta','quinta','sexta','sábado'])
                          [extract(dow from antes_data)::int + 1] || ', '
                        || to_char(antes_data, 'DD/MM') || ' às ' || to_char(antes_hora, 'HH24:MI');
      end if;
    end if;

    -- a cliente desfez o pedido antes da resposta?
    select exists (select 1 from public.aceites
                   where appointment_id = appt and resultado = 'desistiu')
      into desistiu;
  end if;

  if prof is not null then
    select pr.name, pr.slug, rtrim(sl.app_url, '/'), pr.minutos_para_aceitar, nullif(btrim(sl.name), '')
      into prof_nome, prof_slug, base, prazo, nome_salao
    from public.professionals pr
    join public.salons sl on sl.id = pr.salon_id
    where pr.id = prof;
  end if;

  if cliente is not null then
    select nullif(split_part(coalesce(full_name, ''), ' ', 1), '')
      into nome_cliente from public.profiles where id = cliente;
  end if;

  if base is not null then
    link_app := base || '/';
    if prof_slug is not null then link := base || '/p/' || prof_slug; end if;
  end if;

  if d_data is not null then
    quando := to_char(d_data, 'DD/MM') || ' às ' || to_char(d_hora, 'HH24:MI');
    quando_longo := (array['domingo','segunda','terça','quarta','quinta','sexta','sábado'])
                      [extract(dow from d_data)::int + 1] || ', ' || quando;
  end if;

  case tipo

  -- ---- para a PROFISSIONAL ---------------------------------------------
  when 'pedido_de_aceite' then
    if quando_antes is not null then
      return
        '🔁 *Pedido de remarcação*' || E'\n\n'
        || '👤 ' || coalesce(nome_na_agenda, 'Cliente') || E'\n'
        || '✨ ' || coalesce(servico, 'Atendimento') || E'\n'
        || '🕒 era: ' || quando_antes || E'\n'
        || '➡️ quer: ' || coalesce(quando_longo, '')
        || coalesce(E'\n' || '📱 ' || tel_na_agenda, '') || E'\n\n'
        || 'Responda *1* para aceitar a troca ou *2* para manter como está.' || E'\n'
        || '_Sem resposta em ' || coalesce(prazo, 120) || ' min, eu resolvo sozinho._';
    end if;
    return
      '🔔 *Pedido de horário*' || E'\n\n'
      || '👤 ' || coalesce(nome_na_agenda, 'Cliente') || E'\n'
      || '✨ ' || coalesce(servico, 'Atendimento') || E'\n'
      || '🕒 ' || coalesce(quando_longo, '')
      || coalesce(E'\n' || '📱 ' || tel_na_agenda, '') || E'\n\n'
      || 'Responda *1* para aceitar ou *2* para recusar.' || E'\n'
      || '_Sem resposta em ' || coalesce(prazo, 120) || ' min, eu resolvo sozinho._';

  when 'novo_agendamento' then
    if quando_antes is not null then
      return
        '🔁 *Cliente remarcou*' || E'\n\n'
        || '👤 ' || coalesce(nome_na_agenda, 'Cliente') || E'\n'
        || '✨ ' || coalesce(servico, 'Atendimento') || E'\n'
        || '🕒 era: ' || quando_antes || E'\n'
        || '✅ agora: ' || coalesce(quando_longo, '')
        || coalesce(E'\n' || '📱 ' || tel_na_agenda, '')
        || coalesce(E'\n\n' || '🔗 Sua agenda: ' || link_app, '');
    end if;
    return
      '🗓️ *Horário novo na sua agenda*' || E'\n\n'
      || '👤 ' || coalesce(nome_na_agenda, 'Cliente') || E'\n'
      || '✨ ' || coalesce(servico, 'Atendimento') || E'\n'
      || '🕒 ' || coalesce(quando_longo, 'a confirmar')
      || coalesce(E'\n' || '📱 ' || tel_na_agenda, '')
      || coalesce(E'\n\n' || '🔗 Sua agenda: ' || link_app, '');

  when 'cancelou_comigo' then
    if desistiu and quando_antes is not null then
      return
        '🙅 *Desistiu da remarcação*' || E'\n\n'
        || '👤 ' || coalesce(nome_na_agenda, 'Cliente') || E'\n'
        || '✨ ' || coalesce(servico, 'Atendimento') || E'\n'
        || '🕒 pedia: ' || coalesce(quando_longo, '') || E'\n\n'
        || 'Não precisa responder. O horário de ' || quando_antes || ' continua valendo.';
    elsif desistiu then
      return
        '🙅 *Desistiu do pedido*' || E'\n\n'
        || '👤 ' || coalesce(nome_na_agenda, 'Cliente') || E'\n'
        || '✨ ' || coalesce(servico, 'Atendimento') || E'\n'
        || '🕒 ' || coalesce(quando_longo, '') || E'\n\n'
        || 'Não precisa responder. Nada mudou na sua agenda.';
    end if;
    return
      '⚠️ *Cancelaram um horário*' || E'\n\n'
      || '👤 ' || coalesce(nome_na_agenda, 'Cliente') || E'\n'
      || '✨ ' || coalesce(servico, 'Atendimento') || E'\n'
      || '🕒 ' || coalesce(quando_longo, '') || E'\n\n'
      || 'Esse horário voltou a ficar livre.'
      || coalesce(E'\n\n' || '🔗 Sua agenda: ' || link_app, '');

  -- ---- para a CLIENTE ---------------------------------------------------
  -- 247 (3.98.5): quem fala é o salão. O nome dele vai no título ("Salão Mimo: horário confirmado", sem "o/a", que
  -- não dá para saber) e o corpo fala por "nós". A profissional aparece como quem atende (👩 com Melissa), nunca
  -- como quem aceitou, recusou ou cancelou. Vale para todos os modos de confirmação.
  when 'profissional_cancelou' then
    return
      '⚠️ *' || public.titulo_com_salao(nome_salao, 'Precisamos cancelar seu horário') || '*' || E'\n\n'
      || coalesce('Oi, ' || nome_cliente || '. ', 'Oi! ') || 'Desculpa mesmo, não vamos conseguir atender:' || E'\n\n'
      || '✨ ' || coalesce(servico, 'Seu atendimento') || E'\n'
      || '👩 com *' || coalesce(prof_nome, 'a profissional') || '*' || E'\n'
      || '🗓️ ' || coalesce(quando_longo, '') || E'\n\n'
      || 'Escolha outro horário que a gente já deixa marcado 💛'
      || coalesce(E'\n\n' || '🔗 ' || coalesce(link, link_app), '');

  when 'pedido_aceito' then
    return
      '✅ *' || public.titulo_com_salao(nome_salao, 'Horário confirmado') || '*' || E'\n\n'
      || coalesce('Oi, ' || nome_cliente || '! ', '') || 'Está tudo certo:' || E'\n\n'
      || '✨ ' || coalesce(servico, 'Seu atendimento') || E'\n'
      || '👩 com *' || coalesce(prof_nome, 'a profissional') || '*' || E'\n'
      || '🗓️ ' || coalesce(quando_longo, '') || E'\n\n'
      || 'Te esperamos! 💛';

  when 'pedido_recusado' then
    return
      '😔 *' || public.titulo_com_salao(nome_salao, 'Não deu dessa vez') || '*' || E'\n\n'
      || coalesce('Oi, ' || nome_cliente || '. ', '')
      || 'Não vamos conseguir atender ' || coalesce(quando_longo, 'nesse horário') || '.' || E'\n\n'
      || 'Me chame que a gente acha outro horário 💛';

  when 'remarcacao_aceita' then
    return
      '🔁 *' || public.titulo_com_salao(nome_salao, 'Troca confirmada') || '*' || E'\n\n'
      || coalesce('Oi, ' || nome_cliente || '! ', '') || 'Seu horário mudou:' || E'\n\n'
      || '✨ ' || coalesce(servico, 'Seu atendimento') || E'\n'
      || '👩 com *' || coalesce(prof_nome, 'a profissional') || '*' || E'\n'
      || coalesce('🕒 era: ' || quando_antes || E'\n', '')
      || '🗓️ agora: ' || coalesce(quando_longo, '') || E'\n\n'
      || 'Te esperamos! 💛';

  when 'remarcacao_recusada' then
    return
      '😔 *' || public.titulo_com_salao(nome_salao, 'Não deu para trocar') || '*' || E'\n\n'
      || coalesce('Oi, ' || nome_cliente || '. ', '')
      || 'Não conseguimos mudar para ' || coalesce(quando_longo, 'esse horário') || '.' || E'\n\n'
      || coalesce('Seu horário de *' || quando_antes || '* continua guardado. ', 'Seu horário de antes continua guardado. ')
      || 'Se quiser tentar outro, é só me chamar 💛';

  when 'lembrete_agendamento' then
    return
      '📅 *' || public.titulo_com_salao(nome_salao, public.titulo_do_lembrete(appt)) || '*' || E'\n\n'
      || 'Oi' || coalesce(', ' || nome_cliente, '') || '! Só passando pra lembrar:' || E'\n\n'
      || '✨ ' || coalesce(servico, 'Seu atendimento') || E'\n'
      || '👩 com *' || coalesce(prof_nome, 'a profissional') || '*' || E'\n'
      || '🗓️ ' || coalesce(quando_longo, '') || E'\n\n'
      || 'Responda *1* pra confirmar, ou *2* se precisar remarcar.'
      || coalesce(E'\n\n' || '🔗 Sua agenda: ' || link, '');

  when 'agendamento_confirmado' then
    return
      '✅ *' || public.titulo_com_salao(nome_salao, 'Horário confirmado') || '*' || E'\n\n'
      || coalesce('Oi, ' || nome_cliente || '! ', '') || 'Está tudo certo:' || E'\n\n'
      || '✨ ' || coalesce(servico, 'Seu atendimento') || E'\n'
      || '👩 com *' || coalesce(prof_nome, 'a profissional') || '*' || E'\n'
      || '🗓️ ' || coalesce(quando_longo, '') || E'\n\n'
      || 'Te esperamos! 💛'
      || coalesce(E'\n\n' || '🔗 Sua agenda: ' || link, '');

  when 'agendamento_cancelado' then
    return
      '❌ *' || public.titulo_com_salao(nome_salao, 'Horário cancelado') || '*' || E'\n\n'
      || coalesce('Oi, ' || nome_cliente || '. ', '')
      || 'O horário de ' || coalesce(quando, 'antes') || ' foi cancelado.' || E'\n\n'
      || 'Quando quiser remarcar, é só chamar.'
      || coalesce(E'\n\n' || '🔗 ' || link, '');

  when 'convite_retorno' then
    return
      '💛 *' || public.titulo_com_salao(nome_salao, 'Faz tempo que você não aparece') || '*' || E'\n\n'
      || coalesce('Oi, ' || nome_cliente || '! ', 'Oi! ')
      || 'Guardamos um lugar pra você' || coalesce(' com *' || prof_nome || '*', '') || '.' || E'\n\n'
      || 'Quer já deixar marcado?'
      || coalesce(E'\n\n' || '🔗 ' || link, '');

  when 'pos_atendimento' then
    return
      '💅 *' || public.titulo_com_salao(nome_salao, 'Obrigada pela visita!') || '*' || E'\n\n'
      || coalesce('Oi, ' || nome_cliente || '! ', '') || 'Esperamos que tenha gostado.'
      || coalesce(E'\n\n' || '🔗 ' || link, '');

  when 'vaga_disponivel' then
    return
      '🎉 *' || public.titulo_com_salao(nome_salao, 'Abriu uma vaga') || '*' || E'\n\n'
      || coalesce('Oi, ' || nome_cliente || '! ', '')
      || 'Apareceu um horário' || coalesce(' em ' || quando, '')
      || coalesce(' com *' || prof_nome || '*', '') || '.' || E'\n\n'
      || 'Ela fica guardada por pouco tempo.'
      || coalesce(E'\n\n' || '🔗 ' || link, '');

  when 'agenda_adiantada' then
    return
      '⏰ *' || public.titulo_com_salao(nome_salao, 'Dá pra adiantar seu horário') || '*' || E'\n\n'
      || coalesce('Oi, ' || nome_cliente || '! ', '')
      || 'Abriu um horário mais cedo' || coalesce(', ' || quando, '') || '.'
      || coalesce(E'\n\n' || '🔗 ' || link, '');

  else
    return coalesce(titulo, '')
      || case when corpo is not null and btrim(corpo) <> ''
              then E'\n\n' || corpo else '' end;
  end case;
end;
$function$;

-- 3. Os avisos do app: a decisão é do salão --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.avisa_cliente_da_decisao()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  res record;
  pagina text;
begin
  if old.status <> 'pendente' or new.status not in ('confirmado', 'cancelado') then
    return new;
  end if;
  if public.gatilho_silenciado() then
    return new;                      -- quem mudou já mandou o aviso certo
  end if;
  if new.client_id is null or public.quem_age_e(new) in ('cliente', 'sistema') then
    return new;
  end if;

  select * into res from public.resumo_do_agendamento(new.id);
  pagina := '/cliente/agendamento/' || new.id::text;

  if new.status = 'confirmado' then
    if new.remarca_de is not null then
      perform public.efetivar_remarcacao(new.id);   -- o horário de antes sai da agenda, sem aviso de cancelamento
      perform public.notificar(new.client_id, 'remarcacao_aceita', 'Remarcado! 🎉',
        coalesce(res.servico, 'Seu horário') || ' com ' || coalesce(res.profissional, 'a equipe') || ' agora é ' || coalesce(res.quando_longo, 'no novo horário') || '.',
        pagina, jsonb_build_object('appointment_id', new.id, 'professional_id', new.professional_id));
    elsif new.visita_id is not null then
      perform public.notificar(new.client_id, 'pedido_aceito', coalesce((select nullif(btrim(sx.name), '') from public.salons sx where sx.id = new.salon_id), 'O salão') || ' confirmou ' || coalesce(res.servico, 'seu horário'),
        coalesce(res.quando_longo, '') || '. ' || case when exists (select 1 from public.appointments x where x.visita_id = new.visita_id and x.id <> new.id and x.status = 'pendente')
                                                     then 'Falta confirmar a outra parte da sua visita.' else 'Sua visita está completa. 🎉' end,
        pagina, jsonb_build_object('appointment_id', new.id, 'professional_id', new.professional_id, 'visita_id', new.visita_id));
    else
      perform public.notificar(new.client_id, 'pedido_aceito', 'Agendamento confirmado! 🎉',
        coalesce(res.servico, 'Seu horário') || ' com ' || coalesce(res.profissional, 'a equipe') || ', ' || coalesce(res.quando_longo, '') || '.',
        pagina, jsonb_build_object('appointment_id', new.id, 'professional_id', new.professional_id));
    end if;
  else
    if new.remarca_de is not null then
      perform public.notificar(new.client_id, 'remarcacao_recusada', 'Não deu para remarcar',
        'Seu horário de antes continua valendo. Se quiser, tente outra data.',
        '/cliente/meus-agendamentos', jsonb_build_object('appointment_id', new.id, 'professional_id', new.professional_id));
    elsif new.visita_id is not null then
      perform public.avisar_parte_recusada(new.id);
    else
      perform public.notificar(new.client_id, 'pedido_recusado', 'Horário não confirmado',
        'Não vamos conseguir atender ' || coalesce(res.quando_longo, 'nesse horário') || '. Escolha outro horário.',
        pagina, jsonb_build_object('appointment_id', new.id, 'professional_id', new.professional_id));
    end if;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.casa_decide(appt uuid, aceitou boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a public.appointments%rowtype; res record; pagina text;
begin
  select * into a from public.appointments where id = appt;
  if a.id is null then raise exception 'Horário não encontrado.'; end if;
  if not (public.is_admin_do_salao(a.salon_id) or public.is_professional(a.professional_id) or public.eh_plataforma()) then raise exception 'Esse horário não é seu.'; end if;
  if a.status <> 'pendente' then return jsonb_build_object('ok', false, 'motivo', 'já está ' || a.status, 'status', a.status); end if;
  if exists (select 1 from public.aceites x where x.appointment_id = appt and x.resultado is null) then
    return public.resolver_aceite(appt, aceitou) || jsonb_build_object('status', case when aceitou then 'confirmado' else 'cancelado' end);
  end if;
  select * into res from public.resumo_do_agendamento(appt);
  pagina := '/cliente/agendamento/' || appt::text;
  perform public.silenciar_gatilho();
  if aceitou then
    update public.appointments set status = 'confirmado' where id = appt;
    -- 3.98.1 (243): é uma troca de horário: o de antes sai da agenda e a cliente recebe "Remarcado!"
    if a.remarca_de is not null then
      perform public.efetivar_remarcacao(appt);
      if a.client_id is not null then
        perform public.notificar(a.client_id, 'remarcacao_aceita', 'Remarcado! 🎉',
          coalesce(res.servico, 'Seu horário') || ' com ' || coalesce(res.profissional, 'a equipe') || ' agora é ' || coalesce(res.quando_longo, 'no novo horário') || '.',
          pagina, jsonb_build_object('appointment_id', appt, 'professional_id', a.professional_id));
      end if;
    elsif a.client_id is not null then
      perform public.notificar(a.client_id, 'pedido_aceito', 'Agendamento confirmado! 🎉',
        coalesce(res.servico, 'Seu horário') || ' com ' || coalesce(res.profissional, 'a equipe') || ', ' || coalesce(res.quando_longo, '') || '.',
        pagina, jsonb_build_object('appointment_id', appt, 'professional_id', a.professional_id));
    end if;
  else
    update public.appointments set status = 'cancelado', cancelado_por = 'salao', cancelado_em = now(), motivo_cancelamento = 'recusado_pela_casa' where id = appt;
    -- 3.98.1 (243): troca recusada: o horário de antes continua valendo
    if a.remarca_de is not null and a.client_id is not null then
      perform public.notificar(a.client_id, 'remarcacao_recusada', 'Não deu para remarcar',
        'Seu horário de antes continua valendo. Se quiser, tente outra data.',
        '/cliente/meus-agendamentos', jsonb_build_object('appointment_id', appt, 'professional_id', a.professional_id));
    elsif a.client_id is not null then
      perform public.notificar(a.client_id, 'pedido_recusado', 'Horário não confirmado',
        'Não vamos conseguir atender ' || coalesce(res.quando_longo, 'nesse horário') || '. Escolha outro horário.',
        pagina, jsonb_build_object('appointment_id', appt, 'professional_id', a.professional_id));
    end if;
  end if;
  return jsonb_build_object('ok', true, 'status', case when aceitou then 'confirmado' else 'cancelado' end);
end;
$function$;

CREATE OR REPLACE FUNCTION public.resolver_aceite(appt uuid, aceitou boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      aviso := public.notificar(cliente, 'pedido_aceito', coalesce((select nullif(btrim(sx.name), '') from public.salons sx where sx.id = a.salon_id), 'O salão') || ' confirmou ' || res.servico,
        res.quando_longo || '. ' || case when exists (select 1 from public.appointments x where x.visita_id = a.visita_id and x.id <> appt and x.status = 'pendente')
                                        then 'Falta confirmar a outra parte da sua visita.' else 'Sua visita está completa. 🎉' end,
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
        'Não vamos conseguir atender ' || res.quando_longo || '. Escolha outro horário.',
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
$function$;

CREATE OR REPLACE FUNCTION public.avisa_cliente_do_cancelamento()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  agiu text;
  prof public.professionals%rowtype;
  res record;
begin
  if new.status <> 'cancelado' or old.status = 'cancelado' then
    return new;
  end if;

  -- pedido recusado: quem avisa é avisa_cliente_da_decisao (244), com o texto de pedido
  if old.status = 'pendente' then
    return new;
  end if;

  -- caminho que já mandou a mensagem certa com o texto certo
  if public.gatilho_silenciado() then
    return new;
  end if;

  agiu := public.quem_age_e(new);

  -- a cliente que cancelou já viu a tela; e quando o cancelamento nasce
  -- de dentro do servidor, quem sabe o contexto é quem chamou
  if agiu in ('cliente', 'sistema') then
    return new;
  end if;

  select * into prof from public.professionals where id = new.professional_id;
  select * into res from public.resumo_do_agendamento(new.id);

  perform public.notificar(
    new.client_id, 'profissional_cancelou', 'Horário cancelado',
    coalesce((select nullif(btrim(sx.name), '') from public.salons sx where sx.id = new.salon_id), 'O salão') || ' precisou cancelar seu horário' || coalesce(' de ' || res.quando_longo, '') || '.',
    '/',
    jsonb_build_object('appointment_id', new.id,
                       'professional_id', new.professional_id));
  return new;
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
  if conta is null and not casa then
    return new;
  end if;

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
    perform public.notificar(
      conta, 'novo_agendamento', 'Horário novo na sua agenda', null, '/pro',
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

CREATE OR REPLACE FUNCTION public.avisar_parte_recusada(appt uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      'Não vamos conseguir atender ' || res.quando_longo || '. Escolha outro horário.',
      '/cliente/agendamento/' || appt::text, jsonb_build_object('appointment_id', appt, 'professional_id', a.professional_id));
    return;
  end if;
  perform public.notificar(a.client_id, 'parte_recusada', 'Não vamos conseguir fazer ' || res.servico,
    'Na sua visita de ' || public.dia_por_extenso(a.date) || ', ' || res.servico || ' com ' || nome_b || ' às ' || to_char(a.start_time, 'HH24:MI')
      || ' não deu. O resto continua: ' || outras || '. Quer marcar ' || res.servico || ' em outro dia, ou deixar só o que ficou?',
    '/cliente/agendamento/' || coalesce(primeira, appt)::text,
    jsonb_build_object('appointment_id', coalesce(primeira, appt), 'visita_id', a.visita_id, 'recusado', appt, 'service_id', a.service_id, 'professional_id', a.professional_id));
end;
$function$;

CREATE OR REPLACE FUNCTION public.confirmar_pagamento(pagamento uuid, cobranca text, liquido integer DEFAULT NULL::integer, quando timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  p public.pagamentos%rowtype;
  a public.appointments%rowtype;
  res record;
begin
  select * into p from public.pagamentos where id = pagamento;
  if p.id is null then return jsonb_build_object('ok', false, 'motivo', 'pagamento não encontrado'); end if;
  if p.status = 'pago' then return jsonb_build_object('ok', true, 'repetido', true); end if;

  update public.pagamentos
  set status = 'pago', pago_em = quando, cobranca_id = coalesce(cobranca, cobranca_id),
      liquido_cents = coalesce(liquido, pagamentos.liquido_cents), atualizado_em = now()
  where id = pagamento;

  update public.appointments set pago_cents = pago_cents + p.valor_cents where id = p.appointment_id returning * into a;

  if a.status = 'cancelado' then
    -- pagou depois de a reserva cair: devolve o que entrou
    update public.pagamentos set status = 'estorno_pendente', estorno_cents = coalesce(liquido, liquido_cents, valor_cents), motivo_estorno = 'reserva expirou antes do pagamento', atualizado_em = now() where id = pagamento;
    return jsonb_build_object('ok', true, 'estornar', true);
  end if;

  if a.status = 'aguardando_pagamento' then
    -- vira pedido: o gatilho tg_avisa_profissional_pago vê que está pago, confirma e avisa
    update public.appointments set status = 'pendente' where id = a.id returning * into a;
    select * into a from public.appointments where id = a.id;
  elsif a.status = 'pendente' then
    -- pagou depois, com o pedido aberto: confirma e fecha o aceite
    update public.aceites set resultado = 'aceito', resolvido_em = now() where appointment_id = a.id and resultado is null;
    update public.appointments set status = 'confirmado' where id = a.id returning * into a;
    perform public.avisar_horario_pago(a.id, false);
  else
    perform public.avisar_horario_pago(a.id, false);
  end if;

  select * into res from public.resumo_do_agendamento(a.id);
  perform public.notificar(p.client_id, 'pagamento_confirmado', 'Pagamento confirmado ✅',
    'R$ ' || to_char(p.valor_cents / 100.0, 'FM999G999D00') || case when p.sinal_pct < 100 then ' de sinal' else '' end
      || ' para ' || res.servico || ' com ' || res.profissional || ', ' || res.quando_longo || '.'
      || case when a.status = 'confirmado' then ' Seu horário está confirmado.' when a.status = 'pendente' then ' Agora é só esperar: ' || coalesce((select nullif(btrim(sx.name), '') from public.salons sx where sx.id = a.salon_id), 'O salão') || ' confirma em breve.' else '' end,
    '/cliente/agendamento/' || a.id, jsonb_build_object('appointment_id', a.id, 'professional_id', a.professional_id));

  return jsonb_build_object('ok', true, 'appointment_id', a.id, 'status', a.status);
end;
$function$;

CREATE OR REPLACE FUNCTION public.marcar_visita(dia date, partes jsonb, obs text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      public.dia_por_extenso(dia) || ': ' || resumo || '. Confirmamos cada parte em breve.',
      '/cliente/agendamento/' || primeira::text, jsonb_build_object('appointment_id', primeira, 'visita_id', visita));
  end if;

  return jsonb_build_object('ok', true, 'appointment_id', primeira, 'visita_id', visita, 'partes', to_jsonb(ids), 'confirmada', todas_confirmadas);
end;
$function$;

-- 4. O que a assistente recebe ao marcar um pedido -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bot_marcar(salao uuid, cliente uuid, profissional_id uuid, servico_id uuid, dia date, hora time without time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_variable
declare dur integer; manual boolean; novo uuid; virou text; nome_s text; nome_p text; sit jsonb; forcado boolean;
begin
  if cliente is null then return jsonb_build_object('erro', 'cliente sem cadastro: peça para ela entrar pelo app'); end if;
  select s.duration_minutes, s.name into dur, nome_s from public.services s where s.id = servico_id and s.salon_id = salao and s.active;
  if dur is null then return jsonb_build_object('erro', 'serviço não encontrado neste salão'); end if;
  select p.aceite_manual, p.name into manual, nome_p from public.professionals p where p.id = profissional_id and p.salon_id = salao and p.active;
  if nome_p is null then return jsonb_build_object('erro', 'profissional não encontrada'); end if;
  if not exists (select 1 from public.professional_services ps where ps.professional_id = profissional_id and ps.service_id = servico_id) then
    return jsonb_build_object('erro', nome_p || ' não faz ' || nome_s);
  end if;
  if not exists (select 1 from public.horarios_livres(profissional_id, dia, dur) h where h.hora = hora) then
    return jsonb_build_object('erro', 'esse horário não está mais livre', 'sugestao', public.bot_horarios(salao, profissional_id, dia, servico_id));
  end if;
  -- 3.98 (242): cliente nova (a casa confirma / só a equipe) e faltas além do limite: entra como pedido; o gatilho de
  -- aceite (avisa_profissional_do_agendamento) abre o pedido para a casa
  sit := public.situacao_da_cliente(salao, cliente);
  forcado := coalesce(((sit ->> 'nova')::boolean and sit ->> 'cliente_nova' in ('casa_confirma', 'so_equipe'))
                      or (sit ->> 'faltas')::integer >= (sit ->> 'limite_faltas')::integer, false)
             -- sem conta da profissional não há quem receba o pedido (o aceite não abre): entra confirmado, como antes
             and exists (select 1 from public.professionals p where p.id = profissional_id and p.user_id is not null);
  -- age em nome da cliente: os gatilhos (aceite, vínculo, avisos, limites) veem o uid dela; a origem diz que foi pelo WhatsApp
  perform set_config('request.jwt.claim.sub', cliente::text, true);
  perform set_config('mimo.origem', 'assistente', true);
  insert into public.appointments (client_id, professional_id, salon_id, service_id, date, start_time, end_time, status)
  values (cliente, profissional_id, salao, servico_id, dia, hora, (hora + make_interval(mins => dur))::time,
          case when coalesce(manual, false) or forcado then 'pendente' else 'confirmado' end)
  returning id into novo;
  perform set_config('mimo.origem', '', true);
  select status into virou from public.appointments where id = novo;
  return jsonb_build_object('ok', true, 'appointment_id', novo, 'status', virou, 'servico', nome_s, 'profissional', nome_p,
    'dia', to_char(dia, 'DD/MM'), 'hora', to_char(hora, 'HH24:MI'),
    'aviso', case when virou = 'pendente' and forcado then 'o salão confirma o horário; a cliente recebe a resposta por aqui'
                 when virou = 'pendente' then 'o salão confirma o horário; a cliente recebe a resposta por aqui' else 'já está confirmado' end);
exception
  when unique_violation or exclusion_violation then
    return jsonb_build_object('erro', 'esse horário acabou de ser reservado por outra pessoa');
  -- 3.98 (242): os limites da cliente (gatilho limites_da_cliente): ela não marca sozinha; a assistente chama a equipe
  when sqlstate 'MI001' then
    return jsonb_build_object('erro', sqlerrm, 'limite', true, 'chamar_equipe', true);
  when sqlstate 'MI002' then
    return jsonb_build_object('erro', sqlerrm, 'chamar_equipe', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.bot_marcar_simular(salao uuid, profissional_id uuid, servico_id uuid, dia date, hora time without time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_variable
declare dur integer; manual boolean; nome_s text; nome_p text; virou text; regra text;
begin
  select s.duration_minutes, s.name into dur, nome_s from public.services s where s.id = servico_id and s.salon_id = salao and s.active;
  if dur is null then return jsonb_build_object('erro', 'serviço não encontrado neste salão'); end if;
  select p.aceite_manual, p.name into manual, nome_p from public.professionals p where p.id = profissional_id and p.salon_id = salao and p.active;
  if nome_p is null then return jsonb_build_object('erro', 'profissional não encontrada'); end if;
  if not exists (select 1 from public.professional_services ps where ps.professional_id = profissional_id and ps.service_id = servico_id) then
    return jsonb_build_object('erro', nome_p || ' não faz ' || nome_s);
  end if;
  if not exists (select 1 from public.horarios_livres(profissional_id, dia, dur) h where h.hora = hora) then
    return jsonb_build_object('erro', 'esse horário não está mais livre', 'sugestao', public.bot_horarios(salao, profissional_id, dia, servico_id));
  end if;
  -- 3.98 (242): no teste quem escreve é uma cliente nova: vale a regra do salão para o primeiro horário
  select s.cliente_nova into regra from public.salons s where s.id = salao;
  if regra = 'so_equipe' then
    return jsonb_build_object('erro', 'O primeiro horário de cliente nova é marcado pela equipe do salão.', 'chamar_equipe', true);
  end if;
  virou := case when coalesce(manual, false) or regra = 'casa_confirma' then 'pendente' else 'confirmado' end;
  return jsonb_build_object('ok', true, 'status', virou, 'servico', nome_s, 'profissional', nome_p,
    'dia', to_char(dia, 'DD/MM'), 'hora', to_char(hora, 'HH24:MI'),
    'aviso', case when virou = 'pendente' and regra = 'casa_confirma' and not coalesce(manual, false) then 'o salão confirma o horário; a cliente recebe a resposta por aqui'
                 when virou = 'pendente' then 'o salão confirma o horário; a cliente recebe a resposta por aqui' else 'já está confirmado' end);
end;
$function$;
