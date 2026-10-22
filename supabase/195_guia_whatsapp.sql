-- 195 (3.48): o WhatsApp do guia. Nos salões que ainda não estão na MIMO, quem toca em WhatsApp, Ligar ou "Quero
-- marcar" abre uma conversa com o número da MIMO (não com o do salão), já com o código do salão na mensagem. A Mel (o
-- bot, com Groq ou Claude) pré-atende: diz quem é, anota nome, serviço e preferência de dia e horário, mostra o resumo e
-- pede licença para enviar. Com o "sim", o pedido sai do nosso número para o WhatsApp do salão (com o link para falar
-- com a cliente). O salão atende a cliente; se responder QUERO, vira oportunidade para a equipe; SAIR para de receber.
--
-- Tudo se configura na Plataforma (aba WhatsApp do Guia): liga e desliga, o número e a instância da Evolution, quais
-- botões passam pela MIMO, a IA e o modelo, a orientação da Mel, as mensagens (a da cliente, a do salão, a resposta ao
-- salão), se a cliente recebe o contato do salão no fim, o limite de envios por dia e por quanto tempo as conversas ficam.
--
-- LGPD: a Mel se apresenta como MIMO no começo; nada vai ao salão sem o "sim" da cliente depois do resumo; "apagar meus
-- dados" na conversa apaga tudo dela; as conversas e os pedidos saem depois de retencao_dias; o salão sai com SAIR.
--
--   guia_whats_config      a configuração (uma linha)
--   guia_whats_conversas   cada conversa (a de teste da Plataforma também, marcada)
--   guia_whats_leads       cada pedido enviado (ou que não deu para enviar) ao salão
--   guia_whats_saidas      quem pediu para não receber mais (salão) ou apagou os dados (cliente)
-- Funções: guia_contato_config() pública (o site lê o número e os botões); guia_whats_painel, _conversa, _salvar,
-- _lead_atendido para a Plataforma; o resto só para as Edge Functions (service role).

-- ---- telefones ---------------------------------------------------------------------------------------------------------
-- a chave para comparar: o WhatsApp entrega celular brasileiro com e sem o nono dígito, conforme a conta
create or replace function public.guia_whats_chave(tel text)
returns text language sql immutable set search_path = public as $$
  select case when d is null then nullif(btrim(coalesce(tel, '')), '')
              when length(d) = 13 and left(d, 2) = '55' and substr(d, 5, 1) = '9' then left(d, 4) || substr(d, 6)
              else d end
    from (select public.telefone_e164(tel) as d) x
$$;
-- o WhatsApp do salão: o que o cadastro diz que é WhatsApp; senão, o telefone, se for celular brasileiro
create or replace function public.guia_whats_do_salao(whatsapp text, telefone text)
returns text language sql immutable set search_path = public as $$
  select coalesce(public.telefone_e164(whatsapp),
                  (select d from (select public.telefone_e164(telefone) as d) x where d ~ '^55[1-9][0-9]9[0-9]{8}$'))
$$;

-- ---- a configuração ----------------------------------------------------------------------------------------------------
create table if not exists public.guia_whats_config (
  id integer primary key default 1 check (id = 1),
  ligado boolean not null default false,
  numero text check (numero is null or numero ~ '^[1-9][0-9]{9,14}$'),
  instancia text not null default 'mimo-guia' check (instancia ~ '^[a-z0-9][a-z0-9_-]{1,39}$'),
  botoes text[] not null default array['whatsapp', 'ligar', 'quero_marcar'] check (botoes <@ array['whatsapp', 'ligar', 'quero_marcar']),
  provedor text not null default 'groq' check (provedor in ('groq', 'claude')),
  modelo text check (modelo is null or modelo ~ '^[a-zA-Z0-9._/:-]{2,80}$'),
  orientacao text not null default $o$Você é a Mel, assistente da MIMO, um guia de salões de beleza. Quem escreve encontrou o {salao} no guia da MIMO e quer marcar um horário. Você não é o salão: você anota o pedido e passa para o salão, que chama a cliente aqui no WhatsApp para combinar.

Como conversar:
- Na primeira resposta, diga quem você é: que é a Mel, da MIMO, o guia onde ela encontrou o {salao}, e que anota o pedido e passa para o salão, que chama ela aqui no WhatsApp. Com suas palavras, curto.
- Descubra, numa conversa curta e simpática, o nome dela, o serviço que quer e a preferência de dia e horário (pode ser "qualquer dia de manhã"). Uma pergunta por vez. Mensagens curtas, como no WhatsApp.
- Use os dados do salão para dúvidas simples (endereço, bairro, serviços do cadastro, horário de funcionamento). Não invente preço, vaga, promoção nem profissional: diga que o salão confirma.
- Nunca diga que o horário está marcado: quem confirma é o salão.
- Se ela quiser outro salão, peça o nome ou o link da página no guia.
- Português do Brasil, no máximo um emoji por mensagem.
- Nunca passe o telefone do salão nem mande a cliente ligar ou procurar o salão por conta própria: o seu papel é anotar o pedido e enviar.$o$ check (length(orientacao) between 20 and 6000),
  msg_cliente text not null default 'Olá! Vi o {salao} no guia da MIMO e quero marcar um horário.' check (length(msg_cliente) between 5 and 500),
  msg_salao text not null default $s$💗 Novo pedido de atendimento pela MIMO

Cliente: {cliente}
Serviço: {servico}
Preferência: {preferencia}
Observação: {observacao}
Contato: {contato}

Ela encontrou seu salão pela MIMO e quer combinar esse atendimento com você.

👉 Falar com a cliente: {link}

E uma dica: pedidos como esse podem chegar de forma muito mais organizada quando você usa a MIMO como agenda do salão.

Se esse atendimento der certo e você quiser entender como funciona, chama a gente por aqui.

Para não receber mais pedidos pela MIMO, responda SAIR.$s$ check (length(msg_salao) between 10 and 3000),
  msg_salao_resposta text not null default 'Obrigada pelo retorno! 💗 Se quiser receber pedidos assim direto na agenda do salão, com link próprio para as clientes marcarem e lembretes automáticos, responda QUERO que a equipe da MIMO te chama. Para não receber mais pedidos por aqui, responda SAIR.' check (length(msg_salao_resposta) between 5 and 1500),
  mostrar_contato_salao boolean not null default false,
  limite_dia integer not null default 40 check (limite_dia between 1 and 1000),
  retencao_dias integer not null default 90 check (retencao_dias between 7 and 730),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid
);
insert into public.guia_whats_config (id) values (1) on conflict (id) do nothing;
alter table public.guia_whats_config enable row level security;
comment on table public.guia_whats_config is 'Guia (195): o WhatsApp do guia (a Mel pré-atende e passa o pedido ao salão). Uma linha; mexe-se pela Plataforma (guia_whats_salvar).';

-- ---- as conversas, os pedidos e as saídas ------------------------------------------------------------------------------
create table if not exists public.guia_whats_conversas (
  id bigint generated always as identity primary key,
  telefone text not null,
  chave text not null,
  lugar_id uuid references public.guia_lugares (id) on delete set null,
  estado text not null default 'conversando' check (estado in ('conversando', 'confirmando', 'enviado', 'encerrada')),
  dados jsonb not null default '{}'::jsonb,
  mensagens jsonb not null default '[]'::jsonb,
  lead_id bigint,
  teste boolean not null default false,
  criada_em timestamptz not null default now(),
  atualizada_em timestamptz not null default now()
);
create index if not exists guia_whats_conversas_chave on public.guia_whats_conversas (chave, atualizada_em desc);
create index if not exists guia_whats_conversas_quando on public.guia_whats_conversas (atualizada_em);
alter table public.guia_whats_conversas enable row level security;

create table if not exists public.guia_whats_leads (
  id bigint generated always as identity primary key,
  conversa_id bigint references public.guia_whats_conversas (id) on delete set null,
  lugar_id uuid references public.guia_lugares (id) on delete set null,
  salao_nome text not null,
  cidade text,
  cliente_nome text,
  cliente_tel text not null,
  cliente_chave text not null,
  servico text,
  preferencia text,
  observacao text,
  salao_tel text,
  salao_chave text,
  status text not null default 'pendente' check (status in ('pendente', 'enviado', 'falhou', 'sem_contato', 'fora_do_limite', 'salao_saiu', 'salao_respondeu', 'salao_quer_conhecer')),
  erro text,
  provider_id text,
  mensagem text,
  enviado_em timestamptz,
  salao_respondeu_em timestamptz,
  resposta_salao text,
  atendido boolean not null default false,
  criado_em timestamptz not null default now()
);
create index if not exists guia_whats_leads_quando on public.guia_whats_leads (criado_em desc);
create index if not exists guia_whats_leads_salao on public.guia_whats_leads (salao_chave, criado_em desc);
create index if not exists guia_whats_leads_cliente on public.guia_whats_leads (cliente_chave);
alter table public.guia_whats_leads enable row level security;

create table if not exists public.guia_whats_saidas (
  chave text primary key,
  quem text not null check (quem in ('salao', 'cliente')),
  em timestamptz not null default now()
);
alter table public.guia_whats_saidas enable row level security;

revoke all on public.guia_whats_config, public.guia_whats_conversas, public.guia_whats_leads, public.guia_whats_saidas from anon, authenticated;

-- ---- o que o site lê (público): só ligado, o número, os botões e a mensagem pronta da cliente ---------------------------
create or replace function public.guia_contato_config()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when c.ligado and c.numero is not null
              then jsonb_build_object('ligado', true, 'numero', c.numero, 'botoes', to_jsonb(c.botoes), 'msg_cliente', c.msg_cliente)
              else jsonb_build_object('ligado', false) end
    from public.guia_whats_config c where c.id = 1
$$;
revoke execute on function public.guia_contato_config() from public;
grant execute on function public.guia_contato_config() to anon, authenticated;

-- ---- os fatos de um salão para a Mel (publicado; o WhatsApp dele; se saiu; se já agenda pela MIMO) -----------------------
create or replace function public.guia_whats_lugar(cidade_ text, slug_ text, id_ uuid default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
           'id', l.id, 'nome', l.nome, 'categoria', l.categoria, 'cidade', l.cidade, 'cidade_slug', l.cidade_slug, 'slug', l.slug,
           'uf', l.uf, 'bairro', l.bairro, 'endereco', l.endereco, 'servicos', l.servicos, 'horarios', l.horarios,
           'telefone', l.telefone, 'whatsapp', l.whatsapp,
           'salao_tel', public.guia_whats_do_salao(l.whatsapp, l.telefone),
           'salao_saiu', exists (select 1 from public.guia_whats_saidas s where s.quem = 'salao' and s.chave = public.guia_whats_chave(public.guia_whats_do_salao(l.whatsapp, l.telefone))),
           'agendar', (select s.subdominio from public.salons s where s.id = l.salon_id))
    from public.guia_lugares l
   where l.status = 'publicado' and (case when id_ is not null then l.id = id_ else l.cidade_slug = cidade_ and l.slug = slug_ end)
   limit 1
$$;

-- quando a cliente apagou o código da mensagem: o salão pelo nome (até 3, só publicados)
create or replace function public.guia_whats_buscar(texto_ text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'nome', x.nome, 'cidade', x.cidade)), '[]'::jsonb)
    from (select l.id, l.nome, l.cidade from public.guia_lugares l
           where l.status = 'publicado' and length(public.slug_de(texto_)) >= 4
             and public.slug_de(l.nome) like '%' || public.slug_de(texto_) || '%'
           order by length(l.nome) limit 3) x
$$;

-- ---- a entrada de cada mensagem: a configuração, se o número saiu, a conversa aberta (24 h) e o pedido de quem é salão ----
create or replace function public.guia_whats_contexto(tel_ text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  k text := public.guia_whats_chave(tel_);
  cv public.guia_whats_conversas;
  r jsonb;
begin
  -- a limpeza (de vez em quando): o que passou da retenção; as de teste, depois de um dia
  if random() < 0.02 then
    delete from public.guia_whats_leads where criado_em < now() - make_interval(days => (select retencao_dias from public.guia_whats_config where id = 1));
    delete from public.guia_whats_conversas where atualizada_em < now() - make_interval(days => (select retencao_dias from public.guia_whats_config where id = 1))
       or (teste and atualizada_em < now() - interval '1 day');
  end if;
  select * into cv from public.guia_whats_conversas c where c.chave = k and c.atualizada_em > now() - interval '24 hours' order by c.atualizada_em desc limit 1;
  select jsonb_build_object(
    'config', (select to_jsonb(c) - 'atualizado_por' from public.guia_whats_config c where c.id = 1),
    'saida', (select s.quem from public.guia_whats_saidas s where s.chave = k),
    'conversa', case when cv.id is null then null else to_jsonb(cv) - 'chave' || jsonb_build_object('lugar', case when cv.lugar_id is null then null else public.guia_whats_lugar(null, null, cv.lugar_id) end) end,
    'lead_salao', (select jsonb_build_object('id', ld.id, 'salao_nome', ld.salao_nome, 'status', ld.status, 'ja_respondeu', ld.salao_respondeu_em is not null)
                     from public.guia_whats_leads ld
                    where ld.salao_chave = k and ld.criado_em > now() - interval '30 days' and ld.status in ('enviado', 'salao_respondeu', 'salao_quer_conhecer')
                    order by ld.criado_em desc limit 1)
  ) into r;
  return r;
end $$;

-- grava a conversa (nova quando id_ é nulo) com as mensagens novas no fim (as 60 últimas ficam)
create or replace function public.guia_whats_conversa_salvar(id_ bigint, tel_ text, lugar_ uuid, estado_ text, dados_ jsonb, novas_ jsonb, teste_ boolean default false)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  n bigint;
  novas jsonb := case when jsonb_typeof(novas_) = 'array' then novas_ else '[]'::jsonb end;
begin
  if id_ is null then
    insert into public.guia_whats_conversas (telefone, chave, lugar_id, estado, dados, mensagens, teste)
    values (left(tel_, 60), public.guia_whats_chave(tel_), lugar_, coalesce(estado_, 'conversando'), coalesce(dados_, '{}'::jsonb), novas, coalesce(teste_, false))
    returning id into n;
    return n;
  end if;
  update public.guia_whats_conversas c set
    lugar_id = coalesce(lugar_, c.lugar_id),
    estado = coalesce(estado_, c.estado),
    dados = coalesce(dados_, c.dados),
    mensagens = (select coalesce(jsonb_agg(m order by o), '[]'::jsonb) from (
                   select m, o from jsonb_array_elements(c.mensagens || novas) with ordinality as e(m, o)
                   order by o desc limit 60) t),
    atualizada_em = now()
   where c.id = id_
  returning c.id into n;
  return n;
end $$;

-- o pedido da conversa (uma vez por conversa): o que dá para fazer com ele, pela ordem
--   salao_saiu (pediu para não receber) · sem_contato (sem WhatsApp no cadastro) · fora_do_limite (o teto do dia) · pendente (vai sair agora)
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
             when (select count(*) from public.guia_whats_leads where enviado_em >= hoje_ini and status <> 'falhou')
                  >= (select limite_dia from public.guia_whats_config where id = 1) then 'fora_do_limite'
             else 'pendente' end;
  insert into public.guia_whats_leads (conversa_id, lugar_id, salao_nome, cidade, cliente_nome, cliente_tel, cliente_chave, servico, preferencia, observacao, salao_tel, salao_chave, status)
  values (cv.id, cv.lugar_id, lg ->> 'nome', lg ->> 'cidade', nullif(left(cv.dados ->> 'nome', 80), ''), cv.telefone, cv.chave,
          nullif(left(cv.dados ->> 'servico', 200), ''), nullif(left(cv.dados ->> 'preferencia', 200), ''), nullif(left(cv.dados ->> 'observacao', 400), ''),
          lg ->> 'salao_tel', public.guia_whats_chave(lg ->> 'salao_tel'), st)
  returning * into ld;
  update public.guia_whats_conversas set lead_id = ld.id where id = cv.id;
  return to_jsonb(ld) || jsonb_build_object('repetido', false);
end $$;

-- o resultado do envio ao salão (e o texto que foi)
create or replace function public.guia_whats_lead_resultado(lead_ bigint, ok_ boolean, provider_ text, erro_ text, mensagem_ text)
returns void language sql security definer set search_path = public as $$
  update public.guia_whats_leads set
    status = case when ok_ then 'enviado' else 'falhou' end,
    enviado_em = case when ok_ then now() else enviado_em end,
    provider_id = left(provider_, 120), erro = case when ok_ then null else left(erro_, 300) end, mensagem = left(mensagem_, 3000)
   where id = lead_
$$;

-- o salão respondeu ao pedido (QUERO: quer conhecer a MIMO)
create or replace function public.guia_whats_salao_respondeu(lead_ bigint, texto_ text, quer_ boolean)
returns void language sql security definer set search_path = public as $$
  update public.guia_whats_leads set
    status = case when quer_ then 'salao_quer_conhecer' when status = 'salao_quer_conhecer' then status else 'salao_respondeu' end,
    salao_respondeu_em = coalesce(salao_respondeu_em, now()),
    resposta_salao = left(coalesce(resposta_salao || E'\n', '') || btrim(coalesce(texto_, '')), 1000)
   where id = lead_
$$;

-- SAIR (salão) e VOLTAR
create or replace function public.guia_whats_sair(tel_ text, quem_ text, sair_ boolean default true)
returns void language plpgsql security definer set search_path = public as $$
begin
  if sair_ then
    insert into public.guia_whats_saidas (chave, quem) values (public.guia_whats_chave(tel_), quem_)
    on conflict (chave) do update set quem = excluded.quem, em = now();
  else
    delete from public.guia_whats_saidas where chave = public.guia_whats_chave(tel_);
  end if;
end $$;

-- "apagar meus dados": as conversas e os pedidos dessa pessoa somem
create or replace function public.guia_whats_apagar(tel_ text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare k text := public.guia_whats_chave(tel_); nl integer; nc integer;
begin
  delete from public.guia_whats_leads where cliente_chave = k; get diagnostics nl = row_count;
  delete from public.guia_whats_conversas where chave = k; get diagnostics nc = row_count;
  return jsonb_build_object('pedidos', nl, 'conversas', nc);
end $$;

-- reenviar pela Plataforma: os dados do pedido (menos de quem saiu)
create or replace function public.guia_whats_reenvio(lead_ bigint)
returns jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(ld) from public.guia_whats_leads ld
   where ld.id = lead_ and ld.salao_tel is not null
     and not exists (select 1 from public.guia_whats_saidas s where s.quem = 'salao' and s.chave = ld.salao_chave)
$$;

do $$
declare f text;
begin
  foreach f in array array['guia_whats_lugar(text, text, uuid)', 'guia_whats_buscar(text)', 'guia_whats_contexto(text)',
    'guia_whats_conversa_salvar(bigint, text, uuid, text, jsonb, jsonb, boolean)', 'guia_whats_lead_criar(bigint)',
    'guia_whats_lead_resultado(bigint, boolean, text, text, text)', 'guia_whats_salao_respondeu(bigint, text, boolean)',
    'guia_whats_sair(text, text, boolean)', 'guia_whats_apagar(text)', 'guia_whats_reenvio(bigint)'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

-- ---- a Plataforma -------------------------------------------------------------------------------------------------------
-- o painel: a configuração, os números do período, os pedidos e as conversas recentes (sem as de teste)
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
      'enviados_hoje', (select count(*) from public.guia_whats_leads where enviado_em >= hoje_ini and status <> 'falhou'),
      'saloes_sairam', (select count(*) from public.guia_whats_saidas where quem = 'salao')),
    'pedidos', (select coalesce(jsonb_agg(to_jsonb(x) order by x.criado_em desc), '[]'::jsonb) from (
                  select id, conversa_id, lugar_id, salao_nome, cidade, cliente_nome, cliente_tel, servico, preferencia, observacao, salao_tel, status,
                         erro, enviado_em, salao_respondeu_em, resposta_salao, atendido, criado_em
                    from public.guia_whats_leads where criado_em >= desde order by criado_em desc limit 300) x),
    'conversas', (select coalesce(jsonb_agg(to_jsonb(x) order by x.atualizada_em desc), '[]'::jsonb) from (
                    select c.id, c.telefone, c.estado, c.atualizada_em, c.criada_em, c.lead_id, l.nome as salao, l.cidade,
                           jsonb_array_length(c.mensagens) as n, c.mensagens -> -1 ->> 't' as ultima
                      from public.guia_whats_conversas c left join public.guia_lugares l on l.id = c.lugar_id
                     where not c.teste and c.atualizada_em >= desde order by c.atualizada_em desc limit 100) x));
end $$;

create or replace function public.guia_whats_conversa(id_ bigint)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.eh_plataforma() then raise exception 'só a plataforma vê as conversas'; end if;
  return (select to_jsonb(c) - 'chave' || jsonb_build_object('salao', l.nome, 'cidade', l.cidade)
            from public.guia_whats_conversas c left join public.guia_lugares l on l.id = c.lugar_id where c.id = id_);
end $$;

-- salvar a configuração: só os campos conhecidos; o que vier fora da regra volta com a mensagem do campo
create or replace function public.guia_whats_salvar(c jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  num text;
begin
  if not public.eh_plataforma() then raise exception 'só a plataforma configura o WhatsApp do guia'; end if;
  if c ? 'numero' then
    num := nullif(regexp_replace(coalesce(c ->> 'numero', ''), '\D', '', 'g'), '');
    if num is not null and length(num) in (10, 11) then num := '55' || num; end if;
    if num is not null and num !~ '^[1-9][0-9]{9,14}$' then raise exception 'número inválido: use DDD e número (com 55 na frente, se quiser)'; end if;
  end if;
  begin
    update public.guia_whats_config g set
      ligado = coalesce((c ->> 'ligado')::boolean, g.ligado),
      numero = case when c ? 'numero' then num else g.numero end,
      instancia = coalesce(nullif(lower(btrim(c ->> 'instancia')), ''), g.instancia),
      botoes = case when c ? 'botoes' then array(select distinct x from jsonb_array_elements_text(c -> 'botoes') x order by 1) else g.botoes end,
      provedor = coalesce(nullif(c ->> 'provedor', ''), g.provedor),
      modelo = case when c ? 'modelo' then nullif(btrim(c ->> 'modelo'), '') else g.modelo end,
      orientacao = coalesce(nullif(btrim(c ->> 'orientacao'), ''), g.orientacao),
      msg_cliente = coalesce(nullif(btrim(c ->> 'msg_cliente'), ''), g.msg_cliente),
      msg_salao = coalesce(nullif(btrim(c ->> 'msg_salao'), ''), g.msg_salao),
      msg_salao_resposta = coalesce(nullif(btrim(c ->> 'msg_salao_resposta'), ''), g.msg_salao_resposta),
      mostrar_contato_salao = coalesce((c ->> 'mostrar_contato_salao')::boolean, g.mostrar_contato_salao),
      limite_dia = coalesce((c ->> 'limite_dia')::integer, g.limite_dia),
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
        when sqlerrm ~ 'limite_dia' then 'limite por dia: de 1 a 1000'
        when sqlerrm ~ 'retencao_dias' then 'guardar as conversas: de 7 a 730 dias'
        when sqlerrm ~ 'orientacao' then 'a orientação da Mel: de 20 a 6000 letras'
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

create or replace function public.guia_whats_lead_atendido(id_ bigint, atendido_ boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.eh_plataforma() then raise exception 'só a plataforma mexe nos pedidos'; end if;
  update public.guia_whats_leads set atendido = coalesce(atendido_, true) where id = id_;
end $$;

revoke execute on function public.guia_whats_painel(integer), public.guia_whats_conversa(bigint), public.guia_whats_salvar(jsonb), public.guia_whats_lead_atendido(bigint, boolean) from public, anon;
grant execute on function public.guia_whats_painel(integer), public.guia_whats_conversa(bigint), public.guia_whats_salvar(jsonb), public.guia_whats_lead_atendido(bigint, boolean) to authenticated;

do $$
begin
  raise notice '195: WhatsApp do guia (configuração, conversas, pedidos, saídas; guia_contato_config pública; painel e salvar da Plataforma). Começa desligado.';
end $$;
