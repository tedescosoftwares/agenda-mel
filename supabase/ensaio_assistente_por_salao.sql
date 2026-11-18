-- Ensaio da 246 (3.98.4): histórico por salão, uma conversa por vez, nada de WhatsApp do salão para ele mesmo, textos
-- da casa e o lembrete com o dia certo. Desfaz no fim.
begin;
do $$
declare salao uuid; outro uuid; prof uuid; serv uuid; adm uuid; tel_adm text; r jsonb; t text; n int; ped uuid; novo uuid; ap uuid;
        d1 date; d2 date; livres jsonb; i int; quando timestamp;
        c uuid := '00000000-0000-0000-0000-00000000c0f7'; tel text := '5513990009998';
begin
  select p.id, p.salon_id into prof, salao from public.professionals p where p.slug = 'ana-paula';
  select ps.service_id into serv from public.professional_services ps where ps.professional_id = prof limit 1;
  select m.user_id into adm from public.salon_members m where m.salon_id = salao and m.papel = 'admin' limit 1;
  select id into outro from public.salons where id <> salao limit 1;
  update public.profiles set phone = '(13) 99000-9001', accepts_reminders = true where id = adm;
  tel_adm := public.telefone_e164('(13) 99000-9001');
  -- o número do salão é o celular da dona
  insert into public.whatsapp_channels (salon_id, canal, identificador, ativo, usa_ia, numero_proprio, numero_exibicao)
  values (salao, 'evolution', 'salao-x', true, true, true, '+55 (13) 99000-9001')
  on conflict (salon_id) do update set canal = 'evolution', identificador = 'salao-x', ativo = true, usa_ia = true, numero_proprio = true, numero_exibicao = '+55 (13) 99000-9001';
  update public.salons set aceite_modo = 'casa', casa_avisa_profissional = true, cliente_nova = 'igual', limite_futuros = 5, limite_faltas = 5 where id = salao;
  perform public.aplicar_aceite_da_casa(salao);
  insert into auth.users (id, email) values (c, tel || '@whatsapp.mimo.com.vc') on conflict do nothing;
  insert into public.profiles (id, full_name, phone, role, accepts_reminders) values (c, 'Rosa Salão', '(13) 99000-9998', 'cliente', true)
  on conflict (id) do update set phone = excluded.phone, accepts_reminders = true;
  perform public.cliente_do_whatsapp(c);
  for i in 2..20 loop
    d1 := (now() at time zone 'America/Sao_Paulo')::date + i; livres := public.bot_horarios(salao, prof, d1, serv);
    exit when jsonb_array_length(coalesce(livres -> 'horarios', '[]')) > 4;
  end loop;
  for i in 1..20 loop
    d2 := d1 + i; livres := public.bot_horarios(salao, prof, d2, serv);
    exit when jsonb_array_length(coalesce(livres -> 'horarios', '[]')) > 4;
  end loop;

  -- A. a mensagem que chega fica marcada com o salão
  perform set_config('request.jwt.claim.sub', '', true);
  r := public.receber_mensagem(tel, 'oi, tudo bem?', 'ens-246-a', null, null, salao);
  if (select salon_id from public.whatsapp_inbox where provider_id = 'ens-246-a') is distinct from salao then raise exception 'A1: a mensagem não ficou com o salão'; end if;
  raise notice 'A a mensagem recebida sabe de que salão é';

  -- B. o histórico só tem a conversa com este salão
  perform set_config('mimo.salao_da_mensagem', '', true);   -- cada mensagem é uma transação no webhook
  insert into public.whatsapp_inbox (telefone, texto, recebido_em, salon_id) values (tel, 'MENSAGEM DE OUTRO SALÃO', now() - interval '5 minutes', outro);
  insert into public.whatsapp_inbox (telefone, texto, recebido_em) values (tel, 'MENSAGEM SEM SALÃO', now() - interval '4 minutes');
  insert into public.message_outbox (salon_id, telefone, kind, corpo, canal, liberado_em, status, enviado_em)
  values (outro, tel, 'agente', 'RESPOSTA DE OUTRO SALÃO', 'evolution', now(), 'enviado', now() - interval '3 minutes');
  r := public.bot_contexto(salao, tel, 'salao-x', true);
  t := coalesce(r ->> 'historico', '');
  if t like '%OUTRO SALÃO%' or t like '%SEM SALÃO%' then raise exception 'B1: o histórico misturou salões: %', t; end if;
  if t not like '%oi, tudo bem?%' then raise exception 'B2: o histórico perdeu a conversa deste salão: % (motivo %)', t, r ->> 'motivo'; end if;
  raise notice 'B o histórico é só deste salão';

  -- C. uma conversa por vez
  if public.assistente_pegar_vez(salao, tel, 'ens-246-a') <> 'sua' then raise exception 'C1: a primeira não pegou a vez'; end if;
  update public.whatsapp_inbox set recebido_em = now() - interval '10 seconds' where provider_id = 'ens-246-a';   -- em transações diferentes no webhook
  r := public.receber_mensagem(tel, 'e aí?', 'ens-246-c', null, null, salao);
  if public.assistente_pegar_vez(salao, tel, 'ens-246-c') <> 'ocupada' then raise exception 'C2: duas ao mesmo tempo'; end if;
  if public.assistente_pegar_vez(salao, tel, 'ens-246-a') <> 'nova' then raise exception 'C3: a primeira não viu que chegou mensagem mais nova'; end if;
  perform public.assistente_soltar_vez(salao, tel, 'ens-246-a');
  if public.assistente_pegar_vez(salao, tel, 'ens-246-c') <> 'sua' then raise exception 'C4: a vez não ficou livre'; end if;
  perform public.assistente_soltar_vez(salao, tel, 'ens-246-c');
  raise notice 'C uma conversa por vez; a mensagem mais nova responde as duas';

  -- D. freio de laço
  insert into public.message_outbox (salon_id, telefone, kind, corpo, canal, liberado_em, status, enviado_em)
  select salao, tel, 'agente', 'resposta ' || g, 'evolution', now(), 'enviado', now() - make_interval(secs => g) from generate_series(1, 15) g;
  r := public.bot_contexto(salao, tel, 'salao-x', true);
  if r ->> 'motivo' is distinct from 'muitas_respostas' then raise exception 'D1: sem freio de laço: %', r ->> 'motivo'; end if;
  delete from public.message_outbox where salon_id = salao and telefone = tel and kind = 'agente';
  raise notice 'D freio de laço: 15 respostas em 5 minutos, a assistente para';

  -- E. a dona com o número do salão: o pedido fica no app, sem WhatsApp do salão para ele mesmo
  r := public.bot_marcar(salao, c, prof, serv, d1, (public.bot_horarios(salao, prof, d1, serv) -> 'horarios' ->> 0)::time);
  ped := (r ->> 'appointment_id')::uuid;
  if not exists (select 1 from public.notifications where user_id = adm and kind = 'pedido_de_aceite' and data ->> 'appointment_id' = ped::text) then raise exception 'E1: a dona não recebeu o pedido no app'; end if;
  if exists (select 1 from public.message_outbox where telefone = tel_adm and appointment_id = ped) then raise exception 'E2: WhatsApp do salão para ele mesmo'; end if;
  raise notice 'E a dona com o número do salão: o pedido fica no app';

  -- F. a casa confirma: texto da casa, não "a Melissa aceitou"
  perform set_config('request.jwt.claim.sub', adm::text, true);
  perform set_config('agenda_mel.ja_avisei', '', true);
  r := public.casa_decide(ped, true);
  select corpo into t from public.message_outbox where client_id = c and kind = 'pedido_aceito' and appointment_id = ped;
  if t is null or t not like '%Seu horário está confirmado%' or t like '%aceitou%' then raise exception 'F1: texto da confirmação: %', t; end if;
  perform set_config('request.jwt.claim.sub', '', true);
  r := public.bot_remarcar(salao, c, ped, d2, (public.bot_horarios(salao, prof, d2, serv) -> 'horarios' ->> 0)::time);
  novo := (r ->> 'appointment_id')::uuid;
  perform set_config('request.jwt.claim.sub', adm::text, true);
  perform set_config('agenda_mel.ja_avisei', '', true);
  r := public.casa_decide(novo, true);
  select corpo into t from public.message_outbox where client_id = c and kind = 'remarcacao_aceita' and appointment_id = novo;
  if t is null or t not like '%A troca está confirmada%' or t like '%aceitou%' then raise exception 'F2: texto do remarcado: %', t; end if;
  perform set_config('request.jwt.claim.sub', '', true);
  r := public.bot_marcar(salao, c, prof, serv, d1, (public.bot_horarios(salao, prof, d1, serv) -> 'horarios' ->> 0)::time);
  ped := (r ->> 'appointment_id')::uuid;
  perform set_config('request.jwt.claim.sub', adm::text, true);
  perform set_config('agenda_mel.ja_avisei', '', true);
  r := public.casa_decide(ped, false);
  select corpo into t from public.message_outbox where client_id = c and kind = 'pedido_recusado' and appointment_id = ped;
  if t is null or t not like '%Não vamos conseguir atender%' then raise exception 'F3: texto da recusa: %', t; end if;
  raise notice 'F decisão da casa com texto da casa (confirmado, remarcado, recusado)';

  -- G. lembrete: não sai para quem acabou de marcar, nem para pedido aberto; o título diz o dia certo
  perform set_config('request.jwt.claim.sub', '', true);
  quando := date_trunc('hour', public.agora_local()) + interval '20 hours';
  update public.professionals set reminder_hours_before = 24 where id = prof;
  insert into public.appointments (client_id, professional_id, salon_id, service_id, date, start_time, end_time, status)
  values (c, prof, salao, serv, quando::date, quando::time, (quando + interval '1 hour')::time, 'confirmado') returning id into ap;
  perform public.enviar_lembretes();
  if (select reminder_sent_at from public.appointments where id = ap) is not null then raise exception 'G1: lembrete logo depois de marcar'; end if;
  update public.appointments set created_at = now() - interval '4 hours' where id = ap;
  perform public.enviar_lembretes();
  if (select reminder_sent_at from public.appointments where id = ap) is null then raise exception 'G2: o lembrete não saiu'; end if;
  select title into t from public.notifications where user_id = c and kind = 'lembrete_agendamento' and data ->> 'appointment_id' = ap::text;
  if t <> (case when quando::date = public.agora_local()::date then 'Hoje tem horário marcado' else 'Amanhã tem horário marcado' end) then raise exception 'G3: título no app: %', t; end if;
  select corpo into t from public.message_outbox where client_id = c and kind = 'lembrete_agendamento' and appointment_id = ap;
  if t is null or t not like '%' || public.titulo_do_lembrete(ap) || '%' then raise exception 'G4: título no WhatsApp: %', t; end if;
  raise notice 'G lembrete: não logo depois de marcar; título "%"', public.titulo_do_lembrete(ap);

  raise notice 'ensaio_assistente_por_salao: tudo certo';
end $$;
rollback;
