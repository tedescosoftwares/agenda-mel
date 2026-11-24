-- 260 · As cidades do guia no Google (4.5)
-- aplicar: sem-transacao
-- (a linha de cima diz ao aplicar.sh para rodar comando a comando: os índices em site_eventos ficam gravados assim que terminam)
--
-- Plataforma › Guia › Ao vivo › Cidades: para cada cidade com salão no ar, quando ela foi ao ar, quando começou a
-- aparecer nas buscas do Google (Search Console), o primeiro clique, a primeira visita que veio do Google e, no período,
-- as aparições, os cliques e as visitas dia a dia. Serve para medir quanto o Google demora a mostrar as páginas novas.
--
--   site_buscas_cidades: o Search Console somado por cidade e por dia (as páginas /saloes/<cidade>/...). As linhas de
--     site_buscas são uma por dia, página, busca e aparelho, e somar tudo isso a cada abertura da tela pesaria como as
--     outras abas pesavam: site_buscas_gravar (a sincronização do Search Console) refaz o resumo dos dias que gravou.
--     As aparições são a soma das buscas que o Google conta (as anônimas, que ele não mostra, ficam de fora): servem
--     para ver quando a cidade começa a aparecer e se cresce, não para bater com o número total do Search Console.
--   índices em site_eventos (só as visitas de páginas de cidade, e só as que vieram do Google): a tela conta as visitas
--     do período e a primeira visita pelo Google de cada cidade sem ler a tabela inteira.
--   site_cidades(dias_): a resposta da tela (só a Plataforma).
-- Pode rodar de novo.

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

-- ---- o Search Console por cidade e por dia ------------------------------------------------------------------------
create table if not exists public.site_buscas_cidades (
  dia date not null,
  cidade_slug text not null,
  aparicoes integer not null default 0,
  cliques integer not null default 0,
  primary key (dia, cidade_slug)
);
alter table public.site_buscas_cidades enable row level security;
revoke all on public.site_buscas_cidades from anon, authenticated;
create index if not exists site_buscas_cidades_cidade on public.site_buscas_cidades (cidade_slug, dia);

-- a cidade de uma página do guia (/saloes/<cidade> e o que vem embaixo; a página de região não é cidade), ou nulo
create or replace function public.site_cidade_da_pagina(pagina text)
returns text language sql immutable set search_path = public as $$
  select case when pagina ~ '^/saloes/[a-z0-9]+(-[a-z0-9]+)*(/|$)' and split_part(pagina, '/', 3) <> 'regiao'
              then split_part(pagina, '/', 3) end
$$;
revoke execute on function public.site_cidade_da_pagina(text) from public, anon;

-- refaz o resumo dos dias pedidos a partir de site_buscas (o índice único começa pelo dia)
create or replace function public.site_buscas_cidades_refazer(dias_ date[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if dias_ is null or cardinality(dias_) = 0 then return; end if;
  delete from public.site_buscas_cidades where dia = any (dias_);
  insert into public.site_buscas_cidades (dia, cidade_slug, aparicoes, cliques)
  select b.dia, x.cidade, least(sum(b.impressoes), 2147483647)::int, least(sum(b.cliques), 2147483647)::int
    from public.site_buscas b
    cross join lateral (select public.site_cidade_da_pagina(b.pagina) as cidade) x
   where b.dia = any (dias_) and x.cidade is not null
   group by 1, 2;
end $$;
revoke execute on function public.site_buscas_cidades_refazer(date[]) from public, anon, authenticated;

-- site_buscas_gravar (162) igual, e no fim refaz o resumo dos dias que mexeu
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

  -- 260: o resumo por cidade dos dias que este lote tocou (os das linhas e os que foram limpos)
  perform public.site_buscas_cidades_refazer(array(
    select distinct d from (
      select (r ->> 'dia')::date as d from jsonb_array_elements(coalesce(linhas, '[]'::jsonb)) r
      union select unnest(coalesce(dias_, '{}'::date[]))) t
     where d is not null));
  return n;
end $$;
revoke execute on function public.site_buscas_gravar(uuid, jsonb, date[]) from public, anon, authenticated;
grant execute on function public.site_buscas_gravar(uuid, jsonb, date[]) to service_role;

-- o que já está guardado (uma vez; de novo, refaz igual)
select public.site_buscas_cidades_refazer(array(select distinct dia from public.site_buscas));

-- ---- as visitas por cidade ------------------------------------------------------------------------------------------
-- as visitas de páginas de cidade, por data, com a cidade e a origem (a tela conta o período só pelo índice)
select pg_temp.guia_ddl('create index if not exists site_eventos_visitas_cidade on public.site_eventos (em)
  include (cidade_slug, origem) where tipo = ''visita'' and cidade_slug is not null');
-- as que vieram do Google, por cidade (a primeira de cada uma)
select pg_temp.guia_ddl('create index if not exists site_eventos_google_cidade on public.site_eventos (cidade_slug, em)
  where tipo = ''visita'' and origem = ''google'' and cidade_slug is not null');

-- ---- a tela -------------------------------------------------------------------------------------------------------
create or replace function public.site_cidades(dias_ integer default 30)
returns jsonb language plpgsql stable security definer set search_path = public set plan_cache_mode = force_custom_plan set jit = off as $$
declare
  ndias integer := greatest(1, least(coalesce(dias_, 30), 180));
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  de date := hoje - (ndias - 1);
  de_ts timestamptz := (de::timestamp) at time zone 'America/Sao_Paulo';
  r jsonb;
begin
  if not public.eh_plataforma() then raise exception 'só a Plataforma vê as cidades do site'; end if;
  with
  -- as cidades com salão no ar: quantos, desde quando (o primeiro publicado) e o último publicado (índice guia_lugares_lista, 257)
  cid as (
    select l.cidade_slug, count(*) as no_ar, min(l.publicado_em) as desde, max(l.publicado_em) as ultimo
      from public.guia_lugares l where l.status = 'publicado' group by 1
  ),
  -- o nome e a UF (índice guia_lugares_cidade_nome, 258)
  nomes as (select l.cidade_slug, max(l.cidade) as cidade, max(l.uf) as uf from public.guia_lugares l group by 1),
  reg as (
    select cr.cidade_slug, g.slug, g.nome from public.guia_cidades_regiao cr join public.guia_regioes g on g.slug = cr.regiao_slug
  ),
  -- o Search Console: desde sempre (a primeira aparição e o primeiro clique) e no período, dia a dia
  gsc_tudo as (
    select b.cidade_slug, min(b.dia) filter (where b.aparicoes > 0) as primeira, min(b.dia) filter (where b.cliques > 0) as primeiro_clique
      from public.site_buscas_cidades b group by 1
  ),
  gsc_dia as (select b.cidade_slug, b.dia, b.aparicoes, b.cliques from public.site_buscas_cidades b where b.dia >= de),
  -- as visitas das páginas de cada cidade no período, dia a dia, e as que vieram do Google
  ev_dia as (
    select e.cidade_slug, (e.em at time zone 'America/Sao_Paulo')::date as dia, count(*) as visitas, count(*) filter (where e.origem = 'google') as google
      from public.site_eventos e
     where e.tipo = 'visita' and e.cidade_slug is not null and e.em >= de_ts
     group by 1, 2
  ),
  -- a primeira visita pelo Google de cada cidade, desde sempre
  ev_google as (
    select e.cidade_slug, min(e.em) as primeira
      from public.site_eventos e
     where e.tipo = 'visita' and e.origem = 'google' and e.cidade_slug is not null
     group by 1
  ),
  -- o dia a dia de cada cidade, em listas do tamanho do período (o primeiro número é o dia "de")
  serie as (
    select c.cidade_slug,
           jsonb_agg(coalesce(g.aparicoes, 0) order by d.dia) as ap,
           jsonb_agg(coalesce(g.cliques, 0) order by d.dia) as cl,
           jsonb_agg(coalesce(v.google, 0) order by d.dia) as go,
           jsonb_agg(coalesce(v.visitas, 0) order by d.dia) as vi,
           coalesce(sum(g.aparicoes), 0) as aparicoes, coalesce(sum(g.cliques), 0) as cliques,
           coalesce(sum(v.google), 0) as visitas_google, coalesce(sum(v.visitas), 0) as visitas
      from cid c
      cross join (select generate_series(de, hoje, interval '1 day')::date as dia) d
      left join gsc_dia g on g.cidade_slug = c.cidade_slug and g.dia = d.dia
      left join ev_dia v on v.cidade_slug = c.cidade_slug and v.dia = d.dia
     group by c.cidade_slug
  )
  select jsonb_build_object(
    'dias', ndias, 'de', de, 'ate', hoje,
    'gsc', (select jsonb_build_object('primeiro_dia', min(dia), 'ultimo_dia', max(dia)) from public.site_buscas_cidades),
    'cidades', coalesce(jsonb_agg(jsonb_build_object(
        'cidade_slug', c.cidade_slug, 'cidade', coalesce(nm.cidade, c.cidade_slug), 'uf', nm.uf,
        'regiao', case when rg.slug is not null then jsonb_build_object('slug', rg.slug, 'nome', rg.nome) end,
        'no_ar', c.no_ar,
        'no_ar_desde', (c.desde at time zone 'America/Sao_Paulo')::date,
        'ultimo_publicado', (c.ultimo at time zone 'America/Sao_Paulo')::date,
        'primeira_aparicao', gt.primeira, 'primeiro_clique', gt.primeiro_clique,
        'primeira_visita_google', (eg.primeira at time zone 'America/Sao_Paulo')::date,
        'aparicoes', s.aparicoes, 'cliques', s.cliques, 'visitas_google', s.visitas_google, 'visitas', s.visitas,
        'serie', jsonb_build_object('ap', s.ap, 'cl', s.cl, 'go', s.go, 'vi', s.vi))
      order by c.desde desc nulls last, c.cidade_slug), '[]'::jsonb))
    into r
    from cid c
    left join nomes nm on nm.cidade_slug = c.cidade_slug
    left join reg rg on rg.cidade_slug = c.cidade_slug
    left join gsc_tudo gt on gt.cidade_slug = c.cidade_slug
    left join ev_google eg on eg.cidade_slug = c.cidade_slug
    left join serie s on s.cidade_slug = c.cidade_slug;
  return r;
end $$;
revoke execute on function public.site_cidades(integer) from public, anon;
grant execute on function public.site_cidades(integer) to authenticated;

analyze public.site_eventos;
analyze public.site_buscas_cidades;

do $$
declare n bigint; d date;
begin
  select count(distinct cidade_slug), min(dia) into n, d from public.site_buscas_cidades;
  raise notice '260: Search Console resumido para % cidade(s)%', n, coalesce(', desde ' || to_char(d, 'DD/MM/YYYY'), '');
end $$;
