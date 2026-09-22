-- Ensaio da 109: itens da comanda e o repasse por profissional. Desfaz no fim.
begin;
do $$
declare
  sal record; dona uuid; p1 record; p2 record; svc record; cli uuid; a1 uuid; a2 uuid; r jsonb; com uuid; n integer; soma integer; d1 integer; d2 integer; rep jsonb; linha jsonb; deu boolean;
begin
  select s.* into sal from public.salons s join public.salon_members m on m.salon_id = s.id and m.papel = 'admin' where s.active and s.tipo = 'salao' limit 1;
  select m.user_id into dona from public.salon_members m where m.salon_id = sal.id and m.papel = 'admin' limit 1;
  select p.* into p1 from public.professionals p where p.salon_id = sal.id and p.active order by p.name limit 1;
  select p.* into p2 from public.professionals p where p.salon_id = sal.id and p.active and p.id <> p1.id order by p.name limit 1;
  select s.* into svc from public.services s where s.salon_id = sal.id and s.active limit 1;
  select id into cli from public.profiles where role = 'cliente' limit 1;
  perform public.silenciar_gatilho();
  update public.appointments set status = 'cancelado' where professional_id in (p1.id, p2.id) and date = public.agora_local()::date and status not in ('cancelado', 'faltou');
  insert into public.appointments (client_id, professional_id, service_id, salon_id, date, start_time, end_time, status, price_cents, pago_cents)
  values (cli, p1.id, svc.id, sal.id, public.agora_local()::date, time '03:00', time '03:45', 'confirmado', 9000, 0) returning id into a1;
  insert into public.appointments (client_id, professional_id, service_id, salon_id, date, start_time, end_time, status, price_cents, pago_cents)
  values (cli, p2.id, svc.id, sal.id, public.agora_local()::date, time '04:00', time '04:30', 'confirmado', 3000, 0) returning id into a2;
  -- contrato vigente só pra p1: 40% do líquido
  insert into public.parcerias (salon_id, professional_id, status, inicio, cota_pct, base_calculo) values (sal.id, p1.id, 'vigente', current_date - 10, 40, 'liquido');

  perform set_config('request.jwt.claim.sub', dona::text, false);
  set role authenticated;

  -- 1. fecha a visita com desconto de 1000 sobre 12000: rateio 750 / 250
  r := public.pdv_fechar(sal.id, jsonb_build_object('appointment_id', a1, 'appointment_ids', jsonb_build_array(a1, a2), 'professional_id', p1.id, 'desconto_cents', 1000,
      'itens', jsonb_build_array(jsonb_build_object('nome', 'Coloração', 'preco_cents', 9000, 'qtd', 1, 'appointment_id', a1, 'professional_id', p1.id),
                                 jsonb_build_object('nome', 'Pedicure', 'preco_cents', 3000, 'qtd', 1, 'appointment_id', a2, 'professional_id', p2.id)),
      'pagamentos', jsonb_build_array(jsonb_build_object('forma', 'pix', 'valor_cents', 11000)), 'enviar_cupom', false));
  com := (r ->> 'comanda_id')::uuid;
  reset role;
  select count(*), sum(desconto_cents) into n, soma from public.comanda_itens where comanda_id = com;
  if n <> 2 or soma <> 1000 then raise exception '1: itens errados: % linhas, desconto %', n, soma; end if;
  select desconto_cents into d1 from public.comanda_itens where comanda_id = com and professional_id = p1.id;
  select desconto_cents into d2 from public.comanda_itens where comanda_id = com and professional_id = p2.id;
  if d1 <> 750 or d2 <> 250 then raise exception '1: rateio errado: % / %', d1, d2; end if;
  raise notice '1 itens e rateio ok';

  -- 2. o relatório separa o que é de quem e aplica a cota de p1
  perform set_config('request.jwt.claim.sub', dona::text, false);
  set role authenticated;
  rep := public.pdv_repasse(sal.id, current_date - 1, current_date + 1);
  reset role;
  select x into linha from jsonb_array_elements(rep -> 'por_profissional') x where x ->> 'professional_id' = p1.id::text;
  if linha is null or (linha ->> 'liquido_cents')::int <> 8250 or (linha ->> 'repasse_cents')::int <> 3300 or (linha ->> 'casa_cents')::int <> 4950 then raise exception '2: linha de p1 errada: %', linha; end if;
  select x into linha from jsonb_array_elements(rep -> 'por_profissional') x where x ->> 'professional_id' = p2.id::text;
  if linha is null or (linha ->> 'liquido_cents')::int <> 2750 or linha -> 'contrato' <> 'null'::jsonb then raise exception '2: linha de p2 errada: %', linha; end if;
  raise notice '2 repasse por profissional ok';

  -- 3. a profissional vê só o dela
  perform set_config('request.jwt.claim.sub', coalesce(p2.user_id, dona)::text, false);
  if p2.user_id is not null then
    set role authenticated;
    rep := public.pdv_repasse(sal.id, current_date - 1, current_date + 1);
    reset role;
    select count(*) into n from jsonb_array_elements(rep -> 'por_profissional') x where x ->> 'professional_id' = p1.id::text;
    if n <> 0 then raise exception '3: a profissional viu o repasse da outra'; end if;
    raise notice '3 profissional ve so o dela ok';
  else
    raise notice '3 (p2 sem usuário, pulado)';
  end if;

  -- 4. cupom diz com quem foi cada serviço
  if position('com ' in public.cupom_html(com)) = 0 then raise exception '4: cupom sem a profissional por item'; end if;
  raise notice '4 cupom ok';

  -- 5. estorno tira do relatório
  perform set_config('request.jwt.claim.sub', dona::text, false);
  set role authenticated;
  r := public.pdv_estornar(com, 'ensaio');
  rep := public.pdv_repasse(sal.id, current_date - 1, current_date + 1);
  reset role;
  select count(*) into n from public.comanda_itens where comanda_id = com and status = 'estornada';
  if n <> 2 then raise exception '5: itens não marcados como estornados (%)', n; end if;
  select count(*) into n from jsonb_array_elements(rep -> 'itens') x where x ->> 'comanda_id' = com::text;
  if n <> 0 then raise exception '5: item estornado ainda no relatório'; end if;
  raise notice '5 estorno ok';

  -- 6. gente de fora não vê
  select id into cli from public.profiles where id <> dona and not exists (select 1 from public.salon_members m where m.user_id = profiles.id and m.salon_id = sal.id) and not exists (select 1 from public.professionals p where p.user_id = profiles.id and p.salon_id = sal.id) limit 1;
  perform set_config('request.jwt.claim.sub', cli::text, false);
  deu := false;
  begin
    set role authenticated;
    rep := public.pdv_repasse(sal.id, current_date - 1, current_date + 1);
    reset role;
  exception when others then deu := true; reset role;
  end;
  if not deu then raise exception '6: gente de fora viu o repasse'; end if;
  raise notice '6 gente de fora nao ve ok';

  raise notice 'FIM DO ENSAIO — tudo certo';
end $$;
rollback;
