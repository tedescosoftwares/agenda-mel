-- 162: as buscas do Google no site inteiro (3.12.1).
--
-- A 160 só pedia ao Google as páginas do guia (/saloes...). Só que o Search
-- Console da MIMO já mostra o site inteiro: a página inicial, o blog, as
-- páginas de planos e de SEO. Agora a função gsc-sincronizar traz tudo, e
-- cada página cai numa seção, por site_secao(caminho):
--   guia   /saloes...        blog   /blog...        site   o resto
-- guia_buscas(dias, secao) devolve uma seção ('guia', 'blog', 'site') ou
-- 'tudo', e sempre traz, em 'secoes', quanto cada uma teve no período, para
-- o seletor da tela. Os nomes: o salão no guia, o título do artigo no blog
-- (blog_posts) e o título da página nas outras (seo_pages, pela rota).
-- O caminho guardado pode ser qualquer um do site: começa com barra, sem
-- espaço, sem ? e sem #, até 500 caracteres (a função confere o mesmo).
-- Quem já tinha linhas do guia não perde nada; as outras seções chegam na
-- próxima sincronização (a primeira depois desta migração volta 16 meses se
-- a tabela estiver vazia; se não, só o que falta; para trazer o histórico
-- das outras seções, "Atualizar agora" com dias: 480 pela função, ou
-- apague site_buscas e sincronize de novo).
-- Idempotente.

-- ---- qualquer página do site --------------------------------------------------------------------
alter table public.site_buscas drop constraint if exists site_buscas_pagina_ok;
alter table public.site_buscas add constraint site_buscas_pagina_ok check (pagina ~ '^/[^[:space:][:cntrl:]?#]*$' and length(pagina) <= 500);
comment on column public.site_buscas.pagina is 'O caminho da página, sem domínio: /saloes/itanhaem/studio-lirio, /blog/um-artigo, /planos, / (a inicial).';

-- a seção de um caminho (guia, blog, site)
create or replace function public.site_secao(pagina text)
returns text language sql immutable set search_path = public as $$
  select case
    when pagina ~ '^/saloes(/|$)' then 'guia'
    when pagina ~ '^/blog(/|$)' then 'blog'
    else 'site'
  end
$$;
revoke execute on function public.site_secao(text) from public, anon;
grant execute on function public.site_secao(text) to authenticated, service_role;
create index if not exists site_buscas_secao on public.site_buscas (public.site_secao(pagina), dia);

-- ---- gravar: a mesma função da 160, aceitando qualquer caminho do site ----------------------------
create or replace function public.site_buscas_gravar(lote_ uuid, linhas jsonb, dias_ date[] default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  n integer := 0;
begin
  if lote_ is null then raise exception 'falta o lote'; end if;
  if linhas is not null and jsonb_typeof(linhas) <> 'array' then raise exception 'linhas tem de ser uma lista'; end if;

  insert into public.site_buscas as s (dia, pagina, consulta, aparelho, cliques, impressoes, ctr, posicao, lote, atualizado_em)
  select x.dia, x.pagina, x.consulta, x.aparelho, sum(x.cliques), sum(x.impressoes),
         case when sum(x.impressoes) > 0 then least(1, sum(x.cliques)::float8 / sum(x.impressoes)) else 0 end,
         coalesce(sum(x.posicao * x.impressoes) / nullif(sum(x.impressoes), 0), avg(x.posicao), 0),
         lote_, now()
    from (
      select r.dia,
             lower(btrim(r.pagina)) as pagina,
             left(btrim(regexp_replace(coalesce(r.consulta, ''), '[[:cntrl:][:space:]]+', ' ', 'g')), 500) as consulta,
             r.aparelho,
             greatest(coalesce(r.cliques, 0), 0) as cliques,
             greatest(coalesce(r.impressoes, 0), 0) as impressoes,
             greatest(coalesce(r.posicao, 0), 0) as posicao
        from jsonb_to_recordset(coalesce(linhas, '[]'::jsonb))
             as r(dia date, pagina text, consulta text, aparelho text, cliques integer, impressoes integer, posicao double precision)
    ) x
   where x.dia is not null
     and x.pagina ~ '^/[^[:space:][:cntrl:]?#]*$' and length(x.pagina) <= 500
     and x.consulta <> ''
     and x.aparelho in ('celular', 'computador', 'tablet')
   group by x.dia, x.pagina, x.consulta, x.aparelho
  on conflict (dia, pagina, consulta, aparelho) do update set
    cliques = excluded.cliques,
    impressoes = excluded.impressoes,
    ctr = excluded.ctr,
    posicao = excluded.posicao,
    lote = excluded.lote,
    atualizado_em = excluded.atualizado_em;
  get diagnostics n = row_count;

  if dias_ is not null and cardinality(dias_) > 0 then
    delete from public.site_buscas where dia = any (dias_) and lote is distinct from lote_;
  end if;
  return n;
end $$;
revoke execute on function public.site_buscas_gravar(uuid, jsonb, date[]) from public, anon, authenticated;
grant execute on function public.site_buscas_gravar(uuid, jsonb, date[]) to service_role;

-- ---- o painel: a mesma guia_buscas da 160, por seção -------------------------------------------
-- A de um parâmetro sai, para o PostgREST não ficar com duas candidatas.
drop function if exists public.guia_buscas(integer);
create or replace function public.guia_buscas(dias integer default 30, secao text default 'guia')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  ndias integer := greatest(1, least(coalesce(dias, 30), 480));
  secao_ text := case when secao in ('guia', 'blog', 'site', 'tudo') then secao else 'guia' end;
  primeiro date;
  ultimo date;
  ate_ date;
  de_ date;
  antes_ date;
  limiar integer := greatest(5, ceil(greatest(1, least(coalesce(dias, 30), 480)) / 3.0)::integer);
  r jsonb;
begin
  if not public.eh_plataforma() then raise exception 'só a plataforma vê as buscas do Google'; end if;

  select min(b.dia), max(b.dia) into primeiro, ultimo from public.site_buscas b;
  ate_ := coalesce(ultimo, (now() at time zone 'America/Sao_Paulo')::date - 3);
  de_ := ate_ - (ndias - 1);
  antes_ := de_ - ndias;

  with b as (
    select * from public.site_buscas
     where dia >= antes_ and dia <= ate_
       and (secao_ = 'tudo' or public.site_secao(pagina) = secao_)
  ),
  agora_ as (select * from b where dia >= de_),
  -- o período anterior só conta quando o histórico cobre a janela inteira
  -- (logo depois de ligar, compararia com dias vazios e daria +900%)
  antes_b as (select * from b where dia < de_ and primeiro <= antes_),
  -- página + busca no período: a base da lista por página e das oportunidades
  pq as (
    select pagina, consulta, sum(cliques)::integer as cliques, sum(impressoes)::integer as impressoes,
           sum(posicao * impressoes) / nullif(sum(impressoes), 0) as posicao
      from agora_ group by pagina, consulta
  ),
  por_pagina as (
    select pagina, sum(cliques)::integer as cliques, sum(impressoes)::integer as impressoes,
           sum(posicao * impressoes) / nullif(sum(impressoes), 0) as posicao,
           count(distinct consulta) as n_consultas
      from agora_ group by pagina
      order by sum(cliques) desc, sum(impressoes) desc, pagina
      limit 200
  ),
  oport as (
    select q.*, case when q.posicao < 4 then 'pouco_clique' else 'subir' end as motivo
      from pq q
     where q.impressoes >= limiar
       and ((q.posicao >= 4 and q.posicao <= 15)
            or (q.posicao < 4 and q.cliques::numeric / nullif(q.impressoes, 0) < 0.05))
     order by q.impressoes desc, q.posicao, q.consulta
     limit 30
  ),
  -- o nome de cada página: o salão (pelo caminho) e a cidade no guia; o título
  -- do artigo no blog; o título da página nas outras (seo_pages, pela rota)
  nomes as (
    select p.pagina, l.id as lugar_id, l.nome as nome_salao, l.categoria, l.bairro, l.status,
           case
             when p.pagina ~ '^/saloes(/|$)' then l.nome
             when p.pagina ~ '^/blog/[^/]+$' then (select nullif(btrim(bp.title), '') from public.blog_posts bp where bp.slug = split_part(p.pagina, '/', 3) limit 1)
             else (select nullif(btrim(sp.title), '') from public.seo_pages sp where sp.route = p.pagina limit 1)
           end as nome,
           case when p.pagina ~ '^/saloes(/|$)' then (select l2.cidade from public.guia_lugares l2 where l2.cidade_slug = split_part(p.pagina, '/', 3) limit 1) end as cidade
      from (select pagina from por_pagina union select pagina from oport) p
      left join public.guia_lugares l
        on p.pagina ~ '^/saloes/' and l.cidade_slug = split_part(p.pagina, '/', 3) and l.slug = split_part(p.pagina, '/', 4) and split_part(p.pagina, '/', 5) = ''
  )
  select jsonb_build_object(
    'dias', ndias,
    'secao', secao_,
    'de', de_,
    'ate', ate_,
    'tem_dados', ultimo is not null,
    -- quanto cada seção teve no período (para o seletor da tela), de todas as seções
    'secoes', (
      select coalesce(jsonb_object_agg(x.s, jsonb_build_object('cliques', x.c, 'impressoes', x.i)), '{}'::jsonb)
        from (select public.site_secao(pagina) as s, sum(cliques) as c, sum(impressoes) as i
                from public.site_buscas where dia >= de_ and dia <= ate_ group by 1) x),
    'primeiro_dia', primeiro,
    'ultimo_dia', ultimo,
    'limiar', limiar,
    'atualizado_em', (select max(atualizado_em) from public.site_buscas),
    'execucao', (select to_jsonb(e) - 'id' from public.site_buscas_execucoes e order by e.id desc limit 1),
    'ultima_ok', (select max(em) from public.site_buscas_execucoes where ok),
    'totais', (
      select jsonb_build_object(
        'cliques', coalesce(sum(cliques), 0), 'impressoes', coalesce(sum(impressoes), 0),
        'ctr', round(coalesce(sum(cliques)::numeric / nullif(sum(impressoes), 0), 0), 4),
        'posicao', round((sum(posicao * impressoes) / nullif(sum(impressoes), 0))::numeric, 1),
        'consultas', count(distinct consulta), 'paginas', count(distinct pagina))
        from agora_),
    'totais_antes', (
      select case when primeiro is not null and primeiro <= antes_ then jsonb_build_object(
        'cliques', coalesce(sum(cliques), 0), 'impressoes', coalesce(sum(impressoes), 0),
        'ctr', round(coalesce(sum(cliques)::numeric / nullif(sum(impressoes), 0), 0), 4),
        'posicao', round((sum(posicao * impressoes) / nullif(sum(impressoes), 0))::numeric, 1),
        'consultas', count(distinct consulta), 'paginas', count(distinct pagina)) end
        from antes_b),
    'por_dia', (
      select jsonb_agg(jsonb_build_object('dia', d.dia, 'cliques', coalesce(x.c, 0), 'impressoes', coalesce(x.i, 0),
                                          'posicao', round(x.p::numeric, 1)) order by d.dia)
        from (select g::date as dia from generate_series(de_, ate_, interval '1 day') g) d
        left join (select dia, sum(cliques) as c, sum(impressoes) as i, sum(posicao * impressoes) / nullif(sum(impressoes), 0) as p
                     from agora_ group by dia) x using (dia)
    ),
    'aparelhos', (
      select coalesce(jsonb_agg(jsonb_build_object('aparelho', aparelho, 'cliques', c, 'impressoes', i) order by i desc), '[]'::jsonb)
        from (select aparelho, sum(cliques) as c, sum(impressoes) as i from agora_ group by aparelho) x
    ),
    'consultas', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'consulta', consulta, 'cliques', c, 'impressoes', i,
               'ctr', round(coalesce(c::numeric / nullif(i, 0), 0), 4), 'posicao', round(p::numeric, 1), 'paginas', np)
             order by c desc, i desc, consulta), '[]'::jsonb)
        from (select consulta, sum(cliques) as c, sum(impressoes) as i,
                     sum(posicao * impressoes) / nullif(sum(impressoes), 0) as p, count(distinct pagina) as np
                from agora_ group by consulta
                order by sum(cliques) desc, sum(impressoes) desc, consulta
                limit 100) x
    ),
    'paginas', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'pagina', p.pagina, 'lugar_id', n.lugar_id, 'nome', n.nome, 'categoria', n.categoria, 'bairro', n.bairro,
               'status', n.status, 'cidade', n.cidade,
               'cliques', p.cliques, 'impressoes', p.impressoes,
               'ctr', round(coalesce(p.cliques::numeric / nullif(p.impressoes, 0), 0), 4),
               'posicao', round(p.posicao::numeric, 1), 'n_consultas', p.n_consultas,
               'consultas', (
                 select coalesce(jsonb_agg(jsonb_build_object(
                          'consulta', q.consulta, 'cliques', q.cliques, 'impressoes', q.impressoes,
                          'ctr', round(coalesce(q.cliques::numeric / nullif(q.impressoes, 0), 0), 4), 'posicao', round(q.posicao::numeric, 1))
                        order by q.cliques desc, q.impressoes desc, q.consulta), '[]'::jsonb)
                   from (select * from pq where pq.pagina = p.pagina order by cliques desc, impressoes desc, consulta limit 10) q))
             order by p.cliques desc, p.impressoes desc, p.pagina), '[]'::jsonb)
        from por_pagina p left join nomes n using (pagina)
    ),
    'oportunidades', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'pagina', o.pagina, 'nome', n.nome, 'cidade', n.cidade, 'consulta', o.consulta, 'motivo', o.motivo,
               'cliques', o.cliques, 'impressoes', o.impressoes,
               'ctr', round(coalesce(o.cliques::numeric / nullif(o.impressoes, 0), 0), 4), 'posicao', round(o.posicao::numeric, 1))
             order by o.impressoes desc, o.posicao, o.consulta), '[]'::jsonb)
        from oport o left join nomes n using (pagina)
    )
  ) into r;
  return r;
end $$;
revoke execute on function public.guia_buscas(integer, text) from public, anon;
grant execute on function public.guia_buscas(integer, text) to authenticated;

do $$
declare n int; g int;
begin
  select count(*), count(*) filter (where public.site_secao(pagina) = 'guia') into n, g from public.site_buscas;
  raise notice '162: buscas do Google do site inteiro (% linhas guardadas, % do guia)', n, g;
end $$;
