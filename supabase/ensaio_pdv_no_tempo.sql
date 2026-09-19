-- Ensaio da 104. Roda no banco de teste e desfaz.
begin;
do $$
declare sal record; dona uuid; prof record; svc record; cli uuid; r jsonb; n integer; outra uuid;
begin
  select s.* into sal from public.salons s join public.salon_members m on m.salon_id = s.id and m.papel = 'admin' where s.active and s.tipo = 'salao' limit 1;
  select m.user_id into dona from public.salon_members m where m.salon_id = sal.id and m.papel = 'admin' limit 1;
  select p.* into prof from public.professionals p where p.salon_id = sal.id and p.active limit 1;
  select s.* into svc from public.services s where s.salon_id = sal.id and s.active limit 1;
  select id into cli from public.profiles where role = 'cliente' limit 1;
  perform public.silenciar_gatilho();
  insert into public.appointments (client_id, professional_id, service_id, salon_id, date, start_time, end_time, status, price_cents)
  values (cli, prof.id, svc.id, sal.id, public.agora_local()::date - 20, '10:00', '11:00', 'confirmado', 7000);
  update public.appointments set status = 'concluido' where client_id = cli and date = public.agora_local()::date - 20 and salon_id = sal.id;
  insert into public.appointments (client_id, professional_id, service_id, salon_id, date, start_time, end_time, status, price_cents)
  values (cli, prof.id, svc.id, sal.id, public.agora_local()::date + 2, '10:00', '11:00', 'pendente', 7000);

  perform set_config('request.jwt.claim.sub', dona::text, false);
  set role authenticated;
  r := public.pdv_dias(sal.id, public.agora_local()::date - 21, public.agora_local()::date + 3);
  if jsonb_array_length(r) <> 25 then reset role; raise exception '1: devia ter 25 dias, veio %', jsonb_array_length(r); end if;
  select count(*) into n from jsonb_array_elements(r) x where (x ->> 'dia')::date = public.agora_local()::date - 20 and (x ->> 'concluidos')::int >= 1 and (x ->> 'valor_cents')::int >= 7000;
  if n <> 1 then reset role; raise exception '1: o dia -20 devia contar o concluído: %', r; end if;
  raise notice '1 pdv_dias ok';
  r := public.pdv_historico(sal.id, cli);
  select count(*) into n from jsonb_array_elements(r) x where (x ->> 'dia')::date = public.agora_local()::date - 20 and x ->> 'status' = 'concluido' and x ->> 'profissional' = prof.name;
  if n <> 1 then reset role; raise exception '2: histórico sem o atendimento: %', r; end if;
  raise notice '2 pdv_historico ok';
  reset role;
  select id into outra from public.profiles where id <> dona and not exists (select 1 from public.salon_members m where m.user_id = profiles.id and m.salon_id = sal.id) limit 1;
  perform set_config('request.jwt.claim.sub', outra::text, false);
  set role authenticated;
  r := public.pdv_historico(sal.id, cli);
  reset role;
  if jsonb_array_length(r) <> 0 then raise exception '3: gente de fora viu o histórico'; end if;
  raise notice '3 gente de fora nao ve ok';
  raise notice 'FIM DO ENSAIO — tudo certo';
end $$;
rollback;
