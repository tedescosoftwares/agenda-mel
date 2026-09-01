-- =============================================================
-- Agenda Mel — 024: a resposta da cliente mexe na agenda
-- Rode este arquivo no SQL Editor do Supabase (DEPOIS do 023).
--
-- O lembrete termina em pergunta:
--
--     Amanhã tem horário marcado
--     Limpeza de pele com Ana Paula, 31/08 às 10:00.
--     Responda 1 para confirmar ou 2 se precisar remarcar.
--
-- Ela responde "1" e o agendamento confirma sozinho. Responde "2" e
-- cancela — e o gatilho da onda 1 já oferece a vaga para a fila de
-- espera, sem ninguém tocar em nada. Responde "sair" e não recebe
-- mais mensagem nenhuma.
--
-- Tudo pelo telefone, sem login: quem chega aqui é o webhook, e ele
-- entra como service_role. Nenhuma destas funções é exposta à
-- cliente nem ao app.
-- =============================================================

-- 1. Registro do que entrou ----------------------------------------------
-- Guardar a mensagem crua vale ouro no dia em que alguém disser
-- "eu cancelei e vocês cobraram mesmo assim".
create table if not exists public.whatsapp_inbox (
  id uuid primary key default gen_random_uuid(),
  telefone text not null,
  texto text,
  provider_id text unique,
  client_id uuid references public.profiles (id) on delete set null,
  -- sair | confirmado | cancelado | nada | sem_cadastro | sem_horario
  -- | fora_de_contexto
  acao text,
  appointment_id uuid references public.appointments (id) on delete set null,
  recebido_em timestamptz not null default now()
);

create index if not exists inbox_telefone_idx
  on public.whatsapp_inbox (telefone, recebido_em desc);

alter table public.whatsapp_inbox enable row level security;

drop policy if exists "equipe le as respostas" on public.whatsapp_inbox;
create policy "equipe le as respostas"
  on public.whatsapp_inbox for select
  to authenticated
  using (client_id is not null and public.atende_esta_cliente(client_id));

revoke insert, update, delete on public.whatsapp_inbox from authenticated, anon;

-- 2. De telefone para pessoa ---------------------------------------------
create or replace function public.cliente_pelo_telefone(tel text)
returns uuid
language sql
stable
security definer set search_path = public
as $$
  select p.id
  from public.profiles p
  where public.telefone_e164(p.phone) = public.telefone_e164(tel)
  order by p.created_at
  limit 1;
$$;

revoke execute on function public.cliente_pelo_telefone(text)
  from public, anon, authenticated;

-- 3. O próximo horário dela ----------------------------------------------
-- "1" e "2" se referem sempre ao atendimento mais próximo que ainda
-- não aconteceu. É o que ela tem na cabeça quando responde.
create or replace function public.proximo_agendamento_da_cliente(cliente uuid)
returns uuid
language sql
stable
security definer set search_path = public
as $$
  select a.id
  from public.appointments a
  where a.client_id = cliente
    and a.status in ('pendente', 'confirmado')
    and (a.date + a.start_time) > public.agora_local()
  order by a.date, a.start_time
  limit 1;
$$;

revoke execute on function public.proximo_agendamento_da_cliente(uuid)
  from public, anon, authenticated;

-- 4. Sobre o que ela está respondendo ------------------------------------
-- "1" sozinho não quer dizer nada: quer dizer alguma coisa em relação à
-- última mensagem que saiu daqui. Sem isso, um "1" respondendo ao
-- convite de retorno confirmaria um atendimento que ela nem lembra.
create or replace function public.ultimo_assunto_enviado(tel text)
returns text
language sql
stable
security definer set search_path = public
as $$
  select o.kind
  from public.message_outbox o
  where o.telefone = public.telefone_e164(tel)
    and o.status in ('enviado', 'entregue', 'lido')
    and o.enviado_em > now() - interval '48 hours'
  order by o.enviado_em desc
  limit 1;
$$;

revoke execute on function public.ultimo_assunto_enviado(text)
  from public, anon, authenticated;

-- 5. O que a resposta quis dizer -----------------------------------------
create or replace function public.interpretar_resposta(texto text)
returns text
language plpgsql
immutable
as $$
declare
  t text;
begin
  if texto is null then
    return 'nada';
  end if;

  -- tira acento, pontuação e espaço: "Sim!" e "sim" são a mesma coisa
  t := lower(btrim(texto));
  t := translate(t, 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc');
  t := regexp_replace(t, '[^a-z0-9 ]', '', 'g');
  t := btrim(t);

  if t in ('sair', 'parar', 'stop', 'cancelar avisos', 'nao quero mais',
           'descadastrar', 'remover') then
    return 'sair';
  end if;

  if t in ('1', 'sim', 's', 'confirmo', 'confirmado', 'ok', 'certo',
           'isso', 'confirmar', 'positivo', 'estarei la', 'vou') then
    return 'confirma';
  end if;

  if t in ('2', 'nao', 'n', 'remarcar', 'cancelar', 'desmarcar',
           'nao vou', 'nao posso', 'negativo') then
    return 'cancela';
  end if;

  return 'nada';
end;
$$;

revoke execute on function public.interpretar_resposta(text)
  from public, anon, authenticated;

-- 6. A porta de entrada --------------------------------------------------
-- Chamada pela Edge Function do webhook, como service_role. Devolve o
-- que fazer com a resposta — a Edge Function usa isso para escrever de
-- volta no WhatsApp.
-- o 028 troca a assinatura; derrubar as duas antes deixa re-executável
drop function if exists public.receber_resposta_whatsapp(text, text, text);
drop function if exists public.receber_resposta_whatsapp(text, text, text, text);

create or replace function public.receber_resposta_whatsapp(
  tel text,
  texto text,
  id_provedor text default null
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
begin
  if e164 is null then
    return jsonb_build_object('acao', 'ignorado', 'motivo', 'telefone invalido');
  end if;

  -- o mesmo provider_id chegando duas vezes não age duas vezes
  if id_provedor is not null
     and exists (select 1 from public.whatsapp_inbox where provider_id = id_provedor) then
    return jsonb_build_object('acao', 'ignorado', 'motivo', 'repetida');
  end if;

  cliente := public.cliente_pelo_telefone(e164);
  acao := public.interpretar_resposta(texto);

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

    insert into public.whatsapp_inbox (telefone, texto, provider_id, client_id, acao)
    values (e164, texto, id_provedor, cliente, 'sair');

    return jsonb_build_object(
      'acao', 'sair',
      'responder', 'Pronto, não mando mais lembretes por aqui. ' ||
                   'Se mudar de ideia, é só ligar de novo no app.'
    );
  end if;

  -- ------------------------------------------------------------------
  -- Daqui para baixo precisa saber de quem é o telefone
  -- ------------------------------------------------------------------
  if cliente is null then
    insert into public.whatsapp_inbox (telefone, texto, provider_id, acao)
    values (e164, texto, id_provedor, 'sem_cadastro');
    return jsonb_build_object('acao', 'sem_cadastro');
  end if;

  if acao = 'nada' then
    insert into public.whatsapp_inbox (telefone, texto, provider_id, client_id, acao)
    values (e164, texto, id_provedor, cliente, 'nada');
    return jsonb_build_object('acao', 'nada');
  end if;

  -- 1 e 2 só mexem na agenda quando a conversa é sobre um horário.
  -- Respondeu 1 para o convite de retorno? Não confirmamos nada por
  -- conta própria — fica registrado para a profissional ver.
  if public.ultimo_assunto_enviado(e164) is distinct from 'lembrete_agendamento' then
    insert into public.whatsapp_inbox (telefone, texto, provider_id, client_id, acao)
    values (e164, texto, id_provedor, cliente, 'fora_de_contexto');
    return jsonb_build_object(
      'acao', 'fora_de_contexto',
      'responder', 'Recebi! Para marcar ou mudar um horário, é só abrir o app.'
    );
  end if;

  appt_id := public.proximo_agendamento_da_cliente(cliente);
  if appt_id is null then
    insert into public.whatsapp_inbox (telefone, texto, provider_id, client_id, acao)
    values (e164, texto, id_provedor, cliente, 'sem_horario');
    return jsonb_build_object(
      'acao', 'sem_horario',
      'responder', 'Não encontrei nenhum horário marcado no seu nome. ' ||
                   'Se precisar, é só marcar pelo app.'
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
      'responder', 'Confirmado! Te espero dia ' || to_char(appt.date, 'DD/MM') ||
                   ' às ' || to_char(appt.start_time, 'HH24:MI') || '.'
    );

  else
    -- cancela: o gatilho da lista de espera cuida de oferecer a vaga
    update public.appointments
    set status = 'cancelado'
    where id = appt_id;

    resposta := jsonb_build_object(
      'acao', 'cancelado',
      'appointment_id', appt_id,
      'responder', 'Tudo bem, cancelei o seu horário de ' ||
                   to_char(appt.date, 'DD/MM') || ' às ' ||
                   to_char(appt.start_time, 'HH24:MI') ||
                   '. Quando quiser remarcar, é só abrir o app.'
    );

    -- a profissional precisa saber que abriu um buraco na agenda dela
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
    (telefone, texto, provider_id, client_id, acao, appointment_id)
  values (e164, texto, id_provedor, cliente, resposta ->> 'acao', appt_id);

  return resposta;
end;
$$;

revoke execute on function public.receber_resposta_whatsapp(text, text, text)
  from public, anon, authenticated;

-- Por onde responder a ela: o mesmo canal que entregou a última
-- mensagem. Ela respondeu, então a janela de 24h está aberta e a
-- resposta sai sem template e sem custo.
create or replace function public.canal_do_telefone(tel text)
returns table (canal text, identificador text)
language sql
stable
security definer set search_path = public
as $$
  select c.canal, c.identificador
  from public.message_outbox o
  join public.whatsapp_channels c on c.salon_id = o.salon_id
  where o.telefone = public.telefone_e164(tel)
    and o.status in ('enviado', 'entregue', 'lido')
  order by o.enviado_em desc nulls last
  limit 1;
$$;

revoke execute on function public.canal_do_telefone(text)
  from public, anon, authenticated;

-- 7. Status de entrega ---------------------------------------------------
-- O provedor avisa que entregou, que a cliente leu, ou que falhou.
create or replace function public.atualizar_status_envio(
  id_provedor text,
  novo_status text,
  detalhe text default null
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if novo_status not in ('enviado', 'entregue', 'lido', 'falhou') then
    return;
  end if;

  update public.message_outbox
  set status = novo_status,
      erro = case when novo_status = 'falhou' then detalhe else erro end
  where provider_id = id_provedor
    -- nunca volta atrás: "entregue" que chega depois de "lido" é ruído
    and case novo_status
          when 'enviado'  then status in ('enviando')
          when 'entregue' then status in ('enviando', 'enviado')
          when 'lido'     then status in ('enviando', 'enviado', 'entregue')
          when 'falhou'   then status in ('enviando', 'enviado')
        end;
end;
$$;

revoke execute on function public.atualizar_status_envio(text, text, text)
  from public, anon, authenticated;

-- 8. O que a Edge Function chama para pegar trabalho ---------------------
-- Marca como 'enviando' e devolve, numa tacada só, para duas chamadas
-- ao mesmo tempo não pegarem a mesma mensagem.
-- o 025 muda o formato de retorno desta função; derrubar antes deixa
-- o arquivo re-executável mesmo depois dele ter passado
drop function if exists public.puxar_da_fila(integer);

create or replace function public.puxar_da_fila(quantas integer default 20)
returns table (
  id uuid,
  salon_id uuid,
  canal text,
  identificador text,
  telefone text,
  corpo text
)
language plpgsql
security definer set search_path = public
as $$
begin
  return query
  with escolhidas as (
    select o.id
    from public.message_outbox o
    join public.whatsapp_channels c on c.salon_id = o.salon_id
    where o.status = 'na_fila'
      and o.liberado_em <= now()
      and o.tentativas < 4
      and c.ativo
      and c.canal in ('evolution', 'cloud')
    order by o.criado_em
    limit greatest(1, least(coalesce(quantas, 20), 100))
    for update of o skip locked
  ),
  marcadas as (
    update public.message_outbox o
    set status = 'enviando', tentativas = o.tentativas + 1
    from escolhidas e
    where o.id = e.id
    returning o.id, o.salon_id, o.canal, o.telefone, o.corpo
  )
  select m.id, m.salon_id, m.canal, c.identificador, m.telefone, m.corpo
  from marcadas m
  join public.whatsapp_channels c on c.salon_id = m.salon_id;
end;
$$;

revoke execute on function public.puxar_da_fila(integer)
  from public, anon, authenticated;

-- Deu erro no envio: volta para a fila com espera crescente, ou desiste.
create or replace function public.devolver_para_fila(
  mensagem_id uuid,
  motivo text
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  t integer;
begin
  select tentativas into t from public.message_outbox where id = mensagem_id;
  if not found then
    return;
  end if;

  if t >= 4 then
    update public.message_outbox
    set status = 'falhou', erro = motivo
    where id = mensagem_id;
  else
    -- 2, 8, 32 minutos: dá tempo de a instância voltar sozinha
    update public.message_outbox
    set status = 'na_fila',
        erro = motivo,
        liberado_em = now() + make_interval(mins => power(4, t)::integer * 2)
    where id = mensagem_id;
  end if;
end;
$$;

revoke execute on function public.devolver_para_fila(uuid, text)
  from public, anon, authenticated;

-- Erro que não melhora tentando de novo (número errado, fora da janela,
-- conta mal configurada): desiste na hora em vez de gastar 4 tentativas.
create or replace function public.falhar_de_vez(
  mensagem_id uuid,
  motivo text
)
returns void
language sql
security definer set search_path = public
as $$
  update public.message_outbox
  set status = 'falhou', erro = motivo, tentativas = 4
  where id = mensagem_id;
$$;

revoke execute on function public.falhar_de_vez(uuid, text)
  from public, anon, authenticated;

-- Enviou: guarda o id do provedor para casar com o status depois.
create or replace function public.confirmar_envio(
  mensagem_id uuid,
  id_provedor text default null
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  update public.message_outbox
  set status = 'enviado',
      enviado_em = now(),
      provider_id = coalesce(id_provedor, provider_id),
      erro = null
  where id = mensagem_id;
end;
$$;

revoke execute on function public.confirmar_envio(uuid, text)
  from public, anon, authenticated;

-- =============================================================
-- OPCIONAL — deixar a fila andando sozinha
--
-- Sem isto, a fila só é drenada quando alguém chama a Edge Function.
-- Com isto, ela anda de minuto em minuto, e o lembrete de véspera sai
-- às 19h sem ninguém abrir nada.
--
-- Ative as extensões em Database → Extensions (pg_cron e pg_net) e
-- rode o bloco abaixo trocando as duas linhas marcadas.
-- =============================================================

-- create extension if not exists pg_cron;
-- create extension if not exists pg_net;
--
-- select cron.schedule(
--   'agenda-mel-envia-whatsapp',
--   '* * * * *',
--   $cron$
--     select net.http_post(
--       url     := 'https://SEU-PROJETO.supabase.co/functions/v1/enviar-whatsapp',
--       headers := jsonb_build_object(
--         'Content-Type', 'application/json',
--         'Authorization', 'Bearer SUA_SERVICE_ROLE_KEY'
--       ),
--       body    := '{}'::jsonb
--     );
--   $cron$
-- );
--
-- -- e os lembretes de véspera, de hora em hora:
-- select cron.schedule(
--   'agenda-mel-lembretes',
--   '0 * * * *',
--   $cron$ select public.enviar_lembretes(); $cron$
-- );
--
-- -- para conferir:   select * from cron.job;
-- -- para desligar:   select cron.unschedule('agenda-mel-envia-whatsapp');
