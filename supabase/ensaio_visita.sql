-- Ensaio das visitas (081). Roda no banco de teste e desfaz.
begin;
do $$
declare sal uuid; pa record; pb record; sa record; sb record; cli uuid; r jsonb; sug record; n integer; ids uuid[]; d date := current_date + 160; t text;
begin
  -- um salão com duas profissionais ativas com conta
  select p.salon_id into sal from public.professionals p where p.active and p.user_id is not null group by p.salon_id having count(*) >= 2 limit 1;
  if sal is null then raise exception 'sem salão com duas profissionais'; end if;
  select p.* into pa from public.professionals p where p.salon_id = sal and p.active and p.user_id is not null order by p.name limit 1;
  select p.* into pb from public.professionals p where p.salon_id = sal and p.active and p.user_id is not null and p.id <> pa.id order by p.name limit 1;
  select s.* into sa from public.services s join public.professional_services ps on ps.service_id = s.id where ps.professional_id = pa.id and s.active order by s.name limit 1;
  select s.* into sb from public.services s join public.professional_services ps on ps.service_id = s.id where ps.professional_id = pb.id and s.active and s.id <> sa.id order by s.name limit 1;
  if sa.id is null or sb.id is null then raise exception 'sem serviços'; end if;
  select p.id into cli from public.profiles p where p.role = 'cliente' and p.id not in (pa.user_id, pb.user_id)
    and not public.historico_ruim_comigo(p.id, pa.id) and not public.historico_ruim_comigo(p.id, pb.id) order by p.created_at limit 1;
  -- expediente das duas no dia do ensaio: 09:00–18:00
  delete from public.professional_hours where professional_id in (pa.id, pb.id) and weekday = extract(dow from d);
  insert into public.professional_hours (professional_id, weekday, open, start_time, end_time) values (pa.id, extract(dow from d), true, '09:00', '18:00'), (pb.id, extract(dow from d), true, '09:00', '18:00');
  update public.professionals set aceite_manual = true, minutos_para_aceitar = 120, confirmar_historico_ruim = false where id in (pa.id, pb.id);
  update public.profiles set phone = null where id in (pa.user_id, pb.user_id);

  -- 1. o salão marca "costuma ir junto": A → B
  perform set_config('request.jwt.claim.sub', pa.user_id::text, false);   -- a profissional que faz A cuida de A
  perform public.salvar_servicos_juntos(sa.id, array[sb.id]);
  if not exists (select 1 from public.servicos_sugeridos_para(array[sa.id]) x where x.sugerido_id = sb.id) then raise exception 'sugestão não ficou'; end if;
  raise notice '1 costuma ir junto: % → % (ok)', sa.name, sb.name;

  -- 2. sugestão de visita: B com a outra profissional, logo depois de A
  perform set_config('request.jwt.claim.sub', cli::text, false);
  select * into sug from public.sugestoes_de_visita(pa.id, array[sa.id], d, '10:00', false) limit 1;
  if sug.service_id is null then raise exception 'sem sugestão de visita'; end if;
  if sug.professional_id <> pb.id or sug.modo <> 'logo_depois' or sug.hora_sugerida <> ('10:00'::time + make_interval(mins => sa.duration_minutes)) then raise exception 'sugestão errada: % % %', sug.professional_id, sug.modo, sug.hora_sugerida; end if;
  raise notice '2 sugestão: % com % às % (%) (ok)', sug.service_name, sug.professional_name, sug.hora_sugerida, sug.modo;

  -- 2b. com espera: se B estiver ocupada logo depois, oferece o próximo horário
  perform public.silenciar_gatilho();
  insert into public.appointments (client_id, professional_id, service_id, date, start_time, end_time, salon_id, status)
  values (cli, pb.id, sb.id, d, sug.hora_sugerida, (sug.hora_sugerida + make_interval(mins => sb.duration_minutes))::time, sal, 'confirmado');
  if exists (select 1 from public.sugestoes_de_visita(pa.id, array[sa.id], d, '10:00', false)) then raise exception 'sem espera não devia oferecer'; end if;
  select * into sug from public.sugestoes_de_visita(pa.id, array[sa.id], d, '10:00', true) limit 1;
  if sug.service_id is null or sug.modo <> 'com_espera' or sug.hora_sugerida <= ('10:00'::time + make_interval(mins => sa.duration_minutes)) then raise exception 'com espera errado: %', sug; end if;
  delete from public.appointments where client_id = cli and date = d and professional_id = pb.id;
  raise notice '2b com espera: às % (ok)', sug.hora_sugerida;
  -- 2c. já emendou outra parte até as 12:30: a próxima só depois disso
  select * into sug from public.sugestoes_de_visita(pa.id, array[sa.id], d, '10:00', false, '12:30') limit 1;
  if sug.service_id is null or sug.hora_sugerida <> '12:30'::time then raise exception 'apos errado: %', sug; end if;
  raise notice '2c depois de outra parte: às % (ok)', sug.hora_sugerida;

  -- 3. marca a visita: duas partes, um aviso só para a cliente, um pedido para cada profissional
  delete from public.notifications where user_id in (cli, pa.user_id, pb.user_id);
  r := public.marcar_visita(d, jsonb_build_array(
        jsonb_build_object('prof', pa.id, 'servicos', jsonb_build_array(sa.id), 'hora', '10:00'),
        jsonb_build_object('prof', pb.id, 'servicos', jsonb_build_array(sb.id), 'hora', to_char('10:00'::time + make_interval(mins => sa.duration_minutes), 'HH24:MI'))), 'visita de ensaio');
  if not (r ->> 'ok')::boolean then raise exception 'visita: %', r; end if;
  select array_agg(x::uuid) into ids from jsonb_array_elements_text(r -> 'partes') x;
  select count(*) into n from public.appointments where visita_id = (r ->> 'visita_id')::uuid; if n <> 2 then raise exception 'partes: %', n; end if;
  select count(*) into n from public.notifications where user_id = cli; if n <> 1 then raise exception 'cliente devia receber 1 aviso, recebeu %', n; end if;
  select count(*) into n from public.notifications where user_id = pa.user_id and kind = 'pedido_de_aceite'; if n <> 1 then raise exception 'A sem pedido'; end if;
  select count(*) into n from public.notifications where user_id = pb.user_id and kind = 'pedido_de_aceite'; if n <> 1 then raise exception 'B sem pedido'; end if;
  select count(*) into n from public.partes_da_visita(ids[1]); if n <> 1 then raise exception 'partes_da_visita: %', n; end if;
  perform set_config('request.jwt.claim.sub', pa.user_id::text, false);
  select mp.visita into t from public.meus_pedidos() mp where mp.appointment_id = ids[1];
  if t is null or t not like '%' || sb.name || ' com ' || pb.name || '%aguardando%' then raise exception 'pedido sem a visita: %', t; end if;
  perform set_config('request.jwt.claim.sub', cli::text, false);
  raise notice '3 visita marcada: 1 aviso para a cliente, 1 pedido por profissional, pedido mostra a visita (ok)';

  -- 4. A aceita: cliente sabe que falta B; B recusa: cliente decide, A é avisada, nada muda sozinho
  perform set_config('request.jwt.claim.sub', pa.user_id::text, false);
  delete from public.notifications where user_id in (cli, pa.user_id);
  r := public.resolver_aceite(ids[1], true);
  select body into t from public.notifications where user_id = cli order by created_at desc limit 1;
  if t not like '%Falta a outra profissional%' then raise exception 'aceite de A: %', t; end if;
  perform set_config('request.jwt.claim.sub', pb.user_id::text, false);
  delete from public.notifications where user_id in (cli, pa.user_id);
  r := public.resolver_aceite(ids[2], false);
  if (select status from public.appointments where id = ids[2]) <> 'cancelado' then raise exception 'B devia cancelar a parte dela'; end if;
  if (select status from public.appointments where id = ids[1]) <> 'confirmado' then raise exception 'A devia continuar confirmado'; end if;
  select kind || ' | ' || body into t from public.notifications where user_id = cli order by created_at desc limit 1;
  if t not like 'parte_recusada%' or t not like '%Quer marcar%' then raise exception 'aviso da cliente: %', t; end if;
  select kind || ' | ' || body into t from public.notifications where user_id = pa.user_id order by created_at desc limit 1;
  if t not like 'visita_em_espera%' or t not like '%mantido%' then raise exception 'aviso de A: %', t; end if;
  raise notice '4 recusa de B: cliente decide, A avisada, A mantida (ok)';

  -- 5. parte ocupada desfaz a visita inteira
  perform set_config('request.jwt.claim.sub', cli::text, false);
  begin
    perform public.marcar_visita(d + 1, jsonb_build_array(
        jsonb_build_object('prof', pa.id, 'servicos', jsonb_build_array(sa.id), 'hora', '10:00'),
        jsonb_build_object('prof', pa.id, 'servicos', jsonb_build_array(sa.id), 'hora', '10:00')));
    raise exception 'devia falhar';
  exception when others then
    if sqlerrm not like 'ocupado:%' then raise; end if;
  end;
  if exists (select 1 from public.appointments where client_id = cli and date = d + 1) then raise exception 'sobrou parte da visita falhada'; end if;
  raise notice '5 visita ocupada desfeita inteira (ok)';
  raise notice 'FIM DO ENSAIO — tudo certo';
end $$;
rollback;
