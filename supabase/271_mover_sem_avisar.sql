-- =============================================================
-- MIMO — 271: mover horário sem avisar (4.30)
--
-- Arrastar um cartão na agenda sempre avisava a cliente. Um arrasto por engano, ou um acerto combinado por fora,
-- virava notificação à toa. Agora quem move escolhe: mover_horario e remarcar_por_fora ganham o parâmetro
-- "avisar" (padrão true, como era). Com aviso, a profissional com conta também fica sabendo (antes só a cliente
-- recebia): a que ficou com o horário e, quando muda de mãos, a que perdeu. Sem aviso, ninguém recebe nada.
--
-- A assinatura muda, então as versões antigas saem antes (senão ficariam duas funções com o mesmo nome).
-- =============================================================

drop function if exists public.mover_horario(uuid, date, time, uuid);
drop function if exists public.remarcar_por_fora(uuid, date, time);

create or replace function public.remarcar_por_fora(appt uuid, nova_data date, nova_hora time, avisar boolean default true)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare a public.appointments%rowtype; novo uuid; dur interval; fim time; res record; conta_prof uuid; nome_cli text;
begin
  select * into a from public.appointments where id = appt;
  if not found then raise exception 'Agendamento não encontrado.'; end if;
  if not (public.is_professional(a.professional_id) or public.is_admin_do_salao(a.salon_id)) then raise exception 'Sem permissão.'; end if;
  if a.status not in ('confirmado', 'pendente') then raise exception 'Este horário não pode mais ser remarcado.'; end if;
  if (nova_data + nova_hora) < public.agora_local() - interval '10 minutes' then raise exception 'O novo horário precisa estar no futuro.'; end if;
  dur := a.end_time - a.start_time;
  fim := nova_hora + dur;
  if exists (select 1 from public.appointments x
             where x.professional_id = a.professional_id and x.date = nova_data and x.id <> appt
               and x.status not in ('cancelado', 'faltou')
               and nova_hora < x.end_time and fim > x.start_time) then
    return jsonb_build_object('ok', false, 'motivo', 'ocupado');
  end if;

  perform public.silenciar_gatilho();
  update public.aceites set resultado = 'recusado', resolvido_em = now()
    where appointment_id in (select t.id from public.appointments t where t.remarca_de = appt and t.status = 'pendente') and resultado is null;
  update public.appointments set status = 'cancelado', cancelado_por = 'sistema', motivo_cancelamento = 'remarcado_pela_casa'
    where remarca_de = appt and status = 'pendente';
  -- o antigo sai da frente antes de o novo nascer (senão o novo bate nele quando encosta)
  update public.appointments set status = 'cancelado', cancelado_por = 'sistema', motivo_cancelamento = 'remarcado_pela_casa' where id = appt;

  insert into public.appointments (client_id, professional_id, service_id, service_name, price_cents, salon_id, notes, guest_name, guest_phone,
                                   date, start_time, end_time, status, remarca_de, pago_cents)
  values (a.client_id, a.professional_id, a.service_id, a.service_name, a.price_cents, a.salon_id, a.notes, a.guest_name, a.guest_phone,
          nova_data, nova_hora, fim, 'confirmado', appt, a.pago_cents)
  returning id into novo;
  update public.appointments set remarcado_para = novo where id = appt;
  insert into public.appointment_services (appointment_id, service_id, name, price_cents, duration_minutes, ordem)
  select novo, s.service_id, s.name, s.price_cents, s.duration_minutes, s.ordem from public.appointment_services s where s.appointment_id = appt;
  update public.pagamentos set appointment_id = novo where appointment_id = appt and status in ('pago', 'credito');

  -- 271: quem moveu escolhe se avisa. Sem aviso, nem a cliente nem a profissional recebem nada.
  if avisar then
    select * into res from public.resumo_do_agendamento(novo);
    if a.client_id is not null then
      perform public.notificar(a.client_id, 'remarcacao_aceita', 'Remarcado! 🎉',
        res.servico || ' com ' || res.profissional || ' agora é ' || res.quando_longo || '.',
        '/cliente/agendamento/' || novo::text, jsonb_build_object('appointment_id', novo, 'professional_id', a.professional_id));
    end if;
    -- a profissional com conta fica sabendo, quando não foi ela mesma que moveu
    select pr.user_id into conta_prof from public.professionals pr where pr.id = a.professional_id;
    select coalesce(nullif(btrim(pf.full_name), ''), a.guest_name, 'A cliente') into nome_cli from (select 1) x left join public.profiles pf on pf.id = a.client_id;
    if conta_prof is not null and conta_prof is distinct from auth.uid() then
      perform public.notificar(conta_prof, 'novo_agendamento', 'Horário remarcado pelo salão',
        nome_cli || ': ' || coalesce(res.servico, 'atendimento') || ' agora é ' || res.quando_longo || '.',
        '/profissional', jsonb_build_object('appointment_id', novo, 'professional_id', a.professional_id));
    end if;
  end if;
  return jsonb_build_object('ok', true, 'appointment_id', novo);
end;
$$;
revoke execute on function public.remarcar_por_fora(uuid, date, time, boolean) from public, anon;
grant execute on function public.remarcar_por_fora(uuid, date, time, boolean) to authenticated;

create or replace function public.mover_horario(appt uuid, nova_data date, nova_hora time, nova_prof uuid default null, avisar boolean default true)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare a public.appointments%rowtype; p public.professionals%rowtype; novo uuid; dur interval; fim time; res record; mudou_prof boolean; conta_nova uuid; conta_antiga uuid; nome_cli text;
begin
  select * into a from public.appointments where id = appt;
  if not found then raise exception 'Agendamento não encontrado.'; end if;
  if not public.is_admin_do_salao(a.salon_id) then raise exception 'Só a dona do salão move horários pelo quadro.'; end if;
  if a.status not in ('confirmado', 'pendente') then raise exception 'Este horário não pode mais ser movido (%).', a.status; end if;
  if (nova_data + nova_hora) < public.agora_local() - interval '10 minutes' then raise exception 'O novo horário precisa estar no futuro.'; end if;
  select * into p from public.professionals where id = coalesce(nova_prof, a.professional_id);
  if p.id is null or p.salon_id <> a.salon_id or not p.active then raise exception 'Profissional não encontrada neste salão.'; end if;
  mudou_prof := p.id <> a.professional_id;
  if mudou_prof and a.service_id is not null and not exists (select 1 from public.professional_services ps where ps.professional_id = p.id and ps.service_id = a.service_id) then
    return jsonb_build_object('ok', false, 'motivo', 'nao_faz', 'profissional', p.name);
  end if;
  dur := a.end_time - a.start_time;
  fim := nova_hora + dur;
  if exists (select 1 from public.appointments x
             where x.professional_id = p.id and x.date = nova_data and x.id <> appt
               and x.status not in ('cancelado', 'faltou')
               and nova_hora < x.end_time and fim > x.start_time) then
    return jsonb_build_object('ok', false, 'motivo', 'ocupado');
  end if;
  if not mudou_prof then return public.remarcar_por_fora(appt, nova_data, nova_hora, avisar); end if;

  perform public.silenciar_gatilho();
  update public.aceites set resultado = 'recusado', resolvido_em = now()
    where appointment_id in (select t.id from public.appointments t where t.remarca_de = appt and t.status = 'pendente') and resultado is null;
  update public.appointments set status = 'cancelado', cancelado_por = 'sistema', motivo_cancelamento = 'remarcado_pela_casa'
    where remarca_de = appt and status = 'pendente';
  update public.appointments set status = 'cancelado', cancelado_por = 'sistema', motivo_cancelamento = 'remarcado_pela_casa' where id = appt;
  insert into public.appointments (client_id, professional_id, service_id, service_name, price_cents, salon_id, notes, guest_name, guest_phone,
                                   date, start_time, end_time, status, remarca_de, pago_cents)
  values (a.client_id, p.id, a.service_id, a.service_name, a.price_cents, a.salon_id, a.notes, a.guest_name, a.guest_phone,
          nova_data, nova_hora, fim, 'confirmado', appt, a.pago_cents)
  returning id into novo;
  update public.appointments set remarcado_para = novo where id = appt;
  insert into public.appointment_services (appointment_id, service_id, name, price_cents, duration_minutes, ordem)
  select novo, s.service_id, s.name, s.price_cents, s.duration_minutes, s.ordem from public.appointment_services s where s.appointment_id = appt;
  update public.pagamentos set appointment_id = novo where appointment_id = appt and status in ('pago', 'credito');
  -- 271: quem moveu escolhe se avisa. Com aviso: a cliente, a profissional que recebeu e a que perdeu o horário.
  if avisar then
    select * into res from public.resumo_do_agendamento(novo);
    select coalesce(nullif(btrim(pf.full_name), ''), a.guest_name, 'A cliente') into nome_cli from (select 1) x left join public.profiles pf on pf.id = a.client_id;
    if a.client_id is not null then
      perform public.notificar(a.client_id, 'remarcacao_aceita', 'Remarcado! 🎉',
        res.servico || ' agora é ' || res.quando_longo || ', com ' || p.name || '.',
        '/cliente/agendamento/' || novo::text, jsonb_build_object('appointment_id', novo, 'professional_id', p.id));
    end if;
    conta_nova := p.user_id;
    select pr.user_id into conta_antiga from public.professionals pr where pr.id = a.professional_id;
    if conta_nova is not null and conta_nova is distinct from auth.uid() then
      perform public.notificar(conta_nova, 'novo_agendamento', 'Horário novo na sua agenda',
        'O salão passou para você: ' || nome_cli || ', ' || coalesce(res.servico, 'atendimento') || ', ' || res.quando_longo || '.',
        '/profissional', jsonb_build_object('appointment_id', novo, 'professional_id', p.id));
    end if;
    if conta_antiga is not null and conta_antiga is distinct from auth.uid() and conta_antiga is distinct from conta_nova then
      perform public.notificar(conta_antiga, 'cancelou_comigo', 'Um horário saiu da sua agenda',
        'O salão passou ' || nome_cli || ' (' || to_char(a.date, 'DD/MM') || ' às ' || to_char(a.start_time, 'HH24:MI') || ') para ' || p.name || '.',
        '/profissional', jsonb_build_object('appointment_id', appt, 'professional_id', a.professional_id));
    end if;
  end if;
  return jsonb_build_object('ok', true, 'appointment_id', novo);
end;
$$;
revoke execute on function public.mover_horario(uuid, date, time, uuid, boolean) from public, anon;
grant execute on function public.mover_horario(uuid, date, time, uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
