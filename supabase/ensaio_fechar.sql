-- Ensaio do fechar o dia (077). Roda no banco de teste e desfaz.
begin;
do $$
declare prof record; svc record; cli uuid; cli2 uuid; dona uuid; a1 uuid; a2 uuid; a3 uuid; a4 uuid; troca uuid; r jsonb; n integer; st text; c record; f jsonb;
        agora timestamp := public.agora_local();
begin
  select p.* into prof from public.professionals p where p.active and p.user_id is not null limit 1;
  select s.* into svc from public.services s join public.professional_services ps on ps.service_id = s.id where ps.professional_id = prof.id limit 1;
  select id into cli from public.profiles where role = 'cliente' and id <> prof.user_id order by created_at limit 1;
  select p.id into cli2 from public.profiles p where p.role = 'cliente' and p.id not in (cli, prof.user_id)
    and not public.historico_ruim_comigo(p.id, prof.id) order by p.created_at limit 1;
  if cli2 is null then raise exception 'sem cliente limpa para o ensaio'; end if;
  select owner_id into dona from public.salons where id = prof.salon_id;
  update public.profiles set phone = null where id = prof.user_id;   -- sem telefone: o aceite tem que ir pelo app
  update public.professionals set aceite_manual = false, minutos_para_aceitar = 60 where id = prof.id;
  perform set_config('request.jwt.claim.sub', prof.user_id::text, false);

  -- 1. terminou há 10 min: a rotina pergunta "veio?" para a profissional (se for hora de gente acordada)
  perform public.silenciar_gatilho();
  insert into public.appointments (client_id, professional_id, service_id, date, start_time, end_time, salon_id, status)
  values (cli, prof.id, svc.id, agora::date, (agora - interval '70 minutes')::time, (agora - interval '10 minutes')::time, prof.salon_id, 'confirmado') returning id into a1;
  perform set_config('request.jwt.claim.sub', '', false);
  n := public.perguntar_se_veio();
  if extract(hour from agora) between 7 and 21 then
    if (select perguntado_em from public.appointments where id = a1) is null then raise exception 'não perguntou'; end if;
    if not exists (select 1 from public.notifications where user_id = prof.user_id and kind = 'veio' and (data ->> 'appointment_id')::uuid = a1) then raise exception 'sem push veio'; end if;
    raise notice '1 perguntou (ok)';
  else
    update public.appointments set perguntado_em = now() where id = a1;
    raise notice '1 madrugada: pergunta espera a manhã (ok)';
  end if;

  -- 2. sem resposta, 3 h depois conclui sozinho e o crédito de indicação vale
  if public.concluir_atendimentos_passados() <> 0 and (select status from public.appointments where id = a1) = 'concluido' then raise exception 'concluiu antes das 3 h'; end if;
  update public.appointments set perguntado_em = now() - interval '4 hours' where id = a1;
  n := public.concluir_atendimentos_passados();
  select status into st from public.appointments where id = a1;
  if st <> 'concluido' or (select baixa_por from public.appointments where id = a1) <> 'sistema' then raise exception 'não concluiu sozinho: %', st; end if;
  raise notice '2 concluiu sozinho (ok)';

  -- 3. concluído sozinho pode virar "não veio" em 72 h; abre a ciência da cliente
  perform set_config('request.jwt.claim.sub', prof.user_id::text, false);
  r := public.dar_baixa(a1, 'nao_veio');
  if (r ->> 'status') <> 'faltou' then raise exception 'correção falhou: %', r; end if;
  perform set_config('request.jwt.claim.sub', cli::text, false);
  if not exists (select 1 from public.minhas_ciencias() where appointment_id = a1 and motivo = 'falta') then raise exception 'ciência não abriu'; end if;
  raise notice '3 correção + ciência (ok)';

  -- 4. a cliente contesta: a profissional é avisada; perdoar a falta anula a ciência
  perform public.contestar_falta((select id from public.ciencias where appointment_id = a1), 'Eu fui, cheguei 10 min atrasada');
  if exists (select 1 from public.minhas_ciencias() where appointment_id = a1) then raise exception 'ciência contestada ainda aparece'; end if;
  if not exists (select 1 from public.notifications where user_id = prof.user_id and kind = 'contestacao') then raise exception 'profissional não avisada'; end if;
  perform set_config('request.jwt.claim.sub', prof.user_id::text, false);
  update public.appointments set status = 'confirmado' where id = a1;   -- perdoou
  if (select anulada_em from public.ciencias where appointment_id = a1) is null then raise exception 'ciência não anulada'; end if;
  raise notice '4 contestação (ok)';

  -- 5. histórico ruim com ELA força o aceite mesmo no automático; ficha em duas camadas
  perform public.silenciar_gatilho();
  update public.appointments set status = 'faltou' where id = a1;
  perform set_config('request.jwt.claim.sub', cli::text, false);
  insert into public.appointments (client_id, professional_id, service_id, date, start_time, end_time, salon_id)
  values (cli, prof.id, svc.id, agora::date + 30, '15:00', '16:00', prof.salon_id) returning id into a2;
  if (select status from public.appointments where id = a2) <> 'pendente' then raise exception 'devia esperar o aceite'; end if;
  if not exists (select 1 from public.aceites where appointment_id = a2 and resultado is null) then raise exception 'aceite não aberto (sem telefone?)'; end if;
  perform set_config('request.jwt.claim.sub', prof.user_id::text, false);
  select * into c from public.meus_pedidos() m where m.appointment_id = a2;
  if not c.por_historico then raise exception 'meus_pedidos sem por_historico'; end if;
  if (c.ficha -> 'comigo' ->> 'faltas')::int < 1 then raise exception 'ficha comigo sem falta: %', c.ficha; end if;
  raise notice '5 aceite por histórico: ficha=% (ok)', c.ficha;
  -- cliente limpa entra direto
  update public.profiles set phone = '(13) 99999-0002' where id = prof.user_id;
  perform set_config('request.jwt.claim.sub', cli2::text, false);
  insert into public.appointments (client_id, professional_id, service_id, date, start_time, end_time, salon_id)
  values (cli2, prof.id, svc.id, agora::date + 31, '15:00', '16:00', prof.salon_id) returning id into a3;
  if (select status from public.appointments where id = a3) <> 'confirmado' then raise exception 'cliente limpa devia entrar direto'; end if;
  raise notice '5b cliente limpa entra direto (ok)';

  -- 6. troca não respondida até o horário passar: vence, cancela os dois, sem falta, conta como sem resposta
  perform set_config('request.jwt.claim.sub', prof.user_id::text, false);
  perform public.silenciar_gatilho();
  update public.appointments set status = 'confirmado' where id = a3;
  update public.appointments set date = agora::date, start_time = (agora - interval '3 hours')::time, end_time = (agora - interval '2 hours')::time where id = a3;
  insert into public.appointments (client_id, professional_id, service_id, date, start_time, end_time, salon_id, status, remarca_de)
  values (cli2, prof.id, svc.id, agora::date + 7, '15:00', '16:00', prof.salon_id, 'pendente', a3) returning id into troca;
  insert into public.aceites (appointment_id, professional_id, salon_id, telefone_prof, telefone_cliente, expira_em)
  values (troca, prof.id, prof.salon_id, '', '', now() - interval '1 minute');
  update public.professionals set ao_expirar = 'confirma' where id = prof.id;
  n := public.resolver_aceites_vencidos();
  if (select status from public.appointments where id = a3) <> 'cancelado' or (select motivo_cancelamento from public.appointments where id = a3) <> 'troca_sem_resposta' then raise exception 'original devia cancelar por troca sem resposta'; end if;
  if (select status from public.appointments where id = troca) <> 'cancelado' then raise exception 'pedido de troca devia cair'; end if;
  if (select resultado from public.aceites where appointment_id = troca) <> 'vencido' then raise exception 'aceite devia ficar vencido'; end if;
  if exists (select 1 from public.ciencias where appointment_id in (a3, troca)) then raise exception 'não podia abrir ciência'; end if;
  if not exists (select 1 from public.notifications where user_id = cli2 and kind = 'troca_vencida') then raise exception 'cliente não avisada da troca vencida'; end if;
  raise notice '6 troca vencida (ok)';

  -- 7. "Remarcamos" pela profissional: horário novo ligado, antigo sai sem contar como cancelamento
  insert into public.appointments (client_id, professional_id, service_id, date, start_time, end_time, salon_id, status)
  values (cli2, prof.id, svc.id, agora::date, (agora - interval '5 hours')::time, (agora - interval '4 hours')::time, prof.salon_id, 'confirmado') returning id into a4;
  r := public.remarcar_por_fora(a4, agora::date + 3, '11:00');
  if not (r ->> 'ok')::boolean then raise exception 'remarcar falhou: %', r; end if;
  if (select cancelado_por from public.appointments where id = a4) <> 'remarcacao' then raise exception 'antigo devia sair como remarcacao'; end if;
  if (select status from public.appointments where id = (r ->> 'appointment_id')::uuid) <> 'confirmado' then raise exception 'novo devia estar confirmado'; end if;
  f := public.ficha_para_profissional(cli2, prof.id);
  if (f -> 'comigo' ->> 'cancelamentos')::int <> 0 then raise exception 'remarcação contou como cancelamento: %', f; end if;
  if (f -> 'comigo' ->> 'remarcacoes')::int < 1 then raise exception 'remarcação não contou: %', f; end if;
  raise notice '7 remarcamos: % (ok)', f -> 'comigo';

  -- 8. Veio / Não veio pela tela; pendências listam o que espera
  insert into public.appointments (client_id, professional_id, service_id, date, start_time, end_time, salon_id, status)
  values (cli2, prof.id, svc.id, agora::date, (agora - interval '90 minutes')::time, (agora - interval '30 minutes')::time, prof.salon_id, 'confirmado') returning id into a4;
  if not exists (select 1 from public.pendencias_de_baixa() p where p.appointment_id = a4 and p.situacao = 'esperando') then raise exception 'pendência não listada'; end if;
  r := public.dar_baixa(a4, 'veio');
  if (select status from public.appointments where id = a4) <> 'concluido' or (select baixa_por from public.appointments where id = a4) <> 'profissional' then raise exception 'veio falhou'; end if;
  raise notice '8 veio pela tela (ok)';

  -- 9. plataforma vê sem resposta e contestações
  update public.profiles set role = 'plataforma' where id = cli;
  perform set_config('request.jwt.claim.sub', cli::text, false);
  f := public.plataforma_confiabilidade(30);
  if (f ->> 'sem_resposta')::int < 1 or (f ->> 'contestacoes')::int < 1 then raise exception 'confiabilidade sem os novos: %', f; end if;
  raise notice '9 plataforma: sem_resposta=% contestacoes=% (ok)', f ->> 'sem_resposta', f ->> 'contestacoes';
  raise notice 'FIM DO ENSAIO — tudo certo';
end $$;
rollback;
