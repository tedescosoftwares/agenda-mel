-- 179 (3.32.3): a foto da cidade no índice do guia.
--
-- guia_cidades() (168) passa a devolver 'foto' (a da linha da cidade em guia_paginas, migração 177):
-- os cartões de "Salões de beleza por cidade" (/saloes) e o cidades.json do gerador levam a foto.
create or replace function public.guia_cidades()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('cidade', x.cidade, 'cidade_slug', x.cidade_slug, 'uf', x.uf, 'total', x.n,
      'foto', (select p.foto from public.guia_paginas p where p.cidade_slug = x.cidade_slug and p.categoria = '' and coalesce(p.foto, '') <> '' limit 1),
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
  raise notice '179: guia_cidades() devolve a foto da cidade';
end $$;
