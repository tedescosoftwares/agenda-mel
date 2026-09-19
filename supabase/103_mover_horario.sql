-- 103 · Mover um horário pelo quadro do PDV: outra hora e, se quiser,
-- outra profissional. Mesma mecânica do remarcar_por_fora (o horário
-- antigo vira "remarcado pela casa" e nasce um novo, confirmado), só
-- que a profissional pode mudar. A cliente é avisada do novo horário.
create or replace function public.mover_horario(appt uuid, nova_data date, nova_hora time, nova_prof uuid default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare a public.appointments%rowtype; p public.professionals%rowtype; novo uuid; dur interval; fim time; res record; mudou_prof boolean;
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
  -- mesma profissional: o caminho que já existe
  if not mudou_prof then return public.remarcar_por_fora(appt, nova_data, nova_hora); end if;

  perform public.silenciar_gatilho();
  update public.aceites set resultado = 'recusado', resolvido_em = now()
    where appointment_id in (select t.id from public.appointments t where t.remarca_de = appt and t.status = 'pendente') and resultado is null;
  update public.appointments set status = 'cancelado', cancelado_por = 'sistema', motivo_cancelamento = 'remarcado_pela_casa'
    where remarca_de = appt and status = 'pendente';
  insert into public.appointments (client_id, professional_id, service_id, service_name, price_cents, salon_id, notes, guest_name, guest_phone,
                                   date, start_time, end_time, status, remarca_de)
  values (a.client_id, p.id, a.service_id, a.service_name, a.price_cents, a.salon_id, a.notes, a.guest_name, a.guest_phone,
          nova_data, nova_hora, fim, 'confirmado', appt)
  returning id into novo;
  perform public.efetivar_remarcacao(novo);
  if a.client_id is not null then
    select * into res from public.resumo_do_agendamento(novo);
    perform public.notificar(a.client_id, 'remarcacao_aceita', 'Remarcado! 🎉',
      res.servico || ' agora é ' || res.quando_longo || ', com ' || p.name || '.',
      '/cliente/agendamento/' || novo::text, jsonb_build_object('appointment_id', novo, 'professional_id', p.id));
  end if;
  return jsonb_build_object('ok', true, 'appointment_id', novo);
end;
$$;
revoke execute on function public.mover_horario(uuid, date, time, uuid) from public, anon;
grant execute on function public.mover_horario(uuid, date, time, uuid) to authenticated;
