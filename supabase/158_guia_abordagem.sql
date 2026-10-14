-- 158: a abordagem dos donos de salão (3.12), um mini-CRM do guia.
--
-- O guia já sabe quem visita cada página, quem toca no WhatsApp e quem pede
-- para marcar (153 e 156). Aqui isso vira a fila de trabalho da Plataforma:
-- com quem falar hoje e por quê, o que já foi dito, quando voltar a falar,
-- até o salão virar cliente da MIMO.
--
--   guia_abordagens        um registro por salão: em que pé está a conversa
--                          (a_abordar, abordado, respondeu, negociando,
--                          cliente, sem_interesse, nao_abordar), o próximo
--                          contato, a nota interna e quem mexeu por último
--   guia_abordagem_acoes   o histórico: mandou WhatsApp, ligou, anotou,
--                          mudou o status, marcou lembrete. Cada linha guarda
--                          o estado de antes, para o "Desfazer"
--
-- guia_fila_abordagem(dias) monta a fila com a prioridade calculada e
-- explicada em palavras ("3 pessoas pediram para marcar · 18 tocaram no
-- WhatsApp"). O que pesa:
--   - pedido aberto do dono ("É o seu salão?") e de "quero marcar": muito;
--   - tentativas de contato e visitas da página no período (site_eventos, 156);
--   - quem respondeu ou está negociando pede o próximo passo;
--   - lembrete vencido sobe; lembrete para depois e abordagem de poucos dias
--     sem resposta descem (é hora de esperar);
--   - nota e avaliações do Google só desempatam (triagem interna; nunca vão
--     para o site).
-- Quem já é cliente (salon_id ou status cliente), quem disse que não tem
-- interesse, quem é para não abordar e quem pediu para remover a página
-- saem da fila principal (continuam na lista, no filtro de cada status).
-- Entram os salões no ar e, fora do ar, os que têm pedido aberto ou uma
-- conversa já começada. Removido não entra.
--
-- Só a Plataforma lê e escreve (eh_plataforma); a escrita passa pelas
-- funções, para o histórico nunca ficar para trás. Idempotente.

-- ---- a conversa com cada salão ---------------------------------------------------------
create table if not exists public.guia_abordagens (
  lugar_id uuid primary key references public.guia_lugares (id) on delete cascade,
  status text not null default 'a_abordar',
  proximo_contato date,                   -- o lembrete: voltar a falar neste dia
  nota text,                              -- nota interna; nunca sai da Plataforma
  ultimo_contato_em timestamptz,          -- a última vez que a MIMO falou com o salão
  atualizado_por uuid references auth.users (id) on delete set null,
  atualizado_em timestamptz not null default now(),
  criado_em timestamptz not null default now(),
  constraint guia_abordagens_status_ok check (status in ('a_abordar', 'abordado', 'respondeu', 'negociando', 'cliente', 'sem_interesse', 'nao_abordar')),
  constraint guia_abordagens_nota_ok check (nota is null or length(nota) <= 2000)
);
comment on table public.guia_abordagens is 'Abordagem (158): em que pé está a conversa da MIMO com cada salão do guia. Só a Plataforma; escrita por guia_abordagem_registrar().';
create index if not exists guia_abordagens_status on public.guia_abordagens (status, proximo_contato);

create table if not exists public.guia_abordagem_acoes (
  id bigint generated always as identity primary key,
  lugar_id uuid not null references public.guia_lugares (id) on delete cascade,
  tipo text not null,                     -- whatsapp, ligacao, instagram, presencial, email | nota | status | lembrete
  de_status text,
  para_status text,
  texto text,                             -- a mensagem mandada ou a nota
  proximo_contato date,
  dados jsonb not null default '{}'::jsonb,  -- os números da mensagem; 'antes' é o estado anterior (o desfazer usa)
  por uuid references auth.users (id) on delete set null,
  em timestamptz not null default now(),
  constraint guia_abordagem_acoes_tipo_ok check (tipo in ('whatsapp', 'ligacao', 'instagram', 'presencial', 'email', 'nota', 'status', 'lembrete'))
);
comment on table public.guia_abordagem_acoes is 'Abordagem (158): o histórico da conversa com cada salão (contatos, notas, status, lembretes).';
create index if not exists guia_abordagem_acoes_lugar on public.guia_abordagem_acoes (lugar_id, em desc, id desc);

alter table public.guia_abordagens enable row level security;
alter table public.guia_abordagem_acoes enable row level security;
revoke all on public.guia_abordagens, public.guia_abordagem_acoes from anon, authenticated;
grant select on public.guia_abordagens, public.guia_abordagem_acoes to authenticated;
drop policy if exists guia_abordagens_plataforma on public.guia_abordagens;
create policy guia_abordagens_plataforma on public.guia_abordagens for select to authenticated
  using (public.eh_plataforma());
drop policy if exists guia_abordagem_acoes_plataforma on public.guia_abordagem_acoes;
create policy guia_abordagem_acoes_plataforma on public.guia_abordagem_acoes for select to authenticated
  using (public.eh_plataforma());

-- o e-mail e o jeito de falar de quem reivindicou são da 159; criados aqui também
-- (iguais, sem nada mais) para a fila poder lê-los mesmo antes dela
alter table public.guia_interesses add column if not exists email text;
alter table public.guia_interesses add column if not exists ligacao text;

-- ---- ajudantes ----------------------------------------------------------------------------
-- até onde a conversa chegou, para o funil (a_abordar → abordado → respondeu → cliente).
-- "Sem interesse" respondeu (com um não); "não abordar" fica fora do funil.
create or replace function public.guia_abordagem_etapa(s text)
returns integer language sql immutable set search_path = public as $$
  select case s when 'a_abordar' then 0 when 'abordado' then 1 when 'respondeu' then 2 when 'sem_interesse' then 2
                when 'negociando' then 3 when 'cliente' then 4 end
$$;
revoke execute on function public.guia_abordagem_etapa(text) from public, anon;

-- dá para chamar no WhatsApp? (o WhatsApp divulgado, ou o telefone se for celular; a regra de ehCelular do core)
create or replace function public.guia_tem_zap(whatsapp text, telefone text)
returns boolean language sql immutable set search_path = public as $$
  select coalesce(nullif(btrim(whatsapp), ''), '') <> ''
      or (select length(d) = 11 and substr(d, 3, 1) = '9'
            from (select regexp_replace(regexp_replace(coalesce(telefone, ''), '\D', '', 'g'), '^55(?=\d{10,11}$)', '') as d) x)
$$;
revoke execute on function public.guia_tem_zap(text, text) from public, anon;

-- ---- a fila --------------------------------------------------------------------------------
-- dias: o período dos números (7, 30, 90...; até 400). lugar_: só um salão
-- (depois de uma ação, a tela pede de novo só a linha que mudou).
-- Cada item traz os números do período no mesmo formato de guia_desempenho
-- (visitas, eventos, interesses), para a mensagem ao dono sair igual.
-- Os contadores e o funil a tela soma dos itens (etapa e ja_cliente vêm prontos).
create or replace function public.guia_fila_abordagem(dias integer default 30, lugar_ uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  ndias integer := greatest(1, least(coalesce(dias, 30), 400));
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  de timestamptz;
  r jsonb;
begin
  if not public.eh_plataforma() then raise exception 'só a plataforma vê a fila de abordagem'; end if;
  de := ((hoje - (ndias - 1))::timestamp) at time zone 'America/Sao_Paulo';

  with
  -- os pedidos ainda não atendidos, de qualquer data
  pend as (
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
  -- quem entra: no ar, ou fora do ar com pedido aberto ou conversa começada; removido nunca
  base as (
    select l.id, l.nome, l.slug, l.cidade, l.cidade_slug, l.bairro, l.categoria, l.status as status_pagina,
           l.whatsapp, l.telefone, l.instagram, l.site, l.salon_id, l.nota as nota_google, l.avaliacoes,
           a.lugar_id is not null as tem_registro, a.status as status_salvo, a.proximo_contato, a.nota, a.ultimo_contato_em,
           a.atualizado_em, a.atualizado_por,
           coalesce(p.quero_marcar, 0) as p_quero, coalesce(p.sou_dono, 0) as p_dono,
           coalesce(p.remover, 0) as p_remover, coalesce(p.corrigir, 0) as p_corrigir, p.dono
      from public.guia_lugares l
      left join public.guia_abordagens a on a.lugar_id = l.id
      left join pend p on p.lugar_id = l.id
     where l.status <> 'removido' and (lugar_ is null or l.id = lugar_)
       and (l.status = 'publicado' or a.lugar_id is not null or coalesce(p.sou_dono, 0) + coalesce(p.quero_marcar, 0) > 0)
  ),
  -- os números do período, agregados uma vez só
  ev as (
    select e.lugar_id,
           count(*) filter (where e.tipo = 'visita') as visitas,
           count(distinct ((e.em at time zone 'America/Sao_Paulo')::date, e.visitante)) filter (where e.tipo = 'visita') as visitantes,
           count(*) filter (where t.grupo = 'contato') as contatos
      from public.site_eventos e join public.site_eventos_tipos t using (tipo)
     where e.em >= de and e.lugar_id in (select id from base)
     group by e.lugar_id
  ),
  ev_tipo as (
    select x.lugar_id, jsonb_object_agg(x.tipo, x.n) as eventos
      from (select e.lugar_id, e.tipo, count(*) as n from public.site_eventos e
             where e.em >= de and e.lugar_id in (select id from base) group by 1, 2) x
     group by x.lugar_id
  ),
  int_ as (
    select x.lugar_id, jsonb_object_agg(x.tipo, x.n) as interesses
      from (select i.lugar_id, i.tipo, count(*) as n from public.guia_interesses i
             where i.criado_em >= de and i.lugar_id in (select id from base) group by 1, 2) x
     group by x.lugar_id
  ),
  hist as (
    select h.lugar_id,
           count(*) filter (where h.tipo in ('whatsapp', 'ligacao', 'instagram', 'presencial', 'email')) as tentativas,
           max(public.guia_abordagem_etapa(h.para_status)) as etapa_hist
      from public.guia_abordagem_acoes h
     where h.lugar_id in (select id from base)
     group by h.lugar_id
  ),
  ultima as (
    select distinct on (h.lugar_id) h.lugar_id,
           jsonb_build_object('id', h.id, 'tipo', h.tipo, 'em', h.em, 'texto', left(h.texto, 160), 'para_status', h.para_status, 'proximo_contato', h.proximo_contato) as ultima_acao
      from public.guia_abordagem_acoes h
     where h.lugar_id in (select id from base)
     order by h.lugar_id, h.em desc, h.id desc
  ),
  junto as (
    select b.*,
           case when b.salon_id is not null then 'cliente' else coalesce(b.status_salvo, 'a_abordar') end as status_ef,
           coalesce(ev.visitas, 0) as visitas, coalesce(ev.visitantes, 0) as visitantes, coalesce(ev.contatos, 0) as contatos,
           coalesce(et.eventos, '{}'::jsonb) as eventos, coalesce(it.interesses, '{}'::jsonb) as interesses,
           coalesce(h.tentativas, 0) as tentativas, h.etapa_hist, u.ultima_acao,
           public.guia_tem_zap(b.whatsapp, b.telefone) as tem_zap,
           (select coalesce(nullif(btrim(pr.full_name), ''), split_part(us.email, '@', 1))
              from auth.users us left join public.profiles pr on pr.id = us.id where us.id = b.atualizado_por) as atualizado_por_nome,
           hoje - (b.ultimo_contato_em at time zone 'America/Sao_Paulo')::date as dias_desde_contato
      from base b
      left join ev on ev.lugar_id = b.id
      left join ev_tipo et on et.lugar_id = b.id
      left join int_ it on it.lugar_id = b.id
      left join hist h on h.lugar_id = b.id
      left join ultima u on u.lugar_id = b.id
  ),
  -- os motivos, cada um com o seu peso; a prioridade é a soma (info pesa zero)
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
  pontos as (
    select j.id,
           -- os toques somados contam até 90, mesmo espalhados em vários botões
           (coalesce(sum(m.peso) filter (where m.tipo not in ('contato', 'info')), 0) + least(90, 3 * j.contatos))::int as prioridade,
           coalesce(jsonb_agg(jsonb_build_object('tipo', m.tipo, 'peso', m.peso, 'texto', m.texto) order by m.peso desc, m.texto)
                      filter (where m.tipo is not null), '[]'::jsonb) as motivos
      from junto j left join motivos m on m.id = j.id
     group by j.id, j.contatos
  ),
  itens as (
    select j.*, p.prioridade,
           -- sem nenhum motivo a favor, a tela diz por que o salão está lá embaixo
           case when jsonb_path_exists(p.motivos, '$[*] ? (@.peso > 0)') then p.motivos
                else p.motivos || jsonb_build_array(jsonb_build_object('tipo', 'info', 'peso', 0,
                       'texto', 'sem pedidos nem contatos em ' || ndias || case when ndias = 1 then ' dia' else ' dias' end)) end as motivos,
           case when j.status_ef = 'cliente' then 'cliente'
                when j.p_remover > 0 then 'remover'
                when j.status_ef in ('sem_interesse', 'nao_abordar') then j.status_ef end as fora_motivo,
           greatest(public.guia_abordagem_etapa(j.status_salvo), j.etapa_hist, case when j.tentativas > 0 then 1 end,
                    case when j.salon_id is not null and (j.tentativas > 0 or coalesce(j.etapa_hist, 0) > 0 or coalesce(public.guia_abordagem_etapa(j.status_salvo), 0) > 0) then 4 end) as etapa
      from junto j join pontos p on p.id = j.id
  )
  select jsonb_build_object(
    'dias', ndias,
    'de', hoje - (ndias - 1),
    'ate', hoje,
    'hoje', hoje,
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
        'etapa', coalesce(i.etapa, 0), 'ja_cliente', i.salon_id is not null and coalesce(i.etapa, 0) < 4)
      order by i.fora_motivo is not null, i.prioridade desc, i.nota_google desc nulls last, i.avaliacoes desc nulls last, i.nome)
      from itens i), '[]'::jsonb)
  ) into r;
  return r;
end $$;
revoke execute on function public.guia_fila_abordagem(integer, uuid) from public, anon;
grant execute on function public.guia_fila_abordagem(integer, uuid) to authenticated;

-- ---- registrar uma ação ----------------------------------------------------------------------
-- acao_:
--   whatsapp | ligacao | instagram | presencial | email  falou com o salão: 'a_abordar' vira
--       'abordado', o lembrete vencido sai (já foi feito) e proximo_contato_ marca o próximo;
--   status    status_ novo (cliente, sem interesse e não abordar tiram o lembrete);
--   nota      texto_ vira a nota interna (vazio apaga) e entra no histórico;
--   lembrete  proximo_contato_ (vazio tira o lembrete).
-- Devolve o id da ação (para o desfazer) e a linha da fila já recalculada.
create or replace function public.guia_abordagem_registrar(
  lugar_ uuid,
  acao_ text,
  status_ text default null,
  texto_ text default null,
  proximo_contato_ date default null,
  dados_ jsonb default null,
  dias_ integer default 30
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a public.guia_abordagens;
  criado boolean := false;
  antes jsonb;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  canais text[] := array['whatsapp', 'ligacao', 'instagram', 'presencial', 'email'];
  t text := nullif(left(btrim(coalesce(texto_, '')), 2000), '');
  d jsonb := case when dados_ is not null and jsonb_typeof(dados_) = 'object' and length(dados_::text) <= 2000 then dados_ - 'antes' else '{}'::jsonb end;
  novo_status text;
  novo_proximo date;
  nova_nota text;
  novo_contato timestamptz;
  id_ bigint;
begin
  if not public.eh_plataforma() then raise exception 'só a plataforma registra a abordagem'; end if;
  if acao_ is null or not (acao_ = any (canais || array['status', 'nota', 'lembrete'])) then raise exception 'ação desconhecida: %', acao_; end if;
  if status_ is not null and public.guia_abordagem_etapa(status_) is null and status_ <> 'nao_abordar' then raise exception 'status desconhecido: %', status_; end if;
  if proximo_contato_ is not null and (proximo_contato_ < hoje or proximo_contato_ > hoje + 400) then
    raise exception 'o lembrete precisa ser de hoje até um ano para a frente';
  end if;
  if not exists (select 1 from public.guia_lugares where id = lugar_ and status <> 'removido') then raise exception 'salão não encontrado'; end if;

  insert into public.guia_abordagens (lugar_id, atualizado_por) values (lugar_, auth.uid())
    on conflict (lugar_id) do nothing
    returning true into criado;
  criado := coalesce(criado, false);
  select * into a from public.guia_abordagens where lugar_id = lugar_ for update;
  antes := jsonb_build_object('novo', criado, 'status', a.status, 'proximo_contato', a.proximo_contato, 'nota', a.nota, 'ultimo_contato_em', a.ultimo_contato_em);

  novo_status := a.status; novo_proximo := a.proximo_contato; nova_nota := a.nota; novo_contato := a.ultimo_contato_em;
  if acao_ = any (canais) then
    novo_status := coalesce(status_, case when a.status = 'a_abordar' then 'abordado' else a.status end);
    novo_proximo := coalesce(proximo_contato_, case when a.proximo_contato > hoje then a.proximo_contato end);
    novo_contato := now();
  elsif acao_ = 'status' then
    if status_ is null then raise exception 'diga o status novo'; end if;
    novo_status := status_;
    novo_proximo := case when status_ in ('cliente', 'sem_interesse', 'nao_abordar') then null else coalesce(proximo_contato_, a.proximo_contato) end;
  elsif acao_ = 'nota' then
    nova_nota := t;
  elsif acao_ = 'lembrete' then
    novo_proximo := proximo_contato_;
  end if;

  -- nada mudou (status igual, a mesma nota, o mesmo lembrete): não suja o histórico
  if not (acao_ = any (canais)) and novo_status is not distinct from a.status and novo_proximo is not distinct from a.proximo_contato
     and nova_nota is not distinct from a.nota then
    if criado then delete from public.guia_abordagens where lugar_id = lugar_; end if;
    return jsonb_build_object('ok', true, 'acao_id', null, 'item', public.guia_fila_abordagem(dias_, lugar_) -> 'itens' -> 0);
  end if;

  update public.guia_abordagens set
      status = novo_status, proximo_contato = novo_proximo, nota = nova_nota, ultimo_contato_em = novo_contato,
      atualizado_por = auth.uid(), atualizado_em = now()
    where lugar_id = lugar_;

  insert into public.guia_abordagem_acoes (lugar_id, tipo, de_status, para_status, texto, proximo_contato, dados, por)
  values (lugar_, acao_, a.status, case when novo_status is distinct from a.status then novo_status end,
          case when acao_ = 'nota' then nova_nota when acao_ = any (canais) then t end,
          novo_proximo, d || jsonb_build_object('antes', antes), auth.uid())
  returning id into id_;

  return jsonb_build_object('ok', true, 'acao_id', id_, 'item', public.guia_fila_abordagem(dias_, lugar_) -> 'itens' -> 0);
end $$;
revoke execute on function public.guia_abordagem_registrar(uuid, text, text, text, date, jsonb, integer) from public, anon;
grant execute on function public.guia_abordagem_registrar(uuid, text, text, text, date, jsonb, integer) to authenticated;

-- ---- desfazer a última ação de um salão --------------------------------------------------------
-- Volta o registro ao estado de antes (guardado na própria ação) e apaga a ação.
-- Só a última de cada salão: desfazer uma do meio deixaria o histórico mentindo.
create or replace function public.guia_abordagem_desfazer(acao_ bigint, dias_ integer default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  x public.guia_abordagem_acoes;
  antes jsonb;
begin
  if not public.eh_plataforma() then raise exception 'só a plataforma desfaz a abordagem'; end if;
  select * into x from public.guia_abordagem_acoes where id = acao_;
  if not found then raise exception 'essa ação não existe mais'; end if;
  -- trava o salão antes de conferir se é a última: uma ação gravando ao mesmo
  -- tempo termina primeiro e aparece na conferência (e a de cá recusa)
  perform 1 from public.guia_abordagens where lugar_id = x.lugar_id for update;
  select * into x from public.guia_abordagem_acoes where id = acao_;
  if not found then raise exception 'essa ação não existe mais'; end if;
  if exists (select 1 from public.guia_abordagem_acoes h where h.lugar_id = x.lugar_id and (h.em, h.id) > (x.em, x.id)) then
    raise exception 'só dá para desfazer a última ação deste salão';
  end if;
  antes := x.dados -> 'antes';
  if antes is null then raise exception 'essa ação não guarda o estado de antes'; end if;
  if coalesce((antes ->> 'novo')::boolean, false) and not exists (select 1 from public.guia_abordagem_acoes h where h.lugar_id = x.lugar_id and h.id <> x.id) then
    delete from public.guia_abordagens where lugar_id = x.lugar_id;
  else
    update public.guia_abordagens set
        status = coalesce(antes ->> 'status', 'a_abordar'),
        proximo_contato = (antes ->> 'proximo_contato')::date,
        nota = antes ->> 'nota',
        ultimo_contato_em = (antes ->> 'ultimo_contato_em')::timestamptz,
        atualizado_por = auth.uid(), atualizado_em = now()
      where lugar_id = x.lugar_id;
  end if;
  delete from public.guia_abordagem_acoes where id = x.id;
  return jsonb_build_object('ok', true, 'lugar_id', x.lugar_id, 'item', public.guia_fila_abordagem(dias_, x.lugar_id) -> 'itens' -> 0);
end $$;
revoke execute on function public.guia_abordagem_desfazer(bigint, integer) from public, anon;
grant execute on function public.guia_abordagem_desfazer(bigint, integer) to authenticated;

-- ---- o histórico de um salão ------------------------------------------------------------------
create or replace function public.guia_abordagem_historico(lugar_ uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.eh_plataforma() then raise exception 'só a plataforma vê o histórico'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'id', h.id, 'tipo', h.tipo, 'de_status', h.de_status, 'para_status', h.para_status, 'texto', h.texto,
        'proximo_contato', h.proximo_contato, 'dados', h.dados - 'antes', 'em', h.em,
        'por_nome', (select coalesce(nullif(btrim(pr.full_name), ''), split_part(us.email, '@', 1))
                       from auth.users us left join public.profiles pr on pr.id = us.id where us.id = h.por))
      order by h.em desc, h.id desc)
      from (select * from public.guia_abordagem_acoes where lugar_id = lugar_ order by em desc, id desc limit 200) h
  ), '[]'::jsonb);
end $$;
revoke execute on function public.guia_abordagem_historico(uuid) from public, anon;
grant execute on function public.guia_abordagem_historico(uuid) to authenticated;

do $$
declare n int;
begin
  select count(*) into n from public.guia_abordagens;
  raise notice '158: abordagem dos donos pronta (guia_abordagens, guia_abordagem_acoes, guia_fila_abordagem); % conversas registradas', n;
end $$;
