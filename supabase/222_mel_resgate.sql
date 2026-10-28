-- 222_mel_resgate.sql
-- 3.77 — O salão que não responde não deixa mais a cliente esperando, e vira número para a abordagem.
--
-- 1. O RESGATE DA CLIENTE. O pedido que foi ao salão e ficou sem sinal (o salão não abriu o link, não votou e não
--    escreveu) por resgate_min minutos — ou que nem chegou (sem WhatsApp, falhou, limite do dia) — faz a Mel escrever
--    para a cliente: o salão ainda não respondeu e, para ela não ficar esperando, 2 ou 3 salões perto com o serviço
--    (guia_whats_alternativas: a mesma cidade, o serviço ou a categoria, os mais perto, e entre eles os que já agendam
--    pela MIMO e os que costumam responder; quem recebeu 3 pedidos e não deu sinal nenhum não é sugerido). Ela responde
--    o número, a Mel mostra o resumo com o salão novo e, só com o "sim", o pedido vai (LGPD: nada sai sem o sim). Só
--    dentro da janela resgate_inicio–resgate_fim (de madrugada a Mel espera a manhã) e nunca para quem já seguiu (pediu
--    em outro salão ou está no meio de outra conversa). O "não" do salão também passa a sugerir os salões.
--    Se o primeiro salão responder depois: a cliente que já foi para outro segue com ele (o salão recebe um obrigado);
--    a que ainda não escolheu recebe "o salão respondeu e vai te chamar", e a conversa volta para ele.
-- 2. O RELÓGIO À VISTA: guia_whats_relogio_bateu carimba relogio_em a cada passada (a aba WhatsApp mostra).
-- 3. OS SALÕES SEM RESPOSTA: guia_whats_sem_resposta (a lista da Plataforma, para a equipe conferir o número) e
--    guia_whats_conferir (a conferência anotada, numa tabela à parte: não mexe na página do salão).
-- 4. A ABORDAGEM com os dois argumentos: "N clientes ficaram sem resposta" (o que o salão perdeu) ao lado dos pedidos e
--    de quem disse que vai atender; o filtro "Sem resposta".
-- Depois: publicar whatsapp-webhook e guia-whats (bat 9) e o site (bat 2, que também liga a gravação das mensagens na
-- Evolution, para o voto da enquete voltar, e a limpeza de 90 dias).

-- ---- a configuração ------------------------------------------------------------------------------------------------
alter table public.guia_whats_config add column if not exists resgate_min integer not null default 30
  check (resgate_min = 0 or resgate_min between 5 and 1440);
alter table public.guia_whats_config add column if not exists resgate_inicio time not null default '08:00';
alter table public.guia_whats_config add column if not exists resgate_fim time not null default '21:00';
alter table public.guia_whats_config add column if not exists resgate_opcoes integer not null default 3 check (resgate_opcoes between 1 and 5);
alter table public.guia_whats_config add column if not exists msg_resgate text not null
  default $m$Oi, {nome}! O {salao} ainda não respondeu o seu pedido 😕

{opcoes}

Se preferir esperar o {salao}, é só me dizer 💗$m$
  check (length(msg_resgate) between 10 and 1500 and position('{opcoes}' in msg_resgate) > 0);
alter table public.guia_whats_config add column if not exists relogio_em timestamptz;
do $$ begin
  alter table public.guia_whats_config add constraint guia_whats_config_resgate_janela check (resgate_inicio < resgate_fim);
exception when duplicate_object then null; end $$;
-- o "não" do salão sugere os salões ({opcoes}); troca só o texto de fábrica da 205 (quem editou fica com o seu)
alter table public.guia_whats_config alter column msg_cliente_nao_atende set default $m$Oi, {nome}! O {salao} não vai conseguir te atender agora 😕

{opcoes}$m$;
update public.guia_whats_config set msg_cliente_nao_atende = $m$Oi, {nome}! O {salao} não vai conseguir te atender agora 😕

{opcoes}$m$
 where msg_cliente_nao_atende = 'Oi{nome}! O {salao} não vai conseguir te atender agora 😕 Quer que eu te ajude com outro salão? Me manda o nome ou o link de outro salão do guia que eu passo seu pedido pra ele.';
comment on column public.guia_whats_config.resgate_min is 'Mel (222): minutos sem sinal do salão até a Mel oferecer outros salões à cliente (0 = desligado).';
comment on column public.guia_whats_config.relogio_em is 'Mel (222): a última passada do relógio da VPS (cutucar-ociosas.sh).';

-- ---- o pedido --------------------------------------------------------------------------------------------------------
alter table public.guia_whats_leads add column if not exists resgate_em timestamptz;
alter table public.guia_whats_leads add column if not exists resgate_motivo text check (resgate_motivo is null or resgate_motivo in ('demora', 'sem_contato', 'falhou', 'nao'));
alter table public.guia_whats_leads add column if not exists resgate_opcoes jsonb;
alter table public.guia_whats_leads add column if not exists resgate_de bigint;
comment on column public.guia_whats_leads.resgate_em is 'Mel (222): quando a Mel ofereceu outros salões à cliente (resgate_motivo: demora, sem_contato, falhou ou nao).';
comment on column public.guia_whats_leads.resgate_de is 'Mel (222): o pedido de origem, quando este nasceu de um salão sugerido pela Mel (a cliente recuperada).';
create index if not exists guia_whats_leads_resgate_de on public.guia_whats_leads (resgate_de) where resgate_de is not null;

-- a conferência do número pela equipe (tabela à parte: mexer em guia_lugares carimbaria a página como mudada)
create table if not exists public.guia_whats_conferidos (
  lugar_id uuid primary key references public.guia_lugares (id) on delete cascade,
  em timestamptz not null default now(),
  nota text check (nota is null or length(nota) <= 300),
  por uuid
);
alter table public.guia_whats_conferidos enable row level security;
revoke all on public.guia_whats_conferidos from public, anon, authenticated;
comment on table public.guia_whats_conferidos is 'Mel (222): a equipe conferiu o número de um salão que não responde (quando e o que achou).';

-- ---- os salões para sugerir ----------------------------------------------------------------------------------------
-- A mesma cidade; com afinidade (2: um serviço do cadastro bate com uma palavra do pedido; 1: a mesma categoria; 0,5:
-- salão de beleza geral); até 20 km quando os dois têm o ponto no mapa. A ordem: a afinidade, a distância em faixas
-- (até 3 km, até 8, até 20; sem ponto, o mesmo bairro conta como perto), e dentro da faixa quem agenda pela MIMO, quem já
-- deu sinal num pedido da Mel, quem nunca recebeu, por último quem recebeu e não respondeu; depois os km e os pontos.
-- Fica fora: o próprio salão, os que esta cliente já tentou nos últimos 7 dias, quem não tem WhatsApp (nem agenda), quem
-- pediu SAIR e quem recebeu 3 ou mais pedidos em 60 dias sem sinal nenhum.
create or replace function public.guia_whats_alternativas_de(lugar_ uuid, servico_ text, chave_ text default null, n_ integer default 3)
returns jsonb language sql stable security definer set search_path = public as $$
  with o as (select l.id, l.cidade_slug, l.categoria, l.bairro, l.latitude, l.longitude from public.guia_lugares l where l.id = lugar_),
  pw as (select coalesce(array_agg(distinct w), '{}'::text[]) as ws
           from unnest(string_to_array(public.slug_de(left(coalesce(servico_, ''), 200)), '-')) w
          where length(w) >= 4 and w not in ('para', 'com', 'quero', 'queria', 'gostaria', 'fazer', 'marcar', 'agendar', 'horario', 'servico',
                                            'qualquer', 'algum', 'alguma', 'tarde', 'manha', 'noite', 'sabado', 'domingo', 'segunda', 'terca',
                                            'quarta', 'quinta', 'sexta', 'feira', 'semana', 'hoje', 'amanha', 'depois', 'cedo', 'minha', 'tambem')),
  tentados as (select distinct x.lugar_id from public.guia_whats_leads x
                where chave_ is not null and x.cliente_chave = chave_ and x.criado_em > now() - interval '7 days' and x.lugar_id is not null),
  hist as (select x.lugar_id, count(*) as pedidos,
                  count(*) filter (where x.clicou_em is not null or x.voto = 'sim' or x.salao_respondeu_em is not null) as sinal
             from public.guia_whats_leads x
            where x.criado_em > now() - interval '60 days' and x.lugar_id is not null and x.enviado_em is not null
            group by x.lugar_id),
  c as (
    select l.id, l.nome, l.bairro, s.subdominio as agendar,
           case when o.latitude is not null and o.longitude is not null and l.latitude is not null and l.longitude is not null
                then round((111.2 * sqrt(power(l.latitude - o.latitude, 2) + power((l.longitude - o.longitude) * cos(radians(o.latitude)), 2)))::numeric, 1) end as km,
           (case when cardinality(pw.ws) > 0 and exists (select 1 from unnest(l.servicos) sv cross join unnest(pw.ws) w where public.slug_de(sv) like '%' || w || '%') then 2 else 0 end
            + case when l.categoria = o.categoria then 1 else 0 end
            + case when l.categoria = 'beleza' and o.categoria <> 'beleza' then 0.5 else 0 end)::numeric as afinidade,
           case when s.subdominio is not null then 0 when coalesce(h.sinal, 0) > 0 then 1 when coalesce(h.pedidos, 0) = 0 then 2 else 3 end as faixa,
           coalesce(l.pontos, 0) as pontos, (o.bairro is not null and l.bairro = o.bairro) as mesmo_bairro
      from o cross join pw
      join public.guia_lugares l on l.cidade_slug = o.cidade_slug and l.status = 'publicado' and l.id <> o.id
      left join public.salons s on s.id = l.salon_id
      left join hist h on h.lugar_id = l.id
     where not exists (select 1 from tentados t where t.lugar_id = l.id)
       and (s.subdominio is not null
            or (l.whatsapp_invalido_em is null and public.guia_whats_do_salao(l.whatsapp, l.telefone) is not null
                and not exists (select 1 from public.guia_whats_saidas sd where sd.quem = 'salao'
                                  and sd.chave = public.guia_whats_chave(public.guia_whats_do_salao(l.whatsapp, l.telefone)))))
       and not (coalesce(h.pedidos, 0) >= 3 and coalesce(h.sinal, 0) = 0)
  ),
  ordem as (
    select c.*, row_number() over (order by c.afinidade desc,
                                            case when c.km is null then (case when c.mesmo_bairro then 1 else 3 end) when c.km <= 3 then 0 when c.km <= 8 then 1 else 2 end,
                                            c.faixa, c.km nulls last, c.mesmo_bairro desc, c.pontos desc, c.nome) as pos
      from c where c.afinidade > 0 and (c.km is null or c.km <= 20))
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'bairro', bairro, 'km', km, 'agendar', agendar) order by pos), '[]'::jsonb)
    from ordem where pos <= greatest(1, least(coalesce(n_, 3), 5))
$$;
create or replace function public.guia_whats_alternativas(lead_ bigint, n_ integer default 3)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select public.guia_whats_alternativas_de(ld.lugar_id, ld.servico, ld.cliente_chave, n_)
                     from public.guia_whats_leads ld where ld.id = lead_ and ld.lugar_id is not null), '[]'::jsonb)
$$;

-- ---- o relógio: os pedidos parados, agora com o resgate --------------------------------------------------------------
create or replace function public.guia_whats_pendentes()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cfg public.guia_whats_config;
  agora_sp time := (now() at time zone 'America/Sao_Paulo')::time;
begin
  select * into cfg from public.guia_whats_config where id = 1;
  if cfg.id is null or not cfg.ligado or cfg.numero is null then
    return jsonb_build_object('ativo', false, 'instancia', coalesce(cfg.instancia, ''), 'demora', '[]'::jsonb, 'cutucar', '[]'::jsonb, 'resgate', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'ativo', (cfg.aviso_demora_min > 0 and cfg.numero_avisos is not null) or cfg.cutucar_salao_min > 0 or cfg.resgate_min > 0,
    'instancia', cfg.instancia,
    'numero_avisos', cfg.numero_avisos,
    'texto_demora', cfg.msg_aviso_demora,
    'texto_cutucar', cfg.msg_cutucar_salao,
    'texto_resgate', cfg.msg_resgate,
    'resgate_opcoes', cfg.resgate_opcoes,
    'resgate_janela', cfg.resgate_min > 0 and agora_sp between cfg.resgate_inicio and cfg.resgate_fim,
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
         order by enviado_em limit 50) x) else '[]'::jsonb end,
    -- 222: o resgate. Sem sinal do salão (ou o pedido nem chegou), dentro da janela, só uma vez, até 20 h depois; nunca
    -- para quem já seguiu (um pedido mais novo dela, ou outra conversa dela aberta mais nova) nem conversa de teste
    'resgate', case when cfg.resgate_min > 0 and agora_sp between cfg.resgate_inicio and cfg.resgate_fim then (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
        select ld.id, ld.salao_nome, ld.cidade, ld.cliente_nome, ld.cliente_tel, ld.servico, ld.preferencia, ld.status,
               extract(epoch from now() - coalesce(ld.enviado_em, ld.criado_em))::bigint / 60 as minutos
          from public.guia_whats_leads ld
          join public.guia_whats_conversas cv on cv.id = ld.conversa_id and not cv.teste
         where ld.resgate_em is null
           and ((ld.status = 'enviado' and ld.clicou_em is null and ld.voto is null and ld.salao_respondeu_em is null)
                or ld.status in ('sem_contato', 'falhou', 'fora_do_limite'))
           and coalesce(ld.enviado_em, ld.criado_em) < now() - make_interval(mins => cfg.resgate_min)
           and coalesce(ld.enviado_em, ld.criado_em) > now() - interval '20 hours'
           and not exists (select 1 from public.guia_whats_leads x where x.cliente_chave = ld.cliente_chave and x.id <> ld.id and x.criado_em > ld.criado_em)
           and not exists (select 1 from public.guia_whats_conversas y where y.chave = cv.chave and y.id <> cv.id and not y.teste
                             and y.estado in ('conversando', 'confirmando') and y.atualizada_em > ld.criado_em)
         order by ld.criado_em limit 30) x) else '[]'::jsonb end);
end $$;

-- a Mel ofereceu outros salões (o resgate ou o "não" do salão): o pedido fica marcado e a conversa da cliente reabre sem
-- salão, com as opções guardadas (ela responde o número). Nome, serviço e preferência ficam. Volta o id da conversa.
create or replace function public.guia_whats_oferecer(lead_ bigint, texto_ text, opcoes_ jsonb, motivo_ text)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  ld public.guia_whats_leads;
  op jsonb := case when jsonb_typeof(opcoes_) = 'array' then opcoes_ else '[]'::jsonb end;
  msg jsonb := jsonb_build_object('q', 'mel', 't', left(coalesce(texto_, ''), 1500), 'em', now());
  n bigint;
begin
  select * into ld from public.guia_whats_leads where id = lead_ for update;
  if ld.id is null then return null; end if;
  update public.guia_whats_leads set
    resgate_em = coalesce(resgate_em, now()),
    resgate_motivo = coalesce(resgate_motivo, case when motivo_ in ('demora', 'sem_contato', 'falhou', 'nao') then motivo_ end),
    resgate_opcoes = op
   where id = ld.id;
  if ld.conversa_id is null then return null; end if;
  update public.guia_whats_conversas c set
    estado = 'conversando', lugar_id = null, lead_id = null, cutucada_em = null,
    dados = (c.dados - 'pos_envio' - 'sem_avanco' - 'dona' - 'opcoes' - 'resgate_de' - 'salao_recusou')
            || jsonb_build_object('salao_anterior', ld.salao_nome, 'resgate_de', ld.id, 'opcoes', op),
    mensagens = (select coalesce(jsonb_agg(m order by o), '[]'::jsonb) from (
                   select m, o from jsonb_array_elements(c.mensagens || msg) with ordinality as e(m, o) order by o desc limit 60) t),
    atualizada_em = now()
   where c.id = ld.conversa_id and not c.teste
  returning c.id into n;
  return n;
end $$;

-- a cliente já seguiu? (fez um pedido mais novo, em outro salão)
create or replace function public.guia_whats_cliente_seguiu(lead_ bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.guia_whats_leads ld join public.guia_whats_leads x on x.cliente_chave = ld.cliente_chave
                  where ld.id = lead_ and x.id <> ld.id and x.criado_em > ld.criado_em)
$$;

-- o salão respondeu depois do resgate e a cliente ainda não escolheu: a conversa volta para ele (pós-envio)
create or replace function public.guia_whats_conversa_voltou(lead_ bigint, texto_ text)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  ld public.guia_whats_leads;
  msg jsonb := jsonb_build_object('q', 'mel', 't', left(coalesce(texto_, ''), 1500), 'em', now());
  n bigint;
begin
  select * into ld from public.guia_whats_leads where id = lead_;
  if ld.id is null or ld.conversa_id is null then return null; end if;
  update public.guia_whats_conversas c set
    estado = 'enviado', lugar_id = ld.lugar_id, lead_id = ld.id, cutucada_em = null,
    dados = (c.dados - 'opcoes' - 'resgate_de' - 'salao_anterior') || jsonb_build_object('pos_envio', 0),
    mensagens = (select coalesce(jsonb_agg(m order by o), '[]'::jsonb) from (
                   select m, o from jsonb_array_elements(c.mensagens || msg) with ordinality as e(m, o) order by o desc limit 60) t),
    atualizada_em = now()
   where c.id = ld.conversa_id and not c.teste and c.lugar_id is null and (c.dados ->> 'resgate_de') = ld.id::text
  returning c.id into n;
  return n;
end $$;

-- o simulador da Plataforma ("e se o salão não responder?"): a conversa DE TESTE reabre com as opções, como a de verdade,
-- para dar para seguir escolhendo um número (não existe pedido de verdade na conversa de teste)
create or replace function public.guia_whats_teste_oferecer(tel_ text, texto_ text, opcoes_ jsonb, salao_ text)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  msg jsonb := jsonb_build_object('q', 'mel', 't', left(coalesce(texto_, ''), 1500), 'em', now());
  n bigint;
begin
  update public.guia_whats_conversas c set
    estado = 'conversando', lugar_id = null, lead_id = null, cutucada_em = null,
    dados = (c.dados - 'pos_envio' - 'sem_avanco' - 'dona' - 'opcoes')
            || jsonb_build_object('salao_anterior', left(coalesce(salao_, ''), 120), 'opcoes', case when jsonb_typeof(opcoes_) = 'array' then opcoes_ else '[]'::jsonb end),
    mensagens = (select coalesce(jsonb_agg(m order by o), '[]'::jsonb) from (
                   select m, o from jsonb_array_elements(c.mensagens || msg) with ordinality as e(m, o) order by o desc limit 60) t),
    atualizada_em = now()
   where c.id = (select x.id from public.guia_whats_conversas x where x.chave = public.guia_whats_chave(tel_) and x.teste order by x.atualizada_em desc limit 1)
  returning c.id into n;
  return n;
end $$;

-- o relógio passou (a aba WhatsApp mostra "o relógio passou há X min")
create or replace function public.guia_whats_relogio_bateu()
returns void language sql security definer set search_path = public as $$
  update public.guia_whats_config set relogio_em = now() where id = 1
$$;

-- o pedido que nasce de um salão sugerido leva o de origem (resgate_de): é a cliente recuperada (o resto é a 201)
create or replace function public.guia_whats_lead_criar(conversa_ bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cv public.guia_whats_conversas;
  lg jsonb;
  ld public.guia_whats_leads;
  st text;
  hoje_ini timestamptz := ((now() at time zone 'America/Sao_Paulo')::date)::timestamp at time zone 'America/Sao_Paulo';
begin
  select * into cv from public.guia_whats_conversas where id = conversa_ for update;
  if cv.id is null or cv.lugar_id is null then return jsonb_build_object('erro', 'conversa sem salão'); end if;
  if cv.lead_id is not null then
    select * into ld from public.guia_whats_leads where id = cv.lead_id;
    if ld.id is not null then return to_jsonb(ld) || jsonb_build_object('repetido', true); end if;
  end if;
  lg := public.guia_whats_lugar(null, null, cv.lugar_id);
  if lg is null then return jsonb_build_object('erro', 'salão fora do ar'); end if;
  st := case when (lg ->> 'salao_saiu')::boolean then 'salao_saiu'
             when lg ->> 'salao_tel' is null then 'sem_contato'
             -- o número do salão é o da própria cliente: não dá para mandar o pedido (iria para a cliente)
             when public.guia_whats_chave(lg ->> 'salao_tel') = cv.chave then 'sem_contato'
             when (select count(*) from public.guia_whats_leads where enviado_em >= hoje_ini and status <> 'falhou')
                  >= (select limite_dia from public.guia_whats_config where id = 1) then 'fora_do_limite'
             else 'pendente' end;
  insert into public.guia_whats_leads (conversa_id, lugar_id, salao_nome, cidade, cliente_nome, cliente_tel, cliente_chave, servico, preferencia, observacao, salao_tel, salao_chave, status, resgate_de)
  values (cv.id, cv.lugar_id, lg ->> 'nome', lg ->> 'cidade', nullif(left(cv.dados ->> 'nome', 80), ''), cv.telefone, cv.chave,
          nullif(left(cv.dados ->> 'servico', 200), ''), nullif(left(cv.dados ->> 'preferencia', 200), ''), nullif(left(cv.dados ->> 'observacao', 400), ''),
          lg ->> 'salao_tel', public.guia_whats_chave(lg ->> 'salao_tel'), st,
          case when cv.dados ->> 'resgate_de' ~ '^[0-9]{1,18}$' then (cv.dados ->> 'resgate_de')::bigint end)
  returning * into ld;
  update public.guia_whats_conversas set lead_id = ld.id where id = cv.id;
  return to_jsonb(ld) || jsonb_build_object('repetido', false);
end $$;


-- ---- os salões que não respondem (a lista da Plataforma) -------------------------------------------------------------
-- "sem resposta" = foi ao salão há mais de 2 horas e ele não abriu o link, não votou e não escreveu; "não chegou" = sem
-- WhatsApp ou o envio falhou. Por salão, no período: os pedidos, as clientes, quantos ficaram sem resposta, quantos não
-- chegaram, quantos ele respondeu, para quantos a Mel ofereceu outro salão, o último pedido e a conferência da equipe.
create or replace function public.guia_whats_sem_resposta(dias_ integer default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  desde timestamptz := now() - make_interval(days => greatest(1, least(coalesce(dias_, 30), 90)));
begin
  if not public.eh_plataforma() then raise exception 'só a plataforma vê os salões sem resposta'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(x) order by x.sem_resposta + x.nao_chegou desc, x.ultimo desc), '[]'::jsonb) from (
    select l.id as lugar_id, l.nome, l.cidade, l.cidade_slug, l.slug, l.bairro, l.telefone, l.whatsapp,
           public.guia_whats_do_salao(l.whatsapp, l.telefone) as numero,
           l.whatsapp_invalido_em is not null as invalido, l.whatsapp_invalido_motivo as invalido_motivo,
           (s.subdominio is not null) as na_mimo, cf.em as conferido_em, cf.nota as conferido_nota,
           count(*) as pedidos,
           count(distinct ld.cliente_chave) as clientes,
           count(*) filter (where ld.status = 'enviado' and ld.clicou_em is null and ld.voto is null and ld.salao_respondeu_em is null
                              and ld.enviado_em < now() - interval '2 hours') as sem_resposta,
           count(*) filter (where ld.status in ('sem_contato', 'falhou')) as nao_chegou,
           count(*) filter (where ld.clicou_em is not null or ld.voto is not null or ld.salao_respondeu_em is not null) as responderam,
           count(*) filter (where ld.resgate_em is not null) as ofereceu_outro,
           max(ld.criado_em) as ultimo
      from public.guia_whats_leads ld
      join public.guia_lugares l on l.id = ld.lugar_id
      left join public.salons s on s.id = l.salon_id
      left join public.guia_whats_conferidos cf on cf.lugar_id = l.id
     where ld.criado_em >= desde
     group by l.id, s.subdominio, cf.em, cf.nota
    having count(*) filter (where (ld.status = 'enviado' and ld.clicou_em is null and ld.voto is null and ld.salao_respondeu_em is null
                                    and ld.enviado_em < now() - interval '2 hours') or ld.status in ('sem_contato', 'falhou')) > 0
     order by count(*) filter (where (ld.status = 'enviado' and ld.clicou_em is null and ld.voto is null and ld.salao_respondeu_em is null
                                       and ld.enviado_em < now() - interval '2 hours') or ld.status in ('sem_contato', 'falhou')) desc, max(ld.criado_em) desc
     limit 300) x);
end $$;

-- a equipe conferiu o número (nota curta: "atende por este número", "número errado", "não atendeu"…); nota vazia e
-- desfazer_ = true apagam a conferência
create or replace function public.guia_whats_conferir(lugar_ uuid, nota_ text default null, desfazer_ boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.eh_plataforma() then raise exception 'só a Plataforma'; end if;
  if coalesce(desfazer_, false) then
    delete from public.guia_whats_conferidos where lugar_id = lugar_;
    return jsonb_build_object('ok', true, 'em', null);
  end if;
  insert into public.guia_whats_conferidos (lugar_id, em, nota, por)
  values (lugar_, now(), nullif(left(btrim(coalesce(nota_, '')), 300), ''), auth.uid())
  on conflict (lugar_id) do update set em = excluded.em, nota = excluded.nota, por = excluded.por;
  return jsonb_build_object('ok', true, 'em', now());
end $$;

-- o painel leva o resgate (o resto é a 205)
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
      -- 222: para quantas a Mel ofereceu outro salão, e quantas fizeram o pedido num deles (recuperadas)
      'resgatados', (select count(*) from public.guia_whats_leads where criado_em >= desde and resgate_em is not null),
      'recuperados', (select count(*) from public.guia_whats_leads where criado_em >= desde and resgate_de is not null),
      'enviados_hoje', (select count(*) from public.guia_whats_leads where enviado_em >= hoje_ini and status <> 'falhou'),
      'saloes_sairam', (select count(*) from public.guia_whats_saidas where quem = 'salao')),
    'pedidos', (select coalesce(jsonb_agg(to_jsonb(x) order by x.criado_em desc), '[]'::jsonb) from (
                  select id, conversa_id, lugar_id, salao_nome, cidade, cliente_nome, cliente_tel, servico, preferencia, observacao, salao_tel, status,
                         erro, enviado_em, salao_respondeu_em, resposta_salao, salao_mensagens, atendido, clicou_em, cliques,
                         enquete_id is not null as com_enquete, voto, voto_origem, votou_em, voto_atual, voto_mudou_em, aviso_demora_em, cutucado_em, criado_em,
                         resgate_em, resgate_motivo, resgate_opcoes, resgate_de
                    from public.guia_whats_leads where criado_em >= desde order by criado_em desc limit 300) x),
    'conversas', (select coalesce(jsonb_agg(to_jsonb(x) order by x.atualizada_em desc), '[]'::jsonb) from (
                    select c.id, c.telefone, c.estado, c.atualizada_em, c.criada_em, c.lead_id, l.nome as salao, l.cidade,
                           jsonb_array_length(c.mensagens) as n, c.mensagens -> -1 ->> 't' as ultima
                      from public.guia_whats_conversas c left join public.guia_lugares l on l.id = c.lugar_id
                     where not c.teste and c.atualizada_em >= desde order by c.atualizada_em desc limit 100) x));
end $$;

-- a Plataforma salva o resgate (o resto é a 221)
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
      sobre_agenda = coalesce((c ->> 'sobre_agenda')::boolean, g.sobre_agenda),
      msg_sobre_agenda = coalesce(nullif(btrim(c ->> 'msg_sobre_agenda'), ''), g.msg_sobre_agenda),
      msg_sobre_agenda_site = coalesce(nullif(btrim(c ->> 'msg_sobre_agenda_site'), ''), g.msg_sobre_agenda_site),
      resgate_min = coalesce((c ->> 'resgate_min')::integer, g.resgate_min),
      resgate_inicio = coalesce(nullif(btrim(c ->> 'resgate_inicio'), '')::time, g.resgate_inicio),
      resgate_fim = coalesce(nullif(btrim(c ->> 'resgate_fim'), '')::time, g.resgate_fim),
      resgate_opcoes = coalesce((c ->> 'resgate_opcoes')::integer, g.resgate_opcoes),
      msg_resgate = coalesce(nullif(btrim(c ->> 'msg_resgate'), ''), g.msg_resgate),
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
        when sqlerrm ~ 'resgate_janela' then 'a janela do resgate: o começo antes do fim (ex.: 08:00 a 21:00)'
        when sqlerrm ~ 'resgate_min' then 'oferecer outro salão depois de: 0 (desligado) ou de 5 a 1440 minutos'
        when sqlerrm ~ 'resgate_opcoes' then 'quantos salões sugerir: de 1 a 5'
        when sqlerrm ~ 'msg_resgate' then 'a mensagem do resgate: de 10 a 1500 letras, com {opcoes}'
        when sqlerrm ~ 'msg_sobre_agenda_site' then 'a mensagem da MIMO Agenda com o comercial desligado: de 10 a 2000 letras, com {link}'
        when sqlerrm ~ 'msg_sobre_agenda' then 'a mensagem da MIMO Agenda: de 10 a 2000 letras, com {link}'
        when sqlerrm ~ 'msg_' then 'mensagem curta ou longa demais'
        else sqlerrm end;
    when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then raise exception 'valor inválido num campo de número, horário ou sim/não';
  end;
  if (select ligado and numero is null from public.guia_whats_config where id = 1) then
    update public.guia_whats_config set ligado = false where id = 1;
    raise exception 'para ligar, informe o número do WhatsApp do guia';
  end if;
  return (select to_jsonb(g) from public.guia_whats_config g where g.id = 1);
end $$;

-- a Abordagem com os dois argumentos: quem disse que vai atender e quem deixou as clientes sem resposta; o filtro
-- "Sem resposta" (o resto é a 206)
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
           -- 222: as clientes que ficaram sem resposta (foi há mais de 2 h e nada; ou nem chegou: sem WhatsApp, falhou)
           count(*) filter (where (ld.status = 'enviado' and ld.clicou_em is null and ld.voto is null and ld.salao_respondeu_em is null
                                   and ld.enviado_em < now() - interval '2 hours') or ld.status in ('sem_contato', 'falhou')) as sem_resp,
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
           coalesce(ml.respondeu, 0) as mel_respondeu, ml.ultimo as mel_ultimo, coalesce(ml.sem_resp, 0) as mel_sem,
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
            + coalesce(case when c.mel_sem > 0 and c.mel_vai = 0 then 40 * least(c.mel_sem, 3) end, 0)
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
                    when 'sem_resposta' then k.fora_motivo is null and k.mel_sem > 0
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
          ('mel_sem', case when j.mel_sem > 0 and j.mel_vai = 0 then 40 * least(j.mel_sem, 3) end,
             case when j.mel_sem = 1 then '1 cliente ficou sem resposta' else j.mel_sem || ' clientes ficaram sem resposta' end),
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
           count(*) filter (where fora_motivo is null and mel_sem > 0) as sem_resposta, coalesce(sum(mel_sem), 0) as mel_sem,
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
        'contagem', jsonb_build_object('todos', n.todos, 'fila', n.fila, 'lembretes', n.lembretes, 'pedidos', n.pedidos, 'mel', n.mel, 'querem', n.querem, 'sem_resposta', n.sem_resposta)
                    || coalesce((select jsonb_object_agg(s.status_ef, s.n) from (select status_ef, count(*) as n from calc group by status_ef) s), '{}'::jsonb),
        'funil', jsonb_build_object('para_abordar', n.para_abordar, 'abordados', n.abordados, 'responderam', n.responderam, 'clientes', n.clientes, 'ja_eram', n.ja_eram),
        'mel', jsonb_build_object('pedidos', n.mel_pedidos, 'abriram', n.mel_abriram, 'vai', n.mel_vai, 'nao', n.mel_nao, 'querem', n.mel_querem, 'donas', n.mel_donas, 'sem', n.mel_sem, 'visitas', n.visitas, 'contatos', n.contatos))
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
                                  'quer', i.mel_quer, 'quer_em', i.mel_quer_em, 'ultimo', i.mel_ultimo, 'dona_em', i.mel_dona_em, 'sair', i.mel_sair, 'da_pagina', i.mel_da_pagina, 'sem', i.mel_sem))
      order by i.pos)
      from itens i), '[]'::jsonb)
  ) into r;
  return r;
end $$;


-- ---- quem chama o quê -------------------------------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array['guia_whats_alternativas_de(uuid, text, text, integer)', 'guia_whats_alternativas(bigint, integer)',
    'guia_whats_oferecer(bigint, text, jsonb, text)', 'guia_whats_cliente_seguiu(bigint)', 'guia_whats_conversa_voltou(bigint, text)',
    'guia_whats_relogio_bateu()', 'guia_whats_teste_oferecer(text, text, jsonb, text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['guia_whats_sem_resposta(integer)', 'guia_whats_conferir(uuid, text, boolean)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

do $$ begin raise notice '222: o resgate da cliente (resgate_*, guia_whats_alternativas, guia_whats_oferecer), o relógio à vista (relogio_em), os salões sem resposta (guia_whats_sem_resposta, guia_whats_conferidos) e a Abordagem com "ficaram sem resposta"'; end $$;
