-- 174 (3.25): a Plataforma por cidade.
--
-- A tela do guia lia todos os salões ao abrir (3.214 hoje, 20 mil no fim: uns 5 MB da view magra
-- a cada abertura, e tudo em memória no navegador). Agora ela abre só com os totais por cidade e
-- por fase (guia_resumo, alguns KB), escolhe uma cidade e lê a lista daquela cidade. "Todas as
-- cidades" continua existindo, como escolha explícita.
--
-- guia_resumo(): uma linha por cidade com os mesmos números do topo da tela (importados, sem
-- página, para revisar, versão nova, no ar, descartados, removidos) e quantos estão no ar em cada
-- categoria (as páginas de categoria em "Páginas da cidade"). Só a Plataforma (eh_plataforma()).
create or replace function public.guia_resumo()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.eh_plataforma() then raise exception 'só a plataforma lê o resumo do guia'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'cidade', x.cidade, 'cidade_slug', x.cidade_slug, 'uf', x.uf,
      'total', x.total, 'gerar', x.gerar, 'revisar', x.revisar, 'nova', x.nova, 'no_ar', x.no_ar,
      'descartados', x.descartados, 'removidos', x.removidos, 'categorias', x.categorias) order by x.cidade, x.cidade_slug)
    from (
      select max(l.cidade) cidade, l.cidade_slug, max(l.uf) uf,
             -- as fases, as mesmas da tela (faseDe em src/pages/plataforma/Guia.jsx)
             count(*) filter (where l.status <> 'removido') total,
             count(*) filter (where l.status not in ('publicado', 'descartado', 'removido') and l.conteudo is null and l.rascunho is null) gerar,
             count(*) filter (where l.status not in ('publicado', 'descartado', 'removido') and (l.conteudo is not null or l.rascunho is not null)) revisar,
             count(*) filter (where l.status = 'publicado' and l.rascunho is not null) nova,
             count(*) filter (where l.status = 'publicado') no_ar,
             count(*) filter (where l.status = 'descartado') descartados,
             count(*) filter (where l.status = 'removido') removidos,
             -- quantos no ar por categoria
             coalesce((select jsonb_object_agg(y.categoria, y.n)
                 from (select m.categoria, count(*) n from public.guia_lugares m
                        where m.cidade_slug = l.cidade_slug and m.status = 'publicado' group by m.categoria) y), '{}'::jsonb) categorias
        from public.guia_lugares l
       group by l.cidade_slug) x), '[]'::jsonb);
end $$;
comment on function public.guia_resumo() is 'Guia (174): os totais por cidade e por fase para o topo da Plataforma, que passa a ler a lista de uma cidade por vez. Só a Plataforma.';
revoke execute on function public.guia_resumo() from public, anon;
grant execute on function public.guia_resumo() to authenticated;

do $$
begin
  raise notice '174: guia_resumo() com os totais por cidade e por fase; a Plataforma lê uma cidade por vez';
end $$;
