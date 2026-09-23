-- Ensaio da 112: avaliações do período e projeção da semana. Desfaz no fim.
begin;
do $$
declare sal record; dona uuid; p1 record; p2 record; svc record; cli uuid; a1 uuid; a2 uuid; a3 uuid; r jsonb; x jsonb; seg date; deu boolean; n integer;
begin
  select s.* into sal from public.salons s join public.salon_members m on m.salon_id = s.id and m.papel = 'admin' where s.active and s.tipo = 'salao' limit 1;
  select m.user_id into dona from public.salon_members m where m.salon_id = sal.id and m.papel = 'admin' limit 1;
  select p.* into p1 from public.professionals p where p.salon_id = sal.id and p.active order by p.name limit 1;
  select p.* into p2 from public.professionals p where p.salon_id = sal.id and p.active and p.id <> p1.id order by p.name limit 1;
  select s.* into svc from public.services s where s.salon_id = sal.id and s.active limit 1;
  select id into cli from public.profiles where role = 'cliente' limit 1;
  perform public.silenciar_gatilho();
  -- uma semana limpa, daqui a 8 semanas, pra não esbarrar em dado semeado
  seg := (public.agora_local()::date + 56); seg := seg - (extract(isodow from seg)::integer - 1);
  delete from public.appointments where salon_id = sal.id and date between seg and seg + 6;
  insert into public.appointments (client_id, professional_id, service_id, salon_id, date, start_time, end_time, status, price_cents, pago_cents)
  values (cli, p1.id, svc.id, sal.id, seg, time '09:00', time '10:00', 'confirmado', 10000, 5000) returning id into a1;
  insert into public.appointments (client_id, professional_id, service_id, salon_id, date, start_time, end_time, status, price_cents, pago_cents)
  values (cli, p2.id, svc.id, sal.id, seg + 1, time '09:00', time '10:00', 'pendente', 8000, 0) returning id into a2;
  insert into public.appointments (client_id, professional_id, service_id, salon_id, date, start_time, end_time, status, price_cents, pago_cents)
  values (cli, p1.id, svc.id, sal.id, seg + 2, time '09:00', time '10:00', 'concluido', 6000, 0) returning id into a3;
  update public.appointments set status = 'pendente' where id = a2;
  -- o gatilho de preço pode ter trocado pelo preço do catálogo: fixa os valores do ensaio
  update public.appointments set price_cents = 10000, pago_cents = 5000 where id = a1;
  update public.appointments set price_cents = 8000, pago_cents = 0 where id = a2;
  update public.appointments set price_cents = 6000, pago_cents = 0 where id = a3;

  -- 1. projeção: previsto 24000, confirmado 10000, pendente 8000, realizado 6000, sinal 5000
  perform set_config('request.jwt.claim.sub', dona::text, false);
  set role authenticated;
  r := public.projecao_semanal(sal.id, seg + 3);
  reset role;
  if (r ->> 'inicio')::date <> seg then raise exception '1: começo da semana errado: %', r ->> 'inicio'; end if;
  x := r -> 'total';
  if (x ->> 'previsto_cents')::int <> 24000 or (x ->> 'confirmado_cents')::int <> 10000 or (x ->> 'pendente_cents')::int <> 8000 or (x ->> 'realizado_cents')::int <> 6000 or (x ->> 'sinal_cents')::int <> 5000 then
    raise exception '1: totais errados: %', x; end if;
  if jsonb_array_length(r -> 'dias') <> 7 then raise exception '1: devia ter 7 dias'; end if;
  raise notice '1 projecao ok';

  -- 2. por profissional: p1 previsto 16000, sinal 5000
  select value into x from jsonb_array_elements(r -> 'por_profissional') where value ->> 'professional_id' = p1.id::text;
  if x is null or (x ->> 'previsto_cents')::int <> 16000 or (x ->> 'sinal_cents')::int <> 5000 then raise exception '2: linha de p1 errada: %', x; end if;
  raise notice '2 por profissional ok';

  -- 3. avaliações: duas notas, média 4,5, por serviço e lista
  delete from public.reviews where appointment_id in (a1, a3);
  insert into public.reviews (appointment_id, client_id, professional_id, nota, comentario) values (a3, cli, p1.id, 5, 'Perfeito');
  insert into public.reviews (appointment_id, client_id, professional_id, nota, comentario) values (a1, cli, p1.id, 4, null);
  perform set_config('request.jwt.claim.sub', dona::text, false);
  set role authenticated;
  r := public.avaliacoes_do_periodo(sal.id, public.agora_local()::date, public.agora_local()::date);
  reset role;
  x := r -> 'total';
  if (x ->> 'quantas')::int < 2 or (x ->> 'com_comentario')::int < 1 then raise exception '3: total errado: %', x; end if;
  select count(*) into n from jsonb_array_elements(r -> 'lista') e where e ->> 'appointment_id' = a3::text and (e ->> 'nota')::int = 5 and e ->> 'comentario' = 'Perfeito';
  if n <> 1 then raise exception '3: lista sem a avaliação'; end if;
  select count(*) into n from jsonb_array_elements(r -> 'por_profissional') e where e ->> 'professional_id' = p1.id::text and (e ->> 'quantas')::int >= 2;
  if n <> 1 then raise exception '3: por profissional errado: %', r -> 'por_profissional'; end if;
  raise notice '3 avaliacoes ok';

  -- 4. gente de fora não vê
  select id into cli from public.profiles where id <> dona and not exists (select 1 from public.salon_members m where m.user_id = profiles.id and m.salon_id = sal.id) and not exists (select 1 from public.professionals p where p.user_id = profiles.id and p.salon_id = sal.id) limit 1;
  perform set_config('request.jwt.claim.sub', cli::text, false);
  deu := false;
  begin
    set role authenticated;
    r := public.projecao_semanal(sal.id, seg);
    reset role;
  exception when others then deu := true; reset role;
  end;
  if not deu then raise exception '4: gente de fora viu a projeção'; end if;
  deu := false;
  begin
    set role authenticated;
    r := public.avaliacoes_do_periodo(sal.id, seg, seg);
    reset role;
  exception when others then deu := true; reset role;
  end;
  if not deu then raise exception '4: gente de fora viu as avaliações'; end if;
  raise notice '4 gente de fora nao ve ok';

  raise notice 'FIM DO ENSAIO — tudo certo';
end $$;
rollback;
