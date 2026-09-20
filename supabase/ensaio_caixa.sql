-- Ensaio da 105: troco, detalhe, cupom. Roda no banco de teste e desfaz.
begin;
do $$
declare sal record; dona uuid; prof record; svc record; cli uuid; r jsonb; c record; n integer; deu boolean; msg text; msg2 text; futuro uuid; st text;
begin
  select s.* into sal from public.salons s join public.salon_members m on m.salon_id = s.id and m.papel = 'admin' where s.active and s.tipo = 'salao' limit 1;
  select m.user_id into dona from public.salon_members m where m.salon_id = sal.id and m.papel = 'admin' limit 1;
  select p.* into prof from public.professionals p where p.salon_id = sal.id and p.active limit 1;
  select s.* into svc from public.services s where s.salon_id = sal.id and s.active limit 1;
  select id into cli from public.profiles where role = 'cliente' limit 1;
  perform set_config('request.jwt.claim.sub', dona::text, false);
  set role authenticated;

  -- 1. dinheiro com troco + cartão em 2x com a máquina anotada; cupom vai
  r := public.pdv_fechar(sal.id, jsonb_build_object('client_id', cli, 'professional_id', prof.id,
      'itens', jsonb_build_array(jsonb_build_object('service_id', svc.id, 'nome', svc.name, 'preco_cents', 9000, 'qtd', 1, 'duracao', 30)),
      'pagamentos', jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor_cents', 4000, 'recebido_cents', 5000),
                                      jsonb_build_object('forma', 'credito', 'valor_cents', 5000, 'detalhe', 'Stone', 'parcelas', 2))));
  select * into c from public.comandas where id = (r ->> 'comanda_id')::uuid;
  select count(*) into n from public.caixa_movimentos m where m.comanda_id = c.id and m.forma = 'dinheiro' and m.troco_cents = 1000 and m.recebido_cents = 5000;
  if n <> 1 then reset role; raise exception '1: troco errado'; end if;
  select count(*) into n from public.caixa_movimentos m where m.comanda_id = c.id and m.forma = 'credito' and m.parcelas = 2 and m.detalhe = 'Stone';
  if n <> 1 then reset role; raise exception '1: detalhe do cartão não guardado'; end if;
  if jsonb_array_length(c.pagamentos) <> 2 or c.atendida_por <> prof.name then reset role; raise exception '1: snapshot dos pagamentos errado: %', c.pagamentos; end if;
  if (r ->> 'cupom')::boolean is not true or c.cupom_enviado_em is null then reset role; raise exception '1: cupom não enviado: %', r; end if;
  reset role;
  select count(*) into n from public.notifications where user_id = cli and kind = 'cupom_atendimento';
  if n < 1 then raise exception '1: sem aviso do cupom'; end if;
  set role authenticated;
  raise notice '1 dinheiro com troco, cartão 2x e cupom ok';

  -- 2. dinheiro entregue menor que o cobrado: recusa
  deu := false;
  begin
    r := public.pdv_fechar(sal.id, jsonb_build_object('cliente_nome', 'Passante', 'professional_id', prof.id,
      'itens', jsonb_build_array(jsonb_build_object('nome', 'x', 'preco_cents', 3000)),
      'pagamentos', jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor_cents', 3000, 'recebido_cents', 2000))));
  exception when others then deu := true; msg := sqlerrm;
  end;
  if not deu then reset role; raise exception '2: aceitou entregue menor'; end if;
  raise notice '2 entregue menor recusado ok (%)', msg;

  -- 3. cliente avulsa: fecha sem cupom
  r := public.pdv_fechar(sal.id, jsonb_build_object('cliente_nome', 'Passante', 'professional_id', prof.id,
      'itens', jsonb_build_array(jsonb_build_object('nome', 'x', 'preco_cents', 3000)),
      'pagamentos', jsonb_build_array(jsonb_build_object('forma', 'pix', 'valor_cents', 3000))));
  if (r ->> 'cupom')::boolean is not false then reset role; raise exception '3: avulsa não devia mandar cupom'; end if;
  raise notice '3 avulsa sem cupom ok';

  -- 4. a cliente vê o próprio cupom; outra pessoa não
  reset role;
  perform set_config('request.jwt.claim.sub', cli::text, false);
  set role authenticated;
  r := public.comprovante_da_comanda(c.id);
  if r is null or (r ->> 'total_cents')::int <> 9000 or r -> 'salao' ->> 'nome' <> sal.name then reset role; raise exception '4: cliente não viu o cupom: %', r; end if;
  reset role;
  select id into n from public.profiles where id not in (cli, dona) and role = 'cliente' limit 0;
  perform set_config('request.jwt.claim.sub', (select id from public.profiles where id <> cli and id <> dona and not exists (select 1 from public.salon_members m where m.user_id = profiles.id and m.salon_id = sal.id) limit 1)::text, false);
  set role authenticated;
  r := public.comprovante_da_comanda(c.id);
  reset role;
  if r is not null then raise exception '4: gente de fora viu o cupom'; end if;
  raise notice '4 cupom so da cliente ok';

  -- 5. horário de depois de amanhã: o PDV não fecha
  perform public.silenciar_gatilho();
  insert into public.appointments (client_id, professional_id, service_id, salon_id, date, start_time, end_time, status, price_cents)
  values (cli, prof.id, svc.id, sal.id, public.agora_local()::date + 2, '10:00', '11:00', 'confirmado', 5000) returning id into futuro;
  perform set_config('request.jwt.claim.sub', dona::text, false);
  set role authenticated;
  deu := false;
  begin
    r := public.pdv_fechar(sal.id, jsonb_build_object('appointment_id', futuro, 'professional_id', prof.id,
      'itens', jsonb_build_array(jsonb_build_object('service_id', svc.id, 'nome', svc.name, 'preco_cents', 5000, 'qtd', 1, 'duracao', 60)),
      'pagamentos', jsonb_build_array(jsonb_build_object('forma', 'pix', 'valor_cents', 5000))));
  exception when others then deu := true; msg := sqlerrm;
  end;
  reset role;
  if not deu then raise exception '5: fechou horário de outro dia'; end if;
  select status, start_time::text into st, msg2 from public.appointments where id = futuro;
  if st <> 'confirmado' or msg2 <> '10:00:00' then raise exception '5: o horário futuro foi mexido: % %', st, msg2; end if;
  raise notice '5 outro dia recusado ok (%)', msg;

  -- 6. hoje, chegou antes: fecha; estorna e a hora volta
  perform public.silenciar_gatilho();
  insert into public.appointments (client_id, professional_id, service_id, salon_id, date, start_time, end_time, status, price_cents)
  values (cli, prof.id, svc.id, sal.id, public.agora_local()::date, least((public.agora_local() + interval '3 hours')::time, time '23:30'), least((public.agora_local() + interval '4 hours')::time, time '23:45'), 'confirmado', 5000) returning id into futuro;
  select start_time::text into msg2 from public.appointments where id = futuro;
  perform set_config('request.jwt.claim.sub', dona::text, false);
  set role authenticated;
  r := public.pdv_fechar(sal.id, jsonb_build_object('appointment_id', futuro, 'professional_id', prof.id,
      'itens', jsonb_build_array(jsonb_build_object('service_id', svc.id, 'nome', svc.name, 'preco_cents', 5000, 'qtd', 1, 'duracao', 60)),
      'pagamentos', jsonb_build_array(jsonb_build_object('forma', 'pix', 'valor_cents', 5000))));
  select status into st from public.appointments where id = futuro;
  if st <> 'concluido' then reset role; raise exception '6: devia ter concluído'; end if;
  r := public.pdv_estornar((r ->> 'comanda_id')::uuid, 'teste');
  reset role;
  select status, start_time::text into st, msg from public.appointments where id = futuro;
  if st <> 'confirmado' or msg <> msg2 then raise exception '6: estorno não devolveu o horário: % % (era %)', st, msg, msg2; end if;
  raise notice '6 estorno devolve a hora ok';
  raise notice 'FIM DO ENSAIO — tudo certo';
end $$;
rollback;
