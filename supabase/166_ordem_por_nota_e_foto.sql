-- 166: a ordem das listas públicas do guia (3.17): nota e foto.
--
-- Até aqui as listas (cidade, categoria, bairro, horário e "mesma categoria" na
-- página do salão) vinham em ordem alfabética, depois de quem está na MIMO e da
-- Seleção MIMO. Com as fotos chegando aos poucos, as primeiras telas ficavam
-- cheias de salão sem foto. Agora, depois de MIMO e Seleção, a ordem é por
-- pontos (guia_pontos):
--   - a nota do Google puxada para 4,5 quando há poucas avaliações (como se
--     houvesse 8 avaliações de 4,5 a mais): 5,0 com 3 avaliações dá 4,64; 4,9
--     com 200 dá 4,88; sem nota, 4,5;
--   - a foto: ter foto vale 0,4; cada foto a mais vale 0,05, até 3 a mais
--     (4 fotos ou mais: 0,55). Conta as fotos que a página mostra (guia_fotos:
--     as do guia ou, para quem está na MIMO, as da página dele).
-- Desempate: mais avaliações, depois o nome. A nota continua sem ir para a
-- página: ela só ordena, dentro do banco. A mesma conta vive em
-- packages/core/guia.js (pontosDoLugar) para a Plataforma e o demo; mexeu numa,
-- mexa na outra.
--
-- Mexe em: guia_pontos (nova), guia_cidade (153), guia_pagina (157, a lista
-- "mesma categoria"), guia_colecoes (164) e guia_publicadas (153: a lista já vem
-- na ordem do site, cidade por cidade, e o gerador do HTML estático só a respeita).
-- Nada de dado muda e atualizado_em não anda: para o HTML estático refletir a
-- ordem nova, publique o site (bat 2) ou rode republicar-se-mudou.sh --forcar.

create or replace function public.guia_pontos(l public.guia_lugares)
returns numeric language sql stable set search_path = public as $$
  select round(
    case when l.nota is null then 4.5
         else (l.nota * greatest(coalesce(l.avaliacoes, 0), 0) + 4.5 * 8) / (greatest(coalesce(l.avaliacoes, 0), 0) + 8) end
    + case when coalesce(array_length(public.guia_fotos(l), 1), 0) = 0 then 0
           else 0.4 + 0.05 * least(array_length(public.guia_fotos(l), 1) - 1, 3) end, 3)
$$;
comment on function public.guia_pontos(public.guia_lugares) is 'Guia (166): os pontos que ordenam as listas públicas (nota ajustada + foto); a mesma conta de pontosDoLugar em packages/core/guia.js.';
revoke execute on function public.guia_pontos(public.guia_lugares) from public, anon;

-- ---- a página da cidade e da categoria (a mesma da 153, só a ordem muda) ------------------------
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
    'categorias', coalesce((select jsonb_agg(jsonb_build_object('categoria', x.categoria, 'total', x.n) order by x.n desc)
        from (select l.categoria, count(*) n from public.guia_lugares l where l.cidade_slug = c and l.status = 'publicado' and l.conteudo is not null group by l.categoria) x), '[]'::jsonb),
    'bairros', coalesce((select jsonb_agg(jsonb_build_object('bairro', x.bairro, 'total', x.n) order by x.n desc, x.bairro)
        from (select l.bairro, count(*) n from public.guia_lugares l
               where l.cidade_slug = c and l.status = 'publicado' and l.conteudo is not null and coalesce(l.bairro, '') <> '' and (cat = '' or l.categoria = cat)
               group by l.bairro) x), '[]'::jsonb),
    'lugares', coalesce((select jsonb_agg(public.guia_cartao(l) order by l.salon_id is null, not l.selecao, public.guia_pontos(l) desc, l.avaliacoes desc nulls last, l.nome)
        from public.guia_lugares l
        where l.cidade_slug = c and l.status = 'publicado' and l.conteudo is not null and (cat = '' or l.categoria = cat)), '[]'::jsonb));
end $$;
grant execute on function public.guia_cidade(text, text) to anon, authenticated;

-- ---- a página do salão: "mesma categoria" (a mesma da 157, só a ordem muda) --------------------
create or replace function public.guia_pagina(cidade_ text, slug_ text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  l public.guia_lugares;
  bk text;
begin
  select * into l from public.guia_lugares
   where cidade_slug = lower(btrim(cidade_)) and slug = lower(btrim(slug_)) and status = 'publicado' and conteudo is not null;
  if not found then return null; end if;
  bk := public.guia_bairro_slug(l.bairro);
  return jsonb_build_object(
    'lugar', public.guia_publico(l) || jsonb_build_object(
      'bairro_slug', nullif(bk, ''),
      'bairro_total', case when bk = '' or bk = l.cidade_slug then 0 else
        (select count(*) from public.guia_lugares o
          where o.cidade_slug = l.cidade_slug and o.status = 'publicado' and o.conteudo is not null
            and public.guia_bairro_slug(o.bairro) = bk) end,
      'cidade_total', (select count(*) from public.guia_lugares o
          where o.cidade_slug = l.cidade_slug and o.status = 'publicado' and o.conteudo is not null)),
    'vizinhos', public.guia_vizinhos(l, 6),
    'mesma_categoria', coalesce((select jsonb_agg(public.guia_cartao(o) order by o.salon_id is null, not o.selecao, public.guia_pontos(o) desc, o.avaliacoes desc nulls last, o.nome)
        from public.guia_lugares o
        where o.id in (select o2.id from public.guia_lugares o2
                        where o2.cidade_slug = l.cidade_slug and o2.categoria = l.categoria and o2.id <> l.id
                          and o2.status = 'publicado' and o2.conteudo is not null
                        order by o2.salon_id is null, not o2.selecao, public.guia_pontos(o2) desc, o2.avaliacoes desc nulls last, o2.nome limit 8)), '[]'::jsonb));
end $$;
grant execute on function public.guia_pagina(text, text) to anon, authenticated;

-- ---- as coleções por bairro e por horário (a mesma da 164, só a ordem muda) --------------------
create or replace function public.guia_colecoes(cidade_ text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  c text := lower(btrim(coalesce(cidade_, '')));
  base record;
begin
  select l.cidade, l.uf into base from public.guia_lugares l
   where l.cidade_slug = c and l.status = 'publicado' and l.conteudo is not null
   group by l.cidade, l.uf order by count(*) desc limit 1;
  if not found then return null; end if;
  return jsonb_build_object(
    'cidade', base.cidade, 'cidade_slug', c, 'uf', base.uf,
    'lugares', coalesce((select jsonb_agg(jsonb_build_object(
        'slug', l.slug, 'nome', l.nome, 'cidade', l.cidade, 'cidade_slug', l.cidade_slug, 'uf', l.uf,
        'bairro', l.bairro, 'endereco', l.endereco, 'categoria', l.categoria,
        'horarios', l.horarios, 'servicos', to_jsonb(coalesce(l.servicos, '{}')), 'atributos', coalesce(l.atributos, '{}'::jsonb),
        'resumo', l.conteudo ->> 'resumo', 'selecao', l.selecao, 'na_mimo', l.salon_id is not null, 'atualizado_em', l.atualizado_em,
        'latitude', round(l.latitude::numeric, 5), 'longitude', round(l.longitude::numeric, 5),
        'foto', (public.guia_fotos(l))[1])
      order by l.salon_id is null, not l.selecao, public.guia_pontos(l) desc, l.avaliacoes desc nulls last, l.nome)
      from public.guia_lugares l
      where l.cidade_slug = c and l.status = 'publicado' and l.conteudo is not null), '[]'::jsonb));
end $$;
revoke execute on function public.guia_colecoes(text) from public;
grant execute on function public.guia_colecoes(text) to anon, authenticated;

-- ---- tudo o que está no ar, para o build (a mesma da 153; a lista vem na ordem do site) ---------
create or replace function public.guia_publicadas()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'lugares', coalesce((select jsonb_agg(public.guia_publico(l) || jsonb_build_object('vizinhos', public.guia_vizinhos(l, 6)) order by l.cidade_slug, l.salon_id is null, not l.selecao, public.guia_pontos(l) desc, l.avaliacoes desc nulls last, l.nome)
        from public.guia_lugares l where l.status = 'publicado' and l.conteudo is not null), '[]'::jsonb),
    'paginas', coalesce((select jsonb_agg(jsonb_build_object('cidade_slug', p.cidade_slug, 'categoria', p.categoria, 'conteudo', p.conteudo, 'atualizado_em', p.atualizado_em))
        from public.guia_paginas p where p.status = 'publicado' and p.conteudo is not null), '[]'::jsonb),
    'cidades', public.guia_cidades())
$$;
grant execute on function public.guia_publicadas() to anon, authenticated;

do $$
declare n int; f int;
begin
  select count(*), count(*) filter (where coalesce(array_length(public.guia_fotos(l), 1), 0) > 0) into n, f
    from public.guia_lugares l where l.status = 'publicado' and l.conteudo is not null;
  raise notice '166: listas do guia em ordem de nota e foto; % salões no ar, % com foto', n, f;
end $$;
