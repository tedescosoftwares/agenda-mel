-- 153: o guia de salões (3.9).
--
-- Uma página pública para cada salão da região, mesmo antes de ele ser
-- cliente da MIMO, e as páginas da cidade e de cada categoria
-- (/saloes/itanhaem, /saloes/itanhaem/unhas, /saloes/itanhaem/ro-coiffeur).
-- A Plataforma importa os CSVs (o do Google Places e o validado na Receita),
-- a função guia-gerar escreve o texto de cada página com IA, e nada vai
-- para o ar sem alguém aprovar.
--
--   guia_lugares     um salão: os fatos, a página no ar (conteudo) e a
--                    versão esperando revisão (rascunho)
--   guia_paginas     o texto da página da cidade e de cada categoria
--   guia_interesses  "quero marcar aqui", "é meu salão", "corrigir", "remover"
--
-- O público só lê pelas funções guia_pagina / guia_cidade / guia_cidades /
-- guia_publicadas, que entregam o que pode ir para a página: nota e número
-- de avaliações do Google, CNPJ, coordenadas e o CSV de origem ficam no
-- banco só para a triagem, nunca saem por elas.
--
-- Idempotente: pode rodar de novo.

-- 1. As tabelas -----------------------------------------------------------------
create table if not exists public.guia_lugares (
  id uuid primary key default gen_random_uuid(),
  cidade text not null,
  cidade_slug text not null,
  uf text not null default 'SP',
  slug text not null,
  categoria text not null default 'beleza',
  nome text not null,
  bairro text,
  endereco text,
  cep text,
  telefone text,
  whatsapp text,
  instagram text,
  site text,
  horarios jsonb,                         -- [{ "dia": 0..6, "faixas": [["09:00","19:00"]] }]
  servicos text[] not null default '{}',
  latitude double precision,              -- só para achar os vizinhos; nunca publicada
  longitude double precision,
  place_id text,
  cnpj text,
  validado_receita boolean not null default false,
  selecao boolean not null default false, -- "Seleção MIMO": a curadoria da casa
  nota numeric(2,1),                      -- triagem; nunca publicada
  avaliacoes integer,                     -- triagem; nunca publicada
  origem jsonb not null default '{}'::jsonb,  -- as linhas dos CSVs, por origem
  fontes jsonb not null default '{}'::jsonb,  -- campo -> 'manual' quando a Plataforma editou (importação não sobrescreve)
  conteudo jsonb,                         -- a página no ar
  rascunho jsonb,                         -- a última geração, esperando revisão
  status text not null default 'importado',
  motivo text,                            -- por que foi descartado ou removido; nota interna
  salon_id uuid references public.salons (id) on delete set null,
  gerado_em timestamptz,
  publicado_em timestamptz,
  aprovado_por uuid references auth.users (id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint guia_lugares_status_ok check (status in ('importado', 'gerado', 'publicado', 'descartado', 'removido')),
  constraint guia_lugares_categoria_ok check (categoria in ('beleza', 'cabelo', 'unhas', 'cilios', 'sobrancelhas', 'barbearia', 'estetica', 'maquiagem')),
  constraint guia_lugares_slug_ok check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and slug not in ('beleza', 'cabelo', 'unhas', 'cilios', 'sobrancelhas', 'barbearia', 'estetica', 'maquiagem')),
  constraint guia_lugares_cidade_ok check (cidade_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
comment on table public.guia_lugares is 'Guia de salões (153): um salão da região com página pública, cliente da MIMO ou não. Público lê só pelas funções guia_*.';
create unique index if not exists guia_lugares_url on public.guia_lugares (cidade_slug, slug);
create unique index if not exists guia_lugares_place on public.guia_lugares (place_id) where place_id is not null;
create index if not exists guia_lugares_cnpj on public.guia_lugares (cnpj) where cnpj is not null;
create index if not exists guia_lugares_fila on public.guia_lugares (cidade_slug, status, categoria);

create table if not exists public.guia_paginas (
  id uuid primary key default gen_random_uuid(),
  cidade text not null,
  cidade_slug text not null,
  uf text not null default 'SP',
  categoria text not null default '',     -- '' = a página da cidade
  conteudo jsonb,
  rascunho jsonb,
  status text not null default 'rascunho',
  gerado_em timestamptz,
  publicado_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint guia_paginas_status_ok check (status in ('rascunho', 'publicado')),
  constraint guia_paginas_categoria_ok check (categoria in ('', 'beleza', 'cabelo', 'unhas', 'cilios', 'sobrancelhas', 'barbearia', 'estetica', 'maquiagem'))
);
comment on table public.guia_paginas is 'Guia de salões (153): o texto da página da cidade (categoria vazia) e de cada categoria.';
create unique index if not exists guia_paginas_url on public.guia_paginas (cidade_slug, categoria);

create table if not exists public.guia_interesses (
  id uuid primary key default gen_random_uuid(),
  lugar_id uuid not null references public.guia_lugares (id) on delete cascade,
  tipo text not null,
  nome text,
  contato text,
  mensagem text,
  criado_em timestamptz not null default now(),
  atendido_em timestamptz,
  atendido_por uuid references auth.users (id) on delete set null,
  constraint guia_interesses_tipo_ok check (tipo in ('quero_marcar', 'sou_dono', 'corrigir', 'remover'))
);
comment on table public.guia_interesses is 'Guia de salões (153): quem pediu para marcar pelo app, a dona que quer a agenda, pedidos de correção e de remoção.';
create index if not exists guia_interesses_lugar on public.guia_interesses (lugar_id, criado_em desc);

-- atualizado_em anda sozinho
create or replace function public.guia_tocar()
returns trigger language plpgsql as $$
begin new.atualizado_em := now(); return new; end $$;
drop trigger if exists guia_lugares_tocar on public.guia_lugares;
create trigger guia_lugares_tocar before update on public.guia_lugares for each row execute function public.guia_tocar();
drop trigger if exists guia_paginas_tocar on public.guia_paginas;
create trigger guia_paginas_tocar before update on public.guia_paginas for each row execute function public.guia_tocar();

-- 2. Quem mexe: só a Plataforma. O público passa pelas funções. --------------------
alter table public.guia_lugares enable row level security;
alter table public.guia_paginas enable row level security;
alter table public.guia_interesses enable row level security;
revoke all on public.guia_lugares, public.guia_paginas, public.guia_interesses from anon;
grant select, insert, update, delete on public.guia_lugares, public.guia_paginas, public.guia_interesses to authenticated;

drop policy if exists guia_lugares_plataforma on public.guia_lugares;
create policy guia_lugares_plataforma on public.guia_lugares for all to authenticated
  using (public.eh_plataforma()) with check (public.eh_plataforma());
drop policy if exists guia_paginas_plataforma on public.guia_paginas;
create policy guia_paginas_plataforma on public.guia_paginas for all to authenticated
  using (public.eh_plataforma()) with check (public.eh_plataforma());
drop policy if exists guia_interesses_plataforma on public.guia_interesses;
create policy guia_interesses_plataforma on public.guia_interesses for all to authenticated
  using (public.eh_plataforma()) with check (public.eh_plataforma());

-- 3. Ajudantes ------------------------------------------------------------------------
-- 'Rô Coiffeur & Cia' -> 'ro-coiffeur-e-cia' (a mesma regra de slugificar() do packages/core/guia.js)
create or replace function public.guia_slug(t text)
returns text language sql immutable as $$
  select regexp_replace(left(trim(both '-' from regexp_replace(lower(translate(replace(coalesce(t, ''), '&', ' e '),
    'áàâãäåéèêëíìîïóòôõöúùûüçñýÁÀÂÃÄÅÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑÝ', 'aaaaaaeeeeiiiiooooouuuucnyaaaaaaeeeeiiiiooooouuuucny')), '[^a-z0-9]+', '-', 'g')), 60), '-+$', '')
$$;

-- o que de um salão pode ir para a página
create or replace function public.guia_publico(l public.guia_lugares)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'id', l.id, 'slug', l.slug, 'cidade', l.cidade, 'cidade_slug', l.cidade_slug, 'uf', l.uf,
    'categoria', l.categoria, 'nome', l.nome, 'bairro', l.bairro, 'endereco', l.endereco, 'cep', l.cep,
    'telefone', l.telefone, 'whatsapp', l.whatsapp, 'instagram', l.instagram, 'site', l.site,
    'horarios', l.horarios, 'servicos', to_jsonb(coalesce(l.servicos, '{}')),
    'selecao', l.selecao, 'validado_receita', l.validado_receita,
    'na_mimo', l.salon_id is not null,
    'mimo', (select jsonb_build_object('salao_id', s.id, 'nome', s.name, 'slug', s.slug, 'subdominio', s.subdominio)
               from public.salons s where s.id = l.salon_id),
    'conteudo', l.conteudo, 'publicado_em', l.publicado_em, 'atualizado_em', l.atualizado_em)
$$;
revoke execute on function public.guia_publico(public.guia_lugares) from public, anon;

-- o cartão de um salão nas listas
create or replace function public.guia_cartao(l public.guia_lugares)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object('slug', l.slug, 'nome', l.nome, 'bairro', l.bairro, 'categoria', l.categoria,
    'resumo', l.conteudo ->> 'resumo', 'servicos', to_jsonb((coalesce(l.servicos, '{}'))[1:4]),
    'selecao', l.selecao, 'na_mimo', l.salon_id is not null)
$$;
revoke execute on function public.guia_cartao(public.guia_lugares) from public, anon;

-- os mais perto (pela coordenada; sem ela, o mesmo bairro primeiro)
create or replace function public.guia_vizinhos(l public.guia_lugares, quantos int default 6)
returns jsonb language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(c order by d, nome), '[]'::jsonb) from (
    select public.guia_cartao(o) c, o.nome,
      case when l.latitude is not null and o.latitude is not null
             then power(o.latitude - l.latitude, 2) + power((o.longitude - l.longitude) * cos(radians(l.latitude)), 2)
           when o.bairro is not distinct from l.bairro then 0
           else 1e9 end d
    from public.guia_lugares o
    where o.cidade_slug = l.cidade_slug and o.id <> l.id and o.status = 'publicado' and o.conteudo is not null
    order by d, o.nome
    limit quantos) x
$$;
revoke execute on function public.guia_vizinhos(public.guia_lugares, int) from public, anon;

-- 4. O que o público lê ------------------------------------------------------------------
-- a página de um salão: os fatos, o texto aprovado, os vizinhos e outros da mesma categoria
create or replace function public.guia_pagina(cidade_ text, slug_ text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare l public.guia_lugares;
begin
  select * into l from public.guia_lugares
   where cidade_slug = lower(btrim(cidade_)) and slug = lower(btrim(slug_)) and status = 'publicado' and conteudo is not null;
  if not found then return null; end if;
  return jsonb_build_object(
    'lugar', public.guia_publico(l),
    'vizinhos', public.guia_vizinhos(l, 6),
    'mesma_categoria', coalesce((select jsonb_agg(public.guia_cartao(o) order by o.salon_id is null, not o.selecao, o.nome)
        from public.guia_lugares o
        where o.id in (select o2.id from public.guia_lugares o2
                        where o2.cidade_slug = l.cidade_slug and o2.categoria = l.categoria and o2.id <> l.id
                          and o2.status = 'publicado' and o2.conteudo is not null
                        order by o2.salon_id is null, not o2.selecao, o2.nome limit 8)), '[]'::jsonb));
end $$;
grant execute on function public.guia_pagina(text, text) to anon, authenticated;

-- a página da cidade (categoria vazia) ou de uma categoria: o texto aprovado, os números e a lista
create or replace function public.guia_cidade(cidade_ text, categoria_ text default '')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  c text := lower(btrim(cidade_));
  cat text := lower(btrim(coalesce(categoria_, '')));
  base record;
begin
  select l.cidade, l.uf, count(*) total into base from public.guia_lugares l
   where l.cidade_slug = c and l.status = 'publicado' and l.conteudo is not null
   group by l.cidade, l.uf order by count(*) desc limit 1;
  if not found then return null; end if;
  if cat <> '' and not exists (select 1 from public.guia_lugares l where l.cidade_slug = c and l.categoria = cat and l.status = 'publicado' and l.conteudo is not null) then
    return null;
  end if;
  return jsonb_build_object(
    'cidade', base.cidade, 'cidade_slug', c, 'uf', base.uf, 'categoria', cat,
    'pagina', (select p.conteudo from public.guia_paginas p where p.cidade_slug = c and p.categoria = cat and p.status = 'publicado'),
    'total', (select count(*) from public.guia_lugares l where l.cidade_slug = c and l.status = 'publicado' and l.conteudo is not null),
    'categorias', coalesce((select jsonb_agg(jsonb_build_object('categoria', x.categoria, 'total', x.n) order by x.n desc)
        from (select l.categoria, count(*) n from public.guia_lugares l where l.cidade_slug = c and l.status = 'publicado' and l.conteudo is not null group by l.categoria) x), '[]'::jsonb),
    'bairros', coalesce((select jsonb_agg(jsonb_build_object('bairro', x.bairro, 'total', x.n) order by x.n desc, x.bairro)
        from (select l.bairro, count(*) n from public.guia_lugares l
               where l.cidade_slug = c and l.status = 'publicado' and l.conteudo is not null and coalesce(l.bairro, '') <> '' and (cat = '' or l.categoria = cat)
               group by l.bairro) x), '[]'::jsonb),
    'lugares', coalesce((select jsonb_agg(public.guia_cartao(l) order by l.salon_id is null, not l.selecao, l.nome)
        from public.guia_lugares l
        where l.cidade_slug = c and l.status = 'publicado' and l.conteudo is not null and (cat = '' or l.categoria = cat)), '[]'::jsonb));
end $$;
grant execute on function public.guia_cidade(text, text) to anon, authenticated;

-- as cidades que têm guia (para /saloes)
create or replace function public.guia_cidades()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('cidade', x.cidade, 'cidade_slug', x.cidade_slug, 'uf', x.uf, 'total', x.n) order by x.n desc), '[]'::jsonb)
  from (select max(cidade) cidade, cidade_slug, max(uf) uf, count(*) n from public.guia_lugares
         where status = 'publicado' and conteudo is not null group by cidade_slug) x
$$;
grant execute on function public.guia_cidades() to anon, authenticated;

-- tudo o que está no ar, de uma vez: é o que o build lê para gerar o HTML e o sitemap
create or replace function public.guia_publicadas()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'lugares', coalesce((select jsonb_agg(public.guia_publico(l) || jsonb_build_object('vizinhos', public.guia_vizinhos(l, 6)) order by l.cidade_slug, l.slug)
        from public.guia_lugares l where l.status = 'publicado' and l.conteudo is not null), '[]'::jsonb),
    'paginas', coalesce((select jsonb_agg(jsonb_build_object('cidade_slug', p.cidade_slug, 'categoria', p.categoria, 'conteudo', p.conteudo, 'atualizado_em', p.atualizado_em))
        from public.guia_paginas p where p.status = 'publicado' and p.conteudo is not null), '[]'::jsonb),
    'cidades', public.guia_cidades())
$$;
grant execute on function public.guia_publicadas() to anon, authenticated;

-- "quero marcar aqui", "é meu salão", "corrigir", "remover": qualquer pessoa, sem conta
create or replace function public.guia_registrar_interesse(lugar_ uuid, tipo_ text, nome_ text default null, contato_ text default null, mensagem_ text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  n text := nullif(left(btrim(coalesce(nome_, '')), 80), '');
  k text := nullif(left(btrim(coalesce(contato_, '')), 120), '');
  m text := nullif(left(btrim(coalesce(mensagem_, '')), 600), '');
begin
  if tipo_ not in ('quero_marcar', 'sou_dono', 'corrigir', 'remover') then
    return jsonb_build_object('ok', false, 'motivo', 'pedido desconhecido');
  end if;
  if not exists (select 1 from public.guia_lugares where id = lugar_ and status = 'publicado') then
    return jsonb_build_object('ok', false, 'motivo', 'página não encontrada');
  end if;
  if tipo_ <> 'quero_marcar' and k is null then
    return jsonb_build_object('ok', false, 'motivo', 'deixe um WhatsApp ou e-mail para a gente responder');
  end if;
  -- freio para robô: o mesmo contato no mesmo pedido, 3 por dia; a mesma página, 200 por dia
  if k is not null and (select count(*) from public.guia_interesses where lugar_id = lugar_ and tipo = tipo_ and contato = k and criado_em > now() - interval '1 day') >= 3 then
    return jsonb_build_object('ok', true, 'repetido', true);
  end if;
  if (select count(*) from public.guia_interesses where lugar_id = lugar_ and criado_em > now() - interval '1 day') >= 200 then
    return jsonb_build_object('ok', false, 'motivo', 'muitos pedidos hoje; tente amanhã');
  end if;
  insert into public.guia_interesses (lugar_id, tipo, nome, contato, mensagem) values (lugar_, tipo_, n, k, m);
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.guia_registrar_interesse(uuid, text, text, text, text) to anon, authenticated;

-- 5. O que a Plataforma faz ------------------------------------------------------------------
-- importar uma lista de salões (as linhas dos CSVs já normalizadas por packages/core/guia.js).
-- aplicar = false só confere e conta; true grava. O mesmo salão (mesmo place_id, ou mesmo
-- CNPJ, ou mesmo nome na mesma cidade) é atualizado, não duplicado. Campo editado na
-- Plataforma (fontes.campo = 'manual') não é sobrescrito; o CSV da Receita só preenche o
-- que está vazio (o do Google tem o nome e o endereço como o salão divulga); salão
-- removido a pedido nunca volta pela importação.
create or replace function public.guia_importar(itens jsonb, aplicar boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  it jsonb;
  idx bigint;
  ex public.guia_lugares;
  achou boolean;
  origem_ text;
  cidade_ text;
  cslug text;
  nome_ text;
  base text;
  slug_ text;
  n int;
  campo text;
  valor jsonb;
  novos int := 0; atualizados int := 0; ignorados int := 0; validos int := 0;
  problemas jsonb := '[]'::jsonb;
  vistos text[] := '{}';
  chave text;
  cats_ text[] := array['beleza', 'cabelo', 'unhas', 'cilios', 'sobrancelhas', 'barbearia', 'estetica', 'maquiagem'];
  campos text[] := array['nome', 'categoria', 'bairro', 'endereco', 'cep', 'telefone', 'whatsapp', 'instagram', 'site', 'horarios', 'servicos', 'latitude', 'longitude'];
  muda jsonb;
begin
  if not public.eh_plataforma() then raise exception 'só a plataforma importa o guia'; end if;
  if jsonb_typeof(itens) <> 'array' then raise exception 'itens precisa ser uma lista'; end if;

  for it, idx in select value, ordinality from jsonb_array_elements(itens) with ordinality loop
    origem_ := coalesce(nullif(it ->> 'origem', ''), 'manual');
    cidade_ := nullif(btrim(coalesce(it ->> 'cidade', '')), '');
    nome_ := nullif(btrim(coalesce(it ->> 'nome', '')), '');
    if origem_ not in ('google', 'receita', 'manual') then
      problemas := problemas || jsonb_build_object('indice', idx, 'nome', nome_, 'erro', 'origem desconhecida'); continue;
    end if;
    if nome_ is null then problemas := problemas || jsonb_build_object('indice', idx, 'nome', null, 'erro', 'sem nome'); continue; end if;
    if cidade_ is null then problemas := problemas || jsonb_build_object('indice', idx, 'nome', nome_, 'erro', 'sem cidade'); continue; end if;
    if coalesce(it ->> 'categoria', '') <> '' and not ((it ->> 'categoria') = any (cats_)) then
      problemas := problemas || jsonb_build_object('indice', idx, 'nome', nome_, 'erro', 'categoria desconhecida: ' || (it ->> 'categoria')); continue;
    end if;
    cslug := public.guia_slug(cidade_);
    validos := validos + 1;

    -- o mesmo salão: place_id, depois CNPJ, depois nome na cidade
    achou := false;
    if coalesce(it ->> 'place_id', '') <> '' then
      select * into ex from public.guia_lugares where place_id = it ->> 'place_id'; achou := found;
    end if;
    if not achou and coalesce(it ->> 'cnpj', '') <> '' then
      select * into ex from public.guia_lugares where cnpj = it ->> 'cnpj' order by criado_em limit 1; achou := found;
    end if;
    if not achou then
      select * into ex from public.guia_lugares where cidade_slug = cslug and slug = public.guia_slug(nome_); achou := found;
    end if;
    -- repetido dentro do próprio arquivo: conta uma vez só
    chave := coalesce(nullif(it ->> 'place_id', ''), nullif(it ->> 'cnpj', ''), cslug || '/' || public.guia_slug(nome_));
    if chave = any (vistos) then ignorados := ignorados + 1; validos := validos - 1; continue; end if;
    vistos := vistos || chave;

    if achou and ex.status = 'removido' then ignorados := ignorados + 1; continue; end if;

    if not aplicar then
      if achou then atualizados := atualizados + 1; else novos := novos + 1; end if;
      continue;
    end if;

    if not achou then
      base := public.guia_slug(nome_);
      if base = '' then base := 'salao'; end if;
      if base = any (cats_) then base := base || '-' || cslug; end if;
      slug_ := base;
      if exists (select 1 from public.guia_lugares where cidade_slug = cslug and slug = slug_) and coalesce(it ->> 'bairro', '') <> '' then
        slug_ := left(base || '-' || public.guia_slug(it ->> 'bairro'), 60);
      end if;
      n := 2;
      while exists (select 1 from public.guia_lugares where cidade_slug = cslug and slug = slug_) loop
        slug_ := left(base, 56) || '-' || n; n := n + 1;
      end loop;
      insert into public.guia_lugares (cidade, cidade_slug, uf, slug, categoria, nome, bairro, endereco, cep, telefone, whatsapp, instagram, site,
        horarios, servicos, latitude, longitude, place_id, cnpj, validado_receita, selecao, nota, avaliacoes, origem)
      values (cidade_, cslug, coalesce(nullif(it ->> 'uf', ''), 'SP'), slug_, coalesce(nullif(it ->> 'categoria', ''), 'beleza'), nome_,
        nullif(it ->> 'bairro', ''), nullif(it ->> 'endereco', ''), nullif(it ->> 'cep', ''), nullif(it ->> 'telefone', ''), nullif(it ->> 'whatsapp', ''),
        nullif(it ->> 'instagram', ''), nullif(it ->> 'site', ''),
        case when jsonb_typeof(it -> 'horarios') = 'array' then it -> 'horarios' end,
        coalesce((select array_agg(x) from jsonb_array_elements_text(case when jsonb_typeof(it -> 'servicos') = 'array' then it -> 'servicos' else '[]'::jsonb end) x), '{}'),
        (it ->> 'latitude')::double precision, (it ->> 'longitude')::double precision,
        nullif(it ->> 'place_id', ''), nullif(it ->> 'cnpj', ''), coalesce((it ->> 'validado_receita')::boolean, false) or origem_ = 'receita',
        coalesce((it ->> 'selecao')::boolean, false), (it ->> 'nota')::numeric, (it ->> 'avaliacoes')::numeric::int,
        jsonb_build_object(origem_, coalesce(it -> 'bruto', '{}'::jsonb)));
      novos := novos + 1;
      continue;
    end if;

    -- atualizar: campo a campo
    muda := '{}'::jsonb;
    foreach campo in array campos loop
      valor := it -> campo;
      if valor is null or valor = 'null'::jsonb or valor = '""'::jsonb or (jsonb_typeof(valor) = 'array' and jsonb_array_length(valor) = 0) then continue; end if;
      if ex.fontes ->> campo = 'manual' then continue; end if;
      -- a Receita só preenche o que está vazio
      if origem_ = 'receita' and coalesce(to_jsonb(ex) -> campo, 'null'::jsonb) not in ('null'::jsonb, '""'::jsonb, '[]'::jsonb) then continue; end if;
      muda := muda || jsonb_build_object(campo, valor);
    end loop;
    update public.guia_lugares set
      nome = coalesce(muda ->> 'nome', nome),
      categoria = coalesce(muda ->> 'categoria', categoria),
      bairro = coalesce(muda ->> 'bairro', bairro),
      endereco = coalesce(muda ->> 'endereco', endereco),
      cep = coalesce(muda ->> 'cep', cep),
      telefone = coalesce(muda ->> 'telefone', telefone),
      whatsapp = coalesce(muda ->> 'whatsapp', whatsapp),
      instagram = coalesce(muda ->> 'instagram', instagram),
      site = coalesce(muda ->> 'site', site),
      horarios = coalesce(muda -> 'horarios', horarios),
      servicos = coalesce((select array_agg(x) from jsonb_array_elements_text(muda -> 'servicos') x), servicos),
      latitude = coalesce((muda ->> 'latitude')::double precision, latitude),
      longitude = coalesce((muda ->> 'longitude')::double precision, longitude),
      place_id = coalesce(place_id, nullif(it ->> 'place_id', '')),
      cnpj = coalesce(cnpj, nullif(it ->> 'cnpj', '')),
      validado_receita = validado_receita or origem_ = 'receita' or coalesce((it ->> 'validado_receita')::boolean, false),
      selecao = case when it ? 'selecao' and it ->> 'selecao' is not null and coalesce(fontes ->> 'selecao', '') <> 'manual' then (it ->> 'selecao')::boolean else selecao end,
      nota = case when origem_ = 'google' then coalesce((it ->> 'nota')::numeric, nota) else nota end,
      avaliacoes = case when origem_ = 'google' then coalesce((it ->> 'avaliacoes')::numeric::int, avaliacoes) else avaliacoes end,
      origem = origem || jsonb_build_object(origem_, coalesce(it -> 'bruto', '{}'::jsonb))
    where id = ex.id;
    atualizados := atualizados + 1;
  end loop;

  -- toda cidade e toda categoria com salão ganham a linha da página (para gerar o texto)
  if aplicar then
    insert into public.guia_paginas (cidade, cidade_slug, uf, categoria)
      select max(cidade), cidade_slug, max(uf), '' from public.guia_lugares group by cidade_slug
      on conflict (cidade_slug, categoria) do nothing;
    insert into public.guia_paginas (cidade, cidade_slug, uf, categoria)
      select max(cidade), cidade_slug, max(uf), categoria from public.guia_lugares group by cidade_slug, categoria
      on conflict (cidade_slug, categoria) do nothing;
  end if;

  return jsonb_build_object('total', jsonb_array_length(itens), 'validos', validos, 'novos', novos, 'atualizados', atualizados,
    'ignorados', ignorados, 'problemas', problemas, 'aplicado', aplicar);
end $$;
revoke execute on function public.guia_importar(jsonb, boolean) from public, anon;
grant execute on function public.guia_importar(jsonb, boolean) to authenticated;

-- aprovar: a versão em revisão vai para o ar
create or replace function public.guia_aprovar(lugar_ uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l public.guia_lugares;
begin
  if not public.eh_plataforma() then raise exception 'só a plataforma aprova'; end if;
  update public.guia_lugares set
      conteudo = coalesce(rascunho, conteudo), rascunho = null, status = 'publicado',
      publicado_em = coalesce(publicado_em, now()), aprovado_por = auth.uid(), motivo = null
    where id = lugar_ and coalesce(rascunho, conteudo) is not null and status <> 'removido'
    returning * into l;
  if not found then raise exception 'nada para aprovar: gere a página primeiro'; end if;
  return public.guia_publico(l) || jsonb_build_object('status', l.status);
end $$;
revoke execute on function public.guia_aprovar(uuid) from public, anon;
grant execute on function public.guia_aprovar(uuid) to authenticated;

create or replace function public.guia_aprovar_pagina(pagina_ uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p public.guia_paginas;
begin
  if not public.eh_plataforma() then raise exception 'só a plataforma aprova'; end if;
  update public.guia_paginas set conteudo = coalesce(rascunho, conteudo), rascunho = null, status = 'publicado', publicado_em = coalesce(publicado_em, now())
    where id = pagina_ and coalesce(rascunho, conteudo) is not null
    returning * into p;
  if not found then raise exception 'nada para aprovar: gere o texto primeiro'; end if;
  return to_jsonb(p);
end $$;
revoke execute on function public.guia_aprovar_pagina(uuid) from public, anon;
grant execute on function public.guia_aprovar_pagina(uuid) to authenticated;

do $$
declare n int;
begin
  select count(*) into n from public.guia_lugares;
  raise notice '153: guia de salões pronto (guia_lugares, guia_paginas, guia_interesses e as funções guia_*); % salões no guia', n;
end $$;
