-- 164: fotos nos salões do guia, a data de atualização honesta e a versão do
-- conteúdo publicado (3.14).
--
-- 1. A data que vai para o sitemap (lastmod) e para o "atualizados em" da
--    página é atualizado_em. Até aqui qualquer update mexia nela, inclusive
--    reimportar um CSV que não mudou nada do que a página mostra: as 500
--    páginas amanheciam "atualizadas hoje" e o Google via uma mudança que
--    não houve. Agora o gatilho só anda a data quando muda algo que a
--    página mostra (nome, endereço, horário, serviços, atributos, texto,
--    status, selo, fotos…). Mexer em nota, avaliações, origem, fontes,
--    place_id, CNPJ, rascunho ou gerado_em não conta. E as datas que a
--    reimportação inflou voltam para a data da publicação de cada página:
--    é a data original, a que o Google já conhecia.
-- 2. guia_lugares.fotos: as fotos da página, enviadas pela Plataforma para o
--    bucket 'guia' (público). Regra da casa, escrita na própria tela: só
--    foto que o salão mandou ou autorizou, ou que a equipe tirou; nada
--    copiado do Google ou do Instagram, porque a foto é de quem publicou.
--    Salão que já está na MIMO sem foto própria no guia usa as fotos da
--    página dele na MIMO (salons.fotos), que são dele mesmo.
-- 3. site_conteudo_versao(): um carimbo do que está publicado (artigos,
--    páginas SEO, salões e páginas do guia). O servidor confere de hora em
--    hora e, se mudou, regenera o HTML estático e o sitemap sem precisar
--    de build (evolution/republicar-se-mudou.sh). Pode ser chamada por
--    qualquer um: só diz "mudou", nada do conteúdo.
-- Idempotente.

-- ---- 1. a data só anda quando a página muda -----------------------------------------------------
create or replace function public.guia_tocar()
returns trigger language plpgsql as $$
declare
  -- o que a página NÃO mostra: mexer só nisso não é atualização
  internos text[] := array['atualizado_em', 'criado_em', 'nota', 'avaliacoes', 'origem', 'fontes', 'place_id', 'cnpj',
                           'motivo', 'aprovado_por', 'rascunho', 'gerado_em'];
begin
  if tg_op = 'UPDATE' and (to_jsonb(new) - internos) = (to_jsonb(old) - internos) then
    return new; -- nada visível mudou: fica a data que estava (ou a que o update mandou de propósito)
  end if;
  new.atualizado_em := now();
  return new;
end $$;
comment on function public.guia_tocar() is 'Guia (164): atualizado_em só anda quando muda algo que a página mostra.';
drop trigger if exists guia_lugares_tocar on public.guia_lugares;
create trigger guia_lugares_tocar before update on public.guia_lugares for each row execute function public.guia_tocar();
drop trigger if exists guia_paginas_tocar on public.guia_paginas;
create trigger guia_paginas_tocar before update on public.guia_paginas for each row execute function public.guia_tocar();

-- as datas infladas pela reimportação voltam para a data em que cada página foi publicada
update public.guia_lugares
   set atualizado_em = coalesce(publicado_em, gerado_em, criado_em)
 where status = 'publicado' and atualizado_em > coalesce(publicado_em, gerado_em, criado_em);
update public.guia_paginas
   set atualizado_em = coalesce(publicado_em, gerado_em, criado_em)
 where status = 'publicado' and atualizado_em > coalesce(publicado_em, gerado_em, criado_em);

-- ---- 2. as fotos ---------------------------------------------------------------------------------
alter table public.guia_lugares add column if not exists fotos text[] not null default '{}';
comment on column public.guia_lugares.fotos is 'Guia (164): endereços públicos das fotos da página (bucket guia), na ordem; a primeira é a capa. Só foto que o salão mandou ou autorizou.';

insert into storage.buckets (id, name, public) values ('guia', 'guia', true) on conflict (id) do nothing;
do $$ begin
  update storage.buckets set file_size_limit = 6 * 1024 * 1024, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'] where id = 'guia';
exception when undefined_column then null; end $$;
drop policy if exists "fotos do guia sao publicas" on storage.objects;
create policy "fotos do guia sao publicas" on storage.objects for select using (bucket_id = 'guia');
drop policy if exists "plataforma envia foto do guia" on storage.objects;
create policy "plataforma envia foto do guia" on storage.objects for insert to authenticated
  with check (bucket_id = 'guia' and (public.is_admin() or public.eh_plataforma()));
drop policy if exists "plataforma troca foto do guia" on storage.objects;
create policy "plataforma troca foto do guia" on storage.objects for update to authenticated
  using (bucket_id = 'guia' and (public.is_admin() or public.eh_plataforma()));
drop policy if exists "plataforma remove foto do guia" on storage.objects;
create policy "plataforma remove foto do guia" on storage.objects for delete to authenticated
  using (bucket_id = 'guia' and (public.is_admin() or public.eh_plataforma()));

-- as fotos que a página mostra: as do guia; sem elas, as da página do salão na MIMO (são dele)
create or replace function public.guia_fotos(l public.guia_lugares)
returns text[] language sql stable set search_path = public as $$
  select case
    when coalesce(array_length(l.fotos, 1), 0) > 0 then l.fotos[1:8]
    when l.salon_id is not null then coalesce((select s.fotos[1:8] from public.salons s where s.id = l.salon_id), '{}'::text[])
    else '{}'::text[] end
$$;
revoke execute on function public.guia_fotos(public.guia_lugares) from public, anon;

create or replace function public.guia_cartao(l public.guia_lugares)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object('slug', l.slug, 'nome', l.nome, 'bairro', l.bairro, 'categoria', l.categoria,
    'resumo', l.conteudo ->> 'resumo', 'servicos', to_jsonb((coalesce(l.servicos, '{}'))[1:4]),
    'selecao', l.selecao, 'na_mimo', l.salon_id is not null,
    'latitude', round(l.latitude::numeric, 5), 'longitude', round(l.longitude::numeric, 5),
    'foto', (public.guia_fotos(l))[1])
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
    'fotos', to_jsonb(public.guia_fotos(l)),
    'conteudo', l.conteudo, 'publicado_em', l.publicado_em, 'atualizado_em', l.atualizado_em)
$$;
revoke execute on function public.guia_publico(public.guia_lugares) from public, anon;

-- as coleções (157, 163) ganham a capa de cada salão
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
        'latitude', round(l.latitude::numeric, 5), 'longitude', round(l.longitude::numeric, 5),
        'foto', (public.guia_fotos(l))[1])
      order by l.salon_id is null, not l.selecao, l.nome)
      from public.guia_lugares l
      where l.cidade_slug = c and l.status = 'publicado' and l.conteudo is not null), '[]'::jsonb));
end $$;
revoke execute on function public.guia_colecoes(text) from public;
grant execute on function public.guia_colecoes(text) to anon, authenticated;

-- ---- 3. a versão do conteúdo publicado ----------------------------------------------------------
-- Um carimbo curto que muda sempre que algo publicado muda, entra ou sai:
-- artigos e páginas SEO (status, updated_at), salões e páginas do guia
-- (status, atualizado_em). Quem chama só fica sabendo que mudou.
create or replace function public.site_conteudo_versao()
returns text language sql stable security definer set search_path = public as $$
  select md5(concat_ws('|',
    (select concat(count(*), '/', max(updated_at)) from public.blog_posts where status = 'published'),
    (select concat(count(*), '/', max(updated_at)) from public.seo_pages where status = 'published'),
    (select concat(count(*), '/', max(atualizado_em)) from public.guia_lugares where status = 'publicado' and conteudo is not null),
    (select concat(count(*), '/', max(atualizado_em)) from public.guia_paginas where status = 'publicado' and conteudo is not null)))
$$;
comment on function public.site_conteudo_versao() is 'Site (164): carimbo do conteúdo publicado; o servidor regenera as páginas estáticas quando ele muda.';
revoke execute on function public.site_conteudo_versao() from public;
grant execute on function public.site_conteudo_versao() to anon, authenticated;

do $$
declare n int; f int;
begin
  select count(*), count(*) filter (where coalesce(array_length(fotos, 1), 0) > 0) into n, f from public.guia_lugares where status = 'publicado';
  raise notice '164: % salões no ar, % com fotos; datas de atualização de volta às originais', n, f;
end $$;
