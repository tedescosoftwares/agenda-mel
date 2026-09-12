-- Ensaio da conclusão automática (075, regra da 077: só depois de perguntar). Roda no banco de teste e desfaz.
begin;
do $$
declare prof record; svc record; cli uuid; velho uuid; recente uuid; comtroca uuid; troca uuid; n integer; st text;
begin
  select p.* into prof from public.professionals p where p.active limit 1;
  select s.* into svc from public.services s join public.professional_services ps on ps.service_id = s.id where ps.professional_id = prof.id limit 1;
  select id into cli from public.profiles where role = 'cliente' limit 1;
  perform public.silenciar_gatilho();

  -- ontem, confirmado, perguntado há 4 h sem resposta: conclui
  insert into public.appointments (client_id, professional_id, service_id, date, start_time, end_time, salon_id, status, perguntado_em)
  values (cli, prof.id, svc.id, current_date - 1, '10:00', '11:00', prof.salon_id, 'confirmado', now() - interval '4 hours') returning id into velho;
  -- daqui a 2 dias, confirmado: não mexe
  insert into public.appointments (client_id, professional_id, service_id, date, start_time, end_time, salon_id, status)
  values (cli, prof.id, svc.id, current_date + 2, '10:00', '11:00', prof.salon_id, 'confirmado') returning id into recente;
  -- ontem, confirmado, perguntado, mas com pedido de troca aberto: espera
  insert into public.appointments (client_id, professional_id, service_id, date, start_time, end_time, salon_id, status, perguntado_em)
  values (cli, prof.id, svc.id, current_date - 1, '14:00', '15:00', prof.salon_id, 'confirmado', now() - interval '4 hours') returning id into comtroca;
  insert into public.appointments (client_id, professional_id, service_id, date, start_time, end_time, salon_id, status, remarca_de)
  values (cli, prof.id, svc.id, current_date + 5, '14:00', '15:00', prof.salon_id, 'pendente', comtroca) returning id into troca;

  n := public.concluir_atendimentos_passados();
  raise notice '1 concluídos: %', n;
  select status into st from public.appointments where id = velho;
  if st <> 'concluido' then raise exception 'ontem devia concluir: %', st; end if;
  select status into st from public.appointments where id = recente;
  if st <> 'confirmado' then raise exception 'futuro não devia mexer: %', st; end if;
  select status into st from public.appointments where id = comtroca;
  if st <> 'confirmado' then raise exception 'com troca aberta devia esperar: %', st; end if;
  raise notice '2 regras (ok)';

  -- a rotina inteira devolve o número
  if (public.rodar_rotinas() ->> 'concluidos') is null then raise exception 'rodar_rotinas sem concluidos'; end if;
  raise notice '3 rotina (ok)';
  raise notice 'FIM DO ENSAIO — tudo certo';
end $$;
rollback;
