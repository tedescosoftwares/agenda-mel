-- 253 · As fotos do guia no S3 da AWS (4.3)
--
-- As fotos do guia eram 96% do Storage do Supabase (736 MB dos 1 GB do plano gratuito) e a maior parte do tráfego.
-- A partir da 4.3 elas vão para o bucket mimo-guia-fotos, na AWS, e saem pelo CloudFront em https://img.mimo.com.vc/
-- (a Plataforma grava pela função guia-fotos; o dono, pela guia-fotos-dono). O caminho dentro do bucket é o mesmo de
-- antes: <salão>/<sha>.jpg, cidades/<cidade>/<sha>.jpg... Só o começo do link muda.
--
--   1. guia_fotos_dono_gravar aceita a foto do dono no S3 (https://img.mimo.com.vc/<salão>/dono-...), além do Supabase.
--   2. guia_fotos_links_antigos(prefixo): os objetos que o banco ainda aponta no bucket 'guia' do Supabase. A cópia
--      (scripts/guia/fotos-s3.mjs, na VPS) confere cada um no S3 antes de trocar os links.
--   3. guia_fotos_trocar_links(antigo, novo): troca o começo dos links em todas as colunas de texto do banco (fotos dos
--      salões, das cidades, categorias, regiões, a imagem das páginas...), sem carimbar a data de atualização dos salões
--      (guia.sem_carimbo, da 185: a página não mudou de conteúdo). Quem chama é a cópia, depois de conferir.
--
-- Nada muda sozinho ao rodar: os links só trocam quando a cópia terminar e chamar a 3. As fotos antigas continuam no
-- Supabase até alguém esvaziar o bucket, então nada quebra no meio do caminho. Só o servidor chama 2 e 3.

-- ---- 1. a foto do dono, no Supabase ou no S3 -------------------------------------------------------------------------
create or replace function public.guia_fotos_dono_gravar(token_ text, urls_ text[])
returns jsonb language plpgsql security definer set search_path = public set plan_cache_mode = force_custom_plan set jit = off as $$
declare
  i public.guia_interesses;
  lug public.guia_lugares;
  atuais text[];
  novas text[] := '{}';
  u text;
  prefixo text;
  prefixo_s3 text;
begin
  if token_ is null then return jsonb_build_object('ok', false, 'motivo', 'link inválido'); end if;
  select * into i from public.guia_interesses where token_fotos = token_ and tipo = 'sou_dono';
  if not found then return jsonb_build_object('ok', false, 'motivo', 'link inválido'); end if;
  if i.status is distinct from 'confirmada' then return jsonb_build_object('ok', false, 'motivo', 'reivindicação não confirmada'); end if;
  if coalesce(i.token_fotos_expira, now()) <= now() then return jsonb_build_object('ok', false, 'motivo', 'link vencido'); end if;
  select * into lug from public.guia_lugares where id = i.lugar_id for update;
  if not found or lug.status = 'removido' then return jsonb_build_object('ok', false, 'motivo', 'página fora do ar'); end if;

  -- só objeto da pasta deste salão, enviado pela função (prefixo dono-): no bucket guia do Supabase (até a 4.3) ou no S3
  prefixo := '/storage/v1/object/public/guia/' || lug.id::text || '/dono-';
  prefixo_s3 := 'https://img.mimo.com.vc/' || lug.id::text || '/dono-';
  atuais := coalesce(lug.fotos, '{}');
  foreach u in array coalesce(urls_, '{}') loop
    if u is null or (position(prefixo in u) = 0 and not starts_with(u, prefixo_s3)) or u ~ '[[:space:]"''<>]' then continue; end if;
    if u = any (atuais) or u = any (novas) then continue; end if;
    if array_length(atuais, 1) is not distinct from 8 or coalesce(array_length(atuais, 1), 0) + coalesce(array_length(novas, 1), 0) >= 8 then exit; end if;
    novas := novas || u;
  end loop;
  if coalesce(array_length(novas, 1), 0) = 0 then
    return jsonb_build_object('ok', true, 'fotos', to_jsonb(atuais), 'novas', 0);
  end if;
  update public.guia_lugares
     set fotos = atuais || novas,
         origem = origem || jsonb_build_object('fotos_dono', jsonb_build_object('em', now(), 'interesse', i.id, 'quantas', array_length(novas, 1),
                    'declaracao', 'enviadas pelo responsável confirmado, que declarou serem do salão'))
   where id = lug.id;
  update public.guia_interesses set fotos_enviadas = fotos_enviadas + array_length(novas, 1), fotos_enviadas_em = now() where id = i.id;
  return jsonb_build_object('ok', true, 'fotos', to_jsonb(atuais || novas), 'novas', array_length(novas, 1));
end $$;
revoke execute on function public.guia_fotos_dono_gravar(text, text[]) from public, anon, authenticated;
grant execute on function public.guia_fotos_dono_gravar(text, text[]) to service_role;

-- ---- as colunas onde um link pode morar ------------------------------------------------------------------------------
-- todas as colunas de texto (text, varchar, json, jsonb e as listas de texto) das tabelas do schema public; as calculadas
-- (generated) ficam de fora, porque não se escreve nelas
create or replace function public.guia_fotos_colunas()
returns table (tabela text, coluna text, tipo text)
language sql stable security definer set search_path = public, pg_catalog as $$
  select c.relname::text, a.attname::text, format_type(a.atttypid, a.atttypmod)
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid = a.attrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
     and a.atttypid in ('text'::regtype, 'varchar'::regtype, 'json'::regtype, 'jsonb'::regtype, 'text[]'::regtype, 'varchar[]'::regtype)
   order by 1, 2
$$;
revoke execute on function public.guia_fotos_colunas() from public, anon, authenticated;

-- o começo de link aceito: https://<projeto>.supabase.co/storage/v1/object/public/guia/ (o antigo) e https://<host>/ (o novo)
create or replace function public.guia_fotos_prefixo_ok(p text, antigo boolean)
returns boolean language sql immutable set search_path = public as $$
  select case when antigo then coalesce(p, '') ~ '^https://[a-z0-9.-]+/storage/v1/object/public/guia/$'
              else coalesce(p, '') ~ '^https://[a-z0-9.-]+/$' end
$$;
revoke execute on function public.guia_fotos_prefixo_ok(text, boolean) from public, anon, authenticated;

-- ---- 2. o que o banco ainda aponta no Supabase -----------------------------------------------------------------------
-- um objeto por linha (sem repetir), e onde ele foi visto primeiro (tabela.coluna): é a lista que a cópia confere no S3
create or replace function public.guia_fotos_links_antigos(prefixo_ text)
returns table (caminho text, onde text)
language plpgsql volatile security definer set search_path = public set jit = off as $$
declare
  col record;
  padrao text;
begin
  if not public.guia_fotos_prefixo_ok(prefixo_, true) then
    raise exception 'prefixo inválido: use https://<projeto>.supabase.co/storage/v1/object/public/guia/';
  end if;
  -- o prefixo vira texto literal na expressão regular (o ponto do domínio não é "qualquer caractere")
  padrao := regexp_replace(prefixo_, '([.+*?^$()\[\]{}|\\])', '\\\1', 'g') || '([A-Za-z0-9/_.~%-]+)';
  create temp table if not exists guia_fotos_achados (caminho text primary key, onde text) on commit drop;
  truncate guia_fotos_achados;
  for col in select * from public.guia_fotos_colunas() loop
    execute format('insert into guia_fotos_achados (caminho, onde) select distinct m[1], %L from public.%I t, regexp_matches(t.%I::text, %L, ''g'') m where strpos(t.%I::text, %L) > 0 on conflict do nothing',
                   col.tabela || '.' || col.coluna, col.tabela, col.coluna, padrao, col.coluna, prefixo_);
  end loop;
  return query select a.caminho, a.onde from guia_fotos_achados a order by a.caminho;
end $$;
revoke execute on function public.guia_fotos_links_antigos(text) from public, anon, authenticated;
grant execute on function public.guia_fotos_links_antigos(text) to service_role;

-- ---- 3. a troca ------------------------------------------------------------------------------------------------------
-- troca o começo dos links em todas as colunas; devolve quantas linhas mudaram em cada uma. Rodar de novo não faz nada
-- (não sobra link antigo). Os salões não ganham data de atualização nova (guia.sem_carimbo): a página é a mesma.
create or replace function public.guia_fotos_trocar_links(antigo_ text, novo_ text)
returns jsonb language plpgsql volatile security definer set search_path = public set jit = off as $$
declare
  col record;
  n bigint;
  total bigint := 0;
  porColuna jsonb := '{}'::jsonb;
begin
  if not public.guia_fotos_prefixo_ok(antigo_, true) then
    raise exception 'link antigo inválido: use https://<projeto>.supabase.co/storage/v1/object/public/guia/';
  end if;
  if not public.guia_fotos_prefixo_ok(novo_, false) then
    raise exception 'link novo inválido: use https://<host>/ (com a barra no fim)';
  end if;
  perform set_config('guia.sem_carimbo', '1', true);
  for col in select * from public.guia_fotos_colunas() loop
    execute format('update public.%I set %I = replace(%I::text, %L, %L)::%s where strpos(%I::text, %L) > 0',
                   col.tabela, col.coluna, col.coluna, antigo_, novo_, col.tipo, col.coluna, antigo_);
    get diagnostics n = row_count;
    if n > 0 then
      porColuna := porColuna || jsonb_build_object(col.tabela || '.' || col.coluna, n);
      total := total + n;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'linhas', total, 'colunas', porColuna);
end $$;
revoke execute on function public.guia_fotos_trocar_links(text, text) from public, anon, authenticated;
grant execute on function public.guia_fotos_trocar_links(text, text) to service_role;

do $$
declare n int;
begin
  select count(*) into n from public.guia_lugares where exists (select 1 from unnest(fotos) f where f like '%/storage/v1/object/public/guia/%');
  raise notice '253: fotos do guia prontas para o S3 (% salões com foto no Supabase; os links trocam quando a cópia terminar)', n;
end $$;
