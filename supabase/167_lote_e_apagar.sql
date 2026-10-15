-- 167: ações em lote na fila do guia (3.18): tirar do ar, descartar e apagar de vez.
--
-- A Plataforma filtra a fila de Revisar (fase, cidade, categoria, triagem,
-- busca) e aplica uma ação a tudo o que está na lista, numa chamada só:
--   tirar_do_ar  publicado -> gerado. A página sai do site; texto, fotos,
--                histórico e métricas ficam. Aprovar de novo devolve ao ar.
--   descartar    -> descartado, com o motivo. Sai da fila e não vai para o ar;
--                a importação segue atualizando os dados; "Trazer de volta"
--                em Descartados.
--   apagar       apaga de vez: o salão (e, em cascata, as reivindicações e o
--                histórico de abordagem), as métricas (site_eventos) e as buscas
--                do Google (site_buscas) só daquelas páginas. Com apagar_paginas_,
--                as páginas de cidade e categoria (guia_paginas) das cidades que
--                ficarem sem nenhum salão também vão, com as métricas delas.
--                Nada fora desses salões é tocado: cada município continua com
--                os seus próprios números. As fotos no bucket a Plataforma tira
--                antes, pela API do storage. A importação pode trazer o salão
--                de novo, como salão novo (outro id; o mesmo endereço se o nome
--                e a cidade forem os mesmos).
-- Só a Plataforma chama (eh_plataforma()). Devolve quantos de cada coisa.

create or replace function public.guia_lote(ids_ uuid[], acao_ text, motivo_ text default null, apagar_paginas_ boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  n int := 0; eventos int := 0; buscas int := 0; interesses int := 0; paginas int := 0; k int;
  caminhos text[]; cidades text[]; c text;
begin
  if not public.eh_plataforma() then raise exception 'só a plataforma mexe no guia em lote'; end if;
  if coalesce(array_length(ids_, 1), 0) = 0 then return jsonb_build_object('ok', true, 'acao', acao_, 'n', 0); end if;

  if acao_ = 'tirar_do_ar' then
    update public.guia_lugares set status = 'gerado' where id = any (ids_) and status = 'publicado';
    get diagnostics n = row_count;

  elsif acao_ = 'descartar' then
    update public.guia_lugares set status = 'descartado', motivo = coalesce(nullif(btrim(motivo_), ''), motivo)
     where id = any (ids_) and status not in ('descartado', 'removido');
    get diagnostics n = row_count;

  elsif acao_ = 'apagar' then
    select array_agg('/saloes/' || l.cidade_slug || '/' || l.slug), array_agg(distinct l.cidade_slug)
      into caminhos, cidades
      from public.guia_lugares l where l.id = any (ids_);
    select count(*) into interesses from public.guia_interesses where lugar_id = any (ids_);
    -- as métricas e as buscas dessas páginas (o evento antigo sem lugar_id sai pelo caminho)
    delete from public.site_eventos where lugar_id = any (ids_) or pagina = any (coalesce(caminhos, '{}'::text[]));
    get diagnostics eventos = row_count;
    delete from public.site_buscas where pagina = any (coalesce(caminhos, '{}'::text[]));
    get diagnostics buscas = row_count;
    -- o salão; reivindicações e histórico de abordagem vão em cascata
    delete from public.guia_lugares where id = any (ids_);
    get diagnostics n = row_count;
    -- a cidade que ficou sem salão: as páginas dela (texto da cidade e das categorias) e as métricas delas
    if apagar_paginas_ then
      foreach c in array coalesce(cidades, '{}'::text[]) loop
        if exists (select 1 from public.guia_lugares where cidade_slug = c) then continue; end if;
        delete from public.guia_paginas where cidade_slug = c;
        get diagnostics k = row_count; paginas := paginas + k;
        delete from public.site_eventos where cidade_slug = c or pagina = '/saloes/' || c or pagina like '/saloes/' || c || '/%';
        get diagnostics k = row_count; eventos := eventos + k;
        delete from public.site_buscas where pagina = '/saloes/' || c or pagina like '/saloes/' || c || '/%';
        get diagnostics k = row_count; buscas := buscas + k;
      end loop;
    end if;

  else
    raise exception 'ação desconhecida: %', acao_;
  end if;

  return jsonb_build_object('ok', true, 'acao', acao_, 'n', n, 'eventos', eventos, 'buscas', buscas, 'interesses', interesses, 'paginas', paginas);
end $$;
comment on function public.guia_lote(uuid[], text, text, boolean) is 'Guia (167): ação em lote da Plataforma sobre uma lista de salões: tirar_do_ar, descartar (com motivo) ou apagar (com as métricas só dessas páginas; apagar_paginas_ leva as páginas das cidades que ficarem vazias).';
revoke execute on function public.guia_lote(uuid[], text, text, boolean) from public, anon;
grant execute on function public.guia_lote(uuid[], text, text, boolean) to authenticated;

do $$
begin
  raise notice '167: guia_lote pronta (tirar do ar, descartar e apagar em lote)';
end $$;
