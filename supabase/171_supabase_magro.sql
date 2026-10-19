-- 171 (3.23): o Supabase magro. Três coisas que leem demais quando o guia passa de 20 mil salões.
--
-- 1. guia_publicadas() montava o guia inteiro numa consulta só (100 MB) e, para cada salão,
--    procurava os 6 vizinhos varrendo a cidade (quadrático: Praia Grande sozinha são 5 milhões
--    de comparações). Agora recebe a cidade e um "desde": devolve os slugs da cidade na ordem do
--    site, só os salões que mudaram desde então, as páginas da cidade e a lista de cidades. Os
--    vizinhos passam a ser calculados pelo gerador (scripts/guia-fonte.mjs), em memória. Sem
--    cidade, devolve o guia inteiro sem vizinhos (compatibilidade com o gerador antigo).
-- 2. A Plataforma lia todos os salões com texto e rascunho (3,5 KB cada). A view guia_lista
--    entrega a linha sem os dois jsonb, com "tem_conteudo", "tem_rascunho", o resumo e as
--    _meta; o texto é lido quando se abre o salão. A view corre com os direitos de quem chama
--    (security_invoker), então a RLS de guia_lugares continua valendo.

-- ---- 1. o guia por cidade, só o que mudou -------------------------------------------------------
drop function if exists public.guia_publicadas();
create or replace function public.guia_publicadas(cidade_ text default '', desde_ timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  c text := lower(btrim(coalesce(cidade_, '')));
  base record;
begin
  if c = '' then
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
    return jsonb_build_object('cidade_slug', c, 'agora', now(), 'slugs', '[]'::jsonb, 'lugares', '[]'::jsonb, 'paginas', '[]'::jsonb, 'cidades', public.guia_cidades());
  end if;
  return jsonb_build_object(
    'cidade', base.cidade, 'cidade_slug', c, 'uf', base.uf, 'agora', now(),
    -- todos os slugs da cidade, na ordem do site (166): o gerador ordena por aqui e apaga quem saiu
    'slugs', coalesce((select jsonb_agg(jsonb_build_object('slug', x.slug, 'atualizado_em', x.atualizado_em) order by x.ordem)
        from (select l.slug, l.atualizado_em,
                     row_number() over (order by l.salon_id is null, not l.selecao, public.guia_pontos(l) desc, l.avaliacoes desc nulls last, l.nome) as ordem
                from public.guia_lugares l where l.cidade_slug = c and l.status = 'publicado' and l.conteudo is not null) x), '[]'::jsonb),
    -- só o que mudou desde o último aviso (atualizado_em só anda quando a página muda, 164)
    'lugares', coalesce((select jsonb_agg(public.guia_publico(l) order by l.nome)
        from public.guia_lugares l
        where l.cidade_slug = c and l.status = 'publicado' and l.conteudo is not null and (desde_ is null or l.atualizado_em > desde_)), '[]'::jsonb),
    'paginas', coalesce((select jsonb_agg(jsonb_build_object('cidade_slug', p.cidade_slug, 'categoria', p.categoria, 'conteudo', p.conteudo, 'atualizado_em', p.atualizado_em))
        from public.guia_paginas p where p.cidade_slug = c and p.status = 'publicado' and p.conteudo is not null), '[]'::jsonb),
    'cidades', public.guia_cidades());
end $$;
comment on function public.guia_publicadas(text, timestamptz) is 'Guia (171): o guia de uma cidade para o gerador do HTML estático: slugs na ordem do site, só os salões mudados desde "desde_", as páginas da cidade e as cidades. Sem cidade, o guia inteiro sem vizinhos.';
grant execute on function public.guia_publicadas(text, timestamptz) to anon, authenticated;

-- ---- 2. a lista magra da Plataforma --------------------------------------------------------------
create or replace view public.guia_lista with (security_invoker = true) as
  select l.id, l.cidade, l.cidade_slug, l.uf, l.slug, l.categoria, l.nome, l.bairro, l.endereco, l.cep, l.telefone, l.whatsapp, l.instagram, l.site,
         l.horarios, l.servicos, l.atributos, l.place_id, l.cnpj, l.validado_receita, l.selecao, l.nota, l.avaliacoes, l.fontes, l.origem, l.fotos,
         l.status, l.motivo, l.salon_id, l.gerado_em, l.publicado_em, l.criado_em, l.atualizado_em,
         (l.conteudo is not null) as tem_conteudo,
         (l.rascunho is not null) as tem_rascunho,
         coalesce(l.rascunho ->> 'resumo', l.conteudo ->> 'resumo') as resumo,
         l.conteudo -> '_meta' as meta,
         l.rascunho -> '_meta' as meta_rascunho
    from public.guia_lugares l;
comment on view public.guia_lista is 'Guia (171): guia_lugares sem conteudo e rascunho (3 KB a menos por linha), com tem_conteudo, tem_rascunho, resumo e as _meta. A Plataforma lista por aqui e lê o texto ao abrir o salão. security_invoker: vale a RLS de guia_lugares.';
revoke all on public.guia_lista from public, anon;
grant select on public.guia_lista to authenticated;

do $$
begin
  raise notice '171: guia_publicadas por cidade e só o que mudou (sem vizinhos no banco); view guia_lista para a Plataforma';
end $$;
