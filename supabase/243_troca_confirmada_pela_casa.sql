-- 243 · A troca de horário confirmada pela casa desmarca o horário de antes e avisa "Remarcado!" (3.98.1)
--
-- A cliente pede a troca (pelo app ou pela assistente): nasce um horário novo, pendente, ligado ao de antes. Quando a
-- profissional tem conta no app, abre-se o pedido de aceite e, ao aceitar, resolver_aceite efetiva a troca (o de antes
-- sai da agenda) e avisa "Remarcado!". Quando ela não tem conta (o comum: a dona configura a equipe), não há pedido de
-- aceite e quem confirma é a casa, pelo quadro ou pelo PDV (casa_decide). Esse caminho confirmava o horário novo como se
-- fosse um horário qualquer: o de antes continuava confirmado (a cliente ficava com dois) e o aviso era "Agendamento
-- confirmado". Agora: aceitou, efetiva a troca e avisa "Remarcado!"; recusou, avisa que o horário de antes continua.

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
        coalesce(res.profissional, 'A equipe') || ' não pôde atender ' || coalesce(res.quando_longo, 'nesse horário') || '. Escolha outro horário.',
        pagina, jsonb_build_object('appointment_id', appt, 'professional_id', a.professional_id));
    end if;
  end if;
  return jsonb_build_object('ok', true, 'status', case when aceitou then 'confirmado' else 'cancelado' end);
end;
$function$;

revoke execute on function public.casa_decide(uuid, boolean) from public, anon;
grant execute on function public.casa_decide(uuid, boolean) to authenticated;
