-- 258 · Os números do topo do Guia sem ler a tabela inteira (4.4.2)
-- aplicar: sem-transacao
-- (a linha de cima diz ao aplicar.sh para rodar comando a comando: o índice fica gravado assim que termina)
--
-- Com 39 mil salões, abrir Plataforma › Guia (qualquer aba: Ao vivo, Revisar…) dava "canceling statement due to
-- statement timeout" e os números do topo ficavam em 0. É guia_resumo() (174), que traz os totais por cidade e por fase
-- e a lista de cidades do seletor: ela agrupava a tabela inteira de salões e, para saber quem está sem texto, abria
-- cada linha (uns 185 MB, que o plano gratuito não guarda em memória). Agora a mesma resposta sai de índices:
--   total, no ar, descartados, removidos e as categorias: guia_lugares_fila (cidade, status, categoria; 153)
--   "sem página" e "para revisar": um índice para cada (guia_lugares_sem_pagina, guia_lugares_para_revisar), que também
--     servem a página da lista dessas fases em "Todas as cidades"
--   versão nova: guia_lugares_nova_cidade
--   o nome e a UF de cada cidade: o índice novo guia_lugares_cidade_nome (cidade_slug, cidade, uf)
-- A resposta é a mesma (conferida contra a função antiga num banco local com 59 mil salões).

set statement_timeout = '15min';

create or replace function pg_temp.guia_ddl(comando text, tentativas int default 15)
returns void language plpgsql as $f$
declare i int := 0; antes text := current_setting('lock_timeout');
begin
  loop
    begin
      perform set_config('lock_timeout', '2s', true);
      execute comando;
      perform set_config('lock_timeout', antes, true);
      return;
    exception when lock_not_available then
      i := i + 1;
      if i >= tentativas then
        raise exception 'a tabela está presa por outra sessão (% tentativas de 2 s: %). No SQL Editor: select pid, state, now() - xact_start as ha, left(query, 70) from pg_stat_activity where state <> ''idle''; encerre a que segura a tabela com select pg_terminate_backend(<pid>); e rode de novo', tentativas, left(comando, 70);
      end if;
      raise notice 'tabela ocupada por outra sessão, tentando de novo em 2 s (% de %): %', i, tentativas, left(comando, 60);
      perform pg_sleep(2);
    end;
  end loop;
end $f$;

select pg_temp.guia_ddl('create index if not exists guia_lugares_cidade_nome on public.guia_lugares (cidade_slug, cidade, uf)');
-- a fila em dois pedaços, cada um com o seu índice: "sem página" (sem texto) e "para revisar" (com texto ou versão nova).
-- Contar e listar sai só do índice, mesmo com milhares esperando (uma cidade grande recém-importada). As colunas da ordem
-- padrão e dos filtros da aba vão junto, para a página da lista em "Todas as cidades" também não abrir os salões.
select pg_temp.guia_ddl('create index if not exists guia_lugares_sem_pagina on public.guia_lugares
  (selecao desc nulls last, avaliacoes desc nulls last, nome, id)
  include (cidade_slug, status, bairro, categoria, validado_receita, nota, gerado_em, atualizado_em)
  where status <> ''publicado'' and status <> ''descartado'' and status <> ''removido'' and conteudo is null and rascunho is null');
select pg_temp.guia_ddl('create index if not exists guia_lugares_para_revisar on public.guia_lugares
  (selecao desc nulls last, avaliacoes desc nulls last, nome, id)
  include (cidade_slug, status, bairro, categoria, validado_receita, nota, gerado_em, atualizado_em)
  where status <> ''publicado'' and status <> ''descartado'' and status <> ''removido'' and (conteudo is not null or rascunho is not null)');
-- no ar com versão nova esperando, por cidade
select pg_temp.guia_ddl('create index if not exists guia_lugares_nova_cidade on public.guia_lugares (cidade_slug, status) where rascunho is not null');

CREATE OR REPLACE FUNCTION public.guia_resumo()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
 SET jit TO 'off'
AS $function$
begin
  if not public.eh_plataforma() then raise exception 'só a plataforma lê o resumo do guia'; end if;
  return coalesce((
    with
    -- 258: por cidade, status e categoria, pelo índice guia_lugares_fila (sem abrir os salões)
    fases as (
      select l.cidade_slug, l.status, l.categoria, count(*) as n from public.guia_lugares l group by 1, 2, 3
    ),
    por_cidade as (
      select f.cidade_slug,
             coalesce(sum(f.n) filter (where f.status <> 'removido'), 0) as total,
             coalesce(sum(f.n) filter (where f.status = 'publicado'), 0) as no_ar,
             coalesce(sum(f.n) filter (where f.status = 'descartado'), 0) as descartados,
             coalesce(sum(f.n) filter (where f.status = 'removido'), 0) as removidos,
             -- quantos no ar por categoria
             coalesce(jsonb_object_agg(f.categoria, f.n) filter (where f.status = 'publicado'), '{}'::jsonb) as categorias
        from fases f group by f.cidade_slug
    ),
    -- as fases da fila, as mesmas da tela (faseDe em src/pages/plataforma/Guia.jsx): só os que não estão no ar, que são poucos
    gerar as (
      select l.cidade_slug, count(*) as n from public.guia_lugares l
       where l.status <> 'publicado' and l.status <> 'descartado' and l.status <> 'removido' and l.conteudo is null and l.rascunho is null
       group by 1
    ),
    revisar as (
      select l.cidade_slug, count(*) as n from public.guia_lugares l
       where l.status <> 'publicado' and l.status <> 'descartado' and l.status <> 'removido' and (l.conteudo is not null or l.rascunho is not null)
       group by 1
    ),
    nova as (
      select l.cidade_slug, count(*) as n from public.guia_lugares l where l.rascunho is not null and l.status = 'publicado' group by 1
    ),
    -- o nome e a UF (os de antes: o maior de cada cidade), pelo índice guia_lugares_cidade_nome
    nomes as (
      select l.cidade_slug, max(l.cidade) as cidade, max(l.uf) as uf from public.guia_lugares l group by 1
    )
    select jsonb_agg(jsonb_build_object(
        'cidade', nm.cidade, 'cidade_slug', c.cidade_slug, 'uf', nm.uf,
        'total', c.total, 'gerar', coalesce(ge.n, 0), 'revisar', coalesce(rv.n, 0), 'nova', coalesce(nv.n, 0), 'no_ar', c.no_ar,
        'descartados', c.descartados, 'removidos', c.removidos, 'categorias', c.categorias) order by nm.cidade, c.cidade_slug)
      from por_cidade c
      join nomes nm on nm.cidade_slug = c.cidade_slug
      left join gerar ge on ge.cidade_slug = c.cidade_slug
      left join revisar rv on rv.cidade_slug = c.cidade_slug
      left join nova nv on nv.cidade_slug = c.cidade_slug), '[]'::jsonb);
end $function$;

analyze public.guia_lugares;
