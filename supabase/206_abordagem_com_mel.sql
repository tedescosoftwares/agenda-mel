-- 206: a abordagem com os sinais da Mel (3.59)
-- A fila de abordagem (158/190) cruzava as visitas e os toques da página com os pedidos do formulário. Faltava o sinal
-- mais forte: o que passou pela Mel (195–205). Agora a fila sabe, por salão, quantos pedidos a Mel passou no período,
-- quantos o salão abriu, quantos disse que vai (ou não vai) atender, se respondeu QUERO (90 dias), se a dona testou o
-- guia (60 dias) e se pediu SAIR — tudo entra na prioridade e nos motivos, e dois filtros novos ("mel", "querem").
-- No detalhe da página: quantos pedidos vieram de um toque na página (até 3 h antes) e as visitas desta semana contra
-- a anterior. O resumo traz os totais da Mel na cidade.
--
-- Mais: guia_whats_clientes (as clientes que pediram, por telefone, e se foram atendidas), guia_demanda_sem_dono (os
-- pedidos que ficaram sem dono, por bairro, para a equipe oferecer a outro salão — na mão) e o QUERO que entra sozinho
-- na abordagem (guia_whats_salao_respondeu: o salão vai para "respondeu" com lembrete para hoje e a ação no histórico).
-- Precisa da 205. Idempotente.

-- "hoje", "ontem", "há N dias" para os motivos
create or replace function public.guia_ha_quanto(em timestamptz, hoje date)
returns text language sql immutable as $$
  select case when em is null then null
              when hoje - (em at time zone 'America/Sao_Paulo')::date <= 0 then 'hoje'
              when hoje - (em at time zone 'America/Sao_Paulo')::date = 1 then 'ontem'
              else 'há ' || (hoje - (em at time zone 'America/Sao_Paulo')::date) || ' dias' end
$$;

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
  -- 3.59: o que passou pela Mel (migrações 195–205), por salão. No período: os pedidos que a Mel passou, quantos o salão
  -- abriu, quantos disse que vai (ou não vai) atender, quantos respondeu. Fora do período: o QUERO (90 dias) e a dona
  -- testando (60 dias) — sinais que não envelhecem tão rápido.
  mel as materialized (
    select ld.lugar_id,
           count(*) as pedidos,
           count(*) filter (where ld.clicou_em is not null) as abriram,
           count(*) filter (where ld.voto = 'sim' or ld.status = 'salao_vai_atender') as vai,
           count(*) filter (where ld.voto = 'nao' or ld.status = 'salao_nao_atende') as nao,
           count(*) filter (where ld.salao_respondeu_em is not null) as respondeu,
           max(ld.criado_em) as ultimo
      from public.guia_whats_leads ld
     where ld.criado_em >= de and ld.lugar_id is not null and (lugar_ is null or ld.lugar_id = lugar_)
     group by ld.lugar_id
  ),
  mel_quer as materialized (
    select ld.lugar_id, count(*) as quer, max(coalesce(ld.salao_respondeu_em, ld.criado_em)) as quer_em
      from public.guia_whats_leads ld
     where ld.status = 'salao_quer_conhecer' and ld.criado_em > now() - interval '90 days' and ld.lugar_id is not null and (lugar_ is null or ld.lugar_id = lugar_)
     group by ld.lugar_id
  ),
  mel_dona as materialized (
    select cv.lugar_id, max(cv.atualizada_em) as dona_em
      from public.guia_whats_conversas cv
     where cv.lugar_id is not null and not cv.teste and (cv.dados ->> 'dona') = 'true' and cv.atualizada_em > now() - interval '60 days'
       and (lugar_ is null or cv.lugar_id = lugar_)
     group by cv.lugar_id
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
           hoje - (a.ultimo_contato_em at time zone 'America/Sao_Paulo')::date as dias_desde_contato,
           coalesce(ml.pedidos, 0) as mel_pedidos, coalesce(ml.abriram, 0) as mel_abriram, coalesce(ml.vai, 0) as mel_vai, coalesce(ml.nao, 0) as mel_nao,
           coalesce(ml.respondeu, 0) as mel_respondeu, ml.ultimo as mel_ultimo,
           coalesce(mq.quer, 0) as mel_quer, mq.quer_em as mel_quer_em, md.dona_em as mel_dona_em,
           (sd.chave is not null) as mel_sair
      from public.guia_lugares l
      left join public.guia_abordagens a on a.lugar_id = l.id
      left join pend p on p.lugar_id = l.id
      left join ev on ev.lugar_id = l.id
      left join hist h on h.lugar_id = l.id
      left join mel ml on ml.lugar_id = l.id
      left join mel_quer mq on mq.lugar_id = l.id
      left join mel_dona md on md.lugar_id = l.id
      left join public.guia_whats_saidas sd on sd.quem = 'salao' and sd.chave = public.guia_whats_chave(public.guia_whats_do_salao(l.whatsapp, l.telefone))
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
            -- 3.59: os sinais da Mel (os mesmos pesos dos motivos abaixo)
            + coalesce(case when c.mel_quer > 0 and c.status_ef not in ('negociando', 'cliente') then 150 end, 0)
            + coalesce(case when c.mel_dona_em is not null then 100 end, 0)
            + coalesce(case when c.mel_pedidos > 0 then 60 * least(c.mel_pedidos, 3) end, 0)
            + coalesce(case when c.mel_vai > 0 then 30 * least(c.mel_vai, 2) end, 0)
            + coalesce(case when c.mel_nao > 0 and c.mel_vai = 0 then -15 end, 0)
            + coalesce(case when c.mel_sair then -20 end, 0)
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
                    when 'mel' then k.fora_motivo is null and k.mel_pedidos > 0
                    when 'querem' then k.fora_motivo is null and k.mel_quer > 0
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
  mel_pag as materialized (
    select ld.lugar_id,
           count(*) filter (where exists (
             select 1 from public.site_eventos e join public.site_eventos_tipos t using (tipo)
              where e.lugar_id = ld.lugar_id and (t.grupo = 'contato' or e.tipo = 'quero_marcar')
                and e.em between cv.criada_em - interval '3 hours' and cv.criada_em + interval '5 minutes')) as da_pagina
      from public.guia_whats_leads ld join public.guia_whats_conversas cv on cv.id = ld.conversa_id
     where ld.criado_em >= de and ld.lugar_id in (select id from pagina)
     group by ld.lugar_id
  ),
  ev_sem as materialized (
    select e.lugar_id,
           count(*) filter (where e.em >= ((hoje - 6)::timestamp at time zone 'America/Sao_Paulo')) as visitas_7,
           count(*) filter (where e.em < ((hoje - 6)::timestamp at time zone 'America/Sao_Paulo')) as visitas_7_antes
      from public.site_eventos e
     where e.tipo = 'visita' and e.em >= ((hoje - 13)::timestamp at time zone 'America/Sao_Paulo') and e.lugar_id in (select id from pagina)
     group by e.lugar_id
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
           u.ultima_acao, coalesce(mp.da_pagina, 0) as mel_da_pagina, coalesce(es.visitas_7, 0) as visitas_7, coalesce(es.visitas_7_antes, 0) as visitas_7_antes,
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
      left join mel_pag mp on mp.lugar_id = k.id
      left join ev_sem es on es.lugar_id = k.id
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
          -- 3.59: os sinais da Mel
          ('mel_quer', case when j.mel_quer > 0 and j.status_ef not in ('negociando', 'cliente') then 150 end,
             'respondeu QUERO pela Mel' || coalesce(' · ' || public.guia_ha_quanto(j.mel_quer_em, hoje), '')),
          ('mel_dona', case when j.mel_dona_em is not null then 100 end,
             'a dona testou o guia pela Mel' || coalesce(' · ' || public.guia_ha_quanto(j.mel_dona_em, hoje), '')),
          ('mel', case when j.mel_pedidos > 0 then 60 * least(j.mel_pedidos, 3) end,
             j.mel_pedidos || case when j.mel_pedidos = 1 then ' cliente pediu horário pela Mel' else ' clientes pediram horário pela Mel' end),
          ('mel_vai', case when j.mel_vai > 0 then 30 * least(j.mel_vai, 2) end,
             'disse que vai atender' || case when j.mel_vai > 1 then ' ' || j.mel_vai || ' pedidos' else '' end),
          ('mel_nao', case when j.mel_nao > 0 and j.mel_vai = 0 then -15 end,
             'disse que não vai atender' || case when j.mel_nao > 1 then ' (' || j.mel_nao || '×)' else '' end),
          ('mel_sair', case when j.mel_sair then -20 end, 'pediu SAIR dos pedidos da Mel'),
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
           count(*) filter (where fora_motivo is null and mel_pedidos > 0) as mel,
           count(*) filter (where fora_motivo is null and mel_quer > 0) as querem,
           coalesce(sum(mel_pedidos), 0) as mel_pedidos, coalesce(sum(mel_abriram), 0) as mel_abriram, coalesce(sum(mel_vai), 0) as mel_vai,
           coalesce(sum(mel_nao), 0) as mel_nao, count(*) filter (where mel_quer > 0) as mel_querem, count(*) filter (where mel_dona_em is not null) as mel_donas,
           coalesce(sum(visitas), 0) as visitas, coalesce(sum(contatos), 0) as contatos,
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
        'contagem', jsonb_build_object('todos', n.todos, 'fila', n.fila, 'lembretes', n.lembretes, 'pedidos', n.pedidos, 'mel', n.mel, 'querem', n.querem)
                    || coalesce((select jsonb_object_agg(s.status_ef, s.n) from (select status_ef, count(*) as n from calc group by status_ef) s), '{}'::jsonb),
        'funil', jsonb_build_object('para_abordar', n.para_abordar, 'abordados', n.abordados, 'responderam', n.responderam, 'clientes', n.clientes, 'ja_eram', n.ja_eram),
        'mel', jsonb_build_object('pedidos', n.mel_pedidos, 'abriram', n.mel_abriram, 'vai', n.mel_vai, 'nao', n.mel_nao, 'querem', n.mel_querem, 'donas', n.mel_donas, 'visitas', n.visitas, 'contatos', n.contatos))
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
        'etapa', i.etapa, 'ja_cliente', i.salon_id is not null and i.etapa < 4,
        'visitas_7', i.visitas_7, 'visitas_7_antes', i.visitas_7_antes,
        'mel', jsonb_build_object('pedidos', i.mel_pedidos, 'abriram', i.mel_abriram, 'vai', i.mel_vai, 'nao', i.mel_nao, 'respondeu', i.mel_respondeu,
                                  'quer', i.mel_quer, 'quer_em', i.mel_quer_em, 'ultimo', i.mel_ultimo, 'dona_em', i.mel_dona_em, 'sair', i.mel_sair, 'da_pagina', i.mel_da_pagina))
      order by i.pos)
      from itens i), '[]'::jsonb)
  ) into r;
  return r;
end $$;
comment on function public.guia_fila_abordagem(integer, uuid, text, text, text, integer, integer) is 'Guia (158, 190, 206): a fila de abordagem em páginas (cidade, filtro, busca), com a prioridade de todos calculada barata, os sinais da Mel (pedidos, abriu, vai atender, QUERO, dona, SAIR), o detalhe só da página e os números das abas, do funil e da Mel prontos.';
revoke execute on function public.guia_fila_abordagem(integer, uuid, text, text, text, integer, integer) from public, anon;
grant execute on function public.guia_fila_abordagem(integer, uuid, text, text, text, integer, integer) to authenticated;

-- ---- as clientes que pediram (por telefone): quantos pedidos, em quais salões, se foi atendida, o que ficou sem dono ----
create or replace function public.guia_whats_clientes(dias_ integer default 30)
returns jsonb language plpgsql stable security definer set search_path = public set plan_cache_mode = force_custom_plan as $$
declare
  desde timestamptz := now() - make_interval(days => greatest(1, least(coalesce(dias_, 30), 365)));
begin
  if not public.eh_plataforma() then raise exception 'só a plataforma vê as clientes da Mel'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(x) order by x.pedidos desc, x.ultimo desc), '[]'::jsonb) from (
    select ld.cliente_chave as chave,
           (array_agg(ld.cliente_nome order by ld.criado_em desc) filter (where ld.cliente_nome is not null))[1] as nome,
           (array_agg(ld.cliente_tel order by ld.criado_em desc))[1] as telefone,
           count(*) as pedidos,
           count(distinct ld.lugar_id) as saloes_n,
           (select coalesce(jsonb_agg(distinct jsonb_build_object('nome', s.salao_nome, 'cidade', s.cidade)), '[]'::jsonb)
              from public.guia_whats_leads s where s.cliente_chave = ld.cliente_chave and s.criado_em >= desde) as saloes,
           max(ld.criado_em) as ultimo,
           (array_agg(ld.servico order by ld.criado_em desc) filter (where ld.servico is not null))[1] as servico,
           bool_or(ld.voto = 'sim' or ld.status = 'salao_vai_atender') as atendida,
           count(*) filter (where ld.voto = 'nao' or ld.status = 'salao_nao_atende') as recusados,
           count(*) filter (where ld.status = 'enviado' and ld.voto is null and ld.clicou_em is null and ld.salao_respondeu_em is null and ld.enviado_em > now() - interval '24 hours') as aguardando,
           count(*) filter (where ld.status in ('sem_contato', 'falhou', 'salao_saiu', 'fora_do_limite', 'salao_nao_atende')
                              or (ld.status = 'enviado' and ld.voto is null and ld.clicou_em is null and ld.salao_respondeu_em is null and ld.enviado_em <= now() - interval '24 hours')) as sem_dono,
           bool_or(ld.clicou_em is not null) as abriram
      from public.guia_whats_leads ld
     where ld.criado_em >= desde
     group by ld.cliente_chave
     order by pedidos desc, ultimo desc
     limit 300) x);
end $$;
revoke execute on function public.guia_whats_clientes(integer) from public, anon;
grant execute on function public.guia_whats_clientes(integer) to authenticated;

-- ---- a demanda sem dono: os pedidos que não acharam quem atendesse, por bairro (a equipe oferece a outro salão, na mão) ----
-- "sem dono" = o salão não tem WhatsApp, o envio falhou, o salão pediu SAIR, disse que não vai atender, ou está há mais de
-- 24 h sem abrir o link, votar nem responder.
create or replace function public.guia_demanda_sem_dono(dias_ integer default 30, cidade_ text default null)
returns jsonb language plpgsql stable security definer set search_path = public set plan_cache_mode = force_custom_plan as $$
declare
  desde timestamptz := now() - make_interval(days => greatest(1, least(coalesce(dias_, 30), 365)));
  cid text := nullif(lower(btrim(coalesce(cidade_, ''))), '');
  r jsonb;
begin
  if not public.eh_plataforma() then raise exception 'só a plataforma vê a demanda sem dono'; end if;
  with sd as materialized (
    select ld.id, ld.cliente_chave, ld.cliente_nome, ld.cliente_tel, ld.servico, ld.preferencia, ld.salao_nome, ld.lugar_id, ld.status, ld.voto, ld.criado_em,
           coalesce(l.bairro, 'sem bairro') as bairro, coalesce(l.cidade, ld.cidade) as cidade, l.cidade_slug,
           case when ld.status = 'salao_nao_atende' or ld.voto = 'nao' then 'o salão disse que não vai atender'
                when ld.status = 'sem_contato' then 'o salão não tem WhatsApp'
                when ld.status = 'falhou' then 'o envio não saiu'
                when ld.status = 'salao_saiu' then 'o salão pediu SAIR'
                when ld.status = 'fora_do_limite' then 'fora do limite do dia'
                else 'sem resposta do salão há mais de 24 h' end as motivo
      from public.guia_whats_leads ld
      left join public.guia_lugares l on l.id = ld.lugar_id
     where ld.criado_em >= desde and (cid is null or l.cidade_slug = cid)
       and (ld.status in ('sem_contato', 'falhou', 'salao_saiu', 'fora_do_limite', 'salao_nao_atende') or ld.voto = 'nao'
            or (ld.status = 'enviado' and ld.voto is null and ld.clicou_em is null and ld.salao_respondeu_em is null and ld.enviado_em <= now() - interval '24 hours'))
  )
  select jsonb_build_object(
    'dias', greatest(1, least(coalesce(dias_, 30), 365)), 'cidade', cid,
    'pedidos_n', (select count(*) from sd),
    'clientes_n', (select count(distinct cliente_chave) from sd),
    'por_bairro', (select coalesce(jsonb_agg(to_jsonb(b) order by b.clientes desc, b.pedidos desc, b.bairro), '[]'::jsonb) from (
        select x.bairro, x.cidade, x.clientes, x.pedidos, x.saloes,
               (select string_agg(q.servico, ', ') from (
                  select s2.servico from sd s2 where s2.bairro = x.bairro and s2.cidade is not distinct from x.cidade and s2.servico is not null
                   group by s2.servico order by count(*) desc, s2.servico limit 3) q) as servicos
          from (select bairro, cidade, count(distinct cliente_chave) as clientes, count(*) as pedidos, count(distinct lugar_id) as saloes
                  from sd group by bairro, cidade) x) b),
    'pedidos', (select coalesce(jsonb_agg(to_jsonb(p) order by p.criado_em desc), '[]'::jsonb) from (
        select id, cliente_nome, cliente_tel, servico, preferencia, salao_nome, lugar_id, bairro, cidade, status, voto, motivo, criado_em
          from sd order by criado_em desc limit 40) p)
  ) into r;
  return r;
end $$;
revoke execute on function public.guia_demanda_sem_dono(integer, text) from public, anon;
grant execute on function public.guia_demanda_sem_dono(integer, text) to authenticated;

-- ---- o QUERO entra sozinho na abordagem --------------------------------------------------------------------------------
-- O salão respondeu QUERO ao pedido da Mel: além de marcar o pedido, o salão (quando ainda não é da MIMO) vai para
-- "respondeu" na fila de abordagem, com lembrete para hoje, e uma nota no histórico — uma vez por pedido. Quem já está
-- em negociação (ou é cliente) fica como está. Rodando com a chave de serviço, a ação fica sem "por".
create or replace function public.guia_whats_salao_respondeu(lead_ bigint, texto_ text, quer_ boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  t text := left(btrim(coalesce(texto_, '')), 1000);
  novas jsonb;
  lg uuid;
  a public.guia_abordagens;
  novo text;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  select case when t = '' then salao_mensagens
              else salao_mensagens || jsonb_build_object('em', now(), 'texto', t) end
    into novas from public.guia_whats_leads where id = lead_;
  if novas is null then return; end if;
  while jsonb_array_length(novas) > 60 loop novas := novas - 0; end loop;
  update public.guia_whats_leads set
    status = case when quer_ then 'salao_quer_conhecer'
                  when status in ('salao_quer_conhecer', 'salao_vai_atender', 'salao_nao_atende') then status
                  else 'salao_respondeu' end,
    salao_respondeu_em = coalesce(salao_respondeu_em, now()),
    resposta_salao = left(coalesce(resposta_salao || E'\n', '') || t, 1000),
    salao_mensagens = novas
   where id = lead_;
  if coalesce(quer_, false) then
    select ld.lugar_id into lg from public.guia_whats_leads ld join public.guia_lugares l on l.id = ld.lugar_id
     where ld.id = lead_ and l.salon_id is null and l.status <> 'removido';
    if lg is not null and not exists (select 1 from public.guia_abordagem_acoes h where h.lugar_id = lg and h.dados ->> 'lead' = lead_::text) then
      insert into public.guia_abordagens (lugar_id) values (lg) on conflict (lugar_id) do nothing;
      select * into a from public.guia_abordagens where lugar_id = lg for update;
      novo := case when a.status in ('negociando', 'cliente') then a.status else 'respondeu' end;
      update public.guia_abordagens set
        status = novo,
        proximo_contato = case when novo = 'cliente' then proximo_contato else least(coalesce(proximo_contato, hoje), hoje) end,
        atualizado_em = now()
       where lugar_id = lg;
      insert into public.guia_abordagem_acoes (lugar_id, tipo, de_status, para_status, texto, proximo_contato, dados)
      values (lg, 'nota', a.status, case when novo is distinct from a.status then novo end,
              'Respondeu QUERO ao pedido da Mel: quer conhecer a MIMO. Chamar hoje.',
              case when novo <> 'cliente' then hoje end,
              jsonb_build_object('origem', 'mel', 'lead', lead_::text));
    end if;
  end if;
end $$;

do $$
begin
  raise notice '206: a abordagem com os sinais da Mel (fila, motivos, filtros mel/querem, resumo), guia_whats_clientes, guia_demanda_sem_dono, o QUERO entra sozinho na abordagem';
end $$;
