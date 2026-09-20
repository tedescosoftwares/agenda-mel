-- Ensaio da 102: o PDV. Roda no banco de teste e desfaz.
begin;
do $$
declare
  sal record; dona uuid; prof record; svc record; cli uuid; appt uuid; r jsonb; d jsonb; st text; n integer; deu boolean; msg text; com uuid; pago integer;
begin
  select s.* into sal from public.salons s join public.salon_members m on m.salon_id = s.id and m.papel = 'admin' where s.active and s.tipo = 'salao' limit 1;
  select m.user_id into dona from public.salon_members m where m.salon_id = sal.id and m.papel = 'admin' limit 1;
  select p.* into prof from public.professionals p where p.salon_id = sal.id and p.active limit 1;
  select s.* into svc from public.services s where s.salon_id = sal.id and s.active limit 1;
  select id into cli from public.profiles where role = 'cliente' limit 1;
  perform public.silenciar_gatilho();
  -- um horário de hoje, confirmado, já começado, com sinal pago pelo app
  insert into public.appointments (client_id, professional_id, service_id, salon_id, date, start_time, end_time, status, price_cents, pago_cents)
  values (cli, prof.id, svc.id, sal.id, public.agora_local()::date,
          greatest(public.agora_local() - interval '1 hour', public.agora_local()::date + time '00:00')::time,
          greatest(public.agora_local() - interval '15 minutes', greatest(public.agora_local() - interval '1 hour', public.agora_local()::date + time '00:00') + interval '1 minute')::time, 'confirmado', 8000, 3000)
  returning id into appt;
  insert into public.appointment_services (appointment_id, service_id, name, price_cents, duration_minutes, ordem) values (appt, svc.id, svc.name, 8000, 45, 1);

  perform set_config('request.jwt.claim.sub', dona::text, false);
  set role authenticated;

  -- 1. o dia traz o horário com o sinal e os itens
  d := public.pdv_dia(sal.id);
  select count(*) into n from jsonb_array_elements(d -> 'agenda') x where x ->> 'id' = appt::text and (x ->> 'pago_cents')::int = 3000 and jsonb_array_length(x -> 'itens') = 1;
  if n <> 1 then reset role; raise exception '1: pdv_dia não trouxe o horário certo: %', d -> 'agenda'; end if;
  raise notice '1 pdv_dia ok';

  -- 2. pagamentos que não fecham: recusa
  deu := false;
  begin
    r := public.pdv_fechar(sal.id, jsonb_build_object('appointment_id', appt, 'professional_id', prof.id,
      'itens', jsonb_build_array(jsonb_build_object('service_id', svc.id, 'nome', svc.name, 'preco_cents', 8000, 'qtd', 1, 'duracao', 45)),
      'pagamentos', jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor_cents', 1000))));
  exception when others then deu := true; msg := sqlerrm;
  end;
  if not deu then reset role; raise exception '2: aceitou pagamento que não fecha'; end if;
  raise notice '2 nao fecha recusado ok (%)', msg;

  -- 3. fecha com um item a mais, desconto e o sinal abatido: 8000 + 2000 - 1000 = 9000; sinal 3000 → falta 6000
  r := public.pdv_fechar(sal.id, jsonb_build_object('appointment_id', appt, 'professional_id', prof.id, 'desconto_cents', 1000,
      'itens', jsonb_build_array(jsonb_build_object('service_id', svc.id, 'nome', svc.name, 'preco_cents', 8000, 'qtd', 1, 'duracao', 45),
                                 jsonb_build_object('nome', 'Hidratação extra', 'preco_cents', 2000, 'qtd', 1, 'duracao', 15)),
      'pagamentos', jsonb_build_array(jsonb_build_object('forma', 'pix', 'valor_cents', 4000), jsonb_build_object('forma', 'dinheiro', 'valor_cents', 2000))));
  com := (r ->> 'comanda_id')::uuid;
  select status, price_cents into st, pago from public.appointments where id = appt;
  if st <> 'concluido' or pago <> 9000 then reset role; raise exception '3: agendamento devia estar concluído a 9000, veio % %', st, pago; end if;
  select count(*) into n from public.appointment_services where appointment_id = appt;
  if n <> 2 then reset role; raise exception '3: itens do agendamento não foram trocados (%)', n; end if;
  select sum(valor_cents) into pago from public.caixa_movimentos where comanda_id = com;
  if pago <> 9000 then reset role; raise exception '3: caixa devia somar 9000, veio %', pago; end if;
  select count(*) into n from public.caixa_movimentos where comanda_id = com and forma = 'app' and valor_cents = 3000;
  if n <> 1 then reset role; raise exception '3: sinal do app não entrou no caixa'; end if;
  raise notice '3 fechou com sinal, desconto e item extra ok';

  -- 4. fechar o mesmo horário de novo: recusa
  deu := false;
  begin
    r := public.pdv_fechar(sal.id, jsonb_build_object('appointment_id', appt, 'professional_id', prof.id,
      'itens', jsonb_build_array(jsonb_build_object('nome', 'x', 'preco_cents', 100)), 'pagamentos', jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor_cents', 100))));
  exception when others then deu := true;
  end;
  if not deu then reset role; raise exception '4: fechou duas vezes'; end if;
  raise notice '4 nao fecha duas vezes ok';

  -- 5. comanda avulsa: nasce o atendimento concluído
  r := public.pdv_fechar(sal.id, jsonb_build_object('cliente_nome', 'Passante da Silva', 'professional_id', prof.id,
      'itens', jsonb_build_array(jsonb_build_object('service_id', svc.id, 'nome', svc.name, 'preco_cents', 5000, 'qtd', 1, 'duracao', 30)),
      'pagamentos', jsonb_build_array(jsonb_build_object('forma', 'credito', 'valor_cents', 5000))));
  select status, price_cents into st, pago from public.appointments where id = (r ->> 'appointment_id')::uuid;
  if st <> 'concluido' or pago <> 5000 then reset role; raise exception '5: avulsa devia nascer concluída a 5000, veio % %', st, pago; end if;
  raise notice '5 avulsa ok';

  -- 6. o dia mostra o caixa por forma e por profissional
  d := public.pdv_dia(sal.id);
  if (d -> 'caixa' ->> 'total_cents')::int < 14000 then reset role; raise exception '6: caixa do dia devia ter pelo menos 14000: %', d -> 'caixa'; end if;
  select count(*) into n from jsonb_array_elements(d -> 'caixa' -> 'por_forma') x where x ->> 'forma' = 'app';
  if n <> 1 then reset role; raise exception '6: por_forma sem app'; end if;
  raise notice '6 caixa do dia ok';

  -- 7. estornar a comanda: caixa zera e o horário volta a confirmado
  r := public.pdv_estornar(com, 'errei o valor');
  select status into st from public.appointments where id = appt;
  select coalesce(sum(valor_cents), 0) into pago from public.caixa_movimentos where comanda_id = com;
  if st <> 'confirmado' or pago <> 0 then reset role; raise exception '7: estorno errado: % %', st, pago; end if;
  raise notice '7 estorno ok';

  -- 8. gente de fora não fecha
  reset role;
  select id into cli from public.profiles where id <> dona and not exists (select 1 from public.salon_members m where m.user_id = profiles.id and m.salon_id = sal.id) limit 1;
  perform set_config('request.jwt.claim.sub', cli::text, false);
  deu := false;
  begin
    set role authenticated;
    r := public.pdv_fechar(sal.id, jsonb_build_object('cliente_nome', 'x', 'professional_id', prof.id, 'itens', jsonb_build_array(jsonb_build_object('nome', 'x', 'preco_cents', 100)), 'pagamentos', jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor_cents', 100))));
    reset role;
  exception when others then deu := true; reset role;
  end;
  if not deu then raise exception '8: gente de fora fechou comanda'; end if;
  raise notice '8 gente de fora nao fecha ok';

  raise notice 'FIM DO ENSAIO — tudo certo';
end $$;
rollback;
