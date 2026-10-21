-- 187 (3.39): o Desempenho com "Todas as cidades" sem cair no tempo limite.
-- guia_desempenho (161) montava a lista por página com duas subconsultas por linha (os interesses do salão e as visitas
-- do período anterior) e com uma linha para cada salão no ar sem visita. Numa cidade passava; em todas as cidades, com
-- 13 mil salões no ar, levava 12,8 s aqui (o Supabase corta em 8 s) e a resposta passava de 5 MB. Agora: os interesses e o
-- período anterior entram por junção, calculados uma vez; os salões sem visita saem de um passo próprio e, em todas as
-- cidades, a lista leva os 300 no ar há mais tempo (os mais preocupantes), com o total em sem_visita_total, e as 1.000
-- páginas mais visitadas, com o total em paginas_total (os números do topo e o gráfico contam tudo); cada linha
-- leva publicado_em (os dias no ar sem depender da lista carregada na tela). O resto da resposta é o mesmo da 161.
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
  -- 187: os interesses de cada salão num jsonb, uma vez só (antes, uma subconsulta por linha da lista)
  int_lugar as (
    select lugar_id, jsonb_object_agg(tipo, n) as interesses from int_ group by lugar_id
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
  -- 187: os salões no ar sem nenhum evento no período (numa cidade, todos; em todas as cidades, a lista leva os 300 no ar
  -- há mais tempo e o total vai em sem_visita_total: 13 mil linhas faziam a resposta passar de 5 MB e do tempo limite)
  zerados as materialized (
    select l.id, l.nome, l.slug, l.bairro, l.status, l.whatsapp, l.telefone, l.salon_id, l.cidade_slug, l.categoria, l.publicado_em
      from public.guia_lugares l
     where l.status = 'publicado' and (cid is null or l.cidade_slug = cid)
       and not exists (select 1 from por_pagina p where p.lugar_id = l.id)
  ),
  -- as páginas que tiveram evento, mais os salões no ar que não tiveram nenhum
  paginas as (
    (select p.pagina, p.lugar_id, l.nome, l.slug, l.bairro, l.status, l.whatsapp, l.telefone, l.salon_id is not null as na_mimo,
           coalesce(l.cidade_slug, split_part(trim(both '/' from p.pagina), '/', 2)) as cidade_slug,
           -- nas páginas por bairro e por horário (157) a parte 3 é 'bairro'/'horario': a categoria, se houver, é a 5
           coalesce(l.categoria, case when split_part(trim(both '/' from p.pagina), '/', 3) in ('bairro', 'horario')
                                      then nullif(split_part(trim(both '/' from p.pagina), '/', 5), '')
                                      else nullif(split_part(trim(both '/' from p.pagina), '/', 3), '') end) as categoria,
           p.visitas, p.visitantes, p.contatos, p.contataram, coalesce(p.eventos, '{}'::jsonb) as eventos,
           coalesce(il.interesses, '{}'::jsonb) as interesses,
           case when tem_antes then coalesce(ap.visitas, 0) end as visitas_antes,
           l.publicado_em
      from por_pagina p
      left join public.guia_lugares l on l.id = p.lugar_id
      left join int_lugar il on il.lugar_id = p.lugar_id
      left join antes_pag ap on ap.pagina = p.pagina
     order by p.visitas desc, p.contatos desc, p.pagina
     -- em todas as cidades, as 1.000 páginas mais visitadas (o total vai em paginas_total)
     limit case when cid is null then 1000 end)
    union all
    (select '/saloes/' || z.cidade_slug || '/' || z.slug, z.id, z.nome, z.slug, z.bairro, z.status, z.whatsapp, z.telefone, z.salon_id is not null,
            z.cidade_slug, z.categoria, 0, 0, 0, 0, '{}'::jsonb,
            coalesce(il.interesses, '{}'::jsonb),
            case when tem_antes then coalesce(ap.visitas, 0) end,
            z.publicado_em
       from zerados z
       left join int_lugar il on il.lugar_id = z.id
       left join antes_pag ap on ap.pagina = '/saloes/' || z.cidade_slug || '/' || z.slug
      order by z.publicado_em nulls last, z.nome
      limit case when cid is null then 300 end)
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
    'paginas', (select coalesce(jsonb_agg(to_jsonb(p) order by p.visitas desc, p.contatos desc, p.nome nulls last), '[]'::jsonb) from paginas p),
    -- 187: quantos salões no ar não tiveram visita (a lista acima, em todas as cidades, leva só os 300 no ar há mais tempo)
    'sem_visita_total', (select count(*) from zerados),
    'sem_visita_limite', case when cid is null then 300 end,
    'paginas_total', (select count(*) from por_pagina),
    'paginas_limite', case when cid is null then 1000 end
  ) into r;
  return r;
end $$;
revoke execute on function public.guia_desempenho(integer, text) from public, anon;
grant execute on function public.guia_desempenho(integer, text) to authenticated;
comment on function public.guia_desempenho(integer, text) is 'Guia (156, 161, 187): as métricas do guia num período, de uma cidade ou de todas; em todas, os salões sem visita vêm limitados a 300 (total em sem_visita_total).';

do $$
begin
  raise notice '187: guia_desempenho por junções; em todas as cidades, os salões sem visita limitados a 300 com o total à parte';
end $$;
