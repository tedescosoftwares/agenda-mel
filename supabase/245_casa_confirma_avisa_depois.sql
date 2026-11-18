-- 245 · "A casa confirma": o pedido é só da casa e a profissional fica sabendo depois de confirmado (3.98.3)
--
-- No modo "a casa confirma", o pedido de horário ia para a casa E para a profissional ("Responda 1 para aceitar"), e
-- valia quem respondesse primeiro. Junto com o pedido, a profissional ainda recebia "Horário novo na sua agenda" (ou
-- "Cliente remarcou ✅ agora…"), que parece confirmação, com o pedido ainda aberto. E quando a profissional não tinha
-- conta no app (o comum: a dona cadastra a equipe), nem pedido abria: a casa não recebia alerta, não havia prazo e o
-- horário ficava pendente até alguém ver no quadro.
--
-- Agora, no modo "a casa confirma":
--   • o pedido é só da casa (aceites.so_a_casa), com prazo, tenha a profissional conta ou não; ela não recebe pedido,
--     não vê na lista dela e o "1" dela no WhatsApp não decide;
--   • confirmado (pela casa, pela Agenda, pelo PDV ou pelo prazo), a profissional recebe "Horário novo na sua agenda"
--     ou "Cliente remarcou" — se o salão quiser (salons.casa_avisa_profissional, o seletor novo em "A casa confirma");
--   • recusado, ou a cliente desistiu antes: a profissional não recebe nada (ela nem soube do pedido).
-- Em todos os modos volta a regra do aviso único (078), que a 095 tinha perdido: quando abre um pedido, a profissional
-- não recebe "Horário novo na sua agenda" junto. No resto, "entra confirmado" e "cada profissional decide" ficam iguais.

-- 1. A escolha do salão e a marca no pedido ---------------------------------------------------------------------
alter table public.salons add column if not exists casa_avisa_profissional boolean not null default true;
alter table public.aceites add column if not exists so_a_casa boolean not null default false;

-- 2. Ler e mudar a escolha (o seletor em "A casa confirma"); sem `avisa`, só lê ------------------------------------
create or replace function public.salao_avisa_profissional(salao uuid, avisa boolean default null)
returns boolean
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_admin_do_salao(salao) then raise exception 'Só quem manda no salão muda isso.'; end if;
  if avisa is not null then
    update public.salons set casa_avisa_profissional = avisa where id = salao;
  end if;
  return (select s.casa_avisa_profissional from public.salons s where s.id = salao);
end;
$$;

revoke execute on function public.salao_avisa_profissional(uuid, boolean) from public, anon;
grant execute on function public.salao_avisa_profissional(uuid, boolean) to authenticated;

-- 3. O pedido da casa (não vai para a profissional) ------------------------------------------------------------------
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
  so_casa := coalesce((select s.aceite_modo = 'casa' from public.salons s where s.id = a.salon_id), false);
  if p.user_id is null and not so_casa then
    return jsonb_build_object('ok', false, 'motivo', 'profissional sem conta');
  end if;

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

-- 4. Um aviso só: nada de "Horário novo" junto com o pedido ----------------------------------------------------------
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
$function$;

-- 5. Pedido da casa que cai antes de confirmar: nada para a profissional ---------------------------------------------
CREATE OR REPLACE FUNCTION public.avisa_profissional_do_cancelamento()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  conta uuid;
  agiu text;
  tinha_pedido boolean := false;
  so_casa boolean;
begin
  if new.status <> 'cancelado' or old.status = 'cancelado' then
    return new;
  end if;

  -- um pedido aberto para um horário que não existe mais não pode
  -- continuar esperando resposta
  update public.aceites
  set resultado = 'desistiu', resolvido_em = now()
  where appointment_id = new.id and resultado is null;
  tinha_pedido := found;

  -- 245: pedido só da casa que caiu antes de confirmar (a casa recusou, a cliente desistiu, venceu): a profissional
  -- nunca soube dele, então não tem o que avisar
  select coalesce(bool_or(x.so_a_casa), false) into so_casa from public.aceites x where x.appointment_id = new.id;
  if old.status = 'pendente' and so_casa then
    return new;
  end if;

  if public.gatilho_silenciado() then
    return new;
  end if;

  agiu := public.quem_age_e(new);
  if agiu in ('profissional', 'salao') then
    return new;
  end if;

  conta := public.conta_da_profissional(new.professional_id);
  if conta is null or conta = new.client_id then
    return new;
  end if;

  perform public.notificar(
    conta, 'cancelou_comigo',
    case when tinha_pedido then 'A cliente desistiu do pedido'
         else 'Cancelaram um horário' end,
    null, '/pro',
    jsonb_build_object('appointment_id', new.id,
                       'professional_id', new.professional_id,
                       'desistiu', tinha_pedido));
  return new;
end;
$function$;

-- 6. A lista de pedidos da profissional sem os da casa ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.meus_pedidos()
 RETURNS TABLE(appointment_id uuid, cliente text, servico text, quando text, faltam_min integer, remarcacao boolean, antes text, atendimentos integer, faltas integer, cancelamentos integer, remarcacoes integer, ficha jsonb, por_historico boolean, visita text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    -- 245: pedido só da casa não aparece para a profissional
    and (public.is_admin_do_salao(ac.salon_id)
         or (public.is_professional(ac.professional_id) and not ac.so_a_casa))
  order by ac.expira_em;
$function$;

-- 7. A profissional não decide o pedido da casa pelo app -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.responder_pedido(appt uuid, aceitou boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  dona uuid;
begin
  select professional_id into dona from public.aceites where appointment_id = appt;
  if dona is null then
    return jsonb_build_object('ok', false, 'motivo', 'pedido não existe');
  end if;
  if not (public.is_professional(dona) or public.is_admin_do_salao(
            (select salon_id from public.aceites where appointment_id = appt))) then
    raise exception 'esse pedido não é seu';
  end if;
  -- 245: pedido só da casa: quem decide é a casa
  if not public.is_admin_do_salao((select salon_id from public.aceites where appointment_id = appt))
     and exists (select 1 from public.aceites where appointment_id = appt and so_a_casa) then
    raise exception 'Quem confirma esse pedido é a casa.';
  end if;
  return public.resolver_aceite(appt, aceitou);
end;
$function$;

-- 8. Confirmado o pedido da casa, a profissional fica sabendo (se o salão quiser) ---------------------------------
-- Vale por qualquer caminho: casa_decide (quadro, PDV, Agenda), o prazo vencido que confirma sozinho, o app antigo.
-- O texto do WhatsApp é o de sempre: "Horário novo na sua agenda" ou, na troca, "Cliente remarcou · era / ✅ agora".
create or replace function public.avisa_profissional_ao_confirmar()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  conta uuid;
  avisa boolean;
begin
  if old.status <> 'pendente' or new.status <> 'confirmado' then
    return new;
  end if;
  if not exists (select 1 from public.aceites x where x.appointment_id = new.id and x.so_a_casa) then
    return new;                      -- não era pedido da casa: ela já foi avisada quando o horário nasceu
  end if;
  select s.casa_avisa_profissional into avisa from public.salons s where s.id = new.salon_id;
  if not coalesce(avisa, true) then
    return new;
  end if;
  select p.user_id into conta from public.professionals p where p.id = new.professional_id;
  if conta is null or conta = new.client_id or conta = auth.uid() then
    return new;                      -- sem conta, é a própria cliente, ou foi ela mesma quem confirmou
  end if;
  perform public.notificar(
    conta, 'novo_agendamento',
    case when new.remarca_de is not null then 'Cliente remarcou' else 'Horário novo na sua agenda' end,
    null, '/pro',
    jsonb_build_object('appointment_id', new.id, 'professional_id', new.professional_id));
  return new;
end;
$$;

revoke execute on function public.avisa_profissional_ao_confirmar() from public, anon, authenticated;

drop trigger if exists tg_avisa_profissional_confirmado on public.appointments;
create trigger tg_avisa_profissional_confirmado
  after update of status on public.appointments
  for each row execute function public.avisa_profissional_ao_confirmar();
