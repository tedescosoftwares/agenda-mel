-- Ensaio da 243 (3.98.1): a troca de horário confirmada (ou recusada) pela casa, com a profissional sem conta no app.
-- Desfaz no fim.
begin;
do $$
declare novo2 uuid; salao uuid; prof uuid; serv uuid; dona uuid; c uuid := '00000000-0000-0000-0000-00000000c0f2'; r jsonb; antigo uuid; novo uuid; d1 date; d2 date; h1 text; h2 text; livres jsonb; i int; n record; o record;
begin
  select p.id, p.salon_id into prof, salao from public.professionals p where p.slug = 'ana-paula';
  select ps.service_id into serv from public.professional_services ps where ps.professional_id = prof limit 1;
  select s.owner_id into dona from public.salons s where s.id = salao;
  insert into public.whatsapp_channels (salon_id, canal, identificador, ativo, usa_ia, numero_proprio) values (salao, 'evolution', 'salao-x', true, true, true)
  on conflict (salon_id) do update set canal = 'evolution', identificador = 'salao-x', ativo = true, numero_proprio = true;
  update public.salons set cliente_nova = 'igual' where id = salao;
  -- a profissional sem conta no app e pedindo confirmação (o modo "a casa confirma")
  update public.professionals set aceite_manual = true, user_id = null where id = prof;
  insert into auth.users (id, email) values (c, '5513990009992@whatsapp.mimo.com.vc') on conflict do nothing;
  insert into public.profiles (id, full_name, phone, role) values (c, 'Lia Troca', '(13) 99000-9992', 'cliente') on conflict (id) do update set phone = excluded.phone;
  perform public.cliente_do_whatsapp(c);
  for i in 2..20 loop
    d1 := (now() at time zone 'America/Sao_Paulo')::date + i; livres := public.bot_horarios(salao, prof, d1, serv);
    exit when jsonb_array_length(coalesce(livres -> 'horarios', '[]')) > 0;
  end loop;
  h1 := livres -> 'horarios' ->> 0;
  for i in 1..20 loop
    d2 := d1 + i; livres := public.bot_horarios(salao, prof, d2, serv);
    exit when jsonb_array_length(coalesce(livres -> 'horarios', '[]')) > 0;
  end loop;
  h2 := livres -> 'horarios' ->> 0;
  -- o horário de antes, confirmado
  insert into public.appointments (client_id, professional_id, salon_id, service_id, date, start_time, end_time, status)
  values (c, prof, salao, serv, d1, h1::time, h1::time + interval '30 minutes', 'confirmado') returning id into antigo;
  r := public.bot_remarcar(salao, c, antigo, d2, h2::time);
  if not (r ->> 'pendente')::boolean then raise exception 'preparo: a troca devia ficar pendente: %', r; end if;
  novo := (r ->> 'appointment_id')::uuid;
  perform set_config('request.jwt.claim.sub', dona::text, true);
  r := public.casa_decide(novo, true);
  if (select status from public.appointments where id = antigo) <> 'cancelado' then raise exception 'A: o horário de antes continuou'; end if;
  if (select status from public.appointments where id = novo) <> 'confirmado' then raise exception 'A2: o novo não confirmou'; end if;
  if not exists (select 1 from public.notifications where user_id = c and kind = 'remarcacao_aceita') then raise exception 'A3: sem "Remarcado!"'; end if;
  if not exists (select 1 from public.message_outbox where client_id = c and kind = 'remarcacao_aceita') then raise exception 'A4: o WhatsApp não entrou na fila'; end if;
  raise notice 'A troca aceita pela casa: o de antes sai, o novo confirma, "Remarcado!" no app e no WhatsApp';
  -- B. a casa recusa a troca: o horário de antes continua
  perform set_config('request.jwt.claim.sub', '', true);
  for i in 1..20 loop
    livres := public.bot_horarios(salao, prof, d2 + i, serv);
    exit when jsonb_array_length(coalesce(livres -> 'horarios', '[]')) > 0;
  end loop;
  r := public.bot_remarcar(salao, c, novo, (livres ->> 'dia')::date, (livres -> 'horarios' ->> 0)::time);
  novo2 := (r ->> 'appointment_id')::uuid;
  if novo2 is null then raise exception 'B0: %', r; end if;
  perform set_config('request.jwt.claim.sub', dona::text, true);
  r := public.casa_decide(novo2, false);
  if (select status from public.appointments where id = novo) <> 'confirmado' or (select status from public.appointments where id = novo2) <> 'cancelado' then raise exception 'B1: %', r; end if;
  if not exists (select 1 from public.notifications where user_id = c and kind = 'remarcacao_recusada') then raise exception 'B2: sem aviso de troca recusada'; end if;
  raise notice 'B troca recusada pela casa: o de antes continua, a cliente sabe';
  raise notice 'ensaio_troca_pela_casa: tudo certo';
end $$;
rollback;
