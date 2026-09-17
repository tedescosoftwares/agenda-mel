-- Ensaio da 097: concluir só depois que o horário começou; destaques sem corte. Roda no banco de teste e desfaz.
begin;
do $$
declare
  prof record; svc record; cli uuid; futuro uuid; passado uuid; passado2 uuid; sozinho uuid;
  deu boolean; msg text; st text; r jsonb; n integer; i integer;
begin
  select p.* into prof from public.professionals p where p.active and p.user_id is not null and p.salon_id is not null limit 1;
  select s.* into svc from public.services s join public.professional_services ps on ps.service_id = s.id where ps.professional_id = prof.id and s.active limit 1;
  select id into cli from public.profiles where role = 'cliente' and id <> prof.user_id limit 1;
  perform public.silenciar_gatilho();

  -- daqui a uma semana, confirmado
  insert into public.appointments (client_id, professional_id, service_id, date, start_time, end_time, salon_id, status)
  values (cli, prof.id, svc.id, public.agora_local()::date + 7, '10:00', '11:00', prof.salon_id, 'confirmado') returning id into futuro;
  -- ontem, confirmado (dois: um para o update direto, outro para dar_baixa)
  insert into public.appointments (client_id, professional_id, service_id, date, start_time, end_time, salon_id, status)
  values (cli, prof.id, svc.id, public.agora_local()::date - 1, '10:00', '11:00', prof.salon_id, 'confirmado') returning id into passado;
  insert into public.appointments (client_id, professional_id, service_id, date, start_time, end_time, salon_id, status)
  values (cli, prof.id, svc.id, public.agora_local()::date - 1, '14:00', '15:00', prof.salon_id, 'confirmado') returning id into passado2;

  -- 1. a profissional tenta concluir o futuro pelo update direto: recusa
  perform set_config('request.jwt.claim.sub', prof.user_id::text, false);
  deu := false; msg := null;
  begin
    set role authenticated;
    update public.appointments set status = 'concluido' where id = futuro;
    reset role;
  exception when others then deu := true; msg := sqlerrm; reset role;
  end;
  if not deu then raise exception 'concluiu um horário que ainda não começou'; end if;
  if msg not like 'Só dá para concluir%' then raise exception 'mensagem errada: %', msg; end if;
  raise notice '1 futuro não conclui: "%" (ok)', msg;

  -- 2. cancelar o futuro continua liberado para ela
  set role authenticated;
  update public.appointments set status = 'cancelado' where id = futuro;
  reset role;
  select status into st from public.appointments where id = futuro;
  if st <> 'cancelado' then raise exception 'não deixou cancelar o futuro: %', st; end if;
  raise notice '2 futuro cancela (ok)';

  -- 3. a cliente não conclui nem o que já passou (a validação voltou a funcionar)
  perform set_config('request.jwt.claim.sub', cli::text, false);
  deu := false; msg := null;
  begin
    set role authenticated;
    update public.appointments set status = 'concluido' where id = passado;
    reset role;
  exception when others then deu := true; msg := sqlerrm; reset role;
  end;
  if not deu then raise exception 'a cliente concluiu o próprio horário'; end if;
  raise notice '3 cliente não conclui: "%" (ok)', msg;

  -- 4. a profissional conclui o de ontem: passa
  perform set_config('request.jwt.claim.sub', prof.user_id::text, false);
  set role authenticated;
  update public.appointments set status = 'concluido' where id = passado;
  reset role;
  select status into st from public.appointments where id = passado;
  if st <> 'concluido' then raise exception 'ontem devia concluir: %', st; end if;
  raise notice '4 passado conclui (ok)';

  -- 5. dar_baixa 'veio' num horário futuro: recusa
  insert into public.appointments (client_id, professional_id, service_id, date, start_time, end_time, salon_id, status)
  values (cli, prof.id, svc.id, public.agora_local()::date + 7, '16:00', '17:00', prof.salon_id, 'confirmado') returning id into futuro;
  deu := false; msg := null;
  begin
    r := public.dar_baixa(futuro, 'veio');
  exception when others then deu := true; msg := sqlerrm;
  end;
  if not deu or msg not like 'Só dá para concluir%' then raise exception 'dar_baixa deixou concluir o futuro: % %', deu, msg; end if;
  raise notice '5 dar_baixa futuro recusa (ok)';

  -- 6. dar_baixa 'veio' no de ontem: passa
  r := public.dar_baixa(passado2, 'veio');
  if r ->> 'status' <> 'concluido' then raise exception 'dar_baixa passado: %', r; end if;
  raise notice '6 dar_baixa passado conclui (ok)';

  -- 7. a rotina do sistema não é afetada: ontem, perguntado há 4 h, conclui sozinho
  perform set_config('request.jwt.claim.sub', '', false);
  insert into public.appointments (client_id, professional_id, service_id, date, start_time, end_time, salon_id, status, perguntado_em)
  values (cli, prof.id, svc.id, public.agora_local()::date - 1, '17:00', '18:00', prof.salon_id, 'confirmado', now() - interval '4 hours') returning id into sozinho;
  n := public.concluir_atendimentos_passados();
  select status into st from public.appointments where id = sozinho;
  if st <> 'concluido' then raise exception 'rotina devia concluir: %', st; end if;
  raise notice '7 rotina conclui sozinha (ok)';

  -- 8. destaques: 15 marcados no salão, a cliente vê os 15 (antes cortava em 12)
  for i in 1..15 loop
    insert into public.services (name, price, duration_minutes, salon_id, destaque, active) values ('Destaque ' || i, 50, 30, prof.salon_id, true, true) returning id into svc;
    insert into public.professional_services (professional_id, service_id) values (prof.id, svc.id);
  end loop;
  -- um destaque que ninguém faz fica de fora (098)
  insert into public.services (name, price, duration_minutes, salon_id, destaque, active) values ('Destaque sem ninguem', 50, 30, prof.salon_id, true, true);
  -- sem vínculo nenhum: só o agendamento com a profissional já basta
  delete from public.vinculos where client_id = cli;
  perform set_config('request.jwt.claim.sub', cli::text, false);
  select count(*) into n from public.destaques_para_mim() d where d.salon_id = prof.salon_id and d.name like 'Destaque %';
  if n <> 15 then raise exception 'destaques: esperava 15, veio %', n; end if;
  -- e um serviço em destaque de salão inativo não aparece
  update public.salons set active = false where id = prof.salon_id;
  select count(*) into n from public.destaques_para_mim() d where d.salon_id = prof.salon_id;
  if n <> 0 then raise exception 'salão inativo mostrou destaques: %', n; end if;
  update public.salons set active = true where id = prof.salon_id;
  -- quem é da equipe vê a vitrine da própria casa, sem vínculo
  perform set_config('request.jwt.claim.sub', prof.user_id::text, false);
  select count(*) into n from public.destaques_para_mim() d where d.salon_id = prof.salon_id and d.name like 'Destaque %';
  if n <> 15 then raise exception 'equipe: esperava 15, veio %', n; end if;
  if exists (select 1 from public.destaques_para_mim() d where d.name = 'Destaque sem ninguem') then raise exception 'destaque sem ninguém apareceu'; end if;
  raise notice '8 destaques: 15 de 15, sem ninguém some, salão inativo some, equipe vê (ok)';

  raise notice 'FIM DO ENSAIO — tudo certo';
end $$;
rollback;
