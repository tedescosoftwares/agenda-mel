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
  if a.remarca_de is not null and a.status = 'pendente' then
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
