-- 177 (3.32): a foto da cidade.
--
-- A página da cidade ganha uma foto (guia_paginas.foto, a URL no bucket 'guia'), enviada pela Plataforma
-- em Páginas da cidade. As páginas de categoria da mesma cidade herdam. guia_cidade() passa a devolver
-- 'foto' (independe de haver texto aprovado) e guia_publicadas() leva a foto nas páginas, para o gerador:
-- a linha da cidade entra nas páginas também quando só tem a foto.
alter table public.guia_paginas add column if not exists foto text;
comment on column public.guia_paginas.foto is 'Guia (177): a foto da cidade (URL pública no bucket guia). Só a linha da cidade (categoria vazia) usa; as categorias herdam.';

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
    'slugs', case when primeira then coalesce((select jsonb_agg(jsonb_build_object('slug', x.slug, 'atualizado_em', x.atualizado_em) order by x.ordem)
        from (select l.slug, l.atualizado_em,
                     row_number() over (order by l.salon_id is null, not l.selecao, public.guia_pontos(l) desc, l.avaliacoes desc nulls last, l.nome) as ordem
                from public.guia_lugares l where l.cidade_slug = c and l.status = 'publicado' and l.conteudo is not null) x), '[]'::jsonb) else null end,
    'paginas', case when primeira then coalesce((select jsonb_agg(jsonb_build_object('cidade_slug', p.cidade_slug, 'categoria', p.categoria,
            'conteudo', case when p.status = 'publicado' then p.conteudo end, 'foto', p.foto, 'atualizado_em', p.atualizado_em))
        from public.guia_paginas p where p.cidade_slug = c and ((p.status = 'publicado' and p.conteudo is not null) or coalesce(p.foto, '') <> '')), '[]'::jsonb) else null end,
    'lugares', coalesce((select jsonb_agg(x.p order by x.slug) from (
        select l.slug, public.guia_publico(l) as p from public.guia_lugares l
         where l.cidade_slug = c and l.status = 'publicado' and l.conteudo is not null
           and (desde_ is null or l.atualizado_em > desde_) and l.slug > dep
         order by l.slug limit lim) x), '[]'::jsonb));
end $$;
comment on function public.guia_publicadas(text, timestamptz, text, int, text) is 'Guia (177): a cidade em fatias para o gerador, só com a chave do gerador (guia_segredos); as páginas levam a foto da cidade. Ver 172, 173.';
grant execute on function public.guia_publicadas(text, timestamptz, text, int, text) to anon, authenticated;

do $$
begin
  raise notice '177: guia_paginas.foto; guia_cidade() e guia_publicadas() devolvem a foto da cidade';
end $$;
