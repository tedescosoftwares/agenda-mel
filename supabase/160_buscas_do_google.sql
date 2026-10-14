-- 160: as buscas do Google (3.12): o que as pessoas buscaram no Google antes
-- de chegar a cada página do guia de salões.
--
-- Os números vêm do Google Search Console (grátis): por dia, página, busca e
-- aparelho, quantas vezes a página apareceu (impressões), quantas vezes
-- clicaram, a taxa de clique (CTR) e a posição média. A MIMO guarda só o que
-- o Search Console devolve, que já chega agregado: nada de pessoa, e as
-- buscas raras o próprio Google esconde.
--
-- Quem enche a tabela é a Edge Function gsc-sincronizar, com a chave de
-- serviço (pelo botão "Atualizar agora" da Plataforma ou pelo relógio da 052);
-- quem lê é a Plataforma, por guia_buscas().
--
-- Para ligar (o passo a passo curto também aparece na tela):
--   1. Google Cloud: um projeto com a "Google Search Console API" ativada e
--      uma conta de serviço com chave JSON;
--   2. Search Console: o e-mail da conta de serviço como usuário da
--      propriedade (permissão restrita basta);
--   3. supabase secrets set GSC_CONTA_SERVICO="$(cat chave.json)" GSC_PROPRIEDADE=sc-domain:mimo.com.vc
--   4. ./supabase/publicar.sh e "Atualizar agora" na Plataforma.
-- Para atualizar todo dia sozinho: o trecho comentado no fim deste arquivo.
--
-- O Google entrega os números com 2 a 3 dias de atraso e conta os dias no
-- fuso do Pacífico; os períodos de guia_buscas() terminam no último dia que
-- já chegou. O histórico fica guardado sem prazo (o Search Console só guarda
-- 16 meses; aqui ele continua).
-- Idempotente.

-- ---- as buscas -------------------------------------------------------------------------------
-- Uma linha por dia + página + busca + aparelho (o aparelho entra na chave
-- porque o Google devolve cada um separado; somar os três dá o dia+página+busca).
create table if not exists public.site_buscas (
  dia date not null,                        -- o dia do Google (fuso do Pacífico)
  pagina text not null,                     -- o caminho, sem domínio: '/saloes/itanhaem/studio-lirio'
  consulta text not null,                   -- a busca, como o Google devolve ('manicure itanhaém')
  aparelho text not null,                   -- celular | computador | tablet
  cliques integer not null default 0,
  impressoes integer not null default 0,
  ctr double precision not null default 0,  -- cliques / impressões
  posicao double precision not null default 0, -- posição média (1 = o primeiro resultado)
  lote uuid,                                -- a sincronização que gravou a linha por último
  atualizado_em timestamptz not null default now(),
  constraint site_buscas_chave primary key (dia, pagina, consulta, aparelho),
  constraint site_buscas_pagina_ok check (pagina ~ '^/saloes(/[a-z0-9_-]+)*$'),
  constraint site_buscas_consulta_ok check (length(consulta) between 1 and 500),
  constraint site_buscas_aparelho_ok check (aparelho in ('celular', 'computador', 'tablet')),
  constraint site_buscas_numeros_ok check (cliques >= 0 and impressoes >= 0 and ctr >= 0 and posicao >= 0)
);
comment on table public.site_buscas is 'Buscas do Google (160): o que o Search Console devolve por dia, página, busca e aparelho. Só a Plataforma lê; a função gsc-sincronizar grava.';
create index if not exists site_buscas_pagina on public.site_buscas (pagina, dia);

-- cada vez que a função rodou (pela Plataforma ou pelo relógio): a tela mostra
-- a última, para o erro do relógio não passar em silêncio
create table if not exists public.site_buscas_execucoes (
  id bigint generated always as identity primary key,
  em timestamptz not null default now(),
  origem text not null default 'plataforma',  -- plataforma | relogio
  ok boolean not null,
  de date,
  ate date,
  linhas integer not null default 0,
  parcial boolean not null default false,     -- o tempo acabou antes de buscar tudo
  erro text,
  constraint site_buscas_execucoes_origem_ok check (origem in ('plataforma', 'relogio'))
);
comment on table public.site_buscas_execucoes is 'Buscas do Google (160): as últimas 200 sincronizações, com o erro quando deu errado.';

alter table public.site_buscas enable row level security;
alter table public.site_buscas_execucoes enable row level security;
drop policy if exists site_buscas_plataforma on public.site_buscas;
create policy site_buscas_plataforma on public.site_buscas for select to authenticated
  using (public.eh_plataforma());
drop policy if exists site_buscas_execucoes_plataforma on public.site_buscas_execucoes;
create policy site_buscas_execucoes_plataforma on public.site_buscas_execucoes for select to authenticated
  using (public.eh_plataforma());
revoke all on public.site_buscas, public.site_buscas_execucoes from public, anon, authenticated;
grant select on public.site_buscas, public.site_buscas_execucoes to authenticated;
grant select, insert, update, delete on public.site_buscas, public.site_buscas_execucoes to service_role;

-- ---- gravar (só a função, com a chave de serviço) ----------------------------------------------
-- linhas: [{ dia, pagina, consulta, aparelho, cliques, impressoes, posicao }]
-- A mesma chave repetida no lote é somada (posição pesada pelas impressões).
-- dias_: os dias que o Google devolveu inteiros nesta sincronização (vai no
-- último pedaço de cada janela); o que sobrou de uma sincronização antiga
-- nesses dias sai, então o dia fica igual ao que o Google tem hoje. Dia que o
-- Google não devolveu nunca é apagado.
-- Chamar com lista vazia não grava nada: é assim que a função confere se quem
-- a chamou tem a chave de serviço (o padrão de _shared/porteiro.ts).
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
     and x.pagina ~ '^/saloes(/[a-z0-9_-]+)*$'
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

-- anota uma sincronização (deu certo ou não) e guarda só as 200 últimas
create or replace function public.site_buscas_registrar(
  origem_ text,
  ok_ boolean,
  de_ date default null,
  ate_ date default null,
  linhas_ integer default 0,
  parcial_ boolean default false,
  erro_ text default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.site_buscas_execucoes (origem, ok, de, ate, linhas, parcial, erro)
  values (case when origem_ = 'relogio' then 'relogio' else 'plataforma' end, coalesce(ok_, false), de_, ate_,
          greatest(coalesce(linhas_, 0), 0), coalesce(parcial_, false), left(nullif(btrim(coalesce(erro_, '')), ''), 500));
  delete from public.site_buscas_execucoes
   where id < (select min(id) from (select id from public.site_buscas_execucoes order by id desc limit 200) x);
end $$;
revoke execute on function public.site_buscas_registrar(text, boolean, date, date, integer, boolean, text) from public, anon, authenticated;
grant execute on function public.site_buscas_registrar(text, boolean, date, date, integer, boolean, text) to service_role;

-- ---- o painel da Plataforma ----------------------------------------------------------------------
-- dias: 7, 30, 90... (até 480). O período termina no último dia que o Google
-- já entregou (ultimo_dia), não hoje: o atraso de 2 a 3 dias não vira queda.
-- Devolve:
--   totais e totais_antes (a mesma janela logo antes; null enquanto o
--     histórico não cobre a janela anterior inteira): cliques, impressões,
--     CTR (cliques / impressões), posição média pesada pelas impressões,
--     quantas buscas e quantas páginas;
--   por_dia, aparelhos;
--   consultas: as 100 buscas que mais trouxeram gente (cliques, depois impressões);
--   paginas: as 200 páginas com mais busca, cada uma com as 10 buscas dela;
--   oportunidades: página + busca com pelo menos "limiar" impressões no período e
--     'subir'        posição média entre 4 e 15 (já aparece; subir umas posições
--                    costuma trazer muito mais clique), ou
--     'pouco_clique' no top 3 e CTR abaixo de 5% (aparece bem e pouca gente clica:
--                    o título e a descrição da página podem chamar mais);
--   execucao: a última sincronização (e ultima_ok, a última que deu certo).
-- Os totais somam as linhas por busca: as buscas que o Google esconde por
-- serem raras ficam de fora, então podem dar um pouco menos que o painel do
-- Search Console.
create or replace function public.guia_buscas(dias integer default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  ndias integer := greatest(1, least(coalesce(dias, 30), 480));
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
    select * from public.site_buscas where dia >= antes_ and dia <= ate_
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
  -- o nome de cada página: o salão (pelo caminho) e a cidade
  nomes as (
    select p.pagina, l.id as lugar_id, l.nome, l.categoria, l.bairro, l.status,
           (select l2.cidade from public.guia_lugares l2 where l2.cidade_slug = split_part(p.pagina, '/', 3) limit 1) as cidade
      from (select pagina from por_pagina union select pagina from oport) p
      left join public.guia_lugares l
        on l.cidade_slug = split_part(p.pagina, '/', 3) and l.slug = split_part(p.pagina, '/', 4) and split_part(p.pagina, '/', 5) = ''
  )
  select jsonb_build_object(
    'dias', ndias,
    'de', de_,
    'ate', ate_,
    'tem_dados', ultimo is not null,
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
revoke execute on function public.guia_buscas(integer) from public, anon;
grant execute on function public.guia_buscas(integer) to authenticated;

-- ---- o relógio: chamar a função todo dia -------------------------------------------------------
-- Como chutar_fila() da 052: lê do Vault a URL do projeto e a chave de
-- serviço (gravadas por ligar_relogio) e faz um POST assíncrono (pg_net) na
-- gsc-sincronizar. Criar a função não liga nada: o agendamento está comentado
-- logo abaixo. Onde não há Vault nem pg_net (o teste local), responde o motivo.
create or replace function public.chutar_gsc()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  url text;
  chave text;
  pedido bigint;
begin
  begin
    execute $q$ select decrypted_secret from vault.decrypted_secrets where name = 'mimo_url' $q$ into url;
    execute $q$ select decrypted_secret from vault.decrypted_secrets where name = 'mimo_service_role' $q$ into chave;
  exception when others then
    return jsonb_build_object('ok', false, 'motivo', 'Vault indisponível: ' || sqlerrm);
  end;
  if url is null or chave is null then
    return jsonb_build_object('ok', false, 'motivo', 'sem credenciais: rode antes select public.ligar_relogio(url, chave) (migração 052)');
  end if;
  begin
    execute format(
      $q$ select net.http_post(
            url := %L,
            headers := %L::jsonb,
            body := '{"origem":"relogio"}'::jsonb,
            timeout_milliseconds := 150000) $q$,
      rtrim(url, '/') || '/functions/v1/gsc-sincronizar',
      jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || chave)::text)
    into pedido;
  exception when others then
    return jsonb_build_object('ok', false, 'motivo', 'pg_net indisponível: ' || sqlerrm);
  end;
  return jsonb_build_object('ok', true, 'pedido', pedido);
end $$;
revoke execute on function public.chutar_gsc() from public, anon, authenticated;

-- Para atualizar sozinho todo dia (depois de: relógio da 052 ligado, segredos
-- GSC_* gravados e a função publicada), rode UMA vez no SQL Editor:
--
--   select cron.schedule('mimo-gsc', '23 9 * * *', 'select public.chutar_gsc()');
--     -- todo dia às 06:23 de Brasília (09:23 UTC); nome repetido substitui, não duplica
--
-- Conferir:  select jobname, schedule, active from cron.job where jobname = 'mimo-gsc';
--            select * from public.site_buscas_execucoes order by id desc limit 5;
-- Desligar:  select cron.unschedule('mimo-gsc');

do $$
declare n int;
begin
  select count(*) into n from public.site_buscas;
  raise notice '160: buscas do Google prontas (% linhas guardadas)', n;
end $$;
