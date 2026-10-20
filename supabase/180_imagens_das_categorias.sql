-- 180 (3.33): a imagem de cada categoria, e a foto da cidade esticada.
--
-- Uma imagem por categoria (salões, cabelo, unhas, cílios, sobrancelhas, estética, maquiagem), que vale para
-- todas as cidades: guia_categorias(categoria, foto). A Plataforma envia em Páginas da cidade (na página da
-- categoria). No site, a página de categoria leva a imagem da categoria esticada atrás do título e a foto da
-- cidade no cartão; os quadradinhos das categorias usam a imagem quando nenhum salão da categoria tem foto.
-- guia_cidade() devolve 'imagem' (da categoria pedida) e 'imagem' em cada categoria; guia_publicadas() leva
-- 'categorias_imagens' para o gerador; o carimbo de republicação (site_conteudo_versao) sabe da tabela.
create table if not exists public.guia_categorias (
  categoria text primary key,
  foto text,
  atualizado_em timestamptz not null default now()
);
comment on table public.guia_categorias is 'Guia (180): a imagem de cada categoria (URL pública no bucket guia), igual para todas as cidades.';
drop trigger if exists guia_categorias_tocar on public.guia_categorias;
create trigger guia_categorias_tocar before update on public.guia_categorias for each row execute function public.guia_tocar();
alter table public.guia_categorias enable row level security;
drop policy if exists guia_categorias_plataforma on public.guia_categorias;
create policy guia_categorias_plataforma on public.guia_categorias for all to authenticated
  using (public.eh_plataforma()) with check (public.eh_plataforma());
grant select, insert, update, delete on public.guia_categorias to authenticated;

create or replace function public.guia_cidade(cidade_ text, categoria_ text default '')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  c text := lower(btrim(cidade_));
  cat text := lower(btrim(coalesce(categoria_, '')));
  base record;
begin
  select l.cidade, l.uf, count(*) total into base from public.guia_lugares l
   where l.cidade_slug = c and l.status = 'publicado' and l.conteudo is not null
   group by l.cidade, l.uf order by count(*) desc limit 1;
  if not found then return null; end if;
  if cat <> '' and not exists (select 1 from public.guia_lugares l where l.cidade_slug = c and l.categoria = cat and l.status = 'publicado' and l.conteudo is not null) then
    return null;
  end if;
  return jsonb_build_object(
    'cidade', base.cidade, 'cidade_slug', c, 'uf', base.uf, 'categoria', cat,
    'pagina', (select p.conteudo from public.guia_paginas p where p.cidade_slug = c and p.categoria = cat and p.status = 'publicado'),
    'foto', (select p.foto from public.guia_paginas p where p.cidade_slug = c and p.categoria = '' and coalesce(p.foto, '') <> ''),
    'imagem', (select g.foto from public.guia_categorias g where cat <> '' and g.categoria = cat and coalesce(g.foto, '') <> ''),
    'total', (select count(*) from public.guia_lugares l where l.cidade_slug = c and l.status = 'publicado' and l.conteudo is not null),
    'categorias', coalesce((select jsonb_agg(jsonb_build_object('categoria', x.categoria, 'total', x.n, 'foto', x.foto, 'nomes', to_jsonb(x.nomes),
            'imagem', (select g.foto from public.guia_categorias g where g.categoria = x.categoria and coalesce(g.foto, '') <> '')) order by x.n desc, x.categoria)
        from (select l.categoria, count(*) n,
                     (array_agg((public.guia_fotos(l))[1] order by l.salon_id is null, not l.selecao, public.guia_pontos(l) desc, l.avaliacoes desc nulls last, l.nome)
                        filter (where (public.guia_fotos(l))[1] is not null))[1] as foto,
                     (array_agg(l.nome order by l.salon_id is null, not l.selecao, public.guia_pontos(l) desc, l.avaliacoes desc nulls last, l.nome))[1:3] as nomes
                from public.guia_lugares l where l.cidade_slug = c and l.status = 'publicado' and l.conteudo is not null group by l.categoria) x), '[]'::jsonb),
    'bairros', coalesce((select jsonb_agg(jsonb_build_object('bairro', x.bairro, 'total', x.n) order by x.n desc, x.bairro)
        from (select l.bairro, count(*) n from public.guia_lugares l
               where l.cidade_slug = c and l.status = 'publicado' and l.conteudo is not null and coalesce(l.bairro, '') <> '' and (cat = '' or l.categoria = cat)
               group by l.bairro) x), '[]'::jsonb),
    'lugares', coalesce((select jsonb_agg(public.guia_cartao(l) order by l.salon_id is null, not l.selecao, public.guia_pontos(l) desc, l.avaliacoes desc nulls last, l.nome)
        from public.guia_lugares l
        where l.cidade_slug = c and l.status = 'publicado' and l.conteudo is not null and (cat = '' or l.categoria = cat)), '[]'::jsonb));
end $$;
revoke execute on function public.guia_cidade(text, text) from public, anon;
grant execute on function public.guia_cidade(text, text) to authenticated;

create or replace function public.guia_publicadas(cidade_ text default '', desde_ timestamptz default null, depois_ text default '', limite_ int default 200, chave_ text default '')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  c text := lower(btrim(coalesce(cidade_, '')));
  dep text := coalesce(depois_, '');
  lim int := least(greatest(coalesce(limite_, 200), 1), 500);
  base record;
  primeira boolean := dep = '';
begin
  if coalesce(chave_, '') = '' or chave_ is distinct from (select s.valor from public.guia_segredos s where s.nome = 'gerador') then
    raise exception 'chave do gerador inválida: leia em guia_segredos (nome = gerador) e ponha em GUIA_CHAVE_GERADOR no .env da Evolution' using errcode = '28000';
  end if;
  if c = '' then
    return jsonb_build_object(
      'agora', now(),
      'lugares', coalesce((select jsonb_agg(public.guia_publico(l) order by l.cidade_slug, l.salon_id is null, not l.selecao, public.guia_pontos(l) desc, l.avaliacoes desc nulls last, l.nome)
          from public.guia_lugares l where l.status = 'publicado' and l.conteudo is not null), '[]'::jsonb),
      'paginas', coalesce((select jsonb_agg(jsonb_build_object('cidade_slug', p.cidade_slug, 'categoria', p.categoria,
            'conteudo', case when p.status = 'publicado' then p.conteudo end, 'foto', p.foto, 'atualizado_em', p.atualizado_em))
          from public.guia_paginas p where (p.status = 'publicado' and p.conteudo is not null) or coalesce(p.foto, '') <> ''), '[]'::jsonb),
      'cidades', public.guia_cidades(),
      'categorias_imagens', coalesce((select jsonb_object_agg(g.categoria, g.foto) from public.guia_categorias g where coalesce(g.foto, '') <> ''), '{}'::jsonb));
  end if;
  select l.cidade, l.uf into base from public.guia_lugares l
   where l.cidade_slug = c and l.status = 'publicado' and l.conteudo is not null
   group by l.cidade, l.uf order by count(*) desc limit 1;
  if not found then
    return jsonb_build_object('cidade_slug', c, 'agora', now(), 'slugs', '[]'::jsonb, 'lugares', '[]'::jsonb, 'paginas', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'cidade', base.cidade, 'cidade_slug', c, 'uf', base.uf, 'agora', now(), 'limite', lim,
    'slugs', case when primeira then coalesce((select jsonb_agg(jsonb_build_object('slug', x.slug, 'atualizado_em', x.atualizado_em) order by x.ordem)
        from (select l.slug, l.atualizado_em,
                     row_number() over (order by l.salon_id is null, not l.selecao, public.guia_pontos(l) desc, l.avaliacoes desc nulls last, l.nome) as ordem
                from public.guia_lugares l where l.cidade_slug = c and l.status = 'publicado' and l.conteudo is not null) x), '[]'::jsonb) else null end,
    'paginas', case when primeira then coalesce((select jsonb_agg(jsonb_build_object('cidade_slug', p.cidade_slug, 'categoria', p.categoria,
            'conteudo', case when p.status = 'publicado' then p.conteudo end, 'foto', p.foto, 'atualizado_em', p.atualizado_em))
        from public.guia_paginas p where p.cidade_slug = c and ((p.status = 'publicado' and p.conteudo is not null) or coalesce(p.foto, '') <> '')), '[]'::jsonb) else null end,
    'categorias_imagens', case when primeira then coalesce((select jsonb_object_agg(g.categoria, g.foto) from public.guia_categorias g where coalesce(g.foto, '') <> ''), '{}'::jsonb) else null end,
    'lugares', coalesce((select jsonb_agg(x.p order by x.slug) from (
        select l.slug, public.guia_publico(l) as p from public.guia_lugares l
         where l.cidade_slug = c and l.status = 'publicado' and l.conteudo is not null
           and (desde_ is null or l.atualizado_em > desde_) and l.slug > dep
         order by l.slug limit lim) x), '[]'::jsonb));
end $$;
comment on function public.guia_publicadas(text, timestamptz, text, int, text) is 'Guia (180): a cidade em fatias para o gerador, só com a chave do gerador (guia_segredos); as páginas levam a foto da cidade e categorias_imagens traz a imagem de cada categoria. Ver 172, 173, 177.';
grant execute on function public.guia_publicadas(text, timestamptz, text, int, text) to anon, authenticated;

-- o carimbo de republicação (164, 178): a imagem de uma categoria também regenera o site
create or replace function public.site_conteudo_versao()
returns text language sql stable security definer set search_path = public as $$
  select md5(concat_ws('|',
    (select concat(count(*), '/', max(updated_at)) from public.blog_posts where status = 'published'),
    (select concat(count(*), '/', max(updated_at)) from public.seo_pages where status = 'published'),
    (select concat(count(*), '/', max(atualizado_em)) from public.guia_lugares where status = 'publicado' and conteudo is not null),
    (select concat(count(*), '/', max(atualizado_em)) from public.guia_paginas where (status = 'publicado' and conteudo is not null) or coalesce(foto, '') <> ''),
    (select concat(count(*), '/', max(atualizado_em)) from public.guia_categorias where coalesce(foto, '') <> '')))
$$;
comment on function public.site_conteudo_versao() is 'Site (180): carimbo do conteúdo publicado (artigos, páginas SEO, salões, páginas do guia com texto ou foto, imagens das categorias); o servidor regenera as páginas estáticas quando ele muda.';
revoke execute on function public.site_conteudo_versao() from public;
grant execute on function public.site_conteudo_versao() to anon, authenticated;

do $$
begin
  raise notice '180: guia_categorias (a imagem de cada categoria); guia_cidade, guia_publicadas e o carimbo do site sabem dela';
end $$;
