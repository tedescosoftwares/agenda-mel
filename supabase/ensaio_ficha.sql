-- Ensaio da ficha da cliente (076). Roda no banco de teste e desfaz.
begin;
do $$
declare prof record; svc record; cli uuid; dona uuid; a1 uuid; a2 uuid; a3 uuid; f jsonb; r record; ap public.appointments%rowtype; n integer;
begin
  select p.* into prof from public.professionals p where p.active and p.user_id is not null limit 1;
  select s.* into svc from public.services s join public.professional_services ps on ps.service_id = s.id where ps.professional_id = prof.id limit 1;
  select id into cli from public.profiles where role = 'cliente' limit 1;
  select owner_id into dona from public.salons where id = prof.salon_id;
  perform public.silenciar_gatilho();

  -- 1. cliente cancela em cima da hora: fica registrado quem e quando
  perform set_config('request.jwt.claim.sub', cli::text, false);
  insert into public.appointments (client_id, professional_id, service_id, date, start_time, end_time, salon_id, status)
  values (cli, prof.id, svc.id, (public.agora_local() + interval '2 hours')::date, (public.agora_local() + interval '2 hours')::time, (public.agora_local() + interval '3 hours')::time, prof.salon_id, 'confirmado') returning id into a1;
  update public.appointments set status = 'cancelado' where id = a1;
  select * into ap from public.appointments where id = a1;
  if ap.cancelado_por <> 'cliente' or ap.cancelado_em is null then raise exception 'não marcou quem cancelou: %', ap.cancelado_por; end if;
  if not public.cancelou_tarde(ap) then raise exception 'devia contar como tardio'; end if;
  raise notice '1 cancelamento tardio registrado (ok)';

  -- 2. falta marcada pela profissional
  insert into public.appointments (client_id, professional_id, service_id, date, start_time, end_time, salon_id, status)
  values (cli, prof.id, svc.id, current_date - 3, '10:00', '11:00', prof.salon_id, 'confirmado') returning id into a2;
  perform set_config('request.jwt.claim.sub', prof.user_id::text, false);
  update public.appointments set status = 'faltou' where id = a2;
  if (select faltou_em from public.appointments where id = a2) is null then raise exception 'faltou_em vazio'; end if;

  -- 3. a ficha, vista pela profissional
  f := public.ficha_da_cliente(cli, prof.salon_id);
  raise notice '3 ficha: %', f;
  if (f ->> 'faltas')::int < 1 or (f ->> 'cancelamentos')::int < 1 or (f ->> 'cancelamentos_tardios')::int < 1 then raise exception 'ficha incompleta: %', f; end if;

  -- 4. a cliente não vê a própria ficha
  perform set_config('request.jwt.claim.sub', cli::text, false);
  if public.ficha_da_cliente(cli, prof.salon_id) is not null then raise exception 'cliente viu a ficha'; end if;
  raise notice '4 cliente não vê (ok)';

  -- 5. listas com as colunas
  if dona is not null then
    perform set_config('request.jwt.claim.sub', dona::text, false);
    select * into r from public.clientes_do_salao(prof.salon_id) c where c.client_id = cli;
    if r.client_id is not null and (r.faltas < 1) then raise exception 'clientes_do_salao sem faltas'; end if;
  end if;
  update public.profiles set role = 'plataforma' where id = cli;
  perform set_config('request.jwt.claim.sub', cli::text, false);
  f := public.plataforma_confiabilidade(30);
  if (f ->> 'faltas')::int < 1 then raise exception 'confiabilidade sem faltas: %', f; end if;
  select * into r from public.plataforma_pessoas(null, 500) p where p.id = cli;
  if r.faltas < 1 then raise exception 'plataforma_pessoas sem faltas'; end if;
  update public.profiles set role = 'cliente' where id = cli;
  raise notice '5 listas: %', f;

  -- 6. fim do expediente: atendimento de hoje que terminou há mais de 30 min gera o lembrete
  insert into public.appointments (client_id, professional_id, service_id, date, start_time, end_time, salon_id, status)
  values (cli, prof.id, svc.id, public.agora_local()::date, (public.agora_local() - interval '3 hours')::time, (public.agora_local() - interval '2 hours')::time, prof.salon_id, 'confirmado') returning id into a3;
  n := public.lembrar_fechar_dia();
  if n < 1 then raise exception 'não lembrou'; end if;
  if not exists (select 1 from public.notifications where user_id = prof.user_id and kind = 'fechar_dia') then raise exception 'sem aviso fechar_dia'; end if;
  if public.lembrar_fechar_dia() <> 0 then raise exception 'lembrou duas vezes'; end if;
  raise notice '6 fechar o dia (ok)';
  raise notice 'FIM DO ENSAIO — tudo certo';
end $$;
rollback;
