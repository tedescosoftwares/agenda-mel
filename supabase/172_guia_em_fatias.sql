-- 172 (3.23.1): a cidade grande em fatias. Praia Grande entrou no ar com 2.271 salões e a
-- guia_publicadas(cidade_, desde_) da 171, que entregava a cidade inteira numa resposta (11 MB),
-- passou dos ~4 s que o Supabase dá a uma consulta pública: 57014, statement timeout. Agora a
-- função devolve no máximo "limite_" salões por chamada (padrão 200, teto 500), em ordem de slug,
-- a partir de "depois_" (o último slug da fatia anterior); a lista de slugs na ordem do site e as
-- páginas da cidade só vêm na primeira fatia, e a lista de cidades saiu daqui (o gerador já
-- chama guia_cidades() uma vez). Um índice parcial para o que está no ar acelera as contagens
-- (guia_cidades levava 3,9 s a frio).

-- o índice de quem está no ar: as funções públicas filtram sempre por isto
create index if not exists guia_lugares_no_ar on public.guia_lugares (cidade_slug, categoria, slug)
  where status = 'publicado' and conteudo is not null;

drop function if exists public.guia_publicadas(text, timestamptz);
create or replace function public.guia_publicadas(cidade_ text default '', desde_ timestamptz default null, depois_ text default '', limite_ int default 200)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  c text := lower(btrim(coalesce(cidade_, '')));
  dep text := coalesce(depois_, '');
  lim int := least(greatest(coalesce(limite_, 200), 1), 500);
  base record;
  primeira boolean := dep = '';
begin
  if c = '' then
    -- compatibilidade com o gerador antigo: o guia inteiro, sem vizinhos (numa base grande isto estoura o tempo)
    return jsonb_build_object(
      'agora', now(),
      'lugares', coalesce((select jsonb_agg(public.guia_publico(l) order by l.cidade_slug, l.salon_id is null, not l.selecao, public.guia_pontos(l) desc, l.avaliacoes desc nulls last, l.nome)
          from public.guia_lugares l where l.status = 'publicado' and l.conteudo is not null), '[]'::jsonb),
      'paginas', coalesce((select jsonb_agg(jsonb_build_object('cidade_slug', p.cidade_slug, 'categoria', p.categoria, 'conteudo', p.conteudo, 'atualizado_em', p.atualizado_em))
          from public.guia_paginas p where p.status = 'publicado' and p.conteudo is not null), '[]'::jsonb),
      'cidades', public.guia_cidades());
  end if;
  select l.cidade, l.uf into base from public.guia_lugares l
   where l.cidade_slug = c and l.status = 'publicado' and l.conteudo is not null
   group by l.cidade, l.uf order by count(*) desc limit 1;
  if not found then
    return jsonb_build_object('cidade_slug', c, 'agora', now(), 'slugs', '[]'::jsonb, 'lugares', '[]'::jsonb, 'paginas', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'cidade', base.cidade, 'cidade_slug', c, 'uf', base.uf, 'agora', now(), 'limite', lim,
    -- só na primeira fatia: todos os slugs da cidade na ordem do site (166) e as páginas da cidade
    'slugs', case when primeira then coalesce((select jsonb_agg(jsonb_build_object('slug', x.slug, 'atualizado_em', x.atualizado_em) order by x.ordem)
        from (select l.slug, l.atualizado_em,
                     row_number() over (order by l.salon_id is null, not l.selecao, public.guia_pontos(l) desc, l.avaliacoes desc nulls last, l.nome) as ordem
                from public.guia_lugares l where l.cidade_slug = c and l.status = 'publicado' and l.conteudo is not null) x), '[]'::jsonb) else null end,
    'paginas', case when primeira then coalesce((select jsonb_agg(jsonb_build_object('cidade_slug', p.cidade_slug, 'categoria', p.categoria, 'conteudo', p.conteudo, 'atualizado_em', p.atualizado_em))
        from public.guia_paginas p where p.cidade_slug = c and p.status = 'publicado' and p.conteudo is not null), '[]'::jsonb) else null end,
    -- a fatia: só o que mudou desde "desde_", em ordem de slug, a partir de "depois_"
    'lugares', coalesce((select jsonb_agg(x.p order by x.slug) from (
        select l.slug, public.guia_publico(l) as p from public.guia_lugares l
         where l.cidade_slug = c and l.status = 'publicado' and l.conteudo is not null
           and (desde_ is null or l.atualizado_em > desde_) and l.slug > dep
         order by l.slug limit lim) x), '[]'::jsonb));
end $$;
comment on function public.guia_publicadas(text, timestamptz, text, int) is 'Guia (172): uma cidade para o gerador do HTML estático, em fatias de até limite_ salões (ordem de slug, a partir de depois_), só os mudados desde desde_. A lista de slugs na ordem do site e as páginas vêm na primeira fatia. Sem cidade, o guia inteiro (compatibilidade).';
grant execute on function public.guia_publicadas(text, timestamptz, text, int) to anon, authenticated;

do $$
begin
  raise notice '172: guia_publicadas em fatias (limite_ e depois_), sem a lista de cidades em cada chamada; índice parcial de quem está no ar';
end $$;
