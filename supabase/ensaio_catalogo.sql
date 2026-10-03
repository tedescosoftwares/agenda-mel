-- Ensaio da 143/144: o catálogo de serviços. Roda depois das duas e desfaz no fim.
begin;
do $$
declare
  salao uuid; plat uuid; comum uuid;
  cab uuid; unh uuid; cil uuid; sob uuid; mic uuid; barba uuid;
  fam uuid; sv uuid; tc uuid; outra_fam uuid; servico_salao uuid; servico_antigo uuid;
  n integer; m integer; t text; r jsonb; fam_json jsonb;
begin
  select id into salao from public.salons order by created_at limit 1;
  select id into plat from public.profiles order by created_at limit 1;
  update public.profiles set role = 'plataforma' where id = plat;
  select id into comum from public.profiles where id <> plat and role <> 'plataforma' order by created_at limit 1;

  -- 1. categorias: as novas existem, os ids antigos foram preservados, Barba inativa
  select id into cab from public.categorias_de_servico where salon_id is null and slug = 'cabelo';
  select id into unh from public.categorias_de_servico where salon_id is null and slug = 'unhas';
  select id into cil from public.categorias_de_servico where salon_id is null and slug = 'cilios';
  select id into sob from public.categorias_de_servico where salon_id is null and slug = 'sobrancelhas';
  select id into mic from public.categorias_de_servico where salon_id is null and slug = 'micropigmentacao';
  select id into barba from public.categorias_de_servico where salon_id is null and slug = 'barba';
  if cab is null or unh is null or cil is null or sob is null or mic is null or barba is null then raise exception '1: faltou categoria'; end if;
  if exists (select 1 from public.categorias_de_servico where salon_id is null and lower(nome) in ('rosto', 'corpo', 'massagem e bem-estar', 'sobrancelhas e cílios')) then raise exception '1b: nome antigo sobrou'; end if;
  if (select ativa from public.categorias_de_servico where id = barba) then raise exception '1c: Barba devia estar inativa'; end if;
  if (select nome from public.categorias_de_servico where id = sob) <> 'Sobrancelhas' then raise exception '1d: Sobrancelhas não renomeada'; end if;
  select count(*) into n from public.categorias_de_servico where salon_id is null and slug is null;
  if n > 0 then raise exception '1e: % categorias da plataforma sem slug', n; end if;
  raise notice '1 categorias ok (Barba inativa, ids preservados)';

  -- 2. a semente bateu com o JSON
  select count(*) into n from public.catalogo_itens where tipo = 'familia';
  select count(*) into m from public.catalogo_itens where tipo = 'servico';
  if n <> 51 or m <> 252 then raise exception '2: esperava 51 famílias e 252 serviços, veio % e %', n, m; end if;
  select count(*) into n from public.catalogo_itens where tipo = 'tecnica';
  if n <> 161 then raise exception '2b: esperava 161 técnicas, veio %', n; end if;
  if not exists (select 1 from public.catalogo_visivel where caminho = array['Cabelo'::text, 'Alisamento e alinhamento', 'Progressiva', 'Orgânica']) then raise exception '2c: caminho Cabelo › Alisamento › Progressiva › Orgânica não visível'; end if;
  if (select categoria_id from public.catalogo_itens where slug = 'micropigmentacao-labial') <> mic then raise exception '2d: micro labial fora de Micropigmentação'; end if;
  if exists (select 1 from public.catalogo_itens where categoria_id = barba) then raise exception '2e: Barba recebeu catálogo'; end if;
  if exists (select 1 from public.catalogo_itens where 'masculino' = any (tags)) then raise exception '2f: tag masculino na semente'; end if;
  if exists (select 1 from public.catalogo_itens where tipo = 'servico' and 'habilitacao' = any (tags) and prioridade_sugestao > 0) then raise exception '2g: habilitacao com prioridade de sugestão'; end if;
  raise notice '2 semente: 51/252/161, micro no lugar, nada em Barba';

  -- 3. reaplicar a semente não duplica e preserva o editorial (ativa) da Plataforma
  select id into sv from public.catalogo_itens where slug = 'progressiva' and categoria_id = cab;
  update public.catalogo_itens set ativa = false where id = sv;
  fam_json := '{"categorias":[{"slug":"cabelo","familias":[{"slug":"alisamento-e-alinhamento","nome":"Alisamento e alinhamento","servicos":[{"slug":"progressiva","nome":"Progressiva renomeada","duracao_sugerida":170,"tags":["alisamento"],"tecnicas":[{"slug":"organica","nome":"Orgânica"}]}]}]}]}'::jsonb;
  r := public.catalogo_semear(fam_json);
  if (r ->> 'servicos')::integer <> 1 then raise exception '3: semente parcial devolveu %', r; end if;
  select count(*) into n from public.catalogo_itens where tipo = 'servico'; if n <> 252 then raise exception '3b: duplicou (%)', n; end if;
  if (select nome from public.catalogo_itens where id = sv) <> 'Progressiva renomeada' then raise exception '3c: não atualizou o nome'; end if;
  if (select duracao_sugerida from public.catalogo_itens where id = sv) <> 170 then raise exception '3d: não atualizou a duração'; end if;
  if (select ativa from public.catalogo_itens where id = sv) then raise exception '3e: a semente ligou de volta o que a Plataforma desligou'; end if;
  update public.catalogo_itens set ativa = true, nome = 'Progressiva', duracao_sugerida = 180 where id = sv;
  raise notice '3 reaplicar: idempotente e respeita ativa';

  -- 4. unicidade: família repetida na categoria; filho repetido no pai
  begin
    insert into public.catalogo_itens (tipo, categoria_id, nome, slug) values ('familia', cab, 'Corte 2', 'corte'); raise exception '4a: aceitou família duplicada';
  exception when unique_violation then null; end;
  select id into fam from public.catalogo_itens where categoria_id = cab and pai_id is null and slug = 'corte';
  begin
    insert into public.catalogo_itens (tipo, categoria_id, pai_id, nome, slug) values ('servico', cab, fam, 'Corte de cabelo 2', 'corte-de-cabelo'); raise exception '4b: aceitou filho duplicado';
  exception when unique_violation then null; end;
  -- o mesmo slug em outro pai é permitido
  select id into outra_fam from public.catalogo_itens where categoria_id = cab and pai_id is null and slug = 'cachos';
  insert into public.catalogo_itens (tipo, categoria_id, pai_id, nome, slug) values ('servico', cab, outra_fam, 'Corte de cabelo (cachos)', 'corte-de-cabelo') returning id into servico_salao;
  delete from public.catalogo_itens where id = servico_salao;
  raise notice '4 unicidade ok';

  -- 5. hierarquia inválida
  select id into sv from public.catalogo_itens where categoria_id = cab and slug = 'progressiva';
  select id into tc from public.catalogo_itens where pai_id = sv and slug = 'organica';
  begin insert into public.catalogo_itens (tipo, categoria_id, pai_id, nome, slug) values ('tecnica', cab, tc, 'x', 'x'); raise exception '5a: técnica filha de técnica'; exception when check_violation then null; end;
  begin insert into public.catalogo_itens (tipo, categoria_id, pai_id, nome, slug) values ('servico', cab, sv, 'x', 'x'); raise exception '5b: serviço filho de serviço'; exception when check_violation then null; end;
  begin insert into public.catalogo_itens (tipo, categoria_id, pai_id, nome, slug) values ('servico', cab, tc, 'x', 'x'); raise exception '5c: serviço filho de técnica'; exception when check_violation then null; end;
  begin insert into public.catalogo_itens (tipo, categoria_id, pai_id, nome, slug) values ('familia', cab, fam, 'x', 'x'); raise exception '5d: família com pai'; exception when check_violation then null; end;
  begin insert into public.catalogo_itens (tipo, categoria_id, pai_id, nome, slug) values ('servico', unh, fam, 'x', 'x'); raise exception '5e: filho de categoria diferente'; exception when check_violation then t := sqlerrm; end;
  if position('mesma categoria' in t) = 0 then raise exception '5e: mensagem ruim: %', t; end if;
  begin insert into public.catalogo_itens (tipo, categoria_id, pai_id, nome, slug) values ('servico', cab, null, 'x', 'x'); raise exception '5f: serviço sem pai'; exception when check_violation then null; end;
  begin insert into public.catalogo_itens (tipo, categoria_id, nome, slug) values ('familia', (select id from public.categorias_de_servico where salon_id is not null limit 1), 'x', 'x'); raise exception '5g: categoria de salão'; exception when check_violation or not_null_violation then null; end;
  begin insert into public.catalogo_itens (tipo, categoria_id, nome, slug) values ('familia', cab, 'x', 'Com Espaço'); raise exception '5h: slug inválido'; exception when check_violation then null; end;
  raise notice '5 hierarquia ok';

  -- 6. visibilidade: família inativa esconde descendentes sem mexer neles; categoria inativa esconde tudo
  select id into fam from public.catalogo_itens where categoria_id = unh and pai_id is null and slug = 'alongamento';
  select count(*) into n from public.catalogo_visivel where familia_id = fam; if n < 10 then raise exception '6: alongamento devia ter >= 10 visíveis, veio %', n; end if;
  update public.catalogo_itens set ativa = false where id = fam;
  select count(*) into m from public.catalogo_visivel where familia_id = fam; if m <> 0 then raise exception '6a: família inativa ainda mostra % itens', m; end if;
  if exists (select 1 from public.catalogo_itens where pai_id = fam and not ativa) then raise exception '6b: cascata mexeu nos filhos'; end if;
  update public.catalogo_itens set ativa = true where id = fam;
  select count(*) into m from public.catalogo_visivel where familia_id = fam; if m <> n then raise exception '6c: reativar não devolveu tudo (% de %)', m, n; end if;
  -- técnica ativa com serviço pai inativo não aparece
  update public.catalogo_itens set ativa = false where id = sv;
  if exists (select 1 from public.catalogo_visivel where id = tc) then raise exception '6d: técnica de serviço inativo visível'; end if;
  if (select ativa from public.catalogo_itens where id = tc) is distinct from true then raise exception '6e: técnica perdeu o estado'; end if;
  update public.catalogo_itens set ativa = true where id = sv;
  update public.categorias_de_servico set ativa = false where id = unh;
  if exists (select 1 from public.catalogo_visivel where categoria_id = unh) then raise exception '6f: categoria inativa ainda mostra'; end if;
  update public.categorias_de_servico set ativa = true where id = unh;
  if (select updated_at > created_at from public.catalogo_itens where id = sv) is distinct from true then raise exception '6g: updated_at não andou'; end if;
  raise notice '6 visibilidade ok';

  -- 7. vínculo: serviço do salão aponta para o item; item usado não apaga; técnica de serviço usado também não
  insert into public.services (salon_id, name, duration_minutes, price, catalogo_item_id, categoria_id) values (salao, 'Progressiva da casa', 180, 250, sv, cab) returning id into servico_salao;
  begin delete from public.catalogo_itens where id = sv; raise exception '7a: apagou item usado'; exception when restrict_violation then t := sqlerrm; end;
  if position('1 serviço(s)' in t) = 0 then raise exception '7a: mensagem ruim: %', t; end if;
  begin delete from public.catalogo_itens where id = fam; raise exception '7b: apagou família com filhos'; exception when foreign_key_violation then null; end;
  -- serviço personalizado: sem item, categoria obrigatória vem do chute pelo nome (slug novo)
  insert into public.services (salon_id, name, duration_minutes, price) values (salao, 'Banho de lua', 60, 90) returning id into servico_antigo;
  if (select catalogo_item_id from public.services where id = servico_antigo) is not null then raise exception '7c'; end if;
  if (select categoria_id from public.services where id = servico_antigo) is null then raise exception '7d: personalizado sem categoria'; end if;
  if public.categoria_sugerida('Extensão de cílios volume russo') <> cil then raise exception '7e: chute não achou Cílios'; end if;
  if public.categoria_sugerida('Micropigmentação de sobrancelhas') <> mic then raise exception '7f: chute não achou Micropigmentação'; end if;
  if public.categoria_sugerida('Design de sobrancelhas') <> sob then raise exception '7g: chute não achou Sobrancelhas'; end if;
  if public.categoria_sugerida('Barba completa') <> (select id from public.categorias_de_servico where salon_id is null and slug = 'outros') then raise exception '7h: barba devia cair em Outros'; end if;
  -- apagar o serviço do salão libera o item
  delete from public.services where id in (servico_salao, servico_antigo);
  raise notice '7 vínculo ok';

  -- 8. RLS: quem não é plataforma lê a árvore e não escreve
  perform set_config('request.jwt.claim.sub', comum::text, true);
  set local role authenticated;
  select count(*) into n from public.catalogo_visivel; if n < 400 then raise exception '8: autenticada vê só %', n; end if;
  begin
    insert into public.catalogo_itens (tipo, categoria_id, nome, slug) values ('familia', cab, 'Furo', 'furo'); raise exception '8a: autenticada escreveu';
  exception when insufficient_privilege or check_violation then null; end;
  if exists (select 1 from public.catalogo_itens where slug = 'furo') then raise exception '8a: entrou'; end if;
  reset role;
  perform set_config('request.jwt.claim.sub', plat::text, true);
  set local role authenticated;
  insert into public.catalogo_itens (tipo, categoria_id, nome, slug) values ('familia', cab, 'Teste plataforma', 'teste-plataforma');
  delete from public.catalogo_itens where slug = 'teste-plataforma';
  reset role;
  raise notice '8 RLS ok';

  -- 9. os momentos da Mel do cardápio
  select count(*) into n from public.mel_momentos where chave like 'cardapio_%'; if n <> 7 then raise exception '9: esperava 7 momentos cardapio_, veio %', n; end if;
  raise notice '9 momentos da Mel ok';
end $$;
rollback;
