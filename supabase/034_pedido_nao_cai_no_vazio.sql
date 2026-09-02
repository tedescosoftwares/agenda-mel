-- =============================================================
-- Agenda Mel — 034: pedido de horário não cai no vazio
--
-- Dois defeitos que só apareceram com a coisa no ar, conversando com
-- gente de verdade:
--
-- 1. A resposta terminava em dois-pontos e não vinha nada depois:
--
--        💛 Claro! Escolha o dia e a hora que ficam melhor pra você:
--
--    O link é opcional (depende do salão ter gravado o endereço do app),
--    mas a frase foi escrita como se ele fosse certo. Frase apontando
--    para o vazio parece sistema quebrado — e para a cliente, é.
--
-- 2. Ninguém ficava sabendo. A cliente pedia horário pelo WhatsApp, o
--    sistema respondia bonito, e a mensagem morria numa tabela. Enquanto
--    a máquina de estados não marca sozinha, quem marca é gente — e
--    gente precisa ser avisada.
-- =============================================================

-- 1. Duas frases, porque são duas situações -------------------------------
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

revoke execute on function public.texto_resposta(text, text, text)
  from public, anon, authenticated;

-- 2. Quem atende este telefone -------------------------------------------
-- A última profissional que trocou mensagem com este número. Para quem
-- escreve pela primeira vez não há resposta, e tudo bem: aí quem é
-- avisada é a dona do salão.
create or replace function public.profissional_do_telefone(tel text)
returns uuid
language sql
stable
security definer set search_path = public
as $$
  select o.professional_id
  from public.message_outbox o
  where o.telefone = public.telefone_e164(tel)
    and o.professional_id is not null
  order by o.criado_em desc
  limit 1;
$$;

revoke execute on function public.profissional_do_telefone(text)
  from public, anon, authenticated;

-- 3. Avisar quem pode marcar ----------------------------------------------
insert into public.whatsapp_regras (kind, envia, natureza, sufixo) values
  ('pedido_pelo_whatsapp', true, 'utilidade', null)
on conflict (kind) do nothing;
update public.whatsapp_regras set envia = true where kind = 'pedido_pelo_whatsapp';

create or replace function public.avisar_do_pedido(
  salao uuid,
  tel text,
  texto text,
  cliente uuid default null
)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  prof uuid;
  conta uuid;
  quem text;
  corpo text;
  avisados integer := 0;
begin
  if salao is null then
    return 0;
  end if;

  quem := coalesce(
    (select nullif(btrim(full_name), '') from public.profiles where id = cliente),
    tel);

  corpo := quem || ' escreveu: "' || left(coalesce(texto, ''), 160) || '"';

  -- a profissional que já atende este número recebe primeiro, e recebe
  -- por WhatsApp: é ela que vai responder
  prof := public.profissional_do_telefone(tel);
  if prof is not null then
    conta := public.conta_da_profissional(prof);
    if conta is not null then
      perform public.notificar(
        conta, 'pedido_pelo_whatsapp', 'Pedido de horário no WhatsApp',
        corpo, '/pro',
        jsonb_build_object('professional_id', prof, 'telefone', tel));
      avisados := avisados + 1;
    end if;
  end if;

  -- a dona do salão fica sabendo de qualquer jeito, inclusive de quem
  -- escreveu pela primeira vez e não tem profissional
  for conta in
    select m.user_id from public.salon_members m
    where m.salon_id = salao and m.papel = 'admin'
      and m.user_id is distinct from public.conta_da_profissional(prof)
  loop
    perform public.notificar(
      conta, 'pedido_pelo_whatsapp', 'Pedido de horário no WhatsApp',
      corpo, '/admin/whatsapp',
      jsonb_build_object('telefone', tel));
    avisados := avisados + 1;
  end loop;

  return avisados;
end;
$$;

revoke execute on function public.avisar_do_pedido(uuid, text, text, uuid)
  from public, anon, authenticated;

-- 4. O recebedor, com o pedido avisando gente ----------------------------
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
  nome_prof text;
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

    -- Enquanto a máquina de estados não marca sozinha, quem marca é
    -- gente. Avisar não é enfeite: é o que faz a resposta abaixo ser
    -- verdade em vez de promessa vazia.
    perform public.avisar_do_pedido(salao, e164, texto, cliente);

    if link is not null then
      return jsonb_build_object('acao', 'quer_agendar', 'via', origem,
        'responder', public.texto_resposta('quer_agendar', null, null)
                     || E'\n\n' || '🔗 ' || link);
    end if;

    -- sem link, a frase muda: não adianta mandar escolher o dia num
    -- lugar que não existe
    select p.name into nome_prof from public.professionals p
    where p.id = public.profissional_do_telefone(e164);

    return jsonb_build_object('acao', 'quer_agendar', 'via', origem,
      'responder', public.texto_resposta('quer_agendar_sem_link', null, nome_prof));
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

