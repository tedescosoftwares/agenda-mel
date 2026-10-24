-- 209 (3.62): o histórico do site — quem passou por período (até 90 dias), quem é novo e quem voltou, e as horas de cada visita.
--
-- O site ao vivo (192, 193, 196) só olhava as últimas 24 horas e esquecia as visitas depois de 30 dias. Agora:
--   • as visitas ficam 90 dias, e site_visitas(de_, ate_, …) lê qualquer período dentro deles (hoje, 5, 7, 10, 15, 30, 90
--     dias ou duas datas), com filtros (primeira vez / recorrente, só quem tocou em contato, origem, aparelho, cidade, página),
--     o resumo do período (visitas, pessoas, novas, recorrentes, contato, prováveis agendamentos, tempo médio, por dia, por
--     hora, origens, aparelhos, navegadores, cidades, entradas, toques, salões, desfechos, saídas sem contato) e a lista
--     paginada, cada visita com entrada, saída, duração, ações e desfecho;
--   • a pessoa: para saber se quem visita já esteve aqui, cada visita leva um código FIXO da conexão e do navegador
--     (pessoa = hash de um tempero sorteado uma vez neste banco + IP + navegador sem os números de versão). Continua sem IP
--     guardado e sem nada no aparelho (o aviso do site promete); o código não diz quem é a pessoa, só se é a mesma conexão
--     e o mesmo navegador de uma visita anterior. É aproximado: no celular fora do Wi-Fi a conexão muda, e a mesma pessoa
--     pode aparecer como nova. O código do dia (visitante) continua o mesmo, para juntar as batidas e os toques.
--   • site_ao_vivo ganha, em cada visita, quantas vezes a pessoa já esteve aqui (visitas_antes), quando foi a última
--     (ultima_antes_em), se é a primeira vez (primeira_vez) e a recorrência do período e de hoje.

-- ---- o tempero fixo da pessoa ---------------------------------------------------------------------------------------
create table if not exists public.site_segredo (
  id integer primary key default 1 check (id = 1),
  pessoa_sal text not null,
  criado_em timestamptz not null default now()
);
comment on table public.site_segredo is 'Site (209): o tempero sorteado uma vez, que faz o código fixo da pessoa (site_presencas.pessoa). Nunca sai do banco.';
insert into public.site_segredo (id, pessoa_sal)
values (1, encode(sha256(convert_to(gen_random_uuid()::text || '|' || clock_timestamp()::text || '|' || random()::text, 'UTF8')), 'hex'))
on conflict (id) do nothing;
alter table public.site_segredo enable row level security;
revoke all on public.site_segredo from public, anon, authenticated;

-- ---- a pessoa em cada visita ----------------------------------------------------------------------------------------
alter table public.site_presencas add column if not exists pessoa text;
comment on column public.site_presencas.pessoa is 'Site (209): o código fixo da conexão e do navegador (tempero + IP + navegador sem versão, em hash). Não identifica ninguém; só diz se é a mesma conexão de uma visita anterior.';
create index if not exists site_presencas_pessoa on public.site_presencas (pessoa, inicio_em) where pessoa is not null;
comment on table public.site_presencas is 'Site (192, 209): uma linha por visita ao site (página de entrada, de agora, trajeto, origem, aparelho, cidade por GPS ou IP). Sem IP; o visitante é o código do dia de site_evento e a pessoa é o código fixo (209). 90 dias.';

-- ---- a batida de presença (igual à 194, com a pessoa e os 90 dias) ----------------------------------------------------
create or replace function public.site_presenca(
  pagina_ text,
  titulo_ text default null,
  origem_ text default null,
  ref_ text default null,
  utm_ jsonb default null,
  dispositivo_ text default null,
  sistema_ text default null,
  navegador_ text default null,
  tela_ text default null,
  idioma_ text default null,
  lat_ double precision default null,
  lng_ double precision default null,
  sair_ boolean default false
) returns void
language plpgsql security definer set search_path = public set plan_cache_mode = force_custom_plan set jit = off as $$
declare
  cab jsonb; ua text; ip_txt text; ip_ inet;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  sal_ text; visitante_ text; pessoa_ text; tempero text;
  pag text; v public.site_presencas; cid integer; c public.geo_cidades;
  utm_limpo jsonb; tem_gps boolean;
begin
  -- a página: caminho limpo, minúsculo, só as públicas
  pag := lower(split_part(split_part(coalesce(pagina_, ''), '?', 1), '#', 1));
  if length(pag) > 1 then pag := rtrim(pag, '/'); end if;
  if pag !~ '^/[a-z0-9/_.-]{0,200}$' then return; end if;
  if pag ~ '^/(cliente|pro|admin|plataforma|login|onboarding|bem-vinda|avisos|comecar|ativar|equipe|convite|v|entrar|cadastro|email-confirmado|splash|estilo|sessao-app)(/|$)' then return; end if;

  -- robô e ferramenta não contam (o mesmo filtro de site_evento; desde a 194, nem o disfarçado)
  begin cab := current_setting('request.headers', true)::jsonb; exception when others then cab := null; end;
  ua := coalesce(cab ->> 'user-agent', '');
  if public.site_eh_robo(ua) then
    return;
  end if;
  ip_txt := coalesce(nullif(cab ->> 'cf-connecting-ip', ''), nullif(cab ->> 'x-real-ip', ''), nullif(btrim(split_part(coalesce(cab ->> 'x-forwarded-for', ''), ',', 1)), ''), '');

  -- o código do dia, como em site_evento (o sal de hoje nasce aqui também, se ainda não nasceu)
  insert into public.site_sal (dia) values (hoje) on conflict (dia) do nothing;
  if found then delete from public.site_sal where dia < hoje; end if;
  select sal into sal_ from public.site_sal where dia = hoje;
  visitante_ := left(encode(sha256(convert_to(coalesce(sal_, '') || '|' || ip_txt || '|' || ua, 'UTF8')), 'hex'), 16);
  -- 209: o código fixo da pessoa (o navegador sem os números de versão: a atualização do Chrome não vira pessoa nova)
  select pessoa_sal into tempero from public.site_segredo where id = 1;
  pessoa_ := left(encode(sha256(convert_to(coalesce(tempero, '') || '|' || ip_txt || '|' || regexp_replace(ua, '[0-9]+(\.[0-9]+)*', '#', 'g'), 'UTF8')), 'hex'), 20);

  tem_gps := coalesce(lat_ between -34 and 6 and lng_ between -75 and -28, false); -- o Brasil, com folga (sem posição: falso, não nulo)

  -- a visita de agora: a última deste visitante nos últimos 30 minutos
  select * into v from public.site_presencas
   where visitante = visitante_ and visto_em > now() - interval '30 minutes'
   order by visto_em desc limit 1 for update;

  if found then
    -- batida repetida em menos de 10 s na mesma página não muda nada (quem manda demais não pesa)
    if not sair_ and v.saiu_em is null and v.pagina = pag and v.visto_em > now() - interval '10 seconds' and not (tem_gps and v.local_fonte is distinct from 'gps') then
      return;
    end if;
    if tem_gps and v.local_fonte is distinct from 'gps' then
      cid := public.geo_cidade_do_ponto(lat_, lng_);
      select * into c from public.geo_cidades where id = cid;
    end if;
    update public.site_presencas set
      visto_em = now(),
      saiu_em = case when sair_ then now() else null end,
      titulo = coalesce(public.site_texto(titulo_, 140), titulo),
      paginas = paginas + case when pag <> pagina then 1 else 0 end,
      trajeto = case when pag <> pagina and jsonb_array_length(trajeto) < 40
                     then trajeto || jsonb_build_array(jsonb_build_object('p', pag, 't', round(extract(epoch from now() - inicio_em))::int))
                     else trajeto end,
      pagina = pag,
      pessoa = coalesce(pessoa, pessoa_),
      cidade = case when tem_gps and local_fonte is distinct from 'gps' then coalesce(c.cidade, cidade) else cidade end,
      uf = case when tem_gps and local_fonte is distinct from 'gps' then coalesce(c.uf, uf) else uf end,
      bairro = case when tem_gps and local_fonte is distinct from 'gps' then null else bairro end,
      lat = case when tem_gps and local_fonte is distinct from 'gps' then round(lat_::numeric, 3)::double precision else lat end,
      lng = case when tem_gps and local_fonte is distinct from 'gps' then round(lng_::numeric, 3)::double precision else lng end,
      local_fonte = case when tem_gps then 'gps' else local_fonte end
     where id = v.id;
    return;
  end if;

  -- visita nova. Um teto geral: com mais de 3.000 visitas abertas nos últimos 2 minutos, algo está errado (ataque)
  if sair_ then return; end if;
  if (select count(*) from public.site_presencas where visto_em > now() - interval '2 minutes') >= 3000 then return; end if;

  if tem_gps then
    cid := public.geo_cidade_do_ponto(lat_, lng_);
  else
    begin ip_ := ip_txt::inet; exception when others then ip_ := null; end;
    if ip_ is not null then cid := public.geo_cidade_do_ip(ip_); end if;
  end if;
  if cid is not null then select * into c from public.geo_cidades where id = cid; end if;

  select jsonb_object_agg(k, left(x, 60)) into utm_limpo
    from jsonb_each_text(case when jsonb_typeof(utm_) = 'object' then utm_ else '{}'::jsonb end) e(k, x)
   where k in ('source', 'medium', 'campaign') and coalesce(x, '') <> '';

  insert into public.site_presencas (visitante, pessoa, pagina, titulo, entrada, trajeto, origem, ref, utm, dispositivo, sistema, navegador,
                                     tela, idioma, cidade, uf, bairro, local_fonte, lat, lng)
  values (visitante_, pessoa_, pag, public.site_texto(titulo_, 140), pag, jsonb_build_array(jsonb_build_object('p', pag, 't', 0)),
          case when origem_ in ('google', 'bing', 'instagram', 'facebook', 'whatsapp', 'tiktok', 'youtube', 'direto', 'interno', 'outro') then origem_ else 'outro' end,
          public.site_texto(lower(ref_), 100), utm_limpo,
          case when dispositivo_ in ('celular', 'tablet', 'computador') then dispositivo_ end,
          public.site_texto(sistema_, 40), public.site_texto(navegador_, 40),
          case when tela_ ~ '^[0-9]{2,5}x[0-9]{2,5}$' then tela_ end, public.site_texto(idioma_, 16),
          c.cidade, c.uf, case when tem_gps then null else c.bairro end,
          case when c.id is null and not tem_gps then null when tem_gps then 'gps' else 'ip' end,
          case when tem_gps then round(lat_::numeric, 3)::double precision else c.lat end,
          case when tem_gps then round(lng_::numeric, 3)::double precision else c.lng end);

  -- a limpeza: de vez em quando, as visitas de mais de 90 dias saem (em partes, sem pesar)
  if random() < 0.02 then
    delete from public.site_presencas where id in (select id from public.site_presencas where inicio_em < now() - interval '90 days' order by inicio_em limit 500);
  end if;
end $$;
comment on function public.site_presenca(text, text, text, text, jsonb, text, text, text, text, text, double precision, double precision, boolean) is 'Site (192, 194, 209): a batida de presença das páginas públicas (a cada 25 s com a aba à vista; sair_ ao esconder ou fechar). Reconhece a visita pelo código do dia e a pessoa pelo código fixo, sem guardar IP; robô (também o disfarçado) não conta. 90 dias.';
revoke execute on function public.site_presenca(text, text, text, text, jsonb, text, text, text, text, text, double precision, double precision, boolean) from public;
grant execute on function public.site_presenca(text, text, text, text, jsonb, text, text, text, text, text, double precision, double precision, boolean) to anon, authenticated;

-- ---- o painel ao vivo (igual à 196, com a recorrência) ------------------------------------------------------------------
create or replace function public.site_ao_vivo(horas_ integer default 1)
returns jsonb language plpgsql stable security definer set search_path = public set plan_cache_mode = force_custom_plan set jit = off as $$
declare
  hoje_ini timestamptz := ((now() at time zone 'America/Sao_Paulo')::date)::timestamp at time zone 'America/Sao_Paulo';
  janela interval := make_interval(hours => greatest(1, least(coalesce(horas_, 1), 24)));
  r jsonb;
begin
  if not public.eh_plataforma() then raise exception 'só a plataforma vê o site ao vivo'; end if;
  with
  periodo as materialized (select * from public.site_presencas where visto_em > now() - janela),
  trinta as materialized (select * from periodo where visto_em > now() - interval '30 minutes'),
  agora_ as materialized (select * from trinta where visto_em > now() - interval '75 seconds' and saiu_em is null),
  hoje as materialized (select * from public.site_presencas where inicio_em >= hoje_ini),
  visitas as materialized (select * from public.site_presencas where inicio_em >= hoje_ini or visto_em > now() - janela),
  ev as materialized (
    select e.visitante, e.em, e.tipo, e.pagina, e.lugar_id, t.rotulo, t.grupo, (t.grupo = 'contato' or e.tipo in ('quero_marcar', 'pedido_enviado')) as contato
      from public.site_eventos e join public.site_eventos_tipos t using (tipo)
     where e.em >= least(hoje_ini, now() - janela) - interval '1 minute' and e.tipo <> 'visita'
       and e.visitante in (select visitante from visitas)
  ),
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
  -- o desfecho de cada visita e, desde a 209, a recorrência da pessoa
  vis as materialized (
    select v.*, coalesce(a.acoes, '[]'::jsonb) as acoes, coalesce(a.contatos, 0) as contatos,
           (v.saiu_em is not null or v.visto_em <= now() - interval '75 seconds') as terminou,
           case when not (v.saiu_em is not null or v.visto_em <= now() - interval '75 seconds')
                  then case when a.ult_tipo is not null then 'contatou' else 'navegando' end
                when a.ult_tipo is not null and a.ult_em >= coalesce(v.saiu_em, v.visto_em) - interval '2 minutes' then 'saiu_' || a.ult_tipo
                when a.ult_tipo is not null then 'contatou_e_saiu'
                else 'sem_contato' end as desfecho,
           p.visitas_antes, p.ultima_antes_em,
           case when v.pessoa is null then null else p.visitas_antes = 0 end as primeira_vez,
           case when v.pessoa is null then 'desconhecida' when p.visitas_antes = 0 then 'primeira' else 'recorrente' end as recorrencia
      from visitas v left join acoes_v a on a.id = v.id
      left join lateral (select count(*) as visitas_antes, max(x.visto_em) as ultima_antes_em
                           from public.site_presencas x where v.pessoa is not null and x.pessoa = v.pessoa and x.inicio_em < v.inicio_em and x.id <> v.id) p on true
  ),
  ev30 as materialized (
    select e.visitante, e.em, e.tipo, e.pagina, e.lugar_id, t.rotulo, t.grupo
      from public.site_eventos e join public.site_eventos_tipos t using (tipo)
     where e.em > now() - janela and e.tipo not in ('visita', 'localizacao')
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
    'horas', (extract(epoch from janela) / 3600)::int,
    'no_periodo', (select count(*) from periodo),
    'minutos', (select coalesce(jsonb_agg(jsonb_build_object('m', m, 'n', n) order by m), '[]'::jsonb) from minutos),
    'ativos', (select coalesce(jsonb_agg(to_jsonb(a) - 'visitante' - 'pessoa' - 'terminou' order by a.visto_em desc), '[]'::jsonb)
                 from (select * from vis where id in (select id from agora_) order by visto_em desc limit 200) a),
    'recentes', (select coalesce(jsonb_agg(to_jsonb(a) - 'visitante' - 'pessoa' - 'terminou' order by a.visto_em desc), '[]'::jsonb)
                   from (select * from vis where id in (select id from periodo) and id not in (select id from agora_)
                          order by visto_em desc limit 500) a),
    -- 209: a recorrência de quem passou no período (todas as visitas dele, também as que a lista corta em 500)
    'recorrencia', (select jsonb_build_object('primeira', count(*) filter (where recorrencia = 'primeira'), 'recorrente', count(*) filter (where recorrencia = 'recorrente'),
                                              'desconhecida', count(*) filter (where recorrencia = 'desconhecida'))
                      from vis where id in (select id from periodo)),
    'paginas_agora', (select coalesce(jsonb_agg(jsonb_build_object('pagina', x.pagina, 'titulo', x.titulo, 'n', x.n) order by x.n desc, x.pagina), '[]'::jsonb)
                        from (select pagina, max(titulo) as titulo, count(*) as n from agora_ group by pagina order by count(*) desc limit 10) x),
    'origens', (select coalesce(jsonb_agg(jsonb_build_object('origem', x.origem, 'n', x.n) order by x.n desc), '[]'::jsonb)
                  from (select coalesce(origem, 'outro') as origem, count(*) as n from periodo group by 1) x),
    'dispositivos', (select coalesce(jsonb_agg(jsonb_build_object('dispositivo', x.d, 'n', x.n) order by x.n desc), '[]'::jsonb)
                       from (select coalesce(dispositivo, 'outro') as d, count(*) as n from periodo group by 1) x),
    'cidades', (select coalesce(jsonb_agg(jsonb_build_object('cidade', x.cidade, 'uf', x.uf, 'n', x.n, 'gps', x.gps) order by x.n desc), '[]'::jsonb)
                  from (select cidade, uf, count(*) as n, count(*) filter (where local_fonte = 'gps') as gps from periodo where cidade is not null
                         group by cidade, uf order by count(*) desc limit 12) x),
    'acoes_recentes', (select coalesce(jsonb_agg(x.o order by x.em desc), '[]'::jsonb) from (
        select e.em, jsonb_build_object('em', e.em, 'tipo', e.tipo, 'rotulo', e.rotulo, 'grupo', e.grupo, 'pagina', e.pagina, 'lugar', l.nome,
                                        'dispositivo', p.dispositivo, 'cidade', p.cidade, 'uf', p.uf, 'local_fonte', p.local_fonte, 'visita', p.id) as o
          from (select * from ev30 order by em desc limit 100) e
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
                                   group by pagina order by count(*) desc limit 8) x),
      -- 209: quantas visitas de hoje são de gente nova e quantas de quem voltou
      'primeira', (select count(*) from vis where inicio_em >= hoje_ini and recorrencia = 'primeira'),
      'recorrente', (select count(*) from vis where inicio_em >= hoje_ini and recorrencia = 'recorrente')),
    'geo', (select jsonb_build_object('carregado_em', g.carregado_em, 'versao', g.versao, 'faixas', g.faixas) from public.geo_ip_carga g where g.id = 1)
  ) into r;
  return r;
end $$;
comment on function public.site_ao_vivo(integer) is 'Site (192, 193, 196, 209): quem está no site agora, quem passou no período (1 a 24 horas, com as ações, o desfecho e a recorrência de cada visita), as últimas ações, os últimos 30 minutos e o resumo de hoje. Só a Plataforma.';
revoke execute on function public.site_ao_vivo(integer) from public, anon;
grant execute on function public.site_ao_vivo(integer) to authenticated;

-- ---- o histórico: as visitas de um período ------------------------------------------------------------------------------
-- de_/ate_: datas (Brasília), até 90 dias, ate_ no máximo hoje; sem nada, os últimos 7 dias. recorrencia_: todas, primeira,
-- recorrente ou desconhecida. so_contato_: só quem tocou em contato. origem_/dispositivo_/cidade_: iguais aos do painel.
-- pagina_: um pedaço do caminho ou do título. limite_/pular_: a lista em páginas (até 200). so_lista_: só a lista (ao
-- pedir "mostrar mais", o resumo não é recalculado).
create or replace function public.site_visitas(
  de_ date default null,
  ate_ date default null,
  recorrencia_ text default 'todas',
  so_contato_ boolean default false,
  origem_ text default null,
  dispositivo_ text default null,
  cidade_ text default null,
  pagina_ text default null,
  limite_ integer default 50,
  pular_ integer default 0,
  so_lista_ boolean default false
) returns jsonb
language plpgsql stable security definer set search_path = public set plan_cache_mode = force_custom_plan set jit = off as $$
declare
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  ate date := least(coalesce(ate_, hoje), hoje);
  de date;
  de_ini timestamptz; ate_fim timestamptz;
  lim integer := greatest(1, least(coalesce(limite_, 50), 200));
  pul integer := greatest(0, coalesce(pular_, 0));
  rec text := case when recorrencia_ in ('primeira', 'recorrente', 'desconhecida') then recorrencia_ else 'todas' end;
  busca text := nullif(lower(btrim(coalesce(pagina_, ''))), '');
  r jsonb;
begin
  if not public.eh_plataforma() then raise exception 'só a plataforma vê o histórico do site'; end if;
  de := coalesce(de_, ate - 6);
  if de > ate then de := ate; end if;
  if de < ate - 89 then de := ate - 89; end if;
  de_ini := de::timestamp at time zone 'America/Sao_Paulo';
  ate_fim := (ate + 1)::timestamp at time zone 'America/Sao_Paulo';
  with
  base as materialized (select * from public.site_presencas where inicio_em >= de_ini and inicio_em < ate_fim),
  ev as materialized (
    select e.visitante, e.em, e.tipo, e.pagina, e.lugar_id, t.rotulo, t.grupo, (t.grupo = 'contato' or e.tipo in ('quero_marcar', 'pedido_enviado')) as contato
      from public.site_eventos e join public.site_eventos_tipos t using (tipo)
     where e.em >= de_ini - interval '1 minute' and e.em < ate_fim + interval '1 day' and e.tipo <> 'visita'
       and e.visitante in (select visitante from base)
  ),
  acoes_v as materialized (
    select v.id,
           jsonb_agg(jsonb_build_object('tipo', e.tipo, 'rotulo', e.rotulo, 'grupo', e.grupo, 'em', e.em, 'pagina', e.pagina, 'lugar', l.nome,
                                        't', greatest(0, round(extract(epoch from e.em - v.inicio_em)))::int) order by e.em) as acoes,
           (array_agg(e.tipo order by e.em desc) filter (where e.contato))[1] as ult_tipo,
           max(e.em) filter (where e.contato) as ult_em,
           count(*) filter (where e.contato) as contatos
      from base v
      join ev e on e.visitante = v.visitante and e.em between v.inicio_em - interval '1 minute' and v.visto_em + interval '2 minutes'
      left join public.guia_lugares l on l.id = e.lugar_id
     group by v.id
  ),
  vis as materialized (
    select v.*, coalesce(a.acoes, '[]'::jsonb) as acoes, coalesce(a.contatos, 0) as contatos,
           (v.saiu_em is not null or v.visto_em <= now() - interval '75 seconds') as terminou,
           case when not (v.saiu_em is not null or v.visto_em <= now() - interval '75 seconds')
                  then case when a.ult_tipo is not null then 'contatou' else 'navegando' end
                when a.ult_tipo is not null and a.ult_em >= coalesce(v.saiu_em, v.visto_em) - interval '2 minutes' then 'saiu_' || a.ult_tipo
                when a.ult_tipo is not null then 'contatou_e_saiu'
                else 'sem_contato' end as desfecho,
           round(extract(epoch from v.visto_em - v.inicio_em))::int as duracao_s,
           p.visitas_antes, p.ultima_antes_em,
           case when v.pessoa is null then null else p.visitas_antes = 0 end as primeira_vez,
           case when v.pessoa is null then 'desconhecida' when p.visitas_antes = 0 then 'primeira' else 'recorrente' end as recorrencia
      from base v left join acoes_v a on a.id = v.id
      left join lateral (select count(*) as visitas_antes, max(x.visto_em) as ultima_antes_em
                           from public.site_presencas x where v.pessoa is not null and x.pessoa = v.pessoa and x.inicio_em < v.inicio_em and x.id <> v.id) p on true
  ),
  sel as materialized (
    select * from vis v
     where (rec = 'todas' or v.recorrencia = rec)
       and (not coalesce(so_contato_, false) or v.contatos > 0)
       and (origem_ is null or coalesce(v.origem, 'outro') = origem_)
       and (dispositivo_ is null or coalesce(v.dispositivo, 'outro') = dispositivo_)
       and (cidade_ is null or v.cidade = cidade_)
       and (busca is null or v.pagina like '%' || busca || '%' or v.entrada like '%' || busca || '%' or lower(coalesce(v.titulo, '')) like '%' || busca || '%'
            or exists (select 1 from jsonb_array_elements(v.trajeto) t where (t ->> 'p') like '%' || busca || '%'))
  ),
  dias as (select d::date as dia from generate_series(de, ate, interval '1 day') d)
  select jsonb_build_object(
    'de', de, 'ate', ate, 'agora', now(), 'hoje', hoje,
    'total', (select count(*) from sel),
    'visitas', (select coalesce(jsonb_agg(to_jsonb(a) - 'visitante' - 'pessoa' order by a.inicio_em desc), '[]'::jsonb)
                  from (select * from sel order by inicio_em desc limit lim offset pul) a),
    'resumo', case when coalesce(so_lista_, false) then null else jsonb_build_object(
      'visitas', (select count(*) from sel),
      'pessoas', (select count(distinct pessoa) from sel where pessoa is not null),
      'sem_pessoa', (select count(*) from sel where pessoa is null),
      'primeira', (select count(*) from sel where recorrencia = 'primeira'),
      'recorrente', (select count(*) from sel where recorrencia = 'recorrente'),
      'desconhecida', (select count(*) from sel where recorrencia = 'desconhecida'),
      'volta_media_dias', (select round(avg(extract(epoch from inicio_em - ultima_antes_em)) / 86400, 1) from sel where recorrencia = 'recorrente' and ultima_antes_em is not null),
      'com_contato', (select count(*) from sel where contatos > 0),
      'provaveis', (select count(*) from sel where desfecho in ('saiu_whatsapp', 'saiu_ligar', 'saiu_mapa', 'saiu_agendar_mimo', 'saiu_pedido_enviado')),
      'terminadas', (select count(*) from sel where terminou),
      'paginas', (select coalesce(sum(paginas), 0) from sel),
      'tempo_medio_s', (select coalesce(round(avg(duracao_s))::int, 0) from sel),
      'por_dia', (select coalesce(jsonb_agg(jsonb_build_object('dia', d.dia, 'n', coalesce(c.n, 0), 'primeira', coalesce(c.pr, 0), 'recorrente', coalesce(c.re, 0), 'contato', coalesce(c.ct, 0)) order by d.dia), '[]'::jsonb)
                    from dias d left join (select (inicio_em at time zone 'America/Sao_Paulo')::date as dd, count(*) as n, count(*) filter (where recorrencia = 'primeira') as pr,
                                                  count(*) filter (where recorrencia = 'recorrente') as re, count(*) filter (where contatos > 0) as ct
                                             from sel group by 1) c on c.dd = d.dia),
      'por_hora', (select jsonb_agg(jsonb_build_object('h', h, 'n', coalesce(c.n, 0)) order by h)
                     from generate_series(0, 23) h
                     left join (select extract(hour from inicio_em at time zone 'America/Sao_Paulo')::int as hh, count(*) as n from sel group by 1) c on c.hh = h),
      'por_dia_semana', (select jsonb_agg(jsonb_build_object('d', d, 'n', coalesce(c.n, 0)) order by d)
                           from generate_series(0, 6) d
                           left join (select extract(dow from inicio_em at time zone 'America/Sao_Paulo')::int as dw, count(*) as n from sel group by 1) c on c.dw = d),
      'origens', (select coalesce(jsonb_agg(jsonb_build_object('origem', x.origem, 'n', x.n) order by x.n desc), '[]'::jsonb)
                    from (select coalesce(origem, 'outro') as origem, count(*) as n from sel group by 1) x),
      'dispositivos', (select coalesce(jsonb_agg(jsonb_build_object('dispositivo', x.d, 'n', x.n) order by x.n desc), '[]'::jsonb)
                         from (select coalesce(dispositivo, 'outro') as d, count(*) as n from sel group by 1) x),
      'navegadores', (select coalesce(jsonb_agg(jsonb_build_object('navegador', x.b, 'n', x.n) order by x.n desc), '[]'::jsonb)
                        from (select coalesce(navegador, 'outro') as b, count(*) as n from sel group by 1 order by count(*) desc limit 8) x),
      'cidades', (select coalesce(jsonb_agg(jsonb_build_object('cidade', x.cidade, 'uf', x.uf, 'n', x.n, 'gps', x.gps) order by x.n desc), '[]'::jsonb)
                    from (select cidade, uf, count(*) as n, count(*) filter (where local_fonte = 'gps') as gps from sel where cidade is not null group by cidade, uf order by count(*) desc limit 12) x),
      'entradas', (select coalesce(jsonb_agg(jsonb_build_object('pagina', x.entrada, 'titulo', x.titulo, 'n', x.n) order by x.n desc), '[]'::jsonb)
                     from (select entrada, max(titulo) filter (where entrada = pagina) as titulo, count(*) as n from sel group by entrada order by count(*) desc limit 10) x),
      'paginas_vistas', (select coalesce(jsonb_agg(jsonb_build_object('pagina', x.p, 'n', x.n) order by x.n desc), '[]'::jsonb)
                           from (select t ->> 'p' as p, count(*) as n from sel s, jsonb_array_elements(s.trajeto) t group by 1 order by count(*) desc limit 10) x),
      'acoes', (select coalesce(jsonb_agg(jsonb_build_object('tipo', x.tipo, 'rotulo', x.rotulo, 'grupo', x.grupo, 'n', x.n) order by x.n desc), '[]'::jsonb)
                  from (select a ->> 'tipo' as tipo, max(a ->> 'rotulo') as rotulo, max(a ->> 'grupo') as grupo, count(*) as n
                          from sel s, jsonb_array_elements(s.acoes) a where (a ->> 'tipo') <> 'localizacao' group by 1) x),
      'saloes', (select coalesce(jsonb_agg(jsonb_build_object('lugar', x.nome, 'n', x.n, 'whatsapp', x.w, 'pedidos', x.p) order by x.n desc), '[]'::jsonb)
                   from (select a ->> 'lugar' as nome, count(*) filter (where (a ->> 'tipo') <> 'pedido_enviado') as n, count(*) filter (where (a ->> 'tipo') = 'whatsapp') as w,
                                count(*) filter (where (a ->> 'tipo') = 'pedido_enviado') as p
                           from sel s, jsonb_array_elements(s.acoes) a
                          where (a ->> 'lugar') is not null and ((a ->> 'grupo') = 'contato' or (a ->> 'tipo') in ('quero_marcar', 'pedido_enviado'))
                          group by 1 order by 2 desc limit 10) x),
      'desfechos', (select coalesce(jsonb_agg(jsonb_build_object('desfecho', x.desfecho, 'n', x.n) order by x.n desc), '[]'::jsonb)
                      from (select desfecho, count(*) as n from sel where terminou group by desfecho) x),
      'saidas_sem_contato', (select coalesce(jsonb_agg(jsonb_build_object('pagina', x.pagina, 'titulo', x.titulo, 'n', x.n) order by x.n desc), '[]'::jsonb)
                            from (select pagina, max(titulo) as titulo, count(*) as n from sel where desfecho = 'sem_contato' group by pagina order by count(*) desc limit 8) x)
    ) end
  ) into r;
  return r;
end $$;
comment on function public.site_visitas(date, date, text, boolean, text, text, text, text, integer, integer, boolean) is 'Site (209): o histórico do site num período de até 90 dias (datas em Brasília): o resumo (visitas, pessoas, novas e recorrentes, contato, prováveis agendamentos, por dia, por hora, origens, aparelhos, cidades, entradas, toques, salões, desfechos) e a lista paginada com entrada, saída, duração, ações, desfecho e recorrência. Só a Plataforma.';
revoke execute on function public.site_visitas(date, date, text, boolean, text, text, text, text, integer, integer, boolean) from public, anon;
grant execute on function public.site_visitas(date, date, text, boolean, text, text, text, text, integer, integer, boolean) to authenticated;

insert into public.migracoes_aplicadas (arquivo) values ('209_site_historico.sql') on conflict (arquivo) do nothing;
do $$
begin
  raise notice '209: site_presencas.pessoa (o código fixo, tempero em site_segredo), 90 dias, site_ao_vivo com a recorrência, site_visitas (o histórico por período)';
end $$;
