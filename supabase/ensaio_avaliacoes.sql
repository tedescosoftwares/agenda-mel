-- Ensaio do convite para avaliar (089). Roda no banco de teste e desfaz.
begin;
do $$
declare
  prof record; svc record; cli uuid; a1 uuid; a2 uuid; a3 uuid; n integer;
  agora timestamp := public.agora_local();
  deu_erro boolean;
begin
  select p.* into prof from public.professionals p where p.active and p.user_id is not null limit 1;
  select s.* into svc from public.services s join public.professional_services ps on ps.service_id = s.id where ps.professional_id = prof.id limit 1;
  -- uma cliente nova, sem outros horários hoje
  cli := gen_random_uuid();
  perform public.silenciar_gatilho();
  insert into auth.users (id, email) values (cli, 'avalia-' || cli::text || '@ensaio.local');
  insert into public.profiles (id, full_name, role) values (cli, 'Cliente Que Avalia', 'cliente') on conflict (id) do update set role = 'cliente';

  -- 1. dois horários hoje: um terminou há 2 h, o outro ainda não acabou → nada sai
  insert into public.appointments (client_id, professional_id, service_id, date, start_time, end_time, salon_id, status)
  values (cli, prof.id, svc.id, agora::date, (agora - interval '3 hours')::time, (agora - interval '2 hours')::time, prof.salon_id, 'confirmado') returning id into a1;
  insert into public.appointments (client_id, professional_id, service_id, date, start_time, end_time, salon_id, status)
  values (cli, prof.id, svc.id, agora::date, (agora - interval '30 minutes')::time, (agora + interval '30 minutes')::time, prof.salon_id, 'confirmado') returning id into a2;
  n := public.convidar_avaliacoes(true);
  if exists (select 1 from public.notifications where user_id = cli and kind = 'avaliar_atendimento') then raise exception 'convidou no meio da visita'; end if;
  raise notice '1 espera o último horário do dia (ok)';

  -- 2. o segundo terminou há 1h30: saem os DOIS convites, um por serviço
  update public.appointments set start_time = (agora - interval '2 hours')::time, end_time = (agora - interval '90 minutes')::time where id = a2;
  n := public.convidar_avaliacoes(true);
  if (select count(*) from public.notifications where user_id = cli and kind = 'avaliar_atendimento') <> 2 then raise exception 'esperava 2 convites, achei %', (select count(*) from public.notifications where user_id = cli and kind = 'avaliar_atendimento'); end if;
  if exists (select 1 from public.appointments where id in (a1, a2) and avaliacao_pedida_em is null) then raise exception 'não marcou avaliacao_pedida_em'; end if;
  if not exists (select 1 from public.notifications where user_id = cli and kind = 'avaliar_atendimento' and action_url = '/cliente/agendamento/' || a1 || '?avaliar=1' and title like 'Como foi com %') then raise exception 'convite sem o link certo'; end if;
  raise notice '2 dois convites: %', (select string_agg(title || ' / ' || body, ' | ') from public.notifications where user_id = cli and kind = 'avaliar_atendimento');

  -- 3. rodar de novo não repete
  n := public.convidar_avaliacoes(true);
  if n <> 0 or (select count(*) from public.notifications where user_id = cli and kind = 'avaliar_atendimento') <> 2 then raise exception 'repetiu o convite'; end if;
  raise notice '3 não repete (ok)';

  -- 4. a cliente avalia o horário confirmado que já terminou (antes da baixa)
  perform set_config('request.jwt.claim.sub', cli::text, false);
  set role authenticated;
  insert into public.reviews (appointment_id, client_id, professional_id, nota, comentario) values (a1, cli, prof.id, 5, 'Adorei');
  reset role;
  raise notice '4 avaliou antes da baixa (ok)';

  -- 5. horário futuro confirmado: não dá para avaliar
  perform public.silenciar_gatilho();
  insert into public.appointments (client_id, professional_id, service_id, date, start_time, end_time, salon_id, status)
  values (cli, prof.id, svc.id, agora::date + 3, '10:00', '11:00', prof.salon_id, 'confirmado') returning id into a3;
  deu_erro := false;
  begin
    perform set_config('request.jwt.claim.sub', cli::text, false);
    set role authenticated;
    insert into public.reviews (appointment_id, client_id, professional_id, nota) values (a3, cli, prof.id, 5);
    reset role;
  exception when others then deu_erro := true; reset role;
  end;
  if not deu_erro then raise exception 'avaliou horário futuro'; end if;
  raise notice '5 futuro não avalia (ok)';

  -- 6. quem já avaliou não recebe convite; quem desligou avisos também não
  update public.appointments set avaliacao_pedida_em = null where id = a1;
  n := public.convidar_avaliacoes(true);
  if (select count(*) from public.notifications where user_id = cli and kind = 'avaliar_atendimento') <> 2 then raise exception 'convidou quem já avaliou'; end if;
  update public.appointments set avaliacao_pedida_em = null where id = a2;
  update public.profiles set accepts_reminders = false where id = cli;
  n := public.convidar_avaliacoes(true);
  if (select count(*) from public.notifications where user_id = cli and kind = 'avaliar_atendimento') <> 2 then raise exception 'convidou quem desligou avisos'; end if;
  raise notice '6 respeita avaliação feita e avisos desligados (ok)';

  -- 7. a rotina geral devolve a contagem
  if not (public.rodar_rotinas() ? 'avaliacoes') then raise exception 'rodar_rotinas sem avaliacoes'; end if;
  raise notice '7 rodar_rotinas ok';
end $$;
rollback;
