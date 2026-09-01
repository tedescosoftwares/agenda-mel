-- =============================================================
-- Agenda Mel — 029: a mensagem do WhatsApp com cara de mensagem
-- Rode este arquivo no SQL Editor do Supabase (DEPOIS do 028).
--
-- O aviso dentro do app é seco de propósito — sem emoji, tipografia
-- do sistema. No WhatsApp é o contrário: mensagem sem emoji parece
-- robô. Então o texto do WhatsApp deixa de ser "título + corpo" do
-- app e passa a ser montado aqui, por tipo, com *negrito*, emoji e
-- o link da agenda da profissional.
--
-- O link só entra quando o salão tem endereço público gravado
-- (salons.app_url). Sem ele, a mensagem sai sem a linha do link —
-- melhor que mandar localhost para a cliente.
-- =============================================================

-- 1. O endereço público do app, por salão -------------------------------
alter table public.salons
  add column if not exists app_url text
    check (app_url is null or app_url ~ '^https?://');

comment on column public.salons.app_url is
  'Endereço público do app (ex.: https://agendamel.vercel.app). '
  'É o que vai nos links das mensagens de WhatsApp. Sem barra no fim.';

-- a dona do salão grava isso pela tela de horários
drop policy if exists "admin edita o salao" on public.salons;
create policy "admin edita o salao"
  on public.salons for update
  to authenticated
  using (public.is_admin_do_salao(id))
  with check (public.is_admin_do_salao(id));

grant update (app_url, name, brand_color) on public.salons to authenticated;

-- 2. O texto, por tipo ---------------------------------------------------
create or replace function public.montar_texto_whatsapp(
  tipo text,
  titulo text,
  corpo text,
  appt uuid,
  prof uuid,
  cliente uuid
)
returns text
language plpgsql
stable
security definer set search_path = public
as $$
declare
  -- variáveis escalares, não RECORD: no plpgsql, ler um campo de um
  -- record que nunca foi atribuído levanta erro, e como o notificar()
  -- engole exceções da fila, a mensagem sumiria em silêncio. Foi o que
  -- aconteceu com "chamar de volta", que não tem agendamento.
  d_data date;
  d_hora time;
  servico text;
  prof_nome text;
  prof_slug text;
  base text;
  link text;
  link_app text;
  nome_cliente text;
  quando text;
begin
  if appt is not null then
    select ap.date, ap.start_time, coalesce(ap.service_name, s.name), ap.professional_id
      into d_data, d_hora, servico, prof
    from public.appointments ap
    left join public.services s on s.id = ap.service_id
    where ap.id = appt;
  end if;

  if prof is not null then
    select pr.name, pr.slug, rtrim(sl.app_url, '/')
      into prof_nome, prof_slug, base
    from public.professionals pr
    join public.salons sl on sl.id = pr.salon_id
    where pr.id = prof;
  end if;

  if cliente is not null then
    select nullif(split_part(coalesce(full_name, ''), ' ', 1), '')
      into nome_cliente
    from public.profiles where id = cliente;
  end if;

  if base is not null then
    link_app := base || '/';
    if prof_slug is not null then
      link := base || '/p/' || prof_slug;
    end if;
  end if;

  if d_data is not null then
    quando := to_char(d_data, 'DD/MM') || ' às ' || to_char(d_hora, 'HH24:MI');
  end if;

  case tipo

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
      || '✨ ' || coalesce(servico, 'Seu atendimento') || E'\n'
      || '👩 com *' || coalesce(prof_nome, 'a profissional') || '*' || E'\n'
      || '🗓️ ' || coalesce(quando, '') || E'\n\n'
      || 'Te esperamos! 💛'
      || coalesce(E'\n\n' || '🔗 ' || link, '');

  when 'agendamento_cancelado' then
    return
      '❌ *Horário cancelado*' || E'\n\n'
      || coalesce(servico, 'Seu atendimento') || coalesce(' de ' || quando, '')
      || ' foi cancelado.' || E'\n\n'
      || 'Quando quiser remarcar, é só escolher um horário novo'
      || coalesce(': ' || link, ' pelo app.');

  when 'convite_retorno' then
    return
      '💛 *Oi' || coalesce(', ' || nome_cliente, '') || '!*' || E'\n\n'
      || coalesce(nullif(btrim(corpo), ''), 'Faz um tempo que você não aparece — a agenda está aberta.')
      || E'\n\n'
      || '📅 Escolha um horário' || coalesce(': ' || link, ' pelo app.') || E'\n\n'
      || '_Se não quiser mais receber, responda SAIR._';

  when 'pos_atendimento' then
    return
      '💆 *Obrigada pela visita' || coalesce(', ' || nome_cliente, '') || '!*' || E'\n\n'
      || coalesce(nullif(btrim(corpo), ''), 'Esperamos você de novo.')
      -- o corpo do 019 já pergunta "quer já deixar marcado?"; aqui só o link
      || coalesce(E'\n\n' || '📅 ' || link, '');

  when 'vaga_disponivel' then
    return
      '⏰ *Abriu uma vaga!*' || E'\n\n'
      || coalesce(nullif(btrim(corpo), ''), '') || E'\n\n'
      || '⚡ Ela fica guardada pra você por pouco tempo — abra o app pra pegar'
      || coalesce(': ' || link_app, '.');

  when 'agenda_adiantada' then
    return
      '⏰ *Dá pra vir mais cedo?*' || E'\n\n'
      || coalesce(nullif(btrim(corpo), ''), '') || E'\n\n'
      || '👉 Responda pelo app' || coalesce(': ' || link_app, '.');

  else
    -- tipo sem tratamento próprio: título em negrito e o corpo, sem invenção
    return '*' || coalesce(titulo, '') || '*'
      || coalesce(E'\n\n' || nullif(btrim(coalesce(corpo, '')), ''), '');
  end case;
end;
$$;

revoke execute on function public.montar_texto_whatsapp(text, text, text, uuid, uuid, uuid)
  from public, anon, authenticated;

-- 3. A fila usa o texto bonito -------------------------------------------
drop function if exists public.enfileirar_whatsapp(uuid, uuid, text, text, uuid, uuid, text);

create or replace function public.enfileirar_whatsapp(
  aviso_id uuid,
  destinatario uuid,
  tipo text,
  texto text,
  prof uuid default null,
  appt uuid default null,
  cabecalho text default null
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  regra public.whatsapp_regras%rowtype;
  cliente public.profiles%rowtype;
  canal public.whatsapp_channels%rowtype;
  salao uuid;
  tel text;
  agora timestamp := public.agora_local();
  libera timestamptz := now();
  hoje_local date := public.agora_local()::date;
  ja_hoje integer;
  fila_id uuid;
  bonito text;
begin
  if texto is null or btrim(texto) = '' then
    return null;
  end if;

  select * into regra from public.whatsapp_regras where kind = tipo;
  if not found or not regra.envia then
    return null;
  end if;

  select * into cliente from public.profiles where id = destinatario;
  if not found or not cliente.accepts_reminders then
    return null;
  end if;

  tel := public.telefone_e164(cliente.phone);
  if tel is null then
    return null;
  end if;

  if prof is not null then
    select p.salon_id into salao from public.professionals p where p.id = prof;
  end if;
  if salao is null and appt is not null then
    select a.salon_id, a.professional_id into salao, prof
    from public.appointments a where a.id = appt;
  end if;
  if salao is null then
    return null;
  end if;

  select * into canal from public.whatsapp_channels where salon_id = salao;
  if not found or not canal.ativo then
    return null;
  end if;

  select count(*) into ja_hoje
  from public.message_outbox o
  where o.salon_id = salao
    and o.status <> 'cancelado'
    and (o.criado_em at time zone 'America/Sao_Paulo')::date = hoje_local;

  if ja_hoje >= canal.teto_diario then
    return null;
  end if;

  if canal.canal = 'manual' then
    libera := now();
  elsif canal.silencio_inicio < canal.silencio_fim then
    if agora::time >= canal.silencio_inicio and agora::time < canal.silencio_fim then
      libera := ((agora::date + canal.silencio_fim) at time zone 'America/Sao_Paulo');
    end if;
  else
    if agora::time >= canal.silencio_inicio then
      libera := ((agora::date + 1 + canal.silencio_fim) at time zone 'America/Sao_Paulo');
    elsif agora::time < canal.silencio_fim then
      libera := ((agora::date + canal.silencio_fim) at time zone 'America/Sao_Paulo');
    end if;
  end if;

  -- O texto do WhatsApp é montado por tipo, com emoji e link. Quando
  -- um botão de verdade vai junto (cloud) ou o salão pediu enquete, o
  -- "Responda 1" já não faz sentido — o montador ainda o inclui no
  -- lembrete; tudo bem: a cloud usa titulo+corpo próprios via botoes.
  bonito := public.montar_texto_whatsapp(tipo, cabecalho, texto, appt, prof, destinatario);

  insert into public.message_outbox
    (salon_id, professional_id, client_id, notification_id, appointment_id,
     telefone, kind, titulo, corpo, canal, liberado_em)
  values
    (salao, prof, destinatario, aviso_id, appt,
     tel, tipo, null, coalesce(bonito, texto), canal.canal, libera)
  on conflict do nothing
  returning id into fila_id;

  return fila_id;
end;
$$;

revoke execute on function
  public.enfileirar_whatsapp(uuid, uuid, text, text, uuid, uuid, text)
  from public, anon, authenticated;

-- 4. As respostas automáticas também ganham cara -----------------------
-- (só o texto muda; a lógica é a do 028)
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

-- 5. receber_resposta_whatsapp, agora respondendo bonito -------------
drop function if exists public.receber_resposta_whatsapp(text, text, text);

create or replace function public.receber_resposta_whatsapp(
  tel text,
  texto text,
  id_provedor text default null,
  id_enquete text default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  cliente uuid;
  acao text;
  appt public.appointments%rowtype;
  appt_id uuid;
  prof public.professionals%rowtype;
  e164 text := public.telefone_e164(tel);
  resposta jsonb;
  ja_votou record;
begin
  if e164 is null then
    return jsonb_build_object('acao', 'ignorado', 'motivo', 'telefone invalido');
  end if;

  -- o mesmo evento chegando duas vezes não age duas vezes
  if id_provedor is not null
     and exists (select 1 from public.whatsapp_inbox where provider_id = id_provedor) then
    return jsonb_build_object('acao', 'ignorado', 'motivo', 'repetida');
  end if;

  cliente := public.cliente_pelo_telefone(e164);
  acao := public.interpretar_resposta(texto);

  -- ------------------------------------------------------------------
  -- Voto trocado na mesma enquete: o primeiro já valeu
  -- ------------------------------------------------------------------
  if id_enquete is not null then
    select i.acao, i.appointment_id into ja_votou
    from public.whatsapp_inbox i
    where i.enquete_id = id_enquete
      and i.acao in ('confirmado', 'cancelado')
    order by i.recebido_em
    limit 1;

    if found then
      insert into public.whatsapp_inbox
        (telefone, texto, provider_id, client_id, acao, appointment_id, enquete_id)
      values (e164, texto, id_provedor, cliente, 'voto_repetido', ja_votou.appointment_id, id_enquete);

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

  -- ------------------------------------------------------------------
  -- Sair: vale mesmo para quem não tem conta no app
  -- ------------------------------------------------------------------
  if acao = 'sair' then
    if cliente is not null then
      update public.profiles set accepts_reminders = false where id = cliente;
      update public.message_outbox
      set status = 'cancelado'
      where client_id = cliente and status = 'na_fila';
    end if;

    insert into public.whatsapp_inbox (telefone, texto, provider_id, client_id, acao, enquete_id)
    values (e164, texto, id_provedor, cliente, 'sair', id_enquete);

    return jsonb_build_object(
      'acao', 'sair',
      'responder', public.texto_resposta('sair', null, null)
    );
  end if;

  if cliente is null then
    insert into public.whatsapp_inbox (telefone, texto, provider_id, acao, enquete_id)
    values (e164, texto, id_provedor, 'sem_cadastro', id_enquete);
    return jsonb_build_object('acao', 'sem_cadastro');
  end if;

  if acao = 'nada' then
    insert into public.whatsapp_inbox (telefone, texto, provider_id, client_id, acao, enquete_id)
    values (e164, texto, id_provedor, cliente, 'nada', id_enquete);
    return jsonb_build_object('acao', 'nada');
  end if;

  -- 1 e 2 só mexem na agenda quando a conversa é sobre um horário
  if public.ultimo_assunto_enviado(e164) is distinct from 'lembrete_agendamento' then
    insert into public.whatsapp_inbox (telefone, texto, provider_id, client_id, acao, enquete_id)
    values (e164, texto, id_provedor, cliente, 'fora_de_contexto', id_enquete);
    return jsonb_build_object(
      'acao', 'fora_de_contexto',
      'responder', public.texto_resposta('fora_de_contexto', null, null)
    );
  end if;

  appt_id := public.proximo_agendamento_da_cliente(cliente);
  if appt_id is null then
    insert into public.whatsapp_inbox (telefone, texto, provider_id, client_id, acao, enquete_id)
    values (e164, texto, id_provedor, cliente, 'sem_horario', id_enquete);
    return jsonb_build_object(
      'acao', 'sem_horario',
      'responder', public.texto_resposta('sem_horario', null, null)
    );
  end if;

  select * into appt from public.appointments where id = appt_id;
  select * into prof from public.professionals where id = appt.professional_id;

  if acao = 'confirma' then
    update public.appointments
    set status = 'confirmado'
    where id = appt_id and status = 'pendente';

    perform public.notificar(
      cliente, 'agendamento_confirmado', 'Horário confirmado',
      coalesce(appt.service_name, 'Seu atendimento') || ' com ' || prof.name ||
        ' dia ' || to_char(appt.date, 'DD/MM') ||
        ' às ' || to_char(appt.start_time, 'HH24:MI') || '.',
      '/', jsonb_build_object('appointment_id', appt_id)
    );

    resposta := jsonb_build_object(
      'acao', 'confirmado',
      'appointment_id', appt_id,
      'responder', public.texto_resposta('confirmado',
                     to_char(appt.date, 'DD/MM') || ' às ' || to_char(appt.start_time, 'HH24:MI'), null)
    );

  else
    update public.appointments
    set status = 'cancelado'
    where id = appt_id;

    resposta := jsonb_build_object(
      'acao', 'cancelado',
      'appointment_id', appt_id,
      'responder', public.texto_resposta('cancelado',
                     to_char(appt.date, 'DD/MM') || ' às ' || to_char(appt.start_time, 'HH24:MI'), null)
    );

    if prof.user_id is not null then
      perform public.notificar(
        prof.user_id, 'agendamento_cancelado', 'Cancelou pelo WhatsApp',
        (select coalesce(full_name, 'A cliente') from public.profiles where id = cliente)
          || ' cancelou ' || to_char(appt.date, 'DD/MM') ||
          ' às ' || to_char(appt.start_time, 'HH24:MI') || '.',
        '/pro', jsonb_build_object('appointment_id', appt_id)
      );
    end if;
  end if;

  insert into public.whatsapp_inbox
    (telefone, texto, provider_id, client_id, acao, appointment_id, enquete_id)
  values (e164, texto, id_provedor, cliente, resposta ->> 'acao', appt_id, id_enquete);

  return resposta;
end;
$$;

revoke execute on function public.receber_resposta_whatsapp(text, text, text, text)
  from public, anon, authenticated;
