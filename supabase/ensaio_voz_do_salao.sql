-- Ensaio da 247 (3.98.5): a voz é do salão em tudo o que a cliente recebe, em qualquer modo de confirmação. Desfaz no fim.
begin;
do $$
declare salao uuid; nome text; prof uuid; conta_prof uuid; serv uuid; adm uuid; r jsonb; t text; ped uuid; novo uuid; ap uuid;
        d1 date; d2 date; livres jsonb; i int;
        c uuid := '00000000-0000-0000-0000-00000000c0f8'; tel text := '5513990009988';
begin
  select p.id, p.salon_id, p.user_id into prof, salao, conta_prof from public.professionals p where p.slug = 'ana-paula';
  select s.name into nome from public.salons s where s.id = salao;
  select ps.service_id into serv from public.professional_services ps where ps.professional_id = prof limit 1;
  select m.user_id into adm from public.salon_members m where m.salon_id = salao and m.papel = 'admin' limit 1;
  insert into public.whatsapp_channels (salon_id, canal, identificador, ativo, usa_ia, numero_proprio) values (salao, 'evolution', 'salao-x', true, true, true)
  on conflict (salon_id) do update set canal = 'evolution', identificador = 'salao-x', ativo = true, numero_proprio = true;
  update public.salons set aceite_modo = 'casa', cliente_nova = 'igual', limite_futuros = 5, limite_faltas = 5 where id = salao;
  perform public.aplicar_aceite_da_casa(salao);
  insert into auth.users (id, email) values (c, tel || '@whatsapp.mimo.com.vc') on conflict do nothing;
  insert into public.profiles (id, full_name, phone, role, accepts_reminders) values (c, 'Clara Voz', '(13) 99000-9988', 'cliente', true)
  on conflict (id) do update set phone = excluded.phone, accepts_reminders = true;
  perform public.cliente_do_whatsapp(c);
  for i in 2..20 loop
    d1 := (now() at time zone 'America/Sao_Paulo')::date + i; livres := public.bot_horarios(salao, prof, d1, serv);
    exit when jsonb_array_length(coalesce(livres -> 'horarios', '[]')) > 5;
  end loop;
  for i in 1..20 loop
    d2 := d1 + i; livres := public.bot_horarios(salao, prof, d2, serv);
    exit when jsonb_array_length(coalesce(livres -> 'horarios', '[]')) > 5;
  end loop;

  -- A. o título com o nome do salão (sem "o/a")
  if public.titulo_com_salao(null, 'Horário confirmado') <> 'Horário confirmado' then raise exception 'A1'; end if;
  if public.titulo_com_salao('Salão Mimo', 'Horário confirmado') <> 'Salão Mimo: horário confirmado' then raise exception 'A2'; end if;
  raise notice 'A título com o nome do salão';

  -- B. a casa confirma: o salão confirma, a profissional é quem atende
  perform set_config('request.jwt.claim.sub', '', true);
  r := public.bot_marcar(salao, c, prof, serv, d1, (public.bot_horarios(salao, prof, d1, serv) -> 'horarios' ->> 0)::time);
  ped := (r ->> 'appointment_id')::uuid;
  if r ->> 'aviso' not like 'o salão confirma%' then raise exception 'B0: o aviso para a assistente: %', r ->> 'aviso'; end if;
  perform set_config('request.jwt.claim.sub', adm::text, true);
  perform set_config('agenda_mel.ja_avisei', '', true);
  r := public.casa_decide(ped, true);
  select corpo into t from public.message_outbox where client_id = c and kind = 'pedido_aceito' and appointment_id = ped;
  if t not like '%' || nome || ': horário confirmado%' or t not like '%com *Ana Paula*%' or t not like '%Te esperamos%' or t like '%aceitou%' then raise exception 'B1: %', t; end if;
  raise notice 'B a casa confirma: "%: horário confirmado", com a profissional como quem atende', nome;

  -- C. a troca confirmada: "troca confirmada", nada de "a profissional aceitou a troca"
  perform set_config('request.jwt.claim.sub', '', true);
  r := public.bot_remarcar(salao, c, ped, d2, (public.bot_horarios(salao, prof, d2, serv) -> 'horarios' ->> 0)::time);
  novo := (r ->> 'appointment_id')::uuid;
  perform set_config('request.jwt.claim.sub', adm::text, true);
  perform set_config('agenda_mel.ja_avisei', '', true);
  r := public.casa_decide(novo, true);
  select corpo into t from public.message_outbox where client_id = c and kind = 'remarcacao_aceita' and appointment_id = novo;
  if t not like '%' || nome || ': troca confirmada%' or t not like '%Seu horário mudou%' or t like '%aceitou%' then raise exception 'C1: %', t; end if;
  raise notice 'C troca confirmada pelo salão';

  -- D. a recusa: "não vamos conseguir atender", no WhatsApp e no app
  perform set_config('request.jwt.claim.sub', '', true);
  r := public.bot_marcar(salao, c, prof, serv, d1, (public.bot_horarios(salao, prof, d1, serv) -> 'horarios' ->> 0)::time);
  ped := (r ->> 'appointment_id')::uuid;
  perform set_config('request.jwt.claim.sub', adm::text, true);
  perform set_config('agenda_mel.ja_avisei', '', true);
  r := public.casa_decide(ped, false);
  select corpo into t from public.message_outbox where client_id = c and kind = 'pedido_recusado' and appointment_id = ped;
  if t not like '%' || nome || ': não deu dessa vez%' or t not like '%Não vamos conseguir atender%' then raise exception 'D1: %', t; end if;
  select body into t from public.notifications where user_id = c and kind = 'pedido_recusado' and data ->> 'appointment_id' = ped::text;
  if t not like 'Não vamos conseguir atender%' then raise exception 'D2: no app: %', t; end if;
  raise notice 'D recusado: "não vamos conseguir atender"';

  -- E. cada profissional decide: mesmo quando é ela quem aceita, a cliente recebe a voz do salão
  update public.salons set aceite_modo = 'profissional' where id = salao;
  perform set_config('request.jwt.claim.sub', '', true);
  r := public.bot_marcar(salao, c, prof, serv, d2, (public.bot_horarios(salao, prof, d2, serv) -> 'horarios' ->> 0)::time);
  ped := (r ->> 'appointment_id')::uuid;
  perform set_config('request.jwt.claim.sub', conta_prof::text, true);
  perform set_config('agenda_mel.ja_avisei', '', true);
  r := public.responder_pedido(ped, true);
  select corpo into t from public.message_outbox where client_id = c and kind = 'pedido_aceito' and appointment_id = ped;
  if t not like '%' || nome || ': horário confirmado%' or t like '%aceitou%' then raise exception 'E1: %', t; end if;
  raise notice 'E a profissional aceitou: a cliente ouve o salão';

  -- F. pedido pelo app: "o salão confirma em breve", não "a confirmação da profissional"
  update public.professionals set aceite_manual = true where id = prof;
  perform set_config('request.jwt.claim.sub', c::text, true);
  insert into public.appointments (client_id, professional_id, salon_id, service_id, date, start_time, end_time)
  values (c, prof, salao, serv, d2, (public.bot_horarios(salao, prof, d2, serv) -> 'horarios' ->> 0)::time, (public.bot_horarios(salao, prof, d2, serv) -> 'horarios' ->> 0)::time + interval '30 minutes')
  returning id into ap;
  select body into t from public.notifications where user_id = c and kind = 'pedido_enviado' and data ->> 'appointment_id' = ap::text;
  if t not like '%' || nome || ' confirma em breve.' or t like '%da profissional%' then raise exception 'F1: %', t; end if;
  raise notice 'F pedido pelo app: "% confirma em breve"', nome;

  -- G. o salão cancela um horário confirmado: "precisamos cancelar", e no app o nome do salão
  perform set_config('request.jwt.claim.sub', adm::text, true);
  perform set_config('agenda_mel.ja_avisei', '', true);
  update public.appointments set status = 'cancelado' where id = novo;
  select corpo into t from public.message_outbox where client_id = c and kind = 'profissional_cancelou' and appointment_id = novo;
  if t not like '%' || nome || ': precisamos cancelar seu horário%' or t not like '%não vamos conseguir atender%' then raise exception 'G1: %', t; end if;
  select body into t from public.notifications where user_id = c and kind = 'profissional_cancelou' and data ->> 'appointment_id' = novo::text;
  if t not like nome || ' precisou cancelar seu horário de %' then raise exception 'G2: no app: %', t; end if;
  raise notice 'G o salão cancelou: "precisamos cancelar"';

  raise notice 'ensaio_voz_do_salao: tudo certo';
end $$;
rollback;
