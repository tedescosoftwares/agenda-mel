-- 194 (3.46): robô disfarçado não conta como visita.
--
-- No site ao vivo (3.45) apareceu uma "visita" de celular Android 6 com Chrome, tela 412x732, em inglês, sem cidade (IP de
-- fora do Brasil), entrando direto em páginas fundas e pulando de cidade em cidade a cada poucos segundos ou minutos. É o
-- celular que os robôs de busca simulam (Nexus 5X, Android 6.0.1). O Googlebot de verdade diz o nome no navegador
-- ("Googlebot/2.1") e o filtro de robô já o tirava; este não diz o nome.
-- O que entrega o disfarce: Chrome novo em Android velho não existe. O Chrome parou de atualizar na versão 106 no Android 6
-- (e antes nos mais velhos) e na 119 no Android 7; o robô se apresenta com o Chrome do mês. Com folga:
--   Android 6 ou mais velho com Chrome 110 ou mais novo, ou Android 7 com Chrome 125 ou mais novo  → robô
-- site_eh_robo() junta o filtro de antes (156) e esse teste; site_evento e site_presenca passam a usá-la (iguais à 157 e à
-- 192 no resto; rede_do_ip vem junto, igual à 157, para não depender de qual versão da 157 o banco tem). E o que esse
-- disfarce já gravou sai: as visitas de Android 6 ou mais velho com a tela do Nexus 5X ou fora do português, com os toques
-- e as visitas de página (site_eventos) do mesmo visitante na mesma janela (o Desempenho para de contá-las também).

-- ---- quem é robô, pelo navegador ---------------------------------------------------------------------------------------
create or replace function public.site_eh_robo(ua text)
returns boolean language plpgsql immutable set search_path = public as $$
declare
  android integer;
  chrome integer;
begin
  if coalesce(ua, '') = '' then return true; end if;
  -- quem diz o nome (156)
  if ua ~* '(bot|crawler|spider)[/;)+]|crawl|spider|slurp|preview|headless|lighthouse|pagespeed|gtmetrix|pingdom|uptime|google-|adsbot|mediapartners|^curl|^wget|python-|axios/|node-fetch|go-http|okhttp|postman|phantomjs|selenium|playwright|puppeteer' then
    return true;
  end if;
  -- o disfarce: Chrome novo em Android velho
  android := substring(ua from 'Android (\d{1,2})')::integer;
  chrome := substring(ua from 'Chrome/(\d{2,3})')::integer;
  return android is not null and chrome is not null and ((android <= 6 and chrome >= 110) or (android = 7 and chrome >= 125));
end $$;
comment on function public.site_eh_robo(text) is 'Site (194): o navegador é de robô? Quem diz o nome (bot, crawler, ferramentas) ou o disfarce de Chrome novo em Android velho (o celular do Google sem o nome).';
revoke execute on function public.site_eh_robo(text) from public, anon, authenticated;

-- ---- a rede de um IP (igual à 157) --------------------------------------------------------------------------------------
create or replace function public.rede_do_ip(ip text)
returns text language plpgsql immutable set search_path = public as $$
begin
  if position(':' in coalesce(ip, '')) = 0 then return ip; end if;
  return network(set_masklen(ip::inet, 64))::text;
exception when others then return ip;
end $$;
revoke execute on function public.rede_do_ip(text) from public, anon, authenticated;

-- ---- gravar um evento (igual à 157, com o filtro novo) ------------------------------------------------------------------
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
  rede_ text;
  pag text;
  partes text[];
  lugar_ uuid;
  cidade_ text;
  categoria_ text;
  cats text[] := array['beleza', 'cabelo', 'unhas', 'cilios', 'sobrancelhas', 'estetica', 'maquiagem'];
  horarios_ text[] := array['domingo', 'cedo', 'noite', 'sabado-o-dia-todo'];
  utm_limpo jsonb;
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
  if public.site_eh_robo(ua) then
    return;
  end if;
  ip := coalesce(nullif(cab ->> 'cf-connecting-ip', ''), nullif(cab ->> 'x-real-ip', ''), nullif(btrim(split_part(coalesce(cab ->> 'x-forwarded-for', ''), ',', 1)), ''), '');

  -- o sal do dia; quando o de hoje nasce, o de ontem (e antes) vai embora
  insert into public.site_sal (dia) values (hoje) on conflict (dia) do nothing;
  if found then delete from public.site_sal where dia < hoje; end if;
  select sal into sal_ from public.site_sal where dia = hoje;
  visitante_ := left(encode(sha256(convert_to(coalesce(sal_, '') || '|' || ip || '|' || ua, 'UTF8')), 'hex'), 16);
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

-- ---- a batida de presença (igual à 192, com o filtro novo) --------------------------------------------------------------
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
comment on function public.site_presenca(text, text, text, text, jsonb, text, text, text, text, text, double precision, double precision, boolean) is 'Site (192, 194): a batida de presença das páginas públicas (a cada 25 s com a aba à vista; sair_ ao esconder ou fechar). Reconhece a visita pelo código do dia, sem guardar IP; robô (também o disfarçado) não conta.';
revoke execute on function public.site_presenca(text, text, text, text, jsonb, text, text, text, text, text, double precision, double precision, boolean) from public;
grant execute on function public.site_presenca(text, text, text, text, jsonb, text, text, text, text, text, double precision, double precision, boolean) to anon, authenticated;

-- ---- o que o disfarce já gravou -----------------------------------------------------------------------------------------
-- as visitas (Android 6 ou mais velho com a tela do Nexus 5X ou fora do português) e, do mesmo visitante na mesma janela,
-- os eventos (visitas de página e toques). O código do visitante muda todo dia: não pega ninguém de outro dia.
do $$
declare n_ev integer; n_pr integer;
begin
  create temp table robos_194 on commit drop as
    select visitante, min(inicio_em) as ini, max(visto_em) as fim
      from public.site_presencas
     where sistema ~ '^Android [1-6]$' and (tela = '412x732' or coalesce(idioma, '') !~* '^pt')
     group by visitante;
  delete from public.site_eventos e using robos_194 r
   where e.visitante = r.visitante and e.em between r.ini - interval '1 minute' and r.fim + interval '2 minutes';
  get diagnostics n_ev = row_count;
  delete from public.site_presencas where visitante in (select visitante from robos_194);
  get diagnostics n_pr = row_count;
  raise notice '194: site_eh_robo (Chrome novo em Android velho é robô) em site_evento e site_presenca; saíram % visitas e % eventos do disfarce', n_pr, n_ev;
end $$;
