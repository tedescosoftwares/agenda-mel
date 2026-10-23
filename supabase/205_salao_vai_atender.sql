-- 205: o retorno do salão (3.57)
-- Até aqui a gente só sabia que o salão ABRIU o link do pedido (clicou_em). Agora o salão DIZ se vai atender: logo depois
-- da mensagem do pedido vai uma ENQUETE do WhatsApp (o único "botão" que a Evolution/Baileys renderiza em todo
-- aparelho) — "Vai atender a {cliente}?" com duas opções, editáveis na aba. O voto volta amarrado ao pedido pela chave
-- da enquete (guia_whats_leads.enquete_id): o PRIMEIRO voto vale (o WhatsApp não deixa travar o voto; uma troca depois
-- fica só anotada, voto_atual/voto_mudou_em, sem disparar nada de novo). Um "não vou conseguir" / "vou atender" claro,
-- por texto, também conta (origem 'texto').
--
-- Sim → status salao_vai_atender; a Mel responde ao salão (msg_salao_vai_atender, com o link de novo).
-- Não → status salao_nao_atende; a Mel agradece (msg_salao_nao_atende), avisa a equipe (aviso_nao_atende /
--       msg_aviso_nao_atende) e, se avisar_cliente_nao, avisa a cliente e REABRE a conversa dela sem salão
--       (guia_whats_conversa_reabrir: nome/serviço/preferência ficam, lugar e lead saem) para ela escolher outro.
-- Demora → o relógio da VPS (?tarefa=ociosas) também varre os pedidos: enviado há aviso_demora_min sem o salão abrir o
--       link, votar ou responder → avisa a equipe uma vez (aviso_demora_em); cutucar_salao_min → cutuca o salão uma vez
--       (cutucado_em). 0 = desligado. Tudo configurável e com os textos editáveis na aba WhatsApp. Idempotente.

-- ---- a configuração ----------------------------------------------------------------------------------------------------
alter table public.guia_whats_config add column if not exists enquete_ativa boolean not null default true;
alter table public.guia_whats_config add column if not exists enquete_pergunta text not null default 'Vai atender a {cliente}?' check (length(enquete_pergunta) between 3 and 200);
alter table public.guia_whats_config add column if not exists enquete_sim text not null default 'Sim, vou atender' check (length(enquete_sim) between 2 and 60);
alter table public.guia_whats_config add column if not exists enquete_nao text not null default 'Não vou conseguir' check (length(enquete_nao) between 2 and 60);
alter table public.guia_whats_config add column if not exists msg_salao_vai_atender text not null
  default 'Combinado! 💗 A {cliente} está esperando seu contato: {link}

Se no fim não for conseguir atender, é só me avisar por aqui.'
  check (length(msg_salao_vai_atender) between 5 and 1500);
alter table public.guia_whats_config add column if not exists msg_salao_nao_atende text not null
  default 'Tudo bem, obrigada por avisar! 💗 Eu aviso a {cliente}. Os próximos pedidos continuam chegando por aqui; para não receber mais, responda SAIR.'
  check (length(msg_salao_nao_atende) between 5 and 1500);
alter table public.guia_whats_config add column if not exists avisar_cliente_nao boolean not null default true;
alter table public.guia_whats_config add column if not exists msg_cliente_nao_atende text not null
  default 'Oi{nome}! O {salao} não vai conseguir te atender agora 😕 Quer que eu te ajude com outro salão? Me manda o nome ou o link de outro salão do guia que eu passo seu pedido pra ele.'
  check (length(msg_cliente_nao_atende) between 5 and 1500);
alter table public.guia_whats_config add column if not exists aviso_nao_atende boolean not null default true;
alter table public.guia_whats_config add column if not exists msg_aviso_nao_atende text not null
  default '❌ MIMO — salão não vai atender
{salao} · {cidade} respondeu que não vai atender.
Cliente: {cliente} ({contato})
Pedido: {servico} · {preferencia}'
  check (length(msg_aviso_nao_atende) between 5 and 1500);
alter table public.guia_whats_config add column if not exists aviso_demora_min integer not null default 0 check (aviso_demora_min = 0 or aviso_demora_min between 5 and 10080);
alter table public.guia_whats_config add column if not exists msg_aviso_demora text not null
  default '⏳ MIMO — salão sem resposta
{salao} · {cidade} recebeu o pedido há {tempo} e ainda não abriu o link nem respondeu.
Cliente: {cliente} ({contato})
Pedido: {servico} · {preferencia}'
  check (length(msg_aviso_demora) between 5 and 1500);
alter table public.guia_whats_config add column if not exists cutucar_salao_min integer not null default 0 check (cutucar_salao_min = 0 or cutucar_salao_min between 5 and 10080);
alter table public.guia_whats_config add column if not exists msg_cutucar_salao text not null
  default 'Oi! A {cliente} ainda está esperando seu retorno sobre {servico} 💗 Vai dar pra atender? É só tocar no link: {link}'
  check (length(msg_cutucar_salao) between 5 and 1500);

-- ---- o pedido ----------------------------------------------------------------------------------------------------------
alter table public.guia_whats_leads add column if not exists enquete_id text;
alter table public.guia_whats_leads add column if not exists voto text check (voto is null or voto in ('sim', 'nao'));
alter table public.guia_whats_leads add column if not exists voto_origem text check (voto_origem is null or voto_origem in ('enquete', 'texto'));
alter table public.guia_whats_leads add column if not exists votou_em timestamptz;
alter table public.guia_whats_leads add column if not exists voto_atual text check (voto_atual is null or voto_atual in ('sim', 'nao'));
alter table public.guia_whats_leads add column if not exists voto_mudou_em timestamptz;
alter table public.guia_whats_leads add column if not exists aviso_demora_em timestamptz;
alter table public.guia_whats_leads add column if not exists cutucado_em timestamptz;
create index if not exists guia_whats_leads_enquete on public.guia_whats_leads (enquete_id) where enquete_id is not null;
alter table public.guia_whats_leads drop constraint if exists guia_whats_leads_status_check;
alter table public.guia_whats_leads add constraint guia_whats_leads_status_check
  check (status in ('pendente', 'enviado', 'falhou', 'sem_contato', 'fora_do_limite', 'salao_saiu', 'salao_respondeu', 'salao_quer_conhecer', 'salao_vai_atender', 'salao_nao_atende'));

-- a enquete saiu: guarda a chave da mensagem (é por ela que o voto volta)
create or replace function public.guia_whats_lead_enquete(lead_ bigint, enquete_ text)
returns void language sql security definer set search_path = public as $$
  update public.guia_whats_leads set enquete_id = left(nullif(btrim(coalesce(enquete_, '')), ''), 120) where id = lead_
$$;

-- o voto do salão. Pela enquete (enquete_ = a chave da mensagem da enquete) ou por texto (lead_ = o pedido que o
-- contexto escolheu). Só pedidos enviados a ESTE número (salao_chave). O primeiro voto vale: muda o status e volta o
-- pedido inteiro com primeiro = true (o motor responde, avisa, reabre); um voto depois só anota (voto_atual,
-- voto_mudou_em) e volta primeiro = false. Sem pedido: null.
create or replace function public.guia_whats_voto(tel_ text, voto_ text, enquete_ text default null, lead_ bigint default null, origem_ text default 'enquete')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  k text := public.guia_whats_chave(tel_);
  ld public.guia_whats_leads;
  v text := case when voto_ in ('sim', 'nao') then voto_ else null end;
begin
  if v is null or k is null then return null; end if;
  if enquete_ is not null then
    select * into ld from public.guia_whats_leads where enquete_id = enquete_ and salao_chave = k and criado_em > now() - interval '60 days' order by criado_em desc limit 1 for update;
  elsif lead_ is not null then
    select * into ld from public.guia_whats_leads where id = lead_ and salao_chave = k for update;
  end if;
  if ld.id is null then return null; end if;
  if ld.voto is null then
    update public.guia_whats_leads set
      voto = v, voto_origem = case when origem_ = 'texto' then 'texto' else 'enquete' end, votou_em = now(), voto_atual = v,
      salao_respondeu_em = coalesce(salao_respondeu_em, now()),
      status = case when status in ('enviado', 'salao_respondeu') then (case when v = 'sim' then 'salao_vai_atender' else 'salao_nao_atende' end) else status end
     where id = ld.id returning * into ld;
    return to_jsonb(ld) || jsonb_build_object('primeiro', true);
  end if;
  if ld.voto_atual is distinct from v then
    update public.guia_whats_leads set voto_atual = v, voto_mudou_em = now() where id = ld.id returning * into ld;
  end if;
  return to_jsonb(ld) || jsonb_build_object('primeiro', false);
end $$;

-- o salão respondeu por texto: não rebaixa quem já disse se vai atender (nem quem quer conhecer)
create or replace function public.guia_whats_salao_respondeu(lead_ bigint, texto_ text, quer_ boolean)
returns void language plpgsql security definer set search_path = public as $$
declare t text := left(btrim(coalesce(texto_, '')), 1000); novas jsonb;
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
end $$;

-- o salão disse não: a conversa da cliente reabre SEM salão e SEM pedido (ela escolhe outro), com a mensagem da Mel
-- anotada; nome, serviço e preferência ficam (ela não repete), os contadores zeram. Volta o id da conversa (ou null).
create or replace function public.guia_whats_conversa_reabrir(lead_ bigint, texto_ text)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  ld public.guia_whats_leads;
  msg jsonb := jsonb_build_object('q', 'mel', 't', left(coalesce(texto_, ''), 1500), 'em', now());
  n bigint;
begin
  select * into ld from public.guia_whats_leads where id = lead_;
  if ld.id is null or ld.conversa_id is null then return null; end if;
  update public.guia_whats_conversas c set
    estado = 'conversando', lugar_id = null, lead_id = null, cutucada_em = null,
    dados = (c.dados - 'pos_envio' - 'sem_avanco' - 'dona') || jsonb_build_object('salao_recusou', ld.salao_nome),
    mensagens = (select coalesce(jsonb_agg(m order by o), '[]'::jsonb) from (
                   select m, o from jsonb_array_elements(c.mensagens || msg) with ordinality as e(m, o) order by o desc limit 60) t),
    atualizada_em = now()
   where c.id = ld.conversa_id and not c.teste
  returning c.id into n;
  return n;
end $$;

-- ---- o relógio: os pedidos parados (só service_role; o whatsapp-webhook?tarefa=ociosas chama junto das conversas) --------
-- "parado" = enviado há mais de X minutos e o salão não abriu o link, não votou e não respondeu. Avisa a equipe uma vez
-- (aviso_demora_min) e cutuca o salão uma vez (cutucar_salao_min); cada um só se > 0 e, no aviso, só com numero_avisos.
-- Não olha pedidos velhos demais (até 2 dias depois do prazo) para não inundar a equipe ao ligar o recurso.
create or replace function public.guia_whats_pendentes()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cfg public.guia_whats_config;
begin
  select * into cfg from public.guia_whats_config where id = 1;
  if cfg.id is null or not cfg.ligado or cfg.numero is null then
    return jsonb_build_object('ativo', false, 'instancia', coalesce(cfg.instancia, ''), 'demora', '[]'::jsonb, 'cutucar', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'ativo', (cfg.aviso_demora_min > 0 and cfg.numero_avisos is not null) or cfg.cutucar_salao_min > 0,
    'instancia', cfg.instancia,
    'numero_avisos', cfg.numero_avisos,
    'texto_demora', cfg.msg_aviso_demora,
    'texto_cutucar', cfg.msg_cutucar_salao,
    'demora', case when cfg.aviso_demora_min > 0 and cfg.numero_avisos is not null then (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
        select id, salao_nome, cidade, cliente_nome, cliente_tel, servico, preferencia, token, salao_tel, enviado_em,
               extract(epoch from now() - enviado_em)::bigint / 60 as minutos
          from public.guia_whats_leads
         where status = 'enviado' and enviado_em is not null and clicou_em is null and voto is null and salao_respondeu_em is null and aviso_demora_em is null
           and enviado_em < now() - make_interval(mins => cfg.aviso_demora_min)
           and enviado_em > now() - make_interval(mins => cfg.aviso_demora_min) - interval '2 days'
         order by enviado_em limit 50) x) else '[]'::jsonb end,
    'cutucar', case when cfg.cutucar_salao_min > 0 then (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
        select id, salao_nome, cidade, cliente_nome, cliente_tel, servico, preferencia, token, salao_tel, enviado_em,
               extract(epoch from now() - enviado_em)::bigint / 60 as minutos
          from public.guia_whats_leads
         where status = 'enviado' and enviado_em is not null and clicou_em is null and voto is null and salao_respondeu_em is null and cutucado_em is null
           and salao_tel is not null
           and enviado_em < now() - make_interval(mins => cfg.cutucar_salao_min)
           and enviado_em > now() - make_interval(mins => cfg.cutucar_salao_min) - interval '2 days'
         order by enviado_em limit 50) x) else '[]'::jsonb end);
end $$;

-- marca o que o relógio fez (uma vez só por pedido)
create or replace function public.guia_whats_pendente_feita(id_ bigint, tipo_ text)
returns void language sql security definer set search_path = public as $$
  update public.guia_whats_leads set
    aviso_demora_em = case when tipo_ = 'demora' then coalesce(aviso_demora_em, now()) else aviso_demora_em end,
    cutucado_em = case when tipo_ = 'cutucar' then coalesce(cutucado_em, now()) else cutucado_em end
   where id = id_
$$;

-- o contexto do número: o pedido do salão inclui os que já votaram (para a resposta por texto continuar amarrada) e traz o voto
create or replace function public.guia_whats_contexto(tel_ text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  k text := public.guia_whats_chave(tel_);
  cv public.guia_whats_conversas;
  ocioso integer := greatest(1, least(coalesce((select ocioso_horas from public.guia_whats_config where id = 1), 24), 168));
  r jsonb;
begin
  if random() < 0.02 then
    delete from public.guia_whats_leads where criado_em < now() - make_interval(days => (select retencao_dias from public.guia_whats_config where id = 1));
    delete from public.guia_whats_conversas where atualizada_em < now() - make_interval(days => (select retencao_dias from public.guia_whats_config where id = 1))
       or (teste and atualizada_em < now() - interval '1 day');
  end if;
  select * into cv from public.guia_whats_conversas c where c.chave = k and c.atualizada_em > now() - make_interval(hours => ocioso) order by c.atualizada_em desc limit 1;
  select jsonb_build_object(
    'config', (select to_jsonb(c) - 'atualizado_por' from public.guia_whats_config c where c.id = 1),
    'saida', (select s.quem from public.guia_whats_saidas s where s.chave = k),
    'conversa', case when cv.id is null then null else to_jsonb(cv) - 'chave' || jsonb_build_object('lugar', case when cv.lugar_id is null then null else public.guia_whats_lugar(null, null, cv.lugar_id) end) end,
    'respostas_hoje', (select count(*) from public.guia_whats_conversas c, jsonb_array_elements(c.mensagens) m
                         where c.chave = k and c.atualizada_em > now() - interval '2 days' and m ->> 'q' = 'mel' and m ? 'em'
                           and (m ->> 'em')::timestamptz >= (date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo')),
    'lead_salao', (select jsonb_build_object('id', ld.id, 'salao_nome', ld.salao_nome, 'status', ld.status, 'ja_respondeu', ld.salao_respondeu_em is not null, 'voto', ld.voto)
                     from public.guia_whats_leads ld
                    where ld.salao_chave = k and ld.criado_em > now() - interval '30 days'
                      and ld.status in ('enviado', 'salao_respondeu', 'salao_quer_conhecer', 'salao_vai_atender', 'salao_nao_atende')
                    order by ld.clicou_em desc nulls last, ld.criado_em desc limit 1)
  ) into r;
  return r;
end $$;

-- o painel: os totais de quem vai e não vai atender, e o voto em cada pedido
create or replace function public.guia_whats_painel(dias_ integer default 7)
returns jsonb language plpgsql stable security definer set search_path = public set plan_cache_mode = force_custom_plan as $$
declare
  desde timestamptz := now() - make_interval(days => greatest(1, least(coalesce(dias_, 7), 90)));
  hoje_ini timestamptz := ((now() at time zone 'America/Sao_Paulo')::date)::timestamp at time zone 'America/Sao_Paulo';
begin
  if not public.eh_plataforma() then raise exception 'só a plataforma vê o WhatsApp do guia'; end if;
  return jsonb_build_object(
    'config', (select to_jsonb(c) from public.guia_whats_config c where c.id = 1),
    'totais', jsonb_build_object(
      'conversas', (select count(*) from public.guia_whats_conversas where not teste and criada_em >= desde),
      'pedidos', (select count(*) from public.guia_whats_leads where criado_em >= desde),
      'enviados', (select count(*) from public.guia_whats_leads where criado_em >= desde and enviado_em is not null),
      'falhas', (select count(*) from public.guia_whats_leads where criado_em >= desde and status in ('falhou', 'fora_do_limite')),
      'sem_contato', (select count(*) from public.guia_whats_leads where criado_em >= desde and status = 'sem_contato'),
      'responderam', (select count(*) from public.guia_whats_leads where criado_em >= desde and salao_respondeu_em is not null),
      'querem', (select count(*) from public.guia_whats_leads where criado_em >= desde and status = 'salao_quer_conhecer'),
      'abriram', (select count(*) from public.guia_whats_leads where criado_em >= desde and clicou_em is not null),
      'vao_atender', (select count(*) from public.guia_whats_leads where criado_em >= desde and voto = 'sim'),
      'nao_atendem', (select count(*) from public.guia_whats_leads where criado_em >= desde and voto = 'nao'),
      'demoraram', (select count(*) from public.guia_whats_leads where criado_em >= desde and aviso_demora_em is not null),
      'enviados_hoje', (select count(*) from public.guia_whats_leads where enviado_em >= hoje_ini and status <> 'falhou'),
      'saloes_sairam', (select count(*) from public.guia_whats_saidas where quem = 'salao')),
    'pedidos', (select coalesce(jsonb_agg(to_jsonb(x) order by x.criado_em desc), '[]'::jsonb) from (
                  select id, conversa_id, lugar_id, salao_nome, cidade, cliente_nome, cliente_tel, servico, preferencia, observacao, salao_tel, status,
                         erro, enviado_em, salao_respondeu_em, resposta_salao, salao_mensagens, atendido, clicou_em, cliques,
                         enquete_id is not null as com_enquete, voto, voto_origem, votou_em, voto_atual, voto_mudou_em, aviso_demora_em, cutucado_em, criado_em
                    from public.guia_whats_leads where criado_em >= desde order by criado_em desc limit 300) x),
    'conversas', (select coalesce(jsonb_agg(to_jsonb(x) order by x.atualizada_em desc), '[]'::jsonb) from (
                    select c.id, c.telefone, c.estado, c.atualizada_em, c.criada_em, c.lead_id, l.nome as salao, l.cidade,
                           jsonb_array_length(c.mensagens) as n, c.mensagens -> -1 ->> 't' as ultima
                      from public.guia_whats_conversas c left join public.guia_lugares l on l.id = c.lugar_id
                     where not c.teste and c.atualizada_em >= desde order by c.atualizada_em desc limit 100) x));
end $$;

-- a configuração salva o retorno do salão
create or replace function public.guia_whats_salvar(c jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  num text;
  avisos text;
begin
  if not public.eh_plataforma() then raise exception 'só a plataforma configura o WhatsApp do guia'; end if;
  if c ? 'numero' then
    num := nullif(regexp_replace(coalesce(c ->> 'numero', ''), '\D', '', 'g'), '');
    if num is not null and length(num) in (10, 11) then num := '55' || num; end if;
    if num is not null and num !~ '^[1-9][0-9]{9,14}$' then raise exception 'número inválido: use DDD e número (com 55 na frente, se quiser)'; end if;
  end if;
  if c ? 'numero_avisos' then
    avisos := nullif(regexp_replace(coalesce(c ->> 'numero_avisos', ''), '\D', '', 'g'), '');
    if avisos is not null and length(avisos) in (10, 11) then avisos := '55' || avisos; end if;
    if avisos is not null and avisos !~ '^[1-9][0-9]{9,14}$' then raise exception 'número de avisos inválido: use DDD e número (com 55 na frente, se quiser)'; end if;
  end if;
  begin
    update public.guia_whats_config g set
      ligado = coalesce((c ->> 'ligado')::boolean, g.ligado),
      numero = case when c ? 'numero' then num else g.numero end,
      numero_avisos = case when c ? 'numero_avisos' then avisos else g.numero_avisos end,
      instancia = coalesce(nullif(lower(btrim(c ->> 'instancia')), ''), g.instancia),
      botoes = case when c ? 'botoes' then array(select distinct x from jsonb_array_elements_text(c -> 'botoes') x order by 1) else g.botoes end,
      provedor = coalesce(nullif(c ->> 'provedor', ''), g.provedor),
      modelo = case when c ? 'modelo' then nullif(btrim(c ->> 'modelo'), '') else g.modelo end,
      orientacao = coalesce(nullif(btrim(c ->> 'orientacao'), ''), g.orientacao),
      msg_cliente = coalesce(nullif(btrim(c ->> 'msg_cliente'), ''), g.msg_cliente),
      msg_salao = coalesce(nullif(btrim(c ->> 'msg_salao'), ''), g.msg_salao),
      msg_salao_resposta = coalesce(nullif(btrim(c ->> 'msg_salao_resposta'), ''), g.msg_salao_resposta),
      msg_encerramento = coalesce(nullif(btrim(c ->> 'msg_encerramento'), ''), g.msg_encerramento),
      msg_ocioso = coalesce(nullif(btrim(c ->> 'msg_ocioso'), ''), g.msg_ocioso),
      msg_dona = coalesce(nullif(btrim(c ->> 'msg_dona'), ''), g.msg_dona),
      enquete_ativa = coalesce((c ->> 'enquete_ativa')::boolean, g.enquete_ativa),
      enquete_pergunta = coalesce(nullif(btrim(c ->> 'enquete_pergunta'), ''), g.enquete_pergunta),
      enquete_sim = coalesce(nullif(btrim(c ->> 'enquete_sim'), ''), g.enquete_sim),
      enquete_nao = coalesce(nullif(btrim(c ->> 'enquete_nao'), ''), g.enquete_nao),
      msg_salao_vai_atender = coalesce(nullif(btrim(c ->> 'msg_salao_vai_atender'), ''), g.msg_salao_vai_atender),
      msg_salao_nao_atende = coalesce(nullif(btrim(c ->> 'msg_salao_nao_atende'), ''), g.msg_salao_nao_atende),
      avisar_cliente_nao = coalesce((c ->> 'avisar_cliente_nao')::boolean, g.avisar_cliente_nao),
      msg_cliente_nao_atende = coalesce(nullif(btrim(c ->> 'msg_cliente_nao_atende'), ''), g.msg_cliente_nao_atende),
      aviso_nao_atende = coalesce((c ->> 'aviso_nao_atende')::boolean, g.aviso_nao_atende),
      msg_aviso_nao_atende = coalesce(nullif(btrim(c ->> 'msg_aviso_nao_atende'), ''), g.msg_aviso_nao_atende),
      aviso_demora_min = coalesce((c ->> 'aviso_demora_min')::integer, g.aviso_demora_min),
      msg_aviso_demora = coalesce(nullif(btrim(c ->> 'msg_aviso_demora'), ''), g.msg_aviso_demora),
      cutucar_salao_min = coalesce((c ->> 'cutucar_salao_min')::integer, g.cutucar_salao_min),
      msg_cutucar_salao = coalesce(nullif(btrim(c ->> 'msg_cutucar_salao'), ''), g.msg_cutucar_salao),
      mostrar_contato_salao = coalesce((c ->> 'mostrar_contato_salao')::boolean, g.mostrar_contato_salao),
      exigir_preferencia = coalesce((c ->> 'exigir_preferencia')::boolean, g.exigir_preferencia),
      ocioso_ativo = coalesce((c ->> 'ocioso_ativo')::boolean, g.ocioso_ativo),
      limite_dia = coalesce((c ->> 'limite_dia')::integer, g.limite_dia),
      limite_respostas = coalesce((c ->> 'limite_respostas')::integer, g.limite_respostas),
      pos_envio = coalesce((c ->> 'pos_envio')::integer, g.pos_envio),
      max_sem_avanco = coalesce((c ->> 'max_sem_avanco')::integer, g.max_sem_avanco),
      ocioso_horas = coalesce((c ->> 'ocioso_horas')::integer, g.ocioso_horas),
      ocioso_perguntar_min = coalesce((c ->> 'ocioso_perguntar_min')::integer, g.ocioso_perguntar_min),
      ocioso_encerrar_min = coalesce((c ->> 'ocioso_encerrar_min')::integer, g.ocioso_encerrar_min),
      retencao_dias = coalesce((c ->> 'retencao_dias')::integer, g.retencao_dias),
      atualizado_em = now(), atualizado_por = auth.uid()
     where g.id = 1;
  exception
    when check_violation then
      raise exception '%', case
        when sqlerrm ~ 'instancia' then 'instância inválida: letras minúsculas, números, - e _ (2 a 40)'
        when sqlerrm ~ 'botoes' then 'botões: whatsapp, ligar ou quero_marcar'
        when sqlerrm ~ 'provedor' then 'IA: groq ou claude'
        when sqlerrm ~ 'modelo' then 'modelo inválido'
        when sqlerrm ~ 'numero_avisos' then 'número de avisos inválido: use DDD e número'
        when sqlerrm ~ 'enquete_pergunta' then 'a pergunta da enquete: de 3 a 200 letras'
        when sqlerrm ~ 'enquete_(sim|nao)' then 'cada opção da enquete: de 2 a 60 letras'
        when sqlerrm ~ 'aviso_demora_min' then 'avisar a equipe da demora: 0 (desligado) ou de 5 a 10080 minutos'
        when sqlerrm ~ 'cutucar_salao_min' then 'cutucar o salão: 0 (desligado) ou de 5 a 10080 minutos'
        when sqlerrm ~ 'limite_respostas' then 'respostas por número por dia: de 1 a 500'
        when sqlerrm ~ 'limite_dia' then 'limite por dia: de 1 a 1000'
        when sqlerrm ~ 'pos_envio' then 'dúvidas depois do envio: de 0 a 20'
        when sqlerrm ~ 'max_sem_avanco' then 'mensagens sem avançar antes de encerrar: de 2 a 50'
        when sqlerrm ~ 'ocioso_perguntar_min' then 'minutos parada antes de perguntar: de 5 a 10080'
        when sqlerrm ~ 'ocioso_encerrar_min' then 'minutos desde a pergunta antes de encerrar: de 5 a 10080'
        when sqlerrm ~ 'ocioso_horas' then 'horas para esquecer a conversa parada: de 1 a 168'
        when sqlerrm ~ 'retencao_dias' then 'guardar as conversas: de 7 a 730 dias'
        when sqlerrm ~ 'orientacao' then 'a orientação da Mel: de 20 a 6000 letras'
        when sqlerrm ~ 'msg_dona' then 'a mensagem da dona: de 10 a 4000 letras'
        when sqlerrm ~ 'msg_' then 'mensagem curta ou longa demais'
        else sqlerrm end;
    when invalid_text_representation then raise exception 'valor inválido num campo de número ou sim/não';
  end;
  if (select ligado and numero is null from public.guia_whats_config where id = 1) then
    update public.guia_whats_config set ligado = false where id = 1;
    raise exception 'para ligar, informe o número do WhatsApp do guia';
  end if;
  return (select to_jsonb(g) from public.guia_whats_config g where g.id = 1);
end $$;

do $$
declare f text;
begin
  foreach f in array array['guia_whats_lead_enquete(bigint, text)', 'guia_whats_voto(text, text, text, bigint, text)', 'guia_whats_conversa_reabrir(bigint, text)',
    'guia_whats_pendentes()', 'guia_whats_pendente_feita(bigint, text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

do $$
begin
  raise notice '205: o retorno do salão — enquete "vai atender?" no pedido (enquete_id, voto, o primeiro vale), salao_vai_atender/salao_nao_atende, aviso à equipe e à cliente no não (a conversa reabre), o relógio avisa a demora e cutuca o salão (guia_whats_pendentes)';
end $$;
