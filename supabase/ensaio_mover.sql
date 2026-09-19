-- Ensaio da 103: mover horário pelo quadro. Roda no banco de teste e desfaz.
begin;
do $$
declare sal record; dona uuid; p1 record; p2 record; svc record; cli uuid; appt uuid; r jsonb; st text; n integer; deu boolean;
begin
  select s.* into sal from public.salons s join public.salon_members m on m.salon_id = s.id and m.papel = 'admin' where s.active and s.tipo = 'salao'
   and (select count(*) from public.professionals p where p.salon_id = s.id and p.active) >= 2 limit 1;
  if sal.id is null then raise notice 'sem salão com duas profissionais; ensaio pulado'; return; end if;
  select m.user_id into dona from public.salon_members m where m.salon_id = sal.id and m.papel = 'admin' limit 1;
  select p.* into p1 from public.professionals p where p.salon_id = sal.id and p.active order by p.name limit 1;
  select p.* into p2 from public.professionals p where p.salon_id = sal.id and p.active and p.id <> p1.id order by p.name limit 1;
  select s.* into svc from public.services s join public.professional_services ps on ps.service_id = s.id and ps.professional_id = p1.id where s.active limit 1;
  select id into cli from public.profiles where role = 'cliente' limit 1;
  perform public.silenciar_gatilho();
  insert into public.appointments (client_id, professional_id, service_id, salon_id, date, start_time, end_time, status, price_cents)
  values (cli, p1.id, svc.id, sal.id, public.agora_local()::date + 3, '10:00', '11:00', 'pendente', 5000) returning id into appt;
  update public.appointments set status = 'confirmado' where id = appt;
  -- garante que a p2 também faz o serviço
  insert into public.professional_services (professional_id, service_id) values (p2.id, svc.id) on conflict do nothing;

  perform set_config('request.jwt.claim.sub', dona::text, false);
  set role authenticated;
  -- 1. mesma profissional, outra hora
  r := public.mover_horario(appt, public.agora_local()::date + 3, '14:00', null);
  if (r ->> 'ok')::boolean is not true then reset role; raise exception '1: %', r; end if;
  select status into st from public.appointments where id = appt;
  select start_time::text into n from public.appointments where id = (r ->> 'appointment_id')::uuid limit 0;
  if st <> 'cancelado' then reset role; raise exception '1: o antigo devia estar cancelado (remarcado), veio %', st; end if;
  appt := (r ->> 'appointment_id')::uuid;
  raise notice '1 mesma profissional ok';

  -- 2. outra profissional
  r := public.mover_horario(appt, public.agora_local()::date + 3, '15:00', p2.id);
  if (r ->> 'ok')::boolean is not true then reset role; raise exception '2: %', r; end if;
  appt := (r ->> 'appointment_id')::uuid;
  select count(*) into n from public.appointments where id = appt and professional_id = p2.id and status = 'confirmado' and start_time = '15:00';
  if n <> 1 then reset role; raise exception '2: não moveu para a p2'; end if;
  raise notice '2 outra profissional ok';

  -- 3. em cima de outro horário da p2: ocupado
  reset role;
  perform public.silenciar_gatilho();
  insert into public.appointments (client_id, professional_id, service_id, salon_id, date, start_time, end_time, status)
  values (cli, p2.id, svc.id, sal.id, public.agora_local()::date + 3, '16:00', '17:00', 'confirmado');
  set role authenticated;
  r := public.mover_horario(appt, public.agora_local()::date + 3, '16:30', p2.id);
  if r ->> 'motivo' <> 'ocupado' then reset role; raise exception '3: devia dar ocupado: %', r; end if;
  raise notice '3 ocupado ok';

  -- 4. para o passado: recusa
  deu := false;
  begin r := public.mover_horario(appt, public.agora_local()::date - 1, '10:00', null); exception when others then deu := true; end;
  if not deu then reset role; raise exception '4: aceitou o passado'; end if;
  reset role;
  raise notice '4 passado recusado ok';
  raise notice 'FIM DO ENSAIO — tudo certo';
end $$;
rollback;
