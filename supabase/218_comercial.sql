-- 218: a assistente comercial da MIMO (3.74)
--
-- Um SEGUNDO número de WhatsApp (chip próprio, outra instância na mesma Evolution), só para quem quer conhecer a MIMO
-- Agenda: a dona de salão e a profissional autônoma. A Mel (195) fica só com as clientes. A assistente tem nome, persona e
-- configuração próprios (comercial_config, a aba Comercial da Plataforma) e conversa de verdade (IA: Groq ou Claude),
-- sabendo o que a MIMO faz, os planos (lidos do banco: mensalidade_cents, 118), as perguntas frequentes e as objeções.
--
-- O que ela faz na conversa:
--   • pergunta nome, cidade e salão; acha o salão no guia (comercial_buscar_salao) e, com o e-mail dela, dispara o pedido
--     "sou a dona" que já existe (guia_registrar_interesse, 159): a equipe confirma e o link das fotos (165) vai por e-mail;
--   • fala preço só quando vendas_ligadas; desligado, responde o texto de fase de testes e anota o interesse;
--   • quem já é cliente (o número bate com um salão ou perfil da MIMO, como na 204) recebe o texto de suporte;
--   • quando a pessoa quer começar ou pede uma pessoa, avisa a equipe (numero_avisos) e passa o contato combinado;
--   • nunca manda a primeira mensagem para ninguém (sem disparo em massa).
-- A equipe entra na conversa pelo painel (a função comercial manda pela Evolution e grava) ou pelo celular do chip: nos
-- dois casos a assistente cala naquela conversa por silencio_min (humano_ate), e o painel tem "devolver para a assistente
-- agora" e "pausar". Quem para de responder recebe as cutucadas da cadência (cadencia_dias: 1, 3 e 7 dias desde a última
-- mensagem dela, pelo mesmo relógio da VPS que cutuca a Mel) e depois vira "perdido".
-- Cada conversa é um lead com situação (novo → conversando → interessada → quer_comecar → cliente | perdido |
-- sem_interesse), os dados anotados (nome, cidade, salão, autônoma, e-mail) e o salão do guia ligado quando achado.
--
-- O site lê só o público (comercial_publico): ligado, número e nome — os botões de agenda das landings passam a abrir
-- esse número; a Mel manda o link dele para a dona que ela reconhece e para o salão que responde QUERO.

-- ---- a configuração -------------------------------------------------------------------------------------------------------
create table if not exists public.comercial_config (
  id integer primary key default 1 check (id = 1),
  ligado boolean not null default false,
  nome text not null default 'Lia' check (length(nome) between 2 and 40),
  numero text check (numero is null or numero ~ '^[1-9][0-9]{9,14}$'),
  instancia text not null default 'mimo-comercial' check (instancia ~ '^[a-z0-9][a-z0-9_-]{1,39}$'),
  numero_avisos text check (numero_avisos is null or numero_avisos ~ '^[1-9][0-9]{9,14}$'),
  provedor text not null default 'groq' check (provedor in ('groq', 'claude')),
  modelo text check (modelo is null or modelo ~ '^[a-zA-Z0-9._/:-]{2,80}$'),
  vendas_ligadas boolean not null default true,
  -- a persona e as regras ({nome} vira o nome dela)
  orientacao text not null default $o$Você é a {nome}, consultora da MIMO: um sistema de agendamento para salões de beleza e profissionais autônomas, com um guia de salões onde as clientes encontram e marcam. Você fala com donas e donos de salão e com profissionais que querem conhecer a MIMO.

Seu tom: feminino, decidido e firme, mas delicado; direto ao ponto, caloroso, sem bajular. Mensagens curtas, uma pergunta por vez, no máximo um emoji. Português do Brasil.

Como conversar:
- Na primeira resposta diga quem você é e pergunte o nome da pessoa, a cidade e o nome do salão (ou se é autônoma). Se ela já disse algo disso, não pergunte de novo.
- Entenda a rotina dela antes de falar de produto: quantas profissionais, como as clientes marcam hoje, o que mais dá trabalho.
- Responda com o que a MIMO faz de fato (o texto "O que a MIMO faz", a tabela de planos, as perguntas frequentes). Preço só o da tabela; nunca invente desconto, prazo ou recurso. Não prometa resultado ("vai dobrar o faturamento"). Não fale mal de concorrente.
- Nunca peça senha nem dados de cartão.
- Quando ela quiser começar, testar ou pedir para falar com uma pessoa, diga que vai chamar a equipe (o sistema manda o texto com o contato) e marque quer_comecar ou quer_humano.
- Se ela já é cliente da MIMO e precisa de suporte, marque eh_cliente: o sistema responde com o contato do suporte.
- Se for uma cliente querendo marcar horário num salão (não é profissional), marque cliente_final: o sistema explica o guia.
- Se ela mandar foto, áudio ou figurinha, peça em texto com gentileza.$o$ check (length(orientacao) between 20 and 8000),
  -- o que ela sabe (o produto); os planos vêm do banco, não daqui
  conhecimento text not null default $c$A MIMO Agenda organiza os agendamentos do salão num lugar só. O salão ganha um link próprio (nome.mimo.com.vc) e um QR Code para o balcão: a cliente abre, escolhe o serviço e a profissional e marca sozinha, pelo site ou pelo app MIMO (Android). Lembretes automáticos para as clientes, pelo app e também pelo WhatsApp quando o salão conecta o WhatsApp dele; reagendamento e lista de espera (quando alguém cancela, a MIMO aponta quem está esperando); lista de retorno (a cliente que não volta há tempo aparece para o salão chamar). Equipe com permissões: cada profissional vê a própria agenda; serviços e horários por profissional; comanda, caixa, comissões e relatórios. Sinal por Pix para segurar o horário. Promoções e novidades para as clientes que seguem o salão no app.

O guia de salões da MIMO (mimo.com.vc/saloes) é grátis: cada salão das cidades atendidas tem uma página com endereço, serviços, horários e fotos; quem usa a MIMO Agenda ganha o selo "Agenda pela MIMO" e o botão de agendar direto na página e no app. A Mel, atendente das clientes, anota pedidos de horário para os salões do guia que ainda não têm agenda.

Como se paga: 7 dias grátis para testar, sem cartão; o prazo só começa a contar quando a agenda está configurada (serviços e equipe). Depois, mensalidade paga por Pix pelo painel, no modelo pré-pago; sem contrato de fidelidade, cancela quando quiser. O painel funciona no celular e no computador, pelo navegador; as clientes usam o app MIMO ou o site.$c$ check (length(conhecimento) between 20 and 12000),
  faq text not null default $f$Quanto custa? A tabela de planos, pelo número de agendas. Sem taxa de adesão.
Tem teste grátis? 7 dias, sem cartão. O relógio só começa quando a agenda está montada.
Como as minhas clientes marcam? Pelo seu link, pelo QR Code do balcão ou pelo app MIMO. Quem marca pelo WhatsApp continua marcando: você lança na agenda em segundos.
Preciso de computador? Não. O painel abre no navegador do celular.
E as profissionais da minha equipe? Cada uma tem a sua agenda e o seu acesso; você define o que cada uma vê. Comissões e repasses saem na comanda.
Já uso outro sistema ou agenda de papel. Dá para testar lado a lado nos 7 dias. O cadastro de serviços é rápido e a equipe ajuda a montar.
Meus dados e os das minhas clientes? São do salão. A MIMO não vende nem repassa dados.
Sou autônoma. O plano Autônoma é grátis: uma agenda, link próprio, lembretes e o app para as suas clientes.
O guia é pago? Não. A página do salão no guia é grátis, com fotos. Com a agenda, ela ganha o botão de agendar.
Como eu começo? Eu aviso a equipe agora e alguém monta a conta com você.$f$ check (length(faq) <= 12000),
  objecoes text not null default $b$Está caro. Uma cliente a mais por mês já paga o plano. E os 7 dias são de graça para você ver na sua rotina.
Minhas clientes já marcam pelo WhatsApp. Continuam marcando. A diferença é que você para de responder "tem vaga?" dez vezes por dia: elas veem o horário livre e marcam sozinhas.
Não tenho tempo de configurar. A equipe monta com você. Em uns 20 minutos a agenda está pronta.
Não quero prender as minhas clientes num app. O link funciona no navegador, sem instalar nada. O app é para quem quiser.
Vou pensar. Claro. Posso te mandar o link da página do seu salão no guia enquanto isso? E te chamo em alguns dias para saber se ficou alguma dúvida.$b$ check (length(objecoes) <= 8000),
  -- as mensagens que o sistema decide (não a IA)
  msg_apresentacao text not null default 'Oi! Eu sou a {nome}, da MIMO 💗 A gente ajuda salões e profissionais de beleza a organizar a agenda e a receber clientes pelo guia. Me conta: qual é o seu nome, de que cidade você fala e como se chama o seu salão (ou você é autônoma)?' check (length(msg_apresentacao) between 10 and 1000),
  msg_vendas_desligadas text not null default 'Que bom que você chegou até aqui! 💗 A MIMO Agenda está em fase de testes com um grupo de salões, e as vagas novas abrem em turmas. Posso anotar o seu interesse? Me diz o seu nome, a cidade e o nome do salão, e a equipe te chama assim que abrir a próxima turma.' check (length(msg_vendas_desligadas) between 10 and 2000),
  suporte_numero text check (suporte_numero is null or suporte_numero ~ '^[1-9][0-9]{9,14}$'),
  msg_suporte text not null default 'Oi! Esse número é o comercial da MIMO. Para suporte da sua agenda, fala com a gente em {suporte}: lá a equipe te atende direitinho.' check (length(msg_suporte) between 10 and 1000),
  encaminhar_numero text check (encaminhar_numero is null or encaminhar_numero ~ '^[1-9][0-9]{9,14}$'),
  msg_equipe text not null default 'Vou chamar alguém da equipe para continuar com você por aqui. A equipe atende {horario}; se for fora desse horário, respondemos assim que abrir.{encaminhar}' check (length(msg_equipe) between 10 and 1000),
  msg_cliente_final text not null default 'Oi! Esse número é da equipe comercial da MIMO, que fala com os salões. Para marcar um horário, é pelo guia: mimo.com.vc/saloes. Lá você encontra o salão e marca pelo WhatsApp dele ou pela MIMO 💗' check (length(msg_cliente_final) between 10 and 1000),
  msg_achei_no_guia text not null default 'Achei o {salao} no nosso guia: {link} 💗 A página já está no ar, de graça. Quer colocar fotos ou corrigir alguma coisa? Me passa um e-mail seu que eu mando o pedido para a equipe.' check (length(msg_achei_no_guia) between 10 and 1000),
  msg_salao_na_mimo text not null default 'O {salao} já usa a MIMO Agenda! Se você é da equipe dele e precisa de suporte, fala com a gente em {suporte}.' check (length(msg_salao_na_mimo) between 10 and 1000),
  msg_nao_achei text not null default 'Não achei o {salao} no guia de {cidade}. Quer que a equipe inclua? Me manda o bairro e o endereço (e o Instagram, se tiver) que eu anoto e peço para incluírem.' check (length(msg_nao_achei) between 10 and 1000),
  msg_cidade_fora text not null default 'O guia da MIMO ainda não chegou em {cidade}, mas a agenda funciona em qualquer cidade. Anotei o seu interesse para a equipe avisar quando o guia abrir aí.' check (length(msg_cidade_fora) between 10 and 1000),
  msg_fotos_enviado text not null default 'Pronto! Mandei para {email} um e-mail para confirmar que você responde pelo {salao}. Assim que a equipe confirmar (até 3 dias úteis), chega o link para você enviar as fotos 💗' check (length(msg_fotos_enviado) between 10 and 1000),
  -- a equipe: horário, silêncio depois da intervenção
  equipe_dias text not null default 'seg-sex' check (equipe_dias in ('seg-sex', 'seg-sab', 'todos')),
  equipe_inicio time not null default '09:00',
  equipe_fim time not null default '18:00',
  silencio_min integer not null default 30 check (silencio_min between 1 and 1440),
  -- a cadência: dias desde a última mensagem dela para cada cutucada; depois da terceira, "perdido"
  cadencia_dias integer[] not null default array[1, 3, 7] check (cardinality(cadencia_dias) = 3),
  msg_cadencia_1 text not null default 'Oi{nome_lead}! Passando para saber se ficou alguma dúvida sobre a MIMO. Se quiser, eu te explico qualquer parte 💗' check (length(msg_cadencia_1) between 5 and 1000),
  msg_cadencia_2 text not null default 'Lembrei de você: os 7 dias grátis continuam valendo quando quiser testar. Posso avisar a equipe para montar a sua agenda?' check (length(msg_cadencia_2) between 5 and 1000),
  msg_cadencia_3 text not null default 'Vou deixar você à vontade por aqui. Quando fizer sentido, é só me chamar que eu continuo de onde paramos. Obrigada pela conversa!' check (length(msg_cadencia_3) between 5 and 1000),
  -- ritmo e limites
  pausa_seg integer not null default 2 check (pausa_seg between 0 and 30),
  bolhas boolean not null default true,
  limite_respostas integer not null default 40 check (limite_respostas between 1 and 500),
  retencao_dias integer not null default 180 check (retencao_dias between 7 and 730),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid
);
insert into public.comercial_config (id) values (1) on conflict (id) do nothing;
alter table public.comercial_config enable row level security;
comment on table public.comercial_config is 'Comercial (218): a assistente de vendas da MIMO num número próprio — persona, o que sabe, mensagens, equipe, cadência, IA.';

-- ---- as conversas (cada uma é um lead) ------------------------------------------------------------------------------------
create table if not exists public.comercial_conversas (
  id bigint generated always as identity primary key,
  telefone text not null,
  chave text not null,
  nome_perfil text,
  origem text not null default 'direto' check (origem in ('direto', 'botao', 'mel', 'quero', 'teste')),
  situacao text not null default 'novo' check (situacao in ('novo', 'conversando', 'interessada', 'quer_comecar', 'cliente', 'perdido', 'sem_interesse')),
  dados jsonb not null default '{}'::jsonb,          -- nome, cidade, cidade_slug, salao, autonoma, email, interesse, cidade_coberta, guia_informado, fotos_pedidas…
  mensagens jsonb not null default '[]'::jsonb,      -- [{q: lead|ia|equipe|sistema, t, em}]
  lugar_id uuid references public.guia_lugares (id) on delete set null,
  humano_ate timestamptz,                            -- a assistente cala até aqui (alguém da equipe entrou)
  pausada boolean not null default false,            -- a assistente não responde mais nesta conversa
  cadencia_etapa integer not null default 0 check (cadencia_etapa between 0 and 3),
  cadencia_em timestamptz,
  avisada_em timestamptz,                            -- a equipe foi avisada (quer começar / pediu uma pessoa)
  ultima_lead_em timestamptz,
  ultima_nossa_em timestamptz,
  teste boolean not null default false,
  criado_em timestamptz not null default now(),
  atualizada_em timestamptz not null default now()
);
create index if not exists comercial_conversas_chave on public.comercial_conversas (chave, atualizada_em desc);
create index if not exists comercial_conversas_quando on public.comercial_conversas (atualizada_em desc);
create index if not exists comercial_conversas_lugar on public.comercial_conversas (lugar_id) where lugar_id is not null;
alter table public.comercial_conversas enable row level security;
comment on table public.comercial_conversas is 'Comercial (218): cada número que falou com a assistente — a conversa, o que foi anotado, a situação do lead, a intervenção humana e a cadência.';

revoke all on public.comercial_config, public.comercial_conversas from anon, authenticated;

-- ---- o que o site e a Mel leem (público): ligado, número e nome ----------------------------------------------------------
create or replace function public.comercial_publico()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when c.ligado and c.numero is not null
              then jsonb_build_object('ligado', true, 'numero', c.numero, 'nome', c.nome)
              else jsonb_build_object('ligado', false) end
    from public.comercial_config c where c.id = 1
$$;
revoke execute on function public.comercial_publico() from public;
grant execute on function public.comercial_publico() to anon, authenticated;

-- ---- os planos, lidos do banco (118): a assistente fala estes valores -----------------------------------------------------
create or replace function public.comercial_planos()
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_array(
    jsonb_build_object('plano', 'autonoma', 'nome', 'Autônoma', 'base_cents', 0, 'inclusas', 1, 'extra_cents', 0, 'ate', 1),
    jsonb_build_object('plano', 'pro', 'nome', 'MIMO Pro', 'base_cents', public.mensalidade_cents('pro', 1), 'inclusas', 3,
                       'extra_cents', public.mensalidade_cents('pro', 4) - public.mensalidade_cents('pro', 3), 'ate', 10),
    jsonb_build_object('plano', 'promais', 'nome', 'MIMO Pro+', 'base_cents', public.mensalidade_cents('promais', 1), 'inclusas', 11,
                       'extra_cents', public.mensalidade_cents('promais', 12) - public.mensalidade_cents('promais', 11), 'ate', null))
$$;

-- ---- a entrada de cada mensagem (Edge Function): configuração, planos, a conversa e quem é -----------------------------
-- A conversa de um número é uma só e dura: quem volta dias depois continua a mesma (os dados anotados ficam). Só depois de
-- 30 dias parada uma mensagem nova começa outra conversa (a antiga fica para a métrica).
create or replace function public.comercial_contexto(tel_ text, nome_ text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  k text := public.guia_whats_chave(tel_);
  cv public.comercial_conversas;
  s record;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if random() < 0.02 then
    delete from public.comercial_conversas where (teste and atualizada_em < now() - interval '1 day')
       or atualizada_em < now() - make_interval(days => (select retencao_dias from public.comercial_config where id = 1));
  end if;
  select * into cv from public.comercial_conversas c
   where c.chave = k and c.atualizada_em > now() - interval '30 days'
   order by c.atualizada_em desc limit 1;
  -- quem já é da MIMO: o número bate com um salão (telefone ou WhatsApp) ou com o perfil da dona (como na 204)
  select sa.name, sa.city into s from public.salons sa
   where k is not null and (public.guia_whats_chave(sa.phone) = k or public.guia_whats_chave(sa.whatsapp) = k
      or sa.owner_id in (select p.id from public.profiles p where public.guia_whats_chave(p.phone) = k))
   limit 1;
  return jsonb_build_object(
    'config', (select to_jsonb(c) - 'atualizado_por' from public.comercial_config c where c.id = 1),
    'planos', public.comercial_planos(),
    'cliente', case when s.name is null then null else jsonb_build_object('salao', s.name, 'cidade', s.city) end,
    'conversa', case when cv.id is null then null else to_jsonb(cv) - 'chave' end,
    'respostas_hoje', case when cv.id is null then 0 else
      (select count(*) from jsonb_array_elements(cv.mensagens) m
        where m ->> 'q' = 'ia' and ((m ->> 'em')::timestamptz at time zone 'America/Sao_Paulo')::date = hoje) end,
    'agora', now());
end $$;

-- grava a conversa (nova quando id_ é nulo) com as mensagens novas no fim (as 120 últimas ficam). Uma mensagem do lead zera a
-- cadência e marca ultima_lead_em; uma nossa (ia/equipe) marca ultima_nossa_em.
create or replace function public.comercial_conversa_salvar(id_ bigint, tel_ text, nome_ text, situacao_ text, dados_ jsonb, novas_ jsonb,
                                                             origem_ text default null, teste_ boolean default false, lugar_ uuid default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  n bigint;
  novas jsonb := case when jsonb_typeof(novas_) = 'array' then novas_ else '[]'::jsonb end;
  do_lead boolean := exists (select 1 from jsonb_array_elements(novas) m where m ->> 'q' = 'lead');
  nossa boolean := exists (select 1 from jsonb_array_elements(novas) m where m ->> 'q' in ('ia', 'equipe'));
begin
  if id_ is null then
    insert into public.comercial_conversas (telefone, chave, nome_perfil, origem, situacao, dados, mensagens, teste, lugar_id, ultima_lead_em, ultima_nossa_em)
    values (left(tel_, 60), public.guia_whats_chave(tel_), nullif(left(coalesce(nome_, ''), 60), ''), coalesce(origem_, 'direto'), coalesce(situacao_, 'novo'),
            coalesce(dados_, '{}'::jsonb), novas, coalesce(teste_, false), lugar_, case when do_lead then now() end, case when nossa then now() end)
    returning id into n;
    return n;
  end if;
  update public.comercial_conversas c set
    nome_perfil = coalesce(nullif(left(coalesce(nome_, ''), 60), ''), c.nome_perfil),
    situacao = coalesce(situacao_, c.situacao),
    dados = coalesce(dados_, c.dados),
    lugar_id = coalesce(lugar_, c.lugar_id),
    mensagens = (select coalesce(jsonb_agg(m order by o), '[]'::jsonb) from (
                   select m, o from jsonb_array_elements(c.mensagens || novas) with ordinality as e(m, o)
                   order by o desc limit 120) t),
    ultima_lead_em = case when do_lead then now() else c.ultima_lead_em end,
    ultima_nossa_em = case when nossa then now() else c.ultima_nossa_em end,
    cadencia_etapa = case when do_lead then 0 else c.cadencia_etapa end,
    cadencia_em = case when do_lead then null else c.cadencia_em end,
    atualizada_em = now()
   where c.id = id_
  returning c.id into n;
  return n;
end $$;

-- a equipe foi avisada desta conversa (quer começar / pediu uma pessoa): uma vez por dia
create or replace function public.comercial_avisada(id_ bigint)
returns boolean language plpgsql security definer set search_path = public as $$
declare ja boolean;
begin
  select avisada_em > now() - interval '1 day' into ja from public.comercial_conversas where id = id_;
  if coalesce(ja, false) then return false; end if;
  update public.comercial_conversas set avisada_em = now() where id = id_;
  return true;
end $$;

-- ---- o salão dela no guia: a cidade é coberta? o salão está lá? (até 3 parecidos) --------------------------------------
create or replace function public.comercial_buscar_salao(cidade_ text, nome_ text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  cs text := public.slug_de(left(coalesce(cidade_, ''), 80));
  nome_cidade text;
  pw text[] := public.guia_whats_palavras(coalesce(nome_, ''));
  lugares jsonb;
begin
  if cs is null or cs = '' then return jsonb_build_object('cidade_coberta', false, 'lugares', '[]'::jsonb); end if;
  select min(l.cidade) into nome_cidade from public.guia_lugares l where l.status = 'publicado' and l.cidade_slug = cs;
  if nome_cidade is null then return jsonb_build_object('cidade_coberta', false, 'cidade_slug', cs, 'lugares', '[]'::jsonb); end if;
  with c as (
    select l.id, l.nome, l.slug, l.bairro, l.cidade_slug, l.salon_id, l.fotos,
           (select count(*) from unnest(public.guia_whats_palavras(l.slug)) w where w = any (pw))::int as comuns,
           cardinality(public.guia_whats_palavras(l.slug)) as total
      from public.guia_lugares l
     where l.status = 'publicado' and l.cidade_slug = cs and cardinality(pw) > 0 and string_to_array(l.slug, '-') && pw
  ),
  p as (
    select *, case when comuns >= 2 or comuns * 2 >= total then comuns + comuns::numeric / greatest(total, 1) else 0 end as pontos from c
  ),
  m as (select * from p where pontos > 0 order by pontos desc, length(nome) limit 3)
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id, 'nome', m.nome, 'slug', m.slug, 'bairro', m.bairro, 'cidade_slug', m.cidade_slug,
           'link', public.app_base() || '/saloes/' || m.cidade_slug || '/' || m.slug,
           'na_mimo', m.salon_id is not null, 'fotos_n', coalesce(array_length(m.fotos, 1), 0)) order by m.pontos desc, length(m.nome)), '[]'::jsonb)
    into lugares from m;
  return jsonb_build_object('cidade_coberta', true, 'cidade_slug', cs, 'cidade', nome_cidade, 'lugares', lugares);
end $$;

-- o pedido "sou a dona" com o e-mail (159): a equipe confirma e o link das fotos (165) vai por e-mail
create or replace function public.comercial_fotos(lugar_ uuid, nome_ text, tel_ text, email_ text)
returns jsonb language sql security definer set search_path = public as $$
  select public.guia_registrar_interesse(lugar_, 'sou_dono', coalesce(nullif(btrim(nome_), ''), 'Dona do salão'), tel_,
                                         'Pedido pela assistente comercial no WhatsApp', email_, 'dona', true, null)
$$;

-- a equipe mandou uma mensagem por esta conversa (a função comercial envia e chama aqui): grava e cala a assistente
create or replace function public.comercial_equipe_mensagem(id_ bigint, texto_ text, minutos_ integer default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  min integer := coalesce(minutos_, (select silencio_min from public.comercial_config where id = 1), 30);
  r record;
begin
  update public.comercial_conversas c set
    mensagens = c.mensagens || jsonb_build_array(jsonb_build_object('q', 'equipe', 't', left(texto_, 4000), 'em', now())),
    humano_ate = now() + make_interval(mins => min),
    ultima_nossa_em = now(),
    situacao = case when c.situacao = 'novo' then 'conversando' else c.situacao end,
    atualizada_em = now()
   where c.id = id_
  returning c.id, c.telefone, c.humano_ate into r;
  if r.id is null then return jsonb_build_object('ok', false, 'motivo', 'conversa não encontrada'); end if;
  return jsonb_build_object('ok', true, 'telefone', r.telefone, 'humano_ate', r.humano_ate);
end $$;

-- uma mensagem saiu do nosso número (fromMe): se é o eco de algo que a assistente ou o painel mandou, nada; senão alguém
-- da equipe escreveu pelo celular do chip → grava e cala a assistente. Sem conversa (a equipe puxou assunto pelo celular),
-- nasce uma, já com a assistente calada: quando a pessoa responder, a conversa fica com a equipe.
create or replace function public.comercial_fromme(tel_ text, texto_ text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  k text := public.guia_whats_chave(tel_);
  cv public.comercial_conversas;
  min integer := coalesce((select silencio_min from public.comercial_config where id = 1), 30);
  t text := left(btrim(coalesce(texto_, '')), 4000);
begin
  if k is null or t = '' then return jsonb_build_object('eco', true); end if;
  select * into cv from public.comercial_conversas c where c.chave = k order by c.atualizada_em desc limit 1;
  if cv.id is not null and exists (
       select 1 from (select m from jsonb_array_elements(cv.mensagens) with ordinality e(m, o) order by o desc limit 12) x
        where x.m ->> 'q' in ('ia', 'equipe', 'sistema') and btrim(x.m ->> 't') = t and (x.m ->> 'em')::timestamptz > now() - interval '5 minutes') then
    return jsonb_build_object('eco', true, 'id', cv.id);
  end if;
  if cv.id is null then
    insert into public.comercial_conversas (telefone, chave, origem, situacao, mensagens, humano_ate, ultima_nossa_em)
    values (left(tel_, 60), k, 'direto', 'conversando', jsonb_build_array(jsonb_build_object('q', 'equipe', 't', t, 'em', now())), now() + make_interval(mins => min), now())
    returning * into cv;
    return jsonb_build_object('eco', false, 'intervencao', true, 'id', cv.id, 'nova', true);
  end if;
  update public.comercial_conversas c set
    mensagens = (select coalesce(jsonb_agg(m order by o), '[]'::jsonb) from (
                   select m, o from jsonb_array_elements(c.mensagens || jsonb_build_array(jsonb_build_object('q', 'equipe', 't', t, 'em', now()))) with ordinality as e(m, o)
                   order by o desc limit 120) y),
    humano_ate = now() + make_interval(mins => min),
    ultima_nossa_em = now(),
    situacao = case when c.situacao = 'novo' then 'conversando' else c.situacao end,
    atualizada_em = now()
   where c.id = cv.id;
  return jsonb_build_object('eco', false, 'intervencao', true, 'id', cv.id);
end $$;

-- ---- a cadência (o relógio da VPS, pelo whatsapp-webhook ?tarefa=ociosas) ------------------------------------------------
-- Quem parou de responder depois da nossa última mensagem: a cutucada N sai quando passaram cadencia_dias[N] dias da última
-- mensagem dela e a etapa é N-1. Fora: teste, pausada, com a equipe (humano_ate no futuro), e as situações fechadas.
create or replace function public.comercial_cadencia()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cfg public.comercial_config;
begin
  select * into cfg from public.comercial_config where id = 1;
  if cfg.id is null or not cfg.ligado then return jsonb_build_object('ativo', false); end if;
  return jsonb_build_object(
    'ativo', true, 'instancia', cfg.instancia, 'nome', cfg.nome,
    'textos', jsonb_build_array(cfg.msg_cadencia_1, cfg.msg_cadencia_2, cfg.msg_cadencia_3),
    'enviar', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'telefone', c.telefone, 'etapa', c.cadencia_etapa + 1, 'nome', c.dados ->> 'nome') order by c.ultima_lead_em), '[]'::jsonb)
                 from (select * from public.comercial_conversas c
                        where not c.teste and not c.pausada and (c.humano_ate is null or c.humano_ate < now())
                          and c.situacao in ('novo', 'conversando', 'interessada')
                          and c.ultima_lead_em is not null and c.ultima_nossa_em >= c.ultima_lead_em
                          and c.cadencia_etapa < 3
                          and c.ultima_lead_em < now() - make_interval(days => cfg.cadencia_dias[c.cadencia_etapa + 1])
                        order by c.ultima_lead_em limit 50) c));
end $$;
create or replace function public.comercial_cadencia_feita(id_ bigint, etapa_ integer, texto_ text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.comercial_conversas c set
    mensagens = c.mensagens || jsonb_build_array(jsonb_build_object('q', 'ia', 't', left(texto_, 4000), 'em', now(), 'cadencia', etapa_)),
    cadencia_etapa = least(3, greatest(c.cadencia_etapa, etapa_)),
    cadencia_em = now(),
    ultima_nossa_em = now(),
    situacao = case when etapa_ >= 3 and c.situacao in ('novo', 'conversando', 'interessada') then 'perdido' else c.situacao end,
    atualizada_em = now()
   where c.id = id_;
end $$;

-- "apagar meus dados" e o reinício do simulador
create or replace function public.comercial_apagar(tel_ text)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  delete from public.comercial_conversas where chave = public.guia_whats_chave(tel_); get diagnostics n = row_count;
  return n;
end $$;

do $$
declare f text;
begin
  foreach f in array array['comercial_planos()', 'comercial_contexto(text, text)', 'comercial_conversa_salvar(bigint, text, text, text, jsonb, jsonb, text, boolean, uuid)',
                           'comercial_avisada(bigint)', 'comercial_buscar_salao(text, text)', 'comercial_fotos(uuid, text, text, text)',
                           'comercial_equipe_mensagem(bigint, text, integer)', 'comercial_fromme(text, text)', 'comercial_cadencia()',
                           'comercial_cadencia_feita(bigint, integer, text)', 'comercial_apagar(text)'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

-- ---- a Plataforma -------------------------------------------------------------------------------------------------------
create or replace function public.comercial_painel(dias_ integer default 30)
returns jsonb language plpgsql stable security definer set search_path = public set plan_cache_mode = force_custom_plan as $$
declare
  desde timestamptz := now() - make_interval(days => greatest(1, least(coalesce(dias_, 30), 365)));
begin
  if not public.eh_plataforma() then raise exception 'só a plataforma vê o comercial'; end if;
  return jsonb_build_object(
    'config', (select to_jsonb(c) from public.comercial_config c where c.id = 1),
    'planos', public.comercial_planos(),
    'totais', (select jsonb_build_object(
        'conversas', count(*), 'novas', count(*) filter (where situacao = 'novo'), 'conversando', count(*) filter (where situacao = 'conversando'),
        'interessadas', count(*) filter (where situacao = 'interessada'), 'quer_comecar', count(*) filter (where situacao = 'quer_comecar'),
        'clientes', count(*) filter (where situacao = 'cliente'), 'perdidas', count(*) filter (where situacao = 'perdido'),
        'sem_interesse', count(*) filter (where situacao = 'sem_interesse'), 'no_guia', count(*) filter (where lugar_id is not null),
        'com_equipe', count(*) filter (where humano_ate > now()), 'pausadas', count(*) filter (where pausada),
        'por_origem', (select coalesce(jsonb_object_agg(origem, n), '{}'::jsonb) from (select origem, count(*) n from public.comercial_conversas where not teste and criado_em >= desde group by origem) o))
      from public.comercial_conversas where not teste and criado_em >= desde),
    'conversas', (select coalesce(jsonb_agg(to_jsonb(x) order by x.atualizada_em desc), '[]'::jsonb) from (
        select c.id, c.telefone, c.nome_perfil, c.origem, c.situacao, c.lugar_id, l.nome as lugar_nome, l.cidade as lugar_cidade,
               c.dados ->> 'nome' as nome, c.dados ->> 'cidade' as cidade, c.dados ->> 'salao' as salao, c.dados ->> 'autonoma' as autonoma, c.dados ->> 'email' as email,
               c.dados ->> 'interesse' as interesse, c.humano_ate, c.pausada, c.cadencia_etapa, c.avisada_em, c.ultima_lead_em, c.ultima_nossa_em,
               jsonb_array_length(c.mensagens) as n, c.mensagens -> -1 ->> 't' as ultima, c.mensagens -> -1 ->> 'q' as ultima_de, c.criado_em, c.atualizada_em
          from public.comercial_conversas c left join public.guia_lugares l on l.id = c.lugar_id
         where not c.teste and (c.atualizada_em >= desde or c.situacao in ('novo', 'conversando', 'interessada', 'quer_comecar'))
         order by c.atualizada_em desc limit 400) x));
end $$;

create or replace function public.comercial_conversa(id_ bigint)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.eh_plataforma() then raise exception 'só a plataforma vê o comercial'; end if;
  return (select to_jsonb(c) - 'chave' || jsonb_build_object('lugar', case when l.id is null then null else jsonb_build_object('id', l.id, 'nome', l.nome, 'cidade', l.cidade, 'cidade_slug', l.cidade_slug, 'slug', l.slug, 'na_mimo', l.salon_id is not null) end)
            from public.comercial_conversas c left join public.guia_lugares l on l.id = c.lugar_id where c.id = id_);
end $$;

create or replace function public.comercial_situacao(id_ bigint, situacao_ text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.eh_plataforma() then raise exception 'só a plataforma mexe no comercial'; end if;
  update public.comercial_conversas set situacao = situacao_, atualizada_em = now() where id = id_;
end $$;
create or replace function public.comercial_pausar(id_ bigint, pausar_ boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.eh_plataforma() then raise exception 'só a plataforma mexe no comercial'; end if;
  update public.comercial_conversas set pausada = coalesce(pausar_, false), atualizada_em = now() where id = id_;
end $$;
-- a equipe assume (minutos_ nulo: o silêncio da configuração) ou devolve para a assistente agora (reativar)
create or replace function public.comercial_intervir(id_ bigint, minutos_ integer default null)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare ate timestamptz;
begin
  if not public.eh_plataforma() then raise exception 'só a plataforma mexe no comercial'; end if;
  update public.comercial_conversas set humano_ate = now() + make_interval(mins => coalesce(minutos_, (select silencio_min from public.comercial_config where id = 1), 30)), atualizada_em = now()
   where id = id_ returning humano_ate into ate;
  return ate;
end $$;
create or replace function public.comercial_reativar(id_ bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.eh_plataforma() then raise exception 'só a plataforma mexe no comercial'; end if;
  update public.comercial_conversas set humano_ate = null, pausada = false, atualizada_em = now() where id = id_;
end $$;

-- salvar a configuração: só os campos conhecidos; o que vier fora da regra volta com a mensagem do campo
create or replace function public.comercial_config_salvar(c jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  num text; avisos text; sup text; enc text; cad integer[];
begin
  if not public.eh_plataforma() then raise exception 'só a plataforma configura o comercial'; end if;
  if c ? 'numero' then num := nullif(regexp_replace(coalesce(c ->> 'numero', ''), '\D', '', 'g'), ''); if num is not null and length(num) in (10, 11) then num := '55' || num; end if; end if;
  if c ? 'numero_avisos' then avisos := nullif(regexp_replace(coalesce(c ->> 'numero_avisos', ''), '\D', '', 'g'), ''); if avisos is not null and length(avisos) in (10, 11) then avisos := '55' || avisos; end if; end if;
  if c ? 'suporte_numero' then sup := nullif(regexp_replace(coalesce(c ->> 'suporte_numero', ''), '\D', '', 'g'), ''); if sup is not null and length(sup) in (10, 11) then sup := '55' || sup; end if; end if;
  if c ? 'encaminhar_numero' then enc := nullif(regexp_replace(coalesce(c ->> 'encaminhar_numero', ''), '\D', '', 'g'), ''); if enc is not null and length(enc) in (10, 11) then enc := '55' || enc; end if; end if;
  if c ? 'cadencia_dias' then
    select array_agg(greatest(1, least(60, x::integer)) order by o) into cad from jsonb_array_elements_text(c -> 'cadencia_dias') with ordinality e(x, o);
    if cad is null or cardinality(cad) <> 3 or not (cad[1] < cad[2] and cad[2] < cad[3]) then raise exception 'cadência: três prazos crescentes, em dias (ex.: 1, 3 e 7)'; end if;
  end if;
  begin
    update public.comercial_config g set
      ligado = coalesce((c ->> 'ligado')::boolean, g.ligado),
      nome = coalesce(nullif(btrim(c ->> 'nome'), ''), g.nome),
      numero = case when c ? 'numero' then num else g.numero end,
      instancia = coalesce(nullif(btrim(c ->> 'instancia'), ''), g.instancia),
      numero_avisos = case when c ? 'numero_avisos' then avisos else g.numero_avisos end,
      provedor = coalesce(nullif(c ->> 'provedor', ''), g.provedor),
      modelo = case when c ? 'modelo' then nullif(btrim(c ->> 'modelo'), '') else g.modelo end,
      vendas_ligadas = coalesce((c ->> 'vendas_ligadas')::boolean, g.vendas_ligadas),
      orientacao = coalesce(nullif(btrim(c ->> 'orientacao'), ''), g.orientacao),
      conhecimento = coalesce(nullif(btrim(c ->> 'conhecimento'), ''), g.conhecimento),
      faq = case when c ? 'faq' then btrim(coalesce(c ->> 'faq', '')) else g.faq end,
      objecoes = case when c ? 'objecoes' then btrim(coalesce(c ->> 'objecoes', '')) else g.objecoes end,
      msg_apresentacao = coalesce(nullif(btrim(c ->> 'msg_apresentacao'), ''), g.msg_apresentacao),
      msg_vendas_desligadas = coalesce(nullif(btrim(c ->> 'msg_vendas_desligadas'), ''), g.msg_vendas_desligadas),
      suporte_numero = case when c ? 'suporte_numero' then sup else g.suporte_numero end,
      msg_suporte = coalesce(nullif(btrim(c ->> 'msg_suporte'), ''), g.msg_suporte),
      encaminhar_numero = case when c ? 'encaminhar_numero' then enc else g.encaminhar_numero end,
      msg_equipe = coalesce(nullif(btrim(c ->> 'msg_equipe'), ''), g.msg_equipe),
      msg_cliente_final = coalesce(nullif(btrim(c ->> 'msg_cliente_final'), ''), g.msg_cliente_final),
      msg_achei_no_guia = coalesce(nullif(btrim(c ->> 'msg_achei_no_guia'), ''), g.msg_achei_no_guia),
      msg_salao_na_mimo = coalesce(nullif(btrim(c ->> 'msg_salao_na_mimo'), ''), g.msg_salao_na_mimo),
      msg_nao_achei = coalesce(nullif(btrim(c ->> 'msg_nao_achei'), ''), g.msg_nao_achei),
      msg_cidade_fora = coalesce(nullif(btrim(c ->> 'msg_cidade_fora'), ''), g.msg_cidade_fora),
      msg_fotos_enviado = coalesce(nullif(btrim(c ->> 'msg_fotos_enviado'), ''), g.msg_fotos_enviado),
      equipe_dias = coalesce(nullif(c ->> 'equipe_dias', ''), g.equipe_dias),
      equipe_inicio = coalesce((nullif(c ->> 'equipe_inicio', ''))::time, g.equipe_inicio),
      equipe_fim = coalesce((nullif(c ->> 'equipe_fim', ''))::time, g.equipe_fim),
      silencio_min = coalesce((c ->> 'silencio_min')::integer, g.silencio_min),
      cadencia_dias = coalesce(cad, g.cadencia_dias),
      msg_cadencia_1 = coalesce(nullif(btrim(c ->> 'msg_cadencia_1'), ''), g.msg_cadencia_1),
      msg_cadencia_2 = coalesce(nullif(btrim(c ->> 'msg_cadencia_2'), ''), g.msg_cadencia_2),
      msg_cadencia_3 = coalesce(nullif(btrim(c ->> 'msg_cadencia_3'), ''), g.msg_cadencia_3),
      pausa_seg = coalesce((c ->> 'pausa_seg')::integer, g.pausa_seg),
      bolhas = coalesce((c ->> 'bolhas')::boolean, g.bolhas),
      limite_respostas = coalesce((c ->> 'limite_respostas')::integer, g.limite_respostas),
      retencao_dias = coalesce((c ->> 'retencao_dias')::integer, g.retencao_dias),
      atualizado_em = now(), atualizado_por = auth.uid()
     where g.id = 1;
  exception
    when check_violation then
      raise exception '%', case
        when sqlerrm ~ 'numero_avisos' then 'o número de avisos não parece válido (DDD e número)'
        when sqlerrm ~ 'suporte_numero' then 'o número do suporte não parece válido'
        when sqlerrm ~ 'encaminhar_numero' then 'o número para encaminhar não parece válido'
        when sqlerrm ~ 'numero' then 'o número do WhatsApp comercial não parece válido (DDD e número)'
        when sqlerrm ~ 'instancia' then 'a instância: letras minúsculas, números, - e _ (2 a 40)'
        when sqlerrm ~ 'provedor' then 'IA: groq ou claude'
        when sqlerrm ~ 'modelo' then 'modelo inválido'
        when sqlerrm ~ 'nome' then 'o nome da assistente: de 2 a 40 letras'
        when sqlerrm ~ 'orientacao' then 'a orientação: de 20 a 8000 letras'
        when sqlerrm ~ 'conhecimento' then 'o texto do que a MIMO faz: de 20 a 12000 letras'
        when sqlerrm ~ 'faq' then 'as perguntas frequentes: até 12000 letras'
        when sqlerrm ~ 'objecoes' then 'as objeções: até 8000 letras'
        when sqlerrm ~ 'equipe_dias' then 'dias da equipe: seg-sex, seg-sab ou todos'
        when sqlerrm ~ 'silencio_min' then 'silêncio depois da intervenção: de 1 a 1440 minutos'
        when sqlerrm ~ 'pausa_seg' then 'pausa entre as mensagens: de 0 a 30 segundos'
        when sqlerrm ~ 'limite_respostas' then 'limite de respostas por número por dia: de 1 a 500'
        when sqlerrm ~ 'retencao_dias' then 'retenção: de 7 a 730 dias'
        when sqlerrm ~ 'msg_cadencia' then 'uma mensagem da cadência: de 5 a 1000 letras'
        when sqlerrm ~ 'msg_' then 'mensagem curta ou longa demais (10 a 2000 letras)'
        else sqlerrm end;
    when invalid_text_representation then raise exception 'valor inválido num campo de número, hora ou sim/não';
    when invalid_datetime_format then raise exception 'horário inválido (use HH:MM)';
  end;
  if (select g.ligado and g.numero is null from public.comercial_config g where g.id = 1) then
    update public.comercial_config set ligado = false where id = 1;
    raise exception 'para ligar a assistente, informe o número do WhatsApp comercial';
  end if;
  return (select to_jsonb(g) from public.comercial_config g where g.id = 1);
end $$;

do $$
declare f text;
begin
  foreach f in array array['comercial_painel(integer)', 'comercial_conversa(bigint)', 'comercial_situacao(bigint, text)', 'comercial_pausar(bigint, boolean)',
                           'comercial_intervir(bigint, integer)', 'comercial_reativar(bigint)', 'comercial_config_salvar(jsonb)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

do $$ begin raise notice '218: a assistente comercial (comercial_config, comercial_conversas, comercial_* e o público comercial_publico)'; end $$;
