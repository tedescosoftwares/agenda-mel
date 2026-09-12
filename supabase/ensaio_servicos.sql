-- Ensaio de vários serviços (079). Roda no banco de teste e desfaz.
begin;
do $$
declare prof record; s1 record; s2 record; cli uuid; r jsonb; a record; n integer; troca jsonb;
begin
  select p.* into prof from public.professionals p where p.active and p.user_id is not null
    and (select count(*) from public.professional_services ps join public.services s on s.id = ps.service_id where ps.professional_id = p.id and s.active) >= 2 limit 1;
  select s.* into s1 from public.services s join public.professional_services ps on ps.service_id = s.id where ps.professional_id = prof.id and s.active order by s.name limit 1;
  select s.* into s2 from public.services s join public.professional_services ps on ps.service_id = s.id where ps.professional_id = prof.id and s.active and s.id <> s1.id order by s.name limit 1;
  select p.id into cli from public.profiles p where p.role = 'cliente' and p.id <> prof.user_id and not public.historico_ruim_comigo(p.id, prof.id) order by p.created_at limit 1;
  update public.professionals set aceite_manual = false, confirmar_historico_ruim = false where id = prof.id;
  perform set_config('request.jwt.claim.sub', cli::text, false);

  -- 1. marca dois serviços: soma duração e preço, nome junto, dois itens
  r := public.marcar_servicos(prof.id, array[s1.id, s2.id], current_date + 150, '14:00', 'sem esmalte escuro');
  if not (r ->> 'ok')::boolean then raise exception 'marcar falhou: %', r; end if;
  select * into a from public.appointments where id = (r ->> 'appointment_id')::uuid;
  if a.service_name <> s1.name || ' + ' || s2.name then raise exception 'nome: %', a.service_name; end if;
  if a.price_cents <> round(s1.price * 100) + round(s2.price * 100) then raise exception 'preço: %', a.price_cents; end if;
  if a.end_time <> ('14:00'::time + make_interval(mins => s1.duration_minutes + s2.duration_minutes)) then raise exception 'fim: %', a.end_time; end if;
  select count(*) into n from public.appointment_services where appointment_id = a.id;
  if n <> 2 then raise exception 'itens: %', n; end if;
  if a.status <> 'confirmado' then raise exception 'sem aceite devia confirmar: %', a.status; end if;
  raise notice '1 dois serviços: % · % min · R$ % (ok)', a.service_name, s1.duration_minutes + s2.duration_minutes, a.price_cents / 100.0;

  -- 2. horário ocupado devolve motivo, não erro
  r := public.marcar_servicos(prof.id, array[s1.id], current_date + 150, '14:10');
  if (r ->> 'ok')::boolean or (r ->> 'motivo') <> 'ocupado' then raise exception 'ocupado: %', r; end if;
  raise notice '2 ocupado (ok)';

  -- 3. serviço que não é da profissional é recusado
  begin
    perform public.marcar_servicos(prof.id, array[s1.id, gen_random_uuid()], current_date + 151, '14:00');
    raise exception 'devia recusar';
  exception when others then
    if sqlerrm not like 'Algum serviço%' then raise; end if;
  end;
  raise notice '3 serviço estranho recusado (ok)';

  -- 4. a troca leva os itens junto
  troca := public.pedir_remarcacao(a.id, current_date + 152, '14:00');
  if not (troca ->> 'ok')::boolean then raise exception 'troca: %', troca; end if;
  select count(*) into n from public.appointment_services where appointment_id = (troca ->> 'appointment_id')::uuid;
  if n <> 2 then raise exception 'troca sem itens: %', n; end if;
  raise notice '4 troca com itens (ok)';
  raise notice 'FIM DO ENSAIO — tudo certo';
end $$;
rollback;
