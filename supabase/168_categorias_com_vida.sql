-- 168: as categorias com vida (3.19).
--
-- Os blocos de categoria no topo da cidade eram só um nome e um número. Agora
-- cada categoria vem com a capa do melhor salão da categoria que tem foto (a
-- mesma ordem das listas, 166) e com os três primeiros nomes ("Studio Lírio,
-- Unhas da Ana e mais 3"), e o índice /saloes sabe quais categorias cada
-- cidade tem, para linkar cidade por cidade.
--   guia_cidade(cidade, categoria): 'categorias' ganha foto e nomes;
--   guia_cidades(): cada cidade ganha 'categorias' [{ categoria, total }]
--   (guia_publicadas() já carrega guia_cidades(), então o build recebe junto).
-- A mesma conta em JS: categoriasDaLista em packages/core/guia.js (estático e demo).

-- ---- a página da cidade e da categoria (a mesma da 166, só 'categorias' muda) -------------------
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
    'total', (select count(*) from public.guia_lugares l where l.cidade_slug = c and l.status = 'publicado' and l.conteudo is not null),
    'categorias', coalesce((select jsonb_agg(jsonb_build_object('categoria', x.categoria, 'total', x.n, 'foto', x.foto, 'nomes', to_jsonb(x.nomes)) order by x.n desc, x.categoria)
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
grant execute on function public.guia_cidade(text, text) to anon, authenticated;

-- ---- as cidades do guia, com as categorias de cada uma ----------------------------------------
create or replace function public.guia_cidades()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('cidade', x.cidade, 'cidade_slug', x.cidade_slug, 'uf', x.uf, 'total', x.n,
      'categorias', coalesce((select jsonb_agg(jsonb_build_object('categoria', y.categoria, 'total', y.n) order by y.n desc, y.categoria)
          from (select l.categoria, count(*) n from public.guia_lugares l
                 where l.cidade_slug = x.cidade_slug and l.status = 'publicado' and l.conteudo is not null group by l.categoria) y), '[]'::jsonb))
    order by x.n desc), '[]'::jsonb)
  from (select max(cidade) cidade, cidade_slug, max(uf) uf, count(*) n from public.guia_lugares
         where status = 'publicado' and conteudo is not null group by cidade_slug) x
$$;
grant execute on function public.guia_cidades() to anon, authenticated;

do $$
begin
  raise notice '168: categorias com foto, nomes e por cidade (guia_cidade, guia_cidades)';
end $$;
