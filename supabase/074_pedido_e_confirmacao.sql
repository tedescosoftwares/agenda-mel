-- 074 · O que a cliente ouve ao pedir e ao ser confirmada
--
-- Antes: a cliente marcava e não recebia nada; a profissional aceitava
-- e chegava só "Horário confirmado", sem dizer o quê, levando para a
-- home. Agora:
--
--   pedido_enviado          "Pedido enviado! ⏳ Manicure com Ana, sáb 12/09 às 14:00.
--                            Aguardando a confirmação da profissional."
--   pedido_aceito           "Agendamento confirmado! 🎉 Manicure com Ana, sábado, 12/09 às 14:00."
--   pedido_recusado         idem, com o serviço e a sugestão de escolher outro
--   agendamento_confirmado  (sem aceite) "Agendamento confirmado! 🎉" com os dados
--
-- Todos apontam para /cliente/agendamento/<id>, a página do agendamento
-- (2.16), e levam appointment_id na carga.
--
--   resumo_do_agendamento(appt)   serviço, profissional, quando (curto e longo)

create or replace function public.resumo_do_agendamento(appt uuid)
returns table (servico text, profissional text, quando text, quando_longo text)
language sql
stable
security definer set search_path = public
as $$
  select coalesce(a.service_name, s.name, 'Seu atendimento'),
         coalesce(p.name, 'sua profissional'),
         to_char(a.date, 'DD/MM') || ' às ' || to_char(a.start_time, 'HH24:MI'),
         public.dia_por_extenso(a.date) || ' às ' || to_char(a.start_time, 'HH24:MI')
  from public.appointments a
  left join public.services s on s.id = a.service_id
  left join public.professionals p on p.id = a.professional_id
  where a.id = appt;
$$;
revoke execute on function public.resumo_do_agendamento(uuid) from public, anon, authenticated;

-- 1. Agendamento novo: a profissional é avisada (como antes) e a cliente
--    também, do jeito certo para cada caso
create or replace function public.avisa_profissional_do_agendamento()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  conta uuid;
  manual boolean;
  eh_dona boolean;
  r jsonb;
  pediu boolean := false;
  res record;
  pagina text;
begin
  if new.status = 'cancelado' then
    return new;
  end if;

  select p.user_id, p.aceite_manual into conta, manual
  from public.professionals p where p.id = new.professional_id;

  if conta is null then
    return new;                      -- profissional sem conta de login
  end if;

  if conta = new.client_id or conta = auth.uid() then
    return new;                      -- ela mesma, olhando a tela
  end if;

  eh_dona := public.is_admin_do_salao(new.salon_id);

  if coalesce(manual, false) and not eh_dona and new.status = 'pendente' then
    -- a cliente marcou e a profissional quer decidir: abre o pedido
    r := public.pedir_aceite(new.id);
    if coalesce((r ->> 'ok')::boolean, false) then
      pediu := true;
    else
      -- não deu para perguntar (sem telefone): confirma e avisa, porque
      -- deixar pendente para sempre é pior do que decidir
      update public.appointments set status = 'confirmado' where id = new.id;
    end if;
  elsif new.status = 'pendente' then
    update public.appointments set status = 'confirmado' where id = new.id;
  end if;

  perform public.notificar(
    conta, 'novo_agendamento', 'Horário novo na sua agenda', null, '/pro',
    jsonb_build_object('appointment_id', new.id,
                       'professional_id', new.professional_id));

  -- a cliente: o pedido foi, ou já está confirmado. Só quando foi ela
  -- quem marcou (a casa marcando por ela cai no return lá em cima).
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

-- 2. A resposta da profissional diz o que foi confirmado e leva ao agendamento
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

-- 3. O tipo novo nas regras e nos modelos
insert into public.email_regras (kind, envia, chamada) values ('pedido_enviado', true, 'Ver meu pedido') on conflict (kind) do nothing;
insert into public.modelos_de_mensagem (chave, grupo, titulo, descricao, variaveis, padrao, ordem, exemplo) values
('push.pedido_enviado', 'push', 'Pedido enviado', 'A cliente marcou e a profissional ainda vai confirmar.', '{titulo,texto,nome,servico,profissional,quando}', E'{titulo}\n{texto}', 702,
  '{"titulo":"Pedido enviado! ⏳","texto":"Manicure com Ana Oliveira, sábado, 12/09 às 14:00. Aguardando a confirmação da profissional."}')
on conflict (chave) do update set grupo = excluded.grupo, titulo = excluded.titulo, descricao = excluded.descricao,
  variaveis = excluded.variaveis, padrao = excluded.padrao, ordem = excluded.ordem, exemplo = excluded.exemplo;
update public.modelos_de_mensagem set exemplo = '{"titulo":"Agendamento confirmado! 🎉","texto":"Manicure com Ana Oliveira, sábado, 12/09 às 14:00."}' where chave = 'push.pedido_aceito';
update public.modelos_de_mensagem set exemplo = '{"titulo":"Agendamento confirmado! 🎉","texto":"Manicure com Ana Oliveira, sábado, 12/09 às 14:00."}' where chave = 'push.agendamento_confirmado';
update public.modelos_de_mensagem set exemplo = '{"titulo":"Horário não confirmado","texto":"Ana Oliveira não pôde atender sábado, 12/09 às 14:00. Escolha outro horário."}' where chave = 'push.pedido_recusado';
update public.modelos_de_mensagem set exemplo = '{"titulo":"Remarcado! 🎉","texto":"Manicure com Ana Oliveira agora é sábado, 12/09 às 14:00."}' where chave = 'push.remarcacao_aceita';
insert into public.push_regras (kind, envia) values ('pedido_enviado', true) on conflict (kind) do nothing;
