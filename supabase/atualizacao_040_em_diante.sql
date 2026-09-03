-- =============================================================
--  AGENDA MEL — ATUALIZAÇÃO: da migração 040 em diante
--
--  Cole ISTO INTEIRO no SQL Editor do Supabase e Run. Pode rodar
--  de novo quantas vezes quiser: nada é duplicado.
--
--  O que entra aqui:
--    040  avisar quem NÃO agiu (bloco A)
--    041  o aceite vale para quem marca pelo app também
--    042  o mesmo telefone escrito de duas formas
--    043  responder pelo canal por onde a mensagem chegou
--    044  silêncio de madrugada não vale para resposta
--    045  envio que morreu no meio não fica preso para sempre
--    046  ensaiar a conversa sem gastar um telefone
--    047  'pendente' sem pedido é promessa que ninguém cumpre
--    048  
--    049  
--    050  
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

-- =============================================================
-- >>> 042_o_nove_da_argentina.sql
-- =============================================================

-- =============================================================
-- Agenda Mel — 042: o mesmo telefone escrito de duas formas
--
-- Na Argentina o celular tem um 9 depois do código do país que o
-- WhatsApp às vezes manda e às vezes não:
--
--   +54 9 11 3619-7412   o que a pessoa digita no cadastro
--    54   11 3619-7412   o que costuma chegar no webhook
--
-- É o MESMO aparelho. Para o banco eram dois números diferentes, então
-- cliente_pelo_telefone() não achava ninguém e toda mensagem caía como
-- sem_cadastro: o bot não sabia com quem estava falando e ficava mudo.
-- O México tem exatamente a mesma armadilha, com um 1 no lugar do 9.
--
-- A saída não é normalizar na entrada. telefone_e164() precisa continuar
-- devolvendo o número como ele é, porque é ele que a gente usa para
-- ENVIAR. O que muda é a chave de COMPARAÇÃO: uma forma canônica usada
-- só para decidir se dois telefones são a mesma pessoa.
--
-- Guardar o número; comparar a chave. São perguntas diferentes.
-- =============================================================

-- 1. A chave ---------------------------------------------------------------
create or replace function public.telefone_chave(bruto text)
returns text
language plpgsql
immutable
as $$
declare
  d text;
begin
  d := public.telefone_e164(bruto);
  if d is null then
    return null;
  end if;

  -- Argentina: 54 + 9 + 10 dígitos é o mesmo que 54 + 10 dígitos
  if length(d) = 13 and left(d, 3) = '549' then
    return '54' || substr(d, 4);
  end if;

  -- México: 52 + 1 + 10 dígitos é o mesmo que 52 + 10 dígitos
  if length(d) = 13 and left(d, 3) = '521' then
    return '52' || substr(d, 4);
  end if;

  return d;
end;
$$;

comment on function public.telefone_chave(text) is
  'Forma canônica para COMPARAR telefones. Para enviar, use telefone_e164().';

revoke execute on function public.telefone_chave(text)
  from public, anon, authenticated;

-- 2. Quem compara passa a comparar pela chave ------------------------------
-- Mesma regra de desempate da 036: entre perfis com o mesmo telefone,
-- quem responde no WhatsApp é a CLIENTE.
create or replace function public.cliente_pelo_telefone(tel text)
returns uuid
language sql
stable
security definer set search_path = public
as $$
  select p.id
  from public.profiles p
  where public.telefone_chave(p.phone) = public.telefone_chave(tel)
  order by
    case p.role when 'cliente' then 0 when 'admin' then 1 else 2 end,
    p.created_at
  limit 1;
$$;

revoke execute on function public.cliente_pelo_telefone(text)
  from public, anon, authenticated;

-- 3. E quem procura a profissional também ----------------------------------
-- Aqui a busca é no histórico de envios: o número que ELA recebeu pode
-- ter sido gravado numa forma e chegar de volta na outra.
create or replace function public.profissional_do_telefone(tel text)
returns uuid
language sql
stable
security definer set search_path = public
as $$
  select o.professional_id
  from public.message_outbox o
  where public.telefone_chave(o.telefone) = public.telefone_chave(tel)
    and o.professional_id is not null
  order by o.criado_em desc
  limit 1;
$$;

revoke execute on function public.profissional_do_telefone(text)
  from public, anon, authenticated;

-- =============================================================
-- >>> 043_responder_por_onde_chegou.sql
-- =============================================================

-- =============================================================
-- Agenda Mel — 043: responder pelo canal por onde a mensagem chegou
--
-- O bot criava a conversa, montava o menu de serviços e devolvia o
-- texto pronto. E a resposta não saía. Nunca.
--
-- Motivo: para descobrir por qual canal responder, o webhook chamava
-- canal_do_telefone(), que procura assim:
--
--     from message_outbox
--    where telefone = <ela>
--      and status in ('enviado', 'entregue', 'lido')
--
-- Ou seja: "só sei por onde te responder se eu JÁ tiver conseguido te
-- mandar alguma coisa antes". Para quem escreve pela primeira vez isso
-- nunca é verdade — a função devolve zero linhas, o webhook faz
-- `continue`, e a cliente fica olhando para o WhatsApp mudo. O bot fez
-- tudo certo e ninguém ficou sabendo.
--
-- Ovo e galinha: a única forma de ganhar histórico é responder, e a
-- única forma de responder era ter histórico.
--
-- O canal certo nunca foi um mistério: é O NÚMERO QUE RECEBEU A
-- MENSAGEM. A Evolution manda isso em todo evento (`instance`), e o
-- webhook já usa esse dado para o porteiro — só não usava para
-- responder. A ordem passa a ser:
--
--   1. a instância que recebeu     — é fato, não dedução
--   2. o salão que já foi resolvido — quando o evento não trouxe a
--                                     instância
--   3. o histórico de envios        — o que existia, agora como último
--                                     recurso e não como única fonte
--
-- E o segundo conserto: resposta que não conseguiu sair vira linha na
-- fila em vez de sumir. Antes, se o envio falhasse, o texto morria numa
-- variável. Silêncio é o pior desfecho possível — pior que atrasar.
-- =============================================================

-- 1. Por onde responder ----------------------------------------------------
create or replace function public.canal_para_responder(
  tel text,
  instancia text default null,
  salao uuid default null
)
returns table (canal text, identificador text, salon_id uuid)
language sql
stable
security definer set search_path = public
as $$
  -- as três origens, cada uma com sua prioridade; ganha a menor que
  -- tiver resposta. Sem o número da prioridade, o `order by` ordenaria
  -- por nome de canal e a escolha viraria sorteio.
  select x.canal, x.identificador, x.salon_id
  from (
    -- 1. a instância que recebeu: é fato, não dedução
    select 1 as prioridade, c.canal, c.identificador, c.salon_id
    from public.whatsapp_channels c
    where instancia is not null
      and c.identificador = instancia
      and c.ativo

    union all

    -- 2. o salão que o porteiro já resolveu
    select 2, c.canal, c.identificador, c.salon_id
    from public.whatsapp_channels c
    where salao is not null
      and c.salon_id = salao
      and c.ativo

    union all

    -- 3. o histórico de envios: era a única fonte, agora é a última
    select 3, u.canal, u.identificador, u.salon_id
    from (
      select c.canal, c.identificador, c.salon_id
      from public.message_outbox o
      join public.whatsapp_channels c on c.salon_id = o.salon_id
      where public.telefone_chave(o.telefone) = public.telefone_chave(tel)
        and o.status in ('enviado', 'entregue', 'lido')
      order by o.enviado_em desc nulls last
      limit 1
    ) u
  ) x
  order by x.prioridade
  limit 1;
$$;

revoke execute on function public.canal_para_responder(text, text, uuid)
  from public, anon, authenticated;

-- 2. Resposta que não saiu não some ---------------------------------------
-- Chamada pelo webhook quando o envio na hora falha. Vira linha na fila,
-- que o escoamento normal tenta de novo. Não é o ideal — resposta que
-- chega meia hora depois quase não é resposta — mas é infinitamente
-- melhor que a cliente achar que o salão a ignorou.
create or replace function public.resposta_nao_saiu(
  tel text,
  corpo text,
  salao uuid default null,
  motivo text default null
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  e164 text := public.telefone_e164(tel);
  fila_id uuid;
begin
  if e164 is null or corpo is null or btrim(corpo) = '' then
    return null;
  end if;

  insert into public.message_outbox
    (salon_id, telefone, kind, corpo, canal, status, client_id, erro)
  values (salao, e164, 'resposta_do_bot', corpo, 'evolution', 'na_fila',
          public.cliente_pelo_telefone(e164),
          coalesce(motivo, 'não saiu na hora'))
  returning id into fila_id;

  return fila_id;
end;
$$;

revoke execute on function public.resposta_nao_saiu(text, text, uuid, text)
  from public, anon, authenticated;

-- a regra precisa existir para o escoamento não descartar a linha
insert into public.whatsapp_regras (kind, envia, natureza, sufixo) values
  ('resposta_do_bot', true, 'utilidade', null)
on conflict (kind) do nothing;
update public.whatsapp_regras set envia = true where kind = 'resposta_do_bot';

-- 3. O diagnóstico precisa ver isto ---------------------------------------
-- Uma resposta parada na fila com erro preenchido é o sintoma exato de
-- "o bot pensou e ninguém ouviu". Sem uma pergunta que a mostre, o
-- próximo diagnóstico volta a dizer que está tudo bem.
create or replace function public.respostas_engasgadas(salao uuid default null)
returns table (telefone text, corpo text, motivo text, quando timestamptz)
language sql
stable
security definer set search_path = public
as $$
  select o.telefone, left(o.corpo, 80), o.erro, o.criado_em
  from public.message_outbox o
  where o.kind = 'resposta_do_bot'
    and o.status = 'na_fila'
    and (salao is null or o.salon_id = salao)
  order by o.criado_em desc
  limit 20;
$$;

revoke execute on function public.respostas_engasgadas(uuid)
  from public, anon;
grant execute on function public.respostas_engasgadas(uuid) to authenticated;

-- =============================================================
-- >>> 044_silencio_nao_vale_pra_resposta.sql
-- =============================================================

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

-- =============================================================
-- >>> 045_envio_que_morreu_no_meio.sql
-- =============================================================

-- =============================================================
-- Agenda Mel — 045: envio que morreu no meio não fica preso para sempre
--
-- puxar_da_fila() marca as linhas como 'enviando' na mesma transação em
-- que as devolve — é assim que duas execuções ao mesmo tempo não pegam a
-- mesma mensagem, e está certo.
--
-- O que falta é o outro lado. Se a Edge Function morrer depois de marcar
-- e antes de confirmar — tempo esgotado, deploy no meio, erro de rede na
-- volta — a linha fica em 'enviando' e NUNCA MAIS sai de lá: a busca só
-- olha 'na_fila'. A mensagem não falhou, não foi enviada, e não aparece
-- em lugar nenhum como problema. Some.
--
-- Dez minutos é tempo de sobra para um lote de 20 com pausa de 900ms
-- entre cada. Passou disso, aquele envio não existe mais.
--
-- Vai dentro do próprio puxar_da_fila(), de propósito: assim não depende
-- de ninguém lembrar de chamar, e não exige republicar Edge Function.
-- =============================================================

drop function if exists public.puxar_da_fila(integer);

create or replace function public.puxar_da_fila(quantas integer default 20)
returns table (
  id uuid,
  salon_id uuid,
  canal text,
  identificador text,
  telefone text,
  titulo text,
  corpo text,
  botoes jsonb,
  estilo_botao text
)
language plpgsql
security definer set search_path = public
as $$
begin
  -- primeiro, resgatar o que ficou para trás de uma execução que morreu.
  -- A tentativa já foi contada, então o teto de 4 continua valendo e
  -- isto não vira laço infinito.
  update public.message_outbox
  set status = 'na_fila',
      erro = coalesce(erro, 'envio interrompido; devolvido para a fila')
  where status = 'enviando'
    and criado_em < now() - interval '10 minutes';

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
    returning o.id, o.salon_id, o.canal, o.telefone, o.titulo, o.corpo, o.kind
  )
  select m.id, m.salon_id, m.canal, c.identificador, m.telefone,
         m.titulo, m.corpo,
         case when public.canal_manda_botao(m.salon_id) then r.botoes else null end,
         c.estilo_botao
  from marcadas m
  join public.whatsapp_channels c on c.salon_id = m.salon_id
  left join public.whatsapp_regras r on r.kind = m.kind;
end;
$$;

revoke execute on function public.puxar_da_fila(integer)
  from public, anon, authenticated;

-- resgatar agora o que já está preso, sem esperar a próxima passada
update public.message_outbox
set status = 'na_fila',
    erro = coalesce(erro, 'envio interrompido; devolvido para a fila')
where status = 'enviando'
  and criado_em < now() - interval '10 minutes';

-- e soltar o que a 044 não alcançou: ela só mexeu em 'na_fila', e uma
-- linha travada em 'enviando' continuava com liberado_em de manhã
update public.message_outbox o
set liberado_em = now()
from public.whatsapp_regras r
where r.kind = o.kind
  and not r.respeita_silencio
  and o.status = 'na_fila'
  and o.liberado_em > now();

-- =============================================================
-- >>> 046_bancada_de_testes.sql
-- =============================================================

-- =============================================================
-- Agenda Mel — 046: ensaiar a conversa sem gastar um telefone
--
-- Testar o bot exige dois números de WhatsApp: um fazendo de cliente,
-- outro de profissional. Quem está construindo raramente tem dois à
-- mão, e quando tem, um deles cai — número novo, chip que expira,
-- WhatsApp que desconecta. A construção inteira para por causa disso.
--
-- Esta função roda a MESMA conversa que o webhook rodaria, com o mesmo
-- receber_mensagem(), tocando as mesmas tabelas. A única diferença é o
-- último centímetro: as mensagens que iriam para o WhatsApp são
-- marcadas como 'cancelado' com o motivo anotado, e devolvidas na
-- resposta para você LER o que teria sido enviado, para quem.
--
-- O que é de verdade continua de verdade: o horário marcado aparece na
-- agenda, o pedido de aceite existe, a conversa avança de estado. É
-- ensaio da entrega, não do sistema — testar contra uma imitação é
-- testar a imitação.
--
-- Só admin do salão. Um simulador de mensagens recebidas na mão de
-- qualquer um logado seria uma forma elegante de marcar horário no nome
-- dos outros.
-- =============================================================

create or replace function public.simular_recebida(
  salao uuid,
  tel text,
  texto text,
  intencao text default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  -- Os ids que JÁ existiam, não um horário de corte. A primeira versão
  -- comparava criado_em >= clock_timestamp() e não pegava nada: o
  -- criado_em das linhas novas é now(), que numa transação é o instante
  -- em que ela COMEÇOU — sempre anterior. Errei nisso e a bancada
  -- devolvia lista vazia enquanto as mensagens saíam de verdade.
  ja_existiam uuid[];
  r jsonb;
  saidas jsonb;
begin
  if not public.is_admin_do_salao(salao) then
    raise exception 'esse salão não é seu';
  end if;

  if public.telefone_e164(tel) is null then
    return jsonb_build_object('erro', 'telefone inválido: ' || coalesce(tel, '(vazio)'));
  end if;

  select coalesce(array_agg(id), '{}') into ja_existiam
  from public.message_outbox where salon_id = salao;

  -- Apagar QUEM está chamando, pelo resto desta transação.
  --
  -- Quem usa a bancada é a dona do salão, logada. Quem chama isto na
  -- vida real é o webhook, com a chave de serviço e sem usuário nenhum.
  -- E há regras que olham auth.uid() para decidir — o gatilho do
  -- agendamento, por exemplo, não pede aceite quando quem marcou foi a
  -- casa. Sem apagar o ator aqui, a bancada testaria um caminho que
  -- nenhuma cliente percorre, e diria que está tudo bem.
  --
  -- Foi assim que ela mentiu no primeiro teste: nenhum pedido de aceite
  -- nasceu, porque o banco achou que a dona é que estava marcando.
  -- 'true' = só nesta transação; ao terminar, volta ao normal.
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);

  -- o caminho de verdade, sem atalho
  r := public.receber_mensagem(tel, texto, null, null, intencao, salao);

  -- e agora o único fingimento: nada disto vai para o WhatsApp
  update public.message_outbox
  set status = 'cancelado',
      erro = 'bancada de testes — não foi enviado'
  where salon_id = salao
    and not (id = any (ja_existiam))
    and status in ('na_fila', 'enviando');

  select jsonb_agg(jsonb_build_object(
           'telefone', o.telefone,
           'tipo', o.kind,
           'corpo', o.corpo,
           'para', coalesce(pf.name, p.full_name, '(desconhecido)')
         ) order by o.criado_em)
    into saidas
  from public.message_outbox o
  left join public.profiles p on p.id = o.client_id
  left join public.professionals pf on pf.id = o.professional_id
  where o.salon_id = salao and not (o.id = any (ja_existiam));

  -- o 'avisar' é o aviso que o webhook mandaria na hora, fora da fila;
  -- na bancada ele também é só texto para ler
  return jsonb_build_object(
    'acao',      r ->> 'acao',
    'responder', r ->> 'responder',
    'avisar',    r -> 'avisar',
    'appointment_id', r ->> 'appointment_id',
    'motivo',    r ->> 'motivo',
    'mensagens', coalesce(saidas, '[]'::jsonb));
end;
$$;

revoke execute on function public.simular_recebida(uuid, text, text, text)
  from public, anon;
grant execute on function public.simular_recebida(uuid, text, text, text) to authenticated;

-- Limpar o ensaio -----------------------------------------------------------
-- Um teste que suja a agenda de verdade e não tem como desfazer vira
-- medo de testar. Isto apaga o que a bancada criou para um telefone:
-- conversa aberta, pedido de aceite, agendamento e mensagens.
create or replace function public.limpar_ensaio(salao uuid, tel text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  e164 text := public.telefone_e164(tel);
  cliente uuid;
  quantos_ap integer := 0;
  quantas_msg integer := 0;
begin
  if not public.is_admin_do_salao(salao) then
    raise exception 'esse salão não é seu';
  end if;
  if e164 is null then
    return jsonb_build_object('erro', 'telefone inválido');
  end if;

  delete from public.conversas where telefone = e164 and salon_id = salao;

  cliente := public.cliente_pelo_telefone(e164);
  if cliente is not null then
    -- só o que está por vir: histórico de verdade não se apaga por engano
    with alvos as (
      select a.id from public.appointments a
      where a.salon_id = salao
        and a.client_id = cliente
        and (a.date + a.start_time) > public.agora_local()
        and a.status in ('pendente', 'confirmado')
        -- só o que nasceu no ensaio. Sem este limite, limpar um teste
        -- apagaria um horário de verdade que a cliente marcou semana
        -- passada — e apagar agenda alheia não se desfaz
        and a.created_at > now() - interval '24 hours'
    ),
    fora_aceite as (
      delete from public.aceites where appointment_id in (select id from alvos)
    ),
    fora_fila as (
      delete from public.message_outbox where appointment_id in (select id from alvos)
    )
    delete from public.appointments where id in (select id from alvos);
    get diagnostics quantos_ap = row_count;
  end if;

  delete from public.message_outbox
  where salon_id = salao
    and telefone = e164
    and status in ('na_fila', 'enviando', 'cancelado');
  get diagnostics quantas_msg = row_count;

  return jsonb_build_object('ok', true,
    'agendamentos_apagados', quantos_ap,
    'mensagens_apagadas', quantas_msg);
end;
$$;

revoke execute on function public.limpar_ensaio(uuid, text) from public, anon;
grant execute on function public.limpar_ensaio(uuid, text) to authenticated;

-- =============================================================
-- >>> 047_pendente_sem_pedido_nao_existe.sql
-- =============================================================

-- =============================================================
-- Agenda Mel — 047: 'pendente' sem pedido é promessa que ninguém cumpre
--
-- A bancada de testes achou isto no primeiro uso, e é defeito meu, da
-- migração 041.
--
-- O gatilho decide entre três mundos:
--
--   a cliente marcou   + aceite ligado  -> abre pedido para a profissional
--   quem marcou é ela  + aceite desligado -> confirma na hora
--   a DONA marcou pela agenda            -> ??? 
--
-- O terceiro caso caía no vazio. A condição do primeiro ramo exige
-- `not eh_dona`, e a do segundo exige `not manual`. Quando a dona marca
-- para uma cliente e a profissional tem aceite ligado, nenhuma das duas
-- vale: o agendamento fica 'pendente' e ali morre.
--
-- Pendente sem pedido é o pior estado possível. Não existe aceite para
-- ninguém responder, resolver_aceites_vencidos() não o enxerga (ele
-- procura na tabela de aceites), não aparece em meus_pedidos(), e a
-- cliente foi avisada de que "assim que confirmar, eu te aviso". Fica
-- esperando um aviso que nenhuma linha de código vai mandar.
--
-- A intenção do 041 estava escrita no comentário e não no código: a
-- casa marcando pela agenda está decidindo pela casa, então não pede
-- licença a si mesma — ou seja, confirma. Agora o código diz isso.
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

  if conta = new.client_id or conta = auth.uid() then
    return new;                      -- ela mesma, olhando a tela
  end if;

  eh_dona := public.is_admin_do_salao(new.salon_id);

  if coalesce(manual, false) and not eh_dona and new.status = 'pendente' then
    -- a cliente marcou e a profissional quer decidir: abre o pedido
    r := public.pedir_aceite(new.id);
    if coalesce((r ->> 'ok')::boolean, false) then
      return new;
    end if;
    -- não deu para perguntar (sem telefone): confirma e avisa, porque
    -- deixar pendente para sempre é pior do que decidir
    update public.appointments set status = 'confirmado' where id = new.id;

  elsif new.status = 'pendente' then
    -- Todo o resto: ou ela desligou o "pedir minha confirmação", ou quem
    -- marcou foi a casa pela agenda. Nos dois casos não há a quem
    -- perguntar, e um só ramo cobre os dois — era a falta deste `else`
    -- que deixava o agendamento pendurado.
    update public.appointments set status = 'confirmado' where id = new.id;
  end if;

  perform public.notificar(
    conta, 'novo_agendamento', 'Horário novo na sua agenda', null, '/pro',
    jsonb_build_object('appointment_id', new.id,
                       'professional_id', new.professional_id));
  return new;
end;
$$;

-- E resgatar quem já ficou pendurado: pendente, sem pedido nenhum,
-- ninguém para responder. Confirmar é a leitura honesta — a cliente foi
-- avisada de que o horário estava guardado, e a profissional recebeu o
-- 'novo_agendamento' na hora.
update public.appointments a
set status = 'confirmado'
where a.status = 'pendente'
  and not exists (select 1 from public.aceites ac where ac.appointment_id = a.id);

-- =============================================================
-- >>> 048_a_agenda_publica_diz_a_verdade.sql
-- =============================================================

-- =============================================================
-- Agenda Mel / MIMO — 048: a página pública passa a usar a conta boa
--
-- Existiam DUAS respostas para "que horários estão livres":
--
--   • horarios_livres()  no banco — usada pelo bot. Considera o
--     expediente, o que já está marcado, os BLOQUEIOS da profissional
--     (almoço, médico, folga) e o intervalo entre atendimentos.
--
--   • gerarSlots()  no navegador — usada pela página pública. Considera
--     o expediente e o que já está marcado. Só isso.
--
-- Ou seja: o site oferecia horário que o bot recusaria. Uma cliente
-- marcava em cima do almoço da profissional pelo link, e pelo WhatsApp
-- não conseguia. Duas verdades sobre o mesmo minuto.
--
-- Esta migração não muda regra nenhuma: ela só ABRE para o público a
-- função que já existia e já estava certa, para a página parar de fazer
-- a conta por conta própria. horarios_livres() já era pública desde a
-- 035; falta a irmã dela, que responde "em que dias ainda tem vaga".
--
-- Nada de novo é exposto: quem abre /p/ana-paula já vê os horários
-- livres de cada dia, um a um. Saber de antemão em quais dias procurar
-- é a mesma informação, com menos toques.
-- =============================================================

grant execute on function public.dias_com_vaga(uuid, integer, integer)
  to anon, authenticated;

-- =============================================================
-- >>> 049_favoritas_avaliacoes_e_fila.sql
-- =============================================================

-- =============================================================
-- MIMO — 049: favoritas, avaliações e a posição na fila
--
-- Três coisas que o desenho do MIMO pede e que não existiam em lugar
-- nenhum do banco. Nenhuma delas muda regra de agendamento; são camadas
-- em cima do que já acontece.
--
-- 1. FAVORITAS. O coração na lista de profissionais. Uma tabela de dois
--    ids, com a cliente como dona da própria lista.
--
-- 2. AVALIAÇÕES. Uma nota de 1 a 5 e um comentário, sempre amarrados a
--    um atendimento CONCLUÍDO da própria cliente. Não existe avaliar
--    quem nunca te atendeu — a chave estrangeira e a checagem no insert
--    garantem isso, não a tela.
--
-- 3. POSIÇÃO NA FILA. "Você está na fila" sem dizer em qual lugar é
--    ansiedade. A conta é: quantas entradas AGUARDANDO, para a mesma
--    profissional e o mesmo serviço, entraram antes desta.
-- =============================================================

-- 1. Favoritas ---------------------------------------------------------------
create table if not exists public.client_favorites (
  client_id uuid not null references public.profiles (id) on delete cascade,
  professional_id uuid not null references public.professionals (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (client_id, professional_id)
);

alter table public.client_favorites enable row level security;

drop policy if exists "minhas favoritas" on public.client_favorites;
create policy "minhas favoritas"
  on public.client_favorites for all
  to authenticated
  using (client_id = auth.uid())
  with check (client_id = auth.uid());

revoke truncate, references, trigger on public.client_favorites
  from anon, authenticated;

-- 2. Avaliações --------------------------------------------------------------
create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null unique
    references public.appointments (id) on delete cascade,
  client_id uuid not null references public.profiles (id) on delete cascade,
  professional_id uuid not null references public.professionals (id) on delete cascade,
  nota smallint not null check (nota between 1 and 5),
  comentario text,
  created_at timestamptz not null default now()
);

create index if not exists reviews_prof_idx on public.reviews (professional_id, created_at desc);

alter table public.reviews enable row level security;

-- qualquer pessoa lê (é o que dá sentido a avaliar); só a cliente do
-- atendimento escreve, e só uma vez por atendimento (unique acima)
drop policy if exists "ver avaliacoes" on public.reviews;
create policy "ver avaliacoes"
  on public.reviews for select
  to anon, authenticated
  using (true);

drop policy if exists "avaliar meu atendimento" on public.reviews;
create policy "avaliar meu atendimento"
  on public.reviews for insert
  to authenticated
  with check (
    client_id = auth.uid()
    and exists (
      select 1 from public.appointments a
      where a.id = appointment_id
        and a.client_id = auth.uid()
        and a.professional_id = reviews.professional_id
        and a.status = 'concluido'
    )
  );

revoke truncate, references, trigger on public.reviews from anon, authenticated;

-- a média e a contagem, para a capa da profissional. Sem avaliação
-- devolve nulo — a tela decide o que dizer, e "0.0 (0)" não é opção.
create or replace function public.avaliacao_da_profissional(prof uuid)
returns table (media numeric, quantas integer)
language sql
stable
security definer set search_path = public
as $$
  select round(avg(nota)::numeric, 1), count(*)::integer
  from public.reviews
  where professional_id = prof
  having count(*) > 0;
$$;

grant execute on function public.avaliacao_da_profissional(uuid) to anon, authenticated;

-- as últimas, com o primeiro nome de quem avaliou
create or replace function public.avaliacoes_da_profissional(prof uuid, quantas integer default 10)
returns table (nota smallint, comentario text, quem text, quando timestamptz)
language sql
stable
security definer set search_path = public
as $$
  select r.nota, r.comentario,
         split_part(coalesce(p.full_name, 'Cliente'), ' ', 1),
         r.created_at
  from public.reviews r
  left join public.profiles p on p.id = r.client_id
  where r.professional_id = prof
  order by r.created_at desc
  limit greatest(1, least(coalesce(quantas, 10), 50));
$$;

grant execute on function public.avaliacoes_da_profissional(uuid, integer) to anon, authenticated;

-- 3. Posição na fila ----------------------------------------------------------
create or replace function public.posicao_na_fila(entrada_id uuid)
returns table (posicao integer, na_frente integer, previsao text)
language plpgsql
stable
security definer set search_path = public
as $$
declare
  e public.waitlist_entries%rowtype;
  antes integer;
begin
  select * into e from public.waitlist_entries where id = entrada_id;
  if not found or e.client_id <> auth.uid() then
    return;
  end if;

  select count(*) into antes
  from public.waitlist_entries w
  where w.status = 'aguardando'
    and w.professional_id = e.professional_id
    and w.service_id = e.service_id
    and w.created_at < e.created_at;

  return query select
    antes + 1,
    antes,
    'entre ' || to_char(e.window_start, 'HH24:MI') || ' e ' ||
      to_char(e.window_end, 'HH24:MI') || ', até ' || to_char(e.date_to, 'DD/MM');
end;
$$;

revoke execute on function public.posicao_na_fila(uuid) from public, anon;
grant execute on function public.posicao_na_fila(uuid) to authenticated;

-- =============================================================
-- >>> 050_remarcar_passa_pelo_aceite.sql
-- =============================================================

-- =============================================================
-- MIMO — 050: remarcar passa pelo aceite
--
-- Até aqui a cliente só tinha dois botões: cancelar, ou marcar outro.
-- Remarcar era cancelar e torcer para o horário novo existir. E se ela
-- pudesse simplesmente trocar a data do agendamento, a profissional
-- veria a agenda mudar sozinha, sem ninguém perguntar — o oposto do
-- que a 038 construiu.
--
-- Agora remarcar é um PEDIDO, como marcar é. A cliente escolhe o
-- horário novo e o app cria um segundo agendamento, pendente, apontando
-- para o antigo (remarca_de). O antigo continua confirmado e guardado.
-- A profissional recebe no WhatsApp (ou no app) o pedido com "era X,
-- quer Y", e responde 1 ou 2 como sempre:
--
--   aceitou   -> o novo confirma, o antigo cancela em silêncio
--                (remarcado_para diz para onde foi)
--   recusou   -> o novo some, o antigo continua valendo, a cliente
--                é avisada de que fica como estava
--   sumiu     -> o prazo dela decide, como em qualquer pedido
--
-- Se ela não pede confirmação (aceite_manual desligado), a troca é
-- imediata e ela recebe um "a cliente remarcou" em vez de "horário
-- novo".
--
-- Duas pontas soltas que o desenho expôs e que também entram aqui:
--   • a cliente cancelava um pedido pendente e o aceite ficava aberto;
--     a profissional respondia 1 horas depois e a cliente recebia um
--     "confirmado" de um horário que ela mesma tinha desfeito
--   • cancelar o horário de origem deixava o pedido de troca órfão
-- =============================================================

-- 1. Quem aponta para quem ----------------------------------------------
alter table public.appointments
  add column if not exists remarca_de uuid
    references public.appointments (id) on delete set null;

alter table public.appointments
  add column if not exists remarcado_para uuid
    references public.appointments (id) on delete set null;

comment on column public.appointments.remarca_de is
  'este agendamento é um pedido para trocar o horário daquele';
comment on column public.appointments.remarcado_para is
  'este agendamento foi cancelado porque virou aquele';

create index if not exists appointments_remarca_de_idx
  on public.appointments (remarca_de) where remarca_de is not null;

-- 2. Textos novos, e são resposta (não esperam a madrugada passar) -------
insert into public.whatsapp_regras (kind, envia, natureza, sufixo, respeita_silencio) values
  ('remarcacao_aceita',   true, 'utilidade', null, false),
  ('remarcacao_recusada', true, 'utilidade', null, false)
on conflict (kind) do nothing;
update public.whatsapp_regras set envia = true, respeita_silencio = false
where kind in ('remarcacao_aceita', 'remarcacao_recusada');

-- 3. Uma limitação assumida ----------------------------------------------
-- Enquanto o pedido está aberto, o horário antigo e o novo existem ao
-- mesmo tempo, e a trava de sobreposição (013) vale para os dois. Logo
-- o horário novo não pode cruzar com o atual: "das 10h para as 10h30"
-- com uma hora de duração não passa. É raro, tem mensagem própria, e
-- o caminho é cancelar e marcar de novo. Melhor isso do que afrouxar a
-- trava que impede duas clientes no mesmo horário.

-- 4. Trocar de verdade: o novo vale, o antigo sai de cena ---------------
-- Chamada quando o pedido é aceito (ou quando não havia pedido a fazer).
-- Cancela o antigo sem gritar: a profissional acabou de aceitar a troca
-- e a cliente pediu por ela — ninguém precisa de "cancelaram um horário".
create or replace function public.efetivar_remarcacao(novo uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  n public.appointments%rowtype;
begin
  select * into n from public.appointments where id = novo;
  if not found or n.remarca_de is null then
    return;
  end if;

  perform public.silenciar_gatilho();

  update public.appointments
  set status = 'cancelado', remarcado_para = novo
  where id = n.remarca_de and status <> 'cancelado';
end;
$$;

revoke execute on function public.efetivar_remarcacao(uuid)
  from public, anon, authenticated;

-- 5. O pedido da cliente --------------------------------------------------
create or replace function public.pedir_remarcacao(
  appt uuid,
  nova_data date,
  nova_hora time
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  a public.appointments%rowtype;
  dur integer;
  novo uuid;
  virou text;
  minutos integer;
begin
  select * into a from public.appointments where id = appt;
  if not found or a.client_id is distinct from auth.uid() then
    raise exception 'esse horário não é seu';
  end if;

  if a.status not in ('pendente', 'confirmado') then
    return jsonb_build_object('ok', false, 'motivo', 'esse horário não pode mais ser remarcado');
  end if;
  if a.remarca_de is not null then
    return jsonb_build_object('ok', false, 'motivo', 'isso já é um pedido de remarcação');
  end if;
  if exists (select 1 from public.appointments
             where remarca_de = appt and status = 'pendente') then
    return jsonb_build_object('ok', false, 'motivo', 'já existe um pedido aberto para esse horário');
  end if;
  if (nova_data + nova_hora) <= public.agora_local() then
    return jsonb_build_object('ok', false, 'motivo', 'esse horário já passou');
  end if;
  if nova_data = a.date and nova_hora = a.start_time then
    return jsonb_build_object('ok', false, 'motivo', 'é o mesmo horário de agora');
  end if;

  dur := (extract(epoch from (a.end_time - a.start_time)) / 60)::integer;

  if nova_data = a.date
     and nova_hora < a.end_time
     and (nova_hora + make_interval(mins => dur))::time > a.start_time then
    return jsonb_build_object('ok', false,
      'motivo', 'esse horário cruza com o seu horário atual. Escolha um que não encoste nele, ou cancele e marque de novo');
  end if;

  if not exists (select 1 from public.horarios_livres(a.professional_id, nova_data, dur) h
                 where h.hora = nova_hora) then
    return jsonb_build_object('ok', false, 'motivo', 'esse horário não está mais livre');
  end if;

  -- nasce pendente e ligado ao antigo. O gatilho do insert faz o resto:
  -- abre o pedido se ela pede confirmação, confirma se não pede.
  begin
    insert into public.appointments
      (client_id, professional_id, salon_id, service_id, service_name,
       price_cents, date, start_time, end_time, notes, status, remarca_de)
    values
      (a.client_id, a.professional_id, a.salon_id, a.service_id, a.service_name,
       a.price_cents, nova_data, nova_hora,
       (nova_hora + make_interval(mins => dur))::time,
       a.notes, 'pendente', appt)
    returning id into novo;
  exception when unique_violation or exclusion_violation then
    return jsonb_build_object('ok', false, 'motivo', 'esse horário acabou de ser reservado por outra pessoa');
  end;

  select status into virou from public.appointments where id = novo;
  select minutos_para_aceitar into minutos
  from public.professionals where id = a.professional_id;

  if virou = 'confirmado' then
    -- ela não pede confirmação: a troca já aconteceu
    perform public.efetivar_remarcacao(novo);
    perform public.notificar(
      a.client_id, 'remarcacao_aceita', 'Remarcado!', null,
      '/cliente/meus-agendamentos',
      jsonb_build_object('appointment_id', novo, 'professional_id', a.professional_id));
  end if;

  return jsonb_build_object('ok', true,
    'appointment_id', novo,
    'pendente', virou = 'pendente',
    'minutos', minutos);
end;
$$;

revoke execute on function public.pedir_remarcacao(uuid, date, time) from public, anon;
grant execute on function public.pedir_remarcacao(uuid, date, time) to authenticated;

-- 6. A resposta da profissional sabe que era uma troca -------------------
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
  troca boolean;
begin
  select * into ac from public.aceites
  where appointment_id = appt and resultado is null;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'pedido já resolvido');
  end if;

  select * into a from public.appointments where id = appt;

  -- a cliente desfez o pedido antes da resposta: não há mais o que
  -- aceitar, e avisá-la de um "confirmado" agora seria mentira
  if a.status <> 'pendente' then
    update public.aceites
    set resultado = 'desistiu', resolvido_em = now()
    where appointment_id = appt;
    return jsonb_build_object('ok', false, 'motivo', 'a cliente já cancelou esse pedido');
  end if;

  cliente := a.client_id;
  troca := a.remarca_de is not null;

  -- este caminho tem texto próprio, então o gatilho não manda o dele por cima
  perform public.silenciar_gatilho();

  if aceitou then
    update public.appointments set status = 'confirmado'
    where id = appt and status = 'pendente';
    if troca then
      perform public.efetivar_remarcacao(appt);
      aviso := public.notificar(cliente, 'remarcacao_aceita', 'Remarcado!', null,
        '/cliente/meus-agendamentos',
        jsonb_build_object('appointment_id', appt, 'professional_id', ac.professional_id));
    else
      aviso := public.notificar(cliente, 'pedido_aceito', 'Horário confirmado', null, '/',
        jsonb_build_object('appointment_id', appt, 'professional_id', ac.professional_id));
    end if;
  else
    update public.appointments set status = 'cancelado' where id = appt;
    if troca then
      aviso := public.notificar(cliente, 'remarcacao_recusada', 'Não deu para remarcar', null,
        '/cliente/meus-agendamentos',
        jsonb_build_object('appointment_id', appt, 'professional_id', ac.professional_id));
    else
      aviso := public.notificar(cliente, 'pedido_recusado', 'Horário não confirmado', null, '/',
        jsonb_build_object('appointment_id', appt, 'professional_id', ac.professional_id));
    end if;
  end if;

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
    'remarcacao', troca,
    'avisou_cliente', saiu);
end;
$$;

revoke execute on function public.resolver_aceite(uuid, boolean)
  from public, anon, authenticated;

-- 7. Cliente desistiu do pedido: fecha o aceite e avisa do jeito certo ---
create or replace function public.avisa_profissional_do_cancelamento()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  conta uuid;
  agiu text;
  tinha_pedido boolean := false;
begin
  if new.status <> 'cancelado' or old.status = 'cancelado' then
    return new;
  end if;

  -- um pedido aberto para um horário que não existe mais não pode
  -- continuar esperando resposta
  update public.aceites
  set resultado = 'desistiu', resolvido_em = now()
  where appointment_id = new.id and resultado is null;
  tinha_pedido := found;

  if public.gatilho_silenciado() then
    return new;
  end if;

  agiu := public.quem_age_e(new);
  if agiu in ('profissional', 'salao') then
    return new;
  end if;

  conta := public.conta_da_profissional(new.professional_id);
  if conta is null or conta = new.client_id then
    return new;
  end if;

  perform public.notificar(
    conta, 'cancelou_comigo',
    case when tinha_pedido then 'A cliente desistiu do pedido'
         else 'Cancelaram um horário' end,
    null, '/pro',
    jsonb_build_object('appointment_id', new.id,
                       'professional_id', new.professional_id,
                       'desistiu', tinha_pedido));
  return new;
end;
$$;

-- 8. Cancelou o horário de origem? O pedido de troca cai junto ----------
-- Roda por último (nome com zz) para que os avisos do cancelamento
-- original já tenham saído antes de silenciar o resto da transação.
create or replace function public.derruba_remarcacao_pendente()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.status <> 'cancelado' or old.status = 'cancelado' then
    return new;
  end if;
  if new.remarcado_para is not null then
    return new;                      -- foi a própria troca que o cancelou
  end if;
  if exists (select 1 from public.appointments
             where remarca_de = new.id and status = 'pendente') then
    perform public.silenciar_gatilho();
    update public.appointments set status = 'cancelado'
    where remarca_de = new.id and status = 'pendente';
    -- os aceites desses caem no gatilho de cima, que fecha como 'desistiu'
  end if;
  return new;
end;
$$;

revoke execute on function public.derruba_remarcacao_pendente() from public, anon, authenticated;

drop trigger if exists tg_zz_derruba_remarcacao on public.appointments;
create trigger tg_zz_derruba_remarcacao
  after update of status on public.appointments
  for each row execute function public.derruba_remarcacao_pendente();

-- 9. A tela de pedidos da profissional mostra que é troca ---------------
drop function if exists public.meus_pedidos();
create or replace function public.meus_pedidos()
returns table (
  appointment_id uuid,
  cliente text,
  servico text,
  quando text,
  faltam_min integer,
  remarcacao boolean,
  antes text
)
language sql
stable
security definer set search_path = public
as $$
  select ac.appointment_id,
         coalesce(nullif(btrim(pf.full_name), ''), 'Cliente'),
         coalesce(a.service_name, s.name, 'Atendimento'),
         public.dia_por_extenso(a.date) || ' às ' || to_char(a.start_time, 'HH24:MI'),
         greatest(0, extract(epoch from (ac.expira_em - now()))/60)::integer,
         a.remarca_de is not null,
         case when o.id is not null
              then public.dia_por_extenso(o.date) || ' às ' || to_char(o.start_time, 'HH24:MI') end
  from public.aceites ac
  join public.appointments a on a.id = ac.appointment_id
  left join public.appointments o on o.id = a.remarca_de
  left join public.profiles pf on pf.id = a.client_id
  left join public.services s on s.id = a.service_id
  where ac.resultado is null
    and (public.is_professional(ac.professional_id)
         or public.is_admin_do_salao(ac.salon_id))
  order by ac.expira_em;
$$;

revoke execute on function public.meus_pedidos() from public, anon;
grant execute on function public.meus_pedidos() to authenticated;

-- 10. Os textos ------------------------------------------------------------
-- A função inteira de novo (é assim que ela muda), com quatro coisas a
-- mais: o pedido de aceite e o "horário novo" contam quando é troca; o
-- "cancelaram" vira "desistiu do pedido" quando havia pedido; e a
-- cliente ganha dois textos, remarcado e não deu.
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

revoke execute on function public.montar_texto_whatsapp(text, text, text, uuid, uuid, uuid)
  from public, anon, authenticated;

