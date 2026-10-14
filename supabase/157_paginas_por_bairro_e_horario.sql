-- 157: páginas por bairro e por horário no guia de salões (3.12).
--
-- Mais portas de entrada pelo Google, feitas dos dados (sem IA):
--   /saloes/itanhaem/bairro/centro            "Salões de beleza no Centro de Itanhaém"
--   /saloes/itanhaem/horario/domingo          "Salões abertos no domingo em Itanhaém"
--   /saloes/itanhaem/horario/cedo | noite | sabado-o-dia-todo
--   /saloes/itanhaem/horario/domingo/unhas    "Manicures abertas no domingo em Itanhaém"
-- Quais coleções existem (pelo menos 3 salões no ar; 5 no horário de uma
-- categoria) e o texto de cada uma moram em packages/core/guiaColecoes.js,
-- que serve o site e o HTML estático. O banco entrega os dados e valida:
--   - guia_bairro_slug(texto): a chave do bairro ("Sl 18 - Centro" e
--     "Centro" são o mesmo; "Gaivota - Praia" e "Gaivota" também). É a
--     mesma regra de chaveDoBairro() em guiaColecoes.js: mexeu numa,
--     mexa na outra;
--   - guia_colecoes(cidade_): os salões no ar da cidade com bairro,
--     categoria, horário, serviços e atributos (tudo já público; nunca
--     nota, avaliações, CNPJ ou coordenadas);
--   - guia_pagina(): o lugar ganha bairro_slug, bairro_total e cidade_total, para a
--     página do salão saber se a página do bairro existe ("Mais salões no
--     Centro") sem baixar a cidade inteira;
--   - 'bairro' e 'horario' ficam reservados como slug de salão (nenhuma
--     página de salão colide com as coleções); quem já tivesse esse slug
--     ganha o da cidade no fim, como acontece com as categorias;
--   - site_evento() aceita os caminhos das coleções que existem de verdade
--     (bairro com salão publicado; horário e categoria da lista), com
--     tudo o mais igual à 156 (limite por rede, dedupe de 30 minutos, robô).
-- Idempotente.

-- ---- a chave do bairro ----------------------------------------------------------------------
-- 'Sl 18 - Centro' -> 'centro'; 'Lj 03 - Jardim MOSTEIRO' -> 'mosteiro'; 'Gaivota - Praia' -> 'gaivota';
-- 'Nova Itanhaém - Interior' -> 'nova-itanhaem'; 'Jd tropical' -> 'tropical'; '' -> ''
create or replace function public.guia_bairro_slug(b text)
returns text language plpgsql immutable set search_path = public as $$
declare
  pedaco text;
  s text;
  ultimo text := '';
begin
  foreach pedaco in array regexp_split_to_array(coalesce(b, ''), '\s+[-–]\s+') loop
    s := public.guia_slug(pedaco);
    -- loja, sala, casa, número e o "Praia"/"Interior" do fim não são o bairro
    if s = '' or s in ('praia', 'interior') or s ~ '^[0-9]'
       or s ~ '^(lj|loja|sl|sala|cs|casa|salao|portao|interfone|sobreloja|box|bloco|bl|ap|apto|lote|lt|qd|quadra|km|andar|fundos|terreo|galeria|anexo)(-?[0-9]|-[a-z0-9]{1,2}$|-n-|$)' then
      continue;
    end if;
    ultimo := s;
  end loop;
  return regexp_replace(ultimo, '^(jardim|jd|balneario|conj-hab)-', '');
end $$;
grant execute on function public.guia_bairro_slug(text) to anon, authenticated;

-- ---- os dados das coleções de uma cidade -------------------------------------------------------
create or replace function public.guia_colecoes(cidade_ text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  c text := lower(btrim(coalesce(cidade_, '')));
  base record;
begin
  select l.cidade, l.uf into base from public.guia_lugares l
   where l.cidade_slug = c and l.status = 'publicado' and l.conteudo is not null
   group by l.cidade, l.uf order by count(*) desc limit 1;
  if not found then return null; end if;
  return jsonb_build_object(
    'cidade', base.cidade, 'cidade_slug', c, 'uf', base.uf,
    'lugares', coalesce((select jsonb_agg(jsonb_build_object(
        'slug', l.slug, 'nome', l.nome, 'cidade', l.cidade, 'cidade_slug', l.cidade_slug, 'uf', l.uf,
        'bairro', l.bairro, 'endereco', l.endereco, 'categoria', l.categoria,
        'horarios', l.horarios, 'servicos', to_jsonb(coalesce(l.servicos, '{}')), 'atributos', coalesce(l.atributos, '{}'::jsonb),
        'resumo', l.conteudo ->> 'resumo', 'selecao', l.selecao, 'na_mimo', l.salon_id is not null, 'atualizado_em', l.atualizado_em)
      order by l.salon_id is null, not l.selecao, l.nome)
      from public.guia_lugares l
      where l.cidade_slug = c and l.status = 'publicado' and l.conteudo is not null), '[]'::jsonb));
end $$;
revoke execute on function public.guia_colecoes(text) from public;
grant execute on function public.guia_colecoes(text) to anon, authenticated;

-- ---- a página do salão sabe quantos salões no ar o bairro dele tem -------------------------------
-- (a mesma guia_pagina da 153; o lugar ganha bairro_slug, bairro_total e cidade_total)
create or replace function public.guia_pagina(cidade_ text, slug_ text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  l public.guia_lugares;
  bk text;
begin
  select * into l from public.guia_lugares
   where cidade_slug = lower(btrim(cidade_)) and slug = lower(btrim(slug_)) and status = 'publicado' and conteudo is not null;
  if not found then return null; end if;
  bk := public.guia_bairro_slug(l.bairro);
  return jsonb_build_object(
    'lugar', public.guia_publico(l) || jsonb_build_object(
      'bairro_slug', nullif(bk, ''),
      'bairro_total', case when bk = '' or bk = l.cidade_slug then 0 else
        (select count(*) from public.guia_lugares o
          where o.cidade_slug = l.cidade_slug and o.status = 'publicado' and o.conteudo is not null
            and public.guia_bairro_slug(o.bairro) = bk) end,
      'cidade_total', (select count(*) from public.guia_lugares o
          where o.cidade_slug = l.cidade_slug and o.status = 'publicado' and o.conteudo is not null)),
    'vizinhos', public.guia_vizinhos(l, 6),
    'mesma_categoria', coalesce((select jsonb_agg(public.guia_cartao(o) order by o.salon_id is null, not o.selecao, o.nome)
        from public.guia_lugares o
        where o.id in (select o2.id from public.guia_lugares o2
                        where o2.cidade_slug = l.cidade_slug and o2.categoria = l.categoria and o2.id <> l.id
                          and o2.status = 'publicado' and o2.conteudo is not null
                        order by o2.salon_id is null, not o2.selecao, o2.nome limit 8)), '[]'::jsonb));
end $$;
grant execute on function public.guia_pagina(text, text) to anon, authenticated;

-- ---- 'bairro' e 'horario' reservados como slug de salão -------------------------------------------
-- a importação e a Plataforma nunca gravam esses slugs: viram 'bairro-itanhaem' (e -2, -3... se preciso)
create or replace function public.guia_slug_reservado()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  base text;
  n int := 2;
begin
  if new.slug in ('bairro', 'horario') then
    base := left(new.slug || '-' || new.cidade_slug, 60);
    new.slug := base;
    while exists (select 1 from public.guia_lugares where cidade_slug = new.cidade_slug and slug = new.slug and id is distinct from new.id) loop
      new.slug := left(base, 56) || '-' || n; n := n + 1;
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists guia_lugares_slug_reservado on public.guia_lugares;
create trigger guia_lugares_slug_reservado before insert or update of slug, cidade_slug on public.guia_lugares
  for each row execute function public.guia_slug_reservado();
-- quem já tinha um desses slugs ganha o novo antes da trava (o gatilho acima troca)
update public.guia_lugares set slug = slug where slug in ('bairro', 'horario');
alter table public.guia_lugares drop constraint if exists guia_lugares_slug_ok;
alter table public.guia_lugares add constraint guia_lugares_slug_ok check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  and slug not in ('beleza', 'cabelo', 'unhas', 'cilios', 'sobrancelhas', 'barbearia', 'estetica', 'maquiagem', 'bairro', 'horario'));

-- ---- gravar um evento: a 156, agora também nas páginas das coleções ---------------------------------
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
  rede_ := left(encode(sha256(convert_to(coalesce(sal_, '') || '|' || ip, 'UTF8')), 'hex'), 16);

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

do $$
declare n int;
begin
  select count(distinct public.guia_bairro_slug(bairro)) into n from public.guia_lugares where status = 'publicado' and conteudo is not null;
  raise notice '157: páginas por bairro e por horário prontas (% bairros com salão no ar)', n;
end $$;
