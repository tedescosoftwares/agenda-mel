-- 193 (3.45): no site ao vivo, onde cada visita tocou e como ela terminou.
--
-- Os toques nas páginas dos salões já eram gravados em site_eventos (156): WhatsApp, ligar, como chegar, Instagram, site,
-- e-mail, agendar pela MIMO, "Quero marcar"... com o mesmo código do dia que site_presencas (192) usa para reconhecer a
-- visita. Aqui os dois se juntam: cada visita do painel traz as ações dela (o tipo, o salão, a página e o tempo desde a
-- entrada) e o desfecho:
--   saiu_<ação>      saiu logo depois de tocar (até 2 minutos): quem toca no WhatsApp e não volta provavelmente foi
--                    falar com o salão (o mesmo vale para ligar, agendar pela MIMO e o pedido de "Quero marcar")
--   contatou_e_saiu  tocou, voltou ao site e saiu depois
--   sem_contato      saiu sem tocar em contato (a página de saída é a última do trajeto)
--   contatou         ainda no site, já tocou em contato
--   navegando        ainda no site, sem tocar em contato
-- Contato aqui é o que leva a cliente ao salão: o grupo contato (WhatsApp, ligar, como chegar, Instagram, site, e-mail,
-- agendar pela MIMO), o "Quero marcar" e o pedido enviado. "Sou dono", "criar agenda", compartilhar e corrigir aparecem
-- entre as ações da visita, mas não são contato (são do dono do salão ou não levam a um atendimento).
-- E o painel ganha as últimas ações (ao vivo), as ações da última meia hora e de hoje, e como terminaram as visitas de
-- hoje. Um tipo novo, pedido_enviado: o pedido de "Quero marcar" enviado (o toque no botão já era quero_marcar); fica no
-- grupo 'outro' para não contar duas vezes nos interesses do Desempenho.

insert into public.site_eventos_tipos (tipo, rotulo, grupo, ordem) values ('pedido_enviado', 'Pedido enviado (Quero marcar)', 'outro', 72)
on conflict (tipo) do nothing;

create or replace function public.site_ao_vivo()
returns jsonb language plpgsql stable security definer set search_path = public set plan_cache_mode = force_custom_plan set jit = off as $$
declare
  hoje_ini timestamptz := ((now() at time zone 'America/Sao_Paulo')::date)::timestamp at time zone 'America/Sao_Paulo';
  r jsonb;
begin
  if not public.eh_plataforma() then raise exception 'só a plataforma vê o site ao vivo'; end if;
  with
  trinta as materialized (select * from public.site_presencas where visto_em > now() - interval '30 minutes'),
  agora_ as materialized (select * from trinta where visto_em > now() - interval '75 seconds' and saiu_em is null),
  hoje as materialized (select * from public.site_presencas where inicio_em >= hoje_ini),
  visitas as materialized (select * from public.site_presencas where inicio_em >= hoje_ini or visto_em > now() - interval '30 minutes'),
  -- as ações (tudo menos a visita de página) de quem visitou hoje ou na última meia hora
  ev as materialized (
    select e.visitante, e.em, e.tipo, e.pagina, e.lugar_id, t.rotulo, t.grupo, (t.grupo = 'contato' or e.tipo in ('quero_marcar', 'pedido_enviado')) as contato
      from public.site_eventos e join public.site_eventos_tipos t using (tipo)
     where e.em >= least(hoje_ini, now() - interval '30 minutes') - interval '1 minute' and e.tipo <> 'visita'
       and e.visitante in (select visitante from visitas)
  ),
  -- cada visita com as ações dela: do mesmo visitante, de um minuto antes da entrada até dois depois da última batida
  acoes_v as materialized (
    select v.id,
           jsonb_agg(jsonb_build_object('tipo', e.tipo, 'rotulo', e.rotulo, 'grupo', e.grupo, 'em', e.em, 'pagina', e.pagina, 'lugar', l.nome,
                                        't', greatest(0, round(extract(epoch from e.em - v.inicio_em)))::int) order by e.em) as acoes,
           (array_agg(e.tipo order by e.em desc) filter (where e.contato))[1] as ult_tipo,
           max(e.em) filter (where e.contato) as ult_em,
           count(*) filter (where e.contato) as contatos
      from visitas v
      join ev e on e.visitante = v.visitante and e.em between v.inicio_em - interval '1 minute' and v.visto_em + interval '2 minutes'
      left join public.guia_lugares l on l.id = e.lugar_id
     group by v.id
  ),
  -- o desfecho de cada visita
  vis as materialized (
    select v.*, coalesce(a.acoes, '[]'::jsonb) as acoes, coalesce(a.contatos, 0) as contatos,
           (v.saiu_em is not null or v.visto_em <= now() - interval '75 seconds') as terminou,
           case when not (v.saiu_em is not null or v.visto_em <= now() - interval '75 seconds')
                  then case when a.ult_tipo is not null then 'contatou' else 'navegando' end
                when a.ult_tipo is not null and a.ult_em >= coalesce(v.saiu_em, v.visto_em) - interval '2 minutes' then 'saiu_' || a.ult_tipo
                when a.ult_tipo is not null then 'contatou_e_saiu'
                else 'sem_contato' end as desfecho
      from visitas v left join acoes_v a on a.id = v.id
  ),
  -- os toques da última meia hora, de todo mundo (também de quem não tem visita registrada: presença barrada ou de antes)
  ev30 as materialized (
    select e.visitante, e.em, e.tipo, e.pagina, e.lugar_id, t.rotulo, t.grupo
      from public.site_eventos e join public.site_eventos_tipos t using (tipo)
     where e.em > now() - interval '30 minutes' and e.tipo not in ('visita', 'localizacao')
  ),
  minutos as (
    select m, (select count(*) from trinta t where t.inicio_em < m + interval '1 minute' and t.visto_em >= m) as n
      from generate_series(date_trunc('minute', now()) - interval '29 minutes', date_trunc('minute', now()), interval '1 minute') m
  ),
  ev_hoje as materialized (
    select e.em, e.tipo, e.visitante, e.lugar_id, e.pagina, t.rotulo, t.grupo, (t.grupo = 'contato' or e.tipo in ('quero_marcar', 'pedido_enviado')) as contato
      from public.site_eventos e join public.site_eventos_tipos t using (tipo)
     where e.em >= hoje_ini and e.tipo not in ('visita', 'localizacao')
  )
  select jsonb_build_object(
    'agora', now(),
    'no_site', (select count(*) from agora_),
    'ultimos_30', (select count(*) from trinta),
    'minutos', (select coalesce(jsonb_agg(jsonb_build_object('m', m, 'n', n) order by m), '[]'::jsonb) from minutos),
    'ativos', (select coalesce(jsonb_agg(to_jsonb(a) - 'visitante' - 'terminou' order by a.visto_em desc), '[]'::jsonb)
                 from (select * from vis where id in (select id from agora_) order by visto_em desc limit 200) a),
    'recentes', (select coalesce(jsonb_agg(to_jsonb(a) - 'visitante' - 'terminou' order by a.visto_em desc), '[]'::jsonb)
                   from (select * from vis where id in (select id from trinta) and id not in (select id from agora_) and visto_em > now() - interval '10 minutes'
                          order by visto_em desc limit 30) a),
    'paginas_agora', (select coalesce(jsonb_agg(jsonb_build_object('pagina', x.pagina, 'titulo', x.titulo, 'n', x.n) order by x.n desc, x.pagina), '[]'::jsonb)
                        from (select pagina, max(titulo) as titulo, count(*) as n from agora_ group by pagina order by count(*) desc limit 10) x),
    'origens', (select coalesce(jsonb_agg(jsonb_build_object('origem', x.origem, 'n', x.n) order by x.n desc), '[]'::jsonb)
                  from (select coalesce(origem, 'outro') as origem, count(*) as n from trinta group by 1) x),
    'dispositivos', (select coalesce(jsonb_agg(jsonb_build_object('dispositivo', x.d, 'n', x.n) order by x.n desc), '[]'::jsonb)
                       from (select coalesce(dispositivo, 'outro') as d, count(*) as n from trinta group by 1) x),
    'cidades', (select coalesce(jsonb_agg(jsonb_build_object('cidade', x.cidade, 'uf', x.uf, 'n', x.n, 'gps', x.gps) order by x.n desc), '[]'::jsonb)
                  from (select cidade, uf, count(*) as n, count(*) filter (where local_fonte = 'gps') as gps from trinta where cidade is not null
                         group by cidade, uf order by count(*) desc limit 12) x),
    -- 193: as últimas ações (ao vivo), com o aparelho e a cidade da visita, e as da última meia hora por tipo
    'acoes_recentes', (select coalesce(jsonb_agg(x.o order by x.em desc), '[]'::jsonb) from (
        select e.em, jsonb_build_object('em', e.em, 'tipo', e.tipo, 'rotulo', e.rotulo, 'grupo', e.grupo, 'pagina', e.pagina, 'lugar', l.nome,
                                        'dispositivo', p.dispositivo, 'cidade', p.cidade, 'uf', p.uf, 'local_fonte', p.local_fonte, 'visita', p.id) as o
          from (select * from ev30 order by em desc limit 25) e
          left join public.guia_lugares l on l.id = e.lugar_id
          left join lateral (select s.id, s.dispositivo, s.cidade, s.uf, s.local_fonte from public.site_presencas s
                              where s.visitante = e.visitante and s.visto_em >= e.em - interval '2 minutes' and s.inicio_em <= e.em + interval '1 minute'
                              order by s.visto_em desc limit 1) p on true) x),
    'acoes', (select coalesce(jsonb_agg(jsonb_build_object('tipo', x.tipo, 'rotulo', x.rotulo, 'n', x.n) order by x.n desc), '[]'::jsonb)
                from (select tipo, max(rotulo) as rotulo, count(*) as n from ev30 group by tipo) x),
    'hoje', jsonb_build_object(
      'visitas', (select count(*) from hoje),
      'paginas', (select coalesce(sum(paginas), 0) from hoje),
      'tempo_medio_s', (select coalesce(round(avg(extract(epoch from visto_em - inicio_em)))::int, 0) from hoje),
      'por_hora', (select jsonb_agg(jsonb_build_object('h', h, 'n', coalesce(c.n, 0)) order by h)
                     from generate_series(0, 23) h
                     left join (select extract(hour from inicio_em at time zone 'America/Sao_Paulo')::int as hh, count(*) as n from hoje group by 1) c on c.hh = h),
      'origens', (select coalesce(jsonb_agg(jsonb_build_object('origem', x.origem, 'n', x.n) order by x.n desc), '[]'::jsonb)
                    from (select coalesce(origem, 'outro') as origem, count(*) as n from hoje group by 1) x),
      'dispositivos', (select coalesce(jsonb_agg(jsonb_build_object('dispositivo', x.d, 'n', x.n) order by x.n desc), '[]'::jsonb)
                         from (select coalesce(dispositivo, 'outro') as d, count(*) as n from hoje group by 1) x),
      'navegadores', (select coalesce(jsonb_agg(jsonb_build_object('navegador', x.b, 'n', x.n) order by x.n desc), '[]'::jsonb)
                        from (select coalesce(navegador, 'outro') as b, count(*) as n from hoje group by 1 order by count(*) desc limit 8) x),
      'cidades', (select coalesce(jsonb_agg(jsonb_build_object('cidade', x.cidade, 'uf', x.uf, 'n', x.n) order by x.n desc), '[]'::jsonb)
                    from (select cidade, uf, count(*) as n from hoje where cidade is not null group by cidade, uf order by count(*) desc limit 12) x),
      'entradas', (select coalesce(jsonb_agg(jsonb_build_object('pagina', x.entrada, 'n', x.n) order by x.n desc), '[]'::jsonb)
                     from (select entrada, count(*) as n from hoje group by entrada order by count(*) desc limit 10) x),
      -- 193: as ações de hoje (todas, também de quem visitou antes do site ao vivo existir), as visitas que tocaram em
      -- contato, como terminaram as visitas e as páginas de onde se sai sem contatar. Nos salões, o pedido enviado conta à
      -- parte (o "Quero marcar" que veio antes dele já contou)
      'acoes', (select coalesce(jsonb_agg(jsonb_build_object('tipo', x.tipo, 'rotulo', x.rotulo, 'grupo', x.grupo, 'n', x.n) order by x.n desc), '[]'::jsonb)
                  from (select tipo, max(rotulo) as rotulo, max(grupo) as grupo, count(*) as n from ev_hoje group by tipo) x),
      'saloes', (select coalesce(jsonb_agg(jsonb_build_object('lugar', x.nome, 'n', x.n, 'whatsapp', x.w, 'pedidos', x.p) order by x.n desc), '[]'::jsonb)
                   from (select l.nome, count(*) filter (where e.tipo <> 'pedido_enviado') as n, count(*) filter (where e.tipo = 'whatsapp') as w,
                                count(*) filter (where e.tipo = 'pedido_enviado') as p
                           from ev_hoje e join public.guia_lugares l on l.id = e.lugar_id
                          where e.contato group by l.nome order by 2 desc limit 10) x),
      'com_contato', (select count(*) from vis where inicio_em >= hoje_ini and contatos > 0),
      'terminadas', (select count(*) from vis where inicio_em >= hoje_ini and terminou),
      'desfechos', (select coalesce(jsonb_agg(jsonb_build_object('desfecho', x.desfecho, 'n', x.n) order by x.n desc), '[]'::jsonb)
                      from (select desfecho, count(*) as n from vis where inicio_em >= hoje_ini and terminou group by desfecho) x),
      'saidas_sem_contato', (select coalesce(jsonb_agg(jsonb_build_object('pagina', x.pagina, 'titulo', x.titulo, 'n', x.n) order by x.n desc), '[]'::jsonb)
                            from (select pagina, max(titulo) as titulo, count(*) as n from vis where inicio_em >= hoje_ini and desfecho = 'sem_contato'
                                   group by pagina order by count(*) desc limit 8) x)),
    'geo', (select jsonb_build_object('carregado_em', g.carregado_em, 'versao', g.versao, 'faixas', g.faixas) from public.geo_ip_carga g where g.id = 1)
  ) into r;
  return r;
end $$;
comment on function public.site_ao_vivo() is 'Site (192, 193): quem está no site agora, com as ações de cada visita (onde tocou) e o desfecho (como terminou), as últimas ações, os últimos 30 minutos e o resumo de hoje. Só a Plataforma.';
revoke execute on function public.site_ao_vivo() from public, anon;
grant execute on function public.site_ao_vivo() to authenticated;

do $$
begin
  raise notice '193: site_ao_vivo com as ações e o desfecho de cada visita; tipo pedido_enviado';
end $$;
