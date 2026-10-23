-- 203 (3.55): o agente de onboarding da MIMO pelo WhatsApp.
-- Até aqui a Mel do guia só atendia CLIENTE (anota o pedido e passa ao salão). Agora, no mesmo número e no mesmo webhook,
-- existe um segundo agente — separado, com persona, contexto, passos e configuração próprios — que atende a PROFISSIONAL
-- (dona de salão ou autônoma) que quer criar a conta dela na MIMO Agenda, e faz o cadastro conversando:
--   tipo (autônoma ou salão) → CNPJ (consultado na Receita: só ATIVO passa; "não tenho" → CPF, que o Asaas precisa)
--   → endereço (puxado do CNPJ e confirmado, ou pedido) → nome do negócio → nº de profissionais → serviços (e explica que
--   o cadastro completo é no painel) → horários → e-mail → explicações (QR code, link próprio, lembretes) → o LINK.
-- Senha NUNCA pelo WhatsApp: no fim o agente manda um link seguro (mimo.com.vc/comecar?c=<token>, com validade) que abre o
-- cadastro já pré-preenchido com tudo que ele coletou; na tela a pessoa só cria a senha, aceita os termos e escolhe o plano.
--
-- Como entra no agente (o webhook decide antes de chamar a Mel-cliente):
--   1. já existe uma conversa de onboarding aberta deste número → continua nela;
--   2. a mensagem traz um GATILHO (config.gatilhos): o 1º gatilho é a frase do botão das landings (origem "cta", intenção
--      certa, começa direto); qualquer outro é intenção percebida (origem "intencao") e o agente PRIMEIRO confirma
--      ("você quer criar sua conta?") — quem é cliente diz que não e volta à Mel-cliente;
--   3. nada disso → a Mel-cliente, como sempre.
-- Tolerância: respostas inválidas seguidas (CNPJ/CPF/e-mail) encerram depois de N (config.tolerancia; o CNPJ tem a sua),
-- com aviso à equipe (numero_avisos da guia_whats_config) para um humano retomar — o lead nunca cai no vazio.
--
--   guia_onboarding_config   a configuração do agente (uma linha): liga/desliga, IA, persona, gatilhos, tolerância, a
--                            validade do link, os passos opcionais e os textos ponto a ponto (o que explicar em cada passo
--                            e as mensagens fixas: confirmar intenção, inválidos, confirmar endereço, o link, encerrar)
--   guia_onboarding_leads    cada profissional que entrou no agente: a conversa, o rascunho (dados), o token do link, se
--                            abriu, se concluiu (vínculo ao salão criado)
-- Funções: guia_onboarding_publico() pública (o site monta o botão: número + frase); guia_onboarding_por_token pública (o
-- /comecar lê o rascunho); guia_onboarding_concluir para quem acabou de criar a conta; painel/lead/config_salvar para a
-- Plataforma; o resto só para as Edge Functions (service role). Idempotente.

-- ---- a configuração do agente ------------------------------------------------------------------------------------------
create table if not exists public.guia_onboarding_config (
  id integer primary key default 1 check (id = 1),
  ligado boolean not null default false,
  provedor text not null default 'groq' check (provedor in ('groq', 'claude')),
  modelo text check (modelo is null or modelo ~ '^[a-zA-Z0-9._/:-]{2,80}$'),
  -- a persona e as regras gerais (o passo atual e o que coletar o motor acrescenta a cada mensagem)
  orientacao text not null default $o$Você é a Mel, da MIMO. Aqui você NÃO está anotando pedido de cliente: está ajudando uma profissional de beleza (dona de salão ou autônoma) a criar a conta dela na MIMO Agenda, conversando pelo WhatsApp. Você é a recepcionista que faz o cadastro e explica como a MIMO funciona.

Como conversar:
- Uma pergunta por vez. Mensagens curtas, como no WhatsApp. Português do Brasil, no máximo um emoji por mensagem.
- Siga o passo atual que o sistema indica abaixo. Não pule passo nem peça dois dados de uma vez. Se ela já respondeu o que o passo pede, anote e vá para o próximo.
- Nunca peça senha e nunca peça cartão. A senha e o aceite dos termos ela faz no link seguro que você manda no fim.
- Se ela disser que não é profissional (é cliente querendo marcar um horário), marque nao_e_profissional: o sistema devolve ela ao atendimento de cliente com gentileza.
- Não invente preço, prazo nem funcionalidade. Se não souber, diga que a equipe da MIMO confirma.
- Quando ela mandar um dado (CNPJ, CPF, e-mail), só anote no campo certo: o sistema valida e te diz o que responder.
- Se ela perguntar algo fora do cadastro, responda curto e volte ao passo atual.$o$ check (length(orientacao) between 20 and 8000),
  -- as frases que fazem o webhook entregar a mensagem a este agente (minúsculas, sem acento; o 1º é a frase do botão)
  gatilhos text[] not null default array['quero criar minha conta na mimo agenda', 'quero criar minha conta', 'criar minha conta na mimo', 'criar conta na mimo', 'quero a mimo agenda', 'quero usar a mimo agenda', 'quero me cadastrar na mimo', 'cadastrar meu salao na mimo']
    check (cardinality(gatilhos) between 1 and 40),
  tolerancia integer not null default 3 check (tolerancia between 1 and 20),
  tolerancia_cnpj integer not null default 3 check (tolerancia_cnpj between 1 and 20),
  link_dias integer not null default 7 check (link_dias between 1 and 60),
  -- os passos opcionais (tipo, documento, endereço, nome e profissionais são sempre pedidos)
  com_servicos boolean not null default true,
  com_horarios boolean not null default true,
  com_email boolean not null default true,
  com_explicacoes boolean not null default true,
  -- o que dizer/explicar em cada passo (a IA fala com as palavras dela, mas segue isto)
  passo_tipo text not null default 'Pergunte se ela atende sozinha, como autônoma, ou se tem um salão com equipe. Diga em uma frase que a MIMO serve para as duas.' check (length(passo_tipo) between 5 and 2000),
  passo_documento text not null default 'Pergunte o CNPJ do negócio (só os números). Diga que, se ela não tiver CNPJ (autônoma ou MEI sem CNPJ), é só responder "não tenho" que você pede o CPF, necessário para o pagamento da assinatura.' check (length(passo_documento) between 5 and 2000),
  passo_endereco text not null default 'Se o sistema trouxe o endereço do CNPJ, ele mesmo mostra e pede confirmação; se ela disser que atende em outro endereço, anote o novo. Sem CNPJ, pergunte o endereço onde ela atende (rua, número, bairro e cidade); se atende em domicílio, basta bairro e cidade.' check (length(passo_endereco) between 5 and 2000),
  passo_nome text not null default 'Pergunte o nome do negócio como as clientes conhecem (o nome fantasia). Se o CNPJ trouxe um nome, sugira e pergunte se é esse mesmo o nome para as clientes.' check (length(passo_nome) between 5 and 2000),
  passo_profissionais text not null default 'Pergunte quantas profissionais atendem no espaço, contando ela. Autônoma é 1.' check (length(passo_profissionais) between 5 and 2000),
  passo_servicos text not null default 'Pergunte os 3 a 5 serviços principais que ela oferece (só os nomes). Explique, curto, que a lista completa — com preço e duração — ela cadastra no painel depois de entrar, em "Serviços", e que é rápido.' check (length(passo_servicos) between 5 and 2000),
  passo_horarios text not null default 'Pergunte os dias e horários de atendimento (ex.: segunda a sexta 9h às 19h, sábado 9h às 14h).' check (length(passo_horarios) between 5 and 2000),
  passo_email text not null default 'Pergunte o e-mail que vai ser o login da conta (é por ele que chega a confirmação). Peça para conferir a digitação.' check (length(passo_email) between 5 and 2000),
  passo_explicacoes text not null default 'Antes do link, explique em duas ou três mensagens curtas: (1) dentro do painel ela gera um link próprio (nome.mimo.com.vc) e um QR code para as clientes marcarem sozinhas — dá para imprimir e colar no salão ou mandar no WhatsApp; (2) as clientes recebem lembretes automáticos; (3) o próximo passo é só criar a senha no link seguro que você vai mandar. Pergunte se ficou alguma dúvida.' check (length(passo_explicacoes) between 5 and 2000),
  -- as mensagens fixas (momentos decididos pelo sistema, não pela IA)
  msg_confirmar text not null default 'Oi! Aqui é a Mel, da MIMO 💗 Pelo que você escreveu, parece que você é profissional de beleza e quer criar sua conta na MIMO Agenda — é isso? Se for, me responde *sim* que eu já começo seu cadastro por aqui. Se você é cliente querendo marcar um horário, me diz de qual salão.' check (length(msg_confirmar) between 10 and 2000),
  msg_boas_vindas text not null default 'Oi! Aqui é a Mel, da MIMO 💗 Que bom que você quer a MIMO Agenda! Vou fazer seu cadastro por aqui mesmo, em poucos passos — no fim te mando um link seguro só pra você criar a senha. Vamos começar?' check (length(msg_boas_vindas) between 10 and 2000),
  msg_nao_sou text not null default 'Sem problema! 💗 Então vamos ao seu horário: de qual salão você quer marcar? Me manda o nome como aparece no guia ou o link da página dele.' check (length(msg_nao_sou) between 10 and 2000),
  msg_cnpj_invalido text not null default 'Hmm, esse CNPJ não passou: {motivo}. Para criar a conta preciso de um CNPJ válido e ativo na Receita. Confere e me manda de novo (só os números)? Se você não tem CNPJ, responde *não tenho*.' check (length(msg_cnpj_invalido) between 10 and 2000),
  msg_cpf_invalido text not null default 'Esse CPF não parece válido 😅 Confere os 11 números e me manda de novo?' check (length(msg_cpf_invalido) between 10 and 2000),
  msg_email_invalido text not null default 'Esse e-mail não parece certo 😅 Confere e me manda de novo?' check (length(msg_email_invalido) between 10 and 2000),
  msg_endereco_confirmar text not null default E'Achei na Receita! 📍 O endereço do CNPJ é:\n{endereco}\n\nÉ aí que você atende? Responde *sim* ou me manda o endereço certo.' check (length(msg_endereco_confirmar) between 10 and 2000),
  msg_link text not null default E'Prontinho! 💗 O cadastro de *{nome}* está anotado. Agora é só criar sua senha e aceitar os termos neste link seguro (vale {dias} dias):\n{link}\n\nQualquer dúvida, me chama por aqui.' check (length(msg_link) between 10 and 2000 and msg_link like '%{link}%'),
  msg_encerrar text not null default 'Acho que não estou conseguindo te ajudar direito por aqui 💗 Vou pedir para alguém da equipe da MIMO te chamar e fazer o cadastro com você, tá? Até já!' check (length(msg_encerrar) between 10 and 2000),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid
);
insert into public.guia_onboarding_config (id) values (1) on conflict (id) do nothing;
alter table public.guia_onboarding_config enable row level security;
comment on table public.guia_onboarding_config is 'Guia (203): o agente de onboarding pelo WhatsApp (cria a conta da profissional conversando). Uma linha; mexe-se pela Plataforma (guia_onboarding_config_salvar).';

-- ---- cada profissional que entrou no agente: a conversa, o rascunho, o token do link ------------------------------------
create table if not exists public.guia_onboarding_leads (
  id bigint generated always as identity primary key,
  telefone text not null,
  chave text not null,
  origem text not null default 'intencao' check (origem in ('cta', 'intencao', 'dona', 'teste')),
  -- confirmando (perguntou se é profissional) · coletando (os passos) · enviado (o link foi) · concluido (a conta nasceu) · encerrada
  estado text not null default 'confirmando' check (estado in ('confirmando', 'coletando', 'enviado', 'concluido', 'encerrada')),
  dados jsonb not null default '{}'::jsonb,
  mensagens jsonb not null default '[]'::jsonb,
  token text not null unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 16),
  token_expira timestamptz,          -- só existe depois que o link foi mandado; antes disso o token não abre nada
  aberto_em timestamptz,             -- a primeira vez que o /comecar leu o rascunho por este token
  salao_id uuid references public.salons (id) on delete set null,
  concluido_em timestamptz,
  teste boolean not null default false,
  criado_em timestamptz not null default now(),
  atualizada_em timestamptz not null default now()
);
create index if not exists guia_onboarding_leads_chave on public.guia_onboarding_leads (chave, atualizada_em desc);
create index if not exists guia_onboarding_leads_quando on public.guia_onboarding_leads (criado_em desc);
alter table public.guia_onboarding_leads enable row level security;
comment on table public.guia_onboarding_leads is 'Guia (203): cada profissional atendida pelo agente de onboarding — a conversa, o rascunho do cadastro (dados), o token do link e o desfecho.';

revoke all on public.guia_onboarding_config, public.guia_onboarding_leads from anon, authenticated;

-- ---- o que o site lê (público): se o agente está ligado, o número e a frase do botão -----------------------------------
create or replace function public.guia_onboarding_publico()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when o.ligado and w.ligado and w.numero is not null
              then jsonb_build_object('ligado', true, 'numero', w.numero, 'frase', o.gatilhos[1])
              else jsonb_build_object('ligado', false) end
    from public.guia_onboarding_config o, public.guia_whats_config w where o.id = 1 and w.id = 1
$$;
revoke execute on function public.guia_onboarding_publico() from public;
grant execute on function public.guia_onboarding_publico() to anon, authenticated;

-- ---- a entrada de cada mensagem (Edge Function): a configuração, o número/instância da Mel e a conversa aberta ----------
-- A conversa de onboarding fica "aberta" por 48 h desde a última mensagem (quem para e volta no dia seguinte continua de
-- onde parou); fora disso, uma mensagem nova começa outra (o rascunho antigo fica para a métrica).
create or replace function public.guia_onboarding_contexto(tel_ text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  k text := public.guia_whats_chave(tel_);
  cv public.guia_onboarding_leads;
begin
  if random() < 0.02 then
    delete from public.guia_onboarding_leads where (teste and atualizada_em < now() - interval '1 day')
       or (estado in ('encerrada', 'concluido') and atualizada_em < now() - interval '180 days');
  end if;
  select * into cv from public.guia_onboarding_leads c
   where c.chave = k and c.estado not in ('encerrada', 'concluido') and c.atualizada_em > now() - interval '48 hours'
   order by c.atualizada_em desc limit 1;
  return jsonb_build_object(
    'config', (select to_jsonb(c) - 'atualizado_por' from public.guia_onboarding_config c where c.id = 1),
    'mel', (select jsonb_build_object('ligado', w.ligado, 'numero', w.numero, 'instancia', w.instancia, 'numero_avisos', w.numero_avisos) from public.guia_whats_config w where w.id = 1),
    'conversa', case when cv.id is null then null else to_jsonb(cv) - 'chave' end);
end $$;

-- grava a conversa (nova quando id_ é nulo) com as mensagens novas no fim (as 80 últimas ficam)
create or replace function public.guia_onboarding_conversa_salvar(id_ bigint, tel_ text, estado_ text, dados_ jsonb, novas_ jsonb, origem_ text default null, teste_ boolean default false)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  n bigint;
  novas jsonb := case when jsonb_typeof(novas_) = 'array' then novas_ else '[]'::jsonb end;
begin
  if id_ is null then
    insert into public.guia_onboarding_leads (telefone, chave, origem, estado, dados, mensagens, teste)
    values (left(tel_, 60), public.guia_whats_chave(tel_), coalesce(origem_, 'intencao'), coalesce(estado_, 'confirmando'), coalesce(dados_, '{}'::jsonb), novas, coalesce(teste_, false))
    returning id into n;
    return n;
  end if;
  update public.guia_onboarding_leads c set
    estado = coalesce(estado_, c.estado),
    dados = coalesce(dados_, c.dados),
    mensagens = (select coalesce(jsonb_agg(m order by o), '[]'::jsonb) from (
                   select m, o from jsonb_array_elements(c.mensagens || novas) with ordinality as e(m, o)
                   order by o desc limit 80) t),
    atualizada_em = now()
   where c.id = id_
  returning c.id into n;
  return n;
end $$;

-- o link vai sair: carimba a validade (link_dias) e devolve o token. Chamado de novo (reenvio), estende a validade.
create or replace function public.guia_onboarding_gerar_link(id_ bigint)
returns text language plpgsql security definer set search_path = public as $$
declare t text;
begin
  update public.guia_onboarding_leads set
    token_expira = now() + make_interval(days => (select link_dias from public.guia_onboarding_config where id = 1)),
    atualizada_em = now()
   where id = id_ returning token into t;
  return t;
end $$;

-- ---- o /comecar lê o rascunho (público): só com token válido, dentro da validade, depois que o link foi mandado ----------
-- Devolve só o que pré-preenche o cadastro — nunca o telefone, a conversa ou o estado interno. Marca a primeira abertura.
create or replace function public.guia_onboarding_por_token(token_ text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ld public.guia_onboarding_leads;
begin
  if token_ is null or length(token_) not between 8 and 40 then return jsonb_build_object('ok', false, 'motivo', 'token'); end if;
  select * into ld from public.guia_onboarding_leads where token = token_ and not teste;
  if ld.id is null or ld.token_expira is null then return jsonb_build_object('ok', false, 'motivo', 'nao_existe'); end if;
  if ld.estado = 'concluido' then return jsonb_build_object('ok', false, 'motivo', 'concluido'); end if;
  if ld.token_expira < now() then return jsonb_build_object('ok', false, 'motivo', 'expirado'); end if;
  update public.guia_onboarding_leads set aberto_em = coalesce(aberto_em, now()) where id = ld.id;
  return jsonb_build_object('ok', true, 'expira', ld.token_expira,
    'dados', jsonb_build_object(
      'tipo', ld.dados ->> 'tipo', 'cnpj', ld.dados ->> 'cnpj', 'cpf', ld.dados ->> 'cpf',
      'razao_social', ld.dados ->> 'razao_social', 'nome', ld.dados ->> 'nome',
      'endereco', ld.dados -> 'endereco', 'profissionais', ld.dados -> 'profissionais',
      'servicos', ld.dados -> 'servicos', 'horarios', ld.dados ->> 'horarios', 'email', ld.dados ->> 'email',
      'whatsapp', ld.telefone));
end $$;
revoke all on function public.guia_onboarding_por_token(text) from public;
grant execute on function public.guia_onboarding_por_token(text) to anon, authenticated;

-- ---- a conta nasceu: quem acabou de criar o salão amarra o rascunho a ele (só o dono do salão) --------------------------
create or replace function public.guia_onboarding_concluir(token_ text, salao_ uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return false; end if;
  if not exists (select 1 from public.salons s where s.id = salao_ and s.owner_id = auth.uid()) then return false; end if;
  update public.guia_onboarding_leads set
    estado = 'concluido', salao_id = salao_, concluido_em = coalesce(concluido_em, now()), atualizada_em = now()
   where token = token_ and token_expira is not null and not teste;
  return found;
end $$;
revoke all on function public.guia_onboarding_concluir(text, uuid) from public, anon;
grant execute on function public.guia_onboarding_concluir(text, uuid) to authenticated;

-- "apagar meus dados" (LGPD) e o reiniciar do simulador: tudo desse número some (a chave bate com e sem o 9º dígito)
create or replace function public.guia_onboarding_apagar(tel_ text)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  delete from public.guia_onboarding_leads where chave = public.guia_whats_chave(tel_); get diagnostics n = row_count;
  return n;
end $$;

do $$
declare f text;
begin
  foreach f in array array['guia_onboarding_contexto(text)', 'guia_onboarding_conversa_salvar(bigint, text, text, jsonb, jsonb, text, boolean)', 'guia_onboarding_gerar_link(bigint)', 'guia_onboarding_apagar(text)'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

-- ---- a Plataforma -------------------------------------------------------------------------------------------------------
-- o painel: a configuração, os números do período (por desfecho e por origem) e os leads recentes (sem os de teste)
create or replace function public.guia_onboarding_painel(dias_ integer default 30)
returns jsonb language plpgsql stable security definer set search_path = public set plan_cache_mode = force_custom_plan as $$
declare
  desde timestamptz := now() - make_interval(days => greatest(1, least(coalesce(dias_, 30), 365)));
begin
  if not public.eh_plataforma() then raise exception 'só a plataforma vê o onboarding'; end if;
  return jsonb_build_object(
    'config', (select to_jsonb(c) from public.guia_onboarding_config c where c.id = 1),
    'mel', (select jsonb_build_object('ligado', w.ligado, 'numero', w.numero, 'numero_avisos', w.numero_avisos) from public.guia_whats_config w where w.id = 1),
    'totais', jsonb_build_object(
      'entraram', (select count(*) from public.guia_onboarding_leads where not teste and criado_em >= desde),
      'confirmaram', (select count(*) from public.guia_onboarding_leads where not teste and criado_em >= desde and estado <> 'confirmando' and not (estado = 'encerrada' and (dados ->> 'passo') is null)),
      'link_enviado', (select count(*) from public.guia_onboarding_leads where not teste and criado_em >= desde and token_expira is not null),
      'abriram', (select count(*) from public.guia_onboarding_leads where not teste and criado_em >= desde and aberto_em is not null),
      'concluiram', (select count(*) from public.guia_onboarding_leads where not teste and criado_em >= desde and estado = 'concluido'),
      'encerradas', (select count(*) from public.guia_onboarding_leads where not teste and criado_em >= desde and estado = 'encerrada'),
      'por_origem', (select coalesce(jsonb_object_agg(origem, n), '{}'::jsonb) from (select origem, count(*) n from public.guia_onboarding_leads where not teste and criado_em >= desde group by origem) x)),
    'leads', (select coalesce(jsonb_agg(to_jsonb(x) order by x.atualizada_em desc), '[]'::jsonb) from (
                select id, telefone, origem, estado, dados ->> 'passo' as passo, dados ->> 'tipo' as tipo, dados ->> 'nome' as nome,
                       dados ->> 'cnpj' as cnpj, dados ->> 'email' as email, dados -> 'endereco' ->> 'cidade' as cidade,
                       token_expira, aberto_em, concluido_em, salao_id, jsonb_array_length(mensagens) as n, mensagens -> -1 ->> 't' as ultima,
                       criado_em, atualizada_em
                  from public.guia_onboarding_leads where not teste and atualizada_em >= desde order by atualizada_em desc limit 300) x));
end $$;

create or replace function public.guia_onboarding_lead(id_ bigint)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.eh_plataforma() then raise exception 'só a plataforma vê o onboarding'; end if;
  return (select to_jsonb(c) - 'chave' || jsonb_build_object('salao', (select s.name from public.salons s where s.id = c.salao_id))
            from public.guia_onboarding_leads c where c.id = id_);
end $$;

-- salvar a configuração: só os campos conhecidos; o que vier fora da regra volta com a mensagem do campo
create or replace function public.guia_onboarding_config_salvar(c jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  gat text[];
begin
  if not public.eh_plataforma() then raise exception 'só a plataforma configura o onboarding'; end if;
  if c ? 'gatilhos' then
    -- minúsculas, sem acento, sem pontuação, sem repetidos, na ordem dada (o primeiro é a frase do botão)
    select array_agg(g order by o) into gat from (
      select min(o) as o, g from (
        select o, nullif(btrim(regexp_replace(regexp_replace(lower(translate(x, 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')), '[^a-z0-9 ]+', ' ', 'g'), ' +', ' ', 'g')), '') as g
          from jsonb_array_elements_text(c -> 'gatilhos') with ordinality as e(x, o)) t
       where g is not null and length(g) between 4 and 80 group by g) u;
    if gat is null or cardinality(gat) = 0 then raise exception 'informe pelo menos um gatilho (a frase do botão)'; end if;
  end if;
  begin
    update public.guia_onboarding_config g set
      ligado = coalesce((c ->> 'ligado')::boolean, g.ligado),
      provedor = coalesce(nullif(c ->> 'provedor', ''), g.provedor),
      modelo = case when c ? 'modelo' then nullif(btrim(c ->> 'modelo'), '') else g.modelo end,
      orientacao = coalesce(nullif(btrim(c ->> 'orientacao'), ''), g.orientacao),
      gatilhos = coalesce(gat, g.gatilhos),
      tolerancia = coalesce((c ->> 'tolerancia')::integer, g.tolerancia),
      tolerancia_cnpj = coalesce((c ->> 'tolerancia_cnpj')::integer, g.tolerancia_cnpj),
      link_dias = coalesce((c ->> 'link_dias')::integer, g.link_dias),
      com_servicos = coalesce((c ->> 'com_servicos')::boolean, g.com_servicos),
      com_horarios = coalesce((c ->> 'com_horarios')::boolean, g.com_horarios),
      com_email = coalesce((c ->> 'com_email')::boolean, g.com_email),
      com_explicacoes = coalesce((c ->> 'com_explicacoes')::boolean, g.com_explicacoes),
      passo_tipo = coalesce(nullif(btrim(c ->> 'passo_tipo'), ''), g.passo_tipo),
      passo_documento = coalesce(nullif(btrim(c ->> 'passo_documento'), ''), g.passo_documento),
      passo_endereco = coalesce(nullif(btrim(c ->> 'passo_endereco'), ''), g.passo_endereco),
      passo_nome = coalesce(nullif(btrim(c ->> 'passo_nome'), ''), g.passo_nome),
      passo_profissionais = coalesce(nullif(btrim(c ->> 'passo_profissionais'), ''), g.passo_profissionais),
      passo_servicos = coalesce(nullif(btrim(c ->> 'passo_servicos'), ''), g.passo_servicos),
      passo_horarios = coalesce(nullif(btrim(c ->> 'passo_horarios'), ''), g.passo_horarios),
      passo_email = coalesce(nullif(btrim(c ->> 'passo_email'), ''), g.passo_email),
      passo_explicacoes = coalesce(nullif(btrim(c ->> 'passo_explicacoes'), ''), g.passo_explicacoes),
      msg_confirmar = coalesce(nullif(btrim(c ->> 'msg_confirmar'), ''), g.msg_confirmar),
      msg_boas_vindas = coalesce(nullif(btrim(c ->> 'msg_boas_vindas'), ''), g.msg_boas_vindas),
      msg_nao_sou = coalesce(nullif(btrim(c ->> 'msg_nao_sou'), ''), g.msg_nao_sou),
      msg_cnpj_invalido = coalesce(nullif(btrim(c ->> 'msg_cnpj_invalido'), ''), g.msg_cnpj_invalido),
      msg_cpf_invalido = coalesce(nullif(btrim(c ->> 'msg_cpf_invalido'), ''), g.msg_cpf_invalido),
      msg_email_invalido = coalesce(nullif(btrim(c ->> 'msg_email_invalido'), ''), g.msg_email_invalido),
      msg_endereco_confirmar = coalesce(nullif(btrim(c ->> 'msg_endereco_confirmar'), ''), g.msg_endereco_confirmar),
      msg_link = coalesce(nullif(btrim(c ->> 'msg_link'), ''), g.msg_link),
      msg_encerrar = coalesce(nullif(btrim(c ->> 'msg_encerrar'), ''), g.msg_encerrar),
      atualizado_em = now(), atualizado_por = auth.uid()
     where g.id = 1;
  exception
    when check_violation then
      raise exception '%', case
        when sqlerrm ~ 'provedor' then 'IA: groq ou claude'
        when sqlerrm ~ 'modelo' then 'modelo inválido'
        when sqlerrm ~ 'gatilhos' then 'gatilhos: de 1 a 40 frases'
        when sqlerrm ~ 'tolerancia_cnpj' then 'tolerância do CNPJ: de 1 a 20 tentativas'
        when sqlerrm ~ 'tolerancia' then 'tolerância: de 1 a 20 respostas inválidas'
        when sqlerrm ~ 'link_dias' then 'validade do link: de 1 a 60 dias'
        when sqlerrm ~ 'orientacao' then 'a orientação do agente: de 20 a 8000 letras'
        when sqlerrm ~ 'msg_link' then 'a mensagem do link precisa ter {link} e de 10 a 2000 letras'
        when sqlerrm ~ 'passo_' then 'o texto de um passo: de 5 a 2000 letras'
        when sqlerrm ~ 'msg_' then 'mensagem curta ou longa demais (10 a 2000 letras)'
        else sqlerrm end;
    when invalid_text_representation then raise exception 'valor inválido num campo de número ou sim/não';
  end;
  if (select o.ligado and not (w.ligado and w.numero is not null) from public.guia_onboarding_config o, public.guia_whats_config w where o.id = 1 and w.id = 1) then
    update public.guia_onboarding_config set ligado = false where id = 1;
    raise exception 'para ligar o onboarding, o WhatsApp do guia (a Mel) precisa estar ligado e com número';
  end if;
  return (select to_jsonb(g) from public.guia_onboarding_config g where g.id = 1);
end $$;

-- marcar um lead como atendido pela equipe (humano retomou) — guardado em dados.atendido
create or replace function public.guia_onboarding_lead_atendido(id_ bigint, atendido_ boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.eh_plataforma() then raise exception 'só a plataforma mexe nos leads'; end if;
  update public.guia_onboarding_leads set dados = dados || jsonb_build_object('atendido', coalesce(atendido_, true)), atualizada_em = atualizada_em where id = id_;
end $$;

revoke execute on function public.guia_onboarding_painel(integer), public.guia_onboarding_lead(bigint), public.guia_onboarding_config_salvar(jsonb), public.guia_onboarding_lead_atendido(bigint, boolean) from public, anon;
grant execute on function public.guia_onboarding_painel(integer), public.guia_onboarding_lead(bigint), public.guia_onboarding_config_salvar(jsonb), public.guia_onboarding_lead_atendido(bigint, boolean) to authenticated;

do $$
begin
  raise notice '203: o agente de onboarding pelo WhatsApp (guia_onboarding_config, guia_onboarding_leads; publico, por_token e concluir públicos/auth; painel, lead e config_salvar da Plataforma). Começa desligado.';
end $$;
