-- Ensaio da página do salão (085). Roda no banco de teste e desfaz.
begin;
do $$
declare sal uuid; dona uuid; cli uuid; j jsonb; n integer;
begin
  select s.id, s.owner_id into sal, dona from public.salons s where s.owner_id is not null
    and exists (select 1 from public.professionals p where p.salon_id = s.id and p.active) order by s.created_at limit 1;
  select id into cli from public.profiles where role = 'cliente' limit 1;

  -- 1. a dona preenche a página; uma cliente não consegue
  perform set_config('request.jwt.claim.sub', dona::text, false);
  set role authenticated;
  update public.salons set descricao = 'Um cantinho para você se cuidar.', fotos = array['https://x/1.jpg', 'https://x/2.jpg'], instagram = '@studiomel', whatsapp = '(13) 99999-0000' where id = sal;
  reset role;
  if (select descricao from public.salons where id = sal) is null then raise exception 'dona não salvou'; end if;
  perform set_config('request.jwt.claim.sub', cli::text, false);
  set role authenticated;
  update public.salons set descricao = 'hack' where id = sal;
  reset role;
  if (select descricao from public.salons where id = sal) = 'hack' then raise exception 'cliente editou o salão'; end if;
  raise notice '1 dona edita, cliente não (ok)';

  -- 2. a página traz tudo
  j := public.pagina_do_salao(sal);
  if j -> 'salao' ->> 'descricao' <> 'Um cantinho para você se cuidar.' then raise exception 'sem descrição: %', j -> 'salao'; end if;
  if jsonb_array_length(j -> 'salao' -> 'fotos') <> 2 then raise exception 'fotos'; end if;
  if j -> 'salao' ->> 'whatsapp' <> '(13) 99999-0000' then raise exception 'whatsapp'; end if;
  select count(*) into n from public.professionals p where p.salon_id = sal and p.active;
  if jsonb_array_length(j -> 'equipe') <> n then raise exception 'equipe: % vs %', jsonb_array_length(j -> 'equipe'), n; end if;
  select count(*) into n from public.services sv where sv.salon_id = sal and sv.active;
  if jsonb_array_length(j -> 'servicos') <> n then raise exception 'serviços'; end if;
  if jsonb_typeof(j -> 'horarios') <> 'array' or jsonb_typeof(j -> 'promocoes') <> 'array' then raise exception 'listas'; end if;
  if (j -> 'servicos' -> 0 -> 'quem') is null then raise exception 'serviço sem quem faz'; end if;
  raise notice '2 página completa: equipe, serviços com quem faz, horários, promoções (ok)';

  -- 3. salão inativo não tem página
  update public.salons set active = false where id = sal;
  if (public.pagina_do_salao(sal) -> 'salao') is not null and jsonb_typeof(public.pagina_do_salao(sal) -> 'salao') <> 'null' then raise exception 'inativo com página'; end if;
  raise notice '3 salão inativo some (ok)';

  -- 4. destaques (086): a dona marca; a cliente com vínculo vê
  update public.salons set active = true where id = sal;
  perform set_config('request.jwt.claim.sub', dona::text, false);
  set role authenticated;
  update public.services set destaque = true where id = (select id from public.services where salon_id = sal and active limit 1);
  reset role;
  insert into public.vinculos (client_id, salon_id, como) values (cli, sal, 'codigo') on conflict (client_id, salon_id) do update set saiu_em = null;
  perform set_config('request.jwt.claim.sub', cli::text, false);
  select count(*) into n from public.destaques_para_mim() d where d.salon_id = sal;
  if n <> 1 then raise exception 'destaques: %', n; end if;
  raise notice '4 destaques do salão (ok)';

  -- 5. capas (087): a padrão da plataforma vale; a do salão sobrepõe
  update public.categorias_de_servico set imagem_url = 'https://x/padrao.jpg' where salon_id is null and nome = 'Cabelo';
  if (public.pagina_do_salao(sal) -> 'capas' -> (select id::text from public.categorias_de_servico where salon_id is null and nome = 'Cabelo') ->> 0) <> 'https://x/padrao.jpg' then raise exception 'capa padrão não veio'; end if;
  perform set_config('request.jwt.claim.sub', dona::text, false);
  set role authenticated;
  insert into public.capas_de_categoria (salon_id, categoria_id, imagens) values (sal, (select id from public.categorias_de_servico where salon_id is null and nome = 'Cabelo'), array['https://x/minha1.jpg', 'https://x/minha2.jpg']);
  reset role;
  if (public.pagina_do_salao(sal) -> 'capas' -> (select id::text from public.categorias_de_servico where salon_id is null and nome = 'Cabelo') ->> 1) <> 'https://x/minha2.jpg' then raise exception 'capas do salão não sobrepuseram'; end if;
  -- preferida (088): a cliente escolhe, troca e desfaz; só profissional do salão
  perform set_config('request.jwt.claim.sub', cli::text, false);
  perform public.escolher_preferida(sal, (select id from public.professionals where salon_id = sal and active limit 1));
  if (public.pagina_do_salao(sal) ->> 'preferida') is null then raise exception 'preferida não ficou'; end if;
  if exists (select 1 from public.professionals where salon_id <> sal and active) then
    begin
      perform public.escolher_preferida(sal, (select id from public.professionals where salon_id <> sal and active limit 1));
      raise exception 'aceitou profissional de outro salão';
    exception when others then
      if sqlerrm not like '%não atende nesse salão%' then raise; end if;
    end;
  end if;
  perform public.escolher_preferida(sal, null);
  if (public.pagina_do_salao(sal) ->> 'preferida') is not null then raise exception 'preferida não sumiu'; end if;
  perform set_config('request.jwt.claim.sub', cli::text, false);
  set role authenticated;
  insert into public.capas_de_categoria (salon_id, categoria_id, imagens) values (sal, (select id from public.categorias_de_servico where salon_id is null and nome = 'Unhas'), array['https://x/hack.jpg']);
  reset role;
  raise exception 'cliente pôs capa';
exception when insufficient_privilege then
  reset role;
  raise notice '5 capas em lista, preferida e cliente barrada na capa (ok)';
  raise notice 'FIM DO ENSAIO — tudo certo';
end $$;
rollback;
