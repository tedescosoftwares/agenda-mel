-- =============================================================
--  AGENDA MEL — ATUALIZAÇÃO: da migração 040 em diante
--
--  Cole ISTO INTEIRO no SQL Editor do Supabase e Run. Pode rodar
--  de novo quantas vezes quiser: nada é duplicado.
--
--  O que entra aqui:
--    040  avisar quem NÃO agiu (bloco A)
--    041  o aceite vale para quem marca pelo app também
--
--  Se der erro, me mande a mensagem inteira: cada bloco abaixo está
--  marcado com o nome do arquivo de origem.
-- =============================================================

-- =============================================================
-- >>> 040_avisar_quem_nao_agiu.sql
-- =============================================================

-- =============================================================
-- Agenda Mel — 040: avisar quem NÃO agiu (bloco A)
--
-- Três consertos no que já existe e mente.
--
-- 1. A profissional cancelava pelo app e a cliente não ficava sabendo de
--    NADA. Um update direto, sem gatilho para ela. A pessoa aparece no
--    salão num horário que não existe mais. É o pior defeito do sistema
--    hoje, e não é sutil: é dado que não sai.
--
-- 2. O gatilho que existe avisa a profissional do cancelamento que ela
--    mesma acabou de fazer. Ruído que ensina a ignorar o WhatsApp — e
--    quem ignora o WhatsApp perde o aviso que importava.
--
-- 3. O pós-atendimento nasceu desligado por precaução e ficou.
--
-- A regra que passa a valer, e vale para tudo daqui pra frente:
-- QUEM AGE PELA TELA NÃO RECEBE MENSAGEM DO QUE ACABOU DE FAZER.
-- Ela já viu acontecer. Quem precisa saber é o outro lado.
-- =============================================================

-- 1. Quem está agindo -----------------------------------------------------
-- auth.uid() continua legível dentro de SECURITY DEFINER: o DEFINER troca
-- o PAPEL, não as variáveis de sessão. Quando vem nulo, a escrita nasceu
-- de dentro do servidor (bot, cron, service_role) — e aí não há "quem
-- agiu pela tela" para poupar.
create or replace function public.quem_age_e(appt public.appointments)
returns text
language plpgsql
stable
security definer set search_path = public
as $$
declare
  eu uuid := auth.uid();
  conta_prof uuid;
begin
  if eu is null then
    return 'sistema';
  end if;
  if eu = appt.client_id then
    return 'cliente';
  end if;
  select user_id into conta_prof from public.professionals where id = appt.professional_id;
  if eu = conta_prof then
    return 'profissional';
  end if;
  if public.is_admin_do_salao(appt.salon_id) then
    return 'salao';
  end if;
  return 'outro';
end;
$$;

revoke execute on function public.quem_age_e(public.appointments)
  from public, anon, authenticated;

-- 2. "Eu já avisei" -------------------------------------------------------
-- Alguns caminhos já mandam a mensagem certa com o texto certo — o aceite
-- recusado, por exemplo, tem o próprio "não deu dessa vez". Se o gatilho
-- mandasse por cima, a cliente receberia duas mensagens dizendo a mesma
-- coisa com palavras diferentes. Este sinalizador é como esses caminhos
-- avisam o gatilho para ficar quieto.
create or replace function public.silenciar_gatilho()
returns void
language plpgsql
as $$
begin
  perform set_config('agenda_mel.ja_avisei', 'sim', true);  -- true = só nesta transação
end;
$$;

create or replace function public.gatilho_silenciado()
returns boolean
language sql
stable
as $$
  select coalesce(current_setting('agenda_mel.ja_avisei', true), '') = 'sim';
$$;

-- 3. Texto do cancelamento feito pela profissional ------------------------
insert into public.whatsapp_regras (kind, envia, natureza, sufixo) values
  ('profissional_cancelou', true, 'utilidade', null)
on conflict (kind) do nothing;
update public.whatsapp_regras set envia = true where kind = 'profissional_cancelou';

-- o pós-atendimento sai da gaveta
update public.whatsapp_regras set envia = true where kind = 'pos_atendimento';

-- 4. Telefone que não é do Brasil -----------------------------------------
-- O telefone_e164() aceitava só duas formas: 10 ou 11 dígitos (DDD +
-- número, vira +55) ou 12/13 começando com 55. Um +54 argentino caía no
-- fim da função e voltava NULO — e telefone nulo faz todo o resto
-- desistir em silêncio, com "telefone inválido".
--
-- A regra nova separa os dois casos honestamente:
--   • 10 ou 11 dígitos: é número local, e local aqui é Brasil.
--   • 12 a 15 dígitos: já veio com código de país, seja ele qual for.
--     Não é papel desta função adivinhar de que país é — o WhatsApp já
--     entregou o número completo, e reescrevê-lo seria estragar.
create or replace function public.telefone_e164(bruto text)
returns text
language plpgsql
immutable
as $$
declare
  so_digitos text;
  tem_mais boolean;
begin
  if bruto is null then
    return null;
  end if;

  -- O "+" é o desempate, e é para isso que ele existe. Sem ele,
  -- +1 415 555 2671 (EUA, 11 dígitos com país) é indistinguível de
  -- 11 991234567 (celular de São Paulo, 11 dígitos sem país) — e adivinhar
  -- errado manda a mensagem para o outro lado do mundo.
  tem_mais := left(btrim(bruto), 1) = '+';

  so_digitos := regexp_replace(bruto, '\D', '', 'g');

  -- zeros de operadora na frente (0 13 9...) só existem em número local
  if length(so_digitos) in (11, 12) and left(so_digitos, 1) = '0' then
    so_digitos := regexp_replace(so_digitos, '^0+', '');
  end if;

  if length(so_digitos) < 10 then
    return null;              -- não dá para adivinhar o DDD
  end if;

  -- veio com "+": já é internacional, seja de onde for
  if tem_mais and length(so_digitos) between 8 and 15 then
    return so_digitos;
  end if;

  -- número local brasileiro: DDD + número, com ou sem o nono dígito
  if length(so_digitos) in (10, 11) then
    return '55' || so_digitos;
  end if;

  -- já veio com país. Vale para o 55 e para qualquer outro.
  if length(so_digitos) between 12 and 15 then
    return so_digitos;
  end if;

  return null;
end;
$$;

-- 5. A cliente fica sabendo quando a profissional cancela -----------------
create or replace function public.avisa_cliente_do_cancelamento()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  agiu text;
  prof public.professionals%rowtype;
begin
  if new.status <> 'cancelado' or old.status = 'cancelado' then
    return new;
  end if;

  -- caminho que já mandou a mensagem certa com o texto certo
  if public.gatilho_silenciado() then
    return new;
  end if;

  agiu := public.quem_age_e(new);

  -- a cliente que cancelou já viu a tela; e quando o cancelamento nasce
  -- de dentro do servidor, quem sabe o contexto é quem chamou
  if agiu in ('cliente', 'sistema') then
    return new;
  end if;

  select * into prof from public.professionals where id = new.professional_id;

  perform public.notificar(
    new.client_id, 'profissional_cancelou', 'Horário cancelado',
    coalesce(prof.name, 'A profissional') || ' precisou cancelar.',
    '/',
    jsonb_build_object('appointment_id', new.id,
                       'professional_id', new.professional_id));
  return new;
end;
$$;

drop trigger if exists tg_avisa_cliente_cancelou on public.appointments;
create trigger tg_avisa_cliente_cancelou
  after update of status on public.appointments
  for each row execute function public.avisa_cliente_do_cancelamento();

-- 6. E a profissional para de ser avisada do que ela mesma fez ------------
create or replace function public.avisa_profissional_do_cancelamento()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  conta uuid;
  agiu text;
begin
  if new.status <> 'cancelado' or old.status = 'cancelado' then
    return new;
  end if;

  if public.gatilho_silenciado() then
    return new;
  end if;

  agiu := public.quem_age_e(new);
  -- ela mesma, ou a dona do salão pela agenda: as duas estão olhando a
  -- tela onde acabou de sumir. Mandar WhatsApp disso ensina a ignorar
  -- WhatsApp, e quem ignora perde o aviso que importava.
  if agiu in ('profissional', 'salao') then
    return new;
  end if;

  conta := public.conta_da_profissional(new.professional_id);
  if conta is null or conta = new.client_id then
    return new;
  end if;

  perform public.notificar(
    conta, 'cancelou_comigo', 'Cancelaram um horário', null, '/pro',
    jsonb_build_object('appointment_id', new.id,
                       'professional_id', new.professional_id));
  return new;
end;
$$;

-- 7. Mesmo cuidado no agendamento novo ------------------------------------
create or replace function public.avisa_profissional_do_agendamento()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  conta uuid;
begin
  if new.status = 'cancelado' then
    return new;
  end if;

  conta := public.conta_da_profissional(new.professional_id);
  if conta is null then
    return new;
  end if;

  -- ela marcando para si mesma, ou ela marcando para uma cliente pela
  -- própria agenda: nos dois casos ela está vendo a tela
  if conta = new.client_id or conta = auth.uid() then
    return new;
  end if;

  perform public.notificar(
    conta, 'novo_agendamento', 'Horário novo na sua agenda', null, '/pro',
    jsonb_build_object('appointment_id', new.id,
                       'professional_id', new.professional_id));
  return new;
end;
$$;

-- 8. Os caminhos que já avisam calam o gatilho ----------------------------
create or replace function public.resolver_aceite(appt uuid, aceitou boolean)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  ac public.aceites%rowtype;
  a public.appointments%rowtype;
  cliente uuid;
begin
  select * into ac from public.aceites
  where appointment_id = appt and resultado is null;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'pedido já resolvido');
  end if;

  select * into a from public.appointments where id = appt;
  cliente := a.client_id;

  -- este caminho tem texto próprio ("não deu dessa vez"), então o gatilho
  -- não deve mandar o dele por cima
  perform public.silenciar_gatilho();

  if aceitou then
    update public.appointments set status = 'confirmado'
    where id = appt and status = 'pendente';
    perform public.notificar(cliente, 'pedido_aceito', 'Horário confirmado', null, '/',
      jsonb_build_object('appointment_id', appt, 'professional_id', ac.professional_id));
  else
    update public.appointments set status = 'cancelado' where id = appt;
    perform public.notificar(cliente, 'pedido_recusado', 'Horário não confirmado', null, '/',
      jsonb_build_object('appointment_id', appt, 'professional_id', ac.professional_id));
  end if;

  update public.aceites
  set resultado = case when aceitou then 'aceito' else 'recusado' end,
      resolvido_em = now()
  where appointment_id = appt;

  return jsonb_build_object('ok', true,
    'resultado', case when aceitou then 'aceito' else 'recusado' end);
end;
$$;

revoke execute on function public.resolver_aceite(uuid, boolean)
  from public, anon, authenticated;

-- 9. O texto do cancelamento feito pela profissional ----------------------
-- Ela cancelou, então a mensagem tem que fazer três coisas: avisar sem
-- rodeio, não culpar ninguém, e já oferecer a saída. Cliente que recebe
-- "seu horário foi cancelado" e ponto final não volta.
create or replace function public.texto_cancelou_prof(
  servico text, prof_nome text, quando text, nome_cliente text, link text)
returns text
language sql
immutable
as $$
  select '⚠️ *Precisei cancelar seu horário*' || E'\n\n'
    || coalesce('Oi, ' || nome_cliente || '. ', 'Oi! ')
    || 'Desculpa mesmo — a *' || coalesce(prof_nome, 'profissional')
    || '* não vai poder atender:' || E'\n\n'
    || '✨ ' || coalesce(servico, 'seu atendimento') || E'\n'
    || '🗓️ ' || coalesce(quando, '') || E'\n\n'
    || 'Escolhe outro horário aqui que eu já deixo marcado 💛'
    || coalesce(E'\n\n' || '🔗 ' || link, '');
$$;

revoke execute on function public.texto_cancelou_prof(text, text, text, text, text)
  from public, anon, authenticated;

-- 10. O montador conhece o texto novo -------------------------------------
create or replace function public.montar_texto_whatsapp(
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
begin
  if appt is not null then
    select ap.date, ap.start_time, coalesce(ap.service_name, s.name),
           ap.professional_id,
           nullif(btrim(coalesce(cl.full_name, '')), ''), cl.phone
      into d_data, d_hora, servico, prof, nome_na_agenda, tel_na_agenda
    from public.appointments ap
    left join public.services s on s.id = ap.service_id
    left join public.profiles cl on cl.id = ap.client_id
    where ap.id = appt;
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
    return
      '🔔 *Pedido de horário*' || E'\n\n'
      || '👤 ' || coalesce(nome_na_agenda, 'Cliente') || E'\n'
      || '✨ ' || coalesce(servico, 'Atendimento') || E'\n'
      || '🕒 ' || coalesce(quando_longo, '')
      || coalesce(E'\n' || '📱 ' || tel_na_agenda, '') || E'\n\n'
      || 'Responda *1* para aceitar ou *2* para recusar.' || E'\n'
      || '_Sem resposta em ' || coalesce(prazo, 120) || ' min, eu resolvo sozinho._';

  when 'novo_agendamento' then
    return
      '🗓️ *Horário novo na sua agenda*' || E'\n\n'
      || '👤 ' || coalesce(nome_na_agenda, 'Cliente') || E'\n'
      || '✨ ' || coalesce(servico, 'Atendimento') || E'\n'
      || '🕒 ' || coalesce(quando_longo, 'a confirmar')
      || coalesce(E'\n' || '📱 ' || tel_na_agenda, '')
      || coalesce(E'\n\n' || '🔗 Sua agenda: ' || link_app, '');

  when 'cancelou_comigo' then
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

revoke execute on function public.montar_texto_whatsapp(text, text, text, uuid, uuid, uuid)
  from public, anon, authenticated;

-- =============================================================
-- >>> 041_aceite_vale_pro_app_tambem.sql
-- =============================================================

-- =============================================================
-- Agenda Mel — 041: o aceite vale para quem marca pelo app também
--
-- Duas coisas.
--
-- 1. O pedido de aceite só nascia pela conversa. Quem marcava pelo app
--    entrava direto na agenda da profissional sem ela dizer nada — o
--    contrário do que a gente combinou. Agora quem decide é UM lugar só:
--    o gatilho do insert. Não importa por onde veio o agendamento.
--
-- 2. Antes, quem criava o pedido era a conversa; agora é o gatilho. Se
--    os dois criassem, a profissional receberia o pedido duas vezes.
--
-- A regra fica assim: cliente marca, seja onde for → se a profissional
-- pede confirmação, vira pedido. A profissional ou a dona marcando pela
-- agenda → vale direto, porque quem decide já está decidindo.
-- =============================================================

create or replace function public.avisa_profissional_do_agendamento()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  conta uuid;
  manual boolean;
  eh_dona boolean;
  r jsonb;
begin
  if new.status = 'cancelado' then
    return new;
  end if;

  select p.user_id, p.aceite_manual into conta, manual
  from public.professionals p where p.id = new.professional_id;

  if conta is null then
    return new;                      -- profissional sem conta de login
  end if;

  -- ela marcando para si mesma, ou ela mesma marcando pela agenda:
  -- está vendo a tela, não precisa de aviso nem de pedir permissão
  if conta = new.client_id or conta = auth.uid() then
    return new;
  end if;

  eh_dona := public.is_admin_do_salao(new.salon_id);

  -- Pedido de aceite: só quando quem marcou foi a CLIENTE. A dona do
  -- salão encaixando alguém pela agenda está decidindo pela casa — pedir
  -- confirmação nesse caso seria a casa pedindo licença a si mesma.
  if coalesce(manual, false) and not eh_dona and new.status = 'pendente' then
    r := public.pedir_aceite(new.id);
    if coalesce((r ->> 'ok')::boolean, false) then
      return new;                    -- o pedido foi aberto; ela decide
    end if;
    -- não deu para perguntar (sem telefone): confirma e avisa, porque
    -- deixar pendente para sempre é pior do que decidir
    update public.appointments set status = 'confirmado' where id = new.id;

  elsif not coalesce(manual, false) and new.status = 'pendente' then
    -- Ela desligou o "pedir minha confirmação". Deixar em 'pendente'
    -- faria a palavra significar duas coisas: às vezes "esperando ela
    -- responder o pedido", às vezes "esperando ela tocar na agenda".
    -- Estado que significa duas coisas é estado que ninguém confia.
    update public.appointments set status = 'confirmado' where id = new.id;
  end if;

  perform public.notificar(
    conta, 'novo_agendamento', 'Horário novo na sua agenda', null, '/pro',
    jsonb_build_object('appointment_id', new.id,
                       'professional_id', new.professional_id));
  return new;
end;
$$;

-- 2. A conversa para de abrir o pedido: agora é o gatilho ----------------
create or replace function public.fechar_pela_conversa(
  cliente uuid, prof uuid, salao uuid, serv uuid,
  dia date, hora time, dur integer
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  manual boolean;
  novo uuid;
  virou text;
  na_fila record;
begin
  select aceite_manual into manual from public.professionals where id = prof;

  -- nasce pendente quando ela pede confirmação; o gatilho do insert vê
  -- isso e abre o pedido
  insert into public.appointments
    (client_id, professional_id, salon_id, service_id,
     date, start_time, end_time, status)
  values
    (cliente, prof, salao, serv, dia, hora,
     (hora + make_interval(mins => dur))::time,
     case when coalesce(manual, false) then 'pendente' else 'confirmado' end)
  returning id into novo;

  -- o gatilho já rodou: lê o que ele decidiu, em vez de decidir de novo
  select status into virou from public.appointments where id = novo;

  if virou <> 'pendente' then
    return jsonb_build_object('appointment_id', novo, 'pendente', false);
  end if;

  select o.id, o.telefone, o.corpo into na_fila
  from public.message_outbox o
  where o.appointment_id = novo and o.kind = 'pedido_de_aceite'
    and o.status = 'na_fila'
  order by o.criado_em desc
  limit 1;

  return jsonb_build_object('appointment_id', novo, 'pendente', true,
    'minutos', (select minutos_para_aceitar from public.professionals where id = prof),
    'avisar', case when na_fila.id is not null then
      jsonb_build_object('fila_id', na_fila.id,
                         'telefone', na_fila.telefone,
                         'corpo', na_fila.corpo)
    end);
end;
$$;

revoke execute on function
  public.fechar_pela_conversa(uuid, uuid, uuid, uuid, date, time, integer)
  from public, anon, authenticated;

-- 3. O app precisa saber que virou pedido, não agendamento ---------------
-- Sem isto a tela diz "marcado!" e a cliente descobre depois que era só
-- um pedido. Devolve o estado real de um agendamento recém-criado.
drop function if exists public.como_ficou(uuid);
create or replace function public.como_ficou(appt uuid)
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select jsonb_build_object(
    'status', a.status,
    'pendente', a.status = 'pendente',
    'profissional', p.name,
    'minutos', p.minutos_para_aceitar)
  from public.appointments a
  join public.professionals p on p.id = a.professional_id
  where a.id = appt
    and (a.client_id = auth.uid()
         or public.is_professional(a.professional_id)
         or public.is_admin_do_salao(a.salon_id));
$$;

revoke execute on function public.como_ficou(uuid) from public, anon;
grant execute on function public.como_ficou(uuid) to authenticated;

