-- =============================================================
-- Agenda Mel — 044: silêncio de madrugada não vale para resposta
--
-- A Mel aceitou o horário pelo WhatsApp, o banco confirmou o
-- agendamento, e a cliente não recebeu nada. O aviso não se perdeu: ele
-- está na fila, com liberado_em marcado para as 8h da manhã.
--
-- A janela de silêncio (21h às 8h) foi feita para uma coisa certa:
-- ninguém quer lembrete de robô às 23h. Só que ela estava valendo para
-- TUDO, inclusive para a resposta de uma pergunta que a pessoa acabou
-- de fazer. A cliente pediu um horário às 22h50, a profissional aceitou
-- às 22h55, e a cliente ia descobrir isso às 8h do dia seguinte.
--
-- Pior: a Mel recebeu '✅ Aceito! Já avisei a cliente.' — uma mensagem
-- que não era verdade. Ela desligou o celular achando que estava
-- resolvido.
--
-- A linha que passa a valer:
--
--   FATO QUE MUDA O DIA DELA sai na hora, seja meia-noite ou não.
--     aceitou, recusou, cancelou, marcou, respondeu.
--
--   OFERTA E LEMBRETE esperam amanhecer.
--     lembrete de véspera, convite para voltar, vaga que abriu,
--     pós-atendimento, crédito de indicação.
--
-- Quem escreveu às 22h50 está com o celular na mão. Segurar a resposta
-- dela até as 8h não é educação, é abandono — e ainda por cima quebra a
-- janela de 24h do WhatsApp, que é justamente quando responder é grátis
-- e não precisa de template aprovado.
-- =============================================================

-- 1. A regra ganha a coluna ------------------------------------------------
alter table public.whatsapp_regras
  add column if not exists respeita_silencio boolean not null default true;

comment on column public.whatsapp_regras.respeita_silencio is
  'true: espera passar a janela de silêncio. false: é resposta a algo que a pessoa acabou de fazer, e sai na hora.';

-- 2. Quem responde não espera ---------------------------------------------
update public.whatsapp_regras set respeita_silencio = false
where kind in (
  'pedido_de_aceite',       -- ela tem um cronômetro correndo
  'pedido_aceito',          -- a cliente está esperando esta resposta
  'pedido_recusado',
  'novo_agendamento',       -- acabou de entrar na agenda dela
  'cancelou_comigo',
  'profissional_cancelou',  -- o dia da cliente mudou; ela precisa saber hoje
  'agendamento_cancelado',
  'agendamento_confirmado',
  'pedido_pelo_whatsapp',
  'resposta_do_bot'
);

-- E quem toma a iniciativa continua esperando. Explícito de propósito:
-- uma regra nova nasce com respeita_silencio = true, que é o lado seguro.
update public.whatsapp_regras set respeita_silencio = true
where kind in (
  'lembrete_agendamento',
  'pos_atendimento',
  'convite_retorno',
  'vaga_disponivel',
  'agenda_adiantada',
  'indicacao_creditada'
);

-- 3. A fila passa a olhar a coluna ----------------------------------------
-- A assinatura é a de SETE argumentos, a que o 029 deixou. Recriar a de
-- seis (a original do 023) não substituiria nada: criaria uma segunda
-- função com o mesmo nome, e notificar() continuaria chamando a antiga.
-- O ./testar.sh pegou exatamente isso — a mensagem seguia presa.
drop function if exists public.enfileirar_whatsapp(uuid, uuid, text, text, uuid, uuid);

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
    return null;                       -- sem telefone utilizável, fica só no app
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

  -- Janela de silêncio. Dois motivos para NÃO esperar:
  --   • canal manual: quem toca em enviar é gente, e segurar a mensagem
  --     só a faria sumir da lista dela até as 8h
  --   • a regra diz que isto é resposta, não iniciativa (coluna nova)
  if canal.canal = 'manual' or not regra.respeita_silencio then
    libera := now();
  elsif canal.silencio_inicio < canal.silencio_fim then
    if agora::time >= canal.silencio_inicio and agora::time < canal.silencio_fim then
      libera := ((agora::date + canal.silencio_fim) at time zone 'America/Sao_Paulo');
    end if;
  else
    -- faixa que atravessa a meia-noite (o caso normal: 21h às 8h)
    if agora::time >= canal.silencio_inicio then
      libera := ((agora::date + 1 + canal.silencio_fim) at time zone 'America/Sao_Paulo');
    elsif agora::time < canal.silencio_fim then
      libera := ((agora::date + canal.silencio_fim) at time zone 'America/Sao_Paulo');
    end if;
  end if;

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

-- 4. Soltar o que já ficou preso ------------------------------------------
-- Mensagens que entraram na fila antes desta migração estão com
-- liberado_em de manhã. As que são resposta saem agora.
update public.message_outbox o
set liberado_em = now()
from public.whatsapp_regras r
where r.kind = o.kind
  and not r.respeita_silencio
  and o.status = 'na_fila'
  and o.liberado_em > now();

-- 5. Ver o que o silêncio está segurando ----------------------------------
create or replace function public.presas_pelo_silencio(salao uuid default null)
returns table (telefone text, tipo text, sai_as timestamptz, corpo text)
language sql
stable
security definer set search_path = public
as $$
  select o.telefone, o.kind, o.liberado_em, left(o.corpo, 60)
  from public.message_outbox o
  where o.status = 'na_fila'
    and o.liberado_em > now()
    and (salao is null or o.salon_id = salao)
  order by o.liberado_em
  limit 20;
$$;

revoke execute on function public.presas_pelo_silencio(uuid) from public, anon;
grant execute on function public.presas_pelo_silencio(uuid) to authenticated;

-- 6. Não dizer para a Mel que avisou quando não avisou --------------------
-- A resposta '✅ Aceito! Já avisei a cliente.' era escrita antes de
-- qualquer verificação: saía igual se a cliente não tivesse telefone, se
-- tivesse desmarcado os avisos, ou se o teto do dia tivesse estourado.
-- Ela desliga o celular achando que está resolvido, e a cliente aparece
-- (ou não aparece) sem saber de nada.
--
-- Agora resolver_aceite() devolve se a mensagem entrou mesmo na fila, e
-- quem responde para a profissional usa isso.
create or replace function public.resolver_aceite(appt uuid, aceitou boolean)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  ac public.aceites%rowtype;
  a public.appointments%rowtype;
  cliente uuid;
  aviso uuid;
  saiu boolean := false;
begin
  select * into ac from public.aceites
  where appointment_id = appt and resultado is null;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'pedido já resolvido');
  end if;

  select * into a from public.appointments where id = appt;
  cliente := a.client_id;

  -- este caminho tem texto próprio, então o gatilho não manda o dele por cima
  perform public.silenciar_gatilho();

  if aceitou then
    update public.appointments set status = 'confirmado'
    where id = appt and status = 'pendente';
    aviso := public.notificar(cliente, 'pedido_aceito', 'Horário confirmado', null, '/',
      jsonb_build_object('appointment_id', appt, 'professional_id', ac.professional_id));
  else
    update public.appointments set status = 'cancelado' where id = appt;
    aviso := public.notificar(cliente, 'pedido_recusado', 'Horário não confirmado', null, '/',
      jsonb_build_object('appointment_id', appt, 'professional_id', ac.professional_id));
  end if;

  -- entrou na fila? é a única prova de que a cliente vai receber
  select exists (
    select 1 from public.message_outbox
    where notification_id = aviso and status <> 'cancelado'
  ) into saiu;

  update public.aceites
  set resultado = case when aceitou then 'aceito' else 'recusado' end,
      resolvido_em = now()
  where appointment_id = appt;

  return jsonb_build_object('ok', true,
    'resultado', case when aceitou then 'aceito' else 'recusado' end,
    'avisou_cliente', saiu);
end;
$$;

revoke execute on function public.resolver_aceite(uuid, boolean)
  from public, anon, authenticated;

-- E a resposta que a profissional lê passa a contar a verdade.
create or replace function public.receber_mensagem(
  tel text,
  texto text,
  id_provedor text default null,
  id_enquete text default null,
  intencao_do_modelo text default null,
  salao uuid default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  e164 text := public.telefone_e164(tel);
  bot_ligado boolean := false;
  tem_conversa boolean := false;
  pedido uuid;
  acao text;
  r jsonb;
  avisou boolean;
begin
  if e164 is null then
    return jsonb_build_object('acao', 'ignorado', 'motivo', 'telefone invalido');
  end if;

  if id_provedor is not null
     and exists (select 1 from public.whatsapp_inbox where provider_id = id_provedor) then
    return jsonb_build_object('acao', 'ignorado', 'motivo', 'repetida');
  end if;

  -- (a) tem pedido esperando resposta DESTE número?
  select ac.appointment_id into pedido
  from public.aceites ac
  where ac.telefone_prof = e164 and ac.resultado is null and ac.expira_em > now()
  order by ac.pedido_em
  limit 1;

  if pedido is not null then
    acao := public.interpretar_resposta(texto);
    if acao = 'nada' and intencao_do_modelo is not null then
      acao := public.acao_da_intencao(intencao_do_modelo);
    end if;

    if acao in ('confirma', 'cancela', 'remarca') then
      r := public.resolver_aceite(pedido, acao = 'confirma');
      avisou := coalesce((r ->> 'avisou_cliente')::boolean, false);

      insert into public.whatsapp_inbox
        (telefone, texto, provider_id, acao, appointment_id, via, intencao_ia)
      values (e164, texto, id_provedor, 'aceite:' || coalesce(r ->> 'resultado','?'),
              pedido, 'regra', intencao_do_modelo);

      return jsonb_build_object('acao', 'aceite_' || coalesce(r ->> 'resultado','?'),
        'appointment_id', pedido,
        'responder', case
          when acao = 'confirma' and avisou
            then '✅ Aceito! Já avisei a cliente. 💛'
          when acao = 'confirma'
            then '✅ Aceito e confirmado na agenda.' || E'\n\n'
                 || '⚠️ Não consegui avisar a cliente pelo WhatsApp — '
                 || 'confira o telefone dela no app.'
          when avisou
            then '👍 Recusado. Avisei a cliente e o horário voltou a ficar livre.'
          else '👍 Recusado, e o horário voltou a ficar livre.' || E'\n\n'
               || '⚠️ Não consegui avisar a cliente pelo WhatsApp — '
               || 'confira o telefone dela no app.'
        end);
    end if;
    -- não era resposta ao pedido: segue o baile
  end if;

  select c.usa_bot into bot_ligado
  from public.whatsapp_channels c where c.salon_id = salao;

  select exists (select 1 from public.conversas
                 where telefone = e164 and expira_em > now()) into tem_conversa;

  -- (b) conversa aberta ganha do interpretador: no meio de um menu, "2"
  --     é a segunda opção, nunca "cancele meu horário"
  if tem_conversa or (coalesce(bot_ligado, false)
                      and public.acao_da_intencao(intencao_do_modelo) = 'quer_agendar') then
    r := public.avancar_conversa(e164, texto, salao);

    if (r ->> 'acao') <> 'sem_cadastro' then
      insert into public.whatsapp_inbox
        (telefone, texto, provider_id, client_id, acao, appointment_id, via, intencao_ia)
      values (e164, texto, id_provedor, public.cliente_pelo_telefone(e164),
              'bot:' || coalesce(r ->> 'acao', '?'),
              nullif(r ->> 'appointment_id', '')::uuid,
              case when tem_conversa then 'bot' else 'ia' end, intencao_do_modelo);
      return r;
    end if;
  end if;

  -- (c) o caminho de sempre
  return public.receber_resposta_whatsapp(
    e164, texto, id_provedor, id_enquete, intencao_do_modelo, salao);
end;
$$;

revoke execute on function
  public.receber_mensagem(text, text, text, text, text, uuid)
  from public, anon, authenticated;
