-- 246 · A assistente com uma conversa por vez, só com o histórico do salão; textos da casa e lembrete do dia certo (3.98.4)
--
-- O que um teste de verdade mostrou (a cliente trocando um horário e cancelando outro pelo WhatsApp):
--   • duas mensagens seguidas ("Não entendi", "Remarcou meu atendimento") viravam duas respostas que se contradiziam:
--     cada uma rodava ao mesmo tempo, sem ver o que a outra fez. Agora há uma vez por número (assistente_vez): a
--     mensagem espera a anterior terminar e, se chegou outra mais nova, deixa para ela responder as duas;
--   • o histórico que a assistente lê juntava tudo o que o número trocou com a MIMO nas últimas 24 h, de qualquer salão
--     (e do número da casa). Agora cada mensagem recebida fica marcada com o salão e o histórico é só deste salão;
--   • o aviso para a dona, quando o celular dela é o próprio número do salão, ia do salão para ele mesmo (cai em
--     "Mensagens para mim", sem notificação) e, se falhava, saía pelo número da MIMO e chegava no salão como cliente.
--     Agora fica só no app (sino e push);
--   • "Remarcado! A Melissa aceitou a troca", quando quem confirmou foi a casa. Agora, decisão da casa tem texto da
--     casa ("A troca está confirmada", "Não vamos conseguir atender…", "Te esperamos!");
--   • "Amanhã tem horário marcado" para um horário de hoje, logo depois da troca. O lembrete agora é só de horário
--     confirmado, não sai para quem marcou ou trocou há menos de 3 horas, e o título diz Hoje / Amanhã pelo dia em que a
--     mensagem sai (depois do silêncio da noite, inclusive);
--   • freio de laço: mais de 15 respostas para o mesmo número em 5 minutos, a assistente para (é robô com robô).

-- 1. A mensagem recebida sabe de que salão é ---------------------------------------------------------------------
alter table public.whatsapp_inbox add column if not exists salon_id uuid;
create index if not exists whatsapp_inbox_salao_quando on public.whatsapp_inbox (salon_id, recebido_em desc);

create or replace function public.inbox_do_salao()
returns trigger
language plpgsql
as $$
begin
  if new.salon_id is null then
    new.salon_id := nullif(current_setting('mimo.salao_da_mensagem', true), '')::uuid;
  end if;
  return new;
end;
$$;

drop trigger if exists tg_inbox_do_salao on public.whatsapp_inbox;
create trigger tg_inbox_do_salao
  before insert on public.whatsapp_inbox
  for each row execute function public.inbox_do_salao();

-- 2. Uma conversa por vez por número ------------------------------------------------------------------------------
-- 'sua': pode responder; 'ocupada': outra mensagem desse número ainda está sendo respondida (espere e tente de novo);
-- 'nova': chegou mensagem mais nova desse número para este salão, e é ela quem responde as duas.
create table if not exists public.assistente_vez (
  salon_id uuid not null,
  telefone text not null,
  msg_id text,
  desde timestamptz not null default now(),
  primary key (salon_id, telefone)
);
alter table public.assistente_vez enable row level security;
revoke all on public.assistente_vez from public, anon, authenticated;

create or replace function public.assistente_pegar_vez(salao uuid, tel text, msg text default null)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  e164 text := coalesce(public.telefone_e164(tel), tel);
  minha timestamptz;
begin
  if msg is not null then
    select i.recebido_em into minha from public.whatsapp_inbox i where i.provider_id = msg order by i.recebido_em limit 1;
    if minha is not null and exists (
      select 1 from public.whatsapp_inbox i
       where i.salon_id = salao and public.telefone_chave(i.telefone) = public.telefone_chave(e164)
         and i.recebido_em > minha and i.provider_id is distinct from msg) then
      return 'nova';
    end if;
  end if;
  insert into public.assistente_vez (salon_id, telefone, msg_id, desde) values (salao, e164, msg, now())
  on conflict (salon_id, telefone) do update set msg_id = excluded.msg_id, desde = now()
   where public.assistente_vez.desde < now() - interval '90 seconds';   -- vez esquecida (a função caiu no meio)
  if found then return 'sua'; end if;
  return 'ocupada';
end;
$$;

create or replace function public.assistente_soltar_vez(salao uuid, tel text, msg text default null)
returns void
language sql
security definer set search_path = public
as $$
  delete from public.assistente_vez v
   where v.salon_id = salao and v.telefone = coalesce(public.telefone_e164(tel), tel) and v.msg_id is not distinct from msg;
$$;

revoke execute on function public.assistente_pegar_vez(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.assistente_soltar_vez(uuid, text, text) from public, anon, authenticated;

-- 3. O título do lembrete pelo dia em que a mensagem sai ------------------------------------------------------------
-- Igual à conta da fila (enfileirar_whatsapp): no silêncio que atravessa a meia-noite, o que entra à noite sai de manhã.
create or replace function public.titulo_do_lembrete(appt uuid)
returns text
language plpgsql
stable security definer set search_path = public
as $$
declare
  d date; c public.whatsapp_channels%rowtype; agora timestamp := public.agora_local(); envio date; silencio boolean;
begin
  select a.date into d from public.appointments a where a.id = appt;
  if d is null then return 'Lembrete do seu horário'; end if;
  select ch.* into c from public.whatsapp_channels ch join public.appointments a on a.salon_id = ch.salon_id where a.id = appt;
  select coalesce(r.respeita_silencio, true) into silencio from public.whatsapp_regras r where r.kind = 'lembrete_agendamento';
  envio := agora::date;
  if coalesce(silencio, true) and c.salon_id is not null and c.canal <> 'manual'
     and c.silencio_inicio > c.silencio_fim and agora::time >= c.silencio_inicio then
    envio := envio + 1;
  end if;
  return case when d = envio then 'Hoje tem horário marcado'
              when d = envio + 1 then 'Amanhã tem horário marcado'
              else 'Lembrete do seu horário' end;
end;
$$;

-- 4. A mensagem que chega fica marcada com o salão (receber_mensagem) ------------------------------------------------
CREATE OR REPLACE FUNCTION public.receber_mensagem(tel text, texto text, id_provedor text DEFAULT NULL::text, id_enquete text DEFAULT NULL::text, intencao_do_modelo text DEFAULT NULL::text, salao uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  e164 text := public.telefone_e164(tel);
  bot_ligado boolean := false;
  tem_conversa boolean := false;
  pedido uuid; acao text; r jsonb; avisou boolean; extra text; base text;
begin
  if e164 is null then return jsonb_build_object('acao', 'ignorado', 'motivo', 'telefone invalido'); end if;
  -- 246: o que chegar daqui em diante, nesta mensagem, é deste salão (o gatilho do whatsapp_inbox grava o salon_id)
  perform set_config('mimo.salao_da_mensagem', coalesce(salao::text, ''), true);
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

  -- 237 (3.95.2): a assistente desligada é desligada de verdade. Nenhum atendimento automático à cliente: nem a IA,
  -- nem o menu de marcar, nem o "não entendi". A mensagem fica registrada para a equipe responder pelo celular. Só vale o
  -- que responde a uma pergunta nossa: o 1/2 do lembrete e o SAIR (este sempre; o aceite da profissional, acima, também).
  -- 239: a conversa que a assistente encerrou (ofensiva, fora do assunto) também fica em silêncio até a pausa acabar
  if salao is not null and (
       not coalesce((select c.usa_ia and c.numero_proprio from public.whatsapp_channels c where c.salon_id = salao), false)
       or exists (select 1 from public.bot_pausas p where p.telefone = e164 and p.salon_id = salao and p.ate > now() and p.motivo like 'encerrada%')) then
    acao := public.interpretar_resposta(texto);
    if acao in ('sair', 'confirma', 'cancela', 'remarca') then
      r := public.receber_resposta_whatsapp(e164, texto, id_provedor, id_enquete, null, salao);
      if (r ->> 'acao') in ('sair', 'confirmado', 'cancelado', 'remarcado', 'voto_repetido') then return r; end if;
      return r - 'responder';   -- não era resposta a um lembrete: fica registrada, sem resposta
    end if;
    if exists (select 1 from public.bot_pausas p where p.telefone = e164 and p.salon_id = salao and p.ate > now() and p.motivo like 'encerrada%') then
      insert into public.whatsapp_inbox (telefone, texto, provider_id, client_id, acao, enquete_id, via)
      values (e164, texto, id_provedor, public.cliente_pelo_telefone(e164), 'conversa_encerrada', id_enquete, 'regra');
      return jsonb_build_object('acao', 'conversa_encerrada');
    end if;
    insert into public.whatsapp_inbox (telefone, texto, provider_id, client_id, acao, enquete_id, via)
    values (e164, texto, id_provedor, public.cliente_pelo_telefone(e164), 'assistente_desligada', id_enquete, 'regra');
    return jsonb_build_object('acao', 'assistente_desligada');
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
$function$;

-- 5. O histórico da assistente só com este salão, e o freio de laço (bot_contexto) -----------------------------------
CREATE OR REPLACE FUNCTION public.bot_contexto(salao uuid, tel text, instancia text DEFAULT NULL::text, sem_espera boolean DEFAULT false, rascunho jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  e164 text := public.telefone_e164(tel);
  cli uuid;
  s record; c record; canal record;
  agora timestamptz := now();
  sp timestamp := (now() at time zone 'America/Sao_Paulo');
  dias text[] := array['domingo','segunda-feira','terça-feira','quarta-feira','quinta-feira','sexta-feira','sábado'];
  historico jsonb := '[]'::jsonb; proximos jsonb := '[]'::jsonb; pausado boolean; gastas integer := 0;
  ensaio boolean := rascunho is not null;
  ass jsonb; proprio boolean := false; aberto boolean;
  cliente jsonb;
  recado text;
begin
  select * into s from public.salons where id = salao;
  if not found then return jsonb_build_object('permitido', false, 'motivo', 'salao_desconhecido'); end if;
  select * into canal from public.whatsapp_channels where salon_id = salao;
  ass := public.assistente_config(salao);
  aberto := public.salao_aberto_agora(salao);
  recado := canal.orientacao_ia;

  if ensaio then
    if jsonb_typeof(rascunho -> 'assistente') = 'object' then
      ass := ass || coalesce((select jsonb_object_agg(e.k, e.v) from jsonb_each(rascunho -> 'assistente') e(k, v)
                               where e.k in ('nome', 'tom', 'emojis', 'tratamento', 'tamanho', 'preco', 'pode_marcar', 'pode_remarcar', 'pode_cancelar', 'saudacao')), '{}'::jsonb);
    end if;
    if rascunho ? 'recado' then recado := nullif(btrim(coalesce(rascunho ->> 'recado', '')), ''); end if;
    -- o teste mostra como ela fala no número do salão (é lá que nome e tom valem)
    proprio := true;
    if (select count(*) from public.ia_chamadas i where i.salon_id = salao and i.ensaio and i.criado_em > now() - interval '1 hour') >= 40 then
      return jsonb_build_object('permitido', false, 'motivo', 'teto_do_teste');
    end if;
    cliente := jsonb_build_object('id', '00000000-0000-0000-0000-000000000000', 'nome', coalesce(nullif(btrim(rascunho ->> 'cliente_nome'), ''), 'Cliente de teste'),
                                  'primeiro_nome', nullif(split_part(btrim(coalesce(rascunho ->> 'cliente_nome', '')), ' ', 1), ''), 'vinculada', true);
  else
    if canal.salon_id is null or not canal.ativo or not coalesce(canal.usa_ia, false) then
      return jsonb_build_object('permitido', false, 'motivo', 'ia_desligada');
    end if;
    if coalesce((select valor from public.config_publica where chave = 'ia_agente'), 'ligado') <> 'ligado' then
      return jsonb_build_object('permitido', false, 'motivo', 'agente_desligado');
    end if;
    -- 3.95.1: a assistente só atende salão que conectou o próprio WhatsApp (o número da MIMO é só reserva de envio)
    if not coalesce(canal.numero_proprio, false) then
      return jsonb_build_object('permitido', false, 'motivo', 'sem_numero_proprio');
    end if;
    select exists (select 1 from public.bot_pausas p where p.telefone = e164 and p.salon_id = salao and p.ate > now()) into pausado;
    if pausado then return jsonb_build_object('permitido', false, 'motivo', 'pausado_para_humano'); end if;
    -- 246: freio de laço: muitas respostas para o mesmo número em poucos minutos é robô conversando com robô
    if (select count(*) from public.message_outbox o
         where o.salon_id = salao and o.kind = 'agente' and public.telefone_chave(o.telefone) = public.telefone_chave(e164)
           and o.enviado_em > now() - interval '5 minutes') >= 15 then
      return jsonb_build_object('permitido', false, 'motivo', 'muitas_respostas');
    end if;
    gastas := coalesce(public.ia_gastas_hoje(salao), 0);
    if gastas >= coalesce(canal.teto_ia_diario, 200) then
      return jsonb_build_object('permitido', false, 'motivo', 'teto_do_dia');
    end if;

    proprio := coalesce(canal.numero_proprio, false) and (instancia is null or canal.identificador = instancia);
    -- quando responde (só no número próprio: no da casa a equipe nem vê a conversa)
    if proprio and not coalesce(sem_espera, false) then
      if ass ->> 'quando' = 'fora_do_horario' and aberto then
        return jsonb_build_object('permitido', false, 'motivo', 'em_expediente');
      end if;
      if ass ->> 'quando' = 'sem_resposta' and aberto then
        return jsonb_build_object('permitido', false, 'motivo', 'esperar',
                                  'responder_em', now() + make_interval(mins => coalesce((ass ->> 'espera_min')::int, 10)));
      end if;
    end if;

    cli := public.cliente_pelo_telefone(tel);
    if cli is not null then select id, full_name, phone into c from public.profiles where id = cli; end if;

    select coalesce(jsonb_agg(jsonb_build_object('quem', x.quem, 'texto', x.texto, 'quando', x.quando) order by x.quando), '[]'::jsonb)
      into historico
    from (
      select * from (
        select 'cliente' as quem, i.texto, i.recebido_em as quando from public.whatsapp_inbox i
         where public.telefone_chave(i.telefone) = public.telefone_chave(e164) and i.recebido_em > agora - interval '24 hours'
           and i.salon_id = salao   -- 246: só a conversa com este salão
        union all
        select 'mimo', o.corpo, coalesce(o.enviado_em, o.liberado_em) from public.message_outbox o
         where public.telefone_chave(o.telefone) = public.telefone_chave(e164) and o.status in ('enviado','entregue','lido')
           and o.salon_id = salao   -- 246: só o que este salão mandou
           and coalesce(o.enviado_em, o.liberado_em) > agora - interval '24 hours'
      ) h order by h.quando desc limit 12
    ) x;

    if cli is not null then
      select coalesce(jsonb_agg(jsonb_build_object(
               'appointment_id', a.id, 'servico', coalesce(a.service_name, sv.name), 'profissional', pr.name, 'profissional_id', pr.id,
               'dia', to_char(a.date, 'YYYY-MM-DD'), 'dia_semana', dias[extract(dow from a.date)::int + 1],
               'hora', to_char(a.start_time, 'HH24:MI'), 'status', a.status) order by a.date, a.start_time), '[]'::jsonb)
        into proximos
      from public.appointments a
      join public.professionals pr on pr.id = a.professional_id
      left join public.services sv on sv.id = a.service_id
      where a.client_id = cli and a.salon_id = salao and a.status in ('pendente', 'confirmado')
        and (a.date + a.start_time) >= sp - interval '1 hour'
      limit 6;
      cliente := jsonb_build_object('id', cli, 'nome', c.full_name,
                   'primeiro_nome', nullif(split_part(coalesce(c.full_name, ''), ' ', 1), ''),
                   'vinculada', exists (select 1 from public.vinculos v where v.client_id = cli and v.salon_id = salao and v.saiu_em is null));
    end if;
  end if;

  return jsonb_build_object(
    'permitido', true,
    'ensaio', ensaio,
    'provedor', coalesce((select valor from public.config_publica where chave = 'ia_provedor'), 'claude'),
    'modelo', coalesce((select valor from public.config_publica where chave = 'ia_modelo'), 'openai/gpt-oss-120b'),
    'modelo_claude', coalesce((select valor from public.config_publica where chave = 'ia_modelo_claude'), 'claude-haiku-5-5'),
    'orientacao', coalesce(public.modelo_editado('ia.orientacao'), (select padrao from public.modelos_de_mensagem where chave = 'ia.orientacao')),
    'orientacao_salao', recado,
    'assistente', ass,
    'numero_proprio', proprio,
    'salao', jsonb_build_object('id', s.id, 'nome', s.name, 'cidade', s.city, 'endereco', s.address, 'tipo', s.tipo,
                                'app', rtrim(coalesce(s.app_url, public.app_base()), '/'),
                                'horario', public.salao_horario_texto(salao), 'aberto_agora', aberto),
    'agora', jsonb_build_object('data', to_char(sp, 'YYYY-MM-DD'), 'hora', to_char(sp, 'HH24:MI'),
                                'dia_semana', dias[extract(dow from sp)::int + 1], 'texto', to_char(sp, 'DD/MM/YYYY HH24:MI')),
    'cliente', cliente,
    'proximos', coalesce(proximos, '[]'::jsonb),
    'historico', coalesce(historico, '[]'::jsonb),
    'gastas_hoje', gastas);
end;
$function$;

-- 6. O salão não manda WhatsApp para o próprio número (enfileirar_whatsapp) ------------------------------------------
CREATE OR REPLACE FUNCTION public.enfileirar_whatsapp(aviso_id uuid, destinatario uuid, tipo text, texto text, prof uuid DEFAULT NULL::uuid, appt uuid DEFAULT NULL::uuid, cabecalho text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- 246: quem recebe é o próprio número do salão (a dona que pareou o celular dela): mensagem para si mesmo não avisa
  -- ninguém (cai em "Mensagens para mim", sem notificação) e, se falhar, a reserva da MIMO mandaria do número da casa,
  -- que chega no salão como se fosse cliente. Fica só no app (sino e push).
  if canal.numero_proprio and canal.numero_exibicao is not null
     and public.telefone_chave(canal.numero_exibicao) = public.telefone_chave(tel) then
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
$function$;

-- 7. Lembrete: só confirmado, não logo depois de marcar, título do dia certo (enviar_lembretes) ----------------------
CREATE OR REPLACE FUNCTION public.enviar_lembretes()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  a record;
  agora timestamp := public.agora_local();
  enviados integer := 0;
begin
  for a in
    select ap.id, ap.client_id, ap.date, ap.start_time, ap.professional_id,
           coalesce(ap.service_name, s.name) as servico,
           p.name as profissional, p.slug, p.reminder_hours_before
    from public.appointments ap
    join public.professionals p on p.id = ap.professional_id
    left join public.services s on s.id = ap.service_id
    join public.profiles c on c.id = ap.client_id
    -- 246: só horário confirmado (pedido ainda aberto não pede "responda 1 pra confirmar"), e não para quem marcou ou
    -- trocou há menos de 3 horas (acabou de receber a confirmação; o lembrete vinha junto, dizendo "amanhã" para hoje)
    where ap.status = 'confirmado'
      and ap.created_at < now() - interval '3 hours'
      and ap.reminder_sent_at is null
      and ap.client_id is not null
      and c.accepts_reminders
      and p.reminder_hours_before > 0
      and (ap.date + ap.start_time) > agora
      and (ap.date + ap.start_time)
          <= agora + make_interval(hours => p.reminder_hours_before)
    limit 200
  loop
    perform public.notificar(
      a.client_id,
      'lembrete_agendamento',
      case when a.date = agora::date then 'Hoje tem horário marcado'
           when a.date = agora::date + 1 then 'Amanhã tem horário marcado'
           else 'Lembrete do seu horário' end,
      a.servico || ' com ' || a.profissional || ' dia '
        || to_char(a.date, 'DD/MM') || ' às ' || to_char(a.start_time, 'HH24:MI') || '.',
      '/',
      jsonb_build_object('appointment_id', a.id),
      (a.date + a.start_time) at time zone 'America/Sao_Paulo'
    );

    update public.appointments set reminder_sent_at = now() where id = a.id;

    insert into public.client_nudges (professional_id, client_id, kind, appointment_id)
    values (a.professional_id, a.client_id, 'lembrete', a.id);

    enviados := enviados + 1;
  end loop;

  return enviados;
end;
$function$;

-- 8. O {titulo} do lembrete editado é o do dia em que ele sai (montar_texto_whatsapp) --------------------------------
CREATE OR REPLACE FUNCTION public.montar_texto_whatsapp(tipo text, titulo text, corpo text, appt uuid, prof uuid, cliente uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    'titulo', case when tipo = 'lembrete_agendamento' and appt is not null then public.titulo_do_lembrete(appt) else titulo end, 'corpo', corpo);
  return public.renderizar_modelo(editado, vars);
end;
$function$;

-- 9. Quando a casa decidiu, o texto é da casa; o lembrete com o dia certo (montar_texto_padrao) ----------------------
CREATE OR REPLACE FUNCTION public.montar_texto_padrao(tipo text, titulo text, corpo text, appt uuid, prof uuid, cliente uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  d_data date; d_hora time; servico text;
  prof_nome text; prof_slug text; base text;
  link text; link_app text; nome_cliente text;
  nome_na_agenda text; tel_na_agenda text;
  quando text; quando_longo text; prazo integer;
  origem uuid; antes_data date; antes_hora time; quando_antes text;
  desistiu boolean := false;
  pela_casa boolean := false;
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

    -- 246: quem decidiu foi a casa (o pedido era só dela, ou o salão confirma e não houve pedido para a profissional)
    pela_casa := exists (select 1 from public.aceites x where x.appointment_id = appt and x.so_a_casa)
                 or (not exists (select 1 from public.aceites x where x.appointment_id = appt)
                     and exists (select 1 from public.appointments ap2 join public.salons sl2 on sl2.id = ap2.salon_id
                                 where ap2.id = appt and sl2.aceite_modo = 'casa'));

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
    if pela_casa then
      return
        '✅ *Confirmado!*' || E'\n\n'
        || coalesce('Oi, ' || nome_cliente || '! ', '') || 'Seu horário está confirmado:' || E'\n\n'
        || '✨ ' || coalesce(servico, 'Seu atendimento') || E'\n'
        || '👩 com *' || coalesce(prof_nome, 'a profissional') || '*' || E'\n'
        || '🗓️ ' || coalesce(quando_longo, '') || E'\n\n'
        || 'Te esperamos! 💛';
    end if;
    return
      '✅ *Confirmado!*' || E'\n\n'
      || coalesce('Oi, ' || nome_cliente || '! ', '')
      || 'A *' || coalesce(prof_nome, 'profissional') || '* aceitou:' || E'\n\n'
      || '✨ ' || coalesce(servico, 'Seu atendimento') || E'\n'
      || '🗓️ ' || coalesce(quando_longo, '') || E'\n\n'
      || 'Te espero! 💛';

  when 'pedido_recusado' then
    if pela_casa then
      return
        '😔 *Não deu dessa vez*' || E'\n\n'
        || coalesce('Oi, ' || nome_cliente || '. ', '')
        || 'Não vamos conseguir atender ' || coalesce(quando_longo, 'nesse horário') || '.' || E'\n\n'
        || 'Me chame que a gente acha outro 💛';
    end if;
    return
      '😔 *Não deu dessa vez*' || E'\n\n'
      || coalesce('Oi, ' || nome_cliente || '. ', '')
      || 'A *' || coalesce(prof_nome, 'profissional') || '* não vai poder atender '
      || coalesce(quando_longo, 'nesse horário') || '.' || E'\n\n'
      || 'Me chame que a gente acha outro 💛';

  when 'remarcacao_aceita' then
    if pela_casa then
      return
        '🔁 *Remarcado!*' || E'\n\n'
        || coalesce('Oi, ' || nome_cliente || '! ', '') || 'A troca está confirmada:' || E'\n\n'
        || '✨ ' || coalesce(servico, 'Seu atendimento') || E'\n'
        || '👩 com *' || coalesce(prof_nome, 'a profissional') || '*' || E'\n'
        || coalesce('🕒 era: ' || quando_antes || E'\n', '')
        || '🗓️ agora: ' || coalesce(quando_longo, '') || E'\n\n'
        || 'Te esperamos! 💛';
    end if;
    return
      '🔁 *Remarcado!*' || E'\n\n'
      || coalesce('Oi, ' || nome_cliente || '! ', '')
      || 'A *' || coalesce(prof_nome, 'profissional') || '* aceitou a troca:' || E'\n\n'
      || '✨ ' || coalesce(servico, 'Seu atendimento') || E'\n'
      || coalesce('🕒 era: ' || quando_antes || E'\n', '')
      || '🗓️ agora: ' || coalesce(quando_longo, '') || E'\n\n'
      || 'Te espero! 💛';

  when 'remarcacao_recusada' then
    if pela_casa then
      return
        '😔 *Não deu para remarcar*' || E'\n\n'
        || coalesce('Oi, ' || nome_cliente || '. ', '')
        || 'Não conseguimos fazer a troca para ' || coalesce(quando_longo, 'esse horário') || '.' || E'\n\n'
        || coalesce('Seu horário de *' || quando_antes || '* continua guardado. ', 'Seu horário de antes continua guardado. ')
        || 'Se quiser tentar outro, é só me chamar 💛';
    end if;
    return
      '😔 *Não deu para remarcar*' || E'\n\n'
      || coalesce('Oi, ' || nome_cliente || '. ', '')
      || 'A *' || coalesce(prof_nome, 'profissional') || '* não consegue '
      || coalesce(quando_longo, 'nesse horário') || '.' || E'\n\n'
      || coalesce('Seu horário de *' || quando_antes || '* continua guardado. ', 'Seu horário de antes continua guardado. ')
      || 'Se quiser tentar outro, é só me chamar 💛';

  when 'lembrete_agendamento' then
    return
      '📅 *' || public.titulo_do_lembrete(appt) || '*' || E'\n\n'
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
$function$;

-- 10. O modelo do lembrete (o padrão da Plataforma e o que já foi editado) usa {titulo} no lugar de "Amanhã" --------
update public.modelos_de_mensagem
   set padrao = replace(padrao, 'Amanhã tem horário marcado', '{titulo}'),
       texto = case when texto is null then null else replace(texto, 'Amanhã tem horário marcado', '{titulo}') end
 where chave = 'lembrete_agendamento'
   and (padrao like '%Amanhã tem horário marcado%' or coalesce(texto, '') like '%Amanhã tem horário marcado%');
