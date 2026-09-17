-- 095 · Pago é confirmado; a casa também devolve o líquido
--
-- 1. A devolução nunca passa do que entrou na conta. Quando a casa
--    cancelava, o app mandava devolver o valor cheio, mas a taxa do PIX
--    nunca esteve na conta: o estorno falhava e ficava parado. Agora
--    todo estorno é do líquido (valor menos a taxa), quem quer que tenha
--    cancelado. As devoluções que ficaram presas por isso são corrigidas.
--
-- 2. Horário pago pelo app entra confirmado, sem passar pelo aceite.
--    Pedir "aceita ou recusa" de um horário já pago confundia as duas
--    pontas. A profissional recebe "Pago e confirmado"; se não puder
--    atender, cancela e o valor volta. Vale para: marcar pagando,
--    pagar depois num horário pendente, marcar usando crédito e a troca
--    de um horário pago (remarcação).

-- 1. Todo estorno é do líquido ------------------------------------------------------
create or replace function public.agenda_estorno_ao_cancelar()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  p public.pagamentos%rowtype;
  s public.salons%rowtype;
  horas integer;
  limite timestamp;
  pela_casa boolean;
  quanto integer;
  taxa integer;
  ate date;
  res record;
begin
  if new.status <> 'cancelado' or old.status = 'cancelado' or coalesce(new.pago_cents, 0) <= 0 then return new; end if;
  select * into p from public.pagamentos where appointment_id = new.id and status = 'pago' order by pago_em desc limit 1;
  if p.id is null then return new; end if;

  -- troca aceita (ou remarcada pela casa): o sinal vai junto para o novo horário
  if new.remarcado_para is not null then
    update public.pagamentos set appointment_id = new.remarcado_para, remarcado_de = coalesce(remarcado_de, new.id), atualizado_em = now() where id = p.id;
    update public.appointments set pago_cents = coalesce(pago_cents, 0) + p.valor_cents where id = new.remarcado_para;
    return new;
  end if;

  select * into s from public.salons where id = new.salon_id;
  horas := public.horas_da_politica(coalesce(s.politica_cancelamento, 'moderada'));
  limite := public.limite_devolucao(new.date + new.start_time, p.pago_em, horas);
  pela_casa := coalesce(new.cancelado_por, 'sistema') <> 'cliente';
  taxa := greatest(0, p.valor_cents - coalesce(p.liquido_cents, p.valor_cents));
  quanto := p.valor_cents - taxa;
  if new.client_id is not null then select * into res from public.resumo_do_agendamento(new.id); end if;

  if pela_casa or public.agora_local() <= limite then
    update public.pagamentos set status = 'estorno_pendente', estorno_cents = quanto, tentativas_estorno = 0, proxima_tentativa_em = null, erro = null,
      motivo_estorno = case when pela_casa then 'cancelado pela casa' else 'cancelado com antecedência' end, atualizado_em = now() where id = p.id;
    if new.client_id is not null then
      perform public.notificar(new.client_id, 'estorno_a_caminho', 'Seu dinheiro está voltando',
        'R$ ' || to_char(quanto / 100.0, 'FM999G999D00') || ' de ' || res.servico || ' voltam para a sua conta em até 1 dia útil.'
          || case when taxa > 0 then ' A taxa do PIX, R$ ' || to_char(taxa / 100.0, 'FM999G999D00') || ', não é devolvida.' else '' end,
        '/cliente/agendamento/' || new.id, jsonb_build_object('appointment_id', new.id));
    end if;
  else
    ate := greatest(new.date, public.agora_local()::date) + 30;
    update public.pagamentos set status = 'credito', credito_ate = ate, motivo_estorno = 'cancelado depois do prazo: virou crédito', atualizado_em = now() where id = p.id;
    if new.client_id is not null then
      perform public.notificar(new.client_id, 'sinal_em_credito', 'Seu sinal virou crédito',
        'Como faltavam menos de ' || horas || ' h, o sinal de R$ ' || to_char(p.valor_cents / 100.0, 'FM999G999D00') || ' não volta, mas fica como crédito com '
          || coalesce(s.name, 'a profissional') || ' até ' || to_char(ate, 'DD/MM') || '. Marque de novo e ele entra como sinal.',
        '/cliente/agendamento/' || new.id, jsonb_build_object('appointment_id', new.id, 'salon_id', new.salon_id));
    end if;
  end if;
  return new;
end;
$$;

-- as devoluções que ficaram presas pedindo mais do que entrou: corrige e tenta de novo
update public.pagamentos
set estorno_cents = coalesce(liquido_cents, valor_cents), tentativas_estorno = 0, proxima_tentativa_em = null, erro = null, atualizado_em = now()
where status = 'estorno_pendente' and estorno_cents > coalesce(liquido_cents, valor_cents);

-- 2. Pago é confirmado ------------------------------------------------------------------
-- avisa quem recebe que o horário chegou pago (e já confirmado)
create or replace function public.avisar_horario_pago(appt uuid, remarcou boolean default false)
returns void
language plpgsql
security definer set search_path = public
as $$
declare a public.appointments%rowtype; q record; res record; nome_cli text; texto text;
begin
  select * into a from public.appointments where id = appt;
  if a.id is null then return; end if;
  select * into res from public.resumo_do_agendamento(appt);
  select coalesce(nullif(btrim(pf.full_name), ''), 'A cliente') into nome_cli from public.profiles pf where pf.id = a.client_id;
  texto := coalesce(nome_cli, 'A cliente') || case when remarcou then ' remarcou ' else ' pagou ' end
        || case when remarcou then res.servico || ' para ' || res.quando_longo || ' e o sinal de R$ ' || to_char(coalesce(a.pago_cents, 0) / 100.0, 'FM999G999D00') || ' foi junto.'
                else 'R$ ' || to_char(coalesce(a.pago_cents, 0) / 100.0, 'FM999G999D00') || case when coalesce(a.pago_cents, 0) < coalesce(a.price_cents, 0) then ' de sinal' else '' end
                     || ' de ' || res.servico || ', ' || res.quando_longo || '.' end
        || ' Já está confirmado na sua agenda. Se não puder atender, cancele por aqui e o valor volta para ela.';
  for q in select * from public.quem_responde_por(a.professional_id) loop
    perform public.notificar(q.user_id, 'agendamento_pago', case when remarcou then 'Remarcação paga e confirmada' else 'Horário pago e confirmado' end, texto,
      case when q.papel = 'salao' then '/admin/agenda' else '/pro' end,
      jsonb_build_object('appointment_id', a.id, 'professional_id', a.professional_id));
  end loop;
end;
$$;
revoke execute on function public.avisar_horario_pago(uuid, boolean) from public, anon, authenticated;

-- o gatilho do horário novo: pago não passa pelo aceite
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
  pagina text;
  pago boolean;
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

  -- pago pelo app (ou troca de um horário pago): entra confirmado, sem aceite
  pago := coalesce(new.pago_cents, 0) > 0
          or (new.remarca_de is not null and exists (select 1 from public.appointments o where o.id = new.remarca_de and coalesce(o.pago_cents, 0) > 0));
  if pago then
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

  perform public.notificar(
    conta, 'novo_agendamento', 'Horário novo na sua agenda', null, '/pro',
    jsonb_build_object('appointment_id', new.id,
                       'professional_id', new.professional_id));

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

-- o PIX caiu: o horário confirma, um aceite aberto se resolve sozinho
create or replace function public.confirmar_pagamento(pagamento uuid, cobranca text, liquido integer default null, quando timestamptz default now())
returns jsonb
language plpgsql
security definer set search_path = public
as $$
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
      || case when a.status = 'confirmado' then ' Seu horário está confirmado.' when a.status = 'pendente' then ' Agora é só esperar a confirmação da profissional.' else '' end,
    '/cliente/agendamento/' || a.id, jsonb_build_object('appointment_id', a.id, 'professional_id', a.professional_id));

  return jsonb_build_object('ok', true, 'appointment_id', a.id, 'status', a.status);
end;
$$;
revoke execute on function public.confirmar_pagamento(uuid, text, integer, timestamptz) from public, anon, authenticated;

-- a troca de um horário pago não espera aceite: já nasce confirmada e o sinal vai junto
create or replace function public.pedir_remarcacao(appt uuid, nova_data date, nova_hora time)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  a public.appointments%rowtype;
  dur integer;
  novo uuid;
  virou text;
  minutos integer;
begin
  select * into a from public.appointments where id = appt;
  if not found or a.client_id is distinct from auth.uid() then
    raise exception 'esse horário não é seu';
  end if;

  if a.status not in ('pendente', 'confirmado') then
    return jsonb_build_object('ok', false, 'motivo', 'esse horário não pode mais ser remarcado');
  end if;
  if a.remarca_de is not null and a.status = 'pendente' then
    return jsonb_build_object('ok', false, 'motivo', 'isso já é um pedido de remarcação');
  end if;
  if exists (select 1 from public.appointments
             where remarca_de = appt and status = 'pendente') then
    return jsonb_build_object('ok', false, 'motivo', 'já existe um pedido aberto para esse horário');
  end if;
  if (nova_data + nova_hora) <= public.agora_local() then
    return jsonb_build_object('ok', false, 'motivo', 'esse horário já passou');
  end if;
  if nova_data = a.date and nova_hora = a.start_time then
    return jsonb_build_object('ok', false, 'motivo', 'é o mesmo horário de agora');
  end if;

  dur := (extract(epoch from (a.end_time - a.start_time)) / 60)::integer;

  if nova_data = a.date
     and nova_hora < a.end_time
     and (nova_hora + make_interval(mins => dur))::time > a.start_time then
    return jsonb_build_object('ok', false,
      'motivo', 'esse horário cruza com o seu horário atual. Escolha um que não encoste nele, ou cancele e marque de novo');
  end if;

  if not exists (select 1 from public.horarios_livres(a.professional_id, nova_data, dur) h
                 where h.hora = nova_hora) then
    return jsonb_build_object('ok', false, 'motivo', 'esse horário não está mais livre');
  end if;

  -- nasce pendente e ligado ao antigo. O gatilho do insert faz o resto:
  -- abre o pedido se ela pede confirmação, confirma se não pede, e
  -- confirma direto se o horário de origem está pago.
  begin
    insert into public.appointments
      (client_id, professional_id, salon_id, service_id, service_name,
       price_cents, date, start_time, end_time, notes, status, remarca_de)
    values
      (a.client_id, a.professional_id, a.salon_id, a.service_id, a.service_name,
       a.price_cents, nova_data, nova_hora,
       (nova_hora + make_interval(mins => dur))::time,
       a.notes, 'pendente', appt)
    returning id into novo;
  exception when unique_violation or exclusion_violation then
    return jsonb_build_object('ok', false, 'motivo', 'esse horário acabou de ser reservado por outra pessoa');
  end;

  select status into virou from public.appointments where id = novo;
  select minutos_para_aceitar into minutos
  from public.professionals where id = a.professional_id;

  if virou = 'confirmado' then
    -- ela não pede confirmação (ou o horário estava pago): a troca já aconteceu
    perform public.efetivar_remarcacao(novo);
    perform public.notificar(
      a.client_id, 'remarcacao_aceita', 'Remarcado!', null,
      '/cliente/meus-agendamentos',
      jsonb_build_object('appointment_id', novo, 'professional_id', a.professional_id));
  end if;

  return jsonb_build_object('ok', true,
    'appointment_id', novo,
    'pendente', virou = 'pendente',
    'minutos', minutos);
end;
$$;
revoke execute on function public.pedir_remarcacao(uuid, date, time) from public, anon;
grant execute on function public.pedir_remarcacao(uuid, date, time) to authenticated;

insert into public.modelos_de_mensagem (chave, grupo, titulo, descricao, variaveis, padrao, ordem, exemplo) values
('push.agendamento_pago', 'push', 'Horário pago e confirmado', 'A profissional (ou a dona) sabe que entrou um horário pago pelo app, já confirmado.', '{titulo,texto,nome}', E'{titulo}\n{texto}', 812,
  '{"titulo":"Horário pago e confirmado","texto":"Juliana pagou R$ 35,00 de sinal de Manicure, sábado, 20/09 às 10:00. Já está confirmado na sua agenda. Se não puder atender, cancele por aqui e o valor volta para ela."}')
on conflict (chave) do update set grupo = excluded.grupo, titulo = excluded.titulo, descricao = excluded.descricao,
  variaveis = excluded.variaveis, ordem = excluded.ordem, exemplo = excluded.exemplo;
insert into public.push_regras (kind, envia) values ('agendamento_pago', true) on conflict (kind) do nothing;
