-- Ensaio das promoções (083). Roda no banco de teste e desfaz.
begin;
do $$
declare sal uuid; dona uuid; prof record; outra record; cli uuid; cli2 uuid; sv uuid;
        p_plat uuid; p_sal uuid; p_prof uuid; p_outra uuid; n integer; r record;
begin
  -- um salão com dona e duas profissionais com conta
  select s.id, s.owner_id into sal, dona from public.salons s
   where s.owner_id is not null and (select count(*) from public.professionals p where p.salon_id = s.id and p.active and p.user_id is not null) >= 2
   order by s.created_at limit 1;
  if sal is null then raise exception 'sem salão com dona e duas profissionais'; end if;
  select p.* into prof from public.professionals p where p.salon_id = sal and p.active and p.user_id is not null order by p.name limit 1;
  select p.* into outra from public.professionals p where p.salon_id = sal and p.active and p.user_id is not null and p.id <> prof.id order by p.name limit 1;
  select s.id into sv from public.services s join public.professional_services ps on ps.service_id = s.id where ps.professional_id = prof.id and s.active limit 1;
  -- cli: marcou com prof; cli2: sem nada com esse salão
  select a.client_id into cli from public.appointments a join public.profiles pf on pf.id = a.client_id and pf.role = 'cliente' where a.professional_id = prof.id limit 1;
  if cli is null then
    select id into cli from public.profiles where role = 'cliente' limit 1;
    perform public.silenciar_gatilho();
    insert into public.appointments (client_id, professional_id, service_id, date, start_time, end_time, salon_id, status)
    values (cli, prof.id, sv, current_date + 200, '09:00', '10:00', sal, 'confirmado');
  end if;
  select id into cli2 from public.profiles pf where pf.role = 'cliente' and pf.id <> cli
    and not exists (select 1 from public.appointments a join public.professionals p on p.id = a.professional_id where a.client_id = pf.id and p.salon_id = sal)
    and not exists (select 1 from public.vinculos v where v.client_id = pf.id and v.salon_id = sal)
    and not exists (select 1 from public.client_favorites f join public.professionals p on p.id = f.professional_id where f.client_id = pf.id and p.salon_id = sal)
    limit 1;
  if cli2 is null then
    -- ninguém de fora na base de teste: cria uma cliente sem vínculo nenhum
    cli2 := gen_random_uuid();
    perform public.silenciar_gatilho();
    insert into auth.users (id, email) values (cli2, 'fora-' || cli2::text || '@ensaio.local');
    insert into public.profiles (id, full_name, role) values (cli2, 'Cliente de Fora', 'cliente') on conflict (id) do update set role = 'cliente';
  end if;

  -- 1. a plataforma cria uma para todo mundo (a base de teste não tem conta da plataforma: promove a de fora por um instante)
  update public.profiles set role = 'plataforma' where id = cli2;
  perform set_config('request.jwt.claim.sub', cli2::text, false);
  set role authenticated;
  insert into public.promocoes (titulo, imagem_url) values ('Bem-vinda ao MIMO', 'https://x/plat.jpg') returning id into p_plat;
  reset role;
  update public.profiles set role = 'cliente' where id = cli2;
  raise notice '1 plataforma criou (ok)';

  -- 2. a dona cria uma do salão com serviço; a profissional cria a dela; a outra profissional a dela
  perform set_config('request.jwt.claim.sub', dona::text, false);
  set role authenticated;
  insert into public.promocoes (salon_id, service_id, titulo, texto, imagem_url) values (sal, sv, 'Semana da beleza', '20% off', 'https://x/sal.jpg') returning id into p_sal;
  reset role;
  perform set_config('request.jwt.claim.sub', prof.user_id::text, false);
  set role authenticated;
  insert into public.promocoes (professional_id, titulo, imagem_url) values (prof.id, 'Minha promo', 'https://x/prof.jpg') returning id into p_prof;
  reset role;
  if (select salon_id from public.promocoes where id = p_prof) <> sal then raise exception 'promo da profissional sem o salão'; end if;
  perform set_config('request.jwt.claim.sub', outra.user_id::text, false);
  set role authenticated;
  insert into public.promocoes (professional_id, titulo, imagem_url) values (outra.id, 'Promo da outra', 'https://x/outra.jpg') returning id into p_outra;
  -- a profissional não mexe na do salão nem na da colega
  begin
    update public.promocoes set titulo = 'hack' where id = p_sal;
    if (select titulo from public.promocoes where id = p_sal) = 'hack' then raise exception 'profissional editou a do salão'; end if;
    delete from public.promocoes where id = p_prof;
    if not exists (select 1 from public.promocoes where id = p_prof) then raise exception 'profissional apagou a da colega'; end if;
  end;
  reset role;
  raise notice '2 salão e profissionais criaram; cada uma só mexe na sua (ok)';

  -- 3. a cliente que marcou com prof vê: plataforma, salão, prof — e não a da outra
  perform set_config('request.jwt.claim.sub', cli::text, false);
  select count(*) into n from public.promocoes_para_mim() x where x.id in (p_plat, p_sal, p_prof); if n <> 3 then raise exception 'cliente devia ver 3, viu %', n; end if;
  if exists (select 1 from public.promocoes_para_mim() x where x.id = p_outra) then raise exception 'viu a da outra profissional'; end if;
  select * into r from public.promocoes_para_mim() x where x.id = p_sal;
  if r.professional_id is null then raise exception 'promo do salão com serviço devia apontar uma profissional'; end if;
  if (select x.id from public.promocoes_para_mim() x limit 1) <> p_prof then raise exception 'a da profissional devia vir primeiro'; end if;
  raise notice '3 cliente da carteira vê 3 (prof primeiro) e não vê a da outra (ok)';

  -- 4. a cliente de fora só vê a da plataforma
  perform set_config('request.jwt.claim.sub', cli2::text, false);
  select count(*) into n from public.promocoes_para_mim() x where x.id in (p_plat, p_sal, p_prof, p_outra); if n <> 1 then raise exception 'de fora devia ver 1, viu %', n; end if;
  raise notice '4 cliente de fora só vê a da plataforma (ok)';

  -- 5. favoritar a outra passa a ver a dela; pausar ou vencer some
  perform set_config('request.jwt.claim.sub', cli::text, false);
  insert into public.client_favorites (client_id, professional_id) values (cli, outra.id) on conflict do nothing;
  if not exists (select 1 from public.promocoes_para_mim() x where x.id = p_outra) then raise exception 'favoritou e não viu'; end if;
  update public.promocoes set ativa = false where id = p_outra;
  if exists (select 1 from public.promocoes_para_mim() x where x.id = p_outra) then raise exception 'pausada apareceu'; end if;
  update public.promocoes set ativa = true, inicio = current_date - 10, fim = current_date - 1 where id = p_outra;
  if exists (select 1 from public.promocoes_para_mim() x where x.id = p_outra) then raise exception 'vencida apareceu'; end if;
  raise notice '5 favorita vê; pausada e vencida somem (ok)';

  -- 6. contadores
  perform public.promocao_vista(array[p_sal, p_prof]);
  perform public.promocao_clicada(p_sal);
  if (select vistas from public.promocoes where id = p_sal) <> 1 or (select cliques from public.promocoes where id = p_sal) <> 1 then raise exception 'contadores'; end if;
  raise notice '6 vistas e cliques (ok)';
  raise notice 'FIM DO ENSAIO — tudo certo';
end $$;
rollback;
