-- Ensaio do pedido e da confirmação (074). Roda no banco de teste e desfaz.
begin;
do $$
declare cli uuid; prof record; svc record; novo uuid; n record; r jsonb; d date;
begin
  select p.* into prof from public.professionals p join public.profiles u on u.id = p.user_id where p.active limit 1;
  if prof.id is null then raise exception 'sem profissional com conta'; end if;
  select s.* into svc from public.services s join public.professional_services ps on ps.service_id = s.id where ps.professional_id = prof.id limit 1;
  select id into cli from public.profiles where role = 'cliente' and id <> prof.user_id limit 1;
  update public.profiles set phone = '(13) 99999-0001' where id = prof.user_id;
  -- este ensaio é do fluxo de aceite; o aceite forçado por histórico (077) tem ensaio próprio
  update public.professionals set aceite_manual = true, minutos_para_aceitar = 60, confirmar_historico_ruim = false where id = prof.id;
  perform set_config('request.jwt.claim.sub', cli::text, false);
  d := current_date + 40;

  -- 1. cliente marca: ela recebe "Pedido enviado" apontando para a página do agendamento
  insert into public.appointments (client_id, professional_id, service_id, date, start_time, end_time, salon_id)
  values (cli, prof.id, svc.id, d, '15:00', '16:00', prof.salon_id) returning id into novo;
  select * into n from public.notifications where user_id = cli and kind = 'pedido_enviado' order by created_at desc limit 1;
  if n.id is null then raise exception 'cliente não recebeu pedido_enviado'; end if;
  if n.action_url <> '/cliente/agendamento/' || novo::text then raise exception 'url errada: %', n.action_url; end if;
  if (n.data ->> 'appointment_id')::uuid <> novo then raise exception 'carga sem appointment_id'; end if;
  raise notice '1 pedido enviado: [%] [%] (ok)', n.title, n.body;

  -- 2. profissional aceita: "Agendamento confirmado! 🎉" com os dados
  perform set_config('request.jwt.claim.sub', prof.user_id::text, false);
  r := public.resolver_aceite(novo, true);
  if not (r ->> 'ok')::boolean then raise exception 'aceite falhou: %', r; end if;
  select * into n from public.notifications where user_id = cli and kind = 'pedido_aceito' order by created_at desc limit 1;
  if n.title not like 'Agendamento confirmado%' or n.body not like '% com %' then raise exception 'texto do aceite: % / %', n.title, n.body; end if;
  if n.action_url <> '/cliente/agendamento/' || novo::text then raise exception 'url do aceite: %', n.action_url; end if;
  raise notice '2 aceite: [%] [%] (ok)', n.title, n.body;

  -- 3. sem aceite manual: já confirma, e a cliente recebe "Agendamento confirmado"
  update public.professionals set aceite_manual = false where id = prof.id;
  perform set_config('request.jwt.claim.sub', cli::text, false);
  insert into public.appointments (client_id, professional_id, service_id, date, start_time, end_time, salon_id)
  values (cli, prof.id, svc.id, d + 1, '15:00', '16:00', prof.salon_id) returning id into novo;
  if (select status from public.appointments where id = novo) <> 'confirmado' then raise exception 'devia confirmar direto'; end if;
  select * into n from public.notifications where user_id = cli and kind = 'agendamento_confirmado' and (data ->> 'appointment_id')::uuid = novo;
  if n.id is null then raise exception 'cliente não recebeu agendamento_confirmado'; end if;
  raise notice '3 direto: [%] [%] (ok)', n.title, n.body;

  -- 4. recusa
  update public.professionals set aceite_manual = true where id = prof.id;
  insert into public.appointments (client_id, professional_id, service_id, date, start_time, end_time, salon_id)
  values (cli, prof.id, svc.id, d + 2, '15:00', '16:00', prof.salon_id) returning id into novo;
  perform set_config('request.jwt.claim.sub', prof.user_id::text, false);
  r := public.resolver_aceite(novo, false);
  select * into n from public.notifications where user_id = cli and kind = 'pedido_recusado' order by created_at desc limit 1;
  if n.body not like '%Escolha outro horário%' then raise exception 'recusa sem texto: %', n.body; end if;
  raise notice '4 recusa: [%] [%] (ok)', n.title, n.body;
  raise notice 'FIM DO ENSAIO — tudo certo';
end $$;
rollback;
