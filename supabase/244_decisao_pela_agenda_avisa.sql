-- 244 · A casa confirmou ou recusou um pedido pela Agenda: a cliente é avisada e a troca se completa (3.98.2)
--
-- Os botões Confirmar e Recusar da Agenda do dia (painel do salão e da profissional) mudavam o status direto na tabela.
-- Por esse caminho ninguém avisava a cliente ("Agendamento confirmado!" não saía, nem no app nem no WhatsApp) e, numa
-- troca de horário, o horário de antes continuava na agenda. Recusar mandava "precisou cancelar", que não é o caso de um
-- pedido. O app novo passa a usar casa_decide; esta migração é a rede de segurança para qualquer outro caminho (o app
-- antigo guardado no celular, por exemplo): pedido (pendente) que a equipe confirma ou recusa avisa a cliente com o
-- mesmo texto de casa_decide e, se for troca, desmarca o horário de antes.
--
-- Quem já avisou (casa_decide, resolver_aceite, a troca, o cancelamento em cadeia) liga o silenciar_gatilho e este
-- gatilho fica quieto. A cliente desistindo do próprio pedido e o que nasce no servidor também não avisam.

create or replace function public.avisa_cliente_da_decisao()
returns trigger
language plpgsql
security definer set search_path = public
as $$
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
      perform public.notificar(new.client_id, 'pedido_aceito', coalesce(res.profissional, 'A equipe') || ' confirmou ' || coalesce(res.servico, 'seu horário'),
        coalesce(res.quando_longo, '') || '. ' || case when exists (select 1 from public.appointments x where x.visita_id = new.visita_id and x.id <> new.id and x.status = 'pendente')
                                                     then 'Falta a outra profissional confirmar a parte dela.' else 'Sua visita está completa. 🎉' end,
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
        coalesce(res.profissional, 'A equipe') || ' não pôde atender ' || coalesce(res.quando_longo, 'nesse horário') || '. Escolha outro horário.',
        pagina, jsonb_build_object('appointment_id', new.id, 'professional_id', new.professional_id));
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.avisa_cliente_da_decisao() from public, anon, authenticated;

drop trigger if exists tg_avisa_cliente_decisao on public.appointments;
create trigger tg_avisa_cliente_decisao
  after update of status on public.appointments
  for each row execute function public.avisa_cliente_da_decisao();

-- O aviso de cancelamento da 040 ("precisou cancelar") fica para horário que já estava confirmado. Pedido recusado é
-- com o gatilho de cima.
create or replace function public.avisa_cliente_do_cancelamento()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  agiu text;
  prof public.professionals%rowtype;
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

  perform public.notificar(
    new.client_id, 'profissional_cancelou', 'Horário cancelado',
    coalesce(prof.name, 'A profissional') || ' precisou cancelar.',
    '/',
    jsonb_build_object('appointment_id', new.id,
                       'professional_id', new.professional_id));
  return new;
end;
$$;
