-- Ensaio da 107. Roda no banco de teste e desfaz.
begin;
do $$
declare sal record; dona uuid; p1 record; p2 record; svc record; svc2 record; cli uuid; appt uuid; r jsonb; d jsonb; n integer; fim time;
begin
  select s.* into sal from public.salons s join public.salon_members m on m.salon_id = s.id and m.papel = 'admin' where s.active and s.tipo = 'salao'
   and (select count(*) from public.professionals p where p.salon_id = s.id and p.active) >= 2 limit 1;
  if sal.id is null then raise notice 'sem salão com duas profissionais; ensaio pulado'; return; end if;
  select m.user_id into dona from public.salon_members m where m.salon_id = sal.id and m.papel = 'admin' limit 1;
  select p.* into p1 from public.professionals p where p.salon_id = sal.id and p.active order by p.name limit 1;
  select p.* into p2 from public.professionals p where p.salon_id = sal.id and p.active and p.id <> p1.id order by p.name limit 1;
  select s.* into svc from public.services s where s.salon_id = sal.id and s.active order by s.name limit 1;
  select s.* into svc2 from public.services s where s.salon_id = sal.id and s.active and s.id <> svc.id order by s.name limit 1;
  select id into cli from public.profiles where role = 'cliente' limit 1;
  perform public.silenciar_gatilho();
  -- histórico: uma visita concluída e a preferida é a p2; hoje ela está com a p1
  insert into public.appointments (client_id, professional_id, service_id, salon_id, date, start_time, end_time, status, price_cents)
  values (cli, p2.id, svc.id, sal.id, public.agora_local()::date - 10, '10:00', '11:00', 'confirmado', 5000);
  update public.appointments set status = 'concluido' where client_id = cli and salon_id = sal.id and date = public.agora_local()::date - 10;
  insert into public.profissional_preferida (client_id, salon_id, professional_id) values (cli, sal.id, p2.id) on conflict (client_id, salon_id) do update set professional_id = p2.id;
  insert into public.appointments (client_id, professional_id, service_id, salon_id, date, start_time, end_time, status, price_cents)
  values (cli, p1.id, svc.id, sal.id, public.agora_local()::date, '05:00', '06:00', 'confirmado', 5000) returning id into appt;

  perform set_config('request.jwt.claim.sub', dona::text, false);
  set role authenticated;
  -- 1. o quadro traz o resumo
  d := public.pdv_dia(sal.id);
  select count(*) into n from jsonb_array_elements(d -> 'agenda') x where x ->> 'id' = appt::text and (x ->> 'atendimentos')::int >= 1 and x ->> 'preferida_id' = p2.id::text and x ->> 'preferida' = p2.name;
  if n <> 1 then reset role; raise exception '1: resumo errado: %', d -> 'agenda'; end if;
  raise notice '1 resumo da cliente no quadro ok';

  -- 2. adiciona um serviço: item entra, valor sobe, fim estica
  r := public.adicionar_servico_ao_horario(appt, svc2.id);
  select count(*) into n from public.appointment_services where appointment_id = appt;
  select end_time into fim from public.appointments where id = appt;
  reset role;
  if n <> 2 then raise exception '2: devia ter 2 itens, tem %', n; end if;
  if (r ->> 'esticou')::boolean is not true or fim <> time '06:00' + make_interval(mins => svc2.duration_minutes) then raise exception '2: não esticou: % fim %', r, fim; end if;
  raise notice '2 adicionar servico ok (% itens, fim %)', n, fim;

  -- 3. com o próximo horário colado, o serviço entra mas o fim não estica
  perform public.silenciar_gatilho();
  insert into public.appointments (client_id, professional_id, service_id, salon_id, date, start_time, end_time, status)
  values (cli, p1.id, svc.id, sal.id, public.agora_local()::date, fim, fim + interval '30 minutes', 'confirmado');
  perform set_config('request.jwt.claim.sub', dona::text, false);
  set role authenticated;
  r := public.adicionar_servico_ao_horario(appt, svc2.id);
  reset role;
  if (r ->> 'esticou')::boolean is not false then raise exception '3: devia ter dito que não esticou: %', r; end if;
  select count(*) into n from public.appointment_services where appointment_id = appt;
  if n <> 3 then raise exception '3: devia ter 3 itens'; end if;
  raise notice '3 sem espaco entra sem esticar ok';
  raise notice 'FIM DO ENSAIO — tudo certo';
end $$;
rollback;
