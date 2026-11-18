-- Ensaio da 245 (3.98.3): no modo "a casa confirma", o pedido é só da casa e a profissional fica sabendo depois de
-- confirmado (se o salão quiser). No modo "cada profissional decide", um aviso só (a regra da 078). Desfaz no fim.
begin;
do $$
declare salao uuid; prof uuid; conta_prof uuid; serv uuid; adm uuid; r jsonb; ped uuid; novo uuid; d1 date; d2 date;
        livres jsonb; i int; n int; deu boolean; t text;
        c uuid := '00000000-0000-0000-0000-00000000c0f4'; c2 uuid := '00000000-0000-0000-0000-00000000c0f5';
begin
  select p.id, p.salon_id, p.user_id into prof, salao, conta_prof from public.professionals p where p.slug = 'ana-paula';
  select ps.service_id into serv from public.professional_services ps where ps.professional_id = prof limit 1;
  select m.user_id into adm from public.salon_members m where m.salon_id = salao and m.papel = 'admin' limit 1;
  if conta_prof is null or adm is null or adm = conta_prof then raise exception 'preparo: precisa da profissional com conta e de uma admin'; end if;
  insert into public.whatsapp_channels (salon_id, canal, identificador, ativo, usa_ia, numero_proprio) values (salao, 'evolution', 'salao-x', true, true, true)
  on conflict (salon_id) do update set canal = 'evolution', identificador = 'salao-x', ativo = true, numero_proprio = true;
  update public.salons set aceite_modo = 'casa', casa_avisa_profissional = true, cliente_nova = 'igual', limite_futuros = 5, limite_faltas = 5 where id = salao;
  perform public.aplicar_aceite_da_casa(salao);
  update public.profiles set phone = '(13) 99000-9994', accepts_reminders = true where id = conta_prof;
  insert into auth.users (id, email) values (c, '5513990009995@whatsapp.mimo.com.vc'), (c2, '5513990009996@whatsapp.mimo.com.vc') on conflict do nothing;
  insert into public.profiles (id, full_name, phone, role) values (c, 'Lu Casa', '(13) 99000-9995', 'cliente'), (c2, 'Bia Casa', '(13) 99000-9996', 'cliente')
  on conflict (id) do update set phone = excluded.phone;
  perform public.cliente_do_whatsapp(c); perform public.cliente_do_whatsapp(c2);
  for i in 2..20 loop
    d1 := (now() at time zone 'America/Sao_Paulo')::date + i; livres := public.bot_horarios(salao, prof, d1, serv);
    exit when jsonb_array_length(coalesce(livres -> 'horarios', '[]')) > 6;
  end loop;
  for i in 1..20 loop
    d2 := d1 + i; livres := public.bot_horarios(salao, prof, d2, serv);
    exit when jsonb_array_length(coalesce(livres -> 'horarios', '[]')) > 6;
  end loop;

  -- A. a cliente marca: o pedido é só da casa
  perform set_config('request.jwt.claim.sub', '', true);
  r := public.bot_marcar(salao, c, prof, serv, d1, (public.bot_horarios(salao, prof, d1, serv) -> 'horarios' ->> 0)::time);
  ped := (r ->> 'appointment_id')::uuid;
  if ped is null or (select status from public.appointments where id = ped) <> 'pendente' then raise exception 'A0: devia nascer pedido: %', r; end if;
  if not exists (select 1 from public.aceites where appointment_id = ped and so_a_casa and telefone_prof = '') then raise exception 'A1: o pedido não ficou só da casa'; end if;
  if exists (select 1 from public.notifications where user_id = conta_prof and data ->> 'appointment_id' = ped::text) then raise exception 'A2: a profissional recebeu algo no pedido'; end if;
  if not exists (select 1 from public.notifications where user_id = adm and kind = 'pedido_de_aceite' and data ->> 'appointment_id' = ped::text) then raise exception 'A3: a casa não recebeu o pedido'; end if;
  perform set_config('request.jwt.claim.sub', conta_prof::text, true);
  if exists (select 1 from public.meus_pedidos() x where x.appointment_id = ped) then raise exception 'A4: o pedido da casa aparece para a profissional'; end if;
  deu := false;
  begin perform public.responder_pedido(ped, true); exception when others then deu := true; t := sqlerrm; end;
  if not deu or t not like '%casa%' then raise exception 'A5: a profissional decidiu o pedido da casa (%)', t; end if;
  perform set_config('request.jwt.claim.sub', adm::text, true);
  if not exists (select 1 from public.meus_pedidos() x where x.appointment_id = ped) then raise exception 'A6: o pedido não aparece para a casa'; end if;
  raise notice 'A pedido só da casa: a profissional não recebe, não vê e não decide';

  -- B. a casa confirma: a cliente é avisada e a profissional recebe "Horário novo na sua agenda"
  perform set_config('agenda_mel.ja_avisei', '', true);
  r := public.casa_decide(ped, true);
  if (select status from public.appointments where id = ped) <> 'confirmado' then raise exception 'B0: %', r; end if;
  if not exists (select 1 from public.notifications where user_id = c and kind = 'pedido_aceito' and data ->> 'appointment_id' = ped::text) then raise exception 'B1: a cliente não soube'; end if;
  select count(*) into n from public.notifications where user_id = conta_prof and kind = 'novo_agendamento' and data ->> 'appointment_id' = ped::text;
  if n <> 1 then raise exception 'B2: a profissional devia receber 1 "Horário novo", recebeu %', n; end if;
  if not exists (select 1 from public.message_outbox where client_id = conta_prof and kind = 'novo_agendamento' and appointment_id = ped) then raise exception 'B3: o WhatsApp da profissional não entrou na fila'; end if;
  raise notice 'B a casa confirmou: a cliente e a profissional ficam sabendo';

  -- C. a troca: nada para a profissional no pedido; confirmada, "Cliente remarcou" e nada de cancelamento do de antes
  perform set_config('request.jwt.claim.sub', '', true);
  r := public.bot_remarcar(salao, c, ped, d2, (public.bot_horarios(salao, prof, d2, serv) -> 'horarios' ->> 0)::time);
  novo := (r ->> 'appointment_id')::uuid;
  if novo is null or not (r ->> 'pendente')::boolean then raise exception 'C0: %', r; end if;
  if exists (select 1 from public.notifications where user_id = conta_prof and data ->> 'appointment_id' = novo::text) then raise exception 'C1: a profissional soube da troca antes da casa'; end if;
  perform set_config('request.jwt.claim.sub', adm::text, true);
  perform set_config('agenda_mel.ja_avisei', '', true);
  r := public.casa_decide(novo, true);
  if (select status from public.appointments where id = ped) <> 'cancelado' then raise exception 'C2: o horário de antes continuou'; end if;
  if not exists (select 1 from public.notifications where user_id = conta_prof and kind = 'novo_agendamento' and title = 'Cliente remarcou' and data ->> 'appointment_id' = novo::text) then raise exception 'C3: sem "Cliente remarcou"'; end if;
  if not exists (select 1 from public.message_outbox where client_id = conta_prof and appointment_id = novo and corpo ilike '%remarcou%') then raise exception 'C4: o WhatsApp não diz "Cliente remarcou"'; end if;
  if exists (select 1 from public.notifications where user_id = conta_prof and kind = 'cancelou_comigo' and data ->> 'appointment_id' = ped::text) then raise exception 'C5: avisou cancelamento do horário de antes'; end if;
  raise notice 'C troca confirmada pela casa: "Cliente remarcou" para a profissional, só depois';

  -- D. a casa recusa: nada para a profissional
  perform set_config('request.jwt.claim.sub', '', true);
  r := public.bot_marcar(salao, c, prof, serv, d1, (public.bot_horarios(salao, prof, d1, serv) -> 'horarios' ->> 0)::time);
  ped := (r ->> 'appointment_id')::uuid;
  perform set_config('request.jwt.claim.sub', adm::text, true);
  perform set_config('agenda_mel.ja_avisei', '', true);
  r := public.casa_decide(ped, false);
  if exists (select 1 from public.notifications where user_id = conta_prof and data ->> 'appointment_id' = ped::text) then raise exception 'D1: a profissional soube de um pedido recusado'; end if;
  if not exists (select 1 from public.notifications where user_id = c and kind = 'pedido_recusado' and data ->> 'appointment_id' = ped::text) then raise exception 'D2: a cliente não soube da recusa'; end if;
  raise notice 'D a casa recusou: nada para a profissional';

  -- E. a cliente desiste do pedido: nada para a profissional
  perform set_config('request.jwt.claim.sub', '', true);
  r := public.bot_marcar(salao, c, prof, serv, d1, (public.bot_horarios(salao, prof, d1, serv) -> 'horarios' ->> 0)::time);
  ped := (r ->> 'appointment_id')::uuid;
  perform set_config('request.jwt.claim.sub', c::text, true);
  perform set_config('agenda_mel.ja_avisei', '', true);
  update public.appointments set status = 'cancelado' where id = ped;
  if exists (select 1 from public.notifications where user_id = conta_prof and data ->> 'appointment_id' = ped::text) then raise exception 'E1: a profissional soube da desistência de um pedido que não viu'; end if;
  raise notice 'E a cliente desistiu: nada para a profissional';

  -- F. o seletor em "não avisar": confirmado pela Agenda, a cliente sabe e a profissional não recebe nada
  perform set_config('request.jwt.claim.sub', conta_prof::text, true);
  deu := false;
  begin perform public.salao_avisa_profissional(salao, false); exception when others then deu := true; end;
  if not deu then raise exception 'F0: a profissional mudou a regra do salão'; end if;
  perform set_config('request.jwt.claim.sub', adm::text, true);
  if public.salao_avisa_profissional(salao, false) then raise exception 'F1: não gravou'; end if;
  perform set_config('request.jwt.claim.sub', '', true);
  r := public.bot_marcar(salao, c2, prof, serv, d1, (public.bot_horarios(salao, prof, d1, serv) -> 'horarios' ->> 0)::time);
  ped := (r ->> 'appointment_id')::uuid;
  perform set_config('request.jwt.claim.sub', adm::text, true);
  perform set_config('agenda_mel.ja_avisei', '', true);
  update public.appointments set status = 'confirmado' where id = ped;
  if exists (select 1 from public.notifications where user_id = conta_prof and data ->> 'appointment_id' = ped::text) then raise exception 'F2: avisou a profissional com o seletor em "não avisar"'; end if;
  if not exists (select 1 from public.notifications where user_id = c2 and kind = 'pedido_aceito' and data ->> 'appointment_id' = ped::text) then raise exception 'F3: a cliente não soube'; end if;
  raise notice 'F seletor em "não avisar": só a cliente fica sabendo';

  -- G. o prazo venceu e confirmou sozinho (seletor em "avisar"): a profissional fica sabendo
  perform public.salao_avisa_profissional(salao, true);
  perform set_config('request.jwt.claim.sub', '', true);
  r := public.bot_marcar(salao, c2, prof, serv, d1, (public.bot_horarios(salao, prof, d1, serv) -> 'horarios' ->> 0)::time);
  ped := (r ->> 'appointment_id')::uuid;
  update public.aceites set expira_em = now() - interval '1 minute' where appointment_id = ped;
  perform set_config('agenda_mel.ja_avisei', '', true);
  perform public.resolver_aceites_vencidos();
  if (select status from public.appointments where id = ped) <> 'confirmado' then raise exception 'G0: o prazo não confirmou'; end if;
  if not exists (select 1 from public.notifications where user_id = conta_prof and kind = 'novo_agendamento' and data ->> 'appointment_id' = ped::text) then raise exception 'G1: a profissional não soube do confirmado pelo prazo'; end if;
  raise notice 'G confirmado pelo prazo: a profissional fica sabendo';

  -- H. profissional sem conta: o pedido da casa abre mesmo assim, com prazo e alerta para a casa
  update public.professionals set user_id = null where id = prof;
  r := public.bot_marcar(salao, c2, prof, serv, d2, (public.bot_horarios(salao, prof, d2, serv) -> 'horarios' ->> 0)::time);
  ped := (r ->> 'appointment_id')::uuid;
  if not exists (select 1 from public.aceites where appointment_id = ped and so_a_casa) then raise exception 'H1: sem pedido da casa para a profissional sem conta'; end if;
  if not exists (select 1 from public.notifications where user_id = adm and kind = 'pedido_de_aceite' and data ->> 'appointment_id' = ped::text) then raise exception 'H2: a casa não foi avisada'; end if;
  perform set_config('request.jwt.claim.sub', adm::text, true);
  perform set_config('agenda_mel.ja_avisei', '', true);
  r := public.casa_decide(ped, true);
  if (select status from public.appointments where id = ped) <> 'confirmado' then raise exception 'H3: %', r; end if;
  update public.professionals set user_id = conta_prof where id = prof;
  raise notice 'H profissional sem conta: o pedido chega para a casa, com prazo';

  -- I. "cada profissional decide": como antes (ela recebe o pedido e o "Horário novo", e decide)
  update public.salons set aceite_modo = 'profissional' where id = salao;
  perform set_config('request.jwt.claim.sub', '', true);
  r := public.bot_marcar(salao, c2, prof, serv, d2, (public.bot_horarios(salao, prof, d2, serv) -> 'horarios' ->> 0)::time);
  ped := (r ->> 'appointment_id')::uuid;
  if not exists (select 1 from public.aceites where appointment_id = ped and not so_a_casa and telefone_prof <> '') then raise exception 'I1: o pedido devia ser da profissional'; end if;
  if not exists (select 1 from public.notifications where user_id = conta_prof and kind = 'pedido_de_aceite' and data ->> 'appointment_id' = ped::text) then raise exception 'I2: a profissional não recebeu o pedido'; end if;
  if exists (select 1 from public.notifications where user_id = conta_prof and kind = 'novo_agendamento' and data ->> 'appointment_id' = ped::text) then raise exception 'I3: "Horário novo" junto com o pedido (a 078 diz um aviso só)'; end if;
  perform set_config('request.jwt.claim.sub', conta_prof::text, true);
  perform set_config('agenda_mel.ja_avisei', '', true);
  r := public.responder_pedido(ped, true);
  if (select status from public.appointments where id = ped) <> 'confirmado' then raise exception 'I4: ela não conseguiu aceitar: %', r; end if;
  select count(*) into n from public.notifications where user_id = conta_prof and kind = 'novo_agendamento' and data ->> 'appointment_id' = ped::text;
  if n <> 0 then raise exception 'I5: "Horário novo" depois de ela mesma aceitar (%)', n; end if;
  raise notice 'I cada profissional decide: ela recebe o pedido (um aviso só) e decide';

  raise notice 'ensaio_casa_confirma: tudo certo';
end $$;
rollback;
