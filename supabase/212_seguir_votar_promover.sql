-- 212: seguir pelo guia, "quero esse salão na MIMO" (votos), promover um salão do guia a
-- salão com agenda, e o salão que contrata entrar no guia (3.67)
--
-- 1. votos: a cliente (no app) ou um visitante (no site, por um token do navegador) pede
--    um salão do guia que ainda não agenda pela MIMO. Conta em guia_lugares.votos e vira
--    métrica de abordagem por cidade. guia_votar() alterna (pede / desfaz).
-- 2. guia_promover(lugar_, dono_email_): a Plataforma liga um salão do guia a um salão da
--    MIMO: o da dona (pelo e-mail da conta), ou um novo (abrir_negocio_interno) com os
--    dados do guia copiados. Serve ao teste e à venda.
-- 3. guia_espelhar_salao(salao_): o caminho inverso. O salão que contrata ganha uma
--    entrada no guia (status importado, origem mimo), ligada a ele; passa pela fila de
--    sempre (gerar texto, revisar, aprovar). Dispara sozinho ao concluir o onboarding.

-- ---------------------------------------------------------------------------
-- 1. votos
-- ---------------------------------------------------------------------------
create table if not exists public.guia_votos (
  id uuid primary key default gen_random_uuid(),
  lugar_id uuid not null references public.guia_lugares (id) on delete cascade,
  client_id uuid references public.profiles (id) on delete cascade,
  token text,
  origem text not null default 'app' check (origem in ('app', 'site')),
  criado_em timestamptz not null default now(),
  check (client_id is not null or token is not null)
);
create unique index if not exists guia_votos_por_cliente on public.guia_votos (lugar_id, client_id) where client_id is not null;
create unique index if not exists guia_votos_por_token on public.guia_votos (lugar_id, token) where token is not null;
create index if not exists guia_votos_lugar on public.guia_votos (lugar_id);
alter table public.guia_votos enable row level security;
comment on table public.guia_votos is 'Guia (212): "quero esse salão na MIMO". Só pelas funções guia_votar e guia_meus_votos.';

alter table public.guia_lugares add column if not exists votos integer not null default 0;

create or replace function public.guia_votos_contar()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  alvo uuid := coalesce(new.lugar_id, old.lugar_id);
begin
  update public.guia_lugares set votos = (select count(*) from public.guia_votos v where v.lugar_id = alvo) where id = alvo;
  return null;
end;
$$;
drop trigger if exists guia_votos_contar on public.guia_votos;
create trigger guia_votos_contar after insert or delete on public.guia_votos
  for each row execute function public.guia_votos_contar();

-- pede ou desfaz. Cliente logada: pelo uid. Site: pelo token do navegador (16 a 80 caracteres).
create or replace function public.guia_votar(lugar_ uuid, token_ text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  eu uuid := auth.uid();
  tok text := nullif(btrim(coalesce(token_, '')), '');
  l record;
  havia boolean;
  n integer;
begin
  select id, salon_id, status into l from public.guia_lugares where id = lugar_;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'Salão não encontrado.'); end if;
  if l.salon_id is not null then return jsonb_build_object('ok', false, 'na_mimo', true, 'motivo', 'Esse salão já agenda pela MIMO.'); end if;
  if eu is not null then
    delete from public.guia_votos where lugar_id = lugar_ and client_id = eu returning true into havia;
    if havia is null then insert into public.guia_votos (lugar_id, client_id, origem) values (lugar_, eu, 'app'); end if;
  else
    if tok is null or length(tok) < 16 or length(tok) > 80 then
      return jsonb_build_object('ok', false, 'motivo', 'Entre na conta para pedir.');
    end if;
    delete from public.guia_votos where lugar_id = lugar_ and token = tok returning true into havia;
    if havia is null then insert into public.guia_votos (lugar_id, token, origem) values (lugar_, tok, 'site'); end if;
  end if;
  select votos into n from public.guia_lugares where id = lugar_;
  return jsonb_build_object('ok', true, 'votou', havia is null, 'votos', n);
end;
$$;
revoke execute on function public.guia_votar(uuid, text) from public;
grant execute on function public.guia_votar(uuid, text) to anon, authenticated;

create or replace function public.guia_meus_votos()
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(lugar_id), '{}'::uuid[]) from public.guia_votos where client_id = auth.uid();
$$;
revoke execute on function public.guia_meus_votos() from public, anon;
grant execute on function public.guia_meus_votos() to authenticated;

-- a página pública leva os votos
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
    'fotos', to_jsonb(public.guia_fotos(l)),
    'votos', l.votos,
    'conteudo', l.conteudo, 'publicado_em', l.publicado_em, 'atualizado_em', l.atualizado_em)
$$;
revoke execute on function public.guia_publico(public.guia_lugares) from public, anon;

-- a lista da Plataforma leva os votos (coluna nova no fim: create or replace aceita)
create or replace view public.guia_lista with (security_invoker = true) as
  select l.id, l.cidade, l.cidade_slug, l.uf, l.slug, l.categoria, l.nome, l.bairro, l.endereco, l.cep, l.telefone, l.whatsapp, l.instagram, l.site,
         l.horarios, l.servicos, l.atributos, l.place_id, l.cnpj, l.validado_receita, l.selecao, l.nota, l.avaliacoes, l.fontes, l.origem, l.fotos,
         l.status, l.motivo, l.salon_id, l.gerado_em, l.publicado_em, l.criado_em, l.atualizado_em,
         (l.conteudo is not null) as tem_conteudo,
         (l.rascunho is not null) as tem_rascunho,
         coalesce(l.rascunho ->> 'resumo', l.conteudo ->> 'resumo') as resumo,
         l.conteudo -> '_meta' as meta,
         l.rascunho -> '_meta' as meta_rascunho,
         (l.horarios is not null and jsonb_typeof(l.horarios) = 'array' and jsonb_array_length(l.horarios) > 0) as tem_horario,
         coalesce(array_length(l.servicos, 1), 0) as servicos_n,
         public.guia_pontos(l) as pontos,
         coalesce(array_length(l.fotos, 1), 0) as fotos_n,
         lower(translate(l.nome || ' ' || coalesce(l.bairro, ''), 'ÁÀÂÃÄÅáàâãäåÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñÝýÿ', 'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNnYyy')) as busca,
         l.votos
    from public.guia_lugares l;

-- ---------------------------------------------------------------------------
-- 2. promover: o salão do guia vira (ou liga a) um salão da MIMO
-- ---------------------------------------------------------------------------
create or replace function public.guia_promover(lugar_ uuid, dono_email_ text, tipo_ text default 'salao')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l public.guia_lugares%rowtype;
  uid uuid;
  s public.salons%rowtype;
  r jsonb;
  novo boolean := false;
  cep8 text;
begin
  if not public.eh_plataforma() then raise exception 'só a Plataforma promove um salão do guia'; end if;
  select * into l from public.guia_lugares where id = lugar_;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'Salão do guia não encontrado.'); end if;
  if l.salon_id is not null then
    return jsonb_build_object('ok', false, 'motivo', 'Esse salão do guia já está ligado a um salão da MIMO.', 'salao_id', l.salon_id);
  end if;
  select u.id into uid from auth.users u where lower(u.email) = lower(btrim(coalesce(dono_email_, '')));
  if uid is null then
    return jsonb_build_object('ok', false, 'motivo', 'Não achei conta com esse e-mail. A dona cria a conta primeiro (mimo.com.vc/comecar) e você promove depois.');
  end if;

  -- o salão da dona que ainda não está no guia; senão, nasce um com o nome e a cidade do guia
  select * into s from public.salons x
   where x.owner_id = uid and not exists (select 1 from public.guia_lugares g where g.salon_id = x.id)
   order by x.created_at desc limit 1;
  if not found then
    r := public.abrir_negocio_interno(uid, case when tipo_ = 'autonoma' then 'autonoma' else 'salao' end, l.nome, l.cidade);
    select * into s from public.salons where id = (r ->> 'salao_id')::uuid;
    novo := true;
  end if;

  cep8 := regexp_replace(coalesce(l.cep, ''), '\D', '', 'g');
  update public.salons x set
    address = coalesce(x.address, l.endereco),
    bairro = coalesce(x.bairro, l.bairro),
    cep = coalesce(x.cep, case when cep8 ~ '^[0-9]{8}$' then cep8 end),
    uf = coalesce(x.uf, l.uf),
    city = coalesce(x.city, l.cidade),
    phone = coalesce(x.phone, l.telefone, l.whatsapp),
    whatsapp = coalesce(x.whatsapp, left(l.whatsapp, 30)),
    instagram = coalesce(x.instagram, left(l.instagram, 60)),
    lat = case when x.lat is null and l.latitude is not null and l.longitude is not null then l.latitude else x.lat end,
    lng = case when x.lng is null and l.latitude is not null and l.longitude is not null then l.longitude else x.lng end,
    fotos = case when coalesce(array_length(x.fotos, 1), 0) = 0 then coalesce(l.fotos, '{}') else x.fotos end,
    descricao = coalesce(x.descricao, left(l.conteudo ->> 'resumo', 800))
  where x.id = s.id;

  update public.guia_lugares set salon_id = s.id, atualizado_em = now() where id = l.id;
  return jsonb_build_object('ok', true, 'salao_id', s.id, 'novo', novo, 'nome', s.name, 'slug', s.slug);
end;
$$;
revoke execute on function public.guia_promover(uuid, text, text) from public, anon;
grant execute on function public.guia_promover(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. espelhar: o salão da MIMO ganha a sua entrada no guia
-- ---------------------------------------------------------------------------
create or replace function public.guia_espelhar_salao_interno(salao_ uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s public.salons%rowtype;
  ja uuid;
  cs text;
  base text;
  sl text;
  n integer := 1;
  cat text;
  servs text[];
  novo uuid;
begin
  select * into s from public.salons where id = salao_;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'Salão não encontrado.'); end if;
  select id into ja from public.guia_lugares where salon_id = s.id limit 1;
  if ja is not null then return jsonb_build_object('ok', true, 'lugar_id', ja, 'ja_estava', true); end if;
  if nullif(btrim(coalesce(s.city, '')), '') is null then
    return jsonb_build_object('ok', false, 'motivo', 'O salão ainda não tem cidade.');
  end if;

  cs := public.guia_slug(s.city);
  base := coalesce(nullif(public.guia_slug(s.name), ''), 'salao');
  if base in ('beleza', 'cabelo', 'unhas', 'cilios', 'sobrancelhas', 'barbearia', 'estetica', 'maquiagem', 'bairro', 'horario') then base := base || '-salao'; end if;
  sl := base;
  while exists (select 1 from public.guia_lugares where cidade_slug = cs and slug = sl) loop
    n := n + 1; sl := base || '-' || n;
  end loop;
  cat := case s.ramo
           when 'unhas' then 'unhas' when 'estetica' then 'estetica' when 'cabelo' then 'cabelo'
           when 'sobrancelhas_cilios' then 'sobrancelhas' when 'maquiagem' then 'maquiagem' when 'barbearia' then 'barbearia'
           else 'beleza' end;
  select coalesce(array_agg(distinct x.name order by x.name), '{}') into servs
    from (select v.name from public.services v where v.salon_id = s.id and v.active order by v.name limit 12) x;

  insert into public.guia_lugares (cidade, cidade_slug, uf, slug, categoria, nome, bairro, endereco, cep, telefone, whatsapp, instagram,
                                   latitude, longitude, fotos, servicos, status, origem, salon_id)
  values (btrim(s.city), cs, coalesce(nullif(btrim(coalesce(s.uf, '')), ''), 'SP'), sl, cat, s.name, s.bairro, s.address,
          case when s.cep ~ '^[0-9]{8}$' then left(s.cep, 5) || '-' || right(s.cep, 3) else s.cep end,
          s.phone, s.whatsapp, s.instagram, s.lat, s.lng, coalesce(s.fotos, '{}'), servs, 'importado',
          jsonb_build_object('fonte', 'mimo', 'salao_id', s.id, 'em', now()), s.id)
  returning id into novo;
  return jsonb_build_object('ok', true, 'lugar_id', novo, 'ja_estava', false, 'slug', sl, 'cidade_slug', cs);
end;
$$;
revoke execute on function public.guia_espelhar_salao_interno(uuid) from public, anon, authenticated;

create or replace function public.guia_espelhar_salao(salao_ uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.eh_plataforma() and not exists (select 1 from public.salons where id = salao_ and owner_id = auth.uid()) then
    raise exception 'só a Plataforma ou a dona põe o salão no guia';
  end if;
  return public.guia_espelhar_salao_interno(salao_);
end;
$$;
revoke execute on function public.guia_espelhar_salao(uuid) from public, anon;
grant execute on function public.guia_espelhar_salao(uuid) to authenticated;

-- ao concluir o onboarding, o salão entra no guia sozinho (status importado: só aparece depois de revisar e aprovar)
create or replace function public.salons_para_o_guia()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.onboarding_concluido_em is null and new.onboarding_concluido_em is not null then
    begin
      perform public.guia_espelhar_salao_interno(new.id);
    exception when others then
      raise notice 'salão % não espelhado no guia: %', new.id, sqlerrm;
    end;
  end if;
  return new;
end;
$$;
drop trigger if exists salons_para_o_guia on public.salons;
create trigger salons_para_o_guia after update of onboarding_concluido_em on public.salons
  for each row execute function public.salons_para_o_guia();

insert into public.migracoes_aplicadas (arquivo) values ('212_seguir_votar_promover.sql') on conflict (arquivo) do nothing;

do $$ begin
  raise notice '212: guia_votos + guia_votar/guia_meus_votos (votos no guia_publico e na guia_lista), guia_promover, guia_espelhar_salao (+ gatilho ao concluir o onboarding)';
end $$;
