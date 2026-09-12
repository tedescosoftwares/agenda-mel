-- Ensaio do aviso único (078). Roda no banco de teste e desfaz.
begin;
do $$
declare prof record; svc record; cli uuid; a1 uuid; r jsonb; n integer; t text;
begin
  select p.* into prof from public.professionals p where p.active and p.user_id is not null limit 1;
  select s.* into svc from public.services s join public.professional_services ps on ps.service_id = s.id where ps.professional_id = prof.id limit 1;
  select p.id into cli from public.profiles p where p.role = 'cliente' and p.id <> prof.user_id and not public.historico_ruim_comigo(p.id, prof.id) order by p.created_at limit 1;
  update public.profiles set phone = '(13) 99999-0003' where id = prof.user_id;
  update public.professionals set aceite_manual = true, minutos_para_aceitar = 120 where id = prof.id;
  delete from public.notifications where user_id = prof.user_id;

  -- 1. pedido comum com aceite manual: UM aviso para a profissional
  perform set_config('request.jwt.claim.sub', cli::text, false);
  insert into public.appointments (client_id, professional_id, service_id, date, start_time, end_time, salon_id)
  values (cli, prof.id, svc.id, current_date + 95, '15:00', '16:00', prof.salon_id) returning id into a1;
  select count(*) into n from public.notifications where user_id = prof.user_id;
  if n <> 1 then raise exception 'pedido comum: esperava 1 aviso, veio %', n; end if;
  raise notice '1 pedido comum: 1 aviso (ok)';

  -- 2. aceita; a cliente pede troca: UM aviso, e dizendo que é troca
  perform set_config('request.jwt.claim.sub', prof.user_id::text, false);
  perform public.resolver_aceite(a1, true);
  delete from public.notifications where user_id = prof.user_id;
  perform set_config('request.jwt.claim.sub', cli::text, false);
  r := public.pedir_remarcacao(a1, current_date + 96, '10:00');
  if not (r ->> 'ok')::boolean then raise exception 'remarcação falhou: %', r; end if;
  select count(*) into n from public.notifications where user_id = prof.user_id;
  if n <> 1 then raise exception 'troca: esperava 1 aviso, veio %', n; end if;
  select title || ' | ' || body into t from public.notifications where user_id = prof.user_id;
  if t not like 'Pedido de troca%' or t not like '%quer mudar%para%' then raise exception 'texto da troca: %', t; end if;
  raise notice '2 troca com aceite: [%] (ok)', t;

  -- 3. sem aceite manual: a troca entra direto e o aviso diz "remarcou"
  update public.professionals set aceite_manual = false, confirmar_historico_ruim = false where id = prof.id;
  perform set_config('request.jwt.claim.sub', prof.user_id::text, false);
  update public.appointments set status = 'cancelado' where remarca_de = a1 and status = 'pendente';
  delete from public.notifications where user_id = prof.user_id;
  perform set_config('request.jwt.claim.sub', cli::text, false);
  r := public.pedir_remarcacao(a1, current_date + 97, '10:00');
  select count(*) into n from public.notifications where user_id = prof.user_id;
  if n <> 1 then raise exception 'troca direta: esperava 1 aviso, veio %', n; end if;
  select title || ' | ' || body into t from public.notifications where user_id = prof.user_id;
  if t not like '%remarcou%' or t not like '%era %' then raise exception 'texto da troca direta: %', t; end if;
  raise notice '3 troca direta: [%] (ok)', t;
  raise notice 'FIM DO ENSAIO — tudo certo';
end $$;
rollback;
