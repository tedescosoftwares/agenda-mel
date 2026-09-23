-- Ensaio da 116: semente no lugar, gatilhos contando, sitemap só com o publicado. Desfaz no fim.
begin;
do $$
declare n integer; p record; t integer;
begin
  select count(*) into n from public.blog_categories; if n < 7 then raise exception '1: categorias: %', n; end if;
  select count(*) into n from public.seo_pages where page_type = 'SEO_LANDING'; if n <> 8 then raise exception '1: paginas SEO: %', n; end if;
  select count(*) into n from public.blog_posts where status = 'published'; if n <> 6 then raise exception '1: artigos: %', n; end if;
  raise notice '1 semente: 7 categorias, 8 paginas SEO, 6 artigos';

  select * into p from public.blog_posts where slug = 'como-organizar-agenda-salao-de-beleza';
  if p.reading_time_minutes < 3 then raise exception '2: tempo de leitura %', p.reading_time_minutes; end if;
  if p.category_id is null then raise exception '2: sem categoria'; end if;
  raise notice '2 artigo 1: % min, categoria ok', p.reading_time_minutes;

  insert into public.blog_posts (title, slug, content, status) values ('Ensaio', 'Ensaio Slug Feio!', 'uma frase só', 'published');
  select * into p from public.blog_posts where title = 'Ensaio';
  if p.slug <> 'ensaio-slug-feio-' then raise exception '3: slug %', p.slug; end if;
  if p.published_at is null then raise exception '3: publicado sem data'; end if;
  if p.reading_time_minutes <> 1 then raise exception '3: minutos %', p.reading_time_minutes; end if;
  raise notice '3 gatilho: slug limpo, data de publicacao, 1 minuto';

  select count(*) into t from public.seo_sitemap();
  update public.blog_posts set status = 'draft' where title = 'Ensaio';
  select count(*) into n from public.seo_sitemap();
  if n <> t - 1 then raise exception '4: sitemap % -> %', t, n; end if;
  update public.seo_pages set robots_index = false where route = '/contato';
  select count(*) into t from public.seo_sitemap();
  if t <> n - 1 then raise exception '4b: noindex nao saiu do sitemap'; end if;
  raise notice '4 sitemap: rascunho e noindex ficam de fora (% caminhos)', t;

  insert into public.redirects (from_path, to_path) values ('/antiga', '/blog');
  select count(*) into n from public.redirects where active; if n < 1 then raise exception '5: redirect'; end if;
  raise notice '5 redirect gravado';
  raise notice 'FIM DO ENSAIO — tudo certo';
end $$;
rollback;
