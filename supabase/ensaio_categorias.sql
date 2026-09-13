-- Ensaio das categorias (082). Roda no banco de teste e desfaz.
begin;
do $$
declare sal uuid; dona uuid; outros uuid; cab uuid; minha uuid; sv uuid; n integer; cat uuid;
begin
  select id, owner_id into sal, dona from public.salons where owner_id is not null order by created_at limit 1;
  select id into outros from public.categorias_de_servico where salon_id is null and nome = 'Outros';
  select id into cab from public.categorias_de_servico where salon_id is null and nome = 'Cabelo';
  select count(*) into n from public.categorias_de_servico where salon_id is null; if n < 10 then raise exception 'faltam pré-definidas: %', n; end if;

  -- 1. os serviços já cadastrados ganharam categoria
  select count(*) into n from public.services where categoria_id is null; if n > 0 then raise exception '% serviços sem categoria', n; end if;
  if (select categoria_id from public.services where name = 'Design de sobrancelhas' limit 1) <> (select id from public.categorias_de_servico where salon_id is null and nome = 'Sobrancelhas e cílios') then raise exception 'sobrancelha classificada errado'; end if;
  if (select categoria_id from public.services where name = 'Limpeza de pele' limit 1) <> (select id from public.categorias_de_servico where salon_id is null and nome = 'Rosto') then raise exception 'limpeza de pele classificada errado'; end if;
  raise notice '1 serviços existentes classificados (ok)';

  -- 2. serviço novo sem categoria é chutado pelo nome; com categoria, respeita
  perform public.silenciar_gatilho();
  perform set_config('request.jwt.claim.sub', dona::text, false);
  insert into public.services (salon_id, name, duration_minutes, price) values (sal, 'Escova modelada', 45, 60) returning id, categoria_id into sv, cat;
  if cat <> cab then raise exception 'escova devia ser Cabelo'; end if;
  insert into public.services (salon_id, name, duration_minutes, price, categoria_id) values (sal, 'Escova especial', 45, 60, outros) returning categoria_id into cat;
  if cat <> outros then raise exception 'devia respeitar a categoria escolhida'; end if;
  raise notice '2 chute pelo nome e escolha respeitada (ok)';

  -- 3. a dona cria uma categoria do salão e põe o serviço nela; outra pessoa não consegue
  set role authenticated;
  insert into public.categorias_de_servico (salon_id, nome) values (sal, 'Noivas') returning id into minha;
  update public.services set categoria_id = minha where id = sv;
  reset role;
  if (select categoria_id from public.services where id = sv) <> minha then raise exception 'não moveu para Noivas'; end if;
  begin
    set role authenticated;
    insert into public.categorias_de_servico (salon_id, nome) values (sal, 'Noivas');
    reset role;
    raise exception 'devia barrar nome repetido';
  exception when unique_violation then reset role;
  end;
  perform set_config('request.jwt.claim.sub', (select id::text from public.profiles where role = 'cliente' limit 1), false);
  begin
    set role authenticated;
    insert into public.categorias_de_servico (salon_id, nome) values (sal, 'Intrusa');
    reset role;
    raise exception 'cliente criou categoria do salão';
  exception when insufficient_privilege then reset role;
  end;
  raise notice '3 categoria do salão: dona cria, nome único, cliente barrada (ok)';

  -- 4. apagar a categoria não apaga o serviço: ele volta para a categoria chutada pelo nome
  perform set_config('request.jwt.claim.sub', dona::text, false);
  set role authenticated;
  delete from public.categorias_de_servico where id = minha;
  reset role;
  if not exists (select 1 from public.services where id = sv) then raise exception 'serviço sumiu'; end if;
  if (select categoria_id from public.services where id = sv) is distinct from cab then raise exception 'devia voltar para Cabelo'; end if;
  raise notice '4 apagar categoria mantém o serviço, que volta para a chutada (ok)';
  raise notice 'FIM DO ENSAIO — tudo certo';
end $$;
rollback;
