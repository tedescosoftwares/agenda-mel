-- =============================================================
-- Agenda Mel — 033: a IA entende o que a lista não previu
--
-- O interpretar_resposta() é uma lista de palavras exatas: "1", "sim",
-- "confirmo", "cancelar". Funciona para quem responde curto, e falha
-- para "pode deixar que eu vou", "tá bom então", "não vou conseguir
-- dessa vez amiga". Que é como as pessoas escrevem de verdade.
--
-- A saída NÃO é uma lista maior — lista nunca acaba. É uma cascata:
--
--   1. as regras exatas primeiro. Custo zero, resposta instantânea,
--      e resolvem a maioria porque a mensagem PEDE "responda 1".
--   2. o que elas não souberem passa pelo porteiro da 030.
--   3. o que o porteiro liberar vai para o modelo.
--
-- O ponto que faz isso ser seguro: **a IA não ganha caminho próprio**.
-- Ela devolve uma das mesmas palavras que as regras devolveriam, e daí
-- em diante é o código de sempre que age. O modelo traduz; quem executa
-- continua sendo SQL que a gente leu.
-- =============================================================

-- 1. Guardar quem entendeu -----------------------------------------------
-- Sem isto não dá para responder "por que o sistema cancelou o horário
-- da minha cliente?". Com isto, a resposta está numa linha.
alter table public.whatsapp_inbox
  add column if not exists via text not null default 'regra';

alter table public.whatsapp_inbox
  add column if not exists intencao_ia text;

do $$ begin
  alter table public.whatsapp_inbox
    add constraint via_conhecida check (via in ('regra', 'ia'));
exception when duplicate_object then null; end $$;

-- 2. Da intenção do modelo para o verbo do sistema ------------------------
-- O modelo fala o vocabulário da bancada (agendar, remarcar, cancelar,
-- confirmar, preco, horarios, outro). O sistema fala outro, menor. Esta
-- função é a fronteira entre os dois — e é ela que impede uma intenção
-- inventada pelo modelo de virar ação: o que não estiver aqui vira 'nada'.
create or replace function public.acao_da_intencao(intencao text)
returns text
language sql
immutable
as $$
  select case lower(btrim(coalesce(intencao, '')))
    when 'confirmar' then 'confirma'
    when 'cancelar'  then 'cancela'
    when 'remarcar'  then 'remarca'
    -- quem quer marcar, quer saber preço ou quer saber horário recebe a
    -- mesma coisa hoje: o caminho para a agenda. Quando a máquina de
    -- estados existir, é aqui que os três se separam.
    when 'agendar'   then 'quer_agendar'
    when 'preco'     then 'quer_agendar'
    when 'horarios'  then 'quer_agendar'
    else 'nada'
  end;
$$;

-- 3. Respostas para os casos novos ---------------------------------------
create or replace function public.texto_resposta(tipo text, quando text, prof text)
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
    when 'quer_agendar' then
      '💛 Claro! Escolha o dia e a hora que ficam melhor pra você:'
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

revoke execute on function public.texto_resposta(text, text, text)
  from public, anon, authenticated;

-- 4. O link da agenda, para colar nas respostas ---------------------------
-- O caminho normal é pelo histórico: a última mensagem que saiu para
-- este telefone diz de que salão e de que profissional é a conversa.
-- Só que quem escreve pela PRIMEIRA vez não tem histórico — e é
-- justamente essa pessoa que mais precisa do link. Por isso o salão
-- entra como reserva: quem chama sabe qual é, porque o porteiro da 030
-- já descobriu pela instância que recebeu.
drop function if exists public.link_da_agenda(text);
create or replace function public.link_da_agenda(tel text, salao uuid default null)
returns text
language sql
stable
security definer set search_path = public
as $$
  select coalesce(
    (select rtrim(s.app_url, '/') || coalesce('/p/' || p.slug, '/')
       from public.message_outbox o
       join public.salons s on s.id = o.salon_id
       left join public.professionals p on p.id = o.professional_id
      where o.telefone = public.telefone_e164(tel)
        and s.app_url is not null
      order by o.criado_em desc
      limit 1),
    (select rtrim(s.app_url, '/') || '/'
       from public.salons s
      where s.id = salao and s.app_url is not null)
  );
$$;

revoke execute on function public.link_da_agenda(text, uuid)
  from public, anon, authenticated;

-- 5. O recebedor, agora com a IA como reserva -----------------------------
-- Mudança de assinatura: precisa derrubar as versões anteriores antes.
drop function if exists public.receber_resposta_whatsapp(text, text, text);
drop function if exists public.receber_resposta_whatsapp(text, text, text, text);
drop function if exists public.receber_resposta_whatsapp(text, text, text, text, text);
drop function if exists public.receber_resposta_whatsapp(text, text, text, text, text, uuid);

create or replace function public.receber_resposta_whatsapp(
  tel text,
  texto text,
  id_provedor text default null,
  id_enquete text default null,
  -- a intenção que o modelo leu, no vocabulário da bancada. Só é olhada
  -- quando as regras não souberam responder; regra que reconheceu ganha
  -- sempre, porque é determinística e a cliente escreveu o que pedimos.
  intencao_do_modelo text default null,
  -- de que salão é a conversa. Vem do porteiro, que descobriu pela
  -- instância que recebeu; serve para responder a quem nunca escreveu.
  salao uuid default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  cliente uuid;
  acao text;
  origem text := 'regra';
  appt public.appointments%rowtype;
  appt_id uuid;
  prof public.professionals%rowtype;
  e164 text := public.telefone_e164(tel);
  resposta jsonb;
  ja_votou record;
  link text;
  quando text;
begin
  if e164 is null then
    return jsonb_build_object('acao', 'ignorado', 'motivo', 'telefone invalido');
  end if;

  if id_provedor is not null
     and exists (select 1 from public.whatsapp_inbox where provider_id = id_provedor) then
    return jsonb_build_object('acao', 'ignorado', 'motivo', 'repetida');
  end if;

  cliente := public.cliente_pelo_telefone(e164);

  -- A CASCATA -----------------------------------------------------------
  acao := public.interpretar_resposta(texto);
  if acao = 'nada' and intencao_do_modelo is not null then
    acao := public.acao_da_intencao(intencao_do_modelo);
    if acao <> 'nada' then
      origem := 'ia';
    end if;
  end if;

  -- Voto trocado na mesma enquete: o primeiro já valeu
  if id_enquete is not null then
    select i.acao, i.appointment_id into ja_votou
    from public.whatsapp_inbox i
    where i.enquete_id = id_enquete
      and i.acao in ('confirmado', 'cancelado')
    order by i.recebido_em
    limit 1;

    if found then
      insert into public.whatsapp_inbox
        (telefone, texto, provider_id, client_id, acao, appointment_id, enquete_id, via, intencao_ia)
      values (e164, texto, id_provedor, cliente, 'voto_repetido', ja_votou.appointment_id,
              id_enquete, origem, intencao_do_modelo);

      select * into prof
      from public.professionals p
      join public.appointments a on a.professional_id = p.id
      where a.id = ja_votou.appointment_id;

      return jsonb_build_object(
        'acao', 'voto_repetido',
        'responder',
          public.texto_resposta('voto_repetido_' || ja_votou.acao, null, coalesce(prof.name, 'profissional'))
      );
    end if;
  end if;

  -- Sair: vale mesmo para quem não tem conta no app
  if acao = 'sair' then
    if cliente is not null then
      update public.profiles set accepts_reminders = false where id = cliente;
      update public.message_outbox set status = 'cancelado'
      where client_id = cliente and status = 'na_fila';
    end if;

    insert into public.whatsapp_inbox
      (telefone, texto, provider_id, client_id, acao, enquete_id, via, intencao_ia)
    values (e164, texto, id_provedor, cliente, 'sair', id_enquete, origem, intencao_do_modelo);

    return jsonb_build_object('acao', 'sair',
      'responder', public.texto_resposta('sair', null, null));
  end if;

  -- Querer marcar não depende de contexto nem de cadastro: é a única
  -- intenção que pode vir de alguém que nunca falou com a gente. O que
  -- ela recebe é direção, não agendamento — a máquina de estados que vai
  -- marcar de verdade ainda não existe, e prometer o que não faço seria
  -- pior do que mandar o link.
  if acao = 'quer_agendar' then
    link := public.link_da_agenda(e164, salao);
    insert into public.whatsapp_inbox
      (telefone, texto, provider_id, client_id, acao, enquete_id, via, intencao_ia)
    values (e164, texto, id_provedor, cliente, 'quer_agendar', id_enquete, origem, intencao_do_modelo);

    return jsonb_build_object('acao', 'quer_agendar',
      'via', origem,
      'responder', public.texto_resposta('quer_agendar', null, null)
        || coalesce(E'\n\n' || '🔗 ' || link, ''));
  end if;

  if cliente is null then
    insert into public.whatsapp_inbox
      (telefone, texto, provider_id, acao, enquete_id, via, intencao_ia)
    values (e164, texto, id_provedor, 'sem_cadastro', id_enquete, origem, intencao_do_modelo);
    return jsonb_build_object('acao', 'sem_cadastro');
  end if;

  if acao = 'nada' then
    insert into public.whatsapp_inbox
      (telefone, texto, provider_id, client_id, acao, enquete_id, via, intencao_ia)
    values (e164, texto, id_provedor, cliente, 'nada', id_enquete, origem, intencao_do_modelo);
    return jsonb_build_object('acao', 'nada');
  end if;

  -- Mexer na agenda continua exigindo que a conversa seja sobre um
  -- horário. Isto vale INCLUSIVE para o que a IA entendeu: "confirmo"
  -- solto, três semanas depois do último lembrete, não confirma nada.
  if public.ultimo_assunto_enviado(e164) is distinct from 'lembrete_agendamento' then
    insert into public.whatsapp_inbox
      (telefone, texto, provider_id, client_id, acao, enquete_id, via, intencao_ia)
    values (e164, texto, id_provedor, cliente, 'fora_de_contexto', id_enquete, origem, intencao_do_modelo);
    return jsonb_build_object('acao', 'fora_de_contexto',
      'responder', public.texto_resposta('fora_de_contexto', null, null));
  end if;

  appt_id := public.proximo_agendamento_da_cliente(cliente);
  if appt_id is null then
    insert into public.whatsapp_inbox
      (telefone, texto, provider_id, client_id, acao, enquete_id, via, intencao_ia)
    values (e164, texto, id_provedor, cliente, 'sem_horario', id_enquete, origem, intencao_do_modelo);
    return jsonb_build_object('acao', 'sem_horario',
      'responder', public.texto_resposta('sem_horario', null, null));
  end if;

  select * into appt from public.appointments where id = appt_id;
  select * into prof from public.professionals where id = appt.professional_id;
  quando := to_char(appt.date, 'DD/MM') || ' às ' || to_char(appt.start_time, 'HH24:MI');

  if acao = 'confirma' then
    update public.appointments set status = 'confirmado'
    where id = appt_id and status = 'pendente';

    perform public.notificar(
      cliente, 'agendamento_confirmado', 'Horário confirmado',
      coalesce(appt.service_name, 'Seu atendimento') || ' com ' || prof.name ||
        ' dia ' || quando || '.',
      '/', jsonb_build_object('appointment_id', appt_id)
    );

    resposta := jsonb_build_object('acao', 'confirmado', 'appointment_id', appt_id,
      'responder', public.texto_resposta('confirmado', quando, null));

  else
    -- cancela e remarca desmarcam igual; muda o que ela ouve de volta,
    -- porque quem quer remarcar não quer ser mandada embora
    update public.appointments set status = 'cancelado' where id = appt_id;

    resposta := jsonb_build_object(
      'acao', case when acao = 'remarca' then 'remarcado' else 'cancelado' end,
      'appointment_id', appt_id,
      'responder',
        public.texto_resposta(case when acao = 'remarca' then 'remarcado' else 'cancelado' end,
                              quando, null)
        || case when acao = 'remarca'
                then coalesce(E'\n\n' || '🔗 ' || public.link_da_agenda(e164, salao), '')
                else '' end);

    if prof.user_id is not null then
      perform public.notificar(
        prof.user_id, 'agendamento_cancelado', 'Cancelou pelo WhatsApp',
        (select coalesce(full_name, 'A cliente') from public.profiles where id = cliente)
          || ' cancelou ' || quando || '.',
        '/pro', jsonb_build_object('appointment_id', appt_id)
      );
    end if;
  end if;

  insert into public.whatsapp_inbox
    (telefone, texto, provider_id, client_id, acao, appointment_id, enquete_id, via, intencao_ia)
  values (e164, texto, id_provedor, cliente, resposta ->> 'acao', appt_id, id_enquete,
          origem, intencao_do_modelo);

  return resposta || jsonb_build_object('via', origem);
end;
$$;

revoke execute on function
  public.receber_resposta_whatsapp(text, text, text, text, text, uuid)
  from public, anon, authenticated;

-- 6. Ligar e desligar pela tela --------------------------------------------
-- O update direto em whatsapp_channels já é permitido para o admin pela
-- RLS da 023 mais o grant de coluna da 030. Esta função existe para a
-- tela não precisar saber disso, e para o retorno já vir no formato que
-- ela mostra.
drop function if exists public.ligar_ia(uuid, boolean);
create or replace function public.ligar_ia(salao uuid, ligada boolean)
returns boolean
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_admin_do_salao(salao) then
    raise exception 'só a dona do salão liga a IA';
  end if;

  update public.whatsapp_channels set usa_ia = ligada where salon_id = salao;
  return ligada;
end;
$$;

revoke execute on function public.ligar_ia(uuid, boolean) from public, anon;
grant execute on function public.ligar_ia(uuid, boolean) to authenticated;

-- 7. As últimas leituras, para a tela ---------------------------------------
-- Mostrar o que a IA entendeu é o que separa "confio nisso" de "essa
-- coisa mexe na minha agenda e eu não sei por quê".
drop function if exists public.leituras_recentes(uuid, integer);
create or replace function public.leituras_recentes(salao uuid, quantas integer default 20)
returns table (
  quando timestamptz,
  telefone text,
  texto text,
  entendeu text,
  via text,
  intencao text
)
language sql
stable
security definer set search_path = public
as $$
  select i.recebido_em, i.telefone, i.texto, i.acao, i.via, i.intencao_ia
  from public.whatsapp_inbox i
  where public.is_admin_do_salao(salao)
    and (
      i.client_id in (
        select a.client_id from public.appointments a where a.salon_id = salao
      )
      or exists (
        select 1 from public.message_outbox o
        where o.telefone = i.telefone and o.salon_id = salao
      )
      or i.via = 'ia'
    )
  order by i.recebido_em desc
  limit greatest(1, least(coalesce(quantas, 20), 100));
$$;

revoke execute on function public.leituras_recentes(uuid, integer) from public, anon;
grant execute on function public.leituras_recentes(uuid, integer) to authenticated;
