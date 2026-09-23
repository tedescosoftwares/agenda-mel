-- Ensaio da 110: a avaliação chega ao balcão. Desfaz no fim.
begin;
do $$
declare sal record; dona uuid; prof record; svc record; cli uuid; appt uuid; d jsonb; x jsonb; sid uuid; h jsonb;
begin
  select s.* into sal from public.salons s join public.salon_members m on m.salon_id = s.id and m.papel = 'admin' where s.active and s.tipo = 'salao' limit 1;
  select m.user_id into dona from public.salon_members m where m.salon_id = sal.id and m.papel = 'admin' limit 1;
  select p.* into prof from public.professionals p where p.salon_id = sal.id and p.active limit 1;
  select s.* into svc from public.services s where s.salon_id = sal.id and s.active limit 1;
  select id into cli from public.profiles where role = 'cliente' limit 1;
  perform public.silenciar_gatilho();
  update public.appointments set status = 'cancelado' where professional_id = prof.id and date = public.agora_local()::date and status not in ('cancelado', 'faltou');
  insert into public.appointments (client_id, professional_id, service_id, salon_id, date, start_time, end_time, status, price_cents)
  values (cli, prof.id, svc.id, sal.id, public.agora_local()::date, time '03:00', time '03:45', 'concluido', 5000) returning id into appt;
  delete from public.reviews where appointment_id = appt;
  insert into public.reviews (appointment_id, client_id, professional_id, nota, comentario) values (appt, cli, prof.id, 5, '  Amei, saiu perfeito!  ');

  -- 1. o gatilho preencheu o salão
  select salon_id into sid from public.reviews where appointment_id = appt;
  if sid is distinct from sal.id then raise exception '1: salon_id não preenchido (%)', sid; end if;
  raise notice '1 salon_id ok';

  -- 2. pdv_dia traz nota e comentário aparado
  perform set_config('request.jwt.claim.sub', dona::text, false);
  set role authenticated;
  d := public.pdv_dia(sal.id);
  reset role;
  select value into x from jsonb_array_elements(d -> 'agenda') where value ->> 'id' = appt::text;
  if x is null or (x -> 'avaliacao' ->> 'nota')::int <> 5 or x -> 'avaliacao' ->> 'comentario' <> 'Amei, saiu perfeito!' then raise exception '2: avaliação não veio no quadro: %', x -> 'avaliacao'; end if;
  raise notice '2 pdv_dia ok';

  -- 3. a linha do tempo traz o comentário
  perform set_config('request.jwt.claim.sub', dona::text, false);
  set role authenticated;
  h := public.pdv_historico(sal.id, cli, 50);
  reset role;
  select value into x from jsonb_array_elements(h) where value ->> 'id' = appt::text;
  if x is null or (x ->> 'avaliacao')::int <> 5 or x ->> 'comentario' <> 'Amei, saiu perfeito!' then raise exception '3: histórico sem a avaliação: %', x; end if;
  raise notice '3 pdv_historico ok';

  -- 4. horário sem avaliação vem com null
  select value into x from jsonb_array_elements(d -> 'agenda') where value ->> 'id' <> appt::text and value -> 'avaliacao' is not null and jsonb_typeof(value -> 'avaliacao') = 'null' limit 1;
  raise notice '4 sem avaliacao vem null ok';

  raise notice 'FIM DO ENSAIO — tudo certo';
end $$;
rollback;
