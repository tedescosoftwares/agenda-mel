-- 163: "Perto de você" no guia e o mapa de acessos (3.13).
--
-- Nas listas do guia (cidade, categoria, bairro e horário) aparece um aviso:
-- "Quer ver os salões mais perto de você?". Quem toca em "Ativar localização"
-- autoriza o navegador, a lista reordena por distância no próprio aparelho
-- e o ponto exato, como o celular manda, vai para o banco como um evento
-- 'localizacao'. O aviso diz isso com todas as letras (e a política de
-- privacidade também): é consentimento, não rastreio escondido. Quem já
-- autorizou antes não vê o aviso de novo: a posição é lida sem perguntar.
-- A Plataforma vê os pontos no mapa de acessos (guia_mapa_acessos) e a
-- conta por bairro, pelo salão no ar mais perto de cada ponto.
--
-- O que muda:
--   - site_eventos_tipos ganha 'localizacao' (grupo outro: não é contato);
--   - um gatilho confere o evento antes de entrar: lat e lng válidos, e nada
--     além de lat, lng e prec (a precisão em metros). Fora disso, não entra;
--   - os cartões públicos (guia_cartao, guia_publico, guia_colecoes) levam a
--     coordenada do salão, com 5 casas, para a distância ser calculada no
--     aparelho da pessoa. O endereço já era público; a coordenada só diz
--     onde ele fica;
--   - guia_mapa_acessos(dias): só a Plataforma. Um ponto por pessoa e dia.
-- Os pontos seguem a vida dos outros eventos: a limpeza de 400 dias de
-- guia_desempenho (156) também os apaga. Idempotente.

-- ---- o tipo de evento ---------------------------------------------------------------------------
insert into public.site_eventos_tipos (tipo, rotulo, grupo, ordem) values ('localizacao', 'Localização ativada', 'outro', 95)
on conflict (tipo) do nothing;

-- ---- o gatilho: só entra ponto que faz sentido, e só lat, lng e prec -----------------------------
create or replace function public.site_evento_localizacao()
returns trigger language plpgsql set search_path = public as $$
declare
  lat double precision;
  lng double precision;
  prec integer;
begin
  if new.tipo <> 'localizacao' then return new; end if;
  begin
    lat := (new.dados ->> 'lat')::double precision;
    lng := (new.dados ->> 'lng')::double precision;
    prec := least(greatest(coalesce(round((new.dados ->> 'prec')::numeric), 0), 0), 100000)::integer;
  exception when others then
    return null; -- texto no lugar de número: o evento não entra
  end;
  if lat is null or lng is null or lat < -90 or lat > 90 or lng < -180 or lng > 180 or (lat = 0 and lng = 0) then
    return null;
  end if;
  new.dados := jsonb_build_object('lat', round(lat::numeric, 6), 'lng', round(lng::numeric, 6), 'prec', prec);
  return new;
end $$;
drop trigger if exists site_eventos_localizacao on public.site_eventos;
create trigger site_eventos_localizacao before insert on public.site_eventos
  for each row execute function public.site_evento_localizacao();

-- ---- a coordenada do salão nos cartões públicos --------------------------------------------------
comment on column public.guia_lugares.latitude is 'Do Google. Publicada com 5 casas (163) para o "perto de você"; os vizinhos usam a cheia.';
create or replace function public.guia_cartao(l public.guia_lugares)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object('slug', l.slug, 'nome', l.nome, 'bairro', l.bairro, 'categoria', l.categoria,
    'resumo', l.conteudo ->> 'resumo', 'servicos', to_jsonb((coalesce(l.servicos, '{}'))[1:4]),
    'selecao', l.selecao, 'na_mimo', l.salon_id is not null,
    'latitude', round(l.latitude::numeric, 5), 'longitude', round(l.longitude::numeric, 5))
$$;
revoke execute on function public.guia_cartao(public.guia_lugares) from public, anon;

create or replace function public.guia_publico(l public.guia_lugares)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'id', l.id, 'slug', l.slug, 'cidade', l.cidade, 'cidade_slug', l.cidade_slug, 'uf', l.uf,
    'categoria', l.categoria, 'nome', l.nome, 'bairro', l.bairro, 'endereco', l.endereco, 'cep', l.cep,
    'telefone', l.telefone, 'whatsapp', l.whatsapp, 'instagram', l.instagram, 'site', l.site,
    'horarios', l.horarios, 'servicos', to_jsonb(coalesce(l.servicos, '{}')), 'atributos', coalesce(l.atributos, '{}'::jsonb),
    'selecao', l.selecao, 'validado_receita', l.validado_receita,
    'na_mimo', l.salon_id is not null,
    'mimo', (select jsonb_build_object('salao_id', s.id, 'nome', s.name, 'slug', s.slug, 'subdominio', s.subdominio)
               from public.salons s where s.id = l.salon_id),
    'latitude', round(l.latitude::numeric, 5), 'longitude', round(l.longitude::numeric, 5),
    'conteudo', l.conteudo, 'publicado_em', l.publicado_em, 'atualizado_em', l.atualizado_em)
$$;
revoke execute on function public.guia_publico(public.guia_lugares) from public, anon;

-- a mesma guia_colecoes da 157, com a coordenada
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
        'resumo', l.conteudo ->> 'resumo', 'selecao', l.selecao, 'na_mimo', l.salon_id is not null, 'atualizado_em', l.atualizado_em,
        'latitude', round(l.latitude::numeric, 5), 'longitude', round(l.longitude::numeric, 5))
      order by l.salon_id is null, not l.selecao, l.nome)
      from public.guia_lugares l
      where l.cidade_slug = c and l.status = 'publicado' and l.conteudo is not null), '[]'::jsonb));
end $$;
revoke execute on function public.guia_colecoes(text) from public;
grant execute on function public.guia_colecoes(text) to anon, authenticated;

-- ---- o mapa de acessos: só a Plataforma -------------------------------------------------------
-- Um ponto por pessoa e dia (abrir várias páginas é um ponto). Para cada
-- ponto, o salão no ar mais perto (haversine, em km) e o bairro dele; a mais
-- de 8 km de qualquer salão é "fora da cidade". Até 5.000 pontos, os mais
-- novos primeiro; a conta por bairro é de todos.
create or replace function public.guia_mapa_acessos(dias integer default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  ndias integer := greatest(1, least(coalesce(dias, 30), 400));
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  de timestamptz;
  r jsonb;
begin
  if not public.eh_plataforma() then raise exception 'só a plataforma vê o mapa de acessos'; end if;
  de := ((hoje - (ndias - 1))::timestamp) at time zone 'America/Sao_Paulo';

  with p as (
    select distinct on (e.visitante, (e.em at time zone 'America/Sao_Paulo')::date)
           e.em, e.visitante, e.pagina, e.cidade_slug, e.aparelho, e.origem,
           (e.dados ->> 'lat')::double precision as lat,
           (e.dados ->> 'lng')::double precision as lng,
           coalesce((e.dados ->> 'prec')::integer, 0) as prec
      from public.site_eventos e
     where e.tipo = 'localizacao' and e.em >= de and e.dados ? 'lat' and e.dados ? 'lng'
     order by e.visitante, (e.em at time zone 'America/Sao_Paulo')::date, e.em
  ),
  perto as (
    select p.*, s.id as lugar_id, s.nome as lugar_nome, s.bairro, s.km
      from p
      left join lateral (
        select l.id, l.nome, l.bairro,
               2 * 6371 * asin(least(1, sqrt(
                 power(sin(radians(l.latitude - p.lat) / 2), 2)
                 + cos(radians(p.lat)) * cos(radians(l.latitude)) * power(sin(radians(l.longitude - p.lng) / 2), 2)))) as km
          from public.guia_lugares l
         where l.status = 'publicado' and l.latitude is not null and l.longitude is not null
           and (p.cidade_slug is null or l.cidade_slug = p.cidade_slug)
         order by 4 limit 1
      ) s on true
  )
  select jsonb_build_object(
    'dias', ndias, 'de', hoje - (ndias - 1), 'ate', hoje,
    'total', (select count(*) from perto),
    'pontos', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'em', x.em, 'lat', x.lat, 'lng', x.lng, 'prec', x.prec, 'pagina', x.pagina, 'aparelho', x.aparelho, 'origem', x.origem,
               'lugar_id', x.lugar_id, 'lugar', x.lugar_nome, 'bairro', x.bairro, 'km', round(x.km::numeric, 2))
             order by x.em desc), '[]'::jsonb)
        from (select * from perto order by em desc limit 5000) x),
    'por_bairro', (
      select coalesce(jsonb_agg(jsonb_build_object('chave', x.chave, 'bairro', x.bairro, 'n', x.n) order by x.n desc, x.bairro), '[]'::jsonb)
        from (select y.chave,
                     case when y.chave = '_sem' then 'Sem salão de referência' when y.chave = '_fora' then 'Fora da cidade'
                          else coalesce(nullif(btrim((array_agg(y.bairro order by length(y.bairro), y.bairro))[1]), ''), 'Sem bairro') end as bairro,
                     count(*) as n
                from (select perto.*,
                             case when km is null then '_sem' when km > 8 then '_fora'
                                  else coalesce(nullif(public.guia_bairro_slug(bairro), ''), '_sem') end as chave
                        from perto) y
               group by y.chave) x)
  ) into r;
  return r;
end $$;
revoke execute on function public.guia_mapa_acessos(integer) from public, anon;
grant execute on function public.guia_mapa_acessos(integer) to authenticated;

do $$
declare n int;
begin
  select count(*) into n from public.site_eventos where tipo = 'localizacao';
  raise notice '163: "perto de você" e o mapa de acessos prontos (% pontos guardados)', n;
end $$;
