-- 156: as métricas do site (3.11), começando pelo guia de salões.
--
-- Quantas visitas cada página teve e quantas pessoas tocaram em WhatsApp,
-- Ligar, Como chegar, Instagram, site, "Quero marcar"... por dia, por
-- origem (Google, direto, de dentro do site, Instagram) e por aparelho.
--
-- Sem rastreio, como o aviso do site promete: nada de cookie, nada guardado
-- no aparelho de quem visita, IP nunca gravado. Para contar visitantes, o
-- banco faz um código do dia com IP + navegador + um sal sorteado naquele
-- dia; o sal é apagado no dia seguinte, então o código não identifica
-- ninguém e não junta a mesma pessoa de um dia para o outro.
--
-- Para evoluir sem mexer em código:
--   - site_eventos_tipos: um tipo novo de evento é uma linha nova aqui
--     (o site manda, o banco aceita e o painel da Plataforma já mostra);
--   - site_eventos guarda a página por caminho, então o blog e as outras
--     páginas do site podem entrar depois, na mesma tabela;
--   - dados (jsonb) leva o que um evento novo precisar.
-- Robô (Googlebot, ferramentas de teste) não conta. Uma visita à mesma
-- página pelo mesmo visitante em 30 minutos conta uma vez (duas visitas
-- seguidas ou dois toques no WhatsApp são um só); mais de 40 eventos por
-- minuto do mesmo visitante são ignorados. O que passa de
-- 400 dias é apagado sozinho quando a Plataforma abre o painel.
-- Idempotente.

-- ---- os tipos de evento ----------------------------------------------------------------
create table if not exists public.site_eventos_tipos (
  tipo text primary key,
  rotulo text not null,
  grupo text not null,                    -- visita | contato | interesse | outro
  ordem integer not null default 100,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  constraint site_eventos_tipos_tipo_ok check (tipo ~ '^[a-z][a-z0-9_]{1,39}$'),
  constraint site_eventos_tipos_grupo_ok check (grupo in ('visita', 'contato', 'interesse', 'outro'))
);
comment on table public.site_eventos_tipos is 'Métricas (156): os tipos de evento que o site pode mandar. Tipo novo = linha nova; o painel mostra sozinho.';

insert into public.site_eventos_tipos (tipo, rotulo, grupo, ordem) values
  ('visita', 'Visitas', 'visita', 10),
  ('whatsapp', 'WhatsApp', 'contato', 20),
  ('ligar', 'Ligar', 'contato', 30),
  ('agendar_mimo', 'Agendar pela MIMO', 'contato', 35),
  ('mapa', 'Como chegar', 'contato', 40),
  ('instagram', 'Instagram', 'contato', 50),
  ('site', 'Site', 'contato', 60),
  ('email', 'E-mail', 'contato', 65),
  ('quero_marcar', 'Quero marcar', 'interesse', 70),
  ('sou_dono', 'É o dono', 'interesse', 80),
  ('criar_agenda', 'Criar agenda', 'interesse', 85),
  ('compartilhar', 'Compartilhar', 'outro', 90),
  ('corrigir', 'Corrigir dados', 'outro', 95)
on conflict (tipo) do nothing;

-- ---- os eventos --------------------------------------------------------------------------
create table if not exists public.site_eventos (
  id bigint generated always as identity primary key,
  em timestamptz not null default now(),
  tipo text not null references public.site_eventos_tipos (tipo) on update cascade,
  pagina text not null,                   -- '/saloes/itanhaem/studio-lirio'
  lugar_id uuid references public.guia_lugares (id) on delete set null,
  cidade_slug text,
  categoria text,
  visitante text,                         -- código do dia; não identifica ninguém e muda todo dia
  origem text not null default 'direto',  -- google, bing, instagram, facebook, whatsapp, tiktok, interno, direto, outro
  ref_host text,                          -- só o domínio de onde veio (www.google.com)
  aparelho text,                          -- celular | computador
  area text,                              -- onde, na página, foi o clique (heroi, fatos, barra...)
  utm jsonb,
  dados jsonb not null default '{}'::jsonb,
  constraint site_eventos_aparelho_ok check (aparelho is null or aparelho in ('celular', 'computador'))
);
comment on table public.site_eventos is 'Métricas (156): uma linha por visita ou clique. Sem IP, sem cookie. Só a Plataforma lê; o site grava por site_evento().';
create index if not exists site_eventos_em on public.site_eventos (em);
create index if not exists site_eventos_lugar on public.site_eventos (lugar_id, em) where lugar_id is not null;
create index if not exists site_eventos_pagina on public.site_eventos (pagina, em);
create index if not exists site_eventos_visitante on public.site_eventos (visitante, em);

-- o sal do dia (só dentro do banco; o de ontem some quando o de hoje nasce)
create table if not exists public.site_sal (
  dia date primary key,
  sal text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
);

alter table public.site_eventos_tipos enable row level security;
alter table public.site_eventos enable row level security;
alter table public.site_sal enable row level security;
drop policy if exists site_eventos_tipos_plataforma on public.site_eventos_tipos;
create policy site_eventos_tipos_plataforma on public.site_eventos_tipos for all to authenticated
  using (public.eh_plataforma()) with check (public.eh_plataforma());
drop policy if exists site_eventos_plataforma on public.site_eventos;
create policy site_eventos_plataforma on public.site_eventos for select to authenticated
  using (public.eh_plataforma());
-- site_sal: nenhuma policy; ninguém de fora lê nem escreve
revoke all on public.site_eventos, public.site_eventos_tipos, public.site_sal from anon;
revoke all on public.site_sal from authenticated;

-- ---- gravar um evento (o site chama, sem login) ------------------------------------------
create or replace function public.site_evento(
  tipo_ text,
  pagina_ text,
  origem_ text default null,
  ref_ text default null,
  aparelho_ text default null,
  area_ text default null,
  utm_ jsonb default null,
  dados_ jsonb default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  cab jsonb;
  ua text;
  ip text;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  sal_ text;
  visitante_ text;
  pag text;
  partes text[];
  lugar_ uuid;
  cidade_ text;
  categoria_ text;
  cats text[] := array['beleza', 'cabelo', 'unhas', 'cilios', 'sobrancelhas', 'estetica', 'maquiagem'];
  utm_limpo jsonb;
begin
  -- só tipo que existe e está ligado
  if not exists (select 1 from public.site_eventos_tipos where tipo = tipo_ and ativo) then return; end if;

  -- a página: caminho limpo, minúsculo, sem área logada
  pag := lower(split_part(split_part(coalesce(pagina_, ''), '?', 1), '#', 1));
  if length(pag) > 1 then pag := rtrim(pag, '/'); end if;
  if pag !~ '^/[a-z0-9/_-]{0,200}$' or pag ~ '^/(plataforma|pro|admin|app|cliente|entrar|login|sessao)(/|$)' then return; end if;

  -- robô e ferramenta não contam (quem não roda JavaScript nem chega aqui)
  begin cab := current_setting('request.headers', true)::jsonb; exception when others then cab := null; end;
  ua := coalesce(cab ->> 'user-agent', '');
  if ua = '' or ua ~* '(bot|crawler|spider)[/;)+]|crawl|spider|slurp|preview|headless|lighthouse|pagespeed|gtmetrix|pingdom|uptime|google-|adsbot|mediapartners|^curl|^wget|python-|axios/|node-fetch|go-http|okhttp|postman|phantomjs|selenium|playwright|puppeteer' then
    return;
  end if;
  ip := coalesce(nullif(cab ->> 'cf-connecting-ip', ''), nullif(cab ->> 'x-real-ip', ''), nullif(btrim(split_part(coalesce(cab ->> 'x-forwarded-for', ''), ',', 1)), ''), '');

  -- o sal do dia; quando o de hoje nasce, o de ontem (e antes) vai embora
  insert into public.site_sal (dia) values (hoje) on conflict (dia) do nothing;
  if found then delete from public.site_sal where dia < hoje; end if;
  select sal into sal_ from public.site_sal where dia = hoje;
  visitante_ := left(encode(sha256(convert_to(coalesce(sal_, '') || '|' || ip || '|' || ua, 'UTF8')), 'hex'), 16);

  -- quem manda demais em um minuto é ignorado
  if (select count(*) from public.site_eventos where visitante = visitante_ and em > now() - interval '1 minute') >= 40 then return; end if;
  -- o mesmo evento na mesma página pelo mesmo visitante em 30 minutos conta uma vez:
  -- recarregar não é outra visita, tocar duas vezes no WhatsApp não é outra tentativa
  if exists (select 1 from public.site_eventos where visitante = visitante_ and pagina = pag and tipo = tipo_ and em > now() - interval '30 minutes') then
    return;
  end if;

  -- de qual salão, cidade e categoria é a página (pelo caminho; nunca pelo que o navegador diz)
  partes := string_to_array(trim(both '/' from pag), '/');
  if partes[1] = 'saloes' and array_length(partes, 1) >= 2 then
    cidade_ := partes[2];
    if array_length(partes, 1) >= 3 then
      if partes[3] = any (cats) then categoria_ := partes[3];
      else
        select id, categoria into lugar_, categoria_ from public.guia_lugares where cidade_slug = partes[2] and slug = partes[3];
        if lugar_ is null then return; end if;   -- salão que não existe: não conta
      end if;
    end if;
  end if;

  -- o resto só entra limpo e curto
  if utm_ is not null and jsonb_typeof(utm_) = 'object' then
    select jsonb_object_agg(k, left(v, 60)) into utm_limpo
      from jsonb_each_text(utm_) as e(k, v) where k in ('source', 'medium', 'campaign') and v <> '';
  end if;

  insert into public.site_eventos (tipo, pagina, lugar_id, cidade_slug, categoria, visitante, origem, ref_host, aparelho, area, utm, dados)
  values (
    tipo_, pag, lugar_, cidade_, categoria_, visitante_,
    case when origem_ in ('google', 'bing', 'instagram', 'facebook', 'whatsapp', 'tiktok', 'youtube', 'interno', 'direto', 'outro') then origem_ else 'direto' end,
    case when ref_ ~ '^[a-z0-9.-]{3,100}$' then lower(ref_) end,
    case when aparelho_ in ('celular', 'computador') then aparelho_ end,
    case when area_ ~ '^[a-z_]{1,20}$' then area_ end,
    utm_limpo,
    case when dados_ is not null and jsonb_typeof(dados_) = 'object' and length(dados_::text) <= 500 then dados_ else '{}'::jsonb end
  );
end $$;
revoke execute on function public.site_evento(text, text, text, text, text, text, jsonb, jsonb) from public;
grant execute on function public.site_evento(text, text, text, text, text, text, jsonb, jsonb) to anon, authenticated;

-- ---- o painel da Plataforma: o desempenho do guia num período --------------------------------
-- dias: 7, 30, 90... (até 400). cidade_: '' = todas.
-- Devolve os tipos, os totais (e os do período anterior, para comparar),
-- visitantes (somados por dia), a série por dia, as origens, os aparelhos,
-- as áreas da página que mais geram contato e uma linha por página (salões
-- no ar aparecem mesmo sem visita, para a Plataforma ver quem não teve nenhuma).
create or replace function public.guia_desempenho(dias integer default 30, cidade_ text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  ndias integer := greatest(1, least(coalesce(dias, 30), 400));
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  de timestamptz;
  ate timestamptz;
  antes timestamptz;
  cid text := nullif(btrim(coalesce(cidade_, '')), '');
  r jsonb;
begin
  if not public.eh_plataforma() then raise exception 'só a plataforma vê o desempenho'; end if;
  -- a limpeza mora aqui: sem cron, o que passou de 400 dias some quando alguém olha
  delete from public.site_eventos where em < now() - interval '400 days';

  de := ((hoje - (ndias - 1))::timestamp) at time zone 'America/Sao_Paulo';
  ate := ((hoje + 1)::timestamp) at time zone 'America/Sao_Paulo';
  antes := de - make_interval(days => ndias);

  with ev as (
    select e.*, (e.em at time zone 'America/Sao_Paulo')::date as dia, t.grupo
      from public.site_eventos e join public.site_eventos_tipos t using (tipo)
     where e.em >= antes and e.em < ate and e.pagina like '/saloes%' and (cid is null or e.cidade_slug = cid)
  ),
  agora_ as (select * from ev where em >= de),
  int_ as (
    select i.lugar_id, i.tipo, count(*) as n
      from public.guia_interesses i join public.guia_lugares l on l.id = i.lugar_id
     where i.criado_em >= de and i.criado_em < ate and (cid is null or l.cidade_slug = cid)
     group by 1, 2
  ),
  por_tipo as (select pagina, tipo, count(*) as n from agora_ group by 1, 2),
  por_pagina as (
    select a.pagina, max(a.lugar_id::text)::uuid as lugar_id,
           count(*) filter (where a.tipo = 'visita') as visitas,
           count(distinct (a.dia, a.visitante)) filter (where a.tipo = 'visita') as visitantes,
           count(*) filter (where a.grupo = 'contato') as contatos,
           (select jsonb_object_agg(t.tipo, t.n) from por_tipo t where t.pagina = a.pagina) as eventos
      from agora_ a
     group by a.pagina
  ),
  -- as páginas que tiveram evento, mais os salões no ar que não tiveram nenhum
  paginas as (
    select p.pagina, p.lugar_id, l.nome, l.slug, l.bairro, l.status, l.whatsapp, l.telefone,
           coalesce(l.cidade_slug, split_part(trim(both '/' from p.pagina), '/', 2)) as cidade_slug,
           coalesce(l.categoria, nullif(split_part(trim(both '/' from p.pagina), '/', 3), '')) as categoria,
           p.visitas, p.visitantes, p.contatos, coalesce(p.eventos, '{}'::jsonb) as eventos,
           coalesce((select jsonb_object_agg(i.tipo, i.n) from int_ i where i.lugar_id = p.lugar_id), '{}'::jsonb) as interesses
      from por_pagina p left join public.guia_lugares l on l.id = p.lugar_id
    union all
    select '/saloes/' || l.cidade_slug || '/' || l.slug, l.id, l.nome, l.slug, l.bairro, l.status, l.whatsapp, l.telefone,
           l.cidade_slug, l.categoria, 0, 0, 0, '{}'::jsonb,
           coalesce((select jsonb_object_agg(i.tipo, i.n) from int_ i where i.lugar_id = l.id), '{}'::jsonb)
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
    'totais_antes', (select coalesce(jsonb_object_agg(tipo, c), '{}'::jsonb) from (select tipo, count(*) c from ev where em < de group by tipo) x),
    'visitantes', (select count(distinct (dia, visitante)) from agora_ where tipo = 'visita'),
    'visitantes_antes', (select count(distinct (dia, visitante)) from ev where em < de and tipo = 'visita'),
    'interesses', (select coalesce(jsonb_object_agg(tipo, s), '{}'::jsonb) from (select tipo, sum(n) s from int_ group by tipo) x),
    'por_dia', (
      select jsonb_agg(jsonb_build_object('dia', d.dia, 'visitas', coalesce(x.v, 0), 'contatos', coalesce(x.c, 0)) order by d.dia)
        from (select g::date as dia from generate_series(hoje - (ndias - 1), hoje, interval '1 day') g) d
        left join (select dia, count(*) filter (where tipo = 'visita') as v, count(*) filter (where grupo = 'contato') as c from agora_ group by dia) x using (dia)
    ),
    'origens', (select coalesce(jsonb_agg(jsonb_build_object('origem', origem, 'visitas', c) order by c desc), '[]'::jsonb)
                  from (select origem, count(*) c from agora_ where tipo = 'visita' group by origem) x),
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
declare n int;
begin
  select count(*) into n from public.site_eventos_tipos;
  raise notice '156: métricas do site prontas (% tipos de evento)', n;
end $$;
