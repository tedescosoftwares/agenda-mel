-- Ensaio da 244 (3.98.2): a casa confirma ou recusa um pedido pela Agenda do dia (status mudado direto na tabela, como
-- o app antigo fazia). A cliente tem de ser avisada e a troca tem de se completar. Desfaz no fim.
begin;
do $$
declare salao uuid; prof uuid; serv uuid; dona uuid; c uuid := '00000000-0000-0000-0000-00000000c0f3'; r jsonb;
        antigo uuid; novo uuid; ped uuid; d1 date; d2 date; h1 text; h2 text; livres jsonb; i int; n int;
begin
  select p.id, p.salon_id into prof, salao from public.professionals p where p.slug = 'ana-paula';
  select ps.service_id into serv from public.professional_services ps where ps.professional_id = prof limit 1;
  select s.owner_id into dona from public.salons s where s.id = salao;
  insert into public.whatsapp_channels (salon_id, canal, identificador, ativo, usa_ia, numero_proprio) values (salao, 'evolution', 'salao-x', true, true, true)
  on conflict (salon_id) do update set canal = 'evolution', identificador = 'salao-x', ativo = true, numero_proprio = true;
  update public.salons set cliente_nova = 'igual', limite_futuros = 5, limite_faltas = 5 where id = salao;
  -- a profissional sem conta no app e a casa confirmando (o caso do Bruno)
  update public.professionals set aceite_manual = true, user_id = null where id = prof;
  insert into auth.users (id, email) values (c, '5513990009993@whatsapp.mimo.com.vc') on conflict do nothing;
  insert into public.profiles (id, full_name, phone, role) values (c, 'Rita Agenda', '(13) 99000-9993', 'cliente') on conflict (id) do update set phone = excluded.phone;
  perform public.cliente_do_whatsapp(c);
  for i in 2..20 loop
    d1 := (now() at time zone 'America/Sao_Paulo')::date + i; livres := public.bot_horarios(salao, prof, d1, serv);
    exit when jsonb_array_length(coalesce(livres -> 'horarios', '[]')) > 1;
  end loop;
  h1 := livres -> 'horarios' ->> 0;
  for i in 1..20 loop
    d2 := d1 + i; livres := public.bot_horarios(salao, prof, d2, serv);
    exit when jsonb_array_length(coalesce(livres -> 'horarios', '[]')) > 1;
  end loop;
  h2 := livres -> 'horarios' ->> 0;

  -- A. pedido comum, a dona aperta Confirmar na Agenda (update direto)
  perform set_config('request.jwt.claim.sub', '', true);
  r := public.bot_marcar(salao, c, prof, serv, d1, h1::time);
  ped := (r ->> 'appointment_id')::uuid;
  if ped is null or (select status from public.appointments where id = ped) <> 'pendente' then raise exception 'A0: o pedido devia nascer pendente: %', r; end if;
  perform set_config('request.jwt.claim.sub', dona::text, true);
  perform set_config('agenda_mel.ja_avisei', '', true);   -- cada clique é uma transação no app
  update public.appointments set status = 'confirmado' where id = ped;
  if not exists (select 1 from public.notifications where user_id = c and kind = 'pedido_aceito') then raise exception 'A1: sem "Agendamento confirmado" no app'; end if;
  if not exists (select 1 from public.message_outbox where client_id = c and kind = 'pedido_aceito') then raise exception 'A2: o WhatsApp não entrou na fila'; end if;
  raise notice 'A confirmado pela Agenda: a cliente recebe no app e no WhatsApp';

  -- B. a cliente pede a troca desse horário; a dona confirma pela Agenda
  perform set_config('request.jwt.claim.sub', '', true);
  antigo := ped;
  r := public.bot_remarcar(salao, c, antigo, d2, h2::time);
  if not (r ->> 'pendente')::boolean then raise exception 'B0: a troca devia ficar pendente: %', r; end if;
  novo := (r ->> 'appointment_id')::uuid;
  perform set_config('request.jwt.claim.sub', dona::text, true);
  perform set_config('agenda_mel.ja_avisei', '', true);   -- cada clique é uma transação no app
  update public.appointments set status = 'confirmado' where id = novo;
  if (select status from public.appointments where id = antigo) <> 'cancelado' then raise exception 'B1: o horário de antes continuou na agenda'; end if;
  if (select remarcado_para from public.appointments where id = antigo) is distinct from novo then raise exception 'B2: o de antes não aponta para o novo'; end if;
  if not exists (select 1 from public.notifications where user_id = c and kind = 'remarcacao_aceita') then raise exception 'B3: sem "Remarcado!"'; end if;
  if exists (select 1 from public.notifications where user_id = c and kind = 'profissional_cancelou') then raise exception 'B4: mandou "precisou cancelar" pelo horário de antes'; end if;
  raise notice 'B troca confirmada pela Agenda: o de antes sai, "Remarcado!" e nada de "precisou cancelar"';

  -- C. outra troca, a dona recusa pela Agenda: o horário atual continua, aviso de troca recusada
  perform set_config('request.jwt.claim.sub', '', true);
  r := public.bot_remarcar(salao, c, novo, d1, (public.bot_horarios(salao, prof, d1, serv) -> 'horarios' ->> 0)::time);
  ped := (r ->> 'appointment_id')::uuid;
  if ped is null then raise exception 'C0: %', r; end if;
  perform set_config('request.jwt.claim.sub', dona::text, true);
  perform set_config('agenda_mel.ja_avisei', '', true);   -- cada clique é uma transação no app
  update public.appointments set status = 'cancelado' where id = ped;
  if (select status from public.appointments where id = novo) <> 'confirmado' then raise exception 'C1: o horário atual caiu'; end if;
  if not exists (select 1 from public.notifications where user_id = c and kind = 'remarcacao_recusada') then raise exception 'C2: sem aviso de troca recusada'; end if;
  if exists (select 1 from public.notifications where user_id = c and kind = 'profissional_cancelou') then raise exception 'C3: mandou "precisou cancelar" num pedido'; end if;
  raise notice 'C troca recusada pela Agenda: o horário atual continua, a cliente sabe';

  -- D. pedido comum recusado pela Agenda: "Horário não confirmado", não "precisou cancelar"
  perform set_config('request.jwt.claim.sub', '', true);
  r := public.bot_marcar(salao, c, prof, serv, d1, (public.bot_horarios(salao, prof, d1, serv) -> 'horarios' ->> 1)::time);
  ped := (r ->> 'appointment_id')::uuid;
  if ped is null then raise exception 'D0: %', r; end if;
  perform set_config('request.jwt.claim.sub', dona::text, true);
  perform set_config('agenda_mel.ja_avisei', '', true);   -- cada clique é uma transação no app
  update public.appointments set status = 'cancelado' where id = ped;
  if not exists (select 1 from public.notifications where user_id = c and kind = 'pedido_recusado') then raise exception 'D1: sem "Horário não confirmado"'; end if;
  if exists (select 1 from public.notifications where user_id = c and kind = 'profissional_cancelou') then raise exception 'D2: mandou "precisou cancelar" num pedido'; end if;
  raise notice 'D pedido recusado pela Agenda: "Horário não confirmado"';

  -- E. casa_decide continua avisando uma vez só (o gatilho fica quieto)
  perform set_config('request.jwt.claim.sub', '', true);
  r := public.bot_marcar(salao, c, prof, serv, d2, (public.bot_horarios(salao, prof, d2, serv) -> 'horarios' ->> 0)::time);
  ped := (r ->> 'appointment_id')::uuid;
  if ped is null then raise exception 'E0: %', r; end if;
  perform set_config('request.jwt.claim.sub', dona::text, true);
  perform set_config('agenda_mel.ja_avisei', '', true);
  r := public.casa_decide(ped, true);
  select count(*) into n from public.notifications where user_id = c and kind = 'pedido_aceito' and data ->> 'appointment_id' = ped::text;
  if n <> 1 then raise exception 'E1: casa_decide devia avisar 1 vez, avisou %', n; end if;
  raise notice 'E casa_decide: um aviso só';

  -- F. horário confirmado cancelado pela casa: continua "precisou cancelar"
  perform set_config('agenda_mel.ja_avisei', '', true);
  update public.appointments set status = 'cancelado' where id = ped;
  if not exists (select 1 from public.notifications where user_id = c and kind = 'profissional_cancelou' and data ->> 'appointment_id' = ped::text) then raise exception 'F1: confirmado cancelado pela casa devia avisar'; end if;
  raise notice 'F confirmado cancelado pela casa: "precisou cancelar" como antes';

  -- G. a cliente desiste do próprio pedido: ninguém manda aviso para ela
  perform set_config('request.jwt.claim.sub', '', true);
  r := public.bot_marcar(salao, c, prof, serv, d2, (public.bot_horarios(salao, prof, d2, serv) -> 'horarios' ->> 0)::time);
  ped := (r ->> 'appointment_id')::uuid;
  perform set_config('request.jwt.claim.sub', c::text, true);
  perform set_config('agenda_mel.ja_avisei', '', true);
  update public.appointments set status = 'cancelado' where id = ped;
  if exists (select 1 from public.notifications where user_id = c and data ->> 'appointment_id' = ped::text and kind in ('pedido_recusado', 'profissional_cancelou')) then raise exception 'G1: avisou a cliente do que ela mesma fez'; end if;
  raise notice 'G a cliente desistiu: sem aviso para ela';

  raise notice 'ensaio_decisao_pela_agenda: tudo certo';
end $$;
rollback;
