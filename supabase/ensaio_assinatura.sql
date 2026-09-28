-- Ensaio da 126: teste grátis, modo leitura e painel pausado. Desfaz no fim.
begin;
do $$
declare sid uuid; dona uuid; prof uuid; serv uuid; cli uuid; ac jsonb; n integer; appt uuid;
begin
  select s.id, s.owner_id into sid, dona from public.salons s where s.tipo = 'salao' and s.owner_id is not null limit 1;
  select p.id into prof from public.professionals p where p.salon_id = sid and p.active limit 1;
  select ps.service_id into serv from public.professional_services ps where ps.professional_id = prof limit 1;
  select p.id into cli from public.profiles p where p.role = 'cliente' limit 1;
  delete from public.assinaturas where salon_id = sid;
  delete from public.notifications where user_id = dona and kind = 'teste_comecou';
  update public.salons set ativado_em = null, onboarding_concluido_em = now() where id = sid;

  -- 1. sem ativação: configurando, aceita agendamento
  ac := public.acesso_do_salao(sid);
  if ac ->> 'fase' <> 'configurando' then raise exception '1: %', ac; end if;
  if not public.aceita_agendamentos(sid) then raise exception '1b: configurando devia aceitar'; end if;
  raise notice '1 configurando: % (prazo %)', ac ->> 'fase', ac ->> 'prazo_ativacao';

  -- 2. ativa: 7 dias de teste
  perform set_config('request.jwt.claim.sub', dona::text, true);
  ac := public.salao_ativar(sid);
  if ac ->> 'fase' <> 'teste' or (ac ->> 'dias')::int <> 7 then raise exception '2: %', ac; end if;
  if (select ativado_em from public.salons where id = sid) is null then raise exception '2b: ativado_em'; end if;
  if (select count(*) from public.notifications where user_id = dona and kind = 'teste_comecou') <> 1 then raise exception '2d: sem aviso de início'; end if;
  ac := public.salao_ativar(sid);   -- de novo não reinicia
  if (ac ->> 'dias')::int <> 7 then raise exception '2c: %', ac; end if;
  raise notice '2 teste: % dias até %', ac ->> 'dias', ac ->> 'ate';

  -- 3. no teste, a cliente marca normalmente
  perform set_config('request.jwt.claim.sub', cli::text, true);
  insert into public.appointments (client_id, professional_id, service_id, date, start_time, end_time, status)
  values (cli, prof, serv, current_date + 40, '09:00', '09:30', 'pendente') returning id into appt;
  raise notice '3 no teste a cliente marca: %', appt;

  -- 4. teste vencido: modo leitura, ninguém marca; o que existe continua
  update public.assinaturas set teste_ate = now() - interval '1 day' where salon_id = sid;
  ac := public.acesso_do_salao(sid);
  if ac ->> 'fase' <> 'leitura' or (ac ->> 'dias_tolerancia')::int <> (public.regras_da_assinatura() ->> 'tolerancia_dias')::int - 1 then raise exception '4: %', ac; end if;
  begin
    insert into public.appointments (client_id, professional_id, service_id, date, start_time, end_time, status)
    values (cli, prof, serv, current_date + 40, '10:00', '10:30', 'pendente');
    raise exception '4b: modo leitura deixou marcar';
  exception when others then
    if sqlerrm not like '%não está recebendo agendamentos novos%' then raise; end if;
  end;
  update public.appointments set status = 'confirmado' where id = appt;
  if (public.pagina_do_salao(sid) -> 'salao' ->> 'aceita')::boolean then raise exception '4c: página devia dizer que não aceita'; end if;
  raise notice '4 leitura: barra o novo, mantém o existente, página avisa';

  -- 5. tolerância vencida: bloqueado
  update public.assinaturas set teste_ate = now() - make_interval(days => (public.regras_da_assinatura() ->> 'tolerancia_dias')::int + 1) where salon_id = sid;
  ac := public.acesso_do_salao(sid);
  if ac ->> 'fase' <> 'bloqueado' then raise exception '5: %', ac; end if;
  begin
    insert into public.appointments (client_id, professional_id, service_id, date, start_time, end_time, status)
    values (cli, prof, serv, current_date + 41, '10:00', '10:30', 'pendente');
    raise exception '5b: bloqueado deixou marcar';
  exception when others then
    if sqlerrm not like '%pausado%' then raise; end if;
  end;
  raise notice '5 bloqueado';

  -- 6. a rotina avisa uma vez só em cada marco
  perform set_config('request.jwt.claim.sub', '', true);
  delete from public.notifications where user_id = dona and kind in ('teste_acabando', 'modo_leitura', 'painel_bloqueado', 'teste_comecou');
  n := public.cuidar_das_assinaturas();
  if n <> 1 then raise exception '6: % avisos', n; end if;
  if (select count(*) from public.notifications where user_id = dona and kind = 'painel_bloqueado') <> 1 then raise exception '6b'; end if;
  n := public.cuidar_das_assinaturas();
  if n <> 0 then raise exception '6c: repetiu o aviso'; end if;
  update public.assinaturas set teste_ate = now() + interval '1 day', avisos = '{}' where salon_id = sid;
  n := public.cuidar_das_assinaturas();
  if (select count(*) from public.notifications where user_id = dona and kind = 'teste_acabando') <> 1 then raise exception '6d'; end if;
  raise notice '6 rotina: avisa nos marcos, uma vez cada';

  -- 7. demorou 30 dias sem ativar: o teste começa sozinho
  delete from public.assinaturas where salon_id = sid;
  update public.salons set ativado_em = null, onboarding_concluido_em = now() - interval '31 days' where id = sid;
  n := public.cuidar_das_assinaturas();
  ac := public.acesso_do_salao(sid);
  if ac ->> 'fase' <> 'teste' then raise exception '7: %', ac; end if;
  if (select count(*) from public.notifications where user_id = dona and kind = 'teste_comecou') <> 1 then raise exception '7b'; end if;
  raise notice '7 teste começa sozinho depois de 30 dias';

  -- 8. cortesia sem prazo, assinatura paga com prazo, só a plataforma mexe
  ac := public.assinatura_definir(sid, 'ativa', null, 'cortesia');
  if ac ->> 'fase' <> 'ativa' or not (ac ->> 'sem_prazo')::boolean then raise exception '8: %', ac; end if;
  ac := public.assinatura_definir(sid, 'ativa', now() + interval '30 days', 'pix', 'pay_1');
  if ac ->> 'fase' <> 'ativa' or (ac ->> 'dias')::int <> 30 then raise exception '8b: %', ac; end if;
  perform set_config('request.jwt.claim.sub', dona::text, true);
  begin
    perform public.assinatura_definir(sid, 'ativa', null, 'cortesia');
    raise exception '8c: a dona não podia';
  exception when others then
    if sqlerrm not like '%Só a plataforma%' then raise; end if;
  end;
  raise notice '8 cortesia / paga / só a plataforma';

  -- 9. autônoma segue grátis
  perform set_config('request.jwt.claim.sub', '', true);
  update public.salons set tipo = 'autonoma' where id = sid;
  if public.acesso_do_salao(sid) ->> 'fase' <> 'gratis' then raise exception '9'; end if;
  raise notice '9 autônoma: grátis';
  raise notice 'FIM DO ENSAIO — tudo certo';
end $$;
rollback;
