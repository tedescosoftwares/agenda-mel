-- 190: as fotos no "Publicar agora", o servidor que confere os pedidos e a Abordagem com o guia grande (3.42).
--
-- 1. Fotos. guia_lugares.fotos_em anda quando as fotos do salão do guia mudam (guia_tocar) e quando o salão da MIMO
--    ligado a ele troca as fotos dele (a página mostra as do salão quando o guia não tem foto própria). Antes, a foto
--    do salão da MIMO não mudava nada no guia: o gerador (que só busca o que mudou) e o botão não a viam, e ela só
--    entrava na volta diária da cidade inteira. Agora ela carimba os salões do guia ligados, entra na próxima
--    publicação e aparece no botão como "salões com fotos novas" (site_pendencias).
-- 2. O servidor. site_pegar_pedido guarda a hora em que o VPS conferiu (site_servidor); a tela do "Publicar agora"
--    diz na hora se o servidor está conferindo ou se o cron do minuto não está ligado.
-- 3. Abordagem. guia_fila_abordagem montava o detalhe de todo salão no ar (com 13 mil: 9 s e 14 MB, acima do tempo
--    limite). Agora a prioridade de todos é calculada barata, a lista vem ordenada em páginas (cidade, filtro e busca
--    no banco) e só a página que vai para a tela traz o detalhe; os números das abas e o funil vêm prontos.

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

-- ---- 1. fotos -------------------------------------------------------------------------------------------------
select pg_temp.guia_ddl('alter table public.guia_lugares add column if not exists fotos_em timestamptz');
comment on column public.guia_lugares.fotos_em is 'Guia (190): quando as fotos que a página mostra mudaram por último (as do guia ou as do salão da MIMO ligado).';

create or replace function public.guia_tocar()
returns trigger language plpgsql as $$
declare
  -- o que a página NÃO mostra: mexer só nisso não é atualização
  internos text[] := array['atualizado_em', 'criado_em', 'nota', 'avaliacoes', 'origem', 'fontes', 'place_id', 'cnpj',
                           'motivo', 'aprovado_por', 'rascunho', 'gerado_em', 'contexto', 'pontos', 'fotos_em'];
begin
  -- 185: o preenchimento de pontos (e qualquer carga interna) pede para não carimbar: set_config('guia.sem_carimbo', '1', true)
  if current_setting('guia.sem_carimbo', true) = '1' then return new; end if;
  if tg_op = 'UPDATE' then
    if tg_table_name = 'guia_lugares' then
      -- o caminho rápido (184): o que aprovar, tirar do ar, descartar e as fotos mudam
      if new.status is distinct from old.status or new.conteudo is distinct from old.conteudo or new.fotos is distinct from old.fotos then
        new.atualizado_em := now();
        if new.fotos is distinct from old.fotos then new.fotos_em := now(); end if; -- 190
        return new;
      end if;
    end if;
    if (to_jsonb(new) - internos) = (to_jsonb(old) - internos) then
      return new; -- nada visível mudou: fica a data que estava (ou a que o update mandou de propósito)
    end if;
  end if;
  new.atualizado_em := now();
  return new;
end $$;
comment on function public.guia_tocar() is 'Guia (164, 170, 184, 185, 190): atualizado_em só anda quando muda algo que a página mostra; em guia_lugares, status, conteudo ou fotos mudados já bastam, sem serializar a linha, e fotos mudadas carimbam fotos_em; pontos é derivado e não conta.';

-- o salão da MIMO que muda as fotos dele: os salões do guia ligados a ele e sem foto própria recontam os pontos e,
-- 190, ficam carimbados (atualizado_em e fotos_em): a página deles mostra as fotos novas na próxima publicação
create or replace function public.guia_pontos_do_salao()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.fotos is distinct from old.fotos then
    update public.guia_lugares l set pontos = public.guia_pontos_calc(l), atualizado_em = now(), fotos_em = now()
     where l.salon_id = new.id and coalesce(array_length(l.fotos, 1), 0) = 0;
  end if;
  return new;
end $$;

-- ---- 2. o servidor que confere os pedidos ---------------------------------------------------------------------
create table if not exists public.site_servidor (
  id integer primary key default 1 check (id = 1),
  conferiu_em timestamptz,
  ocupado boolean not null default false -- conferiu, mas estava no meio de outra publicação (a da hora, um build)
);
alter table public.site_servidor add column if not exists ocupado boolean not null default false; -- quem rodou uma versão anterior da 190
comment on table public.site_servidor is 'Site (190): a última vez que o VPS conferiu os pedidos do "Publicar agora" (site_pegar_pedido, a cada minuto pelo cron).';
alter table public.site_servidor enable row level security; -- sem política: só as funções do banco mexem
revoke all on public.site_servidor from public, anon, authenticated;

-- pegar_ = false: o servidor conferiu, mas está ocupado com outra publicação (só marca a hora e o "ocupado")
drop function if exists public.site_pegar_pedido(text);
create or replace function public.site_pegar_pedido(chave_ text, pegar_ boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare x bigint;
begin
  if coalesce(chave_, '') = '' or chave_ is distinct from (select s.valor from public.guia_segredos s where s.nome = 'gerador') then
    raise exception 'chave do gerador inválida' using errcode = '28000';
  end if;
  insert into public.site_servidor (id, conferiu_em, ocupado) values (1, now(), not coalesce(pegar_, true))
    on conflict (id) do update set conferiu_em = excluded.conferiu_em, ocupado = excluded.ocupado; -- 190: o servidor está conferindo
  if not coalesce(pegar_, true) then return jsonb_build_object('id', null, 'agora', now(), 'versao', null); end if;
  perform public.site_vencer_pedidos();
  if not exists (select 1 from public.site_publicacoes where status = 'rodando') then
    update public.site_publicacoes set status = 'rodando', inicio_em = now()
     where id = (select id from public.site_publicacoes where status = 'pedido' order by id limit 1 for update skip locked)
     returning id into x;
  end if;
  return jsonb_build_object('id', x, 'agora', now(), 'versao', public.site_conteudo_versao());
end $$;
revoke execute on function public.site_pegar_pedido(text, boolean) from public;
grant execute on function public.site_pegar_pedido(text, boolean) to anon, authenticated;

create or replace function public.site_publicacao_status(id_ bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p public.site_publicacoes;
begin
  if not public.eh_plataforma() then raise exception 'só a plataforma acompanha a publicação do site'; end if;
  perform public.site_vencer_pedidos();
  select * into p from public.site_publicacoes where id = id_;
  if not found then return null; end if;
  return jsonb_build_object('id', p.id, 'status', p.status, 'origem', p.origem, 'pedido_em', p.pedido_em, 'inicio_em', p.inicio_em,
                            'fim_em', p.fim_em, 'urls', p.urls, 'resumo', p.resumo, 'agora', now(),
                            'servidor_conferiu_em', (select conferiu_em from public.site_servidor where id = 1),
                            'servidor_ocupado', coalesce((select ocupado from public.site_servidor where id = 1), false));
end $$;
revoke execute on function public.site_publicacao_status(bigint) from public, anon;
grant execute on function public.site_publicacao_status(bigint) to authenticated;

-- o que mudou desde a última publicação; 190: "fotos" (salão que já estava no ar e trocou as fotos) e o servidor
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
                when l.status = 'publicado' and l.conteudo is not null and l.fotos_em > desde then 'fotos'
                when l.status = 'publicado' and l.conteudo is not null then 'mudaram'
                when l.publicado_em is not null then 'sairam' end as tipo
      from public.guia_lugares l
     where desde is not null and l.atualizado_em > desde
  ), t as (select * from m where tipo is not null)
  select jsonb_build_object(
    'sem_registro', desde is null,
    'pendente', ult.id is null or atual is distinct from ult.versao,
    'versao_atual', atual,
    'servidor_conferiu_em', (select conferiu_em from public.site_servidor where id = 1),
    'servidor_ocupado', coalesce((select ocupado from public.site_servidor where id = 1), false),
    'ultima', case when ult.id is null then null else jsonb_build_object('id', ult.id, 'origem', ult.origem, 'inicio_em', ult.inicio_em, 'fim_em', ult.fim_em, 'urls', ult.urls) end,
    'em_andamento', case when aberto.id is null then null else jsonb_build_object('id', aberto.id, 'status', aberto.status, 'pedido_em', aberto.pedido_em, 'inicio_em', aberto.inicio_em) end,
    'saloes', jsonb_build_object(
      'entraram', (select count(*) from t where tipo = 'entraram'),
      'fotos', (select count(*) from t where tipo = 'fotos'),
      'mudaram', (select count(*) from t where tipo = 'mudaram'),
      'sairam', (select count(*) from t where tipo = 'sairam')),
    'por_cidade', (select coalesce(jsonb_agg(jsonb_build_object('cidade', c.cidade, 'entraram', c.e, 'fotos', c.f, 'mudaram', c.m, 'sairam', c.s) order by c.n desc, c.cidade), '[]'::jsonb)
                     from (select cidade, count(*) as n, count(*) filter (where tipo = 'entraram') as e, count(*) filter (where tipo = 'fotos') as f,
                                  count(*) filter (where tipo = 'mudaram') as m, count(*) filter (where tipo = 'sairam') as s
                             from t group by cidade order by count(*) desc limit 12) c),
    'exemplos', jsonb_build_object(
      'entraram', (select coalesce(jsonb_agg(x.nome), '[]'::jsonb) from (select nome from t where tipo = 'entraram' order by atualizado_em desc limit 5) x),
      'fotos', (select coalesce(jsonb_agg(x.nome), '[]'::jsonb) from (select nome from t where tipo = 'fotos' order by atualizado_em desc limit 5) x),
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
revoke execute on function public.site_pendencias() from public, anon;
grant execute on function public.site_pendencias() to authenticated;

-- ---- 3. a fila de abordagem em páginas ------------------------------------------------------------------------
-- dias: o período dos números (até 400). lugar_: só um salão (depois de uma ação, a tela pede de novo só a linha).
-- cidade_: só a cidade (slug); vazio = todas. visao_: todos (padrão), fila, lembretes, pedidos ou um status.
-- busca_: nome, bairro, cidade, categoria ou a nota (sem acento). limite e depois: a página (até 2.000 por vez).
-- Devolve itens (só a página, com o detalhe de sempre), total (do filtro), mais (há outra página) e resumo
-- (os números das abas e o funil, da cidade inteira ou de todas, sem o filtro e sem a busca).
-- jit = off: o plano parece caro ao Postgres (as frases dos motivos) e ele gastava 3 s compilando uma consulta de 0,3 s.
-- force_custom_plan: depois de 5 chamadas na mesma conexão o PL/pgSQL passava a um plano genérico, sem saber a cidade,
-- o filtro e a página, e a página 2 levava 11 s; assim cada chamada tem o plano dela.
drop function if exists public.guia_fila_abordagem(integer, uuid);
create or replace function public.guia_fila_abordagem(dias integer default 30, lugar_ uuid default null, cidade_ text default null,
                                                      visao_ text default null, busca_ text default null,
                                                      limite integer default 500, depois integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public set jit = off set plan_cache_mode = force_custom_plan as $$
declare
  ndias integer := greatest(1, least(coalesce(dias, 30), 400));
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  de timestamptz;
  lim integer := greatest(1, least(coalesce(limite, 500), 2000));
  pula integer := greatest(0, coalesce(depois, 0));
  cid text := nullif(lower(btrim(coalesce(cidade_, ''))), '');
  vis text := coalesce(nullif(btrim(coalesce(visao_, '')), ''), 'todos');
  acentos constant text := 'ÁÀÂÃÄÅáàâãäåÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñÝýÿ';
  sem constant text := 'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNnYyy';
  termo text := nullif(lower(translate(btrim(coalesce(busca_, '')), acentos, sem)), '');
  r jsonb;
begin
  if not public.eh_plataforma() then raise exception 'só a plataforma vê a fila de abordagem'; end if;
  de := ((hoje - (ndias - 1))::timestamp) at time zone 'America/Sao_Paulo';

  with
  -- os pedidos ainda não atendidos, de qualquer data
  pend as materialized (
    select i.lugar_id,
           count(*) filter (where i.tipo = 'quero_marcar') as quero_marcar,
           count(*) filter (where i.tipo = 'sou_dono') as sou_dono,
           count(*) filter (where i.tipo = 'remover') as remover,
           count(*) filter (where i.tipo = 'corrigir') as corrigir,
           (array_agg(jsonb_build_object('nome', i.nome, 'contato', i.contato, 'email', i.email, 'ligacao', i.ligacao, 'mensagem', i.mensagem, 'em', i.criado_em) order by i.criado_em desc)
              filter (where i.tipo = 'sou_dono' and (i.contato is not null or i.email is not null)))[1] as dono
      from public.guia_interesses i
     where i.atendido_em is null and (lugar_ is null or i.lugar_id = lugar_)
     group by i.lugar_id
  ),
  -- as visitas e os toques do período, por salão (o que entra na prioridade)
  ev as materialized (
    select e.lugar_id,
           count(*) filter (where e.tipo = 'visita') as visitas,
           count(*) filter (where t.grupo = 'contato') as contatos
      from public.site_eventos e join public.site_eventos_tipos t using (tipo)
     where e.em >= de and e.lugar_id is not null and (lugar_ is null or e.lugar_id = lugar_)
     group by e.lugar_id
  ),
  hist as materialized (
    select h.lugar_id,
           count(*) filter (where h.tipo in ('whatsapp', 'ligacao', 'instagram', 'presencial', 'email')) as tentativas,
           max(public.guia_abordagem_etapa(h.para_status)) as etapa_hist
      from public.guia_abordagem_acoes h
     where lugar_ is null or h.lugar_id = lugar_
     group by h.lugar_id
  ),
  -- quem entra: no ar, ou fora do ar com pedido aberto ou conversa começada; removido nunca
  cand as materialized (
    select l.id, l.nome, l.status as status_pagina, l.salon_id, l.nota as nota_google, l.avaliacoes,
           a.lugar_id is not null as tem_registro, a.status as status_salvo, a.proximo_contato,
           coalesce(p.quero_marcar, 0) as p_quero, coalesce(p.sou_dono, 0) as p_dono,
           coalesce(p.remover, 0) as p_remover, coalesce(p.corrigir, 0) as p_corrigir,
           coalesce(ev.visitas, 0) as visitas, coalesce(ev.contatos, 0) as contatos,
           coalesce(h.tentativas, 0) as tentativas, h.etapa_hist,
           public.guia_tem_zap(l.whatsapp, l.telefone) as tem_zap,
           case when l.salon_id is not null then 'cliente' else coalesce(a.status, 'a_abordar') end as status_ef,
           hoje - (a.ultimo_contato_em at time zone 'America/Sao_Paulo')::date as dias_desde_contato
      from public.guia_lugares l
      left join public.guia_abordagens a on a.lugar_id = l.id
      left join pend p on p.lugar_id = l.id
      left join ev on ev.lugar_id = l.id
      left join hist h on h.lugar_id = l.id
     where l.status <> 'removido' and (lugar_ is null or l.id = lugar_) and (cid is null or l.cidade_slug = cid)
       and (l.status = 'publicado' or a.lugar_id is not null or coalesce(p.sou_dono, 0) + coalesce(p.quero_marcar, 0) > 0)
       and (termo is null or lower(translate(l.nome || ' ' || coalesce(l.bairro, '') || ' ' || coalesce(l.cidade, '') || ' ' || coalesce(l.categoria, '') || ' ' || coalesce(a.nota, ''), acentos, sem))
                             like '%' || termo || '%')
  ),
  -- a prioridade (a mesma conta dos motivos, sem montar as frases) e o que a tela precisa para filtrar e contar
  calc as materialized (
    select c.*,
           (coalesce(case when c.p_dono > 0 then 120 + 20 * least(c.p_dono - 1, 2) end, 0)
            + coalesce(case when c.p_quero > 0 then 40 * least(c.p_quero, 5) end, 0)
            + coalesce(case when c.proximo_contato <= hoje then 80 + least(20, 2 * (hoje - c.proximo_contato)) end, 0)
            + coalesce(case c.status_ef when 'negociando' then 50 when 'respondeu' then 40 end, 0)
            + coalesce(case when c.visitas > 0 then least(40, (c.visitas + 1) / 2) end, 0)
            + coalesce(case when c.proximo_contato > hoje then -60 end, 0)
            + coalesce(case when c.proximo_contato is null and c.status_ef = 'abordado' and c.dias_desde_contato between 0 and 2 then -40 end, 0)
            + coalesce(case when not c.tem_zap then -10 end, 0)
            + least(90, 3 * c.contatos))::int as prioridade,
           case when c.status_ef = 'cliente' then 'cliente'
                when c.p_remover > 0 then 'remover'
                when c.status_ef in ('sem_interesse', 'nao_abordar') then c.status_ef end as fora_motivo,
           coalesce(greatest(public.guia_abordagem_etapa(c.status_salvo), c.etapa_hist, case when c.tentativas > 0 then 1 end,
                    case when c.salon_id is not null and (c.tentativas > 0 or coalesce(c.etapa_hist, 0) > 0 or coalesce(public.guia_abordagem_etapa(c.status_salvo), 0) > 0) then 4 end), 0) as etapa
      from cand c
  ),
  filtrado as materialized (
    select * from calc k
     where case vis when 'todos' then true
                    when 'fila' then k.fora_motivo is null
                    when 'lembretes' then k.fora_motivo is null and k.proximo_contato <= hoje
                    when 'pedidos' then k.fora_motivo is null and k.p_dono + k.p_quero > 0
                    else k.status_ef = vis end
  ),
  pagina as materialized (
    select * from (
      select k.*, row_number() over (order by case when vis = 'lembretes' then k.proximo_contato end nulls last,
                                              k.fora_motivo is not null, k.prioridade desc, k.nota_google desc nulls last,
                                              k.avaliacoes desc nulls last, k.nome, k.id) as pos
        from filtrado k) x
     where x.pos > pula and x.pos <= pula + lim
  ),
  -- o detalhe, só da página
  ev_pag as materialized (
    select e.lugar_id,
           count(distinct ((e.em at time zone 'America/Sao_Paulo')::date, e.visitante)) filter (where e.tipo = 'visita') as visitantes
      from public.site_eventos e
     where e.em >= de and e.lugar_id in (select id from pagina)
     group by e.lugar_id
  ),
  ev_tipo as materialized (
    select x.lugar_id, jsonb_object_agg(x.tipo, x.n) as eventos
      from (select e.lugar_id, e.tipo, count(*) as n from public.site_eventos e
             where e.em >= de and e.lugar_id in (select id from pagina) group by 1, 2) x
     group by x.lugar_id
  ),
  int_ as materialized (
    select x.lugar_id, jsonb_object_agg(x.tipo, x.n) as interesses
      from (select i.lugar_id, i.tipo, count(*) as n from public.guia_interesses i
             where i.criado_em >= de and i.lugar_id in (select id from pagina) group by 1, 2) x
     group by x.lugar_id
  ),
  ultima as materialized (
    select distinct on (h.lugar_id) h.lugar_id,
           jsonb_build_object('id', h.id, 'tipo', h.tipo, 'em', h.em, 'texto', left(h.texto, 160), 'para_status', h.para_status, 'proximo_contato', h.proximo_contato) as ultima_acao
      from public.guia_abordagem_acoes h
     where h.lugar_id in (select id from pagina)
     order by h.lugar_id, h.em desc, h.id desc
  ),
  junto as materialized (
    select k.*, l.slug, l.cidade, l.cidade_slug, l.bairro, l.categoria, l.whatsapp, l.telefone, l.instagram, l.site,
           a.nota, a.ultimo_contato_em, a.atualizado_em, p.dono,
           coalesce(vp.visitantes, 0) as visitantes, coalesce(et.eventos, '{}'::jsonb) as eventos, coalesce(it.interesses, '{}'::jsonb) as interesses,
           u.ultima_acao,
           (select coalesce(nullif(btrim(pr.full_name), ''), split_part(us.email, '@', 1))
              from auth.users us left join public.profiles pr on pr.id = us.id where us.id = a.atualizado_por) as atualizado_por_nome
      from pagina k
      join public.guia_lugares l on l.id = k.id
      left join public.guia_abordagens a on a.lugar_id = k.id
      left join pend p on p.lugar_id = k.id
      left join ev_pag vp on vp.lugar_id = k.id
      left join ev_tipo et on et.lugar_id = k.id
      left join int_ it on it.lugar_id = k.id
      left join ultima u on u.lugar_id = k.id
  ),
  -- os motivos em palavras, cada um com o seu peso (a soma é a prioridade de calc; info pesa zero)
  motivos as (
    select j.id, m.tipo, m.peso, m.texto
      from junto j
      cross join lateral (
        select * from (values
          ('dono', case when j.p_dono > 0 then 120 + 20 * least(j.p_dono - 1, 2) end,
             case when j.p_dono = 1 then 'o dono pediu contato' else j.p_dono || ' pedidos de dono abertos' end),
          ('pedido', case when j.p_quero > 0 then 40 * least(j.p_quero, 5) end,
             j.p_quero || case when j.p_quero = 1 then ' pessoa pediu para marcar' else ' pessoas pediram para marcar' end),
          ('lembrete', case when j.proximo_contato <= hoje then 80 + least(20, 2 * (hoje - j.proximo_contato)) end,
             case hoje - j.proximo_contato when 0 then 'lembrete para hoje' when 1 then 'lembrete vencido ontem'
                  else 'lembrete vencido há ' || (hoje - j.proximo_contato) || ' dias' end),
          ('status', case j.status_ef when 'negociando' then 50 when 'respondeu' then 40 end,
             case j.status_ef when 'negociando' then 'em negociação' else 'respondeu: falta o próximo passo' end),
          ('visita', case when j.visitas > 0 then least(40, (j.visitas + 1) / 2) end,
             j.visitas || case when j.visitas = 1 then ' visita' else ' visitas' end || ' em ' || ndias || case when ndias = 1 then ' dia' else ' dias' end),
          ('espera', case when j.proximo_contato > hoje then -60 end,
             case when j.proximo_contato = hoje + 1 then 'lembrete para amanhã' else 'lembrete para ' || to_char(j.proximo_contato, 'DD/MM') end),
          ('espera', case when j.proximo_contato is null and j.status_ef = 'abordado' and j.dias_desde_contato between 0 and 2 then -40 end,
             case j.dias_desde_contato when 0 then 'abordado hoje' when 1 then 'abordado ontem' else 'abordado há ' || j.dias_desde_contato || ' dias' end || ', esperando resposta'),
          ('sem_zap', case when not j.tem_zap then -10 end, 'sem WhatsApp divulgado'),
          ('info', case when j.status_pagina <> 'publicado' then 0 end, 'página fora do ar')
        ) v(tipo, peso, texto)
        where v.peso is not null
        union all
        -- os toques de contato da página, os dois maiores (cada toque vale 3, até 90 no total)
        select * from (
          select 'contato', least(90, 3 * c.n), case when c.n = 1 then '1 pessoa ' || c.um else c.n || ' ' || c.varios end
            from (select (e.value)::int as n, e.key as tipo,
                         case e.key when 'whatsapp' then 'tocou no WhatsApp' when 'ligar' then 'tocou para ligar' when 'mapa' then 'pediu a rota'
                                    when 'instagram' then 'abriu o Instagram' when 'site' then 'abriu o site' when 'agendar_mimo' then 'tocou em Agendar'
                                    when 'email' then 'tocou no e-mail' else 'tocou em ' || e.key end as um,
                         case e.key when 'whatsapp' then 'tocaram no WhatsApp' when 'ligar' then 'tocaram para ligar' when 'mapa' then 'pediram a rota'
                                    when 'instagram' then 'abriram o Instagram' when 'site' then 'abriram o site' when 'agendar_mimo' then 'tocaram em Agendar'
                                    when 'email' then 'tocaram no e-mail' else 'tocaram em ' || e.key end as varios
                    from jsonb_each_text(j.eventos) e
                    join public.site_eventos_tipos t on t.tipo = e.key and t.grupo = 'contato') c
           where c.n > 0
           order by c.n desc, c.tipo
           limit 2
        ) toques
      ) m
  ),
  frases as (
    select j.id,
           coalesce(jsonb_agg(jsonb_build_object('tipo', m.tipo, 'peso', m.peso, 'texto', m.texto) order by m.peso desc, m.texto)
                      filter (where m.tipo is not null), '[]'::jsonb) as motivos
      from junto j left join motivos m on m.id = j.id
     group by j.id
  ),
  itens as (
    select j.*,
           -- sem nenhum motivo a favor, a tela diz por que o salão está lá embaixo
           case when jsonb_path_exists(f.motivos, '$[*] ? (@.peso > 0)') then f.motivos
                else f.motivos || jsonb_build_array(jsonb_build_object('tipo', 'info', 'peso', 0,
                       'texto', 'sem pedidos nem contatos em ' || ndias || case when ndias = 1 then ' dia' else ' dias' end)) end as motivos
      from junto j join frases f on f.id = j.id
  ),
  numeros as (
    select count(*) as todos,
           count(*) filter (where fora_motivo is null) as fila,
           count(*) filter (where fora_motivo is null and proximo_contato <= hoje) as lembretes,
           count(*) filter (where fora_motivo is null and p_dono + p_quero > 0) as pedidos,
           count(*) filter (where not (salon_id is not null and etapa < 4) and not (status_ef = 'nao_abordar' and etapa = 0)) as para_abordar,
           count(*) filter (where not (salon_id is not null and etapa < 4) and not (status_ef = 'nao_abordar' and etapa = 0) and etapa >= 1) as abordados,
           count(*) filter (where not (salon_id is not null and etapa < 4) and not (status_ef = 'nao_abordar' and etapa = 0) and etapa >= 2) as responderam,
           count(*) filter (where not (salon_id is not null and etapa < 4) and not (status_ef = 'nao_abordar' and etapa = 0) and etapa >= 4) as clientes,
           count(*) filter (where salon_id is not null and etapa < 4) as ja_eram
      from calc
  )
  select jsonb_build_object(
    'dias', ndias,
    'de', hoje - (ndias - 1),
    'ate', hoje,
    'hoje', hoje,
    'cidade', cid, 'visao', vis, 'busca', termo,
    'total', (select count(*) from filtrado),
    'depois', pula, 'limite', lim,
    'mais', pula + (select count(*) from pagina) < (select count(*) from filtrado),
    'resumo', (select jsonb_build_object(
        'contagem', jsonb_build_object('todos', n.todos, 'fila', n.fila, 'lembretes', n.lembretes, 'pedidos', n.pedidos)
                    || coalesce((select jsonb_object_agg(s.status_ef, s.n) from (select status_ef, count(*) as n from calc group by status_ef) s), '{}'::jsonb),
        'funil', jsonb_build_object('para_abordar', n.para_abordar, 'abordados', n.abordados, 'responderam', n.responderam, 'clientes', n.clientes, 'ja_eram', n.ja_eram))
      from numeros n),
    'itens', coalesce((select jsonb_agg(jsonb_build_object(
        'lugar_id', i.id, 'nome', i.nome, 'slug', i.slug, 'cidade', i.cidade, 'cidade_slug', i.cidade_slug, 'bairro', i.bairro,
        'categoria', i.categoria, 'status_pagina', i.status_pagina, 'pagina', '/saloes/' || i.cidade_slug || '/' || i.slug,
        'whatsapp', i.whatsapp, 'telefone', i.telefone, 'instagram', i.instagram, 'site', i.site, 'tem_zap', i.tem_zap,
        'na_mimo', i.salon_id is not null, 'nota_google', i.nota_google, 'avaliacoes', i.avaliacoes,
        'status', i.status_ef, 'status_salvo', i.status_salvo, 'tem_registro', i.tem_registro,
        'proximo_contato', i.proximo_contato, 'nota', i.nota, 'ultimo_contato_em', i.ultimo_contato_em,
        'atualizado_em', i.atualizado_em, 'atualizado_por_nome', i.atualizado_por_nome,
        'tentativas', i.tentativas, 'ultima_acao', i.ultima_acao,
        'visitas', i.visitas, 'visitantes', i.visitantes, 'contatos', i.contatos, 'eventos', i.eventos, 'interesses', i.interesses,
        'pendentes', jsonb_build_object('quero_marcar', i.p_quero, 'sou_dono', i.p_dono, 'remover', i.p_remover, 'corrigir', i.p_corrigir),
        'dono', i.dono,
        'fila', case when i.fora_motivo is null then 'principal' else 'fora' end, 'fora_motivo', i.fora_motivo,
        'prioridade', i.prioridade, 'motivos', i.motivos,
        'etapa', i.etapa, 'ja_cliente', i.salon_id is not null and i.etapa < 4)
      order by i.pos)
      from itens i), '[]'::jsonb)
  ) into r;
  return r;
end $$;
comment on function public.guia_fila_abordagem(integer, uuid, text, text, text, integer, integer) is 'Guia (158, 190): a fila de abordagem em páginas (cidade, filtro, busca), com a prioridade de todos calculada barata, o detalhe só da página e os números das abas e do funil prontos.';
revoke execute on function public.guia_fila_abordagem(integer, uuid, text, text, text, integer, integer) from public, anon;
grant execute on function public.guia_fila_abordagem(integer, uuid, text, text, text, integer, integer) to authenticated;

do $$
begin
  raise notice '190: fotos no Publicar agora (fotos_em; o salão da MIMO carimba os do guia), site_servidor (o VPS conferindo), guia_fila_abordagem em páginas';
end $$;
