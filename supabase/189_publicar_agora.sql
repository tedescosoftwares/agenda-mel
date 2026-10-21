-- 189 (3.41): "Publicar agora" na Plataforma, com o que está pendente.
-- O site é feito de páginas estáticas que o VPS regenera (republicar-se-mudou.sh): de hora em hora, ou no build. Agora:
--   - site_publicacoes guarda cada publicação (a da hora, a do build, a pedida na Plataforma) e o pedido em aberto;
--   - site_pendencias() diz o que mudou desde a última publicação: salões que entraram no ar, que mudaram (texto, fotos,
--     dados), que saíram do ar, páginas de cidade, imagens de categoria, regiões, artigos e páginas SEO;
--   - site_pedir_publicacao() faz o pedido (um por vez; clicar de novo não duplica); o VPS confere a cada minuto
--     (site_pegar_pedido, com a chave do gerador), regenera e registra (site_registrar_publicacao);
--   - site_publicacao_status(id) é o que a tela acompanha.
-- O índice em guia_lugares (atualizado_em) deixa a conta das pendências olhar só o que mudou.

create or replace function pg_temp.guia_ddl(comando text, tentativas int default 15)
returns void language plpgsql as $f$
declare i int := 0; antes text := current_setting('lock_timeout');
begin
  loop
    begin
      perform set_config('lock_timeout', '2s', true);
      execute comando;
      perform set_config('lock_timeout', antes, true);
      return;
    exception when lock_not_available then
      i := i + 1;
      if i >= tentativas then
        raise exception 'a tabela está presa por outra sessão (% tentativas de 2 s: %). No SQL Editor: select pid, state, now() - xact_start as ha, left(query, 70) from pg_stat_activity where state <> ''idle''; encerre a que segura a tabela com select pg_terminate_backend(<pid>); e rode de novo', tentativas, left(comando, 70);
      end if;
      raise notice 'tabela ocupada por outra sessão, tentando de novo em 2 s (% de %): %', i, tentativas, left(comando, 60);
      perform pg_sleep(2);
    end;
  end loop;
end $f$;

create table if not exists public.site_publicacoes (
  id bigserial primary key,
  origem text not null default 'plataforma' check (origem in ('plataforma', 'automatico', 'manual')),
  status text not null default 'pedido' check (status in ('pedido', 'rodando', 'feito', 'falhou')),
  pedido_em timestamptz,
  pedido_por uuid,
  inicio_em timestamptz,
  fim_em timestamptz,
  versao text,
  urls integer,
  resumo text,
  pendencias jsonb
);
comment on table public.site_publicacoes is 'Site (189): cada publicação das páginas estáticas (pedida na Plataforma, a da hora ou a do build) e o pedido em aberto; o VPS pega e registra com a chave do gerador.';
create index if not exists site_publicacoes_aberto on public.site_publicacoes (id) where status in ('pedido', 'rodando');
create index if not exists site_publicacoes_feito on public.site_publicacoes (inicio_em desc) where status = 'feito';
alter table public.site_publicacoes enable row level security; -- sem política: só as funções do banco mexem
revoke all on public.site_publicacoes from public, anon, authenticated;

select pg_temp.guia_ddl('create index if not exists guia_lugares_atualizado on public.guia_lugares (atualizado_em)');

-- o pedido que ficou parado (o servidor caiu no meio, ou o cron do minuto não está ligado) vence em 30 minutos
create or replace function public.site_vencer_pedidos()
returns void language sql security definer set search_path = public as $$
  update public.site_publicacoes set status = 'falhou', fim_em = now(),
         resumo = coalesce(resumo, case when status = 'pedido' then 'o servidor não pegou o pedido em 30 minutos (o cron do minuto está ligado? ./republicar-se-mudou.sh --cron)' else 'o servidor não terminou em 30 minutos' end)
   where status in ('pedido', 'rodando') and coalesce(inicio_em, pedido_em) < now() - interval '30 minutes'
$$;
revoke execute on function public.site_vencer_pedidos() from public, anon, authenticated;

-- o que mudou desde a última publicação (o começo dela: o que mudou durante a geração conta como pendente de novo)
create or replace function public.site_pendencias()
returns jsonb language plpgsql security definer set search_path = public as $$
declare desde timestamptz; ult public.site_publicacoes; aberto public.site_publicacoes; atual text; r jsonb;
begin
  if not public.eh_plataforma() then raise exception 'só a plataforma vê as pendências do site'; end if;
  perform public.site_vencer_pedidos();
  select * into ult from public.site_publicacoes where status = 'feito' order by inicio_em desc nulls last, id desc limit 1;
  select * into aberto from public.site_publicacoes where status in ('pedido', 'rodando') order by id desc limit 1;
  desde := ult.inicio_em;
  atual := public.site_conteudo_versao();
  with m as (
    select l.nome, coalesce(l.cidade, l.cidade_slug) as cidade, l.atualizado_em,
           case when l.status = 'publicado' and l.conteudo is not null and l.publicado_em > desde then 'entraram'
                when l.status = 'publicado' and l.conteudo is not null then 'mudaram'
                when l.publicado_em is not null then 'sairam' end as tipo
      from public.guia_lugares l
     where desde is not null and l.atualizado_em > desde
  ), t as (select * from m where tipo is not null)
  select jsonb_build_object(
    'sem_registro', desde is null,
    'pendente', ult.id is null or atual is distinct from ult.versao,
    'versao_atual', atual,
    'ultima', case when ult.id is null then null else jsonb_build_object('id', ult.id, 'origem', ult.origem, 'inicio_em', ult.inicio_em, 'fim_em', ult.fim_em, 'urls', ult.urls) end,
    'em_andamento', case when aberto.id is null then null else jsonb_build_object('id', aberto.id, 'status', aberto.status, 'pedido_em', aberto.pedido_em, 'inicio_em', aberto.inicio_em) end,
    'saloes', jsonb_build_object(
      'entraram', (select count(*) from t where tipo = 'entraram'),
      'mudaram', (select count(*) from t where tipo = 'mudaram'),
      'sairam', (select count(*) from t where tipo = 'sairam')),
    'por_cidade', (select coalesce(jsonb_agg(jsonb_build_object('cidade', c.cidade, 'entraram', c.e, 'mudaram', c.m, 'sairam', c.s) order by c.n desc, c.cidade), '[]'::jsonb)
                     from (select cidade, count(*) as n, count(*) filter (where tipo = 'entraram') as e, count(*) filter (where tipo = 'mudaram') as m,
                                  count(*) filter (where tipo = 'sairam') as s
                             from t group by cidade order by count(*) desc limit 12) c),
    'exemplos', jsonb_build_object(
      'entraram', (select coalesce(jsonb_agg(x.nome), '[]'::jsonb) from (select nome from t where tipo = 'entraram' order by atualizado_em desc limit 5) x),
      'mudaram', (select coalesce(jsonb_agg(x.nome), '[]'::jsonb) from (select nome from t where tipo = 'mudaram' order by atualizado_em desc limit 5) x),
      'sairam', (select coalesce(jsonb_agg(x.nome), '[]'::jsonb) from (select nome from t where tipo = 'sairam' order by atualizado_em desc limit 5) x)),
    'paginas', (select count(*) from public.guia_paginas p where desde is not null and p.atualizado_em > desde
                  and ((p.status = 'publicado' and p.conteudo is not null) or coalesce(p.foto, '') <> '')),
    'categorias', (select count(*) from public.guia_categorias g where desde is not null and g.atualizado_em > desde),
    'regioes', (select count(*) from public.guia_regioes g where desde is not null and g.atualizado_em > desde)
             + (select count(*) from public.guia_cidades_regiao g where desde is not null and g.atualizado_em > desde),
    'artigos', (select count(*) from public.blog_posts b where desde is not null and b.updated_at > desde and b.status = 'published'),
    'seo', (select count(*) from public.seo_pages s where desde is not null and s.updated_at > desde and s.status = 'published')
  ) into r;
  return r;
end $$;
comment on function public.site_pendencias() is 'Site (189): o que mudou desde a última publicação das páginas estáticas (salões que entraram, mudaram e saíram do ar, páginas de cidade, categorias, regiões, artigos, páginas SEO) e a publicação em andamento.';
revoke execute on function public.site_pendencias() from public, anon;
grant execute on function public.site_pendencias() to authenticated;

-- o pedido de "Publicar agora": um aberto por vez (clicar de novo devolve o mesmo)
create or replace function public.site_pedir_publicacao()
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.site_publicacoes; novo bigint;
begin
  if not public.eh_plataforma() then raise exception 'só a plataforma pede a publicação do site'; end if;
  perform public.site_vencer_pedidos();
  select * into a from public.site_publicacoes where status in ('pedido', 'rodando') order by id desc limit 1;
  if found then return jsonb_build_object('id', a.id, 'status', a.status, 'ja_havia', true); end if;
  insert into public.site_publicacoes (origem, status, pedido_em, pedido_por, pendencias)
    values ('plataforma', 'pedido', now(), auth.uid(), public.site_pendencias() - 'em_andamento' - 'ultima')
    returning id into novo;
  return jsonb_build_object('id', novo, 'status', 'pedido', 'ja_havia', false);
end $$;
revoke execute on function public.site_pedir_publicacao() from public, anon;
grant execute on function public.site_pedir_publicacao() to authenticated;

-- o que a tela acompanha enquanto o servidor trabalha
create or replace function public.site_publicacao_status(id_ bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p public.site_publicacoes;
begin
  if not public.eh_plataforma() then raise exception 'só a plataforma acompanha a publicação do site'; end if;
  perform public.site_vencer_pedidos();
  select * into p from public.site_publicacoes where id = id_;
  if not found then return null; end if;
  return jsonb_build_object('id', p.id, 'status', p.status, 'origem', p.origem, 'pedido_em', p.pedido_em, 'inicio_em', p.inicio_em,
                            'fim_em', p.fim_em, 'urls', p.urls, 'resumo', p.resumo, 'agora', now());
end $$;
revoke execute on function public.site_publicacao_status(bigint) from public, anon;
grant execute on function public.site_publicacao_status(bigint) to authenticated;

-- o VPS: pega o pedido em aberto (se houver) e marca como "rodando"; devolve também a hora do banco, que vira o começo
-- da publicação (a régua das pendências é a do banco, não a do relógio do VPS) e a versão do conteúdo nesse instante
create or replace function public.site_pegar_pedido(chave_ text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare x bigint;
begin
  if coalesce(chave_, '') = '' or chave_ is distinct from (select s.valor from public.guia_segredos s where s.nome = 'gerador') then
    raise exception 'chave do gerador inválida' using errcode = '28000';
  end if;
  perform public.site_vencer_pedidos();
  if not exists (select 1 from public.site_publicacoes where status = 'rodando') then
    update public.site_publicacoes set status = 'rodando', inicio_em = now()
     where id = (select id from public.site_publicacoes where status = 'pedido' order by id limit 1 for update skip locked)
     returning id into x;
  end if;
  return jsonb_build_object('id', x, 'agora', now(), 'versao', public.site_conteudo_versao());
end $$;
revoke execute on function public.site_pegar_pedido(text) from public;
grant execute on function public.site_pegar_pedido(text) to anon, authenticated;

-- o VPS registra o fim: o pedido (id_) ou uma publicação sem pedido (a da hora, a do build)
create or replace function public.site_registrar_publicacao(chave_ text, id_ bigint default null, ok_ boolean default true, origem_ text default 'automatico',
                                                            inicio_ timestamptz default null, versao_ text default null, urls_ integer default null, resumo_ text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare corte bigint;
begin
  if coalesce(chave_, '') = '' or chave_ is distinct from (select s.valor from public.guia_segredos s where s.nome = 'gerador') then
    raise exception 'chave do gerador inválida' using errcode = '28000';
  end if;
  if id_ is not null and exists (select 1 from public.site_publicacoes where id = id_) then
    update public.site_publicacoes set status = case when ok_ then 'feito' else 'falhou' end, fim_em = now(),
           inicio_em = coalesce(inicio_em, inicio_, now()), versao = nullif(versao_, ''), urls = urls_, resumo = left(resumo_, 2000)
     where id = id_;
  else
    insert into public.site_publicacoes (origem, status, inicio_em, fim_em, versao, urls, resumo)
      values (case when origem_ in ('automatico', 'manual') then origem_ else 'manual' end, case when ok_ then 'feito' else 'falhou' end,
              coalesce(inicio_, now()), now(), nullif(versao_, ''), urls_, left(resumo_, 2000));
  end if;
  -- guarda as últimas 500
  select id into corte from public.site_publicacoes order by id desc offset 500 limit 1;
  if corte is not null then delete from public.site_publicacoes where id <= corte; end if;
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.site_registrar_publicacao(text, bigint, boolean, text, timestamptz, text, integer, text) from public;
grant execute on function public.site_registrar_publicacao(text, bigint, boolean, text, timestamptz, text, integer, text) to anon, authenticated;

do $$
begin
  raise notice '189: site_publicacoes, site_pendencias(), site_pedir_publicacao(), site_publicacao_status(), site_pegar_pedido(), site_registrar_publicacao()';
end $$;
