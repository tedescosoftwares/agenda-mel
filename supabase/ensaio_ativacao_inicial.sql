-- Ensaio da 133–136 (2.81): ativação inicial simples. Desfaz no fim.
--   7 dias grátis OU 20% na primeira mensalidade; sem recorrência.
begin;
do $$
declare sid uuid; dona uuid; ac jsonb; est jsonb; cob jsonb; r jsonb; n integer; appt uuid; prof uuid; serv uuid; cli uuid;
begin
  select s.id, s.owner_id into sid, dona from public.salons s where s.tipo = 'salao' and s.owner_id is not null limit 1;
  select p.id into prof from public.professionals p where p.salon_id = sid and p.active limit 1;
  select ps.service_id into serv from public.professional_services ps where ps.professional_id = prof limit 1;
  select p.id into cli from public.profiles p where p.role = 'cliente' limit 1;
  delete from public.cobrancas_mimo where salon_id = sid;
  delete from public.assinaturas where salon_id = sid;
  delete from public.notifications where user_id = dona and kind in ('teste_comecou', 'cobranca_paga', 'teste_acabando', 'modo_leitura', 'painel_bloqueado');
  update public.salons set ativado_em = null, ativacao_pendente_em = null, onboarding_concluido_em = now(), equipe_prevista = 3 where id = sid;
  perform set_config('request.jwt.claim.sub', dona::text, true);

  -- 1. configurando: não aceita agendamento, ativação ainda não pendente
  ac := public.acesso_do_salao(sid);
  if ac ->> 'fase' <> 'configurando' or (ac ->> 'ativacao_pendente')::boolean then raise exception '1: %', ac; end if;
  if public.aceita_agendamentos(sid) then raise exception '1b: configurando não devia aceitar (2.81)'; end if;
  raise notice '1 configurando, sem aceitar';

  -- 2. preparar: fica pendente; preço pela equipe prevista (3 agendas = pro 49,90), oferta 20%
  est := public.ativacao_inicial_preparar(sid);
  ac := public.acesso_do_salao(sid);
  if not (ac ->> 'ativacao_pendente')::boolean then raise exception '2: %', ac; end if;
  if (est ->> 'valor_cents')::int <> 4990 or (est ->> 'oferta_cents')::int <> 3992 or (est -> 'mensalidade' ->> 'agendas')::int <> 3 then raise exception '2b: %', est; end if;
  raise notice '2 pendente: cheio % · oferta % (% agendas)', est ->> 'valor_cents', est ->> 'oferta_cents', est -> 'mensalidade' ->> 'agendas';

  -- 3. abre Pix inicial, muda de ideia pra cartão: barra enquanto o Pix está vivo; cancela e abre cartão
  cob := public.cobranca_inicial_abrir(sid, 'pix');
  if (cob ->> 'total_cents')::int <> 3992 or cob ->> 'status' <> 'a_criar' then raise exception '3: %', cob; end if;
  begin
    perform public.cobranca_inicial_abrir(sid, 'cartao');
    raise exception '3b: devia barrar dois métodos';
  exception when others then if sqlerrm not like '%em andamento%' then raise; end if;
  end;
  perform public.cobranca_inicial_cancelar(sid);
  cob := public.cobranca_inicial_abrir(sid, 'cartao');
  if cob ->> 'metodo' <> 'cartao' then raise exception '3c: %', cob; end if;
  raise notice '3 cobrança inicial: pix → cancelou → cartão %', cob ->> 'id';

  -- 4. testar com cobrança sem id no Asaas: cancela sozinho e começa o teste
  ac := public.ativacao_inicial_teste(sid);
  if ac ->> 'fase' <> 'teste' or (ac ->> 'dias')::int <> 7 or (ac ->> 'oferta_inicial_usada')::boolean is distinct from true then raise exception '4: %', ac; end if;
  if (select ativado_em from public.salons where id = sid) is null or (select ativacao_pendente_em from public.salons where id = sid) is not null then raise exception '4b'; end if;
  if (select count(*) from public.cobrancas_mimo where salon_id = sid and status = 'cancelado') <> 2 then raise exception '4c'; end if;
  if not public.aceita_agendamentos(sid) then raise exception '4d: teste devia aceitar'; end if;
  raise notice '4 teste começou: % dias, oferta consumida', ac ->> 'dias';

  -- 5. depois do teste, a oferta de 20% não existe mais
  begin
    perform public.cobranca_inicial_abrir(sid, 'pix');
    raise exception '5: oferta devia ter sido consumida';
  exception when others then if sqlerrm not like '%já foi%' then raise; end if;
  end;
  raise notice '5 oferta única ok';

  -- 6. renovação manual no teste: começa hoje, preço cheio, 30 dias; a plataforma dá baixa → ativa
  cob := public.cobranca_manual_abrir(sid, 'pix');
  if (cob ->> 'total_cents')::int <> 4990 or (cob ->> 'desconto_cents')::int <> 0 then raise exception '6: %', cob; end if;
  perform set_config('request.jwt.claim.sub', '', true);
  r := public.cobranca_mimo_confirmar((cob ->> 'id')::uuid, 'pay_teste_1', now());
  if not (r ->> 'ok')::boolean then raise exception '6b: %', r; end if;
  ac := public.acesso_do_salao(sid);
  if ac ->> 'fase' <> 'ativa' or ac ->> 'situacao' <> 'ativa' or (ac ->> 'dias')::int < 29 or (ac ->> 'recorrente')::boolean then raise exception '6c: %', ac; end if;
  if (select count(*) from public.notifications where user_id = dona and kind = 'cobranca_paga') <> 1 then raise exception '6d'; end if;
  raise notice '6 renovação paga: ativa por % dias, sem recorrência', ac ->> 'dias';

  -- 7. renovar de novo com período vigente: começa no fim do pago, e a baixa prolonga
  perform set_config('request.jwt.claim.sub', dona::text, true);
  cob := public.cobranca_manual_abrir(sid, 'cartao');
  perform set_config('request.jwt.claim.sub', '', true);
  perform public.cobranca_mimo_confirmar((cob ->> 'id')::uuid, 'pay_teste_2', now());
  ac := public.acesso_do_salao(sid);
  if (ac ->> 'dias')::int < 59 then raise exception '7: %', ac; end if;
  raise notice '7 prolongou: % dias', ac ->> 'dias';

  -- 8. vence: leitura (agendamento novo barrado), tolerância, bloqueado; a rotina só avisa
  update public.assinaturas set pago_ate = now() - interval '1 day', avisos = '{}'::jsonb where salon_id = sid;
  ac := public.acesso_do_salao(sid);
  if ac ->> 'fase' <> 'leitura' then raise exception '8: %', ac; end if;
  if public.aceita_agendamentos(sid) then raise exception '8b'; end if;
  begin
    insert into public.appointments (salon_id, professional_id, client_id, service_id, starts_at, ends_at, status)
    values (sid, prof, cli, serv, now() + interval '3 days', now() + interval '3 days 1 hour', 'confirmado') returning id into appt;
    raise exception '8c: modo leitura devia barrar';
  exception when others then if sqlerrm like '8c%' then raise; end if;
  end;
  n := public.cuidar_das_assinaturas();
  if (select avisos ->> 'leitura' from public.assinaturas where salon_id = sid) is null then raise exception '8d'; end if;
  if (select count(*) from public.cobrancas_mimo where salon_id = sid and status in ('a_criar', 'aguardando')) <> 0 then raise exception '8e: rotina criou cobrança sozinha'; end if;
  update public.assinaturas set pago_ate = now() - interval '9 days' where salon_id = sid;
  ac := public.acesso_do_salao(sid);
  if ac ->> 'fase' <> 'bloqueado' then raise exception '8f: %', ac; end if;
  n := public.cuidar_das_assinaturas();
  if (select avisos ->> 'bloqueado' from public.assinaturas where salon_id = sid) is null then raise exception '8g'; end if;
  raise notice '8 leitura → bloqueado, rotina só avisou';

  -- 9. chutar_assinaturas está desligado
  r := public.chutar_assinaturas();
  if not (r ->> 'desativado')::boolean then raise exception '9: %', r; end if;

  -- 10. pagou a primeira com 20% (outro salão zerado): confirma → ativa, sem teste
  perform set_config('request.jwt.claim.sub', dona::text, true);
  delete from public.cobrancas_mimo where salon_id = sid;
  delete from public.assinaturas where salon_id = sid;
  update public.salons set ativado_em = null, ativacao_pendente_em = null where id = sid;
  cob := public.cobranca_inicial_abrir(sid, 'pix');
  perform set_config('request.jwt.claim.sub', '', true);
  perform public.cobranca_mimo_confirmar((cob ->> 'id')::uuid, 'pay_inicial', now());
  ac := public.acesso_do_salao(sid);
  if ac ->> 'fase' <> 'ativa' or ac ->> 'escolha_inicial' <> 'pago' or (ac ->> 'dias')::int < 29 then raise exception '10: %', ac; end if;
  if (select ativado_em from public.salons where id = sid) is null then raise exception '10b'; end if;
  perform set_config('request.jwt.claim.sub', dona::text, true);
  begin
    perform public.ativacao_inicial_teste(sid);
    raise exception '10c: pagou, não ganha teste';
  exception when others then if sqlerrm not like '%já foi paga%' then raise; end if;
  end;
  raise notice '10 pagou a primeira: ativa % dias, sem teste depois', ac ->> 'dias';

  raise notice 'ensaio_ativacao_inicial: tudo certo';
end $$;
rollback;
