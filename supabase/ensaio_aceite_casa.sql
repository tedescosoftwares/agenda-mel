-- Ensaio da 111: a regra da casa. Desfaz no fim.
begin;
do $$
declare sal record; dona uuid; p1 record; svc record; cli uuid; appt uuid; r jsonb; n integer; st text; nova uuid; deu boolean; adm_n integer;
begin
  select s.* into sal from public.salons s join public.salon_members m on m.salon_id = s.id and m.papel = 'admin' where s.active and s.tipo = 'salao' limit 1;
  select m.user_id into dona from public.salon_members m where m.salon_id = sal.id and m.papel = 'admin' limit 1;
  select p.* into p1 from public.professionals p where p.salon_id = sal.id and p.active order by p.name limit 1;
  select s.* into svc from public.services s where s.salon_id = sal.id and s.active limit 1;
  select id into cli from public.profiles where role = 'cliente' limit 1;
  perform public.silenciar_gatilho();

  -- 1. modo 'casa' com 30 min: as profissionais passam a pedir confirmação com esse prazo
  perform set_config('request.jwt.claim.sub', dona::text, false);
  set role authenticated;
  r := public.salao_aceite(sal.id, 'casa', 30, 'cancela');
  reset role;
  select count(*) into n from public.professionals where salon_id = sal.id and not (aceite_manual and minutos_para_aceitar = 30 and ao_expirar = 'cancela');
  if n <> 0 then raise exception '1: % profissionais fora da regra da casa', n; end if;
  raise notice '1 modo casa propagou ok (%)', r;

  -- 2. profissional nova nasce com a regra
  insert into public.professionals (salon_id, name, slug, active) values (sal.id, 'Ensaio Nova', 'ensaio-nova-' || left(gen_random_uuid()::text, 6), true) returning id into nova;
  select aceite_manual and minutos_para_aceitar = 30 into deu from public.professionals where id = nova;
  if not deu then raise exception '2: profissional nova sem a regra da casa'; end if;
  raise notice '2 nova nasce com a regra ok';

  -- 3. automático: ninguém pede confirmação
  perform set_config('request.jwt.claim.sub', dona::text, false);
  set role authenticated;
  r := public.salao_aceite(sal.id, 'automatico');
  reset role;
  select count(*) into n from public.professionals where salon_id = sal.id and aceite_manual;
  if n <> 0 then raise exception '3: ainda há % pedindo confirmação', n; end if;
  raise notice '3 automatico ok';

  -- 4. a casa decide um pendente sem pedido: confirma
  update public.appointments set status = 'cancelado' where professional_id = p1.id and date = current_date + 3 and status not in ('cancelado', 'faltou');
  insert into public.appointments (client_id, professional_id, service_id, salon_id, date, start_time, end_time, status, price_cents)
  values (cli, p1.id, svc.id, sal.id, current_date + 3, time '03:00', time '03:45', 'pendente', 5000) returning id into appt;
  update public.appointments set status = 'pendente' where id = appt;   -- garante, caso gatilho tenha confirmado
  perform set_config('request.jwt.claim.sub', dona::text, false);
  set role authenticated;
  r := public.casa_decide(appt, true);
  reset role;
  select status into st from public.appointments where id = appt;
  if st <> 'confirmado' then raise exception '4: devia estar confirmado, veio % (%)', st, r; end if;
  select count(*) into n from public.notifications where user_id = cli and kind = 'pedido_aceito' and (data ->> 'appointment_id') = appt::text;
  if n < 1 then raise exception '4: cliente não foi avisada'; end if;
  raise notice '4 casa confirma ok';

  -- 5. decidir de novo: já está confirmado
  perform set_config('request.jwt.claim.sub', dona::text, false);
  set role authenticated;
  r := public.casa_decide(appt, false);
  reset role;
  if (r ->> 'ok')::boolean then raise exception '5: deixou decidir um horário já confirmado'; end if;
  raise notice '5 nao decide duas vezes ok';

  -- 6. recusa: cancela pela casa e avisa
  insert into public.appointments (client_id, professional_id, service_id, salon_id, date, start_time, end_time, status, price_cents)
  values (cli, p1.id, svc.id, sal.id, current_date + 3, time '04:00', time '04:30', 'pendente', 3000) returning id into appt;
  update public.appointments set status = 'pendente' where id = appt;
  perform set_config('request.jwt.claim.sub', dona::text, false);
  set role authenticated;
  r := public.casa_decide(appt, false);
  reset role;
  select status into st from public.appointments where id = appt;
  if st <> 'cancelado' then raise exception '6: devia estar cancelado, veio %', st; end if;
  select count(*) into n from public.notifications where user_id = cli and kind = 'pedido_recusado' and (data ->> 'appointment_id') = appt::text;
  if n < 1 then raise exception '6: cliente não foi avisada da recusa'; end if;
  raise notice '6 casa recusa ok';

  -- 7. gente de fora não decide
  select id into cli from public.profiles where id <> dona and not exists (select 1 from public.salon_members m where m.user_id = profiles.id and m.salon_id = sal.id) and not exists (select 1 from public.professionals p where p.user_id = profiles.id) limit 1;
  insert into public.appointments (client_id, professional_id, service_id, salon_id, date, start_time, end_time, status, price_cents)
  values (cli, p1.id, svc.id, sal.id, current_date + 3, time '05:00', time '05:30', 'pendente', 3000) returning id into appt;
  update public.appointments set status = 'pendente' where id = appt;
  perform set_config('request.jwt.claim.sub', cli::text, false);
  deu := false;
  begin
    set role authenticated;
    r := public.casa_decide(appt, true);
    reset role;
  exception when others then deu := true; reset role;
  end;
  if not deu then raise exception '7: gente de fora decidiu'; end if;
  raise notice '7 gente de fora nao decide ok';

  -- 8. volta para 'profissional': não mexe em ninguém
  perform set_config('request.jwt.claim.sub', dona::text, false);
  set role authenticated;
  r := public.salao_aceite(sal.id, 'profissional');
  reset role;
  if (r ->> 'profissionais_ajustadas')::int <> 0 then raise exception '8: modo profissional mexeu nas profissionais'; end if;
  raise notice '8 modo profissional ok';

  raise notice 'FIM DO ENSAIO — tudo certo';
end $$;
rollback;
