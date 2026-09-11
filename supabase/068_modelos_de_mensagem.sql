-- 068 · Modelos de mensagem: o texto sai do SQL e vai para uma tabela
--
-- Tudo que o MIMO escreve no WhatsApp (avisos para a cliente, avisos
-- para a profissional, respostas do bot) passa a viver em
-- modelos_de_mensagem, com variáveis entre chaves ({nome}, {quando}…),
-- editável na Plataforma › Mensagens. O texto de hoje vira o "padrão";
-- enquanto ninguém editar, sai exatamente o que saía.
--
--   modelos_de_mensagem            chave, grupo, padrão, texto editado
--   renderizar_modelo(texto, vars) troca as variáveis; linha com variável
--                                  vazia some (ex.: sem link, some a linha do link)
--   montar_texto_whatsapp          monta as variáveis e usa o modelo editado;
--                                  sem edição, cai no montar_texto_padrao (o antigo)
--   texto_resposta                 idem para as respostas do bot
--   receber_mensagem               respostas de aceite e os dois silêncios do
--                                  bot (sem cadastro, não entendi) também viram modelo
--   bot_palavras                   palavras que o bot entende, por intenção
--   plataforma_*                   o que a tela de Mensagens usa
--
-- Para criar um AVISO NOVO: insira uma linha aqui (grupo, chave, padrão)
-- e uma em whatsapp_regras; depois é só chamar notificar(..., 'sua_chave', …)
-- de onde ele nasce. O montador usa o modelo pela chave, sem código novo.

create table if not exists public.modelos_de_mensagem (
  chave text primary key,
  grupo text not null check (grupo in ('cliente', 'profissional', 'resposta', 'bot')),
  titulo text not null,
  descricao text,
  variaveis text[] not null default '{}',
  padrao text not null default '',
  texto text,                       -- null = usa o padrão (o código de sempre)
  ordem integer not null default 100,
  atualizado_em timestamptz,
  atualizado_por uuid
);
alter table public.modelos_de_mensagem enable row level security;
revoke all on public.modelos_de_mensagem from anon, authenticated;

create table if not exists public.bot_palavras (
  intencao text not null check (intencao in ('confirma', 'cancela', 'sair')),
  palavra text not null,
  primary key (intencao, palavra)
);
alter table public.bot_palavras enable row level security;
revoke all on public.bot_palavras from anon, authenticated;

-- 1. Os padrões (o que sai hoje, com variáveis) --------------------------------------
insert into public.modelos_de_mensagem (chave, grupo, titulo, descricao, variaveis, padrao, ordem) values
-- para a CLIENTE
('lembrete_agendamento', 'cliente', 'Lembrete de véspera', 'Sai um dia antes do horário. O "Responda 1" abre a conversa.',
 '{nome,servico,profissional,quando,link}',
 E'📅 *Amanhã tem horário marcado*\n\nOi, {nome}! Só passando pra lembrar:\n\n✨ {servico}\n👩 com *{profissional}*\n🗓️ {quando}\n\nResponda *1* pra confirmar, ou *2* se precisar remarcar.\n\n🔗 Sua agenda: {link}', 10),
('agendamento_confirmado', 'cliente', 'Horário confirmado', 'Quando o horário é aceito ou confirmado.',
 '{nome,servico,profissional,quando,link}',
 E'✅ *Horário confirmado*\n\nOi, {nome}! Está tudo certo:\n\n✨ {servico}\n👩 com *{profissional}*\n🗓️ {quando}\n\n🔗 Sua agenda: {link}', 20),
('pedido_aceito', 'cliente', 'Pedido aceito', 'A profissional aceitou o pedido de horário.',
 '{nome,servico,profissional,quando_longo}',
 E'✅ *Confirmado!*\n\nOi, {nome}! A *{profissional}* aceitou:\n\n✨ {servico}\n🗓️ {quando_longo}\n\nTe espero! 💛', 30),
('pedido_recusado', 'cliente', 'Pedido recusado', 'A profissional não pôde atender no horário pedido.',
 '{nome,profissional,quando_longo}',
 E'😔 *Não deu dessa vez*\n\nOi, {nome}. A *{profissional}* não vai poder atender {quando_longo}.\n\nMe chame que a gente acha outro 💛', 40),
('remarcacao_aceita', 'cliente', 'Remarcação aceita', 'A troca de horário foi aceita.',
 '{nome,servico,profissional,quando_antes,quando_longo}',
 E'🔁 *Remarcado!*\n\nOi, {nome}! A *{profissional}* aceitou a troca:\n\n✨ {servico}\n🕒 era: {quando_antes}\n🗓️ agora: {quando_longo}\n\nTe espero! 💛', 50),
('remarcacao_recusada', 'cliente', 'Remarcação recusada', 'A troca não foi aceita; o horário antigo continua.',
 '{nome,profissional,quando_antes,quando_longo}',
 E'😔 *Não deu para remarcar*\n\nOi, {nome}. A *{profissional}* não consegue {quando_longo}.\n\nSeu horário de *{quando_antes}* continua guardado. Se quiser tentar outro, é só me chamar 💛', 60),
('agendamento_cancelado', 'cliente', 'Horário cancelado', 'Cancelamento do horário.',
 '{nome,quando,link}',
 E'❌ *Horário cancelado*\n\nOi, {nome}. O horário de {quando} foi cancelado.\n\nQuando quiser remarcar, é só chamar.\n\n🔗 {link}', 70),
('vaga_disponivel', 'cliente', 'Abriu uma vaga', 'Para quem está na fila de espera.',
 '{nome,quando,profissional,link}',
 E'🎉 *Abriu uma vaga*\n\nOi, {nome}! Apareceu um horário em {quando} com *{profissional}*.\n\nEla fica guardada por pouco tempo.\n\n🔗 {link}', 80),
('agenda_adiantada', 'cliente', 'Dá para adiantar', 'Abriu horário mais cedo no mesmo dia.',
 '{nome,quando,link}',
 E'⏰ *Dá pra adiantar seu horário*\n\nOi, {nome}! Abriu um horário mais cedo, {quando}.\n\n🔗 {link}', 90),
('pos_atendimento', 'cliente', 'Obrigada pela visita', 'Depois do atendimento.',
 '{nome,link}',
 E'💅 *Obrigada pela visita!*\n\nOi, {nome}! Espero que tenha gostado.\n\n🔗 {link}', 100),
('convite_retorno', 'cliente', 'Convite de retorno', 'Cliente sumida há um tempo. É marketing: vai com "responda SAIR".',
 '{nome,profissional,link}',
 E'💛 *Faz tempo que você não aparece*\n\nOi, {nome}! A *{profissional}* guardou um lugar pra você.\n\nQuer já deixar marcado?\n\n🔗 {link}', 110),
-- para a PROFISSIONAL
('pedido_de_aceite', 'profissional', 'Pedido de horário', 'Cliente pediu um horário; a profissional responde 1 ou 2.',
 '{nome_agenda,servico,quando_longo,telefone_cliente,prazo}',
 E'🔔 *Pedido de horário*\n\n👤 {nome_agenda}\n✨ {servico}\n🕒 {quando_longo}\n📱 {telefone_cliente}\n\nResponda *1* para aceitar ou *2* para recusar.\n_Sem resposta em {prazo} min, eu resolvo sozinho._', 200),
('pedido_de_aceite_remarcacao', 'profissional', 'Pedido de remarcação', 'Cliente quer trocar de horário.',
 '{nome_agenda,servico,quando_antes,quando_longo,telefone_cliente,prazo}',
 E'🔁 *Pedido de remarcação*\n\n👤 {nome_agenda}\n✨ {servico}\n🕒 era: {quando_antes}\n➡️ quer: {quando_longo}\n📱 {telefone_cliente}\n\nResponda *1* para aceitar a troca ou *2* para manter como está.\n_Sem resposta em {prazo} min, eu resolvo sozinho._', 210),
('novo_agendamento', 'profissional', 'Horário novo', 'Entrou um horário na agenda (sem aceite).',
 '{nome_agenda,servico,quando_longo,telefone_cliente,link_app}',
 E'🗓️ *Horário novo na sua agenda*\n\n👤 {nome_agenda}\n✨ {servico}\n🕒 {quando_longo}\n📱 {telefone_cliente}\n\n🔗 Sua agenda: {link_app}', 220),
('novo_agendamento_remarcacao', 'profissional', 'Cliente remarcou', 'Troca feita sem precisar de aceite.',
 '{nome_agenda,servico,quando_antes,quando_longo,telefone_cliente,link_app}',
 E'🔁 *Cliente remarcou*\n\n👤 {nome_agenda}\n✨ {servico}\n🕒 era: {quando_antes}\n✅ agora: {quando_longo}\n📱 {telefone_cliente}\n\n🔗 Sua agenda: {link_app}', 230),
('cancelou_comigo', 'profissional', 'Cancelaram um horário', 'Cliente cancelou.',
 '{nome_agenda,servico,quando_longo,link_app}',
 E'⚠️ *Cancelaram um horário*\n\n👤 {nome_agenda}\n✨ {servico}\n🕒 {quando_longo}\n\nEsse horário voltou a ficar livre.\n\n🔗 Sua agenda: {link_app}', 240),
('cancelou_comigo_desistiu', 'profissional', 'Desistiu do pedido', 'Cliente desfez o pedido antes da resposta.',
 '{nome_agenda,servico,quando_longo}',
 E'🙅 *Desistiu do pedido*\n\n👤 {nome_agenda}\n✨ {servico}\n🕒 {quando_longo}\n\nNão precisa responder. Nada mudou na sua agenda.', 250),
('cancelou_comigo_desistiu_remarcacao', 'profissional', 'Desistiu da remarcação', 'Cliente desfez o pedido de troca.',
 '{nome_agenda,servico,quando_longo,quando_antes}',
 E'🙅 *Desistiu da remarcação*\n\n👤 {nome_agenda}\n✨ {servico}\n🕒 pedia: {quando_longo}\n\nNão precisa responder. O horário de {quando_antes} continua valendo.', 260),
-- RESPOSTAS do bot
('resposta.confirmado', 'resposta', 'Cliente confirmou', 'Depois do "1" no lembrete.', '{quando,profissional}',
 E'✅ *Confirmado!* Te espero dia {quando}. 💛', 300),
('resposta.cancelado', 'resposta', 'Cliente cancelou', 'Depois do "2" quando vira cancelamento.', '{quando}',
 E'❌ Tudo bem, cancelei o seu horário de {quando}.\n\nQuando quiser remarcar, é só abrir o app. 🙂', 310),
('resposta.remarcado', 'resposta', 'Cliente quer remarcar', 'Depois do "2" quando vira remarcação.', '{quando}',
 E'🔄 Certo, liberei o seu horário de {quando}.\n\nEscolha o novo dia por aqui, que eu já deixo marcado. 💛', 320),
('resposta.quer_agendar', 'resposta', 'Quer marcar (com link)', 'A IA entendeu que ela quer marcar.', '{}',
 E'💛 Claro! Escolha o dia e a hora que ficam melhor pra você:', 330),
('resposta.quer_agendar_sem_link', 'resposta', 'Quer marcar (sem link)', 'Sem vitrine: avisa a profissional.', '{profissional}',
 E'💛 Claro! Já avisei a {profissional} e você recebe os horários por aqui em instantes.', 340),
('resposta.sem_horario', 'resposta', 'Sem horário no nome', 'Respondeu 1/2 mas não tem nada marcado.', '{}',
 E'🤔 Não encontrei nenhum horário marcado no seu nome.\n\nSe precisar, é só marcar pelo app.', 350),
('resposta.fora_de_contexto', 'resposta', 'Fora de contexto', 'Respondeu 1/2 sem pergunta aberta.', '{}',
 E'👍 Recebi! Pra marcar ou mudar um horário, é só abrir o app.', 360),
('resposta.sair', 'resposta', 'Pediu para sair', 'Desligou os avisos.', '{}',
 E'👋 Pronto, não mando mais lembretes por aqui.\nSe mudar de ideia, é só ligar de novo no app.', 370),
('resposta.voto_repetido_confirmado', 'resposta', 'Já tinha confirmado', 'Respondeu de novo.', '{profissional}',
 E'Sua resposta já foi registrada ✅ (horário confirmado).\nPra mudar, é só falar aqui com a {profissional}.', 380),
('resposta.voto_repetido_cancelado', 'resposta', 'Já tinha cancelado', 'Respondeu de novo.', '{profissional}',
 E'Sua resposta já foi registrada ❌ (horário cancelado).\nPra mudar, é só falar aqui com a {profissional}.', 390),
('resposta.aceite_confirma_avisou', 'resposta', 'Profissional aceitou (cliente avisada)', 'Resposta à profissional depois do "1".', '{}',
 E'✅ Aceito! Já avisei a cliente. 💛', 400),
('resposta.aceite_confirma_sem_aviso', 'resposta', 'Profissional aceitou (sem avisar a cliente)', 'Quando o WhatsApp da cliente falhou.', '{}',
 E'✅ Aceito e confirmado na agenda.\n\n⚠️ Não consegui avisar a cliente pelo WhatsApp — confira o telefone dela no app.', 410),
('resposta.aceite_recusa_avisou', 'resposta', 'Profissional recusou (cliente avisada)', 'Resposta à profissional depois do "2".', '{}',
 E'👍 Recusado. Avisei a cliente e o horário voltou a ficar livre.', 420),
('resposta.aceite_recusa_sem_aviso', 'resposta', 'Profissional recusou (sem avisar a cliente)', 'Quando o WhatsApp da cliente falhou.', '{}',
 E'👍 Recusado, e o horário voltou a ficar livre.\n\n⚠️ Não consegui avisar a cliente pelo WhatsApp — confira o telefone dela no app.', 430),
-- os SILÊNCIOS do bot (vazio = não responde)
('bot.sem_cadastro', 'bot', 'Número sem cadastro escreveu', 'Alguém que não é cliente mandou mensagem. Vazio = fica quieto.', '{link_app}',
 '', 500),
('bot.nao_entendi', 'bot', 'Não entendi', 'Cliente escreveu algo que não é resposta a nada. Vazio = fica quieto.', '{nome,link_app}',
 '', 510)
on conflict (chave) do update set padrao = excluded.padrao, variaveis = excluded.variaveis, titulo = excluded.titulo, descricao = excluded.descricao, grupo = excluded.grupo, ordem = excluded.ordem;

insert into public.bot_palavras (intencao, palavra) values
('sair','sair'),('sair','parar'),('sair','stop'),('sair','cancelar avisos'),('sair','nao quero mais'),('sair','descadastrar'),('sair','remover'),
('confirma','1'),('confirma','sim'),('confirma','s'),('confirma','confirmo'),('confirma','confirmado'),('confirma','ok'),('confirma','certo'),('confirma','isso'),('confirma','confirmar'),('confirma','positivo'),('confirma','estarei la'),('confirma','vou'),
('cancela','2'),('cancela','nao'),('cancela','n'),('cancela','remarcar'),('cancela','cancelar'),('cancela','desmarcar'),('cancela','nao vou'),('cancela','nao posso'),('cancela','negativo'),('cancela','preciso remarcar')
on conflict do nothing;

-- 2. Renderizar ----------------------------------------------------------------------------
-- {var} vira o valor. Variável vazia: ", {nome}" e "{nome}" somem da
-- frase; qualquer OUTRA variável vazia derruba a linha inteira (a linha
-- do link some quando não há link).
create or replace function public.renderizar_modelo(modelo text, vars jsonb)
returns text
language plpgsql
immutable
as $$
declare
  linhas text[]; saida text[] := '{}'; l text; k text; v text; vazia boolean;
begin
  if modelo is null then return null; end if;
  -- o nome some de leve
  v := nullif(btrim(coalesce(vars ->> 'nome', '')), '');
  if v is null then
    modelo := replace(modelo, ', {nome}', '');
    modelo := replace(modelo, ' {nome}', '');
    modelo := replace(modelo, '{nome}', '');
  end if;
  linhas := regexp_split_to_array(modelo, E'\n');
  foreach l in array linhas loop
    vazia := false;
    for k in select distinct m[1] from regexp_matches(l, '\{([a-z_]+)\}', 'g') as m loop
      v := nullif(btrim(coalesce(vars ->> k, '')), '');
      if v is null then vazia := true; exit; end if;
      l := replace(l, '{' || k || '}', v);
    end loop;
    if not vazia then saida := saida || l; end if;
  end loop;
  -- três quebras seguidas viram duas (linha derrubada no meio de um bloco)
  return regexp_replace(array_to_string(saida, E'\n'), E'\n{3,}', E'\n\n', 'g');
end;
$$;

-- o texto em vigor de uma chave: o editado, senão null (= código de sempre)
create or replace function public.modelo_editado(chave_ text)
returns text
language sql
stable
as $$
  select nullif(btrim(coalesce(m.texto, '')), '') from public.modelos_de_mensagem m where m.chave = chave_;
$$;

-- 3. O montador antigo vira o padrão --------------------------------------------------------
create or replace function public.montar_texto_padrao(
  tipo text, titulo text, corpo text, appt uuid, prof uuid, cliente uuid)
returns text
language plpgsql
stable
security definer set search_path = public
as $$
declare
  d_data date; d_hora time; servico text;
  prof_nome text; prof_slug text; base text;
  link text; link_app text; nome_cliente text;
  nome_na_agenda text; tel_na_agenda text;
  quando text; quando_longo text; prazo integer;
  origem uuid; antes_data date; antes_hora time; quando_antes text;
  desistiu boolean := false;
begin
  if appt is not null then
    select ap.date, ap.start_time, coalesce(ap.service_name, s.name),
           ap.professional_id, ap.remarca_de,
           nullif(btrim(coalesce(cl.full_name, '')), ''), cl.phone
      into d_data, d_hora, servico, prof, origem, nome_na_agenda, tel_na_agenda
    from public.appointments ap
    left join public.services s on s.id = ap.service_id
    left join public.profiles cl on cl.id = ap.client_id
    where ap.id = appt;

    -- é uma troca? o horário de onde ela quer sair
    if origem is not null then
      select o.date, o.start_time into antes_data, antes_hora
      from public.appointments o where o.id = origem;
      if antes_data is not null then
        quando_antes := (array['domingo','segunda','terça','quarta','quinta','sexta','sábado'])
                          [extract(dow from antes_data)::int + 1] || ', '
                        || to_char(antes_data, 'DD/MM') || ' às ' || to_char(antes_hora, 'HH24:MI');
      end if;
    end if;

    -- a cliente desfez o pedido antes da resposta?
    select exists (select 1 from public.aceites
                   where appointment_id = appt and resultado = 'desistiu')
      into desistiu;
  end if;

  if prof is not null then
    select pr.name, pr.slug, rtrim(sl.app_url, '/'), pr.minutos_para_aceitar
      into prof_nome, prof_slug, base, prazo
    from public.professionals pr
    join public.salons sl on sl.id = pr.salon_id
    where pr.id = prof;
  end if;

  if cliente is not null then
    select nullif(split_part(coalesce(full_name, ''), ' ', 1), '')
      into nome_cliente from public.profiles where id = cliente;
  end if;

  if base is not null then
    link_app := base || '/';
    if prof_slug is not null then link := base || '/p/' || prof_slug; end if;
  end if;

  if d_data is not null then
    quando := to_char(d_data, 'DD/MM') || ' às ' || to_char(d_hora, 'HH24:MI');
    quando_longo := (array['domingo','segunda','terça','quarta','quinta','sexta','sábado'])
                      [extract(dow from d_data)::int + 1] || ', ' || quando;
  end if;

  case tipo

  -- ---- para a PROFISSIONAL ---------------------------------------------
  when 'pedido_de_aceite' then
    if quando_antes is not null then
      return
        '🔁 *Pedido de remarcação*' || E'\n\n'
        || '👤 ' || coalesce(nome_na_agenda, 'Cliente') || E'\n'
        || '✨ ' || coalesce(servico, 'Atendimento') || E'\n'
        || '🕒 era: ' || quando_antes || E'\n'
        || '➡️ quer: ' || coalesce(quando_longo, '')
        || coalesce(E'\n' || '📱 ' || tel_na_agenda, '') || E'\n\n'
        || 'Responda *1* para aceitar a troca ou *2* para manter como está.' || E'\n'
        || '_Sem resposta em ' || coalesce(prazo, 120) || ' min, eu resolvo sozinho._';
    end if;
    return
      '🔔 *Pedido de horário*' || E'\n\n'
      || '👤 ' || coalesce(nome_na_agenda, 'Cliente') || E'\n'
      || '✨ ' || coalesce(servico, 'Atendimento') || E'\n'
      || '🕒 ' || coalesce(quando_longo, '')
      || coalesce(E'\n' || '📱 ' || tel_na_agenda, '') || E'\n\n'
      || 'Responda *1* para aceitar ou *2* para recusar.' || E'\n'
      || '_Sem resposta em ' || coalesce(prazo, 120) || ' min, eu resolvo sozinho._';

  when 'novo_agendamento' then
    if quando_antes is not null then
      return
        '🔁 *Cliente remarcou*' || E'\n\n'
        || '👤 ' || coalesce(nome_na_agenda, 'Cliente') || E'\n'
        || '✨ ' || coalesce(servico, 'Atendimento') || E'\n'
        || '🕒 era: ' || quando_antes || E'\n'
        || '✅ agora: ' || coalesce(quando_longo, '')
        || coalesce(E'\n' || '📱 ' || tel_na_agenda, '')
        || coalesce(E'\n\n' || '🔗 Sua agenda: ' || link_app, '');
    end if;
    return
      '🗓️ *Horário novo na sua agenda*' || E'\n\n'
      || '👤 ' || coalesce(nome_na_agenda, 'Cliente') || E'\n'
      || '✨ ' || coalesce(servico, 'Atendimento') || E'\n'
      || '🕒 ' || coalesce(quando_longo, 'a confirmar')
      || coalesce(E'\n' || '📱 ' || tel_na_agenda, '')
      || coalesce(E'\n\n' || '🔗 Sua agenda: ' || link_app, '');

  when 'cancelou_comigo' then
    if desistiu and quando_antes is not null then
      return
        '🙅 *Desistiu da remarcação*' || E'\n\n'
        || '👤 ' || coalesce(nome_na_agenda, 'Cliente') || E'\n'
        || '✨ ' || coalesce(servico, 'Atendimento') || E'\n'
        || '🕒 pedia: ' || coalesce(quando_longo, '') || E'\n\n'
        || 'Não precisa responder. O horário de ' || quando_antes || ' continua valendo.';
    elsif desistiu then
      return
        '🙅 *Desistiu do pedido*' || E'\n\n'
        || '👤 ' || coalesce(nome_na_agenda, 'Cliente') || E'\n'
        || '✨ ' || coalesce(servico, 'Atendimento') || E'\n'
        || '🕒 ' || coalesce(quando_longo, '') || E'\n\n'
        || 'Não precisa responder. Nada mudou na sua agenda.';
    end if;
    return
      '⚠️ *Cancelaram um horário*' || E'\n\n'
      || '👤 ' || coalesce(nome_na_agenda, 'Cliente') || E'\n'
      || '✨ ' || coalesce(servico, 'Atendimento') || E'\n'
      || '🕒 ' || coalesce(quando_longo, '') || E'\n\n'
      || 'Esse horário voltou a ficar livre.'
      || coalesce(E'\n\n' || '🔗 Sua agenda: ' || link_app, '');

  -- ---- para a CLIENTE ---------------------------------------------------
  when 'profissional_cancelou' then
    return public.texto_cancelou_prof(servico, prof_nome, quando_longo,
                                      nome_cliente, coalesce(link, link_app));

  when 'pedido_aceito' then
    return
      '✅ *Confirmado!*' || E'\n\n'
      || coalesce('Oi, ' || nome_cliente || '! ', '')
      || 'A *' || coalesce(prof_nome, 'profissional') || '* aceitou:' || E'\n\n'
      || '✨ ' || coalesce(servico, 'Seu atendimento') || E'\n'
      || '🗓️ ' || coalesce(quando_longo, '') || E'\n\n'
      || 'Te espero! 💛';

  when 'pedido_recusado' then
    return
      '😔 *Não deu dessa vez*' || E'\n\n'
      || coalesce('Oi, ' || nome_cliente || '. ', '')
      || 'A *' || coalesce(prof_nome, 'profissional') || '* não vai poder atender '
      || coalesce(quando_longo, 'nesse horário') || '.' || E'\n\n'
      || 'Me chame que a gente acha outro 💛';

  when 'remarcacao_aceita' then
    return
      '🔁 *Remarcado!*' || E'\n\n'
      || coalesce('Oi, ' || nome_cliente || '! ', '')
      || 'A *' || coalesce(prof_nome, 'profissional') || '* aceitou a troca:' || E'\n\n'
      || '✨ ' || coalesce(servico, 'Seu atendimento') || E'\n'
      || coalesce('🕒 era: ' || quando_antes || E'\n', '')
      || '🗓️ agora: ' || coalesce(quando_longo, '') || E'\n\n'
      || 'Te espero! 💛';

  when 'remarcacao_recusada' then
    return
      '😔 *Não deu para remarcar*' || E'\n\n'
      || coalesce('Oi, ' || nome_cliente || '. ', '')
      || 'A *' || coalesce(prof_nome, 'profissional') || '* não consegue '
      || coalesce(quando_longo, 'nesse horário') || '.' || E'\n\n'
      || coalesce('Seu horário de *' || quando_antes || '* continua guardado. ', 'Seu horário de antes continua guardado. ')
      || 'Se quiser tentar outro, é só me chamar 💛';

  when 'lembrete_agendamento' then
    return
      '📅 *Amanhã tem horário marcado*' || E'\n\n'
      || 'Oi' || coalesce(', ' || nome_cliente, '') || '! Só passando pra lembrar:' || E'\n\n'
      || '✨ ' || coalesce(servico, 'Seu atendimento') || E'\n'
      || '👩 com *' || coalesce(prof_nome, 'a profissional') || '*' || E'\n'
      || '🗓️ ' || coalesce(quando, '') || E'\n\n'
      || 'Responda *1* pra confirmar, ou *2* se precisar remarcar.'
      || coalesce(E'\n\n' || '🔗 Sua agenda: ' || link, '');

  when 'agendamento_confirmado' then
    return
      '✅ *Horário confirmado*' || E'\n\n'
      || coalesce('Oi, ' || nome_cliente || '! ', '') || 'Está tudo certo:' || E'\n\n'
      || '✨ ' || coalesce(servico, 'Seu atendimento') || E'\n'
      || '👩 com *' || coalesce(prof_nome, 'a profissional') || '*' || E'\n'
      || '🗓️ ' || coalesce(quando, '')
      || coalesce(E'\n\n' || '🔗 Sua agenda: ' || link, '');

  when 'agendamento_cancelado' then
    return
      '❌ *Horário cancelado*' || E'\n\n'
      || coalesce('Oi, ' || nome_cliente || '. ', '')
      || 'O horário de ' || coalesce(quando, 'antes') || ' foi cancelado.' || E'\n\n'
      || 'Quando quiser remarcar, é só chamar.'
      || coalesce(E'\n\n' || '🔗 ' || link, '');

  when 'convite_retorno' then
    return
      '💛 *Faz tempo que você não aparece*' || E'\n\n'
      || coalesce('Oi, ' || nome_cliente || '! ', 'Oi! ')
      || coalesce('A *' || prof_nome || '*', 'A gente')
      || ' guardou um lugar pra você.' || E'\n\n' || 'Quer já deixar marcado?'
      || coalesce(E'\n\n' || '🔗 ' || link, '');

  when 'pos_atendimento' then
    return
      '💅 *Obrigada pela visita!*' || E'\n\n'
      || coalesce('Oi, ' || nome_cliente || '! ', '') || 'Espero que tenha gostado.'
      || coalesce(E'\n\n' || '🔗 ' || link, '');

  when 'vaga_disponivel' then
    return
      '🎉 *Abriu uma vaga*' || E'\n\n'
      || coalesce('Oi, ' || nome_cliente || '! ', '')
      || 'Apareceu um horário' || coalesce(' em ' || quando, '')
      || coalesce(' com *' || prof_nome || '*', '') || '.' || E'\n\n'
      || 'Ela fica guardada por pouco tempo.'
      || coalesce(E'\n\n' || '🔗 ' || link, '');

  when 'agenda_adiantada' then
    return
      '⏰ *Dá pra adiantar seu horário*' || E'\n\n'
      || coalesce('Oi, ' || nome_cliente || '! ', '')
      || 'Abriu um horário mais cedo' || coalesce(', ' || quando, '') || '.'
      || coalesce(E'\n\n' || '🔗 ' || link, '');

  else
    return coalesce(titulo, '')
      || case when corpo is not null and btrim(corpo) <> ''
              then E'\n\n' || corpo else '' end;
  end case;
end;
$$;

create or replace function public.texto_resposta_padrao(tipo text, quando text, prof text)
returns text
language sql
immutable
as $$
  select case tipo
    when 'confirmado' then
      '✅ *Confirmado!* Te espero dia ' || quando || '. 💛'
    when 'cancelado' then
      '❌ Tudo bem, cancelei o seu horário de ' || quando || '.' || E'\n\n'
      || 'Quando quiser remarcar, é só abrir o app. 🙂'
    when 'remarcado' then
      '🔄 Certo, liberei o seu horário de ' || quando || '.' || E'\n\n'
      || 'Escolha o novo dia por aqui, que eu já deixo marcado. 💛'
    -- com link: a frase aponta para ele
    when 'quer_agendar' then
      '💛 Claro! Escolha o dia e a hora que ficam melhor pra você:'
    -- sem link: promete o que realmente vai acontecer, que é uma pessoa
    -- responder. Prometer menos e cumprir é melhor que apontar para o nada.
    when 'quer_agendar_sem_link' then
      '💛 Claro! Já avisei ' || coalesce('a ' || prof, 'o salão')
      || ' e você recebe os horários por aqui em instantes.'
    when 'sem_horario' then
      '🤔 Não encontrei nenhum horário marcado no seu nome.' || E'\n\n'
      || 'Se precisar, é só marcar pelo app.'
    when 'fora_de_contexto' then
      '👍 Recebi! Pra marcar ou mudar um horário, é só abrir o app.'
    when 'sair' then
      '👋 Pronto, não mando mais lembretes por aqui.' || E'\n'
      || 'Se mudar de ideia, é só ligar de novo no app.'
    when 'voto_repetido_confirmado' then
      'Sua resposta já foi registrada ✅ (horário confirmado).' || E'\n'
      || 'Pra mudar, é só falar aqui com a ' || prof || '.'
    when 'voto_repetido_cancelado' then
      'Sua resposta já foi registrada ❌ (horário cancelado).' || E'\n'
      || 'Pra mudar, é só falar aqui com a ' || prof || '.'
    else ''
  end;
$$;

-- 4. O montador novo: variáveis + modelo editado, senão o padrão ------------------------
create or replace function public.montar_texto_whatsapp(
  tipo text, titulo text, corpo text, appt uuid, prof uuid, cliente uuid)
returns text
language plpgsql
stable
security definer set search_path = public
as $$
declare
  d_data date; d_hora time; servico text;
  prof_nome text; prof_slug text; base text; prazo integer;
  link text; link_app text; nome_cliente text; nome_na_agenda text; tel_na_agenda text;
  quando text; quando_longo text; origem uuid; antes_data date; antes_hora time; quando_antes text;
  desistiu boolean := false;
  chave text := tipo; editado text; vars jsonb;
  dias text[] := array['domingo','segunda','terça','quarta','quinta','sexta','sábado'];
begin
  if appt is not null then
    select ap.date, ap.start_time, coalesce(ap.service_name, s.name), ap.professional_id, ap.remarca_de,
           nullif(btrim(coalesce(cl.full_name, '')), ''), cl.phone
      into d_data, d_hora, servico, prof, origem, nome_na_agenda, tel_na_agenda
    from public.appointments ap
    left join public.services s on s.id = ap.service_id
    left join public.profiles cl on cl.id = ap.client_id
    where ap.id = appt;
    if origem is not null then
      select o.date, o.start_time into antes_data, antes_hora from public.appointments o where o.id = origem;
      if antes_data is not null then
        quando_antes := dias[extract(dow from antes_data)::int + 1] || ', ' || to_char(antes_data, 'DD/MM') || ' às ' || to_char(antes_hora, 'HH24:MI');
      end if;
    end if;
    select exists (select 1 from public.aceites where appointment_id = appt and resultado = 'desistiu') into desistiu;
  end if;
  if prof is not null then
    select pr.name, pr.slug, rtrim(sl.app_url, '/'), pr.minutos_para_aceitar into prof_nome, prof_slug, base, prazo
    from public.professionals pr join public.salons sl on sl.id = pr.salon_id where pr.id = prof;
  end if;
  if cliente is not null then
    select nullif(split_part(coalesce(full_name, ''), ' ', 1), '') into nome_cliente from public.profiles where id = cliente;
  end if;
  if base is not null then
    link_app := base || '/';
    if prof_slug is not null then link := base || '/p/' || prof_slug; end if;
  end if;
  if d_data is not null then
    quando := to_char(d_data, 'DD/MM') || ' às ' || to_char(d_hora, 'HH24:MI');
    quando_longo := dias[extract(dow from d_data)::int + 1] || ', ' || quando;
  end if;

  -- a variante certa da chave
  if tipo = 'pedido_de_aceite' and quando_antes is not null then chave := 'pedido_de_aceite_remarcacao';
  elsif tipo = 'novo_agendamento' and quando_antes is not null then chave := 'novo_agendamento_remarcacao';
  elsif tipo = 'cancelou_comigo' and desistiu and quando_antes is not null then chave := 'cancelou_comigo_desistiu_remarcacao';
  elsif tipo = 'cancelou_comigo' and desistiu then chave := 'cancelou_comigo_desistiu';
  end if;

  editado := public.modelo_editado(chave);
  if editado is null then
    -- tipo desconhecido com modelo próprio (aviso novo): usa o padrão do modelo
    if not exists (select 1 from public.modelos_de_mensagem where public.modelos_de_mensagem.chave = tipo)
       or tipo in ('pedido_de_aceite','novo_agendamento','cancelou_comigo','profissional_cancelou','pedido_aceito','pedido_recusado',
                   'remarcacao_aceita','remarcacao_recusada','lembrete_agendamento','agendamento_confirmado','agendamento_cancelado',
                   'convite_retorno','pos_atendimento','vaga_disponivel','agenda_adiantada') then
      return public.montar_texto_padrao(tipo, titulo, corpo, appt, prof, cliente);
    end if;
    select m.padrao into editado from public.modelos_de_mensagem m where m.chave = tipo;
    if editado is null or editado = '' then
      return public.montar_texto_padrao(tipo, titulo, corpo, appt, prof, cliente);
    end if;
  end if;

  vars := jsonb_build_object(
    'nome', nome_cliente, 'nome_agenda', coalesce(nome_na_agenda, 'Cliente'), 'telefone_cliente', tel_na_agenda,
    'servico', coalesce(servico, 'Atendimento'), 'profissional', coalesce(prof_nome, 'profissional'),
    'quando', quando, 'quando_longo', quando_longo, 'quando_antes', quando_antes,
    'prazo', coalesce(prazo, 120)::text, 'link', link, 'link_app', link_app,
    'titulo', titulo, 'corpo', corpo);
  return public.renderizar_modelo(editado, vars);
end;
$$;

-- 5. As respostas do bot ----------------------------------------------------------------
create or replace function public.texto_resposta(tipo text, quando text, prof text)
returns text
language plpgsql
stable
as $$
declare editado text;
begin
  editado := public.modelo_editado('resposta.' || tipo);
  if editado is null then return public.texto_resposta_padrao(tipo, quando, prof); end if;
  return public.renderizar_modelo(editado, jsonb_build_object('quando', quando, 'profissional', prof));
end;
$$;

-- resposta de aceite e os silêncios: uma função pequena para não repetir
create or replace function public.texto_modelo(chave_ text, vars jsonb default '{}'::jsonb)
returns text
language sql
stable
as $$
  select public.renderizar_modelo(coalesce(public.modelo_editado(chave_), nullif(m.padrao, '')), vars)
  from public.modelos_de_mensagem m where m.chave = chave_;
$$;

-- 6. Palavras do bot: a tabela primeiro, o de sempre depois --------------------------------
create or replace function public.interpretar_resposta(texto text)
returns text
language plpgsql
stable
as $$
declare t text; achou text;
begin
  if texto is null then return 'nada'; end if;
  t := lower(btrim(texto));
  t := translate(t, 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc');
  t := regexp_replace(t, '[^a-z0-9 ]', '', 'g');
  t := btrim(t);
  select p.intencao into achou from public.bot_palavras p where p.palavra = t
   order by case p.intencao when 'sair' then 0 when 'confirma' then 1 else 2 end limit 1;
  if achou is not null then return achou; end if;
  if t in ('sair','parar','stop','cancelar avisos','nao quero mais','descadastrar','remover') then return 'sair'; end if;
  if t in ('1','sim','s','confirmo','confirmado','ok','certo','isso','confirmar','positivo','estarei la','vou') then return 'confirma'; end if;
  if t in ('2','nao','n','remarcar','cancelar','desmarcar','nao vou','nao posso','negativo','preciso remarcar') then return 'cancela'; end if;
  return 'nada';
end;
$$;

-- 7. receber_mensagem: respostas de aceite pelo modelo, e os silêncios --------------------
create or replace function public.receber_mensagem(
  tel text, texto text, id_provedor text default null, id_enquete text default null,
  intencao_do_modelo text default null, salao uuid default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  e164 text := public.telefone_e164(tel);
  bot_ligado boolean := false;
  tem_conversa boolean := false;
  pedido uuid; acao text; r jsonb; avisou boolean; extra text; base text;
begin
  if e164 is null then return jsonb_build_object('acao', 'ignorado', 'motivo', 'telefone invalido'); end if;
  if id_provedor is not null and exists (select 1 from public.whatsapp_inbox where provider_id = id_provedor) then
    return jsonb_build_object('acao', 'ignorado', 'motivo', 'repetida');
  end if;

  select ac.appointment_id into pedido from public.aceites ac
   where ac.telefone_prof = e164 and ac.resultado is null and ac.expira_em > now()
   order by ac.pedido_em limit 1;

  if pedido is not null then
    acao := public.interpretar_resposta(texto);
    if acao = 'nada' and intencao_do_modelo is not null then acao := public.acao_da_intencao(intencao_do_modelo); end if;
    if acao in ('confirma', 'cancela', 'remarca') then
      r := public.resolver_aceite(pedido, acao = 'confirma');
      avisou := coalesce((r ->> 'avisou_cliente')::boolean, false);
      insert into public.whatsapp_inbox (telefone, texto, provider_id, acao, appointment_id, via, intencao_ia)
      values (e164, texto, id_provedor, 'aceite:' || coalesce(r ->> 'resultado','?'), pedido, 'regra', intencao_do_modelo);
      return jsonb_build_object('acao', 'aceite_' || coalesce(r ->> 'resultado','?'), 'appointment_id', pedido,
        'responder', public.texto_modelo('resposta.aceite_' || case when acao = 'confirma' then 'confirma' else 'recusa' end
                                          || case when avisou then '_avisou' else '_sem_aviso' end));
    end if;
  end if;

  select c.usa_bot into bot_ligado from public.whatsapp_channels c where c.salon_id = salao;
  select exists (select 1 from public.conversas where telefone = e164 and expira_em > now()) into tem_conversa;

  if tem_conversa or (coalesce(bot_ligado, false) and public.acao_da_intencao(intencao_do_modelo) = 'quer_agendar') then
    r := public.avancar_conversa(e164, texto, salao);
    if (r ->> 'acao') <> 'sem_cadastro' then
      insert into public.whatsapp_inbox (telefone, texto, provider_id, client_id, acao, appointment_id, via, intencao_ia)
      values (e164, texto, id_provedor, public.cliente_pelo_telefone(e164), 'bot:' || coalesce(r ->> 'acao', '?'),
              nullif(r ->> 'appointment_id', '')::uuid, case when tem_conversa then 'bot' else 'ia' end, intencao_do_modelo);
      return r;
    end if;
  end if;

  r := public.receber_resposta_whatsapp(e164, texto, id_provedor, id_enquete, intencao_do_modelo, salao);

  -- os dois silêncios viram resposta se a plataforma escreveu uma
  if (r ->> 'responder') is null and (r ->> 'acao') in ('sem_cadastro', 'nada') then
    base := public.app_base();
    extra := public.texto_modelo(case when (r ->> 'acao') = 'sem_cadastro' then 'bot.sem_cadastro' else 'bot.nao_entendi' end,
      jsonb_build_object('link_app', base || '/',
        'nome', (select nullif(split_part(coalesce(p.full_name, ''), ' ', 1), '') from public.profiles p where p.id = public.cliente_pelo_telefone(e164))));
    if extra is not null and btrim(extra) <> '' then r := r || jsonb_build_object('responder', extra); end if;
  end if;
  return r;
end;
$$;
revoke execute on function public.receber_mensagem(text, text, text, text, text, uuid) from public, anon, authenticated;

-- 8. O que a Plataforma › Mensagens usa -------------------------------------------------
drop function if exists public.plataforma_modelos();   -- a 072 acrescenta colunas
create function public.plataforma_modelos()
returns table (chave text, grupo text, titulo text, descricao text, variaveis text[], padrao text, texto text, ordem integer,
               atualizado_em timestamptz, envia boolean, natureza text, sufixo text)
language sql
stable
security definer set search_path = public
as $$
  select m.chave, m.grupo, m.titulo, m.descricao, m.variaveis, m.padrao, m.texto, m.ordem, m.atualizado_em,
         r.envia, r.natureza, r.sufixo
  from public.modelos_de_mensagem m
  left join public.whatsapp_regras r on r.kind = m.chave
  where public.eh_plataforma()
  order by m.ordem, m.chave;
$$;
revoke execute on function public.plataforma_modelos() from public, anon;
grant execute on function public.plataforma_modelos() to authenticated;

create or replace function public.plataforma_salvar_modelo(chave_ text, texto_ text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare novo text := nullif(btrim(coalesce(texto_, '')), ''); m record;
begin
  if not public.eh_plataforma() then raise exception 'Só a plataforma edita modelos.'; end if;
  select * into m from public.modelos_de_mensagem where chave = chave_;
  if not found then raise exception 'Modelo % não existe.', chave_; end if;
  -- igual ao padrão = volta a ser padrão (null)
  if novo is not null and novo = btrim(m.padrao) then novo := null; end if;
  if novo is not null and length(novo) > 1500 then raise exception 'Mensagem longa demais (máx. 1500).'; end if;
  update public.modelos_de_mensagem set texto = novo, atualizado_em = now(), atualizado_por = auth.uid() where chave = chave_;
  return jsonb_build_object('ok', true, 'personalizado', novo is not null);
end;
$$;
revoke execute on function public.plataforma_salvar_modelo(text, text) from public, anon;
grant execute on function public.plataforma_salvar_modelo(text, text) to authenticated;

create or replace function public.plataforma_regra_whatsapp(kind_ text, envia_ boolean, sufixo_ text default null)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.eh_plataforma() then raise exception 'Só a plataforma edita regras.'; end if;
  insert into public.whatsapp_regras (kind, envia, natureza, sufixo) values (kind_, envia_, 'utilidade', nullif(btrim(coalesce(sufixo_, '')), ''))
  on conflict (kind) do update set envia = excluded.envia, sufixo = excluded.sufixo;
end;
$$;
revoke execute on function public.plataforma_regra_whatsapp(text, boolean, text) from public, anon;
grant execute on function public.plataforma_regra_whatsapp(text, boolean, text) to authenticated;

-- a prévia com dados de exemplo
create or replace function public.plataforma_previa(texto_ text)
returns text
language sql
stable
security definer set search_path = public
as $$
  select case when public.eh_plataforma() then public.renderizar_modelo(texto_, jsonb_build_object(
    'nome', 'Juliana', 'nome_agenda', 'Juliana Silva', 'telefone_cliente', '(13) 99999-0000',
    'servico', 'Manicure', 'profissional', 'Ana Oliveira', 'quando', '12/09 às 14:00', 'quando_longo', 'sábado, 12/09 às 14:00',
    'quando_antes', 'sexta, 11/09 às 10:00', 'prazo', '120', 'link', public.app_base() || '/p/ana-oliveira', 'link_app', public.app_base() || '/',
    'titulo', 'Título do aviso', 'corpo', 'Corpo do aviso')) end;
$$;
revoke execute on function public.plataforma_previa(text) from public, anon;
grant execute on function public.plataforma_previa(text) to authenticated;

-- manda um teste para o WhatsApp de quem está logada, pelo primeiro canal ligado
create or replace function public.plataforma_testar_modelo(texto_ text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare fone text; c record; corpo text;
begin
  if not public.eh_plataforma() then raise exception 'Só a plataforma.'; end if;
  select public.telefone_e164(p.phone) into fone from public.profiles p where p.id = auth.uid();
  if fone is null then raise exception 'Seu perfil não tem WhatsApp cadastrado.'; end if;
  select * into c from public.whatsapp_channels where ativo and canal <> 'manual' order by salon_id limit 1;
  if not found then raise exception 'Nenhum canal de WhatsApp ligado.'; end if;
  corpo := public.plataforma_previa(texto_);
  insert into public.message_outbox (salon_id, client_id, telefone, kind, titulo, corpo, canal, liberado_em)
  values (c.salon_id, auth.uid(), fone, 'teste_modelo', null, coalesce(corpo, ''), c.canal, now());
  perform public.chutar_agora();
  return jsonb_build_object('ok', true, 'para', fone);
end;
$$;
revoke execute on function public.plataforma_testar_modelo(text) from public, anon;
grant execute on function public.plataforma_testar_modelo(text) to authenticated;
insert into public.whatsapp_regras (kind, envia, natureza, sufixo) values ('teste_modelo', true, 'utilidade', null) on conflict (kind) do nothing;

create or replace function public.plataforma_palavras()
returns table (intencao text, palavras text[])
language sql
stable
security definer set search_path = public
as $$
  select i.intencao, coalesce(array_agg(p.palavra order by p.palavra) filter (where p.palavra is not null), '{}')
  from (values ('confirma'), ('cancela'), ('sair')) i(intencao)
  left join public.bot_palavras p on p.intencao = i.intencao
  where public.eh_plataforma()
  group by i.intencao;
$$;
revoke execute on function public.plataforma_palavras() from public, anon;
grant execute on function public.plataforma_palavras() to authenticated;

create or replace function public.plataforma_salvar_palavras(intencao_ text, palavras_ text[])
returns void
language plpgsql
security definer set search_path = public
as $$
declare p text; limpa text;
begin
  if not public.eh_plataforma() then raise exception 'Só a plataforma.'; end if;
  if intencao_ not in ('confirma', 'cancela', 'sair') then raise exception 'Intenção desconhecida.'; end if;
  delete from public.bot_palavras where intencao = intencao_;
  foreach p in array coalesce(palavras_, '{}') loop
    limpa := btrim(regexp_replace(translate(lower(p), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'), '[^a-z0-9 ]', '', 'g'));
    if limpa <> '' then
      insert into public.bot_palavras (intencao, palavra) values (intencao_, limpa) on conflict do nothing;
    end if;
  end loop;
end;
$$;
revoke execute on function public.plataforma_salvar_palavras(text, text[]) from public, anon;
grant execute on function public.plataforma_salvar_palavras(text, text[]) to authenticated;

-- a IA por salão: ligada, tetos e o gasto de hoje
drop function if exists public.plataforma_ia();
create function public.plataforma_ia()
returns table (salon_id uuid, salao text, canal text, ativo boolean, usa_bot boolean, usa_ia boolean,
               teto_ia_diario integer, teto_ia_por_numero integer, gastas_hoje integer)
language sql
stable
security definer set search_path = public
as $$
  select c.salon_id, s.name, c.canal, c.ativo, c.usa_bot, c.usa_ia, c.teto_ia_diario, c.teto_ia_por_numero,
         coalesce(public.ia_gastas_hoje(c.salon_id), 0)
  from public.whatsapp_channels c join public.salons s on s.id = c.salon_id
  where public.eh_plataforma()
  order by s.name;
$$;
revoke execute on function public.plataforma_ia() from public, anon;
grant execute on function public.plataforma_ia() to authenticated;

create or replace function public.plataforma_ligar_ia(salao uuid, bot boolean, ia boolean)
returns void
language sql
security definer set search_path = public
as $$
  update public.whatsapp_channels set usa_bot = bot, usa_ia = ia where salon_id = salao and public.eh_plataforma();
$$;
revoke execute on function public.plataforma_ligar_ia(uuid, boolean, boolean) from public, anon;
grant execute on function public.plataforma_ligar_ia(uuid, boolean, boolean) to authenticated;
