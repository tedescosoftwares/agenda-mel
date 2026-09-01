-- =============================================================
-- Agenda Mel — 028: texto por padrão, e o primeiro voto vale
-- Rode este arquivo no SQL Editor do Supabase (DEPOIS do 027).
--
-- Duas decisões de produto, depois do teste no aparelho:
--
-- 1. ENQUETE NÃO É CONFIRMAÇÃO. Ela renderiza em todo lugar, mas na
--    tela da cliente diz "pesquisa", com "1 voto" e "ver votos" em
--    volta. Sobre um horário marcado, não faz sentido. Então o padrão
--    na Evolution volta a ser TEXTO com "Responda 1 para confirmar ou
--    2 se precisar remarcar" — feio, honesto, e chega. A enquete fica
--    disponível como estilo para outro uso (pesquisa com clientes).
--    Botão de verdade é coisa da API oficial (canal cloud).
--
-- 2. O PRIMEIRO VOTO VALE. Onde a enquete for usada, o WhatsApp deixa
--    trocar o voto e cada troca chega como evento novo. Sem trava,
--    "Confirmar" e depois "Preciso remarcar" confirmava e cancelava o
--    mesmo horário em sequência. Agora o primeiro age; os seguintes
--    recebem "já registrado, fale com a profissional".
-- =============================================================

-- 1. Estilo 'texto' como padrão; 'lista' sai (a 2.3.7 recusa) ------------
alter table public.whatsapp_channels drop constraint if exists whatsapp_channels_estilo_botao_check;
update public.whatsapp_channels set estilo_botao = 'texto' where estilo_botao in ('enquete', 'lista');
alter table public.whatsapp_channels alter column estilo_botao set default 'texto';
alter table public.whatsapp_channels
  add constraint whatsapp_channels_estilo_botao_check
  check (estilo_botao in ('texto', 'enquete', 'nativo'));

comment on column public.whatsapp_channels.estilo_botao is
  'texto = "Responda 1 ou 2" (padrão na Evolution; funciona sempre); '
  'enquete = poll do WhatsApp (renderiza, mas parece pesquisa — para '
  'outro uso); nativo = botão interativo (só a Cloud API desenha). '
  'No canal cloud, qualquer estilo vira botão de verdade.';

-- botão só quando vai renderizar como botão, ou quando o salão pediu
-- a enquete de propósito
create or replace function public.canal_manda_botao(salao uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select coalesce(
    (select c.usa_botoes
            and (c.canal = 'cloud'
                 or (c.canal = 'evolution' and c.estilo_botao = 'enquete'))
     from public.whatsapp_channels c
     where c.salon_id = salao),
    false);
$$;

revoke execute on function public.canal_manda_botao(uuid)
  from public, anon, authenticated;

-- 2. O primeiro voto vale --------------------------------------------------
-- (o 029 recria enfileirar_whatsapp; nada a derrubar aqui)

alter table public.whatsapp_inbox
  add column if not exists enquete_id text;

create index if not exists inbox_enquete_idx
  on public.whatsapp_inbox (enquete_id)
  where enquete_id is not null;

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
          'Sua resposta já foi registrada'
          || case when ja_votou.acao = 'confirmado' then ' (horário confirmado)' else ' (horário cancelado)' end
          || '. Para mudar, é só falar aqui com a ' || coalesce(prof.name, 'profissional') || '.'
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
      'responder', 'Pronto, não mando mais lembretes por aqui. ' ||
                   'Se mudar de ideia, é só ligar de novo no app.'
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
      'responder', 'Recebi! Para marcar ou mudar um horário, é só abrir o app.'
    );
  end if;

  appt_id := public.proximo_agendamento_da_cliente(cliente);
  if appt_id is null then
    insert into public.whatsapp_inbox (telefone, texto, provider_id, client_id, acao, enquete_id)
    values (e164, texto, id_provedor, cliente, 'sem_horario', id_enquete);
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
