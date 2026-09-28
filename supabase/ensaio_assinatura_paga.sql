-- Ensaio da 128: mensalidade com desconto, os três caminhos, cobranças e cancelamento. Desfaz no fim.
begin;
do $$
declare sid uuid; dona uuid; ac jsonb; m jsonb; c jsonb; cid uuid; n integer; r record;
begin
  select s.id, s.owner_id into sid, dona from public.salons s where s.tipo = 'salao' and s.owner_id is not null limit 1;
  delete from public.cobrancas_mimo where salon_id = sid;
  delete from public.assinaturas where salon_id = sid;
  delete from public.notifications where user_id = dona and kind like 'cobranca_%';
  update public.salons set ativado_em = null, onboarding_concluido_em = now() where id = sid;
  if public.reais(4490) <> 'R$ 44,90' or public.reais(149990) <> 'R$ 1.499,90' then raise exception '0: reais %', public.reais(149990); end if;

  -- 1. a mensalidade segue as agendas ativas; sem método, sem desconto
  m := public.mensalidade_do_salao(sid);
  select count(*) into n from public.professionals where salon_id = sid and active;
  if (m ->> 'agendas')::int <> greatest(1, n) or (m ->> 'valor_cents')::int <> public.mensalidade_cents(m ->> 'plano', greatest(1, n)) or (m ->> 'desconto_cents')::int <> 0 then raise exception '1: %', m; end if;
  raise notice '1 mensalidade: % agendas, % (%)', m ->> 'agendas', public.reais((m ->> 'total_cents')::int), m ->> 'plano';

  -- 2. vincular Pix Automático sem ter ativado: ativa, começa o teste, 10% nos 10 centavos
  ac := public.assinatura_metodo_definir(sid, 'pix_automatico', '{"customer_id":"cus_1","autorizacao_id":"aut_1","autorizacao_status":"AWAITING","autorizacao_qr":"000201"}');
  if ac ->> 'fase' <> 'teste' or ac ->> 'metodo' <> 'pix_automatico' or (ac ->> 'desconto_pct')::int <> 10 or ac ->> 'cobrar_em' is null then raise exception '2: %', ac; end if;
  m := public.mensalidade_do_salao(sid);
  if (m ->> 'total_cents')::int <> ((m ->> 'valor_cents')::int * 90 / 100) / 10 * 10 then raise exception '2b: %', m; end if;
  if (m ->> 'valor_cents')::int = 4990 and (m ->> 'total_cents')::int <> 4490 then raise exception '2c: %', m; end if;
  raise notice '2 pix automático: % → % (cobra em %)', public.reais((m ->> 'valor_cents')::int), public.reais((m ->> 'total_cents')::int), ac ->> 'cobrar_em';

  -- 3. o teste acabou: a rotina abre a primeira cobrança, uma só
  update public.assinaturas set teste_ate = now() - interval '1 hour' where salon_id = sid;
  perform public.cuidar_das_assinaturas();
  perform public.cuidar_das_assinaturas();
  select count(*) into n from public.cobrancas_mimo where salon_id = sid and tipo = 'primeira' and status = 'a_criar';
  if n <> 1 then raise exception '3: % cobranças', n; end if;
  select * into r from public.cobrancas_mimo where salon_id = sid and tipo = 'primeira';
  if r.periodo_fim <> r.periodo_inicio + 30 or r.total_cents <> (m ->> 'total_cents')::int or r.metodo <> 'pix_automatico' then raise exception '3b: %', r; end if;
  if public.acesso_do_salao(sid) ->> 'fase' <> 'leitura' then raise exception '3c: até pagar, leitura'; end if;
  raise notice '3 primeira cobrança aberta: % de % a %', public.reais(r.total_cents), r.periodo_inicio, r.periodo_fim;

  -- 4. a Edge Function levou pro Asaas e o webhook confirmou: ativa até o fim do período
  perform public.cobranca_mimo_atualizar(r.id, '{"status":"aguardando","cobranca_id":"pay_1"}');
  c := public.cobranca_mimo_confirmar(r.id, 'pay_1');
  ac := public.acesso_do_salao(sid);
  if ac ->> 'fase' <> 'ativa' or ((ac ->> 'ate')::timestamptz at time zone 'America/Sao_Paulo')::date <> r.periodo_fim or ac ->> 'pendente' is not null then raise exception '4: %', ac; end if;
  if (select count(*) from public.notifications where user_id = dona and kind = 'cobranca_paga') <> 1 then raise exception '4b: sem aviso'; end if;
  c := public.cobranca_mimo_confirmar(r.id, 'pay_1');
  if not (c ->> 'repetido')::boolean then raise exception '4c'; end if;
  raise notice '4 paga: ativa até %', ac ->> 'ate';

  -- 5. faltam 3 dias: a renovação abre; no cartão, falhou → tenta de novo depois de 1 dia, até 3 vezes
  --    (no Pix Automático a renovação abre 7 dias antes e quem tenta de novo é o banco da pagadora)
  update public.assinaturas set pago_ate = now() + interval '8 days' where salon_id = sid;
  perform public.cuidar_das_assinaturas();
  if exists (select 1 from public.cobrancas_mimo where salon_id = sid and tipo = 'renovacao') then raise exception '5-pre: pix automático abriu cedo demais'; end if;
  update public.assinaturas set pago_ate = now() + interval '6 days' where salon_id = sid;
  perform public.cuidar_das_assinaturas();
  if not exists (select 1 from public.cobrancas_mimo where salon_id = sid and tipo = 'renovacao' and metodo = 'pix_automatico') then raise exception '5-pre2: pix automático devia abrir 7 dias antes'; end if;
  delete from public.cobrancas_mimo where salon_id = sid and tipo = 'renovacao';
  update public.assinaturas set metodo = 'cartao', desconto_pct = 0, cartao_final = '4242', pago_ate = now() + interval '2 days' where salon_id = sid;
  perform public.cuidar_das_assinaturas();
  select * into r from public.cobrancas_mimo where salon_id = sid and tipo = 'renovacao';
  if r.id is null or r.periodo_inicio <> (select (pago_ate at time zone 'America/Sao_Paulo')::date from public.assinaturas where salon_id = sid) then raise exception '5: %', r; end if;
  perform public.cobranca_mimo_falhou(r.id, 'cartão recusado');
  if (select status from public.cobrancas_mimo where id = r.id) <> 'falhou' then raise exception '5b'; end if;
  perform public.cuidar_das_assinaturas();
  if (select status from public.cobrancas_mimo where id = r.id) <> 'falhou' then raise exception '5c: tentou cedo demais'; end if;
  update public.cobrancas_mimo set atualizado_em = now() - interval '2 days' where id = r.id;
  perform public.cuidar_das_assinaturas();
  if (select status from public.cobrancas_mimo where id = r.id) <> 'a_criar' then raise exception '5d: não tentou de novo'; end if;
  update public.cobrancas_mimo set tentativas = 3, status = 'falhou', atualizado_em = now() - interval '2 days' where id = r.id;
  perform public.cuidar_das_assinaturas();
  if (select status from public.cobrancas_mimo where id = r.id) <> 'falhou' then raise exception '5e: passou do limite'; end if;
  raise notice '5 renovação e tentativas';

  -- 6. o aviso de 2 dias antes diz valor e método
  delete from public.notifications where user_id = dona and kind = 'teste_acabando';
  update public.assinaturas set avisos = '{}', pago_ate = now() + interval '1 day' where salon_id = sid;
  perform public.cuidar_das_assinaturas();
  select body into r from public.notifications where user_id = dona and kind = 'teste_acabando' order by created_at desc limit 1;
  if r.body not like '%vamos cobrar R$%no cartão final 4242%' then raise exception '6: %', r.body; end if;
  raise notice '6 aviso: %', left(r.body, 90);

  -- 7. cancelar: usa até o fim do que pagou, sem método, e as cobranças abertas somem
  perform set_config('request.jwt.claim.sub', dona::text, true);
  ac := public.assinatura_cancelar(sid);
  if ac ->> 'fase' <> 'ativa' or not (ac ->> 'cancelada')::boolean or ac ->> 'metodo' is not null then raise exception '7: %', ac; end if;
  if exists (select 1 from public.cobrancas_mimo where salon_id = sid and status in ('a_criar', 'aguardando', 'falhou')) then raise exception '7b'; end if;
  perform set_config('request.jwt.claim.sub', '', true);
  raise notice '7 cancelada: ativa até %', ac ->> 'ate';

  -- 8. pagar à vista: 30 + 7 de bônus, só na primeira vez; no teste começa hoje
  delete from public.cobrancas_mimo where salon_id = sid;
  delete from public.assinaturas where salon_id = sid;
  update public.salons set ativado_em = null where id = sid;
  ac := public.assinatura_metodo_definir(sid, 'pix', '{"customer_id":"cus_1"}');
  c := public.cobranca_mimo_abrir(sid, 'avista');
  if (c ->> 'bonus_dias')::int <> 7 or (c ->> 'periodo_fim')::date <> (now() at time zone 'America/Sao_Paulo')::date + 37 then raise exception '8: %', c; end if;
  cid := (c ->> 'id')::uuid;
  c := public.cobranca_mimo_abrir(sid, 'avista');
  if not (c ->> 'existente')::boolean then raise exception '8b: abriu duas'; end if;
  perform public.cobranca_mimo_confirmar(cid, 'pay_2');
  ac := public.acesso_do_salao(sid);
  if ac ->> 'fase' <> 'ativa' or (ac ->> 'dias')::int not between 36 and 38 or not (ac ->> 'bonus_usado')::boolean then raise exception '8c: %', ac; end if;
  c := public.cobranca_mimo_abrir(sid, 'avista');
  if (c ->> 'bonus_dias')::int <> 0 or (c ->> 'periodo_fim')::date <> (select (pago_ate at time zone 'America/Sao_Paulo')::date + 30 from public.assinaturas where salon_id = sid) then raise exception '8d: %', c; end if;
  raise notice '8 à vista: 37 dias na primeira, depois 30 emendando';

  -- 9. a dona não grava método nem confirma cobrança na mão
  perform set_config('request.jwt.claim.sub', dona::text, true);
  begin
    perform public.assinatura_metodo_definir(sid, 'cartao', '{}');
    raise exception '9: a dona não podia';
  exception when others then if sqlerrm not like '%Só a plataforma%' then raise; end if;
  end;
  begin
    perform public.cobranca_mimo_confirmar(cid, 'x');
    raise exception '9b: a dona não podia';
  exception when others then if sqlerrm not like '%Só a plataforma%' then raise; end if;
  end;
  raise notice '9 permissões';
  raise notice 'FIM DO ENSAIO — tudo certo';
end $$;
rollback;
