-- 217: as métricas do app (3.73)
--
-- As clientes que usam o guia pelo app não contavam nas métricas do portal: o app não mandava nada, e se mandasse,
-- o user-agent dele (o da biblioteca de rede do Android/iOS) cairia no filtro de robô de site_evento e site_presenca.
-- Agora:
--   • site_evento e site_presenca ganham o parâmetro app_: o código da instalação do app (lib/metricas.ts no app),
--     sorteado uma vez no aparelho, sem conta, sem telefone e sem IP. Com ele, a origem é 'app', o filtro de robô
--     do user-agent não se aplica, o visitante do dia sai do código (e não do IP + navegador) e a "pessoa" (209) é a
--     instalação (o celular fora do Wi-Fi troca de IP; a instalação não). Quem se diz app sem o código não conta.
--     O resto é igual ao site: os mesmos tipos, as mesmas páginas (/saloes/...), a mesma regra de 30 minutos, os
--     mesmos tetos por rede (o IP continua só no cálculo, nunca guardado), a cidade pelo IP, 90 dias.
--   • dois tipos novos, que só existem no app: seguir (entrou na agenda do salão pelo guia; contato, como agendar_mimo)
--     e quero_na_mimo (pediu o salão na MIMO; interesse).
--   • guia_desempenho ganha origem_ ('app' | 'site' | nulo): a aba Desempenho filtra só o app ou só o site. Os pedidos
--     "quero marcar" (guia_interesses) são do formulário do site e ficam de fora quando a tela olha só o app.
-- O Histórico (site_visitas) já filtra por origem; o Ao vivo (site_ao_vivo) devolve a origem de cada visita e a
-- Plataforma filtra na tela. Nada do que já estava gravado muda.

insert into public.site_eventos_tipos (tipo, rotulo, grupo, ordem) values
  ('seguir', 'Seguiu pelo app', 'contato', 36),
  ('quero_na_mimo', 'Quer o salão na MIMO', 'interesse', 72)
on conflict (tipo) do nothing;

-- ---- gravar um evento (igual à 194, com o app) ------------------------------------------------------------------------
drop function if exists public.site_evento(text, text, text, text, text, text, jsonb, jsonb);
create or replace function public.site_evento(
  tipo_ text,
  pagina_ text,
  origem_ text default null,
  ref_ text default null,
  aparelho_ text default null,
  area_ text default null,
  utm_ jsonb default null,
  dados_ jsonb default null,
  app_ text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  cab jsonb;
  ua text;
  ip text;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  sal_ text;
  visitante_ text;
  rede_ text;
  pag text;
  partes text[];
  lugar_ uuid;
  cidade_ text;
  categoria_ text;
  cats text[] := array['beleza', 'cabelo', 'unhas', 'cilios', 'sobrancelhas', 'estetica', 'maquiagem'];
  horarios_ text[] := array['domingo', 'cedo', 'noite', 'sabado-o-dia-todo'];
  utm_limpo jsonb;
  -- 217: o código da instalação do app (lib/metricas.ts): sorteado uma vez no aparelho, sem conta, sem telefone, sem IP
  app boolean := coalesce(app_, '') ~ '^[a-z0-9]{16,64}$';
begin
  -- só tipo que existe e está ligado
  if not exists (select 1 from public.site_eventos_tipos where tipo = tipo_ and ativo) then return; end if;

  -- a página: caminho limpo, minúsculo, sem área logada
  pag := lower(split_part(split_part(coalesce(pagina_, ''), '?', 1), '#', 1));
  if length(pag) > 1 then pag := rtrim(pag, '/'); end if;
  if pag !~ '^/[a-z0-9/_-]{0,200}$' then return; end if;
  -- por enquanto só o guia (/saloes, /saloes/<cidade>, /saloes/<cidade>/<categoria ou salão>
  -- e, desde a 157, /saloes/<cidade>/bairro/<bairro> e /saloes/<cidade>/horario/<horário>[/<categoria>]);
  -- o blog e as outras páginas entram aqui quando forem medidas
  partes := string_to_array(trim(both '/' from pag), '/');
  if partes[1] is distinct from 'saloes' or coalesce(array_length(partes, 1), 0) > 5 then return; end if;
  if array_length(partes, 1) >= 4 and not (
       (partes[3] = 'bairro' and array_length(partes, 1) = 4)
    or (partes[3] = 'horario' and partes[4] = any (horarios_)
        and (array_length(partes, 1) = 4 or (partes[4] <> 'sabado-o-dia-todo' and partes[5] = any (cats) and partes[5] <> 'beleza')))) then
    return;
  end if;

  -- robô e ferramenta não contam (quem não roda JavaScript nem chega aqui; desde a 194, nem o disfarçado)
  begin cab := current_setting('request.headers', true)::jsonb; exception when others then cab := null; end;
  ua := coalesce(cab ->> 'user-agent', '');
  -- 217: o app não é navegador (o user-agent dele é o da biblioteca de rede, que parece robô): entra pelo
  -- código da instalação; quem se diz app sem o código não conta
  if origem_ = 'app' and not app then return; end if;
  if not app and public.site_eh_robo(ua) then
    return;
  end if;
  ip := coalesce(nullif(cab ->> 'cf-connecting-ip', ''), nullif(cab ->> 'x-real-ip', ''), nullif(btrim(split_part(coalesce(cab ->> 'x-forwarded-for', ''), ',', 1)), ''), '');

  -- o sal do dia; quando o de hoje nasce, o de ontem (e antes) vai embora
  insert into public.site_sal (dia) values (hoje) on conflict (dia) do nothing;
  if found then delete from public.site_sal where dia < hoje; end if;
  select sal into sal_ from public.site_sal where dia = hoje;
  -- 217: no app, o visitante do dia sai do código da instalação (o mesmo aparelho no mesmo dia é o mesmo visitante)
  visitante_ := case when app then left(encode(sha256(convert_to(coalesce(sal_, '') || '|app|' || app_, 'UTF8')), 'hex'), 16)
                     else left(encode(sha256(convert_to(coalesce(sal_, '') || '|' || ip || '|' || ua, 'UTF8')), 'hex'), 16) end;
  rede_ := left(encode(sha256(convert_to(coalesce(sal_, '') || '|' || public.rede_do_ip(ip), 'UTF8')), 'hex'), 16);

  -- quem manda demais é ignorado: por rede (trocar de navegador não fura) e um teto geral
  if (select count(*) from public.site_eventos where rede = rede_ and em > now() - interval '1 minute') >= 40 then return; end if;
  if (select count(*) from public.site_eventos where rede = rede_ and em > now() - interval '1 day') >= 500 then return; end if;
  if (select count(*) from public.site_eventos where em > now() - interval '1 day') >= 50000 then return; end if;
  -- o mesmo evento na mesma página pelo mesmo visitante em 30 minutos conta uma vez:
  -- recarregar não é outra visita, tocar duas vezes no WhatsApp não é outra tentativa
  if exists (select 1 from public.site_eventos where visitante = visitante_ and pagina = pag and tipo = tipo_ and em > now() - interval '30 minutes') then
    return;
  end if;

  -- de qual salão, cidade e categoria é a página (pelo caminho; nunca pelo que o navegador diz).
  -- Só conta página que existe no ar: cidade com salão publicado, salão publicado, bairro com
  -- salão publicado, categoria do horário com salão publicado.
  if array_length(partes, 1) >= 2 then
    if not exists (select 1 from public.guia_lugares where cidade_slug = partes[2] and status = 'publicado') then return; end if;
    cidade_ := partes[2];
    if array_length(partes, 1) = 3 then
      if partes[3] = any (cats) then categoria_ := partes[3];
      else
        select id, categoria into lugar_, categoria_ from public.guia_lugares where cidade_slug = partes[2] and slug = partes[3] and status = 'publicado';
        if lugar_ is null then return; end if;
      end if;
    elsif partes[3] = 'bairro' then
      if partes[4] = partes[2] or not exists (select 1 from public.guia_lugares where cidade_slug = partes[2] and status = 'publicado'
          and conteudo is not null and public.guia_bairro_slug(bairro) = partes[4]) then
        return;
      end if;
    elsif array_length(partes, 1) = 5 then
      if not exists (select 1 from public.guia_lugares where cidade_slug = partes[2] and status = 'publicado' and conteudo is not null and categoria = partes[5]) then
        return;
      end if;
      categoria_ := partes[5];
    end if;
  end if;

  -- o resto só entra limpo e curto
  if utm_ is not null and jsonb_typeof(utm_) = 'object' then
    select jsonb_object_agg(k, left(v, 60)) into utm_limpo
      from jsonb_each_text(utm_) as e(k, v) where k in ('source', 'medium', 'campaign') and v <> '';
  end if;

  insert into public.site_eventos (tipo, pagina, lugar_id, cidade_slug, categoria, visitante, rede, origem, ref_host, aparelho, area, utm, dados)
  values (
    tipo_, pag, lugar_, cidade_, categoria_, visitante_, rede_,
    case when app then 'app' when origem_ in ('google', 'bing', 'instagram', 'facebook', 'whatsapp', 'tiktok', 'youtube', 'interno', 'direto', 'outro') then origem_ else 'direto' end,
    case when ref_ ~ '^[a-z0-9.-]{3,100}$' then lower(ref_) end,
    case when aparelho_ in ('celular', 'computador') then aparelho_ end,
    case when area_ ~ '^[a-z_]{1,20}$' then area_ end,
    utm_limpo,
    case when dados_ is not null and jsonb_typeof(dados_) = 'object' and length(dados_::text) <= 500 then dados_ else '{}'::jsonb end
  );
end $$;
revoke execute on function public.site_evento(text, text, text, text, text, text, jsonb, jsonb, text) from public;
grant execute on function public.site_evento(text, text, text, text, text, text, jsonb, jsonb, text) to anon, authenticated;
comment on function public.site_evento(text, text, text, text, text, text, jsonb, jsonb, text) is 'Site e app (156, 157, 194, 217): grava uma visita ou um toque nas páginas do guia. app_: o código da instalação do app (origem app, sem o filtro de robô do user-agent).';

-- ---- a batida de presença (igual à 209, com o app) ---------------------------------------------------------------------
drop function if exists public.site_presenca(text, text, text, text, jsonb, text, text, text, text, text, double precision, double precision, boolean);
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
  sair_ boolean default false,
  app_ text default null
) returns void
language plpgsql security definer set search_path = public set plan_cache_mode = force_custom_plan set jit = off as $$
declare
  cab jsonb; ua text; ip_txt text; ip_ inet;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  sal_ text; visitante_ text; pessoa_ text; tempero text;
  pag text; v public.site_presencas; cid integer; c public.geo_cidades;
  utm_limpo jsonb; tem_gps boolean;
  app boolean := coalesce(app_, '') ~ '^[a-z0-9]{16,64}$'; -- 217: o código da instalação do app
begin
  -- a página: caminho limpo, minúsculo, só as públicas
  pag := lower(split_part(split_part(coalesce(pagina_, ''), '?', 1), '#', 1));
  if length(pag) > 1 then pag := rtrim(pag, '/'); end if;
  if pag !~ '^/[a-z0-9/_.-]{0,200}$' then return; end if;
  if pag ~ '^/(cliente|pro|admin|plataforma|login|onboarding|bem-vinda|avisos|comecar|ativar|equipe|convite|v|entrar|cadastro|email-confirmado|splash|estilo|sessao-app)(/|$)' then return; end if;

  -- robô e ferramenta não contam (o mesmo filtro de site_evento; desde a 194, nem o disfarçado)
  begin cab := current_setting('request.headers', true)::jsonb; exception when others then cab := null; end;
  ua := coalesce(cab ->> 'user-agent', '');
  -- 217: o app entra pelo código da instalação, não pelo user-agent (que parece robô)
  if origem_ = 'app' and not app then return; end if;
  if not app and public.site_eh_robo(ua) then
    return;
  end if;
  ip_txt := coalesce(nullif(cab ->> 'cf-connecting-ip', ''), nullif(cab ->> 'x-real-ip', ''), nullif(btrim(split_part(coalesce(cab ->> 'x-forwarded-for', ''), ',', 1)), ''), '');

  -- o código do dia, como em site_evento (o sal de hoje nasce aqui também, se ainda não nasceu)
  insert into public.site_sal (dia) values (hoje) on conflict (dia) do nothing;
  if found then delete from public.site_sal where dia < hoje; end if;
  select sal into sal_ from public.site_sal where dia = hoje;
  visitante_ := case when app then left(encode(sha256(convert_to(coalesce(sal_, '') || '|app|' || app_, 'UTF8')), 'hex'), 16)
                     else left(encode(sha256(convert_to(coalesce(sal_, '') || '|' || ip_txt || '|' || ua, 'UTF8')), 'hex'), 16) end;
  -- 209: o código fixo da pessoa (o navegador sem os números de versão: a atualização do Chrome não vira pessoa nova)
  select pessoa_sal into tempero from public.site_segredo where id = 1;
  -- 217: no app, a pessoa é a instalação (o código não muda com a conexão: "voltou" fica certo no celular fora do Wi-Fi)
  pessoa_ := case when app then left(encode(sha256(convert_to(coalesce(tempero, '') || '|app|' || app_, 'UTF8')), 'hex'), 20)
                  else left(encode(sha256(convert_to(coalesce(tempero, '') || '|' || ip_txt || '|' || regexp_replace(ua, '[0-9]+(\.[0-9]+)*', '#', 'g'), 'UTF8')), 'hex'), 20) end;

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
          case when app then 'app' when origem_ in ('google', 'bing', 'instagram', 'facebook', 'whatsapp', 'tiktok', 'youtube', 'direto', 'interno', 'outro') then origem_ else 'outro' end,
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
comment on function public.site_presenca(text, text, text, text, jsonb, text, text, text, text, text, double precision, double precision, boolean, text) is 'Site e app (192, 194, 209, 217): a batida de presença das páginas públicas (a cada 25 s com a aba à vista; sair_ ao esconder ou fechar). Reconhece a visita pelo código do dia e a pessoa pelo código fixo, sem guardar IP; robô (também o disfarçado) não conta. 90 dias.';
revoke execute on function public.site_presenca(text, text, text, text, jsonb, text, text, text, text, text, double precision, double precision, boolean, text) from public;
grant execute on function public.site_presenca(text, text, text, text, jsonb, text, text, text, text, text, double precision, double precision, boolean, text) to anon, authenticated;

-- ---- o desempenho (igual à 187, com o filtro da origem) ----------------------------------------------------------------
drop function if exists public.guia_desempenho(integer, text);
create or replace function public.guia_desempenho(dias integer default 30, cidade_ text default '', origem_ text default null)
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
  -- 217: só o app, só o site, ou tudo (nulo)
  ori text := case when origem_ in ('app', 'site') then origem_ end;
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
       and (ori is null or (e.origem = 'app') = (ori = 'app'))
  ),
  agora_ as (select * from ev where em >= de),
  antes_ as (select * from ev where em < corte and tem_antes),
  int_ as (
    select i.lugar_id, i.tipo, count(*) as n
      from public.guia_interesses i join public.guia_lugares l on l.id = i.lugar_id
     where i.criado_em >= de and i.criado_em < ate and (cid is null or l.cidade_slug = cid) and ori is distinct from 'app'
     group by 1, 2
  ),
  -- 161: os pedidos "quero marcar" de cada dia (para a tendência do número do topo)
  int_dia as (
    select (i.criado_em at time zone 'America/Sao_Paulo')::date as dia, count(*) as n
      from public.guia_interesses i join public.guia_lugares l on l.id = i.lugar_id
     where i.tipo = 'quero_marcar' and i.criado_em >= de and i.criado_em < ate and (cid is null or l.cidade_slug = cid) and ori is distinct from 'app'
     group by 1
  ),
  -- 161: os pedidos do período anterior, pela mesma regra de totais_antes
  int_antes as (
    select i.tipo, count(*) as n
      from public.guia_interesses i join public.guia_lugares l on l.id = i.lugar_id
     where tem_antes and i.criado_em >= antes and i.criado_em < corte and (cid is null or l.cidade_slug = cid) and ori is distinct from 'app'
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
    'origem', ori,
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
revoke execute on function public.guia_desempenho(integer, text, text) from public, anon;
grant execute on function public.guia_desempenho(integer, text, text) to authenticated;
comment on function public.guia_desempenho(integer, text, text) is 'Guia (156, 161, 187, 217): o desempenho das páginas num período; cidade_ filtra uma cidade; origem_ (app | site) filtra de onde veio.';
