-- Ensaio da 146: a profissional atende categorias. Desfaz no fim.
begin;
do $$
declare
  salao uuid; dona uuid; prof uuid; cab uuid; unh uuid; outro_salao_cat uuid; sv1 uuid; sv2 uuid; r jsonb; j jsonb; n integer; m integer; arr uuid[];
begin
  select id, owner_id into salao, dona from public.salons where owner_id is not null order by created_at limit 1;
  if dona is null then raise exception 'ensaio precisa de um salão com dona'; end if;
  perform set_config('request.jwt.claim.sub', dona::text, true);
  select id into cab from public.categorias_de_servico where salon_id is null and slug = 'cabelo';
  select id into unh from public.categorias_de_servico where salon_id is null and slug = 'unhas';
  insert into public.categorias_de_servico (salon_id, nome, ordem) select id, 'De outro salão', 500 from public.salons where id <> salao limit 1 returning id into outro_salao_cat;
  if outro_salao_cat is null then raise exception 'ensaio precisa de dois salões no banco'; end if;

  -- 1. a coluna existe e a definição filtra o que não é do salão
  insert into public.professionals (salon_id, name, slug, active, situacao) values (salao, 'Teste Cat', 'teste-cat-' || substr(gen_random_uuid()::text, 1, 8), true, 'configurada') returning id into prof;
  r := public.equipe_definir_categorias(prof, array[cab, unh, outro_salao_cat, gen_random_uuid()]);
  if jsonb_array_length(r -> 'categorias') <> 2 then raise exception '1: esperava 2 categorias válidas, veio %', r; end if;
  select categorias into arr from public.professionals where id = prof;
  if not (cab = any (arr)) then raise exception '1b: não gravou'; end if;
  raise notice '1 definir categorias ok';

  -- 2. equipe_da_casa traz as categorias
  j := public.equipe_da_casa(salao);
  select count(*) into n from jsonb_array_elements(j) e where e ->> 'id' = prof::text and jsonb_array_length(e -> 'categorias') = 2;
  if n <> 1 then raise exception '2: equipe_da_casa sem categorias'; end if;
  raise notice '2 equipe_da_casa ok';

  -- 3. cobertura: serviço com e sem profissional
  insert into public.services (salon_id, name, duration_minutes, price, categoria_id) values (salao, 'Corte ensaio', 60, 80, cab) returning id into sv1;
  insert into public.services (salon_id, name, duration_minutes, price, categoria_id) values (salao, 'Escova ensaio', 45, 60, cab) returning id into sv2;
  insert into public.professional_services (professional_id, service_id) values (prof, sv1);
  select servicos, sem_profissional, to_jsonb(profissionais) into n, m, r from public.cobertura_por_categoria(salao) where categoria_id = cab;
  if n < 2 then raise exception '3: esperava >= 2 serviços em Cabelo, veio %', n; end if;
  if not (r ? 'Teste Cat') then raise exception '3b: profissional não listada: %', r; end if;
  if m < 1 then raise exception '3c: devia ter serviço sem profissional'; end if;
  raise notice '3 cobertura ok';

  -- 4. quem não é da casa não vê
  perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  select count(*) into n from public.cobertura_por_categoria(salao);
  if n <> 0 then raise exception '4: estranho viu a cobertura'; end if;
  begin
    perform public.equipe_definir_categorias(prof, array[cab]); raise exception '4b: estranho definiu categorias';
  exception when others then if sqlerrm like '4b%' then raise; end if; end;
  raise notice '4 permissões ok';
end $$;
rollback;
