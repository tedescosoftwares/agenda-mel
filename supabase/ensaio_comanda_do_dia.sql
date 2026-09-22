-- Ensaio da 108. Roda no banco de teste e desfaz.
begin;
do $$
declare sal record; dona uuid; p1 record; p2 record; svc record; svc2 record; cli uuid; a1 uuid; a2 uuid; r jsonb; d jsonb; n integer; st text; st2 text; com uuid; agora timestamp := public.agora_local();
begin
  select s.* into sal from public.salons s join public.salon_members m on m.salon_id = s.id and m.papel = 'admin' where s.active and s.tipo = 'salao'
   and (select count(*) from public.professionals p where p.salon_id = s.id and p.active) >= 2 limit 1;
  select m.user_id into dona from public.salon_members m where m.salon_id = sal.id and m.papel = 'admin' limit 1;
  select p.* into p1 from public.professionals p where p.salon_id = sal.id and p.active order by p.name limit 1;
  select p.* into p2 from public.professionals p where p.salon_id = sal.id and p.active and p.id <> p1.id order by p.name limit 1;
  select s.* into svc from public.services s where s.salon_id = sal.id and s.active order by s.name limit 1;
  select s.* into svc2 from public.services s where s.salon_id = sal.id and s.active and s.id <> svc.id order by s.name limit 1;
  select id into cli from public.profiles where role = 'cliente' limit 1;
  perform public.silenciar_gatilho();

  -- 1. arrastar para 15 min antes, mesma profissional (encosta no antigo): tem que funcionar
  insert into public.appointments (client_id, professional_id, service_id, salon_id, date, start_time, end_time, status, price_cents)
  values (cli, p1.id, svc.id, sal.id, agora::date + 3, '04:00', '05:00', 'confirmado', 5000) returning id into a1;
  perform set_config('request.jwt.claim.sub', dona::text, false);
  set role authenticated;
  r := public.mover_horario(a1, agora::date + 3, '03:45', null);
  reset role;
  if (r ->> 'ok')::boolean is not true then raise exception '1: mover encostando falhou: %', r; end if;
  select status into st from public.appointments where id = a1;
  select status into st2 from public.appointments where id = (r ->> 'appointment_id')::uuid;
  if st <> 'cancelado' or st2 <> 'confirmado' then raise exception '1: situações erradas % %', st, st2; end if;
  raise notice '1 mover encostando no antigo ok';

  -- 2. a visita: dois horários hoje, com profissionais diferentes; fecha numa comanda só
  perform public.silenciar_gatilho();
  insert into public.appointments (client_id, professional_id, service_id, salon_id, date, start_time, end_time, status, price_cents, pago_cents)
  values (cli, p1.id, svc.id, sal.id, agora::date, '03:00', '04:00', 'confirmado', 8000, 2000) returning id into a1;
  insert into public.appointments (client_id, professional_id, service_id, salon_id, date, start_time, end_time, status, price_cents)
  values (cli, p2.id, svc2.id, sal.id, agora::date, '04:00', '05:00', 'confirmado', 6000) returning id into a2;
  perform set_config('request.jwt.claim.sub', dona::text, false);
  set role authenticated;
  d := public.pdv_dia(sal.id);
  r := public.pdv_fechar(sal.id, jsonb_build_object('appointment_id', a1, 'appointment_ids', jsonb_build_array(a1, a2), 'professional_id', p1.id,
      'itens', jsonb_build_array(
        jsonb_build_object('service_id', svc.id, 'nome', svc.name, 'preco_cents', 8000, 'qtd', 1, 'duracao', 60, 'appointment_id', a1, 'professional_id', p1.id),
        jsonb_build_object('service_id', svc2.id, 'nome', svc2.name, 'preco_cents', 6000, 'qtd', 1, 'duracao', 60, 'appointment_id', a2, 'professional_id', p2.id)),
      'pagamentos', jsonb_build_array(jsonb_build_object('forma', 'pix', 'valor_cents', 12000))));
  com := (r ->> 'comanda_id')::uuid;
  select status into st from public.appointments where id = a1;
  select status into st2 from public.appointments where id = a2;
  if st <> 'concluido' or st2 <> 'concluido' then reset role; raise exception '2: os dois deviam estar concluídos: % %', st, st2; end if;
  select price_cents into n from public.appointments where id = a2;
  if n <> 6000 then reset role; raise exception '2: valor do segundo horário errado %', n; end if;
  d := public.pdv_dia(sal.id);
  select count(*) into n from jsonb_array_elements(d -> 'agenda') x where x ->> 'id' = a2::text and x ->> 'comanda_id' = com::text;
  if n <> 1 then reset role; raise exception '2: o segundo horário não aponta para a comanda'; end if;
  select count(*) into n from jsonb_array_elements(d -> 'caixa' -> 'por_profissional') x where x ->> 'professional_id' = p2.id::text and (x ->> 'valor_cents')::int >= 6000;
  if n <> 1 then reset role; raise exception '2: por_profissional não deu a parte da p2: %', d -> 'caixa' -> 'por_profissional'; end if;
  raise notice '2 comanda da visita com duas profissionais ok';

  -- 3. fechar de novo qualquer um dos dois: recusa
  begin
    r := public.pdv_fechar(sal.id, jsonb_build_object('appointment_id', a2, 'professional_id', p2.id, 'itens', jsonb_build_array(jsonb_build_object('nome', 'x', 'preco_cents', 100)), 'pagamentos', jsonb_build_array(jsonb_build_object('forma', 'pix', 'valor_cents', 100))));
    reset role; raise exception '3: fechou de novo';
  exception when others then if sqlerrm like '3:%' then raise; end if;
  end;
  raise notice '3 nao fecha de novo ok';

  -- 4. estornar devolve os dois
  r := public.pdv_estornar(com, 'teste');
  reset role;
  select status into st from public.appointments where id = a1;
  select status into st2 from public.appointments where id = a2;
  if st <> 'confirmado' or st2 <> 'confirmado' then raise exception '4: estorno não devolveu os dois: % %', st, st2; end if;
  raise notice '4 estorno devolve a visita ok';
  raise notice 'FIM DO ENSAIO — tudo certo';
end $$;
rollback;
