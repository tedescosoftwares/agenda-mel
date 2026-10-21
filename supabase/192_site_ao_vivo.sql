-- 192 (3.44): o site ao vivo — quem está no site agora, de onde veio, com que aparelho, em que cidade e o caminho que fez.
--
-- O site manda uma batida a cada 25 s enquanto a aba está aberta e à vista (site_presenca), e uma ao sair ou esconder a
-- aba. Nada fica no aparelho de quem visita (o aviso do site promete): a visita é reconhecida aqui pelo mesmo código do
-- dia de site_evento (156: o sal do dia + o IP + o navegador, num hash que não identifica ninguém e muda todo dia). Uma
-- visita é uma linha de site_presencas: a página de entrada, a de agora, o trajeto (até 40 passos), a origem (Google,
-- Instagram, WhatsApp, direto...), as campanhas (utm), o aparelho, o sistema, o navegador, a tela, o idioma e a cidade.
--
-- A cidade: quem autorizou a localização no "Perto de você" (163) manda a posição, arredondada; a cidade é a mais perto
-- dela (local_fonte = 'gps'). Quem não autorizou fica com a cidade aproximada pelo IP (local_fonte = 'ip'), pela base
-- DB-IP Lite (db-ip.com, CC BY 4.0) só do Brasil, carregada pelo aplicar.sh (supabase/geo-ip.sh). O IP é usado na hora
-- e não é guardado em lugar nenhum. A cidade pelo IP é aproximada: no celular, a operadora costuma aparecer na capital
-- ou na cidade-polo.
--
-- A Plataforma lê site_ao_vivo(): quem está no site agora (batida nos últimos 75 s e sem ter saído), a contagem minuto a
-- minuto dos últimos 30, as páginas, origens, aparelhos e cidades, e o resumo de hoje. As visitas ficam 30 dias.

-- ---- a base de IP (só o Brasil) -----------------------------------------------------------------------------------
create table if not exists public.geo_cidades (
  id integer primary key,
  uf text not null,
  cidade text not null,
  bairro text,             -- a base às vezes traz o bairro: "Goiânia (Setor Bueno)"
  lat double precision,
  lng double precision
);
create table if not exists public.geo_ip_br (
  inicio inet primary key, -- a faixa [inicio, fim]; a busca é o maior inicio <= ip (o índice da chave, de trás para frente)
  fim inet not null,
  cidade_id integer not null
);
create table if not exists public.geo_ip_carga (
  id integer primary key default 1 check (id = 1),
  versao text,
  carregado_em timestamptz,
  faixas integer,
  cidades integer
);
comment on table public.geo_ip_br is 'Site (192): faixas de IP do Brasil e a cidade aproximada (DB-IP Lite, db-ip.com, CC BY 4.0), carregadas por supabase/geo-ip.sh. O IP de quem visita nunca é guardado.';
alter table public.geo_cidades enable row level security;
alter table public.geo_ip_br enable row level security;
alter table public.geo_ip_carga enable row level security;
revoke all on public.geo_cidades, public.geo_ip_br, public.geo_ip_carga from public, anon, authenticated;

-- a cidade (id em geo_cidades) de um IP; null fora do Brasil, IP inválido ou base vazia
create or replace function public.geo_cidade_do_ip(ip_ inet)
returns integer language sql stable set search_path = public as $$
  select g.cidade_id
    from (select * from public.geo_ip_br where inicio <= ip_ order by inicio desc limit 1) g
   where g.fim >= ip_ and family(g.inicio) = family(ip_)
$$;
revoke execute on function public.geo_cidade_do_ip(inet) from public, anon, authenticated;

-- a cidade mais perto de um ponto (a posição de quem autorizou a localização); só cidade, sem bairro
create or replace function public.geo_cidade_do_ponto(lat_ double precision, lng_ double precision)
returns integer language sql stable set search_path = public as $$
  select c.id from public.geo_cidades c
   where c.lat between lat_ - 0.6 and lat_ + 0.6 and c.lng between lng_ - 0.6 and lng_ + 0.6
   order by c.bairro is not null, (c.lat - lat_) ^ 2 + ((c.lng - lng_) * cos(radians(lat_))) ^ 2
   limit 1
$$;
revoke execute on function public.geo_cidade_do_ponto(double precision, double precision) from public, anon, authenticated;

-- ---- as visitas -----------------------------------------------------------------------------------------------------
create table if not exists public.site_presencas (
  id bigserial primary key,
  visitante text not null,           -- o código do dia (156); não identifica ninguém
  inicio_em timestamptz not null default now(),
  visto_em timestamptz not null default now(),
  saiu_em timestamptz,               -- escondeu a aba ou fechou; volta a null se ela voltar
  pagina text not null,
  titulo text,
  entrada text not null,
  paginas integer not null default 1,
  trajeto jsonb not null default '[]'::jsonb, -- [{ "p": "/saloes/itanhaem", "t": 0 }, ...] (t: segundos desde a entrada)
  origem text,
  ref text,
  utm jsonb,
  dispositivo text,
  sistema text,
  navegador text,
  tela text,
  idioma text,
  cidade text,
  uf text,
  bairro text,
  local_fonte text check (local_fonte in ('gps', 'ip')),
  lat double precision,
  lng double precision
);
comment on table public.site_presencas is 'Site (192): uma linha por visita ao site (página de entrada, de agora, trajeto, origem, aparelho, cidade por GPS ou IP). Sem IP; o visitante é o código do dia de site_evento. 30 dias.';
create index if not exists site_presencas_visto on public.site_presencas (visto_em desc);
create index if not exists site_presencas_visitante on public.site_presencas (visitante, visto_em desc);
create index if not exists site_presencas_inicio on public.site_presencas (inicio_em);
alter table public.site_presencas enable row level security; -- sem política: só as funções do banco mexem
revoke all on public.site_presencas from public, anon, authenticated;

-- texto curto e limpo (o que vem do navegador não é confiável)
create or replace function public.site_texto(t text, n integer)
returns text language sql immutable as $$
  select nullif(left(regexp_replace(btrim(coalesce(t, '')), '[[:cntrl:]<>"]', '', 'g'), n), '')
$$;

-- ---- a batida (anônima) --------------------------------------------------------------------------------------------
-- pagina_: o caminho (só as páginas públicas). sair_: escondeu a aba ou fechou. lat_/lng_: a posição de quem autorizou
-- a localização no guia (arredondada no aparelho). O resto descreve a visita e só conta na primeira batida.
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
  sal_ text; visitante_ text;
  pag text; v public.site_presencas; cid integer; c public.geo_cidades;
  utm_limpo jsonb; tem_gps boolean;
begin
  -- a página: caminho limpo, minúsculo, só as públicas
  pag := lower(split_part(split_part(coalesce(pagina_, ''), '?', 1), '#', 1));
  if length(pag) > 1 then pag := rtrim(pag, '/'); end if;
  if pag !~ '^/[a-z0-9/_.-]{0,200}$' then return; end if;
  if pag ~ '^/(cliente|pro|admin|plataforma|login|onboarding|bem-vinda|avisos|comecar|ativar|equipe|convite|v|entrar|cadastro|email-confirmado|splash|estilo|sessao-app)(/|$)' then return; end if;

  -- robô e ferramenta não contam (o mesmo filtro de site_evento)
  begin cab := current_setting('request.headers', true)::jsonb; exception when others then cab := null; end;
  ua := coalesce(cab ->> 'user-agent', '');
  if ua = '' or ua ~* '(bot|crawler|spider)[/;)+]|crawl|spider|slurp|preview|headless|lighthouse|pagespeed|gtmetrix|pingdom|uptime|google-|adsbot|mediapartners|^curl|^wget|python-|axios/|node-fetch|go-http|okhttp|postman|phantomjs|selenium|playwright|puppeteer' then
    return;
  end if;
  ip_txt := coalesce(nullif(cab ->> 'cf-connecting-ip', ''), nullif(cab ->> 'x-real-ip', ''), nullif(btrim(split_part(coalesce(cab ->> 'x-forwarded-for', ''), ',', 1)), ''), '');

  -- o código do dia, como em site_evento (o sal de hoje nasce aqui também, se ainda não nasceu)
  insert into public.site_sal (dia) values (hoje) on conflict (dia) do nothing;
  if found then delete from public.site_sal where dia < hoje; end if;
  select sal into sal_ from public.site_sal where dia = hoje;
  visitante_ := left(encode(sha256(convert_to(coalesce(sal_, '') || '|' || ip_txt || '|' || ua, 'UTF8')), 'hex'), 16);

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

  insert into public.site_presencas (visitante, pagina, titulo, entrada, trajeto, origem, ref, utm, dispositivo, sistema, navegador,
                                     tela, idioma, cidade, uf, bairro, local_fonte, lat, lng)
  values (visitante_, pag, public.site_texto(titulo_, 140), pag, jsonb_build_array(jsonb_build_object('p', pag, 't', 0)),
          case when origem_ in ('google', 'bing', 'instagram', 'facebook', 'whatsapp', 'tiktok', 'youtube', 'direto', 'interno', 'outro') then origem_ else 'outro' end,
          public.site_texto(lower(ref_), 100), utm_limpo,
          case when dispositivo_ in ('celular', 'tablet', 'computador') then dispositivo_ end,
          public.site_texto(sistema_, 40), public.site_texto(navegador_, 40),
          case when tela_ ~ '^[0-9]{2,5}x[0-9]{2,5}$' then tela_ end, public.site_texto(idioma_, 16),
          c.cidade, c.uf, case when tem_gps then null else c.bairro end,
          case when c.id is null and not tem_gps then null when tem_gps then 'gps' else 'ip' end,
          case when tem_gps then round(lat_::numeric, 3)::double precision else c.lat end,
          case when tem_gps then round(lng_::numeric, 3)::double precision else c.lng end);

  -- a limpeza: de vez em quando, as visitas de mais de 30 dias saem (em partes, sem pesar)
  if random() < 0.02 then
    delete from public.site_presencas where id in (select id from public.site_presencas where inicio_em < now() - interval '30 days' order by inicio_em limit 500);
  end if;
end $$;
comment on function public.site_presenca(text, text, text, text, jsonb, text, text, text, text, text, double precision, double precision, boolean) is 'Site (192): a batida de presença das páginas públicas (a cada 25 s com a aba à vista; sair_ ao esconder ou fechar). Reconhece a visita pelo código do dia, sem guardar IP.';
revoke execute on function public.site_presenca(text, text, text, text, jsonb, text, text, text, text, text, double precision, double precision, boolean) from public;
grant execute on function public.site_presenca(text, text, text, text, jsonb, text, text, text, text, text, double precision, double precision, boolean) to anon, authenticated;

-- ---- o painel da Plataforma ----------------------------------------------------------------------------------------
-- agora: batida nos últimos 75 s e sem ter saído. recentes: quem saiu (ou parou de bater) nos últimos 10 minutos.
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
  minutos as (
    select m, (select count(*) from trinta t where t.inicio_em < m + interval '1 minute' and t.visto_em >= m) as n
      from generate_series(date_trunc('minute', now()) - interval '29 minutes', date_trunc('minute', now()), interval '1 minute') m
  )
  select jsonb_build_object(
    'agora', now(),
    'no_site', (select count(*) from agora_),
    'ultimos_30', (select count(*) from trinta),
    'minutos', (select coalesce(jsonb_agg(jsonb_build_object('m', m, 'n', n) order by m), '[]'::jsonb) from minutos),
    'ativos', (select coalesce(jsonb_agg(to_jsonb(a) - 'visitante' order by a.visto_em desc), '[]'::jsonb) from (select * from agora_ order by visto_em desc limit 200) a),
    'recentes', (select coalesce(jsonb_agg(to_jsonb(a) - 'visitante' order by a.visto_em desc), '[]'::jsonb)
                   from (select * from trinta where not (visto_em > now() - interval '75 seconds' and saiu_em is null) and visto_em > now() - interval '10 minutes'
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
    'hoje', jsonb_build_object(
      'visitas', (select count(*) from hoje),
      'paginas', (select coalesce(sum(paginas), 0) from hoje),
      'tempo_medio_s', (select coalesce(round(avg(extract(epoch from visto_em - inicio_em)))::int, 0) from hoje),
      'por_hora', (select coalesce(jsonb_agg(jsonb_build_object('h', h, 'n', (select count(*) from hoje where extract(hour from inicio_em at time zone 'America/Sao_Paulo') = h)) order by h), '[]'::jsonb)
                     from generate_series(0, 23) h),
      'origens', (select coalesce(jsonb_agg(jsonb_build_object('origem', x.origem, 'n', x.n) order by x.n desc), '[]'::jsonb)
                    from (select coalesce(origem, 'outro') as origem, count(*) as n from hoje group by 1) x),
      'dispositivos', (select coalesce(jsonb_agg(jsonb_build_object('dispositivo', x.d, 'n', x.n) order by x.n desc), '[]'::jsonb)
                         from (select coalesce(dispositivo, 'outro') as d, count(*) as n from hoje group by 1) x),
      'navegadores', (select coalesce(jsonb_agg(jsonb_build_object('navegador', x.b, 'n', x.n) order by x.n desc), '[]'::jsonb)
                        from (select coalesce(navegador, 'outro') as b, count(*) as n from hoje group by 1 order by count(*) desc limit 8) x),
      'cidades', (select coalesce(jsonb_agg(jsonb_build_object('cidade', x.cidade, 'uf', x.uf, 'n', x.n) order by x.n desc), '[]'::jsonb)
                    from (select cidade, uf, count(*) as n from hoje where cidade is not null group by cidade, uf order by count(*) desc limit 12) x),
      'entradas', (select coalesce(jsonb_agg(jsonb_build_object('pagina', x.entrada, 'n', x.n) order by x.n desc), '[]'::jsonb)
                     from (select entrada, count(*) as n from hoje group by entrada order by count(*) desc limit 10) x)),
    'geo', (select jsonb_build_object('carregado_em', g.carregado_em, 'versao', g.versao, 'faixas', g.faixas) from public.geo_ip_carga g where g.id = 1)
  ) into r;
  return r;
end $$;
comment on function public.site_ao_vivo() is 'Site (192): quem está no site agora, os últimos 30 minutos minuto a minuto, páginas, origens, aparelhos, cidades e o resumo de hoje. Só a Plataforma.';
revoke execute on function public.site_ao_vivo() from public, anon;
grant execute on function public.site_ao_vivo() to authenticated;

do $$
begin
  raise notice '192: site_presencas, site_presenca() (a batida do site), site_ao_vivo() (a Plataforma), geo_ip_br (a cidade pelo IP: carregada pelo aplicar.sh)';
end $$;
