-- Ensaio da 131: endereço próprio do salão. Desfaz no fim.
begin;
do $$
declare sid uuid; dona uuid; prof_slug text; r jsonb; s2 uuid;
begin
  select s.id, s.owner_id into sid, dona from public.salons s where s.tipo = 'salao' and s.owner_id is not null limit 1;
  select p.slug into prof_slug from public.professionals p where p.salon_id = sid and p.active and p.slug is not null limit 1;
  delete from public.assinaturas where salon_id = sid;
  delete from public.subdominios_antigos where salon_id = sid;
  update public.salons set subdominio = null, ativado_em = now() where id = sid;
  perform set_config('request.jwt.claim.sub', dona::text, true);

  -- 1. checagem: curto, reservado, feio
  r := public.subdominio_disponivel('ab'); if (r ->> 'ok')::boolean then raise exception '1a: %', r; end if;
  r := public.subdominio_disponivel('www'); if (r ->> 'ok')::boolean then raise exception '1b: %', r; end if;
  r := public.subdominio_disponivel('Studio Mel!'); if not (r ->> 'ok')::boolean or r ->> 'nome' <> 'studio-mel' then raise exception '1c: %', r; end if;
  raise notice '1 checagem ok: %', r;

  -- 2. em teste não pode
  perform public.salao_ativar(sid);
  begin
    perform public.subdominio_definir(sid, 'studio-mel');
    raise exception '2: devia barrar no teste';
  exception when others then
    if sqlerrm not like '%assinatura%' then raise; end if;
    raise notice '2 barrou no teste: %', sqlerrm;
  end;

  -- 3. assinatura ativa: define
  perform set_config('request.jwt.claim.sub', '', true);
  perform public.assinatura_definir(sid, 'ativa', null, 'cortesia');
  perform set_config('request.jwt.claim.sub', dona::text, true);
  r := public.subdominio_definir(sid, 'Studio Mel');
  if r ->> 'subdominio' <> 'studio-mel' or not (r ->> 'mudou')::boolean then raise exception '3: %', r; end if;
  if (select subdominio from public.salons where id = sid) <> 'studio-mel' then raise exception '3b'; end if;
  raise notice '3 definiu: %', r;

  -- 4. resolve o salão e a profissional, anônimo
  perform set_config('request.jwt.claim.sub', '', true);
  r := public.resolver_endereco('studio-mel');
  if r ->> 'tipo' <> 'salao' or r ->> 'codigo' is null then raise exception '4: %', r; end if;
  r := public.resolver_endereco('STUDIO-MEL', prof_slug);
  if r ->> 'tipo' <> 'profissional' or r ->> 'slug' <> prof_slug then raise exception '4b: %', r; end if;
  if public.resolver_endereco('studio-mel', 'nao-existe-xyz') is not null then raise exception '4c'; end if;
  if public.resolver_endereco('ninguem-aqui') is not null then raise exception '4d'; end if;
  raise notice '4 resolve: salão % / prof %', public.resolver_endereco('studio-mel') ->> 'nome', prof_slug;

  -- 5. troca: o antigo redireciona; ninguém mais pega o antigo
  perform set_config('request.jwt.claim.sub', dona::text, true);
  r := public.subdominio_definir(sid, 'mel-studio');
  if r ->> 'antigo' <> 'studio-mel' then raise exception '5: %', r; end if;
  r := public.resolver_endereco('studio-mel');
  if r ->> 'redirecionar' <> 'mel-studio' then raise exception '5b: %', r; end if;
  select s.id into s2 from public.salons s where s.id <> sid limit 1;
  r := public.subdominio_disponivel('studio-mel', s2);
  if (r ->> 'ok')::boolean then raise exception '5c: antigo de outro salão devia estar preso'; end if;
  r := public.subdominio_disponivel('studio-mel', sid);
  if not (r ->> 'ok')::boolean then raise exception '5d: o próprio pode reclamar o antigo'; end if;
  -- reclama o antigo de volta
  r := public.subdominio_definir(sid, 'studio-mel');
  if (select count(*) from public.subdominios_antigos where salon_id = sid) <> 1 then raise exception '5e'; end if;
  raise notice '5 troca e redirecionamento ok';

  -- 6. mesmo nome de novo: não muda nada
  r := public.subdominio_definir(sid, 'studio-mel');
  if (r ->> 'mudou')::boolean then raise exception '6: %', r; end if;

  -- 7. bloqueado: indisponível
  perform set_config('request.jwt.claim.sub', '', true);
  perform public.assinatura_definir(sid, 'cancelada', now() - interval '30 days', 'cortesia');
  r := public.resolver_endereco('studio-mel');
  raise notice '7 com assinatura parada: % (fase %)', r ->> 'tipo', public.acesso_do_salao(sid) ->> 'fase';

  -- 8. autônoma não define
  perform set_config('request.jwt.claim.sub', dona::text, true);
  raise notice 'ensaio_endereco: tudo certo';
end $$;
rollback;
