-- 161: a aba Desempenho do guia de cara nova (3.12): os números por dia
-- que os gráficos e as tendências precisam.
--
-- Só troca guia_desempenho() (create or replace). Tudo o que a 156
-- devolvia continua igual, no mesmo lugar (o painel do Revisar e o demo
-- usam), e entra:
--   - por_dia: além de visitas e contatos, as pessoas do dia (visitantes),
--     quantas delas tentaram contato (contataram) e os pedidos "quero
--     marcar" do dia (pedidos). É o que desenha o gráfico por dia (quem
--     visitou, com quem tentou contato em destaque) e as tendências dos
--     números do topo;
--   - paginas: visitas_antes, as visitas da página no período anterior
--     (para o destaque "em alta"); null enquanto não houver histórico do
--     período anterior inteiro, como totais_antes;
--   - interesses_antes: os pedidos do período anterior, pela mesma regra
--     (a mesma janela, cortada na mesma hora, só com histórico completo).
-- Nada muda no rastreio: sem cookie, sem IP, robô fora (ver a 156).
-- Idempotente.

create or replace function public.guia_desempenho(dias integer default 30, cidade_ text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  ndias integer := greatest(1, least(coalesce(dias, 30), 400));
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  de timestamptz;
  ate timestamptz;
  antes timestamptz;
  corte timestamptz;
  tem_antes boolean;
  cid text := nullif(btrim(coalesce(cidade_, '')), '');
  r jsonb;
begin
  if not public.eh_plataforma() then raise exception 'só a plataforma vê o desempenho'; end if;
  -- a limpeza mora aqui: sem cron, o que passou de 400 dias some quando alguém olha
  delete from public.site_eventos where em < now() - interval '400 days';

  de := ((hoje - (ndias - 1))::timestamp) at time zone 'America/Sao_Paulo';
  ate := ((hoje + 1)::timestamp) at time zone 'America/Sao_Paulo';
  antes := de - make_interval(days => ndias);
  -- o período anterior: a mesma janela, cortada na mesma hora de hoje (o dia de hoje ainda não acabou);
  -- só vale quando os eventos já cobrem a janela inteira (logo depois de ligar, daria +900%)
  corte := now() - make_interval(days => ndias);
  tem_antes := coalesce((select min(em) from public.site_eventos) <= antes, false);

  with ev as (
    select e.*, (e.em at time zone 'America/Sao_Paulo')::date as dia, t.grupo
      from public.site_eventos e join public.site_eventos_tipos t using (tipo)
     where e.em >= antes and e.em < ate and (e.pagina = '/saloes' or e.pagina like '/saloes/%') and (cid is null or e.cidade_slug = cid)
  ),
  agora_ as (select * from ev where em >= de),
  antes_ as (select * from ev where em < corte and tem_antes),
  int_ as (
    select i.lugar_id, i.tipo, count(*) as n
      from public.guia_interesses i join public.guia_lugares l on l.id = i.lugar_id
     where i.criado_em >= de and i.criado_em < ate and (cid is null or l.cidade_slug = cid)
     group by 1, 2
  ),
  -- 161: os pedidos "quero marcar" de cada dia (para a tendência do número do topo)
  int_dia as (
    select (i.criado_em at time zone 'America/Sao_Paulo')::date as dia, count(*) as n
      from public.guia_interesses i join public.guia_lugares l on l.id = i.lugar_id
     where i.tipo = 'quero_marcar' and i.criado_em >= de and i.criado_em < ate and (cid is null or l.cidade_slug = cid)
     group by 1
  ),
  -- 161: os pedidos do período anterior, pela mesma regra de totais_antes
  int_antes as (
    select i.tipo, count(*) as n
      from public.guia_interesses i join public.guia_lugares l on l.id = i.lugar_id
     where tem_antes and i.criado_em >= antes and i.criado_em < corte and (cid is null or l.cidade_slug = cid)
     group by 1
  ),
  -- 161: as visitas de cada página no período anterior (o destaque "em alta")
  antes_pag as (
    select pagina, count(*) as visitas from antes_ where tipo = 'visita' group by pagina
  ),
  -- agregado uma vez só e juntado por página (subconsulta por página ficava páginas × eventos)
  por_tipo as (
    select pagina, jsonb_object_agg(tipo, n) as eventos
      from (select pagina, tipo, count(*) as n from agora_ group by 1, 2) x
     group by 1
  ),
  por_pagina as (
    select g.*, t.eventos
      from (select a.pagina, max(a.lugar_id::text)::uuid as lugar_id,
                   count(*) filter (where a.tipo = 'visita') as visitas,
                   count(distinct (a.dia, a.visitante)) filter (where a.tipo = 'visita') as visitantes,
                   count(*) filter (where a.grupo = 'contato') as contatos,
                   count(distinct (a.dia, a.visitante)) filter (where a.grupo = 'contato') as contataram
              from agora_ a group by a.pagina) g
      left join por_tipo t using (pagina)
  ),
  -- as páginas que tiveram evento, mais os salões no ar que não tiveram nenhum
  paginas as (
    select p.pagina, p.lugar_id, l.nome, l.slug, l.bairro, l.status, l.whatsapp, l.telefone, l.salon_id is not null as na_mimo,
           coalesce(l.cidade_slug, split_part(trim(both '/' from p.pagina), '/', 2)) as cidade_slug,
           coalesce(l.categoria, nullif(split_part(trim(both '/' from p.pagina), '/', 3), '')) as categoria,
           p.visitas, p.visitantes, p.contatos, p.contataram, coalesce(p.eventos, '{}'::jsonb) as eventos,
           coalesce((select jsonb_object_agg(i.tipo, i.n) from int_ i where i.lugar_id = p.lugar_id), '{}'::jsonb) as interesses,
           case when tem_antes then coalesce((select a.visitas from antes_pag a where a.pagina = p.pagina), 0) end as visitas_antes
      from por_pagina p left join public.guia_lugares l on l.id = p.lugar_id
    union all
    select '/saloes/' || l.cidade_slug || '/' || l.slug, l.id, l.nome, l.slug, l.bairro, l.status, l.whatsapp, l.telefone, l.salon_id is not null,
           l.cidade_slug, l.categoria, 0, 0, 0, 0, '{}'::jsonb,
           coalesce((select jsonb_object_agg(i.tipo, i.n) from int_ i where i.lugar_id = l.id), '{}'::jsonb),
           case when tem_antes then coalesce((select a.visitas from antes_pag a where a.pagina = '/saloes/' || l.cidade_slug || '/' || l.slug), 0) end
      from public.guia_lugares l
     where l.status = 'publicado' and (cid is null or l.cidade_slug = cid)
       and not exists (select 1 from por_pagina p where p.lugar_id = l.id)
  )
  select jsonb_build_object(
    'dias', ndias,
    'de', (hoje - (ndias - 1)),
    'ate', hoje,
    'tipos', (select coalesce(jsonb_agg(jsonb_build_object('tipo', tipo, 'rotulo', rotulo, 'grupo', grupo) order by ordem, tipo), '[]'::jsonb) from public.site_eventos_tipos where ativo),
    'totais', (select coalesce(jsonb_object_agg(tipo, c), '{}'::jsonb) from (select tipo, count(*) c from agora_ group by tipo) x),
    'totais_antes', (select coalesce(jsonb_object_agg(tipo, c), '{}'::jsonb) from (select tipo, count(*) c from antes_ group by tipo) x),
    'visitantes', (select count(distinct (dia, visitante)) from agora_ where tipo = 'visita'),
    'visitantes_antes', (select count(distinct (dia, visitante)) from antes_ where tipo = 'visita'),
    'contataram', (select count(distinct (dia, visitante)) from agora_ where grupo = 'contato'),
    'contataram_antes', (select count(distinct (dia, visitante)) from antes_ where grupo = 'contato'),
    'interesses', (select coalesce(jsonb_object_agg(tipo, s), '{}'::jsonb) from (select tipo, sum(n) s from int_ group by tipo) x),
    'interesses_antes', (select coalesce(jsonb_object_agg(tipo, n), '{}'::jsonb) from int_antes),
    -- as pessoas do dia contam como no total (dia, visitante): a soma dos dias bate com visitantes e contataram
    'por_dia', (
      select jsonb_agg(jsonb_build_object(
               'dia', d.dia, 'visitas', coalesce(x.v, 0), 'contatos', coalesce(x.c, 0),
               'visitantes', coalesce(x.vs, 0), 'contataram', coalesce(x.ct, 0), 'pedidos', coalesce(p.n, 0)
             ) order by d.dia)
        from (select g::date as dia from generate_series(hoje - (ndias - 1), hoje, interval '1 day') g) d
        left join (select dia,
                          count(*) filter (where tipo = 'visita') as v,
                          count(*) filter (where grupo = 'contato') as c,
                          count(distinct (dia, visitante)) filter (where tipo = 'visita') as vs,
                          count(distinct (dia, visitante)) filter (where grupo = 'contato') as ct
                     from agora_ group by dia) x using (dia)
        left join int_dia p using (dia)
    ),
    'origens', (select coalesce(jsonb_agg(jsonb_build_object('origem', origem, 'visitas', c) order by c desc), '[]'::jsonb)
                  from (select origem, count(*) c from agora_ where tipo = 'visita' and origem <> 'interno' group by origem) x),
    'aparelhos', (select coalesce(jsonb_object_agg(coalesce(aparelho, '?'), c), '{}'::jsonb)
                    from (select aparelho, count(*) c from agora_ where tipo = 'visita' group by aparelho) x),
    'areas', (select coalesce(jsonb_agg(jsonb_build_object('area', area, 'contatos', c) order by c desc), '[]'::jsonb)
                from (select coalesce(area, 'outra') as area, count(*) c from agora_ where grupo in ('contato', 'interesse') group by 1) x),
    'paginas', (select coalesce(jsonb_agg(to_jsonb(p) order by p.visitas desc, p.contatos desc, p.nome nulls last), '[]'::jsonb) from paginas p)
  ) into r;
  return r;
end $$;
revoke execute on function public.guia_desempenho(integer, text) from public, anon;
grant execute on function public.guia_desempenho(integer, text) to authenticated;

do $$
begin
  raise notice '161: guia_desempenho com pessoas, contatos e pedidos por dia, e o período anterior por página';
end $$;
